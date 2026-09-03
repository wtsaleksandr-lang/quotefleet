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
 *   - THE SUPERLOAD DAMAGE FEE. Virginia's superload permit is $30 — not the
 *     $20 an ordinary single trip costs — plus 30 cents a mile plus "an
 *     additional damage fee ... based on the gross weight of the vehicle
 *     configuration", and DMV publishes neither the bands nor the formula
 *     anywhere. It is computed inside the permitting system at issuance. That
 *     is an unbounded unknown attached to a permit type, so a Virginia
 *     superload carries no quoted total at all and never can.
 *   - THE PARTIAL-MILE RULE, which on a per-mile state touches every single
 *     overweight quote. Virginia says "30 cents per mile" and never says
 *     whether a part mile rounds up, rounds down or bills pro rata. This file
 *     bills pro rata and SAYS SO on the quote; it does not reach for a
 *     `Math.ceil` that would add money the Commonwealth has not published.
 *   - THE STATE POLICE ESCORT RATE, WHICH DOES NOT EXIST. Virginia is the only
 *     jurisdiction here where that is a structural fact rather than a gap:
 *     24VAC20-82-60.B.9 requires written authorisation from LOCAL law
 *     enforcement in each jurisdiction the load crosses, so there is no
 *     statewide schedule to find and the cost is whatever each locality agrees.
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
 *     absence of a requirement. A second research pass confirmed the absence
 *     positively rather than by silence, so this one is a finding now.
 *   - THE UTILITY WIRE LIFT. The same travel plan that needs local police
 *     authorisation also needs "Written authorization from affected utility,
 *     cable, and telephone companies, agreeing to accompany the overdimensional
 *     configuration to lift overhead wires" — a private arrangement with no
 *     published cost and no separate notification threshold.
 *
 * THE CODE OF VIRGINIA IS NOW CITED ALONGSIDE DMV'S RESTATEMENT OF IT, AND IT
 * BRINGS ITS OWN AGES WITH IT. Every legal limit here carries the statute
 * behind it as a second, corroborating row: §46.2-1105 (width, 2024),
 * §46.2-1110 (height, 2015), §46.2-1112 (lengths, 2016), §46.2-1120 and
 * §46.2-1121 (overhang, 2013 and 2022) — and then the weight sections, which
 * have not been touched in a generation. §46.2-1124, §46.2-1125 and §46.2-1127
 * were last amended in 1989 and §46.2-1126 in 1994. Nothing about that makes
 * them wrong, but a quote should be able to say it, and until these rows
 * existed nothing in this file could.
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

const ESCORT_TRAINING: SourceDoc = {
  id: 'va-dmv-escort-training-landing',
  title: 'Virginia DMV — Escort Vehicle Driver training and certification (undated)',
  url: 'https://www.dmv.virginia.gov/licenses-ids/training/escrt',
  publisher: 'Virginia Department of Motor Vehicles',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'Code of Virginia §46.2-2907 reciprocity; the SEVEN-state list — Florida, Georgia, Minnesota, North Carolina, Oklahoma, Utah, Washington',
};

const VAC_82_50: SourceDoc = {
  id: 'va-24vac20-82-50-2023-03',
  title: '24 Va. Admin. Code §20-82-50 — Single trip permits',
  url: 'https://law.lis.virginia.gov/admincode/title24/agency20/chapter82/section50/',
  publisher: 'Virginia Law Portal, Commonwealth of Virginia',
  revisedOn: '2023-03-01',
  retrievedOn: RETRIEVED,
  cite: '"Most single trip permits are valid for a 13-day period"; no refunds for unused or expired permits',
};

const VAC_82_140: SourceDoc = {
  id: 'va-24vac20-82-140-2023-03',
  title: '24 Va. Admin. Code §20-82-140 — Escort vehicle driver certificate fees',
  url: 'https://law.lis.virginia.gov/admincode/title24/agency20/chapter82/section140/',
  publisher: 'Virginia Law Portal, Commonwealth of Virginia',
  revisedOn: '2023-03-01',
  retrievedOn: RETRIEVED,
  cite: '"The fee to reissue or issue a duplicate escort vehicle driver certificate is $15."',
};

