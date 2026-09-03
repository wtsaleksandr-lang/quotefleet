/**
 * COLORADO — oversize/overweight single-trip permit rules.
 *
 * THE RICHEST DATASET IN THIS DIRECTORY, AND THE FIRST STATE THAT CHARGES BY
 * THE AXLE.
 * ---------------------------------------------------------------------------
 * C.R.S. §42-4-510(11)(a)(III)(B) sets the single-trip overweight permit at
 * "fifteen dollars plus five dollars per axle", and C.R.S. §43-4-804(1)(c)(I) —
 * the FASTER surcharge from Senate Bill 09-108 — then doubles it, which is why
 * CDOT publishes the fee twice on the same line: "Single Trip OSOW: $15 plus $5
 * per axle* and a total of $30 plus $10 per axle". There is no weight increment
 * anywhere in it. A 200,000 lb load on six axles pays exactly what an 81,000 lb
 * load on six axles pays, and a seventh axle costs more than 119,000 lb of
 * cargo does.
 *
 * That is a fee shape no state in Phase 1–4 had, and the only honest encodings
 * were to add it to the model or to declare Colorado unpriceable over a
 * multiplication. `WeightBand.perAxleUsd` is the former. It is OPTIONAL and
 * three-valued: a Colorado overweight quote WITHOUT an axle count is undecided
 * rather than free, exactly as an escort rule with a missing measurement is
 * `unknown` rather than false.
 *
 * CDOT PUBLISHES ITS OWN WORKED EXAMPLE, SO THE ARITHMETIC IS CHECKABLE: "a
 * six-axle semi-truck/trailer with a load exceeding 80,000 pounds would cost
 * $45" before the surcharge, $90 after it, and $94 once the $4 card charge is
 * added. The engine reproduces all three.
 *
 * THE COLOUR MAP IS CALIFORNIA'S PROBLEM WITH A SECOND AXIS.
 * ---------------------------------------------------------
 * 2 CCR 601-4 §408.2 colours every state-highway segment red, blue, yellow,
 * green or white, and each colour carries its own width ladder: at 12 ft wide a
 * load needs a Chapter 6 Special permit on red, one front pilot car on blue, one
 * on yellow, and nothing at all on green or white. Colorado then splits GREEN by
 * lane count, sets its LENGTH triggers from lane count on every colour (§410),
 * and sets its night-time escort POSITION from lane count as well (§408.3.2) —
 * so colour and lane count have to travel together in one `RouteClass` value and
 * there are ten `co-` members rather than five.
 *
 * TERRAIN IS THE THIRD AXIS AND IS ASKED AS A QUESTION INSTEAD. §410.1 drops the
 * two-lane length trigger from 110 ft to 85 ft on a "Mountainous" highway, which
 * would have doubled the union to twenty members. It is a `subjective` condition
 * — a published property of the segment that a dispatcher can answer and the
 * engine cannot derive — and an unanswered one reads `unknown`, which is what
 * puts an 85-to-110-foot Colorado load on a two-lane road in front of a human
 * instead of guessing flat country.
 *
 * "ONE PILOT CAR **OR** ONE FLASHING AMBER LIGHT" IS A REAL CHOICE AND IS NOT
 * COUNTED AS AN ESCORT. Three of Colorado's width bands offer the alternative
 * outright — §408.2.3.2, §408.2.4.2, §408.2.4.4 and the white-route rule all
 * read "either one Pilot Escort Vehicle or one Flashing Yellow Light in the
 * rear". Asserting a rear pilot car would over-quote every carrier that fits the
 * light, which is most of them; asserting nothing without saying so would
 * under-quote the ones that cannot. So no count is asserted and the choice is
 * stated on the quote.
 *
 * WHAT IS NOT PRICED, AND WHY.
 *
 *   - ANYTHING OVER 200,000 LB. CDOT's single-trip OSOW permit covers
 *     non-divisible loads "up to 200,000 lbs GVW"; between 200,001 and 500,000
 *     lb the move is a Chapter 6 Special and at 500,000 lb or more it is a
 *     statutory Super Load. Both of those DO have published fees — $250 and $800
 *     with the surcharge — and neither is quoted here, because 2 CCR 601-4 §606
 *     lets CDOT attach a bond or an escrow account "for cost of Department
 *     employees and/or Colorado State Patrol to accompany the load", a route
 *     survey, and CSP escorts at actual cost, none of which is published. A
 *     $250 permit fee beside an unbounded escrow is not a total.
 *   - THE POLICE ESCORT. Colorado is explicit that it does not publish one:
 *     §606.4 bills the permittee for the actual cost of Department employees and
 *     State Patrol through the bond or escrow. There is no hourly rate to find.
 *   - THE ROUTE SURVEY. 2 CCR 601-4 §303.16 and §303.17 REQUIRE one over 17 ft
 *     6 in high or 130 ft long, and Colorado publishes no fee for it because it
 *     does not perform it — certified private escort personnel do. The
 *     requirement is recorded; the cost cannot be.
 *   - THE SIGNAL CONTRACTOR. Over 17 ft high §409.4 requires "a licensed signal
 *     contractor through all intersections controlled by an overhead traffic
 *     signal" — a third-party service with no published rate, and one nothing
 *     else in this directory asks for.
 *
 * THE GROSS-WEIGHT CONFLICT IS THE ONE THAT MATTERS MOST, AND IT IS HANDLED THE
 * WAY BATCH 4 HANDLED ALABAMA'S. C.R.S. §42-4-508(1)(c)(III)(B) caps an
 * interstate combination at 80,000 lb and §42-4-510(5) directs CDOT and the
 * State Patrol to authorise up to 85,000 lb on the same system where federal
 * funding is not jeopardised. Recording both as candidates would resolve the
 * legal gross weight to `null`, and a null gross limit means the engine can no
 * longer tell that a 120,000 lb load is overweight — it would drop the whole
 * overweight charge and might report that no permit is needed at all. A conflict
 * that disables the over-dimension check is more dangerous than the conflict it
 * documents. So `legalLimits.grossWeightLbs` holds the lower, conservative
 * 80,000 lb figure, the disagreement is carried in full by
 * `COLORADO_INTERSTATE_GROSS_WEIGHT_LBS` — both candidates, no adopted value,
 * review forced, honest spread — and `co-interstate-gross-80000-to-85000-conflict`
 * fires in exactly the five thousand pounds where the two readings differ.
 */
import type { SourceDoc, Sourced } from '../provenance.js';
import { ftIn, type EscortRule, type RouteClass } from '../escortRules.js';
import type {
  JurisdictionOsowRules,
  OverweightPricing,
  Threshold,
  TransactionFee,
  WeightBand,
} from '../types.js';

const RETRIEVED = '2026-09-03';

// ── Source documents ──────────────────────────────────────────────────────

const CRS_502: SourceDoc = {
  id: 'co-crs-42-4-502',
  title: 'C.R.S. §42-4-502 — Width of vehicles (via Justia)',
  url: 'https://law.justia.com/codes/colorado/title-42/regulation-of-vehicles-and-traffic/article-4/part-5/section-42-4-502/',
  publisher: 'Justia, reproducing the Colorado Revised Statutes',
  revisedOn: '2008-08-05',
  retrievedOn: RETRIEVED,
  cite: '"The total outside width of any vehicle or the load thereon shall not exceed eight feet six inches, except as otherwise provided in this section."',
};

