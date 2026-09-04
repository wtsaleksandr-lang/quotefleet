/**
 * ACCESSORIALS — turning a line haul into a delivered price.
 *
 * ── THE FINDING THAT JUSTIFIES THIS WHOLE FILE ────────────────────────────
 *
 * Loading is not the carrier's cost, and the filed tariffs say so outright. Ace
 * Doran's ICC tariff ACEH 101-E, Item 270: loading is performed by the Shipper
 * and unloading by the Consignee, and where special equipment that is not part
 * of the carrier's trucking equipment — cranes, hoists or winches — is needed,
 * it "shall be supplied by the Consignor or Consignee" together with the
 * personnel to operate it. Glen Raven's tariff says the same of bracing and
 * blocking.
 *
 * So a shipper who ticks "no loading provided" is buying a machine that NOBODY
 * IN HIS QUOTE CHAIN HAS PRICED. On the worked example the two crane picks are
 * 73% of the accessorial stack. That blindside is exactly what this tool exists
 * to remove, which means the crane number has to be ours.
 *
 * ── THREE RULES THAT MATTER MORE THAN THE ARITHMETIC ──────────────────────
 *
 * 1. ANCHOR AT THE 65TH PERCENTILE, NOT THE MIDPOINT — for components that
 *    ALWAYS apply. A shipper who budgets $800 for a $6,000 crane has been badly
 *    served; one who budgets $4,500 for a $3,500 crane is mildly annoyed. The
 *    asymmetry is not close. Conditional components (tarping, route survey,
 *    securement) get a likelihood-weighted headline instead, because biasing a
 *    may-not-apply item upward would inflate every quote on the site.
 * 2. ALWAYS SHOW THE RANGE AND LABEL ITS DRIVER. The width IS the content. A
 *    crane's real driver is site access, which we have not asked about.
 * 3. A FILED CARRIER TARIFF IS EXCELLENT EVIDENCE AND IT IS NOT A STATUTE.
 *    Several figures here come from tariffs actually filed by named carriers —
 *    detention, tarping, layover, the assist-labour rates. They are dated,
 *    pinpoint-citable and far better than a broker's marketing page. They are
 *    still one carrier's published schedule: a statute binds every carrier in
 *    the state and a tariff binds the carrier that filed it, and the shipper
 *    using this tool has not chosen a carrier yet. So every one of them is a
 *    BENCHMARK, it renders as a range, and its hover says in as many words
 *    where the number came from — which is more useful to a shipper than either
 *    "cited" or a bare "market estimate", and it is the truth.
 * 4. REFUSE ABOVE 160,000 LB. That is exactly where the evidence stops — see
 *    `CRANE_REFUSAL_CARGO_LBS`. There is published precedent for refusing: Ace
 *    Doran quotes tarping by dimension and then prints SPOT BID above 14 ft
 *    wide. A carrier with a filed tariff and decades of lane data declines to
 *    publish a number above a threshold; us doing the same is not a product
 *    failure.
 */
