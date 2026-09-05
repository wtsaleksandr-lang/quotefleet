/**
 * THE MARKET LINE-HAUL MODEL.
 *
 *   line_haul = max( minimum[equipment] × region,
 *                    base × distanceMult × equipmentMult × region × miles )
 *
 * Fuel is NEVER inside it. The anchor is DAT's LINE-HAUL figure, not its all-in
 * figure, precisely so the surcharge can be added separately from the EIA index
 * this product already sources.
 *
 * ── WHAT IS STRONG HERE AND WHAT IS NOT ───────────────────────────────────
 *
 * Five components are published, dated and refetchable: the base rate, the
 * distance curve, the minimum, the fuel divisor and the cost floor. The
 * EQUIPMENT MULTIPLIER is still the weak joint and it is load-bearing — it is
 * what turns a flatbed rate into a heavy-haul rate. What changed is how much of
 * it is now measured rather than inferred: STEP DECK is measured, on 10,245
 * postings across 162 matched lanes; RGN is BRACKETED by two methods that
 * disagree; MULTI-AXLE is still unobserved and now rests on two agreeing
 * inferences instead of one. The accuracy rating carries that difference rather
 * than the prose hiding it.
 *
 * ── THE ONE THING NO ANGLE COULD MEASURE ──────────────────────────────────
 *
 * THE HEAVY END HAS ALMOST NO PUBLIC TRANSACTION RECORD. A sweep of every open
 * marketplace and load board reachable without an account found two lowboy
 * postings in a 4,087-load board and nothing at all above 47,000 lb. So the
 * multi-axle multiplier is CORROBORATED, NOT MEASURED, and a recalibration must
 * not read as a promotion in confidence it has not earned: its band stays at
 * ±40% and its hover says corroborated in as many words.
 *
 * ── THE MINIMUM, AND THE CROSSOVER THAT PINS IT ───────────────────────────
 *
 * A hard minimum charge is the best-evidenced STRUCTURE in the model — two
 * unrelated methods find it, and both put the crossover at about 250 miles.
 * USDA's published 0–100 mile lanes are flat in TOTAL dollars regardless of
 * distance; an interagency lowboy schedule pays "the daily guarantee OR mileage,
 * whichever is greater" and its own guarantees cross its own per-mile rates at
 * 244–261 miles. The LEVELS those two give differ, because they price different
 * products, so the ladder is pinned to the crossover rather than to either
 * level — see `EQUIPMENT` and `notionalCrossoverMiles`.
 *
 * ── TWO THINGS DELIBERATELY NOT DONE ──────────────────────────────────────
 *
 * 1. NO SEASONAL CURVE. DAT's own flatbed line-haul moved $2.26 (Feb) → $2.95
 *    (Jul) = 1.31× this year. Seasonality is already inside the anchor, and
 *    multiplying by a seasonal index on top would double-count it. A seasonal
 *    curve only becomes correct if the anchor is ever frozen.
 * 2. REGIONAL MULTIPLIERS SHIP OFF — but their SIGN IS NOW CORRECT. They used
 *    to be reversed against the only flatbed-specific regional figures anyone
 *    publishes, and a reversed constant waiting to be switched on is a trap
 *    rather than a dormant feature. Fixed and still off; see
 *    `REGION_MULTIPLIERS`.
 */
import {
  SRC_ATRI_COSTS,
  SRC_ATS_AXLE_FORMULA,
  SRC_DAT_FLATBED,
  SRC_EQUIPMENT_GUIDES,
  SRC_NRCG_TRANSPORT_RATES,
  SRC_OBSERVED_POSTINGS,
  SRC_USDA_GRAIN_TRUCK,
  SRC_USDA_REEFER_LANES,
  type MarketSource,
} from './sources.js';
import { rate, type AccuracyRating } from './accuracy.js';
import type { EquipmentClass } from './derive.js';

// ── The anchor ────────────────────────────────────────────────────────────

/**
 * National flatbed LINE-HAUL spot rate, $/mile. Excludes fuel.
 *
 * DAT spot index, week of 23–29 Aug 2026, republished in full by AJOT. The
 * all-in figure that week was $3.51; the difference is the fuel surcharge,
 * which this product computes itself from EIA.
 *
 * REFETCHABLE WEEKLY, and it should be: this figure ran seventeen consecutive
 * weekly increases from early March 2026, +$0.69/mi, peaking near $2.95 in July.
 * Frozen, it goes stale fast.
 *
 * CHECKED AGAINST OBSERVED TRANSACTIONS AND HELD. 2,636 real flatbed postings
 * put the observed line-haul median at $2.84/mi (p25 $2.16 · p75 $3.49), and
 * DAT's own June 2026 flatbed line-haul was $2.94. $2.67 therefore sits near the
 * 40th percentile of what open-deck freight actually posts at — conservative
 * rather than wrong, which is the right side to err on for a shipper who has no
 * rate of his own. It was not raised: the anchor's whole value is that it is a
 * dated, refetchable published figure, and moving it toward an observed median
 * would trade that for a number nobody publishes.
 */
export const BASE_FLATBED_LINEHAUL_USD_PER_MILE = 2.67;

/** The observed flatbed line-haul median the anchor was checked against. */
export const OBSERVED_FLATBED_MEDIAN_USD_PER_MILE = 2.84;
export const BASE_ANCHOR_WEEK = '2026-08-29';

/** The band the anchor is normalised to. Every distance multiplier is 1.00 here. */
export const ANCHOR_DISTANCE_BAND = '500–1,000 mi';

// ── Distance decay ────────────────────────────────────────────────────────

export interface DistanceBand {
  /** Inclusive lower bound in miles. */
  fromMiles: number;
  /** Exclusive upper bound; `null` is open-ended. */
  toMiles: number | null;
  multiplier: number;
  label: string;
}

