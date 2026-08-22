/**
 * Referral/affiliate FULFILLMENT — delivers the value the programs only tracked.
 *
 * When a REFERRED tenant makes a REAL payment (trial→active conversion or any
 * subsequent paid invoice), three things must happen automatically:
 *
 *   1. CONVERSION — stamp the attribution's `convertedAt` + advance rewardStatus
 *      (signed_up → converted). Once only.
 *   2. REFERRER FREE MONTH (peer referral, kind='referral' ONLY) — flip the queued
 *      `referral_credits` row pending → applied, then GRANT the month (a Stripe
 *      customer-balance credit; see applyReferrerCreditToStripe). Once only.
 *   3. AFFILIATE COMMISSION (public affiliate, kind='affiliate' ONLY) — ACCRUE one
 *      `affiliate_commissions` row for the (affiliate, tenant, YYYY-MM), amount =
 *      round(rate × the paid amount). The cash PAYOUT stays out of scope (needs
 *      Stripe Connect — Alex's); we only record what is owed. Once per month.
 *
 * MONEY-SENSITIVE — idempotency is the #1 requirement. Every step is single-flight
 * so a re-delivered / duplicated webhook (Stripe delivers at-least-once) can never
 * double-apply:
 *   • conversion:  UPDATE … WHERE converted_at IS NULL   (at most one stamp)
 *   • credit:      UPDATE … WHERE status='pending'       (at most one apply)
 *   • commission:  INSERT … ON CONFLICT DO NOTHING       (unique affiliate/tenant/month)
 * The Stripe grant runs ONLY on the call that won the credit single-flight, so it
 * is at-most-once even under concurrent duplicate deliveries.
 *
 * The core (`fulfillReferralConversion`) is PURE orchestration over injected
 * IO seams (DB + Stripe) so the idempotency/branching logic is unit-tested with no
 * infrastructure. `runReferralFulfillmentForInvoice` wires the real seams and is
 * called (non-fatally) from the Stripe webhook's payment-success path.
 */
import type Stripe from 'stripe';
import { and, desc, eq, isNull, ne } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  referralAttributions,
  referralCredits,
  affiliateCommissions,
  affiliates,
  tenants,
} from '../../db/schema.js';
import { PLAN_PRICES_USD } from '../plans.js';

export type FulfillmentKind = 'referral' | 'affiliate';

/** The linked attribution a paying tenant converted through. */
export interface AttributionRow {
  id: number;
  code: string;
  kind: string;
  rewardStatus: string;
}

/** A `referral_credits` row that THIS call flipped pending → applied. */
export interface AppliedCredit {
  id: number;
  /** The REFERRER tenant that earns the free month. */
  tenantId: number;
  monthsGranted: number;
}

/** Outcome of granting the referrer's free month (step 2). */
export type ReferrerGrantResult =
  | { status: 'granted'; via: 'stripe_balance'; amountCents: number }
  | { status: 'recorded'; reason: 'stripe_disabled' | 'no_customer' | 'no_resolvable_price' }
  | { status: 'error'; message: string };

/** IO seams the pure core drives. Real impls in `makeFulfillmentDeps`; tests
 *  inject fakes to exercise every idempotency path with no DB/Stripe. */
export interface FulfillmentDeps {
  /** The linked, non-ignored attribution for a referred tenant, or null. */
  findAttributionForTenant(tenantId: number): Promise<AttributionRow | null>;
  /** Single-flight conversion stamp. Returns true only when THIS call performed
   *  it (converted_at was NULL); false when a prior delivery already converted. */
  markConverted(attributionId: number, now: Date): Promise<boolean>;
  /** Single-flight credit apply. Returns the applied row only when THIS call
   *  flipped it pending → applied; null when none pending / already applied. */
  applyPendingCredit(attributionId: number, now: Date): Promise<AppliedCredit | null>;
  /** Grant the referrer's month for a credit THIS call just applied. */
  grantReferrerMonth(credit: AppliedCredit, now: Date): Promise<ReferrerGrantResult>;
  /** Resolve the ACTIVE affiliate (+ authoritative rate) for a code, or null. */
  resolveAffiliate(code: string): Promise<{ affiliateId: number; rate: number } | null>;
  /** Accrue a commission, ON CONFLICT (affiliate,tenant,month) DO NOTHING.
   *  Returns true only when a NEW row was inserted. */
  accrueCommission(row: {
    affiliateId: number;
    tenantId: number;
    periodMonth: string;
    amountCents: number;
    rate: number;
  }): Promise<boolean>;
}

