/**
 * WISCONSIN — oversize/overweight single-trip permit rules.
 *
 * THE ONE THING TO KNOW BEFORE READING ANY NUMBER HERE: WISCONSIN'S FEES
 * ABSORB, THEY DO NOT ADD.
 * ═══════════════════════════════════════════════════════════════════════════
 * Wis. Stat. § 348.25(8) states the relationship twice and in both directions:
 *
 *   (c) "if the vehicle or combination of vehicles exceeds width limitations or
 *       height limitations or both, NO FEE IN ADDITION to the fee under par.
 *       (a) 2. or 2m. ... shall be charged if the vehicle or combination of
 *       vehicles also exceeds length limitations."
 *   (d) "if the vehicle or combination of vehicles exceeds weight limitations,
 *       NO FEE IN ADDITION to the fee under par. (a) 3. or 4. ... shall be
 *       charged if the vehicle also exceeds length, width or height limitations
 *       or any combination thereof."
 *
 * A load that is over-length, over-width, over-height AND overweight pays the
 * WEIGHT fee alone. That is a MAX over a lattice, not a sum and not a
 * comparison, and the cost of getting it wrong is one-directional: an engine
 * that adds dimension fees OVERCHARGES every Wisconsin heavy-haul quote, on
 * every single one, by the whole size ladder. It is encoded as
 * `CombinedFeeRule.kind: 'absorption'` with the lattice as data.
 *
 * WisDOT's own MV2600 restates both rules in plain English inside its fee
 * chart's row labels — "Overwidth OR Overheight (may include Overlength)",
 * "Overweight (Includes any oversize)" — which is why the same lattice is on
 * file from two documents rather than one.
 *
 * THE SINGLE-TRIP OVERWEIGHT FEE IS DERIVED, NOT TABLED.
 * ------------------------------------------------------
 * § 348.25(8)(a)3. states no dollar figure at all. It sets the single-trip
 * overweight fee at "10 percent of the fee specified in par. (b) 3. for an
 * annual permit for the comparable gross weight, rounded to the nearest whole
 * dollar", and (b)3. is the annual ladder: $200 at or under 90,000 lb, $350
 * from there to 100,000 lb, and "$350 plus $100 for each 10,000-pound increment
 * OR FRACTION THEREOF" above it. Ten per cent of that ladder is $20 / $35 /
 * "$35 plus $10 per 10,000 lb or fraction thereof", and MV2600 publishes
 * exactly those numbers as a chart. The rows below carry BOTH: the statute rows
 * are marked as OUR arithmetic on the state's own multiplier, and the MV2600
 * rows are the state publishing the result. They agree, so the resolver reads
 * corroboration.
 *
 * "OR FRACTION THEREOF" IS EXPLICIT AND IT ROUNDS UP. Wisconsin is one of very
 * few states in this corpus that writes its partial-increment rule down, so
 * `incrementRounding: 'up'` here is the statute's word and not a default.
 *
 * WISCONSIN PUBLISHES NO DIMENSIONAL ESCORT TABLE — AT ALL.
 * --------------------------------------------------------
 * Trans 230, 250, 252, 254, 255, 320, MV2600 and MV2605 were all opened. The
 * only mandatory escort provisions in the single-trip chapter are:
 *
 *   - Trans 254.15(3), a LANE-POSITION rule — an escort accompanies a load
 *     "when any part of a vehicle or load extends beyond the left of the
 *     roadway centerline on 2-way roadways" or "beyond the left edge of the
 *     right hand lane on highways with more than 2 lanes". Whether a load
 *     crosses that line is a function of the segment's LANE WIDTH, which no
 *     quote holds and which no route class settles. It is carried as an
 *     ADVISORY, exactly as `DARK_RULES_FOR_WANT_OF_INPUT` records.
 *   - Trans 254.16(2): "All loads exceeding 16 feet in width shall have one or
 *     more properly equipped escorts." NOT ONE. NOT TWO. The state's only
 *     published dimensional escort trigger states a floor and nothing else, so
 *     it is `reviewRequired: { kind: 'countNotPublished', atLeast: 1 }` and the
 *     floor is billed.
 *
 * The "over 12 ft = one escort" numbers that circulate for Wisconsin appear
 * only on commercial permit-service sites. They are NOT adopted here.
 *
 * A BOUNDARY THAT DIFFERS BY PURPOSE, NOT BY DISAGREEMENT.
 * -------------------------------------------------------
 * Sixteen feet of width is Wisconsin's real "big load" line and it is written
 * FOUR times, three exclusive and one inclusive:
 *
 *   - Trans 254.08(4): "16 feet or wider" → 35 mph on unshouldered highways —
 *     INCLUSIVE.
 *   - Trans 254.16(2): "exceeding 16 feet" → escorts — EXCLUSIVE.
 *   - Trans 250.05(1)(a): "width exceeding 16 feet" → $10 region review fee —
 *     EXCLUSIVE.
 *   - Trans 254.12(1): "exceeding 16 feet" → barred from the interstate absent
 *     a special permit condition — EXCLUSIVE.
 *
 * At exactly 16 ft 0 in a Wisconsin load is speed-restricted and is NOT
 * escort-required, NOT review-fee-charged and MAY use the interstate. Each rule
 * below carries its own operator; none is normalised to the others.
 *
 * THE POLICE-ESCORT RATE IS UNKNOWN BY DESIGN, AND THAT IS A FINDING.
 * ------------------------------------------------------------------
 * Trans 320.05 publishes the FORMULA — duty hours, rate of pay, vehicle
 * mileage, mileage rate, meal allowance — and then defines "rate of pay" as a
 * figure set "by collective bargaining agreement or state of Wisconsin
 * compensation plan" and the allowances by reference to the department's
 * internal transportation administrative manual, TAM 8-6, which is not
 * published on the web. So the rate is not missing from our research; it is
 * absent from Wisconsin's published law. The one hard number in the scheme is
 * the $100 late-cancellation surcharge in Trans 320.03(15).
 *
 * WHAT IS DELIBERATELY EMPTY OR ABSENT
 * ------------------------------------
 *   - `legalLimits.trailerLengthIn` is EMPTY. Wisconsin caps a single vehicle
 *     at 45 ft and a two-vehicle combination at 70 ft and states no semitrailer
 *     figure; the 75 ft truck-tractor/semitrailer row WisDOT publishes is
 *     attributed to ch. Trans 276, which was not opened (UNKNOWN 11). Recording
 *     45 ft here would flag every ordinary 53 ft trailer in the state as
 *     over-length. The empty list is the honest gap and it goes to review.
 *   - `legalLimits.rearOverhangIn` is EMPTY for the same reason: §§ 348.05 to
 *     348.10 were read in full and contain no rear-overhang limit. Wisconsin
 *     appears to regulate it through overall length plus a 4 ft marking duty.
 *     Recorded as UNKNOWN, never as "none".
 *   - `superload.grossWeight` is ABSENT. The word "superload" appears nowhere
 *     in ch. 348, Trans 250/252/254/255, MV2600 or MV2605. Three separate
 *     thresholds do heavy-load work and they do not coincide — width over
 *     16 ft, gross over 150,000 lb, length over 100 ft with a non-steered rear
 *     support — and synthesising one flag from them would invent a category the
 *     state does not have. See `publishedAbsences`.
 *   - `routeAnalysisFeeUsd` and `noBridgeRouteFeeUsd` are EMPTY. Wisconsin's
 *     analogue is the Trans 250.05(1)(b) bridge review at "$10 per hour for
 *     each employee-hour or fraction thereof", and the number of hours is
 *     unknowable before the review happens. A fee whose multiplicand is unknown
 *     is not a fee we can put a figure against.
 *
 * ROUTE VOCABULARY. § 348.15(1) and § 348.16 classify every highway as class
 * "A" or class "B", and class B is MULTIPLICATIVE: "no person ... shall operate
 * on a class 'B' highway any vehicle ... imposing wheel, axle, group of axles,
 * or gross weight on the highway exceeding 60 percent of the weights authorized
 * in s. 348.15 (3)". The factor is the published fact, so the factor is what is
 * stored (`RouteClassLimitScale`), not the arithmetic result. NOTE that
 * `scaledLimit` is capability in `routeContext.ts` and the engine's legal-limit
 * check does not yet apply it — a class B move is therefore currently judged
 * against the class A numbers, which is the CONSERVATIVE direction (it
 * under-reports over-weight, never over-reports) and is stated here rather than
 * left to be discovered.
 *
 * DATE DISCIPLINE
 * ---------------
 *   - Wis. Stat. ch. 348 carries "2023-24 Wisconsin Statutes updated through
 *     2025 Wis. Act 247 ... in effect on September 4, 2026", so `revisedOn` is
 *     2026-09-04 — the compilation certified the day before retrieval.
 *   - Every Trans chapter PDF carries "Register November 2024 No. 827". That is
 *     the PUBLICATION date of the chapter and not a substantive revision: Trans
 *     250 and 252 are 1983/1989 rules, Trans 254 and 255 are 1990 rules, and
 *     Trans 230 dates from 1962. `revisedOn` is 2024-11-01 with the History
 *     dates recorded in each row's note.
 *   - MV2600 is "MV2600 6/2021" and MV2605 is "MV2605 7/2024" from the printed
 *     form-number stamps. BOTH files carry a PDF modDate of 2026-02-13, which
 *     is a re-render stamp and is not used.
 *   - The WisDOT ASPX pages carry no date at all, so `revisedOn` is null and
 *     `effectiveFrom` is the retrieval date. We know what those pages said on
 *     2026-09-05; we cannot defend what they said in 2024.
 */
