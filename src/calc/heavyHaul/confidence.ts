/**
 * THE CONFIDENCE KPI — a score that can be taken apart.
 *
 * ── THE RULE THAT DECIDED EVERY DESIGN CHOICE BELOW ───────────────────────
 * A confident-looking number that hides three assumptions is worse than a lower
 * score that names them. So this does not return a percentage. It returns a
 * percentage AND the itemised list of everything that took points off it, each
 * item naming the fact it keys on, so a reader can see WHAT dragged the number
 * down and WHY — and disagree with any single line without having to distrust
 * the whole figure.
 *
 * ── EVERY INPUT IS SOMETHING THE CODE ALREADY KNOWS ───────────────────────
 * No rubric was invented for this file. Each finding keys on a fact one of the
 * existing engines RECORDS, and the finding names it:
 *
 *   `quote.requiresManualReview`     · src/calc/osow/engine.ts
 *   `jurisdictions[].superload`      · ditto
 *   `jurisdictions[].subtotalUsd === null` (unpriceable ≠ $0) · ditto
 *   `quote.uncoveredJurisdictions`   · ditto
 *   `quote.dataQuality`              · ditto
 *   `quote.absorbedConflicts` + `absorbedConflictTotalUsd` · src/calc/osow/materiality.ts
 *   `split.requiresManualReview`     · src/calc/osow/stateMileage.ts
 *   `LaneEscortEstimate.pilotCarBasis` / `policeFloorIncomplete` · escortCost.ts
 *   `MileageTier` + its measured band · src/calc/heavyHaul/corridor.ts
 *   `DieselPrice.source` / `.stale`  · src/eia/dieselPrice.ts
 *   the geocoder's benchmark + ambiguity · src/calc/heavyHaul/geocode.ts
 *
 * ── WHERE THE NUMBERS COME FROM, AND WHERE I MADE THEM UP ─────────────────
 * Every finding declares its `grounding`, and the three values mean exactly
 * what they say:
 *
 *   'measured'  — the deduction IS a measured error band. Only the mileage
 *                 tier qualifies: 15 points for the scalar tier because the
 *                 evaluation measured its lane totals at ±15%.
 *   'ratio'     — the SIZE is computed from real quantities the engine holds
 *                 (states uncovered ÷ states on the lane, dollars absorbed ÷
 *                 total). The CEILING each ratio scales to is my judgement.
 *   'judgement' — a flat weight I chose. There is no measurement behind the
 *                 number and pretending otherwise would be the exact dishonesty
 *                 this module exists to prevent.
 *
 * The ± band extends `QuoteConfidence` in `src/calc/engine.ts` rather than
 * replacing it: 'high' is still ±4% and 'medium' is still ±8%, the same figures
 * `confidenceAndRange` has always used. 'low' is new and is ±18% — MY
 * JUDGEMENT, argued from the tier-4 lane-total band of ±15% plus room for the
 * components a low score means were excluded outright.
 */
import type { QuoteConfidence } from '../engine.js';

/** How a finding's point value was arrived at. See the module header. */
export type ConfidenceGrounding = 'measured' | 'ratio' | 'judgement';

export interface ConfidenceFinding {
  /** Stable machine code, so a caller can react without parsing prose. */
  code: string;
  /** Six words for the headline strip: "mileage estimated, not routed". */
  headline: string;
  /** The full sentence, naming the fact and what it costs the reader. */
  detail: string;
  /** Points subtracted from 100. Always positive. */
  points: number;
  grounding: ConfidenceGrounding;
  /** The engine field this keys on, named so the claim can be checked. */
  source: string;
}

export interface HeavyHaulConfidence {
  /** 5–100. Never 0: a scored quote always rests on something. */
  score: number;
  /** The existing three-value label. See `QuoteConfidence`. */
  label: QuoteConfidence;
  /** ± band as a fraction, e.g. 0.08. */
  band: number;
  /** One line: "$8,400 · confidence 62% — mileage estimated; MS not covered." */
  headline: string;
  /** Everything that took points off, largest first. Empty means nothing did. */
  findings: ConfidenceFinding[];
  /** Sum of `findings[].points`, before the floor is applied. */
  deducted: number;
}

