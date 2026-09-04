/**
 * LOUISIANA — oversize/overweight single-trip permit rules.
 *
 * THE STATE WHOSE SOURCES DISAGREE WITH THEMSELVES BY DESIGN, AND ALWAYS THE
 * SAME WAY ROUND.
 * ---------------------------------------------------------------------------
 * Every recorded conflict in this file has one shape: the Louisiana
 * Administrative Code still prints text the Revised Statutes have since
 * superseded, and both remain published, current and citable. The single-trip
 * oversize fee is $8 in LAC 73:I.303(A) and $10 in R.S. 32:387(H)(1)(a). The
 * Class II ocean-container permit is $500 a year in LAC 73:I.723(A)(2) and $375
 * biannually in R.S. 32:387(J)(2)(a). The pleasure-craft permit is $5 in LAC
 * 73:I.723(J) and $10 in R.S. 32:387(C)(5). A rear overhang is legal to 8 ft
 * under R.S. 32:382(B)(1) and needs warning flags past 4 ft under LAC
 * 73:I.309(E)(2).
 *
 * THE RESEARCH SUPPLIED A RESOLUTION NOTE FOR EACH ONE, AND THE ENGINE DOES NOT
 * ACT ON IT. Every note argues the same thing — the statute is the later
 * enactment and supersedes the older administrative text — and that argument is
 * recorded here in full, as the researcher's documented rationale, on the row it
 * belongs to. It is NOT allowed to collapse the conflict. `resolveSourced`
 * returns `null`, keeps both candidates with their provenance, forces manual
 * review and publishes the spread, because "the statute probably wins" is a
 * legal opinion and this engine's contract is that it does not form those. A
 * permit office charging the administrative-code figure would not be acting
 * unlawfully in any way the quote can demonstrate.
 *
 * WHERE THE SOURCE GIVES AN AMENDING ACT, THE DATES DO THE WORK INSTEAD. The
 * Class II ocean-container row is the one conflict that carries an amendment and
 * an effective date — Acts 2019 No. 301, effective 2020-01-01 — so the statutory
 * candidate's `effectiveFrom` is that date rather than our retrieval date. That
 * is the mechanism for reasoning about which text is in force: a quote priced
 * as-of 2019 sees only the $500 administrative figure and a quote priced today
 * sees both. What it deliberately does NOT do is close the administrative row
 * with `effectiveTo: '2019-12-31'` — the LAC still publishes $500 today, and
 * expiring a row we can watch a state publish would be manufacturing the
 * resolution the previous paragraph refuses to make.
 *
 * THE FEE SCHEDULE IS A TWO-DIMENSIONAL TABLE, WHICH IS NEW HERE. R.S.
 * 32:387(H)(2)(c) prints ten gross-weight rows against five distance columns and
 * the CELL is the fee — "80,001-100,000 | $45.00 $67.50 $97.50 $120.00 $150.00".
 * Weight alone names five different amounts, so `WeightBand` grew optional
 * `minMiles`/`maxMiles` to name the column, the same way `OversizeFeeBand`
 * already names Illinois's distance step. `feesDependOnDistance` is true and
 * Louisiana cannot be priced without Louisiana miles.
 *
 * ONLY SCHEDULE (c) IS PRICED, AND THAT IS AN INFERENCE — FLAGGED AS ONE.
 * Louisiana splits its overweight fee across three schedules by AXLE
 * CONFIGURATION: (a) for a load within legal gross but over an axle limit, and
 * for two- or three-single-axle combinations; (b) for a combination with exactly
 * four axles including the steering axle; (c) for "five or more single or
 * individual axles, or tandem, or tridum axles, including the steering axle,
 * where the gross weight exceeds 80,000 pounds". The engine reaches the
 * overweight path only when the load is over the 80,000 lb legal gross, and an
 * over-gross permitted combination is a five-or-more-axle rig in all but unusual
 * cases — so schedule (c) is what is priced. Schedules (a) and (b) are kept
 * verbatim in `LOUISIANA_OVERWEIGHT_SCHEDULE_A` and `_B`, and
 * `la-four-axle-schedule-b` says on the quote how far wrong a four-axle
 * combination would be: at 85,000 lb over 40 miles, schedule (b) charges $67.50
 * where schedule (c) charges $45.00. The exposure is bounded and stated; it is
 * not silently absorbed.
 *
 * WHAT IS NOT PRICED, AND WHY.
 *
 *   - THE TRANSACTION FEE. Louisiana publishes no card surcharge and no
 *     processing percentage. LAC 73:I.701 says only that "All costs incidental
 *     to permits, such as, telephone charges, wire service charges, insurance,
 *     or escort fees must be borne by the applicant" — a third-party markup the
 *     state neither sets nor discloses. So `transactionFee` is an EMPTY list
 *     rather than a sourced zero, and the engine says on every Louisiana quote
 *     that no transaction cost is on file.
 *   - THE STRUCTURAL EVALUATION FEES. R.S. 32:387(H)(2)(c)(iv) prices a bridge
 *     review at $187.50, $750.00 or $1,275.00 depending on the STRUCTURE, and a
 *     route crosses an unknown number of structures of unknown types. Three
 *     figures and no count is not a number, so `routeAnalysisFeeUsd` is empty
 *     and the schedule is exported as `LOUISIANA_STRUCTURAL_EVALUATION_FEES`.
 *   - THE TON-MILE FORMULAS. Both of them — $0.10 per ton-mile above 60,000 lb
 *     of excess in schedule (a), and $0.75 per ton-mile above 254,000 lb gross —
 *     are silent on whether a part ton or a part mile rounds up, rounds down or
 *     bills pro rata. Neither is on a priced path here (schedule (a) is not
 *     priced, and over 254,000 lb is a superload), so the gap is stated rather
 *     than guessed at.
 *   - THE POLICE ESCORT. Louisiana is unusually forthcoming here — $75.00 an
 *     hour with a two-hour minimum, an hour of travel time, a $150.00 floor, and
 *     a separate banded vehicle-use fee of $100 to $200 by distance — and none
 *     of it is in the total, because the hours are set on the day. The one thing
 *     it does not publish is a cancellation charge, and the research declined to
 *     paraphrase the document on that point rather than reconstruct it. It is
 *     recorded as unknown and left there.
 *   - THE HEIGHT POLE, WHICH LOUISIANA DOES NOT REQUIRE. LAC 73:I.1901(C)(8)
 *     says a clearance bar "is strongly recommended", not that it is required,
 *     and no rule in this file sets `heightPole`. Reading a recommendation as a
 *     mandate would add a priced service the state has not asked for.
 */
import type { SourceDoc, Sourced } from '../provenance.js';
import { ftIn, type EscortRule, type RouteClass } from '../escortRules.js';
import type {
  CombinedFeeRule,
  JurisdictionOsowRules,
  OversizeFeeBand,
  OverweightPricing,
  Threshold,
  WeightBand,
} from '../types.js';

const RETRIEVED = '2026-09-03';

// ── Source documents ──────────────────────────────────────────────────────
/**
 * THE STATUTES CARRY A BARE YEAR AND THE RULES MOSTLY CARRY NOTHING. Justia
 * states "2025" for every Title 32 section below with no month and no day, which
 * `SourceDoc.revisedOn` accepts and ranks correctly against full dates. What it
 * does NOT let us do is set `effectiveFrom` from it: that field feeds
 * `isInEffect` and needs a real date. Louisiana acts take effect on a date fixed
 * by the constitution's adjournment rule rather than one Justia prints, so
 * inventing `2025-08-01` would be manufacturing a precision the source does not
 * have. Statute rows therefore start from OUR RETRIEVAL DATE — the only day on
 * which we can prove what the text said — except the one row whose amending act
 * and effective date the research supplies outright.
 */
const RS_380: SourceDoc = {
  id: 'la-rs-32-380',
  title: 'La. R.S. 32:380 — Width of vehicles (via Justia)',
  url: 'https://law.justia.com/codes/louisiana/revised-statutes/title-32/rs-32-380/',
  publisher: 'Justia, reproducing the Louisiana Revised Statutes',
  revisedOn: '2025',
  retrievedOn: RETRIEVED,
  cite: '"A. The width of any vehicle shall not exceed one hundred two inches, exclusive of safety devices."; subsection D, the secretary designates the qualifying highway system',
};

