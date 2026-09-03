/**
 * GEORGIA — oversize/overweight single-trip permit rules.
 *
 * The simplest fee architecture in this directory and one of the fussiest rule
 * sets. Georgia charges ONE flat amount per permit type, and the permit type is
 * chosen by the highest criterion the load meets:
 *
 *     Standard Single   $30    width and height 16 ft or under, up to 150,000 lb
 *     Superload Single  $125   over 16 ft wide or high, or 150,001–180,000 lb
 *     Superload Plus    $500   over 180,000 lb, bridge analysis required
 *     Mega Load         $500   300,000 lb and above, outside engineering required
 *
 * There is no per-mile component, no per-axle component, no per-foot component
 * and no percentage surcharge — the only additions Georgia publishes are a flat
 * $7.00 credit-card processing charge and a $1.00 fax charge whose current
 * applicability is itself an open question.
 *
 * ONE PERMIT TYPE, NOT TWO ADDED TOGETHER. Because the same schedule covers
 * oversize and overweight, a load that is both does not pay twice: a 17 ft wide
 * load at 160,000 lb is one Superload Single at $125, not $125 + $125. That is
 * recorded as `combinedFeeRule: greaterOf`, and it is an INFERENCE — GDOT
 * publishes a list of permit types and never says in words "charge whichever is
 * greater". Taking the greater is the only reading that reproduces every
 * published row: it gives $30 for a 12 ft wide 100,000 lb load, $125 for a
 * 17 ft wide 70,000 lb load, and $125 for a 12 ft wide 160,000 lb load, which
 * is what the type list says each of those costs.
 *
 * WHAT "SUPERLOAD" MEANS HERE IS NOT WHAT IT MEANS TO THE ENGINE. Georgia calls
 * a 17 ft wide load a superload, but it prices it at a published $125 and issues
 * it in about three days. `SuperloadTriggers` models something narrower — a load
 * with NO published fee that the agency prices after engineering review — so
 * Georgia's dimensional "superloads" are PRICED here rather than refused, and
 * the engine's superload line is drawn where Georgia's own price stops being
 * complete: over 180,000 lb, where a Superload Plus requires a bridge analysis
 * whose cost GDOT does not publish, and at 300,000 lb, where a Mega Load
 * requires outside engineering by a pre-qualified consultant firm at a cost
 * that is likewise unpublished. Refusing to quote a 17 ft load that Georgia
 * prices at $125 would have been as wrong as quoting $500 for one that needs a
 * consultant.
 *
 * THE 150,001 POUND CONFLICT IS WORTH ONE HUNDRED AND FIVE DOLLARS, ON EXACTLY
 * ONE LOAD. GDOT's permit page says the $125 band is "Weight Limit 150,001 to
 * 180,000 lbs.", so $30 stops at 150,000. Rule 672-2-.01 says a superload is "a
 * gross vehicle weight exceeding 150,001 pounds up to a gross vehicle weight of
 * 180,000 pounds", which literally leaves 150,001 in the $30 band. The two
 * readings agree everywhere except at 150,001 lb, and the weight bands below are
 * written so that the disagreement is visible for that one weight and invisible
 * everywhere else — identical rows on both sides of it, and a one-pound band in
 * the middle where the two sources give $125 and $30.
 *
 * PILOT CARS HAVE TO BE CERTIFIED, AND THE TWO STATE LISTS ARE NOT THE SAME
 * LIST. Georgia issues its own pilot/escort certification, valid four years, and
 * it ACCEPTS certifications from Arizona, Colorado, Utah, Virginia and
 * Washington while its own certification is RECIPROCATED by North Carolina,
 * Florida, Oklahoma and Washington. Only Washington appears on both. Reading one
 * list as the other would put an operator on a load they cannot legally escort.
 *
 * SOURCE-QUALITY CAVEAT: almost every gamccd.net page is undated, including the
 * one that carries the entire fee schedule. The rules on rules.sos.ga.gov ARE
 * dated and are old — the escort rules were last amended 2011-11-08 and the
 * superload definitions 2012-10-16 — and those real dates are what the rows
 * below carry.
 */
import type { SourceDoc, Sourced } from '../provenance.js';
import { ftIn, type EscortRule } from '../escortRules.js';
import type {
  CombinedFeeRule,
  JurisdictionOsowRules,
  OversizeFeeBand,
  OverweightPricing,
  Threshold,
  TransactionFee,
  WeightBand,
} from '../types.js';

const RETRIEVED = '2026-09-02';

// ── Source documents ──────────────────────────────────────────────────────

const LAWS: SourceDoc = {
  id: 'ga-mccd-laws',
  title: 'Georgia DPS/MCCD — Oversize Permit Laws (undated)',
  url: 'https://gamccd.net/ospermit/Laws.aspx',
  publisher: 'Georgia Department of Public Safety, Motor Carrier Compliance Division',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'width 8\'6"; height 13\'6"; length 100 ft including overhang; 53 ft standard trailer; 80,000 lb gross; "Legal axle weight is 20,340 pounds."; federal bridge formula',
};

const PERMIT_TYPES: SourceDoc = {
  id: 'ga-mccd-permit-types',
  title: 'Georgia DPS/MCCD — Permit Types and Escort Requirements (undated)',
  url: 'https://gamccd.net/ospermit/PermitTypes.aspx',
  publisher: 'Georgia Department of Public Safety, Motor Carrier Compliance Division',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'Standard Single $30; Superload Single $125; Superload Plus $500; Mega Load $500; the length escort rows; house-move police escorts',
};

