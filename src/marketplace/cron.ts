/**
 * Marketplace cron — hourly scheduler for anonymized aggregate recomputation.
 *
 * V1: in-process setInterval. Fine for a single-instance Replit deploy.
 * For multi-instance: switch to a real cron (Replit Scheduled Deployments,
 * GitHub Actions, or pg-boss). Caller filters out one node-only loops.
 *
 * Behavior:
 *   - Initial run 30 seconds after startup (lets the server fully boot).
 *   - Re-runs every 60 minutes.
 *   - Wrapped in try/catch so a transient DB error doesn't kill the loop.
 *   - Honors AGGREGATES_CRON_DISABLED=1 in env (useful for tests / 2nd instance).
 */
import { recomputeMarketplaceAggregates } from './sync.js';
import { runTrackedJob, outcomeFromTick, type TickResult } from '../server/jobHealth.js';
import { startCronSchedule } from '../server/cronSchedule.js';
import { describeDbError } from '../db/retry.js';

const HOUR_MS = 60 * 60 * 1000;

let started = false;

export function startMarketplaceCron(): void {
  if (started) return;
  if (process.env.AGGREGATES_CRON_DISABLED === '1') {
    console.log('[marketplace.cron] disabled via AGGREGATES_CRON_DISABLED=1');
    return;
  }
  started = true;

  // Staggered so this does not share an instant with the other eleven crons —
  // the interval's phase now inherits the offset. See server/cronSchedule.ts.
  startCronSchedule({
    cron: 'marketplace-aggregates',
    tickMs: HOUR_MS,
    run: (reason) => trackedRunOnce(reason === 'startup' ? 'startup' : 'hourly'),
  });
}

/** Scheduling site: records every tick to the job ledger and alerts on failure.
 *  The pass itself (runOnce) keeps its own logging and stays ledger-free. */
async function trackedRunOnce(reason: string): Promise<void> {
  await runTrackedJob('marketplace-aggregates', async () =>
    outcomeFromTick(await runOnce(reason), 'aggregates recomputed'),
  );
}

async function runOnce(reason: string): Promise<TickResult> {
  const t0 = Date.now();
  try {
    await recomputeMarketplaceAggregates();
    const ms = Date.now() - t0;
    console.log(`[marketplace.cron] aggregates recomputed (${reason}) in ${ms}ms`);
    return { ok: true, processed: 1, detail: `aggregates recomputed in ${ms}ms` };
  } catch (err) {
    console.warn(`[marketplace.cron] recompute failed (${reason}):`, err);
    // Was a bare swallow: the caller could not distinguish this from a clean
    // tick, so a permanently-failing recompute looked identical to success.
    // describeDbError unwraps drizzle's `Failed query: <entire SQL>` wrapper to
    // the actual cause — otherwise the alert email is pages of SQL and no
    // diagnosis, which is exactly how the 2026-08-31 alerts read.
    return { ok: false, processed: 0, detail: describeDbError(err) };
  }
}

/** Manual trigger for admin endpoint. Returns the result so the caller
 *  can show success/failure in the UI. */
export async function runAggregatesNow(): Promise<{ ok: boolean; durationMs: number; error?: string }> {
  const t0 = Date.now();
  try {
    await recomputeMarketplaceAggregates();
    return { ok: true, durationMs: Date.now() - t0 };
  } catch (err) {
    return {
      ok: false,
      durationMs: Date.now() - t0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
