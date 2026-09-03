/**
 * INDIANA — oversize/overweight single-trip permit rules.
 *
 * Indiana is the most internally contradictory jurisdiction in this dataset.
 * Four state bodies publish OS/OW figures — the Department of Revenue's fee
 * sheet, the DOR's own FAQ and fees webpage, the governing rule 105 IAC
 * 10-1.5-3, and the Indiana State Police — and they disagree with each other
 * about the superload weight, the superload width, the executive fee and when
 * it attaches. None of those disagreements is resolved here. They are recorded.
 *
 * FIVE THINGS TO KNOW BEFORE TRUSTING A NUMBER HERE
 * -------------------------------------------------
 *
 * 1. THE SUPERLOAD WEIGHT HAS FOUR OFFICIAL ANSWERS. ISP says over 108,000 lb,
 *    the DOR FAQ says 120,000 lb, the July 2026 DOR fee sheet says 200,000 lb,
 *    and 105 IAC's superload definition states no weight at all. Three rows are
 *    on file and the resolver refuses to pick — which is why `engine.ts` has a
 *    dedicated branch that raises the disagreement only for a load BETWEEN the
 *    lowest and the highest candidate. A 90,000 lb load is not a superload on
 *    any reading and gets no warning; a 250,000 lb load is one on every reading
 *    and gets no range.
 *
 * 2. THE SUPERLOAD WIDTH HAS TWO. 105 IAC and the DOR FAQ say more than 16 ft;
 *    the July 2026 fee sheet and the ISP page say more than 17 ft. Both pairs
 *    are on file and both are cited.
 *
 * 3. THE FEE DECOMPOSES INTO A BASE PLUS A DIMENSIONAL INCREMENT, and that is
 *    what reproduces every published total. 105 IAC prints "$20 / $30 / $40" as
 *    oversize "base fees" AND "twenty dollars ($20)" as the base fee for an
 *    overweight load — one base, reached from either side. Holding
 *    `permitBaseFeeUsd = 20` with increments of $0 / $10 / $20 makes all of the
 *    published rows come out right: the $20 and $30 oversize totals, the
 *    "$20 base fee + $0.35 per mile" overweight row, and 105 IAC's combined
 *    "$30 base fee + $0.35 per mile" OS/OW row. Encoding the bands as $20/$30/
 *    $40 with a zero base instead would drop the base from every OVERWEIGHT-
 *    ONLY permit, which is legal-size and matches no dimensional band.
 *
 * 4. OVERSIZE AND OVERWEIGHT DO NOT ADD IN INDIANA — the DOR fee sheet says
 *    "Whichever of the calculated oversize or overweight fees is greater." Note
 *    that 105 IAC's own OS/OW table instead prints the dimensional base and the
 *    per-mile charge joined by addition (its "Over 12'4" wide ...; 80,001 to
 *    108,000 lbs" row is "$30 base fee + $0.35 per mile"). The two readings
 *    part company above roughly 29 in-state miles. The DOR sheet is the newer
 *    document and the only one that states an OPERATION rather than a table, so
 *    `greaterOf` is recorded — with the divergence written on the row, because
 *    the base-plus-increment decomposition above means both readings remain
 *    computable and the difference is visible rather than buried.
 *
 * 5. THE OVERWEIGHT FEE IS PER MILE, SO INDIANA CANNOT BE QUOTED WITHOUT
 *    IN-STATE MILEAGE. "$0.35 per mile" / "$0.60 per mile" / "$1.00 per mile"
 *    by gross weight. `feesDependOnDistance` is true and the engine refuses
 *    rather than billing a whole lane's miles to one state.
 *
 * WHAT INDIANA DOES NOT PUBLISH — recorded as absences, never filled in
 * ---------------------------------------------------------------------
 *   - No overall combination length. IC 9-20-13-2 caps the SEMITRAILER UNIT at
 *     53 ft and imposes no maximum overall length on a truck-tractor-
 *     semitrailer, so `overallLengthIn` is omitted. (The DOR webpage's 60 ft
 *     figure is a permit-ELIGIBILITY rule for its "Truck/Trailer" class, not a
 *     fifth-wheel tractor-semitrailer limit, and is not a legal limit.)
 *   - No overhang limits and no overhang escort trigger. Both are express
 *     unknowns in the sources, so `frontOverhangIn` and `rearOverhangIn` are
 *     omitted rather than held as empty arrays.
 *   - No resolvable executive fee. 105 IAC's administrative-fee subsection says
 *     $25, its own schedule and the DOR fee sheet say $10, and the trigger is
 *     over 108,000 lb in the rule and over 120,000 lb on the fee sheet. Four
 *     readings, no resolution — so `conditionalFees` is EMPTY and any load in
 *     the disputed band is sent to review by an escort rule instead of being
 *     charged a figure picked at random.
 *   - No pilot-car operator certification, and no affirmative statement that
 *     none is required. Recorded as an unknown on the advisory.
 */
import type { SourceDoc, Sourced } from '../provenance.js';
import { ftIn, type EscortRule } from '../escortRules.js';
import type {
  JurisdictionOsowRules,
  CombinedFeeRule,
  OversizeFeeBand,
  OverweightPricing,
  PerMileRate,
  Threshold,
  TransactionFee,
} from '../types.js';

const RETRIEVED = '2026-09-01';

// ── Source documents ──────────────────────────────────────────────────────

