/**
 * INDEXNOW — instant URL submission to Bing, Yandex and Seznam.
 *
 * WHY (measured, 2026-08-29): Search Console reports 355,075 URLs submitted from
 * our sitemap and 0 indexed; a sampled carrier profile sits at "Discovered –
 * currently not indexed" with lastCrawl: NEVER. Google has FOUND everything and
 * is choosing not to spend crawl budget on a young domain. IndexNow is the one
 * lever that skips discovery entirely: a push, not a pull. Bing/Yandex/Seznam
 * fetch what we tell them changed, immediately.
 *
 * GOOGLE DOES NOT PARTICIPATE. Nothing here affects Googlebot — Google has said
 * repeatedly it is not an IndexNow partner. This buys Bing + Yandex + Seznam
 * coverage (and the referral traffic and the crawl signal that comes with it),
 * not Google indexation. Task 2 (sitemap richness ordering, carrierRichness.ts)
 * is the lever aimed at Google.
 *
 * ── PROTOCOL (indexnow.org/documentation) ───────────────────────────────────
 *   1. OWNERSHIP: host a text file at https://<host>/<key>.txt whose entire body
 *      is the key. That file is the proof; without it every submission 403s.
 *   2. SUBMIT: POST https://api.indexnow.org/IndexNow with
 *      { host, key, keyLocation, urlList } — at most 10,000 URLs per request.
 *      api.indexnow.org fans the notification out to every participating engine.
 *   3. Response: 200 OK / 202 Accepted (key validation pending) are the only
 *      successes. 400 bad request, 403 key invalid, 422 URL/host mismatch,
 *      429 rate-limited.
 *
 * ── THE TWO RULES THAT KEEP A KEY ALIVE ─────────────────────────────────────
 * (a) NEVER RESUBMIT AN UNCHANGED URL. Repeatedly pushing the same unchanged
 *     URLs is what the protocol treats as abuse, and the penalty is silent — a
 *     key simply stops being honoured, with no error to tell you. So every
 *     submission is gated on a persisted per-URL `change_key`
 *     (`indexnow_submissions`): a URL is a candidate only if it has NEVER been
 *     submitted, or if its change key genuinely advanced. A URL is recorded ONLY
 *     after a 2xx, so a failed run retries rather than silently dropping URLs.
 * (b) NEVER A FIREHOSE. Submissions are wired to REAL change events — the
 *     off-path sitemap rebuild, which is itself triggered by the weekly FMCSA
 *     ingest landing (carrier-count/`updated_at` drift), by a new city hub
 *     appearing, and by a human approving a /guides article. Each run is capped
 *     at the protocol's 10,000 URLs, so the initial ~334k backlog drains as a
 *     bounded drip (~10k/day) instead of one abusive dump.
 *
 * ── DEFAULT DENY ────────────────────────────────────────────────────────────
 * Same posture as externalPullGuard: OFF unless a flag in exactly one place
 * (Doppler `prd`) says otherwise, and hard-OFF inside a test runner where no env
 * var can turn it back on. An unset key 404s the ownership route AND makes every
 * submission a no-op — so a dev/CI/agent process can never announce our URLs, or
 * burn the key's reputation, by accident.
 *
 *   INDEXNOW_KEY               the key + the /<key>.txt body. Unset → fully inert.
 *   INDEXNOW_ENABLED=1         explicit opt-in to actually POST. Unset/0 → no-op.
 *   INDEXNOW_MAX_URLS_PER_RUN  optional cap (default + hard ceiling 10,000).
 *
 * It gets its OWN kill switch rather than a slot in externalPullGuard's provider
 * enum because that guard exists to meter PAID credit spend into
 * `external_api_spend`; IndexNow is free, so a provider row there would report a
 * dollar cost that does not exist. It does reuse the guard's network primitive
 * (`fetchWithTimeout`) and its test-runner detection, so the socket discipline
 * is identical.
 */

import { sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { carrierDirectory, indexnowSubmissions } from '../../db/schema.js';
import { fetchWithTimeout, isTestRunner } from './externalPullGuard.js';
import { richnessScoreSql } from './carrierRichness.js';

/** The shared endpoint — fans out to every participating search engine. */
export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/IndexNow';

/** Protocol hard cap: at most 10,000 URLs in one request. */
export const INDEXNOW_MAX_URLS_PER_REQUEST = 10_000;

/** Whole-exchange deadline for the submission POST. Generous — the body can be
 *  ~700KB at the 10k cap — but finite so a hung endpoint cannot pin the socket. */
export const INDEXNOW_TIMEOUT_MS = 30_000;

/** After a 429 or a transport failure, hold off this long before trying again.
 *  Process-local: submissions only fire from the (at most hourly) off-path
 *  rebuild, so an in-memory cooldown is sufficient and needs no DB round-trip. */
export const INDEXNOW_COOLDOWN_MS = 6 * 60 * 60 * 1000;

/** IndexNow keys are 8–128 chars of [a-zA-Z0-9-] (protocol requirement). */
export const INDEXNOW_KEY_PATTERN = /^[A-Za-z0-9-]{8,128}$/;

/**
 * Version stamp used as the `change_key` for URL families that have NO real
 * change timestamp — the static marketing/hub routes and the city hubs. Those
 * URLs are announced exactly ONCE and then never again, which is the honest
 * behaviour: we cannot detect a copy edit on a static route, so claiming one
 * every week would be precisely the unchanged-resubmission the protocol
 * punishes. Bump this constant DELIBERATELY when those pages are materially
 * rewritten and the whole family is re-announced once.
 */
export const STATIC_CHANGE_KEY = 'v1';

/** Which URL family a tracked submission belongs to. */
export type IndexNowKind = 'page' | 'city' | 'guide' | 'carrier';

/**
 * The in-memory lookup key for one tracked submission — the (kind, ref)
 * composite primary key, flattened.
 *
 * A named helper rather than an inline template on purpose: the ledger lookup
 * and the candidate filter MUST agree byte-for-byte, and when they did not (an
 * early draft used a different separator on each side) the symptom was the worst
 * one this module has — every URL looked unsubmitted, so every run would have
 * re-announced the whole set and burned the key's reputation. One function, one
 * format, no way to drift.
 * The separator is a plain `|`: refs are slugs (`[a-z0-9-]`), URL paths, or a
 * `state/city` pair, none of which can contain one, so two different (kind, ref)
 * pairs can never flatten to the same string.
 */
export const SUBMISSION_KEY_SEPARATOR = '|';

export function submissionKey(kind: string, ref: string): string {
  return `${kind}${SUBMISSION_KEY_SEPARATOR}${ref}`;
}

const TRUEY = /^(1|true|yes|on)$/i;
const FALSEY = /^(0|false|no|off)$/i;

// ─── Gate ───────────────────────────────────────────────────────────────────

/** In-code test opt-in (mocked fetch only). `null` = follow the normal rule. */
let testOverride: boolean | null = null;

/** TEST-ONLY: force the gate open/closed for tests that drive a MOCKED fetch.
 *  Ignored outside a test runner, so it can never widen behaviour in prod. */
export function __setIndexNowForTests(value: boolean | null): void {
  testOverride = value;
}

/** The configured key, or null when unset/malformed. A malformed key is treated
 *  exactly like an absent one — we never serve or submit a key the protocol
 *  would reject, because a 403 from a bad key is indistinguishable from a
 *  revoked one and would send us chasing the wrong bug. */
export function indexNowKey(): string | null {
  const raw = (process.env.INDEXNOW_KEY ?? '').trim();
  if (!raw) return null;
  return INDEXNOW_KEY_PATTERN.test(raw) ? raw : null;
}

export interface IndexNowGate {
  allowed: boolean;
  /** Short, log-safe explanation. Never contains the key. */
  reason: string;
}

/**
 * THE decision. DEFAULT DENY.
 *   1. test runner              → OFF (in-code opt-in only; env cannot win)
 *   2. INDEXNOW_ENABLED = 0     → OFF (kill switch, works even in prod)
 *   3. no key                   → OFF (nothing to prove ownership with)
 *   4. INDEXNOW_ENABLED = 1     → ON
 *   5. anything else            → OFF
 */
export function indexNowAllowed(): IndexNowGate {
  if (isTestRunner()) {
    if (testOverride === true) return { allowed: true, reason: 'test-opt-in (mocked fetch)' };
    return { allowed: false, reason: 'test runner — IndexNow submission is never allowed' };
  }
  const raw = (process.env.INDEXNOW_ENABLED ?? '').trim();
  if (FALSEY.test(raw)) return { allowed: false, reason: 'INDEXNOW_ENABLED=0' };
  if (!indexNowKey()) {
    return { allowed: false, reason: 'INDEXNOW_KEY unset or malformed' };
  }
  if (TRUEY.test(raw)) return { allowed: true, reason: 'INDEXNOW_ENABLED=1' };
  return { allowed: false, reason: 'no opt-in (INDEXNOW_ENABLED unset)' };
}

/** Per-run URL cap: the protocol ceiling, optionally lowered by env. Never
 *  raised above INDEXNOW_MAX_URLS_PER_REQUEST no matter what the env says. */
export function indexNowRunCap(): number {
  const raw = Number.parseInt((process.env.INDEXNOW_MAX_URLS_PER_RUN ?? '').trim(), 10);
  if (!Number.isFinite(raw) || raw <= 0) return INDEXNOW_MAX_URLS_PER_REQUEST;
  return Math.min(raw, INDEXNOW_MAX_URLS_PER_REQUEST);
}

// ─── Payload ────────────────────────────────────────────────────────────────

export interface IndexNowPayload {
  host: string;
  key: string;
  keyLocation: string;
  urlList: string[];
}

/** The ownership-file path for a key, e.g. `/abc123….txt`. */
export function keyFilePath(key: string): string {
  return `/${key}.txt`;
}

/**
 * Any root-level `/<something>.txt` whose name COULD be an IndexNow key. Kept
 * narrow (the protocol's own charset and 8–128 length) and paired with an exact
 * match in the handler, so this route can never shadow another root text file:
 * a non-matching request falls straight through to `next()`.
 */
export const INDEXNOW_KEY_ROUTE = /^\/[A-Za-z0-9-]{8,128}\.txt$/;

/**
 * Decide what `/<name>.txt` should return, given the configured key. Pure, so
 * the fail-closed behaviour is testable without an HTTP server.
 *
 * FAILS CLOSED: with no key configured (dev, CI, an agent's checkout) NOTHING is
 * served and every path falls through to the normal 404. We never publish an
 * ownership proof from a process that was not deliberately given one — and a
 * malformed key is treated as no key, so we never serve a proof the protocol
 * would reject anyway.
 */
export function resolveIndexNowKeyFile(pathname: string, key: string | null): string | null {
  if (!key) return null;
  return pathname === keyFilePath(key) ? key : null;
}

/** Minimal shapes this handler needs — keeps the module free of an express
 *  value import (the routes file supplies the real objects). */
interface KeyFileReq {
  path: string;
}
interface KeyFileRes {
  type(t: string): unknown;
  setHeader(name: string, value: string): unknown;
  send(body: string): unknown;
}

/**
 * Serve the IndexNow ownership proof. The protocol requires a text file at the
 * site root whose ENTIRE body is the key; without it every submission is
 * rejected 403.
 *
 * Read from env rather than committed to the repo so the key is rotatable in
 * Doppler alone and a fork/dev/CI checkout is inert.
 */
export function indexNowKeyFileHandler(req: KeyFileReq, res: KeyFileRes, next: () => void): void {
  const body = resolveIndexNowKeyFile(req.path, indexNowKey());
  if (body === null) {
    next(); // not our key (or none configured) → falls through to the normal 404
    return;
  }
  res.type('text/plain');
  // Search engines re-fetch this on every submission; it changes only on a
  // deliberate key rotation, which ships as a redeploy anyway.
  res.setHeader('Cache-Control', 'public, max-age=86400');
  // EXACTLY the key, no trailing newline — the spec compares the file body.
  res.send(body);
}

/**
 * Build the POST body. `site` is the canonical origin (https://quotefleet.net);
 * `host` is derived from it so the two can never disagree — a host/URL mismatch
 * is exactly what the protocol answers 422 to.
 */
export function buildIndexNowPayload(site: string, key: string, urls: string[]): IndexNowPayload {
  const host = new URL(site).host;
  return {
    host,
    key,
    keyLocation: `${site}${keyFilePath(key)}`,
    urlList: urls,
  };
}

// ─── Submission ─────────────────────────────────────────────────────────────

export type IndexNowOutcome =
  /** 200/202 — the engines accepted the batch. */
  | { status: 'submitted'; httpStatus: number; count: number }
  /** The gate said no, or there was nothing to send. No socket was opened. */
  | { status: 'skipped'; reason: string }
  /** A non-2xx answer, or a transport failure. NEVER logged as a success. */
  | { status: 'failed'; httpStatus: number | null; reason: string };

/** Human-readable meaning of the documented status codes, for honest logging. */
export function describeIndexNowStatus(httpStatus: number): string {
  switch (httpStatus) {
    case 200:
      return 'OK — URLs submitted';
    case 202:
      return 'Accepted — key validation pending';
    case 400:
      return 'Bad request — invalid payload format';
    case 403:
      return 'Forbidden — key not valid (is /<key>.txt served and does it match?)';
    case 422:
      return 'Unprocessable — URLs do not belong to the host, or key/schema mismatch';
    case 429:
      return 'Too Many Requests — throttled (potential spam)';
    default:
      return `unexpected status ${httpStatus}`;
  }
}

/** Only 200 and 202 mean the batch was accepted. Everything else is a failure,
 *  including any other 2xx — the protocol defines exactly these two, and
 *  treating an undocumented 2xx as success would let us mark URLs submitted that
 *  never were. */
export function isIndexNowSuccess(httpStatus: number): boolean {
  return httpStatus === 200 || httpStatus === 202;
}

/** Process-local cooldown set after a 429 / transport failure. */
let cooldownUntilMs = 0;

/** TEST-ONLY: clear the cooldown + the in-code override between cases. */
export function __resetIndexNowForTests(): void {
  cooldownUntilMs = 0;
  testOverride = null;
}

/**
 * POST one batch. Returns an honest outcome — a non-2xx is NEVER reported as
 * submitted, and the caller only records `indexnow_submissions` rows on
 * `status: 'submitted'`, so a failure leaves those URLs as candidates for the
 * next run instead of silently swallowing them.
 */
export async function submitUrlBatch(
  site: string,
  urls: string[],
  now: number = Date.now(),
): Promise<IndexNowOutcome> {
  const gate = indexNowAllowed();
  if (!gate.allowed) return { status: 'skipped', reason: gate.reason };
  if (urls.length === 0) return { status: 'skipped', reason: 'no changed URLs' };
  if (now < cooldownUntilMs) {
    return { status: 'skipped', reason: `cooling down until ${new Date(cooldownUntilMs).toISOString()}` };
  }
  const key = indexNowKey();
  if (!key) return { status: 'skipped', reason: 'INDEXNOW_KEY unset or malformed' };
  if (urls.length > INDEXNOW_MAX_URLS_PER_REQUEST) {
    // Defensive: the caller caps, but a >10k body is a 400 and would burn the
    // whole batch. Refuse locally rather than learn it from the endpoint.
    return { status: 'failed', httpStatus: null, reason: `batch of ${urls.length} exceeds the 10,000-URL cap` };
  }

  const payload = buildIndexNowPayload(site, key, urls);
  let res: Response;
  try {
    res = await fetchWithTimeout(
      INDEXNOW_ENDPOINT,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(payload),
      },
      INDEXNOW_TIMEOUT_MS,
    );
  } catch (err) {
    cooldownUntilMs = now + INDEXNOW_COOLDOWN_MS;
    return { status: 'failed', httpStatus: null, reason: `transport error: ${(err as Error)?.message ?? 'unknown'}` };
  }

  if (!isIndexNowSuccess(res.status)) {
    // 429 is the one status where retrying soon makes things worse.
    if (res.status === 429) cooldownUntilMs = now + INDEXNOW_COOLDOWN_MS;
    return { status: 'failed', httpStatus: res.status, reason: describeIndexNowStatus(res.status) };
  }
  return { status: 'submitted', httpStatus: res.status, count: urls.length };
}

