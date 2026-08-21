/**
 * Social-login route tests — identity→account mapping, provider-gating, CSRF.
 *
 * The DB, sessions and the tenant-provisioning transaction are mocked so this
 * exercises the REAL route + REAL HMAC-state logic without live infrastructure
 * (same approach as auth.signup.test.ts). exchangeCodeForProfile (the only
 * network call) is stubbed; verifyState / signState / isConfigured stay real so
 * the CSRF + gating assertions test the actual code paths.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

// Env must exist before any handler calls loadEnv() (lazy, cached).
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

/** FIFO queue of results for successive `db().select()` calls. Each test seeds it. */
let selectResults: unknown[][] = [];

const dbStub: any = {
  select: () => chain(() => (selectResults.length ? selectResults.shift()! : [])),
  update: () => chain(() => []),
  insert: () => chain(() => [{ id: 1 }]),
  delete: () => chain(() => []),
  transaction: async (cb: (tx: any) => Promise<unknown>) =>
    cb({
      insert: () => chain(() => [{ id: 1 }]),
      update: () => chain(() => []),
      select: () => chain(() => []),
      delete: () => chain(() => []),
    }),
};
vi.mock('../../db/client.js', () => ({ db: () => dbStub }));

const createSessionMock = vi.fn(async () => 'test-token');
vi.mock('../../auth/session.js', () => ({
  createSession: createSessionMock,
  destroySession: vi.fn(async () => {}),
  lookupSession: vi.fn(async () => null),
  SESSION_COOKIE_NAME: 'qf_sess',
}));

// Keep everything in tenantProvision real EXCEPT the transaction, so we can
// assert whether a brand-new tenant was created (OAuth signup) vs not (login).
const provisionMock = vi.fn(async () => ({
  tenantId: 1,
  userId: 42,
  slug: 'harbor-link',
  hostDomain: 'quotefleet.net',
  embedToken: 'embed',
  trialEndsAt: new Date(),
}));
vi.mock('./tenantProvision.js', async (importActual) => {
  const actual = await importActual<typeof import('./tenantProvision.js')>();
  return { ...actual, provisionTrialTenant: provisionMock };
});

// Stub the network call; keep verifyState/signState/isConfigured/buildAuthorizeUrl real.
const exchangeMock = vi.fn();
vi.mock('../oauth/providers.js', async (importActual) => {
  const actual = await importActual<typeof import('../oauth/providers.js')>();
  return { ...actual, exchangeCodeForProfile: exchangeMock };
});

const GOOGLE_ID = 'GOOGLE_OAUTH_CLIENT_ID';
const GOOGLE_SECRET = 'GOOGLE_OAUTH_CLIENT_SECRET';

function enableGoogle() {
  process.env[GOOGLE_ID] = 'test-google-client-id';
  process.env[GOOGLE_SECRET] = 'test-google-client-secret';
}
function disableAllProviders() {
  for (const k of [
    GOOGLE_ID, GOOGLE_SECRET,
    'META_OAUTH_CLIENT_ID', 'META_OAUTH_CLIENT_SECRET',
    'FACEBOOK_OAUTH_CLIENT_ID', 'FACEBOOK_OAUTH_CLIENT_SECRET',
  ]) {
    delete process.env[k];
  }
}

let server: Server;
let baseUrl: string;
let signState: typeof import('../oauth/providers.js').signState;
let isConfigured: typeof import('../oauth/providers.js').isConfigured;
let buildAuthorizeUrl: typeof import('../oauth/providers.js').buildAuthorizeUrl;

beforeAll(async () => {
  const { registerOAuthRoutes } = await import('./oauth.js');
  const providers = await import('../oauth/providers.js');
  signState = providers.signState;
  isConfigured = providers.isConfigured;
  buildAuthorizeUrl = providers.buildAuthorizeUrl;
  const app = express();
  app.use(express.json());
  registerOAuthRoutes(app);
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
  exchangeMock.mockReset();
  provisionMock.mockClear();
  createSessionMock.mockClear();
  disableAllProviders();
});

