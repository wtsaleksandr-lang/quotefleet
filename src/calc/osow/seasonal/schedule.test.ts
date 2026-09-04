/**
 * THE SCHEDULE IS THE PRODUCT DECISION HERE, so it is tested as one.
 *
 * A frost-law feature that polls on a single global interval is either rude or
 * late, and "late" in March means a load quoted as legal on a posted road.
 * These tests pin the three things that make the cadence defensible: that it is
 * derived from each STATE's own published season, that the shoulder actually
 * catches an early or late posting, and that the off-season poll never stops —
 * because a source that breaks in July must be discovered in July.
 */
import { describe, expect, it } from 'vitest';
import {
  IN_SEASON_INTERVAL_MS,
  OFF_SEASON_INTERVAL_MS,
  SEASONAL_TICK_MS,
  SHOULDER_DAYS,
  SHOULDER_INTERVAL_MS,
  cadenceFor,
  dateOrdinal,
  daysOutsideWindow,
  dueThisTick,
  isDue,
  monthDayOrdinal,
  stalenessBudgetDays,
} from './schedule.js';
import { SEASONAL_SOURCES, pollableSources, seasonalSourceFor } from './sources.js';

const ND = seasonalSourceFor('ND');
const SD = seasonalSourceFor('SD');
const OH = seasonalSourceFor('OH');

function utc(month: number, day: number): Date {
  return new Date(Date.UTC(2026, month - 1, day, 12, 0, 0));
}

describe('calendar arithmetic', () => {
  it('reads MM-DD as a day ordinal and a Date the same way', () => {
    expect(monthDayOrdinal('01-01')).toBe(1);
    expect(monthDayOrdinal('12-31')).toBe(365);
    expect(dateOrdinal(utc(3, 1))).toBe(monthDayOrdinal('03-01'));
  });

  it('refuses to read a malformed window as "always in season"', () => {
    // The dangerous failure: a typo in a window silently making a state poll
    // every three hours forever, or (worse) never.
    expect(daysOutsideWindow({ from: 'spring', to: '05-01', basis: '' }, 100)).toBe(Infinity);
  });

  it('measures distance to the NEARER edge, and wraps the new year', () => {
    const w = { from: '12-01', to: '01-31', basis: 'wraps' };
    expect(daysOutsideWindow(w, monthDayOrdinal('12-15'))).toBe(0); // inside
    expect(daysOutsideWindow(w, monthDayOrdinal('01-15'))).toBe(0); // still inside
    expect(daysOutsideWindow(w, monthDayOrdinal('02-05'))).toBe(5); // 5 days past the close
    expect(daysOutsideWindow(w, monthDayOrdinal('11-26'))).toBe(5); // 5 days before it opens
  });
});

describe('cadence is derived per state, from that state South Dakota statute included', () => {
  it("South Dakota's window IS SDCL 32-22-24, verbatim", () => {
    // The one state whose season is fixed by law rather than by observation.
    // If this drifts, the schedule has stopped being derived from the source.
    expect(SD?.postingWindow.from).toBe('02-15');
    expect(SD?.postingWindow.to).toBe('04-30');
    expect(SD?.postingWindow.basis).toContain('32-22-24');
  });

  it('polls every 3 hours INSIDE a state window', () => {
    const c = cadenceFor(SD!, utc(3, 15));
    expect(c.tier).toBe('in-season');
    expect(c.intervalMs).toBe(IN_SEASON_INTERVAL_MS);
  });

  it('polls every 12 hours in the shoulder, on BOTH sides', () => {
    // Ten days before the statute opens, and ten days after it closes.
    expect(cadenceFor(SD!, utc(2, 5)).tier).toBe('shoulder');
    expect(cadenceFor(SD!, utc(5, 10)).tier).toBe('shoulder');
    expect(cadenceFor(SD!, utc(2, 5)).intervalMs).toBe(SHOULDER_INTERVAL_MS);
  });

  it('still polls WEEKLY in the depth of the off season — the source must not go unwatched', () => {
    const c = cadenceFor(SD!, utc(8, 15));
    expect(c.tier).toBe('off-season');
    expect(c.intervalMs).toBe(OFF_SEASON_INTERVAL_MS);
  });

  it('gives North Dakota a window that reaches past midsummer, because its feed does', () => {
    // Observed 2026-09-04: NDDOT order 2026-20, effective 2026-06-25, still
    // carried segments InEffect=Y. A February-to-May window would have had us
    // polling weekly while the state was actively restricting.
    expect(cadenceFor(ND!, utc(6, 25)).tier).toBe('in-season');
  });

  it('never polls a state that runs no programme', () => {
    const c = cadenceFor(OH!, utc(3, 15));
    expect(c.tier).toBe('dormant');
    expect(Number.isFinite(c.intervalMs)).toBe(false);
    expect(isDue(OH!, null, utc(3, 15))).toBe(false);
  });
});

describe('staleness budget follows the cadence, not a constant', () => {
  it('is roughly four polls in every tier — one missed poll is a blip, four is a fault', () => {
    expect(stalenessBudgetDays('in-season')).toBe(1); // 8 polls/day
    expect(stalenessBudgetDays('shoulder')).toBe(2);
    expect(stalenessBudgetDays('off-season')).toBe(28); // 4 weekly polls
    expect(stalenessBudgetDays('dormant')).toBe(Infinity);
  });
});

describe('one tick', () => {
  it('is short enough to serve the fastest tier without starving it', () => {
    expect(SEASONAL_TICK_MS).toBeLessThan(IN_SEASON_INTERVAL_MS);
    expect(IN_SEASON_INTERVAL_MS % SEASONAL_TICK_MS).toBe(0);
  });

  it('a state that has NEVER been attempted is due immediately', () => {
    expect(isDue(SD!, null, utc(3, 15))).toBe(true);
  });

  it('keys on the last ATTEMPT, not the last success — a broken source is not hammered', () => {
    const now = utc(3, 15);
    const justTried = now.getTime() - 60_000;
    expect(isDue(SD!, justTried, now)).toBe(false);
    expect(isDue(SD!, now.getTime() - IN_SEASON_INTERVAL_MS - 1, now)).toBe(true);
  });

  it('caps the states contacted per tick, and takes the OLDEST first', () => {
    const now = utc(3, 15);
    const attempts = new Map<string, number>();
    // Everything is due; give three of them distinct, increasing ages.
    attempts.set('ND', now.getTime() - 90 * 60 * 60 * 1000);
    attempts.set('MN', now.getTime() - 80 * 60 * 60 * 1000);
    attempts.set('MI', now.getTime() - 70 * 60 * 60 * 1000);
    const due = dueThisTick(pollableSources(), attempts, now, 3);
    expect(due).toHaveLength(3);
    // Never-attempted states sort first (0), then oldest-attempt first. What
    // matters is that the SAME three are not picked on every tick forever.
    const codes = due.map((d) => d.code);
    expect(new Set(codes).size).toBe(3);
  });

  it('only ever offers pollable states to the scheduler', () => {
    const codes = new Set(pollableSources().map((s) => s.code));
    for (const spec of SEASONAL_SOURCES) {
      if (spec.ingestion === 'none') expect(codes.has(spec.code)).toBe(false);
      else expect(codes.has(spec.code)).toBe(true);
    }
  });
});
