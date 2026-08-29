/**
 * END-TO-END CACHE-HEADER CONTRACT — the gap that let 0068's caching ship broken.
 *
 * WHY THIS FILE EXISTS, AND WHY crawlCost.test.ts WAS NOT ENOUGH:
 *
 * crawlCost.test.ts calls each directory handler DIRECTLY, with a hand-written
 * `MockRes` and a hand-written request whose `method` is always the string
 * `'GET'`. Every assertion in it passed — and production still answered
 * `Cache-Control: private, no-store` on every public directory URL, because the
 * thing that broke was never visible to a handler called in isolation:
 *
 *   `curl -I` — the way anyone verifies a cache header, and the way a monitor,
 *   a link checker, a CDN warm-up and several crawlers fetch — issues a HEAD.
 *   Express routes HEAD through the SAME `app.get()` handler, but with
 *   `req.method === 'HEAD'`, which `isSharedCacheable` rejected as "not a GET".
 *   Every public directory surface therefore degraded to `private, no-store`
 *   for the exact request that everyone uses to check it.
 *
 * So this suite asserts the FINAL header on the wire: it boots the REAL
 * `createApp()` — the whole production middleware chain, compression, cookie
 * parser, host info, the partners `?ref=` capture, the rate limiters, route
 * registration order and all — on a real socket, and drives it with real HTTP
 * requests. If any middleware ever clobbers `Cache-Control`, or a route stops
 * calling the helper, or method handling regresses again, it fails HERE, at the
 * layer prod actually observes.
 *
 * The DB is stubbed (empty result sets) because this is a HEADER contract, not
 * a data contract — the pages must render their empty state and still carry the
 * right policy.
 */
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PUBLIC_DIRECTORY_CACHE_CONTROL, NO_STORE_CACHE_CONTROL } from './httpCache.js';
import { SESSION_COOKIE_NAME } from '../../auth/session.js';

// ── DB stub ────────────────────────────────────────────────────────────────
// `db()` returns a drizzle instance; every builder call chains and every await
// resolves to an empty result set. Nothing here touches a network socket, so
// the suite is hermetic and cannot be broken by a dev DB over quota.
function chain(): unknown {
  const target = () => chain();
  return new Proxy(target, {
    get: (_t, prop) =>
      prop === 'then'
        ? (onFulfilled: (v: unknown[]) => unknown) => Promise.resolve([]).then(onFulfilled)
        : () => chain(),
    apply: () => chain(),
  });
}

vi.mock('../../db/client.js', () => ({
  db: () => chain(),
  pool: { query: async () => ({ rows: [] }) },
  closeDb: async () => {},
}));

const CARRIER = {
  usdot: '107080',
  publicSlug: 'acme-trucking-107080',
  legalName: 'ACME TRUCKING INC',
  dbaName: null,
  city: 'Savannah',
  state: 'GA',
  capabilities: null,
  operatingLocations: null,
};

const EMPTY_LIST = { carriers: [], total: 0, page: 1, perPage: 24, totalPages: 1, filters: {} };
const SUMMARY = { total: 0, intermodalTotal: 0, states: 0, byState: [], byPort: [] };

vi.mock('./queries.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  // Build the zeroed FacetCounts from the module's own option lists (rather than
  // a hand-copied literal) so a new equipment/cargo facet can never silently
  // leave this stub half-shaped and turn a header assertion into a 500.
  const zeros = (opts: readonly { id: string }[]) => Object.fromEntries(opts.map((o) => [o.id, 0]));
  const { PORT_GROUPS } = await import('./containerPorts.js');
  const FACETS = {
    fleet: zeros(actual.FLEET_BUCKETS as readonly { id: string }[]),
    drivers: zeros(actual.DRIVERS_BUCKETS as readonly { id: string }[]),
    equipment: zeros(actual.EQUIPMENT_OPTIONS as readonly { id: string }[]),
    cargo: zeros(actual.CARGO_OPTIONS as readonly { id: string }[]),
    goodStanding: 0,
    ports: Object.fromEntries(PORT_GROUPS.map((g) => [g.code, 0])),
    authorityActive: 0,
    intermodal: 0,
    recent: 0,
  };
  return {
    ...actual,
    getDirectorySummary: vi.fn(async () => SUMMARY),
    listCarriers: vi.fn(async () => EMPTY_LIST),
    carriersByCity: vi.fn(async () => EMPTY_LIST),
    getFacetCounts: vi.fn(async () => FACETS),
    citiesForState: vi.fn(async () => []),
    carrierBySlug: vi.fn(async (slug: string) => (slug === CARRIER.publicSlug ? CARRIER : null)),
    relatedCarriers: vi.fn(async () => []),
    cityCarrierCount: vi.fn(async () => 0),
    stateCarrierCount: vi.fn(async () => 0),
    cityDisplayName: vi.fn(async () => 'Savannah'),
  };
});

