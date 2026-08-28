/**
 * SEO sitemap — the ANTI-SCAN serving contract.
 *
 * sitemapCache.test.ts covers the pure XML/chunking logic. This file covers the
 * thing that actually protects production: that serving /sitemap*.xml reads the
 * MATERIALIZED document and NEVER scans the ~334k-row carrier_directory on the
 * request path. A live scan per crawler hit is the exact failure mode that took
 * every QuoteFleet domain down (see aggregateHardening.test.ts / queries.ts), and
 * Googlebot will pull these URLs repeatedly and in parallel.
 *
 * The proof: in this module a carrier/city scan can ONLY happen inside
 * `db().transaction(...)` (boundedScan). So "opened zero transactions while
 * serving" is a structural proof that no scan occurred — stronger than timing.
 * The mock counts transactions and single-row PK reads separately.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  /** Transactions opened. A carrier/city SCAN can only happen inside one. */
  txCount: 0,
  /** Terminal (awaited) non-transactional reads — the O(1) PK lookups. */
  selectCount: 0,
  /** Rows the next PK read resolves. `[]` models a cold/absent cache row. */
  rows: [] as Array<Record<string, unknown>>,
  /** Controllable clock so the in-memory SWR shield can be aged deterministically. */
  now: 1_000_000,
  /** When true, every transaction (i.e. every off-path SCAN) hangs forever. Used
   *  to prove a crawler response never AWAITS a scan. */
  hangTx: false,
}));

/** A drizzle-ish builder: every method chains; awaiting it runs the read. */
function chain(countIt: boolean): unknown {
  return new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        if (countIt) h.selectCount += 1;
        const p = Promise.resolve(h.rows);
        return (p as unknown as Record<string, (...a: unknown[]) => unknown>)[prop as string].bind(p);
      }
      return () => chain(countIt);
    },
    apply() {
      return chain(countIt);
    },
  });
}

vi.mock('../../db/client.js', () => ({
  db: () => ({
    transaction: (cb: (tx: unknown) => Promise<unknown>) => {
      h.txCount += 1;
      if (h.hangTx) return new Promise(() => {}); // a scan that never completes

      // Inside a tx, reads are the (off-path) scans — don't count them as PK reads.
      const tx = new Proxy(
        {},
        {
          get(_t, prop) {
            if (prop === 'execute') return () => Promise.resolve([]);
            return () => chain(false);
          },
        },
      );
      return Promise.resolve().then(() => cb(tx));
    },
    select: () => chain(true),
    insert: () => chain(false),
    delete: () => chain(false),
  }),
}));

// Keep the rest of queries.js real (citySlugify / withWallClockDeadline), but pin
// getDirectorySummary to a CANNED total so the cold-miss fallback is deterministic.
// It must NOT delegate to the real implementation — that would run the aggregate
// scans and pollute the transaction counter this file uses as its scan detector.
vi.mock('./queries.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./queries.js')>();
  return {
    ...actual,
    getDirectorySummary: async () => ({
      total: 334_000,
      intermodalTotal: 0,
      states: 50,
      byState: [],
      byPort: [],
    }),
  };
});

