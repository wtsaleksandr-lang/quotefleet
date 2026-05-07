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

const HOUR_MS = 60 * 60 * 1000;
const STARTUP_DELAY_MS = 30 * 1000;

let started = false;

export function startMarketplaceCron(): void {
  if (started) return;
  if (process.env.AGGREGATES_CRON_DISABLED === '1') {
    console.log('[marketplace.cron] disabled via AGGREGATES_CRON_DISABLED=1');
    return;
  }
  started = true;

  setTimeout(() => void runOnce('startup'), STARTUP_DELAY_MS);
  setInterval(() => void runOnce('hourly'), HOUR_MS);

  console.log(
    `[marketplace.cron] scheduled — first run in ${STARTUP_DELAY_MS / 1000}s, then every ${HOUR_MS / 60_000} min`
  );
}

async function runOnce(reason: string): Promise<void> {
  const t0 = Date.now();
  try {
    await recomputeMarketplaceAggregates();
    const ms = Date.now() - t0;
    console.log(`[marketplace.cron] aggregates recomputed (${reason}) in ${ms}ms`);
  } catch (err) {
    console.warn(`[marketplace.cron] recompute failed (${reason}):`, err);
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
