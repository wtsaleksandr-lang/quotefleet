/**
 * PUBLIC prospect-demo routes — the shareable /demo/:token preview + the API it
 * needs. Registered BEFORE the tenant public routes so these handlers get first
 * crack at the shared `/api/public/{widget,quote,lead,route-preview}/:slug`
 * paths: each looks the slug up as a demo TOKEN and, when it matches, serves a
 * prospect-shaped response; otherwise it calls next() and the normal tenant
 * handler runs. That lets the REAL widget (widget.js) drive a demo with ZERO
 * changes — the demo page just sets the widget's slug to the demo token.
 *
 * Isolation: a demo is a `prospect_demos` row. These routes NEVER create a
 * tenant/user/lead — the quote runs the calc engine over in-memory sample rates,
 * and a demo lead submission is acknowledged but not persisted.
 */
import type { Express, Request, Response, NextFunction, RequestHandler } from 'express';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { currencyForCountry, customerFacingLines, MAX_QUOTABLE_WEIGHT_LBS, type CalcRequest } from '../../calc/engine.js';
import { distanceBetween } from '../../calc/distance.js';
import { estimateTransit } from '../../calc/transit.js';
import { loadEnv } from '../../config.js';
import { publicDemoLimiter } from '../rateLimits.js';
import { getRouteMap, laneCacheKey, normalizeTheme, resolveMapStyle } from '../routeMap.js';
import { dbProspectDemoStore, type ProspectDemoStore } from '../outreach/prospectDemoStore.js';
import {
  buildProspectWidgetConfig,
  computeProspectQuote,
  DEMO_PORTS,
  type ProspectDemoRecord,
} from '../outreach/prospectDemo.js';

export interface ProspectDemoRouteDeps {
  store?: ProspectDemoStore;
  /** Override the public dir (tests). Defaults to the served public folder. */
  publicDir?: string;
}

const LocationSchema = z.object({
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  country: z.string().optional(),
  portCode: z.string().optional(),
  terminalCode: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
});

const QuoteSchema = z.object({
  service: z.string(),
  equipment: z.string(),
  pickup: LocationSchema,
  delivery: LocationSchema,
  weightLbs: z.number().optional(),
  pieces: z.number().optional(),
  lengthIn: z.number().optional(),
  widthIn: z.number().optional(),
  heightIn: z.number().optional(),
  freightClass: z.number().positive().optional(),
  selectedAccessorialCodes: z.array(z.string()).optional(),
  flags: z.record(z.string(), z.unknown()).optional(),
});

/** Resolve a demo port code to lat/lng so drayage quotes work WITHOUT depending
 *  on the DB `ports` table — the sample demo ports carry their own coordinates. */
function resolveDemoLocation(loc: z.infer<typeof LocationSchema>): z.infer<typeof LocationSchema> {
  if (loc.lat != null && loc.lng != null) return loc;
  const hasLocation = !!(loc.zip || loc.city || loc.address);
  if (hasLocation || !loc.portCode) return loc;
  const port = DEMO_PORTS.find((p) => p.code === loc.portCode);
  if (!port) return loc;
  return { ...loc, city: loc.city ?? port.city, state: loc.state ?? port.state, country: loc.country ?? port.country, lat: port.lat, lng: port.lng };
}

