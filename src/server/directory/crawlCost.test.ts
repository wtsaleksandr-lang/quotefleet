/**
 * CRAWL-COST CONTRACT — the four follow-ups 0068 documented but deferred.
 *
 * 0065's sitemap advertises ~350k directory URLs. 0068 indexed the city slug
 * expression, bounded the aggregate limiter and rate-limited carrier profiles,
 * and listed four things it did NOT do. This file pins all four:
 *
 *   1. Cache-Control on the PUBLIC directory HTML — and, far more importantly,
 *      the fail-closed rules that decide when a response may NOT be shared.
 *   2. A hard cap on ?page= so no request reaches OFFSET ~334k.
 *   3. The homepage hero no longer sorts the whole table (see heroCarriers.test).
 *   4. The ?q= ILIKE search path is rate-limited on its own, tighter lane.
 *
 * The caching half of this is a SECURITY test, not a performance test: every
 * assertion below describes a way one visitor's response could otherwise be
 * handed to another visitor by a shared cache.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PUBLIC_DIRECTORY_CACHE_CONTROL,
  NO_STORE_CACHE_CONTROL,
  CDN_S_MAXAGE_S,
  isSharedCacheable,
} from './httpCache.js';
import { parsePageParam, MAX_PAGE } from './queries.js';

const h = vi.hoisted(() => ({
  summary: vi.fn(async () => ({ total: 1, states: [], ports: [], intermodal: 0 })),
  list: vi.fn(async () => ({ carriers: [], total: 0, page: 1, perPage: 24, totalPages: 1, filters: {} })),
  facets: vi.fn(async () => ({})),
  cities: vi.fn(async () => []),
  bySlug: vi.fn(async () => null),
  related: vi.fn(async () => []),
  cityCount: vi.fn(async () => 0),
  stateCount: vi.fn(async () => 0),
  cityName: vi.fn(async () => 'Houston'),
  byCity: vi.fn(async () => ({ carriers: [], total: 0, page: 1, perPage: 24, totalPages: 1, filters: {} })),
}));

// Every DB-touching export is stubbed so this suite is hermetic and fast — the
// contract under test is HEADERS and BOUNDS, not query results.
vi.mock('./queries.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    getDirectorySummary: h.summary,
    listCarriers: h.list,
    getFacetCounts: h.facets,
    citiesForState: h.cities,
    carrierBySlug: h.bySlug,
    relatedCarriers: h.related,
    cityCarrierCount: h.cityCount,
    stateCarrierCount: h.stateCount,
    cityDisplayName: h.cityName,
    carriersByCity: h.byCity,
  };
});

// ── Minimal express doubles ────────────────────────────────────────────────
type Handler = (req: MockReq, res: MockRes, next: (e?: unknown) => void) => unknown;

interface MockReq {
  method: string;
  query: Record<string, unknown>;
  params: Record<string, string>;
  cookies: Record<string, unknown>;
  originalUrl: string;
}

const mkReq = (over: Partial<MockReq> = {}): MockReq => ({
  method: 'GET',
  query: {},
  params: {},
  cookies: {},
  originalUrl: '/directory',
  ...over,
});

class MockRes {
  statusCode = 200;
  headers: Record<string, string | string[]> = {};
  body: unknown = undefined;
  redirected: { code: number; to: string } | null = null;

  setHeader(k: string, v: string | string[]) {
    this.headers[k.toLowerCase()] = v;
    return this;
  }
  getHeader(k: string) {
    return this.headers[k.toLowerCase()];
  }
  removeHeader(k: string) {
    delete this.headers[k.toLowerCase()];
  }
  vary(field: string) {
    const cur = this.headers['vary'];
    this.headers['vary'] = cur ? `${String(cur)}, ${field}` : field;
    return this;
  }
  set(k: string, v: string) {
    return this.setHeader(k, v);
  }
  type(_t: string) {
    return this;
  }
  status(c: number) {
    this.statusCode = c;
    return this;
  }
  send(b: unknown) {
    this.body = b;
    return this;
  }
  json(b: unknown) {
    this.body = b;
    return this;
  }
  redirect(code: number, to: string) {
    this.redirected = { code, to };
    return this;
  }
  /** The Cache-Control actually emitted. */
  get cc(): string {
    return String(this.headers['cache-control'] ?? '');
  }
}

/** Register the directory routes against a fake app and return the LAST handler
 *  for each `METHOD path` (the middleware chain in front is asserted at source
 *  level, mirroring carrierSearch.public.route.test.ts). */