/** The governing rule. Dated, effective, and the law. */
const IAC_105_10_1_5_3: SourceDoc = {
  id: 'in-105-iac-10-1-5-3',
  title: '105 IAC 10-1.5-3 — Oversize/overweight vehicle permit fees (Indiana Register)',
  url: 'https://iar.iga.in.gov/register/20250611-IR-105250065FRA',
  publisher: 'Indiana Register / Indiana Department of Revenue',
  revisedOn: '2025-05-16',
  retrievedOn: RETRIEVED,
  cite: '(a) administrative fees; (b) oversize base fees $20/$30/$40; (c) $20 overweight base fee; (h) the full fee schedule; "superload" definition',
};

/** The current DOR fee sheet. Month-only date, recorded as the 1st. */
const DOR_FEE_SHEET: SourceDoc = {
  id: 'in-dor-osow-permit-fees-2026-07',
  title: 'Indiana DOR — Oversize/Overweight Vehicle Permit Fees (July 2026, PDF)',
  url: 'https://www.in.gov/dor/motor-carrier-services/files/osow-vehicle-permit-fees.pdf',
  publisher: 'Indiana Department of Revenue, Motor Carrier Services',
  revisedOn: '2026-07-01',
  retrievedOn: RETRIEVED,
  cite: 'legal limits; single-trip oversize and overweight tables; "Whichever of the calculated oversize or overweight fees is greater"; super load thresholds. Month-only date, recorded as the 1st.',
};

const IC_TITLE_9: SourceDoc = {
  id: 'in-ic-title-9-2026',
  title: 'Ind. Code Title 9 — Motor Vehicles (size and weight limits)',
  url: 'https://iga.in.gov/ic/2026/Title_9.html',
  publisher: 'Indiana General Assembly',
  revisedOn: '2026-01-01',
  retrievedOn: RETRIEVED,
  cite: 'IC 9-20-4-1 bridge formula and 80,000 lb ceiling; axle and tandem limits; IC 9-20-13-2 semitrailer unit 53 ft. Year-only date, recorded as 1 January.',
};

/** The undated DOR fees webpage. Partly superseded — see the $40 band note. */
const DOR_FEES_PAGE: SourceDoc = {
  id: 'in-dor-fines-fees-penalties',
  title: 'Indiana DOR — Fines, Fees & Penalties (oversize permit schedule)',
  url: 'https://www.in.gov/dor/resources/legal/fines-fees-penalties/',
  publisher: 'Indiana Department of Revenue',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'Oversize Permit #1/#2/#3 at $20/$30/$40; states 15-day single-trip validity where the July 2026 fee sheet states 5 days',
};

const DOR_FAQ: SourceDoc = {
  id: 'in-dor-mcs-faq',
  title: 'Indiana DOR — Motor Carrier Services frequently asked questions',
  url: 'https://www.in.gov/dor/motor-carrier-services/frequently-asked-questions-motor-carrier-services/',
  publisher: 'Indiana Department of Revenue',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: '"A \'Superload\' is any load that exceeds 15 feet high, 16 feet wide, 110 feet long, and/or 120,000 pounds, or fails the overload analysis."',
};

const DOR_OSOW_PAGE: SourceDoc = {
  id: 'in-dor-osow-page',
  title: 'Indiana DOR — Oversize/Overweight (OSW)',
  url: 'https://www.in.gov/dor/motor-carrier-services/oversizeoverweight-osw/',
  publisher: 'Indiana Department of Revenue',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'two-vehicle combinations of 60 ft or more are not eligible for an OSOW permit unless registered as a tractor trailer',
};

/** M-204, "Rev. April 2022" — the statewide escort provisions. */
const DOR_M_204: SourceDoc = {
  id: 'in-dor-m-204-2022-04',
  title: 'Indiana DOR Form M-204 — Oversize/Overweight permit provisions (PDF)',
  url: 'https://www.in.gov/dor/files/M-204.pdf',
  publisher: 'Indiana Department of Revenue',
  revisedOn: '2022-04-01',
  retrievedOn: RETRIEVED,
  cite: 'escort thresholds at 12 ft 4 in wide, 110 ft long, 14 ft 6 in high; height stick; escort vehicle equipment. Month-only date, recorded as the 1st.',
};

/** M-204S. CARRIES NO REVISION DATE AT ALL — `revisedOn` is null. */
const DOR_M_204S: SourceDoc = {
  id: 'in-dor-m-204s',
  title: 'Indiana DOR Form M-204S — Superload permit provisions (PDF)',
  url: 'https://www.in.gov/dor/files/m204s.pdf',
  publisher: 'Indiana Department of Revenue',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'police escort over 200,000 lb with the interstate-only exception; width over 17 ft; route survey triggers; bucket-truck requirement over 15 ft high',
};

const ISP_SUPERLOAD: SourceDoc = {
  id: 'in-isp-superload-escorts',
  title: 'Indiana State Police — Superload escorts',
  url: 'https://www.in.gov/isp/commercial-vehicles/superload-escorts/',
  publisher: 'Indiana State Police',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: '"Width exceeding 17 feet; Height exceeding 15 feet; Length exceeding 110 feet; Weight exceeding 108,000 pounds"',
};

const ISP_AGREEMENT: SourceDoc = {
  id: 'in-isp-superload-agreement-2019-03',
  title: 'Indiana State Police — Superload Motor Carrier Escort Agreement (PDF)',
  url: 'https://www.in.gov/isp/files/Superload-Agreement-Effective-3.1.2019.pdf',
  publisher: 'Indiana State Police',
  revisedOn: '2019-03-01',
  retrievedOn: RETRIEVED,
  cite: 'sworn trooper $43.00 per hour; motor carrier inspector $34.00 per hour; hours computed round trip from the officers\' homes',
};