// ── The Code of Virginia itself ───────────────────────────────────────────
/**
 * THE STATUTES, AND THEIR REAL AGES. Everything above is DMV's restatement of
 * the law; this block is the law. Adding it is not decoration — it is the only
 * way the quote can say how old Virginia's numbers actually are.
 *
 * THE VIRGINIA LAW PORTAL STATES A YEAR AND NOTHING MORE. Its history lines
 * read "1989" for §46.2-1124, with no month and no day, so `revisedOn` carries
 * the bare year. Writing `1989-01-01` would invent a precision the source does
 * not have; writing `null` would discard the single most useful thing the line
 * says. See `SourceDoc.revisedOn` for why a partial date is allowed there.
 *
 * VIRGINIA'S WEIGHT LAW IS THIRTY-SEVEN YEARS OLD. §46.2-1124 (single axle),
 * §46.2-1125 (tandem axle) and §46.2-1127 (interstate gross) were all last
 * amended in 1989, and §46.2-1126 (the axle-spacing table) in 1994. That is not
 * a defect — an old statute is not a wrong statute — but it is a fact a quote
 * should be able to state, and until now nothing in this file could.
 */
const VA_1105: SourceDoc = {
  id: 'va-code-46-2-1105',
  title: 'Code of Virginia §46.2-1105 — Width of vehicles',
  url: 'https://law.lis.virginia.gov/vacode/title46.2/chapter10/section46.2-1105/',
  publisher: 'Virginia Law Portal, Commonwealth of Virginia',
  revisedOn: '2024',
  retrievedOn: RETRIEVED,
  cite: '"shall not exceed a total outside width of 102 inches"; subsection B on travel-trailer and motor-home appurtenances',
};

const VA_1110: SourceDoc = {
  id: 'va-code-46-2-1110',
  title: 'Code of Virginia §46.2-1110 — Height of vehicles',
  url: 'https://law.lis.virginia.gov/vacode/title46.2/chapter10/section46.2-1110/',
  publisher: 'Virginia Law Portal, Commonwealth of Virginia',
  revisedOn: '2015',
  retrievedOn: RETRIEVED,
  cite: '"No loaded or unloaded vehicle shall exceed a height of 13 feet, six inches."',
};

const VA_1112: SourceDoc = {
  id: 'va-code-46-2-1112',
  title: 'Code of Virginia §46.2-1112 — Length of vehicles, generally',
  url: 'https://law.lis.virginia.gov/vacode/title46.2/chapter10/section46.2-1112/',
  publisher: 'Virginia Law Portal, Commonwealth of Virginia',
  revisedOn: '2016',
  retrievedOn: RETRIEVED,
  cite: '65 ft combination; the interstate/designated-highway exemption from any overall length restriction; the 48 ft semitrailer, the 41 ft kingpin condition and the 53 ft allowance; 28½ ft per trailer in a twin',
};

const VA_1120: SourceDoc = {
  id: 'va-code-46-2-1120',
  title: 'Code of Virginia §46.2-1120 — Extension of loads beyond front of vehicles',
  url: 'https://law.lis.virginia.gov/vacode/title46.2/chapter10/section46.2-1120/',
  publisher: 'Virginia Law Portal, Commonwealth of Virginia',
  revisedOn: '2013',
  retrievedOn: RETRIEVED,
  cite: '"no vehicle shall carry any load extending more than three feet beyond the front of such vehicle"; subsection C, self-propelled pole carriers to 10 ft',
};

const VA_1121: SourceDoc = {
  id: 'va-code-46-2-1121',
  title: 'Code of Virginia §46.2-1121 — Warning devices on projecting loads',
  url: 'https://law.lis.virginia.gov/vacode/title46.2/chapter10/section46.2-1121/',
  publisher: 'Virginia Law Portal, Commonwealth of Virginia',
  revisedOn: '2022',
  retrievedOn: RETRIEVED,
  cite: '"more than four feet beyond the rear of the vehicle shall have the extremities of the load marked with a red or orange fluorescent warning flag"',
};

const VA_1124: SourceDoc = {
  id: 'va-code-46-2-1124',
  title: 'Code of Virginia §46.2-1124 — Maximum single axle weight (last amended 1989)',
  url: 'https://law.lis.virginia.gov/vacode/title46.2/chapter10/section46.2-1124/',
  publisher: 'Virginia Law Portal, Commonwealth of Virginia',
  revisedOn: '1989',
  retrievedOn: RETRIEVED,
  cite: '"shall not exceed 20,000 pounds, nor shall it exceed 650 pounds per inch, width of tire"',
};

