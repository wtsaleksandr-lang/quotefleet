/**
 * THE CIVILIAN PILOT-CAR MARKET MODEL — a tiered floor, not a per-mile rate.
 *
 * ── WHAT THIS FILE MUST NOT TOUCH ─────────────────────────────────────────
 *
 * `src/calc/osow/escortCost.ts` holds SOURCED law-enforcement escort rates for
 * six states, cited to their published schedules, and it holds the caller's own
 * pilot-car rate path. Neither is changed by a line of this file and neither may
 * be contaminated by it. This module adds the civilian market band BESIDE them:
 * it consumes the escort COUNTS the state rules produce and prices them, and its
 * output is `basis: 'market'` money that can never reach a cited subtotal.
 *
 * Order of precedence, unchanged from before:
 *   1. The caller's own negotiated rate. Always wins. It is a real price.
 *   2. This market band. What a forwarder with no rates of his own gets.
 *   3. Nothing.
 *
 * ── THE STRUCTURAL FINDING ────────────────────────────────────────────────
 *
 * Escorts are not billed per mile. They are billed on a TIERED FLOOR, and the
 * tiers are the most consistently published feature of this market — they appear
 * in all five regions of the one dated industry rate card and in three
 * independent vendor sheets, and forum operators confirm them from both sides of
 * the transaction:
 *
 *   ≤100 mi        mini      $275–$400   flat
 *   100–250 mi     day rate  $450–$700   flat, per day
 *   >250 mi        mileage   $1.65–$2.15/mi
 *
 * The tiers are FLOORS, not alternatives — the operator bills the higher of the
 * tier charge and the mileage math. A pure per-mile model cannot produce a
 * correct short-move price because it has no floor, and that is precisely where
 * a competitor's published figures fall 23–42% below the cheapest published day
 * rate for the region they are in.
 *
 * ── THE ONE VALIDATION WORTH RECORDING ────────────────────────────────────
 *
 * A competitor's two published escort line items — Georgia $653.05 and Tennessee
 * $347.80 — resolve to whole state-miles (353.00 and 188.00) at exactly one rate
 * in the whole plausible band: $1.85/mi. That is dead centre of our national
 * band, and on a 1,115-mile two-car move their implied mileage subtotal
 * ($4,125.50) and ours ($4,126) agree to within a dollar. Two independently
 * built models converging on the mileage component is the strongest evidence
 * available that the band is right. The disagreement is entirely structural and
 * all of it is on short moves, where they have no floor and we do.
 */
import {
  SRC_ESCORT_BUYER_SIDE,
  SRC_ESCORT_OPERATOR_SHEETS,
  SRC_PILOTCAR101,
} from './sources.js';
import { rate, type AccuracyRating } from './accuracy.js';

// ── The tiered floor ──────────────────────────────────────────────────────

export const MINI_MAX_MILES = 100;
export const DAY_RATE_MAX_MILES = 250;

/** Flat minimum for a local move, per escort vehicle. */
export const MINI_LOW_USD = 275;
export const MINI_HIGH_USD = 400;

/** Day rate below the mileage threshold, per escort vehicle per day. */
export const DAY_RATE_LOW_USD = 450;
export const DAY_RATE_HIGH_USD = 700;

/**
 * Per-mile band above 250 miles, per escort vehicle.
 *
 * The pooled national figures. The narrow central band is $1.75–$2.00 and the
 * widest defensible spread across every sheet found is $1.45–$2.25; the three
 * numbers below are the ones the research prices worked examples with, and
 * $1.85 is both the midpoint and the independently reverse-engineered figure a
 * competitor charges.
 */
export const PER_MILE_LOW_USD = 1.65;
export const PER_MILE_CENTRAL_USD = 1.85;
export const PER_MILE_HIGH_USD = 2.15;

/** The tighter and wider published bands, exported for the page's read-more. */
export const PER_MILE_CENTRAL_BAND: readonly [number, number] = [1.75, 2.0];
export const PER_MILE_WIDE_BAND: readonly [number, number] = [1.45, 2.25];

/**
 * HIGH POLE IS A PREMIUM ON A CAR YOU ALREADY NEED — NEVER AN EXTRA CAR.
 *
 * +10% to +30%, centred on +15%. This is the best-evidenced number in the whole
 * escort model, because it is a RATIO computed within each rate sheet rather
 * than a level compared across them: eleven independent operator sheets give
 * ratios of 1.07, 1.11–1.32, 1.13, 1.13, 1.13–1.18, 1.15–1.16, 1.15–1.17,
 * 1.18–1.32, 1.25–1.28 and 1.26. The median is 1.13–1.15. It survives the level
 * disagreement that sinks the outlier sources entirely.
 *
 * The pole is normally the lead car, so the premium applies to ONE vehicle.
 */
