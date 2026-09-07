/**
 * WEST VIRGINIA — oversize/overweight single-trip permit rules.
 *
 * A PUBLISHED BRIDGE-MONITORING SCHEDULE, A CIVILIAN ESCORT LADDER THAT ONLY
 * COVERS MOBILE HOMES, AND A SEPARATE AUTHORITY OWNING THE TURNPIKE.
 * ═══════════════════════════════════════════════════════════════════════════
 * WEST VIRGINIA PRICES BRIDGE MONITORING, WHICH ALMOST NOBODY DOES. Most
 * states in this corpus either bill engineering "at cost" with no rate — Nevada
 * and Wyoming both do — or publish nothing at all. WVDOH publishes a schedule:
 *
 *   first bridge ......... $150.00
 *   second bridge ........ $100.00
 *   each additional ....... $50.00
 *   maximum ............... $750.00
 *
 * That is a real, quotable number, and it is the single most useful thing in
 * this file. What it is NOT is predictable: it applies "when a single-trip
 * permit is approved with low-impact bridge crossing conditions", and WVDOH
 * says outright that it "does not maintain generalized lists of allowable
 * weights or dimensions by route" because "all structural bridge capacities and
 * clearance data are processed dynamically through an automated computer
 * analysis program for each individual trip application". So the RATE is
 * published and the TRIGGER is a per-application computation we cannot run.
 * The schedule is recorded and surfaced as a bounded exposure — $0 to $750 —
 * rather than added to the quote as if we knew the bridge count.
 *
 * THE ESCORT LADDER IS FOR MOBILE HOMES, NOT FOR GENERAL FREIGHT.
 * --------------------------------------------------------------
 * This is the finding that most changes how West Virginia should be quoted, and
 * it is easy to get backwards. 157 CSR 5 § 6.13 publishes a full four-rung
 * escort ladder — front escort on two-lane roads up to 12 ft, rear escort on
 * expressways over 12 ft, one front and two rear over 14 ft 6 in on wide
 * multi-lane roads, one front and one rear on everything else over 12 ft — and
 * every rung of it is expressly about MOBILE HOMES. For ordinary oversize
 * freight the state rule publishes no dimensional civilian-escort threshold at
 * all.
 *
 * Encoding the mobile-home ladder as if it were general would put escorts on
 * every 13 ft wide load in the state that does not owe them. Leaving the state
 * with no escort rules at all would hide a ladder that is real for the traffic
 * it governs. Both rungs are therefore encoded AS MOBILE-HOME RULES, gated on
 * a commodity fact a quote does not state, which resolves them as UNKNOWN on an
 * ordinary freight quote rather than as false — see `wv-mobile-home-*`.
 *
 * AND THE TURNPIKE IS A DIFFERENT AGENCY WITH A DIFFERENT RULE.
 * ------------------------------------------------------------
 * I-64 and I-77 through southern West Virginia are the West Virginia Turnpike,
 * run by the WEST VIRGINIA PARKWAYS AUTHORITY rather than by WVDOH — and the
 * Authority publishes its own pilot-car rule that WVDOH's does not contain:
 * "A pilot car is required for loads 12 feet wide or more, longer than 75 feet,
 * with more than 10 feet of overhang, or as determined by inspection."
 *
 * That is not a conflict with 157 CSR 5. It is a second body of rules covering
 * a corridor that a very large share of West Virginia through-freight actually
 * uses, so a load that owes no escort on a US route owes one the moment it
 * enters the Turnpike. The rule is encoded against the Turnpike as a named
 * corridor, and its boundary operators are preserved exactly as published —
 * width is INCLUSIVE ("12 feet wide or more") while length and overhang are
 * EXCLUSIVE ("longer than", "more than").
 *
 * FOUR ROUTE CLASSES, AND THEY CHANGE THE LEGAL LIMITS.
 * ----------------------------------------------------
 * West Virginia is the most route-conditioned state in this corpus on LEGAL
 * SIZE, not just on escorts:
 *
 *                       width      overall length          gross
 *   Interstate / NN     102 in     UNLIMITED               80,000 lb
 *   US and WV routes    102 in     70 ft                   80,000 lb + 10%
 *   County routes       102 in     55 ft                   —
 *   Local service       96 in      —                       —
 *     (lanes < 10 ft)
 *
 * The width figure turns on LANE WIDTH rather than on route designation —
 * § 17C-17-2(a) allows 102 in "on any highway having a minimum lane width of
 * ten feet" — so a local service route with narrow lanes is a 96 in road and
 * one with 10 ft lanes is a 102 in road. And the 10% weight tolerance on US and
 * WV routes is a genuine allowance that does not exist on the interstate.
 *
 * THE PARTIAL-INCREMENT RULE IS UNPUBLISHED, AND IT DOES NOT MATTER HERE.
 * ----------------------------------------------------------------------
 * Neither W. Va. Code § 17C-17-11 nor 157 CSR 5 § 6.6.e says whether the
 * $0.04 ton-mile charge rounds partial tons up, down, or pro-rata. Normally
 * that forces a spread and a manual review.
 *
 * IT IS IMMATERIAL IN WEST VIRGINIA, AND THE ARITHMETIC PROVES IT. The most
 * the reading can be worth is one whole ton of difference, so the spread is
 * bounded by $0.04 x 1 ton x miles. Reaching the $50 materiality threshold
 * would take 1,250 in-state miles. West Virginia is roughly 270 miles across at
 * its widest, so the largest spread any real lane can produce is about $11 —
 * comfortably inside the threshold on every possible move. The unknown is
 * recorded, the rounding is taken as pro-rata, and the divergence is absorbed
 * rather than surfaced, because a manual review on an $11 question would be
 * noise. See `wv-ton-mile-rounding-unpublished`.
 *
 * WHAT IS DELIBERATELY ABSENT
 * ---------------------------
 *   - NO WEIGHT-BASED ESCORT TRIGGER. Overweight loads do not trigger civilian
 *     escorts in West Virginia at all; low-rated bridge crossings trigger STATE
 *     BRIDGE MONITORS instead, which is the $150/$100/$50 schedule above and
 *     not a pilot car.
 *   - NO POLICE ESCORT RATE. The West Virginia State Police publishes no
 *     hourly, mileage or per diem schedule on its site or in the Code of State
 *     Rules; carriers coordinate with the local detachment. The TRIGGER is also
 *     unusual — 157 CSR 5 § 6.4.k attaches it to "moving houses or other
 *     similar oversized structures", a COMMODITY test rather than a dimensional
 *     one, plus WVDOH discretion.
 *   - NO HEIGHT-POLE REQUIREMENT. Neither 157 CSR 5 nor Chapter 17C sets a
 *     threshold or a construction standard. Third-party pilot-car directories
 *     claim 15 ft 0 in; no official source documents it, and it is NOT adopted.
 *   - NO BUCKET-TRUCK ESCORT. What exists is a NOTIFICATION duty: above the
 *     statutory 13 ft 6 in the permittee "shall give adequate notice to owners
 *     of overhead wires, cables, or other facilities". Notice is not an escort
 *     and carries no price.
 *   - NO PUBLISHED SINGLE-TRIP VALIDITY PERIOD. Mobile-home advance permits are
 *     codified at ten days; the ordinary single-trip duration is omitted from
 *     157 CSR 5 and from the WVDOH site. No number is invented for it.
 *
 * A LIVE POLICY CONTRADICTS THE RULE ON WEEKEND TRAVEL, AND IT IS RECORDED
 * RATHER THAN RESOLVED. 157 CSR 5 § 6.4.j.1 forbids moving loads 14 ft or less
 * wide "on holiday weekends or legal holidays", and § 6.13.d.2 confines mobile
 * homes of that width to Monday through Friday and Saturday morning. WVDOH's
 * current announcement says the opposite: "We will now grant weekend travel
 * when requested for anything not over 14' wide, unless on the West Virginia
 * Turnpike or requiring low impact." An agency announcement does not repeal a
 * promulgated rule, and this engine does not price travel days, so the
 * divergence is carried as a finding and changes no number.
 */