const VA_1125: SourceDoc = {
  id: 'va-code-46-2-1125',
  title: 'Code of Virginia §46.2-1125 — Maximum tandem axle weight (last amended 1989)',
  url: 'https://law.lis.virginia.gov/vacode/title46.2/chapter10/section46.2-1125/',
  publisher: 'Virginia Law Portal, Commonwealth of Virginia',
  revisedOn: '1989',
  retrievedOn: RETRIEVED,
  cite: '"The tandem axle weight of any vehicle or combination shall not exceed 34,000 pounds"; the 40–96 inch spacing definition',
};

const VA_1126: SourceDoc = {
  id: 'va-code-46-2-1126',
  title: 'Code of Virginia §46.2-1126 — Maximum gross weight, axle-spacing table (last amended 1994)',
  url: 'https://law.lis.virginia.gov/vacode/title46.2/chapter10/section46.2-1126/',
  publisher: 'Virginia Law Portal, Commonwealth of Virginia',
  revisedOn: '1994',
  retrievedOn: RETRIEVED,
  cite: '"shall not exceed the maximum weight given for the respective distance between the first and last axle ... with any fraction of a foot rounded to the next highest"',
};

const VA_1127: SourceDoc = {
  id: 'va-code-46-2-1127',
  title: 'Code of Virginia §46.2-1127 — Weight limits on interstate highways (last amended 1989)',
  url: 'https://law.lis.virginia.gov/vacode/title46.2/chapter10/section46.2-1127/',
  publisher: 'Virginia Law Portal, Commonwealth of Virginia',
  revisedOn: '1989',
  retrievedOn: RETRIEVED,
  cite: '"a gross weight, regardless of axle spacing, in excess of 80,000 pounds, unless otherwise permitted by the proper authority"',
};

const VA_1128: SourceDoc = {
  id: 'va-code-46-2-1128',
  title: 'Code of Virginia §46.2-1128 — Extensions of weight limits; fees (last amended 2012)',
  url: 'https://law.lis.virginia.gov/vacode/title46.2/chapter10/section46.2-1128/',
  publisher: 'Virginia Law Portal, Commonwealth of Virginia',
  revisedOn: '2012',
  retrievedOn: RETRIEVED,
  cite: 'the 5% overload extension, the 84,000 lb ceiling, the interstate exclusion, and "Permits under this section shall be valid for one year and the fee shall be $250."',
};

