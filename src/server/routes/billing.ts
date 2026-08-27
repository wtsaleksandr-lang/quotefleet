/**
 * Stripe billing routes.
 *
 *   POST /api/billing/checkout-session   — create a Checkout session
 *                                          for the current tenant.
 *   GET  /api/billing/portal              — Stripe Customer Portal URL
 *                                          for managing the subscription
 *                                          (cancel / change card / etc.).
 *   POST /api/billing/webhook             — Stripe webhook handler.
 *                                          Flips tenants.plan + writes
 *                                          stripeCustomerId/SubId.
 *
 * Stripe is optional. If `STRIPE_SECRET_KEY` is unset, all routes return
 * a friendly "billing not configured" message and the dashboard hides
 * the upgrade button. Lets the app boot fine in dev without a Stripe
 * account.
 *
 * Webhook signature is verified using STRIPE_WEBHOOK_SECRET. The route
 * uses `express.raw()` to access the unparsed body for signature check.
 */
import type { Express, Request, Response } from 'express';
import express from 'express';
import { eq } from 'drizzle-orm';
import Stripe from 'stripe';
import { db } from '../../db/client.js';
import { tenants, auditLog, type Tenant } from '../../db/schema.js';
import { requireAuth, requireTenant } from '../middleware.js';
import { loadEnv } from '../../config.js';
import { BILLING_PAST_DUE_KEY, BILLING_SUSPENDED_KEY } from '../trialGating.js';
import {
  type PaidPlanId,
  type PlanId,
  planForPriceId,
  priceIdForPlan,
  parsePaidPlan,
  PLAN_PRICES_USD,
  TRIAL_DAYS,
} from '../plans.js';
import { isDepositSession, handleDepositCheckoutCompleted } from './depositCharge.js';
import { runReferralFulfillmentForInvoice } from '../affiliate/fulfillment.js';
import { isDirectorySubscription, applyDirectorySubscription } from '../directory/subscription.js';
import { isManifestSubscription, applyManifestSubscription } from '../directory/manifestSubscription.js';
import { isLeadsSubscription, applyLeadsSubscription } from '../directory/leadsSubscription.js';

let stripeClient: Stripe | null = null;
function stripe(): Stripe {
  if (stripeClient) return stripeClient;
  const env = loadEnv();
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error('Stripe is not configured. Set STRIPE_SECRET_KEY in env.');
  }
  stripeClient = new Stripe(env.STRIPE_SECRET_KEY);
  return stripeClient;
}

/** True when Stripe is configured AND at least one paid Price id is set. */
export function billingConfigured(): boolean {
  const env = loadEnv();
  return !!env.STRIPE_SECRET_KEY && !!(env.STRIPE_PRICE_VITAL_MONTHLY || env.STRIPE_PRICE_PRO_MONTHLY);
}

/**
 * Create (or reuse) the tenant's Stripe Customer and open a Checkout
 * session in **subscription mode** for the selected tier, with a 14-day
 * trial and mandatory card collection.
 *
 * `payment_method_collection: 'always'` + `trial_period_days` makes Stripe
 * run a **$0 SetupIntent** to validate + store the card — no charge, no $1
 * hold/refund. The card is billed automatically for the selected tier when
 * the trial ends.
 *
 * Shared by the signup flow (collect card up-front) and the in-app upgrade
 * button. Returns the hosted Checkout URL. Throws if Stripe / the selected
 * tier's Price id is not configured.
 */