const IDOA_MILEAGE: SourceDoc = {
  id: 'in-idoa-mileage-rate-2026-08',
  title: 'Indiana IDOA — State mileage reimbursement rate (PDF)',
  url: 'https://www.in.gov/idoa/procurement/files/State-Mileage-Reimbursement-Rate-2026-08.07.2026.pdf',
  publisher: 'Indiana Department of Administration',
  revisedOn: '2026-08-06',
  retrievedOn: RETRIEVED,
  cite: '"Effective August 7, 2026, the personal vehicle mileage reimbursement rate for state employees will be $0.64 per mile."',
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

/** A row from an UNDATED page — effective only from our retrieval date. */
function fromUndatedPage<T>(value: T, source: SourceDoc, note?: string): Sourced<T> {
  return {
    value,
    source,
    effectiveFrom: RETRIEVED,
    effectiveTo: null,
    ...(note === undefined ? {} : { note }),
  };
}

const EFF_RULE = '2025-05-16'; // 105 IAC 10-1.5-3
const EFF_FEE_SHEET = '2026-07-01';
const EFF_IC = '2026-01-01';
const EFF_M_204 = '2022-04-01';

// Indiana states its dimensional bands in inches and in feet-and-inches, and
// they are the same numbers: 148 in = 12 ft 4 in, 162 in = 13 ft 6 in.
const BAND_WIDTH_IN = 148;
const BAND_HEIGHT_IN = 162;
const BAND_LENGTH_IN = ftIn(95);
const SUPER_WIDTH_IN = ftIn(16);
const SUPER_HEIGHT_IN = ftIn(15);
const SUPER_LENGTH_IN = ftIn(110);

// ── Escort rules ──────────────────────────────────────────────────────────

function escortRule(
  id: string,
  description: string,
  when: EscortRule['when'],
  then: EscortRule['then'],
  source: SourceDoc = DOR_M_204,
  effectiveFrom: string = EFF_M_204,
): EscortRule {
  return { id, jurisdiction: 'IN', description, when, then, source, effectiveFrom, effectiveTo: null };
}

/**
 * Indiana escorts.
 *
 * The base rule is a bare count because only the POSITION moves with the road
 * type: "One escort vehicle must be in front when on undivided highway and in
 * rear when on divided highways." One car either way, so a quote does not need
 * the highway class to price it.
 *
 * The 14 ft 4 in to 17 ft width band is the exception, and it genuinely needs
 * the road class, because there the COUNT changes: "one rear escort on a dual
 * lane divided highway and two escorts (front and rear) on all other roads."
 * Those are two rules with a `routeClass` condition, so a load in that band
 * with no stated highway type correctly goes to review — and a load outside the
 * band resolves to a definite `false` and raises nothing.
 */
export const INDIANA_ESCORT_RULES: EscortRule[] = [
  escortRule(
    'in-base-dimensions',
    'Over 12 ft 4 in wide, over 110 ft long or over 14 ft 6 in high — one escort (in front on an undivided highway, in the rear on a divided highway)',
    {
      kind: 'any',
      of: [
        { kind: 'gt', measure: 'widthIn', value: BAND_WIDTH_IN },
        { kind: 'gt', measure: 'overallLengthIn', value: SUPER_LENGTH_IN },
        { kind: 'gt', measure: 'heightIn', value: ftIn(14, 6) },
      ],
    },
    { escorts: 1 },
  ),
  escortRule(
    'in-height-over-14-6',
    'Over 14 ft 6 in high — an escort carrying a height stick must travel in front of the load',
    { kind: 'gt', measure: 'heightIn', value: ftIn(14, 6) },
    { escorts: 1, front: 1, heightPole: true },
  ),
  escortRule(
    'in-width-14-4-to-17-divided',
    'Over 14 ft 4 in up to 17 ft wide on a dual-lane divided highway — one rear escort',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: ['divided', 'interstate'] },
        { kind: 'between', measure: 'widthIn', min: ftIn(14, 4), max: ftIn(17) },
      ],
    },
    { escorts: 1, rear: 1 },
  ),
  escortRule(
    'in-width-14-4-to-17-other',
    'Over 14 ft 4 in up to 17 ft wide on any road that is not a dual-lane divided highway — two escorts, front and rear',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: ['two-lane', 'urban'] },
        { kind: 'between', measure: 'widthIn', min: ftIn(14, 4), max: ftIn(17) },
      ],
    },
    { escorts: 2, front: 1, rear: 1 },
  ),
  /**
   * Police escorts. Indiana publishes REAL rates for these — a sworn trooper at
   * $43.00 an hour, a motor carrier inspector at $34.00, mileage at the state
   * rate, all round trip from the officers' homes — and still cannot be priced,
   * because the hours and the officer count are set by ISP on the day and the
   * mileage runs from wherever the officers live.
   */
  escortRule(
    'in-police-over-17-wide',
    'Over 17 ft wide — at least a front and a rear police escort',
    { kind: 'gt', measure: 'widthIn', value: ftIn(17) },
    {
      manualReview:
        'Indiana requires "at least front and rear police escorts" over 17 ft wide, and "required slowdowns may necessitate more at the ISP\'s discretion". The rates ARE published and are citable: the Indiana State Police superload escort agreement effective 1 March 2019 sets a sworn trooper at $43.00 per hour and a motor carrier inspector at $34.00 per hour, each escort must include at least one sworn trooper, and hours are computed round trip from the officers\' homes, with vehicle mileage at Indiana\'s approved state rate of $0.64 per mile from 7 August 2026. The hours, the officer count and the officers\' home locations are all set by ISP on the day, so no police-escort amount is included in the permit total. The 2019 agreement is more than three years old and remains the document ISP links.',
    },
    DOR_M_204S,
    RETRIEVED,
  ),
  escortRule(
    'in-police-over-200000',
    'Over 200,000 lb — an Indiana State Police escort is required unless the whole route is interstate, there are no required slowdowns, and the load is under 250,000 lb',
    { kind: 'gt', measure: 'grossWeightLbs', value: 200000 },
    {
      manualReview:
        'Indiana requires an ISP escort for all vehicles over 200,000 lb GVW "unless all of the following criteria are met: the permitted route travels only on interstates, there are no required slowdowns and the vehicle weighs less than 250,000 lbs. GVW". Whether the route is interstate-only and whether slowdowns are imposed are both determined when the permit issues, so the exception cannot be evaluated in advance. The ISP page separately says a superload of 200,000 lb or more requires a police escort "if the route includes bridge slowdowns", and that one under 200,000 lb "may require a police escort depending on road conditions". No police-escort cost is included.',
    },
    DOR_M_204S,
    RETRIEVED,
  ),
  /**
   * The executive fee sits behind a manual-review rather than a
   * `conditionalFee`, because Indiana publishes four irreconcilable readings of
   * it and picking any one would be inventing $10 or $15 of a real charge. The
   * trigger is the LOWEST of the published thresholds, so a load that no source
   * would charge is not sent to review.
   */
  escortRule(
    'in-executive-fee-conflict',
    'Over 108,000 lb — an executive fee applies, and Indiana publishes four different readings of its amount and trigger',
    { kind: 'gt', measure: 'grossWeightLbs', value: 108000 },
    {
      manualReview:
        'Indiana charges an "executive fee" on a heavy overweight permit and does not agree with itself about it. 105 IAC 10-1.5-3(a)(5) says "Twenty-five dollars ($25) for an executive fee" and defines the fee as one "imposed for overweight permits where the vehicle weighs more than one hundred eight thousand (108,000) pounds". The same rule\'s own fee schedule instead prints "$10 executive fee", and the July 2026 DOR fee sheet says "Vehicles over 120,000 lbs. are charged a $10.00 executive fee". That is $10 or $25, above 108,000 lb or above 120,000 lb, with no basis in the published sources for choosing. No executive fee is included in the total below and it must be confirmed with DOR Motor Carrier Services before the permit is bought.',
    },
    IAC_105_10_1_5_3,
    EFF_RULE,
  ),
  /**
   * Indiana's condition-based requirements and unpriced charges, on one
   * advisory. They are real exclusions from the quote rather than defects in
   * it: a bridge-review fee depends on how many bridges the APPROVED route
   * crosses, which does not exist until the permit does.
   */
  escortRule(
    'in-conditional-and-unpriced',
    'Indiana adds escort, survey and per-bridge charges that are set when the permit issues, and publishes no price for several of them',
    {
      kind: 'any',
      of: [
        { kind: 'gt', measure: 'widthIn', value: 102 },
        { kind: 'gt', measure: 'heightIn', value: ftIn(13, 6) },
        { kind: 'gt', measure: 'grossWeightLbs', value: 80000 },
      ],
    },
    {
      advisory:
        'Indiana adds charges and requirements this quote cannot include. A bridge review fee of $10 "is imposed for each bridge on the route and is in addition to the base permit fee", and the number of bridges is not known until the route is approved; a superload additionally carries a $25 design fee and a $10 review fee. A route survey is required over 17 ft high, and over 18 ft wide or over 130 ft long without a rear steerable axle, with no published state price. A movement over 15 ft high routed off the interstate system must be accompanied by "a pre-qualified signal contractor with a bucket truck, for each permitted load", at the applicant\'s expense. A permit that carries weight restrictions requires "a minimum of two escorts, one in the front and one in the rear", which is set on the permit rather than by any published weight number. Indiana publishes no front- or rear-overhang escort threshold, no height-stick specification, and no separate credit-card or payment-processing surcharge; it also states no pilot-car operator certification requirement, and publishes no affirmative statement that none exists.',
    },
    DOR_M_204S,
    RETRIEVED,
  ),
];

