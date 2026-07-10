/**
 * Calculator access control — PUBLIC vs PRIVATE (invite-only).
 *
 * A tenant with `access_mode = 'private'` locks their calculator: both the
 * hosted page (`/w/:slug`, the subdomain, custom domains) AND every public
 * rate/quote API endpoint refuse anonymous requests. Access is granted by
 * opening a per-customer invite link (`…/?key=<token>`), which validates the
 * token against `access_links` and drops a signed, httpOnly, tenant-scoped
 * cookie. Revoking a link (active = false) cuts it off immediately.
 *
 * The lock lives at the DATA layer (public.ts / autocomplete.ts), not just
 * the page — hitting the API directly with a private tenant's slug and no
 * grant fails. The page gate is a UX nicety on top.
 *
 * Cookie: `qf_acc_<tenantId>` = `<expiryMs>.<hmac>` where
 *   hmac = HMAC-SHA256(SESSION_SECRET, `access:<tenantId>:<expiryMs>`).
 * Self-signed (not via cookie-parser's secret) so it's independent of the
 * login-session machinery and scoped to exactly one tenant. Unforgeable
 * without SESSION_SECRET; expiry baked into the signed payload.
 */
import type { Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { accessLinks, brandConfigs, type Tenant, type BrandConfig } from '../db/schema.js';
import { loadEnv } from '../config.js';

/** Per-tenant cookie name prefix. Final name: `qf_acc_<tenantId>`. */
export const ACCESS_COOKIE_PREFIX = 'qf_acc_';

/** Grant lifetime — 30 days, matching the login-session TTL. */
export const ACCESS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Owner-preview grant — the authenticated dashboard mints one so the tenant
 * owner can preview their OWN calculator in the live-preview iframes even when
 * the calculator is private. It rides in the URL (`?pk=`) so it survives the
 * cross-origin hop to the widget host (the dashboard's auth cookie does not).
 *
 * Same HMAC scheme as the access cookie (so it's tenant-scoped + unforgeable),
 * but SHORT-lived: it grants nobody lasting access, only a ~30-min preview
 * window. It is NOT a public/shareable link — the value verifies only for the
 * tenant it was minted for, which only that tenant's owner can request.
 */
export const PREVIEW_GRANT_PARAM = 'pk';
/** Owner-preview grant lifetime — 30 minutes. */
export const PREVIEW_GRANT_TTL_MS = 30 * 60 * 1000;

export function accessCookieName(tenantId: number): string {
  return ACCESS_COOKIE_PREFIX + tenantId;
}

function signGrant(tenantId: number, expiryMs: number): string {
  return createHmac('sha256', loadEnv().SESSION_SECRET)
    .update(`access:${tenantId}:${expiryMs}`)
    .digest('hex');
}

/** Build a fresh signed cookie value granting access to `tenantId`. */
export function makeAccessCookieValue(tenantId: number, ttlMs: number = ACCESS_TTL_MS): string {
  const expiry = Date.now() + ttlMs;
  return `${expiry}.${signGrant(tenantId, expiry)}`;
}

/** Verify a cookie value is a valid, unexpired grant for `tenantId`.
 *  Constant-time signature comparison; rejects tampered/expired values. */
export function verifyAccessCookieValue(
  tenantId: number,
  value: string | undefined | null
): boolean {
  if (!value || typeof value !== 'string') return false;
  const dot = value.indexOf('.');
  if (dot <= 0) return false;
  const expiry = Number(value.slice(0, dot));
  const sig = value.slice(dot + 1);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return false;
  const expected = signGrant(tenantId, expiry);
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** True if the request carries a valid signed access cookie for the tenant. */
export function hasValidAccessCookie(tenantId: number, req: Request): boolean {
  const raw = (req.cookies ?? {})[accessCookieName(tenantId)];
  return verifyAccessCookieValue(tenantId, raw);
}

/** Mint a signed, tenant-scoped, short-lived owner-preview grant. Reuses the
 *  access-cookie HMAC scheme — only useful to the owner of `tenantId`. */
export function makePreviewGrant(tenantId: number): string {
  return makeAccessCookieValue(tenantId, PREVIEW_GRANT_TTL_MS);
}

/** Read the owner-preview grant from the request query (`?pk=`). */
export function previewGrantFromReq(req: Request): string {
  const q = req.query?.[PREVIEW_GRANT_PARAM];
  return typeof q === 'string' && q.trim() ? q.trim() : '';
}

/** True if the request carries a valid, unexpired signed preview grant for the
 *  tenant. Signature-verified + tenant-scoped: a grant minted for tenant A can
 *  never unlock tenant B's private widget. */
export function hasValidPreviewGrant(tenantId: number, req: Request): boolean {
  return verifyAccessCookieValue(tenantId, previewGrantFromReq(req));
}

/** Extract an invite token from the request (`?key=` or `:token` path param). */
export function accessTokenFromReq(req: Request): string {
  const q = req.query?.key;
  if (typeof q === 'string' && q.trim()) return q.trim();
  const p = req.params?.token;
  if (typeof p === 'string' && p.trim()) return p.trim();
  return '';
}

/** Injectable token check — returns true iff `token` is an ACTIVE link for
 *  this tenant. Read-only (no side effects), safe to call from API gates. */
export type TokenLookup = (tenantId: number, token: string) => Promise<boolean>;

/** DB-backed default lookup: token exists, active, belongs to tenant. */
export const activeTokenExists: TokenLookup = async (tenantId, token) => {
  if (!token) return false;
  const rows = await db()
    .select({ id: accessLinks.id })
    .from(accessLinks)
    .where(
      and(
        eq(accessLinks.token, token),
        eq(accessLinks.tenantId, tenantId),
        eq(accessLinks.active, true)
      )
    )
    .limit(1);
  return !!rows[0];
};

/**
 * THE core access decision. Pure except for the injected token lookup, so
 * it's unit-testable without a DB.
 *
 *   public tenant                          → always allowed
 *   private + valid signed cookie          → allowed
 *   private + valid active invite token    → allowed
 *   private, otherwise                      → DENIED
 */
export async function tenantAccessAllowed(
  tenant: Pick<Tenant, 'id' | 'accessMode'>,
  req: Request,
  lookup: TokenLookup = activeTokenExists
): Promise<boolean> {
  if (tenant.accessMode !== 'private') return true;
  if (hasValidAccessCookie(tenant.id, req)) return true;
  // Signed owner-preview grant (`?pk=`) — lets the tenant owner preview their
  // OWN private calculator (and its rate/quote APIs) from the dashboard iframe.
  // Tenant-scoped + short-lived; forgeable only with SESSION_SECRET.
  if (hasValidPreviewGrant(tenant.id, req)) return true;
  const token = accessTokenFromReq(req);
  if (token && (await lookup(tenant.id, token))) return true;
  return false;
}

/** API-endpoint guard. Returns true if allowed; otherwise writes a 403 and
 *  returns false (caller should `return` immediately). */
export async function enforceTenantAccess(
  tenant: Pick<Tenant, 'id' | 'accessMode'>,
  req: Request,
  res: Response
): Promise<boolean> {
  const ok = await tenantAccessAllowed(tenant, req);
  if (!ok) {
    res.status(403).json({
      error: 'access_denied',
      message: 'This calculator is private. Open the access link the company shared with you.',
    });
    return false;
  }
  return true;
}

/** Consume an invite token: if valid + active for the tenant, bump usage
 *  stats and return true. Used only on the page-entry path (`?key=`). */
export async function consumeAccessToken(tenantId: number, token: string): Promise<boolean> {
  if (!token) return false;
  const rows = await db()
    .update(accessLinks)
    .set({ lastUsedAt: new Date(), useCount: sql`${accessLinks.useCount} + 1` })
    .where(
      and(
        eq(accessLinks.token, token),
        eq(accessLinks.tenantId, tenantId),
        eq(accessLinks.active, true)
      )
    )
    .returning({ id: accessLinks.id });
  return !!rows[0];
}

/** Set the signed, httpOnly, tenant-scoped access cookie on the response.
 *  `ttlMs` defaults to the full grant lifetime; pass a shorter value for a
 *  time-boxed grant (e.g. the owner-preview window). */
export function setAccessCookie(res: Response, tenantId: number, ttlMs: number = ACCESS_TTL_MS): void {
  const env = loadEnv();
  const isHttps =
    (env.PUBLIC_BASE_URL ?? '').startsWith('https://') ||
    process.env.NODE_ENV === 'production';
  res.cookie(accessCookieName(tenantId), makeAccessCookieValue(tenantId, ttlMs), {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps,
    maxAge: ttlMs,
    path: '/',
  });
}

function esc(s: string | null | undefined): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
  );
}

/**
 * Branded "private calculator" gate page — shown when a private tenant is
 * reached without a valid grant. Shows the company name/logo and a short
 * instruction. NO rates, NO calculator markup. Dark, on-brand (QuoteFleet
 * blue accent, cream heading), self-contained (inline styles).
 */
export function renderGatePage(
  tenant: Pick<Tenant, 'name'>,
  brand: Pick<BrandConfig, 'logoUrl' | 'displayName'> | null
): string {
  const company = esc(brand?.displayName || tenant.name || 'This company');
  const logo = brand?.logoUrl
    ? `<img src="${esc(brand.logoUrl)}" alt="${company}" class="gate-logo" />`
    : `<div class="gate-mark" aria-hidden="true">${esc(company.slice(0, 1).toUpperCase())}</div>`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>Private rate calculator — ${company}</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    html, body { height: 100%; margin: 0; }
    body {
      font-family: 'Satoshi', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: #161616;
      color: #ECECEC;
      display: flex; align-items: center; justify-content: center;
      padding: 24px;
      -webkit-font-smoothing: antialiased;
    }
    .gate {
      width: 100%; max-width: 440px;
      background: #1C1C1C;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 16px;
      padding: 40px 32px;
      text-align: center;
    }
    .gate-logo { max-height: 56px; max-width: 200px; object-fit: contain; margin: 0 auto 20px; display: block; }
    .gate-mark {
      width: 56px; height: 56px; margin: 0 auto 20px;
      border-radius: 14px;
      background: linear-gradient(135deg, #0D3CFC, #6E8BFF);
      color: #fff; font-size: 26px; font-weight: 700;
      display: flex; align-items: center; justify-content: center;
    }
    .gate-badge {
      display: inline-block; font-size: 12px; font-weight: 600; letter-spacing: 0.04em;
      text-transform: uppercase; color: #6E8BFF;
      border: 1px solid rgba(110,139,255,0.35); border-radius: 999px;
      padding: 4px 12px; margin-bottom: 16px;
    }
    h1 { font-size: 22px; line-height: 1.3; margin: 0 0 12px; color: #F5EFE0; font-weight: 700; }
    p { font-size: 15px; line-height: 1.6; margin: 0 auto; color: #B4B4B4; max-width: 340px; }
    .gate-company { color: #ECECEC; font-weight: 600; }
    .gate-foot { margin-top: 28px; font-size: 12px; color: #6E6E6E; }
  </style>
</head>
<body>
  <main class="gate" role="main">
    ${logo}
    <span class="gate-badge">Private calculator</span>
    <h1>This rate calculator is private</h1>
    <p>Please use the access link <span class="gate-company">${company}</span> shared with you, or contact them to request one.</p>
    <div class="gate-foot">Powered by QuoteFleet</div>
  </main>
</body>
</html>`;
}
