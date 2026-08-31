/**
 * DUNNING email cron — recovers failed subscription payments by emailing the
 * customer an escalating "update your card" sequence (day 0 → day 3 → day 6).
 *
 * When a renewal charge fails, Stripe moves the subscription to `past_due` and
 * the billing webhook stamps `BILLING_PAST_DUE_KEY` (`billingPastDueSince`) on
 * the tenant's `lifecycle_emails_json` (routes/billing.ts). Previously that
 * marker only drove an IN-APP "update your card" banner — the customer was
 * never emailed, silently leaking recoverable revenue. This cron closes that
 * gap: it emails the card-update sequence and STOPS the moment the account
 * recovers.
 *
 * Modeled on src/email/lifecycleCron.ts + followUpCron.ts:
 *   - hourly tick from boot (the cadence is in DAYS, so hourly is plenty and
 *     cheap); each tick scans tenants and sends any DUE stage — at most one
 *     stage per tenant per tick.
 *   - IDEMPOTENT: every send is recorded under the stage's own key in
 *     lifecycle_emails_json (billingDunningSent0/3/6 → ISO). A stage already
 *     there never re-sends, so the cron is safe to run repeatedly / after a
 *     restart. nextDunningAction() (dunning.ts) is the single source of the
 *     due/sent/reset decision — pure + unit-tested.
 *   - STOP + RESET on recovery: when the webhook clears `billingPastDueSince`
 *     (return to `active`, or a terminal downgrade), the stale stage markers
 *     are cleared so a FUTURE past-due starts fresh from stage 0. A recovered /
 *     never-past-due account sends nothing.
 *   - TRANSACTIONAL: a failed-payment notice concerns an active transaction, so
 *     it always sends — NOT gated on the marketing opt-out and no unsubscribe
 *     header (like the magic-link email).
 *   - Honors DUNNING_EMAIL_DISABLED=1 (tests / a second instance).
 *   - Single-instance assumption (Reserved VM = one node), same as the other
 *     crons. Multi-instance would need a distributed lock.
 *
 * Best-effort throughout: a per-tenant failure is logged, never thrown out of
 * the tick, so one bad row can't stall the sweep or crash boot.
 */
