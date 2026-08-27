/**
 * Leads Pro subscription webhook + detection.
 *
 * Asserts:
 *   • isLeadsSubscription detects by the configured price id AND by
 *     metadata.kind = 'leads_pro'; false for a foreign sub.
 *   • deriveLeadsStatus maps active/trialing/past_due/inactive.
 *   • applyLeadsSubscription upserts `leads_subscriptions` by customer id and
 *     inserts off metadata.userId; it NEVER writes `tenants`.
 *
 * db + config + stripe are mocked (billing.ts is imported transitively for
 * deriveSubscriptionState).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Stripe from 'stripe';
import { tenants, leadsSubscriptions } from '../../db/schema.js';

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
    STRIPE_PRICE_LEADS_PRO: 'price_leads',
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

const { isLeadsSubscription, deriveLeadsStatus, applyLeadsSubscription } = await import(
  './leadsSubscription.js'
);

type SubStatus = Stripe.Subscription.Status;

function makeSub(
  status: SubStatus,
  opts: { priceId?: string; id?: string; metadata?: Record<string, string>; customer?: string } = {},
): Stripe.Subscription {
  return {
    id: opts.id ?? 'sub_l_1',
    status,
    customer: opts.customer ?? 'cus_l_1',
    items: { data: [{ price: { id: opts.priceId ?? 'price_leads' } }] },
    metadata: opts.metadata ?? { kind: 'leads_pro', userId: '77' },
    current_period_end: 1893456000,
    trial_end: null,
  } as unknown as Stripe.Subscription;
}

beforeEach(() => {
  state.existingRow = { id: 9, userId: 77, stripeCustomerId: 'cus_l_1', status: 'inactive', tier: 'pro' };
  state.updates = [];
  state.inserts = [];
});

describe('isLeadsSubscription', () => {
  it('detects by the configured price id', () => {
    expect(isLeadsSubscription(makeSub('active', { priceId: 'price_leads', metadata: {} }))).toBe(true);
  });
  it('detects by metadata.kind when the price id is foreign', () => {
    expect(
      isLeadsSubscription(makeSub('active', { priceId: 'price_other', metadata: { kind: 'leads_pro' } })),
    ).toBe(true);
  });
  it('is false for a non-leads subscription', () => {
    expect(
      isLeadsSubscription(makeSub('active', { priceId: 'price_other', metadata: { kind: 'manifest_privacy' } })),
    ).toBe(false);
  });
});

describe('deriveLeadsStatus', () => {
  it('maps active/trialing/past_due/inactive', () => {
    expect(deriveLeadsStatus(makeSub('active'))).toBe('active');
    expect(deriveLeadsStatus(makeSub('trialing'))).toBe('trialing');
    expect(deriveLeadsStatus(makeSub('past_due'))).toBe('past_due');
    expect(deriveLeadsStatus(makeSub('canceled'))).toBe('inactive');
  });
});

describe('applyLeadsSubscription — upsert by customer id', () => {
  it('updates the existing row with status, never touching tenants', async () => {
    await applyLeadsSubscription(makeSub('active'));
    expect(state.inserts).toHaveLength(0);
    expect(state.updates).toHaveLength(1);
    const upd = state.updates[0];
    expect(upd.table).toBe(leadsSubscriptions);
    expect(upd.vals.status).toBe('active');
    expect(upd.vals.tier).toBe('pro');
    expect(state.updates.some((u) => u.table === tenants)).toBe(false);
    expect(state.inserts.some((i) => i.table === tenants)).toBe(false);
  });

  it('inserts off metadata.userId when no row exists', async () => {
    state.existingRow = null;
    await applyLeadsSubscription(makeSub('active'));
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0].table).toBe(leadsSubscriptions);
    expect(state.inserts[0].vals.userId).toBe(77);
    expect(state.inserts[0].vals.tier).toBe('pro');
  });
});
