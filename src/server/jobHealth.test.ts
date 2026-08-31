/**
 * Unit tests for the job-run ledger and the tracked-job wrapper.
 *
 * Every seam (clock / ledger write / alert / de-dupe) is injected — no DB, no
 * email, no timers. The assertions are deliberately weighted toward the ONE
 * property this system exists to guarantee: a job that could not do its work is
 * recorded as a FAILURE and never as a zero-result success.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  jobFailure,
  jobSkipped,
  jobSuccess,
  outcomeFromTick,
  recordJobRun,
  runTrackedJob,
  truncateDetail,
  DETAIL_MAX_CHARS,
  JOB_RUNS_SELF_HEAL_STATEMENTS,
  type JobRunRow,
  type TickResult,
  type TrackedJobDeps,
} from './jobHealth.js';
import { AlertDeduper } from './cronSafety.js';
import { selfHealTarget } from '../db/migrate.js';

function ledger() {
  const rows: JobRunRow[] = [];
  return { rows, write: async (r: JobRunRow) => void rows.push(r) };
}

describe('recordJobRun — outcome recording', () => {
  it('records a success with its processed count', async () => {
    const l = ledger();
    const out = await recordJobRun('j', () => jobSuccess(7, 'sent 7'), {
      write: l.write,
      now: () => 1000,
    });
    expect(out.status).toBe('success');
    expect(l.rows).toHaveLength(1);
    expect(l.rows[0]).toMatchObject({ job: 'j', status: 'success', processed: 7, detail: 'sent 7' });
  });

  it('records a skipped tick as healthy with no processed count', async () => {
    const l = ledger();
    await recordJobRun('j', () => jobSkipped('not my slot'), { write: l.write });
    expect(l.rows[0]).toMatchObject({ status: 'skipped', processed: null, detail: 'not my slot' });
  });

  it('CATCHES a throw, records it as a failure, and does NOT rethrow', async () => {
    const l = ledger();
    const out = await recordJobRun(
      'j',
      () => {
        throw new Error('boom');
      },
      { write: l.write },
    );
    // Must resolve, not reject — the surrounding setInterval keeps ticking.
    expect(out.status).toBe('failure');
    expect(out.detail).toContain('boom');
    expect(l.rows[0].status).toBe('failure');
  });

  it('records elapsed duration from the injected clock', async () => {
    const l = ledger();
    const times = [5_000, 8_500];
    await recordJobRun('j', () => jobSuccess(1), {
      write: l.write,
      now: () => times.shift() ?? 8_500,
    });
    expect(l.rows[0].durationMs).toBe(3_500);
  });

  it('a ledger write failure is swallowed — the observer never breaks the observed', async () => {
    const log = vi.fn();
    const out = await recordJobRun('j', () => jobSuccess(1), {
      write: async () => {
        throw new Error('db down');
      },
      log,
    });
    expect(out.status).toBe('success');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('ledger write failed'));
  });

  it('truncates an oversized detail rather than storing an essay', () => {
    const long = 'x'.repeat(DETAIL_MAX_CHARS + 200);
    expect(truncateDetail(long)!.length).toBe(DETAIL_MAX_CHARS);
    expect(truncateDetail('  ')).toBeNull();
    expect(truncateDetail(undefined)).toBeNull();
  });
});

describe('outcomeFromTick — the anti-canned-success rule', () => {
  it('maps a failed pass to FAILURE even though it processed nothing', () => {
    const tick: TickResult = { ok: false, processed: 0, detail: 'db unreachable' };
    const out = outcomeFromTick(tick, 'nothing was due');
    // The whole point: "processed 0 because it broke" must NEVER look like
    // "processed 0 because there was nothing to do".
    expect(out.status).toBe('failure');
    expect(out.detail).toBe('db unreachable');
  });

  it('maps a clean pass that did nothing to SKIPPED (healthy heartbeat)', () => {
    const out = outcomeFromTick({ ok: true, processed: 0 }, 'nothing was due');
    expect(out.status).toBe('skipped');
    expect(out.detail).toBe('nothing was due');
  });

  it('maps a clean pass that did work to SUCCESS with the count', () => {
    const out = outcomeFromTick({ ok: true, processed: 3, detail: 'sent 3' }, 'idle');
    expect(out).toEqual({ status: 'success', processed: 3, detail: 'sent 3' });
  });

  it('never loses the failure signal even when items were processed first', () => {
    // A pass that sent 2 emails then threw is still a failed pass.
    const out = outcomeFromTick({ ok: false, processed: 2, detail: 'threw midway' }, 'idle');
    expect(out.status).toBe('failure');
  });
});

describe('runTrackedJob — ledger + de-duped alert', () => {
  function deps(over: Partial<TrackedJobDeps> = {}): TrackedJobDeps {
    return {
      record: vi.fn(async (_job, fn) => fn()),
      sendAlert: vi.fn(async () => {}),
      deduper: new AlertDeduper(),
      cooldownMs: 6 * 60 * 60 * 1000,
      now: () => 0,
      log: vi.fn(),
      ...over,
    };
  }

  it('does NOT alert on success or skipped', async () => {
    const d = deps();
    await runTrackedJob('j', () => jobSuccess(1), d);
    await runTrackedJob('j', () => jobSkipped('idle'), d);
    expect(d.sendAlert).not.toHaveBeenCalled();
  });

  it('alerts on failure, naming the job and carrying the detail', async () => {
    const d = deps();
    await runTrackedJob('fuel-surcharge', () => jobFailure('EIA fetch failed'), d);
    expect(d.sendAlert).toHaveBeenCalledTimes(1);
    const [subject, body] = vi.mocked(d.sendAlert).mock.calls[0];
    expect(subject).toContain('fuel-surcharge');
    expect(body).toContain('EIA fetch failed');
  });

  it('de-dupes repeat failures within the cooldown, then alerts again after it', async () => {
    let clock = 0;
    const d = deps({ now: () => clock });
    for (let i = 0; i < 5; i++) await runTrackedJob('j', () => jobFailure('same'), d);
    expect(d.sendAlert).toHaveBeenCalledTimes(1);
    clock = 6 * 60 * 60 * 1000 + 1;
    await runTrackedJob('j', () => jobFailure('same'), d);
    expect(d.sendAlert).toHaveBeenCalledTimes(2);
  });

  it('de-dupes per job, so one noisy job cannot mask another', async () => {
    const d = deps();
    await runTrackedJob('a', () => jobFailure('x'), d);
    await runTrackedJob('b', () => jobFailure('y'), d);
    expect(d.sendAlert).toHaveBeenCalledTimes(2);
  });

  it('never throws when the alert send itself fails', async () => {
    const d = deps({
      sendAlert: vi.fn(async () => {
        throw new Error('smtp down');
      }),
    });
    await expect(runTrackedJob('j', () => jobFailure('x'), d)).resolves.toMatchObject({
      status: 'failure',
    });
  });
});

describe('job_runs self-heal DDL', () => {
  it('uses only statement shapes the catalog pre-check recognizes', () => {
    // A shape selfHealTarget() cannot parse loses the lock-free pre-check and
    // takes a real lock on every boot — the exact hazard runSelfHealStatements
    // exists to avoid.
    for (const stmt of JOB_RUNS_SELF_HEAL_STATEMENTS) {
      expect(selfHealTarget(stmt)).not.toBeNull();
    }
  });

  it('is idempotent — every statement is IF NOT EXISTS', () => {
    for (const stmt of JOB_RUNS_SELF_HEAL_STATEMENTS) {
      expect(stmt).toMatch(/IF NOT EXISTS/i);
    }
  });

  it('creates the table before the index that references it', () => {
    expect(JOB_RUNS_SELF_HEAL_STATEMENTS[0]).toMatch(/CREATE TABLE IF NOT EXISTS "job_runs"/i);
  });
});
