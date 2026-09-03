/**
 * OKLAHOMA — oversize/overweight single-trip permit rules.
 *
 * `types.ts` has opened since Phase 1 with the line "Adding Oklahoma should mean
 * writing an `OK_RULES` object and nothing else — no new branches in the engine,
 * no new condition kinds, no `if (state === 'OK')`." This is that object, and it
 * held: Oklahoma needed one new `RouteClass` member and not a line of engine
 * code.
 *
 * THE ONE NEW MEMBER, AND WHY IT IS PREFIXED
 * ------------------------------------------
 * `ok-super-two-lane`. "Super two-lane highway" is Oklahoma's own term in OAC
 * 730:50-5-18 and not a general road type, and it is not decorative: the
 * length-escort rules split on it. "A truck-tractor/semi-trailer combination
 * which is more than eighty (80) feet in overall length is required to be
 * accompanied by one front escort ON TWO-LANE HIGHWAYS", while "A combination
 * other than a truck-tractor/semi-trailer which is more than eighty (80) feet in
 * overall length is required to be accompanied by one front escort ON TWO-LANE
 * HIGHWAYS OR SUPER TWO-LANE HIGHWAYS." One pilot car turns on the combination
 * type on that class of road, and a quote does not collect the combination type
 * — so the ambiguity is surfaced rather than resolved.
 *
 * THE FEE, WHICH IS THE CLEANEST ARITHMETIC IN THIS DIRECTORY
 * ----------------------------------------------------------
 * $40 for an oversize permit. $40 plus $10 for every 1,000 lb over the legal
 * load limit for an overweight one. $80 plus the same excess charge when the
 * load is both — because OAC 730:50-5 says "the permit fees shall apply as
 * though both permits had been issued separately", so the $80 is literally two
 * $40 permits. Then $2.00 if the permit is faxed or emailed, and 4% of the total
 * credit-card charge. The engine reproduces the whole chain exactly, including
 * the order of operations: $40 + $40 + $20 = $100, plus $2 = $102, plus 4% =
 * $106.08.
 *
 * TWO THINGS THAT MAKE AN OKLAHOMA NUMBER SOFTER THAN IT LOOKS
 * -----------------------------------------------------------
 * 1. THE LEGAL LOAD LIMIT — the base the excess charge counts from — IS ROUTE
 *    DEPENDENT. ODOT requires an overweight permit "exceeding 80,000 pounds ...
 *    on the Dwight D. Eisenhower National System of Interstate and Defense
 *    Highways" and "exceeding 90,000 pounds ... on any other portion of the
 *    State Highway System". Ten thousand pounds of base is a hundred dollars of
 *    fee, and a load between the two figures needs a permit on one network and
 *    not on the other. 80,000 lb is used here and every Oklahoma overweight
 *    quote says so.
 * 2. THE PARTIAL INCREMENT IS UNDEFINED. Neither the fee sheet nor 47 O.S.
 *    §14-116 says what happens to the last part of a 1,000 lb step. The bands
 *    below charge it in full; that is our reading, not Oklahoma's.
 *
 * NO NUMERIC SUPERLOAD WEIGHT EXISTS. OAC 730:50-5 defines a superload as "any
 * overweight permit load that exceeds the Standard Drawing OL-1 trucks" — a
 * configuration test against a drawing, not a pound figure. `superload.grossWeight`
 * is therefore ABSENT, which is a positive finding and which correctly keeps
 * Oklahoma out of the widget's weight-ceiling mirror.
 *
 * DATE WARNING: the ODOT permit-fee PDF, the size-and-weight FAQ page and the
 * large-project worksheet all carry no revision date whatsoever, so their rows
 * are effective only from our retrieval date. The statutes are from 2022, 2023
 * and 2026.
 */
import type { SourceDoc, Sourced } from '../provenance.js';
import { ftIn, type EscortRule, type RouteClass } from '../escortRules.js';
import type {
  JurisdictionOsowRules,
  OversizeFeeBand,
  OverweightPricing,
  TransactionFee,
  WeightBand,
} from '../types.js';

const RETRIEVED = '2026-09-01';

// ── Source documents ──────────────────────────────────────────────────────

/**
 * Title 47 is served as one enormous PDF, so each section is recorded as its own
 * document with its own revision date and pinpoint cite. Same URL, different
 * claims, different dates — which is exactly what `cite` is for.
 */
const OS47_14_103: SourceDoc = {
  id: 'ok-47-os-14-103',
  title: '47 O.S. §14-103 — Width, height and length limits',
  url: 'https://www.oklegislature.gov/OK_Statutes/CompleteTitles/os47.pdf',
  publisher: 'Oklahoma Legislature',
  revisedOn: '2022-07-01',
  retrievedOn: RETRIEVED,
  cite: 'width 102 in; height 13 1/2 ft on a county road and 14 ft on a turnpike, interstate, U.S. or state highway; single truck 45 ft; semitrailer 53 ft on and off the National Network; other combinations 70 ft',
};

const OS47_14_109: SourceDoc = {
  id: 'ok-47-os-14-109',
  title: '47 O.S. §14-109 — Axle and gross weight limits',
  url: 'https://www.oklegislature.gov/OK_Statutes/CompleteTitles/os47.pdf',
  publisher: 'Oklahoma Legislature',
  revisedOn: '2022-07-01',
  retrievedOn: RETRIEVED,
  cite: '"No single axle weight shall exceed twenty thousand (20,000) pounds;"; "In no event shall the maximum load in pounds carried by any set of tandem axles exceed thirty-four thousand (34,000) pounds."; gross weight per the Federal Bridge formula imposed by 23 U.S.C. §127',
};

