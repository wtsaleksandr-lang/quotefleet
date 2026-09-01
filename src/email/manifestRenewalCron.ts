/**
 * Manifest Privacy renewal-reminder cron — CBP vessel manifest confidentiality
 * is valid 2 years from receipt, and CBP sends NO expiry reminder, so we track
 * it and refile before it lapses. Modeled on the weekly-digest cron.
 *
 * Schedule: hourly tick from app boot; the tick fires the send pass only on the
 * daily slot (~15:00 UTC). Per-row double-send guard via
 * poa_applications.lastReminderAt (a short cooldown) makes the pass idempotent
 * across the hour the slot is open and across restarts.
 *
 * Reminder bands: T-180 / 90 / 60 / 30 / 7 days before expiry. The T-180 band is
 * the "18 months into the 2-year term" nudge — CBP grants confidentiality for
 * two years, sends NO expiry notice, and never auto-renews, so the customer gets
 * a heads-up a full six months out and the replacement is filed inside the
 * 60–90 day window. An active application that enters the window is moved to
 * `renewal_due`, emailed a "expires [date] — we’ll refile" note with a one-click
 * renew link, and logged (renewal_reminded). Re-filing resets expires_at
 * (+2 years) — handled by the admin confirm flow on the fresh filing.
 *
 * Kill-switch: MANIFEST_RENEWAL_DISABLED=1 disables the cron entirely (tests,
 * second instance). Single-instance assumption (Reserved VM) — same as the other
 * QuoteFleet crons.
 */
import { and, gte, inArray, lte } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { poaApplications, poaAuditEvents, type PoaApplication } from '../db/schema.js';
import { sendEmail } from './send.js';
import { loadEnv } from '../config.js';
import { runTrackedJob, outcomeFromTick, jobSkipped, type TickResult } from '../server/jobHealth.js';
import { startCronSchedule } from '../server/cronSchedule.js';

const TICK_MS = 60 * 60 * 1000; // hourly
const DAY_MS = 24 * 60 * 60 * 1000;

/** Daily send slot: 15:00 UTC. */
const SEND_HOUR = 15;
/** Reminder bands (days before expiry). 180 ≈ 18 months into a 2-year term. */
export const RENEWAL_BANDS = [180, 90, 60, 30, 7] as const;
/** The widest band — how far out the scan looks. */
export const RENEWAL_WINDOW_DAYS = Math.max(...RENEWAL_BANDS);
/** Don't re-send within this window — the per-row double-send guard. Shorter
 *  than the gap between bands so each band fires once, but long enough that
 *  consecutive hourly/daily ticks never double-send. */
const RESEND_COOLDOWN_MS = 14 * DAY_MS;

let started = false;

export function startManifestRenewalCron(): void {
  if (started) return;
  if (process.env.MANIFEST_RENEWAL_DISABLED === '1') {
    console.log('[manifestRenewal.cron] disabled via MANIFEST_RENEWAL_DISABLED=1');
    return;
  }
  started = true;
  startCronSchedule({ cron: 'manifest-renewal', tickMs: TICK_MS, run: maybeRun });
  console.log(`[manifestRenewal.cron] daily slot ${SEND_HOUR}:00 UTC`);
}

/** Gate the hourly tick to the daily send slot, then run the pass. */
async function maybeRun(reason: string): Promise<void> {
  // Every hourly tick records, including the 23 hours a day outside the send
  // slot. Those are `skipped` — healthy — and they give this job an hourly
  // heartbeat rather than a daily one. See jobHealthWatchdog.ts.
  await runTrackedJob('manifest-renewal', async () => {
    const now = new Date();
    if (now.getUTCHours() !== SEND_HOUR) return jobSkipped(`outside the ${SEND_HOUR}:00 UTC send hour`);
    return outcomeFromTick(
      await runManifestRenewalOnce(reason, now),
      'no filing is inside a renewal reminder band',
    );
  });
}

/** The tightest band an application currently qualifies for, or null (outside
 *  the widest window / already expired). daysLeft ≤ band. */
export function bandFor(daysLeft: number): number | null {
  if (daysLeft < 0) return null;
  let hit: number | null = null;
  for (const b of RENEWAL_BANDS) {
    if (daysLeft <= b) hit = hit == null ? b : Math.min(hit, b);
  }
  return hit;
}

