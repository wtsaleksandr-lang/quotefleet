/**
 * Host-aware routing.
 *
 * Each tenant has a subdomain on one of the platform-owned host domains
 * (configured in HOST_DOMAINS env var). When a request lands on
 * `<slug>.<base>` we want to:
 *   1. Resolve which tenant it is.
 *   2. Serve the widget HTML on `/`.
 *   3. Pass through everything else (chat, embed.js, API routes).
 *
 * The bare base domain still serves marketing + login + dashboard.
 *
 * Pro tier (later): tenants can map their own domain — `quote.astova.com`
 * CNAMEs to the platform. Looked up via `tenants.custom_domain`.
 */
import type { Request, Response, NextFunction } from 'express';
import { matchHostDomain } from '../config.js';
// `req.hostBaseDomain` and `req.tenantSubdomain` are augmented in
// src/types/express.d.ts (alongside the existing `req.user` / `req.tenant`).

/**
 * Parses the Host header and decorates `req` with `hostBaseDomain` and
 * `tenantSubdomain`. Mounted globally (before route handlers).
 *
 * We strip a leading `www.` because some users (or DNS providers) add
 * it automatically and we don't want it treated as a tenant slug.
 */
export function hostInfoMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const rawHost = (req.headers.host || '').toLowerCase().split(':')[0];
  const baseDomain = matchHostDomain(rawHost);
  req.hostBaseDomain = baseDomain;
  req.tenantSubdomain = '';

  if (!baseDomain || rawHost === baseDomain) return next();

  // Subdomain present on a platform-owned base domain.
  const sub = rawHost.slice(0, rawHost.length - baseDomain.length - 1);
  if (!sub) return next();
  // Treat `www.<base>` as the bare site, not a tenant.
  if (sub === 'www') return next();
  // Reserved subdomains the platform might use directly.
  const reserved = new Set([
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
  if (reserved.has(sub)) return next();
  // Multi-level (e.g. `staging.astova.quotefleet.app`) — only the deepest
  // single-label subdomain is treated as the tenant.
  if (sub.includes('.')) return next();

  req.tenantSubdomain = sub;
  next();
}
