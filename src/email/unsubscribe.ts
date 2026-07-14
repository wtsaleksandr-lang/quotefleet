/**
 * Signed unsubscribe tokens for marketing/lifecycle emails.
 *
 * A token is an HMAC-SHA256 of the tenantId, keyed with the existing
 * `SESSION_SECRET` (the same app secret used by src/server/access.ts for
 * signed access grants — we reuse it rather than minting a new secret). The
 * token is unforgeable without the secret, so `GET/POST /unsubscribe?token=…`
 * can flip a tenant's opt-out flag with no login.
 *
 * Format: `<tenantId>.<hexSig>`
 *
 * No expiry is baked in — unsubscribe links must stay honorable indefinitely
 * (CAN-SPAM requires honoring an opt-out for at least 30 days and in practice
 * forever); an expiring unsubscribe link would be a compliance bug, not a
 * feature.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { loadEnv } from '../config.js';

function sign(tenantId: number): string {
  return createHmac('sha256', loadEnv().SESSION_SECRET)
    .update(`unsubscribe:${tenantId}`)
    .digest('hex');
}

/** Build a signed unsubscribe token for `tenantId`. */
export function makeUnsubscribeToken(tenantId: number): string {
  return `${tenantId}.${sign(tenantId)}`;
}

/**
 * Verify a token and return the tenantId it authorizes, or `null` if the
 * token is missing, malformed, or the signature doesn't match. Constant-time
 * signature comparison; a tampered token can never resolve to a tenantId.
 */
export function verifyUnsubscribeToken(token: string | undefined | null): number | null {
  if (!token || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const tenantId = Number(token.slice(0, dot));
  if (!Number.isInteger(tenantId) || tenantId <= 0) return null;
  const sig = token.slice(dot + 1);
  const expected = sign(tenantId);
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  return tenantId;
}

/** Full tokenized unsubscribe URL for `tenantId`, rooted at `baseUrl`
 *  (trailing slash tolerated). Used to build the List-Unsubscribe header and
 *  the visible footer link. */
export function unsubscribeUrl(baseUrl: string, tenantId: number): string {
  const base = baseUrl.replace(/\/$/, '');
  return `${base}/unsubscribe?token=${encodeURIComponent(makeUnsubscribeToken(tenantId))}`;
}