import type { SourceDoc, Sourced } from '../provenance.js';
import { ftIn, type EscortRule } from '../escortRules.js';
import type { ContextCondition, NamedRouteSegment, RouteVocabulary } from '../routeContext.js';
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

/** 157 CSR 5, the WVDOH hauling-permit rule, as filed with the Secretary of State. */
const CSR_FROM = '2023-11-08';
/**
 * THE UNDATED PAGES ARE DATED TO WHAT THEY RESTATE, NOT TO WHEN WE FETCHED
 * THEM — and the reason is a corpus-wide ratchet rather than pedantry.
 *
 * `OSOW_ASOF_MIN` is computed as the LATEST `effectiveFrom` anywhere in the
 * corpus, because that is the first day on which every recorded row is
 * simultaneously in force. Dating an undated source to the day it was
 * retrieved therefore drags the whole tool's answerable window forward: every
 * new state researched today would make yesterday unquotable for all fifty.
 * It is also just wrong. A page with no revision stamp is evidence that the
 * value is in force NOW and has been for an unknown period; it is not evidence
 * that it began the morning we read it.
 *
 * So the four WVDOT pages and the Parkways Authority page keep
 * `revisedOn: null` — that is the honest record of what they state — and take
 * their effective-from from the instrument they restate:
 *
 *   WV_CODE_FROM   the size-and-weight article. Per this file's own date
 *                  warnings the article's most recent amendment is § 17C-17-9a
 *                  in the 2005 regular session (§ 17C-17-9 in 2004, § 17C-17-8
 *                  as far back as 1975), so the current text dates from no
 *                  later than then. Used for the legal-limit rows.
 *   CSR_FROM       157 CSR 5 as filed. Used for the fee and escort rows that
 *                  come from the rule, and as a conservative anchor for the two
 *                  operational pages that restate it.
 */