const GUIDELINES: SourceDoc = {
  id: 'ga-mccd-guidelines',
  title: 'Georgia DPS/MCCD — Permit Guidelines (undated, retains legacy fax-process language)',
  url: 'https://gamccd.net/ospermit/Guidelines.aspx',
  publisher: 'Georgia Department of Public Safety, Motor Carrier Compliance Division',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: '"$1.00 will be added to include the cost of faxing the permit to you."; "Any loads with dimensions greater than 12 feet wide, 13\'6" high, 100 feet in length or 100,000 lbs., needs routes."',
};

const TITLE_32: SourceDoc = {
  id: 'ga-osp-title-32-2011',
  title: 'Georgia DPS/MCCD — Selected statutes, O.C.G.A. Title 32 extract (PDF)',
  url: 'https://gamccd.net/Documents/OSP_Title32.pdf',
  publisher: 'Georgia Department of Public Safety, Motor Carrier Compliance Division',
  revisedOn: '2011-07-01',
  retrievedOn: RETRIEVED,
  cite: 'tandem 40,680 lb on non-national highways; 34,000 lb on national highways; the under-73,280 lb / not-over-55 ft exception',
};
const EFF_TITLE_32 = '2011-07-01';

const RULE_672_2: SourceDoc = {
  id: 'ga-rule-672-2-escorts-2011-11',
  title: 'Ga. Comp. R. & Regs. Chapter 672-2 — escort requirements (last amended 2011-11-08)',
  url: 'https://rules.sos.ga.gov/gac/672-2',
  publisher: 'Georgia Secretary of State, Rules and Regulations',
  revisedOn: '2011-11-08',
  retrievedOn: RETRIEVED,
  cite: 'Rules 672-2-.04 and 672-2-.06: length, height and width escort triggers; the case-by-case rule above 16 ft; the house-move route precheck',
};
const EFF_RULE_672_2 = '2011-11-08';

const RULE_672_DEPT: SourceDoc = {
  id: 'ga-rule-672-2-01-superloads-2012-10',
  title: 'Ga. Comp. R. & Regs. Rule 672-2-.01 — superload definitions (last amended 2012-10-16)',
  url: 'https://rules.sos.ga.gov/download_pdf.aspx?dept=Departments&pdf=Department+672+STATE+DEPARTMENT+OF+TRANSPORTATION&st=GASOS&year=2026',
  publisher: 'Georgia Secretary of State, Rules and Regulations',
  revisedOn: '2012-10-16',
  retrievedOn: RETRIEVED,
  cite: '"a gross vehicle weight exceeding 150,001 pounds up to a gross vehicle weight of 180,000 pounds"; "Superload Plus: A non-divisible load exceeding a gross vehicle weight of 180,000 pounds"; the axle-data requirement above 150,000 lb',
};
const EFF_RULE_672_DEPT = '2012-10-16';

const SINGLE_TRIP_2026: SourceDoc = {
  id: 'ga-single-trip-permit-application-2026-02',
  title: 'Georgia DPS/MCCD — 2026 Single Trip Permit application (PDF)',
  url: 'https://gamccd.net/Documents/2026%20SINGLE%20TRIP%20PERMIT.PDF',
  publisher: 'Georgia Department of Public Safety, Motor Carrier Compliance Division',
  revisedOn: '2026-02-01',
  retrievedOn: RETRIEVED,
  cite: '"THE CHARGE FOR THIS SERVICE IS $7.00" for the credit-card option',
};
const EFF_SINGLE_TRIP_2026 = '2026-02-01';

const PILOT_WORKBOOK: SourceDoc = {
  id: 'ga-pilot-escort-student-workbook',
  title: 'Georgia — Pilot/Escort Student Workbook (PDF, undated)',
  url: 'https://gamccd.net/Documents/Pilot%20Escort%20Student%20Workbook.pdf',
  publisher: 'Georgia Department of Public Safety, Motor Carrier Compliance Division',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'height-pole specification; four-year certificate validity; "Weight is greater than 80,000 lbs. (20,000 lbs. single axle, 34,000 lbs. tandem axle)"; the two-escort reading above 16 ft; the "in excess of 15\'6"" and "15\' or greater in larger cities" height-sensor readings',
};

const MEGALOAD: SourceDoc = {
  id: 'ga-osp-megaload-2016-09',
  title: 'Georgia DPS/MCCD — Mega Load requirements (PDF, September 2016)',
  url: 'https://gamccd.net/Documents/OSP_MegaLoad.pdf',
  publisher: 'Georgia Department of Public Safety, Motor Carrier Compliance Division',
  revisedOn: '2016-09-01',
  retrievedOn: RETRIEVED,
  cite: '"GDOT defines \'Mega Load\' as all loads with a gross weight exceeding 300,000 lbs."; minimum two police escorts; the field-survey contents',
};
const EFF_MEGALOAD = '2016-09-01';

const CERT_ESCORT: SourceDoc = {
  id: 'ga-certified-escort-vehicle',
  title: 'Georgia DPS/MCCD — Certified Escort Vehicle programme (undated)',
  url: 'https://gamccd.net/ospermit/CertifiedEscortVehicle.aspx',
  publisher: 'Georgia Department of Public Safety, Motor Carrier Compliance Division',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: '"The programs accepted include the following states: Arizona, Colorado, Utah, Virginia and Washington."; "The Georgia program reciprocates with the following recognized states: North Carolina, Florida, Oklahoma and Washington."',
};

