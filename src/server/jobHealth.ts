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
import { describeDbError, withDbRetry } from '../db/retry.js';
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
  /** Holds rows the DB refused, for replay once it is back. See section 3a. */
  outbox: LedgerOutbox;
  /** The DB-independent record of an unpersisted run — stderr by default. */
  logUnrecorded: (line: string) => void;
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
 * Persist a finished run.
 *
 * Retried on transient connection/wake failures only — an append of an
 * already-computed row is idempotent enough that a duplicate ledger line is
 * vastly preferable to a missing one. Anything the classifier does not
 * recognise as transient (a dropped table, a quota rejection) throws straight
 * out on the first attempt, into the outbox path below.
 */
export async function writeJobRun(row: JobRunRow): Promise<void> {
  await withDbRetry(
    () =>
      db().execute(sql`
        insert into "job_runs" ("job", "status", "started_at", "finished_at", "duration_ms", "processed", "detail")
        values (
          ${row.job}, ${row.status}, ${row.startedAt.toISOString()}, ${row.finishedAt.toISOString()},
          ${row.durationMs}, ${row.processed}, ${row.detail}
        )
      `),
    { label: `job_runs insert (${row.job})` },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3a. THE OUTBOX — how "the database was down" becomes recordable
// ─────────────────────────────────────────────────────────────────────────────
//
// THE CONTRADICTION THIS RESOLVES
// ───────────────────────────────
// The ledger's original contract said a write failure "degrades to silence; the
// watchdog turns silence into an alert". That is true for a job that stops
// ticking. It is NOT true for the case that actually happened, because the
// ledger writes to the very database the jobs read from:
//
//   the DB is unreachable
//     → every DB-first cron's opening SELECT throws        → outcome = failure
//     → the ledger's INSERT hits the same dead DB           → swallowed, no row
//     → the alert email needs no Postgres                   → email SENT
//
// So the failure emails and the ledger disagreed by construction: the emails
// said four jobs had failed and the ledger showed an unbroken run of `skipped`
// and `success`, with not one `failure` row in its entire history. Every
// signal that a DB outage exists was routed through the DB. Worse, the next
// tick after recovery writes a healthy row, so the gap closes and the outage
// leaves no trace at all — you cannot even tell afterwards that it happened.
//
// THE FIX, IN TWO PARTS, NEITHER OF WHICH NEEDS POSTGRES
// ─────────────────────────────────────────────────────
//   1. A structured line on stderr, immediately. Replit retains deploy logs, so
//      this is the record that survives even if the process then dies.
//   2. A bounded in-memory outbox. The row is kept and replayed on the next
//      successful write, WITH ITS ORIGINAL TIMESTAMPS — so once the database
//      comes back the ledger contains the failures that happened while it was
//      gone, in their true positions, rather than a silent gap.
//
// The outbox is memory-only on purpose. It must not depend on the database (the
// whole point), and writing to the container filesystem would trade one
// unreliable store for another — Replit's disk is ephemeral across deploys and
// a full disk is its own outage. A process restart therefore loses whatever is
// pending, which is acceptable precisely because it is not the only signal:
// part 1 has already put the record in the logs, the failure email has already
// been sent, and the staleness watchdog still keys on the last HEALTHY run, so
// a job that never recovers goes stale and alerts regardless.

/** Cap on retained rows. ~12 jobs × a few hours of ticks; far past this the
 *  outage is long over and the oldest rows are the least interesting. */
export const LEDGER_OUTBOX_MAX = 250;

/** Rows the ledger could not persist, kept for replay. Bounded and oldest-first. */
export class LedgerOutbox {
  private rows: JobRunRow[] = [];
  private droppedCount = 0;
  private lastError: string | null = null;
  private lastErrorAtMs: number | null = null;

  /** Retain a row the DB refused. Drops the OLDEST first when full — during an
   *  outage the newest rows are the ones that still describe the situation. */
  add(row: JobRunRow, error: string, nowMs: number): void {
    if (this.rows.length >= LEDGER_OUTBOX_MAX) {
      this.rows.shift();
      this.droppedCount++;
    }
    this.rows.push(row);
    this.lastError = error;
    this.lastErrorAtMs = nowMs;
  }

  /** Take everything pending for a replay attempt. */
  drain(): JobRunRow[] {
    const out = this.rows;
    this.rows = [];
    return out;
  }

  /** Put back rows a replay could not write, ahead of anything newer. */
  requeue(rows: JobRunRow[]): void {
    this.rows = [...rows, ...this.rows].slice(-LEDGER_OUTBOX_MAX);
  }

  size(): number {
    return this.rows.length;
  }

  dropped(): number {
    return this.droppedCount;
  }

  /** Why the last write failed — the diagnosis the alert email should carry. */
  lastFailure(): { error: string; atMs: number } | null {
    return this.lastError !== null && this.lastErrorAtMs !== null
      ? { error: this.lastError, atMs: this.lastErrorAtMs }
      : null;
  }

  /** A successful write means the DB is back; the failure note is stale. */
  clearFailure(): void {
    this.lastError = null;
    this.lastErrorAtMs = null;
  }

  /** Test helper. */
  reset(): void {
    this.rows = [];
    this.droppedCount = 0;
    this.clearFailure();
  }
}

/** Process-wide outbox, read by the alert path and /api/admin/job-health. */
export const jobLedgerOutbox = new LedgerOutbox();

/**
 * Replay retained rows. Stops at the first failure and puts the remainder back,
 * so a still-sick database is retried on the next healthy write rather than
 * hammered here. Never throws.
 */
export async function flushLedgerOutbox(deps: JobLedgerDeps): Promise<number> {
  const pending = deps.outbox.drain();
  if (pending.length === 0) return 0;
  let written = 0;
  for (let i = 0; i < pending.length; i++) {
    try {
      await deps.write(pending[i]!);
      written++;
    } catch (err) {
      deps.outbox.requeue(pending.slice(i));
      deps.log(
        `[job-health] ledger replay stopped after ${written}/${pending.length} rows — ` +
          `${describeDbError(err)}`,
      );
      return written;
    }
  }
  deps.log(`[job-health] ledger replay wrote ${written} row(s) held during a DB outage`);
  return written;
}

function defaultLedgerDeps(): JobLedgerDeps {
  return {
    now: () => Date.now(),
    write: writeJobRun,
    log: (msg) => console.log(msg),
    outbox: jobLedgerOutbox,
    logUnrecorded: (line) => console.error(line),
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
    // describeDbError, not err.message: drizzle wraps every driver error in a
    // DrizzleQueryError whose message is `Failed query: <the whole SELECT>` and
    // keeps the real diagnosis on `.cause`. Reporting the raw message is why
    // the 2026-08-31 alerts were a page of column names with no cause in them,
    // and why a dev-branch quota rejection read as a production outage.
    outcome = jobFailure(`threw: ${describeDbError(err)}`);
  }
  const finishedMs = deps.now();
  const row: JobRunRow = {
    job,
    status: outcome.status,
    startedAt: new Date(startedMs),
    finishedAt: new Date(finishedMs),
    durationMs: Math.max(0, finishedMs - startedMs),
    processed: typeof outcome.processed === 'number' ? outcome.processed : null,
    detail: truncateDetail(outcome.detail),
  };
  try {
    await deps.write(row);
    // The DB answered, so anything held during an earlier outage can land now.
    deps.outbox.clearFailure();
    await flushLedgerOutbox(deps);
  } catch (err) {
    // The observer must never break the observed — but it must not vanish
    // either. Record it somewhere that does not need Postgres (stderr), and
    // keep the row for replay. See section 3a.
    const diagnosis = describeDbError(err);
    deps.outbox.add(row, diagnosis, deps.now());
    deps.logUnrecorded(
      `[job-health] LEDGER UNAVAILABLE — run not persisted: ` +
        JSON.stringify({
          job: row.job,
          status: row.status,
          startedAt: row.startedAt.toISOString(),
          durationMs: row.durationMs,
          processed: row.processed,
          detail: row.detail,
          ledgerError: diagnosis,
          heldForReplay: deps.outbox.size(),
        }),
    );
  }
  return outcome;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE ONE CALL A CRON SHOULD MAKE
// ─────────────────────────────────────────────────────────────────────────────

/** De-dupe failure emails per job, sharing cronSafety's cooldown semantics so a
 *  job failing every 10 minutes cannot send 144 emails a day. */
export const jobFailureDeduper = new AlertDeduper();

// ─────────────────────────────────────────────────────────────────────────────
// 3b. THE ALERT THRESHOLD — one self-healing blip is not an outage
// ─────────────────────────────────────────────────────────────────────────────
//
// Shipped as "alert on the first failure", which is correct for a job that
// stays broken and wrong for the far more common case: a single transient
// dependency blip (a Neon connection reset) that the very next tick heals.
// 2026-08-22, `lifecycle-email` failed once at 15:48:57 and succeeded at
// 15:50:55 — nothing was broken, and an email went out anyway. Alert fatigue is
// how a good signal stops being read, so a failure now has to CLEAR A BAR
// before it pages anyone.
//
// The bar is "whichever comes first":
//   (a) FAILURE_ALERT_THRESHOLD consecutive failures with no healthy run in
//       between — a job that retries fast proves itself broken by failing
//       twice; or
//   (b) the streak has stayed unhealthy for SUSTAINED_FAILURE_ALERT_MS — the
//       clause that covers every job whose next retry is NOT imminent (the
//       weekly `fuel-surcharge`, the once-a-day slot jobs like `weekly-digest`
//       / `ops-digest` / `card-expiry-sweep`, and the user-triggered
//       `rfq-blast`, which may never tick a second time). Without it, "two
//       consecutive failures" would silently mean "alert me in 24 hours".
//
// (b) is enforced by a real timer rather than only on the next failure event,
// precisely so a job that never ticks again still surfaces. The window is
// therefore also the WORST-CASE silence for a genuinely broken job: 30 minutes,
// and only ~1 tick (10 min) for the fast crons. Everything else about the
// signal is unchanged and deliberately still first-failure-immediate:
//   - the ledger row is written on the FIRST failure (so /api/admin/job-health
//     and the ops digest's `lastStatus === 'failure'` line show it at once);
//   - the staleness watchdog still keys on the last HEALTHY run, so a job stuck
//     failing every tick goes stale on its own schedule regardless of this;
//   - the 6 h de-dupe cooldown still caps the volume once an alert does fire.
//
// The streak lives in process memory, like AlertDeduper — a restart resets it.
// That is acceptable because the watchdog is the durable backstop: a job that
// never records a healthy run goes stale and alerts on `maxIntervalMs` no
// matter how many times the process bounced.

/** Consecutive failures (no healthy run between) that trip an alert. */
export const FAILURE_ALERT_THRESHOLD = 2;

/** How long one unbroken failure streak may last before it alerts regardless of
 *  how few ticks it managed — the upper bound on silence. */
export const SUSTAINED_FAILURE_ALERT_MS = 30 * 60 * 1000;

export interface FailureStreak {
  /** Consecutive failures, healthy runs reset it to 0 (so this is >= 1). */
  count: number;
  /** When the CURRENT streak started — the sustained-window clock. */
  firstFailedAtMs: number;
}

/** Per-job consecutive-failure streaks. A healthy outcome clears the job's
 *  entry; that is what makes a self-healed blip a non-event. */
export class FailureStreakTracker {
  private readonly streaks = new Map<string, FailureStreak>();

  /** Record a failure and return the resulting (always open) streak. */
  onFailure(job: string, nowMs: number): FailureStreak {
    const prev = this.streaks.get(job);
    const next: FailureStreak = prev
      ? { count: prev.count + 1, firstFailedAtMs: prev.firstFailedAtMs }
      : { count: 1, firstFailedAtMs: nowMs };
    this.streaks.set(job, next);
    return next;
  }

  /** A success/skipped run ends the streak — the job healed itself. */
  onHealthy(job: string): void {
    this.streaks.delete(job);
  }

  /** The open streak, or null when the job is currently healthy. */
  peek(job: string): FailureStreak | null {
    return this.streaks.get(job) ?? null;
  }
}

export const jobFailureStreaks = new FailureStreakTracker();

export interface TrackedJobDeps {
  record: (job: string, fn: () => Promise<JobOutcome> | JobOutcome) => Promise<JobOutcome>;
  sendAlert: (subject: string, body: string) => Promise<void>;
  deduper: AlertDeduper;
  cooldownMs: number;
  now: () => number;
  log: (msg: string) => void;
  /** Consecutive-failure bar — see FAILURE_ALERT_THRESHOLD. */
  streaks: FailureStreakTracker;
  alertAfterFailures: number;
  sustainedMs: number;
  /** Read (not written) here, so the alert can say whether the ledger is down too. */
  outbox: LedgerOutbox;
  /** Arms the sustained-window re-check. Injected so tests drive it without
   *  timers; the default unrefs so it can never hold the process open. */
  schedule: (fn: () => void, ms: number) => void;
}

function defaultTrackedDeps(): TrackedJobDeps {
  return {
    record: (job, fn) => recordJobRun(job, fn),
    sendAlert: sendCronAlertEmail,
    deduper: jobFailureDeduper,
    cooldownMs: CRON_ALERT_COOLDOWN_MS,
    now: () => Date.now(),
    log: (msg) => console.log(msg),
    streaks: jobFailureStreaks,
    alertAfterFailures: FAILURE_ALERT_THRESHOLD,
    sustainedMs: SUSTAINED_FAILURE_ALERT_MS,
    outbox: jobLedgerOutbox,
    schedule: (fn, ms) => {
      const t = setTimeout(fn, ms);
      // Never keep the event loop (or a test runner) alive for an alert re-check.
      if (typeof (t as { unref?: () => void }).unref === 'function') (t as { unref: () => void }).unref();
    },
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
 * outcome (returned OR thrown by `fn`) is ALWAYS recorded to the ledger, but it
 * only emails once the streak clears the threshold in section 3b — a single
 * transient blip that the next tick heals is a ledger row, not a page.
 */
export async function runTrackedJob(
  job: string,
  fn: () => Promise<JobOutcome> | JobOutcome,
  overrides: Partial<TrackedJobDeps> = {},
): Promise<JobOutcome> {
  const deps: TrackedJobDeps = { ...defaultTrackedDeps(), ...overrides };
  const outcome = await deps.record(job, fn);
  if (outcome.status !== 'failure') {
    // Healthy run — the job proved itself, so any open streak is over.
    deps.streaks.onHealthy(job);
    return outcome;
  }

  const detail = outcome.detail ?? 'no detail recorded';
  deps.log(`[job-health] job "${job}" FAILED: ${detail}`);
  const streak = deps.streaks.onFailure(job, deps.now());
  const threshold = Math.max(1, deps.alertAfterFailures);
  const unhealthyForMs = deps.now() - streak.firstFailedAtMs;

  if (streak.count < threshold && unhealthyForMs < deps.sustainedMs) {
    deps.log(
      `[job-health] alert for "${job}" held — failure ${streak.count}/${threshold}, ` +
        `unhealthy ${Math.round(unhealthyForMs / 1000)}s of ${Math.round(deps.sustainedMs / 1000)}s`,
    );
    // Arm the sustained-window re-check ONCE per streak, so a job whose next
    // retry is hours away (or never — rfq-blast) still surfaces on the clock
    // instead of waiting for a second failure event that may not come.
    if (streak.count === 1) {
      const armedFor = streak.firstFailedAtMs;
      deps.schedule(() => {
        const open = deps.streaks.peek(job);
        // Recovered, or this is a stale timer from an already-closed streak.
        if (!open || open.firstFailedAtMs !== armedFor) return;
        void emitJobFailureAlert(job, detail, open, deps);
      }, deps.sustainedMs);
    }
    return outcome;
  }

  await emitJobFailureAlert(job, detail, streak, deps);
  return outcome;
}

/** Send the de-duped failure email for an alerting streak. Never throws. */
async function emitJobFailureAlert(
  job: string,
  detail: string,
  streak: FailureStreak,
  deps: TrackedJobDeps,
): Promise<void> {
  if (!deps.deduper.shouldAlert(`job-failure:${job}`, deps.now(), deps.cooldownMs)) {
    deps.log(`[job-health] alert for "${job}" suppressed — within cooldown`);
    return;
  }
  const unhealthyMin = Math.max(0, Math.round((deps.now() - streak.firstFailedAtMs) / 60000));
  // If the ledger is ALSO down, say so in the email. Without this line the two
  // signals silently contradict each other: the alert reports a failure and
  // /api/admin/job-health shows an unbroken run of healthy rows, because the
  // failure row could not be written to the database that was the problem.
  const ledgerFailure = deps.outbox.lastFailure();
  const ledgerNote = ledgerFailure
    ? `\nLEDGER ALSO UNAVAILABLE — this run is NOT in job_runs.\n` +
      `  Ledger write failed with: ${ledgerFailure.error}\n` +
      `  ${deps.outbox.size()} run(s) are held in memory and will be written when the ` +
      `database is reachable again${deps.outbox.dropped() > 0 ? ` (${deps.outbox.dropped()} older row(s) dropped)` : ''}.\n` +
      `  So /api/admin/job-health will look healthy for this window. It is not — the ` +
      `database itself is the failure.\n`
    : '';
  const body =
    `Scheduled job "${job}" could not complete its work.\n\n` +
    `${detail}\n` +
    `${ledgerNote}\n` +
    `Consecutive failures: ${streak.count} (no healthy run for ${unhealthyMin} min).\n` +
    `First failure in this streak (UTC): ${new Date(streak.firstFailedAtMs).toISOString()}\n` +
    `Time (UTC): ${new Date(deps.now()).toISOString()}\n\n` +
    `A single self-healing failure does NOT send this email — it alerts on ` +
    `${Math.max(1, deps.alertAfterFailures)} consecutive failures or ` +
    `${Math.round(deps.sustainedMs / 60000)} min unhealthy, whichever is first.\n` +
    `Further alerts for this job are suppressed for ` +
    `${Math.round(deps.cooldownMs / 60000)} min to avoid spam.\n` +
    `Full run history: GET /api/admin/job-health (super-admin).`;
  try {
    await deps.sendAlert(`QuoteFleet job failed: ${job}`, body);
  } catch (err) {
    // Alerting must never break the job it is observing.
    deps.log(`[job-health] failure alert for "${job}" threw (swallowed): ${String(err)}`);
  }
}