/**
 * Score → label. The two cut points are MY JUDGEMENT.
 *
 * 85 is set so that a lane priced from filed miles with every state covered and
 * nothing flagged lands 'high', and a single flat judgement deduction does not
 * knock it out of 'high' on its own.
 *
 * 60 is set together with `FLAT_WEIGHTS.noPermitsPriced` so that ANY lane whose
 * permits could not be priced at all lands in 'low' — 15 measured points for
 * the estimated mileage plus 30 for the missing permits is 55, which is under
 * the cut with room to spare. That outcome is the one that matters most on this
 * page and the one a shipper must not mistake for a firm number, so the two
 * numbers were chosen as a pair rather than independently, and saying so is
 * more honest than presenting either as freestanding.
 */
export const CONFIDENCE_HIGH_MIN = 85;
export const CONFIDENCE_MEDIUM_MIN = 60;

/** ± bands. 'high' and 'medium' are the engine's own existing values. */
export const CONFIDENCE_BANDS: Readonly<Record<QuoteConfidence, number>> = {
  high: 0.04,
  medium: 0.08,
  low: 0.18,
};

export function labelForScore(score: number): QuoteConfidence {
  if (score >= CONFIDENCE_HIGH_MIN) return 'high';
  if (score >= CONFIDENCE_MEDIUM_MIN) return 'medium';
  return 'low';
}

/**
 * Ceilings the ratio-grounded findings scale to.
 *
 * THE RATIOS ARE REAL AND THESE CEILINGS ARE MINE. "Three of seven states are
 * uncovered" is a fact; that three-sevenths of the lane being unpriced is worth
 * 13 of 30 points is a judgement, and it is written here as one number in one
 * place so it can be argued with rather than hunted for.
 */
export const RATIO_CEILINGS = {
  /** Whole states we hold no fee schedule for at all. */
  uncoveredStates: 30,
  /** Covered states whose fee could not be computed for this load. */
  unpriceableStates: 25,
  /** Covered, priced states the engine still flagged for a human. */
  reviewStates: 20,
  /** Fee disagreements settled at the higher figure, scaled by dollars moved. */
  absorbedConflicts: 6,
} as const;

/**
 * Flat weights. EVERY ONE OF THESE IS MY JUDGEMENT — there is no measurement
 * behind any of them, and each finding says so in its `grounding`.
 */
export const FLAT_WEIGHTS = {
  /**
   * Permits could not be priced at all, because the lane was never routed.
   * The heaviest flat weight on the board: state permits are the component that
   * makes a heavy-haul quote different from an ordinary freight quote, and a
   * lane missing all of them is missing its defining part. Paired with
   * `CONFIDENCE_MEDIUM_MIN` — see the note there.
   */
  noPermitsPriced: 30,
  /** A superload: above the state's threshold NO published fee exists. */
  superload: 20,
  /** The line haul is excluded because no $/mile was supplied. */
  linehaulExcluded: 20,
  /** Escorts are required and no pilot-car rate was supplied to price them. */
  escortsUnpriced: 10,
  /** A trooper is required in a state that publishes no rate we could floor. */
  policeFloorIncomplete: 4,
  /** The supplied per-state mileage itself needs a human look. */
  mileageSplitReview: 8,
  /** Serving the hardcoded fallback diesel price — not a live index reading. */
  fuelDefaultPrice: 8,
  /** Serving a cached diesel price we could not refresh. */
  fuelStalePrice: 4,
  /** Census returned more than one candidate for an address and we took one. */
  geocodeAmbiguous: 5,
  /** The address matched only on an older Census address-range vintage. */
  geocodeOldBenchmark: 3,
  /** The engine recorded data-quality notes with no dollars attached. */
  dataQualityNotes: 2,
  /** Filed miles and the free straight-line estimate disagree by over a quarter. */
  mileageCrossCheckFailed: 6,
  /**
   * A state the lane provably touches is absent from the filed mileage rows.
   *
   * These two are the only gap weights on the board, and they key on ENDPOINT
   * states alone — never on the wider corridor. The corridor scan is
   * deliberately over-inclusive (bounding boxes, not polygons: it names
   * Louisiana on a Houston-to-Buffalo lane the truck never enters), so
   * deducting for a corridor state a filing omits would punish the honest
   * filing that correctly left it out. An endpoint is different in kind: the
   * load demonstrably starts in one state and ends in the other, both were
   * geocoded from the addresses on this page, and no real filing can omit
   * them. That makes it evidence rather than a question, and it is why these
   * are the heaviest flat weights here.
   *
   * Sized so that any filing missing an endpoint scores below a complete
   * filing of the same lane — the property that stops the score rewarding
   * under-reporting. See the test that asserts that inequality directly.
   */
  filedMissingOneEndpoint: 45,
  filedMissingBothEndpoints: 60,
} as const;

