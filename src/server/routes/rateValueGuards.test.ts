/**
 * Pricing-input guards — audit RATE-C1 / H4.
 *
 * The rate-card, accessorial, and lane-zone write routes validate money / rate
 * / percent / radius fields with zod. Before the guard fix those fields used a
 * bare `z.number()`, which accepts negative, non-finite (Infinity), and NaN
 * values — each of which is written verbatim and multiplied straight into the
 * customer quote total by src/calc/engine.ts. These tests drive the registered
 * handlers with mock req/res and assert that out-of-range pricing is REJECTED
 * with a 400, while a valid payload passes (200).
 *
 * The db + marketplace-sync modules are mocked so the valid-payload path
 * resolves without a real database; the invalid paths never reach the db (the
 * schema rejects before any query runs).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';

// Universal chainable + thenable db stub. Every method returns the same proxy;
// awaiting it resolves a single fake row so select().limit(), insert().returning(),
// and update().set().where() all behave for the happy path.
vi.mock('../../db/client.js', () => {
  const result: Array<Record<string, unknown>> = [{ id: 1 }];
  const proxy: unknown = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(result);
      return () => proxy;
    },
    apply() {
      return proxy;
    },
  });
  return { db: () => proxy };
});
// bumpMarketplace fires this fire-and-forget on every successful write.
vi.mock('../../marketplace/sync.js', () => ({
  syncTenantToMarketplace: () => Promise.resolve(),
}));

type Handler = (req: MockReq, res: MockRes) => unknown;
interface MockReq {
  tenant: { id: number };
  user: { id: number };
  params: Record<string, string>;
  body: unknown;
}
class MockRes {
  statusCode = 200;
  body: unknown = undefined;
  status(c: number) {
    this.statusCode = c;
    return this;
  }
  json(o: unknown) {
    this.body = o;
    return this;
  }
}

async function handlers(): Promise<Record<string, Handler>> {
  const { registerTenantRoutes } = await import('./tenant.js');
  const map: Record<string, Handler> = {};
  const record = (method: string) => (path: string, ...rest: unknown[]) => {
    map[`${method} ${path}`] = rest[rest.length - 1] as Handler;
  };
  const fakeApp = {
    get: record('GET'),
    post: record('POST'),
    put: record('PUT'),
    patch: record('PATCH'),
    delete: record('DELETE'),
  } as unknown as import('express').Express;
  registerTenantRoutes(fakeApp);
  return map;
}

function req(body: unknown, params: Record<string, string> = { id: '1' }): MockReq {
  return { tenant: { id: 1 }, user: { id: 1 }, params, body };
}

async function call(key: string, body: unknown): Promise<MockRes> {
  const map = await handlers();
  const handler = map[key];
  if (!handler) throw new Error(`handler not registered: ${key}`);
  const res = new MockRes();
  await handler(req(body), res);
  return res;
}

beforeEach(() => {
  process.env.SESSION_SECRET ||= 'test'.repeat(16);
  process.env.DATABASE_URL ||= 'postgresql://x';
  process.env.ANTHROPIC_API_KEY ||= 'sk-test';
  process.env.PUBLIC_BASE_URL ||= 'https://quotefleet.net';
});

const VALID_RATE_CARD = {
  service: 'FTL',
  equipment: 'Dry Van',
  ratePerMile: 2.5,
  minimumCharge: 350,
  flatFee: 0,
  fuelSurchargePct: 28,
  marginPct: 12,
};

describe('rate-card pricing guards (POST /api/tenant/rate-cards)', () => {
  const KEY = 'POST /api/tenant/rate-cards';

  it('accepts a valid rate card', async () => {
    const res = await call(KEY, VALID_RATE_CARD);
    expect(res.statusCode).toBe(200);
    expect((res.body as { ok: boolean }).ok).toBe(true);
  });

  it('rejects a negative ratePerMile', async () => {
    const res = await call(KEY, { ...VALID_RATE_CARD, ratePerMile: -5 });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a NaN ratePerMile', async () => {
    const res = await call(KEY, { ...VALID_RATE_CARD, ratePerMile: NaN });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a non-finite (Infinity) flatFee', async () => {
    const res = await call(KEY, { ...VALID_RATE_CARD, flatFee: Infinity });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a fuel surcharge over 100%', async () => {
    const res = await call(KEY, { ...VALID_RATE_CARD, fuelSurchargePct: 500 });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a negative marginPct', async () => {
    const res = await call(KEY, { ...VALID_RATE_CARD, marginPct: -1 });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an absurdly large minimumCharge', async () => {
    const res = await call(KEY, { ...VALID_RATE_CARD, minimumCharge: 5_000_000 });
    expect(res.statusCode).toBe(400);
  });
});

describe('rate-card pricing guards (PUT /api/tenant/rate-cards/:id)', () => {
  const KEY = 'PUT /api/tenant/rate-cards/:id';

  it('accepts a valid patch', async () => {
    const res = await call(KEY, { ratePerMile: 3.1 });
    expect(res.statusCode).toBe(200);
  });

  it('rejects a negative ratePerMile on update', async () => {
    const res = await call(KEY, { ratePerMile: -0.5 });
    expect(res.statusCode).toBe(400);
  });
});

describe('accessorial pricing guards', () => {
  it('accepts a valid flat accessorial (POST)', async () => {
    const res = await call('POST /api/tenant/accessorials', {
      code: 'LIFT',
      label: 'Liftgate',
      kind: 'flat',
      amount: 75,
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects a negative amount (PUT)', async () => {
    const res = await call('PUT /api/tenant/accessorials/:id', { amount: -10 });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a pct_of_base amount over 100 (PUT)', async () => {
    const res = await call('PUT /api/tenant/accessorials/:id', {
      kind: 'pct_of_base',
      amount: 150,
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepts a pct_of_base amount within 0–100 (PUT)', async () => {
    const res = await call('PUT /api/tenant/accessorials/:id', {
      kind: 'pct_of_base',
      amount: 15,
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('lane-zone pricing guards', () => {
  it('accepts a valid lane zone (POST)', async () => {
    const res = await call('POST /api/tenant/lane-zones', {
      label: 'Metro',
      radiusMiles: 50,
      flatPrice: 400,
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects a negative flatPrice (POST)', async () => {
    const res = await call('POST /api/tenant/lane-zones', {
      label: 'Metro',
      radiusMiles: 50,
      flatPrice: -400,
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a negative radiusMiles (PUT)', async () => {
    const res = await call('PUT /api/tenant/lane-zones/:id', { radiusMiles: -1 });
    expect(res.statusCode).toBe(400);
  });
});
