/**
 * NORTH CAROLINA — oversize/overweight single-trip permit rules.
 *
 * Three things make North Carolina worth reading carefully before trusting a
 * number from it.
 *
 * 1. IT HAS A WEIGHT-BASED ESCORT TRIGGER, WHICH ALMOST NO STATE DOES.
 *    Publication E-9 (Rev. 8/24): "Front Escort required for weights in excess
 *    of 149,999 pounds." Every other jurisdiction in this directory keys
 *    escorts on width, height, length and overhang and says in writing that
 *    weight triggers nothing. A generic dimension-only escort model prices a
 *    150,000 lb North Carolina move with no escort at all and is wrong by a
 *    whole pilot car. `grossWeightLbs` has been a `Measure` since Phase 1
 *    precisely so this needed no new grammar.
 *
 * 2. THE STATE'S OWN DOCUMENTS DISAGREE ABOUT ITS LEGAL HEIGHT, AND ONE OF
 *    THEM DISAGREES WITH ITSELF INSIDE A SINGLE SENTENCE. G.S. §20-116 says
 *    "No vehicle, unladen or with load, shall exceed a height of 14 feet." The
 *    2024 EVO Handbook says "Height is greater than thirteen feet six inches
 *    (14')" — the words say 13 ft 6 in and the parenthetical says 14 ft, in the
 *    same clause. All THREE readings are recorded below and the resolver
 *    refuses to choose between 162 in and 168 in.
 *
 *    THE CONSEQUENCE IS DELIBERATE AND IT IS EXPENSIVE: because the legal
 *    height cannot be resolved, EVERY North Carolina quote carries a
 *    manual-review flag, and a load that is over-height and nothing else is
 *    reported as "we cannot tell whether this needs a permit" rather than
 *    being priced. That is the correct answer for a state whose published legal
 *    height is genuinely 13 ft 6 in or 14 ft depending on which official
 *    document you open. Picking the statute — which is probably right — would
 *    silently drop the disagreement, and a load at 13 ft 9 in is legal on one
 *    reading and needs a permit on the other.
 *
 * 3. THE FEE IS PER OVER-LEGAL DIMENSION, NOT PER BAND AND NOT PER MILE.
 *    "$12 per dimension over the legal limit", counted separately over height,
 *    length, width and weight — which is why NCDOT publishes the whole
 *    single-trip range as "$12 - $48": four dimensions at twelve dollars each.
 *    The oversize side is encoded as mutually-exclusive bands over width and
 *    height (see `oversizeFeeBands`), the weight side as a one-row weight band,
 *    and the two add cumulatively, which is exactly what "per dimension" means.
 *
 * WHAT IS NOT BANDED, AND WHY. The $12 charge for over-legal LENGTH cannot be
 * put in a band. North Carolina's combination limit is 60 ft, but G.S. §20-116
 * exempts a truck tractor towing one semitrailer of not more than 53 feet from
 * that limit entirely — so whether a 75 ft combination is over-legal on length
 * turns on the semitrailer's length, and `OversizeBandInput` carries no trailer
 * length. Banding on overall length would have charged every ordinary
 * tractor-semitrailer in the state $12 it does not owe. The charge is instead
 * carried by a rule that sends the load to review and names the missing $12.
 *
 * WHERE FEE FACTS LIVE IN THE ESCORT LIST. Two rules below are not escort
 * rules: the un-bandable length charge and the axle-based superload triggers.
 * `EscortRule` is the only dimension-conditioned predicate in the data model
 * and `EscortOutcome` carries `manualReview` and `advisory` for exactly this —
 * a real rule that resists becoming a number. Each such rule says so in its own
 * description.
 */
import type { SourceDoc, Sourced } from '../provenance.js';
import { ftIn, type EscortRule } from '../escortRules.js';
import type {
  JurisdictionOsowRules,
  OversizeFeeBand,
  OverweightPricing,
  Threshold,
  WeightBand,
} from '../types.js';

const RETRIEVED = '2026-09-02';

// ── Source documents ──────────────────────────────────────────────────────

const GS_20_116: SourceDoc = {
  id: 'nc-gs-20-116',
  title: 'N.C. Gen. Stat. §20-116 — Size of vehicles and loads',
  url: 'https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_20/GS_20-116.html',
  publisher: 'North Carolina General Assembly',
  // The codified statute page carries no revision date of its own.
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'width 102 in; height 14 ft; the 53 ft semitrailer exemption from the 60 ft combination limit',
};

const GS_20_118: SourceDoc = {
  id: 'nc-gs-20-118',
  title: 'N.C. Gen. Stat. §20-118 — Weight of vehicles and load',
  url: 'https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_20/GS_20-118.html',
  publisher: 'North Carolina General Assembly',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'gross 80,000 lb; single axle 20,000 lb; tandem axle 38,000 lb',
};

const GS_20_119: SourceDoc = {
  id: 'nc-gs-20-119',
  title: 'N.C. Gen. Stat. §20-119 — Special permits for oversize/overweight vehicles',
  url: 'https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_20/GS_20-119.html',
  publisher: 'North Carolina General Assembly',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: '"$12.00 for each dimension over lawful dimensions, including height, length, width, and weight up to 132,000 pounds"; $3.00 per 1,000 lb above that; the $100 engineering-study application fee',
};

