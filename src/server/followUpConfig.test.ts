/**
 * resolveFollowUpConfig / sanitizeFollowUpPatch — per-tenant automated
 * follow-up + promo config (Wave 1).
 *
 * Locks the safe defaults (OFF, standard preset), the preset table resolution,
 * the custom-cadence clamping + strict-ordering enforcement, and the sanitizer
 * that gates what the dashboard PUT is allowed to persist. The scheduler/sender
 * is a LATER wave that reuses this exact resolved config, so these lock the
 * timing/discount math it will read.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveFollowUpConfig,
  sanitizeFollowUpPatch,
  FOLLOWUP_DEFAULTS,
  FOLLOWUP_PRESETS,
} from './features.js';

describe('resolveFollowUpConfig — defaults', () => {
  it('null brand → OFF / standard', () => {
    expect(resolveFollowUpConfig(null)).toEqual({
      enabled: false,
      preset: 'standard',
      day1: 2,
      day2: 5,
      day3: 9,
      discountPct: 8,
    });
  });

  it('null featuresJson → defaults', () => {
    expect(resolveFollowUpConfig({ featuresJson: null })).toEqual(FOLLOWUP_DEFAULTS);
  });

  it('featuresJson with no followUp key → defaults', () => {
    expect(resolveFollowUpConfig({ featuresJson: { quoteBooking: true } })).toEqual(FOLLOWUP_DEFAULTS);
  });

  it('the default is OFF, standard, discount saved for last touch', () => {
    expect(FOLLOWUP_DEFAULTS.enabled).toBe(false);
    expect(FOLLOWUP_DEFAULTS.preset).toBe('standard');
    expect(FOLLOWUP_DEFAULTS).toEqual({ enabled: false, preset: 'standard', ...FOLLOWUP_PRESETS.standard });
  });

  it('the preset table matches the marketing spec', () => {
    expect(FOLLOWUP_PRESETS.gentle).toEqual({ day1: 3, day2: 7, day3: 12, discountPct: 5 });
    expect(FOLLOWUP_PRESETS.standard).toEqual({ day1: 2, day2: 5, day3: 9, discountPct: 8 });
    expect(FOLLOWUP_PRESETS.assertive).toEqual({ day1: 1, day2: 3, day3: 6, discountPct: 10 });
  });
});

describe('resolveFollowUpConfig — preset resolution', () => {
  it('a non-custom preset takes its cadence from the table, ignoring stored offsets', () => {
    // Stored offsets are stale/garbage; the preset table must win.
    expect(
      resolveFollowUpConfig({
        featuresJson: { followUp: { enabled: true, preset: 'assertive', day1: 99, day2: 99, day3: 99, discountPct: 99 } },
      }),
    ).toEqual({ enabled: true, preset: 'assertive', day1: 1, day2: 3, day3: 6, discountPct: 10 });
  });

  it('gentle preset resolves', () => {
    expect(resolveFollowUpConfig({ featuresJson: { followUp: { enabled: true, preset: 'gentle' } } })).toEqual({
      enabled: true,
      preset: 'gentle',
      day1: 3,
      day2: 7,
      day3: 12,
      discountPct: 5,
    });
  });

  it('an unknown preset falls back to standard', () => {
    expect(resolveFollowUpConfig({ featuresJson: { followUp: { preset: 'wild' } } }).preset).toBe('standard');
  });

  it('enabled is only true for a literal true', () => {
    expect(resolveFollowUpConfig({ featuresJson: { followUp: { enabled: 'yes' } } }).enabled).toBe(false);
    expect(resolveFollowUpConfig({ featuresJson: { followUp: { enabled: true } } }).enabled).toBe(true);
  });

  it('non-object followUp → defaults', () => {
    expect(resolveFollowUpConfig({ featuresJson: { followUp: 'nope' as unknown as object } })).toEqual(FOLLOWUP_DEFAULTS);
  });
});

describe('resolveFollowUpConfig — custom cadence', () => {
  it('a valid custom cadence resolves as stored', () => {
    expect(
      resolveFollowUpConfig({
        featuresJson: { followUp: { enabled: true, preset: 'custom', day1: 4, day2: 8, day3: 20, discountPct: 15 } },
      }),
    ).toEqual({ enabled: true, preset: 'custom', day1: 4, day2: 8, day3: 20, discountPct: 15 });
  });

  it('custom offsets are forced strictly increasing', () => {
    const c = resolveFollowUpConfig({
      featuresJson: { followUp: { preset: 'custom', day1: 10, day2: 5, day3: 5, discountPct: 20 } },
    });
    expect(c.day1).toBeLessThan(c.day2);
    expect(c.day2).toBeLessThan(c.day3);
  });

  it('custom offsets are capped at 30 and floored at 1', () => {
    const c = resolveFollowUpConfig({
      featuresJson: { followUp: { preset: 'custom', day1: 0, day2: 999, day3: 999, discountPct: 5 } },
    });
    expect(c.day1).toBeGreaterThanOrEqual(1);
    expect(c.day3).toBeLessThanOrEqual(30);
    expect(c.day1).toBeLessThan(c.day2);
    expect(c.day2).toBeLessThan(c.day3);
  });

  it('custom discount is clamped 0–90', () => {
    expect(resolveFollowUpConfig({ featuresJson: { followUp: { preset: 'custom', discountPct: 250 } } }).discountPct).toBe(90);
    expect(resolveFollowUpConfig({ featuresJson: { followUp: { preset: 'custom', discountPct: -5 } } }).discountPct).toBe(8); // invalid → standard fallback
  });
});

describe('sanitizeFollowUpPatch — only a valid followUp object is persisted', () => {
  it('keeps a valid preset patch (cadence pulled from the table)', () => {
    expect(sanitizeFollowUpPatch({ enabled: true, preset: 'gentle' })).toEqual({
      enabled: true,
      preset: 'gentle',
      day1: 3,
      day2: 7,
      day3: 12,
      discountPct: 5,
    });
  });

  it('a non-custom preset ignores any offsets sent alongside it', () => {
    expect(sanitizeFollowUpPatch({ enabled: true, preset: 'standard', day1: 99, day3: 1 })).toEqual({
      enabled: true,
      preset: 'standard',
      ...FOLLOWUP_PRESETS.standard,
    });
  });

  it('clamps + orders a custom cadence and clamps the discount', () => {
    const out = sanitizeFollowUpPatch({ enabled: true, preset: 'custom', day1: 0, day2: 2, day3: 2, discountPct: 999 })!;
    expect(out.preset).toBe('custom');
    expect(out.enabled).toBe(true);
    // Strictly increasing, all within 1–30, even from an out-of-order/invalid input.
    expect(out.day1).toBeGreaterThanOrEqual(1);
    expect(out.day1).toBeLessThan(out.day2);
    expect(out.day2).toBeLessThan(out.day3);
    expect(out.day3).toBeLessThanOrEqual(30);
    expect(out.discountPct).toBe(90); // clamped from 999
  });

  it('keeps a fully-valid custom cadence exactly', () => {
    expect(sanitizeFollowUpPatch({ enabled: false, preset: 'custom', day1: 4, day2: 8, day3: 20, discountPct: 12 })).toEqual({
      enabled: false,
      preset: 'custom',
      day1: 4,
      day2: 8,
      day3: 20,
      discountPct: 12,
    });
  });

  it('coerces an unknown preset to standard', () => {
    expect(sanitizeFollowUpPatch({ enabled: true, preset: 'junk' })!.preset).toBe('standard');
  });

  it('enabled defaults to false when not a literal true', () => {
    expect(sanitizeFollowUpPatch({ preset: 'gentle' })!.enabled).toBe(false);
    expect(sanitizeFollowUpPatch({ enabled: 'on', preset: 'gentle' })!.enabled).toBe(false);
  });

  it('returns undefined for empty / non-object / unrelated input', () => {
    expect(sanitizeFollowUpPatch(undefined)).toBeUndefined();
    expect(sanitizeFollowUpPatch(null)).toBeUndefined();
    expect(sanitizeFollowUpPatch({})).toBeUndefined();
    expect(sanitizeFollowUpPatch('x')).toBeUndefined();
  });
});
