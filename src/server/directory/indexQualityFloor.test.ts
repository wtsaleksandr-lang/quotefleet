/**
 * INDEX QUALITY FLOOR — the contract that keeps 24,730 generated city hubs from
 * dragging ~330k genuinely good carrier profiles down with them.
 *
 * MEASURED PROBLEM (live prod sitemap, 400-URL evenly-spread sample, 2026-09-11,
 * 400/400 fetched): 54.0% of city URLs in `sitemap-cities.xml` list THREE OR
 * FEWER carriers — 32.0% list exactly one. Regressing visible words on carrier
 * count over 52 live pages gives `words ≈ 1,078 + 27.4 × carriers`, so a
 * 1-carrier hub is 97.5% boilerplate and duplicates the one carrier profile it
 * links to. A 6-gram shingle diff of two 3-carrier hubs in different states put
 * 82.3% of their visible text in common.
 *
 * WHAT THIS FILE PINS — the four properties that make the fix correct rather than
 * merely present:
 *   1. A hub ABOVE the floor is indexable AND advertised in the sitemap.
 *   2. A hub BELOW the floor is `noindex, follow` AND absent from the sitemap.
 *      Both halves matter: submitting a URL while telling Google not to index it
 *      is a contradictory signal, which is the bug a half-fix would leave behind.
 *   3. `follow` survives, and the page is NOT deleted, 404'd, or canonicalised to
 *      its state page — a thin hub is often the only internal link to the carrier
 *      profiles beneath it, and those are what this change exists to protect.
 *   4. The rule is driven by LIVE DATA, not a baked-in list: the SAME city slug
 *      flips in and out of the sitemap when only the underlying carrier count
 *      changes, with no code change in between.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  HUB_INDEX_MIN_CARRIERS,
  THIN_HUB_ROBOTS,
  isIndexableHub,
  hubRobotsDirective,
} from './indexQualityFloor.js';

// ═══════════════════════════════════════════════════════════════════════════
// 1. THE PREDICATE
// ═══════════════════════════════════════════════════════════════════════════

describe('the floor predicate', () => {
  it('admits a hub at or above the floor and rejects one below it', () => {
    expect(HUB_INDEX_MIN_CARRIERS).toBe(4);
    for (const n of [0, 1, 2, 3]) expect(isIndexableHub(n)).toBe(false);
    for (const n of [4, 5, 24, 1_943]) expect(isIndexableHub(n)).toBe(true);
  });

  it('emits noindex,follow below the floor and NO directive above it', () => {
    expect(hubRobotsDirective(3)).toBe('noindex, follow');
    // `undefined` (not 'index,follow') so layout() omits the tag entirely and a
    // healthy hub's HTML stays byte-identical to what it serves today.
    expect(hubRobotsDirective(4)).toBeUndefined();
  });

  it('keeps `follow` so link equity still reaches the carrier profiles', () => {
    // A thin city hub is frequently the ONLY internal link to the carriers on it.
    // `noindex, nofollow` would strand exactly the pages worth protecting.
    expect(THIN_HUB_ROBOTS).toContain('noindex');
    expect(THIN_HUB_ROBOTS).toContain('follow');
    expect(THIN_HUB_ROBOTS).not.toContain('nofollow');
  });

  it('treats a missing/NaN count as thin rather than silently indexable', () => {
    // Fail CLOSED: a count we could not determine must not default a page into
    // the index. The opposite default is how a quality floor quietly stops working.
    for (const bad of [null, undefined, Number.NaN]) expect(isIndexableHub(bad)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. THE RENDERED PAGE
// ═══════════════════════════════════════════════════════════════════════════

const STATE = { code: 'AL', slug: 'alabama', name: 'Alabama' } as never;

const listResult = (total: number, filters: unknown) => ({
  carriers: [],
  total,
  page: 1,
  perPage: 24,
  totalPages: Math.max(1, Math.ceil(total / 24)),
  filters,
}) as never;

async function zeroCounts(): Promise<Record<string, unknown>> {
  const q = await vi.importActual<typeof import('./queries.js')>('./queries.js');
  const { PORT_GROUPS } = await import('./containerPorts.js');
  const zeros = (ids: readonly string[]) => Object.fromEntries(ids.map((i) => [i, 0]));
  return {
    fleet: zeros(q.FLEET_BUCKETS.map((b) => b.id)),
    drivers: zeros(q.DRIVERS_BUCKETS.map((b) => b.id)),
    equipment: zeros(q.EQUIPMENT_OPTIONS.map((e) => e.id)),
    cargo: zeros(q.CARGO_OPTIONS.map((c) => c.id)),
    goodStanding: 0,
    ports: Object.fromEntries(PORT_GROUPS.map((g) => [g.code, 0])),
    authorityActive: 0,
    intermodal: 0,
    recent: 0,
  };
}

/** Render /directory/alabama/{slug} for a city holding `total` carriers. */
async function cityPage(total: number, query: Record<string, unknown> = {}): Promise<string> {
  const q = await vi.importActual<typeof import('./queries.js')>('./queries.js');
  const { renderCityPage } = await import('./pages.js');
  const filters = q.normalizeFilters({ ...query, state: 'AL', city: 'addison' });
  return renderCityPage({
    state: STATE,
    city: { name: 'Addison', slug: 'addison' },
    list: listResult(total, filters),
    counts: (await zeroCounts()) as never,
    filters,
    cities: [],
  });
}

