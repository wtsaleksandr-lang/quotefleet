import { describe, it, expect } from 'vitest';
import {
  groupMaxWeightLbs,
  bridgeFormulaRawLbs,
  roundToNearest500TiesDown,
  checkBridgeFormula,
  inferAxleLayout,
  tableSpanFt,
  FEDERAL_GROSS_WEIGHT_LIMIT_LBS,
  FEDERAL_SINGLE_AXLE_LIMIT_LBS,
  FEDERAL_TANDEM_AXLE_LIMIT_LBS,
  TANDEM_MAX_SPACING_FT,
  FHWA_TABLE_ERRATA,
  type Axle,
} from './bridgeFormula.js';

/**
 * A gross weight above every value the published table reaches, so the
 * vehicle-gross cap cannot bind and the assertion is about the TABLE alone.
 * `MAX_SAFE_INTEGER` rather than some large round number, so there is no magic
 * figure a reader has to check against the table's own maximum.
 */
const NO_GROSS_CAP = Number.MAX_SAFE_INTEGER;

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
    // The table does NOT stop at 80,000 — 80,000 lb is the federal limit on an
    // UNPERMITTED vehicle, and the bridge formula is what a permit is priced
    // against. This cell read 80,000 while the code clamped there; both were
    // wrong. See `the vehicle-gross cap` below.
    [60, 5, 85500],
    // ── N=6 / N=7 ──
    [20, 6, 66000],
    [43, 6, 80000], // the N=6 column happens to CROSS 80,000 here
    [24, 7, 74000],
    [34, 7, 80000],
  ];

  it.each(CELLS)(
    'L=%i ft, N=%i axles → %i lb',
    (lengthFt, axles, expected) => {
      expect(groupMaxWeightLbs(lengthFt, axles, NO_GROSS_CAP)).toBe(expected);
    },
  );

  it('never exceeds 20,000 lb per axle in the group', () => {
    for (let n = 2; n <= 7; n += 1) {
      for (let l = 4; l <= 60; l += 1) {
        expect(groupMaxWeightLbs(l, n, NO_GROSS_CAP)).toBeLessThanOrEqual(
          20000 * n,
        );
      }
    }
  });

  /**
   * This test used to assert the opposite — that no group's allowance ever
   * exceeds 80,000 lb — and it passed because the code clamped there. Both were
   * describing an unpermitted vehicle. FHWA's own table prints 105,500 lb at
   * L=60/N=9, and a permitted load is exactly what this engine prices.
   */
  it('DOES exceed 80,000 lb where the published table does', () => {
    expect(groupMaxWeightLbs(60, 9, NO_GROSS_CAP)).toBe(105500);
    expect(groupMaxWeightLbs(60, 9, NO_GROSS_CAP)).toBeGreaterThan(
      FEDERAL_GROSS_WEIGHT_LIMIT_LBS,
    );
  });

  it('never exceeds the weight the vehicle actually carries', () => {
    const over: Array<[number, number, number, number]> = [];
    for (let gross = 20000; gross <= 200000; gross += 10000) {
      for (let n = 2; n <= 9; n += 1) {
        for (let l = 4; l <= 80; l += 1) {
          const allowed = groupMaxWeightLbs(l, n, gross);
          if (allowed > gross) over.push([l, n, gross, allowed]);
        }
      }
    }
    expect(over).toEqual([]);
  });

  it('is monotonically non-decreasing as the group spreads out', () => {
    for (let n = 2; n <= 7; n += 1) {
      for (let l = 9; l <= 60; l += 1) {
        expect(groupMaxWeightLbs(l, n, NO_GROSS_CAP)).toBeGreaterThanOrEqual(
          groupMaxWeightLbs(l - 1, n, NO_GROSS_CAP),
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
    expect(groupMaxWeightLbs(38, 5, NO_GROSS_CAP)).toBe(71500);
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
    expect(groupMaxWeightLbs(20, 3, 80000)).toBe(51000);
    expect(
      result.violations.some((v) => v.firstAxle === 1 && v.lastAxle === 3),
    ).toBe(false);
  });

  it('axles 1–5 (51 ft, 5 axles) pass: 80,000 actual vs 80,000 allowed', () => {
    expect(groupMaxWeightLbs(51, 5, 80000)).toBe(80000);
    expect(
      result.violations.some((v) => v.firstAxle === 1 && v.lastAxle === 5),
    ).toBe(false);
  });

  // The whole reason every subset must be checked. Every individual axle is
  // legal, both tandems are legal, gross is legal — and the interior 2–5
  // group is still 2,500 lb over.
  it('CATCHES the 2–5 violation: 68,000 actual vs 65,500 allowed', () => {
    expect(groupMaxWeightLbs(35, 4, 80000)).toBe(65500);
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
    expect(groupMaxWeightLbs(23, 4, NO_GROSS_CAP)).toBe(57500);
    expect(
      result.violations.some((v) => v.firstAxle === 1 && v.lastAxle === 4),
    ).toBe(false);
  });

  it('CATCHES the 2–4 violation: 45,000 actual vs 42,500 allowed', () => {
    expect(groupMaxWeightLbs(9, 3, 57000)).toBe(42500);
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
    expect(groupMaxWeightLbs(36, 4, 80000)).toBe(66000);
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

// ── The whole published table, cell by cell ────────────────────────────────

/**
 * EVERY cell FHWA publishes, transcribed from the text layer of "Compilation of
 * Existing State Truck Size and Weight Limit Laws" (Report to Congress per
 * MAP-21 §32802, May 2015), Exhibit 3, p.8 — cross-checked against FHWA-HOP-19-
 * 028 "Bridge Formula Weights", August 2019. Public domain.
 *
 * `[L, N, published W]`. The 8.5 rows are FHWA's single interval row, printed
 * as "over 8 but less than 9 feet"; 8.5 stands for any span inside it.
 *
 * This exists because a hand-picked subset of table cells is exactly the kind
 * of fixture that agrees with a bug. Thirty-two cells were asserted here for a
 * long time and every one of them passed while 110 cells of the same table
 * disagreed with the code, because the sample happened to sit under 80,000 lb.
 * The whole table, or the sample proves nothing.
 */
const FHWA_TABLE: ReadonlyArray<readonly [number, number, number]> = [
  [4, 2, 34000],
  [5, 2, 34000],
  [6, 2, 34000],
  [7, 2, 34000],
  [8, 2, 34000], [8, 3, 34000],
  [8.5, 2, 38000], [8.5, 3, 42000],
  [9, 2, 39000], [9, 3, 42500],
  [10, 2, 40000], [10, 3, 43500],
  [11, 3, 44000],
  [12, 3, 45000], [12, 4, 50000],
  [13, 3, 45500], [13, 4, 50500],
  [14, 3, 46500], [14, 4, 51500],
  [15, 3, 47000], [15, 4, 52000],
  [16, 3, 48000], [16, 4, 52500], [16, 5, 58000],
  [17, 3, 48500], [17, 4, 53500], [17, 5, 58500],
  [18, 3, 49500], [18, 4, 54000], [18, 5, 59000],
  [19, 3, 50000], [19, 4, 54500], [19, 5, 60000],
  [20, 3, 51000], [20, 4, 55500], [20, 5, 60500], [20, 6, 66000],
  [21, 3, 51500], [21, 4, 56000], [21, 5, 61000], [21, 6, 66500],
  [22, 3, 52500], [22, 4, 56500], [22, 5, 61500], [22, 6, 67000],
  [23, 3, 53000], [23, 4, 57500], [23, 5, 62500], [23, 6, 68000],
  [24, 3, 54000], [24, 4, 58000], [24, 5, 63000], [24, 6, 68500], [24, 7, 74000],
  [25, 3, 54500], [25, 4, 58500], [25, 5, 63500], [25, 6, 69000], [25, 7, 74500],
  [26, 3, 55500], [26, 4, 59500], [26, 5, 64000], [26, 6, 69500], [26, 7, 75000],
  [27, 3, 56000], [27, 4, 60000], [27, 5, 65000], [27, 6, 70000], [27, 7, 75500],
  [28, 3, 57000], [28, 4, 60500], [28, 5, 65500], [28, 6, 71000], [28, 7, 76500], [28, 8, 82000],
  [29, 3, 57500], [29, 4, 61500], [29, 5, 66000], [29, 6, 71500], [29, 7, 77000], [29, 8, 82500],
  [30, 3, 58500], [30, 4, 62000], [30, 5, 66500], [30, 6, 72000], [30, 7, 77500], [30, 8, 83000],
  [31, 3, 59000], [31, 4, 62500], [31, 5, 67500], [31, 6, 72500], [31, 7, 78000], [31, 8, 83500],
  [32, 3, 60000], [32, 4, 63500], [32, 5, 68000], [32, 6, 73000], [32, 7, 78500], [32, 8, 84500], [32, 9, 90000],
  [33, 4, 64000], [33, 5, 68500], [33, 6, 74000], [33, 7, 79000], [33, 8, 85000], [33, 9, 90500],
  [34, 4, 64500], [34, 5, 69000], [34, 6, 74500], [34, 7, 80000], [34, 8, 85500], [34, 9, 91000],
  [35, 4, 65500], [35, 5, 70000], [35, 6, 75000], [35, 7, 80500], [35, 8, 86000], [35, 9, 91500],
  [36, 4, 66000], [36, 5, 70500], [36, 6, 75500], [36, 7, 81000], [36, 8, 86500], [36, 9, 92000],
  [37, 4, 66500], [37, 5, 71000], [37, 6, 76000], [37, 7, 81500], [37, 8, 87000], [37, 9, 93000],
  [38, 4, 67500], [38, 5, 71500], [38, 6, 77000], [38, 7, 82000], [38, 8, 87500], [38, 9, 93500],
  [39, 4, 68000], [39, 5, 72000], [39, 6, 77500], [39, 7, 82500], [39, 8, 88500], [39, 9, 94000],
  [40, 4, 68500], [40, 5, 73000], [40, 6, 78000], [40, 7, 83500], [40, 8, 89000], [40, 9, 94500],
  [41, 4, 69500], [41, 5, 73500], [41, 6, 78500], [41, 7, 84000], [41, 8, 89500], [41, 9, 95000],
  [42, 4, 70000], [42, 5, 74000], [42, 6, 79000], [42, 7, 84500], [42, 8, 90000], [42, 9, 95500],
  [43, 4, 70500], [43, 5, 75000], [43, 6, 80000], [43, 7, 85000], [43, 8, 90500], [43, 9, 96000],
  [44, 4, 71500], [44, 5, 75500], [44, 6, 80500], [44, 7, 85500], [44, 8, 91000], [44, 9, 96500],
  [45, 4, 72000], [45, 5, 76000], [45, 6, 81000], [45, 7, 86000], [45, 8, 91500], [45, 9, 97500],
  [46, 4, 72500], [46, 5, 76500], [46, 6, 81500], [46, 7, 87000], [46, 8, 92500], [46, 9, 98000],
  [47, 4, 73500], [47, 5, 77500], [47, 6, 82000], [47, 7, 87500], [47, 8, 93000], [47, 9, 98500],
  [48, 4, 74000], [48, 5, 78000], [48, 6, 83000], [48, 7, 88000], [48, 8, 93500], [48, 9, 99000],
  [49, 4, 74500], [49, 5, 78500], [49, 6, 83500], [49, 7, 88500], [49, 8, 94000], [49, 9, 99500],
  [50, 4, 75500], [50, 5, 79000], [50, 6, 84000], [50, 7, 89000], [50, 8, 94500], [50, 9, 100000],
  [51, 4, 76000], [51, 5, 80000], [51, 6, 84500], [51, 7, 89500], [51, 8, 95000], [51, 9, 100500],
  [52, 4, 76500], [52, 5, 80500], [52, 6, 85000], [52, 7, 90500], [52, 8, 95500], [52, 9, 101000],
  [53, 4, 77500], [53, 5, 81000], [53, 6, 86000], [53, 7, 91000], [53, 8, 96500], [53, 9, 101500],
  [54, 4, 78000], [54, 5, 81500], [54, 6, 86500], [54, 7, 91500], [54, 8, 97000], [54, 9, 102000],
  [55, 4, 78500], [55, 5, 82500], [55, 6, 87000], [55, 7, 92000], [55, 8, 97500], [55, 9, 102500],
  [56, 4, 79500], [56, 5, 83000], [56, 6, 87500], [56, 7, 92500], [56, 8, 98000], [56, 9, 103000],
  [57, 4, 80000], [57, 5, 83500], [57, 6, 88000], [57, 7, 93000], [57, 8, 98500], [57, 9, 104000],
  [58, 5, 84000], [58, 6, 89000], [58, 7, 94000], [58, 8, 99000], [58, 9, 104500],
  [59, 5, 85000], [59, 6, 89500], [59, 7, 94500], [59, 8, 99500], [59, 9, 105000],
  [60, 5, 85500], [60, 6, 90000], [60, 7, 95000], [60, 8, 100500], [60, 9, 105500],
];

/**
 * `groupMaxWeightLbs` EXACTLY AS IT SHIPPED before this fix: a hard 80,000 lb
 * clamp on every group's allowance, and straight-line interpolation across the
 * 8-to-9 ft interval. Kept here so "nothing moved for a legal-weight vehicle"
 * is a measured claim rather than a promise.
 */
function legacyGroupMaxWeightLbs(spanFt: number, axleCount: number): number {
  if (axleCount < 2) return FEDERAL_SINGLE_AXLE_LIMIT_LBS;
  if (spanFt <= TANDEM_MAX_SPACING_FT) return FEDERAL_TANDEM_AXLE_LIMIT_LBS;
  return Math.min(
    roundToNearest500TiesDown(bridgeFormulaRawLbs(spanFt, axleCount)),
    FEDERAL_SINGLE_AXLE_LIMIT_LBS * axleCount,
    FEDERAL_GROSS_WEIGHT_LIMIT_LBS,
  );
}

describe('the FULL published table — every cell FHWA prints', () => {
  it('has 265 cells', () => {
    expect(FHWA_TABLE).toHaveLength(265);
  });

  /**
   * Collect-and-assert-once: one failure names every cell that moved and which
   * way, instead of 265 test names where the first red one hides the rest.
   *
   * The counts, measured: as shipped 148/265. With the 80,000 lb clamp removed,
   * 258/265. With the 8-to-9 ft interval also held flat as FHWA prints it,
   * 260/265 — and the five that remain are FHWA's own arithmetic, listed in
   * `FHWA_TABLE_ERRATA`.
   */
  it('matches 260 of 265 cells, differing only where FHWA differs from FHWA', () => {
    const mismatches: Array<{
      spanFt: number;
      axleCount: number;
      publishedLbs: number;
      ourLbs: number;
    }> = [];

    for (const [spanFt, axleCount, publishedLbs] of FHWA_TABLE) {
      const ourLbs = groupMaxWeightLbs(spanFt, axleCount, NO_GROSS_CAP);
      if (ourLbs !== publishedLbs) {
        mismatches.push({ spanFt, axleCount, publishedLbs, ourLbs });
      }
    }

    expect(mismatches).toEqual([...FHWA_TABLE_ERRATA]);
    expect(FHWA_TABLE.length - mismatches.length).toBe(260);
  });

  /**
   * The errata are not a licence to drift. Each one must still be the formula's
   * own nearest-500 answer, and each must be exactly 500 lb ABOVE what FHWA
   * printed — the signature of a table typo, not of a rounding rule we have
   * failed to find. If a future cell ever lands here for some other reason,
   * this is what stops it being waved through.
   */
  it('every erratum is the formula answer, exactly 500 lb over the print', () => {
    for (const e of FHWA_TABLE_ERRATA) {
      expect(e.ourLbs - e.publishedLbs).toBe(500);
      expect(e.ourLbs).toBe(
        roundToNearest500TiesDown(
          bridgeFormulaRawLbs(e.spanFt, e.axleCount),
        ),
      );
      expect(groupMaxWeightLbs(e.spanFt, e.axleCount, NO_GROSS_CAP)).toBe(
        e.ourLbs,
      );
    }
  });

  /**
   * L=56/N=9 is the erratum that admits no other reading: 500 × (63 + 108 + 36)
   * is 103,500 on the nose. There is no rounding decision to make and the table
   * still prints 103,000. Its neighbour L=52/N=9 IS an exact tie and the table
   * rounds it down correctly, which is what rules out "a different rounding
   * rule" as the explanation.
   */
  it('L=56/N=9 needs no rounding at all and FHWA still prints it 500 low', () => {
    expect(bridgeFormulaRawLbs(56, 9)).toBe(103500);
    expect(103500 % 500).toBe(0);
    expect(groupMaxWeightLbs(56, 9, NO_GROSS_CAP)).toBe(103500);

    expect(bridgeFormulaRawLbs(52, 9)).toBe(101250); // an exact 500-lb tie
    expect(groupMaxWeightLbs(52, 9, NO_GROSS_CAP)).toBe(101000); // ties down
  });

  /**
   * The measured count BEFORE the fix, asserted against the same table. This is
   * the regression net: it pins how bad the clamp was, so nobody reinstates it
   * believing it to be harmless.
   */
  it('the 80,000 lb clamp cost 110 cells that the fix recovers', () => {
    let shipped = 0;
    let fixed = 0;
    for (const [spanFt, axleCount, publishedLbs] of FHWA_TABLE) {
      if (legacyGroupMaxWeightLbs(spanFt, axleCount) === publishedLbs) {
        shipped += 1;
      }
      if (groupMaxWeightLbs(spanFt, axleCount, NO_GROSS_CAP) === publishedLbs) {
        fixed += 1;
      }
    }
    expect(shipped).toBe(148);
    expect(fixed).toBe(260);
  });
});

// ── The vehicle-gross cap that replaced the 80,000 lb clamp ────────────────

describe('the cap is the vehicle, not the federal unpermitted limit', () => {
  /**
   * THE BYTE-IDENTICAL CLAIM, stated exactly.
   *
   * For any vehicle at or under 80,000 lb, the new third argument cannot change
   * a single verdict. Proof, exhaustively over the (L, N, gross) grid: the only
   * way the two allowances differ is that the vehicle's own gross bound below
   * the legacy value — and when it does, the new allowance IS the gross. A
   * group is a subset of the vehicle's axles, so its weight is at most the
   * gross, so `actual > allowed` is unreachable there. No violation can appear,
   * disappear, or change size.
   *
   * The same reasoning survives the 34-34 exception's `Math.max(allowed,
   * 68,000)`: where the two differ, the new value is the gross, and an actual
   * at or under the gross cannot exceed either branch of the max.
   *
   * Integer feet only, deliberately — that isolates the gross cap from the
   * 8-to-9 ft interval fix, which IS a change and is measured on its own below.
   */
  it('cannot change any verdict at or under 80,000 lb gross', () => {
    const drifted: string[] = [];
    for (
      let gross = 5000;
      gross <= FEDERAL_GROSS_WEIGHT_LIMIT_LBS;
      gross += 2500
    ) {
      for (let n = 2; n <= 9; n += 1) {
        for (let l = 4; l <= 80; l += 1) {
          const now = groupMaxWeightLbs(l, n, gross);
          const before = legacyGroupMaxWeightLbs(l, n);
          const unreachableByAnyGroup = now === gross && gross < before;
          if (now !== before && !unreachableByAnyGroup) {
            drifted.push(
              `L=${l} N=${n} gross=${gross}: was ${before}, now ${now}`,
            );
          }
        }
      }
    }
    expect(drifted).toEqual([]);
  });

  /**
   * And the same claim where callers actually see it: the violation records
   * `checkBridgeFormula` hands back for legal-weight vehicles are what the
   * legacy allowance would have produced, field for field.
   */
  it('produces the identical violation records on legal-weight vehicles', () => {
    const corpus: Array<{ name: string; axles: Axle[] }> = [
      {
        name: 'FHWA figure 4 — 5-axle tractor-semitrailer at 80,000 lb',
        axles: [
          { positionFt: 0, weightLbs: 12000 },
          { positionFt: 16, weightLbs: 17000 },
          { positionFt: 20, weightLbs: 17000 },
          { positionFt: 47, weightLbs: 17000 },
          { positionFt: 51, weightLbs: 17000 },
        ],
      },
      {
        name: 'FHWA figure 8 — single-unit truck at 57,000 lb',
        axles: [
          { positionFt: 0, weightLbs: 12000 },
          { positionFt: 14, weightLbs: 15000 },
          { positionFt: 18.5, weightLbs: 15000 },
          { positionFt: 23, weightLbs: 15000 },
        ],
      },
      {
        name: 'legal 5-axle van — the 34-34 exception case',
        axles: [
          { positionFt: 0, weightLbs: 12000 },
          { positionFt: 16, weightLbs: 17000 },
          { positionFt: 20, weightLbs: 17000 },
          { positionFt: 52, weightLbs: 17000 },
          { positionFt: 56, weightLbs: 17000 },
        ],
      },
      {
        name: '3-axle dump truck, tandem 2,000 lb over',
        axles: [
          { positionFt: 0, weightLbs: 12000 },
          { positionFt: 16, weightLbs: 18000 },
          { positionFt: 20, weightLbs: 18000 },
        ],
      },
      {
        name: 'tight 5-axle — tandems only 34 ft apart',
        axles: [
          { positionFt: 0, weightLbs: 12000 },
          { positionFt: 16, weightLbs: 17000 },
          { positionFt: 20, weightLbs: 17000 },
          { positionFt: 46, weightLbs: 17000 },
          { positionFt: 50, weightLbs: 17000 },
        ],
      },
    ];

    const drifted: string[] = [];
    for (const { name, axles } of corpus) {
      const gross = axles.reduce((s, a) => s + a.weightLbs, 0);
      expect(gross).toBeLessThanOrEqual(FEDERAL_GROSS_WEIGHT_LIMIT_LBS);

      const result = checkBridgeFormula(axles);
      for (const v of result.violations) {
        if (v.rule !== 'bridge-formula' && v.rule !== 'tandem-axle') continue;
        let legacyAllowed = legacyGroupMaxWeightLbs(v.spanFt, v.axleCount);
        if (
          v.axleCount === 4 &&
          v.spanFt >= 36 &&
          (axles[v.firstAxle] as Axle).positionFt -
            (axles[v.firstAxle - 1] as Axle).positionFt <=
            8 &&
          (axles[v.lastAxle - 1] as Axle).positionFt -
            (axles[v.lastAxle - 2] as Axle).positionFt <=
            8
        ) {
          legacyAllowed = Math.max(legacyAllowed, 68000);
        }
        if (v.allowedLbs !== legacyAllowed) {
          drifted.push(
            `${name}: axles ${v.firstAxle}-${v.lastAxle} allowed was ${legacyAllowed}, now ${v.allowedLbs}`,
          );
        }
      }
    }
    expect(drifted).toEqual([]);
  });

  /**
   * A permitted nine-axle load — 105,500 lb over 66 ft, which is precisely what
   * an OS/OW engine exists to price — whose every axle group IS compliant with
   * the bridge formula.
   *
   * The 80,000 lb clamp invented FIVE bridge-formula violations on it, headlined
   * by a 25,500 lb overage on axles 1-9 whose stated allowance, 80,000 lb, the
   * formula never says: at L=66/N=9 the formula allows 109,000. Every one of
   * those five became a customer-visible "Federal bridge formula: ..." line on
   * the quote (`engine.ts`, step 2), and the fabricated 1-9 overage tied the
   * honest gross-weight one and so took `worstViolation` and the headline copy
   * with it.
   */
  describe('a compliant permitted load no longer reports a phantom overage', () => {
    const permitted: Axle[] = [
      { positionFt: 0, weightLbs: 12000, label: 'steer' },
      { positionFt: 16, weightLbs: 14000, label: 'drive 1' },
      { positionFt: 20.5, weightLbs: 14000, label: 'drive 2' },
      { positionFt: 25, weightLbs: 14000, label: 'drive 3' },
      { positionFt: 50, weightLbs: 10300, label: 'trailer 1' },
      { positionFt: 54, weightLbs: 10300, label: 'trailer 2' },
      { positionFt: 58, weightLbs: 10300, label: 'trailer 3' },
      { positionFt: 62, weightLbs: 10300, label: 'trailer 4' },
      { positionFt: 66, weightLbs: 10300, label: 'trailer 5' },
    ];
    const result = checkBridgeFormula(permitted);

    it('is a 105,500 lb, 9-axle, 66 ft load — 36 groups checked', () => {
      expect(result.grossWeightLbs).toBe(105500);
      expect(result.overallLengthFt).toBe(66);
      expect(result.groupsChecked).toBe(36); // 9 × 8 / 2
    });

    it('the old clamp fabricated five bridge-formula violations', () => {
      const fabricated: Array<[number, number, number]> = [];
      for (let i = 0; i < permitted.length; i += 1) {
        for (let j = i + 1; j < permitted.length; j += 1) {
          const group = permitted.slice(i, j + 1);
          const spanFt =
            (group[group.length - 1] as Axle).positionFt -
            (group[0] as Axle).positionFt;
          const actual = group.reduce((s, a) => s + a.weightLbs, 0);
          const legacy = legacyGroupMaxWeightLbs(spanFt, group.length);
          if (actual > legacy) {
            fabricated.push([i + 1, j + 1, actual - legacy]);
          }
        }
      }
      expect(fabricated).toEqual([
        [1, 7, 4900],
        [1, 8, 15200],
        [1, 9, 25500],
        [2, 8, 3200],
        [2, 9, 13500],
      ]);
    });

    it('now reports NO bridge-formula or tandem violation at all', () => {
      expect(
        result.violations.filter(
          (v) => v.rule === 'bridge-formula' || v.rule === 'tandem-axle',
        ),
      ).toEqual([]);
    });

    it('reports exactly one violation, and it is the honest gross one', () => {
      expect(result.violations).toHaveLength(1);
      const v = result.violations[0];
      expect(v?.rule).toBe('gross-weight');
      expect(v?.actualLbs).toBe(105500);
      expect(v?.allowedLbs).toBe(FEDERAL_GROSS_WEIGHT_LIMIT_LBS);
      expect(v?.overageLbs).toBe(25500);
      expect(result.worstViolation?.rule).toBe('gross-weight');
    });

    it('the formula allows 109,000 lb over 66 ft on 9 axles — not 80,000', () => {
      expect(groupMaxWeightLbs(66, 9, 105500)).toBe(105500); // capped by the load
      expect(groupMaxWeightLbs(66, 9, NO_GROSS_CAP)).toBe(109000);
      expect(legacyGroupMaxWeightLbs(66, 9)).toBe(80000); // the fabrication
    });
  });

  /**
   * The other half of the same coin. Removing the clamp must not remove the
   * CHECK: pull the same 105,500 lb load's trailer group six feet forward and
   * axles 2-9 really are over the formula, and it must still say so.
   */
  it('still catches a REAL bridge violation above 80,000 lb', () => {
    const tight: Axle[] = [
      { positionFt: 0, weightLbs: 12000 },
      { positionFt: 16, weightLbs: 14000 },
      { positionFt: 20.5, weightLbs: 14000 },
      { positionFt: 25, weightLbs: 14000 },
      { positionFt: 44, weightLbs: 10300 },
      { positionFt: 48, weightLbs: 10300 },
      { positionFt: 52, weightLbs: 10300 },
      { positionFt: 56, weightLbs: 10300 },
      { positionFt: 60, weightLbs: 10300 },
    ];
    const result = checkBridgeFormula(tight);
    const bridgeViolations = result.violations.filter(
      (v) => v.rule === 'bridge-formula',
    );
    expect(bridgeViolations).toHaveLength(1);
    const v = bridgeViolations[0];
    expect(v?.firstAxle).toBe(2);
    expect(v?.lastAxle).toBe(9);
    expect(v?.spanFt).toBe(44);
    expect(v?.actualLbs).toBe(93500);
    expect(v?.allowedLbs).toBe(91000); // L=44, N=8 — the published cell
    expect(v?.overageLbs).toBe(2500);
    expect(result.compliant).toBe(false);
  });
});

// ── FHWA's one interval row: over 8 but less than 9 feet ───────────────────

describe('spans between 8 and 9 feet are held flat, as FHWA prints them', () => {
  /**
   * FHWA prints ONE value across the whole open interval — 38,000 lb at N=2,
   * 42,000 at N=3 — and those are the formula's values at L=8 exactly. We used
   * to interpolate through it, which over-permitted by up to 1,000 lb at the
   * top of the interval. Over-permitting is the direction that puts an illegal
   * truck on a bridge, so the published flat value wins.
   */
  it('reads the published interval value, not an interpolated one', () => {
    for (const spanFt of [8.01, 8.25, 8.5, 8.75, 8.99]) {
      expect(groupMaxWeightLbs(spanFt, 2, NO_GROSS_CAP)).toBe(38000);
      expect(groupMaxWeightLbs(spanFt, 3, NO_GROSS_CAP)).toBe(42000);
    }
  });

  it('was over-permitting by up to 1,000 lb at the top of the interval', () => {
    expect(legacyGroupMaxWeightLbs(8.99, 2)).toBe(39000);
    expect(groupMaxWeightLbs(8.99, 2, NO_GROSS_CAP)).toBe(38000);
    expect(legacyGroupMaxWeightLbs(8.99, 3)).toBe(42500);
    expect(groupMaxWeightLbs(8.99, 3, NO_GROSS_CAP)).toBe(42000);
  });

  /**
   * The fix is only ever allowed to move in the conservative direction. A
   * change to the table that let MORE weight through anywhere would be the
   * original bug's mirror image.
   */
  it('never permits more than the old behaviour anywhere', () => {
    const permissive: string[] = [];
    for (let n = 2; n <= 9; n += 1) {
      for (let tenths = 40; tenths <= 900; tenths += 1) {
        const l = tenths / 10;
        const now = groupMaxWeightLbs(l, n, NO_GROSS_CAP);
        const before = legacyGroupMaxWeightLbs(l, n);
        // A legacy value AT 80,000 is the clamp itself — the bug under repair,
        // not a ceiling to respect. Everywhere below it, the old number is a
        // real table value and the new one must not exceed it.
        if (before < FEDERAL_GROSS_WEIGHT_LIMIT_LBS && now > before) {
          permissive.push(`L=${l} N=${n}: was ${before}, now ${now}`);
        }
      }
    }
    expect(permissive).toEqual([]);
  });

  it('is not generalised to fractional spans FHWA says nothing about', () => {
    // 8 and 9 are the only feet the interval rule touches. At 9 ft and beyond
    // the table prints whole-foot rows and the formula runs continuously.
    expect(tableSpanFt(8.5)).toBe(TANDEM_MAX_SPACING_FT);
    expect(tableSpanFt(9)).toBe(9);
    expect(tableSpanFt(18.5)).toBe(18.5);
    expect(groupMaxWeightLbs(18.5, 3, NO_GROSS_CAP)).toBe(50000);
    // ...and at or under 8 ft the statutory tandem limit governs, unchanged.
    expect(groupMaxWeightLbs(8, 2, NO_GROSS_CAP)).toBe(
      FEDERAL_TANDEM_AXLE_LIMIT_LBS,
    );
    expect(groupMaxWeightLbs(7.5, 3, NO_GROSS_CAP)).toBe(
      FEDERAL_TANDEM_AXLE_LIMIT_LBS,
    );
  });
});
