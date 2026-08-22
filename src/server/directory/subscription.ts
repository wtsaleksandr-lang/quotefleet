/**
 * Directory Pro subscription webhook logic.
 *
 * A Directory Pro subscription is a Stripe subscription on the $19/mo
 * `STRIPE_PRICE_DIRECTORY_PRO` price, bought by a SHIPPER (a `users` row with
 * `tenantId = null`, `role = 'shipper'`). It is upserted into
 * `directory_subscriptions` — the per-USER entitlement table — and NEVER touches
 * `tenants` / `tenants.plan`.
 *
 * `handleEvent` in routes/billing.ts routes each subscription webhook here FIRST
 * (via isDirectorySubscription); only non-directory subs fall through to the
 * existing tenant `applySubscription`. The two are mutually exclusive by price
 * id / metadata, so the tenant path is left entirely untouched.
 *
 * The status→state classification REUSES the tenant mapper `deriveSubscriptionState`
 * verbatim (imported from billing.ts) so grace/terminal handling stays identical
 * across both subscription kinds; we then project its `health` onto the Directory
 * status vocabulary (active | trialing | past_due | inactive).
 */
import type Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { directorySubscriptions, type DirectorySubscriptionStatus } from '../../db/schema.js';
import { loadEnv } from '../../config.js';
import { deriveSubscriptionState } from '../routes/billing.js';

/** The Price id on a subscription's first line item, if any. */
function priceIdOf(sub: Stripe.Subscription): string | undefined {
  return sub.items?.data?.[0]?.price?.id ?? undefined;
}

/**
 * True when this Stripe subscription is a Directory Pro subscription — detected
 * by its Price id matching STRIPE_PRICE_DIRECTORY_PRO, OR (belt-and-braces) by
 * the `kind: 'directory_pro'` metadata we stamp at checkout. Either signal is
 * enough, so a subscription whose line item we can't read still routes correctly
 * off its metadata.
 */
export function isDirectorySubscription(sub: Stripe.Subscription): boolean {
  const env = loadEnv();
  const dirPrice = env.STRIPE_PRICE_DIRECTORY_PRO;
  if (dirPrice && priceIdOf(sub) === dirPrice) return true;
  if (sub.metadata?.kind === 'directory_pro') return true;
  return false;
}

/**
 * Project a Stripe subscription onto the Directory status vocabulary, reusing
 * the tenant mapper's grace/terminal classification verbatim:
 *   health 'active'  → 'active'  (or 'trialing' while Stripe says trialing)
 *   health 'grace'   → 'past_due'
 *   health 'inactive'→ 'inactive'
 */
export function deriveDirectoryStatus(sub: Stripe.Subscription): DirectorySubscriptionStatus {
  const { health } = deriveSubscriptionState(sub);
  if (health === 'active') return sub.status === 'trialing' ? 'trialing' : 'active';
  if (health === 'grace') return 'past_due';
  return 'inactive';
}

/**
 * Upsert a Directory Pro subscription into `directory_subscriptions`, keyed by
 * `stripe_customer_id`. Called from the Stripe webhook for a directory sub.
 *
 * The row is normally created at checkout time (createDirectoryProCheckoutSession
 * stamps the customer id before redirecting); this reconciles its status. As a
 * fallback — if the webhook wins the race and no row exists yet — it inserts one
 * from `sub.metadata.userId`. If neither a row nor a userId is available, it
 * no-ops loudly rather than guessing.
 *
 * NEVER reads or writes `tenants`.
 */
export async function applyDirectorySubscription(sub: Stripe.Subscription): Promise<void> {
  const customerId = String(sub.customer);
  const status = deriveDirectoryStatus(sub);
  const priceId = priceIdOf(sub) ?? null;
  const cpeUnix = (sub as unknown as { current_period_end?: number }).current_period_end;
  const currentPeriodEnd = typeof cpeUnix === 'number' ? new Date(cpeUnix * 1000) : null;

  const existing = (
    await db()
      .select()
      .from(directorySubscriptions)
      .where(eq(directorySubscriptions.stripeCustomerId, customerId))
      .limit(1)
  )[0];

  if (existing) {
    await db()
      .update(directorySubscriptions)
      .set({
        status,
        stripeSubscriptionId: sub.id,
        priceId,
        currentPeriodEnd,
        updatedAt: new Date(),
      })
      .where(eq(directorySubscriptions.id, existing.id));
    console.log(
      `[directory.webhook] user ${existing.userId} → ${status} (sub ${sub.status}, customer ${customerId})`
    );
    return;
  }

  // No row yet — webhook raced ahead of checkout's stamp. Recover the owner from
  // the subscription metadata we set at checkout.
  const metaUserId = Number(sub.metadata?.userId);
  if (!Number.isInteger(metaUserId) || metaUserId <= 0) {
    console.warn(
      `[directory.webhook] no directory_subscriptions row for customer ${customerId} and no valid userId metadata — skipping`
    );
    return;
  }
  await db()
    .insert(directorySubscriptions)
    .values({
      userId: metaUserId,
      status,
      stripeCustomerId: customerId,
      stripeSubscriptionId: sub.id,
      priceId,
      currentPeriodEnd,
    });
  console.log(
    `[directory.webhook] inserted directory_subscriptions for user ${metaUserId} → ${status} (customer ${customerId})`
  );
}
