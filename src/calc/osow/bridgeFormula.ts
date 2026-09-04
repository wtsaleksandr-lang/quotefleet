/**
 * Federal Bridge Formula — 23 U.S.C. 127 / 23 CFR 658 (public domain).
 *
 *     W = 500 × ( (L × N) / (N − 1) + 12N + 36 )
 *
 *   W = max allowable weight, in pounds, on any group of two or more
 *       consecutive axles
 *   L = distance in FEET between the outermost axles of that group
 *   N = number of axles in the group
 *
 * The formula exists to stop a heavy load from concentrating its mass over a
 * short span of bridge deck. Spread the same 80,000 lb over 51 ft and the
 * bridge is fine; bunch it into 20 ft and it is not.
 *
 * THE PART THAT IS EASY TO GET WRONG
 * ----------------------------------
 * Compliance is not "check the steer axle, check the drives, check the
 * trailer tandems". It is: **check EVERY group of two or more CONSECUTIVE
 * axles** — all N(N−1)/2 of them. A 5-axle tractor-semitrailer has 10 such
 * groups (1-2, 1-3, 1-4, 1-5, 2-3, 2-4, 2-5, 3-4, 3-5, 4-5). The classic
 * failure is a truck whose every individual group passes but whose axles
 * 2-through-5 span, taken together, does not. Only checking adjacent pairs
 * misses it, and that is precisely the interior group a bridge cares about.
 *
 * This module therefore enumerates the full subset set. It is O(N²) on a
 * vehicle with at most a dozen axles — the cost is nothing and the
 * correctness is the whole point.
 *
 * Everything here is a PURE function over public-domain federal law.
 */

/**
 * One axle. `positionFt` is the distance in FEET from the front (steer) axle,
 * so axle 1 is always 0. Axles must be supplied front-to-rear.
 */
export interface Axle {
  positionFt: number;
  weightLbs: number;
  /** Optional label for readable violation text ('steer', 'drive 1'). */
  label?: string;
}

/** Statutory limits on the Interstate System, 23 U.S.C. 127(a). */
export const FEDERAL_SINGLE_AXLE_LIMIT_LBS = 20000;
export const FEDERAL_TANDEM_AXLE_LIMIT_LBS = 34000;
export const FEDERAL_GROSS_WEIGHT_LIMIT_LBS = 80000;

/**
 * The "34-34 at 36 ft" statutory exception, 23 U.S.C. 127(a)(3): two
 * consecutive sets of tandem axles may each carry 34,000 lb provided the
 * outer axles of the two tandems are at least 36 ft apart.
 *
 * This is a genuine carve-out, not a rounding artefact. At L=36, N=4 the
 * formula yields 500 × (36×4/3 + 48 + 36) = 66,000 lb — but the statute
 * permits 68,000. Implementing the formula alone would flag every legal
 * 5-axle van in the country as overweight, so the exception is explicit.
 */
export const TANDEM_PAIR_EXCEPTION_SPAN_FT = 36;
export const TANDEM_PAIR_EXCEPTION_WEIGHT_LBS = 68000;

/** A group of two or more consecutive axles that exceeds its allowance. */
export interface BridgeViolation {
  /** 1-based inclusive axle indices, e.g. axles 2–5. */
  firstAxle: number;
  lastAxle: number;
  axleCount: number;
  /** Outer-to-outer spacing of the group, feet. */
  spanFt: number;
  actualLbs: number;
  allowedLbs: number;
  overageLbs: number;
  rule: 'bridge-formula' | 'single-axle' | 'tandem-axle' | 'gross-weight';
  description: string;
}

export interface BridgeFormulaResult {
  compliant: boolean;
  grossWeightLbs: number;
  /** Outer-to-outer wheelbase, feet. */
  overallLengthFt: number;
  violations: BridgeViolation[];
  /** How many multi-axle groups were tested = N(N−1)/2. Asserted in tests. */
  groupsChecked: number;
  /** The single worst overage, for headline copy. */
  worstViolation: BridgeViolation | null;
  warnings: string[];
  requiresManualReview: boolean;
}

/** Spacing at or below which a group is treated as a tandem (96 in = 8 ft). */
export const TANDEM_MAX_SPACING_FT = 8;

