/**
 * WYOMING — oversize/overweight single-trip permit rules.
 *
 * A 117,000 lb LEGAL GROSS, A 36,000 lb TANDEM, AND AN ESCORT LADDER WE DO NOT
 * HAVE.
 * ═══════════════════════════════════════════════════════════════════════════
 * READ THE ESCORT WARNING FIRST. The research run that produced this file
 * stopped mid-sentence partway through the fee schedule and never reached
 * section E. Wyoming's escort rules are NOT in this dataset — not "Wyoming
 * publishes none", which is what an empty `escortRules` array would say to
 * anyone reading the code, but "we did not retrieve them".
 *
 * That distinction is worth money. Every other state in this corpus with an
 * empty escort ladder has a `publishedAbsence` behind it saying the rule was
 * read and contains no trigger. Wyoming has the opposite: a state with 117,000
 * lb legal loads and mountain two-lane highways certainly has escort rules, and
 * reporting zero escorts on a 16 ft wide Wyoming move would be a silent
 * under-quote of the single largest variable cost on the lane.
 *
 * So `wy-escort-rules-not-retrieved` fires on ANY load over a legal dimension
 * and sends it to manual review. Wyoming's PERMIT FEES are quotable from this
 * file and its ESCORTS are not, and the quote says so rather than implying a
 * completeness the data does not have. Delete that rule the moment the escort
 * section is sourced.
 *
 * WYOMING'S LEGAL WEIGHTS ARE UNLIKE ANYONE ELSE'S IN THIS CORPUS.
 * ---------------------------------------------------------------
 *   tandem ............ 36,000 lb   (everyone else on file: 34,000)
 *   triple axle ....... 42,000 lb   (a published tridem figure at all is rare)
 *   gross ............. up to 117,000 lb under Gross Weight Table I
 *
 * THE 36,000 lb TANDEM IS THE TRAP. Every other jurisdiction here caps a tandem
 * at the federal 34,000, and a 35,000 lb tandem that is overweight in
 * thirty-one states is legal in Wyoming. Carrying the federal number would
 * invent a permit requirement — and, because the overweight fee below is
 * charged on the excess over the legal limit, would invent a fee with it.
 *
 * AND THE GROSS IS NOT 80,000. W.S. 31-18-802 runs the federal bridge formula
 * out to a 117,000 lb ceiling on the interstate. On primary and secondary
 * highways the operator CHOOSES between Table I (to 117,000 lb, banded by axle
 * spacing) and Table II (to 80,000 lb, banded by the extreme-axle distance of
 * the whole vehicle) — "at the discretion of the operator", in the statute's
 * own words. That is an election, not a conflict: a heavy hauler takes Table I.
 * 117,000 lb is therefore the operative legal gross, with the proviso that
 * vehicles whose consecutive tandem sets are less than 22 ft apart must use
 * Table I regardless.
 *
 * THE FEE MODEL IS THREE PARTS AND WE CAN PRICE TWO.
 * -------------------------------------------------
 *   1. $25.00 flat, for any oversize single-trip permit.                PRICED
 *   2. $0.06 per ton or fraction thereof over the legal weight, per
 *      mile, with a $40.00 minimum.                                     PRICED
 *   3. $0.03 per foot or fraction thereof over 15 ft wide, 15 ft high
 *      or 75 ft of single-vehicle length, per mile.                 NOT PRICED
 *
 * THE THIRD ONE IS LEFT OUT DELIBERATELY, AND FOR A REASON THAT IS WYOMING'S
 * RATHER THAN OURS. W.S. 31-18-804 reads: "Should any vehicle including load
 * exceed the dimensions of fifteen (15) feet in width or fifteen (15) feet in
 * height or any single vehicle including load exceed seventy-five (75) feet in
 * length, an additional fee shall be paid IN EXCESS OF THE ABOVE LIMITATION
 * computed at the rate of three cents ($.03) for each foot or fraction thereof
 * for each mile traveled on the highways."
 *
 * "The above limitation" is SINGULAR against three thresholds, and the statute
 * never says how a load over two of them is charged. A load 2 ft over on width
 * and 3 ft over on height could owe five foot-miles, three (the greatest single
 * excess), or two separate charges. Those readings differ by a factor of two
 * and Wyoming has not chosen between them. Encoding one would put a fabricated
 * resolution of a real ambiguity into a priced line.
 *
 * It is recorded as a BOUNDED, STATED exposure instead — the formula is on the
 * quote, so a dispatcher can compute it, and the headline number does not
 * silently include a guess. THE MAGNITUDE JUSTIFIES THAT TREATMENT: at 16 ft
 * wide across 300 Wyoming miles the charge is 1 ft x $0.03 x 300 = $9 on any
 * reading, comfortably inside the $50 materiality threshold. It only becomes
 * material on loads far over the thresholds — 10 ft over across 300 miles is
 * $90 — and those are exactly the moves the escort gap already sends to manual
 * review. See `wy-oversize-foot-mile-surcharge`.
 *
 * THE TON-MILE ROUNDING IS PUBLISHED, AND IT ROUNDS UP. "six cents ($.06) for
 * each ton OR FRACTION THEREOF of weight in excess of the weight limitation
 * under W.S. 31-18-802 for each mile traveled". Wyoming states its partial
 * increment where most states leave it to be inferred, so it is encoded rather
 * than spread.
 *
 * THE $40 MINIMUM IS REACHABLE AND OFTEN BINDING. "In no event shall the fee be
 * less than forty dollars ($40.00) for the permit." One ton over across 100
 * miles computes to $6.00 and bills at $40.00 — so on short in-state runs the
 * floor, not the rate, is the price.
 *
 * ABOVE 125 TONS THE STATE STOPS PUBLISHING A PRICE. The administrative code's
 * § 5-6(c): permits for loads over 250,000 lb "may require additional analysis
 * to determine routing, structure, and highway capabilities to withstand the
 * load. Permits shall not be issued until the permit holder has paid all costs
 * the Department incurs to process the permit. These costs shall include
 * amounts spent analyzing routes and the cost of sending personnel to accompany
 * load movement." An open-ended cost-recovery charge with no rate — including,
 * unusually, the cost of DEPARTMENT PERSONNEL ACCOMPANYING THE LOAD, which is
 * an escort charge in everything but name and is equally unquotable.
 *
 * WHAT IS DELIBERATELY ABSENT
 * ---------------------------
 *   - ESCORTS, and loudly. See the top of this comment.
 *   - the annual and specialty products, which are not single-trip
 *     alternatives: Class D at $50 oversize and $40 minimum overweight, Class E
 *     and F at $15 single-trip and $50 for up to 90 days, $250 for a commercial
 *     oversize recreational-vehicle move, and a $50/$40 custom-harvest 90-day
 *     permit. None is applied.
 *   - `transactionFee` — no service, processing or percentage charge appears in
 *     W.S. 31-18-804 or in the administrative code's fee section. Recorded as a
 *     sourced zero because the fee section WAS read; the truncation hit the
 *     escort section, not this one.
 *
 * SOURCE QUALITY. The statute rows are PRIMARY from wyoleg.gov, the state's own
 * host, and carry the 2021 title year. The consolidated fee schedule — Class A
 * through F, the harvest and RV products — is SECONDARY, from Cornell LII's
 * copy of Agency 045 Subagency 0004 Chapter 5; the two agree on every figure
 * that appears in both, which is the available cross-check.
 */
