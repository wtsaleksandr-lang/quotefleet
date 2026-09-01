import { describe, it, expect } from 'vitest';
import {
  groupMaxWeightLbs,
  bridgeFormulaRawLbs,
  roundToNearest500TiesDown,
  checkBridgeFormula,
  inferAxleLayout,
  FEDERAL_GROSS_WEIGHT_LIMIT_LBS,
  type Axle,
} from './bridgeFormula.js';

/**
 * FIXTURES ARE PUBLISHED FEDERAL VALUES, NOT VALUES THIS CODE PRODUCED.
 *
 * Sources (all public domain / free):
 *   - FHWA, "Bridge Formula Weights", FHWA-HOP-19-028, August 2019
 *     https://ops.fhwa.dot.gov/Freight/publications/brdg_frm_wghts/index.htm
 *     — the formula, the statutory limits, the 34-34/36-ft exception, and the
 *       two fully worked truck examples asserted below.
 *   - 23 CFR 658.17 / 23 U.S.C. 127(a) — the text of the formula and of W's
 *     "to the nearest 500 pounds" definition.
 *   - Missouri RSMo 304.180 archived table (revisor.mo.gov) — the numeric
 *     table cells. FHWA publishes its own table only as a raster image, so a
 *     state reproduction is the citable numeric source; every cell used here
 *     was independently recomputed against the formula.
 */

describe('the formula itself (23 CFR 658.17(e))', () => {
  it('computes W = 500 × (LN/(N−1) + 12N + 36)', () => {
    // 5 axles over 51 ft: 500 × (255/4 + 60 + 36) = 79,875 raw.
    expect(bridgeFormulaRawLbs(51, 5)).toBeCloseTo(79875, 6);
    // 4 axles over 36 ft: 500 × (144/3 + 48 + 36) = 66,000 exactly.
    expect(bridgeFormulaRawLbs(36, 4)).toBeCloseTo(66000, 6);
  });
});

describe('rounding convention', () => {
  // The published table rounds UP on ordinary values...
  it('rounds to the NEAREST 500, not down', () => {
    expect(roundToNearest500TiesDown(79875)).toBe(80000);
    expect(roundToNearest500TiesDown(65333.33)).toBe(65500);
    expect(roundToNearest500TiesDown(57333.33)).toBe(57500);
  });

  // ...but breaks exact ties DOWNWARD. Math.round would give 43,000 here and
  // permit 500 lb the published table does not.
  it('breaks an exact tie downward', () => {
    expect(roundToNearest500TiesDown(42750)).toBe(42500);
    expect(roundToNearest500TiesDown(51750)).toBe(51500);
    expect(roundToNearest500TiesDown(45750)).toBe(45500);
    expect(roundToNearest500TiesDown(50250)).toBe(50000);
  });

  it('leaves an exact multiple of 500 alone', () => {
    expect(roundToNearest500TiesDown(51000)).toBe(51000);
    expect(roundToNearest500TiesDown(66000)).toBe(66000);
    expect(roundToNearest500TiesDown(80000)).toBe(80000);
  });
});

