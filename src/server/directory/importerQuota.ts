/**
 * Credit guardrails for the Importer Search feature (/importers).
 *
 * TWO distinct, separate concerns:
 *
 * 1. SEARCH is FREE + generous. A simple company-list search must never be
 *    capped at a low number (ImportYeti itself lets you search for free — a tight
 *    cap would just send users there). The only search guard is a GENEROUS
 *    per-IP/day soft cap on LIVE (uncached) pulls as pure anti-abuse
 *    (IP_DAILY_LIVE_SEARCH_CAP, default 50). A cache-served search NEVER counts —
 *    it costs us nothing, so popular / repeat searches stay open forever.
 *      → checkLiveSearchAllowed(req) / recordLiveSearch(req)
 *
 * 2. Opening a DETAILED IMPORTER PROFILE is the credit-heavy action (Hunter +
 *    the full reveal), so THAT is what the free quota gates: a visitor gets
 *    FREE_DETAIL_QUOTA (default 3) profile opens, then a "Subscribe to open more
 *    importer profiles" wall. Tracked per-visitor via a cookie plus a per-IP
 *    daily backstop (bounds cookie-clearing abuse). This is a REUSABLE gate — the
 *    Phase-2 importer-profile page calls checkDetailQuota() on profile open and
 *    recordDetailOpen() once it serves one.
 *      → checkDetailQuota(req) / recordDetailOpen(req, res)
 *
 * Deliberately SOFT (clearing cookies resets the detail quota; that is
 * acceptable — the goal is conversion + a spend ceiling, not perfect DRM).
 */
import type { Request, Response } from 'express';

