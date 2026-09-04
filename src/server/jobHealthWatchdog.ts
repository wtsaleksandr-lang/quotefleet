/**
 * Job staleness watchdog — the absence-of-signal detector.
 *
 * WHAT THIS CATCHES THAT try/catch CANNOT
 * ───────────────────────────────────────
 * `runCronSafely` (cronSafety.ts) alerts when a job THROWS. `recordJobRun`
 * (jobHealth.ts) records what a job DID. Neither can see the failures that
 * produce no event at all:
 *
 *   • a cron that never registered (a stray `LIFECYCLE_EMAIL_DISABLED=1` left in
 *     the prod environment — none of these seven flags appear in .env.example,
 *     so a typo'd or leftover flag is invisible);
 *   • an interval that never fires (src/eia/dieselPrice.ts schedules its repeat
 *     with `setInterval(..., WEEK_MS)`; a container that restarts every day
 *     never reaches the 7-day mark, so the repeat is effectively dead and only
 *     the startup run ever happens);
 *   • work kicked off detached whose failure lands in a `.catch(log)` while the
 *     caller already returned "started" and was recorded green;
 *   • the database being unreachable, so the ledger write itself silently fails.
 *
 * In every one of those cases nothing throws, so no amount of try/catch alerting
 * helps. The only way to detect them is to declare what SHOULD happen and notice
 * when it stops. That is this file: a registry of expectations, checked hourly
 * against the durable ledger.
 *
 * WHY `skipped` COUNTS AS HEALTHY
 * ───────────────────────────────
 * Several jobs tick hourly but only do work in a narrow slot (weekly-digest =
 * Mon 14:00 UTC; directory re-ingest = Sun 09:00 UTC). If only `success` reset
 * the staleness clock, those jobs would look stale for six days out of seven.
 * Recording the no-op tick as `skipped` gives every one of them an hourly
 * heartbeat, which converts a weak weekly signal into a strong hourly one —
 * `maxIntervalMs` can then be tight for almost every job.
 *
 * COST: one hourly query (an index-only scan of a ~9k-row table) plus a daily
 * prune. No new service, no third-party call. $0.
 */
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { AlertDeduper, sendCronAlertEmail, CRON_ALERT_COOLDOWN_MS } from './cronSafety.js';
import { jobSkipped, jobSuccess, type JobOutcome } from './jobHealth.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE REGISTRY — what SHOULD be happening
// ─────────────────────────────────────────────────────────────────────────────

export interface JobExpectation {
  /** Ledger key. MUST match the name passed to recordJobRun for this job. */
  job: string;
  /**
   * Longest tolerable gap between HEALTHY runs (success or skipped) before the
   * job is considered stale. Set to roughly 3× the tick cadence so one missed
   * tick plus a redeploy is absorbed without a false alarm.
   */
  maxIntervalMs: number;
  /** Env var that disables this job. A disabled job is reported, never alerted. */
  disabledEnv?: string;
  /** What actually breaks while this job is dead. Goes verbatim into the alert
   *  so whoever reads it can judge urgency without opening the code. */
  impact: string;
}

/**
 * Every scheduled unit of work in the app, with its expected cadence.
 *
 * FOR FUTURE AGENTS: adding a cron means adding an entry here as well as the
 * `runCronSafely` line in server/index.ts. A job that records to the ledger but
 * is missing from this registry is never checked for staleness — it can die
 * silently, which is the exact failure this module exists to prevent. The unit
 * test `everyLedgerJobIsRegistered` pins the two lists together.
 */
