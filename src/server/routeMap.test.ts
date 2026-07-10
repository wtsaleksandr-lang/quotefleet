import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  buildStaticMapUrl,
  fetchDirections,
  getRouteMap,
  laneCacheKey,
  __clearRouteCache,
} from './routeMap.js';

const KEY = 'test-key';
const LA = { lat: 33.7701, lng: -118.1937 }; // Long Beach 90802
const CHI = { lat: 41.8781, lng: -87.6298 }; // Chicago 60606
const POLY = 'a~l~Fjk~uOwHJy@P'; // sample encoded polyline

function mockFetch(json: unknown, ok = true): typeof fetch {
  return vi.fn(async () => ({
    ok,
    json: async () => json,
  })) as unknown as typeof fetch;
}

describe('buildStaticMapUrl', () => {
  it('draws the real route with enc: polyline and brand-blue line', () => {
    const url = new URL(buildStaticMapUrl(KEY, LA, CHI, POLY));
    const path = url.searchParams.get('path');
    expect(path).toBe(`color:0x0D3CFCff|weight:4|enc:${POLY}`);
    // Green origin (A), red destination (B).
    const markers = url.searchParams.getAll('markers');
    expect(markers[0]).toBe(`color:0x16a34a|label:A|${LA.lat},${LA.lng}`);
    expect(markers[1]).toBe(`color:0xef4444|label:B|${CHI.lat},${CHI.lng}`);
    expect(url.searchParams.get('maptype')).toBe('roadmap');
    expect(url.searchParams.get('scale')).toBe('2');
    expect(url.searchParams.get('key')).toBe(KEY);
    // No teal anywhere.
    expect(buildStaticMapUrl(KEY, LA, CHI, POLY)).not.toMatch(/teal|008080|14b8a6/i);
  });

  it('falls back to a straight-line path when no polyline is given', () => {
    const url = new URL(buildStaticMapUrl(KEY, LA, CHI, null));
    expect(url.searchParams.get('path')).toBe(
      `color:0x0D3CFCff|weight:4|${LA.lat},${LA.lng}|${CHI.lat},${CHI.lng}`
    );
  });
});

describe('fetchDirections', () => {
  it('parses overview polyline + summed leg distance', async () => {
    const f = mockFetch({
      status: 'OK',
      routes: [
        {
          overview_polyline: { points: POLY },
          legs: [{ distance: { value: 1_000_000 } }, { distance: { value: 600_000 } }],
        },
      ],
    });
    const res = await fetchDirections(LA, CHI, KEY, f);
    expect(res).toEqual({ polyline: POLY, distanceMeters: 1_600_000 });
  });

  it('returns null on non-OK Directions status', async () => {
    const f = mockFetch({ status: 'ZERO_RESULTS', routes: [] });
    expect(await fetchDirections(LA, CHI, KEY, f)).toBeNull();
  });

  it('returns null on HTTP error', async () => {
    const f = mockFetch({}, false);
    expect(await fetchDirections(LA, CHI, KEY, f)).toBeNull();
  });

  it('returns null when fetch throws', async () => {
    const f = vi.fn(async () => {
      throw new Error('network');
    }) as unknown as typeof fetch;
    expect(await fetchDirections(LA, CHI, KEY, f)).toBeNull();
  });
});

describe('getRouteMap', () => {
  beforeEach(() => __clearRouteCache());

  it('returns null without key or coordinates', async () => {
    expect(await getRouteMap(undefined, CHI, KEY)).toBeNull();
    expect(await getRouteMap(LA, CHI, undefined)).toBeNull();
  });

  it('uses the real road route when Directions succeeds', async () => {
    const f = mockFetch({
      status: 'OK',
      routes: [{ overview_polyline: { points: POLY }, legs: [{ distance: { value: 3_218_688 } }] }],
    });
    const res = await getRouteMap(LA, CHI, KEY, f);
    expect(res?.kind).toBe('route');
    expect(res?.distanceMiles).toBe(2000); // 3,218,688 m ≈ 2000 mi
    expect(new URL(res!.url).searchParams.get('path')).toBe(`color:0x0D3CFCff|weight:4|enc:${POLY}`);
  });

  it('falls back to a straight line when Directions fails', async () => {
    const f = mockFetch({ status: 'NOT_FOUND' });
    const res = await getRouteMap(LA, CHI, KEY, f);
    expect(res?.kind).toBe('straight');
    expect(res?.distanceMiles).toBeNull();
    expect(new URL(res!.url).searchParams.get('path')).toBe(
      `color:0x0D3CFCff|weight:4|${LA.lat},${LA.lng}|${CHI.lat},${CHI.lng}`
    );
  });

  it('caches per lane — a repeat lane does not re-call Directions', async () => {
    const f = mockFetch({
      status: 'OK',
      routes: [{ overview_polyline: { points: POLY }, legs: [{ distance: { value: 100_000 } }] }],
    });
    await getRouteMap(LA, CHI, KEY, f);
    await getRouteMap(LA, CHI, KEY, f);
    expect((f as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });
});

describe('laneCacheKey', () => {
  it('rounds coordinates so near-identical lanes share a cache entry', () => {
    expect(laneCacheKey({ lat: 33.770011, lng: -118.19372 }, CHI)).toBe(
      laneCacheKey({ lat: 33.770009, lng: -118.19372 }, CHI)
    );
  });
});