const GS_143B_1729: SourceDoc = {
  id: 'nc-gs-143b-1729',
  title: 'N.C. Gen. Stat. §143B-1729 — State Highway Patrol escort fees',
  url: 'https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_143B/GS_143B-1729.html',
  publisher: 'North Carolina General Assembly',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: '"shall pay to the State Highway Patrol a fee covering the full cost to administer, plan, and carry out the escort within this State" — full-cost recovery with no published rate',
};

const ST_1: SourceDoc = {
  id: 'ncdot-st-1-2019-11',
  title: 'NCDOT — Single Trip Publication (ST-1), Rev. 11/19 (PDF)',
  url: 'https://connect.ncdot.gov/business/trucking/Documents/Single%20Trip%20Publication%20%28ST-1%29.pdf',
  publisher: 'North Carolina Department of Transportation',
  revisedOn: '2019-11-01',
  retrievedOn: RETRIEVED,
  cite: '"Permit is valid for 10 calendar days. Cost for permit is $12 per dimension over the legal limit."; "Width: 16\' 11" maximum."',
};

const OSOW_HANDBOOK: SourceDoc = {
  id: 'ncdot-osow-permit-handbook-undated',
  title: 'NCDOT — Oversize/Overweight Permit Handbook (PDF, undated)',
  url: 'https://connect.ncdot.gov/business/trucking/Documents/Oversize%20Overweight%20Permit%20Handbook.pdf',
  publisher: 'North Carolina Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: '"Fee $12 - $48 (state fee)"; "Width 16 feet maximum"; 40 ft single vehicle / 60 ft combination; the 150 ft escort row; the steer-axle superload row',
};

const SL_6: SourceDoc = {
  id: 'ncdot-sl-6-2020-01',
  title: 'NCDOT — Superload Publication (SL-6), Rev. 1/20 (PDF)',
  url: 'https://connect.ncdot.gov/business/trucking/Documents/Superload%20Publication%20%28SL-6%29.pdf',
  publisher: 'North Carolina Department of Transportation',
  revisedOn: '2020-01-01',
  retrievedOn: RETRIEVED,
  cite: '"Width: 17\' or greater"; "$3.00 per 1,000 lbs. over 132,000 lbs. gross weight."; "$100 non-refundable application fee"; 10 business days',
};

const E9: SourceDoc = {
  id: 'ncdot-publication-e9-2024-08',
  title: 'NCDOT — Publication E-9, Escort Requirements, Rev. 8/24 (PDF)',
  url: 'https://connect.ncdot.gov/business/trucking/Documents/Publication%20E-9.pdf',
  publisher: 'North Carolina Department of Transportation',
  revisedOn: '2024-08-01',
  retrievedOn: RETRIEVED,
  cite: 'width, height, length, overhang and WEIGHT escort triggers',
};
const EFF_E9 = '2024-08-01';

/**
 * THE SAME PDF, RECORDED TWICE, BECAUSE ONE SENTENCE IN IT SAYS TWO THINGS.
 *
 * "Height is greater than thirteen feet six inches (14')." A `Sourced<T>` row
 * carries one source and one value, so the only way to keep BOTH readings —
 * which is what an unresolvable conflict requires — is to give each reading its
 * own source id and its own pinpoint cite. The URL and the revision date are
 * identical, and deliberately so: the reader is meant to see that the
 * disagreement is inside a single document.
 */
const EVO_HANDBOOK_WRITTEN: SourceDoc = {
  id: 'ncdot-evo-handbook-2024-written-words',
  title: 'NCDOT — 2024 EVO Handbook (PDF), the WRITTEN measurement in the height sentence',
  url: 'https://connect.ncdot.gov/business/trucking/Documents/2024%20EVO%20Handbook.pdf',
  publisher: 'North Carolina Department of Transportation',
  revisedOn: '2024-01-01',
  retrievedOn: RETRIEVED,
  cite: '"Height is greater than thirteen feet six inches (14\')." — reading the WORDS: 13 ft 6 in',
};

const EVO_HANDBOOK_PARENTHETICAL: SourceDoc = {
  id: 'ncdot-evo-handbook-2024-parenthetical',
  title: 'NCDOT — 2024 EVO Handbook (PDF), the PARENTHETICAL in the height sentence',
  url: 'https://connect.ncdot.gov/business/trucking/Documents/2024%20EVO%20Handbook.pdf',
  publisher: 'North Carolina Department of Transportation',
  revisedOn: '2024-01-01',
  retrievedOn: RETRIEVED,
  cite: '"Height is greater than thirteen feet six inches (14\')." — reading the PARENTHETICAL: 14 ft',
};

const EVO_HANDBOOK: SourceDoc = {
  id: 'ncdot-evo-handbook-2024',
  title: 'NCDOT — 2024 EVO Handbook (PDF)',
  url: 'https://connect.ncdot.gov/business/trucking/Documents/2024%20EVO%20Handbook.pdf',
  publisher: 'North Carolina Department of Transportation',
  revisedOn: '2024-01-01',
  retrievedOn: RETRIEVED,
  cite: 'superload triggers; height-pole specification; EVO course payment',
};
const EFF_EVO = '2024-01-01';