describe('published Bridge Formula table cells', () => {
  /**
   * [L, N, published W]. Cross-validated between the Missouri reproduction
   * and a cell-by-cell recomputation of the formula.
   */
  const CELLS: Array<[number, number, number]> = [
    // ── N=2 ──
    [4, 2, 34000], // tandem cap
    [8, 2, 34000], // tandem cap — the raw formula says 38,000 here
    [9, 2, 39000],
    [10, 2, 40000],
    [11, 2, 40000], // raw 41,000, held at 40,000 by the 20,000 × N cap
    [30, 2, 40000],
    // ── N=3 ──
    [8, 3, 34000], // the table shows the tandem cap in the N=3 column too
    [9, 3, 42500], // exact tie (42,750) → down
    [10, 3, 43500],
    [13, 3, 45500], // exact tie (45,750) → down
    [19, 3, 50000], // exact tie (50,250) → down
    [20, 3, 51000],
    [21, 3, 51500], // exact tie (51,750) → down
    [32, 3, 60000], // 20,000 × N cap engages
    [40, 3, 60000],
    // ── N=4 ──
    [12, 4, 50000],
    [23, 4, 57500],
    [34, 4, 64500],
    [35, 4, 65500],
    [36, 4, 66000],
    [51, 4, 76000],
    [56, 4, 79500],
    [57, 4, 80000],
    // ── N=5 ──
    [16, 5, 58000],
    [32, 5, 68000],
    [51, 5, 80000], // raw 79,875 → 80,000
    [60, 5, 80000], // raw 85,500 → capped at the 80,000 gross limit
    // ── N=6 / N=7 ──
    [20, 6, 66000],
    [43, 6, 80000],
    [24, 7, 74000],
    [34, 7, 80000],
  ];

  it.each(CELLS)(
    'L=%i ft, N=%i axles → %i lb',
    (lengthFt, axles, expected) => {
      expect(groupMaxWeightLbs(lengthFt, axles)).toBe(expected);
    },
  );

  it('never exceeds 20,000 lb per axle in the group', () => {
    for (let n = 2; n <= 7; n += 1) {
      for (let l = 4; l <= 60; l += 1) {
        expect(groupMaxWeightLbs(l, n)).toBeLessThanOrEqual(20000 * n);
      }
    }
  });

  it('never exceeds the 80,000 lb gross limit', () => {
    for (let n = 2; n <= 9; n += 1) {
      for (let l = 4; l <= 80; l += 1) {
        expect(groupMaxWeightLbs(l, n)).toBeLessThanOrEqual(
          FEDERAL_GROSS_WEIGHT_LIMIT_LBS,
        );
      }
    }
  });

  it('is monotonically non-decreasing as the group spreads out', () => {
    for (let n = 2; n <= 7; n += 1) {
      for (let l = 9; l <= 60; l += 1) {
        expect(groupMaxWeightLbs(l, n)).toBeGreaterThanOrEqual(
          groupMaxWeightLbs(l - 1, n),
        );
      }
    }
  });

  /**
   * L=38 / N=5 is the one cell where the two reproductions disagree: raw
   * 71,750 is an exact tie, Wikipedia prints 71,500 and Missouri 72,000.
   * Every other N=5 tie cell rounds down in BOTH sources, so ties-down (and
   * therefore 71,500) is the defensible reading. Asserted with the dispute
   * recorded here rather than left untested, so that if the rounding rule is
   * ever changed this cell forces the question to be re-answered.
   */
  it('resolves the one disputed table cell by the documented tie rule', () => {
    expect(bridgeFormulaRawLbs(38, 5)).toBeCloseTo(71750, 6);
    expect(groupMaxWeightLbs(38, 5)).toBe(71500);
  });
});

// ── FHWA's own worked examples, asserted end-to-end ────────────────────────

describe('FHWA worked example 1 — 5-axle tractor-semitrailer (Figure 4)', () => {
  // Axle 1 = 12,000 lb; axles 2–5 = 17,000 lb each; gross 80,000 lb.
  // Spacing: steer at 0, drives at 16 and 20, trailer tandems at 47 and 51.
  // That yields the exact group spans FHWA prints: 1–3 = 20 ft, 1–5 = 51 ft,
  // 2–5 = 35 ft.
  const truck: Axle[] = [
    { positionFt: 0, weightLbs: 12000, label: 'steer' },
    { positionFt: 16, weightLbs: 17000, label: 'drive 1' },
    { positionFt: 20, weightLbs: 17000, label: 'drive 2' },
    { positionFt: 47, weightLbs: 17000, label: 'trailer 1' },
    { positionFt: 51, weightLbs: 17000, label: 'trailer 2' },
  ];

  const result = checkBridgeFormula(truck);

  it('checks all 10 consecutive groups — N(N−1)/2, not just adjacent ones', () => {
    expect(result.groupsChecked).toBe(10);
  });

  it('gross is exactly at the 80,000 lb limit', () => {
    expect(result.grossWeightLbs).toBe(80000);
  });

  it('axles 1–3 (20 ft, 3 axles) pass: 46,000 actual vs 51,000 allowed', () => {
    expect(groupMaxWeightLbs(20, 3)).toBe(51000);
    expect(
      result.violations.some((v) => v.firstAxle === 1 && v.lastAxle === 3),
    ).toBe(false);
  });

  it('axles 1–5 (51 ft, 5 axles) pass: 80,000 actual vs 80,000 allowed', () => {
    expect(groupMaxWeightLbs(51, 5)).toBe(80000);
    expect(
      result.violations.some((v) => v.firstAxle === 1 && v.lastAxle === 5),
    ).toBe(false);
  });

  // The whole reason every subset must be checked. Every individual axle is
  // legal, both tandems are legal, gross is legal — and the interior 2–5
  // group is still 2,500 lb over.
  it('CATCHES the 2–5 violation: 68,000 actual vs 65,500 allowed', () => {
    expect(groupMaxWeightLbs(35, 4)).toBe(65500);
    const v = result.violations.find(
      (x) => x.firstAxle === 2 && x.lastAxle === 5,
    );
    expect(v).toBeDefined();
    expect(v?.actualLbs).toBe(68000);
    expect(v?.allowedLbs).toBe(65500);
    expect(v?.overageLbs).toBe(2500);
    expect(v?.spanFt).toBe(35);
    expect(v?.axleCount).toBe(4);
  });

  it('is therefore not compliant, despite passing every headline check', () => {
    expect(result.compliant).toBe(false);
    // No single axle over 20,000, no tandem over 34,000, gross exactly 80,000
    // — an adjacent-groups-only implementation would call this legal.
    expect(result.violations.some((v) => v.rule === 'single-axle')).toBe(false);
    expect(result.violations.some((v) => v.rule === 'gross-weight')).toBe(false);
    expect(result.worstViolation?.overageLbs).toBe(2500);
  });
});