export async function createTrialCheckoutSession(opts: {
  tenant: Tenant;
  plan: PaidPlanId;
}): Promise<{ url: string | null; customerId: string }> {
  const env = loadEnv();
  const price = priceIdForPlan(opts.plan);
  if (!env.STRIPE_SECRET_KEY || !price) {
    throw new Error(`Billing is not configured for the "${opts.plan}" plan.`);
  }
  const t = opts.tenant;

  // Reuse existing Stripe Customer or create one.
  let customerId = t.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe().customers.create({
      email: t.contactEmail,
      name: t.name,
      metadata: { tenantId: String(t.id), slug: t.slug },
    });
    customerId = customer.id;
    await db()
      .update(tenants)
      .set({ stripeCustomerId: customerId, updatedAt: new Date() })
      .where(eq(tenants.id, t.id));
  }

  const baseUrl = env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const session = await stripe().checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price, quantity: 1 }],
    // Card required even though the trial charges nothing today — Stripe
    // validates it with a $0 SetupIntent and stores it for auto-conversion.
    payment_method_collection: 'always',
    subscription_data: {
      trial_period_days: TRIAL_DAYS,
      metadata: { tenantId: String(t.id), slug: t.slug, selectedPlan: opts.plan },
    },
    success_url: `${baseUrl}/app?upgrade=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/app?upgrade=cancelled`,
    allow_promotion_codes: true,
  });
  return { url: session.url, customerId };
}

/** Webhook ONLY — mounted BEFORE the global JSON parser so the raw body
 *  is still intact for Stripe signature verification. Call this once
 *  early in createApp(). */
export function registerStripeWebhook(app: Express) {
  app.post(
    '/api/billing/webhook',
    express.raw({ type: 'application/json' }),
    async (req: Request, res: Response) => {
      const env = loadEnv();
      if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) {
        return res.status(503).end();
      }
      const sig = req.headers['stripe-signature'];
      if (typeof sig !== 'string') return res.status(400).end();

      let event: Stripe.Event;
      try {
        event = stripe().webhooks.constructEvent(req.body as Buffer, sig, env.STRIPE_WEBHOOK_SECRET);
      } catch (err) {
        console.warn('[billing.webhook] signature verify failed:', err);
        return res.status(400).end();
      }

      try {
        await handleEvent(event);
      } catch (err) {
        console.error('[billing.webhook] handler failed:', err);
        return res.status(500).end();
      }
      res.json({ received: true });
    }
  );
}

export function registerBillingRoutes(app: Express) {
  // Public: check whether billing is configured (so the UI hides
  // upgrade CTAs in dev / unconfigured deployments).
  app.get('/api/billing/status', (_req, res) => {
    const env = loadEnv();
    res.json({
      configured: billingConfigured(),
      publishableKey: env.STRIPE_PUBLISHABLE_KEY ?? null,
      vitalPriceId: env.STRIPE_PRICE_VITAL_MONTHLY ?? null,
      proPriceId: env.STRIPE_PRICE_PRO_MONTHLY ?? null,
      prices: PLAN_PRICES_USD,
      trialDays: TRIAL_DAYS,
    });
  });

  // Authenticated: create a Stripe Checkout session for this tenant.
  app.post(
    '/api/billing/checkout-session',
    requireAuth,
    requireTenant,
    async (req: Request, res: Response) => {
      const plan = parsePaidPlan(req.body?.plan);
      if (!priceIdForPlan(plan)) {
        return res.status(503).json({ error: `Billing is not configured for the "${plan}" plan.` });
      }
      try {
        const { url } = await createTrialCheckoutSession({ tenant: req.tenant!, plan });
        return res.json({ url });
      } catch (err) {
        console.error('[billing.checkout-session] failed:', err);
        return res.status(500).json({ error: 'Could not start checkout. Try again.' });
      }
    }
  );

  // Authenticated: open the Customer Portal for the tenant.
  app.get(
    '/api/billing/portal',
    requireAuth,
    requireTenant,
    async (req: Request, res: Response) => {
      const env = loadEnv();
      if (!env.STRIPE_SECRET_KEY) return res.status(503).json({ error: 'Billing is not configured.' });
      const t = req.tenant!;
      if (!t.stripeCustomerId) {
        return res.status(404).json({ error: 'No Stripe customer yet — start a checkout first.' });
      }
      try {
        const portal = await stripe().billingPortal.sessions.create({
          customer: t.stripeCustomerId,
          return_url: env.PUBLIC_BASE_URL.replace(/\/$/, '') + '/app',
        });
        return res.json({ url: portal.url });
      } catch (err) {
        console.error('[billing.portal] failed:', err);
        return res.status(500).json({ error: 'Portal unavailable.' });
      }
    }
  );

  // Webhook is registered separately, BEFORE the global JSON body
  // parser (see registerStripeWebhook above + createApp).
}