export const JOB_REGISTRY: readonly JobExpectation[] = [
  {
    job: 'marketplace-aggregates',
    maxIntervalMs: 3 * HOUR, // hourly tick
    disabledEnv: 'AGGREGATES_CRON_DISABLED',
    impact: 'Marketplace rate aggregates stop refreshing; the public rate pages serve frozen numbers.',
  },
  {
    job: 'lifecycle-email',
    maxIntervalMs: 1 * HOUR, // 10-minute tick
    disabledEnv: 'LIFECYCLE_EMAIL_DISABLED',
    impact: 'Trial lifecycle emails (welcome, day-7/11/14, expiry) stop sending. Trials expire with no nudge — direct revenue loss.',
  },
  {
    job: 'followup-email',
    maxIntervalMs: 3 * HOUR, // hourly tick
    disabledEnv: 'FOLLOWUP_EMAIL_DISABLED',
    impact: 'Lead follow-up sequences stop. Captured leads go un-chased — direct revenue loss for tenants.',
  },
  {
    job: 'dunning-email',
    maxIntervalMs: 3 * HOUR, // hourly tick
    disabledEnv: 'DUNNING_EMAIL_DISABLED',
    impact: 'Failed-payment recovery emails stop. Past-due subscriptions churn instead of recovering — direct revenue loss.',
  },
  {
    job: 'weekly-digest',
    maxIntervalMs: 3 * HOUR, // hourly tick, weekly work slot
    disabledEnv: 'WEEKLY_DIGEST_DISABLED',
    impact: 'Tenants stop receiving their weekly performance recap (retention touch).',
  },
  {
    job: 'manifest-renewal',
    maxIntervalMs: 3 * HOUR, // hourly tick, daily work slot
    disabledEnv: 'MANIFEST_RENEWAL_DISABLED',
    impact: 'CBP manifest-confidentiality renewal reminders stop. A lapsed filing silently re-exposes a paying customer\'s shipment data — the worst failure in the product.',
  },
  {
    job: 'fuel-surcharge',
    // The only genuinely low-frequency job: it repeats on a 7-day setInterval
    // and also runs ~45s after every boot. 9 days tolerates one full missed
    // period on a long-lived container.
    maxIntervalMs: 9 * DAY,
    disabledEnv: 'FUEL_CRON_DISABLED',
    impact: 'Diesel price stops refreshing; every auto-FSC tenant quotes off a frozen (or hardcoded default) fuel surcharge.',
  },
  {
    job: 'directory-aggregate-refresh',
    maxIntervalMs: 3 * HOUR, // hourly tick
    disabledEnv: 'DISABLE_WEEKLY_REINGEST',
    impact: 'directory_aggregate_cache goes stale/absent — the precomputed counts behind the public directory. Its absence previously caused a full-table-scan outage.',
  },
  {
    job: 'directory-sitemap-refresh',
    maxIntervalMs: 3 * HOUR, // hourly tick
    disabledEnv: 'DISABLE_WEEKLY_REINGEST',
    impact: 'The materialized sitemap stops rebuilding; ~330k carrier URLs go stale and new carriers are never announced.',
  },
  {
    job: 'directory-reingest',
    maxIntervalMs: 3 * HOUR, // hourly tick, weekly (Sun 09:00 UTC) work slot
    disabledEnv: 'DISABLE_WEEKLY_REINGEST',
    impact: 'The ~330k-row FMCSA carrier directory stops refreshing; out-of-service and revoked-authority carriers are shown as active.',
  },
  {
    job: 'ops-digest',
    maxIntervalMs: 3 * HOUR, // hourly tick, daily 13:00 UTC send slot
    disabledEnv: 'OPS_DIGEST_DISABLED',
    impact: 'The daily admin action queue stops arriving — CBP filings awaiting submission, LAPSED filings, and past-due tenants go back to being things someone has to remember to look for.',
  },
  {
    job: 'card-expiry-sweep',
    maxIntervalMs: 3 * HOUR, // hourly tick, daily 12:00 UTC sweep slot
    disabledEnv: 'CARD_EXPIRY_DISABLED',
    impact:
      "Expiring cards stop being detected. There is no Stripe webhook for an expiring PaymentMethod, so this sweep is the ONLY warning before a renewal fails — without it every card expiry becomes a past-due tenant first, and dunning is the fallback instead of the safety net.",
  },
  {
    job: 'rfq-response-digest',
    maxIntervalMs: 3 * HOUR, // hourly tick
    disabledEnv: 'RFQ_RESPONSE_DISABLED',
    impact:
      'Shippers stop being told that carriers replied to their rate request — a time-sensitive quote sits unseen behind a link nobody re-opens. Blasts that got zero replies also stop being flagged, so a broken carrier set looks like a quiet week.',
  },
  {
    job: 'seasonal-restrictions',
    maxIntervalMs: 3 * HOUR, // 30-minute tick; an idle tick records `skipped`, which is healthy
    disabledEnv: 'SEASONAL_RESTRICTIONS_DISABLED',
    impact:
      'Spring-thaw (frost law) weight restrictions stop being refreshed from the state DOTs. The stored snapshots age, and every OS/OW quote through a restricting state falls back to a staleness warning instead of a current one. Dangerous specifically in February-May, when a missed posting is a load quoted as legal on a road that is posted.',
  },
  {
    job: 'job-health-watchdog',
    maxIntervalMs: 3 * HOUR, // hourly tick — this module itself
    impact: 'The staleness watchdog itself is dead, so no other job failure will be reported. Check the process is alive.',
  },
];