const CRS_504: SourceDoc = {
  id: 'co-crs-42-4-504',
  title: 'C.R.S. §42-4-504 — Height and length of vehicles (via Justia)',
  url: 'https://law.justia.com/codes/colorado/title-42/regulation-of-vehicles-and-traffic/article-4/part-5/section-42-4-504/',
  publisher: 'Justia, reproducing the Colorado Revised Statutes',
  revisedOn: '2016-08-10',
  retrievedOn: RETRIEVED,
  cite: '14 ft 6 in height; 45 ft single vehicle; 70 ft combination and four units; the 57 ft 4 in semitrailer exemption; 4 ft front and 10 ft rear projection',
};

const CRS_510: SourceDoc = {
  id: 'co-crs-42-4-510',
  title: 'C.R.S. §42-4-510 — Permits for excess size and weight (via Justia)',
  url: 'https://law.justia.com/codes/colorado/title-42/regulation-of-vehicles-and-traffic/article-4/part-5/section-42-4-510/',
  publisher: 'Justia, reproducing the Colorado Revised Statutes',
  revisedOn: '2024-08-07',
  retrievedOn: RETRIEVED,
  cite: '"Single trip permit, fifteen dollars plus five dollars per axle;"; subsection (1.7), the super-load class and its 25 mph / 10 mph speed restriction; subsection (11)(a), the full fee schedule',
};

/**
 * A COUNTY COMPILATION OF THE STATE'S WEIGHT STATUTES, AND IT IS A SECONDARY
 * SOURCE WITH NO DATE AT ALL. Moffat County republishes C.R.S. §§42-4-507 and
 * 42-4-508 verbatim in a PDF for oil-and-gas rig operators; the text is the
 * statute's, the publisher is not the state, and the document carries no
 * revision line. `revisedOn` is `null` for exactly that reason, which ranks it
 * last against any dated document — the correct treatment for a compilation
 * that will not say when it was compiled.
 */
const MOFFAT_WEIGHTS: SourceDoc = {
  id: 'co-moffat-county-weight-statutes',
  title: 'C.R.S. §§42-4-507 and 42-4-508 — weight limits (Moffat County compilation, undated — SECONDARY source)',
  url: 'https://moffatcounty.colorado.gov/sites/moffatcounty/files/StateStatutes_OGRigs_0.pdf',
  publisher: 'Moffat County, Colorado, reproducing the Colorado Revised Statutes',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: '20,000 lb single axle; 36,000 lb tandem on the interstate system and 40,000 lb off it; the 80,000 lb bridge-formula cap and the 85,000 lb W = 1,000(L + 40) cap',
};

const CDOT_FEES: SourceDoc = {
  id: 'cdot-permitting-information',
  title: 'CDOT Freight — Permitting Information (undated)',
  url: 'https://freight.colorado.gov/permitting-information',
  publisher: 'Colorado Department of Transportation, Division of Freight Mobility',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: '"Single Trip Oversize: $15* and total of $30"; "Single Trip OSOW: $15 plus $5 per axle* and a total of $30 plus $10 per axle"; "Credit Card Fee: $4 per transaction per permit"; the SB 09-108 surcharge note and its six-axle worked example',
};

const CCR_CH3: SourceDoc = {
  id: 'co-2ccr601-4-ch3',
  title: '2 CCR 601-4 Chapter 3 — Permit types and required documentation',
  url: 'https://www.law.cornell.edu/regulations/colorado/title-2/agency-601/division-4/chapter-3',
  publisher: 'Cornell Legal Information Institute, reproducing 2 CCR 601-4',
  revisedOn: '2018-04-16',
  retrievedOn: RETRIEVED,
  cite: '"300.1 Single Trip Permit: A permit that is valid for a single move not to exceed a maximum of five days"; "303.16 Route Survey for all Vehicles or Loads that exceed 17\' 6" in height. 303.17 Route Survey for all Vehicles or Loads that exceed 130\' in Length."',
};

const CCR_CH4: SourceDoc = {
  id: 'co-2ccr601-4-ch4',
  title: '2 CCR 601-4 Chapter 4 — Travel restrictions and pilot escort requirements',
  url: 'https://regulations.justia.com/states/colorado/600/601/rule-2-ccr-601-4/chapter-4/',
  publisher: 'Justia, reproducing 2 CCR 601-4',
  revisedOn: '2025-06-10',
  retrievedOn: RETRIEVED,
  cite: '§408.2 the colour width ladders; §408.3 the night-time rules; §409.4 the signal contractor; §410 the length triggers; §411 the overhang triggers; §402 the I-70 seasonal restrictions; §403.2 the Eisenhower-Johnson tunnel limit',
};

const CCR_CH5: SourceDoc = {
  id: 'co-2ccr601-4-ch5',
  title: '2 CCR 601-4 Chapter 5 — Pilot escort vehicle and operator requirements',
  url: 'https://www.law.cornell.edu/regulations/colorado/title-2/agency-601/division-4/chapter-5',
  publisher: 'Cornell Legal Information Institute, reproducing 2 CCR 601-4',
  revisedOn: '2018-04-16',
  retrievedOn: RETRIEVED,
  cite: '§505.1.7 the height-pole specification and the "exceeding sixteen feet in Height" trigger; §500.2, §500.4.3 and §500.5 the operator certification, insurance and driving-record requirements',
};

const CCR_CH6: SourceDoc = {
  id: 'co-2ccr601-4-ch6',
  title: '2 CCR 601-4 Chapter 6 — Special and Super Load permits',
  url: 'https://www.law.cornell.edu/regulations/colorado/title-2/agency-601/division-4/chapter-6',
  publisher: 'Cornell Legal Information Institute, reproducing 2 CCR 601-4',
  revisedOn: '2018-04-16',
  retrievedOn: RETRIEVED,
  cite: '§603 the mandatory front and rear escorts and the discretionary State Patrol escort; §606.4 the bond or escrow for actual Department and CSP costs; §607 the applicant\'s duty to resolve overhead conflicts; §609.1 "deemed to occupy two Lanes when the total Width ... exceeds 15 feet"',
};

