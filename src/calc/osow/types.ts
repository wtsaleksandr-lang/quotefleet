/**
 * Jurisdiction data model for the OS/OW permit-and-cost engine.
 *
 * A jurisdiction is DATA. Adding Oklahoma should mean writing an
 * `OK_RULES` object and nothing else — no new branches in the engine, no new
 * condition kinds, no `if (state === 'OK')`. Everything a state can vary is
 * either a `Sourced<T>` list or an `EscortRule`.
 *
 * Every scalar is a `Sourced<T>[]`, never a bare number. A list, not a single
 * value, because (a) fees change and the old row has to stay for backdated
 * quotes, and (b) two official sources routinely disagree and both have to be
 * on file. See `provenance.ts` for how a list resolves to a value — and for
 * why it deliberately refuses to resolve when sources conflict.
 */
import type { Sourced } from './provenance.js';
import type { EscortCountCombination, EscortRule } from './escortRules.js';
import type {
  ContextCondition,
  LiveSegmentTable,
  NamedRouteSegment,
  RouteVocabulary,
} from './routeContext.js';

/**
 * A threshold with its comparison baked in, because states really do differ
 * in the sub-unit band. TxDMV's own page triggers a route inspection at
 * "exceeding 18 ft 11 in" while 43 TAC 219.11 says "19 ft or greater" — for
 * whole inches those agree, at 18'11½" they do not. Storing a bare number
 * would erase the disagreement; storing the operator preserves it.
 */
export interface Threshold {
  /** Inches for dimensions, pounds for weights. */
  value: number;
  /** true = `>= value` triggers; false = `> value` triggers. */
  inclusive: boolean;
}

export function thresholdsEqual(a: Threshold, b: Threshold): boolean {
  return a.value === b.value && a.inclusive === b.inclusive;
}

/** Does a measurement cross this threshold? */
export function exceeds(measurement: number, t: Threshold): boolean {
  return t.inclusive ? measurement >= t.value : measurement > t.value;
}

/**
 * One band of a weight-stepped permit fee. `maxLbs: null` = open-ended top.
 *
 * PHASE 5 ADDED THREE OPTIONAL FIELDS, FOR TWO STATES AND NO NEW ENGINE BRANCH.
 * ---------------------------------------------------------------------------
 * Phase 1–4 states all step the overweight charge on WEIGHT ALONE, so a band
 * was three numbers. Two of the states added in Phase 5 do not:
 *
 *   - LOUISIANA publishes a TWO-DIMENSIONAL table. R.S. 32:387(H)(2)(c) prints
 *     ten gross-weight rows against five distance columns — "80,001-100,000 |
 *     $45.00 $67.50 $97.50 $120.00 $150.00" — and the cell, not the row, is the
 *     fee. Weight alone selects five different amounts at once, which the
 *     resolver would read as one source disagreeing with itself and refuse to
 *     price. `minMiles`/`maxMiles` name the column, exactly as
 *     `OversizeFeeBand.minMiles` already names Illinois's distance step on the
 *     oversize side. They are OPTIONAL and absent everywhere else, so every
 *     Phase 1–4 band selects exactly as it did before.
 *   - COLORADO charges PER AXLE. C.R.S. §42-4-510(11)(a)(III)(B) sets the
 *     single-trip overweight fee at "fifteen dollars plus five dollars per
 *     axle", doubled by the FASTER surcharge to $30 plus $10 per axle, and CDOT
 *     publishes its own worked example: "a six-axle semi-truck/trailer with a
 *     load exceeding 80,000 pounds would cost $45". There is no weight
 *     increment at all — the fee is flat in pounds and linear in axles — so
 *     without `perAxleUsd` the only honest encoding was `notPriceable`, and a
 *     state whose fee schedule is published in full would have been unquotable
 *     over a multiplication.
 *
 * Both are DATA-MODEL extensions in the Phase 3/4 sense: no evaluator changed,
 * no condition kind was added, and no `if (state === ...)` exists anywhere. A
 * band that declares none of the three behaves identically to a Phase 1 band.
 *
 * PHASE 6 ADDED FOUR MORE, FOR A STATE THAT CHARGES BY THE TON.
 * ------------------------------------------------------------
 * ARKANSAS prices the overweight permit as "$17 per permit, plus, for each ton
 * or major fraction thereof to be hauled in excess of the lawful weight, a
 * charge that steps by MILEAGE" — $8.00 a ton up to 100 miles, rising to $16.00
 * a ton past 251. Neither existing shape fits: `feeUsd` is flat in weight, and
 * `PerMileRate` multiplies by the miles, which Arkansas does not do — the
 * mileage picks the RATE and then disappears from the arithmetic. So a band
 * grew an optional per-increment component, exactly parallel to Colorado's
 * `perAxleUsd`, and the mileage is named by the `minMiles`/`maxMiles` Louisiana
 * already added.
 *
 * `incrementRounding` is the field that matters most, and it exists because
 * "or major fraction thereof" is NOT "or fraction thereof". At 80,500 lb gross
 * a round-any-fraction-up rule charges a full ton and a major-fraction rule
 * charges nothing, and the two readings differ by $8–$16 on every partial-ton
 * load in the state. `PerMileRate.roundIncrementUp` is a boolean and cannot say
 * the difference, so this is a three-way named mode rather than a second flag.
 */
export interface WeightBand {
  minLbs: number;
  maxLbs: number | null;
  feeUsd: number;
  /**
   * Miles travelled INSIDE this jurisdiction, where the state's own fee table
   * is banded by distance as well as weight. OPTIONAL; absent means the band
   * applies at any distance, which is what every Phase 1–4 state publishes.
   *
   * A state that uses these MUST also set `feesDependOnDistance`, or the engine
   * would silently price its shortest column on a lane whose mileage it does
   * not know.
   */
  minMiles?: number;
  maxMiles?: number | null;
  /**
   * USD per axle, ADDED to `feeUsd`. OPTIONAL, and absent everywhere but
   * Colorado. A band that sets this cannot be priced without the axle count,
   * and `weightBandApplies` answers `null` rather than `false` when the count
   * is missing — the same three-valued contract as `oversizeBandApplies` and
   * `escortRules.ts`, for the same reason: a fee chosen by an absence is a
   * confident wrong number.
   */
  perAxleUsd?: number;
  /**
   * USD per INCREMENT of weight above `incrementBaseLbs`, ADDED to `feeUsd`.
   * OPTIONAL, and absent everywhere but Arkansas. A band that sets this cannot
   * be priced without the gross weight, and `weightBandAmount` answers `null`
   * rather than `0` when it is not supplied — the same contract as `perAxleUsd`.
   */
  perIncrementUsd?: number;
  /** Pounds per charged increment — 2,000 for a ton. Required alongside `perIncrementUsd`. */
  incrementLbs?: number;
  /** Weight the increments are counted ABOVE; absent = from zero. */
  incrementBaseLbs?: number;
  /**
   * How a PART increment is charged. Defaults to `'up'`, the statutory norm
   * ("or fraction thereof"), which is also what `PerMileRate.roundIncrementUp`
   * means.
   *
   *   - `'up'` — any part increment is charged in full.
   *   - `'majorFraction'` — Arkansas. Ark. Code §27-35-210(e)(2) charges "for
   *     each ton or major fraction thereof", so a part ton is charged only when
   *     it is MORE THAN HALF the increment. Neither the statute nor the rules
   *     define "major fraction"; reading it as "more than half" is stated as an
   *     inference in `arkansas.ts` rather than presented as the state's words.
   */
  incrementRounding?: 'up' | 'majorFraction';
}

export function weightBandsEqual(a: WeightBand, b: WeightBand): boolean {
  return (
    a.minLbs === b.minLbs &&
    a.maxLbs === b.maxLbs &&
    a.feeUsd === b.feeUsd &&
    a.minMiles === b.minMiles &&
    a.maxMiles === b.maxMiles &&
    a.perAxleUsd === b.perAxleUsd &&
    a.perIncrementUsd === b.perIncrementUsd &&
    a.incrementLbs === b.incrementLbs &&
    a.incrementBaseLbs === b.incrementBaseLbs &&
    a.incrementRounding === b.incrementRounding
  );
}

/** Measurements a weight band is tested against. */
export interface WeightBandInput {
  grossWeightLbs: number;
  milesInJurisdiction?: number;
  /** Axles on the combination, including the steering axle. */
  axleCount?: number;
}

/**
 * Does a band apply to this load?
 *
 * Three-valued, exactly like `oversizeBandApplies`. A band bounded on distance
 * or priced per axle is not "does not apply" when the mileage or the axle count
 * was never supplied — it is "cannot tell", and answering `false` would select
 * a different column, or drop a real charge, on the strength of a blank field.
 * A definite MISS on weight is still a real answer, because the band is out
 * whatever the other inputs turn out to be.
 */
export function weightBandApplies(
  band: WeightBand,
  load: WeightBandInput,
): { applies: boolean | null; missing: string[] } {
  if (load.grossWeightLbs < band.minLbs) return { applies: false, missing: [] };
  if (band.maxLbs !== null && load.grossWeightLbs > band.maxLbs) {
    return { applies: false, missing: [] };
  }

  const missing: string[] = [];

  if (band.minMiles !== undefined || band.maxMiles !== undefined) {
    const miles = load.milesInJurisdiction;
    if (miles === undefined) missing.push('miles travelled inside the state');
    else {
      if (band.minMiles !== undefined && miles < band.minMiles) {
        return { applies: false, missing: [] };
      }
      if (
        band.maxMiles !== undefined &&
        band.maxMiles !== null &&
        miles > band.maxMiles
      ) {
        return { applies: false, missing: [] };
      }
    }
  }

  if (band.perAxleUsd !== undefined && load.axleCount === undefined) {
    missing.push('number of axles');
  }

  if (missing.length > 0) return { applies: null, missing };
  return { applies: true, missing: [] };
}

/**
 * How many increments this band charges for a gross weight — Arkansas's "each
 * ton or major fraction thereof". `null` when the band declares a per-increment
 * price without an increment size, which is unpriceable rather than free.
 *
 * The major-fraction test is done in INTEGER POUNDS (`remainder * 2 > size`)
 * rather than on a ratio, so that a load sitting exactly on the half-ton line —
 * 81,000 lb against an 80,000 lb base — is decided by the statute's words and
 * not by binary floating-point dust.
 */
export function chargedIncrements(
  band: WeightBand,
  grossWeightLbs: number,
): number | null {
  const size = band.incrementLbs;
  if (size === undefined || size <= 0) return null;
  const excess = grossWeightLbs - (band.incrementBaseLbs ?? 0);
  if (excess <= 0) return 0;
  const whole = Math.floor(excess / size);
  const remainder = excess - whole * size;
  if (remainder === 0) return whole;
  if (band.incrementRounding === 'majorFraction') {
    return remainder * 2 > size ? whole + 1 : whole;
  }
  return whole + 1;
}

/**
 * What a band charges. Both optional components are ADDED to the flat amount,
 * never substituted for it: Colorado's single-trip OSOW permit is "$30 plus $10
 * per axle" and Arkansas's is "$17 per permit plus $8.00 a ton", and dropping
 * either half misprices every permit those states issue.
 *
 * Returns `null` when the band needs an input it was not given — an axle count
 * for a per-axle band, a gross weight for a per-ton one. `0` would read as
 * "this band is free", and `materiality.ts` rule 4 depends on the distinction:
 * a candidate that cannot be costed must not be treated as the cheap one.
 */
export function weightBandAmount(
  band: WeightBand,
  axleCount: number | undefined,
  grossWeightLbs?: number,
): number | null {
  let total = band.feeUsd;
  if (band.perIncrementUsd !== undefined) {
    if (grossWeightLbs === undefined) return null;
    const increments = chargedIncrements(band, grossWeightLbs);
    if (increments === null) return null;
    total += band.perIncrementUsd * increments;
  }
  if (band.perAxleUsd !== undefined) {
    if (axleCount === undefined) return null;
    total += band.perAxleUsd * axleCount;
  }
  return Math.round(total * 100) / 100;
}

/**
 * A DISTANCE-PRICED overweight fee.
 *
 * Texas does not have one, so Phase 1 did not need this type. Most of the
 * eastern corridor does, and they are not all the same shape — the three
 * structures that actually appear in state fee statutes are:
 *
 *   - a flat rate per mile inside the state;
 *   - a rate per mile per increment of weight OVER the legal limit
 *     ("$0.03 per mile for each 1,000 lb in excess of 80,000 lb");
 *   - either of the above, banded by gross weight.
 *
 * All three are this one type. `perIncrementLbs === null` is the flat case;
 * the banded case is several rows with different `minLbs`/`maxLbs`.
 *
 * `roundIncrementUp` is not a detail. Statutes overwhelmingly charge a part
 * increment in full ("or fraction thereof"), and rounding the other way
 * silently under-bills every load that is not an exact multiple.
 */
