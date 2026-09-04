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
 * EQUIPMENT MULTIPLIER is the weak joint, it is load-bearing — it is what turns
 * a flatbed rate into a heavy-haul rate — and it rests on five broker rate
 * guides that agree with each other and are all marketing. The accuracy rating
 * carries that difference rather than the prose hiding it.
 *
 * ── THE MINIMUM IS THE BEST-EVIDENCED NUMBER IN THE MODEL ─────────────────
 *
 * USDA's published 0–100 mile lanes cluster at p10 $1,300 / median $1,400 / p75
 * $1,500 — that is a minimum charge, not a rate, and it GOVERNS THE ENTIRE
 * SUB-250-MILE BAND. A pure per-mile model returns $1,014 on a 185-mile step-deck
 * lane ($912 with the Midwest regional adjustment the research applied and we do
 * not) where the market answer is the $1,400 step-deck floor — a third low, on
 * exactly the short moves a forwarder quotes most often.
 *
 * ── TWO THINGS DELIBERATELY NOT DONE ──────────────────────────────────────
 *
 * 1. NO SEASONAL CURVE. DAT's own flatbed line-haul moved $2.26 (Feb) → $2.95
 *    (Jul) = 1.31× this year. Seasonality is already inside the anchor, and
 *    multiplying by a seasonal index on top would double-count it. A seasonal
 *    curve only becomes correct if the anchor is ever frozen.
 * 2. REGIONAL MULTIPLIERS SHIP OFF. The two available proxies contradict each
 *    other outright — USDA reefer lanes put the Great Lakes at 1.43× while a
 *    heavy-equipment rate guide puts the Midwest at 0.83× — because one measures
 *    outbound produce and the other measures machinery. The table is here,
 *    exported and testable, and `LinehaulInput.region` is opt-in.
 */