/**
 * Renormalised to the 500–1,000 mile band = 1.00.
 *
 * ── THE <250 RUNG WAS 1.90 AND IT WAS WRONG ───────────────────────────────
 *
 * 1.90 came from USDA REEFER PRODUCE lanes: real data, from the wrong market. A
 * refrigerated unit and produce urgency support a short-haul premium that
 * open-deck local work does not. Two later angles agree on the correct figure
 * and, between them, on the mechanism:
 *
 *   · Published rate structures put the sub-200-mile premium at 1.22–1.30×
 *     (median 1.25) across three publishers.
 *   · Observed postings put 150–300 mi at $3.73/mi against 800–1,200 mi at
 *     $2.87/mi — a ratio of 1.30 on 735 and 1,621 real loads.
 *
 * 1.28 is the midpoint of those two independent central estimates. The
 * MECHANISM is why the old figure was so far out: a short haul is not priced
 * with a per-mile premium at all, it is priced on a DAY RATE. Two carriers say
 * so outright — per-mile pricing takes over above roughly 350 miles, and "a day
 * in which you turn 250 miles has to pay $4.00 per mile … a day in which you
 * turn 500 miles only needs $2.00". A day rate is a minimum charge, and this
 * model already has one, so the premium and the floor were double-counting.
 *
 * WHAT THAT DOES TO THE SHAPE, AND WHY IT IS AN IMPROVEMENT. 1.90 → 1.25 was a
 * 34% cliff at 250 miles. 1.28 → 1.25 is a 2.4% step, so the curve now degrades
 * smoothly into the 250–500 band instead of falling off it — and the <250 rung
 * never prices a lane anyway, because the minimum governs everything below the
 * crossover. Its only job is to place that crossover, and it places it at 250.
 *
 * ── THE ONE RUNG STILL DERIVED FROM REEFER PRODUCE ────────────────────────
 *
 * 250–500 = 1.25 is the last USDA-reefer-derived multiplier in the table. Both
 * new angles put it lower — published structures give 1.12–1.18 for 200–500 mi,
 * and the observed fitted curve gives 1.11 at that band's midpoint. It is NOT
 * changed here because no angle was asked to re-derive it and because it is
 * conservative in the direction that never understates, but it is the next
 * number to look at and it is recorded as such rather than left to be
 * rediscovered.
 */
export const DISTANCE_BANDS: ReadonlyArray<DistanceBand> = [
  { fromMiles: 0, toMiles: 250, multiplier: 1.28, label: 'under 250 mi' },
  { fromMiles: 250, toMiles: 500, multiplier: 1.25, label: '250–500 mi' },
  { fromMiles: 500, toMiles: 1000, multiplier: 1.0, label: '500–1,000 mi' },
  { fromMiles: 1000, toMiles: 1500, multiplier: 0.87, label: '1,000–1,500 mi' },
  { fromMiles: 1500, toMiles: null, multiplier: 0.85, label: 'over 1,500 mi' },
];

/** The published multiplier for a distance. A step function, exactly as observed. */
export function distanceMultiplier(miles: number): number {
  for (const band of DISTANCE_BANDS) {
    if (miles >= band.fromMiles && (band.toMiles === null || miles < band.toMiles)) {
      return band.multiplier;
    }
  }
  return DISTANCE_BANDS[DISTANCE_BANDS.length - 1].multiplier;
}

export function distanceBandLabel(miles: number): string {
  for (const band of DISTANCE_BANDS) {
    if (miles >= band.fromMiles && (band.toMiles === null || miles < band.toMiles)) {
      return band.label;
    }
  }
  return DISTANCE_BANDS[DISTANCE_BANDS.length - 1].label;
}

// ── Equipment ─────────────────────────────────────────────────────────────

export interface EquipmentSpec {
  multiplier: number;
  /** Fuel economy for the surcharge divisor. */
  mpg: number;
  /** Line-haul minimum charge, $. */
  minimumUsd: number;
  label: string;
  /** What the MULTIPLIER rests on. */
  basis: string;
  /** What the MINIMUM rests on — a different question with a different answer. */
  minimumBasis: string;
}

/**
 * THE MINIMUM LADDER IS PINNED TO THE CROSSOVER, NOT TO A PUBLISHED LEVEL.
 *
 * Every rung is the price of a 250-MILE LANE for that class at the shipping
 * anchor: `base × 1.28 × equipmentMultiplier × 250`. That is a deliberate
 * structural choice and it is worth the paragraph.
 *
 * The published minimums and the procurement minimums look contradictory and
 * are not. Open-deck guides publish $300–$800 for a local legal move and a
 * $600–$1,400 day rate; an interagency schedule publishes $1,100–$1,500 daily
 * guarantees. Those are DIFFERENT PRODUCTS — legal flatbed local work against
 * fully-operated heavy haul — so neither level transfers to the other's class,
 * and picking one would import the wrong product's floor into three of the four
 * rungs.
 *
 * What the two DO agree on is the crossover. USDA's sub-100-mile lanes are flat
 * in total dollars whatever the distance, which put it at 256 miles; the
 * interagency schedule pays the guarantee or the mileage, whichever is greater,
 * and its own guarantees cross its own per-mile rates at 244–261 miles. Two
 * unrelated methods, one answer: about 250 miles. So the ladder is derived from
 * the number both methods measured rather than from either level, and the
 * result lands every rung inside its own class's published evidence:
 *
 *   flatbed   $850   inside the $600–$1,400 published open-deck day rate
 *   step deck $870   same basis, one deck up
 *   RGN     $1,370   above the published $1,000 RGN minimum, inside $1,100–$1,500
 *   multi-axle $1,750 inside the published $800–$2,500 local-oversize band
 *
 * THE FLATBED RUNG WAS $1,300 AND CAME FROM REEFER PRODUCE. Every published
 * open-deck minimum is below it, most by two to four times, for the same reason
 * the old <250 multiplier was too high: a reefer unit and produce urgency
 * support a floor that open-deck local work does not. $850 is the price of the
 * lane at which the market stops charging a day rate and starts charging by the
 * mile, and it is the only figure that keeps the crossover where both methods
 * measured it.
 */