const GENERAL_INFO: SourceDoc = {
  id: 'ncdot-general-information-2025-03',
  title: 'NCDOT — General Information and Instructions, Rev. 3/25 (PDF)',
  url: 'https://connect.ncdot.gov/business/trucking/Documents/General%20Information%20and%20Instructions.pdf',
  publisher: 'North Carolina Department of Transportation',
  revisedOn: '2025-03-01',
  retrievedOn: RETRIEVED,
  cite: '"North Carolina requires escort/pilot vehicle drivers to be certified in accordance with 19A NCAC 02D."; 8-hour course, valid 4 years',
};

const RECIPROCITY: SourceDoc = {
  id: 'ncdot-reciprocation-agreement-2019-08',
  title: 'NCDOT — Escort Vehicle Operator Reciprocation Agreement, Rev. 8/19 (PDF)',
  url: 'https://connect.ncdot.gov/business/trucking/Documents/Reciprocation%20Agreement.pdf',
  publisher: 'North Carolina Department of Transportation',
  revisedOn: '2019-08-01',
  retrievedOn: RETRIEVED,
  cite: 'Arizona, Colorado*, Florida, Georgia, Minnesota, Oklahoma, Pennsylvania, Utah, Virginia, Washington; "North Carolina certifications are not recognized in Colorado at this time."',
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
  source: SourceDoc = E9,
  effectiveFrom: string = EFF_E9,
): EscortRule {
  return {
    id,
    jurisdiction: 'NC',
    description,
    when,
    then,
    source,
    effectiveFrom,
    effectiveTo: null,
  };
}

// ── Escort rules (Publication E-9 Rev. 8/24, plus the general handbook) ────

