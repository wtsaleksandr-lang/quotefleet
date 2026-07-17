/**
 * Route-map builder for the hosted quote.
 *
 * Draws the ACTUAL road route (not two pins) between pickup and delivery:
 *  1. Call the Google Directions API to get the route's encoded
 *     `overview_polyline` + driving distance.
 *  2. Render a Google Static Map with `path=enc:<polyline>` styled as a
 *     brand-blue route line, a green origin (A) marker and a red
 *     destination (B) marker.
 *  3. If Directions fails or is unavailable, gracefully fall back to a
 *     straight-line path between the two points so the panel still shows a
 *     real geographic lane rather than the "unavailable" state.
 *
 * Results are cached per lane (rounded origin+destination) so repeated quotes
 * on the same lane don't re-hit the Directions/Static APIs. Cost control.
 */
import { LruCache } from './lruCache.js';

export type LatLng = { lat: number; lng: number };

export type RouteMap = {
  url: string;
  distanceMiles: number | null;
  /** 'route' = real road polyline; 'straight' = fallback line between points. */
  kind: 'route' | 'straight';
};

/** Light (default) or dark day/night styling for the static map. */
export type MapTheme = 'light' | 'dark';

/** Normalize any caller input to a valid theme (default light). */
export function normalizeTheme(raw: unknown): MapTheme {
  return raw === 'dark' ? 'dark' : 'light';
}

// ── Per-tenant MAP STYLE ────────────────────────────────────────────────────
// A tenant picks how their calculator's map LOOKS (Customize → Map style). This
// is a separate axis from the light/dark widget theme: `branded` still follows
// the theme (navy for dark widgets, clean for light) so nothing changes for
// existing tenants; the other three are fixed regardless of theme.
//   branded     — on-brand navy + highlighted cobalt roads (the current look; DEFAULT)
//   grayscale   — clean, desaturated minimal gray with quiet labels (Tesla-like)
//   standard    — real Google Maps colors (no style overrides)
//   dark_routes — dark, dimmed base with the route line spotlighted (bright + thick)
export type MapStyle = 'branded' | 'grayscale' | 'standard' | 'dark_routes';

/** Canonical style keys (source of truth for the Zod enum + the picker). */
export const MAP_STYLE_KEYS = ['branded', 'grayscale', 'standard', 'dark_routes'] as const;

/** Human labels + one-line hints for the Customize picker. */
export const MAP_STYLE_LIST: Array<{ key: MapStyle; label: string; hint: string }> = [
  { key: 'branded', label: 'Branded', hint: 'On-brand navy map with highlighted roads.' },
  { key: 'grayscale', label: 'Minimal gray', hint: 'Clean, quiet gray — labels dialed back.' },
  { key: 'standard', label: 'Standard', hint: 'Real Google Maps colors.' },
  { key: 'dark_routes', label: 'Dark routes', hint: 'Dark base with the route line spotlighted.' },
];

/** Normalize any caller/tenant input to a valid style. null/unknown → branded,
 *  so existing tenants (null column) and bad query params are always safe. */
export function resolveMapStyle(raw: unknown): MapStyle {
  return raw === 'grayscale' || raw === 'standard' || raw === 'dark_routes' ? raw : 'branded';
}

// Brand blue route line (no teal). #0D3CFC.
const ROUTE_COLOR = '0x0D3CFCff';
// A/B markers reuse the home page's premium-palette shades (premium-palette.css:
// --success / --error): green pickup, coral-red destination.
const ORIGIN_COLOR = '0x36c98b'; // home success green — origin/pickup (A)
const DEST_COLOR = '0xf97373'; // home error red — destination (B)