/**
 * A ROUNDING RULE A STATE PUBLISHES, WITH ITS DIRECTION AND ITS STEP.
 *
 * `PerMileRate` grew rounding one boolean at a time — `roundIncrementUp`, then
 * `roundMilesUpTo`, then `roundDollars: 'nearest' | 'up'` — because each new
 * state added exactly one. Utah applies THREE ROUNDING RULES TO ONE FEE and
 * they do not all go the same way: Utah Code § 72-7-406(7)(c) rounds miles UP
 * to the nearest 50, pounds UP to the nearest 25,000, and the dollar amount TO
 * THE NEAREST $10. There is nowhere in the boolean shape to put "nearest ten
 * dollars", and no field at all for rounding the pounds.
 *
 * So direction and step became one type. `'nearest'` is not a convenience —
 * on a $180 fee, nearest-$10 and up-to-$10 differ by up to $9.99, and Utah's
 * floor of $80 and cap of $540 mean the rounding is a real fraction of the
 * whole charge on a short lane.
 */
export interface RoundingRule {
  direction: 'up' | 'down' | 'nearest';
  /** Round to a multiple of this. 50 miles, 25,000 lb, $10. */
  toMultipleOf: number;
  /**
   * WHICH POUNDS, for a weight rounding — and it exists because Utah does not
   * say. § 72-7-406(7)(c) reads "The pounds used to calculate the fee under
   * this Subsection (7) shall be rounded up to the nearest 25,000 pound
   * increment", and the fee is charged on the excess over 80,000 lb. At
   * 126,000 lb over 300 miles the two readings are $180 and $252.
   *
   * Both readings are encodable, as two rows, so the resolver refuses to pick —
   * which is the correct outcome for a genuine ambiguity worth $72. Absent
   * means the rule does not round a weight.
   */
  appliesTo?: 'gross' | 'excessOverBase';
  /** The source's own words. Required — this is the audit trail. */
  quote: string;
}

export function roundingRulesEqual(a: RoundingRule, b: RoundingRule): boolean {
  return (
    a.direction === b.direction &&
    a.toMultipleOf === b.toMultipleOf &&
    a.appliesTo === b.appliesTo
  );
}

/**
 * Apply one rounding rule. Rounds to cents FIRST, so a value already sitting on
 * a step is not pushed up one by binary floating-point dust — the same defence
 * `perMileAmountBreakdown` already takes before reading whole dollars.
 */
export function applyRounding(value: number, rule: RoundingRule): number {
  const step = rule.toMultipleOf;
  if (!(step > 0)) return value;
  const quotient = Math.round((value / step) * 1e9) / 1e9;
  const stepped =
    rule.direction === 'up'
      ? Math.ceil(quotient)
      : rule.direction === 'down'
        ? Math.floor(quotient)
        : Math.round(quotient);
  return Math.round(stepped * step * 100) / 100;
}

export interface PerMileRate {
  minLbs: number;
  maxLbs: number | null;
  /** USD per mile, per increment when `perIncrementLbs` is set. */
  ratePerMileUsd: number;
  /** Pounds per charged increment; `null` = the rate is flat per mile. */
  perIncrementLbs: number | null;
  /** Weight the increments are counted ABOVE; `null` = from zero. */
  excessBaseLbs: number | null;
  /** Charge a partial increment in full ("or fraction thereof"). */
  roundIncrementUp: boolean;
  minimumUsd: number | null;
  maximumUsd: number | null;
  /**
   * Miles are rounded UP to a multiple of this before pricing. OPTIONAL and
   * absent everywhere but Florida, whose fee rule reads "Permit fees shall be
   * based on 25 mile increments" and whose own worked example bills a 67.5-mile
   * move as 75 miles. Pricing the true mileage would under-bill every Florida
   * overweight permit that is not an exact multiple of 25.
   */
  roundMilesUpTo?: number;
  /**
   * A flat amount added AFTER the per-mile computation and BEFORE any rounding
   * to whole dollars. OPTIONAL. Florida's $3.33 "administrative cost of
   * issuance" for weights over 80,000 lb is inside the rounding, not outside
   * it: the rule's example is "(75 miles X $0.32) plus $3.33 = $27.33 rounded
   * up to $28.00", and adding the $3.33 after the rounding would give $27.00 +
   * $3.33 = $30.33 — a different, wrong number.
   */
  addAfterUsd?: number;
  /**
   * Rounding to whole dollars, where the STATE says so. OPTIONAL; absent means
   * cents, which is what every Phase 1–3 state does.
   *
   *   - `'nearest'` — Washington. RCW 46.44.0941(c): overweight fees "that
   *     result in an amount less than even dollars ... shall be carried to the
   *     next full dollar if 50 cents or over and shall be reduced to the next
   *     full dollar if 49 cents or under". A 293-mile move at $0.07 per mile is
   *     $20.51 raw and $21.00 as the state computes it.
   *   - `'up'` — Florida. "rounded up to the nearest dollar".
   *
   * Applied to the amount rounded to cents first, so a value already on a whole
   * dollar is not pushed up a dollar by binary floating-point dust.
   */
  roundDollars?: 'nearest' | 'up';
  /**
   * Round the POUNDS before the increments are counted. OPTIONAL and absent
   * everywhere today; Utah is the state that publishes one. See `RoundingRule`
   * for why `appliesTo` is not a detail.
   *
   * Runs BEFORE `perIncrementLbs` divides, because that is the order Utah
   * writes: the pounds "used to calculate the fee" are rounded, and then the
   * fee is calculated from them.
   */
  roundPoundsTo?: RoundingRule;
  /**
   * Round the DOLLARS, to any step in any direction. OPTIONAL. It generalises
   * `roundDollars`, which can only say whole dollars, up or nearest — and which
   * stays because four states use it and none of them needs more.
   *
   * When both are present this one governs and `roundDollars` is ignored, so a
   * state is never rounded twice.
   */
  roundDollarsTo?: RoundingRule;
}

export function perMileRatesEqual(a: PerMileRate, b: PerMileRate): boolean {
  return (
    a.minLbs === b.minLbs &&
    a.maxLbs === b.maxLbs &&
    a.ratePerMileUsd === b.ratePerMileUsd &&
    a.perIncrementLbs === b.perIncrementLbs &&
    a.excessBaseLbs === b.excessBaseLbs &&
    a.roundIncrementUp === b.roundIncrementUp &&
    a.minimumUsd === b.minimumUsd &&
    a.maximumUsd === b.maximumUsd &&
    a.roundMilesUpTo === b.roundMilesUpTo &&
    a.addAfterUsd === b.addAfterUsd &&
    a.roundDollars === b.roundDollars &&
    optionalRoundingEqual(a.roundPoundsTo, b.roundPoundsTo) &&
    optionalRoundingEqual(a.roundDollarsTo, b.roundDollarsTo)
  );
}

function optionalRoundingEqual(a?: RoundingRule, b?: RoundingRule): boolean {
  if (a === undefined || b === undefined) return a === b;
  return roundingRulesEqual(a, b);
}

/** Round to cents. Binary floating point makes this necessary before, not
 *  only after, a rounding step that reads whole dollars. */
function toCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Every step a distance-priced amount passed through, in the order the state
 * applies them.
 *
 * THIS EXISTS SO THE PRICE AND ITS PRINTED EXPLANATION CANNOT DIVERGE. The fee
 * line the public calculator renders carries a `note` beside the amount under a
 * promise that every line is traceable to the schedule it came from, and that
 * note used to be written by a SECOND reading of `PerMileRate` that knew about
 * the rate, the increments and the miles but not about `roundMilesUpTo`,
 * `addAfterUsd` or `roundDollars`. A 26-mile Florida move therefore printed
 * "26 mi in Florida, × $0.36 per mile" — which reads as $9.36 — beside its
 * correct $22.00, and $12.64 of a real fee had no stated cause.
 *
 * With the steps returned as data, `perMileAmount` sums them and
 * `describePerMile` renders them, so a modifier added to the model and to the
 * arithmetic reaches the explanation with it.
 */
export interface PerMileBreakdown {
  /** Miles as supplied by the caller. */
  miles: number;
  /** Miles actually charged, after `roundMilesUpTo`. Equals `miles` when unset. */
  billedMiles: number;
  /** The mileage increment that was applied, or `null` when the state has none. */
  milesIncrement: number | null;
  /** Charged weight increments; 1 when the rate is flat per mile, 0 when nothing is charged. */
  units: number;
  /** True when the load is at or under `excessBaseLbs`, so no distance charge arises at all. */
  belowExcessBase: boolean;
  /** rate × billedMiles × units, to cents, BEFORE `addAfterUsd`. Display only. */
  distanceUsd: number;
  /** `addAfterUsd`, which goes INSIDE the dollar rounding. 0 when unset. */
  addAfterUsd: number;
  /** After `roundDollars`, before the minimum and maximum. */
  roundedUsd: number;
  /** The figure that is charged. */
  amountUsd: number;
  /**
   * The pounds the increments were counted from, AFTER `roundPoundsTo`.
   * OPTIONAL and present only when the state publishes a weight rounding, so a
   * rate that declares none produces exactly the object it produced before this
   * field existed.
   */
  billedPoundsBasis?: { rounded: number; raw: number; appliesTo: 'gross' | 'excessOverBase' };
  /** The dollar rounding that was applied, when it came from `roundDollarsTo`. */
  dollarRounding?: RoundingRule;
}

/**
 * Distance-priced overweight amount, decomposed and rounded to cents.
 *
 * ORDER OF OPERATIONS IS THE STATE'S, NOT OURS, and Florida's rule publishes
 * its own worked example so it can be checked: 112,000 lb over 67.5 miles is
 * "(75 miles X $0.32) plus $3.33 = $27.33 rounded up to $28.00". Miles round up
 * to the increment first, the flat administrative amount goes in before the
 * dollar rounding, and only then do the minimum and maximum apply.
 */
export function perMileAmountBreakdown(
  rate: PerMileRate,
  grossWeightLbs: number,
  miles: number,
): PerMileBreakdown {
  const milesIncrement =
    rate.roundMilesUpTo !== undefined && rate.roundMilesUpTo > 0
      ? rate.roundMilesUpTo
      : null;
  const billedMiles =
    milesIncrement === null
      ? miles
      : Math.ceil(miles / milesIncrement) * milesIncrement;

  // POUND ROUNDING RUNS FIRST, because that is the order the state writes it:
  // the pounds "used to calculate the fee" are rounded, and the fee is then
  // calculated from them. Absent — everywhere on file — this block is skipped
  // entirely and `excess` is derived exactly as before.
  let poundsBasis: PerMileBreakdown['billedPoundsBasis'];
  let effectiveGrossLbs = grossWeightLbs;
  let roundedExcessLbs: number | null = null;
  const poundRule = rate.roundPoundsTo;
  if (poundRule !== undefined) {
    if (poundRule.appliesTo === 'gross') {
      effectiveGrossLbs = applyRounding(grossWeightLbs, poundRule);
      poundsBasis = { rounded: effectiveGrossLbs, raw: grossWeightLbs, appliesTo: 'gross' };
    } else {
      const rawExcess = grossWeightLbs - (rate.excessBaseLbs ?? 0);
      roundedExcessLbs = rawExcess <= 0 ? rawExcess : applyRounding(rawExcess, poundRule);
      poundsBasis = {
        rounded: roundedExcessLbs,
        raw: rawExcess,
        appliesTo: 'excessOverBase',
      };
    }
  }

  let units = 1;
  if (rate.perIncrementLbs !== null && rate.perIncrementLbs > 0) {
    const excess =
      roundedExcessLbs !== null
        ? roundedExcessLbs
        : effectiveGrossLbs - (rate.excessBaseLbs ?? 0);
    if (excess <= 0) {
      // Nothing is over the weight the rate counts above, so no distance charge
      // arises — and the minimum does not create one out of a fee that was
      // never triggered.
      return {
        miles,
        billedMiles,
        milesIncrement,
        units: 0,
        belowExcessBase: true,
        distanceUsd: 0,
        addAfterUsd: 0,
        roundedUsd: 0,
        amountUsd: 0,
      };
    }
    const exact = excess / rate.perIncrementLbs;
    units = rate.roundIncrementUp ? Math.ceil(exact) : Math.floor(exact);
  }
  let raw = toCents(
    rate.ratePerMileUsd * billedMiles * units + (rate.addAfterUsd ?? 0),
  );
  // The general rule wins where both are declared, so a state is never rounded
  // twice — see `PerMileRate.roundDollarsTo`.
  if (rate.roundDollarsTo !== undefined) raw = applyRounding(raw, rate.roundDollarsTo);
  else if (rate.roundDollars === 'nearest') raw = Math.round(raw);
  else if (rate.roundDollars === 'up') raw = Math.ceil(raw);
  const floored = rate.minimumUsd === null ? raw : Math.max(raw, rate.minimumUsd);
  const capped =
    rate.maximumUsd === null ? floored : Math.min(floored, rate.maximumUsd);
  return {
    miles,
    billedMiles,
    milesIncrement,
    units,
    belowExcessBase: false,
    distanceUsd: toCents(rate.ratePerMileUsd * billedMiles * units),
    addAfterUsd: rate.addAfterUsd ?? 0,
    roundedUsd: raw,
    amountUsd: toCents(capped),
    ...(poundsBasis !== undefined ? { billedPoundsBasis: poundsBasis } : {}),
    ...(rate.roundDollarsTo !== undefined ? { dollarRounding: rate.roundDollarsTo } : {}),
  };
}