describe('the rendered city hub', () => {
  it('a city ABOVE the floor stays indexable — no robots meta at all', async () => {
    const html = await cityPage(HUB_INDEX_MIN_CARRIERS);
    expect(html).not.toContain('name="robots"');
    expect(html).not.toContain('noindex');
  });

  it('a city BELOW the floor is noindex,follow', async () => {
    const html = await cityPage(HUB_INDEX_MIN_CARRIERS - 1);
    expect(html).toContain('<meta name="robots" content="noindex, follow">');
  });

  it('flips on the count alone — same city, nothing else changed', async () => {
    // The two pages differ ONLY in the live carrier total. Nothing about this
    // city ("addison") is special-cased anywhere.
    const thin = await cityPage(3);
    const healthy = await cityPage(4);
    expect(thin).toContain('name="robots"');
    expect(healthy).not.toContain('name="robots"');
  });

  it('a thin hub is still a real, reachable page — not deleted or 404-ed', async () => {
    const html = await cityPage(1);
    // It still renders its H1, its carrier list and its onward links. The floor
    // is a DISCOVERY rule; a user who lands here still gets a sensible page.
    expect(html).toContain('Top Drayage Carriers in Addison, Alabama');
    expect(html).toContain('/directory/alabama');
  });

  it('keeps its SELF-canonical — no cross-page canonical to the state hub', async () => {
    // `/directory/alabama` (21k carriers) is not an equivalent page to a 3-row
    // city hub, so a canonical there would assert a duplication that does not
    // exist. noindex + a canonical pointing elsewhere is also self-contradicting:
    // one tag says "index the target instead", the other says "do not index".
    const html = await cityPage(2);
    expect(html).toContain('<link rel="canonical" href="https://quotefleet.net/directory/alabama/addison">');
    expect(html).not.toContain('<link rel="canonical" href="https://quotefleet.net/directory/alabama">');
  });

  it('applies to a FACET that narrows a real city below the floor', async () => {
    // routes/directory.ts warns that a facet narrowing a city to near-zero rows
    // would still render a thin, indexable page. `list.total` is the total for
    // THIS view, so that hole is closed too.
    const html = await cityPage(1, { cargo: 'paper' });
    expect(html).toContain('<meta name="robots" content="noindex, follow">');
  });

  it('holds across the whole paginated series, not just page 1', async () => {
    // `list.total` is the view's total, not the rows on this page, so page N of a
    // healthy city does not flip to noindex just because it is the last page.
    const q = await vi.importActual<typeof import('./queries.js')>('./queries.js');
    const { renderCityPage } = await import('./pages.js');
    const filters = { ...q.normalizeFilters({ state: 'AL', city: 'addison' }), page: 3 };
    const html = renderCityPage({
      state: STATE,
      city: { name: 'Addison', slug: 'addison' },
      list: { ...(listResult(50, filters) as Record<string, unknown>), page: 3, totalPages: 3 } as never,
      counts: (await zeroCounts()) as never,
      filters,
      cities: [],
    });
    expect(html).not.toContain('name="robots"');
  });
});

