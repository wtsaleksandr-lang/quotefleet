/**
 * Boot-time RE-DERIVATION backfill for `carrier_directory.nearest_port_code`.
 *
 * WHY THIS EXISTS:
 * `nearest_port_code` is a DERIVED column (ZIP centroid / CA province → nearest
 * hub, via deriveNearestPortCode). The derivation has EVOLVED — new hubs were
 * added (e.g. the Oakland USOAK gateway) and a MAX_HUB_RADIUS_MI=250 cap was
 * introduced — but the stored column was only ever written at INGEST time. Rows
 * ingested under an OLDER hub set kept their stale code: ~348 Oakland/Bay-Area
 * carriers stayed pinned to USLAX (~350 mi away, now beyond the radius cap)
 * instead of USOAK, so `/directory/port/USOAK?equipment=drayage` returned ~1
 * instead of ~196. A full FMCSA re-ingest would fix it, but that's a 15–30 min
 * network job; the DATA needed is already in every row (zip / state / country),
 * so we simply RE-COMPUTE the column in place using the SAME current derivation
 * the ingest uses (deriveNearestPortCode) — no FMCSA re-download.
 *
 * SAFETY CONTRACT (mirrors maybeAutoHealCarrierDirectory):
 *   - NEVER blocks boot. The caller in src/server/index.ts fire-and-forgets it
 *     (`void maybeBackfillNearestPortCodes()`); it never awaits into app.listen.
 *   - NEVER throws into boot. Every error is caught + logged.
 *   - SINGLE-FLIGHT across instances/restarts via a Postgres advisory lock
 *     (pg_try_advisory_lock) — only ONE boot/instance runs the pass.
 *   - IDEMPOTENT + VERSION-GATED. A stored marker in `platform_settings`
 *     (VERSION_KEY) records the derivation version last applied. On boot we run
 *     only when the stored version < NEAREST_PORT_DERIVATION_VERSION, then bump
 *     the marker — so a healthy DB does NOT re-scan 321k rows every boot. Bumping
 *     the constant is how a FUTURE derivation change (new hub / radius) re-triggers.
 *   - BATCHED. Rows are scanned in id order in BATCH_SIZE pages and only rows whose
 *     recomputed value DIFFERS from the stored one are UPDATEd (grouped by new
 *     value → one UPDATE … WHERE id IN (…) per distinct code per batch), so a
 *     no-op pass writes nothing and a real pass touches only the stale rows.
 *
 * NOTE: this deliberately does NOT bump `updated_at` — it's a derived-column
 * correction, not an FMCSA data refresh, so it must not pollute the "recently
 * updated" facet or the "FMCSA data as of …" line.
 */
