/**
 * resolveFeatures — per-tenant widget feature toggle resolution.
 *
 * Locks the defaults (quoteShare ON, quoteBooking OFF) and the null/partial/
 * malformed handling so every surface that reads features stays in sync.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveFeatures,
  sanitizeFeaturesPatch,
  FEATURE_DEFAULTS,
} from './features.js';

describe('resolveFeatures — defaults', () => {
  it('null brand → defaults (share ON, booking OFF)', () => {
    expect(resolveFeatures(null)).toEqual({ quoteShare: true, quoteBooking: false });
  });

  it('null featuresJson column → defaults', () => {
    expect(resolveFeatures({ featuresJson: null })).toEqual(FEATURE_DEFAULTS);
  });

  it('empty featuresJson → defaults', () => {
    expect(resolveFeatures({ featuresJson: {} })).toEqual(FEATURE_DEFAULTS);
  });

  it('the default object is share ON / booking OFF', () => {
    expect(FEATURE_DEFAULTS.quoteShare).toBe(true);
    expect(FEATURE_DEFAULTS.quoteBooking).toBe(false);
  });
});

describe('resolveFeatures — explicit overrides', () => {
  it('quoteShare:false disables the share bar', () => {
    expect(resolveFeatures({ featuresJson: { quoteShare: false } }).quoteShare).toBe(false);
  });

  it('a partial bag keeps the other feature at its default', () => {
    const f = resolveFeatures({ featuresJson: { quoteShare: false } });
    expect(f.quoteBooking).toBe(false); // untouched default
  });

  it('quoteBooking:true opts into the reserved booking feature', () => {
    expect(resolveFeatures({ featuresJson: { quoteBooking: true } }).quoteBooking).toBe(true);
  });
});

describe('resolveFeatures — malformed input never disables a feature by accident', () => {
  it('a non-boolean value is ignored (falls back to default)', () => {
    // e.g. a corrupt/hand-edited column value — must not silently turn share off
    expect(resolveFeatures({ featuresJson: { quoteShare: 'no' as unknown as boolean } }).quoteShare).toBe(true);
  });

  it('unknown keys are dropped from the resolved result', () => {
    const f = resolveFeatures({ featuresJson: { somethingElse: true } as Record<string, boolean> });
    expect(Object.keys(f).sort()).toEqual(['quoteBooking', 'quoteShare']);
  });
});

describe('sanitizeFeaturesPatch — only known boolean keys are persisted', () => {
  it('keeps known boolean keys', () => {
    expect(sanitizeFeaturesPatch({ quoteShare: false })).toEqual({ quoteShare: false });
  });

  it('drops unknown keys', () => {
    expect(sanitizeFeaturesPatch({ quoteShare: true, junk: true })).toEqual({ quoteShare: true });
  });

  it('drops non-boolean values', () => {
    expect(sanitizeFeaturesPatch({ quoteShare: 'yes' })).toBeUndefined();
  });

  it('returns undefined for empty / non-object input', () => {
    expect(sanitizeFeaturesPatch(null)).toBeUndefined();
    expect(sanitizeFeaturesPatch({})).toBeUndefined();
    expect(sanitizeFeaturesPatch('x')).toBeUndefined();
  });
});