const CVE_TRAINING: SourceDoc = {
  id: 'ga-dps-cve-training-programs',
  title: 'Georgia DPS — CVE Training Programs (undated)',
  url: 'https://dps.georgia.gov/services/cve-training-programs',
  publisher: 'Georgia Department of Public Safety',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: '"Georgia residents must complete this course and pass the final quiz with a score of 80% or higher to receive certification."',
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
  source: SourceDoc = RULE_672_2,
  effectiveFrom: string = EFF_RULE_672_2,
): EscortRule {
  return {
    id,
    jurisdiction: 'GA',
    description,
    when,
    then,
    source,
    effectiveFrom,
    effectiveTo: null,
  };
}

const WIDTH_16 = ftIn(16);
const WIDTH_14_8 = ftIn(14, 8);
const WIDTH_12 = ftIn(12);

// ── Escort rules ──────────────────────────────────────────────────────────

/**
 * ROUTE-CLASS MAPPING, FLAGGED AS AN INFERENCE. Georgia's rule distinguishes a
 * "two (2) lane road", a "four (4) or more lane road" and a "Limited Access
 * Highway", and never defines any of the three. They are mapped here onto
 * `two-lane`, `divided` and `interstate` respectively. That mapping is OURS: a
 * four-lane undivided highway is not a divided highway, and a limited-access
 * highway is not necessarily an interstate. Where the requirement differs by
 * class the rules below are conditioned on it, so a quote with no road type
 * lands in review rather than guessing the cheaper class — which is the right
 * outcome, because on a two-lane road Georgia wants two escorts where a
 * four-lane road wants one.
 */
