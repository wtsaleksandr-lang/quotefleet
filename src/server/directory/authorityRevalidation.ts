/**
 * LIVE AUTHORITY REVALIDATION — keeping the loudest claim on the directory true
 * after the file it came from stopped being published.
 *
 * ─── THE PROBLEM ──────────────────────────────────────────────────────────
 * We print "Active" operating authority on ~330,452 carrier profiles. Every one
 * of those claims comes from FMCSA's Licensing & Insurance file (`6eyk-hxee`),
 * which FMCSA FROZE on 14 May 2026. ./carrierCredentials.ts documents the
 * substantive proof (L&I transactions Jan 18,255 · Feb 19,740 · Mar 27,020 ·
 * Apr 29,286 · May 13,040 partial · Jun/Jul/Aug ZERO, while the census file kept
 * registering 12k–17k carriers a month).
 *
 * The AuthHist file (`9mw4-x3tu`, 4,941,925 rows, 98.75% DOT coverage) was the
 * obvious fallback. It is DEAD TOO — measured the same way on 2026-08-30, by
 * counting rows per month rather than trusting `rowsUpdatedAt`:
 *
 *   orig_served_date, 2026:  Jan 20,396 · Feb 19,738 · Mar 20,960 · Apr 17,633
 *                            May  5,446 (partial — the file froze on the 14th)
 *                            Jun 0 · Jul 0 · Aug 0
 *
 * Same freeze date, same cliff, same published note. So there is NO bulk feed
 * left that can refresh authority for 330k carriers. `rowsUpdatedAt` still moves
 * daily on both frozen sets — it tracks metadata touches, not data. Never use it
 * as a freshness check.
 *
 * ─── THE DECISION ─────────────────────────────────────────────────────────
 * Keep the frozen snapshot as the baseline, and revalidate ONE carrier's
 * authority LIVE, against FMCSA's QCMobile API, at the moment somebody is
 * actually reading that carrier's profile.
 *
 * Staleness only causes harm when a person is about to act on it, and that is
 * exactly when they are on that one page. Bulk-refreshing 330k rows nightly
 * would solve a problem nobody has, at 330k requests a night, against an API
 * with no bulk endpoint.
 *
 * ─── THE FOUR THINGS THAT MAKE THAT SAFE ──────────────────────────────────
 * 1. IT IS NOT ON THE RENDER PATH. The profile HTML is unchanged: it renders the
 *    stored snapshot, stays BYTE-IDENTICAL for every visitor, and keeps its
 *    shared-cache eligibility (see ./httpCache.ts — byte-identity is the only
 *    real guarantee there, and personalization must move to client-side
 *    hydration). The live status arrives afterwards over a separate JSON
 *    endpoint, hydrated by the same mechanism CARRIER_PRO_HYDRATE_SCRIPT already
 *    uses on this page. The profile's ~0.08 ms index scan is untouched, and a
 *    slow FMCSA can never become a slow page.
 *
 * 2. BOTS NEVER TRIGGER IT. This is the single hardest constraint. The internal
 *    link mesh deliberately made ~100% of 330,452 carriers reachable, so
 *    Googlebot crawls this page type at scale — and Googlebot RENDERS JavaScript,
 *    so "it is client-side" is not by itself a defence. The gate is therefore
 *    SERVER-SIDE on the endpoint, in two independent layers, and it FAILS CLOSED:
 *    anything not positively identified as a real person in a real browser gets
 *    the stored snapshot and no outbound request. See isCrawlerUserAgent() and
 *    isFirstPartyFetch() below.
 *
 * 3. IT IS CACHED FOR A WEEK, PER CARRIER, IN POSTGRES. The second visitor to a
 *    profile inside the window costs one indexed SELECT and zero outbound
 *    requests. See AUTHORITY_TTL_MS for why seven days.
 *
 * 4. IT IS BOUNDED REGARDLESS. A process-wide token bucket plus a circuit
 *    breaker cap the outbound rate no matter what gets past 2 and 3 — a traffic
 *    spike, a misdetected crawler, an FMCSA outage. Over budget, or breaker
 *    open, degrades to the snapshot silently.
 *
 * ─── HONESTY CONTRACT (inherited from ./carrierCredentials.ts) ─────────────
 *   1. EVERY STATUS CARRIES ITS OWN DATE. The snapshot says 14 May 2026. A live
 *      result says the day it was fetched. The two are never blended into one
 *      undated "Active".
 *   2. THE LIVE RESULT WINS. If FMCSA says the authority is no longer active,
 *      the stale "Active" is REPLACED, not shown alongside.
 *   3. NEVER THE WORD "VERIFIED". We report what FMCSA's record said and when we
 *      read it. That is a fact with a date, not our judgement of the business.
 *   4. A FAILED LOOKUP IS INVISIBLE. No error, no warning, no empty state — the
 *      page keeps the snapshot it already rendered. A shipper must never see our
 *      plumbing, and an FMCSA outage must never look like a problem with the
 *      carrier.
 *
 * ─── WHAT THIS DELIBERATELY DOES NOT TOUCH ────────────────────────────────
 * The two cache columns live ONLY in the self-heal statements below. They are
 * absent from src/db/schema.ts, from CARRIER_MUTABLE_COLUMNS and from the
 * ingest's UPSERT SET map, so they CANNOT enter CARRIER_CHANGED_SQL. That is
 * structural, not a convention: a per-view revalidation timestamp inside the
 * change comparison would mark all ~330k rows as changed on every ingest, bump
 * `updated_at`, and manufacture fake `<lastmod>` freshness across the whole
 * sitemap — the exact failure the conditional upsert exists to prevent.
 * `authorityRevalidation.test.ts` asserts that separation against the real
 * source files.
 */

import { sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { runSelfHealStatements } from '../../db/migrate.js';
import { lookupCarrierCompliance, type CarrierComplianceSnapshot } from './fmcsaLookup.js';

/**
 * "30 Aug 2026". UTC, so the rendered date is deterministic on any server.
 *
 * Deliberately the SAME shape as LI_EXTRACT_DATE ("14 May 2026") and not
 * ./carrierCredentials.ts's formatCredentialDate (which is en-US and renders
 * "Aug 30, 2026"): the live date is printed directly above the L&I extract date
 * in the same paragraph block, and the reader is meant to compare the two at a
 * glance. Two date formats a line apart makes that comparison harder for no
 * reason.
 */
export function formatAuthorityDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE BOT GATE — the most important code in this file
// ─────────────────────────────────────────────────────────────────────────────

/**
 * User-agent substrings that mean "not a person deciding whether to tender a
 * load". Lower-cased substring match against the whole UA.
 *
 * WHY A SUBSTRING LIST AND NOT A LIBRARY: this list is the safety property of
 * the whole feature, so it has to be readable, testable and reviewable in place
 * rather than tracking a dependency's release cadence.
 *
 * DIRECTION OF ERROR, ON PURPOSE: a FALSE POSITIVE (a real person classified as
 * a crawler) costs that person nothing — they see the dated snapshot, which is
 * what the page showed before this feature existed. A FALSE NEGATIVE (a crawler
 * classified as a person) costs hundreds of thousands of requests to a
 * government API. So the list is deliberately greedy, and the generic tokens at
 * the bottom (`bot`, `crawler`, `spider`, …) are there to catch the long tail of
 * scrapers nobody has heard of. No mainstream browser UA — Chrome, Safari,
 * Firefox, Edge, Samsung Internet, on desktop or mobile — contains any of them.
 *
 * NOTE ON GOOGLE'S RENDERER: Googlebot's Web Rendering Service reports a modern
 * Chrome UA with `(compatible; Googlebot/2.1; +http://www.google.com/bot.html)`
 * appended, so the plain `googlebot` token catches the JS-rendering pass too —
 * which is the pass that would otherwise reach this endpoint. Google's newer
 * agents (`Google-InspectionTool`, `GoogleOther`, `Google-Extended`) are listed
 * separately because they do not all carry the `googlebot` token.
 */
export const CRAWLER_UA_TOKENS: readonly string[] = [
  // ── Google ────────────────────────────────────────────────────────────
  'googlebot',
  'google-inspectiontool',
  'googleother',
  'google-extended',
  'storebot-google',
  'adsbot-google',
  'mediapartners-google',
  'feedfetcher-google',
  'apis-google',
  'google favicon',
  'chrome-lighthouse',
  'google page speed',
  // ── Other major search engines ────────────────────────────────────────
  'bingbot',
  'adidxbot',
  'bingpreview',
  'msnbot',
  'slurp',
  'duckduckbot',
  'duckassistbot',
  'baiduspider',
  'yandex',
  'sogou',
  'exabot',
  'seznambot',
  'naver',
  'coccocbot',
  'applebot',
  'petalbot',
  'mojeekbot',
  'qwantify',
  // ── AI / LLM crawlers ─────────────────────────────────────────────────
  'gptbot',
  'oai-searchbot',
  'chatgpt-user',
  'claudebot',
  'claude-web',
  'anthropic-ai',
  'perplexitybot',
  'perplexity-user',
  'ccbot',
  'cohere-ai',
  'bytespider',
  'amazonbot',
  'youbot',
  'diffbot',
  'ai2bot',
  'timpibot',
  'imagesiftbot',
  'omgili',
  'webzio',
  'meta-externalagent',
  'facebookbot',
  // ── SEO / backlink / market-intel crawlers ────────────────────────────
  'ahrefsbot',
  'semrushbot',
  'mj12bot',
  'dotbot',
  'rogerbot',
  'blexbot',
  'dataforseobot',
  'serpstatbot',
  'barkrowler',
  'zoominfobot',
  'screaming frog',
  'sitebulb',
  'seokicks',
  'linkdexbot',
  // ── Social / link unfurlers ───────────────────────────────────────────
  'facebookexternalhit',
  'facebot',
  'twitterbot',
  'linkedinbot',
  'pinterestbot',
  'redditbot',
  'slackbot',
  'slack-imgproxy',
  'discordbot',
  'telegrambot',
  'whatsapp',
  'skypeuripreview',
  'embedly',
  'quora link preview',
  'vkshare',
  'nuzzel',
  'outbrain',
  'w3c_validator',
  // ── Uptime / synthetic monitors ───────────────────────────────────────
  'uptimerobot',
  'pingdom',
  'statuscake',
  'newrelicpinger',
  'datadog',
  'site24x7',
  'gtmetrix',
  'pagespeed',
  // ── Headless / automation / scripted clients ──────────────────────────
  'headlesschrome',
  'phantomjs',
  'puppeteer',
  'playwright',
  'selenium',
  'scrapy',
  'python-requests',
  'python-urllib',
  'aiohttp',
  'curl/',
  'wget',
  'go-http-client',
  'okhttp',
  'axios',
  'node-fetch',
  'java/',
  'apache-httpclient',
  'libwww-perl',
  'httpclient',
  'restsharp',
  'postmanruntime',
  'insomnia',
  // ── Generic long-tail catch-alls (see "direction of error" above) ─────
  'bot',
  'crawler',
  'crawling',
  'spider',
  'scraper',
  'archiver',
  'fetcher',
  'indexer',
  'validator',
];

/**
 * True when the user-agent identifies a crawler, an automated client, or
 * nothing at all.
 *
 * A MISSING OR EMPTY UA COUNTS AS A CRAWLER. Every real browser sends one;
 * omitting it is either a scripted client or someone stripping it deliberately,
 * and both should get the snapshot.
 */
export function isCrawlerUserAgent(userAgent: string | undefined | null): boolean {
  const ua = String(userAgent ?? '').trim().toLowerCase();
  if (!ua) return true;
  return CRAWLER_UA_TOKENS.some((token) => ua.includes(token));
}

/** The header our own hydration script sets. Nothing else has a reason to. */
export const FIRST_PARTY_HEADER = 'x-qf-authority-check';

/** Minimal shape of the request headers this module reads. */
export interface AuthorityRequestHeaders {
  'user-agent'?: string | string[];
  'sec-fetch-site'?: string | string[];
  'sec-fetch-mode'?: string | string[];
  [FIRST_PARTY_HEADER]?: string | string[];
  [key: string]: string | string[] | undefined;
}

const header = (h: AuthorityRequestHeaders, name: string): string => {
  const v = h[name];
  return String(Array.isArray(v) ? v[0] : (v ?? '')).trim().toLowerCase();
};

/**
 * SECOND, INDEPENDENT LAYER. True only for a same-origin `fetch()` issued by our
 * own page script.
 *
 * WHY IT EXISTS ON TOP OF THE UA LIST: a UA list can only catch crawlers that
 * announce themselves. This catches the ones that do not. Two signals, both of
 * which a crawler replaying a URL string it found in our JavaScript fails:
 *
 *   • our own `X-QF-Authority-Check: 1` request header — a crawler that
 *     extracts the endpoint from the script source and fetches it directly
 *     issues a plain navigation-style GET without it;
 *   • `Sec-Fetch-Site: same-origin` — sent by every current browser on a
 *     same-origin `fetch()`, and set to `none` on an address-bar navigation or a
 *     bare crawler GET. Absent headers are TOLERATED (older clients omit the
 *     Fetch-Metadata set entirely) but a PRESENT-AND-WRONG value is rejected,
 *     so the signal can only ever tighten the gate, never loosen it.
 *
 * Combined with isCrawlerUserAgent() the rule is: a live lookup happens only for
 * a request that both looks like a browser AND behaves like our own page.
 */
export function isFirstPartyFetch(headers: AuthorityRequestHeaders): boolean {
  if (header(headers, FIRST_PARTY_HEADER) !== '1') return false;
  const site = header(headers, 'sec-fetch-site');
  if (site && site !== 'same-origin') return false;
  const mode = header(headers, 'sec-fetch-mode');
  if (mode && mode !== 'cors' && mode !== 'same-origin') return false;
  return true;
}

/**
 * THE GATE. True when this request is allowed to cause an outbound FMCSA call.
 * Everything else — crawlers, scripted clients, direct hits, missing headers —
 * is served the stored snapshot.
 */
export function mayRevalidate(headers: AuthorityRequestHeaders): boolean {
  return !isCrawlerUserAgent(headers['user-agent'] as string | undefined) && isFirstPartyFetch(headers);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE CACHE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How long a live result stays authoritative: SEVEN DAYS.
 *
 * WHY SEVEN AND NOT ONE, OR THIRTY:
 *
 *   • It is bounded by how fast the underlying fact can actually change. Losing
 *     operating authority is an administrative process, not an event — an
 *     insurance-lapse revocation is preceded by a mandated notice period of
 *     roughly a month, and reinstatements run on the same order. A week is
 *     comfortably inside the window in which a change is still in progress.
 *   • It is ~15× fresher than what it replaces. The snapshot is 14 May 2026 and
 *     will never move again; on 30 Aug 2026 that is 108 days old and growing. The
 *     marginal accuracy of a 1-day TTL over a 7-day one is small next to that
 *     gap, while the request volume is 7× larger.
 *   • It matches the cadence the rest of the directory already ages on: the bulk
 *     FMCSA re-ingest runs weekly (Sunday 09:00 UTC). The live layer and the bulk
 *     layer expiring on the same clock is one freshness story, not two.
 *   • The volume it implies is safe even at an absurd upper bound. If every one
 *     of the 330,452 profiles were read by a human every single week, a 7-day TTL
 *     caps the outbound rate at ~47k/day ≈ 0.55 req/s. Real human traffic is a
 *     small fraction of that, and the token bucket below caps it regardless.
 */
export const AUTHORITY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The two cache columns, added by self-heal ONLY.
 *
 * Deliberately NOT in src/db/schema.ts and NOT in drizzle/: adding them there
 * would put them in reach of the ingest's generated UPSERT, and the whole point
 * (see the header) is that a per-view timestamp can never enter the change
 * comparison. Read and written by raw SQL in this file, and nowhere else.
 *
 * `ADD COLUMN IF NOT EXISTS` takes ACCESS EXCLUSIVE on carrier_directory BEFORE
 * it checks whether the column exists — an idempotent no-op is exactly as
 * dangerous as a real DDL, and that is what took prod down for 15 minutes on
 * 2026-08-28. These go through runSelfHealStatements(), which does a cheap
 * catalog probe first and bounds the wait with lock_timeout + statement_timeout.
 * Never call sql.unsafe() with these directly.
 */
export const AUTHORITY_SELF_HEAL_STATEMENTS: readonly string[] = [
  `ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "authority_live_status" text`,
  `ALTER TABLE "carrier_directory" ADD COLUMN IF NOT EXISTS "authority_live_checked_at" timestamptz`,
];

/** Boot hook. Non-blocking + never throws at the call site (see src/server/index.ts). */
export async function ensureAuthorityRevalidationColumns(): Promise<void> {
  await runSelfHealStatements('carrier_directory authority revalidation columns', AUTHORITY_SELF_HEAL_STATEMENTS);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE STATUS MODEL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What FMCSA's live record says about this carrier's authority to operate.
 *
 *   'active'   — at least one authority (common / contract / broker) is 'A' AND
 *                FMCSA's own allowedToOperate flag is not 'N'.
 *   'inactive' — FMCSA has the carrier, and none of the above holds. This is the
 *                case the frozen snapshot cannot see and the reason this exists.
 *   'unknown'  — we could not establish either. NEVER rendered as a status; it
 *                means "keep showing the snapshot".
 */
export type LiveAuthorityStatus = 'active' | 'inactive' | 'unknown';

const isStatus = (v: unknown): v is LiveAuthorityStatus =>
  v === 'active' || v === 'inactive' || v === 'unknown';

/**
 * Map a QCMobile snapshot to our three-state status.
 *
 * `allowedToOperate === 'N'` is decisive on its own: FMCSA sets it when a
 * carrier may not operate regardless of what the individual authority columns
 * say, so it overrides an 'A'. A record we did not find, or one with no usable
 * flags at all, is 'unknown' rather than 'inactive' — absence of evidence is not
 * evidence that a real business lost its authority.
 */
export function liveAuthorityStatus(snap: CarrierComplianceSnapshot): LiveAuthorityStatus {
  if (!snap.found) return 'unknown';
  const allowed = String(snap.allowedToOperate ?? '').trim().toUpperCase();
  if (allowed === 'N') return 'inactive';
  const flags = [snap.authority.common, snap.authority.contract, snap.authority.broker].map((v) =>
    String(v ?? '').trim().toUpperCase(),
  );
  if (flags.some((f) => f === 'A')) return 'active';
  // A record with allowedToOperate 'Y' but no 'A' authority flag at all is a
  // shape we cannot interpret confidently — do not downgrade the carrier on it.
  if (allowed === 'Y' && flags.every((f) => f === '')) return 'unknown';
  if (flags.some((f) => f === 'I' || f === 'N')) return 'inactive';
  return 'unknown';
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE BUDGET — token bucket + circuit breaker
// ─────────────────────────────────────────────────────────────────────────────

/** Sustained outbound rate, per process. 30/min ≈ 0.5 req/s against a free API. */
export const BUDGET_REFILL_PER_MIN = 30;
/** Burst ceiling. Absorbs a handful of simultaneous first-views, nothing more. */
export const BUDGET_CAPACITY = 30;
/** Consecutive failures that trip the breaker. */
export const BREAKER_THRESHOLD = 5;
/** How long the breaker stays open before letting one probe through. */
export const BREAKER_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Process-wide spend limiter for FMCSA calls.
 *
 * The token bucket bounds a traffic spike (or a crawler that somehow beat both
 * gate layers). The breaker bounds an FMCSA outage: five consecutive failures
 * and we stop asking for five minutes rather than sending every visitor into an
 * 4-second timeout. Both fail toward the snapshot, which is always available.
 *
 * Per-process, not per-cluster, and that is fine: the bound multiplies by the
 * instance count, which is small, and the DB cache is shared so instances do not
 * duplicate each other's work beyond the first view.
 */
export class AuthorityBudget {
  private tokens: number;
  private lastRefill: number;
  private consecutiveFailures = 0;
  private openedAt = 0;

  constructor(
    private readonly capacity = BUDGET_CAPACITY,
    private readonly refillPerMin = BUDGET_REFILL_PER_MIN,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = capacity;
    this.lastRefill = now();
  }

  private refill(): void {
    const t = this.now();
    const elapsed = t - this.lastRefill;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + (elapsed / 60_000) * this.refillPerMin);
    this.lastRefill = t;
  }

  /** True when the breaker is open and still inside its cooldown. */
  breakerOpen(): boolean {
    if (this.consecutiveFailures < BREAKER_THRESHOLD) return false;
    return this.now() - this.openedAt < BREAKER_COOLDOWN_MS;
  }

  /** Take one token. False means "do not call FMCSA" — degrade to the snapshot. */
  tryTake(): boolean {
    if (this.breakerOpen()) return false;
    this.refill();
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.openedAt = 0;
  }

  recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures === BREAKER_THRESHOLD) this.openedAt = this.now();
  }
}

/** The one budget the route uses. */
export const authorityBudget = new AuthorityBudget();

// ─────────────────────────────────────────────────────────────────────────────
// 5. THE ORCHESTRATION
// ─────────────────────────────────────────────────────────────────────────────

/** What the endpoint answers with. Never contains an error a visitor can see. */
export interface AuthorityRevalidation {
  /** The status to display. 'unknown' means "keep the snapshot as rendered". */
  status: LiveAuthorityStatus;
  /** True when `status` came from a live FMCSA read (fresh or cached). */
  live: boolean;
  /** ISO date of the live read backing `status`, or null when live is false. */
  checkedAt: string | null;
  /** Rendered date for the UI, e.g. "30 Aug 2026". Null when live is false. */
  checkedLabel: string | null;
  /** Why we did not go live. Diagnostic only — never rendered to a visitor. */
  reason:
    | 'fresh'
    | 'cached'
    | 'crawler'
    | 'not-first-party'
    | 'budget'
    | 'unconfigured'
    | 'lookup-failed';
}

/** The stored cache row for one carrier. */
export interface AuthorityCacheRow {
  status: LiveAuthorityStatus | null;
  checkedAt: Date | null;
}

/**
 * "Keep the snapshot the page already rendered." The answer for every path that
 * did not produce a live status — crawler, budget spent, FMCSA down, no webkey.
 *
 * Note what it is NOT: it is not an error, it carries no message, and the client
 * script treats it as a no-op. A visitor can never tell the difference between
 * "we did not look" and "we looked and could not tell", which is correct — both
 * mean the dated snapshot on the page stands.
 */
export const snapshotAuthorityAnswer = (
  reason: AuthorityRevalidation['reason'],
): AuthorityRevalidation => ({
  status: 'unknown',
  live: false,
  checkedAt: null,
  checkedLabel: null,
  reason,
});

const SNAPSHOT = snapshotAuthorityAnswer;

const LIVE = (
  status: LiveAuthorityStatus,
  checkedAt: Date,
  reason: AuthorityRevalidation['reason'],
): AuthorityRevalidation => ({
  status,
  live: status !== 'unknown',
  checkedAt: status === 'unknown' ? null : checkedAt.toISOString(),
  checkedLabel: status === 'unknown' ? null : formatAuthorityDate(checkedAt),
  reason,
});

/** True when a cached row is still inside the TTL. */
export function isCacheFresh(row: AuthorityCacheRow | null, now: Date, ttlMs = AUTHORITY_TTL_MS): boolean {
  if (!row?.checkedAt || !row.status) return false;
  const age = now.getTime() - row.checkedAt.getTime();
  // A checkedAt in the future is a clock problem, not freshness — refetch.
  return age >= 0 && age < ttlMs;
}

/** Injectable seams — the whole flow is unit-testable with no DB and no network. */
export interface RevalidationDeps {
  readCache: (usdot: string) => Promise<AuthorityCacheRow | null>;
  writeCache: (usdot: string, status: LiveAuthorityStatus, checkedAt: Date) => Promise<void>;
  lookup: (usdot: string) => Promise<CarrierComplianceSnapshot>;
  budget: AuthorityBudget;
  webKeyConfigured: () => boolean;
  now: () => Date;
  log: (msg: string) => void;
}

/**
 * In-flight lookups keyed by USDOT, so a burst of simultaneous first-visitors to
 * the same profile shares ONE upstream call instead of racing N of them. Cleared
 * in `finally`, so a failure cannot pin an entry forever.
 */
const inFlight = new Map<string, Promise<AuthorityRevalidation>>();

/** Test seam — the route never calls this. */
export function __resetInFlight(): void {
  inFlight.clear();
}

/**
 * Resolve the authority status to show for one carrier.
 *
 * ORDER MATTERS, and it is cheapest-and-safest first:
 *   1. the bot gate      — no I/O at all for a crawler;
 *   2. the DB cache      — one indexed SELECT, no outbound request;
 *   3. the webkey check  — no point spending a token on a call that cannot work;
 *   4. the budget        — token bucket + breaker;
 *   5. the live lookup   — single-flighted, timeout-bounded, never throws.
 *
 * NEVER THROWS. Every failure path returns a snapshot answer, because the only
 * consumer is a page that is already rendered and correct without it.
 */
export async function resolveAuthority(
  usdot: string,
  headers: AuthorityRequestHeaders,
  deps: RevalidationDeps,
): Promise<AuthorityRevalidation> {
  const now = deps.now();

  // 1. THE GATE. A crawler never reaches the cache read, let alone the network.
  if (isCrawlerUserAgent(headers['user-agent'] as string | undefined)) return SNAPSHOT('crawler');
  if (!isFirstPartyFetch(headers)) return SNAPSHOT('not-first-party');

  // 2. THE CACHE. The common path for any profile with more than one visitor a
  //    week. A read failure is not fatal — fall through and try live.
  let cached: AuthorityCacheRow | null = null;
  try {
    cached = await deps.readCache(usdot);
  } catch (err) {
    deps.log(`[authority] cache read failed for ${usdot} (non-fatal): ${String(err)}`);
  }
  if (isCacheFresh(cached, now) && cached?.status && cached.checkedAt) {
    return LIVE(cached.status, cached.checkedAt, 'cached');
  }

  // 3. Not configured → the code path exists but cannot work. Snapshot, quietly.
  if (!deps.webKeyConfigured()) return SNAPSHOT('unconfigured');

  // 4. THE BUDGET.
  if (!deps.budget.tryTake()) return SNAPSHOT('budget');

  // 5. THE LOOKUP, single-flighted per carrier.
  const existing = inFlight.get(usdot);
  if (existing) return existing;

  const task = (async (): Promise<AuthorityRevalidation> => {
    try {
      const snap = await deps.lookup(usdot);
      const status = liveAuthorityStatus(snap);
      if (status === 'unknown') {
        // FMCSA answered but we cannot interpret it. Not a transport failure, so
        // it does not count against the breaker — and nothing is cached, because
        // caching 'unknown' for a week would suppress a real answer next time.
        deps.budget.recordSuccess();
        return SNAPSHOT('lookup-failed');
      }
      deps.budget.recordSuccess();
      const checkedAt = deps.now();
      try {
        await deps.writeCache(usdot, status, checkedAt);
      } catch (err) {
        // A cache write failure costs us one repeated lookup later, nothing more.
        deps.log(`[authority] cache write failed for ${usdot} (non-fatal): ${String(err)}`);
      }
      return LIVE(status, checkedAt, 'fresh');
    } catch (err) {
      // lookupCarrierCompliance is documented never to throw; this is belt and
      // braces so an unexpected throw can never reach the visitor.
      deps.budget.recordFailure();
      deps.log(`[authority] live lookup failed for ${usdot} (non-fatal): ${String(err)}`);
      return SNAPSHOT('lookup-failed');
    } finally {
      inFlight.delete(usdot);
    }
  })();

  inFlight.set(usdot, task);
  return task;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. DEFAULT DEPS — the real DB + the real FMCSA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read the cached status. Raw SQL on purpose: these columns exist only in the
 * self-heal statements above, never in the drizzle table, so the ingest's
 * generated UPSERT cannot reach them.
 *
 * Tolerates the columns not existing yet (first boot before the self-heal has
 * run, undefined_column 42703) by returning null — a cache miss, which the
 * caller already handles.
 */
export async function readAuthorityCache(usdot: string): Promise<AuthorityCacheRow | null> {
  try {
    const rows = await db().execute<{ status: string | null; checked_at: Date | string | null }>(sql`
      select "authority_live_status" as status, "authority_live_checked_at" as checked_at
      from "carrier_directory"
      where "usdot" = ${usdot}
      limit 1
    `);
    const row = rows[0];
    if (!row) return null;
    const checked = row.checked_at ? new Date(row.checked_at) : null;
    return {
      status: isStatus(row.status) ? row.status : null,
      checkedAt: checked && Number.isFinite(checked.getTime()) ? checked : null,
    };
  } catch {
    return null;
  }
}

/**
 * Persist a live result.
 *
 * This is the ONLY writer of these two columns, and it touches NOTHING else —
 * in particular it never writes `updated_at`, so a per-view revalidation can
 * never move a carrier's sitemap `<lastmod>`.
 */
export async function writeAuthorityCache(
  usdot: string,
  status: LiveAuthorityStatus,
  checkedAt: Date,
): Promise<void> {
  await db().execute(sql`
    update "carrier_directory"
    set "authority_live_status" = ${status}, "authority_live_checked_at" = ${checkedAt.toISOString()}
    where "usdot" = ${usdot}
  `);
}

/** Live-lookup timeout. Tighter than the /compliance widget's 8s: this is a
 *  background enhancement to an already-rendered page, not a query someone is
 *  waiting on, so it should give up early and leave the snapshot in place. */
export const LOOKUP_TIMEOUT_MS = 4_000;

export function defaultRevalidationDeps(): RevalidationDeps {
  return {
    readCache: readAuthorityCache,
    writeCache: writeAuthorityCache,
    lookup: (usdot) => lookupCarrierCompliance('dot', usdot, { timeoutMs: LOOKUP_TIMEOUT_MS }),
    budget: authorityBudget,
    webKeyConfigured: () => !!process.env.FMCSA_WEBKEY,
    now: () => new Date(),
    log: (msg) => console.warn(msg),
  };
}