describe('FHWA worked example 2 — single-unit truck (Figure 8)', () => {
  // Axle 1 = 12,000 lb; axles 2–4 = 15,000 lb each; gross 57,000 lb.
  // Group 1–4 = 23 ft, group 2–4 = 9 ft.
  const truck: Axle[] = [
    { positionFt: 0, weightLbs: 12000 },
    { positionFt: 14, weightLbs: 15000 },
    { positionFt: 18.5, weightLbs: 15000 },
    { positionFt: 23, weightLbs: 15000 },
  ];

  const result = checkBridgeFormula(truck);

  it('checks all 6 groups', () => {
    expect(result.groupsChecked).toBe(6);
  });

  it('axles 1–4 (23 ft, 4 axles) pass: 57,000 actual vs 57,500 allowed', () => {
    expect(groupMaxWeightLbs(23, 4)).toBe(57500);
    expect(
      result.violations.some((v) => v.firstAxle === 1 && v.lastAxle === 4),
    ).toBe(false);
  });

  it('CATCHES the 2–4 violation: 45,000 actual vs 42,500 allowed', () => {
    expect(groupMaxWeightLbs(9, 3)).toBe(42500);
    const v = result.violations.find(
      (x) => x.firstAxle === 2 && x.lastAxle === 4,
    );
    expect(v).toBeDefined();
    expect(v?.actualLbs).toBe(45000);
    expect(v?.allowedLbs).toBe(42500);
    expect(v?.overageLbs).toBe(2500);
  });

  it('is not compliant even though gross is 23,000 lb under the limit', () => {
    expect(result.compliant).toBe(false);
    expect(result.grossWeightLbs).toBe(57000);
  });
});

describe('the 34-34 at 36 ft statutory exception', () => {
  /** A standard legal 5-axle van: 12,000 steer + two 34,000 tandems. */
  const legalVan: Axle[] = [
    { positionFt: 0, weightLbs: 12000 },
    { positionFt: 16, weightLbs: 17000 },
    { positionFt: 20, weightLbs: 17000 },
    { positionFt: 52, weightLbs: 17000 },
    { positionFt: 56, weightLbs: 17000 },
  ];

  it('the bare formula would REJECT a legal 5-axle van', () => {
    // Axles 2–5: 4 axles over 36 ft → formula allows 66,000, but the two
    // tandems carry 68,000. Without the exception this rig is "illegal".
    expect(groupMaxWeightLbs(36, 4)).toBe(66000);
  });

  it('the exception makes it compliant', () => {
    const result = checkBridgeFormula(legalVan);
    expect(result.compliant).toBe(true);
    expect(result.grossWeightLbs).toBe(80000);
  });

  it('does not apply below 36 ft between the outer tandem axles', () => {
    const tooTight: Axle[] = [
      { positionFt: 0, weightLbs: 12000 },
      { positionFt: 16, weightLbs: 17000 },
      { positionFt: 20, weightLbs: 17000 },
      { positionFt: 46, weightLbs: 17000 },
      { positionFt: 50, weightLbs: 17000 },
    ];
    const result = checkBridgeFormula(tooTight);
    // Axles 2–5 now span 34 ft: allowed 64,500, actual 68,000.
    const v = result.violations.find(
      (x) => x.firstAxle === 2 && x.lastAxle === 5,
    );
    expect(v?.allowedLbs).toBe(64500);
    expect(result.compliant).toBe(false);
  });

  it('does not apply to a 4-axle group that is not two tandems', () => {
    // Evenly spread axles over 36 ft are not "two consecutive sets of
    // tandem axles", so the 68,000 floor must not be granted.
    const spread: Axle[] = [
      { positionFt: 0, weightLbs: 17000 },
      { positionFt: 12, weightLbs: 17000 },
      { positionFt: 24, weightLbs: 17000 },
      { positionFt: 36, weightLbs: 17000 },
    ];
    const result = checkBridgeFormula(spread);
    const v = result.violations.find(
      (x) => x.firstAxle === 1 && x.lastAxle === 4,
    );
    expect(v).toBeDefined();
    expect(v?.allowedLbs).toBe(66000);
  });
});

