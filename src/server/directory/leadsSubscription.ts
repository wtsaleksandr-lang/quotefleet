/**
 * "Leads Pro" subscription webhook logic — cloned from the Manifest Privacy
 * subscription webhook (manifestSubscription.ts).
 *
 * A Leads Pro subscription is a Stripe subscription on the STRIPE_PRICE_LEADS_PRO
 * price, bought by a SHIPPER (a `users` row, `tenantId = null`). It is upserted
 * into `leads_subscriptions` (the per-USER entitlement table) and NEVER touches
 * `tenants` / `tenants.plan`.
 *
 * routeSubscription() in routes/billing.ts routes each subscription webhook here
 * (via isLeadsSubscription) alongside the Manifest / Directory / tenant paths.
 * All are mutually exclusive by price id / metadata kind, so the existing paths
 * are left entirely untouched.
 */
import type Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { leadsSubscriptions } from '../../db/schema.js';
import { loadEnv } from '../../config.js';
import { deriveSubscriptionState } from '../routes/billing.js';
import { LEADS_PRO_MONTHLY_ALLOWANCE } from './leadsEntitlement.js';

/** The Price id on a subscription's first line item, if any. */
function priceIdOf(sub: Stripe.Subscription): string | undefined {
  return sub.items?.data?.[0]?.price?.id ?? undefined;
}

/**
 * True when this Stripe subscription is a Leads Pro subscription — detected by
 * its Price id matching STRIPE_PRICE_LEADS_PRO, OR (belt-and-braces) the
 * `kind: 'leads_pro'` metadata we stamp at checkout. Either signal alone is
 * enough.
 */
export function isLeadsSubscription(sub: Stripe.Subscription): boolean {
  const configured = loadEnv().STRIPE_PRICE_LEADS_PRO;
  if (configured && priceIdOf(sub) === configured) return true;
  return sub.metadata?.kind === 'leads_pro';
}

/** Project a Stripe subscription onto the Leads status vocabulary, reusing the
 *  tenant mapper's grace/terminal classification verbatim. */
export function deriveLeadsStatus(sub: Stripe.Subscription): 'active' | 'trialing' | 'past_due' | 'inactive' {
  const { health } = deriveSubscriptionState(sub);
  if (health === 'active') return sub.status === 'trialing' ? 'trialing' : 'active';
  if (health === 'grace') return 'past_due';
  return 'inactive';
}

/**
 * Upsert a Leads Pro subscription into `leads_subscriptions`, keyed by
 * `stripe_customer_id`. The row is normally created at checkout time; this
 * reconciles status + period end. If the webhook wins the race and no row
 * exists, it inserts one from `sub.metadata.userId`. NEVER touches `tenants`.
 */
export async function applyLeadsSubscription(sub: Stripe.Subscription): Promise<void> {
  const customerId = String(sub.customer);
  const status = deriveLeadsStatus(sub);
  const priceId = priceIdOf(sub) ?? null;
  const cpeUnix = (sub as unknown as { current_period_end?: number }).current_period_end;
  const currentPeriodEnd = typeof cpeUnix === 'number' ? new Date(cpeUnix * 1000) : null;

  const existing = (
    await db()
      .select()
      .from(leadsSubscriptions)
      .where(eq(leadsSubscriptions.stripeCustomerId, customerId))
      .limit(1)
  )[0];

  if (existing) {
    await db()
      .update(leadsSubscriptions)
      .set({
        status,
        tier: 'pro',
        stripeSubscriptionId: sub.id,
        priceId,
        currentPeriodEnd,
        updatedAt: new Date(),
      })
      .where(eq(leadsSubscriptions.id, existing.id));
    console.log(
      `[leads.webhook] user ${existing.userId} → ${status} (sub ${sub.status}, customer ${customerId})`,
    );
    return;
  }

  const metaUserId = Number(sub.metadata?.userId);
  if (!Number.isInteger(metaUserId) || metaUserId <= 0) {
    console.warn(
      `[leads.webhook] no leads_subscriptions row for customer ${customerId} and no valid userId metadata — skipping`,
    );
    return;
  }
  await db()
    .insert(leadsSubscriptions)
    .values({
      userId: metaUserId,
      status,
      tier: 'pro',
      stripeCustomerId: customerId,
      stripeSubscriptionId: sub.id,
      priceId,
      currentPeriodEnd,
      revealAllowance: LEADS_PRO_MONTHLY_ALLOWANCE,
    });
  console.log(
    `[leads.webhook] inserted leads_subscriptions for user ${metaUserId} → ${status} (customer ${customerId})`,
  );
}