// ── Branded map styles ─────────────────────────────────────────────────────
// Premium on-brand styling with HIGHLIGHTED ROADS (arterials + cobalt-tinted
// highways) on a navy (dark) / clean (light) base — replaces the old flat
// grayscale look. Both sets include the POI/transit hide rules; the cobalt
// route line + green/red A·B markers draw on top (unaffected by `style`).
const DARK_STYLES: string[] = [
  'element:geometry|color:0x0f1629',
  'element:labels.text.fill|color:0xaab6d4',
  'element:labels.text.stroke|color:0x0b1018',
  'feature:administrative|element:geometry|color:0x2a3557',
  'feature:administrative.country|element:geometry.stroke|color:0x3d4d7a',
  'feature:administrative.province|element:geometry.stroke|color:0x2a3557',
  'feature:landscape|element:geometry|color:0x131b30',
  'feature:poi|visibility:off',
  'feature:transit|visibility:off',
  'feature:water|element:geometry|color:0x070c18',
  'feature:water|element:labels.text.fill|color:0x40608a',
  'feature:road|element:geometry|color:0x283560',
  'feature:road|element:labels.text.fill|color:0x8ea0cc',
  'feature:road.arterial|element:geometry|color:0x33447e',
  'feature:road.highway|element:geometry|color:0x3f5cc0',
  'feature:road.highway|element:geometry.stroke|color:0x1c2848',
];
const LIGHT_STYLES: string[] = [
  'element:geometry|color:0xeef2fa',
  'element:labels.text.fill|color:0x55617d',
  'element:labels.text.stroke|color:0xffffff',
  'feature:administrative|element:geometry|color:0xc7d2e8',
  'feature:administrative.country|element:geometry.stroke|color:0xa8b7d8',
  'feature:administrative.province|element:geometry.stroke|color:0xc7d2e8',
  'feature:landscape|element:geometry|color:0xe7ecf6',
  'feature:poi|visibility:off',
  'feature:transit|visibility:off',
  'feature:water|element:geometry|color:0xc2d4f0',
  'feature:water|element:labels.text.fill|color:0x7f9bc4',
  'feature:road|element:geometry|color:0xffffff',
  'feature:road|element:labels.text.fill|color:0x6a7796',
  'feature:road.arterial|element:geometry|color:0xdae3f6',
  'feature:road.highway|element:geometry|color:0x9fbcf3',
  'feature:road.highway|element:geometry.stroke|color:0x6f97e6',
];
function themeStyles(theme: MapTheme): string[] {
  return theme === 'dark' ? DARK_STYLES : LIGHT_STYLES;
}

// ── Named map-style specs (per-tenant `mapStyle`) ───────────────────────────
// `grayscale` — a fully desaturated, minimal map. Land/road in light grays,
// muted labels, POI/transit hidden; the cobalt route + A·B markers pop on top.
const GRAYSCALE_STYLES: string[] = [
  'element:geometry|color:0xf2f3f5',
  'element:labels.text.fill|color:0x9aa0a6',
  'element:labels.text.stroke|color:0xffffff',
  'feature:administrative|element:geometry|color:0xd6d9de',
  'feature:administrative.country|element:geometry.stroke|color:0xb9bdc4',
  'feature:administrative.province|element:geometry.stroke|color:0xd6d9de',
  'feature:landscape|element:geometry|color:0xeceef1',
  'feature:poi|visibility:off',
  'feature:transit|visibility:off',
  'feature:water|element:geometry|color:0xdfe3e8',
  'feature:water|element:labels.text.fill|color:0xa7adb5',
  'feature:road|element:geometry|color:0xffffff',
  'feature:road|element:labels.text.fill|color:0x9aa0a6',
  'feature:road.arterial|element:geometry|color:0xe7e9ec',
  'feature:road.highway|element:geometry|color:0xd4d7dc',
  'feature:road.highway|element:geometry.stroke|color:0xc2c6cd',
];
// `dark_routes` — near-black base with DIMMED roads (no cobalt highway tint like
// branded-dark), so the brighter/thicker route line reads as the one highlight.
const DARK_ROUTES_STYLES: string[] = [
  'element:geometry|color:0x0a0e1a',
  'element:labels.text.fill|color:0x6b7699',
  'element:labels.text.stroke|color:0x070a12',
  'feature:administrative|element:geometry|color:0x1c2540',
  'feature:administrative.country|element:geometry.stroke|color:0x2a3557',
  'feature:administrative.province|element:geometry.stroke|color:0x1c2540',
  'feature:landscape|element:geometry|color:0x0d1220',
  'feature:poi|visibility:off',
  'feature:transit|visibility:off',
  'feature:water|element:geometry|color:0x05080f',
  'feature:water|element:labels.text.fill|color:0x30425f',
  'feature:road|element:geometry|color:0x1a2136',
  'feature:road|element:labels.text.fill|color:0x5a6a94',
  'feature:road.arterial|element:geometry|color:0x1f2740',
  'feature:road.highway|element:geometry|color:0x263053',
  'feature:road.highway|element:geometry.stroke|color:0x161d33',
];

