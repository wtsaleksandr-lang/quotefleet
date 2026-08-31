/**
 * Stripe risk events — disputes and card problems.
 *
 * THE GAP (before this): `handleEvent` routed subscription + invoice events and
 * let `charge.dispute.created` fall through `default:` with a silent 200. A
 * dispute is the one Stripe event with a hard deadline attached, so an acked and
 * discarded one is money lost by default with no notification that anything
 * happened at all.
 *
 * NO NETWORK, NO STRIPE, NO DB: every dependency is injected. Stripe objects are
 * hand-built fixtures — the constraint is that CI must never touch Stripe, and
 * nothing here creates a live object.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Stripe from 'stripe';
import {
  DISPUTE_EVENT_TYPES,
  CARD_EVENT_TYPES,
  isBillingRiskEvent,
  disputeNeedsAction,
  disputeDueAt,
  chargeIdOf,
  disputeDashboardUrl,
  buildDisputeAlertBody,
  customerIdOfCardEvent,
  handleDisputeEvent,
  handleCardEvent,
  handleBillingRiskEvent,
  type BillingRiskDeps,
} from './billingRisk.js';
import { AlertDeduper } from '../cronSafety.js';
import type { UpsertOpsAlertInput } from '../opsAlerts.js';

const NOW = new Date('2026-06-01T00:00:00.000Z');
const DUE = new Date('2026-06-10T00:00:00.000Z');

function makeDispute(over: Partial<Stripe.Dispute> = {}): Stripe.Dispute {
  return {
    id: 'dp_1',
    object: 'dispute',
    amount: 12000,
    currency: 'usd',
    charge: 'ch_1',
    reason: 'fraudulent',
    status: 'needs_response',
    evidence_details: { due_by: Math.floor(DUE.getTime() / 1000) },
    ...over,
  } as unknown as Stripe.Dispute;
}

function makeEvent(type: string, object: unknown, over: Record<string, unknown> = {}): Stripe.Event {
  return {
    id: 'evt_1',
    type,
    livemode: true,
    data: { object, ...(over.previous_attributes ? { previous_attributes: over.previous_attributes } : {}) },
    ...over,
  } as unknown as Stripe.Event;
}

interface Captured {
  upserts: UpsertOpsAlertInput[];
  resolves: Array<{ kind: string; ref: string; outcome: string }>;
  alerts: Array<{ subject: string; body: string }>;
}

function deps(cap: Captured, over: Partial<BillingRiskDeps> = {}): Partial<BillingRiskDeps> {
  return {
    upsert: async (input) => {
      cap.upserts.push(input);
    },
    resolve: async (kind, ref, outcome) => {
      cap.resolves.push({ kind, ref, outcome });
    },
    sendAlert: async (subject, body) => {
      cap.alerts.push({ subject, body });
    },
    deduper: new AlertDeduper(),
    cooldownMs: 60_000,
    now: () => NOW.getTime(),
    log: () => {},
    customerForCharge: async () => 'cus_9',
    describeCustomer: async (id) => `Acme (tenant #3) — ${id}`,
    ...over,
  };
}

function fresh(): Captured {
  return { upserts: [], resolves: [], alerts: [] };
}

describe('event ownership', () => {
  it('claims every dispute + card event and nothing else', () => {
    for (const t of [...DISPUTE_EVENT_TYPES, ...CARD_EVENT_TYPES]) {
      expect(isBillingRiskEvent(t), t).toBe(true);
    }
    for (const t of ['invoice.paid', 'customer.subscription.updated', 'checkout.session.completed']) {
      expect(isBillingRiskEvent(t), t).toBe(false);
    }
  });

  it('covers charge.dispute.created — the event that used to be silently acked', () => {
    expect(DISPUTE_EVENT_TYPES).toContain('charge.dispute.created');
  });
});

describe('disputeNeedsAction — derived from the DISPUTE, not the event name', () => {
  it('an open case needs action', () => {
    for (const s of ['needs_response', 'warning_needs_response', 'under_review', 'warning_under_review']) {
      expect(disputeNeedsAction(s), s).toBe(true);
    }
  });
  it('a finished case does not', () => {
    for (const s of ['won', 'lost', 'warning_closed', 'charge_refunded']) {
      expect(disputeNeedsAction(s), s).toBe(false);
    }
  });
});

describe('extraction', () => {
  it('reads the evidence deadline as a real date', () => {
    expect(disputeDueAt(makeDispute())?.toISOString()).toBe(DUE.toISOString());
  });
  it('is null when Stripe supplies no deadline', () => {
    expect(disputeDueAt(makeDispute({ evidence_details: undefined as never }))).toBeNull();
  });
  it('reads the charge id whether Stripe sends an id or an expanded object', () => {
    expect(chargeIdOf(makeDispute())).toBe('ch_1');
    expect(chargeIdOf(makeDispute({ charge: { id: 'ch_2' } as never }))).toBe('ch_2');
    expect(chargeIdOf(makeDispute({ charge: null as never }))).toBeNull();
  });
  it('links to the right Stripe mode', () => {
    expect(disputeDashboardUrl('dp_1', true)).toBe('https://dashboard.stripe.com/disputes/dp_1');
    expect(disputeDashboardUrl('dp_1', false)).toBe('https://dashboard.stripe.com/test/disputes/dp_1');
  });
});

describe('buildDisputeAlertBody', () => {
  const body = buildDisputeAlertBody({
    dispute: makeDispute(),
    who: 'Acme (tenant #3)',
    dueAt: DUE,
    livemode: true,
  });

  it('carries everything needed to act without opening the code', () => {
    expect(body).toContain('$120.00');
    expect(body).toContain('Acme (tenant #3)');
    expect(body).toContain('fraudulent');
    expect(body).toContain('ch_1');
    expect(body).toContain(DUE.toISOString());
    expect(body).toContain('https://dashboard.stripe.com/disputes/dp_1');
  });

  it('states plainly that evidence submission stays MANUAL', () => {
    expect(body).toContain('MANUAL');
  });

  it('says so loudly when Stripe gave no deadline, rather than omitting the line', () => {
    const noDue = buildDisputeAlertBody({
      dispute: makeDispute({ evidence_details: undefined as never }),
      who: 'x',
      dueAt: null,
      livemode: true,
    });
    expect(noDue).toContain('not supplied by Stripe');
  });
});

describe('handleDisputeEvent', () => {
  let cap: Captured;
  beforeEach(() => {
    cap = fresh();
  });

  it('records an OPEN alert with the deadline and emails immediately', async () => {
    await handleDisputeEvent(makeEvent('charge.dispute.created', makeDispute()), deps(cap));
    expect(cap.upserts).toHaveLength(1);
    const a = cap.upserts[0];
    expect(a.kind).toBe('stripe_dispute');
    expect(a.ref).toBe('dp_1');
    expect(a.status).toBe('open');
    expect(a.amountCents).toBe(12000);
    expect(a.dueAt?.toISOString()).toBe(DUE.toISOString());
    expect(a.title).toContain('Acme (tenant #3)');
    expect(cap.alerts).toHaveLength(1);
    expect(cap.alerts[0].subject).toContain('[URGENT]');
  });

  it('a re-delivered webhook re-records but does NOT re-email', async () => {
    const d = deps(cap);
    await handleDisputeEvent(makeEvent('charge.dispute.created', makeDispute()), d);
    await handleDisputeEvent(makeEvent('charge.dispute.created', makeDispute()), d);
    expect(cap.upserts).toHaveLength(2); // idempotent upsert on (kind, ref)
    expect(cap.alerts).toHaveLength(1); // de-duped per dispute id
  });

  it('a CLOSED dispute records as resolved and does not alert', async () => {
    await handleDisputeEvent(
      makeEvent('charge.dispute.closed', makeDispute({ status: 'won' })),
      deps(cap),
    );
    expect(cap.upserts[0].status).toBe('resolved');
    expect(cap.alerts).toHaveLength(0);
  });

  it('a late `updated` after a close cannot re-open the case', async () => {
    // Status drives the decision, not the event name — so out-of-order delivery
    // (which Stripe explicitly does not rule out) converges, never flip-flops.
    await handleDisputeEvent(
      makeEvent('charge.dispute.updated', makeDispute({ status: 'lost' })),
      deps(cap),
    );
    expect(cap.upserts[0].status).toBe('resolved');
  });

  it('still records the dispute when the customer lookup fails', async () => {
    await handleDisputeEvent(
      makeEvent('charge.dispute.created', makeDispute()),
      deps(cap, {
        customerForCharge: async () => {
          throw new Error('stripe unreachable');
        },
      }),
    );
    expect(cap.upserts).toHaveLength(1);
    expect(cap.upserts[0].status).toBe('open');
  });

  it('PROPAGATES a failed alert write so the webhook 500s and Stripe retries', async () => {
    // The one thing that must never be swallowed: acking an event we did not
    // record loses the dispute entirely, and Stripe will not send it again.
    await expect(
      handleDisputeEvent(
        makeEvent('charge.dispute.created', makeDispute()),
        deps(cap, {
          upsert: async () => {
            throw new Error('db down');
          },
        }),
      ),
    ).rejects.toThrow('db down');
  });

  it('a failed alert EMAIL does not undo the recorded row', async () => {
    await expect(
      handleDisputeEvent(
        makeEvent('charge.dispute.created', makeDispute()),
        deps(cap, {
          sendAlert: async () => {
            throw new Error('smtp down');
          },
        }),
      ),
    ).resolves.toBeUndefined();
    expect(cap.upserts).toHaveLength(1);
  });
});

describe('handleCardEvent', () => {
  let cap: Captured;
  beforeEach(() => {
    cap = fresh();
  });

  it('an expiring card opens an alert keyed by CUSTOMER', async () => {
    await handleCardEvent(
      makeEvent('customer.source.expiring', { customer: 'cus_9', object: 'card' }),
      deps(cap),
    );
    expect(cap.upserts).toHaveLength(1);
    expect(cap.upserts[0].kind).toBe('card_problem');
    expect(cap.upserts[0].ref).toBe('cus_9');
    expect(cap.upserts[0].status).toBe('open');
    expect(cap.upserts[0].detail).toContain('before that');
  });

  it('attaching a card RESOLVES the problem instead of stacking another alert', async () => {
    await handleCardEvent(
      makeEvent('payment_method.attached', { customer: 'cus_9', object: 'payment_method' }),
      deps(cap),
    );
    expect(cap.upserts).toHaveLength(0);
    expect(cap.resolves).toEqual([
      { kind: 'card_problem', ref: 'cus_9', outcome: 'resolved by payment_method.attached' },
    ]);
  });

  it('a network auto-update also resolves it', async () => {
    await handleCardEvent(
      makeEvent('payment_method.automatically_updated', { customer: 'cus_9' }),
      deps(cap),
    );
    expect(cap.resolves).toHaveLength(1);
  });

  it('a detach reads the customer from previous_attributes (the object is already null)', async () => {
    await handleCardEvent(
      makeEvent(
        'payment_method.detached',
        { customer: null, object: 'payment_method' },
        { previous_attributes: { customer: 'cus_42' } },
      ),
      deps(cap),
    );
    expect(cap.upserts[0].ref).toBe('cus_42');
    expect(cap.upserts[0].title).toContain('Payment method removed');
  });

  it('records NOTHING when no customer can be attributed, instead of a nameless row', async () => {
    const log = vi.fn();
    await handleCardEvent(makeEvent('payment_method.detached', {}), deps(cap, { log }));
    expect(cap.upserts).toHaveLength(0);
    expect(log).toHaveBeenCalled();
  });
});

describe('customerIdOfCardEvent', () => {
  it('prefers the object, falls back to previous_attributes, else null', () => {
    expect(customerIdOfCardEvent(makeEvent('x', { customer: 'cus_1' }))).toBe('cus_1');
    expect(customerIdOfCardEvent(makeEvent('x', { customer: { id: 'cus_2' } }))).toBe('cus_2');
    expect(
      customerIdOfCardEvent(makeEvent('x', {}, { previous_attributes: { customer: 'cus_3' } })),
    ).toBe('cus_3');
    expect(customerIdOfCardEvent(makeEvent('x', {}))).toBeNull();
  });
});

describe('handleBillingRiskEvent routing', () => {
  it('returns false for an event it does not own, so the caller can fall through', async () => {
    const cap = fresh();
    expect(await handleBillingRiskEvent(makeEvent('invoice.paid', {}), deps(cap))).toBe(false);
    expect(cap.upserts).toHaveLength(0);
  });

  it('routes disputes and card events to their handlers', async () => {
    const cap = fresh();
    expect(
      await handleBillingRiskEvent(makeEvent('charge.dispute.created', makeDispute()), deps(cap)),
    ).toBe(true);
    expect(
      await handleBillingRiskEvent(makeEvent('customer.source.expiring', { customer: 'cus_9' }), deps(cap)),
    ).toBe(true);
    expect(cap.upserts).toHaveLength(2);
  });
});
