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
  routedLaneDistance,
  CORRIDOR_DISCLAIMER,
  type CorridorState,
  type LaneDistance,
} from './corridor.js';
import type { RoutedMileageResult } from './routedMileage.js';
import {
  scoreHeavyHaulConfidence,
  confidenceRange,
  type HeavyHaulConfidence,
} from './confidence.js';
import {
  assertAccuracyBasisInvariant,
  deriveLoad,
  detentionRiskLine,
  estimateEscortMarketCost,
  excessValueLine,
  layoverRiskLine,
  permitServiceLine,
  priceLoading,
  priceMarketLinehaul,
  routeSurveyLine,
  securementLine,
  tarpingLine,
  mpgForEquipment,
  rate,
  ROUTE_CLASS_UNDERIVABLE,
  type AccessorialLine,
  type AccuracyRating,
  type DerivedLoad,
  type EquipmentClass,
  type MarketRegion,
} from './market/index.js';

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
  | 'derived'
  /**
   * A MARKET BAND — real observed prices from published rate sheets, indexes
   * and filed tariffs, run through a model of ours.
   *
   * THE FOURTH CHANNEL EXISTS SO THE OTHER THREE STAY HONEST. A market band is
   * not 'sourced': it is not a statute and it must never be summed into the
   * cited column. It is not 'derived' either, because 'derived' means one
   * sourced input through a formula — the fuel surcharge is an EIA price
   * through a DOE-index model — and a spread across a dozen vendor rate cards
   * has no single sourced input to derive from. Putting it in the same subtotal
   * as fuel would make that subtotal mean two different things at once.
   *
   * See `market/accuracy.ts`: `BASIS_FOR_TIER` maps the BENCHMARK accuracy tier
   * to this basis and nothing else, and `assertAccuracyBasisInvariant` fails the
   * quote rather than letting a benchmark figure reach a cited subtotal.
   */
  | 'market';

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
  /**
   * WHAT KIND OF EVIDENCE STANDS BEHIND THE NUMBER — cited, indexed, benchmark
   * or refused — with its own measured band, a short hover and a longer detail.
   *
   * Orthogonal to `basis`, which says which subtotal the money lands in. The one
   * relation between them is `BASIS_FOR_TIER`, and it is enforced rather than
   * documented. Absent on lines computed from the CALLER's own rate: that is
   * their number, not our claim about the market.
   */
  accuracy?: AccuracyRating;
}

/** The caller's own rates. Nothing here is ever supplied by us. */
export interface HeavyHaulRates {
  /** Line-haul $/mile. Without it, line haul is excluded and says so. */
  linehaulUsdPerMile?: number;
  /** Optional floor on the line haul, the caller's own minimum. */
  linehaulMinimumUsd?: number;
  /** The caller's pilot-car rate. See `UserPilotCarRate`. */
  pilotCar?: UserPilotCarRate;
  /**
   * The caller's OWN fuel-surcharge model. The diesel PRICE is always sourced
   * from the EIA index; the peg and the fuel economy are the two assumptions in
   * it, and every carrier's FSC table pegs somewhere. Supplying either makes
   * this line theirs rather than ours, and the note says which.
   */
  fuelPegUsdPerGal?: number;
  fuelMpg?: number;
}

/** The diesel reading, passed in so this module stays pure and DB-free. */
export interface DieselReading {
  usdPerGal: number;
  /** ISO date of the EIA weekly reading. Empty when a fallback constant is used. */
  asOf: string;
  source: 'eia' | 'usda' | 'cache' | 'default' | 'none';
  stale: boolean;
}

/**
 * THE MARKET ENGINE'S SWITCHES.
 *
 * DEFAULT-ON FOR THE FALLBACKS, OPT-IN FOR THE CONDITIONALS. The line-haul and
 * escort bands only ever fire when the caller supplied no rate of their own —
 * a dispatcher's negotiated number still beats any band here and the code still
 * says so. The always-applicable accessorials (the permit agent's fee, the
 * securement allowance, a route survey where a state flags a superload) fire on
 * their own. The conditional ones do not fire until asked, because biasing a
 * may-not-apply item into every quote is how a tool gets a reputation for
 * quoting high.
 */
