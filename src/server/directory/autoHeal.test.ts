/**
 * Decision-logic tests for the carrier_directory boot-time DATA auto-heal.
 *
 * Every DB / ingest seam is injected + mocked — NO live DB, NO network. We only
 * assert the gating logic: disabled → no-op; populated → no-op; empty + lock →
 * background ingest started; empty + lock-held elsewhere → skip; and that a
 * failure while deciding is swallowed (never throws into boot).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AUTOHEAL_LOCK_KEY,
  AUTOHEAL_MIN_ROWS,
  maybeAutoHealCarrierDirectory,
  type AutoHealDeps,
} from './autoHeal.js';
import type { IngestSummary } from './carrierIngest.js';

const emptySummary: IngestSummary = {
  carriersSeen: 0,
  ingested: 321000,
  intermodal: 0,
  stateCounts: [],
  portCounts: [],
};

/** Fully-mocked deps; individual tests override what they exercise. isDisabled
 *  defaults to false so the logic actually runs (vitest sets NODE_ENV=test,
 *  which the real default would treat as disabled). */
function mockDeps(over: Partial<AutoHealDeps> = {}): AutoHealDeps {
  return {
    countCarriers: vi.fn(async () => 0),
    tryAdvisoryLock: vi.fn(async () => true),
    advisoryUnlock: vi.fn(async () => {}),
    runFullIngest: vi.fn(async () => emptySummary),
    isDisabled: vi.fn(() => false),
    log: vi.fn(),
    ...over,
  };
}

/** Let queued microtasks (the fire-and-forget ingest .then/.finally) settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => vi.restoreAllMocks());

describe('maybeAutoHealCarrierDirectory — gating constants', () => {
  it('uses a stable advisory-lock key and a 1000-row threshold', () => {
    expect(AUTOHEAL_LOCK_KEY).toBe(4100412026);
    expect(Number.isSafeInteger(AUTOHEAL_LOCK_KEY)).toBe(true);
    expect(AUTOHEAL_MIN_ROWS).toBe(1000);
  });
});

describe('maybeAutoHealCarrierDirectory — decision logic', () => {
  it('does nothing when disabled (never queries the DB)', async () => {
    const deps = mockDeps({ isDisabled: vi.fn(() => true) });
    const outcome = await maybeAutoHealCarrierDirectory(deps);
    expect(outcome).toBe('disabled');
    expect(deps.countCarriers).not.toHaveBeenCalled();
    expect(deps.tryAdvisoryLock).not.toHaveBeenCalled();
    expect(deps.runFullIngest).not.toHaveBeenCalled();
  });

  it('is a no-op when the table is already populated (count ≥ threshold)', async () => {
    const deps = mockDeps({ countCarriers: vi.fn(async () => AUTOHEAL_MIN_ROWS) });
    const outcome = await maybeAutoHealCarrierDirectory(deps);
    expect(outcome).toBe('populated');
    expect(deps.tryAdvisoryLock).not.toHaveBeenCalled();
    expect(deps.runFullIngest).not.toHaveBeenCalled();
  });

  it('treats a large populated table as a no-op', async () => {
    const deps = mockDeps({ countCarriers: vi.fn(async () => 321_000) });
    expect(await maybeAutoHealCarrierDirectory(deps)).toBe('populated');
    expect(deps.runFullIngest).not.toHaveBeenCalled();
  });

  it('starts a background ingest when empty and the lock is acquired', async () => {
    const deps = mockDeps({ countCarriers: vi.fn(async () => 0) });
    const outcome = await maybeAutoHealCarrierDirectory(deps);
    expect(outcome).toBe('started');
    expect(deps.tryAdvisoryLock).toHaveBeenCalledTimes(1);
    expect(deps.runFullIngest).toHaveBeenCalledTimes(1);
    // The advisory lock is released only after the background ingest resolves.
    await flush();
    expect(deps.advisoryUnlock).toHaveBeenCalledTimes(1);
  });

  it('re-ingests a below-threshold partial load (e.g. 999 rows)', async () => {
    const deps = mockDeps({ countCarriers: vi.fn(async () => AUTOHEAL_MIN_ROWS - 1) });
    expect(await maybeAutoHealCarrierDirectory(deps)).toBe('started');
    expect(deps.runFullIngest).toHaveBeenCalledTimes(1);
  });

  it('skips (no ingest) when another instance already holds the lock', async () => {
    const deps = mockDeps({
      countCarriers: vi.fn(async () => 0),
      tryAdvisoryLock: vi.fn(async () => false),
    });
    const outcome = await maybeAutoHealCarrierDirectory(deps);
    expect(outcome).toBe('lock-held');
    expect(deps.runFullIngest).not.toHaveBeenCalled();
    expect(deps.advisoryUnlock).not.toHaveBeenCalled();
  });

  it('releases the lock even if the background ingest throws', async () => {
    const deps = mockDeps({
      countCarriers: vi.fn(async () => 0),
      runFullIngest: vi.fn(async () => {
        throw new Error('socrata 503');
      }),
    });
    expect(await maybeAutoHealCarrierDirectory(deps)).toBe('started');
    await flush();
    expect(deps.advisoryUnlock).toHaveBeenCalledTimes(1);
  });

  it('swallows a failure while deciding — never throws into boot', async () => {
    const deps = mockDeps({
      countCarriers: vi.fn(async () => {
        throw new Error('db down');
      }),
    });
    const outcome = await maybeAutoHealCarrierDirectory(deps);
    expect(outcome).toBe('error');
    expect(deps.runFullIngest).not.toHaveBeenCalled();
  });
});