/** Resolve the Static Maps `style=` spec list for a (theme, mapStyle) pair.
 *  `branded` follows the light/dark theme (unchanged); the others are fixed.
 *  `standard` returns [] → no style overrides → real Google Maps colors. */
function styleSpecs(theme: MapTheme, mapStyle: MapStyle): string[] {
  switch (mapStyle) {
    case 'grayscale':
      return GRAYSCALE_STYLES;
    case 'standard':
      return [];
    case 'dark_routes':
      return DARK_ROUTES_STYLES;
    case 'branded':
    default:
      return themeStyles(theme);
  }
}

// The route polyline stays clearly visible on EVERY style. Most styles use the
// brand cobalt at weight 4; `dark_routes` spotlights it with a brighter
// periwinkle at a heavier weight so it's the map's focal point.
const DARK_ROUTES_LINE = '0x5B8CFFff';
function routeLine(mapStyle: MapStyle): { color: string; weight: string } {
  return mapStyle === 'dark_routes'
    ? { color: DARK_ROUTES_LINE, weight: '6' }
    : { color: ROUTE_COLOR, weight: '4' };
}

// Retina-sized to balance the left-column panel (img renders ~210px tall,
// object-fit:cover). 640 is the free-tier max width; scale:2 = 1280px.
const MAP_SIZE = '640x360';
const MAP_SCALE = '2';

// Lane cache: key = rounded origin+destination. 24h TTL, 500 lanes.
const routeCache = new LruCache<RouteMap>(500, 24 * 60 * 60 * 1000);

const METERS_PER_MILE = 1609.344;

function round5(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}

export function laneCacheKey(origin: LatLng, destination: LatLng): string {
  return `${round5(origin.lat)},${round5(origin.lng)}|${round5(destination.lat)},${round5(destination.lng)}`;
}

/**
 * Build the Google Static Maps URL for a lane. Pure + deterministic so it can
 * be unit-tested. When `encodedPolyline` is provided the route follows the
 * real road geometry (`path=enc:`); otherwise a straight line is drawn between
 * origin and destination.
 */
export function buildStaticMapUrl(
  apiKey: string,
  origin: LatLng,
  destination: LatLng,
  encodedPolyline?: string | null,
  theme: MapTheme = 'light',
  mapStyle: MapStyle = 'branded'
): string {
  const params = new URLSearchParams({
    size: MAP_SIZE,
    scale: MAP_SCALE,
    maptype: 'roadmap',
    key: apiKey,
  });
  // Per-tenant map style: branded (theme-aware navy/clean), grayscale, standard
  // (no overrides), or dark_routes. The A/B markers + route line are overlays
  // drawn on top of any style, so they always pop.
  for (const s of styleSpecs(theme, mapStyle)) params.append('style', s);
  // Green origin (A), red destination (B).
  params.append('markers', `color:${ORIGIN_COLOR}|label:A|${origin.lat},${origin.lng}`);
  params.append('markers', `color:${DEST_COLOR}|label:B|${destination.lat},${destination.lng}`);
  const line = routeLine(mapStyle);
  if (encodedPolyline) {
    // Real road route — Google returns the polyline already URL-safe/encoded.
    params.append('path', `color:${line.color}|weight:${line.weight}|enc:${encodedPolyline}`);
  } else {
    // Fallback: straight line between the two points.
    params.append('path', `color:${line.color}|weight:${line.weight}|${origin.lat},${origin.lng}|${destination.lat},${destination.lng}`);
  }
  return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
}

