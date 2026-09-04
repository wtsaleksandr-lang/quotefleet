/**
 * One scheduling primitive for every in-process cron, and the offset table that
 * keeps them out of each other's way.
 *
 * THE BUG THIS FIXES
 * ──────────────────
 * Every cron used to schedule itself with the same two lines:
 *
 *     setTimeout(() => void run('startup'), STARTUP_DELAY_MS);   // staggered
 *     setInterval(() => void run('tick'), TICK_MS);              // NOT staggered
 *
 * The `STARTUP_DELAY_MS` values were all different (30s, 45s, 60s, 90s …), so
 * this LOOKS staggered. It is not. `setInterval` starts counting the moment it
 * is called, and all twelve crons are registered inside the same boot tick of
 * server/index.ts — so from the first hour onward every hourly job fires at the
 * identical instant, forever. The startup delay offsets the first run only, and
 * nine of the twelve jobs share `TICK_MS = 3_600_000`.
 *
 * The production ledger shows it exactly. At 2026-08-31T17:40:55Z, eleven jobs
 * started inside a 141-millisecond window:
 *
 *     17:40:55.556  marketplace-aggregates
 *     17:40:55.560  followup-email
 *     17:40:55.561  dunning-email
 *     17:40:55.562  weekly-digest, manifest-renewal, directory-aggregate-refresh
 *     17:40:55.563  ops-digest, job-health-watchdog
 *     17:40:55.564  lifecycle-email
 *     17:40:55.624  directory-sitemap-refresh
 *     17:40:55.701  directory-reingest
 *
 * and again at 16:40:55, and every hour before that. Twelve simultaneous
 * connection checkouts against a serverless Postgres that may be asleep is a
 * self-inflicted thundering herd: it is the worst possible moment to ask a cold
 * compute for a connection, and if the pool (max: 10) is short, some of those
 * jobs are queueing behind the others for no reason at all.
 *
 * THE FIX
 * ───────
 * `startCronSchedule` starts the repeating interval INSIDE the first delayed
 * run, so the interval's phase inherits the offset instead of resetting to
 * boot. The offset then holds for every subsequent tick, permanently.
 *
 * The offsets live in one table below rather than in twelve separate files,
 * because "are these actually distinct?" is a question you cannot answer by
 * reading one file — and the answer used to be no: three crons shared 90s and
 * three more shared 120s. A unit test asserts the table stays collision-free.
 *
 * They are fixed constants, not hashes and not random. A deterministic offset
 * means a job's phase is reproducible across restarts and readable from the
 * source, so "why did this run at :07 past?" always has an answer.
 */

/**
 * Seconds after boot at which each cron takes its first run — and, from then
 * on, its permanent phase within its own tick period.
 *
 * Spaced `MIN_CRON_SPACING_MS` apart in registration order. The widest is under
 * eleven minutes, so even the hourly jobs keep their existing hour-slot behaviour
 * (a job that only acts during the 13:00 UTC hour still gets its tick inside
 * that hour); the fastest cron's period is 10 minutes, and no offset is allowed
 * to approach it (see the test).
 *
 * Keys are the CRON's scheduling identity. A cron may write several differently
 * named rows to the job ledger — `directory-refresh` alone records
 * directory-reingest, directory-sitemap-refresh and directory-aggregate-refresh
 * — so these names are not always the ledger's job names.
 */
export const CRON_STAGGER_MS: Readonly<Record<string, number>> = {
  'marketplace-aggregates': 30_000,
  'fuel-surcharge': 75_000,
  'lifecycle-email': 120_000,
  'followup-email': 165_000,
  'weekly-digest': 210_000,
  'rfq-response': 255_000,
  'dunning-email': 300_000,
  'manifest-renewal': 345_000,
  'directory-refresh': 390_000,
  'ops-digest': 435_000,
  'card-expiry': 480_000,
  'job-health-watchdog': 525_000,
  'seasonal-restrictions': 570_000,
};

/** Minimum gap the offset table must keep between any two crons. Job runs are
 *  milliseconds-to-seconds long (prod max ever recorded: 1.1s), so 45s is a
 *  wide margin — the point is that no two ever land together. */
export const MIN_CRON_SPACING_MS = 45_000;

/** Fallback for a cron missing from the table — deliberately late and loud, so
 *  a new cron still runs but the omission is visible in the boot log rather
 *  than silently colliding with an existing offset. */
export const UNREGISTERED_CRON_OFFSET_MS = 615_000;

export function cronStaggerMs(cron: string, log: (msg: string) => void = console.warn): number {
  const offset = CRON_STAGGER_MS[cron];
  if (typeof offset === 'number') return offset;
  log(
    `[cron-schedule] "${cron}" has no entry in CRON_STAGGER_MS — using the ` +
      `${UNREGISTERED_CRON_OFFSET_MS / 1000}s fallback. Add it to the table so its ` +
      `phase is deliberate and collision-free.`,
  );
  return UNREGISTERED_CRON_OFFSET_MS;
}

/** Injectable timers so the scheduling behaviour is unit-testable without waiting. */
export interface CronScheduleDeps {
  setTimeout: (fn: () => void, ms: number) => unknown;
  setInterval: (fn: () => void, ms: number) => unknown;
  log: (msg: string) => void;
}

function defaultDeps(): CronScheduleDeps {
  return {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    setInterval: (fn, ms) => setInterval(fn, ms),
    log: (msg) => console.log(msg),
  };
}

export interface CronScheduleOptions {
  /** Scheduling identity — must be a key of CRON_STAGGER_MS. */
  cron: string;
  /** Repeat period. */
  tickMs: number;
  /** One run. `reason` is 'startup' for the first, 'tick' thereafter. It must
   *  handle its own errors; nothing here rethrows into the timer. */
  run: (reason: string) => void | Promise<void>;
  deps?: Partial<CronScheduleDeps>;
}

/**
 * Schedule a cron on its staggered phase.
 *
 * The repeating interval is armed only once the first delayed run has been
 * kicked off, which is the whole point: the interval then repeats on
 * `offset + n * tickMs` instead of on `n * tickMs`, and the stagger survives
 * past the first hour.
 */
export function startCronSchedule({ cron, tickMs, run, deps }: CronScheduleOptions): void {
  const d: CronScheduleDeps = { ...defaultDeps(), ...deps };
  const offset = cronStaggerMs(cron, d.log);
  d.setTimeout(() => {
    // Arm the repeat FIRST so a throw from the startup run can never leave the
    // cron un-scheduled for the rest of the process's life. `run` is expected
    // to swallow its own errors (runTrackedJob does), but a cron that silently
    // stops repeating is the exact failure the job ledger exists to catch, and
    // it should not be reachable from here at all.
    d.setInterval(() => void run('tick'), tickMs);
    void run('startup');
  }, offset);
  d.log(
    `[cron-schedule] "${cron}" scheduled — first run in ${Math.round(offset / 1000)}s, ` +
      `then every ${Math.round(tickMs / 60_000)} min on that offset`,
  );
}
