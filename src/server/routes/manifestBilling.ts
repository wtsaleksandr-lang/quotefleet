/**
 * Manifest Privacy billing routes — the SHIPPER's annual subscription for the
 * managed CBP confidentiality service. Cloned from routes/directoryBilling.ts;
 * entirely separate from tenant billing.
 *
 *   POST /api/privacy/billing/checkout  — open a Stripe Checkout session for a
 *                                         chosen tier (auth required; NO
 *                                         requireTenant — the buyer is a
 *                                         tenant-less shipper user).
 *   GET  /api/privacy/billing/portal    — Stripe Customer Portal for managing /
 *                                         cancelling the subscription.
 *
 * GRACEFUL DEGRADE: the three tier prices (STRIPE_PRICE_MANIFEST_*) are not set
 * yet. A checkout for a tier whose price id is UNSET returns a friendly 503
 * "coming soon" — it never crashes. The onboarding plan step reads the same
 * signal (manifestTierPurchasable) to render "Coming soon" instead of a live
 * buy button.
 *
 * The subscription is confirmed asynchronously by the Stripe webhook, which
 * routes Manifest subs to applyManifestSubscription (upserting
 * `manifest_subscriptions` keyed by stripe_customer_id).
 */
import type { Express, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import Stripe from 'stripe';
import { db } from '../../db/client.js';
import { manifestSubscriptions, type ManifestTier, type User } from '../../db/schema.js';
import { requireAuth } from '../middleware.js';
import { loadEnv } from '../../config.js';
import { manifestPriceId, manifestTierPurchasable, tierMeta } from '../directory/manifestEntitlement.js';

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

function parseTier(raw: unknown): ManifestTier | null {
  return raw === 'basic' || raw === 'professional' || raw === 'enterprise' ? raw : null;
}

/**
 * Create (or reuse) the shipper's Stripe Customer and open a Checkout session in
 * SUBSCRIPTION mode for the chosen tier's annual price. Throws if Stripe / that
 * tier's price is not configured (the route maps this to a 503 "coming soon").
 */
export async function createManifestCheckoutSession(opts: {
  user: Pick<User, 'id' | 'email'>;
  tier: ManifestTier;
  token?: string | null;
}): Promise<{ url: string | null; customerId: string }> {
  const env = loadEnv();
  const price = manifestPriceId(opts.tier);
  if (!env.STRIPE_SECRET_KEY || !price) {
    throw new Error('Manifest Privacy billing is not configured for this tier.');
  }
  const { user, tier } = opts;
  const quota = tierMeta(tier).entityQuota;

  const existing = (
    await db()
      .select()
      .from(manifestSubscriptions)
      .where(eq(manifestSubscriptions.userId, user.id))
      .limit(1)
  )[0];

  let customerId = existing?.stripeCustomerId ?? null;
  if (!customerId) {
    const customer = await stripe().customers.create({
      email: user.email,
      metadata: { userId: String(user.id), kind: 'manifest_privacy' },
    });
    customerId = customer.id;
    if (existing) {
      await db()
        .update(manifestSubscriptions)
        .set({ stripeCustomerId: customerId, tier, entityQuota: quota, updatedAt: new Date() })
        .where(eq(manifestSubscriptions.id, existing.id));
    } else {
      await db()
        .insert(manifestSubscriptions)
        .values({ userId: user.id, status: 'inactive', tier, entityQuota: quota, stripeCustomerId: customerId });
    }
  }

  const baseUrl = env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const back = opts.token ? `/privacy/apply/${encodeURIComponent(opts.token)}` : '/manifest-privacy';
  const session = await stripe().checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price, quantity: 1 }],
    subscription_data: {
      metadata: { kind: 'manifest_privacy', tier, userId: String(user.id) },
    },
    success_url: `${baseUrl}${back}?upgrade=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}${back}?upgrade=cancelled`,
    allow_promotion_codes: true,
  });
  return { url: session.url, customerId };
}

export function registerManifestBillingRoutes(app: Express) {
  app.post(
    '/api/privacy/billing/checkout',
    requireAuth,
    async (req: Request, res: Response) => {
      const tier = parseTier((req.body as Record<string, unknown>)?.tier);
      if (!tier) {
        return res.status(400).json({ error: 'Choose a plan (basic, professional, or enterprise).' });
      }
      // Graceful degrade: a tier whose Stripe price id is unset is "coming soon".
      if (!manifestTierPurchasable(tier)) {
        return res.status(503).json({ error: 'This plan is coming soon — checkout is not enabled yet.', comingSoon: true });
      }
      try {
        const token = typeof (req.body as Record<string, unknown>)?.token === 'string'
          ? String((req.body as Record<string, unknown>).token)
          : null;
        const { url } = await createManifestCheckoutSession({ user: req.user!, tier, token });
        return res.json({ url });
      } catch (err) {
        console.error('[manifest.billing.checkout] failed:', err);
        return res.status(500).json({ error: 'Could not start checkout. Try again.' });
      }
    },
  );

  app.get(
    '/api/privacy/billing/portal',
    requireAuth,
    async (req: Request, res: Response) => {
      const env = loadEnv();
      if (!env.STRIPE_SECRET_KEY) {
        return res.status(503).json({ error: 'Billing is not configured.' });
      }
      const sub = (
        await db()
          .select()
          .from(manifestSubscriptions)
          .where(eq(manifestSubscriptions.userId, req.user!.id))
          .limit(1)
      )[0];
      if (!sub?.stripeCustomerId) {
        return res.status(404).json({ error: 'No Stripe customer yet — subscribe first.' });
      }
      try {
        const portal = await stripe().billingPortal.sessions.create({
          customer: sub.stripeCustomerId,
          return_url: env.PUBLIC_BASE_URL.replace(/\/$/, '') + '/manifest-privacy',
        });
        return res.json({ url: portal.url });
      } catch (err) {
        console.error('[manifest.billing.portal] failed:', err);
        return res.status(500).json({ error: 'Portal unavailable.' });
      }
    },
  );
}
