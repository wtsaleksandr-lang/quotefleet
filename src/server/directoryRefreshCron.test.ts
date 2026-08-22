/**
 * Scheduling-predicate tests for the weekly FMCSA directory-refresh cron.
 * Pure — no timers, no DB, no network. We only assert WHEN the weekly re-ingest
 * is allowed to fire (correct slot + cooldown gating).
 */
import { describe, expect, it } from 'vitest';
import {
  REFRESH_DOW,
  REFRESH_HOUR,
  REFRESH_COOLDOWN_MS,
  shouldRunWeeklyRefresh,
} from './directoryRefreshCron.js';

/** A Date at the exact weekly slot (Sunday 09:00 UTC). */
function slotDate(): Date {
  // 2026-08-23 is a Sunday.
  const d = new Date(Date.UTC(2026, 7, 23, REFRESH_HOUR, 0, 0));
  expect(d.getUTCDay()).toBe(REFRESH_DOW);
  return d;
}

describe('shouldRunWeeklyRefresh', () => {
  it('fires in the weekly slot when never run before', () => {
    expect(shouldRunWeeklyRefresh(slotDate(), undefined)).toBe(true);
  });

  it('does NOT fire on the wrong day', () => {
    const d = new Date(Date.UTC(2026, 7, 24, REFRESH_HOUR, 0, 0)); // Monday
    expect(shouldRunWeeklyRefresh(d, undefined)).toBe(false);
  });

  it('does NOT fire on the wrong hour', () => {
    const d = new Date(Date.UTC(2026, 7, 23, REFRESH_HOUR + 1, 0, 0)); // Sun 10:00
    expect(shouldRunWeeklyRefresh(d, undefined)).toBe(false);
  });

  it('suppresses a second run inside the cooldown window', () => {
    const now = slotDate();
    const lastRun = now.getTime() - 60 * 60 * 1000; // 1h ago
    expect(shouldRunWeeklyRefresh(now, lastRun)).toBe(false);
  });

  it('fires again once the cooldown has fully elapsed', () => {
    const now = slotDate();
    const lastRun = now.getTime() - (REFRESH_COOLDOWN_MS + 1);
    expect(shouldRunWeeklyRefresh(now, lastRun)).toBe(true);
  });
});