/** The raw, unrounded formula. Exposed so tests can pin the arithmetic
 *  separately from the rounding and cap rules layered on top of it. */
export function bridgeFormulaRawLbs(spanFt: number, axleCount: number): number {
  // N=1 divides by zero — single axles are governed by the flat 20,000 limit.
  if (axleCount < 2) return FEDERAL_SINGLE_AXLE_LIMIT_LBS;
  return 500 * ((spanFt * axleCount) / (axleCount - 1) + 12 * axleCount + 36);
}

/**
 * Round to the nearest 500 lb, breaking exact ties DOWNWARD.
 *
 * 23 U.S.C. 127(a) defines W as the gross weight "to the nearest 500 pounds",
 * and FHWA's published table rounds UP on ordinary values — L=51/N=5 raw
 * 79,875 prints as 80,000, so a plain floor is wrong. But every exact tie in
 * the published table goes DOWN: L=9/N=3 raw 42,750 prints as 42,500, and the
 * same holds across roughly two dozen other tie cells. So: nearest, ties down.
 *
 * `Math.round` is the wrong primitive here — it rounds halves UP and would
 * print 43,000 for that cell, permitting 500 lb the law does not.
 */
export function roundToNearest500TiesDown(lbs: number): number {
  const units = lbs / 500;
  // The epsilon keeps a float like 102.00000000000001 from rounding up a
  // value that is exactly on a 500-lb boundary.
  return Math.ceil(units - 0.5 - 1e-9) * 500;
}

/**
 * FHWA prints ONE flat row for spans "over 8 but less than 9 feet", and this
 * is its upper bound. Below it the table does not interpolate; see
 * `tableSpanFt`.
 */
export const TABLE_FLAT_INTERVAL_UPPER_FT = 9;

/**
 * The span at which FHWA's table is entered for a given real span.
 *
 * The table prints whole-foot rows plus exactly one interval row: "over 8 but
 * less than 9 feet", which reads 38,000 lb at N=2 and 42,000 lb at N=3. Those
 * are precisely the formula's values AT L=8 (500 × (16 + 24 + 36) and
 * 500 × (12 + 36 + 36)) — so across that whole open interval FHWA holds the
 * 8-ft value flat rather than letting the formula climb.
 *
 * Interpolating there over-permits. At L=8.99/N=2 the bare formula gives
 * 38,990 → 39,000, a full 1,000 lb more than the 38,000 FHWA prints for that
 * exact span. Over-permitting is the dangerous direction — it is the direction
 * that puts an illegal truck on a bridge — so the published flat value wins.
 *
 * This is NOT generalised to every fractional span. Between 8 and 9 ft FHWA
 * publishes a value that contradicts interpolation, so we have a fact. Nowhere
 * else does the table say anything about fractional feet, and the statute
 * defines W as a continuous function of L, so interpolating elsewhere is the
 * honest reading rather than an unpublished guess in either direction.
 */
export function tableSpanFt(spanFt: number): number {
  return spanFt > TANDEM_MAX_SPACING_FT &&
    spanFt < TABLE_FLAT_INTERVAL_UPPER_FT
    ? TANDEM_MAX_SPACING_FT
    : spanFt;
}

/**
 * Cells where FHWA's PUBLISHED TABLE disagrees with FHWA's OWN FORMULA, and we
 * deliberately follow the formula.
 *
 * 23 U.S.C. 127(a) defines W by the formula, "to the nearest 500 pounds". The
 * printed table is a reader's aid derived from it, and in five cells the
 * derivation is simply wrong — each prints exactly 500 lb below the nearest-500
 * value, while every neighbouring cell in the same column is correct:
 *
 *     L    N   raw formula     nearest 500   FHWA prints
 *     39   5      72,375.00        72,500        72,000
 *     53   9     101,812.50       102,000       101,500
 *     54   9     102,375.00       102,500       102,000
 *     55   9     102,937.50       103,000       102,500
 *     56   9     103,500.00       103,500       103,000
 *
 * L=56/N=9 is the one that settles it: 500 × (63 + 108 + 36) is 103,500 on the
 * nose, an exact multiple of 500 with no rounding decision to make at all, and
 * the table still prints 103,000. No rounding rule produces that. None of the
 * five is an exact 500-lb tie either, so ties-down does not explain them — and
 * L=52/N=9 IS an exact tie (101,250) and FHWA prints 101,000, ties-down,
 * correctly. They are typos in a table, not a rule we have failed to find.
 *
 * Recorded here so that a future cross-check against the published table does
 * not "fix" us into matching the error. `bridgeFormula.test.ts` walks all 265
 * published cells and expects exactly these five to differ, by exactly +500 —
 * so if FHWA ever reprints the table, the test says which way it moved.
 */
