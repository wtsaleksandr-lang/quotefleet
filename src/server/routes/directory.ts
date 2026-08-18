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
import { getDirectorySummary, listCarriers, carrierBySlug, DEFAULT_PER_PAGE } from '../directory/queries.js';
import { CONTAINER_PORTS, portByCode } from '../directory/containerPorts.js';
import { stateBySlug } from '../directory/usStates.js';
import { lookupCarrierCompliance } from '../directory/fmcsaLookup.js';
import {
  renderDirectoryLanding,
  renderStatePage,
  renderPortPage,
  renderCarrierProfile,
  renderCarrierNotFound,
  renderCompliancePage,
} from '../directory/pages.js';
import { publicAutocompleteLimiter, publicCalcLimiter } from '../rateLimits.js';

const isIntermodal = (v: unknown): boolean => ['1', 'true', 'yes'].includes(String(v ?? '').toLowerCase());
const pageNum = (v: unknown): number => Math.max(1, parseInt(String(v ?? '1'), 10) || 1);

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
  // Landing.
  app.get(['/directory', '/directory/'], async (_req: Request, res: Response, next) => {
    try {
      res.type('html').send(renderDirectoryLanding(await getDirectorySummary()));
    } catch (err) {
      next(err);
    }
  });

  // Port page (registered BEFORE the :stateSlug route so it wins).
  app.get('/directory/port/:port', async (req: Request, res: Response, next) => {
    try {
      const code = String(req.params.port).toUpperCase();
      const port = portByCode(code) ?? CONTAINER_PORTS.find((p) => p.code === code) ?? null;
      if (!port) return res.redirect(302, '/directory');
      const intermodal = isIntermodal(req.query.intermodal);
      const list = await listCarriers({ port: code, intermodal, page: pageNum(req.query.page) });
      res.type('html').send(renderPortPage({ port, list, intermodalOnly: intermodal }));
    } catch (err) {
      next(err);
    }
  });

  // Carrier profile (registered BEFORE the :stateSlug route so it wins).
  app.get('/directory/carrier/:slug', async (req: Request, res: Response, next) => {
    try {
      const carrier = await carrierBySlug(String(req.params.slug));
      if (!carrier) return res.status(404).type('html').send(renderCarrierNotFound());
      res.type('html').send(renderCarrierProfile({ carrier }));
    } catch (err) {
      next(err);
    }
  });

  // State page.
  app.get('/directory/:stateSlug', async (req: Request, res: Response, next) => {
    try {
      const state = stateBySlug(String(req.params.stateSlug));
      if (!state) return res.redirect(302, '/directory');
      const intermodal = isIntermodal(req.query.intermodal);
      const list = await listCarriers({ state: state.code, intermodal, page: pageNum(req.query.page) });
      res.type('html').send(renderStatePage({ state, list, intermodalOnly: intermodal }));
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
