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
  resolveSourced,
  spreadOf,
  citeOf,
  todayIso,
  type IsoDate,
  type Resolution,
  type SourceDoc,
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
  exceeds,
  thresholdsEqual,
  weightBandsEqual,
  conditionalFeesEqual,
  transactionFeesEqual,
  MILEAGE_SPLIT_NOTE,
  type JurisdictionOsowRules,
  type Threshold,
  type WeightBand,
} from './types.js';
import { osowRulesFor } from './jurisdictions/texas.js';

export interface OsowLoad {
  grossWeightLbs?: number;
  widthIn?: number;
  heightIn?: number;
  overallLengthIn?: number;
  trailerLengthIn?: number;
  frontOverhangIn?: number;
  rearOverhangIn?: number;
  /** Full axle layout, when known. Enables bridge-formula checking. */
  axles?: Axle[];
  /** Outer-to-outer axle spacing in feet — needed for Texas's short-spacing
   *  superload trigger even when the full layout is unknown. */
  axleSpacingFt?: number;
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
  superload: boolean;
  routeInspectionRequired: boolean | null;
  warnings: string[];
  requiresManualReview: boolean;
  sources: SourceDoc[];
  asOf: IsoDate;
}

function pushSources(into: SourceDoc[], from: Resolution<unknown>): void {
  for (const c of from.candidates) {
    if (!into.some((s) => s.id === c.source.id)) into.push(c.source);
  }
}

