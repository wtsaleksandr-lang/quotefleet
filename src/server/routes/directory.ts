/**
 * PUBLIC carrier-directory — no auth. Backs the browsable US motor-carrier
 * directory (carrier_directory table, populated by scripts/ingestFmcsaCarriers.ts
 * from FMCSA's free public data).
 *
 * JSON API (read-only, platform-level, no tenant scope):
 *   GET /api/public/directory?state=XX&port=YY&intermodal=1&page=N
 *        → paginated carrier list.
 *   GET /api/public/directory/summary
 *        → carrier counts per state and per port (+ intermodal total).
 *   GET /api/public/directory/lookup?dot=NNNN | ?mc=NNNN
 *        → live FMCSA QCMobile compliance snapshot (authority/insurance/safety).
 *
 * Server-rendered SEO pages:
 *   GET /directory                    → landing (ports + states grids).
 *   GET /directory/:stateSlug         → state carrier list (paginated).
 *   GET /directory/port/:port         → carriers near a container port.
 *   GET /directory/carrier/:slug      → single carrier profile + live verify.
 *   GET /compliance                   → compliance tools + live lookup widget.
 *
 * The API + pages share one query layer (src/server/directory/queries.ts).
 */
import type { Express, Request, Response } from 'express';
import {
  getDirectorySummary,
  listCarriers,
  carrierBySlug,
  carriersByCity,
  citiesForState,
  allCitiesForState,
  cityDisplayName,
  cityCarrierCount,
  stateCarrierCount,
  relatedCarriers,
  RELATED_LIMIT,
  getFacetCounts,
  getHeroCarriers,
  normalizeFilters,
  citySlugify,
  parsePageParam,
  FACET_QUERY_KEYS,
  DEFAULT_PER_PAGE,
  MAX_PAGE,
} from '../directory/queries.js';
import { portByCode, portGroupByCode, portGroupForMemberCode, portGroupAsPort } from '../directory/containerPorts.js';
import { stateBySlug } from '../directory/usStates.js';
import { lookupCarrierCompliance } from '../directory/fmcsaLookup.js';
import {
  renderDirectoryLanding,
  renderDirectoryResults,
  renderStatePage,
  renderCityPage,
  renderPortPage,
  renderCarrierProfile,
  renderCarrierNotFound,
  renderDirectoryPageOutOfRange,
  renderCompliancePage,
  renderDirectoryJoin,
  renderStateCityIndex,
  cityIndexPageCount,
  cityIndexPath,
  CITY_INDEX_PER_PAGE,
  DIRECTORY_CSS,
  DIRECTORY_CSS_HREF,
} from '../directory/pages.js';
import { publicAutocompleteLimiter, publicCalcLimiter, directorySearchLimiter } from '../rateLimits.js';
import { directoryIdentity } from '../directory/entitlement.js';
import { serveSitemapIndex, serveSitemapChild, carrierChunkKey } from '../directory/sitemapCache.js';
import { INDEXNOW_KEY_ROUTE, indexNowKeyFileHandler } from '../directory/indexNow.js';
import { setPublicDirectoryCache, setNoStore } from '../directory/httpCache.js';

const isIntermodal = (v: unknown): boolean => ['1', 'true', 'yes'].includes(String(v ?? '').toLowerCase());

/**
 * Answer a `?page=` beyond MAX_PAGE with 404 rather than silently serving the
 * capped page. Returns true when it has already answered.
 *
 * 404 (not a redirect) because these URLs never had content: every deep page
 * previously self-canonicalized (canonicalSuffix keeps ?page=N), so a crawler
 * that found ?page=13917 through the old "last page" link would otherwise keep
 * an indexable, duplicate, OFFSET-334k URL alive forever. `noindex` is belt and
 * braces for anything already in an index — robots.txt Disallows ?page=, which
 * means a bot may not re-fetch to SEE the 404, but it can still honour a header
 * it has cached. Never cacheable: it is a rejection, not content.
 */