export const HIGH_POLE_LOW_MULT = 1.1;
export const HIGH_POLE_CENTRAL_MULT = 1.15;
export const HIGH_POLE_HIGH_MULT = 1.3;

/** Overnight or hotel, per night, per escort vehicle. */
export const OVERNIGHT_LOW_USD = 85;
export const OVERNIGHT_CENTRAL_USD = 110;
export const OVERNIGHT_HIGH_USD = 175;

/**
 * Daylight-only OSOW progress, miles per day. AN OPERATING ASSUMPTION, NOT A
 * SOURCED FIGURE, and the accuracy note says so. Fewer miles a day means more
 * nights, so the LOW cost uses the FAST figure.
 */
export const PROGRESS_FAST_MI_PER_DAY = 450;
export const PROGRESS_CENTRAL_MI_PER_DAY = 375;
export const PROGRESS_SLOW_MI_PER_DAY = 300;

/**
 * DEADHEAD — the weakest component, kept as its own explicitly-uncertain line.
 *
 * The evidence genuinely conflicts rather than being thin: two operators publish
 * a per-mile deadhead rate ($0.75/mi; $0.50/mi beyond 100 mi, "negotiable"), one
 * publishes a flat $125 relocation fee, and a thread in which an operator and
 * two carriers all agree records that none is paid at all — pilots find their
 * own return loads. Nobody publishes a deadhead DISTANCE, and it is unknowable
 * before an operator is dispatched.
 *
 * So it is $0–$350 per vehicle (0–250 positioning miles at $0.50–$0.75), it is
 * NEVER folded into the per-mile rate, and its central figure is deliberately
 * well below the midpoint because "absorbed entirely" is a real and common
 * outcome. It is the largest hidden component and the one most likely to make a
 * real invoice exceed this estimate.
 */
export const DEADHEAD_LOW_USD = 0;
export const DEADHEAD_CENTRAL_USD = 125;
export const DEADHEAD_HIGH_USD = 350;

/** Wait / standby. Published rate, unknowable hours — a risk note, never a line. */
export const WAIT_LOW_USD_PER_HOUR = 25;
export const WAIT_HIGH_USD_PER_HOUR = 65;

/** Cancellation / "no-go", per vehicle. Also a risk note. */
export const NO_GO_LOW_USD = 250;
export const NO_GO_HIGH_USD = 425;

/** ± band on the escort total. The research's own figure for a long two-car move. */
export const ESCORT_BAND_PCT = 25;

// ── The model ─────────────────────────────────────────────────────────────

export type EscortTier = 'mini' | 'dayRate' | 'mileage';

export interface EscortLegCharge {
  tier: EscortTier;
  lowUsd: number;
  centralUsd: number;
  highUsd: number;
  /** How the tier was picked, in one clause. */
  basis: string;
}

/**
 * The base charge for ONE escort vehicle over `miles`.
 *
 * The tier charge and the mileage math are both computed and the HIGHER wins,
 * because the tiers are floors. That is why a 200-mile two-car move prices at
 * $900–$1,400 here and $740 on a naive per-mile model.
 */
export function escortLegCharge(miles: number): EscortLegCharge {
  const mileageLow = miles * PER_MILE_LOW_USD;
  const mileageCentral = miles * PER_MILE_CENTRAL_USD;
  const mileageHigh = miles * PER_MILE_HIGH_USD;

  if (miles <= MINI_MAX_MILES) {
    return {
      tier: 'mini',
      lowUsd: Math.max(MINI_LOW_USD, mileageLow),
      centralUsd: Math.max((MINI_LOW_USD + MINI_HIGH_USD) / 2, mileageCentral),
      highUsd: Math.max(MINI_HIGH_USD, mileageHigh),
      basis: `A local move of ${Math.round(miles)} mi bills the published minimum ("mini") of $${MINI_LOW_USD}–$${MINI_HIGH_USD}, not the miles.`,
    };
  }
  if (miles <= DAY_RATE_MAX_MILES) {
    return {
      tier: 'dayRate',
      lowUsd: Math.max(DAY_RATE_LOW_USD, mileageLow),
      centralUsd: Math.max((DAY_RATE_LOW_USD + DAY_RATE_HIGH_USD) / 2, mileageCentral),
      highUsd: Math.max(DAY_RATE_HIGH_USD, mileageHigh),
      basis: `Below about 250 mi an operator bills a full day, $${DAY_RATE_LOW_USD}–$${DAY_RATE_HIGH_USD}, so a short move costs more per mile than a long one.`,
    };
  }
  return {
    tier: 'mileage',
    lowUsd: mileageLow,
    centralUsd: mileageCentral,
    highUsd: mileageHigh,
    basis: `Above 250 mi the mileage rate governs: ${Math.round(miles).toLocaleString()} mi × $${PER_MILE_LOW_USD.toFixed(2)}–$${PER_MILE_HIGH_USD.toFixed(2)}/mi.`,
  };
}

