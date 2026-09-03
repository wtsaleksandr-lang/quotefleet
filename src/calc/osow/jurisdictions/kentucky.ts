/**
 * KENTUCKY — oversize/overweight single-trip permit rules.
 *
 * THE FIRST STATE WHOSE LEGAL GROSS WEIGHT IS A PROPERTY OF THE ROAD SEGMENT.
 * ---------------------------------------------------------------------------
 * 603 KAR 5:066 and 603 KAR 5:070 do not state one weight limit for Kentucky.
 * They classify EVERY state-maintained highway into one of three published
 * classes and give each its own maximum: Class "AAA" 80,000 lb, Class "AA"
 * 62,000 lb, Class "A" 44,000 lb. A 70,000 lb five-axle rig is perfectly legal
 * on an AAA highway, needs an overweight permit on an AA one, and is sixty
 * percent over the limit on an A one — same truck, same load, three answers.
 *
 * That is California's pilot-car map colours in a different currency: a
 * published property of the SEGMENT, read off the state's own classification,
 * not derivable from lane count or from anything on the load. So `RouteClass`
 * is EXTENDED with `ky-class-aaa` / `ky-class-aa` / `ky-class-a` rather than
 * having Kentucky's own vocabulary flattened onto `divided` and `two-lane`,
 * which would have erased thirty-six thousand pounds between two segments the
 * state prices differently. A quote that does not know the class leaves
 * `ky-class-a-gross-over-44000` and `ky-class-aa-gross-over-62000` UNDECIDED
 * and goes to review; it never silently assumes AAA.
 *
 * KENTUCKY HAS TWO ROAD AXES AND THEY ARE DELIBERATELY NOT CROSSED.
 * ----------------------------------------------------------------
 * The weight classification is one axis. Kentucky's escort table runs on a
 * different one entirely — 601 KAR 1:018 §14 splits "two (2) lane routes of
 * travel" against "four (4) lane routes of travel", which the general
 * vocabulary already names with `two-lane`, `divided`, `interstate` and
 * `multilane-undivided`. Colorado crossed its two axes into ten `co-` members
 * because BOTH of its axes were map properties and neither existed in the
 * general vocabulary. Only one of Kentucky's is, so crossing would have
 * produced six members to say something four existing ones already say.
 *
 * THE COST OF NOT CROSSING IS REAL AND IS STATED RATHER THAN HIDDEN: a caller
 * passes ONE `routeClass`, so a Kentucky leg described as `ky-class-aa` leaves
 * the lane-count escort rules undecided, and one described as `two-lane` leaves
 * the weight-class rules undecided. Both reach review honestly and neither
 * guesses, which is the contract; what a caller cannot currently do is answer
 * both axes at once. That is a limitation of a single-valued field, not of the
 * data, and it is recorded here so the next state to hit it does not rediscover
 * it as a bug.
 *
 * THE FEE SCHEDULE IS THE SIMPLEST IN THIS DIRECTORY, AND THAT IS THE FINDING.
 * ---------------------------------------------------------------------------
 * $60. One flat amount for a single-trip permit, oversize, overweight, or both.
 * No weight bands, no mileage component, no per-axle term, no per-ton term —
 * KYTC's own FAQ says so in one sentence and 601 KAR 1:018 §17(2)(b) codifies
 * it as "a payment of sixty (60) dollars pursuant to KRS 189.270(2)". So
 * `overweightPricing.kind` is `includedInBaseFee`, which is the case
 * `OverweightPricing` was written for and which names Kentucky by name: an
 * empty `overweightBands` list here means "this state folds overweight into one
 * combined permit fee", not "we have not sourced the schedule".
 *
 * ── THE PROPOSED AMENDMENT, AND WHY IT SUPPLIES NO VALUE ──────────────────
 * Proposed Amendment 601 KAR 1:018REG would roughly double the schedule: single
 * trip $60 → $120, A01 $250 → $750, A02 $500 → $1,500, plus a new $500 superload
 * bridge-analysis charge. It implements 2024 RS SB 107 and was FILED WITH LRC
 * on May 5, 2026 at 3:10 p.m.
 *
 * IT IS NOT IN FORCE, AND THE REASON IS SHARPER THAN ARKANSAS'S. Arkansas's
 * 2025 redline could be dismissed on its face — an undated DRAFT watermark with
 * no effective date and no implementing act. Kentucky's carries a filing date
 * AND an implementing statute, which is exactly the shape that CAN displace
 * older text: Louisiana's Acts 2019 No. 301 did precisely that, so its
 * statutory candidate carries `effectiveFrom: '2020-01-01'` and a quote priced
 * before that date sees one candidate and no conflict.
 *
 * The two halves do not meet. SB 107 became law (Acts Ch. 198, signed
 * 2024-04-17, "EFFECTIVE, in part, January 1, 2025") but it sets NO fee: it
 * directs the Transportation Cabinet to "promulgate administrative regulations
 * to set fees for overweight and overdimensional permits". The regulation that
 * carries the $120 states no effective date anywhere — it is a proposal filed
 * with the Legislative Research Commission, and the page's only date is the
 * filing. So the statute has a date and no number, the amendment has a number
 * and no date, and neither half alone can move a fee. Louisiana's act carried
 * BOTH; that is the whole difference.
 *
 * Nothing is guessed to bridge the gap. Kentucky's 13A rulemaking timetable
 * would let a filing date be turned into a projected adoption, and the 2024
 * session's sine die would let SB 107's ninety-day rule be turned into an
 * effective date for a figure SB 107 does not contain. Both would be
 * manufacturing the supersession. So the codified $60 stands, the proposal is
 * on file with "NOT IN FORCE" in its `SourceDoc.title`, and its figures live in
 * `KENTUCKY_PROPOSED_2026_FEES` as a transcription rather than as dated rows —
 * because a `Sourced<T>` with a live `effectiveFrom` is a value the resolver
 * would price, and this one must not be priceable by accident.
 *
 * WHAT HAPPENS IF IT IS ADOPTED IS ALSO SETTLED IN ADVANCE. $60 against $120 is
 * a $60 spread on every permit Kentucky issues, which is over the $50
 * materiality threshold, so `priceSourced` escalates it rather than absorbing
 * it — no Kentucky quote would ever quietly adopt the higher figure. The
 * superload bridge analysis is NOT encoded as a competing zero: the current
 * position is that no separate fee is published, and "nobody publishes a price"
 * is not "the price is nought". `routeAnalysisFeeUsd` is therefore EMPTY, the
 * Arkansas and Colorado treatment.
 *
 * THE DRAFTING TYPO IS PRESERVED, NOT CORRECTED. Section 3(4) of the proposal
 * reads "A02 Non-divisible Annual less than fourteen (14) feet wide shall cost
 * $1500", repeating the width band from §3(3) where drive.ky.gov's A02 is
 * "14 ft. to 16 ft. wide". It is quoted verbatim with the error intact: a fee
 * table's typo is evidence about the document, and silently reading through it
 * would put words in the Cabinet's mouth.
 *
 * ── THE HEIGHT-POLE BAND ──────────────────────────────────────────────────
 * 601 KAR 1:018 §13(1)(d) requires a height pole "if the escorted load is in
 * excess of fourteen (14) feet eleven (11) inches"; drive.ky.gov's Escort
 * Vehicle Safety Requirements bullet says "Use a height pole if the escorted
 * load is fifteen (15) feet or greater". The first EXCLUDES exactly 14'11"; the
 * second excludes everything BETWEEN 14'11" and 15'0". They disagree in one
 * inch and nowhere else, so only a load in that inch hears about it — the Texas
 * 18'11"-versus-19'0" and New York 160 ft pattern. It is an escort REQUIREMENT,
 * so materiality can never absorb it at any dollar value.
 *
 * ── WHAT IS NOT PRICED, AND WHY ───────────────────────────────────────────
 *
 *   - THE POLICE ESCORT, TWICE OVER. Kentucky publishes no threshold that
 *     mandates one and no rate for one. The first is STRUCTURAL rather than a
 *     gap in the research: 601 KAR 1:018 §14(5) makes additional escorts a
 *     discretionary permit condition — "the Division of Motor Carriers may
 *     require additional escort vehicles as a special provision of the permit" —
 *     so there is no threshold to have found. The second is a search that came
 *     back empty: neither Title 502 KAR / KRS Chapter 16 (Kentucky State Police)
 *     nor KYTC publishes an hourly rate, a minimum, a mileage charge or a
 *     cancellation charge. Both are advisories: the price stands and the
 *     exclusion is stated.
 *   - THE BUCKET TRUCK. No Kentucky source sets a codified height at which a
 *     dedicated bucket-truck or utility escort becomes mandatory for general
 *     commercial freight. Advisory, because inventing a trigger would put a
 *     vehicle on the quote that Kentucky has not asked for.
 *   - THE ROUTE SURVEY. 601 KAR 1:018 §6(4) REQUIRES TC Form 95-625 over
 *     15 ft 6 in high, and the survey must be physically driven and certified by
 *     the carrier or a survey company. Kentucky publishes no state fee for
 *     reviewing it in the sources on file, so `routeAnalysisFeeUsd` is empty
 *     rather than a sourced zero.
 *   - THE HOUSE MOVE. TC 95-310 requires written approval on letterhead from
 *     every electric, cable and telephone utility on the route, restricts travel
 *     to between midnight and 5 a.m. and bars Interstates and Parkways. Nothing
 *     on an `OsowLoad` says a load is a house, so it is recorded in
 *     `KENTUCKY_HOUSE_MOVE_REQUIREMENTS` rather than written as a rule that
 *     would fire on transformers.
 *   - THE PARADE FLOAT, WHICH IS GENUINELY FREE. KRS 189.270(10) waives the fee
 *     for a float moving to a parade inside the Commonwealth. It is a use-based
 *     waiver on a product this engine does not identify, so it is recorded in
 *     `KENTUCKY_PARADE_FLOAT_FEE_WAIVER_USD` and not modelled as a conditional
 *     fee that could zero a real permit.
 *
 * ── WHAT IS INFERRED, AND SAID TO BE ──────────────────────────────────────
 *
 *   1. THE LEGAL LIMITS RECORDED ARE THE NATIONAL-TRUCK-NETWORK ONES, NOT THE
 *      LOWEST FIGURES KENTUCKY PUBLISHES. 603 KAR 5:070 §3(1)(b) caps width at
 *      8 ft and §3(1)(d) caps a combination at 65 ft on state-maintained
 *      highways generally, while §4(2) allows 102 in and a 53 ft towed unit on
 *      the National Truck Network, whose access corridors §5(2) extends 15 miles
 *      from interstate and parkway exits and 5 miles from the NTN. Recording
 *      8 ft and 65 ft would flag every ordinary 102-inch trailer and every
 *      ordinary tractor-semitrailer in the Commonwealth as over-dimensional and
 *      put a permit on every Kentucky quote — the failure `colorado.ts` avoided
 *      by recording 75 ft rather than the quoted 70 ft. So the NTN figures are
 *      recorded and the off-network ones are carried by
 *      `ky-width-over-96-off-ntn` and `ky-length-over-65-off-ntn` as advisories.
 *      THIS IS A READING OF WHICH NETWORK A QUOTED LANE USES, and it is the
 *      permissive one. See `KENTUCKY_NTN_LIMIT_READING`.
 *   2. THE HEIGHT POLE IS A REQUIREMENT ON AN ESCORT THAT IS ALREADY THERE, NOT
 *      AN ESCORT IN ITS OWN RIGHT. Both sources say "the ESCORTED load", which
 *      presupposes an escort, and Kentucky triggers no escort on height alone —
 *      its §14 table runs on width, length, overhang and speed. So
 *      `ky-height-pole-over-15` sets `heightPole` and asserts NO count, exactly
 *      as `co-height-pole-over-16` does. Reading "Use a height pole front
 *      escort" as commanding a front escort is the other available reading and
 *      is stated on the quote rather than priced. See
 *      `KENTUCKY_HEIGHT_POLE_READING`.
 *   3. THE KRS 189.221 BASELINE IS CARRIED AS AN ADVISORY RATHER THAN A REVIEW
 *      FLAG, WHICH IS A CALIBRATION AND NOT THE SOURCE'S WORDS. Colorado's
 *      80,000-versus-85,000 conflict fires `manualReview` and this one does not,
 *      for two reasons: KRS 189.221 excludes designated highways in its own
 *      opening clause, so the two texts govern different NETWORKS the way
 *      Colorado's interstate and non-interstate tandem figures do — and
 *      `colorado.ts` declined to model that pair as a conflict at all; and the
 *      disputed band runs 36,000–80,000 lb, 96–102 in and 11'6"–13'6", which is
 *      every loaded truck in the Commonwealth, so a review flag would stop
 *      essentially every Kentucky quote over a statute that does not govern the
 *      network the lane uses. The disagreement is still held open by the
 *      mechanism in `KENTUCKY_NON_DESIGNATED_VS_STATE_SYSTEM` — both candidates,
 *      no adopted value, review forced there, honest spread — exactly as
 *      `COLORADO_INTERSTATE_GROSS_WEIGHT_LBS` does. See
 *      `ky-krs-189-221-baseline-conflict`.
 *
 * ── DATE WARNINGS CARRIED FROM THE SOURCE ─────────────────────────────────
 * 601 KAR 1:018 — the regulation behind the permit fee, the escort table, the
 * height pole and the route survey — has been effective since July 7, 2017 with
 * a February 2019 certified review, which is over three years old. TC 95-310 is
 * dated August 2012 and KRS 189.230 June 24, 2003. Every drive.ky.gov page is
 * undated and carries only a dynamic footer copyright, so each of those rows is
 * effective from the retrieval date and nothing earlier — the Texas rule, for
 * the Texas reason.
 *
 * (The PDF conversion of the research bled a fragment of the legal-dimensions
 * text into the DATE WARNINGS heading and repeated the heading. Nothing was
 * encoded from the corrupted line.)
 */
