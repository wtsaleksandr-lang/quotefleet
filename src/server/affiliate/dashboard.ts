/**
 * Affiliate DASHBOARD stats (DB-touching, read-only).
 *
 * Phase-1 computes clicks / signups / conversions from referral_attributions and
 * earnings from affiliate_commissions (empty until the phase-2 billing job runs),
 * plus an HONEST estimate of monthly earnings from active referred customers ×
 * average revenue × rate. Real payouts wire in phase 2.
 */
import { and, count, eq, ne, isNotNull } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { affiliates, referralAttributions, affiliateCommissions } from '../../db/schema.js';
import type { Affiliate } from '../../db/schema.js';
import {
  tierProgress,
  estimateMonthlyCommissionCents,
  commissionRateForTier,
  type AffiliateTier,
} from './programs.js';

/** Average monthly revenue per referred customer (cents) used for the phase-1
 *  earnings ESTIMATE only — midpoint of Vital ($14.80) and Pro ($34.80). The
 *  phase-2 billing job replaces this with real invoice amounts. */
export const AVG_MONTHLY_REVENUE_CENTS = 2480;

export interface AffiliateDashboard {
  affiliate: {
    id: number;
    email: string;
    name: string | null;
    code: string;
    tier: AffiliateTier;
    status: string;
    commissionRate: number;
    link: string;
    payoutMethod: string | null;
  };
  stats: {
    clicks: number;
    signups: number;
    convertedCustomers: number;
    activeReferredCustomers: number;
  };
  tier: ReturnType<typeof tierProgress>;
  earnings: {
    estimatedMonthlyCents: number;
    pendingCents: number;
    approvedCents: number;
    paidCents: number;
  };
}

export function affiliateLink(code: string, base = 'https://quotefleet.net'): string {
  return `${base.replace(/\/$/, '')}/?ref=${encodeURIComponent(code)}`;
}

export async function getAffiliateByCode(code: string): Promise<Affiliate | null> {
  const row = (await db().select().from(affiliates).where(eq(affiliates.code, code)).limit(1))[0];
  return row ?? null;
}

export async function getAffiliateByEmail(email: string): Promise<Affiliate | null> {
  const row = (
    await db().select().from(affiliates).where(eq(affiliates.email, email.toLowerCase())).limit(1)
  )[0];
  return row ?? null;
}

/** Build the full dashboard view-model for one affiliate. */
export async function computeAffiliateDashboard(
  affiliate: Affiliate,
  base = 'https://quotefleet.net'
): Promise<AffiliateDashboard> {
  const [clicksRow, signupsRow, convertedRow, commissionRows] = await Promise.all([
    db()
      .select({ n: count() })
      .from(referralAttributions)
      .where(eq(referralAttributions.code, affiliate.code)),
    db()
      .select({ n: count() })
      .from(referralAttributions)
      .where(
        and(
          eq(referralAttributions.code, affiliate.code),
          isNotNull(referralAttributions.referredTenantId),
          ne(referralAttributions.rewardStatus, 'ignored')
        )
      ),
    db()
      .select({ n: count() })
      .from(referralAttributions)
      .where(
        and(
          eq(referralAttributions.code, affiliate.code),
          isNotNull(referralAttributions.convertedAt)
        )
      ),
    db()
      .select()
      .from(affiliateCommissions)
      .where(eq(affiliateCommissions.affiliateId, affiliate.id)),
  ]);

  const clicks = Number(clicksRow[0]?.n ?? 0);
  const signups = Number(signupsRow[0]?.n ?? 0);
  const convertedCustomers = Number(convertedRow[0]?.n ?? 0);
  // Phase-1: "active referred customers" == linked signups (the tenant is active
  // by default at signup). Phase-2 narrows this to currently-paying tenants.
  const activeReferredCustomers = signups;

  const storedTier = (affiliate.tier as AffiliateTier) ?? 'base';
  const progress = tierProgress(activeReferredCustomers, storedTier);
  // Effective rate: the stored rate wins (honours a hand-set partner rate); fall
  // back to the tier default.
  const rate = affiliate.commissionRate || commissionRateForTier(progress.tier);

  let pendingCents = 0;
  let approvedCents = 0;
  let paidCents = 0;
  for (const c of commissionRows) {
    if (c.status === 'paid') paidCents += c.amountCents;
    else if (c.status === 'approved') approvedCents += c.amountCents;
    else pendingCents += c.amountCents;
  }

  const estimatedMonthlyCents = estimateMonthlyCommissionCents(
    activeReferredCustomers,
    AVG_MONTHLY_REVENUE_CENTS,
    rate
  );

  return {
    affiliate: {
      id: affiliate.id,
      email: affiliate.email,
      name: affiliate.name ?? null,
      code: affiliate.code,
      tier: progress.tier,
      status: affiliate.status,
      commissionRate: rate,
      link: affiliateLink(affiliate.code, base),
      payoutMethod: affiliate.payoutMethod ?? null,
    },
    stats: { clicks, signups, convertedCustomers, activeReferredCustomers },
    tier: progress,
    earnings: { estimatedMonthlyCents, pendingCents, approvedCents, paidCents },
  };
}
