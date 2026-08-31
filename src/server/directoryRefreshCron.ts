/**
 * Weekly FMCSA carrier-directory refresh cron.
 *
 * WHY THIS EXISTS:
 * The public carrier_directory (~321k rows) is only ever (re)populated when the
 * table is EMPTY — maybeAutoHealCarrierDirectory() on boot re-ingests a wiped
 * table, but on a healthy, already-populated table it is a deliberate no-op.
 * That means once loaded, the directory NEVER refreshes: carriers that go out
 * of service, revoke authority, or change equipment/contact data go stale and
 * linger indefinitely. forceReingestCarrierDirectory() already exists (it skips
 * the empty-table gate and re-runs the full FMCSA ingest, single-flighted via
 * the shared advisory lock) — this cron simply calls it on a WEEKLY cadence.
 *
 * SCHEDULING (mirrors weeklyDigestCron): hourly tick from boot; the tick only
 * fires the actual re-ingest on the weekly OFF-PEAK slot (Sunday 09:00 UTC). A
 * 6-day cooldown guard makes the pass idempotent across the hour the slot is
 * open and across restarts, so a bouncing instance can't kick multiple ingests.
 *
 * LONG-JOB SAFETY: the re-ingest runs ~15–30 min but does NOT block the
 * scheduler — forceReingestCarrierDirectory() is fire-and-forget (it returns as
 * soon as the background job is STARTED and never awaits the ingest), so the
 * hourly tick returns immediately and sibling crons keep ticking. It is also
 * single-flighted by a Postgres advisory lock, so an overlap with the boot-time
 * auto-heal just returns 'lock-held'.
 *
 * KILL-SWITCH: DISABLE_WEEKLY_REINGEST=1 disables the cron entirely (tests /
 * second instance). NODE_ENV=test is also honored downstream (forceReingest
 * returns 'disabled').
 *
 * The tick is routed through runCronSafely so a throw/hang raises an admin alert
 * instead of silently dying.
 */
import { runTrackedJob, jobSuccess, jobSkipped, jobFailure } from './jobHealth.js';
import { forceReingestCarrierDirectory } from './directory/autoHeal.js';
import { ensureFreshDirectoryAggregates } from './directory/queries.js';
import { ensureFreshSitemap } from './directory/sitemapCache.js';

const TICK_MS = 60 * 60 * 1000; // hourly
const STARTUP_DELAY_MS = 2 * 60 * 1000; // 2 min after boot before the first tick

/** Weekly slot: Sunday (UTC day 0), 09:00 UTC — off-peak for freight ops. */
export const REFRESH_DOW = 0;
export const REFRESH_HOUR = 9;

/** Don't re-kick within this window — the double-run guard. */
export const REFRESH_COOLDOWN_MS = 6 * 24 * 60 * 60 * 1000;

/**
 * Pure scheduling predicate: should the weekly re-ingest fire at `now`, given
 * when it last fired? True only inside the weekly slot AND outside the cooldown.
 * Exported + injectable so the cadence is unit-testable with no timers.
 */
export function shouldRunWeeklyRefresh(
  now: Date,
  lastRunMs: number | undefined,
  cooldownMs: number = REFRESH_COOLDOWN_MS,
): boolean {
  if (now.getUTCDay() !== REFRESH_DOW || now.getUTCHours() !== REFRESH_HOUR) return false;
  if (lastRunMs !== undefined && now.getTime() - lastRunMs < cooldownMs) return false;
  return true;
}

let started = false;
let lastRunMs: number | undefined;

export function startDirectoryRefreshCron(): void {
  if (started) return;
  if (process.env.DISABLE_WEEKLY_REINGEST === '1') {
    console.log('[directoryRefresh.cron] disabled via DISABLE_WEEKLY_REINGEST=1');
    return;
  }
  started = true;
  setTimeout(() => void maybeRun('startup'), STARTUP_DELAY_MS);
  setInterval(() => void maybeRun('tick'), TICK_MS);
  console.log(
    `[directoryRefresh.cron] scheduled — hourly tick; re-ingest slot Sun ${REFRESH_HOUR}:00 UTC`,
  );
}