import type { SourceDoc, Sourced } from '../provenance.js';
import { ftIn, type EscortRule, type RouteClass } from '../escortRules.js';
import type {
  JurisdictionOsowRules,
  OverweightPricing,
  Threshold,
  TransactionFee,
} from '../types.js';

const RETRIEVED = '2026-09-02';

/** 601 KAR 1:018's own effective date. Its certified review is 2019-02-18. */
const EFF_601_1_018 = '2017-07-07';
const EFF_603_5_066 = '2025-02-18';
const EFF_603_5_070 = '2026-02-23';
/** The revision date the Kentucky statute pages carry for KRS Chapter 189. */
const EFF_KRS_189 = '2026-07-15';

// ── Source documents ──────────────────────────────────────────────────────

const KRS_189_221: SourceDoc = {
  id: 'ky-krs-189-221',
  title: 'KRS 189.221 — Maximum dimensions and weight on non-designated highways',
  url: 'https://apps.legislature.ky.gov/law/statutes/statute.aspx?id=57664',
  publisher: 'Kentucky General Assembly, Legislative Research Commission',
  revisedOn: EFF_KRS_189,
  retrievedOn: RETRIEVED,
  cite:
    '(1) "exceeds eleven and one-half (11-1/2) feet in height or ninety-six (96) inches in width"; (2) "twenty-six and one half (26-1/2) feet"; (3) "Any semitrailer truck which exceeds thirty (30) feet"; (4) "exceeds 36,000 pounds gross weight"; the section opens "except those highways designated by the secretary of transportation under the provisions of KRS 189.222"',
};

const KRS_189_270: SourceDoc = {
  id: 'ky-krs-189-270',
  title: 'KRS 189.270 — Overweight and overdimensional permits and fees',
  url: 'https://apps.legislature.ky.gov/law/statutes/statute.aspx?id=57662',
  publisher: 'Kentucky General Assembly, Legislative Research Commission',
  revisedOn: EFF_KRS_189,
  retrievedOn: RETRIEVED,
  cite:
    '(4)(a) the $80 farm annual under 14 ft wide and (4)(b) the $150 farm annual over 14 ft; (10) the parade-float fee waiver',
};

const KRS_189_230: SourceDoc = {
  id: 'ky-krs-189-230',
  title: 'KRS 189.230 — County maximum weight roads and cooperative haulage agreements',
  url: 'https://apps.legislature.ky.gov/law/statutes/statute.aspx?id=6336',
  publisher: 'Kentucky General Assembly, Legislative Research Commission',
  revisedOn: '2003-06-24',
  retrievedOn: RETRIEVED,
  cite:
    '"The fiscal court of any county may enter into a cooperative agreement with the Transportation Cabinet … over any road in the county road system that has been classified as a maximum weight road"',
};

/** The road classification itself — Class AAA, AA and A, and their weights. */
const KAR_603_5_066: SourceDoc = {
  id: 'ky-603-kar-5-066',
  title: '603 KAR 5:066 — Weight limits for state-maintained highways by classification',
  url: 'https://apps.legislature.ky.gov/law/kar/titles/603/005/066/',
  publisher: 'Kentucky Transportation Cabinet, Department of Highways',
  revisedOn: EFF_603_5_066,
  retrievedOn: RETRIEVED,
  cite:
    'Section 1(1)(a)-(c) and Sections 2–5: Class "AAA" 80,000 lb, Class "AA" 62,000 lb, Class "A" 44,000 lb; 20,000 lb single axle; 34,000 lb tandem; the tridem steps; the 700 lb per inch of tire width rule; the bridge weight formula; Section 3(10) the interstate zero-tolerance rule',
};

/** The dimensional limits, split between the general system and the NTN. */
const KAR_603_5_070: SourceDoc = {
  id: 'ky-603-kar-5-070',
  title: '603 KAR 5:070 — Maximum dimensions and the National Truck Network',
  url: 'https://apps.legislature.ky.gov/law/kar/titles/603/005/070/',
  publisher: 'Kentucky Transportation Cabinet, Department of Highways',
  revisedOn: EFF_603_5_070,
  retrievedOn: RETRIEVED,
  cite:
    'Section 3(1)(a)-(d) height 13 ft 6 in, width 8 ft, single unit 45 ft, combination 65 ft; Section 3(2) the transporter overhangs; Section 4(2)(a)-(c) the NTN 102 in, 53 ft towed unit and 28 ft twins; Section 5(2) the 15-mile and 5-mile access corridors',
};

/** The permit regulation: the $60 fee, the escort table, the height pole. */
const KAR_601_1_018: SourceDoc = {
  id: 'ky-601-kar-1-018',
  title: '601 KAR 1:018 — Oversize and overweight vehicle permits (effective 2017-07-07)',
  url: 'https://apps.legislature.ky.gov/law/kar/titles/601/001/018/',
  publisher: 'Kentucky Transportation Cabinet, Department of Vehicle Regulation',
  revisedOn: EFF_601_1_018,
  retrievedOn: RETRIEVED,
  cite:
    'Section 1(4) the height-pole definition; Section 2(3) and 2(6) permit validity; Section 6(1) the 13 ft 6 in permit trigger and 6(4) the TC 95-625 route survey over 15 ft 6 in; Section 7(1)(a) the 80,000 lb registered-weight requirement and 7(2)(a)-(h) the permitted axle and configuration caps; Section 11(2) the sign lettering; Section 13(1) the 300 ft escort distance and 13(1)(d) the height pole "in excess of fourteen (14) feet eleven (11) inches"; Section 14(1)-(4) the escort table and 14(5) the discretionary additional escorts; Section 17(2)(b) "A payment of sixty (60) dollars pursuant to KRS 189.270(2)"; Section 17(3)(b) the $250 container annual; the $10 duplicate/transfer fee',
};

/**
 * THE PROPOSED AMENDMENT, AND IT IS NOT IN FORCE. The page states
 * "FILED WITH LRC: May 5, 2026 at 3:10 p.m." and "2024 RS, SB 107" as its
 * statutory authority, and it states NO effective date anywhere.
 *
 * `revisedOn` is the FILING date, which is the only date the document carries —
 * it is not an effective date and is not treated as one. The document is cited
 * for exactly one purpose: recording what the Cabinet has PROPOSED, so that the
 * $60 in force is visibly a choice between two known figures rather than the
 * only number anyone looked for. No row anywhere in this file takes its value
 * from it.
 */
const KAR_601_1_018_REG: SourceDoc = {
  id: 'ky-601-kar-1-018-proposed-2026',
  title:
    '601 KAR 1:018REG — Proposed amendment implementing 2024 RS SB 107 (filed with LRC 2026-05-05, NOT IN FORCE; no effective date stated)',
  url: 'https://apps.legislature.ky.gov/law/kar/titles/601/001/018/REG/',
  publisher: 'Kentucky Transportation Cabinet, Department of Vehicle Regulation',
  revisedOn: '2026-05-05',
  retrievedOn: RETRIEVED,
  cite:
    'Section 3(1)-(10), the proposed fee list; the page states "FILED WITH LRC: May 5, 2026 at 3:10 p.m." and "2024 RS, SB 107" and no effective date',
};

const DRIVE_KY_FAQ: SourceDoc = {
  id: 'ky-drive-owod-faq',
  title: 'KYTC drive.ky.gov — Overweight/Over-Dimensional Frequently Asked Questions (undated)',
  url: 'https://drive.ky.gov/Motor-Carriers/Overweight-Over-Dimensional/Pages/Frequently-Asked-Questions.aspx',
  publisher: 'Kentucky Transportation Cabinet, Division of Motor Carriers',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite:
    '"A Single Trip permit cost $60. There is an applicable service fee of 4% for credit card or a $3 ACH fee."; "A rear escort is required any time overhang is in excess of 10\'"; "Over 110\' long a rear is required Over 120\' long a front and 2 rear plus a pivot/steerable dolly is required"',
};

const DRIVE_KY_PERMITS: SourceDoc = {
  id: 'ky-drive-owod-permits',
  title: 'KYTC drive.ky.gov — Overweight/Over-Dimensional Permits (undated)',
  url: 'https://drive.ky.gov/Motor-Carriers/Overweight-Over-Dimensional/Pages/OWOD-Permits.aspx',
  publisher: 'Kentucky Transportation Cabinet, Division of Motor Carriers',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite:
    'the annual permit table — A01 $250, A02 $500, A03 $80, A04 $150, A05 $1250, A06 $500, A09 $150, A10 $1500 — and the S05 metal-commodities single trip at $100',
};

const DRIVE_KY_DIMENSIONS: SourceDoc = {
  id: 'ky-drive-owod-legal-dimensions',
  title: 'KYTC drive.ky.gov — OWOD Legal Dimensions (undated)',
  url: 'https://drive.ky.gov/Motor-Carriers/Overweight-Over-Dimensional/Pages/OWOD-Legal-Dimensions.aspx',
  publisher: 'Kentucky Transportation Cabinet, Division of Motor Carriers',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite:
    '"Height 13-FT and 06-IN (Car Haulers 14-FT and 00-IN)"; "Overhang, 48-FT trailers may have up to 5-FT rear overhang on designated highways without obtaining an over-dimensional permit."; the 48,000 lb trunnion axle group',
};

const DRIVE_KY_ESCORTS: SourceDoc = {
  id: 'ky-drive-owod-escort-requirements',
  title: 'KYTC drive.ky.gov — OWOD Escort Requirements (undated)',
  url: 'https://drive.ky.gov/Motor-Carriers/Overweight-Over-Dimensional/Pages/OWOD-Escort-Requirements.aspx',
  publisher: 'Kentucky Transportation Cabinet, Division of Motor Carriers',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite:
    'the two-lane and multi-lane width and length tables; the Escort Vehicle Safety Requirements bullet "Use a height pole if the escorted load is fifteen (15) feet or greater."',
};

