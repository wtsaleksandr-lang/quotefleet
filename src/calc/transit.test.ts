import { describe, expect, it } from 'vitest';
import { estimateTransit } from './transit.js';

describe('estimateTransit', () => {
  it('returns null when distance is unknown or non-positive', () => {
    expect(estimateTransit(null, 'ftl')).toBeNull();
    expect(estimateTransit(undefined, 'ftl')).toBeNull();
    expect(estimateTransit(0, 'ftl')).toBeNull();
    expect(estimateTransit(-50, 'ftl')).toBeNull();
    expect(estimateTransit(NaN, 'ftl')).toBeNull();
  });

  it('treats drayage as same/next business day regardless of distance', () => {
    expect(estimateTransit(30, 'drayage')?.text).toBe('Same or next business day');
    expect(estimateTransit(180, 'drayage')?.text).toBe('Same or next business day');
  });

  it('treats short local hauls as same/next business day', () => {
    expect(estimateTransit(80, 'ftl')?.text).toBe('Same or next business day');
    expect(estimateTransit(100, 'ftl')?.text).toBe('Same or next business day');
  });

  it('gives a standard truckload a distance-scaled window with a pickup-day buffer', () => {
    // 500 mi → ceil(500/500)=1 drive day + 1 pickup day = 2–3
    const short = estimateTransit(500, 'ftl');
    expect(short?.days).toEqual([2, 3]);
    expect(short?.text).toBe('2–3 business days');
    // ~2050 mi → ceil(2050/500)=5 + 1 = 6–7
    const long = estimateTransit(2050, 'ftl');
    expect(long?.days).toEqual([6, 7]);
    expect(long?.text).toBe('6–7 business days');
  });

  it('runs expedited/hotshot faster and without the pickup-day buffer', () => {
    // 500 mi expedited → ceil(500/850)=1, no +1 → 1–2 (faster than the 2–3 TL window)
    expect(estimateTransit(500, 'expedited')?.days).toEqual([1, 2]);
    expect(estimateTransit(1700, 'hotshot')?.days).toEqual([2, 3]);
    // same lane is always at least as fast expedited as standard
    const m = 1200;
    const std = estimateTransit(m, 'ftl')!.days![0];
    const exp = estimateTransit(m, 'expedited')!.days![0];
    expect(exp).toBeLessThan(std);
  });
});
