/**
 * Partner ROUTES — /partners renders, self-serve affiliate signup creates a row
 * and returns a link, and /partners/dashboard renders for a known code + gates
 * an unknown one. DB is mocked; this drives the real registerPartnersRoutes.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

process.env.DATABASE_URL ||= 'postgres://test:test@localhost:5432/test';
process.env.SESSION_SECRET ||= 'x'.repeat(64);
process.env.HOST_DOMAINS ||= 'quotefleet.net';
process.env.PUBLIC_BASE_URL ||= 'http://localhost:5000';

// ── DB mock ─────────────────────────────────────────────────────────────────
const selectQueue: unknown[][] = [];
const inserts: Array<{ payload: any }> = [];
function selectChain() {
  const rows = selectQueue.length ? selectQueue.shift()! : [];
  const p: any = {
    from: () => p,
    where: () => p,
    orderBy: () => p,
    limit: () => p,
    groupBy: () => p,
    then: (res: (v: unknown) => void) => Promise.resolve(rows).then(res),
  };
  return p;
}
function insertChain() {
  const p: any = {
    values: (obj: any) => {
      inserts.push({ payload: obj });
      return {
        returning: () => Promise.resolve([{ id: 1, code: obj.code }]),
        then: (res: (v: unknown) => void) => Promise.resolve([{ id: 1 }]).then(res),
      };
    },
  };
  return p;
}
const dbStub: any = {
  select: () => selectChain(),
  insert: () => insertChain(),
  update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
};
vi.mock('../../db/client.js', () => ({ db: () => dbStub }));

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const { registerPartnersRoutes } = await import('./partners.js');
  const app = express();
  app.use(express.json());
  registerPartnersRoutes(app);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(() => {
  selectQueue.length = 0;
  inserts.length = 0;
});

describe('GET /partners', () => {
  it('renders the landing page with both programs', async () => {
    const res = await fetch(`${baseUrl}/partners`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('Affiliate program');
    expect(html).toContain('Referral program');
    expect(html).toContain('premium-footer');
  });

  it('renders the terms page', async () => {
    const res = await fetch(`${baseUrl}/partners/terms`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('Prohibited methods');
  });
});

describe('POST /api/partners/signup', () => {
  it('creates an affiliate and returns a code + link', async () => {
    // existing-by-email [], owner-tenant [], mintUniqueCode codeExists ([],[])
    selectQueue.push([], [], [], []);
    const res = await fetch(`${baseUrl}/api/partners/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'creator@example.com', name: 'Creator' }),
    });
    const j = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(j.ok).toBe(true);
    expect(typeof j.code).toBe('string');
    expect(j.link).toBe(`https://quotefleet.net/?ref=${encodeURIComponent(j.code)}`);
    // The affiliate row was inserted active at the base rate.
    expect(inserts.length).toBe(1);
    expect(inserts[0].payload.email).toBe('creator@example.com');
    expect(inserts[0].payload.status).toBe('active');
    expect(inserts[0].payload.commissionRate).toBe(0.25);
  });

  it('is idempotent — returns the existing code for a known email', async () => {
    selectQueue.push([{ id: 9, email: 'creator@example.com', code: 'EXIST234' }]);
    const res = await fetch(`${baseUrl}/api/partners/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'creator@example.com' }),
    });
    const j = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(j.existing).toBe(true);
    expect(j.code).toBe('EXIST234');
    expect(inserts.length).toBe(0); // no new row
  });

  it('rejects an invalid email', async () => {
    const res = await fetch(`${baseUrl}/api/partners/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /partners/dashboard', () => {
  it('renders the dashboard for a known code', async () => {
    // getAffiliateByCode → row; then clicks/signups/converted/commissions.
    selectQueue.push([
      { id: 1, email: 'c@x.com', name: 'C', code: 'ABCD2345', tier: 'base', status: 'active', commissionRate: 0.25, payoutMethod: null, ownerTenantId: null },
    ]);
    selectQueue.push([{ n: 42 }], [{ n: 5 }], [{ n: 2 }], []);
    const res = await fetch(`${baseUrl}/partners/dashboard?code=ABCD2345`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('ABCD2345');
    expect(html).toContain('Link clicks');
    expect(html).toContain('42');
  });

  it('gates when no code is supplied', async () => {
    const res = await fetch(`${baseUrl}/partners/dashboard`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('affiliate code');
  });

  it('404s an unknown code', async () => {
    selectQueue.push([]); // getAffiliateByCode → none
    const res = await fetch(`${baseUrl}/partners/dashboard?code=NOPE2345`);
    expect(res.status).toBe(404);
  });
});
