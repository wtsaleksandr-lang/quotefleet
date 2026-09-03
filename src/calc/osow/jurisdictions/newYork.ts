/**
 * NEW YORK — oversize/overweight single-trip permit rules.
 *
 * RECONCILED 2026-09-01 against an independent New York dataset. Where the two
 * agreed the row stands unchanged; where they disagreed the better-sourced
 * reading won and the loser is recorded rather than deleted; where the new
 * dataset had data this file lacked, it was added. The five substantive changes
 * are marked `RECONCILED:` at the point they bite.
 *
 * THREE THINGS THAT MAKE NEW YORK DIFFERENT FROM TEXAS
 * ---------------------------------------------------
 *
 * 1. ONE PERMIT, ONE FEE, NO WEIGHT BANDS. 17 NYCRR §154-1.2(b)(1) defines a
 *    trip permit as authorising "an oversize and/or overweight vehicle" — a
 *    single $40 charge covers both, and there is no weight step and no
 *    mileage component at NYSDOT. A 113,000 lb load and an 81,000 lb load pay
 *    the same $40. The current fee page confirms it row by row: every trip
 *    permit type it lists, superloads included, is $40 with a $10 amendment.
 *
 * 2. THE AXLE LIMITS ARE NOT THE FEDERAL ONES. VTL §385 sets 22,400 lb on a
 *    single axle and 36,000 lb on a tandem, against the federal 20,000 and
 *    34,000. Carrying the federal numbers here would report a legal New York
 *    axle load as over-limit. (The federal bridge formula still governs the
 *    Interstate system and is checked separately in `bridgeFormula.ts`.)
 *
 * 3. NEW YORK IS NOT A SINGLE-ISSUER STATE. The Thruway Authority and the
 *    Bridge Authority issue their own OS/OW permits, and NYSDOT's permit is
 *    expressly not valid inside New York City. A quote showing only NYSDOT's
 *    $40 can be missing a whole permit; `additionalAuthorities` makes the
 *    engine say so.
 *
 * THE FEE CONFLICT. The NYSDOT fees page says $40 for a single trip permit.
 * The fee table inside 17 NYCRR §154-1.20 — stamped PERM43 (9/95) — prints
 * $60.00 for a Region Office and $40.00 for the Main Office, and every row in
 * that table differs by the same $20. Both are official and in effect; we do
 * not know which office issues a given permit, and VTL §385 separately
 * authorises the commissioner "to levy a surcharge of up to twenty dollars for
 * the issuance and distribution of special hauling permits at regional offices"
 * — which is precisely the $20 the two columns differ by. Both rows stay on
 * file, the resolver refuses to pick, and New York prices as a $40–$60 range.
 * That is the second live conflict in the dataset after Pennsylvania's.
 */
import type { SourceDoc, Sourced } from '../provenance.js';
import { ftIn, type EscortRule } from '../escortRules.js';
import type {
  JurisdictionOsowRules,
  AdditionalAuthority,
  OverweightPricing,
  Threshold,
  TransactionFee,
} from '../types.js';

const RETRIEVED = '2026-09-01';

// ── Source documents ──────────────────────────────────────────────────────

const NYSDOT_FEES: SourceDoc = {
  id: 'nysdot-special-hauling-fees',
  title: 'NYSDOT — Special Hauling Permit Fees',
  url: 'https://www.dot.ny.gov/nypermits/special-hauling-permits/fees',
  publisher: 'New York State Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'trip permit table — every type $40 with a $10 amendment fee; page carries no revision date',
};

const NYCRR_154_1: SourceDoc = {
  id: 'ny-17-nycrr-154-1',
  title: '17 NYCRR Subpart 154-1 — Special Hauling Permits (PDF)',
  url: 'https://www.dot.ny.gov/nypermits/repository/nycrr154-1.pdf',
  publisher: 'New York State Department of Transportation',
  // The Subpart itself carries no date; its embedded fee table is stamped
  // "PERM43 (9/95)". That stamp is the only date the document offers, so it
  // is what `revisedOn` records — not the date we downloaded it.
  revisedOn: '1995-09-01',
  retrievedOn: RETRIEVED,
  cite: '§154-1.2(b)(1) trip permit definition; §154-1.20 fee table, form PERM43 (9/95); three-way movement = two permit fees',
};