export const NORTH_CAROLINA_ESCORT_RULES: EscortRule[] = [
  /**
   * A bare count, deliberately, and for the same reason Texas uses one: the
   * escort rides in FRONT on a two-lane/two-way highway and at the REAR on a
   * multi-lane highway, and it is one vehicle either way. Modelling it as two
   * position-specific rules would push every quote whose road type is unknown
   * into review for a distinction that does not move the price by a dollar —
   * and NCDOT's own "multi-lane" category is a recorded unknown, since the
   * publication never says whether it means exactly a divided or
   * controlled-access highway with four or more lanes.
   */
  escortRule(
    'nc-width-over-12',
    'Over 12 ft wide — one escort (front on a two-lane/two-way highway, rear on a multi-lane highway)',
    { kind: 'gt', measure: 'widthIn', value: ftIn(12) },
    { escorts: 1 },
  ),
  /**
   * From the undated general handbook and NOT repeated in the newer E-9. It is
   * kept because dropping a stated requirement because a later document is
   * silent about it would be reading an omission as a repeal. Conditioned on
   * the road type, because here the count genuinely differs — one escort on a
   * multi-lane road, two on a two-lane one — so an unknown road type correctly
   * lands in review rather than guessing the cheaper answer.
   */
  escortRule(
    'nc-width-over-14-two-lane',
    'Over 14 ft wide on a two-lane/two-way road — front and rear escorts',
    {
      kind: 'all',
      of: [
        { kind: 'gt', measure: 'widthIn', value: ftIn(14) },
        { kind: 'routeClass', anyOf: ['two-lane'] },
      ],
    },
    { escorts: 2, front: 1, rear: 1 },
    OSOW_HANDBOOK,
    RETRIEVED,
  ),
  escortRule(
    'nc-width-over-16',
    'Over 16 ft wide — three escorts in total, one of which must be the North Carolina State Highway Patrol',
    { kind: 'gt', measure: 'widthIn', value: ftIn(16) },
    {
      escorts: 3,
      manualReview:
        'North Carolina requires THREE escorts for a load over 16 ft wide and requires one of the three to be a State Highway Patrol escort. NCDOT does not publish where any of the three ride, and the Highway Patrol publishes no hourly or per-mile rate — G.S. §143B-1729 only requires the mover to pay "a fee covering the full cost to administer, plan, and carry out the escort within this State". Two civilian pilot cars are counted here; the Highway Patrol vehicle is a police escort whose cost is not in the permit total and cannot be estimated from published sources. Note also that this is at or above the width at which North Carolina stops issuing an ordinary single-trip permit at all.',
    },
  ),
  escortRule(
    'nc-height-over-14-5',
    'Over 14 ft 5 in high — one front escort carrying a height-pole indicator, for the entire route',
    { kind: 'gt', measure: 'heightIn', value: ftIn(14, 5) },
    { escorts: 1, front: 1, heightPole: true },
  ),
  escortRule(
    'nc-length-over-110',
    'Over 110 ft long — one rear escort',
    { kind: 'gt', measure: 'overallLengthIn', value: ftIn(110) },
    { escorts: 1, rear: 1 },
  ),
  escortRule(
    'nc-length-over-150-e9',
    'Over 150 ft overall — front and rear escorts (Publication E-9, exclusive of exactly 150 ft)',
    { kind: 'gt', measure: 'overallLengthIn', value: ftIn(150) },
    { escorts: 2, front: 1, rear: 1 },
  ),
  escortRule(
    'nc-length-150-or-greater-handbook',
    'At 150 ft overall or greater — front and rear escorts (general handbook, inclusive of exactly 150 ft)',
    { kind: 'gte', measure: 'overallLengthIn', value: ftIn(150) },
    { escorts: 2, front: 1, rear: 1 },
    OSOW_HANDBOOK,
    RETRIEVED,
  ),
  /**
   * The two rules above are the same requirement written with different
   * inclusivity, and they disagree about exactly one load: 150 ft 0 in. E-9
   * says "in excess of 150'" and the general handbook says "150 feet or
   * greater". Both are official. The higher requirement is applied — the
   * handbook's — and this rule makes the disagreement audible for the one
   * length where it bites, instead of letting a silent max() decide it.
   */
  escortRule(
    'nc-length-exactly-150-conflict',
    'Exactly 150 ft overall — the two publications disagree about whether front and rear escorts are required',
    {
      kind: 'between',
      measure: 'overallLengthIn',
      min: ftIn(150),
      max: ftIn(150),
    },
    {
      manualReview:
        'This load is exactly 150 ft 0 in long, the one length at which North Carolina\'s two escort publications disagree. Publication E-9 (Rev. 8/24) requires front and rear escorts "for overall length in excess of 150\'", which excludes exactly 150 ft; the undated Oversize/Overweight Permit Handbook requires them "for overall length 150 feet or greater", which includes it. The stricter reading is applied, so two escorts are counted, but the requirement must be confirmed against the issued permit.',
    },
  ),
  escortRule(
    'nc-rear-overhang-15-or-more',
    'Rear overhang of 15 ft or more — one rear escort',
    { kind: 'gte', measure: 'rearOverhangIn', value: ftIn(15) },
    { escorts: 1, rear: 1 },
  ),
  /**
   * THE RULE ALMOST NO OTHER STATE HAS. E-9: "Front Escort required for weights
   * in excess of 149,999 pounds." Texas, Ohio, Pennsylvania, New York, Illinois,
   * Indiana, Georgia, New Jersey, Virginia and California all key escorts on
   * size alone; North Carolina charges a pilot car to weight.
   *
   * Note the shape of the number. "In excess of 149,999" is how a drafter
   * writes "150,000 or more" while leaving 149,999 itself clear, so the
   * threshold is recorded exactly as published rather than normalised to
   * 150,000 — at 149,999 lb no escort is required and at 150,000 lb one is.
   */
  escortRule(
    'nc-weight-over-149999',
    'Over 149,999 lb gross — one front escort, on every highway type',
    { kind: 'gt', measure: 'grossWeightLbs', value: 149999 },
    { escorts: 1, front: 1 },
  ),
  escortRule(
    'nc-combination-of-over-dimensions',
    'A load over legal in more than one dimension may draw additional escorts that are set on the permit',
    { kind: 'gt', measure: 'widthIn', value: 102 },
    {
      advisory:
        'Publication E-9 adds that "Multiple escorts may be required for a combination of over-dimensions" without stating the number or the placement — those are set on the individual permit. The escort count in this quote is the maximum of the published single-dimension triggers; NCDOT may require more. North Carolina also publishes no front-overhang escort threshold at all, so a long front overhang cannot be checked here.',
    },
  ),

  /**
   * NOT AN ESCORT RULE — the $12 charge for over-legal LENGTH, which cannot be
   * put in an oversize band. See the module header: North Carolina exempts a
   * truck tractor towing one semitrailer of not more than 53 ft from the 60 ft
   * combination limit, so over-legal length turns on the SEMITRAILER, and the
   * band evaluator has no trailer-length input. Rather than charge every
   * ordinary combination $12 it does not owe, the charge is named here and the
   * load goes to review.
   */
  escortRule(
    'nc-length-charge-not-banded',
    'North Carolina charges $12 for over-legal length, and the length charge cannot be computed from the dimensions a quote collects',
    { kind: 'gt', measure: 'trailerLengthIn', value: ftIn(53) },
    {
      manualReview:
        'North Carolina charges $12.00 for EACH over-legal dimension, and length is one of them (G.S. §20-119). Whether this combination is over legal length depends on the semitrailer: §20-116 sets a 60 ft combination limit but exempts a truck tractor towing one semitrailer of not more than 53 feet from it entirely, so a 75 ft tractor-semitrailer can be legal while a shorter combination is not. The oversize fee below therefore does NOT include the $12 length charge, and the permit total is understated by up to $12 for an over-length load.',
    },
    GS_20_119,
    RETRIEVED,
  ),

  /**
   * NOT AN ESCORT RULE — the superload triggers that `SuperloadTriggers` cannot
   * hold. North Carolina escalates a permit on a steer axle over 20,000 lb and
   * on a four-or-more-axle grouping at 68,000 lb, and neither is a gross
   * weight, an axle spacing or a dimension. An advisory rather than a review
   * block: it fires on every overweight North Carolina move, and blocking all
   * of them over a trigger we cannot evaluate would make the state unquotable
   * while telling the reader nothing new.
   */
  escortRule(
    'nc-axle-superload-triggers-not-modelled',
    'North Carolina also classifies a permit as a superload on axle criteria that a quote does not collect',
    { kind: 'gt', measure: 'grossWeightLbs', value: 80000 },
    {
      advisory:
        'Beyond the 132,000 lb gross threshold, North Carolina treats a permit as a superload when the gross weight on the steer axle exceeds 20,000 lb, or when a four-or-more-axle grouping reaches 68,000 lb — and the source does not say whether that 68,000 lb figure is inclusive. Neither criterion is a gross weight, an axle spacing or a dimension, so neither can be evaluated here and neither can be ruled out. No standalone superload HEIGHT or LENGTH threshold was located in NCDOT\'s publications either, so a very tall or very long North Carolina load may be escalated on a criterion this dataset does not hold.',
    },
    EVO_HANDBOOK,
    EFF_EVO,
  ),

  escortRule(
    'nc-evo-certification-required',
    'North Carolina requires its escort drivers to hold a state EVO certification, whose cost is the operator’s and is not a state fee',
    { kind: 'gt', measure: 'widthIn', value: ftIn(12) },
    {
      advisory:
        'North Carolina requires escort/pilot vehicle drivers to be certified under 19A NCAC 02D. Initial certification is an 8-hour course (a valid Class A CDL holder may sit the examination without attending) and is valid for 4 years. NCDOT publishes NO fixed statewide course or certification fee — payment is set by the North Carolina Community College System or a third-party provider — so no certification cost is included here; it is the pilot-car operator\'s cost and it reaches a quote through the operator\'s rate, never through the permit fee. North Carolina accepts certifications from Arizona, Colorado, Florida, Georgia, Minnesota, Oklahoma, Pennsylvania, Utah, Virginia and Washington; note that the recognition is one-way with Colorado, whose programme did not recognise North Carolina certification when the 8/19 agreement was published.',
    },
    GENERAL_INFO,
    '2025-03-01',
  ),
];

