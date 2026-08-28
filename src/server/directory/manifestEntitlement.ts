/**
 * Manifest Privacy entitlement — SOFT auth for the managed CBP
 * vessel-manifest-confidentiality service. Cloned from the Directory Pro
 * entitlement (entitlement.ts): a subscriber is a SHIPPER (`users` row,
 * `tenantId = null`), entitled via a `manifest_subscriptions` row that is FULLY
 * DECOUPLED from `tenants.plan`. It answers "is the caller a paying Manifest
 * Privacy subscriber, and at which tier?" WITHOUT ever forcing a login:
 *
 *   • No session cookie  → free (NOT a 401). Onboarding stays public.
 *   • Session but no sub  → free.
 *   • Session + a live sub → the tier they bought.
 *
 * "Live" = `status IN ('active','trialing')` AND (`current_period_end IS NULL`
 * OR still in the future). Memoized on the request; NEVER throws (a DB hiccup
 * degrades to "free" so a public page can never 500 on entitlement lookup).
 *
 * This module also owns the TIER METADATA (price, features, entity quota, Stripe
 * price-env mapping) and the graceful-degrade rule: a tier whose Stripe price id
 * is UNSET is "coming soon" — its checkout button never crashes.
 */
import type { Request } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { manifestSubscriptions, type ManifestTier } from '../../db/schema.js';
import { lookupSession, SESSION_COOKIE_NAME } from '../../auth/session.js';
import { loadEnv } from '../../config.js';

export interface ManifestTierMeta {
  tier: ManifestTier;
  name: string;
  /** Annual price in USD (display only — Stripe holds the source of truth). */
  priceUsd: number;
  /** How many distinct legal entities the plan may protect. */
  entityQuota: number;
  /** The env var holding this tier's Stripe Price id. */
  priceEnvKey: 'STRIPE_PRICE_MANIFEST_BASIC' | 'STRIPE_PRICE_MANIFEST_PRO' | 'STRIPE_PRICE_MANIFEST_ENT';
  /** Short marketing feature bullets (honest-claims safe). */
  features: string[];
}

/** The three annual tiers. Order = display order. */
export const MANIFEST_TIERS: readonly ManifestTierMeta[] = [
  {
    tier: 'basic',
    name: 'Basic',
    priceUsd: 79,
    entityQuota: 1,
    priceEnvKey: 'STRIPE_PRICE_MANIFEST_BASIC',
    features: [
      'CBP confidentiality filing for 1 business entity',
      'Suppresses your name & address on future manifest records',
      'Not retroactive — already-published shipments stay published',
      'Hidden on QuoteFleet immediately, while CBP processes',
      '2-year renewal tracking, refiled before it lapses',
    ],
  },
  {
    tier: 'professional',
    name: 'Professional',
    priceUsd: 249,
    entityQuota: 5,
    priceEnvKey: 'STRIPE_PRICE_MANIFEST_PRO',
    features: [
      'CBP confidentiality filing for up to 5 business entities',
      'Suppresses each entity on future manifest records',
      'Not retroactive — already-published shipments stay published',
      'Document-based intake ("Documents on file")',
      'Branded POA PDF, priority filing & status timeline',
    ],
  },
  {
    tier: 'enterprise',
    name: 'Enterprise',
    priceUsd: 599,
    entityQuota: 100,
    priceEnvKey: 'STRIPE_PRICE_MANIFEST_ENT',
    features: [
      'CBP confidentiality filing across your whole entity portfolio',
      'Suppresses every entity on future manifest records',
      'Not retroactive — already-published shipments stay published',
      'Bulk / multi-entity intake (CSV) + optional KYB add-on',
      'Dedicated account manager, priority filing & renewals',
    ],
  },
];

export function tierMeta(tier: ManifestTier): ManifestTierMeta {
  return MANIFEST_TIERS.find((t) => t.tier === tier) ?? MANIFEST_TIERS[0];
}

/** The configured Stripe Price id for a tier, or null when UNSET (→ coming soon). */
export function manifestPriceId(tier: ManifestTier): string | null {
  const env = loadEnv();
  const key = tierMeta(tier).priceEnvKey;
  return (env[key] as string | undefined) || null;
}

/** True when Stripe AND this tier's price id are configured — i.e. checkout is
 *  live. A tier with no price id degrades to "coming soon" (never crashes). */
export function manifestTierPurchasable(tier: ManifestTier): boolean {
  const env = loadEnv();
  return !!env.STRIPE_SECRET_KEY && !!manifestPriceId(tier);
}

export interface ManifestIdentity {
  userId: number | null;
  email: string | null;
  name?: string | null;
  /** True only when a live Manifest Privacy subscription entitles this user. */
  isSubscriber: boolean;
  /** The live tier, or null when free / no live sub. */
  tier: ManifestTier | null;
  status: string | null;
  currentPeriodEnd: Date | null;
  entityQuota: number;
}

const ANONYMOUS: Readonly<ManifestIdentity> = Object.freeze({
  userId: null,
  email: null,
  name: null,
  isSubscriber: false,
  tier: null,
  status: null,
  currentPeriodEnd: null,
  entityQuota: 0,
});

const MEMO_KEY = '_manifestIdentity';

function isLive(status: string | null, currentPeriodEnd: Date | null): boolean {
  if (status !== 'active' && status !== 'trialing') return false;
  if (currentPeriodEnd == null) return true;
  return currentPeriodEnd.getTime() > Date.now();
}

async function computeIdentity(req: Request): Promise<ManifestIdentity> {
  try {
    const token = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
    const ctx = await lookupSession(token);
    if (!ctx) return ANONYMOUS;
    const sub = (
      await db()
        .select()
        .from(manifestSubscriptions)
        .where(eq(manifestSubscriptions.userId, ctx.user.id))
        .limit(1)
    )[0];
    if (!sub) {
      return {
        userId: ctx.user.id,
        email: ctx.user.email,
        name: ctx.user.name ?? null,
        isSubscriber: false,
        tier: null,
        status: null,
        currentPeriodEnd: null,
        entityQuota: 0,
      };
    }
    const currentPeriodEnd = sub.currentPeriodEnd ?? null;
    const live = isLive(sub.status, currentPeriodEnd);
    return {
      userId: ctx.user.id,
      email: ctx.user.email,
      name: ctx.user.name ?? null,
      isSubscriber: live,
      tier: live ? (sub.tier as ManifestTier) : null,
      status: sub.status,
      currentPeriodEnd,
      entityQuota: sub.entityQuota ?? 0,
    };
  } catch (err) {
    console.error('[manifest.entitlement] soft-auth lookup failed (treating as free):', err);
    return ANONYMOUS;
  }
}

/** Resolve (and memoize) the caller's Manifest Privacy identity. Never throws. */
export function manifestIdentity(req: Request): Promise<ManifestIdentity> {
  const holder = req as Request & { [MEMO_KEY]?: Promise<ManifestIdentity> };
  if (!holder[MEMO_KEY]) {
    holder[MEMO_KEY] = computeIdentity(req);
  }
  return holder[MEMO_KEY]!;
}

/** Convenience boolean gate: is the caller a paying Manifest Privacy subscriber? */
export async function hasManifestSubscription(req: Request): Promise<boolean> {
  return (await manifestIdentity(req)).isSubscriber;
}