describe('statutory axle and gross limits', () => {
  it('flags a single axle over 20,000 lb', () => {
    const result = checkBridgeFormula([
      { positionFt: 0, weightLbs: 22000, label: 'steer' },
      { positionFt: 20, weightLbs: 20000 },
    ]);
    const v = result.violations.find((x) => x.rule === 'single-axle');
    expect(v?.overageLbs).toBe(2000);
    expect(v?.description).toContain('steer');
  });

  it('flags gross over 80,000 lb', () => {
    const heavy: Axle[] = [
      { positionFt: 0, weightLbs: 20000 },
      { positionFt: 16, weightLbs: 20000 },
      { positionFt: 20, weightLbs: 20000 },
      { positionFt: 52, weightLbs: 20000 },
      { positionFt: 56, weightLbs: 20000 },
    ];
    const result = checkBridgeFormula(heavy);
    const v = result.violations.find((x) => x.rule === 'gross-weight');
    expect(v?.actualLbs).toBe(100000);
    expect(v?.overageLbs).toBe(20000);
  });

  it('flags a tandem over 34,000 lb', () => {
    const result = checkBridgeFormula([
      { positionFt: 0, weightLbs: 12000 },
      { positionFt: 16, weightLbs: 18000 },
      { positionFt: 20, weightLbs: 18000 },
    ]);
    const v = result.violations.find(
      (x) => x.firstAxle === 2 && x.lastAxle === 3,
    );
    expect(v?.allowedLbs).toBe(34000);
    expect(v?.actualLbs).toBe(36000);
    expect(v?.rule).toBe('tandem-axle');
  });
});

describe('honest failure', () => {
  it('refuses to judge a vehicle with fewer than two axles', () => {
    const r = checkBridgeFormula([{ positionFt: 0, weightLbs: 12000 }]);
    expect(r.compliant).toBe(false);
    expect(r.requiresManualReview).toBe(true);
    expect(r.warnings[0]).toContain('at least two axles');
  });

  it('refuses to compute on axles that are not in front-to-rear order', () => {
    const r = checkBridgeFormula([
      { positionFt: 0, weightLbs: 12000 },
      { positionFt: 20, weightLbs: 17000 },
      { positionFt: 10, weightLbs: 17000 },
    ]);
    expect(r.requiresManualReview).toBe(true);
    expect(r.warnings[0]).toContain('increase from front to rear');
    expect(r.violations).toHaveLength(0);
  });

  it('will not invent an axle layout from a gross weight', () => {
    // A legal 80,000 lb 5-axle van and an illegal 80,000 lb 3-axle dump truck
    // differ only in spacing. Guessing the spacing guesses the answer.
    expect(inferAxleLayout()).toBeNull();
  });

  it('passes a compliant vehicle with no violations and no warnings', () => {
    const r = checkBridgeFormula([
      { positionFt: 0, weightLbs: 10000 },
      { positionFt: 16, weightLbs: 15000 },
      { positionFt: 20, weightLbs: 15000 },
      { positionFt: 52, weightLbs: 15000 },
      { positionFt: 56, weightLbs: 15000 },
    ]);
    expect(r.compliant).toBe(true);
    expect(r.violations).toEqual([]);
    expect(r.requiresManualReview).toBe(false);
    expect(r.groupsChecked).toBe(10);
  });
});
