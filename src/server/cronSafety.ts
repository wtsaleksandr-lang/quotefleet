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

/**
 * Send an admin alert email for a failed/slow cron. Best-effort: if no
 * SUPER_ADMIN_EMAIL is configured, or the send fails, it only logs — an alert
 * must NEVER throw back into the scheduler. Not exported as the primary API;
 * callers use runCronSafely, but it is injectable for tests.
 */
export async function sendCronAlertEmail(subject: string, body: string): Promise<void> {
  try {
    const env = loadEnv();
    const to = env.SUPER_ADMIN_EMAIL;
    if (!to) {
      console.warn('[cron-safety] cron alert not sent — no SUPER_ADMIN_EMAIL configured');
      return;
    }
    const out = await sendEmail({ to, subject, text: body });
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
