/**
 * VIRGINIA — oversize/overweight single-trip permit rules.
 *
 * A per-mile state, and the cheapest headline number in this directory: $20 for
 * a single trip, plus 30 cents for every permitted mile if the load is
 * overweight (or if the configuration simply cannot be licensed in Virginia).
 * There are no dimension bands, no weight bands, no per-axle schedule and no
 * published surcharge — a 200-mile overweight run through Virginia is $20 + $60
 * and that is the entire state fee.
 *
 * BECAUSE THE FEE IS PER MILE, VIRGINIA CANNOT BE PRICED WITHOUT VIRGINIA
 * MILES. `feesDependOnDistance` is true and the engine refuses rather than
 * billing a whole corridor's mileage to one state — a Chicago-to-Miami lane
 * that clips 180 miles of Virginia owes $54, not $360. Per-jurisdiction mileage
 * splitting is still to be built; see `MILEAGE_SPLIT_NOTE`.
 *
 * THE ESCORT SCHEDULE IS A LADDER, AND IT IS THE STEEPEST HERE. Virginia is the
 * only jurisdiction in this directory that asks for FOUR pilot cars: over 16 ft
 * wide on a noninterstate route it wants two in front and two behind. The
 * counts differ by route at every step — over 12 ft is two escorts off the
 * interstate and one on it, over 14 ft is three off and two on, over 16 ft is
 * four off and three on — so these rules are conditioned on `routeClass` and a
 * quote with no road type lands in review rather than guessing the cheap side
 * of a two-vehicle gap.
 *
 * VIRGINIA'S OWN ROUTE VOCABULARY IS JUST "INTERSTATE" AND "NONINTERSTATE", and
 * that is a mercy: 24VAC20-82-130 does not split its schedule into divided and
 * two-lane classes, and the source is explicit that a two-lane noninterstate
 * route AND a divided or controlled-access road that is not an interstate both
 * sit in the noninterstate column. So `interstate` maps to Virginia's
 * interstate and `divided`, `two-lane` and `urban` all map to noninterstate —
 * a mapping the state effectively states rather than one we inferred.
 *
 * WHAT IS NOT PRICED, AND WHY IT MATTERS MORE HERE THAN ELSEWHERE.
 *
 *   - THE SUPERLOAD DAMAGE FEE. Virginia's superload permit is $30 plus 30
 *     cents a mile plus "an additional damage fee ... based on the gross weight
 *     of the vehicle configuration", and DMV publishes neither the bands nor
 *     the formula. That is an unbounded unknown attached to a permit type, so
 *     superloads here carry no quoted total at all.
 *   - THE TRANSACTION FEE. Virginia's published fee schedule shows no
 *     percentage surcharge, no card fee and no processing fee — and the source
 *     research is explicit that this must NOT be read as "the percentage is
 *     zero". So `transactionFee` is an EMPTY list rather than a sourced zero,
 *     and the engine warns on every Virginia quote that the transaction cost is
 *     not on file. That warning is the honest state of the evidence.
 *   - THE WEIGHT ESCORT TRIGGER, IN BOTH DIRECTIONS. Virginia publishes no
 *     automatic numeric weight-based pilot-car trigger, and 24VAC20-82-130(B)
 *     then says escort requirements "are subject to change with individual
 *     consideration of weight, width, length, height, geographical location, or
 *     route of travel as determined by DMV". Absence of a threshold is not
 *     absence of a requirement.
 *
 * THE GAP THIS FILE CLOSES BY HAND. Virginia publishes ordinary single-trip
 * ceilings on height (15 ft), width (15 ft) and length (150 ft) and anything
 * above them is a superload — but for WEIGHT it publishes no fixed number at
 * all, only "based on total number of axles ... and total amount of spacing".
 * A weight-only superload trigger therefore cannot be recorded, which would
 * leave a 260,000 lb Virginia load priced as an ordinary $20 permit. The
 * extreme-parameter rule below catches exactly that: 24VAC20-82-60 names
 * 250,000 lb alongside 18 ft, 200 ft and 16 ft as the point at which DMV may
 * demand a detailed travel plan with written law-enforcement authorisation, and
 * a load past any of those is sent to review.
 */