describe('provider-gating', () => {
  it('with NO keys: /providers is empty and the start route soft-404s', async () => {
    const list: any = await (await fetch(`${baseUrl}/api/auth/oauth/providers`)).json();
    expect(list.providers).toEqual([]);
    const start = await fetch(`${baseUrl}/auth/oauth/google`, { redirect: 'manual' });
    expect(start.status).toBe(404);
  });

  it('with keys present: provider is advertised + active', async () => {
    enableGoogle();
    // Config detection (both directions of the gate).
    expect(isConfigured('google')).toBe(true);
    expect(isConfigured('meta')).toBe(false);

    const list: any = await (await fetch(`${baseUrl}/api/auth/oauth/providers`)).json();
    expect(list.providers.map((p: any) => p.id)).toContain('google');
    expect(list.providers.map((p: any) => p.id)).not.toContain('meta');

    // The authorize URL is a real Google consent URL carrying our signed state.
    const url = buildAuthorizeUrl('google', 'login');
    expect(url.startsWith('https://accounts.google.com/o/oauth2/auth?')).toBe(true);
    expect(url).toContain('client_id=test-google-client-id');
    expect(url).toContain('state=');

    // The start route now redirects (not a 404).
    const start = await fetch(`${baseUrl}/auth/oauth/google`, { redirect: 'manual' });
    expect(start.status).not.toBe(404);
  });
});

describe('callback identity → account mapping', () => {
  const profile = {
    sub: 'google-sub-123',
    email: 'owner@example.com',
    emailVerified: true,
    name: 'Harbor Link Logistics',
  };

  function callbackUrl(state: string, code = 'auth-code') {
    return `${baseUrl}/auth/oauth/google/callback?code=${code}&state=${encodeURIComponent(state)}`;
  }

  it('existing email → logs into that user, creates NO new tenant', async () => {
    enableGoogle();
    exchangeMock.mockResolvedValue(profile);
    // sub lookup → none; email lookup → an existing user.
    selectResults = [[], [{ id: 7, role: 'tenant_owner', email: profile.email }]];

    const res = await fetch(callbackUrl(signState('google', 'login')));
    // Followed the 302 to /app (which isn't registered here → 404), but the
    // final URL proves where we landed.
    expect(res.url.endsWith('/app')).toBe(true);
    expect(provisionMock).not.toHaveBeenCalled();
    expect(createSessionMock).toHaveBeenCalledTimes(1);
  });

  it('unknown email → creates a new trial tenant + owner (OAuth signup)', async () => {
    enableGoogle();
    exchangeMock.mockResolvedValue(profile);
    // sub lookup → none; email lookup → none → brand-new signup.
    selectResults = [[], []];

    const res = await fetch(callbackUrl(signState('google', 'signup')));
    expect(res.url.endsWith('/app')).toBe(true);
    expect(provisionMock).toHaveBeenCalledTimes(1);
    // Provisioned as an OAuth user on the google_sub column, card-free trial.
    const arg = (provisionMock.mock.calls[0] as any[])[0] as any;
    expect(arg.oauth).toEqual({ column: 'googleSub', sub: profile.sub });
    expect(arg.email).toBe(profile.email);
    expect(createSessionMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a callback with a bad/forged state (CSRF) before any exchange', async () => {
    enableGoogle();
    exchangeMock.mockResolvedValue(profile);

    const res = await fetch(callbackUrl('not-a-valid-signed-state'));
    expect(res.url).toContain('oauth_error=invalid_state');
    expect(exchangeMock).not.toHaveBeenCalled();
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it('existing account but provider email UNVERIFIED → refuses to link', async () => {
    enableGoogle();
    exchangeMock.mockResolvedValue({ ...profile, emailVerified: false });
    selectResults = [[], [{ id: 7, role: 'tenant_owner', email: profile.email }]];

    const res = await fetch(callbackUrl(signState('google', 'login')));
    expect(res.url).toContain('oauth_error=email_unverified');
    expect(provisionMock).not.toHaveBeenCalled();
    expect(createSessionMock).not.toHaveBeenCalled();
  });
});
