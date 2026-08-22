/**
 * Directory Pro subscription webhook — applyDirectorySubscription + routing.
 *
 * Asserts:
 *   • isDirectorySubscription detects by price id AND by metadata.kind.
 *   • deriveDirectoryStatus maps active→active, trialing→trialing,
 *     past_due→past_due, canceled/unpaid→inactive.
 *   • applyDirectorySubscription upserts `directory_subscriptions` with the right
 *     status/subId/priceId/period, updating an existing row by customer id and
 *     inserting (off metadata.userId) when no row exists.
 *   • It NEVER writes the `tenants` table.
 *
 * db + config + stripe are mocked (billing.ts, imported transitively for
 * deriveSubscriptionState, needs them). Mirrors billing.test.ts's approach.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Stripe from 'stripe';
import { tenants, directorySubscriptions } from '../../db/schema.js';

const state = vi.hoisted(() => ({
  existingRow: null as Record<string, unknown> | null,
  updates: [] as { table: unknown; vals: Record<string, unknown> }[],
  inserts: [] as { table: unknown; vals: Record<string, unknown> }[],
}));

vi.mock('stripe', () => ({
  default: vi.fn(() => ({ subscriptions: { retrieve: vi.fn() } })),
}));

vi.mock('../../config.js', () => ({
  loadEnv: () => ({
    STRIPE_PRICE_DIRECTORY_PRO: 'price_dirpro',
    STRIPE_PRICE_PRO_MONTHLY: 'price_pro',
    STRIPE_PRICE_VITAL_MONTHLY: 'price_vital',
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_WEBHOOK_SECRET: 'whsec_x',
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
    update: (table: unknown) => ({
      set: (vals: Record<string, unknown>) => ({
        where: () => {
          state.updates.push({ table, vals });
          return Promise.resolve();
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        state.inserts.push({ table, vals });
        return Promise.resolve();
      },
    }),
  }),
}));

const { isDirectorySubscription, deriveDirectoryStatus, applyDirectorySubscription } = await import(
  './subscription.js'
);

type SubStatus = Stripe.Subscription.Status;

function makeSub(
  status: SubStatus,
  opts: { priceId?: string; id?: string; metadata?: Record<string, string>; customer?: string } = {}
): Stripe.Subscription {
  return {
    id: opts.id ?? 'sub_dir_1',
    status,
    customer: opts.customer ?? 'cus_dir_1',
    items: { data: [{ price: { id: opts.priceId ?? 'price_dirpro' } }] },
    metadata: opts.metadata ?? { kind: 'directory_pro', userId: '42' },
    current_period_end: 1893456000, // 2030-01-01
    trial_end: null,
  } as unknown as Stripe.Subscription;
}

beforeEach(() => {
  state.existingRow = { id: 5, userId: 42, stripeCustomerId: 'cus_dir_1', status: 'inactive' };
  state.updates = [];
  state.inserts = [];
});

describe('isDirectorySubscription', () => {
  it('detects by the Directory Pro price id', () => {
    expect(isDirectorySubscription(makeSub('active', { metadata: {} }))).toBe(true);
  });
  it('detects by metadata.kind when the price id is different', () => {
    expect(
      isDirectorySubscription(makeSub('active', { priceId: 'price_pro', metadata: { kind: 'directory_pro' } }))
    ).toBe(true);
  });
  it('is false for a plain tenant subscription (pro price, no dir metadata)', () => {
    expect(isDirectorySubscription(makeSub('active', { priceId: 'price_pro', metadata: {} }))).toBe(false);
  });
});

describe('deriveDirectoryStatus', () => {
  it('active → active', () => expect(deriveDirectoryStatus(makeSub('active'))).toBe('active'));
  it('trialing → trialing', () => expect(deriveDirectoryStatus(makeSub('trialing'))).toBe('trialing'));
  it('past_due → past_due', () => expect(deriveDirectoryStatus(makeSub('past_due'))).toBe('past_due'));
  it('incomplete (grace) → past_due', () =>
    expect(deriveDirectoryStatus(makeSub('incomplete'))).toBe('past_due'));
  it.each<SubStatus>(['canceled', 'unpaid', 'incomplete_expired', 'paused'])(
    'terminal %s → inactive',
    (s) => expect(deriveDirectoryStatus(makeSub(s))).toBe('inactive')
  );
});

describe('applyDirectorySubscription — upsert by customer id', () => {
  it('active updates the existing row with active status + sub id + price + period', async () => {
    await applyDirectorySubscription(makeSub('active'));
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].table).toBe(directorySubscriptions);
    expect(state.updates[0].vals.status).toBe('active');
    expect(state.updates[0].vals.stripeSubscriptionId).toBe('sub_dir_1');
    expect(state.updates[0].vals.priceId).toBe('price_dirpro');
    expect(state.updates[0].vals.currentPeriodEnd).toBeInstanceOf(Date);
  });

  it('past_due updates status to past_due', async () => {
    await applyDirectorySubscription(makeSub('past_due'));
    expect(state.updates[0].vals.status).toBe('past_due');
  });

  it('canceled updates status to inactive', async () => {
    await applyDirectorySubscription(makeSub('canceled'));
    expect(state.updates[0].vals.status).toBe('inactive');
  });

  it('inserts a NEW row off metadata.userId when no row exists for the customer', async () => {
    state.existingRow = null;
    await applyDirectorySubscription(makeSub('active'));
    expect(state.updates).toHaveLength(0);
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0].table).toBe(directorySubscriptions);
    expect(state.inserts[0].vals.userId).toBe(42);
    expect(state.inserts[0].vals.status).toBe('active');
    expect(state.inserts[0].vals.stripeCustomerId).toBe('cus_dir_1');
  });

  it('no row AND no usable userId metadata → no-op (no insert/update)', async () => {
    state.existingRow = null;
    await applyDirectorySubscription(makeSub('active', { metadata: { kind: 'directory_pro' } }));
    expect(state.inserts).toHaveLength(0);
    expect(state.updates).toHaveLength(0);
  });

  it('NEVER writes the tenants table (active/past_due/canceled)', async () => {
    for (const s of ['active', 'past_due', 'canceled'] as SubStatus[]) {
      state.existingRow = { id: 5, userId: 42, stripeCustomerId: 'cus_dir_1', status: 'inactive' };
      state.updates = [];
      state.inserts = [];
      await applyDirectorySubscription(makeSub(s));
      expect(state.updates.every((u) => u.table !== tenants)).toBe(true);
      expect(state.inserts.every((i) => i.table !== tenants)).toBe(true);
    }
  });
});
