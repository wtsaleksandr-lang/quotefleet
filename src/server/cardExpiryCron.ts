/**
 * Expiring-card sweep — the churn nobody was told about.
 *
 * WHY A SWEEP AND NOT JUST A WEBHOOK
 * ──────────────────────────────────
 * The obvious answer to "warn me before a card expires" is a webhook, and for
 * legacy Card *sources* Stripe does emit one (`customer.source.expiring`, ~30
 * days out — handled in routes/billingRisk.ts). But this product's subscriptions
 * come from Checkout, which stores modern **PaymentMethod** objects, and Stripe
 * emits NO expiring event for those. There is no event to subscribe to.
 *
 * So the only way to see it coming is to LOOK. This job reads the expiry month
 * on each paying customer's default card once a day and opens an `ops_alerts`
 * row for anything expiring inside the warning window. That row is then carried
 * by the daily ops digest until the customer updates the card (attaching a new
 * one, or the network auto-updating it, resolves it — see billingRisk.ts).
 *
 * Without this the whole sequence is reactive: the card expires, the renewal
 * fails, `invoice.payment_failed` fires, dunning starts, and the customer is
 * already past due before anyone knew there was a problem. The point of the
 * sweep is to act in the window BEFORE the failed charge.
 *
 * FAILING LOUDLY
 * ──────────────
 * A sweep that cannot read Stripe reports `failure`, never "0 cards expiring".
 * That distinction is the whole contract (#464): a zero-result success from a
 * broken input is indistinguishable from a healthy quiet day, and it is exactly
 * how the fuel-surcharge job used to report a hardcoded fallback as a refresh.
 *
 * "Stripe is not configured at all" IS a legitimate no-op (`skipped`) — with no
 * Stripe there are no paying customers to check. "Stripe is configured and the
 * call failed" is a `failure`. A customer with no default card is a real answer,
 * not an error, and is skipped quietly.
 *
 * COST: $0. Stripe API reads are not metered, and the sweep is one customer list
 * plus one payment-method read per PAYING customer, once a day.
 */
