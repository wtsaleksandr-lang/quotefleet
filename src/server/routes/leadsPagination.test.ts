/**
 * Leads list — server-side pagination + search + status filter.
 *
 * Three layers, matching the repo's route-test pattern (no live DB available):
 *  1. Pure unit tests of parseLeadsQuery() — the clamp/whitelist/offset contract.
 *  2. Handler integration against a capturing db() mock — asserts the response
 *     shape { leads, total, page, pageSize }, that `total` comes from a SEPARATE
 *     count() query (not the page slice), that page/pageSize flow into
 *     LIMIT/OFFSET, and that a page beyond the range returns [] not an error.
 *  3. A source-level guard locking the SQL-level filtering the mock can't run:
 *     tenant scope, ilike across the intended columns wrapped in or(), the
 *     status whitelist, and the stable createdAt+id ordering.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseLeadsQuery, LEAD_LIST_STATUSES } from './tenant.js';

// ── Capturing db() mock ──────────────────────────────────────────────────────
// select({...}) → count chain (where() resolves [{ total }]).
// select()      → rows chain  (orderBy→limit→offset resolves the page rows).
const h = vi.hoisted(() => ({
  state: {
    total: 0,
    rows: [] as Record<string, unknown>[],
    limitArg: undefined as number | undefined,
    offsetArg: undefined as number | undefined,
    selectCalls: 0,
    countSelects: 0,
  },
}));

vi.mock('../../db/client.js', () => {
  function countChain() {
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: () => Promise.resolve([{ total: h.state.total }]),
    };
    return chain;
  }
  function rowsChain() {
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: (n: number) => { h.state.limitArg = n; return chain; },
      offset: (n: number) => { h.state.offsetArg = n; return Promise.resolve(h.state.rows); },
    };
    return chain;
  }
  return {
    db: () => ({
      select: (arg?: unknown) => {
        h.state.selectCalls += 1;
        if (arg) { h.state.countSelects += 1; return countChain(); }
        return rowsChain();
      },
    }),
  };
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
    get: record('GET'), post: record('POST'), put: record('PUT'),
    patch: record('PATCH'), delete: record('DELETE'),
  } as unknown as import('express').Express;
  registerTenantRoutes(fakeApp);
  const handler = handlers['GET /api/tenant/leads'];
  if (!handler) throw new Error('leads list handler not registered');
  return handler;
}

function req(query: Record<string, unknown> = {}, tenantId = 1): MockReq {
  return { tenant: { id: tenantId }, query };
}

beforeEach(() => {
  h.state.total = 0; h.state.rows = [];
  h.state.limitArg = undefined; h.state.offsetArg = undefined;
  h.state.selectCalls = 0; h.state.countSelects = 0;
  process.env.SESSION_SECRET ||= 'test'.repeat(16);
  process.env.DATABASE_URL ||= 'postgresql://x';
  process.env.ANTHROPIC_API_KEY ||= 'sk-test';
  process.env.PUBLIC_BASE_URL ||= 'https://quotefleet.net';
});

// ── 1. parseLeadsQuery (pure) ────────────────────────────────────────────────
describe('parseLeadsQuery', () => {
  it('defaults page 1 / pageSize 25 / offset 0 with an empty query', () => {
    expect(parseLeadsQuery({})).toEqual({ page: 1, pageSize: 25, offset: 0, status: undefined, search: '' });
  });

  it('computes offset from page + pageSize', () => {
    expect(parseLeadsQuery({ page: '3', pageSize: '20' })).toMatchObject({ page: 3, pageSize: 20, offset: 40 });
  });

  it('caps pageSize at 100 and floors it at 1', () => {
    expect(parseLeadsQuery({ pageSize: '500' }).pageSize).toBe(100);
    expect(parseLeadsQuery({ pageSize: '0' }).pageSize).toBe(1);
    expect(parseLeadsQuery({ pageSize: '-9' }).pageSize).toBe(1);
  });

  it('floors page at 1 and tolerates garbage', () => {
    expect(parseLeadsQuery({ page: '0' }).page).toBe(1);
    expect(parseLeadsQuery({ page: '-4' }).page).toBe(1);
    expect(parseLeadsQuery({ page: 'abc' }).page).toBe(1);
  });

  it('keeps a whitelisted status and drops an unknown one', () => {
    expect(parseLeadsQuery({ status: 'won' }).status).toBe('won');
    expect(parseLeadsQuery({ status: 'booking_requested' }).status).toBe('booking_requested');
    expect(parseLeadsQuery({ status: 'bogus' }).status).toBeUndefined();
    expect(parseLeadsQuery({ status: '' }).status).toBeUndefined();
  });

  it('trims + length-caps the search term', () => {
    expect(parseLeadsQuery({ search: '  acme  ' }).search).toBe('acme');
    expect(parseLeadsQuery({ search: 'x'.repeat(500) }).search.length).toBe(120);
    expect(parseLeadsQuery({ search: 42 as unknown as string }).search).toBe('');
  });

  it('exposes exactly the UI lead statuses', () => {
    expect([...LEAD_LIST_STATUSES]).toEqual(['draft', 'new', 'replied', 'booking_requested', 'won', 'lost', 'spam']);
  });
});

// ── 2. Handler integration (capturing mock) ──────────────────────────────────
describe('GET /api/tenant/leads', () => {
  it('returns { leads, total, page, pageSize } with total from a separate count query', async () => {
    h.state.total = 137;
    h.state.rows = [{ refId: 'QF-1' }, { refId: 'QF-2' }];
    const res = new MockRes();
    await getHandler().then((fn) => fn(req({ page: '2', pageSize: '10' }), res));

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      leads: [{ refId: 'QF-1' }, { refId: 'QF-2' }],
      total: 137,
      page: 2,
      pageSize: 10,
    });
    // Page 2 @ 10/page → OFFSET 10, LIMIT 10.
    expect(h.state.limitArg).toBe(10);
    expect(h.state.offsetArg).toBe(10);
    // Exactly two queries: one count(*) + one page slice (no N+1, total != slice).
    expect(h.state.selectCalls).toBe(2);
    expect(h.state.countSelects).toBe(1);
  });

  it('caps pageSize into the LIMIT so a huge pageSize cannot dump the table', async () => {
    h.state.total = 5000;
    const res = new MockRes();
    await getHandler().then((fn) => fn(req({ pageSize: '9999' }), res));
    expect(h.state.limitArg).toBe(100);
    expect((res.body as { pageSize: number }).pageSize).toBe(100);
  });

  it('returns an empty page (not an error) beyond the last page', async () => {
    h.state.total = 40;         // ~2 pages @ 25
    h.state.rows = [];          // SQL yields nothing past the end
    const res = new MockRes();
    await getHandler().then((fn) => fn(req({ page: '999' }), res));

    expect(res.statusCode).toBe(200);
    expect((res.body as { leads: unknown[] }).leads).toEqual([]);
    expect((res.body as { total: number }).total).toBe(40); // count still accurate
    expect(h.state.offsetArg).toBe((999 - 1) * 25);
  });
});

// ── 3. Source-level guard (SQL filtering the mock can't execute) ─────────────
describe('leads list route wiring (source-level)', () => {
  it('is tenant-scoped, searches the intended columns, whitelists status, orders stably', async () => {
    const src = await readFile(resolve(process.cwd(), 'src/server/routes/tenant.ts'), 'utf8');
    expect(src).toContain("app.get('/api/tenant/leads', requireAuth, requireTenant");
    // Tenant scope on every query (no cross-tenant leak).
    expect(src).toContain('eq(leads.tenantId, req.tenant!.id)');
    // Case-insensitive search across ref, customer name/email/company, and lane.
    for (const col of ['refId', 'customerName', 'customerEmail', 'customerCompany', 'pickupCity', 'deliveryCity']) {
      expect(src).toContain(`ilike(leads.${col}, like)`);
    }
    expect(src).toContain('const match = or(');
    // Status filter goes through the whitelist parse, not raw query input.
    expect(src).toContain('if (status) filters.push(eq(leads.status, status))');
    // Separate count(*) for the accurate total; stable order + limit/offset paging.
    expect(src).toContain('.select({ total: count() })');
    expect(src).toContain('.orderBy(desc(leads.createdAt), desc(leads.id))');
    expect(src).toContain('.limit(pageSize)');
    expect(src).toContain('.offset(offset)');
  });
});