const RS_381: SourceDoc = {
  id: 'la-rs-32-381',
  title: 'La. R.S. 32:381 — Height of vehicles (via Justia)',
  url: 'https://law.justia.com/codes/louisiana/revised-statutes/title-32/rs-32-381/',
  publisher: 'Justia, reproducing the Louisiana Revised Statutes',
  revisedOn: '2025',
  retrievedOn: RETRIEVED,
  cite: '13 ft 6 in generally; 14 ft for a vehicle operating EXCLUSIVELY on the interstate system with one road mile of access',
};

const RS_382: SourceDoc = {
  id: 'la-rs-32-382',
  title: 'La. R.S. 32:382 — Length of vehicles and projecting loads (via Justia)',
  url: 'https://law.justia.com/codes/louisiana/revised-statutes/title-32/rs-32-382/',
  publisher: 'Justia, reproducing the Louisiana Revised Statutes',
  revisedOn: '2025',
  retrievedOn: RETRIEVED,
  cite: '45 ft single vehicle; 59 ft 6 in semitrailer; 4 ft front and 8 ft rear projection; 15 ft for poles and piling and 20 ft for forest products',
};

const RS_386: SourceDoc = {
  id: 'la-rs-32-386',
  title: 'La. R.S. 32:386 — Weight of vehicles (via Justia)',
  url: 'https://law.justia.com/codes/louisiana/revised-statutes/title-32/rs-32-386/',
  publisher: 'Justia, reproducing the Louisiana Revised Statutes',
  revisedOn: '2025',
  retrievedOn: RETRIEVED,
  cite: '80,000 lb gross; 20,000 lb single and 34,000 lb tandem on low-pressure pneumatic tires; 88,000 lb and 83,400 lb tridum/quadrum allowances; the bridge formula in subsection H',
};

const RS_387: SourceDoc = {
  id: 'la-rs-32-387',
  title: 'La. R.S. 32:387 — Special permits for excessive size and weight (via Justia)',
  url: 'https://law.justia.com/codes/louisiana/revised-statutes/title-32/rs-32-387/',
  publisher: 'Justia, reproducing the Louisiana Revised Statutes',
  revisedOn: '2025',
  retrievedOn: RETRIEVED,
  cite: 'subsection H — the $10 oversize fee, the three overweight schedules, the 232,001 lb route restriction and the over-254,000 lb ton-mile formula with its structural evaluation fees',
};

const LAC_303: SourceDoc = {
  id: 'la-lac-73-i-303',
  title: 'La. Admin. Code tit. 73, §I-303 — Permit fees and restrictions',
  url: 'https://regulations.justia.com/states/louisiana/title-73/part-i/chapter-3/section-i-303/',
  publisher: 'Justia, reproducing the Louisiana Administrative Code',
  revisedOn: '2025-06-20',
  retrievedOn: RETRIEVED,
  cite: '"The fee is $8 for a single trip if the trip lasts less than one day or $8 for a single day if the trip lasts more than one day."; current through Register Vol. 51, No. 06',
};

const LAC_309: SourceDoc = {
  id: 'la-lac-73-i-309',
  title: 'La. Admin. Code tit. 73, §I-309 — Permit restrictions (last amended April 1994)',
  url: 'https://www.law.cornell.edu/regulations/louisiana/La-Admin-Code-tit-73-SS-I-309',
  publisher: 'Cornell Legal Information Institute, reproducing the Louisiana Administrative Code',
  revisedOn: '1994-04-01',
  retrievedOn: RETRIEVED,
  cite: '"The DOTD District Maintenance Engineer must approve all movements over 18 feet wide"; the 4 ft rear-overhang warning-flag rule in (E)(2)',
};

const LAC_701: SourceDoc = {
  id: 'la-lac-73-i-701',
  title: 'La. Admin. Code tit. 73, §I-701 — General permit provisions (undated)',
  url: 'https://www.law.cornell.edu/regulations/louisiana/La-Admin-Code-tit-73-SS-I-701',
  publisher: 'Cornell Legal Information Institute, reproducing the Louisiana Administrative Code',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: '"All costs incidental to permits, such as, telephone charges, wire service charges, insurance, or escort fees must be borne by the applicant."',
};

const LAC_711: SourceDoc = {
  id: 'la-lac-73-i-711',
  title: 'La. Admin. Code tit. 73, §I-711 — Maximum permit weights allowed (last amended February 1996)',
  url: 'https://www.law.cornell.edu/regulations/louisiana/La-Admin-Code-tit-73-SS-I-711',
  publisher: 'Cornell Legal Information Institute, reproducing the Louisiana Administrative Code',
  revisedOn: '1996-02-01',
  retrievedOn: RETRIEVED,
  cite: '"Gross Vehicle Weight-238,000 pounds ... Since railroads and navigable waterways are adequate for the movement of loads in excess of 238,000 pounds, these facilities must be used instead of highways"',
};

const LAC_716: SourceDoc = {
  id: 'la-lac-73-i-716',
  title: 'La. Admin. Code tit. 73, §I-716 — Overheight load notification',
  url: 'https://regulations.justia.com/states/louisiana/title-73/part-i/chapter-7/section-i-716/',
  publisher: 'Justia, reproducing the Louisiana Administrative Code',
  revisedOn: '2025-06-20',
  retrievedOn: RETRIEVED,
  cite: '"All loads exceeding 16 feet 5 inches in height that are moving on state highways are required to notify the DOTD district office where the move originates."',
};

const LAC_717: SourceDoc = {
  id: 'la-lac-73-i-717',
  title: 'La. Admin. Code tit. 73, §I-717 — Houses or buildings over 18 feet high (last amended February 1996)',
  url: 'https://www.law.cornell.edu/regulations/louisiana/La-Admin-Code-tit-73-SS-I-717',
  publisher: 'Cornell Legal Information Institute, reproducing the Louisiana Administrative Code',
  revisedOn: '1996-02-01',
  retrievedOn: RETRIEVED,
  cite: '"Movers of houses, buildings, or loads that exceed 18 feet in height must contact the DOTD district office where the move originates for procedures to be followed before a permit will be issued"',
};

const LAC_723: SourceDoc = {
  id: 'la-lac-73-i-723',
  title: 'La. Admin. Code tit. 73, §I-723 — Escorts, cancellations and periodic permits (undated)',
  url: 'https://www.law.cornell.edu/regulations/louisiana/La-Admin-Code-tit-73-SS-I-723',
  publisher: 'Cornell Legal Information Institute, reproducing the Louisiana Administrative Code',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'the private-escort and state-police escort triggers; "Class II ($500 per year)"; "Pleasure Craft ($5 Fee for 30 Days)"; the $5 cancellation retention',
};

const LAC_1901: SourceDoc = {
  id: 'la-lac-73-i-1901',
  title: 'La. Admin. Code tit. 73, §I-1901 — Escort vehicle requirements (last amended August 2016)',
  url: 'https://www.law.cornell.edu/regulations/louisiana/La-Admin-Code-tit-73-SS-I-1901',
  publisher: 'Cornell Legal Information Institute, reproducing the Louisiana Administrative Code',
  revisedOn: '2016-08-01',
  retrievedOn: RETRIEVED,
  cite: 'escort positioning (D)(9); the overweight-escort discretion (13); "it is strongly recommended that a clearance bar of some design be attached"; the $10 out-of-state registration',
};

const LAC_55_1101: SourceDoc = {
  id: 'la-lac-55-i-1101',
  title: 'La. Admin. Code tit. 55, §I-1101 — State police escort vehicle fee scale (amended February 2018)',
  url: 'https://www.law.cornell.edu/regulations/louisiana/La-Admin-Code-tit-55-SS-I-1101',
  publisher: 'Cornell Legal Information Institute, reproducing the Louisiana Administrative Code',
  revisedOn: '2018-02-01',
  retrievedOn: RETRIEVED,
  cite: '"Distance Traveled by Escort Vehicle Fee: 0-49 miles $100; 50-99 miles $125; 100-199 miles $150; 200-299 miles $175; 300 and over miles $200"',
};

