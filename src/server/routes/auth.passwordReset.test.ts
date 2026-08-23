/**
 * Forgot-password flow tests — POST /api/auth/password/forgot (issue a reset
 * link) + POST /api/auth/password/reset (consume it).
 *
 * Covers the security contract of the feature that closes the "magic-link login
 * but can't set a password" dead-end:
 *   - token issue+consume happy path
 *   - the stored token is HASHED at rest (never the raw emailed token)
 *   - expired token rejected
 *   - used token rejected
 *   - invalid/unknown token rejected
 *   - no user-enumeration: identical response for unknown vs known email
 *   - the new-password strength rule (min 10) is enforced
 *   - the per-email request rate limiter trips
 *
 * DB, email and sessions are stubbed (per vitest.config: DB/config-touching
 * tests use mocks) — this exercises the real route logic without infra.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

process.env.DATABASE_URL ||= 'postgres://test:test@localhost:5432/test';
process.env.SESSION_SECRET ||= 'x'.repeat(64);
process.env.HOST_DOMAINS ||= 'quotefleet.net';
process.env.PUBLIC_BASE_URL ||= 'http://localhost:5000';

/** A thenable, chainable Drizzle query-builder stub (see auth.signup.test.ts). */
function chain(getRows: () => unknown[]): any {
  const proxy: any = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
          Promise.resolve(getRows()).then(resolve, reject);
      }
      return () => proxy;
    },
    apply() {
      return proxy;
    },
  });
  return proxy;
}

/** FIFO queue of results for successive `db().select()` calls; each test seeds it. */
let selectResults: unknown[][] = [];
/** Captured `.values(...)` payloads from every `db().insert()` in the run. */
let insertedRows: any[] = [];

/** Insert chain that records the row(s) passed to `.values()` so a test can
 *  assert what was persisted (e.g. that the token is stored hashed). */
function recordingInsertChain(): any {
  const proxy: any = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
          Promise.resolve([{ id: 1 }]).then(resolve, reject);
      }
      if (prop === 'values') {
        return (v: unknown) => {
          insertedRows.push(v);
          return proxy;
        };
      }
      return () => proxy;
    },
    apply() {
      return proxy;
    },
  });
  return proxy;
}

const dbStub: any = {
  select: () => chain(() => (selectResults.length ? selectResults.shift()! : [])),
  update: () => chain(() => []),
  insert: () => recordingInsertChain(),
  delete: () => chain(() => []),
};
vi.mock('../../db/client.js', () => ({ db: () => dbStub }));

/** Capture every outbound email so a test can read the reset link/token. */
const sentEmails: Array<{ to: string; subject: string; text: string; html?: string }> = [];
vi.mock('../../email/send.js', () => ({
  sendEmail: vi.fn(async (msg: any) => {
    sentEmails.push(msg);
    return { ok: true, provider: 'resend', id: 'test' };
  }),
  brandedFrom: (n: string) => `${n} <hello@quotefleet.net>`,
}));

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** Pull the raw reset token out of the most recently "sent" email. */
function lastEmailedToken(): string {
  const last = sentEmails[sentEmails.length - 1];
  expect(last, 'expected a reset email to have been sent').toBeTruthy();
  const m = /reset-password\?token=([A-Za-z0-9_-]+)/.exec(last.text) ||
    /reset-password\?token=([A-Za-z0-9_-]+)/.exec(last.html ?? '');
  expect(m, 'expected a reset link with a token in the email').toBeTruthy();
  return m![1];
}

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const { registerAuthRoutes } = await import('./auth.js');
  const app = express();
  app.use(express.json());
  registerAuthRoutes(app);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  selectResults = [];
  insertedRows = [];
  sentEmails.length = 0;
});

