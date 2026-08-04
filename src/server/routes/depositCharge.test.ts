/**
 * Deposit charge via Stripe Connect (Wave 2b) — behavioural unit tests.
 *
 * Locks the MONEY MATH + the charge/fallback/webhook BEHAVIOUR with a mocked
 * Stripe client + db (same style as the billing tests):
 *   - the platform fee is 2.9% of the deposit, rounded to cents, floored at 0,
 *     and CAPPED at the deposit; env-overridable via PLATFORM_FEE_PCT
 *   - the charge path is gated on Stripe configured + a Connect-ready carrier +
 *     a positive deposit (tenantCanCharge)
 *   - createDepositCheckoutSession builds a mode:'payment' DESTINATION CHARGE:
 *     server amount, application_fee_amount, transfer_data.destination = the
 *     carrier account, currency from the quote, deposit metadata → checkoutUrl
 *   - the webhook marks the lead deposit paid, records the fee, is idempotent
 *     (dup event no-ops), and only fires for deposit sessions
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Tenant } from '../../db/schema.js';
import { leads } from '../../db/schema.js';

// ── mocked env (loadEnv) — swappable per test ──────────────────────────────
let mockEnv: Record<string, unknown> = {};
vi.mock('../../config.js', () => ({ loadEnv: () => mockEnv }));

// ── mocked db — swappable per test; captures the lead update payload ────────
let currentDb: unknown;
const captured: { leadUpdate: Record<string, unknown> | null } = { leadUpdate: null };
vi.mock('../../db/client.js', () => ({ db: () => currentDb }));

// ── mocked carrier email ────────────────────────────────────────────────────
const sendEmailMock = vi.fn(async (..._a: unknown[]) => ({ ok: true as const }));
vi.mock('../../email/send.js', () => ({ sendEmail: (...a: unknown[]) => sendEmailMock(...a) }));

import {
  PLATFORM_FEE_PCT,
  platformFeePct,
  computePlatformFeeCents,
  tenantCanCharge,
  createDepositCheckoutSession,
  isDepositSession,
  handleDepositCheckoutCompleted,
} from './depositCharge.js';

const carrier: Tenant = {
  id: 7,
  slug: 'harbor-link',
  hostDomain: 'quotefleet.net',
  customDomain: null,
  customDomainVerifiedAt: null,
  name: 'Harbor Link Logistics',
  contactEmail: 'ops@harborlink.test',
  publicContactEmail: null,
  quoteDisclaimer: null,
  contactPhone: null,
  countryFocus: 'US',
  embedToken: 'tok',
  ingestEmailToken: null,
  ingestTrustedSendersJson: [],
  plan: 'pro',
  status: 'active',
  accessMode: 'public',
  fscMode: 'manual',
  trialEndsAt: null,
  marketplaceOptIn: false,
  mcNumber: null,
  dotNumber: null,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  subscriptionEndsAt: null,
  stripeConnectAccountId: 'acct_carrier_123',
  connectDetailsSubmitted: true,
  connectChargesEnabled: true,
  connectPayoutsEnabled: true,
  lifecycleEmailsJson: null,
  lastWeeklyDigestAt: null,
  marketingOptOut: false,
  onboardingJson: null,
  anthropicKeyEncrypted: null,
  dpaAcceptedAt: null,
  dpaVersion: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as Tenant;

/** A db mock whose select→from(leads) yields `leadRow`, from(tenants) yields
 *  `tenantRow`, and whose update captures the set() payload. */
function makeDb(leadRow: unknown, tenantRow: unknown) {
  return {
    select: () => ({
      from: (tbl: unknown) => ({
        where: () => ({
          limit: () =>
            Promise.resolve(tbl === leads ? (leadRow ? [leadRow] : []) : tenantRow ? [tenantRow] : []),
        }),
      }),
    }),
    update: () => ({
      set: (payload: Record<string, unknown>) => ({
        where: () => {
          captured.leadUpdate = payload;
          return Promise.resolve();
        },
      }),
    }),
  };
}

beforeEach(() => {
  mockEnv = {
    STRIPE_SECRET_KEY: 'sk_test_123',
    PUBLIC_BASE_URL: 'https://quotefleet.net',
    PLATFORM_FEE_PCT: undefined,
  };
  currentDb = makeDb(null, null);
  captured.leadUpdate = null;
  sendEmailMock.mockClear();
});

