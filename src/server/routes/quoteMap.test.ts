/**
 * Route-snapshot map PROXY — behaviour + the key-leak fix it exists to enforce.
 *
 * Security-critical properties, all asserted here:
 *   (a) a valid refId returns image/png bytes with an immutable Cache-Control,
 *   (b) the Google Maps API key NEVER appears in any response (bytes/headers/json),
 *   (c) unknown refId / inactive tenant / missing coordinates all 404,
 *   (d) a persisted cache hit serves stored bytes WITHOUT re-calling Google,
 *   (e) ?theme=light|dark route to DISTINCT cache keys.
 *
 * The handler is captured from a fake app (bypassing the rate-limit middleware)
 * and driven with mock req/res + a mocked db, getRouteMap, and global fetch —
 * never touching Google. Source-level guards lock the wiring in the repo style.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const SECRET_KEY = 'AIzaSy-TOTALLY-SECRET-MAPS-KEY';
// A tiny fake PNG (valid 8-byte signature + filler). Deliberately does NOT
// contain the API key, so we can assert the served bytes never leak it.
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);

const h = vi.hoisted(() => {
  const state = {
    leadRows: [] as Record<string, unknown>[],
    tenantRows: [] as Record<string, unknown>[],
    brandRows: [] as Record<string, unknown>[],
    cacheRows: [] as Record<string, unknown>[],
    inserts: [] as Array<{ table: string; values: Record<string, unknown> }>,
  };
  const getRouteMapMock = vi.fn(async () => ({
    url: `https://maps.googleapis.com/maps/api/staticmap?size=640x272&key=${SECRET_KEY}`,
    distanceMiles: 55,
    kind: 'route' as const,
  }));
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => PNG_BYTES.buffer.slice(PNG_BYTES.byteOffset, PNG_BYTES.byteOffset + PNG_BYTES.byteLength),
  }));
  return { state, getRouteMapMock, fetchMock };
});

vi.mock('../../db/client.js', async () => {
  const { getTableName } = await import('drizzle-orm');
  function rowsFor(table: unknown): Record<string, unknown>[] {
    const n = getTableName(table as never);
    if (n === 'leads') return h.state.leadRows;
    if (n === 'tenants') return h.state.tenantRows;
    if (n === 'brand_configs') return h.state.brandRows;
    if (n === 'route_map_cache') return h.state.cacheRows;
    return [];
  }
  function makeSelect() {
    let table: unknown;
    const chain: Record<string, unknown> = {
      from(t: unknown) { table = t; return chain; },
      where() { return chain; },
      limit() { return Promise.resolve(rowsFor(table)); },
      then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
        return Promise.resolve(rowsFor(table)).then(res, rej);
      },
    };
    return chain;
  }
  return {
    db: () => ({
      select: () => makeSelect(),
      insert: (t: unknown) => ({
        values: (v: Record<string, unknown>) => {
          h.state.inserts.push({ table: getTableName(t as never), values: v });
          return { onConflictDoNothing: () => Promise.resolve() };
        },
      }),
    }),
  };
});

vi.mock('../routeMap.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../routeMap.js')>();
  return { ...actual, getRouteMap: h.getRouteMapMock };
});

// ── Capture the handler (skip the rate-limit middleware) ─────────────────
type Handler = (req: MockReq, res: MockRes) => unknown;
interface MockReq { params: { file: string }; query: Record<string, unknown> }
class MockRes {
  statusCode = 200;
  headers: Record<string, string> = {};
  body: unknown = undefined;
  setHeader(k: string, v: string) { this.headers[k.toLowerCase()] = v; }
  status(c: number) { this.statusCode = c; return this; }
  json(o: unknown) { this.body = o; return this; }
  end(buf?: unknown) { this.body = buf; return this; }
}

async function getHandler(): Promise<Handler> {
  const { registerQuoteMapRoutes } = await import('./quoteMap.js');
  let handler: Handler | undefined;
  const fakeApp = {
    get: (_path: string, ...rest: unknown[]) => { handler = rest[rest.length - 1] as Handler; },
  } as unknown as import('express').Express;
  registerQuoteMapRoutes(fakeApp);
  if (!handler) throw new Error('handler not registered');
  return handler;
}

function req(file: string, query: Record<string, unknown> = {}): MockReq {
  return { params: { file }, query };
}

const baseLead = () => ({
  id: 10,
  refId: 'QF-ABC123',
  tenantId: 1,
  pickupLat: 33.77,
  pickupLng: -118.19,
  deliveryLat: 41.87,
  deliveryLng: -87.62,
});
const baseTenant = () => ({ id: 1, name: 'Acme Freight', status: 'active' });

beforeEach(() => {
  h.state.leadRows = [baseLead()];
  h.state.tenantRows = [baseTenant()];
  h.state.brandRows = [];
  h.state.cacheRows = [];
  h.state.inserts = [];
  h.getRouteMapMock.mockClear();
  h.fetchMock.mockClear();
  vi.stubGlobal('fetch', h.fetchMock);
  process.env.SESSION_SECRET ||= 'test'.repeat(16);
  process.env.DATABASE_URL ||= 'postgresql://x';
  process.env.ANTHROPIC_API_KEY ||= 'sk-test';
  process.env.PUBLIC_BASE_URL ||= 'https://quotefleet.net';
  process.env.GOOGLE_MAPS_API_KEY = SECRET_KEY;
});

describe('quote-map proxy — happy path', () => {
  it('(a) returns image/png bytes with an immutable weekly cache header', async () => {
    const handler = await getHandler();
    const res = new MockRes();
    await handler(req('QF-ABC123.png'), res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toBe('public, max-age=604800, immutable');
    expect(Buffer.isBuffer(res.body)).toBe(true);
    // Real PNG signature — proves we streamed the fetched image, not JSON.
    expect((res.body as Buffer).subarray(0, 4).toString('hex')).toBe('89504e47');
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('(b) the Maps API key never appears in the response bytes or headers', async () => {
    const handler = await getHandler();
    const res = new MockRes();
    await handler(req('QF-ABC123.png'), res);
    const bodyStr = (res.body as Buffer).toString('binary');
    expect(bodyStr).not.toContain(SECRET_KEY);
    expect(JSON.stringify(res.headers)).not.toContain(SECRET_KEY);
    // The key WAS used server-side (getRouteMap received it), with the tenant's
    // resolved map style (null brand → 'branded').
    expect(h.getRouteMapMock).toHaveBeenCalledWith(
      { lat: 33.77, lng: -118.19 },
      { lat: 41.87, lng: -87.62 },
      SECRET_KEY,
      'light',
      undefined,
      'branded'
    );
  });

  it('persists the fetched PNG to route_map_cache (base64)', async () => {
    const handler = await getHandler();
    await handler(req('QF-ABC123.png'), new MockRes());
    const ins = h.state.inserts.find((i) => i.table === 'route_map_cache');
    expect(ins).toBeTruthy();
    expect(ins!.values.pngBase64).toBe(PNG_BYTES.toString('base64'));
    expect(String(ins!.values.cacheKey)).toMatch(/\|light\|branded$/);
  });
});

describe('quote-map proxy — cache hit avoids Google', () => {
  it('(d) serves stored bytes and does NOT call getRouteMap or fetch', async () => {
    h.state.cacheRows = [{ cacheKey: 'x', pngBase64: PNG_BYTES.toString('base64'), kind: 'route' }];
    const handler = await getHandler();
    const res = new MockRes();
    await handler(req('QF-ABC123.png'), res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect((res.body as Buffer).subarray(0, 4).toString('hex')).toBe('89504e47');
    expect(h.getRouteMapMock).not.toHaveBeenCalled();
    expect(h.fetchMock).not.toHaveBeenCalled();
  });
});

describe('quote-map proxy — theme routing', () => {
  it('(e) ?theme=dark stores under a distinct |dark cache key', async () => {
    const handler = await getHandler();
    await handler(req('QF-ABC123.png', { theme: 'dark' }), new MockRes());
    const ins = h.state.inserts.find((i) => i.table === 'route_map_cache');
    expect(String(ins!.values.cacheKey)).toMatch(/\|dark\|branded$/);
    // getRouteMap is asked for the dark render.
    expect(h.getRouteMapMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), SECRET_KEY, 'dark', undefined, 'branded');
  });

  it('an unknown theme value falls back to light', async () => {
    const handler = await getHandler();
    await handler(req('QF-ABC123.png', { theme: 'neon' }), new MockRes());
    const ins = h.state.inserts.find((i) => i.table === 'route_map_cache');
    expect(String(ins!.values.cacheKey)).toMatch(/\|light\|branded$/);
  });
});

describe('quote-map proxy — per-tenant map style', () => {
  it('renders the tenant map style + routes the cache key through it', async () => {
    h.state.brandRows = [{ tenantId: 1, mapStyle: 'dark_routes' }];
    const handler = await getHandler();
    await handler(req('QF-ABC123.png'), new MockRes());
    const ins = h.state.inserts.find((i) => i.table === 'route_map_cache');
    expect(String(ins!.values.cacheKey)).toMatch(/\|light\|dark_routes$/);
    expect(h.getRouteMapMock).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), SECRET_KEY, 'light', undefined, 'dark_routes',
    );
  });

  it('an unknown/blank tenant style falls back to branded', async () => {
    h.state.brandRows = [{ tenantId: 1, mapStyle: 'neon-city' }];
    const handler = await getHandler();
    await handler(req('QF-ABC123.png'), new MockRes());
    const ins = h.state.inserts.find((i) => i.table === 'route_map_cache');
    expect(String(ins!.values.cacheKey)).toMatch(/\|light\|branded$/);
  });
});

describe('quote-map proxy — 404 guards', () => {
  it('(c) 404s an unknown refId', async () => {
    h.state.leadRows = [];
    const handler = await getHandler();
    const res = new MockRes();
    await handler(req('QF-NOPE.png'), res);
    expect(res.statusCode).toBe(404);
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it('(c) 404s when the tenant is not active', async () => {
    h.state.tenantRows = [{ ...baseTenant(), status: 'suspended' }];
    const handler = await getHandler();
    const res = new MockRes();
    await handler(req('QF-ABC123.png'), res);
    expect(res.statusCode).toBe(404);
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it('(c) 404s when the lead has no coordinates', async () => {
    h.state.leadRows = [{ ...baseLead(), pickupLat: null, pickupLng: null }];
    const handler = await getHandler();
    const res = new MockRes();
    await handler(req('QF-ABC123.png'), res);
    expect(res.statusCode).toBe(404);
    expect(h.getRouteMapMock).not.toHaveBeenCalled();
  });

  it('502s (not 200) when the upstream image fetch fails', async () => {
    h.fetchMock.mockResolvedValueOnce({ ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(0) });
    const handler = await getHandler();
    const res = new MockRes();
    await handler(req('QF-ABC123.png'), res);
    expect(res.statusCode).toBe(502);
    // Nothing cached on failure.
    expect(h.state.inserts.find((i) => i.table === 'route_map_cache')).toBeFalsy();
  });
});

// ── Source-level wiring guards ───────────────────────────────────────────
const routesDir = resolve(process.cwd(), 'src/server/routes');
const publicDir = resolve(process.cwd(), 'src/server/public');
const serverDir = resolve(process.cwd(), 'src/server');
const emailDir = resolve(process.cwd(), 'src/email');
const read = (dir: string) => (n: string) => readFile(resolve(dir, n), 'utf8');
const route = read(routesDir);
const pub = read(publicDir);

describe('key-leak fix (source-level)', () => {
  it('the hosted quote-doc JSON emits the PROXY url, never a raw keyed maps URL', async () => {
    const q = await route('quoteDoc.ts');
    expect(q).toContain('quoteMapProxyUrl');
    expect(q).toContain('/api/public/quote-map/');
    // The old raw keyed static-map builder is gone from the client-facing path.
    expect(q).not.toContain('maps.googleapis.com');
    expect(q).not.toContain('MAPBOX_TOKEN');
  });

  it('the proxy is registered and rate-limited', async () => {
    const app = await readFile(resolve(serverDir, 'app.ts'), 'utf8');
    expect(app).toContain('registerQuoteMapRoutes');
    const q = await route('quoteMap.ts');
    expect(q).toContain("'/api/public/quote-map/:file'");
    expect(q).toContain('quoteMapLimiter');
    expect(q).toContain("res.setHeader('Content-Type', 'image/png')");
  });
});

describe('map embedded on every surface (source-level)', () => {
  it('quote-doc email inserts the proxy img', async () => {
    const q = await route('quoteDoc.ts');
    expect(q).toContain('mapImg');
    expect(q).toMatch(/quoteMapProxyUrl\(base, lead\.refId\)/);
  });

  it('auto-reply + lead-notification emails accept + render a mapUrl', async () => {
    const t = await read(emailDir)('templates.ts');
    expect(t).toContain('routeMapImage');
    expect(t).toMatch(/leadAutoReplyEmail[\s\S]*mapUrl/);
    expect(t).toMatch(/leadNotificationEmail[\s\S]*mapUrl/);
  });

  it('public lead route passes the absolute proxy mapUrl to both emails', async () => {
    const p = await route('public.ts');
    expect(p).toContain('/api/public/quote-map/');
    expect(p).toContain('leadAutoReplyEmail({ aiBody, refId, quoteUrl, mapUrl })');
    expect(p).toMatch(/leadNotificationEmail\(\{[\s\S]*mapUrl,/);
  });

  it('widget renders the map only after a refId exists, via the proxy', async () => {
    const html = await pub('widget.html');
    expect(html).toContain('id="qf-route-map"');
    const js = await pub('widget.js');
    expect(js).toContain("'/api/public/quote-map/'");
    expect(js).toContain('encodeURIComponent(resp.refId)');
  });
});