const KYTC_TC_95_310: SourceDoc = {
  id: 'ky-tc-95-310-house-move',
  title: 'KYTC Form TC 95-310 — House Moving Permit Application (form dated August 2012)',
  url: 'https://transportation.ky.gov/Organizational-Resources/Forms/TC%2095-310.pdf',
  publisher: 'Kentucky Transportation Cabinet',
  revisedOn: '2012-08-01',
  retrievedOn: RETRIEVED,
  cite:
    '"A faxed approval on letterhead from all utility companies is required Name of utility companies involved: Name & contact # of approving agent: Electric: Cable: Telephone: Other:"',
};

const KYTC_FORMS: SourceDoc = {
  id: 'ky-tc-95-forms-library',
  title: 'KYTC Forms Library (TC 95) — route survey form TC 95-625 (undated)',
  url: 'https://transportation.ky.gov/Organizational-Resources/Pages/Forms-Library-(TC-95).aspx',
  publisher: 'Kentucky Transportation Cabinet',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: '"TC 95-625 Overweight or Overdimensional Proposed Route Survey Word PDF"',
};

/**
 * Cited for a NEGATIVE, which is the only honest way to source one: the Kentucky
 * State Police title index was opened and searched, and it carries no fee
 * schedule for escorting a commercial oversize or overweight move.
 */
const KSP_502_KAR: SourceDoc = {
  id: 'ky-502-kar-title-index',
  title: '502 KAR (Kentucky State Police) — title index, searched for an escort fee schedule',
  url: 'https://apps.legislature.ky.gov/law/kar/titles/502/',
  publisher: 'Kentucky State Police, via the Legislative Research Commission',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite:
    'no administrative regulation in Title 502 KAR, and nothing in KRS Chapter 16, states an officer rate, a minimum, a mileage charge or a cancellation charge for a commercial OS/OW escort',
};

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * A row from an UNDATED page. `effectiveFrom` is the retrieval date, because
 * that is the only day on which we can prove the page said this. Every
 * drive.ky.gov OS/OW page is undated and carries a dynamic footer copyright.
 */
function fromUndatedPage<T>(value: T, source: SourceDoc, note?: string): Sourced<T> {
  return {
    value,
    source,
    effectiveFrom: RETRIEVED,
    effectiveTo: null,
    ...(note === undefined ? {} : { note }),
  };
}

/** A row whose start date the source states outright. */
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

function escortRule(
  id: string,
  description: string,
  when: EscortRule['when'],
  then: EscortRule['then'],
  source: SourceDoc = KAR_601_1_018,
  effectiveFrom: string = EFF_601_1_018,
): EscortRule {
  return {
    id,
    jurisdiction: 'KY',
    description,
    when,
    then,
    source,
    effectiveFrom,
    effectiveTo: null,
  };
}

// ── Kentucky's own road classification ────────────────────────────────────

/**
 * 603 KAR 5:066 §1(1) names three classes and gives each a gross weight. They
 * are a published property of the SEGMENT — Kentucky classifies every
 * state-maintained highway into one — and are not derivable from lane count,
 * pavement type or anything on the load. Prefixed for the California reason:
 * this is Kentucky's classification, not a general road taxonomy.
 */
const KY_CLASSES: RouteClass[] = ['ky-class-aaa', 'ky-class-aa', 'ky-class-a'];

/**
 * The escort table's own axis, which is lane count and nothing else. 601 KAR
 * 1:018 §14 says "two (2) lane routes of travel" and "four (4) lane routes of
 * travel"; drive.ky.gov prints the same two columns. Both are ordinary road
 * taxonomy that the general vocabulary already names, so no `ky-` member was
 * invented for either — see the file header on why the two axes are not crossed.
 */
const TWO_LANE: RouteClass[] = ['two-lane'];
const FOUR_LANE: RouteClass[] = ['interstate', 'divided', 'multilane-undivided'];

// ── The inferences and findings, named so they can be audited ─────────────

/**
 * WHICH NETWORK A QUOTED KENTUCKY LANE USES — a reading, and the permissive one.
 *
 * 603 KAR 5:070 publishes two dimensional regimes. §3(1) governs
 * state-maintained highways generally: 8 ft wide, 45 ft single unit, 65 ft
 * combination. §4(2) governs the National Truck Network: 102 in, a 53 ft towed
 * unit, 28 ft twins — and §5(2) extends NTN access 15 miles from interstate and
 * parkway exits and 5 miles from the NTN itself on state-maintained roads.
 *
 * `legalLimits` records the §4(2) figures. A quote knows two endpoints and not a
 * route, and recording 8 ft and 65 ft instead would mark every ordinary
 * 102-inch trailer and every ordinary tractor-semitrailer in the Commonwealth as
 * over-dimensional, putting a permit and an escort ladder on loads Kentucky does
 * not require either for. That is the trap `colorado.ts` avoided when it recorded
 * 75 ft rather than the 70 ft its statute quotes.
 *
 * The other direction is not silently dropped: `ky-width-over-96-off-ntn` and
 * `ky-length-over-65-off-ntn` state the off-network limits on the quote for any
 * load that would be over them.
 */
export const KENTUCKY_NTN_LIMIT_READING =
  '603 KAR 5:070 §3(1) caps width at 8 ft and a combination at 65 ft on state-maintained highways generally, while §4(2) allows 102 in and a 53 ft towed unit on the National Truck Network and §5(2) extends NTN access 15 miles from interstate and parkway exits and 5 miles from the NTN. This engine records the NTN figures as the legal limits, which is OUR READING of which network a quoted lane uses and is the permissive one. A route that leaves the NTN and its access corridors is governed by the 8 ft and 65 ft figures, which are stated on the quote by ky-width-over-96-off-ntn and ky-length-over-65-off-ntn rather than priced.';

/**
 * WHETHER THE HEIGHT POLE COMMANDS AN ESCORT OR ONLY EQUIPS ONE.
 *
 * 601 KAR 1:018 §13(1) opens "An escort vehicle shall:" and then lists (a)
 * radio contact, (b) amber strobes, (c) headlamps lit, and (d) "Use a height
 * pole front escort if the escorted load is in excess of fourteen (14) feet
 * eleven (11) inches." drive.ky.gov's safety bullet uses the same construction:
 * "if the ESCORTED load is fifteen (15) feet or greater". Both presuppose an
 * escort, and Kentucky's §14 escort table triggers on width, length, overhang
 * and speed — never on height.
 *
 * So the pole is read as a requirement ON a front escort that is already
 * present, and no escort COUNT is asserted for height alone. That is exactly
 * what `co-height-pole-over-16` does for Colorado's §505.1.7. The competing
 * reading — that "Use a height pole front escort" commands a front escort — is
 * available on the words and is stated on the quote instead of priced, because
 * asserting a pilot car Kentucky has not clearly required would over-quote every
 * tall load in the state.
 */
export const KENTUCKY_HEIGHT_POLE_READING =
  '601 KAR 1:018 §13(1)(d) and drive.ky.gov both say "the escorted load", and Kentucky\'s §14 escort table never triggers on height, so the height pole is encoded as a requirement on a front escort that is already present rather than as an escort in its own right. Reading "Use a height pole front escort" as commanding a front escort is the other available reading; it is stated on the quote and not priced. OUR INFERENCE, not the state\'s words.';

/**
 * THE HEIGHT-POLE BOUNDARY CONFLICT, held open by the mechanism.
 *
 * The regulation and the portal disagree in one inch. 601 KAR 1:018 §13(1)(d)
 * reads "in excess of fourteen (14) feet eleven (11) inches", which excludes a
 * load measuring exactly 14'11" and catches everything above it. The Escort
 * Vehicle Safety Requirements bullet on drive.ky.gov reads "fifteen (15) feet or
 * greater", which excludes everything BETWEEN 14'11" and 15'0" as well.
 *
 * `resolveSourced` returns null, keeps both candidates with their provenance and
 * forces review. Because it is a REQUIREMENT, `materiality.ts` may never touch
 * it at any dollar value, and `ky-height-pole-14-11-to-15-conflict` fires in
 * exactly the inch where the two readings differ — the Texas 18'11" and New York
 * 160 ft pattern.
 */
export const KENTUCKY_HEIGHT_POLE_TRIGGER_IN: Sourced<Threshold>[] = [
  fromDated<Threshold>(
    { value: ftIn(14, 11), inclusive: false },
    KAR_601_1_018,
    EFF_601_1_018,
    '601 KAR 1:018 §13(1)(d): "Use a height pole front escort if the escorted load is in excess of fourteen (14) feet eleven (11) inches." EXCLUSIVE — a load measuring exactly 14 ft 11 in needs no pole under this reading.',
  ),
  fromUndatedPage<Threshold>(
    { value: ftIn(15), inclusive: true },
    DRIVE_KY_ESCORTS,
    'drive.ky.gov Escort Vehicle Safety Requirements: "Use a height pole if the escorted load is fifteen (15) feet or greater." INCLUSIVE at 15 ft, and it excludes the whole band between 14 ft 11 in and 15 ft that the regulation catches.',
  ),
];

/**
 * THE STATUTORY BASELINE AGAINST THE ROAD CLASSIFICATION — held open, and kept
 * OUT of `legalLimits` for the reason `colorado.ts` gives at length.
 *
 * KRS 189.221 sets maxima for any highway that is neither designated by the
 * secretary of transportation under KRS 189.222 nor locally maintained under
 * KRS 189.222(13) or 189.230(4): 11 ft 6 in high, 96 in wide, 26 ft 6 in for a
 * single truck, 30 ft for a semitrailer truck, and 36,000 lb gross. 603 KAR
 * 5:066 and 5:070 set an entirely different set for the state-maintained system
 * — 13 ft 6 in, 8 ft (102 in on the NTN), 45 ft single unit, 65 ft combination,
 * and 80,000 / 62,000 / 44,000 lb across Classes AAA, AA and A.
 *
 * BOTH CANDIDATES ARE ON FILE HERE AND `resolveSourced` RETURNS NULL FOR THEM,
 * WHICH IS THE CONTRACT. What it must not do is set the legal limits: a null
 * gross weight disables the over-dimension check entirely, so the engine would
 * stop being able to tell that a 120,000 lb load is overweight and would drop
 * the whole permit rather than flag a disagreement about a road nobody has told
 * it the route uses. A conflict that disables the check is more dangerous than
 * the conflict it documents.
 *
 * `legalLimits` therefore holds the 603 KAR figures — the system a quoted lane
 * actually runs on — and `ky-krs-189-221-baseline-conflict` fires ONLY inside
 * the bands where the two texts give different answers. Above each band both
 * texts agree a permit is required and there is nothing left to disagree about;
 * below each band both agree the load is legal. That rule states the statutory
 * baseline rather than stopping the quote, and the reasoning for the difference
 * from Colorado's review flag is on the rule itself.
 */
