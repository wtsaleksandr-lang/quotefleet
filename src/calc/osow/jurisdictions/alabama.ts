/**
 * ALABAMA — oversize/overweight single-trip permit rules.
 *
 * The most contradictory dataset in this directory. Alabama is running two
 * bodies of law side by side: a statute rewritten by SB110 and effective
 * 2025-10-01, and an administrative code whose relevant rules were last touched
 * in 2016 and 2021. They have not been reconciled, and they disagree about the
 * legal width, two vehicle lengths, the overhang allowance, the floor of the
 * first overweight fee band and two escort thresholds. On top of that ALDOT's
 * own current fee sheet prints adjacent weight bands that overlap at their
 * boundaries. TWELVE separate disagreements are encoded below, every one of
 * them as a conflict rather than as a choice.
 *
 * THE FEE STRUCTURE, AND THE DECOMPOSITION THAT REPRODUCES IT
 * ----------------------------------------------------------
 * ALDOT publishes two parallel weight-banded columns on one sheet:
 *
 *     Weight Only      80,000–100,000 $10 · 100,001–125,000 $30
 *                      125,001–150,000 $60 · Over 150,000 $100
 *     General W/H/L    up to 100,000 $20 · 100,000–125,000 $40
 *                      125,000–150,000 $70 · Over 150,000 $110
 *
 * The General column is not a separate schedule. It is the Weight Only column
 * plus exactly ten dollars in every row, which is the administrative code's own
 * rule in as many words: "When the overweight vehicle or combination of vehicles
 * and loads is over the maximum length, height, or width specified by law, an
 * additional $10.00 is added to the fee."
 *
 * So Alabama is modelled as three published components — a $10 permit base, a
 * $10 dimensional add-on, and a weight increment of $0 / $20 / $50 / $90 — and
 * the three reproduce EVERY cell of both columns:
 *
 *     oversize only, legal weight   10 + 10          = $20  (General row 1)
 *     overweight only, 110,000 lb   10 +      20     = $30  (Weight Only row 2)
 *     both, 110,000 lb              10 + 10 + 20     = $40  (General row 2)
 *     both, 140,000 lb              10 + 10 + 50     = $70  (General row 3)
 *     both, 160,000 lb              10 + 10 + 90     = $110 (General row 4)
 *
 * THE WEIGHT INCREMENTS ARE OUR DECOMPOSITION, NOT ALDOT'S PRINTED FIGURES.
 * ALDOT prints totals; $0 / $20 / $50 / $90 is what those totals leave once the
 * two ten-dollar components are taken out. This is the same decomposition
 * Indiana required and is flagged the same way — on every band's own note, and
 * again here, so nobody reads $50 as something Alabama published.
 *
 * DATE WARNING: the administrative-code rules are from 2016 and 2021, ALDOT's
 * escort presentation from 2017, ALEA's escort-fee chapter from 2023, and
 * ALDOT's superload memorandum carries no date at all. Every one of those is
 * recorded with its real date, or with `null` where the document states none.
 */
import type { SourceDoc, Sourced } from '../provenance.js';
import { ftIn, type EscortRule, type RouteClass } from '../escortRules.js';
import type {
  JurisdictionOsowRules,
  OversizeFeeBand,
  OverweightPricing,
  Threshold,
  TransactionFee,
  WeightBand,
} from '../types.js';

const RETRIEVED = '2026-09-02';

// ── Source documents ──────────────────────────────────────────────────────

const SB110: SourceDoc = {
  id: 'al-sb110-2025',
  title: 'Alabama Act 2025 (SB110, enrolled) — size and weight limits',
  url: 'https://alison.legislature.state.al.us/files/pdf/SearchableInstruments/2025RS/SB110-enr.pdf',
  publisher: 'Alabama Legislature',
  revisedOn: '2025-10-01',
  retrievedOn: RETRIEVED,
  cite: '102 in width; 13 1/2 ft height; 28 1/2 ft doubles; 65 ft car hauler; 80 ft stinger-steered; overhang "a total of five feet beyond both the front and rear, inclusive"; Interstate axle and gross limits including the allowable load tolerance',
};

const AC_450_3_1_02: SourceDoc = {
  id: 'al-admincode-450-3-1-02',
  title: 'Ala. Admin. Code r. 450-3-1-.02 — Definitions (legal dimensions)',
  url: 'https://admincode.legislature.state.al.us/administrative-code/450-3-1-.02',
  publisher: 'Alabama Department of Transportation',
  revisedOn: '2021-11-14',
  retrievedOn: RETRIEVED,
  cite: '"LEGAL WIDTH: Eight (8) feet wide on roads with less than twelve (12) foot lanes; eight (8) feet and six (6) inches on roads with at least twelve (12) foot lanes."; 40/57/28 ft lengths; 65 ft car haulers, 75 ft stinger-steered; "LEGAL OVERHANG (FRONT AND REAR): Five (5) feet."',
};

const AC_450_3_1_05: SourceDoc = {
  id: 'al-admincode-450-3-1-05',
  title: 'Ala. Admin. Code r. 450-3-1-.05 — Escorts',
  url: 'https://admincode.legislature.state.al.us/administrative-code/450-3-1-.05',
  publisher: 'Alabama Department of Transportation',
  revisedOn: '2016-01-18',
  retrievedOn: RETRIEVED,
  cite: '"Loads greater than 14 feet wide require one (1) front and one (1) rear escort on all roads."; height indicator over 15\'6"; law-enforcement escorts over 150 ft; rear escort over 5 ft rear overhang; front escort at 10 ft or more front overhang',
};

const AC_450_3_1_07: SourceDoc = {
  id: 'al-admincode-450-3-1-07',
  title: 'Ala. Admin. Code r. 450-3-1-.07 — House moves',
  url: 'https://admincode.legislature.state.al.us/administrative-code/450-3-1-.07',
  publisher: 'Alabama Department of Transportation',
  revisedOn: '2016-01-18',
  retrievedOn: RETRIEVED,
  cite: '"Houses greater than seventeen (17) feet in height require a route survey and utility notification."',
};

const AC_450_3_1_10: SourceDoc = {
  id: 'al-admincode-450-3-1-10',
  title: 'Ala. Admin. Code r. 450-3-1-.10 — Permit fees',
  url: 'https://admincode.legislature.state.al.us/administrative-code/450-3-1-.10',
  publisher: 'Alabama Department of Transportation',
  revisedOn: '2016-01-18',
  retrievedOn: RETRIEVED,
  cite: '"From 80,001 pounds up to 100,000 pounds.........$10.00"; "Other oversized vehicles, loads, and equipment not herein specified.......................................$20.00"; "Other overweight loads not herein specified..$10.00"; "When the overweight vehicle or combination of vehicles and loads is over the maximum length, height, or width specified by law, an additional $10.00 is added to the fee."',
};