import {
  SRC_ATRI_COSTS,
  SRC_DAT_FLATBED,
  SRC_EQUIPMENT_GUIDES,
  SRC_USDA_GRAIN_TRUCK,
  SRC_USDA_REEFER_LANES,
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
 */
export const BASE_FLATBED_LINEHAUL_USD_PER_MILE = 2.67;
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
 * Renormalised to the 500–1,000 mile band = 1.00, from ~6,100 real US truckload
 * lane observations USDA publishes weekly (2025–26).
 *
 * The <250 figure is MODERATED from the raw 2.67× observation to 1.90. Using
 * both the raw short-haul multiplier and the minimum would double-count the same
 * effect, because they are two measurements of one thing: sub-100-mile totals in
 * the USDA data are flat at $1,300–$1,500 regardless of distance. In practice
 * the minimum governs that whole band anyway — see `notionalCrossoverMiles`.
 */
export const DISTANCE_BANDS: ReadonlyArray<DistanceBand> = [
  { fromMiles: 0, toMiles: 250, multiplier: 1.9, label: 'under 250 mi' },
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
  basis: string;
}

/**
 * Equipment multipliers, fuel economy and minimums.
 *
 * The MULTIPLIERS are the weak joint: five independent rate guides put RGN and
 * lowboy work 1.40–1.80× flatbed and we adopt 1.60; step deck is better
 * evidenced as an absolute delta (+$0.15–0.30/mi, i.e. ≈1.08×) than as a ratio;
 * permitted multi-axle at $4–12/mi against legal RGN $3.40–6.00 implies roughly
 * 1.4–2.0× on top of RGN, hence 2.40× flatbed.
 *
 * The MPG figures are a different quality of evidence and are described in
 * `FLATBED_MPG` below.
 *
 * The MINIMUMS scale with the multiplier off the USDA-observed $1,300 flatbed
 * floor, except step deck, which takes the observed $1,400 median directly.
 */
export const EQUIPMENT: Readonly<Record<Exclude<EquipmentClass, 'superload'>, EquipmentSpec>> = {
  flatbed: {
    multiplier: 1.0,
    mpg: 5.0,
    minimumUsd: 1300,
    label: 'Flatbed',
    basis: 'The anchor itself — DAT publishes a national flatbed rate, so this multiplier is 1.00 by construction.',
  },
  stepDeck: {
    multiplier: 1.08,
    mpg: 5.0,
    minimumUsd: 1400,
    label: 'Step deck',
    basis: 'Step deck is published as an absolute delta over flatbed, +$0.15–0.30/mi; +$0.22 on a $2.67 base is 1.08×.',
  },
  rgn: {
    multiplier: 1.6,
    mpg: 4.0,
    minimumUsd: 2080,
    label: 'RGN / lowboy',
    basis: 'Five independent rate guides put RGN work 40–80% above flatbed; their implied ratios are 1.40, 1.40, 1.50, 1.50 and 1.73.',
  },
  multiAxle: {
    multiplier: 2.4,
    mpg: 3.5,
    minimumUsd: 3120,
    label: 'Multi-axle permitted',
    basis: 'Permitted OS/OW work is published at $4–12/mi against legal RGN at $3.40–6.00, implying roughly 1.4–2.0× on top of RGN.',
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
 * Regional multipliers. SHIPPED OFF. See the module header for why: the two
 * available proxies disagree by 72% on overlapping geography.
 */
export const REGION_MULTIPLIERS: Readonly<Record<MarketRegion, number>> = {
  midwest: 0.9,
  mountainPlains: 0.95,
  west: 1.0,
  southCentral: 1.05,
  southeast: 1.08,
  northeast: 1.15,
};

/** Regional adjustment is opt-in and defaults to 1.00 (no adjustment). */
export const REGION_DEFAULT_MULTIPLIER = 1.0;

export const REGION_OFF_NOTE =
  'Regional adjustment is OFF. The only two free sources for it contradict each other — USDA lane data puts the Great Lakes 43% above national while a heavy-equipment rate guide puts the Midwest 17% below it — because one measures outbound produce and the other measures machinery. Turning it on would add a number we cannot defend.';

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
 * ± band on the line haul.
 *
 * 25% for flatbed and step deck, whose whole chain — anchor, distance curve,
 * minimum — is published and dated, leaving only the week-to-week movement of
 * the anchor and the distance band's own width.
 *
 * 40% for RGN and multi-axle, because the equipment multiplier is the load-
 * bearing term and its evidence is five broker guides whose implied ratios
 * spread 1.40–1.73 — ±11% on the multiplier alone — on top of everything the
 * flatbed band already carries.
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
 * Computed rather than asserted, and it is the claim the USDA data supports most
 * strongly: for flatbed the rate path reaches only $1,268 at 250 miles against a
 * $1,300 minimum, so the notional crossover sits at 256 miles and the minimum
 * governs the whole sub-250 band. Every class scales identically, so every class
 * crosses in the same place.
 */
export function notionalCrossoverMiles(
  equipment: Exclude<EquipmentClass, 'superload'>,
  base = BASE_FLATBED_LINEHAUL_USD_PER_MILE,
): number {
  const spec = EQUIPMENT[equipment];
  const shortBand = DISTANCE_BANDS[0].multiplier;
  return spec.minimumUsd / (base * shortBand * spec.multiplier);
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
          'Every source consulted — the DAT flatbed index, five heavy-haul rate guides and ATRI’s cost study — stops at permitted multi-axle work. Above that the quoted figures run $10–25/mi and are explicitly described as job-by-job after a route survey, with lead times of three to four weeks in Texas alone. A range that wide is not an estimate. What unblocks a real number is a carrier lane quote with the drawing and the pick points attached.',
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
      `The MINIMUM CHARGE is what you are paying: ${Math.round(miles).toLocaleString()} mi at the modelled rate comes to $${path.toFixed(0)}, below the $${minimum.toFixed(0)} floor. US truckload moves under 100 miles cluster at $1,300–$1,500 total in USDA's published lane data regardless of distance — carriers price a short move as a minimum, not by the mile.`,
    );
  }
  if (input.region === undefined) notes.push(REGION_OFF_NOTE);
  const belowFloor = !minimumBinds && belowCarrierCostFloor(effectivePerMile);
  if (belowFloor) {
    notes.push(
      `FLAGGED: $${effectivePerMile.toFixed(2)}/mi is below ATRI's measured $${ATRI_EX_FUEL_USD_PER_MILE.toFixed(3)}/mi average cost of running a truck before fuel. A carrier cannot take this lane at this number. Treat it as a signal that an input is wrong, not as a cheap rate.`,
    );
  }

  const isWeakMultiplier = input.equipment === 'rgn' || input.equipment === 'multiAxle';

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
        ? 'USDA published lane data: 104 observations under 100 mi, p10 $1,300 · median $1,400 · p75 $1,500'
        : `DAT national flatbed line-haul, week of ${BASE_ANCHOR_WEEK}; distance curve from ~6,100 USDA lane observations 2025–26${isWeakMultiplier ? '; equipment multiplier from 5 industry rate guides' : ''}`,
      hover: minimumBinds
        ? `A minimum charge, not a rate. Moves under 100 miles cluster at $1,300–$1,500 total in USDA's published lane data whatever the distance, so a short lane prices as a floor.`
        : `Anchored on DAT's national flatbed line-haul rate of $${base.toFixed(2)}/mi for the week of ${BASE_ANCHOR_WEEK}, adjusted for lane length and trailer type.${isWeakMultiplier ? ' The trailer multiplier is the least certain part.' : ''}`,
      detail: minimumBinds
        ? `USDA publishes ~6,100 real US truckload lane observations a year. In the 0–100 mile band the TOTAL charge distribution is extraordinarily tight — p10 $1,300, p25 $1,300, median $1,400, p75 $1,500 — which is the signature of a minimum charge rather than a per-mile rate. It is the single best-evidenced number in this model, and it governs every lane under about 250 miles: the modelled rate path only reaches $1,268 at 250 miles against a $1,300 floor. Excludes fuel, permits, escorts and every accessorial. ${spec.basis}`
        : `Base: DAT's national flatbed LINE-HAUL rate (not its all-in rate) for the week of ${BASE_ANCHOR_WEEK}, $${base.toFixed(2)}/mi, republished in full by a trade outlet and refetchable weekly. It moved +$0.69/mi over seventeen consecutive weeks earlier this year, so it is read live rather than frozen — and because it moves, no seasonal curve is applied on top, which would double-count. Distance: multipliers from ~6,100 USDA lane observations, renormalised so the 500–1,000 mile band is 1.00; the curve is steep out to about 500 miles then essentially flat. Equipment: ${spec.basis} ${isWeakMultiplier ? 'That multiplier is the weakest joint in this model — no free index publishes heavy-haul rates, so it is the consensus of five industry rate guides rather than an observation. ' : ''}Excludes fuel, which is added separately from the EIA weekly diesel index.`,
      marketSources: [
        SRC_DAT_FLATBED,
        SRC_USDA_REEFER_LANES,
        ...(minimumBinds ? [SRC_USDA_GRAIN_TRUCK] : []),
        ...(isWeakMultiplier ? [SRC_EQUIPMENT_GUIDES] : []),
        SRC_ATRI_COSTS,
      ],
    }),
    notes,
  };
}