async function postForgot(email: string) {
  const res = await fetch(`${baseUrl}/api/auth/password/forgot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}

async function postReset(body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}/api/auth/password/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}

const future = () => new Date(Date.now() + 30 * 60 * 1000);
const past = () => new Date(Date.now() - 60 * 1000);

describe('POST /api/auth/password/forgot', () => {
  it('issues a reset link for a known email and stores the token HASHED, never raw', async () => {
    selectResults = [[{ id: 42, email: 'owner-known@carrier.test' }]]; // users lookup hits
    const { status, json } = await postForgot('owner-known@carrier.test');
    expect(status).toBe(200);
    expect(json.ok).toBe(true);

    const token = lastEmailedToken();
    // A password_reset_tokens row was inserted, and it holds the SHA-256 hash of
    // the emailed token — not the raw token itself.
    const row = insertedRows.find((r) => r && typeof r.tokenHash === 'string');
    expect(row, 'expected a password_reset_tokens insert').toBeTruthy();
    expect(row.tokenHash).toBe(sha256(token));
    expect(row.tokenHash).not.toBe(token);
    expect(row.userId).toBe(42);
    expect(row.expiresAt instanceof Date).toBe(true);
  });

  it('does NOT enumerate accounts: identical response + no email for an unknown address', async () => {
    selectResults = [[]]; // users lookup misses
    const { status, json } = await postForgot('nobody@carrier.test');
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    // Same generic message as the known-email path — indistinguishable.
    expect(json.message).toMatch(/if that email has an account/i);
    // Crucially: no email was sent and no token was minted for an unknown user.
    expect(sentEmails.length).toBe(0);
    expect(insertedRows.length).toBe(0);
  });

  it('returns the SAME body for known and unknown emails', async () => {
    selectResults = [[{ id: 7, email: 'known2@carrier.test' }]];
    const known = await postForgot('known2@carrier.test');
    selectResults = [[]];
    const unknown = await postForgot('unknown2@carrier.test');
    expect(known.status).toBe(unknown.status);
    expect(known.json).toEqual(unknown.json);
  });
});

describe('POST /api/auth/password/reset', () => {
  it('happy path: a valid token sets the new password (200 ok)', async () => {
    // First request a link so we have a real token+hash pair.
    selectResults = [[{ id: 42, email: 'reset-ok@carrier.test' }]];
    await postForgot('reset-ok@carrier.test');
    const token = lastEmailedToken();

    // The reset lookup finds the matching, unused, unexpired row.
    selectResults = [[{ tokenHash: sha256(token), userId: 42, usedAt: null, expiresAt: future() }]];
    const { status, json } = await postReset({ token, password: 'a-brand-new-password' });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
  });

  it('rejects an EXPIRED token', async () => {
    const token = 'expired-token-value';
    selectResults = [[{ tokenHash: sha256(token), userId: 1, usedAt: null, expiresAt: past() }]];
    const { status, json } = await postReset({ token, password: 'a-brand-new-password' });
    expect(status).toBe(400);
    expect(json.error).toMatch(/invalid or has expired/i);
  });

  it('rejects an already-USED token', async () => {
    const token = 'used-token-value';
    selectResults = [
      [{ tokenHash: sha256(token), userId: 1, usedAt: new Date(), expiresAt: future() }],
    ];
    const { status } = await postReset({ token, password: 'a-brand-new-password' });
    expect(status).toBe(400);
  });

  it('rejects an INVALID / unknown token', async () => {
    selectResults = [[]]; // no matching row
    const { status } = await postReset({ token: 'never-issued', password: 'a-brand-new-password' });
    expect(status).toBe(400);
  });

  it('enforces the new-password strength rule (min 10 chars)', async () => {
    const token = 'strength-token';
    // Lookup would succeed, but the weak password is rejected by the schema
    // BEFORE any token work — so seeding the row is not even required.
    selectResults = [[{ tokenHash: sha256(token), userId: 1, usedAt: null, expiresAt: future() }]];
    const { status, json } = await postReset({ token, password: 'short' });
    expect(status).toBe(400);
    expect(json.error).toMatch(/at least 10/i);
  });
});

describe('rate limiting', () => {
  it('trips the per-email request limiter after repeated requests', async () => {
    const email = 'ratelimit-victim@carrier.test';
    let sawLimited = false;
    // Limit is 5/hour per email; the 6th within the window must 429.
    for (let i = 0; i < 7; i++) {
      selectResults = [[]]; // unknown email each time (no side effects)
      const { status } = await postForgot(email);
      if (status === 429) {
        sawLimited = true;
        break;
      }
    }
    expect(sawLimited).toBe(true);
  });
});