function sourcesOf(r: Resolution<unknown>): SourceDoc[] {
  const out: SourceDoc[] = [];
  pushSources(out, r);
  return out;
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
  const sources: SourceDoc[] = [];
  const lines: OsowFeeLine[] = [];
  let requiresManualReview = false;

  // ── 1. Legal limits: is a permit needed at all? ────────────────────────
  const widthLimit = resolveSourced('Texas legal width', rules.legalLimits.widthIn, asOf);
  const heightLimit = resolveSourced('Texas legal height', rules.legalLimits.heightIn, asOf);
  const lengthLimit = resolveSourced('Texas legal trailer length', rules.legalLimits.trailerLengthIn, asOf);
  const frontOverhangLimit = resolveSourced('Texas legal front overhang', rules.legalLimits.frontOverhangIn, asOf);
  const rearOverhangLimit = resolveSourced('Texas legal rear overhang', rules.legalLimits.rearOverhangIn, asOf);
  const grossLimit = resolveSourced('Texas legal gross weight', rules.legalLimits.grossWeightLbs, asOf);

  for (const r of [widthLimit, heightLimit, lengthLimit, frontOverhangLimit, rearOverhangLimit, grossLimit]) {
    pushSources(sources, r);
    warnings.push(...r.warnings);
    if (r.requiresManualReview) requiresManualReview = true;
  }

  const details: string[] = [];
  const checks: Array<[keyof Omit<OverDimension, 'details'>, number | undefined, Resolution<number>, string, 'in' | 'lb']> = [
    ['width', load.widthIn, widthLimit, 'Width', 'in'],
    ['height', load.heightIn, heightLimit, 'Height', 'in'],
    ['length', load.trailerLengthIn, lengthLimit, 'Trailer length', 'in'],
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
    const over = overLimit(measurement, limit);
    if (over === true) {
      overDimension[key] = true;
      const fmt = (n: number) => (unit === 'in' ? formatFtIn(n) : `${n.toLocaleString()} lb`);
      details.push(`${label} ${fmt(measurement as number)} exceeds the ${fmt(limit.value as number)} legal limit`);
    }
  }

  const permitRequired = Object.entries(overDimension)
    .filter(([k]) => k !== 'details')
    .some(([, v]) => v === true);

  // ── 2. Bridge formula — federal, applies regardless of jurisdiction ────
  let bridge: BridgeFormulaResult | null = null;
  if (load.axles && load.axles.length >= 2) {
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
  const superloadWeight = resolveSourced<Threshold>(
    `${rules.code} superload gross-weight threshold`,
    rules.superload.grossWeight,
    asOf,
    thresholdsEqual,
  );
  pushSources(sources, superloadWeight);
  warnings.push(...superloadWeight.warnings);
  if (superloadWeight.requiresManualReview) requiresManualReview = true;

  let superload = false;
  if (load.grossWeightLbs !== undefined && superloadWeight.value !== null) {
    if (exceeds(load.grossWeightLbs, superloadWeight.value)) {
      superload = true;
      warnings.push(
        `This load is a superload in ${rules.name}: ${load.grossWeightLbs.toLocaleString()} lb exceeds the ${superloadWeight.value.value.toLocaleString()} lb threshold. Superheavy permits have no published fee — the agency prices them after an engineering review of the route, and applications must be filed roughly three to four weeks ahead. Source: ${citeOf(superloadWeight.chosen?.source ?? superloadWeight.candidates[0]?.source ?? rules.escortRules[0]?.source as SourceDoc)}.`,
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

  // ── 6. Fees ───────────────────────────────────────────────────────────
  // A superload has no published fee schedule. Emitting the general permit's
  // $60 + $375 here would be a confident number the sources do not support,
  // so the priced lines are skipped entirely and the review flag carries it.
  if (permitRequired && !superload) {
    const base = resolveSourced(`${rules.code} single-trip permit base fee`, rules.permitBaseFeeUsd, asOf);
    pushSources(sources, base);
    warnings.push(...base.warnings);
    if (base.requiresManualReview) requiresManualReview = true;
    const baseSpread = spreadOf(base);
    lines.push({
      code: 'osow_permit_base',
      name: `${rules.name} single-trip permit`,
      amountUsd: base.value,
      ...(base.conflict ? { lowUsd: baseSpread.low ?? undefined, highUsd: baseSpread.high ?? undefined } : {}),
      sources: sourcesOf(base),
    });

    // Weight step.
    if (overDimension.weight && load.grossWeightLbs !== undefined) {
      const bandRes = resolveSourced<WeightBand>(
        `${rules.code} overweight fee band`,
        rules.overweightBands.filter((b) => {
          const v = b.value;
          return (
            (load.grossWeightLbs as number) >= v.minLbs &&
            (v.maxLbs === null || (load.grossWeightLbs as number) <= v.maxLbs)
          );
        }),
        asOf,
        weightBandsEqual,
      );
      pushSources(sources, bandRes);
      warnings.push(...bandRes.warnings);
      if (bandRes.requiresManualReview) requiresManualReview = true;
      const spread = { low: null as number | null, high: null as number | null };
      if (bandRes.conflict) {
        const fees = bandRes.candidates.map((c) => c.value.feeUsd);
        spread.low = Math.min(...fees);
        spread.high = Math.max(...fees);
      }
      const band = bandRes.value;
      lines.push({
        code: 'osow_overweight',
        name: 'Highway maintenance fee (overweight)',
        amountUsd: band === null ? null : band.feeUsd,
        ...(bandRes.conflict ? { lowUsd: spread.low ?? undefined, highUsd: spread.high ?? undefined } : {}),
        note: band === null
          ? undefined
          : `${band.minLbs.toLocaleString()}–${band.maxLbs === null ? 'over' : band.maxLbs.toLocaleString()} lb band`,
        sources: sourcesOf(bandRes),
      });
      if (band === null && bandRes.candidates.length === 0) {
        warnings.push(
          `No overweight fee band on file covers ${load.grossWeightLbs.toLocaleString()} lb in ${rules.name}. The permit fee cannot be computed.`,
        );
        requiresManualReview = true;
      }
    }

    // Conditional fees (Texas's Vehicle Supervision Fee).
    for (const cf of rules.conditionalFees) {
      const res = resolveSourced(
        `${rules.code} conditional fee`,
        rules.conditionalFees.filter((x) => conditionalFeesEqual(x.value, cf.value)),
        asOf,
        conditionalFeesEqual,
      );
      if (res.value === null) continue;
      if (load.grossWeightLbs === undefined) continue;
      if (!exceeds(load.grossWeightLbs, res.value.appliesAbove)) continue;
      if (lines.some((l) => l.code === 'osow_supervision')) continue;
      pushSources(sources, res);
      lines.push({
        code: 'osow_supervision',
        name: 'Vehicle supervision fee',
        amountUsd: res.value.feeUsd,
        note: `Applies over ${res.value.appliesAbove.value.toLocaleString()} lb`,
        sources: sourcesOf(res),
      });
    }

    // Payment processing — a percentage of everything above, so it is
    // computed last and only when every preceding line resolved.
    const txRes = resolveSourced<import('./types.js').TransactionFee>(
      `${rules.code} permit transaction fee`,
      rules.transactionFee,
      asOf,
      transactionFeesEqual,
    );
    pushSources(sources, txRes);
    warnings.push(...txRes.warnings);
    const pricedSoFar = lines.every((l) => l.amountUsd !== null)
      ? lines.reduce((s, l) => s + (l.amountUsd ?? 0), 0)
      : null;
    if (txRes.value !== null && pricedSoFar !== null) {
      lines.push({
        code: 'osow_service_fee',
        name: 'Permit service fee',
        amountUsd: applyTransactionFee(pricedSoFar, txRes.value),
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

  // ── 7. Distance-dependent jurisdictions (Phase 2) ─────────────────────
  if (rules.feesDependOnDistance && load.milesInJurisdiction === undefined) {
    warnings.push(
      `${rules.name} prices this permit on distance travelled inside the state, and per-jurisdiction mileage is not yet computed. ${MILEAGE_SPLIT_NOTE}`,
    );
    requiresManualReview = true;
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
  const pricingRefused = permitRequired && lines.length === 0;
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
    superload,
    routeInspectionRequired,
    warnings,
    requiresManualReview,
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

  const threshold = resolveSourced<Threshold>(
    `${rules.code} superload gross-weight threshold`,
    rules.superload.grossWeight,
    asOf,
    thresholdsEqual,
  );
  if (threshold.value === null) return fallbackLbs;
  return Math.max(fallbackLbs, threshold.value.value);
}

export function calculateOsow(
  stateCodes: string[],
  load: OsowLoad,
  asOf: IsoDate = todayIso(),
): OsowQuote {
  const jurisdictions: OsowJurisdictionResult[] = [];
  const uncovered: string[] = [];
  const warnings: string[] = [];
  let requiresManualReview = false;

  const seen = new Set<string>();
  for (const raw of stateCodes) {
    const code = String(raw ?? '').trim().toUpperCase();
    if (code === '' || seen.has(code)) continue;
    seen.add(code);

    const rules = osowRulesFor(code);
    if (rules === null) {
      uncovered.push(code);
      warnings.push(
        `No oversize/overweight permit data is on file for ${code}. Permit fees, escort requirements, and superload thresholds vary by state and cannot be inferred from a neighbouring one, so this leg is not priced.`,
      );
      requiresManualReview = true;
      continue;
    }

    const result = calculateOsowForJurisdiction(rules, load, asOf);
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
    asOf,
  };
}
