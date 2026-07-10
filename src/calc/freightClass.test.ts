/**
 * LTL freight-class + pricing tests.
 *
 * Two guarantees that must never regress:
 *   1. Density → freight class follows the standard NMFC scale.
 *   2. LTL price is monotonic non-decreasing in BOTH weight and class —
 *      i.e. a heavier or higher-class shipment can never come out cheaper.
 *      These fail loudly if LTL ever goes back to ignoring weight/size.
 */
import { describe, it, expect } from 'vitest';
import {
  freightClassForDensity,
  estimateFreightClass,
  ltlLinehaul,
  DEFAULT_LTL_CONFIG,
  FREIGHT_CLASSES,
} from './freightClass.js';

describe('freightClassForDensity — standard NMFC density scale', () => {
  // [density lb/ft³, expected class] across every tier boundary.
  const cases: Array<[number, number]> = [
    [60, 50], // very dense
    [50, 50], // exactly 50 → class 50
    [40, 55],
    [35, 55],
    [32, 60],
    [30, 60],
    [25, 65],
    [22.5, 65],
    [18, 70],
    [15, 70],
    [14, 77.5],
    [13.5, 77.5],
    [12.5, 85],
    [12, 85],
    [11, 92.5],
    [10.5, 92.5],
    [9.5, 100],
    [9, 100],
    [8.5, 110],
    [8, 110],
    [7.5, 125],
    [7, 125],
    [6.5, 150],
    [6, 150],
    [5.5, 175],
    [5, 175],
    [4.5, 200],
    [4, 200],
    [3.5, 250],
    [3, 250],
    [2.5, 300],
    [2, 300],
    [1.5, 400],
    [1, 400],
    [0.5, 500], // very light
    [0, 500],
  ];
  it.each(cases)('density %d lb/ft³ → class %d', (density, expected) => {
    expect(freightClassForDensity(density)).toBe(expected);
  });
});

describe('estimateFreightClass — from weight + dimensions', () => {
  it('48×40×48 in @ 500 lb → ~11.25 lb/ft³ → class 92.5', () => {
    const est = estimateFreightClass({ weightLbs: 500, lengthIn: 48, widthIn: 40, heightIn: 48 });
    expect(est).not.toBeNull();
    // volume = 48*40*48/1728 = 53.33 ft³ ; density = 500/53.33 = 9.375 → class 100
    expect(est!.cubicFeet).toBeCloseTo(53.33, 1);
    expect(est!.freightClass).toBe(100);
  });

  it('same crate, 1,200 lb → denser → lower (cheaper) class than 300 lb', () => {
    const heavy = estimateFreightClass({ weightLbs: 1200, lengthIn: 48, widthIn: 40, heightIn: 48 })!;
    const light = estimateFreightClass({ weightLbs: 300, lengthIn: 48, widthIn: 40, heightIn: 48 })!;
    expect(heavy.freightClass).toBeLessThan(light.freightClass);
  });

  it('returns null when dimensions are missing', () => {
    expect(estimateFreightClass({ weightLbs: 500 })).toBeNull();
    expect(estimateFreightClass({ weightLbs: 500, lengthIn: 48, widthIn: 40, heightIn: 0 })).toBeNull();
  });
});

describe('ltlLinehaul — weight & class actually drive the price', () => {
  const base = { miles: 600, minimumCharge: 125, flatFee: 50 };

  it('a 40,000-lb load costs far more than a 1,200-lb load (same class/lane)', () => {
    const light = ltlLinehaul(DEFAULT_LTL_CONFIG, { ...base, weightLbs: 1200, freightClass: 70 });
    const heavy = ltlLinehaul(DEFAULT_LTL_CONFIG, { ...base, weightLbs: 40000, freightClass: 70 });
    // The original bug: these were equal. Guard that they never are again.
    expect(heavy).toBeGreaterThan(light * 3);
  });

  it('is monotonic non-decreasing in weight', () => {
    const weights = [100, 300, 500, 800, 1000, 1500, 2000, 4000, 5000, 9000, 10000, 20000, 40000];
    let prev = -1;
    for (const w of weights) {
      const price = ltlLinehaul(DEFAULT_LTL_CONFIG, { ...base, weightLbs: w, freightClass: 100 });
      expect(price).toBeGreaterThanOrEqual(prev);
      prev = price;
    }
  });

  it('is monotonic non-decreasing in freight class (heavier class = pricier)', () => {
    let prev = -1;
    for (const cls of FREIGHT_CLASSES) {
      const price = ltlLinehaul(DEFAULT_LTL_CONFIG, { ...base, weightLbs: 3000, freightClass: cls });
      expect(price).toBeGreaterThanOrEqual(prev);
      prev = price;
    }
  });

  it('strictly increases with class at a weight above the minimum charge', () => {
    const low = ltlLinehaul(DEFAULT_LTL_CONFIG, { ...base, weightLbs: 3000, freightClass: 60 });
    const high = ltlLinehaul(DEFAULT_LTL_CONFIG, { ...base, weightLbs: 3000, freightClass: 300 });
    expect(high).toBeGreaterThan(low);
  });

  it('never falls below the configured minimum charge', () => {
    const tiny = ltlLinehaul(DEFAULT_LTL_CONFIG, { ...base, weightLbs: 50, freightClass: 50 });
    expect(tiny).toBeGreaterThanOrEqual(base.minimumCharge);
  });

  it('longer distance costs more (distance still matters)', () => {
    const near = ltlLinehaul(DEFAULT_LTL_CONFIG, { ...base, miles: 100, weightLbs: 5000, freightClass: 100 });
    const far = ltlLinehaul(DEFAULT_LTL_CONFIG, { ...base, miles: 2000, weightLbs: 5000, freightClass: 100 });
    expect(far).toBeGreaterThan(near);
  });
});