export const FHWA_TABLE_ERRATA: ReadonlyArray<{
  spanFt: number;
  axleCount: number;
  publishedLbs: number;
  ourLbs: number;
}> = [
  { spanFt: 39, axleCount: 5, publishedLbs: 72000, ourLbs: 72500 },
  { spanFt: 53, axleCount: 9, publishedLbs: 101500, ourLbs: 102000 },
  { spanFt: 54, axleCount: 9, publishedLbs: 102000, ourLbs: 102500 },
  { spanFt: 55, axleCount: 9, publishedLbs: 102500, ourLbs: 103000 },
  { spanFt: 56, axleCount: 9, publishedLbs: 103000, ourLbs: 103500 },
];

/**
 * Max weight allowed on a group of two or more consecutive axles: the value
 * FHWA's published Bridge Formula table prints for (L, N) — save for the five
 * cells in `FHWA_TABLE_ERRATA`, where the table contradicts the statutory
 * formula and the formula wins — capped by what the vehicle actually weighs.
 *
 * The table is NOT the bare formula. Three caps are layered on it, and omitting
 * any one of them over-permits real loads:
 *
 *   1. 20,000 lb × N — no group may exceed its axles' individual limits. This
 *      is why the N=2 column flattens at 40,000: the raw formula at L=11/N=2
 *      gives 41,000, but two axles can never legally carry more than 40,000.
 *      The N=3 column flattens at 60,000 for the same reason.
 *   2. 34,000 lb for any group spanning 8 ft or less, which is the statutory
 *      tandem limit. The published table shows 34,000 for both the N=2 and
 *      N=3 columns at L ≤ 8, so this is applied by span, not by axle count.
 *   3. `vehicleGrossWeightLbs` — a group is a SUBSET of the vehicle's axles, so
 *      it cannot carry more than the whole vehicle carries. Arithmetic, not
 *      statute, which is exactly why it is safe at every weight.
 *
 * CAP 3 WAS A HARD-CODED 80,000 AND THAT WAS THE BUG. The principle it stated —
 * "no group may exceed the vehicle's gross limit" — is right; 80,000 lb is that
 * limit only for an UNPERMITTED vehicle (23 U.S.C. 127(a)). On a permitted
 * 105,500 lb nine-axle load the gross is 105,500, and clamping every group's
 * allowance to 80,000 fabricated bridge-formula overages of up to 25,500 lb on
 * axle groups that were in fact compliant — on precisely the OS/OW loads this
 * engine exists to price. Measured against all 265 published table cells, the
 * clamp cost 110 of them.
 *
 * The federal 80,000 lb gross limit is still enforced, once, where it belongs:
 * step 3 of `checkBridgeFormula`. It is a limit on the VEHICLE, not on a group.
 *
 * `vehicleGrossWeightLbs` is REQUIRED and deliberately has no default. A
 * default would be the old bug wearing a parameter: every caller that forgot it
 * would silently clamp at 80,000 again, and the forgetting would be invisible.
 * `checkBridgeFormula` already sums the axles, so the caller that matters has
 * the real number to hand.
 *
 * The 34-34-at-36-ft exception is deliberately NOT applied here — it is a
 * geometry-dependent floor, not a table value, and lives in
 * `checkBridgeFormula` where the actual axle layout is known.
 */
