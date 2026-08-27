/**
 * Manifest Privacy customer account portal — the logged-in surface a paying
 * privacy customer previously lacked (only had the emailed token URL).
 *
 * Asserts:
 *   • GET /api/privacy/me is SOFT: anonymous → { user: null }, never a 401.
 *   • GET /api/privacy/me (authed) returns the subscription identity + every
 *     POA application the user owns.
 *   • Account-LINKING: hitting the account claims ownerless applications whose
 *     signer_email matches the account email (user_id IS NULL → user_id set).
 *   • GET /privacy/account unauthenticated REDIRECTS to /privacy/login (not a
 *     raw JSON 401 on a browser navigation).
 *
 * db + session + email are mocked so no live infrastructure is used.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { poaApplications, manifestSubscriptions } from '../../db/schema.js';

process.env.DATABASE_URL ||= 'postgres://test:test@localhost:5432/test';
process.env.SESSION_SECRET ||= 'x'.repeat(64);
process.env.HOST_DOMAINS ||= 'quotefleet.net';
process.env.PUBLIC_BASE_URL ||= 'http://localhost:5000';

const state = vi.hoisted(() => ({
  session: null as { user: { id: number; email: string; name: string | null } } | null,
  sub: null as Record<string, unknown> | null,
  apps: [] as Record<string, unknown>[],
  updates: [] as { vals: Record<string, unknown> }[],
}));

vi.mock('../../config.js', () => ({
  loadEnv: () => ({
    PUBLIC_BASE_URL: 'http://localhost:5000',
    STRIPE_SECRET_KEY: 'sk_test',
    STRIPE_PRICE_MANIFEST_BASIC: 'price_b',
    STRIPE_PRICE_MANIFEST_PRO: 'price_p',
  }),
}));

vi.mock('../../auth/session.js', () => ({
  SESSION_COOKIE_NAME: 'qf_sess',
  lookupSession: vi.fn(async () => state.session),
}));

vi.mock('../../email/send.js', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));

// Minimal drizzle-shaped mock routed by table identity.
vi.mock('../../db/client.js', () => {
  const thenable = (rows: Record<string, unknown>[]) => ({
    limit: () => Promise.resolve(rows),
    orderBy: () => Promise.resolve(rows),
    then: (res: (v: Record<string, unknown>[]) => unknown) => res(rows),
  });
  return {
    db: () => ({
      select: () => ({
        from: (table: unknown) => ({
          where: () => thenable(table === manifestSubscriptions ? (state.sub ? [state.sub] : []) : state.apps),
        }),
      }),
      update: (table: unknown) => ({
        set: (vals: Record<string, unknown>) => ({
          where: () => {
            if (table === poaApplications) state.updates.push({ vals });
            return Promise.resolve();
          },
        }),
      }),
      insert: () => ({ values: () => Promise.resolve() }),
    }),
  };
});

const { registerManifestPrivacyRoutes } = await import('./manifestPrivacy.js');

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerManifestPrivacyRoutes(app);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  state.session = null;
  state.sub = null;
  state.apps = [];
  state.updates = [];
});

describe('GET /api/privacy/me — soft auth', () => {
  it('anonymous → { user: null }, never a 401', async () => {
    const res = await fetch(`${baseUrl}/api/privacy/me`);
    expect(res.status).toBe(200);
    const j = (await res.json()) as any;
    expect(j.user).toBeNull();
    expect(j.applications).toEqual([]);
  });

  it('authed → returns subscription identity + owned applications', async () => {
    state.session = { user: { id: 5, email: 'jane@acme.com', name: null } };
    state.sub = { userId: 5, tier: 'professional', status: 'active', currentPeriodEnd: null, entityQuota: 5 };
    state.apps = [
      { id: 1, publicToken: 'tok1', userId: 5, status: 'active', grantorLegalName: 'Acme Imports LLC', nameVariations: ['Acme'], signerEmail: 'jane@acme.com', docSha256: 'abc' },
    ];
    const res = await fetch(`${baseUrl}/api/privacy/me`);
    expect(res.status).toBe(200);
    const j = (await res.json()) as any;
    expect(j.user).toMatchObject({ id: 5, email: 'jane@acme.com' });
    expect(j.subscription).toMatchObject({ tier: 'professional', isSubscriber: true, entityQuota: 5 });
    expect(j.applications).toHaveLength(1);
    expect(j.applications[0]).toMatchObject({ token: 'tok1', status: 'active', grantorLegalName: 'Acme Imports LLC' });
  });
});

describe('account-linking by email', () => {
  it('claims ownerless applications matching the account email on account access', async () => {
    state.session = { user: { id: 5, email: 'jane@acme.com', name: null } };
    await fetch(`${baseUrl}/api/privacy/me`);
    // A single UPDATE poa_applications SET user_id=5 (WHERE user_id IS NULL AND
    // lower(signer_email)=lower(email)) is issued to link the account.
    expect(state.updates.length).toBeGreaterThanOrEqual(1);
    expect(state.updates[0].vals.userId).toBe(5);
  });

  it('does NOT attempt a claim for an anonymous caller (no email)', async () => {
    state.session = null;
    await fetch(`${baseUrl}/api/privacy/me`);
    expect(state.updates.length).toBe(0);
  });
});

describe('GET /privacy/account — login gate', () => {
  it('unauthenticated → 302 redirect to /privacy/login (not a JSON 401)', async () => {
    state.session = null;
    const res = await fetch(`${baseUrl}/privacy/account`, { redirect: 'manual' });
    expect([301, 302, 303, 307, 308]).toContain(res.status);
    expect(res.headers.get('location')).toBe('/privacy/login');
  });

  it('authenticated → renders the account portal HTML', async () => {
    state.session = { user: { id: 5, email: 'jane@acme.com', name: null } };
    state.sub = { userId: 5, tier: 'professional', status: 'active', currentPeriodEnd: null, entityQuota: 5 };
    state.apps = [
      { id: 1, publicToken: 'tok1', userId: 5, status: 'active', grantorLegalName: 'Acme Imports LLC', nameVariations: ['Acme'], signerEmail: 'jane@acme.com', docSha256: 'abc', signedAt: new Date(), cbpConfirmedAt: new Date(), effectiveAt: new Date(), expiresAt: new Date('2028-01-01') },
    ];
    const res = await fetch(`${baseUrl}/privacy/account`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Acme Imports LLC');
    expect(html).toContain('Manage billing');
    expect(html).toContain('Download signed POA');
  });
});