/** The charged figure alone. See `perMileAmountBreakdown` for the steps. */
export function perMileAmount(
  rate: PerMileRate,
  grossWeightLbs: number,
  miles: number,
): number {
  return perMileAmountBreakdown(rate, grossWeightLbs, miles).amountUsd;
}

/**
 * HOW a jurisdiction prices the overweight component — recorded as data with a
 * citation, not inferred from which arrays happen to be populated.
 *
 * The distinction that forced this: an empty `overweightBands` list is
 * ambiguous. It can mean "this state folds overweight into one combined permit
 * fee" (Kentucky) or "we have not sourced this state's overweight schedule
 * yet". The first is a priced answer; the second is a gap that must stop the
 * quote. Reading both from the same empty array would let a research gap
 * render as a $0 overweight line.
 */
export interface OverweightPricing {
  /**
   * `'perMilePerAxleGroup'` is Minnesota — see `PerMilePerAxleGroupRate`. It is
   * a fourth priced shape rather than a variant of `perMile`, because the
   * multiplicand is the axle CONFIGURATION rather than a weight, and a caller
   * that reads `perMile` will look for `overweightPerMile` and find nothing.
   */
  kind: 'bands' | 'perMile' | 'perMilePerAxleGroup' | 'includedInBaseFee' | 'notPriceable';
  /** What the source actually says. Required — this is the audit trail. */
  explanation: string;
}

/**
 * Two sources describing the same pricing MODEL in different words are
 * corroboration, not conflict, so equality is on `kind` alone. A real
 * disagreement here — one source saying the fee is banded and another saying
 * it is per-mile — is a genuine conflict and still resolves to null.
 */
export function overweightPricingEqual(
  a: OverweightPricing,
  b: OverweightPricing,
): boolean {
  return a.kind === b.kind;
}

/**
 * Payment-processing surcharge. Modelled as flat + percent because Texas
 * charges both ($0.25 per permit plus 2.25% of the transaction), and a
 * flat-only field would have quietly dropped the percentage — the larger of
 * the two components on every permit over about $11.
 *
 * ORDER OF OPERATIONS MATTERS, and the published totals settle it: the flat
 * amount is added to the permit fee FIRST, and the percentage applies to that
 * sum. `(60 + 0.25) × 1.0225 = 61.61` reproduces TxDMV's printed total; the
 * other reading, `60 × 1.0225 + 0.25 = 61.60`, is a cent short. Applied to
 * all five bands the state publishes, the first reading matches every one and
 * the second misses several. See `applyTransactionFee`.
 */
export interface TransactionFee {
  perPermitUsd: number;
  percentOfTotal: number;
}

/**
 * Charge added on top of `subtotalUsd` for payment processing, rounded to
 * cents. Verified against every total TxDMV publishes:
 *
 *   $60 → $61.61 · $210 → $214.98 · $285 → $291.67
 *   $360 → $368.36 · $470 → $480.83
 */
export function applyTransactionFee(
  subtotalUsd: number,
  fee: TransactionFee,
): number {
  const grossed =
    (subtotalUsd + fee.perPermitUsd) * (1 + fee.percentOfTotal / 100);
  return Math.round((grossed - subtotalUsd) * 100) / 100;
}

export function transactionFeesEqual(a: TransactionFee, b: TransactionFee): boolean {
  return (
    a.perPermitUsd === b.perPermitUsd && a.percentOfTotal === b.percentOfTotal
  );
}

/**
 * An OVERSIZE issuance fee that steps by DIMENSION — and, in Illinois, by
 * distance as well.
 *
 * Texas charges one flat $60 whatever the load measures, so Phase 1 modelled
 * the oversize fee as a single `Sourced<number>`. Four of the five states added
 * in Phase 2 do not work that way:
 *
 *   - Pennsylvania: $46 under 14 ft wide, $97 over.
 *   - Ohio: a $55 surcharge up to 14 ft wide / 14 ft 6 in high, $125 above.
 *   - Indiana: $20 / $30 / $40 by width, height and length together.
 *   - Illinois: five dimensional categories × four distance bands.
 *
 * Storing those as several `Sourced<number>` rows would be actively wrong —
 * the resolver would read two different band amounts as two sources CONFLICTING
 * about one fee and refuse to price a load that is unambiguously in one band.
 *
 * BANDS MUST BE MUTUALLY EXCLUSIVE, and that is the point. Each band states
 * both a floor and a ceiling on the dimensions it uses, so at most one matches.
 * A load that matches NO band is not a bug to be papered over: it is the case
 * where the published schedule does not say what to charge. Pennsylvania's own
 * fee PDF prints "$46 (If < 14' wide)" and "$97 (If > 14' wide)" and assigns a
 * load of exactly 14 ft 0 in to neither — so a 14 ft 0 in load correctly falls
 * through to "the published schedule does not price this" rather than being
 * silently rounded into whichever band the code happened to test first.
 *
 * `Threshold` carries the inclusivity, which is what makes that boundary
 * reproducible: "< 14 ft" is `upToWidthIn = { 168, inclusive: true }` (the band
 * stops as soon as width REACHES 168 in), while the statute's "up to 14 feet"
 * is `{ 168, inclusive: false }` (the band survives at exactly 168 in).
 */
export interface OversizeFeeBand {
  /** Short label for the quote line, e.g. 'up to 14 ft wide'. */
  label: string;
  /** Band applies only when the measurement EXCEEDS this. Absent = no floor. */
  overWidthIn?: Threshold;
  overHeightIn?: Threshold;
  overLengthIn?: Threshold;
  /** Band applies only when the measurement does NOT exceed this. Absent = no ceiling. */
  upToWidthIn?: Threshold;
  upToHeightIn?: Threshold;
  upToLengthIn?: Threshold;
  /**
   * Miles travelled INSIDE this jurisdiction. Illinois is the only state here
   * that steps the oversize fee by distance ("For the first 90 miles $25.00"),
   * and it must not be priced from total lane miles — see `feesDependOnDistance`.
   */
  minMiles?: number;
  maxMiles?: number | null;
  feeUsd: number;
}

export function oversizeFeeBandsEqual(a: OversizeFeeBand, b: OversizeFeeBand): boolean {
  const t = (x?: Threshold, y?: Threshold): boolean =>
    x === undefined || y === undefined ? x === y : thresholdsEqual(x, y);
  return (
    a.feeUsd === b.feeUsd &&
    a.minMiles === b.minMiles &&
    a.maxMiles === b.maxMiles &&
    t(a.overWidthIn, b.overWidthIn) &&
    t(a.overHeightIn, b.overHeightIn) &&
    t(a.overLengthIn, b.overLengthIn) &&
    t(a.upToWidthIn, b.upToWidthIn) &&
    t(a.upToHeightIn, b.upToHeightIn) &&
    t(a.upToLengthIn, b.upToLengthIn)
  );
}

/** Measurements an oversize band is tested against. */
export interface OversizeBandInput {
  widthIn?: number;
  heightIn?: number;
  overallLengthIn?: number;
  milesInJurisdiction?: number;
}

/**
 * Does a band apply to this load?
 *
 * Three-valued, for the same reason `escortRules.ts` is: a band that bounds a
 * dimension we were never told is not "does not apply", it is "cannot tell".
 * Answering `false` would quietly select a different band and print a confident
 * fee chosen by an absence. The missing measurement's label comes back with the
 * answer so the warning can name it.
 */
export function oversizeBandApplies(
  band: OversizeFeeBand,
  load: OversizeBandInput,
): { applies: boolean | null; missing: string[] } {
  const missing: string[] = [];
  let applies = true;

  const check = (
    measurement: number | undefined,
    floor: Threshold | undefined,
    ceiling: Threshold | undefined,
    label: string,
  ): void => {
    if (floor === undefined && ceiling === undefined) return;
    if (measurement === undefined) {
      missing.push(label);
      return;
    }
    if (floor !== undefined && !exceeds(measurement, floor)) applies = false;
    if (ceiling !== undefined && exceeds(measurement, ceiling)) applies = false;
  };

  check(load.widthIn, band.overWidthIn, band.upToWidthIn, 'width');
  check(load.heightIn, band.overHeightIn, band.upToHeightIn, 'height');
  check(load.overallLengthIn, band.overLengthIn, band.upToLengthIn, 'overall length');

  if (band.minMiles !== undefined || band.maxMiles !== undefined) {
    const miles = load.milesInJurisdiction;
    if (miles === undefined) missing.push('miles travelled inside the state');
    else {
      if (band.minMiles !== undefined && miles < band.minMiles) applies = false;
      if (band.maxMiles !== undefined && band.maxMiles !== null && miles > band.maxMiles) {
        applies = false;
      }
    }
  }

  // A definite MISS is a real answer even with a measurement missing elsewhere:
  // the band is out either way, so there is nothing to be undecided about.
  if (!applies) return { applies: false, missing: [] };
  if (missing.length > 0) return { applies: null, missing };
  return { applies: true, missing: [] };
}

/**
 * How the oversize and the overweight components combine when a load is BOTH.
 *
 * Phase 1 added them, because Texas does. Two of the Phase 2 states say in
 * writing that they do not, and adding there would over-quote every combined
 * permit in the state:
 *
 *   - Ohio, OAC 5501:2-1-05: "If a movement is both overweight and over width
 *     and/or over height, only one basic processing fee ... and the applicable
 *     overweight surcharge ... will be charged." The oversize surcharge is
 *     REPLACED, not added — which is exactly why ODOT's own table prints $145
 *     for OS/OW rather than $75 + $145.
 *   - Indiana, DOR fee sheet: "Whichever of the calculated oversize or
 *     overweight fees is greater."
 *
 * Recorded as sourced data, never inferred. Absent means `cumulative`, which is
 * what Texas, Pennsylvania ("Fees under subsection (a) are cumulative") and
 * Illinois ("An additional fee ... shall be charged for each overdimension") do.
 */
export interface CombinedFeeRule {
  /**
   * `'absorption'` IS THE GENERALISATION, AND WISCONSIN IS WHY IT WAS NEEDED.
   *
   * The three original kinds each describe ONE relationship between exactly two
   * buckets, which is all Ohio, Indiana and Georgia have. Wis. Stat.
   * § 348.25(8) has a two-level LATTICE and states it twice over:
   * (c) the width/height fee absorbs the LENGTH fee, and (d) the WEIGHT fee
   * absorbs every size fee. A load that is over-length, over-width, over-height
   * AND overweight pays the weight fee ALONE.
   *
   * There is no way to say that with a single kind. `greaterOf` is not it —
   * absorption is not a comparison, it is a statement about which charge exists
   * at all, and a Wisconsin size fee that happened to exceed the weight fee is
   * still not charged. `overweightOnly` is closer but drops (c) entirely, so a
   * Wisconsin load that is over-length and over-width but LEGAL ON WEIGHT would
   * be summed when the statute says the width fee stands alone.
   *
   * AND THE COST OF GETTING IT WRONG IS ONE-DIRECTIONAL: an engine that adds
   * dimension fees OVERCHARGES every Wisconsin heavy-haul quote, on every
   * single one, by the whole size ladder.
   */
  kind: 'cumulative' | 'overweightOnly' | 'greaterOf' | 'absorption';
  /**
   * Required when `kind === 'absorption'`, meaningless otherwise. Each entry
   * says: when `absorber` is charged, none of `absorbs` is charged at all.
   *
   * Entries are applied TRANSITIVELY by `applyFeeAbsorption` — Wisconsin's
   * weight fee absorbs width, which absorbs length, and a reader should not
   * have to notice that (d) already lists length to get the right answer.
   */
  absorption?: FeeAbsorption[];
  /** What the source actually says. Required — this is the audit trail. */
  explanation: string;
}

