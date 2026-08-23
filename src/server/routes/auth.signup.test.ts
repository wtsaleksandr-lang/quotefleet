/**
 * Signup billing-decision test — card-AFTER-trial.
 *
 * Guards the product decision (2026-08-03, see plans.ts + memory
 * project_quotefleet_pricing_model): signup must stay CARD-FREE even when
 * Stripe billing is fully configured. The card is collected later, at
 * subscribe / trial-end — NOT at signup.
 *
 * Fail-without / pass-with: before the card-free change the signup handler
 * did `if (billingConfigured()) { createTrialCheckoutSession(...) }` and put
 * the hosted Checkout URL on the response, so a billing-configured signup
 * returned a non-null `checkoutUrl` (card required up front) AND invoked
 * createTrialCheckoutSession — both assertions below would fail. After the
 * change the handler never opens a Checkout session at signup, so
 * `checkoutUrl` is always null and the spy is never called.
 *
 * The DB, sessions and Stripe billing are mocked — this exercises the real
 * signup route decision logic without live infrastructure (per vitest.config
 * note: DB/config-touching tests use mocks).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

// Env must be present before the route handler calls loadEnv() (lazy, cached).
process.env.DATABASE_URL ||= 'postgres://test:test@localhost:5432/test';
process.env.SESSION_SECRET ||= 'x'.repeat(64);
process.env.HOST_DOMAINS ||= 'quotefleet.net';
process.env.PUBLIC_BASE_URL ||= 'http://localhost:5000';

/**
 * A thenable, infinitely-chainable Drizzle query-builder stub. Every method
 * (.select/.insert/.update/.from/.where/.limit/.values/.returning/…) returns
 * the same proxy, and awaiting anywhere in the chain resolves to `rows`.
 * Lookups use [] (nothing exists yet); inserts use [{ id: 1 }] (fresh row id).
 */
function chain(rows: unknown[]): any {
  const proxy: any = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
          Promise.resolve(rows).then(resolve, reject);
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
  select: () => chain([]), // email-uniqueness + slug checks → nothing taken
  insert: () => chain([{ id: 1 }]), // returning({ id }) → fresh row
  update: () => chain([]),
  delete: () => chain([]),
  transaction: async (cb: (tx: any) => Promise<unknown>) =>
    cb({
      insert: () => chain([{ id: 1 }]),
      update: () => chain([]),
      select: () => chain([]),
      delete: () => chain([]),
    }),
};

vi.mock('../../db/client.js', () => ({ db: () => dbStub }));

// Billing is "configured" here (billingConfigured → true). This is the whole
// point: even so, signup must return NO checkoutUrl. createTrialCheckoutSession
// is a spy we assert is never invoked at signup.
const createTrialCheckoutSession = vi.fn(async () => ({
  url: 'https://checkout.stripe.test/s/should-not-be-used',
  customerId: 'cus_test',
}));
const billingConfigured = vi.fn(() => true);
vi.mock('./billing.js', () => ({ billingConfigured, createTrialCheckoutSession }));

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
  createTrialCheckoutSession.mockClear();
  billingConfigured.mockClear();
});

function signupBody(overrides: Record<string, unknown> = {}) {
  return {
    companyName: 'Harbor Link Logistics',
    email: `owner+${Math.random().toString(36).slice(2)}@example.com`,
    password: 'a-strong-password',
    plan: 'pro',
    countryFocus: 'US',
    dpaAccepted: true,
    dpaVersion: '1.0',
    ...overrides,
  };
}

async function postSignup(body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

describe('POST /api/auth/signup — card-after-trial (card-free signup)', () => {
  it('returns NO checkoutUrl and never opens a Checkout session even when billing IS configured', async () => {
    billingConfigured.mockReturnValue(true);

    const { status, json } = await postSignup(signupBody());

    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    // The card-free contract: no Stripe Checkout URL to redirect to → client
    // lands on /app. `checkoutUrl` is present in the shape but must be null.
    expect(json.checkoutUrl ?? null).toBeNull();
    // The handler must NOT create a Checkout session at signup.
    expect(createTrialCheckoutSession).not.toHaveBeenCalled();
    // A real trial tenant was created (slug + trial end returned).
    expect(json.tenant?.slug).toBeTruthy();
    expect(json.tenant?.trialEndsAt).toBeTruthy();
    expect(json.plan).toBe('pro');
    expect(json.role).toBe('tenant_owner');
  });

  it('defaults the selected plan to Vital (cheaper tier) when none is submitted', async () => {
    // The signup form now pre-selects Vital, but the server must ALSO default
    // to the cheaper tier for any request that omits `plan` — so the trial→bill
    // intent can never silently resolve to the pricier Pro tier.
    const body = signupBody();
    delete (body as Record<string, unknown>).plan;

    const { status, json } = await postSignup(body);

    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.plan).toBe('vital');
  });

  it('is also card-free when billing is NOT configured (degraded path unchanged)', async () => {
    billingConfigured.mockReturnValue(false);

    const { status, json } = await postSignup(signupBody());

    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.checkoutUrl ?? null).toBeNull();
    expect(createTrialCheckoutSession).not.toHaveBeenCalled();
  });
});
