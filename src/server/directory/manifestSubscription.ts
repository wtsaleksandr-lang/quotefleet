/**
 * Manifest Privacy subscription webhook logic — cloned from the Directory Pro
 * subscription webhook (subscription.ts).
 *
 * A Manifest Privacy subscription is a Stripe subscription on one of the three
 * annual Manifest prices (Basic/Professional/Enterprise), bought by a SHIPPER (a
 * `users` row, `tenantId = null`). It is upserted into `manifest_subscriptions`
 * (the per-USER entitlement table) and NEVER touches `tenants` / `tenants.plan`.
 *
 * routeSubscription() in routes/billing.ts routes each subscription webhook here
 * (via isManifestSubscription) BEFORE the Directory Pro and tenant paths. All
 * three are mutually exclusive by price id / metadata kind, so the existing
 * paths are left entirely untouched.
 */
import type Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  manifestSubscriptions,
  type ManifestSubscriptionStatus,
  type ManifestTier,
} from '../../db/schema.js';
import { loadEnv } from '../../config.js';
import { deriveSubscriptionState } from '../routes/billing.js';
import { MANIFEST_TIERS, tierMeta } from './manifestEntitlement.js';

/** The Price id on a subscription's first line item, if any. */
function priceIdOf(sub: Stripe.Subscription): string | undefined {
  return sub.items?.data?.[0]?.price?.id ?? undefined;
}

/** Map a Stripe price id (or the checkout `tier` metadata) to a Manifest tier. */
export function tierFromSubscription(sub: Stripe.Subscription): ManifestTier {
  const env = loadEnv();
  const price = priceIdOf(sub);
  for (const t of MANIFEST_TIERS) {
    const configured = env[t.priceEnvKey] as string | undefined;
    if (configured && price === configured) return t.tier;
  }
  const metaTier = sub.metadata?.tier;
  if (metaTier === 'basic' || metaTier === 'professional' || metaTier === 'enterprise') {
    return metaTier;
  }
  return 'basic';
}

/**
 * True when this Stripe subscription is a Manifest Privacy subscription —
 * detected by its Price id matching any configured STRIPE_PRICE_MANIFEST_*, OR
 * (belt-and-braces) the `kind: 'manifest_privacy'` metadata we stamp at
 * checkout. Either signal alone is enough.
 */
export function isManifestSubscription(sub: Stripe.Subscription): boolean {
  const env = loadEnv();
  const price = priceIdOf(sub);
  for (const t of MANIFEST_TIERS) {
    const configured = env[t.priceEnvKey] as string | undefined;
    if (configured && price === configured) return true;
  }
  return sub.metadata?.kind === 'manifest_privacy';
}

/** Project a Stripe subscription onto the Manifest status vocabulary, reusing
 *  the tenant mapper's grace/terminal classification verbatim. */
export function deriveManifestStatus(sub: Stripe.Subscription): ManifestSubscriptionStatus {
  const { health } = deriveSubscriptionState(sub);
  if (health === 'active') return sub.status === 'trialing' ? 'trialing' : 'active';
  if (health === 'grace') return 'past_due';
  return 'inactive';
}

/**
 * Upsert a Manifest Privacy subscription into `manifest_subscriptions`, keyed by
 * `stripe_customer_id`. The row is normally created at checkout time; this
 * reconciles status, tier, and entity quota. If the webhook wins the race and no
 * row exists, it inserts one from `sub.metadata.userId`. NEVER touches `tenants`.
 */
export async function applyManifestSubscription(sub: Stripe.Subscription): Promise<void> {
  const customerId = String(sub.customer);
  const status = deriveManifestStatus(sub);
  const tier = tierFromSubscription(sub);
  const entityQuota = tierMeta(tier).entityQuota;
  const priceId = priceIdOf(sub) ?? null;
  const cpeUnix = (sub as unknown as { current_period_end?: number }).current_period_end;
  const currentPeriodEnd = typeof cpeUnix === 'number' ? new Date(cpeUnix * 1000) : null;

  const existing = (
    await db()
      .select()
      .from(manifestSubscriptions)
      .where(eq(manifestSubscriptions.stripeCustomerId, customerId))
      .limit(1)
  )[0];

  if (existing) {
    await db()
      .update(manifestSubscriptions)
      .set({
        status,
        tier,
        entityQuota,
        stripeSubscriptionId: sub.id,
        priceId,
        currentPeriodEnd,
        updatedAt: new Date(),
      })
      .where(eq(manifestSubscriptions.id, existing.id));
    console.log(
      `[manifest.webhook] user ${existing.userId} → ${status} tier=${tier} (sub ${sub.status}, customer ${customerId})`,
    );
    return;
  }

  const metaUserId = Number(sub.metadata?.userId);
  if (!Number.isInteger(metaUserId) || metaUserId <= 0) {
    console.warn(
      `[manifest.webhook] no manifest_subscriptions row for customer ${customerId} and no valid userId metadata — skipping`,
    );
    return;
  }
  await db()
    .insert(manifestSubscriptions)
    .values({
      userId: metaUserId,
      status,
      tier,
      entityQuota,
      stripeCustomerId: customerId,
      stripeSubscriptionId: sub.id,
      priceId,
      currentPeriodEnd,
    });
  console.log(
    `[manifest.webhook] inserted manifest_subscriptions for user ${metaUserId} → ${status} tier=${tier} (customer ${customerId})`,
  );
}
