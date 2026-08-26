/**
 * Manifest Privacy subscription webhook + tier gating.
 *
 * Asserts:
 *   • isManifestSubscription detects by any configured price id AND by
 *     metadata.kind = 'manifest_privacy'.
 *   • tierFromSubscription maps each price id → tier, with metadata fallback.
 *   • deriveManifestStatus maps active/trialing/past_due/inactive.
 *   • applyManifestSubscription upserts `manifest_subscriptions` with tier +
 *     entityQuota, updating by customer id and inserting off metadata.userId; it
 *     NEVER writes `tenants`.
 *   • Tier gating: a tier whose price id is UNSET degrades gracefully
 *     (manifestPriceId → null, manifestTierPurchasable → false = "coming soon").
 *
 * db + config + stripe are mocked (billing.ts is imported transitively for
 * deriveSubscriptionState).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Stripe from 'stripe';
import { tenants, manifestSubscriptions } from '../../db/schema.js';

const state = vi.hoisted(() => ({
  existingRow: null as Record<string, unknown> | null,
  updates: [] as { table: unknown; vals: Record<string, unknown> }[],
  inserts: [] as { table: unknown; vals: Record<string, unknown> }[],
}));

vi.mock('stripe', () => ({
  default: vi.fn(() => ({ subscriptions: { retrieve: vi.fn() } })),
}));

// ENT price intentionally UNSET → the "coming soon" degrade case.
vi.mock('../../config.js', () => ({
  loadEnv: () => ({
    STRIPE_PRICE_MANIFEST_BASIC: 'price_mbasic',
    STRIPE_PRICE_MANIFEST_PRO: 'price_mpro',
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

const {
  isManifestSubscription,
  tierFromSubscription,
  deriveManifestStatus,
  applyManifestSubscription,
} = await import('./manifestSubscription.js');
const { manifestPriceId, manifestTierPurchasable, tierMeta } = await import('./manifestEntitlement.js');

type SubStatus = Stripe.Subscription.Status;

function makeSub(
  status: SubStatus,
  opts: { priceId?: string; id?: string; metadata?: Record<string, string>; customer?: string } = {},
): Stripe.Subscription {
  return {
    id: opts.id ?? 'sub_m_1',
    status,
    customer: opts.customer ?? 'cus_m_1',
    items: { data: [{ price: { id: opts.priceId ?? 'price_mbasic' } }] },
    metadata: opts.metadata ?? { kind: 'manifest_privacy', userId: '77' },
    current_period_end: 1893456000,
    trial_end: null,
  } as unknown as Stripe.Subscription;
}

beforeEach(() => {
  state.existingRow = { id: 9, userId: 77, stripeCustomerId: 'cus_m_1', status: 'inactive', tier: 'basic' };
  state.updates = [];
  state.inserts = [];
});

describe('isManifestSubscription', () => {
  it('detects by a configured price id', () => {
    expect(isManifestSubscription(makeSub('active', { priceId: 'price_mpro', metadata: {} }))).toBe(true);
  });
  it('detects by metadata.kind when the price id is foreign', () => {
    expect(
      isManifestSubscription(makeSub('active', { priceId: 'price_other', metadata: { kind: 'manifest_privacy' } })),
    ).toBe(true);
  });
  it('is false for a non-manifest subscription', () => {
    expect(isManifestSubscription(makeSub('active', { priceId: 'price_other', metadata: { kind: 'directory_pro' } }))).toBe(
      false,
    );
  });
});

describe('tierFromSubscription', () => {
  it('maps the Basic and Pro price ids', () => {
    expect(tierFromSubscription(makeSub('active', { priceId: 'price_mbasic' }))).toBe('basic');
    expect(tierFromSubscription(makeSub('active', { priceId: 'price_mpro' }))).toBe('professional');
  });
  it('falls back to metadata.tier when the price id is unknown', () => {
    expect(
      tierFromSubscription(makeSub('active', { priceId: 'price_x', metadata: { tier: 'enterprise' } })),
    ).toBe('enterprise');
  });
});

describe('deriveManifestStatus', () => {
  it('maps active/trialing/past_due/inactive', () => {
    expect(deriveManifestStatus(makeSub('active'))).toBe('active');
    expect(deriveManifestStatus(makeSub('trialing'))).toBe('trialing');
    expect(deriveManifestStatus(makeSub('past_due'))).toBe('past_due');
    expect(deriveManifestStatus(makeSub('canceled'))).toBe('inactive');
  });
});

describe('applyManifestSubscription — upsert by customer id', () => {
  it('updates the existing row with status + tier + entityQuota, never touching tenants', async () => {
    await applyManifestSubscription(makeSub('active', { priceId: 'price_mpro' }));
    expect(state.inserts).toHaveLength(0);
    expect(state.updates).toHaveLength(1);
    const upd = state.updates[0];
    expect(upd.table).toBe(manifestSubscriptions);
    expect(upd.vals.status).toBe('active');
    expect(upd.vals.tier).toBe('professional');
    expect(upd.vals.entityQuota).toBe(tierMeta('professional').entityQuota);
    // NEVER writes tenants.
    expect(state.updates.some((u) => u.table === tenants)).toBe(false);
    expect(state.inserts.some((i) => i.table === tenants)).toBe(false);
  });

  it('inserts off metadata.userId when no row exists', async () => {
    state.existingRow = null;
    await applyManifestSubscription(makeSub('active', { priceId: 'price_mbasic' }));
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0].table).toBe(manifestSubscriptions);
    expect(state.inserts[0].vals.userId).toBe(77);
    expect(state.inserts[0].vals.tier).toBe('basic');
  });
});

describe('tier gating — graceful degrade when a price id is unset', () => {
  it('Basic + Professional are purchasable (prices set)', () => {
    expect(manifestPriceId('basic')).toBe('price_mbasic');
    expect(manifestPriceId('professional')).toBe('price_mpro');
    expect(manifestTierPurchasable('basic')).toBe(true);
    expect(manifestTierPurchasable('professional')).toBe(true);
  });
  it('Enterprise degrades to "coming soon" (price unset) — never crashes', () => {
    expect(manifestPriceId('enterprise')).toBeNull();
    expect(manifestTierPurchasable('enterprise')).toBe(false);
  });
});
