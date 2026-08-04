/**
 * Stripe Connect (Express) — carrier payout onboarding. PAYMENTS PR 1.
 *
 *   POST /api/tenant/connect/onboard   — create (or reuse) this tenant's
 *                                        Express connected account, then open a
 *                                        Stripe-hosted account-onboarding link.
 *                                        Returns { url } to redirect to.
 *   GET  /api/tenant/connect/status    — live account readiness for the UI:
 *                                        { connected, detailsSubmitted,
 *                                          chargesEnabled, payoutsEnabled }.
 *   POST /api/tenant/connect/webhook   — Connect `account.updated` events →
 *                                        refresh the tenant's cached flags.
 *
 * This is the FOUNDATION of deposit-to-book: a carrier connects a way to get
 * paid so a LATER PR can collect a deposit from a shipper (carrier = connected
 * account, QuoteFleet = platform taking a fee). *** NO charge / money movement
 * is introduced here — onboarding + status ONLY. ***
 *
 * Gating mirrors billing.ts: everything is gated on STRIPE_SECRET_KEY. When
 * Stripe is unconfigured the authed routes soft-return 503 ("not configured")
 * and the webhook 503s, exactly like the billing routes, so the app boots fine
 * in dev without a Stripe account. Tenant-scoped throughout — a tenant can only
 * ever touch its OWN connected account.
 *
 * The webhook uses a SEPARATE signing secret (STRIPE_CONNECT_WEBHOOK_SECRET)
 * and, like the billing webhook, is mounted BEFORE the global JSON parser so
 * the raw body survives for Stripe signature verification.
 */
import type { Express, Request, Response } from 'express';
import express from 'express';
import { eq } from 'drizzle-orm';
import Stripe from 'stripe';
import { db } from '../../db/client.js';
import { tenants, type Tenant } from '../../db/schema.js';
import { requireAuth, requireTenant } from '../middleware.js';
import { loadEnv } from '../../config.js';

let connectStripeClient: Stripe | null = null;
/** Lazily-built Stripe client — same pattern as billing.ts's `stripe()`. */
function stripe(): Stripe {
  if (connectStripeClient) return connectStripeClient;
  const env = loadEnv();
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error('Stripe is not configured. Set STRIPE_SECRET_KEY in env.');
  }
  connectStripeClient = new Stripe(env.STRIPE_SECRET_KEY);
  return connectStripeClient;
}

/** True when Stripe is configured at all. Connect onboarding needs only the
 *  secret key (no Price ids), so this is intentionally looser than
 *  billing.ts's `billingConfigured()`. */
export function connectConfigured(): boolean {
  return !!loadEnv().STRIPE_SECRET_KEY;
}

export interface ConnectStatus {
  connected: boolean;
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
}

/** Pure mapping of a Stripe Account → the flags the UI renders. `connected`
 *  means the account EXISTS (has an id); the three booleans reflect how far
 *  onboarding has progressed. Exported for unit testing. */
export function mapAccountStatus(account: Stripe.Account): ConnectStatus {
  return {
    connected: !!account.id,
    detailsSubmitted: !!account.details_submitted,
    chargesEnabled: !!account.charges_enabled,
    payoutsEnabled: !!account.payouts_enabled,
  };
}

/** The get-paid screen we bounce back to after Stripe-hosted onboarding. */
function getPaidReturnUrls(): { refreshUrl: string; returnUrl: string } {
  const baseUrl = loadEnv().PUBLIC_BASE_URL.replace(/\/$/, '');
  return {
    refreshUrl: `${baseUrl}/app/account?connect=refresh`,
    returnUrl: `${baseUrl}/app/account?connect=return`,
  };
}

/**
 * Create (or reuse) the tenant's Express connected account and return a fresh
 * Stripe-hosted account-onboarding link. If the tenant already has an account
 * id we reuse it (idempotent — repeat clicks never create duplicate accounts);
 * otherwise we create an Express account, stamp {tenantId, slug} metadata, and
 * persist the id on the tenant row. `card_payments` + `transfers` capabilities
 * are REQUESTED so onboarding collects the details a future deposit charge will
 * need — requesting a capability does not move any money. Tenant-scoped: only
 * ever the passed tenant's account.
 */
export async function onboardTenant(tenant: Tenant): Promise<{ url: string | null; accountId: string }> {
  let accountId = tenant.stripeConnectAccountId;
  if (!accountId) {
    const account = await stripe().accounts.create({
      type: 'express',
      email: tenant.contactEmail ?? undefined,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      metadata: { tenantId: String(tenant.id), slug: tenant.slug },
    });
    accountId = account.id;
    await db()
      .update(tenants)
      .set({ stripeConnectAccountId: accountId, updatedAt: new Date() })
      .where(eq(tenants.id, tenant.id));
  }

  const { refreshUrl, returnUrl } = getPaidReturnUrls();
  const link = await stripe().accountLinks.create({
    account: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: 'account_onboarding',
  });
  return { url: link.url, accountId };
}

/**
 * Retrieve the tenant's connected account and map it to the UI status. No
 * account id → `{ connected:false, … }` (nothing to show but the connect
 * button). On retrieve we also refresh the cached flags on the tenant row, but
 * only when they actually changed, to avoid a needless write on every poll.
 * Tenant-scoped.
 */
