/**
 * Trial gating — quota + expiry enforcement for free-tier tenants.
 *
 * Rules:
 *   - `plan === 'free'` AND `trial_ends_at` in the past
 *       → tenant is read-only. Block /api/public/lead/<slug>.
 *   - `plan === 'free'` AND trial active AND lead count >= TRIAL_LEAD_LIMIT
 *       → trial quota exceeded. Block.
 *   - Any paid plan → no checks here.
 *
 * Quote *previews* (the calculator) are NOT counted — visitors can keep
 * computing quotes against a tenant indefinitely; only `lead` submissions
 * count against the quota. That matches what the carrier actually cares
 * about: how many qualified leads landed in their inbox.
 */
import { count } from 'drizzle-orm';
import { eq, and, gte } from 'drizzle-orm';
import { db } from '../db/client.js';
import { leads, type Tenant } from '../db/schema.js';

export const TRIAL_LEAD_LIMIT = 25;
export const PAID_FREE_LEAD_LIMIT = 0; // post-trial free = read-only

export interface TrialState {
  /** 'trial' | 'trial_expired' | 'paid' | 'unknown' */
  status: 'trial' | 'trial_expired' | 'paid' | 'unknown';
  /** Whether this tenant can accept new leads right now. */
  acceptingLeads: boolean;
  /** Number of leads consumed against the quota. */
  leadsUsed: number;
  /** Quota limit — null if unlimited (paid). */
  leadsLimit: number | null;
  /** Days remaining in trial — only meaningful when status === 'trial'. */
  daysLeft: number;
  /** ISO date when trial ends (or null). */
  trialEndsAt: string | null;
  /** Reason string when not accepting (for surfacing in the API response). */
  reason?: string;
}

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.ceil((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)));
}

export async function getTrialState(tenant: Tenant): Promise<TrialState> {
  const now = new Date();
  const isFree = tenant.plan === 'free';
  const trialEnd = tenant.trialEndsAt ?? null;

  if (!isFree) {
    return {
      status: 'paid',
      acceptingLeads: tenant.status === 'active',
      leadsUsed: 0,
      leadsLimit: null,
      daysLeft: 0,
      trialEndsAt: trialEnd ? trialEnd.toISOString() : null,
    };
  }

  // Lead count — all-time for this tenant. Trial limit is small enough
  // that we don't bother windowing it; once they convert to paid the
  // counter resets implicitly (limit becomes null).
  const cnt = await db()
    .select({ n: count() })
    .from(leads)
    .where(eq(leads.tenantId, tenant.id));
  const leadsUsed = Number(cnt[0]?.n ?? 0);

  const trialActive = trialEnd != null && trialEnd > now;

  if (trialActive) {
    const limit = TRIAL_LEAD_LIMIT;
    const accepting = leadsUsed < limit && tenant.status === 'active';
    return {
      status: 'trial',
      acceptingLeads: accepting,
      leadsUsed,
      leadsLimit: limit,
      daysLeft: daysBetween(now, trialEnd),
      trialEndsAt: trialEnd.toISOString(),
      reason: !accepting
        ? leadsUsed >= limit
          ? `Trial limit of ${limit} leads reached — upgrade to keep capturing.`
          : 'Tenant is suspended.'
        : undefined,
    };
  }

  // Trial expired (or never started, treat as expired-on-free).
  return {
    status: 'trial_expired',
    acceptingLeads: false,
    leadsUsed,
    leadsLimit: 0,
    daysLeft: 0,
    trialEndsAt: trialEnd ? trialEnd.toISOString() : null,
    reason: 'Trial has ended. Upgrade to a paid plan to keep capturing leads.',
  };
}

/** Helper: count leads created since a given date for a tenant. */
export async function leadsSince(tenantId: number, since: Date): Promise<number> {
  const c = await db()
    .select({ n: count() })
    .from(leads)
    .where(and(eq(leads.tenantId, tenantId), gte(leads.createdAt, since)));
  return Number(c[0]?.n ?? 0);
}
