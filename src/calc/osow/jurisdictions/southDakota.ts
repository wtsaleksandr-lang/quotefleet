/**
 * SOUTH DAKOTA — oversize/overweight single-trip permit rules.
 *
 * AN OVERWEIGHT FEE THAT IGNORES THE BRIDGE FORMULA ENTIRELY, AND ESCORTS
 * TRIGGERED BY NAMED ROADS RATHER THAN BY ROAD CLASS.
 * ═══════════════════════════════════════════════════════════════════════════
 * ARSD 70:03:01:02 charges "two cents for each ton or fraction of a ton that
 * its gross weight exceeds the following weight limits, for each mile
 * travelled on state trunk highways" — and the limits it then lists are FIXED
 * PER AXLE COUNT:
 *
 *   2 axles ......... 40,000 lb          5 axles ......... 85,000 lb
 *   3 axles ......... 60,000 lb          6 axles ......... 90,000 lb
 *   4 axles ......... 80,000 lb          7 or more ....... 95,000 lb
 *
 * THIS IS NOT THE LEGAL LIMIT AND IT MUST NOT BE CONFUSED WITH IT. South
 * Dakota's legal weight is the ordinary axle-and-bridge-formula scheme; this
 * is a separate, purely fiscal ladder that decides where the meter starts. A
 * six-axle combination at 92,000 lb is charged on 2 tons of excess against
 * the 90,000 lb fee threshold, not on 12 tons against 80,000. Pricing this
 * state off the bridge formula would overcharge nearly every heavy move, and
 * pricing it off a flat 80,000 would overcharge every combination with five
 * axles or more.
 *
 * AND THE MILEAGE BASE IS ROUTE-CONDITIONED: "for each mile travelled ON STATE
 * TRUNK HIGHWAYS". Not every mile in the state. A lane that runs partly on
 * county or municipal roads accrues no ton-mile fee for those miles. The
 * engine's in-state mileage is a whole-state figure, so this file records the
 * narrower base rather than silently treating the two as the same — see
 * `sd-ton-mile-base-is-trunk-highways-only`.
 *
 * THE ROUNDING IS PUBLISHED AND IT ROUNDS UP. "each ton or FRACTION OF A TON"
 * — a 2.1-ton excess is billed as three tons. Most states in this corpus leave
 * the partial increment unstated and force a spread; South Dakota states it,
 * so it is encoded rather than flagged.
 *
 * THERE IS ALSO A ONE-DOLLAR FLOOR under the ton-mile charge, which is
 * genuinely reachable: "This additional fee may not be less than one dollar."
 * A single ton of excess over four miles computes to $0.08 and is billed at
 * $1.00.
 *
 * ESCORTS ARE TRIGGERED BY NAMED HIGHWAYS, NOT BY A ROAD CLASS.
 * ------------------------------------------------------------
 * ARSD 70:03:01:20 has four limbs and two of them enumerate specific highway
 * segments by name and endpoint:
 *
 *   (1) interstate system ............................ over 16 ft
 *   (2) TWELVE NAMED BLACK HILLS SEGMENTS ............ over 10 ft, front
 *   (3) SEVEN NAMED REGIONAL SEGMENTS ................ over 16 ft, front
 *   (4) all other state trunk highways ............... over 20 ft
 *
 * The gap between limb (2) and limb (4) is a factor of two in width on roads
 * a quote cannot tell apart without knowing the actual route. A 12 ft load is
 * escort-free on most of the state and needs a front escort on US 14A through
 * Spearfish. Treating South Dakota as a single 20 ft state — which is what a
 * road-class model would do — drops the escort on every Black Hills move.
 *
 * So the named segments are carried as `NamedRouteSegment`s and a load whose
 * route is not stated resolves those limbs as UNKNOWN rather than false. That
 * is the honest outcome: the requirement may exist and the quote cannot see it.
 *
 * POSITION IS SET BY ROAD TYPE, NOT BY THE TRIGGER. The section opens "Escort
 * vehicles are required in front on two-lane highways or in the rear on
 * divided highways as follows", so limbs (1) and (4) inherit that split while
 * (2) and (3) say "front escort" outright and override it. The count is one
 * either way, so `escorts` carries the number and `front`/`rear` are set only
 * where the rule fixes the position itself.
 *
 * WHAT SOUTH DAKOTA DOES NOT TRIGGER ESCORTS ON — ALL CHECKED
 * ----------------------------------------------------------
 * Width and nothing else. ARSD 70:03:01:20 has no length limb, no height limb
 * and no weight limb for general freight, and all three absences were read off
 * the rule rather than inferred from its silence. A 200,000 lb load at legal
 * width needs no escort in South Dakota. There are length triggers in the
 * SPECIAL-VEHICLE rules — utility poles over 75 ft under 70:03:01:109,
 * earthmoving equipment under 70:03:01:24 — and neither is general freight.
 *
 * SUPERLOAD IS A QUEUE, NOT A PRICE.
 * ----------------------------------
 * South Dakota does not use the word "superload" in statute or administrative
 * code. What it publishes is a PROCESSING threshold: over 200,000 lb, or
 * overweight and over 12 ft wide, or over 16 ft high, "may take longer" than
 * the usual two working days. THE FEE DOES NOT CHANGE — the heaviest
 * imaginable South Dakota move still pays $25 plus $0.02 per ton-mile. This is
 * recorded as a published absence rather than as a threshold, because encoding
 * it as a superload class would imply a fee tier that does not exist.
 *
 * WHAT IS DELIBERATELY ABSENT
 * ---------------------------
 *   - `overallLengthIn` is ABSENT on a published negative, not a gap. SDCL
 *     32-22-8.1 caps the semitrailer at 53 ft and then says "No other length
 *     limitation may be imposed on the vehicles described in this section."
 *     Recording an overall figure would flag every ordinary tractor-semitrailer
 *     in the state as over-length.
 *   - NO POLICE ESCORT RATE. Neither the Highway Patrol nor the Department of
 *     Public Safety publishes an escort fee schedule, hourly rate, mileage
 *     rate, minimum hours or cancellation charge. The Motor Carrier Handbook
 *     says only that some applications "require review by the Department of
 *     Transportation or the Highway Patrol" — a review, not an escort.
 *   - NO HEIGHT-POLE REQUIREMENT. ARSD 70:03:01:13 assigns the duty and states
 *     no equipment: "All vertical clearances are the responsibility of the
 *     permit holder." No height, no spec.
 *   - NO PROCESSING OR PERCENTAGE FEE. Nothing of the kind is codified in ARSD
 *     70:03:01 or in statute, and the portal takes credit card or escrow
 *     without a published surcharge.
 *   - THE 10% CAP AND THE TRIPLE-AXLE-WIDTH RULE are recorded and not applied.
 *     A 2-, 3- or 4-axle vehicle hauling a non-divisible load may not be
 *     permitted over 10% overweight, and no overwidth load may exceed three
 *     times the narrowest trailer axle width. Both are ELIGIBILITY rules — they
 *     decide whether a permit issues at all, not what it costs — and both need
 *     equipment facts a quote does not collect.
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

const FEE_FROM = '2004-09-06';
const ESCORT_FROM = '2023-05-01';
const HANDBOOK_FROM = '2021-12-01';

// ── Source documents ──────────────────────────────────────────────────────

const SDCL_32_22_3: SourceDoc = {
  id: 'sd-sdcl-32-22-3',
  title: 'SDCL 32-22-3 — Maximum width of vehicles',
  url: 'https://sdlegislature.gov/Statutes/32-22-3',
  publisher: 'South Dakota Legislature',
  revisedOn: '2005-07-01',
  retrievedOn: RETRIEVED,
  cite: 'The state\'s own statute host. Corroborated by the SD Motor Carrier Handbook chapter 5.',
};

const SDCL_32_22_14: SourceDoc = {
  id: 'sd-sdcl-32-22-14',
  title: 'SDCL 32-22-14 — Maximum height of vehicles',
  url: 'https://sdlegislature.gov/Statutes/32-22-14',
  publisher: 'South Dakota Legislature',
  revisedOn: '2020-02-26',
  retrievedOn: RETRIEVED,
  cite: 'The freshest of the three legal-limit statutes.',
};

const SDCL_32_22_5: SourceDoc = {
  id: 'sd-sdcl-32-22-5',
  title: 'SDCL 32-22-5 — Maximum length, single vehicle',
  url: 'https://sdlegislature.gov/Statutes/32-22-5',
  publisher: 'South Dakota Legislature',
  revisedOn: '2005-07-01',
  retrievedOn: RETRIEVED,
  cite: '45 ft, inclusive of front and rear bumpers.',
};

const SDCL_32_22_8_1: SourceDoc = {
  id: 'sd-sdcl-32-22-8-1',
  title: 'SDCL 32-22-8.1 — Semitrailer length; no other length limitation',
  url: 'https://sdlegislature.gov/Statutes/32-22-8.1',
  publisher: 'South Dakota Legislature',
  revisedOn: '1998-07-01',
  retrievedOn: RETRIEVED,
  cite:
    'Carries the express negative that makes `overallLengthIn` absent: "No other length limitation may be imposed on the vehicles described in this section."',
};

const ARSD_FEES: SourceDoc = {
  id: 'sd-arsd-70-03-01-02',
  title: 'ARSD 70:03:01:02 — Permit fees; overweight ton-mile charge',
  url: 'https://sdlegislature.gov/Rules/Administrative/70:03:01:02',
  publisher: 'South Dakota Administrative Rules',
  revisedOn: FEE_FROM,
  retrievedOn: RETRIEVED,
  cite:
    'The whole fee model: the $25 flat permit, the $0.02 ton-mile charge, the axle-count fee thresholds, the "fraction of a ton" rounding, the $1.00 floor and the public-agency exemption.',
};

const ARSD_ESCORTS: SourceDoc = {
  id: 'sd-arsd-70-03-01-20',
  title: 'ARSD 70:03:01:20 — Escort vehicles required',
  url: 'https://sdlegislature.gov/Rules/Administrative/70:03:01:20',
  publisher: 'South Dakota Administrative Rules',
  revisedOn: ESCORT_FROM,
  retrievedOn: RETRIEVED,
  cite:
    'Four limbs, two of which enumerate named highway segments by endpoint. The freshest South Dakota document on file.',
};

const ARSD_TRAFFIC_HANDLING: SourceDoc = {
  id: 'sd-arsd-70-03-01-20-01',
  title: 'ARSD 70:03:01:20.01 — Special traffic handling',
  url: 'https://sdlegislature.gov/Rules/Administrative/70:03:01:20.01',
  publisher: 'South Dakota Administrative Rules',
  revisedOn: '1991-04-08',
  retrievedOn: RETRIEVED,
  cite:
    'The lane-encroachment rule. Thirty-five years old and still the operative text; an old rule in force is not a stale document.',
};

const ARSD_CLEARANCE: SourceDoc = {
  id: 'sd-arsd-70-03-01-13',
  title: 'ARSD 70:03:01:13 — Permit holders responsible for vertical clearances',
  url: 'https://sdlegislature.gov/Rules/Administrative/70:03:01:13',
  publisher: 'South Dakota Administrative Rules',
  revisedOn: '1987-07-01',
  retrievedOn: RETRIEVED,
  cite:
    'The entire rule is one sentence — "All vertical clearances are the responsibility of the permit holder." — which is why no height-pole spec exists to record.',
};

const ARSD_DEFINITIONS: SourceDoc = {
  id: 'sd-arsd-70-03-01-01',
  title: 'ARSD 70:03:01:01 — Definitions, including the highway systems',
  url: 'https://sdlegislature.gov/Rules/Administrative/70:03:01:01',
  publisher: 'South Dakota Administrative Rules',
  revisedOn: '2003-06-02',
  retrievedOn: RETRIEVED,
  cite:
    'Defines the interstate, state highway and state trunk highway systems. The escort rules add "two-lane"/"undivided" against "divided" without defining either.',
};

const SD_HANDBOOK: SourceDoc = {
  id: 'sd-motor-carrier-handbook-ch6',
  title: 'South Dakota Motor Carrier Handbook, chapter 6 — Permits',
  url: 'https://sdtruckinfo.sd.gov/rules-regulations/motor-carrier-handbook/chapter-6/permits/',
  publisher: 'South Dakota Department of Transportation',
  revisedOn: HANDBOOK_FROM,
  retrievedOn: RETRIEVED,
  cite:
    'The operational document. Source of the processing-queue thresholds, the 10% overweight cap and the triple-axle-width rule.',
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

// ── Route vocabulary and the named segments ───────────────────────────────

const SOUTH_DAKOTA_ROUTE_VOCABULARY: RouteVocabulary = {
  name: 'ARSD 70:03:01:01 highway systems, plus the escort rule\'s divided/two-lane split',
  explanation:
    'South Dakota classifies roads twice over and the two schemes do different jobs. ARSD 70:03:01:01 defines the INTERSTATE HIGHWAY SYSTEM, the STATE HIGHWAY SYSTEM and the STATE TRUNK HIGHWAY SYSTEM (which contains both of the others) — that scheme decides which miles the ton-mile fee is charged on. ARSD 70:03:01:20 then splits roads into "two-lane highways" and "divided highways" to decide whether an escort rides in front or behind, and defines neither term. The two schemes are orthogonal: an interstate is a divided road on the state trunk system, and a two-lane US highway is an undivided road on the same system. Both are carried because both change an answer — the first the price, the second the escort position.',
  classes: [
    {
      id: 'SD:interstate',
      publishedName: 'interstate highway system',
      quote:
        'ARSD 70:03:01:01(13): "\'Interstate highway system,\' all highways on the national system of interstate highways". ARSD 70:03:01:20(1) sets its own escort trigger against it: "Vehicles over sixteen feet wide traveling on the interstate highway system require an escort."',
      generalEquivalents: ['interstate', 'divided'],
    },
    {
      id: 'SD:state-trunk-other',
      publishedName: 'all other highways on the state trunk highway system',
      quote:
        'ARSD 70:03:01:20(4): "For all other highways on the state trunk highway system, vehicles over twenty feet wide require an escort." ARSD 70:03:01:01(26) defines the state trunk highway system as everything DOT administers, including the state highway system and the interstate system.',
      generalEquivalents: ['two-lane', 'multilane-undivided', 'divided'],
    },
  ],
};

/**
 * THE TWELVE 10-FOOT SEGMENTS. ARSD 70:03:01:20(2), reproduced by endpoint
 * because the rule identifies them that way and a bare route number would be
 * wrong — US 385 appears in this list for two stretches and in the 16 ft list
 * for a third.
 */
