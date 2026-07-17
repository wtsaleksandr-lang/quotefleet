/**
 * Tenant KPI overview route — GET /api/tenant/overview/kpis.
 *
 * Drives the registered handler with a mock req/res + a mocked db (the leads
 * query resolves seeded rows), asserting the response shape, period handling,
 * and that the tile math flows through the shared summarizeKpis(). The handler
 * is captured from a fake app so the requireAuth/requireTenant middleware is
 * bypassed; a source-level guard locks the route's auth wiring in place.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const DAY = 24 * 60 * 60 * 1000;

const h = vi.hoisted(() => {
  const state = { leadRows: [] as Record<string, unknown>[] };
  return { state };
});

// Mock the DB — the KPI handler does db().select({...}).from(leads).where(...).orderBy(...)
// and awaits the result. The chain resolves the seeded lead rows.
vi.mock('../../db/client.js', () => {
  function makeSelect() {
    const chain: Record<string, unknown> = {
      from() { return chain; },
      where() { return chain; },
      orderBy() { return Promise.resolve(h.state.leadRows); },
    };
    return chain;
  }
  return { db: () => ({ select: () => makeSelect() }) };
});

type Handler = (req: MockReq, res: MockRes) => unknown;
interface MockReq { tenant: { id: number }; query: Record<string, unknown> }
class MockRes {
  statusCode = 200;
  body: unknown = undefined;
  status(c: number) { this.statusCode = c; return this; }
  json(o: unknown) { this.body = o; return this; }
}

async function getHandler(): Promise<Handler> {
  const { registerTenantRoutes } = await import('./tenant.js');
  const handlers: Record<string, Handler> = {};
  const record = (method: string) => (path: string, ...rest: unknown[]) => {
    handlers[`${method} ${path}`] = rest[rest.length - 1] as Handler;
  };
  const fakeApp = {
    get: record('GET'),
    post: record('POST'),
    put: record('PUT'),
    patch: record('PATCH'),
    delete: record('DELETE'),
  } as unknown as import('express').Express;
  registerTenantRoutes(fakeApp);
  const handler = handlers['GET /api/tenant/overview/kpis'];
  if (!handler) throw new Error('KPI handler not registered');
  return handler;
}

function req(query: Record<string, unknown> = {}): MockReq {
  return { tenant: { id: 1 }, query };
}

beforeEach(() => {
  h.state.leadRows = [];
  process.env.SESSION_SECRET ||= 'test'.repeat(16);
  process.env.DATABASE_URL ||= 'postgresql://x';
  process.env.ANTHROPIC_API_KEY ||= 'sk-test';
  process.env.PUBLIC_BASE_URL ||= 'https://quotefleet.net';
});

describe('GET /api/tenant/overview/kpis', () => {
  it('returns the full KPI shape and flows leads through the summarizer', async () => {
    const now = Date.now();
    const ago = (n: number) => new Date(now - n * DAY);
    h.state.leadRows = [
      // current 30d window
      { createdAt: ago(1), status: 'won', quotedTotal: 1000, equipment: 'Dry Van', pickupCity: 'LA', deliveryCity: 'Chicago' },
      { createdAt: ago(4), status: 'booking_requested', quotedTotal: 2000, equipment: 'Reefer', pickupCity: 'LA', deliveryCity: 'Chicago' },
      { createdAt: ago(9), status: 'new', quotedTotal: 500, equipment: 'Dry Van', pickupCity: 'Newark', deliveryCity: 'Boston' },
      // prior window
      { createdAt: ago(40), status: 'won', quotedTotal: 800, equipment: 'Dry Van', pickupCity: 'LA', deliveryCity: 'Chicago' },
      // outside both windows
      { createdAt: ago(75), status: 'new', quotedTotal: 9999, equipment: 'Flatbed', pickupCity: 'X', deliveryCity: 'Y' },
    ];
    const res = new MockRes();
    await getHandler().then((fn) => fn(req(), res));

    expect(res.statusCode).toBe(200);
    const body = res.body as {
      period: string;
      tiles: {
        quotes: { current: number; previous: number };
        won: { current: number };
        conversionPct: number;
        quotedValue: { current: number };
        avgQuote: { current: number };
      };
      series: unknown[];
      topLanes: Array<{ lane: string; count: number }>;
      equipmentMix: Array<{ equipment: string; count: number }>;
    };

    expect(body.period).toBe('30d'); // default
    expect(body.tiles.quotes.current).toBe(3);
    expect(body.tiles.quotes.previous).toBe(1);
    expect(body.tiles.won.current).toBe(2); // won + booking_requested
    expect(body.tiles.conversionPct).toBe(67); // round(2/3)
    expect(body.tiles.quotedValue.current).toBe(3500);
    expect(body.tiles.avgQuote.current).toBe(1167); // round(3500/3)
    expect(body.series).toHaveLength(30);
    expect(body.topLanes[0]).toEqual({ lane: 'LA → Chicago', count: 2, value: 3000 });
    expect(body.equipmentMix[0]).toEqual({ equipment: 'Dry Van', count: 2 });
  });

  it('honors ?period=7d and defaults an invalid period to 30d', async () => {
    const res7 = new MockRes();
    await getHandler().then((fn) => fn(req({ period: '7d' }), res7));
    expect((res7.body as { period: string; series: unknown[] }).period).toBe('7d');
    expect((res7.body as { series: unknown[] }).series).toHaveLength(7);

    const resBad = new MockRes();
    await getHandler().then((fn) => fn(req({ period: 'yearly' }), resBad));
    expect((resBad.body as { period: string }).period).toBe('30d');
  });

  it('emits weekly buckets for ?period=90d', async () => {
    const res = new MockRes();
    await getHandler().then((fn) => fn(req({ period: '90d' }), res));
    expect((res.body as { period: string; series: unknown[] }).period).toBe('90d');
    expect((res.body as { series: unknown[] }).series).toHaveLength(13);
  });
});

describe('KPI route wiring (source-level)', () => {
  it('is guarded by requireAuth + requireTenant and reads via the tenant/created index', async () => {
    const src = await readFile(resolve(process.cwd(), 'src/server/routes/tenant.ts'), 'utf8');
    expect(src).toContain("app.get('/api/tenant/overview/kpis', requireAuth, requireTenant");
    expect(src).toContain('summarizeKpis');
    expect(src).toContain('gte(leads.createdAt, since)');
  });
});