const VTL_385: SourceDoc = {
  id: 'ny-vtl-385-senate',
  title: 'NY Vehicle & Traffic Law §385 (NY State Senate)',
  url: 'https://www.nysenate.gov/legislation/laws/VAT/385',
  publisher: 'New York State Senate',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: '§385(1)(a),(2),(3),(4),(8),(9),(10) — dimensions and weights',
};

const VTL_385_DOT: SourceDoc = {
  id: 'ny-vtl-385-dot-reprint',
  title: 'NY Vehicle & Traffic Law §385 (NYSDOT reprint)',
  url: 'https://www.dot.ny.gov/nypermits/repository/vlt-section-385.html',
  publisher: 'New York State Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'independent reprint, used as corroboration of the Senate text; also the regional-office surcharge and the New York City exclusion',
};

const PERM_87: SourceDoc = {
  id: 'nysdot-perm-87',
  title: 'NYSDOT Perm 87 — Special Requirements for Oversize Permits (PDF)',
  url: 'https://www.dot.ny.gov/nypermits/repository/Perm%2087.pdf',
  publisher: 'New York State Department of Transportation',
  revisedOn: '2015-03-01',
  retrievedOn: RETRIEVED,
  cite: 'form stamp "PERM 87 (3/15)"; width, height, length and overhang bands; route-survey triggers; police-escort triggers',
};

const ESCORT_MANUAL: SourceDoc = {
  id: 'nysdot-escort-manual-2025',
  title: 'NYS Certified Vehicle Escort Manual (PDF)',
  url: 'https://www.dot.ny.gov/portal/page/portal/nypermits/repository/Vehicle%20Escort%20Manual_Final_2025.pdf',
  publisher: 'New York State Department of Transportation',
  // The cover states a year and nothing finer. Recorded as 1 January of that
  // year with the imprecision noted, rather than invented to the day.
  revisedOn: '2025-01-01',
  retrievedOn: RETRIEVED,
  cite: 'escort positions and escalations; height-pole settings; police-escort triggers; §IV.1(e) separate permits. Cover states the year 2025 only — no month or day.',
};

const NYSDOT_SUPERLOADS: SourceDoc = {
  id: 'nysdot-superloads',
  title: 'NYSDOT — Superloads',
  url: 'https://www.dot.ny.gov/nypermits/superloads',
  publisher: 'New York State Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'superload definition: over 16 ft wide; 16 ft or more high; over 160 ft long; 200,000 lb or more',
};

/** RECONCILED: added. Still linked from the current superloads page. */
const PERM_12S: SourceDoc = {
  id: 'nysdot-perm-12s',
  title: 'NYSDOT PERM 12S — Superload Permit Requirements (PDF)',
  url: 'https://www.dot.ny.gov/nypermits/repository/perm12s.pdf',
  publisher: 'New York State Department of Transportation',
  revisedOn: '2014-02-01',
  retrievedOn: RETRIEVED,
  cite: 'superload definition with INCLUSIVE length boundary; bond schedule; police escorts for all superloads. Month-only date, recorded as the 1st.',
};

/** RECONCILED: added — New York publishes real trooper rates and we had none. */
const NYSP_COMMERCIAL: SourceDoc = {
  id: 'nysp-commercial-vehicles',
  title: 'New York State Police — Commercial Vehicles (escort rates)',
  url: 'https://troopers.ny.gov/commercial-vehicles',
  publisher: 'New York State Police',
  // The page itself carries no revision date; the rate table states its own
  // effective date in words — "As of April 1, 2026, the charted rates apply to
  // all NYSP escorts" — and that is what is recorded here.
  revisedOn: '2026-04-01',
  retrievedOn: RETRIEVED,
  cite: 'regular $101.89/hr, overtime $144.66/hr, mileage $0.725/mi, 3-hour minimum per officer, 62.91% fringe and indirect included',
};

/** RECONCILED: added — the route-survey form, and where the 30-day validity is. */
const PERM_85: SourceDoc = {
  id: 'nysdot-perm-85',
  title: 'NYSDOT PERM 85 — Route Survey (PDF)',
  url: 'https://www.dot.ny.gov/nypermits/repository/perm85.pdf',
  publisher: 'New York State Department of Transportation',
  revisedOn: '2012-03-01',
  retrievedOn: RETRIEVED,
  cite: 'survey valid 30 days; must be performed by a NYS Certified Escort; height-pole settings',
};