const LSP_1107: SourceDoc = {
  id: 'la-lsp-po-1107',
  title: 'Louisiana State Police Policy Order P.O. 1107 — Escorts',
  url: 'https://public.powerdms.com/LADPSC/documents/299659',
  publisher: 'Louisiana Department of Public Safety and Corrections',
  revisedOn: '2024-01-15',
  retrievedOn: RETRIEVED,
  cite: '"Fees for off-duty escorts are $75.00 per hour with a two-hour minimum."; the travel-time and $150.00 minimum rules; the lodging obligation',
};

const DOTD_SINGLE_TRIP: SourceDoc = {
  id: 'la-dotd-single-trip',
  title: 'Louisiana DOTD — Single Trip Permits (undated)',
  url: 'https://dotd.la.gov/about/office-of-operations/oversized-and-overweight-truck-permits/single-trip-permits/',
  publisher: 'Louisiana Department of Transportation and Development',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: '"Oversize dimensions are also covered at no additional charge, provided they are specified on the permit... Active for 5 days"; mobile homes "Active for 3 Days"',
};

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * A row from a source whose only date is a bare year, or none at all.
 * `effectiveFrom` is the retrieval date for the reason set out above: it is the
 * only day on which we can prove what the document said.
 */
function fromRetrieval<T>(value: T, source: SourceDoc, note?: string): Sourced<T> {
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
  source: SourceDoc = LAC_723,
  effectiveFrom: string = RETRIEVED,
): EscortRule {
  return {
    id,
    jurisdiction: 'LA',
    description,
    when,
    then,
    source,
    effectiveFrom,
    effectiveTo: null,
  };
}

/**
 * LOUISIANA'S ROUTE VOCABULARY IS LANE COUNT AND NOTHING ELSE — "two-lane
 * highway" and "multi-lane highway", both terms of art in LAC 73:I.723(K) and
 * LAC 73:I.1901(D)(9). No colour map, no mountainous class, no divided/undivided
 * split, so no `la-` prefixed member was needed: the general members already say
 * what Louisiana means.
 *
 * `urban` IS DELIBERATELY MAPPED TO NEITHER. It is a land-use description rather
 * than a lane count, and an urban arterial can be two-lane or multi-lane. A
 * quote that supplies it leaves Louisiana's ESCORT POSITION undecided, which is
 * the honest answer — and the escort COUNT is one either way, so the price does
 * not move. See `la-width-over-12-to-16`.
 */
const MULTI_LANE: RouteClass[] = ['divided', 'multilane-undivided', 'interstate'];
const TWO_LANE: RouteClass[] = ['two-lane'];

// ── Escort rules ──────────────────────────────────────────────────────────

