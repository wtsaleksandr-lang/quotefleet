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
  cityDisplayName,
  cityCarrierCount,
  stateCarrierCount,
  relatedCarriers,
  getFacetCounts,
  getHeroCarriers,
  normalizeFilters,
  citySlugify,
  FACET_QUERY_KEYS,
  DEFAULT_PER_PAGE,
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
  renderCompliancePage,
  renderDirectoryJoin,
} from '../directory/pages.js';
import { publicAutocompleteLimiter, publicCalcLimiter } from '../rateLimits.js';
import { hasDirectoryPro, directoryIdentity } from '../directory/entitlement.js';

const isIntermodal = (v: unknown): boolean => ['1', 'true', 'yes'].includes(String(v ?? '').toLowerCase());
const pageNum = (v: unknown): number => Math.max(1, parseInt(String(v ?? '1'), 10) || 1);

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

export function registerDirectoryRoutes(app: Express) {
  // ── JSON API ───────────────────────────────────────────────────────────
  app.get('/api/public/directory', publicAutocompleteLimiter, async (req: Request, res: Response) => {
    const result = await listCarriers({
      state: req.query.state ? String(req.query.state) : null,
      port: req.query.port ? String(req.query.port) : null,
      intermodal: isIntermodal(req.query.intermodal),
      page: pageNum(req.query.page),
      perPage: req.query.perPage ? parseInt(String(req.query.perPage), 10) : DEFAULT_PER_PAGE,
    });
    return res.json(result);
  });

  app.get('/api/public/directory/summary', publicAutocompleteLimiter, async (_req: Request, res: Response) => {
    return res.json(await getDirectorySummary());
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
  app.get(['/directory', '/directory/'], publicAutocompleteLimiter, async (req: Request, res: Response, next) => {
    try {
      if (!hasFacetParams(req.query as Record<string, unknown>)) {
        // Post-checkout confirmation (Stripe success_url / cancel_url land here).
        const up = String(req.query.upgrade ?? '').toLowerCase();
        const upgrade = up === 'success' ? 'success' : up === 'cancelled' ? 'cancelled' : null;
        res.type('html').send(renderDirectoryLanding(await getDirectorySummary(), { upgrade }));
        return;
      }
      const filters = normalizeFilters(req.query as Record<string, unknown>);
      const [list, counts, summary] = await Promise.all([
        listCarriers({ filters }),
        getFacetCounts(filters),
        getDirectorySummary(),
      ]);
      res.type('html').send(renderDirectoryResults({ filters, list, counts, summary }));
    } catch (err) {
      next(err);
    }
  });

  // Shipper Directory Pro join / sign-in / subscribe surface. Registered BEFORE
  // /directory/:stateSlug so "join" isn't parsed as a state slug. Soft-auth:
  // anonymous → email form; signed-in free → subscribe; Pro → manage.
  app.get('/directory/join', async (req: Request, res: Response, next) => {
    try {
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
  app.get('/directory/port/:port', publicAutocompleteLimiter, async (req: Request, res: Response, next) => {
    try {
      const code = String(req.params.port).toUpperCase();
      const group = portGroupByCode(code) ?? portGroupForMemberCode(code);
      if (!group) return res.redirect(302, '/directory');
      if (code !== group.code) {
        const qs = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
        return res.redirect(301, `/directory/port/${group.code}${qs}`);
      }
      const port = portGroupAsPort(group);
      const filters = normalizeFilters(req.query as Record<string, unknown>, { port: group.code, state: null, citySlug: null });
      const [list, counts] = await Promise.all([listCarriers({ filters }), getFacetCounts(filters)]);
      res.type('html').send(renderPortPage({ port, list, counts, filters }));
    } catch (err) {
      next(err);
    }
  });

  // Carrier profile (registered BEFORE the :stateSlug route so it wins).
  app.get('/directory/carrier/:slug', async (req: Request, res: Response, next) => {
    try {
      const carrier = await carrierBySlug(String(req.params.slug));
      if (!carrier) return res.status(404).type('html').send(renderCarrierNotFound());
      const citySlug = carrier.city ? citySlugify(carrier.city) : '';
      const [related, cityCount, stateCount, isPro] = await Promise.all([
        relatedCarriers(carrier, 6),
        carrier.state && citySlug ? cityCarrierCount(carrier.state, citySlug) : Promise.resolve(0),
        carrier.state ? stateCarrierCount(carrier.state) : Promise.resolve(0),
        hasDirectoryPro(req),
      ]);
      res.type('html').send(renderCarrierProfile({ carrier, related, cityCount, stateCount, isPro }));
    } catch (err) {
      next(err);
    }
  });

  // City tier (registered BEFORE :stateSlug; port/carrier already win above).
  app.get('/directory/:stateSlug/:citySlug', publicAutocompleteLimiter, async (req: Request, res: Response, next) => {
    try {
      const state = stateBySlug(String(req.params.stateSlug));
      if (!state) return res.redirect(302, '/directory');
      const citySlug = citySlugify(String(req.params.citySlug));
      if (!citySlug) return res.redirect(302, `/directory/${state.slug}`);
      const filters = normalizeFilters(req.query as Record<string, unknown>, {
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
  });

  // State page.
  app.get('/directory/:stateSlug', publicAutocompleteLimiter, async (req: Request, res: Response, next) => {
    try {
      const state = stateBySlug(String(req.params.stateSlug));
      if (!state) return res.redirect(302, '/directory');
      const filters = normalizeFilters(req.query as Record<string, unknown>, {
        state: state.code,
        port: null,
        citySlug: null,
      });
      const [list, counts, cities] = await Promise.all([
        listCarriers({ filters }),
        getFacetCounts(filters),
        citiesForState(state.code, 24),
      ]);
      res.type('html').send(renderStatePage({ state, list, counts, filters, cities }));
    } catch (err) {
      next(err);
    }
  });

  // Compliance tools.
  app.get(['/compliance', '/compliance/', '/tools/compliance'], async (_req: Request, res: Response, next) => {
    try {
      res.type('html').send(renderCompliancePage(await getDirectorySummary()));
    } catch (err) {
      next(err);
    }
  });
}

// Re-export for callers that want the port list without importing two modules.
export { portByCode };
