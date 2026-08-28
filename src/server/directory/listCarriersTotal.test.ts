/**
 * listCarriers UNFILTERED total — persisted-first short-circuit.
 *
 * THE COST IT REMOVES: with no active facet, listCarriersUnsafe's
 * `select count(*) from carrier_directory` has no WHERE, so Postgres runs a
 * parallel SEQUENTIAL SCAN of the whole 330k-row table. Measured on prod:
 * 12,090 shared buffers, ~86 ms warm — and that ran on EVERY /directory,
 * ?sort=, and ?page= request, i.e. the highest-traffic + most crawled path.
 * The precomputed singleton (directory_aggregate_cache) already stores that
 * exact number as `summary.total`, which getFacetCounts already reads for the
 * unfiltered base facets, so the list total now comes from the same PK lookup.
 *
 * These tests prove:
 *   1. Unfiltered ⇒ the total comes from the persisted singleton and NO
 *      count(*) scan is issued.
 *   2. Filtered ⇒ the live count(*) still runs (the persisted total describes
 *      the whole table and would be wrong).
 *   3. No persisted row ⇒ the live count(*) still runs. The graceful
 *      degradation is unchanged; nothing new can throw.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  /** Persisted singleton row the mocked PK read returns (null → row absent). */
  persistedRow: null as null | Record<string, unknown>,
  /** SQL text of every read issued INSIDE the aggregate transaction. */
  txReads: [] as string[],
  /** Rows resolved for each in-transaction read, in call order. */
  txRowsByCall: [] as Array<Array<Record<string, unknown>>>,
  txCall: 0,
}));

/** A drizzle-ish chain whose `select({...})` shape records what was asked for. */
function chain(label: string): unknown {
  return new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        h.txReads.push(label);
        const rows = h.txRowsByCall[h.txCall++] ?? [];
        const p = Promise.resolve(rows);
        return (p as unknown as Record<string, (...a: unknown[]) => unknown>)[prop as string].bind(p);
      }
      return () => chain(label);
    },
    apply() {
      return chain(label);
    },
  });
}

function makeTx() {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'execute') return () => Promise.resolve([]);
        // `select()` with an explicit projection containing `count(*)` is the
        // total read; `select()` with no args is the ordered page read.
        return (projection?: unknown) =>
          chain(projection && typeof projection === 'object' ? 'count' : 'rows');
      },
    },
  );
}

/** Top-level `db()` — only used by readPersistedAggregates' PK lookup. */
function makeDb() {
  return {
    transaction: (cb: (tx: unknown) => Promise<unknown>) => Promise.resolve().then(() => cb(makeTx())),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(h.persistedRow ? [h.persistedRow] : []),
        }),
      }),
    }),
  };
}

vi.mock('../../db/client.js', () => ({ db: () => makeDb() }));

beforeEach(() => {
  vi.resetModules(); // fresh module-level caches (persistedAggCache et al.)
  h.persistedRow = null;
  h.txReads = [];
  h.txRowsByCall = [];
  h.txCall = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A persisted singleton whose summary.total is deliberately distinct from any
 *  count the live scan would return, so the source of the number is unambiguous. */
const persisted = (total: number) => ({
  summary: { total, intermodalTotal: 7, states: 51, byState: [], byPort: [] },
  baseFacets: {
    fleet: { '1-25': 0, '26-100': 0, '101-500': 0, '500+': 0 },
    drivers: { '1-10': 0, '11-50': 0, '51-250': 0, '250+': 0 },
    equipment: { drayage: 0, dryvan: 0, reefer: 0, hazmat: 0, tanker: 0, flatbed: 0, drybulk: 0 },
    cargo: {},
    goodStanding: 0,
    ports: {},
    authorityActive: 0,
    intermodal: 0,
    recent: 0,
  },
  computedAt: new Date(),
});

describe('listCarriers — UNFILTERED total is served from the precomputed singleton', () => {
  it('uses summary.total and issues NO count(*) scan', async () => {
    h.persistedRow = persisted(330218);
    // Only the ordered page read should run inside the transaction.
    h.txRowsByCall = [[]];
    const q = await import('./queries.js');

    const res = await q.listCarriers({ filters: q.normalizeFilters({}) });

    expect(res.total).toBe(330218);
    expect(h.txReads).toEqual(['rows']); // ← the count scan never ran
  });

  it('keeps working for a sort-only / page-only URL (still the unfiltered base case)', async () => {
    h.persistedRow = persisted(330218);
    h.txRowsByCall = [[]];
    const q = await import('./queries.js');

    const filters = q.normalizeFilters({ sort: 'fleet', dir: 'desc', page: '3' });
    expect(q.isUnfilteredFacets(filters)).toBe(true);
    const res = await q.listCarriers({ filters });

    expect(res.total).toBe(330218);
    expect(h.txReads).toEqual(['rows']);
  });

  it('still runs the LIVE count(*) when a facet is active (the persisted total describes the whole table)', async () => {
    h.persistedRow = persisted(330218);
    h.txRowsByCall = [[{ n: 5767 }], []]; // count, then rows
    const q = await import('./queries.js');

    const res = await q.listCarriers({ filters: q.normalizeFilters({ state: 'WI' }) });

    expect(res.total).toBe(5767); // ← the filtered live count, not 330218
    expect(h.txReads).toEqual(['count', 'rows']);
  });

  it('falls back to the LIVE count(*) when the persisted row is absent (degradation unchanged)', async () => {
    h.persistedRow = null; // cold DB / singleton never populated
    h.txRowsByCall = [[{ n: 330218 }], []];
    const q = await import('./queries.js');

    const res = await q.listCarriers({ filters: q.normalizeFilters({}) });

    expect(res.total).toBe(330218);
    expect(h.txReads).toEqual(['count', 'rows']);
  });

  it('derives totalPages from the persisted total (pagination is unaffected)', async () => {
    h.persistedRow = persisted(100);
    h.txRowsByCall = [[]];
    const q = await import('./queries.js');

    const res = await q.listCarriers({ filters: q.normalizeFilters({}) });

    expect(res.total).toBe(100);
    expect(res.totalPages).toBe(Math.ceil(100 / res.perPage));
  });
});
