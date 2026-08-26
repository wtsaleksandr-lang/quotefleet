/**
 * Free-search quota + credit meter for the Importer Search feature (/importers).
 *
 * The browse path spends real ImportYeti credits on a cache MISS. To convert
 * motivated users and cap casual credit drain, a NEW visitor gets a small number
 * of free LIVE searches (FREE_SEARCH_QUOTA, default 3). After the quota is used
 * the page shows a "Subscribe to keep searching" CTA instead of spending another
 * credit.
 *
 * Design (deliberately SOFT — the goal is conversion + a spend ceiling, not
 * perfect enforcement; clearing cookies resets it and that is acceptable):
 *   • Per-visitor counter in a cookie (authoritative for the gate).
 *   • Per-IP daily counter in memory as a BACKSTOP so repeatedly clearing
 *     cookies from one host can't drain credits without bound.
 *   • ONLY a live ImportYeti pull (a cache miss that actually spends a credit)
 *     decrements the quota. A search served entirely from importer_bol_cache
 *     costs us nothing and is ALWAYS free to browse — this keeps popular / repeat
 *     searches open (good for SEO + UX) while bounding real spend to N live pulls.
 *
 * `checkSearchQuota(req)` is the reusable gate: a follow-up build (the company
 * profile page) reuses it to gate "open detailed profile" against the same quota.
 */
import type { Request, Response } from 'express';

/** Read a positive integer from the environment, else fall back. */
const envInt = (name: string, fallback: number): number => {
  const raw = process.env[name];
  const n = raw != null ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

/** Free LIVE searches a new visitor gets before the subscribe wall. */
export const FREE_SEARCH_QUOTA = envInt('IMPORTER_FREE_SEARCHES', 3);
/** Per-IP daily live-pull backstop (bounds cookie-clearing abuse). */
export const IP_DAILY_LIVE_CAP = envInt('IMPORTER_IP_DAILY_LIVE_PULLS', 30);

/** Cookie carrying the per-visitor used-live-search count. */
export const QUOTA_COOKIE = 'qf_imp_free';
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface QuotaState {
  /** True while the visitor may still perform a LIVE (credit-spending) search. */
  allowed: boolean;
  /** Free live searches left (min of cookie remaining and IP-backstop remaining). */
  remaining: number;
  /** Live searches this visitor has already spent (from the cookie). */
  used: number;
  /** The configured free quota (FREE_SEARCH_QUOTA). */
  limit: number;
}

const UTC_DAY = (): string => new Date().toISOString().slice(0, 10);

/** In-memory per-IP daily counter (backstop only). Single Reserved-VM instance,
 *  so an in-memory map is sufficient — mirrors the express-rate-limit posture. */
const ipDaily = new Map<string, { day: string; count: number }>();

/** Prune stale day buckets opportunistically so the map can't grow unbounded. */
function ipUsedToday(ip: string): number {
  const day = UTC_DAY();
  const b = ipDaily.get(ip);
  if (!b || b.day !== day) return 0;
  return b.count;
}
function bumpIp(ip: string): void {
  const day = UTC_DAY();
  const b = ipDaily.get(ip);
  if (!b || b.day !== day) {
    // New day (or first hit) — reset and lightly GC other stale buckets.
    if (ipDaily.size > 5000) {
      for (const [k, v] of ipDaily) if (v.day !== day) ipDaily.delete(k);
    }
    ipDaily.set(ip, { day, count: 1 });
  } else {
    b.count += 1;
  }
}

/** Best-effort client IP (req.ip is the real client behind trust-proxy). */
function clientIp(req: Request): string {
  return (req.ip || (req.socket && req.socket.remoteAddress) || 'unknown').toString();
}

/** Parse the used-count from the request cookie (no cookie-parser dependency). */
export function readCookieUsed(req: Request): number {
  // Prefer a parsed cookies object if some middleware populated it.
  const parsed = (req as Request & { cookies?: Record<string, unknown> }).cookies;
  let raw: string | undefined;
  if (parsed && typeof parsed[QUOTA_COOKIE] === 'string') {
    raw = parsed[QUOTA_COOKIE] as string;
  } else {
    const header = req.headers?.cookie;
    if (typeof header === 'string') {
      const m = header.match(new RegExp('(?:^|;\\s*)' + QUOTA_COOKIE + '=([^;]*)'));
      if (m) raw = decodeURIComponent(m[1]);
    }
  }
  const n = raw != null ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * The reusable quota gate. Returns whether the visitor may still spend a LIVE
 * search credit and how many free searches remain. Reads the per-visitor cookie
 * and the per-IP daily backstop; NEVER mutates state (recording a spend is the
 * caller's explicit `recordLiveSearch` after a pull actually happened).
 */
export function checkSearchQuota(req: Request): QuotaState {
  const cookieUsed = readCookieUsed(req);
  const cookieRemaining = Math.max(0, FREE_SEARCH_QUOTA - cookieUsed);
  const ipRemaining = Math.max(0, IP_DAILY_LIVE_CAP - ipUsedToday(clientIp(req)));
  const remaining = Math.min(cookieRemaining, ipRemaining);
  return { allowed: remaining > 0, remaining, used: cookieUsed, limit: FREE_SEARCH_QUOTA };
}

/**
 * Record ONE live (credit-spending) search: bump the visitor cookie + the per-IP
 * daily backstop. Call this ONLY after a live ImportYeti pull actually happened
 * (a cache hit must never reach here). Returns the post-increment quota state.
 */
export function recordLiveSearch(req: Request, res: Response): QuotaState {
  const nextUsed = readCookieUsed(req) + 1;
  try {
    res.cookie(QUOTA_COOKIE, String(nextUsed), {
      maxAge: COOKIE_MAX_AGE_MS,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    });
  } catch {
    // res.cookie unavailable (non-Express test double) — the IP backstop and the
    // returned state still hold; never break the search on a cookie failure.
  }
  bumpIp(clientIp(req));
  const cookieRemaining = Math.max(0, FREE_SEARCH_QUOTA - nextUsed);
  const ipRemaining = Math.max(0, IP_DAILY_LIVE_CAP - ipUsedToday(clientIp(req)));
  const remaining = Math.min(cookieRemaining, ipRemaining);
  return { allowed: remaining > 0, remaining, used: nextUsed, limit: FREE_SEARCH_QUOTA };
}

// ── credit-spend meter (observability) ──────────────────────────────────────
let creditsSpentSession = 0;
let lastCreditsRemaining: number | null = null;

/** Record a live pull's reported credit balance so spend is watchable in logs. */
export function logCreditSpend(creditsRemaining: number | null, ctx: string): void {
  creditsSpentSession += 1;
  lastCreditsRemaining = creditsRemaining;
  console.info(
    `[importers.credits] live pull (${ctx}) — session_live_pulls=${creditsSpentSession} credits_remaining=${creditsRemaining ?? 'unknown'}`,
  );
}

/** Snapshot of the in-process credit meter (for a future admin/health view). */
export function creditMeter(): { sessionLivePulls: number; lastCreditsRemaining: number | null } {
  return { sessionLivePulls: creditsSpentSession, lastCreditsRemaining };
}

/** Test-only reset of the in-memory IP backstop + meter. */
export function __resetQuotaStateForTests(): void {
  ipDaily.clear();
  creditsSpentSession = 0;
  lastCreditsRemaining = null;
}
