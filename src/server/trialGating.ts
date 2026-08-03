/**
 * Trial / plan state for a tenant — drives whether the public lead
 * endpoint accepts new leads and what the dashboard banner shows.
 *
 * New two-tier model (see src/server/plans.ts):
 *   - Trialing (trialEndsAt in the future) → all-inclusive, accepting
 *     leads. NO lead cap.
 *   - Paid (effective plan 'vital' or 'pro', trial over) → accepting
 *     leads, unlimited.
 *   - 'free' with the trial ended (never subscribed / cancelled) →
 *     read-only: the public lead endpoint is blocked and the dashboard
 *     mutation gate applies.
 *
 * There is NO 25-lead / 30-leads-per-month quota anymore — after the trial
 * the tenant is a paying Vital/Pro customer (or cancelled). Quote previews
 * (the calculator) were never counted and still aren't.
 */
import { type Tenant } from '../db/schema.js';
import { effectivePlan, isTrialing } from './plans.js';

/**
 * Key stored in the tenant's `lifecycle_emails_json` when a paid subscription
 * enters Stripe's dunning grace window (`past_due`/`incomplete`) — set from the
 * billing webhook (see billing.ts). Presence = "the last payment failed, update
 * your card". Value is the ISO timestamp we first saw the failure. Cleared when
 * the subscription returns to `active`. Reusing the open-typed lifecycle jsonb
 * avoids a schema migration for this single per-tenant flag.
 */
export const BILLING_PAST_DUE_KEY = 'billingPastDueSince';

/** True when the tenant is in the payment-grace window (card failed, still
 *  inside Stripe's retry schedule) per the persisted lifecycle marker. */
export function isTenantBillingPastDue(tenant: Tenant): boolean {
  return !!tenant.lifecycleEmailsJson?.[BILLING_PAST_DUE_KEY];
}

export interface TrialState {
  /** 'trial' | 'trial_expired' | 'paid' | 'unknown' */
  status: 'trial' | 'trial_expired' | 'paid' | 'unknown';
  /** Whether this tenant can accept new leads right now. */
  acceptingLeads: boolean;
  /** Effective plan powering feature access ('free' | 'vital' | 'pro'). */
  plan: 'free' | 'vital' | 'pro';
  /** Days remaining in trial — only meaningful when status === 'trial'. */
  daysLeft: number;
  /** ISO date when trial ends (or null). */
  trialEndsAt: string | null;
  /** True when the tenant's last renewal charge failed and Stripe is retrying
   *  (grace window). Drives the "update your card" banner, which takes
   *  precedence over the trial countdown. Independent of `status`: a paying
   *  tenant is `status:'paid'` but still past_due here. */
  paymentPastDue: boolean;
  /** Reason string when not accepting (for surfacing in the API response). */
  reason?: string;
}

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.ceil((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)));
}

export async function getTrialState(tenant: Tenant): Promise<TrialState> {
  const now = new Date();
  const isActive = tenant.status === 'active';
  const trialEnd = tenant.trialEndsAt ?? null;
  const eff = effectivePlan(tenant);
  const paymentPastDue = isTenantBillingPastDue(tenant);

  // Inside the 14-day all-inclusive trial.
  if (isTrialing(tenant)) {
    return {
      status: 'trial',
      acceptingLeads: isActive,
      plan: eff, // 'pro' during trial
      daysLeft: trialEnd ? daysBetween(now, trialEnd) : 0,
      trialEndsAt: trialEnd ? trialEnd.toISOString() : null,
      paymentPastDue,
      reason: isActive ? undefined : 'Tenant is suspended.',
    };
  }

  // Paying Vital/Pro tenant — unlimited, no cap.
  if (eff !== 'free') {
    return {
      status: 'paid',
      acceptingLeads: isActive,
      plan: eff,
      daysLeft: 0,
      trialEndsAt: trialEnd ? trialEnd.toISOString() : null,
      paymentPastDue,
    };
  }

  // Free: trial ended and never subscribed / cancelled → read-only.
  return {
    status: 'trial_expired',
    acceptingLeads: false,
    plan: 'free',
    daysLeft: 0,
    trialEndsAt: trialEnd ? trialEnd.toISOString() : null,
    paymentPastDue,
    reason: 'Your trial has ended. Choose a plan to keep capturing leads.',
  };
}
