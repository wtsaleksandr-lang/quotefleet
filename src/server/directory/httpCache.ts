/**
 * HTTP cache policy for the PUBLIC carrier-directory HTML.
 *
 * WHY THIS EXISTS: 0065's sitemap advertises ~334k carrier profiles plus every
 * city/state/port hub, and 0068 measured what that costs — every one of those
 * ~350k URLs was a full origin render + 2–4 DB reads on EVERY hit, by every bot,
 * forever, because not one directory HTML response carried a `Cache-Control`
 * header. With no header a shared cache MUST treat the response as
 * uncacheable, so re-crawls by Googlebot/Bingbot/GPTBot/Ahrefs/Semrush all
 * landed on the origin, and so did every repeat human visit.
 *
 * THE SAFETY CONTRACT — read this before adding a route to the cacheable set:
 *
 *   A shared cache is allowed to hand ONE visitor's response to ANOTHER
 *   visitor. `Vary: Cookie` is NOT a sufficient defence: Cloudflare (and most
 *   CDNs on their default cache key) ignore every `Vary` header except
 *   `Accept-Encoding`. We still emit it, because browsers and RFC-compliant
 *   proxies honour it — but it is defence in depth, never the guarantee.
 *
 *   The ONLY real guarantee is that the response body is BYTE-IDENTICAL for
 *   every visitor. So a route may use `setPublicDirectoryCache` only when its
 *   server HTML contains zero per-user state. Anything personalized — a signed-in
 *   email, an entitlement branch, saved lists, a reveal/quota counter, a
 *   prefilled form — must either move to client-side hydration (see
 *   NAV_SHIPPER_SCRIPT / CARRIER_PRO_HYDRATE_SCRIPT in pages.ts, which fetch
 *   /api/directory/auth/me AFTER the cached shell lands) or use `setNoStore`.
 *
 * `setPublicDirectoryCache` additionally REFUSES to mark a response public when
 * the request itself proves it cannot be shared:
 *   • a session cookie is present  → the response may have taken an authed
 *     branch, and it is this visitor's, not the public's;
 *   • `?ref=` is present           → partners.ts's global capture middleware
 *     fires `captureRefClick`, which drops the 90-day `qf_ref` cookie on this
 *     very response (app.ts registers it BEFORE the directory routes);
 *   • a `Set-Cookie` is already staged on the response, for any other reason.
 * Each of those degrades to `private, no-store` instead — fail CLOSED.
 *
 * FRESHNESS: carrier_directory is refreshed by the weekly FMCSA re-ingest
 * (Sunday 09:00 UTC — see directoryRefreshCron.ts), so a day of shared-cache
 * life can never serve data from a superseded ingest, and `stale-while-
 * revalidate` lets the edge answer instantly while it refetches in background.
 * The TTL is deliberately BOUNDED (not `immutable`, not a week): an admin
 * override, a `carrier_overrides.hidden` flag or a self-heal re-ingest must
 * reach the public within a day, not linger for the life of a CDN object.
 */
import type { Request, Response } from 'express';
import { SESSION_COOKIE_NAME } from '../../auth/session.js';

/** Browser-side TTL. Short: a person navigating the directory should see an
 *  admin fix or a fresh ingest quickly, and the shared-cache hit is the win. */
export const BROWSER_MAX_AGE_S = 300; // 5 minutes

/** Shared/CDN TTL. One day — comfortably inside the weekly ingest cadence, and
 *  bounded so nothing can be served stale "for weeks". */
export const CDN_S_MAXAGE_S = 86_400; // 24 hours

/** How long a shared cache may serve the stale object while it revalidates in
 *  the background. This is what turns a crawler re-hit into a zero-origin
 *  response even after the TTL lapses. */
export const STALE_WHILE_REVALIDATE_S = 604_800; // 7 days

/** The header value used for anonymous, byte-identical public directory HTML. */
export const PUBLIC_DIRECTORY_CACHE_CONTROL =
  `public, max-age=${BROWSER_MAX_AGE_S}, s-maxage=${CDN_S_MAXAGE_S}, stale-while-revalidate=${STALE_WHILE_REVALIDATE_S}`;

/** The header value for anything personalized. `private` keeps it out of shared
 *  caches; `no-store` keeps it off disk. */
export const NO_STORE_CACHE_CONTROL = 'private, no-store';

/** True when this request carries a session cookie (i.e. may be personalized). */
function hasSessionCookie(req: Request): boolean {
  const jar = (req as Request & { cookies?: Record<string, unknown> }).cookies;
  return typeof jar?.[SESSION_COOKIE_NAME] === 'string' && String(jar[SESSION_COOKIE_NAME]).length > 0;
}

/** True when a `Set-Cookie` is already staged on this response. */
function hasStagedCookie(res: Response): boolean {
  const v = res.getHeader('Set-Cookie');
  return Array.isArray(v) ? v.length > 0 : v != null;
}

/**
 * Is this request one whose response may be stored in a SHARED cache?
 *
 * Pure predicate over the request/response pair — exported so tests can pin the
 * fail-closed conditions without driving Express.
 */
export function isSharedCacheable(req: Request, res: Response): boolean {
  if ((req.method ?? 'GET') !== 'GET') return false;
  // partners.ts's `?ref=` capture drops a 90-day attribution cookie on ANY GET.
  // It is fire-and-forget, so the Set-Cookie may land after we set headers —
  // never mark a ?ref= response public, regardless of what is staged yet.
  if (typeof req.query?.ref === 'string' && req.query.ref) return false;
  if (hasSessionCookie(req)) return false;
  if (hasStagedCookie(res)) return false;
  return true;
}

/** Mark a response as never-cacheable (personalized or authenticated). */
export function setNoStore(res: Response): void {
  res.setHeader('Cache-Control', NO_STORE_CACHE_CONTROL);
}

/**
 * Apply the public directory cache policy — but ONLY when the request proves it
 * is shareable. Otherwise fall back to `private, no-store`.
 *
 * CALL THIS INSIDE THE HANDLER, never as middleware ahead of the rate limiter:
 * a limiter that rejects with 429 must not inherit a `public` header, or a
 * shared cache would pin one IP's 429 onto the URL for everyone.
 */
export function setPublicDirectoryCache(req: Request, res: Response): void {
  if (!isSharedCacheable(req, res)) {
    setNoStore(res);
    return;
  }
  res.setHeader('Cache-Control', PUBLIC_DIRECTORY_CACHE_CONTROL);
  // Honoured by browsers and RFC-compliant proxies. NOT honoured by Cloudflare —
  // see the safety contract above; byte-identical HTML is the real guarantee.
  res.vary('Cookie');
  // express-rate-limit's draft-7 headers are PER-IP. Freezing one visitor's
  // remaining budget into a shared cache object would hand everyone else a
  // meaningless (and eventually alarming) counter, so drop them from the
  // responses that are allowed to be shared.
  res.removeHeader('RateLimit');
  res.removeHeader('RateLimit-Policy');
  res.removeHeader('RateLimit-Limit');
  res.removeHeader('RateLimit-Remaining');
  res.removeHeader('RateLimit-Reset');
}
