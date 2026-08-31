/**
 * Stripe risk events — disputes and card problems.
 *
 * WHAT WAS MISSING
 * ────────────────
 * `handleEvent` (billing.ts) routed subscription + invoice events and let
 * everything else fall through `default:` with a silent 200. Two whole classes
 * of money event landed there:
 *
 *   • DISPUTES. `charge.dispute.created` was acked and discarded. A dispute is
 *     the only Stripe event with a HARD DEADLINE attached — the card network
 *     gives a fixed window to submit evidence, and an unanswered dispute is lost
 *     by default. Nothing here recorded it, nothing alerted, and nothing would
 *     have noticed the money leaving. The first signal was the balance.
 *   • CARD PROBLEMS. `invoice.payment_failed` already fires when a charge fails,
 *     but by then the customer is already past due. The events that arrive
 *     BEFORE the failure — a card about to expire, a payment method detached —
 *     were unhandled, so the recoverable window was never used.
 *
 * WHAT STAYS HUMAN, AND WHY
 * ─────────────────────────
 * Submitting dispute evidence and issuing refunds are NOT automated here, and
 * deliberately so. Evidence is an argument to a bank about what actually
 * happened — receipts, delivery proof, the customer's usage — and getting it
 * wrong forfeits the money. A refund is money out the door. Both are judgment
 * calls with a counterparty; automating them would be automating the decision,
 * not the remembering.
 *
 * What IS automated is everything up to the decision: the event is captured, the
 * context needed to act is attached (who, how much, why, by when, and the direct
 * dashboard link), an alert goes out immediately, and — because an email that
 * arrives while nobody is looking is the same as no email — the item is written
 * to `ops_alerts` so the daily digest re-lists it EVERY DAY until it is resolved.
 * Missing a dispute now requires ignoring it repeatedly, not merely once.
 *
 * FAILING LOUDLY
 * ──────────────
 * The `ops_alerts` write is NOT best-effort. If it throws, the exception
 * propagates to the webhook route, which returns 500, and Stripe RETRIES the
 * delivery — the event is preserved. Swallowing it would ack an event we did not
 * record, which is the exact "logged a success while doing nothing" failure that
 * #464 exists to prevent. The alert EMAIL, by contrast, is best-effort and sent
 * AFTER the row is durable: losing the email costs a day, losing the row costs
 * the dispute.
 *
 * COST: $0. No new service; the only Stripe call is a best-effort read of the
 * disputed charge to name the customer (free), and it is skipped on failure.
 */
import type Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { tenants } from '../../db/schema.js';
import {
  upsertOpsAlert,
  resolveOpsAlert,
  formatAmount,
  type UpsertOpsAlertInput,
} from '../opsAlerts.js';
import { AlertDeduper, sendCronAlertEmail, CRON_ALERT_COOLDOWN_MS } from '../cronSafety.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1. WHICH EVENTS THIS OWNS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dispute lifecycle. All five are handled by one code path that derives state
 * from the dispute object itself rather than from the event name — so a
 * re-delivered or out-of-order event converges on the same answer instead of
 * re-opening something already closed. (Stripe delivers at least once and does
 * not guarantee order.)
 */
export const DISPUTE_EVENT_TYPES: readonly string[] = [
  'charge.dispute.created',
  'charge.dispute.updated',
  'charge.dispute.closed',
  'charge.dispute.funds_withdrawn',
  'charge.dispute.funds_reinstated',
];

/**
 * Payment-method health. `customer.source.expiring` is Stripe's ~30-day warning
 * for legacy card sources; `payment_method.*` covers the modern PaymentMethod
 * objects that Checkout creates. Note there is NO "payment method expiring"
 * webhook for PaymentMethods — that gap is covered by the daily sweep in
 * cardExpiryCron.ts, which is why the two exist together.
 */
export const CARD_EVENT_TYPES: readonly string[] = [
  'customer.source.expiring',
  'payment_method.attached',
  'payment_method.detached',
  'payment_method.automatically_updated',
];