export const GEORGIA_ESCORT_RULES: EscortRule[] = [
  // ── Length: the same on every road class ───────────────────────────────
  /**
   * "a rear escort/amber light is required". The slash is doing a lot of work
   * and Georgia never says what it means: one reading is a pilot car at the
   * rear, the other is an amber light on the load itself and no vehicle at all.
   * The difference is a whole escort for every load between 75 and 100 ft, so
   * the quote counts the escort — the costlier reading, because under-billing a
   * pilot car is the worse error — and forces review with both readings stated.
   */
  escortRule(
    'ga-length-over-75-to-100',
    'Over 75 ft up to 100 ft long — a rear escort or an amber light, and Georgia does not say which',
    {
      kind: 'between',
      measure: 'overallLengthIn',
      min: ftIn(75),
      max: ftIn(100),
      minInclusive: false,
    },
    {
      escorts: 1,
      rear: 1,
      manualReview:
        'Georgia requires "a rear escort/amber light" for a permitted load over 75 ft and up to 100 ft long, and publishes no definition of the slash. On one reading that is a rear pilot car; on the other it is an amber light mounted on the load and no escort vehicle at all. One rear escort is counted here because under-counting a pilot car is the more expensive mistake to make, but the requirement must be read off the issued permit before it is billed.',
    },
    PERMIT_TYPES,
    RETRIEVED,
  ),
  escortRule(
    'ga-length-over-100-to-125',
    'Over 100 ft up to 125 ft long — one rear escort, on every road class',
    {
      kind: 'between',
      measure: 'overallLengthIn',
      min: ftIn(100),
      max: ftIn(125),
      minInclusive: false,
    },
    { escorts: 1, rear: 1 },
    PERMIT_TYPES,
    RETRIEVED,
  ),
  escortRule(
    'ga-length-over-125',
    'Over 125 ft long — front and rear escorts, on every road class',
    { kind: 'gt', measure: 'overallLengthIn', value: ftIn(125) },
    { escorts: 2, front: 1, rear: 1 },
    PERMIT_TYPES,
    RETRIEVED,
  ),

  // ── Height ─────────────────────────────────────────────────────────────
  /**
   * The NJUNS exception is real and it removes the escort entirely: a hauler
   * holding a valid trip-approval ticket from the National Joint Utilities
   * Notification Service does not need the front escort at all. Whether this
   * hauler has one is not a dimension, so it is a `subjective` condition —
   * unanswered it is `unknown`, which correctly sends the load to review rather
   * than assuming either that the ticket exists or that it does not.
   */
  escortRule(
    'ga-height-15-6-or-greater',
    'At 15 ft 6 in high or greater — one front escort with a height sensor, unless the hauler holds a valid NJUNS trip-approval ticket',
    {
      kind: 'all',
      of: [
        { kind: 'gte', measure: 'heightIn', value: ftIn(15, 6) },
        {
          kind: 'not',
          of: {
            kind: 'subjective',
            key: 'ga-njuns-trip-approval',
            question: 'does the hauler hold a valid NJUNS trip-approval ticket for this move?',
          },
        },
      ],
    },
    { escorts: 1, front: 1, heightPole: true },
  ),
  /**
   * The rule says "fifteen feet six inches (15' 6") or greater" and the
   * Pilot/Escort Handbook says "in excess of" the same figure. They disagree
   * about one height — exactly 15 ft 6 in — and nowhere else, so that is where
   * the disagreement is raised.
   */
  escortRule(
    'ga-height-sensor-threshold-conflict',
    'Exactly 15 ft 6 in high — the rule and the handbook disagree about whether the height-sensor escort is required',
    { kind: 'between', measure: 'heightIn', min: ftIn(15, 6), max: ftIn(15, 6) },
    {
      manualReview:
        'This load is exactly 15 ft 6 in high, the one height at which Georgia\'s two sources disagree. Rule 672-2 requires a front escort with a height sensor for a load "fifteen feet six inches (15\' 6") or greater", which includes it; the official Pilot/Escort Handbook says "in excess of fifteen feet six inches (15\'6")", which excludes it. The binding rule\'s inclusive reading is applied, so the escort is counted, but it must be confirmed against the issued permit.',
    },
  ),
  /**
   * The handbook adds a THIRD, lower threshold that the rule does not carry:
   * 15 ft or greater when travelling through larger cities where traffic
   * signals may be encountered. "Larger cities" is not a dimension and not a
   * road class — a load can be on a divided highway inside a large city — so it
   * is asked as a subjective question rather than forced onto `routeClass`,
   * which can only hold one value at a time.
   */
  escortRule(
    'ga-height-15-to-15-6-large-city',
    'At 15 ft high or greater but under 15 ft 6 in, travelling through a larger city — the handbook requires a height-sensor escort that the rule does not',
    {
      kind: 'all',
      of: [
        {
          kind: 'between',
          measure: 'heightIn',
          min: ftIn(15),
          max: ftIn(15, 6),
          maxInclusive: false,
        },
        {
          kind: 'subjective',
          key: 'ga-route-through-larger-city',
          question:
            'does the route pass through a larger city where traffic signals may be encountered?',
        },
      ],
    },
    { escorts: 1, front: 1, heightPole: true },
    PILOT_WORKBOOK,
    RETRIEVED,
  ),

  // ── Width, by road class ───────────────────────────────────────────────
  escortRule(
    'ga-width-two-lane-over-12-to-14-8',
    'Over 12 ft up to 14 ft 8 in wide on a two-lane road — a front escort plus a rear escort or amber lights',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: ['two-lane'] },
        {
          kind: 'between',
          measure: 'widthIn',
          min: WIDTH_12,
          max: WIDTH_14_8,
          minInclusive: false,
        },
      ],
    },
    {
      escorts: 2,
      front: 1,
      rear: 1,
      manualReview:
        'Georgia requires "a Vehicle Front Escort and a Rear Escort/Amber Lights" for this width on a two-lane road, and does not define the slash. Two escorts are counted here — the costlier reading — but if the rear requirement is satisfied by amber lights on the load, only one escort is needed and the quote is one pilot car high.',
    },
  ),
  escortRule(
    'ga-width-four-lane-over-12-to-14-8',
    'Over 12 ft up to 14 ft 8 in wide on a four-or-more-lane road — one rear escort only',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: ['divided'] },
        {
          kind: 'between',
          measure: 'widthIn',
          min: WIDTH_12,
          max: WIDTH_14_8,
          minInclusive: false,
        },
      ],
    },
    { escorts: 1, rear: 1 },
  ),
  escortRule(
    'ga-width-limited-access-over-12-to-14-8',
    'Over 12 ft up to 14 ft 8 in wide on a limited-access highway — a rear escort or amber lights only',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: ['interstate'] },
        {
          kind: 'between',
          measure: 'widthIn',
          min: WIDTH_12,
          max: WIDTH_14_8,
          minInclusive: false,
        },
      ],
    },
    {
      escorts: 1,
      rear: 1,
      manualReview:
        'On a limited-access highway at this width Georgia requires "a Rear Escort/Amber Lights only", and does not define the slash. One rear escort is counted; if amber lights on the load satisfy it, no escort vehicle is needed at all and this quote carries one it does not owe.',
    },
  ),
  escortRule(
    'ga-width-two-lane-over-14-8-to-16',
    'Over 14 ft 8 in up to and including 16 ft wide on a two-lane highway — front and rear escorts',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: ['two-lane'] },
        {
          kind: 'between',
          measure: 'widthIn',
          min: WIDTH_14_8,
          max: WIDTH_16,
          minInclusive: false,
        },
      ],
    },
    { escorts: 2, front: 1, rear: 1 },
  ),
  escortRule(
    'ga-width-multilane-over-14-8-to-16',
    'Over 14 ft 8 in up to and including 16 ft wide on a four-or-more-lane road or a limited-access highway — one rear escort only',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: ['divided', 'interstate'] },
        {
          kind: 'between',
          measure: 'widthIn',
          min: WIDTH_14_8,
          max: WIDTH_16,
          minInclusive: false,
        },
      ],
    },
    { escorts: 1, rear: 1 },
  ),
  /**
   * Above 16 ft the rule and the handbook part company completely. The binding
   * rule hands the whole question to the Department "on a case by case basis"
   * and adds that it "may require a vehicle Police Escort"; the handbook states
   * a flat requirement of two escorts, front and rear, on all roads and
   * highways. Both are official. The handbook's count is carried because it is
   * the only concrete number either source gives, and the load goes to review
   * because a case-by-case determination is by definition not predictable.
   */
  escortRule(
    'ga-width-over-16',
    'Over 16 ft wide — the rule sets escorts case by case and may require a police escort; the handbook requires two escorts on all roads',
    { kind: 'gt', measure: 'widthIn', value: WIDTH_16 },
    {
      escorts: 2,
      front: 1,
      rear: 1,
      manualReview:
        'Georgia\'s two official sources disagree about a load over 16 ft wide. Rule 672-2 says "the Department shall determine escort requirements on a case by case basis and may require a vehicle Police Escort with operating blue lights displaying their jurisdiction". The Pilot/Escort Handbook says instead that all loads more than 16 feet wide "are required to be accompanied by two escort vehicles, one in the front and one in the rear, on all roads and highways". Two civilian escorts are counted because that is the only number either source gives; a police escort may be required on top of them and Georgia publishes no hourly, per-mile, minimum-call or administrative police-escort rate anywhere, so no police cost is included and none can be estimated.',
    },
  ),

  // ── Police, weight and overhang: what Georgia does NOT key on ──────────
  escortRule(
    'ga-police-and-unkeyed-triggers',
    'Georgia keys escorts on length, height and width only, and its police-escort requirements are commodity- and case-specific',
    { kind: 'gt', measure: 'widthIn', value: 102 },
    {
      advisory:
        'Georgia\'s enumerated escort triggers are LENGTH, HEIGHT and WIDTH — the rule lists no weight trigger and no independent overhang trigger, and overhang is already inside Georgia\'s 100 ft overall-length measurement. That absence is an inference from the complete list of trigger categories, not something the rule states. Two police-escort requirements are published and neither is dimensional: a house move requires "a police front escort and a police rear escort" with no stated threshold, and a Mega Load requires "a minimum of two police escorts with blue lights required at all times as well as any additional required in the traffic control plan" whose front and rear positions are not assigned. No official Georgia police-escort rate of any kind was located, so no police cost is included in this quote.',
    },
    PERMIT_TYPES,
    RETRIEVED,
  ),

  /**
   * The Mega Load boundary, recorded because Georgia states it three different
   * ways in two documents: "exceeding 300,000 lbs.", "equal to or greater than
   * 300,000 lbs." in the same document's summary, and "300,000 lbs and above"
   * on the current permit page. Two of the three include exactly 300,000 lb and
   * one does not. The permit FEE is $500 either way, so no money turns on it —
   * what turns on it is a 30-business-day review and an outside engineering
   * analysis by a GDOT pre-qualified consultant. A load at exactly 300,000 lb
   * is already a superload here and carries no quoted price; this rule makes
   * the reason explicit rather than leaving it to a comment.
   */
  escortRule(
    'ga-megaload-boundary-conflict',
    'Exactly 300,000 lb — Georgia states the Mega Load boundary three different ways',
    { kind: 'between', measure: 'grossWeightLbs', min: 300000, max: 300000 },
    {
      manualReview:
        'This load is exactly 300,000 lb, where Georgia\'s Mega Load boundary is stated three ways: the 2016 requirements document defines a Mega Load as "all loads with a gross weight exceeding 300,000 lbs." on its first page and as "equal to or greater than 300,000 lbs." in its own summary, while the current permit page says "300,000 lbs and above". The permit fee is $500 under every reading, but the Mega Load process is not: it requires an analysis by a GDOT pre-qualified consultant firm, a field survey of the route, a structure survey with inventory and operating ratings, and at least 30 business days of GDOT review. Whether this load enters that process cannot be determined from the published wording. GDOT also does not state whether the Mega Load $500 replaces the Superload Plus $500 or stacks on it — do not assume either without confirming.',
    },
    MEGALOAD,
    EFF_MEGALOAD,
  ),

  escortRule(
    'ga-routing-and-certification',
    'Georgia requires routing information above modest thresholds and requires its pilot cars to be certified',
    {
      kind: 'any',
      of: [
        { kind: 'gt', measure: 'widthIn', value: WIDTH_12 },
        { kind: 'gt', measure: 'heightIn', value: ftIn(13, 6) },
        { kind: 'gt', measure: 'overallLengthIn', value: ftIn(100) },
        { kind: 'gt', measure: 'grossWeightLbs', value: 100000 },
      ],
    },
    {
      advisory:
        'Georgia requires routing information for "Any loads with dimensions greater than 12 feet wide, 13\'6" high, 100 feet in length or 100,000 lbs." That is a requirement to submit a route, not a professional route survey, and Georgia publishes no general survey trigger below the Mega Load category and no survey or outside-engineering cost. Separately: Georgia REQUIRES its pilot/escort operators to be certified, with a course that must be passed at 80% or better and a certificate valid four years from issue. Georgia ACCEPTS certifications from Arizona, Colorado, Utah, Virginia and Washington; Georgia\'s own certification is RECIPROCATED by North Carolina, Florida, Oklahoma and Washington. The two lists are NOT the same list — only Washington is on both — so an operator certified in Arizona may work in Georgia while a Georgia-certified operator may not work in Arizona. No current certification or recertification fee is published, and in any case it is the operator\'s cost and reaches a quote through the operator\'s rate, never through the permit fee.',
    },
    GUIDELINES,
    RETRIEVED,
  ),
];