describe('the rendered port hub', () => {
  it('an EMPTY port hub is noindex,follow; a healthy one is untouched', async () => {
    const q = await vi.importActual<typeof import('./queries.js')>('./queries.js');
    const { renderPortPage } = await import('./pages.js');
    const port = { code: 'INLREG', name: 'Regina', slug: 'regina', city: 'Regina', state: 'SK' } as never;
    const render = async (total: number) => {
      const filters = q.normalizeFilters({ port: 'INLREG' });
      return renderPortPage({ port, list: listResult(total, filters), counts: (await zeroCounts()) as never, filters });
    };
    // Measured 2026-09-11: 4 of 60 live port hubs (CAPRR/INLSAS/INLREG/INLEDM)
    // list zero carriers and were being submitted to Google as empty pages.
    expect(await render(0)).toContain('<meta name="robots" content="noindex, follow">');
    expect(await render(157)).not.toContain('name="robots"');
  });
});

describe('carrier profiles are untouched', () => {
  it('never gains a robots directive from the hub floor', async () => {
    // The ~330k carrier pages are the healthy ones this change protects. The
    // floor must not reach them, whatever their own carrier "count" would be.
    const { renderCarrierProfile } = await import('./pages.js');
    const html = renderCarrierProfile({
      carrier: {
        usdot: '1234567',
        legalName: 'Addison Freight LLC',
        publicSlug: 'addison-freight-llc-1234567',
        city: 'ADDISON',
        state: 'AL',
        powerUnits: 2,
      } as never,
    });
    expect(html).not.toContain('name="robots"');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. THE SITEMAP — driven by live data, never a hardcoded list
// ═══════════════════════════════════════════════════════════════════════════

const h = vi.hoisted(() => ({
  /** (state, raw city, count) groups, exactly as `group by state, city` returns. */
  cityRows: [] as Array<{ state: string; city: string; n: number }>,
  /** One row per carrier, as the single off-path carrier scan returns them — the
   *  port tallies ride along on this scan rather than costing a second query. */
  carrierRows: [] as Array<{ slug: string; updatedAt: null; score: number; powerUnits: number; nearestPortCode: string | null }>,
  /** Whatever `persistDoc` wrote, by document key. */
  persisted: new Map<string, { xml: string; urlCount: number }>(),
  /** Bounded transactions opened — in this module an off-path SCAN can only
   *  happen inside one, so this is the round-trip budget of the rebuild. */
  txCount: 0,
}));

/** A drizzle-ish builder that resolves to `rows` whenever it is awaited. */
function chain(rows: unknown[]): unknown {
  return new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        const p = Promise.resolve(rows);
        return (p as unknown as Record<string, (...a: unknown[]) => unknown>)[prop as string].bind(p);
      }
      return () => chain(rows);
    },
    apply: () => chain(rows),
  });
}

/** Route an off-path `select({...})` to its fixture by the columns it asked for. */
function rowsFor(cols: Record<string, unknown> | undefined): unknown[] {
  const keys = new Set(Object.keys(cols ?? {}));
  if (keys.has('city')) return h.cityRows;
  if (keys.has('slug')) return h.carrierRows;
  return [];
}

vi.mock('../../db/client.js', () => ({
  db: () => ({
    transaction: (cb: (tx: unknown) => Promise<unknown>) => {
      h.txCount += 1;
      const tx = new Proxy(
        {},
        {
          get(_t, prop) {
            if (prop === 'execute') return () => Promise.resolve([]);
            if (prop === 'select') return (cols: Record<string, unknown>) => chain(rowsFor(cols));
            return () => chain([]);
          },
        },
      );
      return Promise.resolve().then(() => cb(tx));
    },
    select: () => chain([]), // orphan-chunk cleanup read
    insert: () => ({
      values: (v: { key: string; xml: string; urlCount: number }) => ({
        onConflictDoUpdate: () => {
          h.persisted.set(v.key, { xml: v.xml, urlCount: v.urlCount });
          return Promise.resolve([]);
        },
      }),
    }),
    delete: () => chain([]),
  }),
}));

