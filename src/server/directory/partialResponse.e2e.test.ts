/**
 * END-TO-END contract for the in-page facet navigation (X-QF-Partial).
 *
 * Boots the REAL createApp() on a real socket (same hermetic DB stub as
 * publicCacheHeaders.e2e.test.ts) and asserts, at the wire:
 *   • `X-QF-Partial: 1` → ONLY the `.dir-layout` block (no <html>, no hero);
 *   • the `?qf_partial=1` cache-key param is honoured the same way;
 *   • no signal → the full document, unchanged;
 *   • the public cache policy still applies to both shapes, and `Vary` names
 *     the partial header so a compliant cache never hands a partial to a full
 *     navigation (or vice versa) for the same URL.
 */
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PUBLIC_DIRECTORY_CACHE_CONTROL } from './httpCache.js';

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

const EMPTY_LIST = { carriers: [], total: 0, page: 1, perPage: 24, totalPages: 1, filters: {} };
const SUMMARY = { total: 0, intermodalTotal: 0, states: 0, byState: [], byPort: [] };

vi.mock('./queries.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
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
    cityDisplayName: vi.fn(async () => 'Houston'),
  };
});

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

async function get(path: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}${path}`, { redirect: 'manual', headers });
  const body = await res.text();
  return { status: res.status, body, cacheControl: res.headers.get('cache-control') ?? '', vary: res.headers.get('vary') ?? '' };
}

/** Every faceted results surface — all four share renderFacetedResults. */
const FACETED: [label: string, path: string][] = [
  ['port hub', '/directory/port/USCHI?fleet=1-25'],
  ['state hub', '/directory/texas?fleet=1-25'],
  ['city hub', '/directory/texas/houston?fleet=1-25'],
  ['master search', '/directory?state=TX&fleet=1-25'],
];

describe('X-QF-Partial on the faceted results pages', () => {
  it.each(FACETED)('%s: the header returns ONLY the results block, publicly cacheable, Vary on the header', async (_l, path) => {
    const res = await get(path, { 'X-QF-Partial': '1' });
    expect(res.status).toBe(200);
    expect(res.body.startsWith('<div class="dir-layout" data-qf-partial="1"')).toBe(true);
    expect(res.body).toContain('class="dir-results"');
    expect(res.body).toContain('class="results-toolbar"');
    expect(res.body).toContain('class="dir-rail"');
    expect(res.body).not.toContain('<html');
    expect(res.body).not.toContain('dir-hero');
    expect(res.body).not.toContain('<script');
    expect(res.cacheControl).toBe(PUBLIC_DIRECTORY_CACHE_CONTROL);
    expect(res.vary).toContain('X-QF-Partial');
    expect(res.vary).toContain('Cookie');
  });

  it.each(FACETED)('%s: the ?qf_partial=1 cache-key param is honoured identically (no header)', async (_l, path) => {
    const res = await get(`${path}&qf_partial=1`);
    expect(res.status).toBe(200);
    expect(res.body.startsWith('<div class="dir-layout" data-qf-partial="1"')).toBe(true);
    expect(res.body).not.toContain('<html');
    expect(res.cacheControl).toBe(PUBLIC_DIRECTORY_CACHE_CONTROL);
  });

  it.each(FACETED)('%s: with neither signal the full document is served, with the same policy + Vary', async (_l, path) => {
    const res = await get(path);
    expect(res.status).toBe(200);
    expect(res.body).toContain('<html');
    expect(res.body).toContain('<title>');
    expect(res.body).toContain('<div class="dir-layout">');
    // The nav script mentions the marker (it looks for it), but no partial ROOT
    // is present in a full document.
    expect(res.body).not.toContain('class="dir-layout" data-qf-partial="1"');
    expect(res.cacheControl).toBe(PUBLIC_DIRECTORY_CACHE_CONTROL);
    expect(res.vary).toContain('X-QF-Partial');
  });

  it('the partial title matches the full page <title> for the same URL', async () => {
    const [p, f] = await Promise.all([get(FACETED[0][1], { 'X-QF-Partial': '1' }), get(FACETED[0][1])]);
    const partialTitle = /data-title="([^"]*)"/.exec(p.body)?.[1];
    const fullTitle = /<title>([^<]*)<\/title>/.exec(f.body)?.[1];
    expect(partialTitle).toBeTruthy();
    expect(partialTitle).toBe(fullTitle);
  });

  it('the bare landing (/directory, no facet) ignores the partial signal — it is a different page', async () => {
    const res = await get('/directory', { 'X-QF-Partial': '1' });
    expect(res.status).toBe(200);
    expect(res.body).toContain('<html');
    expect(res.body).not.toContain('class="dir-layout" data-qf-partial="1"');
  });
});