const CDOT_RESOURCES: SourceDoc = {
  id: 'cdot-freight-resources',
  title: 'CDOT Freight — Pilot escort resources (undated)',
  url: 'https://freight.colorado.gov/resources',
  publisher: 'Colorado Department of Transportation, Division of Freight Mobility',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: '"Valid certification from Colorado, Arizona, Florida, Minnesota, Oklahoma, Utah, Washington or the Specialized Carriers and Rigging Association"',
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

const EFF_CCR_2018 = '2018-04-16';
const EFF_CCR_2025 = '2025-06-10';

function escortRule(
  id: string,
  description: string,
  when: EscortRule['when'],
  then: EscortRule['then'],
  source: SourceDoc = CCR_CH4,
  effectiveFrom: string = EFF_CCR_2025,
): EscortRule {
  return {
    id,
    jurisdiction: 'CO',
    description,
    when,
    then,
    source,
    effectiveFrom,
    effectiveTo: null,
  };
}

// ── Colorado's own route legend ───────────────────────────────────────────

const RED: RouteClass[] = ['co-red-two-lane', 'co-red-four-lane'];
const BLUE: RouteClass[] = ['co-blue-two-lane', 'co-blue-four-lane'];
const YELLOW: RouteClass[] = ['co-yellow-two-lane', 'co-yellow-four-lane'];
const WHITE: RouteClass[] = ['co-white-two-lane', 'co-white-four-lane'];
const TWO_LANE: RouteClass[] = [
  'co-red-two-lane',
  'co-blue-two-lane',
  'co-yellow-two-lane',
  'co-green-two-lane',
  'co-white-two-lane',
];
const FOUR_LANE: RouteClass[] = [
  'co-red-four-lane',
  'co-blue-four-lane',
  'co-yellow-four-lane',
  'co-green-four-lane',
  'co-white-four-lane',
];

/** The question §410.1 asks and a map answers. See the file header. */
const MOUNTAINOUS: EscortRule['when'] = {
  kind: 'subjective',
  key: 'coMountainousHighway',
  question:
    'is this a Mountainous highway as designated on CDOT’s Pilot Escort and Oversize Restriction Map (2 CCR 601-4 §410.1 drops the two-lane length trigger from 110 ft to 85 ft on one)',
};

function widthBandOn(
  route: RouteClass[],
  minIn: number,
  maxIn: number,
): EscortRule['when'] {
  return {
    kind: 'all',
    of: [
      { kind: 'routeClass', anyOf: route },
      {
        kind: 'between',
        measure: 'widthIn',
        min: minIn,
        max: maxIn,
        minInclusive: false,
      },
    ],
  };
}

function overWidthOn(route: RouteClass[], widthIn: number): EscortRule['when'] {
  return {
    kind: 'all',
    of: [
      { kind: 'routeClass', anyOf: route },
      { kind: 'gt', measure: 'widthIn', value: widthIn },
    ],
  };
}

/** The sentence every "escort or amber light" band has to carry. */
const LIGHT_ALTERNATIVE =
  '2 CCR 601-4 lets this band be satisfied by "either one Pilot Escort Vehicle or one Flashing Yellow Light in the rear". The light is the cheaper compliant option and most trailers can carry one, so NO rear pilot car is counted in this quote. If the configuration cannot mount a compliant rear amber light, add one rear escort to the count above.';

// ── Escort rules (2 CCR 601-4 §§408–411) ──────────────────────────────────

export const COLORADO_ESCORT_RULES: EscortRule[] = [
  /**
   * RED IS NOT A LADDER, IT IS A DOOR. Anything at all over the legal 8 ft 6 in
   * needs a Chapter 6 Special permit on a red segment — the ordinary single-trip
   * oversize permit this file prices is not issued there, at any width.
   */
  escortRule(
    'co-red-over-legal-width',
    'Any load over 8 ft 6 in wide on a RED segment needs a Chapter 6 Special permit, not the ordinary oversize permit',
    overWidthOn(RED, 102),
    {
      manualReview:
        '2 CCR 601-4 §408.2.1: "On a State Highway designated in red an Extra-legal Vehicle or Load that exceeds 8 feet 6 inches in Width requires a Chapter 6 Special permit." A red segment admits no ordinary oversize movement at all, so the $30 single-trip fee below is not the fee this move would pay — a Chapter 6 Special is $125 before the FASTER surcharge and $250 after it, and it carries a route survey and whatever bond, escrow or State Patrol escort CDOT attaches under §606. Colorado colours each segment on its Pilot Escort and Oversize Restriction Map; a route that touches one red segment is a red move.',
    },
  ),

  escortRule(
    'co-blue-width-8-6-to-11',
    'Over 8 ft 6 in and up to 11 ft wide on a BLUE segment — one front pilot car',
    widthBandOn(BLUE, 102, ftIn(11)),
    { escorts: 1, front: 1 },
  ),
  escortRule(
    'co-blue-width-11-to-13',
    'Over 11 ft and up to 13 ft wide on a BLUE segment — one front and one rear pilot car',
    widthBandOn(BLUE, ftIn(11), ftIn(13)),
    { escorts: 2, front: 1, rear: 1 },
  ),
  escortRule(
    'co-blue-over-13-chapter-6',
    'Over 13 ft wide on a BLUE segment — a Chapter 6 Special permit',
    overWidthOn(BLUE, ftIn(13)),
    {
      manualReview:
        '2 CCR 601-4 §408.2.2.3: "An Extra-legal Vehicle or Load that exceeds 13 feet in Width requires a Chapter 6 Special permit." The ordinary single-trip permit priced below is not the permit this move needs on a blue segment.',
    },
  ),

  escortRule(
    'co-yellow-width-11-to-13',
    'Over 11 ft and up to 13 ft wide on a YELLOW segment — one front pilot car',
    widthBandOn(YELLOW, ftIn(11), ftIn(13)),
    { escorts: 1, front: 1 },
  ),
  escortRule(
    'co-yellow-width-13-to-15',
    'Over 13 ft and up to 15 ft wide on a YELLOW segment — one front pilot car, and a rear car or a rear amber light',
    widthBandOn(YELLOW, ftIn(13), ftIn(15)),
    { escorts: 1, front: 1, advisory: LIGHT_ALTERNATIVE },
  ),
  escortRule(
    'co-yellow-over-15-chapter-6',
    'Over 15 ft wide on a YELLOW segment — a Chapter 6 Special permit',
    overWidthOn(YELLOW, ftIn(15)),
    {
      manualReview:
        '2 CCR 601-4 §408.2.3.3: "An Extra-legal Vehicle or Load that exceeds 15 feet in Width requires a Chapter 6 Special permit."',
    },
  ),

  /**
   * GREEN IS THE ONLY COLOUR WHOSE WIDTH LADDER SPLITS BY LANE COUNT, and it
   * splits hard: at 14 ft a two-lane green segment wants a front pilot car and a
   * four-lane one wants a rear amber light. Folding the two together would have
   * either invented a front car or dropped one.
   */
  escortRule(
    'co-green-two-lane-width-13-to-15',
    'Over 13 ft and up to 15 ft wide on a two-lane GREEN segment — one front pilot car',
    widthBandOn(['co-green-two-lane'], ftIn(13), ftIn(15)),
    { escorts: 1, front: 1 },
  ),
  escortRule(
    'co-green-two-lane-width-15-to-17',
    'Over 15 ft and up to 17 ft wide on a two-lane GREEN segment — one front pilot car, and a rear car or a rear amber light',
    widthBandOn(['co-green-two-lane'], ftIn(15), ftIn(17)),
    { escorts: 1, front: 1, advisory: LIGHT_ALTERNATIVE },
  ),
  escortRule(
    'co-green-four-lane-width-13-to-17',
    'Over 13 ft and up to 17 ft wide on a four-lane GREEN segment — a rear pilot car or a rear amber light',
    widthBandOn(['co-green-four-lane'], ftIn(13), ftIn(17)),
    { advisory: LIGHT_ALTERNATIVE },
  ),

  escortRule(
    'co-white-width-15-to-17',
    'Over 15 ft and up to 17 ft wide on a WHITE segment — a rear pilot car or a rear amber light',
    widthBandOn(WHITE, ftIn(15), ftIn(17)),
    { advisory: LIGHT_ALTERNATIVE },
  ),

  /**
   * LENGTH IS SET BY LANE COUNT ON EVERY COLOUR, AND BY TERRAIN ON TWO-LANE
   * ROADS. The 85 ft mountainous rule is deliberately banded to stop at 110 ft:
   * above that the flat-country rule already requires the same front car, so a
   * long load does not go to review over a terrain question that cannot change
   * the answer.
   */
  escortRule(
    'co-length-over-85-mountainous-two-lane',
    'Over 85 ft and up to 110 ft long on a MOUNTAINOUS two-lane highway — one front pilot car',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: TWO_LANE },
        MOUNTAINOUS,
        {
          kind: 'between',
          measure: 'overallLengthIn',
          min: ftIn(85),
          max: ftIn(110),
          minInclusive: false,
        },
      ],
    },
    { escorts: 1, front: 1 },
  ),
  escortRule(
    'co-length-over-110-two-lane',
    'Over 110 ft long on any two-lane highway — one front pilot car',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: TWO_LANE },
        { kind: 'gt', measure: 'overallLengthIn', value: ftIn(110) },
      ],
    },
    { escorts: 1, front: 1 },
  ),
  escortRule(
    'co-length-over-115-four-lane',
    'Over 115 ft long on a four-lane highway — one rear pilot car',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: FOUR_LANE },
        { kind: 'gt', measure: 'overallLengthIn', value: ftIn(115) },
      ],
    },
    { escorts: 1, rear: 1 },
  ),

  /**
   * THE MOST GENEROUS OVERHANG ALLOWANCE IN THIS DIRECTORY, BY A LONG WAY.
   * Colorado escorts a front overhang only past 15 ft and a rear overhang only
   * past 25 ft — Texas sends a car at 20 ft either end and Virginia at 10 ft and
   * 15 ft. A model that assumed overhang triggers cluster around the same
   * numbers would have put pilot cars on Colorado moves that do not need them.
   */
  escortRule(
    'co-front-overhang-over-15',
    'Front overhang over 15 ft — one front pilot car, on every road',
    { kind: 'gt', measure: 'frontOverhangIn', value: ftIn(15) },
    { escorts: 1, front: 1 },
  ),
  escortRule(
    'co-rear-overhang-over-25',
    'Rear overhang over 25 ft — one rear pilot car, on every road',
    { kind: 'gt', measure: 'rearOverhangIn', value: ftIn(25) },
    { escorts: 1, rear: 1 },
  ),

  /**
   * THE HEIGHT POLE WITHOUT A HEIGHT ESCORT. Colorado triggers pilot cars on
   * width, length and overhang and NEVER on height — but §505.1.7 requires any
   * front escort that is present to run a pole above 16 ft. So this rule sets
   * `heightPole` and asserts no count: a 17-ft-high, 10-ft-wide load on a white
   * segment needs no pilot car at all in Colorado, and inventing one to carry
   * the pole would bill a vehicle the state has not asked for.
   */
  escortRule(
    'co-height-pole-over-16',
    'Over 16 ft high — any front pilot car on the move must run a height pole',
    { kind: 'gt', measure: 'heightIn', value: ftIn(16) },
    {
      heightPole: true,
      advisory:
        '2 CCR 601-4 §505.1.7: "A Pilot Escort Vehicle shall use a Height pole at all times when escorting an Extra-legal Vehicle or Load exceeding sixteen feet in Height, unless otherwise expressly authorized by the Department on the permit." The pole must have "a non-conductive tip, made of non-destructive, flexible material", compression fittings need "a secondary means of securement" and are not allowed alone, and the pole "shall not extend more than six inches above the maximum Height" of the load — a CEILING on the pole, which is unusual: Virginia sets a floor of three inches above the load instead. Colorado triggers no escort on height alone, so this requirement only bites where a front car is already required for width, length or overhang.',
    },
    CCR_CH5,
    EFF_CCR_2018,
  ),
  escortRule(
    'co-signal-contractor-over-17-high',
    'Over 17 ft high — a licensed signal contractor must accompany the move through signalised intersections',
    { kind: 'gt', measure: 'heightIn', value: ftIn(17) },
    {
      advisory:
        '2 CCR 601-4 §409.4: "An Extra-legal Vehicle or Load more than 17 feet in Height must be accompanied by a licensed signal contractor through all intersections controlled by an overhead traffic signal." That is a third party nothing else in this directory requires — not a pilot car, not a utility crew, a contractor licensed to work on the signal hardware — and Colorado publishes no rate for one, so no cost for it is in the total. Separately, §607 makes the APPLICANT responsible for finding and clearing every overhead conflict before travel: "The Applicant shall contact the representatives of all such structures including but not limited to utility companies, if any, and shall resolve such conflicts before the move. An Extra-legal Vehicle or Load is prohibited from travel until such conflicts have been resolved." Colorado sets no height at which utility NOTIFICATION alone becomes mandatory; the duty attaches to any over-height move on the route the applicant chose.',
    },
  ),

  /**
   * THE FIVE THOUSAND POUNDS COLORADO'S OWN STATUTES ARGUE ABOUT. Below 80,001
   * lb both provisions agree the load is legal; above 85,000 lb both agree it
   * needs a permit. Only in between does the answer depend on which section is
   * read, so only a load in between hears about it. See the file header for why
   * the disagreement is NOT in `legalLimits`.
   */
  escortRule(
    'co-interstate-gross-80000-to-85000-conflict',
    'Between 80,000 lb and 85,000 lb — Colorado’s own statutes disagree about whether an interstate move needs an overweight permit',
    {
      kind: 'between',
      measure: 'grossWeightLbs',
      min: 80000,
      max: 85000,
      minInclusive: false,
    },
    {
      manualReview:
        'Two sections of the Colorado Revised Statutes give opposite answers for this load. C.R.S. §42-4-508(1)(c)(III)(B) states the interstate cap flatly — "in computations of this formula no gross vehicle weight shall exceed eighty thousand pounds, except as may be authorized under section 42-4-510" — so at this weight the move is overweight and needs a permit. C.R.S. §42-4-510(5) is the exception that section points at, and it directs CDOT and the Colorado State Patrol to authorise operation on the interstate system up to 85,000 lb where federal highway funding is not jeopardised, which would make the same load legal. OFF the interstate system the binding figure is different again: C.R.S. §42-4-508 caps a non-interstate combination by the formula W = 1,000 (L + 40) with an absolute ceiling of 85,000 lb, so a load in this band on a state highway may be legal purely on axle spacing. This quote prices the conservative reading — 80,000 lb is the legal gross, and a permit is charged — and neither figure has been adopted as the law. The permit requirement should be confirmed with CDOT for this route before the quote is issued.',
    },
    CRS_510,
    '2024-08-07',
  ),

  /**
   * OVER 200,000 LB THE PERMIT PRICED HERE IS NOT THE PERMIT COLORADO ISSUES,
   * and the escorts change with it: a Chapter 6 Special or Super Load carries a
   * mandatory front AND rear pilot car regardless of width, which the colour
   * ladders would never produce for a legal-width heavy load.
   */
  escortRule(
    'co-chapter-6-escorts-over-200000',
    'Over 200,000 lb — a Chapter 6 Special or Super Load permit, with a front and a rear pilot car required whatever the load measures',
    { kind: 'gt', measure: 'grossWeightLbs', value: 200000 },
    {
      escorts: 2,
      front: 1,
      rear: 1,
      routeSurvey: true,
      manualReview:
        '2 CCR 601-4 §603: "An Extra-legal Vehicle or Load under a special or Super Load permit shall have at least one Pilot Escort Vehicle in the front and shall have at least one Pilot Escort Vehicle in the rear, except when expressly designated otherwise by the Department. The Department may require the Permittee, as a condition of the permit, to provide Colorado State Patrol escort or additional Pilot Escort Vehicles and flagpersons based upon certain factors including, but not limited to: State Highway Width, traffic volume, visibility, and whether the Width of the Load interferes with or blocks more than one Lane of traffic." COLORADO DOES PUBLISH THE PERMIT FEE FOR THIS — $125 before the FASTER surcharge and $250 after it for a Chapter 6 Special between 200,001 and 500,000 lb, and $400 before and $800 after for a statutory Super Load at 500,000 lb or more — and it is still not quoted, because §606.4 lets CDOT require "Posting a bond or establishing an escrow account to pay for potential damage to the Highway or any Highway structure, or for cost of Department employees and/or Colorado State Patrol to accompany the load and supervise movement, or for response to any problems encountered during the move". Neither the bond, the escrow, the State Patrol time nor the additional flagpersons has a published rate: Colorado bills the actual cost. A $250 permit fee beside an unbounded escrow is not a total.',
    },
    CCR_CH6,
    EFF_CCR_2018,
  ),
  escortRule(
    'co-statutory-superload-class',
    'At 500,000 lb, or on a dual-lane trailer wider than 15 ft, Colorado’s own Super Load class applies',
    {
      kind: 'any',
      of: [
        { kind: 'gte', measure: 'grossWeightLbs', value: 500000 },
        { kind: 'gt', measure: 'widthIn', value: ftIn(15) },
      ],
    },
    {
      superload: true,
      advisory:
        'C.R.S. §42-4-510(1.7)(a): "The department of transportation may issue super-load permits for: (I) A combination vehicle with a weight of five hundred thousand pounds or more that occupies two lanes to haul the load; or (II) An unladen combination vehicle with an expandable dual-lane transport trailer that occupies two lanes", and 2 CCR 601-4 §609.1 supplies the missing definition — "a Vehicle or Load will be deemed to occupy two Lanes when the total Width of the Vehicle or Load exceeds 15 feet." BOTH statutory limbs also require the two-lane occupancy, so a 500,000 lb load on a single-lane-width trailer is not automatically in this class; the width test above is the published proxy and is stated rather than relied on. The statute additionally fixes the speed: "The department of transportation shall include in a super-load permit a speed restriction, not to exceed twenty-five miles per hour on the highway and ten miles per hour on structures" — which turns a long Colorado super-load move into a multi-day one and is not reflected in any transit estimate here.',
    },
    CRS_510,
    '2024-08-07',
  ),

  escortRule(
    'co-route-survey-required',
    'Over 17 ft 6 in high or over 130 ft long — Colorado requires a route survey and publishes no fee for one',
    {
      kind: 'any',
      of: [
        { kind: 'gt', measure: 'heightIn', value: ftIn(17, 6) },
        { kind: 'gt', measure: 'overallLengthIn', value: ftIn(130) },
      ],
    },
    {
      routeSurvey: true,
      advisory:
        '2 CCR 601-4 §303.16 and §303.17 list, among the documents a permit application must carry, "Route Survey for all Vehicles or Loads that exceed 17\' 6" in height" and "Route Survey for all Vehicles or Loads that exceed 130\' in Length", reaffirmed at §409.3. The survey is MANDATORY and its cost is NOT a state fee: Colorado does not perform route surveys, certified private escort personnel do, and no state schedule exists to quote from. The requirement is real and the price is the carrier’s to negotiate, so nothing for it appears in the total below.',
    },
    CCR_CH3,
    EFF_CCR_2018,
  ),

  escortRule(
    'co-police-escort-billed-at-cost',
    'Colorado has no published police-escort rate because it bills the actual cost through a bond or escrow',
    { kind: 'gt', measure: 'widthIn', value: 102 },
    {
      advisory:
        'Colorado publishes no hourly rate, no minimum block and no mileage basis for a Colorado State Patrol escort, and that is structural rather than a gap in the research. 2 CCR 601-4 §603 makes a CSP escort a discretionary permit CONDITION — imposed on "State Highway Width, traffic volume, visibility, and whether the Width of the Load interferes with or blocks more than one Lane of traffic" — and §606.4 then bills it: the permittee posts a bond or escrow "for cost of Department employees and/or Colorado State Patrol to accompany the load and supervise movement". There is no rate card to find; the number is whatever the escort actually costs. No police-escort amount is included in this quote and its absence must not be read as none being required.',
    },
    CCR_CH6,
    EFF_CCR_2018,
  ),

  escortRule(
    'co-night-and-seasonal-restrictions',
    'Colorado restricts wide loads after dark and closes the I-70 mountain corridor on a published calendar',
    { kind: 'gt', measure: 'widthIn', value: ftIn(12) },
    {
      advisory:
        'Two restrictions a quote cannot evaluate because it carries no clock and no route. AFTER DARK, §408.3.2: a load "that exceeds twelve feet in Width but does not exceed fourteen feet in Width" needs one front pilot car on all two-lane highways and one rear pilot car on all four-lane highways — which can be a DIFFERENT count from the daylight ladder — and §408.3.3: "An Extra-legal Vehicle or Load more than fourteen feet in Width is prohibited from travel during Hours of Darkness, unless authorized under a Chapter 6 Special permit." The escort count in this quote is the DAYLIGHT count. ON I-70, §402 prohibits extra-legal travel on the West Corridor between the Morrison exit and the West Vail exit at published times from December 1 to March 31 and again from May 15 to September 15, unless authorised under a Chapter 6 Special or Super Load permit. Separately §403.2 bars anything over 13 ft 11 in from the Eisenhower-Johnson Memorial Tunnels — SEVEN INCHES BELOW COLORADO’S OWN 14 ft 6 in legal height, so a perfectly legal-height load can be barred from the state’s main east-west crossing and routed the long way round.',
    },
  ),

  escortRule(
    'co-pilot-car-certification',
    'Colorado certifies its pilot-car operators and recognises six other states plus the SC&RA',
    { kind: 'gt', measure: 'widthIn', value: 102 },
    {
      advisory:
        'A pilot escort operating in Colorado must carry certification, and CDOT names exactly whose it will take: "Valid certification from Colorado, Arizona, Florida, Minnesota, Oklahoma, Utah, Washington or the Specialized Carriers and Rigging Association". 2 CCR 601-4 chapter 5 adds $1,000,000 of commercial liability insurance (§500.4.3) and an acceptable five-year motor-vehicle record (§500.5). The certificate runs four years. WHAT COLORADO DOES NOT PUBLISH is the other direction — which states will accept a Colorado certificate — so an operator certified here may or may not be able to work the neighbouring leg of the same move. None of this is a permit fee and none is in the total; it reaches a quote through the pilot-car operator’s own rate.',
    },
    CDOT_RESOURCES,
    RETRIEVED,
  ),

  escortRule(
    'co-faster-surcharge-and-card-fee',
    'Every Colorado permit fee below is the FASTER-doubled figure, and the $4 charge is card-only',
    {
      kind: 'any',
      of: [
        { kind: 'gt', measure: 'widthIn', value: 102 },
        { kind: 'gt', measure: 'heightIn', value: ftIn(14, 6) },
        { kind: 'gt', measure: 'grossWeightLbs', value: 80000 },
      ],
    },
    {
      advisory:
        'Colorado prints its permit fees twice and only the second figure is payable. CDOT: "Single Trip and Special Transport Permits issued will be assessed a surcharge equal to the amount of the permit fee pursuant to the passage of Senate Bill 09-108. A single trip permit costs $15*. If the vehicle or load is overweight add $5* per axle. For example a six-axle semi-truck/trailer with a load exceeding 80,000 pounds would cost $45." The $45 is the STATUTORY BASE; the surcharge under C.R.S. §43-4-804(1)(c)(I) doubles it to $90, and the amounts recorded in this file are the doubled ones so the quote shows what is actually charged. THE ORDER OF OPERATIONS IS THE STATE’S: base fee including the per-axle component first, then the 100% surcharge, then the card charge — "Credit Card Fee: $4 per transaction per permit", a flat amount and not a percentage, waived for an escrow account. ONE SINGLE-TRIP PRODUCT IS EXEMPT FROM THE SURCHARGE ALTOGETHER: the Non-Interstate Overweight Divisible Quad permit is "$30 plus $10 per axle" outright under C.R.S. §42-4-510(11)(a)(VI)(B), which §43-4-804(1)(c)(I) explicitly excludes — the same numbers as the doubled OSOW permit reached a different way, for a divisible load this engine does not quote.',
    },
    CDOT_FEES,
    RETRIEVED,
  ),

  escortRule(
    'co-permit-validity-five-days',
    'A Colorado single-trip permit runs at most five days, and a Special or Super Load permit is one trip only',
    {
      kind: 'any',
      of: [
        { kind: 'gt', measure: 'widthIn', value: 102 },
        { kind: 'gt', measure: 'grossWeightLbs', value: 80000 },
      ],
    },
    {
      advisory:
        '2 CCR 601-4 §300.1: "Single Trip Permit: A permit that is valid for a single move not to exceed a maximum of five days, as determined by the Department, over designated State Highways for an Extra-legal Vehicle or Load." CDOT sets the actual window, which may be shorter than five days. A Chapter 6 Special or Super Load permit is narrower still — §300.2 and §602 make it valid for a single one-way trip.',
    },
    CCR_CH3,
    EFF_CCR_2018,
  ),
];