// ── Fee schedule ──────────────────────────────────────────────────────────

/**
 * The dimensional side of Georgia's one flat schedule. Three mutually-exclusive
 * bands: at or under 16 ft in both width and height is a Standard Single at
 * $30, and over 16 ft in EITHER dimension is a Superload Single at $125. The
 * rule states the trigger as a disjunction — "exceeding a width OR height of
 * 16'" — and a band tests its dimensions conjunctively, so the disjunction is
 * written as two bands that cannot both match.
 */
const oversizeFeeBands: Sourced<OversizeFeeBand>[] = [
  fromUndatedPage<OversizeFeeBand>(
    {
      label: 'Standard Single — width and height 16 ft or under',
      upToWidthIn: { value: WIDTH_16, inclusive: false },
      upToHeightIn: { value: WIDTH_16, inclusive: false },
      feeUsd: 30,
    },
    PERMIT_TYPES,
    '"Standard Single - $30.00 • Width & Height Limit of 16\' • Weight Limit of 150,000 lbs." The weight half of the same row is carried by `overweightBands`, and `combinedFeeRule` keeps a load that is both from paying twice.',
  ),
  fromUndatedPage<OversizeFeeBand>(
    {
      label: 'Superload Single — over 16 ft wide',
      overWidthIn: { value: WIDTH_16, inclusive: false },
      feeUsd: 125,
    },
    PERMIT_TYPES,
    '"Superload Single - $125.00 • Width & Height greater than 16\'". Rule 672-2-.01 states the trigger as a disjunction: "A non-divisible load exceeding a width or height of 16\'". Approval may take up to three days. Axle weights and spacings are not required for a dimensions-only superload.',
  ),
  fromUndatedPage<OversizeFeeBand>(
    {
      label: 'Superload Single — over 16 ft high, width 16 ft or under',
      upToWidthIn: { value: WIDTH_16, inclusive: false },
      overHeightIn: { value: WIDTH_16, inclusive: false },
      feeUsd: 125,
    },
    PERMIT_TYPES,
    'The height half of the same disjunction, written as its own band so that at most one band can ever match.',
  ),
];

