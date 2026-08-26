/**
 * Persisted directory aggregates — the DURABLE fix for the recurring
 * all-QuoteFleet-domains-down outage (every request hanging ~20s → HTTP 000).
 *
 * Root cause: even with the TTL cache (#406), SWR + single-flight (#407) and the
 * per-statement timeout + limiter (#409), the global directory SUMMARY and the
 * UNFILTERED base FACET COUNTS were still COMPUTED on the request path over the
 * ~330k-row carrier_directory table. A cold-cache burst after every deploy
 * stampeded the small Neon compute + pool. This layer PRECOMPUTES + PERSISTS the
 * two global aggregates in a single row (directory_aggregate_cache) OFF the
 * request path; the request path then serves them from a single-row PK lookup and
 * never runs the scan.
 *
 * These tests prove:
 *   (a) request path returns the PERSISTED row WITHOUT hitting the live aggregate
 *       (no transaction opened) when the row is fresh;
 *   (b) request path FALLS BACK to the live compute when the persisted row is
 *       absent (cold DB / never populated) — #406/#407/#409 path intact;
 *   (c) the populate path (ingest / cron / boot) computes + WRITES a valid row,
 *       and ensureFreshDirectoryAggregates only recomputes when missing/stale.
 *
 * The DB client is mocked: top-level `db().select(...)` is ONLY the persisted-row
 * PK read (the live aggregates use `db().transaction(...)`), so a transaction
 * counter cleanly proves whether the heavy scan ran. `db().insert(...)` captures
 * the upserted singleton row.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  /** 'ok' → transaction reads resolve canned rows; 'throw' → reject with 57014. */
  mode: 'ok' as 'ok' | 'throw',
  now: 5_000_000,
  /** Rows the persisted-row PK read resolves to ([] = row absent). */
  persistedRows: [] as Array<Record<string, unknown>>,
  /** Canned rows per transaction terminal read, in call order (null → []). */
  rowsByCall: null as null | Array<Array<Record<string, unknown>>>,
  /** Terminal-read counter for rowsByCall indexing. */
  call: 0,
  /** How many db().transaction(...) calls happened (i.e. live scans opened). */
  transactionCalls: 0,
  /** How many top-level db().select(...) calls happened (persisted PK reads). */
  selectCalls: 0,
  /** Captured upsert payloads from db().insert().values(...). */
  inserted: [] as Array<Record<string, unknown>>,
}));

function timeoutError(): Error {
  const e = new Error('canceling statement due to statement timeout') as Error & { code?: string };
  e.code = '57014';
  return e;
}

function terminalResult(): Promise<unknown> {
  const i = h.call++;
  if (h.mode === 'throw') return Promise.reject(timeoutError());
  return Promise.resolve(h.rowsByCall ? h.rowsByCall[i] ?? [] : []);
}

/** drizzle-ish transaction query builder: every method chains; await runs read. */
function chain(): unknown {
  return new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        const p = terminalResult();
        return (p as unknown as Record<string, (...a: unknown[]) => unknown>)[prop as string].bind(p);
      }
      return () => chain();
    },
    apply() {
      return chain();
    },
  });
}

function makeTx() {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'execute') return () => Promise.resolve([]);
        return () => chain();
      },
    },
  );
}

/** Thenable for the persisted-row PK read: .from().where().limit() then resolves. */
function selectChain(): unknown {
  return new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        const p = Promise.resolve(h.persistedRows);
        return (p as unknown as Record<string, (...a: unknown[]) => unknown>)[prop as string].bind(p);
      }
      return () => selectChain();
    },
    apply() {
      return selectChain();
    },
  });
}

