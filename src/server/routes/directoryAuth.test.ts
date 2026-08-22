/**
 * Directory Pro shipper signup — POST /api/directory/auth/signup.
 *
 * Asserts:
 *   • A NEW email creates a SHIPPER: a `users` row with tenantId=null,
 *     role='shipper', and NO entitlement (no directory_subscriptions write),
 *     and logs them in (sets the qf_sess cookie).
 *   • An EXISTING email does NOT error (no 409): it issues a magic link so the
 *     user logs into their existing account. No session cookie is minted (no
 *     account takeover).
 *
 * db + session + email + password are mocked so no live infrastructure is used.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

process.env.DATABASE_URL ||= 'postgres://test:test@localhost:5432/test';
process.env.SESSION_SECRET ||= 'x'.repeat(64);
process.env.HOST_DOMAINS ||= 'quotefleet.net';
process.env.PUBLIC_BASE_URL ||= 'http://localhost:5000';

const state = vi.hoisted(() => ({
  userRow: null as Record<string, unknown> | null, // the existing-email lookup result
  inserts: [] as { table: string; vals: Record<string, unknown> }[],
  newUserId: 77,
}));

// Distinguish tables by a marker the schema objects don't carry, so we tag them
// via the drizzle table's Symbol name. Simpler: inspect a known column presence.
vi.mock('../../db/client.js', () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(state.userRow ? [state.userRow] : []),
        }),
      }),
    }),
    // The route inserts into `users` (new signup) or `magic_links` (existing
    // email). We can't read the drizzle table identity cheaply here, so tag by
    // the values shape: rows carrying `passwordHash` are users; rows carrying
    // `token` are magic links.
    insert: () => ({
      values: (vals: Record<string, unknown>) => {
        const table = 'passwordHash' in vals ? 'users' : 'token' in vals ? 'magic_links' : 'other';
        state.inserts.push({ table, vals });
        const p: any = Promise.resolve([{ id: state.newUserId }]);
        p.returning = () => Promise.resolve([{ id: state.newUserId }]);
        return p;
      },
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  }),
}));

const createSession = vi.fn(async () => 'sess-token-abc');
vi.mock('../../auth/session.js', () => ({
  SESSION_COOKIE_NAME: 'qf_sess',
  createSession,
  lookupSession: vi.fn(async () => null),
}));

vi.mock('../../auth/password.js', () => ({
  hashPassword: vi.fn(async () => 'hashed-pw'),
  verifyPassword: vi.fn(async () => true),
}));

const sendEmail = vi.fn(async () => ({ ok: true, logged: false }));
vi.mock('../../email/send.js', () => ({ sendEmail }));

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const { registerDirectoryAuthRoutes } = await import('./directoryAuth.js');
  const app = express();
  app.use(express.json());
  registerDirectoryAuthRoutes(app);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  state.userRow = null;
  state.inserts = [];
  createSession.mockClear();
  sendEmail.mockClear();
});

async function postSignup(body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}/api/directory/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, setCookie: res.headers.get('set-cookie'), json: (await res.json()) as any };
}

describe('POST /api/directory/auth/signup — new shipper', () => {
  it('creates a tenant-less shipper, no entitlement, and logs them in', async () => {
    state.userRow = null; // email is free
    const { status, json, setCookie: cookie } = await postSignup({
      email: 'new-shipper@acme.com',
      password: 'a-strong-password',
    });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.existing).toBe(false);
    expect(json.user).toMatchObject({ id: 77, email: 'new-shipper@acme.com' });

    // A users row was inserted: tenantId null + role shipper.
    const userInsert = state.inserts.find((i) => i.table === 'users');
    expect(userInsert).toBeTruthy();
    expect(userInsert!.vals.tenantId).toBeNull();
    expect(userInsert!.vals.role).toBe('shipper');

    // Entitlement-less: NO directory_subscriptions write at signup.
    expect(state.inserts.some((i) => 'status' in i.vals && 'stripeCustomerId' in i.vals)).toBe(false);

    // Logged in: session created + qf_sess cookie set.
    expect(createSession).toHaveBeenCalledWith(77);
    expect(cookie).toContain('qf_sess=');
  });

  it('supports passwordless signup (still creates the shipper + session)', async () => {
    state.userRow = null;
    const { status, json } = await postSignup({ email: 'passwordless@acme.com' });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(state.inserts.some((i) => i.table === 'users')).toBe(true);
    expect(createSession).toHaveBeenCalled();
  });
});

describe('POST /api/directory/auth/signup — existing email', () => {
  it('does NOT error; issues a magic link and mints no session', async () => {
    state.userRow = { id: 9, email: 'carrier-owner@acme.com', role: 'tenant_owner' };
    const { status, json, setCookie: cookie } = await postSignup({
      email: 'carrier-owner@acme.com',
      password: 'a-strong-password',
    });
    // Not a 409 — the whole point.
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.existing).toBe(true);
    expect(json.login).toBe('magic_link');

    // A magic link was created + emailed; no user row created; no session.
    expect(state.inserts.some((i) => i.table === 'magic_links')).toBe(true);
    expect(state.inserts.some((i) => i.table === 'users')).toBe(false);
    expect(sendEmail).toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
    expect(cookie ?? '').not.toContain('qf_sess=');
  });
});