import { and, asc, gt, inArray, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { carrierDirectory, platformSettings } from '../../db/schema.js';
import { deriveNearestPortCode } from './carrierIngest.js';

/**
 * Current derivation version. BUMP THIS whenever deriveNearestPortCode's output
 * can change (a new hub in terminals.ts/containerPorts.ts, a MAX_HUB_RADIUS_MI
 * change, a province-map change) — the boot backfill re-runs whenever the stored
 * marker is below this number, self-healing every already-loaded directory.
 *
 * v2 = adds the Oakland (USOAK) + other denser hubs and the 250-mi radius cap
 * that the original bulk ingest (v1, implicit) predated.
 */
export const NEAREST_PORT_DERIVATION_VERSION = 2;

/** `platform_settings` key holding the last-applied derivation version (as text). */
export const VERSION_KEY = 'carrier_directory:nearest_port_derivation_version';

/**
 * Advisory-lock key for the nearest-port re-derivation backfill. DISTINCT from
 * AUTOHEAL_LOCK_KEY (4100412026) so the backfill and the empty-table auto-ingest
 * never block each other: 0041 = the carrier_directory migration, 42 = this
 * (the port-backfill) job, 2026 = the year. Safe integer → round-trips the driver.
 */
export const BACKFILL_LOCK_KEY = 4100422026;

/** Rows scanned per SELECT page. A few thousand keeps memory + statement size low. */
export const BATCH_SIZE = 5000;

/** What the pass did — returned for logging/tests (no DB needed to assert it). */
export type BackfillOutcome =
  | 'disabled' // gated off (NODE_ENV=test or CARRIER_AUTOHEAL_DISABLED)
  | 'up-to-date' // stored version ≥ current → skipped (not forced)
  | 'lock-held' // another instance/boot is already running the pass
  | 'completed' // acquired lock → scan finished, marker bumped
  | 'error'; // an error occurred (swallowed; never thrown)

/** A minimal row shape the re-derivation needs. */
export interface BackfillRow {
  id: number;
  zip: string | null;
  state: string | null;
  country: string | null;
  nearestPortCode: string | null;
}

/** Stats from a completed pass (also surfaced to the admin endpoint / tests). */
export interface BackfillStats {
  scanned: number;
  updated: number;
  batches: number;
}

/** Injectable seams so the pass is unit-testable with no DB / no network. */
export interface BackfillDeps {
  /** Read the stored derivation version (null when the marker is absent). */
  getStoredVersion: () => Promise<number | null>;
  /** Persist the derivation version marker (idempotent upsert). */
  setStoredVersion: (v: number) => Promise<void>;
  /** pg_try_advisory_lock — true iff THIS session acquired the lock. */
  tryAdvisoryLock: () => Promise<boolean>;
  /** pg_advisory_unlock — release the lock held by this session. */
  advisoryUnlock: () => Promise<void>;
  /** One id-ordered page of rows with id > afterId (empty array = done). */
  fetchBatch: (afterId: number, limit: number) => Promise<BackfillRow[]>;
  /** Set nearest_port_code = code (may be null) for the given row ids. */
  applyUpdate: (ids: number[], code: string | null) => Promise<void>;
  /** Recompute nearest_port_code for a row (defaults to deriveNearestPortCode). */
  derive: (row: BackfillRow) => string | null;
  /** True when the backfill is gated off entirely. */
  isDisabled: () => boolean;
  log: (msg: string) => void;
}

// ─── Default deps wired to the real db() client + shared derivation ───────
async function defaultGetStoredVersion(): Promise<number | null> {
  const rows = await db()
    .select({ value: platformSettings.value })
    .from(platformSettings)
    .where(sql`${platformSettings.key} = ${VERSION_KEY}`)
    .limit(1);
  const raw = rows[0]?.value;
  if (raw == null) return null;
  const n = Number.parseInt(String(raw), 10);
  return Number.isFinite(n) ? n : null;
}

async function defaultSetStoredVersion(v: number): Promise<void> {
  const value = String(v);
  await db()
    .insert(platformSettings)
    .values({ key: VERSION_KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: platformSettings.key, set: { value, updatedAt: new Date() } });
}

async function defaultTryAdvisoryLock(): Promise<boolean> {
  const rows = await db().execute<{ locked: boolean }>(
    sql`select pg_try_advisory_lock(${BACKFILL_LOCK_KEY}) as locked`,
  );
  return rows[0]?.locked === true;
}

async function defaultAdvisoryUnlock(): Promise<void> {
  await db().execute(sql`select pg_advisory_unlock(${BACKFILL_LOCK_KEY})`);
}

async function defaultFetchBatch(afterId: number, limit: number): Promise<BackfillRow[]> {
  return db()
    .select({
      id: carrierDirectory.id,
      zip: carrierDirectory.zip,
      state: carrierDirectory.state,
      country: carrierDirectory.country,
      nearestPortCode: carrierDirectory.nearestPortCode,
    })
    .from(carrierDirectory)
    .where(gt(carrierDirectory.id, afterId))
    .orderBy(asc(carrierDirectory.id))
    .limit(limit);
}

async function defaultApplyUpdate(ids: number[], code: string | null): Promise<void> {
  if (ids.length === 0) return;
  // Only nearest_port_code is touched — NOT updated_at (see module header).
  await db()
    .update(carrierDirectory)
    .set({ nearestPortCode: code })
    .where(inArray(carrierDirectory.id, ids));
}

function defaultIsDisabled(): boolean {
  return process.env.NODE_ENV === 'test' || !!process.env.CARRIER_AUTOHEAL_DISABLED;
}

function defaultDeps(): BackfillDeps {
  return {
    getStoredVersion: defaultGetStoredVersion,
    setStoredVersion: defaultSetStoredVersion,
    tryAdvisoryLock: defaultTryAdvisoryLock,
    advisoryUnlock: defaultAdvisoryUnlock,
    fetchBatch: defaultFetchBatch,
    applyUpdate: defaultApplyUpdate,
    derive: (row) => deriveNearestPortCode(row.country, row.state, row.zip),
    isDisabled: defaultIsDisabled,
    log: (msg) => console.log(msg),
  };
}

/**
 * Scan the whole table in id-ordered batches and re-derive nearest_port_code,
 * updating ONLY rows whose recomputed value differs from the stored one. Pure of
 * the version-gate / lock (the caller owns those) so tests can exercise the loop
 * directly. Never throws — the caller wraps it, but errors here would abort the
 * pass; keep it total. Returns the scan stats.
 */
export async function runNearestPortBackfill(deps: BackfillDeps): Promise<BackfillStats> {
  let afterId = 0;
  let scanned = 0;
  let updated = 0;
  let batches = 0;

  for (;;) {
    const rows = await deps.fetchBatch(afterId, BATCH_SIZE);
    if (rows.length === 0) break;
    batches += 1;
    scanned += rows.length;

    // Collect only the CHANGED rows, grouped by their new code (null grouped
    // under a sentinel key) so each batch issues one UPDATE per distinct value.
    const NULL_KEY = ' null';
    const changedByCode = new Map<string, { code: string | null; ids: number[] }>();
    for (const row of rows) {
      const next = deps.derive(row);
      if (next === row.nearestPortCode) continue; // no-op — skip
      const key = next ?? NULL_KEY;
      const bucket = changedByCode.get(key) ?? { code: next, ids: [] };
      bucket.ids.push(row.id);
      changedByCode.set(key, bucket);
    }

    for (const { code, ids } of changedByCode.values()) {
      await deps.applyUpdate(ids, code);
      updated += ids.length;
    }

    afterId = rows[rows.length - 1].id;
    if (rows.length < BATCH_SIZE) break; // last page
  }

  return { scanned, updated, batches };
}

/**
 * Boot-time entry point: version-gate → single-flight lock → run the batched
 * re-derivation → bump the marker. Fire-and-forget from boot (never awaited into
 * app.listen), never throws. `force` skips the version gate (admin trigger).
 */
export async function maybeBackfillNearestPortCodes(
  overrides: Partial<BackfillDeps> & { force?: boolean } = {},
): Promise<BackfillOutcome> {
  const { force, ...depOverrides } = overrides;
  const deps: BackfillDeps = { ...defaultDeps(), ...depOverrides };
  try {
    if (deps.isDisabled()) {
      deps.log('[port-backfill] nearest_port_code backfill disabled (NODE_ENV/opt-out) — skipping');
      return 'disabled';
    }

    if (!force) {
      const stored = await deps.getStoredVersion();
      if (stored !== null && stored >= NEAREST_PORT_DERIVATION_VERSION) {
        // Already at (or above) the current derivation version — the common
        // healthy-boot path. No scan.
        return 'up-to-date';
      }
    }

    // Single-flight so overlapping boots/instances don't double-scan.
    const acquired = await deps.tryAdvisoryLock();
    if (!acquired) {
      deps.log('[port-backfill] backfill already running elsewhere — skipping');
      return 'lock-held';
    }

    try {
      deps.log(
        `[port-backfill] re-deriving nearest_port_code (v${NEAREST_PORT_DERIVATION_VERSION}${force ? ', forced' : ''})…`,
      );
      const stats = await runNearestPortBackfill(deps);
      await deps.setStoredVersion(NEAREST_PORT_DERIVATION_VERSION);
      deps.log(
        `[port-backfill] complete — scanned ${stats.scanned} rows in ${stats.batches} batches, updated ${stats.updated}; marker → v${NEAREST_PORT_DERIVATION_VERSION}`,
      );
      return 'completed';
    } finally {
      await deps.advisoryUnlock().catch((err) => {
        deps.log(`[port-backfill] failed to release advisory lock: ${String(err)}`);
      });
    }
  } catch (err) {
    // Best-effort self-heal — must NEVER break boot.
    deps.log(`[port-backfill] backfill failed (non-fatal): ${String(err)}`);
    return 'error';
  }
}

/** Outcome of the admin-triggered forced backfill (no version gate). */
export type ForceBackfillOutcome = BackfillOutcome;

/**
 * FORCE the nearest_port_code re-derivation regardless of the stored version
 * marker — the admin on-demand trigger (mirrors forceReingestCarrierDirectory).
 * Same safety contract: single-flight via the shared lock, never throws. Runs to
 * completion (awaited) so the endpoint can report the outcome; the endpoint
 * itself does not await when it wants a fire-and-forget 202.
 */
export function forceBackfillNearestPortCodes(
  overrides: Partial<BackfillDeps> = {},
): Promise<ForceBackfillOutcome> {
  return maybeBackfillNearestPortCodes({ ...overrides, force: true });
}
