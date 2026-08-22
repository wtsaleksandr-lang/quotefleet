/**
 * Fulfillment core — the money path. Exercises the pure orchestration over
 * STATEFUL fakes that reproduce the real single-flight semantics (conditional
 * UPDATE / ON CONFLICT), so "duplicate webhook delivery" is a genuine second
 * call against mutated state — the exact condition idempotency must survive.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  fulfillReferralConversion,
  toPeriodMonth,
  computeCommissionCents,
  type FulfillmentDeps,
  type AttributionRow,
  type AppliedCredit,
} from './fulfillment.js';

// ── A stateful in-memory world with real single-flight behaviour ────────────
interface World {
  attributions: Record<number, AttributionRow & { referredTenantId: number; convertedAt: Date | null }>;
  credits: Array<{ id: number; sourceAttributionId: number; tenantId: number; monthsGranted: number; status: string; appliedAt: Date | null }>;
  affiliatesByCode: Record<string, { affiliateId: number; rate: number }>;
  commissions: Array<{ affiliateId: number; tenantId: number; periodMonth: string; amountCents: number; rate: number }>;
  grants: AppliedCredit[]; // every grantReferrerMonth invocation
}

function makeWorld(): World {
  return { attributions: {}, credits: [], affiliatesByCode: {}, commissions: [], grants: [] };
}

function depsFor(w: World): FulfillmentDeps {
  return {
    async findAttributionForTenant(tenantId) {
      const a = Object.values(w.attributions).find(
        (r) => r.referredTenantId === tenantId && r.rewardStatus !== 'ignored'
      );
      if (!a) {
        // still surface an ignored one if that's all there is (matches the real
        // query which excludes ignored → returns null, so DON'T return it)
        return null;
      }
      return { id: a.id, code: a.code, kind: a.kind, rewardStatus: a.rewardStatus };
    },
    async markConverted(attributionId, now) {
      const a = w.attributions[attributionId];
      if (!a || a.convertedAt !== null) return false; // single-flight on converted_at IS NULL
      a.convertedAt = now;
      a.rewardStatus = 'converted';
      return true;
    },
    async applyPendingCredit(attributionId, now) {
      const c = w.credits.find((x) => x.sourceAttributionId === attributionId && x.status === 'pending');
      if (!c) return null; // already applied / none → single-flight no-op
      c.status = 'applied';
      c.appliedAt = now;
      return { id: c.id, tenantId: c.tenantId, monthsGranted: c.monthsGranted };
    },
    async grantReferrerMonth(credit) {
      w.grants.push(credit);
      return { status: 'granted', via: 'stripe_balance', amountCents: 1480 };
    },
    async resolveAffiliate(code) {
      return w.affiliatesByCode[code] ?? null;
    },
    async accrueCommission(row) {
      const clash = w.commissions.some(
        (x) => x.affiliateId === row.affiliateId && x.tenantId === row.tenantId && x.periodMonth === row.periodMonth
      );
      if (clash) return false; // ON CONFLICT DO NOTHING
      w.commissions.push({ ...row });
      return true;
    },
  };
}

// ── Seeders ─────────────────────────────────────────────────────────────────
function seedPeer(w: World, tenantId: number, attrId = 1, referrerTenantId = 99) {
  w.attributions[attrId] = {
    id: attrId,
    code: 'PEERCODE',
    kind: 'referral',
    rewardStatus: 'signed_up',
    referredTenantId: tenantId,
    convertedAt: null,
  };
  w.credits.push({
    id: 700,
    sourceAttributionId: attrId,
    tenantId: referrerTenantId,
    monthsGranted: 1,
    status: 'pending',
    appliedAt: null,
  });
}
function seedAffiliate(w: World, tenantId: number, attrId = 2, rate = 0.25) {
  w.attributions[attrId] = {
    id: attrId,
    code: 'AFFCODE',
    kind: 'affiliate',
    rewardStatus: 'signed_up',
    referredTenantId: tenantId,
    convertedAt: null,
  };
  w.affiliatesByCode.AFFCODE = { affiliateId: 8, rate };
}

const FIXED = new Date('2026-08-22T12:00:00.000Z');

let world: World;
let deps: FulfillmentDeps;
beforeEach(() => {
  world = makeWorld();
  deps = depsFor(world);
});

describe('toPeriodMonth / computeCommissionCents (pure)', () => {
  it('formats the billing month as YYYY-MM (UTC)', () => {
    expect(toPeriodMonth(new Date('2026-08-22T23:59:59Z'))).toBe('2026-08');
    expect(toPeriodMonth(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01');
    expect(toPeriodMonth(new Date('2026-12-31T00:00:00Z'))).toBe('2026-12');
  });
  it('commission = round(rate × payment)', () => {
    expect(computeCommissionCents(0.25, 1480)).toBe(370);
    expect(computeCommissionCents(0.3, 3480)).toBe(1044);
    expect(computeCommissionCents(0.25, 1481)).toBe(370); // 370.25 → 370
    expect(computeCommissionCents(0.25, 1482)).toBe(371); // 370.5 → 371 (round half up)
    expect(computeCommissionCents(0.25, 0)).toBe(0);
    expect(computeCommissionCents(-1, 1000)).toBe(0);
  });
});

describe('fulfillReferralConversion — peer referral (kind=referral)', () => {
  it('converts, applies the referrer credit + grants the month — and NO commission', async () => {
    seedPeer(world, 1001);
    const out = await fulfillReferralConversion({ referredTenantId: 1001, paymentAmountCents: 1480 }, deps, FIXED);

    expect(out.handled).toBe(true);
    expect(out.kind).toBe('referral');
    expect(out.markedConverted).toBe(true);
    expect(out.creditApplied).toBe(true);
    expect(out.grant?.status).toBe('granted');
    // conversion stamped
    expect(world.attributions[1].convertedAt).toEqual(FIXED);
    expect(world.attributions[1].rewardStatus).toBe('converted');
    // credit applied exactly once, month granted exactly once
    expect(world.credits[0].status).toBe('applied');
    expect(world.grants).toHaveLength(1);
    // NO affiliate commission for a peer referral
    expect(world.commissions).toHaveLength(0);
    expect(out.commissionAccrued).toBeUndefined();
  });

  it('is idempotent under a DUPLICATE delivery — no double convert, no double credit, no second grant', async () => {
    seedPeer(world, 1001);
    const first = await fulfillReferralConversion({ referredTenantId: 1001, paymentAmountCents: 1480 }, deps, FIXED);
    const dup = await fulfillReferralConversion({ referredTenantId: 1001, paymentAmountCents: 1480 }, deps, new Date(FIXED.getTime() + 5000));

    expect(first.markedConverted).toBe(true);
    expect(first.creditApplied).toBe(true);
    // second delivery: everything no-ops
    expect(dup.handled).toBe(true);
    expect(dup.markedConverted).toBe(false);
    expect(dup.creditApplied).toBe(false);
    expect(dup.grant).toBeUndefined(); // grant only runs on the winning apply
    // world unchanged after the duplicate
    expect(world.credits.filter((c) => c.status === 'applied')).toHaveLength(1);
    expect(world.grants).toHaveLength(1);
    expect(world.attributions[1].convertedAt).toEqual(FIXED); // still the first timestamp
  });
});

describe('fulfillReferralConversion — affiliate (kind=affiliate)', () => {
  it('converts + accrues a commission (round rate×payment) — and NO referrer month', async () => {
    seedAffiliate(world, 2002, 2, 0.25);
    const out = await fulfillReferralConversion({ referredTenantId: 2002, paymentAmountCents: 3480 }, deps, FIXED);

    expect(out.kind).toBe('affiliate');
    expect(out.markedConverted).toBe(true);
    expect(out.commissionAccrued).toBe(true);
    expect(out.commissionAmountCents).toBe(870); // round(0.25 × 3480)
    expect(out.periodMonth).toBe('2026-08');
    expect(world.commissions).toHaveLength(1);
    expect(world.commissions[0]).toMatchObject({ affiliateId: 8, tenantId: 2002, periodMonth: '2026-08', amountCents: 870, rate: 0.25 });
    // NO referrer free month for an affiliate conversion
    expect(world.grants).toHaveLength(0);
    expect(out.creditApplied).toBeUndefined();
  });

  it('accrues at most ONE commission per (affiliate,tenant,month) — duplicate + same-month second payment no-op', async () => {
    seedAffiliate(world, 2002, 2, 0.25);
    const a = await fulfillReferralConversion({ referredTenantId: 2002, paymentAmountCents: 3480 }, deps, FIXED);
    // duplicate delivery of the same invoice
    const dup = await fulfillReferralConversion({ referredTenantId: 2002, paymentAmountCents: 3480 }, deps, FIXED);
    // a DIFFERENT payment later the same month (e.g. proration) — still one row
    const sameMonth = await fulfillReferralConversion({ referredTenantId: 2002, paymentAmountCents: 500 }, deps, new Date('2026-08-30T00:00:00Z'));

    expect(a.commissionAccrued).toBe(true);
    expect(dup.commissionAccrued).toBe(false);
    expect(sameMonth.commissionAccrued).toBe(false);
    expect(world.commissions).toHaveLength(1); // exactly one accrual for the month
    expect(dup.markedConverted).toBe(false); // conversion also idempotent
  });

  it('accrues a NEW row for a later month (recurring commission)', async () => {
    seedAffiliate(world, 2002, 2, 0.3);
    await fulfillReferralConversion({ referredTenantId: 2002, paymentAmountCents: 3480 }, deps, new Date('2026-08-15T00:00:00Z'));
    const next = await fulfillReferralConversion({ referredTenantId: 2002, paymentAmountCents: 3480 }, deps, new Date('2026-09-15T00:00:00Z'));

    expect(next.commissionAccrued).toBe(true);
    expect(world.commissions.map((c) => c.periodMonth).sort()).toEqual(['2026-08', '2026-09']);
    expect(world.commissions).toHaveLength(2);
  });

  it('no-ops the commission when the affiliate can no longer be resolved (deactivated)', async () => {
    world.attributions[2] = { id: 2, code: 'GONECODE', kind: 'affiliate', rewardStatus: 'signed_up', referredTenantId: 2002, convertedAt: null };
    // affiliatesByCode has no GONECODE → resolveAffiliate returns null
    const out = await fulfillReferralConversion({ referredTenantId: 2002, paymentAmountCents: 3480 }, deps, FIXED);
    expect(out.markedConverted).toBe(true); // conversion still recorded
    expect(out.skipped).toBe('affiliate_unresolved');
    expect(world.commissions).toHaveLength(0);
  });
});

describe('fulfillReferralConversion — guards / no-ops', () => {
  it('does nothing when there is no attribution for the tenant', async () => {
    const out = await fulfillReferralConversion({ referredTenantId: 9999, paymentAmountCents: 1480 }, deps, FIXED);
    expect(out.handled).toBe(false);
    expect(out.skipped).toBe('no_attribution');
    expect(world.commissions).toHaveLength(0);
    expect(world.grants).toHaveLength(0);
  });

  it('does nothing for a non-positive (e.g. $0 trial-setup) payment', async () => {
    seedPeer(world, 1001);
    const zero = await fulfillReferralConversion({ referredTenantId: 1001, paymentAmountCents: 0 }, deps, FIXED);
    expect(zero.handled).toBe(false);
    expect(zero.skipped).toBe('non_positive_amount');
    // attribution untouched — NOT converted, credit still pending
    expect(world.attributions[1].convertedAt).toBeNull();
    expect(world.credits[0].status).toBe('pending');
    expect(world.grants).toHaveLength(0);
  });

  it('does nothing for an ignored (self-referral) attribution', async () => {
    world.attributions[3] = { id: 3, code: 'SELF', kind: 'referral', rewardStatus: 'ignored', referredTenantId: 3003, convertedAt: null };
    // findAttributionForTenant excludes ignored → treated as no attribution
    const out = await fulfillReferralConversion({ referredTenantId: 3003, paymentAmountCents: 1480 }, deps, FIXED);
    expect(out.handled).toBe(false);
    expect(out.skipped).toBe('no_attribution');
    expect(world.grants).toHaveLength(0);
  });
});