import { eq, isNotNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { runTrackedJob, outcomeFromTick, type TickResult } from '../server/jobHealth.js';
import { tenants, type Tenant } from '../db/schema.js';
import { sendEmail, wasSentByAProvider } from './send.js';
import { billingDunningEmail } from './templates.js';
import { BILLING_PAST_DUE_KEY } from '../server/trialGating.js';
import { nextDunningAction, DUNNING_STAGE_KEYS, type DunningStage } from './dunning.js';
import { loadEnv } from '../config.js';
import { startCronSchedule } from '../server/cronSchedule.js';

const TICK_MS = 60 * 60 * 1000; // 1 hour

let started = false;

export function startDunningEmailCron(): void {
  if (started) return;
  if (process.env.DUNNING_EMAIL_DISABLED === '1') {
    console.log('[dunning.cron] disabled via DUNNING_EMAIL_DISABLED=1');
    return;
  }
  started = true;
  startCronSchedule({ cron: 'dunning-email', tickMs: TICK_MS, run: trackedRunOnce });
}

/** Scheduling site: records every tick to the job ledger and alerts on failure. */
async function trackedRunOnce(reason: string): Promise<void> {
  await runTrackedJob('dunning-email', async () =>
    outcomeFromTick(await runOnce(reason), 'no tenant is past due'),
  );
}

function publicBaseUrl(): string {
  return loadEnv().PUBLIC_BASE_URL.replace(/\/$/, '');
}

/** One cron tick — scan tenants and send any due dunning stage / reset any
 *  recovered sequence. Exported for tests (the cron drives it on a timer).
 *  `now` is injectable for deterministic tests. */
export async function runOnce(reason: string, now: number = Date.now()): Promise<TickResult> {
  const t0 = Date.now();
  let sent = 0;
  let reset = 0;
  try {
    // Only tenants that have ANY lifecycle json could be past-due or carry a
    // stale dunning marker. Tenant count is small — one cheap scan, decide in JS
    // (nextDunningAction). Tenants with no json can't be past-due, so skip them.
    const rows = await db()
      .select()
      .from(tenants)
      .where(isNotNull(tenants.lifecycleEmailsJson));

    for (const t of rows) {
      const json = t.lifecycleEmailsJson ?? {};
      const action = nextDunningAction(
        { pastDueSince: json[BILLING_PAST_DUE_KEY] ?? null, sent: json },
        now
      );
      if (!action) continue;
      if (action.type === 'send') {
        const ok = await sendStage(t, action.stage, now);
        if (ok) sent++;
      } else if (action.type === 'reset') {
        const ok = await resetSequence(t);
        if (ok) reset++;
      }
    }
  } catch (err) {
    console.warn(`[dunning.cron] tick failed (${reason}):`, err);
    // Was a bare `return`. Dunning failing silently is a direct revenue leak:
    // past-due tenants stop being asked to fix their card and simply churn.
    return { ok: false, processed: 0, detail: err instanceof Error ? err.message : String(err) };
  }
  const ms = Date.now() - t0;
  if (sent > 0 || reset > 0) {
    console.log(`[dunning.cron] tick=${reason} sent=${sent} reset=${reset} elapsed=${ms}ms`);
  }
  return {
    ok: true,
    processed: sent + reset,
    detail: sent + reset > 0 ? `sent ${sent} dunning email(s), reset ${reset} sequence(s)` : undefined,
  };
}

/** Send one dunning stage to the tenant, then record it under the stage's key
 *  so it never re-sends. Returns true on a successful send. Best-effort. */
async function sendStage(t: Tenant, stage: DunningStage, now: number): Promise<boolean> {
  if (!t.contactEmail) return false;
  const base = publicBaseUrl();
  try {
    const { subject, html } = billingDunningEmail({
      stageId: stage.id,
      // In-app billing page (/app → Plan settings) — it opens the Stripe
      // Customer Portal via /api/billing/portal, which requires an authed
      // session, so we link to the page that opens it rather than the raw
      // portal URL.
      appUrl: `${base}/app`,
    });
    const out = await sendEmail({
      to: t.contactEmail,
      subject,
      html,
      // Plain-text parity for text-only clients.
      text:
        `${subject}\n\n` +
        `Update the card on file for your QuoteFleet subscription: ${base}/app  →  Plan settings.\n\n` +
        `Questions? Just reply to this email.\n\n` +
        `— QuoteFleet\n`,
      // Transactional billing notice — no List-Unsubscribe header.
    });
    if (!out.ok) {
      console.error(
        `[dunning] stage ${stage.id} send FAILED (tenant ${t.id}): ${out.error ?? 'unknown error'}`
      );
      return false;
    }
    // `ok` is not `sent`. A logged-only result (no provider configured, or a
    // reserved recipient) never reached the wire, and the stamp below is a
    // PERMANENT "already sent" marker — writing it on a logged-only send loses
    // this dunning notice forever, on the one email sequence whose whole job is
    // to stop a subscription lapsing. See wasSentByAProvider.
    if (!wasSentByAProvider(out)) {
      console.warn(
        `[dunning] stage ${stage.id} was LOGGED ONLY (provider=${out.provider ?? 'none'}, tenant ${t.id}) — not marking it sent`
      );
      return false;
    }
    const updated = { ...(t.lifecycleEmailsJson ?? {}), [stage.key]: new Date(now).toISOString() };
    await db()
      .update(tenants)
      .set({ lifecycleEmailsJson: updated, updatedAt: new Date() })
      .where(eq(tenants.id, t.id));
    return true;
  } catch (err) {
    console.warn(`[dunning.cron] sending stage ${stage.id} to tenant ${t.id} failed:`, err);
    return false;
  }
}

/** Clear the dunning stage markers for a RECOVERED tenant (past_due cleared by
 *  the webhook) so a future failure restarts the sequence at stage 0. Preserves
 *  every other lifecycle key. Returns true when it actually cleared something. */
async function resetSequence(t: Tenant): Promise<boolean> {
  try {
    const json = { ...(t.lifecycleEmailsJson ?? {}) };
    let changed = false;
    for (const k of DUNNING_STAGE_KEYS) {
      if (json[k] != null) {
        delete json[k];
        changed = true;
      }
    }
    if (!changed) return false;
    await db()
      .update(tenants)
      .set({ lifecycleEmailsJson: json, updatedAt: new Date() })
      .where(eq(tenants.id, t.id));
    return true;
  } catch (err) {
    console.warn(`[dunning.cron] resetting sequence for tenant ${t.id} failed:`, err);
    return false;
  }
}
