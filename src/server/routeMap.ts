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

// Brand blue route line (no teal). #0D3CFC.
const ROUTE_COLOR = '0x0D3CFCff';
const ORIGIN_COLOR = '0x16a34a'; // green — origin (A)
const DEST_COLOR = '0xef4444'; // red — destination (B)

// Retina-sized to balance the left-column panel (img renders ~210px tall,
// object-fit:cover). 640 is the free-tier max width; scale:2 = 1280px.
const MAP_SIZE = '640x272';
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
  encodedPolyline?: string | null
): string {
  const params = new URLSearchParams({
    size: MAP_SIZE,
    scale: MAP_SCALE,
    maptype: 'roadmap',
    key: apiKey,
  });
  // Subtle, official-looking style: drop POI + transit clutter.
  params.append('style', 'feature:poi|visibility:off');
  params.append('style', 'feature:transit|visibility:off');
  // Green origin (A), red destination (B).
  params.append('markers', `color:${ORIGIN_COLOR}|label:A|${origin.lat},${origin.lng}`);
  params.append('markers', `color:${DEST_COLOR}|label:B|${destination.lat},${destination.lng}`);
  if (encodedPolyline) {
    // Real road route — Google returns the polyline already URL-safe/encoded.
    params.append('path', `color:${ROUTE_COLOR}|weight:4|enc:${encodedPolyline}`);
  } else {
    // Fallback: straight line between the two points.
    params.append('path', `color:${ROUTE_COLOR}|weight:4|${origin.lat},${origin.lng}|${destination.lat},${destination.lng}`);
  }
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
  fetchImpl: typeof fetch = fetch
): Promise<RouteMap | null> {
  if (!origin || !destination || !apiKey) return null;

  const key = laneCacheKey(origin, destination);
  const cached = routeCache.get(key);
  if (cached) return cached;

  const directions = await fetchDirections(origin, destination, apiKey, fetchImpl);
  const result: RouteMap = directions
    ? {
        url: buildStaticMapUrl(apiKey, origin, destination, directions.polyline),
        distanceMiles: directions.distanceMeters
          ? Math.round(directions.distanceMeters / METERS_PER_MILE)
          : null,
        kind: 'route',
      }
    : {
        url: buildStaticMapUrl(apiKey, origin, destination, null),
        distanceMiles: null,
        kind: 'straight',
      };

  routeCache.set(key, result);
  return result;
}

// Test-only: clear the lane cache between cases.
export function __clearRouteCache(): void {
  routeCache.clear();
}
