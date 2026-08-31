/**
 * Scheduler for the job staleness watchdog (src/server/jobHealthWatchdog.ts).
 *
 * Hourly tick, no work slot — every tick does a full check, because the whole
 * point is to notice quickly when something stopped. The pass is cheap: one
 * indexed DISTINCT ON over a ~9k-row table plus a range delete.
 *
 * The watchdog records ITSELF through runTrackedJob under 'job-health-watchdog',
 * which is also in JOB_REGISTRY. That is deliberate: if the watchdog itself dies
 * while the process lives, the next surviving check would catch it. (If the
 * whole process is dead, nothing in-process can report — but then the site is
 * down, which is loud by other means. See the note in jobHealthWatchdog.ts.)
 *
 * Kill-switch: JOB_WATCHDOG_DISABLED=1 (tests / a second instance). Same shape
 * as every other cron in this codebase.
 */
import { runTrackedJob } from './jobHealth.js';
import { runJobHealthWatchdogOnce } from './jobHealthWatchdog.js';

const TICK_MS = 60 * 60 * 1000; // hourly
/** Longer than any other cron's startup delay (max is 2 min) so the first check
 *  runs after the jobs it watches have had a chance to record their first tick,
 *  rather than racing them and seeing an empty ledger. */
const STARTUP_DELAY_MS = 5 * 60 * 1000;

let started = false;

export function startJobHealthWatchdogCron(): void {
  if (started) return;
  if (process.env.JOB_WATCHDOG_DISABLED === '1') {
    console.log('[job-health.cron] disabled via JOB_WATCHDOG_DISABLED=1');
    return;
  }
  started = true;
  setTimeout(() => void tick('startup'), STARTUP_DELAY_MS);
  setInterval(() => void tick('tick'), TICK_MS);
  console.log(
    `[job-health.cron] scheduled — first check in ${STARTUP_DELAY_MS / 60_000} min, then hourly`,
  );
}

async function tick(reason: string): Promise<void> {
  await runTrackedJob('job-health-watchdog', async () => {
    const outcome = await runJobHealthWatchdogOnce();
    if (outcome.status === 'success') {
      console.log(`[job-health.cron] check=${reason} — ${outcome.detail ?? 'stale jobs found'}`);
    }
    return outcome;
  });
}