// ── Fee bands ─────────────────────────────────────────────────────────────

/**
 * The oversize INCREMENT above the $20 base fee — $0, $10 and $20, summing to
 * the $20, $30 and $40 totals 105 IAC prints. See point 3 of the header for why
 * the decomposition rather than the printed totals is what is stored.
 *
 * Bands are mutually exclusive: the $30 rows are written as "over one of the
 * $20 ceilings and within the superload ceilings", split into three disjoint
 * shapes because `OversizeFeeBand` ANDs its bounds and the rule's trigger is a
 * disjunction. The July 2026 DOR fee sheet corroborates exactly these
 * boundaries — "between 96' and 110' in length, 12'5" and 16' wide or 13'7" and
 * 15' tall" is 105 IAC's 95 ft / 148 in / 162 in floors and its 16 ft / 15 ft /
 * 110 ft superload ceilings, to the inch — so each row carries a second
 * corroborating source rather than a competing one.
 */
const oversizeFeeBands: Sourced<OversizeFeeBand>[] = [
  fromDated<OversizeFeeBand>(
    {
      label: 'within 12 ft 4 in wide, 13 ft 6 in high and 95 ft long — no increment above the $20 base fee',
      upToWidthIn: { value: BAND_WIDTH_IN, inclusive: false },
      upToHeightIn: { value: BAND_HEIGHT_IN, inclusive: false },
      upToLengthIn: { value: BAND_LENGTH_IN, inclusive: false },
      feeUsd: 0,
    },
    IAC_105_10_1_5_3,
    EFF_RULE,
    '105 IAC 10-1.5-3(b)(1): "Twenty dollars ($20) for a vehicle with dimensions not more than: (A) one hundred forty-eight (148) inches wide; (B) one hundred sixty-two (162) inches high; or (C) ninety-five (95) feet long." That $20 IS the base fee held in `permitBaseFeeUsd`, so this band adds nothing — the two together are the published $20 total.',
  ),
  fromDated<OversizeFeeBand>(
    {
      label: 'over 12 ft 4 in up to 16 ft wide — $10 above the base fee',
      overWidthIn: { value: BAND_WIDTH_IN, inclusive: false },
      upToWidthIn: { value: SUPER_WIDTH_IN, inclusive: false },
      upToHeightIn: { value: SUPER_HEIGHT_IN, inclusive: false },
      upToLengthIn: { value: SUPER_LENGTH_IN, inclusive: false },
      feeUsd: 10,
    },
    IAC_105_10_1_5_3,
    EFF_RULE,
    '105 IAC 10-1.5-3(b)(2): "Thirty dollars ($30) for a vehicle with dimensions that exceed: (A) one hundred forty-eight (148) inches wide ..." — $20 base plus this $10 increment. Bounded above by the superload dimensions, where the $40 band begins.',
  ),
  fromDated<OversizeFeeBand>(
    {
      label: 'over 13 ft 6 in up to 15 ft high, within 12 ft 4 in wide — $10 above the base fee',
      upToWidthIn: { value: BAND_WIDTH_IN, inclusive: false },
      overHeightIn: { value: BAND_HEIGHT_IN, inclusive: false },
      upToHeightIn: { value: SUPER_HEIGHT_IN, inclusive: false },
      upToLengthIn: { value: SUPER_LENGTH_IN, inclusive: false },
      feeUsd: 10,
    },
    IAC_105_10_1_5_3,
    EFF_RULE,
    'The same $30 band reached on height alone — "(B) one hundred sixty-two (162) inches high". Bounded at the $20 width ceiling so it cannot also match a load already covered by the width row above; two matching rows with different bounds would be read by the resolver as two sources disagreeing, which they are not.',
  ),
  fromDated<OversizeFeeBand>(
    {
      label: 'over 95 ft up to 110 ft long, within 12 ft 4 in wide and 13 ft 6 in high — $10 above the base fee',
      upToWidthIn: { value: BAND_WIDTH_IN, inclusive: false },
      upToHeightIn: { value: BAND_HEIGHT_IN, inclusive: false },
      overLengthIn: { value: BAND_LENGTH_IN, inclusive: false },
      upToLengthIn: { value: SUPER_LENGTH_IN, inclusive: false },
      feeUsd: 10,
    },
    IAC_105_10_1_5_3,
    EFF_RULE,
    'The same $30 band reached on length alone — "(C) ninety-five (95) feet long". The July 2026 DOR fee sheet prints the same window as "between 96\' and 110\' in length".',
  ),
  fromDated<OversizeFeeBand>(
    {
      label: 'over 16 ft wide — superload; $20 above the base fee',
      overWidthIn: { value: SUPER_WIDTH_IN, inclusive: false },
      feeUsd: 20,
    },
    IAC_105_10_1_5_3,
    EFF_RULE,
    '105 IAC 10-1.5-3(b)(3): "Forty dollars ($40) for an oversize/overweight superload", and the rule\'s superload definition is "more than fifteen (15) feet high; more than sixteen (16) feet wide; or more than one hundred ten (110) feet long" — $20 base plus this $20 increment. A load in this band is a superload on the rule\'s own reading and the engine will refuse to price it; the row exists so the schedule is complete. The DOR documents describe this $40 row incoherently — the July 2026 fee sheet prints "$40.00: up to 95\' in length, 16\' wide, 15\' tall and 80,000 lbs." while the undated DOR fees webpage prints "over 110\' length, 16\' wide, 15\' tall, 80,000 lbs." — so the rule\'s structure is used and the DOR wording is recorded rather than encoded.',
  ),
  fromDated<OversizeFeeBand>(
    {
      label: 'over 15 ft high, within 16 ft wide — superload; $20 above the base fee',
      upToWidthIn: { value: SUPER_WIDTH_IN, inclusive: false },
      overHeightIn: { value: SUPER_HEIGHT_IN, inclusive: false },
      feeUsd: 20,
    },
    IAC_105_10_1_5_3,
    EFF_RULE,
    'The same $40 superload band reached on height alone, bounded at 16 ft wide for the same mutual-exclusivity reason as the $10 rows.',
  ),
  fromDated<OversizeFeeBand>(
    {
      label: 'over 110 ft long, within 16 ft wide and 15 ft high — superload; $20 above the base fee',
      upToWidthIn: { value: SUPER_WIDTH_IN, inclusive: false },
      upToHeightIn: { value: SUPER_HEIGHT_IN, inclusive: false },
      overLengthIn: { value: SUPER_LENGTH_IN, inclusive: false },
      feeUsd: 20,
    },
    IAC_105_10_1_5_3,
    EFF_RULE,
    'The same $40 superload band reached on length alone.',
  ),
];