export const KENTUCKY_NON_DESIGNATED_VS_STATE_SYSTEM: {
  widthIn: Sourced<number>[];
  heightIn: Sourced<number>[];
  singleUnitLengthIn: Sourced<number>[];
  overallLengthIn: Sourced<number>[];
  grossWeightLbs: Sourced<number>[];
} = {
  widthIn: [
    fromDated(
      96,
      KRS_189_221,
      EFF_KRS_189,
      'KRS 189.221(1): "ninety-six (96) inches in width, including any part of the body or load". EXCLUSIVE ("exceeds"). 603 KAR 5:070 §3(1)(b) states the same 8 ft for state-maintained highways off the National Truck Network, so the statute and the regulation agree on this figure and it is the NTN allowance that differs from it.',
    ),
    fromDated(
      102,
      KAR_603_5_070,
      EFF_603_5_070,
      '603 KAR 5:070 §4(2)(a): an overdimensional permit is required on the National Truck Network only if the width exceeds "102 inches (2.59 meters)". EXCLUSIVE. This is the figure recorded in legalLimits; see KENTUCKY_NTN_LIMIT_READING.',
    ),
  ],
  heightIn: [
    fromDated(
      ftIn(11, 6),
      KRS_189_221,
      EFF_KRS_189,
      'KRS 189.221(1): "exceeds eleven and one-half (11-1/2) feet in height". EXCLUSIVE.',
    ),
    fromDated(
      ftIn(13, 6),
      KAR_603_5_070,
      EFF_603_5_070,
      '603 KAR 5:070 §3(1)(a): "A height, including body and load, not to exceed thirteen (13) feet and six (6) inches (4.115 meters)". INCLUSIVE, and corroborated from the permit side by 601 KAR 1:018 §6(1), which requires a permit "in excess of thirteen (13) feet, six (6) inches".',
    ),
  ],
  singleUnitLengthIn: [
    fromDated(
      ftIn(26, 6),
      KRS_189_221,
      EFF_KRS_189,
      'KRS 189.221(2): "Any motor truck, except a semitrailer truck, which exceeds twenty-six and one half (26-1/2) feet in length". EXCLUSIVE. Recorded here only — `LegalLimits` has no single-unit length field, and the figure is not otherwise applied.',
    ),
    fromDated(
      ftIn(45),
      KAR_603_5_070,
      EFF_603_5_070,
      '603 KAR 5:070 §3(1)(c): "a length not exceeding forty-five (45) feet (13.716 meters) of a single unit motor vehicle". INCLUSIVE.',
    ),
  ],
  overallLengthIn: [
    fromDated(
      ftIn(30),
      KRS_189_221,
      EFF_KRS_189,
      'KRS 189.221(3): "Any semitrailer truck which exceeds thirty (30) feet in length, including any part of the body or load". EXCLUSIVE, and thirty-five feet shorter than the regulation allows the same combination.',
    ),
    fromDated(
      ftIn(65),
      KAR_603_5_070,
      EFF_603_5_070,
      '603 KAR 5:070 §3(1)(d): "a length not exceeding sixty-five (65) feet (19.812 meters) of a motor vehicle and trailer or semitrailer combination". INCLUSIVE. On the National Truck Network §4(2)(b) regulates the TOWED UNIT at 53 ft instead and caps no overall length, which is why `legalLimits.overallLengthIn` is absent — see the field note there.',
    ),
  ],
  grossWeightLbs: [
    fromDated(
      36000,
      KRS_189_221,
      EFF_KRS_189,
      'KRS 189.221(4): "Any truck, semitrailer truck, or truck and trailer unit which exceeds 36,000 pounds gross weight, including the load". EXCLUSIVE. KRS 189.221(6) exempts haulers of building materials to road construction sites up to 80,000 lb — a commodity carve-out this engine does not model.',
    ),
    fromDated(
      80000,
      KAR_603_5_066,
      EFF_603_5_066,
      '603 KAR 5:066 §1(1)(a): "Class \\"AAA\\" shall have a maximum allowable gross weight (mass) of 80,000 pounds (36,287.36 kilograms)." INCLUSIVE. This is the figure recorded in legalLimits; Classes AA and AA-adjacent are carried by the routeClass rules rather than as competing candidates, because they are three networks and not three readings.',
    ),
  ],
};

/**
 * THE THREE CLASS MAXIMA, RECORDED TOGETHER AND DELIBERATELY NOT MERGED INTO
 * `legalLimits.grossWeightLbs`.
 *
 * They are not three sources disagreeing about one number — they are one source
 * stating three numbers for three different networks, which is Colorado's
 * interstate-versus-non-interstate tandem case and not a conflict at all.
 * Recording all three as candidates would resolve the legal gross weight to null
 * and disable the overweight path for the entire state.
 *
 * `legalLimits` holds the Class AAA figure, which is what the interstates and
 * the primary network carry, and `ky-class-aa-gross-over-62000` and
 * `ky-class-a-gross-over-44000` fire on the lighter classes. A quote that does
 * not name the class leaves both UNDECIDED and goes to review — it never
 * assumes AAA.
 */
export const KENTUCKY_ROAD_CLASS_GROSS_WEIGHT_LBS: Record<
  'ky-class-aaa' | 'ky-class-aa' | 'ky-class-a',
  number
> = {
  'ky-class-aaa': 80000,
  'ky-class-aa': 62000,
  'ky-class-a': 44000,
};

/**
 * THE PROPOSED FEE SCHEDULE, TRANSCRIBED AND NOT DATED INTO EFFECT.
 *
 * Deliberately NOT a `Sourced<T>[]`. A sourced row carries an `effectiveFrom`,
 * and any date put on these figures would be invented — the amendment states
 * none. Held as a plain transcription so the proposal is visible and auditable
 * without being something the resolver could ever price.
 *
 * `codifiedUsd: null` on the superload bridge analysis is the load-bearing
 * entry: the current position is that NO separate fee is published for it, which
 * is not the same claim as a published $0 and must never be encoded as one.
 *
 * The §3(4) quote carries the Cabinet's own drafting error — it repeats "less
 * than fourteen (14) feet wide" from §3(3) where drive.ky.gov's A02 is
 * "14 ft. to 16 ft. wide". Quoted verbatim, typo intact.
 */
export const KENTUCKY_PROPOSED_2026_FEES: ReadonlyArray<{
  item: string;
  section: string;
  codifiedUsd: number | null;
  proposedUsd: number;
  quote: string;
}> = [
  {
    item: 'Single-trip permit',
    section: '601 KAR 1:018REG §3(1)',
    codifiedUsd: 60,
    proposedUsd: 120,
    quote: 'Single trip shall cost $120.',
  },
  {
    item: 'S05 single-trip metal commodities',
    section: '601 KAR 1:018REG §3(2)',
    codifiedUsd: 100,
    proposedUsd: 200,
    quote: 'S05 Single Trip Metal Commodities shall cost $200.',
  },
  {
    item: 'A01 annual, non-divisible under 14 ft wide',
    section: '601 KAR 1:018REG §3(3)',
    codifiedUsd: 250,
    proposedUsd: 750,
    quote: 'A01 Non-divisible Annual less than fourteen (14) feet wide shall cost $750.',
  },
  {
    item: 'A02 annual, non-divisible 14 ft to 16 ft wide',
    section: '601 KAR 1:018REG §3(4)',
    codifiedUsd: 500,
    proposedUsd: 1500,
    // Verbatim, including the repeated width band. See the header.
    quote: 'A02 Non-divisible Annual less than fourteen (14) feet wide shall cost $1500.',
  },
  {
    item: 'A06 annual, non-divisible steel statewide',
    section: '601 KAR 1:018REG §3(6)',
    codifiedUsd: 500,
    proposedUsd: 1000,
    quote: 'A06 Non-divisible Steel statewide shall cost $1000.',
  },
  {
    item: 'A09 feed annual',
    section: '601 KAR 1:018REG §3(7)',
    codifiedUsd: 150,
    proposedUsd: 300,
    quote: 'A09 Feed Annual shall cost $300.',
  },
  {
    item: 'Riverport annual permit',
    section: '601 KAR 1:018REG §3(9)',
    codifiedUsd: null,
    proposedUsd: 500,
    quote: 'Riverport Annual Permit shall cost $500.',
  },
  {
    item: 'Superload bridge analysis',
    section: '601 KAR 1:018REG §3(10)',
    // NOT a zero. No separate fee is published for this today.
    codifiedUsd: null,
    proposedUsd: 500,
    quote: 'Superload bridge analysis cost an additional $500.',
  },
];

/**
 * WHY THE PROPOSAL SUPPLIES NO VALUE, IN ONE PLACE THAT CAN BE CITED.
 *
 * The finding is not "we could not find an effective date". It is that the two
 * halves of the change are in different documents and only one of them is
 * dated: SB 107 carries the date and no figure, the amendment carries every
 * figure and no date. Louisiana's Acts 2019 No. 301 carried both, which is
 * exactly why its `effectiveFrom` could displace the older administrative text.
 */
export const KENTUCKY_PROPOSED_AMENDMENT_NOT_IN_FORCE =
  '601 KAR 1:018REG was filed with the Legislative Research Commission on May 5, 2026 at 3:10 p.m. under the authority of 2024 RS SB 107, and states no effective date anywhere. SB 107 itself became law (Acts Ch. 198, signed 2024-04-17, "EFFECTIVE, in part, January 1, 2025") but sets no fee: it directs the Transportation Cabinet to promulgate administrative regulations to set the OS/OW permit fees. The statute therefore has a date and no number, the amendment has a number and no date, and neither half alone can move a fee — unlike Louisiana Acts 2019 No. 301, which carried both. The codified $60 stands and no figure in this file is taken from the proposal. Should it be adopted, the $60-versus-$120 spread is over the $50 materiality threshold and priceSourced would escalate it to review rather than absorb it.';

/**
 * §7(2)'s permitted maxima, which are CONFIGURATION-DEPENDENT and are the real
 * ceiling on a Kentucky single-trip permit. The 160,000 lb in
 * `superload.grossWeight` is the highest of them — the seven-axle figure — and a
 * load under it on fewer axles is still unpermittable. There is no axle count on
 * an `OsowLoad` to test against, so this is carried as an advisory rather than
 * as a rule that would silently pass a five-axle 150,000 lb move.
 */
export const KENTUCKY_PERMITTED_AXLE_CAPS_LBS = {
  steeringAxle: 20000,
  singleAxle: 24000,
  tandemFiveAxleCombination: 45000,
  tandemSixOrMoreAxleCombination: 48000,
  tridem: 60000,
  trunnionGroup: 48000,
  fiveAxleCombinationGross: 96000,
  sixAxleCombinationGross: 120000,
  sevenAxleCombinationGross: 160000,
} as const;

/**
 * KRS 189.270(10) waives the permit fee outright for a parade float moving to a
 * parade inside the Commonwealth: "If the float is being used in conjunction
 * with a parade to be held within the boundaries of the Commonwealth, a fee
 * shall not be assessed by the department to issue the permit."
 *
 * A GENUINE ZERO, and it is still not a `ConditionalFee`: nothing on an
 * `OsowLoad` identifies a parade float, and a conditional fee that fired on the
 * wrong load would zero a real permit. Recorded, not modelled.
 */
export const KENTUCKY_PARADE_FLOAT_FEE_WAIVER_USD = 0;

/**
 * The house-move regime, recorded rather than written as a rule. TC 95-310
 * requires written approval on letterhead from every electric, cable and
 * telephone utility on the route; drive.ky.gov restricts the move to between
 * midnight and 5 a.m. and bars Interstates and Parkways. Nothing on an
 * `OsowLoad` says a load is a house, and a rule keyed on width alone would fire
 * on transformers and press frames that Kentucky's house-move rules do not
 * reach — the same reason `arkansas.ts` keeps its manufactured-home escort
 * boundary out of its escort rules.
 */
export const KENTUCKY_HOUSE_MOVE_REQUIREMENTS =
  'A Kentucky house move requires written approval on letterhead from every electric, cable and telephone utility on the route (KYTC Form TC 95-310, form dated August 2012), is restricted to travel between 12:00 a.m. and 5:00 a.m., and is prohibited on Interstates and Parkways. None of it is priced here: no field on a load identifies a house move, and Kentucky publishes no charge for the utility approvals.';

/** Annual permit fees, drive.ky.gov and KRS 189.270(4) — a different product. */
export const KENTUCKY_ANNUAL_PERMIT_FEES_USD = {
  a01NonDivisibleUnder14ft: 250,
  a02NonDivisible14to16ft: 500,
  a03FarmUnder14ft: 80,
  a04FarmOver14ft: 150,
  a05MetalCommodities: 1250,
  a06NonDivisibleSteelStatewide: 500,
  a09Feed: 150,
  a10ManufacturedHome: 1500,
  containerisedOceanCargo: 250,
  duplicateTransferOrAmendment: 10,
} as const;