// ─── Candidate tracking (`indexnow_submissions`) ────────────────────────────

/** One URL considered for submission, with the identity we track it by. */
export interface IndexNowCandidate {
  kind: IndexNowKind;
  /** Family-relative identity: a carrier/guide slug, a city `state/city` pair,
   *  or a static path. NOT the full URL — keeps the tracking table's composite
   *  PK narrow and lets the carrier anti-join key straight off `public_slug`. */
  ref: string;
  /** Absolute URL actually announced. */
  url: string;
  /** Opaque token that advances IFF the page's content genuinely changed. */
  changeKey: string;
}

/**
 * The carrier `change_key`, computed SERVER-SIDE so JS never reconstructs it.
 * The dedupe predicate and the value we persist are the SAME expression, so a
 * formatting difference between Postgres and `Date#toISOString` can never make
 * every carrier look changed (which would turn the dedupe into a firehose).
 *
 * Second granularity is deliberate: `updated_at` only advances on a REAL field
 * change (see carrierIngest.ts CARRIER_UPSERT_SET), so sub-second precision
 * would add nothing but churn.
 */
const CARRIER_CHANGE_KEY_SQL = `to_char("carrier_directory"."updated_at", 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

/**
 * Carrier URLs that have NEVER been submitted, or whose `updated_at` advanced
 * since we last submitted them — RICHEST FIRST, capped.
 *
 * OFF THE REQUEST PATH ONLY. This is an anti-join across the ~330k-row directory
 * and is called exclusively from the sitemap rebuild, inside a bounded
 * transaction (`SET LOCAL statement_timeout`). Nothing on a crawler's or a
 * user's request path calls it, and the request path gains no new query at all.
 *
 * WHY IT IS NOT AN INDEX SEEK, and why that is right: the question this query
 * asks is "of every carrier we have not yet announced, which are the richest
 * 10,000?" — it is a global top-N over a computed expression, so it must see
 * every row. No index can answer it without materialising the score as a stored
 * column, which would add write amplification to the weekly 330k-row ingest to
 * serve a query that runs at most hourly, off-path. Verified against prod
 * (EXPLAIN, plan-only) on 2026-08-29: parallel Seq Scan → BOUNDED (top-N) Sort →
 * Gather Merge → Limit, total cost 52,980, and the LIMIT is pushed down into
 * each worker's sort so only 10,000 tuples are held per process (~1MB against a
 * 4MB work_mem) — the sort is estimated to stay in memory, no spill. That memory
 * headroom is ~4x, which is a second reason the 10,000 cap is not negotiable
 * upward: past roughly 40,000 the bounded sort flips to an external merge.
 *
 * The join half of the plan could not be measured (indexnow_submissions does not
 * exist on prod until this migration lands) but it keys on the FULL composite
 * primary key (kind, ref), which is why the ledger is keyed that way rather than
 * by URL string.
 *
 * Rich-first ordering is not cosmetic: the ~330k backlog drains at ≤10k per run,
 * so this ORDER BY decides which pages Bing sees this month versus next year.
 * Measured on prod, the first 10,000 are all carriers scoring ≥71 out of 100.
 */
export async function fetchCarrierCandidates(
  site: string,
  limit: number,
  tx: { execute: (q: ReturnType<typeof sql.raw>) => Promise<unknown> },
): Promise<IndexNowCandidate[]> {
  const rows = (await tx.execute(
    sql.raw(`
      SELECT "carrier_directory"."public_slug" AS slug,
             ${CARRIER_CHANGE_KEY_SQL} AS change_key,
             ${richnessScoreSql()} AS score
        FROM "carrier_directory"
        LEFT JOIN "indexnow_submissions"
          ON "indexnow_submissions"."kind" = 'carrier'
         AND "indexnow_submissions"."ref" = "carrier_directory"."public_slug"
       WHERE "indexnow_submissions"."ref" IS NULL
          OR "indexnow_submissions"."change_key" IS DISTINCT FROM ${CARRIER_CHANGE_KEY_SQL}
       ORDER BY score DESC,
                "carrier_directory"."power_units" DESC NULLS LAST,
                "carrier_directory"."public_slug" ASC
       LIMIT ${Math.max(0, Math.trunc(limit))}
    `),
  )) as unknown as Array<{ slug: string; change_key: string }>;
  return Array.from(rows ?? []).map((r) => ({
    kind: 'carrier' as const,
    ref: r.slug,
    url: `${site}/directory/carrier/${r.slug}`,
    changeKey: r.change_key,
  }));
}

/**
 * Already-submitted change keys for the SMALL families (pages / cities /
 * guides). Bounded by an index range scan per kind on the (kind, ref) PK — a few
 * thousand rows total, versus the ~334k carriers which are filtered in SQL by
 * `fetchCarrierCandidates` instead.
 */
export async function fetchSmallFamilyState(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const rows = await db()
      .select({
        kind: indexnowSubmissions.kind,
        ref: indexnowSubmissions.ref,
        changeKey: indexnowSubmissions.changeKey,
      })
      .from(indexnowSubmissions)
      .where(sql`${indexnowSubmissions.kind} in ('page','city','guide')`);
    for (const r of rows) out.set(submissionKey(r.kind, r.ref), r.changeKey);
  } catch (err) {
    console.warn('[indexnow] submission-state read failed:', (err as Error)?.message);
    // Rethrow-free, but signal the failure by returning an EMPTY map? No — an
    // empty map would look like "nothing submitted yet" and re-announce every
    // small-family URL. Throw so the caller skips this run entirely.
    throw err;
  }
  return out;
}

/**
 * Filter a candidate list down to the ones that are genuinely new or changed.
 * Pure — the caller supplies the persisted state — so the never-resubmit rule is
 * unit-testable without a database.
 */
export function selectChangedCandidates(
  candidates: readonly IndexNowCandidate[],
  state: ReadonlyMap<string, string>,
): IndexNowCandidate[] {
  const seen = new Set<string>();
  const out: IndexNowCandidate[] = [];
  for (const c of candidates) {
    const k = submissionKey(c.kind, c.ref);
    if (seen.has(k)) continue; // never announce the same URL twice in one batch
    seen.add(k);
    if (state.get(k) === c.changeKey) continue; // unchanged since last submission
    out.push(c);
  }
  return out;
}

/** Persist what we just announced. Called ONLY after a 2xx — a failed batch must
 *  stay a candidate. Chunked so a 10k batch is a handful of statements. */
export async function recordSubmissions(
  candidates: readonly IndexNowCandidate[],
  submittedAt: Date = new Date(),
): Promise<void> {
  const CHUNK = 1_000;
  for (let i = 0; i < candidates.length; i += CHUNK) {
    const values = candidates.slice(i, i + CHUNK).map((c) => ({
      kind: c.kind,
      ref: c.ref,
      changeKey: c.changeKey,
      submittedAt,
    }));
    await db()
      .insert(indexnowSubmissions)
      .values(values)
      .onConflictDoUpdate({
        target: [indexnowSubmissions.kind, indexnowSubmissions.ref],
        set: { changeKey: sql`excluded.change_key`, submittedAt: sql`excluded.submitted_at` },
      });
  }
}

// ─── Orchestration ──────────────────────────────────────────────────────────

/** The non-carrier URL families, assembled by the caller (which already has
 *  them in hand from the sitemap rebuild) so this module never has to import
 *  sitemapCache back — that would be a cycle. */
export interface IndexNowSmallFamilies {
  /** Static marketing / hub paths, e.g. '/pricing', '/directory/tx'. */
  pagePaths: readonly string[];
  /** Real city hubs as { stateSlug, citySlug }. */
  cityHubs: readonly { stateSlug: string; citySlug: string }[];
  /** Published guides with their REAL last-change timestamp. */
  guides: readonly { slug: string; lastmod: Date | null }[];
}

/** Build the small-family candidates. Pure. */
export function buildSmallFamilyCandidates(
  site: string,
  fam: IndexNowSmallFamilies,
): IndexNowCandidate[] {
  const out: IndexNowCandidate[] = [];
  for (const p of fam.pagePaths) {
    out.push({ kind: 'page', ref: p, url: `${site}${p}`, changeKey: STATIC_CHANGE_KEY });
  }
  for (const h of fam.cityHubs) {
    const ref = `${h.stateSlug}/${h.citySlug}`;
    out.push({ kind: 'city', ref, url: `${site}/directory/${ref}`, changeKey: STATIC_CHANGE_KEY });
  }
  for (const g of fam.guides) {
    // Guides DO have a real change timestamp (the editor's last save / the
    // approve), so a re-edited article is legitimately re-announced.
    const ts = g.lastmod instanceof Date && !Number.isNaN(g.lastmod.getTime()) ? g.lastmod : null;
    out.push({
      kind: 'guide',
      ref: g.slug,
      url: `${site}/guides/${g.slug}`,
      changeKey: ts ? ts.toISOString() : STATIC_CHANGE_KEY,
    });
  }
  return out;
}

export interface IndexNowRunResult {
  outcome: IndexNowOutcome;
  /** How many URLs were eligible before the per-run cap. */
  eligible: number;
  /** How many were actually announced. */
  submitted: number;
}

/**
 * ONE submission run. Called from the OFF-PATH sitemap rebuild — i.e. after the
 * weekly FMCSA ingest lands (carrier drift rebuild), after a new city hub
 * appears, and after a human approves a /guides article (the approve route
 * already kicks a rebuild). Never from a request handler.
 *
 * Order of precedence inside the cap: the small, high-value families first
 * (marketing/hub pages, city hubs, guides), then carriers richest-first. So the
 * hub pages that pass authority down to 334k profiles are always announced
 * before the profiles themselves.
 *
 * NEVER THROWS — discovery is a best-effort side-channel and must not be able to
 * fail a sitemap rebuild that has already succeeded.
 */
export async function runIndexNowSubmission(
  site: string,
  fam: IndexNowSmallFamilies,
  tx: { execute: (q: ReturnType<typeof sql.raw>) => Promise<unknown> },
): Promise<IndexNowRunResult> {
  const skip = (reason: string): IndexNowRunResult => ({
    outcome: { status: 'skipped', reason },
    eligible: 0,
    submitted: 0,
  });
  const gate = indexNowAllowed();
  if (!gate.allowed) return skip(gate.reason);

  const cap = indexNowRunCap();
  try {
    const state = await fetchSmallFamilyState();
    const small = selectChangedCandidates(buildSmallFamilyCandidates(site, fam), state);

    let candidates = small;
    if (small.length < cap) {
      // Carriers are filtered by the SQL anti-join, so they arrive already
      // "changed only" — no second pass needed. Ask for exactly the remaining
      // room so the query's LIMIT does the capping.
      const carriers = await fetchCarrierCandidates(site, cap - small.length, tx);
      candidates = [...small, ...carriers];
    }

    const eligible = candidates.length;
    const batch = candidates.slice(0, cap);
    const outcome = await submitUrlBatch(site, batch.map((c) => c.url));
    if (outcome.status !== 'submitted') {
      console.warn(
        `[indexnow] not submitted — ${outcome.status}: ${'reason' in outcome ? outcome.reason : ''}` +
          ('httpStatus' in outcome && outcome.httpStatus != null ? ` (HTTP ${outcome.httpStatus})` : ''),
      );
      return { outcome, eligible, submitted: 0 };
    }
    // Record ONLY on a 2xx.
    await recordSubmissions(batch);
    console.log(
      `[indexnow] submitted ${batch.length} URL(s) (HTTP ${outcome.httpStatus}); ${Math.max(0, eligible - batch.length)} still queued`,
    );
    return { outcome, eligible, submitted: batch.length };
  } catch (err) {
    console.warn('[indexnow] run failed (non-fatal):', (err as Error)?.message);
    return {
      outcome: { status: 'failed', httpStatus: null, reason: (err as Error)?.message ?? 'unknown' },
      eligible: 0,
      submitted: 0,
    };
  }
}
