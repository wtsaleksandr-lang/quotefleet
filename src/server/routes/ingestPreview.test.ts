/**
 * "Test your rates" preview-quote endpoint — confirm-by-simulation.
 *
 * Asserts the properties that make it safe to run BEFORE applying a draft:
 *   (a) it computes a real quote from a ready_for_review draft job and
 *       PERSISTS NOTHING (no insert / update / transaction ever fires),
 *   (b) it is tenant-scoped / IDOR-safe — a job that doesn't belong to the
 *       caller's tenant 404s (the select is filtered by tenantId),
 *   (c) a lane with no matching draft rate card comes back gracefully as
 *       `unsupported` (200 + engine reason), never a 500 or a bogus $0 quote,
 *   (d) a job that isn't ready_for_review 409s.
 *
 * The engine (calculate) is REAL — the draft is mapped through the same
 * draftToEngineConfig() the endpoint uses, so a pricing regression fails here.
 * Only the DB and the distance geocoder are mocked (never touch a network).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runDraftAutoCheck, buildAutoCheckSamples, draftToEngineConfig } from './ingest.js';

const h = vi.hoisted(() => {
  const state = {
    jobRows: [] as Record<string, unknown>[],
    writes: [] as string[],
  };
  const distanceMock = vi.fn(async () => ({
    miles: 500,
    origin: { lat: 33.77, lng: -118.19, source: 'zip' as const },
    destination: { lat: 33.45, lng: -112.07, source: 'zip' as const },
  }));
  return { state, distanceMock };
});

vi.mock('../../db/client.js', () => {
  function makeSelect() {
    const chain: Record<string, unknown> = {
      from() { return chain; },
      where() { return chain; },
      limit() { return Promise.resolve(h.state.jobRows); },
      then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
        return Promise.resolve(h.state.jobRows).then(res, rej);
      },
    };
    return chain;
  }
  return {
    db: () => ({
      select: () => makeSelect(),
      // Any of these firing would mean the preview persisted something.
      insert: () => { h.state.writes.push('insert'); return { values: () => ({ returning: () => Promise.resolve([]) }) }; },
      update: () => { h.state.writes.push('update'); return { set: () => ({ where: () => Promise.resolve() }) }; },
      transaction: async () => { h.state.writes.push('transaction'); },
    }),
  };
});

vi.mock('../../calc/distance.js', () => ({ distanceBetween: h.distanceMock }));

type Handler = (req: MockReq, res: MockRes) => unknown;
interface MockReq { params: { id: string }; body: unknown; tenant: { id: number }; user: { id: number } }
class MockRes {
  statusCode = 200;
  body: unknown = undefined;
  status(c: number) { this.statusCode = c; return this; }
  json(o: unknown) { this.body = o; return this; }
}

async function getHandler(): Promise<Handler> {
  const { registerIngestRoutes } = await import('./ingest.js');
  let handler: Handler | undefined;
  const fakeApp = {
    post: (path: string, ...rest: unknown[]) => {
      if (path === '/api/tenant/ingest/:id/preview-quote') handler = rest[rest.length - 1] as Handler;
    },
    get: () => {},
  } as unknown as import('express').Express;
  registerIngestRoutes(fakeApp);
  if (!handler) throw new Error('preview-quote handler not registered');
  return handler;
}

function req(body: unknown, id = '7', tenantId = 1): MockReq {
  return { params: { id }, body, tenant: { id: tenantId }, user: { id: 1 } };
}

const readyJob = () => ({
  id: 7,
  tenantId: 1,
  status: 'ready_for_review',
  parsedJson: {
    rateCards: [
      { service: 'ftl', equipment: 'dryvan', label: '53\' Dry Van', ratePerMile: 2.5, minimumCharge: 400, flatFee: 0, fuelSurchargePct: 20, marginPct: 10 },
    ],
    accessorials: [],
    laneZones: [],
  },
});

beforeEach(() => {
  h.state.jobRows = [readyJob()];
  h.state.writes = [];
  h.distanceMock.mockClear();
  process.env.SESSION_SECRET ||= 'test'.repeat(16);
  process.env.DATABASE_URL ||= 'postgresql://x';
});

const sample = {
  service: 'ftl', equipment: 'dryvan',
  pickup: { city: 'Long Beach', state: 'CA', country: 'US' },
  delivery: { city: 'Phoenix', state: 'AZ', country: 'US' },
};

describe('preview-quote — computes a draft quote without persisting', () => {
  it('(a) returns a real computed quote and writes NOTHING to the DB', async () => {
    const handler = await getHandler();
    const res = new MockRes();
    await handler(req(sample), res);
    expect(res.statusCode).toBe(200);
    const b = res.body as { ok: boolean; miles: number; result: { total: number; lines: unknown[]; margin: number } };
    expect(b.ok).toBe(true);
    expect(b.miles).toBe(500);
    // 500mi × $2.50 = 1250 linehaul; +20% fuel (250) = 1500; +10% margin (150) = 1650.
    expect(b.result.total).toBe(1650);
    expect(b.result.lines.length).toBeGreaterThan(0);
    // Customer-facing: margin figure is never shipped over the wire.
    expect(b.result.margin).toBe(0);
    // The whole point: no DB write of any kind.
    expect(h.state.writes).toEqual([]);
  });

  it('(c) an unmatched service/equipment comes back gracefully as unsupported', async () => {
    const handler = await getHandler();
    const res = new MockRes();
    await handler(req({ ...sample, service: 'ltl', equipment: 'reefer' }), res);
    expect(res.statusCode).toBe(200);
    const b = res.body as { ok: boolean; unsupported?: { reason: string } };
    expect(b.unsupported).toBeTruthy();
    expect(b.unsupported!.reason).toMatch(/no rate card/i);
    expect(h.state.writes).toEqual([]);
  });

  it('surfaces a geocode failure as unsupported, not a crash', async () => {
    h.distanceMock.mockResolvedValueOnce({ error: 'Could not resolve pickup location to coordinates.' } as never);
    const handler = await getHandler();
    const res = new MockRes();
    await handler(req(sample), res);
    expect(res.statusCode).toBe(200);
    expect((res.body as { unsupported?: { reason: string } }).unsupported!.reason).toMatch(/resolve pickup/i);
  });
});

describe('preview-quote — tenant scoping & status guards', () => {
  it('(b) 404s a job that does not belong to the caller tenant (IDOR)', async () => {
    h.state.jobRows = []; // tenant-filtered select finds nothing
    const handler = await getHandler();
    const res = new MockRes();
    await handler(req(sample), res);
    expect(res.statusCode).toBe(404);
    expect(h.distanceMock).not.toHaveBeenCalled();
  });

  it('(d) 409s a job that is not ready_for_review', async () => {
    h.state.jobRows = [{ ...readyJob(), status: 'parsing' }];
    const handler = await getHandler();
    const res = new MockRes();
    await handler(req(sample), res);
    expect(res.statusCode).toBe(409);
    expect(h.distanceMock).not.toHaveBeenCalled();
  });

  it('400s an invalid sample body', async () => {
    const handler = await getHandler();
    const res = new MockRes();
    await handler(req({ service: 'ftl' }), res); // missing equipment/pickup/delivery
    expect(res.statusCode).toBe(400);
  });
});

// ── System auto-verification helper (no network, pure over the draft) ──────
describe('runDraftAutoCheck — system auto-verification of a draft', () => {
  const goodDraft = {
    rateCards: [
      { service: 'ftl', equipment: 'dryvan', ratePerMile: 2.4, minimumCharge: 450, fuelSurchargePct: 22, marginPct: 12 },
    ],
    accessorials: [],
    laneZones: [
      { label: 'LAX 0-30', anchorPortCode: 'USLAX', radiusMiles: 30, flatPrice: 425, equipmentScope: ['container_40'] },
    ],
  };

  it('generates a spread of samples from the draft (short/med/long + zone), capped at 8', () => {
    const { cards, zones } = draftToEngineConfig(goodDraft);
    const samples = buildAutoCheckSamples(cards, zones);
    expect(samples.length).toBeGreaterThanOrEqual(3);
    expect(samples.length).toBeLessThanOrEqual(8);
    // The lane zone yields a drayage flat-tariff probe.
    expect(samples.some((s) => s.request.service === 'drayage' && s.request.pickupPortCode === 'USLAX')).toBe(true);
    // The FTL card yields short/medium/long distance lanes.
    const ftlMiles = samples.filter((s) => s.request.service === 'ftl').map((s) => s.request.miles).sort((a, b) => a - b);
    expect(ftlMiles.length).toBe(3);
    expect(ftlMiles[0]).toBeLessThan(ftlMiles[2]);
  });

  it('reports all-clean when every sample prices above $0', () => {
    const sum = runDraftAutoCheck(goodDraft);
    expect(sum.total).toBeGreaterThan(0);
    expect(sum.flaggedCount).toBe(0);
    expect(sum.clean).toBe(sum.total);
    expect(sum.samples.every((s) => s.ok && (s.total ?? 0) > 0)).toBe(true);
  });

  it('flags a service whose imported rate prices to $0 (missing numbers), never crashes', () => {
    // A rate card parsed with no usable numbers must be caught by the system,
    // not shipped as a silent $0 quote.
    const brokenDraft = {
      rateCards: [{ service: 'ftl', equipment: 'dryvan', ratePerMile: 0, minimumCharge: 0, flatFee: 0 }],
      accessorials: [],
      laneZones: [],
    };
    const sum = runDraftAutoCheck(brokenDraft);
    expect(sum.total).toBe(3); // short/med/long for the one service
    expect(sum.flaggedCount).toBe(3);
    expect(sum.clean).toBe(0);
    expect(sum.flagged[0].reason).toMatch(/\$0/);
  });

  it('endpoint returns the summary, tenant-scoped, without persisting', async () => {
    h.state.jobRows = [{ id: 8, tenantId: 1, status: 'ready_for_review', parsedJson: goodDraft }];
    const { registerIngestRoutes } = await import('./ingest.js');
    let handler: ((req: unknown, res: MockRes) => unknown) | undefined;
    const fakeApp = {
      get: (path: string, ...rest: unknown[]) => { if (path === '/api/tenant/ingest/:id/autocheck') handler = rest[rest.length - 1] as typeof handler; },
      post: () => {},
    } as unknown as import('express').Express;
    registerIngestRoutes(fakeApp);
    const res = new MockRes();
    await handler!({ params: { id: '8' }, tenant: { id: 1 }, user: { id: 1 } }, res);
    expect(res.statusCode).toBe(200);
    const b = res.body as { ok: boolean; total: number; flaggedCount: number };
    expect(b.ok).toBe(true);
    expect(b.total).toBeGreaterThan(0);
    expect(b.flaggedCount).toBe(0);
    expect(h.state.writes).toEqual([]);
  });
});