const SD_FRONT_ESCORT_10FT_SEGMENTS: NamedRouteSegment[] = [
  {
    id: 'SD:us14a-spearfish-to-us85-south',
    route: 'US 14A',
    fromDescription: 'its intersection with Colorado Boulevard in Spearfish',
    toDescription: 'its south junction with U.S. Highway 85',
    quote:
      'ARSD 70:03:01:20(2): "Vehicles over ten feet wide traveling on the following highways require a front escort".',
  },
  {
    id: 'SD:us85-wy-line-to-us14a',
    route: 'US 85',
    fromDescription: 'the Wyoming state line',
    toDescription: 'its southernmost junction with U.S. Highway 14A, and from its junction with U.S. Highway 14A in Lead to its junction with U.S. Highway 14A in Deadwood',
    quote:
      'ARSD 70:03:01:20(2): "Vehicles over ten feet wide traveling on the following highways require a front escort".',
  },
  {
    id: 'SD:us385-us16-to-us85',
    route: 'US 385',
    fromDescription: 'its north junction with U.S. Highway 16',
    toDescription: 'its junction with U.S. Highway 85',
    quote:
      'ARSD 70:03:01:20(2): "Vehicles over ten feet wide traveling on the following highways require a front escort".',
  },
  {
    id: 'SD:us385-hotsprings-to-sd89-pringle',
    route: 'US 385',
    fromDescription: 'its junction with U.S. Highway 18 in Hot Springs',
    toDescription: 'its junction with State Trunk Highway 89 in Pringle',
    quote:
      'ARSD 70:03:01:20(2): "Vehicles over ten feet wide traveling on the following highways require a front escort".',
  },
  {
    id: 'SD:sd44-us385-to-us16b',
    route: 'SD 44',
    fromDescription: 'its junction with U.S. Highway 385',
    toDescription: 'its junction with U.S. Highway 16B',
    quote:
      'ARSD 70:03:01:20(2): "Vehicles over ten feet wide traveling on the following highways require a front escort".',
  },
  {
    id: 'SD:sd231',
    route: 'SD 231',
    fromDescription: 'the start of the route',
    toDescription: 'the end of the route',
    quote:
      'ARSD 70:03:01:20(2): "Vehicles over ten feet wide traveling on the following highways require a front escort".',
  },
  {
    id: 'SD:us16a',
    route: 'US 16A',
    fromDescription: 'the start of the route',
    toDescription: 'the end of the route',
    quote:
      'ARSD 70:03:01:20(2): "Vehicles over ten feet wide traveling on the following highways require a front escort".',
  },
  {
    id: 'SD:sd244',
    route: 'SD 244',
    fromDescription: 'the start of the route',
    toDescription: 'the end of the route',
    quote:
      'ARSD 70:03:01:20(2): "Vehicles over ten feet wide traveling on the following highways require a front escort".',
  },
  {
    id: 'SD:sd87',
    route: 'SD 87',
    fromDescription: 'the start of the route',
    toDescription: 'the end of the route',
    quote:
      'ARSD 70:03:01:20(2): "Vehicles over ten feet wide traveling on the following highways require a front escort".',
  },
  {
    id: 'SD:sd89-custer-to-sd87',
    route: 'SD 89',
    fromDescription: 'its junction with U.S. Highway 16A in Custer',
    toDescription: 'its junction with State Trunk Highway 87',
    quote:
      'ARSD 70:03:01:20(2): "Vehicles over ten feet wide traveling on the following highways require a front escort".',
  },
  {
    id: 'SD:sd36',
    route: 'SD 36',
    fromDescription: 'the start of the route',
    toDescription: 'the end of the route',
    quote:
      'ARSD 70:03:01:20(2): "Vehicles over ten feet wide traveling on the following highways require a front escort".',
  },
  {
    id: 'SD:sd40-us16a-to-sd79',
    route: 'SD 40',
    fromDescription: 'its junction with U.S. Highway 16A',
    toDescription: 'its junction with State Trunk Highway 79',
    quote:
      'ARSD 70:03:01:20(2): "Vehicles over ten feet wide traveling on the following highways require a front escort".',
  },
  {
    id: 'SD:sd473',
    route: 'SD 473',
    fromDescription: 'the start of the route',
    toDescription: 'the end of the route',
    quote:
      'ARSD 70:03:01:20(2): "Vehicles over ten feet wide traveling on the following highways require a front escort".',
  },
];