vi.mock('../../db/client.js', () => ({
  db: () => ({
    select: (..._a: unknown[]) => {
      h.selectCalls += 1;
      return selectChain();
    },
    insert: (..._a: unknown[]) => ({
      values: (v: Record<string, unknown>) => {
        h.inserted.push(v);
        return { onConflictDoUpdate: (..._b: unknown[]) => Promise.resolve([]) };
      },
    }),
    transaction: (cb: (tx: unknown) => Promise<unknown>) => {
      h.transactionCalls += 1;
      return Promise.resolve().then(() => cb(makeTx()));
    },
  }),
}));

beforeEach(() => {
  vi.resetModules();
  h.mode = 'ok';
  h.now = 5_000_000;
  h.persistedRows = [];
  h.rowsByCall = null;
  h.call = 0;
  h.transactionCalls = 0;
  h.selectCalls = 0;
  h.inserted = [];
  vi.spyOn(Date, 'now').mockImplementation(() => h.now);
});

afterEach(() => vi.restoreAllMocks());

/** A valid, fresh persisted row (summary + base facets + a recent computed_at). */
function freshRow(total: number, drayage: number) {
  return {
    summary: { total, intermodalTotal: 7, states: 3, byState: [], byPort: [] },
    baseFacets: {
      fleet: { '1-25': 0, '26-100': 0, '101-500': 0, '500+': 0 },
      drivers: { '1-10': 0, '11-50': 0, '51-250': 0, '250+': 0 },
      equipment: { drayage, dryvan: 0, reefer: 0, hazmat: 0, tanker: 0, flatbed: 0, drybulk: 0 },
      cargo: {},
      goodStanding: 0,
      ports: {},
      authorityActive: 0,
      intermodal: drayage,
      recent: 0,
    },
    computedAt: new Date(h.now),
  };
}

describe('(a) request path serves the PERSISTED row without the live scan', () => {
  it('getDirectorySummary returns the persisted summary and opens NO transaction', async () => {
    h.persistedRows = [freshRow(12345, 99)];
    const q = await import('./queries.js');
    const s = await q.getDirectorySummary();
    expect(s.total).toBe(12345); // straight from the persisted row
    expect(h.transactionCalls).toBe(0); // the 330k-row scan NEVER ran
    expect(h.selectCalls).toBeGreaterThanOrEqual(1); // it WAS a single-row PK read
  });

  it('getFacetCounts (unfiltered base case) returns persisted base facets, NO transaction', async () => {
    h.persistedRows = [freshRow(12345, 99)];
    const q = await import('./queries.js');
    const f = await q.getFacetCounts(q.normalizeFilters({}));
    expect(f.equipment.drayage).toBe(99); // from the persisted base facets
    expect(h.transactionCalls).toBe(0); // no live facet scan
  });

  it('a sort-only / paged /directory URL is still the unfiltered base case', async () => {
    const q = await import('./queries.js');
    // sort + page never add a WHERE condition → still the persisted base case.
    expect(q.isUnfilteredFacets(q.normalizeFilters({ sort: 'fleet', page: '4' }))).toBe(true);
    // an actual facet (state) is NOT the base case → must compute live.
    expect(q.isUnfilteredFacets(q.normalizeFilters({ state: 'TX' }))).toBe(false);
  });

  it('a FILTERED facet combo bypasses the persisted row and computes live', async () => {
    h.persistedRows = [freshRow(12345, 99)];
    h.rowsByCall = null; // live reads → [] → zero counts, but the point is it RAN
    const q = await import('./queries.js');
    const f = await q.getFacetCounts(q.normalizeFilters({ state: 'TX' }));
    expect(h.transactionCalls).toBeGreaterThanOrEqual(1); // filtered → live scan
    expect(f.equipment.drayage).toBe(0); // NOT the persisted 99
  });
});

