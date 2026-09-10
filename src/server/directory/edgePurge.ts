/**
 * Best-effort Cloudflare purge-by-URL for edge-cached PUBLIC pages.
 *
 * The carrier profile is served with `s-maxage=86400` (httpCache.ts), so a
 * write that changes it — a verified profile claim flipping the "Verified
 * owner" badge on — would otherwise stay invisible to visitors for up to a
 * day. When CLOUDFLARE_ZONE_ID + CLOUDFLARE_API_TOKEN (Cache Purge scope) are
 * set we ask the edge to drop those URLs; when they are not, or the call
 * fails, we do nothing and the TTL ages out. NEVER throws and never blocks the
 * caller's outcome: a purge is a nicety, the write is the fact.
 */
import { loadEnv } from '../../config.js';
import { exchangeTimeoutSignal } from '../../http/responseBody.js';

const PURGE_TIMEOUT_MS = 8_000;
/** Cloudflare caps purge-by-URL at 30 files per call. */
const MAX_FILES_PER_CALL = 30;

/** Canonical public origin of the directory (pages.ts SITE) plus the
 *  configured PUBLIC_BASE_URL when it differs — the two hosts a cached copy
 *  could live under. */
export function directoryOrigins(): string[] {
  const env = loadEnv();
  const base = env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const out = new Set<string>(['https://quotefleet.net']);
  if (/^https:\/\//.test(base)) out.add(base);
  return [...out];
}

/** Absolute URLs of a carrier profile on every directory origin. */
export function carrierProfileUrls(slug: string): string[] {
  const path = `/directory/carrier/${encodeURIComponent(slug)}`;
  return directoryOrigins().map((o) => `${o}${path}`);
}

export interface PurgeResult {
  attempted: boolean;
  ok: boolean;
  error?: string;
}

export async function purgeEdgeUrls(urls: string[]): Promise<PurgeResult> {
  const env = loadEnv();
  const zone = env.CLOUDFLARE_ZONE_ID;
  const token = env.CLOUDFLARE_API_TOKEN;
  if (!zone || !token || urls.length === 0) return { attempted: false, ok: false };
  try {
    for (let i = 0; i < urls.length; i += MAX_FILES_PER_CALL) {
      const files = urls.slice(i, i + MAX_FILES_PER_CALL);
      const r = await fetch(`https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(zone)}/purge_cache`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ files }),
        signal: exchangeTimeoutSignal(PURGE_TIMEOUT_MS),
      });
      if (!r.ok) {
        const body = (await r.text()).slice(0, 200);
        console.warn(`[edge-purge] cloudflare ${r.status}: ${body}`);
        return { attempted: true, ok: false, error: `HTTP ${r.status}` };
      }
    }
    return { attempted: true, ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[edge-purge] failed (non-fatal):', msg);
    return { attempted: true, ok: false, error: msg };
  }
}