export const LOUISIANA_ESCORT_RULES: EscortRule[] = [
  /**
   * THE COUNT IS ONE ON EVERY ROAD IN LOUISIANA, AND ONLY THE POSITION MOVES —
   * so this is one rule with a bare count, the Texas pattern, rather than two
   * position-specific rules that would send every quote without a road type to
   * review over a distinction that does not change the price by a dollar.
   * LAC 73:I.723 states the trigger identically for both road types, and
   * §I-1901(D)(9) supplies the positions: "The escort vehicle shall travel to
   * the rear of the overwidth movement on multi-lane highways and in front of
   * the escorted load on two-lane highways."
   */
  escortRule(
    'la-width-over-12-to-16',
    'Over 12 ft wide and up to 16 ft wide — one private escort (front on a two-lane highway, rear on a multi-lane highway)',
    {
      kind: 'between',
      measure: 'widthIn',
      min: ftIn(12),
      max: ftIn(16),
      minInclusive: false,
    },
    { escorts: 1 },
  ),
  escortRule(
    'la-length-over-90-to-125',
    'Over 90 ft long and up to 125 ft long — one private escort behind the load',
    {
      kind: 'between',
      measure: 'overallLengthIn',
      min: ftIn(90),
      max: ftIn(125),
      minInclusive: false,
    },
    { escorts: 1, rear: 1 },
  ),

  /**
   * PAST 16 FEET LOUISIANA WILL NOT ACCEPT A PRIVATE ESCORT AT ALL. LAC
   * 73:I.723 lists over 16 ft wide and over 125 ft long under "State Police
   * Escorts", and the private-escort paragraph stops at those same numbers — so
   * this is not an additional escort on top of the pilot car, it is a different
   * and far more expensive class of escort replacing it.
   *
   * The position comes from the same §I-1901(D)(9) rule the private cars follow,
   * which P.O. 1107 §2(ix) adopts for troopers, so these ARE split by road type:
   * `policeFront`/`policeRear` have no bare-count field to fall back on.
   */
  escortRule(
    'la-police-width-over-16-two-lane',
    'Over 16 ft wide on a two-lane highway — a Louisiana State Police escort ahead of the load',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: TWO_LANE },
        { kind: 'gt', measure: 'widthIn', value: ftIn(16) },
      ],
    },
    { policeFront: 1 },
  ),
  escortRule(
    'la-police-width-over-16-multi-lane',
    'Over 16 ft wide on a multi-lane highway — a Louisiana State Police escort behind the load',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: MULTI_LANE },
        { kind: 'gt', measure: 'widthIn', value: ftIn(16) },
      ],
    },
    { policeRear: 1 },
  ),
  escortRule(
    'la-police-length-over-125',
    'Over 125 ft long — a Louisiana State Police escort behind the load, on every road',
    { kind: 'gt', measure: 'overallLengthIn', value: ftIn(125) },
    { policeRear: 1 },
  ),

  /**
   * THE RATE LOUISIANA DOES PUBLISH — AND IT IS TWO CHARGES, NOT ONE. Most
   * states in this directory publish nothing at all for a trooper; Louisiana
   * publishes an hourly officer rate AND a separate banded vehicle-use fee, and
   * a quote that carried only the first would understate the escort by $100 to
   * $200 before a single hour was billed. Neither is in the permit total,
   * because the hours are set on the day of the move.
   */
  escortRule(
    'la-police-escort-rate',
    'Louisiana publishes both an hourly trooper rate and a banded vehicle-use fee, and neither can be put in a permit total',
    {
      kind: 'any',
      of: [
        { kind: 'gt', measure: 'widthIn', value: ftIn(16) },
        { kind: 'gt', measure: 'overallLengthIn', value: ftIn(125) },
      ],
    },
    {
      advisory:
        'A Louisiana State Police escort is billed in two parts. THE OFFICER: P.O. 1107 §3(iv) — "Fees for off-duty escorts are $75.00 per hour with a two-hour minimum." §3(v) adds that "One hour of travel time shall be added to the fee for those moves beginning and ending within the same Troop area. However, if the escort is less than one (1) hour, the charge to the mover will be $150.00. If the move exceeds one (1) hour, the officer shall be entitled to charge $150.00 for the first two hours plus one (1) hour of travel time", and travel time across troop boundaries follows the Travel Time Remuneration Chart. THE VEHICLE: LAC 55:I.1101 sets a separate fee for the use of the state police vehicle, banded by distance — 0–49 miles $100; 50–99 miles $125; 100–199 miles $150; 200–299 miles $175; 300 and over $200 — which is paid to Louisiana State Police ON TOP OF the officer remuneration, and the statutory floor under R.S. 32:387(B)(4) is $25. The mover must also provide the officer a room when the move runs more than one day; meals are the officer\'s own. NO CANCELLATION CHARGE IS PUBLISHED: neither P.O. 1107 nor LAC Title 55 establishes one, and the research declined to paraphrase the policy order on that point rather than reconstruct wording it could not quote — so a cancellation cost is unknown here rather than assumed to be zero. Because the number of hours is set on the day, no police-escort amount is included in the permit total below.',
    },
    LSP_1107,
    '2024-01-15',
  ),

  /**
   * ONE ESCORT CANNOT COVER TWO WIDE LOADS, AND CAN COVER TWO LONG ONES. It is
   * the only ratio rule in this directory that runs the other way — it does not
   * change what a single move needs, it changes what a convoy needs, and a
   * dispatcher pairing two permits under one pilot car has to know which half of
   * the rule applies.
   */
  escortRule(
    'la-escort-may-not-be-shared-by-two-wide-loads',
    'One escort may cover two overlength loads but only one overwidth load',
    { kind: 'gt', measure: 'widthIn', value: ftIn(12) },
    {
      advisory:
        'LAC 73:I.723: "An escort vehicle may escort two overlength vehicles or loads, but only one overwidth vehicle or load." — duplicated word for word in LAC 55:I.2309(F) and LAC 73:I.1901(D)(11). The escort count in this quote is for THIS load alone; a second overwidth load moving in convoy needs its own escort and cannot share this one.',
    },
  ),

  /**
   * OVER 18 FEET WIDE THE DISTRICT MAY SEND ITS OWN REPRESENTATIVE TO ESCORT
   * THE MOVE — an escort that is neither a pilot car nor a trooper, has no
   * published cost, and is chosen by the district rather than triggered by a
   * number. It moves the escort count, so it is manual review rather than an
   * advisory.
   */
  escortRule(
    'la-over-18-wide-district-approval',
    'Over 18 ft wide — the DOTD District Maintenance Engineer must approve the move, and may send a district representative to escort it',
    { kind: 'gt', measure: 'widthIn', value: ftIn(18) },
    {
      routeSurvey: true,
      manualReview:
        'LAC 73:I.309: "The DOTD District Maintenance Engineer must approve all movements over 18 feet wide, such as houses. This may be done by a letter which grants permission for the movement or by sending a representative from the district office to escort the movement. Either the letter or the representative must be present before the movement can proceed." The district chooses between the letter and the representative, so the escort count above may be one short and Louisiana publishes no cost for a district representative. This section was last amended in April 1994.',
    },
    LAC_309,
    '1994-04-01',
  ),
  escortRule(
    'la-over-16-5-high-district-notification',
    'Over 16 ft 5 in high — every DOTD district on the route must issue an authorization number BEFORE the permit is applied for',
    { kind: 'gt', measure: 'heightIn', value: ftIn(16, 5) },
    {
      advisory:
        'LAC 73:I.716: "All loads exceeding 16 feet 5 inches in height that are moving on state highways are required to notify the DOTD district office where the move originates. A district authorization number must be obtained from the district office, as well as all other subsequent district(s) that the load will travel through before application for an oversize/overweight permit is made." This is a gate on the APPLICATION, not a fee — the permit cannot be applied for until every district crossed has issued a number, which adds lead time a same-day quote does not show. Louisiana publishes no charge for it.',
    },
    LAC_716,
    '2025-06-20',
  ),
  escortRule(
    'la-over-18-high-district-procedures',
    'Over 18 ft high — the originating district sets the procedure before any permit is issued',
    { kind: 'gt', measure: 'heightIn', value: ftIn(18) },
    {
      routeSurvey: true,
      manualReview:
        'LAC 73:I.717: "Movers of houses, buildings, or loads that exceed 18 feet in height must contact the DOTD district office where the move originates for procedures to be followed before a permit will be issued by the truck permit office." The procedures are set case by case — utility line lifting and bucket-truck attendance are coordinated through the district on a route-specific basis — and neither the procedure nor its cost is published. This section was last amended in February 1996 and is thirty years old.',
    },
    LAC_717,
    '1996-02-01',
  ),

  /**
   * NO WEIGHT TRIGGERS AN ESCORT BY TABLE IN LOUISIANA, AND THAT IS A POSITIVE
   * FINDING RATHER THAN A GAP. LAC 73:I.1901(C)(13) puts the number of escorts
   * for an overweight move in DOTD's hands outright, so there is no threshold to
   * encode and no honest way to predict one.
   */
  escortRule(
    'la-weight-escort-by-determination',
    'Louisiana sets the escort count for an overweight move by determination, not by threshold',
    { kind: 'gt', measure: 'grossWeightLbs', value: 80000 },
    {
      advisory:
        'LAC 73:I.1901: "The number of escort vehicles needed for overweight escort loads and “critical off-road” equipment will be stipulated by the Department of Transportation and Development in their authorization to move the load, as well as any additional restrictions." Louisiana codifies NO numeric weight at which an escort becomes mandatory — the count comes back with the authorisation. So the escort count in this quote is driven by width and length alone, and DOTD may add to it for weight.',
    },
    LAC_1901,
    '2016-08-01',
  ),
  escortRule(
    'la-height-pole-recommended-not-required',
    'Louisiana recommends a clearance bar for an overheight load and does not require one',
    { kind: 'gt', measure: 'heightIn', value: ftIn(13, 6) },
    {
      advisory:
        'LAC 73:I.1901: "For all overheight loads it is strongly recommended that a clearance bar of some design be attached to the escort vehicle to warn of clearance problems of the load being escorted." STRONGLY RECOMMENDED, not required — so no height-pole service is counted in this quote, unlike Texas, Virginia, Oklahoma or Colorado, which each mandate one above a stated height. A carrier may still want one; Louisiana does not make it a condition of the permit.',
    },
    LAC_1901,
    '2016-08-01',
  ),

  /**
   * THE SCHEDULE-SELECTION INFERENCE, SAID OUT LOUD. See the file header: the
   * priced bands are schedule (c), and this rule states what a four-axle
   * combination would pay instead so the reader can see the size of the
   * assumption rather than take it on trust.
   */
  escortRule(
    'la-four-axle-schedule-b',
    'The overweight fee below is schedule (c) — a four-axle combination is priced from a different and dearer schedule',
    { kind: 'gt', measure: 'grossWeightLbs', value: 80000 },
    {
      advisory:
        'Louisiana prices an overweight single trip from one of three statutory schedules chosen by AXLE CONFIGURATION, and this quote uses schedule (c): "FIVE OR MORE AXLES INCLUDING STEERING AXLE WHERE GROSS WEIGHT EXCEEDS 80,000 POUNDS". That is the ordinary permitted heavy-haul rig and it is an INFERENCE, not something the load told us. A combination with exactly FOUR axles including the steering axle is priced from schedule (b) instead, which is dearer in the overlapping band — at 85,000 lb over 40 miles schedule (b) charges $67.50 where schedule (c) charges $45.00, and over 200 miles $262.50 against $150.00. A combination within legal gross weight but over an AXLE limit is priced from schedule (a), on excess weight rather than gross, and never reaches the calculation below at all because the engine only prices an overweight permit once the load is over Louisiana\'s 80,000 lb gross limit. Both other schedules are on file in full. NEITHER OF LOUISIANA\'S TWO TON-MILE FORMULAS CAN BE COMPUTED, and the gap is the same in both: schedule (a) charges "$15.00 permit fee plus $0.10 per ton-mile" above 60,000 lb of excess and R.S. 32:387(H)(2)(c)(iv) charges "$15.00 permit fee, plus $0.75 per ton-mile of weight in excess of 80,000 pounds" above 254,000 lb gross, and the statute is silent in both places on whether a fractional ton or a fractional mile rounds up, rounds down or bills pro rata. Neither formula is on the priced path here — the table above stops at 254,000 lb and schedule (a) is never reached — so the rounding is recorded as unknown rather than chosen.',
    },
    RS_387,
    RETRIEVED,
  ),

  /**
   * TWO WEIGHT CEILINGS BELOW THE SUPERLOAD LINE, AND BOTH ARE EASY TO MISS
   * BECAUSE THE FEE TABLE KEEPS GOING PAST THEM. R.S. 32:387 prices every band
   * up to 254,000 lb, so a 240,000 lb load looks like an ordinary priced permit
   * — but at 232,001 lb Louisiana restricts the route and starts charging
   * per-structure bridge evaluations, and at 238,001 lb it tells the carrier to
   * use the railway instead.
   */
  escortRule(
    'la-over-232000-approved-routes-and-structural-evaluation',
    'Over 232,000 lb — movement only on DOTD-approved routes, with per-structure bridge evaluations that are not in the total',
    { kind: 'gt', measure: 'grossWeightLbs', value: 232000 },
    {
      routeSurvey: true,
      manualReview:
        'R.S. 32:387(H)(2)(c)(iii): "Loads exceeding 232,001 pounds, but not greater than 254,000 pounds shall be allowed statewide movement on the Department of Transportation and Development selected and approved routes, the majority of which are interstate highways only; however, those portions of their route from the load’s origin to the National Highway System and that portion from the National Highway System to its destination shall be subject to the structural evaluation provided for in this Subparagraph." Two things follow that the banded fee above does not include. The route is not the carrier’s to choose. And the first and last legs draw a STRUCTURAL EVALUATION FEE PER STRUCTURE — $187.50 for treated timber, concrete slab and precast concrete slab bridges, $1,275.00 for truss, continuous-span and movable bridges and for all Mississippi River structures, and $750.00 for all other structures. The number and type of structures on an unassigned route cannot be known, so no evaluation cost is quoted. Louisiana’s permit office handles these as super-load permits ("Super Load Permits over 232,000lbs").',
    },
    RS_387,
    RETRIEVED,
  ),
  escortRule(
    'la-over-238000-rail-or-water',
    'Over 238,000 lb — Louisiana requires rail or water, and gives the highway only for the run to the nearest interchange',
    { kind: 'gt', measure: 'grossWeightLbs', value: 238000 },
    {
      manualReview:
        'LAC 73:I.711(A)(3): "Gross Vehicle Weight-238,000 pounds. Permit requests for gross vehicle weights exceeding 238,000 pounds require detailed information, and inquiries should be directed to the truck permit office well in advance of the movement. Since railroads and navigable waterways are adequate for the movement of loads in excess of 238,000 pounds, these facilities must be used instead of highways, except for the hauling necessary to move a load from its origin to the nearest railway or waterway and/or to move a load from the railway or waterway to its destination." This is not a surcharge — it is a refusal of the highway for the line-haul. A quote priced end to end over the road at this weight is quoting a movement Louisiana does not intend to permit, however complete the fee table looks. This section was last amended in February 1996.',
    },
    LAC_711,
    '1996-02-01',
  ),

  /**
   * THE FOURTH RECORDED CONFLICT, AND THE ONLY ONE THAT IS ABOUT A DIMENSION
   * RATHER THAN A FEE. It fires in exactly the four feet where the two readings
   * differ — a rear overhang between 4 ft and 8 ft is legal under the statute and
   * needs warning flags under the rule — and is silent above and below, where
   * both sources agree. See `LOUISIANA_REAR_OVERHANG_FLAG_THRESHOLD_IN` for the
   * conflict itself, held with both candidates and no adopted value.
   */
  escortRule(
    'la-rear-overhang-flag-threshold-conflict',
    'Rear overhang over 4 ft but not over 8 ft — legal under the statute, flagged under the administrative code',
    {
      kind: 'between',
      measure: 'rearOverhangIn',
      min: ftIn(4),
      max: ftIn(8),
      minInclusive: false,
    },
    {
      advisory:
        'Louisiana’s two sources put the rear-overhang line in different places and mean different things by it. R.S. 32:382(B)(1) allows a load to "project more than eight feet beyond the rear of the bed or body" before it is overlength — so at 6 ft this load needs no oversize permit for its overhang. LAC 73:I.309(E)(2) and LAC 73:I.723(U)(2) separately require warning flags on "vehicles and loads which exceed the legal length or which have a rear end overhang of more than 4 feet", unless the load clears the pavement by 6 ft or more. The researcher’s reading is that both stand — the statute sets the permit threshold and the rule sets the marking duty — and neither figure has been adopted here as THE rear-overhang limit. The legal limit recorded for this state is the statute’s 8 ft; red or orange fluorescent flags are still required past 4 ft and cost nothing to fit.',
    },
    LAC_309,
    '1994-04-01',
  ),

  escortRule(
    'la-oversize-fee-conflict',
    'The single-trip oversize fee is $8 in the administrative code and $10 in the statute, and neither has been adopted',
    { kind: 'gt', measure: 'widthIn', value: 102 },
    {
      advisory:
        'Louisiana publishes two different single-trip oversize fees and both are current. LAC 73:I.303(A): "The fee is $8 for a single trip if the trip lasts less than one day or $8 for a single day if the trip lasts more than one day." R.S. 32:387(H)(1)(a): "the fee for each overwidth, overheight, or overlength permit shall be ten dollars per trip or ten dollars per operating day for trips lasting more than one calendar day", which DOTD’s own permit office restates as "Oversize – $10 per day / per trip". The research’s resolution note argues that the statute, as the later legislative enactment, supersedes the older unamended administrative text — that reasoning is recorded, and it is NOT applied: both figures stay on file, no value is adopted, and the quote shows the $8–$10 spread. A LOAD THAT IS ALSO OVERWEIGHT PAYS NEITHER — R.S. 32:387(H)(3) folds the oversize permit into the overweight schedule at no extra charge — so this disagreement only reaches the price of an oversize-only move. The fee is also PER OPERATING DAY on a trip lasting more than one calendar day, and a quote does not know how many days the move will take.',
    },
    LAC_303,
    RETRIEVED,
  ),

  escortRule(
    'la-transaction-cost-not-published',
    'Louisiana publishes no card fee, no processing percentage and no wire-service markup',
    { kind: 'gt', measure: 'widthIn', value: 102 },
    {
      advisory:
        'No transaction fee is on file for Louisiana, and that is not the same as none being charged. LAC 73:I.701 says only that "All costs incidental to permits, such as, telephone charges, wire service charges, insurance, or escort fees must be borne by the applicant" — the state neither sets nor discloses what a third-party wire service adds, and no percentage surcharge or card fee appears anywhere in Title 73 or R.S. 32:387. A CANCELLED permit is the one charge Louisiana does publish: LAC 73:I.723 — "If a canceled permit was obtained on a DOTD permit charge account, then $5 of the charge will be retained", cancellable only before noon on the effective date or within two hours of purchase, and permits paid by check, money order, credit card or wire service are refunded nothing at all.',
    },
    LAC_701,
    RETRIEVED,
  ),

  escortRule(
    'la-escort-vehicle-registration',
    'An out-of-state escort company pays $10 a year to work in Louisiana, and needs a trip permit to run intrastate',
    { kind: 'gt', measure: 'widthIn', value: ftIn(12) },
    {
      advisory:
        'A private escort vehicle in Louisiana must carry a "Louisiana approved escort vehicle" permit, obtainable from any weights and standards police officer, and a company domiciled outside Louisiana pays $10 for it and must register annually with the secretary — LAC 73:I.1901: "The fee for each application for registration is $10. A 48-hour trip permit is required for intrastate movements, otherwise escorting is limited to interstate movement only." A Louisiana-domiciled escort driver must hold an appropriate Class "D" or "E" licence. None of these is a permit fee and none is in the total below; they reach a quote through the pilot-car operator’s own rate. LOUISIANA PUBLISHES NO ROUTE-SURVEY FEE either: LAC 73:I.303 puts the duty on the carrier — "Carriers, owners and drivers of any vehicle being operated are responsible for verifying in advance that the actual dimensions and weights of the vehicles and loads are acceptable for all routes being traveled" — and there is no state-administered survey to buy.',
    },
    LAC_1901,
    '2016-08-01',
  ),
];

