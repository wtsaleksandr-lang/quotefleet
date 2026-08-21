/**
 * Sign in with Apple — POST-callback route tests. Companion to oauth.test.ts,
 * but exercises the Apple-specific bits: the callback is a POST with a
 * form-urlencoded body (response_mode=form_post), and account resolution by the
 * apple_sub column reuses the SAME helper as the other providers.
 *
 * The DB, sessions and tenant-provisioning are mocked; exchangeAppleCodeForProfile
 * (the only network+crypto call) is stubbed so no real Apple keys / JWKS are
 * needed. verifyState / signState / isConfigured / getAppleConfig stay REAL so
 * the CSRF + gating assertions test the actual code paths.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

process.env.DATABASE_URL ||= 'postgres://test:test@localhost:5432/test';
process.env.SESSION_SECRET ||= 'x'.repeat(64);
process.env.HOST_DOMAINS ||= 'quotefleet.net';
process.env.PUBLIC_BASE_URL ||= 'http://localhost:5000';

/** Thenable, chainable Drizzle query-builder stub (see oauth.test.ts). */
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

const provisionMock = vi.fn(async () => ({
  tenantId: 1,
  userId: 77,
  slug: 'ada-co',
  hostDomain: 'quotefleet.net',
  embedToken: 'embed',
  trialEndsAt: new Date(),
}));
vi.mock('./tenantProvision.js', async (importActual) => {
  const actual = await importActual<typeof import('./tenantProvision.js')>();
  return { ...actual, provisionTrialTenant: provisionMock };
});

// Stub the network+crypto exchange; keep parseAppleUserName REAL.
const appleExchangeMock = vi.fn();
vi.mock('../oauth/apple.js', async (importActual) => {
  const actual = await importActual<typeof import('../oauth/apple.js')>();
  return { ...actual, exchangeAppleCodeForProfile: appleExchangeMock };
});

function enableApple() {
  process.env.APPLE_OAUTH_CLIENT_ID = 'net.quotefleet.web';
  process.env.APPLE_TEAM_ID = 'ABCDE12345';
  process.env.APPLE_KEY_ID = 'KEY1234567';
  process.env.APPLE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nMIG-test\n-----END PRIVATE KEY-----';
}
function disableApple() {
  delete process.env.APPLE_OAUTH_CLIENT_ID;
  delete process.env.APPLE_TEAM_ID;
  delete process.env.APPLE_KEY_ID;
  delete process.env.APPLE_PRIVATE_KEY;
}

let server: Server;
let baseUrl: string;
let signState: typeof import('../oauth/providers.js').signState;

beforeAll(async () => {
  const { registerOAuthRoutes } = await import('./oauth.js');
  signState = (await import('../oauth/providers.js')).signState;
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true })); // Apple form_post body parser
  registerOAuthRoutes(app);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  selectResults = [];
  appleExchangeMock.mockReset();
  provisionMock.mockClear();
  createSessionMock.mockClear();
  disableApple();
});

const profile = {
  sub: '001234.apple.stable.sub',
  email: 'ada@privaterelay.appleid.com',
  emailVerified: true,
  name: 'Ada Lovelace',
};

function postCallback(bodyFields: Record<string, string>) {
  return fetch(`${baseUrl}/auth/oauth/apple/callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(bodyFields).toString(),
    redirect: 'manual',
  });
}

describe('provider-gating (apple POST callback)', () => {
  it('POST callback soft-404s when apple is not configured', async () => {
    const res = await postCallback({ code: 'x', state: 'y' });
    expect(res.status).toBe(404);
    expect(appleExchangeMock).not.toHaveBeenCalled();
  });

  it('apple appears in /providers only when configured', async () => {
    let list: any = await (await fetch(`${baseUrl}/api/auth/oauth/providers`)).json();
    expect(list.providers.map((p: any) => p.id)).not.toContain('apple');
    enableApple();
    list = await (await fetch(`${baseUrl}/api/auth/oauth/providers`)).json();
    const apple = list.providers.find((p: any) => p.id === 'apple');
    expect(apple).toEqual({ id: 'apple', label: 'Apple' });
  });

  it('the GET callback does NOT serve apple (apple is POST-only)', async () => {
    enableApple();
    const res = await fetch(`${baseUrl}/auth/oauth/apple/callback?code=x&state=y`, { redirect: 'manual' });
    expect(res.status).toBe(404);
  });
});

describe('apple POST callback → account resolution', () => {
  it('known apple_sub → logs into that user, creates NO tenant', async () => {
    enableApple();
    appleExchangeMock.mockResolvedValue(profile);
    selectResults = [[{ id: 9, role: 'tenant_owner', email: profile.email }]]; // sub lookup hits

    const res = await postCallback({ code: 'auth-code', state: signState('apple', 'login') });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/app');
    expect(provisionMock).not.toHaveBeenCalled();
    expect(createSessionMock).toHaveBeenCalledTimes(1);
    // The real parseAppleUserName ran on the (absent) user field → name still
    // came from the exchange profile; exchange was invoked exactly once.
    expect(appleExchangeMock).toHaveBeenCalledTimes(1);
  });

  it('unknown identity → creates a new trial tenant on the appleSub column', async () => {
    enableApple();
    appleExchangeMock.mockResolvedValue(profile);
    selectResults = [[], []]; // sub miss, email miss → signup

    const res = await postCallback({ code: 'auth-code', state: signState('apple', 'signup') });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/app');
    expect(provisionMock).toHaveBeenCalledTimes(1);
    const arg = (provisionMock.mock.calls[0] as any[])[0] as any;
    expect(arg.oauth).toEqual({ column: 'appleSub', sub: profile.sub });
    expect(arg.email).toBe(profile.email);
    expect(createSessionMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a forged state (CSRF) before any exchange', async () => {
    enableApple();
    appleExchangeMock.mockResolvedValue(profile);
    const res = await postCallback({ code: 'auth-code', state: 'not-a-valid-signed-state' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('oauth_error=invalid_state');
    expect(appleExchangeMock).not.toHaveBeenCalled();
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it('missing code → missing_code redirect, no exchange', async () => {
    enableApple();
    const res = await postCallback({ state: signState('apple', 'login') });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('oauth_error=missing_code');
    expect(appleExchangeMock).not.toHaveBeenCalled();
  });
});