import type { SourceDoc, Sourced } from '../provenance.js';
import type { EscortRule } from '../escortRules.js';
import type {
  CombinedFeeRule,
  FeeDistanceDependence,
  JurisdictionOsowRules,
  OverweightPricing,
  PerMileRate,
  PublishedAbsence,
  TransactionFee,
} from '../types.js';

const RETRIEVED = '2026-09-06';

/**
 * wyoleg.gov serves the statutes under a "2021 Titles" path and states no
 * finer date. Widened to the first day of that year, which is the earliest
 * instant consistent with the evidence and never claims the text took effect
 * later than it did. The same convention Illinois uses for its year-only rows.
 */
const STATUTE_FROM = '2021-01-01';

// ── Source documents ──────────────────────────────────────────────────────

const WY_STATUTES: SourceDoc = {
  id: 'wy-title-31-ch-18',
  title: 'Wyoming Statutes Title 31 Chapter 18 — size, weight and load',
  url: 'https://wyoleg.gov/NXT/gateway.dll/Statutes/2021%20Titles/1634/1693/1701',
  publisher: 'Wyoming Legislature',
  revisedOn: '2021',
  retrievedOn: RETRIEVED,
  cite:
    'PRIMARY, from the state\'s own statute host. Source of every legal limit, the Table I bridge formula, the $25 base fee, the $0.03 foot-mile oversize surcharge, the $0.06 ton-mile overweight rate and the $40 minimum. The path carries a 2021 title year and no finer date.',
};

