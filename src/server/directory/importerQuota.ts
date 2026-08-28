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
import { externalCallMeter, __resetGuardMetersForTests } from './externalPullGuard.js';

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

// ── account-keyed detail quota (logged-in users) ─────────────────────────────
// For a LOGGED-IN user the free-profile quota is keyed to their ACCOUNT rather
// than the browser cookie / IP, so it follows them across devices (within this
// instance's uptime) and can't be reset by clearing cookies. Deliberately
// in-memory + soft (resets on redeploy), consistent with the existing soft
// posture of this whole gate — the goal is conversion + a spend ceiling, not
// perfect DRM. Durable per-account billing/quota is a separate (deferred) Alex
// product decision. `slugs` dedups re-opens of the same company (served from
// cache — no credit), exactly like the cookie path.
const detailByUser = new Map<number, { used: number; slugs: Set<string> }>();

function accountRecord(userId: number): { used: number; slugs: Set<string> } {
  let rec = detailByUser.get(userId);
  if (!rec) {
    rec = { used: 0, slugs: new Set<string>() };
    detailByUser.set(userId, rec);
  }
  return rec;
}

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
/** Valid ImportYeti slug charset (matches sanitizeSlug in importerProfile). */
const QUOTA_SLUG_RX = /^[a-z0-9][a-z0-9-]{0,80}$/;

/**
 * Parsed detail-quota cookie. Two on-the-wire formats are supported:
 *   • Legacy / no-slug:  a bare integer ("3") — the used-count only.
 *   • Slug-aware:        "s:<count>:<slug1>,<slug2>,…" — the used-count PLUS the
 *     set of distinct company slugs already opened, so re-opening a company the
 *     visitor already viewed never consumes another free profile.
 */
export interface DetailCookie {
  used: number;
  slugs: string[];
}

/** Read the raw cookie string (cookie-parser value, else the header). */
function rawDetailCookie(req: Request): string | undefined {
  const parsed = (req as Request & { cookies?: Record<string, unknown> }).cookies;
  if (parsed && typeof parsed[DETAIL_COOKIE] === 'string') return parsed[DETAIL_COOKIE] as string;
  const header = req.headers?.cookie;
  if (typeof header === 'string') {
    const m = header.match(new RegExp('(?:^|;\\s*)' + DETAIL_COOKIE + '=([^;]*)'));
    if (m) return decodeURIComponent(m[1]);
  }
  return undefined;
}

/** Parse the detail-quota cookie into { used, distinct-slugs }. */
export function parseDetailCookie(req: Request): DetailCookie {
  const raw = rawDetailCookie(req);
  if (!raw) return { used: 0, slugs: [] };
  if (raw.startsWith('s:')) {
    const rest = raw.slice(2);
    const sep = rest.indexOf(':');
    const countPart = sep >= 0 ? rest.slice(0, sep) : rest;
    const slugPart = sep >= 0 ? rest.slice(sep + 1) : '';
    const slugs = Array.from(
      new Set(
        slugPart
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter((s) => QUOTA_SLUG_RX.test(s)),
      ),
    );
    const cnt = Number(countPart);
    const used = Number.isFinite(cnt) && cnt > 0 ? Math.floor(cnt) : 0;
    // used is authoritative but can never be under the number of tracked slugs.
    return { used: Math.max(used, slugs.length), slugs };
  }
  const n = Number(raw);
  return { used: Number.isFinite(n) && n > 0 ? Math.floor(n) : 0, slugs: [] };
}

/** Format the slug-aware cookie value. */
function formatDetailCookie(used: number, slugs: string[]): string {
  return `s:${used}:${slugs.join(',')}`;
}

/** Parse the used-detail-count from the request cookie (no cookie-parser dep). */
export function readDetailUsed(req: Request): number {
  return parseDetailCookie(req).used;
}

/**
 * The reusable detail-open gate. Returns whether the visitor may open another
 * DETAILED importer profile and how many free opens remain. Pure read — never
 * mutates (recording an open is the caller's explicit recordDetailOpen()).
 */
export function checkDetailQuota(req: Request, slug?: string, userId?: number | null): QuotaState {
  // Logged-in → the quota is keyed to the ACCOUNT (cross-device, cookie-clear
  // proof), not the browser cookie / IP backstop.
  if (userId != null) {
    const rec = accountRecord(userId);
    const reopen = !!slug && rec.slugs.has(slug.toLowerCase());
    const remaining = Math.max(0, FREE_DETAIL_QUOTA - rec.used);
    return { allowed: reopen || remaining > 0, remaining, used: rec.used, limit: FREE_DETAIL_QUOTA };
  }
  const { used, slugs } = parseDetailCookie(req);
  // Re-opening a company the visitor ALREADY opened never counts — it is served
  // from cache (no credit) — so it is allowed even past the free quota.
  const reopen = !!slug && slugs.includes(slug.toLowerCase());
  const cookieRemaining = Math.max(0, FREE_DETAIL_QUOTA - used);
  const ipRemaining = Math.max(0, IP_DAILY_DETAIL_CAP - ipUsedToday(detailIpDaily, clientIp(req)));
  const remaining = Math.min(cookieRemaining, ipRemaining);
  return { allowed: reopen || remaining > 0, remaining, used, limit: FREE_DETAIL_QUOTA };
}