// ── Real server on a real socket ───────────────────────────────────────────
let server: Server;
let base = '';

beforeAll(async () => {
  process.env.SESSION_SECRET ||= 'test'.repeat(16);
  process.env.DATABASE_URL ||= 'postgresql://user:pw@127.0.0.1:1/db';
  const { createApp } = await import('../app.js');
  server = createServer(createApp());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  base = `http://127.0.0.1:${address.port}`;
}, 60_000);

afterAll(async () => {
  if (!server) return;
  server.close();
  await once(server, 'close');
});

interface Observed {
  status: number;
  cacheControl: string;
  vary: string;
  setCookie: string | null;
}

/** Issue a REAL request through the REAL app and report the headers on the wire. */
async function observe(
  path: string,
  init: { method?: 'GET' | 'HEAD'; cookie?: string } = {},
): Promise<Observed> {
  const res = await fetch(`${base}${path}`, {
    method: init.method ?? 'GET',
    redirect: 'manual',
    headers: init.cookie ? { cookie: init.cookie } : {},
  });
  // Drain so the socket is released even on HEAD.
  await res.arrayBuffer();
  return {
    status: res.status,
    cacheControl: res.headers.get('cache-control') ?? '',
    vary: res.headers.get('vary') ?? '',
    setCookie: res.headers.get('set-cookie'),
  };
}

/** The public directory surfaces the sitemap advertises (~350k URLs). */
const PUBLIC_PATHS: [label: string, path: string][] = [
  ['landing', '/directory'],
  ['state hub', '/directory/texas'],
  ['city hub', '/directory/texas/houston'],
  ['carrier profile', `/directory/carrier/${CARRIER.publicSlug}`],
  ['compliance tools', '/compliance'],
  // Static-content surfaces. /glossary and /services shipped with NO
  // Cache-Control at all, so Cloudflare treated them as DYNAMIC and every
  // crawler hit reached the origin — and the /services handler runs a
  // listCarriers query per request. They are byte-identical for every visitor,
  // so they belong on the same shared-cache policy as the directory hubs.
  ['glossary index', '/glossary'],
  ['glossary term', '/glossary/drayage'],
  ['services hub', '/services'],
  ['service category', '/services/hazmat-drayage'],
  ['drayage rates hub', '/drayage-rates'],
  ['drayage rates port', '/drayage-rates/savannah'],
  // The editorial hub. It renders from a published-only DB read and is
  // byte-identical for every visitor, so it must be on the shared-cache policy
  // like every other content surface. (An individual /guides/:slug needs a
  // published row this fixture does not seed; the hub covers the route wiring.)
  ['guides hub', '/guides'],
];