import type { SourceDoc, Sourced } from '../provenance.js';
import { ftIn, type EscortRule } from '../escortRules.js';
import type {
  JurisdictionOsowRules,
  OverweightPricing,
  PerMileRate,
  Threshold,
} from '../types.js';

const RETRIEVED = '2026-09-02';

// ── Source documents ──────────────────────────────────────────────────────

const DMV109: SourceDoc = {
  id: 'va-dmv109-2024-07',
  title: 'Virginia DMV — Hauling Permit Manual, DMV109 (PDF, 07/2024)',
  url: 'https://www.dmv.virginia.gov/sites/default/files/forms/dmv109.pdf',
  publisher: 'Virginia Department of Motor Vehicles',
  revisedOn: '2024-07-01',
  retrievedOn: RETRIEVED,
  cite: 'legal size and weight limits; the ordinary single-trip ceilings (15 ft / 15 ft / 150 ft / 24,000 lb / 44,000 lb); the $20 single-trip fee and 30-cent mileage note',
};
const EFF_DMV109 = '2024-07-01';

const HAULING: SourceDoc = {
  id: 'va-dmv-hauling-permits',
  title: 'Virginia DMV — Hauling Permits fee table (undated)',
  url: 'https://www.dmv.virginia.gov/businesses/hauling',
  publisher: 'Virginia Department of Motor Vehicles',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'Single Trip $20; Blanket $100/$200; Superload $30 plus a damage fee "based on the gross weight of the vehicle configuration"',
};

const VAC_82_130: SourceDoc = {
  id: 'va-24vac20-82-130-2023-03',
  title: '24 Va. Admin. Code §20-82-130 — Escort vehicle requirements',
  url: 'https://law.lis.virginia.gov/admincode/title24/agency20/chapter82/section130/',
  publisher: 'Virginia Law Portal, Commonwealth of Virginia',
  revisedOn: '2023-03-01',
  retrievedOn: RETRIEVED,
  cite: 'the complete numbered escort schedule, items 1–15, and paragraph B',
};
const EFF_VAC = '2023-03-01';

const VAC_82_120: SourceDoc = {
  id: 'va-24vac20-82-120-2023-03',
  title: '24 Va. Admin. Code §20-82-120 — Escort vehicle equipment',
  url: 'https://law.lis.virginia.gov/admincode/title24/agency20/chapter82/section120/',
  publisher: 'Virginia Law Portal, Commonwealth of Virginia',
  revisedOn: '2023-03-01',
  retrievedOn: RETRIEVED,
  cite: '"the pole shall be extended at least three inches above the specified height of the vehicle configuration being escorted"',
};

const VAC_82_60: SourceDoc = {
  id: 'va-24vac20-82-60-2023-03',
  title: '24 Va. Admin. Code §20-82-60 — Superload single trip permits',
  url: 'https://law.lis.virginia.gov/admincode/title24/agency20/chapter82/section60/',
  publisher: 'Virginia Law Portal, Commonwealth of Virginia',
  revisedOn: '2023-03-01',
  retrievedOn: RETRIEVED,
  cite: '"Superload single trip permit requests exceed the maximum weight or size limitations ordinarily allowed on a single trip permit."; the 18 ft / 250,000 lb / 200 ft / 16 ft travel-plan parameters; 10 working days',
};

const VAC_82_70: SourceDoc = {
  id: 'va-24vac20-82-70-2023-03',
  title: '24 Va. Admin. Code §20-82-70 — Superload analysis, inspections and surety',
  url: 'https://law.lis.virginia.gov/admincode/title24/agency20/chapter82/section70/',
  publisher: 'Virginia Law Portal, Commonwealth of Virginia',
  revisedOn: '2023-03-01',
  retrievedOn: RETRIEVED,
  cite: 'the 400,000 lb schematic requirement; the 500,000–750,000 lb discretionary and over-750,000 lb mandatory applicant-engineer requirements; pre- and post-travel inspections and the surety bond',
};