export function registerProspectDemoRoutes(app: Express, deps: ProspectDemoRouteDeps = {}) {
  const store = deps.store ?? dbProspectDemoStore;
  const publicDir = deps.publicDir ?? resolve(process.cwd(), 'src/server/public');

  /** Run a handler behind the demo limiter only once we know it's a demo hit
   *  (so non-demo fall-throughs never touch this limiter). */
  const withLimiter = (req: Request, res: Response, run: () => void) => {
    (publicDemoLimiter as RequestHandler)(req, res, () => run());
  };

  // ── Widget config (prospect fallback) ─────────────────────────────────
  app.get('/api/public/widget/:slug', async (req: Request, res: Response, next: NextFunction) => {
    let demo: ProspectDemoRecord | null;
    try {
      demo = await store.getByToken(String(req.params.slug));
    } catch {
      return next();
    }
    if (!demo) return next();
    return withLimiter(req, res, () => res.json(buildProspectWidgetConfig(demo!)));
  });

  // ── Compute a quote from the sample rates (no DB write) ────────────────
  app.post('/api/public/quote/:slug', async (req: Request, res: Response, next: NextFunction) => {
    let demo: ProspectDemoRecord | null;
    try {
      demo = await store.getByToken(String(req.params.slug));
    } catch {
      return next();
    }
    if (!demo) return next();
    return withLimiter(req, res, async () => {
      const parse = QuoteSchema.safeParse(req.body);
      if (!parse.success) return res.status(400).json({ error: 'Invalid input', details: parse.error.flatten() });
      const body = parse.data;
      if (typeof body.weightLbs === 'number' && body.weightLbs > MAX_QUOTABLE_WEIGHT_LBS) {
        return res.status(400).json({ error: 'That load is over the legal highway weight limit.' });
      }
      const pickup = resolveDemoLocation(body.pickup);
      const dist = await distanceBetween(pickup, body.delivery);
      if ('error' in dist) return res.status(400).json({ error: dist.error });

      const calcReq: CalcRequest = {
        service: body.service,
        equipment: body.equipment,
        miles: dist.miles,
        weightLbs: body.weightLbs,
        pieces: body.pieces,
        lengthIn: body.lengthIn,
        widthIn: body.widthIn,
        heightIn: body.heightIn,
        freightClass: body.freightClass,
        pickupCity: pickup.city,
        pickupState: pickup.state,
        pickupZip: pickup.zip,
        pickupCountry: pickup.country,
        pickupLat: dist.origin.lat,
        pickupLng: dist.origin.lng,
        deliveryCity: body.delivery.city,
        deliveryState: body.delivery.state,
        deliveryZip: body.delivery.zip,
        deliveryCountry: body.delivery.country,
        deliveryLat: dist.destination.lat,
        deliveryLng: dist.destination.lng,
        pickupPortCode: pickup.portCode,
        deliveryPortCode: body.delivery.portCode,
        pickupTerminalCode: pickup.terminalCode,
        deliveryTerminalCode: body.delivery.terminalCode,
        selectedAccessorialCodes: body.selectedAccessorialCodes,
        flags: body.flags as CalcRequest['flags'],
        currency: currencyForCountry(demo!.configJson?.countryFocus ?? 'US', body.delivery.country ?? pickup.country),
      };
      const result = computeProspectQuote(demo!.configJson, calcReq);
      const customerResult = { ...result, margin: 0, lines: customerFacingLines(result.lines) };
      return res.json({
        miles: dist.miles,
        origin: dist.origin,
        destination: dist.destination,
        result: customerResult,
        transit: estimateTransit(dist.miles, body.service),
      });
    });
  });

  // ── Lead submit (acknowledged, NEVER persisted — demo isolation) ───────
  app.post('/api/public/lead/:slug', async (req: Request, res: Response, next: NextFunction) => {
    let demo: ProspectDemoRecord | null;
    try {
      demo = await store.getByToken(String(req.params.slug));
    } catch {
      return next();
    }
    if (!demo) return next();
    // No tenant → no lead row, no email, no AI. The demo's real conversion is
    // the /signup CTA on the demo page. The widget shows a clean confirmation
    // (no refId → "Your request was sent.").
    return withLimiter(req, res, () => res.json({ ok: true, demo: true }));
  });

  // ── Route-preview map (prospect fallback) ─────────────────────────────
  app.post('/api/public/route-preview/:slug', async (req: Request, res: Response, next: NextFunction) => {
    let demo: ProspectDemoRecord | null;
    try {
      demo = await store.getByToken(String(req.params.slug));
    } catch {
      return next();
    }
    if (!demo) return next();
    return withLimiter(req, res, async () => {
      const body = (req.body ?? {}) as { pickup?: unknown; delivery?: unknown; service?: string; theme?: unknown };
      if (!body.pickup || !body.delivery) return res.json({ ok: false });
      try {
        const parsedPickup = LocationSchema.safeParse(body.pickup);
        const parsedDelivery = LocationSchema.safeParse(body.delivery);
        if (!parsedPickup.success || !parsedDelivery.success) return res.json({ ok: false });
        const pickup = resolveDemoLocation(parsedPickup.data);
        const dist = await distanceBetween(pickup, parsedDelivery.data);
        if ('error' in dist) return res.json({ ok: false });
        const theme = normalizeTheme(body.theme);
        const mapStyle = resolveMapStyle(null); // demo → the default 'branded' look
        const rm = await getRouteMap(dist.origin, dist.destination, loadEnv().GOOGLE_MAPS_API_KEY, theme, undefined, mapStyle);
        const lane = laneCacheKey(dist.origin, dist.destination);
        return res.json({
          ok: true,
          miles: dist.miles ?? null,
          transit: estimateTransit(dist.miles, typeof body.service === 'string' ? body.service : ''),
          origin: dist.origin,
          destination: dist.destination,
          mapUrl: rm ? `/api/public/route-map.png?lane=${encodeURIComponent(lane)}&theme=${theme}&style=${mapStyle}` : null,
        });
      } catch {
        return res.json({ ok: false });
      }
    });
  });

  // ── Public demo page ──────────────────────────────────────────────────
  app.get('/demo/:token', async (req: Request, res: Response, next: NextFunction) => {
    const token = String(req.params.token);
    let demo: ProspectDemoRecord | null;
    try {
      demo = await store.getByToken(token);
    } catch (err) {
      return next(err);
    }
    if (!demo) {
      return res.status(404).type('html').send(demoNotFoundPage());
    }
    // Mark first view (best-effort — never block the page render on it).
    store.markViewed(token).catch(() => {});

    const brand = demo.brandJson ?? { primary: null, secondary: null, logoUrl: null, companyName: null };
    const company = brand.companyName || demo.companyName || demo.domain;
    const cfg = { token, company, domain: demo.domain, brandPrimary: brand.primary, brandSecondary: brand.secondary, logoUrl: brand.logoUrl, widgetUrl: `/w/${encodeURIComponent(token)}`, signupUrl: `/signup?company=${encodeURIComponent(company)}&domain=${encodeURIComponent(demo.domain)}`, primaryMode: demo.configJson?.primaryMode ?? 'ftl' };
    try {
      const html = await readFile(resolve(publicDir, 'demo.html'), 'utf8');
      const inject = `<script>window.QF_DEMO=${JSON.stringify(cfg).replace(/</g, '\\u003c')};</script>\n`;
      return res
        .type('html')
        .send(html.replace('<script src="/demo.js"></script>', inject + '<script src="/demo.js"></script>'));
    } catch (err) {
      return next(err);
    }
  });
}

function demoNotFoundPage(): string {
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Demo not found · QuoteFleet</title>',
    '<link rel="stylesheet" href="/style.css">',
    '</head><body style="display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center">',
    '<div style="max-width:420px;padding:32px">',
    '<h1>This demo isn\u2019t available</h1>',
    '<p class="muted">The preview link may have expired. Build your own branded quote calculator in minutes.</p>',
    '<p><a class="btn btn-primary" href="/signup">Get started free</a></p>',
    '</div></body></html>',
  ].join('');
}
