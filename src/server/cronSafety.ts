/**
 * Worker-failure alerting for the in-process cron scheduler.
 *
 * WHY THIS EXISTS:
 * The server runs several crons on plain setInterval (marketplace aggregates,
 * fuel-surcharge refresh, lifecycle emails, follow-ups, weekly digest, and the
 * weekly FMCSA directory refresh). Each has its own try/catch that logs to the
 * console — but a Replit deploy has nobody watching stdout, so a cron that
 * starts throwing on every tick (bad migration, dropped table, expired key) is
 * a SILENT outage. Nothing tells the admin the worker is dead.
 *
 * `runCronSafely(name, fn)` wraps a single cron invocation so that:
 *   - a THROW is caught (the scheduler keeps ticking — one cron's failure must
 *     never stop the others) and an admin alert email is sent + logged;
 *   - a run that EXCEEDS a sane duration also raises a "slow run" alert while
 *     the run continues (a hung ingest / stuck fetch is as bad as a throw);
 *   - alerts are DE-DUPED per cron per kind (error vs slow) so a cron that
 *     fails every minute doesn't send an email every minute — at most one per
 *     cron per kind per cooldown window (default 6h).
 *
 * The wrapper is additive: existing cron bodies keep their own logging; routing
 * their tick through runCronSafely only adds the catch + alert. Never throws.
 *
 * The de-dupe decision and the alert-issuing seam are pure/injectable so the
 * behaviour is unit-testable with no timers, no email, and no real crons.
 */
import { loadEnv } from '../config.js';
import { sendEmail } from '../email/send.js';

/** Default: alert at most once per cron per kind per 6 hours. */
export const CRON_ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

/** Default: a single cron run taking longer than this raises a slow-run alert. */
export const CRON_SLOW_RUN_MS = 15 * 60 * 1000;

/** Which kind of alert — kept in the de-dupe key so a slow-run alert and an
 *  error alert for the same cron don't suppress one another. */
export type CronAlertKind = 'error' | 'slow';

/**
 * Stateful, time-injected de-dupe. `shouldAlert` returns true (and records the
 * time) only when no alert of that key has fired within `cooldownMs`. Pure aside
 * from its internal map + the injected `now`, so it is trivially unit-testable.
 */
export class AlertDeduper {
  private last = new Map<string, number>();

  /** True iff an alert for `key` should fire at `now` (records it when true). */
  shouldAlert(key: string, now: number, cooldownMs: number): boolean {
    const prev = this.last.get(key);
    if (prev !== undefined && now - prev < cooldownMs) return false;
    this.last.set(key, now);
    return true;
  }

  /** Test/ops helper — forget all recorded alert times. */
  reset(): void {
    this.last.clear();
  }
}

/** Process-wide de-dupe shared by every runCronSafely call (default deps). */
export const defaultDeduper = new AlertDeduper();

// ─────────────────────────────────────────────────────────────────────────────
// WHICH ENVIRONMENT IS PAGING? — the thing these emails never said
// ─────────────────────────────────────────────────────────────────────────────
//
// On 2026-08-31 ten "QuoteFleet job failed" emails arrived in ninety minutes
// while production was completely healthy — its job ledger recorded 46 runs in
// that window, every one `success` or `skipped`, and not one `failure` in the
// table's entire history. The alerts were real; they were simply not from
// production. They came from a process running the **dev** Doppler config,
// whose Neon branch answers every query with SQLSTATE 53000 ("Your project has
// exceeded the active time quota"). Their timestamps line up with that
// process's restarts, not with production's tick schedule.
//
// Three things conspired, and each is fixed here or nearby:
//
//   1. `SUPER_ADMIN_EMAIL` is set in the `dev` Doppler config and NOT in `prd`.
//      Only non-production could send these emails at all. (See the warning
//      below — production alerting is currently inert, which is its own bug and
//      needs the secret added to `prd`.)
//   2. `.replit` sets `NODE_ENV = "production"` for the workspace as well as the
//      deployment, so NODE_ENV cannot tell the two apart. `DOPPLER_CONFIG` can,
//      and does.
//   3. Nothing in the subject or body identified the sender's environment, so a
//      dev container's quota problem was indistinguishable from a production
//      outage — and got treated as one for hours.
//
// A development container must not page anyone. Non-production alerts are
// therefore dropped by default, with an explicit opt-in for the case where
// someone genuinely wants to watch a staging box.

