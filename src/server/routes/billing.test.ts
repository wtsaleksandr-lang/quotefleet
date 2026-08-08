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
  // Subscription the mocked Stripe client returns from subscriptions.retrieve —
  // used by the invoice.paid recovery path (handleEvent retrieves the live sub).
  retrieveSub: null as Stripe.Subscription | null,
}));

// Stripe client mock — only subscriptions.retrieve is exercised (invoice.paid
// recovery). All other billing tests drive the pure mappers / subscription
// events directly and never touch the network.
vi.mock('stripe', () => ({
  default: vi.fn(() => ({
    subscriptions: {
      retrieve: vi.fn(async () => state.retrieveSub),
    },
  })),
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
  state.retrieveSub = null;
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

  it('past_due SETS the persisted past-due marker on the tenant', async () => {
    await applySubscription(makeSub('past_due'));
    const life = state.updates[0].lifecycleEmailsJson as Record<string, unknown>;
    expect(life).toBeTruthy();
    expect(typeof life.billingPastDueSince).toBe('string');
  });

  it('active CLEARS a previously-set past-due marker', async () => {
    state.tenantRow = {
      id: 7,
      slug: 'acme',
      stripeCustomerId: 'cus_123',
      plan: 'pro',
      stripeSubscriptionId: 'sub_123',
      lifecycleEmailsJson: { billingPastDueSince: '2026-01-01T00:00:00.000Z', welcome: '2026-01-01' },
    };
    await applySubscription(makeSub('active'));
    const life = state.updates[0].lifecycleEmailsJson as Record<string, unknown>;
    expect(life.billingPastDueSince).toBeUndefined(); // cleared
    expect(life.welcome).toBe('2026-01-01'); // unrelated lifecycle keys preserved
  });

  it('active with NO marker does not touch lifecycleEmailsJson (no needless write)', async () => {
    await applySubscription(makeSub('active'));
    expect('lifecycleEmailsJson' in state.updates[0]).toBe(false);
  });

  it('terminal canceled CLEARS the marker while downgrading to free', async () => {
    state.tenantRow = {
      id: 7,
      slug: 'acme',
      stripeCustomerId: 'cus_123',
      plan: 'pro',
      stripeSubscriptionId: 'sub_123',
      lifecycleEmailsJson: { billingPastDueSince: '2026-01-01T00:00:00.000Z' },
    };
    await applySubscription(makeSub('canceled'));
    expect(state.updates[0].plan).toBe('free');
    const life = state.updates[0].lifecycleEmailsJson as Record<string, unknown>;
    expect(life.billingPastDueSince).toBeUndefined();
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
    // No PLAN change — access retained during grace. (The only write is the
    // "update your card" marker below, never a plan/subId downgrade.)
    expect(state.updates.every((u) => !('plan' in u))).toBe(true);
    expect(state.updates.every((u) => !('stripeSubscriptionId' in u))).toBe(true);
    // Failure recorded for later "update your card" surfacing.
    const audit = state.inserts.find((i) => i.action === 'billing.payment_failed');
    expect(audit).toBeTruthy();
    expect(audit?.actorKind).toBe('system');
    expect((audit?.detailsJson as Record<string, unknown>).subscriptionId).toBe('sub_123');
    // The persisted past-due marker is set so /api/auth/me can raise the banner.
    const marked = state.updates.find(
      (u) => (u.lifecycleEmailsJson as Record<string, unknown> | undefined)?.billingPastDueSince
    );
    expect(marked).toBeTruthy();
  });

  it('invoice.payment_failed does NOT re-write the marker when already set', async () => {
    state.tenantRow = {
      id: 7,
      slug: 'acme',
      stripeCustomerId: 'cus_123',
      plan: 'pro',
      stripeSubscriptionId: 'sub_123',
      lifecycleEmailsJson: { billingPastDueSince: '2026-01-01T00:00:00.000Z' },
    };
    const invoiceEvent = {
      type: 'invoice.payment_failed',
      data: { object: { id: 'in_3', customer: 'cus_123', subscription: 'sub_123' } },
    } as unknown as Stripe.Event;
    await handleEvent(invoiceEvent);
    // Marker already present → no tenant update at all (only the audit insert).
    expect(state.updates).toHaveLength(0);
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

/**
 * AUTOMATIC ACCESS ENFORCEMENT — the money path.
 *
 * Policy:
 *   - GRACE (past_due / incomplete) → access RETAINED, status untouched. Stripe
 *     is still dunning; suspending on the first failed renewal is wrong.
 *   - TERMINAL non-payment (canceled / unpaid / incomplete_expired / deleted)
 *     → SUSPEND (status:'suspended') + stamp the billing marker. The public
 *     widget then 404s.
 *   - PAYMENT good again (active / trialing, or invoice.paid) → REINSTATE
 *     (status:'active') + clear the marker — but ONLY a billing-driven
 *     suspension. A manual admin suspension and a 'churned' tenant are NEVER
 *     auto-un-suspended.
 */
const BILLING_SUSPENDED_KEY = 'billingSuspendedSince';
const BILLING_PAST_DUE_KEY = 'billingPastDueSince';

/** The `status` written by the (single) tenant update in this test, or
 *  undefined when the update didn't touch status. */
function writtenStatus(): unknown {
  const u = state.updates.find((u) => 'status' in u);
  return u?.status;
}

describe('automatic access enforcement — suspend on non-payment', () => {
  it.each<SubStatus>(['canceled', 'unpaid', 'incomplete_expired'])(
    'terminal %s on an ACTIVE tenant → status suspended + billing marker + plan free',
    async (status) => {
      state.tenantRow = {
        id: 7,
        slug: 'acme',
        status: 'active',
        stripeCustomerId: 'cus_123',
        plan: 'pro',
        stripeSubscriptionId: 'sub_123',
      };
      await handleEvent(subEvent('customer.subscription.updated', makeSub(status)));
      expect(writtenStatus()).toBe('suspended');
      expect(state.updates[0].plan).toBe('free');
      expect(state.updates[0].stripeSubscriptionId).toBeNull();
      const life = state.updates[0].lifecycleEmailsJson as Record<string, unknown>;
      expect(typeof life[BILLING_SUSPENDED_KEY]).toBe('string'); // marker set
      // Access change is audited.
      expect(state.inserts.some((i) => i.action === 'billing.suspended')).toBe(true);
    }
  );

  it('customer.subscription.deleted on an ACTIVE tenant → suspended + marker + plan free', async () => {
    state.tenantRow = {
      id: 7,
      slug: 'acme',
      status: 'active',
      stripeCustomerId: 'cus_123',
      plan: 'pro',
      stripeSubscriptionId: 'sub_123',
    };
    await handleEvent(subEvent('customer.subscription.deleted', makeSub('canceled')));
    expect(writtenStatus()).toBe('suspended');
    expect(state.updates[0].plan).toBe('free');
    expect(state.updates[0].stripeSubscriptionId).toBeNull();
    const life = state.updates[0].lifecycleEmailsJson as Record<string, unknown>;
    expect(typeof life[BILLING_SUSPENDED_KEY]).toBe('string');
    expect(state.inserts.some((i) => i.action === 'billing.suspended')).toBe(true);
  });

  it('GRACE past_due on an ACTIVE tenant → status NOT changed (access retained)', async () => {
    state.tenantRow = {
      id: 7,
      slug: 'acme',
      status: 'active',
      stripeCustomerId: 'cus_123',
      plan: 'pro',
      stripeSubscriptionId: 'sub_123',
    };
    await handleEvent(subEvent('customer.subscription.updated', makeSub('past_due')));
    expect(writtenStatus()).toBeUndefined(); // never suspended during grace
    // No billing-suspend marker; the past-due (update-your-card) marker is set instead.
    const life = state.updates[0].lifecycleEmailsJson as Record<string, unknown>;
    expect(life?.[BILLING_SUSPENDED_KEY]).toBeUndefined();
    expect(typeof life?.[BILLING_PAST_DUE_KEY]).toBe('string');
    expect(state.inserts.some((i) => i.action === 'billing.suspended')).toBe(false);
  });

  it('terminal on an already-suspended tenant does NOT rewrite status or relabel the marker', async () => {
    // Manually suspended (no billing marker). A terminal billing event must not
    // flip it to a billing suspension — so it can never be auto-reinstated later.
    state.tenantRow = {
      id: 7,
      slug: 'acme',
      status: 'suspended',
      stripeCustomerId: 'cus_123',
      plan: 'pro',
      stripeSubscriptionId: 'sub_123',
    };
    await handleEvent(subEvent('customer.subscription.updated', makeSub('canceled')));
    expect(writtenStatus()).toBeUndefined(); // status left as-is
    const life = (state.updates[0].lifecycleEmailsJson ?? {}) as Record<string, unknown>;
    expect(life[BILLING_SUSPENDED_KEY]).toBeUndefined(); // marker NOT added
  });

  it('terminal on a CHURNED tenant never touches status', async () => {
    state.tenantRow = {
      id: 7,
      slug: 'acme',
      status: 'churned',
      stripeCustomerId: 'cus_123',
      plan: 'pro',
      stripeSubscriptionId: 'sub_123',
    };
    await handleEvent(subEvent('customer.subscription.deleted', makeSub('canceled')));
    expect(writtenStatus()).toBeUndefined();
  });
});

describe('automatic access enforcement — reinstate on payment', () => {
  const billingSuspendedTenant = () => ({
    id: 7,
    slug: 'acme',
    status: 'suspended',
    stripeCustomerId: 'cus_123',
    plan: 'free',
    stripeSubscriptionId: null,
    lifecycleEmailsJson: { [BILLING_SUSPENDED_KEY]: '2026-01-01T00:00:00.000Z' },
  });

  it('active event on a BILLING-suspended tenant → status active + marker cleared + plan restored', async () => {
    state.tenantRow = billingSuspendedTenant();
    await handleEvent(subEvent('customer.subscription.updated', makeSub('active')));
    expect(writtenStatus()).toBe('active');
    expect(state.updates[0].plan).toBe('pro'); // reconciled from the price
    const life = state.updates[0].lifecycleEmailsJson as Record<string, unknown>;
    expect(life[BILLING_SUSPENDED_KEY]).toBeUndefined(); // marker cleared
    expect(state.inserts.some((i) => i.action === 'billing.reinstated')).toBe(true);
  });

  it('invoice.paid on a BILLING-suspended tenant → retrieves sub → status active + marker cleared', async () => {
    state.tenantRow = billingSuspendedTenant();
    state.retrieveSub = makeSub('active');
    const invoiceEvent = {
      type: 'invoice.paid',
      data: { object: { id: 'in_ok', customer: 'cus_123', subscription: 'sub_123' } },
    } as unknown as Stripe.Event;
    await handleEvent(invoiceEvent);
    expect(writtenStatus()).toBe('active');
    const life = state.updates[0].lifecycleEmailsJson as Record<string, unknown>;
    expect(life[BILLING_SUSPENDED_KEY]).toBeUndefined();
    expect(state.inserts.some((i) => i.action === 'billing.reinstated')).toBe(true);
  });

  it('invoice.payment_succeeded is treated the same as invoice.paid', async () => {
    state.tenantRow = billingSuspendedTenant();
    state.retrieveSub = makeSub('active');
    const invoiceEvent = {
      type: 'invoice.payment_succeeded',
      data: { object: { id: 'in_ok2', customer: 'cus_123', subscription: 'sub_123' } },
    } as unknown as Stripe.Event;
    await handleEvent(invoiceEvent);
    expect(writtenStatus()).toBe('active');
  });

  it('SAFEGUARD: a MANUALLY suspended tenant (no marker) is NOT reinstated by a stray active event', async () => {
    state.tenantRow = {
      id: 7,
      slug: 'acme',
      status: 'suspended',
      stripeCustomerId: 'cus_123',
      plan: 'pro',
      stripeSubscriptionId: 'sub_123',
      // NO billingSuspendedSince marker — this was an admin action.
    };
    await handleEvent(subEvent('customer.subscription.updated', makeSub('active')));
    expect(writtenStatus()).toBeUndefined(); // stays suspended
    expect(state.inserts.some((i) => i.action === 'billing.reinstated')).toBe(false);
  });

  it('SAFEGUARD: a MANUALLY suspended tenant is NOT reinstated by a stray invoice.paid', async () => {
    state.tenantRow = {
      id: 7,
      slug: 'acme',
      status: 'suspended',
      stripeCustomerId: 'cus_123',
      plan: 'pro',
      stripeSubscriptionId: 'sub_123',
    };
    state.retrieveSub = makeSub('active');
    const invoiceEvent = {
      type: 'invoice.paid',
      data: { object: { id: 'in_x', customer: 'cus_123', subscription: 'sub_123' } },
    } as unknown as Stripe.Event;
    await handleEvent(invoiceEvent);
    expect(writtenStatus()).toBeUndefined();
  });

  it('SAFEGUARD: a CHURNED tenant is never auto-reinstated', async () => {
    state.tenantRow = {
      id: 7,
      slug: 'acme',
      status: 'churned',
      stripeCustomerId: 'cus_123',
      plan: 'free',
      stripeSubscriptionId: null,
      lifecycleEmailsJson: { [BILLING_SUSPENDED_KEY]: '2026-01-01T00:00:00.000Z' },
    };
    await handleEvent(subEvent('customer.subscription.updated', makeSub('active')));
    expect(writtenStatus()).toBeUndefined(); // stays churned
  });

  it('active on an already-active tenant → no status write (idempotent)', async () => {
    state.tenantRow = {
      id: 7,
      slug: 'acme',
      status: 'active',
      stripeCustomerId: 'cus_123',
      plan: 'pro',
      stripeSubscriptionId: 'sub_123',
    };
    await handleEvent(subEvent('customer.subscription.updated', makeSub('active')));
    expect(writtenStatus()).toBeUndefined();
    expect(state.inserts.some((i) => i.action === 'billing.reinstated')).toBe(false);
  });
});

describe('automatic access enforcement — upgrade grants higher access', () => {
  it('subscription.updated to the PRO price → plan pro (Pro-only features unlock)', async () => {
    state.tenantRow = {
      id: 7,
      slug: 'acme',
      status: 'active',
      stripeCustomerId: 'cus_123',
      plan: 'vital',
      stripeSubscriptionId: 'sub_123',
    };
    await handleEvent(
      subEvent('customer.subscription.updated', makeSub('active', { priceId: 'price_pro' }))
    );
    expect(state.updates[0].plan).toBe('pro');
    expect(writtenStatus()).toBeUndefined(); // already active, no status thrash
  });

  it('subscription.updated to the VITAL price → plan vital', async () => {
    state.tenantRow = {
      id: 7,
      slug: 'acme',
      status: 'active',
      stripeCustomerId: 'cus_123',
      plan: 'pro',
      stripeSubscriptionId: 'sub_123',
    };
    await handleEvent(
      subEvent('customer.subscription.updated', makeSub('active', { priceId: 'price_vital' }))
    );
    expect(state.updates[0].plan).toBe('vital');
  });
});