// ── Escort rules (601 KAR 1:018 §§11, 13, 14; drive.ky.gov) ───────────────

export const KENTUCKY_ESCORT_RULES: EscortRule[] = [
  /**
   * THE WIDTH LADDERS. They are written as OPEN ladders rather than exclusive
   * bands because Kentucky's own tables are cumulative — "1 – Rear escort
   * required when the width exceeds 12 feet. 1 – Front and 1 – Rear escort
   * required when the width exceeds 14 feet." — and `evaluateEscortRules`
   * combines counts with MAX. A 15 ft load on a four-lane route fires both the
   * 12 ft and the 14 ft rule and comes out at one front and one rear, which is
   * what the table says. Exclusive bands would have needed a boundary decision
   * Kentucky never wrote.
   */
  escortRule(
    'ky-two-lane-width-over-12',
    'Over 12 ft wide on a two-lane route — one front and one rear escort',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: TWO_LANE },
        { kind: 'gt', measure: 'widthIn', value: ftIn(12) },
      ],
    },
    { escorts: 2, front: 1, rear: 1 },
  ),
  escortRule(
    'ky-two-lane-width-over-16',
    'Over 16 ft wide on a two-lane route — two front and two rear escorts',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: TWO_LANE },
        { kind: 'gt', measure: 'widthIn', value: ftIn(16) },
      ],
    },
    { escorts: 4, front: 2, rear: 2 },
    DRIVE_KY_ESCORTS,
    RETRIEVED,
  ),
  escortRule(
    'ky-four-lane-width-over-12',
    'Over 12 ft wide on a four-lane route — one rear escort',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: FOUR_LANE },
        { kind: 'gt', measure: 'widthIn', value: ftIn(12) },
      ],
    },
    { escorts: 1, rear: 1 },
  ),
  escortRule(
    'ky-four-lane-width-over-14',
    'Over 14 ft wide on a four-lane route — one front and one rear escort',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: FOUR_LANE },
        { kind: 'gt', measure: 'widthIn', value: ftIn(14) },
      ],
    },
    { escorts: 2, front: 1, rear: 1 },
  ),
  escortRule(
    'ky-four-lane-width-over-16',
    'Over 16 ft wide on a four-lane route — two front and two rear escorts',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: FOUR_LANE },
        { kind: 'gt', measure: 'widthIn', value: ftIn(16) },
      ],
    },
    { escorts: 4, front: 2, rear: 2 },
    DRIVE_KY_ESCORTS,
    RETRIEVED,
  ),

  /**
   * THE LENGTH LADDERS, WHICH DIVERGE HARDER THAN THE WIDTH ONES. A two-lane
   * route wants a front escort from 75 ft; a four-lane route wants nothing at
   * all until 110 ft. Thirty-five feet and a whole pilot car turn on the road
   * type, so neither rule can be written route-agnostically the way Texas's
   * bare-count width rule can.
   */
  escortRule(
    'ky-two-lane-length-over-75',
    'Over 75 ft long on a two-lane route — one front escort',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: TWO_LANE },
        { kind: 'gt', measure: 'overallLengthIn', value: ftIn(75) },
      ],
    },
    { escorts: 1, front: 1 },
  ),
  escortRule(
    'ky-two-lane-length-over-85',
    'Over 85 ft long on a two-lane route — one front and one rear escort',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: TWO_LANE },
        { kind: 'gt', measure: 'overallLengthIn', value: ftIn(85) },
      ],
    },
    { escorts: 2, front: 1, rear: 1 },
  ),
  escortRule(
    'ky-four-lane-length-over-110',
    'Over 110 ft long on a four-lane route — one rear escort',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: FOUR_LANE },
        { kind: 'gt', measure: 'overallLengthIn', value: ftIn(110) },
      ],
    },
    { escorts: 1, rear: 1 },
    DRIVE_KY_FAQ,
    RETRIEVED,
  ),
  /**
   * THE ONE LENGTH RULE THAT IS ROUTE-AGNOSTIC, AND ONLY BECAUSE BOTH COLUMNS
   * AGREE. drive.ky.gov's two-lane table reads "1 - Front and 2 – Rear escorts
   * required when the length exceeds 120 feet" and the FAQ's multi-lane answer
   * reads "Over 120' long a front and 2 rear plus a pivot/steerable dolly is
   * required". Same three cars either way, so the count does not depend on the
   * road and a quote without a road type is not sent to review over a
   * distinction that cannot change the price — the Texas pattern.
   */
  escortRule(
    'ky-length-over-120',
    'Over 120 ft long — one front and two rear escorts, on any route',
    { kind: 'gt', measure: 'overallLengthIn', value: ftIn(120) },
    {
      escorts: 3,
      front: 1,
      rear: 2,
      advisory:
        'Over 120 ft, drive.ky.gov also requires a pivot or steerable dolly ("Over 120\' long a front and 2 rear plus a pivot/steerable dolly is required"). That is equipment on the trailer rather than an escort vehicle, Kentucky publishes no charge for it, and no cost for it is included in this quote.',
    },
    DRIVE_KY_ESCORTS,
    RETRIEVED,
  ),

  escortRule(
    'ky-rear-overhang-over-10',
    'Rear overhang over 10 ft — one rear escort',
    { kind: 'gt', measure: 'rearOverhangIn', value: ftIn(10) },
    {
      escorts: 1,
      rear: 1,
      advisory:
        'drive.ky.gov states the trigger as "A rear escort is required any time overhang is in excess of 10\'". The same page describes a total overhang cap of one-third of the trailer length up to a maximum of 35 ft; that cap is summarised on the portal rather than quoted in any regulation on file, so it is stated here and is not encoded as a limit.',
    },
    DRIVE_KY_FAQ,
    RETRIEVED,
  ),

  /**
   * SPEED IMPAIRMENT — A REAL TRIGGER THIS ENGINE CANNOT EVALUATE, SO IT IS
   * STATED RATHER THAN COUNTED.
   *
   * 601 KAR 1:018 §14(2)(c) requires a trail escort on a two-lane route when
   * "The vehicle and load do not maintain the posted speed limit", and §14(4)(c)
   * requires one on a four-lane route when the load is over 12 ft wide and "does
   * not maintain a speed of forty five (45) miles per hour". Neither is a
   * property of the load or of the segment: it depends on the tractor, the
   * grade and the traffic on the day.
   *
   * It is deliberately NOT a `subjective` condition. Colorado's "Mountainous"
   * question is answerable because CDOT publishes the answer on a map; nobody
   * publishes whether this move will hold the posted limit, so making it
   * subjective would send every over-dimensional Kentucky quote to review over a
   * question with no authoritative answer. The adjustment is stated instead, the
   * way Colorado states its night-time count.
   */
  escortRule(
    'ky-speed-impairment-trail-escort',
    'A load that cannot hold the posted speed needs one more rear escort, which this quote cannot predict',
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
        '601 KAR 1:018 §14(2)(c) requires a trail escort on a two-lane route of travel if "The vehicle and load do not maintain the posted speed limit", and §14(4)(c) requires one on a four-lane route if "The vehicle and load width is in excess of twelve (12) feet and does not maintain a speed of forty five (45) miles per hour". Whether this move will hold those speeds depends on the tractor, the grade and the traffic, and no source publishes it, so the escort count above assumes the load keeps pace. If it will not, add ONE rear escort.',
    },
  ),

  /**
   * THE HEIGHT POLE. `heightPole` with NO count asserted — see
   * `KENTUCKY_HEIGHT_POLE_READING`. Both sources agree at 15 ft and above, so
   * this rule carries no disagreement; the inch they argue about is the next
   * rule down.
   */
  escortRule(
    'ky-height-pole-over-15',
    'At 15 ft high or more — any front escort on the move must run a height pole',
    { kind: 'gte', measure: 'heightIn', value: ftIn(15) },
    {
      heightPole: true,
      advisory:
        '601 KAR 1:018 §13(1)(d) requires a front escort to "Use a height pole … if the escorted load is in excess of fourteen (14) feet eleven (11) inches", and drive.ky.gov states the same requirement at "fifteen (15) feet or greater"; §1(4) defines a height pole as "a vertical clearance measuring device" and specifies no material or construction. Kentucky triggers no escort on height alone — its §14 table runs on width, length, overhang and speed — so this requirement only bites where a front escort is already required, and NO pilot car is added to the count for height. If the move carries no front escort, one must be added to carry the pole.',
    },
  ),
  /**
   * THE INCH THE TWO SOURCES ARGUE ABOUT, AND NOTHING ELSE. Strictly between
   * 14 ft 11 in and 15 ft 0 in: the regulation's "in excess of 14'11"" catches
   * this load and the portal's "15 feet or greater" does not. At exactly 14'11"
   * both say no pole; at 15 ft both say pole. `heightPole` is set alongside the
   * review flag because the stricter reading is the safe one to apply while a
   * human confirms — an under-poled load hits the wire.
   */
  escortRule(
    'ky-height-pole-14-11-to-15-conflict',
    'Between 14 ft 11 in and 15 ft high — Kentucky’s regulation and its own portal disagree about the height pole',
    {
      kind: 'between',
      measure: 'heightIn',
      min: ftIn(14, 11),
      max: ftIn(15),
      minInclusive: false,
      maxInclusive: false,
    },
    {
      heightPole: true,
      manualReview:
        'Two Kentucky sources give opposite answers for this load. 601 KAR 1:018 §13(1)(d) requires a height pole "if the escorted load is in excess of fourteen (14) feet eleven (11) inches", which catches it; the Escort Vehicle Safety Requirements bullet on drive.ky.gov requires one only "if the escorted load is fifteen (15) feet or greater", which does not. The regulation excludes exactly 14 ft 11 in and the portal excludes the whole band up to 15 ft, so they differ in this inch and nowhere else. The stricter reading is applied here — the pole is shown as required — and neither figure has been adopted. Confirm with the Division of Motor Carriers before the move.',
    },
  ),

  /**
   * KENTUCKY'S OWN ROAD CLASSIFICATION, DRIVEN THROUGH `routeClass`.
   *
   * These are the rules the `ky-` members exist for. Each fires only when the
   * load is over THAT class's published maximum, so a load under 44,000 lb is
   * legal on every class and hears nothing at all. A quote that names no class
   * leaves both conditions `unknown`, which propagates through `all` and lands
   * the rule in `undecided` with a warning naming the missing road type — the
   * engine never falls back to Class AAA.
   *
   * WHAT THESE RULES CANNOT DO is add the $60 permit to the total, because
   * `legalLimits.grossWeightLbs` holds the Class AAA figure and the engine's
   * permit gate is keyed to it. That is stated in the review text rather than
   * hidden: a `LegalLimits` field is one list and cannot hold three
   * network-dependent values, and holding the lowest of the three would flag
   * every legal truck in the Commonwealth as overweight.
   */
  escortRule(
    'ky-class-aa-gross-over-62000',
    'Over 62,000 lb on a Class AA highway — over the maximum 603 KAR 5:066 allows there',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: ['ky-class-aa'] },
        { kind: 'gt', measure: 'grossWeightLbs', value: 62000 },
      ],
    },
    {
      manualReview:
        '603 KAR 5:066 §1(1)(b): "Class \\"AA\\" shall have a maximum allowable gross weight (mass) of 62,000 pounds (28,122.70 kilograms)." This load is over that figure, so it needs an overweight permit on a Class AA highway even though it may be legal on a Class AAA one. The legal gross weight recorded for Kentucky is the Class AAA 80,000 lb figure — a legal-limit field holds one value and cannot carry three network-dependent maxima — so if this load is under 80,000 lb the permit fee is NOT in the total below and the $60 single-trip fee must be added. Confirm the classification of every segment on the route with the Division of Motor Carriers.',
    },
    KAR_603_5_066,
    EFF_603_5_066,
  ),
  escortRule(
    'ky-class-a-gross-over-44000',
    'Over 44,000 lb on a Class A highway — over the maximum 603 KAR 5:066 allows there',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: ['ky-class-a'] },
        { kind: 'gt', measure: 'grossWeightLbs', value: 44000 },
      ],
    },
    {
      manualReview:
        '603 KAR 5:066 §1(1)(c): "Class \\"A\\" shall have a maximum allowable gross weight (mass) of 44,000 pounds (20,090.05 kilograms)." A Class A highway carries barely half of what a Class AAA one does, and an ordinary five-axle combination at 80,000 lb is nearly double the limit here. This load needs an overweight permit on a Class A highway. The legal gross weight recorded for Kentucky is the Class AAA 80,000 lb figure, so if this load is under 80,000 lb the permit fee is NOT in the total below and the $60 single-trip fee must be added. Confirm the classification of every segment on the route with the Division of Motor Carriers.',
    },
    KAR_603_5_066,
    EFF_603_5_066,
  ),

  /**
   * THE STATUTORY BASELINE, FIRING ONLY INSIDE THE BANDS WHERE THE TWO TEXTS
   * DISAGREE — Colorado's 80,000-versus-85,000 shape, four dimensions wide.
   * Above each band both texts agree a permit is required, so a 20 ft wide load
   * hears nothing about KRS 189.221; below each band both agree the load is
   * legal.
   *
   * IT IS AN ADVISORY AND NOT A REVIEW FLAG, WHICH IS A DEPARTURE FROM
   * `co-interstate-gross-80000-to-85000-conflict` AND IS A JUDGEMENT CALL RATHER
   * THAN THE SOURCE'S WORDS. Two things separate it from Colorado's case.
   *
   * FIRST, THE TWO TEXTS GOVERN DIFFERENT NETWORKS AND ONE OF THEM SAYS SO.
   * Colorado's §42-4-508 and §42-4-510(5) both describe the interstate system
   * and genuinely contradict each other. KRS 189.221 opens by excluding its
   * rival: "A person shall not operate on any highway, EXCEPT those highways
   * designated by the secretary of transportation under the provisions of KRS
   * 189.222, or those locally maintained highways under the provisions of KRS
   * 189.222(13) or 189.230(4)". That is closer to Colorado's 36,000 lb
   * interstate tandem against its 40,000 lb non-interstate one, which
   * `colorado.ts` refused to model as a conflict at all — "both figures would be
   * a false conflict, because they are two systems rather than two readings".
   *
   * SECOND, THE BAND IS EVERY LOADED TRUCK IN THE COMMONWEALTH. Colorado's
   * disputed band is five thousand pounds and catches few moves. Kentucky's
   * runs from 36,000 lb to 80,000 lb, from 96 in to 102 in and from 11 ft 6 in
   * to 13 ft 6 in — an ordinary 102-inch, 13 ft 6 in, 80,000 lb rig is inside
   * three of the four bands at once. A review flag here would fire on
   * essentially every Kentucky quote, and this engine's own rule is that noise
   * on a settled question trains people to ignore the warning that matters.
   * The price is unmoved either way: Kentucky's permit is a flat $60 whether the
   * load is over the statutory figure or the regulatory one.
   *
   * WHAT IS NOT GIVEN UP. The disagreement is still held open by the mechanism
   * in `KENTUCKY_NON_DESIGNATED_VS_STATE_SYSTEM` — both candidates with
   * provenance, no adopted value, `resolveSourced` returning null and forcing
   * review there, and an honest spread — which is exactly what
   * `COLORADO_INTERSTATE_GROSS_WEIGHT_LBS` does. What changes is only whether
   * every ordinary Kentucky lane is stopped by it.
   */
  escortRule(
    'ky-krs-189-221-baseline-conflict',
    'On a non-designated Kentucky highway, KRS 189.221 sets far lower maxima than the road-classification regulations',
    {
      kind: 'any',
      of: [
        {
          kind: 'between',
          measure: 'widthIn',
          min: 96,
          max: 102,
          minInclusive: false,
        },
        {
          kind: 'between',
          measure: 'heightIn',
          min: ftIn(11, 6),
          max: ftIn(13, 6),
          minInclusive: false,
        },
        {
          kind: 'between',
          measure: 'overallLengthIn',
          min: ftIn(30),
          max: ftIn(65),
          minInclusive: false,
        },
        {
          kind: 'between',
          measure: 'grossWeightLbs',
          min: 36000,
          max: 80000,
          minInclusive: false,
        },
      ],
    },
    {
      advisory:
        'KRS 189.221 applies to any Kentucky highway that is neither designated by the secretary of transportation under KRS 189.222 nor locally maintained under KRS 189.222(13) or 189.230(4), and it sets maxima far below the ones this quote prices: 11 ft 6 in high, 96 inches wide, 26 ft 6 in for a single truck, 30 ft for a semitrailer truck, and 36,000 lb gross. 603 KAR 5:070 §3 and §4 and 603 KAR 5:066 govern the state-maintained system instead, at 13 ft 6 in, 102 inches on the National Truck Network, 45 ft single unit, 65 ft combination and 80,000 lb on a Class AAA highway. This load sits between the two figures in at least one dimension, so on a stretch of non-designated or locally-maintained road it would need a permit that the state-maintained system does not require of it. The 603 KAR figures are the ones priced above and neither reading has been adopted; both are on file. If any part of this route leaves the designated state-maintained system, confirm the permit requirement with the Division of Motor Carriers.',
    },
    KRS_189_221,
    EFF_KRS_189,
  ),

  /**
   * THE TWO OFF-NETWORK LIMITS, STATED RATHER THAN ENFORCED. See
   * `KENTUCKY_NTN_LIMIT_READING` — the legal limits recorded are the National
   * Truck Network ones, so a 102-inch trailer and a 70 ft combination price
   * clean, and these two advisories say what changes if the route leaves the
   * network and its access corridors.
   */
  escortRule(
    'ky-width-over-96-off-ntn',
    'Over 8 ft wide — legal on the National Truck Network, over the limit off it',
    { kind: 'gt', measure: 'widthIn', value: 96 },
    {
      advisory:
        '603 KAR 5:070 §3(1)(b) limits a vehicle on state-maintained highways to "A width, including body and load, not to exceed eight (8) feet (2.44 meters), excluding a width exclusion safety device", while §4(2)(a) requires an overdimensional permit on the National Truck Network only above 102 inches and §5(2) extends NTN access 15 miles from interstate and parkway exits and 5 miles from the NTN. This quote records the 102-inch figure as Kentucky\'s legal width. A route that leaves the network and those corridors needs an over-dimensional permit for any width over 8 ft, including an ordinary 102-inch trailer.',
    },
    KAR_603_5_070,
    EFF_603_5_070,
  ),
  escortRule(
    'ky-length-over-65-off-ntn',
    'Over 65 ft overall — legal on the National Truck Network, over the limit off it',
    { kind: 'gt', measure: 'overallLengthIn', value: ftIn(65) },
    {
      advisory:
        '603 KAR 5:070 §3(1)(d) limits "a motor vehicle and trailer or semitrailer combination" to 65 ft overall on state-maintained highways, while §4(2)(b) regulates only the TOWED UNIT on the National Truck Network — "A towed unit length of fifty-three (53) feet (16.154 meters) if operated in a single semitrailer combination" — and caps no overall length there. An ordinary tractor and 53 ft trailer measures about 70 ft over the bumpers and is legal on the network; the same combination needs an over-length permit off it. Kentucky also allows a 48 ft trailer up to 5 ft of rear overhang on designated highways without a permit, and gives motor-vehicle and boat transporters 3 ft front / 4 ft rear (4 ft / 6 ft stinger-steered, within an 80 ft overall) outside the 65 ft measurement.',
    },
    KAR_603_5_070,
    EFF_603_5_070,
  ),

  /**
   * THE PERMIT'S OWN CEILINGS, WHICH ARE CONFIGURATION-DEPENDENT AND CANNOT BE
   * TESTED HERE. `superload.grossWeight` holds 160,000 lb — the seven-axle
   * figure, the highest §7(2) allows — but a five-axle combination stops at
   * 96,000 lb and a six-axle one at 120,000 lb, and there is no axle count on an
   * `OsowLoad` to test against. Asserting the seven-axle ceiling for every load
   * would pass a 150,000 lb five-axle move that Kentucky will not permit, so the
   * caps are stated on the quote for anything over the five-axle figure.
   */
  escortRule(
    'ky-permitted-axle-configuration-caps',
    'Over 96,000 lb — Kentucky’s permit ceiling depends on the axle configuration, which this quote does not know',
    { kind: 'gt', measure: 'grossWeightLbs', value: 96000 },
    {
      advisory:
        '601 KAR 1:018 §7(2) caps a permitted move by CONFIGURATION, not by gross weight alone: "(f) Five (5) axle combination units not exceeding 96,000 pounds gross weight; (g) Six (6) axle combination units not exceeding 120,000 pounds gross weight; or (h) Seven (7) axle combination units not exceeding 160,000 pounds gross weight", with a 20,000 lb steering axle, a 24,000 lb single axle, 45,000 lb on a tandem of a five-axle combination, 48,000 lb on a tandem of a six-or-more-axle combination and 60,000 lb on a tridem — each also subject to 700 lb per inch of aggregate tire width, whichever is less. drive.ky.gov lists a trunnion axle group at 48,000 lb. The 160,000 lb ceiling used above is the SEVEN-axle figure; on fewer axles this load may not be permittable at any fee. Kentucky also refuses a gross or axle overweight permit under §7(1)(a) to "A unit that does not have a registered weight of at least 80,000 lbs".',
    },
  ),

  /**
   * THE POLICE ESCORT, WHICH HAS NO THRESHOLD — AND THAT IS A STRUCTURAL FACT
   * ABOUT KENTUCKY'S RULES RATHER THAN A NUMBER THE RESEARCH FAILED TO FIND.
   * 601 KAR 1:018 §14(5) makes additional escorts a discretionary condition
   * written onto the individual permit. There is no dimension or weight at which
   * one becomes mandatory, so there was never a threshold to look for, and
   * modelling one would invent a rule Kentucky did not write.
   */
  escortRule(
    'ky-police-escort-no-threshold',
    'Law-enforcement escorts in Kentucky are a discretionary permit condition, not a published threshold',
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
        'Kentucky sets NO dimensional or weight threshold that automatically requires a law-enforcement escort, and that is how the rules are built rather than a gap in what was searched: 601 KAR 1:018 §14(5) provides that "Due to safety considerations, the Division of Motor Carriers may require additional escort vehicles as a special provision of the permit", so escorts beyond the §14 table are assigned case by case when the permit is written. No police-escort vehicle is counted in this quote, and its absence must not be read as none being required for this move.',
    },
  ),
  /**
   * AND NO RATE FOR ONE EITHER. A separate finding from a separate search: even
   * where a permit condition does require a trooper, neither the Kentucky State
   * Police nor KYTC publishes what one costs.
   */
  escortRule(
    'ky-police-escort-no-rate-schedule',
    'Kentucky publishes no officer rate, minimum or mileage charge for a police escort',
    {
      kind: 'any',
      of: [
        { kind: 'gt', measure: 'widthIn', value: ftIn(12) },
        { kind: 'gt', measure: 'overallLengthIn', value: ftIn(85) },
      ],
    },
    {
      advisory:
        'Neither the Kentucky State Police (502 KAR, KRS Chapter 16) nor the Kentucky Transportation Cabinet publishes a fee schedule for escorting a commercial oversize or overweight move — no application fee, no hourly officer rate, no minimum number of hours, no mileage charge and no cancellation charge. If the Division of Motor Carriers writes a law-enforcement escort onto this permit under 601 KAR 1:018 §14(5), its cost is not in the total above and must be obtained from the agency providing the officers.',
    },
    KSP_502_KAR,
    RETRIEVED,
  ),

  /**
   * THE BUCKET TRUCK. Recorded as an absence because the absence is the finding:
   * several states set a height at which a utility crew must accompany the move,
   * and Kentucky sets none for general commercial freight. Its over-height
   * requirements are the route survey at 15 ft 6 in and, for house moves only,
   * written utility approvals.
   */
  escortRule(
    'ky-bucket-truck-no-codified-trigger',
    'Kentucky sets no codified height at which a bucket truck or utility escort becomes mandatory',
    { kind: 'gt', measure: 'heightIn', value: ftIn(13, 6) },
    {
      advisory:
        'Neither 601 KAR 1:018 nor KYTC guidance sets a numerical height at which a dedicated bucket-truck or utility escort is required for general commercial freight, so none is counted here. What Kentucky does require over height is a route survey: 601 KAR 1:018 §6(4) requires TC Form 95-625 for "A vehicle and load exceeding (15) feet, (6) inches in height", and drive.ky.gov requires written approval on letterhead from every electric, cable and telephone utility on the route for a HOUSE MOVE specifically (Form TC 95-310), which is a different product from the permit priced here. If overhead facilities on the chosen route have to be lifted or de-energised, that cost is not in this quote.',
    },
  ),

  /**
   * PILOT-CAR CERTIFICATION — RECORDED POSITIVELY, BECAUSE THE ANSWER IS "NONE"
   * AND SEVERAL NEIGHBOURING STATES ANSWER OTHERWISE. Colorado certifies its
   * operators and names six other states plus the SC&RA whose certificates it
   * will take; Washington, Florida, Oklahoma and Utah run programmes of their
   * own. Kentucky runs none and recognises none, so an operator needs only a
   * valid driver's licence and the §13 equipment — and a Kentucky-only operator
   * has nothing to carry into the next state.
   */
  escortRule(
    'ky-no-pilot-car-certification',
    'Kentucky neither certifies escort-vehicle operators nor recognises another state’s certification',
    { kind: 'gt', measure: 'widthIn', value: ftIn(12) },
    {
      advisory:
        'The Commonwealth of Kentucky does not license, certify or require any state or third-party certification for escort vehicle operators, and it publishes no reciprocity list in either direction. An escort operator needs a valid driver\'s licence and the equipment 601 KAR 1:018 §13 requires: radio contact with the load, amber strobe or flashing lights, headlamps lit in transit, a height pole where the load calls for one, and a 6 to 8 ft "OVERSIZE LOAD" sign in 18-inch black letters on a yellow background with a 1.4-inch brush stroke displayed on the lead escort for a load over 12 ft wide (§11(2)). §13(1) also sets the following distance: "A required escort vehicle shall accompany the overweight or overdimensional vehicle at a distance of 300 feet (91.44 meters) on open highways unless it is necessary to travel at a distance closer or farther away … for safety or due to road conditions." A carrier certified elsewhere gains nothing here, and an operator who works only in Kentucky carries no certificate into a neighbouring state that requires one.',
    },
  ),

  /**
   * THE SURVEY THE STATE REQUIRES AND DOES NOT PERFORM — Colorado's case again,
   * and the reason `routeAnalysisFeeUsd` is empty rather than zero.
   */
  escortRule(
    'ky-route-survey-over-15-6',
    'Over 15 ft 6 in high — Kentucky requires a driven route survey and publishes no fee for reviewing it',
    { kind: 'gt', measure: 'heightIn', value: ftIn(15, 6) },
    {
      routeSurvey: true,
      advisory:
        '601 KAR 1:018 §6(4): "A vehicle and load exceeding (15) feet, (6) inches in height shall submit a completed Overweight or Overdimensional Proposed Route Survey, TC Form 95-625 in addition to TC Form 95-10 to the Division of Motor Carriers." The survey must be physically driven and certified by the carrier or a survey company; the Commonwealth publishes no review fee for it in the sources on file, which is why no route-analysis charge appears in the total and why none is recorded as a zero. The surveyor\'s own cost is the carrier\'s and is not a state charge.',
    },
    KYTC_FORMS,
    RETRIEVED,
  ),

  escortRule(
    'ky-permit-validity-and-amendment',
    'A Kentucky single-trip permit runs ten days for one move and cannot be amended',
    {
      kind: 'any',
      of: [
        { kind: 'gt', measure: 'widthIn', value: 102 },
        { kind: 'gt', measure: 'grossWeightLbs', value: 80000 },
      ],
    },
    {
      advisory:
        '601 KAR 1:018 §2(3): "An overweight or overdimensional single trip permit shall be valid for one (1) move and a duration of ten (10) days." §2(6) makes an annual permit valid for an unlimited number of moves over 365 days. A single-trip permit CANNOT be amended; an annual one may be transferred or amended once in its effective year, and a duplicate to replace a lost, stolen or destroyed annual permit — or to move it to another towing vehicle — costs ten dollars.',
    },
  ),
  escortRule(
    'ky-seasonal-and-posted-roads',
    'Kentucky posts seasonal and emergency weight reductions that a quote cannot see',
    { kind: 'gt', measure: 'grossWeightLbs', value: 80000 },
    {
      advisory:
        'KRS 189.230 lets a county fiscal court classify a county road as a maximum weight road and enter cooperative haulage agreements with the Transportation Cabinet over it, and the Cabinet and local fiscal courts may post temporary bridge and road weight reductions during a seasonal thaw or an emergency. Individual bridge postings and local freeze-thaw restrictions are route-specific, are published day by day, and are not reflected in this quote. Note also that 603 KAR 5:066 §3(10) allows NO tolerance at all on the interstate system — "Tolerances shall not be allowed on gross weight (mass), axle weight (mass), or combinations of axle weights (mass)" — while off the interstates a tolerance of not more than five percent is allowed on AXLE weight only, never on gross.',
    },
    KRS_189_230,
    '2003-06-24',
  ),
];