import {
  SRC_ACE_DORAN_TARIFF,
  SRC_CARGO_INSURANCE,
  SRC_CA_PREVAILING_WAGE,
  SRC_FEMA_EQUIPMENT_RATES,
  SRC_FEMA_URT,
  SRC_GLEN_RAVEN_TARIFF,
  SRC_IL_ENGINEERING_REVIEW,
  SRC_NORTH_TEXAS_CRANE,
  SRC_PERMIT_SERVICE_FEES,
  SRC_TXDMV_SUPERHEAVY,
} from './sources.js';
import { rate, type AccuracyRating } from './accuracy.js';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** One accessorial, priced or refused. */
export interface AccessorialLine {
  code: string;
  name: string;
  /** `null` when REFUSED — this applies and we will not price it. */
  headlineUsd: number | null;
  lowUsd: number | null;
  highUsd: number | null;
  accuracy: AccuracyRating;
  /** True when the line belongs in the delivered total. */
  inTotal: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// LOADING — the headline
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The published OPERATED crane rate curve, $/hr including operator.
 *
 * One 2025 rate card from a Dallas–Fort Worth operator. It is the only complete
 * published operated rate card retrievable — most operators gate theirs behind a
 * quote form — and THE SINGLE-SOURCE RISK IN IT IS REAL AND STATED. Two
 * independent government schedules act as sanity rails rather than as the basis:
 * FEMA's bare rates (operator excluded) and California's legally binding
 * prevailing wage for a crane operator, which puts a fully burdened craftsman at
 * $94–$100/hr — landing on top of this sheet's own $95/hr rigger rate from a
 * completely different direction.
 */
export const CRANE_RATE_CURVE: ReadonlyArray<{ capacityTons: number; usdPerHour: number }> = [
  { capacityTons: 23, usdPerHour: 155 },
  { capacityTons: 30, usdPerHour: 175 },
  { capacityTons: 40, usdPerHour: 205 },
  { capacityTons: 50, usdPerHour: 225 },
  { capacityTons: 60, usdPerHour: 250 },
  { capacityTons: 75, usdPerHour: 310 },
  { capacityTons: 80, usdPerHour: 330 },
  { capacityTons: 100, usdPerHour: 355 },
  { capacityTons: 110, usdPerHour: 385 },
  { capacityTons: 120, usdPerHour: 440 },
  { capacityTons: 165, usdPerHour: 520 },
  { capacityTons: 210, usdPerHour: 550 },
  { capacityTons: 240, usdPerHour: 575 },
  { capacityTons: 275, usdPerHour: 595 },
];

/** Hourly rate for a nominal capacity, interpolated between published classes. */
export function craneRateUsdPerHour(capacityTons: number): number {
  const curve = CRANE_RATE_CURVE;
  const first = curve[0];
  const last = curve[curve.length - 1];
  if (capacityTons <= first.capacityTons) return first.usdPerHour;
  if (capacityTons >= last.capacityTons) return last.usdPerHour;
  for (let i = 1; i < curve.length; i += 1) {
    const hi = curve[i];
    const lo = curve[i - 1];
    if (capacityTons <= hi.capacityTons) {
      const t = (capacityTons - lo.capacityTons) / (hi.capacityTons - lo.capacityTons);
      return round2(lo.usdPerHour + t * (hi.usdPerHour - lo.usdPerHour));
    }
  }
  return last.usdPerHour;
}

/**
 * WEIGHT → CAPACITY. THE MOST LOAD-BEARING DERIVED ASSUMPTION IN THIS ENGINE.
 *
 * A crane is NOT sized to the load's weight. Rated capacity is quoted at a given
 * radius and falls off steeply as the boom reaches out, rigging (spreader bars,
 * slings, hook block, shackles) is part of the load, and picks are planned at
 * roughly 75–85% of chart capacity rather than 100%. The dominant term —
 * radius — is a SITE property this tool has not asked about.
 *
 * No published capacity-selection rule appears in any source consulted. 2.0×
 * (best access) to 3.0× (typical) is ours. Restricted access, long radius or
 * overhead obstructions push it to 4–6× and beyond, which is why the range is
 * wide and why the range's driver is named on the line.
 */
export const CRANE_CAPACITY_LOW_MULT = 2.0;
export const CRANE_CAPACITY_HIGH_MULT = 3.0;

/** Minimum billable hours: 3 up to 30 t, 4 above. Portal to portal. */
export const CRANE_MIN_HOURS_SMALL = 3;
export const CRANE_MIN_HOURS_LARGE = 4;
export const CRANE_HOURS_HIGH = 8;
/** 7% of invoice, published on the rate card. */
export const CRANE_FUEL_SURCHARGE = 0.07;
/** Rigger / signal person, 4 hr minimum. Corroborated by CA prevailing wage. */
export const RIGGER_USD_PER_HOUR = 95;
export const RIGGER_MIN_HOURS = 4;
/** The crane's OWN road permit, by class. */
export const CRANE_ROAD_PERMIT_SMALL_USD = 52.45;
export const CRANE_ROAD_PERMIT_LARGE_USD = 125;
export const CRANE_ROAD_PERMIT_HIGH_USD = 275;
/** Capacity above which the crane's own road permit stops being the cheap one. */
export const CRANE_LARGE_PERMIT_TONS = 60;

/**
 * THE REFUSAL THRESHOLD, SET EXACTLY WHERE THE EVIDENCE RUNS OUT.
 *
 * At 2–3× a 160,000 lb piece implies a 160–240 t machine: the edge of the
 * published curve, and past the point where the same rate card stops offering
 * bare rental at all (">90 t: call for availability"). Above it the crane
 * travels disassembled on multiple trailers, needs an engineered lift plan, and
 * mobilisation exceeds the pick — and mobilisation for disassembled cranes is
 * precisely the figure that could not be sourced anywhere except AI-generated
 * content farms.
 */
export const CRANE_REFUSAL_CARGO_LBS = 160_000;
/** Above this the range widens and the site-access prompt goes up front. */
export const CRANE_WIDE_BAND_CARGO_LBS = 80_000;

export const CRANE_BAND_PCT_NORMAL = 35;
export const CRANE_BAND_PCT_WIDE = 55;

/** The 65th-percentile bias. Applies to components that ALWAYS apply. */
export const HEADLINE_PERCENTILE = 0.65;

export function headlineOf(low: number, high: number, percentile = HEADLINE_PERCENTILE): number {
  return round2(low + percentile * (high - low));
}

/** Regional multiplier on the crane curve. DERIVED, low-medium confidence. */
export type CraneRegion = 'texasSouth' | 'midwestMountain' | 'northeastMetro';
export const CRANE_REGION_MULTIPLIERS: Readonly<Record<CraneRegion, number>> = {
  texasSouth: 1.0,
  midwestMountain: 1.1,
  northeastMetro: 1.2,
};

/**
 * Crane region from a state code. The rate card is a Texas market, so the South
 * Central and South East states are 1.00 by construction.
 */
const NORTHEAST_METRO = new Set([
  'NY', 'NJ', 'CT', 'MA', 'RI', 'NH', 'VT', 'ME', 'PA', 'MD', 'DE', 'DC', 'CA', 'WA', 'OR',
]);
const TEXAS_SOUTH = new Set([
  'TX', 'OK', 'LA', 'AR', 'MS', 'AL', 'GA', 'FL', 'SC', 'NC', 'TN', 'NM',
]);

export function craneRegionForState(stateCode: string | null): CraneRegion {
  if (!stateCode) return 'midwestMountain';
  const code = stateCode.toUpperCase();
  if (NORTHEAST_METRO.has(code)) return 'northeastMetro';
  if (TEXAS_SOUTH.has(code)) return 'texasSouth';
  return 'midwestMountain';
}

export interface CraneInput {
  /** The weight of the PIECE being lifted, not the permit gross. */
  cargoWeightLbs: number;
  /** Which end of the lane, for the line's name. */
  end: 'origin' | 'destination';
  stateCode: string | null;
  /** True when the cargo weight was inferred from a gross rather than given. */
  cargoWeightDerived: boolean;
}

export const CRANE_REFUSAL_ADVICE =
  'What unblocks a real number is a twenty-minute site survey by any local crane company — usually free with a quote request. Tell them the piece weight, the pick radius and whether anything is overhead.';

/**
 * Price loading at one end of the lane, or refuse.
 *
 * Returns THREE lines when it prices — the machine, the rigging crew and the
 * crane's own road permit — because they are three different qualities of
 * evidence and averaging them into one would hide that the crew rate is the
 * best-evidenced figure in the group.
 */
export function priceLoading(input: CraneInput): AccessorialLine[] {
  const where = input.end === 'origin' ? 'at pickup' : 'at delivery';
  const region = craneRegionForState(input.stateCode);
  const regionMult = CRANE_REGION_MULTIPLIERS[region];
  const capLowT = (input.cargoWeightLbs * CRANE_CAPACITY_LOW_MULT) / 2000;
  const capHighT = (input.cargoWeightLbs * CRANE_CAPACITY_HIGH_MULT) / 2000;

  if (input.cargoWeightLbs > CRANE_REFUSAL_CARGO_LBS) {
    const floorRate = craneRateUsdPerHour(CRANE_REFUSAL_CARGO_LBS * 2 / 2000) * regionMult;
    const floor = round2(floorRate * CRANE_MIN_HOURS_LARGE * (1 + CRANE_FUEL_SURCHARGE));
    return [
      {
        code: `loading_${input.end}`,
        name: `Crane and rigging ${where}`,
        headlineUsd: null,
        lowUsd: null,
        highUsd: null,
        inTotal: false,
        accuracy: rate({
          tier: 'refused',
          hover: `Above ${CRANE_REFUSAL_CARGO_LBS.toLocaleString()} lb we will not put a number on the lift. From about $${Math.round(floor).toLocaleString()}, but the real driver is a lift plan we cannot write from a weight.`,
          detail: `A ${input.cargoWeightLbs.toLocaleString()} lb piece implies a ${Math.round(capLowT)}–${Math.round(capHighT)} ton machine at the 2–3× sizing rule. That is the edge of the only published operated rate card found, and past the point where the same card stops offering bare rental at all. Above it the crane travels disassembled on several trailers, needs an engineered lift plan, and mobilisation exceeds the pick — and no defensible published mobilisation figure for a disassembled crane exists; every numeric range for it came from algorithmically generated price-content sites, which is worse than no number. There is published precedent for stopping here: the same filed tariff that prices tarping by dimension prints SPOT BID above 14 ft wide. ${CRANE_REFUSAL_ADVICE}`,
          marketSources: [SRC_NORTH_TEXAS_CRANE, SRC_ACE_DORAN_TARIFF],
        }),
      },
    ];
  }

  const wide = input.cargoWeightLbs > CRANE_WIDE_BAND_CARGO_LBS;
  const bandPct = wide ? CRANE_BAND_PCT_WIDE : CRANE_BAND_PCT_NORMAL;
  const rateLow = craneRateUsdPerHour(capLowT) * regionMult;
  const rateHigh = craneRateUsdPerHour(capHighT) * regionMult;
  const minHours = capLowT <= 30 ? CRANE_MIN_HOURS_SMALL : CRANE_MIN_HOURS_LARGE;
  const hoursLow = Math.max(minHours, CRANE_MIN_HOURS_LARGE);

  const craneLow = round2(rateLow * hoursLow * (1 + CRANE_FUEL_SURCHARGE));
  const craneHigh = round2(rateHigh * CRANE_HOURS_HIGH * (1 + CRANE_FUEL_SURCHARGE));

  const riggerLow = round2(RIGGER_USD_PER_HOUR * regionMult * RIGGER_MIN_HOURS);
  const riggerHigh = round2(RIGGER_USD_PER_HOUR * regionMult * CRANE_HOURS_HIGH * 2);

  const permitLow = round2(
    (capLowT > CRANE_LARGE_PERMIT_TONS
      ? CRANE_ROAD_PERMIT_LARGE_USD
      : CRANE_ROAD_PERMIT_SMALL_USD) * regionMult,
  );
  const permitHigh = round2(CRANE_ROAD_PERMIT_HIGH_USD * regionMult);

  const derivedWeightCaveat = input.cargoWeightDerived
    ? ' The piece weight itself was inferred from the permit gross you entered rather than given, so this is a derivation on top of a derivation — enter the cargo weight to firm it up.'
    : '';

  const sizingDetail = `Sizing: a crane is not rated to the load's weight. Rated capacity is quoted at a radius and falls off steeply as the boom reaches out, the rigging is part of the load, and picks are planned at 75–85% of chart capacity. So a ${input.cargoWeightLbs.toLocaleString()} lb piece needs a ${Math.round(capLowT)}–${Math.round(capHighT)} ton machine — 2.0× with the best access, 3.0× typically, and 4–6× with a long radius or overhead obstructions. THE 2–3× RULE IS OURS: no association, manufacturer or agency document publishes a weight-to-capacity heuristic. Hours are portal to portal, so the travel is billed both ways, and a single-item pick almost never bills under the four-hour minimum.${derivedWeightCaveat}`;

  return [
    {
      code: `loading_crane_${input.end}`,
      name: `Crane ${where} (${Math.round(capLowT)}–${Math.round(capHighT)} t class, ${hoursLow}–${CRANE_HOURS_HIGH} h portal to portal)`,
      headlineUsd: headlineOf(craneLow, craneHigh),
      lowUsd: craneLow,
      highUsd: craneHigh,
      inTotal: true,
      accuracy: rate({
        tier: 'benchmark',
        bandPct,
        lowUsd: craneLow,
        highUsd: craneHigh,
        asOf: '2025-01-01',
        sample: `One published 2025 operated rate card, 14 capacity classes, cross-checked against FEMA's 2025 bare-equipment schedule and a California prevailing-wage determination${regionMult === 1 ? '' : `; regional uplift ×${regionMult.toFixed(2)} is ours`}`,
        hover: `From a published 2025 operated crane rate card, cross-checked against two government schedules. The range is driven by site access, which we haven’t asked about.`,
        detail: `${sizingDetail} Rate: a published 2025 operated hourly curve (23–275 t) from a single Dallas–Fort Worth operator — the only complete operated rate card retrievable, which is the biggest single-source risk here. Two independent government schedules act as sanity rails: FEMA's bare rates with the operator explicitly excluded, and California's legally binding prevailing wage, which puts a fully burdened crane craftsman at $94–$100/hr and lands on top of the card's own $95/hr rigger rate from a different direction.${regionMult === 1 ? ' No regional adjustment: the card is this market.' : ` Regional uplift of ×${regionMult.toFixed(2)} is OURS and is the weakest joint in the crane model.`} Includes the card's published 7% fuel surcharge. Excludes standby, any Sunday or holiday premium (+$85/hr), a second pick, and mobilisation for any machine that travels disassembled. Three questions collapse this range faster than anything else: how far the crane can set up from the item, whether the ground is paved, and whether anything is overhead.`,
        marketSources: [SRC_NORTH_TEXAS_CRANE, SRC_FEMA_EQUIPMENT_RATES, SRC_CA_PREVAILING_WAGE],
      }),
    },
    {
      code: `loading_rigging_${input.end}`,
      name: `Rigger / signal person ${where}`,
      headlineUsd: headlineOf(riggerLow, riggerHigh),
      lowUsd: riggerLow,
      highUsd: riggerHigh,
      inTotal: true,
      accuracy: rate({
        tier: 'benchmark',
        bandPct: 30,
        lowUsd: riggerLow,
        highUsd: riggerHigh,
        asOf: '2025-01-01',
        sample: 'A published operator rate card ($95/hr, 4 hr minimum) and a legally binding California prevailing-wage determination ($94.08–$100.08/hr fully burdened)',
        hover:
          'A rigger or signal person at $95/hr with a four-hour minimum. Two independent sources — a Texas rate card and a California wage determination — agree within a few dollars.',
        detail: `A crane is quoted with an operator; the rigger or signal person is separate and is billed at $${RIGGER_USD_PER_HOUR}/hr with a ${RIGGER_MIN_HOURS}-hour minimum. This is the best-corroborated labour figure in the whole accessorial model: a commercial Texas rate card and California's legally binding prevailing-wage determination, which is inclusive of employer payments, land within about five dollars of each other by completely different routes. The low end is one rigger at the minimum; the high end is two riggers for a full day. Excludes overtime (before 07:00, after 17:00 and all weekend) and any Sunday or holiday premium.`,
        marketSources: [SRC_NORTH_TEXAS_CRANE, SRC_CA_PREVAILING_WAGE],
      }),
    },
    {
      code: `loading_crane_permit_${input.end}`,
      name: `Crane's own road permit ${where}`,
      headlineUsd: headlineOf(permitLow, permitHigh),
      lowUsd: permitLow,
      highUsd: permitHigh,
      inTotal: true,
      accuracy: rate({
        tier: 'benchmark',
        bandPct: 40,
        lowUsd: permitLow,
        highUsd: permitHigh,
        asOf: '2025-01-01',
        sample: 'One published 2025 rate card, $52.45–$275 by crane class',
        hover:
          'The crane needs its own oversize permit to reach your site. $52.45–$275 by class on the published rate card.',
        detail: `A mobile crane is itself an oversize vehicle and travels on its own permit, which the operator bills through. The published card gives $${CRANE_ROAD_PERMIT_SMALL_USD}–$${CRANE_ROAD_PERMIT_HIGH_USD} by class; the card's minimum and permit columns are misaligned in the source PDF, so these are reported as a BAND rather than mapped to a specific capacity — a per-row mapping is not readable from the document with confidence. This is separate from, and additional to, the state OS/OW permits your own load needs.`,
        marketSources: [SRC_NORTH_TEXAS_CRANE],
      }),
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// DETENTION — axle-scaled, and the number shippers are most blindsided by
// ═══════════════════════════════════════════════════════════════════════════

/** Free time at EACH end. Confirmed across three independent tariffs. */
export const DETENTION_FREE_HOURS = 2;
export const DETENTION_BASE_USD_PER_HOUR = 150;

/** Per-axle adder per hour, by axle band. Ace Doran Item 200. */
export function detentionPerAxleUsd(axles: number): number {
  if (axles <= 5) return 0;
  if (axles <= 10) return 25;
  if (axles <= 14) return 35;
  return 40;
}

/** Detention $/hr after free time, for a configuration. */
export function detentionUsdPerHour(axles: number): number {
  const perAxle = detentionPerAxleUsd(axles);
  return round2(DETENTION_BASE_USD_PER_HOUR + (perAxle === 0 ? 0 : axles * perAxle));
}

export function detentionRiskLine(axles: number): AccessorialLine {
  const perHour = detentionUsdPerHour(axles);
  return {
    code: 'risk_detention',
    name: `Detention after ${DETENTION_FREE_HOURS} free hours (${axles}-axle configuration)`,
    headlineUsd: perHour,
    lowUsd: round2(perHour * 0.85),
    highUsd: round2(perHour * 1.15),
    inTotal: false,
    accuracy: rate({
      tier: 'benchmark',
      bandPct: 15,
      lowUsd: round2(perHour * 0.85),
      highUsd: round2(perHour * 1.15),
      asOf: '2024-12-02',
      sample: 'Three independent carrier tariffs, one of them a US government trucking tariff; the axle scaling comes from a heavy-haul carrier’s filed schedule dated 2024-12-02',
      hover: `About $${perHour.toFixed(0)}/hr after two free hours at each end, from a filed carrier tariff — one carrier’s published schedule, not a statute. Heavy-haul detention scales by axle count.`,
      detail: `A filed carrier tariff prices detention at $${DETENTION_BASE_USD_PER_HOUR}/hr flat up to five axles and then adds $25/hr per axle at 6–10 axles, $35 at 11–14 and $40 above 14. A ${axles}-axle rig is therefore $${perHour.toFixed(0)} an hour — against the $50–$100 a shipper carries in their head from van freight. Two hours free at each end is effectively an industry constant, confirmed in three independent tariffs; a government tariff sets $135/hr flat on a five-axle van basis and two other carrier tariffs give $150/hr and $220/hr. Free time excludes 17:00–06:00 and weekends unless the appointment falls in that window. NOT INCLUDED IN THE TOTAL, because the hours cannot be predicted — but four hours at a slow receiver is $${round2(perHour * 4).toLocaleString()}, which is usually more than every other accessorial on this quote combined.`,
      marketSources: [SRC_ACE_DORAN_TARIFF, SRC_FEMA_URT, SRC_GLEN_RAVEN_TARIFF],
    }),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// LAYOVER
// ═══════════════════════════════════════════════════════════════════════════

/** $130/man + $176/vehicle from a 2016 tariff; uplifted for 2026. */
export const LAYOVER_LOW_USD = 400;
export const LAYOVER_HIGH_USD = 550;

export function layoverRiskLine(): AccessorialLine {
  return {
    code: 'risk_layover',
    name: 'Layover, per additional night',
    headlineUsd: headlineOf(LAYOVER_LOW_USD, LAYOVER_HIGH_USD, 0.5),
    lowUsd: LAYOVER_LOW_USD,
    highUsd: LAYOVER_HIGH_USD,
    inTotal: false,
    accuracy: rate({
      tier: 'benchmark',
      bandPct: 25,
      lowUsd: LAYOVER_LOW_USD,
      highUsd: LAYOVER_HIGH_USD,
      asOf: '2016-07-10',
      sample: 'One carrier tariff naming the oversize trigger ($306/night) and one government tariff setting the ceiling ($550/day)',
      hover:
        '$400–$550 a night for an ADDED night, from filed carrier tariffs — published schedules, not a statute. Routine daylight-only oversize transit is already inside the line haul.',
      detail: `One carrier tariff names the cause directly: a layover applies where the carrier must lay over between sun-down and sun-up BECAUSE OF oversize or overweight shipments, at $130 per man plus $176 per vehicle per night, weekends and holidays included — $306. A US government trucking tariff caps layover at $550 per vehicle per day, which is the right upper bound. The carrier tariff is ten years old, so its low end understates 2026 and the band here starts at $400 instead of $306; that uplift is ours. DOUBLE-COUNTING HERE IS AN EASY AND EXPENSIVE MISTAKE: curfew-driven overnight stops on a normal oversize run are already priced inside the line haul, so this is only for ADDED nights.`,
      marketSources: [SRC_GLEN_RAVEN_TARIFF, SRC_FEMA_URT],
    }),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// TARPING — off by default, and it refuses above the tariff's own threshold
// ═══════════════════════════════════════════════════════════════════════════

export const TARP_SPOT_BID_WIDTH_IN = 14 * 12;
export const TARP_SPOT_BID_HEIGHT_IN = 12 * 12;

/** Ace Doran Item 440, dimension-driven. */
export function tarpingUsd(widthIn: number | undefined, heightIn: number | undefined): number | null {
  const w = widthIn ?? 0;
  const h = heightIn ?? 0;
  if (w > TARP_SPOT_BID_WIDTH_IN || h > TARP_SPOT_BID_HEIGHT_IN) return null;
  if (w > 11.5 * 12 || h > 10 * 12 + 4) return 315;
  if (w > 8.5 * 12 || h > 8 * 12 + 4) return 225;
  return 150;
}

export function tarpingLine(
  widthIn: number | undefined,
  heightIn: number | undefined,
): AccessorialLine {
  const amount = tarpingUsd(widthIn, heightIn);
  if (amount === null) {
    return {
      code: 'tarping',
      name: 'Tarping',
      headlineUsd: null,
      lowUsd: null,
      highUsd: null,
      inTotal: false,
      accuracy: rate({
        tier: 'refused',
        hover:
          'Over 14 ft wide or 12 ft high the filed tariff itself stops quoting and prints SPOT BID. So do we.',
        detail:
          'The published dimension table runs to 14 ft wide and 12 ft high and then says SPOT BID. That is a carrier with a filed tariff and decades of lane data declining to publish a number above a threshold, and it is the precedent for every refusal in this engine. In practice most loads this size ship untarped anyway — tarping an oversize load is frequently impossible and aerodynamically dangerous.',
        marketSources: [SRC_ACE_DORAN_TARIFF],
      }),
    };
  }
  return {
    code: 'tarping',
    name: 'Tarping',
    headlineUsd: amount,
    lowUsd: round2(amount * 0.8),
    highUsd: round2(amount * 1.2),
    inTotal: true,
    accuracy: rate({
      tier: 'benchmark',
      bandPct: 20,
      lowUsd: round2(amount * 0.8),
      highUsd: round2(amount * 1.2),
      asOf: '2024-12-02',
      sample: 'One heavy-haul carrier’s filed tariff, dated 2024-12-02, priced across seven dimension steps',
      hover:
        'From a filed carrier tariff — one carrier’s published schedule, not a statute, so another carrier tarps at another price. Most oversize freight ships untarped, so this is off unless you ask.',
      detail:
        'A BENCHMARK, not a cited fee, and the difference matters: a state permit fee binds whoever hauls your load, while this is what ONE carrier published in its filed tariff. It is strong evidence — dated, pinpoint-citable, and far better than a broker’s marketing page — but another carrier will quote another number, and you have not picked a carrier yet. That tariff prices tarping by dimension: $150 at legal width or under 8 ft 4 in high, $225 at 8 ft 6 in – 11 ft 6 in wide or 8 ft 4 in – 10 ft 4 in high, $315 at 11 ft 6 in – 14 ft wide or 10 ft 4 in – 12 ft high, and SPOT BID above that. Untarping and retarping at a stop-off is 90% of the original charge each time. The same tariff makes tarping shipper-requested and disclaims weather-damage liability when no tarp is asked for — which is why this is opt-in rather than a default.',
      marketSources: [SRC_ACE_DORAN_TARIFF],
    }),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SECUREMENT — an allowance, and labelled as one
// ═══════════════════════════════════════════════════════════════════════════

export const SECUREMENT_LOW_USD = 150;
export const SECUREMENT_HIGH_USD = 600;

/**
 * OFF BY DEFAULT IN THE COMPOSER, AND THAT IS NOT CAUTION.
 *
 * The research this is built from says securement is NORMALLY INSIDE the
 * heavy-haul line haul when the carrier supplies the trailer — and the line haul
 * this engine now quotes IS that rate. Adding $150 to every quote for something
 * already inside the number on the row above is double-counting, the same
 * mistake `layoverRiskLine` warns about for curfew nights.
 *
 * Recorded here rather than only in a pull request, because the research reads
 * as though it wants this on and the reason it must not be is one step further
 * along than anything the research says. Turn it on for a load that needs a
 * built cradle; do not turn it on by default.
 */
export function securementLine(): AccessorialLine {
  // A CONDITIONAL component: likelihood-weighted, not 65th-percentile. Biasing a
  // may-not-apply item upward would inflate every quote on the site.
  return {
    code: 'securement',
    name: 'Securement / cribbing allowance',
    headlineUsd: SECUREMENT_LOW_USD,
    lowUsd: SECUREMENT_LOW_USD,
    highUsd: SECUREMENT_HIGH_USD,
    inTotal: true,
    accuracy: rate({
      tier: 'benchmark',
      bandPct: 60,
      lowUsd: SECUREMENT_LOW_USD,
      highUsd: SECUREMENT_HIGH_USD,
      asOf: '2024-12-02',
      sample: 'Two filed tariffs on responsibility and labour rates; no source anywhere publishes a per-load securement price',
      hover:
        'An ALLOWANCE, not a price. Securement is normally inside the heavy-haul rate when the carrier supplies the trailer; this covers cribbing or a built cradle.',
      detail:
        'The weakest-evidenced line in this engine, and it is presented as an allowance for that reason. What IS published: bracing and blocking is the consignor’s responsibility at the consignor’s expense; carrier-supplied assist personnel with no equipment are $50/hr per person with a three-hour minimum; and carrier extra labour portal-to-portal is $168/hr for the first three hours — a figure that appears identically in two independent tariffs, which makes it real. What is NOT published anywhere is a per-load securement or dunnage price. Retail chain and binder prices exist and converting them into a per-load charge would be invention, so the headline sits at the bottom of the band rather than in the middle.',
      marketSources: [SRC_ACE_DORAN_TARIFF, SRC_GLEN_RAVEN_TARIFF],
    }),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PERMIT SERVICE MARGIN — the agent's fee ON TOP OF the state fee
// ═══════════════════════════════════════════════════════════════════════════

export const PERMIT_SERVICE_LOW_USD = 30;
export const PERMIT_SERVICE_DEFAULT_USD = 55;
export const PERMIT_SERVICE_HIGH_USD = 85;

export function permitServiceLine(permitCount: number): AccessorialLine | null {
  if (permitCount <= 0) return null;
  const low = round2(PERMIT_SERVICE_LOW_USD * permitCount);
  const high = round2(PERMIT_SERVICE_HIGH_USD * permitCount);
  return {
    code: 'permit_service_fee',
    name: `Permit service fee (${permitCount} permit${permitCount === 1 ? '' : 's'})`,
    headlineUsd: round2(PERMIT_SERVICE_DEFAULT_USD * permitCount),
    lowUsd: low,
    highUsd: high,
    inTotal: true,
    accuracy: rate({
      tier: 'benchmark',
      bandPct: 45,
      lowUsd: low,
      highUsd: high,
      asOf: '2026-01-01',
      sample: 'Two published permit-service fee schedules, one effective 2026-01-01, plus a carrier tariff’s own per-permit procurement charge',
      hover:
        'The agent’s fee ON TOP OF the state fee already shown above. Published schedules run $24 to $82.50 a permit depending on how full-service the agent is.',
      detail:
        'This is NOT a state fee and is never added to the permit total — it is what a permit service charges to file for you, on top of the statutory fee this quote already cites. One published schedule effective 2026-01-01 gives $72.50 for an oversize permit, $82.50 for overweight, $90.50 for a superload and $30 per "assist" (an add-to-state, an insurance update, a route survey). A second independent schedule gives $24–$30 standard and $60 for a superload. The spread is 3× and it is real, so this is modelled as $30–$85 per permit with a $55 default rather than as a point. Excludes the 5% credit-card surcharge both schedules publish, cancellations and revisions ($24–$30), and any state surcharge where the state fee itself exceeds $150.',
      marketSources: [SRC_PERMIT_SERVICE_FEES, SRC_ACE_DORAN_TARIFF],
    }),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ROUTE SURVEY / ENGINEERING — only when a state trips a superload threshold
// ═══════════════════════════════════════════════════════════════════════════

export const ROUTE_SURVEY_FLAT_LOW_USD = 100;
export const ROUTE_SURVEY_FLAT_HIGH_USD = 500;
export const ROUTE_SURVEY_HOURLY_USD = 40;
export const ROUTE_SURVEY_HOURS_LOW = 4;
export const ROUTE_SURVEY_HOURS_HIGH = 12;
export const ROUTE_SURVEY_ASSIST_USD = 30;

export function routeSurveyLine(superloadStates: readonly string[]): AccessorialLine | null {
  if (superloadStates.length === 0) return null;
  const n = superloadStates.length;
  const low = round2(n * ROUTE_SURVEY_FLAT_LOW_USD);
  const high = round2(n * Math.max(ROUTE_SURVEY_FLAT_HIGH_USD, ROUTE_SURVEY_HOURLY_USD * ROUTE_SURVEY_HOURS_HIGH) + n * ROUTE_SURVEY_ASSIST_USD);
  return {
    code: 'route_survey',
    name: `Route survey / engineering review (${superloadStates.join(', ')})`,
    // CONDITIONAL: likelihood-weighted at the midpoint, not biased to the 65th.
    headlineUsd: headlineOf(low, high, 0.5),
    lowUsd: low,
    highUsd: high,
    inTotal: true,
    accuracy: rate({
      tier: 'benchmark',
      bandPct: 70,
      lowUsd: low,
      highUsd: high,
      asOf: null,
      sample: 'Two state fee architectures actually read (Texas flat $500, Illinois $40/hr) out of the 21 that could impose one',
      hover:
        'Only applies because a state on this lane treats your load as a superload. Some states charge a flat review fee, others bill hourly, many publish nothing.',
      detail:
        'Two different fee ARCHITECTURES were found and a single national constant would be wrong for one of them. Texas charges a flat $500 for its review of an outside engineer\'s report, plus $375 highway maintenance, plus $100 for a route crossing no bridges, and takes three to four weeks unless an approved route is already on file. Illinois bills engineering review, field investigation and pavement analysis at $40/hr. A permit agent adds $30 per route-survey assist. THE GENUINE GAP is the per-state trigger table — the thresholds and fees for the other nineteen states that can impose one were not collected, so this line fires on the states our own permit engine already flags as superload and no others. A physical, drive-the-route survey has no published rate anywhere and is deliberately left unpriced.',
      marketSources: [SRC_TXDMV_SUPERHEAVY, SRC_IL_ENGINEERING_REVIEW, SRC_PERMIT_SERVICE_FEES],
    }),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXCESS-VALUE COVER — one optional question turns a guess into arithmetic
// ═══════════════════════════════════════════════════════════════════════════

export const INCLUDED_CARGO_LIMIT_USD = 100_000;
export const EXCESS_VALUE_LOW_RATE = 0.5; // per $100
export const EXCESS_VALUE_CENTRAL_RATE = 0.75;
export const EXCESS_VALUE_HIGH_RATE = 1.9;

export function excessValueLine(declaredValueUsd: number | undefined): AccessorialLine | null {
  if (declaredValueUsd === undefined || declaredValueUsd <= INCLUDED_CARGO_LIMIT_USD) return null;
  const excess = declaredValueUsd - INCLUDED_CARGO_LIMIT_USD;
  const units = excess / 100;
  const low = round2(units * EXCESS_VALUE_LOW_RATE);
  const high = round2(units * EXCESS_VALUE_HIGH_RATE);
  return {
    code: 'excess_value_cover',
    name: `Excess-value cargo cover ($${Math.round(excess).toLocaleString()} above the standard limit)`,
    headlineUsd: round2(units * EXCESS_VALUE_CENTRAL_RATE),
    lowUsd: low,
    highUsd: high,
    inTotal: true,
    accuracy: rate({
      tier: 'benchmark',
      bandPct: 50,
      lowUsd: low,
      highUsd: high,
      asOf: '2026-01-01',
      sample: 'Two 2026 cargo-insurance rate guides: $0.50–$1.25 per $100 third-party, $1.05–$1.90 per $100 as a carrier declared-value fee',
      hover:
        'Charged per $100 of value above the carrier’s standard cargo limit, which is commonly $100,000 — well below the machinery this tool quotes.',
      detail:
        'Standard carrier cargo limits sit at $100,000–$250,000, far below the value of the machinery on a heavy-haul trailer, so the excess layer is bought per shipment. Third-party cover runs $0.50–$1.25 per $100 of coverage; buying it from the carrier as a declared-value fee runs $1.05–$1.90 per $100 and is materially more expensive. The $100,000 included limit assumed here is our default, not your carrier’s — check the certificate. This is the single most expensive thing a heavy-haul quote can omit: on a $500,000 machine the excess layer is around $3,000, more than tarping, securement and permit service fees combined. Also worth knowing: carrier liability for DELAY damages is separately capped, commonly at $200 per shipment unless a guaranteed time is bought.',
      marketSources: [SRC_CARGO_INSURANCE, SRC_ACE_DORAN_TARIFF],
    }),
  };
}
