import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  buildStaticMapUrl,
  buildBaseMapUrl,
  fetchDirections,
  getRouteMap,
  laneCacheKey,
  resolveMapStyle,
  MAP_STYLE_KEYS,
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
    // Home-palette markers: green origin (A), coral-red destination (B).
    const markers = url.searchParams.getAll('markers');
    expect(markers[0]).toBe(`color:0x36c98b|label:A|${LA.lat},${LA.lng}`);
    expect(markers[1]).toBe(`color:0xf97373|label:B|${CHI.lat},${CHI.lng}`);
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
    const res = await getRouteMap(LA, CHI, KEY, 'light', f);
    expect(res?.kind).toBe('route');
    expect(res?.distanceMiles).toBe(2000); // 3,218,688 m ≈ 2000 mi
    expect(new URL(res!.url).searchParams.get('path')).toBe(`color:0x0D3CFCff|weight:4|enc:${POLY}`);
  });

  it('falls back to a straight line when Directions fails', async () => {
    const f = mockFetch({ status: 'NOT_FOUND' });
    const res = await getRouteMap(LA, CHI, KEY, 'light', f);
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
    await getRouteMap(LA, CHI, KEY, 'light', f);
    await getRouteMap(LA, CHI, KEY, 'light', f);
    expect((f as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it('theme is part of the cache key — light and dark each re-fetch once', async () => {
    const f = mockFetch({
      status: 'OK',
      routes: [{ overview_polyline: { points: POLY }, legs: [{ distance: { value: 100_000 } }] }],
    });
    await getRouteMap(LA, CHI, KEY, 'light', f);
    await getRouteMap(LA, CHI, KEY, 'dark', f);
    // Different theme → different cache entry → a second upstream call.
    expect((f as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
    // A repeat of the SAME theme is served from cache (still 2 total).
    await getRouteMap(LA, CHI, KEY, 'dark', f);
    expect((f as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
  });

  it('dark theme applies night geometry/water styles; light does not', async () => {
    const f = mockFetch({
      status: 'OK',
      routes: [{ overview_polyline: { points: POLY }, legs: [{ distance: { value: 100_000 } }] }],
    });
    const dark = await getRouteMap(LA, CHI, KEY, 'dark', f);
    const styles = new URL(dark!.url).searchParams.getAll('style');
    expect(styles).toContain('feature:water|element:geometry|color:0x070c18');
    expect(styles).toContain('element:geometry|color:0x0f1629');
    // Highlighted highways (cobalt-tinted), POI/transit dropped, cobalt route unaffected.
    expect(styles).toContain('feature:road.highway|element:geometry|color:0x3f5cc0');
    expect(styles).toContain('feature:poi|visibility:off');
    expect(new URL(dark!.url).searchParams.get('path')).toBe(`color:0x0D3CFCff|weight:4|enc:${POLY}`);

    __clearRouteCache();
    const light = await getRouteMap(LA, CHI, KEY, 'light', f);
    const lightStyles = new URL(light!.url).searchParams.getAll('style');
    // Light theme has its own branded style (not the dark navy water).
    expect(lightStyles).not.toContain('feature:water|element:geometry|color:0x070c18');
    expect(lightStyles).toContain('feature:road.highway|element:geometry|color:0x9fbcf3');
  });
});

describe('buildStaticMapUrl theme', () => {
  it('applies the light branded style by default and the dark one for dark', () => {
    const light = new URL(buildStaticMapUrl(KEY, LA, CHI, POLY));
    const lightStyles = light.searchParams.getAll('style');
    expect(lightStyles).toContain('feature:poi|visibility:off');
    expect(lightStyles).toContain('feature:road.highway|element:geometry|color:0x9fbcf3');
    const dark = new URL(buildStaticMapUrl(KEY, LA, CHI, POLY, 'dark'));
    expect(dark.searchParams.getAll('style').length).toBeGreaterThan(2);
    expect(dark.searchParams.getAll('style')).toContain('feature:road.highway|element:geometry|color:0x3f5cc0');
  });
});

describe('laneCacheKey', () => {
  it('rounds coordinates so near-identical lanes share a cache entry', () => {
    expect(laneCacheKey({ lat: 33.770011, lng: -118.19372 }, CHI)).toBe(
      laneCacheKey({ lat: 33.770009, lng: -118.19372 }, CHI)
    );
  });
});

// ── Per-tenant map style ────────────────────────────────────────────────────
describe('resolveMapStyle', () => {
  it('accepts each known style key', () => {
    for (const k of MAP_STYLE_KEYS) expect(resolveMapStyle(k)).toBe(k);
  });
  it('defaults null / undefined / unknown to branded', () => {
    expect(resolveMapStyle(null)).toBe('branded');
    expect(resolveMapStyle(undefined)).toBe('branded');
    expect(resolveMapStyle('')).toBe('branded');
    expect(resolveMapStyle('neon-city')).toBe('branded');
    expect(resolveMapStyle(42)).toBe('branded');
  });
});

describe('buildStaticMapUrl — map styles', () => {
  const styleParams = (mapStyle: (typeof MAP_STYLE_KEYS)[number]) =>
    new URL(buildStaticMapUrl(KEY, LA, CHI, POLY, 'light', mapStyle)).searchParams.getAll('style');

  it('branded reproduces the existing themed look (light branded roads)', () => {
    const s = styleParams('branded');
    expect(s).toContain('feature:road.highway|element:geometry|color:0x9fbcf3');
    expect(s).toContain('feature:poi|visibility:off');
  });

  it('grayscale is a desaturated gray set with muted labels', () => {
    const s = styleParams('grayscale');
    expect(s).toContain('feature:road|element:geometry|color:0xffffff');
    expect(s).toContain('element:labels.text.fill|color:0x9aa0a6');
    expect(s).toContain('feature:water|element:geometry|color:0xdfe3e8');
    // Not the branded navy nor the standard (empty) look.
    expect(s).not.toContain('feature:road.highway|element:geometry|color:0x9fbcf3');
  });

  it('standard applies NO style overrides (real Google colors)', () => {
    expect(styleParams('standard')).toEqual([]);
  });

  it('dark_routes uses a dark, dimmed base (not branded-dark cobalt highways)', () => {
    const s = styleParams('dark_routes');
    expect(s).toContain('element:geometry|color:0x0a0e1a');
    expect(s).toContain('feature:road.highway|element:geometry|color:0x263053');
    expect(s).not.toContain('feature:road.highway|element:geometry|color:0x3f5cc0');
  });

  it('every style yields a distinct style= signature', () => {
    const sigs = MAP_STYLE_KEYS.map((k) => JSON.stringify(styleParams(k)));
    expect(new Set(sigs).size).toBe(MAP_STYLE_KEYS.length);
  });

  it('the route polyline is present + visible on every style', () => {
    for (const k of MAP_STYLE_KEYS) {
      const path = new URL(buildStaticMapUrl(KEY, LA, CHI, POLY, 'light', k)).searchParams.get('path');
      expect(path).toMatch(/enc:/);
      // A saturated line color + a positive weight on every style.
      expect(path).toMatch(/^color:0x[0-9A-Fa-f]{6,8}\|weight:[1-9]/);
    }
  });

  it('dark_routes spotlights the route with a brighter, heavier line', () => {
    const path = new URL(buildStaticMapUrl(KEY, LA, CHI, POLY, 'light', 'dark_routes')).searchParams.get('path');
    expect(path).toBe(`color:0x5B8CFFff|weight:6|enc:${POLY}`);
    // The other styles keep the brand cobalt at weight 4.
    const branded = new URL(buildStaticMapUrl(KEY, LA, CHI, POLY, 'light', 'branded')).searchParams.get('path');
    expect(branded).toBe(`color:0x0D3CFCff|weight:4|enc:${POLY}`);
  });
});

describe('buildBaseMapUrl — map styles', () => {
  it('carries the style specs and stays centered on North America', () => {
    const url = new URL(buildBaseMapUrl(KEY, 'light', 'grayscale'));
    expect(url.searchParams.get('center')).toBe('44,-97');
    expect(url.searchParams.getAll('style')).toContain('feature:road|element:geometry|color:0xffffff');
    // standard base map has no style overrides.
    expect(new URL(buildBaseMapUrl(KEY, 'light', 'standard')).searchParams.getAll('style')).toEqual([]);
  });
});

describe('getRouteMap — map style is part of the cache key', () => {
  beforeEach(() => __clearRouteCache());

  it('different styles each re-fetch once; a repeat of the same style is cached', async () => {
    const f = mockFetch({
      status: 'OK',
      routes: [{ overview_polyline: { points: POLY }, legs: [{ distance: { value: 100_000 } }] }],
    });
    await getRouteMap(LA, CHI, KEY, 'light', f, 'branded');
    await getRouteMap(LA, CHI, KEY, 'light', f, 'grayscale');
    // Distinct style → distinct cache entry → a second upstream call.
    expect((f as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
    // Same lane+theme+style is served from cache (still 2 total).
    await getRouteMap(LA, CHI, KEY, 'light', f, 'grayscale');
    expect((f as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
  });

  it('renders the requested style into the returned URL', async () => {
    const f = mockFetch({
      status: 'OK',
      routes: [{ overview_polyline: { points: POLY }, legs: [{ distance: { value: 100_000 } }] }],
    });
    const gray = await getRouteMap(LA, CHI, KEY, 'light', f, 'grayscale');
    expect(new URL(gray!.url).searchParams.getAll('style')).toContain('element:labels.text.fill|color:0x9aa0a6');
  });

  it('defaults to branded when no style is passed (existing callers unchanged)', async () => {
    const f = mockFetch({
      status: 'OK',
      routes: [{ overview_polyline: { points: POLY }, legs: [{ distance: { value: 100_000 } }] }],
    });
    const res = await getRouteMap(LA, CHI, KEY, 'light', f);
    expect(new URL(res!.url).searchParams.get('path')).toBe(`color:0x0D3CFCff|weight:4|enc:${POLY}`);
  });
});
