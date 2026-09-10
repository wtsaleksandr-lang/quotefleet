/**
 * HTTP layer for profile claims (routes/claim.ts) with the in-memory ClaimStore
 * injected and the auth/db/email seams mocked:
 *   - POST /api/claim/:usdot/start — anonymous NEW email provisions a FREE
 *     FOREVER tenant (trialEndsAt null, isDirectoryOwner, signupSource 'claim'),
 *     sets the session cookie, sends the code to the census email;
 *   - an EXISTING email is never signed in blind → magic link back to /claim/:slug;
 *   - a signed-in carrier account claims as itself; a shipper account is refused;
 *   - already-claimed → 409; unknown USDOT → 404;
 *   - POST /api/claim/:usdot/verify — right code 200, wrong 400, locked 423, expired 410;
 *   - POST /api/tenant/trial/activate — 200 + 30-day end for an owner, 409 otherwise.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { memoryCarrier, memoryClaimStore, type MemoryClaimStore } from '../../test/claimsMemoryStore.js';
import { CLAIM_OTP_MAX_ATTEMPTS, CLAIM_OTP_TTL_MS } from '../directory/claims.js';

process.env.DATABASE_URL ||= 'postgres://test:test@localhost:5432/test';
process.env.SESSION_SECRET ||= 'x'.repeat(64);
process.env.HOST_DOMAINS ||= 'quotefleet.net';
process.env.PUBLIC_BASE_URL ||= 'http://localhost:5000';

const h = vi.hoisted(() => ({
  state: {
    /** users.email lookup result for the anonymous-start path. */
    existingUser: null as null | { id: number; email: string; tenantId: number | null },
    /** lookupSession result (the signed-in viewer). */
    session: null as null | { id: number; email: string; tenantId: number | null; role: string },
    /** requireTenant's tenant row. */
    tenantRow: null as null | Record<string, unknown>,
    magicLinks: [] as Record<string, unknown>[],
    provisioned: [] as Record<string, unknown>[],
    emails: [] as Array<{ to: string; subject: string }>,
  },
}));

vi.mock('../../db/client.js', async () => {
  const { getTableName } = await import('drizzle-orm');
  function select() {
    let table: unknown;
    const chain: Record<string, unknown> = {
      from(t: unknown) { table = t; return chain; },
      where() { return chain; },
      limit() {
        const name = getTableName(table as never);
        if (name === 'users') return Promise.resolve(h.state.existingUser ? [h.state.existingUser] : []);
        if (name === 'tenants') return Promise.resolve(h.state.tenantRow ? [h.state.tenantRow] : []);
        return Promise.resolve([]);
      },
    };
    return chain;
  }
  function insert(t: unknown) {
    return {
      values(v: Record<string, unknown>) {
        if (getTableName(t as never) === 'magic_links') h.state.magicLinks.push(v);
        return Promise.resolve();
      },
    };
  }
  return { db: () => ({ select, insert }) };
});

vi.mock('../../auth/session.js', () => ({
  SESSION_COOKIE_NAME: 'qf_sess',
  createSession: vi.fn(async (userId: number) => `sess-${userId}`),
  lookupSession: vi.fn(async (token: string | undefined) =>
    token && h.state.session ? { user: h.state.session, token } : null,
  ),
}));
vi.mock('../../auth/password.js', () => ({
  hashPassword: vi.fn(async () => 'hashed-pw'),
  verifyPassword: vi.fn(async () => true),
}));
vi.mock('../../email/send.js', () => ({
  sendEmail: vi.fn(async (m: { to: string; subject: string }) => {
    h.state.emails.push({ to: m.to, subject: m.subject });
    return { ok: true, logged: false, provider: 'resend' };
  }),
}));
vi.mock('./tenantProvision.js', () => ({
  deriveAvailableSlug: vi.fn(async (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-')),
  provisionTrialTenant: vi.fn(async (input: Record<string, unknown>) => {
    h.state.provisioned.push(input);
    return { tenantId: 42, userId: 7, slug: 'acme', hostDomain: 'quotefleet.net', embedToken: 'e', trialEndsAt: null };
  }),
}));
// Rate limiters are pass-through so the tests can hit the routes repeatedly.
vi.mock('../rateLimits.js', () => {
  const pass = (_req: unknown, _res: unknown, next: () => void) => next();
  return { signupLimiter: pass, publicAutocompleteLimiter: pass };
});

let server: Server;
let baseUrl: string;
let store: MemoryClaimStore;

beforeAll(async () => {
  const { registerClaimRoutes } = await import('./claim.js');
  store = memoryClaimStore();
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  registerClaimRoutes(app, store);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  store.carriers.length = 0;
  store.claims.length = 0;
  store.sentCodes.length = 0;
  store.publicEmails.length = 0;
  store.claimedMarks.length = 0;
  store.tenants.clear();
  store.users.clear();
  store.carriers.push(memoryCarrier());
  store.users.set(7, { id: 7, email: 'owner@acme.com', verified: false });
  store.tenants.set(42, { isDirectoryOwner: false, trialEndsAt: null, dotNumber: null, mcNumber: null });
  h.state.existingUser = null;
  h.state.session = null;
  h.state.tenantRow = null;
  h.state.magicLinks = [];
  h.state.provisioned = [];
  h.state.emails = [];
});

async function post(path: string, body: unknown, cookie?: string) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body ?? {}),
  });
  return { status: res.status, setCookie: res.headers.get('set-cookie'), json: (await res.json()) as any };
}