import Stripe from 'stripe';
import { and, inArray, isNotNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { tenants, directorySubscriptions } from '../db/schema.js';
import { loadEnv } from '../config.js';
import { runTrackedJob, jobSkipped, jobSuccess, jobFailure, type JobOutcome } from './jobHealth.js';
import { upsertOpsAlert, resolveOpsAlert } from './opsAlerts.js';

const TICK_MS = 60 * 60 * 1000; // hourly tick
const STARTUP_DELAY_MS = 4 * 60 * 1000;
/** Sweep once a day at 12:00 UTC — an hour BEFORE the ops digest (13:00 UTC),
 *  so the digest that morning carries the freshly-found cards. */
const SWEEP_HOUR = 12;

/**
 * How far ahead to warn. 45 days spans a full monthly billing cycle plus margin,
 * so a customer is warned while at least one more successful renewal is still
 * possible — warning at 7 days would land after the charge that fails.
 */
export const CARD_EXPIRY_WARN_DAYS = 45;

let started = false;

export function startCardExpiryCron(): void {
  if (started) return;
  if (process.env.CARD_EXPIRY_DISABLED === '1') {
    console.log('[cardExpiry.cron] disabled via CARD_EXPIRY_DISABLED=1');
    return;
  }
  started = true;
  setTimeout(() => void maybeRun('startup'), STARTUP_DELAY_MS);
  setInterval(() => void maybeRun('tick'), TICK_MS);
  console.log(`[cardExpiry.cron] scheduled — hourly tick; daily sweep at ${SWEEP_HOUR}:00 UTC`);
}

/** Hourly tick; the 23 non-slot hours record `skipped` so the job has an hourly
 *  heartbeat for the staleness watchdog (see jobHealthWatchdog.ts). */
async function maybeRun(reason: string): Promise<void> {
  await runTrackedJob('card-expiry-sweep', async () => {
    const now = new Date();
    if (now.getUTCHours() !== SWEEP_HOUR) return jobSkipped(`outside the ${SWEEP_HOUR}:00 UTC sweep hour`);
    return runCardExpirySweepOnce(now, {}, reason);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// The customers to check
// ─────────────────────────────────────────────────────────────────────────────

export interface PayingCustomer {
  stripeCustomerId: string;
  /** Human label for the alert ("Acme Freight (tenant #12)"). */
  label: string;
}

/**
 * Every customer whose next renewal depends on a stored card: SaaS tenants with
 * a live subscription, plus Directory Pro subscribers. Comped rows have no
 * Stripe ids and drop out on the `is not null` filter.
 */
export async function listPayingCustomers(): Promise<PayingCustomer[]> {
  const out = new Map<string, PayingCustomer>();

  const tenantRows = await db()
    .select({ id: tenants.id, name: tenants.name, customerId: tenants.stripeCustomerId })
    .from(tenants)
    .where(and(isNotNull(tenants.stripeCustomerId), isNotNull(tenants.stripeSubscriptionId)));
  for (const t of tenantRows) {
    if (t.customerId) out.set(t.customerId, { stripeCustomerId: t.customerId, label: `${t.name} (tenant #${t.id})` });
  }

  const dirRows = await db()
    .select({ userId: directorySubscriptions.userId, customerId: directorySubscriptions.stripeCustomerId })
    .from(directorySubscriptions)
    .where(
      and(
        isNotNull(directorySubscriptions.stripeCustomerId),
        inArray(directorySubscriptions.status, ['active', 'trialing', 'past_due']),
      ),
    );
  for (const d of dirRows) {
    if (d.customerId && !out.has(d.customerId)) {
      out.set(d.customerId, { stripeCustomerId: d.customerId, label: `Directory Pro (user #${d.userId})` });
    }
  }

  return [...out.values()];
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading one customer's default card
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The three genuinely different answers. `none` is a real finding ("this
 * customer has no card on file"), NOT an error — collapsing the two is how a
 * broken sweep starts looking like a quiet one.
 */
export type CardLookup =
  | { kind: 'card'; expMonth: number; expYear: number; brand: string | null; last4: string | null }
  | { kind: 'none'; reason: string }
  | { kind: 'error'; reason: string };

let stripeClient: Stripe | null = null;
function stripe(): Stripe {
  if (stripeClient) return stripeClient;
  const key = loadEnv().STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
  stripeClient = new Stripe(key);
  return stripeClient;
}

/** Stripe error codes that mean "there is nothing there", as opposed to "we
 *  could not find out" — a deleted customer is data, not an outage. */
function isMissingResource(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 'resource_missing';
}

/** Read the card behind a customer's default payment method. */
export async function lookupDefaultCard(customerId: string): Promise<CardLookup> {
  let defaultPmId: string | null = null;
  try {
    const customer = await stripe().customers.retrieve(customerId);
    if ((customer as { deleted?: boolean }).deleted) return { kind: 'none', reason: 'customer deleted' };
    const settings = (customer as Stripe.Customer).invoice_settings;
    const pm = settings?.default_payment_method;
    if (typeof pm === 'string') defaultPmId = pm;
    else if (pm && typeof pm === 'object' && typeof pm.id === 'string') defaultPmId = pm.id;
  } catch (err) {
    if (isMissingResource(err)) return { kind: 'none', reason: 'customer not found' };
    return { kind: 'error', reason: err instanceof Error ? err.message : String(err) };
  }
  if (!defaultPmId) return { kind: 'none', reason: 'no default payment method' };

  try {
    const pm = await stripe().paymentMethods.retrieve(defaultPmId);
    const card = pm.card;
    if (!card || typeof card.exp_month !== 'number' || typeof card.exp_year !== 'number') {
      return { kind: 'none', reason: 'default payment method is not a card' };
    }
    return {
      kind: 'card',
      expMonth: card.exp_month,
      expYear: card.exp_year,
      brand: card.brand ?? null,
      last4: card.last4 ?? null,
    };
  } catch (err) {
    if (isMissingResource(err)) return { kind: 'none', reason: 'payment method not found' };
    return { kind: 'error', reason: err instanceof Error ? err.message : String(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The decision (pure)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The instant a card stops working: a card is valid THROUGH the last day of its
 * expiry month, so it dies at 00:00 UTC on the first of the next month. PURE.
 */
export function cardExpiresAt(expMonth: number, expYear: number): Date {
  // Date.UTC months are 0-based, so passing the 1-based expMonth as the month
  // index already means "first day of the FOLLOWING month".
  return new Date(Date.UTC(expYear, expMonth, 1));
}

/** Should this card raise an alert now? PURE — an already-expired card is
 *  included (it is the most urgent case, not an excluded past date). */
export function cardNeedsWarning(expiresAt: Date, now: Date, warnDays: number): boolean {
  return expiresAt.getTime() - now.getTime() <= warnDays * 24 * 60 * 60 * 1000;
}

// ─────────────────────────────────────────────────────────────────────────────
// The sweep
// ─────────────────────────────────────────────────────────────────────────────

export interface CardExpiryDeps {
  listCustomers: () => Promise<PayingCustomer[]>;
  lookupCard: (customerId: string) => Promise<CardLookup>;
  upsert: typeof upsertOpsAlert;
  resolve: typeof resolveOpsAlert;
  billingConfigured: () => boolean;
  warnDays: number;
  log: (msg: string) => void;
}

function defaultDeps(): CardExpiryDeps {
  return {
    listCustomers: listPayingCustomers,
    lookupCard: lookupDefaultCard,
    upsert: upsertOpsAlert,
    resolve: resolveOpsAlert,
    billingConfigured: () => !!loadEnv().STRIPE_SECRET_KEY,
    warnDays: CARD_EXPIRY_WARN_DAYS,
    log: (msg) => console.log(msg),
  };
}

/**
 * One sweep. Opens an alert per expiring/expired card, resolves the alert for a
 * customer whose card is now healthy, and reports `failure` if ANY lookup could
 * not be completed — a partially-blind sweep must not read as a clean one.
 */
export async function runCardExpirySweepOnce(
  now: Date,
  overrides: Partial<CardExpiryDeps> = {},
  reason = 'sweep',
): Promise<JobOutcome> {
  const deps: CardExpiryDeps = { ...defaultDeps(), ...overrides };

  if (!deps.billingConfigured()) {
    // No Stripe ⇒ no paying customers ⇒ genuinely nothing to check. Healthy.
    return jobSkipped('billing not configured — no Stripe customers to sweep');
  }

  const customers = await deps.listCustomers();
  if (customers.length === 0) return jobSkipped('no paying customers with a stored card');

  let warned = 0;
  let healthy = 0;
  let noCard = 0;
  const errors: string[] = [];

  for (const c of customers) {
    const lookup = await deps.lookupCard(c.stripeCustomerId);
    if (lookup.kind === 'error') {
      errors.push(`${c.label}: ${lookup.reason}`);
      continue;
    }
    if (lookup.kind === 'none') {
      noCard++;
      continue;
    }
    const expiresAt = cardExpiresAt(lookup.expMonth, lookup.expYear);
    const card = `${lookup.brand ?? 'card'} ••${lookup.last4 ?? '????'}`;
    const mmyy = `${String(lookup.expMonth).padStart(2, '0')}/${lookup.expYear}`;
    if (cardNeedsWarning(expiresAt, now, deps.warnDays)) {
      const expired = expiresAt.getTime() <= now.getTime();
      await deps.upsert({
        kind: 'card_problem',
        ref: c.stripeCustomerId,
        status: 'open',
        title: `${expired ? 'Card EXPIRED' : 'Card expiring'} — ${c.label}`,
        detail:
          `${card} expires ${mmyy}. ` +
          (expired
            ? 'The next renewal WILL fail. Ask them to update it before the charge, not after.'
            : 'Renewals fail once it lapses. Dunning only starts AFTER a failed charge — this is the window before that.') +
          ' Reaching out is a customer-relationship call and stays MANUAL.',
        dueAt: expiresAt,
      });
      warned++;
    } else {
      // Healthy card ⇒ any earlier warning (or detached-payment-method alert)
      // for this customer is stale. Clearing it keeps the digest trustworthy.
      await deps.resolve('card_problem', c.stripeCustomerId, `card healthy (expires ${mmyy})`);
      healthy++;
    }
  }

  const summary =
    `${customers.length} customer(s): ${warned} expiring/expired, ${healthy} healthy, ${noCard} with no card on file`;

  if (errors.length > 0) {
    // Loud, not quiet: we could not see part of the picture, so we do NOT get to
    // report a clean sweep. Reported as failure ⇒ ledger row + admin alert, and
    // the job goes stale if it stays broken.
    return jobFailure(
      `card expiry sweep could not read ${errors.length} of ${customers.length} customer(s) from Stripe — ` +
        `${summary}. First error: ${errors[0]}`,
    );
  }

  deps.log(`[cardExpiry.cron] pass=${reason} ${summary}`);
  return warned > 0
    ? jobSuccess(warned, `${warned} card(s) expiring within ${deps.warnDays} days — ${summary}`)
    : jobSkipped(`no card expiring within ${deps.warnDays} days — ${summary}`);
}

/** The ledger key for this job. MUST match the JOB_REGISTRY entry in
 *  jobHealthWatchdog.ts, or the sweep is never checked for staleness. */
export const CARD_EXPIRY_JOB = 'card-expiry-sweep';
