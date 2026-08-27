/**
 * "Leads Pro" billing routes — the SHIPPER's monthly subscription behind the
 * Importer Search decision-maker CONTACT REVEAL. Cloned from
 * routes/manifestBilling.ts / directoryBilling.ts; entirely separate from tenant
 * billing.
 *
 *   POST /api/importers/billing/checkout  — open a Stripe Checkout session (auth
 *                                           required; NO requireTenant — the buyer
 *                                           is a tenant-less shipper user).
 *   GET  /api/importers/billing/portal    — Stripe Customer Portal for managing /
 *                                           cancelling the Leads Pro subscription.
 *
 * GRACEFUL DEGRADE: STRIPE_PRICE_LEADS_PRO is not set yet. Checkout while the
 * price id is UNSET returns a friendly 503 "coming soon" (comingSoon:true) — it
 * never crashes. The reveal wall reads the same signal (leadsProPurchasable) to
 * render "Leads Pro — coming soon" instead of a live buy button.
 *
 * The subscription is confirmed asynchronously by the Stripe webhook, which
 * routes Leads subs to applyLeadsSubscription (upserting `leads_subscriptions`
 * keyed by stripe_customer_id).
 */
import type { Express, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import Stripe from 'stripe';
import { db } from '../../db/client.js';
import { leadsSubscriptions, type User } from '../../db/schema.js';
import { requireAuth } from '../middleware.js';
import { loadEnv } from '../../config.js';
import {
  leadsPriceId,
  leadsProPurchasable,
  LEADS_PRO_MONTHLY_ALLOWANCE,
} from '../directory/leadsEntitlement.js';

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

/**
 * Create (or reuse) the shipper's Stripe Customer and open a Checkout session in
 * SUBSCRIPTION mode for the Leads Pro monthly price. Throws if Stripe / the price
 * is not configured (the route maps this to a 503 "coming soon").
 */
export async function createLeadsProCheckoutSession(opts: {
  user: Pick<User, 'id' | 'email'>;
}): Promise<{ url: string | null; customerId: string }> {
  const env = loadEnv();
  const price = leadsPriceId();
  if (!env.STRIPE_SECRET_KEY || !price) {
    throw new Error('Leads Pro billing is not configured.');
  }
  const { user } = opts;

  const existing = (
    await db()
      .select()
      .from(leadsSubscriptions)
      .where(eq(leadsSubscriptions.userId, user.id))
      .limit(1)
  )[0];

  let customerId = existing?.stripeCustomerId ?? null;
  if (!customerId) {
    const customer = await stripe().customers.create({
      email: user.email,
      metadata: { userId: String(user.id), kind: 'leads_pro' },
    });
    customerId = customer.id;
    if (existing) {
      await db()
        .update(leadsSubscriptions)
        .set({ stripeCustomerId: customerId, updatedAt: new Date() })
        .where(eq(leadsSubscriptions.id, existing.id));
    } else {
      await db()
        .insert(leadsSubscriptions)
        .values({
          userId: user.id,
          status: 'inactive',
          tier: 'pro',
          stripeCustomerId: customerId,
          revealAllowance: LEADS_PRO_MONTHLY_ALLOWANCE,
        });
    }
  }

  const baseUrl = env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const session = await stripe().checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price, quantity: 1 }],
    subscription_data: {
      metadata: { kind: 'leads_pro', userId: String(user.id) },
    },
    success_url: `${baseUrl}/importers?upgrade=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/importers?upgrade=cancelled`,
    allow_promotion_codes: true,
  });
  return { url: session.url, customerId };
}

export function registerLeadsBillingRoutes(app: Express) {
  app.post(
    '/api/importers/billing/checkout',
    requireAuth,
    async (req: Request, res: Response) => {
      // Graceful degrade: unset price id → "coming soon" (never crashes).
      if (!leadsProPurchasable()) {
        return res
          .status(503)
          .json({ error: 'Leads Pro is coming soon — checkout is not enabled yet.', comingSoon: true });
      }
      try {
        const { url } = await createLeadsProCheckoutSession({ user: req.user! });
        return res.json({ url });
      } catch (err) {
        console.error('[leads.billing.checkout] failed:', err);
        return res.status(500).json({ error: 'Could not start checkout. Try again.' });
      }
    },
  );

  app.get(
    '/api/importers/billing/portal',
    requireAuth,
    async (req: Request, res: Response) => {
      const env = loadEnv();
      if (!env.STRIPE_SECRET_KEY) {
        return res.status(503).json({ error: 'Billing is not configured.' });
      }
      const sub = (
        await db()
          .select()
          .from(leadsSubscriptions)
          .where(eq(leadsSubscriptions.userId, req.user!.id))
          .limit(1)
      )[0];
      if (!sub?.stripeCustomerId) {
        return res.status(404).json({ error: 'No Stripe customer yet — subscribe first.' });
      }
      try {
        const portal = await stripe().billingPortal.sessions.create({
          customer: sub.stripeCustomerId,
          return_url: env.PUBLIC_BASE_URL.replace(/\/$/, '') + '/importers',
        });
        return res.json({ url: portal.url });
      } catch (err) {
        console.error('[leads.billing.portal] failed:', err);
        return res.status(500).json({ error: 'Portal unavailable.' });
      }
    },
  );
}
