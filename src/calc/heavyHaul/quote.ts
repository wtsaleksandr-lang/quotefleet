/**
 * THE HEAVY-HAUL DELIVERED-COST COMPOSER.
 *
 * Almost nothing here is new arithmetic. It puts four existing engines side by
 * side and refuses, loudly, wherever one of them cannot answer:
 *
 *   permits    src/calc/osow/*            21 states, statute-cited, effective-dated
 *   escorts    src/calc/osow/escortCost   6 states' police rates; YOUR pilot-car rate
 *   fuel       src/calc/fuelSurcharge     EIA weekly diesel index, DOE-index model
 *   distance   src/calc/heavyHaul/corridor  filed figures, or a scalar lane total
 *
 * ── THE TWO RULES THAT SHAPE THE OUTPUT ───────────────────────────────────
 *
 * 1. A CITED FIGURE AND AN ESTIMATE ARE NEVER ADDED INTO ONE UNDIFFERENTIATED
 *    NUMBER. Every line carries a `basis`, and the response carries the three
 *    subtotals separately: money we SOURCED, money computed from a rate YOU
 *    gave us, and money DERIVED from a published index through a model whose
 *    assumptions are ours. The page draws the second differently — dashed
 *    outline, a `YOUR RATE — NOT A FIGURE WE SOURCE` pill — exactly as the
 *    permits calculator already does for pilot cars.
 *
 * 2. `null` IS NOT `0`. A component that applies and cannot be priced comes
 *    back with `amountUsd: null` and a sentence saying why, and the delivered
 *    total is marked PARTIAL. Summing an unpriceable line as zero is the single
 *    worst thing this file could do, because the result looks complete.
 *
 * NO MARGIN. Quoting somebody else's margin for them is not this tool's
 * business and there is no code path here that adds one.
 *
 * NO DATABASE, NO PAID API. The permit corpus is compiled in, the diesel price
 * is passed in by the caller, and the only network call in the whole feature is
 * the free keyless US Census geocoder. The tool answers with the database down.
 */
import type { CalcLine, QuoteConfidence } from '../engine.js';
import { autoFscPerMile } from '../fuelSurcharge.js';
import { AUTO_FSC_DEFAULTS } from '../defaults.js';
import type { OsowLoad, OsowQuote } from '../osow/engine.js';
import {
  operatorSuppliedStateMileage,
  priceOsowWithStateMileage,
} from '../osow/stateMileage.js';
import {
  estimateLaneEscortCost,
  type LaneEscortEstimate,
  type UserPilotCarRate,
} from '../osow/escortCost.js';
import type { SourceDoc, IsoDate } from '../osow/provenance.js';
import { todayIso } from '../osow/provenance.js';
import { hasOsowCoverage } from '../osow/jurisdictions/index.js';
import {
  corridorStates,
  filedLaneDistance,
  scalarLaneDistance,
  MILEAGE_TIERS,
  CORRIDOR_DISCLAIMER,
  type CorridorState,
  type LaneDistance,
} from './corridor.js';
import {
  scoreHeavyHaulConfidence,
  confidenceRange,
  type HeavyHaulConfidence,
} from './confidence.js';

/**
 * WHAT KIND OF CLAIM A LINE IS. The page must never let two of these read the
 * same, so the distinction is carried in the data rather than left to CSS.
 */
export type LineBasis =
  /** Traced to a statute, a published fee schedule or a government index. */
  | 'sourced'
  /** Computed from a rate the CALLER supplied. Their arithmetic, not our figure. */
  | 'yours'
  /** A sourced input run through a model whose assumptions are ours. Fuel only. */
  | 'derived';

export interface HeavyHaulLine {
  /** Shares `CalcLine['kind']` — the same vocabulary, not a parallel one. */
  kind: CalcLine['kind'];
  name: string;
  /**
   * `null` means THIS APPLIES AND CANNOT BE PRICED — never $0. A line that is
   * genuinely free carries `0`.
   */
  amountUsd: number | null;
  basis: LineBasis;
  note?: string;
  code?: string;
  /** Only on `basis: 'sourced'` lines. The documents behind the number. */
  sources?: SourceDoc[];
}

