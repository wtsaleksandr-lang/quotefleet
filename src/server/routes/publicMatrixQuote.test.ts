/**
 * Public customer quote path × native rate matrices (Tier 2 end-to-end).
 *
 * Guards the two production entry points that previously DROPPED matrices:
 *   1. `loadConfig` now SELECTs rate_matrices + rate_zones and returns them.
 *   2. `POST /api/public/quote/:slug` passes them to calculate() as the 7th/8th
 *      args, so a matrix lane prices to the EXACT cell — including the
 *      ASYMMETRY (A→B ≠ B→A), the MIN-CHARGE floor, and per-container drayage
 *      (20 vs 40 vs reefer resolve to DIFFERENT cells).
 *
 * The DB is mocked table-aware (keyed on drizzle's getTableName), distance is
 * mocked (flat-basis cells don't depend on miles), and tenant access is open.
 * Everything else runs the REAL route handler + REAL pricing engine.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const state = {
    tenantRows: [] as Record<string, unknown>[],
    brandRows: [] as Record<string, unknown>[],
    rateCardRows: [] as Record<string, unknown>[],
    accessorialRows: [] as Record<string, unknown>[],
    laneZoneRows: [] as Record<string, unknown>[],
    terminalRows: [] as Record<string, unknown>[],
    matrixRows: [] as Record<string, unknown>[],
    zoneRows: [] as Record<string, unknown>[],
    portRows: [] as Record<string, unknown>[],
  };
  return { state };
});

vi.mock('../../db/client.js', async () => {
  const { getTableName } = await import('drizzle-orm');
  function rowsFor(table: unknown): Record<string, unknown>[] {
    const n = getTableName(table as never);
    if (n === 'tenants') return h.state.tenantRows;
    if (n === 'brand_configs') return h.state.brandRows;
    if (n === 'rate_cards') return h.state.rateCardRows;
    if (n === 'accessorials') return h.state.accessorialRows;
    if (n === 'lane_zones') return h.state.laneZoneRows;
    if (n === 'terminals') return h.state.terminalRows;
    if (n === 'rate_matrices') return h.state.matrixRows;
    if (n === 'rate_zones') return h.state.zoneRows;
    if (n === 'ports') return h.state.portRows;
    return [];
  }
  function makeSelect() {
    let table: unknown;
    const chain: Record<string, unknown> = {
      from(t: unknown) { table = t; return chain; },
      where() { return chain; },
      orderBy() { return chain; },
      limit() { return Promise.resolve(rowsFor(table)); },
      then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
        return Promise.resolve(rowsFor(table)).then(res, rej);
      },
    };
    return chain;
  }
  return { db: () => ({ select: () => makeSelect() }) };
});

// Flat-basis matrix cells don't depend on miles; return fixed coords + distance.
vi.mock('../../calc/distance.js', () => ({
  distanceBetween: vi.fn(async () => ({
    miles: 400,
    origin: { lat: 34, lng: -118 },
    destination: { lat: 32.8, lng: -96.8 },
  })),
}));

// Public (non-private) tenant: access is always granted.
vi.mock('../access.js', () => ({ enforceTenantAccess: vi.fn(async () => true) }));

type Handler = (req: MockReq, res: MockRes) => unknown;
interface MockReq { params: { slug: string }; body: unknown; headers: Record<string, string> }
class MockRes {
  statusCode = 200;
  body: unknown = undefined;
  status(c: number) { this.statusCode = c; return this; }
  json(o: unknown) { this.body = o; return this; }
}

async function getQuoteHandler(): Promise<Handler> {
  const { registerPublicRoutes } = await import('./public.js');
  let handler: Handler | undefined;
  const fakeApp = {
    get: () => {},
    post: (path: string, ...rest: unknown[]) => {
      if (path === '/api/public/quote/:slug') handler = rest[rest.length - 1] as Handler;
    },
    use: () => {},
  } as unknown as import('express').Express;
  registerPublicRoutes(fakeApp);
  if (!handler) throw new Error('quote handler not registered');
  return handler;
}

function quoteReq(body: unknown): MockReq {
  return { params: { slug: 'acme' }, body, headers: {} };
}

const activeTenant = () => ({
  id: 1, slug: 'acme', name: 'Acme Freight', status: 'active',
  countryFocus: 'US', isPrivate: false,
});

beforeEach(() => {
  h.state.tenantRows = [activeTenant()];
  h.state.brandRows = [];
  h.state.rateCardRows = [];
  h.state.accessorialRows = [];
  h.state.laneZoneRows = [];
  h.state.terminalRows = [];
  h.state.matrixRows = [];
  h.state.zoneRows = [];
  h.state.portRows = [];
  process.env.SESSION_SECRET ||= 'test'.repeat(16);
  process.env.DATABASE_URL ||= 'postgresql://x';
  process.env.ANTHROPIC_API_KEY ||= 'sk-test';
  process.env.PUBLIC_BASE_URL ||= 'https://quotefleet.net';
});

describe('loadConfig — loads rate matrices + zones', () => {
  it('returns matrices and matrixZones from the DB', async () => {
    h.state.matrixRows = [
      { id: 1, tenantId: 1, mode: 'ftl', equipment: 'dryvan', originKey: '900', destKey: '850', rate: 1900, unitBasis: 'flat', minCharge: null, currency: 'USD', enabled: true },
    ];
    h.state.zoneRows = [
      { id: 1, tenantId: 1, zoneId: 'W', matchKind: 'zip3', matchValue: '900', enabled: true },
    ];
    const { loadConfig } = await import('./public.js');
    const cfg = await loadConfig(1);
    expect(cfg.matrices).toHaveLength(1);
    expect(cfg.matrices[0]).toMatchObject({ originKey: '900', destKey: '850', rate: 1900 });
    expect(cfg.matrixZones).toHaveLength(1);
    expect(cfg.matrixZones[0]).toMatchObject({ zoneId: 'W', matchKind: 'zip3' });
  });
});

describe('POST /api/public/quote/:slug — prices the matrix cell', () => {
  // Directional FTL grid keyed on zip3 (no zone legend needed — a shipment zip
  // resolves to its own zip3). Plus a min-charge lane.
  function seedFtlMatrix() {
    h.state.matrixRows = [
      { id: 1, tenantId: 1, mode: 'ftl', equipment: 'dryvan', originKey: '900', destKey: '850', rate: 1900, unitBasis: 'flat', minCharge: null, currency: 'USD', enabled: true },
      { id: 2, tenantId: 1, mode: 'ftl', equipment: 'dryvan', originKey: '850', destKey: '900', rate: 1750, unitBasis: 'flat', minCharge: null, currency: 'USD', enabled: true },
      { id: 3, tenantId: 1, mode: 'ftl', equipment: 'dryvan', originKey: '900', destKey: '600', rate: 100, unitBasis: 'flat', minCharge: 500, currency: 'USD', enabled: true },
    ];
  }

  async function quote(body: unknown) {
    const res = new MockRes();
    await (await getQuoteHandler())(quoteReq(body) as never, res as never);
    return res;
  }

  const ftlBody = (puZip: string, deZip: string) => ({
    service: 'ftl', equipment: 'dryvan',
    pickup: { zip: puZip, country: 'US' },
    delivery: { zip: deZip, country: 'US' },
  });

  it('prices LA→Dallas and the reverse to DIFFERENT cells (asymmetry)', async () => {
    seedFtlMatrix();
    const fwd = await quote(ftlBody('90045', '85003')); // 900 → 850
    const rev = await quote(ftlBody('85003', '90045')); // 850 → 900
    expect(fwd.statusCode).toBe(200);
    expect(rev.statusCode).toBe(200);
    expect((fwd.body as { result: { total: number } }).result.total).toBe(1900);
    expect((rev.body as { result: { total: number } }).result.total).toBe(1750);
  });

  it('applies the per-cell min-charge floor', async () => {
    seedFtlMatrix();
    const r = await quote(ftlBody('90045', '60007')); // 900 → 600 (zip3), rate 100 floored to 500
    expect((r.body as { result: { total: number } }).result.total).toBe(500);
  });

  it('drayage per-container: 20 vs 40 vs reefer resolve to DIFFERENT cells', async () => {
    h.state.matrixRows = [
      { id: 1, tenantId: 1, mode: 'drayage', equipment: 'container_20', originKey: 'USLAX', destKey: '90744', rate: 340, unitBasis: 'per_container', minCharge: null, currency: 'USD', enabled: true },
      { id: 2, tenantId: 1, mode: 'drayage', equipment: 'container_40', originKey: 'USLAX', destKey: '90744', rate: 355, unitBasis: 'per_container', minCharge: null, currency: 'USD', enabled: true },
      { id: 3, tenantId: 1, mode: 'drayage', equipment: 'reefer', originKey: 'USLAX', destKey: '90744', rate: 605, unitBasis: 'per_container', minCharge: null, currency: 'USD', enabled: true },
    ];
    const drayBody = (equip: string) => ({
      service: 'drayage', equipment: equip,
      pickup: { portCode: 'USLAX', country: 'US' },
      delivery: { zip: '90744', country: 'US' },
    });
    const c20 = await quote(drayBody('container_20'));
    const c40 = await quote(drayBody('container_40'));
    const re = await quote(drayBody('reefer'));
    expect((c20.body as { result: { total: number } }).result.total).toBe(340);
    expect((c40.body as { result: { total: number } }).result.total).toBe(355);
    expect((re.body as { result: { total: number } }).result.total).toBe(605);
  });

  it('port-code reconciliation: a USEWR-keyed drayage lane prices whether the shipper picked USEWR or USNYC', async () => {
    // The audit gap end-to-end: the ingested matrix keys the Newark lane on
    // USEWR (what the rate sheet prints), but the autosuggest historically
    // resolved Newark to the umbrella USNYC → the cell never matched. The
    // alias fix makes BOTH selections hit the same cell.
    h.state.matrixRows = [
      { id: 1, tenantId: 1, mode: 'drayage', equipment: 'container_40', originKey: 'USEWR', destKey: '07114', rate: 395, unitBasis: 'per_container', minCharge: null, currency: 'USD', enabled: true },
    ];
    const drayBody = (portCode: string) => ({
      service: 'drayage', equipment: 'container_40',
      pickup: { portCode, country: 'US' },
      delivery: { zip: '07114', country: 'US' },
    });
    const asEwr = await quote(drayBody('USEWR'));
    const asNyc = await quote(drayBody('USNYC')); // the previously-broken case
    expect((asEwr.body as { result: { total: number } }).result.total).toBe(395);
    expect((asNyc.body as { result: { total: number } }).result.total).toBe(395);
  });

  it('LA/LB pool: a USLAX-keyed lane prices when the shipper picked Long Beach (USLGB)', async () => {
    h.state.matrixRows = [
      { id: 1, tenantId: 1, mode: 'drayage', equipment: 'container_40', originKey: 'USLAX', destKey: '90744', rate: 355, unitBasis: 'per_container', minCharge: null, currency: 'USD', enabled: true },
    ];
    const r = await quote({
      service: 'drayage', equipment: 'container_40',
      pickup: { portCode: 'USLGB', country: 'US' },
      delivery: { zip: '90744', country: 'US' },
    });
    expect((r.body as { result: { total: number } }).result.total).toBe(355);
  });

  it('without matrices a matrix lane no longer prices (proves the plumbing is load-bearing)', async () => {
    // No cards, no matrices → the lane is unsupported (control for the fix).
    const r = await quote(ftlBody('90045', '85003'));
    const body = r.body as { result?: { unsupported?: unknown }; error?: string };
    // Either an unsupported result or a 4xx — the point is it does NOT return a price.
    const priced = typeof (body as { result?: { total?: number } })?.result?.total === 'number'
      && (body as { result: { total: number } }).result.total > 0;
    expect(priced).toBe(false);
  });
});
