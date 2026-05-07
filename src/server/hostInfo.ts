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
import { eq } from 'drizzle-orm';
import { matchHostDomain } from '../config.js';
import { db } from '../db/client.js';
import { tenants } from '../db/schema.js';
import { LruCache } from './lruCache.js';

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
  const rawHost = (
    (req.headers['x-original-host'] as string) ||
    req.headers.host ||
    ''
  ).toLowerCase().split(':')[0];
  const baseDomain = matchHostDomain(rawHost);
  req.hostBaseDomain = baseDomain;
  req.tenantSubdomain = '';
  req.tenantCustomDomainSlug = '';

  // Path 1: platform-owned subdomain (`<slug>.quotefleet.app`).
  if (baseDomain && rawHost !== baseDomain) {
    const sub = rawHost.slice(0, rawHost.length - baseDomain.length - 1);
    if (sub && sub !== 'www' && !RESERVED_SUBDOMAINS.has(sub) && !sub.includes('.')) {
      req.tenantSubdomain = sub;
      return next();
    }
  }

  // Path 2: bare base domain — fall through to marketing site.
  if (baseDomain && rawHost === baseDomain) return next();

  // Path 3: custom domain (`quote.astova.com`). Look up tenants.custom_domain.
  if (rawHost) {
    const cached = customDomainCache.get(rawHost);
    if (cached !== undefined) {
      if (cached) req.tenantCustomDomainSlug = cached;
      return next();
    }
    try {
      const row = await db()
        .select({ slug: tenants.slug, customDomain: tenants.customDomain })
        .from(tenants)
        .where(eq(tenants.customDomain, rawHost))
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