/** Read a positive integer from the environment, else fall back. */
const envInt = (name: string, fallback: number): number => {
  const raw = process.env[name];
  const n = raw != null ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

// ── config constants (env-overridable) ──────────────────────────────────────
/** Generous per-IP/day cap on LIVE (uncached) search pulls — anti-abuse only. */
export const IP_DAILY_LIVE_SEARCH_CAP = envInt('IMPORTER_IP_DAILY_LIVE_SEARCHES', 50);
/** Free detailed-profile opens a new visitor gets before the subscribe wall. */
export const FREE_DETAIL_QUOTA = envInt('IMPORTER_FREE_DETAILS', 3);
/** Per-IP daily backstop on detail opens (bounds cookie-clearing abuse). */
export const IP_DAILY_DETAIL_CAP = envInt('IMPORTER_IP_DAILY_DETAILS', 30);

/** Cookie carrying the per-visitor used-detail-open count. */
export const DETAIL_COOKIE = 'qf_imp_detail';
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Copy shown when a visitor hits the detail-open quota. */
export const DETAIL_WALL_MESSAGE =
  "You've opened your free importer profiles. Subscribe to open more importer profiles — searching stays free.";

export interface QuotaState {
  /** True while the visitor may still perform the gated action. */
  allowed: boolean;
  /** Actions left (min of cookie remaining and IP-backstop remaining). */
  remaining: number;
  /** Actions already spent (from the cookie). */
  used: number;
  /** The configured free quota. */
  limit: number;
}

const UTC_DAY = (): string => new Date().toISOString().slice(0, 10);

// ── in-memory per-IP daily counters (single Reserved-VM instance) ───────────
const searchIpDaily = new Map<string, { day: string; count: number }>();
const detailIpDaily = new Map<string, { day: string; count: number }>();

function ipUsedToday(map: Map<string, { day: string; count: number }>, ip: string): number {
  const b = map.get(ip);
  return b && b.day === UTC_DAY() ? b.count : 0;
}
function bumpIp(map: Map<string, { day: string; count: number }>, ip: string): void {
  const day = UTC_DAY();
  const b = map.get(ip);
  if (!b || b.day !== day) {
    if (map.size > 5000) for (const [k, v] of map) if (v.day !== day) map.delete(k);
    map.set(ip, { day, count: 1 });
  } else {
    b.count += 1;
  }
}

/** Best-effort client IP (req.ip is the real client behind trust-proxy). */
function clientIp(req: Request): string {
  return (req.ip || (req.socket && req.socket.remoteAddress) || 'unknown').toString();
}

// ── 1. SEARCH gate (free + generous; anti-abuse per-IP only, no cookie) ──────
/** Whether this visitor may perform another LIVE (credit-spending) search today.
 *  Cache-served searches never reach here, so they're always free. */
export function checkLiveSearchAllowed(req: Request): { allowed: boolean; remaining: number } {
  const remaining = Math.max(0, IP_DAILY_LIVE_SEARCH_CAP - ipUsedToday(searchIpDaily, clientIp(req)));
  return { allowed: remaining > 0, remaining };
}
/** Record ONE live search pull (a cache miss that actually spent a credit). */
export function recordLiveSearch(req: Request): void {
  bumpIp(searchIpDaily, clientIp(req));
}

// ── 2. DETAIL-OPEN quota (reusable gate for the Phase-2 profile page) ────────
/** Parse the used-detail-count from the request cookie (no cookie-parser dep). */
export function readDetailUsed(req: Request): number {
  const parsed = (req as Request & { cookies?: Record<string, unknown> }).cookies;
  let raw: string | undefined;
  if (parsed && typeof parsed[DETAIL_COOKIE] === 'string') {
    raw = parsed[DETAIL_COOKIE] as string;
  } else {
    const header = req.headers?.cookie;
    if (typeof header === 'string') {
      const m = header.match(new RegExp('(?:^|;\\s*)' + DETAIL_COOKIE + '=([^;]*)'));
      if (m) raw = decodeURIComponent(m[1]);
    }
  }
  const n = raw != null ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * The reusable detail-open gate. Returns whether the visitor may open another
 * DETAILED importer profile and how many free opens remain. Pure read — never
 * mutates (recording an open is the caller's explicit recordDetailOpen()).
 */
export function checkDetailQuota(req: Request): QuotaState {
  const cookieUsed = readDetailUsed(req);
  const cookieRemaining = Math.max(0, FREE_DETAIL_QUOTA - cookieUsed);
  const ipRemaining = Math.max(0, IP_DAILY_DETAIL_CAP - ipUsedToday(detailIpDaily, clientIp(req)));
  const remaining = Math.min(cookieRemaining, ipRemaining);
  return { allowed: remaining > 0, remaining, used: cookieUsed, limit: FREE_DETAIL_QUOTA };
}

/**
 * Record ONE detailed-profile open: bump the visitor cookie + the per-IP daily
 * backstop. Call this only once a profile has actually been served. Returns the
 * post-increment quota state.
 */
export function recordDetailOpen(req: Request, res: Response): QuotaState {
  const nextUsed = readDetailUsed(req) + 1;
  try {
    res.cookie(DETAIL_COOKIE, String(nextUsed), {
      maxAge: COOKIE_MAX_AGE_MS,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    });
  } catch {
    // res.cookie unavailable (non-Express double) — IP backstop + returned state
    // still hold; never break the action on a cookie failure.
  }
  bumpIp(detailIpDaily, clientIp(req));
  const cookieRemaining = Math.max(0, FREE_DETAIL_QUOTA - nextUsed);
  const ipRemaining = Math.max(0, IP_DAILY_DETAIL_CAP - ipUsedToday(detailIpDaily, clientIp(req)));
  const remaining = Math.min(cookieRemaining, ipRemaining);
  return { allowed: remaining > 0, remaining, used: nextUsed, limit: FREE_DETAIL_QUOTA };
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

/** Test-only reset of the in-memory counters + meter. */
export function __resetQuotaStateForTests(): void {
  searchIpDaily.clear();
  detailIpDaily.clear();
  creditsSpentSession = 0;
  lastCreditsRemaining = null;
}
