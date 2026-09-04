/**
 * ADDRESS → COORDINATES, for the heavy-haul quote tool.
 *
 * ONE PROVIDER, AND IT IS THE ONE THAT FAILS CLOSED.
 *
 * The US Census Geocoder is free, keyless, unmetered and US-Government public
 * domain. It is used here to the exclusion of everything else for a reason that
 * is about correctness, not price. Measured, on the same address list:
 *
 *     350 Fifth Ave, New York, NY 10118        (the Empire State Building)
 *       Census    → 350 5TH AVE, NEW YORK, NY 10118      40.74785,-73.98508
 *       Nominatim → 350 5th Avenue, North Pelham,
 *                   Westchester County, NY 10803         40.91610,-73.80718
 *
 * Nominatim silently discarded the ZIP and matched a different town 14.89 miles
 * away, and returned it with the same shape and the same confidence as a correct
 * answer. Census returned no match for the addresses it could not place. On a
 * quote where the mileage sets the price, a confidently-wrong endpoint is
 * strictly worse than a refusal — so the fallback that would have "improved
 * coverage" is deliberately absent, and an address Census cannot place comes
 * back unresolved with the reason attached.
 *
 * WHAT IS FREE AND WAS TAKEN ANYWAY: coverage varies by BENCHMARK, not only by
 * address. `191 Beale St, Memphis, TN` misses on `Public_AR_Current` and HITS on
 * `Public_AR_Census2020` — the same service, the same address, a different
 * vintage of the address-range file. Cycling the benchmarks in order lifted
 * coverage from 7/14 to 10/14 addresses in the evaluation and costs nothing but
 * a second request on the addresses that would otherwise have failed outright.
 *
 * NO DATABASE. The cache is an in-process Map, so this resolves correctly with
 * the database down — which is the state the dev Neon branch is in, and the
 * condition the whole tool is built to answer under.
 */

/** The benchmarks tried, in order. First hit wins. */
export const CENSUS_BENCHMARKS = [
  'Public_AR_Current',
  'Public_AR_Census2020',
  'Public_AR_ACS2024',
] as const;

export const CENSUS_GEOCODER_URL =
  'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';

/** How long a resolved address stays in the in-process cache. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** Hard cap on cache entries so a scripted caller cannot grow it without bound. */
const CACHE_MAX_ENTRIES = 500;
const FETCH_TIMEOUT_MS = 8_000;

export interface GeocodedPoint {
  ok: true;
  /** What the caller typed. */
  query: string;
  /** What Census actually matched it to — shown to the user to confirm the pin. */
  matchedAddress: string;
  latitude: number;
  longitude: number;
  /** Two-letter state of the matched address, when Census returned one. */
  state: string | null;
  zip: string | null;
  /** Which benchmark answered. A later benchmark is an older address file. */
  benchmark: string;
  /** True when Census returned more than one candidate and we took the first. */
  ambiguous: boolean;
}

export interface UnresolvedPoint {
  ok: false;
  query: string;
  /** Customer-facing sentence. Never a stack trace, never a silent null. */
  reason: string;
  /** Distinguishes "no such address" from "the service was unreachable". */
  code: 'noMatch' | 'unavailable' | 'empty';
}

export type GeocodeResult = GeocodedPoint | UnresolvedPoint;

/** Minimal shape of the Census `locations/onelineaddress` response we read. */
interface CensusResponse {
  result?: {
    addressMatches?: Array<{
      matchedAddress?: string;
      coordinates?: { x?: number; y?: number };
      addressComponents?: { state?: string; zip?: string };
    }>;
  };
}

interface CacheEntry {
  at: number;
  value: GeocodeResult;
}

const cache = new Map<string, CacheEntry>();
/** Keys that never expire and are never evicted. See `seedGeocodeCache`. */
const seeded = new Set<string>();

/** Exposed for tests: an empty cache is the only way to assert a fetch happened. */
export function clearGeocodeCache(): void {
  cache.clear();
  seeded.clear();
}

/**
 * Pre-place known endpoints in the cache.
 *
 * The page ships a "see a worked example" button for one specific lane, so the
 * two endpoints behind that button are known at build time. Seeding them means
 * the example renders with no network round-trip at all — in production, in
 * dev, and in the automated suite, which is how the tests exercise the whole
 * flow while making zero live calls to the Census service.
 *
 * Seeded entries carry the same `GeocodedPoint` shape as a live match; they are
 * REAL Census results for those addresses, not invented coordinates, and a
 * different address still goes to the service as normal.
 */
