/**
 * "Leads Pro" entitlement + model constants — SOFT auth for the Importer Search
 * decision-maker CONTACT REVEAL. Cloned from the Directory Pro / Manifest Privacy
 * entitlements (entitlement.ts / manifestEntitlement.ts): a subscriber is a
 * SHIPPER (`users` row, `tenantId = null`), entitled via a `leads_subscriptions`
 * row that is FULLY DECOUPLED from `tenants.plan`. It answers "is the caller a
 * paying Leads Pro subscriber, and how many reveals may they run?" WITHOUT ever
 * forcing a login:
 *
 *   • No session cookie   → free (NOT a 401). Browsing stays public.
 *   • Session but no sub   → free (the small free-taste allowance applies).
 *   • Session + a live sub → Leads Pro (the monthly reveal allowance applies).
 *
 * "Live" = `status IN ('active','trialing')` AND (`current_period_end IS NULL`
 * OR still in the future). Memoized on the request; NEVER throws (a DB hiccup
 * degrades to "free" so a public page can never 500 on entitlement lookup).
 *
 * This module also owns the MODEL DEFAULTS (config-overridable; these are the
 * orchestrator's decision, tunable by Alex) and the graceful-degrade rule: when
 * the Stripe price id is UNSET, Leads Pro is "coming soon" — checkout never
 * crashes.
 */
import type { Request } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { leadsSubscriptions } from '../../db/schema.js';
import { lookupSession, SESSION_COOKIE_NAME } from '../../auth/session.js';
import { loadEnv } from '../../config.js';

/** Read a positive integer from the environment, else fall back. */
const envInt = (name: string, fallback: number): number => {
  const raw = process.env[name];
  const n = raw != null ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

// ── MODEL DEFAULTS (config-overridable) ──────────────────────────────────────
/** FREE tier: total decision-maker reveals a free account gets (a taste). The
 *  existing 3 free PROFILE opens stay separate (importerQuota). Default 2. */
export const FREE_REVEAL_TASTE = envInt('IMPORTER_FREE_REVEALS', 2);
/** Leads Pro: decision-maker reveals included per calendar month. Default 50. */
export const LEADS_PRO_MONTHLY_ALLOWANCE = envInt('LEADS_PRO_MONTHLY_REVEALS', 50);
/** Suggested monthly price (display only — Stripe holds the source of truth).
 *  Alex confirms the exact price when wiring STRIPE_PRICE_LEADS_PRO. */
export const LEADS_PRO_PRICE_USD = envInt('LEADS_PRO_PRICE_USD', 49);

/** Short marketing feature bullets (honest-claims safe). */
export const LEADS_PRO_FEATURES: readonly string[] = [
  `${LEADS_PRO_MONTHLY_ALLOWANCE} decision-maker contact reveals every month`,
  'Verified email + role / phone tier on each importer, with an AI-drafted opener',
  'Unlimited importer profile opens (no 3-profile cap)',
  'Re-reveal any importer you already unlocked — free, forever',
];

/** The configured Stripe Price id for Leads Pro, or null when UNSET (→ coming soon). */
export function leadsPriceId(): string | null {
  return loadEnv().STRIPE_PRICE_LEADS_PRO || null;
}

/** True when Stripe AND the Leads Pro price id are configured — i.e. checkout is
 *  live. With either unset, Leads Pro degrades to "coming soon" (never crashes). */
export function leadsProPurchasable(): boolean {
  const env = loadEnv();
  return !!env.STRIPE_SECRET_KEY && !!leadsPriceId();
}

export interface LeadsIdentity {
  userId: number | null;
  email: string | null;
  name?: string | null;
  /** True only when a live Leads Pro subscription entitles this user. */
  isSubscriber: boolean;
  status: string | null;
  currentPeriodEnd: Date | null;
  /** Monthly reveal allowance for a live subscriber (0 when free). */
  revealAllowance: number;
}

const ANONYMOUS: Readonly<LeadsIdentity> = Object.freeze({
  userId: null,
  email: null,
  name: null,
  isSubscriber: false,
  status: null,
  currentPeriodEnd: null,
  revealAllowance: 0,
});

const MEMO_KEY = '_leadsIdentity';

function isLive(status: string | null, currentPeriodEnd: Date | null): boolean {
  if (status !== 'active' && status !== 'trialing') return false;
  if (currentPeriodEnd == null) return true;
  return currentPeriodEnd.getTime() > Date.now();
}

async function computeIdentity(req: Request): Promise<LeadsIdentity> {
  try {
    const token = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
    const ctx = await lookupSession(token);
    if (!ctx) return ANONYMOUS;
    const sub = (
      await db()
        .select()
        .from(leadsSubscriptions)
        .where(eq(leadsSubscriptions.userId, ctx.user.id))
        .limit(1)
    )[0];
    if (!sub) {
      return {
        userId: ctx.user.id,
        email: ctx.user.email,
        name: ctx.user.name ?? null,
        isSubscriber: false,
        status: null,
        currentPeriodEnd: null,
        revealAllowance: 0,
      };
    }
    const currentPeriodEnd = sub.currentPeriodEnd ?? null;
    const live = isLive(sub.status, currentPeriodEnd);
    return {
      userId: ctx.user.id,
      email: ctx.user.email,
      name: ctx.user.name ?? null,
      isSubscriber: live,
      status: sub.status,
      currentPeriodEnd,
      revealAllowance: live ? sub.revealAllowance ?? LEADS_PRO_MONTHLY_ALLOWANCE : 0,
    };
  } catch (err) {
    console.error('[leads.entitlement] soft-auth lookup failed (treating as free):', err);
    return ANONYMOUS;
  }
}

/** Resolve (and memoize) the caller's Leads Pro identity. Never throws. */
export function leadsIdentity(req: Request): Promise<LeadsIdentity> {
  const holder = req as Request & { [MEMO_KEY]?: Promise<LeadsIdentity> };
  if (!holder[MEMO_KEY]) {
    holder[MEMO_KEY] = computeIdentity(req);
  }
  return holder[MEMO_KEY]!;
}

/** Convenience boolean gate: is the caller a paying Leads Pro subscriber? */
export async function hasLeadsPro(req: Request): Promise<boolean> {
  return (await leadsIdentity(req)).isSubscriber;
}
