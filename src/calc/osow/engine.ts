/**
 * OS/OW permit-and-cost engine — PURE function.
 *
 * Takes a load and a jurisdiction's rule set; returns the per-jurisdiction
 * cost breakdown (oversize permit · overweight step · supervision · service
 * fee · escorts · route analysis) with a citation behind every line.
 *
 * THE CONTRACT, WHICH IS THE POINT OF THE MODULE
 * ----------------------------------------------
 * `{ …, warnings: string[], requiresManualReview: boolean }` — the same shape
 * as LoadMode's customs calculator, for the same reason. A permit engine that
 * cannot answer must SAY SO. There is no path through this file that emits a
 * confident dollar figure the sources do not support:
 *
 *   - a superload           → no published fee exists; review, no number
 *   - conflicting sources   → the field resolves to null and shows as a range
 *   - a missing jurisdiction→ review, no number
 *   - an undecidable escort → review, no number
 *   - unknown axle spacing  → weight legality reported as unknown, not "legal"
 *
 * A `null` amount on a line is a first-class outcome, not an error. It means
 * "this fee applies and we cannot price it", which is a materially different
 * statement from "this fee is $0" — and the difference is the whole reason
 * the type is `number | null`.
 *
 * WHAT THIS ENGINE DOES NOT PRICE: escorts. Texas tells us how MANY escorts a
 * load needs; it does not set what they cost, because pilot cars are private
 * vendors on a market rate. So the engine returns the required COUNT and the
 * caller multiplies by its own `pilot_car` accessorial rate. Inventing a
 * state-sourced escort price would be the exact failure this module exists to
 * prevent.
 */
import {
  isInEffect,
  resolveSourced,
  citeOf,
  todayIso,
  type IsoDate,
  type Resolution,
  type SourceDoc,
  type Sourced,
} from './provenance.js';
import {
  evaluateEscortRules,
  formatFtIn,
  type EscortContext,
  type EscortEvaluation,
  type RouteClass,
} from './escortRules.js';
import {
  checkBridgeFormula,
  type Axle,
  type BridgeFormulaResult,
} from './bridgeFormula.js';
import {
  applyTransactionFee,
  chargedIncrements,
  combinedFeeRulesEqual,
  evaluateAxleSpacingTable,
  evaluateStateBridgeTable,
  stateBridgeTablesEqual,
  tableGovernsGross,
  tandemAllowanceDecisiveAxles,
  tandemAxleAllowancesEqual,
  exceeds,
  oversizeBandApplies,
  oversizeFeeBandsEqual,
  perMileAmount,
  perMileAmountBreakdown,
  perMileRatesEqual,
  overweightPricingEqual,
  additionalAuthoritiesEqual,
  thresholdsEqual,
  weightBandsEqual,
  weightBandApplies,
  weightBandAmount,
  conditionalFeesEqual,
  transactionFeesEqual,
  MILEAGE_SPLIT_NOTE,
  type AdditionalAuthority,
  type AxleSpacingTableResult,
  type AxleSpacingWeightTable,
  type CombinedFeeRule,
  type JurisdictionOsowRules,
  type StateBridgeTable,
  type StateBridgeTableResult,
  type OversizeBandInput,
  type OversizeFeeBand,
  type OverweightPricing,
  type PerMileRate,
  type Threshold,
  type WeightBand,
} from './types.js';
import {
  absorbedTotalUsd,
  aggregateExceedsThreshold,
  aggregateReviewWarning,
  priceSourced,
  type AbsorbedFeeConflict,
} from './materiality.js';
import { osowRulesFor } from './jurisdictions/index.js';
import { seasonalAdvisoryFor, type SeasonalAdvisory } from './seasonal/advisory.js';
import type { SeasonalContext } from './seasonal/types.js';

/**
 * Re-exported so a caller pricing an OS/OW move never has to reach past the
 * engine for the number the engine used, or for the shape of what it absorbed.
 */
export {
  IMMATERIAL_CONFLICT_THRESHOLD_USD,
  type AbsorbedFeeConflict,
} from './materiality.js';

/** Seasonal (spring-thaw) surfacing travels with the quote, so a caller never
 *  has to reach into `seasonal/` for the shape of a warning the engine emitted. */
export type { SeasonalAdvisory } from './seasonal/advisory.js';
export type { SeasonalContext, StateSeasonalSnapshot } from './seasonal/types.js';

export interface OsowLoad {
  grossWeightLbs?: number;
  widthIn?: number;
  heightIn?: number;
  overallLengthIn?: number;
  trailerLengthIn?: number;
  /**
   * Kingpin to the rearmost axle (or the rear tandem's midpoint), in inches.
   * OPTIONAL. Omitting it leaves every result exactly as it was before this
   * field existed; supplying it is what lets a KPRA-regulated state price. See
   * `LegalLimits.kingpinToRearAxleIn` and `Measure` in `escortRules.ts`.
   */
  kingpinToRearAxleIn?: number;
  frontOverhangIn?: number;
  rearOverhangIn?: number;
  /** Full axle layout, when known. Enables bridge-formula checking. */
  axles?: Axle[];
  /** Outer-to-outer axle spacing in feet — needed for Texas's short-spacing
   *  superload trigger even when the full layout is unknown. */
  axleSpacingFt?: number;
  /**
   * Axles on the combination INCLUDING the steering axle, when the full layout
   * in `axles` is not known. OPTIONAL, and it exists because Colorado prices the
   * overweight permit per axle — "$30 plus $10 per axle" — while a quote that
   * can state a count often cannot state each axle's position and weight, which
   * is all `axles` is for. Falls back to `axles.length` when only that is given;
   * a caller supplying neither leaves a per-axle band UNDECIDED rather than
   * unpriced-at-zero. See `WeightBand.perAxleUsd`.
   */
  axleCount?: number;
  routeClass?: RouteClass;
  subjectiveAnswers?: Record<string, boolean>;
  /** Miles inside this jurisdiction. Phase 2 — see MILEAGE_SPLIT_NOTE. */
  milesInJurisdiction?: number;
}

export interface OsowFeeLine {
  code: string;
  name: string;
  /** `null` = this fee applies but cannot be priced. NOT the same as 0. */
  amountUsd: number | null;
  /** Set when official sources disagree — the honest range. */
  lowUsd?: number;
  highUsd?: number;
  note?: string;
  sources: SourceDoc[];
}

/** Which dimensions put the load over the jurisdiction's legal limits. */
export interface OverDimension {
  width: boolean;
  height: boolean;
  length: boolean;
  frontOverhang: boolean;
  rearOverhang: boolean;
  weight: boolean;
  /** Human-readable summary, e.g. ["width 14'6\" over 8'6\""]. */
  details: string[];
}

export interface OsowJurisdictionResult {
  jurisdiction: string;
  jurisdictionName: string;
  /** False when the load is legal and needs no permit at all. */
  permitRequired: boolean;
  overDimension: OverDimension;
  lines: OsowFeeLine[];
  /** Sum of the priced lines. `null` when any applicable line is unpriceable. */
  subtotalUsd: number | null;
  /** Low/high bound across conflicted lines, when a range is meaningful. */
  subtotalLowUsd: number | null;
  subtotalHighUsd: number | null;
  escorts: EscortEvaluation;
  /** Escort count the caller must price with its own pilot-car rate. */
  escortsRequired: number;
  bridge: BridgeFormulaResult | null;
  /**
   * A STATE'S OWN AXLE-SPACING WEIGHT TABLE, evaluated. OPTIONAL and omitted
   * everywhere but Michigan, so every existing caller's result is byte-identical
   * to before this field existed.
   *
   * One entry per in-effect published table that GOVERNS this load's gross
   * weight. Michigan's statute and MDOT's T-1 disagree about two of the rows, so
   * a Michigan load over 80,000 lb produces two entries and the engine reports
   * the disagreement only when the two verdicts actually differ FOR THIS LOAD.
   */
  axleSpacingTables?: Array<{ source: SourceDoc; result: AxleSpacingTableResult }>;
  /**
   * A STATE'S OWN BRIDGE TABLE, evaluated. OPTIONAL and omitted everywhere but
   * South Carolina. When it is present, `bridge` is `null` BY DESIGN: the
   * federal table does not govern here and falling through to it would test the
   * load against another state's numbers. See `StateBridgeTable`.
   */
  stateBridge?: StateBridgeTableResult;
  superload: boolean;
  routeInspectionRequired: boolean | null;
  warnings: string[];
  requiresManualReview: boolean;
  /**
   * THE DATA-QUALITY CHANNEL — internal, not customer copy.
   *
   * `requiresManualReview` used to carry two different claims at once: "we
   * cannot give you a reliable number" and "our sources disagree". Only the
   * first is a reason to stop a quote. Splitting them lets an immaterial fee
   * disagreement resolve to the higher figure and price cleanly, WITHOUT the
   * finding being lost — every absorbed conflict lands here with its candidates,
   * its documents and its dollar spread, exactly as an escort `advisory` states
   * a real exclusion in `warnings[]` without invalidating the price.
   */
  dataQuality: string[];
  /** Fee conflicts quoted at the higher figure instead of escalated. */
  absorbedConflicts: AbsorbedFeeConflict[];
  /** Money those decisions moved in this jurisdiction. See the aggregate cap. */
  absorbedConflictTotalUsd: number;
  sources: SourceDoc[];
  asOf: IsoDate;
  /**
   * SEASONAL (SPRING THAW) SURFACING for this state, when the caller supplied a
   * `SeasonalContext`. OPTIONAL: omitted entirely when no seasonal data was
   * passed, so every existing caller's result is byte-identical to before.
   *
   * It NEVER changes a fee or a limit — see `seasonal/advisory.ts` for the
   * three reasons a restriction is flagged rather than applied. Its warnings
   * are merged into `warnings[]` and its notes into `dataQuality[]` so a
   * consumer that only reads those two arrays needs no change at all.
   */
  seasonal?: SeasonalAdvisory;
}

/**
 * Structural, so a `Resolution<T>` and a `PricedResolution<T>` are both
 * acceptable — the citation list only ever needs the candidate rows.
 */
interface HasCandidates {
  candidates: ReadonlyArray<{ source: SourceDoc }>;
}

function pushSources(into: SourceDoc[], from: HasCandidates): void {
  for (const c of from.candidates) {
    if (!into.some((s) => s.id === c.source.id)) into.push(c.source);
  }
}

function sourcesOf(r: HasCandidates): SourceDoc[] {
  const out: SourceDoc[] = [];
  pushSources(out, r);
  return out;
}

/**
 * The honest RANGE fields on a fee line — present only when a disagreement was
 * escalated. An ABSORBED conflict deliberately shows no range: it resolved to
 * the higher figure and prices like any settled line, and printing "$8–$10"
 * beside a $10 amount would re-raise the very question the threshold settled.
 */
function rangeOf(priced: { lowUsd: number | null; highUsd: number | null }): {
  lowUsd?: number;
  highUsd?: number;
} {
  if (priced.lowUsd === null || priced.highUsd === null) return {};
  return { lowUsd: priced.lowUsd, highUsd: priced.highUsd };
}

