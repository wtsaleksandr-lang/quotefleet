/**
 * GET /api/tenant/carrier-search — the authed "Find your company" endpoint.
 *
 * A source-level guard locks the auth + rate-limit wiring in place, and a
 * functional test drives the captured handler with a mocked carrierLookup to
 * confirm it forwards q/dot/mc and returns the slim { results } shape.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ lookup: vi.fn(async () => [] as unknown[]) }));

// Stub the directory query so the handler is tested in isolation from the DB.
vi.mock('../directory/queries.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, carrierLookup: h.lookup };
});

type Handler = (req: MockReq, res: MockRes) => unknown;
interface MockReq {
  tenant: { id: number };
  query: Record<string, unknown>;
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
  const handler = handlers['GET /api/tenant/carrier-search'];
  if (!handler) throw new Error('carrier-search handler not registered');
  return handler;
}

beforeEach(() => {
  h.lookup.mockClear();
  process.env.SESSION_SECRET ||= 'test'.repeat(16);
  process.env.DATABASE_URL ||= 'postgresql://x';
});

describe('carrier-search route wiring (source-level)', () => {
  it('is guarded by requireAuth + requireTenant + the public autocomplete limiter', async () => {
    const src = await readFile(resolve(process.cwd(), 'src/server/routes/tenant.ts'), 'utf8');
    expect(src).toContain(
      "app.get('/api/tenant/carrier-search', requireAuth, requireTenant, publicAutocompleteLimiter",
    );
  });
});

describe('GET /api/tenant/carrier-search', () => {
  it('forwards q/dot/mc to carrierLookup and returns the slim results', async () => {
    const canned = [
      {
        usdot: '2841196',
        mcNumber: 'MC012892',
        legalName: 'HARBOR LINK DRAYAGE LLC',
        dbaName: null,
        phone: '5625551234',
        email: 'ops@harbor.example',
        city: 'LONG BEACH',
        state: 'CA',
        zip: '90802',
      },
    ];
    h.lookup.mockResolvedValueOnce(canned);
    const handler = await getHandler();
    const res = new MockRes();
    await handler({ tenant: { id: 1 }, query: { q: 'harbor', dot: '2841196', mc: '12892' } }, res);
    expect(h.lookup).toHaveBeenCalledWith({ q: 'harbor', dot: '2841196', mc: '12892' });
    expect(res.body).toEqual({ results: canned });
  });

  it('passes undefined for absent params', async () => {
    const handler = await getHandler();
    const res = new MockRes();
    await handler({ tenant: { id: 1 }, query: {} }, res);
    expect(h.lookup).toHaveBeenCalledWith({ q: undefined, dot: undefined, mc: undefined });
    expect(res.body).toEqual({ results: [] });
  });
});