/** Nights out, per vehicle. `ceil(miles / progress) − 1`, never negative. */
export function overnightsNeeded(miles: number, milesPerDay: number): number {
  if (miles <= 0 || milesPerDay <= 0) return 0;
  return Math.max(0, Math.ceil(miles / milesPerDay) - 1);
}

export interface EscortMarketInput {
  /** Escort vehicles the state rules require. From `escortRules`, not from us. */
  vehicles: number;
  /** Lane miles the escorts run. */
  miles: number;
  /**
   * True when one of the required escorts must carry a height pole. It is a
   * premium on that car, never an extra car.
   */
  highPole?: boolean;
}

export interface EscortMarketComponent {
  code: string;
  name: string;
  lowUsd: number;
  centralUsd: number;
  highUsd: number;
  note: string;
}

export interface EscortMarketEstimate {
  vehicles: number;
  miles: number;
  tier: EscortTier;
  components: EscortMarketComponent[];
  lowUsd: number;
  centralUsd: number;
  highUsd: number;
  /** Never added to the total. Disclosed, because they are real and unpredictable. */
  riskNotes: string[];
  accuracy: AccuracyRating;
}

export const ESCORT_MARKET_DISCLAIMER =
  'A MARKET BAND, not a quote and not a state fee. Operators set their own rates; this is the spread across a dozen published rate sheets and one dated industry rate posting. It is never added to the permit total, and your own negotiated rate replaces it outright.';

/**
 * Price the civilian escorts a lane requires.
 *
 * MULTI-ESCORT MULTIPLIES. There is no bundle discount in any published
 * evidence: the only source that addresses two-car pricing at all prices two
 * cars at exactly 2× one car and doubles the deadhead in its own worked example.
 * Inventing a discount would be inventing the one thing nobody publishes.
 */