/** Env var that re-enables alert emails from a non-production config. */
export const NON_PROD_ALERT_OPT_IN = 'CRON_ALERTS_FROM_NON_PROD';

/**
 * The deploy environment, from Doppler's injected config name.
 *
 * NOT from NODE_ENV: `.replit` pins that to "production" in the workspace too,
 * so it is the one variable guaranteed to be useless for this question.
 */
export function deployEnvironment(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.DOPPLER_CONFIG || env.DOPPLER_ENVIRONMENT || '';
  return raw.trim().toLowerCase() || 'unknown';
}

/** Config names (and Doppler branch-config prefixes) that are not production. */
const NON_PRODUCTION_NAMES = ['dev', 'stg', 'staging', 'ci', 'test', 'local', 'preview'];

/**
 * True only when the environment is POSITIVELY known to be non-production.
 *
 * Deliberately fail-open: an unrecognised or absent config name counts as
 * production and still alerts. Silence is the worse failure — a real outage
 * must never be suppressed because an env var was missing.
 */
export function isNonProductionEnvironment(name: string): boolean {
  if (!name || name === 'unknown') return false;
  return NON_PRODUCTION_NAMES.some((n) => name === n || name.startsWith(`${n}_`));
}

/**
 * Send an admin alert email for a failed/slow cron. Best-effort: if no
 * SUPER_ADMIN_EMAIL is configured, or the send fails, it only logs — an alert
 * must NEVER throw back into the scheduler. Not exported as the primary API;
 * callers use runCronSafely, but it is injectable for tests.
 *
 * Suppressed entirely on a non-production config unless CRON_ALERTS_FROM_NON_PROD=1.
 */
export async function sendCronAlertEmail(subject: string, body: string): Promise<void> {
  try {
    const env = loadEnv();
    const envName = deployEnvironment();
    const optedIn = process.env[NON_PROD_ALERT_OPT_IN] === '1';

    if (isNonProductionEnvironment(envName) && !optedIn) {
      console.warn(
        `[cron-safety] alert SUPPRESSED — this process runs the "${envName}" config, not production. ` +
          `Subject would have been: ${subject}. ` +
          `Set ${NON_PROD_ALERT_OPT_IN}=1 to receive alerts from this environment.`,
      );
      return;
    }

    const to = env.SUPER_ADMIN_EMAIL;
    if (!to) {
      console.warn(
        `[cron-safety] cron alert NOT SENT — no SUPER_ADMIN_EMAIL in the "${envName}" config. ` +
          `Nothing will ever be alerted from this environment until it is set.`,
      );
      return;
    }

    // Always name the environment. Tag the subject only when it is not
    // production, so production's subject lines (and any filters on them) are
    // unchanged while an opted-in dev/staging alert is impossible to mistake.
    const taggedSubject = isNonProductionEnvironment(envName) ? `[${envName}] ${subject}` : subject;
    const stamped = `Environment: ${envName}\n\n${body}`;

    const out = await sendEmail({ to, subject: taggedSubject, text: stamped });
    if (!out.ok) {
      console.error(`[cron-safety] cron alert email failed: ${out.error ?? 'unknown error'}`);
    }
  } catch (err) {
    console.error('[cron-safety] cron alert email threw (swallowed):', err);
  }
}