const WY_ADMIN_CH5: SourceDoc = {
  id: 'wy-admin-045-0004-ch5',
  title: 'Wyoming Administrative Rules, Agency 045 Subagency 0004 Chapter 5 § 5-6 — permit fees',
  url: 'https://www.law.cornell.edu/regulations/wyoming/agency-045/subagency-0004/chapter-5/W-S-5-6',
  publisher: 'Wyoming Department of Transportation (via Cornell LII)',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite:
    'SECONDARY — Cornell LII\'s copy, which states no revision date. It restates the statute\'s $25, $0.03 foot-mile and $0.06 ton-mile figures identically, which is the available cross-check, and adds the Class A-F, custom-harvest and recreational-vehicle products and the over-125-ton cost-recovery rule.',
};

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

/**
 * THE ONLY ESCORT RULE IN THIS FILE, AND IT IS A REFUSAL RATHER THAN A
 * REQUIREMENT.
 *
 * An empty `escortRules` array reads as "this state requires no escorts". For
 * Wyoming that would be false and expensive: the research never reached the
 * escort section, and a state with 117,000 lb legal loads and mountain two-lane
 * highways certainly publishes a ladder. This rule fires on any load past a
 * legal dimension and refuses to answer, so the gap is visible on the quote
 * instead of showing up as a confident zero.
 *
 * DELETE IT when Wyoming's escort rules are sourced.
 */
const WY_ESCORTS_NOT_RETRIEVED =
  'WYOMING\'S ESCORT RULES ARE NOT IN THIS DATASET. The research run that produced Wyoming\'s legal limits and fee schedule terminated partway through the fee section and never reached the escort rules, so this file holds none — and that is a GAP IN OUR DATA, not a finding that Wyoming requires no escorts. Wyoming permits 117,000 lb legal gross and carries heavy freight over mountain two-lane highways; it certainly publishes escort triggers. Reporting zero escorts here would understate the largest variable cost on an oversize Wyoming lane. The permit FEES in this file are sourced and quotable; the escort requirement must be confirmed with WYDOT before this move is priced.';

export const WYOMING_ESCORT_RULES: EscortRule[] = [
  {
    id: 'wy-escort-rules-not-retrieved',
    jurisdiction: 'WY',
    description:
      'Any load over a Wyoming legal dimension — escort requirement unknown, because Wyoming\'s escort rules were never retrieved',
    when: {
      kind: 'any',
      of: [
        { kind: 'gt', measure: 'widthIn', value: 102 },
        { kind: 'gt', measure: 'heightIn', value: 168 },
        { kind: 'gt', measure: 'overallLengthIn', value: 85 * 12 },
        { kind: 'gt', measure: 'grossWeightLbs', value: 117_000 },
      ],
    },
    then: { manualReview: WY_ESCORTS_NOT_RETRIEVED },
    source: WY_STATUTES,
    effectiveFrom: STATUTE_FROM,
    effectiveTo: null,
  },
];

