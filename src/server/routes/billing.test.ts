/**
 * Billing webhook — status→plan mapping + dunning grace (audit H3).
 *
 * THE BUG (before this fix): the subscription→plan mapping treated ONLY
 * `active`/`trialing` as live; ANY other status (incl. `past_due` and
 * `incomplete`) set plan='free' AND stripeSubscriptionId=null. So the first
 * failed auto-renewal instantly locked the paying customer out AND discarded
 * the sub id needed to recover them — even though Stripe keeps retrying the
 * charge for days.
 *
 * THE FIX (asserted here):
 *   status                          plan        subId    health
 *   ─────────────────────────────   ─────────   ──────   ────────
 *   active, trialing                paid tier   keep     active
 *   past_due, incomplete (GRACE)    paid tier   keep     grace
 *   canceled, unpaid,               free        drop     inactive
 *     incomplete_expired
 *
 * Plus a new `invoice.payment_failed` handler that RECORDS the failure
 * (audit log) while KEEPING access, so the app can nudge "update your card".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Stripe from 'stripe';

// Shared, hoisted mock state (vi.mock factories are hoisted above imports).
const state = vi.hoisted(() => ({
  tenantRow: null as Record<string, unknown> | null,
  updates: [] as Record<string, unknown>[],
  inserts: [] as Record<string, unknown>[],
}));

// plans.ts → planForPriceId reads STRIPE_PRICE_* off loadEnv(); give it the
// two price ids so a 'price_pro' line item maps to the 'pro' tier.
vi.mock('../../config.js', () => ({
  loadEnv: () => ({
    STRIPE_PRICE_PRO_MONTHLY: 'price_pro',
    STRIPE_PRICE_VITAL_MONTHLY: 'price_vital',
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_WEBHOOK_SECRET: 'whsec_x',
    PUBLIC_BASE_URL: 'http://localhost:5000',
  }),
}));

// Minimal chainable db() mock: select→[tenantRow], update captures .set(),
// insert captures .values(). The where/limit args are ignored.
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
    insert: () => ({
      values: (vals: Record<string, unknown>) => {
        state.inserts.push(vals);
        return Promise.resolve();
      },
    }),
  }),
}));

const { deriveSubscriptionState, applySubscription, handleEvent } = await import('./billing.js');

type SubStatus = Stripe.Subscription.Status;

function makeSub(status: SubStatus, opts: { priceId?: string; id?: string } = {}): Stripe.Subscription {
  return {
    id: opts.id ?? 'sub_123',
    status,
    customer: 'cus_123',
    items: { data: [{ price: { id: opts.priceId ?? 'price_pro' } }] },
    metadata: {},
    current_period_end: 1893456000, // 2030-01-01
    trial_end: null,
  } as unknown as Stripe.Subscription;
}

function subEvent(type: string, sub: Stripe.Subscription): Stripe.Event {
  return { type, data: { object: sub } } as unknown as Stripe.Event;
}

beforeEach(() => {
  state.tenantRow = {
    id: 7,
    slug: 'acme',
    stripeCustomerId: 'cus_123',
    plan: 'pro',
    stripeSubscriptionId: 'sub_123',
  };
  state.updates = [];
  state.inserts = [];
});

describe('deriveSubscriptionState — status → plan mapping', () => {
  it('active → paid tier, keeps sub id, health active', () => {
    expect(deriveSubscriptionState(makeSub('active'))).toEqual({
      plan: 'pro',
      keepSubscriptionId: true,
      health: 'active',
    });
  });

  it('trialing → paid tier, keeps sub id', () => {
    const s = deriveSubscriptionState(makeSub('trialing'));
    expect(s.plan).toBe('pro');
    expect(s.keepSubscriptionId).toBe(true);
  });

  it('past_due → GRACE: keeps paid tier AND keeps sub id (was: free/null)', () => {
    expect(deriveSubscriptionState(makeSub('past_due'))).toEqual({
      plan: 'pro',
      keepSubscriptionId: true,
      health: 'grace',
    });
  });

  it('incomplete → GRACE: keeps paid tier AND keeps sub id', () => {
    expect(deriveSubscriptionState(makeSub('incomplete'))).toEqual({
      plan: 'pro',
      keepSubscriptionId: true,
      health: 'grace',
    });
  });

  it('vital price id maps to the vital tier while past_due', () => {
    const s = deriveSubscriptionState(makeSub('past_due', { priceId: 'price_vital' }));
    expect(s.plan).toBe('vital');
    expect(s.keepSubscriptionId).toBe(true);
  });

  it.each<SubStatus>(['canceled', 'unpaid', 'incomplete_expired', 'paused'])(
    'terminal %s → free, drops sub id, health inactive',
    (status) => {
      expect(deriveSubscriptionState(makeSub(status))).toEqual({
        plan: 'free',
        keepSubscriptionId: false,
        health: 'inactive',
      });
    }
  );
});

describe('applySubscription — writes the tenant row', () => {
  it('past_due KEEPS the paid plan and KEEPS stripeSubscriptionId', async () => {
    await applySubscription(makeSub('past_due'));
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].plan).toBe('pro');
    expect(state.updates[0].stripeSubscriptionId).toBe('sub_123');
    // Grace entry is recorded so the app can nudge "update your card".
    expect(state.inserts.some((i) => i.action === 'billing.subscription_past_due')).toBe(true);
  });

  it('incomplete KEEPS the paid plan and KEEPS stripeSubscriptionId', async () => {
    await applySubscription(makeSub('incomplete'));
    expect(state.updates[0].plan).toBe('pro');
    expect(state.updates[0].stripeSubscriptionId).toBe('sub_123');
  });

  it('REGRESSION GUARD: past_due must NOT downgrade to free/null (the bug)', async () => {
    await applySubscription(makeSub('past_due'));
    expect(state.updates[0].plan).not.toBe('free');
    expect(state.updates[0].stripeSubscriptionId).not.toBeNull();
  });

  it('active → paid plan, keeps sub id, no grace audit', async () => {
    await applySubscription(makeSub('active'));
    expect(state.updates[0].plan).toBe('pro');
    expect(state.updates[0].stripeSubscriptionId).toBe('sub_123');
    expect(state.inserts.some((i) => i.action === 'billing.subscription_past_due')).toBe(false);
  });

  it.each<SubStatus>(['canceled', 'unpaid', 'incomplete_expired'])(
    'terminal %s → free plan and null sub id',
    async (status) => {
      await applySubscription(makeSub(status));
      expect(state.updates[0].plan).toBe('free');
      expect(state.updates[0].stripeSubscriptionId).toBeNull();
    }
  );
});

describe('handleEvent — webhook routing', () => {
  it('customer.subscription.updated (past_due) keeps paid plan + sub id', async () => {
    await handleEvent(subEvent('customer.subscription.updated', makeSub('past_due')));
    expect(state.updates[0].plan).toBe('pro');
    expect(state.updates[0].stripeSubscriptionId).toBe('sub_123');
  });

  it('customer.subscription.updated (canceled) downgrades to free/null', async () => {
    await handleEvent(subEvent('customer.subscription.updated', makeSub('canceled')));
    expect(state.updates[0].plan).toBe('free');
    expect(state.updates[0].stripeSubscriptionId).toBeNull();
  });

  it('customer.subscription.deleted downgrades to free/null', async () => {
    await handleEvent(subEvent('customer.subscription.deleted', makeSub('canceled')));
    expect(state.updates[0].plan).toBe('free');
    expect(state.updates[0].stripeSubscriptionId).toBeNull();
  });

  it('invoice.payment_failed is recorded, keeps access, does not throw', async () => {
    const invoiceEvent = {
      type: 'invoice.payment_failed',
      data: {
        object: {
          id: 'in_1',
          customer: 'cus_123',
          subscription: 'sub_123',
          attempt_count: 1,
          next_payment_attempt: 1893456000,
          amount_due: 3480,
          currency: 'usd',
        },
      },
    } as unknown as Stripe.Event;

    await expect(handleEvent(invoiceEvent)).resolves.toBeUndefined();
    // No plan change — access retained during grace.
    expect(state.updates).toHaveLength(0);
    // Failure recorded for later "update your card" surfacing.
    const audit = state.inserts.find((i) => i.action === 'billing.payment_failed');
    expect(audit).toBeTruthy();
    expect(audit?.actorKind).toBe('system');
    expect((audit?.detailsJson as Record<string, unknown>).subscriptionId).toBe('sub_123');
  });

  it('invoice.payment_failed for an unknown customer no-ops without throwing', async () => {
    state.tenantRow = null;
    const invoiceEvent = {
      type: 'invoice.payment_failed',
      data: { object: { id: 'in_2', customer: 'cus_missing' } },
    } as unknown as Stripe.Event;
    await expect(handleEvent(invoiceEvent)).resolves.toBeUndefined();
    expect(state.inserts).toHaveLength(0);
  });
});