/** The caller's own rates. Nothing here is ever supplied by us. */
export interface HeavyHaulRates {
  /** Line-haul $/mile. Without it, line haul is excluded and says so. */
  linehaulUsdPerMile?: number;
  /** Optional floor on the line haul, the caller's own minimum. */
  linehaulMinimumUsd?: number;
  /** The caller's pilot-car rate. See `UserPilotCarRate`. */
  pilotCar?: UserPilotCarRate;
}

/** The diesel reading, passed in so this module stays pure and DB-free. */
export interface DieselReading {
  usdPerGal: number;
  /** ISO date of the EIA weekly reading. Empty when a fallback constant is used. */
  asOf: string;
  source: 'eia' | 'usda' | 'cache' | 'default' | 'none';
  stale: boolean;
}

export interface HeavyHaulCargo {
  grossWeightLbs: number;
  widthIn?: number;
  heightIn?: number;
  overallLengthIn?: number;
  trailerLengthIn?: number;
  axleCount?: number;
  routeClass?: OsowLoad['routeClass'];
}

/** One end of the lane, already resolved (or explicitly not). */
export interface LaneEndpoint {
  address: string;
  matchedAddress: string;
  latitude: number;
  longitude: number;
  state: string | null;
  /** The Census benchmark that answered. */
  benchmark: string;
  ambiguous: boolean;
}

export interface HeavyHaulRequest {
  cargo: HeavyHaulCargo;
  /** Both ends, when the caller gave addresses. Absent on a filed-miles quote. */
  lane?: { origin: LaneEndpoint; destination: LaneEndpoint };
  /**
   * The caller's filed per-state mileage. WHEN PRESENT THIS IS THE MILEAGE
   * BASIS — tier 0 — and permits are priced from it. When absent the lane runs
   * at tier 4: a lane total only, no per-state figure, and no permit priced.
   */
  filedLegs?: ReadonlyArray<{ stateCode: string; stateName?: string; miles: number }>;
  rates?: HeavyHaulRates;
  diesel: DieselReading;
  asOf?: IsoDate;
  /**
   * Display names for state codes the PERMIT ENGINE cannot name, i.e. the
   * uncovered ones — a state we hold no rules for has no `jurisdictionName`.
   * Optional, and falling back to the bare code is correct rather than lossy.
   */
  stateNames?: Readonly<Record<string, string>>;
}