export interface MarketOptions {
  /** Set false to get the old behaviour: refuse rather than estimate. */
  enabled?: boolean;
  /**
   * Regional line-haul adjustment. OFF unless named, and it should stay off:
   * the two free proxies for it contradict each other by 72%.
   */
  region?: MarketRegion;
  /** Overrides the derived class. A carrier who knows the trailer wins. */
  equipmentClass?: EquipmentClass;
  /** The weight of the PIECE, when it is not the permit gross less a tractor. */
  cargoWeightLbs?: number;
  /** True when the SHIPPER is not providing a crane at pickup. */
  loadingAtOrigin?: boolean;
  /** True when the CONSIGNEE is not providing a crane at delivery. */
  loadingAtDestination?: boolean;
  /** Off by default — most oversize machinery ships untarped. */
  tarping?: boolean;
  /** One escort must carry a height pole. A premium on that car, not a car. */
  highPoleEscort?: boolean;
  /** Cargo value. Turns the largest blindside on the invoice into arithmetic. */
  declaredValueUsd?: number;
  /** Suppress the securement allowance when the carrier's rate already covers it. */
  securementAllowance?: boolean;
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
  /**
   * TIER 1 — a routed measurement of this lane, if one was taken.
   *
   * PASSED IN, NOT COMPUTED HERE, and that is deliberate: this module is pure,
   * and `routedStateMileage` reads a 4.5 MB graph and a 10 MB boundary archive
   * off disk. Injecting it keeps the arithmetic testable with a fixture and
   * keeps the I/O in the route handler that already owns the geocoder.
   *
   * IT NEVER OUTRANKS `filedLegs`. When both are present the filed figures win
   * outright, because those are the miles the state bills. A refusal
   * (`ok: false`) is not a failure to handle — it means the lane falls back to
   * the tier-4 behaviour of naming the corridor states and asking.
   */
  routedMileage?: RoutedMileageResult;
  rates?: HeavyHaulRates;
  /** The market engine. Absent means default-on with every conditional off. */
  market?: MarketOptions;
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
   * Money from a MARKET BAND. Structurally incapable of reaching
   * `subtotalSourcedUsd` — see `LineBasis` and `market/accuracy.ts`.
   */
  subtotalMarketUsd: number;
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
  /**
   * The routed corridors, when this lane was measured at tier 1.
   *
   * THE CORRIDOR PICKER IS THE PRODUCT SURFACE FOR THE ONE ERROR THIS METHOD
   * CANNOT SOLVE. Corridor choice is a decision a dispatcher makes and a router
   * guesses: measured over 66 lanes, the routed corridors crossed identical
   * states on 85% of them and the best corridor matched a reference router's on
   * 85%. Presenting the alternates by name turns the remaining 15% from a
   * hidden error into a question the person who knows the answer can settle —
   * and their answer is a tier-0 figure, which is worth more than any of this.
   */
  routedCorridors: {
    /** The corridor the miles came from. */
    best: { label: string; totalMiles: number; stateCodes: string[] };
    /** Other ways to run it, each with the states it would add. */
    alternates: Array<{
      label: string;
      totalMiles: number;
      stateCodes: string[];
      divergentStates: string[];
    }>;
    /** Union across every corridor — the permit list. */
    permitStates: string[];
    /** On the list, not on the priced corridor. Named, never priced. */
    unpricedStates: string[];
    /** True when every routed corridor crossed the same states. */
    corridorsAgree: boolean;
    /** Advisory: a straight-line scan touches these and no corridor does. */
    scanOnlyStates: string[];
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
  /**
   * WHAT THE ENGINE WORKED OUT RATHER THAN ASKED FOR — axle count, trailer
   * class, the piece weight and the route class — each labelled with the fact it
   * was derived from. `null` when the market engine is switched off.
   *
   * These are the questions a shipper cannot answer and a carrier can. Asking a
   * freight forwarder how many axles his carrier will run is asking him to do
   * the carrier's job; the weight implies it, so the engine says so.
   */
  derived: DerivedLoad | null;
  /**
   * REAL COSTS THAT ARE DISCLOSED AND NOT ADDED. Detention and layover are
   * genuine, published and unpredictable — the hours are set by whoever keeps
   * the truck waiting. Adding a guess at them would inflate every quote; hiding
   * them is how a shipper gets a $2,400 surprise from four hours at a receiver.
   */
  riskLines: AccessorialLine[];
  notIncluded: ReadonlyArray<{ item: string; why: string }>;
  disclaimer: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const HEAVY_HAUL_DISCLAIMER =
  'A delivered-cost ESTIMATE, not a contract rate. Every charge says what it rests on. State permit fees are CITED to the statute or fee schedule they came from. Fuel is INDEXED to the EIA weekly diesel price through a surcharge model whose peg and fuel economy are our assumptions. Line haul, pilot cars and accessorials are a BENCHMARK — a band from published market data, shown as a range, never added into a cited subtotal, and replaced outright by any rate you enter yourself. Where the evidence stops we say so and price nothing.';

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
    item: 'A binding rate of any kind',
    why: 'The line haul, pilot cars and accessorials here are a market BAND assembled from published indexes, filed tariffs and operator rate sheets. It is a defensible starting number with a stated basis, not a price anybody has offered you. A rate you enter yourself replaces it, because your negotiated number is real and a band is not.',
  },
  {
    item: 'Superload line haul, cranes over 160,000 lb, and drive-the-route surveys',
    why: 'Each of these is refused rather than estimated, and for the same reason: the published evidence stops there. Superloads are priced job by job after an engineering review, a crane above that weight travels disassembled and needs a lift plan, and no published rate for a physical route survey exists anywhere. A refusal that names the floor and the next step beats a number we cannot defend.',
  },
  {
    item: 'Detention, layover, escort wait time and cancellation',
    why: 'All four are real, all four are published, and none of them is in the total — the HOURS cannot be predicted. They are disclosed as risk lines instead, with the published rate on each, because four hours at a slow receiver on a 13-axle rig is $2,420 and that belongs on the page rather than in a footnote.',
  },
  {
    item: 'Permits from a second issuing authority',
    why: 'A toll road, a bridge authority or a city can require its own permit inside a state we do price. Where we know of one, that state’s notes name it.',
  },
  {
    item: 'A per-state superload trigger table',
    why: 'Two state fee ARCHITECTURES were sourced — Texas charges a flat $500 for its engineering review, Illinois bills $40 an hour — but not the thresholds and fees for the other nineteen states that can impose one. The route-survey line therefore fires only on the states our own permit engine already flags as a superload.',
  },
  {
    item: 'Tolls',
    why: 'Tolls vary by the routing the state assigns, and the routing is not settled until the permit is issued.',
  },
  {
    item: 'Tarping unless you ask for it',
    why: 'Most oversize machinery, structural steel and vessels ship untarped — tarping an oversize load is frequently impossible and aerodynamically dangerous — and the filed tariff we price it from makes it shipper-requested. Ask for it and it is priced by width and height, up to the 14 ft / 12 ft point where that tariff itself stops quoting.',
  },
];

