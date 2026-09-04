/**
 * PERSISTENCE — and the two invariants that make polling somebody else's web
 * server safe to write down.
 *
 * ── INVARIANT 1: A FAILED FETCH CAN NEVER ERASE GOOD DATA ─────────────────
 * There is precedent for this in this repo and it is not theoretical. #465 and
 * `directory/ingestSoftFailure.test.ts` document the same bug twice: a fetch
 * that came back empty was written as an authoritative zero, which nulled
 * published columns across ~330k rows AND flipped `IS DISTINCT FROM` on every
 * one of them, so `updated_at` — which the sitemap publishes as `<lastmod>` —
 * jumped on 330k URLs because an upstream had a bad minute.
 *
 * The structural fix here is that success and failure are DIFFERENT SQL
 * STATEMENTS, not one statement with a conditional payload:
 *
 *   `recordSuccess`  writes the payload columns AND the bookkeeping columns.
 *   `recordFailure`  writes ONLY `last_attempt_at`, `fetch_status` and
 *                    `last_error`. It does not name `rows_json`,
 *                    `retrieved_on`, `row_count`, `content_hash` or
 *                    `source_revised_on` at all — so there is no code path,
 *                    however the caller is refactored, that lets a failure
 *                    reach the data. You cannot clear a column you never
 *                    mention.
 *
 * A failure therefore leaves the last good snapshot exactly where it was, ages
 * it, and lets `advisory.ts` render it as STALE with its true age and the
 * direction the staleness errs in. That is the honest outcome: the data is old
 * and says so, rather than gone and silent.
 *
 * ── INVARIANT 2: A POLL THAT FINDS NOTHING NEW CHANGES NOTHING ────────────
 * `updated_at` moves only when `content_hash` actually differs — the same
 * shape as `CARRIER_UPDATED_AT_SQL`. Eight polls a day per state, times a
 * dozen states, times a season, is thousands of writes that must not
 * manufacture change timestamps. `retrieved_on` DOES move on every success,
 * because "when did we last confirm this" is a different question from "when
 * did this last change", and conflating them is what `provenance.ts` exists to
 * prevent.
 *
 * ── THE DATABASE BEING DOWN IS A FIRST-CLASS CASE ─────────────────────────
 * The dev Neon branch is over quota and 500s, and Neon's serverless compute
 * suspends in prod. So:
 *   • Every read is wrapped and degrades to the in-process last-good cache,
 *     and then to an EMPTY context flagged `storeUnavailable`. Nothing here
 *     throws into a request or a cron tick.
 *   • `emptySeasonalContext(true)` is NOT "no restrictions". `advisory.ts`
 *     renders it as "we do not know", with the state's own link.
 *   • A successful FETCH whose WRITE fails still updates the in-memory cache,
 *     so the running process serves the fresh data it genuinely has while the
 *     ledger records the persist failure. The data is real; only the durability
 *     is missing, and only the missing part is reported as failed.
 */
import { sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { runSelfHealStatements } from '../../db/migrate.js';
import { SEASONAL_RESTRICTIONS_DDL } from '../../db/seasonalRestrictionsDdl.js';
import { describeDbError, withDbRetry } from '../../db/retry.js';
import { todayIso, type IsoDate } from '../../calc/osow/provenance.js';
import { cadenceFor, stalenessBudgetDays } from '../../calc/osow/seasonal/schedule.js';
import { SEASONAL_SOURCES, seasonalSourceFor } from '../../calc/osow/seasonal/sources.js';
import {
  ageInDays,
  emptySeasonalContext,
  type SeasonalContext,
  type SeasonalRestriction,
  type StateSeasonalSnapshot,
} from '../../calc/osow/seasonal/types.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1. STORAGE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Created by SELF-HEAL ONLY, on the same terms as `job_runs`.
 *
 * Deliberately NOT in `src/db/schema.ts` and NOT in `drizzle/`: Replit's deploy
 * skips db:migrate and its publish tool has repeatedly proposed removing tables
 * the ORM does not know about (see `project_quotefleet_replit_phantom_drops`).
 * Every at-risk object in this codebase is re-asserted on each boot instead, so
 * a phantom removal self-repairs on the next start.
 *
 * The statement shapes are exactly the two `selfHealTarget()` recognises, so
 * the catalog pre-check makes a healthy boot a lock-free no-op — no
 * ACCESS EXCLUSIVE is ever taken to discover the table is already there. These
 * are also mirrored into `SELF_HEAL_TABLE_STATEMENTS` so the existing schema
 * tests police them alongside every other self-healed object.
 */
export { SEASONAL_RESTRICTIONS_DDL as SEASONAL_SELF_HEAL_STATEMENTS } from '../../db/seasonalRestrictionsDdl.js';

/** Boot hook, mirroring `ensureJobRunsTable`. Non-blocking at the call site. */
export async function ensureSeasonalRestrictionsTable(): Promise<void> {
  await runSelfHealStatements('seasonal_restrictions', SEASONAL_RESTRICTIONS_DDL);
}

/**
 * `updated_at` moves ONLY on a genuine content change.
 *
 * Exported so a test can assert the exact string handed to Postgres, the same
 * way `CARRIER_UPDATED_AT_SQL` is. A poll that finds the identical bulletin is
 * a confirmation, not an edit, and must leave every change timestamp alone.
 */
export const SEASONAL_UPDATED_AT_SQL =
  `CASE WHEN "seasonal_restrictions"."content_hash" IS DISTINCT FROM excluded."content_hash" ` +
  `THEN now() ELSE "seasonal_restrictions"."updated_at" END`;

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE IN-PROCESS LAST-GOOD CACHE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The snapshot each state was last KNOWN good at, in memory.
 *
 * Not an optimisation. It is what lets the process answer correctly while the
 * database is unreachable, which is the state the dev branch is permanently in
 * and the state prod enters every time a suspended Neon compute is woken by
 * something else first. It is bounded by construction — one entry per state in
 * the registry, and the registry is a compile-time constant.
 */
const lastGood = new Map<string, StateSeasonalSnapshot>();

/** Test seam. Never called in production code. */
export function __resetSeasonalCacheForTests(): void {
  lastGood.clear();
}

export function cachedSnapshot(code: string): StateSeasonalSnapshot | null {
  return lastGood.get(String(code ?? '').toUpperCase()) ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. WRITES
// ─────────────────────────────────────────────────────────────────────────────

export interface SuccessfulFetch {
  state: string;
  rows: SeasonalRestriction[];
  bulletinDate: IsoDate | null;
  retrievedOn: IsoDate;
  verifiedClear: boolean;
  /** Records the SOURCE contained, before filtering to in-force. */
  recordCount: number;
  /** Stable digest of the parsed content, for the no-change check. */
  contentHash: string;
}

/**
 * A cheap, stable digest of what we parsed.
 *
 * Deliberately NOT a hash of the raw response body: state pages carry session
 * ids, timestamps and rotating ad slots, so the body changes on every fetch
 * while the RESTRICTIONS do not. Hashing the parsed rows means `updated_at`
 * tracks the thing we actually publish.
 *
 * FNV-1a, because this is a change detector and not a security boundary; it
 * needs to be stable across restarts and cheap, and it is both.
 */
export function contentHashOf(rows: SeasonalRestriction[], verifiedClear: boolean): string {
  const canonical = JSON.stringify({
    verifiedClear,
    rows: rows.map((r) => [r.effectiveFrom, r.effectiveTo, r.value.area, r.value.limit, r.value.orderRef ?? '']),
  });
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `fnv1a-${h.toString(16).padStart(8, '0')}-${canonical.length}`;
}

/**
 * Persist a successful fetch, and update the in-memory cache FIRST.
 *
 * The order matters. The cache is updated before the write is attempted, so a
 * database failure loses only durability, never the fresh data the process
 * already has in hand. Returns `true` when the row was persisted.
 */
export async function recordSuccess(fetched: SuccessfulFetch): Promise<boolean> {
  const spec = seasonalSourceFor(fetched.state);
  if (spec === null) return false;

  lastGood.set(spec.code, {
    code: spec.code,
    name: spec.name,
    programme: spec.programme,
    rows: fetched.rows,
    retrievedOn: fetched.retrievedOn,
    bulletinDate: fetched.bulletinDate,
    fetchStatus: 'ok',
    verifiedClear: fetched.verifiedClear,
    staleFailureDirection: spec.staleFailureDirection,
    authorityUrl: spec.authorityUrl,
    authorityTitle: spec.authorityTitle,
    lastError: null,
    ageDays: 0,
  });

  try {
    await withDbRetry(
      () =>
        db().execute(sql`
          insert into "seasonal_restrictions" (
            "state", "programme", "source_url", "source_title", "source_revised_on",
            "retrieved_on", "rows_json", "row_count", "record_count", "verified_clear",
            "content_hash", "fetch_status", "last_attempt_at", "last_success_at",
            "last_error", "updated_at"
          ) values (
            ${spec.code}, ${spec.programme}, ${spec.authorityUrl}, ${spec.authorityTitle},
            ${fetched.bulletinDate}, ${fetched.retrievedOn}, ${JSON.stringify(fetched.rows)}::jsonb,
            ${fetched.rows.length}, ${fetched.recordCount}, ${fetched.verifiedClear},
            ${fetched.contentHash}, 'ok', now(), now(), null, now()
          )
          on conflict ("state") do update set
            "programme" = excluded."programme",
            "source_url" = excluded."source_url",
            "source_title" = excluded."source_title",
            "source_revised_on" = excluded."source_revised_on",
            "retrieved_on" = excluded."retrieved_on",
            "rows_json" = excluded."rows_json",
            "row_count" = excluded."row_count",
            "record_count" = excluded."record_count",
            "verified_clear" = excluded."verified_clear",
            "content_hash" = excluded."content_hash",
            "fetch_status" = 'ok',
            "last_attempt_at" = now(),
            "last_success_at" = now(),
            "last_error" = null,
            "updated_at" = ${sql.raw(SEASONAL_UPDATED_AT_SQL)}
        `),
      { label: `seasonal_restrictions upsert (${spec.code})` },
    );
    return true;
  } catch (err) {
    console.warn(
      `[seasonal.store] ${spec.code} fetched OK but could not be persisted: ${describeDbError(err)}. ` +
        `The in-memory snapshot is current for this process; the row on disk is unchanged.`,
    );
    return false;
  }
}

/**
 * Record that an attempt FAILED.
 *
 * READ THE COLUMN LIST. It names `last_attempt_at`, `fetch_status` and
 * `last_error` and NOTHING ELSE. `rows_json`, `retrieved_on`, `row_count`,
 * `content_hash`, `verified_clear` and `updated_at` are absent by design: a
 * failed fetch has nothing to say about them, and the only way to guarantee it
 * can never clear them is to never write them. This is invariant 1 expressed
 * as SQL rather than as a comment.
 *
 * The INSERT branch exists for a state that has never succeeded — it creates a
 * row whose data columns are null and whose status is `never`, which is what
 * the page and the advisory need to say "we hold nothing here" rather than
 * silently omitting the state.
 */
export async function recordFailure(state: string, error: string): Promise<boolean> {
  const spec = seasonalSourceFor(state);
  if (spec === null) return false;
  const cached = lastGood.get(spec.code);
  if (cached) lastGood.set(spec.code, { ...cached, lastError: error });

  try {
    await withDbRetry(
      () =>
        db().execute(sql`
          insert into "seasonal_restrictions" (
            "state", "programme", "source_url", "source_title",
            "fetch_status", "last_attempt_at", "last_error"
          ) values (
            ${spec.code}, ${spec.programme}, ${spec.authorityUrl}, ${spec.authorityTitle},
            'never', now(), ${error}
          )
          on conflict ("state") do update set
            "last_attempt_at" = now(),
            "last_error" = excluded."last_error",
            "fetch_status" = case
              when "seasonal_restrictions"."retrieved_on" is null then 'never'
              else 'stale'
            end
        `),
      { label: `seasonal_restrictions failure (${spec.code})` },
    );
    return true;
  } catch (err) {
    console.warn(
      `[seasonal.store] could not record ${spec.code} failure: ${describeDbError(err)} (original: ${error})`,
    );
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. READS
// ─────────────────────────────────────────────────────────────────────────────

interface SeasonalRow {
  state: string;
  source_revised_on: string | Date | null;
  retrieved_on: string | Date | null;
  rows_json: unknown;
  verified_clear: boolean | null;
  fetch_status: string | null;
  last_attempt_at: string | Date | null;
  last_error: string | null;
}

function isoOf(value: string | Date | null): IsoDate | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const s = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

function snapshotFromRow(row: SeasonalRow, asOf: IsoDate, now: Date): StateSeasonalSnapshot | null {
  const spec = seasonalSourceFor(row.state);
  if (spec === null) return null;
  const retrievedOn = isoOf(row.retrieved_on);
  const parsed = Array.isArray(row.rows_json) ? (row.rows_json as SeasonalRestriction[]) : [];
  const age = retrievedOn === null ? null : ageInDays(retrievedOn, asOf);
  const budget = stalenessBudgetDays(cadenceFor(spec, now).tier);
  const status =
    retrievedOn === null
      ? ('never' as const)
      : age !== null && age > budget
        ? ('stale' as const)
        : ('ok' as const);
  return {
    code: spec.code,
    name: spec.name,
    programme: spec.programme,
    rows: parsed,
    retrievedOn,
    bulletinDate: isoOf(row.source_revised_on),
    fetchStatus: status,
    verifiedClear: row.verified_clear === true,
    staleFailureDirection: spec.staleFailureDirection,
    authorityUrl: spec.authorityUrl,
    authorityTitle: spec.authorityTitle,
    lastError: row.last_error,
    ageDays: age,
  };
}

/** The snapshot every state in the registry would have with NOTHING stored. */
function neverSnapshot(code: string): StateSeasonalSnapshot | null {
  const spec = seasonalSourceFor(code);
  if (spec === null) return null;
  return {
    code: spec.code,
    name: spec.name,
    programme: spec.programme,
    rows: [],
    retrievedOn: null,
    bulletinDate: null,
    fetchStatus: spec.ingestion === 'none' ? 'not-applicable' : 'never',
    verifiedClear: false,
    staleFailureDirection: spec.staleFailureDirection,
    authorityUrl: spec.authorityUrl,
    authorityTitle: spec.authorityTitle,
    lastError: null,
    ageDays: null,
  };
}

/**
 * Load every state's snapshot.
 *
 * NEVER THROWS. A dead database degrades to the in-process cache, and then to
 * `storeUnavailable: true` — which `advisory.ts` renders as "we do not know",
 * never as "no restrictions". That distinction is the entire safety property of
 * this module: the failure mode of a frost-law feature is a truck on a posted
 * road, and it is reached by presenting an absence as a clear.
 */
export async function loadSeasonalContext(
  asOf: IsoDate = todayIso(),
  now: Date = new Date(),
): Promise<SeasonalContext> {
  const snapshots = new Map<string, StateSeasonalSnapshot>();

  let rows: SeasonalRow[] = [];
  let dbUp = true;
  try {
    const result = await withDbRetry(
      () =>
        db().execute(sql`
          select "state", "source_revised_on", "retrieved_on", "rows_json",
                 "verified_clear", "fetch_status", "last_attempt_at", "last_error"
            from "seasonal_restrictions"
        `),
      { label: 'seasonal_restrictions select' },
    );
    rows = (Array.isArray(result) ? result : ((result as { rows?: unknown }).rows ?? [])) as SeasonalRow[];
  } catch (err) {
    dbUp = false;
    console.warn(`[seasonal.store] read failed, falling back to in-memory: ${describeDbError(err)}`);
  }

  for (const row of rows) {
    const snap = snapshotFromRow(row, asOf, now);
    if (snap !== null) snapshots.set(snap.code, snap);
  }

  // The in-memory cache fills gaps in BOTH directions: it covers a state the
  // database could not answer for, and it covers the whole table when the
  // database is down. It never overwrites a fresher stored row.
  for (const [code, cached] of lastGood) {
    const stored = snapshots.get(code);
    if (stored === undefined || stored.retrievedOn === null) snapshots.set(code, cached);
    else if (cached.retrievedOn !== null && cached.retrievedOn > stored.retrievedOn) {
      snapshots.set(code, cached);
    }
  }

  // Every registry state is present, even with nothing stored — an omitted
  // state reads as "not covered", and the two are not the same answer.
  for (const spec of SEASONAL_SOURCES) {
    if (!snapshots.has(spec.code)) {
      const empty = neverSnapshot(spec.code);
      if (empty !== null) snapshots.set(spec.code, empty);
    }
  }

  return dbUp ? { snapshots } : { ...emptySeasonalContext(true), snapshots };
}

/** When each state was last ATTEMPTED, for the scheduler. `{}` if unreadable. */
export async function loadLastAttempts(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const result = await withDbRetry(
      () =>
        db().execute(sql`select "state", "last_attempt_at" from "seasonal_restrictions"`),
      { label: 'seasonal_restrictions attempts' },
    );
    const rows = (Array.isArray(result) ? result : ((result as { rows?: unknown }).rows ?? [])) as Array<{
      state: string;
      last_attempt_at: string | Date | null;
    }>;
    for (const r of rows) {
      const t = r.last_attempt_at === null ? null : new Date(r.last_attempt_at as string).getTime();
      if (t !== null && Number.isFinite(t)) out.set(String(r.state).toUpperCase(), t);
    }
  } catch (err) {
    // A scheduler that cannot read the clock must not conclude "nothing is
    // due" — that would silently stop ingestion for as long as the database is
    // down. It also must not conclude "everything is due", which would hammer
    // a dozen state web servers on every 30-minute tick. The in-process
    // fallback below is the middle: this process remembers what IT attempted.
    console.warn(`[seasonal.store] attempt clock unreadable: ${describeDbError(err)}`);
  }
  for (const [code, t] of inProcessAttempts) {
    const stored = out.get(code);
    if (stored === undefined || t > stored) out.set(code, t);
  }
  return out;
}

/** This process's own record of when it last contacted each state. */
const inProcessAttempts = new Map<string, number>();

export function noteAttempt(code: string, atMs: number = Date.now()): void {
  inProcessAttempts.set(String(code ?? '').toUpperCase(), atMs);
}

/** Test seam. */
export function __resetSeasonalAttemptsForTests(): void {
  inProcessAttempts.clear();
}