/** THE SEVEN 16-FOOT SEGMENTS. ARSD 70:03:01:20(3). */
const SD_FRONT_ESCORT_16FT_SEGMENTS: NamedRouteSegment[] = [
  {
    id: 'SD:us16-keystone-wye-to-wy',
    route: 'US 16',
    fromDescription: 'its east junction with U.S. Highway 16A at the Keystone Wye',
    toDescription: 'the Wyoming border',
    quote:
      'ARSD 70:03:01:20(3): "Vehicles over sixteen feet wide traveling on the following highways require a front escort".',
  },
  {
    id: 'SD:us14a-us85-to-i90-exit30',
    route: 'US 14A',
    fromDescription: 'its south junction with U.S. Highway 85',
    toDescription: 'its junction with Intertate 90 at Exit 30',
    quote:
      'ARSD 70:03:01:20(3): "Vehicles over sixteen feet wide traveling on the following highways require a front escort".',
  },
  {
    id: 'SD:us385-sd89-to-us16',
    route: 'US 385',
    fromDescription: 'its junction with State Trunk Highway 89',
    toDescription: 'its junction with U.S. Highway 16',
    quote:
      'ARSD 70:03:01:20(3): "Vehicles over sixteen feet wide traveling on the following highways require a front escort".',
  },
  {
    id: 'SD:sd89-us18-to-us385-pringle',
    route: 'SD 89',
    fromDescription: 'its junction with U.S. Highway 18',
    toDescription: 'its junction with U.S. Highway 385 at Pringle',
    quote:
      'ARSD 70:03:01:20(3): "Vehicles over sixteen feet wide traveling on the following highways require a front escort".',
  },
  {
    id: 'SD:sd85-deadwood-to-i90-exit17',
    route: 'SD 85',
    fromDescription: 'its north junction with U.S. Highway 14A in Deadwood',
    toDescription: 'its junction with Interstate 90 at Exit 17',
    quote:
      'ARSD 70:03:01:20(3): "Vehicles over sixteen feet wide traveling on the following highways require a front escort".',
  },
  {
    id: 'SD:sd71-hotsprings-to-ne',
    route: 'SD 71',
    fromDescription: 'its junction with U.S. Highway 18 in Hot Springs',
    toDescription: 'the Nebraska border',
    quote:
      'ARSD 70:03:01:20(3): "Vehicles over sixteen feet wide traveling on the following highways require a front escort".',
  },
  {
    id: 'SD:sd471-sd71-to-us18-edgemont',
    route: 'SD 471',
    fromDescription: 'its junction with State Trunk Highway 71',
    toDescription: 'its junction with U.S. Highway 18 at Edgemont',
    quote:
      'ARSD 70:03:01:20(3): "Vehicles over sixteen feet wide traveling on the following highways require a front escort".',
  },
];