/**
 * Jobs that record to the ledger but are deliberately ABSENT from the registry
 * above, with the reason. Kept as a list so "why isn't rfq-blast checked?" has
 * an answer in the code rather than in a reviewer's memory.
 *
 * `rfq-blast` is user-triggered: it runs when a shipper sends a rate request and
 * at no other time, so "no run in three hours" is a quiet Tuesday, not a fault.
 * The watchdog checks CADENCE, and this job has none. Its FAILURES still alert —
 * runTrackedJob owns that — and every run is still in the ledger.
 */
export const UNSCHEDULED_LEDGER_JOBS: readonly string[] = ['rfq-blast'];

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE STALENESS DECISION (pure)
// ─────────────────────────────────────────────────────────────────────────────

export interface JobHealthRow {
  job: string;
  /** Most recent run of ANY status, or null if the job has never recorded one. */
  lastRunAt: Date | null;
  /** Most recent `success` or `skipped`, or null. This drives staleness. */
  lastHealthyAt: Date | null;
  /** Status of the most recent run — surfaces "ticking but always failing". */
  lastStatus: string | null;
  lastDetail: string | null;
}

export type JobHealthVerdict = 'ok' | 'stale' | 'disabled';

export interface JobHealthReport {
  job: string;
  verdict: JobHealthVerdict;
  lastHealthyAt: Date | null;
  lastStatus: string | null;
  lastDetail: string | null;
  maxIntervalMs: number;
  impact: string;
}

/**
 * Classify every registered job. PURE — no clock, no DB, no env access of its
 * own; everything is passed in, so the whole decision is unit-testable.
 *
 * Rules:
 *   • A job whose `disabledEnv` is set to '1' is `disabled` — reported so a
 *     leftover kill-switch in prod is VISIBLE, but never alerted on (turning it
 *     off was presumably deliberate).
 *   • A job that has NEVER recorded a healthy run measures its age from
 *     `processStartedAt`, not from epoch. That is what stops a first-ever deploy
 *     from alerting on all eleven jobs at once: the clock starts at boot, and
 *     the job only goes stale if it fails to check in within its own interval.
 *     It also means a job that never registers at all IS caught, once uptime
 *     passes its interval.
 *   • Otherwise stale iff `now - lastHealthyAt > maxIntervalMs`.
 */
export function classifyJobs(
  registry: readonly JobExpectation[],
  health: ReadonlyMap<string, JobHealthRow>,
  now: Date,
  processStartedAt: Date,
  env: Record<string, string | undefined>,
): JobHealthReport[] {
  return registry.map((exp) => {
    const row = health.get(exp.job) ?? null;
    const lastHealthyAt = row?.lastHealthyAt ?? null;
    const base: Omit<JobHealthReport, 'verdict'> = {
      job: exp.job,
      lastHealthyAt,
      lastStatus: row?.lastStatus ?? null,
      lastDetail: row?.lastDetail ?? null,
      maxIntervalMs: exp.maxIntervalMs,
      impact: exp.impact,
    };
    if (exp.disabledEnv && env[exp.disabledEnv] === '1') {
      return { ...base, verdict: 'disabled' };
    }
    // Never checked in → measure from boot, so a fresh deploy gets a full
    // interval of grace and a job that never registers is still caught.
    const since = lastHealthyAt ?? processStartedAt;
    const ageMs = now.getTime() - since.getTime();
    return { ...base, verdict: ageMs > exp.maxIntervalMs ? 'stale' : 'ok' };
  });
}