/** Which paid tier a subscription represents — mapped from its Price id,
 *  falling back to the `selectedPlan` metadata we stamp at checkout, then
 *  to Vital (the cheaper, safer default). */
function planFromSubscription(sub: Stripe.Subscription): PaidPlanId {
  const priceId = sub.items?.data?.[0]?.price?.id;
  const byPrice = planForPriceId(priceId);
  if (byPrice) return byPrice;
  const meta = sub.metadata?.selectedPlan;
  return parsePaidPlan(meta);
}

/**
 * Stripe subscription statuses where the tenant is fully live and paying
 * (or in the all-inclusive trial). Access + billed tier apply.
 */
const LIVE_STATUSES: ReadonlySet<Stripe.Subscription.Status> = new Set(['active', 'trialing']);

/**
 * GRACE statuses — Stripe is still retrying / completing the payment, NOT a
 * terminal cancellation. `past_due` = an auto-renewal charge failed and
 * Stripe's smart-retry dunning is running (days, per the retry schedule);
 * `incomplete` = the very first payment hasn't confirmed yet. In BOTH we
 * KEEP the paid plan AND keep `stripeSubscriptionId` — nuking access on the
 * first failed renewal is wrong, and dropping the sub id destroys the
 * reference needed to recover the customer. Access continues until Stripe
 * reaches a terminal state (→ `canceled`/`unpaid`/`incomplete_expired`).
 */
const GRACE_STATUSES: ReadonlySet<Stripe.Subscription.Status> = new Set(['past_due', 'incomplete']);

export type BillingHealth = 'active' | 'grace' | 'inactive';

export interface SubscriptionPlanState {
  /** Plan to store on the tenant row. */
  plan: PlanId;
  /** Whether to KEEP the stripeSubscriptionId. True while live OR in grace
   *  (so a past_due sub can be recovered); false ONLY in terminal states. */
  keepSubscriptionId: boolean;
  /** Coarse billing health, for surfacing an "update your card" nudge. */
  health: BillingHealth;
}

/**
 * Map a Stripe subscription's status → what the tenant row should become.
 * Pure + exported so the mapping is unit-testable in isolation.
 *
 *   status                          plan        subId    health
 *   ─────────────────────────────   ─────────   ──────   ────────
 *   active, trialing                paid tier   keep     active
 *   past_due, incomplete (GRACE)    paid tier   keep     grace
 *   canceled, unpaid,               free        drop     inactive
 *     incomplete_expired, paused,
 *     (any other terminal)
 */
export function deriveSubscriptionState(sub: Stripe.Subscription): SubscriptionPlanState {
  if (LIVE_STATUSES.has(sub.status)) {
    return { plan: planFromSubscription(sub), keepSubscriptionId: true, health: 'active' };
  }
  if (GRACE_STATUSES.has(sub.status)) {
    // Payment failed / not yet confirmed — Stripe is retrying. Keep the paid
    // plan and the sub id; access continues through the dunning window.
    return { plan: planFromSubscription(sub), keepSubscriptionId: true, health: 'grace' };
  }
  // Terminal: canceled, unpaid, incomplete_expired, paused → downgrade.
  return { plan: 'free', keepSubscriptionId: false, health: 'inactive' };
}

/** Best-effort audit write for billing lifecycle events. Never throws — a
 *  failed audit is logged, not propagated, so it can't 500 the webhook. */
async function recordBillingAudit(
  tenantId: number,
  action: string,
  details: Record<string, unknown>
): Promise<void> {
  try {
    await db().insert(auditLog).values({
      tenantId,
      userId: null,
      action,
      actorKind: 'system',
      detailsJson: details,
    });
  } catch (err) {
    console.error('[billing.webhook] audit write failed:', err);
  }
}

