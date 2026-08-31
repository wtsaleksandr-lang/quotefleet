/**
 * SHIPPER follow-up email cron — sends the carrier-branded nudge → reminder →
 * discount sequence to a customer (lead.customerEmail) who got a quote but
 * didn't book, on the tenant's configured cadence.
 *
 * Modeled on src/email/lifecycleCron.ts:
 *   - hourly tick from boot (the cadence is in DAYS, so hourly is plenty and
 *     cheap); each tick scans enabled tenants' open leads and sends any DUE
 *     touch — at most one touch per lead per tick.
 *   - IDEMPOTENT: every send is recorded in leads.followUpsSentJson ({nudge,
 *     reminder, discount} → ISO). A touch already there never re-sends, so the
 *     cron is safe to run repeatedly / after a restart. (decideNextFollowUp in
 *     followUp.ts is the single source of the due/sent decision, shared with the
 *     portal preview so preview == sent.)
 *   - STOP conditions: only status='new' leads with an email and no follow-up
 *     opt-out are eligible, so booked ('won') / dead ('lost') / spam / replied /
 *     draft leads are excluded by construction. The discount touch is skipped
 *     when discountPct ≤ 0.
 *   - PLAN GATE: follow-up is a Pro/marketing feature, gated with the same
 *     canUseProFeature() check the lead auto-reply uses (unlocked for everyone
 *     during the trial; off for post-trial free tenants).
 *   - Honors FOLLOWUP_EMAIL_DISABLED=1 (tests / a second instance).
 *   - Single-instance assumption (Reserved VM = one node), same as the other
 *     crons. Multi-instance would need a distributed lock.
 */