/**
 * Price a heavy-haul lane. PURE — no I/O, no clock beyond `asOf`, no database.
 */
export function priceHeavyHaulLane(input: HeavyHaulRequest): HeavyHaulQuote {
  const asOf = input.asOf ?? todayIso();
  const lines: HeavyHaulLine[] = [];
  const partialBecause: string[] = [];

  // ── 1. Mileage ──────────────────────────────────────────────────────────
  const filedLegs = input.filedLegs ?? [];
  const hasFiled = filedLegs.length > 0;

  /**
   * The routed measurement, but only where it is allowed to speak.
   *
   * TIER 0 WINS OUTRIGHT. Filed miles are what the permit application carries
   * and what the state bills, so a routed measurement alongside them is not a
   * second opinion worth blending — it is a weaker claim about the same thing.
   */
  const routed =
    !hasFiled && input.routedMileage?.ok === true ? input.routedMileage : null;

  const distance: LaneDistance = hasFiled
    ? filedLaneDistance(filedLegs.map((l) => ({ stateCode: l.stateCode, miles: l.miles })))
    : routed
      ? routedLaneDistance(routed.best.totalMiles, {
          corridorLabel: routed.best.label,
          alternateCount: routed.alternates.length,
          unpricedStates: routed.unpricedStates,
        })
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

  // ── 1b. Derivation — stop asking the shipper carrier questions ────────
  //
  // A forwarder knows the cargo and the two addresses. Axle count, trailer
  // class and route class are all IMPLIED by that and all three change the
  // price, so the engine works them out and LABELS each one as derived, with
  // the fact it was derived from. Anything the caller supplied wins outright.
  //
  // The derived AXLE COUNT feeds the permit engine, because that is the whole
  // point of deriving it — the bridge formula is a function of axle count and
  // spacing, and a shipper cannot answer it. The derived ROUTE CLASS feeds it
  // too, but only when the routed corridor's principal road is an Interstate;
  // a US route may be divided or two-lane and the network does not say which,
  // so that case refuses rather than guesses.
  const marketEnabled = input.market?.enabled !== false;
  const derived: DerivedLoad | null = marketEnabled
    ? deriveLoad({
        grossWeightLbs: input.cargo.grossWeightLbs,
        ...(input.market?.cargoWeightLbs === undefined
          ? {}
          : { cargoWeightLbs: input.market.cargoWeightLbs }),
        ...(input.cargo.heightIn === undefined ? {} : { heightIn: input.cargo.heightIn }),
        ...(input.cargo.widthIn === undefined ? {} : { widthIn: input.cargo.widthIn }),
        ...(input.cargo.axleCount === undefined ? {} : { axleCount: input.cargo.axleCount }),
        ...(input.market?.equipmentClass === undefined
          ? {}
          : { equipmentClass: input.market.equipmentClass }),
        ...(input.cargo.routeClass === undefined ? {} : { routeClass: input.cargo.routeClass }),
        corridorLabel: routed?.best.label ?? null,
      })
    : null;

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
    ...(input.cargo.axleCount !== undefined
      ? { axleCount: input.cargo.axleCount }
      : derived
        ? { axleCount: derived.axleCount.value }
        : {}),
    ...(input.cargo.routeClass !== undefined
      ? { routeClass: input.cargo.routeClass }
      : derived?.routeClass
        ? { routeClass: derived.routeClass.value }
        : {}),
  };

  // ── 2. Permits — priced ONLY from filed per-state miles ─────────────────
  //
  // THE REFUSAL IS THE FEATURE. At tier 4 there is no in-state mileage that is
  // not invented, and Tennessee bills 6¢ per ton-mile: at 40 tons over the
  // legal limit ONE wrong mile is $2.40 and fifty is $120 on that state alone.
  // A straight line through Houston→Buffalo also invents Louisiana outright,
  // which is $285 of permit for a state the truck never enters. So no permit is
  // priced without filed figures, and the corridor list below asks for them.
  //
  // TIER 1 CHANGES THE FIRST SENTENCE, NOT THE RULE. A routed split is a real
  // per-state mileage and may price a permit; a straight line still may not,
  // and neither may a lane total. What survives unchanged is that nothing is
  // priced from mileage nobody measured.
  let permits: OsowQuote | null = null;
  let splitRequiresReview = false;
  const split = hasFiled
    ? operatorSuppliedStateMileage(
        filedLegs.map((l) => ({
          stateCode: l.stateCode,
          ...(l.stateName === undefined ? {} : { stateName: l.stateName }),
          miles: l.miles,
        })),
      )
    : (routed?.split ?? null);

  if (split) {
    splitRequiresReview = split.requiresManualReview || (routed?.requiresManualReview ?? false);
    // The ONLY sanctioned entry point for pricing off a split — it carries the
    // "where these miles came from" warnings into the quote. Calling
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

    // THE UNION, made visible as money that is NOT in the total.
    //
    // These states sit on an alternate corridor and not on the one the miles
    // came from. Pricing them at the alternate's mileage would invent a permit
    // for a road we have no reason to think the truck takes; dropping them
    // would be the one error this whole design exists to avoid. So they are
    // named, unpriced, and the corridor picker is how the dispatcher settles it.
    for (const code of routed?.unpricedStates ?? []) {
      const name = input.stateNames?.[code] ?? code;
      lines.push({
        kind: 'permit',
        code: `permit_${code}`,
        name: `${name} single-trip OS/OW permit`,
        amountUsd: null,
        basis: 'sourced',
        note: `${name} is on an alternate corridor for this lane but not on the one these miles were measured from, so there is no in-state mileage to price it from. It is listed rather than dropped: a permit left off a quote is an illegal load, while one you turn out not to need is a phone call. Pick your corridor, or enter the ${name} miles.`,
      });
    }
  } else {
    lines.push({
      kind: 'permit',
      code: 'permit_all',
      name: 'State OS/OW permits',
      amountUsd: null,
      basis: 'sourced',
      note: `Not priced. ${tierSpec.label} produces a lane total and no per-state mileage, and several states price the overweight permit on miles travelled inside that state. Add your filed per-state miles below and every covered state is computed and added.${
        input.routedMileage && input.routedMileage.ok === false
          ? ` This lane was NOT measured on the road network either — ${input.routedMileage.warnings[0] ?? 'the routing guards refused it'}`
          : ''
      }`,
    });
  }

  const permitsPriced =
    permits !== null && permits.jurisdictions.some((j) => j.subtotalUsd !== null);
  if (!permitsPriced) {
    partialBecause.push(
      hasFiled
        ? 'no state on this lane produced a permit figure'
        : routed
          ? 'no state on this lane produced a permit figure from the routed mileage'
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

  // ── 3. Line haul — the caller's rate first, the market band second ─────
  //
  // ORDER OF PRECEDENCE, AND IT DOES NOT CHANGE: a rate the caller supplied is
  // their real price and always wins. The market band below is the fallback for
  // somebody who has none, which is who this tool is for.
  let linehaulUsd: number | null = null;
  let marketLinehaulBelowFloor = false;
  const perMile = input.rates?.linehaulUsdPerMile;
  const linehaulPriced = typeof perMile === 'number' && perMile > 0 && distance.totalMiles > 0;
  if (linehaulPriced) {
    const computed = perMile * distance.totalMiles;
    const minimum = input.rates?.linehaulMinimumUsd ?? 0;
    const floored = minimum > 0 && computed < minimum;
    linehaulUsd = round2(floored ? minimum : computed);
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
  } else if (marketEnabled && derived && distance.totalMiles > 0) {
    // ── THE REVERSAL ───────────────────────────────────────────
    //
    // This branch used to refuse. Refusing was right for a carrier's dispatcher
    // and wrong for the people actually using the tool — a freight forwarder
    // has no rates of his own for any of this, and telling him to supply one is
    // telling him to go and get a quote, which is the thing he came here to
    // avoid. The honest version is not refusing to estimate; it is estimating
    // from real market data and showing exactly what the number rests on.
    const market = priceMarketLinehaul({
      miles: distance.totalMiles,
      equipment: derived.equipmentClass.value,
      ...(input.market?.region === undefined ? {} : { region: input.market.region }),
    });
    if (market.ok) {
      linehaulUsd = market.totalUsd;
      lines.push({
        kind: market.minimumBinds ? 'minimum' : 'linehaul',
        code: 'linehaul',
        name: market.minimumBinds
          ? `Line haul — market minimum charge (${market.equipment === 'flatbed' ? 'flatbed' : market.equipment === 'stepDeck' ? 'step deck' : market.equipment === 'rgn' ? 'RGN' : 'multi-axle'})`
          : `Line haul (${Math.round(distance.totalMiles).toLocaleString()} mi × $${market.realisedUsdPerMile.toFixed(2)}/mi market rate)`,
        amountUsd: market.totalUsd,
        basis: 'market',
        note: [
          market.minimumBinds
            ? `A MARKET BAND, not your rate and not a cited figure. ${market.notes[0] ?? ''}`
            : `A MARKET BAND, not your rate and not a cited figure: $${market.baseUsdPerMile.toFixed(2)}/mi national flatbed line-haul × ${market.distanceMultiplier} (${market.distanceBandLabel}) × ${market.equipmentMultiplier} (${market.equipment}) = $${market.effectiveUsdPerMile.toFixed(2)}/mi. Excludes fuel, which is added separately from the EIA index.`,
          ...market.notes.slice(market.minimumBinds ? 1 : 0),
          'Enter your own $/mile and it replaces this outright — your negotiated rate beats any band we can build.',
        ].join(' '),
        accuracy: market.accuracy,
      });
      marketLinehaulBelowFloor = market.belowCostFloor;
    } else {
      lines.push({
        kind: 'linehaul',
        code: 'linehaul',
        name: 'Line haul — superload',
        amountUsd: null,
        basis: 'market',
        note: market.message,
        accuracy: market.accuracy,
      });
      partialBecause.push(
        'line haul is not included — this is a superload, which every rate source prices individually after a route survey',
      );
    }
  } else {
    lines.push({
      kind: 'linehaul',
      code: 'linehaul',
      name: 'Line haul',
      amountUsd: null,
      basis: 'yours',
      note: 'Not included. Moving the load is normally the largest number on a heavy-haul quote. Enter your own $/mile and it is added, labelled as yours.',
    });
    partialBecause.push('line haul is not included — no $/mile was supplied');
  }

  // ── 4. Fuel — EIA index, our model, and it says which is which ──────────
  const pegUsdPerGal = input.rates?.fuelPegUsdPerGal ?? AUTO_FSC_DEFAULTS.pegUsdPerGal;
  /**
   * FLATBED FUEL ECONOMY IS 5.0 MPG, NOT 6.0 — A CORRECTION, NOT A TWEAK.
   *
   * `AUTO_FSC_DEFAULTS.mpg` is 6.0. That is the classic van figure, it is right
   * for a van, and it is wrong for every single piece of equipment this tool
   * quotes. The evidence is unusually good: DAT publishes an all-in and a
   * line-haul rate weekly and the difference is its fuel surcharge, and the
   * formula (diesel − $1.25) ÷ mpg with 6.0 van / 5.5 reefer / 5.0 FLATBED
   * reproduces DAT's published surcharge nine times out of nine, within a cent,
   * across three independent weeks — one of which states the surcharges outright,
   * so it is a reproduction of a published figure rather than a curve fit.
   *
   * At $5.454/gal that is $0.700/mi on 6.0 against $0.841/mi on 5.0: on a
   * 1,500-mile flatbed lane the old default understated fuel by $210.
   *
   * The heavy-haul extensions — RGN 4.0, multi-axle 3.5 — are OURS and are not
   * validated by anything; they are extrapolations on physical grounds and the
   * note below says so. The caller's own mpg still replaces all of it.
   */
  const derivedMpg =
    marketEnabled && derived ? mpgForEquipment(derived.equipmentClass.value) : null;
  const fuelMpg = input.rates?.fuelMpg ?? derivedMpg ?? AUTO_FSC_DEFAULTS.mpg;
  const fuelModelIsCallers =
    input.rates?.fuelPegUsdPerGal !== undefined || input.rates?.fuelMpg !== undefined;
  const fscPerMile = autoFscPerMile({
    dieselUsdPerGal: input.diesel.usdPerGal,
    pegUsdPerGal,
    mpg: fuelMpg,
  });
  /**
   * HALF SOURCED, HALF OURS, AND IT SAYS SO IN THAT ORDER.
   *
   * The provenance sentence leads because the page clamps a line's note to three
   * lines: whichever sentence gets clipped must not be the one that separates a
   * cited figure from an assumption of ours. The arithmetic closes it, so a
   * reader can check the number against the column beside it.
   */
  const mpgProvenance = fuelModelIsCallers
    ? 'YOURS — you entered them, so this line is your model on our sourced price'
    : derivedMpg !== null
      ? `OURS. The ${fuelMpg} mpg is the figure for ${derived?.equipmentClass.value === 'flatbed' ? 'a flatbed' : derived?.equipmentClass.value === 'stepDeck' ? 'a step deck' : derived?.equipmentClass.value === 'rgn' ? 'an RGN' : 'a multi-axle rig'}, not the 6.0 mpg van default this product used to apply to everything${derivedMpg === 5 ? ' — (diesel − $1.25) ÷ 5.0 reproduces DAT’s published flatbed surcharge to the cent across three weeks' : ' — an extrapolation of ours from the validated flatbed figure, not a validated number'}. Enter your own peg and mpg and this line becomes yours`
      : 'OUR assumptions — the standard OOIDA figures, and your own FSC table may peg elsewhere. Enter your own peg and mpg and this line becomes yours';
  const fuelModelNote = `The DIESEL PRICE is sourced: the EIA weekly national on-highway No. 2 retail price${input.diesel.asOf ? `, week of ${input.diesel.asOf}` : ''} — US Government, public domain. The PEG ($${pegUsdPerGal.toFixed(2)}/gal) and the FUEL ECONOMY (${fuelMpg} mpg) are ${mpgProvenance}. DOE-index model: ($${input.diesel.usdPerGal.toFixed(2)} − $${pegUsdPerGal.toFixed(2)}) ÷ ${fuelMpg} = $${fscPerMile.toFixed(3)}/mi.`;
  const fuelUsd = distance.totalMiles > 0 ? round2(fscPerMile * distance.totalMiles) : 0;
  if (distance.totalMiles > 0) {
    lines.push({
      kind: 'fuel',
      code: 'fuel',
      name: `Fuel surcharge (${Math.round(distance.totalMiles).toLocaleString()} mi × $${fscPerMile.toFixed(3)}/mi)`,
      amountUsd: fuelUsd,
      basis: 'derived',
      note: fuelModelNote,
      accuracy: rate({
        tier: 'indexed',
        bandPct: 5,
        asOf: input.diesel.asOf || null,
        hover: `From the EIA weekly national on-highway diesel price${input.diesel.asOf ? `, week of ${input.diesel.asOf}` : ''}, through the industry-standard (diesel − peg) ÷ mpg surcharge formula.`,
        detail: fuelModelNote,
      }),
    });
  }

  // ── 5. Escorts — two channels that are never added together ─────────────
  let escorts: LaneEscortEstimate | null = null;
  let escortMarket: ReturnType<typeof estimateEscortMarketCost> = null;
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
            ? 'Not priced from YOUR rates — none was supplied. The market band below prices these counts instead.'
            : 'YOUR rate applied to the escort counts each state’s own rules require. Never inside a permit fee.',
      });

      // ── THE CIVILIAN MARKET BAND, BESIDE THE CITED POLICE RATES ────────
      //
      // `escortCost.ts` is untouched by this: it still owns the six states'
      // SOURCED law-enforcement rates and the caller's own rate path, and this
      // consumes only the escort COUNTS the state rules produce. The band is
      // 'market' money and cannot reach the cited column.
      //
      // The structure is the finding, not the level. Below about 250 miles an
      // operator bills a day rate or a minimum rather than the miles, and that
      // floor is published in all five regions of the one dated industry rate
      // card and in three independent vendor sheets. A per-mile-only escort
      // line is simply wrong there.
      if (escorts.pilotCarUsd === null && marketEnabled && distance.totalMiles > 0) {
        const band = estimateEscortMarketCost({
          vehicles: escorts.pilotCarsRequired,
          miles: distance.totalMiles,
          ...(input.market?.highPoleEscort ? { highPole: true } : {}),
        });
        if (band) {
          escortMarket = band;
          lines.push({
            kind: 'escort',
            code: 'pilot_cars_market',
            name: `Pilot cars — market band (${band.vehicles} vehicle${band.vehicles === 1 ? '' : 's'}, ${band.tier === 'mileage' ? 'mileage' : band.tier === 'dayRate' ? 'day rate' : 'minimum charge'})`,
            amountUsd: round2(band.centralUsd),
            basis: 'market',
            note: `${band.components.map((c) => `${c.name}: $${Math.round(c.lowUsd).toLocaleString()}–$${Math.round(c.highUsd).toLocaleString()}`).join(' · ')}. Range $${Math.round(band.lowUsd).toLocaleString()}–$${Math.round(band.highUsd).toLocaleString()}. Your own operator rate replaces this outright.`,
            accuracy: band.accuracy,
          });
        }
      } else if (escorts.pilotCarUsd === null) {
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

  // ── 5b. Accessorials — what turns a line haul into a delivered price ───
  //
  // LOADING IS THE HEADLINE AND IT IS NOT THE CARRIER'S COST. A filed heavy-haul
  // tariff says so outright: cranes, hoists and winches "shall be supplied by
  // the Consignor or Consignee" together with the personnel to operate them. So
  // a shipper who ticks "no loading provided" is buying a machine nobody in his
  // quote chain has priced — on the worked example, 73% of the accessorial
  // stack. It is opt-in because most shippers DO have a forklift or a crane on
  // site, and defaulting it on would inflate every quote on the page.
  const riskLines: AccessorialLine[] = [];
  const accessorials: AccessorialLine[] = [];
  if (marketEnabled && derived) {
    const cargoLbs = derived.cargoWeightLbs.value;
    const cargoDerived = derived.cargoWeightLbs.origin === 'derived';
    if (input.market?.loadingAtOrigin) {
      accessorials.push(
        ...priceLoading({
          cargoWeightLbs: cargoLbs,
          end: 'origin',
          stateCode: input.lane?.origin.state ?? null,
          cargoWeightDerived: cargoDerived,
        }),
      );
    }
    if (input.market?.loadingAtDestination) {
      accessorials.push(
        ...priceLoading({
          cargoWeightLbs: cargoLbs,
          end: 'destination',
          stateCode: input.lane?.destination.state ?? null,
          cargoWeightDerived: cargoDerived,
        }),
      );
    }
    if (input.market?.tarping) {
      accessorials.push(
        tarpingLine(input.cargo.widthIn, input.cargo.heightIn),
      );
    }
    if (input.market?.securementAllowance !== false) accessorials.push(securementLine());

    // The permit AGENT's fee, on top of the state fee already cited above. It is
    // never inside `totalPermitUsd` and never can be — it is 'market' money.
    const pricedPermitCount = (permits?.jurisdictions ?? []).filter(
      (j) => j.subtotalUsd !== null,
    ).length;
    const svc = permitServiceLine(pricedPermitCount);
    if (svc) accessorials.push(svc);

    const survey = routeSurveyLine(
      (permits?.jurisdictions ?? []).filter((j) => j.superload).map((j) => j.jurisdiction),
    );
    if (survey) accessorials.push(survey);

    const cover = excessValueLine(input.market?.declaredValueUsd);
    if (cover) accessorials.push(cover);

    // DISCLOSED, NEVER ADDED. The rates are published and the hours are not
    // predictable, and four hours at a slow receiver on a 13-axle rig is $2,420
    // — more than every other accessorial on a typical quote combined.
    riskLines.push(detentionRiskLine(derived.axleCount.value));
    riskLines.push(layoverRiskLine());
  }

  for (const a of accessorials) {
    lines.push({
      kind: 'accessorial',
      code: a.code,
      name: a.name,
      amountUsd: a.headlineUsd,
      basis: a.accuracy.tier === 'cited' ? 'sourced' : 'market',
      note:
        a.headlineUsd === null
          ? a.accuracy.detail
          : `${a.accuracy.hover} Range $${Math.round(a.lowUsd ?? 0).toLocaleString()}–$${Math.round(a.highUsd ?? 0).toLocaleString()}.`,
      accuracy: a.accuracy,
    });
  }

  // THE INVARIANT, ENFORCED RATHER THAN DOCUMENTED. A BENCHMARK figure that
  // found its way into the cited column fails the quote here, at the seam,
  // rather than showing a shipper a vendor rate card labelled as a statute.
  assertAccuracyBasisInvariant(lines);

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
  const subtotalMarketUsd = sumBy('market');
  const anyPriced = lines.some((l) => l.amountUsd !== null && l.amountUsd > 0);
  const deliveredUsd = anyPriced
    ? round2(
        subtotalSourcedUsd + subtotalYourRatesUsd + subtotalDerivedUsd + subtotalMarketUsd,
      )
    : null;
  /**
   * Endpoint states the filing omits.
   *
   * Only the two ENDPOINTS are checked, never the wider corridor: the corridor
   * scan is deliberately over-inclusive, so a corridor state missing from a
   * filing is a question, whereas an endpoint state missing is evidence — the
   * load starts and ends there and both were geocoded from the addresses the
   * user typed. Checking the corridor here would penalise the correct filing
   * for leaving out a state the truck never enters.
   */
  const filedStateCodes = new Set(filedLegs.map((l) => l.stateCode.toUpperCase()));
  const filedMissingEndpointStates =
    hasFiled && input.lane
      ? [input.lane.origin.state, input.lane.destination.state]
          .filter((c): c is string => typeof c === 'string' && c.length === 2)
          .map((c) => c.toUpperCase())
          .filter((c, i, arr) => arr.indexOf(c) === i)
          .filter((c) => !filedStateCodes.has(c))
      : [];

  if (filedMissingEndpointStates.length > 0) {
    partialBecause.push(
      `${filedMissingEndpointStates.join(' and ')} ${filedMissingEndpointStates.length > 1 ? 'are' : 'is'} on this lane but ${filedMissingEndpointStates.length > 1 ? 'have' : 'has'} no filed mileage, so ${filedMissingEndpointStates.length > 1 ? 'those permits are' : 'that permit is'} not priced`,
    );
  }

  const partial = partialBecause.length > 0;

  // ── 7. The KPI ──────────────────────────────────────────────────────────
  const reviewStates = (permits?.jurisdictions ?? [])
    .filter((j) => j.requiresManualReview && j.subtotalUsd !== null)
    .map((j) => j.jurisdiction);
  const superloadStates = (permits?.jurisdictions ?? [])
    .filter((j) => j.superload)
    .map((j) => j.jurisdiction);

  // The corridor is computed whenever we have a geocoded lane — not only when
  // the tier cannot price states. At tier 0 it is what lets us check the filed
  // rows against the lane the addresses describe; without it a filing naming
  // one state scored a clean 100% on a seven-state move.
  const corridorAll = input.lane
    ? corridorStates(input.lane.origin, input.lane.destination, hasOsowCoverage, {
        originState: input.lane.origin.state,
        destinationState: input.lane.destination.state,
      })
    : null;

  const statesOnLane = hasFiled
    ? filedLegs.length
    : routed
      // The routed union, not the bounding-box scan: the scan is deliberately
      // generous and using it here would dilute every per-state deduction in
      // the confidence score with states no corridor crosses.
      ? Math.max(1, routed.permitStates.length)
      : Math.max(1, corridorAll?.length ?? 1);

  /**
   * The corridor is exposed to the page only when it is genuinely a PROMPT:
   * when the tier cannot price states at all, or when a filing has left out a
   * state the lane provably touches. On a complete tier-0 filing the states are
   * already known and asking for them again would be noise — the data is still
   * computed above, because that is what the endpoint check reads.
   */
  const corridor =
    corridorAll && (!tierSpec.mayPriceStates || filedMissingEndpointStates.length > 0)
      ? { states: corridorAll, disclaimer: CORRIDOR_DISCLAIMER }
      : null;

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
    filedMissingEndpointStates,
    linehaulPriced: linehaulUsd !== null,
    linehaulFromMarketBand:
      linehaulUsd !== null &&
      lines.find((l) => l.code === 'linehaul')?.basis === 'market',
    escortsRequired: escorts?.pilotCarsRequired ?? 0,
    escortsPriced: escorts?.pilotCarUsd !== null && escorts?.pilotCarUsd !== undefined,
    escortsFromMarketBand: escortMarket !== null,
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
    subtotalMarketUsd,
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
    routedCorridors: routed
      ? {
          best: {
            label: routed.best.label,
            totalMiles: routed.best.totalMiles,
            stateCodes: routed.best.stateCodes,
          },
          alternates: routed.alternates.map((c) => ({
            label: c.label,
            totalMiles: c.totalMiles,
            stateCodes: c.stateCodes,
            divergentStates: c.divergentStates,
          })),
          permitStates: routed.permitStates,
          unpricedStates: routed.unpricedStates,
          corridorsAgree: routed.corridorsAgree,
          scanOnlyStates: routed.scanOnlyStates,
        }
      : null,
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
    derived,
    riskLines,
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
