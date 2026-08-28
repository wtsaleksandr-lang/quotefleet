/**
 * Directory aggregate hardening — the two guards added after the twice-repeated
 * production outage (all QuoteFleet domains down: every request hanging ~20s →
 * HTTP 000) caused by heavy carrier_directory aggregate scans pinning the DB
 * pool. See the "Aggregate hardening" block in queries.ts.
 *
 * These tests prove:
 *   1. Every summary/facet aggregate scan runs inside a transaction that first
 *      issues `SET LOCAL statement_timeout` (so no scan can hold a pooled
 *      connection for minutes).
 *   2. A statement_timeout abort (a rejected aggregate read) flows through the
 *      EXISTING error paths: the stale cached value is kept on a warm cache, and
 *      an empty/degraded result is served on a cold miss — NEVER a throw to the
 *      caller and NEVER an unbounded await.
 *   3. The shared limiter bounds how many recomputes run concurrently, so a
 *      cold-cache burst of distinct filter keys can never stampede the pool.
 *
 * The DB client is mocked with a `transaction` that hands the callback a tx
 * whose `execute` records the SET LOCAL and whose read chains resolve canned
 * rows (or reject with a 57014 statement_timeout error in "throw" mode).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  /** 'ok' → reads resolve canned rows; 'throw' → reads reject with 57014. */
  mode: 'ok' as 'ok' | 'throw',
  /** Controllable clock so we can age the cache past its TTL deterministically. */
  now: 1_000_000,
  /** How many `SET LOCAL statement_timeout` executes were issued. */
  setLocalCount: 0,
  /** Terminal-read counter, so rowsByCall can feed distinct rows per query. */
  call: 0,
  /** Rows resolved per terminal read, in call order (null → [] for every read). */
  rowsByCall: null as null | Array<Array<Record<string, unknown>>>,
}));

function timeoutError(): Error {
  // Postgres "canceling statement due to statement timeout" → SQLSTATE 57014.
  const e = new Error('canceling statement due to statement timeout') as Error & { code?: string };
  e.code = '57014';
  return e;
}

function terminalResult(): Promise<unknown> {
  const i = h.call++;
  if (h.mode === 'throw') return Promise.reject(timeoutError());
  return Promise.resolve(h.rowsByCall ? h.rowsByCall[i] ?? [] : []);
}

/** A drizzle-ish query builder: every method chains; awaiting runs the read. */
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
        if (prop === 'execute') {
          return (_q: unknown) => {
            h.setLocalCount += 1;
            return Promise.resolve([]);
          };
        }
        return () => chain();
      },
    },
  );
}

vi.mock('../../db/client.js', () => ({
  db: () => ({
    // Mirrors drizzle/postgres-js: run the callback with a reserved tx handle.
    transaction: (cb: (tx: unknown) => Promise<unknown>) => Promise.resolve().then(() => cb(makeTx())),
  }),
}));

