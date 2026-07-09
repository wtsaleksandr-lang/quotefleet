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
import { tenants, type Tenant } from '../../db/schema.js';
import { requireAuth, requireTenant } from '../middleware.js';
import { loadEnv } from '../../config.js';
import {
  type PaidPlanId,
  planForPriceId,
  priceIdForPlan,
  parsePaidPlan,
  PLAN_PRICES_USD,
  TRIAL_DAYS,
} from '../plans.js';

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

/** Apply a subscription's state to the tenant row (plan, ids, dates).
 *  trialing/active → the tier from its Price; anything else → 'free'. */
async function applySubscription(sub: Stripe.Subscription): Promise<void> {
  const customerId = String(sub.customer);
  const t = (
    await db().select().from(tenants).where(eq(tenants.stripeCustomerId, customerId)).limit(1)
  )[0];
  if (!t) {
    console.warn('[billing.webhook] no tenant for customer', customerId);
    return;
  }
  const live = sub.status === 'active' || sub.status === 'trialing';
  const plan = live ? planFromSubscription(sub) : 'free';
  const cpeUnix = (sub as unknown as { current_period_end?: number }).current_period_end;
  const periodEnd = typeof cpeUnix === 'number' ? new Date(cpeUnix * 1000) : null;
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
      stripeSubscriptionId: live ? sub.id : null,
      subscriptionEndsAt: periodEnd,
      ...(trialEnd ? { trialEndsAt: trialEnd } : {}),
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, t.id));
  console.log(`[billing.webhook] tenant ${t.slug} → ${plan} (sub ${sub.status})`);
}

async function handleEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const subscriptionId = session.subscription != null ? String(session.subscription) : null;
      if (!subscriptionId) return;
      // Retrieve the subscription so we can map its Price → tier. This also
      // covers the case where subscription.created hasn't arrived yet.
      const sub = await stripe().subscriptions.retrieve(subscriptionId);
      await applySubscription(sub);
      return;
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.created': {
      await applySubscription(event.data.object as Stripe.Subscription);
      return;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = String(sub.customer);
      const t = (
        await db().select().from(tenants).where(eq(tenants.stripeCustomerId, customerId)).limit(1)
      )[0];
      if (!t) return;
      await db()
        .update(tenants)
        .set({ plan: 'free', stripeSubscriptionId: null, updatedAt: new Date() })
        .where(eq(tenants.id, t.id));
      return;
    }
    default:
      // Unhandled — ack 200 so Stripe stops retrying.
      return;
  }
}