import type { SourceDoc, Sourced } from '../provenance.js';
import { ftIn, type EscortRule } from '../escortRules.js';
import type { RouteVocabulary } from '../routeContext.js';
import type {
  CombinedFeeRule,
  JurisdictionOsowRules,
  OversizeFeeBand,
  OverweightPricing,
  PublishedAbsence,
  Threshold,
  TransactionFee,
  WeightBand,
} from '../types.js';

const RETRIEVED = '2026-09-05';

// ── Source documents ──────────────────────────────────────────────────────

const WIS_STAT_348: SourceDoc = {
  id: 'wi-stat-ch348-2026-09-04',
  title: 'Wis. Stat. ch. 348 — Vehicles: size, weight and load',
  url: 'https://docs.legis.wisconsin.gov/statutes/statutes/348.pdf',
  publisher: 'Wisconsin Legislative Reference Bureau',
  revisedOn: '2026-09-04',
  retrievedOn: RETRIEVED,
  cite: '"2023-24 Wisconsin Statutes updated through 2025 Wis. Act 247 ... in effect on September 4, 2026. Published and certified under s. 35.18."',
};

const WISDOT_PERMIT_REQ: SourceDoc = {
  id: 'wisdot-osow-permit-requirements',
  title: 'WisDOT — Oversize/overweight permit requirements',
  url: 'https://wisconsindot.gov/Pages/dmv/com-drv-vehs/mtr-car-trkr/osow-permit-req.aspx',
  publisher: 'Wisconsin Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'undated ASPX page; no revision stamp anywhere on it',
};

const MV2600: SourceDoc = {
  id: 'wisdot-mv2600-2021-06',
  title: 'WisDOT MV2600 — Single Trip Permit Application (fee chart)',
  url: 'https://wisconsindot.gov/Documents/formdocs/mv2600.pdf',
  publisher: 'Wisconsin Department of Transportation',
  revisedOn: '2021-06-01',
  retrievedOn: RETRIEVED,
  cite: 'printed form stamp "MV2600 6/2021"; the PDF modDate of 2026-02-13 is a re-render, not a revision',
};

const MV2605: SourceDoc = {
  id: 'wisdot-mv2605-2024-07',
  title: 'WisDOT MV2605 — Single Trip Permit General Conditions',
  url: 'https://wisconsindot.gov/Documents/formdocs/mv2605.pdf',
  publisher: 'Wisconsin Department of Transportation',
  revisedOn: '2024-07-01',
  retrievedOn: RETRIEVED,
  cite: 'printed form stamp "MV2605 7/2024"',
};

const TRANS_230: SourceDoc = {
  id: 'wi-adm-trans-230',
  title: 'Wis. Admin. Code ch. Trans 230 — General permit provisions',
  url: 'https://docs.legis.wisconsin.gov/code/admin_code/trans/230.pdf',
  publisher: 'Wisconsin Department of Transportation',
  revisedOn: '2024-11-01',
  retrievedOn: RETRIEVED,
  cite: 'page footer "Register November 2024 No. 827" — a publication stamp; the chapter dates from 1962 with its last recorded amendments in the 1970s',
};

const TRANS_250: SourceDoc = {
  id: 'wi-adm-trans-250',
  title: 'Wis. Admin. Code ch. Trans 250 — Permit fees',
  url: 'https://docs.legis.wisconsin.gov/code/admin_code/trans/250.pdf',
  publisher: 'Wisconsin Department of Transportation',
  revisedOn: '2024-11-01',
  retrievedOn: RETRIEVED,
  cite: 'page footer "Register November 2024 No. 827"; rule text created Register September 1983 No. 333, eff. 1983-10-01',
};

const TRANS_252: SourceDoc = {
  id: 'wi-adm-trans-252',
  title: 'Wis. Admin. Code ch. Trans 252 — Escort vehicles',
  url: 'https://docs.legis.wisconsin.gov/code/admin_code/trans/252.pdf',
  publisher: 'Wisconsin Department of Transportation',
  revisedOn: '2024-11-01',
  retrievedOn: RETRIEVED,
  cite: 'page footer "Register November 2024 No. 827"; rule created Register June 1989 No. 402, eff. 1989-07-01',
};

const TRANS_254: SourceDoc = {
  id: 'wi-adm-trans-254',
  title: 'Wis. Admin. Code ch. Trans 254 — Single trip permits',
  url: 'https://docs.legis.wisconsin.gov/code/admin_code/trans/254.pdf',
  publisher: 'Wisconsin Department of Transportation',
  revisedOn: '2024-11-01',
  retrievedOn: RETRIEVED,
  cite: 'page footer "Register November 2024 No. 827"; rule created Register December 1990 No. 420, eff. 1991-01-01',
};

