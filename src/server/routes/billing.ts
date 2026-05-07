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
import { tenants } from '../../db/schema.js';
import { requireAuth, requireTenant } from '../middleware.js';
import { loadEnv } from '../../config.js';

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
      configured: !!env.STRIPE_SECRET_KEY,
      publishableKey: env.STRIPE_PUBLISHABLE_KEY ?? null,
      proPriceId: env.STRIPE_PRICE_PRO_MONTHLY ?? null,
    });
  });

  // Authenticated: create a Stripe Checkout session for this tenant.
  app.post(
    '/api/billing/checkout-session',
    requireAuth,
    requireTenant,
    async (req: Request, res: Response) => {
      const env = loadEnv();
      if (!env.STRIPE_SECRET_KEY || !env.STRIPE_PRICE_PRO_MONTHLY) {
        return res.status(503).json({ error: 'Billing is not configured.' });
      }
      const t = req.tenant!;

      // Reuse existing Stripe Customer or create one.
      let customerId = t.stripeCustomerId;
      try {
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
          line_items: [{ price: env.STRIPE_PRICE_PRO_MONTHLY, quantity: 1 }],
          success_url: `${baseUrl}/app?upgrade=success&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${baseUrl}/app?upgrade=cancelled`,
          allow_promotion_codes: true,
          subscription_data: { metadata: { tenantId: String(t.id), slug: t.slug } },
        });
        return res.json({ url: session.url });
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

async function handleEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const customerId = session.customer != null ? String(session.customer) : null;
      const subscriptionId = session.subscription != null ? String(session.subscription) : null;
      if (!customerId) return;
      // Find the tenant by stored Stripe customer ID.
      const t = (
        await db().select().from(tenants).where(eq(tenants.stripeCustomerId, customerId)).limit(1)
      )[0];
      if (!t) {
        console.warn('[billing.webhook] no tenant for customer', customerId);
        return;
      }
      await db()
        .update(tenants)
        .set({
          plan: 'pro',
          stripeSubscriptionId: subscriptionId,
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, t.id));
      console.log(`[billing.webhook] tenant ${t.slug} upgraded to pro`);
      return;
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.created': {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = String(sub.customer);
      const t = (
        await db().select().from(tenants).where(eq(tenants.stripeCustomerId, customerId)).limit(1)
      )[0];
      if (!t) return;
      // ISO date — current_period_end is unix seconds.
      const cpeUnix = (sub as unknown as { current_period_end?: number }).current_period_end;
      const periodEnd = typeof cpeUnix === 'number' ? new Date(cpeUnix * 1000) : null;
      const plan = sub.status === 'active' || sub.status === 'trialing' ? 'pro' : 'free';
      await db()
        .update(tenants)
        .set({
          plan,
          stripeSubscriptionId: sub.id,
          subscriptionEndsAt: periodEnd,
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, t.id));
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