/**
 * The buckets a state's fee schedule can charge in.
 *
 * `oversize` is the aggregate that `oversizeFeeBands` produces, and it is
 * separate from `width`/`height`/`length` because most states publish one
 * dimensional charge and Wisconsin publishes three. A jurisdiction that only
 * has the aggregate never names the three.
 */
export type FeeComponent =
  | 'base'
  | 'width'
  | 'height'
  | 'length'
  | 'oversize'
  | 'overweight';

export interface FeeAbsorption {
  absorber: FeeComponent;
  absorbs: FeeComponent[];
  /** The source's own words. Required — this is the audit trail. */
  quote: string;
}

/**
 * Which components survive, given the ones a load actually incurs.
 *
 * Pure and total: it takes the charged set and returns the subset that is still
 * charged after absorption, applied to a fixed point so a chain of two
 * absorptions resolves in one call. A component absorbs only when it is ITSELF
 * charged — an absent weight fee absorbs nothing, which is the whole reason a
 * legal-weight Wisconsin load still pays its width fee.
 */
export function applyFeeAbsorption(
  charged: ReadonlyArray<FeeComponent>,
  rule: CombinedFeeRule | null,
): FeeComponent[] {
  if (rule === null || rule.kind !== 'absorption' || rule.absorption === undefined) {
    return [...charged];
  }
  let surviving = new Set<FeeComponent>(charged);
  for (let pass = 0; pass < rule.absorption.length + 1; pass += 1) {
    const before = surviving.size;
    const next = new Set(surviving);
    for (const entry of rule.absorption) {
      if (!surviving.has(entry.absorber)) continue;
      for (const victim of entry.absorbs) {
        if (victim !== entry.absorber) next.delete(victim);
      }
    }
    surviving = next;
    if (surviving.size === before) break;
  }
  return [...charged].filter((c) => surviving.has(c));
}

/**
 * Same reasoning as `overweightPricingEqual`: the MODEL is the claim — with one
 * addition. Two `absorption` rules describing DIFFERENT lattices are a real
 * disagreement about which fees are charged, not two wordings of one rule, so
 * the lattice is part of the comparison.
 */
export function combinedFeeRulesEqual(a: CombinedFeeRule, b: CombinedFeeRule): boolean {
  if (a.kind !== b.kind) return false;
  const key = (r: CombinedFeeRule): string =>
    JSON.stringify(
      (r.absorption ?? [])
        .map((e) => [e.absorber, [...e.absorbs].sort()])
        .sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
    );
  return key(a) === key(b);
}

/** A fee that only attaches above some weight (Texas's Vehicle Supervision Fee). */
export interface ConditionalFee {
  appliesAbove: Threshold;
  feeUsd: number;
}

export function conditionalFeesEqual(a: ConditionalFee, b: ConditionalFee): boolean {
  return a.feeUsd === b.feeUsd && thresholdsEqual(a.appliesAbove, b.appliesAbove);
}

/** Legal (no-permit-needed) limits. Anything over one of these needs a permit. */
export interface LegalLimits {
  widthIn: Sourced<number>[];
  heightIn: Sourced<number>[];
  /** Semitrailer length in a tractor-semitrailer combination. */
  trailerLengthIn: Sourced<number>[];
  /**
   * Overall length of the whole combination, where the state caps it —
   * OPTIONAL, because most states do not for a tractor-semitrailer on the
   * National Network (23 CFR 658.13 preempts an overall cap there and leaves
   * only the semitrailer limit). Omit the field for a state with no such cap;
   * an empty array would read as "we looked and found nothing", which is a
   * different and louder claim. See `resolveIfPresent` in `engine.ts`.
   */
  overallLengthIn?: Sourced<number>[];
  /**
   * Legal KINGPIN-TO-REARMOST-AXLE distance, where the state publishes one —
   * OPTIONAL, and absent for a state that regulates the semitrailer by length
   * alone.
   *
   * WHY IT IS A SEPARATE FIELD AND NOT A SECOND `trailerLengthIn` ROW.
   * -----------------------------------------------------------------
   * KPRA and trailer length are different measurements of the same trailer, and
   * a state can cap one, the other, both, or neither. Recording California's
   * 40 ft KPRA in `trailerLengthIn` would have said "a California semitrailer
   * may not exceed 40 ft", which is false and would have flagged every ordinary
   * 53 ft trailer in the state as over-length. Recording Virginia's 41 ft there
   * would have contradicted the 53 ft the same statute allows. They are two
   * fields because they are two rules.
   *
   * WHAT ABSENT MEANS. "This jurisdiction states no KPRA limit in the sources on
   * file", and the engine stays silent — the same contract as `overallLengthIn`.
   * An EMPTY array still means "we looked and hold nothing", and still goes
   * loudly to review, so a state with a KPRA limit we have not sourced must use
   * that.
   *
   * WHAT IT UNLOCKS. A state that regulates the semitrailer ONLY by KPRA holds
   * an empty `trailerLengthIn` — there is genuinely no length to record — plus a
   * KPRA row. When a caller supplies KPRA, the gap the empty length list reports
   * is answered by the measurement the state actually regulates on, and the
   * engine withdraws the length-gap warning. Without KPRA the warning stands,
   * unchanged. See `calculateOsowForJurisdiction`.
   */
  kingpinToRearAxleIn?: Sourced<number>[];
  /**
   * Legal overhang, where the state publishes one — OPTIONAL, and absent for
   * most of the corridor. Ohio, Pennsylvania and Indiana regulate overhang
   * only through flagging and escort rules (Ohio's OS-1A flags a rear overhang
   * of 4 ft; Pennsylvania sends a pilot car when a load extends more than 15 ft
   * past the rear) and publish no numeric legal overhang limit at all.
   *
   * Absent therefore means "this jurisdiction states no legal overhang limit in
   * the sources on file, and its escort rules carry what it does state". An
   * empty array would read as "we looked for the state's limit and found
   * nothing", which would push every quote in three states into manual review
   * over a limit those states do not impose. The jurisdiction file must say in
   * its header why the field is absent.
   */
  frontOverhangIn?: Sourced<number>[];
  rearOverhangIn?: Sourced<number>[];
  grossWeightLbs: Sourced<number>[];
  singleAxleLbs: Sourced<number>[];
  tandemAxleLbs: Sourced<number>[];
}

/**
 * Conditions that make a load a SUPERLOAD — no published fee, priced by the
 * agency after engineering review. A list of independent triggers because
 * Texas has three, and only one of them is the headline weight number: the
 * other two (axle-group maxima, and 200,001–254,300 lb on short axle spacing)
 * catch loads that a gross-weight-only check would happily misprice.
 */
export interface SuperloadTriggers {
  /**
   * OPTIONAL — and the distinction between absent and empty is load-bearing.
   *
   * ABSENT means the jurisdiction publishes no gross-weight superload
   * threshold, as a positive finding. Illinois is the case: 92 Ill. Adm. Code
   * 554 defines superload treatment qualitatively ("superload moves or moves on
   * nonstandard vehicles or with nonstandard axle configurations") and IDOT's
   * own research note warns against encoding its "practical maximum" weights as
   * cutoffs. There is no number to hold, and warning about a missing one on
   * every Illinois quote would be inventing a gap.
   *
   * An EMPTY ARRAY still means "we hold no data", and still goes loudly to
   * review. A state that has a threshold we have not sourced must use that.
   */
  grossWeight?: Sourced<Threshold>[];
  /**
   * Weight band that becomes a superload when the axle spacing is under a
   * minimum — a heavy load on a short trailer, which a gross-weight test alone
   * reads as ordinary.
   */
  shortSpacing: Sourced<{
    minLbs: number;
    maxLbs: number;
    minAxleSpacingFt: number;
  }>[];
  /**
   * DIMENSIONAL superload triggers, for states where size alone escalates a
   * permit regardless of weight. OPTIONAL — Texas has none, New York has
   * three (over 16 ft wide, 16 ft or more high, over 160 ft long), and a
   * weight-only check would price a 17-ft-wide 60,000 lb load in New York as
   * an ordinary permit when the state will not issue one over the counter.
   */
  widthIn?: Sourced<Threshold>[];
  heightIn?: Sourced<Threshold>[];
  overallLengthIn?: Sourced<Threshold>[];
}

/** Dimensional triggers for a physical route inspection / engineering review. */
export interface RouteInspectionTriggers {
  widthIn: Sourced<Threshold>[];
  heightIn: Sourced<Threshold>[];
  lengthIn: Sourced<Threshold>[];
}

export interface JurisdictionOsowRules {
  /** 'TX', 'ON' — USPS state or Canadian province code. */
  code: string;
  name: string;
  country: 'US' | 'CA';
  legalLimits: LegalLimits;
  /**
   * Base single-trip permit fee — the OVERSIZE issuance charge, before any
   * weight-stepped or distance-priced addition. Several states subsume it into
   * a single combined permit total; see `overweightPricing`.
   */
  permitBaseFeeUsd: Sourced<number>[];
  /**
   * Dimension-banded (and, in Illinois, distance-banded) oversize issuance fee.
   * OPTIONAL — Texas and New York charge one flat amount and have none.
   *
   * Where this is present it carries the WHOLE oversize charge except any flat
   * component, and `permitBaseFeeUsd` carries that flat component alone:
   * Ohio's $20 basic processing charge is real and separate, so Ohio holds
   * `permitBaseFeeUsd = 20` plus a $55/$125 band, and the two sum to the $75
   * and $145 totals ODOT publishes. Indiana decomposes the same way for a
   * different reason — its $20 base is reached from BOTH sides of the schedule
   * ("$20 base fee" for an overweight load, and $20 as the lowest oversize base
   * fee), so it holds `permitBaseFeeUsd = 20` plus $0/$10/$20 increments; a
   * legal-size overweight-only permit matches no dimensional band, and folding
   * the base into the bands would drop it from every one of them.
   * Pennsylvania and Illinois genuinely charge nothing on top of the band, so
   * they hold a SOURCED zero and the engine suppresses the empty line rather
   * than printing "$0.00" beside a real fee.
   */
  oversizeFeeBands?: Sourced<OversizeFeeBand>[];
  /**
   * How the oversize and overweight components combine. OPTIONAL; absent means
   * cumulative, which is Phase 1's behaviour and what Texas does. See
   * `CombinedFeeRule` — Ohio replaces and Indiana takes the greater, and both
   * say so in their own fee documents.
   */
  combinedFeeRule?: Sourced<CombinedFeeRule>[];
  /**
   * How the overweight component is priced here. See `OverweightPricing` —
   * this is recorded from the source, never inferred from which arrays are
   * populated, because "no separate overweight fee" and "we have not sourced
   * one" must not look identical.
   */
  overweightPricing: Sourced<OverweightPricing>[];
  /**
   * Weight-stepped surcharge on top of the base fee (Texas's "highway
   * maintenance fee"). Used when `overweightPricing.kind === 'bands'`.
   */
  overweightBands: Sourced<WeightBand>[];
  /**
   * Distance-priced overweight rates. Used when `overweightPricing.kind ===
   * 'perMile'`, which also requires `feesDependOnDistance` and in-state miles.
   */
  overweightPerMile: Sourced<PerMileRate>[];
  /** Fees that attach only above a weight, e.g. supervision fees. */
  conditionalFees: Sourced<ConditionalFee>[];
  /** Payment processing charged by the issuing agency. */
  transactionFee: Sourced<TransactionFee>[];
  /** Agency charge to review an engineer's route/bridge analysis. */
  routeAnalysisFeeUsd: Sourced<number>[];
  /** Agency charge when the route carries no bridges (the cheap path). */
  noBridgeRouteFeeUsd: Sourced<number>[];
  superload: SuperloadTriggers;
  routeInspection: RouteInspectionTriggers;
  /**
   * A weight law expressed PER AXLE AND SPACING rather than per gross —
   * OPTIONAL, and absent for every jurisdiction but Michigan.
   *
   * ABSENT means "this state states its weight limits as flat numbers, which
   * `legalLimits` already holds". An EMPTY array would mean "this state has a
   * spacing table and we hold none of it", which is a gap and would go loudly to
   * review, so a future spacing state we have not sourced must use that.
   *
   * A jurisdiction may hold MORE THAN ONE table and select between them with
   * `AxleSpacingWeightTable.selector`. Michigan holds two — the federal one at
   * or under 80,000 lb and its own above it — and two more rows besides, because
   * the statute and MDOT's own T-1 do not agree about the 3.5 ft boundary or
   * about whether the 16,000 lb tandem allowance is confined to designated
   * highways. The resolver refuses to pick between those, exactly as it does for
   * a fee. See the PHASE 9 section at the foot of this file.
   */
  axleSpacingWeightTables?: Sourced<AxleSpacingWeightTable>[];
  /**
   * The state's OWN bridge table, where it does not adopt FHWA's — OPTIONAL,
   * and absent for every jurisdiction but South Carolina.
   *
   * ABSENT means the state adopts the federal table, which is what every other
   * jurisdiction on file does and what `bridgeFormula.ts` implements. PRESENT
   * means the engine must NOT fall through to the federal table for this state:
   * South Carolina's own two-axle row at 8 ft reads 35,200 lb against FHWA's
   * 34,000, and a group with no cell on file is reported undecided rather than
   * judged by another state's number.
   */
  stateBridgeTable?: Sourced<StateBridgeTable>[];
  escortRules: EscortRule[];
  /**
   * Other agencies that issue their OWN permit for part of this state's
   * network — a toll authority, a bridge authority, a city. OPTIONAL, because
   * most states have exactly one issuer.
   *
   * This exists because a state total can be complete and still wrong. New
   * York's is the case that forced it: NYSDOT permits the state highway
   * system, but a load crossing the Thruway needs a Thruway Authority permit
   * as well, and quoting only the NYSDOT fee produces a confident number that
   * is missing a whole permit. An entry here makes the engine say so instead.
   */
  additionalAuthorities?: Sourced<AdditionalAuthority>[];
  /**
   * A jurisdiction whose fee depends on miles travelled inside it. The engine
   * refuses to price such a state without in-state mileage rather than billing
   * total lane miles to one state. Per-state mileage splitting itself is still
   * to be built — see `MILEAGE_SPLIT_NOTE`.
   *
   * This is the jurisdiction-wide DEFAULT. Where a state answers differently
   * per fee — Iowa is flat for a general single trip and per-mile for a
   * building hauler — `feeDistanceDependence` overrides it component by
   * component. See `FeeDistanceDependence`.
   */
  feesDependOnDistance: boolean;