/**
 * Resolve a field that a jurisdiction may legitimately not have.
 *
 * `resolveSourced` treats an empty candidate list as a GAP — "we hold no data
 * for this field" — and forces manual review, which is right for a fee every
 * state charges. It is wrong for a rule only some states have: Kentucky's
 * combined permit has no separate overweight step, and warning that its
 * overweight band is missing would report a data gap where the correct
 * statement is "this state does not charge one".
 *
 * `null` here means "not applicable in this jurisdiction". A field that IS
 * applicable but unsourced must be given an empty array explicitly and go
 * through `resolveSourced`, so the gap is still loud.
 */
function resolveIfPresent<T>(
  field: string,
  candidates: Sourced<T>[] | undefined,
  asOf: IsoDate,
  equals?: (a: T, b: T) => boolean,
): Resolution<T> | null {
  if (candidates === undefined || candidates.length === 0) return null;
  return resolveSourced(field, candidates, asOf, equals);
}

/**
 * Does a measurement exceed a resolved legal limit? Returns `null` when
 * either the measurement or the limit is unknown — the caller must not read
 * that as "within limits".
 */
function overLimit(
  measurement: number | undefined,
  limit: Resolution<number>,
): boolean | null {
  if (measurement === undefined || limit.value === null) return null;
  return measurement > limit.value;
}

/**
 * Show the per-mile arithmetic on the line item. A distance-priced fee that
 * appears as a bare dollar amount is impossible to check; spelling out the
 * rate, the increments and the miles lets a dispatcher verify it against the
 * state's own schedule without opening the code.
 *
 * EVERY MODIFIER THAT MOVED THE AMOUNT IS NAMED, and that is not decoration.
 * The public calculator publishes this string directly beneath the number it
 * describes, under a promise that every line traces to the statute or fee
 * schedule it came from. When the note listed only the rate and the miles, a
 * 26-mile Florida move printed "26 mi in Florida, × $0.36 per mile" — an
 * explanation that produces $9.36 — next to its correct $22.00, leaving $12.64
 * of a real fee with no stated cause. Florida was the outlier only because it
 * is the one state using `roundMilesUpTo`, `addAfterUsd` and `roundDollars`.
 *
 * It renders `perMileAmountBreakdown` rather than re-deriving the arithmetic,
 * so the explanation is built from the same steps that produced the figure and
 * a future modifier cannot be priced without also being described.
 */
function describePerMile(
  rate: PerMileRate,
  grossWeightLbs: number,
  miles: number,
  jurisdictionName: string,
): string {
  const step = perMileAmountBreakdown(rate, grossWeightLbs, miles);
  if (step.belowExcessBase) {
    return `${miles} mi in ${jurisdictionName}, but ${grossWeightLbs.toLocaleString()} lb is at or under the ${(rate.excessBaseLbs ?? 0).toLocaleString()} lb this rate is charged above, so no distance charge arises = $0.00`;
  }
  const parts = [`${miles} mi in ${jurisdictionName}`];
  if (step.milesIncrement !== null) {
    parts.push(
      `billed as ${step.billedMiles} mi (fees are set in ${step.milesIncrement} mi increments, a part increment charged in full)`,
    );
  }
  if (rate.perIncrementLbs !== null && rate.perIncrementLbs > 0) {
    const exact =
      (grossWeightLbs - (rate.excessBaseLbs ?? 0)) / rate.perIncrementLbs;
    parts.push(
      `× $${rate.ratePerMileUsd} per mile per ${rate.perIncrementLbs.toLocaleString()} lb over ${(rate.excessBaseLbs ?? 0).toLocaleString()} lb × ${step.units} increment${step.units === 1 ? '' : 's'}${rate.roundIncrementUp && exact !== step.units ? ' (part increment charged in full)' : ''}`,
    );
  } else {
    parts.push(`× $${rate.ratePerMileUsd} per mile`);
  }
  if (step.addAfterUsd > 0) {
    parts.push(`plus a $${step.addAfterUsd.toFixed(2)} flat charge inside the rounding`);
  }
  if (rate.roundDollars === 'up') parts.push('rounded up to the whole dollar');
  else if (rate.roundDollars === 'nearest') parts.push('rounded to the nearest whole dollar');
  if (rate.minimumUsd !== null) parts.push(`minimum $${rate.minimumUsd.toFixed(2)}`);
  if (rate.maximumUsd !== null) parts.push(`capped at $${rate.maximumUsd.toFixed(2)}`);
  // The note closes on its own result, so a reader can check the sentence
  // against the column beside it without doing the arithmetic in their head.
  return `${parts.join(', ')} = $${step.amountUsd.toFixed(2)}`;
}

/** Pick the weight band containing `weightLbs`. */
function bandFor(bands: WeightBand[], weightLbs: number): WeightBand | null {
  return (
    bands.find(
      (b) =>
        weightLbs >= b.minLbs && (b.maxLbs === null || weightLbs <= b.maxLbs),
    ) ?? null
  );
}

/**
 * Price one jurisdiction's OS/OW permit for a load.
 *
 * `asOf` selects which effective-dated rows apply, so a quote issued today
 * and the same quote re-priced next year both read the fee schedule that was
 * actually in force on their own date.
 */