export function groupMaxWeightLbs(
  spanFt: number,
  axleCount: number,
  vehicleGrossWeightLbs: number,
): number {
  if (axleCount < 2) return FEDERAL_SINGLE_AXLE_LIMIT_LBS;

  // Cap 3 applies to the tandem branch too. Not because 34,000 lb is ever the
  // wrong statutory number, but because "a group's allowance is never more than
  // the vehicle carries" should hold on every path out of this function — an
  // unexplained exemption on one branch is how the next version of this bug
  // gets in. It changes no verdict: a group cannot outweigh its own vehicle.
  if (spanFt <= TANDEM_MAX_SPACING_FT) {
    return Math.min(FEDERAL_TANDEM_AXLE_LIMIT_LBS, vehicleGrossWeightLbs);
  }

  const rounded = roundToNearest500TiesDown(
    bridgeFormulaRawLbs(tableSpanFt(spanFt), axleCount),
  );
  return Math.min(
    rounded,
    FEDERAL_SINGLE_AXLE_LIMIT_LBS * axleCount,
    vehicleGrossWeightLbs,
  );
}

/**
 * Is this group the second-tandem case the 34-34 exception covers? Four
 * axles, spanning at least 36 ft, arranged as two tandems (axles 1-2 close
 * together, axles 3-4 close together).
 */
function isTandemPairException(group: Axle[], spanFt: number): boolean {
  if (group.length !== 4) return false;
  if (spanFt < TANDEM_PAIR_EXCEPTION_SPAN_FT) return false;
  const a = group[0] as Axle;
  const b = group[1] as Axle;
  const c = group[2] as Axle;
  const d = group[3] as Axle;
  const firstTandemSpan = b.positionFt - a.positionFt;
  const secondTandemSpan = d.positionFt - c.positionFt;
  return firstTandemSpan <= 8 && secondTandemSpan <= 8;
}

/**
 * Check a vehicle against the federal bridge formula and the statutory axle
 * and gross limits.
 *
 * Checks, in order:
 *   1. every single axle against 20,000 lb
 *   2. EVERY group of 2+ consecutive axles against the formula (with the
 *      tandem-pair exception and the 34,000 lb tandem cap applied)
 *   3. gross vehicle weight against 80,000 lb
 *
 * A vehicle that violates nothing here is legal on the Interstate system and
 * needs no overweight permit. A vehicle that violates something needs one —
 * which is what routes it into the OS/OW cost engine.
 */
