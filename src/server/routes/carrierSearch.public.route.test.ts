/**
 * GET /api/public/carrier-search — the PUBLIC "Find your company" hero endpoint.
 *
 * A source-level guard locks the rate-limit wiring in place, and a functional
 * test drives the captured handler with a mocked carrierLookup to confirm it
 * (a) forwards q/dot/mc, (b) returns the SLIM public projection, and (c) NEVER
 * exposes email while keeping phone (already nulled by carrierLookup for a
 * hidden carrier).
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
  const { registerPublicRoutes } = await import('./public.js');
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
    use: () => {},
  } as unknown as import('express').Express;
  registerPublicRoutes(fakeApp);
  const handler = handlers['GET /api/public/carrier-search'];
  if (!handler) throw new Error('public carrier-search handler not registered');
  return handler;
}

beforeEach(() => {
  h.lookup.mockClear();
  process.env.SESSION_SECRET ||= 'test'.repeat(16);
  process.env.DATABASE_URL ||= 'postgresql://x';
});

describe('public carrier-search route wiring (source-level)', () => {
  it('is guarded by the public autocomplete limiter', async () => {
    const src = await readFile(resolve(process.cwd(), 'src/server/routes/public.ts'), 'utf8');
    expect(src).toContain(
      "app.get('/api/public/carrier-search', publicAutocompleteLimiter",
    );
  });
});

describe('GET /api/public/carrier-search', () => {
  it('forwards q/dot/mc and returns the SLIM public projection (no email, phone kept)', async () => {
    h.lookup.mockResolvedValueOnce([
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
    ]);
    const handler = await getHandler();
    const res = new MockRes();
    await handler({ query: { q: 'harbor', dot: '2841196', mc: '12892' } }, res);
    expect(h.lookup).toHaveBeenCalledWith({ q: 'harbor', dot: '2841196', mc: '12892' });
    expect(res.body).toEqual({
      results: [
        {
          legalName: 'HARBOR LINK DRAYAGE LLC',
          dbaName: null,
          usdot: '2841196',
          mcNumber: 'MC012892',
          city: 'LONG BEACH',
          state: 'CA',
          phone: '5625551234',
        },
      ],
    });
    // The public projection must NEVER leak email or the internal zip.
    const row = (res.body as { results: Record<string, unknown>[] }).results[0];
    expect(row).not.toHaveProperty('email');
    expect(row).not.toHaveProperty('zip');
  });

  it('propagates a hidden carrier as phone=null (carrierLookup nulls it)', async () => {
    h.lookup.mockResolvedValueOnce([
      {
        usdot: '999',
        mcNumber: null,
        legalName: 'PRIVATE CARRIER INC',
        dbaName: null,
        phone: null,
        email: null,
        city: 'DALLAS',
        state: 'TX',
        zip: '75201',
      },
    ]);
    const handler = await getHandler();
    const res = new MockRes();
    await handler({ query: { q: 'private' }, }, res);
    const row = (res.body as { results: Record<string, unknown>[] }).results[0];
    expect(row.phone).toBeNull();
    expect(row).not.toHaveProperty('email');
  });

  it('never 500s — degrades to empty results when the lookup throws', async () => {
    h.lookup.mockRejectedValueOnce(new Error('db down'));
    const handler = await getHandler();
    const res = new MockRes();
    await handler({ query: { q: 'harbor' } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ results: [] });
  });

  it('passes undefined for absent params', async () => {
    const handler = await getHandler();
    const res = new MockRes();
    await handler({ query: {} }, res);
    expect(h.lookup).toHaveBeenCalledWith({ q: undefined, dot: undefined, mc: undefined });
    expect(res.body).toEqual({ results: [] });
  });
});
