/**
 * Shared DUNNING logic — the ONE place that decides which card-update email
 * (if any) is due for a tenant whose subscription payment failed, and when the
 * sequence should reset. Pure functions with no timers / DB / I/O, so the
 * stage-selection + reset + idempotency rules are trivially unit-testable and
 * reused verbatim by the cron (src/email/dunningCron.ts).
 *
 * Model (mirrors WeFixTrades' dunningWorker, adapted to QuoteFleet's tenants +
 * Stripe grace model). When a renewal charge fails, Stripe moves the sub to
 * `past_due` and the billing webhook stamps `BILLING_PAST_DUE_KEY`
 * (`billingPastDueSince`) on the tenant's open-typed `lifecycle_emails_json`
 * (see server/trialGating.ts + routes/billing.ts). Using that same jsonb, we
 * send an escalating "update your card" sequence anchored to that timestamp:
 *
 *   stage 0  — day 0  (immediately, on the failure)   → billingDunningSent0
 *   stage 3  — day 3  (reminder)                        → billingDunningSent3
 *   stage 6  — day 6  (final notice before access ends) → billingDunningSent6
 *
 * Each stage's send is recorded under its own key so it never re-sends
 * (idempotent). When the account RECOVERS — the webhook clears
 * `billingPastDueSince` on return to `active` (or on a terminal downgrade) —
 * the stale stage markers are cleared so a FUTURE past-due starts the sequence
 * fresh from stage 0. A recovered / never-past-due account sends nothing.
 *
 * These are TRANSACTIONAL billing notices (an existing customer's payment
 * failed), so — unlike the trial card-reminders — they are NOT gated on the
 * marketing opt-out and carry no unsubscribe header. The cron does the gating +
 * persistence; this module only decides.
 */

/** A single stage in the escalating card-update sequence. */
export interface DunningStage {
  /** Stable id used to pick the email copy. */
  id: '0' | '3' | '6';
  /** jsonb key marking this stage as sent (value = ISO send time). */
  key: string;
  /** Days after the payment first failed at which this stage becomes due. */
  afterDays: number;
}

/** The three stages, in send order. Day 0 (on failure), day 3, day 6. */
export const DUNNING_STAGES: readonly DunningStage[] = [
  { id: '0', key: 'billingDunningSent0', afterDays: 0 },
  { id: '3', key: 'billingDunningSent3', afterDays: 3 },
  { id: '6', key: 'billingDunningSent6', afterDays: 6 },
];

/** All stage keys — used to clear the sequence on recovery. */
export const DUNNING_STAGE_KEYS: readonly string[] = DUNNING_STAGES.map((s) => s.key);

/** The minimal slice of a tenant's billing/lifecycle state the decision needs. */
export interface DunningState {
  /** ISO timestamp the subscription first entered past-due (the
   *  `billingPastDueSince` marker), or null when the account is NOT past-due
   *  (never failed, or recovered). */
  pastDueSince: string | null;
  /** The tenant's `lifecycle_emails_json` (or the relevant subset) — read for
   *  the per-stage sent markers. */
  sent: Record<string, string>;
}

/** What the cron should do for a tenant this tick. `null` = nothing due. */
export type DunningAction =
  | { type: 'send'; stage: DunningStage }
  | { type: 'reset' }
  | null;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Decide the single dunning action (if any) for a tenant at `now`.
 *
 *   - NOT past-due, but stale stage markers linger → { type: 'reset' } so the
 *     next failure restarts at stage 0. (Recovery reset.)
 *   - NOT past-due, no markers                     → null (nothing to do).
 *   - Past-due                                     → the earliest unsent stage
 *     whose `afterDays` has elapsed → { type: 'send', stage }; else null.
 *
 * At most ONE action per tenant per tick (matches the lifecycle/follow-up
 * crons — the frequent tick lets the sequence catch up smoothly). `now` is
 * injectable for deterministic tests.
 */
export function nextDunningAction(state: DunningState, now: number = Date.now()): DunningAction {
  const sent = state.sent ?? {};

  if (!state.pastDueSince) {
    // Recovered (or never failed). If any stage markers remain from a prior
    // past-due episode, clear them so a future failure starts fresh.
    const hasStale = DUNNING_STAGE_KEYS.some((k) => sent[k]);
    return hasStale ? { type: 'reset' } : null;
  }

  const since = Date.parse(state.pastDueSince);
  if (Number.isNaN(since)) return null; // malformed marker → do nothing
  const elapsedDays = (now - since) / DAY_MS;

  // Earliest unsent stage that is now due. One send per tick.
  for (const stage of DUNNING_STAGES) {
    if (elapsedDays >= stage.afterDays && !sent[stage.key]) {
      return { type: 'send', stage };
    }
  }
  return null;
}