const SIGNED_IN = 'qf_sess=sess-7';

describe('POST /api/claim/:usdot/start — anonymous', () => {
  it('a NEW email provisions a FREE FOREVER tenant, logs in, and emails the code to the census address', async () => {
    const r = await post('/api/claim/107080/start', { email: 'Owner@Acme.com', password: 'a-strong-password' });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, kind: 'otp_sent', method: 'email_otp', maskedEmail: 'd***@acme.com' });
    expect(r.setCookie).toContain('qf_sess=sess-7');
    expect(h.state.provisioned).toHaveLength(1);
    expect(h.state.provisioned[0]).toMatchObject({
      companyName: 'ACME DRAYAGE INC',
      email: 'owner@acme.com',
      trialEndsAt: null,
      isDirectoryOwner: true,
      signupSource: 'claim',
    });
    expect(store.sentCodes[0].to).toBe('dispatch@acme.com');
    expect(store.claims[0]).toMatchObject({ tenantId: 42, userId: 7, method: 'email_otp', status: 'pending' });
  });

  it('a password-less claimant still gets an account (unusable hash) and the code', async () => {
    const r = await post('/api/claim/107080/start', { email: 'owner@acme.com' });
    expect(r.status).toBe(200);
    expect(r.json.kind).toBe('otp_sent');
    expect(h.state.provisioned).toHaveLength(1);
  });

  it('an EXISTING email is never signed in blind: magic link back to the claim page, no tenant created', async () => {
    h.state.existingUser = { id: 3, email: 'owner@acme.com', tenantId: 9 };
    const r = await post('/api/claim/107080/start', { email: 'owner@acme.com' });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, kind: 'magic_link', email: 'owner@acme.com' });
    expect(r.setCookie).toBeNull();
    expect(h.state.provisioned).toHaveLength(0);
    expect(h.state.magicLinks).toHaveLength(1);
    expect(h.state.magicLinks[0]).toMatchObject({ userId: 3, redirectTo: '/claim/acme-drayage-inc-107080' });
    expect(h.state.emails[0]).toMatchObject({ to: 'owner@acme.com', subject: 'Your QuoteFleet sign-in link' });
    expect(store.claims).toHaveLength(0);
  });

  it('a claim on an already-claimed profile → 409 and nothing is created', async () => {
    store.carriers[0].claimedTenantId = 99;
    const r = await post('/api/claim/107080/start', { email: 'owner@acme.com' });
    expect(r.status).toBe(409);
    expect(r.json.kind).toBe('already_claimed');
    expect(h.state.provisioned).toHaveLength(0);
  });

  it('unknown USDOT → 404; missing email → 400; bad password → 400', async () => {
    expect((await post('/api/claim/1/start', { email: 'owner@acme.com' })).status).toBe(404);
    expect((await post('/api/claim/107080/start', {})).status).toBe(400);
    expect((await post('/api/claim/107080/start', { email: 'owner@acme.com', password: 'short' })).status).toBe(400);
  });

  it('a record with no census email → needs_manual (account still created, no email sent)', async () => {
    store.carriers[0].email = null;
    const r = await post('/api/claim/107080/start', { email: 'owner@acme.com' });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ kind: 'needs_manual', method: 'manual', needs_manual: true });
    expect(store.sentCodes).toHaveLength(0);
    expect(store.claims[0].method).toBe('manual');
  });
});