export const MINIMUM_CROSSOVER_MILES = 250;

/**
 * The crossover an interagency lowboy schedule pays at, measured from its own
 * numbers: guarantees of $1,100/$1,400/$1,500 against per-mile rates of
 * $4.50/$5.50/$5.75 cross at 244.4, 254.5 and 260.9 miles. Every rung of our own
 * ladder has to land inside this, and a test says so.
 */
export const PROCUREMENT_CROSSOVER_MILES: Readonly<{ low: number; high: number }> = {
  low: 244,
  high: 261,
};

/**
 * Equipment multipliers, fuel economy and minimums.
 *
 * ── WHAT EACH MULTIPLIER NOW RESTS ON ─────────────────────────────────────
 *
 * STEP DECK 1.08 → 1.02. This is the only one that is genuinely MEASURED. A
 * matched-lane test — every state pair carrying both a flatbed row and a
 * step-deck row with at least five observed loads each — gives a median ratio of
 * 0.970 across 162 lanes on 10,245 step-deck postings, with a load-weighted mean
 * of 0.985. Five publishers say 1.10 (range 1.083–1.182). Both figures are kept
 * here because the disagreement is the useful part: on a LEGAL-WEIGHT equipment
 * class, transaction volume beats a guide, so 1.02 sits just above parity rather
 * than at the guides' 1.10.
 *
 * RGN 1.60 → 1.60, HELD. Ten publishers give a median of 1.523 and a mean of
 * 1.613; three marketplace rate sets give 1.75, every one of them ≥1.71. The two
 * methods STRADDLE the shipping value. When two independent methods bracket a
 * number, the number is not the thing to change — moving to either would be
 * picking a side that the evidence does not pick. 1.60 is BRACKETED, which is a
 * stronger statement than either angle alone, and it is not CONFIRMED, which is
 * why the band does not narrow.
 *
 * MULTI-AXLE 2.40 → 2.05, AND THIS IS THE CORRECTION THAT MATTERS. 2.40 was
 * derived from PERMITTED-BAND rates, and three publishers state outright that
 * those bands are all-in: "linehaul plus permits, escorts, and fuel", "these
 * rates represent the total cost to the shipper". THIS ENGINE PRICES PERMITS AND
 * ESCORTS AS SEPARATE LINES, so 2.40 double-counted them — a category error, not
 * a calibration error. Two independent angles converge once the accessorials are
 * taken back out: three published worked examples that itemise base hauling
 * separately give 1.79–2.12 with a median of 2.07, and a government lowboy
 * schedule whose rate is explicitly ex-escort implies 1.85–2.00. 2.05 sits in
 * both. It remains an INFERENCE — two agreeing inferences rather than one, which
 * is better, but not an observation. See the module header.
 *
 * The MPG figures are a different quality of evidence and are described in
 * `FLATBED_MPG` below. The MINIMUMS are described in `MINIMUM_CROSSOVER_MILES`.
 */
export const EQUIPMENT: Readonly<Record<Exclude<EquipmentClass, 'superload'>, EquipmentSpec>> = {
  flatbed: {
    multiplier: 1.0,
    mpg: 5.0,
    minimumUsd: 850,
    label: 'Flatbed',
    basis: 'The anchor itself — DAT publishes a national flatbed rate, so this multiplier is 1.00 by construction. Checked against 2,636 observed flatbed postings whose median is $2.84/mi, which puts the anchor near their 40th percentile.',
    minimumBasis:
      'The price of a 250-mile lane, which is where two unrelated methods put the day-rate-to-per-mile crossover. $850 sits inside the published $600–$1,400 open-deck day rate and above the $300–$800 published for a local legal move.',
  },
  stepDeck: {
    multiplier: 1.02,
    mpg: 5.0,
    minimumUsd: 870,
    label: 'Step deck',
    basis: 'MEASURED, not inferred: a matched-lane test across 162 state pairs carrying both decks with ≥5 loads each gives a median step-deck-to-flatbed ratio of 0.970 on 10,245 postings, load-weighted mean 0.985. Five publishers say 1.10. Volume wins on a legal-weight class, so 1.02 sits just above parity rather than at the guides’ figure.',
    minimumBasis:
      'The price of a 250-mile lane on the same crossover the flatbed rung uses, one deck up. Published open-deck minimums do not separate the two decks, and neither does this.',
  },
  rgn: {
    multiplier: 1.6,
    mpg: 4.0,
    minimumUsd: 1370,
    label: 'RGN / lowboy',
    basis: 'BRACKETED, not confirmed: ten independent publishers give a median RGN-to-flatbed ratio of 1.523 and a mean of 1.613, while three heavy-haul marketplace rate sets give 1.75 with none below 1.71. The two methods straddle 1.60, so 1.60 is what stands.',
    minimumBasis:
      'The price of a 250-mile lane. $1,370 sits above the $1,000 RGN minimum one publisher states twice, and inside the $1,100–$1,500 daily guarantees an interagency lowboy schedule pays whenever they beat its mileage.',
  },
  multiAxle: {
    multiplier: 2.05,
    mpg: 3.5,
    minimumUsd: 1750,
    label: 'Multi-axle permitted',
    basis: 'CORROBORATED, NOT MEASURED. Three published worked examples that itemise base hauling separately from permits, escorts and fuel give 1.79–2.12 (median 2.07); a government lowboy schedule whose per-mile rate is explicitly ex-escort implies 1.85–2.00. The older 2.40 was rejected because it came from permitted-band rates that three publishers state are all-in, and this engine already prices permits and escorts as separate lines.',
    minimumBasis:
      'The price of a 250-mile lane. $1,750 sits inside the $800–$2,500 published for a local oversize move and above the $1,500 daily guarantee the heaviest interagency load-rating band carries.',
  },
};

