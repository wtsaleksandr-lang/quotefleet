/**
 * Deposit charge via Stripe Connect — PAYMENTS PR 2 (Wave 2b).
 *
 * A shipper accepts a hosted quote → we collect the carrier's configured
 * booking DEPOSIT with a Stripe **destination charge**: the shipper pays the
 * deposit, the funds route to the carrier's connected account
 * (`transfer_data.destination`), and QuoteFleet keeps a platform fee
 * (`application_fee_amount`). No money touches this module directly — Stripe's
 * hosted Checkout does the charge; here we only build the session + reconcile
 * the webhook.
 *
 * SERVER-AUTHORITATIVE: the caller passes the deposit computed on the server
 * from the stored quotedTotal (features.ts `computeDeposit`) — a client-supplied
 * amount is NEVER trusted. The platform fee is derived here from that deposit.
 *
 * GATING (see `tenantCanCharge`): the charge path runs ONLY when Stripe is
 * configured, the tenant has a Connect account with charges enabled (cached
 * `connectChargesEnabled`), AND a deposit > 0 is configured. Any of those false
 * → the caller keeps the existing intent-only booking_requested flow, so
 * carriers who never connected still receive booking requests exactly as before.
 *
 * The deposit lifecycle is tracked on `leads.meta_json.deposit` (no migration):
 *   { status: 'pending'|'paid', sessionId, amountCents, currency,
 *     applicationFeeAmount, paidAt } — the money source of truth. The webhook
 * (checkout.session.completed, routed from billing.ts) marks it paid,
 * idempotently, and notifies the carrier.
 */
import Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { leads, tenants, type Tenant } from '../../db/schema.js';
import { loadEnv } from '../../config.js';
import { sendEmail } from '../../email/send.js';
import { formatEmailMoney, type QuoteCurrency } from '../../email/templates.js';

/** Default platform fee percent taken from every booking deposit. Overridable
 *  via the PLATFORM_FEE_PCT env var (parsed + range-clamped by
 *  `platformFeePct()`). 2.9% mirrors QuoteFleet's headline take rate. */
export const PLATFORM_FEE_PCT = 2.9;

/** The effective platform fee percent: the env override when it is a finite
 *  0–100 number, else the PLATFORM_FEE_PCT default. A malformed/absent override
 *  can never widen the fee past 100% or invert it negative. */
export function platformFeePct(): number {
  const raw = loadEnv().PLATFORM_FEE_PCT;
  const n = raw == null || raw === '' ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : PLATFORM_FEE_PCT;
}

/**
 * The platform fee in CENTS for a deposit given in cents. Rounded to the
 * nearest cent, floored at 0, and CAPPED at the deposit itself — Stripe rejects
 * an application_fee_amount greater than the charge, and taking more than the
 * shipper paid is never correct. A non-positive/NaN deposit → 0.
 */
export function computePlatformFeeCents(depositCents: number, pct: number = platformFeePct()): number {
  if (!Number.isFinite(depositCents) || depositCents <= 0) return 0;
  // A NaN/negative rate is nonsensical → fall back to the default. An over-100
  // rate is left to the cap below (belt-and-suspenders — the env path already
  // clamps to ≤100 in platformFeePct()).
  const p = Number.isFinite(pct) && pct >= 0 ? pct : PLATFORM_FEE_PCT;
  const fee = Math.round((depositCents * p) / 100);
  return Math.min(Math.max(fee, 0), depositCents);
}

/**
 * Whether the tenant is READY to take a deposit charge (independent of the
 * per-quote amount): Stripe configured, a connected account exists, and its
 * charges are enabled (cached flag). Exposed in the widget config as
 * `booking.chargeReady` so the widget can label its CTA as a payment ahead of
 * submit. Tenant-scoped: only this tenant's own connected account is ever used.
 */
export function tenantChargeReady(tenant: Tenant | null | undefined): boolean {
  return (
    !!loadEnv().STRIPE_SECRET_KEY &&
    !!tenant &&
    !!tenant.stripeConnectAccountId &&
    tenant.connectChargesEnabled === true
  );
}

/**
 * Whether the deposit CHARGE path should run for this tenant + deposit:
 * `tenantChargeReady` AND a positive deposit is configured. False → the caller
 * keeps the intent-only fallback.
 */