const OS47_14_116: SourceDoc = {
  id: 'ok-47-os-14-116',
  title: '47 O.S. §14-116 — Permit fees',
  url: 'https://www.oklegislature.gov/OK_Statutes/CompleteTitles/os47.pdf',
  publisher: 'Oklahoma Legislature',
  revisedOn: '2026-07-01',
  retrievedOn: RETRIEVED,
  cite: '"a minimum permit fee of Forty Dollars ($40.00) for any permit issued"; "a fee of Ten Dollars ($10.00) for each thousand pounds in excess of the legal load limit"',
};

const OS47_14_118: SourceDoc = {
  id: 'ok-47-os-14-118',
  title: '47 O.S. §14-118 — Electronic delivery fee',
  url: 'https://www.oklegislature.gov/OK_Statutes/CompleteTitles/os47.pdf',
  publisher: 'Oklahoma Legislature',
  revisedOn: '2022-07-01',
  retrievedOn: RETRIEVED,
  cite: '"a fee of Two Dollars ($2.00) for each permit requested to be issued by facsimile machine or by any other means of electronic transmission ... shall be in addition to any other fee or fees assessed for the permit."',
};

const OS47_14_120: SourceDoc = {
  id: 'ok-47-os-14-120',
  title: '47 O.S. §14-120 — Special movement permit',
  url: 'https://www.oklegislature.gov/OK_Statutes/CompleteTitles/os47.pdf',
  publisher: 'Oklahoma Legislature',
  revisedOn: '2022-07-01',
  retrievedOn: RETRIEVED,
  cite: '"a special movement permit shall be issued for a fee of Five Hundred Dollars ($500.00) ... shall be in addition to the permit and fees required by Section 14-116 of this title."',
};

const OS47_ESCORT_STATUTE: SourceDoc = {
  id: 'ok-47-os-escort-and-ohp',
  title: '47 O.S. §§14-120.1, 1120 — Escort certification and OHP escort cost recovery',
  url: 'https://www.oklegislature.gov/OK_Statutes/CompleteTitles/os47.pdf',
  publisher: 'Oklahoma Legislature',
  revisedOn: '2023-11-01',
  retrievedOn: RETRIEVED,
  cite: '"shall pay to the Department of Public Safety a fee covering the full cost to administer, plan, and carry out the escort within this state."; "The Department of Public Safety shall adopt a schedule of fees necessary to implement this section."',
};

const OAC_730_50_5: SourceDoc = {
  id: 'ok-oac-730-50-5',
  title: 'OAC 730:50-5 — ODOT size and weight permit rules (Size and Weight Permit Load, PDF)',
  url: 'https://oklahoma.gov/content/dam/ok/en/odot/about-us/laws-rules/size-and-weight-permits/Size%20and%20Weight%20Permit%20Load.pdf',
  publisher: 'Oklahoma Department of Transportation',
  revisedOn: '2023-09-11',
  retrievedOn: RETRIEVED,
  cite: 'permit thresholds of 80,000 lb on the Interstate and 90,000 lb elsewhere on the State Highway System; escort triggers by width, height and length; "A superload is defined as any overweight permit load that exceeds the Standard Drawing OL-1 trucks"; escort operator certification',
};

const ODOT_FEES: SourceDoc = {
  id: 'odot-permit-fees-pdf',
  title: 'ODOT — Permit Fees (PDF, undated)',
  url: 'https://oklahoma.gov/content/dam/ok/en/odot/about-us/laws-rules/size-and-weight-permits/permit-fees.pdf',
  publisher: 'Oklahoma Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'Single trip/monthly Oversize $40.00, Overweight $40.00 plus $10 per 1,000 lb over the legal load limit, Oversize & Overweight $80.00; Additional Fees "Fax/ETF ... $2.00" and "Credit Card Convenience Fee (% of total credit card charges) 4%"',
};

const ODOT_FAQ: SourceDoc = {
  id: 'odot-size-weight-faq',
  title: 'ODOT — Size and Weight Permits FAQ (undated)',
  url: 'https://oklahoma.gov/odot/about-us/laws-and-rules/size-and-weight-permits.html',
  publisher: 'Oklahoma Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: '"Anything over 13-6 high, 8-6 wide and length varies with type of vehicle."',
};

const OHP_CONTRACT_APP: SourceDoc = {
  id: 'ok-ohp-escort-contract-application',
  title: 'Oklahoma Highway Patrol — Escort contract application (PDF)',
  url: 'https://oklahoma.gov/content/dam/ok/en/odot/about-us/laws-rules/size-and-weight-permits/OHP%20Escort%20Contract%20App%202.2.24%20-%20revised.pdf',
  publisher: 'Oklahoma Department of Public Safety',
  // The form's own file name carries "2.2.24" and the source dataset records the
  // revision only as a month. It states no day of its own, so no day is asserted.
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: '"a contract for Oklahoma Highway Patrol escort service of oversize loads in excess of 20 feet."; "In most instances a contract should be in place within 5-7 working days."',
};