export function calculateOsowForJurisdiction(
  rules: JurisdictionOsowRules,
  load: OsowLoad,
  asOf: IsoDate = todayIso(),
): OsowJurisdictionResult {
  const warnings: string[] = [];
  const dataQuality: string[] = [];
  const absorbedConflicts: AbsorbedFeeConflict[] = [];
  const sources: SourceDoc[] = [];
  const lines: OsowFeeLine[] = [];
  let requiresManualReview = false;
  /**
   * A LIVE DISAGREEMENT ABOUT A REQUIREMENT SWITCHES FEE ABSORPTION OFF FOR THE
   * WHOLE JURISDICTION.
   *
   * `materiality.ts` may only ever settle money. This flag is the fence around
   * that: when this state's own sources disagree about a legal limit, a
   * permit-vs-no-permit threshold, an escort trigger, a superload trigger, how
   * the state prices at all, how the two components combine, or whether a second
   * agency also issues, then EVERY fee conflict here is escalated exactly as it
   * was before this feature existed — at any dollar value.
   *
   * The reason it is jurisdiction-wide rather than per-field is that these
   * disagreements are not independent of the fee. North Carolina is the case:
   * its statute says the legal height is 14 ft and the EVO Handbook says
   * 13 ft 6 in, and the $12-per-over-legal-dimension schedule therefore prints
   * $12 or $24 for the same load. The $12 gap is small; what is actually in
   * dispute is whether the load is over height at all, which is not a rounding
   * question. Absorbing the fee would put a confident $24 beside "we cannot tell
   * whether this needs a height permit".
   *
   * "LIVE" is doing real work. A dormant disagreement — Indiana's three
   * superload weights, on a load far below all three — does not gate anything,
   * for the same reason the engine already declines to warn about it: noise on a
   * settled question trains people to ignore the warning that matters.
   */
  let requirementConflict = false;
  /**
   * An explicit count wins over the layout, and the layout answers when only it
   * is given. `undefined` stays `undefined` — never 0 — so a per-axle band is
   * undecided rather than free. See `OsowLoad.axleCount`.
   */
  const axleCount = load.axleCount ?? load.axles?.length;

  // ── 1. Legal limits: is a permit needed at all? ────────────────────────
  const widthLimit = resolveSourced(`${rules.name} legal width`, rules.legalLimits.widthIn, asOf);
  const heightLimit = resolveSourced(`${rules.name} legal height`, rules.legalLimits.heightIn, asOf);
  /**
   * KPRA is OPTIONAL and silent when absent, exactly like overhang and overall
   * length: a state that publishes no kingpin limit holds no row and is not
   * warned about a rule it does not have.
   */
  const kpraLimit = resolveIfPresent(
    `${rules.name} legal kingpin-to-rearmost-axle distance`,
    rules.legalLimits.kingpinToRearAxleIn,
    asOf,
  );
  /**
   * A STATE THAT REGULATES THE SEMITRAILER BY KPRA RATHER THAN BY LENGTH.
   *
   * California is the case. CVC §35400(b)(4) publishes no semitrailer length
   * limit at all — it exempts the semitrailer from the 40 ft single-vehicle cap
   * whenever KPRA is within limits — so `trailerLengthIn` is legitimately EMPTY
   * and `resolveSourced` correctly reports a gap and forces review. That gap is
   * real right up until the caller supplies the measurement the state actually
   * regulates on. Once KPRA is on the load, the question the empty list was
   * asking has been answered, and continuing to demand a trailer length the
   * state does not publish would send a fully-specified move to a human for
   * nothing.
   *
   * Deliberately conditioned on DATA, not on a state code: it takes an empty
   * length list AND a KPRA row AND a supplied KPRA. Every jurisdiction that
   * publishes a trailer length keeps its length check untouched, and a state
   * with neither is unaffected.
   */
  const trailerLengthAnsweredByKpra =
    rules.legalLimits.trailerLengthIn.length === 0 &&
    kpraLimit !== null &&
    load.kingpinToRearAxleIn !== undefined;
  const lengthLimit = trailerLengthAnsweredByKpra
    ? null
    : resolveSourced(`${rules.name} legal trailer length`, rules.legalLimits.trailerLengthIn, asOf);
  /**
   * Overhang limits are OPTIONAL for the same reason overall length is: Ohio,
   * Pennsylvania and Indiana publish none, regulating overhang through flagging
   * and escort rules instead. Running `resolveSourced` on an absent list would
   * warn — on every quote in three states — about a limit those states do not
   * impose. Their real overhang rules are in `escortRules` and still fire.
   */
  const frontOverhangLimit = resolveIfPresent(`${rules.name} legal front overhang`, rules.legalLimits.frontOverhangIn, asOf);
  const rearOverhangLimit = resolveIfPresent(`${rules.name} legal rear overhang`, rules.legalLimits.rearOverhangIn, asOf);
  const grossLimit = resolveSourced(`${rules.name} legal gross weight`, rules.legalLimits.grossWeightLbs, asOf);
  /**
   * Overall combination length is OPTIONAL, and its absence must stay silent.
   * Texas's general permit turns on the semitrailer length, so Phase 1 holds
   * no overall-length row for it — and `resolveSourced` on an empty list
   * correctly reports "nothing on file" and forces review. Running that on
   * every Texas quote would flag a limit Texas does not impose. So an absent
   * list means "this jurisdiction does not cap overall combination length in
   * the data we hold", which is a different claim from "we looked and found
   * nothing", and only the latter deserves a warning.
   */
  const overallLengthLimit = resolveIfPresent(
    `${rules.name} legal overall combination length`,
    rules.legalLimits.overallLengthIn,
    asOf,
  );

  for (const r of [widthLimit, heightLimit, lengthLimit, kpraLimit, frontOverhangLimit, rearOverhangLimit, grossLimit, overallLengthLimit]) {
    if (r === null) continue;
    pushSources(sources, r);
    warnings.push(...r.warnings);
    if (r.requiresManualReview) requiresManualReview = true;
    // A legal limit is the permit-vs-no-permit threshold itself. Two sources
    // disagreeing about it is never a rounding question.
    if (r.conflict) requirementConflict = true;
  }

  const details: string[] = [];
  const checks: Array<[keyof Omit<OverDimension, 'details'>, number | undefined, Resolution<number> | null, string, 'in' | 'lb']> = [
    ['width', load.widthIn, widthLimit, 'Width', 'in'],
    ['height', load.heightIn, heightLimit, 'Height', 'in'],
    ['length', load.trailerLengthIn, lengthLimit, 'Trailer length', 'in'],
    /**
     * Counted as a LENGTH over-dimension, because that is what it is: a
     * semitrailer past the state's kingpin limit needs a length permit, and the
     * quote's oversize side is keyed on `overDimension.length`. Silent unless
     * BOTH the state publishes a KPRA limit and the caller supplied a KPRA —
     * `overLimit` returns null on a missing measurement, never `false`.
     */
    ['length', load.kingpinToRearAxleIn, kpraLimit, 'Kingpin-to-rearmost-axle distance', 'in'],
    ['length', load.overallLengthIn, overallLengthLimit, 'Overall combination length', 'in'],
    ['frontOverhang', load.frontOverhangIn, frontOverhangLimit, 'Front overhang', 'in'],
    ['rearOverhang', load.rearOverhangIn, rearOverhangLimit, 'Rear overhang', 'in'],
    ['weight', load.grossWeightLbs, grossLimit, 'Gross weight', 'lb'],
  ];

  const overDimension: OverDimension = {
    width: false, height: false, length: false,
    frontOverhang: false, rearOverhang: false, weight: false,
    details,
  };

  for (const [key, measurement, limit, label, unit] of checks) {
    if (limit === null) continue;
    const over = overLimit(measurement, limit);
    if (over === true) {
      overDimension[key] = true;
      const fmt = (n: number) => (unit === 'in' ? formatFtIn(n) : `${n.toLocaleString()} lb`);
      details.push(`${label} ${fmt(measurement as number)} exceeds the ${fmt(limit.value as number)} legal limit`);
    }
  }

  // ── 1b. A weight law expressed PER AXLE AND SPACING (Michigan) ────────
  /**
   * The block that makes `overDimension.weight` mean something in a state with
   * no gross-weight limit.
   *
   * Michigan's legal weight is not a number, it is the outcome of MCL
   * 257.722(1) evaluated over every adjacent-axle gap, and the table it is
   * evaluated from is selected by the load's own GROSS WEIGHT rather than by the
   * road. Everything below is driven from `rules.axleSpacingWeightTables`; there
   * is no `if (state === 'MI')` here and there never has been an equivalent line
   * for any state.
   */
  let axleSpacingTables:
    | Array<{ source: SourceDoc; result: AxleSpacingTableResult }>
    | undefined;
  if (rules.axleSpacingWeightTables !== undefined) {
    const tableRows = rules.axleSpacingWeightTables.filter((r) => isInEffect(r, asOf));
    for (const r of tableRows) {
      if (!sources.some((s) => s.id === r.source.id)) sources.push(r.source);
    }
    const gross = load.grossWeightLbs;
    if (tableRows.length === 0) {
      warnings.push(
        `${rules.name} sets its weight maxima per axle and per axle spacing, and no such table is on file as effective on ${asOf}. Weight legality could not be determined.`,
      );
      requiresManualReview = true;
    } else if (gross === undefined) {
      warnings.push(
        `${rules.name} selects between two axle-load tables on GROSS WEIGHT rather than on road type, and no gross weight was supplied. Which table governs this move could not be determined.`,
      );
      requiresManualReview = true;
    } else {
      const governing = tableRows.filter((r) => tableGovernsGross(r.value, gross));
      if (governing.length === 0) {
        warnings.push(
          `No ${rules.name} axle-load table on file governs a gross weight of ${gross.toLocaleString()} lb. The tables select on gross weight and none of them names this one, so weight legality could not be determined.`,
        );
        requiresManualReview = true;
      } else if (load.axles === undefined || load.axles.length === 0) {
        // The honest degradation, and the same one the federal bridge check
        // makes: we can say a table governs, we cannot say whether it is met.
        /**
         * REVIEW, NOT A SILENT WARNING, AND ONLY WHERE THE STATE'S OWN TABLE IS
         * THE ONE THAT DECIDES.
         *
         * In a state whose weight law is a flat number, a missing axle layout
         * costs only the bridge-formula check and the gross limit still answers
         * the permit question. In Michigan there IS no gross limit to fall back
         * on: MDOT's own FAQ says "Permitted loads are based on Michigan's legal
         * allowable axle weights and not federal bridge weights", so without the
         * layout the answer to "does this move need a $50 overweight permit?" is
         * genuinely unknown. Warning and pricing on regardless would print a
         * confident $15 oversize-only permit beside a load that may owe $50.
         */
        warnings.push(
          `${rules.name} does not set a general gross-weight limit — ${(governing[0] as Sourced<AxleSpacingWeightTable>).value.explanation} Axle positions and per-axle weights were not supplied, so the axle table could not be evaluated and this quote cannot say whether the move is overweight in ${rules.name}. An overweight permit may be required and is not included above.`,
        );
        requiresManualReview = true;
      } else {
        const axles = load.axles;
        const evaluated = governing.map((r) => ({
          source: r.source,
          table: r.value,
          result: evaluateAxleSpacingTable(r.value, axles),
        }));
        axleSpacingTables = evaluated.map((e) => ({ source: e.source, result: e.result }));

        const verdicts = new Set(evaluated.map((e) => e.result.overweight));
        const first = evaluated[0] as (typeof evaluated)[number];

        /**
         * TWO PUBLISHED TABLES THAT DISAGREE ABOUT THIS LOAD. Surfaced only when
         * the verdicts actually differ, on the same discipline the superload and
         * route-inspection conflicts already use: a load every candidate agrees
         * is legal hears nothing.
         */
        if (verdicts.size > 1) {
          const detail = evaluated
            .map(
              (e) =>
                `${e.result.overweight ? 'overweight' : 'legal'} per ${citeOf(e.source)}`,
            )
            .join(' — versus — ');
          warnings.push(
            `${rules.name}'s own sources disagree about whether this axle configuration is legal: ${detail}. Neither reading has been adopted. The permit below is priced on the stricter reading — a permit IS required — and the movement must be confirmed with the permitting office.`,
          );
          requiresManualReview = true;
          requirementConflict = true;
        }

        if ([...verdicts].some((v) => v)) {
          overDimension.weight = true;
          const worst = evaluated
            .flatMap((e) => e.result.violations)
            .reduce<(typeof evaluated)[number]['result']['violations'][number] | null>(
              (w, v) => (w === null || v.overageLbs > w.overageLbs ? v : w),
              null,
            );
          if (worst !== null) {
            details.push(
              `Axle ${worst.axleNumber} carries ${worst.actualLbs.toLocaleString()} lb against the ${(worst.maxAxleLoadLbs ?? 0).toLocaleString()} lb ${rules.name} allows at ${worst.gapFt} ft of spacing to its nearest neighbouring axle`,
            );
          }
        }

        /**
         * A SPACING NO SUBDIVISION NAMES. Michigan's statute allows 13,000 lb at
         * MORE than 3.5 ft and 9,000 lb at LESS than 3.5 ft, so a pair of axles
         * spaced at exactly 42.000 inches falls in a hole in the law, while
         * MDOT's own table closes it. Rounding such a gap into the neighbouring
         * band would resolve, in favour of one document, a defect that consists
         * precisely of the two not meeting.
         */
        const holes = evaluated.filter((e) => e.result.unnamedGapAxles.length > 0);
        if (holes.length > 0) {
          const axleList = [
            ...new Set(holes.flatMap((e) => e.result.unnamedGapAxles)),
          ].sort((a, b) => a - b);
          warnings.push(
            `${rules.name}'s published axle-spacing bands name no maximum for the spacing at axle${axleList.length === 1 ? '' : 's'} ${axleList.join(', ')} — the bands stop above it and start again below it, and nothing is rounded into either. Source: ${citeOf((holes[0] as (typeof evaluated)[number]).source)}. The allowable axle load there must be confirmed with the permitting office.`,
          );
          requiresManualReview = true;
          requirementConflict = true;
        }

        /**
         * THE HEAVIER TANDEM ALLOWANCE, AND ONLY WHEN IT DECIDES THE ANSWER.
         * Michigan's statute confines the 16,000 lb-per-axle assembly to
         * DESIGNATED highways and MDOT's T-1 footnote reproduces it with no route
         * condition at all — 6,000 lb of payload apart on a non-designated road.
         * An axle inside the band the allowance covers is the only load the
         * disagreement can reach, so it is the only one told about it.
         */
        const decisiveAxles = [
          ...new Set(
            evaluated.flatMap((e) =>
              tandemAllowanceDecisiveAxles(e.table, axles, e.result),
            ),
          ),
        ].sort((a, b) => a - b);
        const allowanceDecides = decisiveAxles.length > 0;
        const allowancesDisagree = evaluated.some(
          (e) => !tandemAxleAllowancesEqual(e.table.tandemAllowance, first.table.tandemAllowance),
        );
        if (allowanceDecides && allowancesDisagree) {
          const detail = evaluated
            .map((e) => {
              const allow = e.table.tandemAllowance;
              const where =
                allow === null
                  ? 'no such allowance'
                  : allow.routeClasses === null
                    ? `${allow.perAxleLbs.toLocaleString()} lb per axle with NO route condition stated`
                    : `${allow.perAxleLbs.toLocaleString()} lb per axle only on ${allow.routeClasses.join(', ')} highways`;
              return `${where} per ${citeOf(e.source)}`;
            })
            .join(' — versus — ');
          warnings.push(
            `Axle${decisiveAxles.length === 1 ? '' : 's'} ${decisiveAxles.join(', ')} sit${decisiveAxles.length === 1 ? 's' : ''} in a tandem assembly heavier than the ordinary spacing row allows and no heavier than ${rules.name}'s special tandem allowance would permit — and the state's own sources disagree about when that allowance applies: ${detail}. Neither has been adopted. Whether this configuration needs an overweight permit turns on that disagreement.`,
          );
          requiresManualReview = true;
          requirementConflict = true;
        }

        if (evaluated.some((e) => e.result.overMaxAxles === true)) {
          const maxAxles = first.table.maxAxles ?? 0;
          warnings.push(
            `This combination has ${axles.length} axles against the ${maxAxles} ${rules.name} allows without a permit. ${rules.name} permits more than ${maxAxles} axles under a special permit, so this is not a refusal — but the axle count itself needs the permitting office's agreement and is not priced separately here.`,
          );
          requiresManualReview = true;
        }
      }
    }
  }

  const permitRequired = Object.entries(overDimension)
    .filter(([k]) => k !== 'details')
    .some(([, v]) => v === true);

  // ── 2. Bridge formula — federal, EXCEPT where the state prints its own ─
  /**
   * `stateBridgeTable` is the one thing that turns the federal check off, and
   * it is data, not a state code. South Carolina transcribes its own table into
   * § 56-5-4140 and its first row disagrees with FHWA's by 1,200 lb, so running
   * the federal check there would report violations South Carolina does not have
   * and clear ones it does. See `StateBridgeTable`.
   */
  let stateBridge: StateBridgeTableResult | undefined;
  const stateBridgeRes = resolveIfPresent<StateBridgeTable>(
    `${rules.name} state bridge table`,
    rules.stateBridgeTable,
    asOf,
    stateBridgeTablesEqual,
  );
  if (stateBridgeRes !== null) {
    pushSources(sources, stateBridgeRes);
    warnings.push(...stateBridgeRes.warnings);
    if (stateBridgeRes.requiresManualReview) requiresManualReview = true;
    if (stateBridgeRes.conflict) requirementConflict = true;
    const table = stateBridgeRes.value;
    if (table !== null && load.axles !== undefined && load.axles.length >= 2) {
      stateBridge = evaluateStateBridgeTable(table, load.axles);
      for (const v of stateBridge.violations) {
        warnings.push(
          `${rules.name}'s own weight table: axles ${v.firstAxle}-${v.lastAxle} (${v.axleCount} over ${v.spanFt} ft) carry ${v.actualLbs.toLocaleString()} lb against the ${(v.allowedLbs ?? 0).toLocaleString()} lb ${table.name} allows.`,
        );
      }
      if (stateBridge.overweight) overDimension.weight = true;
      if (table.partial && stateBridge.undecidedGroups > 0) {
        warnings.push(
          `${stateBridge.undecidedGroups} of the ${stateBridge.groupsChecked} axle groups on this combination have no cell on file in ${table.name}, and ${rules.name}'s table is NOT the federal one — its two-axle row reads ${(table.tandemAxleLbs ?? 0).toLocaleString()} lb where the federal table reads 34,000 — so those groups have deliberately not been judged by the federal figures. ${table.explanation}`,
        );
        requiresManualReview = true;
      }
    } else if (table !== null && (load.axles === undefined || load.axles.length < 2)) {
      warnings.push(
        `${rules.name} publishes its own axle-group weight table rather than adopting the federal one, and axle positions and per-axle weights were not supplied, so it could not be checked. ${table.explanation}`,
      );
    }
  }

  let bridge: BridgeFormulaResult | null = null;
  if (stateBridgeRes !== null) {
    // Deliberately no federal check here. See the comment above.
  } else if (load.axles && load.axles.length >= 2) {
    bridge = checkBridgeFormula(load.axles);
    warnings.push(...bridge.warnings);
    if (bridge.requiresManualReview) requiresManualReview = true;
    for (const v of bridge.violations) {
      warnings.push(`Federal bridge formula: ${v.description}`);
    }
  } else if (load.grossWeightLbs !== undefined && grossLimit.value !== null && load.grossWeightLbs > grossLimit.value) {
    // Over gross with no axle detail. We can say a permit is needed; we
    // cannot say which axle groups are the problem, and pretending otherwise
    // would put a fabricated compliance claim on the quote.
    warnings.push(
      'Axle positions and per-axle weights were not supplied, so federal bridge-formula compliance (23 CFR 658.17) could not be verified. The permit fee below is based on gross weight only; the routing agency will check axle groups and may require a different configuration.',
    );
  }

  // ── 3. Superload triggers — checked BEFORE pricing anything ───────────
  /**
   * An ABSENT `grossWeight` list is a positive finding — "this state publishes
   * no gross-weight superload threshold" — not a gap. Illinois is the case; see
   * `SuperloadTriggers`. An EMPTY list still runs through the resolver and
   * still says loudly that we hold nothing.
   */
  const superloadWeight =
    rules.superload.grossWeight === undefined
      ? null
      : resolveSourced<Threshold>(
          `${rules.code} superload gross-weight threshold`,
          rules.superload.grossWeight,
          asOf,
          thresholdsEqual,
        );

  let superload = false;
  if (superloadWeight !== null) {
    pushSources(sources, superloadWeight);
    const gross = load.grossWeightLbs;

    if (superloadWeight.conflict) {
      /**
       * Indiana's own agencies publish three different superload weights —
       * ISP says over 108,000 lb, the DOR FAQ says 120,000 lb, the July 2026
       * DOR fee sheet says 200,000 lb — and 105 IAC 10-1.5-3 states none at
       * all. That disagreement only bites BETWEEN the lowest and highest
       * candidate. Raising it on a 90,000 lb load, which every candidate agrees
       * is not a superload, would be noise on a settled question — and noise on
       * every quote trains people to ignore the warning that matters. Same
       * treatment, for the same reason, as the route-inspection conflict below.
       */
      const values = superloadWeight.candidates.map((c) => c.value.value);
      const lo = Math.min(...values);
      const hi = Math.max(...values);
      if (gross !== undefined && gross > hi) {
        // Above every candidate: a superload on any reading of the sources.
        superload = true;
        requirementConflict = true;
        warnings.push(
          `This load is a superload in ${rules.name}: ${gross.toLocaleString()} lb is over every published threshold on file (${lo.toLocaleString()}–${hi.toLocaleString()} lb, sources disagree). A superload has no over-the-counter fee — the agency prices it after review.`,
        );
        requiresManualReview = true;
      } else if (gross === undefined || gross >= lo) {
        warnings.push(...superloadWeight.warnings);
        warnings.push(
          gross === undefined
            ? `Official sources disagree on ${rules.name}'s superload weight threshold and no gross weight was supplied, so whether this move is a superload cannot be determined.`
            : `This load's gross weight (${gross.toLocaleString()} lb) falls inside the band where ${rules.name}'s own sources disagree about the superload threshold (${lo.toLocaleString()}–${hi.toLocaleString()} lb), so whether it is issued as an ordinary permit or a superload cannot be determined from the published rules.`,
        );
        requiresManualReview = true;
        requirementConflict = true;
      }
    } else {
      warnings.push(...superloadWeight.warnings);
      if (superloadWeight.requiresManualReview) requiresManualReview = true;
      if (gross !== undefined && superloadWeight.value !== null) {
        if (exceeds(gross, superloadWeight.value)) {
          superload = true;
          warnings.push(
            `This load is a superload in ${rules.name}: ${gross.toLocaleString()} lb exceeds the ${superloadWeight.value.value.toLocaleString()} lb threshold. Superheavy permits have no published fee — the agency prices them after an engineering review of the route, and applications must be filed roughly three to four weeks ahead. Source: ${citeOf(superloadWeight.chosen?.source ?? superloadWeight.candidates[0]?.source ?? rules.escortRules[0]?.source as SourceDoc)}.`,
          );
          requiresManualReview = true;
        }
      }
    }
  }

  // Dimensional superload triggers — size alone, regardless of weight.
  const dimensionalSuperloadChecks: Array<[string, number | undefined, Sourced<Threshold>[] | undefined]> = [
    ['width', load.widthIn, rules.superload.widthIn],
    ['height', load.heightIn, rules.superload.heightIn],
    ['overall length', load.overallLengthIn, rules.superload.overallLengthIn],
  ];
  for (const [label, measurement, candidates] of dimensionalSuperloadChecks) {
    const res = resolveIfPresent<Threshold>(
      `${rules.code} superload ${label} threshold`,
      candidates,
      asOf,
      thresholdsEqual,
    );
    if (res === null) continue;
    pushSources(sources, res);
    if (res.conflict) {
      /**
       * Same banding as the gross-weight conflict above. New York is the live
       * case: its superloads page says a load "greater than 160 feet in length"
       * is a superload while the PERM 12S form it links to says "at or greater
       * than 160 feet". They differ for exactly one load — one measuring 160 ft
       * 0 in — and nowhere else, so only that load hears about it.
       */
      if (measurement === undefined) continue;
      const values = res.candidates.map((c) => c.value.value);
      const lo = Math.min(...values);
      const hi = Math.max(...values);
      if (measurement > hi) {
        superload = true;
        requirementConflict = true;
        warnings.push(
          `This load is a superload in ${rules.name} on ${label} alone: ${formatFtIn(measurement)} is over every published threshold on file. A superload is not issued over the counter — the agency prices it after review.`,
        );
        requiresManualReview = true;
      } else if (measurement >= lo) {
        warnings.push(...res.warnings);
        warnings.push(
          `This load's ${label} (${formatFtIn(measurement)}) sits exactly where ${rules.name}'s own sources disagree about the superload threshold, so whether it is issued over the counter cannot be determined from the published rules.`,
        );
        requiresManualReview = true;
        requirementConflict = true;
      }
      continue;
    }
    warnings.push(...res.warnings);
    if (res.requiresManualReview) requiresManualReview = true;
    if (res.value === null || measurement === undefined) continue;
    if (exceeds(measurement, res.value)) {
      superload = true;
      warnings.push(
        `This load is a superload in ${rules.name} on ${label} alone: ${formatFtIn(measurement)} against a ${formatFtIn(res.value.value)} threshold. A superload is not issued over the counter — the agency prices it after review. Source: ${citeOf((res.chosen ?? res.candidates[0] as Sourced<Threshold>).source)}.`,
      );
      requiresManualReview = true;
    }
  }

  // The trigger a gross-weight-only check misses: heavy load, short trailer.
  const shortSpacing = resolveSourced(
    `${rules.code} short-axle-spacing superload trigger`,
    rules.superload.shortSpacing,
    asOf,
    (a, b) => a.minLbs === b.minLbs && a.maxLbs === b.maxLbs && a.minAxleSpacingFt === b.minAxleSpacingFt,
  );
  pushSources(sources, shortSpacing);
  if (shortSpacing.value !== null && load.grossWeightLbs !== undefined) {
    const s = shortSpacing.value;
    const inBand = load.grossWeightLbs >= s.minLbs && load.grossWeightLbs <= s.maxLbs;
    if (inBand) {
      const spacing = load.axleSpacingFt
        ?? (bridge ? bridge.overallLengthFt : undefined);
      if (spacing === undefined) {
        warnings.push(
          `Loads between ${s.minLbs.toLocaleString()} and ${s.maxLbs.toLocaleString()} lb are a superload in ${rules.name} when axle spacing is under ${s.minAxleSpacingFt} ft. Axle spacing was not supplied, so this cannot be ruled out and the permit may be superheavy rather than general.`,
        );
        requiresManualReview = true;
      } else if (spacing < s.minAxleSpacingFt) {
        superload = true;
        warnings.push(
          `This load is a superload in ${rules.name}: ${load.grossWeightLbs.toLocaleString()} lb over only ${spacing} ft of axle spacing, under the ${s.minAxleSpacingFt} ft minimum for a general permit in this weight band.`,
        );
        requiresManualReview = true;
      }
    }
  }

  // ── 4. Route inspection triggers (incl. the unresolved height conflict) ─
  let routeInspectionRequired: boolean | null = false;
  const inspectionChecks: Array<[string, number | undefined, Resolution<Threshold>]> = [
    ['width', load.widthIn, resolveSourced(`${rules.code} route-inspection width threshold`, rules.routeInspection.widthIn, asOf, thresholdsEqual)],
    ['height', load.heightIn, resolveSourced(`${rules.code} route-inspection height threshold`, rules.routeInspection.heightIn, asOf, thresholdsEqual)],
    ['length', load.overallLengthIn, resolveSourced(`${rules.code} route-inspection length threshold`, rules.routeInspection.lengthIn, asOf, thresholdsEqual)],
  ];

  for (const [label, measurement, res] of inspectionChecks) {
    pushSources(sources, res);
    if (res.conflict) {
      // Only surface the conflict when the load is actually near the disputed
      // band — a 9-ft-wide load does not care that two sources disagree about
      // 18'11" vs 19'0". Noise on every quote would train people to ignore it.
      const values = res.candidates.map((c) => c.value.value);
      const lo = Math.min(...values);
      const hi = Math.max(...values);
      if (measurement !== undefined && measurement >= lo && measurement <= hi) {
        warnings.push(...res.warnings);
        warnings.push(
          `This load's ${label} (${formatFtIn(measurement)}) falls exactly in the band where the two sources disagree, so whether a route inspection is required cannot be determined from the published rules.`,
        );
        requiresManualReview = true;
        requirementConflict = true;
        routeInspectionRequired = null;
      } else if (measurement !== undefined && measurement > hi) {
        routeInspectionRequired = true;
      }
      continue;
    }
    if (res.value !== null && measurement !== undefined && exceeds(measurement, res.value)) {
      routeInspectionRequired = true;
      warnings.push(
        `A physical route inspection is required in ${rules.name} — ${label} ${formatFtIn(measurement)} is over the ${formatFtIn(res.value.value)} trigger. The inspection is arranged through the permitting office and its cost is not included here.`,
      );
    }
  }

  // ── 5. Escorts ────────────────────────────────────────────────────────
  const escortCtx: EscortContext = {
    ...(load.widthIn === undefined ? {} : { widthIn: load.widthIn }),
    ...(load.heightIn === undefined ? {} : { heightIn: load.heightIn }),
    ...(load.overallLengthIn === undefined ? {} : { overallLengthIn: load.overallLengthIn }),
    ...(load.trailerLengthIn === undefined ? {} : { trailerLengthIn: load.trailerLengthIn }),
    /**
     * KPRA is spread the same way as every other real measurement — absent
     * means absent, so a KPRA condition reads `unknown` rather than zero. It
     * must NOT take the overhang treatment below: an unstated overhang is
     * genuinely none, while an unstated KPRA is simply unknown. Defaulting it
     * to 0 would make every load look like it comfortably clears the limit.
     */
    ...(load.kingpinToRearAxleIn === undefined
      ? {}
      : { kingpinToRearAxleIn: load.kingpinToRearAxleIn }),
    /**
     * Overhang defaults to ZERO when unstated, unlike every other
     * measurement here, and the asymmetry is deliberate. Width, height and
     * weight always have a value — a blank one means we were not told. An
     * overhang is a PRESENCE: a load either extends past the deck or it does
     * not, permit applications ask about it only when it exists, and a blank
     * one means none. Treating it as unknown instead would push every load
     * without a stated overhang into manual review over a condition that is
     * absent on the overwhelming majority of them.
     */
    frontOverhangIn: load.frontOverhangIn ?? 0,
    rearOverhangIn: load.rearOverhangIn ?? 0,
    ...(load.grossWeightLbs === undefined ? {} : { grossWeightLbs: load.grossWeightLbs }),
    ...(load.routeClass === undefined ? {} : { routeClass: load.routeClass }),
    ...(load.subjectiveAnswers === undefined ? {} : { subjectiveAnswers: load.subjectiveAnswers }),
  };
  const escorts = evaluateEscortRules(rules.escortRules, escortCtx, asOf);
  warnings.push(...escorts.warnings);
  if (escorts.requiresManualReview) requiresManualReview = true;
  for (const r of rules.escortRules) {
    if (!sources.some((s) => s.id === r.source.id)) sources.push(r.source);
  }
  /**
   * Escort trigger boundaries are carried as rules that FIRE with a
   * `manualReview` reason — Alabama at exactly 12 ft wide, North Carolina's
   * front-and-rear at exactly 150 ft, Georgia's two-lane width band, Colorado's
   * 80,000-vs-85,000 interstate gross. One extra or missing pilot car on a
   * 1,200-mile run is $2,400–3,600 and an under-escorted load gets stopped, so
   * none of these is a rounding question at any dollar value.
   *
   * A rule that fired and said "this cannot be turned into a number" is a
   * live requirement disagreement and gates absorption. `undecided` rules are
   * NOT: a missing measurement or an unanswered subjective question is a gap in
   * what we were told, not a quarrel between two documents, and it is already
   * reported on its own terms.
   */
  if (escorts.applied.some((a) => a.outcome.manualReview !== undefined)) {
    requirementConflict = true;
  }

  /**
   * HOISTED, RESOLUTION ONLY. These three describe REQUIREMENTS — how the state
   * prices at all, how the two components combine, and whether a second agency
   * also issues — so the absorption gate has to know about them before the fee
   * block runs. Resolving is pure; the warnings, the source citations and the
   * review flags are all still raised at their original places below, unchanged
   * and under their original conditions.
   */
  const overweightModelRes = resolveSourced<OverweightPricing>(
    `${rules.code} overweight pricing model`,
    rules.overweightPricing,
    asOf,
    overweightPricingEqual,
  );
  const combineRes = resolveIfPresent<CombinedFeeRule>(
    `${rules.code} combined oversize/overweight fee rule`,
    rules.combinedFeeRule,
    asOf,
    combinedFeeRulesEqual,
  );
  const authRes = resolveIfPresent<AdditionalAuthority>(
    `${rules.code} additional permitting authorities`,
    rules.additionalAuthorities,
    asOf,
    additionalAuthoritiesEqual,
  );
  /**
   * `authRes.conflict` is deliberately NOT consulted. `additionalAuthorities`
   * is a LIST of distinct issuers, not competing candidates for one value —
   * New York holds three (the Thruway Authority, the Bridge Authority and New
   * York City) — so the resolver reports them as "disagreeing" when nothing is
   * in dispute at all. The engine already ignores `authRes.value` and iterates
   * the candidates for exactly that reason, and an unpriceable second permit
   * still sets `requiresManualReview` on its own terms below. Gating on that
   * false positive would have blocked every absorption in New York over a
   * disagreement that does not exist.
   */
  if (
    (overDimension.weight && overweightModelRes.conflict) ||
    combineRes?.conflict === true
  ) {
    requirementConflict = true;
  }

  /** Fee conflicts may only settle themselves when no requirement is in dispute. */
  const absorb = !requirementConflict;
  const priceOf = <T>(
    resolution: Resolution<T>,
    amountOf: (value: T) => number | null,
  ) => {
    const priced = priceSourced(resolution, amountOf, { absorb });
    if (priced.absorbed !== null) absorbedConflicts.push(priced.absorbed);
    dataQuality.push(...priced.dataQuality);
    return priced;
  };

  // ── 6. Fees ───────────────────────────────────────────────────────────
  // A superload has no published fee schedule. Emitting the general permit's
  // $60 + $375 here would be a confident number the sources do not support,
  // so the priced lines are skipped entirely and the review flag carries it.
  if (permitRequired && !superload) {
    /**
     * New York is the live case for absorption here: NYSDOT's own fee page and
     * the Highway Law print $40 and $60 for the same single-trip permit. Twenty
     * dollars on a permit that rides a five-figure move is not a decision worth
     * a human, so the higher figure prices and the finding goes to
     * `dataQuality`. See `materiality.ts`.
     */
    const base = priceOf(
      resolveSourced(`${rules.code} single-trip permit base fee`, rules.permitBaseFeeUsd, asOf),
      (v) => v,
    );
    pushSources(sources, base);
    warnings.push(...base.warnings);
    if (base.requiresManualReview) requiresManualReview = true;
    /**
     * A SOURCED ZERO base beside a dimension-banded schedule is not a fee; it
     * is the recorded fact that the state charges nothing on top of the band
     * (Pennsylvania, Indiana, Illinois). Printing "$0.00" as its own line would
     * invite the reader to wonder what was missed, so the line is suppressed
     * while the row stays on file and in the citations. Ohio's $20 basic
     * processing charge IS a real separate fee and still prints.
     */
    const baseIsAbsorbedByBands =
      rules.oversizeFeeBands !== undefined && base.value === 0 && !base.conflict;
    if (!baseIsAbsorbedByBands) {
      lines.push({
        code: 'osow_permit_base',
        name: `${rules.name} single-trip permit`,
        amountUsd: base.amountUsd,
        ...rangeOf(base),
        sources: sourcesOf(base),
      });
    }

    // ── The dimension-banded oversize charge ──────────────────────────
    // Held back rather than pushed, because two states say in writing that it
    // does not simply add to the overweight charge. See `combinedFeeRule`.
    let oversizeLine: OsowFeeLine | null = null;
    /**
     * Only an OVERSIZE load pays an oversize band. An overweight-but-legal-size
     * load matches no dimensional band by construction, and reading that as
     * "the schedule does not price this" would send every legal-size overweight
     * permit to review over a fee it never owed.
     */
    const isOversize =
      overDimension.width ||
      overDimension.height ||
      overDimension.length ||
      overDimension.frontOverhang ||
      overDimension.rearOverhang;
    if (rules.oversizeFeeBands !== undefined && isOversize) {
      const bandInput: OversizeBandInput = {
        ...(load.widthIn === undefined ? {} : { widthIn: load.widthIn }),
        ...(load.heightIn === undefined ? {} : { heightIn: load.heightIn }),
        ...(load.overallLengthIn === undefined ? {} : { overallLengthIn: load.overallLengthIn }),
        ...(load.milesInJurisdiction === undefined
          ? {}
          : { milesInJurisdiction: load.milesInJurisdiction }),
      };
      const inEffect = rules.oversizeFeeBands.filter((b) => isInEffect(b, asOf));
      const matched: Sourced<OversizeFeeBand>[] = [];
      const undecided = new Set<string>();
      for (const row of inEffect) {
        const verdict = oversizeBandApplies(row.value, bandInput);
        if (verdict.applies === true) matched.push(row);
        else if (verdict.applies === null) {
          for (const m of verdict.missing) undecided.add(m);
        }
      }

      for (const row of inEffect) {
        if (!sources.some((s) => s.id === row.source.id)) sources.push(row.source);
      }

      if (undecided.size > 0) {
        // A band was bounded on something we were never told. Picking any band
        // would be choosing a fee by an absence.
        oversizeLine = {
          code: 'osow_oversize',
          name: `${rules.name} oversize permit fee`,
          amountUsd: null,
          note: `${rules.name} sets the oversize fee by band, and the band cannot be selected without the ${[...undecided].join(' and ')}.`,
          sources: inEffect.map((r) => r.source),
        };
        warnings.push(
          `${rules.name} steps the oversize permit fee by ${[...undecided].join(' and ')}, which ${[...undecided].length === 1 ? 'was' : 'were'} not supplied. The fee band cannot be selected, so no oversize amount is quoted for this state.`,
        );
        requiresManualReview = true;
      } else if (matched.length === 0) {
        /**
         * The published schedule does not price this load. Pennsylvania's is
         * the case that forced the mutually-exclusive band design: its fee PDF
         * prints "$46 (If < 14' wide)" and "$97 (If > 14' wide)" and assigns a
         * load of exactly 14 ft 0 in to neither.
         */
        oversizeLine = {
          code: 'osow_oversize',
          name: `${rules.name} oversize permit fee`,
          amountUsd: null,
          note: `No published ${rules.name} fee band covers this load's dimensions.`,
          sources: inEffect.map((r) => r.source),
        };
        warnings.push(
          `${rules.name}'s published oversize fee bands do not cover this load's dimensions — the schedule states a fee below one boundary and above it, and says nothing about a load sitting exactly on it. The oversize fee must be confirmed with the issuing agency.`,
        );
        requiresManualReview = true;
      } else {
        /**
         * Louisiana's LAC $8 against the statute's $10, and Pennsylvania's
         * §1942 $35/$71 against PennDOT's CPI-adjusted $46/$97, both land here.
         * The band's fee IS the amount for this load, so the deferral is a
         * no-op arithmetically — but it goes through the same path as the
         * per-mile and per-axle cases so there is one rule, not a flat-fee
         * special case. See `materiality.ts`, rule 3.
         */
        const bandRes = priceOf(
          resolveSourced<OversizeFeeBand>(
            `${rules.code} oversize fee band`,
            matched,
            asOf,
            oversizeFeeBandsEqual,
          ),
          (b) => b.feeUsd,
        );
        warnings.push(...bandRes.warnings);
        if (bandRes.requiresManualReview) requiresManualReview = true;
        oversizeLine = {
          code: 'osow_oversize',
          name: `${rules.name} oversize permit fee`,
          amountUsd: bandRes.amountUsd,
          ...rangeOf(bandRes),
          ...(bandRes.value === null ? {} : { note: bandRes.value.label }),
          sources: sourcesOf(bandRes),
        };
      }
    }

    // ── The overweight component ──────────────────────────────────────
    // How a state prices this is itself sourced data, not something inferred
    // from which array happens to be populated. See `OverweightPricing`.
    let overweightLine: OsowFeeLine | null = null;
    if (overDimension.weight && load.grossWeightLbs !== undefined) {
      const gross = load.grossWeightLbs;
      // Resolved above so the absorption gate could see it; cited and warned
      // about here, exactly where it always was.
      const modelRes = overweightModelRes;
      pushSources(sources, modelRes);
      warnings.push(...modelRes.warnings);
      if (modelRes.requiresManualReview) requiresManualReview = true;

      switch (modelRes.value?.kind) {
        case 'includedInBaseFee': {
          // A genuine $0, not a gap: the base fee above already covers it.
          overweightLine = {
            code: 'osow_overweight',
            name: 'Overweight component',
            amountUsd: 0,
            note: `No separate overweight charge — ${modelRes.value.explanation}`,
            sources: sourcesOf(modelRes),
          };
          break;
        }

        case 'bands': {
          /**
           * Band selection is three-valued for the same reason the oversize
           * side is. A Louisiana band names a DISTANCE COLUMN as well as a
           * weight row, and a Colorado band is priced per axle — so a band can
           * be undecidable rather than in or out, and choosing one anyway would
           * pick a fee out of a blank field. See `weightBandApplies`.
           */
          const bandInEffect = rules.overweightBands.filter((b) =>
            isInEffect(b, asOf),
          );
          const bandMatched: Sourced<WeightBand>[] = [];
          const bandUndecided = new Set<string>();
          for (const row of bandInEffect) {
            const verdict = weightBandApplies(row.value, {
              grossWeightLbs: gross,
              ...(load.milesInJurisdiction === undefined
                ? {}
                : { milesInJurisdiction: load.milesInJurisdiction }),
              ...(axleCount === undefined ? {} : { axleCount }),
            });
            if (verdict.applies === true) bandMatched.push(row);
            else if (verdict.applies === null) {
              for (const m of verdict.missing) bandUndecided.add(m);
            }
          }

          if (bandUndecided.size > 0) {
            for (const row of bandInEffect) {
              if (!sources.some((s) => s.id === row.source.id)) {
                sources.push(row.source);
              }
            }
            const needed = [...bandUndecided].join(' and ');
            overweightLine = {
              code: 'osow_overweight',
              name: 'Overweight permit charge',
              amountUsd: null,
              note: `${rules.name} sets the overweight charge by band, and the band cannot be priced without the ${needed}.`,
              sources: bandInEffect.map((r) => r.source),
            };
            warnings.push(
              `${rules.name} steps the overweight permit charge by ${needed}, which ${bandUndecided.size === 1 ? 'was' : 'were'} not supplied. No overweight amount is quoted for this state.`,
            );
            requiresManualReview = true;
            break;
          }

          /**
           * DEFERRED: the amount, not the published row, is what gets compared.
           * A Colorado band is "$30 plus $10 per axle", so two sources one
           * dollar apart per axle are $6 apart on a six-axle rig and $11 apart
           * on an eleven-axle one. An Arkansas band is "$8.00 for each ton or
           * major fraction thereof over the lawful weight", so a two-dollar
           * disagreement about the rate is $2 on a one-ton overload and $100 on
           * a fifty-ton one — which is exactly why the threshold has to see the
           * COMPUTED figure. `weightBandAmount` answers `null` without the input
           * a band needs, which `priceSourced` treats as "no higher figure to
           * take" and escalates rather than absorbs.
           */
          const bandRes = priceOf(
            resolveSourced<WeightBand>(
              `${rules.code} overweight fee band`,
              bandMatched,
              asOf,
              weightBandsEqual,
            ),
            (b) => weightBandAmount(b, axleCount, gross),
          );
          pushSources(sources, bandRes);
          warnings.push(...bandRes.warnings);
          if (bandRes.requiresManualReview) requiresManualReview = true;
          const band = bandRes.value;
          overweightLine = {
            code: 'osow_overweight',
            name: 'Overweight permit charge',
            amountUsd: bandRes.amountUsd,
            ...rangeOf(bandRes),
            note: band === null
              ? undefined
              : `${band.minLbs.toLocaleString()}–${band.maxLbs === null ? 'over' : band.maxLbs.toLocaleString()} lb band${band.perAxleUsd === undefined ? '' : `, $${band.perAxleUsd.toFixed(2)} per axle × ${axleCount ?? 0} axles`}${
                  band.perIncrementUsd === undefined
                    ? ''
                    : `, $${band.perIncrementUsd.toFixed(2)} × ${chargedIncrements(band, gross) ?? 0} increments of ${(band.incrementLbs ?? 0).toLocaleString()} lb over ${(band.incrementBaseLbs ?? 0).toLocaleString()} lb`
                }`,
            sources: sourcesOf(bandRes),
          };
          if (band === null && bandRes.candidates.length === 0) {
            // The pricing MODEL resolved, so we know how the state charges; we
            // simply hold no band covering this load. Ohio is the live case on
            // WEIGHT: its banded surcharge stops at 120,000 lb and a ton-mile
            // formula takes over above it. Saying only "no band on file" would
            // read as a research gap, so the model's own explanation goes with
            // it.
            //
            // NAME THE INPUT THAT ACTUALLY FELL IN THE GAP. Arkansas is the
            // live case on MILEAGE: §27-35-210(e)(2) bands "201 to 250" and
            // then "Over 251", so a 251-mile move matches nothing while the
            // same weight prices at 250 and at 252. Blaming the weight there is
            // a true sentence about the wrong variable — a dispatcher reads
            // "no band covers 120,000 lb in Arkansas", concludes the state
            // cannot take the load at all, and re-plans a lane that only needed
            // a mile either side.
            const milesBandedForThisWeight = bandInEffect.filter((row) => {
              const b = row.value;
              if (gross < b.minLbs) return false;
              if (b.maxLbs !== null && gross > b.maxLbs) return false;
              return b.minMiles !== undefined || b.maxMiles !== undefined;
            });
            const milesHere = load.milesInJurisdiction;
            if (milesBandedForThisWeight.length > 0 && milesHere !== undefined) {
              const ranges = [
                ...new Set(
                  milesBandedForThisWeight.map((row) => {
                    const b = row.value;
                    const lo = (b.minMiles ?? 0).toLocaleString();
                    return b.maxMiles === null || b.maxMiles === undefined
                      ? `${lo} mi and over`
                      : `${lo}–${b.maxMiles.toLocaleString()} mi`;
                  }),
                ),
              ].join(', ');
              warnings.push(
                `No overweight fee band on file covers a ${milesHere.toLocaleString()}-mile move in ${rules.name} — it is the MILEAGE that falls in the gap, not the weight. ${gross.toLocaleString()} lb is priced at other in-state distances: the published bands run ${ranges}, and ${milesHere.toLocaleString()} mi sits between two of them. ${modelRes.value.explanation} The permit fee cannot be computed and must be confirmed with the issuing agency.`,
              );
            } else {
              warnings.push(
                `No overweight fee band on file covers ${gross.toLocaleString()} lb in ${rules.name}. ${modelRes.value.explanation} The permit fee cannot be computed and must be confirmed with the issuing agency.`,
              );
            }
            // The fee line itself says why it is blank, rather than rendering a
            // bare "Not priceable" whose cause is only in the notes below it.
            overweightLine = {
              ...overweightLine,
              note:
                milesBandedForThisWeight.length > 0 && milesHere !== undefined
                  ? `${rules.name}'s published bands price no move of exactly ${milesHere.toLocaleString()} mi at this weight.`
                  : `${rules.name}'s published bands price no load of ${gross.toLocaleString()} lb.`,
            };
            requiresManualReview = true;
          }
          break;
        }

        case 'perMile': {
          const miles = load.milesInJurisdiction;
          if (miles === undefined) {
            // Billing the whole lane's miles to one state would be the single
            // easiest way to produce a large, confident, wrong number here.
            overweightLine = {
              code: 'osow_overweight',
              name: 'Overweight permit (distance-priced)',
              amountUsd: null,
              note: `${rules.name} charges by the mile travelled inside the state, and those miles are not known.`,
              sources: sourcesOf(modelRes),
            };
            warnings.push(
              `${rules.name} prices the overweight permit per mile travelled inside the state. ${MILEAGE_SPLIT_NOTE}`,
            );
            requiresManualReview = true;
            break;
          }
          /**
           * THE CASE THAT FORCED DEFERRAL. Virginia charges $0.30 a mile and
           * New Jersey $5.00 per 2,000 lb, so a disagreement that reads as a
           * fraction of a cent in the statute is multiplied by the distance and
           * the weight of THIS move before it means anything. A 1.2-cent
           * per-mile quarrel is $12 over 1,000 miles and $60 over 5,000, and the
           * threshold has to see those as two different questions — which it
           * only can if the rate is priced first and compared second.
           */
          const rateRes = priceOf(
            resolveSourced<PerMileRate>(
              `${rules.code} overweight per-mile rate`,
              rules.overweightPerMile.filter((r) => {
                const v = r.value;
                return gross >= v.minLbs && (v.maxLbs === null || gross <= v.maxLbs);
              }),
              asOf,
              perMileRatesEqual,
            ),
            (r) => perMileAmount(r, gross, miles),
          );
          pushSources(sources, rateRes);
          warnings.push(...rateRes.warnings);
          if (rateRes.requiresManualReview) requiresManualReview = true;
          const rate = rateRes.value;
          overweightLine = {
            code: 'osow_overweight',
            name: 'Overweight permit (distance-priced)',
            amountUsd: rateRes.amountUsd,
            ...rangeOf(rateRes),
            note:
              rate === null
                ? undefined
                : describePerMile(rate, gross, miles, rules.name),
            sources: sourcesOf(rateRes),
          };
          if (rate === null && rateRes.candidates.length === 0) {
            warnings.push(
              `No per-mile overweight rate on file covers ${gross.toLocaleString()} lb in ${rules.name}. The permit fee cannot be computed.`,
            );
            requiresManualReview = true;
          }
          break;
        }

        case 'notPriceable': {
          overweightLine = {
            code: 'osow_overweight',
            name: 'Overweight permit',
            amountUsd: null,
            note: modelRes.value.explanation,
            sources: sourcesOf(modelRes),
          };
          warnings.push(
            `${rules.name} charges an overweight permit fee that we cannot compute from published sources: ${modelRes.value.explanation} This leg must be priced by the issuing agency.`,
          );
          requiresManualReview = true;
          break;
        }

        default: {
          // The model itself did not resolve — either nothing on file, or two
          // sources disagreeing about how the state prices overweight at all.
          overweightLine = {
            code: 'osow_overweight',
            name: 'Overweight permit',
            amountUsd: null,
            note: `How ${rules.name} prices the overweight component could not be determined from the sources on file.`,
            sources: sourcesOf(modelRes),
          };
          requiresManualReview = true;
          break;
        }
      }
    }

    // ── How the two components combine ────────────────────────────────
    /**
     * Phase 1 added them because Texas does. Ohio replaces and Indiana takes
     * the greater, both in writing, and adding in either state would over-quote
     * every combined permit it issues. The rule is sourced data; absent means
     * cumulative. See `CombinedFeeRule`.
     */
    if (combineRes !== null) {
      pushSources(sources, combineRes);
      warnings.push(...combineRes.warnings);
      if (combineRes.requiresManualReview) requiresManualReview = true;
    }
    const combineKind = combineRes?.value?.kind ?? 'cumulative';

    if (oversizeLine !== null && overweightLine !== null && combineKind !== 'cumulative') {
      if (combineKind === 'overweightOnly') {
        // Ohio: "only one basic processing fee ... and the applicable
        // overweight surcharge ... will be charged." The oversize surcharge is
        // not billed at all, so it is not printed as a $0 line either.
        lines.push({
          ...overweightLine,
          note: `${overweightLine.note === undefined ? '' : `${overweightLine.note}. `}${combineRes?.value?.explanation ?? ''}`.trim(),
        });
      } else {
        // Indiana: "Whichever of the calculated oversize or overweight fees is
        // greater." Undecidable the moment either side is unpriced — and
        // guessing which is larger is exactly the confident-wrong-number this
        // engine exists to refuse.
        const a = oversizeLine.amountUsd;
        const b = overweightLine.amountUsd;
        if (a === null || b === null) {
          lines.push({
            code: 'osow_permit_greater_of',
            name: `${rules.name} permit fee (greater of oversize or overweight)`,
            amountUsd: null,
            note: `${combineRes?.value?.explanation ?? ''} One of the two amounts could not be computed, so which is greater cannot be determined.`.trim(),
            sources: [...oversizeLine.sources, ...overweightLine.sources],
          });
          warnings.push(
            `${rules.name} charges whichever of the oversize and overweight fees is greater, and one of them could not be priced from the sources on file. No ${rules.name} permit amount is quoted.`,
          );
          requiresManualReview = true;
        } else {
          const winner = a >= b ? oversizeLine : overweightLine;
          const loser = a >= b ? overweightLine : oversizeLine;
          lines.push({
            ...winner,
            note: `${winner.note === undefined ? '' : `${winner.note}. `}Charged instead of the ${loser.code === 'osow_oversize' ? 'oversize' : 'overweight'} fee of $${(loser.amountUsd ?? 0).toFixed(2)} — ${combineRes?.value?.explanation ?? ''}`.trim(),
          });
        }
      }
    } else {
      if (oversizeLine !== null) lines.push(oversizeLine);
      if (overweightLine !== null) lines.push(overweightLine);
    }

    // Conditional fees (Texas's Vehicle Supervision Fee).
    for (const cf of rules.conditionalFees) {
      const res = priceOf(
        resolveSourced(
          `${rules.code} conditional fee`,
          rules.conditionalFees.filter((x) => conditionalFeesEqual(x.value, cf.value)),
          asOf,
          conditionalFeesEqual,
        ),
        (c) => c.feeUsd,
      );
      if (res.value === null) continue;
      if (load.grossWeightLbs === undefined) continue;
      if (!exceeds(load.grossWeightLbs, res.value.appliesAbove)) continue;
      if (lines.some((l) => l.code === 'osow_supervision')) continue;
      pushSources(sources, res);
      lines.push({
        code: 'osow_supervision',
        name: 'Vehicle supervision fee',
        amountUsd: res.amountUsd,
        ...rangeOf(res),
        note: `Applies over ${res.value.appliesAbove.value.toLocaleString()} lb`,
        sources: sourcesOf(res),
      });
    }

    // Payment processing — a percentage of everything above, so it is
    // computed last and only when every preceding line resolved.
    const pricedSoFar = lines.every((l) => l.amountUsd !== null)
      ? lines.reduce((s, l) => s + (l.amountUsd ?? 0), 0)
      : null;
    /**
     * The percentage surcharge is the one fee that is inherently computed on
     * the finished subtotal, so its own conflict — two sources quoting
     * different card percentages — is measured in the dollars it produces for
     * THIS permit. 2.25% against 2.30% is three cents on a $60 permit and ten
     * dollars on a $20,000 one. Where the subtotal is not yet known the
     * surcharge cannot be costed at all, and a conflict about it escalates.
     */
    const txRes = priceOf(
      resolveSourced<import('./types.js').TransactionFee>(
        `${rules.code} permit transaction fee`,
        rules.transactionFee,
        asOf,
        transactionFeesEqual,
      ),
      (t) => (pricedSoFar === null ? null : applyTransactionFee(pricedSoFar, t)),
    );
    pushSources(sources, txRes);
    warnings.push(...txRes.warnings);
    if (txRes.requiresManualReview && txRes.conflict) requiresManualReview = true;
    if (txRes.value !== null && pricedSoFar !== null) {
      lines.push({
        code: 'osow_service_fee',
        name: 'Permit service fee',
        amountUsd: txRes.amountUsd,
        ...rangeOf(txRes),
        note: `$${txRes.value.perPermitUsd.toFixed(2)} per permit plus ${txRes.value.percentOfTotal}% of the permit total`,
        sources: sourcesOf(txRes),
      });
    } else if (txRes.value !== null && pricedSoFar === null) {
      lines.push({
        code: 'osow_service_fee',
        name: 'Permit service fee',
        amountUsd: null,
        note: `${txRes.value.percentOfTotal}% of the permit total, which is not yet determined`,
        sources: sourcesOf(txRes),
      });
    }
  }

  // Route/bridge analysis review — superload path only.
  if (superload) {
    const analysis = resolveSourced(`${rules.code} route analysis review fee`, rules.routeAnalysisFeeUsd, asOf);
    pushSources(sources, analysis);
    if (analysis.value !== null) {
      warnings.push(
        `A superheavy move in ${rules.name} also carries an agency charge of $${analysis.value.toFixed(2)} to review a state-approved engineer's route and bridge analysis (or $${(resolveSourced('no-bridge route fee', rules.noBridgeRouteFeeUsd, asOf).value ?? 0).toFixed(2)} where the approved route crosses no bridges). The engineer's own fee is separate and is not a state charge. Neither amount is included in the total, and no permit price is quoted for a superload.`,
      );
    }
  }

  // ── 7. Distance-dependent jurisdictions ───────────────────────────────
  if (rules.feesDependOnDistance && load.milesInJurisdiction === undefined) {
    warnings.push(
      `${rules.name} prices this permit on distance travelled inside the state, and per-jurisdiction mileage is not yet computed. ${MILEAGE_SPLIT_NOTE}`,
    );
    requiresManualReview = true;
  }

  // ── 7b. A second permit issuer inside the same state ──────────────────
  // A complete-looking state subtotal that is missing an entire permit is
  // worse than an obviously incomplete one, because nothing on the quote says
  // to go looking. So an unpriceable second authority sets review outright.
  if (permitRequired && rules.additionalAuthorities !== undefined) {
    for (const cand of authRes?.candidates ?? []) {
      const a = cand.value;
      if (!sources.some((s) => s.id === cand.source.id)) sources.push(cand.source);
      if (a.priceable) continue;
      warnings.push(
        `${rules.name} is not a single-issuer state. ${a.appliesWhen} A ${a.name} permit is a SEPARATE permit with its own fee, which is not included in the ${rules.name} subtotal above. Source: ${citeOf(cand.source)}.`,
      );
      requiresManualReview = true;
    }
  }

  // ── 8. Escort cost is the caller's, not the state's ───────────────────
  if (escorts.totalEscorts > 0) {
    warnings.push(
      `This move requires ${escorts.totalEscorts} certified escort${escorts.totalEscorts === 1 ? '' : 's'} in ${rules.name}. Pilot cars are private vendors on a market rate — ${rules.name} sets the requirement, not the price — so the escort cost is billed from your own pilot-car rate and is not part of the state permit fee above.`,
    );
  }

  // ── 9. Totals ─────────────────────────────────────────────────────────
  // `null` and `0` say different things and must never be confused. A legal
  // load genuinely costs $0 in permits. A superload costs an unknown amount —
  // the pricing block above deliberately emitted no lines for it, and summing
  // an empty list to $0 would turn "we cannot price this" into "this is free",
  // which is the single worst answer this engine could give.
  const anyUnpriced = lines.some((l) => l.amountUsd === null);
  /**
   * `|| superload` IS NOT REDUNDANT, AND ARKANSAS IS WHY.
   *
   * Every state before it triggered a superload only on a dimension it also
   * publishes a legal limit for, so `permitRequired` was always true by the time
   * `superload` was — and the two clauses could not be told apart. Arkansas
   * breaks that: 27 CAR §111-110(a) makes a load of 100 ft or more overall a
   * super load, while Rule 3.G.1 says a combination whose trailer is within
   * 53'6" has "no overall length restriction" at all. A load can therefore be
   * legal on every Arkansas limit on file AND a super load at the same time, and
   * without this clause it left the fee block with no lines, summed to $0.00,
   * and printed "this move is free" beside "the agency prices it after review" —
   * the exact confusion the paragraph above exists to prevent.
   */
  const pricingRefused = (permitRequired || superload) && lines.length === 0;
  const subtotalUsd =
    anyUnpriced || pricingRefused
      ? null
      : Math.round(lines.reduce((s, l) => s + (l.amountUsd ?? 0), 0) * 100) / 100;
  if (anyUnpriced || pricingRefused) requiresManualReview = true;

  const hasRange = lines.some((l) => l.lowUsd !== undefined);
  const subtotalLowUsd = hasRange
    ? Math.round(lines.reduce((s, l) => s + (l.lowUsd ?? l.amountUsd ?? 0), 0) * 100) / 100
    : subtotalUsd;
  const subtotalHighUsd = hasRange
    ? Math.round(lines.reduce((s, l) => s + (l.highUsd ?? l.amountUsd ?? 0), 0) * 100) / 100
    : subtotalUsd;

  /**
   * THE AGGREGATE CAP, at the jurisdiction level. Several small absorptions in
   * one state can add up past the point where "immaterial" is still true, so
   * the same threshold is applied to their sum. The adopted prices STAY — they
   * are the higher, conservative reading of each source and nothing about them
   * became less true — but the quote is surfaced for a human.
   */
  const jurisdictionAbsorbedUsd = absorbedTotalUsd(absorbedConflicts);
  if (aggregateExceedsThreshold(jurisdictionAbsorbedUsd)) {
    requiresManualReview = true;
    warnings.push(
      aggregateReviewWarning(
        jurisdictionAbsorbedUsd,
        absorbedConflicts.length,
        rules.name,
      ),
    );
  }

  return {
    jurisdiction: rules.code,
    jurisdictionName: rules.name,
    permitRequired,
    overDimension,
    lines,
    subtotalUsd,
    subtotalLowUsd,
    subtotalHighUsd,
    escorts,
    escortsRequired: escorts.totalEscorts,
    bridge,
    // OPTIONAL, and omitted rather than set to a placeholder, so a result for
    // any state that publishes neither is byte-identical to before Phase 9.
    ...(axleSpacingTables === undefined ? {} : { axleSpacingTables }),
    ...(stateBridge === undefined ? {} : { stateBridge }),
    superload,
    routeInspectionRequired,
    warnings,
    requiresManualReview,
    dataQuality,
    absorbedConflicts,
    absorbedConflictTotalUsd: jurisdictionAbsorbedUsd,
    sources,
    asOf,
  };
}