// ── Fee schedule ──────────────────────────────────────────────────────────

/** The two surviving readings of North Carolina's legal height, in inches. */
const HEIGHT_EVO_WRITTEN = ftIn(13, 6);
const HEIGHT_STATUTE = ftIn(14);
const WIDTH_LEGAL = 102;

/**
 * $12 PER OVER-LEGAL DIMENSION, EXPRESSED AS MUTUALLY-EXCLUSIVE BANDS OVER
 * WIDTH AND HEIGHT — and expressed TWICE, once per surviving reading of the
 * legal height, with the two schedules IDENTICAL everywhere except the six
 * inches they actually disagree about.
 *
 * The shape of these bands is the whole trick, and the first attempt got it
 * wrong in an instructive way. Writing each schedule against its own legal
 * height — "over width, height at or under 14 ft" against "over width, height
 * at or under 13 ft 6 in" — made every North Carolina load conflicted, because
 * `oversizeFeeBandsEqual` compares the band EDGES as well as the fee. Two
 * schedules that agreed the fee was $12 still looked like two sources
 * disagreeing, and a 12 ft wide load at 13 ft high — a load nothing in North
 * Carolina is unclear about — came back unpriced.
 *
 * So the height axis is partitioned into the three regions the disagreement
 * actually creates, and only the middle one is allowed to differ:
 *
 *   at or under 13 ft 6 in   both readings agree the load is not over height
 *   13 ft 6 in to 14 ft      THE DISPUTED BAND — the statute says not over
 *                            height, the EVO Handbook's written words say over
 *   over 14 ft               both readings agree the load is over height
 *
 * Bands A, B and C are byte-identical between the two sources and resolve as
 * the corroboration they are. Band D is the disputed six inches, and there the
 * statute's schedule says $12 (over on width alone) and the handbook's says $24
 * (over on width and height). A load in that band resolves to no value, shows
 * as $12–$24, and goes to review. A load anywhere else is priced cleanly.
 *
 * Each schedule is internally exclusive, which is what the engine's band
 * invariant requires: within one source, at most one band can ever match.
 */
function dimensionBands(
  source: SourceDoc,
  effectiveFrom: string,
  disputedBandFeeUsd: number,
  disputedBandLabel: string,
): Sourced<OversizeFeeBand>[] {
  const note =
    '$12.00 for each dimension over lawful dimensions (G.S. §20-119); the legal width of 102 in is not in dispute. The $12 charge for over-legal LENGTH is not banded here — see the `nc-length-charge-not-banded` rule for why — and the $12 charge for over-legal WEIGHT is in `overweightBands`, which adds cumulatively.';
  return [
    // A — over width, and below every reading of the legal height.
    fromDated<OversizeFeeBand>(
      {
        label: 'over legal width, 13 ft 6 in high or under — one over-legal dimension at $12',
        overWidthIn: { value: WIDTH_LEGAL, inclusive: false },
        upToHeightIn: { value: HEIGHT_EVO_WRITTEN, inclusive: false },
        feeUsd: 12,
      },
      source,
      effectiveFrom,
      note,
    ),
    // B — over width and above every reading of the legal height.
    fromDated<OversizeFeeBand>(
      {
        label: 'over legal width and over 14 ft high — two over-legal dimensions at $12 each',
        overWidthIn: { value: WIDTH_LEGAL, inclusive: false },
        overHeightIn: { value: HEIGHT_STATUTE, inclusive: false },
        feeUsd: 24,
      },
      source,
      effectiveFrom,
      note,
    ),
    // C — legal width, above every reading of the legal height.
    fromDated<OversizeFeeBand>(
      {
        label: 'over 14 ft high at legal width — one over-legal dimension at $12',
        upToWidthIn: { value: WIDTH_LEGAL, inclusive: false },
        overHeightIn: { value: HEIGHT_STATUTE, inclusive: false },
        feeUsd: 12,
      },
      source,
      effectiveFrom,
      note,
    ),
    // D — the disputed six inches. The ONLY band the two sources may differ on.
    fromDated<OversizeFeeBand>(
      {
        label: disputedBandLabel,
        overWidthIn: { value: WIDTH_LEGAL, inclusive: false },
        overHeightIn: { value: HEIGHT_EVO_WRITTEN, inclusive: false },
        upToHeightIn: { value: HEIGHT_STATUTE, inclusive: false },
        feeUsd: disputedBandFeeUsd,
      },
      source,
      effectiveFrom,
      `${note} This is the band North Carolina's own documents disagree about: G.S. §20-116 puts the legal height at 14 ft, so a load here is over on WIDTH ONLY and owes $12; the 2024 EVO Handbook's written words put it at 13 ft 6 in, so the same load is over on width AND height and owes $24.`,
    ),
  ];
}