// ── The overweight schedules ──────────────────────────────────────────────

/** The five distance columns every Louisiana overweight schedule is printed against. */
const DISTANCE_COLUMNS: Array<{ minMiles: number; maxMiles: number | null; label: string }> = [
  { minMiles: 0, maxMiles: 50, label: '0-50' },
  { minMiles: 51, maxMiles: 100, label: '51-100' },
  { minMiles: 101, maxMiles: 150, label: '101-150' },
  { minMiles: 151, maxMiles: 200, label: '151-200' },
  { minMiles: 201, maxMiles: null, label: 'OVER 200' },
];

/**
 * Schedule (c), transcribed cell for cell from R.S. 32:387(H)(2)(c)(i).
 *
 * THE COLUMNS ARE PRINTED AS WHOLE MILES AND THERE ARE GAPS BETWEEN THEM. The
 * statute writes "0-50", "51-100", "101-150" and so on, which assigns 50.4 miles
 * to no column at all. That is the Pennsylvania 14-foot hole in a different
 * dimension, and it is left as the statute leaves it: a fractional mileage
 * between two columns matches no band, the engine says the published schedule
 * does not price this move, and nothing is rounded into a column Louisiana did
 * not put it in.
 */
const SCHEDULE_C: Array<
  [number, number, number, number, number, number, number]
