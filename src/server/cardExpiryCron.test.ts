/**
 * Expiring-card sweep.
 *
 * THE POINT OF THE JOB: Stripe emits NO webhook when a PaymentMethod is about to
 * expire, so the only way to see it coming is to look. The point of THESE tests
 * is the outcome model — specifically that a sweep which could not read Stripe
 * reports `failure` and never "0 cards expiring", because those two look
 * identical in a ledger and only one of them is safe to ignore.
 *
 * NO STRIPE, NO DB, NO NETWORK — the customer list and the card lookup are both
 * injected.
 */
import { describe, it, expect } from 'vitest';
import {
  cardExpiresAt,
  cardNeedsWarning,
  runCardExpirySweepOnce,
  CARD_EXPIRY_WARN_DAYS,
  type CardExpiryDeps,
  type CardLookup,
  type PayingCustomer,
} from './cardExpiryCron.js';
import type { UpsertOpsAlertInput } from './opsAlerts.js';

const NOW = new Date('2026-06-15T00:00:00.000Z');

interface Captured {
  upserts: UpsertOpsAlertInput[];
  resolves: Array<{ ref: string; outcome: string }>;
}

function deps(
  cap: Captured,
  customers: PayingCustomer[],
  lookup: (id: string) => CardLookup,
  over: Partial<CardExpiryDeps> = {},
): Partial<CardExpiryDeps> {
  return {
    listCustomers: async () => customers,
    lookupCard: async (id) => lookup(id),
    upsert: async (input) => {
      cap.upserts.push(input);
    },
    resolve: async (_kind, ref, outcome) => {
      cap.resolves.push({ ref, outcome });
    },
    billingConfigured: () => true,
    warnDays: CARD_EXPIRY_WARN_DAYS,
    log: () => {},
    ...over,
  };
}

const cust = (id: string): PayingCustomer => ({ stripeCustomerId: id, label: `Acme ${id}` });
const card = (expMonth: number, expYear: number): CardLookup => ({
  kind: 'card',
  expMonth,
  expYear,
  brand: 'visa',
  last4: '4242',
});

function fresh(): Captured {
  return { upserts: [], resolves: [] };
}

describe('cardExpiresAt', () => {
  it('a card lives through the LAST DAY of its expiry month', () => {
    // 08/2026 dies at 00:00 UTC on 2026-09-01 — an off-by-one here would warn a
    // month early (noise) or a month late (useless).
    expect(cardExpiresAt(8, 2026).toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });
  it('rolls the year over in December', () => {
    expect(cardExpiresAt(12, 2026).toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
});

describe('cardNeedsWarning', () => {
  it('warns inside the window and stays quiet outside it', () => {
    const inside = new Date(NOW.getTime() + 10 * 24 * 3600_000);
    const outside = new Date(NOW.getTime() + 100 * 24 * 3600_000);
    expect(cardNeedsWarning(inside, NOW, 45)).toBe(true);
    expect(cardNeedsWarning(outside, NOW, 45)).toBe(false);
  });
  it('an ALREADY-expired card warns — it is the most urgent case, not a past date', () => {
    expect(cardNeedsWarning(new Date('2026-01-01T00:00:00Z'), NOW, 45)).toBe(true);
  });
});

describe('runCardExpirySweepOnce', () => {
  it('skips (healthy) when Stripe is not configured — no Stripe, no paying customers', async () => {
    const cap = fresh();
    const out = await runCardExpirySweepOnce(
      NOW,
      deps(cap, [], () => ({ kind: 'none', reason: 'x' }), { billingConfigured: () => false }),
    );
    expect(out.status).toBe('skipped');
    expect(out.detail).toContain('not configured');
  });

  it('skips when there are no paying customers at all', async () => {
    const cap = fresh();
    const out = await runCardExpirySweepOnce(NOW, deps(cap, [], () => ({ kind: 'none', reason: 'x' })));
    expect(out.status).toBe('skipped');
  });

  it('opens a dated alert for a card expiring inside the window', async () => {
    // 06/2026 dies 2026-07-01 — 16 days out, comfortably inside the 45-day window.
    const cap = fresh();
    const out = await runCardExpirySweepOnce(NOW, deps(cap, [cust('cus_1')], () => card(6, 2026)));
    expect(out.status).toBe('success');
    expect(out.processed).toBe(1);
    expect(cap.upserts).toHaveLength(1);
    expect(cap.upserts[0].kind).toBe('card_problem');
    expect(cap.upserts[0].ref).toBe('cus_1');
    expect(cap.upserts[0].title).toContain('Card expiring');
    expect(cap.upserts[0].dueAt?.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(cap.upserts[0].detail).toContain('MANUAL');
  });

  it('a card expiring just BEYOND the window stays quiet', async () => {
    // 07/2026 dies 2026-08-01 — 47 days out. Warning that early is noise; the
    // boundary is what makes the alert mean "act now".
    const cap = fresh();
    const out = await runCardExpirySweepOnce(NOW, deps(cap, [cust('cus_1')], () => card(7, 2026)));
    expect(out.status).toBe('skipped');
    expect(cap.upserts).toHaveLength(0);
  });

  it('says EXPIRED, not "expiring", once the date has passed', async () => {
    const cap = fresh();
    await runCardExpirySweepOnce(NOW, deps(cap, [cust('cus_1')], () => card(1, 2026)));
    expect(cap.upserts[0].title).toContain('Card EXPIRED');
    expect(cap.upserts[0].detail).toContain('WILL fail');
  });

  it('RESOLVES a standing alert when the card is healthy again', async () => {
    // Otherwise a fixed card sits in the digest forever and the reader learns to
    // skip the whole section.
    const cap = fresh();
    const out = await runCardExpirySweepOnce(NOW, deps(cap, [cust('cus_1')], () => card(11, 2030)));
    expect(out.status).toBe('skipped');
    expect(cap.upserts).toHaveLength(0);
    expect(cap.resolves).toEqual([{ ref: 'cus_1', outcome: 'card healthy (expires 11/2030)' }]);
  });

  it('a customer with no card on file is a real answer, not an error', async () => {
    const cap = fresh();
    const out = await runCardExpirySweepOnce(
      NOW,
      deps(cap, [cust('cus_1')], () => ({ kind: 'none', reason: 'no default payment method' })),
    );
    expect(out.status).toBe('skipped');
    expect(out.detail).toContain('1 with no card on file');
  });

  it('FAILS LOUDLY when a lookup errors — never a zero-result success', async () => {
    // The whole contract: "could not read Stripe" and "nothing is expiring" must
    // not produce the same ledger row, or a broken sweep looks like a quiet one.
    const cap = fresh();
    const out = await runCardExpirySweepOnce(
      NOW,
      deps(cap, [cust('cus_1')], () => ({ kind: 'error', reason: 'connection reset' })),
    );
    expect(out.status).toBe('failure');
    expect(out.detail).toContain('could not read 1 of 1');
    expect(out.detail).toContain('connection reset');
  });

  it('a PARTIAL failure still fails — a half-blind sweep is not a clean one', async () => {
    const cap = fresh();
    const out = await runCardExpirySweepOnce(
      NOW,
      deps(cap, [cust('cus_1'), cust('cus_2')], (id) =>
        id === 'cus_1' ? card(6, 2026) : { kind: 'error', reason: 'timeout' },
      ),
    );
    expect(out.status).toBe('failure');
    // …and the work it DID manage is still recorded, not rolled back.
    expect(cap.upserts).toHaveLength(1);
  });
});