// IndexNow is default-deny in tests, but stubbing it keeps this file's assertions
// about the SITEMAP and nothing else.
vi.mock('./indexNow.js', () => ({ runIndexNowSubmission: async () => ({ submitted: 0 }) }));
vi.mock('../seo/store.js', () => ({ listPublishedGuides: async () => [] }));

beforeEach(() => {
  h.cityRows = [];
  h.carrierRows = [];
  h.persisted.clear();
  h.txCount = 0;
});

/** `n` carrier rows all mapped to the same nearest port. */
function carriersAtPort(code: string | null, n: number) {
  return Array.from({ length: n }, (_v, i) => ({
    slug: `c-${code ?? 'none'}-${i}`,
    updatedAt: null,
    score: 1,
    powerUnits: 1,
    nearestPortCode: code,
  }));
}

/** Run the real off-path rebuild and hand back the 'cities' document. */
async function rebuildCitiesXml(): Promise<string> {
  const { recomputeAndPersistSitemap } = await import('./sitemapCache.js');
  await recomputeAndPersistSitemap();
  return h.persisted.get('cities')?.xml ?? '';
}

describe('the sitemap withholds exactly the hubs the page noindexes', () => {
  it('advertises a hub above the floor and withholds one below it', async () => {
    h.cityRows = [
      { state: 'AL', city: 'BIRMINGHAM', n: 40 }, // healthy
      { state: 'AL', city: 'ADDISON', n: 3 }, // thin
      { state: 'AL', city: 'ABBEVILLE', n: HUB_INDEX_MIN_CARRIERS }, // exactly at the floor
    ];
    const xml = await rebuildCitiesXml();
    expect(xml).toContain('https://quotefleet.net/directory/alabama/birmingham');
    expect(xml).toContain('https://quotefleet.net/directory/alabama/abbeville');
    expect(xml).not.toContain('/directory/alabama/addison');
  });

  it('the page and the sitemap agree on the SAME city — no half-fix', async () => {
    // The contradictory signal this whole change removes: a URL submitted in the
    // sitemap while the page it points at says noindex. Assert both halves of
    // one city at once, for a thin city and a healthy one.
    h.cityRows = [
      { state: 'AL', city: 'ADDISON', n: 3 },
      { state: 'AL', city: 'BIRMINGHAM', n: 40 },
    ];
    const xml = await rebuildCitiesXml();

    expect(await cityPage(3)).toContain('noindex, follow');
    expect(xml).not.toContain('/directory/alabama/addison');

    expect(await cityPage(40)).not.toContain('name="robots"');
    expect(xml).toContain('/directory/alabama/birmingham');
  });

  it('is DYNAMIC — the same slug enters the sitemap when its count crosses up', async () => {
    // The proof that no thin-city list is baked in anywhere. Identical code, one
    // FMCSA ingest apart: the city gains a 4th carrier and starts being indexed.
    h.cityRows = [{ state: 'AL', city: 'ADDISON', n: 3 }];
    expect(await rebuildCitiesXml()).not.toContain('/directory/alabama/addison');

    h.persisted.clear();
    h.cityRows = [{ state: 'AL', city: 'ADDISON', n: 4 }];
    expect(await rebuildCitiesXml()).toContain('https://quotefleet.net/directory/alabama/addison');

    // …and back out again when it drops below the floor.
    h.persisted.clear();
    h.cityRows = [{ state: 'AL', city: 'ADDISON', n: 2 }];
    expect(await rebuildCitiesXml()).not.toContain('/directory/alabama/addison');
  });

  it('sums spelling variants BEFORE applying the floor', async () => {
    // "ST. PAUL" and "ST PAUL" are two `group by city` rows but ONE hub, and the
    // page matches on the slug so it renders both variants' carriers. Filtering
    // per raw row would noindex a page that in fact lists 4 carriers.
    h.cityRows = [
      { state: 'MN', city: 'ST. PAUL', n: 2 },
      { state: 'MN', city: 'ST PAUL', n: 2 },
    ];
    expect(await rebuildCitiesXml()).toContain('https://quotefleet.net/directory/minnesota/st-paul');
  });

  it('keeps url_count honest — it counts what the document actually holds', async () => {
    h.cityRows = [
      { state: 'AL', city: 'BIRMINGHAM', n: 40 },
      { state: 'AL', city: 'ADDISON', n: 1 },
      { state: 'AL', city: 'AKRON', n: 2 },
    ];
    const xml = await rebuildCitiesXml();
    expect(h.persisted.get('cities')?.urlCount).toBe(1);
    expect((xml.match(/<loc>/g) ?? []).length).toBe(1);
  });
});

