/**
 * resolveBookingConfig / computeDeposit / sanitizeBookingPatch — per-tenant
 * booking deposit config (Wave 2a).
 *
 * Locks the safe defaults (deposit 'none'), the NaN/negative/out-of-range
 * guards, the percent/fixed/none math, and the sanitizer that gates what the
 * dashboard PUT is allowed to persist. Payment CHARGE is Wave 2b — these lock
 * the money math that 2b (Stripe) will reuse verbatim.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveBookingConfig,
  computeDeposit,
  sanitizeBookingPatch,
  BOOKING_DEFAULTS,
} from './features.js';

describe('resolveBookingConfig — defaults', () => {
  it('null brand → no deposit', () => {
    expect(resolveBookingConfig(null)).toEqual({ depositType: 'none', depositValue: 0 });
  });

  it('null featuresJson → defaults', () => {
    expect(resolveBookingConfig({ featuresJson: null })).toEqual(BOOKING_DEFAULTS);
  });

  it('featuresJson with no booking key → defaults', () => {
    expect(resolveBookingConfig({ featuresJson: { quoteBooking: true } })).toEqual(BOOKING_DEFAULTS);
  });

  it('the default is none / 0', () => {
    expect(BOOKING_DEFAULTS).toEqual({ depositType: 'none', depositValue: 0 });
  });
});

describe('resolveBookingConfig — explicit config', () => {
  it('percent config resolves', () => {
    expect(resolveBookingConfig({ featuresJson: { booking: { depositType: 'percent', depositValue: 10 } } }))
      .toEqual({ depositType: 'percent', depositValue: 10 });
  });

  it('fixed config resolves', () => {
    expect(resolveBookingConfig({ featuresJson: { booking: { depositType: 'fixed', depositValue: 150 } } }))
      .toEqual({ depositType: 'fixed', depositValue: 150 });
  });

  it('percent is capped at 100', () => {
    expect(resolveBookingConfig({ featuresJson: { booking: { depositType: 'percent', depositValue: 250 } } }))
      .toEqual({ depositType: 'percent', depositValue: 100 });
  });
});

describe('resolveBookingConfig — malformed input never mints a bogus deposit', () => {
  it('unknown depositType → none', () => {
    expect(resolveBookingConfig({ featuresJson: { booking: { depositType: 'wild', depositValue: 10 } } }).depositType).toBe('none');
  });

  it('negative depositValue → 0', () => {
    expect(resolveBookingConfig({ featuresJson: { booking: { depositType: 'fixed', depositValue: -50 } } }).depositValue).toBe(0);
  });

  it('NaN depositValue → 0', () => {
    expect(resolveBookingConfig({ featuresJson: { booking: { depositType: 'fixed', depositValue: NaN } } }).depositValue).toBe(0);
  });

  it('non-object booking → defaults', () => {
    expect(resolveBookingConfig({ featuresJson: { booking: 'nope' as unknown as object } })).toEqual(BOOKING_DEFAULTS);
  });
});

describe('computeDeposit', () => {
  it('none → 0 regardless of total', () => {
    expect(computeDeposit(1000, { depositType: 'none', depositValue: 0 })).toBe(0);
    expect(computeDeposit(1000, { depositType: 'none', depositValue: 50 })).toBe(0);
  });

  it('percent of total, rounded to cents', () => {
    expect(computeDeposit(1000, { depositType: 'percent', depositValue: 10 })).toBe(100);
    expect(computeDeposit(1234.56, { depositType: 'percent', depositValue: 10 })).toBe(123.46);
  });

  it('fixed amount, rounded to cents', () => {
    expect(computeDeposit(1000, { depositType: 'fixed', depositValue: 150 })).toBe(150);
    expect(computeDeposit(50, { depositType: 'fixed', depositValue: 150 })).toBe(150); // independent of total
  });

  it('guards a NaN / negative / zero total for percent → 0', () => {
    expect(computeDeposit(NaN, { depositType: 'percent', depositValue: 10 })).toBe(0);
    expect(computeDeposit(-500, { depositType: 'percent', depositValue: 10 })).toBe(0);
    expect(computeDeposit(0, { depositType: 'percent', depositValue: 10 })).toBe(0);
  });

  it('guards a NaN / negative deposit value → 0', () => {
    expect(computeDeposit(1000, { depositType: 'percent', depositValue: NaN })).toBe(0);
    expect(computeDeposit(1000, { depositType: 'fixed', depositValue: -1 })).toBe(0);
  });
});

describe('sanitizeBookingPatch — only a valid booking object is persisted', () => {
  it('keeps a valid percent patch', () => {
    expect(sanitizeBookingPatch({ depositType: 'percent', depositValue: 10 }))
      .toEqual({ depositType: 'percent', depositValue: 10 });
  });

  it('coerces an unknown type to none and clamps negatives', () => {
    expect(sanitizeBookingPatch({ depositType: 'junk', depositValue: -5 }))
      .toEqual({ depositType: 'none', depositValue: 0 });
  });

  it('caps a percent value at 100', () => {
    expect(sanitizeBookingPatch({ depositType: 'percent', depositValue: 999 }))
      .toEqual({ depositType: 'percent', depositValue: 100 });
  });

  it('returns undefined for empty / non-object / unrelated input', () => {
    expect(sanitizeBookingPatch(undefined)).toBeUndefined();
    expect(sanitizeBookingPatch(null)).toBeUndefined();
    expect(sanitizeBookingPatch({})).toBeUndefined();
    expect(sanitizeBookingPatch('x')).toBeUndefined();
  });
});