/** Human-readable duration for the alert body. */
export function formatAge(ms: number): string {
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MINUTE))} min`;
  if (ms < DAY) return `${(ms / HOUR).toFixed(1)} h`;
  return `${(ms / DAY).toFixed(1)} d`;
}

/**
 * Compose the alert body for a set of stale jobs. PURE. One email listing every
 * stale job beats one email per job — the reader wants the whole picture, and a
 * broad outage (DB down) would otherwise fan out into eleven separate alerts.
 */
export function buildStaleAlertBody(
  stale: readonly JobHealthReport[],
  now: Date,
  processStartedAt: Date,
): string {
  const lines: string[] = [
    `${stale.length} QuoteFleet background job(s) have not completed a healthy run within their expected interval.`,
    '',
    `Checked at (UTC): ${now.toISOString()}`,
    `Process started (UTC): ${processStartedAt.toISOString()}`,
    '',
  ];
  for (const r of stale) {
    const since = r.lastHealthyAt ?? processStartedAt;
    const age = now.getTime() - since.getTime();
    lines.push(`── ${r.job}`);
    lines.push(
      r.lastHealthyAt
        ? `   last healthy run: ${r.lastHealthyAt.toISOString()} (${formatAge(age)} ago)`
        : `   last healthy run: NEVER since this process started ${formatAge(age)} ago`,
    );
    lines.push(`   expected at least every: ${formatAge(r.maxIntervalMs)}`);
    if (r.lastStatus) {
      lines.push(`   most recent run status: ${r.lastStatus}${r.lastDetail ? ` — ${r.lastDetail}` : ''}`);
    }
    lines.push(`   impact: ${r.impact}`);
    lines.push('');
  }
  lines.push(
    'A job is "healthy" when it either did its work or ticked and correctly found nothing to do. ' +
      'A job listed here is either throwing, unable to reach its data source, or not running at all ' +
      '(check for a leftover *_DISABLED=1 env var).',
  );
  lines.push('');
  lines.push('Full history: GET /api/admin/job-health (super-admin).');
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. READING THE LEDGER
// ─────────────────────────────────────────────────────────────────────────────

interface RawHealthRow {
  job: string;
  last_run_at: string | Date | null;
  last_healthy_at: string | Date | null;
  last_status: string | null;
  last_detail: string | null;
}

function toDate(v: string | Date | null): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * One row per job: its latest run, and its latest HEALTHY run.
 *
 * DISTINCT ON is the cheap way to get "latest row per group" in Postgres and
 * rides the (job, started_at DESC) index directly.
 */
export async function readJobHealth(): Promise<Map<string, JobHealthRow>> {
  const rows = (await db().execute(sql`
    with latest as (
      select distinct on ("job") "job", "started_at", "status", "detail"
        from "job_runs"
       order by "job", "started_at" desc
    ),
    latest_healthy as (
      select distinct on ("job") "job", "started_at"
        from "job_runs"
       where "status" in ('success', 'skipped')
       order by "job", "started_at" desc
    )
    select l."job"                 as "job",
           l."started_at"          as "last_run_at",
           lh."started_at"         as "last_healthy_at",
           l."status"              as "last_status",
           l."detail"              as "last_detail"
      from latest l
      left join latest_healthy lh on lh."job" = l."job"
  `)) as unknown as RawHealthRow[];

  const out = new Map<string, JobHealthRow>();
  for (const r of rows) {
    out.set(r.job, {
      job: r.job,
      lastRunAt: toDate(r.last_run_at),
      lastHealthyAt: toDate(r.last_healthy_at),
      lastStatus: r.last_status,
      lastDetail: r.last_detail,
    });
  }
  return out;
}

/** Ledger retention. Diagnostic value decays fast; 30 days is ample for "did
 *  this job run last week?" and keeps the table at ~9k rows. */
export const LEDGER_RETENTION_DAYS = 30;

export async function pruneJobRuns(): Promise<number> {
  const rows = (await db().execute(sql`
    delete from "job_runs"
     where "started_at" < now() - ${`${LEDGER_RETENTION_DAYS} days`}::interval
    returning "id"
  `)) as unknown as { id: string }[];
  return rows.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE WATCHDOG PASS
// ─────────────────────────────────────────────────────────────────────────────

/** When this process booted — the grace baseline for never-run jobs. */
const PROCESS_STARTED_AT = new Date();

/** De-dupe stale alerts per job, sharing cronSafety's cooldown semantics. */
export const staleAlertDeduper = new AlertDeduper();

export interface WatchdogDeps {
  now: () => Date;
  processStartedAt: () => Date;
  env: () => Record<string, string | undefined>;
  readHealth: () => Promise<Map<string, JobHealthRow>>;
  prune: () => Promise<number>;
  sendAlert: (subject: string, body: string) => Promise<void>;
  deduper: AlertDeduper;
  cooldownMs: number;
  log: (msg: string) => void;
  registry: readonly JobExpectation[];
}

function defaultWatchdogDeps(): WatchdogDeps {
  return {
    now: () => new Date(),
    processStartedAt: () => PROCESS_STARTED_AT,
    env: () => process.env as Record<string, string | undefined>,
    readHealth: readJobHealth,
    prune: pruneJobRuns,
    sendAlert: sendCronAlertEmail,
    deduper: staleAlertDeduper,
    cooldownMs: CRON_ALERT_COOLDOWN_MS,
    log: (msg) => console.log(msg),
    registry: JOB_REGISTRY,
  };
}

/**
 * One watchdog pass: classify every job, alert on the newly-stale ones, prune.
 *
 * Returns a JobOutcome so the watchdog records ITSELF to the ledger through
 * recordJobRun like any other job — which is what lets `job-health-watchdog`
 * appear in its own registry and be caught if it dies.
 *
 * NOTE ON THE ONE THING THIS CANNOT SEE: an in-process watchdog cannot report
 * that the whole process is dead. That case is covered by a different signal —
 * a dead process means the site is down, which Replit's health probe and any
 * visitor notice immediately. This watchdog exists for the much more dangerous
 * "site is up and serving, but the automation behind it is dead" case.
 *
 * A read failure here is a genuine FAILURE (not an empty result) — if the DB is
 * unreachable we cannot know anything about job health, and reporting that as a
 * clean pass would be exactly the canned-success lie this system exists to
 * prevent.
 */
export async function runJobHealthWatchdogOnce(
  overrides: Partial<WatchdogDeps> = {},
): Promise<JobOutcome> {
  const deps: WatchdogDeps = { ...defaultWatchdogDeps(), ...overrides };
  const now = deps.now();
  const bootedAt = deps.processStartedAt();

  // Deliberately NOT wrapped in try/catch: a throw here propagates to
  // recordJobRun, which records `failure`, and to runCronSafely, which emails.
  // Swallowing it would make "the watchdog cannot see the ledger" look healthy.
  const health = await deps.readHealth();
  const reports = classifyJobs(deps.registry, health, now, bootedAt, deps.env());

  const stale = reports.filter((r) => r.verdict === 'stale');
  const disabled = reports.filter((r) => r.verdict === 'disabled');

  // Per-job de-dupe, batched into ONE email: a broad outage (DB down) would
  // otherwise fan out into an alert per job.
  const toAlert = stale.filter((r) =>
    deps.deduper.shouldAlert(`job-stale:${r.job}`, now.getTime(), deps.cooldownMs),
  );
  if (toAlert.length > 0) {
    const subject =
      toAlert.length === 1
        ? `QuoteFleet job stalled: ${toAlert[0].job}`
        : `QuoteFleet: ${toAlert.length} background jobs stalled`;
    await deps.sendAlert(subject, buildStaleAlertBody(toAlert, now, bootedAt));
  }

  // Prune is best-effort — a retention failure must not mask a health result.
  let pruned = 0;
  try {
    pruned = await deps.prune();
  } catch (err) {
    deps.log(`[job-health] ledger prune failed (non-fatal): ${String(err)}`);
  }

  if (stale.length > 0 || disabled.length > 0) {
    deps.log(
      `[job-health] stale=${stale.length} (alerted ${toAlert.length}) disabled=${disabled.length} pruned=${pruned}`,
    );
  }

  // The watchdog ITSELF ran fine even when it found stale jobs — the stale jobs
  // are the finding, not a failure of this pass. Reporting `failure` here would
  // make the watchdog go stale and mask the real signal.
  return stale.length > 0
    ? jobSuccess(stale.length, `${stale.length} stale job(s): ${stale.map((s) => s.job).join(', ')}`)
    : jobSkipped(`all ${reports.length - disabled.length} enabled jobs healthy`);
}