// ── The conflicts that live outside the priced lines ──────────────────────
/**
 * Colorado's other two conflicts are about ANNUAL products a single-trip quote
 * does not price, so they cannot surface as a null fee. They are held by the
 * conflict mechanism anyway — both candidates with provenance, no adopted value,
 * review forced, an honest spread — because a conflict settled in a comment is a
 * conflict that comes back.
 */

/**
 * The annual LVC overweight-divisible permit, and CDOT's own page disagrees with
 * itself about it IN TWO PLACES ON THE SAME SCREEN. The fee list says "$400";
 * the Longer Vehicle Combination section a few rows down says "$1,500 plus $25
 * per vehicle". Same publisher, same document, same day — which is why neither
 * revision date can break the tie and no value is adopted.
 */
export const COLORADO_LVC_OWD_ANNUAL_FEE_USD: Sourced<number>[] = [
  fromUndatedPage(
    400,
    CDOT_FEES,
    'CDOT permitting page, fee list: "LVC OWD Permit: $400" — required to exceed 80,000 lb on designated LVC routes.',
  ),
  fromUndatedPage(
    1500,
    CDOT_FEES,
    'CDOT permitting page, Longer Vehicle Combination section: "LVC Overweight Divisible (to be used with an LVC permit): $1,500 plus $25 per vehicle". The per-vehicle component makes the two figures different in SHAPE as well as amount — one is a flat annual permit and the other is a fleet base — so they cannot be reconciled by reading one as a typo for the other.',
  ),
];