const DPS_TROOP_S: SourceDoc = {
  id: 'ok-dps-troop-s-size-weight',
  title: 'Oklahoma DPS Troop S — Size and weight escorts',
  url: 'https://oklahoma.gov/dps/programs-services/troop-s/programs-services/size-weight.html',
  publisher: 'Oklahoma Department of Public Safety',
  revisedOn: '2026-04-10',
  retrievedOn: RETRIEVED,
  cite: '"We will assist with these loads once it is determined the load meets certain height, width, length, weight requirements, or a combination of any of these four."',
};

const ODOT_WORKSHEET: SourceDoc = {
  id: 'odot-large-project-worksheet',
  title: 'ODOT — Large Project Preparation Worksheet (PDF, undated)',
  url: 'https://oklahoma.gov/content/dam/ok/en/odot/about-us/laws-rules/size-and-weight-permits/lppw.pdf',
  publisher: 'Oklahoma Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: '"Are you wanting ODOT to provide suggested routes based on Load dimensions and/or weight prior to issuing the permits so, the route can then be ran for Survey purposes by you the customer?"',
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

function fromUndated<T>(value: T, source: SourceDoc, note?: string): Sourced<T> {
  return {
    value,
    source,
    effectiveFrom: RETRIEVED,
    effectiveTo: null,
    ...(note === undefined ? {} : { note }),
  };
}

const EFF_RULE = '2023-09-11';
const EFF_STATUTE_2022 = '2022-07-01';

const TWO_LANE: RouteClass[] = ['two-lane'];
const SUPER_TWO_LANE: RouteClass[] = ['ok-super-two-lane'];
const TWO_LANE_OR_SUPER: RouteClass[] = ['two-lane', 'ok-super-two-lane'];
const MULTI_LANE: RouteClass[] = ['divided', 'interstate', 'multilane-undivided'];

/**
 * "This load needs an Oklahoma permit of some kind." The $2.00 delivery fee, the
 * unpublished multi-lane length and overhang triggers and the OHP escort gap
 * apply to every permit rather than to a dimension, and keying them on width
 * alone would hide them from an overweight legal-size move — which is most of
 * heavy haul. Keying them here keeps them off a fully legal load.
 */
const PERMIT_LIKELY: EscortRule['when'] = {
  kind: 'any',
  of: [
    { kind: 'gt', measure: 'widthIn', value: 102 },
    { kind: 'gt', measure: 'heightIn', value: ftIn(14) },
    { kind: 'gt', measure: 'grossWeightLbs', value: 80000 },
  ],
};

// ── The overweight excess charge ──────────────────────────────────────────

const LEGAL_LOAD_LIMIT = 80000;
const PERMIT_BASE_USD = 40;
const PER_1000_LB_USD = 10;
/**
 * Enumerated to 200,000 lb. Oklahoma publishes no numeric superload weight, so
 * there is no natural ceiling in the source and one had to be chosen: above this
 * the engine reports that no band on file covers the weight and sends the move
 * to review, which is the correct answer for a load that is certainly past
 * Standard Drawing OL-1 and will be priced after ODOT's structural analysis
 * anyway.
 */
const TOP_BAND_LBS = 200000;

const overweightBands: Sourced<WeightBand>[] = Array.from(
  { length: (TOP_BAND_LBS - LEGAL_LOAD_LIMIT) / 1000 },
  (_unused, i) => {
    const thousands = i + 1;
    return fromDated<WeightBand>(
      {
        minLbs: LEGAL_LOAD_LIMIT + i * 1000 + 1,
        maxLbs: LEGAL_LOAD_LIMIT + thousands * 1000,
        feeUsd: PERMIT_BASE_USD + thousands * PER_1000_LB_USD,
      },
      ODOT_FEES,
      RETRIEVED,
      `"2. Overweight $40.00 (Plus $10 for each 1,000 lb. when load exceeds legal load limit)" — the $40 overweight permit plus ${thousands} thousand-pound step${thousands === 1 ? '' : 's'} over the ${LEGAL_LOAD_LIMIT.toLocaleString()} lb Interstate limit. 47 O.S. §14-116 states the same structure. THE BAND EDGE IS OUR READING: neither source says how a part step is charged, and this band charges it in full.`,
    );
  },
);

// ── Escort rules ──────────────────────────────────────────────────────────

function escortRule(
  id: string,
  description: string,
  when: EscortRule['when'],
  then: EscortRule['then'],
  source: SourceDoc = OAC_730_50_5,
  effectiveFrom: string = EFF_RULE,
): EscortRule {
  return {
    id,
    jurisdiction: 'OK',
    description,
    when,
    then,
    source,
    effectiveFrom,
    effectiveTo: null,
  };
}

function widthBand(min: number, max: number): EscortRule['when'] {
  return {
    kind: 'between',
    measure: 'widthIn',
    min,
    max,
    minInclusive: false,
    maxInclusive: true,
  };
}

export const OKLAHOMA_ESCORT_RULES: EscortRule[] = [
  // ── Width ───────────────────────────────────────────────────────────────
  escortRule(
    'ok-width-over-12-to-14-two-lane-or-super',
    'Over 12 ft up to 14 ft wide on a two-lane or super two-lane highway — one front escort',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: TWO_LANE_OR_SUPER },
        widthBand(ftIn(12), ftIn(14)),
      ],
    },
    { escorts: 1, front: 1 },
  ),
  escortRule(
    'ok-width-over-12-to-14-multi-lane',
    'Over 12 ft up to 14 ft wide on a multi-lane highway — one rear escort',
    {
      kind: 'all',
      of: [{ kind: 'routeClass', anyOf: MULTI_LANE }, widthBand(ftIn(12), ftIn(14))],
    },
    { escorts: 1, rear: 1 },
  ),
  escortRule(
    'ok-width-over-14-two-lane-or-super',
    'Over 14 ft wide on a two-lane or super two-lane highway — one front and one rear escort',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: TWO_LANE_OR_SUPER },
        { kind: 'gt', measure: 'widthIn', value: ftIn(14) },
      ],
    },
    { escorts: 2, front: 1, rear: 1 },
  ),
  escortRule(
    'ok-width-over-14-multi-lane',
    'Over 14 ft wide on a multi-lane highway — one rear escort',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: MULTI_LANE },
        { kind: 'gt', measure: 'widthIn', value: ftIn(14) },
      ],
    },
    { escorts: 1, rear: 1 },
  ),
  escortRule(
    'ok-width-over-16-all-roads',
    'Over 16 ft wide — one front and one rear escort on all roads and highways',
    { kind: 'gt', measure: 'widthIn', value: ftIn(16) },
    { escorts: 2, front: 1, rear: 1 },
  ),

  // ── Height ──────────────────────────────────────────────────────────────
  /**
   * Note the INCLUSIVE boundary — "fifteen (15) feet and nine (9) inches OR MORE"
   * — which is unusual: almost every other threshold in this directory, and
   * every other one in Oklahoma, is "more than". A load measuring exactly
   * 15 ft 9 in needs two escorts and a height pole here.
   */
  escortRule(
    'ok-height-15-9-or-more',
    'An overall height of 15 ft 9 in or more — one front and one rear escort, with a height-measuring pole',
    { kind: 'gte', measure: 'heightIn', value: ftIn(15, 9) },
    {
      escorts: 2,
      front: 1,
      rear: 1,
      heightPole: true,
      advisory:
        'OAC 730:50-5 requires "A current height measuring pole made of non-conductive, flexible, non-fragile material when escorting a load or vehicle which is fifteen (15) feet and nine (9) inches or more in height" and publishes no further dimensions, clearance margin or mounting specification. Utilities and railroads along the route must be contacted in advance; that coordination is the carrier\'s and is not a state fee.',
    },
  ),

  // ── Length, and the super two-lane distinction ──────────────────────────
  escortRule(
    'ok-length-tractor-semi-over-80-to-100-two-lane',
    'A truck-tractor/semitrailer over 80 ft up to 100 ft overall on a two-lane highway — one front escort',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: TWO_LANE },
        {
          kind: 'between',
          measure: 'overallLengthIn',
          min: ftIn(80),
          max: ftIn(100),
          minInclusive: false,
          maxInclusive: true,
        },
      ],
    },
    { escorts: 1, front: 1 },
  ),
  escortRule(
    'ok-length-other-combination-over-80-to-100',
    'A combination other than a truck-tractor/semitrailer, over 80 ft up to 100 ft, on a two-lane or super two-lane highway — one front escort',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: TWO_LANE_OR_SUPER },
        {
          kind: 'between',
          measure: 'overallLengthIn',
          min: ftIn(80),
          max: ftIn(100),
          minInclusive: false,
          maxInclusive: true,
        },
      ],
    },
    { escorts: 1, front: 1 },
  ),
  escortRule(
    'ok-length-over-100-two-lane-or-super',
    'Any combination over 100 ft overall on a two-lane or super two-lane highway — one front and one rear escort',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: TWO_LANE_OR_SUPER },
        { kind: 'gt', measure: 'overallLengthIn', value: ftIn(100) },
      ],
    },
    { escorts: 2, front: 1, rear: 1 },
  ),
  /**
   * The escort that turns on a word. On a SUPER two-lane highway the rule gives a
   * front escort to a combination "other than a truck-tractor/semi-trailer" over
   * 80 ft and, read literally, gives none to a truck-tractor/semitrailer of the
   * same length — because that rule names only "two-lane highways". A quote does
   * not collect the combination type, so the engine has already priced one front
   * escort from the broader rule and says here that the narrower reading may not
   * require it.
   */
  escortRule(
    'ok-super-two-lane-length-ambiguity',
    'Over 80 ft up to 100 ft on a super two-lane highway — the rule’s two length provisions cover different combinations',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: SUPER_TWO_LANE },
        {
          kind: 'between',
          measure: 'overallLengthIn',
          min: ftIn(80),
          max: ftIn(100),
          minInclusive: false,
          maxInclusive: true,
        },
      ],
    },
    {
      manualReview:
        'OAC 730:50-5-18 states the 80-foot front-escort requirement twice, for different vehicles and different roads: "A truck-tractor/semi-trailer combination which is more than eighty (80) feet in overall length is required to be accompanied by one front escort on two-lane highways" and "A combination other than a truck-tractor/semi-trailer which is more than eighty (80) feet in overall length is required to be accompanied by one front escort on two-lane highways or super two-lane highways." Read literally, a tractor-semitrailer on a SUPER two-lane highway falls outside both. A quote does not collect the combination type, so one front escort has been priced from the broader provision; if this is a tractor-semitrailer, Oklahoma may not require it.',
    },
  ),

  // ── The height conflict ─────────────────────────────────────────────────
  /**
   * 47 O.S. §14-103 allows 14 ft on a turnpike, interstate, U.S. or state highway
   * and 13 1/2 ft on a county road. ODOT's own undated FAQ says "Anything over
   * 13-6 high ..." with no road qualification at all — which agrees with the
   * statute for county roads and contradicts it everywhere else. Between 13 ft
   * 6 in and 14 ft the statute needs no height permit on a state highway and the
   * FAQ does. Recording both as `heightIn` candidates would resolve to null and
   * disable the over-height check entirely, so the conflict fires in exactly the
   * six inches where it bites.
   */
  escortRule(
    'ok-height-13-6-to-14-conflict',
    'Between 13 ft 6 in and 14 ft high — the statute needs no permit on a state highway and ODOT’s FAQ says one is required',
    {
      kind: 'between',
      measure: 'heightIn',
      min: ftIn(13, 6),
      max: ftIn(14),
      minInclusive: false,
      maxInclusive: true,
    },
    {
      manualReview:
        'Oklahoma\'s two sources disagree about whether this load needs a height permit. 47 O.S. §14-103 states "No vehicle, with or without load, shall exceed a height of thirteen and one-half (13 1/2) feet on any county road, or fourteen (14) feet on any turnpike, interstate, U.S. or state highway, unless a greater height is authorized by a special permit"; ODOT\'s undated size-and-weight FAQ says "Anything over 13-6 high, 8-6 wide and length varies with type of vehicle" without distinguishing highway class. The FAQ agrees with the statute on county roads and contradicts it on every other route. The 14-foot statutory limit has been used, so no height permit has been priced for this load; a county-road segment, or ODOT reading its own FAQ, would require one.',
    },
    ODOT_FAQ,
    RETRIEVED,
  ),

  // ── The route-dependent legal load limit ────────────────────────────────
  escortRule(
    'ok-permit-threshold-80000-to-90000',
    'Between 80,000 lb and 90,000 lb — whether a permit is needed at all depends on which highway the move uses',
    {
      kind: 'between',
      measure: 'grossWeightLbs',
      min: 80000,
      max: 90000,
      minInclusive: false,
      maxInclusive: true,
    },
    {
      manualReview:
        'OAC 730:50-5 requires an overweight permit for a load "exceeding 80,000 pounds or any of the provisions of federal Formula \'B\' or Table \'B\', when proposed for movement on the Dwight D. Eisenhower National System of Interstate and Defense Highways" and for one "exceeding 90,000 pounds ... when proposed for movement on any other portion of the State Highway System". This load sits between the two figures, so it needs a permit on the Interstate and, on gross weight alone, does not off it — though either route still needs one if any Formula B or Table B provision is exceeded. The Interstate threshold has been used, so a permit has been priced.',
    },
  ),
  escortRule(
    'ok-excess-base-route-dependent',
    'The $10-per-1,000-lb charge is counted from a legal load limit that differs by 10,000 lb between networks',
    { kind: 'gt', measure: 'grossWeightLbs', value: 90000 },
    {
      manualReview:
        'Oklahoma charges "$10 for each 1,000 lb. when load exceeds legal load limit", and the legal load limit is 80,000 lb on the Interstate System and 90,000 lb elsewhere on the State Highway System. The excess charge above was counted from 80,000 lb; counted from 90,000 it would be $100 lower. Which applies is a property of the route, not of the load, and a quote does not know it. Confirm the applicable legal load limit with ODOT before billing. The limit is also capped independently by the Federal Bridge formula that 47 O.S. §14-109 adopts by reference, which can bind below either figure.',
    },
  ),
  escortRule(
    'ok-partial-increment-unknown',
    'Neither the fee sheet nor the statute says how a part 1,000 lb step is charged',
    { kind: 'gt', measure: 'grossWeightLbs', value: LEGAL_LOAD_LIMIT },
    {
      manualReview:
        'ODOT charges "$10 for each 1,000 lb. when load exceeds legal load limit" and 47 O.S. §14-116 repeats "a fee of Ten Dollars ($10.00) for each thousand pounds in excess of the legal load limit". Neither says what happens to a part step — a load 500 lb over is either $10 or nothing — and neither uses the "or fraction thereof" wording that would settle it. The amount above charges the part step in full, which is the usual convention but is not what Oklahoma writes.',
    },
    OS47_14_116,
    '2026-07-01',
  ),

  // ── Superload, by configuration rather than by weight ───────────────────
  escortRule(
    'ok-superload-ol1-configuration',
    'Oklahoma defines a superload by configuration against Standard Drawing OL-1, not by a weight',
    { kind: 'gt', measure: 'grossWeightLbs', value: LEGAL_LOAD_LIMIT },
    {
      advisory:
        'OAC 730:50-5: "A superload is defined as any overweight permit load that exceeds the Standard Drawing OL-1 trucks described in paragraphs (i) and (j) of this subsection." There is no statewide gross-weight figure — superload status is decided by axle-group weights, spacings and gross weight against a drawing this dataset does not hold — so a load can be a superload at a weight another state would issue over the counter. If the route has not been studied before, "a detailed structural analysis will be required to check each bridge to be crossed ... unless it can be shown by a comparative analysis that it will not exceed stresses developed by OL-1", ODOT may additionally require a pavement-damage evaluation, and requests must be in at least five working days ahead. No separate superload fee appears on ODOT\'s published table, and no engineering-review cost is published at all.',
    },
  ),

  // ── Recorded unknowns ───────────────────────────────────────────────────
  escortRule(
    'ok-multilane-length-and-overhang-unknown',
    'Oklahoma publishes no multi-lane length trigger and no overhang trigger at all',
    PERMIT_LIKELY,
    {
      advisory:
        'OAC 730:50-5-18(b) publishes length-based escort triggers only for two-lane and super two-lane highways, so no escort has been added for length on a multi-lane route — Oklahoma states no threshold there. It also publishes no numerical front- or rear-overhang escort trigger anywhere in the statewide escort rule, so overhang reaches these rules only through the load\'s overall length. Both are recorded absences rather than a finding that no escort could be required: the permit itself may add escorts on ODOT\'s review.',
    },
  ),
  escortRule(
    'ok-no-weight-pilot-car-trigger',
    'Oklahoma publishes no weight-based pilot-car trigger',
    { kind: 'gt', measure: 'grossWeightLbs', value: LEGAL_LOAD_LIMIT },
    {
      advisory:
        'OAC 730:50-5-18(b) triggers pilot cars on width, height and length only, and no statewide weight threshold for a civilian escort is published. That is not a finding that a heavy move travels unescorted: an extremely heavy superload can still be assigned law-enforcement escorts through the permit-specific review.',
    },
  ),
  escortRule(
    'ok-police-escort-triggers-and-rate-unknown',
    'Law-enforcement escort — required when ODOT, the Turnpike Authority or a federal agency directs, at an unpublished full-cost rate',
    { kind: 'gt', measure: 'widthIn', value: ftIn(12) },
    {
      advisory:
        'Oklahoma publishes NO numerical trigger for an Oklahoma Highway Patrol escort. 47 O.S. requires an escort where "the Department of Transportation, the Oklahoma Turnpike Authority, or any federal agency or commission" directs one, and DPS Troop S says only "We will assist with these loads once it is determined the load meets certain height, width, length, weight requirements, or a combination of any of these four." The OHP escort-contract application refers to "oversize loads in excess of 20 feet" WITHOUT saying which dimension the twenty feet measures, so it cannot safely be encoded as a trigger. The charge is "a fee covering the full cost to administer, plan, and carry out the escort within this state", and although the statute directs DPS to "adopt a schedule of fees necessary to implement this section", no hourly, mileage or fixed schedule is published. A contract takes 5 to 7 working days in most instances. No police-escort amount is included in the total and none can be estimated.',
    },
    OS47_ESCORT_STATUTE,
    '2023-11-01',
  ),
  escortRule(
    'ok-pilot-car-certification',
    'Every for-hire escort operator on this move must be ODOT-certified, and the reciprocal states are not published',
    { kind: 'gt', measure: 'widthIn', value: ftIn(12) },
    {
      advisory:
        'OAC 730:50-5: "Every person who drives an escort vehicle for hire to escort a permitted over-dimensional load or vehicle in this state must be certified by the Department of Transportation." The operator must be at least 18, licensed, and must pass ODOT\'s escort certification course and examination at 75 percent or better; the certificate expires automatically five years after issue. A non-resident may use a current certification from a state with a reciprocal agreement, but an Oklahoma resident must hold an Oklahoma certificate "under all circumstances" — and Oklahoma publishes no list of the reciprocal states. The course is taught by the Oklahoma State University Center for Local Government Technology and no course or certification fee is published in the ODOT rule or on the permit-fee table, so no certification cost is in the total.',
    },
  ),
  escortRule(
    'ok-route-survey-unknown',
    'Oklahoma publishes no mandatory route-survey threshold and no survey cost',
    { kind: 'gt', measure: 'heightIn', value: ftIn(14) },
    {
      advisory:
        'Oklahoma sets no numerical threshold at which a physical route survey becomes mandatory. Its Large Project Preparation Worksheet only asks whether the customer wants suggested routes "so, the route can then be ran for Survey purposes by you the customer" — the survey is contemplated as the carrier\'s, not required by a published rule, and no ODOT survey fee exists. What IS required for a non-standard overweight load is an engineering load-route review: every application must state all axles, spacings and weights, the inner bridge dimensions, gross weight, width, height, length, origin, destination and proposed routing. Qualifying OL-1 configurations on previously studied routes can skip that review.',
    },
    ODOT_WORKSHEET,
    RETRIEVED,
  ),
  escortRule(
    'ok-special-movement-fee',
    'A newly manufactured item over 16 ft and up to 23 ft wide carries a separate $500 Special Movement Fee',
    { kind: 'gt', measure: 'widthIn', value: ftIn(16) },
    {
      advisory:
        'If this is a newly manufactured item, 47 O.S. §14-120 adds a Special Movement Fee: "a special movement permit shall be issued for a fee of Five Hundred Dollars ($500.00) ... The special movement permit, and fee related thereto, shall be in addition to the permit and fees required by Section 14-116 of this title." ODOT\'s table prices it for items "exceeding 16 feet but not exceeding 23 feet in width" and expressly excludes houses and manufactured homes. A quote does not collect whether the load is newly manufactured, so the $500 has NOT been added and cannot be ruled out — it would more than quadruple the permit total on an ordinary combined permit.',
    },
    OS47_14_120,
    EFF_STATUTE_2022,
  ),
  escortRule(
    'ok-fax-fee-conditional',
    'The $2.00 electronic-delivery fee applies only to a faxed or emailed permit',
    PERMIT_LIKELY,
    {
      advisory:
        'The total above includes the $2.00 fee that 47 O.S. §14-118 authorises "for each permit requested to be issued by facsimile machine or by any other means of electronic transmission, transfer or delivery", which ODOT\'s table lists as "Fax/ETF (Faxed or emailed permits only) $2.00". A permit collected another way would be $2.00 cheaper, and the 4% card charge on top of it correspondingly smaller. The 4% is a genuine percentage surcharge — "Credit Card Convenience Fee (% of total credit card charges) 4%" — applied to the whole charge, which is how it has been computed here.',
    },
    OS47_14_118,
    EFF_STATUTE_2022,
  ),
];