const oversizeFeeBands: Sourced<OversizeFeeBand>[] = [
  ...dimensionBands(
    GS_20_119,
    RETRIEVED,
    12,
    'over legal width, between 13 ft 6 in and 14 ft high — one over-legal dimension at $12, reading the legal height as the statute’s 14 ft',
  ),
  ...dimensionBands(
    EVO_HANDBOOK_WRITTEN,
    EFF_EVO,
    24,
    'over legal width, between 13 ft 6 in and 14 ft high — two over-legal dimensions at $24, reading the legal height as the EVO Handbook’s written 13 ft 6 in',
  ),
];

/**
 * ONE BAND, AND THE REST OF THE SCHEDULE IS UNREACHABLE BY DESIGN.
 *
 * G.S. §20-119 charges $12 for weight over the lawful limit "up to 132,000
 * pounds", and $3.00 per 1,000 lb above that. The $3 tier is not enumerated
 * here for two reasons, and both are the same reason: no load can reach it and
 * still be priced. Anything over 132,000 lb is a superload in North Carolina
 * (see `superload.grossWeight`), and a superload has no over-the-counter fee —
 * it carries a $100 non-refundable application fee, ten business days of
 * internal and bridge engineering review, and a permit priced by the agency.
 * Enumerating the $3 tier would also have required inventing a rounding rule
 * for a partial 1,000 lb increment, which NCDOT does not publish and which this
 * engine must not choose on its behalf.
 *
 * A load at exactly 132,000 lb is NOT a superload and IS covered by this band.
 */
const overweightBands: Sourced<WeightBand>[] = [
  fromUndatedPage<WeightBand>(
    { minLbs: 80001, maxLbs: 132000, feeUsd: 12 },
    GS_20_119,
    'Weight is one of the four dimensions the $12 charge is counted over: "a fee of twelve dollars ($12.00) for each dimension over lawful dimensions, including height, length, width, and weight up to 132,000 pounds."',
  ),
  fromDated<WeightBand>(
    { minLbs: 80001, maxLbs: 132000, feeUsd: 12 },
    ST_1,
    '2019-11-01',
    '"Cost for permit is $12 per dimension over the legal limit." The handbook prints the whole single-trip range as "$12 - $48 (state fee)", which is these four dimensions at twelve dollars each.',
  ),
];

// ── The jurisdiction ──────────────────────────────────────────────────────