/** Everything the score reads. All of it is recorded by an existing engine. */
export interface ConfidenceInput {
  /** Which mileage tier produced the lane figures. */
  mileageTier: { label: string; totalBandPct: number; mayPriceStates: boolean };
  /** True when at least one state permit fee actually resolved to a number. */
  permitsPriced: boolean;
  /** States on the lane the caller named or the corridor scan asked about. */
  statesOnLane: number;
  /** `quote.uncoveredJurisdictions` — states we hold no schedule for. */
  uncoveredStates: string[];
  /** Covered states whose `subtotalUsd` came back `null`. */
  unpriceableStates: string[];
  /** Covered, priced states with `requiresManualReview`. */
  reviewStates: string[];
  /** Any jurisdiction with `superload: true`. */
  superloadStates: string[];
  /** `quote.absorbedConflictTotalUsd`. */
  absorbedConflictUsd: number;
  /** `quote.dataQuality.length`. */
  dataQualityNotes: number;
  /** `split.requiresManualReview` from `operatorSuppliedStateMileage`. */
  mileageSplitReview: boolean;
  /**
   * Filed miles vs the free scalar estimate, when both existed. `null` when
   * there was nothing to compare. See `mileage.crossCheck`.
   */
  mileageCrossCheck: { differencePct: number; disagrees: boolean } | null;
  /**
   * Endpoint states (origin/destination, as geocoded) that do NOT appear in the
   * filed mileage rows. Empty when the lane was not geocoded, when nothing was
   * filed, or when the filing covers both ends.
   */
  filedMissingEndpointStates: string[];
  /** True when the caller gave a $/mile and line haul is therefore in the total. */
  linehaulPriced: boolean;
  /** Escorts required across the lane, and whether a rate existed to price them. */
  escortsRequired: number;
  escortsPriced: boolean;
  policeFloorIncomplete: boolean;
  /** `DieselPrice.source` and `.stale`. */
  fuelSource: 'eia' | 'usda' | 'cache' | 'default' | 'none';
  fuelStale: boolean;
  /** Geocoder signals. `null` when the lane was given as filed miles, not addresses. */
  geocodeAmbiguous: boolean;
  geocodeOldBenchmark: boolean;
  /** The delivered total the band is drawn around. */
  totalUsd: number;
}

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.max(0, Math.min(1, part / whole));
}

function bandStep(total: number): number {
  // Same clean-dollar stepping as `bandStep` in src/calc/engine.ts, so the
  // heavy-haul range reads like every other range on the site.
  if (total >= 5000) return 50;
  if (total >= 2000) return 25;
  if (total >= 500) return 10;
  if (total >= 100) return 5;
  return 1;
}