export const WYOMING_OSOW_RULES: JurisdictionOsowRules = {
  code: 'WY',
  name: 'Wyoming',
  country: 'US',

  /**
   * EMPTY, AND NOT ON A CHECKED NEGATIVE. Wyoming's weight tables do distinguish
   * the interstate from primary and secondary highways — Table I governs the
   * interstate outright, while primary and secondary roads let the operator
   * elect between Tables I and II. That is a real road-class distinction, but it
   * changes which TABLE a hauler may choose rather than imposing a different
   * ceiling, and a hauler running heavy elects Table I everywhere. No route
   * vocabulary is declared because none of the values in this file turns on one.
   */
  routeVocabulary: [],

  legalLimits: {
    widthIn: [
      fromDated(
        102,
        WY_STATUTES,
        STATUTE_FROM,
        'W.S. 31-18-802: "No vehicle, unladen or with load or load-holding device thereon shall exceed one hundred two (102) inches in width." EXCLUSIVE ("shall exceed"). Corroborated by Wyoming Administrative Code Agency 045 Subagency 0004 Chapter 5 § 5-3(c)(i): "Width: 8 1/2 feet (102 inches)."',
      ),
    ],
    heightIn: [
      fromDated(
        168,
        WY_STATUTES,
        STATUTE_FROM,
        'W.S. 31-18-802: "No vehicle, unladen or with load or load-holding devices thereon, shall exceed fourteen (14) feet in height." EXCLUSIVE. 14 FT, NOT 13 FT 6 IN — a 13 ft 9 in load needs no Wyoming permit. Corroborated at Chapter 5 § 5-3(c)(ii): "Height: 14 feet".',
      ),
    ],
    trailerLengthIn: [
      fromDated(
        60 * 12,
        WY_STATUTES,
        STATUTE_FROM,
        'W.S. 31-18-803: "In a truck-tractor semitrailer combination, no semitrailer shall exceed sixty (60) feet in length." EXCLUSIVE, and SIXTY FEET IS EXCEPTIONALLY GENEROUS — most of this corpus caps the semitrailer at 48 or 53 ft, so a 57 ft trailer that needs a permit in Utah is legal in Wyoming. Chapter 5 § 5-3(c)(iii)(A) states the same: "60 feet for single units or semi-trailers in a truck-tractor and semitrailer combination." A DOUBLE is different and stricter: the semitrailer may not exceed 48 ft, the second trailer 40 ft, and their combined length 81 ft including connecting mechanisms.',
      ),
    ],
    overallLengthIn: [
      fromDated(
        85 * 12,
        WY_STATUTES,
        STATUTE_FROM,
        'W.S. 31-18-803: "For any other combination of vehicles the overall length shall not exceed eighty-five (85) feet." EXCLUSIVE. A single vehicle is separately capped at 60 ft, no combination may consist of more than three single vehicles, and a saddlemount combination may run to 97 ft with no more than three saddlemounts.',
      ),
    ],
    /**
     * 117,000 lb, AND THE FIGURE IS NOT A TYPO. Wyoming runs the federal bridge
     * formula out to a 117,000 lb ceiling rather than stopping at 80,000.
     */
    grossWeightLbs: [
      fromDated(
        117_000,
        WY_STATUTES,
        STATUTE_FROM,
        'W.S. 31-18-802 and Chapter 5 § 5-3(c)(iv)(J)(I): "Up to 117,000 pounds on the interstate in accordance with the formula limitations found in Gross Weight Table 1." Table I is built from W = 500[LN/(N-1) + 12N + 36], with W "to the nearest five hundred (500) pounds". ON PRIMARY AND SECONDARY HIGHWAYS THE OPERATOR ELECTS: vehicles "may operate in accordance with Table I or Table II AT THE DISCRETION OF THE OPERATOR" — Table I to 117,000 lb banded by axle-group spacing, Table II to 80,000 lb banded by the extreme-axle distance of the whole vehicle. That is an election rather than a conflict, and a heavy hauler takes Table I, so 117,000 lb is the operative ceiling. One proviso binds it: vehicles with two consecutive sets of tandem axles less than 22 ft apart "shall comply with gross weight Table I" regardless.',
      ),
    ],
    singleAxleLbs: [
      fromDated(
        20_000,
        WY_STATUTES,
        STATUTE_FROM,
        'W.S. 31-18-802: "No single axle shall carry a load in excess of twenty thousand (20,000) pounds." EXCLUSIVE. "Single axle" is defined at W.S. 31-18-801(a)(xxv) as the wheels whose centres fall between two parallel transverse vertical planes 40 inches apart. Wyoming also caps the WHEEL at 10,000 lb on pneumatic tyres and 8,000 lb on solid, and the TYRE at 750 lb per inch of width on a steering axle and 600 lb/in elsewhere, with "tire width" meaning the width stamped on the tyre by the manufacturer. None of the three is evaluated, because a quote states no tyre dimensions.',
      ),
    ],
    /**
     * 36,000 lb, AND THIS IS THE ONE TO GET RIGHT. Every other jurisdiction on
     * file caps a tandem at the federal 34,000. Substituting that here would
     * invent a permit requirement on a legal Wyoming load — and, because the
     * overweight fee is charged on the excess over the legal limit, would
     * invent a fee along with it.
     */
    tandemAxleLbs: [
      fromDated(
        36_000,
        WY_STATUTES,
        STATUTE_FROM,
        'W.S. 31-18-802: "No tandem axle shall carry a load in excess of thirty-six thousand (36,000) pounds and no one (1) axle of any group of two (2) consecutive axles shall exceed the weight permitted on a single axle." EXCLUSIVE, and 2,000 lb ABOVE the federal figure every other state in this corpus uses. "Tandem axle" is defined at W.S. 31-18-801(a)(xxviii) as consecutive load-bearing axles spaced more than 40 inches and not more than 96 inches apart. WYOMING ALSO PUBLISHES A TRIDEM, which is rare: "No triple axle, consisting of three (3) consecutive load bearing axles ... having a spacing between the first and third axles greater than ninety-six (96) inches and not more than one hundred two (102) inches, shall carry a load in excess of forty-two thousand (42,000) pounds." The schema holds no tridem field, so 42,000 lb is recorded here and not evaluated.',
      ),
    ],
  },

  permitBaseFeeUsd: [
    fromDated(
      25,
      WY_STATUTES,
      STATUTE_FROM,
      'W.S. 31-18-804(f): "When an oversize single trip permit is issued, the fee is twenty-five dollars ($25.00)." Corroborated at Chapter 5 § 5-6(a): "Fees shall be $25 for any vehicle or load exceeding the statutory limits". The annual and specialty products are not single-trip alternatives and are not applied: Class D at $50 oversize with a $40 minimum overweight, Class E and F at $15 single-trip and $50 for a period not exceeding 90 days, $250 for a commercial oversize recreational-vehicle move, and a custom-harvest 90-day permit at $50 oversize and $40 minimum overweight.',
    ),
  ],

  /**
   * EMPTY, AND THE $0.03 FOOT-MILE SURCHARGE IS WHY IT IS NOT HERE. Wyoming's
   * oversize charge is continuous in BOTH excess feet and miles, which no fee
   * band can express — and the statute is ambiguous about how a load over two
   * thresholds is charged. See `wy-oversize-foot-mile-surcharge`.
   */
  oversizeFeeBands: [],

  combinedFeeRule: [
    fromDated<CombinedFeeRule>(
      {
        kind: 'cumulative',
        explanation:
          'W.S. 31-18-804 treats the charges as additive in terms — the oversize surcharge is "an ADDITIONAL fee ... in excess of the above limitation", and the overweight fee is stated separately with its own $40 floor. An oversize, legal-weight load pays the $25 plus the foot-mile surcharge; an overweight load pays the $25 plus the ton-mile charge or the $40 minimum, whichever is greater.',
      },
      WY_STATUTES,
      STATUTE_FROM,
    ),
  ],

  overweightPricing: [
    fromDated<OverweightPricing>(
      {
        kind: 'perMile',
        explanation:
          'W.S. 31-18-804: "When an overweight permit is issued, the fee is six cents ($.06) for each ton or fraction thereof of weight in excess of the weight limitation under W.S. 31-18-802 for each mile traveled on the highways. In no event shall the fee be less than forty dollars ($40.00) for the permit."',
      },
      WY_STATUTES,
      STATUTE_FROM,
    ),
  ],

  /**
   * $0.06 PER TON-MILE OVER 117,000 lb, FLOORED AT $40.
   *
   * `roundIncrementUp` IS TRUE because Wyoming says so — "each ton OR FRACTION
   * THEREOF" — rather than because it is the cautious default. The excess is
   * measured over the W.S. 31-18-802 limit, which for a heavy hauler electing
   * Table I is 117,000 lb, NOT 80,000: using the federal figure would bill
   * 18.5 extra tons on every 117,000 lb load that owes nothing at all.
   */
  overweightPerMile: [
    fromDated<PerMileRate>(
      {
        minLbs: 117_001,
        maxLbs: null,
        ratePerMileUsd: 0.06,
        perIncrementLbs: 2_000,
        excessBaseLbs: 117_000,
        roundIncrementUp: true,
        minimumUsd: 40,
        maximumUsd: null,
      },
      WY_STATUTES,
      STATUTE_FROM,
      'THE $40 FLOOR IS OFTEN THE PRICE, not a formality: one ton over across 100 Wyoming miles computes to $6.00 and bills at $40.00, so on short in-state runs the minimum governs and the rate never bites. Corroborated at Chapter 5 § 5-6(b): "Fees shall be six (6) cents for each ton or fraction thereof exceeding the statutory limits for each mile traveled, with a $40 minimum fee."',
    ),
  ],

  overweightBands: [],
  conditionalFees: [],

  transactionFee: [
    fromDated<TransactionFee>(
      { perPermitUsd: 0, percentOfTotal: 0 },
      WY_STATUTES,
      STATUTE_FROM,
      'AN AFFIRMATIVE ABSENCE, and the fee section WAS reached before the research run terminated — the truncation hit the escort rules, not this. Neither W.S. 31-18-804 nor Chapter 5 § 5-6 names a service, processing, administrative or percentage charge on top of the permit fee.',
    ),
  ],

  routeAnalysisFeeUsd: [],
  noBridgeRouteFeeUsd: [],

  superload: {
    shortSpacing: [],
  },

  routeInspection: {
    widthIn: [],
    heightIn: [],
    lengthIn: [],
  },

  escortRules: WYOMING_ESCORT_RULES,
  escortCountCombination: [],

  feeDistanceDependence: [
    fromDated<FeeDistanceDependence>(
      {
        component: 'overweight',
        dependsOnDistance: true,
        quote:
          'W.S. 31-18-804: "six cents ($.06) for each ton or fraction thereof of weight in excess of the weight limitation under W.S. 31-18-802 FOR EACH MILE TRAVELED ON THE HIGHWAYS."',
      },
      WY_STATUTES,
      STATUTE_FROM,
      'Both of Wyoming\'s variable charges are per-mile — the ton-mile overweight fee and the foot-mile oversize surcharge — so in-state mileage is required before either can be priced, and the $40 floor is the only figure that does not need it.',
    ),
  ],

  publishedAbsences: [
    /**
     * THE MOST IMPORTANT ROW IN THIS FILE. It records a RESEARCH GAP rather
     * than a finding about Wyoming, and the two must never be confused.
     */
    fromDated<PublishedAbsence>(
      {
        subject: 'dimensionalEscortThresholds',
        statement:
          'NOT CHECKED — this is a gap in our data, not a finding about Wyoming. The research run that produced this file terminated partway through the fee schedule, mid-sentence, and never reached the escort section. No Wyoming escort rule has been read, so none is on file.',
        consequence:
          'Every Wyoming load over a legal dimension goes to manual review through `wy-escort-rules-not-retrieved`, and no escort count or cost is quoted. This is the opposite of the empty escort ladders elsewhere in this corpus, which record rules that WERE read and contain no trigger. Wyoming permits 117,000 lb legal gross over mountain two-lane highways and certainly publishes escort triggers; reporting zero would understate the largest variable cost on the lane. Remove the refusal rule when the escort section is sourced.',
      },
      WY_STATUTES,
      STATUTE_FROM,
    ),
    fromDated<PublishedAbsence>(
      {
        subject: 'permitDimensionalEnvelope',
        statement:
          'Wyoming charges an oversize surcharge this engine does not price: W.S. 31-18-804 adds "three cents ($.03) for each foot or fraction thereof for each mile traveled on the highways" where a load exceeds 15 ft in width, 15 ft in height, or 75 ft of single-vehicle length. The statute says the fee is computed "in excess of the above limitation" — SINGULAR, against three thresholds — and never states how a load over two of them is charged. A load 2 ft over on width and 3 ft over on height could owe five foot-miles, three, or two separate charges.',
        consequence:
          'The surcharge is stated on the quote with its formula and left out of the headline figure, rather than encoded against one reading of an ambiguity Wyoming has not resolved. The magnitude supports that: at 16 ft wide across 300 Wyoming miles it is $9 on every reading, inside the $50 materiality threshold. It only becomes material far above the thresholds — 10 ft over across 300 miles is $90 — and those loads are already in manual review for the escort gap.',
      },
      WY_STATUTES,
      STATUTE_FROM,
    ),
    fromDated<PublishedAbsence>(
      {
        subject: 'superloadFee',
        statement:
          'Above 125 tons Wyoming stops publishing a price. Chapter 5 § 5-6(c): permits for loads exceeding 250,000 lb "may require additional analysis to determine routing, structure, and highway capabilities to withstand the load. Permits shall not be issued until the permit holder has paid all costs the Department incurs to process the permit. These costs shall include amounts spent analyzing routes and THE COST OF SENDING PERSONNEL TO ACCOMPANY LOAD MOVEMENT."',
        consequence:
          'No figure is quoted above 250,000 lb beyond the ordinary $25 plus ton-mile charge, and the open-ended cost recovery is stated instead. Note the last limb: the cost of departmental personnel accompanying the load is an escort charge in everything but name, it has no published rate, and it compounds the escort gap above.',
      },
      WY_ADMIN_CH5,
      STATUTE_FROM,
    ),
    fromDated<PublishedAbsence>(
      {
        subject: 'partialIncrementRule',
        statement:
          'Wyoming STATES its partial-increment rule on both variable charges, which most of this corpus does not: the overweight fee is "six cents ($.06) for each ton OR FRACTION THEREOF" and the oversize surcharge "three cents ($.03) for each foot OR FRACTION THEREOF".',
        consequence:
          'The ton-mile charge rounds UP to the next whole ton with no spread and no manual review. This row records that the rule was found and encoded, not that it is missing.',
      },
      WY_STATUTES,
      STATUTE_FROM,
    ),
  ],

  feesDependOnDistance: true,
};