> = [
  // minLbs, maxLbs, then the five distance columns
  [80001, 100000, 45.0, 67.5, 97.5, 120.0, 150.0],
  [100001, 108000, 75.0, 142.5, 202.5, 270.0, 330.0],
  [108001, 120000, 105.0, 195.0, 285.0, 375.0, 465.0],
  [120001, 132000, 135.0, 255.0, 375.0, 495.0, 622.5],
  [132001, 152000, 180.0, 337.5, 502.5, 667.5, 832.5],
  [152001, 172000, 232.5, 442.5, 660.0, 877.5, 1095.0],
  [172001, 192000, 285.0, 547.5, 817.5, 1087.5, 1357.5],
  [192001, 212000, 337.5, 652.5, 975.0, 1297.5, 1620.0],
  [212001, 232000, 390.0, 757.5, 1132.5, 1507.5, 1875.0],
  [232001, 254000, 442.5, 862.5, 1290.0, 1717.5, 2130.0],
];

const overweightBands: Sourced<WeightBand>[] = SCHEDULE_C.flatMap(
  ([minLbs, maxLbs, ...fees]) =>
    DISTANCE_COLUMNS.map((column, i) =>
      fromRetrieval<WeightBand>(
        {
          minLbs,
          maxLbs,
          feeUsd: fees[i] as number,
          minMiles: column.minMiles,
          maxMiles: column.maxMiles,
        },
        RS_387,
        `R.S. 32:387(H)(2)(c)(i), "FIVE OR MORE AXLES INCLUDING STEERING AXLE WHERE GROSS WEIGHT EXCEEDS 80,000 POUNDS" — the ${minLbs.toLocaleString()}–${maxLbs.toLocaleString()} lb row against the ${column.label} mile column.`,
      ),
    ),
);

/**
 * Schedule (a) — kept in full and NOT priced. It is banded on EXCESS weight over
 * the legal limit rather than gross weight, and it covers the case this engine
 * never reaches: a combination inside the 80,000 lb gross limit that is over an
 * axle limit. Recording it as `overweightBands` would have collided with
 * schedule (c) on the same gross weights and meant nothing, since the two count
 * different pounds.
 */
export const LOUISIANA_OVERWEIGHT_SCHEDULE_A: Array<{
  minExcessLbs: number;
  maxExcessLbs: number | null;
  feesByDistanceUsd: number[] | null;
  note: string;
}> = [
  { minExcessLbs: 0, maxExcessLbs: 10000, feesByDistanceUsd: [30.0, 45.0, 52.5, 67.5, 82.5], note: '' },
  { minExcessLbs: 10001, maxExcessLbs: 20000, feesByDistanceUsd: [52.5, 97.5, 135.0, 172.5, 210.0], note: '' },
  { minExcessLbs: 20001, maxExcessLbs: 30000, feesByDistanceUsd: [82.5, 150.0, 210.0, 277.5, 345.0], note: '' },
  { minExcessLbs: 30001, maxExcessLbs: 40000, feesByDistanceUsd: [105.0, 202.5, 292.5, 382.5, 472.5], note: '' },
  { minExcessLbs: 40001, maxExcessLbs: 50000, feesByDistanceUsd: [135.0, 255.0, 367.5, 487.5, 607.5], note: '' },
  { minExcessLbs: 50001, maxExcessLbs: 60000, feesByDistanceUsd: [157.5, 307.5, 450.0, 592.5, 735.0], note: '' },
  {
    minExcessLbs: 60001,
    maxExcessLbs: null,
    feesByDistanceUsd: null,
    note: '"Over 60,000--$15.00 permit fee plus $0.10 per ton-mile will be charged" — and the statute never says whether a part ton or a part mile is charged in full, so the formula is recorded rather than computed.',
  },
];

/**
 * Schedule (b) — four axles including the steering axle. Kept for the same
 * reason as schedule (a): it overlaps schedule (c) between 80,001 and 90,000 lb
 * on a DIFFERENT axle count, so holding both as priced bands would have produced
 * a fake conflict between two rows that never apply to the same vehicle.
 */
export const LOUISIANA_OVERWEIGHT_SCHEDULE_B: Array<{
  minGrossLbs: number;
  maxGrossLbs: number;
  feesByDistanceUsd: number[];
}> = [
  { minGrossLbs: 66001, maxGrossLbs: 80000, feesByDistanceUsd: [30.0, 52.5, 67.5, 90.0, 105.0] },
  { minGrossLbs: 80001, maxGrossLbs: 90000, feesByDistanceUsd: [67.5, 112.5, 165.0, 217.5, 262.5] },
];

/**
 * The per-structure bridge review fees for a load over 254,000 lb. THREE
 * AMOUNTS AND NO COUNT is not a number, which is why `routeAnalysisFeeUsd` is
 * empty rather than carrying one of them.
 */
export const LOUISIANA_STRUCTURAL_EVALUATION_FEES: Array<{
  feeUsd: number;
  structures: string;
}> = [
  { feeUsd: 187.5, structures: 'treated timber, concrete slab, and precast concrete slab bridge' },
  {
    feeUsd: 1275.0,
    structures: 'truss, continuous span, and movable bridges and for all Mississippi River structures',
  },
  { feeUsd: 750.0, structures: 'all other structures' },
];

// ── The conflicts that live outside the priced lines ──────────────────────
/**
 * Three of Louisiana's four conflicts are about things a single-trip quote does
 * not price — an annual ocean-container permit, a 30-day pleasure-craft permit,
 * and a marking threshold — so they cannot surface as a null fee. They are held
 * by the CONFLICT MECHANISM anyway: both candidates on file with provenance, no
 * value adopted, `resolveSourced` returning null and forcing review, and a
 * spread the quote can show. A conflict settled in a comment is a conflict that
 * comes back.
 */

/**
 * Class II ocean container. THE ONE ROW WHERE THE DATES CARRY THE ARGUMENT: the
 * statutory candidate starts on 2020-01-01, the effective date of Acts 2019
 * No. 301, so a quote priced as-of 2019 correctly sees only the administrative
 * $500 figure. The administrative row is NOT closed on 2019-12-31 — the LAC
 * still prints $500 today — so both are in effect now and the conflict stands.
 */
export const LOUISIANA_CLASS_II_OCEAN_CONTAINER_FEE_USD: Sourced<number>[] = [
  fromRetrieval(
    500,
    LAC_723,
    'LAC 73:I.723(A)(2) lists "Class II ($500 per year)" — an ANNUAL fee, still published.',
  ),
  fromDated(
    375,
    RS_387,
    '2020-01-01',
    'R.S. 32:387(J)(2)(a), as amended by Acts 2019 No. 301 effective January 1 2020: "The biannual fee for the permit shall be three hundred seventy-five dollars per vehicle." The amendment moved the permit from an annual $500 to a six-month $375, so the two figures differ in TERM as well as amount and cannot be compared per-year without choosing a reading. The research’s note that the 2019 act supersedes the LAC text is recorded here and has not been applied.',
  ),
];

