/**
 * MRR computation for the super-admin overview (`GET /api/admin/stats`).
 *
 * Drives `computeMrr` — the pure, extracted core the endpoint calls — over a
 * fixture set that mixes every lifecycle: active paying Vital/Pro, trialing,
 * free (never subscribed), and suspended/churned. Proves:
 *   - real MRR = Σ price over ACTIVE, PAST-TRIAL, PAID tenants only;
 *   - a correct per-plan {count, mrr} breakdown;
 *   - trials, free, suspended and churned are EXCLUDED from MRR;
 *   - trialing tenants are reported separately (count + potential pipeline).
 *
 * Fail-without / pass-with: if trials (or suspended/churned) leaked into the
 * sum, `mrr` would exceed 64.4 and the exclusion assertions would fail.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';

// admin.ts imports the db client at module load; mock it so importing the
// route module never opens a real connection (mirrors adminHardening.test.ts).
vi.mock('../../db/client.js', () => ({
  db: () => ({
    select: () => ({ from: () => Promise.resolve([]) }),
  }),
}));

beforeEach(() => {
  process.env.SESSION_SECRET ||= 'test'.repeat(16);
  process.env.DATABASE_URL ||= 'postgresql://x';
  process.env.ANTHROPIC_API_KEY ||= 'sk-test';
});

const VITAL = 14.8;
const PRO = 34.8;

// Trial-window helpers relative to now (isTrialing compares getTime() > Date.now()).
const future = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const past = () => new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

/** A representative mix covering every branch of the MRR rules. */
const fixture = () => [
  // — real paying MRR: active, past-trial, paid —
  { plan: 'vital', status: 'active', trialEndsAt: null }, //           +Vital
  { plan: 'vital', status: 'active', trialEndsAt: past() }, //         +Vital (trial ended)
  { plan: 'pro', status: 'active', trialEndsAt: null }, //             +Pro
  // — trialing: active but still inside the free window → pipeline only —
  { plan: 'pro', status: 'active', trialEndsAt: future() }, //         trial (→Pro)
  { plan: 'vital', status: 'active', trialEndsAt: future() }, //       trial (→Vital)
  { plan: 'free', status: 'active', trialEndsAt: future() }, //        trial (free→defaults Vital)
  // — never paying —
  { plan: 'free', status: 'active', trialEndsAt: null }, //            free, excluded
  // — not active: never billed, and never trial-counted either —
  { plan: 'pro', status: 'suspended', trialEndsAt: null }, //          suspended, excluded
  { plan: 'vital', status: 'churned', trialEndsAt: null }, //          churned, excluded
  { plan: 'pro', status: 'suspended', trialEndsAt: future() }, //      suspended-in-trial, excluded
];

describe('computeMrr — real revenue vs. trial pipeline', () => {
  it('sums only active, past-trial, paid tenants into MRR', async () => {
    const { computeMrr } = await import('./admin.js');
    const r = computeMrr(fixture());

    // 2 Vital (29.60) + 1 Pro (34.80) = 64.40
    expect(r.byPlan.vital).toEqual({ count: 2, mrr: 29.6 });
    expect(r.byPlan.pro).toEqual({ count: 1, mrr: 34.8 });
    expect(r.mrr).toBe(64.4);
  });

  it('reports trialing tenants separately and never in MRR', async () => {
    const { computeMrr } = await import('./admin.js');
    const r = computeMrr(fixture());

    // 3 active trialing tenants; a free/unset selection defaults to Vital.
    expect(r.trialingCount).toBe(3);
    expect(r.potentialTrialMrr).toBe(roundTo2(PRO + VITAL + VITAL)); // 34.8 + 14.8 + 14.8 = 64.4

    // The trial slice is NOT double-counted into recognized MRR.
    expect(r.mrr).toBe(64.4);
  });

  it('excludes free, suspended and churned tenants from MRR', async () => {
    const { computeMrr } = await import('./admin.js');
    // Only non-paying rows — MRR and the paid counts must all be zero.
    const r = computeMrr([
      { plan: 'free', status: 'active', trialEndsAt: null },
      { plan: 'pro', status: 'suspended', trialEndsAt: null },
      { plan: 'vital', status: 'churned', trialEndsAt: null },
    ]);
    expect(r.mrr).toBe(0);
    expect(r.byPlan.vital.count).toBe(0);
    expect(r.byPlan.pro.count).toBe(0);
    expect(r.trialingCount).toBe(0);
    expect(r.potentialTrialMrr).toBe(0);
  });

  it('normalizes legacy plan ids (starter→Vital, enterprise→Pro)', async () => {
    const { computeMrr } = await import('./admin.js');
    const r = computeMrr([
      { plan: 'starter', status: 'active', trialEndsAt: null },
      { plan: 'enterprise', status: 'active', trialEndsAt: null },
    ]);
    expect(r.byPlan.vital).toEqual({ count: 1, mrr: VITAL });
    expect(r.byPlan.pro).toEqual({ count: 1, mrr: PRO });
    expect(r.mrr).toBe(roundTo2(VITAL + PRO));
  });

  it('empty tenant set → all zeros', async () => {
    const { computeMrr } = await import('./admin.js');
    const r = computeMrr([]);
    expect(r).toEqual({
      mrr: 0,
      byPlan: { vital: { count: 0, mrr: 0 }, pro: { count: 0, mrr: 0 } },
      trialingCount: 0,
      potentialTrialMrr: 0,
    });
  });
});

function roundTo2(n: number): number {
  return Math.round(n * 100) / 100;
}