describe('computePlatformFeeCents — 2.9% of the deposit', () => {
  it('default is 2.9%', () => {
    expect(PLATFORM_FEE_PCT).toBe(2.9);
    expect(platformFeePct()).toBe(2.9);
  });

  it('rounds to the nearest cent', () => {
    // $100.00 deposit → 10000c × 2.9% = 290c
    expect(computePlatformFeeCents(10000)).toBe(290);
    // $145.00 deposit → 14500c × 2.9% = 420.5 → 421c (round half up)
    expect(computePlatformFeeCents(14500)).toBe(421);
  });

  it('never negative, never exceeds the deposit, zero/NaN → 0', () => {
    expect(computePlatformFeeCents(0)).toBe(0);
    expect(computePlatformFeeCents(-500)).toBe(0);
    expect(computePlatformFeeCents(NaN)).toBe(0);
    // at 100% the fee equals the deposit — never more
    expect(computePlatformFeeCents(1000, 100)).toBe(1000);
    // an absurd over-100 rate is capped at the deposit
    expect(computePlatformFeeCents(1000, 500)).toBe(1000);
    // a nonsensical negative rate falls back to the 2.9% default
    expect(computePlatformFeeCents(1000, -10)).toBe(29);
  });

  it('honors an env override of the fee percent', () => {
    mockEnv.PLATFORM_FEE_PCT = '5';
    expect(platformFeePct()).toBe(5);
    expect(computePlatformFeeCents(10000)).toBe(500);
    // malformed override falls back to the default
    mockEnv.PLATFORM_FEE_PCT = 'nonsense';
    expect(platformFeePct()).toBe(2.9);
    // out-of-range override falls back to the default
    mockEnv.PLATFORM_FEE_PCT = '250';
    expect(platformFeePct()).toBe(2.9);
  });
});

describe('tenantCanCharge — charge path gating', () => {
  it('true only when Stripe on + Connect-ready + deposit > 0', () => {
    expect(tenantCanCharge(carrier, 50)).toBe(true);
  });

  it('false when Stripe is not configured', () => {
    mockEnv.STRIPE_SECRET_KEY = undefined;
    expect(tenantCanCharge(carrier, 50)).toBe(false);
  });

  it('false when the carrier has no connected account', () => {
    expect(tenantCanCharge({ ...carrier, stripeConnectAccountId: null } as Tenant, 50)).toBe(false);
  });

  it('false when charges are not enabled on the connected account', () => {
    expect(tenantCanCharge({ ...carrier, connectChargesEnabled: false } as Tenant, 50)).toBe(false);
    expect(tenantCanCharge({ ...carrier, connectChargesEnabled: null } as Tenant, 50)).toBe(false);
  });

  it('false when there is no deposit', () => {
    expect(tenantCanCharge(carrier, 0)).toBe(false);
    expect(tenantCanCharge(carrier, -5)).toBe(false);
    expect(tenantCanCharge(null, 50)).toBe(false);
  });
});

