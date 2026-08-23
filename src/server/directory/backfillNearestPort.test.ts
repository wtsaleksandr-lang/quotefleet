/**
 * Tests for the carrier_directory.nearest_port_code RE-DERIVATION backfill.
 *
 * Every DB seam is injected + faked — NO live DB, NO network. We assert:
 *   - the batched loop recomputes a STALE row (Oakland ZIP stored USLAX → USOAK,
 *     using the REAL shared derivation) and SKIPS already-correct rows;
 *   - the pass is IDEMPOTENT (a 2nd run over the corrected table updates 0);
 *   - the VERSION GUARD skips the scan when the marker is already current, and
 *     `force` bypasses it;
 *   - single-flight (lock-held → skip) and the disabled gate;
 *   - a completed pass bumps the stored derivation-version marker.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BACKFILL_LOCK_KEY,
  NEAREST_PORT_DERIVATION_VERSION,
  maybeBackfillNearestPortCodes,
  forceBackfillNearestPortCodes,
  type BackfillDeps,
  type BackfillRow,
} from './backfillNearestPort.js';
import { deriveNearestPortCode } from './carrierIngest.js';

/** Minimal in-memory carrier table + captured writes, exposing the two DB seams. */
function fakeTable(seed: BackfillRow[]) {
  const rows = seed.map((r) => ({ ...r }));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const updates: Array<{ ids: number[]; code: string | null }> = [];
  return {
    rows,
    updates,
    fetchBatch: vi.fn(async (afterId: number, limit: number): Promise<BackfillRow[]> => {
      return rows
        .filter((r) => r.id > afterId)
        .sort((a, b) => a.id - b.id)
        .slice(0, limit)
        .map((r) => ({ ...r }));
    }),
    applyUpdate: vi.fn(async (ids: number[], code: string | null) => {
      updates.push({ ids: [...ids], code });
      for (const id of ids) {
        const row = byId.get(id);
        if (row) row.nearestPortCode = code;
      }
    }),
  };
}

/** Fully-mocked deps; version marker lives in a closure so setStoredVersion sticks.
 *  isDisabled defaults false so the logic runs under vitest's NODE_ENV=test. */
function mockDeps(over: Partial<BackfillDeps> & { storedVersion?: number | null } = {}): BackfillDeps & {
  _version: () => number | null;
} {
  let stored: number | null = over.storedVersion ?? null;
  const { storedVersion: _drop, ...rest } = over;
  const deps: BackfillDeps & { _version: () => number | null } = {
    getStoredVersion: vi.fn(async () => stored),
    setStoredVersion: vi.fn(async (v: number) => {
      stored = v;
    }),
    tryAdvisoryLock: vi.fn(async () => true),
    advisoryUnlock: vi.fn(async () => {}),
    fetchBatch: vi.fn(async () => []),
    applyUpdate: vi.fn(async () => {}),
    derive: (row) => deriveNearestPortCode(row.country, row.state, row.zip),
    isDisabled: vi.fn(() => false),
    log: vi.fn(),
    _version: () => stored,
    ...rest,
  };
  return deps;
}

afterEach(() => vi.restoreAllMocks());

describe('nearest_port_code backfill — constants', () => {
  it('uses a stable, distinct advisory-lock key and a numeric version', () => {
    expect(BACKFILL_LOCK_KEY).toBe(4100422026);
    expect(Number.isSafeInteger(BACKFILL_LOCK_KEY)).toBe(true);
    // Must differ from the auto-heal lock so the two never block each other.
    expect(BACKFILL_LOCK_KEY).not.toBe(4100412026);
    expect(NEAREST_PORT_DERIVATION_VERSION).toBeGreaterThanOrEqual(2);
  });
});

describe('nearest_port_code backfill — gating', () => {
  it('does nothing when disabled (never reads the version or locks)', async () => {
    const deps = mockDeps({ isDisabled: vi.fn(() => true) });
    expect(await maybeBackfillNearestPortCodes(deps)).toBe('disabled');
    expect(deps.getStoredVersion).not.toHaveBeenCalled();
    expect(deps.tryAdvisoryLock).not.toHaveBeenCalled();
  });

  it('is up-to-date (no scan) when the stored marker is already current', async () => {
    const deps = mockDeps({ storedVersion: NEAREST_PORT_DERIVATION_VERSION });
    const table = fakeTable([]);
    deps.fetchBatch = table.fetchBatch;
    expect(await maybeBackfillNearestPortCodes(deps)).toBe('up-to-date');
    expect(deps.tryAdvisoryLock).not.toHaveBeenCalled();
    expect(table.fetchBatch).not.toHaveBeenCalled();
  });

  it('skips when another instance already holds the lock', async () => {
    const deps = mockDeps({ storedVersion: null, tryAdvisoryLock: vi.fn(async () => false) });
    expect(await maybeBackfillNearestPortCodes(deps)).toBe('lock-held');
    expect(deps.setStoredVersion).not.toHaveBeenCalled();
  });

  it('releases the advisory lock after a completed pass', async () => {
    const table = fakeTable([]);
    const deps = mockDeps({ storedVersion: null });
    deps.fetchBatch = table.fetchBatch;
    deps.applyUpdate = table.applyUpdate;
    expect(await maybeBackfillNearestPortCodes(deps)).toBe('completed');
    expect(deps.advisoryUnlock).toHaveBeenCalledTimes(1);
  });
});