/**
 * The weight side, written twice around one pound.
 *
 * Every row below 150,001 lb and every row above it is IDENTICAL between the
 * two sources, so the resolver reads them as the corroboration they are. The
 * one-pound band at 150,001 lb is the only place the two sources are allowed to
 * differ, and there they differ by $95 — the permit page puts 150,001 lb in the
 * $125 Superload Single band, the rule's literal "exceeding 150,001 pounds"
 * leaves it in the $30 Standard Single band. A load at exactly 150,001 lb
 * therefore resolves to no value, shows as $30–$125, and goes to review.
 *
 * Writing the two schedules with different boundaries throughout would have
 * been the obvious approach and it would have been wrong: `weightBandsEqual`
 * compares the band edges as well as the fee, so two schedules that merely
 * disagreed about where a band starts would have produced a phantom conflict on
 * every Georgia load, including the overwhelming majority the sources agree
 * about completely.
 */
function weightSchedule(source: SourceDoc, effectiveFrom: string, atOnePoundOver: number): Sourced<WeightBand>[] {
  const row = (value: WeightBand, note?: string): Sourced<WeightBand> =>
    fromDated<WeightBand>(value, source, effectiveFrom, note);
  return [
    row(
      { minLbs: 80001, maxLbs: 150000, feeUsd: 30 },
      '"Standard Single - $30.00 ... Weight Limit of 150,000 lbs."',
    ),
    row(
      { minLbs: 150001, maxLbs: 150001, feeUsd: atOnePoundOver },
      'The one pound Georgia\'s own sources disagree about — see the schedule comment. Rule 672-2-.01 also says axle weights and spacings become required "once the gross vehicle weight exceeds 150,000 pounds", which is a third boundary again and governs paperwork rather than price.',
    ),
    row(
      { minLbs: 150002, maxLbs: 180000, feeUsd: 125 },
      '"Superload Single - $125.00 ... Weight Limit 150,001 to 180,000 lbs."',
    ),
    row(
      { minLbs: 180001, maxLbs: 299999, feeUsd: 500 },
      '"Superload Plus - $500.00 • Weight over 180,000 lbs. • Requires Bridge Analysis". Recorded for provenance; a load this heavy is a superload here and is not priced, because the bridge-analysis cost beyond the permit fee is not published.',
    ),
    row(
      { minLbs: 300000, maxLbs: null, feeUsd: 500 },
      '"Mega Load - $500.00 • Weight 300,000 lbs and above • Requires outside Engineering". GDOT does not state whether this replaces the Superload Plus $500 or is additional to it, so the two are NOT stacked. Recorded for provenance only.',
    ),
  ];
}

const overweightBands: Sourced<WeightBand>[] = [
  ...weightSchedule(PERMIT_TYPES, RETRIEVED, 125),
  ...weightSchedule(RULE_672_DEPT, EFF_RULE_672_DEPT, 30),
];

// ── The jurisdiction ──────────────────────────────────────────────────────