/** Injectable seams for runCronSafely — all default to real time/timers/email. */
export interface CronSafetyDeps {
  now: () => number;
  log: (msg: string) => void;
  /** Send the admin alert (subject, body). Never expected to throw. */
  sendAlert: (subject: string, body: string) => Promise<void>;
  deduper: AlertDeduper;
  alertCooldownMs: number;
  slowRunMs: number;
  /** Schedule the slow-run watchdog; returns an opaque handle. */
  scheduleTimer: (fn: () => void, ms: number) => unknown;
  /** Cancel the slow-run watchdog. */
  cancelTimer: (handle: unknown) => void;
}

function defaultDeps(): CronSafetyDeps {
  return {
    now: () => Date.now(),
    log: (msg) => console.log(msg),
    sendAlert: sendCronAlertEmail,
    deduper: defaultDeduper,
    alertCooldownMs: CRON_ALERT_COOLDOWN_MS,
    slowRunMs: CRON_SLOW_RUN_MS,
    scheduleTimer: (fn, ms) => {
      const h = setTimeout(fn, ms);
      // Don't keep the process alive just for the watchdog.
      if (typeof (h as { unref?: () => void }).unref === 'function') {
        (h as { unref: () => void }).unref();
      }
      return h;
    },
    cancelTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
}

/**
 * Issue a de-duped alert for `name`/`kind`. Sends the admin email + logs the
 * error only when the de-dupe window allows it; otherwise logs that the alert
 * was suppressed. Pure aside from the injected deps; never throws.
 */
async function issueAlert(
  name: string,
  kind: CronAlertKind,
  detail: string,
  deps: CronSafetyDeps,
): Promise<void> {
  const now = deps.now();
  const key = `${name}:${kind}`;
  const headline =
    kind === 'error'
      ? `[cron-safety] cron "${name}" FAILED: ${detail}`
      : `[cron-safety] cron "${name}" SLOW (still running): ${detail}`;
  deps.log(headline);
  if (!deps.deduper.shouldAlert(key, now, deps.alertCooldownMs)) {
    deps.log(`[cron-safety] alert for "${name}" (${kind}) suppressed — within cooldown`);
    return;
  }
  const subject =
    kind === 'error'
      ? `QuoteFleet cron failed: ${name}`
      : `QuoteFleet cron slow: ${name}`;
  const body =
    `Cron "${name}" raised a ${kind} condition.\n\n` +
    `${detail}\n\n` +
    `Time (UTC): ${new Date(now).toISOString()}\n\n` +
    `This is an automated worker-health alert. Further alerts for this cron/kind ` +
    `are suppressed for ${Math.round(deps.alertCooldownMs / 60000)} min to avoid spam. ` +
    `Check the server logs for the full stack.`;
  await deps.sendAlert(subject, body);
}

/**
 * Run one scheduled cron invocation with failure + slow-run alerting.
 *
 * - Starts a slow-run watchdog: if `fn` hasn't settled within `slowRunMs`, a
 *   (de-duped) "slow" alert fires while `fn` keeps running.
 * - If `fn` throws/rejects, a (de-duped) "error" alert fires and the error is
 *   SWALLOWED — runCronSafely never rethrows, so the surrounding scheduler /
 *   setInterval keeps ticking and sibling crons are unaffected.
 *
 * Returns true iff `fn` completed without throwing.
 */
export async function runCronSafely(
  name: string,
  fn: () => Promise<void> | void,
  overrides: Partial<CronSafetyDeps> = {},
): Promise<boolean> {
  const deps: CronSafetyDeps = { ...defaultDeps(), ...overrides };
  let slowFired = false;
  const watchdog = deps.scheduleTimer(() => {
    slowFired = true;
    void issueAlert(name, 'slow', `run exceeded ${Math.round(deps.slowRunMs / 60000)} min`, deps);
  }, deps.slowRunMs);

  try {
    await fn();
    return true;
  } catch (err) {
    const detail = err instanceof Error ? `${err.message}` : String(err);
    // Log the full error object (stack) here; issueAlert emails the summary.
    console.error(`[cron-safety] cron "${name}" threw:`, err);
    await issueAlert(name, 'error', detail, deps);
    return false;
  } finally {
    if (!slowFired) deps.cancelTimer(watchdog);
  }
}