describe('(b) request path FALLS BACK to live compute when the persisted row is absent', () => {
  it('getDirectorySummary computes live (opens a transaction) on a cold/absent row', async () => {
    h.persistedRows = []; // never populated
    h.rowsByCall = [[{ state: 'CA', n: 42 }], [], [{ n: 5 }]]; // byState, byPort, intermodal
    const q = await import('./queries.js');
    const s = await q.getDirectorySummary();
    expect(h.transactionCalls).toBeGreaterThanOrEqual(1); // fell back to the live path
    expect(s.total).toBe(42); // computed from the live canned rows
    expect(s.intermodalTotal).toBe(5);
  });

  it('getFacetCounts falls back to the live SWR path when no row is persisted', async () => {
    h.persistedRows = [];
    const q = await import('./queries.js');
    const f = await q.getFacetCounts(q.normalizeFilters({}));
    expect(h.transactionCalls).toBeGreaterThanOrEqual(1); // live facet scan ran
    expect(f.fleet['1-25']).toBe(0); // empty canned rows → zero counts, never a throw
  });
});

describe('(c) populate path computes + persists a valid singleton row', () => {
  it('recomputeAndPersistDirectoryAggregates writes id=1 with summary + base facets', async () => {
    h.rowsByCall = [
      // summary compute: byState, byPort, intermodal
      [{ state: 'CA', n: 42 }],
      [],
      [{ n: 5 }],
      // base facet compute reads (fleet, drivers, equipment, cargo, ports,
      // goodStanding, authority, intermodal, recent) → [] is fine for shape.
    ];
    const q = await import('./queries.js');
    const out = await q.recomputeAndPersistDirectoryAggregates();
    expect(h.inserted.length).toBe(1);
    const row = h.inserted[0];
    expect(row.id).toBe(1); // the singleton id
    expect((row.summary as { total: number }).total).toBe(42);
    expect(row.baseFacets).toBeTruthy();
    expect(row.computedAt).toBeInstanceOf(Date);
    // Returned value mirrors what was written.
    expect(out.summary.total).toBe(42);
  });

  it('ensureFreshDirectoryAggregates RECOMPUTES when the row is absent', async () => {
    h.persistedRows = []; // absent
    const q = await import('./queries.js');
    const outcome = await q.ensureFreshDirectoryAggregates();
    expect(outcome).toBe('recomputed');
    expect(h.inserted.length).toBe(1); // it wrote the row
  });

  it('ensureFreshDirectoryAggregates is a no-op (no write) when the row is FRESH', async () => {
    h.persistedRows = [freshRow(100, 1)]; // computedAt === now → well within max age
    const q = await import('./queries.js');
    const outcome = await q.ensureFreshDirectoryAggregates();
    expect(outcome).toBe('fresh');
    expect(h.inserted.length).toBe(0); // nothing recomputed / written
    expect(h.transactionCalls).toBe(0); // and no scan opened
  });

  it('ensureFreshDirectoryAggregates RECOMPUTES when the row is STALE (older than max age)', async () => {
    // computed_at is 25h old relative to the mocked clock → past AGG_PERSIST_MAX_AGE_MS.
    const stale = freshRow(100, 1);
    stale.computedAt = new Date(h.now - 25 * 60 * 60 * 1000);
    h.persistedRows = [stale];
    const q = await import('./queries.js');
    const outcome = await q.ensureFreshDirectoryAggregates();
    expect(outcome).toBe('recomputed');
    expect(h.inserted.length).toBe(1);
  });
});

describe('(d) off-path recompute is bounded by a total wall-clock budget', () => {
  it('withWallClockDeadline REJECTS a promise that never settles, at the budget', async () => {
    const q = await import('./queries.js');
    const never = new Promise<number>(() => {}); // never resolves/rejects
    // Real 15ms timer (setTimeout is not faked here) → the deadline wins the race.
    await expect(q.withWallClockDeadline(never, 15, 'test recompute')).rejects.toThrow(
      /test recompute exceeded 15ms wall-clock budget/,
    );
  });

  it('withWallClockDeadline RESOLVES fast work well within budget', async () => {
    const q = await import('./queries.js');
    await expect(q.withWallClockDeadline(Promise.resolve(42), 5000, 'test')).resolves.toBe(42);
  });
});