const AC_450_3_1_CHAPTER: SourceDoc = {
  id: 'al-admincode-450-3-1-chapter',
  title: 'Ala. Admin. Code ch. 450-3-1 — Escort vehicle operator requirements',
  url: 'https://admincode.legislature.state.al.us/api/chapter/450-3-1',
  publisher: 'Alabama Department of Transportation',
  revisedOn: '2016-01-18',
  retrievedOn: RETRIEVED,
  cite: '"Drivers of escort vehicles must be a minimum of 18 years of age, have a valid driver’s license, and have completed a pilot/escort flagging course which equals or exceeds Alabama’s course within 12 months of Alabama’s course availability."',
};

const FEE_SHEET_2025: SourceDoc = {
  id: 'aldot-permit-fee-sheet-2025-03',
  title: 'ALDOT — Permit Fees, March 11 2025 (PDF)',
  url: 'https://www.dot.state.al.us/business/permits/pdf/PermitFee2025.pdf',
  publisher: 'Alabama Department of Transportation',
  revisedOn: '2025-03-11',
  retrievedOn: RETRIEVED,
  cite: 'Weight Only and General W/H/L weight bands; "A fee of $4 will be added to each credit card transaction"',
};

const ALDOT_RULES_PRESENTATION: SourceDoc = {
  id: 'aldot-rules-regulations-presentation-2017',
  title: 'ALDOT — Rules and Regulations Presentation (PDF, post-harmonisation June 2017)',
  url: 'https://www.dot.state.al.us/business/permits/pdf/RulesandRegulationsPresentation.pdf',
  publisher: 'Alabama Department of Transportation',
  revisedOn: '2017-06-01',
  retrievedOn: RETRIEVED,
  cite: '">12’ – 14’ = 1 Front Escort on Two-lane Roads, or 1 Rear Escort on Multi-lane Highways."; ">90’ – 125’ = 1 Rear Escort"; ">125’ = 1 Front Escort and 1 Rear Escort"; ">15’6” = 1 Front Escort with Height Pole"',
};

const SUPERLOAD_MEMO: SourceDoc = {
  id: 'aldot-superload-information',
  title: 'ALDOT — Alabama Superload Requirements (PDF, undated)',
  url: 'https://www.dot.state.al.us/business/permits/pdf/SuperloadInformation.pdf',
  publisher: 'Alabama Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'superload at width 16 ft, height 16 ft, length 150 ft or weight 300,000 lb; two State Trooper escorts minimum; bucket truck over 16\'5"; utility notification over 16\'6"; detailed route survey for all superloads',
};

const ALEA_760_X_2_05: SourceDoc = {
  id: 'al-admincode-760-x-2-05',
  title: 'Ala. Admin. Code r. 760-X-2-.05 — ALEA superload escort fees',
  url: 'https://admincode.legislature.state.al.us/administrative-code/760-X-2-.05',
  publisher: 'Alabama Law Enforcement Agency',
  revisedOn: '2023-03-17',
  retrievedOn: RETRIEVED,
  cite: '$200.00 administrative fee per application; $100.00 per hour per arresting officer with a four-hour minimum; mileage at the current IRS rate; $12.00 subsistence over four hours; $12.75 per diem 6–12 hours; $34.00 per diem 12 hours or more; cancellation charges',
};

// ── Helpers ───────────────────────────────────────────────────────────────

function fromDated<T>(
  value: T,
  source: SourceDoc,
  effectiveFrom: string,
  note?: string,
): Sourced<T> {
  return {
    value,
    source,
    effectiveFrom,
    effectiveTo: null,
    ...(note === undefined ? {} : { note }),
  };
}

/** A row from an UNDATED document: effective only from the day we read it. */
function fromUndatedDoc<T>(
  value: T,
  source: SourceDoc,
  note?: string,
): Sourced<T> {
  return {
    value,
    source,
    effectiveFrom: RETRIEVED,
    effectiveTo: null,
    ...(note === undefined ? {} : { note }),
  };
}

const EFF_STATUTE = '2025-10-01';
const EFF_AC_2021 = '2021-11-14';
const EFF_AC_2016 = '2016-01-18';
const EFF_FEE_SHEET = '2025-03-11';
const EFF_PRESENTATION = '2017-06-01';
const EFF_ALEA = '2023-03-17';

/**
 * ALDOT's escort documents say "Two-lane Roads" and "Multi-lane Highways" and
 * never "divided" or "controlled access". Multi-lane therefore takes in a
 * divided freeway and an undivided four-lane arterial alike, which is why the
 * generic `multilane-undivided` member is included rather than only `divided`.
 */
const TWO_LANE: RouteClass[] = ['two-lane'];
const MULTI_LANE: RouteClass[] = ['divided', 'interstate', 'multilane-undivided'];

/**
 * "This load needs an Alabama permit of some kind." Several of the advisories
 * below are true of EVERY Alabama permit — the $4 card fee, ALDOT's discretion
 * to add escorts, the pilot-car certification gap — and keying them on width
 * alone would have hidden them from an overweight legal-size move, which is
 * most of heavy haul. Keying them on this instead keeps them off a fully legal
 * load, which needs no permit and should not collect warnings about one.
 */
const PERMIT_LIKELY: EscortRule['when'] = {
  kind: 'any',
  of: [
    { kind: 'gt', measure: 'widthIn', value: 102 },
    { kind: 'gt', measure: 'heightIn', value: ftIn(13, 6) },
    { kind: 'gt', measure: 'grossWeightLbs', value: 80000 },
  ],
};

// ── The conflicting length rows, held through the resolver ────────────────

/**
 * CONFLICT 2 — doubles trailer length. The administrative code says 28 ft each
 * and SB110 says 28 1/2 ft each, for the same combination. Six inches per
 * trailer decides whether a standard set of doubles is legal or permitted.
 *
 * Held here rather than in `legalLimits` because `trailerLengthIn` is a single
 * field and Alabama's doubles limit is a different measurement from the
 * trailing-unit limit a tractor-semitrailer is judged by. Exported so the
 * resolver holds both candidates, refuses to pick, and reports the 28–28.5 ft
 * spread; the escort-list advisory `al-doubles-length-conflict` states it on a
 * quote.
 */
export const ALABAMA_DOUBLES_TRAILER_LENGTH_IN: Sourced<number>[] = [
  fromDated(
    ftIn(28),
    AC_450_3_1_02,
    EFF_AC_2021,
    '"Twenty-eight (28) feet for semi-trailers and trailers used in truck tractor-semi-trailer-trailer combination."',
  ),
  fromDated(
    ftIn(28, 6),
    SB110,
    EFF_STATUTE,
    '"semitrailers and trailers, including load, used in a truck tractor-semitrailer-trailer combination, shall not exceed 28 1/2 feet each"',
  ),
];

