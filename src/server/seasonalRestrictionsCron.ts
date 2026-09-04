/**
 * THE SEASONAL-RESTRICTION CRON — one timer for every state.
 *
 * There is deliberately no scheduler here. `cronSchedule.ts` owns phase and
 * stagger (it exists because twelve crons used to fire inside a 141-millisecond
 * window against a serverless Postgres), `jobHealth.ts` owns the ledger and the
 * alerting, and `seasonal/schedule.ts` owns WHICH STATES ARE DUE. This file is
 * only the wiring between them, and that is the whole point: a second scheduler
 * would collide with the first and be invisible to the staleness watchdog.
 *
 * THE TICK IS 30 MINUTES AND USUALLY DOES NOTHING. Out of season the per-state
 * cadence is weekly, so most ticks find nothing due and record `skipped` —
 * which is HEALTHY in the ledger's model, and is precisely the heartbeat the
 * watchdog needs from a job whose real work happens in March. A seasonal job
 * with no off-season heartbeat would be indistinguishable from a dead one for
 * eight months of the year, and would be discovered on the first cold morning
 * in February, which is the worst possible moment to find out.
 */
import { runTrackedJob } from './jobHealth.js';
import { startCronSchedule } from './cronSchedule.js';
import { SEASONAL_TICK_MS } from '../calc/osow/seasonal/schedule.js';
import { runSeasonalIngestOnce } from './seasonal/ingest.js';

let started = false;

export function startSeasonalRestrictionsCron(): void {
  if (started) return;
  if (process.env.SEASONAL_RESTRICTIONS_DISABLED === '1') {
    console.log('[seasonal.cron] disabled via SEASONAL_RESTRICTIONS_DISABLED=1');
    return;
  }
  started = true;
  startCronSchedule({
    cron: 'seasonal-restrictions',
    tickMs: SEASONAL_TICK_MS,
    run: tick,
  });
  console.log(
    `[seasonal.cron] ticking every ${Math.round(SEASONAL_TICK_MS / 60_000)} min; ` +
      'each state is polled on its own cadence (3h in season, 12h in the shoulder, weekly otherwise)',
  );
}

async function tick(reason: string): Promise<void> {
  await runTrackedJob('seasonal-restrictions', async () => {
    void reason;
    return runSeasonalIngestOnce();
  });
}

/** Test seam — lets a suite drive one tick without the timer. */
export async function runSeasonalRestrictionsTickOnce(): Promise<void> {
  await tick('manual');
}