export function tenantCanCharge(tenant: Tenant | null | undefined, deposit: number): boolean {
  return (
    tenantChargeReady(tenant) &&
    typeof deposit === 'number' &&
    Number.isFinite(deposit) &&
    deposit > 0
  );
}

let depositStripeClient: Stripe | null = null;
/** Lazily-built Stripe client — same pattern as billing.ts / connect.ts. */
export function depositStripe(): Stripe {
  if (depositStripeClient) return depositStripeClient;
  const env = loadEnv();
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error('Stripe is not configured. Set STRIPE_SECRET_KEY in env.');
  }
  depositStripeClient = new Stripe(env.STRIPE_SECRET_KEY);
  return depositStripeClient;
}

/** What we persist on the lead while a deposit charge is in flight / settled. */
export interface DepositState {
  status: 'pending' | 'paid';
  /** The Checkout session id (idempotency key + reconciliation handle). */
  sessionId: string;
  amountCents: number;
  currency: QuoteCurrency;
  applicationFeeAmount: number;
  paidAt?: string;
  /** The session id the webhook actually settled (== sessionId). */
  paidSessionId?: string;
  paidAmountCents?: number;
}

export interface CreateDepositSessionResult {
  url: string | null;
  sessionId: string;
  amountCents: number;
  applicationFeeAmount: number;
}

/**
 * Create a Stripe Checkout Session (mode `payment`) that charges the shipper the
 * server-computed deposit and routes it to the carrier as a DESTINATION CHARGE
 * with a platform fee. The Stripe client is injected so the money math is
 * unit-testable with a mock. Returns the hosted Checkout URL + the session id
 * and the exact amount/fee (cents) for persistence.
 *
 * success_url / cancel_url bounce back to the hosted quote page carrying a
 * `booking=paid|cancelled` status the widget renders on return. `metadata`
 * (on BOTH the session and the PaymentIntent) carries { refId, tenantId,
 * kind:'deposit' } so the webhook can identify + reconcile deposit sessions.
 */
export async function createDepositCheckoutSession(opts: {
  stripe: Pick<Stripe, 'checkout'>;
  tenant: Tenant;
  refId: string;
  /** Deposit in DOLLARS — already server-computed from the stored quotedTotal. */
  deposit: number;
  currency: QuoteCurrency;
}): Promise<CreateDepositSessionResult> {
  const { stripe, tenant, refId, deposit, currency } = opts;
  const destination = tenant.stripeConnectAccountId;
  if (!destination) throw new Error('Tenant has no connected account.');
  const amountCents = Math.round(deposit * 100);
  if (!(amountCents > 0)) throw new Error('Deposit must be greater than zero.');
  const applicationFeeAmount = computePlatformFeeCents(amountCents);

  const baseUrl = loadEnv().PUBLIC_BASE_URL.replace(/\/$/, '');
  const returnBase = `${baseUrl}/w/${encodeURIComponent(tenant.slug)}?ref=${encodeURIComponent(refId)}`;
  const metadata = { refId, tenantId: String(tenant.id), kind: 'deposit' };

  const session = await (stripe as Stripe).checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: currency.toLowerCase(),
          unit_amount: amountCents,
          product_data: { name: `Booking deposit — quote ${refId}` },
        },
      },
    ],
    payment_intent_data: {
      application_fee_amount: applicationFeeAmount,
      transfer_data: { destination },
      metadata,
    },
    metadata,
    success_url: `${returnBase}&booking=paid&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${returnBase}&booking=cancelled`,
  });

  return { url: session.url, sessionId: session.id, amountCents, applicationFeeAmount };
}

/** True when a completed Checkout session is one of OUR deposit sessions (a
 *  destination-charge payment carrying our metadata) — as opposed to a
 *  subscription checkout (billing.ts) or any other session. */
export function isDepositSession(session: Stripe.Checkout.Session): boolean {
  const md = session.metadata;
  return (
    session.mode === 'payment' &&
    !!md &&
    md.kind === 'deposit' &&
    typeof md.refId === 'string' &&
    md.refId.length > 0
  );
}

/**
 * Reconcile a completed deposit Checkout session: mark the lead's deposit
 * `paid`, record the paid amount + platform fee, and notify the carrier.
 * IDEMPOTENT — a duplicate `checkout.session.completed` for the same session is
 * a no-op (Stripe retries; we key on the session id). Never throws for a
 * missing lead / unknown ref — acks so Stripe stops retrying.
 */