/**
 * CONFLICT 3 — stinger-steered automobile transporters. 75 ft in the
 * administrative code, 80 ft in the statute. Five feet, and the same shape of
 * disagreement: an older rule that was never amended when the statute changed.
 */
export const ALABAMA_STINGER_STEERED_LENGTH_IN: Sourced<number>[] = [
  fromDated(
    ftIn(75),
    AC_450_3_1_02,
    EFF_AC_2021,
    '"Sixty-five (65) feet for Car Haulers; Seventy-five (75) feet for Stinger-Steered Units."',
  ),
  fromDated(
    ftIn(80),
    SB110,
    EFF_STATUTE,
    '"except that the overall length of stinger-steered type units shall not exceed 80 feet."',
  ),
];

// ── Fee components ────────────────────────────────────────────────────────

/**
 * The weight increment above the $10 base and the $10 dimensional add-on.
 *
 * EVERY `feeUsd` HERE IS DERIVED, and the note on each row says so. ALDOT
 * publishes totals; these are what the totals leave. The band edges follow the
 * administrative code's non-overlapping "From 80,001 pounds up to 100,000
 * pounds" wording rather than the 2025 sheet's overlapping "80,000 – 100,000",
 * because a schedule cannot be evaluated at all where adjacent bands claim the
 * same pound — and the three boundaries where they differ are surfaced as
 * conflicts by their own rules instead.
 */
const WEIGHT_INCREMENTS: Array<{ min: number; max: number | null; total: number; increment: number }> = [
  { min: 80001, max: 100000, total: 10, increment: 0 },
  { min: 100001, max: 125000, total: 30, increment: 20 },
  { min: 125001, max: 150000, total: 60, increment: 50 },
  { min: 150001, max: null, total: 100, increment: 90 },
];

const overweightBands: Sourced<WeightBand>[] = WEIGHT_INCREMENTS.map((b) =>
  fromDated<WeightBand>(
    { minLbs: b.min, maxLbs: b.max, feeUsd: b.increment },
    FEE_SHEET_2025,
    EFF_FEE_SHEET,
    `ALDOT prints "Weight Only ${b.min === 80001 ? '80,000 – 100,000' : `${b.min.toLocaleString()} – ${b.max === null ? 'Over 150,000' : b.max.toLocaleString()}`} $${b.total}" and, for the same weight with an over-dimension, a General W/H/L total of $${b.total + 10}. $${b.increment} is what remains of the $${b.total} once the $10 permit base is taken out — A DECOMPOSITION OF ALDOT'S TOTALS, NOT A FIGURE ALDOT PRINTS. The two together restore the published amount exactly.`,
  ),
);

// ── Escort rules ──────────────────────────────────────────────────────────

function escortRule(
  id: string,
  description: string,
  when: EscortRule['when'],
  then: EscortRule['then'],
  source: SourceDoc = AC_450_3_1_05,
  effectiveFrom: string = EFF_AC_2016,
): EscortRule {
  return {
    id,
    jurisdiction: 'AL',
    description,
    when,
    then,
    source,
    effectiveFrom,
    effectiveTo: null,
  };
}

