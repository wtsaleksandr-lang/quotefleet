/**
 * Geocoding + distance lookup.
 *
 * Tier 1 — embedded ZIP/city table (instant, offline):
 *   Coverage: every US ZIP3 + every Canadian forward-sortation-area (FSA),
 *   centroid lat/lng. Loaded from src/calc/zipCentroids.ts. ~50 KB.
 *
 * Tier 2 — DB geocode_cache (instant after first hit):
 *   Anything that resolves once is stored.
 *
 * Tier 3 — Nominatim (OpenStreetMap) public API:
 *   Free, rate-limited to 1 req/sec. Use for arbitrary addresses
 *   that don't have a ZIP / FSA hit.
 *
 * Distance: Haversine × 1.18 (industry rule-of-thumb to convert
 *   straight-line to driving miles for North America). Real road
 *   routing via OSRM or Mapbox is a future upgrade — for an
 *   instant-quote calculator, ±5% error on miles is acceptable
 *   because the price-per-mile rate already absorbs it.
 */
import { eq, and } from 'drizzle-orm';
import { db } from '../db/client.js';
import { geocodeCache, distanceCache } from '../db/schema.js';
import { distanceMiles } from './engine.js';
import { ZIP_CENTROIDS } from './zipCentroids.js';
import { CANADA_FSA_CENTROIDS } from './canadaFsa.js';
import { PORTS_DATA } from '../data/ports.js';

export interface GeoPoint {
  lat: number;
  lng: number;
  source: 'zip' | 'fsa' | 'port' | 'cache' | 'nominatim' | 'manual';
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  canonicalAddress?: string;
}

const STRAIGHT_TO_ROAD_FACTOR = 1.18;

/**
 * Placeholder / non-geographic US ZIPs that must never resolve, even though
 * their 3-digit prefix happens to map to a real centroid (e.g. 999 = Ketchikan
 * AK). These are the classic "fake ZIP" values a bot or fat-fingered user types.
 */
const BOGUS_US_ZIPS = new Set(['00000', '99999']);

function normCountry(c?: string): string {
  if (!c) return 'US';
  const s = c.trim().toUpperCase();
  if (s === 'USA' || s === 'UNITED STATES') return 'US';
  if (s === 'CANADA') return 'CA';
  return s;
}

function normalizeQueryKey(input: {
  zip?: string;
  city?: string;
  state?: string;
  country?: string;
  address?: string;
  portCode?: string;
}): string {
  if (input.portCode) return `port:${input.portCode.toUpperCase()}`;
  if (input.zip) {
    return `zip:${normCountry(input.country)}:${input.zip.replace(/\s+/g, '').toUpperCase()}`;
  }
  if (input.address) {
    return `addr:${normCountry(input.country)}:${input.address.toLowerCase().trim()}`;
  }
  if (input.city) {
    return `city:${normCountry(input.country)}:${(input.state ?? '').toUpperCase()}:${input.city.toLowerCase().trim()}`;
  }
  return 'unknown';
}