function rejectOutOfRangePage(req: Request, res: Response, backPath = '/directory'): boolean {
  if (!parsePageParam(req.query.page).outOfRange) return false;
  setNoStore(res);
  res.setHeader('X-Robots-Tag', 'noindex');
  res.status(404).type('html').send(renderDirectoryPageOutOfRange(MAX_PAGE, backPath));
  return true;
}

/**
 * Merge a clean-path `/page/N` segment into the query bag the filter parser reads.
 *
 * The hub listings are now reachable at BOTH `{hub}?page=N` (unchanged, for
 * humans and back-compat) and `{hub}/page/N` (new, crawlable). Everything
 * downstream — normalizeFilters, listCarriers, the pager — still speaks
 * `query.page`, so the path form is normalised here and nothing else changes.
 *
 * WHY THE PATH FORM EXISTS: robots.txt line 24 disallows `/*?*page=`, so the
 * query pager was invisible to Googlebot and every hub was frozen at its first
 * 24 carriers. 66.77% of carriers (220,479 of 330,218) sit in cities with more
 * than 24 carriers, i.e. past page 1 with no crawlable route to them.
 */
function withPathPage(req: Request): Record<string, unknown> {
  const q = { ...(req.query as Record<string, unknown>) };
  if (req.params.page != null) q.page = String(req.params.page);
  return q;
}

/**
 * Guard the clean `/page/N` form. Returns true when it has already answered.
 *
 * `/page/1` and any non-numeric or out-of-range N are duplicates or dead URLs,
 * so they 301 to the bare hub (one canonical page-1 URL) or 404 rather than
 * silently render another address for content that already has one.
 */
function rejectBadPathPage(req: Request, res: Response, hubPath: string): boolean {
  const raw = req.params.page;
  if (raw == null) return false;
  const text = String(raw);
  if (!/^[1-9][0-9]*$/.test(text) || text === '1') {
    res.redirect(301, hubPath);
    return true;
  }
  if (parseInt(text, 10) > MAX_PAGE) {
    setNoStore(res);
    res.setHeader('X-Robots-Tag', 'noindex');
    res.status(404).type('html').send(renderDirectoryPageOutOfRange(MAX_PAGE, hubPath));
    return true;
  }
  return false;
}

/** True when /directory carries any facet param (→ render results, not landing). */
const hasFacetParams = (q: Record<string, unknown>): boolean =>
  FACET_QUERY_KEYS.some((k) => q[k] != null && String(q[k]).trim() !== '');

/** "san-antonio" → "San Antonio" (fallback city display when no DB row seen). */
const prettifySlug = (slug: string): string =>
  slug
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

/** Send a sitemap XML document with the right content-type + a modest CDN cache.
 *  The bodies are materialized (sitemap_cache) so this is always an O(1) send. */
function sendSitemapXml(res: Response, xml: string): void {
  res.type('application/xml');
  // Sitemaps change only on the weekly ingest; an hour of CDN/browser cache is
  // safe and shields the (already O(1)) PK lookup from crawler bursts.
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(xml);
}