export interface FulfillmentInput {
  referredTenantId: number;
  /** The amount actually paid, in cents (invoice.amount_paid). */
  paymentAmountCents: number;
}

export interface FulfillmentResult {
  handled: boolean;
  skipped?:
    | 'non_positive_amount'
    | 'no_attribution'
    | 'ignored'
    | 'unknown_kind'
    | 'affiliate_unresolved';
  attributionId?: number;
  kind?: FulfillmentKind;
  /** True when THIS call stamped the conversion (false = duplicate delivery). */
  markedConverted?: boolean;
  /** referral: whether THIS call applied the pending credit (false = duplicate). */
  creditApplied?: boolean;
  grant?: ReferrerGrantResult;
  /** affiliate: whether THIS call inserted a new commission (false = ON CONFLICT). */
  commissionAccrued?: boolean;
  commissionAmountCents?: number;
  periodMonth?: string;
}

/** 'YYYY-MM' for a date, in UTC (billing month key). */
export function toPeriodMonth(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** Commission cents = round(rate × paid). Integer money — never a float. */
export function computeCommissionCents(rate: number, paymentAmountCents: number): number {
  return Math.round(Math.max(0, rate) * Math.max(0, paymentAmountCents));
}

/**
 * PURE CORE — decide + drive the three fulfillment steps over injected seams.
 * Never throws (each seam is expected to resolve); callers still wrap it so a
 * seam rejection can never break the webhook. Fully idempotent: safe to call for
 * every paid invoice and for duplicate deliveries of the same invoice.
 */
export async function fulfillReferralConversion(
  input: FulfillmentInput,
  deps: FulfillmentDeps,
  now: Date = new Date()
): Promise<FulfillmentResult> {
  // Only a REAL (positive) payment counts as a conversion — the $0 trial-setup
  // invoice must not convert, credit, or accrue anything.
  if (!(input.paymentAmountCents > 0)) {
    return { handled: false, skipped: 'non_positive_amount' };
  }

  const attribution = await deps.findAttributionForTenant(input.referredTenantId);
  if (!attribution) return { handled: false, skipped: 'no_attribution' };
  if (attribution.rewardStatus === 'ignored') {
    return { handled: false, skipped: 'ignored', attributionId: attribution.id };
  }

  const kind = attribution.kind === 'affiliate' ? 'affiliate' : attribution.kind === 'referral' ? 'referral' : null;
  if (!kind) {
    return { handled: false, skipped: 'unknown_kind', attributionId: attribution.id };
  }

  // ── Step 1: mark conversion (single-flight on converted_at IS NULL) ─────────
  const markedConverted = await deps.markConverted(attribution.id, now);

  const result: FulfillmentResult = {
    handled: true,
    attributionId: attribution.id,
    kind,
    markedConverted,
  };

  if (kind === 'referral') {
    // ── Step 2: apply the referrer's queued free-month credit (single-flight) ─
    const credit = await deps.applyPendingCredit(attribution.id, now);
    result.creditApplied = !!credit;
    if (credit) {
      // Only the call that WON the pending→applied flip grants the month, so the
      // grant is at-most-once even under duplicate delivery.
      result.grant = await deps.grantReferrerMonth(credit, now);
    }
    return result;
  }

  // ── Step 3: accrue the affiliate commission (ON CONFLICT DO NOTHING) ────────
  const aff = await deps.resolveAffiliate(attribution.code);
  if (!aff) {
    result.skipped = 'affiliate_unresolved';
    return result;
  }
  const periodMonth = toPeriodMonth(now);
  const amountCents = computeCommissionCents(aff.rate, input.paymentAmountCents);
  const commissionAccrued = await deps.accrueCommission({
    affiliateId: aff.affiliateId,
    tenantId: input.referredTenantId,
    periodMonth,
    amountCents,
    rate: aff.rate,
  });
  result.commissionAccrued = commissionAccrued;
  result.commissionAmountCents = amountCents;
  result.periodMonth = periodMonth;
  return result;
}

// ────────────────────────────────────────────────────────────────────────────
// REAL IO seams (DB + Stripe).
// ────────────────────────────────────────────────────────────────────────────

/**
 * GRANTING THE REFERRER'S FREE MONTH — the seam the billing owner controls.
 *
 * Chosen mechanism: a **Stripe customer-balance credit** (a negative balance =
 * a credit consumed by the referrer's next invoice) for one month of THEIR plan
 * price. This is the correct primitive: it needs no coupon, applies to the next
 * charge whenever it lands, and is a pure account credit (a discount to an
 * existing customer — NOT a cash-out), so it is in scope here.
 *
 * SAFETY: applying live money blind is unsafe when the referrer isn't cleanly
 * resolvable — a free/trialing referrer has no `stripeCustomerId` and no month
 * price to value the credit at. So:
 *   • Live Stripe credit is gated behind opt-in `AFFILIATE_REFERRER_CREDIT_STRIPE=1`
 *     (the billing owner enables it once reviewed). Default = record intent only.
 *   • Even when enabled, it only fires when the referrer has a stripeCustomerId
 *     AND a resolvable paid-plan price; otherwise the credit stays flipped to
 *     `applied` and we record the intended grant for manual/later fulfillment.
 * Either way the `referral_credits` row is already `applied` (single-flighted by
 * the caller), so the reward is delivered at-most-once. When the live credit is
 * disabled/unresolvable we return `status:'recorded'` — the credit is owed and
 * logged, not silently dropped.
 */
export async function applyReferrerCreditToStripe(
  credit: AppliedCredit,
  stripe: Stripe | null,
  now: Date = new Date()
): Promise<ReferrerGrantResult> {
  const enabled = process.env.AFFILIATE_REFERRER_CREDIT_STRIPE === '1';
  if (!enabled || !stripe) {
    return { status: 'recorded', reason: 'stripe_disabled' };
  }
  try {
    const t = (
      await db()
        .select({ customerId: tenants.stripeCustomerId, plan: tenants.plan })
        .from(tenants)
        .where(eq(tenants.id, credit.tenantId))
        .limit(1)
    )[0];
    if (!t?.customerId) return { status: 'recorded', reason: 'no_customer' };
    const priceUsd =
      t.plan === 'pro' ? PLAN_PRICES_USD.pro : t.plan === 'vital' ? PLAN_PRICES_USD.vital : null;
    if (priceUsd == null) return { status: 'recorded', reason: 'no_resolvable_price' };
    const months = Math.max(1, credit.monthsGranted || 1);
    const amountCents = Math.round(priceUsd * 100) * months;
    // Negative amount = a credit toward the customer's next invoice.
    await stripe.customers.createBalanceTransaction(t.customerId, {
      amount: -amountCents,
      currency: 'usd',
      description: `Referral reward: ${months} free month${months === 1 ? '' : 's'} (credit #${credit.id})`,
    });
    return { status: 'granted', via: 'stripe_balance', amountCents };
  } catch (err) {
    console.error('[affiliate.fulfillment] Stripe referrer-credit grant failed:', err);
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

/** Build the real DB/Stripe-backed seams for `fulfillReferralConversion`. */
export function makeFulfillmentDeps(stripe: Stripe | null): FulfillmentDeps {
  return {
    async findAttributionForTenant(tenantId) {
      const row = (
        await db()
          .select({
            id: referralAttributions.id,
            code: referralAttributions.code,
            kind: referralAttributions.kind,
            rewardStatus: referralAttributions.rewardStatus,
          })
          .from(referralAttributions)
          .where(
            and(
              eq(referralAttributions.referredTenantId, tenantId),
              ne(referralAttributions.rewardStatus, 'ignored')
            )
          )
          .orderBy(desc(referralAttributions.landedAt))
          .limit(1)
      )[0];
      return row ?? null;
    },

    async markConverted(attributionId, now) {
      // Single-flight: only stamps when converted_at is still NULL.
      const rows = await db()
        .update(referralAttributions)
        .set({ convertedAt: now, rewardStatus: 'converted' })
        .where(
          and(eq(referralAttributions.id, attributionId), isNull(referralAttributions.convertedAt))
        )
        .returning({ id: referralAttributions.id });
      return rows.length > 0;
    },

    async applyPendingCredit(attributionId, now) {
      // Single-flight: the conditional WHERE status='pending' means a duplicate
      // delivery matches 0 rows and returns null — never a second apply.
      const rows = await db()
        .update(referralCredits)
        .set({ status: 'applied', appliedAt: now })
        .where(
          and(
            eq(referralCredits.sourceAttributionId, attributionId),
            eq(referralCredits.status, 'pending')
          )
        )
        .returning({
          id: referralCredits.id,
          tenantId: referralCredits.tenantId,
          monthsGranted: referralCredits.monthsGranted,
        });
      return rows[0] ?? null;
    },

    async grantReferrerMonth(credit, now) {
      return applyReferrerCreditToStripe(credit, stripe, now);
    },

    async resolveAffiliate(code) {
      const a = (
        await db()
          .select({
            id: affiliates.id,
            rate: affiliates.commissionRate,
            status: affiliates.status,
          })
          .from(affiliates)
          .where(eq(affiliates.code, code))
          .limit(1)
      )[0];
      if (!a || a.status !== 'active') return null;
      return { affiliateId: a.id, rate: a.rate };
    },

    async accrueCommission(row) {
      // The UNIQUE (affiliate_id, tenant_id, period_month) index makes a
      // re-delivered webhook or a second payment in the same month a no-op.
      const inserted = await db()
        .insert(affiliateCommissions)
        .values({
          affiliateId: row.affiliateId,
          tenantId: row.tenantId,
          periodMonth: row.periodMonth,
          amountCents: row.amountCents,
          rate: row.rate,
          status: 'pending',
        })
        .onConflictDoNothing({
          target: [
            affiliateCommissions.affiliateId,
            affiliateCommissions.tenantId,
            affiliateCommissions.periodMonth,
          ],
        })
        .returning({ id: affiliateCommissions.id });
      return inserted.length > 0;
    },
  };
}

/**
 * Webhook entry point — run fulfillment for a SUCCEEDED subscription invoice.
 * Resolves the referred tenant from the Stripe customer, reads the paid amount,
 * and drives the pure core with real seams. Best-effort + fully self-contained:
 * NEVER throws (callers still wrap it), so it can't break the billing webhook.
 */
export async function runReferralFulfillmentForInvoice(
  invoice: Stripe.Invoice,
  stripe: Stripe | null
): Promise<FulfillmentResult | null> {
  try {
    const customerId = invoice.customer != null ? String(invoice.customer) : null;
    if (!customerId) return null;
    const amountPaid = typeof invoice.amount_paid === 'number' ? invoice.amount_paid : 0;
    if (!(amountPaid > 0)) return { handled: false, skipped: 'non_positive_amount' };

    const t = (
      await db()
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.stripeCustomerId, customerId))
        .limit(1)
    )[0];
    if (!t) return null;

    const out = await fulfillReferralConversion(
      { referredTenantId: t.id, paymentAmountCents: amountPaid },
      makeFulfillmentDeps(stripe)
    );
    if (out.handled) {
      console.log(
        `[affiliate.fulfillment] tenant ${t.id} kind=${out.kind} converted=${out.markedConverted}` +
          (out.kind === 'referral'
            ? ` creditApplied=${out.creditApplied} grant=${out.grant?.status ?? 'n/a'}`
            : ` commissionAccrued=${out.commissionAccrued} amount=${out.commissionAmountCents} month=${out.periodMonth}`)
      );
    }
    return out;
  } catch (err) {
    console.error('[affiliate.fulfillment] runReferralFulfillmentForInvoice failed (non-fatal):', err);
    return null;
  }
}