const ON_10FT_SEGMENTS: ContextCondition = {
  kind: 'onNamedSegment',
  segmentIds: SD_FRONT_ESCORT_10FT_SEGMENTS.map((s) => s.id),
};
const ON_16FT_SEGMENTS: ContextCondition = {
  kind: 'onNamedSegment',
  segmentIds: SD_FRONT_ESCORT_16FT_SEGMENTS.map((s) => s.id),
};
const ON_INTERSTATE: ContextCondition = { kind: 'routeClassIn', anyOf: ['SD:interstate'] };

function escortRule(
  id: string,
  description: string,
  when: EscortRule['when'],
  then: EscortRule['then'],
  source: SourceDoc,
  effectiveFrom: string,
): EscortRule {
  return { id, jurisdiction: 'SD', description, when, then, source, effectiveFrom, effectiveTo: null };
}

export const SOUTH_DAKOTA_ESCORT_RULES: EscortRule[] = [
  escortRule(
    'sd-escort-interstate-16ft',
    'Over 16 ft wide on the interstate system — one escort, riding in the rear because the interstate is divided',
    {
      kind: 'all',
      of: [
        { kind: 'gt', measure: 'widthIn', value: ftIn(16) },
        { kind: 'context', of: ON_INTERSTATE },
      ],
    },
    { escorts: 1, rear: 1 },
    ARSD_ESCORTS,
    ESCORT_FROM,
  ),
  /**
   * THE BLACK HILLS LIMB, and the one a road-class model cannot see. Ten feet
   * is only eighteen inches over the legal 8 ft 6 in, so this catches loads
   * that are barely oversize anywhere else in the state.
   */
  escortRule(
    'sd-escort-named-segments-10ft-front',
    'Over 10 ft wide on any of the twelve named Black Hills segments — one FRONT escort, whatever the road type',
    {
      kind: 'all',
      of: [
        { kind: 'gt', measure: 'widthIn', value: ftIn(10) },
        { kind: 'context', of: ON_10FT_SEGMENTS },
      ],
    },
    { escorts: 1, front: 1 },
    ARSD_ESCORTS,
    ESCORT_FROM,
  ),
  escortRule(
    'sd-escort-named-segments-16ft-front',
    'Over 16 ft wide on any of the seven named regional segments — one FRONT escort, whatever the road type',
    {
      kind: 'all',
      of: [
        { kind: 'gt', measure: 'widthIn', value: ftIn(16) },
        { kind: 'context', of: ON_16FT_SEGMENTS },
      ],
    },
    { escorts: 1, front: 1 },
    ARSD_ESCORTS,
    ESCORT_FROM,
  ),
  /**
   * THE CATCH-ALL. Position is not fixed by the rule — the section's preamble
   * puts the escort "in front on two-lane highways or in the rear on divided
   * highways" — so only the COUNT is asserted here. The count is one either
   * way, which is what the money depends on.
   */
  escortRule(
    'sd-escort-other-trunk-20ft',
    'Over 20 ft wide on all other state trunk highways — one escort, in front on two-lane roads and in the rear on divided roads',
    { kind: 'gt', measure: 'widthIn', value: ftIn(20) },
    { escorts: 1 },
    ARSD_ESCORTS,
    ESCORT_FROM,
  ),
  /**
   * SPECIAL TRAFFIC HANDLING. Real, and not a count: the rule names "escorts
   * and flagpersons located in the front or rear of the vehicle, or both, or
   * as required by the permit-issuing authority", which is a menu rather than
   * a number. It also turns on lane encroachment, which needs the actual lane
   * width of the actual route. Advisory.
   */
  escortRule(
    'sd-special-traffic-handling',
    'A load that encroaches more than 2 ft into an adjacent lane, or that leaves less than a 10 ft passing lane, requires special traffic handling',
    { kind: 'gt', measure: 'widthIn', value: ftIn(12) },
    {
      advisory:
        'ARSD 70:03:01:20.01 requires "special traffic handling" — escorts, flagpersons, or both, as the permit-issuing authority requires — where the load extends more than two feet into an adjacent driving or passing lane, or where normal traffic cannot pass without one vehicle using the shoulder: "A lane at least ten feet wide must be allowed for normal traffic to pass an overwidth vehicle." Whether that happens depends on the lane width of the actual route, which a quote does not state, and the rule fixes no count. Nothing is added to the price for it.',
    },
    ARSD_TRAFFIC_HANDLING,
    '1991-04-08',
  ),
];