export async function handleDepositCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const refId = session.metadata?.refId;
  if (!refId) return;
  const lead = (await db().select().from(leads).where(eq(leads.refId, refId)).limit(1))[0];
  if (!lead) {
    console.warn('[deposit.webhook] no lead for ref', refId);
    return;
  }
  const meta = { ...((lead.metaJson as Record<string, unknown>) ?? {}) };
  const prior = (meta.deposit as Partial<DepositState> | undefined) ?? {};
  // Idempotency: already settled THIS session → nothing to do.
  if (prior.status === 'paid' && prior.paidSessionId === session.id) return;

  const paidAmountCents =
    typeof session.amount_total === 'number' ? session.amount_total : prior.amountCents ?? null;
  // Fee was fixed at session creation; fall back to a recompute from the paid
  // amount so a fee is always recorded even if the pending state was lost.
  const applicationFeeAmount =
    typeof prior.applicationFeeAmount === 'number'
      ? prior.applicationFeeAmount
      : computePlatformFeeCents(paidAmountCents ?? 0);
  const currency =
    (prior.currency as QuoteCurrency | undefined) ??
    (String(session.currency).toUpperCase() === 'CAD' ? 'CAD' : 'USD');

  meta.deposit = {
    ...prior,
    status: 'paid',
    sessionId: prior.sessionId ?? session.id,
    paidSessionId: session.id,
    amountCents: prior.amountCents ?? paidAmountCents ?? 0,
    paidAmountCents: paidAmountCents ?? 0,
    applicationFeeAmount,
    currency,
    paidAt: new Date().toISOString(),
  } satisfies DepositState;

  await db()
    .update(leads)
    .set({ metaJson: meta as Record<string, unknown>, updatedAt: new Date() })
    .where(eq(leads.id, lead.id));

  // Notify the carrier the deposit landed (best-effort — never fail the webhook).
  try {
    const tenant = (
      await db().select().from(tenants).where(eq(tenants.id, lead.tenantId)).limit(1)
    )[0];
    if (tenant) {
      const cur: QuoteCurrency = currency;
      const paidLabel = formatEmailMoney((paidAmountCents ?? 0) / 100, cur);
      const feeLabel = formatEmailMoney(applicationFeeAmount / 100, cur);
      const net = Math.max(0, (paidAmountCents ?? 0) - applicationFeeAmount);
      const netLabel = formatEmailMoney(net / 100, cur);
      const dashUrl = `${loadEnv().PUBLIC_BASE_URL.replace(/\/$/, '')}/app/leads/${refId}`;
      const lines = [
        `${lead.customerName || 'A customer'} paid the booking deposit for quote ${refId}.`,
        `Deposit paid: ${paidLabel}`,
        `Platform fee: ${feeLabel}`,
        `Net to you: ${netLabel}`,
        `Lane: ${lead.pickupCity ?? '?'} → ${lead.deliveryCity ?? '?'}`,
        `\nOpen in dashboard: ${dashUrl}`,
      ];
      const result = await sendEmail({
        to: tenant.contactEmail,
        subject: `💰 Deposit paid — booking confirmed for quote ${refId}`,
        text: lines.join('\n'),
        html:
          `<p><strong>${escapeText(lead.customerName || 'A customer')}</strong> paid the booking deposit for quote ${escapeText(refId)}.</p>` +
          `<ul>` +
          `<li>Deposit paid: <strong>${escapeText(paidLabel)}</strong></li>` +
          `<li>Platform fee: ${escapeText(feeLabel)}</li>` +
          `<li>Net to you: <strong>${escapeText(netLabel)}</strong></li>` +
          `<li>Lane: ${escapeText(lead.pickupCity ?? '?')} → ${escapeText(lead.deliveryCity ?? '?')}</li>` +
          `</ul>` +
          `<p><a href="${escapeText(dashUrl)}">Open in dashboard</a></p>`,
      });
      if (!result.ok) {
        console.error(
          `[deposit.webhook] carrier notification send FAILED (quote ${refId}): ${result.error ?? 'unknown error'}`
        );
      }
    }
  } catch (err) {
    console.warn('[deposit.webhook] notify failed (non-fatal):', err);
  }
  console.log(`[deposit.webhook] deposit paid for lead ${refId} (session ${session.id})`);
}

/** Minimal HTML-attribute/text escaper for the notification email body. */
function escapeText(s: string): string {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (m) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m] as string
  );
}
