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
 * 4. REFUSE ABOVE 200,000 LB. That is exactly where the evidence stops — see
 *    `CRANE_REFUSAL_CARGO_LBS`. There is published precedent for refusing: Ace
 *    Doran quotes tarping by dimension and then prints SPOT BID above 14 ft
 *    wide. A carrier with a filed tariff and decades of lane data declines to
 *    publish a number above a threshold; us doing the same is not a product
 *    failure.
 *
 * ── WHAT THE SECOND RESEARCH PASS CHANGED, AND WHAT IT DID NOT ────────────
 *
 * The crane model used to rest on ONE Dallas–Fort Worth rate card. Seven more
 * published operated cards across six markets, a two-bidder county tabulation
 * and a pair of Davis-Bacon determinations have since been read. The result is
 * unusual and worth recording plainly:
 *
 *   THE CURVE SURVIVED. The DFW card sits at, or 2–20% above, the pooled median
 *   in every capacity band — a slightly conservative-high spine, which is the
 *   safe direction. It is not replaced; it is corroborated.
 *
 *   THE FLOOR DID NOT. The minimum-hours ladder is published as 3 → 4 → 6 → 8
 *   → 10 hours by capacity in five cards, against the flat 3/4 modelled before.
 *   At 100–120 t that under-billed the floor by roughly 2×, and on a quote where
 *   loading is the second-largest line that matters more than the hourly rate.
 *
 *   TWO REGIONAL ROWS HAD THE WRONG SIGN. The axis is metro density, not
 *   compass: Charleston 0.91× and Missoula 0.91× sit BELOW Texas, where the old
 *   table put the Southeast at 1.00× and the Mountain states at 1.05–1.15×.
 *
 *   BARE HIRE IS NOT A PRODUCT. A county solicited a complete bare column at
 *   four capacities and four durations; both bidders entered "No Bid" on all
 *   sixteen lines while bidding the entire operated column. One card says
 *   "operated only" outright. Nothing here may ever imply bare is a cheaper
 *   option a shipper could take.
 *
 *   THE 2–3× WEIGHT→CAPACITY MULTIPLIER IS UNTOUCHED — and is now, unambiguously,
 *   the largest remaining uncertainty in the crane line. Nothing found bears on
 *   it. See `CRANE_CAPACITY_LOW_MULT`.
 */