  // ── PHASE 10 ─────────────────────────────────────────────────────────────
  // EVERY FIELD BELOW IS OPTIONAL AND EVERY ONE IS ABSENT ON ALL 24 ENCODED
  // JURISDICTIONS. A state that declares none of them is priced by exactly the
  // code path it was priced by before they existed, which
  // `scripts/osow-behaviour-snapshot.ts` checks rather than assumes.

  /**
   * This jurisdiction's OWN road classification, in its own published names.
   *
   * Declaring one changes one thing and it is the important one: a route class
   * the vocabulary does not list evaluates `unknown` instead of `false`, so a
   * caller who passes the generic `two-lane` into a state whose rules are
   * written against "four lanes or more" is told the question is unanswered
   * rather than quietly given the cheaper reading. See `RouteVocabulary`.
   */
  routeVocabulary?: Sourced<RouteVocabulary>[];
  /**
   * Named stretches of road a rule can be confined to. Nevada's I-15 carve-out,
   * Nebraska's route-locked 46,000 lb tandem corridors, Arizona's Table 4
   * segments. See `NamedRouteSegment`.
   */
  routeSegments?: Sourced<NamedRouteSegment>[];
  /**
   * A segment table the AGENCY serves live and we therefore cannot hold.
   * Arizona's Table 4 is the case; see `LiveSegmentTable` for why holding a
   * transcription of it would be worse than holding none.
   */
  liveSegmentTables?: Sourced<LiveSegmentTable>[];
  /** Hours and days a move may or may not travel. See `TravelWindow`. */
  travelWindows?: Sourced<TravelWindow>[];
  /**
   * The dimensional ceiling above which the state will not issue this permit at
   * all — which in Nevada moves with the clock, the day, the direction and the
   * steering configuration. See `PermitEnvelope`.
   */
  permitEnvelopes?: Sourced<PermitEnvelope>[];
  /**
   * How this jurisdiction combines the escort counts of several firing rules.
   * Absent means the Phase 1 reading (max per position, then add), which is
   * what every jurisdiction on file uses. Utah takes "the most stringent
   * requirement" instead — see `EscortCountCombination`.
   */
  escortCountCombination?: Sourced<EscortCountCombination>[];
  /**
   * A distance charge computed from the AXLE CONFIGURATION rather than from
   * gross weight. Used when `overweightPricing.kind === 'perMilePerAxleGroup'`,
   * which also requires in-state miles. See `PerMilePerAxleGroupRate`.
   */
  overweightPerMilePerAxleGroup?: Sourced<PerMilePerAxleGroupRate>[];
  /** Per-component overrides of `feesDependOnDistance`. */
  feeDistanceDependence?: Sourced<FeeDistanceDependence>[];
  /**
   * Permits this state issues at NO CHARGE. A $0 permit is not an absent
   * permit, and the engine prints it as a line rather than suppressing it —
   * see `ZeroFeePermit`.
   */
  zeroFeePermits?: Sourced<ZeroFeePermit>[];
  /**
   * Rules this jurisdiction was checked for and positively does NOT publish.
   * Kansas and Nebraska publish no overhang limit at all, so no overhang escort
   * trigger exists in either — a fact a quote should state rather than a
   * default it should fall back to. See `PublishedAbsence`.
   */
  publishedAbsences?: Sourced<PublishedAbsence>[];
}

/** A second permit issuer inside one state — or, now, a replacement one. */
export interface AdditionalAuthority {
  name: string;
  /** When the load must have this permit as well. */
  appliesWhen: string;
  /**
   * `true` only when we hold that authority's published fee schedule. `false`
   * means the engine must warn and send the leg to review — an unpriced second
   * permit is a hole in the quote, not a rounding error.
   */
  priceable: boolean;
  /**
   * TRUE when this authority permits INSTEAD OF the state, not in addition.
   *
   * This type was built for New York's Thruway, where the state permit and the
   * Authority permit are BOTH needed. The Kansas Turnpike inverts it, in the
   * Authority's own words: "Special permits from KDOT are not required to move
   * oversized loads on the Kansas Turnpike." The Turnpike carries I-35, I-70
   * between Topeka and Kansas City, I-335 and I-470, so this is not a corner
   * case — it is much of the state's east-west heavy-haul mileage.
   *
   * Getting it backwards is wrong twice over: it charges a state fee that is
   * not owed, and it applies the state's escort rule where the Authority
   * publishes its own. Absent means the Phase 6 reading — an ADDITIONAL permit.
   */
  replacesStatePermit?: boolean;
  /** Named segments this authority governs, by `NamedRouteSegment.id`. */
  segmentIds?: string[];
  /** The authority's own rules, where they differ from the state's. */
  ownRules?: SubJurisdictionRules;
}

export function additionalAuthoritiesEqual(
  a: AdditionalAuthority,
  b: AdditionalAuthority,
): boolean {
  return (
    a.name === b.name &&
    a.priceable === b.priceable &&
    (a.replacesStatePermit ?? false) === (b.replacesStatePermit ?? false)
  );
}

/**
 * PHASE 2 — per-jurisdiction mileage splitting.
 *
 * Several states (and every Canadian province with a per-kilometre permit)
 * price on distance travelled INSIDE that jurisdiction, which means splitting
 * a routed polyline at state lines. Texas does not — its general single-trip
 * permit is weight-banded only, with no mileage component — so Phase 1 can be
 * complete and correct without it.
 *
 * Intended free source when it is built: the U.S. Census Bureau's TIGER/Line
 * state boundary shapefiles (public domain, no key, no quota). The routed
 * polyline we already cache is intersected against those boundaries to get
 * per-state miles. `feesDependOnDistance` marks the jurisdictions that will
 * need it; the engine refuses to price them until it exists rather than
 * silently billing total lane miles to one state.
 */
export const MILEAGE_SPLIT_NOTE =
  'Per-jurisdiction mileage is not yet computed. Intended source: US Census TIGER/Line state boundaries (public domain), intersected with the cached route polyline.';

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 9 — A WEIGHT LAW THAT IS PER-AXLE-AND-SPACING, NOT PER-GROSS.
//
// MICHIGAN IS THE STATE THAT DOES NOT FIT ANY FIELD ABOVE, and forcing it into
// one would have been the largest single wrong number in the corpus.
//
// Every jurisdiction in Phases 1-8 states a gross-weight limit and the engine
// asks one question of it: is this load over that number? Michigan states no
// general gross-weight limit at all. MCL 257.722(1) sets a maximum PER AXLE
// keyed to the DISTANCE TO THE NEIGHBOURING AXLE — 18,000 lb at 9 ft or more,
// 13,000 lb between 3.5 and 9 ft, 9,000 lb under 3.5 ft — and MCL 257.719(5)(b)
// caps the vehicle at eleven axles. MDOT's own explainer says in as many words
// that the famous 164,000 lb figure is the ARITHMETIC RESULT of those two
// constraints and not a number the statute writes: "Since 1967, the maximum
// number of axles has been limited to eleven, and per-axle load restrictions
// have resulted in a maximum gross vehicle weight of 164,000 pounds."
//
// So a `grossWeightLbs` threshold cannot express Michigan. Two 150,000 lb
// eleven-axle trucks differing only in where the axles sit are one legal and
// one not, and no single number separates them.
//
// ── THE SECOND THING, WHICH IS A NEW SELECTOR AXIS ────────────────────────
// Michigan runs TWO parallel tables and picks between them on GROSS WEIGHT.
// MCL 257.722(12) is the federal one (20,000 single / 34,000 tandem / bridge
// formula / 80,000 gross); MCL 257.722(1)-(3) is Michigan's own, and it governs
// "vehicles having a gross weight in excess of 80,000 pounds". THE SAME TRUCK
// ON THE SAME ROAD IS JUDGED BY A DIFFERENT TABLE DEPENDING ON HOW HEAVY IT IS.
// Every other jurisdiction here selects a table by ROUTE CLASS — Kentucky's
// AAA/AA/A, Colorado's map colours, California's. `selector` is that new axis,
// and it is recorded as data on the table rather than branched on in the engine,
// which is the same contract every earlier phase kept.
//
// ── WHAT THIS DELIBERATELY DOES NOT DO ────────────────────────────────────
// It does not compute a gross ceiling. `maxAxles` times the heaviest row is
// 11 x 18,000 = 198,000 lb, which is not 164,000 and is not reachable: an
// 18,000 lb axle needs 9 ft of clearance on both sides and eleven of them do not
// fit in a legal combination. MDOT publishes the RESULT and not the arrangement,
// and the only configuration that reaches 164,000 lb in this repository is
// written down in `michigan.ts` as OUR arithmetic, flagged as ours, and encoded
// nowhere.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * One spacing band of a per-axle weight table.
 *
 * BOTH BOUNDS CARRY THEIR OWN INCLUSIVITY, AND THAT IS THE POINT. MCL
 * 257.722(1)(b) reads "less than 9 feet between 2 axles but MORE THAN 3-1/2
 * feet" while (c) reads "less than 3-1/2 feet". A spacing of exactly 3 ft 6 in
 * is therefore named by NO subdivision — (b) needs more than 3.5 and (c) needs
 * less than 3.5 — and MDOT's own T-1 table closes the hole by printing "More
 * than or equal to 3 1/2 feet but less than 9 feet".
 *
 * Storing a bare band would erase that. Storing the inclusivity reproduces the
 * defect exactly: `axleSpacingRowFor` returns `null` at 42.000 inches under the
 * statute's rows and a 13,000 lb row under MDOT's, which is the disagreement,
 * not a bug in the encoding.
 */
export interface AxleSpacingWeightRow {
  /** The subdivision's own words, e.g. '9 feet or more between axles'. */
  label: string;
  /** Lower bound on the gap to the neighbouring axle, FEET. `null` = no floor. */
  minSpacingFt: number | null;
  /** true = the row survives AT `minSpacingFt` ("3.5 feet or more"). */
  minInclusive: boolean;
  /** Upper bound on that gap, FEET. `null` = open-ended. */
  maxSpacingFt: number | null;
  /** true = the row survives AT `maxSpacingFt` ("9 feet or less"). */
  maxInclusive: boolean;
  maxAxleLoadLbs: number;
  /**
   * A condition the subdivision attaches, verbatim; `null` = none stated.
   * Michigan's (a) and (b) are written "for vehicles equipped with high
   * pressure pneumatic or balloon tires" and (c) is not, so a vehicle on other
   * tires is not addressed by (a) at all. Recorded, never applied — tire type
   * is not on an `OsowLoad`.
   */
  conditionedOn: string | null;
}

export function axleSpacingWeightRowsEqual(
  a: AxleSpacingWeightRow,
  b: AxleSpacingWeightRow,
): boolean {
  return (
    a.minSpacingFt === b.minSpacingFt &&
    a.minInclusive === b.minInclusive &&
    a.maxSpacingFt === b.maxSpacingFt &&
    a.maxInclusive === b.maxInclusive &&
    a.maxAxleLoadLbs === b.maxAxleLoadLbs
  );
}