/** Apply a subscription's state to the tenant row (plan, ids, dates).
 *  live/grace → keep the paid tier + sub id; terminal → 'free' + drop id.
 *  See deriveSubscriptionState for the full status→plan table. */
export async function applySubscription(sub: Stripe.Subscription): Promise<void> {
  const customerId = String(sub.customer);
  const t = (
    await db().select().from(tenants).where(eq(tenants.stripeCustomerId, customerId)).limit(1)
  )[0];
  if (!t) {
    console.warn('[billing.webhook] no tenant for customer', customerId);
    return;
  }
  const { plan, keepSubscriptionId, health } = deriveSubscriptionState(sub);
  const cpeUnix = (sub as unknown as { current_period_end?: number }).current_period_end;
  const periodEnd = typeof cpeUnix === 'number' ? new Date(cpeUnix * 1000) : null;
  // Persist / clear the "payment failed — update your card" marker in the
  // open-typed lifecycle jsonb (no migration). Set on entry to grace, cleared
  // on return to active (and on any terminal downgrade). Only touch the jsonb
  // when it actually changes, to avoid clobbering concurrent lifecycle writes.
  const lifecycle = { ...(t.lifecycleEmailsJson ?? {}) };
  const hadMarker = !!lifecycle[BILLING_PAST_DUE_KEY];
  let lifecycleChanged = false;
  if (health === 'grace' && !hadMarker) {
    lifecycle[BILLING_PAST_DUE_KEY] = new Date().toISOString();
    lifecycleChanged = true;
  } else if (health !== 'grace' && hadMarker) {
    delete lifecycle[BILLING_PAST_DUE_KEY];
    lifecycleChanged = true;
  }

  // ── AUTOMATIC ACCESS ENFORCEMENT ────────────────────────────────────────
  // Flip the tenant's lifecycle `status` off the subscription's billing health.
  //   inactive (terminal non-payment) → SUSPEND (public widget 404s).
  //   active/trialing (paying)        → REINSTATE, but ONLY a suspension WE
  //                                     set for billing (marker present).
  //   grace (past_due/incomplete)     → NEVER touch status — the dunning
  //                                     window keeps access (existing behavior).
  // Safeguards: a manual admin suspension (no billing marker) and a 'churned'
  // tenant are NEVER auto-un-suspended. Idempotent — re-derives from the freshly
  // read row, so repeated/out-of-order events converge without thrashing status.
  const hadBillingSuspend = !!lifecycle[BILLING_SUSPENDED_KEY];
  let statusChange: 'suspended' | 'active' | undefined;
  if (health === 'inactive') {
    // Terminal failure (canceled/unpaid/incomplete_expired/deleted). Suspend a
    // live tenant and stamp the billing marker so a later payment can reinstate
    // it. Only transition from 'active': an already-suspended tenant keeps its
    // existing marker (don't relabel a manual suspension as billing), and a
    // 'churned' tenant is left untouched.
    if (t.status === 'active') {
      statusChange = 'suspended';
      lifecycle[BILLING_SUSPENDED_KEY] = new Date().toISOString();
      lifecycleChanged = true;
    }
  } else if (health === 'active') {
    // Payment good again. Auto-reinstate ONLY a billing-driven suspension —
    // never a manual admin suspension (marker absent) and never a churned
    // tenant. Clearing the marker stops the app treating it as billing-locked.
    if (t.status === 'suspended' && hadBillingSuspend) {
      statusChange = 'active';
      delete lifecycle[BILLING_SUSPENDED_KEY];
      lifecycleChanged = true;
    }
  }
  // health === 'grace' → deliberately leaves status as-is.
  // Keep the tenant's trialEndsAt aligned with Stripe's trial so the
  // all-inclusive trial (effectivePlan → pro) begins/ends exactly when
  // Stripe says. Once converted (trial_end null) we leave the stored date
  // in the past — isTrialing() is then false and the billed tier applies.
  const trialEnd =
    typeof sub.trial_end === 'number' && sub.status === 'trialing'
      ? new Date(sub.trial_end * 1000)
      : undefined;
  await db()
    .update(tenants)
    .set({
      plan,
      // Keep the sub id in live AND grace states — only terminal states
      // (keepSubscriptionId === false) clear it. Losing it during a
      // recoverable past_due would strand the customer with no reference.
      stripeSubscriptionId: keepSubscriptionId ? sub.id : null,
      subscriptionEndsAt: periodEnd,
      ...(trialEnd ? { trialEndsAt: trialEnd } : {}),
      ...(statusChange ? { status: statusChange } : {}),
      ...(lifecycleChanged ? { lifecycleEmailsJson: lifecycle } : {}),
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, t.id));
  console.log(
    `[billing.webhook] tenant ${t.slug} → ${plan} (sub ${sub.status}, health ${health}` +
      `${statusChange ? `, status ${statusChange}` : ''})`
  );
  // Record entry into / exit from the dunning grace window so the app can
  // later surface an "update your card" nudge without losing access.
  if (health === 'grace') {
    await recordBillingAudit(t.id, 'billing.subscription_past_due', {
      subscriptionId: sub.id,
      status: sub.status,
      plan,
      currentPeriodEnd: periodEnd ? periodEnd.toISOString() : null,
    });
  }
  // Audit every automatic access change (suspend / reinstate + why).
  if (statusChange === 'suspended') {
    await recordBillingAudit(t.id, 'billing.suspended', {
      subscriptionId: sub.id,
      status: sub.status,
      reason: 'non_payment',
      plan,
    });
  } else if (statusChange === 'active') {
    await recordBillingAudit(t.id, 'billing.reinstated', {
      subscriptionId: sub.id,
      status: sub.status,
      reason: 'payment_recovered',
      plan,
    });
  }
}