const TRANS_320: SourceDoc = {
  id: 'wi-adm-trans-320',
  title: 'Wis. Admin. Code ch. Trans 320 — Fees for State Patrol escort services',
  url: 'https://docs.legis.wisconsin.gov/code/admin_code/trans/320.pdf',
  publisher: 'Wisconsin Department of Transportation, Division of State Patrol',
  revisedOn: '2024-11-01',
  retrievedOn: RETRIEVED,
  cite: 'page footer "Register November 2024 No. 827"; rule created Register May 2000 No. 533, eff. 2000-06-01',
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

/** A row from an UNDATED page: effective only from the day we read it. */
function fromUndatedPage<T>(value: T, source: SourceDoc, note?: string): Sourced<T> {
  return {
    value,
    source,
    effectiveFrom: RETRIEVED,
    effectiveTo: null,
    ...(note === undefined ? {} : { note }),
  };
}

const STATUTE_FROM = '2026-09-04';
const TRANS_FROM = '2024-11-01';

const fromStatute = <T>(value: T, note?: string): Sourced<T> =>
  fromDated(value, WIS_STAT_348, STATUTE_FROM, note);

// ── Route vocabulary — class "A" / class "B" ──────────────────────────────

/**
 * Wisconsin's own road classification, and the only MULTIPLICATIVE one in the
 * corpus. § 348.16(2) does not restate class B's weights; it states a
 * percentage of the class A figures, so the percentage is what is held.
 */
const WISCONSIN_ROUTE_VOCABULARY: RouteVocabulary = {
  name: 'Wis. Stat. §§ 348.15–348.16 highway classes',
  explanation:
    'Wisconsin classifies every highway as class "A" or class "B". Class A is the default and carries the § 348.15(3) weights; class B is designated by local authorities under § 349.15 and carries 60 percent of them. The interstate system and the Milwaukee county expressway system are named separately in Trans 230 and Trans 254 for DIMENSIONAL conditions, and are held here as classes so a rule written against them can be evaluated.',
  classes: [
    {
      id: 'WI:class-a',
      publishedName: 'class "A" highway',
      quote:
        '348.15(1): "Class \'A\' highway" includes all state trunk highways and connecting highways and those county trunk highways, town highways and city and village streets, or portions thereof, that have not been designated as class "B" highways pursuant to s. 349.15.',
      generalEquivalents: ['divided', 'two-lane', 'multilane-undivided', 'urban'],
    },
    {
      id: 'WI:class-b',
      publishedName: 'class "B" highway',
      quote:
        '348.16(2): "no person, without a permit therefor, shall operate on a class \'B\' highway any vehicle or combination of vehicles imposing wheel, axle, group of axles, or gross weight on the highway exceeding 60 percent of the weights authorized in s. 348.15 (3)."',
      limitScale: {
        factor: 0.6,
        appliesTo: ['grossWeightLbs', 'singleAxleLbs', 'tandemAxleLbs'],
        quote:
          '§ 348.16(2): "exceeding 60 percent of the weights authorized in s. 348.15 (3)". Exclusive — a load AT 60 percent is legal.',
      },
    },
    {
      id: 'WI:interstate',
      publishedName: 'national system of interstate and defense highways under s. 84.29',
      quote:
        'Trans 254.12(1): "No vehicle, vehicle combination, or load exceeding 16 feet in width may be operated or transported upon any portion of the national system of interstate and defense highways unless the permit contains a special condition authorizing movement with a greater width upon the interstate highway system."',
      generalEquivalents: ['interstate'],
    },
    {
      id: 'WI:milwaukee-county-expressway',
      publishedName: 'Milwaukee county expressway system',
      quote:
        'Trans 254.12(2): "No permit allowing the dimensions of a vehicle or load to exceed 14 feet in width, 14 1/2 feet in height or 150 feet in length is valid on any part of the Milwaukee county expressway system constructed pursuant to s. 59.84, Stats., except on U.S. highway 45 between West Florist Avenue and West Hampton Avenue and on interstate highway 94 between the Waukesha county line and 108th Street."',
    },
  ],
};

// ── Escort rules ──────────────────────────────────────────────────────────

function escortRule(
  id: string,
  description: string,
  when: EscortRule['when'],
  then: EscortRule['then'],
  source: SourceDoc,
  effectiveFrom: string = TRANS_FROM,
): EscortRule {
  return {
    id,
    jurisdiction: 'WI',
    description,
    when,
    then,
    source,
    effectiveFrom,
    effectiveTo: null,
  };
}

export const WISCONSIN_ESCORT_RULES: EscortRule[] = [
  /**
   * THE STATE'S ONLY PUBLISHED DIMENSIONAL ESCORT TRIGGER, AND IT PUBLISHES NO
   * COUNT. "One or more properly equipped escorts" is neither one nor two: it
   * is a floor with an open top, which is exactly `countNotPublished`. The
   * floor of one is BILLED, because "one or more" costs at least one escort's
   * worth of money and a quote showing zero beside a firing rule is wrong in
   * the direction that costs the customer at the scale house.
   */
  escortRule(
    'wi-width-over-16',
    'Over 16 ft wide — one or more escorts; Wisconsin publishes no count',
    { kind: 'gt', measure: 'widthIn', value: ftIn(16) },
    {
      reviewRequired: {
        kind: 'countNotPublished',
        atLeast: 1,
        quote: 'All loads exceeding 16 feet in width shall have one or more properly equipped escorts.',
      },
    },
    TRANS_254,
  ),
  /**
   * THE LANE-POSITION RULE. Trans 254.15(3) is Wisconsin's other mandatory
   * escort provision and it is keyed to where the load sits in the lane, not to
   * how wide it is: a 13 ft load is escort-free in a 12 ft lane with a wide
   * shoulder and escorted in a 10 ft one. Nothing on a quote settles it and no
   * route class settles it either, so it is an ADVISORY — the price stands and
   * the exclusion is stated. Making it a `subjective` condition would send
   * every over-width Wisconsin quote to a human over a question a dispatcher
   * usually cannot answer from a desk.
   */
  escortRule(
    'wi-lane-position-escort-advisory',
    'Escort required by lane position — Trans 254.15(3), not by a width number',
    { kind: 'gt', measure: 'widthIn', value: 102 },
    {
      advisory:
        'Wisconsin\'s mandatory escort rule below 16 ft of width is positional, not dimensional: Trans 254.15(3) requires "a properly equipped escort vehicle ... when any part of a vehicle or load extends beyond the left of the roadway centerline on 2-way roadways" or "beyond the left edge of the right hand lane on highways with more than 2 lanes". Whether this load crosses that line depends on the lane width of each segment, which this quote does not hold, so no escort is priced for it. Where one is required the count is one (Trans 252.04(5)-(6) place it in front on a 2-way undivided road and behind on a one-way or divided one, so the cost is the same either way).',
    },
    TRANS_254,
  ),
  /**
   * THE INCLUSIVE HALF OF THE 16 FT BOUNDARY. Trans 254.08(4) reads "16 feet or
   * wider" where the escort, review-fee and interstate rules all read
   * "exceeding 16 feet". At exactly 16 ft 0 in this rule fires and those do not.
   * It costs nothing and it is not an escort, so it is an advisory — but it is
   * encoded against its OWN operator rather than normalised to the others.
   */
  escortRule(
    'wi-speed-16ft-or-wider',
    'Width 16 ft or wider — 35 mph limit on highways without paved shoulders',
    { kind: 'gte', measure: 'widthIn', value: ftIn(16) },
    {
      advisory:
        'Trans 254.08(4): "The maximum speed of any vehicle with a load 16 feet or wider operating on highways without paved shoulders shall be 35 miles per hour." Note the operator — this rule is INCLUSIVE at 16 ft where Trans 254.16(2) (escorts), Trans 250.05(1)(a) (the region review fee) and Trans 254.12(1) (interstate access) are all EXCLUSIVE. A load of exactly 16 ft 0 in is speed-restricted and is not escort-required. The delay this causes is not priced here.',
    },
    TRANS_254,
  ),
  /**
   * TWO CURRENT CHAPTERS SET THE INTERSTATE DIMENSIONAL GATE FOUR FEET APART,
   * AND BOTH CARRY THE SAME REGISTER STAMP. Trans 230(3)(e)23. bars anything
   * over 12 ft wide or 13 1/2 ft high from the interstate absent a special
   * permit condition; Trans 254.12(1) sets the same gate at 16 ft of width and
   * says nothing about height. Trans 230 is the older chapter and has never
   * been repealed. The rule fires only when the load is actually over the lower
   * figure AND on the interstate, so a 10 ft load hears nothing — and a quote
   * that has not said which road it runs on leaves it undecided rather than
   * clear.
   */
  escortRule(
    'wi-interstate-dimensional-gate-conflict',
    'Interstate access above 12 ft wide or 13 ft 6 in high — two current chapters disagree',
    {
      kind: 'all',
      of: [
        { kind: 'context', of: { kind: 'routeClassIn', anyOf: ['WI:interstate'] } },
        {
          kind: 'any',
          of: [
            { kind: 'gt', measure: 'widthIn', value: ftIn(12) },
            { kind: 'gt', measure: 'heightIn', value: ftIn(13, 6) },
          ],
        },
      ],
    },
    {
      manualReview:
        'Wisconsin\'s own administrative code sets the interstate dimensional gate twice and four feet apart. Trans 230(3)(e)23.: "no vehicle or combination of vehicle and load exceeding 13 1/2 feet in height, or 12 feet in width ... may be operated or transported upon any completed portion of the interstate highway system unless the permit contains a special and specific condition authorizing movement under the permit with a greater height or width". Trans 254.12(1) sets the same gate at "exceeding 16 feet in width" and states no height at all. Both carry the November 2024 Register stamp; Trans 230 dates from 1962 and Trans 254 from 1990, and neither has been withdrawn. Whether this move needs a special interstate condition cannot be determined from the published rules.',
    },
    TRANS_230,
  ),
  /**
   * A PERMIT WISCONSIN WILL NOT ISSUE. Trans 254.05(5) is a refusal, not a
   * price, and it turns on whether the rear support is separately steered —
   * which no quote states.
   */
  escortRule(
    'wi-length-over-100ft-rear-support',
    'Over 100 ft overall with the rear supporting axle at or near the rear of the load',
    { kind: 'gt', measure: 'overallLengthIn', value: ftIn(100) },
    {
      manualReview:
        'Trans 254.05(5): "An issuing authority may not issue a permit for a vehicle and load exceeding 100 feet in overall length when the rear supporting axle is at or near the rear of the load unless the rear support is separately steered." § 348.26(3) adds "No permit shall be issued for any train exceeding 100 feet in total length." Whether this combination\'s rear support is separately steered is not stated on a quote, so whether Wisconsin will issue a permit at all cannot be determined here.',
    },
    TRANS_254,
  ),
  /**
   * A REAL FEE WHOSE MULTIPLICAND IS UNKNOWABLE IN ADVANCE. Trans 250.05(1)(a)
   * charges $10 per WisDOT region the load is routed through, and neither the
   * rule nor any WisDOT page states how many regions exist or which a route
   * crosses (UNKNOWN 7). Trans 320.02(13m) gives the STATE PATROL five regions,
   * which is a different agency's map.
   */
  escortRule(
    'wi-region-review-fee-over-16ft',
    'Over 16 ft wide — a $10-per-region route review fee whose region count is not published',
    { kind: 'gt', measure: 'widthIn', value: ftIn(16) },
    {
      manualReview:
        'Trans 250.05(1)(a): "For each single trip permit for a width exceeding 16 feet, a region review fee of $10 for each region through which the load is routed to cover the costs incurred by the region office in reviewing the adequacy of the route for the proposed move." The number of WisDOT regions a route crosses is not published in the rule or on any WisDOT page opened, so this fee cannot be computed and is NOT included in the total above. Trans 250.05(2) charges it "regardless of whether a permit is issued or denied".',
    },
    TRANS_250,
  ),
  /**
   * WISCONSIN'S NEAREST ANALOGUE TO A SUPERLOAD REVIEW FEE, and the reason the
   * state has no superload FEE row: the charge is per employee-hour and the
   * hours are not knowable before the review is done.
   */
  escortRule(
    'wi-bridge-review-over-150000',
    'Over 150,000 lb gross — a bridge review at $10 per employee-hour, hours not knowable in advance',
    { kind: 'gt', measure: 'grossWeightLbs', value: 150_000 },
    {
      manualReview:
        'Trans 250.05(1)(b): "For each single trip permit for a gross weight exceeding 150,000 pounds, a bridge review fee of $10 per hour for each employee-hour or fraction thereof required to review the adequacy of the bridges to support the proposed load." The partial-increment rule is explicit and rounds UP, but the NUMBER of employee-hours is set by the review itself and is not published, so this charge cannot be quoted and is not included in the total above. Trans 250.11 makes a bridge or region review valid for 90 days for the same applicant, same route and no greater size or weight — repeat lanes may not owe it twice, which this engine cannot yet track.',
    },
    TRANS_250,
  ),
  /**
   * POLICE ESCORTS: DISCRETIONARY, WITH A PUBLISHED FORMULA AND UNPUBLISHED
   * INPUTS. This is a positive finding, not a research gap — see the module
   * header and `NO_PUBLISHED_POLICE_ESCORT_RATE`.
   */
  escortRule(
    'wi-police-escort-formula-without-inputs',
    'Police escort — discretionary, with a published formula and no published rate',
    {
      kind: 'any',
      of: [
        { kind: 'gt', measure: 'widthIn', value: 102 },
        { kind: 'gt', measure: 'heightIn', value: ftIn(13, 6) },
        { kind: 'gt', measure: 'overallLengthIn', value: ftIn(70) },
      ],
    },
    {
      advisory:
        'Wisconsin may require a traffic-officer escort on any permitted move — § 348.26(2): "Whenever the officer or agency issuing such permit deems it necessary to have a traffic officer escort the vehicle through the municipality or county, a reasonable fee for such traffic officer\'s services shall be paid by the permittee." No width, height, length or weight number triggers it. Trans 320.05 publishes the FEE FORMULA — "(a) Duty hours. (b) Rate of pay. (c) Vehicle mileage. (d) Mileage rate. (e) Meal allowance." — but its inputs are not published: Trans 320.02(13) defines the rate of pay as an officer\'s average hourly wage "as determined by collective bargaining agreement or state of Wisconsin compensation plan", and the meal and lodging allowances by reference to the department\'s internal manual TAM 8-6, which is available only by writing to the Division of State Patrol. A Wisconsin police-escort cost is therefore billed in arrears and is EXCLUDED from this quote. The one fixed number in the scheme is a $100 surcharge for cancelling with under 24 hours\' notice (Trans 320.03(15)); the State Patrol also requires 48 hours\' notice to schedule.',
    },
    TRANS_320,
  ),
  /**
   * Trans 252.03(1) and (3) are the discretionary hook, quoted so a reader can
   * see that "unusually wide" is the whole of the standard.
   */
  escortRule(
    'wi-discretionary-escorts',
    'Additional escorts at the issuing authority\'s discretion — no numeric trigger',
    { kind: 'gt', measure: 'widthIn', value: 102 },
    {
      advisory:
        'Trans 252.03(1): "The department or local authority issuing a permit may require the use of an escort vehicle, or escort vehicles, as a condition of operation under any oversize or overweight permit." Trans 252.03(3) adds that escorts, "including police escort vehicles, may be required ... for unusual conditions such as extremely winding or hilly roads or where traffic is very heavy or when the permitted vehicle or load is unusually wide". "Unusually wide" is not a number and is not priced here. Trans 252.03(4) also requires "a separate escort ... for each load being transported", which rules out sharing one escort across a convoy.',
    },
    TRANS_252,
  ),
  /**
   * The overhead-notification duty attaches at the ordinary over-height line,
   * not at a higher special threshold — worth stating because most states set a
   * separate, higher number for it.
   */
  escortRule(
    'wi-overheight-utility-notification',
    'Over 13 ft 6 in high — prior notice to the owners of overhead wires and cables',
    { kind: 'gt', measure: 'heightIn', value: ftIn(13, 6) },
    {
      advisory:
        'Trans 254.15(2): "When a vehicle operating under a permit is overheight, the permittee shall give prior notice to the owners of overhead wires, cables, or other facilities which may be affected." The trigger is simply being over-height — Wisconsin sets no separate, higher notification threshold. MV2605 condition 8 makes the permittee responsible for evaluating the route and for "all costs associated with removal, adjustment, replacement and any other accommodation required for any obstructions". Those third-party costs are unquantified and are not included in this quote. NO HEIGHT-POLE REQUIREMENT was located in ch. Trans 252 or anywhere else in the sources opened; that is recorded as UNKNOWN, not as "no pole required".',
    },
    TRANS_254,
  ),
];

// ── The oversize fee ladder ───────────────────────────────────────────────

/**
 * § 348.25(8)(a) 1., 2. and 2m., encoded as four MUTUALLY EXCLUSIVE bands.
 *
 * The exclusivity is what makes the width/height-absorbs-length rule of
 * § 348.25(8)(c) visible in the data rather than only in the combinator: the
 * $20 and $25 bands place NO ceiling on length, because the statute charges
 * nothing extra for length once width or height is over — which is precisely
 * what MV2600's row labels say in English, "(may include Overlength)".
 *
 * The $15 band is the one that must exclude both width and height, because
 * (a)1. is "a vehicle ... which exceeds LENGTH limitations" and (a)2. takes
 * over the moment width or height goes over.
 */
const OVERSIZE_LADDER: OversizeFeeBand[] = [
  {
    label: 'over width AND over height (any length) — § 348.25(8)(a)2m.',
    overWidthIn: { value: 102, inclusive: false },
    overHeightIn: { value: ftIn(13, 6), inclusive: false },
    feeUsd: 25,
  },
  {
    label: 'over width, not over height (any length) — § 348.25(8)(a)2.',
    overWidthIn: { value: 102, inclusive: false },
    upToHeightIn: { value: ftIn(13, 6), inclusive: false },
    feeUsd: 20,
  },
  {
    label: 'over height, not over width (any length) — § 348.25(8)(a)2.',
    overHeightIn: { value: ftIn(13, 6), inclusive: false },
    upToWidthIn: { value: 102, inclusive: false },
    feeUsd: 20,
  },
  {
    label: 'over length only — § 348.25(8)(a)1.',
    overLengthIn: { value: ftIn(70), inclusive: false },
    upToWidthIn: { value: 102, inclusive: false },
    upToHeightIn: { value: ftIn(13, 6), inclusive: false },
    feeUsd: 15,
  },
];

const oversizeFeeBands: Sourced<OversizeFeeBand>[] = [
  ...OVERSIZE_LADDER.map((band) =>
    fromStatute<OversizeFeeBand>(
      band,
      '§ 348.25(8)(a): "1. For a vehicle or combination of vehicles which exceeds length limitations, $15. 2. For a vehicle or combination of vehicles which exceeds either width limitations or height limitations, $20. ... 2m. For a vehicle or combination of vehicles which exceeds both width and height limitations, $25." The band places no ceiling on length above $20 because § 348.25(8)(c) charges nothing more for length once width or height is over.',
    ),
  ),
  ...OVERSIZE_LADDER.map((band) =>
    fromDated<OversizeFeeBand>(
      band,
      MV2600,
      '2021-06-01',
      'MV2600 fee chart: "Overlength Only $15.00 / Overwidth OR Overheight (may include Overlength) 20.00 / Overwidth AND Overheight (may include Overlength) 25.00". MV2600 states the classification and the amount; the dimensional thresholds it is applied against come from §§ 348.05-348.07.',
    ),
  ),
];

// ── The derived overweight ladder ─────────────────────────────────────────

/**
 * TEN PER CENT OF THE ANNUAL LADDER, ROUNDED TO THE NEAREST WHOLE DOLLAR.
 *
 * The statute rows below are OUR arithmetic on the state's own multiplier and
 * say so; the MV2600 rows are Wisconsin publishing the result. They agree at
 * every band, which is why this reads as corroboration and not as one source
 * disagreeing with itself.
 */
const OVERWEIGHT_LADDER: WeightBand[] = [
  { minLbs: 0, maxLbs: 90_000, feeUsd: 20 },
  { minLbs: 90_001, maxLbs: 100_000, feeUsd: 35 },
  {
    minLbs: 100_001,
    maxLbs: null,
    feeUsd: 35,
    perIncrementUsd: 10,
    incrementLbs: 10_000,
    incrementBaseLbs: 100_000,
    incrementRounding: 'up',
  },
];

const overweightBands: Sourced<WeightBand>[] = [
  ...OVERWEIGHT_LADDER.map((band) =>
    fromStatute<WeightBand>(
      band,
      'DERIVED, and the derivation is the state\'s: § 348.25(8)(a)3. sets the single-trip overweight fee at "10 percent of the fee specified in par. (b) 3. for an annual permit for the comparable gross weight, rounded to the nearest whole dollar", and (b)3. reads "a. If the gross weight is 90,000 pounds or less, $200. b. If the gross weight is more than 90,000 pounds but not more than 100,000 pounds, $350. c. If the gross weight is greater than 100,000 pounds, $350 plus $100 for each 10,000-pound increment or fraction thereof by which the gross weight exceeds 100,000 pounds." Ten per cent of $200/$350/$350+$100 is the $20/$35/$35+$10 held here. The statute states no single-trip dollar figure of its own.',
    ),
  ),
  ...OVERWEIGHT_LADDER.map((band) =>
    fromDated<WeightBand>(
      band,
      MV2600,
      '2021-06-01',
      'MV2600 fee chart, published as arithmetic: "Overweight (Includes any oversize) 0 - 90,000 lbs. $20.00 / 90,001 - 100,000 lbs. 35.00 / 100,001 - 110,000 lbs. 45.00 / 110,001 - 120,000 lbs. 55.00 / 120,001 - 130,000 lbs. 65.00 / 130,001 - 140,000 lbs. 75.00 / 140,001 - 150,000 lbs. 85.00 / 150,001 - and up 85.00 plus $10.00 per 10,000 lbs. or fraction thereof". SUB-POUND DIVERGENCE, recorded and immaterial in whole pounds: the statute\'s first band is "90,000 pounds or less" and its second is "more than 90,000", so 90,000.5 lb is in the second band; MV2600 writes "0 - 90,000" and "90,001 - 100,000", so the same weight is in neither. The bands here follow the whole-pound reading both documents share.',
    ),
  ),
];

// ── The absorption lattice ────────────────────────────────────────────────

const WISCONSIN_ABSORPTION: CombinedFeeRule = {
  kind: 'absorption',
  absorption: [
    {
      absorber: 'width',
      absorbs: ['length'],
      quote:
        '§ 348.25(8)(c): "if the vehicle or combination of vehicles exceeds width limitations or height limitations or both, no fee in addition to the fee under par. (a) 2. or 2m., (b) 2. or (bm) shall be charged if the vehicle or combination of vehicles also exceeds length limitations."',
    },
    {
      absorber: 'height',
      absorbs: ['length'],
      quote:
        '§ 348.25(8)(c), the same sentence read from the height side: the width-or-height fee stands alone and the length fee is not charged in addition to it.',
    },
    {
      absorber: 'overweight',
      absorbs: ['oversize', 'width', 'height', 'length'],
      quote:
        '§ 348.25(8)(d): "if the vehicle or combination of vehicles exceeds weight limitations, no fee in addition to the fee under par. (a) 3. or 4., (b) 3., 4., or 4m., or (bm) shall be charged if the vehicle also exceeds length, width or height limitations or any combination thereof."',
    },
  ],
  explanation:
    'Wisconsin\'s permit fee is a MAXIMUM over a two-level lattice, not a sum: the width-or-height fee absorbs the length fee, and the weight fee absorbs every size fee. A load that is over-length, over-width, over-height AND overweight pays the weight fee alone.',
};

// ── The jurisdiction ──────────────────────────────────────────────────────

export const WISCONSIN_OSOW_RULES: JurisdictionOsowRules = {
  code: 'WI',
  name: 'Wisconsin',
  country: 'US',

  routeVocabulary: [
    fromStatute<RouteVocabulary>(
      WISCONSIN_ROUTE_VOCABULARY,
      'Class A and class B are statutory (§§ 348.15(1), 348.16(2)); the interstate and Milwaukee-expressway classes are named by Trans 230(3)(e) and Trans 254.12 and are held here so a rule written against them can be evaluated.',
    ),
  ],

  legalLimits: {
    widthIn: [
      fromStatute(
        102,
        '§ 348.05(1): "No person without a permit therefor shall operate on a highway any vehicle having a total width in excess of 8 feet 6 inches". EXCLUSIVE — 8 ft 6 in exactly is legal. § 348.05(2) also grants 9 ft to pipeline/utility pole-and-pipe hauls (carrier-identity conditioned, not collected on a quote) and 12 ft to baled hay and, from 15 September to 15 December, Christmas trees within a single traffic lane and off the interstate. Neither is applied.',
      ),
      fromUndatedPage(
        102,
        WISDOT_PERMIT_REQ,
        'WisDOT: "A permit is typically required if vehicle dimensions exceed: ... Width 8 feet, 6 inches". Corroborates the statute; the page carries no revision stamp, so this row starts on the retrieval date.',
      ),
    ],
    heightIn: [
      fromStatute(
        ftIn(13, 6),
        '§ 348.06(1): "no person, without a permit therefor, may operate on a highway any motor vehicle, mobile home, recreational vehicle, trailer, or semitrailer having an overall height in excess of 13 1/2 feet." EXCLUSIVE. § 348.06(2) exempts implements of husbandry of any height; § 348.06(2m)(a) allows double-deck buses to 14 ft 5 in off the state trunk system, and the tail of that sentence was cut by a PDF page break, so the exact scope of that carve-out is UNKNOWN. Neither is applied.',
      ),
    ],
    /**
     * EMPTY, DELIBERATELY. Wisconsin caps a single vehicle at 45 ft
     * (§ 348.07(1)) and a two-vehicle combination at 70 ft, and states no
     * SEMITRAILER figure anywhere in the sources opened. WisDOT publishes a
     * third row — 75 ft for a truck-tractor and semitrailer — and attributes it
     * to ch. Trans 276, which was not opened. Recording 45 ft here would flag
     * every ordinary 53 ft trailer in the state as over-length; recording 70 ft
     * would restate the combination limit as a trailer limit. So the list is
     * empty, the engine says the figure is not on file, and the quote goes to
     * review — which is the honest answer to a gap the research names
     * (UNKNOWN 11).
     */
    trailerLengthIn: [],
    /**
     * THE 70-vs-75 FT DISAGREEMENT IS REAL AND IS LEFT UNRESOLVED. § 348.07(1)
     * caps a two-vehicle combination at 70 ft; WisDOT's own permit-requirements
     * page prints 75 ft for a truck/tractor and semitrailer in the same table
     * as the statewide 45 ft and 70 ft rows, with no route qualifier. The most
     * likely reconciliation is that 75 ft is a ch. Trans 276 designated-route
     * allowance under § 348.07(4) — but the page does not say so, Trans 276 was
     * not opened, and a 72 ft combination is over the statute and under the
     * agency. Neither is adopted.
     */
    overallLengthIn: [
      fromStatute(
        ftIn(70),
        '§ 348.07(1): "No person, without a permit therefor, may operate on a highway any single vehicle with an overall length in excess of 45 feet or any combination of 2 vehicles with an overall length in excess of 70 feet". EXCLUSIVE both ways. § 348.08(1)(a) then allows a saddlemount driveaway combination 97 ft on the interstate and on § 348.07(4) designated highways and 75 ft elsewhere — a clean per-route-class length limit, recorded and not applied because a quote does not state that it is a saddlemount driveaway.',
      ),
      fromUndatedPage(
        ftIn(75),
        WISDOT_PERMIT_REQ,
        'WisDOT: "Length - (Truck/tractor and semi trailer) 75 feet (see Trans 276 for more information and exceptions)". Printed in the same table as the statewide rows with no route qualifier. CONFLICT with § 348.07(1)\'s 70 ft, deliberately unresolved.',
      ),
    ],
    frontOverhangIn: [
      fromStatute(
        ftIn(3),
        '§ 348.10(1): "No person, without a permit therefor, may operate on a highway any vehicle or combination of vehicles with any load thereon extending more than 3 feet beyond the front of the foremost vehicle". EXCLUSIVE. The section carves out a carried vehicle with a crane or boom projecting more than 3 ft, but only while the TOTAL length stays inside the statutory limits.',
      ),
    ],
    /**
     * EMPTY, AND RECORDED AS UNKNOWN RATHER THAN AS "NONE". §§ 348.05 to 348.10
     * were read in full and contain no rear-overhang limit. Wisconsin appears
     * to regulate rear overhang through overall length (§ 348.07) plus a 4 ft
     * lamp-and-flag marking duty (Trans 254.10(1)(b), MV2605 #14/#16) — but
     * "appears to" is not a finding, and this is not the affirmative absence
     * Kansas and Nebraska publish.
     */
    rearOverhangIn: [],
    /**
     * THE TWO MOST-QUOTED WISCONSIN WEIGHT NUMBERS HAVE NO SCALAR STATUTORY
     * SOURCE, and that is worth saying rather than hiding. § 348.15(3) states
     * 11,000 lb per wheel and 20,000 lb per axle and then a TABLE — Figure
     * 348.15(3)(c) — of maximum gross weights by axle-group spacing and axle
     * count. 80,000 lb is that table's arithmetic maximum and 34,000 lb is its
     * cell for two consecutive axles at 4-8 ft. Only WisDOT states either as a
     * flat number, so only WisDOT is cited for them. This is the Michigan
     * situation in a milder form: the cap is the table's maximum, not a written
     * number.
     */
    grossWeightLbs: [
      fromUndatedPage(
        80_000,
        WISDOT_PERMIT_REQ,
        'WisDOT: "Maximum gross vehicle weights on all axles 80,000 lbs". § 348.15 states NO flat gross cap — ch. 348 was searched and the only "may not exceed 80,000" hits are inside the commodity paragraphs (bg)/(br)/(bv), each capping a commodity allowance rather than stating the general limit. 80,000 lb is the arithmetic maximum of Figure 348.15(3)(c). Source-authority mismatch, recorded.',
      ),
    ],
    singleAxleLbs: [
      fromStatute(
        20_000,
        '§ 348.15(3)(b): "The gross weight imposed on the highway by the wheels of any one axle may not exceed 20,000 pounds or, if the vehicle or combination of vehicles is an implement of husbandry or agricultural commercial motor vehicle ... 23,000 pounds. In addition, the gross weight imposed on the highway by the wheels of the steering axle of a truck tractor may not exceed 13,000 pounds unless the manufacturer\'s rated capacity of the axle and the tires is sufficient to carry the weight, but not to exceed 20,000 pounds." INCLUSIVE ("may not exceed"). The 13,000 lb steer figure and its conditional escalation to 20,000 turn on the manufacturer\'s rating, which a quote does not collect; the 23,000 lb agricultural figure turns on the commodity. Neither is applied. § 348.15(3)(a) additionally caps any one wheel at 11,000 lb.',
      ),
    ],
    tandemAxleLbs: [
      fromUndatedPage(
        34_000,
        WISDOT_PERMIT_REQ,
        'WisDOT: "Tandem axles 34,000 lbs". § 348.15(3)(c) states no flat tandem number — it sets Figure 348.15(3)(c), a table by spacing and axle count, whose value for two consecutive axles at 4-8 ft is 34,000 lb. Recorded from the agency page because the statute does not state it as a scalar.',
      ),
    ],
  },

  /**
   * A SOURCED ZERO, not a gap. § 348.25(8)(a) is a CLOSED list of four permit
   * fees — length, width-or-height, width-and-height, and weight — with no
   * separate issuance or processing charge on top, and MV2600's "PROCEDURE TO
   * CALCULATE FEES" adds none either. So the dimensional bands below carry the
   * whole oversize charge and this row records that nothing sits above them.
   * The engine suppresses the empty line rather than printing "$0.00" beside a
   * real fee.
   */
  permitBaseFeeUsd: [
    fromStatute(
      0,
      '§ 348.25(8)(a) lists four fees and no base: "the department shall charge the following fees for each permit issued under s. 348.26: 1. ... $15. 2. ... $20. 2m. ... $25. 3. ... 10 percent of the fee specified in par. (b) 3. ..." Nothing is charged in addition to whichever of the four applies. § 348.25(8)(f) does authorise a LOCAL issuing authority to charge its own issuance fee, and MV2605 condition 3 makes a local permit mandatory off the state trunk system — "A permit issued by the department is valid only on State, U.S. and Interstate highways" — but no amount is set by state law and none is collected here.',
    ),
    fromDated(
      0,
      MV2600,
      '2021-06-01',
      'MV2600\'s fee chart lists the four rows above and nothing else. Corroborates that Wisconsin charges no separate base.',
    ),
  ],

  oversizeFeeBands,

  combinedFeeRule: [
    fromStatute<CombinedFeeRule>(WISCONSIN_ABSORPTION),
    fromDated<CombinedFeeRule>(
      WISCONSIN_ABSORPTION,
      MV2600,
      '2021-06-01',
      'MV2600 restates § 348.25(8)(c) and (d) inside its own row labels: "Overwidth OR Overheight (may include Overlength)" and "Overweight (Includes any oversize)". Same lattice, in English, from the agency.',
    ),
  ],

  overweightPricing: [
    fromStatute<OverweightPricing>({
      kind: 'bands',
      explanation:
        '§ 348.25(8)(a)3. prices the single-trip overweight permit as "10 percent of the fee specified in par. (b) 3. for an annual permit for the comparable gross weight, rounded to the nearest whole dollar". Par. (b)3. is a flat-stepped gross-weight ladder with a $100-per-10,000-lb-or-fraction tail, so the single-trip fee is the same shape at a tenth of the money. There is no mileage component anywhere in the subsection.',
    }),
    fromDated<OverweightPricing>(
      {
        kind: 'bands',
        explanation:
          'MV2600 prints one flat amount per gross-weight band with no per-mile column, and a "$10.00 per 10,000 lbs. or fraction thereof" tail above 150,000 lb.',
      },
      MV2600,
      '2021-06-01',
    ),
  ],

  overweightBands,

  /** Wisconsin's single-trip permit has no distance-priced component at all. */
  overweightPerMile: [],

  /**
   * EMPTY. § 348.25(8)(a)4. does displace the weight fee with a flat $30 for a
   * sealed international-trade load under § 348.26(8), and § 348.25(8)(dm)
   * drops the single-trip fee to $5 while an annual permit is suspended for
   * highway protection. Both are conditioned on facts a quote does not state —
   * whether the load is a sealed international-trade shipment, and whether the
   * carrier holds a suspended annual — and `ConditionalFee` triggers on gross
   * weight alone, so neither can be expressed here without inventing a trigger.
   * Recorded, not applied.
   */
  conditionalFees: [],

  /**
   * A SOURCED ZERO. MV2600's fee procedure contains no percentage, convenience
   * or per-transaction charge — unlike Texas. UNKNOWN, recorded and not filled
   * in: MV2600 does say "All charges for the transmission of an application or
   * a permit, other than by U.S. Mail, are in addition to the permit fee and
   * are the responsibility of the applicant", and whether the wi.gotpermits.com
   * portal levies a card surcharge could not be checked because the portal is
   * login-gated. Any such charge would be the vendor's, not Wisconsin's.
   */
  transactionFee: [
    fromDated<TransactionFee>(
      { perPermitUsd: 0, percentOfTotal: 0 },
      MV2600,
      '2021-06-01',
      'MV2600: "1. Online applications accept eCheck/ACH and credit card. ... 2. If application is mailed in, make checks payable to: Registration Fee Trust. The fee must accompany the application and will be retained by the Department only if a permit is issued." No percentage or per-transaction charge is stated. Trans 250.08 additionally makes every fee $0 for a state department, county, town, municipality, or branch of the United States or a foreign government — a condition a quote does not state, so it is recorded and not applied.',
    ),
  ],

  /**
   * BOTH EMPTY, AND FOR A REASON WISCONSIN STATES. There is no superload
   * product and therefore no superload review fee. The nearest analogue is the
   * Trans 250.05(1)(b) bridge review at "$10 per hour for each employee-hour or
   * fraction thereof" above 150,000 lb — a real charge whose MULTIPLICAND is
   * set by the review itself and is published nowhere, so there is no figure to
   * hold. It is surfaced by `wi-bridge-review-over-150000` instead.
   */
  routeAnalysisFeeUsd: [],
  noBridgeRouteFeeUsd: [],

  superload: {
    /**
     * `grossWeight` IS ABSENT, as a positive finding. The word "superload" does
     * not appear in ch. 348, Trans 250, 252, 254 or 255, MV2600 or MV2605.
     * Three separate thresholds do the heavy-load work and they do NOT
     * coincide — width over 16 ft (region review fee, escorts, interstate
     * gate), gross over 150,000 lb (bridge review), and length over 100 ft with
     * a non-steered rear support (permit refused) — so synthesising one
     * superload flag from them would invent a category Wisconsin does not have
     * and would put the wrong loads in it. See `publishedAbsences`.
     */
    shortSpacing: [],
  },

  routeInspection: {
    /**
     * The Trans 250.05(1)(a) region review IS Wisconsin's route inspection: a
     * region office reviews "the adequacy of the route for the proposed move".
     * Its trigger is published; its price is $10 per region and the region
     * count is not, which `wi-region-review-fee-over-16ft` carries.
     */
    widthIn: [
      fromDated<Threshold>(
        { value: ftIn(16), inclusive: false },
        TRANS_250,
        TRANS_FROM,
        'Trans 250.05(1)(a): "For each single trip permit for a width exceeding 16 feet, a region review fee of $10 for each region through which the load is routed to cover the costs incurred by the region office in reviewing the adequacy of the route for the proposed move." EXCLUSIVE.',
      ),
    ],
    /** Wisconsin publishes no height or length route-review trigger. */
    heightIn: [],
    lengthIn: [],
  },

  escortRules: WISCONSIN_ESCORT_RULES,

  publishedAbsences: [
    fromDated<PublishedAbsence>(
      {
        subject: 'weightEscortTrigger',
        statement:
          'Trans 230, Trans 250, Trans 252, Trans 254, Trans 255, Trans 320, MV2600, MV2605 and both WisDOT OS/OW pages were opened and searched for a weight-keyed escort rule. Trans 254.15(3) (lane position) and Trans 254.16(2) (over 16 ft wide) are the only mandatory escort provisions in the single-trip chapter and both are dimensional or positional.',
        consequence:
          'No Wisconsin escort attaches to gross weight at any figure. What weight triggers is a FEE: the Trans 250.05(1)(b) bridge review above 150,000 lb.',
      },
      TRANS_254,
      TRANS_FROM,
    ),
    fromDated<PublishedAbsence>(
      {
        subject: 'dimensionalEscortThresholds',
        statement:
          'Below 16 feet of width Wisconsin publishes no dimensional escort threshold of any kind — no width, height, length or overhang number. Trans 252.03(1) and (3) leave it to the issuing authority\'s discretion for "unusual conditions such as extremely winding or hilly roads or where traffic is very heavy or when the permitted vehicle or load is unusually wide".',
        consequence:
          'The "over 12 ft = one escort" and "over 14 ft = two escorts" figures that circulate for Wisconsin appear only on commercial permit-service sites and are not adopted here. No escort is priced below 16 ft except through the positional rule, which this quote cannot evaluate.',
      },
      TRANS_254,
      TRANS_FROM,
    ),
    fromDated<PublishedAbsence>(
      {
        subject: 'heightEscortTrigger',
        statement:
          'Ch. Trans 254 contains no height-based escort requirement, and ch. Trans 252 contains no height-pole requirement: Trans 252.05 lists VEHICLE, OVERSIZE LOAD SIGN, WARNING LAMPS and RADIO, and the word "pole" does not otherwise appear in the chapter.',
        consequence:
          'What Wisconsin publishes for height instead is a notification duty — Trans 254.15(2) requires prior notice to the owners of overhead wires whenever a permitted load is over-height. The ABSENCE OF A HEIGHT POLE REQUIREMENT is recorded as UNKNOWN in this file\'s header rather than as a finding: none was located, which is not the same as the state stating there is none.',
      },
      TRANS_252,
      TRANS_FROM,
    ),
    fromDated<PublishedAbsence>(
      {
        subject: 'policeEscortRate',
        statement:
          'Trans 320.05 publishes the fee FORMULA for State Patrol escort services — "(a) Duty hours. (b) Rate of pay. (c) Vehicle mileage. (d) Mileage rate. (e) Meal allowance." — and every input is set outside the published code. Trans 320.02(13) defines the rate of pay by "collective bargaining agreement or state of Wisconsin compensation plan"; Trans 320.02(6)-(7) define the meal and lodging allowances by reference to the department\'s transportation administrative manual TAM 8-6, which is not published on the web and is obtainable only by writing to the Division of State Patrol.',
        consequence:
          'A Wisconsin police-escort cost cannot be quoted in advance and is excluded from every quote as a cost billed in arrears. The only fixed figure in the scheme is the $100 surcharge for cancelling with under 24 hours\' notice (Trans 320.03(15)).',
      },
      TRANS_320,
      TRANS_FROM,
    ),
    fromDated<PublishedAbsence>(
      {
        subject: 'superloadDefinition',
        statement:
          'The word "superload" appears nowhere in Wis. Stat. ch. 348, Wis. Admin. Code chs. Trans 250, 252, 254 or 255, MV2600 or MV2605. Three separate thresholds do the work a superload class does elsewhere and they do not coincide: width over 16 ft, gross weight over 150,000 lb, and overall length over 100 ft with a rear supporting axle at or near the rear of the load.',
        consequence:
          'No gross-weight superload threshold is held for Wisconsin, so no superload ceiling is mirrored to the public calculator and no load is flagged as a Wisconsin superload.',
      },
      WIS_STAT_348,
      STATUTE_FROM,
    ),
    fromDated<PublishedAbsence>(
      {
        subject: 'superloadFee',
        statement:
          'With no superload class there is no superload fee. The heaviest published charge attached to weight is the Trans 250.05(1)(b) bridge review at "$10 per hour for each employee-hour or fraction thereof" above 150,000 lb, and Trans 250.05(1)(c) adds "the actual cost incurred by the department" for any other special investigation.',
        consequence:
          'Neither charge has a quotable amount, because neither states the hours. Both are surfaced as excluded costs rather than priced.',
      },
      TRANS_250,
      TRANS_FROM,
    ),
  ],

  /**
   * FALSE, AND THE ONE FEE THAT LOOKS DISTANCE-DEPENDENT IS NOT. The Trans
   * 250.05(1)(a) region review is $10 per WisDOT REGION crossed, which is a
   * count of administrative areas and not a mileage; § 348.25(8) has no
   * mileage term anywhere. Wisconsin therefore prices without in-state miles.
   */
  feesDependOnDistance: false,
};