import { and, eq, isNotNull, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { runTrackedJob, outcomeFromTick, type TickResult } from '../server/jobHealth.js';
import { brandConfigs, leads, tenants, type Tenant } from '../db/schema.js';
import { sendEmail, brandedFrom, wasSentByAProvider } from './send.js';
import { leadUnsubscribeUrl } from './unsubscribe.js';
import { resolveFollowUpConfig, type FollowUpConfig } from '../server/features.js';
import { canUseProFeature } from '../server/plans.js';
import {
  decideNextFollowUp,
  renderFollowUpTouch,
  FOLLOWABLE_STATUS,
  type FollowUpLead,
  type FollowUpTouch,
} from './followUp.js';
import { loadEnv } from '../config.js';
import { startCronSchedule } from '../server/cronSchedule.js';
import { describeDbError, withDbRetry } from '../db/retry.js';

const TICK_MS = 60 * 60 * 1000; // 1 hour

let started = false;

export function startFollowUpEmailCron(): void {
  if (started) return;
  if (process.env.FOLLOWUP_EMAIL_DISABLED === '1') {
    console.log('[followup.cron] disabled via FOLLOWUP_EMAIL_DISABLED=1');
    return;
  }
  started = true;
  startCronSchedule({ cron: 'followup-email', tickMs: TICK_MS, run: trackedRunOnce });
}

/** Scheduling site: records every tick to the job ledger and alerts on failure. */
async function trackedRunOnce(reason: string): Promise<void> {
  await runTrackedJob('followup-email', async () =>
    outcomeFromTick(await runOnce(reason), 'no lead was due a follow-up'),
  );
}

function publicBaseUrl(): string {
  return loadEnv().PUBLIC_BASE_URL.replace(/\/$/, '');
}

/** One cron tick — scan every follow-up-enabled tenant's open leads and send
 *  any due touch. Exported for tests (the cron drives it on a timer). `now` is
 *  injectable for deterministic tests. */
export async function runOnce(reason: string, now: number = Date.now()): Promise<TickResult> {
  const t0 = Date.now();
  let sent = 0;
  try {
    // 1. Which tenants have follow-up ENABLED? The config lives in
    //    brand_configs.featuresJson.followUp; resolve every brand row and keep
    //    the enabled ones. (Tenant count is small — one cheap scan.)
    //    Retried on transient connection/wake failures only — a pure read, so
    //    running it twice costs nothing. The retry stops here on purpose: the
    //    per-tenant loop below sends email, and re-running that after a
    //    mid-pass drop would re-send what it had already delivered.
    const brands = await withDbRetry(
      () =>
        db()
          .select({ tenantId: brandConfigs.tenantId, featuresJson: brandConfigs.featuresJson })
          .from(brandConfigs)
          .where(isNotNull(brandConfigs.featuresJson)),
      { label: 'followup-email brand scan' },
    );

    const cfgByTenant = new Map<number, FollowUpConfig>();
    for (const b of brands) {
      const cfg = resolveFollowUpConfig(b);
      if (cfg.enabled) cfgByTenant.set(b.tenantId, cfg);
    }
    // No tenant has follow-up enabled. A legitimate idle tick, not a failure —
    // but it must still report, so the scheduler's heartbeat is recorded.
    if (cfgByTenant.size === 0) return { ok: true, processed: 0, detail: 'no tenant has follow-up enabled' };

    // 2. Load those tenants (name + plan for gating + brand fallback).
    const tenantRows = await db()
      .select()
      .from(tenants)
      .where(inArray(tenants.id, [...cfgByTenant.keys()]));
    const tenantById = new Map<number, Tenant>();
    for (const t of tenantRows) tenantById.set(t.id, t);

    // 3. Per enabled + plan-eligible tenant, fetch its followable leads and
    //    send any due touch. Also load the brand row for display name / logo.
    for (const [tenantId, cfg] of cfgByTenant) {
      const tenant = tenantById.get(tenantId);
      if (!tenant) continue;
      // Same plan gate as the lead auto-reply — Pro-only, unlocked in trial.
      if (!canUseProFeature(tenant)) continue;

      const brandRow = await db()
        .select({ displayName: brandConfigs.displayName, logoUrl: brandConfigs.logoUrl })
        .from(brandConfigs)
        .where(eq(brandConfigs.tenantId, tenantId));
      const brand = brandRow[0] ?? null;

      // Candidate leads: the single followable status, with a real email, not
      // opted out. Booked/dead/spam/replied/draft are excluded by the status
      // filter. The per-lead due/sent decision is decideNextFollowUp.
      const candidateLeads = (await db()
        .select()
        .from(leads)
        .where(
          and(
            eq(leads.tenantId, tenantId),
            eq(leads.status, FOLLOWABLE_STATUS),
            eq(leads.followUpOptOut, false),
            isNotNull(leads.customerEmail),
          ),
        )) as unknown as FollowUpLead[];

      for (const lead of candidateLeads) {
        // Defensive re-check of the stop conditions (a mock/query can't be
        // trusted to have applied them): no email, opted out, not followable.
        if (!lead.customerEmail) continue;
        if (lead.followUpOptOut) continue;
        if (lead.status !== FOLLOWABLE_STATUS) continue;

        const touch = decideNextFollowUp(lead, cfg, now);
        if (!touch) continue;
        const ok = await sendTouch(tenant, brand, cfg, lead, touch, now);
        if (ok) sent++;
      }
    }
  } catch (err) {
    console.warn(`[followup.cron] tick failed (${reason}):`, err);
    // Was a bare `return` — indistinguishable from a clean tick to the caller.
    // describeDbError unwraps drizzle's `Failed query: <SQL>` to the real cause.
    return { ok: false, processed: 0, detail: describeDbError(err) };
  }
  const ms = Date.now() - t0;
  if (sent > 0) console.log(`[followup.cron] tick=${reason} sent=${sent} elapsed=${ms}ms`);
  return { ok: true, processed: sent, detail: sent > 0 ? `sent ${sent} follow-up touch(es)` : undefined };
}

/** Render + send a single touch to the lead, then record it in
 *  followUpsSentJson so it never re-sends. Returns true on a successful send. */
async function sendTouch(
  tenant: Tenant,
  brand: { displayName?: string | null; logoUrl?: string | null } | null,
  cfg: FollowUpConfig,
  lead: FollowUpLead,
  touch: FollowUpTouch,
  now: number,
): Promise<boolean> {
  if (!lead.customerEmail) return false;
  const base = publicBaseUrl();
  const unsub = leadUnsubscribeUrl(base, lead.id);
  try {
    const { subject, html } = renderFollowUpTouch({
      touch,
      lead,
      cfg,
      brand,
      tenantName: tenant.name,
      baseUrl: base,
      unsubscribeUrl: unsub,
    });
    const brandName = brand?.displayName?.trim() || tenant.name;
    const quoteUrl = `${base}/quote/${encodeURIComponent(lead.refId)}`;
    const out = await sendEmail({
      to: lead.customerEmail,
      // Customer-facing → wear the CARRIER's brand (name + verified sender).
      from: brandedFrom(brandName),
      subject,
      html,
      text:
        `${subject}\n\n` +
        `View your quote: ${quoteUrl}\n\n` +
        `---\nYou're receiving this because you requested a quote from ${brandName}. ` +
        `Unsubscribe: ${unsub}\n`,
      // Follow-ups are commercial email → attach List-Unsubscribe headers.
      listUnsubscribeUrl: unsub,
    });
    if (!out.ok) {
      console.error(
        `[followup] ${touch} send FAILED (lead ${lead.refId}): ${out.error ?? 'unknown error'}`
      );
      return false;
    }
    // `ok` is not `sent` — a logged-only result never reached the wire, and the
    // stamp below permanently marks this touch done. See wasSentByAProvider.
    if (!wasSentByAProvider(out)) {
      console.warn(
        `[followup] ${touch} was LOGGED ONLY (provider=${out.provider ?? 'none'}, lead ${lead.refId}) — not marking it sent`
      );
      return false;
    }
    const updated = { ...(lead.followUpsSentJson ?? {}), [touch]: new Date(now).toISOString() };
    await db()
      .update(leads)
      .set({ followUpsSentJson: updated, updatedAt: new Date() })
      .where(eq(leads.id, lead.id));
    return true;
  } catch (err) {
    console.warn(`[followup.cron] sending ${touch} to lead ${lead.refId} failed:`, err);
    return false;
  }
}