/**
 * Price an OS/OW move across the jurisdictions it crosses.
 *
 * A jurisdiction we have no data for does NOT get skipped or estimated from a
 * neighbour. It produces an explicit gap: no number, a warning naming the
 * state, and `requiresManualReview`. Phase 1 ships Texas, so any lane leaving
 * Texas correctly declines to quote the rest.
 */
export interface OsowQuote {
  jurisdictions: OsowJurisdictionResult[];
  /** States we were asked about and do not cover. */
  uncoveredJurisdictions: string[];
  /** Total across covered jurisdictions; `null` if anything is unpriceable. */
  totalPermitUsd: number | null;
  totalEscortsRequired: number;
  warnings: string[];
  requiresManualReview: boolean;
  /** Internal data-quality notes across every jurisdiction on the lane. */
  dataQuality: string[];
  /** Every fee conflict quoted at the higher figure instead of escalated. */
  absorbedConflicts: AbsorbedFeeConflict[];
  /**
   * Money those decisions moved across the WHOLE quote. Five states each
   * papering over $40 is $200, and the cap is applied here as well as
   * per-jurisdiction so that spreading a material amount thinly across a
   * corridor cannot slip past it.
   */
  absorbedConflictTotalUsd: number;
  asOf: IsoDate;
}

/**
 * The heaviest load we can put a real number on for a lane — the replacement
 * for a flat `MAX_QUOTABLE_WEIGHT_LBS`.
 *
 * The old constant conflated two different facts. 80,000 lb is the FEDERAL
 * LEGAL LIMIT: above it you need a permit. It is not the limit of what can be
 * quoted — it was only being used that way because nothing here could price a
 * permit. Now that Texas can be priced, a 100,000 lb Texas load has a real,
 * citable answer and should get one instead of "contact us".
 *
 * The ceiling rises ONLY where the engine can genuinely answer:
 *
 *   - both ends in the SAME covered jurisdiction → that jurisdiction's
 *     superload threshold (Texas: 254,300 lb), above which no published fee
 *     exists and a human must price it.
 *   - anything else → 80,000 lb, and the existing contact-us path stands.
 *
 * The same-state condition is the conservative part, and it is deliberate: a
 * quote request gives us two endpoints, not a route. A Texas-to-Oklahoma load
 * crosses at least one state we hold no permit data for, and we cannot
 * enumerate the states in between from the endpoints alone. Raising the
 * ceiling on a lane we cannot fully price would trade an honest "contact us"
 * for a confident under-quote — exactly backwards.
 */