/** Gate the hourly tick to the weekly slot, then kick the re-ingest (safely). */
async function maybeRun(reason: string): Promise<void> {
  // SAFETY NET (every hourly tick, independent of the weekly slot): keep the
  // PRECOMPUTED global directory aggregates (directory_aggregate_cache) fresh so
  // the /directory request path always has a persisted row to serve and never
  // falls back to a live 330k-row scan. This is the durable fix for the recurring
  // all-domains-down outage. ensureFreshDirectoryAggregates only recomputes when
  // the row is missing or older than its max-age (a cheap PK read otherwise) and
  // never throws, so it is safe to call on every tick.
  // ensureFreshDirectoryAggregates NEVER THROWS — it catches internally and
  // returns the string 'error'. That sentinel used to be discarded here, so a
  // permanently-broken recompute (the missing directory_aggregate_cache table
  // that caused the all-domains-down outage) returned 'error' every hour while
  // runCronSafely reported success and sent nothing. Read the sentinel.
  await runTrackedJob('directory-aggregate-refresh', async () => {
    const outcome = await ensureFreshDirectoryAggregates();
    if (outcome === 'error') {
      return jobFailure(
        'ensureFreshDirectoryAggregates returned "error" — the precomputed directory aggregate ' +
          'cache could not be refreshed. /directory falls back to a live 330k-row scan.',
      );
    }
    if (outcome === 'recomputed') {
      console.log('[directoryRefresh.cron] directory aggregates recomputed + persisted (safety net)');
      return jobSuccess(1, 'aggregates recomputed + persisted');
    }
    return jobSkipped(`aggregates already fresh (${outcome})`);
  });

  // SAFETY NET (every hourly tick): keep the MATERIALIZED sitemap documents
  // (sitemap_cache) fresh so /sitemap*.xml always serves the discovery layer for
  // all ~334k carrier profiles from an O(1) PK lookup and NEVER falls back to a
  // live 334k-row scan on the crawler's request. ensureFreshSitemap only
  // recomputes when the 'index' row is missing or older than its max-age (a cheap
  // PK read otherwise) and never throws, so it is safe to call on every tick.
  // Same unread-sentinel defect as the aggregates above. This one is worse in
  // its consequences: on a read failure the serving path degrades to a VALID but
  // EMPTY <urlset>, which is indistinguishable to a crawler from "this site has
  // no pages". A silently-failing rebuild is therefore an SEO outage that looks
  // like a healthy 200.
  await runTrackedJob('directory-sitemap-refresh', async () => {
    const outcome = await ensureFreshSitemap();
    if (outcome === 'error') {
      return jobFailure(
        'ensureFreshSitemap returned "error" — the materialized sitemap documents could not be ' +
          'rebuilt. /sitemap*.xml may serve a stale or empty urlset to crawlers.',
      );
    }
    if (outcome === 'recomputed') {
      console.log('[directoryRefresh.cron] sitemap documents recomputed + persisted (safety net)');
      return jobSuccess(1, 'sitemap documents recomputed + persisted');
    }
    return jobSkipped(`sitemap already fresh (${outcome})`);
  });

  const now = new Date();
  if (!shouldRunWeeklyRefresh(now, lastRunMs)) {
    // HEARTBEAT. The re-ingest only does work one hour a week, but the tick runs
    // hourly. Recording the no-op tick as `skipped` is what lets the staleness
    // watchdog hold this job to a 3-hour interval instead of a 7-day one — the
    // difference between noticing a dead scheduler in an afternoon and noticing
    // it next month. See jobHealthWatchdog.ts, "WHY skipped COUNTS AS HEALTHY".
    await runTrackedJob('directory-reingest', () =>
      jobSkipped('outside the weekly Sun 09:00 UTC re-ingest slot'),
    );
    return;
  }
  // Record BEFORE the run so the cooldown guard holds even if the tick re-enters
  // within the same open hour (the ingest itself is single-flighted anyway).
  lastRunMs = now.getTime();
  await runTrackedJob('directory-reingest', async () => {
    console.log(`[directoryRefresh.cron] weekly FMCSA re-ingest starting (${reason})`);
    const outcome = await forceReingestCarrierDirectory();
    console.log(`[directoryRefresh.cron] weekly FMCSA re-ingest kicked — outcome=${outcome}`);
    // This records only that the ingest was KICKED. The ~30-minute run itself is
    // detached, so its TERMINAL result is reported separately against this same
    // job name from autoHeal.ts's reportIngestOutcome — that is where a failed or
    // zero-row ingest becomes a `failure` row and an admin email. Reporting
    // 'started' as a plain success here (the old behaviour) was the lie: the
    // cron went green minutes before the ingest had done anything at all.
    if (outcome === 'disabled') {
      return jobSkipped('re-ingest kick skipped — auto-heal is disabled (CARRIER_AUTOHEAL_DISABLED)');
    }
    if (outcome === 'lock-held') {
      // NOTE: forceReingestCarrierDirectory also returns 'lock-held' when the
      // lock CHECK itself threw, so this is not purely benign contention.
      return jobSkipped('re-ingest not kicked — advisory lock held (an ingest is already running, or the lock check failed)');
    }
    // NOTE: no sitemap rebuild here on purpose. forceReingestCarrierDirectory
    // returns as soon as the ingest is KICKED — the ingest itself runs in the
    // background — so a rebuild here would materialize the PRE-ingest carrier set
    // and would run its scan concurrently with the ingest's own writes. The
    // sitemap instead picks the new carriers up on a later hourly tick, via the
    // carrier-count drift check in ensureFreshSitemap() above.
    return jobSuccess(0, 'weekly FMCSA re-ingest kicked; terminal outcome reported by the detached run');
  });
}
