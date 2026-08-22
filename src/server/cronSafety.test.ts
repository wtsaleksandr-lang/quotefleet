/**
 * Unit tests for the cron worker-failure alerting wrapper.
 *
 * All seams (now / timers / alert-send / de-dupe) are injected — no real timers,
 * no email, no crons. We assert: a throwing fn is caught + never rethrown + is
 * alerted; the de-dupe sends at most once per cooldown then again after it; and
 * a slow run (watchdog fired) is alerted while the fn keeps running.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  AlertDeduper,
  runCronSafely,
  type CronSafetyDeps,
} from './cronSafety.js';

/** A fake scheduler that captures the watchdog callback so a test can fire it
 *  synchronously (simulating a slow run) instead of waiting real time. */
function fakeScheduler() {
  let captured: (() => void) | null = null;
  return {
    captured: () => captured,
    scheduleTimer: (fn: () => void, _ms: number) => {
      captured = fn;
      return { id: 1 };
    },
    cancelTimer: vi.fn(),
  };
}

function mockDeps(over: Partial<CronSafetyDeps> = {}): CronSafetyDeps {
  const sched = fakeScheduler();
  return {
    now: () => 0,
    log: vi.fn(),
    sendAlert: vi.fn(async () => {}),
    deduper: new AlertDeduper(),
    alertCooldownMs: 6 * 60 * 60 * 1000,
    slowRunMs: 15 * 60 * 1000,
    scheduleTimer: sched.scheduleTimer,
    cancelTimer: sched.cancelTimer,
    ...over,
  };
}

describe('runCronSafely — throwing fn', () => {
  it('catches the throw, does NOT rethrow, returns false, and alerts once', async () => {
    const sendAlert = vi.fn(async (_subject: string, _body: string) => {});
    const deps = mockDeps({ sendAlert });
    const fn = vi.fn(async () => {
      throw new Error('boom');
    });

    // Must resolve (not reject) — the scheduler keeps ticking.
    const ok = await runCronSafely('cron-a', fn, deps);

    expect(ok).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sendAlert).toHaveBeenCalledTimes(1);
    const [subject, body] = sendAlert.mock.calls[0];
    expect(subject).toContain('cron-a');
    expect(body).toContain('boom');
  });

  it('completes cleanly and does not alert when fn succeeds', async () => {
    const sendAlert = vi.fn(async (_subject: string, _body: string) => {});
    const cancelTimer = vi.fn();
    const deps = mockDeps({ sendAlert, cancelTimer });
    const ok = await runCronSafely('cron-ok', async () => {}, deps);

    expect(ok).toBe(true);
    expect(sendAlert).not.toHaveBeenCalled();
    // Watchdog cancelled on clean, fast completion.
    expect(cancelTimer).toHaveBeenCalledTimes(1);
  });
});

describe('runCronSafely — alert de-dupe', () => {
  it('alerts once within the cooldown, then again after it elapses', async () => {
    const sendAlert = vi.fn(async (_subject: string, _body: string) => {});
    const deduper = new AlertDeduper();
    const cooldown = 6 * 60 * 60 * 1000;
    let clock = 0;
    const failing = async () => {
      throw new Error('still broken');
    };

    // t=0: first failure → alert.
    await runCronSafely('cron-b', failing, {
      ...mockDeps({ sendAlert, deduper }),
      now: () => clock,
      alertCooldownMs: cooldown,
    });
    // t=+1h: second failure inside cooldown → suppressed.
    clock = 60 * 60 * 1000;
    await runCronSafely('cron-b', failing, {
      ...mockDeps({ sendAlert, deduper }),
      now: () => clock,
      alertCooldownMs: cooldown,
    });
    expect(sendAlert).toHaveBeenCalledTimes(1);

    // t=+7h: cooldown elapsed → alert again.
    clock = 7 * 60 * 60 * 1000;
    await runCronSafely('cron-b', failing, {
      ...mockDeps({ sendAlert, deduper }),
      now: () => clock,
      alertCooldownMs: cooldown,
    });
    expect(sendAlert).toHaveBeenCalledTimes(2);
  });

  it('keeps error and slow alerts on separate de-dupe keys', () => {
    const deduper = new AlertDeduper();
    expect(deduper.shouldAlert('cron-c:error', 0, 1000)).toBe(true);
    // Same time, different kind → not suppressed by the error alert.
    expect(deduper.shouldAlert('cron-c:slow', 0, 1000)).toBe(true);
    // Repeat error within cooldown → suppressed.
    expect(deduper.shouldAlert('cron-c:error', 500, 1000)).toBe(false);
  });
});

describe('runCronSafely — slow run watchdog', () => {
  it('fires a slow alert when the run exceeds slowRunMs, while fn keeps running', async () => {
    const sendAlert = vi.fn(async (_subject: string, _body: string) => {});
    const sched = fakeScheduler();
    // A fn that stays pending until we resolve it.
    let release!: () => void;
    const pending = new Promise<void>((res) => {
      release = res;
    });

    const runPromise = runCronSafely('cron-slow', () => pending, {
      ...mockDeps({ sendAlert }),
      scheduleTimer: sched.scheduleTimer,
      cancelTimer: sched.cancelTimer,
    });

    // Simulate the watchdog firing (run exceeded slowRunMs) while fn is pending.
    const watchdog = sched.captured();
    expect(watchdog).toBeTypeOf('function');
    watchdog!();
    // Let the async issueAlert microtasks flush.
    await Promise.resolve();
    await Promise.resolve();

    expect(sendAlert).toHaveBeenCalledTimes(1);
    expect(sendAlert.mock.calls[0][0]).toContain('slow');

    // fn finally completes — no throw, resolves true; the slow-fired watchdog
    // is NOT re-cancelled (already fired).
    release();
    const ok = await runPromise;
    expect(ok).toBe(true);
    expect(sched.cancelTimer).not.toHaveBeenCalled();
  });
});