/** RECONCILED: added — the traffic-control-plan threshold. */
const NY_TCP: SourceDoc = {
  id: 'nysdot-traffic-control-plan',
  title: 'NYSDOT — Traffic Control Plan Requirements (PDF)',
  url: 'https://www.dot.ny.gov/nypermits/repository/TrafficControlPlanRequirements.pdf',
  publisher: 'New York State Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'plan may be required at or over 18 ft wide; must be prepared by a NYS licensed PE',
};

/** RECONCILED: added — escort-driver certification, a private cost, never a permit fee. */
const NY_DMV_ESCORT: SourceDoc = {
  id: 'ny-dmv-escort-endorsement',
  title: 'NY DMV — Escort Driver Endorsement',
  url: 'https://dmv.ny.gov/business/escort-driver-endorsement',
  publisher: 'New York State Department of Motor Vehicles',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: '$40 test fee, $40 per retest, $5 replacement card; no reciprocity with other states',
};

const NYSTA_TAP_623: SourceDoc = {
  id: 'nysta-tap-623',
  title: 'NYS Thruway Authority TAP-623 — Oversize/Overweight Permit Information (PDF)',
  url: 'https://www.thruway.ny.gov/sites/default/files/2025-07/tap623.pdf',
  publisher: 'New York State Thruway Authority',
  revisedOn: '2021-05-01',
  retrievedOn: RETRIEVED,
  cite: 'form stamp "TAP-623 (05/2021)"; p.2 basic fee, ton-mile overweight rates, and the 12 ft 6 in Mainline width maximum',
};

// ── Helpers ───────────────────────────────────────────────────────────────

function fromUndatedPage<T>(value: T, source: SourceDoc, note?: string): Sourced<T> {
  return {
    value,
    source,
    effectiveFrom: RETRIEVED,
    effectiveTo: null,
    ...(note === undefined ? {} : { note }),
  };
}

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

// ── Escort rules ──────────────────────────────────────────────────────────

const PERM_87_FROM = '2015-03-01';
const MANUAL_FROM = '2025-01-01';

function escortRule(
  id: string,
  description: string,
  when: EscortRule['when'],
  then: EscortRule['then'],
  source: SourceDoc = ESCORT_MANUAL,
  effectiveFrom: string = MANUAL_FROM,
): EscortRule {
  return { id, jurisdiction: 'NY', description, when, then, source, effectiveFrom, effectiveTo: null };
}

/**
 * New York positions ONE escort by road class and does not change the COUNT
 * with it: over 12 ft wide it precedes on a two-lane highway and follows on
 * "highways of more than two lanes". The same is true of the 80 ft length
 * trigger.
 *
 * RECONCILED: the previous version of this file also carried a pair of
 * position-specific width rules conditioned on `routeClass`, which made every
 * New York quote without a stated road type undecidable — for a distinction
 * that does not change the price by a dollar. That is the exact failure
 * `EscortOutcome.escorts` exists to prevent, and Texas already avoids it. The
 * position-only rules are gone; the position is stated in the description, and
 * road class is now required only where it genuinely changes the count (the
 * three-escort escalations below).
 *
 * RECONCILED: the length rule was previously written as a band of 80 ft to
 * under 90 ft. No source supports the 90 ft ceiling. The Escort Manual says
 * "80 feet long or greater" with no upper bound, and the next step up is the
 * three-escort escalation at 100 ft (two-lane) or 160 ft (four-lane). The old
 * rule would have quietly dropped the escort for a 95 ft load.
 */