/**
 * The overweight rate, flat per mile inside Indiana and stepped by gross
 * weight. 105 IAC and the July 2026 DOR fee sheet print identical bands and
 * identical rates, so each band carries two corroborating rows.
 *
 * The $20 that both documents write beside these rates ("$20 base fee + $0.35
 * per mile") is NOT repeated here — it is the same base fee held once in
 * `permitBaseFeeUsd`, and adding it again would double-charge every combined
 * oversize/overweight permit.
 */
const OW_BANDS: Array<{ min: number; max: number | null; rate: number; label: string }> = [
  { min: 80001, max: 108000, rate: 0.35, label: 'up to 108,000 lbs' },
  { min: 108001, max: 150000, rate: 0.6, label: 'over 108,000 lbs to 150,000 lbs' },
  { min: 150001, max: null, rate: 1, label: 'over 150,000 lbs' },
];

const overweightPerMile: Sourced<PerMileRate>[] = OW_BANDS.flatMap((b) => {
  const rate: PerMileRate = {
    minLbs: b.min,
    maxLbs: b.max,
    ratePerMileUsd: b.rate,
    // Flat per mile — the rate does not step with each increment of excess.
    perIncrementLbs: null,
    excessBaseLbs: null,
    roundIncrementUp: false,
    minimumUsd: null,
    maximumUsd: null,
  };
  return [
    fromDated<PerMileRate>(
      rate,
      IAC_105_10_1_5_3,
      EFF_RULE,
      `105 IAC 10-1.5-3(h): "${b.label} | $20 base fee + $${b.rate.toFixed(2)} per mile". The $20 base is held once in \`permitBaseFeeUsd\` and is not repeated in this rate.`,
    ),
    fromDated<PerMileRate>(rate, DOR_FEE_SHEET, EFF_FEE_SHEET, 'The July 2026 DOR fee sheet prints the same band and the same rate.'),
  ];
});