/**
 * FLATBED FUEL ECONOMY IS 5.0 MPG, NOT 6.0 — AND THIS IS A CORRECTION.
 *
 * The product's `AUTO_FSC_DEFAULTS.mpg` is 6.0 for everything. That is the
 * classic van figure and it is right for a van. It is wrong for the equipment
 * this tool quotes, and it understates fuel on every single quote.
 *
 * The evidence is unusually good for a fuel figure. DAT publishes both an
 * all-in and a line-haul rate weekly; the difference is its fuel surcharge. The
 * formula `(EIA diesel − $1.25) ÷ mpg` with mpg 6.0 van / 5.5 reefer / 5.0
 * flatbed reproduces DAT's published surcharge NINE TIMES OUT OF NINE, within a
 * cent, across three independent weeks — and one of those weeks states the
 * surcharges outright (56¢ / 61¢ / 67¢), so it is a reproduction of a published
 * figure rather than a curve fit.
 *
 * What that buys, in money: at $5.454/gal diesel, 6.0 mpg gives $0.700/mi and
 * 5.0 gives $0.841/mi. On a 1,500-mile flatbed lane that is $210 of fuel the old
 * default left on the table.
 *
 * The heavy-haul extensions — RGN 4.0, multi-axle 3.5 — are OURS and are not
 * validated by anything. They are extrapolations on physical grounds and the
 * accuracy rating says so.
 *
 * THE CALLER'S OVERRIDE STILL WINS. A carrier with its own FSC table pegs
 * wherever its table pegs, and `HeavyHaulRates.fuelMpg` continues to replace
 * this outright.
 */
export const FLATBED_MPG = 5.0;
export const VAN_MPG = 6.0;
export const REEFER_MPG = 5.5;
export const FSC_PEG_USD_PER_GAL = 1.25;

/** The mpg for a class, for the fuel surcharge divisor. */
export function mpgForEquipment(equipment: EquipmentClass): number {
  if (equipment === 'superload') return EQUIPMENT.multiAxle.mpg;
  return EQUIPMENT[equipment].mpg;
}

// ── Region — OFF by default ───────────────────────────────────────────────

export type MarketRegion =
  | 'midwest'
  | 'mountainPlains'
  | 'west'
  | 'southCentral'
  | 'southeast'
  | 'northeast';

/**
 * Regional multipliers. STILL SHIPPED OFF — AND THE SIGN IS NOW CORRECT.
 *
 * ── WHAT WAS WRONG ────────────────────────────────────────────────────────
 *
 * The old table read Midwest 0.90 and West 1.00. DAT's March 2026 regional
 * FLATBED spot rates — the flatbed-specific regional data an earlier pass
 * concluded did not exist outside Texas — put the national average at $2.95,
 * the MIDWEST HIGHEST at $3.14 (1.064×) and the WEST LOWEST at $2.39 (0.810×).
 * The old table had both of them backwards, and it also put the Northeast at
 * 1.15 and the Southeast at 1.08, above a published maximum of 1.064.
 *
 * A REVERSED CONSTANT WAITING BEHIND A FLAG IS A TRAP, NOT A DORMANT FEATURE.
 * It ships off, so nothing was ever mispriced by it — but the first person to
 * turn it on would have been handed the exact opposite of the market. That is
 * worth fixing even though it changes no number today.
 *
 * ── WHY FOUR OF THE SIX ARE 1.00 ──────────────────────────────────────────
 *
 * The published source names only its extremes. Midwest and West are what DAT
 * measured; the other four have NO flatbed-specific published figure at all.
 * The old values for them were reefer-produce and heavy-equipment-guide proxies
 * that contradicted each other by 72% on overlapping geography, and two of them
 * sat outside the published range entirely. Setting them to 1.00 says what is
 * true — we have a figure for two regions and none for the other four — instead
 * of dressing a proxy up as a regional rate.
 *
 * The table stays OFF regardless: two published points do not make a national
 * regional model, and `LinehaulInput.region` remains opt-in.
 */
export const REGION_MULTIPLIERS: Readonly<Record<MarketRegion, number>> = {
  midwest: 1.06,
  mountainPlains: 1.0,
  west: 0.81,
  southCentral: 1.0,
  southeast: 1.0,
  northeast: 1.0,
};

/** Regional adjustment is opt-in and defaults to 1.00 (no adjustment). */
export const REGION_DEFAULT_MULTIPLIER = 1.0;

/** The two regions DAT actually publishes a flatbed spot rate for. */
export const REGIONS_WITH_PUBLISHED_FLATBED_RATE: ReadonlyArray<MarketRegion> = [
  'midwest',
  'west',
];

export const REGION_OFF_NOTE =
  'Regional adjustment is OFF. Exactly two regions have a published flatbed figure behind them — DAT’s March 2026 regional spot rates put the Midwest highest at $3.14/mi and the West lowest at $2.39/mi against a $2.95 national average — and the other four have none, so they sit at 1.00 rather than carrying a produce or heavy-equipment proxy dressed up as a flatbed rate. Two points are not a national regional model, so nothing regional is applied.';

// ── The cost floor ────────────────────────────────────────────────────────

