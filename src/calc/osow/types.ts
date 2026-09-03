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
import type { EscortRule } from './escortRules.js';

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

/** One band of a weight-stepped permit fee. `maxLbs: null` = open-ended top. */
export interface WeightBand {
  minLbs: number;
  maxLbs: number | null;
  feeUsd: number;
}

export function weightBandsEqual(a: WeightBand, b: WeightBand): boolean {
  return a.minLbs === b.minLbs && a.maxLbs === b.maxLbs && a.feeUsd === b.feeUsd;
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
    a.roundDollars === b.roundDollars
  );
}

/** Round to cents. Binary floating point makes this necessary before, not
 *  only after, a rounding step that reads whole dollars. */
function toCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Distance-priced overweight amount, rounded to cents.
 *
 * ORDER OF OPERATIONS IS THE STATE'S, NOT OURS, and Florida's rule publishes
 * its own worked example so it can be checked: 112,000 lb over 67.5 miles is
 * "(75 miles X $0.32) plus $3.33 = $27.33 rounded up to $28.00". Miles round up
 * to the increment first, the flat administrative amount goes in before the
 * dollar rounding, and only then do the minimum and maximum apply.
 */
export function perMileAmount(
  rate: PerMileRate,
  grossWeightLbs: number,
  miles: number,
): number {
  let units = 1;
  if (rate.perIncrementLbs !== null && rate.perIncrementLbs > 0) {
    const excess = grossWeightLbs - (rate.excessBaseLbs ?? 0);
    if (excess <= 0) return 0;
    const exact = excess / rate.perIncrementLbs;
    units = rate.roundIncrementUp ? Math.ceil(exact) : Math.floor(exact);
  }
  const billedMiles =
    rate.roundMilesUpTo !== undefined && rate.roundMilesUpTo > 0
      ? Math.ceil(miles / rate.roundMilesUpTo) * rate.roundMilesUpTo
      : miles;
  let raw = toCents(
    rate.ratePerMileUsd * billedMiles * units + (rate.addAfterUsd ?? 0),
  );
  if (rate.roundDollars === 'nearest') raw = Math.round(raw);
  else if (rate.roundDollars === 'up') raw = Math.ceil(raw);
  const floored = rate.minimumUsd === null ? raw : Math.max(raw, rate.minimumUsd);
  const capped =
    rate.maximumUsd === null ? floored : Math.min(floored, rate.maximumUsd);
  return toCents(capped);
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
  kind: 'bands' | 'perMile' | 'includedInBaseFee' | 'notPriceable';
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
  kind: 'cumulative' | 'overweightOnly' | 'greaterOf';
  /** What the source actually says. Required — this is the audit trail. */
  explanation: string;
}

/** Same reasoning as `overweightPricingEqual`: the MODEL is the claim. */
export function combinedFeeRulesEqual(a: CombinedFeeRule, b: CombinedFeeRule): boolean {
  return a.kind === b.kind;
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
   */
  feesDependOnDistance: boolean;
}

/** A second permit issuer inside one state. */
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
}

export function additionalAuthoritiesEqual(
  a: AdditionalAuthority,
  b: AdditionalAuthority,
): boolean {
  return a.name === b.name && a.priceable === b.priceable;
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