/** Pull a lat/lng for a request side. */
export async function geocode(input: {
  zip?: string;
  city?: string;
  state?: string;
  country?: string;
  address?: string;
  portCode?: string;
}): Promise<GeoPoint | null> {
  const country = normCountry(input.country);

  // 0. port code shortcut
  if (input.portCode) {
    const p = PORTS_DATA.find(
      (x) => x.code.toUpperCase() === input.portCode!.toUpperCase()
    );
    if (p) {
      return {
        lat: p.lat,
        lng: p.lng,
        source: 'port',
        city: p.city,
        state: p.state,
        country: p.country,
        canonicalAddress: `${p.name} (${p.code})`,
      };
    }
  }

  // 1. embedded ZIP / FSA lookup (no network).
  if (input.zip) {
    const zip = input.zip.replace(/\s+/g, '').toUpperCase();
    if (country === 'US') {
      const zip3 = zip.slice(0, 3);
      // Reject obvious placeholder ZIPs first — their prefix can map to a real
      // centroid (999 → Ketchikan AK) and would otherwise price a bogus lane.
      if (BOGUS_US_ZIPS.has(zip)) return null;
      const c = ZIP_CENTROIDS[zip3];
      if (c) {
        return {
          lat: c[0],
          lng: c[1],
          source: 'zip',
          zip,
          country,
          city: c[2],
          state: c[3],
        };
      }
      // ZIP_CENTROIDS covers every assigned US ZIP3. A purely-numeric 5-digit
      // ZIP whose prefix ISN'T here is unassigned / invalid — return unresolved
      // rather than fabricate a location via Nominatim (which can confidently
      // match an unrelated place for junk input and price a wrong lane).
      if (/^\d{5}$/.test(zip)) return null;
    } else if (country === 'CA') {
      const fsa = zip.slice(0, 3);
      const c = CANADA_FSA_CENTROIDS[fsa];
      if (c) {
        return {
          lat: c[0],
          lng: c[1],
          source: 'fsa',
          zip,
          country,
          city: c[2],
          state: c[3],
        };
      }
    }
  }

  // 2. DB cache.
  const key = normalizeQueryKey(input);
  if (key === 'unknown') return null;
  const cached = await db()
    .select()
    .from(geocodeCache)
    .where(eq(geocodeCache.queryKey, key))
    .limit(1);
  if (cached[0]) {
    const r = cached[0];
    return {
      lat: r.lat,
      lng: r.lng,
      source: 'cache',
      city: r.city ?? undefined,
      state: r.state ?? undefined,
      zip: r.zip ?? undefined,
      country: r.country ?? undefined,
      canonicalAddress: r.canonicalAddress ?? undefined,
    };
  }

  // 3. Nominatim (OpenStreetMap public, free, polite usage 1/sec).
  try {
    const q = buildNominatimQuery(input);
    if (!q) return null;
    const params = new URLSearchParams({
      q,
      format: 'json',
      limit: '1',
      addressdetails: '1',
      countrycodes: country.toLowerCase(),
    });
    const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'QuoteFleet/0.1 (https://quotefleet.com)',
        'Accept-Language': 'en',
      },
    });
    if (!res.ok) return null;
    const arr = (await res.json()) as Array<{
      lat: string;
      lon: string;
      display_name: string;
      address?: {
        city?: string;
        town?: string;
        village?: string;
        state?: string;
        postcode?: string;
        country_code?: string;
      };
    }>;
    if (!arr.length) return null;
    const hit = arr[0]!;
    const result: GeoPoint = {
      lat: Number(hit.lat),
      lng: Number(hit.lon),
      source: 'nominatim',
      city: hit.address?.city ?? hit.address?.town ?? hit.address?.village,
      state: hit.address?.state,
      zip: hit.address?.postcode,
      country: hit.address?.country_code?.toUpperCase() ?? country,
      canonicalAddress: hit.display_name,
    };
    // store in cache (best-effort; ignore unique-conflict).
    try {
      await db()
        .insert(geocodeCache)
        .values({
          queryKey: key,
          lat: result.lat,
          lng: result.lng,
          canonicalAddress: result.canonicalAddress,
          city: result.city,
          state: result.state,
          zip: result.zip,
          country: result.country,
          source: 'nominatim',
        })
        .onConflictDoNothing();
    } catch {
      // ignore — cache is opportunistic.
    }
    return result;
  } catch (err) {
    console.warn('[distance] Nominatim lookup failed:', (err as Error).message);
    return null;
  }
}

function buildNominatimQuery(input: {
  zip?: string;
  city?: string;
  state?: string;
  country?: string;
  address?: string;
}): string | null {
  const parts: string[] = [];
  if (input.address) parts.push(input.address);
  if (input.city) parts.push(input.city);
  if (input.state) parts.push(input.state);
  if (input.zip) parts.push(input.zip);
  if (input.country) parts.push(input.country);
  return parts.length ? parts.join(', ') : null;
}

export interface DistanceResult {
  miles: number;
  source: 'cache' | 'haversine';
  origin: GeoPoint;
  destination: GeoPoint;
}

export async function distanceBetween(
  origin: {
    zip?: string;
    city?: string;
    state?: string;
    country?: string;
    address?: string;
    portCode?: string;
    lat?: number;
    lng?: number;
  },
  destination: {
    zip?: string;
    city?: string;
    state?: string;
    country?: string;
    address?: string;
    portCode?: string;
    lat?: number;
    lng?: number;
  }
): Promise<DistanceResult | { error: string }> {
  const o =
    origin.lat != null && origin.lng != null
      ? ({
          lat: origin.lat,
          lng: origin.lng,
          source: 'manual',
        } satisfies GeoPoint)
      : await geocode(origin);
  if (!o)
    return {
      error:
        "We couldn't price this lane — the pickup ZIP/postal code wasn't recognized. Please double-check it, or contact us for a custom quote.",
    };
  const d =
    destination.lat != null && destination.lng != null
      ? ({
          lat: destination.lat,
          lng: destination.lng,
          source: 'manual',
        } satisfies GeoPoint)
      : await geocode(destination);
  if (!d)
    return {
      error:
        "We couldn't price this lane — the delivery ZIP/postal code wasn't recognized. Please double-check it, or contact us for a custom quote.",
    };

  // distance cache key
  const oKey = `${o.lat.toFixed(2)},${o.lng.toFixed(2)}`;
  const dKey = `${d.lat.toFixed(2)},${d.lng.toFixed(2)}`;

  const cached = await db()
    .select()
    .from(distanceCache)
    .where(
      and(eq(distanceCache.originKey, oKey), eq(distanceCache.destKey, dKey))
    )
    .limit(1);
  if (cached[0]) {
    return {
      miles: cached[0].miles,
      source: 'cache',
      origin: o,
      destination: d,
    };
  }

  const straight = distanceMiles(o, d);
  const miles = Math.round(straight * STRAIGHT_TO_ROAD_FACTOR);

  // store
  try {
    await db()
      .insert(distanceCache)
      .values({
        originKey: oKey,
        destKey: dKey,
        miles,
        source: 'haversine',
      })
      .onConflictDoNothing();
  } catch {
    // ignore — cache is opportunistic.
  }

  return { miles, source: 'haversine', origin: o, destination: d };
}