/**
 * The annual fleet permit's per-vehicle charge. $15 for a public utility
 * overlength fleet and $25 for an LVC overweight fleet, in two subparagraphs of
 * the same statute — and CDOT's portal prints only the $25 figure against a
 * generic "Fleet Base Fee", which is what makes it a conflict rather than two
 * clearly separate products.
 */
export const COLORADO_FLEET_PER_VEHICLE_FEE_USD: Sourced<number>[] = [
  fromDated(
    15,
    CRS_510,
    '2024-08-07',
    'C.R.S. §42-4-510(11)(a)(II) sets the annual overlength fleet permit for PUBLIC UTILITY vehicles at $1,500 plus $15 per vehicle.',
  ),
  fromUndatedPage(
    25,
    CDOT_FEES,
    'CDOT permitting page: "Fleet Base Fee: $1500 plus $25 per vehicle", matching C.R.S. §42-4-510(11)(a)(III)(C) for an LVC OVERWEIGHT fleet. The portal does not qualify which fleet it means, so a public-utility applicant reading the page and a public-utility applicant reading the statute get different numbers.',
  ),
];

/**
 * THE FUNDAMENTAL LIMIT CONFLICT, HELD OPEN AND KEPT OUT OF `legalLimits`.
 *
 * Both candidates are on file with provenance and `resolveSourced` returns null
 * for them, which is the contract. What it must NOT do is set the legal gross
 * weight, because a null there disables the over-dimension check entirely: the
 * engine would stop being able to tell that a 120,000 lb load is overweight, and
 * would drop the whole overweight charge rather than flag a five-thousand-pound
 * disagreement. `legalLimits.grossWeightLbs` therefore holds the conservative
 * 80,000 lb, and `co-interstate-gross-80000-to-85000-conflict` fires in exactly
 * the band where the two readings differ — the Texas 18 ft 11 in and New York
 * 160 ft pattern, applied to the most consequential number in the file.
 */