// ── The jurisdiction ──────────────────────────────────────────────────────

export const INDIANA_OSOW_RULES: JurisdictionOsowRules = {
  code: 'IN',
  name: 'Indiana',
  country: 'US',

  legalLimits: {
    widthIn: [
      fromDated(
        102,
        DOR_FEE_SHEET,
        EFF_FEE_SHEET,
        'DOR fee sheet: a permit is required above "8 feet, 6 inches in width", among the other listed limits.',
      ),
    ],
    heightIn: [
      fromDated(ftIn(13, 6), DOR_FEE_SHEET, EFF_FEE_SHEET, 'DOR fee sheet: "13 feet, 6 inches in height".'),
    ],
    trailerLengthIn: [
      fromDated(
        ftIn(53),
        IC_TITLE_9,
        EFF_IC,
        'IC 9-20-13-2: "The maximum length of the semitrailer unit operating in a truck-tractor-semitrailer combination is fifty-three (53) feet, including the vehicle and the load." The section imposes NO maximum overall length on the combination, which is why `overallLengthIn` is absent.',
      ),
      fromDated(ftIn(53), DOR_FEE_SHEET, EFF_FEE_SHEET, 'DOR fee sheet: "53 feet in length for a loaded semi-tractor-trailer connected by a fifth wheel hookup".'),
    ],
    // `overallLengthIn`, `frontOverhangIn` and `rearOverhangIn` are absent by
    // design. See the module header — Indiana publishes none of the three.
    grossWeightLbs: [
      fromDated(
        80000,
        IC_TITLE_9,
        EFF_IC,
        'IC 9-20-4-1: "The overall gross weight limit, calculated under this subdivision, may not exceed eighty thousand (80,000) pounds." This is a ceiling on the bridge-formula result, not an entitlement — axle spacing, axle limits and posted restrictions can each produce a lower legal weight.',
      ),
      fromDated(80000, DOR_FEE_SHEET, EFF_FEE_SHEET, 'DOR fee sheet: a permit is required "over 80,000 lbs. gross vehicle weight and/or over axle weights according Federal Bridge Laws".'),
    ],
    singleAxleLbs: [
      fromDated(
        20000,
        IC_TITLE_9,
        EFF_IC,
        'IC 9-20-4: "an axle weight in excess of twenty thousand (20,000) pounds". A separate limit of 800 lb per inch of tire width measured between the rim flanges also applies and is not modelled, because a quote does not collect tyre width.',
      ),
    ],
    tandemAxleLbs: [
      fromDated(
        34000,
        IC_TITLE_9,
        EFF_IC,
        'IC 9-20-4: "(A) Thirty-four thousand (34,000) pounds total weight. (B) Twenty thousand (20,000) pounds on an individual axle in a tandem group."',
      ),
    ],
  },

  /**
   * $20 — the base fee, and the ONE flat component. Both sides of Indiana's
   * schedule start from it: 105 IAC reaches it as the lowest oversize base fee
   * ("(b)(1) Twenty dollars ($20) ...") and states it again as the overweight
   * base ("(c) The base fee for an overweight load is twenty dollars ($20)").
   * Holding it once, with $0 / $10 / $20 dimensional increments above it, is
   * what makes an overweight-only permit — which is legal-size and matches no
   * dimensional band — come out at $20 plus its per-mile charge rather than the
   * per-mile charge alone. See point 3 of the header.
   */
  permitBaseFeeUsd: [
    fromDated(
      20,
      IAC_105_10_1_5_3,
      EFF_RULE,
      '105 IAC 10-1.5-3(c): "The base fee for an overweight load is twenty dollars ($20)", and (b)(1) sets the same $20 as the base fee for a vehicle within 148 in wide, 162 in high and 95 ft long.',
    ),
    fromDated(
      20,
      DOR_FEE_SHEET,
      EFF_FEE_SHEET,
      'The July 2026 DOR fee sheet prints "$20.00 + $0.35 per mile for vehicles up to 108,000 lbs." and "$20.00: up to 95\' in length, 13\'6" in height, 12\'4" wide" — the same $20 reached from the overweight and the oversize side.',
    ),
  ],

  oversizeFeeBands,

  /**
   * THE RULE THAT MAKES INDIANA DIFFERENT FROM PENNSYLVANIA. Recorded as
   * sourced data so no future edit can quietly restore the additive behaviour.
   */
  combinedFeeRule: [
    fromDated<CombinedFeeRule>(
      {
        kind: 'greaterOf',
        explanation:
          'Indiana charges "Whichever of the calculated oversize or overweight fees is greater" (Indiana DOR OS/OW permit fee sheet, July 2026) rather than adding them. Note that 105 IAC 10-1.5-3(h) instead prints its combined oversize/overweight rows as a dimensional base fee PLUS the per-mile charge — its "Over 12\'4" wide, 13\'6" high, 95\' long; 80,001 to 108,000 lbs" row reads "$30 base fee + $0.35 per mile" — and the two readings part company above roughly 29 miles travelled inside Indiana. The DOR fee sheet is the newer document and the only one that states an operation rather than a table, so the greater-of reading is used; a combined permit near that crossover should be confirmed with DOR Motor Carrier Services.',
      },
      DOR_FEE_SHEET,
      EFF_FEE_SHEET,
    ),
  ],

  overweightPricing: [
    fromDated<OverweightPricing>(
      {
        kind: 'perMile',
        explanation:
          '105 IAC 10-1.5-3 prices the overweight component per mile, stepped by gross vehicle weight — $0.35 per mile up to 108,000 lb, $0.60 over 108,000 through 150,000, and $1.00 above that — on top of a single $20 base fee. It is not a per-axle schedule; axle configuration affects eligibility and bridge analysis, not this charge.',
      },
      IAC_105_10_1_5_3,
      EFF_RULE,
    ),
    fromDated<OverweightPricing>(
      {
        kind: 'perMile',
        explanation:
          'The July 2026 DOR fee sheet prints the same three per-mile bands with no weight-step table and no per-axle column.',
      },
      DOR_FEE_SHEET,
      EFF_FEE_SHEET,
    ),
  ],

  overweightBands: [],
  overweightPerMile,

  /**
   * EMPTY, and that is the finding rather than an omission. Indiana's executive
   * fee is real and unresolvable — $10 or $25, above 108,000 lb or above
   * 120,000 lb, depending which of its own documents is read. Recording any one
   * of the four readings here would put a picked number on the quote; the
   * disputed band is sent to review by `in-executive-fee-conflict` instead. The
   * $10-per-bridge review fee is left out for a different reason: it depends on
   * how many bridges the APPROVED route crosses, which does not exist yet.
   */
  conditionalFees: [],

  /**
   * ZERO, and sourced — not an absent row. The complete published rule lists
   * flat-dollar and per-mile charges and no percentage of any kind.
   */
  transactionFee: [
    fromDated<TransactionFee>(
      { perPermitUsd: 0, percentOfTotal: 0 },
      IAC_105_10_1_5_3,
      EFF_RULE,
      'The rule\'s complete administrative-fee list ("The administrative fees for oversize/overweight vehicle permits are as follows") is flat dollars only and states no percentage-based OS/OW permit surcharge. UNKNOWN, recorded and not filled in: whether the live permit system adds a separate credit-card or third-party payment-processing charge. Any such charge would be the processor\'s, not Indiana\'s.',
    ),
  ],

  /**
   * Empty, and that is the finding. Indiana publishes no FLAT route-analysis or
   * engineering fee. What it publishes instead is a $25 design fee and a $10
   * review fee that attach only to a superload — already unpriced — and a $10
   * bridge review fee charged "for each bridge on the route", where the route
   * is not known until the permit issues. The exclusion is carried on the
   * advisory escort rule.
   */
  routeAnalysisFeeUsd: [],
  noBridgeRouteFeeUsd: [],

  superload: {
    /**
     * THREE ROWS THAT DISAGREE, DELIBERATELY LEFT UNRESOLVED. See point 1 of
     * the header. 105 IAC's own superload definition states no weight at all,
     * which is an absence rather than a fourth candidate and so is not a row.
     */
    grossWeight: [
      fromUndatedPage<Threshold>(
        { value: 108000, inclusive: false },
        ISP_SUPERLOAD,
        'Indiana State Police: "A Superload is any vehicle (plus its load) which exceeds ... Weight exceeding 108,000 pounds." The lowest of the three published thresholds.',
      ),
      fromUndatedPage<Threshold>(
        { value: 120000, inclusive: false },
        DOR_FAQ,
        'DOR FAQ: "A \'Superload\' is any load that exceeds 15 feet high, 16 feet wide, 110 feet long, and/or 120,000 pounds, or fails the overload analysis."',
      ),
      fromDated<Threshold>(
        { value: 200000, inclusive: false },
        DOR_FEE_SHEET,
        EFF_FEE_SHEET,
        'July 2026 DOR fee sheet: "A super load permit is a permit for a load that exceeds any of the following: 15 feet high, 17 feet wide, 110 feet long, 200,000 lbs." The highest of the three, and on the newest document.',
      ),
    ],
    /**
     * Indiana also processes a towed permit as a superload when it "fails the
     * overload analysis" (DOR FAQ) — an engineering outcome, not a measurement,
     * which `shortSpacing` cannot express and a quote cannot evaluate.
     */
    shortSpacing: [],
    /** A SECOND unresolved conflict: 16 ft in two sources, 17 ft in two others. */
    widthIn: [
      fromDated<Threshold>(
        { value: SUPER_WIDTH_IN, inclusive: false },
        IAC_105_10_1_5_3,
        EFF_RULE,
        '105 IAC 10-1.5-3: "\'Superload\' means a vehicle that is ... (B) more than sixteen (16) feet wide".',
      ),
      fromUndatedPage<Threshold>(
        { value: SUPER_WIDTH_IN, inclusive: false },
        DOR_FAQ,
        'DOR FAQ agrees with the rule at 16 feet.',
      ),
      fromDated<Threshold>(
        { value: ftIn(17), inclusive: false },
        DOR_FEE_SHEET,
        EFF_FEE_SHEET,
        'July 2026 DOR fee sheet: "17 feet wide" — one foot higher than the governing rule.',
      ),
      fromUndatedPage<Threshold>(
        { value: ftIn(17), inclusive: false },
        ISP_SUPERLOAD,
        'Indiana State Police: "Width exceeding 17 feet" — agrees with the fee sheet, not with the rule.',
      ),
    ],
    /** All four sources agree on height. */
    heightIn: [
      fromDated<Threshold>(
        { value: SUPER_HEIGHT_IN, inclusive: false },
        IAC_105_10_1_5_3,
        EFF_RULE,
        '"(A) more than fifteen (15) feet high"',
      ),
      fromDated<Threshold>({ value: SUPER_HEIGHT_IN, inclusive: false }, DOR_FEE_SHEET, EFF_FEE_SHEET, '"15 feet high"'),
      fromUndatedPage<Threshold>({ value: SUPER_HEIGHT_IN, inclusive: false }, ISP_SUPERLOAD, '"Height exceeding 15 feet"'),
    ],
    /** All four sources agree on length. */
    overallLengthIn: [
      fromDated<Threshold>(
        { value: SUPER_LENGTH_IN, inclusive: false },
        IAC_105_10_1_5_3,
        EFF_RULE,
        '"(C) more than one hundred ten (110) feet long"',
      ),
      fromDated<Threshold>({ value: SUPER_LENGTH_IN, inclusive: false }, DOR_FEE_SHEET, EFF_FEE_SHEET, '"110 feet long"'),
      fromUndatedPage<Threshold>({ value: SUPER_LENGTH_IN, inclusive: false }, ISP_SUPERLOAD, '"Length exceeding 110 feet"'),
    ],
  },

  /**
   * Route-survey triggers, all from M-204S. The length trigger carries a
   * qualifier the threshold alone cannot: it applies to a load over 130 ft
   * "WITHOUT REAR STEERABLE AXLE", and a quote does not collect whether the
   * trailer has one. The stricter reading is used and the qualifier is on the
   * row, so a load with a steerable axle is over-warned rather than under-.
   */
  routeInspection: {
    widthIn: [
      fromUndatedPage<Threshold>(
        { value: ftIn(18), inclusive: false },
        DOR_M_204S,
        '"WIDTH EXCEEDS 18 FEET AND/OR LENGTH EXCEEDS 130 FEET WITHOUT REAR STEERABLE AXLE — Route survey will be required prior to issuance."',
      ),
    ],
    heightIn: [
      fromUndatedPage<Threshold>(
        { value: ftIn(17), inclusive: false },
        DOR_M_204S,
        '"HEIGHT EXCEEDS 17 FEET — The carrier or the driver must complete a route survey." Where no utility lines interfere an affidavit is accepted; where they do, letters from the utility owners are required.',
      ),
    ],
    lengthIn: [
      fromUndatedPage<Threshold>(
        { value: ftIn(130), inclusive: false },
        DOR_M_204S,
        'The 130 ft trigger is published as applying to a load "WITHOUT REAR STEERABLE AXLE". A quote does not collect the trailer configuration, so the survey is flagged for every load over 130 ft and the qualifier is stated here.',
      ),
    ],
  },

  escortRules: INDIANA_ESCORT_RULES,

  /**
   * TRUE. The overweight component is a flat rate per mile travelled inside
   * Indiana, so the state cannot be priced at all without in-state mileage.
   */
  feesDependOnDistance: true,
};

/** Cited for the ISP trooper and inspector hourly rates. */
export const INDIANA_POLICE_ESCORT_RATE_SOURCE = ISP_AGREEMENT;

/** Cited for the state mileage rate applied to a police escort vehicle. */
export const INDIANA_MILEAGE_RATE_SOURCE = IDOA_MILEAGE;

/**
 * Cited for the undated DOR fees webpage, which prints the same $20/$30/$40
 * amounts against a different $40 dimensional band and a 15-day single-trip
 * validity where the July 2026 fee sheet states 5 days. Held for traceability;
 * the fee sheet is newer and is what the bands above follow.
 */
export const INDIANA_LEGACY_FEES_PAGE_SOURCE = DOR_FEES_PAGE;

/** Cited for the 60 ft truck/trailer permit-eligibility rule, which is not a legal limit. */
export const INDIANA_OSOW_PAGE_SOURCE = DOR_OSOW_PAGE;