export const NORTH_CAROLINA_OSOW_RULES: JurisdictionOsowRules = {
  code: 'NC',
  name: 'North Carolina',
  country: 'US',

  legalLimits: {
    widthIn: [
      fromUndatedPage(
        102,
        GS_20_116,
        '"The total outside width of any vehicle or the load thereon shall not exceed 102 inches, except as otherwise provided in this section." Commodity and vehicle-specific statutory exceptions exist and are not modelled.',
      ),
    ],
    /**
     * ALL THREE READINGS, AND NO WINNER. See the module header — this is the
     * conflict that puts every North Carolina quote into review, and it is
     * recorded that way on purpose. 162 in and 168 in are both on file; the
     * resolver returns null and the engine reports that it cannot say whether
     * this load is over height.
     */
    heightIn: [
      fromUndatedPage(
        ftIn(14),
        GS_20_116,
        '"No vehicle, unladen or with load, shall exceed a height of 14 feet." The statute is unambiguous; the EVO Handbook is not.',
      ),
      fromDated(
        ftIn(13, 6),
        EVO_HANDBOOK_WRITTEN,
        EFF_EVO,
        'Reading the WORDS of "Height is greater than thirteen feet six inches (14\')" — 13 ft 6 in.',
      ),
      fromDated(
        ftIn(14),
        EVO_HANDBOOK_PARENTHETICAL,
        EFF_EVO,
        'Reading the PARENTHETICAL of the same sentence — 14 ft, agreeing with the statute. The sentence contradicts itself; both halves are recorded so that the contradiction is visible rather than resolved by whichever half was transcribed.',
      ),
    ],
    /**
     * 53 ft, and it is the exemption threshold rather than a trailer cap:
     * §20-116 sets a 60 ft combination limit and then says a truck tractor with
     * "one semitrailer of not more than 53 feet in length ... may exceed the
     * 60-foot maximum length". Above 53 ft of semitrailer the exemption lapses
     * and the combination is over legal length, which is the only length test a
     * quote can actually apply.
     *
     * `overallLengthIn` is ABSENT for the matching reason: while the exemption
     * holds there is no overall cap at all, so recording the 60 ft figure would
     * put every ordinary tractor-semitrailer in the state over the limit.
     * Overhang limits are absent because North Carolina publishes none — what
     * it publishes is the 15 ft rear-overhang escort trigger, which is in the
     * escort rules, and no front-overhang trigger at all.
     */
    trailerLengthIn: [
      fromUndatedPage(
        ftIn(53),
        GS_20_116,
        '"Motor vehicle combinations of one semitrailer of not more than 53 feet in length and a truck tractor (power unit) may exceed the 60-foot maximum length." The general limits are 40 ft for a single vehicle and 60 ft for a combination.',
      ),
    ],
    grossWeightLbs: [
      fromUndatedPage(
        80000,
        GS_20_118,
        '"...or the maximum gross weight limit of 80,000 pounds." The lawful gross can be LOWER under the statutory axle-group table or a posted road or bridge restriction, neither of which a quote can see.',
      ),
    ],
    singleAxleLbs: [
      fromUndatedPage(20000, GS_20_118, '"The single-axle weight of a vehicle or combination of vehicles shall not exceed 20,000 pounds."'),
    ],
    /**
     * 38,000 lb, which is 4,000 lb above the federal tandem figure every other
     * jurisdiction in this directory uses. It is not a typo and it is not the
     * bridge formula — G.S. §20-118(b)(2) states it outright, and reading a
     * 34,000 lb assumption across from a neighbouring state would report a
     * legal North Carolina tandem as over weight.
     */
    tandemAxleLbs: [
      fromUndatedPage(38000, GS_20_118, '"The tandem-axle weight of a vehicle or combination of vehicles shall not exceed 38,000 pounds."'),
    ],
  },

  /**
   * A SOURCED ZERO. North Carolina charges no issuance fee on top of the
   * per-dimension charge — the whole oversize fee is "$12 per dimension over
   * the legal limit", which is in the bands, and the weight dimension's $12 is
   * in `overweightBands`. The row is recorded rather than omitted so that the
   * absence is a finding, and the engine suppresses the empty line rather than
   * printing "$0.00" beside a real fee.
   */
  permitBaseFeeUsd: [
    fromUndatedPage(
      0,
      GS_20_119,
      'The statute states one charge and no base: "a fee of twelve dollars ($12.00) for each dimension over lawful dimensions". NCDOT\'s handbook prints the resulting range as "$12 - $48 (state fee)", which is four dimensions at twelve dollars and no issuance charge on top.',
    ),
  ],

  oversizeFeeBands,

  /**
   * CUMULATIVE, and stated explicitly rather than left to the engine's default,
   * because "per dimension" is precisely a claim about how the components
   * combine. A load that is over on width and over on weight owes $12 for each,
   * not the greater of the two and not one of them.
   */
  combinedFeeRule: [
    fromUndatedPage(
      {
        kind: 'cumulative' as const,
        explanation:
          'G.S. §20-119 charges "twelve dollars ($12.00) for each dimension over lawful dimensions, including height, length, width, and weight", so the oversize and overweight components are counted separately and added. The published $12–$48 range is the same statement arithmetically.',
      },
      GS_20_119,
    ),
  ],

  overweightPricing: [
    fromUndatedPage<OverweightPricing>(
      {
        kind: 'bands',
        explanation:
          'North Carolina charges a flat $12.00 for the weight dimension when the load is over the lawful weight, up to 132,000 lb, plus $3.00 per 1,000 lb above 132,000 lb. It is not per-mile, not per-axle and not stepped by gross weight below 132,000 lb. Everything above 132,000 lb is a superload with no over-the-counter fee, so the $3 tier is documented but not enumerated — and NCDOT publishes no rule for a partial 1,000 lb increment.',
      },
      GS_20_119,
    ),
    fromDated<OverweightPricing>(
      {
        kind: 'bands',
        explanation:
          'The Superload Publication states the tier above the threshold as "$3.00 per 1,000 lbs. over 132,000 lbs. gross weight.", added to the dimensional fee.',
      },
      SL_6,
      '2020-01-01',
    ),
  ],

  overweightBands,
  overweightPerMile: [],
  conditionalFees: [],

  /**
   * EMPTY, and the engine will say so on every North Carolina quote. NCDOT's
   * permit page names its payment processor and publishes no percentage
   * surcharge, no card fee and no online-processing fee — and "we looked and
   * found nothing" is a different claim from "there is none", so a sourced zero
   * would have been an assertion the sources do not support. The warning that
   * results is the honest outcome: the transaction cost of a North Carolina
   * permit is not on file.
   */
  transactionFee: [],

  /**
   * $100, non-refundable, due with the application whenever an engineering
   * study or another special consideration is required — which is every
   * superload. The amount does not depend on whether the route crosses a
   * bridge, so the same figure is recorded for the no-bridge case rather than
   * leaving the engine to print a misleading $0.00.
   */
  routeAnalysisFeeUsd: [
    fromUndatedPage(
      100,
      GS_20_119,
      '"applications for permits that require an engineering study for pavement or structures or other special conditions or considerations shall be accompanied by a nonrefundable application fee of one hundred dollars ($100.00)." This is additional to the permit fees, and it does not buy the engineering — NCDOT\'s internal and bridge engineering review takes at least ten business days and is not separately priced.',
    ),
    fromDated(100, SL_6, '2020-01-01', '"$100 non-refundable application fee due upon submission of application."'),
  ],
  noBridgeRouteFeeUsd: [
    fromUndatedPage(
      100,
      GS_20_119,
      'North Carolina\'s $100 application fee is flat: it does not vary with whether the approved route crosses a structure, so the same amount applies.',
    ),
  ],

  superload: {
    /**
     * 132,000 lb, corroborated across two publications — which is what puts
     * North Carolina into the widget's weight-ceiling mirror at 132,000, the
     * heaviest gross weight the engine will quote for a North Carolina lane.
     *
     * The 2024 EVO Handbook qualifies the trigger as "on seven or more axles"
     * and SL-6 does not repeat the qualification. Both state the same number
     * with the same inclusivity, so they corroborate; the axle qualification
     * can only NARROW what counts as a superload, and refusing to price a
     * 140,000 lb load on six axles is the conservative direction to be wrong in.
     */
    grossWeight: [
      fromDated<Threshold>(
        { value: 132000, inclusive: false },
        EVO_HANDBOOK,
        EFF_EVO,
        '"Weight in excess of 132,000 pounds gross weight on seven or more axles".',
      ),
      fromDated<Threshold>(
        { value: 132000, inclusive: false },
        SL_6,
        '2020-01-01',
        'SL-6 states "greater than 132,000lbs." without repeating the seven-axle qualification.',
      ),
    ],
    shortSpacing: [],
    /**
     * FOUR ROWS AND TWO ANSWERS, which is exactly the conflict the sources
     * carry. The 2024 EVO Handbook escalates above 16 ft and the undated
     * handbook stops issuing an ordinary single-trip permit at 16 ft, so both
     * put the line at 16 ft. SL-6 (1/20) says a superload is "17' or greater",
     * and ST-1 (11/19) allows an ordinary single trip up to "16' 11" maximum",
     * which is the same line from the other side. The two document generations
     * disagree by eleven inches, and the engine surfaces that only for a load
     * that actually lands between them.
     *
     * INFERENCE FLAG: treating ST-1's "16' 11" maximum" for a single-trip
     * permit as a superload trigger at the same width is OUR mapping. NCDOT
     * states it as a ceiling on the ordinary permit, not as a superload
     * definition; the two are operationally the same line, but the source does
     * not say so.
     */
    widthIn: [
      fromDated<Threshold>({ value: ftIn(16), inclusive: false }, EVO_HANDBOOK, EFF_EVO, '"Width in excess of 16 feet."'),
      fromUndatedPage<Threshold>({ value: ftIn(16), inclusive: false }, OSOW_HANDBOOK, '"Width 16 feet maximum" for a single-trip permit.'),
      fromDated<Threshold>({ value: ftIn(17), inclusive: true }, SL_6, '2020-01-01', '"Width: 17\' or greater".'),
      fromDated<Threshold>(
        { value: ftIn(16, 11), inclusive: false },
        ST_1,
        '2019-11-01',
        '"Width: 16\' 11" maximum." for a single trip — read here as the width above which the ordinary permit is no longer issued.',
      ),
    ],
    // No `heightIn` and no `overallLengthIn`: NCDOT publishes no standalone
    // superload height or length threshold and none was located. That gap is
    // carried by the `nc-axle-superload-triggers-not-modelled` advisory rather
    // than by an invented number.
  },

  /**
   * ALL EMPTY, AND SILENT BY DESIGN. The only route-survey requirement North
   * Carolina publishes is commodity-specific — a 16 ft wide mobile or modular
   * home travelling on restricted primary routes, or on any secondary route
   * west of Cleveland, Lincoln, Catawba, Iredell, Davie, Forsyth and Rockingham
   * counties, needs a PF-16A survey from both the transporter and the certified
   * escort driver. That is a commodity and a geography, not a dimension, so it
   * cannot be a threshold here, and NCDOT publishes no general-commodity or
   * universal-superload survey trigger and no survey cost. Inventing a width or
   * height trigger would send loads to an inspection the state never asked for.
   */
  routeInspection: {
    widthIn: [],
    heightIn: [],
    lengthIn: [],
  },

  escortRules: NORTH_CAROLINA_ESCORT_RULES,

  /** $12 per over-legal dimension. Nothing in it depends on distance. */
  feesDependOnDistance: false,
};

/** Cited for the Highway Patrol's full-cost-recovery escort fee with no published rate. */
export const NORTH_CAROLINA_POLICE_ESCORT_STATUTE = GS_143B_1729;

/** Cited for the escort-vehicle-operator certification reciprocity list. */
export const NORTH_CAROLINA_ESCORT_RECIPROCITY_SOURCE = RECIPROCITY;