const VA_1139: SourceDoc = {
  id: 'va-code-46-2-1139',
  title: 'Code of Virginia §46.2-1139 — Permits for excessive size and weight (last amended 2017)',
  url: 'https://law.lis.virginia.gov/vacode/title46.2/chapter10/section46.2-1139/',
  publisher: 'Virginia Law Portal, Commonwealth of Virginia',
  revisedOn: '2017',
  retrievedOn: RETRIEVED,
  cite: 'subsection B, overweight permits on interstate highways for irreducible loads; the $10 multi-trip permit transfer fee, maximum two transfers per 12 months',
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

/**
 * A row from a Code of Virginia section whose history line gives only a YEAR.
 *
 * `revisedOn` keeps the bare year, because that is what the document states.
 * `effectiveFrom` cannot: it feeds `isInEffect`, which needs a full date. Acts
 * of the Virginia General Assembly passed in a regular session take effect on
 * the first day of July following that session unless the act says otherwise,
 * so `YYYY-07-01` is the earliest full date we can defend for a section last
 * amended in `YYYY`.
 *
 * INFERENCE FLAG: the July 1 date is the standard Virginia effective date, not
 * a date any of these sources prints. It is used only for `effectiveFrom`,
 * where being later than the truth can only ever narrow what we claim, and
 * where for a 1989 statute it makes no difference to any quote priced today.
 */
function fromStatute<T>(
  value: T,
  source: SourceDoc,
  amendedYear: string,
  note?: string,
): Sourced<T> {
  return {
    value,
    source,
    effectiveFrom: `${amendedYear}-07-01`,
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
   *
   * A SECOND RESEARCH PASS DID NOT DISSOLVE IT, AND DID NOT CONFIRM IT EITHER.
   * A later and much wider sweep of Virginia's sources found NO conflicts
   * anywhere in the state's published rules, and it quoted 24VAC20-82-130(9)
   * verbatim at 14 ft 5 in — corroborating the Administrative Code side exactly.
   * What it did not do is reach the DMV escort-vehicle FAQ at all, so it neither
   * contradicts the 14 ft 6 in figure nor withdraws it. Both rows therefore
   * stand: the Code figure now has two independent readings behind it, and the
   * FAQ's remains a single undated page that hedges with "generally". That is
   * a weaker conflict than it was, not a resolved one, and the one-inch band
   * still says so.
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
        '24VAC20-82-60: a movement exceeding 18 feet in width, 250,000 pounds in weight, 200 feet in length or 16 feet in height "may be required to submit a detailed travel plan", and that plan "should include ... Written authorization from local law-enforcement personnel agreeing to escort the overdimensional configuration through their jurisdiction". The SAME travel plan requires a second written authorisation nothing else in this dataset asks for — item 10: "Written authorization from affected utility, cable, and telephone companies, agreeing to accompany the overdimensional configuration to lift overhead wires." That is a utility crew accompanying the move, arranged and paid for privately before DMV will issue the permit, and Virginia publishes no threshold at which utility NOTIFICATION alone is required and no cost for either. Virginia publishes no fixed gross-weight superload threshold at all — its published gross limit is "based on total number of axles in the configuration and total amount of spacing" — so this parameter is the only weight line the state states numerically, and a load past it is not priced here. Above 400,000 lb VDOT additionally requires a schematic of the vehicle showing longitudinal axle spacing and transverse tyre dimensions; above 750,000 lb it requires the applicant to retain an engineer licensed in Virginia to analyse every structure on the route, and it may require that between 500,000 and 750,000 lb at its sole discretion. VDOT may also require pre-travel and post-travel structure inspections, and where it does it requires a surety bond whose amount it sets alone. None of those costs is published.',
    },
    VAC_82_60,
    EFF_VAC,
  ),

  /**
   * VIRGINIA HAS NO STATE POLICE ESCORT RATE — NOT AN UNFOUND ONE, A
   * NON-EXISTENT ONE. THIS IS A DIFFERENT CLAIM, AND IT IS THE STRONGER ONE.
   *
   * Every other jurisdiction in this directory either publishes a
   * law-enforcement rate or has one somewhere in a police agency's own fee
   * schedule that a search can miss. Virginia is structurally different:
   * 24VAC20-82-60.B.9 does not send the carrier to a state rate card at all, it
   * requires "Written authorization from local law-enforcement personnel
   * agreeing to escort the overdimensional configuration through their
   * jurisdiction" — a separate arrangement with EACH locality the route
   * crosses, negotiated before DMV will issue the permit.
   *
   * There is therefore no schedule to find. A second research pass across the
   * Virginia State Police and the Administrative Code confirmed no standardised
   * hourly rate, no administrative fee per application, no minimum hours, no
   * mileage basis, no per diem and no cancellation charge. The previous wording
   * here said a rate "was not found in any official source", which invites the
   * reader to assume one exists and we missed it. It does not exist.
   */
  escortRule(
    'va-police-escort-per-locality',
    'Virginia publishes no state police escort rate because there is none — each locality crossed authorises and prices its own escort',
    { kind: 'gt', measure: 'widthIn', value: ftIn(12) },
    {
      advisory:
        'Virginia does not have a state police escort rate. Where a law-enforcement escort is required, 24VAC20-82-60.B.9 requires the applicant to obtain "Written authorization from local law-enforcement personnel agreeing to escort the overdimensional configuration through their jurisdiction", including a named point of contact whom "The hauling permit staff will contact ... to confirm their escorting role prior to DMV issuing the superload single trip permit". That is a per-locality arrangement, negotiated separately with every jurisdiction on the route, and neither the Virginia State Police nor 24VAC20-82 publishes an hourly rate, an administrative fee, a minimum number of hours, a mileage basis, a subsistence allowance or a cancellation charge for one. So this is not a figure that was looked for and missed — there is no published schedule to quote, the cost is whatever each locality agrees, and it cannot be estimated here. DMV109 adds that "law enforcement escorts may be required on a case-by-case basis" and that "All escort requirements will be listed on your hauling permit or your locality permit", and a locality can issue its own permit with its own escort conditions on top.',
    },
    VAC_82_60,
    EFF_VAC,
  ),

  /**
   * THE ROUNDING RULE VIRGINIA NEVER WROTE DOWN, ON A STATE THAT CHARGES BY THE
   * MILE. It touches every overweight Virginia quote, so it is said out loud
   * rather than decided quietly in `perMileAmount`.
   */
  escortRule(
    'va-mileage-fee-rounding-unpublished',
    'Virginia charges 30 cents per mile and never says how a PART mile is billed — this quote bills the true mileage pro rata',
    { kind: 'gt', measure: 'grossWeightLbs', value: 80000 },
    {
      advisory:
        'Virginia\'s overweight charge is "a mileage fee of 30 cents per mile", and neither DMV nor 24VAC20-82 states anywhere whether a PART mile is rounded up, rounded down, or billed pro rata. Every source is silent on it. This quote bills the true in-state mileage pro rata — 180.4 miles is charged as 180.4 miles — because that is the only reading that neither adds money the Commonwealth has not published nor deducts money it has. It is an ASSUMPTION, not a rule: a state that rounded up to the whole mile would charge up to 30 cents more, and the figure EZ Haul prints on the issued permit governs. The exposure is bounded at one mile\'s charge, which is why this is stated as an exclusion rather than sent to review. Mobile homes and manufactured housing do not pay this at all — "Mobile homes and Manufactured housing will pay a flat fee of $1.00 in lieu of the 30 cents per mile fee" — and a quote does not identify the commodity, so a manufactured-home move quoted here is over-billed by the whole mileage line less one dollar.',
    },
    HAULING,
    RETRIEVED,
  ),

  /**
   * A VIRGINIA SUPERLOAD IS UNQUOTABLE, AND THE REASON IS ONE SENTENCE LONG.
   *
   * The engine already refuses to price a load past the superload triggers.
   * What it could not say until now is WHY the refusal is permanent rather than
   * a research gap: the superload base fee is $30 rather than the $20 in the
   * priced rows, the 30-cent mileage still applies on top, and then there is a
   * third component — "An additional damage fee is added based on the gross
   * weight of the vehicle configuration" — for which DMV publishes no bands, no
   * rate table and no formula anywhere. It is computed inside EZ Haul at
   * issuance. No amount of further research produces that number, and the
   * comparison that proves the point is DMV's own: for a BLANKET permit the
   * same damage fee IS codified, at a flat $360 a year. For a single trip it is
   * simply not published.
   */
  escortRule(
    'va-superload-fee-not-quotable',
    'A Virginia superload is $30 plus mileage plus an unpublished damage fee, so no superload total can be quoted at all',
    {
      kind: 'any',
      of: [
        { kind: 'gt', measure: 'widthIn', value: ftIn(15) },
        { kind: 'gt', measure: 'heightIn', value: ftIn(15) },
        { kind: 'gt', measure: 'overallLengthIn', value: ftIn(150) },
      ],
    },
    {
      superload: true,
      manualReview:
        'This move is a Virginia superload, and Virginia superloads have no computable total. The base fee is $30, not the $20 single-trip figure — "Superload | The overall size and or weight of the vehicle configuration requires research and analysis. | $30" — the 30-cent-per-mile charge still applies on top, and then a third component is added that DMV does not publish: "An additional damage fee is added based on the gross weight of the vehicle configuration." No band table, no rate and no formula for that damage fee appears in 24VAC20-82 or anywhere on dmv.virginia.gov; it is generated at issuance by the permitting system from the configuration and the route\'s bridge inventory. The contrast is DMV\'s own — for a BLANKET overweight permit the damage fee is codified at a flat $360 per year, and for a single trip it is not codified at all. So no Virginia superload amount is quoted here, and none can be: the permit must be priced by DMV. Applications should be filed at least 10 working days ahead.',
    },
    HAULING,
    RETRIEVED,
  ),

  escortRule(
    'va-escort-driver-certification',
    'Virginia certifies its escort drivers, and the certification cost is the operator’s rather than a permit fee',
    { kind: 'gt', measure: 'widthIn', value: ftIn(12) },
    {
      advisory:
        'Every escort vehicle operator working an oversize or overweight load in Virginia must be certified before performing the duties. Certification is an eight-hour classroom course and a DMV examination; the certificate costs $25 to obtain or renew, is valid five years, and carries a $2 fee for each re-examination. The $15 duplicate or reissue fee is codified rather than only published — 24VAC20-82-140: "The fee to reissue or issue a duplicate escort vehicle driver certificate is $15." The training course itself has no DMV-set price: "The cost for the training course will vary based upon the site offering the course." RECIPROCITY — TWO DMV PAGES DISAGREE, AND BOTH ARE UNDATED. The escort-driver certification page states, citing Code of Virginia §46.2-2907, that "Currently, Virginia has reciprocity agreements with the following states: Florida Georgia Minnesota North Carolina Oklahoma Utah Washington" — seven states, and the recognition runs both ways. The separate escort-driver FAQ says only "Currently, we have an agreement with North Carolina." Neither page carries a revision date so neither can be shown to supersede the other; the seven-state list is the more specific and is the one that cites the statute, and it is used here, but a certification\'s portability should be confirmed with DMV before it is relied on. Virginia State Police officers, Virginia law-enforcement officials providing escort services, military convoys and other federal or state government vehicles are exempt from the certification requirement. None of these amounts is a permit fee and none is in the total below; they reach a quote through the pilot-car operator\'s rate.',
    },
    ESCORT_TRAINING,
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
 * NO MINIMUM, NO MAXIMUM, AND — THE ONE THAT MATTERS — NO ROUNDING RULE.
 * Virginia publishes none of the three, so none is invented. `roundMilesUpTo`
 * is deliberately ABSENT rather than set to 1: the sources say "30 cents per
 * mile" and stop, and a `Math.ceil` here would silently add up to thirty cents
 * to every overweight Virginia quote on the authority of nothing. The
 * assumption that the true mileage is billed pro rata is stated out loud on the
 * quote by `va-mileage-fee-rounding-unpublished` rather than left implicit.
 *
 * A mobile home or manufactured house pays a flat $1.00 in lieu of the mileage
 * fee ENTIRELY — not in addition to it, and not as a minimum. A quote does not
 * identify the commodity, so that substitution is recorded and not applied, and
 * the same advisory says how far wrong that leaves a manufactured-home move.
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
      fromStatute(
        102,
        VA_1105,
        '2024',
        '§46.2-1105: "No vehicle, including any load thereon, but excluding the mirror required by § 46.2-1082 and any warning device installed on a school bus pursuant to § 46.2-1090, shall exceed a total outside width of 102 inches." EXCLUSIVE — a load measuring exactly 102 in is legal. Subsection B allows a travel trailer or motor home to exceed 102 in where the excess "is attributable to an appurtenance that extends no more than six inches beyond the body of the vehicle", which a quote does not detect; §46.2-1111 separately forbids a load "extending more than six inches beyond the line of the fender or body".',
      ),
    ],
    heightIn: [
      fromDated(ftIn(13, 6), DMV109, EFF_DMV109, '"Height: 13 feet 6 inches" — a hauling permit is required above it.'),
      fromStatute(
        ftIn(13, 6),
        VA_1110,
        '2015',
        '§46.2-1110: "No loaded or unloaded vehicle shall exceed a height of 13 feet, six inches." EXCLUSIVE. The same section adds that public authorities and railroad companies are not required to provide clearances over 12 ft 6 in — so the legal height and the guaranteed clearance are a foot apart, and the carrier carries that gap.',
      ),
    ],
    /**
     * 53 ft, WHICH IS A CHOICE — AND THE STATUTE SAYS WHAT IT COSTS. Virginia
     * publishes 48 ft for a trailer and adds that "53-foot trailers are allowed
     * on interstate system". Recording 48 ft would flag the ordinary 53 ft
     * trailer as over-length on the network these quotes are priced for;
     * recording 53 ft understates the limit on a purely non-interstate lane.
     * The interstate figure is used because that is where this corridor's
     * freight runs, and the alternative is on the row.
     *
     * §46.2-1112 adds the condition DMV's summary leaves out: the 53 ft
     * allowance is not free-standing, it is bought with a kingpin distance of
     * "not more than 41 feet". That condition is now recorded properly in
     * `kingpinToRearAxleIn` below rather than left in prose.
     */
    trailerLengthIn: [
      fromDated(
        ftIn(53),
        DMV109,
        EFF_DMV109,
        '"Length (trailers): 48 feet (53-foot trailers are allowed on interstate system)". The 53 ft interstate figure is used; a trailer over 48 ft travelling entirely off the interstate system needs a permit that this row will not detect.',
      ),
      fromStatute(
        ftIn(53),
        VA_1112,
        '2016',
        '§46.2-1112: "no semitrailer being operated in a tractor truck semitrailer combination shall exceed 48 feet in length, except when semitrailers have a distance of not more than 41 feet between the kingpin of the semitrailer and the rearmost axle or a point midway between the rear tandem axles, such semitrailer shall be allowed not more than 53 feet in length." The two boundaries are opposite: "shall exceed 48 feet" is exclusive and "allowed not more than 53 feet" is inclusive. A twin combination is capped separately at 28½ ft per trailer and is not modelled here.',
      ),
    ],
    /**
     * 41 FEET, AND IT IS THE CONDITION ON THE 53 FT ROW ABOVE. Virginia is one
     * of seven jurisdictions in this directory that publishes a kingpin limit
     * and, until `kingpinToRearAxleIn` existed, all seven carried it as prose in
     * a note because there was nowhere to put it. It is OPTIONAL and silent: a
     * quote that supplies no kingpin distance is priced exactly as it was
     * before this row existed.
     *
     * BOUNDARY: "not more than 41 feet" is INCLUSIVE — 41 ft 0 in qualifies for
     * the 53 ft allowance, 41 ft 1 in does not.
     */
    kingpinToRearAxleIn: [
      fromStatute(
        ftIn(41),
        VA_1112,
        '2016',
        '§46.2-1112 conditions the 53 ft semitrailer allowance on "a distance of not more than 41 feet between the kingpin of the semitrailer and the rearmost axle or a point midway between the rear tandem axles". A semitrailer over 41 ft of kingpin distance falls back to the 48 ft cap, which the 53 ft row above will not catch on its own.',
      ),
    ],
    /**
     * `overallLengthIn` is ABSENT. Virginia caps a vehicle/trailer combination
     * at 65 ft, and then states for interstate and designated highways
     * "Combinations ... No overall length restrictions". Applying 65 ft would
     * put every ordinary tractor-semitrailer over the limit on the network the
     * quotes are priced for. §46.2-1112 is explicit: "No overall length
     * restrictions, however, shall be imposed on any tractor truck semitrailer
     * combinations drawing one trailer or any tractor truck semitrailer
     * combinations when operated on any interstate highway or on any highway as
     * designated by the Commonwealth Transportation Board." The 65 ft cap does
     * bite on NON-designated highways, which a quote's endpoints cannot
     * establish — so it is recorded here in prose rather than as a threshold
     * that would fire on every lane.
     */
    frontOverhangIn: [
      fromDated(ftIn(3), DMV109, EFF_DMV109, '"Overhang: 4 feet – rear; 3 feet - front"'),
      fromStatute(
        ftIn(3),
        VA_1120,
        '2013',
        '§46.2-1120: "Except as provided in subsection C, no vehicle shall carry any load extending more than three feet beyond the front of such vehicle." EXCLUSIVE. Subsection C lets a self-propelled pole carrier run poles up to 10 ft past the front bumper if marked — a commodity exemption a quote does not identify.',
      ),
    ],
    rearOverhangIn: [
      fromDated(ftIn(4), DMV109, EFF_DMV109),
      fromStatute(
        ftIn(4),
        VA_1121,
        '2022',
        'The statutory 4 ft figure is a MARKING threshold, not a prohibition: §46.2-1121 requires a load extending "more than four feet beyond the rear of the vehicle" to have its extremities "marked with a red or orange fluorescent warning flag". DMV\'s own hauling page prints the same 4 ft as the rear overhang limit, so the number is not in dispute — but the statute behind it flags rather than forbids, and the two should not be conflated.',
      ),
    ],
    grossWeightLbs: [
      fromDated(
        80000,
        DMV109,
        EFF_DMV109,
        '"No vehicle can travel on Virginia highways with a single axle weight in excess of 20,000 pounds, tandem axle weight in excess of 34,000 pounds, or a gross weight in excess of 80,000 pounds." The lawful gross is often LOWER: "The maximum gross weight is determined by the total number of axles and by measuring the distance between the first axle (steering) and extreme rear axle", and the official axle-spacing chart controls wherever it produces a smaller figure.',
      ),
      fromStatute(
        80000,
        VA_1127,
        '1989',
        '§46.2-1127, LAST AMENDED IN 1989: "No motor vehicle or combination of vehicles shall travel on an interstate highway in the Commonwealth with (i) a single axle weight in excess of 20,000 pounds, or (ii) a tandem axle weight in excess of 34,000 pounds, or (iii) a gross weight, based on axle spacing, greater than that permitted in § 46.2-1126, or (iv) a gross weight, regardless of axle spacing, in excess of 80,000 pounds, unless otherwise permitted by the proper authority." EXCLUSIVE. Off the interstate the binding figure is §46.2-1126\'s axle-spacing table (last amended 1994), whose own maximum is also 80,000 lb and which rounds "any fraction of a foot ... to the next highest". §46.2-1128 allows a separate annual 5% extension permit to 84,000 lb on non-interstate highways only, and §46.2-1139.B restricts an overweight permit on an interstate highway to an IRREDUCIBLE load — a condition a quote does not establish.',
      ),
    ],
    singleAxleLbs: [
      fromDated(20000, DMV109, EFF_DMV109, 'A separate limit of 650 lb per inch of tyre width in contact with the road also applies and is not modelled — tyre width is not collected on a quote.'),
      fromStatute(
        20000,
        VA_1124,
        '1989',
        '§46.2-1124, LAST AMENDED IN 1989: "The single axle weight of any vehicle or combination shall not exceed 20,000 pounds, nor shall it exceed 650 pounds per inch, width of tire, measured in contact with the surface of the highway." INCLUSIVE — exactly 20,000 lb is legal.',
      ),
    ],
    tandemAxleLbs: [
      fromDated(34000, DMV109, EFF_DMV109, 'Tandem defined as more than 40 inches but no more than 96 inches between axle centres.'),
      fromStatute(
        34000,
        VA_1125,
        '1989',
        '§46.2-1125, LAST AMENDED IN 1989: "The tandem axle weight of any vehicle or combination shall not exceed 34,000 pounds, and no one axle of such tandem unit shall exceed the weight permitted for a single axle." INCLUSIVE. The statute defines the group by spacing "not less than forty inches nor more than ninety-six inches apart", which differs from DMV109\'s "more than 40 inches" at the 40-inch boundary itself; the weight is the same either way, and the boundary decides only which rule a 40-inch group is measured under.',
      ),
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
    fromUndatedPage(
      20,
      HAULING,
      '"Single Trip | One move between origin and destination. | $20". This $20 is the ORDINARY single-trip figure and is NOT the superload figure: DMV\'s same table prices a superload single trip at $30 ("Superload | The overall size and or weight of the vehicle configuration requires research and analysis. | $30"), and a superload also carries the unpublished damage fee that makes it unquotable — see `va-superload-fee-not-quotable`. The engine emits no priced line at all once a superload trigger fires, so the $20 here can never be presented as a superload total. Multi-trip permits are outside a single-trip quote: a blanket permit is $100 for one year or $200 for two, and $500 for one overweight year once its $40 mileage fee and $360 damage fee are added; a §46.2-1128 5% overload extension is $250 a year and is barred from the interstate system; the exempt commodity permits run $45 to $130 a year. VALIDITY: 24VAC20-82-50 provides that "Most single trip permits are valid for a 13-day period; however, DMV may restrict any single trip permit movement to a shorter period", and "No refunds or credits will be granted for unused or expired permits" — so one permit ordinarily covers a multi-day move.',
    ),
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
   * EMPTY, AND THE SECOND RESEARCH PASS TURNED THIS FROM AN ABSENCE INTO A
   * FINDING. Virginia charges no agency fee to review a route or bridge
   * analysis, and it charges no route-survey fee either — because it does not
   * perform route surveys at all. Surveys are arranged privately through
   * certified escort companies or an applicant-retained licensed engineer, and
   * the Commonwealth publishes no standardised fee schedule for one. Where the
   * analysis is done by an applicant-retained engineer above 750,000 lb, that
   * engineer is likewise paid by the applicant and not by the Commonwealth.
   *
   * What Virginia charges a superload instead is $30 plus mileage plus "an
   * additional damage fee ... based on the gross weight of the vehicle
   * configuration", whose bands, amount and formula DMV does not publish
   * anywhere. Any figure recorded here would be invented.
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

/**
 * The two undated DMV pages that disagree about escort-driver reciprocity: the
 * certification landing page lists SEVEN reciprocal states citing §46.2-2907,
 * and the escort-driver FAQ names only North Carolina. Neither carries a
 * revision date, so neither can be shown to supersede the other. Exported as a
 * pair so the disagreement stays traceable rather than living only in prose.
 */
export const VIRGINIA_ESCORT_RECIPROCITY_SOURCES = [ESCORT_TRAINING, FAQ_DRV];

/** Cited for the $25 original/renewal escort certification fee and its 5-year term. */
export const VIRGINIA_ESCORT_CERTIFICATION_FEE_SOURCE = ESCORT_CERT;

/** Cited for the codified $15 duplicate/reissue escort certificate fee. */
export const VIRGINIA_ESCORT_CERTIFICATE_DUPLICATE_FEE_SOURCE = VAC_82_140;

/** Cited for the 13-day single-trip permit validity and the no-refund rule. */
export const VIRGINIA_PERMIT_VALIDITY_SOURCE = VAC_82_50;

/**
 * Cited for the non-single-trip machinery a single-trip quote must NOT price:
 * §46.2-1126's axle-spacing table (the gross limit off the interstate),
 * §46.2-1128's annual 5% overload extension to 84,000 lb, and §46.2-1139's
 * irreducible-load restriction on interstate overweight permits plus its $10
 * multi-trip transfer fee.
 */
export const VIRGINIA_NON_SINGLE_TRIP_SOURCES = [VA_1126, VA_1128, VA_1139];
