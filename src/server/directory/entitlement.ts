/**
 * Directory Pro entitlement — SOFT auth for the carrier-directory premium tier.
 *
 * A "Directory Pro" subscriber is a SHIPPER: a `users` row with `tenantId = null`
 * and `role = 'shipper'`, entitled via a `directory_subscriptions` row that is
 * FULLY DECOUPLED from `tenants.plan`. This module answers one question on any
 * request — "is the caller a paying Directory Pro shipper?" — WITHOUT ever
 * forcing a login:
 *
 *   • No session cookie  → free (NOT a 401). The directory stays public.
 *   • Session but no sub  → free.
 *   • Session + a live sub → Pro.
 *
 * "Live" = `status IN ('active','trialing')` AND (`current_period_end IS NULL`
 * OR it is still in the future).
 *
 * Memoized on the request object so several gate checks in one request hit the
 * DB at most once. NEVER throws — a DB hiccup degrades to "free", so a directory
 * page can never 500 because entitlement lookup failed. PR B layers the actual
 * feature gating on top of `hasDirectoryPro`; this PR only establishes the seam.
 */
import type { Request } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { directorySubscriptions } from '../../db/schema.js';
import { lookupSession, SESSION_COOKIE_NAME } from '../../auth/session.js';

export interface DirectoryIdentity {
  /** The logged-in user id, or null when there is no valid session. */
  userId: number | null;
  /** The logged-in user's email, or null when there is no valid session. */
  email: string | null;
  /** True only when a live Directory Pro subscription entitles this user. */
  isPro: boolean;
  /** Raw subscription status ('active' | 'trialing' | 'past_due' | 'inactive'),
   *  or null when the user has no subscription row / no session. */
  status: string | null;
  /** Current billing period end, or null when unknown / no subscription. */
  currentPeriodEnd: Date | null;
}

const ANONYMOUS: Readonly<DirectoryIdentity> = Object.freeze({
  userId: null,
  email: null,
  isPro: false,
  status: null,
  currentPeriodEnd: null,
});

/** Key under which the memoized identity PROMISE is cached on the request. */
const MEMO_KEY = '_dirIdentity';

/** True when a subscription row represents a live (entitling) subscription. */
function isLive(status: string | null, currentPeriodEnd: Date | null): boolean {
  if (status !== 'active' && status !== 'trialing') return false;
  if (currentPeriodEnd == null) return true;
  return currentPeriodEnd.getTime() > Date.now();
}

async function computeIdentity(req: Request): Promise<DirectoryIdentity> {
  try {
    const token = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
    const ctx = await lookupSession(token);
    if (!ctx) return ANONYMOUS;
    const sub = (
      await db()
        .select()
        .from(directorySubscriptions)
        .where(eq(directorySubscriptions.userId, ctx.user.id))
        .limit(1)
    )[0];
    if (!sub) {
      return { userId: ctx.user.id, email: ctx.user.email, isPro: false, status: null, currentPeriodEnd: null };
    }
    const currentPeriodEnd = sub.currentPeriodEnd ?? null;
    return {
      userId: ctx.user.id,
      email: ctx.user.email,
      isPro: isLive(sub.status, currentPeriodEnd),
      status: sub.status,
      currentPeriodEnd,
    };
  } catch (err) {
    // A DB hiccup must never 500 a public directory page — degrade to "free".
    console.error('[directory.entitlement] soft-auth lookup failed (treating as free):', err);
    return ANONYMOUS;
  }
}

/**
 * Resolve (and memoize) the caller's Directory identity for this request.
 * Caches the in-flight PROMISE on the request so concurrent gate calls share a
 * single DB round-trip. Never throws.
 */
export function directoryIdentity(req: Request): Promise<DirectoryIdentity> {
  const holder = req as Request & { [MEMO_KEY]?: Promise<DirectoryIdentity> };
  if (!holder[MEMO_KEY]) {
    holder[MEMO_KEY] = computeIdentity(req);
  }
  return holder[MEMO_KEY]!;
}

/** Convenience boolean gate: is the caller a paying Directory Pro shipper? */
export async function hasDirectoryPro(req: Request): Promise<boolean> {
  return (await directoryIdentity(req)).isPro;
}