/**
 * Record ONE detailed-profile open: bump the visitor cookie + the per-IP daily
 * backstop. Call this only once a profile has actually been served. Returns the
 * post-increment quota state.
 */
export function recordDetailOpen(req: Request, res: Response, slug?: string, userId?: number | null): QuotaState {
  // Logged-in → record against the ACCOUNT-keyed quota (see checkDetailQuota).
  if (userId != null) {
    const rec = accountRecord(userId);
    const key = slug ? slug.toLowerCase() : '';
    // Re-open of an already-opened company → dedup: no extra consumption.
    if (!(key && rec.slugs.has(key))) {
      rec.used += 1;
      if (key) rec.slugs.add(key);
    }
    const remaining = Math.max(0, FREE_DETAIL_QUOTA - rec.used);
    return { allowed: remaining > 0, remaining, used: rec.used, limit: FREE_DETAIL_QUOTA };
  }
  const { used, slugs } = parseDetailCookie(req);
  const key = slug ? slug.toLowerCase() : '';

  // Re-open of an already-opened company → DEDUP: don't consume a free profile
  // and don't bump the per-IP backstop (it costs nothing — served from cache).
  if (key && slugs.includes(key)) {
    try {
      res.cookie(DETAIL_COOKIE, formatDetailCookie(used, slugs), {
        maxAge: COOKIE_MAX_AGE_MS,
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
      });
    } catch {
      /* res.cookie unavailable — returned state still holds */
    }
    const cookieRemaining0 = Math.max(0, FREE_DETAIL_QUOTA - used);
    const ipRemaining0 = Math.max(0, IP_DAILY_DETAIL_CAP - ipUsedToday(detailIpDaily, clientIp(req)));
    return { allowed: true, remaining: Math.min(cookieRemaining0, ipRemaining0), used, limit: FREE_DETAIL_QUOTA };
  }

  // A NEW distinct company → count it. Track the slug (when known) so a later
  // re-open is free. Without a slug, keep the legacy bare-count cookie format.
  const nextUsed = used + 1;
  const nextSlugs = key ? [...slugs, key] : slugs;
  const cookieVal = key ? formatDetailCookie(nextUsed, nextSlugs) : String(nextUsed);
  try {
    res.cookie(DETAIL_COOKIE, cookieVal, {
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
// The COUNTS come from the cost guard, which is the only place a paid call can
// be made (externalPullGuard.guardedFetch) — so this meter can no longer drift
// from reality, and a durable per-call ledger backs it in `external_api_spend`.
/**
 * Log a live pull's reported credit balance. The count itself is maintained by
 * the cost-guard choke point; this only records the provider-reported balance
 * and writes the human-readable line.
 */
export function logCreditSpend(creditsRemaining: number | null, ctx: string): void {
  const m = externalCallMeter().importyeti;
  console.info(
    `[importers.credits] live pull (${ctx}) — session_live_pulls=${m.liveCalls} credits_remaining=${creditsRemaining ?? m.lastCreditsRemaining ?? 'unknown'}`,
  );
}

/**
 * Snapshot of the in-process credit meter (admin/health view). `sessionLivePulls`
 * is now the guard's ImportYeti live-call count — one per call that actually left
 * the process, not one per HTTP search (a state expansion can pull several).
 */
export function creditMeter(): {
  sessionLivePulls: number;
  lastCreditsRemaining: number | null;
  blockedPulls: number;
  hunter: { liveCalls: number; blockedCalls: number };
} {
  const m = externalCallMeter();
  return {
    sessionLivePulls: m.importyeti.liveCalls,
    lastCreditsRemaining: m.importyeti.lastCreditsRemaining,
    blockedPulls: m.importyeti.blockedCalls,
    hunter: { liveCalls: m.hunter.liveCalls, blockedCalls: m.hunter.blockedCalls },
  };
}

/** Test-only reset of the in-memory counters + meter. */
export function __resetQuotaStateForTests(): void {
  searchIpDaily.clear();
  detailIpDaily.clear();
  detailByUser.clear();
  __resetGuardMetersForTests();
}