export function maxQuotableWeightLbs(
  pickupState: string | null | undefined,
  deliveryState: string | null | undefined,
  fallbackLbs: number,
  asOf: IsoDate = todayIso(),
): number {
  const from = String(pickupState ?? '').trim().toUpperCase();
  const to = String(deliveryState ?? '').trim().toUpperCase();
  if (from === '' || to === '' || from !== to) return fallbackLbs;

  const rules = osowRulesFor(from);
  if (rules === null) return fallbackLbs;
  // No published threshold (Illinois), or sources that disagree about it
  // (Indiana) — either way there is no defensible ceiling above the federal
  // one, so the existing contact-us path stands.
  if (rules.superload.grossWeight === undefined) return fallbackLbs;

  const threshold = resolveSourced<Threshold>(
    `${rules.code} superload gross-weight threshold`,
    rules.superload.grossWeight,
    asOf,
    thresholdsEqual,
  );
  if (threshold.value === null) return fallbackLbs;
  return Math.max(fallbackLbs, quotableCeilingFor(threshold.value));
}

/**
 * The heaviest gross weight that is NOT yet a superload under a threshold.
 *
 * Phase 1 returned the threshold value itself, which is right for Texas —
 * "over 254,300 lb" means 254,300 lb is still an ordinary permit. It is off by
 * a pound for New York, whose rule reads "200,000 pounds or greater", where a
 * load at exactly 200,000 lb IS a superload and must not be quoted. The
 * `inclusive` flag was recorded from the start precisely so this could be got
 * right; this is where it gets used.
 */