/** Pleasure craft, 30 days. $5 in the rule, $10 in the statute, both current. */
export const LOUISIANA_PLEASURE_CRAFT_FEE_USD: Sourced<number>[] = [
  fromRetrieval(5, LAC_723, 'LAC 73:I.723(J): "Pleasure Craft ($5 Fee for 30 Days)".'),
  fromRetrieval(
    10,
    RS_387,
    'R.S. 32:387(C)(5): "The secretary shall collect a fee of ten dollars for each permit issued." The research reads the statute as superseding the older administrative text; that reasoning is recorded and has not been applied.',
  ),
];

/**
 * Rear overhang, and the two sources are measuring different duties — 8 ft
 * before the load is overlength, 4 ft before it must carry warning flags. Held
 * as a conflict because the research recorded it as one; the legal limit used by
 * the engine is the statute's 8 ft, and `la-rear-overhang-flag-threshold-conflict`
 * says so in the four feet between them.
 */
export const LOUISIANA_REAR_OVERHANG_FLAG_THRESHOLD_IN: Sourced<number>[] = [
  fromRetrieval(
    ftIn(8),
    RS_382,
    'R.S. 32:382(B)(1): "the load upon any single vehicle or upon the rear vehicle of a combination of vehicles shall not project more than eight feet beyond the rear of the bed or body of said vehicle" — the point at which an oversize permit is needed.',
  ),
  fromRetrieval(
    ftIn(4),
    LAC_309,
    'LAC 73:I.309(E)(2) and LAC 73:I.723(U)(2) require warning flags on "vehicles and loads which exceed the legal length or which have a rear end overhang of more than 4 feet" — a marking duty that bites four feet earlier.',
  ),
];

// ── The jurisdiction ──────────────────────────────────────────────────────