/**
 * The heavier allowance a state grants ONE tandem assembly.
 *
 * `routeClasses` IS THE WHOLE REASON THIS IS A TYPE. MCL 257.722(2) and (3)
 * both grant the 16,000 lb-per-axle tandem "on designated highways"; MDOT's
 * T-1 footnote reproduces the same allowance as "On any legal combination of
 * vehicles" with no route condition at all. `null` means THE SOURCE STATES NO
 * ROUTE CONDITION — it never means "we did not look" — and it is what makes the
 * two rows compare unequal, so the resolver refuses to pick between them. On a
 * non-designated road the disagreement is 3,000 lb per axle across two axles:
 * 6,000 lb of payload.
 */
export interface TandemAxleAllowance {
  perAxleLbs: number;
  /** Route classes the source confines it to; `null` = no route condition stated. */
  routeClasses: string[] | null;
  /** No other axle may be within this many feet of any axle of the assembly. */
  minClearanceFt: number;
  /** Assemblies allowed at this weight on an ordinary combination. */
  maxAssemblies: number;
  /** Assemblies allowed on a truck tractor + semitrailer of five axles or fewer. */
  maxAssembliesOnShortTractorSemitrailer: number;
  /** The source's own words. */
  quote: string;
}

export function tandemAxleAllowancesEqual(
  a: TandemAxleAllowance | null,
  b: TandemAxleAllowance | null,
): boolean {
  if (a === null || b === null) return a === b;
  const routes = (r: string[] | null): string =>
    r === null ? '<none stated>' : [...r].sort().join(',');
  return (
    a.perAxleLbs === b.perAxleLbs &&
    routes(a.routeClasses) === routes(b.routeClasses) &&
    a.minClearanceFt === b.minClearanceFt &&
    a.maxAssemblies === b.maxAssemblies &&
    a.maxAssembliesOnShortTractorSemitrailer ===
      b.maxAssembliesOnShortTractorSemitrailer
  );
}

/** How a table is selected. Michigan selects on WEIGHT; nothing else here does. */
export interface AxleSpacingTableSelector {
  kind: 'grossWeightAbove' | 'grossWeightAtOrUnder';
  thresholdLbs: number;
}

export interface AxleSpacingWeightTable {
  /** The jurisdiction's own name for the set — Michigan: "the normal loading maximum". */
  name: string;
  selector: AxleSpacingTableSelector;
  rows: AxleSpacingWeightRow[];
  /** Axles the jurisdiction allows without a further permit; `null` = none stated. */
  maxAxles: number | null;
  tandemAllowance: TandemAxleAllowance | null;
  /**
   * How a measured spacing is rounded before the rows are read. OPTIONAL, and
   * absent means the caller's figure is used exactly as supplied — which is
   * Michigan's case and is stated as a limitation there rather than papered
   * over. See `AxleSpacingRounding` for Minnesota's anti-gaming carve-out.
   */
  spacingRounding?: AxleSpacingRounding;
  /** What the source actually says. Required — this is the audit trail. */
  explanation: string;
}

export function axleSpacingWeightTablesEqual(
  a: AxleSpacingWeightTable,
  b: AxleSpacingWeightTable,
): boolean {
  if (a.selector.kind !== b.selector.kind) return false;
  if (a.selector.thresholdLbs !== b.selector.thresholdLbs) return false;
  if (a.maxAxles !== b.maxAxles) return false;
  if ((a.spacingRounding === undefined) !== (b.spacingRounding === undefined)) return false;
  if (
    a.spacingRounding !== undefined &&
    b.spacingRounding !== undefined &&
    !axleSpacingRoundingsEqual(a.spacingRounding, b.spacingRounding)
  ) {
    return false;
  }
  if (a.rows.length !== b.rows.length) return false;
  for (let i = 0; i < a.rows.length; i += 1) {
    const ar = a.rows[i] as AxleSpacingWeightRow;
    const br = b.rows[i] as AxleSpacingWeightRow;
    if (!axleSpacingWeightRowsEqual(ar, br)) return false;
  }
  return tandemAxleAllowancesEqual(a.tandemAllowance, b.tandemAllowance);
}

/** Does this table govern a load of this gross weight? */
export function tableGovernsGross(
  table: AxleSpacingWeightTable,
  grossWeightLbs: number,
): boolean {
  return table.selector.kind === 'grossWeightAbove'
    ? grossWeightLbs > table.selector.thresholdLbs
    : grossWeightLbs <= table.selector.thresholdLbs;
}

/**
 * The row that names a spacing, or `null` when NO row does.
 *
 * `null` is a real answer and the reason the inclusivity flags exist. See
 * `AxleSpacingWeightRow` for Michigan's 3.5 ft hole.
 */
export function axleSpacingRowFor(
  rows: ReadonlyArray<AxleSpacingWeightRow>,
  gapFt: number,
): AxleSpacingWeightRow | null {
  for (const row of rows) {
    if (row.minSpacingFt !== null) {
      if (row.minInclusive ? gapFt < row.minSpacingFt : gapFt <= row.minSpacingFt) {
        continue;
      }
    }
    if (row.maxSpacingFt !== null) {
      if (row.maxInclusive ? gapFt > row.maxSpacingFt : gapFt >= row.maxSpacingFt) {
        continue;
      }
    }
    return row;
  }
  return null;
}

/** One axle's verdict against a spacing table. */
export interface AxleSpacingGapFinding {
  /** 1-based axle number, front to rear. */
  axleNumber: number;
  /** The gap this axle is judged on — see `evaluateAxleSpacingTable`. */
  gapFt: number;
  /** `null` when no subdivision names this spacing. */
  rowLabel: string | null;
  maxAxleLoadLbs: number | null;
  actualLbs: number;
  /** 0 when compliant or undecidable. */
  overageLbs: number;
}

export interface AxleSpacingTableResult {
  tableName: string;
  /** Axle numbers whose spacing no subdivision names. */
  unnamedGapAxles: number[];
  findings: AxleSpacingGapFinding[];
  violations: AxleSpacingGapFinding[];
  /** `null` when the table publishes no axle maximum. */
  overMaxAxles: boolean | null;
  /** True when any axle is over its row, i.e. the load needs a permit on weight. */
  overweight: boolean;
}

/**
 * Judge every axle against a spacing table.
 *
 * THE GOVERNING GAP IS THE SMALLER OF THE TWO NEIGHBOURING GAPS, AND THAT IS
 * OUR READING, NOT MICHIGAN'S. MCL 257.722(1) says "if the axle spacing is 9
 * feet or more between axles" without saying which of an interior axle's two
 * neighbours it means, and MDOT does not say either. Taking the smaller gap is
 * the conservative reading — it applies the tighter of the two allowances — and
 * the alternative (the larger gap) would permit more weight than the state
 * plausibly intends. `michigan.ts` states the reading on every quote it can
 * affect rather than presenting it as the statute's words.
 *
 * The statute is also silent on HOW spacing is measured (centre to centre?) and
 * on rounding — contrast the federal formula's "to the nearest 500 pounds" and
 * Mississippi's "measured longitudinally to the nearest foot". At 8 ft 11.5 in
 * versus 9 ft 0 in the difference is 5,000 lb on one axle. Nothing is rounded
 * here; the caller's figure is used exactly as supplied.
 */
