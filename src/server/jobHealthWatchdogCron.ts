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
import { startCronSchedule } from './cronSchedule.js';

const TICK_MS = 60 * 60 * 1000; // hourly

let started = false;

export function startJobHealthWatchdogCron(): void {
  if (started) return;
  if (process.env.JOB_WATCHDOG_DISABLED === '1') {
    console.log('[job-health.cron] disabled via JOB_WATCHDOG_DISABLED=1');
    return;
  }
  started = true;
  // Its offset in CRON_STAGGER_MS is deliberately the LAST one, so the first
  // check runs after every job it watches has had a chance to record a first
  // tick instead of racing them and reading an empty ledger. A unit test pins
  // that ordering so a future offset change cannot silently break it.
  startCronSchedule({ cron: 'job-health-watchdog', tickMs: TICK_MS, run: tick });
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