describe('the sitemap withholds thin PORT hubs from the pages document', () => {
  it('treats a hub ABSENT from the tally as empty, not as unknown', async () => {
    // A hub with no carriers mapped to it never appears in the tally at all.
    // Deriving the thin set from PORT_GROUPS (not from the tally's keys) is what
    // makes that hub visible; keying off the tally would silently index it.
    const { thinPortPathsFrom } = await import('./sitemapCache.js');
    const { PORT_GROUPS } = await import('./containerPorts.js');
    const healthy = new Map(PORT_GROUPS.filter((g) => g.code !== 'INLREG').map((g) => [g.code, 500] as const));
    const thin = thinPortPathsFrom(healthy);
    expect(thin.has('/directory/port/INLREG')).toBe(true);
    expect(thin.size).toBe(1);
    // And the floor is the same number as the city floor — one rule, not two.
    expect(thinPortPathsFrom(new Map([['INLREG', HUB_INDEX_MIN_CARRIERS]]))).not.toContain(
      '/directory/port/INLREG',
    );
  });

  it('drops a zero-carrier port hub from sitemap-pages.xml and keeps the rest', async () => {
    const { PORT_GROUPS } = await import('./containerPorts.js');
    // Every group gets carriers except INLREG — the real production shape
    // (measured 2026-09-11: CAPRR/INLSAS/INLREG/INLEDM list zero).
    h.carrierRows = PORT_GROUPS.filter((g) => g.code !== 'INLREG').flatMap((g) => carriersAtPort(g.code, 5));
    const { recomputeAndPersistSitemap } = await import('./sitemapCache.js');
    await recomputeAndPersistSitemap();
    const xml = h.persisted.get('pages')?.xml ?? '';

    expect(xml).not.toContain('/directory/port/INLREG');
    for (const g of PORT_GROUPS.filter((x) => x.code !== 'INLREG').slice(0, 5)) {
      expect(xml).toContain(`/directory/port/${g.code}`);
    }
    // State hubs, glossary and marketing routes are NOT affected by the hub floor.
    expect(xml).toContain('https://quotefleet.net/directory/alabama');
    expect(xml).toContain('https://quotefleet.net/pricing');
    expect(xml).toContain('https://quotefleet.net/glossary/');
  });

  it('costs NO extra query — the port tally rides the carrier scan', async () => {
    // The rebuild's round-trip budget is load-bearing (this module's whole design
    // rule). Pin the transaction count so a future "just add a group by" cannot
    // quietly add a scan to the off-path rebuild.
    const { recomputeAndPersistSitemap } = await import('./sitemapCache.js');
    h.txCount = 0;
    h.carrierRows = carriersAtPort('USLAX', 5);
    h.cityRows = [{ state: 'AL', city: 'BIRMINGHAM', n: 40 }];
    await recomputeAndPersistSitemap();
    // THREE bounded transactions, which is exactly what the rebuild opened before
    // this change: the carrier scan (now carrying the port tally), the city scan,
    // and the IndexNow announcement's own transaction. The port floor adds NONE —
    // a `group by nearest_port_code` query would have made this 4.
    expect(h.txCount).toBe(3);
  });
});
