/**
 * CRAWL-REACHABILITY CONTRACT — the internal link graph Google actually walks.
 *
 * MEASURED PROBLEM (Search Console + prod census, 2026-08-29). Discovery was
 * already solved: sitemap.xml submitted 355,075 URLs with 0 errors and URL
 * Inspection confirmed Google HAD the URLs. What it had never done was FETCH
 * them — 5 of 5 sampled unindexed carriers reported "Discovered – currently not
 * indexed" with lastCrawl NEVER, and only 399 distinct URLs (0.11%) had earned a
 * single impression.
 *
 * The cause was the link graph, not page quality. Three numbers:
 *
 *   1. Only the top-24 cities per state were ever LINKED (citiesForState(s, 24)),
 *      so 1,296 of 24,728 city hubs had an internal inbound link and ~23,400 were
 *      reachable only from sitemap-cities.xml.
 *   2. robots.txt line 24 disallows `/*?*page=`, so the ONLY pager the site
 *      emitted was invisible to Googlebot — every hub was frozen at 24 carriers
 *      while 66.77% of carriers (220,479 of 330,218) live in cities with more.
 *   3. Together those closed the transitive closure of the graph from `/` at
 *      ~32,600 of 330,218 carrier profiles — 9.2%. The other ~91% were orphans.
 *
 * The quality hypothesis was tested and REFUTED, which is why nothing here gates
 * on content: the carrier Google refuses to index (USDOT 174) scores 72 on the
 * app's own richness scale, ABOVE both carriers that rank (61 and 54). Every
 * threshold that excludes it also excludes the carrier ranking at position 6.0.
 *
 * So this file pins the LINK GRAPH and the CRAWL COST, not the content:
 *   • every city hub is reachable (the complete /directory/{state}/cities index)
 *   • hub pagination has a crawlable PATH form that robots.txt permits
 *   • the paginated series is self-consistent (pager, rel=prev/next, canonical)
 *   • faceted views keep the query pager, so the ~1.9e11 facet space stays out
 *   • the 68 KB stylesheet is served once, not inlined into all ~355k pages
 */
import { describe, it, expect, vi } from 'vitest';

const STATE = { code: 'TX', slug: 'texas', name: 'Texas' } as never;

/** A carrier list result shaped like listCarriers() returns. */
const listResult = (page: number, totalPages: number, filters: unknown) => ({
  carriers: [],
  total: totalPages * 24,
  page,
  perPage: 24,
  totalPages,
  filters,
}) as never;

/** A zeroed FacetCounts, shaped like the real one (mirrors crawlCost.test.ts). */
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