/** ATRI 2026: average marginal operating cost, all-in and excluding fuel. */
export const ATRI_ALL_IN_USD_PER_MILE = 2.336;
export const ATRI_EX_FUEL_USD_PER_MILE = 1.854;

/**
 * The floor flags, it does not price.
 *
 * A line haul below a typical carrier's cash cost is not a cheap quote, it is an
 * impossible one, and the honest response is to say so rather than to raise the
 * number to the floor. Raising it would make the model claim the market pays
 * ATRI's cost, which is not what ATRI measured.
 */
export function belowCarrierCostFloor(usdPerMile: number): boolean {
  return usdPerMile < ATRI_EX_FUEL_USD_PER_MILE;
}

// ── The model ─────────────────────────────────────────────────────────────

export interface LinehaulInput {
  miles: number;
  equipment: EquipmentClass;
  /** Opt-in. Defaults to no adjustment. */
  region?: MarketRegion;
}

export interface LinehaulRefusal {
  ok: false;
  reason: 'superload';
  message: string;
  accuracy: AccuracyRating;
}

export interface LinehaulResult {
  ok: true;
  equipment: Exclude<EquipmentClass, 'superload'>;
  miles: number;
  /** The anchor before any multiplier. */
  baseUsdPerMile: number;
  distanceMultiplier: number;
  distanceBandLabel: string;
  equipmentMultiplier: number;
  regionMultiplier: number;
  /** The all-multipliers-applied rate for THIS distance band. */
  effectiveUsdPerMile: number;
  /**
   * `totalUsd / miles` — what the lane actually works out at. Differs from
   * `effectiveUsdPerMile` whenever the minimum or a shorter band's ceiling
   * governs, and it is the figure a line row must quote.
   */
  realisedUsdPerMile: number;
  /** True when a shorter band's ceiling price is acting as this lane's floor. */
  bandCeilingGoverns: boolean;
  /** `base × dist × equip × region × miles`, before the minimum. */
  ratePathUsd: number;
  /** The equipment minimum, region-adjusted. */
  minimumUsd: number;
  /** True when the minimum is what the caller is actually paying. */
  minimumBinds: boolean;
  /** The answer: `max(minimum, ratePath)`. */
  totalUsd: number;
  lowUsd: number;
  highUsd: number;
  /** True when the effective rate sits under ATRI's ex-fuel cost floor. */
  belowCostFloor: boolean;
  accuracy: AccuracyRating;
  notes: string[];
}

export type LinehaulOutcome = LinehaulResult | LinehaulRefusal;

/**
 * ± band on the line haul. NOTHING HERE MOVED, AND THAT IS THE POINT.
 *
 * 25% for flatbed and step deck. This used to be an argument and is now a
 * measurement: 2,636 observed flatbed postings run p25 $2.16 / median $2.84 /
 * p75 $3.49, which is −24% / +23% — ±25% almost exactly. The band was right for
 * a reason nobody could check before, and it is kept unchanged.
 *
 * 40% for RGN and multi-axle, AND IT IS NOT NARROWED, for two different reasons
 * that both come out the same way:
 *
 *   RGN — the multiplier's own evidence improved a great deal (five broker
 *   guides became ten publishers plus three marketplace rate sets), but the two
 *   methods disagree with each other by 13% and neither of them is a heavy-haul
 *   transaction record. A number that is bracketed rather than confirmed does
 *   not earn a tighter band.
 *
 *   MULTI-AXLE — the multiplier moved from one inference to two agreeing
 *   inferences. That is better evidence and it is still not an observation:
 *   the entire public transaction record above 47,000 lb is two lowboy postings.
 *   NARROWING THIS BAND WOULD BE THE ONE DISHONEST MOVE AVAILABLE IN THIS
 *   RECALIBRATION — it would read as a promotion in confidence that the evidence
 *   did not buy. It stays at 40% and the hover says corroborated, not measured.
 */
export const LINEHAUL_BAND_PCT: Readonly<Record<Exclude<EquipmentClass, 'superload'>, number>> = {
  flatbed: 25,
  stepDeck: 25,
  rgn: 40,
  multiAxle: 40,
};

export const SUPERLOAD_REFUSAL_MESSAGE =
  'Not priced. A superload is routed and priced individually after an engineering review and, in several states, a physical route survey — every rate source found agrees these are quoted job by job, and none publishes a number. Ask a heavy-haul carrier for a lane quote; they will want the drawing, the pick points and your dates.';

/**
 * THE MONOTONICITY RULE, AND WHY THE FORMULA IS A MAX ACROSS BANDS.
 *
 * The published multipliers are band MEDIANS. Applied as a raw step function
 * they are not monotone in distance: `2.67 × 1.25 × 500 = $1,668.75` but
 * `2.67 × 1.00 × 501 = $1,337.67`, so a 501-mile lane would price 20% below a
 * 500-mile one. No carrier does that, and a quote that falls as the lane gets
 * longer is a bug a shipper will find in the first hour.
 *
 * So the rate path is the maximum of each band's own linear price evaluated at
 * the lesser of the lane distance and that band's ceiling. Inside a band where
 * the published multiplier dominates — which is most distances — the result is
 * exactly `base × distanceMultiplier(miles) × equip × region × miles`, the
 * stated formula. Where it does not dominate, the shorter band's ceiling price
 * becomes a floor, which is conservative and never understates.
 */
function ratePathUsd(
  base: number,
  equipMult: number,
  regionMult: number,
  miles: number,
): { usd: number; governingBand: DistanceBand } {
  let best = 0;
  let governing = DISTANCE_BANDS[0];
  for (const band of DISTANCE_BANDS) {
    if (miles < band.fromMiles) continue;
    const billable = band.toMiles === null ? miles : Math.min(miles, band.toMiles);
    const usd = base * band.multiplier * equipMult * regionMult * billable;
    if (usd > best) {
      best = usd;
      governing = band;
    }
  }
  return { usd: best, governingBand: governing };
}