export const ALABAMA_ESCORT_RULES: EscortRule[] = [
  escortRule(
    'al-width-over-12-to-14-two-lane',
    'Over 12 ft up to 14 ft wide on a two-lane road — one front escort',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: TWO_LANE },
        { kind: 'gt', measure: 'widthIn', value: ftIn(12) },
        {
          kind: 'between',
          measure: 'widthIn',
          min: ftIn(12),
          max: ftIn(14),
          minInclusive: false,
          maxInclusive: true,
        },
      ],
    },
    { escorts: 1, front: 1 },
    ALDOT_RULES_PRESENTATION,
    EFF_PRESENTATION,
  ),
  escortRule(
    'al-width-over-12-to-14-multi-lane',
    'Over 12 ft up to 14 ft wide on a multi-lane highway — one rear escort',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: MULTI_LANE },
        {
          kind: 'between',
          measure: 'widthIn',
          min: ftIn(12),
          max: ftIn(14),
          minInclusive: false,
          maxInclusive: true,
        },
      ],
    },
    { escorts: 1, rear: 1 },
    ALDOT_RULES_PRESENTATION,
    EFF_PRESENTATION,
  ),
  escortRule(
    'al-width-over-14',
    'Over 14 ft wide — one front and one rear escort on all roads',
    { kind: 'gt', measure: 'widthIn', value: ftIn(14) },
    { escorts: 2, front: 1, rear: 1 },
  ),
  escortRule(
    'al-height-over-15-6',
    'Over 15 ft 6 in high — one front escort carrying a height indicator',
    { kind: 'gt', measure: 'heightIn', value: ftIn(15, 6) },
    {
      escorts: 1,
      front: 1,
      heightPole: true,
      advisory:
        'The administrative code calls it a "height indicator" and ALDOT\'s presentation calls it a "Height Pole". Neither publishes a construction, mounting or calibration specification — no material, no required clearance above the load, no mounting method — so nothing has been assumed about the equipment beyond the requirement to carry it.',
    },
  ),
  escortRule(
    'al-length-over-90-to-125',
    'Over 90 ft up to 125 ft long — one rear escort',
    {
      kind: 'between',
      measure: 'overallLengthIn',
      min: ftIn(90),
      max: ftIn(125),
      minInclusive: false,
      maxInclusive: true,
    },
    { escorts: 1, rear: 1 },
    ALDOT_RULES_PRESENTATION,
    EFF_PRESENTATION,
  ),
  escortRule(
    'al-length-over-125',
    'Over 125 ft long — one front and one rear escort',
    { kind: 'gt', measure: 'overallLengthIn', value: ftIn(125) },
    { escorts: 2, front: 1, rear: 1 },
    ALDOT_RULES_PRESENTATION,
    EFF_PRESENTATION,
  ),
  escortRule(
    'al-rear-overhang-over-5',
    'Rear overhang over 5 ft — one rear escort',
    { kind: 'gt', measure: 'rearOverhangIn', value: ftIn(5) },
    { escorts: 1, rear: 1 },
  ),
  /**
   * Note the inclusive boundary, and that it is the only one in Alabama's
   * escort table: "a load extending TEN FEET OR MORE beyond the front". Every
   * other Alabama trigger is "greater than". A load with exactly 10 ft of front
   * overhang needs the escort; one with exactly 5 ft of rear overhang does not.
   */
  escortRule(
    'al-front-overhang-10-or-more',
    'Front overhang of 10 ft or more — one front escort',
    { kind: 'gte', measure: 'frontOverhangIn', value: ftIn(10) },
    { escorts: 1, front: 1 },
  ),

  // ── Law enforcement ─────────────────────────────────────────────────────
  /**
   * Alabama is one of the few states that publishes a real law-enforcement
   * escort rate, so the cost is quotable in a way Texas's and Washington's is
   * not — but the HOURS are not, and the rule bills a four-hour minimum per
   * officer plus mileage at whatever the IRS rate is on the day. So the rate is
   * stated in full and no amount is added to the permit total.
   */
  escortRule(
    'al-length-over-150-law-enforcement',
    'Over 150 ft long — front and rear law-enforcement escorts',
    { kind: 'gt', measure: 'overallLengthIn', value: ftIn(150) },
    {
      policeFront: 1,
      policeRear: 1,
      manualReview:
        'Ala. Admin. Code r. 450-3-1-.05: "Front and rear law enforcement escorts are required for lengths in excess of 150 feet." These are troopers, not pilot cars. ALEA charges a $200.00 administrative fee for each escort application, $100.00 per hour per arresting officer with a four-hour minimum, mileage at the current IRS rate calculated from each officer\'s residence or office and back, $12.00 subsistence for an escort over four hours, $12.75 per diem for 6–12 hours and $34.00 for 12 hours or more. Billable time starts 30 minutes before the scheduled start and ends 30 minutes after completion. Cancelling more than 24 hours out costs $200.00; cancelling inside 24 hours costs $200.00 plus four hours\' pay per assigned officer. The hours cannot be known in advance and the IRS mileage rate is not a fixed published figure, so no law-enforcement amount is included in the permit total. Note also that r. 450-3-1-.05 assigns private front and rear escorts over 125 ft and law-enforcement front and rear over 150 ft without saying whether the private pair is still required above 150 ft; both readings are on the table and neither has been adopted.',
    },
  ),

  // ── Superload ───────────────────────────────────────────────────────────
  escortRule(
    'al-superload-law-enforcement-minimum',
    'Superload — a minimum of two State Trooper or police escorts, position unpublished',
    {
      kind: 'any',
      of: [
        { kind: 'gt', measure: 'widthIn', value: ftIn(16) },
        { kind: 'gt', measure: 'heightIn', value: ftIn(16) },
        { kind: 'gt', measure: 'overallLengthIn', value: ftIn(150) },
        { kind: 'gt', measure: 'grossWeightLbs', value: 300000 },
      ],
    },
    {
      manualReview:
        'ALDOT: "A minimum of two (2) State Trooper or Police Escorts are required for all Superloads. Additional Trooper escorts may be required under certain conditions." The memorandum does not say where those two ride for a width-, height- or weight-triggered superload — only the length trigger over 150 ft has published positions — so no position is asserted. A detailed route survey is required for every superload, performed by the applicant or its agent at the applicant\'s cost, and a weighted superload additionally needs a Special Work Authorization so ALDOT\'s Bridge Rating Office can analyse every structure on the route. Neither the survey nor the Special Work Authorization has a published cost, and no separate superload permit surcharge appears on ALDOT\'s fee sheet. Most superloads must travel between 9:00 PM and 6:00 AM Sunday through Thursday unless the permit office approves otherwise.',
    },
    SUPERLOAD_MEMO,
    RETRIEVED,
  ),
  escortRule(
    'al-bucket-truck-over-16-5',
    'Over 16 ft 5 in high — a bucket truck is required, and over 16 ft 6 in utility notification may be too',
    { kind: 'gt', measure: 'heightIn', value: ftIn(16, 5) },
    {
      advisory:
        'ALDOT: "A bucket truck will be required for all loads that exceed 16’5” in height." and "Proof of utility notification may be required for loads which exceed 16’6” in height." The bucket-truck threshold is an inch LOWER than the utility-notification one, which is easy to read past. Both are third-party services arranged by the applicant, so neither is in the permit total.',
    },
    SUPERLOAD_MEMO,
    RETRIEVED,
  ),
  escortRule(
    'al-house-over-17-route-survey',
    'A house over 17 ft high — route survey and utility notification',
    { kind: 'gt', measure: 'heightIn', value: ftIn(17) },
    {
      routeSurvey: true,
      advisory:
        'Ala. Admin. Code r. 450-3-1-.07: "Houses greater than seventeen (17) feet in height require a route survey and utility notification." The trigger is written for house moves specifically, and a quote does not collect the commodity, so it is surfaced rather than applied. ALDOT publishes no route-survey fee — the survey is performed by the permit applicant or its agent — so no survey cost is in the permit total.',
    },
    AC_450_3_1_07,
    EFF_AC_2016,
  ),

  // ── The twelve conflicts ────────────────────────────────────────────────
  /**
   * CONFLICT 1 — LEGAL WIDTH. SB110, effective 2025-10-01, sets a flat 102 in.
   * The administrative code, last amended 2021, still sets 8 ft on a road with
   * lanes under 12 ft and 8 ft 6 in on a road with lanes of 12 ft or more.
   * Between 96 in and 102 in the two give opposite answers about whether a
   * permit is needed at all on a narrow-laned road, so the rule fires exactly
   * there. Wider than 102 in, both agree a permit is required and there is
   * nothing to warn about.
   */
  escortRule(
    'al-legal-width-conflict',
    'Between 8 ft and 8 ft 6 in wide — the statute and the administrative code disagree about whether a permit is needed on a narrow-laned road',
    {
      kind: 'between',
      measure: 'widthIn',
      min: 96,
      max: 102,
      minInclusive: false,
      maxInclusive: true,
    },
    {
      manualReview:
        'Alabama\'s two sources disagree about the legal width at this measurement. SB110, effective October 1 2025, states "Vehicles and combinations of vehicles operating on highways shall not exceed a total outside width, including any load thereon, of 102 inches" with no road qualification. Ala. Admin. Code r. 450-3-1-.02, last amended November 14 2021, still states "LEGAL WIDTH: Eight (8) feet wide on roads with less than twelve (12) foot lanes; eight (8) feet and six (6) inches on roads with at least twelve (12) foot lanes." On a road with lanes under 12 ft the administrative code makes this load over width and the statute does not. The statute is newer and is the law, but the rule has not been amended to follow it and ALDOT issues permits under both; neither reading has been adopted here.',
    },
    SB110,
    EFF_STATUTE,
  ),
  /** CONFLICT 2 — doubles trailer length. See ALABAMA_DOUBLES_TRAILER_LENGTH_IN. */
  escortRule(
    'al-doubles-length-conflict',
    'Truck tractor-semitrailer-trailer units — 28 ft each in the administrative code and 28 ft 6 in in the statute',
    {
      kind: 'between',
      measure: 'trailerLengthIn',
      min: ftIn(28),
      max: ftIn(28, 6),
      minInclusive: false,
      maxInclusive: true,
    },
    {
      advisory:
        'If this move is a set of doubles, note that Alabama publishes two different limits for each trailing unit: Ala. Admin. Code r. 450-3-1-.02 says "Twenty-eight (28) feet for semi-trailers and trailers used in truck tractor-semi-trailer-trailer combination" and SB110 says they "shall not exceed 28 1/2 feet each". Six inches per trailer decides whether an ordinary set of doubles is legal or permitted. Neither has been adopted, and a quote does not collect the combination type, so nothing has been applied for it.',
    },
    AC_450_3_1_02,
    EFF_AC_2021,
  ),
  /** CONFLICT 3 — stinger-steered length. */
  escortRule(
    'al-stinger-steered-length-conflict',
    'Stinger-steered automobile transporters — 75 ft in the administrative code and 80 ft in the statute',
    {
      kind: 'between',
      measure: 'overallLengthIn',
      min: ftIn(75),
      max: ftIn(80),
      minInclusive: false,
      maxInclusive: true,
    },
    {
      manualReview:
        'If this is a stinger-steered automobile transporter, its legal overall length is in dispute at exactly this measurement. Ala. Admin. Code r. 450-3-1-.02 allows "Seventy-five (75) feet for Stinger-Steered Units"; SB110 allows "the overall length of stinger-steered type units shall not exceed 80 feet." Between 75 and 80 ft the rule requires a permit and the statute does not. A quote does not collect the body style, so neither is applied and the length must be settled with ALDOT.',
    },
    SB110,
    EFF_STATUTE,
  ),
  /**
   * CONFLICT 4 — OVERHANG, and the most easily missed of the twelve. SB110 says
   * "No other vehicle operated on a highway shall carry any load extending more
   * than A TOTAL OF FIVE FEET BEYOND BOTH THE FRONT AND REAR, INCLUSIVE, of the
   * vehicle" — five feet shared across both ends. The administrative code's
   * heading reads "LEGAL OVERHANG (FRONT AND REAR): Five (5) feet", which reads
   * as five feet at each end. A load with 4 ft in front and 4 ft behind is legal
   * on one reading and over on the other.
   *
   * The AST has no way to add two measurements, so the rule fires whenever the
   * readings CAN differ: whenever there is overhang at both ends at once, or
   * whenever either end alone is over five feet.
   */
  escortRule(
    'al-overhang-total-vs-each-end-conflict',
    'Overhang at both ends, or over 5 ft at one end — the statute allows five feet in total and the administrative code reads as five feet at each end',
    {
      kind: 'any',
      of: [
        { kind: 'gt', measure: 'frontOverhangIn', value: ftIn(5) },
        { kind: 'gt', measure: 'rearOverhangIn', value: ftIn(5) },
        {
          kind: 'all',
          of: [
            { kind: 'gt', measure: 'frontOverhangIn', value: 0 },
            { kind: 'gt', measure: 'rearOverhangIn', value: 0 },
          ],
        },
      ],
    },
    {
      manualReview:
        'Alabama\'s legal overhang is genuinely ambiguous for this load. SB110 states "No other vehicle operated on a highway shall carry any load extending more than a total of five feet beyond both the front and rear, inclusive, of the vehicle" — five feet SHARED between the two ends. Ala. Admin. Code r. 450-3-1-.02 states "LEGAL OVERHANG (FRONT AND REAR): Five (5) feet", which reads as five feet at EACH end. A load with four feet in front and four feet behind is legal under the rule and over the limit under the statute. Neither reading has been adopted. A truck tractor-semitrailer combination used exclusively to transport motor vehicles has its own statutory allowance of four feet in front and six feet behind; the commodity is not collected on a quote, so that has not been applied either.',
    },
    SB110,
    EFF_STATUTE,
  ),
  /**
   * CONFLICT 5 — the first overweight band's floor. ALDOT's 2025 sheet prints
   * "Weight Only 80,000 – 100,000 lbs. $10" and the administrative code prints
   * "From 80,001 pounds up to 100,000 pounds.........$10.00". At exactly 80,000
   * lb the sheet charges an overweight permit for a load at the legal limit and
   * the rule does not. Same shape as Washington's first-band conflict.
   */
  escortRule(
    'al-weight-band-floor-conflict',
    'Gross weight exactly 80,000 lb — the fee sheet puts it inside the first overweight band and the administrative code starts that band a pound higher',
    { kind: 'between', measure: 'grossWeightLbs', min: 80000, max: 80000 },
    {
      manualReview:
        'This load sits on the pound Alabama\'s own sources disagree about. ALDOT\'s March 2025 fee sheet prints "Weight Only 80,000 – 100,000 lbs. $10", which charges an overweight permit fee at exactly the legal Interstate limit; Ala. Admin. Code r. 450-3-1-.10 prints "From 80,001 pounds up to 100,000 pounds.........$10.00", which does not. No overweight fee has been asserted for a load at exactly 80,000 lb.',
    },
    FEE_SHEET_2025,
    EFF_FEE_SHEET,
  ),
  /**
   * CONFLICTS 6 and 7 — the General W/H/L table overlaps itself. "up to 100,000
   * lbs. $20" and "100,000 -125,000 lbs. $40" both claim exactly 100,000 lb;
   * "100,000 -125,000 lbs. $40" and "125,000 – 150,000 lbs. $70" both claim
   * exactly 125,000. Twenty and thirty dollars respectively, on one pound.
   */
  escortRule(
    'al-general-table-overlap-100000',
    'Gross weight exactly 100,000 lb — ALDOT’s General table gives this load two different fees',
    { kind: 'between', measure: 'grossWeightLbs', min: 100000, max: 100000 },
    {
      manualReview:
        'ALDOT\'s March 2025 fee sheet claims this exact weight twice in its General W/H/L column: "W/H/L: up to 100,000 lbs. $20" and "W/H/L: 100,000 -125,000 lbs. $40". A dimensional permit at exactly 100,000 lb is $20 on one row and $40 on the other, and ALDOT has not said which governs. No General fee has been adopted for this weight; the amount shown was computed from the non-overlapping administrative-code bands and must be confirmed with the permit office.',
    },
    FEE_SHEET_2025,
    EFF_FEE_SHEET,
  ),
  escortRule(
    'al-general-table-overlap-125000',
    'Gross weight exactly 125,000 lb — ALDOT’s General table gives this load two different fees',
    { kind: 'between', measure: 'grossWeightLbs', min: 125000, max: 125000 },
    {
      manualReview:
        'ALDOT\'s March 2025 fee sheet claims this exact weight twice in its General W/H/L column: "W/H/L: 100,000 -125,000 lbs. $40" and "W/H/L: 125,000 – 150,000 lbs. $70". Thirty dollars turns on a pound the sheet assigns to both rows. No General fee has been adopted for this weight.',
    },
    FEE_SHEET_2025,
    EFF_FEE_SHEET,
  ),
  /**
   * CONFLICT 8 — escort width lower boundary. ALDOT's post-harmonisation
   * presentation says ">12’ – 14’"; the administrative code says "Loads 12 – 14
   * feet". At exactly 12 ft 0 in the presentation wants no escort and the rule
   * wants one.
   */
  escortRule(
    'al-escort-width-boundary-conflict',
    'Exactly 12 ft wide — the presentation starts the escort band above 12 ft and the administrative code starts it at 12 ft',
    { kind: 'between', measure: 'widthIn', min: ftIn(12), max: ftIn(12) },
    {
      manualReview:
        'At exactly 12 ft 0 in wide, Alabama\'s two escort documents give opposite answers. ALDOT\'s post-June-2017 Rules and Regulations presentation reads ">12’ – 14’ = 1 Front Escort on Two-lane Roads, or 1 Rear Escort on Multi-lane Highways", which leaves a 12 ft 0 in load clear; the administrative code states the band as "Loads 12 – 14 feet", which does not. One pilot car turns on it, and no escort has been added or ruled out.',
    },
    ALDOT_RULES_PRESENTATION,
    EFF_PRESENTATION,
  ),
  /** CONFLICT 9 — escort length lower boundary, the same defect at 90 ft. */
  escortRule(
    'al-escort-length-boundary-conflict',
    'Exactly 90 ft long — the presentation starts the escort band above 90 ft and the administrative code starts it at 90 ft',
    { kind: 'between', measure: 'overallLengthIn', min: ftIn(90), max: ftIn(90) },
    {
      manualReview:
        'At exactly 90 ft 0 in, ALDOT\'s presentation (">90’ – 125’ = 1 Rear Escort") leaves the load clear and the administrative code ("90 feet to 125 feet, inclusive") requires a rear escort. No escort has been added or ruled out.',
    },
    ALDOT_RULES_PRESENTATION,
    EFF_PRESENTATION,
  ),
  /**
   * CONFLICT 10 — the administrative code contradicts ITSELF at 125 ft, naming
   * that length in both the "90 feet to 125 feet, inclusive" one-rear-escort
   * band and the "125 to 150 feet" front-and-rear band. The presentation
   * separates them at ">125’". One escort or two, on the same foot.
   */
  escortRule(
    'al-escort-length-125-internal-conflict',
    'Exactly 125 ft long — the administrative code assigns this length to both escort configurations at once',
    { kind: 'between', measure: 'overallLengthIn', min: ftIn(125), max: ftIn(125) },
    {
      manualReview:
        'The administrative code names 125 ft in two bands at the same time — "90 feet to 125 feet, inclusive" with one rear escort, and "125 to 150 feet" with a front and a rear escort — so its own text asks for one escort and two escorts for the same load. ALDOT\'s post-2017 presentation separates them at ">125’ = 1 Front Escort and 1 Rear Escort", which resolves the overlap in favour of two, but it is guidance rather than the rule. Neither has been adopted; the escort count here is one car in dispute.',
    },
    AC_450_3_1_05,
    EFF_AC_2016,
  ),
  /**
   * CONFLICT 11 — the boats/manufactured-housing/portable-buildings row. The
   * 2025 sheet prints "Over 12’ x 75’ $20" without saying whether "x" means
   * both dimensions or either; the older administrative code says "in excess of
   * 12 feet wide AND/OR 75 feet long". A 13 ft wide 60 ft load is inside the $10
   * row on one reading and the $20 row on the other.
   */
  escortRule(
    'al-boat-modular-category-ambiguity',
    'Boats, manufactured housing, portable buildings and modular homes — the fee row’s "12’ x 75’" does not say whether both dimensions or either triggers the higher fee',
    {
      kind: 'any',
      of: [
        { kind: 'gt', measure: 'widthIn', value: ftIn(12) },
        { kind: 'gt', measure: 'overallLengthIn', value: ftIn(75) },
      ],
    },
    {
      advisory:
        'If this load is a boat, manufactured home, portable building or modular home, Alabama prices it in its own category and the category is ambiguous. ALDOT\'s 2025 sheet prints "12’(3.66) x 75’(22.86) $10" and "Over 12’ x 75’ $20" without stating whether "x" means both dimensions together or either one; the older administrative code reads "in excess of 12 feet wide and/or 75 feet long", which is the either reading. A quote does not collect the commodity, so the general W/H/L schedule has been used and this category has not been applied. Houses of any size are a separate $20 row.',
    },
    FEE_SHEET_2025,
    EFF_FEE_SHEET,
  ),
  /**
   * CONFLICT 12 — the route-class vocabulary. ALDOT's escort documents say
   * "Multi-lane Highways" and never "divided" or "controlled access", so an
   * undivided four-lane arterial takes the multi-lane (rear escort) treatment
   * rather than the two-lane (front escort) one. That is how it is encoded, and
   * it is stated rather than left as an assumption a reader has to reverse
   * engineer from a route-class list.
   */
  escortRule(
    'al-multilane-terminology',
    'Alabama’s escort table is keyed on "Multi-lane Highways", which is not the same class as "divided"',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: ['multilane-undivided'] },
        { kind: 'gt', measure: 'widthIn', value: ftIn(12) },
      ],
    },
    {
      advisory:
        'ALDOT\'s escort documents distinguish only "Two-lane Roads" from "Multi-lane Highways" and never use the words "divided" or "controlled access". This move has been priced on the multi-lane reading — a rear escort rather than a front one between 12 and 14 ft wide — because the road has more than one lane in each direction, even though it has no median barrier. If ALDOT treats this route as two-lane the escort moves from the rear to the front; the count, and therefore the cost, is the same either way.',
    },
    ALDOT_RULES_PRESENTATION,
    EFF_PRESENTATION,
  ),

  // ── Recorded unknowns ───────────────────────────────────────────────────
  escortRule(
    'al-non-interstate-limits-unknown',
    'Non-Interstate weight limits — a computed table and a one-tenth tolerance, not a single number',
    { kind: 'gt', measure: 'grossWeightLbs', value: 80000 },
    {
      advisory:
        'The 80,000 lb gross limit used here is Alabama\'s INTERSTATE ceiling, and SB110 states it already includes the allowable load tolerance. Off the Interstate the statute uses a Computed Gross Weight Table by axle count and spacing — its highest published base row is 75,000 lb on four axles, 80,000 on five and 84,000 on six at 44 ft and over — and then adds an allowable load tolerance "calculated by multiplying the weight prescribed by this subdivision by one-tenth (.10)". Alabama publishes NO flat non-Interstate tandem-axle figure at all. A non-Interstate move may therefore be legal at a weight shown here as overweight, and its permit fee would fall in a lower band. County commissions may also set lower limits by resolution and ALDOT may post any road or bridge below the statewide limits, so route-specific restrictions must be checked separately.',
    },
    SB110,
    EFF_STATUTE,
  ),
  escortRule(
    'al-discretionary-escorts',
    'ALDOT may require escorts beyond the published thresholds, and publishes no weight-based pilot-car trigger',
    PERMIT_LIKELY,
    {
      advisory:
        'Ala. Admin. Code r. 450-3-1-.05 opens with "ALDOT may require that permitted vehicles use front or rear escorts when deemed necessary. Escorts are required, but are not limited to the following" — the listed triggers are a floor, not a ceiling. Alabama publishes no weight-based private pilot-car threshold; weight reaches the escort rules only through the 300,000 lb superload line, which brings law-enforcement escorts rather than pilot cars.',
    },
  ),
  escortRule(
    'al-pilot-car-certification-unknown',
    'Pilot-car operator certification — the rule requires a course Alabama may no longer run',
    { kind: 'gt', measure: 'widthIn', value: ftIn(12) },
    {
      advisory:
        'Ala. Admin. Code ch. 450-3-1 requires an escort driver to be at least 18, licensed, and to "have completed a pilot/escort flagging course which equals or exceeds Alabama’s course within 12 months of Alabama’s course availability" — a requirement written as a deadline that runs from the availability of a course whose current status is not published. Alabama does not say whether it issues its own operator certificate, what such a certificate costs, how long it is valid, or which other states\' certifications it accepts: the rule points to "A list of states with approved escort certification ... on the Permit Office website" at a URL that no longer resolves. None of this is a state fee and none is in the permit total, but a pilot car booked on the strength of another state\'s card may not satisfy Alabama.',
    },
    AC_450_3_1_CHAPTER,
    EFF_AC_2016,
  ),
  escortRule(
    'al-credit-card-fee-conditional',
    'The $4 transaction fee is charged on card payments only',
    PERMIT_LIKELY,
    {
      advisory:
        'ALDOT\'s fee sheet states "A fee of $4 will be added to each credit card transaction". It is a fixed amount and not a percentage, and it is included in the total above; a permit paid by another method would be $4 cheaper. No percentage-based surcharge appears anywhere on the published schedule.',
    },
    FEE_SHEET_2025,
    EFF_FEE_SHEET,
  ),
];

