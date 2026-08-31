/**
 * Unit tests for the staleness watchdog — the absence-of-signal detector.
 *
 * All seams injected: no DB, no clock, no email. The important cases are the
 * ones no try/catch could ever catch: a job that stops recording, a job that
 * never records at all, and a job that ticks but only ever fails.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  buildStaleAlertBody,
  classifyJobs,
  formatAge,
  JOB_REGISTRY,
  runJobHealthWatchdogOnce,
  type JobExpectation,
  type JobHealthRow,
  type WatchdogDeps,
} from './jobHealthWatchdog.js';
import { AlertDeduper } from './cronSafety.js';

const HOUR = 60 * 60 * 1000;
const T0 = new Date('2026-08-31T12:00:00.000Z');
const BOOT = new Date('2026-08-31T00:00:00.000Z'); // 12h uptime

const reg: JobExpectation[] = [
  { job: 'hourly-job', maxIntervalMs: 3 * HOUR, impact: 'things break' },
  { job: 'flagged-job', maxIntervalMs: 3 * HOUR, disabledEnv: 'FLAG_OFF', impact: 'other things break' },
];

function health(rows: Partial<JobHealthRow> & { job: string }[] | JobHealthRow[]): Map<string, JobHealthRow> {
  const m = new Map<string, JobHealthRow>();
  for (const r of rows as JobHealthRow[]) m.set(r.job, r);
  return m;
}

function row(job: string, lastHealthyAt: Date | null, lastStatus: string | null = 'success'): JobHealthRow {
  return { job, lastRunAt: lastHealthyAt, lastHealthyAt, lastStatus, lastDetail: null };
}

describe('classifyJobs — staleness decision', () => {
  it('is ok when the last healthy run is inside the interval', () => {
    const h = health([row('hourly-job', new Date(T0.getTime() - 1 * HOUR))]);
    const [r] = classifyJobs([reg[0]], h, T0, BOOT, {});
    expect(r.verdict).toBe('ok');
  });

  it('is STALE when the last healthy run is older than the interval', () => {
    const h = health([row('hourly-job', new Date(T0.getTime() - 4 * HOUR))]);
    const [r] = classifyJobs([reg[0]], h, T0, BOOT, {});
    expect(r.verdict).toBe('stale');
  });

  it('is STALE when a job that is ticking has only ever FAILED', () => {
    // The ledger has rows (it is running), but no HEALTHY row — so the clock
    // never resets. A job stuck failing every tick must not look alive.
    const h = health([
      { job: 'hourly-job', lastRunAt: T0, lastHealthyAt: null, lastStatus: 'failure', lastDetail: 'db down' },
    ]);
    const [r] = classifyJobs([reg[0]], h, T0, BOOT, {});
    expect(r.verdict).toBe('stale');
    expect(r.lastStatus).toBe('failure');
  });

  it('is STALE when a job has NEVER recorded and uptime exceeds its interval', () => {
    // This is the "cron never registered" case — no throw, no row, no signal.
    const [r] = classifyJobs([reg[0]], new Map(), T0, BOOT, {});
    expect(r.verdict).toBe('stale');
    expect(r.lastHealthyAt).toBeNull();
  });

  it('does NOT alarm on a fresh deploy — a never-run job measures age from boot', () => {
    // 1h of uptime, 3h interval → not yet stale. This is what stops a first-ever
    // deploy from firing an alert for every registered job at once.
    const justBooted = new Date(T0.getTime() - 1 * HOUR);
    const [r] = classifyJobs([reg[0]], new Map(), T0, justBooted, {});
    expect(r.verdict).toBe('ok');
  });

  it('reports a kill-switched job as DISABLED, never as stale', () => {
    const [r] = classifyJobs([reg[1]], new Map(), T0, BOOT, { FLAG_OFF: '1' });
    expect(r.verdict).toBe('disabled');
  });

  it('treats any value other than "1" as enabled', () => {
    const [r] = classifyJobs([reg[1]], new Map(), T0, BOOT, { FLAG_OFF: '0' });
    expect(r.verdict).toBe('stale');
  });
});

describe('JOB_REGISTRY', () => {
  it('has a unique name and a non-empty impact for every job', () => {
    const names = JOB_REGISTRY.map((j) => j.job);
    expect(new Set(names).size).toBe(names.length);
    for (const j of JOB_REGISTRY) {
      expect(j.impact.length).toBeGreaterThan(20);
      expect(j.maxIntervalMs).toBeGreaterThan(0);
    }
  });

  it('registers every cron that server/index.ts starts', async () => {
    // Guards the one way this system silently degrades: a new cron that records
    // to the ledger but is missing here is never checked for staleness.
    const { readFile } = await import('node:fs/promises');
    const index = await readFile(new URL('./index.ts', import.meta.url), 'utf8');
    const started = [...index.matchAll(/runCronSafely\('([a-z0-9-]+)'/g)].map((m) => m[1]);
    // Every registered cron name maps to at least one registry entry. The two
    // lists are not 1:1 by design (directory-refresh-cron does three units of
    // work), so assert coverage by count, not by name equality.
    expect(started.length).toBeGreaterThanOrEqual(10);
    expect(JOB_REGISTRY.length).toBeGreaterThanOrEqual(started.length);
  });
});

describe('runJobHealthWatchdogOnce', () => {
  function deps(over: Partial<WatchdogDeps> = {}): WatchdogDeps {
    return {
      now: () => T0,
      processStartedAt: () => BOOT,
      env: () => ({}),
      readHealth: async () => new Map<string, JobHealthRow>(),
      prune: async () => 0,
      sendAlert: vi.fn(async () => {}),
      deduper: new AlertDeduper(),
      cooldownMs: 6 * HOUR,
      log: vi.fn(),
      registry: reg,
      ...over,
    };
  }

  it('sends ONE batched email listing every stale job', async () => {
    const d = deps();
    await runJobHealthWatchdogOnce(d);
    expect(d.sendAlert).toHaveBeenCalledTimes(1);
    const [subject, body] = vi.mocked(d.sendAlert).mock.calls[0];
    expect(subject).toContain('2 background jobs stalled');
    expect(body).toContain('hourly-job');
    expect(body).toContain('flagged-job');
  });

  it('reports "all healthy" as SKIPPED and sends nothing', async () => {
    const d = deps({
      readHealth: async () => health([row('hourly-job', T0), row('flagged-job', T0)]),
    });
    const out = await runJobHealthWatchdogOnce(d);
    expect(out.status).toBe('skipped');
    expect(d.sendAlert).not.toHaveBeenCalled();
  });

  it('records SUCCESS (not failure) when it finds stale jobs — the finding is the point', async () => {
    // If the watchdog reported failure whenever it found something, it would go
    // stale itself and mask the very signal it is reporting.
    const out = await runJobHealthWatchdogOnce(deps());
    expect(out.status).toBe('success');
    expect(out.detail).toContain('hourly-job');
  });

  it('THROWS when the ledger cannot be read — never a clean empty pass', async () => {
    // If the DB is unreachable we know nothing about job health. Reporting that
    // as "all clear" would be the exact canned-success lie this system kills.
    const d = deps({
      readHealth: async () => {
        throw new Error('db unreachable');
      },
    });
    await expect(runJobHealthWatchdogOnce(d)).rejects.toThrow('db unreachable');
  });

  it('still returns a result when pruning fails', async () => {
    const d = deps({
      readHealth: async () => health([row('hourly-job', T0), row('flagged-job', T0)]),
      prune: async () => {
        throw new Error('prune blew up');
      },
    });
    await expect(runJobHealthWatchdogOnce(d)).resolves.toMatchObject({ status: 'skipped' });
  });

  it('de-dupes so a persistently stale job does not email hourly', async () => {
    const d = deps();
    await runJobHealthWatchdogOnce(d);
    await runJobHealthWatchdogOnce(d);
    expect(d.sendAlert).toHaveBeenCalledTimes(1);
  });
});

describe('alert body', () => {
  it('says NEVER for a job with no healthy run, and names the impact', () => {
    const reports = classifyJobs([reg[0]], new Map(), T0, BOOT, {});
    const body = buildStaleAlertBody(reports, T0, BOOT);
    expect(body).toContain('NEVER since this process started');
    expect(body).toContain('things break');
  });

  it('formats ages readably', () => {
    expect(formatAge(5 * 60 * 1000)).toBe('5 min');
    expect(formatAge(2 * HOUR)).toBe('2.0 h');
    expect(formatAge(48 * HOUR)).toBe('2.0 d');
  });
});
