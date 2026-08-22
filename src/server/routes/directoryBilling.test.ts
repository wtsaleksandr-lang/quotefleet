/**
 * Directory Pro checkout — createDirectoryProCheckoutSession.
 *
 * Asserts the Checkout session is built in subscription mode with the Directory
 * Pro price and the { kind:'directory_pro', userId } subscription metadata the
 * webhook routes on, and that a reused customer id skips customer creation.
 *
 * Stripe is injected (mocked) so no network is touched; db + config are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  existingRow: null as Record<string, unknown> | null,
  inserts: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
  customerCreateArgs: null as Record<string, unknown> | null,
  sessionCreateArgs: null as Record<string, unknown> | null,
  customerCreateCalls: 0,
}));

vi.mock('stripe', () => ({
  default: vi.fn(() => ({
    customers: {
      create: vi.fn(async (args: Record<string, unknown>) => {
        state.customerCreateCalls++;
        state.customerCreateArgs = args;
        return { id: 'cus_new_1' };
      }),
    },
    checkout: {
      sessions: {
        create: vi.fn(async (args: Record<string, unknown>) => {
          state.sessionCreateArgs = args;
          return { url: 'https://checkout.stripe.test/session', id: 'cs_1' };
        }),
      },
    },
  })),
}));

vi.mock('../../config.js', () => ({
  loadEnv: () => ({
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_PRICE_DIRECTORY_PRO: 'price_dirpro',
    PUBLIC_BASE_URL: 'http://localhost:5000',
  }),
}));

vi.mock('../../db/client.js', () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(state.existingRow ? [state.existingRow] : []),
        }),
      }),
    }),
    update: () => ({ set: (vals: Record<string, unknown>) => ({ where: () => { state.updates.push(vals); return Promise.resolve(); } }) }),
    insert: () => ({ values: (vals: Record<string, unknown>) => { state.inserts.push(vals); return Promise.resolve(); } }),
  }),
}));

const { createDirectoryProCheckoutSession, directoryBillingConfigured } = await import('./directoryBilling.js');

beforeEach(() => {
  state.existingRow = null;
  state.inserts = [];
  state.updates = [];
  state.customerCreateArgs = null;
  state.sessionCreateArgs = null;
  state.customerCreateCalls = 0;
});

describe('directoryBillingConfigured', () => {
  it('true when secret key + Directory Pro price are set', () => {
    expect(directoryBillingConfigured()).toBe(true);
  });
});

describe('createDirectoryProCheckoutSession', () => {
  it('builds a subscription-mode session with the Directory Pro price + metadata', async () => {
    const { url } = await createDirectoryProCheckoutSession({ user: { id: 42, email: 'shipper@acme.com' } });
    expect(url).toBe('https://checkout.stripe.test/session');
    const args = state.sessionCreateArgs!;
    expect(args.mode).toBe('subscription');
    expect(args.line_items).toEqual([{ price: 'price_dirpro', quantity: 1 }]);
    const subData = args.subscription_data as { metadata?: Record<string, string>; trial_period_days?: number };
    expect(subData.metadata).toEqual({ kind: 'directory_pro', userId: '42' });
    // No trial at launch.
    expect(subData.trial_period_days).toBeUndefined();
    expect(String(args.success_url)).toContain('/directory?upgrade=success');
    expect(String(args.cancel_url)).toContain('/directory?upgrade=cancelled');
  });

  it('creates a new Stripe customer (email + userId metadata) and stamps a new row', async () => {
    state.existingRow = null;
    await createDirectoryProCheckoutSession({ user: { id: 42, email: 'shipper@acme.com' } });
    expect(state.customerCreateCalls).toBe(1);
    expect(state.customerCreateArgs).toMatchObject({
      email: 'shipper@acme.com',
      metadata: { userId: '42', kind: 'directory_pro' },
    });
    // A fresh entitlement row (inactive) is inserted with the new customer id.
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]).toMatchObject({ userId: 42, status: 'inactive', stripeCustomerId: 'cus_new_1' });
    expect(state.sessionCreateArgs!.customer).toBe('cus_new_1');
  });

  it('reuses an existing customer id and does NOT create a new customer', async () => {
    state.existingRow = { id: 5, userId: 42, stripeCustomerId: 'cus_existing', status: 'inactive' };
    const { customerId } = await createDirectoryProCheckoutSession({ user: { id: 42, email: 'shipper@acme.com' } });
    expect(customerId).toBe('cus_existing');
    expect(state.customerCreateCalls).toBe(0);
    expect(state.inserts).toHaveLength(0);
    expect(state.sessionCreateArgs!.customer).toBe('cus_existing');
  });
});
