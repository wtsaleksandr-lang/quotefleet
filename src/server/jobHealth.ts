/**
 * Durable job-run ledger + staleness watchdog.
 *
 * WHY THIS EXISTS
 * ───────────────
 * QuoteFleet's automation is a set of in-process `setInterval` crons. Before
 * this module the ONLY failure signal was `runCronSafely`, and it is wired at
 * the REGISTRATION boundary in src/server/index.ts:
 *
 *     await runCronSafely('weekly-digest-cron', () => startWeeklyDigestCron());
 *
 * `startWeeklyDigestCron()` only calls `setInterval` and returns. It essentially
 * cannot throw. Every cron then catches its own per-tick error internally and
 * `console.warn`s it (e.g. weeklyDigestCron.ts's `catch { console.warn(...); return; }`).
 * The net effect: **a cron that fails on every single tick forever looks green.**
 * Nothing is emailed, nothing is recorded, and on a Replit deploy nobody is
 * reading stdout.
 *
 * Worse is the failure mode that emits NO event at all:
 *   - a cron never registers (a stray `*_DISABLED=1` in prod env);
 *   - the interval never fires (a weekly `setInterval` in a container that
 *     restarts daily — see src/eia/dieselPrice.ts's `setInterval(..., WEEK_MS)`);
 *   - work is kicked off detached and its failure lands in a `.catch(log)` while
 *     the caller already returned "started" and was recorded as a success.
 * No exception is ever thrown, so no amount of try/catch alerting can see it.
 * **Absence of a signal is the defect, and only a watchdog that expects a signal
 * can detect it.**
 *
 * THE TWO HALVES
 * ──────────────
 * 1. `recordJobRun(job, fn)` — persists one row per tick to `job_runs`: when it
 *    started, how long it took, and the outcome. It is the heartbeat.
 * 2. `runJobHealthWatchdogOnce()` — reads the ledger and alerts on any job whose
 *    last HEALTHY run is older than that job's declared `maxIntervalMs`. This is
 *    the piece that turns silence into an alert.
 *
 * THE OUTCOME MODEL (the anti-"canned success" rule)
 * ──────────────────────────────────────────────────
 * A tick reports one of three outcomes, and the distinction is the whole point:
 *
 *   success — the job did its work. `processed` is the true count.
 *   skipped — the job ticked and correctly decided there was nothing to do
 *             (wrong day for a weekly slot, no eligible rows). This is HEALTHY:
 *             it proves the scheduler is alive, which is exactly what the
 *             watchdog needs to see from a job whose real work is weekly.
 *   failure — the job COULD NOT do its work: its input failed, a dependency was
 *             unreachable, a key was missing.
 *
 * `failure` exists so that a job which cannot see its data never reports a
 * zero-result success. `jobSuccess(0)` is legal ONLY when zero is the true,
 * verified answer ("no tenants were due"). It is NEVER the right way to report
 * "the upstream fetch failed so I found nothing" — that is `jobFailure`.
 * Because the watchdog keys on the last *healthy* run, a job stuck returning
 * `failure` goes stale and alerts even though it is faithfully ticking.
 *
 * COST: one small table, ~300 rows/day across all jobs, pruned to 30 days
 * (~9k rows steady-state). No new service, no third-party call. $0.
 */
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { runSelfHealStatements } from '../db/migrate.js';
import { AlertDeduper, sendCronAlertEmail, CRON_ALERT_COOLDOWN_MS } from './cronSafety.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1. STORAGE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The ledger table, created by self-heal ONLY.
 *
 * Deliberately NOT in src/db/schema.ts and NOT in drizzle/: Replit's deploy
 * skips db:migrate and its publish tool has repeatedly proposed DROPping tables
 * the ORM does not know about. Every at-risk object in this codebase is
 * re-asserted on each boot instead (see ensureSelfHealTables in db/migrate.ts).
 * This table follows that same rule so a phantom drop self-repairs.
 *
 * Statement shapes are exactly the three `selfHealTarget()` recognizes
 * (`CREATE TABLE IF NOT EXISTS "t"`, `CREATE INDEX IF NOT EXISTS "i"`), so the
 * catalog pre-check makes the healthy-boot case a lock-free no-op. Never call
 * sql.unsafe() with these directly — always via runSelfHealStatements, which
 * sets lock_timeout + statement_timeout first.
 */