export function seedGeocodeCache(points: ReadonlyArray<GeocodedPoint>): void {
  for (const point of points) {
    const key = cacheKey(point.query);
    seeded.add(key);
    cache.set(key, { at: Date.now(), value: point });
  }
}

function cacheKey(address: string): string {
  return address.trim().toLowerCase().replace(/\s+/g, ' ');
}

function readCache(key: string): GeocodeResult | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (!seeded.has(key) && Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function writeCache(key: string, value: GeocodeResult): void {
  // Only successes are worth remembering. Caching a failure would pin an
  // outage — or a typo the user is about to correct — for a whole day.
  if (!value.ok) return;
  if (cache.size >= CACHE_MAX_ENTRIES) {
    // Insertion-ordered, so this drops the least-recently-added entry. Seeded
    // keys are skipped: a burst of traffic must not evict the worked example
    // and turn a zero-network demo into a live lookup.
    for (const candidate of cache.keys()) {
      if (seeded.has(candidate)) continue;
      cache.delete(candidate);
      break;
    }
  }
  cache.set(key, { at: Date.now(), value });
}

/**
 * Resolve one address.
 *
 * `fetchImpl` is injectable ON PURPOSE: the test suite passes a stub so the
 * whole surface can be exercised with zero live calls, which is the only way an
 * automated run can be honest about making none.
 */
export async function geocodeAddress(
  address: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<GeocodeResult> {
  const query = String(address ?? '').trim();
  if (query === '') {
    return {
      ok: false,
      query,
      reason: 'No address was entered.',
      code: 'empty',
    };
  }

  const key = cacheKey(query);
  const cached = readCache(key);
  if (cached) return cached;

  let reachedService = false;
  for (const benchmark of CENSUS_BENCHMARKS) {
    const url = new URL(CENSUS_GEOCODER_URL);
    url.searchParams.set('address', query);
    url.searchParams.set('benchmark', benchmark);
    url.searchParams.set('format', 'json');

    let json: CensusResponse;
    try {
      const res = await fetchImpl(url.toString(), {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      reachedService = true;
      json = (await res.json()) as CensusResponse;
    } catch {
      // A network error on one benchmark is not a verdict on the address.
      // Try the next; if none is reachable we say the service was unavailable,
      // which is a different sentence from "that address does not exist".
      continue;
    }

    const matches = json.result?.addressMatches ?? [];
    const match = matches[0];
    const lat = match?.coordinates?.y;
    const lon = match?.coordinates?.x;
    if (
      match === undefined ||
      typeof lat !== 'number' ||
      typeof lon !== 'number' ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon)
    ) {
      continue;
    }

    const value: GeocodedPoint = {
      ok: true,
      query,
      matchedAddress: String(match.matchedAddress ?? query),
      latitude: lat,
      longitude: lon,
      state: (match.addressComponents?.state ?? '').trim().toUpperCase() || null,
      zip: (match.addressComponents?.zip ?? '').trim() || null,
      benchmark,
      ambiguous: matches.length > 1,
    };
    writeCache(key, value);
    return value;
  }

  return reachedService
    ? {
        ok: false,
        query,
        reason: `The US Census geocoder could not place "${query}". Add the street number, city, state and ZIP — it matches US street addresses, not landmarks or place names. We do not fall back to a second geocoder here: the one we tested silently matched this kind of address to a different town, and a confidently-wrong endpoint would misprice the whole lane.`,
        code: 'noMatch',
      }
    : {
        ok: false,
        query,
        reason:
          'The US Census geocoder could not be reached, so this address was not resolved. Nothing is priced from a guessed location — retry in a moment, or enter your own filed lane mileage, which skips geocoding entirely.',
        code: 'unavailable',
      };
}

/** Resolve both ends of a lane. Sequential, because a failure short-circuits. */
export async function geocodeLane(
  originAddress: string,
  destinationAddress: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<{ origin: GeocodeResult; destination: GeocodeResult }> {
  const origin = await geocodeAddress(originAddress, fetchImpl);
  const destination = await geocodeAddress(destinationAddress, fetchImpl);
  return { origin, destination };
}
