/**
 * Public route-snapshot map PROXY — GET /api/public/quote-map/:refId.png
 *
 * Why this exists (SECURITY): the hosted quote used to embed the raw Google
 * Static Maps URL — `https://maps.googleapis.com/...&key=<KEY>` — directly as an
 * <img src>, leaking the (unrestricted) Maps API key to every browser. This
 * proxy keeps the key strictly server-side: it resolves the lane, calls Google
 * server-side, fetches the PNG in-process, and streams ONLY the image bytes
 * back. The key never appears in any response, header, or client-visible field.
 *
 * ANTI-ABUSE: the endpoint is refId-gated — it only renders a map for the
 * pickup/delivery coordinates already stored on a REAL lead, so it can't be
 * driven with attacker-supplied coordinates. The tenant must be `active`. It's
 * rate-limited (quoteMapLimiter) and the rendered PNG is persisted in
 * route_map_cache, so a cache hit serves stored bytes and never re-bills Google
 * across redeploys / multiple instances. Browsers cache it for a week.
 *
 * ?theme=light|dark selects the day/night styling (distinct cache entries).
 */
import type { Express, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { tenants, leads, routeMapCache, brandConfigs } from '../../db/schema.js';
import { loadEnv } from '../../config.js';
import { quoteMapLimiter } from '../rateLimits.js';
import { getRouteMap, laneCacheKey, normalizeTheme, resolveMapStyle, type LatLng } from '../routeMap.js';

// Browsers/proxies may cache the rendered snapshot for a week — the lane
// geometry for a given quote never changes.
const PNG_MAX_AGE_SECONDS = 604800;

function coord(lat: number | null, lng: number | null): LatLng | undefined {
  return typeof lat === 'number' && typeof lng === 'number' ? { lat, lng } : undefined;
}

/** Load a persisted PNG for the lane+theme cache key, or null on miss. */
async function loadCachedPng(cacheKey: string): Promise<Buffer | null> {
  const rows = await db()
    .select()
    .from(routeMapCache)
    .where(eq(routeMapCache.cacheKey, cacheKey))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  try {
    return Buffer.from(row.pngBase64, 'base64');
  } catch {
    return null;
  }
}

/** Persist a rendered PNG (best-effort; a concurrent request may win the race). */
async function storeCachedPng(cacheKey: string, png: Buffer, kind: string): Promise<void> {
  try {
    await db()
      .insert(routeMapCache)
      .values({ cacheKey, pngBase64: png.toString('base64'), kind })
      .onConflictDoNothing();
  } catch (err) {
    console.warn('[quote-map] cache store failed (non-fatal):', err);
  }
}

function sendPng(res: Response, png: Buffer): void {
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', `public, max-age=${PNG_MAX_AGE_SECONDS}, immutable`);
  res.status(200).end(png);
}

export function registerQuoteMapRoutes(app: Express): void {
  // `:file` (not `:refId.png`) so the whole segment — including the `.png`
  // suffix — is captured as one param under Express 5 / path-to-regexp v8,
  // then we strip `.png` to recover the refId. Emitted URLs still end in `.png`
  // so email clients + browsers treat the link as an image.
  app.get('/api/public/quote-map/:file', quoteMapLimiter, async (req: Request, res: Response) => {
    const refId = String(req.params.file ?? '').replace(/\.png$/i, '').trim();
    if (!refId) return res.status(400).json({ error: 'Missing refId' });

    const theme = normalizeTheme(req.query.theme);

    // Load the lead by refId, then its tenant — same shape as the quote-doc
    // route. Public read (no tenant scope) but the tenant must be active.
    const leadRows = await db().select().from(leads).where(eq(leads.refId, refId)).limit(1);
    const lead = leadRows[0];
    if (!lead) return res.status(404).json({ error: 'Quote not found' });

    const tenantRows = await db().select().from(tenants).where(eq(tenants.id, lead.tenantId)).limit(1);
    const tenant = tenantRows[0];
    if (!tenant || tenant.status !== 'active') return res.status(404).json({ error: 'Carrier not found' });

    const origin = coord(lead.pickupLat, lead.pickupLng);
    const destination = coord(lead.deliveryLat, lead.deliveryLng);
    if (!origin || !destination) return res.status(404).json({ error: 'No route coordinates for this quote' });

    // Per-tenant map style (Customize → Map style); null resolves to 'branded'.
    const brandRows = await db()
      .select({ mapStyle: brandConfigs.mapStyle })
      .from(brandConfigs)
      .where(eq(brandConfigs.tenantId, lead.tenantId))
      .limit(1);
    const mapStyle = resolveMapStyle(brandRows[0]?.mapStyle);

    // Persistent cache: lane + theme + style. A hit never touches Google, and
    // the style in the key keeps distinct looks from cross-contaminating.
    const cacheKey = `${laneCacheKey(origin, destination)}|${theme}|${mapStyle}`;
    const cached = await loadCachedPng(cacheKey);
    if (cached) return sendPng(res, cached);

    const env = loadEnv();
    if (!env.GOOGLE_MAPS_API_KEY) return res.status(404).json({ error: 'Map unavailable' });

    // Resolve the Static Maps URL server-side (WITH the key — stays in-process),
    // then fetch the PNG bytes here so the key never reaches the client.
    const route = await getRouteMap(origin, destination, env.GOOGLE_MAPS_API_KEY, theme, undefined, mapStyle);
    if (!route) return res.status(404).json({ error: 'Map unavailable' });

    let png: Buffer;
    try {
      const upstream = await fetch(route.url);
      if (!upstream.ok) {
        console.warn(`[quote-map] upstream ${upstream.status} for ${refId} (${theme})`);
        return res.status(502).json({ error: 'Map render failed' });
      }
      png = Buffer.from(await upstream.arrayBuffer());
    } catch (err) {
      console.warn('[quote-map] upstream fetch failed (non-fatal):', err);
      return res.status(502).json({ error: 'Map render failed' });
    }

    await storeCachedPng(cacheKey, png, route.kind);
    return sendPng(res, png);
  });
}