/**
 * One renewal pass — scan active / renewal-due applications with an expiry
 * inside the 90-day window, and for each not reminded within the cooldown, send
 * the reminder, move it to `renewal_due`, stamp lastReminderAt, and log the
 * event. Exported for tests; `now` is injectable.
 */
export async function runManifestRenewalOnce(reason: string, now: Date = new Date()): Promise<TickResult> {
  const t0 = Date.now();
  let sent = 0;
  try {
    const windowEnd = new Date(now.getTime() + RENEWAL_WINDOW_DAYS * DAY_MS);
    const rows = await db()
      .select()
      .from(poaApplications)
      .where(
        and(
          inArray(poaApplications.status, ['active', 'renewal_due']),
          gte(poaApplications.expiresAt, now),
          lte(poaApplications.expiresAt, windowEnd),
        ),
      );

    for (const app of rows) {
      if (!app.expiresAt) continue;
      const daysLeft = Math.ceil((app.expiresAt.getTime() - now.getTime()) / DAY_MS);
      const band = bandFor(daysLeft);
      if (band == null) continue;
      // Double-send guard: skip if reminded within the cooldown.
      if (app.lastReminderAt && now.getTime() - app.lastReminderAt.getTime() < RESEND_COOLDOWN_MS) {
        continue;
      }
      const ok = await sendOne(app, daysLeft, band, now);
      if (ok) sent++;
    }
  } catch (err) {
    console.warn(`[manifestRenewal.cron] pass failed (${reason}):`, err);
    // Was a bare `return`. This is the highest-consequence silent failure in
    // the product: a missed renewal band means a CBP confidentiality filing
    // lapses and a paying customer's shipment data is re-exposed.
    return { ok: false, processed: 0, detail: err instanceof Error ? err.message : String(err) };
  }
  const ms = Date.now() - t0;
  if (sent > 0) {
    console.log(`[manifestRenewal.cron] pass=${reason} sent=${sent} elapsed=${ms}ms`);
  }
  return { ok: true, processed: sent, detail: sent > 0 ? `sent ${sent} renewal reminder(s)` : undefined };
}

function publicBaseUrl(): string {
  return loadEnv().PUBLIC_BASE_URL.replace(/\/$/, '');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(d: Date): string {
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

async function sendOne(app: PoaApplication, daysLeft: number, band: number, now: Date): Promise<boolean> {
  const base = publicBaseUrl();
  const renewUrl = `${base}/privacy/apply/${app.publicToken}`;
  const expires = app.expiresAt ? fmtDate(app.expiresAt) : 'soon';

  try {
    // Move to renewal_due + stamp the guard FIRST, so even if the email provider
    // is slow/failing we never re-scan-and-double-send this row next tick.
    await db()
      .update(poaApplications)
      .set({ status: 'renewal_due', lastReminderAt: now, updatedAt: new Date() })
      .where(eq(poaApplications.id, app.id));
    await db().insert(poaAuditEvents).values({
      applicationId: app.id,
      event: 'renewal_reminded',
      meta: { band, daysLeft, expiresAt: app.expiresAt?.toISOString() ?? null },
    });

    if (app.signerEmail) {
      const out = await sendEmail({
        to: app.signerEmail,
        subject: `Your Manifest Privacy protection expires ${expires}`,
        text:
          `Your U.S. Customs vessel manifest confidentiality protection for ` +
          `${app.grantorLegalName || 'your business'} expires ${expires} (about ${daysLeft} days). ` +
          `CBP confidentiality must be renewed before it lapses — we’ll prepare and submit your ` +
          `renewal to CBP on your behalf.\n\nRenew in one click: ${renewUrl}\n\n— QuoteFleet Manifest Privacy`,
      });
      if (!out.ok) {
        console.error(`[manifestRenewal] send FAILED (app ${app.id}): ${out.error ?? 'unknown'}`);
        // The row is already renewal_due + guarded; a failed email is logged, not
        // retried this pass (the next band or a manual nudge covers it).
        return false;
      }
    }
    return true;
  } catch (err) {
    console.warn(`[manifestRenewal.cron] sending for app ${app.id} failed:`, err);
    return false;
  }
}
