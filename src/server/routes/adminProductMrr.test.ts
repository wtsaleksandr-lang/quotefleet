/**
 * Product-line MRR — the two per-shipper revenue lines (Directory Pro $19/mo and
 * Manifest Privacy annual $79/$249/$599 ÷ 12) that `computeMrr` was blind to.
 *
 * Proves computeProductMrr:
 *   - counts ONLY active, in-period, NON-comp subscriptions;
 *   - amortizes each annual manifest tier to a monthly figure;
 *   - excludes trialing / past_due / inactive / comped / lapsed rows;
 *   - reports a correct per-tier manifest breakdown and a combined total.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';

// admin.ts imports the db client + Stripe at module load; mock db so importing
// the route module never opens a real connection (mirrors adminMrr.test.ts).
vi.mock('../../db/client.js', () => ({
  db: () => ({ select: () => ({ from: () => Promise.resolve([]) }) }),
}));

beforeEach(() => {
  process.env.SESSION_SECRET ||= 'test'.repeat(16);
  process.env.DATABASE_URL ||= 'postgresql://x';
  process.env.ANTHROPIC_API_KEY ||= 'sk-test';
});

const future = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
const past = () => new Date(Date.now() - 24 * 60 * 60 * 1000);
const r2 = (n: number) => Math.round(n * 100) / 100;

describe('computeProductMrr — Directory Pro + Manifest Privacy', () => {
  it('sums active in-period non-comp subs across both products', async () => {
    const { computeProductMrr } = await import('./admin.js');
    const directory = [
      { status: 'active', currentPeriodEnd: future(), comp: false }, // +19
      { status: 'active', currentPeriodEnd: null, comp: false }, //     +19 (no end = live)
    ];
    const manifest = [
      { status: 'active', currentPeriodEnd: future(), comp: false, tier: 'basic' }, //        79/12
      { status: 'active', currentPeriodEnd: future(), comp: false, tier: 'professional' }, // 249/12
      { status: 'active', currentPeriodEnd: future(), comp: false, tier: 'enterprise' }, //   599/12
    ];
    const out = computeProductMrr(directory, manifest);

    expect(out.directory).toEqual({ activeCount: 2, mrr: 38 });
    expect(out.manifest.activeCount).toBe(3);
    expect(out.manifest.byTier.basic).toEqual({ count: 1, mrr: r2(79 / 12) });
    expect(out.manifest.byTier.professional).toEqual({ count: 1, mrr: r2(249 / 12) });
    expect(out.manifest.byTier.enterprise).toEqual({ count: 1, mrr: r2(599 / 12) });
    expect(out.manifest.mrr).toBe(r2(79 / 12 + 249 / 12 + 599 / 12));
    expect(out.total).toBe(r2(38 + 79 / 12 + 249 / 12 + 599 / 12));
  });

  it('excludes trialing, past_due, inactive, comped and lapsed rows', async () => {
    const { computeProductMrr } = await import('./admin.js');
    const directory = [
      { status: 'trialing', currentPeriodEnd: future(), comp: false }, // trial → excluded
      { status: 'past_due', currentPeriodEnd: future(), comp: false }, // grace → excluded
      { status: 'inactive', currentPeriodEnd: future(), comp: false }, // excluded
      { status: 'active', currentPeriodEnd: future(), comp: true }, //   comp → not revenue
      { status: 'active', currentPeriodEnd: past(), comp: false }, //    lapsed period → excluded
    ];
    const manifest = [
      { status: 'active', currentPeriodEnd: future(), comp: true, tier: 'enterprise' }, // comp
      { status: 'trialing', currentPeriodEnd: future(), comp: false, tier: 'basic' }, //  trial
    ];
    const out = computeProductMrr(directory, manifest);
    expect(out.directory).toEqual({ activeCount: 0, mrr: 0 });
    expect(out.manifest.activeCount).toBe(0);
    expect(out.manifest.mrr).toBe(0);
    expect(out.total).toBe(0);
  });

  it('defaults an unknown manifest tier to basic', async () => {
    const { computeProductMrr } = await import('./admin.js');
    const out = computeProductMrr([], [
      { status: 'active', currentPeriodEnd: null, comp: false, tier: 'mystery' },
    ]);
    expect(out.manifest.byTier.basic).toEqual({ count: 1, mrr: r2(79 / 12) });
    expect(out.manifest.activeCount).toBe(1);
  });

  it('empty inputs → all zeros', async () => {
    const { computeProductMrr } = await import('./admin.js');
    const out = computeProductMrr([], []);
    expect(out.total).toBe(0);
    expect(out.directory).toEqual({ activeCount: 0, mrr: 0 });
    expect(out.manifest.mrr).toBe(0);
  });
});