export const NEW_YORK_ESCORT_RULES: EscortRule[] = [
  escortRule(
    'ny-width-over-12',
    'Over 12 ft wide — one certified escort: preceding on a two-lane highway, following on a highway of more than two lanes',
    { kind: 'gt', measure: 'widthIn', value: ftIn(12) },
    { escorts: 1 },
  ),
  escortRule(
    'ny-length-80-or-more',
    'Overall length 80 ft or greater — one certified escort, positioned by road class as for width',
    { kind: 'gte', measure: 'overallLengthIn', value: ftIn(80) },
    { escorts: 1 },
  ),
  /**
   * RECONCILED: added. The previous file had NO height escort rule at all, so
   * a 15 ft load in New York came back needing no escort and no height pole.
   *
   * Perm 87 requires a certified escort to precede with a height pole at
   * "14'-0" AND OVER" on all routes. The 2025 manual states the same 14 ft
   * trigger for two-lane highways and omits height from its more-than-two-lane
   * sentence — an omission the state's own materials do not explain. Perm 87 is
   * the stricter and more specific reading and is used; the discrepancy is
   * stated on the advisory rather than resolved silently.
   */
  escortRule(
    'ny-height-14-or-more',
    'Height 14 ft or greater — one certified escort preceding with a height pole',
    { kind: 'gte', measure: 'heightIn', value: ftIn(14) },
    { escorts: 1, front: 1, heightPole: true },
    PERM_87,
    PERM_87_FROM,
  ),
  /**
   * RECONCILED: added. Overhang is where the previous file went wrong in the
   * other direction — it recorded 3 ft front and 4 ft rear as New York LEGAL
   * limits, citing "§385(4)(c)". Those are Texas's numbers, and the independent
   * New York dataset finds no such legal limit anywhere in §385. What New York
   * actually publishes is an ESCORT trigger at 10 ft, positioned by which end
   * the load overhangs. The invented legal limits are gone and these are here.
   */
  escortRule(
    'ny-rear-overhang-over-10',
    'Rear overhang greater than 10 ft — one certified escort to follow',
    { kind: 'gt', measure: 'rearOverhangIn', value: ftIn(10) },
    { escorts: 1, rear: 1 },
    PERM_87,
    PERM_87_FROM,
  ),
  escortRule(
    'ny-front-overhang-over-10',
    'Front overhang greater than 10 ft — one certified escort to precede',
    { kind: 'gt', measure: 'frontOverhangIn', value: ftIn(10) },
    { escorts: 1, front: 1 },
    PERM_87,
    PERM_87_FROM,
  ),
  /**
   * The escalations. These DO change the count, so they legitimately need the
   * road class and correctly go undecided without it — unlike the position-only
   * rules removed above.
   */
  escortRule(
    'ny-three-escorts-two-lane',
    'Over 16 ft wide or 100 ft or more long on a two-lane highway — three certified escorts, two in front and one in the rear',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: ['two-lane'] },
        {
          kind: 'any',
          of: [
            { kind: 'gt', measure: 'widthIn', value: ftIn(16) },
            { kind: 'gte', measure: 'overallLengthIn', value: ftIn(100) },
          ],
        },
      ],
    },
    { escorts: 3, front: 2, rear: 1 },
  ),
  escortRule(
    'ny-three-escorts-four-lane',
    '18 ft or more wide, or 160 ft or more long, on a four-lane highway — three certified escorts, two in front and one in the rear',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: ['divided', 'urban'] },
        {
          kind: 'any',
          of: [
            { kind: 'gte', measure: 'widthIn', value: ftIn(18) },
            { kind: 'gte', measure: 'overallLengthIn', value: ftIn(160) },
          ],
        },
      ],
    },
    { escorts: 3, front: 2, rear: 1 },
  ),
  /**
   * "If the vehicle/load is 160 feet long or greater and is traveling only on
   * interstate highways, only two escorts will be required." The manual does
   * not say where the two ride, and that is recorded rather than assumed —
   * hence a bare count and no front/rear.
   */
  escortRule(
    'ny-interstate-length-exception',
    '160 ft or more long travelling only on interstate highways — two certified escorts',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: ['interstate'] },
        { kind: 'gte', measure: 'overallLengthIn', value: ftIn(160) },
      ],
    },
    {
      escorts: 2,
      advisory:
        'New York reduces the escort requirement to two vehicles for a load 160 ft or longer travelling only on interstate highways, but does not state where the two ride. Their positions must be confirmed with the permitting office.',
    },
  ),
  /**
   * RECONCILED: this rule previously asserted `policeFront: 1`. New York
   * publishes the TRIGGERS for a police escort and explicitly does not publish
   * the number of police vehicles, so claiming one, in front, was invention.
   * The requirement is now recorded with the state's real, citable trooper
   * rates and sent to review for the count.
   */
  escortRule(
    'ny-police-triggers',
    'Over 16 ft wide, 16 ft or more high, over 160 ft long, 200,000 lb or more, or crossing the centreline of a structure — police escort required',
    {
      kind: 'any',
      of: [
        { kind: 'gt', measure: 'widthIn', value: ftIn(16) },
        { kind: 'gte', measure: 'heightIn', value: ftIn(16) },
        { kind: 'gt', measure: 'overallLengthIn', value: ftIn(160) },
        { kind: 'gte', measure: 'grossWeightLbs', value: 200000 },
      ],
    },
    {
      routeSurvey: true,
      manualReview:
        'New York requires a police escort at these dimensions (and whenever the load must cross the centreline of a structure, or exceeds 200 ft in length on a Thruway-controlled highway), but publishes no required number of police vehicles. The rates ARE published and are citable: as of 1 April 2026 the New York State Police charge $101.89 per hour at the regular rate, $144.66 per hour at overtime, and $0.725 per mile from the moment a trooper leaves the station, with a minimum of three hours per assigned officer at the overtime rate — those rates already include fringe benefits and indirect costs at 62.91% — so a single officer costs at least $433.98 before mileage. Because the officer count and hours are set by the agency on the day, no police-escort amount is included in the permit total. Note also that the WEIGHT boundary is itself disputed: the 2025 Certified Escort Manual says the trigger is where the load "exceeds 200,000 pounds" (exclusive) while Perm 87 and PERM 12S both say "200,000 POUNDS OR GREATER" (inclusive). The inclusive reading is used here, because it is the stricter one and a load at exactly 200,000 lb is a superload under the current superloads page on any reading; the disagreement bites for that one load and should be confirmed with the permitting office.',
    },
    NYSP_COMMERCIAL,
    '2026-04-01',
  ),
  /**
   * Perm 87's own Note 2 says in capitals that the form's requirements "ARE
   * ONLY GUIDELINES" and that actual requirements depend on highway geometry
   * and the location of the movement. That is a real, stated limit on how far
   * any table can be trusted, and it belongs on the quote — as an advisory,
   * not as a manual-review block, since it applies to every New York permit
   * and blocking on it would make the state unquotable.
   *
   * RECONCILED: extended with the unknowns the independent dataset surfaced.
   */
  escortRule(
    'ny-requirements-are-guidelines',
    'New York states that published escort requirements are guidelines only, and several attached costs are not published',
    { kind: 'gt', measure: 'widthIn', value: ftIn(8, 6) },
    {
      advisory:
        'NYSDOT Perm 87 states that its published escort requirements "are only guidelines" and that the actual requirements depend on highway geometry, the size and weight of the load, and where the movement runs. Escorts are also required whenever a speed restriction applies because of gross weight, whenever the load cannot stay within 20 mph of the posted speed, and whenever it must cross a bridge or culvert at under 5 mph — none of which can be known before the permit issues. Costs not included above: a traffic-control plan may be required at or over 18 ft wide and must be drawn by a New York licensed professional engineer; a superload requires a surety bond of $10,000 to $50,000 by dimension and weight, added together where several conditions apply; a licensed engineering firm may have to analyse bridges and accompany the load. New York also does not recognise escort certifications from other states — an operator needs a New York Certified Vehicle Escort Card, $40 to test and $40 to renew, which is the operator\'s cost and not a state permit fee.',
    },
    PERM_87,
    PERM_87_FROM,
  ),
];