beforeEach(() => {
  vi.resetModules(); // fresh module-level sitemapMem shield per test
  h.txCount = 0;
  h.selectCount = 0;
  h.rows = [];
  h.now = 1_000_000;
  h.hangTx = false;
  vi.spyOn(Date, 'now').mockImplementation(() => h.now);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const flush = async () => {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
};

/** A materialized sitemap_cache row. */
function cachedRow(xml: string) {
  return [{ xml, computedAt: new Date('2026-08-20T00:00:00Z') }];
}

describe('serving is cache-backed — never a carrier scan on the request path', () => {
  it('serves the index from the materialized row and opens ZERO transactions', async () => {
    h.rows = cachedRow('<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex><!--materialized--></sitemapindex>');
    const m = await import('./sitemapCache.js');

    const res = await m.serveSitemapIndex();
    await flush();

    expect(res.source).toBe('cache');
    expect(res.xml).toContain('materialized');
    // THE CONTRACT: a scan can only occur inside a transaction. Zero were opened.
    expect(h.txCount).toBe(0);
    // And the read it did do was a single PK lookup, not a scan.
    expect(h.selectCount).toBe(1);
  });

  it('serves a carrier chunk from the materialized row without a scan', async () => {
    h.rows = cachedRow('<?xml version="1.0" encoding="UTF-8"?>\n<urlset><!--chunk-3--></urlset>');
    const m = await import('./sitemapCache.js');

    const res = await m.serveSitemapChild('carriers-3');
    await flush();

    expect(res.source).toBe('cache');
    expect(res.xml).toContain('chunk-3');
    expect(h.txCount).toBe(0);
  });

  it('shields repeat crawler hits in memory — N serves cost ONE PK read', async () => {
    h.rows = cachedRow('<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex></sitemapindex>');
    const m = await import('./sitemapCache.js');

    for (let i = 0; i < 25; i += 1) {
      const r = await m.serveSitemapIndex();
      expect(r.source).toBe('cache');
    }
    await flush();

    // 25 crawler hits → a single DB round-trip, and still zero scans.
    expect(h.selectCount).toBe(1);
    expect(h.txCount).toBe(0);
  });

  it('single-flights a concurrent cold burst into ONE PK read (no stampede)', async () => {
    h.rows = cachedRow('<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex></sitemapindex>');
    const m = await import('./sitemapCache.js');

    const results = await Promise.all(Array.from({ length: 20 }, () => m.serveSitemapIndex()));
    await flush();

    for (const r of results) expect(r.source).toBe('cache');
    expect(h.selectCount).toBe(1);
    expect(h.txCount).toBe(0);
  });

  it('a cold miss NEVER AWAITS a scan — it answers while the rebuild hangs forever', async () => {
    h.rows = []; // nothing materialized yet
    // Every off-path scan hangs indefinitely. If the response were coupled to a
    // scan in ANY way, this await would never settle and the test would time out.
    h.hangTx = true;
    const m = await import('./sitemapCache.js');

    const res = await m.serveSitemapIndex();

    expect(res.source).toBe('fallback');
    // The fallback chunk count comes from the O(1) persisted total (334k → 7),
    // so even a cold index advertises the right children without scanning.
    expect(res.xml).toContain('<loc>https://quotefleet.net/sitemap-carriers-7.xml</loc>');
    expect(res.xml).not.toContain('sitemap-carriers-8.xml');
    expect(res.xml).toContain('<loc>https://quotefleet.net/sitemap-cities.xml</loc>');
  });

  it('a cold-miss carrier chunk degrades to a valid empty urlset, not an error', async () => {
    h.rows = [];
    h.hangTx = true;
    const m = await import('./sitemapCache.js');

    const res = await m.serveSitemapChild('carriers-2');

    expect(res.source).toBe('fallback');
    expect(res.xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(res.xml).not.toContain('<url>');
  });

  it('kicks AT MOST ONE background rebuild across a cold-miss burst', async () => {
    h.rows = [];
    h.hangTx = true; // the first rebuild stays in flight for the whole burst
    const m = await import('./sitemapCache.js');

    await Promise.all([
      m.serveSitemapIndex(),
      m.serveSitemapChild('carriers-1'),
      m.serveSitemapChild('carriers-2'),
      m.serveSitemapChild('cities'),
    ]);
    await flush();

    // Four cold misses, one rebuild — the recompute is single-flighted, so a
    // crawler burst can never stampede the 334k scan.
    expect(h.txCount).toBeLessThanOrEqual(1);
  });

  it('a DB read failure degrades instead of throwing to the crawler', async () => {
    const m = await import('./sitemapCache.js');
    // Make the PK read reject.
    h.rows = null as unknown as Array<Record<string, unknown>>;

    await expect(m.serveSitemapChild('cities')).resolves.toMatchObject({ source: 'fallback' });
  });
});