const WV_CODE_FROM = '2005-07-01';
const WEB_FROM = CSR_FROM;

// ── Source documents ──────────────────────────────────────────────────────

const WV_CSR_157_5: SourceDoc = {
  id: 'wv-csr-157-5',
  title: '157 CSR 5 — WVDOH rules governing hauling permits',
  url: 'https://apps.sos.wv.gov/adlaw/csr/readfile.aspx?DocId=56947',
  publisher: 'West Virginia Secretary of State, Code of State Rules',
  revisedOn: CSR_FROM,
  retrievedOn: RETRIEVED,
  cite:
    'The promulgated rule, filed with the Secretary of State. Source of the $20 base fee, the $0.04 ton-mile charge, the mobile-home escort ladder, the police-escort commodity trigger and the superload provisions.',
};

const WV_LIMITS_PAGE: SourceDoc = {
  id: 'wv-dot-legal-limits',
  title: 'WVDOT — Legal size and weight limits',
  url: 'https://transportation.wv.gov/legal-size-and-weight-limits',
  publisher: 'West Virginia Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite:
    'The per-route-class limit table. UNDATED — the page carries no publication or revision stamp. Every figure on it is corroborated below against W. Va. Code Chapter 17C, which is what makes it usable.',
};

const WV_PERMIT_TYPES: SourceDoc = {
  id: 'wv-dot-permit-types',
  title: 'WVDOT — Permit types and fees',
  url: 'https://transportation.wv.gov/permit-types',
  publisher: 'West Virginia Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite:
    'Source of the bridge-monitoring schedule. UNDATED. Restates the $20 base fee and $0.04 ton-mile charge in the same words as 157 CSR 5, which corroborates both.',
};

const WV_FAQ: SourceDoc = {
  id: 'wv-dot-hauling-faq',
  title: 'WVDOT — Frequently asked questions, hauling permits',
  url: 'https://transportation.wv.gov/frequently-asked-questions-hauling-permits',
  publisher: 'West Virginia Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite:
    'UNDATED. Carries the statement that WVDOH publishes no route-by-route weight or clearance lists because every application is analysed dynamically — which is why the bridge fee cannot be predicted.',
};

const WV_TURNPIKE: SourceDoc = {
  id: 'wv-parkways-turnpike-safety',
  title: 'West Virginia Turnpike — Safety and assistance',
  url: 'https://turnpike.wv.gov/traveler-resources/safety-and-assistance',
  publisher: 'West Virginia Parkways Authority',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite:
    'A DIFFERENT AGENCY from WVDOH. The Parkways Authority operates I-64/I-77 as the West Virginia Turnpike and publishes its own pilot-car rule, which 157 CSR 5 does not contain. UNDATED.',
};