export function estimateEscortMarketCost(
  input: EscortMarketInput,
): EscortMarketEstimate | null {
  const vehicles = Math.max(0, Math.floor(input.vehicles));
  if (vehicles === 0) return null;
  const miles = Math.max(0, input.miles);
  const leg = escortLegCharge(miles);

  const components: EscortMarketComponent[] = [];

  components.push({
    code: 'escort_base',
    name: `Pilot cars, ${vehicles} vehicle${vehicles === 1 ? '' : 's'} (${leg.tier === 'mileage' ? 'mileage' : leg.tier === 'dayRate' ? 'day rate' : 'minimum charge'})`,
    lowUsd: leg.lowUsd * vehicles,
    centralUsd: leg.centralUsd * vehicles,
    highUsd: leg.highUsd * vehicles,
    note: `${leg.basis} Each vehicle prices independently — no published rate sheet offers a discount for taking two cars from one operator.`,
  });

  if (input.highPole) {
    // A PREMIUM ON ONE CAR. Adding a vehicle here would be the classic error.
    components.push({
      code: 'escort_high_pole',
      name: 'Height-pole premium (one vehicle)',
      lowUsd: leg.lowUsd * (HIGH_POLE_LOW_MULT - 1),
      centralUsd: leg.centralUsd * (HIGH_POLE_CENTRAL_MULT - 1),
      highUsd: leg.highUsd * (HIGH_POLE_HIGH_MULT - 1),
      note: 'A height pole is an uplift of 10–30% on one of the escorts you already need — normally the lead car — not an additional vehicle. Computed as the premium each of eleven operators publishes over its own lead/chase rate.',
    });
  }

  const nightsLow = overnightsNeeded(miles, PROGRESS_FAST_MI_PER_DAY);
  const nightsCentral = overnightsNeeded(miles, PROGRESS_CENTRAL_MI_PER_DAY);
  const nightsHigh = overnightsNeeded(miles, PROGRESS_SLOW_MI_PER_DAY);
  if (nightsHigh > 0) {
    components.push({
      code: 'escort_overnight',
      name: `Overnights (${nightsCentral} night${nightsCentral === 1 ? '' : 's'} × ${vehicles} vehicle${vehicles === 1 ? '' : 's'})`,
      lowUsd: nightsLow * vehicles * OVERNIGHT_LOW_USD,
      centralUsd: nightsCentral * vehicles * OVERNIGHT_CENTRAL_USD,
      highUsd: nightsHigh * vehicles * OVERNIGHT_HIGH_USD,
      note: `Published overnight or hotel charge per escort vehicle, $${OVERNIGHT_LOW_USD}–$${OVERNIGHT_HIGH_USD} a night across nine sources. The NIGHT COUNT is our own assumption — ${PROGRESS_SLOW_MI_PER_DAY}–${PROGRESS_FAST_MI_PER_DAY} miles a day of daylight-only travel — not a sourced figure, and your permit's running-hour restrictions decide it.`,
    });
  }

  components.push({
    code: 'escort_deadhead',
    name: `Deadhead / positioning (${vehicles} vehicle${vehicles === 1 ? '' : 's'})`,
    lowUsd: DEADHEAD_LOW_USD * vehicles,
    centralUsd: DEADHEAD_CENTRAL_USD * vehicles,
    highUsd: DEADHEAD_HIGH_USD * vehicles,
    note: 'THE MOST UNCERTAIN LINE HERE, kept separate rather than buried in the per-mile rate. Some operators bill travel to the pickup at $0.50–$0.75 a mile or a flat relocation fee; others absorb it entirely; the distance is unknowable before an operator is dispatched. Its low end is genuinely $0.',
  });

  const lowUsd = round2(components.reduce((s, c) => s + c.lowUsd, 0));
  const centralUsd = round2(components.reduce((s, c) => s + c.centralUsd, 0));
  const highUsd = round2(components.reduce((s, c) => s + c.highUsd, 0));

  const riskNotes = [
    `Wait and standby run $${WAIT_LOW_USD_PER_HOUR}–$${WAIT_HIGH_USD_PER_HOUR} an hour per vehicle after one or two free hours. The hours cannot be predicted, so no figure for them is included above.`,
    `A cancelled escort ("no-go") is $${NO_GO_LOW_USD}–$${NO_GO_HIGH_USD} per vehicle, several operators adding the hotel on top.`,
    'Two of eleven operators add a fuel surcharge, one of them 10% of the total — not general market practice, but a reason a final invoice can exceed a quoted rate.',
    'A weekend or holiday move is usually barred outright rather than surcharged, so the real cost of one is an extra layover, not a premium rate.',
  ];

  return {
    vehicles,
    miles,
    tier: leg.tier,
    components,
    lowUsd,
    centralUsd,
    highUsd,
    riskNotes,
    accuracy: rate({
      tier: 'benchmark',
      bandPct: ESCORT_BAND_PCT,
      lowUsd,
      highUsd,
      asOf: '2025-01-26',
      sample:
        'Eleven published operator rate sheets plus one dated industry rate posting (Jan 2025), cross-checked against a broker cost guide from the buy side',
      hover:
        'A market band from about a dozen pilot car operators’ published rate sheets and an industry rate posting dated January 2025. Operators set their own rates, so this is a band, not a schedule.',
      detail: `${ESCORT_MARKET_DISCLAIMER} The structure matters more than the level: below about 250 miles an operator bills a day rate or a minimum, not the miles, and that floor appears in all five regions of the dated rate card and in three independent vendor sheets. A competitor's two published escort line items reverse-engineer to a flat $1.85 per state-mile with no floor at all — which lands dead centre of our per-mile band and 23–42% below the cheapest published day rate on the short move where the floor bites. The band excludes wait time, cancellation, fuel surcharges and any night or weekend premium, and its deadhead component is a genuine $0–$350 a vehicle. No association or trade group publishes an escort rate survey; this rests on vendor sheets and one dated posting, which is the load-bearing weakness. There is no 2026 edition of that posting — re-check it each January.`,
      marketSources: [
        SRC_PILOTCAR101,
        SRC_ESCORT_OPERATOR_SHEETS,
        SRC_ESCORT_BUYER_SIDE,
      ],
    }),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