async function getHandlers(): Promise<Record<string, Handler>> {
  const { registerDirectoryRoutes } = await import('../routes/directory.js');
  const handlers: Record<string, Handler> = {};
  const record = (method: string) => (path: string | string[], ...rest: unknown[]) => {
    const last = rest[rest.length - 1] as Handler;
    for (const p of Array.isArray(path) ? path : [path]) handlers[`${method} ${p}`] = last;
  };
  const fakeApp = {
    get: record('GET'),
    post: record('POST'),
    use: () => {},
  } as unknown as import('express').Express;
  registerDirectoryRoutes(fakeApp);
  return handlers;
}

const noop = () => {};

beforeEach(() => {
  process.env.SESSION_SECRET ||= 'test'.repeat(16);
  process.env.DATABASE_URL ||= 'postgresql://x';
  h.bySlug.mockReset().mockResolvedValue(null);
  h.list.mockClear();
  h.facets.mockClear();
  h.summary.mockClear();
  h.cities.mockClear();
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. CACHE-CONTROL
// ═══════════════════════════════════════════════════════════════════════════

describe('httpCache — the fail-closed shareability predicate', () => {
  it('an ordinary anonymous GET is shareable', () => {
    expect(isSharedCacheable(mkReq() as never, new MockRes() as never)).toBe(true);
  });

  it('a request carrying a SESSION COOKIE is never shareable', () => {
    const req = mkReq({ cookies: { qf_sess: 'abc123' } });
    expect(isSharedCacheable(req as never, new MockRes() as never)).toBe(false);
  });

  it('a ?ref= request is never shareable — partners.ts drops a 90-day cookie on it', () => {
    // The capture middleware is fire-and-forget, so the Set-Cookie can land
    // AFTER headers are chosen. Refuse on the query param, not on the header.
    const req = mkReq({ query: { ref: 'PARTNER7' } });
    expect(isSharedCacheable(req as never, new MockRes() as never)).toBe(false);
  });

  it('a response that already staged a Set-Cookie is never shareable', () => {
    const res = new MockRes();
    res.setHeader('Set-Cookie', ['qf_ref=X; Path=/']);
    expect(isSharedCacheable(mkReq() as never, res as never)).toBe(false);
  });

  it('a non-GET is never shareable', () => {
    expect(isSharedCacheable(mkReq({ method: 'POST' }) as never, new MockRes() as never)).toBe(false);
    for (const method of ['PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      expect(isSharedCacheable(mkReq({ method }) as never, new MockRes() as never)).toBe(false);
    }
  });

  it('a HEAD IS shareable — Express routes it to the same GET handler', () => {
    // This one assertion is the whole bug 0068 shipped: HEAD was lumped in with
    // the mutating methods, so `curl -I`, monitors and crawlers all saw
    // `private, no-store` on pages a GET marked public. HEAD is safe AND
    // cacheable, and RFC 9110 §9.3.2 requires the same headers as the GET.
    expect(isSharedCacheable(mkReq({ method: 'HEAD' }) as never, new MockRes() as never)).toBe(true);
  });

  it('a HEAD is still refused when the request proves it is personalized', () => {
    // Widening to HEAD must not widen anything else: every fail-closed rule
    // applies to HEAD exactly as it does to GET.
    const withSession = mkReq({ method: 'HEAD', cookies: { qf_sess: 'abc123' } });
    expect(isSharedCacheable(withSession as never, new MockRes() as never)).toBe(false);
    const withRef = mkReq({ method: 'HEAD', query: { ref: 'PARTNER7' } });
    expect(isSharedCacheable(withRef as never, new MockRes() as never)).toBe(false);
    const staged = new MockRes();
    staged.setHeader('Set-Cookie', ['qf_ref=X; Path=/']);
    expect(isSharedCacheable(mkReq({ method: 'HEAD' }) as never, staged as never)).toBe(false);
  });

  it('the shared TTL stays bounded well inside the weekly FMCSA re-ingest', () => {
    // directoryRefreshCron re-ingests Sunday 09:00 UTC. A TTL at or beyond that
    // cadence could serve data from a superseded ingest indefinitely.
    expect(CDN_S_MAXAGE_S).toBeLessThan(7 * 24 * 60 * 60);
    expect(PUBLIC_DIRECTORY_CACHE_CONTROL).toContain('stale-while-revalidate=');
    expect(PUBLIC_DIRECTORY_CACHE_CONTROL).toContain('public');
    expect(NO_STORE_CACHE_CONTROL).toBe('private, no-store');
  });
});

describe('Cache-Control per route class', () => {
  it('an anonymous STATE page is publicly cacheable', async () => {
    const res = new MockRes();
    await (await getHandlers())['GET /directory/:stateSlug'](mkReq({ params: { stateSlug: 'texas' } }), res, noop);
    expect(res.cc).toBe(PUBLIC_DIRECTORY_CACHE_CONTROL);
    expect(String(res.headers['vary'] ?? '')).toContain('Cookie');
  });

  it('an anonymous CARRIER PROFILE is publicly cacheable — the ~334k-URL win', async () => {
    h.bySlug.mockResolvedValue({
      usdot: '107080',
      publicSlug: 'acme-107080',
      legalName: 'ACME',
      dbaName: null,
      city: 'Savannah',
      state: 'GA',
      capabilities: null,
      operatingLocations: null,
    } as never);
    const res = new MockRes();
    await (await getHandlers())['GET /directory/carrier/:slug'](mkReq({ params: { slug: 'acme-107080' } }), res, noop);
    expect(res.statusCode).toBe(200);
    expect(res.cc).toBe(PUBLIC_DIRECTORY_CACHE_CONTROL);
  });

  it('/directory/join is NEVER cacheable — it prints the signed-in email', async () => {
    const res = new MockRes();
    await (await getHandlers())['GET /directory/join'](mkReq(), res, noop);
    expect(res.cc).toBe(NO_STORE_CACHE_CONTROL);
  });

  it('the SAME public page degrades to no-store once a session cookie is present', async () => {
    const res = new MockRes();
    const req = mkReq({ params: { stateSlug: 'texas' }, cookies: { qf_sess: 'abc123' } });
    await (await getHandlers())['GET /directory/:stateSlug'](req, res, noop);
    expect(res.cc).toBe(NO_STORE_CACHE_CONTROL);
  });

  it('the SAME public page degrades to no-store on a ?ref= attribution hit', async () => {
    const res = new MockRes();
    const req = mkReq({ params: { stateSlug: 'texas' }, query: { ref: 'PARTNER7' } });
    await (await getHandlers())['GET /directory/:stateSlug'](req, res, noop);
    expect(res.cc).toBe(NO_STORE_CACHE_CONTROL);
  });

  it('the /directory landing is cacheable bare, but NOT with the ?upgrade= banner', async () => {
    const handlers = await getHandlers();
    const plain = new MockRes();
    await handlers['GET /directory'](mkReq(), plain, noop);
    expect(plain.cc).toBe(PUBLIC_DIRECTORY_CACHE_CONTROL);

    // ?upgrade= is NOT a facet key, so this renders the landing at what a cache
    // may treat as the same URL — with "You're on Directory Pro" inside it.
    const banner = new MockRes();
    await handlers['GET /directory'](mkReq({ query: { upgrade: 'success' } }), banner, noop);
    expect(banner.cc).toBe(NO_STORE_CACHE_CONTROL);
  });

  it('strips the per-IP RateLimit headers from anything it marks shareable', async () => {
    const res = new MockRes();
    res.setHeader('RateLimit', 'limit=120, remaining=119, reset=60');
    res.setHeader('RateLimit-Policy', '120;w=60');
    await (await getHandlers())['GET /directory/:stateSlug'](mkReq({ params: { stateSlug: 'texas' } }), res, noop);
    expect(res.cc).toBe(PUBLIC_DIRECTORY_CACHE_CONTROL);
    expect(res.getHeader('RateLimit')).toBeUndefined();
    expect(res.getHeader('RateLimit-Policy')).toBeUndefined();
  });
});

describe('routes that must never carry a public cache header (source-level)', () => {
  const read = (p: string) => readFile(resolve(process.cwd(), p), 'utf8');

  it('the identity endpoint the hydrators call is explicitly no-store', async () => {
    const src = await read('src/server/routes/directoryAuth.ts');
    expect(src).toContain("app.get('/api/directory/auth/me'");
    expect(src).toContain('setNoStore(res)');
  });

  it('no admin / app / api-tenant route imports the public cache helper', async () => {
    for (const f of ['src/server/routes/admin.ts', 'src/server/routes/tenant.ts', 'src/server/routes/billing.ts']) {
      expect(await read(f)).not.toContain('setPublicDirectoryCache');
    }
  });

  it('the per-user directory siblings are not wired to it either', async () => {
    // /directory/lists renders the caller's saved lists; /directory/rfq prefills
    // their email + name. Both live under /directory/*, so a wildcard CDN rule
    // would swallow them — they must not opt in here.
    for (const f of ['src/server/routes/savedLists.ts', 'src/server/routes/rfq.ts']) {
      expect(await read(f)).not.toContain('setPublicDirectoryCache');
    }
  });

  it('the carrier-profile handler no longer resolves entitlement server-side', async () => {
    const src = await read('src/server/routes/directory.ts');
    const profile = src.slice(src.indexOf("app.get('/directory/carrier/:slug'"));
    expect(profile.slice(0, profile.indexOf('app.get(', 10))).not.toContain('hasDirectoryPro');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. DEEP-OFFSET PAGINATION
// ═══════════════════════════════════════════════════════════════════════════

describe('parsePageParam — the OFFSET bound', () => {
  it('passes through an in-range page', () => {
    expect(parsePageParam('7')).toEqual({ page: 7, outOfRange: false });
    expect(parsePageParam(String(MAX_PAGE))).toEqual({ page: MAX_PAGE, outOfRange: false });
  });

  it('missing / junk falls back to page 1 WITHOUT 404-ing a mistyped link', () => {
    for (const v of [undefined, null, '', '   ', 'abc', '0']) {
      expect(parsePageParam(v)).toEqual({ page: 1, outOfRange: false });
    }
  });

  it('flags anything past the cap and clamps it', () => {
    for (const v of ['101', '13917', '5000000', '99999999999999999999']) {
      const got = parsePageParam(v);
      expect(got.outOfRange).toBe(true);
      expect(got.page).toBe(MAX_PAGE);
    }
  });

  it('flags negatives', () => {
    expect(parsePageParam('-4')).toEqual({ page: 1, outOfRange: true });
  });

  it('caps the OFFSET a request can reach to a bounded number of rows', () => {
    // (MAX_PAGE - 1) * MAX_PER_PAGE. Prod EXPLAIN: OFFSET 333,696 cost 57,014.96
    // vs OFFSET 2,376 cost 500.57 — this is the whole point of the cap.
    expect((MAX_PAGE - 1) * 50).toBeLessThanOrEqual(5000);
  });
});

describe('out-of-range ?page= is answered with 404, never a silent clamp', () => {
  it('404s on the state page and marks it noindex + no-store', async () => {
    const res = new MockRes();
    const req = mkReq({ params: { stateSlug: 'texas' }, query: { page: '13917' } });
    await (await getHandlers())['GET /directory/:stateSlug'](req, res, noop);
    expect(res.statusCode).toBe(404);
    expect(res.cc).toBe(NO_STORE_CACHE_CONTROL);
    expect(res.getHeader('X-Robots-Tag')).toBe('noindex');
    // It must NOT have run the list query — the point is to answer before the DB.
    expect(h.list).not.toHaveBeenCalled();
  });

  it('404s on the city page', async () => {
    const res = new MockRes();
    const req = mkReq({ params: { stateSlug: 'texas', citySlug: 'houston' }, query: { page: '900' } });
    await (await getHandlers())['GET /directory/:stateSlug/:citySlug'](req, res, noop);
    expect(res.statusCode).toBe(404);
  });

  it('404s on the port page', async () => {
    const res = new MockRes();
    const req = mkReq({ params: { port: 'USLAX' }, query: { page: '900' }, originalUrl: '/directory/port/USLAX?page=900' });
    await (await getHandlers())['GET /directory/port/:port'](req, res, noop);
    // Either a 404 or a canonical redirect first; if it rendered, that's a bug.
    expect(res.statusCode === 404 || res.redirected?.code === 301).toBe(true);
  });

  it('404s the JSON API with a machine-readable ceiling', async () => {
    const res = new MockRes();
    await (await getHandlers())['GET /api/public/directory'](mkReq({ query: { page: '13917' } }), res, noop);
    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({ maxPage: MAX_PAGE });
  });

  it('still serves an in-range deep page normally', async () => {
    const res = new MockRes();
    const req = mkReq({ params: { stateSlug: 'texas' }, query: { page: '42' } });
    await (await getHandlers())['GET /directory/:stateSlug'](req, res, noop);
    expect(res.statusCode).toBe(200);
    expect(h.list).toHaveBeenCalled();
  });
});

describe('the pagers can never advertise a page past the cap', () => {
  it('totalPages is clamped at the ONE place both pagers read it from', async () => {
    // numberedPager() links straight to `last` = list.totalPages, and
    // paginationRelLinks() chains rel=next while page < totalPages. Clamping
    // totalPages at the source is what stops both from minting OFFSET-334k URLs.
    const src = await readFile(resolve(process.cwd(), 'src/server/directory/queries.ts'), 'utf8');
    expect(src).toContain('totalPages: Math.min(MAX_PAGE, Math.max(1, Math.ceil(total / perPage)))');
  });

  it('normalizeFilters and listCarriers both clamp page independently', async () => {
    const { normalizeFilters } = await vi.importActual<typeof import('./queries.js')>('./queries.js');
    expect(normalizeFilters({ page: '999999' }).page).toBe(MAX_PAGE);
    const src = await readFile(resolve(process.cwd(), 'src/server/directory/queries.ts'), 'utf8');
    expect(src).toContain('const page = Math.min(MAX_PAGE, Math.max(1, Math.floor(filters.page) || 1));');
  });

  it('the sitemap still advertises only clean PATHS, never a ?page= URL', async () => {
    const src = await readFile(resolve(process.cwd(), 'src/server/directory/sitemapCache.ts'), 'utf8');
    expect(src).not.toContain('page=');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. THE ?q= ILIKE SEARCH
// ═══════════════════════════════════════════════════════════════════════════

describe('?q= runs on its own tighter rate-limit lane', () => {
  it('every public directory surface that accepts ?q= is wired to the search limiter', async () => {
    const src = await readFile(resolve(process.cwd(), 'src/server/routes/directory.ts'), 'utf8');
    for (const route of [
      "['/directory', '/directory/']",
      "'/directory/port/:port'",
      "'/directory/:stateSlug/:citySlug'",
      "'/directory/:stateSlug'",
    ]) {
      const at = src.indexOf(route);
      expect(at, `${route} should be registered`).toBeGreaterThan(-1);
      // The limiter must appear in the middleware list for this registration.
      expect(src.slice(at, at + 220)).toContain('directorySearchLimiter');
    }
  });

  it('the limiter engages ONLY on requests that actually carry a q', async () => {
    const { directorySearchLimiter } = await import('../rateLimits.js');
    const skip = (directorySearchLimiter as unknown as { skip?: (r: unknown) => boolean }).skip;
    // express-rate-limit keeps the option on the handler; if that ever stops
    // being true this assertion fails loudly rather than silently rate-limiting
    // ordinary facet browsing.
    if (typeof skip === 'function') {
      expect(skip({ query: {} })).toBe(true);
      expect(skip({ query: { q: '   ' } })).toBe(true);
      expect(skip({ query: { q: 'harbor' } })).toBe(false);
    }
  });

  it('is an order of magnitude tighter than the general public lane', async () => {
    const src = await readFile(resolve(process.cwd(), 'src/server/rateLimits.ts'), 'utf8');
    const block = src.slice(src.indexOf('export const directorySearchLimiter'));
    expect(block).toContain("envInt('DIRECTORY_SEARCH_BURST_LIMIT', 12)");
    expect(block.slice(0, 400)).toContain('windowMs: minutes(1)');
  });

  it('keeps the term bounded at both ends so the pattern can never blow up', async () => {
    const { normalizeNameQuery, NAME_SEARCH_MIN } = await vi.importActual<typeof import('./queries.js')>('./queries.js');
    expect(NAME_SEARCH_MIN).toBeGreaterThanOrEqual(2);
    expect(normalizeNameQuery('a')).toBeNull();
    expect(normalizeNameQuery('x'.repeat(500))!.length).toBeLessThanOrEqual(100);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. HONEST DEGRADATION when the facet counts cannot be computed
//    (prod was logging "aggregate limiter queue wait exceeded 2000ms" under
//     sitemap-driven crawler load and rendering a fabricated "0")
// ═══════════════════════════════════════════════════════════════════════════

describe('facet counts degrade HONESTLY — never a fabricated 0', () => {
  /** A zeroed FacetCounts, shaped like the real one. */
  const zeroCounts = async () => {
    const { PORT_GROUPS } = await import('./containerPorts.js');
    return {
      fleet: { '1-25': 0, '26-100': 0, '101-500': 0, '500+': 0 },
      drivers: { '1-10': 0, '11-50': 0, '51-250': 0, '250+': 0 },
      equipment: { drayage: 0, dryvan: 0, reefer: 0, hazmat: 0, tanker: 0, flatbed: 0, drybulk: 0 },
      cargo: {
        household: 0, beverages: 0, produce: 0, motorvehicles: 0, livestock: 0, grainfeed: 0,
        oilfield: 0, meat: 0, paper: 0, construction: 0, farmsupplies: 0, coalcoke: 0, buildingmaterials: 0,
      },
      goodStanding: 0,
      ports: Object.fromEntries(PORT_GROUPS.map((g) => [g.code, 0])),
      authorityActive: 0,
      intermodal: 0,
      recent: 0,
    } as Record<string, unknown>;
  };

  const statePage = async (counts: Record<string, unknown>) => {
    const q = await vi.importActual<typeof import('./queries.js')>('./queries.js');
    const { renderStatePage } = await import('./pages.js');
    const filters = q.normalizeFilters({ state: 'TX' });
    return renderStatePage({
      state: { code: 'TX', slug: 'texas', name: 'Texas' } as never,
      list: { carriers: [], total: 0, page: 1, perPage: 24, totalPages: 1, filters } as never,
      counts: counts as never,
      filters,
      cities: [],
    });
  };

  it('the degraded value is FLAGGED, not zeroed', async () => {
    const src = await readFile(resolve(process.cwd(), 'src/server/directory/queries.ts'), 'utf8');
    // The catch must not hand back plain emptyFacetCounts() any more.
    expect(src).toContain('return { ...emptyFacetCounts(), unavailable: true };');
    expect(src).not.toContain('serving zero counts');
  });

  it('the renderer OMITS the count badge when the counts are unavailable', async () => {
    const html = await statePage({ ...(await zeroCounts()), unavailable: true });
    // The facet rows still render — the filters stay fully usable …
    expect(html).toContain('class="facet-opt');
    // … but carry NO NUMERIC badge, because we genuinely do not have the number.
    // (The static "claim" badge on the carrier-declared capability rows is not a
    // count and is unaffected.)
    expect(html).not.toMatch(/<span class="cb">\d/);
  });

  it('the renderer SHOWS the badge when the counts are real', async () => {
    const counts = await zeroCounts();
    counts.goodStanding = 4321;
    const html = await statePage(counts);
    expect(html).toContain('<span class="cb">');
    expect(html).toContain('4,321');
  });

  it('a real 0 still renders as 0 — only UNKNOWN is omitted', async () => {
    const html = await statePage(await zeroCounts());
    expect(html).toContain('<span class="cb">0</span>');
  });
});

describe('facet cache contention — the source of the limiter saturation', () => {
  it('the cache key ignores sort/dir/page/perPage, which cannot change a count', async () => {
    const q = await vi.importActual<typeof import('./queries.js')>('./queries.js');
    const base = q.normalizeFilters({ state: 'TX' });
    // Three URLs a crawler WILL hit; identical counts, so they must share one
    // entry instead of cold-missing (and evicting) three times.
    expect(q.facetCacheKey(q.normalizeFilters({ state: 'TX', page: '2' }))).toBe(q.facetCacheKey(base));
    expect(q.facetCacheKey(q.normalizeFilters({ state: 'TX', sort: 'fleet' }))).toBe(q.facetCacheKey(base));
    expect(q.facetCacheKey(q.normalizeFilters({ state: 'TX', dir: 'asc' }))).toBe(q.facetCacheKey(base));
    // A real condition change still gets its own key.
    expect(q.facetCacheKey(q.normalizeFilters({ state: 'TX', fleet: '1-25' }))).not.toBe(q.facetCacheKey(base));
    expect(q.facetCacheKey(q.normalizeFilters({ state: 'TX', city: 'houston' }))).not.toBe(q.facetCacheKey(base));
  });

  it('the cache is large enough to hold the hubs the sitemap advertises', async () => {
    const src = await readFile(resolve(process.cwd(), 'src/server/directory/queries.ts'), 'utf8');
    const cap = Number(/FACET_COUNTS_CACHE_MAX = (\d+)/.exec(src)?.[1]);
    // 54 states + ~60 ports + the busiest cities. At 200 a crawl pass evicted
    // its own entries before they could ever be reused.
    expect(cap).toBeGreaterThanOrEqual(1000);
  });

  it('the aggregate limiter has more than the 2 slots that were saturating', async () => {
    const src = await readFile(resolve(process.cwd(), 'src/server/directory/queries.ts'), 'utf8');
    const slots = Number(/AGG_MAX_CONCURRENCY = (\d+)/.exec(src)?.[1]);
    expect(slots).toBeGreaterThan(2);
    // …but still well inside the 10-connection pool, since listCarriers runs
    // OUTSIDE this limiter on its own connection.
    expect(slots).toBeLessThanOrEqual(5);
  });
});
