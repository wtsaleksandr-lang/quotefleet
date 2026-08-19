/**
 * Boot-time DATA self-heal for the public `carrier_directory` table.
 *
 * WHY THIS EXISTS (companion to ensureSelfHealTables in src/db/migrate.ts):
 * ensureSelfHealTables() re-creates the carrier_directory TABLE + indexes every
 * boot, so approving Replit's phantom-drop of the table is safe for the SCHEMA.
 * But when Replit drops + recreates the table, the ~321k ingested FMCSA rows are
 * GONE — the public /directory and /compliance pages render an empty directory
 * until someone manually re-runs scripts/ingestFmcsaCarriers.ts (a 15–30 min job
 * that hits the live FMCSA Socrata API). This module makes the DATA self-heal:
 * on boot, if the table is empty, it kicks off the ingest in the BACKGROUND.
 *
 * SAFETY CONTRACT (mirrors the column/table self-heal steps):
 *   - NEVER blocks boot. The server must listen immediately; the ingest runs
 *     detached (fire-and-forget) even while it takes 30 minutes. The caller in
 *     src/server/index.ts does not await this in the listen path.
 *   - IDEMPOTENT + safe to run on every boot. A populated table (count ≥
 *     AUTOHEAL_MIN_ROWS) is a no-op — the count check gates the actual ingest so
 *     a healthy DB never re-ingests.
 *   - SINGLE-FLIGHT across instances/restarts. Before ingesting we take a
 *     Postgres session-level ADVISORY LOCK (pg_try_advisory_lock). If another
 *     boot/instance already holds it, we log and return — only ONE ingest runs.
 *   - NEVER throws into boot. All errors are caught + logged.
 */
import { sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { carrierDirectory } from '../../db/schema.js';
import { runIngest, type IngestSummary } from './carrierIngest.js';

/**
 * Postgres advisory-lock key for the carrier-directory auto-ingest. Constant,
 * process-wide, chosen distinctively to avoid collision with any future advisory
 * lock: 0041 = the carrier_directory migration (drizzle/0041_carrier_directory.sql),
 * 2026 = the year. Fits well within int64 (and JS safe-integer range) so it round-
 * trips through the driver without precision loss.
 */
export const AUTOHEAL_LOCK_KEY = 4100412026;

/**
 * Row-count threshold below which the directory is considered empty/wiped and
 * the auto-ingest fires. A healthy full load is ~321k rows; a partial/interrupted
 * load is still useful, so we only re-ingest when it's essentially empty.
 */
export const AUTOHEAL_MIN_ROWS = 1000;

/** What the decision logic did — returned so it is unit-testable without a DB. */
export type AutoHealOutcome =
  | 'disabled' // gated off (NODE_ENV=test or CARRIER_AUTOHEAL_DISABLED)
  | 'populated' // count ≥ threshold → no-op
  | 'lock-held' // another instance/boot is already ingesting
  | 'started' // acquired lock → background ingest kicked off
  | 'error'; // an error occurred deciding (swallowed; never thrown)

/** Injectable seams so the decision logic can be tested with no DB / no network. */
export interface AutoHealDeps {
  /** Current row count of carrier_directory. */
  countCarriers: () => Promise<number>;
  /** pg_try_advisory_lock — true iff THIS session acquired the lock. */
  tryAdvisoryLock: () => Promise<boolean>;
  /** pg_advisory_unlock — release the lock held by this session. */
  advisoryUnlock: () => Promise<void>;
  /** Run the full FMCSA ingest (resolves when the whole ingest completes). */
  runFullIngest: () => Promise<IngestSummary>;
  /** True when auto-heal is gated off entirely. */
  isDisabled: () => boolean;
  log: (msg: string) => void;
}

// ─── Default deps wired to the real db() client + ingest ──────────────────
async function defaultCountCarriers(): Promise<number> {
  const rows = await db().select({ n: sql<number>`count(*)::int` }).from(carrierDirectory);
  return rows[0]?.n ?? 0;
}

async function defaultTryAdvisoryLock(): Promise<boolean> {
  const rows = await db().execute<{ locked: boolean }>(
    sql`select pg_try_advisory_lock(${AUTOHEAL_LOCK_KEY}) as locked`,
  );
  return rows[0]?.locked === true;
}

async function defaultAdvisoryUnlock(): Promise<void> {
  await db().execute(sql`select pg_advisory_unlock(${AUTOHEAL_LOCK_KEY})`);
}

/** Full national load: no cap, from the start, default page size, write to DB. */
function defaultRunFullIngest(): Promise<IngestSummary> {
  return runIngest({ limit: 0, offset: 0, pageSize: 1000, states: [], dryRun: false });
}

function defaultIsDisabled(): boolean {
  return process.env.NODE_ENV === 'test' || !!process.env.CARRIER_AUTOHEAL_DISABLED;
}

function defaultDeps(): AutoHealDeps {
  return {
    countCarriers: defaultCountCarriers,
    tryAdvisoryLock: defaultTryAdvisoryLock,
    advisoryUnlock: defaultAdvisoryUnlock,
    runFullIngest: defaultRunFullIngest,
    isDisabled: defaultIsDisabled,
    log: (msg) => console.log(msg),
  };
}

/**
 * Decide whether to re-ingest the carrier directory and, if so, kick the ingest
 * off in the BACKGROUND. Resolves as soon as the DECISION is made (and, when
 * ingesting, once the background job has been STARTED) — it never awaits the
 * ingest itself, so the boot path is never blocked. Never throws.
 *
 * @returns the outcome, for logging/tests. The background ingest (on 'started')
 *          runs detached; the advisory lock is released in its finally.
 */
export async function maybeAutoHealCarrierDirectory(
  overrides: Partial<AutoHealDeps> = {},
): Promise<AutoHealOutcome> {
  const deps: AutoHealDeps = { ...defaultDeps(), ...overrides };
  try {
    if (deps.isDisabled()) {
      deps.log('[autoheal] carrier_directory auto-heal disabled (NODE_ENV/opt-out) — skipping');
      return 'disabled';
    }

    const count = await deps.countCarriers();
    if (count >= AUTOHEAL_MIN_ROWS) {
      // Already populated — the overwhelmingly common healthy-boot path.
      return 'populated';
    }

    // Empty/wiped. Take the single-flight advisory lock so only ONE instance or
    // boot runs the (expensive, network-bound) ingest, even across restarts.
    const acquired = await deps.tryAdvisoryLock();
    if (!acquired) {
      deps.log('[autoheal] carrier_directory empty but auto-heal already running elsewhere — skipping');
      return 'lock-held';
    }

    deps.log(
      `[autoheal] carrier_directory empty (${count} rows) — starting background FMCSA auto-ingest`,
    );

    // Fire-and-forget: do NOT await. The ingest may run for ~30 min; the server
    // must already be listening. Release the advisory lock in finally, and catch
    // every error so nothing rejects unhandled or leaks into boot.
    void deps
      .runFullIngest()
      .then((summary) => {
        deps.log(`[autoheal] carrier_directory auto-ingest complete — ${summary.ingested} carriers`);
      })
      .catch((err) => {
        deps.log(`[autoheal] carrier_directory auto-ingest FAILED: ${String(err)}`);
      })
      .finally(() => {
        void deps.advisoryUnlock().catch((err) => {
          deps.log(`[autoheal] failed to release advisory lock: ${String(err)}`);
        });
      });

    return 'started';
  } catch (err) {
    // Deciding failed (e.g. the count query threw). Swallow — auto-heal is a
    // best-effort convenience and must NEVER break boot.
    deps.log(`[autoheal] carrier_directory auto-heal check failed (non-fatal): ${String(err)}`);
    return 'error';
  }
}