export const COLORADO_INTERSTATE_GROSS_WEIGHT_LBS: Sourced<number>[] = [
  fromUndatedPage(
    80000,
    MOFFAT_WEIGHTS,
    'C.R.S. §42-4-508(1)(c)(III)(B): "in computations of this formula no gross vehicle weight shall exceed eighty thousand pounds, except as may be authorized under section 42-4-510." The interstate cap under Federal Bridge Formula B.',
  ),
  fromDated(
    85000,
    CRS_510,
    '2024-08-07',
    'C.R.S. §42-4-510(5) directs CDOT and the Colorado State Patrol to authorise operation on the interstate system up to 85,000 lb provided federal highway funding is not jeopardised — the exception §42-4-508 points at, and the reason the flat 80,000 lb figure cannot simply be read as the answer.',
  ),
];

// ── The jurisdiction ──────────────────────────────────────────────────────

/**
 * ONE BAND, NO WEIGHT STEPS, AND ALL OF THE MONEY IN THE PER-AXLE COMPONENT.
 *
 * `feeUsd` is a SOURCED ZERO rather than an omission: Colorado adds nothing flat
 * to the overweight permit beyond the $30 base every single-trip permit pays, so
 * the whole overweight charge is $10 × axles. Writing the $30 here instead would
 * have double-billed it against `permitBaseFeeUsd`, and writing nothing at all
 * would have left the band without a recorded claim about its flat component.
 *
 * The band stops at 200,000 lb because CDOT's OSOW permit does — above it the
 * move is a Chapter 6 Special, which is a different product and is caught by the
 * superload trigger below, not by a missing band.
 */
const overweightBands: Sourced<WeightBand>[] = [
  fromUndatedPage<WeightBand>(
    { minLbs: 80001, maxLbs: 200000, feeUsd: 0, perAxleUsd: 10 },
    CDOT_FEES,
    'CDOT: "Single Trip OSOW: $15 plus $5 per axle* and a total of $30 plus $10 per axle" — C.R.S. §42-4-510(11)(a)(III)(B) sets "fifteen dollars plus five dollars per axle" and C.R.S. §43-4-804(1)(c)(I) doubles it. The $30 half is the base fee every single-trip permit pays and is recorded once, in `permitBaseFeeUsd`; the $10 per axle is what being overweight adds. The permit covers non-divisible loads to 200,000 lb GVW.',
  ),
];