export function quotableCeilingFor(t: Threshold): number {
  return t.inclusive ? t.value - 1 : t.value;
}

/**
 * One state on a route. A bare code keeps every existing caller working; the
 * object form carries that state's own mileage.
 *
 * Per-state miles have to travel WITH the state, not on the load: a corridor
 * crosses seven states with seven different distances, and a single
 * `load.milesInJurisdiction` would silently bill each state for the same
 * number — most likely the whole lane — which is precisely the over-quote the
 * distance guard exists to prevent.
 */
export type OsowLeg = string | { code: string; milesInJurisdiction?: number };

function legCode(leg: OsowLeg): string {
  return String((typeof leg === 'string' ? leg : leg.code) ?? '')
    .trim()
    .toUpperCase();
}

export function calculateOsow(
  legs: OsowLeg[],
  load: OsowLoad,
  asOf: IsoDate = todayIso(),
  /**
   * SEASONAL RESTRICTIONS, already loaded by the caller.
   *
   * Optional and pure: the engine does no I/O, exactly as it does none for fee
   * data. Omit it and every field of the result is what it was before this
   * parameter existed. Supply it and each covered state gains a cited warning
   * when a spring-thaw restriction is in force — and NOTHING is repriced;
   * `seasonal/advisory.ts` sets out why applying one would be a confident wrong
   * number rather than a better one.
   */
  seasonal?: SeasonalContext,
): OsowQuote {
  const jurisdictions: OsowJurisdictionResult[] = [];
  const uncovered: string[] = [];
  const warnings: string[] = [];
  let requiresManualReview = false;

  const seen = new Set<string>();
  for (const leg of legs) {
    const code = legCode(leg);
    if (code === '' || seen.has(code)) continue;
    seen.add(code);

    const legMiles =
      typeof leg === 'string' ? undefined : leg.milesInJurisdiction;
    const legLoad: OsowLoad =
      legMiles === undefined ? load : { ...load, milesInJurisdiction: legMiles };

    const rules = osowRulesFor(code);
    if (rules === null) {
      uncovered.push(code);
      warnings.push(
        `No oversize/overweight permit data is on file for ${code}. Permit fees, escort requirements, and superload thresholds vary by state and cannot be inferred from a neighbouring one, so this leg is not priced.`,
      );
      requiresManualReview = true;
      continue;
    }

    const result = calculateOsowForJurisdiction(rules, legLoad, asOf);

    // Seasonal surfacing is applied HERE rather than inside
    // calculateOsowForJurisdiction because it is not a property of the
    // jurisdiction's RULES — it is a property of what the state posted this
    // week. Keeping it out of the per-jurisdiction pricer means the fee
    // arithmetic is unchanged and unchangeable by it, which is the whole
    // flag-don't-reprice contract expressed in the call graph.
    if (seasonal !== undefined) {
      const advisory = seasonalAdvisoryFor(code, seasonal, asOf, {
        permitRequired: result.permitRequired,
        overweight: result.overDimension.weight,
      });
      result.seasonal = advisory;
      result.warnings.push(...advisory.warnings);
      result.dataQuality.push(...advisory.dataQuality);
      if (advisory.requiresManualReview) result.requiresManualReview = true;
    }

    jurisdictions.push(result);
    warnings.push(...result.warnings);
    if (result.requiresManualReview) requiresManualReview = true;
  }

  if (jurisdictions.length === 0 && uncovered.length === 0) {
    warnings.push('No jurisdictions were supplied, so no permit could be priced.');
    requiresManualReview = true;
  }

  // No jurisdiction priced ⇒ no total. Summing an empty list to $0 would
  // report "this move needs no permits" when what happened is that we were
  // never told where it goes.
  const anyNull =
    uncovered.length > 0 ||
    jurisdictions.length === 0 ||
    jurisdictions.some((j) => j.subtotalUsd === null);
  const totalPermitUsd = anyNull
    ? null
    : Math.round(jurisdictions.reduce((s, j) => s + (j.subtotalUsd ?? 0), 0) * 100) / 100;

  /**
   * THE AGGREGATE CAP, at the quote level. Each jurisdiction has already
   * checked its own total; this catches the case the per-state check cannot see,
   * where several states each absorb an amount that is immaterial alone and
   * material together. The prices stand and the quote goes to a human.
   */
  const absorbedConflicts = jurisdictions.flatMap((j) => j.absorbedConflicts);
  const quoteAbsorbedUsd = absorbedTotalUsd(absorbedConflicts);
  if (aggregateExceedsThreshold(quoteAbsorbedUsd) && !jurisdictions.some(
    (j) => aggregateExceedsThreshold(j.absorbedConflictTotalUsd),
  )) {
    // Only when no single state already said it — otherwise the same finding
    // would be printed twice on one quote.
    warnings.push(
      aggregateReviewWarning(
        quoteAbsorbedUsd,
        absorbedConflicts.length,
        'this lane',
      ),
    );
  }
  if (aggregateExceedsThreshold(quoteAbsorbedUsd)) requiresManualReview = true;

  return {
    jurisdictions,
    uncoveredJurisdictions: uncovered,
    totalPermitUsd,
    totalEscortsRequired: jurisdictions.reduce(
      (m, j) => Math.max(m, j.escortsRequired),
      0,
    ),
    warnings,
    requiresManualReview,
    dataQuality: jurisdictions.flatMap((j) => j.dataQuality),
    absorbedConflicts,
    absorbedConflictTotalUsd: quoteAbsorbedUsd,
    asOf,
  };
}