/**
 * The distance below which the minimum charge always wins, for a class.
 *
 * COMPUTED RATHER THAN ASSERTED, and it is now the model's load-bearing claim
 * about short hauls. Each rung of the minimum ladder is the price of a 250-mile
 * lane for its class, so each class crosses within a mile or two of 250 —
 * flatbed's rate path reaches $854 at 250 miles against an $850 minimum, giving
 * 248.7. Rounding the rungs to the nearest $10 is what stops them being exactly
 * equal, and the spread that leaves is under two miles.
 *
 * 250 is not our number. USDA's flat sub-100-mile totals put it at 256; an
 * interagency lowboy schedule that pays the guarantee or the mileage, whichever
 * is greater, puts it at 244–261 from figures it publishes for a completely
 * different purpose. `PROCUREMENT_CROSSOVER_MILES` holds the second one and a
 * test asserts every class lands inside it.
 */
export function notionalCrossoverMiles(
  equipment: Exclude<EquipmentClass, 'superload'>,
  base = BASE_FLATBED_LINEHAUL_USD_PER_MILE,
): number {
  const spec = EQUIPMENT[equipment];
  const shortBand = DISTANCE_BANDS[0].multiplier;
  return spec.minimumUsd / (base * shortBand * spec.multiplier);
}

// ── Two cross-checks that are NOT the pricing path ────────────────────────

/**
 * A REAL CARRIER'S PUBLISHED HEAVY-HAUL FORMULA, HELD AS A SANITY RAIL.
 *
 * Anderson Trucking Service — an asset-based specialized carrier with its own
 * fleet and its own pricing analysts, not a broker guide — publishes
 * `$1.00 × axles × miles` for heavy haul up to 100,000 lb, with a worked
 * example: a 70,000 lb boiler, New Orleans→Indianapolis, 819 miles on 7 axles,
 * $5,733. Above 100,000 lb, 13'6", 50 ft or 16 ft the carrier declares its own
 * formula invalid.
 *
 * THIS IS NEVER CALLED BY `priceMarketLinehaul` AND MUST NOT BE. It is all-in by
 * the carrier's stated policy — at ≤100,000 lb it bundles light permits and
 * fuel — so it cannot be a line-haul figure. What it CAN do is bound ours from
 * above: strip fuel at our own multi-axle divisor and the 7-axle case is about
 * $5.80/mi, which still contains permits, so our permits-excluded line-haul rate
 * has to sit at or below it. A test does exactly that, and it is a real test
 * rather than a decorative one — the old 2.40 multiplier fails it.
 */
export const ATS_AXLE_FORMULA_USD_PER_AXLE_MILE = 1.0;
export const ATS_FORMULA_MAX_GROSS_LBS = 100_000;

export function atsAxleFormulaUsd(axles: number, miles: number): number {
  return ATS_AXLE_FORMULA_USD_PER_AXLE_MILE * axles * miles;
}

/**
 * THE FITTED DISTANCE CURVE — TESTED AS A REPLACEMENT FOR THE BANDS, REJECTED.
 *
 * 626 lanes and 12,881 observed open-deck loads fit `$/mi = 8.34 × miles^−0.168`
 * — about 11% decay per doubling of distance. It is a genuinely attractive
 * alternative to a step function that a previous fix already had to make
 * monotone by taking a max across bands, so it was tested properly against three
 * conditions rather than waved at. IT PASSES ALL THREE:
 *
 *   1. Monotone-decreasing in $/mi — trivially, the exponent is negative.
 *   2. Total dollars never fall as miles rise — total is `8.34 × miles^0.832`,
 *      strictly increasing.
 *   3. It reproduces every observed band median inside that band's own p25–p75.
 *
 * AND IT IS STILL NOT ADOPTED, for one reason that the three conditions do not
 * test: THE NORMALISATION POINT IS UNPUBLISHED. The curve is an ABSOLUTE $/mi
 * for open-deck freight. This model needs a RELATIVE multiplier on DAT's
 * national flatbed line-haul, so using the curve means choosing the lane length
 * at which DAT's figure applies — and DAT publishes no such figure. The bands do
 * not need one: USDA's observation is already relative, band against band, which
 * is the exact form the model consumes. Switching would replace a published
 * relative structure with an unpublished absolute-to-relative conversion, and
 * the invented constant would then be load-bearing on every quote.
 *
 * Two smaller reasons, recorded so the question is not reopened from scratch:
 * the curve cannot reproduce a non-monotonicity in its own source data (the
 * observed 300–500 mi median is $2.83 against $3.04 for 500–800), so a smooth
 * decay asserts an ordering the data does not show; and the two agree within
 * about 6% from 600 miles outward, well inside the ±25–40% this model already
 * declares, so the gain is small where the model actually operates. They diverge
 * more — up to 18% — between 250 and 625 miles, and that divergence is about the
 * 250–500 rung's level rather than about step-versus-curve; see `DISTANCE_BANDS`.
 *
 * KEPT AS A CROSS-CHECK. `NOT` a pricing path, same as the ATS formula above.
 */
export const OBSERVED_CURVE_COEFFICIENT = 8.34;
export const OBSERVED_CURVE_EXPONENT = -0.168;
/** Geometric midpoint of the 500–1,000 mile anchor band. */
export const OBSERVED_CURVE_ANCHOR_MILES = Math.sqrt(500 * 1000);

/** The fitted observed rate, in absolute $/mile. */
export function observedCurveUsdPerMile(miles: number): number {
  return OBSERVED_CURVE_COEFFICIENT * Math.pow(miles, OBSERVED_CURVE_EXPONENT);
}