async function statePage(query: Record<string, unknown>, page = 1, totalPages = 1): Promise<string> {
  const q = await vi.importActual<typeof import('./queries.js')>('./queries.js');
  const { renderStatePage } = await import('./pages.js');
  const filters = { ...q.normalizeFilters({ ...query, state: 'TX' }), page };
  return renderStatePage({
    state: STATE,
    list: listResult(page, totalPages, filters),
    counts: (await zeroCounts()) as never,
    filters,
    cities: [],
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. THE COMPLETE CITY INDEX — the fix for ~23,400 orphaned city hubs
// ═══════════════════════════════════════════════════════════════════════════

describe('/directory/{state}/cities — the complete city index', () => {
  const cities = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      city: `City ${String(i).padStart(4, '0')}`,
      slug: `city-${i}`,
      count: n - i,
    }));

  it('links EVERY city it is given — an index that omits cities is not an index', async () => {
    const { renderStateCityIndex } = await import('./pages.js');
    const all = cities(120);
    const html = renderStateCityIndex({ state: STATE, cities: all, page: 1, totalCities: 120 });
    for (const c of all) {
      expect(html).toContain(`href="/directory/texas/${c.slug}"`);
    }
  });

  it('page 1 canonicalises to the bare path, never to /page/1', async () => {
    const { renderStateCityIndex } = await import('./pages.js');
    const html = renderStateCityIndex({ state: STATE, cities: cities(3), page: 1, totalCities: 3 });
    expect(html).toContain('<link rel="canonical" href="https://quotefleet.net/directory/texas/cities">');
    expect(html).not.toContain('/directory/texas/cities/page/1');
  });

  it('every page of the series links every OTHER page, so the tail is 1 hop deep', async () => {
    const { renderStateCityIndex, CITY_INDEX_PER_PAGE, cityIndexPageCount } = await import('./pages.js');
    const total = CITY_INDEX_PER_PAGE * 3 + 10; // → 4 pages
    expect(cityIndexPageCount(total)).toBe(4);
    const html = renderStateCityIndex({ state: STATE, cities: cities(20), page: 2, totalCities: total });
    // Page 1 is the bare path; 3 and 4 are /page/N. Page 2 is the current one.
    expect(html).toContain('href="/directory/texas/cities"');
    expect(html).toContain('href="/directory/texas/cities/page/3"');
    expect(html).toContain('href="/directory/texas/cities/page/4"');
    expect(html).toContain('<span class="cur">2</span>');
    // …and it declares its own address, not page 1's.
    expect(html).toContain('<link rel="canonical" href="https://quotefleet.net/directory/texas/cities/page/2">');
    expect(html).toContain('<link rel="prev" href="https://quotefleet.net/directory/texas/cities">');
    expect(html).toContain('<link rel="next" href="https://quotefleet.net/directory/texas/cities/page/3">');
  });

  it('the state page links out to the complete index', async () => {
    const { renderStatePage } = await import('./pages.js');
    const q = await vi.importActual<typeof import('./queries.js')>('./queries.js');
    const filters = q.normalizeFilters({ state: 'TX' });
    const html = renderStatePage({
      state: STATE,
      list: listResult(1, 1, filters),
      counts: (await zeroCounts()) as never,
      filters,
      cities: [{ city: 'Houston', slug: 'houston', count: 9 }],
    });
    expect(html).toContain('href="/directory/texas/cities"');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. CRAWLABLE PATH PAGINATION — robots.txt disallows the query form
// ═══════════════════════════════════════════════════════════════════════════

describe('hub pagination has a crawlable path form', () => {
  it('an UNFILTERED hub pages over clean paths, not the disallowed ?page=', async () => {
    const html = await statePage({}, 2, 5);
    expect(html).toContain('href="/directory/texas/page/3"');
    expect(html).toContain('href="/directory/texas/page/5"');
    // Page 1 stays the bare hub path — one canonical URL for page 1.
    expect(html).toContain('href="/directory/texas"');
    // The whole point: no ?page= link survives on an unfiltered hub.
    expect(html).not.toContain('/directory/texas?page=');
  });

  it('the paginated hub canonicalises to its OWN path, not a robots-blocked URL', async () => {
    const html = await statePage({}, 3, 5);
    expect(html).toContain('<link rel="canonical" href="https://quotefleet.net/directory/texas/page/3">');
    expect(html).toContain('<link rel="prev" href="https://quotefleet.net/directory/texas/page/2">');
    expect(html).toContain('<link rel="next" href="https://quotefleet.net/directory/texas/page/4">');
  });

  it('page 2 of an unfiltered hub links BACK to the bare hub, not to /page/1', async () => {
    const html = await statePage({}, 2, 5);
    expect(html).toContain('<link rel="prev" href="https://quotefleet.net/directory/texas">');
    expect(html).not.toContain('/directory/texas/page/1');
  });

  it('a FACETED view keeps the query pager — the facet space stays robots-blocked', async () => {
    // A clean path for every facet combination would mint a ~1.9e11 URL space
    // that robots.txt blocks on purpose. Pagination of a clean hub is a bounded,
    // non-duplicate series; faceted pagination is not.
    const html = await statePage({ cargo: 'paper' }, 2, 5);
    expect(html).not.toContain('/directory/texas/page/');
    expect(html).toContain('cargo=paper');
    expect(html).toContain('page=3');
  });

  it('the city and port hubs page over paths too', async () => {
    const q = await vi.importActual<typeof import('./queries.js')>('./queries.js');
    const { renderCityPage, renderPortPage } = await import('./pages.js');
    const counts = (await zeroCounts()) as never;

    const cityFilters = { ...q.normalizeFilters({ state: 'TX', city: 'houston' }), page: 2 };
    const cityHtml = renderCityPage({
      state: STATE,
      city: { name: 'Houston', slug: 'houston' },
      list: listResult(2, 4, cityFilters),
      counts,
      filters: cityFilters,
      cities: [],
    });
    expect(cityHtml).toContain('href="/directory/texas/houston/page/3"');
    expect(cityHtml).toContain(
      '<link rel="canonical" href="https://quotefleet.net/directory/texas/houston/page/2">',
    );

    const portFilters = { ...q.normalizeFilters({ port: 'USHOU' }), page: 2 };
    const portHtml = renderPortPage({
      port: { code: 'USHOU', name: 'Houston', slug: 'houston', state: 'TX' } as never,
      list: listResult(2, 4, portFilters),
      counts,
      filters: portFilters,
    });
    expect(portHtml).toContain('href="/directory/port/USHOU/page/3"');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. THE ROUTES BACKING THOSE PATHS
// ═══════════════════════════════════════════════════════════════════════════

describe('route registration for the crawlable paths', () => {
  it('registers every path form the pager can emit', async () => {
    const src = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../routes/directory.ts', import.meta.url), 'utf8'),
    );
    for (const path of [
      "'/directory/:stateSlug/page/:page'",
      "'/directory/:stateSlug/:citySlug/page/:page'",
      "'/directory/port/:port/page/:page'",
      "'/directory/:stateSlug/cities'",
      "'/directory/:stateSlug/cities/page/:page'",
    ]) {
      expect(src).toContain(path);
    }
  });

  it('the /cities index is registered BEFORE :citySlug, or "cities" reads as a city', async () => {
    const src = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../routes/directory.ts', import.meta.url), 'utf8'),
    );
    expect(src.indexOf("'/directory/:stateSlug/cities'")).toBeLessThan(
      src.indexOf("'/directory/:stateSlug/:citySlug'"),
    );
  });

  it('the port hub is registered BEFORE the city hub — both are 5 segments with /page/N', async () => {
    // /directory/port/USLAX/page/2 would otherwise match
    // /directory/:stateSlug/:citySlug/page/:page as state="port", city="USLAX".
    const src = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../routes/directory.ts', import.meta.url), 'utf8'),
    );
    expect(src.indexOf("'/directory/port/:port/page/:page'")).toBeLessThan(
      src.indexOf("'/directory/:stateSlug/:citySlug/page/:page'"),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. CRAWL COST IN BYTES — the 68 KB stylesheet
// ═══════════════════════════════════════════════════════════════════════════

describe('DIRECTORY_CSS is fetched once, not inlined into ~355k pages', () => {
  it('pages link the stylesheet instead of inlining it', async () => {
    const { DIRECTORY_CSS, DIRECTORY_CSS_HREF } = await import('./pages.js');
    const html = await statePage({});
    expect(html).toContain(`<link rel="stylesheet" href="${DIRECTORY_CSS_HREF}">`);
    // The measured defect: 68,058 identical bytes on every directory URL.
    expect(html).not.toContain(DIRECTORY_CSS);
    expect(html.length).toBeLessThan(DIRECTORY_CSS.length);
  });

  it('the href is content-addressed, so it can be cached immutably and for ever', async () => {
    const { createHash } = await import('node:crypto');
    const { DIRECTORY_CSS, DIRECTORY_CSS_HREF, DIRECTORY_CSS_HASH } = await import('./pages.js');
    const expected = createHash('sha256').update(DIRECTORY_CSS).digest('hex').slice(0, 16);
    expect(DIRECTORY_CSS_HASH).toBe(expected);
    expect(DIRECTORY_CSS_HREF).toBe(`/assets/directory-${expected}.css`);
  });

  it('the route serves it with an immutable year-long cache', async () => {
    const src = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../routes/directory.ts', import.meta.url), 'utf8'),
    );
    expect(src).toContain('public, max-age=31536000, immutable');
    // Registered before express.static so no same-named file can shadow it.
    expect(src.indexOf('DIRECTORY_CSS_HREF')).toBeGreaterThan(-1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. THE SITEMAP ADVERTISES THE NEW LINK SURFACE
// ═══════════════════════════════════════════════════════════════════════════

describe('sitemap carries the city indexes', () => {
  it('lists /directory/{state}/cities for every state, page 1 only', async () => {
    const { staticPageEntries } = await import('./sitemapCache.js');
    const { US_STATES } = await import('./usStates.js');
    const paths = new Set(staticPageEntries().map((e) => e.path));
    for (const s of US_STATES) expect(paths.has(`/directory/${s.slug}/cities`)).toBe(true);
    // Pages 2..N are reachable from page 1's pager; listing them would spend
    // crawl budget on a series the crawler can already walk in one hop.
    expect([...paths].some((p) => p.includes('/cities/page/'))).toBe(false);
  });
});