export const GEORGIA_OSOW_RULES: JurisdictionOsowRules = {
  code: 'GA',
  name: 'Georgia',
  country: 'US',

  legalLimits: {
    widthIn: [fromUndatedPage(102, LAWS, 'Published as 8 ft 6 in. Statutory exceptions exist for specified agricultural, forestry and port-facility movements.')],
    heightIn: [
      fromUndatedPage(
        ftIn(13, 6),
        LAWS,
        'The selected-statutes document separately allows automobile carriers up to 14 ft on Interstate highways and reasonable-access routes; a quote does not identify the commodity, so the general limit is used.',
      ),
    ],
    trailerLengthIn: [fromUndatedPage(ftIn(53), LAWS, '"The standard trailer unit in Georgia is 53 feet."')],
    /**
     * Georgia is one of the few states here that DOES publish an overall
     * combination limit, and it is generous enough not to catch ordinary
     * freight: 100 ft including overhang, against roughly 70 ft for a tractor
     * and a 53 ft trailer. It is recorded because the escort schedule and the
     * routing requirement are both keyed to overall length.
     */
    overallLengthIn: [
      fromUndatedPage(
        ftIn(100),
        LAWS,
        '"Length 100 ft. (including overhang)". Equipment-specific and NHS/Interstate exceptions exist. Because overhang is inside this measurement, Georgia publishes no separate overhang limit and no independent overhang escort trigger — which is why the overhang fields below are absent.',
      ),
    ],
    grossWeightLbs: [
      fromUndatedPage(
        80000,
        LAWS,
        '"Weight 80,000 lbs. gross weight". The federal bridge formula applies to all weight limitations and both inner and outer bridge limits are enforced, so the usable gross can be lower.',
      ),
    ],
    /**
     * A GENUINE, RECORDED CONFLICT, AND IT PUTS EVERY GEORGIA QUOTE INTO
     * REVIEW. The DPS oversize-permit Laws page states "Legal axle weight is
     * 20,340 pounds." The official Pilot/Escort Handbook states "Weight is
     * greater than 80,000 lbs. (20,000 lbs. single axle, 34,000 lbs. tandem
     * axle)". Both are Georgia DPS documents, they are 340 lb apart, and
     * nothing in either reconciles them by route or by vehicle. Neither is
     * adopted here.
     */
    singleAxleLbs: [
      fromUndatedPage(20340, LAWS, '"Legal axle weight is 20,340 pounds."'),
      fromUndatedPage(
        20000,
        PILOT_WORKBOOK,
        'The official Pilot/Escort Handbook summarises the same limit as 20,000 lb. The documents do not reconcile the 20,340 lb and 20,000 lb figures by route or by vehicle type.',
      ),
    ],
    /**
     * ALSO UNRESOLVED, and for a subtler reason. Georgia's tandem limit is
     * 34,000 lb on national highways and 40,680 lb elsewhere, which would be a
     * route distinction rather than a conflict — except that the DPS Laws page
     * states the national-highway exception in a form that contradicts both
     * itself and the statute. The page says the tandem is 40,680 lb when the
     * gross is under 73,280 lb AND the length is over 55 ft, and 34,000 lb when
     * the gross is over 73,280 lb OR the length is over 55 ft; a load under
     * 73,280 lb and over 55 ft satisfies both rows and gets two different
     * answers. The statute says the opposite of the page — 40,680 lb is
     * available only to a vehicle NOT over 55 ft and under 73,280 lb. Both
     * figures are on file and neither is adopted.
     */
    tandemAxleLbs: [
      fromDated(
        34000,
        TITLE_32,
        EFF_TITLE_32,
        'O.C.G.A. Title 32: "the maximum load authorized on any tandem axle shall be 34,000 pounds" on national highways.',
      ),
      fromUndatedPage(
        40680,
        LAWS,
        'The DPS Laws page states 40,680 lb under conditions it describes contradictorily: "If gross weight is less than 73,280 pounds and length is greater than 55 feet, the tandem weight is 40,680 pounds. If gross weight is greater than 73,280 pounds or length is greater than 55 feet, the tandem weight limit is 34,000 pounds." Both rows fire for a load under 73,280 lb and over 55 ft. The statute instead makes 40,680 lb available only "except for vehicles and combinations of vehicles exceeding 55 feet in length". 40,680 lb is also the ordinary tandem limit on all NON-national highways.',
      ),
    ],
  },

  /**
   * A SOURCED ZERO. Georgia publishes no issuance charge on top of the permit
   * type's flat amount — the whole fee is the band. Recorded rather than
   * omitted so the absence is a finding; the engine suppresses the empty line.
   */
  permitBaseFeeUsd: [
    fromUndatedPage(
      0,
      PERMIT_TYPES,
      'The permit-type list prints one flat amount per type and nothing beside it. The only additions Georgia publishes are the flat $7.00 credit-card charge and the $1.00 fax charge.',
    ),
  ],

  oversizeFeeBands,

  /**
   * GREATER OF, AND THIS IS AN INFERENCE — see the module header. Georgia
   * publishes permit TYPES rather than additive components, and a load falls
   * into exactly one type. Taking the greater of the dimensional band and the
   * weight band is the only combination rule that reproduces every published
   * row; adding them would charge $250 for a 17 ft wide 160,000 lb load that
   * Georgia prices at $125.
   */
  combinedFeeRule: [
    fromUndatedPage<CombinedFeeRule>(
      {
        kind: 'greaterOf',
        explanation:
          'Georgia publishes one flat fee per permit TYPE — Standard Single $30, Superload Single $125, Superload Plus $500 — and the same schedule covers oversize and overweight, so a load that is both is a single permit at the higher of the two amounts rather than two permits added together. GDOT does not state this in words; it is the only reading that reproduces the published type list.',
      },
      PERMIT_TYPES,
    ),
  ],

  overweightPricing: [
    fromUndatedPage<OverweightPricing>(
      {
        kind: 'bands',
        explanation:
          'Georgia charges a flat amount per weight band — $30 through 150,000 lb, $125 to 180,000 lb, $500 above it — with no per-mile component, no per-axle component and no published fee formula of any kind.',
      },
      PERMIT_TYPES,
    ),
    fromDated<OverweightPricing>(
      {
        kind: 'bands',
        explanation:
          'Rule 672-2-.01 defines the same bands as permit categories rather than as a formula, and adds that axle weights and spacings become required once the gross weight exceeds 150,000 lb.',
      },
      RULE_672_DEPT,
      EFF_RULE_672_DEPT,
    ),
  ],

  overweightBands,
  overweightPerMile: [],
  conditionalFees: [],

  /**
   * $7.00 FLAT, AND NO PERCENTAGE. The 2026 single-trip application states the
   * credit-card charge outright; no percentage-based surcharge was found on any
   * Georgia page, so a sourced zero for the percentage is a finding rather than
   * an assumption. The charge does apply only to the card option, which the row
   * records — a permit paid from an escrow account, by cashier's or company
   * cheque, or by COMCHEK does not carry it, and this quote will be $7 high for
   * those payers.
   *
   * RECORDED UNKNOWN: the undated Guidelines page adds "$1.00 will be added to
   * include the cost of faxing the permit to you" and says all permits are sent
   * by Dotfax. The 2026 application offers fax OR email and does not repeat the
   * charge, so whether the $1.00 still applies is genuinely unclear and it is
   * NOT included.
   */
  transactionFee: [
    fromDated<TransactionFee>(
      { perPermitUsd: 7, percentOfTotal: 0 },
      SINGLE_TRIP_2026,
      EFF_SINGLE_TRIP_2026,
      '"CREDIT CARD USE IS ACCEPTED BY THE OVERSIZE PERMIT UNIT AND IS OFFERED AS AN OPTION OF CONVENIENCE FOR OUR CUSTOMERS. THE CHARGE FOR THIS SERVICE IS $7.00", charged by VitalChek Network. It is additive and flat, and it applies only when a card is used. Georgia publishes no percentage-based surcharge anywhere in the reviewed sources, so the percentage is recorded as zero rather than left unknown. The undated $1.00 fax charge is not included — see the field comment.',
    ),
  ],

  /**
   * EMPTY, and that is the finding. Georgia publishes no engineering-review fee
   * of its own. A Superload Plus needs a bridge analysis and a Mega Load needs
   * an analysis by a GDOT pre-qualified consultant firm, and the cost of
   * neither is published — it is paid to the consultant, not to the state.
   * Recording a number here would imply the $500 permit fee buys the
   * engineering, which it does not.
   */
  routeAnalysisFeeUsd: [],
  noBridgeRouteFeeUsd: [],

  superload: {
    /**
     * DRAWN AT 180,000 LB, NOT AT GEORGIA'S OWN "SUPERLOAD" LINE — see the
     * module header. Below 180,000 lb every Georgia permit has a complete
     * published price ($30 or $125) and is quoted. Above it, a Superload Plus
     * requires a bridge analysis and a Mega Load requires outside engineering,
     * and neither cost is published, so the permit total is genuinely
     * incomplete and the engine refuses to state one.
     *
     * Both sources give the same threshold with the same exclusivity, so it
     * resolves cleanly — which is what puts Georgia into the widget's weight
     * ceiling mirror at 180,000 lb, the heaviest gross weight the engine will
     * quote for a Georgia lane.
     */
    grossWeight: [
      fromDated<Threshold>(
        { value: 180000, inclusive: false },
        RULE_672_DEPT,
        EFF_RULE_672_DEPT,
        '"Superload Plus: A non-divisible load exceeding a gross vehicle weight of 180,000 pounds", which "requires axle weights and spacings for a complete bridge analysis". Actual axle spacings must be accurate or longer than those on the permit; shorter spacings void it.',
      ),
      fromUndatedPage<Threshold>(
        { value: 180000, inclusive: false },
        PERMIT_TYPES,
        '"Superload Plus - $500.00 • Weight over 180,000 lbs. • Requires Bridge Analysis. Note: May take up to three (3) weeks for approval."',
      ),
    ],
    shortSpacing: [],
    /**
     * NO DIMENSIONAL SUPERLOAD ROWS, DELIBERATELY. Georgia calls a load over
     * 16 ft wide or high a superload, but prices it at a published flat $125 and
     * issues it in about three days — so it is quoted here rather than refused.
     * The label difference is recorded in the module header; the $125 lives in
     * `oversizeFeeBands` where it can actually be charged.
     */
  },

  /**
   * ALL EMPTY, AND SILENT BY DESIGN. Georgia requires ROUTING INFORMATION above
   * modest thresholds — over 12 ft wide, over 13 ft 6 in high, over 100 ft long
   * or over 100,000 lb — but its own source says only that such loads "need
   * routes", not that a professional route survey is triggered. A field survey
   * IS required for a Mega Load, which is a superload here and already
   * unpriced. Turning the routing thresholds into route-inspection triggers
   * would announce an inspection Georgia has not asked for, so they are carried
   * by the `ga-routing-and-certification` advisory instead.
   */
  routeInspection: {
    widthIn: [],
    heightIn: [],
    lengthIn: [],
  },

  escortRules: GEORGIA_ESCORT_RULES,

  /** Flat bands. Nothing in Georgia's single-trip fee depends on distance. */
  feesDependOnDistance: false,
};

/** Cited for the pilot-car certification programme itself. */
export const GEORGIA_ESCORT_CERTIFICATION_SOURCES = [CVE_TRAINING, CERT_ESCORT];