const WV_STATE_POLICE: SourceDoc = {
  id: 'wv-state-police',
  title: 'West Virginia State Police',
  url: 'https://www.wvsp.gov/',
  publisher: 'West Virginia State Police',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite:
    'Checked for an escort tariff and found none. The patrol publishes no statewide hourly, mileage or per diem schedule for commercial oversize escorts on its site or in the Code of State Rules.',
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

// ── Route vocabulary ──────────────────────────────────────────────────────

const WEST_VIRGINIA_ROUTE_VOCABULARY: RouteVocabulary = {
  name: 'WVDOT route classes (Interstate / US and WV / County / Local service)',
  explanation:
    'West Virginia varies its LEGAL SIZE AND WEIGHT by route class, which is rarer than varying escorts by it. Overall length is unlimited on Interstates and the National Network, 70 ft on US and WV routes and 55 ft on county routes; the 10% weight tolerance exists on US and WV routes and NOT on the interstate. Width is the exception: it turns on LANE WIDTH rather than designation, because W. Va. Code § 17C-17-2(a) allows 102 in "on any highway having a minimum lane width of ten feet", so a local service route with narrow lanes is a 96 in road and one with 10 ft lanes is a 102 in road regardless of what it is called. The West Virginia Turnpike is carried separately as a named corridor rather than as a class, because it is a different AGENCY rather than a different road type.',
  classes: [
    {
      id: 'WV:interstate',
      publishedName: 'Interstate Highways and the National Network',
      quote:
        'WVDOT legal-limits table: "Unlimited overall length on Interstates and National Network Highways." W. Va. Code § 17C-17-4(f): "nothing herein contained shall impose an overall length limitation as to commercial motor vehicles operating in truck tractor-semitrailer or truck tractor-semitrailer-trailer combinations."',
      generalEquivalents: ['interstate', 'divided'],
    },
    {
      id: 'WV:us-and-wv-routes',
      publishedName: 'US and WV routes',
      quote:
        'WVDOT legal-limits table: "70 feet: Overall length on US and WV routes." W. Va. Code § 17C-17-4(e): "the commissioner may designate ... a combination vehicle length not to exceed seventy feet." The same table gives these routes a 10% weight tolerance the interstate does not have.',
      generalEquivalents: ['multilane-undivided', 'two-lane'],
    },
    {
      id: 'WV:county-routes',
      publishedName: 'County routes',
      quote:
        'WVDOT legal-limits table: "55 feet: Overall Length on County routes." W. Va. Code § 17C-17-4(c): "no combination of vehicles including any load thereon shall have an overall length, inclusive of front and rear bumpers, in excess of fifty-five feet".',
      generalEquivalents: ['two-lane'],
    },
    {
      id: 'WV:local-service-narrow',
      publishedName: 'Local service routes with lanes under 10 feet wide',
      quote:
        'WVDOT legal-limits table: "8 feet: Local service routes with lanes under 10 feet wide." This is the ONLY 96 in class in the state, and it exists because W. Va. Code § 17C-17-2(a) conditions the 102 in allowance on "a minimum lane width of ten feet".',
      generalEquivalents: ['two-lane'],
    },
  ],
};

/**
 * THE TURNPIKE, AS A NAMED CORRIDOR. Not a route class: I-64 and I-77 through
 * southern West Virginia are ordinary interstate by road type and are governed
 * by a different AGENCY, so the distinction the escort rule turns on is
 * ownership rather than geometry.
 */
const WV_TURNPIKE_SEGMENT: NamedRouteSegment = {
  id: 'WV:turnpike-i64-i77',
  route: 'I-64 / I-77 (West Virginia Turnpike)',
  fromDescription: 'the northern end of the West Virginia Turnpike at Charleston',
  toDescription: 'the southern end of the West Virginia Turnpike at Princeton',
  quote:
    'West Virginia Parkways Authority, Safety and Assistance: "A pilot car is required for loads 12 feet wide or more, longer than 75 feet, with more than 10 feet of overhang, or as determined by inspection." The Authority operates the Turnpike; 157 CSR 5 contains no equivalent rule for WVDOH roads.',
};

const ON_TURNPIKE: ContextCondition = {
  kind: 'onNamedSegment',
  segmentIds: [WV_TURNPIKE_SEGMENT.id],
};

/**
 * MOBILE HOMES ARE A COMMODITY FACT A QUOTE DOES NOT STATE, so every rung of
 * the 157 CSR 5 § 6.13 ladder is gated on it and resolves UNKNOWN on ordinary
 * freight rather than firing. `transportingBuilding` is the nearest published
 * configuration flag the schema carries, and a mobile home is the paradigm case
 * of it.
 */
const IS_MOBILE_HOME: ContextCondition = {
  kind: 'vehicleConfiguration',
  property: 'transportingBuilding',
  is: true,
};

function escortRule(
  id: string,
  description: string,
  when: EscortRule['when'],
  then: EscortRule['then'],
  source: SourceDoc,
  effectiveFrom: string,
): EscortRule {
  return { id, jurisdiction: 'WV', description, when, then, source, effectiveFrom, effectiveTo: null };
}

export const WEST_VIRGINIA_ESCORT_RULES: EscortRule[] = [
  // ── The Turnpike, which is the rule that actually reaches general freight ──
  escortRule(
    'wv-turnpike-pilot-car',
    'On the West Virginia Turnpike (I-64/I-77): 12 ft wide or more, over 75 ft long, or over 10 ft of overhang — one pilot car',
    {
      kind: 'all',
      of: [
        { kind: 'context', of: ON_TURNPIKE },
        {
          kind: 'any',
          of: [
            { kind: 'gte', measure: 'widthIn', value: ftIn(12) },
            { kind: 'gt', measure: 'overallLengthIn', value: ftIn(75) },
            { kind: 'gt', measure: 'frontOverhangIn', value: ftIn(10) },
            { kind: 'gt', measure: 'rearOverhangIn', value: ftIn(10) },
          ],
        },
      ],
    },
    { escorts: 1 },
    WV_TURNPIKE,
    WEB_FROM,
  ),

  // ── 157 CSR 5 § 6.13 — the MOBILE-HOME ladder, gated on the commodity ─────
  escortRule(
    'wv-mobile-home-two-lane-to-12ft',
    'Mobile home up to and including 12 ft wide on a two-lane highway — one FRONT escort',
    {
      kind: 'all',
      of: [
        { kind: 'context', of: IS_MOBILE_HOME },
        { kind: 'context', of: { kind: 'routeClassIn', anyOf: ['WV:us-and-wv-routes', 'WV:county-routes'] } },
      ],
    },
    { escorts: 1, front: 1 },
    WV_CSR_157_5,
    CSR_FROM,
  ),
  escortRule(
    'wv-mobile-home-expressway-over-12ft',
    'Mobile home over 12 ft wide on an expressway or interstate — one REAR escort',
    {
      kind: 'all',
      of: [
        { kind: 'context', of: IS_MOBILE_HOME },
        { kind: 'gt', measure: 'widthIn', value: ftIn(12) },
        { kind: 'context', of: { kind: 'routeClassIn', anyOf: ['WV:interstate'] } },
      ],
    },
    { escorts: 1, rear: 1 },
    WV_CSR_157_5,
    CSR_FROM,
  ),
  /**
   * THE HEAVIEST RUNG IN THE STATE — three escorts — and it is reachable only
   * by a mobile home on a wide multi-lane road. Note the pavement condition the
   * rule attaches: "multi-lane highways having pavement widths of at least
   * 24-feet", with a minimum total clear roadway width of 28 ft. Pavement width
   * is not something a quote states, so the road condition is approximated by
   * road class and the pavement figure is recorded in the description.
   */
  escortRule(
    'wv-mobile-home-multilane-over-14ft6',
    'Mobile home over 14 ft 6 in wide on a multi-lane highway with pavement at least 24 ft wide — one FRONT and two REAR escorts',
    {
      kind: 'all',
      of: [
        { kind: 'context', of: IS_MOBILE_HOME },
        { kind: 'gt', measure: 'widthIn', value: ftIn(14, 6) },
        { kind: 'context', of: { kind: 'routeClassIn', anyOf: ['WV:interstate'] } },
      ],
    },
    { escorts: 3, front: 1, rear: 2 },
    WV_CSR_157_5,
    CSR_FROM,
  ),
  escortRule(
    'wv-mobile-home-other-over-12ft',
    'Mobile home over 12 ft wide on all other highways — one FRONT and one REAR escort',
    {
      kind: 'all',
      of: [
        { kind: 'context', of: IS_MOBILE_HOME },
        { kind: 'gt', measure: 'widthIn', value: ftIn(12) },
      ],
    },
    { escorts: 2, front: 1, rear: 1 },
    WV_CSR_157_5,
    CSR_FROM,
  ),

  // ── Police escort: a COMMODITY trigger, and no rate ───────────────────────
  escortRule(
    'wv-police-escort-structures',
    'Moving a house or similar oversized structure — police escort, arranged with the local law-enforcement agency, at WVDOH\'s determination',
    { kind: 'context', of: { kind: 'vehicleConfiguration', property: 'transportingBuilding', is: true } },
    {
      manualReview:
        '157 CSR 5 § 6.4.k: "All persons moving houses or other similar oversized structures that could cause significant disruptions to the normal flow of traffic shall make arrangements with the appropriate law enforcement agency for police escort to accompany the movement. The Division of Highways shall determine the need for a police escort based on the information provided in the permit application and knowledge of the roads or highways being traveled." The trigger is a COMMODITY test plus agency discretion rather than a dimensional threshold, and the West Virginia State Police publishes no hourly, mileage or per diem rate on its site or in the Code of State Rules — carriers coordinate with the local detachment or municipal agency. Neither half of the question can be answered from published sources.',
    },
    WV_CSR_157_5,
    CSR_FROM,
  ),
];

export const WEST_VIRGINIA_OSOW_RULES: JurisdictionOsowRules = {
  code: 'WV',
  name: 'West Virginia',
  country: 'US',

  routeVocabulary: [
    fromDated<RouteVocabulary>(WEST_VIRGINIA_ROUTE_VOCABULARY, WV_LIMITS_PAGE, WV_CODE_FROM),
  ],

  routeSegments: [fromDated<NamedRouteSegment>(WV_TURNPIKE_SEGMENT, WV_TURNPIKE, WEB_FROM)],

  legalLimits: {
    /**
     * 102 IN IS THE OPERATIVE FIGURE, and the 96 in class turns on LANE WIDTH
     * rather than on route designation. § 17C-17-2(a) sets 96 in as the general
     * rule and then allows 102 in "on any highway ... having a minimum lane
     * width of ten feet", so the narrow-lane local service route is the
     * exception rather than a separate road type. A quote does not state lane
     * width, and every route a permitted load realistically runs has 10 ft
     * lanes, so 102 in is recorded and the 96 in case is carried in the note.
     */
    widthIn: [
      fromDated(
        102,
        WV_LIMITS_PAGE,
        WV_CODE_FROM,
        'WVDOT: "8 feet 6 inches: Interstate, US, WV, and Local service routes with lanes 10 feet or greater." W. Va. Code § 17C-17-2(a): "any vehicle with a total outside width of one hundred two inches, exclusive of safety equipment authorized by the United States Department of Transportation, may be operated on any highway within the state designated by the United States Department of Transportation or the commissioner of the department of highways or on any highway having a minimum lane width of ten feet." THE 96 IN CASE IS REAL AND NARROW: "8 feet: Local service routes with lanes under 10 feet wide", from the same statute\'s general rule. It turns on lane width, which a quote does not state.',
      ),
    ],
    heightIn: [
      fromDated(
        ftIn(13, 6),
        WV_LIMITS_PAGE,
        WV_CODE_FROM,
        'WVDOT: "13 feet 6 inches: All routes." W. Va. Code § 17C-17-4(a): "A vehicle, including any load thereon, may not exceed a height of thirteen feet six inches". EXCLUSIVE, and uniform across every route class — the one dimension West Virginia does not vary by road. The same subsection puts the liability for low structures on the owner: damage "to any bridge or highway structure and to municipalities for any damage to traffic control devices or other highway structures where such bridges, devices or structures have a vehicle clearance of less than thirteen feet six inches" is the carrier\'s.',
      ),
    ],
    trailerLengthIn: [
      fromDated(
        ftIn(53),
        WV_LIMITS_PAGE,
        WV_CODE_FROM,
        'WVDOT: "53 feet: Semitrailer (measurement from tractor rear axle to trailer first axle cannot exceed 37 feet)." AND THE 53 FT IS CONDITIONAL ON THE KINGPIN SETTING: W. Va. Code § 17C-17-4(f) allows 48 ft generally and 53 ft only "where semitrailers have an axle spacing of not more than thirty-seven feet between the rear axle of the truck tractor and the front axle of the semitrailer". A quote states no kingpin dimension, so the 53 ft figure is recorded as the operative one — every modern 53 ft trailer is built to that spacing — and the condition is noted rather than evaluated.',
      ),
    ],
    /**
     * ABSENT, AND ROUTE-CONDITIONED RATHER THAN UNPUBLISHED. West Virginia sets
     * THREE different overall lengths and one of them is no limit at all:
     * unlimited on Interstates and the National Network, 70 ft on US and WV
     * routes, 55 ft on county routes. A single figure would be wrong on two of
     * the three classes, and the class is a routing fact the quote does not
     * fix. The three are carried in the route vocabulary above.
     */
    grossWeightLbs: [
      fromDated(
        80_000,
        WV_LIMITS_PAGE,
        WV_CODE_FROM,
        'WVDOT: "80,000 lbs" on interstate highways with "Tolerance: None". THE SAME 80,000 lb ON US AND WV ROUTES CARRIES A 10% TOLERANCE, which the interstate figure does not — so an 87,000 lb load is over the limit on I-79 and inside the tolerance on a US route. The tolerance is recorded here rather than applied, because applying it would depend on the route class of every mile of the lane. W. Va. Code § 17C-17-9 (interstate) was last amended in 2004 and § 17C-17-9a (non-interstate) in 2005; both are old and both are actively in force.',
      ),
    ],
    singleAxleLbs: [
      fromDated(
        20_000,
        WV_LIMITS_PAGE,
        WV_CODE_FROM,
        'WVDOT: "20,000 lbs" on interstate highways, "Tolerance: None"; the same figure on US and WV routes carries the 10% tolerance. W. Va. Code § 17C-17-8 was last amended in the 1975 regular session — over fifty years old and still the operative text, which is an old statute in force rather than a stale document.',
      ),
    ],
    tandemAxleLbs: [
      fromDated(
        34_000,
        WV_LIMITS_PAGE,
        WV_CODE_FROM,
        'WVDOT: "34,000 lbs" on interstate highways, "Tolerance: None".',
      ),
    ],
  },

  permitBaseFeeUsd: [
    fromDated(
      20,
      WV_CSR_157_5,
      CSR_FROM,
      '157 CSR 5: "Special Permits for single trips will be issued at a basic fee of $20.00 covering any oversize dimension, overweight, or both types of permits. In addition to the basic fee, an overweight fee of $.04 per ton mile will be assessed." ONE BASE FEE COVERS OVERSIZE, OVERWEIGHT OR BOTH — the ton-mile charge is the only thing that stacks on it. Restated identically on WVDOT\'s permit-types page ("Cost: $20.00 base fee plus $0.04 per ton-mile for overweight loads"), which corroborates an otherwise undated web source against the promulgated rule. The annual products are not single-trip alternatives and are not applied: $200 oversize-only, $500 oversize and overweight, $200 for mobile homes up to 14 ft wide, and $150 for the first 15 seagoing-container permits plus $15 each thereafter.',
    ),
    fromDated(
      20,
      WV_PERMIT_TYPES,
      WEB_FROM,
      'WVDOT permit types: "$20.00 base fee plus $0.04 per ton-mile for overweight loads." The same two numbers as the rule, from the operational page.',
    ),
  ],

  oversizeFeeBands: [],

  combinedFeeRule: [
    fromDated<CombinedFeeRule>(
      {
        kind: 'cumulative',
        explanation:
          '157 CSR 5 is explicit that the ton-mile charge is additive: "IN ADDITION TO the basic fee, an overweight fee of $.04 per ton mile will be assessed." A load that is oversize and legal on weight pays the $20 alone; a load that is both pays $20 plus the ton-mile charge, with no second dimensional fee of any kind.',
      },
      WV_CSR_157_5,
      CSR_FROM,
    ),
  ],

  overweightPricing: [
    fromDated<OverweightPricing>(
      {
        kind: 'perMile',
        explanation:
          '157 CSR 5: "an overweight fee of $.04 per ton mile will be assessed." Per mile, on the excess tonnage, with no bands and no flat alternative.',
      },
      WV_CSR_157_5,
      CSR_FROM,
    ),
  ],

  /**
   * $0.04 PER TON-MILE ON THE EXCESS OVER 80,000 lb.
   *
   * `roundIncrementUp` IS FALSE, which is a decision and not a default. The
   * rule is silent on partial tons, so pro-rata is the reading that adds
   * nothing the source does not say. The alternative reading — round up — can
   * differ by at most one whole ton, so the spread is bounded by
   * $0.04 x 1 ton x in-state miles. Reaching the $50 materiality threshold
   * would need 1,250 miles inside West Virginia, and the state is about 270
   * miles across at its widest, so the largest divergence any real lane can
   * produce is roughly $11. The unknown is recorded in `publishedAbsences` and
   * absorbed rather than surfaced, because a manual review on an $11 question
   * is noise rather than honesty.
   */
  overweightPerMile: [
    fromDated<PerMileRate>(
      {
        minLbs: 80_001,
        maxLbs: null,
        ratePerMileUsd: 0.04,
        perIncrementLbs: 2_000,
        excessBaseLbs: 80_000,
        roundIncrementUp: false,
        minimumUsd: null,
        maximumUsd: null,
      },
      WV_CSR_157_5,
      CSR_FROM,
      'Total = $20.00 + ($0.04 x excess tons x permitted route miles). The excess is measured over the 80,000 lb statutory cap, or over a lower posted bridge or road capacity where WVDOH\'s automated analysis finds one — and those posted capacities are not published, so the 80,000 lb base is the only computable one. See `wv-ton-mile-rounding-unpublished` for the partial-ton reading.',
    ),
  ],

  overweightBands: [],
  conditionalFees: [],

  transactionFee: [
    fromDated<TransactionFee>(
      { perPermitUsd: 0, percentOfTotal: 0 },
      WV_FAQ,
      WEB_FROM,
      'AN AFFIRMATIVE ABSENCE. No statutory or administrative percentage surcharge is promulgated by WVDOH. The FAQ describes payment "using a major credit card or via a pre-established escrow account managed through Bentley Systems" and names no surcharge on either. A SEPARATE $20 CHARGE EXISTS AND IS NOT A TRANSACTION FEE: WVDOT "may, at our discretion, charge $20 for all superload applications that are not activated (resulting in permits) within 30 days of the analysis" — that is a penalty for abandoning a superload application, is discretionary, and never attaches to an issued permit.',
    ),
  ],

  /**
   * THE BRIDGE-MONITORING SCHEDULE — a published rate with an unpredictable
   * trigger. It is NOT recorded as a route-analysis fee amount, because the
   * amount depends on a bridge count that only WVDOH's automated analysis can
   * produce: the agency states outright that it "does not maintain generalized
   * lists of allowable weights or dimensions by route" and processes every
   * application dynamically. Putting a number here would assert a bridge count
   * we cannot compute. It is carried as a published absence with the full
   * schedule and its $750 ceiling, so the quote states a bounded exposure
   * instead of a false figure.
   */
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

  escortRules: WEST_VIRGINIA_ESCORT_RULES,
  escortCountCombination: [],

  feeDistanceDependence: [
    fromDated<FeeDistanceDependence>(
      {
        component: 'overweight',
        dependsOnDistance: true,
        quote:
          '157 CSR 5: "an overweight fee of $.04 per ton mile will be assessed."',
      },
      WV_CSR_157_5,
      CSR_FROM,
      'The mileage base is the PERMITTED ROUTE, which WVDOH fixes when it approves the application. That is narrower than "every mile in the state" in principle and identical to it in practice for a through-move, because the permit routes the load across the state.',
    ),
  ],

  publishedAbsences: [
    fromDated<PublishedAbsence>(
      {
        subject: 'partialIncrementRule',
        statement:
          'Neither W. Va. Code § 17C-17-11 nor 157 CSR 5 § 6.6.e states whether the $0.04 ton-mile charge rounds partial tons up, rounds them down, or charges them pro-rata. All three readings are live and none is published.',
        consequence:
          'Pro-rata is taken, because it adds nothing the source does not say, and the divergence is ABSORBED rather than surfaced. The arithmetic justifies that: the readings differ by at most one whole ton, so the spread is bounded by $0.04 x 1 ton x in-state miles, and reaching the $50 materiality threshold would take 1,250 miles inside West Virginia against a state roughly 270 miles across. The largest divergence any real lane can produce is about $11.',
      },
      WV_CSR_157_5,
      CSR_FROM,
    ),
    fromDated<PublishedAbsence>(
      {
        subject: 'weightEscortTrigger',
        statement:
          'Overweight loads trigger no civilian escort in West Virginia at any weight. What a low-rated bridge crossing triggers instead is STATE BRIDGE MONITORING, which is departmental personnel on a published fee schedule rather than a pilot car.',
        consequence:
          'No West Virginia escort is added on weight. The bridge-monitoring schedule below is the cost that weight actually drives.',
      },
      WV_CSR_157_5,
      CSR_FROM,
    ),
    fromDated<PublishedAbsence>(
      {
        subject: 'dimensionalEscortThresholds',
        statement:
          'For ORDINARY OVERSIZE FREIGHT, 157 CSR 5 publishes no dimensional civilian-escort threshold at all. The four-rung ladder in § 6.13 is expressly about MOBILE HOMES, and the only other escort provision in the rule is the police-escort requirement for houses and similar structures in § 6.4.k. The one dimensional pilot-car rule that reaches general freight is the West Virginia Parkways Authority\'s, and it governs only the Turnpike.',
        consequence:
          'A 13 ft wide load of general freight on a US route owes no published escort in West Virginia, and the same load owes a pilot car the moment it enters the Turnpike. Encoding the mobile-home ladder as general would put escorts on loads that do not owe them; the rungs are therefore gated on the commodity and resolve UNKNOWN on ordinary freight.',
      },
      WV_CSR_157_5,
      CSR_FROM,
    ),
    fromDated<PublishedAbsence>(
      {
        subject: 'policeEscortRate',
        statement:
          'The West Virginia State Police publishes no hourly rate, mileage rate, minimum hours, per diem or cancellation charge for commercial oversize escorts, on its own site or anywhere in the Code of State Rules. Carriers coordinate directly with the local detachment or the municipal agency with jurisdiction. The TRIGGER is equally unquotable: 157 CSR 5 § 6.4.k attaches it to "moving houses or other similar oversized structures", a commodity test, plus WVDOH\'s own determination.',
        consequence:
          'No police escort cost is quoted for West Virginia, and a move that meets the commodity trigger goes to manual review rather than carrying an invented figure.',
      },
      WV_STATE_POLICE,
      WEB_FROM,
    ),
    fromDated<PublishedAbsence>(
      {
        subject: 'superloadFee',
        statement:
          'West Virginia publishes a bridge-monitoring SCHEDULE and no way to predict how many bridges it applies to. The schedule is first bridge $150.00, second bridge $100.00, each additional bridge $50.00, maximum $750.00, and it applies "when a single-trip permit is approved with low-impact bridge crossing conditions requiring WVDOH monitoring personnel". WVDOH states that it "does not maintain generalized lists of allowable weights or dimensions by route" because "all structural bridge capacities and clearance data are processed dynamically through an automated computer analysis program for each individual trip application". 157 CSR 5 § 6.5.b separately authorises "a professional charge in order to determine the feasibility of any movement of extremely heavy equipment ... levied before an analysis is undertaken", with no rate stated, and lets WVDOH require bridges to be reinforced at the applicant\'s expense, demand damage bonds and require traffic-control plans.',
        consequence:
          'The bridge fee is a BOUNDED EXPOSURE of $0 to $750 rather than a line item — the rate is known and the bridge count is not. Nothing is added to the quote for it, and the ceiling is stated so a shipper is not surprised by it. The feasibility charge and the reinforcement liability are open-ended and unquotable.',
      },
      WV_PERMIT_TYPES,
      WEB_FROM,
    ),
    fromDated<PublishedAbsence>(
      {
        subject: 'superloadDefinition',
        statement:
          'West Virginia defines its superload by COMMODITY rather than by a number. 157 CSR 5 § 6.5 covers "the movement of exceptionally heavy or large equipment such as transformers or compressor station machinery which cannot be disassembled", issued by the Operations Division after District Engineer Manager approval. The nearest published figure is W. Va. Code § 17C-17-11(b)(3)(B), which sets 120,000 lb as the maximum gross for commodities manufactured for interstate commerce subject to engineering analysis. Processing takes "a minimum of 48 hours or more".',
        consequence:
          'No numeric superload threshold is held for West Virginia, so no superload ceiling is mirrored to the public calculator. What changes above the threshold is schedule and engineering exposure, not a published fee tier.',
      },
      WV_CSR_157_5,
      CSR_FROM,
    ),
    fromDated<PublishedAbsence>(
      {
        subject: 'heightEscortTrigger',
        statement:
          'No height-pole or clearance-bar requirement is set anywhere in 157 CSR 5 or W. Va. Code Chapter 17C — neither a triggering height nor a construction standard. Third-party pilot-car directories claim a 15 ft 0 in threshold; no official source documents it. What the rule DOES impose above 13 ft 6 in is a NOTIFICATION duty: the permittee "shall give adequate notice to owners of overhead wires, cables, or other facilities which may be affected by the transportation authorized by the permit." Notice is not an escort and no bucket-truck escort is mandated or priced anywhere in state rules.',
        consequence:
          'No height pole and no utility escort is added to a West Virginia quote at any height. The 15 ft 0 in figure circulating in commercial directories is not adopted.',
      },
      WV_CSR_157_5,
      CSR_FROM,
    ),
  ],

  feesDependOnDistance: true,
};