export const LOUISIANA_OSOW_RULES: JurisdictionOsowRules = {
  code: 'LA',
  name: 'Louisiana',
  country: 'US',

  legalLimits: {
    widthIn: [
      fromRetrieval(
        102,
        RS_380,
        'R.S. 32:380(A): "The width of any vehicle shall not exceed one hundred two inches, exclusive of safety devices." INCLUSIVE — exactly 102 in is legal. A farm tractor is allowed 9 ft under subsection C and a load may project 12 in beyond the body under subsection B; neither is a commodity a quote identifies.',
      ),
    ],
    /**
     * 13 FT 6 IN, NOT 14 FT, AND THE CHOICE IS THE CONSERVATIVE ONE. R.S.
     * 32:381(A)(1) allows 14 ft only to a vehicle "which operates EXCLUSIVELY on
     * the interstate highway system", with one road mile of access for food,
     * fuel, repairs and rest. A quote knows two endpoints, not whether the whole
     * move stays on the interstate, and recording 14 ft would let a 13 ft 9 in
     * load through as legal on a lane that leaves it. Recording both figures
     * would be worse still: they are not a disagreement, they are two scopes,
     * and resolving them to null would disable the height check entirely.
     */
    heightIn: [
      fromRetrieval(
        ftIn(13, 6),
        RS_381,
        'R.S. 32:381(A)(1): "The height of any vehicle and its load shall not exceed thirteen feet, six inches, except that the height of any vehicle and its load which operates exclusively on the interstate highway system shall not exceed fourteen feet, provided that vehicles operating on the interstate highway system shall have reasonable access, within one road mile from the interstate highway to terminals and facilities for food, fuel, repairs, and rest". INCLUSIVE. The 14 ft interstate figure is not used here because a quote cannot establish that a move is exclusively on the interstate system, and a load between 13 ft 6 in and 14 ft that leaves it needs a permit.',
      ),
    ],
    trailerLengthIn: [
      fromRetrieval(
        ftIn(59, 6),
        RS_382,
        'R.S. 32:382(A)(1): "The length of the semitrailer portion of a tractor-semitrailer combination shall not exceed fifty-nine feet and six inches." INCLUSIVE, and one of the most generous semitrailer allowances in this directory. A single vehicle is capped separately at 45 ft, a trailing unit on a single vehicle at 30 ft, and each unit of a doubles or triples combination at 30 ft; none of those is the configuration priced here.',
      ),
    ],
    /**
     * `overallLengthIn` is ABSENT. R.S. 32:382 caps the SINGLE VEHICLE at 45 ft
     * and the SEMITRAILER at 59 ft 6 in, and states no overall length for a
     * tractor-semitrailer combination at all — which is what 23 CFR 658.13
     * preempts on the National Network. An empty array would claim we looked for
     * Louisiana's overall cap and found nothing; absent says correctly that
     * Louisiana does not impose one in the sources on file, and the length
     * escort rules at 90 ft and 125 ft still fire.
     */
    frontOverhangIn: [
      fromRetrieval(
        ftIn(4),
        RS_382,
        'R.S. 32:382(B)(1): "the load upon any single vehicle or upon the front vehicle of a combination of vehicles shall not project more than four feet beyond the foremost part of said vehicle". EXCLUSIVE — exactly 4 ft is legal. §32:382(B)(2) exempts permanently attached equipment with 6 ft or more of ground clearance.',
      ),
    ],
    rearOverhangIn: [
      fromRetrieval(
        ftIn(8),
        RS_382,
        'R.S. 32:382(B)(1): "the load upon any single vehicle or upon the rear vehicle of a combination of vehicles shall not project more than eight feet beyond the rear of the bed or body of said vehicle". EXCLUSIVE. Warning flags are separately required past 4 ft — see `la-rear-overhang-flag-threshold-conflict`. Poles and piling may run 15 ft past the rear and forest products in their natural state 20 ft, both commodity allowances a quote does not identify.',
      ),
    ],
    grossWeightLbs: [
      fromRetrieval(
        80000,
        RS_386,
        'R.S. 32:386(A): "The total gross weight of any vehicle or combination of vehicles shall not exceed eighty thousand pounds, and no vehicle or combination of vehicles shall exceed its licensed gross weight." INCLUSIVE — and note the second clause, which caps a vehicle at its LICENSED gross weight independently of the statutory one, a limit a quote cannot see. A combination with a tridum or quadrum axle may run to 88,000 lb off the interstate system and 83,400 lb on it under subsection I; those are configuration allowances, not a general limit, and are not applied here.',
      ),
    ],
    singleAxleLbs: [
      fromRetrieval(
        20000,
        RS_386,
        'R.S. 32:386(C): "The total gross weight of any single axle attached to any vehicle and equipped with low pressure pneumatic tires shall not exceed twenty thousand pounds." INCLUSIVE. Subsection F sets 18,000 lb for high-pressure, solid rubber or cushion tires, which modern highway equipment does not use. Subsection B adds a separate 650 lb per inch of tyre width limit, and subsection K allows a 2,000 lb single-axle and 3,000 lb tandem/tridum/quadrum enforcement tolerance OFF the interstate system without permitting any increase in gross weight.',
      ),
    ],
    tandemAxleLbs: [
      fromRetrieval(
        34000,
        RS_386,
        'R.S. 32:386(D): "The total gross weight of any tandem axle or tandem steering axle attached to any vehicle and equipped with low pressure pneumatic tires shall not exceed thirty-four thousand pounds. However on any vehicle carrying forest products in their natural state, the weight limitation shall be thirty-seven thousand pounds per tandem axle ... except on the Interstate system." INCLUSIVE. The tridum limit is 42,000 lb and the quadrum limit 50,000 lb under subsection E; `LegalLimits` has no field for either and a quote does not carry per-axle-group weights.',
      ),
    ],
  },

  /**
   * A SOURCED ZERO, WHICH IS A CLAIM AND NOT A GAP. Louisiana charges nothing on
   * top of its oversize fee and nothing on top of its overweight schedule —
   * there is no processing charge, no issuance fee and no base permit fee
   * separate from the two schedules. The $8/$10 oversize charge itself lives in
   * `oversizeFeeBands`, because R.S. 32:387(H)(3) makes it disappear entirely
   * when the load is also overweight, and a base fee would have survived that
   * and over-billed every combined permit the state issues. The engine
   * suppresses this empty line rather than printing "$0.00" beside a real fee.
   */
  permitBaseFeeUsd: [
    fromRetrieval(
      0,
      RS_387,
      'Louisiana states no permit fee outside the oversize and overweight schedules themselves. The $10 oversize fee is carried as a fee band because R.S. 32:387(H)(3) waives it for a load that is also overweight.',
    ),
  ],

  /**
   * ONE BAND WITH NO DIMENSIONAL BOUNDS, TWICE — AND THAT IS THE CONFLICT. The
   * fee does not step by width, height or length in Louisiana; it is one flat
   * amount for any oversize load, and the two sources disagree about what that
   * amount is. Two rows from two different documents is what the resolver reads
   * as a conflict, and the band-overlap invariant groups by source id, so a
   * single band per source is exactly right.
   */
  oversizeFeeBands: [
    fromRetrieval<OversizeFeeBand>(
      { label: 'oversize single trip (statute: $10 per trip or per operating day)', feeUsd: 10 },
      RS_387,
      'R.S. 32:387(H)(1)(a): "the fee for each overwidth, overheight, or overlength permit shall be ten dollars per trip or ten dollars per operating day for trips lasting more than one calendar day provided such vehicle or combination of vehicles is not also overweight". DOTD restates it as "Oversize – $10 per day / per trip". A mobile home or mobile office pays a flat $10 per permit for a consecutive 72-hour period under subparagraph (b) instead, which is the same amount and a different term.',
    ),
    fromRetrieval<OversizeFeeBand>(
      { label: 'oversize single trip (administrative code: $8 per trip or per day)', feeUsd: 8 },
      LAC_303,
      'LAC 73:I.303(A): "The fee is $8 for a single trip if the trip lasts less than one day or $8 for a single day if the trip lasts more than one day." Current through Register Vol. 51, No. 06 (June 20 2025) and still published. See `la-oversize-fee-conflict`.',
    ),
  ],

  /**
   * THE OVERSIZE FEE IS NOT ADDED TO THE OVERWEIGHT ONE — IT IS ABSORBED, AND
   * THE STATUTE SAYS SO IN A SENTENCE. Billing both would over-quote every
   * combined Louisiana permit by $8 to $10 and would also drag the unresolved
   * oversize conflict onto a load that never owed the fee.
   */
  combinedFeeRule: [
    fromRetrieval<CombinedFeeRule>(
      {
        kind: 'overweightOnly',
        explanation:
          'R.S. 32:387(H)(3): "A permit granted under the provisions of Paragraph (2) of this Subsection shall include the operation of vehicles or combination of vehicles having both dimensions and weights in excess of the limits imposed in Subpart A of this Part, without the payment of any fee other than that imposed in the schedules above set forth in Paragraph (2) of this Subsection." DOTD says the same on its single-trip page: "Oversize dimensions are also covered at no additional charge, provided they are specified on the permit." The dimensions must still be stated on the permit to be covered.',
      },
      RS_387,
    ),
  ],

  overweightPricing: [
    fromRetrieval<OverweightPricing>(
      {
        kind: 'bands',
        explanation:
          'R.S. 32:387(H)(2)(c) prints a flat fee per cell of a table with ten gross-weight rows and five distance columns. It is neither a pure weight step nor a per-mile rate: the amount is banded on BOTH, so 120,000 lb over 40 miles is $135.00 and the same load over 210 miles is $622.50.',
      },
      RS_387,
    ),
  ],

  overweightBands,

  /** Louisiana's schedule is a table of flat cells, not a rate per mile. */
  overweightPerMile: [],

  conditionalFees: [],

  /**
   * EMPTY, NOT ZERO. Louisiana publishes no card surcharge, no percentage and no
   * processing fee, and LAC 73:I.701 pushes wire-service charges onto the
   * applicant without saying what they are. A sourced zero would assert
   * something the evidence does not support, so the engine states on every
   * Louisiana quote that no transaction cost is on file. See
   * `la-transaction-cost-not-published`.
   */
  transactionFee: [],

  /**
   * EMPTY, AND THE REASON IS ARITHMETIC RATHER THAN ABSENCE. Louisiana DOES
   * publish structural-evaluation fees for a load over 254,000 lb — $187.50,
   * $750.00 and $1,275.00 — but they are charged PER STRUCTURE by structure
   * type, and the number and type of structures on a route DOTD has not yet
   * approved cannot be known. Three amounts and no count is not a number. The
   * schedule is on file in `LOUISIANA_STRUCTURAL_EVALUATION_FEES`.
   */
  routeAnalysisFeeUsd: [],
  noBridgeRouteFeeUsd: [],

  superload: {
    /**
     * 254,000 lb, EXCLUSIVE — the top of the printed table. Above it R.S.
     * 32:387(H)(2)(c)(iv) stops publishing a fee and starts publishing a formula:
     * "$15.00 permit fee, plus $0.75 per ton-mile of weight in excess of 80,000
     * pounds, plus a fee for structural evaluation", and the statute never says
     * how a part ton or a part mile is billed. Two lower ceilings bite before
     * this one — DOTD treats anything over 232,000 lb as a super-load and
     * restricts the route, and LAC 73:I.711 sends anything over 238,000 lb to
     * rail or water — and both are carried by escort rules so a load in the
     * 232,001–254,000 lb band is still priced from the table AND told what it
     * is walking into.
     */
    grossWeight: [
      fromRetrieval<Threshold>(
        { value: 254000, inclusive: false },
        RS_387,
        'The printed schedule’s top row is "232,001-254,000". R.S. 32:387(H)(2)(c)(iv): "OVER 254,000 -- $15.00 permit fee, plus $0.75 per ton-mile of weight in excess of 80,000 pounds, plus a fee for structural evaluation based on the following schedule". A ton-mile formula whose rounding convention is unpublished, plus a per-structure fee with no structure count, is not a quotable total.',
      ),
    ],
    /** Louisiana states no axle-spacing superload trigger. */
    shortSpacing: [],
  },

  /**
   * TWO TRIGGERS, BOTH AT 18 FEET, AND NEITHER IS A CONVENTIONAL SURVEY.
   * Louisiana does not send an inspector to walk the route; it sends the move to
   * the DISTRICT — the maintenance engineer must approve anything over 18 ft
   * wide, and the originating district sets the procedure for anything over 18 ft
   * high. Both are pre-conditions on issuance with no published cost, which is
   * exactly what this field is for. `lengthIn` is EMPTY because Louisiana
   * publishes no length trigger of this kind; an empty list here is silent, as it
   * is for Virginia.
   */
  routeInspection: {
    widthIn: [
      fromDated<Threshold>(
        { value: ftIn(18), inclusive: false },
        LAC_309,
        '1994-04-01',
        'LAC 73:I.309: "The DOTD District Maintenance Engineer must approve all movements over 18 feet wide, such as houses."',
      ),
    ],
    heightIn: [
      fromDated<Threshold>(
        { value: ftIn(18), inclusive: false },
        LAC_717,
        '1996-02-01',
        'LAC 73:I.717: "Movers of houses, buildings, or loads that exceed 18 feet in height must contact the DOTD district office where the move originates for procedures to be followed before a permit will be issued by the truck permit office."',
      ),
    ],
    lengthIn: [],
  },

  escortRules: LOUISIANA_ESCORT_RULES,

  /**
   * TRUE, AND MORE SHARPLY THAN FOR A PER-MILE STATE. Louisiana's fee does not
   * scale with mileage, it STEPS with it — 120,000 lb is $135.00 up to 50 miles
   * and $622.50 past 200 — so a quote without Louisiana miles cannot pick a
   * column at all, and `weightBandApplies` leaves the band undecided rather than
   * quietly billing the cheapest one.
   */
  feesDependOnDistance: true,
};

/** Cited for the mobile-home and single-trip permit validity periods. */
export const LOUISIANA_PERMIT_VALIDITY_SOURCE = DOTD_SINGLE_TRIP;

/** Cited for the state police vehicle-use fee scale, which is separate from the officer's hourly rate. */
export const LOUISIANA_POLICE_VEHICLE_FEE_SOURCE = LAC_55_1101;

/** Cited for the off-duty trooper hourly rate and its two-hour minimum. */
export const LOUISIANA_POLICE_ESCORT_RATE_SOURCE = LSP_1107;