export function evaluateAxleSpacingTable(
  table: AxleSpacingWeightTable,
  axles: ReadonlyArray<{ positionFt: number; weightLbs: number }>,
): AxleSpacingTableResult {
  const findings: AxleSpacingGapFinding[] = [];
  const unnamed: number[] = [];

  for (let i = 0; i < axles.length; i += 1) {
    const here = axles[i] as { positionFt: number; weightLbs: number };
    const before = i > 0 ? (axles[i - 1] as { positionFt: number }) : null;
    const after =
      i < axles.length - 1 ? (axles[i + 1] as { positionFt: number }) : null;
    const gaps: number[] = [];
    if (before !== null) gaps.push(here.positionFt - before.positionFt);
    if (after !== null) gaps.push(after.positionFt - here.positionFt);
    // A lone axle has no spacing to be judged on. It is measured against the
    // widest row rather than skipped, because that is what a lone axle
    // unambiguously satisfies.
    const measuredGapFt =
      gaps.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...gaps);
    // The state's OWN rounding, where it publishes one. Absent — Michigan, and
    // every table on file — this is the identity and the caller's figure stands.
    const gapFt = Number.isFinite(measuredGapFt)
      ? roundedSpacingFt(measuredGapFt, table.spacingRounding)
      : measuredGapFt;
    const row = axleSpacingRowFor(table.rows, gapFt);
    if (row === null) {
      unnamed.push(i + 1);
      findings.push({
        axleNumber: i + 1,
        gapFt,
        rowLabel: null,
        maxAxleLoadLbs: null,
        actualLbs: here.weightLbs,
        overageLbs: 0,
      });
      continue;
    }
    findings.push({
      axleNumber: i + 1,
      gapFt,
      rowLabel: row.label,
      maxAxleLoadLbs: row.maxAxleLoadLbs,
      actualLbs: here.weightLbs,
      overageLbs: Math.max(0, here.weightLbs - row.maxAxleLoadLbs),
    });
  }

  const violations = findings.filter((f) => f.overageLbs > 0);
  return {
    tableName: table.name,
    unnamedGapAxles: unnamed,
    findings,
    violations,
    overMaxAxles: table.maxAxles === null ? null : axles.length > table.maxAxles,
    overweight: violations.length > 0,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 9 — A BRIDGE TABLE THAT IS NOT THE FEDERAL BRIDGE TABLE.
//
// SOUTH CAROLINA TRANSCRIBES ITS OWN, AND IT DISAGREES WITH FHWA'S IN THE
// FIRST ROW. SC Code 56-5-4140 prints a table for W = 500(LN/N-1 + 12N + 36)
// whose two-axle row at 8 ft and under reads 35,200 lb where the federal table
// reads 34,000 — South Carolina's interstate tandem ceiling INCLUDING all
// enforcement tolerances — and whose interstate gross ceiling is 75,185 lb
// before the formula lifts it to 80,000. Falling through to `bridgeFormula.ts`
// would test a South Carolina load against another state's numbers and report
// violations the state does not have, or clear ones it does.
//
// WE HOLD PART OF THE TABLE, AND `partial` SAYS SO. The research transcribes the
// caps and four cells; the rest of the printed table was not captured. A cell we
// do not hold is NOT evaluated against the federal value — the entire reason
// this type exists is that the two tables differ — so an unheld group comes back
// undecided and says which group it was. An honest "we cannot check axles 2-5
// against South Carolina's own table" beats a confident verdict from the wrong
// table.
// ═══════════════════════════════════════════════════════════════════════════

/** One printed (L, N) cell of a state's own bridge table. */
export interface StateBridgeCell {
  /** Outer-to-outer span of the group, feet. */
  spanFt: number;
  axleCount: number;
  maxWeightLbs: number;
}

export interface StateBridgeTable {
  name: string;
  /** Only the cells the source prints AND we have transcribed. */
  cells: StateBridgeCell[];
  /** Flat caps the same section publishes; `null` = none stated. */
  singleAxleLbs: number | null;
  tandemAxleLbs: number | null;
  /** Span at or under which `tandemAxleLbs` governs a group. */
  tandemMaxSpanFt: number | null;
  grossLbs: number | null;
  /** Two consecutive tandems at this span or more may carry `twinTandemLbs`. */
  twinTandemSpanFt: number | null;
  twinTandemLbs: number | null;
  /**
   * TRUE when the source prints more cells than we hold. A partial table never
   * defers to the federal one — see the section header.
   */
  partial: boolean;
  explanation: string;
}

export function stateBridgeTablesEqual(
  a: StateBridgeTable,
  b: StateBridgeTable,
): boolean {
  const key = (t: StateBridgeTable): string =>
    JSON.stringify([
      t.singleAxleLbs,
      t.tandemAxleLbs,
      t.tandemMaxSpanFt,
      t.grossLbs,
      t.twinTandemSpanFt,
      t.twinTandemLbs,
      [...t.cells].sort((x, y) => x.spanFt - y.spanFt || x.axleCount - y.axleCount),
    ]);
  return key(a) === key(b);
}

export interface StateBridgeGroupFinding {
  firstAxle: number;
  lastAxle: number;
  axleCount: number;
  spanFt: number;
  actualLbs: number;
  /** `null` when the state's own table holds no cell for this group. */
  allowedLbs: number | null;
  overageLbs: number;
  /** Which published figure decided it. */
  basis: 'cell' | 'tandem' | 'twin-tandem' | 'single-axle' | 'gross' | 'not-held';
}

export interface StateBridgeTableResult {
  tableName: string;
  grossWeightLbs: number;
  overallLengthFt: number;
  findings: StateBridgeGroupFinding[];
  violations: StateBridgeGroupFinding[];
  /** Groups the transcribed cells do not cover. */
  undecidedGroups: number;
  groupsChecked: number;
  overweight: boolean;
}

/**
 * Check an axle layout against a STATE's own bridge table.
 *
 * Deliberately never calls into `bridgeFormula.ts`: a group with no cell on file
 * comes back `basis: 'not-held'` and `allowedLbs: null`, which the engine
 * reports as undecided. Substituting the federal value there would be exactly
 * the fall-through this type exists to prevent.
 */
export function evaluateStateBridgeTable(
  table: StateBridgeTable,
  axles: ReadonlyArray<{ positionFt: number; weightLbs: number }>,
): StateBridgeTableResult {
  const findings: StateBridgeGroupFinding[] = [];
  const gross = axles.reduce((s, a) => s + a.weightLbs, 0);
  const overallLengthFt =
    axles.length === 0
      ? 0
      : (axles[axles.length - 1] as { positionFt: number }).positionFt -
        (axles[0] as { positionFt: number }).positionFt;

  if (table.singleAxleLbs !== null) {
    const cap = table.singleAxleLbs;
    axles.forEach((axle, idx) => {
      findings.push({
        firstAxle: idx + 1,
        lastAxle: idx + 1,
        axleCount: 1,
        spanFt: 0,
        actualLbs: axle.weightLbs,
        allowedLbs: cap,
        overageLbs: Math.max(0, axle.weightLbs - cap),
        basis: 'single-axle',
      });
    });
  }

  let groupsChecked = 0;
  for (let i = 0; i < axles.length; i += 1) {
    for (let j = i + 1; j < axles.length; j += 1) {
      groupsChecked += 1;
      const group = axles.slice(i, j + 1);
      const axleCount = group.length;
      const spanFt =
        (group[axleCount - 1] as { positionFt: number }).positionFt -
        (group[0] as { positionFt: number }).positionFt;
      const actual = group.reduce((s, a) => s + a.weightLbs, 0);

      let allowed: number | null = null;
      let basis: StateBridgeGroupFinding['basis'] = 'not-held';

      if (
        table.tandemAxleLbs !== null &&
        table.tandemMaxSpanFt !== null &&
        spanFt <= table.tandemMaxSpanFt
      ) {
        allowed = table.tandemAxleLbs;
        basis = 'tandem';
      } else {
        const cell = table.cells.find(
          (c) => c.axleCount === axleCount && c.spanFt === spanFt,
        );
        if (cell !== undefined) {
          allowed = cell.maxWeightLbs;
          basis = 'cell';
        }
      }

      // The twin-tandem carve-out raises, never lowers, the allowance.
      if (
        table.twinTandemSpanFt !== null &&
        table.twinTandemLbs !== null &&
        axleCount === 4 &&
        spanFt >= table.twinTandemSpanFt
      ) {
        const a0 = group[0] as { positionFt: number };
        const a1 = group[1] as { positionFt: number };
        const a2 = group[2] as { positionFt: number };
        const a3 = group[3] as { positionFt: number };
        if (a1.positionFt - a0.positionFt <= 8 && a3.positionFt - a2.positionFt <= 8) {
          allowed = Math.max(allowed ?? 0, table.twinTandemLbs);
          basis = 'twin-tandem';
        }
      }

      findings.push({
        firstAxle: i + 1,
        lastAxle: j + 1,
        axleCount,
        spanFt,
        actualLbs: actual,
        allowedLbs: allowed,
        overageLbs: allowed === null ? 0 : Math.max(0, actual - allowed),
        basis,
      });
    }
  }

  if (table.grossLbs !== null) {
    const cap = table.grossLbs;
    findings.push({
      firstAxle: 1,
      lastAxle: axles.length,
      axleCount: axles.length,
      spanFt: overallLengthFt,
      actualLbs: gross,
      allowedLbs: cap,
      overageLbs: Math.max(0, gross - cap),
      basis: 'gross',
    });
  }

  const violations = findings.filter((f) => f.overageLbs > 0);
  return {
    tableName: table.name,
    grossWeightLbs: gross,
    overallLengthFt,
    findings,
    violations,
    undecidedGroups: findings.filter((f) => f.basis === 'not-held').length,
    groupsChecked,
    overweight: violations.length > 0,
  };
}

/**
 * The axles for which a jurisdiction's HEAVIER TANDEM ALLOWANCE actually decides
 * the answer — and only those.
 *
 * Michigan's 16,000 lb-per-axle allowance is the case, and its two published
 * readings differ only in whether it is confined to designated highways. That
 * disagreement can reach an axle only when THREE things are true at once, and
 * warning without checking all three is noise on a settled question:
 *
 *   1. the axle is part of a genuine TANDEM ASSEMBLY — a run of exactly two
 *      axles closer together than the clearance the allowance names;
 *   2. no other axle is within that clearance of either of them, which is what
 *      "if there is no other axle within 9 feet of the assembly" requires and
 *      which falls out of the run being maximal;
 *   3. the axle is HEAVIER than its ordinary spacing row allows and no heavier
 *      than the allowance would permit, so the allowance is the only thing that
 *      could make it legal.
 *
 * A 15,000 lb axle in a four-axle group spaced at 4 ft is over its 13,000 lb row
 * and the allowance cannot help it, because there are other axles within 9 ft.
 * Returning it would put a live disagreement on a quote it cannot affect.
 */
export function tandemAllowanceDecisiveAxles(
  table: AxleSpacingWeightTable,
  axles: ReadonlyArray<{ positionFt: number; weightLbs: number }>,
  result: AxleSpacingTableResult,
): number[] {
  const allowance = table.tandemAllowance;
  if (allowance === null) return [];
  const clearance = allowance.minClearanceFt;

  // Maximal runs of consecutive axles each closer than `clearance` to the next.
  const runs: number[][] = [];
  let current: number[] = [];
  for (let i = 0; i < axles.length; i += 1) {
    if (current.length === 0) {
      current = [i];
      continue;
    }
    const prev = axles[i - 1] as { positionFt: number };
    const here = axles[i] as { positionFt: number };
    if (here.positionFt - prev.positionFt < clearance) current.push(i);
    else {
      runs.push(current);
      current = [i];
    }
  }
  if (current.length > 0) runs.push(current);

  const out: number[] = [];
  for (const run of runs) {
    // Exactly two axles: an assembly the allowance names. A run of three or
    // more is not a tandem assembly and a run of one has nothing to pair with.
    if (run.length !== 2) continue;
    for (const idx of run) {
      const finding = result.findings.find((f) => f.axleNumber === idx + 1);
      if (finding === undefined || finding.maxAxleLoadLbs === null) continue;
      if (
        finding.actualLbs > finding.maxAxleLoadLbs &&
        finding.actualLbs <= allowance.perAxleLbs
      ) {
        out.push(idx + 1);
      }
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 10 — AN OVERWEIGHT FEE THAT IS A FUNCTION OF THE AXLE CONFIGURATION.
//
// MINNESOTA CANNOT BE PRICED FROM GROSS WEIGHT, AND EVERY SHAPE ABOVE CAN.
//
// `WeightBand` steps on gross weight. `PerMileRate` multiplies gross weight's
// excess by distance. Both take ONE number off the load. Minn. Stat. § 169.86
// subd. 5(e) takes the whole axle layout: "The additional cost is equal to the
// product of the distance traveled times the sum of the overweight axle group
// cost factors shown in the following chart." Each OVERWEIGHT GROUP contributes
// a cents-per-mile factor chosen by its axle count, its spacing and how far
// over it is; the factors are summed; the sum is multiplied by the miles.
//
// Two 140,000 lb Minnesota loads with the same gross and different axle
// arrangements are DIFFERENT PRICES, and no banding of gross weight separates
// them. Texas's bands and Wisconsin's percentage both fit the existing model;
// this does not, and forcing it would have meant either quoting the wrong
// number or marking a state whose fee chart is published in full `notPriceable`.
// ═══════════════════════════════════════════════════════════════════════════

/** One row of a per-axle-group cost chart. */
export interface AxleGroupCostFactor {
  /** The state's own label for the row, verbatim. */
  label: string;
  /** Axles in the group the row describes. */
  axleCount: number;
  /** Spacing bounds on the group, feet; `null` = unbounded that way. */
  minSpacingFt: number | null;
  maxSpacingFt: number | null;
  /** Weight band on the GROUP, not on the vehicle. */
  minLbs: number;
  maxLbs: number | null;
  /** Cost per mile this group contributes, USD. MnDOT publishes cents. */
  costPerMileUsd: number;
}

export interface PerMilePerAxleGroupRate {
  /** The state's own name for the chart. */
  name: string;
  factors: AxleGroupCostFactor[];
  /**
   * Round each factor to the nearest cent BEFORE summing, where the state says
   * so. It is not a display concern: rounding after the sum and rounding before
   * it differ by cents per mile, which over a 400-mile lane is dollars.
   */
  roundFactorToCents: boolean;
  minimumUsd: number | null;
  maximumUsd: number | null;
  /** What the source actually says. Required — this is the audit trail. */
  explanation: string;
}

export function perMilePerAxleGroupRatesEqual(
  a: PerMilePerAxleGroupRate,
  b: PerMilePerAxleGroupRate,
): boolean {
  const key = (r: PerMilePerAxleGroupRate): string =>
    JSON.stringify([
      r.roundFactorToCents,
      r.minimumUsd,
      r.maximumUsd,
      [...r.factors]
        .map((f) => [
          f.axleCount,
          f.minSpacingFt,
          f.maxSpacingFt,
          f.minLbs,
          f.maxLbs,
          f.costPerMileUsd,
        ])
        .sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y))),
    ]);
  return key(a) === key(b);
}

/** One overweight group, as the caller can state it. */
export interface OverweightAxleGroup {
  axleCount: number;
  spanFt: number;
  weightLbs: number;
}

export interface PerMilePerAxleGroupBreakdown {
  miles: number;
  /** One entry per group, with the row that priced it. `null` = no row matched. */
  groups: Array<{
    group: OverweightAxleGroup;
    factorLabel: string | null;
    costPerMileUsd: number | null;
  }>;
  /** Groups the published chart has no row for. */
  unpricedGroups: number;
  sumPerMileUsd: number;
  amountUsd: number | null;
}

/**
 * Price a per-axle-group distance charge.
 *
 * `amountUsd` is `null` — not 0 — when ANY group has no row in the chart. A
 * chart that does not price a group is a chart that does not price the move,
 * and summing the groups it does cover would under-bill by exactly the amount
 * nobody noticed was missing. Same contract as `weightBandAmount`.
 */
export function perMilePerAxleGroupAmount(
  rate: PerMilePerAxleGroupRate,
  groups: ReadonlyArray<OverweightAxleGroup>,
  miles: number,
): PerMilePerAxleGroupBreakdown {
  const rows: PerMilePerAxleGroupBreakdown['groups'] = [];
  let sum = 0;
  let unpriced = 0;
  for (const group of groups) {
    const factor = rate.factors.find(
      (f) =>
        f.axleCount === group.axleCount &&
        (f.minSpacingFt === null || group.spanFt >= f.minSpacingFt) &&
        (f.maxSpacingFt === null || group.spanFt <= f.maxSpacingFt) &&
        group.weightLbs >= f.minLbs &&
        (f.maxLbs === null || group.weightLbs <= f.maxLbs),
    );
    if (factor === undefined) {
      unpriced += 1;
      rows.push({ group, factorLabel: null, costPerMileUsd: null });
      continue;
    }
    const per = rate.roundFactorToCents
      ? Math.round(factor.costPerMileUsd * 100) / 100
      : factor.costPerMileUsd;
    sum += per;
    rows.push({ group, factorLabel: factor.label, costPerMileUsd: per });
  }
  const sumPerMile = Math.round(sum * 1e6) / 1e6;
  if (unpriced > 0) {
    return {
      miles,
      groups: rows,
      unpricedGroups: unpriced,
      sumPerMileUsd: sumPerMile,
      amountUsd: null,
    };
  }
  let amount = Math.round(sumPerMile * miles * 100) / 100;
  if (rate.minimumUsd !== null) amount = Math.max(amount, rate.minimumUsd);
  if (rate.maximumUsd !== null) amount = Math.min(amount, rate.maximumUsd);
  return {
    miles,
    groups: rows,
    unpricedGroups: 0,
    sumPerMileUsd: sumPerMile,
    amountUsd: Math.round(amount * 100) / 100,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 10 — DISTANCE-DEPENDENCE IS A PROPERTY OF A FEE, NOT OF A STATE.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Whether ONE fee component needs in-state mileage — and, where the state
 * confines it, WHICH MOVES it applies to.
 *
 * `JurisdictionOsowRules.feesDependOnDistance` is a single boolean over the
 * whole state, and Iowa cannot answer it. Iowa Code § 321E.14(1)(e) prices the
 * general single-trip permit at a flat $35 with no mileage term at all, and
 * § 321E.12(3) charges 5 cents per ton per mile — but "only to vehicles
 * transporting buildings other than mobile homes and factory-built structures".
 * The state is therefore `false` for one product and `true` for another, and
 * the boolean has to pick one: saying `true` refuses to price the ordinary Iowa
 * permit without mileage it does not need, and saying `false` prices a building
 * haul off a rate that has nowhere to get its miles.
 *
 * The boolean STAYS as the jurisdiction-wide default, because it is right for
 * all 24 states on file and changing its meaning would be a behaviour change
 * for every one of them. These rows override it per component.
 */
export interface FeeDistanceDependence {
  /** The component this is about. Free-form beyond `FeeComponent` for named products. */
  component: FeeComponent | string;
  dependsOnDistance: boolean;
  /** The moves it applies to, where the state confines it. Absent = all moves. */
  appliesWhen?: ContextCondition;
  /** The source's own words. Required — this is the audit trail. */
  quote: string;
}

export function feeDistanceDependenciesEqual(
  a: FeeDistanceDependence,
  b: FeeDistanceDependence,
): boolean {
  return a.component === b.component && a.dependsOnDistance === b.dependsOnDistance;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 10 — A PERMIT THAT IS REQUIRED AND COSTS NOTHING.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A published $0 permit.
 *
 * `amountUsd: null` already means "this fee applies and cannot be priced", and
 * the engine already suppresses a $0 line so that Pennsylvania's sourced zero
 * does not print "$0.00" beside a real charge. Between them those two rules
 * leave nowhere to say the third thing: THE PERMIT IS REQUIRED AND THE
 * PUBLISHED FEE IS ZERO. Kansas issues government vehicles a permit at no
 * charge; Nebraska's Highway 75 implement-of-husbandry permit is the same
 * shape. Suppressing the line reads as "no permit needed", which is wrong in
 * the direction that gets a truck stopped.
 *
 * So a zero-fee case is its own record and the engine emits a line at $0 with
 * the state's words on it — visibly a permit, visibly free.
 */
export interface ZeroFeePermit {
  /** The state's own name for the case: 'government vehicle', 'Highway 75 IOH permit'. */
  name: string;
  /** The source's own words. Required — this is the audit trail. */
  quote: string;
}

export function zeroFeePermitsEqual(a: ZeroFeePermit, b: ZeroFeePermit): boolean {
  return a.name === b.name;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 10 — AFFIRMATIVE ABSENCE: "THIS STATE PUBLISHES NO SUCH RULE."
// ═══════════════════════════════════════════════════════════════════════════

/** A rule a jurisdiction is checked for and positively does not publish. */
export type PublishedAbsenceSubject =
  | 'frontOverhangLimit'
  | 'rearOverhangLimit'
  | 'overhangEscortTrigger'
  | 'weightEscortTrigger'
  | 'heightEscortTrigger'
  | 'dimensionalEscortThresholds'
  | 'policeEscortTrigger'
  | 'policeEscortRate'
  | 'superloadDefinition'
  | 'superloadFee'
  | 'roadClassification'
  | 'permitDimensionalEnvelope'
  | 'partialIncrementRule';

/**
 * A CHECKED NEGATIVE, recorded as data.
 *
 * Absence has been carried by an ABSENT FIELD since Phase 2 —
 * `LegalLimits.frontOverhangIn` omitted means "this state states no overhang
 * limit" — and that works exactly as long as somebody reads the header comment.
 * Two of the nine states make it worth writing down instead, because the
 * consequence is a rule that must NOT be synthesised:
 *
 *   KANSAS AND NEBRASKA PUBLISH NO OVERHANG LIMIT AT ALL. Kansas regulates
 *   overhang only through overall length; K.S.A. 8-1902/8-1904 and K.A.R.
 *   36-1-36/36-1-37 set none. Nebraska is the same — sections 60-6,288 to
 *   60-6,290 and 408 NAC 3 contain none, and NDOT's legal-sizes sheet lists
 *   nine dimensions without one. THE DOWNSTREAM CONSEQUENCE IS THE POINT:
 *   because there is no overhang limit, there is no overhang ESCORT trigger
 *   either, and a quote must not port Utah's 10 ft and 20 ft overhang escorts
 *   across a state line. Contrast Utah, which publishes 3 ft front / 6 ft rear.
 *
 * The difference between this and an absent field is that this one can be
 * PRINTED — "Kansas publishes no overhang limit; the sources checked are ..." is
 * an answer, where a missing field is only ever silence.
 */
export interface PublishedAbsence {
  subject: PublishedAbsenceSubject;
  /** What was checked and what it does — and does not — say. */
  statement: string;
  /** Downstream rules that therefore do not exist. */
  consequence?: string;
}

export function publishedAbsencesEqual(a: PublishedAbsence, b: PublishedAbsence): boolean {
  return a.subject === b.subject;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 10 — A PERMIT ENVELOPE THAT MOVES WITH THE CLOCK AND THE ROAD.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The maximum a permit PRODUCT will be issued for.
 *
 * Not a legal limit (that is `LegalLimits`) and not an escort trigger. It is
 * the ceiling above which the state will not sell you this permit at all, and
 * Nevada made it a first-class record because ITS CEILING IS NOT CONSTANT:
 *
 *   - NAC 484D.655 caps the annual permit at 14 ft wide by day and 12 ft AT
 *     NIGHT. A permit limit that changes with the time of day, which is not an
 *     escort rule and has nowhere else to live.
 *   - NAC 484D.655(1)(b)-(c) cuts the single-trip width from 14 ft to 12 ft for
 *     FRIDAY-AFTERNOON NORTHBOUND and SUNDAY-AFTERNOON SOUTHBOUND travel on
 *     I-15 between the California line and Las Vegas Exit 33. A 13 ft load that
 *     is quotable on Thursday is not quotable at 3 p.m. on Friday on that
 *     stretch.
 *   - A combination with a MECHANICALLY STEERED REAR AXLE gets 120 ft where
 *     others get 110.
 *
 * Each variant is one row with its own `Sourced.appliesWhen`, so the day
 * ceiling and the night ceiling are two rows rather than one number with a
 * caveat — and a quote that does not state the time leaves BOTH in effect,
 * which resolves to a conflict and a review. That is the required behaviour:
 * absent time must never read as "day".
 */
export interface PermitEnvelope {
  /** The state's own name for the product: 'single trip', 'annual'. */
  product: string;
  widthIn?: number;
  heightIn?: number;
  overallLengthIn?: number;
  grossWeightLbs?: number;
  /** The source's own words. Required — this is the audit trail. */
  quote: string;
}

export function permitEnvelopesEqual(a: PermitEnvelope, b: PermitEnvelope): boolean {
  return (
    a.product === b.product &&
    a.widthIn === b.widthIn &&
    a.heightIn === b.heightIn &&
    a.overallLengthIn === b.overallLengthIn &&
    a.grossWeightLbs === b.grossWeightLbs
  );
}

/**
 * A window in which a move may — or may not — travel.
 *
 * The Kansas Turnpike publishes Monday-to-Thursday 08:30-16:30 for loads over
 * 14 ft, which does not match KDOT's own window on the state highway system —
 * so a travel window belongs to an AUTHORITY, not only to a state, and
 * `SubJurisdictionRules` carries its own list.
 */
export interface TravelWindow {
  /** The window's own description, e.g. 'over 14 ft wide, Kansas Turnpike'. */
  label: string;
  /** 0 = Sunday ... 6 = Saturday; `null` = every day. */
  daysOfWeek: number[] | null;
  /** `'HH:MM'`; `null` = no clock bound on that side. */
  fromHhmm: string | null;
  toHhmm: string | null;
  /** True when travel is FORBIDDEN in the window rather than confined to it. */
  prohibits?: boolean;
  /** Conditions that narrow it further — width, direction, segment. */
  appliesWhen?: ContextCondition;
  /** The source's own words. Required — this is the audit trail. */
  quote: string;
}

export function travelWindowsEqual(a: TravelWindow, b: TravelWindow): boolean {
  return (
    a.label === b.label &&
    JSON.stringify(a.daysOfWeek) === JSON.stringify(b.daysOfWeek) &&
    a.fromHhmm === b.fromHhmm &&
    a.toHhmm === b.toHhmm &&
    (a.prohibits ?? false) === (b.prohibits ?? false)
  );
}

/**
 * The rules an authority INSIDE a state applies in place of the state's.
 *
 * `AdditionalAuthority` was built for New York's Thruway, where a second permit
 * is needed AS WELL AS the state's. The Kansas Turnpike is the opposite shape
 * and the difference is a whole permit fee: KTA's own page says "Special
 * permits from KDOT are not required to move oversized loads on the Kansas
 * Turnpike." The Turnpike carries I-35, I-70 between Topeka and Kansas City,
 * I-335 and I-470 — a large share of the state's east-west heavy-haul mileage —
 * and it publishes its own escort trigger and its own travel window, neither of
 * which matches KDOT's.
 *
 * Quoting the state permit there charges $40 that is not owed AND applies the
 * wrong escort rule. `replacesStatePermit` on `AdditionalAuthority` is what
 * separates the two cases.
 */
export interface SubJurisdictionRules {
  escortRules?: EscortRule[];
  permitBaseFeeUsd?: Sourced<number>[];
  travelWindows?: Sourced<TravelWindow>[];
  /** The source's own words. Required — this is the audit trail. */
  quote: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 10 — SPACING ROUNDING, INCLUDING AN ANTI-GAMING CARVE-OUT.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * How a measured axle spacing is rounded before a table is read.
 *
 * `evaluateAxleSpacingTable` uses the caller's figure exactly as supplied and
 * says so, because Michigan's statute is silent on rounding and inventing one
 * would have been our rule presented as the state's. MINNESOTA IS NOT SILENT.
 * Minn. Stat. § 169.824 publishes the most explicit spacing-rounding rule in
 * this corpus, and it includes a carve-out whose only purpose is to stop a
 * carrier gaming the rounding: a distance measured at 3 ft 4 in to 3 ft 6 in is
 * NOT rounded to the nearest foot like everything else.
 *
 * The carve-out is why this is a type rather than a direction and a step. A
 * plain "nearest foot" rule rounds 3'4" down to 3 ft and 3'6" up to 4 ft, and
 * the statute says neither — it names the band and states its own treatment.
 * Encoding only the general rule would silently reintroduce exactly the
 * behaviour the legislature wrote a sentence to prevent.
 */
export interface AxleSpacingRounding {
  direction: 'up' | 'down' | 'nearest';
  /** Round to a multiple of this many feet. 1 for "to the nearest foot". */
  toMultipleOfFt: number;
  /** Bands the source excludes from the general rule, with their own treatment. */
  carveOuts: Array<{
    /** Inclusive bounds of the band, feet. */
    fromFt: number;
    toFt: number;
    /** The spacing the source says to use inside the band. */
    treatAsFt: number;
    /** The source's own words. Required — this is the audit trail. */
    quote: string;
  }>;
  /** The source's own words for the general rule. Required — the audit trail. */
  quote: string;
}

export function axleSpacingRoundingsEqual(
  a: AxleSpacingRounding,
  b: AxleSpacingRounding,
): boolean {
  const key = (r: AxleSpacingRounding): string =>
    JSON.stringify([
      r.direction,
      r.toMultipleOfFt,
      [...r.carveOuts]
        .map((c) => [c.fromFt, c.toFt, c.treatAsFt])
        .sort((x, y) => (x[0] as number) - (y[0] as number)),
    ]);
  return key(a) === key(b);
}

/**
 * The spacing a table is actually read at.
 *
 * A CARVE-OUT WINS OVER THE GENERAL RULE, which is the only ordering that makes
 * a carve-out mean anything. With no rule at all the measurement is returned
 * untouched, which is what `evaluateAxleSpacingTable` has always done and what
 * every table on file still gets.
 */
export function roundedSpacingFt(
  gapFt: number,
  rounding: AxleSpacingRounding | undefined,
): number {
  if (rounding === undefined) return gapFt;
  for (const carve of rounding.carveOuts) {
    if (gapFt >= carve.fromFt && gapFt <= carve.toFt) return carve.treatAsFt;
  }
  const step = rounding.toMultipleOfFt;
  if (!(step > 0)) return gapFt;
  const quotient = Math.round((gapFt / step) * 1e9) / 1e9;
  const stepped =
    rounding.direction === 'up'
      ? Math.ceil(quotient)
      : rounding.direction === 'down'
        ? Math.floor(quotient)
        : Math.round(quotient);
  return Math.round(stepped * step * 1e6) / 1e6;
}