// ── The jurisdiction ──────────────────────────────────────────────────────

export const ALABAMA_OSOW_RULES: JurisdictionOsowRules = {
  code: 'AL',
  name: 'Alabama',
  country: 'US',

  legalLimits: {
    /**
     * The statute's flat 102 in, NOT the administrative code's lane-conditioned
     * 96/102. Recording both as candidates would resolve to null, and a null
     * width limit means the engine can no longer tell that a 14 ft load is over
     * width — it would drop the oversize fee entirely and possibly report that
     * no permit is needed. A conflict that disables the over-dimension check is
     * more dangerous than the conflict it documents, so the disagreement is
     * carried by `al-legal-width-conflict`, which fires in exactly the 8 ft to
     * 8 ft 6 in band where the two sources differ and is silent everywhere else.
     */
    widthIn: [
      fromDated(
        102,
        SB110,
        EFF_STATUTE,
        'SB110, effective 2025-10-01, states a flat 102 in "exclusive of mirrors or other safety devices approved by the Department of Transportation". Ala. Admin. Code r. 450-3-1-.02 still states 8 ft on roads with lanes under 12 ft and 8 ft 6 in on roads with 12 ft lanes — see `al-legal-width-conflict`.',
      ),
    ],
    heightIn: [
      fromDated(
        ftIn(13, 6),
        SB110,
        EFF_STATUTE,
        '"No vehicle, semitrailer, or trailer shall exceed in height 13 1/2 feet, including load." Alabama is one of the lower height states — a 13 ft 9 in load that is legal in Washington or Missouri needs a permit here.',
      ),
    ],
    /**
     * EMPTY ON PURPOSE, and it costs a review flag on every Alabama quote.
     *
     * Neither source states a trailing-unit length limit for the ordinary truck
     * tractor-semitrailer these quotes price. The administrative code's "Fifty-
     * seven (57) feet for a truck-semi-trailer combination" is an OVERALL length
     * for a straight truck pulling a semitrailer, sitting in a list beside "Forty
     * (40) feet for a single vehicle" — reading it as a 57 ft trailing-unit
     * allowance would let a 55 ft trailer through unpermitted on a guess about
     * what the category means. Its other length rows are for doubles (28 or
     * 28 1/2 ft each, in dispute), car haulers (65 ft) and stinger-steered units
     * (75 or 80 ft, in dispute), none of which is a tractor-semitrailer.
     *
     * So Alabama's semitrailer limit is genuinely not on file, the engine says
     * so, and it asks for review rather than choosing between two readings of an
     * ambiguous category heading.
     */
    trailerLengthIn: [],
    /**
     * `overallLengthIn` is ABSENT for the ordinary reason: Alabama caps the
     * overall length of a single vehicle, a truck-semitrailer, a car hauler and
     * a stinger-steered transporter, and states no overall cap for a truck
     * tractor-semitrailer on the National Network, where 23 CFR 658.13 preempts
     * one. Applying any of the published category figures would put every
     * ordinary combination over the legal limit.
     */
    frontOverhangIn: [
      fromDated(
        ftIn(5),
        AC_450_3_1_02,
        EFF_AC_2021,
        'The administrative code\'s reading — five feet at each end. SB110 reads as five feet in TOTAL across both ends; see `al-overhang-total-vs-each-end-conflict`, which fires whenever the two readings can differ. The per-end figure is used here because it is the only one the model can hold, and it is the reading that flags FEWER loads as over the limit, so it does not manufacture an over-dimension the state may not assert.',
      ),
    ],
    rearOverhangIn: [
      fromDated(
        ftIn(5),
        AC_450_3_1_02,
        EFF_AC_2021,
        'Same rule and same conflict as the front overhang. Note that an escort is separately required over five feet of rear overhang, so this limit and the escort trigger sit on the same number.',
      ),
    ],
    grossWeightLbs: [
      fromDated(
        80000,
        SB110,
        EFF_STATUTE,
        '"the overall gross weight may not exceed 80,000 pounds, including the allowable load tolerance." This is the INTERSTATE ceiling and the tolerance is already inside it — it must not receive the one-tenth calculation again. The same provision applies W=500 (LN/(N-1) + 12N + 36) to any group of two or more consecutive axles, which can bind below 80,000 lb; that is checked separately in `bridgeFormula.ts`. Off the Interstate, Alabama uses a Computed Gross Weight Table plus a one-tenth tolerance instead — see `al-non-interstate-limits-unknown`.',
      ),
    ],
    singleAxleLbs: [
      fromDated(
        20000,
        SB110,
        EFF_STATUTE,
        'Interstate ceiling, "including the allowable load tolerance". The non-Interstate base is also 20,000 lb but takes the separate one-tenth tolerance on top.',
      ),
    ],
    tandemAxleLbs: [
      fromDated(
        34000,
        SB110,
        EFF_STATUTE,
        'Interstate ceiling, "including the allowable load tolerance". Alabama publishes NO flat non-Interstate tandem figure — the statute uses axle count, spacing and its Computed Gross Weight Table instead — which is a recorded unknown, not an omission.',
      ),
    ],
  },

  /**
   * $10. The floor of both published columns and, per the administrative code's
   * catch-all rows, the smallest fee Alabama charges for a permit of either
   * kind: "Other overweight loads not herein specified..$10.00", and the same
   * $10 for an over-height-only movement and for a boat or modular home within
   * 12 ft by 75 ft. The dimensional add-on and the weight increment build on it.
   */
  permitBaseFeeUsd: [
    fromDated(
      10,
      FEE_SHEET_2025,
      EFF_FEE_SHEET,
      'The common floor of ALDOT\'s two published columns: "Over Height Only Violation $10", "Boats, M/H, Portable Buildings, Modular Home 12’(3.66) x 75’(22.86) $10", and "Weight Only 80,000 – 100,000 lbs. $10". Corroborated by Ala. Admin. Code r. 450-3-1-.10\'s catch-all "Other overweight loads not herein specified..$10.00".',
    ),
    fromDated(
      10,
      AC_450_3_1_10,
      EFF_AC_2016,
      '"Other overweight loads not herein specified..$10.00"',
    ),
  ],

  /**
   * The dimensional add-on, verbatim from the administrative code and flat at
   * every dimension: "When the overweight vehicle or combination of vehicles and
   * loads is over the maximum length, height, or width specified by law, an
   * additional $10.00 is added to the fee." One unbounded band, because Alabama
   * does not step the dimensional charge by how far over the load is — a load an
   * inch over width and a load 20 ft wide pay the same ten dollars, and the
   * weight bands carry all of the variation.
   */
  oversizeFeeBands: [
    fromDated<OversizeFeeBand>(
      { label: 'over legal length, height or width — flat dimensional charge', feeUsd: 10 },
      AC_450_3_1_10,
      EFF_AC_2016,
      '"an additional $10.00 is added to the fee." Added to the $10 base it reproduces ALDOT\'s "W/H/L: up to 100,000 lbs. $20" row exactly, and added to each Weight Only band it reproduces the rest of the General column.',
    ),
  ],

  overweightPricing: [
    fromDated<OverweightPricing>(
      {
        kind: 'bands',
        explanation:
          'ALDOT prices the overweight component in four flat gross-weight steps with no mileage and no axle multiplier: "Weight Only 80,000 – 100,000 lbs. $10 100,001 – 125,000 lbs. $30 125,001 – 150,000 lbs. $60 Over 150,000 lbs. $100". The bands below hold what remains of each of those totals after the $10 permit base, which is what makes the base, the dimensional add-on and the increment sum back to ALDOT\'s printed figures.',
      },
      FEE_SHEET_2025,
      EFF_FEE_SHEET,
    ),
  ],

  overweightBands,

  /** Alabama's permit fee has no mileage component of any kind. */
  overweightPerMile: [],

  /**
   * EMPTY, AS A FINDING. Alabama attaches no weight-conditioned surcharge to a
   * single-trip permit — the fee stays at $100 (Weight Only) or $110 (General)
   * however far past the 300,000 lb superload line the load goes, and ALDOT's
   * published sheet identifies no separate superload permit charge at all. What
   * a superload does add is ALEA escort billing and privately obtained survey
   * and bucket-truck costs, none of which is an ALDOT fee.
   */
  conditionalFees: [],

  transactionFee: [
    fromDated<TransactionFee>(
      { perPermitUsd: 4, percentOfTotal: 0 },
      FEE_SHEET_2025,
      EFF_FEE_SHEET,
      '"A fee of $4 will be added to each credit card transaction" — a fixed amount, not a percentage, and no percentage surcharge appears anywhere on the schedule. It applies to card payments; a permit paid another way would not carry it.',
    ),
  ],

  /**
   * EMPTY, AND THE EMPTINESS IS THE FINDING. A weighted Alabama superload needs
   * a Special Work Authorization so ALDOT's Bridge Rating Office can analyse
   * every structure on the route, and a detailed route survey for every
   * superload. NEITHER HAS A PUBLISHED COST. Putting a number here would invent
   * the one figure Alabama's superload memorandum conspicuously does not give.
   */
  routeAnalysisFeeUsd: [],
  noBridgeRouteFeeUsd: [],

  superload: {
    grossWeight: [
      fromUndatedDoc<Threshold>(
        { value: 300000, inclusive: false },
        SUPERLOAD_MEMO,
        '"a Superload will be defined as any load where one or more of the following dimensions are exceeded: ... Weight 300,000 lbs. gross weight" — "exceeded", so 300,000 lb exactly is not yet a superload. The memorandum carries no date, so this row is effective only from our retrieval date.',
      ),
    ],
    /** Alabama publishes no short-axle-spacing superload trigger. */
    shortSpacing: [],
    widthIn: [
      fromUndatedDoc<Threshold>({ value: ftIn(16), inclusive: false }, SUPERLOAD_MEMO),
    ],
    heightIn: [
      fromUndatedDoc<Threshold>({ value: ftIn(16), inclusive: false }, SUPERLOAD_MEMO),
    ],
    overallLengthIn: [
      fromUndatedDoc<Threshold>({ value: ftIn(150), inclusive: false }, SUPERLOAD_MEMO),
    ],
  },

  /**
   * Alabama's only published survey trigger is for HOUSES over 17 ft high, and
   * for superloads, where the survey is required by category rather than by a
   * dimension. Neither is a general width or length inspection trigger, so those
   * lists are empty rather than guessed — inventing one would send loads to an
   * inspection the state never asked for. The house trigger is carried by
   * `al-house-over-17-route-survey`, which can say that it applies to houses.
   */
  routeInspection: {
    widthIn: [],
    heightIn: [],
    lengthIn: [],
  },

  escortRules: ALABAMA_ESCORT_RULES,

  /** Flat weight bands. Nothing in Alabama's permit fee depends on distance. */
  feesDependOnDistance: false,
};