export const COLORADO_OSOW_RULES: JurisdictionOsowRules = {
  code: 'CO',
  name: 'Colorado',
  country: 'US',

  legalLimits: {
    widthIn: [
      fromDated(
        102,
        CRS_502,
        '2008-08-05',
        'C.R.S. §42-4-502: "The total outside width of any vehicle or the load thereon shall not exceed eight feet six inches, except as otherwise provided in this section." INCLUSIVE — exactly 102 in is legal. Last amended in 2008 and the oldest statute in this file.',
      ),
    ],
    /**
     * 14 FT 6 IN — A FULL FOOT ABOVE MOST OF THIS DIRECTORY, AND THE SINGLE
     * EASIEST NUMBER TO GET WRONG BY ASSUMING THE 13 FT 6 IN THAT NEARLY EVERY
     * OTHER STATE USES. A 14 ft load needs no height permit in Colorado at all.
     * The catch is the tunnel: 2 CCR 601-4 §403.2 bars anything over 13 ft 11 in
     * from the Eisenhower-Johnson Memorial Tunnels, seven inches BELOW the legal
     * height, so a legal-height load can be legal statewide and barred from the
     * main east-west crossing. That is a routing fact rather than a limit and is
     * carried by `co-night-and-seasonal-restrictions`.
     */
    heightIn: [
      fromDated(
        ftIn(14, 6),
        CRS_504,
        '2016-08-10',
        'C.R.S. §42-4-504: "A driver shall not drive a vehicle either unladen or with load that exceeds a height of fourteen feet six inches. The department of transportation shall designate highways with overhead highway structures that have less than fourteen feet six inches of vertical clearance." EXCLUSIVE — exactly 14 ft 6 in is legal. Note the second sentence: Colorado guarantees nothing above 14 ft 6 in and publishes the exceptions, so clearance still has to be checked route by route.',
      ),
    ],
    trailerLengthIn: [
      fromDated(
        ftIn(57, 4),
        CRS_504,
        '2016-08-10',
        'C.R.S. §42-4-504: "Said length limitation shall not apply to unladen truck tractor-semitrailer combinations when the semitrailer is fifty-seven feet four inches or less in length or to unladen truck tractor-semitrailer-trailer combinations when the semitrailer and the trailer are each twenty-eight feet six inches or less in length." INCLUSIVE at 57 ft 4 in — one of the longest semitrailer allowances in this directory, and the condition on which the 70 ft combination cap is lifted.',
      ),
    ],
    /**
     * 75 FEET, AND IT IS A READING RATHER THAN A QUOTE — FLAGGED AS ONE.
     *
     * C.R.S. §42-4-504 states a flat 70 ft cap on "a combination of vehicles
     * coupled together" and then lifts it for a truck tractor-semitrailer whose
     * semitrailer is 57 ft 4 in or less. The research reads the operative cap for
     * a LADEN tractor-semitrailer as the 75 ft in §42-4-504(4.5)(b), and cites
     * that subsection in its notes without quoting it — so 75 ft rests on the
     * researcher's reading of a provision this dataset does not hold verbatim,
     * and that is why it is said here rather than left to be inferred from a bare
     * number.
     *
     * THE ALTERNATIVE WAS WORSE IN BOTH DIRECTIONS. Recording the quoted 70 ft
     * would flag an ordinary tractor and 53 ft trailer — about 70 to 73 ft over
     * the bumpers — as over-length on every Colorado lane, adding a permit the
     * state does not require. Recording BOTH would resolve the field to null and
     * disable the length check, so a 200 ft load would read as legal. Omitting
     * the field entirely would do the same thing more quietly.
     *
     * The 70 ft cap's real bite is already covered from the other side: it
     * applies where the semitrailer exceeds 57 ft 4 in, and `trailerLengthIn`
     * catches that load independently.
     */
    overallLengthIn: [
      fromDated(
        ftIn(75),
        CRS_504,
        '2016-08-10',
        'C.R.S. §42-4-504 caps a general combination at 70 ft — "No combination of vehicles coupled together shall consist of more than four units, and no such combination of vehicles shall exceed a total overall length of seventy feet." — and then exempts a truck tractor-semitrailer combination whose semitrailer is 57 ft 4 in or less. §42-4-504(4.5)(b) is cited by the source as restricting LADEN combinations over 75 ft without a permit, and 75 ft is used here on that reading. IT IS NOT A VERBATIM QUOTE: the subsection is referenced in the source’s notes rather than reproduced, so this figure is our reading of the source’s reading. A combination whose semitrailer exceeds 57 ft 4 in falls back to the 70 ft cap, and `trailerLengthIn` flags that load anyway.',
      ),
    ],
    frontOverhangIn: [
      fromDated(
        ftIn(4),
        CRS_504,
        '2016-08-10',
        'C.R.S. §42-4-504: "a load may project not more than four feet beyond the front most point of the grille assembly of the vehicle engine compartment of such a vehicle at a point above the cab of the driver\'s compartment". INCLUSIVE — exactly 4 ft is legal. Colorado measures from the GRILLE rather than the bumper, which is not the same datum every state uses.',
      ),
    ],
    rearOverhangIn: [
      fromDated(
        ftIn(10),
        CRS_504,
        '2016-08-10',
        'C.R.S. §42-4-504: "and no load shall project to the rear more than ten feet." INCLUSIVE, and by a distance the most generous rear-overhang allowance in this directory — Virginia and Texas both stop at 4 ft.',
      ),
    ],
    /**
     * 80,000 LB, WHICH IS THE CONSERVATIVE HALF OF A LIVE STATUTORY
     * DISAGREEMENT. See `COLORADO_INTERSTATE_GROSS_WEIGHT_LBS` and the file
     * header: recording both candidates here would resolve the field to null and
     * disable the whole overweight path.
     */
    grossWeightLbs: [
      fromUndatedPage(
        80000,
        MOFFAT_WEIGHTS,
        'C.R.S. §42-4-508(1)(c)(III)(B), via an undated county compilation: "and N equals number of axles in the group under consideration; but in computations of this formula no gross vehicle weight shall exceed eighty thousand pounds, except as may be authorized under section 42-4-510." OFF the interstate system the binding rule is a different formula with a different ceiling — "the maximum gross weight of any vehicle or combination of vehicles shall not exceed that determined by the formula W equals 1,000 (L plus 40) ... but in computation of this formula no gross vehicle weight shall exceed eighty-five thousand pounds" — so a non-interstate combination with enough axle spacing may lawfully run to 85,000 lb. The lower figure is used because a quote knows two endpoints and not which system the route uses, and because §42-4-510(5) puts the interstate figure itself in dispute.',
      ),
    ],
    singleAxleLbs: [
      fromUndatedPage(
        20000,
        MOFFAT_WEIGHTS,
        'C.R.S. §42-4-507: "when the wheels attached to a single axle are equipped with pneumatic tires, twenty thousand pounds". INCLUSIVE, and the same on and off the interstate system. §42-4-507(2)(b.5) allows 21,000 lb off the interstate for an electric utility digger derrick or bucket boom truck — a vehicle type a quote does not identify.',
      ),
    ],
    /**
     * 36,000 LB, THE INTERSTATE FIGURE — AND COLORADO'S TANDEM ALLOWANCE IS TWO
     * THOUSAND POUNDS ABOVE THE FEDERAL 34,000 EVERY OTHER STATE HERE USES, four
     * thousand more off the interstate. Recording the more generous 40,000 lb
     * would understate how often a Colorado load is legal on axle weight; both
     * figures would be a false conflict, because they are two systems rather than
     * two readings.
     */
    tandemAxleLbs: [
      fromUndatedPage(
        36000,
        MOFFAT_WEIGHTS,
        'C.R.S. §42-4-507: "When the wheels attached to a tandem axle are equipped with pneumatic tires, thirty-six thousand pounds for highways on the interstate system ... and forty thousand pounds for highways not on the interstate system." INCLUSIVE. The interstate figure is recorded because a quote cannot establish that a route stays off the interstate system, and the off-system figure is the more permissive of the two. §42-4-507(4)(b) defines the group as axle centres more than 40 inches and not more than 96 inches apart.',
      ),
    ],
  },

  /**
   * $30, AND IT IS THE FASTER-DOUBLED FIGURE RATHER THAN THE STATUTORY $15.
   * CDOT publishes both on the same line — "Single Trip Oversize: $15* and total
   * of $30" — and the $30 is what is charged. Recording BOTH would have been the
   * classic false conflict: the resolver would read two rows saying $15 and $30
   * as two sources disagreeing about one fee and refuse to price any Colorado
   * permit at all, when in fact the sources agree completely and are describing
   * two stages of the same calculation. The decomposition is recorded in the
   * note and in `co-faster-surcharge-and-card-fee` instead.
   */
  permitBaseFeeUsd: [
    fromUndatedPage(
      30,
      CDOT_FEES,
      '"Single Trip Oversize: $15* and total of $30". The $15 is the statutory base under C.R.S. §42-4-510(11)(a)(I)(B); the asterisk is CDOT’s own marker for the 100% FASTER surcharge imposed by C.R.S. §43-4-804(1)(c)(I) after Senate Bill 09-108, which doubles it. The same $30 base is charged on an overweight permit, to which the per-axle component is then added.',
    ),
  ],

  /**
   * NO `oversizeFeeBands`. Colorado charges one flat amount for any oversize
   * load whatever it measures — no width step, no height step, no length step —
   * so there is no band to select and `permitBaseFeeUsd` carries the whole
   * oversize charge. An empty band list would have been a different and wrong
   * claim: that we looked for Colorado's dimensional schedule and found nothing.
   */

  overweightPricing: [
    fromUndatedPage<OverweightPricing>(
      {
        kind: 'bands',
        explanation:
          'Colorado adds "$10 per axle" to the $30 single-trip base and nothing else. There is no weight increment and no mileage component at all: an 81,000 lb load and a 199,000 lb load on the same six axles pay exactly the same $90, and a seventh axle costs more than 118,000 lb of cargo does.',
      },
      CDOT_FEES,
    ),
  ],

  overweightBands,

  /** Nothing in Colorado's single-trip schedule is priced by distance. */
  overweightPerMile: [],

  conditionalFees: [],

  /**
   * $4 FLAT, AND NOT A PERCENTAGE — the same shape as Alabama's card charge and
   * the opposite of Texas's 2.25%. `percentOfTotal: 0` is a SOURCED zero here
   * rather than an omission: CDOT publishes a complete fee page with no
   * percentage surcharge anywhere on it, so the zero is a recorded finding.
   */
  transactionFee: [
    fromUndatedPage<TransactionFee>(
      { perPermitUsd: 4, percentOfTotal: 0 },
      CDOT_FEES,
      '"Credit Card Fee: $4 per transaction per permit" — Visa, MasterCard and Discover in COOPR. It is charged per PERMIT rather than per payment, so two permits on one card are $8, and an escrow account is exempt: a carrier settling through escrow pays $4 less than the total below.',
    ),
  ],

  /**
   * BOTH EMPTY, AND FOR A REASON COLORADO STATES RATHER THAN ONE WE INFERRED.
   * Colorado REQUIRES a route survey over 17 ft 6 in high or 130 ft long and
   * charges nothing for it, because it does not perform it — certified private
   * escort personnel do, at a price they set. There is no agency review fee to
   * record and no no-bridge alternative. Putting a number here would invent the
   * one figure the rules conspicuously do not give.
   */
  routeAnalysisFeeUsd: [],
  noBridgeRouteFeeUsd: [],

  superload: {
    /**
     * 200,000 LB, EXCLUSIVE — AND THE NUMBER IS THE CEILING OF THE PERMIT THIS
     * FILE PRICES, NOT COLORADO'S OWN USE OF THE WORD "SUPERLOAD".
     *
     * Colorado reserves "Super Load" for 500,000 lb or a dual-lane trailer wider
     * than 15 ft, and it publishes fees for everything in between: a Chapter 6
     * Special covers 200,001 to 500,000 lb at $125 before the surcharge and $250
     * after it. Recording 500,000 lb here would have been faithful to Colorado's
     * vocabulary and wrong for every other purpose — it would let the engine
     * price a 400,000 lb move on the ordinary $30-plus-per-axle schedule, which
     * is not the permit Colorado would issue, and it would let the widget's
     * weight ceiling wave through a load the server cannot price. This field
     * means "no published fee we can turn into a total", and above 200,000 lb
     * that is exactly the situation: the Chapter 6 fee IS published, but §606.4
     * attaches a bond or escrow for the actual cost of Department staff and
     * State Patrol, and an unbounded escrow beside a $250 permit is not a total.
     *
     * The 500,000 lb statutory class is carried by `co-statutory-superload-class`
     * so Colorado's own definition is on the quote rather than only in a comment.
     */
    grossWeight: [
      fromUndatedPage<Threshold>(
        { value: 200000, inclusive: false },
        CDOT_FEES,
        'CDOT’s single-trip OSOW permit covers non-divisible vehicles and loads up to 200,000 lb GVW; above that the move is a Chapter 6 Special under C.R.S. §42-4-510(11)(a)(IV) and 2 CCR 601-4 §600, which applies "to non-divisible loads between 200,001 and 500,000 lbs or moves requiring extraordinary action", and at 500,000 lb or more it is a statutory Super Load under §42-4-510(1.7). Neither is quoted here.',
      ),
    ],
    /** Colorado publishes no axle-spacing superload trigger. */
    shortSpacing: [],
    /**
     * 17 FEET IS THE ONE WIDTH AT WHICH EVERY COLOUR AGREES. Red demands a
     * Chapter 6 Special from 8 ft 6 in, blue from 13 ft, yellow from 15 ft, and
     * green and white from 17 ft — so past 17 ft there is no segment colour on
     * which the ordinary permit priced here is issued, whatever the route turns
     * out to be. Below 17 ft the answer depends on the colour and is carried by
     * the per-colour rules, which correctly go undecided when the colour is
     * unknown rather than assuming the permissive end.
     */
    widthIn: [
      fromDated<Threshold>(
        { value: ftIn(17), inclusive: false },
        CCR_CH4,
        EFF_CCR_2025,
        '2 CCR 601-4 §408.2.4.5 and the white-route rule both read "An Extra-legal Vehicle or Load that exceeds 17 feet in Width requires a Chapter 6 Special permit", and green and white are the most permissive colours Colorado publishes — every other colour reaches the Chapter 6 requirement at a narrower width. So no state highway segment admits an ordinary oversize permit above 17 ft.',
      ),
    ],
  },

  /**
   * COLORADO'S ROUTE SURVEY IS A DOCUMENT THE APPLICATION MUST CARRY, NOT AN
   * INSPECTION THE STATE PERFORMS — which is why the thresholds are recorded
   * here and the cost is not recorded anywhere. `widthIn` is EMPTY because
   * Colorado publishes no width-triggered survey: width sends a move to a
   * Chapter 6 Special instead, which is caught by the superload trigger above.
   */
  routeInspection: {
    widthIn: [],
    heightIn: [
      fromDated<Threshold>(
        { value: ftIn(17, 6), inclusive: false },
        CCR_CH3,
        EFF_CCR_2018,
        '2 CCR 601-4 §303.16: "Route Survey for all Vehicles or Loads that exceed 17\' 6" in height."',
      ),
    ],
    lengthIn: [
      fromDated<Threshold>(
        { value: ftIn(130), inclusive: false },
        CCR_CH3,
        EFF_CCR_2018,
        '2 CCR 601-4 §303.17: "Route Survey for all Vehicles or Loads that exceed 130\' in Length."',
      ),
    ],
  },

  escortRules: COLORADO_ESCORT_RULES,

  /**
   * FALSE. Colorado's single-trip fee is flat in dollars and linear in axles,
   * with no mileage component anywhere in C.R.S. §42-4-510(11)(a) — the only
   * distance in the whole schedule is the proration table for an annual fleet
   * permit's additional vehicles, which is not a single-trip product.
   */
  feesDependOnDistance: false,
};

/** Cited for the pilot-car operator certification and its reciprocity list. */
export const COLORADO_PILOT_CAR_CERTIFICATION_SOURCE = CDOT_RESOURCES;

/** Cited for the Chapter 6 bond/escrow, the discretionary CSP escort and the two-lane definition. */
export const COLORADO_SPECIAL_PERMIT_SOURCE = CCR_CH6;