// ── The jurisdiction ──────────────────────────────────────────────────────

export const NEW_YORK_OSOW_RULES: JurisdictionOsowRules = {
  code: 'NY',
  name: 'New York',
  country: 'US',

  legalLimits: {
    widthIn: [
      fromUndatedPage(
        102,
        VTL_385,
        '§385(1)(a): 96 in generally, 102 in on a qualifying or access highway, and 102 in on any other highway with lanes designed at 10 ft or more — except inside a city not wholly within one county, i.e. New York City. The 102 in figure is used, matching the federal National Network width; a load between 96 and 102 in on a narrow-lane non-qualifying highway would be over-width and is not caught here. Note also that the State Police commercial-vehicle page prints "102 inches (8 feet)", a parenthetical that contradicts both its own inches figure and the statute; it is a transcription error on a secondary page, not a competing legal limit, so it is not recorded as a conflicting row.',
      ),
      fromUndatedPage(102, VTL_385_DOT),
    ],
    heightIn: [
      fromUndatedPage(ftIn(13, 6), VTL_385, '§385(2): "not more than thirteen and one-half feet", inclusive of load'),
      fromUndatedPage(ftIn(13, 6), VTL_385_DOT),
    ],
    trailerLengthIn: [
      fromUndatedPage(
        ftIn(48),
        VTL_385,
        '§385(3)(b): a semitrailer or trailer "shall not exceed forty-eight feet". A semitrailer over 48 ft and up to 53 ft may run on a qualifying or specifically designated access highway if the kingpin-to-rear-axle distance is 43 ft or less and a rear-end protective device is fitted — route-dependent, not collected on a quote, so recorded here rather than applied.',
      ),
      fromUndatedPage(ftIn(48), VTL_385_DOT),
    ],
    /**
     * New York DOES cap the overall combination at 65 ft (§385(4)(a)), which
     * Texas does not. An 85 ft combination is over-length in New York on that
     * basis alone, and omitting this row would have shown the load as
     * over-width only.
     */
    overallLengthIn: [
      fromUndatedPage(
        ftIn(65),
        VTL_385,
        '§385(4)(a): "The total length of a combination of vehicles, inclusive of load and bumpers, shall not be more than sixty-five feet." The statute exempts qualifying/access-highway operations and specified vehicle and load types.',
      ),
      fromUndatedPage(ftIn(65), VTL_385_DOT),
    ],
    /**
     * RECONCILED: `frontOverhangIn` and `rearOverhangIn` are now ABSENT.
     *
     * The previous version of this file recorded 3 ft front and 4 ft rear as
     * New York legal limits, cited to "§385(4)(c)". Those are Texas's figures,
     * and an independent New York dataset built from the same statute found no
     * overhang limit in §385 at all. Rather than keep two numbers no source
     * supports, the field is omitted — which the engine reads as "this state
     * publishes no legal overhang limit" — and New York's real overhang rule,
     * a certified escort above 10 ft at whichever end overhangs, is in
     * `escortRules` where the state actually put it.
     */
    grossWeightLbs: [
      fromUndatedPage(
        80000,
        VTL_385,
        '§385(10): "In no case, however, shall the total weight exceed eighty thousand pounds." Below 71,000 lb New York allows the HIGHER of its own 34,000 lb + 1,000 lb per foot formula and the federal bridge formula; at or above 71,000 lb the bridge formula governs.',
      ),
      fromUndatedPage(80000, VTL_385_DOT),
    ],
    /** NOT the federal 20,000 — New York allows 22,400 lb. §385(8). */
    singleAxleLbs: [
      fromUndatedPage(22400, VTL_385, '§385(8): higher than the federal 20,000 lb limit; applies to pneumatic tires'),
    ],
    /** NOT the federal 34,000 — New York allows 36,000 lb. §385(9). */
    tandemAxleLbs: [
      fromUndatedPage(
        36000,
        VTL_385,
        '§385(9): higher than the federal 34,000 lb limit, for two consecutive axles spaced under 8 ft. At 8 ft to under 10 ft the pair is limited by the bridge formula AND by 40,000 lb; axles under 46 in apart count as one axle.',
      ),
    ],
  },

  /**
   * THE CONFLICT. $40 on the current fees page; $60 Region Office / $40 Main
   * Office in the regulation's own PERM43 (9/95) table. All three rows are
   * on file. The $40s corroborate each other and the $60 disagrees, so the
   * resolver returns null and the engine shows New York as a range.
   */
  permitBaseFeeUsd: [
    fromUndatedPage(40, NYSDOT_FEES, 'current published single-trip permit fee; every trip-permit type on the page is $40'),
    fromDated(40, NYCRR_154_1, '1995-09-01', '§154-1.20 fee table, "Main Office" column'),
    fromDated(
      60,
      NYCRR_154_1,
      '1995-09-01',
      '§154-1.20 fee table, "Region Office" column — every row in the table is $20 higher than the Main Office column, and VTL §385 authorises exactly that: a surcharge "of up to twenty dollars for the issuance and distribution of special hauling permits at regional offices". We cannot tell from the published sources which office issues a given permit, or whether the surcharge is currently levied at all, so this row is retained rather than discarded.',
    ),
  ],

  overweightPricing: [
    fromDated<OverweightPricing>(
      {
        kind: 'includedInBaseFee',
        explanation:
          '17 NYCRR §154-1.2(b)(1) defines a trip permit as authorising "an oversize and/or overweight vehicle" — one permit, one fee. NYSDOT publishes no weight bands and no per-mile component for a nondivisible trip permit.',
      },
      NYCRR_154_1,
      '1995-09-01',
    ),
    fromUndatedPage<OverweightPricing>(
      {
        kind: 'includedInBaseFee',
        explanation:
          'The NYSDOT fee page lists a single trip-permit fee with no overweight surcharge column, no weight bands, no per-axle charge and no per-mile term.',
      },
      NYSDOT_FEES,
    ),
  ],

  overweightBands: [],
  overweightPerMile: [],
  conditionalFees: [],

  /**
   * ZERO, and sourced — not an absent row. The NYSDOT fees page carries the
   * footnote "Fees do not include any permit service company charges", which
   * is the state saying in its own words that the only charge it makes is the
   * permit fee. That is a positive finding and it is what makes the $29
   * "service fee" on a competitor quote identifiable as a broker charge.
   */
  transactionFee: [
    fromUndatedPage<TransactionFee>(
      { perPermitUsd: 0, percentOfTotal: 0 },
      NYSDOT_FEES,
      'New York charges no processing, convenience or credit-card fee. The fee page states "Fees do not include any permit service company charges" — i.e. a service charge on a quote is the broker\'s, not the state\'s. UNKNOWN and recorded rather than assumed: whether the $20 regional-office surcharge VTL §385 authorises is presently levied. Note also that a three-way movement is charged TWO permit fees under §154-1.20; this engine prices a one-way single trip.',
    ),
  ],

  routeAnalysisFeeUsd: [
    fromUndatedPage(
      0,
      NYSDOT_SUPERLOADS,
      'No route or bridge analysis fee is published by NYSDOT, and the superload permit itself is the same $40. What a superload does add is not a state fee: a surety bond ($10,000–$50,000, added together across qualifying dimensions and weight), a route survey performed and certified by a New York Certified Escort, and — for some moves — a licensed engineering firm retained by the permittee to analyse bridges and accompany the load. Those are private costs and none is included in the permit total.',
    ),
  ],
  noBridgeRouteFeeUsd: [fromUndatedPage(0, NYSDOT_SUPERLOADS)],

  superload: {
    grossWeight: [
      fromUndatedPage<Threshold>(
        { value: 200000, inclusive: true },
        NYSDOT_SUPERLOADS,
        '"200,000 pounds or greater" — inclusive, so a load at exactly 200,000 lb is a superload',
      ),
      fromDated<Threshold>(
        { value: 200000, inclusive: true },
        PERM_12S,
        '2014-02-01',
        '"or 200,000 pounds or greater in gross weight" — the linked form agrees with the current page on weight',
      ),
    ],
    shortSpacing: [],
    widthIn: [
      fromUndatedPage<Threshold>({ value: ftIn(16), inclusive: false }, NYSDOT_SUPERLOADS, '"exceed 16 feet in width"'),
      fromDated<Threshold>({ value: ftIn(16), inclusive: false }, PERM_12S, '2014-02-01', '"which exceed 16 feet in width"'),
    ],
    heightIn: [
      fromUndatedPage<Threshold>({ value: ftIn(16), inclusive: true }, NYSDOT_SUPERLOADS, '"16 feet in height or greater"'),
      fromDated<Threshold>({ value: ftIn(16), inclusive: true }, PERM_12S, '2014-02-01', '"at or greater than 16 feet in height"'),
    ],
    /**
     * RECONCILED: a real boundary conflict, added. The current superloads page
     * says "greater than 160 feet in length" — exclusive. PERM 12S, which that
     * same page links to, says "at or greater than 160 feet in length" —
     * inclusive. They differ for exactly one load, one measuring 160 ft 0 in,
     * and the engine now surfaces the disagreement only for a load in that gap
     * rather than on every New York quote.
     */
    overallLengthIn: [
      fromUndatedPage<Threshold>({ value: ftIn(160), inclusive: false }, NYSDOT_SUPERLOADS, '"greater than 160 feet in length"'),
      fromDated<Threshold>(
        { value: ftIn(160), inclusive: true },
        PERM_12S,
        '2014-02-01',
        '"at or greater than 160 feet in length" — inclusive, and still linked from the current superloads page',
      ),
    ],
  },

  /**
   * RECONCILED: the route-survey triggers were attributed to the 2025 Escort
   * Manual. The independent dataset ties them, with verbatim quotes, to Perm 87
   * instead — the values are identical, so both rows are kept and the resolver
   * reads them as the corroboration they are. Nothing is lost and the earlier
   * attribution is no longer the only evidence.
   */
  routeInspection: {
    widthIn: [
      fromDated<Threshold>({ value: ftIn(16), inclusive: true }, PERM_87, PERM_87_FROM, 'Perm 87: route survey required at 16 ft wide'),
      fromDated<Threshold>({ value: ftIn(16), inclusive: true }, ESCORT_MANUAL, MANUAL_FROM, 'route survey required at 16 ft wide'),
    ],
    heightIn: [
      fromDated<Threshold>({ value: ftIn(14), inclusive: true }, PERM_87, PERM_87_FROM, 'Perm 87: "14\'-0" AND OVER ... ROUTE SURVEY REQUIRED". A mobile/manufactured home or modular unit triggers a survey at 14 ft 1 in.'),
      fromDated<Threshold>({ value: ftIn(14), inclusive: true }, ESCORT_MANUAL, MANUAL_FROM, 'route survey required at 14 ft high'),
    ],
    lengthIn: [
      fromDated<Threshold>({ value: ftIn(100), inclusive: true }, PERM_87, PERM_87_FROM, 'Perm 87: "100\' OR GREATER ... ROUTE SURVEY REQUIRED"'),
      fromDated<Threshold>({ value: ftIn(100), inclusive: true }, ESCORT_MANUAL, MANUAL_FROM, 'route survey required at 100 ft long'),
    ],
  },

  escortRules: NEW_YORK_ESCORT_RULES,

  /**
   * The Thruway is a separate permit with its own ton-mile fee, and the
   * reciprocity that lets a NYSDOT permit travel onto it covers DIVISIBLE
   * loads only. `priceable: false` because we hold TAP-623's rate structure
   * but not the definition of the miles it multiplies — TAP-623 states the
   * formula and never says how the mileage is measured, so computing it would
   * mean inventing the one input the document withholds.
   */
  additionalAuthorities: [
    fromDated<AdditionalAuthority>(
      {
        name: 'New York State Thruway Authority',
        appliesWhen:
          'A nondivisible oversize/overweight load travelling on the Thruway (I-87, I-90 Mainline, I-190) needs a Thruway permit in addition to the NYSDOT permit — the reciprocity that honours a NYSDOT permit on the Thruway applies to Divisible Load Permits only. Note also that TAP-623 caps width on the Thruway Mainline and the Governor Mario M. Cuomo Bridge at 12 ft 6 in, so a wider load cannot use those roads at all and must route on NYSDOT highways.',
        priceable: false,
      },
      NYSTA_TAP_623,
      '2021-05-01',
      'Fee structure is published — a basic fee of $21.00 north of Woodbury plus tons-overweight × a rate × miles ($0.03 / $0.05 / $0.08 by weight band) — but TAP-623 never defines how the miles are measured, so the amount cannot be computed from the document alone.',
    ),
    fromDated<AdditionalAuthority>(
      {
        name: 'New York State Bridge Authority',
        appliesWhen:
          'A load crossing a Bridge Authority facility needs that authority\'s own permit.',
        priceable: false,
      },
      ESCORT_MANUAL,
      MANUAL_FROM,
      'The Escort Manual confirms the authority issues its own permits; no fee schedule was located, so no amount is on file.',
    ),
    /**
     * RECONCILED: added. VTL §385 is explicit that a NYSDOT permit "shall not
     * be valid for the operation or movement of such vehicles on any state or
     * other highway within any city not wholly included within one county" —
     * New York City. A load delivering into the five boroughs needs a separate
     * NYC permit that this engine holds nothing for, and a $40 NYSDOT line with
     * no mention of it would look complete while missing the permit that
     * actually gets the truck to the consignee.
     */
    fromUndatedPage<AdditionalAuthority>(
      {
        name: 'New York City (NYC DOT)',
        appliesWhen:
          'A movement on any state or other highway inside New York City. VTL §385 says a NYSDOT special hauling permit "shall not be valid" there, so a load entering the five boroughs needs New York City\'s own permit under its own rules and fees.',
        priceable: false,
      },
      VTL_385_DOT,
      'No New York City legal limits, permit fees or escort rules are on file. This is a coverage gap, not a finding that none exist.',
    ),
  ],

  /** NYSDOT's trip permit is a flat fee — no mileage component. */
  feesDependOnDistance: false,
};

/** Cited for the 30-day route-survey validity and the certified-escort surveyor requirement. */
export const NEW_YORK_ROUTE_SURVEY_SOURCE = PERM_85;

/** Cited for the traffic-control-plan threshold at or over 18 ft wide. */
export const NEW_YORK_TRAFFIC_CONTROL_PLAN_SOURCE = NY_TCP;

/** Cited for escort-driver certification costs — the operator's, never the state's. */
export const NEW_YORK_ESCORT_CERTIFICATION_SOURCE = NY_DMV_ESCORT;
