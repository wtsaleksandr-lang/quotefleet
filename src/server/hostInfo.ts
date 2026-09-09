/**
 * Host-aware routing.
 *
 * Each tenant has a subdomain on one of the platform-owned host domains
 * (configured in HOST_DOMAINS env var). When a request lands on
 * `<slug>.<base>` we resolve the tenant from the subdomain.
 *
 * Pro tier: tenants can also map a custom domain (e.g. `quote.astova.com`)
 * which CNAMEs to the platform. We look that up by exact host match
 * against `tenants.custom_domain`. Domain claims must be verified first
 * (TXT record check) — see /api/tenant/custom-domain endpoints.
 *
 * Custom-domain lookups are cached in-memory for 60s to keep the request
 * path fast (one DB query on miss, free on hit).
 */
import type { Request, Response, NextFunction } from 'express';
import { and, eq, isNotNull } from 'drizzle-orm';
import { loadEnv, matchHostDomain } from '../config.js';
import { db } from '../db/client.js';
import { tenants } from '../db/schema.js';
import { LruCache } from './lruCache.js';

let warnedNoSecret = false;

// `req.hostBaseDomain`, `req.tenantSubdomain`, `req.tenantCustomDomainSlug`
// are augmented in src/types/express.d.ts (alongside `req.user` / `req.tenant`).

const customDomainCache = new LruCache<string | null>(500, 60 * 1000);

const RESERVED_SUBDOMAINS = new Set([
  'app',
  'admin',
  'api',
  'mail',
  'docs',
  'help',
  'status',
  'static',
  'cdn',
  'assets',
]);

/**
 * Can this host possibly be a tenant's custom domain?
 *
 * WHY THIS GUARD EXISTS. Path 3 below runs a DATABASE QUERY for any host that
 * is neither the base domain nor a subdomain of it — and that set includes
 * `127.0.0.1`, which is the host Replit's VM supervisor uses when it probes
 * `GET /` on the loopback listener. A platform health probe reaching the
 * database is the shape of the failure that took production down for a day on
 * 2026-09-08, so it is worth making structurally impossible rather than
 * merely unlikely.
 *
 * There is already a loopback shortcut registered ahead of this middleware in
 * app.ts, but it identifies a probe partly by USER-AGENT — empty,
 * `go-http-client/`, `kube-probe/`. That is a guess about someone else's
 * client, and it silently stops being true the day the supervisor changes its
 * agent string. This guard does not depend on knowing who is calling.
 *
 * The rule itself is simply what a custom domain IS. An operator points a real
 * hostname at us with a CNAME and proves ownership with a TXT record, so
 * `tenants.custom_domain` can only ever hold a registrable domain name. An IP
 * literal cannot be CNAMEd and cannot carry a TXT claim; a dotless label
 * (`localhost`, `[::1]` once the port is stripped) is not a registrable name
 * either. Neither can match a row, so the query can only ever return nothing.
 *
 * This changes no routing decision — it removes a lookup whose answer was
 * already known.
 */
function couldBeACustomDomain(host: string): boolean {
  // A registrable name has at least one dot. This also excludes `localhost`
  // and the `[` left behind when `[::1]:5000` is split on its colon.
  if (!host.includes('.')) return false;
  // An IPv4 literal has dots but is not a name.
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return false;
  return true;
}

/**
 * Parses the Host header and decorates the request with one of:
 *   - `tenantSubdomain` — the slug from `<slug>.<HOST_DOMAINS entry>`
 *   - `tenantCustomDomainSlug` — slug looked up from `tenants.custom_domain`
 *
 * Reserved/system subdomains and `www.` are treated as the bare site.
 */