describe('POST /api/claim/:usdot/start — signed in', () => {
  it('a carrier account claims as itself (no provisioning); a verified same-domain email is verified at once', async () => {
    h.state.session = { id: 7, email: 'owner@acme.com', tenantId: 42, role: 'tenant_owner' };
    store.users.set(7, { id: 7, email: 'owner@acme.com', verified: true });
    const r = await post('/api/claim/107080/start', {}, SIGNED_IN);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, kind: 'verified', method: 'domain_match', profileUrl: '/directory/carrier/acme-drayage-inc-107080' });
    expect(h.state.provisioned).toHaveLength(0);
    expect(store.carriers[0].claimedTenantId).toBe(42);
    expect(store.tenants.get(42)!.isDirectoryOwner).toBe(true);
  });

  it('a shipper (tenant-less) account is refused with no_tenant', async () => {
    h.state.session = { id: 5, email: 'buyer@shipper.com', tenantId: null, role: 'shipper' };
    const r = await post('/api/claim/107080/start', {}, SIGNED_IN);
    expect(r.status).toBe(409);
    expect(r.json.kind).toBe('no_tenant');
  });
});

describe('POST /api/claim/:usdot/verify', () => {
  beforeEach(() => {
    h.state.session = { id: 7, email: 'owner@acme.com', tenantId: 42, role: 'tenant_owner' };
  });

  it('requires a session', async () => {
    expect((await post('/api/claim/107080/verify', { code: '123456' })).status).toBe(401);
  });

  it('the right code → 200 verified; a malformed code → 400', async () => {
    await post('/api/claim/107080/start', {}, SIGNED_IN);
    expect((await post('/api/claim/107080/verify', { code: '12' }, SIGNED_IN)).status).toBe(400);
    const r = await post('/api/claim/107080/verify', { code: store.sentCodes[0].code }, SIGNED_IN);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, kind: 'verified', profileUrl: '/directory/carrier/acme-drayage-inc-107080' });
    expect(store.publicEmails[0]).toMatchObject({ usdot: '107080', email: 'owner@acme.com' });
  });

  it(`wrong code → 400 with attemptsLeft; the ${CLAIM_OTP_MAX_ATTEMPTS}th → 423 locked`, async () => {
    await post('/api/claim/107080/start', {}, SIGNED_IN);
    const wrong = store.sentCodes[0].code === '000000' ? '000001' : '000000';
    for (let i = 1; i < CLAIM_OTP_MAX_ATTEMPTS; i++) {
      const r = await post('/api/claim/107080/verify', { code: wrong }, SIGNED_IN);
      expect(r.status).toBe(400);
      expect(r.json).toEqual({ kind: 'wrong_code', attemptsLeft: CLAIM_OTP_MAX_ATTEMPTS - i });
    }
    expect((await post('/api/claim/107080/verify', { code: wrong }, SIGNED_IN)).status).toBe(423);
  });

  it('an expired code → 410', async () => {
    await post('/api/claim/107080/start', {}, SIGNED_IN);
    store.claims[0].otpExpiresAt = new Date(Date.now() - CLAIM_OTP_TTL_MS);
    expect((await post('/api/claim/107080/verify', { code: store.sentCodes[0].code }, SIGNED_IN)).status).toBe(410);
  });

  it('no pending code → 404; claimed meanwhile → 409', async () => {
    expect((await post('/api/claim/107080/verify', { code: '123456' }, SIGNED_IN)).status).toBe(404);
    store.carriers[0].claimedTenantId = 99;
    expect((await post('/api/claim/107080/verify', { code: '123456' }, SIGNED_IN)).status).toBe(409);
  });
});

describe('POST /api/tenant/trial/activate — the 30-days-free upsell', () => {
  beforeEach(() => {
    h.state.session = { id: 7, email: 'owner@acme.com', tenantId: 42, role: 'tenant_owner' };
    h.state.tenantRow = { id: 42, plan: 'free', status: 'active', trialEndsAt: null };
  });

  it('a verified owner with no trial gets a 30-day trial end', async () => {
    store.tenants.set(42, { isDirectoryOwner: true, trialEndsAt: null, dotNumber: null, mcNumber: null });
    const before = Date.now();
    const r = await post('/api/tenant/trial/activate', {}, SIGNED_IN);
    expect(r.status).toBe(200);
    const end = new Date(r.json.trialEndsAt).getTime();
    expect(end - before).toBeGreaterThanOrEqual(30 * 24 * 60 * 60 * 1000 - 5_000);
    expect(end - before).toBeLessThanOrEqual(30 * 24 * 60 * 60 * 1000 + 5_000);
  });

  it('a regular tenant (not a directory owner) → 409 not_eligible; anonymous → 401', async () => {
    const r = await post('/api/tenant/trial/activate', {}, SIGNED_IN);
    expect(r.status).toBe(409);
    expect(r.json.error).toBe('not_eligible');
    expect((await post('/api/tenant/trial/activate', {})).status).toBe(401);
  });
});