export interface HeavyHaulQuote {
  asOf: IsoDate;
  lines: HeavyHaulLine[];
  /** Money traced to a statute, a fee schedule or a government index. */
  subtotalSourcedUsd: number;
  /** Money computed from a rate the caller supplied. Never blended above. */
  subtotalYourRatesUsd: number;
  /** Money from a sourced index through a model of ours. */
  subtotalDerivedUsd: number;
  /**
   * The delivered figure. `null` when NOTHING priced. When `partial` is true it
   * is a real sum of what DID price and is explicitly not a lane total.
   */
  deliveredUsd: number | null;
  /** True when any applicable component came back unpriced. */
  partial: boolean;
  /** Named reasons the figure is partial. Empty when it is complete. */
  partialBecause: string[];
  /** `deliveredUsd` ± the confidence band, snapped to clean dollars. */
  lowUsd: number | null;
  highUsd: number | null;
  confidence: HeavyHaulConfidence;
  /** The existing three-value label, for anything that reads only that. */
  confidenceLabel: QuoteConfidence;
  mileage: LaneDistance & {
    tierLabel: string;
    tierBasis: string;
    /** True when the tier is allowed to feed a distance-priced permit. */
    mayPriceStates: boolean;
    /**
     * Filed miles measured against the free scalar estimate. Present only when
     * BOTH were available. It never moves a fee — it catches a typo.
     */
    crossCheck: {
      scalarEstimateMiles: number;
      filedMiles: number;
      differencePct: number;
      disagrees: boolean;
    } | null;
  };
  /** Present only at a tier that cannot price states. The prompt, not a price. */
  corridor: {
    states: CorridorState[];
    disclaimer: string;
  } | null;
  /** The permit engine's verbatim output. `null` when no permits were priced. */
  permits: OsowQuote | null;
  escorts: LaneEscortEstimate | null;
  fuel: {
    dieselUsdPerGal: number;
    asOf: string;
    source: DieselReading['source'];
    stale: boolean;
    perMileUsd: number;
    /** Said out loud: the peg and the mpg are OUR assumptions, not EIA's. */
    modelNote: string;
  };
  notIncluded: ReadonlyArray<{ item: string; why: string }>;
  disclaimer: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const HEAVY_HAUL_DISCLAIMER =
  'A delivered-cost ESTIMATE, not a contract rate. State permit fees are cited to the statute or fee schedule they came from; line haul and pilot cars are computed from the rates YOU entered and are never figures we source; fuel comes from the EIA weekly diesel index through a surcharge model whose peg and fuel economy are our assumptions.';

/**
 * Everything the delivered figure leaves out, stated once and reused by the
 * page, the API and the tests so the three cannot drift.
 */
export const HEAVY_HAUL_NOT_INCLUDED: ReadonlyArray<{ item: string; why: string }> = [
  {
    item: 'Broker margin, and any margin at all',
    why: 'Quoting your margin for you is not our business, and there is no code path in this tool that adds one. Every number here is a cost.',
  },
  {
    item: 'A market line-haul rate',
    why: 'The rate-card engine that prices line haul needs a carrier account, so a public no-account tool cannot price it. Rather than invent a market rate beside cited statute figures, we take yours and label it as yours.',
  },
  {
    item: 'Permits from a second issuing authority',
    why: 'A toll road, a bridge authority or a city can require its own permit inside a state we do price. Where we know of one, that state’s notes name it.',
  },
  {
    item: 'Route surveys, bridge analysis and superload engineering',
    why: 'Several states impose these at the permitting office’s discretion, with no published price, and a superload has no over-the-counter fee at all.',
  },
  {
    item: 'Tolls, escorts beyond your own stated rate, and permit-service brokerage',
    why: 'Tolls vary by the routing the state assigns. A law-enforcement escort is cited where the state publishes a rate and left unpriced where it does not.',
  },
  {
    item: 'Insurance, tarps, dunnage, detention and layover',
    why: 'All are real heavy-haul costs and all are yours to add — none of them has a published figure this tool could cite.',
  },
];

/**
 * Price a heavy-haul lane. PURE — no I/O, no clock beyond `asOf`, no database.
 */
export function priceHeavyHaulLane(input: HeavyHaulRequest): HeavyHaulQuote {
  const asOf = input.asOf ?? todayIso();
  const lines: HeavyHaulLine[] = [];
  const partialBecause: string[] = [];

  const load: OsowLoad = {
    grossWeightLbs: input.cargo.grossWeightLbs,
    ...(input.cargo.widthIn !== undefined ? { widthIn: input.cargo.widthIn } : {}),
    ...(input.cargo.heightIn !== undefined ? { heightIn: input.cargo.heightIn } : {}),
    ...(input.cargo.overallLengthIn !== undefined
      ? { overallLengthIn: input.cargo.overallLengthIn }
      : {}),
    ...(input.cargo.trailerLengthIn !== undefined
      ? { trailerLengthIn: input.cargo.trailerLengthIn }
      : {}),
    ...(input.cargo.axleCount !== undefined ? { axleCount: input.cargo.axleCount } : {}),
    ...(input.cargo.routeClass !== undefined ? { routeClass: input.cargo.routeClass } : {}),
  };

  // ── 1. Mileage ──────────────────────────────────────────────────────────
  const filedLegs = input.filedLegs ?? [];
  const hasFiled = filedLegs.length > 0;
  const distance: LaneDistance = hasFiled
    ? filedLaneDistance(filedLegs.map((l) => ({ stateCode: l.stateCode, miles: l.miles })))
    : input.lane
      ? scalarLaneDistance(input.lane.origin, input.lane.destination)
      : {
          tier: 'scalar',
          totalMiles: 0,
          straightLineMiles: null,
          totalPlusMinusMiles: 0,
          mayPriceStates: false,
          notes: ['No lane distance could be established: neither two addresses nor filed per-state miles were supplied.'],
        };
  const tierSpec = MILEAGE_TIERS[distance.tier];

  /**
   * THE ONE GENUINELY GOOD USE OF THE LOW TIER: sanity-checking the high one.
   *
   * Filed figures are authoritative and are still typed by a human. When both
   * addresses AND filed miles are present, the scalar estimate costs nothing
   * and catches a transposed digit — the risk at tier 0 is transcription, not
   * measurement. It NEVER changes a fee; it raises a question.
   *
   * The ±25% gate is MY JUDGEMENT: the scalar tier's own measured band is ±15%,
   * and a real permitted route can legitimately run longer than the shortest
   * one, so the gate is set wide enough that an honest detour does not trip it.
   */
  let crossCheck: {
    scalarEstimateMiles: number;
    filedMiles: number;
    differencePct: number;
    disagrees: boolean;
  } | null = null;
  if (hasFiled && input.lane) {
    const scalar = scalarLaneDistance(input.lane.origin, input.lane.destination);
    const differencePct =
      scalar.totalMiles > 0
        ? Math.round(((distance.totalMiles - scalar.totalMiles) / scalar.totalMiles) * 1000) / 10
        : 0;
    crossCheck = {
      scalarEstimateMiles: scalar.totalMiles,
      filedMiles: distance.totalMiles,
      differencePct,
      disagrees: Math.abs(differencePct) > 25,
    };
  }

  // ── 2. Permits — priced ONLY from filed per-state miles ─────────────────
  //
  // THE REFUSAL IS THE FEATURE. At tier 4 there is no in-state mileage that is
  // not invented, and Tennessee bills 6¢ per ton-mile: at 40 tons over the
  // legal limit ONE wrong mile is $2.40 and fifty is $120 on that state alone.
  // A straight line through Houston→Buffalo also invents Louisiana outright,
  // which is $285 of permit for a state the truck never enters. So no permit is
  // priced without filed figures, and the corridor list below asks for them.
  let permits: OsowQuote | null = null;
  let splitRequiresReview = false;
  if (hasFiled) {
    const split = operatorSuppliedStateMileage(
      filedLegs.map((l) => ({
        stateCode: l.stateCode,
        ...(l.stateName === undefined ? {} : { stateName: l.stateName }),
        miles: l.miles,
      })),
    );
    splitRequiresReview = split.requiresManualReview;
    // The ONLY sanctioned entry point for pricing off a split — it carries the
    // "these miles are yours, not ours" warnings into the quote. Calling
    // `calculateOsow(osowLegsFrom(split), …)` is arithmetically identical and
    // silently drops every one of them.
    permits = priceOsowWithStateMileage(split, load, asOf);

    for (const j of permits.jurisdictions) {
      lines.push({
        kind: 'permit',
        code: `permit_${j.jurisdiction}`,
        name: `${j.jurisdictionName} single-trip OS/OW permit`,
        amountUsd: j.subtotalUsd,
        basis: 'sourced',
        note:
          j.subtotalUsd === null
            ? j.superload
              ? `${j.jurisdictionName} treats this as a superload — above its threshold no published fee exists and the agency prices the move after an engineering review.`
              : `${j.jurisdictionName}'s published schedule does not price this load. The reason is in that state's notes; it is not $0.`
            : j.lines
                .filter((l) => l.amountUsd !== null && l.amountUsd !== 0)
                .map((l) => `${l.name} $${(l.amountUsd ?? 0).toFixed(2)}`)
                .join(' · '),
        sources: j.sources,
      });
    }
    for (const code of permits.uncoveredJurisdictions) {
      const name = input.stateNames?.[code] ?? code;
      lines.push({
        kind: 'permit',
        code: `permit_${code}`,
        name: `${name} single-trip OS/OW permit`,
        amountUsd: null,
        basis: 'sourced',
        note: `We hold no fee schedule for ${name} and will not infer one from a neighbouring state. It is named and unpriced, never counted as $0.`,
      });
    }
  } else {
    lines.push({
      kind: 'permit',
      code: 'permit_all',
      name: 'State OS/OW permits',
      amountUsd: null,
      basis: 'sourced',
      note: `Not priced. ${tierSpec.label} produces a lane total and no per-state mileage, and several states price the overweight permit on miles travelled inside that state. Add your filed per-state miles below and every covered state is computed and added.`,
    });
  }

  const permitsPriced =
    permits !== null && permits.jurisdictions.some((j) => j.subtotalUsd !== null);
  if (!permitsPriced) {
    partialBecause.push(
      hasFiled
        ? 'no state on this lane produced a permit figure'
        : 'state permit fees are not included — this lane was not routed, so there is no in-state mileage to price them from',
    );
  }

  const uncoveredStates = permits?.uncoveredJurisdictions ?? [];
  if (uncoveredStates.length > 0) {
    partialBecause.push(
      `no fee schedule on file for ${uncoveredStates.join(', ')}, so ${uncoveredStates.length === 1 ? 'its' : 'their'} permit money is missing`,
    );
  }
  const unpriceableStates = (permits?.jurisdictions ?? [])
    .filter((j) => j.subtotalUsd === null)
    .map((j) => j.jurisdiction);
  if (unpriceableStates.length > 0) {
    partialBecause.push(
      `${unpriceableStates.join(', ')} could not be priced for this load`,
    );
  }

  // ── 3. Line haul — the caller's own $/mile, labelled as theirs ──────────
  const perMile = input.rates?.linehaulUsdPerMile;
  const linehaulPriced = typeof perMile === 'number' && perMile > 0 && distance.totalMiles > 0;
  if (linehaulPriced) {
    const computed = perMile * distance.totalMiles;
    const minimum = input.rates?.linehaulMinimumUsd ?? 0;
    const floored = minimum > 0 && computed < minimum;
    lines.push({
      kind: floored ? 'minimum' : 'linehaul',
      code: 'linehaul',
      name: floored
        ? 'Line haul — your minimum charge'
        : `Line haul (${Math.round(distance.totalMiles).toLocaleString()} mi × $${perMile.toFixed(2)}/mi)`,
      amountUsd: round2(floored ? minimum : computed),
      basis: 'yours',
      note: floored
        ? `${Math.round(distance.totalMiles).toLocaleString()} mi × $${perMile.toFixed(2)}/mi came to $${computed.toFixed(2)}, below the $${minimum.toFixed(2)} minimum you entered. YOUR rate and YOUR minimum — we hold no market line-haul rate and do not supply one.`
        : `YOUR rate, not a figure we source. ${
            distance.tier === 'filed'
              ? 'Multiplied by the total of the per-state miles you supplied.'
              : `Multiplied by an ESTIMATED lane distance (±${tierSpec.totalBandPct}%), so this line carries that band even though your rate is exact.`
          }`,
    });
  } else {
    lines.push({
      kind: 'linehaul',
      code: 'linehaul',
      name: 'Line haul',
      amountUsd: null,
      basis: 'yours',
      note: 'Not included. Moving the load is normally the largest number on a heavy-haul quote, and we will not invent a market rate for it — the engine that prices line haul needs a carrier account. Enter your own $/mile and it is added, labelled as yours.',
    });
    partialBecause.push('line haul is not included — no $/mile was supplied');
  }

  // ── 4. Fuel — EIA index, our model, and it says which is which ──────────
  const fscPerMile = autoFscPerMile({
    dieselUsdPerGal: input.diesel.usdPerGal,
    pegUsdPerGal: AUTO_FSC_DEFAULTS.pegUsdPerGal,
    mpg: AUTO_FSC_DEFAULTS.mpg,
  });
  /**
   * HALF SOURCED, HALF OURS, AND IT SAYS SO IN THAT ORDER.
   *
   * The provenance sentence leads because the page clamps a line's note to three
   * lines: whichever sentence gets clipped must not be the one that separates a
   * cited figure from an assumption of ours. The arithmetic closes it, so a
   * reader can check the number against the column beside it.
   */
  const fuelModelNote = `The DIESEL PRICE is sourced: the EIA weekly national on-highway No. 2 retail price${input.diesel.asOf ? `, week of ${input.diesel.asOf}` : ''} — US Government, public domain. The PEG ($${AUTO_FSC_DEFAULTS.pegUsdPerGal.toFixed(2)}/gal) and the FUEL ECONOMY (${AUTO_FSC_DEFAULTS.mpg} mpg) are OUR assumptions — the standard OOIDA figures, and your own FSC table may peg elsewhere. DOE-index model: ($${input.diesel.usdPerGal.toFixed(2)} − $${AUTO_FSC_DEFAULTS.pegUsdPerGal.toFixed(2)}) ÷ ${AUTO_FSC_DEFAULTS.mpg} = $${fscPerMile.toFixed(3)}/mi.`;
  const fuelUsd = distance.totalMiles > 0 ? round2(fscPerMile * distance.totalMiles) : 0;
  if (distance.totalMiles > 0) {
    lines.push({
      kind: 'fuel',
      code: 'fuel',
      name: `Fuel surcharge (${Math.round(distance.totalMiles).toLocaleString()} mi × $${fscPerMile.toFixed(3)}/mi)`,
      amountUsd: fuelUsd,
      basis: 'derived',
      note: fuelModelNote,
    });
  }

  // ── 5. Escorts — two channels that are never added together ─────────────
  let escorts: LaneEscortEstimate | null = null;
  if (permits !== null) {
    escorts = estimateLaneEscortCost(
      permits,
      Object.fromEntries(filedLegs.map((l) => [l.stateCode.toUpperCase(), l.miles])),
      {
        asOf,
        ...(input.rates?.pilotCar === undefined ? {} : { pilotCarRate: input.rates.pilotCar }),
      },
    );

    if (escorts.pilotCarsRequired > 0) {
      lines.push({
        kind: 'escort',
        code: 'pilot_cars',
        name: `Pilot cars (${escorts.pilotCarsRequired} required across the lane)`,
        amountUsd: escorts.pilotCarUsd,
        basis: 'yours',
        note:
          escorts.pilotCarUsd === null
            ? 'Not priced. States set the escort REQUIREMENT; pilot cars are private vendors and we hold no rates of our own — no state publishes one, and your negotiated rate beats any range we could invent. Enter yours and it is applied to these counts.'
            : 'YOUR rate applied to the escort counts each state’s own rules require. Never inside a permit fee.',
      });
      if (escorts.pilotCarUsd === null) {
        partialBecause.push(
          `${escorts.pilotCarsRequired} pilot car${escorts.pilotCarsRequired === 1 ? ' is' : 's are'} required and no pilot-car rate was supplied to price them`,
        );
      }
    }

    if (escorts.policeOfficersRequired > 0) {
      lines.push({
        kind: 'escort',
        code: 'police_escort',
        name: `Law-enforcement escort floor (${escorts.policeOfficersRequired} officer${escorts.policeOfficersRequired === 1 ? '' : 's'}, ${escorts.policeStatesRequiring.join(', ')})`,
        amountUsd: escorts.policeFloorUsd,
        basis: 'sourced',
        note:
          escorts.policeFloorUsd === null
            ? 'Required, and no published rate exists to floor it. Only six states publish a law-enforcement escort rate; elsewhere the permitting office sets it on the day.'
            : 'The published MINIMUM the schedule can charge, cited and effective-dated. It is a floor, never a total — the hours are set by the agency on the day.',
        sources: escorts.policeSources,
      });
      if (escorts.policeFloorIncomplete) {
        partialBecause.push(
          `a law-enforcement escort is required in ${escorts.policeStatesWithoutFloor.join(', ')} and that state publishes no rate`,
        );
      }
    }
  }

  // ── 6. Totals, kept apart by basis ──────────────────────────────────────
  const sumBy = (basis: LineBasis) =>
    round2(
      lines
        .filter((l) => l.basis === basis && l.amountUsd !== null)
        .reduce((sum, l) => sum + (l.amountUsd as number), 0),
    );
  const subtotalSourcedUsd = sumBy('sourced');
  const subtotalYourRatesUsd = sumBy('yours');
  const subtotalDerivedUsd = sumBy('derived');
  const anyPriced = lines.some((l) => l.amountUsd !== null && l.amountUsd > 0);
  const deliveredUsd = anyPriced
    ? round2(subtotalSourcedUsd + subtotalYourRatesUsd + subtotalDerivedUsd)
    : null;
  const partial = partialBecause.length > 0;

  // ── 7. The KPI ──────────────────────────────────────────────────────────
  const reviewStates = (permits?.jurisdictions ?? [])
    .filter((j) => j.requiresManualReview && j.subtotalUsd !== null)
    .map((j) => j.jurisdiction);
  const superloadStates = (permits?.jurisdictions ?? [])
    .filter((j) => j.superload)
    .map((j) => j.jurisdiction);

  const corridor =
    !tierSpec.mayPriceStates && input.lane
      ? {
          states: corridorStates(input.lane.origin, input.lane.destination, hasOsowCoverage, {
            originState: input.lane.origin.state,
            destinationState: input.lane.destination.state,
          }),
          disclaimer: CORRIDOR_DISCLAIMER,
        }
      : null;

  const statesOnLane = hasFiled
    ? filedLegs.length
    : Math.max(1, corridor?.states.length ?? 1);

  const confidence = scoreHeavyHaulConfidence({
    mileageTier: {
      label: tierSpec.label,
      totalBandPct: tierSpec.totalBandPct,
      mayPriceStates: tierSpec.mayPriceStates,
    },
    permitsPriced,
    statesOnLane,
    uncoveredStates,
    unpriceableStates,
    reviewStates,
    superloadStates,
    absorbedConflictUsd: permits?.absorbedConflictTotalUsd ?? 0,
    dataQualityNotes: permits?.dataQuality.length ?? 0,
    mileageSplitReview: splitRequiresReview,
    mileageCrossCheck: crossCheck
      ? { differencePct: crossCheck.differencePct, disagrees: crossCheck.disagrees }
      : null,
    linehaulPriced,
    escortsRequired: escorts?.pilotCarsRequired ?? 0,
    escortsPriced: escorts?.pilotCarUsd !== null && escorts?.pilotCarUsd !== undefined,
    policeFloorIncomplete: escorts?.policeFloorIncomplete ?? false,
    fuelSource: input.diesel.source,
    fuelStale: input.diesel.stale,
    geocodeAmbiguous: Boolean(
      input.lane && (input.lane.origin.ambiguous || input.lane.destination.ambiguous),
    ),
    geocodeOldBenchmark: Boolean(
      input.lane &&
        (input.lane.origin.benchmark !== 'Public_AR_Current' ||
          input.lane.destination.benchmark !== 'Public_AR_Current'),
    ),
    totalUsd: deliveredUsd ?? 0,
  });

  const range =
    deliveredUsd === null ? null : confidenceRange(deliveredUsd, confidence.band);

  return {
    asOf,
    lines,
    subtotalSourcedUsd,
    subtotalYourRatesUsd,
    subtotalDerivedUsd,
    deliveredUsd,
    partial,
    partialBecause,
    lowUsd: range?.low ?? null,
    highUsd: range?.high ?? null,
    confidence,
    confidenceLabel: confidence.label,
    mileage: {
      ...distance,
      tierLabel: tierSpec.label,
      tierBasis: tierSpec.basis,
      mayPriceStates: tierSpec.mayPriceStates,
      crossCheck,
    },
    corridor,
    permits,
    escorts,
    fuel: {
      dieselUsdPerGal: input.diesel.usdPerGal,
      asOf: input.diesel.asOf,
      source: input.diesel.source,
      stale: input.diesel.stale,
      perMileUsd: fscPerMile,
      modelNote: fuelModelNote,
    },
    notIncluded: HEAVY_HAUL_NOT_INCLUDED,
    disclaimer: HEAVY_HAUL_DISCLAIMER,
  };
}

/**
 * The priced rows as plain `CalcLine`s — the shared vocabulary, actually used.
 *
 * Unpriceable rows are DROPPED rather than zeroed, because `CalcLine.amount` is
 * a `number` and there is no way to say "applies, cannot price" in that shape.
 * Anything that needs the refusals reads `HeavyHaulLine[]` directly.
 */
export function heavyHaulCalcLines(quote: HeavyHaulQuote): CalcLine[] {
  return quote.lines
    .filter((l): l is HeavyHaulLine & { amountUsd: number } => l.amountUsd !== null)
    .map((l) => ({
      name: l.name,
      amount: l.amountUsd,
      kind: l.kind,
      ...(l.note === undefined ? {} : { note: l.note }),
      ...(l.code === undefined ? {} : { code: l.code }),
    }));
}