// ── The jurisdiction ──────────────────────────────────────────────────────

export const OKLAHOMA_OSOW_RULES: JurisdictionOsowRules = {
  code: 'OK',
  name: 'Oklahoma',
  country: 'US',

  legalLimits: {
    widthIn: [
      fromDated(
        102,
        OS47_14_103,
        EFF_STATUTE_2022,
        '"no vehicle, with or without load, shall have a total outside width in excess of one hundred two (102) inches", excluding tire bulge, approved safety devices, qualifying recreational-vehicle appurtenances and qualifying safety or load-assisting pins.',
      ),
    ],
    /**
     * 14 ft — the turnpike, interstate, U.S. and state highway limit, which is
     * where freight runs. The county-road limit of 13 1/2 ft and ODOT's own FAQ
     * are both lower, and the FAQ genuinely CONFLICTS with the statute rather
     * than describing a different network. Recording the two as candidates would
     * resolve to null and disable the over-height check on every Oklahoma quote,
     * so the six-inch disputed band is carried by `ok-height-13-6-to-14-conflict`.
     */
    heightIn: [
      fromDated(
        ftIn(14),
        OS47_14_103,
        EFF_STATUTE_2022,
        '"fourteen (14) feet on any turnpike, interstate, U.S. or state highway, unless a greater height is authorized by a special permit". The same sentence sets 13 1/2 ft on a county road, and ODOT\'s undated FAQ states a flat "Anything over 13-6 high" for every route — see `ok-height-13-6-to-14-conflict`.',
      ),
    ],
    trailerLengthIn: [
      fromDated(
        ftIn(53),
        OS47_14_103,
        EFF_STATUTE_2022,
        'The statute states the same 53 ft semitrailer limit twice — once for the National Network of Interstate and four-lane divided Federal Aid Primary highways and once for roads outside it — so the trailing unit is capped identically on and off the network. It states no overall cap for an ordinary truck-tractor/semitrailer on the National Network.',
      ),
    ],
    /**
     * `overallLengthIn` is ABSENT. 47 O.S. §14-103 caps a single truck at 45 ft
     * and "no other combination of vehicles" at 70 ft, and states no overall cap
     * for a truck-tractor/semitrailer. Recording 70 ft would put every ordinary
     * combination with a 53 ft trailer over the legal limit in Oklahoma.
     *
     * Overhang limits are absent because Oklahoma publishes none — a recorded
     * absence, not an omission; see `ok-multilane-length-and-overhang-unknown`.
     */
    grossWeightLbs: [
      fromDated(
        80000,
        OAC_730_50_5,
        EFF_RULE,
        'ODOT requires an overweight permit above 80,000 lb on the Interstate System and above 90,000 lb elsewhere on the State Highway System, and in EITHER case above any Formula B or Table B provision. The Interstate figure is used because it is the lower and it is the network most permitted freight runs on; the ten-thousand-pound difference is worth $100 of permit fee and is flagged by `ok-excess-base-route-dependent`. 47 O.S. §14-109 sets the gross limit by reference to "the Federal Bridge formula imposed by 23 U.S.C., Section 127" rather than printing a number, and that formula is checked separately in `bridgeFormula.ts`.',
      ),
    ],
    singleAxleLbs: [
      fromDated(20000, OS47_14_109, EFF_STATUTE_2022, '"No single axle weight shall exceed twenty thousand (20,000) pounds;"'),
    ],
    tandemAxleLbs: [
      fromDated(
        34000,
        OS47_14_109,
        EFF_STATUTE_2022,
        '"In no event shall the maximum load in pounds carried by any set of tandem axles exceed thirty-four thousand (34,000) pounds." Split tandems and tri-axles must also satisfy the Federal Bridge formula.',
      ),
    ],
  },

  /**
   * A SOURCED ZERO. Oklahoma's $40 is not an issuance charge sitting under the
   * schedule — it IS the oversize permit, and the overweight permit is a SECOND
   * $40. OAC 730:50-5 says so: "the permit fees shall apply as though both
   * permits had been issued separately", which is why the combined row is $80.
   * So the $40 lives in `oversizeFeeBands` and again inside each overweight
   * band, and this row records that nothing else is charged on top. The engine
   * suppresses the empty line rather than printing "$0.00".
   */
  permitBaseFeeUsd: [
    fromUndated(
      0,
      ODOT_FEES,
      'ODOT\'s table charges $40.00 for an oversize permit, $40.00 plus the excess-weight charge for an overweight one, and $80.00 plus the excess charge when the load is both — two permits, not a base and a surcharge. Nothing further is charged for issuance; the only additions are the $2.00 electronic-delivery fee and the 4% card charge.',
    ),
  ],

  /**
   * One unbounded band. Oklahoma does not step the oversize fee by dimension:
   * "1. Oversize $40.00" is the whole schedule, the same at 8 ft 7 in and at
   * 20 ft. The Special Movement Fee for a newly manufactured item over 16 ft
   * wide is a separate permit under 47 O.S. §14-120 rather than a step in this
   * one, and is stated by `ok-special-movement-fee` instead of being applied to
   * a commodity a quote does not collect.
   */
  oversizeFeeBands: [
    fromUndated<OversizeFeeBand>(
      { label: 'single trip oversize permit, any over-legal dimension', feeUsd: 40 },
      ODOT_FEES,
      '"(a) Single trip/monthly 1. Oversize $40.00". 47 O.S. §14-116 states the same as "a minimum permit fee of Forty Dollars ($40.00) for any permit issued".',
    ),
  ],

  overweightPricing: [
    fromUndated<OverweightPricing>(
      {
        kind: 'bands',
        explanation:
          'ODOT prices the overweight permit as a flat $40.00 plus $10.00 for each 1,000 lb over the legal load limit. It is not mileage-based, not axle-based and not published as weight bands — the bands below enumerate the formula so the engine can select one, and each band\'s note carries the formula it came from.',
      },
      ODOT_FEES,
    ),
    fromDated<OverweightPricing>(
      {
        kind: 'bands',
        explanation:
          '47 O.S. §14-116: "The Executive Director of the Department of Transportation shall charge a minimum permit fee of Forty Dollars ($40.00) for any permit issued ... In addition to the permit fee, the Executive Director of the Department of Transportation shall charge a fee of Ten Dollars ($10.00) for each thousand pounds in excess of the legal load limit." The statute and the fee table agree on the structure, so these two rows corroborate rather than conflict.',
      },
      OS47_14_116,
      '2026-07-01',
    ),
  ],

  overweightBands,

  /** Nothing in Oklahoma's permit fee depends on distance. */
  overweightPerMile: [],

  /**
   * EMPTY, AS A FINDING. Oklahoma attaches no weight-conditioned surcharge to a
   * single-trip permit — the $10 per 1,000 lb is the whole weight charge and it
   * is carried by the bands. The $500 Special Movement Fee is conditioned on the
   * load being a newly manufactured item between 16 and 23 ft wide, which is a
   * commodity test rather than a weight test, so it cannot be expressed here and
   * is stated by `ok-special-movement-fee` instead.
   */
  conditionalFees: [],

  transactionFee: [
    fromUndated<TransactionFee>(
      { perPermitUsd: 2, percentOfTotal: 4 },
      ODOT_FEES,
      '"1. Fax/ETF (Faxed or emailed permits only) $2.00" and "2. Credit Card Convenience Fee (% of total credit card charges) 4%". The order matters and this engine matches Oklahoma\'s: the $2.00 is added to the permit fee first and the 4% is taken on the whole charge, which is what "% of total credit card charges" means. On an $80 combined permit with $20 of excess weight that is $100, then $102, then $106.08.',
    ),
  ],

  /**
   * EMPTY, AND THE EMPTINESS IS THE FINDING. Oklahoma publishes NO
   * engineering-review or bridge-analysis fee. OAC 730:50-5 requires a detailed
   * structural analysis of every bridge on an unstudied superload route and
   * reserves the right to require a pavement evaluation, and attaches no charge
   * to either. Putting a number here would invent the one figure the rule
   * conspicuously does not give.
   */
  routeAnalysisFeeUsd: [],
  noBridgeRouteFeeUsd: [],

  superload: {
    /**
     * `grossWeight` ABSENT, as a positive finding, and it is why Oklahoma is
     * deliberately missing from the widget's weight-ceiling mirror. OAC 730:50-5
     * defines a superload as "any overweight permit load that exceeds the
     * Standard Drawing OL-1 trucks described in paragraphs (i) and (j)" — a
     * comparison against a drawing's axle-group weights, spacings and gross
     * weights, not a pound figure. There is no number to hold, and warning about
     * a missing one on every Oklahoma quote would be inventing a gap. The federal
     * 80,000 lb contact-us ceiling therefore stands for Oklahoma lanes.
     */
    shortSpacing: [],
  },

  /**
   * All three empty. Oklahoma publishes no dimensional route-inspection or
   * route-survey trigger at all — its own worksheet treats the survey as
   * something the customer may choose to run — so inventing one would send loads
   * to an inspection the state never asked for. What Oklahoma does require is an
   * engineering load-route review for a non-standard overweight load, which is
   * keyed on the configuration rather than on a dimension; see
   * `ok-route-survey-unknown`.
   */
  routeInspection: {
    widthIn: [],
    heightIn: [],
    lengthIn: [],
  },

  escortRules: OKLAHOMA_ESCORT_RULES,

  feesDependOnDistance: false,
};

/** Cited for the OHP escort contract's unquantified 20-foot threshold. */
export const OKLAHOMA_OHP_CONTRACT_SOURCE = OHP_CONTRACT_APP;

/** Cited for DPS's own statement that its escort triggers are not published. */
export const OKLAHOMA_DPS_TROOP_S_SOURCE = DPS_TROOP_S;