export async function hostInfoMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  // When fronted by the CF Worker wildcard proxy, the original tenant
  // hostname arrives in X-Original-Host (Worker rewrites Host to Replit's).
  // We only honor that header if the request also presents a matching
  // X-Worker-Auth — otherwise any direct visitor could spoof it.
  // If WORKER_AUTH_SECRET is not configured, we fall back to trusting
  // X-Original-Host (legacy / dev behavior) and log a one-time warning.
  const env = loadEnv();
  const expectedSecret = env.WORKER_AUTH_SECRET;
  const presentedSecret = req.headers['x-worker-auth'];
  let trustOriginalHost: boolean;
  if (expectedSecret) {
    trustOriginalHost =
      typeof presentedSecret === 'string' && presentedSecret === expectedSecret;
    if (!trustOriginalHost && req.headers['x-original-host']) {
      console.warn(
        `[hostInfo] X-Original-Host present (${String(req.headers['x-original-host'])}) but X-Worker-Auth missing/wrong — ignoring header.`
      );
    }
  } else {
    trustOriginalHost = true;
    if (!warnedNoSecret) {
      warnedNoSecret = true;
      console.warn(
        '[hostInfo] WORKER_AUTH_SECRET is not set. Falling back to trusting X-Original-Host from any source. ' +
          'In production, set WORKER_AUTH_SECRET (Replit Secrets) and the same value as a Worker secret on Cloudflare to lock this down.'
      );
    }
  }
  const originalHost = trustOriginalHost
    ? (req.headers['x-original-host'] as string | undefined)
    : undefined;
  const rawHost = (
    originalHost ||
    req.headers.host ||
    ''
  ).toLowerCase().split(':')[0];
  const baseDomain = matchHostDomain(rawHost);
  req.hostBaseDomain = baseDomain;
  req.tenantSubdomain = '';
  req.tenantCustomDomainSlug = '';

  // Path 1: platform-owned subdomain (`<slug>.quotefleet.net`).
  if (baseDomain && rawHost !== baseDomain) {
    const sub = rawHost.slice(0, rawHost.length - baseDomain.length - 1);
    if (sub && sub !== 'www' && !RESERVED_SUBDOMAINS.has(sub) && !sub.includes('.')) {
      req.tenantSubdomain = sub;
      return next();
    }
  }

  /*
   * Path 2: ANY host on a domain we own is us, not a customer's custom domain.
   *
   * This used to read `rawHost === baseDomain`, which let `www.quotefleet.net`
   * and every reserved subdomain — app, admin, api, mail, docs, help, status,
   * static, cdn, assets — fall past Path 1 (which deliberately declines them)
   * into the Path 3 CUSTOM-DOMAIN LOOKUP, and run a database query on every
   * request until the 60-second cache filled. The comment above this function
   * has always said those hosts are "treated as the bare site"; they were not.
   *
   * The query could never have matched. `tenants.custom_domain` holds domains an
   * operator pointed at us and proved with a TXT record, and nobody proves
   * ownership of a subdomain of ours. `matchHostDomain` is true only for our own
   * HOST_DOMAINS entries and their subdomains, so this is the same statement the
   * old line made, applied to the whole set it should always have covered.
   */
  if (baseDomain) return next();

  // Path 3: custom domain (`quote.astova.com`). Look up tenants.custom_domain.
  // Only for a host that could actually BE one — see couldBeACustomDomain, which
  // keeps loopback health probes off the database entirely.
  if (rawHost && couldBeACustomDomain(rawHost)) {
    const cached = customDomainCache.get(rawHost);
    if (cached !== undefined) {
      if (cached) req.tenantCustomDomainSlug = cached;
      return next();
    }
    try {
      // Only route a custom domain if its TXT-based ownership claim has
      // been verified — `customDomainVerifiedAt` non-null. An unverified
      // claim is just a request waiting on DNS, NOT a permission to
      // serve the operator's site as them.
      const row = await db()
        .select({ slug: tenants.slug })
        .from(tenants)
        .where(
          and(
            eq(tenants.customDomain, rawHost),
            isNotNull(tenants.customDomainVerifiedAt)
          )
        )
        .limit(1);
      const slug = row[0]?.slug ?? null;
      customDomainCache.set(rawHost, slug);
      if (slug) req.tenantCustomDomainSlug = slug;
    } catch (err) {
      console.warn('[hostInfo] custom-domain lookup failed (non-fatal):', err);
    }
  }

  next();
}

/** Used elsewhere to fetch the resolved tenant slug regardless of which
 *  routing path got us here. */
export function effectiveTenantSlug(req: Request): string {
  return req.tenantSubdomain || req.tenantCustomDomainSlug || '';
}