describe('public directory HTML — the header that actually reaches the wire', () => {
  it.each(PUBLIC_PATHS)('%s: an anonymous GET is publicly cacheable', async (_label, path) => {
    const res = await observe(path);
    expect(res.status).toBe(200);
    expect(res.cacheControl).toBe(PUBLIC_DIRECTORY_CACHE_CONTROL);
    expect(res.vary).toContain('Cookie');
    // A shared-cache entry that also carried a Set-Cookie would hand one
    // visitor's cookie to every subsequent visitor.
    expect(res.setCookie).toBeNull();
  });

  // ── THE REGRESSION THIS FILE WAS WRITTEN FOR ─────────────────────────────
  // HEAD is safe and cacheable (RFC 9110 §9.3.2), and the spec requires the
  // SAME header fields a GET would have sent. It is also how `curl -I`, uptime
  // monitors and link checkers verify a deploy. Express dispatches HEAD to the
  // registered GET handler, so the only difference must be the absent body.
  it.each(PUBLIC_PATHS)('%s: a HEAD carries the SAME policy as the GET', async (_label, path) => {
    const [get, head] = [await observe(path), await observe(path, { method: 'HEAD' })];
    expect(head.status).toBe(200);
    expect(head.cacheControl).toBe(PUBLIC_DIRECTORY_CACHE_CONTROL);
    expect(head.cacheControl).toBe(get.cacheControl);
    expect(head.vary).toBe(get.vary);
  });

  it('the sitemap the crawler follows stays publicly cacheable on GET and HEAD', async () => {
    for (const method of ['GET', 'HEAD'] as const) {
      const res = await observe('/sitemap.xml', { method });
      expect(res.status).toBe(200);
      expect(res.cacheControl).toBe('public, max-age=3600');
    }
  });
});

describe('the fail-closed safety contract still holds end-to-end', () => {
  it.each(PUBLIC_PATHS)('%s: a request with a SESSION COOKIE degrades to no-store', async (_l, path) => {
    const res = await observe(path, { cookie: `${SESSION_COOKIE_NAME}=fake-session-id` });
    expect(res.cacheControl).toBe(NO_STORE_CACHE_CONTROL);
    expect(res.vary).not.toContain('Cookie');
  });

  it.each(PUBLIC_PATHS)('%s: a HEAD with a session cookie is no-store too', async (_l, path) => {
    const res = await observe(path, { method: 'HEAD', cookie: `${SESSION_COOKIE_NAME}=fake-session-id` });
    expect(res.cacheControl).toBe(NO_STORE_CACHE_CONTROL);
  });

  it('a ?ref= attribution hit is never shared — partners.ts drops a 90-day cookie on it', async () => {
    const res = await observe('/directory/texas?ref=PARTNER7');
    expect(res.cacheControl).toBe(NO_STORE_CACHE_CONTROL);
  });

  it('the ?upgrade= post-checkout banner variant of the landing is never shared', async () => {
    const res = await observe('/directory?upgrade=success');
    expect(res.cacheControl).toBe(NO_STORE_CACHE_CONTROL);
  });

  it('per-user directory surfaces stay private on GET and HEAD', async () => {
    // /directory/join prints the signed-in shipper's email; /api/directory/auth/me
    // IS the identity. Both live under paths a wildcard CDN rule would swallow.
    for (const path of ['/directory/join', '/api/directory/auth/me']) {
      for (const method of ['GET', 'HEAD'] as const) {
        const res = await observe(path, { method });
        expect(res.cacheControl).toBe(NO_STORE_CACHE_CONTROL);
      }
    }
  });

  it('an out-of-range ?page= rejection is never cached onto the URL', async () => {
    const res = await observe('/directory/texas?page=13917');
    expect(res.status).toBe(404);
    expect(res.cacheControl).toBe(NO_STORE_CACHE_CONTROL);
  });

  it('a missing carrier profile 404 is never cached onto the URL', async () => {
    const res = await observe('/directory/carrier/no-such-carrier-999999');
    expect(res.status).toBe(404);
    expect(res.cacheControl).toBe(NO_STORE_CACHE_CONTROL);
  });

  it('a non-GET/HEAD method is never marked shareable', async () => {
    // POST /directory has no handler, so it must not pick up a public policy
    // from anywhere in the chain on its way to the 404.
    const res = await fetch(`${base}/directory`, { method: 'POST', redirect: 'manual' });
    await res.arrayBuffer();
    expect(res.headers.get('cache-control') ?? '').not.toContain('public');
  });

  it('the per-IP RateLimit headers never ride along into a shared cache entry', async () => {
    const res = await fetch(`${base}/directory/texas`, { redirect: 'manual' });
    await res.arrayBuffer();
    expect(res.headers.get('cache-control')).toBe(PUBLIC_DIRECTORY_CACHE_CONTROL);
    for (const h of ['RateLimit', 'RateLimit-Policy', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset']) {
      expect(res.headers.get(h)).toBeNull();
    }
  });
});
