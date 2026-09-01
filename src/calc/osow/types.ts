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
  frontOverhangIn: Sourced<number>[];
  rearOverhangIn: Sourced<number>[];
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
  grossWeight: Sourced<Threshold>[];
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
  /** Base single-trip permit fee, before any weight-stepped addition. */
  permitBaseFeeUsd: Sourced<number>[];
  /**
   * Weight-stepped surcharge on top of the base fee (Texas's "highway
   * maintenance fee"). Empty = the jurisdiction has no weight step.
   */
  overweightBands: Sourced<WeightBand>[];
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
   * Per-state distance splitting is Phase 2 — see `MILEAGE_SPLIT_NOTE`. A
   * jurisdiction that charges per mile cannot be priced until that lands, and
   * this flag makes the engine say so rather than pricing on total lane miles.
   */
  feesDependOnDistance: boolean;
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