const FAQ_VEH: SourceDoc = {
  id: 'va-dmv-escort-vehicle-faq',
  title: 'Virginia DMV — Escort vehicle FAQ (undated)',
  url: 'https://www.dmv.virginia.gov/licenses-ids/training/escrt/faqs-veh',
  publisher: 'Virginia Department of Motor Vehicles',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: '"A height pole is generally required for loads with a maximum height over 14 feet 6 inches."',
};

const ESCORT_CERT: SourceDoc = {
  id: 'va-dmv-escort-driver-certification',
  title: 'Virginia DMV — Escort Vehicle Driver Certification (undated)',
  url: 'https://www.dmv.virginia.gov/businesses/motor-carriers/escort-dr-cert',
  publisher: 'Virginia Department of Motor Vehicles',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: '$25 original or renewal; $15 duplicate or reissue; eight-hour classroom course; certificate valid five years',
};

const FAQ_DRV: SourceDoc = {
  id: 'va-dmv-escort-driver-faq',
  title: 'Virginia DMV — Escort driver FAQ (undated)',
  url: 'https://www.dmv.virginia.gov/licenses-ids/training/escrt/faqs-drv',
  publisher: 'Virginia Department of Motor Vehicles',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: '"Currently, we have an agreement with North Carolina."; $2 re-examination fee; training-provider fee not set by DMV',
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

function escortRule(
  id: string,
  description: string,
  when: EscortRule['when'],
  then: EscortRule['then'],
  source: SourceDoc = VAC_82_130,
  effectiveFrom: string = EFF_VAC,
): EscortRule {
  return {
    id,
    jurisdiction: 'VA',
    description,
    when,
    then,
    source,
    effectiveFrom,
    effectiveTo: null,
  };
}

/**
 * Virginia's own two route classes. Everything that is not an interstate — a
 * two-lane road, a divided highway, an urban arterial — takes the noninterstate
 * column, which the source states rather than leaves to inference.
 */
const NONINTERSTATE: EscortRule['when'] = {
  kind: 'routeClass',
  anyOf: ['divided', 'two-lane', 'urban'],
};
const INTERSTATE: EscortRule['when'] = { kind: 'routeClass', anyOf: ['interstate'] };

function overWidthOn(route: EscortRule['when'], widthIn: number): EscortRule['when'] {
  return { kind: 'all', of: [route, { kind: 'gt', measure: 'widthIn', value: widthIn }] };
}

// ── Escort rules (24VAC20-82-130) ─────────────────────────────────────────

export const VIRGINIA_ESCORT_RULES: EscortRule[] = [
  escortRule(
    'va-width-noninterstate-over-12',
    'Over 12 ft wide on a noninterstate route — one front and one rear escort',
    overWidthOn(NONINTERSTATE, ftIn(12)),
    { escorts: 2, front: 1, rear: 1 },
  ),
  escortRule(
    'va-width-interstate-over-12',
    'Over 12 ft wide on an interstate route — one rear escort',
    overWidthOn(INTERSTATE, ftIn(12)),
    { escorts: 1, rear: 1 },
  ),
  escortRule(
    'va-width-noninterstate-over-14',
    'Over 14 ft wide on a noninterstate route — TWO front escorts and one rear escort',
    overWidthOn(NONINTERSTATE, ftIn(14)),
    { escorts: 3, front: 2, rear: 1 },
  ),
  escortRule(
    'va-width-interstate-over-14',
    'Over 14 ft wide on an interstate route — one front and one rear escort',
    overWidthOn(INTERSTATE, ftIn(14)),
    { escorts: 2, front: 1, rear: 1 },
  ),
  /**
   * FOUR PILOT CARS. Nothing else in this directory asks for four, and a model
   * that capped escorts at two — which several state schedules would let you
   * get away with — would under-quote a wide Virginia move by half the escort
   * line.
   */
  escortRule(
    'va-width-noninterstate-over-16',
    'Over 16 ft wide on a noninterstate route — TWO front escorts and TWO rear escorts',
    overWidthOn(NONINTERSTATE, ftIn(16)),
    { escorts: 4, front: 2, rear: 2 },
  ),
  escortRule(
    'va-width-interstate-over-16',
    'Over 16 ft wide on an interstate route — one front escort and TWO rear escorts',
    overWidthOn(INTERSTATE, ftIn(16)),
    { escorts: 3, front: 1, rear: 2 },
  ),

  escortRule(
    'va-length-noninterstate-over-90',
    'Over 90 ft long on a noninterstate route — one rear escort',
    {
      kind: 'all',
      of: [NONINTERSTATE, { kind: 'gt', measure: 'overallLengthIn', value: ftIn(90) }],
    },
    { escorts: 1, rear: 1 },
  ),
  escortRule(
    'va-length-interstate-over-120',
    'Over 120 ft long on an interstate route — one rear escort',
    {
      kind: 'all',
      of: [INTERSTATE, { kind: 'gt', measure: 'overallLengthIn', value: ftIn(120) }],
    },
    { escorts: 1, rear: 1 },
  ),
  escortRule(
    'va-length-over-150',
    'Over 150 ft long — one front and one rear escort, on all routes',
    { kind: 'gt', measure: 'overallLengthIn', value: ftIn(150) },
    { escorts: 2, front: 1, rear: 1 },
  ),

  escortRule(
    'va-front-overhang-over-10',
    'Front overhang over 10 ft measured from the bumper — one front escort, on all routes',
    { kind: 'gt', measure: 'frontOverhangIn', value: ftIn(10) },
    { escorts: 1, front: 1 },
  ),
  escortRule(
    'va-rear-overhang-over-15',
    'Rear overhang over 15 ft measured from the bumper — one rear escort, on all routes',
    { kind: 'gt', measure: 'rearOverhangIn', value: ftIn(15) },
    { escorts: 1, rear: 1 },
  ),

  /**
   * The height-pole trigger is the state's one recorded conflict, and it is one
   * inch wide. The Administrative Code — which is the binding instrument — puts
   * it at over 14 ft 5 in. The DMV's own escort-vehicle FAQ says a pole is
   * "generally required" over 14 ft 6 in. Both rules are written; the stricter
   * one governs the count, and a load in the one-inch gap is told that its
   * sources disagree.
   */
  escortRule(
    'va-height-over-14-5-admin-code',
    'Over 14 ft 5 in high — one front escort equipped with a height pole, on all routes (Administrative Code)',
    { kind: 'gt', measure: 'heightIn', value: ftIn(14, 5) },
    { escorts: 1, front: 1, heightPole: true },
  ),
  escortRule(
    'va-height-over-14-6-faq',
    'Over 14 ft 6 in high — one front escort with a height pole (DMV FAQ, "generally required")',
    { kind: 'gt', measure: 'heightIn', value: ftIn(14, 6) },
    { escorts: 1, front: 1, heightPole: true },
    FAQ_VEH,
    RETRIEVED,
  ),
  escortRule(
    'va-height-pole-threshold-conflict',
    'Over 14 ft 5 in but not over 14 ft 6 in — the Administrative Code requires a height pole and the DMV FAQ does not',
    {
      kind: 'between',
      measure: 'heightIn',
      min: ftIn(14, 5),
      max: ftIn(14, 6),
      minInclusive: false,
    },
    {
      manualReview:
        'This load sits in the one inch where Virginia\'s two sources disagree about the height pole. 24VAC20-82-130(9) requires "One front escort equipped with a height pole, adjusted three inches above the load height ... on all routes when the permitted load exceeds 14 feet five inches in height". The DMV\'s undated escort-vehicle FAQ says instead that a pole is "generally required for loads with a maximum height over 14 feet 6 inches", and qualifies it with "generally". The Administrative Code is the binding instrument and its stricter trigger is applied, so a pole car is counted — but neither value has been discarded and the requirement should be confirmed on the issued permit. The pole itself must extend at least three inches above the specified height of the configuration and be mounted on the front of the lead escort; Virginia publishes no construction material, diameter, flexibility or breakaway specification.',
    },
  ),

  /**
   * OFF-CENTRE LOADS. Virginia is the only jurisdiction here that escorts a
   * load for being off-centre rather than for being big: one front escort past
   * 3 ft 6 in on the passenger side, a front and a rear past 5 ft. There is no
   * `Measure` for lateral offset and a quote does not collect it, so this is
   * stated as an exclusion rather than modelled — blocking every Virginia quote
   * on a dimension we never ask for would make the state unquotable for a
   * condition almost no load has.
   */
  escortRule(
    'va-off-centred-load-not-modelled',
    'An off-centred load draws escorts in Virginia on a measurement a quote does not collect',
    { kind: 'gt', measure: 'widthIn', value: 102 },
    {
      advisory:
        'Virginia requires one front escort when an off-centred load exceeds 3 ft 6 in on the PASSENGER side of the configuration, and a front and a rear escort when it exceeds 5 ft. Lateral offset is not collected on a quote and is not part of the width, so no off-centre escort is included here and the requirement cannot be ruled out. Virginia also publishes no automatic numeric WEIGHT trigger for a pilot car — but 24VAC20-82-130(B) adds that escort requirements "are subject to change with individual consideration of weight, width, length, height, geographical location, or route of travel as determined by DMV", so a heavy move can still be escorted by determination rather than by table.',
    },
  ),

  escortRule(
    'va-case-by-case-over-18-wide-or-200-long',
    'Over 18 ft wide or over 200 ft long — Virginia handles escorts case by case',
    {
      kind: 'any',
      of: [
        { kind: 'gt', measure: 'widthIn', value: ftIn(18) },
        { kind: 'gt', measure: 'overallLengthIn', value: ftIn(200) },
      ],
    },
    {
      manualReview:
        '24VAC20-82-130(15): "Permit loads that exceed 18 feet wide or 200 feet long will be handled on a case-by-case basis." No escort count is published above those dimensions, so the counts in this quote are the last published step and may be low. A case-by-case determination is by definition not predictable from a table.',
    },
  ),

  /**
   * THE RULE THAT CLOSES THE WEIGHT GAP. Virginia publishes ordinary
   * single-trip ceilings on height, width and length — which become superload
   * triggers below — but for gross weight it publishes only "based on total
   * number of axles ... and total amount of spacing", which is not a number and
   * cannot be a threshold. Without this rule a 260,000 lb Virginia load would
   * be priced as an ordinary $20 permit plus mileage.
   */
  escortRule(
    'va-extreme-parameters-travel-plan',
    'Over 18 ft wide, 250,000 lb, 200 ft long or 16 ft high — DMV may require a detailed travel plan with written law-enforcement authorisation',
    {
      kind: 'any',
      of: [
        { kind: 'gt', measure: 'widthIn', value: ftIn(18) },
        { kind: 'gt', measure: 'grossWeightLbs', value: 250000 },
        { kind: 'gt', measure: 'overallLengthIn', value: ftIn(200) },
        { kind: 'gt', measure: 'heightIn', value: ftIn(16) },
      ],
    },
    {
      routeSurvey: true,
      manualReview:
        '24VAC20-82-60: a movement exceeding 18 feet in width, 250,000 pounds in weight, 200 feet in length or 16 feet in height "may be required to submit a detailed travel plan", and that plan "should include ... Written authorization from local law-enforcement personnel agreeing to escort the overdimensional configuration through their jurisdiction". Virginia publishes no fixed gross-weight superload threshold at all — its published gross limit is "based on total number of axles in the configuration and total amount of spacing" — so this parameter is the only weight line the state states numerically, and a load past it is not priced here. Above 400,000 lb VDOT additionally requires a schematic of the vehicle showing longitudinal axle spacing and transverse tyre dimensions; above 750,000 lb it requires the applicant to retain an engineer licensed in Virginia to analyse every structure on the route, and it may require that between 500,000 and 750,000 lb at its sole discretion. VDOT may also require pre-travel and post-travel structure inspections, and where it does it requires a surety bond whose amount it sets alone. None of those costs is published.',
    },
    VAC_82_60,
    EFF_VAC,
  ),

  escortRule(
    'va-police-escort-case-by-case',
    'Virginia may require a law-enforcement escort case by case, and publishes no rate for one',
    { kind: 'gt', measure: 'widthIn', value: ftIn(12) },
    {
      advisory:
        'Virginia\'s hauling manual states that "law enforcement escorts may be required on a case-by-case basis" and that "All escort requirements will be listed on your hauling permit or your locality permit". No statewide Virginia State Police hourly or per-mile escort rate was found in any official source, and neither the number nor the position of police escorts is published, so no police-escort cost is included here and none can be estimated. Note also that a locality can issue its own permit with its own escort conditions.',
    },
    DMV109,
    EFF_DMV109,
  ),

  escortRule(
    'va-escort-driver-certification',
    'Virginia certifies its escort drivers, and the certification cost is the operator’s rather than a permit fee',
    { kind: 'gt', measure: 'widthIn', value: ftIn(12) },
    {
      advisory:
        'Every escort vehicle operator working an oversize or overweight load in Virginia must be certified before performing the duties. Certification is an eight-hour classroom course and a DMV examination; the certificate costs $25 to obtain or renew, $15 to duplicate or reissue, and is valid five years, with a $2 fee for each re-examination. The training course itself has no DMV-set price — "The cost for the training course will vary based upon the site offering the course." Virginia has a reciprocity agreement with NORTH CAROLINA and DMV identifies no other reciprocal state, so a Virginia certification is not portable across the rest of this corridor. Virginia State Police officers, Virginia law-enforcement officials providing escort services, military convoys and other federal or state government vehicles are exempt from the requirement. None of these amounts is a permit fee and none is in the total below; they reach a quote through the pilot-car operator\'s rate.',
    },
    ESCORT_CERT,
    RETRIEVED,
  ),
];

// ── The jurisdiction ──────────────────────────────────────────────────────

/**
 * A FLAT 30 CENTS PER MILE, WITH NO WEIGHT INCREMENT.
 *
 * `PerMileRate` was built to carry three shapes, and Virginia is the simplest
 * of them: `perIncrementLbs: null` makes the rate flat per mile, so the excess
 * over 80,000 lb does not multiply it. Pennsylvania's "4¢ per mile per ton" is
 * the other shape and needs the increment fields; Virginia's does not, and
 * borrowing Pennsylvania's structure here would multiply a $60 charge by
 * sixteen.
 *
 * No minimum, no maximum, and no rounding rule — Virginia publishes none of the
 * three, so none is invented. A mobile home or manufactured house pays a flat
 * $1.00 in lieu of the mileage fee entirely; a quote does not identify the
 * commodity, so that substitution is recorded in the note and not applied.
 */
const overweightPerMile: Sourced<PerMileRate>[] = [
  fromDated<PerMileRate>(
    {
      minLbs: 80001,
      maxLbs: null,
      ratePerMileUsd: 0.3,
      perIncrementLbs: null,
      excessBaseLbs: null,
      roundIncrementUp: false,
      minimumUsd: null,
      maximumUsd: null,
    },
    DMV109,
    EFF_DMV109,
    '"A mileage fee of 30 cents per mile is added if overweight or if the vehicle configuration cannot be licensed in Virginia. Mobile homes and Manufactured housing will pay a flat fee of $1.00 in lieu of the 30 cents per mile fee." The rate is flat per permitted mile and does NOT scale with the amount of excess weight. The mileage fee also attaches to a load that is merely unlicensable in Virginia even if it is within weight, which a quote cannot determine, so it is applied here on the overweight trigger only.',
  ),
];

export const VIRGINIA_OSOW_RULES: JurisdictionOsowRules = {
  code: 'VA',
  name: 'Virginia',
  country: 'US',

  legalLimits: {
    widthIn: [
      fromDated(102, DMV109, EFF_DMV109, 'Published as 8 ft 6 in, and elsewhere in the same manual as "102 inches excluding mirror and any warning device installed on a school bus".'),
    ],
    heightIn: [fromDated(ftIn(13, 6), DMV109, EFF_DMV109, '"Height: 13 feet 6 inches" — a hauling permit is required above it.')],
    /**
     * 53 ft, WHICH IS A CHOICE. Virginia publishes 48 ft for a trailer and adds
     * that "53-foot trailers are allowed on interstate system". Recording 48 ft
     * would flag the ordinary 53 ft trailer as over-length on the network these
     * quotes are priced for; recording 53 ft understates the limit on a purely
     * non-interstate lane. The interstate figure is used because that is where
     * this corridor's freight runs, and the alternative is on the row.
     */
    trailerLengthIn: [
      fromDated(
        ftIn(53),
        DMV109,
        EFF_DMV109,
        '"Length (trailers): 48 feet (53-foot trailers are allowed on interstate system)". The 53 ft interstate figure is used; a trailer over 48 ft travelling entirely off the interstate system needs a permit that this row will not detect.',
      ),
    ],
    /**
     * `overallLengthIn` is ABSENT. Virginia caps a vehicle/trailer combination
     * at 65 ft, and then states for interstate and designated highways
     * "Combinations ... No overall length restrictions". Applying 65 ft would
     * put every ordinary tractor-semitrailer over the limit on the network the
     * quotes are priced for. The manual does say a combination over 65 ft needs
     * a permit when it will travel on NON-designated highways, which a quote's
     * endpoints cannot establish — so the cap is recorded here in prose rather
     * than as a threshold that would fire on every lane.
     */
    frontOverhangIn: [fromDated(ftIn(3), DMV109, EFF_DMV109, '"Overhang: 4 feet – rear; 3 feet - front"')],
    rearOverhangIn: [fromDated(ftIn(4), DMV109, EFF_DMV109)],
    grossWeightLbs: [
      fromDated(
        80000,
        DMV109,
        EFF_DMV109,
        '"No vehicle can travel on Virginia highways with a single axle weight in excess of 20,000 pounds, tandem axle weight in excess of 34,000 pounds, or a gross weight in excess of 80,000 pounds." The lawful gross is often LOWER: "The maximum gross weight is determined by the total number of axles and by measuring the distance between the first axle (steering) and extreme rear axle", and the official axle-spacing chart controls wherever it produces a smaller figure.',
      ),
    ],
    singleAxleLbs: [fromDated(20000, DMV109, EFF_DMV109, 'A separate limit of 650 lb per inch of tyre width in contact with the road also applies and is not modelled — tyre width is not collected on a quote.')],
    tandemAxleLbs: [
      fromDated(34000, DMV109, EFF_DMV109, 'Tandem defined as more than 40 inches but no more than 96 inches between axle centres.'),
    ],
  },

  /**
   * $20, flat, whatever the load measures — which is why there are no
   * `oversizeFeeBands` for Virginia. The state's oversize permit is not
   * dimension-banded at all; the only thing that changes the price is whether
   * the load is overweight, and that is charged by the mile.
   */
  permitBaseFeeUsd: [
    fromDated(20, DMV109, EFF_DMV109, '"Single Trip | One move between origin and destination. | $20"'),
    fromUndatedPage(20, HAULING, 'The current DMV hauling-permits fee table prints the same $20 single-trip figure. A superload single trip is $30 and a blanket permit is $100 for one year or $200 for two.'),
  ],

  overweightPricing: [
    fromDated<OverweightPricing>(
      {
        kind: 'perMile',
        explanation:
          'Virginia adds "a mileage fee of 30 cents per mile ... if overweight or if the vehicle configuration cannot be licensed in Virginia" on top of the flat $20 single-trip fee. There are no weight bands and no per-axle schedule.',
      },
      DMV109,
      EFF_DMV109,
    ),
    fromUndatedPage<OverweightPricing>(
      {
        kind: 'perMile',
        explanation:
          'The current hauling-permits fee table prints the same 30-cent mileage note against the single-trip and superload rows alike.',
      },
      HAULING,
    ),
  ],

  overweightBands: [],
  overweightPerMile,
  conditionalFees: [],

  /**
   * EMPTY, NOT ZERO, AND THE DIFFERENCE IS THE WHOLE POINT. Virginia's current
   * fee schedule lists card and e-check as payment options and discloses no
   * percentage surcharge, no card fee, no processing fee and no administrative
   * fee — and the source research is explicit that this must not be read as
   * "the percentage is zero". A sourced zero would be an assertion the evidence
   * does not support, so the list is empty and the engine states on every
   * Virginia quote that no transaction fee is on file. Georgia's $7.00 flat
   * charge, by contrast, IS published and IS recorded as a value.
   */
  transactionFee: [],

  /**
   * EMPTY. Virginia charges no agency fee to review a route or bridge analysis:
   * what it charges a superload is $30 plus mileage plus "an additional damage
   * fee ... based on the gross weight of the vehicle configuration", whose
   * bands, amount and formula DMV does not publish. Where the analysis is done
   * by an applicant-retained engineer above 750,000 lb, that engineer is paid
   * by the applicant and not by the Commonwealth. Any figure recorded here
   * would be invented.
   */
  routeAnalysisFeeUsd: [],
  noBridgeRouteFeeUsd: [],

  superload: {
    /**
     * NO `grossWeight` ROW, AND IT IS A GAP VIRGINIA LEAVES RATHER THAN ONE WE
     * CHOSE. A Virginia superload is any request that "exceed[s] the maximum
     * weight or size limitations ordinarily allowed on a single trip permit",
     * and the manual gives those ceilings as HEIGHT 15 ft, WIDTH 15 ft, LENGTH
     * 150 ft, SINGLE AXLE 24,000 lb and TANDEM AXLE 44,000 lb — but for gross
     * weight it gives only "Maximum weight based on total number of axles in
     * the configuration and total amount of spacing between the centers of the
     * first and last axles". That is a procedure, not a threshold, so there is
     * no number to hold and Virginia stays out of the widget's weight-ceiling
     * mirror at the federal 80,000 lb line.
     *
     * The 250,000 lb travel-plan parameter in 24VAC20-82-60 is the one weight
     * figure Virginia states numerically, and it is carried by the
     * `va-extreme-parameters-travel-plan` rule so that a very heavy Virginia
     * load is not quietly priced as an ordinary permit.
     *
     * The axle ceilings (24,000 lb single, 44,000 lb tandem) cannot be recorded
     * either: `SuperloadTriggers` has no per-axle field, and a quote does not
     * carry per-axle weights on the path that reaches this data.
     */
    shortSpacing: [],
    widthIn: [
      fromDated<Threshold>(
        { value: ftIn(15), inclusive: false },
        DMV109,
        EFF_DMV109,
        'The ordinary single-trip ceiling is "Width: 15ft."; a request above it is processed as a superload, which is issued case by case only after a review or VDOT engineering analysis, should be submitted at least 10 working days ahead, and carries an unpublished damage fee.',
      ),
    ],
    heightIn: [
      fromDated<Threshold>({ value: ftIn(15), inclusive: false }, DMV109, EFF_DMV109, 'Ordinary single-trip ceiling "Height: 15ft."'),
    ],
    overallLengthIn: [
      fromDated<Threshold>({ value: ftIn(150), inclusive: false }, DMV109, EFF_DMV109, 'Ordinary single-trip ceiling "Length: 150ft."'),
    ],
  },

  /**
   * ALL EMPTY, AND SILENT BY DESIGN. Virginia does not publish a route-survey
   * trigger. What 24VAC20-82-60 describes is a "detailed travel plan", it is
   * conditional ("may be required"), and it is carried by the extreme-parameter
   * rule above with its real wording. VDOT performs its own route and structure
   * analysis for a superload; no separate carrier-performed survey threshold
   * and no survey or travel-plan preparation cost is published anywhere.
   * Turning "may be required" into "a route inspection is required" would state
   * something Virginia has not.
   */
  routeInspection: {
    widthIn: [],
    heightIn: [],
    lengthIn: [],
  },

  escortRules: VIRGINIA_ESCORT_RULES,

  /**
   * TRUE. 30 cents per permitted mile means Virginia cannot be priced without
   * Virginia miles, and the engine refuses rather than billing a corridor's
   * whole distance to one state.
   */
  feesDependOnDistance: true,
};

/** Cited for the height-pole equipment specification. */
export const VIRGINIA_HEIGHT_POLE_EQUIPMENT_SOURCE = VAC_82_120;

/** Cited for the superload analysis, inspection and surety requirements. */
export const VIRGINIA_SUPERLOAD_ANALYSIS_SOURCE = VAC_82_70;

/** Cited for escort-driver certification reciprocity — North Carolina only. */
export const VIRGINIA_ESCORT_RECIPROCITY_SOURCE = FAQ_DRV;