describe('nearest_port_code backfill — re-derivation', () => {
  // Sanity-check the fixture ZIPs against the REAL shared derivation so the
  // assertions below can't silently rot if the hub set changes.
  const oaklandCode = deriveNearestPortCode('US', 'CA', '94607');
  const laCode = deriveNearestPortCode('US', 'CA', '90731');

  it('the fixture ZIPs derive as expected (Oakland → USOAK, San Pedro → USLAX)', () => {
    expect(oaklandCode).toBe('USOAK');
    expect(laCode).toBe('USLAX');
  });

  it('recomputes a STALE Oakland row (USLAX → USOAK) and SKIPS correct rows', async () => {
    const table = fakeTable([
      // Stale: physically Oakland but bulk-assigned USLAX under the old hub set.
      { id: 1, zip: '94607', state: 'CA', country: 'US', nearestPortCode: 'USLAX' },
      // Correct already: San Pedro (Port of LA) legitimately USLAX → must be skipped.
      { id: 2, zip: '90731', state: 'CA', country: 'US', nearestPortCode: 'USLAX' },
    ]);
    const deps = mockDeps({ storedVersion: 1 });
    deps.fetchBatch = table.fetchBatch;
    deps.applyUpdate = table.applyUpdate;

    expect(await maybeBackfillNearestPortCodes(deps)).toBe('completed');

    // Exactly one row updated: the stale Oakland row → USOAK.
    expect(table.updates).toHaveLength(1);
    expect(table.updates[0]).toEqual({ ids: [1], code: 'USOAK' });
    expect(table.rows.find((r) => r.id === 1)?.nearestPortCode).toBe('USOAK');
    // The already-correct row is untouched.
    expect(table.rows.find((r) => r.id === 2)?.nearestPortCode).toBe('USLAX');
    // Marker bumped to the current version.
    expect(deps._version()).toBe(NEAREST_PORT_DERIVATION_VERSION);
  });

  it('is idempotent — a 2nd run over the corrected table updates 0 rows', async () => {
    const table = fakeTable([
      { id: 1, zip: '94607', state: 'CA', country: 'US', nearestPortCode: 'USLAX' },
      { id: 2, zip: '90731', state: 'CA', country: 'US', nearestPortCode: 'USLAX' },
    ]);
    // First (forced) pass corrects the stale row.
    const deps1 = mockDeps({ storedVersion: 1 });
    deps1.fetchBatch = table.fetchBatch;
    deps1.applyUpdate = table.applyUpdate;
    await forceBackfillNearestPortCodes(deps1);
    expect(table.updates).toHaveLength(1);

    // Second forced pass over the SAME (now-corrected) rows writes nothing.
    const table2Updates: typeof table.updates = [];
    const deps2 = mockDeps({ storedVersion: NEAREST_PORT_DERIVATION_VERSION });
    deps2.fetchBatch = table.fetchBatch; // reuses the mutated in-memory rows
    deps2.applyUpdate = vi.fn(async (ids: number[], code: string | null) => {
      table2Updates.push({ ids: [...ids], code });
    });
    expect(await forceBackfillNearestPortCodes(deps2)).toBe('completed');
    expect(table2Updates).toHaveLength(0);
    expect(deps2.applyUpdate).not.toHaveBeenCalled();
  });

  it('version guard prevents a re-run once the marker is current (force overrides)', async () => {
    const table = fakeTable([
      { id: 1, zip: '94607', state: 'CA', country: 'US', nearestPortCode: 'USLAX' },
    ]);
    const deps = mockDeps({ storedVersion: NEAREST_PORT_DERIVATION_VERSION });
    deps.fetchBatch = table.fetchBatch;
    deps.applyUpdate = table.applyUpdate;

    // Not forced → skipped by the guard, table never scanned.
    expect(await maybeBackfillNearestPortCodes(deps)).toBe('up-to-date');
    expect(table.fetchBatch).not.toHaveBeenCalled();

    // Forced → bypasses the guard and fixes the stale row anyway.
    expect(await forceBackfillNearestPortCodes(deps)).toBe('completed');
    expect(table.updates).toEqual([{ ids: [1], code: 'USOAK' }]);
  });

  it('groups a mixed batch into one UPDATE per distinct new code', async () => {
    const table = fakeTable([
      { id: 1, zip: '94607', state: 'CA', country: 'US', nearestPortCode: 'USLAX' }, // → USOAK
      { id: 2, zip: '94607', state: 'CA', country: 'US', nearestPortCode: 'USSEA' }, // → USOAK (stale a different way)
      { id: 3, zip: '90731', state: 'CA', country: 'US', nearestPortCode: 'USOAK' }, // stale the OTHER way → USLAX
    ]);
    const deps = mockDeps({ storedVersion: 1 });
    deps.fetchBatch = table.fetchBatch;
    deps.applyUpdate = table.applyUpdate;

    expect(await maybeBackfillNearestPortCodes(deps)).toBe('completed');
    // One grouped update to USOAK (ids 1,2) and one to USLAX (id 3).
    const oak = table.updates.find((u) => u.code === 'USOAK');
    const lax = table.updates.find((u) => u.code === 'USLAX');
    expect(oak?.ids.sort()).toEqual([1, 2]);
    expect(lax?.ids).toEqual([3]);
  });

  it('swallows a mid-scan DB error — never throws into boot', async () => {
    const deps = mockDeps({
      storedVersion: 1,
      fetchBatch: vi.fn(async () => {
        throw new Error('db down');
      }),
    });
    expect(await maybeBackfillNearestPortCodes(deps)).toBe('error');
    // Marker not advanced on failure, so a healthy later boot retries.
    expect(deps.setStoredVersion).not.toHaveBeenCalled();
    // Lock still released.
    expect(deps.advisoryUnlock).toHaveBeenCalledTimes(1);
  });
});