beforeEach(() => {
  vi.resetModules(); // fresh module-level caches (directorySummaryCache, facet map)
  h.mode = 'ok';
  h.now = 1_000_000;
  h.setLocalCount = 0;
  h.call = 0;
  h.rowsByCall = null;
  vi.spyOn(Date, 'now').mockImplementation(() => h.now);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const flush = async () => {
  // Let fire-and-forget background refreshes settle.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
};

describe('directory aggregate — per-statement timeout', () => {
  it('issues SET LOCAL statement_timeout for the summary scan and returns real counts', async () => {
    h.rowsByCall = [[{ state: 'CA', n: 42 }], [], [{ n: 5 }]]; // byState, byPort, intermodal
    const q = await import('./queries.js');
    const s = await q.getDirectorySummary();
    expect(h.setLocalCount).toBeGreaterThanOrEqual(1); // the timeout WAS applied
    expect(s.total).toBe(42);
    expect(s.intermodalTotal).toBe(5);
  });

  it('keeps the STALE cached summary when a refresh scan times out (no throw)', async () => {
    h.rowsByCall = [[{ state: 'CA', n: 42 }], [], [{ n: 5 }]];
    const q = await import('./queries.js');
    const first = await q.getDirectorySummary(); // cold compute → caches total 42
    expect(first.total).toBe(42);

    // Age past the TTL and make every aggregate read abort with 57014.
    h.now += 6 * 60_000;
    h.mode = 'throw';
    h.call = 0;

    // Warm cache is stale → value served immediately; a background refresh is
    // kicked off and its statement_timeout abort must be swallowed (stale kept).
    const second = await q.getDirectorySummary();
    expect(second.total).toBe(42); // stale kept — NOT the empty (0) fallback
    await flush();
    const third = await q.getDirectorySummary();
    expect(third.total).toBe(42); // cache never poisoned by the aborted refresh
  });

  it('serves the EMPTY summary on a cold-miss timeout — never throws or hangs', async () => {
    h.mode = 'throw';
    const q = await import('./queries.js');
    // If the abort were not absorbed this would reject; if unbounded, it would
    // hang and time the test out. Resolving to the empty shape proves both.
    const s = await q.getDirectorySummary();
    expect(s.total).toBe(0);
    expect(s.byPort.length).toBeGreaterThan(0); // emptyDirectorySummary shape
  });

  it('serves EMPTY facet counts on a cold-miss timeout — never throws or hangs', async () => {
    h.mode = 'throw';
    const q = await import('./queries.js');
    const f = await q.getFacetCounts(q.normalizeFilters({}));
    expect(f.fleet['1-25']).toBe(0);
    expect(f.equipment.drayage).toBe(0);
  });
});

describe('AggregateLimiter — bounded recompute concurrency', () => {
  it('never runs more than `max` callbacks at once; excess wait for a slot', async () => {
    const { AggregateLimiter } = await import('./queries.js');
    const limiter = new AggregateLimiter(2);

    let active = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    const start = () =>
      limiter.run(
        () =>
          new Promise<void>((resolve) => {
            active += 1;
            peak = Math.max(peak, active);
            releases.push(() => {
              active -= 1;
              resolve();
            });
          }),
      );

    const running = [start(), start(), start(), start(), start()]; // 5 vs. max 2
    await Promise.resolve();
    await Promise.resolve();
    expect(releases.length).toBe(2); // only 2 admitted concurrently
    expect(peak).toBe(2);

    // Drain: releasing one admits exactly one queued waiter each time.
    while (releases.length) {
      const rel = releases.shift()!;
      rel();
      await Promise.resolve();
      await Promise.resolve();
    }
    await Promise.all(running);
    expect(peak).toBe(2); // ceiling never exceeded across the whole run
  });

  /**
   * THE BUG: REQUEST_AGG_BUDGET_MS is armed INSIDE withAggregateTimeout — i.e.
   * AFTER a limiter slot is acquired — so it bounded the scans but never the
   * wait for a slot, and acquire() had no timeout and no queue cap. Once the
   * sitemap began advertising thousands of city hubs (each its own facet cache
   * key against a 200-entry cache) a crawl cold-missed nearly every request, the
   * 2-slot queue grew without limit, and requests PILED UP to the 60s server
   * requestTimeout instead of degrading. These pin the bounded acquire.
   */
  it('rejects a queued waiter once maxWaitMs elapses instead of waiting forever', async () => {
    const { AggregateLimiter } = await import('./queries.js');
    const limiter = new AggregateLimiter(1);

    let release!: () => void;
    const held = limiter.run(() => new Promise<void>((resolve) => (release = resolve)));
    await Promise.resolve();

    // The slot is taken and never freed during this assertion.
    await expect(limiter.run(async () => 'never runs', 20)).rejects.toThrow(/queue wait exceeded 20ms/);

    release();
    await held;
  });

  it('does NOT bound off-path callers that omit maxWaitMs', async () => {
    const { AggregateLimiter } = await import('./queries.js');
    const limiter = new AggregateLimiter(1);

    let release!: () => void;
    const held = limiter.run(() => new Promise<void>((resolve) => (release = resolve)));
    await Promise.resolve();

    let settled = false;
    const queued = limiter.run(async () => 'ran').then((v) => ((settled = true), v));
    await new Promise((r) => setTimeout(r, 40)); // well past any request-path bound
    expect(settled).toBe(false); // still patiently queued

    release();
    await held;
    await expect(queued).resolves.toBe('ran');
  });

  it('a timed-out waiter never steals a slot — the limiter keeps full capacity', async () => {
    // REGRESSION GUARD: if a rejected waiter stayed in the queue, release()
    // would hand the freed slot to a dead promise and the conserved active
    // count would leak, permanently shrinking the limiter toward zero.
    const { AggregateLimiter } = await import('./queries.js');
    const limiter = new AggregateLimiter(1);

    let release!: () => void;
    const held = limiter.run(() => new Promise<void>((resolve) => (release = resolve)));
    await Promise.resolve();
    await expect(limiter.run(async () => 'x', 10)).rejects.toThrow();
    release();
    await held;

    // Capacity must be fully restored: two sequential runs and one immediate
    // acquire all succeed.
    await expect(limiter.run(async () => 'a')).resolves.toBe('a');
    await expect(limiter.run(async () => 'b')).resolves.toBe('b');
    await expect(limiter.run(async () => 'c', 1)).resolves.toBe('c');
  });
});