import {
  SRC_ACE_DORAN_TARIFF,
  SRC_ALLEGANY_CRANE_BID,
  SRC_CARGO_INSURANCE,
  SRC_CA_PREVAILING_WAGE,
  SRC_CFR_393_TIEDOWNS,
  SRC_CRANE_OPERATOR_CARDS,
  SRC_DAVIS_BACON_CRANE_WAGE,
  SRC_ESCORT_OPERATOR_SHEETS,
  SRC_FEMA_EQUIPMENT_RATES,
  SRC_FEMA_URT,
  SRC_GLEN_RAVEN_TARIFF,
  SRC_IL_ENGINEERING_REVIEW,
  SRC_MODOT_ANALYSIS_FEES,
  SRC_NORTH_TEXAS_CRANE,
  SRC_ODFL_TARIFF,
  SRC_PERMIT_SERVICE_FEES,
  SRC_ROUTE_SURVEY_PRACTICES,
  SRC_STATE_ANALYSIS_FEE_SCHEDULES,
  SRC_TXDMV_SUPERHEAVY,
  SRC_UTILITY_CLEARANCE_TESTIMONY,
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
 * A 2025 rate card from a Dallas–Fort Worth operator, AND IT NO LONGER STANDS
 * ALONE. Seven further published operated cards across six US markets — SC, MT,
 * IL (×2), VA, CA, MI — pool into a distribution, and this card sits AT or 2–20%
 * ABOVE the pooled median in every capacity band: at median at 23–25 t, +2.5% at
 * 40 t, +5–16% at 50–60 t, +13–20% at 75–80 t, +3–12% at 100–110 t, +8% at 210 t
 * and +2% at 275 t. That makes it a slightly conservative-high spine, which is
 * the safe direction for a quote, so IT IS KEPT UNCHANGED rather than re-fitted
 * to the median. The single-source risk that used to be stated here is broken.
 *
 * Two independent government schedules remain sanity rails rather than the
 * basis: FEMA's bare rates (operator excluded) and California's legally binding
 * prevailing wage for a crane operator, which puts a fully burdened craftsman at
 * $94–$100/hr — landing on top of this sheet's own $95/hr rigger rate from a
 * completely different direction.
 *
 * THE CURVE FLATTENS HARD ABOVE 165 t and `craneRateUsdPerHour` must reflect
 * that rather than extrapolating the slope below it. Across three cards the
 * operated hourly rate moves $440 → $595 from 165 t to 350 t: +35% of price for
 * +112% of capacity, against +60–90% for the same doubling under 100 t. Big-crane
 * cost lives in MINIMUM HOURS, assembly and mobilisation, not in the hour.
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

/**
 * Hourly rate for a nominal capacity, interpolated between published classes.
 *
 * ABOVE THE TOP OF THE CURVE THIS HOLDS FLAT AND DOES NOT EXTRAPOLATE, and that
 * is now evidenced rather than merely cautious: a second card prices a 350 t
 * machine at $575/hr — BELOW this card's 275 t figure of $595. Continuing the
 * sub-100 t slope past 275 t would invent a rise the market does not charge.
 * Holding the last published point is both flat and conservative-high.
 */
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
 *
 * PROMOTED TO THE TOP OF THE UNCERTAINTY LIST. The second research pass broke
 * the single-source risk on the rate, published the minimum-hours ladder and
 * evidenced the regional multiplier — every other joint in the crane model got
 * firmer. Nothing it found touches this one. Eight operator cards, a county bid
 * tabulation, four government schedules and two wage determinations later, no
 * association, manufacturer or agency still publishes a weight-to-capacity
 * heuristic. The dominant residual uncertainty in a crane quote is no longer the
 * price of a crane; it is WHICH crane the site requires, and the three access
 * questions (setup distance, ground condition, overhead obstructions) are worth
 * more than any further rate research.
 */
export const CRANE_CAPACITY_LOW_MULT = 2.0;
export const CRANE_CAPACITY_HIGH_MULT = 3.0;

/**
 * THE MINIMUM-HOURS LADDER — PUBLISHED, five cards, and it is the real floor.
 *
 * The model used to carry a flat "3 hr up to 30 t, 4 hr above", read off one
 * card whose minimum column is misaligned in the source PDF. Five further cards
 * publish minimums cleanly and they agree on a LADDER: 3 hr to 30 t, 4 hr to
 * 80 t, 6 hr to 100 t, 8 hr to 250 t, 10 hr above. The observed minimum CHARGE
 * confirms it from the other side — $265–$580 at ≤25 t, $520–$900 at 35–45 t,
 * $1,420–$3,600 at 100–120 t, $3,520–$3,760 at 175–210 t, $5,750 at 350 t.
 *
 * At 100–120 t the old flat 4 hr under-billed the floor by roughly 2×. On a
 * quote where loading is the largest accessorial that is a bigger error than
 * anything in the hourly rate, and correcting it raises the mid-size quote —
 * the direction the evidence supports and the safe direction to be wrong in.
 */
export const CRANE_MIN_HOURS_SMALL = 3;
export const CRANE_MIN_HOURS_LARGE = 4;
export const CRANE_MIN_HOURS_LADDER: ReadonlyArray<{ upToTons: number; hours: number }> = [
  { upToTons: 30, hours: 3 },
  { upToTons: 80, hours: 4 },
  { upToTons: 100, hours: 6 },
  { upToTons: 250, hours: 8 },
];
export const CRANE_MIN_HOURS_TOP = 10;

/** Published minimum billable hours for a capacity class. Portal to portal. */
export function craneMinHours(capacityTons: number): number {
  for (const step of CRANE_MIN_HOURS_LADDER) {
    if (capacityTons <= step.upToTons) return step.hours;
  }
  return CRANE_MIN_HOURS_TOP;
}

export const CRANE_HOURS_HIGH = 8;
/** 7% of invoice, published on the rate card. A second card publishes 8%. */
export const CRANE_FUEL_SURCHARGE = 0.07;
/**
 * Rigger / signal person, 4 hr minimum.
 *
 * FIVE sources now, four of them commercial, spanning TX / SC / VA / CT / CA:
 * $95/hr (TX card), $88/hr (SC card), $85/hr (VA card, NCCCO-certified), $70/hr
 * weekday with a $95/hr foreman (a Connecticut university's rigging contract),
 * and $94–$100/hr fully burdened (California's binding prevailing wage). The
 * central value across them is nearer $90; $95 is kept because it is the top of
 * the commercial band and under-quoting is the dangerous direction here.
 */
export const RIGGER_USD_PER_HOUR = 95;
export const RIGGER_MIN_HOURS = 4;
/**
 * AT 100 t AND ABOVE THE CREW IS TWO WAGE UNITS, NOT ONE.
 *
 * One card prices its 100 t and 175 t machines as "full dress with oiler" and
 * itemises the oiler as a distinct crew member; the smaller machines on the same
 * card carry none. A quote that adds a single rigger to a 100 t pick is a body
 * short, so the crew count steps here.
 */
export const CRANE_OILER_TONS = 100;
/** The crane's OWN road permit, by class. */
export const CRANE_ROAD_PERMIT_SMALL_USD = 52.45;
export const CRANE_ROAD_PERMIT_LARGE_USD = 125;
export const CRANE_ROAD_PERMIT_HIGH_USD = 275;
/** Capacity above which the crane's own road permit stops being the cheap one. */
export const CRANE_LARGE_PERMIT_TONS = 60;

/**
 * THE REFUSAL THRESHOLD, SET EXACTLY WHERE THE EVIDENCE RUNS OUT — AND IT MOVED.
 *
 * The wall used to stand at 160,000 lb, because the crane hour was published to
 * 275 t by one card and mobilisation for a disassembled machine was published by
 * nobody. The second research pass split those two halves apart and only one of
 * them moved:
 *
 *   THE CRANE HOUR IS NOW PUBLISHED TO 350 t by three commercial cards, and to
 *   400 t by two public bidders. It is also nearly FLAT across that whole range
 *   ($440–$595/hr), which makes interpolation between the points low-risk. A
 *   160,000–200,000 lb piece implies a 160–300 t machine, and we can quote the
 *   machine and crew for one: at an 8–10 hour published minimum that is a floor
 *   of roughly $3,500–$6,000 — MOBILISATION EXCLUDED, and the line says so.
 *
 *   MOBILISATION FOR A MACHINE THAT TRAVELS DISASSEMBLED IS STILL UNPUBLISHED,
 *   and that is now a VALIDATED refusal rather than an open gap. It was probed
 *   from three directions — operator rate cards, public procurement, and two
 *   operators' own articles written about exactly this question — and neither
 *   article states a single dollar figure. Every numeric range that surfaced for
 *   it traces to the AI-generated price-content sites this engine excludes on
 *   sight. One card publishes the TRIGGER (a set-up/break-down fee begins at
 *   ~90 t) and puts the amount behind a sign-in. So above 200,000 lb, where
 *   mobilisation dominates the pick, the refusal stands.
 */
export const CRANE_REFUSAL_CARGO_LBS = 200_000;
/**
 * Between this and the refusal we quote the machine and crew as a range and say
 * plainly that assembly and multi-trailer mobilisation are NOT in it.
 */
export const CRANE_MOB_EXCLUDED_CARGO_LBS = 160_000;
/** Above this the range widens and the site-access prompt goes up front. */
export const CRANE_WIDE_BAND_CARGO_LBS = 80_000;

/**
 * THE BAND NARROWS ONLY WHERE THE REGION IS KNOWN — never nationally.
 *
 * Within a capacity band the observed min-to-max spread across eight cards is
 * 1.7×–2.3× at ≤125 t. A symmetric ±35% implies a max/min of 2.08×, so ±35% is
 * not too wide NATIONALLY — it is almost exactly the observed full range of
 * published US operator prices at the same tonnage. Any tighter national claim
 * is not looking at the same eight cards.
 *
 * But that full range is dominated by WHICH MARKET you are in, and the middle
 * half of it lies within about ±13% of the median (p25→p75 is −7%/+13% at
 * 26–45 t, −2%/+5% at 46–65 t, 0%/+13% at 66–85 t, −10%/+13% at 86–125 t,
 * ±8% at 181–250 t). Now that `CRANE_REGION_MULTIPLIERS` MODELS the market
 * instead of absorbing it into the band, a job whose state we know can carry
 * ±25% — the interquartile spread plus residual site-access risk. A job whose
 * state we do not know is still exposed to the full 0.85×–1.30× market spread
 * and keeps ±35%.
 */
export const CRANE_BAND_PCT_REGION_KNOWN = 25;
export const CRANE_BAND_PCT_NORMAL = 35;
/**
 * 80,000–160,000 lb: ±55% → ±40%. n = 11 rates across 6 sources in the 86–125 t
 * band with an interquartile spread of ±13%, so the price is far better known
 * than ±55% claimed. What is left is genuine site-access risk — radius, ground
 * bearing, overhead — which is a SITE unknown rather than a PRICE unknown, and
 * ±40% is where the evidence puts it.
 */
export const CRANE_BAND_PCT_WIDE = 40;
/** 160,000–200,000 lb: the hour is published and flat, mobilisation is not. */
export const CRANE_BAND_PCT_MOB_EXCLUDED = 45;

/** The 65th-percentile bias. Applies to components that ALWAYS apply. */
export const HEADLINE_PERCENTILE = 0.65;

export function headlineOf(low: number, high: number, percentile = HEADLINE_PERCENTILE): number {
  return round2(low + percentile * (high - low));
}

/**
 * REGIONAL MULTIPLIER — was "the weakest joint in the crane model", is now
 * PUBLISHED for four of its five priced rows. And TWO OF THE OLD ROWS HAD THE
 * WRONG SIGN.
 *
 * Each of the seven new cards was indexed against the DFW curve, interpolated to
 * the same tonnage:
 *
 *     Sacramento CA   1.26×  (range 1.09–1.71×, 4 points)
 *     Chicago IL      1.14× and 1.18×          (2 cards)
 *     Dallas–Ft Worth 1.00×  — the spine
 *     Charleston SC   0.91×  (0.82–1.19×, 15 points)
 *     Missoula MT     0.91×  (0.79–1.09×, 8 points)
 *     Michigan        0.88× nominal, ≈1.00× escalated from 2020
 *     Richmond VA     0.67× nominal, ≈0.76× escalated from 2021
 *
 * THE AXIS IS METRO DENSITY AND PREVAILING WAGE, NOT COMPASS — which is why the
 * old compass table was wrong in the Southeast (modelled 1.00×, measured 0.91×
 * and below) and in the Mountain states (modelled 1.05–1.15×, measured 0.91×,
 * i.e. BELOW Texas rather than above it).
 *
 * A completely independent line of evidence agrees. Two Davis-Bacon highway
 * determinations, same classification, same state, same date: a crane operator
 * in Denver and Douglas Counties is $50.98 fully burdened against $32.91 in
 * non-metro Colorado — 1.55× inside one state. California's binding
 * determination is $94–$100/hr, 1.85–1.96× the Denver metro figure. Labour is
 * 25–30% of a large operated rate and 40–60% of a small one, so a 1.9× wage
 * spread predicts roughly 1.15–1.30× on the rate at large capacity and more at
 * small — which is exactly the shape of the Sacramento card (1.71× at 22 t
 * decaying to 1.09–1.27× at 75–115 t). Two methods, one answer.
 *
 * WHAT THIS TABLE CANNOT DO. It keys on a STATE because a state is what a lane
 * gives us, and a state is only a proxy for the market a crane dispatches from.
 * The Colorado pair measures the residual directly: 1.55× between a metro and a
 * non-metro site inside one row. That residual is the largest single thing the
 * ±band on the crane line is carrying, and it is named in the line's detail
 * copy rather than hidden.
 *
 * The Northeast row is the ONE genuinely unevidenced cell left: no commercial
 * Northeast card was found, and the only Northeast document is an on-call county
 * contract at 1.9–2.5× the commercial cards, which is a different product. Its
 * only support is the wage argument, so it stays DERIVED and is labelled so.
 */
export type CraneRegion =
  | 'southeast'
  | 'texasSouthCentral'
  | 'mountainPlains'
  | 'midwestMetro'
  | 'westCoastMetro'
  | 'northeastMetro';

export const CRANE_REGION_MULTIPLIERS: Readonly<Record<CraneRegion, number>> = {
  /** PUBLISHED — Charleston SC 0.91×, Richmond VA 0.76× escalated. Band 0.85–0.95×. */
  southeast: 0.9,
  /** PUBLISHED — the DFW card is this market, by construction. */
  texasSouthCentral: 1.0,
  /** PUBLISHED — Missoula MT 0.91×. Below Texas, which the old table had backwards. */
  mountainPlains: 0.91,
  /** PUBLISHED — Chicago 1.14× and 1.18×. Band 1.10–1.20×. */
  midwestMetro: 1.15,
  /** PUBLISHED card (Sacramento 1.26×) + a binding CA wage determination. Band 1.15–1.30×. */
  westCoastMetro: 1.22,
  /** DERIVED — the wage argument only. No commercial Northeast rate card exists. */
  northeastMetro: 1.22,
};

/** The one row with no commercial card behind it. Named, not buried. */
export const CRANE_REGION_DERIVED: ReadonlyArray<CraneRegion> = ['northeastMetro'];

const SOUTHEAST = new Set(['AL', 'FL', 'GA', 'KY', 'MS', 'NC', 'SC', 'TN', 'VA', 'WV']);
const TEXAS_SOUTH_CENTRAL = new Set(['TX', 'OK', 'LA', 'AR', 'NM']);
const MOUNTAIN_PLAINS = new Set([
  'AK', 'AZ', 'CO', 'IA', 'ID', 'KS', 'MT', 'ND', 'NE', 'NV', 'SD', 'UT', 'WY',
]);
const MIDWEST_METRO = new Set(['IL', 'IN', 'MI', 'MN', 'MO', 'OH', 'WI']);
const WEST_COAST_METRO = new Set(['CA', 'HI', 'OR', 'WA']);
const NORTHEAST_METRO = new Set([
  'CT', 'DC', 'DE', 'MA', 'MD', 'ME', 'NH', 'NJ', 'NY', 'PA', 'RI', 'VT',
]);

/**
 * Crane region from a state code.
 *
 * WITH NO STATE THIS FALLS BACK TO THE SPINE'S OWN MARKET AT 1.00× — not to a
 * middle row. The old code guessed 'midwestMountain' (1.10×) for an unknown
 * state, which silently applied a 10% uplift nobody had evidence for. An unknown
 * market gets the reference market and the WIDE national band; see
 * `CRANE_BAND_PCT_NORMAL`, which is the honest place to carry that ignorance.
 */
export function craneRegionForState(stateCode: string | null): CraneRegion {
  if (!stateCode) return 'texasSouthCentral';
  const code = stateCode.toUpperCase();
  if (SOUTHEAST.has(code)) return 'southeast';
  if (TEXAS_SOUTH_CENTRAL.has(code)) return 'texasSouthCentral';
  if (MOUNTAIN_PLAINS.has(code)) return 'mountainPlains';
  if (MIDWEST_METRO.has(code)) return 'midwestMetro';
  if (WEST_COAST_METRO.has(code)) return 'westCoastMetro';
  if (NORTHEAST_METRO.has(code)) return 'northeastMetro';
  return 'texasSouthCentral';
}

/**
 * BARE HIRE IS NOT A CHEAPER OPTION AND MUST NEVER BE OFFERED AS ONE.
 *
 * Held as a constant because it is a MODEL RULE, not a note: every crane figure
 * this file produces is an OPERATED rate, and the 3–6× gap between an amortised
 * bare monthly and an operated hour is not the operator's wage.
 *
 * A county solicited a complete bare column — 100 t, 150 t, 300 t and 400 t ×
 * hour / day / week / month, sixteen line items — and BOTH bidders entered
 * "No Bid" on every one of them while bidding the entire operated column. One
 * card states "operated only" outright across a 12–350 t fleet. The DFW card
 * offers bare monthly and only to 90 t. Bare is a monthly, self-insured,
 * self-hauled arrangement for contractors who already employ certified
 * operators; it is not available on the hourly, dispatch-on-demand basis a
 * shipper needs to load one item.
 */
export const CRANE_BARE_HIRE_NOTE =
  'Crane figures here are OPERATED rates and there is no cheaper bare option to switch to. Bare hire is a monthly, self-insured, self-hauled product for contractors who employ their own certified operators: when a county put a full bare column out to bid at four capacities and four durations, both bidders declined all sixteen lines while bidding the entire operated column, and one operator publishes "operated only" across its whole 12–350 ton fleet. The gap between an amortised bare monthly and an operated hour is 3–6×, and what it buys is dispatch on demand, portal-to-portal travel, the operator and often an oiler, their certification, and the company carrying the insurance and maintenance liability for a 3-to-10-hour job instead of a month.';

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
  const regionKnown = input.stateCode !== null && input.stateCode !== '';
  const region = craneRegionForState(input.stateCode);
  const regionMult = CRANE_REGION_MULTIPLIERS[region];
  const regionDerived = CRANE_REGION_DERIVED.includes(region);
  const capLowT = (input.cargoWeightLbs * CRANE_CAPACITY_LOW_MULT) / 2000;
  const capHighT = (input.cargoWeightLbs * CRANE_CAPACITY_HIGH_MULT) / 2000;

  if (input.cargoWeightLbs > CRANE_REFUSAL_CARGO_LBS) {
    const refusalCapT = (CRANE_REFUSAL_CARGO_LBS * CRANE_CAPACITY_LOW_MULT) / 2000;
    const floorRate = craneRateUsdPerHour(refusalCapT) * regionMult;
    const floor = round2(floorRate * craneMinHours(refusalCapT) * (1 + CRANE_FUEL_SURCHARGE));
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
          hover: `Above ${CRANE_REFUSAL_CARGO_LBS.toLocaleString()} lb we will not put a number on the lift. From about $${Math.round(floor).toLocaleString()} for the machine and crew, but what we cannot price is getting it there in pieces.`,
          detail: `A ${input.cargoWeightLbs.toLocaleString()} lb piece implies a ${Math.round(capLowT)}–${Math.round(capHighT)} ton machine at the 2–3× sizing rule. THE HONEST SENTENCE IS THAT WE CAN QUOTE THE CRANE AND CANNOT QUOTE GETTING IT THERE. The operated hour is now published to 350 tons by three independent operator rate cards and priced to 400 tons by two bidders on a public contract, so the machine itself is no longer the unknown. Assembly and multi-trailer mobilisation are: above roughly 90 tons a discrete set-up and break-down fee begins — one card publishes that threshold and puts the amount behind a sign-in — and no operator publishes the figure. It was looked for three ways, including two operators' own published articles asking exactly this question, and neither states a dollar. Every numeric range that surfaced for it traces to algorithmically generated price-content sites, which is worse than no number. Above ${CRANE_REFUSAL_CARGO_LBS.toLocaleString()} lb that unpriced half is the larger half, so this is where the estimate stops. There is published precedent for stopping: the same filed tariff that prices tarping by dimension prints SPOT BID above 14 ft wide. ${CRANE_BARE_HIRE_NOTE} ${CRANE_REFUSAL_ADVICE}`,
          marketSources: [
            SRC_NORTH_TEXAS_CRANE,
            SRC_CRANE_OPERATOR_CARDS,
            SRC_ALLEGANY_CRANE_BID,
            SRC_ACE_DORAN_TARIFF,
          ],
        }),
      },
    ];
  }

  // Three regimes below the refusal, and the band is the only thing that says
  // which one you are in — so it is set from the evidence, not from caution.
  const mobExcluded = input.cargoWeightLbs > CRANE_MOB_EXCLUDED_CARGO_LBS;
  const wide = input.cargoWeightLbs > CRANE_WIDE_BAND_CARGO_LBS;
  const bandPct = mobExcluded
    ? CRANE_BAND_PCT_MOB_EXCLUDED
    : wide
      ? CRANE_BAND_PCT_WIDE
      : regionKnown
        ? CRANE_BAND_PCT_REGION_KNOWN
        : CRANE_BAND_PCT_NORMAL;

  const rateLow = craneRateUsdPerHour(capLowT) * regionMult;
  const rateHigh = craneRateUsdPerHour(capHighT) * regionMult;
  // THE PUBLISHED LADDER SETS THE FLOOR, and above 100 t it also sets the top:
  // a 350 t machine has a 10-hour minimum, which is longer than the 8-hour day
  // this model used to treat as the high case.
  const hoursLow = craneMinHours(capLowT);
  const hoursHigh = Math.max(CRANE_HOURS_HIGH, craneMinHours(capHighT));

  const craneLow = round2(rateLow * hoursLow * (1 + CRANE_FUEL_SURCHARGE));
  const craneHigh = round2(rateHigh * hoursHigh * (1 + CRANE_FUEL_SURCHARGE));

  // At 100 t and above the card carries an OILER as a second wage unit, so the
  // crew steps from one body to two at the minimum and from two to three on a
  // full day. A single rigger on a 100 t pick is a body short.
  const oiler = capLowT >= CRANE_OILER_TONS;
  const crewLow = oiler ? 2 : 1;
  const crewHigh = capHighT >= CRANE_OILER_TONS ? 3 : 2;
  const riggerLow = round2(RIGGER_USD_PER_HOUR * regionMult * RIGGER_MIN_HOURS * crewLow);
  const riggerHigh = round2(RIGGER_USD_PER_HOUR * regionMult * hoursHigh * crewHigh);

  const permitLow = round2(
    (capLowT > CRANE_LARGE_PERMIT_TONS
      ? CRANE_ROAD_PERMIT_LARGE_USD
      : CRANE_ROAD_PERMIT_SMALL_USD) * regionMult,
  );
  const permitHigh = round2(CRANE_ROAD_PERMIT_HIGH_USD * regionMult);

  const derivedWeightCaveat = input.cargoWeightDerived
    ? ' The piece weight itself was inferred from the permit gross you entered rather than given, so this is a derivation on top of a derivation — enter the cargo weight to firm it up.'
    : '';

  const hoursLabel = hoursLow === hoursHigh ? `${hoursLow} h` : `${hoursLow}–${hoursHigh} h`;

  const sizingDetail = `Sizing: a crane is not rated to the load's weight. Rated capacity is quoted at a radius and falls off steeply as the boom reaches out, the rigging is part of the load, and picks are planned at 75–85% of chart capacity. So a ${input.cargoWeightLbs.toLocaleString()} lb piece needs a ${Math.round(capLowT)}–${Math.round(capHighT)} ton machine — 2.0× with the best access, 3.0× typically, and 4–6× with a long radius or overhead obstructions. THE 2–3× RULE IS OURS AND IT IS NOW THE LARGEST REMAINING UNCERTAINTY IN THIS LINE: eight operator rate cards, a county bid tabulation and four government schedules later, no association, manufacturer or agency publishes a weight-to-capacity heuristic. Hours are portal to portal, so travel is billed both ways, and the ${hoursLow}-hour figure here is a PUBLISHED MINIMUM for this class, not an estimate of how long the pick takes.${derivedWeightCaveat}`;

  const regionSentence = regionKnown
    ? regionDerived
      ? ` Regional factor ×${regionMult.toFixed(2)} for this market is DERIVED — it is the one row in the table with no commercial rate card behind it, supported only by the wage argument.`
      : region === 'texasSouthCentral'
        ? ' No regional adjustment: the spine card is this market.'
        : ` Regional factor ×${regionMult.toFixed(2)} for this market is PUBLISHED — it is measured from operator cards in that market indexed against the spine, and corroborated by wage determinations.`
    : ' No state was given for this end, so no regional factor is applied and the band stays at its full national width — published US operator prices for the same tonnage span 0.85× to 1.30× depending on the market.';

  const mobSentence = mobExcluded
    ? ` ASSEMBLY AND MULTI-TRAILER MOBILISATION ARE NOT IN THIS FIGURE AND ARE NOT PRICED ANYWHERE. Above roughly 90 tons a discrete set-up and break-down fee begins; the threshold is published and the amount is not. What this line gives you is the machine and crew from about $${Math.round(craneLow + riggerLow).toLocaleString()} at the published minimum — a floor, not a total — and a site survey and lift plan are required before it becomes a price.`
    : '';

  const marketResidual =
    ' The regional factor keys on the STATE, which is only a proxy for the market a crane dispatches from: two Davis-Bacon determinations for the same classification, in one state, on one date, put a Denver-metro crane operator at 1.55× a non-metro Colorado one. That metro-versus-rural gap inside a single state is the largest single thing this band is carrying.';

  return [
    {
      code: `loading_crane_${input.end}`,
      name: `Crane ${where} (${Math.round(capLowT)}–${Math.round(capHighT)} t class, ${hoursLabel} portal to portal)`,
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
        sample: `Eight published operated crane rate cards across six US markets, 12–350 t, pooled; the 2025 Dallas–Fort Worth card is the spine and sits 0–20% above the pooled median in every band. Cross-checked against FEMA's bare-equipment schedule, a California prevailing-wage determination and two Davis-Bacon determinations${regionKnown && regionMult !== 1 ? `; regional factor ×${regionMult.toFixed(2)}` : ''}`,
        hover: mobExcluded
          ? `Machine and crew from a pooled set of published operated rate cards. Assembly and multi-trailer mobilisation are NOT included and nobody publishes them — this is a floor, not a total.`
          : `From eight published operated crane rate cards across six US markets. The range is driven by site access, which we haven’t asked about.`,
        detail: `${sizingDetail} Rate: an operated hourly curve (23–275 t) from a 2025 Dallas–Fort Worth card, kept as the spine because seven further published cards across six markets put it at, or 2–20% above, their pooled median at every capacity — a slightly conservative-high line, which is the safe direction. Above 165 t the curve is nearly flat ($440–$595/hr from 165 t to 350 t, +35% of price for +112% of capacity), so big-crane cost lives in the minimum hours and the mobilisation rather than in the hour. Two independent government schedules act as sanity rails: FEMA's bare rates with the operator explicitly excluded, and California's legally binding prevailing wage, which puts a fully burdened crane craftsman at $94–$100/hr and lands on top of the card's own $95/hr rigger rate from a different direction.${regionSentence}${marketResidual} Includes the card's published 7% fuel surcharge (a second card publishes 8%). Excludes standby, any Sunday or holiday premium (+$85/hr), weekend work — four cards disagree by a factor of eight on the FORM of the weekend uplift, so it is disclosed rather than modelled — and a second pick.${mobSentence} ${CRANE_BARE_HIRE_NOTE} Three questions collapse this range faster than anything else: how far the crane can set up from the item, whether the ground is paved, and whether anything is overhead.`,
        marketSources: [
          SRC_NORTH_TEXAS_CRANE,
          SRC_CRANE_OPERATOR_CARDS,
          SRC_DAVIS_BACON_CRANE_WAGE,
          SRC_FEMA_EQUIPMENT_RATES,
          SRC_CA_PREVAILING_WAGE,
        ],
      }),
    },
    {
      code: `loading_rigging_${input.end}`,
      name: oiler
        ? `Rigging crew ${where} (rigger + oiler at this capacity)`
        : `Rigger / signal person ${where}`,
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
        sample: 'Five independent sources for the hourly rate — four commercial cards in TX, SC, VA and CT at $70–$95/hr and a legally binding California prevailing-wage determination at $94.08–$100.08/hr fully burdened. The line’s own width is crew size and hours, not the rate',
        hover: oiler
          ? 'At this capacity the crew is two wage units, not one: an operator’s card carries an oiler alongside the rigger on its 100-ton machines. $95/hr each, four-hour minimum.'
          : 'A rigger or signal person at $95/hr with a four-hour minimum. Five independent sources — four operator cards and a binding wage determination — put the rate at $85–$100.',
        detail: `A crane is quoted with an operator; the rigger or signal person is separate and is billed at $${RIGGER_USD_PER_HOUR}/hr with a ${RIGGER_MIN_HOURS}-hour minimum. THE RATE IS THE BEST-CORROBORATED LABOUR FIGURE IN THIS ENGINE — five independent sources, four of them commercial, spanning Texas, South Carolina, Virginia, Connecticut and California: $95, $88, $85 and $70 an hour on operator and contract schedules, against $94–$100 fully burdened on California's binding prevailing-wage determination. That is a ±10% spread on the rate itself. $${RIGGER_USD_PER_HOUR} is the top of the commercial band and is kept deliberately, because under-quoting is the dangerous direction; the central value across the five is nearer $90.${
          oiler
            ? ' AT THIS CAPACITY THE CREW IS TWO BODIES, NOT ONE. One card prices its 100-ton and 175-ton machines as "full dress with oiler" and itemises the oiler separately, while the smaller machines on the same card carry none — so a quote that adds a single rigger to a pick this size is a body short. The low end here is a rigger and an oiler at the minimum; the high end is two riggers and an oiler for the shift.'
            : ' The low end is one rigger at the minimum; the high end is two riggers for a full day.'
        } THE WIDTH OF THIS LINE IS CREW SIZE AND HOURS, NOT UNCERTAINTY ABOUT THE RATE — which is why the band did not narrow when the rate got five sources. Excludes overtime (before 07:00, after 17:00 and all weekend) and any Sunday or holiday premium.`,
        marketSources: [
          SRC_NORTH_TEXAS_CRANE,
          SRC_CRANE_OPERATOR_CARDS,
          SRC_CA_PREVAILING_WAGE,
        ],
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
        sample: 'Two published rate cards — $52.45–$275 by crane class on one, a flat $20 permit charge on any crane 70 t and up on the other',
        hover:
          'The crane needs its own oversize permit to reach your site. $52.45–$275 by class on the published rate card.',
        detail: `A mobile crane is itself an oversize vehicle and travels on its own permit, which the operator bills through. The spine card gives $${CRANE_ROAD_PERMIT_SMALL_USD}–$${CRANE_ROAD_PERMIT_HIGH_USD} by class; its minimum and permit columns are misaligned in the source PDF, so these are reported as a BAND rather than mapped to a specific capacity — a per-row mapping is not readable from the document with confidence. A second card handles the same thing as a flat $20 administrative charge on any crane of 70 tons and up, which is a different architecture at a much lower level, so the band here is the conservative one of the two. This is separate from, and additional to, the state OS/OW permits your own load needs.`,
        marketSources: [SRC_NORTH_TEXAS_CRANE, SRC_CRANE_OPERATOR_CARDS],
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

/**
 * THE CHAIN COUNT COMES FROM A FEDERAL RULE. THE DOLLARS DO NOT.
 *
 * 49 CFR 393.106(d): "the aggregate working load limit of tiedowns used to
 * secure an article ... must be at least one-half times the weight of the
 * article". A tiedown running anchor-to-anchor — which is how heavy equipment is
 * chained — contributes HALF its working load limit to that aggregate, so with
 * 3/8" Grade 70 transport chain at a 6,600 lb WLL the arithmetic collapses to
 * `ceil(cargo_weight / 6,600)`. 393.110 sets a competing minimum by article
 * length: one tiedown up to 5 ft and 1,100 lb, two to 10 ft, and one more per
 * additional 10 ft.
 *
 * ABOVE ROUGHLY 33,000 LB THE WEIGHT RULE ALWAYS GOVERNS and the count grows
 * strictly linearly with weight. That crossover is the useful finding: securement
 * effort is a WEIGHT story on everything this tool quotes, not a length story.
 */
export const SECUREMENT_CHAIN_WLL_LBS = 6600;

export function securementChainCount(cargoWeightLbs: number, lengthIn?: number): number {
  const byWeight = Math.ceil(Math.max(0, cargoWeightLbs) / SECUREMENT_CHAIN_WLL_LBS);
  const lengthFt = lengthIn === undefined ? 0 : lengthIn / 12;
  let byLength: number;
  if (lengthFt <= 0) byLength = 0;
  else if (lengthFt <= 5) byLength = cargoWeightLbs <= 1100 ? 1 : 2;
  else if (lengthFt <= 10) byLength = 2;
  else byLength = 2 + Math.ceil((lengthFt - 10) / 10);
  return Math.max(1, byWeight, byLength);
}

/** The consumable-dunnage band, PER REQUIRED CHAIN. DERIVED, and low confidence. */
export const SECUREMENT_USD_PER_CHAIN_LOW = 25;
export const SECUREMENT_USD_PER_CHAIN_HIGH = 60;

/**
 * OFF BY DEFAULT IN THE COMPOSER, AND THAT IS NOT CAUTION.
 *
 * The research this is built from says securement is NORMALLY INSIDE the
 * heavy-haul line haul when the carrier supplies the trailer — and the line haul
 * this engine now quotes IS that rate. Adding an allowance to every quote for
 * something already inside the number on the row above is double-counting, the
 * same mistake `layoverRiskLine` warns about for curfew nights.
 *
 * Recorded here rather than only in a pull request, because the research reads
 * as though it wants this on and the reason it must not be is one step further
 * along than anything the research says. Turn it on for a load that needs a
 * built cradle; do not turn it on by default.
 *
 * ── WHY THE ±60% BAND DID NOT NARROW, AND WHY THAT IS NOW A RESULT ────────
 *
 * Every other wide band in this file narrowed on the second research pass. This
 * one deliberately did not, and the difference is that "nobody publishes it"
 * stopped being an absence of evidence and became evidence of absence:
 *
 *   FOUR filed carrier tariffs — including a dedicated heavy-haul carrier —
 *   assign blocking and bracing to the consignor at the consignor's expense and
 *   price none of it. (One convention observed four times, not four independent
 *   price observations; counted accordingly.)
 *
 *   A BINDING GOVERNMENT TARIFF that enumerates accessorials exhaustively
 *   contains none. FEMA's Uniform Rules Tariff caps a liftgate at $100, a
 *   forklift at $400 and a dual driver at $350, sets detention and layover
 *   ceilings, and DEFINES DUNNAGE IN ITS GLOSSARY — then never prices it. A
 *   tariff that thought to cap a liftgate at $100 did not forget securement. It
 *   declined to buy it as a service.
 *
 * So a shipper ticking "securement required" is either buying nothing, because
 * it is in the line haul with the trailer, or being told by the carrier that it
 * is their own job at their own expense. Inventing a price here would be
 * inventing the EXISTENCE OF A MARKET, not just a number. What did change is the
 * DRIVER: the allowance now scales off the federally-required chain count rather
 * than sitting flat, which sharpens the line without pretending to a precision
 * it does not have.
 */
export function securementLine(cargoWeightLbs: number, lengthIn?: number): AccessorialLine {
  const chains = securementChainCount(cargoWeightLbs, lengthIn);
  const low = round2(chains * SECUREMENT_USD_PER_CHAIN_LOW);
  const high = round2(chains * SECUREMENT_USD_PER_CHAIN_HIGH);
  const weightGoverns =
    Math.ceil(Math.max(0, cargoWeightLbs) / SECUREMENT_CHAIN_WLL_LBS) >= chains;
  // A CONDITIONAL component: likelihood-weighted, not 65th-percentile. Biasing a
  // may-not-apply item upward would inflate every quote on the site.
  return {
    code: 'securement',
    name: `Securement / cribbing allowance (${chains} chain${chains === 1 ? '' : 's'} required)`,
    headlineUsd: low,
    lowUsd: low,
    highUsd: high,
    inTotal: true,
    accuracy: rate({
      tier: 'benchmark',
      bandPct: 60,
      lowUsd: low,
      highUsd: high,
      asOf: '2024-12-02',
      sample: 'A federal rule for the chain COUNT (49 CFR 393.106(d) and 393.110); for the price, four filed carrier tariffs that assign it to the consignor unpriced and one binding government tariff that enumerates accessorials down to a $100 liftgate and omits it entirely',
      hover:
        'An ALLOWANCE, not a price. Securement is normally inside the heavy-haul rate when the carrier supplies the trailer; this scales with your load and covers cribbing or a built cradle.',
      detail: `THE COUNT IS A FEDERAL RULE; THE DOLLARS ARE OURS, AND THE LINE SAYS WHICH IS WHICH. 49 CFR 393.106(d) requires the aggregate working load limit of the tiedowns to be at least half the cargo weight, and an anchor-to-anchor tiedown — how heavy equipment is chained — counts for half its own limit. On 3/8" Grade 70 transport chain at a 6,600 lb working load limit that comes to ${chains} chain${chains === 1 ? '' : 's'} for a ${Math.round(cargoWeightLbs).toLocaleString()} lb piece${weightGoverns ? ', with the weight rule governing rather than the length rule — above about 33,000 lb it always does, and the count then grows strictly linearly with weight' : ', with the length rule of 393.110 governing rather than the weight rule at this size'}. THAT IS A QUANTITY OF GEAR, NOT A CHARGE. The chain and binders are carrier capital amortised across hundreds of loads; presenting their retail value as a per-load fee would overstate a 45,000 lb move by about $735. The only genuinely incremental per-load cost is consumable dunnage and cribbing — hardwood cut to cradle one specific machine and then destroyed, left with the load or discarded — and $${SECUREMENT_USD_PER_CHAIN_LOW}–$${SECUREMENT_USD_PER_CHAIN_HIGH} per required chain is OUR scaling device for it, not a market price, which is why the band stays wide and the headline sits at the bottom of it. WHAT IS PUBLISHED, AND IS THE USEFUL PART: bracing and blocking is the consignor's responsibility at the consignor's expense — four independent filed tariffs say so, one of them a heavy-haul specialist — so budget for it on your side of the fence. And if you ask the carrier to do it, the labour IS priced: assist personnel with no equipment at $50/hr per person with a three-hour minimum, or extra labour portal-to-portal at $168/hr for the first three hours, a figure appearing identically in two independent tariffs. A binding government tariff that caps a liftgate at $100, a forklift at $400 and a dual driver at $350, and that defines dunnage in its own glossary, prices no securement at all — which is why this stays an allowance rather than becoming a quote.`,
      marketSources: [
        SRC_CFR_393_TIEDOWNS,
        SRC_ACE_DORAN_TARIFF,
        SRC_GLEN_RAVEN_TARIFF,
        SRC_ODFL_TARIFF,
        SRC_FEMA_URT,
      ],
    }),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PERMIT SERVICE MARGIN — the agent's fee ON TOP OF the state fee
// ═══════════════════════════════════════════════════════════════════════════

/**
 * THE 3× SPREAD WAS TWO PRODUCTS, NOT ONE UNCERTAIN NUMBER — WHICH IS WHY THE
 * BAND MOVES ±45% → ±20%.
 *
 * Re-reading both published schedules in full shows the spread is a SERVICE-TIER
 * difference and each tier is internally tight:
 *
 *     BUDGET       $24–$30 per permit    ±11% around $27
 *     FULL SERVICE $72.50–$90.50         ±11% around $81.50
 *
 * Nothing in the old ±45% was uncertainty WITHIN a tier; almost all of it was
 * the gap BETWEEN tiers. Where the tier is known the band is ±11%; where it is
 * not, ±20% around $55 spanning $27–$82 — and the old $30/$85 edges move to
 * $27/$82, which are the published figures. The $15 that appears in a third
 * source is self-labelled "approximate" and illustrative, and the $150 in the
 * full-service schedule is a >250,000 lb mega-tier; neither is a true edge.
 */
export type PermitServiceTier = 'budget' | 'fullService';

export const PERMIT_SERVICE_LOW_USD = 27;
export const PERMIT_SERVICE_DEFAULT_USD = 55;
export const PERMIT_SERVICE_HIGH_USD = 82;

export const PERMIT_SERVICE_TIERS: Readonly<
  Record<PermitServiceTier, { lowUsd: number; defaultUsd: number; highUsd: number; bandPct: number }>
> = {
  budget: { lowUsd: 24, defaultUsd: 27, highUsd: 30, bandPct: 11 },
  fullService: { lowUsd: 72.5, defaultUsd: 81.5, highUsd: 90.5, bandPct: 11 },
};

export const PERMIT_SERVICE_BAND_PCT_UNKNOWN_TIER = 20;

/**
 * SUPERLOAD UPLIFT IS SMALL, AND SAYING SO IS THE POINT.
 *
 * The budget schedule goes $24–$30 → $60 (about 2.2×) and the full-service one
 * $72.50–$82.50 → $90.50 (about 1.15×). Both charge more; neither charges a lot
 * more. THE STATE'S FEE, NOT THE AGENT'S MARGIN, IS WHAT MAKES A SUPERLOAD
 * EXPENSIVE — which is worth putting on the page, because it is the opposite of
 * what a shipper expects. The two published superload figures are used directly
 * rather than as a multiplier on the standard tier.
 */
export const PERMIT_SERVICE_SUPERLOAD_LOW_USD = 60;
export const PERMIT_SERVICE_SUPERLOAD_HIGH_USD = 90.5;
export const PERMIT_SERVICE_SUPERLOAD_DEFAULT_USD = 75;
export const PERMIT_SERVICE_SUPERLOAD_UPLIFT_BUDGET = 2.2;
export const PERMIT_SERVICE_SUPERLOAD_UPLIFT_FULL_SERVICE = 1.15;

/**
 * A CONSTANT, NOT A BAND. Both independent schedules publish +5% on a card
 * payment, identically — the only figure in this section two unrelated operators
 * state the same way. It is excluded from the total because the payment method
 * is the shipper's and we have not asked; it is named on the line so nobody is
 * surprised by it.
 */
export const PERMIT_SERVICE_CARD_SURCHARGE_PCT = 5;

/** Per "assist" — an add-a-state, an insurance update, ORDERING a route survey. */
export const PERMIT_SERVICE_ASSIST_USD = 30;

/**
 * The state-side surcharge question, ANSWERED AND DELIBERATELY NOT DOUBLE-BILLED.
 *
 * Two states publish a mandatory third-party filing surcharge on their own permit
 * portals, levied on top of the statutory permit fee and even on carriers that
 * are exempt from that fee: New Jersey $12.00 plus a 5% service charge per
 * permit, and Texas $0.25 plus 2.25% of the transaction "as required by state
 * law". Louisiana's is genuinely unknown, and the two states that do publish one
 * chose structurally incompatible schemes, so there is no pattern to extrapolate.
 *
 * NEITHER BELONGS HERE. Both are already encoded as `transactionFee` in the
 * permits engine — New Jersey with the $12 inside the 5% base, reproducing
 * NJDOT's own worked examples of $12.60 and $117.60, and Texas at $0.25 plus
 * 2.25% — so they are already inside the CITED permit total this quote shows
 * above. Adding them again as an agent-side accessorial would bill the shipper
 * twice. This note exists so the next person to read the research does not
 * "close the gap" that is already closed.
 */
export const PERMIT_STATE_SURCHARGE_ALREADY_IN_PERMIT_TOTAL = true;

export function permitServiceLine(
  permitCount: number,
  options?: { tier?: PermitServiceTier; superloadPermitCount?: number },
): AccessorialLine | null {
  if (permitCount <= 0) return null;
  const superloadCount = Math.min(permitCount, Math.max(0, options?.superloadPermitCount ?? 0));
  const standardCount = permitCount - superloadCount;
  const tier = options?.tier;

  const perStandard = tier
    ? PERMIT_SERVICE_TIERS[tier]
    : {
        lowUsd: PERMIT_SERVICE_LOW_USD,
        defaultUsd: PERMIT_SERVICE_DEFAULT_USD,
        highUsd: PERMIT_SERVICE_HIGH_USD,
        bandPct: PERMIT_SERVICE_BAND_PCT_UNKNOWN_TIER,
      };
  const superloadLow = tier === 'fullService'
    ? round2(PERMIT_SERVICE_TIERS.fullService.lowUsd * PERMIT_SERVICE_SUPERLOAD_UPLIFT_FULL_SERVICE)
    : PERMIT_SERVICE_SUPERLOAD_LOW_USD;
  const superloadHigh = tier === 'budget'
    ? round2(PERMIT_SERVICE_TIERS.budget.highUsd * PERMIT_SERVICE_SUPERLOAD_UPLIFT_BUDGET)
    : PERMIT_SERVICE_SUPERLOAD_HIGH_USD;
  const superloadDefault = tier
    ? round2((superloadLow + superloadHigh) / 2)
    : PERMIT_SERVICE_SUPERLOAD_DEFAULT_USD;

  const low = round2(perStandard.lowUsd * standardCount + superloadLow * superloadCount);
  const high = round2(perStandard.highUsd * standardCount + superloadHigh * superloadCount);
  const headline = round2(
    perStandard.defaultUsd * standardCount + superloadDefault * superloadCount,
  );

  return {
    code: 'permit_service_fee',
    name: `Permit service fee (${permitCount} permit${permitCount === 1 ? '' : 's'}${superloadCount > 0 ? `, ${superloadCount} at the superload rate` : ''})`,
    headlineUsd: headline,
    lowUsd: low,
    highUsd: high,
    inTotal: true,
    accuracy: rate({
      tier: 'benchmark',
      bandPct: perStandard.bandPct,
      lowUsd: low,
      highUsd: high,
      asOf: '2026-01-01',
      sample: `Two published permit-service fee schedules read in full, one effective 2026-01-01 — a budget tier at $24–$30 a permit and a full-service tier at $72.50–$90.50, each internally tight to about ±11%${tier ? `; the ${tier === 'budget' ? 'budget' : 'full-service'} tier was declared` : '; the tier was not declared, so the band spans both'}`,
      hover:
        'The agent’s fee ON TOP OF the state fee already shown above. It is two service tiers, not one wide guess: budget agents charge $24–$30 a permit, full-service $72.50–$90.50.',
      detail: `This is NOT a state fee and is never added to the permit total — it is what a permit service charges to file for you, on top of the statutory fee this quote already cites. THE OLD ±45% WAS THE GAP BETWEEN TWO PRODUCTS, NOT UNCERTAINTY ABOUT ONE. Reading both published schedules in full shows a budget tier at $24–$30 a permit and a full-service tier at $72.50 for oversize, $82.50 for overweight and $90.50 for a superload — and each tier is internally tight to about ±11%. Where the tier is not declared this spans them at $${PERMIT_SERVICE_LOW_USD}–$${PERMIT_SERVICE_HIGH_USD} with a $${PERMIT_SERVICE_DEFAULT_USD} default; a $15 figure quoted elsewhere is self-labelled approximate and a $150 one is a mega-tier above 250,000 lb, so neither is a real edge. IT IS PER PERMIT, NOT PER STATE, and a state can require more than one. THE SUPERLOAD UPLIFT IS SMALL — 1.15× full service, 2.2× budget — so it is the STATE's superload fee that makes a superload expensive, not the agent's margin, which is the opposite of what most shippers expect. A card payment adds ${PERMIT_SERVICE_CARD_SURCHARGE_PCT}% on both schedules, identically; that is a constant rather than a band, and it is excluded here only because we have not asked how you will pay. Also excluded: cancellations and revisions ($24–$30), any state surcharge where the state fee itself exceeds $150, and the $${PERMIT_SERVICE_ASSIST_USD} "assist" a permit agent charges to ORDER a route survey — which is coordination, not the survey, and the survey is priced on its own line. Rush and expedite are excluded because neither schedule publishes one: treating expediting as $0 beats guessing it. Two states levy a mandatory surcharge through their own permit portal — New Jersey $12 plus 5% per permit, Texas $0.25 plus 2.25% — and both are already inside the cited permit total above, so they are deliberately not repeated here.`,
      marketSources: [SRC_PERMIT_SERVICE_FEES, SRC_ACE_DORAN_TARIFF],
    }),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ROUTE SURVEY — ONE LINE WAS HOLDING TWO PRODUCTS, WHICH IS WHY IT WAS ±70%
//
// A ROUTE SURVEY is a document the APPLICANT produces and submits: a vehicle
// physically drives the route with a height pole and certifies the clearances.
// States CONSUME it. No state performs one and NO STATE CHARGES FOR ONE.
//
// A BRIDGE / ENGINEERING ANALYSIS is the state's own engineers' work, and every
// state that does it publishes a fee.
//
// Those are different purchases with different payers, different evidence and
// different bands, and averaging them was most of the ±70%. Splitting them also
// RESOLVES A RECORDED GAP RATHER THAN LEAVING IT OPEN: several encoded states
// require a survey and publish no fee for it, and that observation was correct
// but was being read as a search failure. It is structural. Those states will
// never publish a route-survey fee, and waiting for one is waiting for something
// that does not exist.
//
// A third thing was hiding inside the same ±70% and is now pulled out into an
// explicit refusal: UTILITY CLEARANCE. See `utilityClearanceRiskLine`.
// ═══════════════════════════════════════════════════════════════════════════

/** How a state prices its own engineers' analysis. Six architectures, all sourced. */
export type AnalysisFeeArchitecture =
  | 'distanceTiered'
  | 'flat'
  | 'weightTiered'
  | 'perStructure'
  | 'perReview'
  | 'hourly'
  | 'nonePublished'
  | 'unencoded';

export interface StateAnalysisFee {
  jurisdiction: string;
  architecture: AnalysisFeeArchitecture;
  lowUsd: number;
  highUsd: number;
  headlineUsd: number;
  /** ±% for THIS state: exact where the rule is, wide where the COUNT is unknown. */
  bandPct: number;
  note: string;
}

/** Illinois bills engineering review, field investigation and pavement analysis hourly. */
export const ROUTE_SURVEY_HOURLY_USD = 40;
export const ROUTE_SURVEY_HOURS_LOW = 4;
export const ROUTE_SURVEY_HOURS_HIGH = 12;

/**
 * A state whose rule is EXACT — the fee is statutory and keyed to something we
 * already hold (route miles, gross weight, a bridges-crossed flag). Same
 * evidence class as the permit fee itself.
 */
export const ANALYSIS_BAND_PCT_EXACT = 10;
/**
 * A state that publishes a per-unit RATE but not the COUNT of units. The rate is
 * exact; the number of structures, districts or hours is not — and it is
 * bounded, because $8–$20 a structure cannot run away.
 */
export const ANALYSIS_BAND_PCT_PER_UNIT = 40;
/**
 * A superload state whose own schedule has not been read yet. Thirteen of the
 * twenty-one encoded states are still in this class and they keep the old width.
 */
export const ANALYSIS_BAND_PCT_UNENCODED = 70;

/**
 * PUBLISHED STATE ANALYSIS FEES — eight states, six architectures, all primary.
 *
 *   Missouri   DISTANCE-TIERED  $425 (0–50 mi) / $625 (51–200) / $925 (>200),
 *                               above 160,000 lb; +$425 for a re-analysis after
 *                               a dimension change; $265 in a commercial zone;
 *                               escrow before processing. 7 CSR 10-25.020.
 *   Texas      FLAT             $500 to review an outside engineer's report,
 *                               $100 where the route crosses no bridges, $35 per
 *                               additional identical permit within 30 days.
 *   S Carolina WEIGHT-TIERED    $100 >130,000 lb / $200 >200,000 / $350
 *                               >300,000, plus a $100 non-refundable superload
 *                               application fee. Schedule dated 2012-07-01.
 *   Maryland   PER STRUCTURE    $8 per structure analysed, $20 if an
 *                               Administration bridge engineer escorts the first
 *                               move, $12 on subsequent identical moves, plus
 *                               $200/day monitoring. Review valid six months.
 *   Indiana    PER STRUCTURE    $10 per bridge, at 134,000 lb and up.
 *   Wisconsin  PER REVIEW       $10 per district that must review the route,
 *                               $10 per gross-weight review.
 *   Illinois   HOURLY           $40/hr engineering review, field investigation
 *                               and pavement analysis.
 *   Washington NONE PUBLISHED   A complete self-issue fee list containing no
 *                               analysis fee at all. That is NEGATIVE EVIDENCE,
 *                               and it is why a state publishing nothing shows
 *                               $0 rather than an imputed figure.
 *
 * THE REUSE WINDOWS ARE PUBLISHED TOO AND THEY MATTER ON A REPEAT LANE: Maryland
 * six months and $12 a structure thereafter, Missouri one fee on an identical
 * reapplication inside 30 days above 300,000 lb or 60 days below it, Texas $35
 * for an additional identical permit inside 30 days. A second move down the same
 * lane is materially cheaper than the first, and the note says so.
 */
export function stateAnalysisFee(
  jurisdiction: string,
  ctx: { routeMiles?: number; grossWeightLbs?: number; crossesBridges?: boolean },
): StateAnalysisFee {
  const code = jurisdiction.toUpperCase();
  const miles = ctx.routeMiles ?? 0;
  const gross = ctx.grossWeightLbs ?? 0;

  switch (code) {
    case 'MO': {
      const fee = miles > 200 ? 925 : miles > 50 ? 625 : 425;
      return {
        jurisdiction: code,
        architecture: 'distanceTiered',
        lowUsd: fee,
        highUsd: fee,
        headlineUsd: fee,
        bandPct: ANALYSIS_BAND_PCT_EXACT,
        note: `7 CSR 10-25.020 prices the bridge and roadway analysis by TRIP DISTANCE — $425 for 0–50 miles, $625 for 51–200, $925 over 200 — above a 160,000 lb trigger, and requires it in escrow before the application is processed. At ${Math.round(miles).toLocaleString()} route miles that is $${fee}. Changing dimensions or weights after the analysis completes costs a further $425; an identical reapplication is charged once if the original study is under 30 days old above 300,000 lb, or under 60 days below it.`,
      };
    }
    case 'TX':
      return {
        jurisdiction: code,
        architecture: 'flat',
        lowUsd: ctx.crossesBridges === false ? 100 : 100,
        highUsd: ctx.crossesBridges === false ? 100 : 500,
        headlineUsd: ctx.crossesBridges === false ? 100 : 500,
        bandPct: ANALYSIS_BAND_PCT_EXACT,
        note:
          'Texas charges a flat $500 Vehicle Supervision Fee to review an outside engineer\'s report, or $100 where the approved route crosses no bridges — which of the two applies is not settled until the route is, so both edges are shown. Additional identical permits inside 30 days are $35. Separate from the $375 highway maintenance fee and the permit fee itself, and the review takes three to four weeks unless an approved route is already on file.',
      };
    case 'SC': {
      const fee = gross > 300_000 ? 350 : gross > 200_000 ? 200 : gross > 130_000 ? 100 : 0;
      const total = fee > 0 ? fee + 100 : 0;
      return {
        jurisdiction: code,
        architecture: 'weightTiered',
        lowUsd: total,
        highUsd: total,
        headlineUsd: total,
        bandPct: ANALYSIS_BAND_PCT_EXACT,
        note: `SCDOT tiers the engineering analysis by gross weight — $100 above 130,000 lb, $200 above 200,000, $350 above 300,000 — plus a $100 non-refundable superload application fee${fee > 0 ? `, so $${fee} + $100 at this weight` : '; this load is below the analysis trigger'}. The published schedule was last revised 2012-07-01, so it is old enough to have been superseded without the page saying so.`,
      };
    }
    case 'MD':
      return {
        jurisdiction: code,
        architecture: 'perStructure',
        lowUsd: 8,
        highUsd: 200,
        headlineUsd: 80,
        bandPct: ANALYSIS_BAND_PCT_PER_UNIT,
        note:
          'COMAR 11.04.01.08 charges PER STRUCTURE analysed: $8 each, $20 each if an Administration bridge engineer escorts the initial move, $12 each on subsequent identical moves, plus $200 a day if Administration personnel monitor it. The rate is exact and the STRUCTURE COUNT is not — the range here is one structure to ten. The review is valid six months, so a repeat move on the same lane inside that window costs $12 a structure rather than a fresh analysis.',
      };
    case 'IN':
      return {
        jurisdiction: code,
        architecture: 'perStructure',
        lowUsd: 10,
        highUsd: 100,
        headlineUsd: 50,
        bandPct: ANALYSIS_BAND_PCT_PER_UNIT,
        note:
          'INDOT charges $10 per bridge engineering analysis at 134,000 lb and up. The rate is exact and the bridge COUNT is not — the range here is one bridge to ten. Indiana also pre-approves a route for 30 days up to 350,000 lb, and issues no permit at all above that.',
      };
    case 'WI':
      return {
        jurisdiction: code,
        architecture: 'perReview',
        lowUsd: 20,
        highUsd: 60,
        headlineUsd: 40,
        bandPct: ANALYSIS_BAND_PCT_PER_UNIT,
        note:
          'WisDOT form MV2600 charges $10 for each DISTRICT that must review the route for size or weight, and $10 to review gross-weight specifics. The rate is exact and the number of districts a route crosses is not — the range here is one review plus the gross-weight review, up to five districts.',
      };
    case 'IL':
      return {
        jurisdiction: code,
        architecture: 'hourly',
        lowUsd: round2(ROUTE_SURVEY_HOURLY_USD * ROUTE_SURVEY_HOURS_LOW),
        highUsd: round2(ROUTE_SURVEY_HOURLY_USD * ROUTE_SURVEY_HOURS_HIGH),
        headlineUsd: round2(ROUTE_SURVEY_HOURLY_USD * 8),
        bandPct: ANALYSIS_BAND_PCT_PER_UNIT,
        note:
          '92 Ill. Adm. Code 554 bills engineering review, field investigation and pavement analysis at $40 an hour, with the pavement analysis triggered by any single axle over 29,000 lb. The rate is exact and the HOURS are not — four to twelve here.',
      };
    case 'WA':
      return {
        jurisdiction: code,
        architecture: 'nonePublished',
        lowUsd: 0,
        highUsd: 0,
        headlineUsd: 0,
        bandPct: 0,
        note:
          'WSDOT publishes a complete self-issue permit fee list and there is no analysis or survey fee anywhere in it. That is negative evidence from a complete published schedule, not a gap — so this state is shown as $0 rather than having a national average imputed to it.',
      };
    default:
      return {
        jurisdiction: code,
        architecture: 'unencoded',
        lowUsd: 100,
        highUsd: 500,
        headlineUsd: 300,
        bandPct: ANALYSIS_BAND_PCT_UNENCODED,
        note: `${code}'s own analysis fee schedule has not been read. Eight states are now encoded from primary sources in six different architectures — flat, distance-tiered, weight-tiered, per-structure, per-review and hourly — which is exactly why no national constant is applied here: the band for this state stays at its original width until its schedule is read.`,
      };
  }
}

/**
 * THE STATE'S OWN ENGINEERING / BRIDGE ANALYSIS. Fires only where a state on the
 * lane treats the load as a superload.
 *
 * The composite band is the WIDEST contributing state's, not an average: one
 * unread state's schedule re-widens the line, which is the honest behaviour and
 * stops a narrow band being claimed on the strength of the states we did read.
 */
export function stateAnalysisFeeLine(
  superloadStates: readonly string[],
  ctx: { routeMiles?: number; grossWeightLbs?: number; crossesBridges?: boolean } = {},
): AccessorialLine | null {
  if (superloadStates.length === 0) return null;
  const fees = superloadStates.map((s) => stateAnalysisFee(s, ctx));
  const low = round2(fees.reduce((sum, f) => sum + f.lowUsd, 0));
  const high = round2(fees.reduce((sum, f) => sum + f.highUsd, 0));
  const headline = round2(fees.reduce((sum, f) => sum + f.headlineUsd, 0));
  const bandPct = fees.reduce((widest, f) => Math.max(widest, f.bandPct), 0);
  const encoded = fees.filter((f) => f.architecture !== 'unencoded');

  return {
    code: 'route_survey',
    name: `State engineering / bridge analysis (${superloadStates.join(', ')})`,
    // CONDITIONAL: likelihood-weighted at the midpoint, not biased to the 65th.
    headlineUsd: headline,
    lowUsd: low,
    highUsd: high,
    inTotal: true,
    accuracy: rate({
      tier: 'benchmark',
      bandPct,
      lowUsd: low,
      highUsd: high,
      asOf: null,
      sample: `${encoded.length} of ${fees.length} state${fees.length === 1 ? '' : 's'} on this lane priced from its own published schedule; eight states are encoded in six different fee architectures, one of them publishing none at all`,
      hover:
        'This is the STATE’s engineers analysing your route — not a drive-the-route survey, which no state performs or charges for. Only fires where a state treats your load as a superload.',
      detail: `THIS LINE IS THE STATE'S OWN WORK, AND IT IS NOT A ROUTE SURVEY. A route survey is a document you produce and submit — a vehicle drives the route with a height pole and certifies the clearances — and the state consumes it; no state performs one and no state charges for one, which is why several states require a survey and publish no fee. That is structural, not a missing figure. What states DO charge for is their own engineers analysing your route, and eight of them now publish that fee in six different architectures: Missouri by trip distance ($425 / $625 / $925 above 160,000 lb), Texas flat ($500, or $100 where the route crosses no bridges, $35 for a repeat inside 30 days), South Carolina by weight ($100 / $200 / $350 plus a $100 application fee), Maryland per structure ($8, $20 with a bridge engineer escorting, $12 on a repeat, plus $200/day monitoring), Indiana $10 a bridge, Wisconsin $10 per district review, Illinois $40 an hour — and Washington, whose complete published fee list contains none, which is why a state that publishes nothing shows $0 here rather than a national average. A SINGLE NATIONAL CONSTANT WOULD BE WRONG SIX DIFFERENT WAYS. Where the rule is exact the band is ±${ANALYSIS_BAND_PCT_EXACT}%; where the state publishes a per-unit rate but not the count of structures, districts or hours it is ±${ANALYSIS_BAND_PCT_PER_UNIT}%; a state whose schedule has not been read keeps ±${ANALYSIS_BAND_PCT_UNENCODED}%, and the widest state on your lane governs the whole line. REPEAT LANES ARE MUCH CHEAPER and the windows are published: Maryland's review lasts six months and drops to $12 a structure, Missouri charges once for an identical reapplication inside 30 or 60 days by weight, Texas charges $35 for an additional identical permit inside 30 days. ${fees.map((f) => `${f.jurisdiction}: ${f.note}`).join(' ')}`,
      marketSources: [
        SRC_MODOT_ANALYSIS_FEES,
        SRC_TXDMV_SUPERHEAVY,
        SRC_STATE_ANALYSIS_FEE_SCHEDULES,
        SRC_IL_ENGINEERING_REVIEW,
      ],
    }),
  };
}

// ── The physical, drive-the-route survey — height-triggered, escort-priced ──

/**
 * THE TRIGGER IS HEIGHT, NOT WEIGHT — five states key it to 13'11"–14'6".
 *
 * Connecticut over 14'0", Delaware over 14'6", Maryland over 14'6",
 * Pennsylvania over 14'6" (or a superload), New York over 13'11" of height —
 * and New York over 15'11" of width or 99'11" of length as a secondary. New
 * Jersey requires none at all, having replaced it with an electronic clearance
 * override. A model keyed to WEIGHT fires on the wrong loads in both directions;
 * this fires on height, with the superload dimensions as a secondary trigger.
 *
 * The thresholds come from a 2013 multi-state DOT study. The STRUCTURE is
 * certainly still right; the exact heights want re-verifying per state before
 * they drive money, which is why the line reads as a range and says so.
 */
export const ROUTE_SURVEY_HEIGHT_TRIGGER_IN = 13 * 12 + 11;
export const ROUTE_SURVEY_HEIGHT_UPPER_IN = 14 * 12 + 6;
export const ROUTE_SURVEY_SUPERLOAD_WIDTH_IN = 15 * 12 + 11;
export const ROUTE_SURVEY_SUPERLOAD_LENGTH_IN = 99 * 12 + 11;

/**
 * The per-state thresholds, so the line fires on the RIGHT loads.
 *
 * A model keyed to weight fires on the wrong loads in both directions, and so
 * does one keyed to height alone: a Texas-only lane at 14 ft 0 in needs no route
 * survey, because Texas does not require one. This fires only where a state ON
 * THE LANE requires it at the height being moved. New Jersey is carried at
 * `null` deliberately — it requires none at all, having replaced the survey with
 * an electronic clearance-analysis override, and recording that is what stops a
 * later pass from "filling in" a threshold for it.
 */
export const ROUTE_SURVEY_STATE_HEIGHT_IN: Readonly<Record<string, number | null>> = {
  CT: 14 * 12,
  DE: 14 * 12 + 6,
  MD: 14 * 12 + 6,
  NY: 13 * 12 + 11,
  PA: 14 * 12 + 6,
  NJ: null,
};

/** Which states on this lane require a physical route survey at this height. */
export function routeSurveyStates(
  heightIn: number | undefined,
  stateCodes: readonly string[],
): string[] {
  const h = heightIn ?? 0;
  return stateCodes
    .map((c) => c.toUpperCase())
    .filter((c) => {
      const threshold = ROUTE_SURVEY_STATE_HEIGHT_IN[c];
      return typeof threshold === 'number' && h > threshold;
    })
    .filter((c, i, all) => all.indexOf(c) === i);
}

/** High-pole escort $/mi, from the escort research. The survey is one such trip. */
export const HIGH_POLE_USD_PER_MILE_LOW = 1.9;
export const HIGH_POLE_USD_PER_MILE_HIGH = 2.5;
/** Below this the mileage rate stops binding and a local job is billed as a job. */
export const ROUTE_SURVEY_SHORT_FLOOR_USD = 350;
export const ROUTE_SURVEY_BAND_PCT = 35;

/**
 * THE DERIVATION THAT CLOSES A GAP THAT WAS PREVIOUSLY REFUSED.
 *
 * No pilot-car or permit operator prints a price for a route survey. Ten of them
 * list it as a service and none prices it — operators whose cards are detailed
 * enough to quote hourly wait time and hotel-per-night. That is not an oversight
 * and no further searching will fix it.
 *
 * But New York requires the survey to be performed BY A STATE-CERTIFIED ESCORT,
 * which makes it a billable escort trip — one vehicle, one pass — and the
 * high-pole escort rate IS published and is already modelled in this engine.
 * Two independent benchmarks bracket the result across the whole distance range:
 * a pilot-car cost guide puts a 100-mile survey at $200–$500 against $350–$500
 * derived, and a heavy-haul shipper guide puts a long one at $500–$2,000+
 * against $570–$2,000 derived at 300–800 miles.
 *
 * THE SHORT-ROUTE FLOOR IS THE WEAK JOINT AND IS LABELLED AS ONE. A full
 * high-pole DAY rate is $500–$800, which overshoots the $200–$500 short-route
 * benchmark: a short local survey is evidently billed below a full escort day.
 * $350 splits the two and has no direct support. Long routes, where mileage
 * governs, stand on much firmer ground than short ones.
 */
export function physicalRouteSurveyLine(input: {
  heightIn?: number;
  widthIn?: number;
  lengthIn?: number;
  /** The whole lane. Used when no per-state mileage is available. */
  routeMiles: number;
  /** States on the lane. Omit to fall back to the national height trigger. */
  stateCodes?: readonly string[];
  /** Per-state mileage, so the survey is priced over the miles that need one. */
  stateMiles?: ReadonlyArray<{ stateCode: string; miles: number }>;
}): AccessorialLine | null {
  const requiring = input.stateCodes
    ? routeSurveyStates(input.heightIn, input.stateCodes)
    : null;
  const heightTrips = requiring
    ? requiring.length > 0
    : (input.heightIn ?? 0) > ROUTE_SURVEY_HEIGHT_TRIGGER_IN;
  const onLane = (code: string) =>
    !input.stateCodes || input.stateCodes.some((c) => c.toUpperCase() === code);
  const widthTrips = (input.widthIn ?? 0) > ROUTE_SURVEY_SUPERLOAD_WIDTH_IN && onLane('NY');
  const lengthTrips = (input.lengthIn ?? 0) > ROUTE_SURVEY_SUPERLOAD_LENGTH_IN && onLane('NY');
  if (!heightTrips && !widthTrips && !lengthTrips) return null;
  if (input.routeMiles <= 0) return null;

  /**
   * THE SURVEY IS PRICED OVER THE MILES THAT NEED ONE, NOT THE WHOLE LANE.
   *
   * A permit binds the state that issued it, and so does the survey it demands:
   * New York's rule is that a New York permit for a load over 13 ft 11 in comes
   * with a survey of the New York route, performed by a New York certified
   * escort. Billing a 1,484-mile lane for a survey four states do not require
   * would be the same error as quoting a permit in a state the load never
   * enters. Where per-state mileage is available the survey runs over the
   * requiring states' miles; where it is not, the whole lane is the only figure
   * there is and the copy says which was used.
   */
  const perState = input.stateMiles ?? [];
  const requiredMiles =
    requiring && requiring.length > 0 && perState.length > 0
      ? perState
          .filter((l) => requiring.includes(l.stateCode.toUpperCase()))
          .reduce((sum, l) => sum + l.miles, 0)
      : 0;
  const surveyMiles = requiredMiles > 0 ? requiredMiles : input.routeMiles;
  const scopedToStates = requiredMiles > 0;

  const low = round2(Math.max(ROUTE_SURVEY_SHORT_FLOOR_USD, surveyMiles * HIGH_POLE_USD_PER_MILE_LOW));
  const high = round2(Math.max(ROUTE_SURVEY_SHORT_FLOOR_USD, surveyMiles * HIGH_POLE_USD_PER_MILE_HIGH));
  const wholeLaneHigh = round2(
    Math.max(ROUTE_SURVEY_SHORT_FLOOR_USD, input.routeMiles * HIGH_POLE_USD_PER_MILE_HIGH),
  );
  const trigger = heightTrips
    ? `${Math.floor((input.heightIn ?? 0) / 12)} ft ${Math.round((input.heightIn ?? 0) % 12)} in of height${requiring && requiring.length > 0 ? ` in ${requiring.join(', ')}` : ''}`
    : widthTrips
      ? 'superload width in NY'
      : 'superload length in NY';

  return {
    code: 'physical_route_survey',
    name: `Physical route survey (${Math.round(surveyMiles).toLocaleString()} mi, triggered by ${trigger})`,
    // CONDITIONAL: likelihood-weighted at the midpoint, not biased to the 65th.
    headlineUsd: headlineOf(low, high, 0.5),
    lowUsd: low,
    highUsd: high,
    inTotal: true,
    accuracy: rate({
      tier: 'benchmark',
      bandPct: ROUTE_SURVEY_BAND_PCT,
      lowUsd: low,
      highUsd: high,
      asOf: '2025-01-26',
      sample: 'Derived from the published high-pole escort rate of $1.90–$2.50/mi, and bracketed at both ends by two independent benchmarks — a pilot-car cost guide at $200–$500 for a 100-mile survey and a heavy-haul shipper guide at $500–$2,000+ for a long one',
      hover:
        'A survey vehicle drives your route with a height pole before the load moves. It is YOUR document to produce — no state performs one and none charges for one.',
      detail: `WHY THIS FIRES ON HEIGHT AND NOT ON WEIGHT: five states key the requirement to 13 ft 11 in – 14 ft 6 in of height — Connecticut over 14'0", Delaware, Maryland and Pennsylvania over 14'6", New York over 13'11" — with superload width and length as secondary triggers, and New Jersey requiring none at all. Your load trips it on ${trigger}${requiring === null ? ', and no lane states were given, so this is the national height trigger rather than a per-state one' : ''}. A lane that crosses none of those states at this height does not fire this line at all, which is the point of keying it per state rather than on height alone. WHY THERE IS A NUMBER HERE AT ALL: no pilot-car or permit operator prints a price for a route survey. Ten of them list it as a service and none prices it, on cards detailed enough to quote hourly wait time and a hotel per night — so no amount of further searching will produce one. But New York requires the survey to be performed by a STATE-CERTIFIED ESCORT, which makes it a billable escort trip, and the high-pole escort rate is published: $1.90–$2.50 a mile, one vehicle, one pass, not one per escort position on the move. Two independent benchmarks bracket that derivation across the whole distance range, which is what makes it usable rather than free-floating. THE SHORT-ROUTE FLOOR IS THE WEAK JOINT: a full high-pole day is $500–$800, which overshoots the $200–$500 a short local survey benchmarks at, so $${ROUTE_SURVEY_SHORT_FLOOR_USD} splits the difference and has no direct support behind it. Long routes stand on much firmer ground than short ones. Separate from the $${PERMIT_SERVICE_ASSIST_USD} a permit agent charges to ORDER one — that is coordination, and it sits on the permit service line. WHICH MILES ARE SURVEYED: ${
        scopedToStates
          ? `a permit binds the state that issued it and so does the survey it demands, so this runs over the ${Math.round(surveyMiles).toLocaleString()} miles in ${(requiring ?? []).join(', ')} rather than the whole ${Math.round(input.routeMiles).toLocaleString()}-mile lane. A carrier who chooses to survey the entire route in one pass instead — which nothing requires, but which some do — would bill nearer $${Math.round(wholeLaneHigh).toLocaleString()}.`
          : `no per-state mileage was available for this lane, so the whole ${Math.round(input.routeMiles).toLocaleString()}-mile route is priced. That is the conservative reading: only the states that require a survey actually need one surveyed.`
      } The state thresholds come from a 2013 multi-state DOT study: the structure is certainly still right, the exact heights want re-verifying per state.`,
      marketSources: [SRC_ROUTE_SURVEY_PRACTICES, SRC_ESCORT_OPERATOR_SHEETS],
    }),
  };
}

// ── Utility clearance — pulled OUT of the survey band, into a refusal ──────

/**
 * THE MOST DANGEROUS THING AVAILABLE IN THIS MODEL WOULD BE TO AVERAGE THIS IN.
 *
 * A heavy-haul operator, writing about his own invoices: utilities demand a
 * non-refundable deposit merely to come and measure their own wires; further
 * deposits "costing thousands" if they must actually assist; some charge simply
 * to come out and WATCH a load pass under their lines; and "sometimes bills give
 * no explanation for the charges, no man-hours or equipment even shown, just a
 * flat rate". His magnitudes: $90,000 of over-height utility assistance on a
 * 100-MILE project, and $200,000 on a 1,000-mile move.
 *
 * No schedule for this exists anywhere. A number that can be $200,000 and is
 * billed unitemised cannot be banded; folding it into a survey line would put a
 * six-figure exposure inside a ±35% estimate. So it is named as a risk on any
 * load whose height trips a survey, priced at nothing, and disclosed rather than
 * added — the same treatment as detention and layover, and for a stronger reason.
 */
export function utilityClearanceRiskLine(heightIn: number | undefined): AccessorialLine | null {
  if ((heightIn ?? 0) <= ROUTE_SURVEY_HEIGHT_TRIGGER_IN) return null;
  return {
    code: 'risk_utility_clearance',
    name: 'Utility clearance and line lifts',
    headlineUsd: null,
    lowUsd: null,
    highUsd: null,
    inTotal: false,
    accuracy: rate({
      tier: 'refused',
      hover:
        'Over-height loads sometimes need utilities to lift or de-energise their own lines. Every utility on your route bills this its own way and none of them publishes a rate, so we will not put a number on it.',
      detail:
        'THIS IS THE ONE COST ON AN OVER-HEIGHT MOVE THAT CAN DWARF EVERYTHING ELSE ON THIS PAGE, AND IT IS THE ONE NOBODY PUBLISHES. A heavy-haul operator describing his own invoices: utilities require a non-refundable deposit simply to come and measure their own wires; further deposits "costing thousands" if they must actually assist; some charge merely to come out and watch a load pass beneath their lines; and bills arrive with no explanation, no man-hours and no equipment shown — just a flat rate. His own magnitudes are $90,000 of over-height assistance on a 100-mile project and $200,000 of overhead support on a 1,000-mile move. There is no schedule for this at any utility, in any state. A figure that can reach six digits and is billed unitemised cannot honestly be averaged into a range, and quietly folding it into the route-survey estimate would be the single most dangerous thing in this model — so it is disclosed here and priced at nothing. What reduces it is routing: ask your permit agent early whether a lower-clearance route exists, because the cheapest line lift is the one you route around.',
      marketSources: [SRC_UTILITY_CLEARANCE_TESTIMONY],
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