/**
 * Route a subscription webhook to the right handler. Directory Pro subscriptions
 * (matched by price id / metadata) upsert the per-USER `directory_subscriptions`
 * table; everything else flows to the existing tenant `applySubscription`. The
 * two are mutually exclusive, so the tenant path stays untouched. Checked BEFORE
 * the tenant path so a directory sub never hits a tenant lookup.
 */
async function routeSubscription(sub: Stripe.Subscription): Promise<void> {
  // Per-USER shipper subs first (own tables), then the tenant path. All are
  // mutually exclusive by price id / metadata kind, so the tenant path stays
  // untouched: Leads Pro, then Manifest Privacy, then Directory Pro.
  if (isLeadsSubscription(sub)) {
    await applyLeadsSubscription(sub);
    return;
  }
  if (isManifestSubscription(sub)) {
    await applyManifestSubscription(sub);
    return;
  }
  if (isDirectorySubscription(sub)) {
    await applyDirectorySubscription(sub);
    return;
  }
  await applySubscription(sub);
}

export async function handleEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'invoice.payment_failed': {
      // A renewal (or first) charge failed. Stripe will keep retrying per the
      // smart-retry schedule and, separately, move the subscription to
      // `past_due` (handled by applySubscription, which KEEPS access). Here we
      // only RECORD the failure so the app can surface "update your card" — we
      // do NOT touch the plan; access is retained during the grace window.
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = invoice.customer != null ? String(invoice.customer) : null;
      if (!customerId) return;
      const t = (
        await db().select().from(tenants).where(eq(tenants.stripeCustomerId, customerId)).limit(1)
      )[0];
      if (!t) {
        console.warn('[billing.webhook] payment_failed: no tenant for customer', customerId);
        return;
      }
      const inv = invoice as unknown as {
        id?: string;
        subscription?: string | { id?: string } | null;
        attempt_count?: number;
        next_payment_attempt?: number | null;
        amount_due?: number;
        currency?: string;
      };
      const subscriptionId =
        typeof inv.subscription === 'string' ? inv.subscription : inv.subscription?.id ?? null;
      const nextAttempt =
        typeof inv.next_payment_attempt === 'number'
          ? new Date(inv.next_payment_attempt * 1000).toISOString()
          : null;
      await recordBillingAudit(t.id, 'billing.payment_failed', {
        invoiceId: inv.id ?? null,
        subscriptionId,
        attemptCount: inv.attempt_count ?? null,
        nextPaymentAttempt: nextAttempt,
        amountDue: inv.amount_due ?? null,
        currency: inv.currency ?? null,
      });
      // Set the "update your card" marker so the app can nudge the tenant. The
      // paired customer.subscription.updated → past_due also sets it via
      // applySubscription; doing it here too covers the case where this event
      // lands first / alone. Idempotent — only writes if not already marked.
      if (!t.lifecycleEmailsJson?.[BILLING_PAST_DUE_KEY]) {
        await db()
          .update(tenants)
          .set({
            lifecycleEmailsJson: {
              ...(t.lifecycleEmailsJson ?? {}),
              [BILLING_PAST_DUE_KEY]: new Date().toISOString(),
            },
            updatedAt: new Date(),
          })
          .where(eq(tenants.id, t.id));
      }
      console.warn(
        `[billing.webhook] payment_failed for tenant ${t.slug} — access retained during grace (next retry ${nextAttempt ?? 'n/a'})`
      );
      return;
    }
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      // Booking-deposit destination charges (Wave 2b) also complete as
      // checkout.session.completed on the PLATFORM account — reconcile those
      // via the deposit handler, not the subscription flow. Non-deposit,
      // non-subscription sessions fall through and no-op below.
      if (isDepositSession(session)) {
        await handleDepositCheckoutCompleted(session);
        return;
      }
      const subscriptionId = session.subscription != null ? String(session.subscription) : null;
      if (!subscriptionId) return;
      // Retrieve the subscription so we can map its Price → tier. This also
      // covers the case where subscription.created hasn't arrived yet.
      const sub = await stripe().subscriptions.retrieve(subscriptionId);
      await routeSubscription(sub);
      return;
    }
    case 'invoice.paid':
    case 'invoice.payment_succeeded': {
      // A charge SUCCEEDED (trial-end conversion, renewal, or dunning recovery
      // after a past_due). Reconcile off the live subscription: applySubscription
      // clears the past-due marker, restores the paid tier, and — if the tenant
      // was suspended FOR BILLING — auto-reinstates access. Stripe also emits a
      // paired customer.subscription.updated → active; handling both makes
      // recovery order-independent and idempotent. A one-off invoice with no
      // subscription (or an unknown one) no-ops.
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = invoice.customer != null ? String(invoice.customer) : null;
      if (!customerId) return;
      const inv = invoice as unknown as { subscription?: string | { id?: string } | null };
      const subscriptionId =
        typeof inv.subscription === 'string' ? inv.subscription : inv.subscription?.id ?? null;
      if (!subscriptionId) return;
      const sub = await stripe().subscriptions.retrieve(subscriptionId);
      await routeSubscription(sub);
      // Close the referral/affiliate value loop: a REAL paid invoice means the
      // referred tenant converted. Mark conversion, apply the referrer's queued
      // free-month credit, and accrue the affiliate commission — all idempotent
      // under Stripe's at-least-once delivery. Wrapped so it can NEVER break the
      // webhook (it also never throws internally). See affiliate/fulfillment.ts.
      try {
        await runReferralFulfillmentForInvoice(invoice, stripe());
      } catch (err) {
        console.error('[billing.webhook] referral fulfillment failed (non-fatal):', err);
      }
      return;
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.created': {
      await routeSubscription(event.data.object as Stripe.Subscription);
      return;
    }
    case 'customer.subscription.deleted': {
      // Terminal cancellation. Route through the same mapper as every other
      // subscription event so the terminal path (plan → free, drop sub id) AND
      // the automatic suspend-for-non-payment enforcement both apply uniformly.
      await routeSubscription(event.data.object as Stripe.Subscription);
      return;
    }
    default:
      // Unhandled — ack 200 so Stripe stops retrying.
      return;
  }
}
