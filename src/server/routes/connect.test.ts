/**
 * Stripe Connect (Express) onboarding — payments PR 1.
 *
 * Asserts the onboarding + status foundation WITHOUT any charge/money movement:
 *   - onboard creates an Express account when the tenant has none, returns an
 *     account-link URL, and stores the account id on the tenant (tenant-scoped
 *     metadata).
 *   - onboard REUSES an existing account id on repeat (no duplicate account).
 *   - status maps accounts.retrieve → {connected, detailsSubmitted,
 *     chargesEnabled, payoutsEnabled}; no account id → {connected:false}.
 *   - gating: connectConfigured() is false when STRIPE_SECRET_KEY is unset.
 *   - account.updated webhook refreshes the tenant's cached readiness flags.
 *
 * Stripe is mocked (default export → a shared fake client), mirroring the
 * billing test's config/db mocking pattern. `loadEnv` reads a MUTABLE env object
 * so the gating test can drop the secret key.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Stripe from 'stripe';

const env = vi.hoisted(() => ({
  value: {
    STRIPE_SECRET_KEY: 'sk_test_x' as string | undefined,
    STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_connect_x' as string | undefined,
    PUBLIC_BASE_URL: 'http://localhost:5000',
  },
}));

const stripeMock = vi.hoisted(() => ({
  accounts: { create: vi.fn(), retrieve: vi.fn() },
  accountLinks: { create: vi.fn() },
  webhooks: { constructEvent: vi.fn() },
}));

const state = vi.hoisted(() => ({
  tenantRow: null as Record<string, unknown> | null,
  updates: [] as Record<string, unknown>[],
}));

vi.mock('../../config.js', () => ({ loadEnv: () => env.value }));

vi.mock('stripe', () => ({ default: vi.fn(() => stripeMock) }));

vi.mock('../../db/client.js', () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(state.tenantRow ? [state.tenantRow] : []),
        }),
      }),
    }),
    update: () => ({
      set: (vals: Record<string, unknown>) => ({
        where: () => {
          state.updates.push(vals);
          return Promise.resolve();
        },
      }),
    }),
  }),
}));

const {
  onboardTenant,
  getConnectStatus,
  mapAccountStatus,
  connectConfigured,
  applyAccountUpdate,
  handleConnectEvent,
} = await import('./connect.js');

type Tenant = Parameters<typeof onboardTenant>[0];

function makeTenant(over: Partial<Record<string, unknown>> = {}): Tenant {
  return {
    id: 7,
    slug: 'acme',
    contactEmail: 'ops@acme.test',
    stripeConnectAccountId: null,
    connectDetailsSubmitted: null,
    connectChargesEnabled: null,
    connectPayoutsEnabled: null,
    ...over,
  } as unknown as Tenant;
}

beforeEach(() => {
  env.value = {
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_connect_x',
    PUBLIC_BASE_URL: 'http://localhost:5000',
  };
  state.tenantRow = null;
  state.updates = [];
  stripeMock.accounts.create.mockReset().mockResolvedValue({ id: 'acct_new' });
  stripeMock.accounts.retrieve.mockReset();
  stripeMock.accountLinks.create
    .mockReset()
    .mockResolvedValue({ url: 'https://connect.stripe.com/setup/acct_new' });
});

describe('connectConfigured — gating', () => {
  it('true when STRIPE_SECRET_KEY is set', () => {
    expect(connectConfigured()).toBe(true);
  });
  it('false when STRIPE_SECRET_KEY is unset (routes soft-fail 503)', () => {
    env.value.STRIPE_SECRET_KEY = undefined;
    expect(connectConfigured()).toBe(false);
  });
});

describe('mapAccountStatus — pure Stripe.Account → UI flags', () => {
  it('maps details/charges/payouts and connected', () => {
    const acct = {
      id: 'acct_1',
      details_submitted: true,
      charges_enabled: true,
      payouts_enabled: false,
    } as unknown as Stripe.Account;
    expect(mapAccountStatus(acct)).toEqual({
      connected: true,
      detailsSubmitted: true,
      chargesEnabled: true,
      payoutsEnabled: false,
    });
  });
});

describe('onboardTenant — create / reuse Express account + account link', () => {
  it('creates an Express account when none exists, stores the id, returns the link URL', async () => {
    const t = makeTenant();
    const res = await onboardTenant(t);

    expect(stripeMock.accounts.create).toHaveBeenCalledTimes(1);
    const createArg = stripeMock.accounts.create.mock.calls[0][0];
    expect(createArg.type).toBe('express');
    // Tenant-scoped metadata so the account is traceable to THIS tenant.
    expect(createArg.metadata).toEqual({ tenantId: '7', slug: 'acme' });

    // The new id is persisted on the tenant row.
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].stripeConnectAccountId).toBe('acct_new');

    // An onboarding account link is opened + returned.
    expect(stripeMock.accountLinks.create).toHaveBeenCalledTimes(1);
    const linkArg = stripeMock.accountLinks.create.mock.calls[0][0];
    expect(linkArg.account).toBe('acct_new');
    expect(linkArg.type).toBe('account_onboarding');
    expect(linkArg.refresh_url).toContain('/app/account');
    expect(linkArg.return_url).toContain('/app/account');
    expect(res.url).toBe('https://connect.stripe.com/setup/acct_new');
  });

  it('REUSES an existing account id on repeat — no duplicate account, no id write', async () => {
    const t = makeTenant({ stripeConnectAccountId: 'acct_existing' });
    stripeMock.accountLinks.create.mockResolvedValue({
      url: 'https://connect.stripe.com/setup/acct_existing',
    });
    const res = await onboardTenant(t);

    expect(stripeMock.accounts.create).not.toHaveBeenCalled();
    expect(state.updates).toHaveLength(0);
    expect(stripeMock.accountLinks.create.mock.calls[0][0].account).toBe('acct_existing');
    expect(res.accountId).toBe('acct_existing');
  });
});

describe('getConnectStatus — retrieve → status, cache refresh', () => {
  it('no account id → { connected:false } and does NOT hit Stripe', async () => {
    const status = await getConnectStatus(makeTenant());
    expect(status).toEqual({
      connected: false,
      detailsSubmitted: false,
      chargesEnabled: false,
      payoutsEnabled: false,
    });
    expect(stripeMock.accounts.retrieve).not.toHaveBeenCalled();
  });

  it('maps accounts.retrieve fields and refreshes the cache when changed', async () => {
    stripeMock.accounts.retrieve.mockResolvedValue({
      id: 'acct_existing',
      details_submitted: true,
      charges_enabled: true,
      payouts_enabled: false,
    });
    const t = makeTenant({ stripeConnectAccountId: 'acct_existing' });
    const status = await getConnectStatus(t);

    expect(stripeMock.accounts.retrieve).toHaveBeenCalledWith('acct_existing');
    expect(status).toEqual({
      connected: true,
      detailsSubmitted: true,
      chargesEnabled: true,
      payoutsEnabled: false,
    });
    // Flags differed from the (null) cache → one refresh write.
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].connectChargesEnabled).toBe(true);
    expect(state.updates[0].connectPayoutsEnabled).toBe(false);
  });

  it('skips the cache write when the flags already match', async () => {
    stripeMock.accounts.retrieve.mockResolvedValue({
      id: 'acct_existing',
      details_submitted: true,
      charges_enabled: true,
      payouts_enabled: true,
    });
    const t = makeTenant({
      stripeConnectAccountId: 'acct_existing',
      connectDetailsSubmitted: true,
      connectChargesEnabled: true,
      connectPayoutsEnabled: true,
    });
    await getConnectStatus(t);
    expect(state.updates).toHaveLength(0);
  });
});

describe('handleConnectEvent — account.updated webhook refreshes cache', () => {
  it('refreshes the owning tenant’s cached flags', async () => {
    state.tenantRow = {
      id: 7,
      slug: 'acme',
      stripeConnectAccountId: 'acct_existing',
      connectDetailsSubmitted: false,
      connectChargesEnabled: false,
      connectPayoutsEnabled: false,
    };
    const event = {
      type: 'account.updated',
      data: {
        object: {
          id: 'acct_existing',
          details_submitted: true,
          charges_enabled: true,
          payouts_enabled: true,
        },
      },
    } as unknown as Stripe.Event;

    await handleConnectEvent(event);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].connectChargesEnabled).toBe(true);
    expect(state.updates[0].connectDetailsSubmitted).toBe(true);
  });

  it('no tenant for the account → no-op, does not throw', async () => {
    state.tenantRow = null;
    await expect(
      applyAccountUpdate({ id: 'acct_orphan' } as unknown as Stripe.Account)
    ).resolves.toBeUndefined();
    expect(state.updates).toHaveLength(0);
  });
});