export function registerDirectoryRoutes(app: Express) {
  // ── Directory stylesheet, content-hashed + immutable ─────────────────────
  // Was a 68,058-byte <style> block inlined into every one of the ~355k
  // directory URLs — byte-identical on all of them, and 59% of a carrier
  // profile's ~115 KB. Inline CSS cannot be cached across URLs, so Googlebot
  // re-downloaded it 330k times (~22 GB of the ~37 GB needed to crawl the
  // carrier set). Crawl budget is spent in bytes, and crawl rate is this
  // site's binding constraint, so serving it ONCE is the single biggest
  // crawl-throughput win available. See pages.ts DIRECTORY_CSS_HREF.
  //
  // Registered before express.static so no file can shadow it. The filename
  // carries the content hash, so `immutable` is safe: changed CSS = changed
  // URL, and no visitor can be pinned to a stale bundle.
  app.get(DIRECTORY_CSS_HREF, (_req: Request, res: Response) => {
    res.type('text/css');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(DIRECTORY_CSS);
  });

  // ── IndexNow ownership proof: /<key>.txt ─────────────────────────────────
  // The protocol requires a text file at the site root whose ENTIRE body is the
  // key; without it every submission is rejected 403. The handler + its route
  // pattern live in directory/indexNow.ts next to the rest of the protocol
  // (and are unit-tested over real HTTP there). Registered here, before
  // express.static, so it cannot be shadowed by a file of the same name — and
  // it calls next() for anything that is not exactly our key, so it cannot
  // shadow anything else either.
  app.get(INDEXNOW_KEY_ROUTE, indexNowKeyFileHandler);

  // ── SEO sitemap (materialized — never a live 334k-row scan) ──────────────
  // The dynamic index REPLACES the old static ~50-URL public/sitemap.xml: it
  // references the marketing/state/port pages, the real city hubs, and the
  // chunked carrier children so all ~334k carrier profiles are discoverable.
  // Registered before express.static so it wins over any residual static file.
  app.get('/sitemap.xml', async (_req: Request, res: Response, next) => {
    try {
      sendSitemapXml(res, (await serveSitemapIndex()).xml);
    } catch (err) {
      next(err);
    }
  });

  // Chunked carrier children: /sitemap-carriers-1.xml … -N.xml (≤50k <loc> each).
  app.get('/sitemap-carriers-:n.xml', async (req: Request, res: Response, next) => {
    try {
      const key = carrierChunkKey(String(req.params.n));
      if (!key) return res.status(404).type('text/plain').send('Not found');
      sendSitemapXml(res, (await serveSitemapChild(key)).xml);
    } catch (err) {
      next(err);
    }
  });

  // City hubs + the marketing/state/port pages child.
  app.get('/sitemap-cities.xml', async (_req: Request, res: Response, next) => {
    try {
      sendSitemapXml(res, (await serveSitemapChild('cities')).xml);
    } catch (err) {
      next(err);
    }
  });
  app.get('/sitemap-pages.xml', async (_req: Request, res: Response, next) => {
    try {
      sendSitemapXml(res, (await serveSitemapChild('pages')).xml);
    } catch (err) {
      next(err);
    }
  });
  // Published /guides articles. Cold miss serves a valid empty urlset (the
  // engine ships dark, so an empty document is the CORRECT answer until a human
  // has approved the first draft) and kicks a background recompute.
  app.get('/sitemap-guides.xml', async (_req: Request, res: Response, next) => {
    try {
      sendSitemapXml(res, (await serveSitemapChild('guides')).xml);
    } catch (err) {
      next(err);
    }
  });

  // ── JSON API ───────────────────────────────────────────────────────────
  app.get('/api/public/directory', publicAutocompleteLimiter, async (req: Request, res: Response) => {
    const { page, outOfRange } = parsePageParam(req.query.page);
    if (outOfRange) {
      setNoStore(res);
      return res.status(404).json({ error: `page must be between 1 and ${MAX_PAGE}.`, maxPage: MAX_PAGE });
    }
    const result = await listCarriers({
      state: req.query.state ? String(req.query.state) : null,
      port: req.query.port ? String(req.query.port) : null,
      intermodal: isIntermodal(req.query.intermodal),
      page,
      perPage: req.query.perPage ? parseInt(String(req.query.perPage), 10) : DEFAULT_PER_PAGE,
    });
    setPublicDirectoryCache(req, res);
    return res.json(result);
  });

  app.get('/api/public/directory/summary', publicAutocompleteLimiter, async (req: Request, res: Response) => {
    const summary = await getDirectorySummary();
    setPublicDirectoryCache(req, res);
    return res.json(summary);
  });

  // Random real carriers for the homepage hero preview cards (live social proof).
  // Uncached so the featured set rotates every load (getHeroCarriers is random).
  app.get('/api/directory/hero-carriers', publicAutocompleteLimiter, async (_req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    return res.json({ carriers: await getHeroCarriers() });
  });

  // Live FMCSA lookup — external per-call, so the tighter cost limiter applies.
  app.get('/api/public/directory/lookup', publicCalcLimiter, async (req: Request, res: Response) => {
    const dot = req.query.dot ? String(req.query.dot) : '';
    const mc = req.query.mc ? String(req.query.mc) : '';
    if (!dot && !mc) {
      return res.status(400).json({ found: false, note: 'Provide a ?dot= or ?mc= number.' });
    }
    const snap = dot
      ? await lookupCarrierCompliance('dot', dot)
      : await lookupCarrierCompliance('mc', mc);
    return res.json(snap);
  });

  // ── Server-rendered pages ──────────────────────────────────────────────
  // Landing (no facet params) OR faceted master search (any facet param).
  app.get(
    ['/directory', '/directory/'],
    publicAutocompleteLimiter,
    directorySearchLimiter,
    async (req: Request, res: Response, next) => {
      try {
        if (!hasFacetParams(req.query as Record<string, unknown>)) {
          // Post-checkout confirmation (Stripe success_url / cancel_url land here).
          const up = String(req.query.upgrade ?? '').toLowerCase();
          const upgrade = up === 'success' ? 'success' : up === 'cancelled' ? 'cancelled' : null;
          // `upgrade` is NOT a facet key, so /directory?upgrade=success renders the
          // LANDING — the same URL shape as bare /directory but with a "You're on
          // Directory Pro" banner in it. A shared cache that normalizes the query
          // string away would then show that banner to everyone, so the banner
          // variant is never publicly cacheable.
          if (upgrade) setNoStore(res);
          else setPublicDirectoryCache(req, res);
          res.type('html').send(renderDirectoryLanding(await getDirectorySummary(), { upgrade }));
          return;
        }
        if (rejectOutOfRangePage(req, res)) return;
        const filters = normalizeFilters(req.query as Record<string, unknown>);
        const [list, counts, summary] = await Promise.all([
          listCarriers({ filters }),
          getFacetCounts(filters),
          getDirectorySummary(),
        ]);
        setPublicDirectoryCache(req, res);
        res.type('html').send(renderDirectoryResults({ filters, list, counts, summary }));
      } catch (err) {
        next(err);
      }
    },
  );

  // Shipper Directory Pro join / sign-in / subscribe surface. Registered BEFORE
  // /directory/:stateSlug so "join" isn't parsed as a state slug. Soft-auth:
  // anonymous → email form; signed-in free → subscribe; Pro → manage.
  app.get('/directory/join', async (req: Request, res: Response, next) => {
    try {
      // NEVER cacheable: two of the three branches print the signed-in shipper's
      // EMAIL ADDRESS into the HTML. A shared cache entry here is a PII leak.
      setNoStore(res);
      const identity = await directoryIdentity(req);
      const intent = String(req.query.intent ?? '').toLowerCase() === 'subscribe' ? 'subscribe' : 'signin';
      res.type('html').send(renderDirectoryJoin({ identity, intent }));
    } catch (err) {
      next(err);
    }
  });

  // Port page (registered BEFORE the :stateSlug route so it wins). Co-located
  // ports are ONE display hub: a request for a member slug (or any non-canonical
  // code) 301-redirects to the group's canonical slug so there's no link rot.
  app.get(
    ['/directory/port/:port', '/directory/port/:port/page/:page'],
    publicAutocompleteLimiter,
    directorySearchLimiter,
    async (req: Request, res: Response, next) => {
      try {
        const code = String(req.params.port).toUpperCase();
        const group = portGroupByCode(code) ?? portGroupForMemberCode(code);
        if (!group) return res.redirect(302, '/directory');
        if (code !== group.code) {
          const qs = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
          // Carry the /page/N segment through the canonicalising redirect. Without
          // it, `/directory/port/USLAX/page/2` landed on page 1 of the LA/LB hub —
          // a redirect that silently drops the deep page is exactly the kind of
          // severed crawl path this work exists to remove.
          const pageSeg = req.params.page != null ? `/page/${encodeURIComponent(String(req.params.page))}` : '';
          return res.redirect(301, `/directory/port/${group.code}${pageSeg}${qs}`);
        }
        if (rejectBadPathPage(req, res, `/directory/port/${group.code}`)) return;
        if (rejectOutOfRangePage(req, res, `/directory/port/${group.code}`)) return;
        const port = portGroupAsPort(group);
        const filters = normalizeFilters(withPathPage(req), { port: group.code, state: null, citySlug: null });
        const [list, counts] = await Promise.all([listCarriers({ filters }), getFacetCounts(filters)]);
        setPublicDirectoryCache(req, res);
        res.type('html').send(renderPortPage({ port, list, counts, filters }));
      } catch (err) {
        next(err);
      }
    },
  );

  // Carrier profile (registered BEFORE the :stateSlug route so it wins).
  // Limiter parity with the other public directory pages: this is the page type
  // the sitemap advertises ~334k times, and each render fires four DB reads
  // (carrierBySlug + relatedCarriers + cityCarrierCount + stateCarrierCount).
  // It was the only one of them registered without publicAutocompleteLimiter.
  // IDENTITY-FREE BY DESIGN. This handler used to await hasDirectoryPro(req) and
  // pass `isPro` into the render, which swapped the "Additional contacts" block
  // server-side — i.e. the HTML differed per visitor on the ONE page type the
  // sitemap advertises ~334k times, making the whole set uncacheable in any
  // shared cache. The Pro variant is now hydrated client-side from
  // /api/directory/auth/me (CARRIER_PRO_HYDRATE_SCRIPT), exactly like the nav's
  // "For shippers" slot, so the server HTML is byte-identical for everyone and
  // this page becomes the biggest caching win in the directory. Nothing is
  // weakened: the reveal endpoint enforces the entitlement itself (403), and the
  // free variant never contained real contact data — only a bulleted teaser.
  app.get('/directory/carrier/:slug', publicAutocompleteLimiter, async (req: Request, res: Response, next) => {
    try {
      const carrier = await carrierBySlug(String(req.params.slug));
      if (!carrier) {
        setNoStore(res);
        return res.status(404).type('html').send(renderCarrierNotFound());
      }
      const citySlug = carrier.city ? citySlugify(carrier.city) : '';
      const [related, cityCount, stateCount] = await Promise.all([
        // Count comes from queries.ts, not a literal here: the mesh's slot split
        // (city ring + corridor ring) has to add up to whatever this asks for.
        relatedCarriers(carrier, RELATED_LIMIT),
        carrier.state && citySlug ? cityCarrierCount(carrier.state, citySlug) : Promise.resolve(0),
        carrier.state ? stateCarrierCount(carrier.state) : Promise.resolve(0),
      ]);
      setPublicDirectoryCache(req, res);
      res.type('html').send(renderCarrierProfile({ carrier, related, cityCount, stateCount }));
    } catch (err) {
      next(err);
    }
  });

  // ── Complete city index: /directory/{state}/cities[/page/N] ──────────────
  // Registered BEFORE /directory/:stateSlug/:citySlug so "cities" is never
  // mistaken for a city slug.
  //
  // WHY IT EXISTS (measured 2026-08-29): sitemap-cities.xml advertises all
  // 24,728 US city hubs, but the ONLY internal links to city hubs came from the
  // top-24 cards on the state and city pages — 1,296 hubs linked, ~23,400
  // orphaned. Since a city hub is the only route to the 24 carriers on its first
  // page, that orphaning cascaded: the transitive closure of the link graph from
  // `/` reached ~32,600 of 330,218 carrier profiles (9.2%), and Google answered
  // the other 91% with "Discovered – currently not indexed", lastCrawl NEVER.
  // This index makes every city hub reachable in 3 clicks from the homepage.
  app.get(
    ['/directory/:stateSlug/cities', '/directory/:stateSlug/cities/page/:page'],
    publicAutocompleteLimiter,
    directorySearchLimiter,
    async (req: Request, res: Response, next) => {
      try {
        const state = stateBySlug(String(req.params.stateSlug));
        if (!state) return res.redirect(302, '/directory');
        const all = await allCitiesForState(state.code);
        const totalPages = cityIndexPageCount(all.length);
        // `/page/1` is a duplicate of the bare path — 301 rather than serve it,
        // so the series has exactly one URL per page of content.
        const raw = req.params.page;
        if (raw != null && !/^[1-9][0-9]*$/.test(String(raw))) {
          return res.redirect(301, cityIndexPath(state.slug, 1));
        }
        const page = raw == null ? 1 : parseInt(String(raw), 10);
        if (page === 1 && raw != null) return res.redirect(301, cityIndexPath(state.slug, 1));
        // Past the end of the series is a genuine 404, not a silently-clamped
        // duplicate — the same rule the ?page= guard already applies.
        if (page > totalPages) {
          setNoStore(res);
          res.setHeader('X-Robots-Tag', 'noindex');
          return res.status(404).type('html').send(renderDirectoryPageOutOfRange(totalPages, cityIndexPath(state.slug, 1)));
        }
        const slice = all.slice((page - 1) * CITY_INDEX_PER_PAGE, page * CITY_INDEX_PER_PAGE);
        setPublicDirectoryCache(req, res);
        res.type('html').send(renderStateCityIndex({ state, cities: slice, page, totalCities: all.length }));
      } catch (err) {
        next(err);
      }
    },
  );

  // City tier (registered BEFORE :stateSlug; port/carrier already win above).
  app.get(
    ['/directory/:stateSlug/:citySlug', '/directory/:stateSlug/:citySlug/page/:page'],
    publicAutocompleteLimiter,
    directorySearchLimiter,
    async (req: Request, res: Response, next) => {
    try {
      const state = stateBySlug(String(req.params.stateSlug));
      if (!state) return res.redirect(302, '/directory');
      const citySlug = citySlugify(String(req.params.citySlug));
      if (!citySlug) return res.redirect(302, `/directory/${state.slug}`);
      if (rejectBadPathPage(req, res, `/directory/${state.slug}/${citySlug}`)) return;
      if (rejectOutOfRangePage(req, res, `/directory/${state.slug}/${citySlug}`)) return;
      const filters = normalizeFilters(withPathPage(req), {
        state: state.code,
        citySlug,
        port: null,
      });
      // Unknown city → always 302 to the state page, even with facets present.
      // cityDisplayName is unfiltered, so it's the true "does this city exist"
      // check; using the FILTERED list.total would wrongly render a thin, empty,
      // indexable city page whenever a facet narrows a real city to zero rows.
      const name = await cityDisplayName(state.code, citySlug);
      if (!name) return res.redirect(302, `/directory/${state.slug}`);
      const list = await carriersByCity(state.code, citySlug, filters);
      const [counts, cities] = await Promise.all([
        getFacetCounts(filters),
        citiesForState(state.code, 24),
      ]);
      setPublicDirectoryCache(req, res);
      res.type('html').send(
        renderCityPage({
          state,
          city: { name: name ?? prettifySlug(citySlug), slug: citySlug },
          list,
          counts,
          filters,
          cities,
        }),
      );
    } catch (err) {
      next(err);
    }
    },
  );

  // State page.
  app.get(
    ['/directory/:stateSlug', '/directory/:stateSlug/page/:page'],
    publicAutocompleteLimiter,
    directorySearchLimiter,
    async (req: Request, res: Response, next) => {
      try {
        const state = stateBySlug(String(req.params.stateSlug));
        if (!state) return res.redirect(302, '/directory');
        if (rejectBadPathPage(req, res, `/directory/${state.slug}`)) return;
        if (rejectOutOfRangePage(req, res, `/directory/${state.slug}`)) return;
        const filters = normalizeFilters(withPathPage(req), {
          state: state.code,
          port: null,
          citySlug: null,
        });
        const [list, counts, cities] = await Promise.all([
          listCarriers({ filters }),
          getFacetCounts(filters),
          citiesForState(state.code, 24),
        ]);
        setPublicDirectoryCache(req, res);
        res.type('html').send(renderStatePage({ state, list, counts, filters, cities }));
      } catch (err) {
        next(err);
      }
    },
  );

  // Compliance tools.
  app.get(['/compliance', '/compliance/', '/tools/compliance'], async (req: Request, res: Response, next) => {
    try {
      const summary = await getDirectorySummary();
      setPublicDirectoryCache(req, res);
      res.type('html').send(renderCompliancePage(summary));
    } catch (err) {
      next(err);
    }
  });
}

// Re-export for callers that want the port list without importing two modules.
export { portByCode };