export async function getConnectStatus(tenant: Tenant): Promise<ConnectStatus> {
  if (!tenant.stripeConnectAccountId) {
    return { connected: false, detailsSubmitted: false, chargesEnabled: false, payoutsEnabled: false };
  }
  const account = await stripe().accounts.retrieve(tenant.stripeConnectAccountId);
  const status = mapAccountStatus(account);
  await refreshConnectCache(tenant.id, status, tenant);
  return status;
}

/** Persist the readiness cache on the tenant row, but only if something
 *  changed vs the row we already hold. Never throws — a cache miss is not worth
 *  failing a status read or a webhook over. */
async function refreshConnectCache(
  tenantId: number,
  status: ConnectStatus,
  known?: Tenant | null
): Promise<void> {
  if (
    known &&
    known.connectDetailsSubmitted === status.detailsSubmitted &&
    known.connectChargesEnabled === status.chargesEnabled &&
    known.connectPayoutsEnabled === status.payoutsEnabled
  ) {
    return; // no change — skip the write
  }
  try {
    await db()
      .update(tenants)
      .set({
        connectDetailsSubmitted: status.detailsSubmitted,
        connectChargesEnabled: status.chargesEnabled,
        connectPayoutsEnabled: status.payoutsEnabled,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenantId));
  } catch (err) {
    console.error('[connect] cache refresh failed:', err);
  }
}

/** Webhook: an `account.updated` fired — find the owning tenant by connect
 *  account id and refresh its cached readiness flags. No-op (never throws) when
 *  no tenant matches the account. */
export async function applyAccountUpdate(account: Stripe.Account): Promise<void> {
  const t = (
    await db().select().from(tenants).where(eq(tenants.stripeConnectAccountId, account.id)).limit(1)
  )[0];
  if (!t) {
    console.warn('[connect.webhook] no tenant for connected account', account.id);
    return;
  }
  await refreshConnectCache(t.id, mapAccountStatus(account), t);
  console.log(`[connect.webhook] tenant ${t.slug} connect status refreshed (acct ${account.id})`);
}

export async function handleConnectEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'account.updated': {
      await applyAccountUpdate(event.data.object as Stripe.Account);
      return;
    }
    default:
      // Unhandled — ack 200 so Stripe stops retrying.
      return;
  }
}

/** Connect webhook — mounted BEFORE the global JSON parser so the raw body is
 *  intact for signature verification. Uses its OWN signing secret. Soft-skips
 *  (503) when Stripe or the Connect secret is unset. Call once early in
 *  createApp(), next to registerStripeWebhook. */
export function registerConnectWebhook(app: Express) {
  app.post(
    '/api/tenant/connect/webhook',
    express.raw({ type: 'application/json' }),
    async (req: Request, res: Response) => {
      const env = loadEnv();
      if (!env.STRIPE_SECRET_KEY || !env.STRIPE_CONNECT_WEBHOOK_SECRET) {
        return res.status(503).end();
      }
      const sig = req.headers['stripe-signature'];
      if (typeof sig !== 'string') return res.status(400).end();

      let event: Stripe.Event;
      try {
        event = stripe().webhooks.constructEvent(
          req.body as Buffer,
          sig,
          env.STRIPE_CONNECT_WEBHOOK_SECRET
        );
      } catch (err) {
        console.warn('[connect.webhook] signature verify failed:', err);
        return res.status(400).end();
      }

      try {
        await handleConnectEvent(event);
      } catch (err) {
        console.error('[connect.webhook] handler failed:', err);
        return res.status(500).end();
      }
      res.json({ received: true });
    }
  );
}

export function registerConnectRoutes(app: Express) {
  // Public-ish (authed): is Connect available at all? Lets the UI hide the
  // whole get-paid section in dev / unconfigured deployments instead of
  // showing a button that 503s. Mirrors /api/billing/status.
  app.get('/api/tenant/connect/config', requireAuth, requireTenant, (_req, res) => {
    res.json({ configured: connectConfigured() });
  });

  // Start / resume Stripe-hosted Express onboarding for THIS tenant.
  app.post(
    '/api/tenant/connect/onboard',
    requireAuth,
    requireTenant,
    async (req: Request, res: Response) => {
      if (!connectConfigured()) {
        return res.status(503).json({ error: 'Payments are not enabled yet.' });
      }
      try {
        const { url } = await onboardTenant(req.tenant!);
        return res.json({ url });
      } catch (err) {
        console.error('[connect.onboard] failed:', err);
        return res.status(500).json({ error: 'Could not start payout setup. Try again.' });
      }
    }
  );

  // Live readiness for THIS tenant's connected account.
  app.get(
    '/api/tenant/connect/status',
    requireAuth,
    requireTenant,
    async (req: Request, res: Response) => {
      if (!connectConfigured()) {
        return res.status(503).json({ error: 'Payments are not enabled yet.' });
      }
      try {
        const status = await getConnectStatus(req.tenant!);
        return res.json(status);
      } catch (err) {
        console.error('[connect.status] failed:', err);
        return res.status(500).json({ error: 'Could not load payout status.' });
      }
    }
  );

  // Webhook is registered separately, BEFORE the global JSON body parser
  // (see registerConnectWebhook above + createApp).
}
