/**
 * Super-admin affiliate management — the PATCH validation/diff core and the
 * DB-touching route core.
 *
 *   - `planAffiliateUpdate` (PURE): Zod-validates status/tier/commissionRate,
 *     rejects bad enums / out-of-range rate / empty body / a no-op (all values
 *     equal current) with a 400, and otherwise returns ONLY the changed columns
 *     plus a before→after diff.
 *   - `patchAffiliateAdmin`: 400 on a non-numeric id, 404 on an id that matches
 *     no row, and on success writes only the changed columns + an
 *     `affiliate.update` audit row (before→after) scoped to the owner tenant.
 *
 * Drives the extracted cores against a mocked db (same pattern as
 * adminExtendTrial.test.ts).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────
const h = vi.hoisted(() => {
  const state = {
    affiliateRows: [] as Record<string, unknown>[],
    inserts: [] as Array<{ table: string; values: Record<string, unknown> }>,
  };
  return { state };
});

vi.mock('../../db/client.js', async () => {
  const { getTableName } = await import('drizzle-orm');
  function rowsFor(table: unknown): Record<string, unknown>[] {
    return getTableName(table as never) === 'affiliates' ? h.state.affiliateRows : [];
  }
  function makeSelect() {
    let table: unknown;
    const chain: Record<string, unknown> = {
      from(t: unknown) { table = t; return chain; },
      where() { return chain; },
      orderBy() { return chain; },
      limit() { return Promise.resolve(rowsFor(table)); },
      then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
        return Promise.resolve(rowsFor(table)).then(res, rej);
      },
    };
    return chain;
  }
  function makeUpdate() {
    let patch: Record<string, unknown> = {};
    const chain: Record<string, unknown> = {
      set(v: Record<string, unknown>) { patch = v; return chain; },
      where() { return chain; },
      // .returning() reflects the patch onto whatever affiliate rows matched —
      // an empty affiliateRows set means 0 affected rows (the 404 race path).
      returning() {
        return Promise.resolve(h.state.affiliateRows.map((r) => ({ ...r, ...patch })));
      },
    };
    return chain;
  }
  return {
    db: () => ({
      select: () => makeSelect(),
      update: () => makeUpdate(),
      insert: (t: unknown) => ({
        values: (v: Record<string, unknown>) => {
          h.state.inserts.push({ table: getTableName(t as never), values: v });
          return Promise.resolve();
        },
      }),
    }),
  };
});

const baseAffiliate = (over?: Record<string, unknown>) => ({
  id: 5,
  ownerTenantId: 11,
  ownerUserId: null,
  email: 'partner@example.com',
  name: 'Partner Co',
  code: 'PARTNER1',
  tier: 'base',
  commissionRate: 0.25,
  status: 'active',
  payoutMethod: 'paypal',
  ...over,
});

beforeEach(() => {
  h.state.affiliateRows = [baseAffiliate()];
  h.state.inserts = [];
  process.env.SESSION_SECRET ||= 'test'.repeat(16);
  process.env.DATABASE_URL ||= 'postgresql://x';
  process.env.ANTHROPIC_API_KEY ||= 'sk-test';
});

const auditRows = () => h.state.inserts.filter((i) => i.table === 'audit_log');

// ── planAffiliateUpdate — pure validation + diff ─────────────────────
describe('planAffiliateUpdate — validation', () => {
  const before = { status: 'active', tier: 'base', commissionRate: 0.25 };

  it('rejects an empty body (no fields) with 400', async () => {
    const { planAffiliateUpdate } = await import('./admin.js');
    const r = planAffiliateUpdate(before, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it.each(['pendingx', 'deleted', 'ACTIVE', 42])('rejects a bad status %p with 400', async (bad) => {
    const { planAffiliateUpdate } = await import('./admin.js');
    const r = planAffiliateUpdate(before, { status: bad });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it.each(['gold', 'gold-tier', 5])('rejects a bad tier %p with 400', async (bad) => {
    const { planAffiliateUpdate } = await import('./admin.js');
    const r = planAffiliateUpdate(before, { tier: bad });
    expect(r.ok).toBe(false);
  });

  it.each([-0.1, 1.5, 2, -1])('rejects an out-of-range rate %p with 400', async (bad) => {
    const { planAffiliateUpdate } = await import('./admin.js');
    const r = planAffiliateUpdate(before, { commissionRate: bad });
    expect(r.ok).toBe(false);
  });

  it('rejects a no-op (all submitted values equal current) with 400', async () => {
    const { planAffiliateUpdate } = await import('./admin.js');
    const r = planAffiliateUpdate(before, { status: 'active', tier: 'base', commissionRate: 0.25 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });
});

describe('planAffiliateUpdate — diff computes ONLY changed columns', () => {
  const before = { status: 'active', tier: 'base', commissionRate: 0.25 };

  it('returns set + before→after only for fields that actually differ', async () => {
    const { planAffiliateUpdate } = await import('./admin.js');
    // tier changes, status is present-but-unchanged → only tier in the diff.
    const r = planAffiliateUpdate(before, { status: 'active', tier: 'partner' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.set).toEqual({ tier: 'partner' });
      expect(r.changed).toEqual({ tier: { before: 'base', after: 'partner' } });
    }
  });

  it('accepts a valid boundary rate (0 and 1) and multi-field change', async () => {
    const { planAffiliateUpdate } = await import('./admin.js');
    const r = planAffiliateUpdate(before, { status: 'suspended', commissionRate: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.set).toEqual({ status: 'suspended', commissionRate: 1 });
      expect(r.changed.commissionRate).toEqual({ before: 0.25, after: 1 });
    }
  });
});

// ── patchAffiliateAdmin — DB-touching route core ─────────────────────
describe('patchAffiliateAdmin — status transition + audit', () => {
  it('suspends an affiliate (200) and writes a scoped affiliate.update audit', async () => {
    const { patchAffiliateAdmin } = await import('./admin.js');
    const r = await patchAffiliateAdmin({ id: 5, body: { status: 'suspended' }, actorUserId: 99 });
    expect(r.status).toBe(200);
    expect((r.json as { ok?: boolean }).ok).toBe(true);
    const affiliate = (r.json as { affiliate?: Record<string, unknown> }).affiliate;
    expect(affiliate?.status).toBe('suspended');

    const audits = auditRows();
    expect(audits).toHaveLength(1);
    const rowVals = audits[0].values;
    expect(rowVals.action).toBe('affiliate.update');
    expect(rowVals.actorKind).toBe('super_admin');
    expect(rowVals.userId).toBe(99);
    expect(rowVals.tenantId).toBe(11); // scoped to the owner tenant
    const details = rowVals.detailsJson as Record<string, unknown>;
    expect(details.affiliateId).toBe(5);
    expect(details.changed).toEqual({ status: { before: 'active', after: 'suspended' } });
  });

  it('grants the partner tier with a negotiated rate in one PATCH', async () => {
    const { patchAffiliateAdmin } = await import('./admin.js');
    const r = await patchAffiliateAdmin({ id: 5, body: { tier: 'partner', commissionRate: 0.4 }, actorUserId: 1 });
    expect(r.status).toBe(200);
    const details = auditRows()[0].values.detailsJson as Record<string, unknown>;
    expect(details.changed).toEqual({
      tier: { before: 'base', after: 'partner' },
      commissionRate: { before: 0.25, after: 0.4 },
    });
  });

  it('400 on a non-numeric id and writes no audit', async () => {
    const { patchAffiliateAdmin } = await import('./admin.js');
    const r = await patchAffiliateAdmin({ id: 'abc', body: { status: 'active' }, actorUserId: 1 });
    expect(r.status).toBe(400);
    expect(auditRows()).toHaveLength(0);
  });

  it('404 when the id matches no affiliate, and writes no audit', async () => {
    h.state.affiliateRows = [];
    const { patchAffiliateAdmin } = await import('./admin.js');
    const r = await patchAffiliateAdmin({ id: 777, body: { status: 'active' }, actorUserId: 1 });
    expect(r.status).toBe(404);
    expect(String((r.json as { error?: unknown }).error)).toContain('777');
    expect(auditRows()).toHaveLength(0);
  });

  it('400 on an invalid body for an existing affiliate, and writes no audit', async () => {
    const { patchAffiliateAdmin } = await import('./admin.js');
    const r = await patchAffiliateAdmin({ id: 5, body: { status: 'nope' }, actorUserId: 1 });
    expect(r.status).toBe(400);
    expect(auditRows()).toHaveLength(0);
  });
});