export const SOUTH_DAKOTA_OSOW_RULES: JurisdictionOsowRules = {
  code: 'SD',
  name: 'South Dakota',
  country: 'US',

  routeVocabulary: [
    fromDated<RouteVocabulary>(SOUTH_DAKOTA_ROUTE_VOCABULARY, ARSD_DEFINITIONS, '2003-06-02'),
  ],

  routeSegments: [
    ...SD_FRONT_ESCORT_10FT_SEGMENTS.map((seg) =>
      fromDated<NamedRouteSegment>(seg, ARSD_ESCORTS, ESCORT_FROM),
    ),
    ...SD_FRONT_ESCORT_16FT_SEGMENTS.map((seg) =>
      fromDated<NamedRouteSegment>(seg, ARSD_ESCORTS, ESCORT_FROM),
    ),
  ],

  legalLimits: {
    widthIn: [
      fromDated(
        102,
        SDCL_32_22_3,
        '2005-07-01',
        'SDCL 32-22-3: "no motor vehicle may operate upon a public highway if the width, measured at the widest points, either of the vehicle or the load, exceeds one hundred two inches, excluding any required safety equipment." EXCLUSIVE. Note the measurement is taken "at the widest points" of the vehicle OR the load, whichever is wider, with required safety equipment excluded. Farm machinery under § 32-22-3.2 and recreation vehicles are carved out and are not freight.',
      ),
    ],
    heightIn: [
      fromDated(
        ftIn(14),
        SDCL_32_22_14,
        '2020-02-26',
        'SDCL 32-22-14: "no motor vehicle may operate upon a public highway if the maximum height of the vehicle, including the load on the vehicle, exceeds fourteen feet." EXCLUSIVE, and 14 ft rather than 13 ft 6 in. Trailers carrying baled feed get 15 ft, and farm machinery and fire equipment have no height limit at all — none is general freight.',
      ),
    ],
    trailerLengthIn: [
      fromDated(
        ftIn(53),
        SDCL_32_22_8_1,
        '1998-07-01',
        'SDCL 32-22-8.1(1): "Fifty-three feet on the length of the semitrailer unit operating in a truck tractor-semitrailer combination". INCLUSIVE at 53 ft — the statute grants the length rather than prohibiting excess, so 53 ft exactly is permitted. Applies on the National Network and the interstate and state trunk highway systems. SDCL 32-22-5 separately caps a SINGLE vehicle at 45 ft "inclusive of front and rear bumpers", which is a straight truck and not this combination.',
      ),
    ],
    /**
     * ABSENT ON AN EXPRESS PUBLISHED NEGATIVE. SDCL 32-22-8.1 closes: "No other
     * length limitation may be imposed on the vehicles described in this
     * section." South Dakota grants the semitrailer 53 ft and then forbids any
     * overall combination limit on top of it. Recording an overall figure here
     * would flag every ordinary tractor-semitrailer in the state as
     * over-length, on a limit the legislature expressly refused to impose.
     */
    grossWeightLbs: [
      fromDated(
        80_000,
        SD_HANDBOOK,
        HANDBOOK_FROM,
        'The ordinary federal gross for the interstate and state trunk systems, subject to the bridge formula. DO NOT CONFUSE THIS WITH THE FEE THRESHOLDS: ARSD 70:03:01:02 sets separate, purely fiscal weight limits per axle count — 40,000 lb at two axles rising to 95,000 lb at seven or more — and those decide where the ton-mile meter starts, not whether the load is legal. A five-axle combination at 84,000 lb is overweight against this limit and accrues NO ton-mile fee, because it is under the 85,000 lb fee threshold for its axle count.',
      ),
    ],
    singleAxleLbs: [
      fromDated(
        20_000,
        SD_HANDBOOK,
        HANDBOOK_FROM,
        'The ordinary federal single-axle limit. South Dakota publishes no departure from it.',
      ),
    ],
    tandemAxleLbs: [
      fromDated(
        34_000,
        SD_HANDBOOK,
        HANDBOOK_FROM,
        'The ordinary federal tandem limit.',
      ),
    ],
  },

  permitBaseFeeUsd: [
    fromDated(
      25,
      ARSD_FEES,
      FEE_FROM,
      'ARSD 70:03:01:02: "The permit fee for an individual single-trip permit is $25." One flat charge covering oversize, overweight or both — South Dakota uses no dimension bands. A book of ten self-issuing single-trip permits is $250, which is the same $25 apiece and must be validated with the permit centre before travel, so it is a convenience rather than a discount. State agencies, local subdivisions of this or a foreign state, and federal agencies are exempt from both the permit fee and the ton-mile fee; that exemption is recorded and not applied, because a quote does not state whether the shipper is a public body.',
    ),
  ],

  oversizeFeeBands: [],

  combinedFeeRule: [
    fromDated<CombinedFeeRule>(
      {
        kind: 'cumulative',
        explanation:
          'The $25 permit fee and the $0.02 ton-mile overweight charge are genuinely additive — ARSD 70:03:01:02 calls the latter "an ADDITIONAL fee" in terms. An overweight move pays both; an oversize-but-legal-weight move pays the $25 alone, because the ton-mile charge only bites above the axle-count fee thresholds.',
      },
      ARSD_FEES,
      FEE_FROM,
    ),
  ],

  /**
   * THE TON-MILE CHARGE. Encoded against the axle-count fee thresholds rather
   * than against the legal limit — see the module header, this is the single
   * most important thing to get right in South Dakota.
   */
  /**
   * THE TON-MILE CHARGE, AS SIX ROWS SELECTED BY AXLE COUNT.
   *
   * One rate — $0.02 per ton or fraction of a ton, per mile — and six
   * different points at which the meter starts. The rows are identical apart
   * from `excessBaseLbs` and the axle band that selects them.
   *
   * `minLbs` is set one pound above each threshold so a load at exactly the
   * threshold selects no row and is charged nothing, which is what "exceeds"
   * means. A load whose axle count is not stated selects NO row at all and
   * goes to manual review rather than being priced against a guessed
   * threshold — see `PerMileRate.minAxleCount`.
   */
  overweightPerMile: [
    fromDated<PerMileRate>(
      {
        minLbs: 40001,
        maxLbs: null,
        minAxleCount: 2,
        maxAxleCount: 2,
        ratePerMileUsd: 0.02,
        perIncrementLbs: 2_000,
        excessBaseLbs: 40_000,
        roundIncrementUp: true,
        minimumUsd: 1,
        maximumUsd: null,
      },
      ARSD_FEES,
      FEE_FROM,
      'ARSD 70:03:01:02, the "2 axles" limb: "40,000 pounds". The rate is $0.02 per ton or fraction of a ton of excess, per mile on state trunk highways, with a $1.00 floor.',
    ),
    fromDated<PerMileRate>(
      {
        minLbs: 60001,
        maxLbs: null,
        minAxleCount: 3,
        maxAxleCount: 3,
        ratePerMileUsd: 0.02,
        perIncrementLbs: 2_000,
        excessBaseLbs: 60_000,
        roundIncrementUp: true,
        minimumUsd: 1,
        maximumUsd: null,
      },
      ARSD_FEES,
      FEE_FROM,
      'ARSD 70:03:01:02, the "3 axles" limb: "60,000 pounds". The rate is $0.02 per ton or fraction of a ton of excess, per mile on state trunk highways, with a $1.00 floor.',
    ),
    fromDated<PerMileRate>(
      {
        minLbs: 80001,
        maxLbs: null,
        minAxleCount: 4,
        maxAxleCount: 4,
        ratePerMileUsd: 0.02,
        perIncrementLbs: 2_000,
        excessBaseLbs: 80_000,
        roundIncrementUp: true,
        minimumUsd: 1,
        maximumUsd: null,
      },
      ARSD_FEES,
      FEE_FROM,
      'ARSD 70:03:01:02, the "4 axles" limb: "80,000 pounds". The rate is $0.02 per ton or fraction of a ton of excess, per mile on state trunk highways, with a $1.00 floor.',
    ),
    fromDated<PerMileRate>(
      {
        minLbs: 85001,
        maxLbs: null,
        minAxleCount: 5,
        maxAxleCount: 5,
        ratePerMileUsd: 0.02,
        perIncrementLbs: 2_000,
        excessBaseLbs: 85_000,
        roundIncrementUp: true,
        minimumUsd: 1,
        maximumUsd: null,
      },
      ARSD_FEES,
      FEE_FROM,
      'ARSD 70:03:01:02, the "5 axles" limb: "85,000 pounds". The rate is $0.02 per ton or fraction of a ton of excess, per mile on state trunk highways, with a $1.00 floor.',
    ),
    fromDated<PerMileRate>(
      {
        minLbs: 90001,
        maxLbs: null,
        minAxleCount: 6,
        maxAxleCount: 6,
        ratePerMileUsd: 0.02,
        perIncrementLbs: 2_000,
        excessBaseLbs: 90_000,
        roundIncrementUp: true,
        minimumUsd: 1,
        maximumUsd: null,
      },
      ARSD_FEES,
      FEE_FROM,
      'ARSD 70:03:01:02, the "6 axles" limb: "90,000 pounds". The rate is $0.02 per ton or fraction of a ton of excess, per mile on state trunk highways, with a $1.00 floor.',
    ),
    fromDated<PerMileRate>(
      {
        minLbs: 95001,
        maxLbs: null,
        minAxleCount: 7,
        maxAxleCount: null,
        ratePerMileUsd: 0.02,
        perIncrementLbs: 2_000,
        excessBaseLbs: 95_000,
        roundIncrementUp: true,
        minimumUsd: 1,
        maximumUsd: null,
      },
      ARSD_FEES,
      FEE_FROM,
      'ARSD 70:03:01:02, the "7 axles or more" limb: "95,000 pounds". The rate is $0.02 per ton or fraction of a ton of excess, per mile on state trunk highways, with a $1.00 floor.',
    ),
  ],

  /**
   * THE MECHANISM SELECTOR. `perMile` is what routes the engine to the six
   * axle-banded rows above; leaving it empty silently prices no overweight
   * charge at all, which is how this file first passed typecheck and produced
   * nothing.
   */
  overweightPricing: [
    fromDated<OverweightPricing>(
      {
        kind: 'perMile',
        explanation:
          'ARSD 70:03:01:02: "An overweight vehicle shall be charged an additional fee of two cents for each ton or fraction of a ton that its gross weight exceeds the following weight limits, for each mile traveled on state trunk highways. This additional fee may not be less than one dollar." A per-mile mechanism, not a band and not a flat charge — and the six thresholds it then lists are selected by AXLE COUNT rather than by weight, which is why the rate rows carry an axle band.',
      },
      ARSD_FEES,
      FEE_FROM,
      'ARSD 70:03:01:02 charges the overweight fee "for each mile traveled on state trunk highways", so the mechanism is per-mile rather than a band or a flat charge. The rate and its six axle-count thresholds are in `overweightPerMile`.',
    ),
  ],

  overweightBands: [],
  conditionalFees: [],

  transactionFee: [
    fromDated<TransactionFee>(
      { perPermitUsd: 0, percentOfTotal: 0 },
      SD_HANDBOOK,
      HANDBOOK_FROM,
      'AN AFFIRMATIVE ABSENCE. No separate state processing fee, percentage surcharge or portal convenience fee is codified in ARSD 70:03:01 or in statute. The Motor Carrier Handbook describes the portal taking "credit card or escrow account" and names no surcharge either way.',
    ),
  ],

  routeAnalysisFeeUsd: [],
  noBridgeRouteFeeUsd: [],

  /**
   * NO SUPERLOAD CLASS AND NO SUPERLOAD FEE. South Dakota does not use the word
   * in statute or administrative code. Its 200,000 lb / 12 ft-and-overweight /
   * 16 ft figures are a PROCESSING queue — those applications "may take
   * longer" than the usual two working days — and the fee is unchanged above
   * them. See `sd-superload-is-a-queue-not-a-price`.
   */
  superload: {
    shortSpacing: [],
  },

  routeInspection: {
    widthIn: [],
    heightIn: [],
    lengthIn: [],
  },

  escortRules: SOUTH_DAKOTA_ESCORT_RULES,
  escortCountCombination: [],

  feeDistanceDependence: [
    fromDated<FeeDistanceDependence>(
      {
        component: 'overweight',
        dependsOnDistance: true,
        quote:
          'ARSD 70:03:01:02: "two cents for each ton or fraction of a ton that its gross weight exceeds the following weight limits, FOR EACH MILE TRAVELED ON STATE TRUNK HIGHWAYS."',
      },
      ARSD_FEES,
      FEE_FROM,
      'And the mileage base is NARROWER than the state: only miles on the state trunk highway system are charged, not every mile in South Dakota. The engine holds a whole-state in-state mileage, so a lane with substantial county or municipal running is over-charged by the difference. The over-charge is bounded and small — the trunk system carries essentially all through freight — but it is a real bias in one direction and it is recorded rather than assumed away.',
    ),
  ],

  publishedAbsences: [
    fromDated<PublishedAbsence>(
      {
        subject: 'weightEscortTrigger',
        statement:
          'ARSD 70:03:01:20 triggers escorts on WIDTH and nothing else. Its four limbs are all width figures — over 16 ft on the interstate, over 10 ft on twelve named segments, over 16 ft on seven more, over 20 ft on everything else — and the rule contains no weight column and no pounds figure anywhere.',
        consequence:
          'A 200,000 lb load at legal width requires zero escorts in South Dakota. The only weight-linked provision in the chapter is the discretionary power to require escorts "because of route limitations, traffic conditions, or unusual permit vehicle configuration conditions", which sets no threshold.',
      },
      ARSD_ESCORTS,
      ESCORT_FROM,
    ),
    fromDated<PublishedAbsence>(
      {
        subject: 'heightEscortTrigger',
        statement:
          'No general height threshold triggers an escort in ARSD 70:03:01:20. ARSD 70:03:01:20.01 provides that special traffic handling may be required to clear height restrictions, which is a discretion rather than a threshold.',
        consequence:
          'A tall-but-narrow load needs no South Dakota escort on height alone.',
      },
      ARSD_ESCORTS,
      ESCORT_FROM,
    ),
    fromDated<PublishedAbsence>(
      {
        subject: 'dimensionalEscortThresholds',
        statement:
          'No LENGTH-based escort trigger is published for general freight. ARSD 70:03:01:20 is width-only. Length triggers exist in the special-vehicle rules — utility poles over 75 ft under ARSD 70:03:01:109, earthmoving equipment under ARSD 70:03:01:24 — and neither governs general freight.',
        consequence:
          'A 130 ft long load at legal width needs no South Dakota escort, which is unusual in this corpus and is a finding rather than a gap.',
      },
      ARSD_ESCORTS,
      ESCORT_FROM,
    ),
    fromDated<PublishedAbsence>(
      {
        subject: 'policeEscortRate',
        statement:
          'Neither the South Dakota Highway Patrol nor the Department of Public Safety publishes an escort fee schedule, hourly rate, mileage rate, administrative fee, minimum hours or cancellation charge for commercial motor carrier escorts. The Motor Carrier Handbook says only that "some permit applications require review by the Department of Transportation or the Highway Patrol" — a review of the application, not an escort of the load.',
        consequence:
          'No police escort cost is quoted for South Dakota, and no police escort is required by any published rule.',
      },
      SD_HANDBOOK,
      HANDBOOK_FROM,
    ),
    fromDated<PublishedAbsence>(
      {
        subject: 'superloadDefinition',
        statement:
          'South Dakota uses no superload class in statute or administrative code. The Motor Carrier Handbook publishes a PROCESSING threshold instead: review "typically takes up to two working days, but loads that exceed 200,000 pounds, loads that are overweight and wider than 12 feet, and loads more than 16 feet high may take longer."',
        consequence:
          'No South Dakota load is flagged as a superload and no superload ceiling is mirrored to the public calculator. The heaviest imaginable move pays the same $25 base plus $0.02 per ton-mile; the cost of a South Dakota superload is schedule, not money.',
      },
      SD_HANDBOOK,
      HANDBOOK_FROM,
    ),
    fromDated<PublishedAbsence>(
      {
        subject: 'superloadFee',
        statement:
          'With no superload class there is no superload fee, and no engineering, analysis or review charge is published for the extended-review thresholds either.',
        consequence:
          'Nothing is added above 200,000 lb. Contrast Wyoming, which bills the full cost of route analysis and personnel above 125 tons.',
      },
      SD_HANDBOOK,
      HANDBOOK_FROM,
    ),
    fromDated<PublishedAbsence>(
      {
        subject: 'partialIncrementRule',
        statement:
          'South Dakota STATES its partial-increment rule rather than leaving it to be inferred: ARSD 70:03:01:02 charges "for each ton or fraction of a ton", so any fractional ton of excess is billed as a further whole ton.',
        consequence:
          'The ton-mile fee rounds UP with no spread and no manual review. This entry records that the rule was found and encoded, not that it is missing.',
      },
      ARSD_FEES,
      FEE_FROM,
    ),
  ],

  feesDependOnDistance: true,
};