/** Build the score. Pure — no clock, no I/O, no randomness. */
export function scoreHeavyHaulConfidence(input: ConfidenceInput): HeavyHaulConfidence {
  const findings: ConfidenceFinding[] = [];
  const add = (f: ConfidenceFinding) => {
    if (f.points > 0) findings.push(f);
  };

  // ── Mileage: the only MEASURED deduction on the board ───────────────────
  if (input.mileageTier.totalBandPct > 0) {
    add({
      code: 'mileage_estimated',
      headline: 'mileage estimated, not routed',
      detail: `Lane distance came from ${input.mileageTier.label.toLowerCase()}, whose lane totals were measured at ±${input.mileageTier.totalBandPct}% against real routed distances. Line haul and fuel are both computed from that figure, so both carry the same band.`,
      points: input.mileageTier.totalBandPct,
      grounding: 'measured',
      source: 'MILEAGE_TIERS[tier].totalBandPct (src/calc/heavyHaul/corridor.ts)',
    });
  }

  // ── Permits ────────────────────────────────────────────────────────────
  if (!input.permitsPriced) {
    add({
      code: 'permits_not_priced',
      headline: 'no state permit priced',
      detail: input.mileageTier.mayPriceStates
        ? 'No state on this lane produced a permit figure, so the total contains no permit money at all.'
        : 'State permits are NOT in this total. Several states price the overweight permit on miles travelled inside that state — Tennessee per ton-mile, Virginia per mile, Louisiana by distance band — and we did not route this lane, so there is no honest in-state mileage to price them from. Enter the per-state miles from your own routing run and every one of them is computed and added.',
      points: FLAT_WEIGHTS.noPermitsPriced,
      grounding: 'judgement',
      source: 'no priced OsowJurisdictionResult (src/calc/osow/engine.ts)',
    });
  }

  if (input.uncoveredStates.length > 0) {
    const ratio = pct(input.uncoveredStates.length, Math.max(1, input.statesOnLane));
    add({
      code: 'states_uncovered',
      headline: `${input.uncoveredStates.join(', ')} not covered`,
      detail: `We hold no fee schedule for ${input.uncoveredStates.length === 1 ? 'this state' : 'these states'}: ${input.uncoveredStates.join(', ')}. ${input.uncoveredStates.length === 1 ? 'It is' : 'They are'} named and left unpriced rather than inferred from a neighbour or quietly counted as $0, so the permit money for ${input.uncoveredStates.length === 1 ? 'it' : 'them'} is missing from this total.`,
      points: Math.round(RATIO_CEILINGS.uncoveredStates * ratio),
      grounding: 'ratio',
      source: 'quote.uncoveredJurisdictions ÷ states on the lane',
    });
  }

  if (input.unpriceableStates.length > 0) {
    const ratio = pct(input.unpriceableStates.length, Math.max(1, input.statesOnLane));
    add({
      code: 'states_unpriceable',
      headline: `${input.unpriceableStates.join(', ')} unpriceable`,
      detail: `We hold ${input.unpriceableStates.length === 1 ? 'this state’s' : 'these states’'} fee schedule and it does not price THIS load: ${input.unpriceableStates.join(', ')}. That is a different statement from "$0" and the total does not include ${input.unpriceableStates.length === 1 ? 'it' : 'them'}.`,
      points: Math.round(RATIO_CEILINGS.unpriceableStates * ratio),
      grounding: 'ratio',
      source: 'jurisdictions[].subtotalUsd === null ÷ states on the lane',
    });
  }

  if (input.superloadStates.length > 0) {
    add({
      code: 'superload',
      headline: `superload in ${input.superloadStates.join(', ')}`,
      detail: `Above a state's superload threshold there is no published fee — the agency prices the move after an engineering review of the route and its bridges, typically three to four weeks out. No permit amount is quoted for ${input.superloadStates.join(', ')}, and the review and engineering costs are not in this total either.`,
      points: FLAT_WEIGHTS.superload,
      grounding: 'judgement',
      source: 'jurisdictions[].superload (src/calc/osow/engine.ts)',
    });
  }

  if (input.reviewStates.length > 0) {
    const ratio = pct(input.reviewStates.length, Math.max(1, input.statesOnLane));
    add({
      code: 'states_manual_review',
      headline: `${input.reviewStates.join(', ')} flagged for review`,
      detail: `${input.reviewStates.join(', ')} produced a figure and the engine still flagged ${input.reviewStates.length === 1 ? 'it' : 'them'} for a human — an unsettled fact in the published rules, a second issuing authority, or an escort rule the state's own documents do not resolve. The reason is printed verbatim beside each state.`,
      points: Math.round(RATIO_CEILINGS.reviewStates * ratio),
      grounding: 'ratio',
      source: 'jurisdictions[].requiresManualReview ÷ states on the lane',
    });
  }

  if (input.absorbedConflictUsd > 0 && input.totalUsd > 0) {
    const share = pct(input.absorbedConflictUsd, input.totalUsd);
    add({
      code: 'absorbed_conflicts',
      headline: 'sources disagreed on a fee',
      detail: `Official sources disagreed on ${input.absorbedConflictUsd.toFixed(2)} dollars of this total. Each disagreement was quoted at the HIGHER figure rather than stopping the quote, and every one is listed with the two candidate documents so you can see which number moved.`,
      points: Math.max(1, Math.round(RATIO_CEILINGS.absorbedConflicts * Math.min(1, share * 20))),
      grounding: 'ratio',
      source: 'quote.absorbedConflictTotalUsd ÷ total',
    });
  } else if (input.dataQualityNotes > 0) {
    add({
      code: 'data_quality_notes',
      headline: 'data-quality notes recorded',
      detail: `The permit engine recorded ${input.dataQualityNotes} data-quality note${input.dataQualityNotes === 1 ? '' : 's'} on this lane. None of them moved a dollar figure, and all are listed.`,
      points: FLAT_WEIGHTS.dataQualityNotes,
      grounding: 'judgement',
      source: 'quote.dataQuality (src/calc/osow/engine.ts)',
    });
  }

  if (input.mileageSplitReview) {
    add({
      code: 'mileage_split_review',
      headline: 'a mileage row was unusable',
      detail:
        'At least one per-state mileage row could not be used — a missing state code or a distance that is not a usable number. The states on a lane cannot be inferred from the ones that were named, so that leg is not priced at all rather than guessed at.',
      points: FLAT_WEIGHTS.mileageSplitReview,
      grounding: 'judgement',
      source: 'StateMileageSplit.requiresManualReview (src/calc/osow/stateMileage.ts)',
    });
  }

  if (input.filedMissingEndpointStates.length > 0) {
    const missing = input.filedMissingEndpointStates;
    const both = missing.length > 1;
    add({
      code: 'filed_missing_endpoint_state',
      headline: `${missing.join(' and ')} ${both ? 'are' : 'is'} not in your filed miles`,
      detail:
        `The addresses on this page place this load in ${missing.join(' and ')}, but ${both ? 'neither state has' : 'that state has'} a mileage row, so ${both ? 'no' : 'its'} permit was priced and ${both ? 'none' : 'it'} is in the total. A load provably crosses the states it starts and ends in, so this is a gap in the filing rather than a routing question. Add ${both ? 'those rows' : 'that row'} and the permit is priced and cited like the others.`,
      points: both ? FLAT_WEIGHTS.filedMissingBothEndpoints : FLAT_WEIGHTS.filedMissingOneEndpoint,
      grounding: 'judgement',
      source: 'geocoded endpoint states vs filedLegs (src/calc/heavyHaul/quote.ts)',
    });
  }

  if (input.mileageCrossCheck?.disagrees === true) {
    const pctText = `${input.mileageCrossCheck.differencePct > 0 ? '+' : ''}${input.mileageCrossCheck.differencePct}%`;
    add({
      code: 'mileage_crosscheck',
      headline: 'filed miles look off against the map',
      detail: `Your filed lane total is ${pctText} against a straight-line estimate between the two addresses. A real permitted route legitimately runs longer than the shortest one, so this is a question and not a correction — nothing was changed. It is worth re-reading the per-state rows for a transposed digit, because tier-0 risk is transcription, not measurement.`,
      points: FLAT_WEIGHTS.mileageCrossCheckFailed,
      grounding: 'judgement',
      source: 'filed total vs scalarLaneDistance (src/calc/heavyHaul/corridor.ts)',
    });
  }

  // ── Line haul ──────────────────────────────────────────────────────────
  if (!input.linehaulPriced) {
    add({
      code: 'linehaul_excluded',
      headline: 'line haul not included',
      detail:
        'No line haul is in this total. Moving the load is normally the largest single number on a heavy-haul quote, and we will not invent a market rate for it — the rate-card engine that prices line haul needs a carrier account, and a made-up per-mile figure beside cited statute numbers would be the one dishonest line on the page. Enter your own $/mile and it is added, labelled as yours.',
      points: FLAT_WEIGHTS.linehaulExcluded,
      grounding: 'judgement',
      source: 'no linehaulUsdPerMile supplied on the request',
    });
  }

  // ── Escorts ────────────────────────────────────────────────────────────
  if (input.escortsRequired > 0 && !input.escortsPriced) {
    add({
      code: 'escorts_unpriced',
      headline: 'escort cost excluded',
      detail: `This move needs ${input.escortsRequired} certified escort${input.escortsRequired === 1 ? '' : 's'} and none of them is priced here. Pilot cars are private vendors; states set the requirement, not the price, and we hold no pilot-car rates. On a long lane one escort can cost more than every permit on this quote combined. Enter your own pilot-car rate and it is applied to these counts.`,
      points: FLAT_WEIGHTS.escortsUnpriced,
      grounding: 'judgement',
      source: 'LaneEscortEstimate.pilotCarBasis === "none" (src/calc/osow/escortCost.ts)',
    });
  }

  if (input.policeFloorIncomplete) {
    add({
      code: 'police_floor_incomplete',
      headline: 'a police escort has no published rate',
      detail:
        'A state on this lane requires a law-enforcement escort and publishes no rate we could put a floor under. Only six states publish one at all; the rest set it at the permitting office on the day.',
      points: FLAT_WEIGHTS.policeFloorIncomplete,
      grounding: 'judgement',
      source: 'LaneEscortEstimate.policeFloorIncomplete (src/calc/osow/escortCost.ts)',
    });
  }

  // ── Fuel ───────────────────────────────────────────────────────────────
  if (input.fuelSource === 'default') {
    add({
      code: 'fuel_default_price',
      headline: 'diesel price is a fallback constant',
      detail:
        'The EIA weekly diesel index could not be read and no cached reading was available, so the fuel surcharge was computed from a hardcoded fallback price rather than a live index reading. It is the one figure on this quote with no date behind it.',
      points: FLAT_WEIGHTS.fuelDefaultPrice,
      grounding: 'judgement',
      source: 'DieselPrice.source === "default" (src/eia/dieselPrice.ts)',
    });
  } else if (input.fuelStale) {
    add({
      code: 'fuel_stale_price',
      headline: 'diesel price could not be refreshed',
      detail:
        'The fuel surcharge was computed from a cached EIA diesel price we could not refresh. The index date is shown beside the fuel line so you can see how old it is.',
      points: FLAT_WEIGHTS.fuelStalePrice,
      grounding: 'judgement',
      source: 'DieselPrice.stale (src/eia/dieselPrice.ts)',
    });
  }

  // ── Geocoding ──────────────────────────────────────────────────────────
  if (input.geocodeAmbiguous) {
    add({
      code: 'geocode_ambiguous',
      headline: 'an address matched more than one place',
      detail:
        'The Census geocoder returned more than one candidate for an address and the first was used. The matched address is printed back to you — check it, because the lane distance is measured from it.',
      points: FLAT_WEIGHTS.geocodeAmbiguous,
      grounding: 'judgement',
      source: 'GeocodedPoint.ambiguous (src/calc/heavyHaul/geocode.ts)',
    });
  }

  if (input.geocodeOldBenchmark) {
    add({
      code: 'geocode_old_benchmark',
      headline: 'an address matched on an older address file',
      detail:
        'An address did not match the current Census address-range file and was resolved against an older vintage. That is usually a new-build street; occasionally it is a renumbered one. The matched address is printed back to you.',
      points: FLAT_WEIGHTS.geocodeOldBenchmark,
      grounding: 'judgement',
      source: 'GeocodedPoint.benchmark ≠ Public_AR_Current (src/calc/heavyHaul/geocode.ts)',
    });
  }

  findings.sort((a, b) => b.points - a.points || a.code.localeCompare(b.code));

  const deducted = findings.reduce((sum, f) => sum + f.points, 0);
  // FLOOR AT 5, NEVER 0. A zero would read as "this quote is worthless", and it
  // never is: the permit corpus, the diesel index and the arithmetic are the
  // same on a 5 as on a 95. What changes is how much of the lane they reached.
  const score = Math.max(5, Math.min(100, 100 - deducted));
  const label = labelForScore(score);

  const top = findings.slice(0, 3).map((f) => f.headline);
  const headline =
    top.length === 0
      ? `confidence ${score}% — every component priced from a cited figure or your own rate`
      : `confidence ${score}% — ${top.join('; ')}${findings.length > top.length ? `; +${findings.length - top.length} more` : ''}`;

  return {
    score,
    label,
    band: CONFIDENCE_BANDS[label],
    headline,
    findings,
    deducted,
  };
}

/** total ± band, snapped to clean dollars — the same shape `CalcResult` uses. */
export function confidenceRange(
  total: number,
  band: number,
): { low: number; high: number } {
  const step = bandStep(total);
  return {
    low: Math.max(0, Math.floor((total * (1 - band)) / step) * step),
    high: Math.ceil((total * (1 + band)) / step) * step,
  };
}