export function checkBridgeFormula(axles: Axle[]): BridgeFormulaResult {
  const warnings: string[] = [];
  const violations: BridgeViolation[] = [];

  if (axles.length < 2) {
    return {
      compliant: false,
      grossWeightLbs: axles.reduce((s, a) => s + a.weightLbs, 0),
      overallLengthFt: 0,
      violations: [],
      groupsChecked: 0,
      worstViolation: null,
      warnings: [
        'Bridge-formula compliance needs at least two axles with positions and weights. Axle data was not supplied, so weight legality could not be computed.',
      ],
      requiresManualReview: true,
    };
  }

  // Positions must be monotonically increasing front-to-rear, or every span
  // downstream is nonsense. Refuse rather than compute on bad geometry.
  for (let i = 1; i < axles.length; i += 1) {
    const prev = axles[i - 1] as Axle;
    const cur = axles[i] as Axle;
    if (cur.positionFt <= prev.positionFt) {
      return {
        compliant: false,
        grossWeightLbs: axles.reduce((s, a) => s + a.weightLbs, 0),
        overallLengthFt: 0,
        violations: [],
        groupsChecked: 0,
        worstViolation: null,
        warnings: [
          `Axle positions must increase from front to rear; axle ${i + 1} is at ${cur.positionFt} ft but axle ${i} is at ${prev.positionFt} ft. Axle spacing could not be validated.`,
        ],
        requiresManualReview: true,
      };
    }
  }

  const gross = axles.reduce((s, a) => s + a.weightLbs, 0);
  const overallLengthFt =
    (axles[axles.length - 1] as Axle).positionFt - (axles[0] as Axle).positionFt;

  // 1. Single axles.
  axles.forEach((axle, idx) => {
    if (axle.weightLbs > FEDERAL_SINGLE_AXLE_LIMIT_LBS) {
      violations.push({
        firstAxle: idx + 1,
        lastAxle: idx + 1,
        axleCount: 1,
        spanFt: 0,
        actualLbs: axle.weightLbs,
        allowedLbs: FEDERAL_SINGLE_AXLE_LIMIT_LBS,
        overageLbs: axle.weightLbs - FEDERAL_SINGLE_AXLE_LIMIT_LBS,
        rule: 'single-axle',
        description: `Axle ${idx + 1}${axle.label ? ` (${axle.label})` : ''} carries ${axle.weightLbs.toLocaleString()} lb, over the 20,000 lb federal single-axle limit.`,
      });
    }
  });

  // 2. EVERY group of two or more consecutive axles — all N(N−1)/2 of them.
  let groupsChecked = 0;
  for (let i = 0; i < axles.length; i += 1) {
    for (let j = i + 1; j < axles.length; j += 1) {
      groupsChecked += 1;
      const group = axles.slice(i, j + 1);
      const axleCount = group.length;
      const spanFt =
        (group[axleCount - 1] as Axle).positionFt - (group[0] as Axle).positionFt;
      const actual = group.reduce((s, a) => s + a.weightLbs, 0);

      /**
       * `gross` — not 80,000 — is the third cap. A group cannot carry more
       * than the whole vehicle does, so this term can never MANUFACTURE a
       * violation; it can only stop one group's allowance being quoted above
       * the vehicle's own weight. Passing the federal limit here instead was
       * the bug: over 80,000 lb it invented overages on compliant permitted
       * loads. See `groupMaxWeightLbs`.
       */
      let allowed = groupMaxWeightLbs(spanFt, axleCount, gross);
      let rule: BridgeViolation['rule'] =
        spanFt <= TANDEM_MAX_SPACING_FT ? 'tandem-axle' : 'bridge-formula';

      // The 34-34 at 36 ft statutory exception raises the allowance for the
      // two-consecutive-tandems geometry. Without it every legal 5-axle van
      // in the country reads as overweight — see the constant's doc comment.
      if (isTandemPairException(group, spanFt)) {
        allowed = Math.max(allowed, TANDEM_PAIR_EXCEPTION_WEIGHT_LBS);
      }

      if (actual > allowed) {
        violations.push({
          firstAxle: i + 1,
          lastAxle: j + 1,
          axleCount,
          spanFt,
          actualLbs: actual,
          allowedLbs: allowed,
          overageLbs: actual - allowed,
          rule,
          description: `Axles ${i + 1}–${j + 1} (${axleCount} axles over ${spanFt} ft) carry ${actual.toLocaleString()} lb; the bridge formula allows ${allowed.toLocaleString()} lb.`,
        });
      }
    }
  }

  // 3. Gross.
  if (gross > FEDERAL_GROSS_WEIGHT_LIMIT_LBS) {
    violations.push({
      firstAxle: 1,
      lastAxle: axles.length,
      axleCount: axles.length,
      spanFt: overallLengthFt,
      actualLbs: gross,
      allowedLbs: FEDERAL_GROSS_WEIGHT_LIMIT_LBS,
      overageLbs: gross - FEDERAL_GROSS_WEIGHT_LIMIT_LBS,
      rule: 'gross-weight',
      description: `Gross vehicle weight is ${gross.toLocaleString()} lb, over the 80,000 lb federal Interstate limit.`,
    });
  }

  const worst = violations.reduce<BridgeViolation | null>(
    (w, v) => (w === null || v.overageLbs > w.overageLbs ? v : w),
    null,
  );

  return {
    compliant: violations.length === 0,
    grossWeightLbs: gross,
    overallLengthFt,
    violations,
    groupsChecked,
    worstViolation: worst,
    warnings,
    requiresManualReview: false,
  };
}

/**
 * Best-effort axle layout for a load whose axle detail we do NOT have — the
 * common case, because a quote form collects a gross weight and nothing else.
 *
 * Returns `null` rather than inventing a layout. Callers must treat null as
 * "axle compliance unknown" and degrade honestly: the difference between a
 * legal 80,000 lb 5-axle van and an illegal 80,000 lb 3-axle dump truck is
 * entirely in the spacing, so guessing the spacing guesses the answer. This
 * function exists to make that refusal explicit and greppable rather than
 * having callers quietly fabricate axles.
 */
export function inferAxleLayout(): Axle[] | null {
  return null;
}