/** The same curve renormalised to 1.00 at the anchor band, for comparison with `DISTANCE_BANDS`. */
export function observedCurveMultiplier(miles: number): number {
  return observedCurveUsdPerMile(miles) / observedCurveUsdPerMile(OBSERVED_CURVE_ANCHOR_MILES);
}

function dedupeSources(list: ReadonlyArray<MarketSource>): MarketSource[] {
  const seen = new Set<string>();
  const out: MarketSource[] = [];
  for (const s of list) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
  }
  return out;
}

export function priceMarketLinehaul(
  input: LinehaulInput,
  base = BASE_FLATBED_LINEHAUL_USD_PER_MILE,
): LinehaulOutcome {
  if (input.equipment === 'superload') {
    return {
      ok: false,
      reason: 'superload',
      message: SUPERLOAD_REFUSAL_MESSAGE,
      accuracy: rate({
        tier: 'refused',
        hover:
          'Superloads are priced individually after an engineering review. No rate source publishes a number for them, so neither do we.',
        detail:
          'Every source consulted — the DAT flatbed index, ten published heavy-haul rate guides, 21,851 observed load postings, a government lowboy schedule and ATRI’s cost study — stops at permitted multi-axle work. Above that the quoted figures run $10–25/mi and are explicitly described as job-by-job after a route survey, with lead times of three to four weeks in Texas alone. A range that wide is not an estimate. What unblocks a real number is a carrier lane quote with the drawing and the pick points attached.',
        marketSources: [SRC_EQUIPMENT_GUIDES],
      }),
    };
  }

  const spec = EQUIPMENT[input.equipment];
  const regionMult =
    input.region === undefined
      ? REGION_DEFAULT_MULTIPLIER
      : REGION_MULTIPLIERS[input.region];
  const miles = Math.max(0, input.miles);
  const { usd: path, governingBand } = ratePathUsd(base, spec.multiplier, regionMult, miles);
  const minimum = spec.minimumUsd * regionMult;
  const minimumBinds = minimum > path;
  const bandPct = LINEHAUL_BAND_PCT[input.equipment];
  const dMult = distanceMultiplier(miles);
  const effectivePerMile = base * dMult * spec.multiplier * regionMult;
  const total = Math.max(minimum, path);
  /**
   * WHAT THE LANE ACTUALLY WORKS OUT AT PER MILE.
   *
   * Not the same as `effectiveUsdPerMile` whenever the minimum or a shorter
   * band's ceiling governs, and the LINE MUST QUOTE THIS ONE — a row reading
   * "1,115 mi × $5.58/mi" beside a total of $6,408 is arithmetic a reader can
   * check and find wrong, which costs more trust than the plateau costs.
   */
  const realisedPerMile = miles > 0 ? total / miles : 0;
  const bandCeilingGoverns =
    !minimumBinds && governingBand.toMiles !== null && miles > governingBand.toMiles;

  const notes: string[] = [];
  if (bandCeilingGoverns) {
    notes.push(
      `The ${governingBand.label} band's rate is higher than this band's, so this lane cannot price below what a ${governingBand.toMiles?.toLocaleString()}-mile lane costs. The published multipliers are band medians, and used as a raw step function they would price a 501-mile lane below a 500-mile one; the floor keeps the curve honest and never understates.`,
    );
  }
  if (minimumBinds) {
    notes.push(
      `The MINIMUM CHARGE is what you are paying: ${Math.round(miles).toLocaleString()} mi at the modelled rate comes to $${path.toFixed(0)}, below the $${minimum.toFixed(0)} floor. A short move is priced on a DAY RATE, not by the mile — published open-deck day rates run $600–$1,400 and per-mile pricing only takes over above roughly 350 miles. ${spec.minimumBasis}`,
    );
  }
  if (input.region === undefined) notes.push(REGION_OFF_NOTE);
  const belowFloor = !minimumBinds && belowCarrierCostFloor(effectivePerMile);
  if (belowFloor) {
    notes.push(
      `FLAGGED: $${effectivePerMile.toFixed(2)}/mi is below ATRI's measured $${ATRI_EX_FUEL_USD_PER_MILE.toFixed(3)}/mi average cost of running a truck before fuel. A carrier cannot take this lane at this number. Treat it as a signal that an input is wrong, not as a cheap rate.`,
    );
  }

  /**
   * THE TWO WEAK MULTIPLIERS ARE NOT WEAK IN THE SAME WAY, AND THE HOVER SAYS SO.
   *
   * RGN is BRACKETED — two independent methods straddle it, so the number is
   * held and the uncertainty is real but two-sided. Multi-axle is CORROBORATED
   * — two methods agree, and neither of them observed a transaction, because
   * there is no public heavy-haul transaction record to observe. Collapsing
   * those into one sentence would let a recalibration read as a promotion in
   * confidence the multi-axle figure has not earned.
   */
  const isBracketedMultiplier = input.equipment === 'rgn';
  const isCorroboratedMultiplier = input.equipment === 'multiAxle';
  const isWeakMultiplier = isBracketedMultiplier || isCorroboratedMultiplier;
  const multiplierCaveat = isCorroboratedMultiplier
    ? 'That multiplier is CORROBORATED, NOT MEASURED. No free index publishes heavy-haul rates and no open marketplace carries the transactions — a sweep of every public load board reachable without an account found two lowboy postings and nothing at all above 47,000 lb. Two independent inferences now agree on it where one used to stand alone, which is better evidence and is still not an observation, so the band stays wide. '
    : isBracketedMultiplier
      ? 'That multiplier is BRACKETED, NOT CONFIRMED: ten published rate guides put it at 1.52 and three heavy-haul marketplace rate sets put it at 1.75, so the two methods straddle the figure we use. When independent methods bracket a number, holding it is the honest answer and a narrower band is not. '
      : '';

  return {
    ok: true,
    equipment: input.equipment,
    miles,
    baseUsdPerMile: base,
    distanceMultiplier: dMult,
    distanceBandLabel: distanceBandLabel(miles),
    equipmentMultiplier: spec.multiplier,
    regionMultiplier: regionMult,
    effectiveUsdPerMile: Math.round(effectivePerMile * 1000) / 1000,
    realisedUsdPerMile: Math.round(realisedPerMile * 1000) / 1000,
    bandCeilingGoverns,
    ratePathUsd: Math.round(path * 100) / 100,
    minimumUsd: Math.round(minimum * 100) / 100,
    minimumBinds,
    totalUsd: Math.round(total * 100) / 100,
    lowUsd: Math.round(total * (1 - bandPct / 100)),
    highUsd: Math.round(total * (1 + bandPct / 100)),
    belowCostFloor: belowFloor,
    accuracy: rate({
      tier: 'benchmark',
      bandPct,
      lowUsd: Math.round(total * (1 - bandPct / 100)),
      highUsd: Math.round(total * (1 + bandPct / 100)),
      asOf: BASE_ANCHOR_WEEK,
      sample: minimumBinds
        ? `Published open-deck day rates $600–$1,400 and local-move minimums $300–$800; an interagency lowboy schedule’s daily guarantees $1,100–$1,500. Both put the day-rate crossover at ${PROCUREMENT_CROSSOVER_MILES.low}–${PROCUREMENT_CROSSOVER_MILES.high} mi and this ladder is pinned to it`
        : `DAT national flatbed line-haul, week of ${BASE_ANCHOR_WEEK}, checked against ${OBSERVED_FLATBED_MEDIAN_USD_PER_MILE.toFixed(2)}/mi median on 2,636 observed postings; distance curve from ~6,100 USDA lane observations 2025–26${isCorroboratedMultiplier ? '; equipment multiplier from 3 decomposed published quotes and 1 government $/mile schedule, no observed transaction' : ''}${isBracketedMultiplier ? '; equipment multiplier bracketed by 10 publishers at 1.52 and 3 marketplace rate sets at 1.75' : ''}`,
      hover: minimumBinds
        ? `A minimum charge, not a rate. A short move is priced on a day rate, and two unrelated sources put the switch from a day rate to a per-mile rate at about ${MINIMUM_CROSSOVER_MILES} miles, so a lane below that prices as a floor.`
        : `Anchored on DAT's national flatbed line-haul rate of $${base.toFixed(2)}/mi for the week of ${BASE_ANCHOR_WEEK}, adjusted for lane length and trailer type.${isCorroboratedMultiplier ? ' The trailer multiplier is corroborated, not measured — no public record of a transaction at this weight.' : ''}${isBracketedMultiplier ? ' The trailer multiplier is bracketed by two methods that straddle it — the least certain part.' : ''}`,
      detail: minimumBinds
        ? `A short move is not priced with a per-mile premium, it is priced on a DAY RATE — two carriers say so outright, and one puts the switch to per-mile pricing above roughly 350 miles. So the model carries a floor, and the floor is pinned to the CROSSOVER rather than to any one published level, because the published levels price different products: open-deck guides publish $300–$800 for a local legal move and a $600–$1,400 day rate, while an interagency schedule publishes $1,100–$1,500 daily guarantees for fully-operated heavy haul. What those two agree on is where the crossover sits — USDA's flat sub-100-mile totals put it at 256 miles and the interagency guarantees cross their own per-mile rates at ${PROCUREMENT_CROSSOVER_MILES.low}–${PROCUREMENT_CROSSOVER_MILES.high} — so every rung here is the price of a ${MINIMUM_CROSSOVER_MILES}-mile lane for its class. ${spec.minimumBasis} Excludes fuel, permits, escorts and every accessorial.`
        : `Base: DAT's national flatbed LINE-HAUL rate (not its all-in rate) for the week of ${BASE_ANCHOR_WEEK}, $${base.toFixed(2)}/mi, republished in full by a trade outlet and refetchable weekly. It moved +$0.69/mi over seventeen consecutive weeks earlier this year, so it is read live rather than frozen — and because it moves, no seasonal curve is applied on top, which would double-count. It was checked against 2,636 observed flatbed postings whose median is $${OBSERVED_FLATBED_MEDIAN_USD_PER_MILE.toFixed(2)}/mi and held, which puts it near their 40th percentile: conservative rather than wrong. Distance: multipliers from ~6,100 USDA lane observations, renormalised so the 500–1,000 mile band is 1.00; the curve is steep out to about 500 miles then essentially flat, and a fitted curve from 12,881 observed open-deck loads was tested as a replacement and agrees with these bands to about 6% beyond 600 miles. Equipment: ${spec.basis} ${multiplierCaveat}Excludes fuel, which is added separately from the EIA weekly diesel index.`,
      // Deduped: the interagency schedule backs BOTH the minimum ladder and the
      // multi-axle multiplier, so a multi-axle lane on its floor would otherwise
      // cite it twice.
      marketSources: dedupeSources([
        SRC_DAT_FLATBED,
        SRC_USDA_REEFER_LANES,
        SRC_OBSERVED_POSTINGS,
        ...(minimumBinds ? [SRC_USDA_GRAIN_TRUCK, SRC_NRCG_TRANSPORT_RATES] : []),
        ...(isWeakMultiplier ? [SRC_EQUIPMENT_GUIDES] : []),
        ...(isCorroboratedMultiplier ? [SRC_NRCG_TRANSPORT_RATES, SRC_ATS_AXLE_FORMULA] : []),
        SRC_ATRI_COSTS,
      ]),
    }),
    notes,
  };
}