// ── North America base map (no route) ──────────────────────────────────────
// The widget's map card shows this the moment it loads — before any address is
// entered — then swaps to the real routed lane once pickup + delivery resolve.
// A single deterministic map (fixed center/zoom, no markers or path), styled
// identically to the route maps so the swap reads as a zoom-in, not a change.
const BASE_MAP_CENTER = '44,-97'; // frames the contiguous US + southern Canada + N. Mexico
const BASE_MAP_ZOOM = '3';

export function buildBaseMapUrl(
  apiKey: string,
  theme: MapTheme = 'light',
  mapStyle: MapStyle = 'branded'
): string {
  const params = new URLSearchParams({
    size: MAP_SIZE,
    scale: MAP_SCALE,
    maptype: 'roadmap',
    center: BASE_MAP_CENTER,
    zoom: BASE_MAP_ZOOM,
    key: apiKey,
  });
  for (const s of styleSpecs(theme, mapStyle)) params.append('style', s);
  return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
}

type DirectionsResult = { polyline: string; distanceMeters: number } | null;

/**
 * Call the Google Directions API for the driving route. Returns the encoded
 * overview polyline + total distance, or null on any failure (so the caller
 * can fall back to a straight line).
 */
export async function fetchDirections(
  origin: LatLng,
  destination: LatLng,
  apiKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<DirectionsResult> {
  const url = new URL('https://maps.googleapis.com/maps/api/directions/json');
  url.searchParams.set('origin', `${origin.lat},${origin.lng}`);
  url.searchParams.set('destination', `${destination.lat},${destination.lng}`);
  url.searchParams.set('mode', 'driving');
  url.searchParams.set('units', 'imperial');
  url.searchParams.set('key', apiKey);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);
  try {
    const r = await fetchImpl(url, { signal: controller.signal });
    if (!r.ok) return null;
    type DirResp = {
      status: string;
      routes?: Array<{
        overview_polyline?: { points?: string };
        legs?: Array<{ distance?: { value?: number } }>;
      }>;
    };
    const data = (await r.json()) as DirResp;
    if (data.status !== 'OK') return null;
    const route = data.routes?.[0];
    const polyline = route?.overview_polyline?.points;
    if (!polyline) return null;
    const distanceMeters = (route?.legs ?? []).reduce(
      (sum, leg) => sum + (leg.distance?.value ?? 0),
      0
    );
    return { polyline, distanceMeters };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Resolve the route map for a lane: cache → Directions (real route) →
 * straight-line fallback. Returns null only when there's genuinely no usable
 * geometry (missing key or missing coordinates).
 */
export async function getRouteMap(
  origin: LatLng | undefined,
  destination: LatLng | undefined,
  apiKey: string | undefined,
  theme: MapTheme = 'light',
  fetchImpl: typeof fetch = fetch,
  mapStyle: MapStyle = 'branded'
): Promise<RouteMap | null> {
  if (!origin || !destination || !apiKey) return null;

  // Cache key includes theme AND map style so distinct looks render to distinct
  // entries and never serve each other's styled URL (no cross-contamination).
  const key = `${laneCacheKey(origin, destination)}|${theme}|${mapStyle}`;
  const cached = routeCache.get(key);
  if (cached) return cached;

  const directions = await fetchDirections(origin, destination, apiKey, fetchImpl);
  const result: RouteMap = directions
    ? {
        url: buildStaticMapUrl(apiKey, origin, destination, directions.polyline, theme, mapStyle),
        distanceMiles: directions.distanceMeters
          ? Math.round(directions.distanceMeters / METERS_PER_MILE)
          : null,
        kind: 'route',
      }
    : {
        url: buildStaticMapUrl(apiKey, origin, destination, null, theme, mapStyle),
        distanceMiles: null,
        kind: 'straight',
      };

  routeCache.set(key, result);
  return result;
}

/** Read-only peek at the lane cache. Lets the widget's preview PNG endpoint
 *  serve a map that a prior route-preview call already generated + cached, so
 *  it never renders an arbitrary map on demand. Key is `${laneCacheKey}|${theme}|${mapStyle}`. */
export function peekRouteMap(key: string): RouteMap | undefined {
  return routeCache.get(key);
}

// Test-only: clear the lane cache between cases.
export function __clearRouteCache(): void {
  routeCache.clear();
}