describe('createDepositCheckoutSession — destination charge', () => {
  function stripeMock() {
    const create = vi.fn(async (_args: Record<string, unknown>) => ({
      id: 'cs_test_abc',
      url: 'https://checkout.stripe.com/pay/cs_test_abc',
    }));
    return { stripe: { checkout: { sessions: { create } } }, create };
  }

  it('creates a mode:payment session with server amount, fee, destination + currency', async () => {
    const { stripe, create } = stripeMock();
    const res = await createDepositCheckoutSession({
      stripe: stripe as never,
      tenant: carrier,
      refId: 'QF-2026-0042',
      deposit: 145, // dollars
      currency: 'CAD',
    });
    expect(res.url).toBe('https://checkout.stripe.com/pay/cs_test_abc');
    expect(res.sessionId).toBe('cs_test_abc');
    expect(res.amountCents).toBe(14500);
    expect(res.applicationFeeAmount).toBe(421); // 2.9% of 14500, rounded

    const args = create.mock.calls[0][0] as Record<string, unknown>;
    expect(args.mode).toBe('payment');
    const pid = args.payment_intent_data as Record<string, unknown>;
    expect(pid.application_fee_amount).toBe(421);
    expect(pid.transfer_data).toEqual({ destination: 'acct_carrier_123' });
    const lineItem = (args.line_items as Array<Record<string, unknown>>)[0];
    const priceData = lineItem.price_data as Record<string, unknown>;
    expect(priceData.currency).toBe('cad'); // lowercased for Stripe
    expect(priceData.unit_amount).toBe(14500);
    // metadata identifies the deposit session for the webhook
    expect(args.metadata).toMatchObject({ refId: 'QF-2026-0042', tenantId: '7', kind: 'deposit' });
    expect(pid.metadata).toMatchObject({ refId: 'QF-2026-0042', kind: 'deposit' });
    // return urls carry the booking status
    expect(String(args.success_url)).toContain('booking=paid');
    expect(String(args.cancel_url)).toContain('booking=cancelled');
  });

  it('uses the SERVER amount — a different (tampered) client value is never seen', async () => {
    const { stripe, create } = stripeMock();
    // caller always passes the server-computed deposit; there is no client input here
    await createDepositCheckoutSession({
      stripe: stripe as never,
      tenant: carrier,
      refId: 'QF-1',
      deposit: 20,
      currency: 'USD',
    });
    const args = create.mock.calls[0][0] as Record<string, unknown>;
    const priceData = (args.line_items as Array<Record<string, unknown>>)[0].price_data as Record<string, unknown>;
    expect(priceData.unit_amount).toBe(2000);
  });
});

describe('isDepositSession — discriminates our deposit sessions', () => {
  it('true for a payment session with deposit metadata', () => {
    expect(
      isDepositSession({ mode: 'payment', metadata: { kind: 'deposit', refId: 'QF-1' } } as never)
    ).toBe(true);
  });
  it('false for a subscription checkout (billing)', () => {
    expect(isDepositSession({ mode: 'subscription', metadata: {} } as never)).toBe(false);
  });
  it('false for a payment session without deposit metadata', () => {
    expect(isDepositSession({ mode: 'payment', metadata: { kind: 'other' } } as never)).toBe(false);
    expect(isDepositSession({ mode: 'payment' } as never)).toBe(false);
  });
});

describe('handleDepositCheckoutCompleted — reconcile + notify', () => {
  const pendingLead = {
    id: 55,
    refId: 'QF-2026-0042',
    tenantId: 7,
    customerName: 'Dana Shipper',
    pickupCity: 'Newark',
    deliveryCity: 'Boston',
    metaJson: {
      deposit: {
        status: 'pending',
        sessionId: 'cs_test_abc',
        amountCents: 14500,
        currency: 'CAD',
        applicationFeeAmount: 421,
      },
    },
  };
  const session = {
    id: 'cs_test_abc',
    mode: 'payment',
    currency: 'cad',
    amount_total: 14500,
    metadata: { kind: 'deposit', refId: 'QF-2026-0042', tenantId: '7' },
  };

  it('marks the deposit paid, records the fee, and notifies the carrier', async () => {
    currentDb = makeDb(pendingLead, carrier);
    await handleDepositCheckoutCompleted(session as never);
    expect(captured.leadUpdate).not.toBeNull();
    const meta = captured.leadUpdate!.metaJson as { deposit: Record<string, unknown> };
    expect(meta.deposit.status).toBe('paid');
    expect(meta.deposit.paidSessionId).toBe('cs_test_abc');
    expect(meta.deposit.paidAmountCents).toBe(14500);
    expect(meta.deposit.applicationFeeAmount).toBe(421);
    expect(typeof meta.deposit.paidAt).toBe('string');
    // carrier notified
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  it('is idempotent — a duplicate completed event for the same session no-ops', async () => {
    const paidLead = {
      ...pendingLead,
      metaJson: { deposit: { ...pendingLead.metaJson.deposit, status: 'paid', paidSessionId: 'cs_test_abc' } },
    };
    currentDb = makeDb(paidLead, carrier);
    await handleDepositCheckoutCompleted(session as never);
    expect(captured.leadUpdate).toBeNull(); // no write
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('no-ops when the lead for the ref is gone', async () => {
    currentDb = makeDb(null, carrier);
    await handleDepositCheckoutCompleted(session as never);
    expect(captured.leadUpdate).toBeNull();
  });
});