export function isBillingRiskEvent(type: string): boolean {
  return DISPUTE_EVENT_TYPES.includes(type) || CARD_EVENT_TYPES.includes(type);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. PURE EXTRACTION + CLASSIFICATION
// ─────────────────────────────────────────────────────────────────────────────

/** Stripe dispute statuses that mean the case is over — nothing more to submit. */
const CLOSED_DISPUTE_STATUSES: ReadonlySet<string> = new Set([
  'won',
  'lost',
  'warning_closed',
  'charge_refunded',
]);

/**
 * Does this dispute still need a human? PURE.
 *
 * Derived from the dispute's OWN status, never from the event name, so a
 * `charge.dispute.updated` that arrives after `closed` cannot resurrect a
 * finished case and a replayed `created` cannot re-open one either.
 */
export function disputeNeedsAction(status: string): boolean {
  return !CLOSED_DISPUTE_STATUSES.has(status);
}

/** The evidence deadline, when Stripe supplies one. PURE. */
export function disputeDueAt(dispute: Stripe.Dispute): Date | null {
  const due = dispute.evidence_details?.due_by;
  return typeof due === 'number' && due > 0 ? new Date(due * 1000) : null;
}

/** The id of the charge behind a dispute (Stripe sends either id or object). */
export function chargeIdOf(dispute: Stripe.Dispute): string | null {
  const c = dispute.charge as unknown;
  if (typeof c === 'string') return c || null;
  if (c && typeof c === 'object' && typeof (c as { id?: unknown }).id === 'string') {
    return (c as { id: string }).id;
  }
  return null;
}

/** Deep link straight to the case in the right Stripe mode. PURE. */
export function disputeDashboardUrl(disputeId: string, livemode: boolean): string {
  return `https://dashboard.stripe.com/${livemode ? '' : 'test/'}disputes/${disputeId}`;
}

/**
 * Everything a human needs to decide whether to fight this dispute, in the
 * order they need it. PURE so the wording is asserted without a Stripe call.
 */
export function buildDisputeAlertBody(opts: {
  dispute: Stripe.Dispute;
  who: string;
  dueAt: Date | null;
  livemode: boolean;
}): string {
  const { dispute, who, dueAt, livemode } = opts;
  const amount = formatAmount(dispute.amount ?? null, dispute.currency ?? null);
  const lines = [
    `A Stripe dispute was opened${amount ? ` for ${amount}` : ''}.`,
    '',
    `Customer:  ${who}`,
    `Reason:    ${dispute.reason ?? 'unknown'}`,
    `Status:    ${dispute.status ?? 'unknown'}`,
    `Charge:    ${chargeIdOf(dispute) ?? 'unknown'}`,
    `Dispute:   ${dispute.id}`,
    dueAt
      ? `EVIDENCE DUE (UTC): ${dueAt.toISOString()} — after this the dispute is lost by default.`
      : 'EVIDENCE DUE: not supplied by Stripe — open the dashboard link and check the case.',
    '',
    `Act here: ${disputeDashboardUrl(dispute.id, livemode)}`,
    '',
    'Submitting evidence is a judgment call and stays MANUAL — this alert exists so the',
    'deadline is never the thing that decides it. The item is also on the daily ops digest',
    'and will be listed there every day until the dispute is closed.',
  ];
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. DEPENDENCIES (injectable — tests never touch Stripe, the DB or the network)
// ─────────────────────────────────────────────────────────────────────────────

export interface BillingRiskDeps {
  upsert: (input: UpsertOpsAlertInput) => Promise<void>;
  resolve: (kind: 'stripe_dispute' | 'card_problem', ref: string, outcome: string) => Promise<void>;
  sendAlert: (subject: string, body: string) => Promise<void>;
  deduper: AlertDeduper;
  cooldownMs: number;
  now: () => number;
  log: (msg: string) => void;
  /** Best-effort charge → customer id. Never throws into the caller. */
  customerForCharge: (chargeId: string) => Promise<string | null>;
  /** Best-effort customer id → human label. Never throws into the caller. */
  describeCustomer: (customerId: string | null) => Promise<string>;
}

/** De-dupe per dispute id, so a Stripe re-delivery cannot re-send the email. */
export const disputeAlertDeduper = new AlertDeduper();

/** Name the customer from our own tenant table — no Stripe call, no PII beyond
 *  what we already store. Falls back to the raw customer id. */
export async function describeStripeCustomer(customerId: string | null): Promise<string> {
  if (!customerId) return 'unknown (no customer on the charge)';
  try {
    const rows = await db()
      .select({ id: tenants.id, name: tenants.name, slug: tenants.slug })
      .from(tenants)
      .where(eq(tenants.stripeCustomerId, customerId))
      .limit(1);
    const t = rows[0];
    if (t) return `${t.name} (tenant #${t.id}, ${t.slug}) — ${customerId}`;
  } catch {
    // A lookup failure must never cost us the alert; fall through to the id.
  }
  return `${customerId} (no tenant row — directory/one-off customer)`;
}

export function defaultBillingRiskDeps(): BillingRiskDeps {
  return {
    upsert: upsertOpsAlert,
    resolve: resolveOpsAlert,
    sendAlert: sendCronAlertEmail,
    deduper: disputeAlertDeduper,
    cooldownMs: CRON_ALERT_COOLDOWN_MS,
    now: () => Date.now(),
    log: (msg) => console.log(msg),
    // Wired by billing.ts, which owns the Stripe client. Defaults to "unknown"
    // rather than importing the client here (keeps this module Stripe-free).
    customerForCharge: async () => null,
    describeCustomer: describeStripeCustomer,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Record + alert on one dispute event.
 *
 * The `ops_alerts` write intentionally propagates on failure (→ webhook 500 →
 * Stripe retry). The email is best-effort and comes AFTER the durable row.
 */
export async function handleDisputeEvent(
  event: Stripe.Event,
  overrides: Partial<BillingRiskDeps> = {},
): Promise<void> {
  const deps: BillingRiskDeps = { ...defaultBillingRiskDeps(), ...overrides };
  const dispute = event.data.object as Stripe.Dispute;
  const needsAction = disputeNeedsAction(String(dispute.status ?? ''));
  const dueAt = disputeDueAt(dispute);

  // Best-effort attribution. A failure here degrades the alert's wording, never
  // its existence — the dispute id and dashboard link are always enough to act.
  let who = 'unknown';
  try {
    const chargeId = chargeIdOf(dispute);
    const customerId = chargeId ? await deps.customerForCharge(chargeId) : null;
    who = await deps.describeCustomer(customerId);
  } catch (err) {
    deps.log(`[billing.risk] dispute customer lookup failed (non-fatal): ${String(err)}`);
  }

  const amount = formatAmount(dispute.amount ?? null, dispute.currency ?? null);
  const title = `Stripe dispute — ${who}`;
  const detail =
    `reason: ${dispute.reason ?? 'unknown'} · status: ${dispute.status ?? 'unknown'} · ` +
    `charge ${chargeIdOf(dispute) ?? 'unknown'} · ` +
    `${disputeDashboardUrl(dispute.id, event.livemode)} · ` +
    `evidence submission stays MANUAL`;

  // DURABLE FIRST. If this throws, the webhook 500s and Stripe redelivers.
  await deps.upsert({
    kind: 'stripe_dispute',
    ref: dispute.id,
    status: needsAction ? 'open' : 'resolved',
    title,
    detail,
    amountCents: typeof dispute.amount === 'number' ? dispute.amount : null,
    currency: dispute.currency ?? null,
    dueAt,
  });

  if (!needsAction) {
    deps.log(
      `[billing.risk] dispute ${dispute.id} closed (${dispute.status}) — ${amount ?? 'amount unknown'}, ${who}`,
    );
    return;
  }

  deps.log(
    `[billing.risk] DISPUTE OPEN ${dispute.id} — ${amount ?? 'amount unknown'}, ${who}, ` +
      `evidence due ${dueAt ? dueAt.toISOString() : 'unknown'}`,
  );

  // Push alert, de-duped per DISPUTE (not per job): a re-delivered webhook must
  // not re-mail, but a genuinely different dispute always alerts immediately.
  if (!deps.deduper.shouldAlert(`dispute:${dispute.id}`, deps.now(), deps.cooldownMs)) return;
  try {
    await deps.sendAlert(
      `[URGENT] Stripe dispute opened${amount ? ` — ${amount}` : ''}`,
      buildDisputeAlertBody({ dispute, who, dueAt, livemode: event.livemode }),
    );
  } catch (err) {
    // The row is already durable and the daily digest will carry it; an email
    // failure must never turn into a lost webhook (which Stripe would retry
    // forever against an already-recorded dispute).
    deps.log(`[billing.risk] dispute alert email failed (row already recorded): ${String(err)}`);
  }
}

/** Read a customer id off a card/payment-method event, including the
 *  `previous_attributes` fallback that `payment_method.detached` needs (the
 *  object's own `customer` is already null by the time the event fires). */
export function customerIdOfCardEvent(event: Stripe.Event): string | null {
  const obj = event.data.object as { customer?: unknown };
  const direct = obj?.customer;
  if (typeof direct === 'string' && direct) return direct;
  if (direct && typeof direct === 'object' && typeof (direct as { id?: unknown }).id === 'string') {
    return (direct as { id: string }).id;
  }
  const prev = (event.data as { previous_attributes?: { customer?: unknown } }).previous_attributes;
  const prevCustomer = prev?.customer;
  return typeof prevCustomer === 'string' && prevCustomer ? prevCustomer : null;
}

/**
 * Record a payment-method problem, or clear one that has been fixed.
 *
 * The alert is keyed by CUSTOMER (not by payment method) so "this customer's
 * billing is broken" is one item however many cards they cycle through, and
 * attaching a working card resolves it.
 */
export async function handleCardEvent(
  event: Stripe.Event,
  overrides: Partial<BillingRiskDeps> = {},
): Promise<void> {
  const deps: BillingRiskDeps = { ...defaultBillingRiskDeps(), ...overrides };
  const customerId = customerIdOfCardEvent(event);
  if (!customerId) {
    // Nothing to attribute this to. Say so rather than pretending we handled it.
    deps.log(`[billing.risk] ${event.type} carried no customer id — not recorded`);
    return;
  }

  // A card that was ADDED or auto-updated by the network is the problem being
  // FIXED. Resolve rather than accumulate: an unresolved stale warning trains
  // the reader to ignore the digest, which is the failure mode #464 fought.
  if (event.type === 'payment_method.attached' || event.type === 'payment_method.automatically_updated') {
    await deps.resolve('card_problem', customerId, `resolved by ${event.type}`);
    deps.log(`[billing.risk] card problem cleared for ${customerId} (${event.type})`);
    return;
  }

  const who = await deps.describeCustomer(customerId).catch(() => customerId);
  const isExpiring = event.type === 'customer.source.expiring';
  const title = isExpiring ? `Card expiring — ${who}` : `Payment method removed — ${who}`;
  const detail = isExpiring
    ? 'Stripe warns this card expires soon. The next renewal will fail unless the customer updates it. ' +
      'The dunning sequence only starts AFTER a failed charge — this is the window before that.'
    : 'The customer detached a payment method. If it was their only card, the next renewal fails. ' +
      'No action if they replaced it (a new card resolves this automatically).';

  await deps.upsert({
    kind: 'card_problem',
    ref: customerId,
    status: 'open',
    title,
    detail,
  });
  deps.log(`[billing.risk] card problem recorded for ${customerId} (${event.type})`);
}

/** Route one risk event. Returns false when the type is not ours, so the caller
 *  can fall through to its own default. */
export async function handleBillingRiskEvent(
  event: Stripe.Event,
  overrides: Partial<BillingRiskDeps> = {},
): Promise<boolean> {
  if (DISPUTE_EVENT_TYPES.includes(event.type)) {
    await handleDisputeEvent(event, overrides);
    return true;
  }
  if (CARD_EVENT_TYPES.includes(event.type)) {
    await handleCardEvent(event, overrides);
    return true;
  }
  return false;
}