export const JOB_RUNS_SELF_HEAL_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS "job_runs" (
     "id" bigserial PRIMARY KEY,
     "job" text NOT NULL,
     "status" text NOT NULL,
     "started_at" timestamptz NOT NULL DEFAULT now(),
     "finished_at" timestamptz,
     "duration_ms" integer,
     "processed" integer,
     "detail" text
   )`,
  // The watchdog's only query is "latest healthy run per job", and the pruner's
  // is a range delete on started_at. This index serves both.
  `CREATE INDEX IF NOT EXISTS "job_runs_job_started_idx" ON "job_runs" ("job", "started_at" DESC)`,
];

/** Boot hook. Non-blocking + never throws at the call site (see server/index.ts). */
export async function ensureJobRunsTable(): Promise<void> {
  await runSelfHealStatements('job_runs ledger', JOB_RUNS_SELF_HEAL_STATEMENTS);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE OUTCOME MODEL
// ─────────────────────────────────────────────────────────────────────────────

/** `success` and `skipped` are both HEALTHY (they reset the staleness clock);
 *  `failure` is not. See the header for when each is correct. */
export type JobStatus = 'success' | 'skipped' | 'failure';

export interface JobOutcome {
  status: JobStatus;
  /** Items actually handled. Omit for `skipped`/`failure`. */
  processed?: number;
  /** Short human-readable note. Required for skipped/failure so the ledger
   *  explains itself without a code read. Truncated to DETAIL_MAX_CHARS. */
  detail?: string;
}

/** The job did its work. Pass the TRUE count — see the header's rule about
 *  never reporting a zero-result success for a failed input. */
export function jobSuccess(processed: number, detail?: string): JobOutcome {
  return { status: 'success', processed, detail };
}

/** The job ticked and there was legitimately nothing to do. Healthy — it proves
 *  the scheduler is alive, which is what a weekly-slot job's watchdog needs. */
export function jobSkipped(detail: string): JobOutcome {
  return { status: 'skipped', detail };
}

/** The job COULD NOT do its work (input failed, dependency down, key missing).
 *  Never report this case as a success with 0 items. */
export function jobFailure(detail: string): JobOutcome {
  return { status: 'failure', detail };
}

/**
 * What a cron's internal pass reports back to its scheduling site.
 *
 * The existing crons all share one shape: a `try { ...work... } catch (err) {
 * console.warn(...); return; }` pass whose caller cannot tell a clean tick from
 * a swallowed exception, because both produce `undefined`. Returning this
 * instead lets the scheduling site — where runTrackedJob lives — record the
 * truth, WITHOUT moving the ledger inside the heavily unit-tested pass itself.
 */
export interface TickResult {
  /** False when the pass caught an error. THIS is the bit that used to be lost. */
  ok: boolean;
  /** Items actually handled (emails sent, rows written). */
  processed: number;
  /** Error message when !ok; an optional note otherwise. */
  detail?: string;
}

/**
 * Convert a pass's TickResult into a ledger outcome.
 *
 * `idleDetail` describes the legitimate zero case ("no tenants due"), which is
 * `skipped` — healthy, and the heartbeat the staleness watchdog needs. A failed
 * pass is NEVER reported as an idle one, however many items it processed.
 */
export function outcomeFromTick(r: TickResult, idleDetail: string): JobOutcome {
  if (!r.ok) return jobFailure(r.detail ?? 'tick failed with no detail');
  if (r.processed > 0) return jobSuccess(r.processed, r.detail);
  return jobSkipped(r.detail ?? idleDetail);
}

/** Ledger `detail` is diagnostic, not an archive — keep rows small. */
export const DETAIL_MAX_CHARS = 500;

export function truncateDetail(detail: string | undefined): string | null {
  if (!detail) return null;
  const s = detail.trim();
  if (!s) return null;
  return s.length <= DETAIL_MAX_CHARS ? s : `${s.slice(0, DETAIL_MAX_CHARS - 1)}…`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. RECORDING A RUN
// ─────────────────────────────────────────────────────────────────────────────

/** Injectable seams so recordJobRun is unit-testable with no DB and no clock. */
export interface JobLedgerDeps {
  now: () => number;
  /** Persist one finished run. Must never throw back into the caller. */
  write: (row: JobRunRow) => Promise<void>;
  log: (msg: string) => void;
}

export interface JobRunRow {
  job: string;
  status: JobStatus;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  processed: number | null;
  detail: string | null;
}

/**
 * Persist a finished run. Best-effort by contract: a ledger write failure must
 * never break the job it is observing, so this swallows and logs.
 *
 * Note the deliberate asymmetry — if the DB is down this write fails silently,
 * which is exactly the case the WATCHDOG then catches as staleness. The ledger
 * degrades to silence; the watchdog turns silence into an alert.
 */
export async function writeJobRun(row: JobRunRow): Promise<void> {
  await db().execute(sql`
    insert into "job_runs" ("job", "status", "started_at", "finished_at", "duration_ms", "processed", "detail")
    values (
      ${row.job}, ${row.status}, ${row.startedAt.toISOString()}, ${row.finishedAt.toISOString()},
      ${row.durationMs}, ${row.processed}, ${row.detail}
    )
  `);
}

function defaultLedgerDeps(): JobLedgerDeps {
  return {
    now: () => Date.now(),
    write: writeJobRun,
    log: (msg) => console.log(msg),
  };
}

/**
 * Run one job tick and record its outcome to the ledger.
 *
 * - `fn` returning a JobOutcome records that outcome verbatim.
 * - `fn` THROWING is caught, recorded as `failure` with the error message, and
 *   NOT rethrown — the surrounding setInterval must keep ticking.
 * - A ledger write failure is swallowed (logged only); it can never take down
 *   the job it observes.
 *
 * Returns the recorded outcome so callers can chain (e.g. surface it to
 * runCronSafely, which owns the *email* alerting; this owns the *durable
 * record*. They are complementary: alerting tells you now, the ledger proves
 * what happened and lets the watchdog notice nothing happened at all).
 */
export async function recordJobRun(
  job: string,
  fn: () => Promise<JobOutcome> | JobOutcome,
  overrides: Partial<JobLedgerDeps> = {},
): Promise<JobOutcome> {
  const deps: JobLedgerDeps = { ...defaultLedgerDeps(), ...overrides };
  const startedMs = deps.now();
  let outcome: JobOutcome;
  try {
    outcome = await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    outcome = jobFailure(`threw: ${message}`);
  }
  const finishedMs = deps.now();
  try {
    await deps.write({
      job,
      status: outcome.status,
      startedAt: new Date(startedMs),
      finishedAt: new Date(finishedMs),
      durationMs: Math.max(0, finishedMs - startedMs),
      processed: typeof outcome.processed === 'number' ? outcome.processed : null,
      detail: truncateDetail(outcome.detail),
    });
  } catch (err) {
    // The observer must never break the observed.
    deps.log(`[job-health] ledger write failed for "${job}" (swallowed): ${String(err)}`);
  }
  return outcome;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE ONE CALL A CRON SHOULD MAKE
// ─────────────────────────────────────────────────────────────────────────────

/** De-dupe failure emails per job, sharing cronSafety's cooldown semantics so a
 *  job failing every 10 minutes cannot send 144 emails a day. */
export const jobFailureDeduper = new AlertDeduper();

export interface TrackedJobDeps {
  record: (job: string, fn: () => Promise<JobOutcome> | JobOutcome) => Promise<JobOutcome>;
  sendAlert: (subject: string, body: string) => Promise<void>;
  deduper: AlertDeduper;
  cooldownMs: number;
  now: () => number;
  log: (msg: string) => void;
}

function defaultTrackedDeps(): TrackedJobDeps {
  return {
    record: (job, fn) => recordJobRun(job, fn),
    sendAlert: sendCronAlertEmail,
    deduper: jobFailureDeduper,
    cooldownMs: CRON_ALERT_COOLDOWN_MS,
    now: () => Date.now(),
    log: (msg) => console.log(msg),
  };
}

/**
 * Run one cron tick with BOTH failure signals wired: a durable ledger row and a
 * de-duped admin email.
 *
 * This is the single call a cron tick should make. The two halves answer
 * different questions and neither is sufficient alone:
 *
 *   the email  → "something is broken RIGHT NOW" (push; can be missed/unset)
 *   the ledger → "what has actually been happening" (pull; and it is what the
 *                staleness watchdog reads to notice a job that stopped
 *                producing any signal at all)
 *
 * Never throws — the surrounding setInterval must keep ticking. A `failure`
 * outcome (returned OR thrown by `fn`) triggers the alert; `success` and
 * `skipped` do not.
 */
export async function runTrackedJob(
  job: string,
  fn: () => Promise<JobOutcome> | JobOutcome,
  overrides: Partial<TrackedJobDeps> = {},
): Promise<JobOutcome> {
  const deps: TrackedJobDeps = { ...defaultTrackedDeps(), ...overrides };
  const outcome = await deps.record(job, fn);
  if (outcome.status !== 'failure') return outcome;

  const detail = outcome.detail ?? 'no detail recorded';
  deps.log(`[job-health] job "${job}" FAILED: ${detail}`);
  if (!deps.deduper.shouldAlert(`job-failure:${job}`, deps.now(), deps.cooldownMs)) {
    deps.log(`[job-health] alert for "${job}" suppressed — within cooldown`);
    return outcome;
  }
  const body =
    `Scheduled job "${job}" could not complete its work.\n\n` +
    `${detail}\n\n` +
    `Time (UTC): ${new Date(deps.now()).toISOString()}\n\n` +
    `Further alerts for this job are suppressed for ` +
    `${Math.round(deps.cooldownMs / 60000)} min to avoid spam.\n` +
    `Full run history: GET /api/admin/job-health (super-admin).`;
  try {
    await deps.sendAlert(`QuoteFleet job failed: ${job}`, body);
  } catch (err) {
    // Alerting must never break the job it is observing.
    deps.log(`[job-health] failure alert for "${job}" threw (swallowed): ${String(err)}`);
  }
  return outcome;
}