// ── The jurisdiction ──────────────────────────────────────────────────────

export const KENTUCKY_OSOW_RULES: JurisdictionOsowRules = {
  code: 'KY',
  name: 'Kentucky',
  country: 'US',

  legalLimits: {
    /**
     * 102 INCHES — THE NATIONAL TRUCK NETWORK FIGURE, AND A READING. 603 KAR
     * 5:070 §3(1)(b) says 8 ft on state-maintained highways generally and
     * KRS 189.221(1) says the same 96 inches on non-designated ones, so the
     * lower figure has two independent sources behind it. It is still not the
     * one recorded, because recording it would put an over-width permit on every
     * ordinary 102-inch trailer in the Commonwealth. See
     * `KENTUCKY_NTN_LIMIT_READING` and `ky-width-over-96-off-ntn`.
     */
    widthIn: [
      fromDated(
        102,
        KAR_603_5_070,
        EFF_603_5_070,
        '603 KAR 5:070 §4(2)(a): on the National Truck Network a permit is required if the width exceeds "102 inches (2.59 meters)". EXCLUSIVE. §5(2) extends NTN access 15 miles from interstate and parkway exits and 5 miles from the NTN on state-maintained roads. Off that network §3(1)(b) allows only 8 ft, and KRS 189.221(1) allows 96 inches on non-designated highways; both are stated on the quote rather than recorded here.',
      ),
    ],
    /**
     * 13 FT 6 IN, corroborated from two directions: 603 KAR 5:070 §3(1)(a) sets
     * it as the dimensional limit and 601 KAR 1:018 §6(1) requires a permit "in
     * excess of thirteen (13) feet, six (6) inches", which is the same boundary
     * approached from the permit side. The car-hauler variance drive.ky.gov
     * publishes — "Height 13-FT and 06-IN (Car Haulers 14-FT and 00-IN)" — is a
     * VEHICLE-CLASS carve-out, not a second reading of the general limit, so it
     * is a note rather than a row: recording 14 ft as a candidate would resolve
     * the height limit to null and disable the check for every load in the state.
     */
    heightIn: [
      fromDated(
        ftIn(13, 6),
        KAR_603_5_070,
        EFF_603_5_070,
        '603 KAR 5:070 §3(1)(a): "A height, including body and load, not to exceed thirteen (13) feet and six (6) inches (4.115 meters)". INCLUSIVE — exactly 13 ft 6 in is legal.',
      ),
      fromDated(
        ftIn(13, 6),
        KAR_601_1_018,
        EFF_601_1_018,
        '601 KAR 1:018 §6(1) requires a permit for a height "in excess of thirteen (13) feet, six (6) inches", which is the same boundary from the permit side. drive.ky.gov publishes a car-hauler variance at 14 ft 0 in; that is a vehicle-class exception this engine does not identify and is not recorded as a competing limit, so a car hauler between 13 ft 6 in and 14 ft is over-permitted here rather than under.',
      ),
    ],
    /**
     * 53 FT, the NTN towed-unit figure. Kentucky regulates the trailer on the
     * network and the whole combination off it, which is why the trailer limit
     * is recorded and the overall one is not.
     */
    trailerLengthIn: [
      fromDated(
        ftIn(53),
        KAR_603_5_070,
        EFF_603_5_070,
        '603 KAR 5:070 §4(2)(b): "A towed unit length of fifty-three (53) feet (16.154 meters) if operated in a single semitrailer combination". EXCLUSIVE, and it applies to the trailer only, so any tractor length is allowed with it. §4(2)(c) allows 28 ft per trailer in a twin combination.',
      ),
    ],
    /**
     * `overallLengthIn` IS DELIBERATELY ABSENT, not empty — the Arkansas
     * treatment. Kentucky's 65 ft figure is the OFF-NETWORK cap in 603 KAR
     * 5:070 §3(1)(d); on the National Truck Network §4(2) regulates the towed
     * unit at 53 ft and states no overall cap at all, which is what 23 CFR
     * 658.13 preempts. Recording a flat 65 ft would flag every ordinary tractor
     * and 53 ft trailer — about 70 ft over the bumpers — as over-length on every
     * Kentucky lane, adding a permit the state does not require there. The 65 ft
     * figure is carried by `ky-length-over-65-off-ntn` instead.
     *
     * `frontOverhangIn` and `rearOverhangIn` are absent for the same kind of
     * reason: every overhang figure Kentucky publishes is VEHICLE-CLASS
     * specific — 3 ft front and 4 ft rear for a motor-vehicle or boat
     * transporter, 4 ft and 6 ft stinger-steered, 5 ft rear for a 48 ft trailer
     * on designated highways — and none of them is a general limit. An empty
     * list would report a gap where the state has simply not written a general
     * rule; the escort trigger it does write, a rear escort past 10 ft, is
     * carried by `ky-rear-overhang-over-10`.
     */
    grossWeightLbs: [
      fromDated(
        80000,
        KAR_603_5_066,
        EFF_603_5_066,
        '603 KAR 5:066 §1(1)(a), §2(1) and §3(1): "Class \\"AAA\\" shall have a maximum allowable gross weight (mass) of 80,000 pounds (36,287.36 kilograms)." INCLUSIVE. This is ONE OF THREE class maxima — Class AA is 62,000 lb and Class A is 44,000 lb — and the other two are NOT recorded here as competing candidates, because they are three networks rather than three readings and recording them would resolve this field to null and disable the whole overweight path. They are carried by `ky-class-aa-gross-over-62000` and `ky-class-a-gross-over-44000`, which go undecided rather than assuming AAA when the class is unknown. KRS 189.221(4) sets 36,000 lb on non-designated highways; see `KENTUCKY_NON_DESIGNATED_VS_STATE_SYSTEM`.',
      ),
    ],
    singleAxleLbs: [
      fromDated(
        20000,
        KAR_603_5_066,
        EFF_603_5_066,
        '603 KAR 5:066 §3(2), §4(2) and §5(2): "Gross axle weight (mass) for a single axle shall not exceed 20,000 pounds (9071.84 kilograms) (with axles less than forty-two (42) inches (1.07 meters) apart to be considered as a single axle)." INCLUSIVE, and the same figure on all three classes and the interstates. §3(8) additionally caps tire loading at 700 lb per inch of aggregate stamped tire width, whichever is less; KRS 189.221(5) sets 600 lb per inch on non-designated roads.',
      ),
    ],
    tandemAxleLbs: [
      fromDated(
        34000,
        KAR_603_5_066,
        EFF_603_5_066,
        '603 KAR 5:066 §3(3), §4(3) and §5(3): "Gross weight (mass) shall not exceed 34,000 pounds (15,422.13 kilograms) on two (2) axles in tandem arrangement that which are spaced forty-two (42) inches (1.07 meters) or more apart and ninety-six (96) inches (2.44 meters) or less apart." INCLUSIVE. A tridem takes the same 34,000 lb within 96 inches and 48,000 lb between 96 and 120 inches when every adjacent pair is 42 inches or more apart and the vehicle grosses 73,280 lb or less; other configurations take the bridge formula W = 500 (LN/N-1 + 12N + 36) under §3(7), capped at 20,000 lb on any single axle and 80,000 lb gross.',
      ),
    ],
  },

  /**
   * $60, CORROBORATED BY THE REGULATION AND THE PORTAL — and the whole permit.
   * Kentucky charges one flat amount for a single-trip permit whether the load
   * is oversize, overweight or both, with no weight step, no mileage component,
   * no per-axle term and no per-ton term.
   *
   * The proposed $120 is NOT a candidate here. It is not in force and no date
   * exists to put on it; see `KENTUCKY_PROPOSED_AMENDMENT_NOT_IN_FORCE`. Had it
   * been dated into effect, the $60 spread would be over the $50 materiality
   * threshold and `priceSourced` would escalate it to review rather than quietly
   * adopt the higher figure.
   */
  permitBaseFeeUsd: [
    fromDated(
      60,
      KAR_601_1_018,
      EFF_601_1_018,
      '601 KAR 1:018 §17(2)(b): "A payment of sixty (60) dollars pursuant to KRS 189.270(2);".',
    ),
    fromUndatedPage(
      60,
      DRIVE_KY_FAQ,
      'drive.ky.gov: "A Single Trip permit cost $60. There is an applicable service fee of 4% for credit card or a $3 ACH fee." The S05 metal-commodities single trip is a separate route-specific product at $100 and is not the permit priced here.',
    ),
  ],

  /**
   * NO `oversizeFeeBands`. Kentucky charges the same $60 whatever the load
   * measures — no width step, no height step, no length step — so there is no
   * band to select and `permitBaseFeeUsd` carries the whole oversize charge.
   * Texas's and Arkansas's shape. An empty band list would be a different and
   * wrong claim: that we looked for a dimensional schedule and found nothing.
   */

  overweightPricing: [
    fromDated<OverweightPricing>(
      {
        kind: 'includedInBaseFee',
        explanation:
          '601 KAR 1:018 §17(2)(b) sets one payment of sixty dollars for a single-trip overweight OR overdimensional permit. The regulation states no weight-stepped surcharge, no per-mile charge and no per-ton charge anywhere in the fee section, so being overweight adds nothing to the $60.',
      },
      KAR_601_1_018,
      EFF_601_1_018,
    ),
    fromUndatedPage<OverweightPricing>(
      {
        kind: 'includedInBaseFee',
        explanation:
          'KYTC\'s own FAQ prices the single-trip permit in one sentence — "A Single Trip permit cost $60" — with no weight table, no mileage column and no per-pound bracket. The $60 is a uniform flat rate for any weight the Division of Motor Carriers will permit.',
      },
      DRIVE_KY_FAQ,
    ),
  ],

  /**
   * EMPTY, AND IT MEANS SOMETHING HERE. `overweightPricing` above records that
   * Kentucky folds the overweight charge into the base fee, so an empty band
   * list is the state's own position rather than a research gap — which is the
   * exact ambiguity `OverweightPricing` exists to resolve, and which its own
   * documentation uses Kentucky to illustrate.
   */
  overweightBands: [],
  overweightPerMile: [],

  /**
   * EMPTY. The only fee Kentucky attaches to a weight is the flat $60 itself.
   * KRS 189.270(10)'s parade-float waiver is a genuine zero but is a USE-based
   * exemption on a product this engine cannot identify, so it is recorded in
   * `KENTUCKY_PARADE_FLOAT_FEE_WAIVER_USD` rather than modelled as a conditional
   * fee that could zero a real permit.
   */
  conditionalFees: [],

  /**
   * 4% OF THE PERMIT TOTAL, WITH NO FLAT COMPONENT. `perPermitUsd: 0` is a
   * SOURCED ZERO rather than an omission: the FAQ states the surcharge in full
   * and there is no per-permit amount in it.
   *
   * The $3 ACH charge is the OTHER payment method, not a competing figure for
   * this one, so it is not a second candidate — recording it as one would be the
   * false conflict `colorado.ts` warns about, and the resolver would refuse to
   * price any Kentucky permit at all. It is stated in the note instead: on a $60
   * permit the card surcharge is $2.40 and ACH is $3.00, so ACH is dearer below
   * $75 of permit fees and cheaper above it.
   */
  transactionFee: [
    fromUndatedPage<TransactionFee>(
      { perPermitUsd: 0, percentOfTotal: 4 },
      DRIVE_KY_FAQ,
      '"There is an applicable service fee of 4% for credit card or a $3 ACH fee." The card surcharge is recorded because it is the default electronic checkout; a carrier paying by ACH pays a flat $3.00 instead, which is $0.60 more than the card fee on a single $60 permit.',
    ),
  ],

  /**
   * BOTH EMPTY, AND NOT AS A SOURCED ZERO. Kentucky REQUIRES a driven route
   * survey over 15 ft 6 in (601 KAR 1:018 §6(4), TC Form 95-625) and publishes
   * no charge for reviewing it, and it publishes no bridge-analysis fee: the
   * KYTC Bridge Preservation Branch performs the route and bridge analysis for a
   * load past the §7(2) caps and no schedule for it exists in the sources on
   * file. The proposed amendment WOULD introduce one — "Superload bridge
   * analysis cost an additional $500" — and it is not in force, so the honest
   * present state is "no fee published", which is not a published zero. See
   * `KENTUCKY_PROPOSED_2026_FEES`.
   */
  routeAnalysisFeeUsd: [],
  noBridgeRouteFeeUsd: [],

  superload: {
    /**
     * 160,000 LB, EXCLUSIVE — A REAL PERMIT CEILING RATHER THAN A FEE TRIGGER,
     * WHICH IS THE DISTINCTION FLORIDA'S 300,000 LB FAILED.
     *
     * 601 KAR 1:018 §7(2)(h) is the top of a closed list of what a single-trip
     * permit may authorise: "Seven (7) axle combination units not exceeding
     * 160,000 pounds gross weight." Nothing heavier is issued over the counter
     * at any fee — §7(3) sends a trunnion group to "a route and bridge analysis
     * performed by the cabinet's Bridge Preservation Branch" and §7(4) refuses
     * the move outright "unless each of the bridges and roads on the moving
     * route have sufficient capacity to accommodate the load".
     *
     * IT IS SAFE TO MIRROR IN THE WIDGET, and Florida's failure mode cannot
     * occur here for a structural reason: Kentucky's permit fee is FLAT, so the
     * schedule has no upper weight bound to fall short of and the server prices
     * every pound below the threshold that the client accepts. Florida's
     * 300,000 lb was a structural-evaluation trigger sitting far above a
     * per-mile schedule that stopped at 162,000 lb.
     *
     * WHAT THE MIRROR CANNOT SEE is the axle configuration: the same section
     * caps a five-axle combination at 96,000 lb and a six-axle one at 120,000
     * lb, and 160,000 is the seven-axle figure. `ky-permitted-axle-configuration-caps`
     * states that on any quote over 96,000 lb.
     */
    grossWeight: [
      fromDated<Threshold>(
        { value: 160000, inclusive: false },
        KAR_601_1_018,
        EFF_601_1_018,
        '601 KAR 1:018 §7(2)(h): "Seven (7) axle combination units not exceeding 160,000 pounds gross weight." EXCLUSIVE — exactly 160,000 lb is still permittable on seven axles. Above it there is no over-the-counter permit: §7(3) requires "a route and bridge analysis performed by the cabinet\'s Bridge Preservation Branch" and §7(4) requires that every bridge and road on the route have sufficient capacity. drive.ky.gov caps its annual permits at the same 160,000 lb.',
      ),
    ],
    /** Kentucky publishes no axle-spacing superload trigger. */
    shortSpacing: [],
    /**
     * NO DIMENSIONAL SUPERLOAD ROWS, AND THAT IS A REFUSAL TO RECONSTRUCT ONE.
     * The research summarised Kentucky's superload class as also covering width
     * over 16 ft and height over 15 ft 6 in, but neither figure is quoted from
     * any Kentucky document in that sense: 16 ft is the maximum WIDTH of the A02
     * and A04 ANNUAL permits on drive.ky.gov and a step in the escort table, and
     * 15 ft 6 in is the ROUTE SURVEY trigger in §6(4), which is recorded under
     * `routeInspection` where it belongs. Encoding either as a superload
     * threshold would put an agency-priced escalation on the quote that Kentucky
     * has not published.
     */
  },

  /**
   * ONE TRIGGER, AND IT IS QUOTED. 601 KAR 1:018 §6(4) requires TC Form 95-625
   * over 15 ft 6 in in height and states no width or length equivalent, so those
   * two lists are EMPTY rather than filled with a figure borrowed from the
   * escort table — the Arkansas and Colorado treatment for a step a state has
   * not defined.
   */
  routeInspection: {
    widthIn: [],
    heightIn: [
      fromDated<Threshold>(
        { value: ftIn(15, 6), inclusive: false },
        KAR_601_1_018,
        EFF_601_1_018,
        '601 KAR 1:018 §6(4): "A vehicle and load exceeding (15) feet, (6) inches in height shall submit a completed Overweight or Overdimensional Proposed Route Survey, TC Form 95-625 in addition to TC Form 95-10 to the Division of Motor Carriers." EXCLUSIVE ("exceeding").',
      ),
    ],
    lengthIn: [],
  },

  escortRules: KENTUCKY_ESCORT_RULES,

  /**
   * FALSE, AND FLATLY SO. Kentucky assesses no mileage fee, no per-ton-mile
   * charge and no distance band anywhere in its single-trip schedule: the $60 is
   * a uniform flat rate for any approved weight over any distance inside the
   * Commonwealth.
   */
  feesDependOnDistance: false,
};

/** Cited for the house-move utility approvals; see `KENTUCKY_HOUSE_MOVE_REQUIREMENTS`. */
export const KENTUCKY_HOUSE_MOVE_SOURCE = KYTC_TC_95_310;

/** Cited for the annual permit fee table and the S05 metal-commodities product. */
export const KENTUCKY_ANNUAL_PERMIT_SOURCE = DRIVE_KY_PERMITS;

/** Cited for the car-hauler height variance and the 48 ft trailer rear overhang. */
export const KENTUCKY_LEGAL_DIMENSIONS_SOURCE = DRIVE_KY_DIMENSIONS;

/** Cited for the parade-float waiver and the farm annual permit fees. */
export const KENTUCKY_PERMIT_STATUTE_SOURCE = KRS_189_270;

/** The proposed amendment, kept addressable so a future adoption can be dated. */
export const KENTUCKY_PROPOSED_AMENDMENT_SOURCE = KAR_601_1_018_REG;
