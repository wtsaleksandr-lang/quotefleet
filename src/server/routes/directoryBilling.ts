/**
 * Directory Pro billing routes — the SHIPPER's $19/mo carrier-directory
 * subscription. Entirely separate from the tenant billing in routes/billing.ts:
 *
 *   POST /api/directory/billing/checkout  — open a Stripe Checkout session (auth
 *                                           required; NO requireTenant — the buyer
 *                                           is a tenant-less shipper user).
 *   GET  /api/directory/billing/portal    — Stripe Customer Portal for managing /
 *                                           cancelling the Directory Pro sub.
 *
 * The subscription is confirmed asynchronously by the Stripe webhook, which
 * routes Directory Pro subs to applyDirectorySubscription (upserting
 * `directory_subscriptions` keyed by stripe_customer_id). Nothing here touches
 * `tenants` / `tenants.plan`.
 *
 * Stripe is optional: with STRIPE_SECRET_KEY (or the Directory Pro price) unset,
 * the routes return a friendly 503 "billing not configured".
 */
import type { Express, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import Stripe from 'stripe';
import { db } from '../../db/client.js';
import { directorySubscriptions, type User } from '../../db/schema.js';
import { requireAuth } from '../middleware.js';
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

/** True when Stripe AND the Directory Pro price are configured. */
export function directoryBillingConfigured(): boolean {
  const env = loadEnv();
  return !!env.STRIPE_SECRET_KEY && !!env.STRIPE_PRICE_DIRECTORY_PRO;
}

/**
 * Create (or reuse) the shipper's Stripe Customer and open a Checkout session in
 * SUBSCRIPTION mode for the $19/mo Directory Pro price. The customer id is
 * stamped onto `directory_subscriptions` (creating the row `inactive` if needed)
 * so the webhook can later reconcile status by customer id. Returns the hosted
 * Checkout URL. Throws if Stripe / the Directory Pro price is not configured.
 */
export async function createDirectoryProCheckoutSession(opts: {
  user: Pick<User, 'id' | 'email'>;
}): Promise<{ url: string | null; customerId: string }> {
  const env = loadEnv();
  const price = env.STRIPE_PRICE_DIRECTORY_PRO;
  if (!env.STRIPE_SECRET_KEY || !price) {
    throw new Error('Directory Pro billing is not configured.');
  }
  const { user } = opts;

  // Reuse an existing customer id from the entitlement row, else create one.
  const existing = (
    await db()
      .select()
      .from(directorySubscriptions)
      .where(eq(directorySubscriptions.userId, user.id))
      .limit(1)
  )[0];

  let customerId = existing?.stripeCustomerId ?? null;
  if (!customerId) {
    const customer = await stripe().customers.create({
      email: user.email,
      metadata: { userId: String(user.id), kind: 'directory_pro' },
    });
    customerId = customer.id;
    if (existing) {
      await db()
        .update(directorySubscriptions)
        .set({ stripeCustomerId: customerId, updatedAt: new Date() })
        .where(eq(directorySubscriptions.id, existing.id));
    } else {
      await db()
        .insert(directorySubscriptions)
        .values({ userId: user.id, status: 'inactive', stripeCustomerId: customerId });
    }
  }

  const baseUrl = env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const session = await stripe().checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price, quantity: 1 }],
    // No trial at launch — monthly, cancel anytime.
    subscription_data: {
      metadata: { kind: 'directory_pro', userId: String(user.id) },
    },
    success_url: `${baseUrl}/directory?upgrade=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/directory?upgrade=cancelled`,
    allow_promotion_codes: true,
  });
  return { url: session.url, customerId };
}

export function registerDirectoryBillingRoutes(app: Express) {
  // Authenticated shipper — open a Directory Pro Checkout session. NO
  // requireTenant: the buyer is a tenant-less `shipper` user.
  app.post(
    '/api/directory/billing/checkout',
    requireAuth,
    async (req: Request, res: Response) => {
      if (!directoryBillingConfigured()) {
        return res.status(503).json({ error: 'Directory Pro billing is not configured.' });
      }
      try {
        const { url } = await createDirectoryProCheckoutSession({ user: req.user! });
        return res.json({ url });
      } catch (err) {
        console.error('[directory.billing.checkout] failed:', err);
        return res.status(500).json({ error: 'Could not start checkout. Try again.' });
      }
    }
  );

  // Authenticated shipper — open the Stripe Customer Portal for their sub.
  app.get(
    '/api/directory/billing/portal',
    requireAuth,
    async (req: Request, res: Response) => {
      const env = loadEnv();
      if (!env.STRIPE_SECRET_KEY) {
        return res.status(503).json({ error: 'Billing is not configured.' });
      }
      const sub = (
        await db()
          .select()
          .from(directorySubscriptions)
          .where(eq(directorySubscriptions.userId, req.user!.id))
          .limit(1)
      )[0];
      if (!sub?.stripeCustomerId) {
        return res.status(404).json({ error: 'No Stripe customer yet — subscribe first.' });
      }
      try {
        const portal = await stripe().billingPortal.sessions.create({
          customer: sub.stripeCustomerId,
          return_url: env.PUBLIC_BASE_URL.replace(/\/$/, '') + '/directory',
        });
        return res.json({ url: portal.url });
      } catch (err) {
        console.error('[directory.billing.portal] failed:', err);
        return res.status(500).json({ error: 'Portal unavailable.' });
      }
    }
  );
}
