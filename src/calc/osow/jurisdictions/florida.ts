/**
 * FLORIDA — oversize/overweight trip permit rules.
 *
 * The state whose fee rule publishes its own arithmetic, and the reason
 * `PerMileRate` grew three fields. FAC 14-26.008 does not just give a rate; it
 * gives a worked example, and the example is the specification:
 *
 *     "Permit fees shall be based on 25 mile increments rounded up to the
 *      nearest dollar. Example: A 112,000 pound load traveling 67.5 miles would
 *      cost (75 miles X $0.32) plus $3.33 = $27.33 rounded up to $28.00 in
 *      addition to the $5.00 transmission fee when applicable."
 *
 * Three things in one sentence that no earlier state needed: miles round UP to
 * a 25-mile increment before pricing, a flat $3.33 goes in BEFORE the rounding
 * rather than after it, and the total rounds UP to the dollar rather than to
 * cents. Getting the order wrong is not academic — adding the $3.33 after the
 * rounding gives $30.33 against Florida's own $28.00. The engine reproduces the
 * published example exactly, which is the only reason to trust it on the rest of
 * the table.
 *
 * FOUR MORE THINGS TO KNOW BEFORE TRUSTING A FLORIDA NUMBER
 * --------------------------------------------------------
 *
 * 1. FLORIDA HAS NO "SUPERLOAD". The rule chapter uses "routine" and
 *    "non-routine" instead, and `superload.grossWeight` is therefore ABSENT —
 *    which also, deliberately, keeps Florida out of the widget's weight-ceiling
 *    mirror. The 300,000 lb figure Florida does publish is a STRUCTURAL
 *    EVALUATION documentation trigger, not a permit-class threshold; mirroring
 *    it would let the client wave through a 250,000 lb Florida load that the
 *    server then refuses, because the per-mile schedule below stops at 162,000.
 *
 * 2. THE TOP TWO FEE ROWS CANNOT BE COMPUTED AT ALL. Rows (2)(h) and (2)(i)
 *    read "$0.003 Per 1,000 Pounds Per Mile" and the rule never says whether the
 *    pounds are the gross weight or the weight over legal, nor how they round.
 *    Two readings of the same row differ by a factor of two on a 160,000 lb
 *    load. So no rate is held above 162,000 lb and the move goes to review with
 *    the row quoted — an unknown that moves a priced line is a refusal, not a
 *    guess.
 *
 * 3. FLORIDA'S SEMITRAILER LENGTH IS IN DISPUTE WITH ITSELF. FS 316.515(3)(b)2
 *    allows "more than 48 feet but not more than 57 feet"; FAC 14-26.008 Table
 *    1A(1)(b) and 14-26.012(11)(c) both say 57 feet 6 inches. Six inches, one
 *    statute against two rules, and it is filed as a conflict — which costs a
 *    review flag on every Florida quote and is the honest price of the
 *    disagreement.
 *
 * 4. FDOT'S 2026 OPERATIONAL CONDITIONS ADD REQUIREMENTS THE RULE DOES NOT
 *    CONTAIN. The July 2026 Blanket Permit Movement Conditions require a
 *    qualified escort to perform the route survey, narrow the survey-letter
 *    carriage requirement, add a Florida Keys escort south of Florida City, and
 *    drop the word "divided" from the escort-position rule. All four are
 *    recorded against the rule text they depart from rather than merged into it.
 *
 * DATE WARNING: every FAC rule here is effective 2018-04-24 or earlier — the
 * criteria rule is from 2016 and the fee-exemption rule from 2013 — and the
 * statutes carry amendment chapters rather than dates, so their `revisedOn` is
 * `null` and their rows are effective only from our retrieval date. flrules.org
 * showed no later amendment on the day of retrieval.
 */
import type { SourceDoc, Sourced } from '../provenance.js';
import { ftIn, type EscortRule, type RouteClass } from '../escortRules.js';
import type {
  JurisdictionOsowRules,
  OversizeFeeBand,
  OverweightPricing,
  PerMileRate,
  Threshold,
  TransactionFee,
} from '../types.js';

const RETRIEVED = '2026-09-02';

// ── Source documents ──────────────────────────────────────────────────────

/**
 * The statutes carry an amendment CHAPTER, not a date — "s. 2, ch. 2019-149" —
 * and the page is the 2024 edition. `revisedOn` is `null` for all four rather
 * than a date inferred from a chapter number, and their rows are effective from
 * the retrieval date, which is the only day we can prove what they said.
 */
const FS_316_515: SourceDoc = {
  id: 'fl-fs-316-515',
  title: 'Fla. Stat. §316.515 — Maximum width, height, length',
  url: 'https://www.flsenate.gov/Laws/Statutes/2024/316.515',
  publisher: 'The Florida Senate, 2024 Florida Statutes',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'width 102 in (96 in on roads without a 12 ft through lane); height 13 ft 6 in (14 ft for automobile transporters); semitrailer 48 ft, or up to 57 ft with a kingpin-to-rear-axle distance not over 41 ft; front overhang 3 ft; last amended s. 2, ch. 2019-149',
};

const FS_316_535: SourceDoc = {
  id: 'fl-fs-316-535',
  title: 'Fla. Stat. §316.535 — Maximum weights',
  url: 'https://www.flsenate.gov/Laws/Statutes/2024/316.535',
  publisher: 'The Florida Senate, 2024 Florida Statutes',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'single axle 20,000 lb; W = 500((LN ÷ (N–1)) + 12N + 36) and 80,000 lb gross "including all enforcement tolerances"; subsection (3) axle-spacing table; last amended s. 6, ch. 2002-20',
};

const FS_316_545: SourceDoc = {
  id: 'fl-fs-316-545',
  title: 'Fla. Stat. §316.545 — Weight and load unlawful; scale tolerance',
  url: 'https://www.flsenate.gov/Laws/Statutes/2024/316.545',
  publisher: 'The Florida Senate, 2024 Florida Statutes',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: '"weight tables published pursuant to s. 316.535(7) shall include a 10-percent scale tolerance"; permit weights "shall be deemed to include all allowable tolerances"; last amended s. 8, ch. 2021-186',
};

const FS_316_550: SourceDoc = {
  id: 'fl-fs-316-550',
  title: 'Fla. Stat. §316.550 — Operations not in conformity; special permits',
  url: 'https://www.flsenate.gov/Laws/Statutes/2024/316.550',
  publisher: 'The Florida Senate, 2024 Florida Statutes',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: '"The minimum fee for issuing any such permit shall be $5."; blanket permits up to 36 months with an annualised fee not over $500; last amended s. 82, ch. 2013-160',
};

const FAC_14_26_008: SourceDoc = {
  id: 'fl-fac-14-26-008',
  title: 'Fla. Admin. Code r. 14-26.008 — Schedule of Fees (FDOT copy)',
  url: 'https://fdotwww.blob.core.windows.net/sitefinity/docs/default-source/maintenance/str/owodp/schedule-of-fees.pdf?sfvrsn=d37c7453_0',
  publisher: 'Florida Department of Transportation',
  revisedOn: '2018-04-24',
  retrievedOn: RETRIEVED,
  cite: 'Table 1A overdimension fees; Table 1B overweight fees; the $3.33 administrative cost and the 25-mile worked example; "(3) SPECIAL PERMIT FEES Transmission Fee $5.00"',
};

const FAC_14_26_00411: SourceDoc = {
  id: 'fl-fac-14-26-00411',
  title: 'Fla. Admin. Code r. 14-26.00411 — Permitting process (via Cornell LII)',
  url: 'https://www.law.cornell.edu/regulations/florida/Fla-Admin-Code-Ann-R-14-26-00411',
  publisher: 'Cornell Legal Information Institute, reproducing FAC 14-26',
  revisedOn: '2018-04-24',
  retrievedOn: RETRIEVED,
  cite: '(4) payment methods and ten-business-day lead time; (5) route survey and survey letter; (6) structural evaluation at any axle over 30,000 lb or gross of 300,000 lb or more',
};

const FAC_14_26_012: SourceDoc = {
  id: 'fl-fac-14-26-012',
  title: 'Fla. Admin. Code r. 14-26.012 — Movement Conditions and Restrictions (via Cornell LII)',
  url: 'https://www.law.cornell.edu/regulations/florida/Fla-Admin-Code-Ann-R-14-26-012',
  publisher: 'Cornell Legal Information Institute, reproducing FAC 14-26',
  revisedOn: '2018-04-24',
  retrievedOn: RETRIEVED,
  cite: '(2) qualified escorts; (4) escort position; (7) width bands; (8) height bands; (9) length and overhang; height-pole specification',
};

const FAC_14_26_00425: SourceDoc = {
  id: 'fl-fac-14-26-00425',
  title: 'Fla. Admin. Code r. 14-26.00425 — Criteria and override authority (via Cornell LII)',
  url: 'https://www.law.cornell.edu/regulations/florida/Fla-Admin-Code-Ann-R-14-26-00425',
  publisher: 'Cornell Legal Information Institute, reproducing FAC 14-26',
  revisedOn: '2016-08-23',
  retrievedOn: RETRIEVED,
  cite: '"an applicant must include, with the permit application, a letter of essentiality from a government entity or the ultimate recipient of an essential service"',
};

const FDOT_2026_CONDITIONS: SourceDoc = {
  id: 'fdot-blanket-permit-movement-conditions-2026-07',
  title: 'FDOT — Blanket Permit Movement Conditions, revised July 27 2026 (PDF)',
  url: 'https://fdotwww.blob.core.windows.net/sitefinity/docs/default-source/maintenance/str/owodp/oom_20260727_blanket-permit-movement-conditions.pdf?sfvrsn=dde068ab_1',
  publisher: 'Florida Department of Transportation',
  revisedOn: '2026-07-27',
  retrievedOn: RETRIEVED,
  cite: 'survey "must be performed by a qualified escort"; Florida Keys night-only movement over 10 ft wide; "follow the load on four lane highways"',
};

const FDOT_PAS: SourceDoc = {
  id: 'fdot-permit-office-pas',
  title: 'FDOT — Oversize/Overweight Permits (self-issue thresholds)',
  url: 'https://www.fdot.gov/maintenance/divisions.shtm/structures/owodpermits.shtm',
  publisher: 'Florida Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: '"Customers can SELF-ISSUE Trip permits using the Permit Application System (PAS) for loads up to 16 feet wide, 18 feet high, 150 long and 200,000 pounds (140,000 pounds for self-propelled equipment)."',
};

const FHP_510: SourceDoc = {
  id: 'fl-fhp-policy-5-10',
  title: 'Florida Highway Patrol Policy 5.10 — Escort services for overdimensional vehicles',
  url: 'https://www.flhsmv.gov/pdf/fhp/policies/0510.pdf',
  publisher: 'Florida Department of Highway Safety and Motor Vehicles',
  revisedOn: '2024-08-22',
  retrievedOn: RETRIEVED,
  cite: 'commercial OS/OW escorts are off-duty police employment approved by the troop commander; at least two marked FHP vehicles per escort; requests at least five working days ahead',
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

/** Statutes and pages carrying no date of their own. */
function fromUndated<T>(value: T, source: SourceDoc, note?: string): Sourced<T> {
  return {
    value,
    source,
    effectiveFrom: RETRIEVED,
    effectiveTo: null,
    ...(note === undefined ? {} : { note }),
  };
}

const EFF_RULE = '2018-04-24';
const EFF_CRITERIA = '2016-08-23';
const EFF_2026_CONDITIONS = '2026-07-27';

/**
 * "Limited access facility" is FAC 14-26's own class and is wider than
 * `interstate` — Florida's Turnpike is one. Both members are named wherever the
 * rule says limited access, and the complement is named explicitly rather than
 * written as a negation, so a quote with no road type evaluates to `unknown`
 * instead of silently taking the cheaper branch.
 */
const LIMITED_ACCESS: RouteClass[] = ['fl-limited-access', 'interstate'];
const NOT_LIMITED_ACCESS: RouteClass[] = [
  'two-lane',
  'divided',
  'multilane-undivided',
  'urban',
];

/**
 * "This load needs a Florida permit of some kind." The transmission-fee unknown,
 * the survey conflicts and the night/override conditions apply to every permit
 * rather than to a dimension, and keying them on width alone would hide the
 * $5.00 fee's own uncertainty from an overweight legal-size move — the case
 * where FDOT's published example actually charges it.
 */
const PERMIT_LIKELY: EscortRule['when'] = {
  kind: 'any',
  of: [
    { kind: 'gt', measure: 'widthIn', value: 102 },
    { kind: 'gt', measure: 'heightIn', value: ftIn(13, 6) },
    { kind: 'gt', measure: 'grossWeightLbs', value: 80000 },
  ],
};

// ── Table 1A — the overdimension trip-permit bands ────────────────────────

const W12 = ftIn(12);
const W14 = ftIn(14);
const H13_6 = ftIn(13, 6);
const H14_6 = ftIn(14, 6);
const H18 = ftIn(18);
const L85 = ftIn(85);
const L95 = ftIn(95);
const L120 = ftIn(120);

/**
 * Table 1A, category (1)(a) "Straight trucks and semi-truck-tractor-trailer",
 * TRIP PERMIT column, split so the bands are mutually exclusive.
 *
 * The table's own NOTE is what forces the split: "All permitted dimensions
 * (length, height, width) must be within limits shown for permit fee." A band is
 * therefore a CONJUNCTION of three ceilings, and as published the three priced
 * rows overlap — a 10 ft by 13 ft by 80 ft load is inside all of them, and the
 * resolver would read $5, $15 and $25 as three sources disagreeing about one fee
 * and refuse to price an ordinary load.
 *
 * So each step above the first is split into one band per dimension that can
 * lift the load out of the step below, with a floor on that dimension and the
 * step's own ceilings on all three. Bands that then still overlap carry the SAME
 * fee, which the mutual-exclusion invariant permits and which is what the
 * schedule means. Indiana needed the same treatment for the same reason.
 */
const oversizeFeeBands: Sourced<OversizeFeeBand>[] = [
  fromDated<OversizeFeeBand>(
    {
      label: 'up to 12 ft wide, 13 ft 6 in high and 85 ft long',
      upToWidthIn: { value: W12, inclusive: false },
      upToHeightIn: { value: H13_6, inclusive: false },
      upToLengthIn: { value: L85, inclusive: false },
      feeUsd: 5,
    },
    FAC_14_26_008,
    EFF_RULE,
    '"Up to 12 feet wide, or up to 13 feet 6 inches high or up to 85 feet long. $5.00" (trip permit, 10 days). FS 316.550(6) sets $5 as the minimum fee for issuing any permit, so this row is also that floor.',
  ),
  fromDated<OversizeFeeBand>(
    {
      label: 'over 12 ft wide, up to 14 ft wide / 14 ft 6 in high / 95 ft long',
      overWidthIn: { value: W12, inclusive: false },
      upToWidthIn: { value: W14, inclusive: false },
      upToHeightIn: { value: H14_6, inclusive: false },
      upToLengthIn: { value: L95, inclusive: false },
      feeUsd: 15,
    },
    FAC_14_26_008,
    EFF_RULE,
    '"Up to 14 feet wide or up to 14 feet 6 inches high or up to 95 feet long. $15.00", reached on WIDTH.',
  ),
  fromDated<OversizeFeeBand>(
    {
      label: 'over 13 ft 6 in high, up to 14 ft wide / 14 ft 6 in high / 95 ft long',
      upToWidthIn: { value: W14, inclusive: false },
      overHeightIn: { value: H13_6, inclusive: false },
      upToHeightIn: { value: H14_6, inclusive: false },
      upToLengthIn: { value: L95, inclusive: false },
      feeUsd: 15,
    },
    FAC_14_26_008,
    EFF_RULE,
    'The same $15 step reached on HEIGHT rather than width. Bounded at the step\'s own ceilings so it cannot also match a load already covered by the $5 row.',
  ),
  fromDated<OversizeFeeBand>(
    {
      label: 'over 85 ft long, up to 14 ft wide / 14 ft 6 in high / 95 ft long',
      upToWidthIn: { value: W14, inclusive: false },
      upToHeightIn: { value: H14_6, inclusive: false },
      overLengthIn: { value: L85, inclusive: false },
      upToLengthIn: { value: L95, inclusive: false },
      feeUsd: 15,
    },
    FAC_14_26_008,
    EFF_RULE,
    'The same $15 step reached on LENGTH.',
  ),
  fromDated<OversizeFeeBand>(
    {
      label: 'over 14 ft 6 in high, up to 14 ft wide / 18 ft high / 120 ft long',
      upToWidthIn: { value: W14, inclusive: false },
      overHeightIn: { value: H14_6, inclusive: false },
      upToHeightIn: { value: H18, inclusive: false },
      upToLengthIn: { value: L120, inclusive: false },
      feeUsd: 25,
    },
    FAC_14_26_008,
    EFF_RULE,
    '"Up to 14 feet wide or up to 18 feet high or up to 120 feet long. $25.00", reached on HEIGHT. Width cannot exceed 14 ft inside this step — the row above it in the table has the same width ceiling.',
  ),
  fromDated<OversizeFeeBand>(
    {
      label: 'over 95 ft long, up to 14 ft wide / 18 ft high / 120 ft long',
      upToWidthIn: { value: W14, inclusive: false },
      upToHeightIn: { value: H18, inclusive: false },
      overLengthIn: { value: L95, inclusive: false },
      upToLengthIn: { value: L120, inclusive: false },
      feeUsd: 25,
    },
    FAC_14_26_008,
    EFF_RULE,
    'The same $25 step reached on LENGTH.',
  ),
  fromDated<OversizeFeeBand>(
    {
      label: 'over 14 ft wide',
      overWidthIn: { value: W14, inclusive: false },
      feeUsd: 25,
    },
    FAC_14_26_008,
    EFF_RULE,
    '"Over 14 feet wide or over 18 feet high or over 120 feet long. $25.00" — the trip-permit price does not rise past $25 however far over the load is, though multi-trip permits are NOT ISSUED above this line and the movement conditions tighten sharply.',
  ),
  fromDated<OversizeFeeBand>(
    { label: 'over 18 ft high', overHeightIn: { value: H18, inclusive: false }, feeUsd: 25 },
    FAC_14_26_008,
    EFF_RULE,
    'The same $25 top row reached on HEIGHT.',
  ),
  fromDated<OversizeFeeBand>(
    { label: 'over 120 ft long', overLengthIn: { value: L120, inclusive: false }, feeUsd: 25 },
    FAC_14_26_008,
    EFF_RULE,
    'The same $25 top row reached on LENGTH.',
  ),
];

// ── Table 1B — the overweight trip-permit per-mile rates ──────────────────

const OVERWEIGHT_BANDS: Array<{ min: number; max: number; rate: number; row: string }> = [
  { min: 80001, max: 95000, rate: 0.27, row: '(a) Up to 95,000 pounds. $0.27 Per Mile' },
  { min: 95001, max: 112000, rate: 0.32, row: '(b) Up to 112,000 pounds. $0.32 Per Mile' },
  { min: 112001, max: 122000, rate: 0.36, row: '(c) Up to 122,000 pounds. $0.36 Per Mile' },
  { min: 122001, max: 132000, rate: 0.38, row: '(d) Up to 132,000 pounds. $0.38 Per Mile' },
  { min: 132001, max: 142000, rate: 0.42, row: '(e) Up to 142,000 pounds. $0.42 Per Mile' },
  { min: 142001, max: 152000, rate: 0.45, row: '(f) Up to 152,000 pounds. $0.45 Per Mile' },
  { min: 152001, max: 162000, rate: 0.47, row: '(g) Up to 162,000 pounds. $0.47 Per Mile' },
];

const overweightPerMile: Sourced<PerMileRate>[] = OVERWEIGHT_BANDS.map((b) =>
  fromDated<PerMileRate>(
    {
      minLbs: b.min,
      maxLbs: b.max,
      ratePerMileUsd: b.rate,
      perIncrementLbs: null,
      excessBaseLbs: null,
      roundIncrementUp: false,
      minimumUsd: null,
      maximumUsd: null,
      roundMilesUpTo: 25,
      addAfterUsd: 3.33,
      roundDollars: 'up',
    },
    FAC_14_26_008,
    EFF_RULE,
    `Table 1B "${b.row}". The $3.33 administrative cost applies to weights over 80,000 lb and goes inside the rounding; miles round up to 25-mile increments; the total rounds up to the dollar. The rule's own example — 112,000 lb over 67.5 miles as "(75 miles X $0.32) plus $3.33 = $27.33 rounded up to $28.00" — is reproduced exactly by this row's band (b).`,
  ),
);

// ── Escort rules ──────────────────────────────────────────────────────────

function escortRule(
  id: string,
  description: string,
  when: EscortRule['when'],
  then: EscortRule['then'],
  source: SourceDoc = FAC_14_26_012,
  effectiveFrom: string = EFF_RULE,
): EscortRule {
  return {
    id,
    jurisdiction: 'FL',
    description,
    when,
    then,
    source,
    effectiveFrom,
    effectiveTo: null,
  };
}

export const FLORIDA_ESCORT_RULES: EscortRule[] = [
  /**
   * Florida sets the COUNT by dimension and the POSITION by road type, and only
   * the count costs money — so a single over-width escort is recorded as a bare
   * `escorts: 1`, exactly as Texas's is, rather than as two position-specific
   * rules that would force review on every quote with no road type.
   */
  escortRule(
    'fl-width-over-12-to-14',
    'Over 12 ft up to 14 ft wide — at least one escort at all times',
    {
      kind: 'between',
      measure: 'widthIn',
      min: W12,
      max: W14,
      minInclusive: false,
      maxInclusive: true,
    },
    {
      escorts: 1,
      manualReview:
        'FAC 14-26.012(7)(c) requires "A minimum of one escort vehicle, with escort, ... at all times" in this width band, and TWO "On roadway lanes less than 12 feet wide, bridges with less than 30 feet curb to curb, and in rural areas with traffic volume greater than 12,000 Average Daily Traffic (ADT) per lane or in urbanized areas (more than 50,000 population) with ADT greater than 8,000 vehicles per lane ... except on loads with a minimum of four warning lights mounted two in front and two in the rear". Lane width, bridge width, ADT and the load\'s lighting are not collected on a quote, so ONE escort is priced and the second cannot be ruled out. Position follows the road type: the escort precedes the load on a two-lane highway and follows it on a four-lane divided one.',
    },
  ),
  escortRule(
    'fl-width-over-14-to-16',
    'Over 14 ft up to 16 ft wide — two qualified escorts, one in front and one at the rear',
    {
      kind: 'between',
      measure: 'widthIn',
      min: W14,
      max: ftIn(16),
      minInclusive: false,
      maxInclusive: true,
    },
    {
      escorts: 2,
      front: 1,
      rear: 1,
      advisory:
        'Trip permits only in this band, and FAC 14-26.012(7)(d)3 adds that "Two lane roadways shall not be used as a connector route whenever viable four lane routes are available." Sixteen feet is also the maximum width for a manufactured building.',
    },
  ),
  /**
   * Over 16 ft, Florida stops counting pilot cars and starts counting troopers,
   * and which it is depends on the road AND the time of day. Neither branch is
   * priced: an FHP escort is off-duty police employment at an unpublished rate.
   */
  escortRule(
    'fl-width-over-16',
    'Over 16 ft wide — two escorts, but whether they are pilot cars or law-enforcement units depends on the road and the hour',
    { kind: 'gt', measure: 'widthIn', value: ftIn(16) },
    {
      manualReview:
        'FAC 14-26.012(7)(e) splits this band three ways and a quote cannot choose between them: "1. Two qualified escorts are required when travelling on a limited access facility during daytime hours only. 2. One law enforcement escort and one qualified escort are required when travelling on a limited access facility during nighttime hours. 3. Two law enforcement escorts are required at all times when travelling on state maintained roadways (excluding limited access facilities)." The time of day is not collected, and the difference between two pilot cars and two troopers is the largest single cost swing in a Florida quote. Movement is restricted to local moves, the application is reviewed by the District Traffic Engineering Office, items must be moved by rail, air or water when possible, and over 22 ft an affidavit is required verifying two feet of horizontal clearance on each side. No escort cost is asserted.',
    },
  ),
  escortRule(
    'fl-height-over-14-6-to-16',
    'Over 14 ft 6 in up to 16 ft high — one escort with a vertical height indicator, preceding the load',
    {
      kind: 'between',
      measure: 'heightIn',
      min: H14_6,
      max: ftIn(16),
      minInclusive: false,
      maxInclusive: true,
    },
    {
      escorts: 1,
      front: 1,
      heightPole: true,
      advisory:
        'FAC 14-26.012: "For over height loads, the lead vehicle must have a height indicator, i.e., height pole, used to determine vertical clearance. This device must be manufactured of non-conductive and non-destructive material and must be positioned at a height of at least 6 inches above the height of the load being escorted." A load between 13 ft 6 in and 14 ft 6 in needs a permit but no escort and therefore no pole.',
    },
  ),
  escortRule(
    'fl-height-over-16',
    'Over 16 ft high — one law-enforcement escort in addition to one qualified escort',
    { kind: 'gt', measure: 'heightIn', value: ftIn(16) },
    {
      escorts: 1,
      front: 1,
      heightPole: true,
      policeFront: 1,
      manualReview:
        'FAC 14-26.012(8)(c): "One law enforcement escort in addition to one qualified escort is required. The qualified escort must precede the load with a vertical height indicator", and "Appropriate utility personnel will also be required whenever the load will encounter low barriers such as overhead structures, traffic signals, and low wires." Movement is restricted to local moves; multi-trip permits stop at 18 ft; over 18 ft an affidavit verifying the route clears the load by six inches is required. Florida publishes no law-enforcement escort rate — FHP escorts of commercial overdimensional loads are off-duty police employment under FHP Policy 5.10 — so the trooper and any utility standby are excluded from the total.',
    },
  ),
  escortRule(
    'fl-length-over-95',
    'Over 95 ft long — one qualified escort, at the rear',
    { kind: 'gt', measure: 'overallLengthIn', value: L95 },
    {
      escorts: 1,
      rear: 1,
      advisory:
        'FAC 14-26.012(4): "If the load is over length only, the escort vehicle shall be in the rear of the load at all times." A truck tractor-semitrailer with three points of articulation is allowed up to 105 ft with no escort at all.',
    },
  ),
  escortRule(
    'fl-length-over-150',
    'Over 150 ft long — two qualified escorts, unless the move is on a limited access facility',
    {
      kind: 'all',
      of: [
        { kind: 'gt', measure: 'overallLengthIn', value: ftIn(150) },
        { kind: 'routeClass', anyOf: NOT_LIMITED_ACCESS },
      ],
    },
    { escorts: 2, front: 1, rear: 1 },
  ),
  escortRule(
    'fl-length-over-150-limited-access',
    'Over 150 ft long on a limited access facility — one qualified escort',
    {
      kind: 'all',
      of: [
        { kind: 'gt', measure: 'overallLengthIn', value: ftIn(150) },
        { kind: 'routeClass', anyOf: LIMITED_ACCESS },
      ],
    },
    {
      escorts: 1,
      rear: 1,
      advisory:
        'FAC 14-26.012(9): "Two qualified escorts are required when the length exceeds 150 feet unless the vehicle is traveling on a limited access facility, then only one qualified escort is required." This is one of only two places in the whole chapter where the road class changes the escort COUNT rather than the escort position.',
    },
  ),
  escortRule(
    'fl-length-over-250',
    'Over 250 ft long — one law-enforcement escort and one qualified escort',
    { kind: 'gt', measure: 'overallLengthIn', value: ftIn(250) },
    {
      escorts: 1,
      rear: 1,
      policeFront: 1,
      manualReview:
        'FAC 14-26.012(9): "One law enforcement escort and one qualified escort are required when the length exceeds 250 feet." Florida publishes no law-enforcement escort rate anywhere in FHP Policy 5.10, FAC 14-26, FS 316.550 or on FDOT\'s permit pages, and FHP treats commercial overdimensional escorts as off-duty police employment requiring troop-commander approval, an Escort Safety Plan (HSMV 61199), a release of liability, five working days\' notice and at least two marked patrol vehicles. No police-escort amount is included and none can be estimated.',
    },
  ),

  // ── The unknowns that move a priced line ────────────────────────────────
  /**
   * MATERIAL UNKNOWN. Table 1B rows (h) and (i) price the load "Per 1,000
   * Pounds Per Mile" without saying which pounds. On a 170,000 lb load over 100
   * miles the gross reading gives 170 × $0.003 × 100 = $51 and the excess
   * reading gives 90 × $0.003 × 100 = $27 — the same row, read two ways, and
   * nearly a factor of two apart. No rate is held above 162,000 lb.
   */
  escortRule(
    'fl-over-162000-rate-basis-unknown',
    'Over 162,000 lb — the published rate does not say which pounds it multiplies',
    { kind: 'gt', measure: 'grossWeightLbs', value: 162000 },
    {
      manualReview:
        'Florida prices this load with Table 1B rows "(h) Up to 199,000 pounds. $0.003 Per 1,000 Pounds Per Mile" and "(i) Over 199,000 pounds. $0.003 Per 1,000 Pounds Per Mile", and the rule never states whether the 1,000-pound figure is the GROSS weight or the weight OVER LEGAL, nor how the pounds or the miles round. The two readings differ by nearly a factor of two on a load this heavy, so no rate is on file above 162,000 lb and no overweight amount is quoted. Note also that the $3.33 administrative cost is written for rows "(2)(a) through (h)" and row (i) is outside that bracket, that multi-trip permits are NOT ISSUED over 199,000 lb, and that FDOT\'s self-issue system stops at 200,000 lb (140,000 lb for self-propelled equipment) above which the Permit Office handles the application by hand.',
    },
    FAC_14_26_008,
    EFF_RULE,
  ),
  /**
   * MATERIAL UNKNOWN. Table 1B's asterisk footnote says a dimensional fee is
   * added and caps the combined total at $500 — without stating the dimensional
   * fee's amount. The natural reading is Table 1A's band, which is what the
   * engine computes, but the rule does not say so and the $500 cap is not
   * applied because nothing in the model can hold it.
   */
  escortRule(
    'fl-combined-dimension-fee-unstated',
    'Overweight and over 12 ft wide, 13 ft 6 in high or 85 ft long — the rule adds a dimensional fee without saying how much',
    {
      kind: 'all',
      of: [
        { kind: 'gt', measure: 'grossWeightLbs', value: 80000 },
        {
          kind: 'any',
          of: [
            { kind: 'gt', measure: 'widthIn', value: W12 },
            { kind: 'gt', measure: 'heightIn', value: H13_6 },
            { kind: 'gt', measure: 'overallLengthIn', value: L85 },
          ],
        },
      ],
    },
    {
      manualReview:
        'Table 1B carries the footnote "*Dimensions greater than 12 feet wide or 13 feet 6 inches high or 85 feet long will have an additonal dimension fee with a combined fee of not to exceed $500.00" — the rule\'s own spelling. It does not state the amount of that dimensional fee. The total above adds the Table 1A band, which is the natural reading and the only figure Florida publishes, but the rule does not say so in terms, and the $500 combined cap has NOT been applied because no amount in this model can express it. Confirm the combined fee with the Permit Office before billing.',
    },
    FAC_14_26_008,
    EFF_RULE,
  ),
  /**
   * MATERIAL UNKNOWN. The $5.00 transmission fee is in the trip-permit column
   * and "NOT APPLICABLE" for the other two, and the worked example adds it "when
   * applicable" — a condition the rule never defines. On a $5 permit it is the
   * whole fee again.
   */
  escortRule(
    'fl-transmission-fee-applicability',
    'The $5.00 transmission fee is charged "when applicable" and the rule never says when',
    PERMIT_LIKELY,
    {
      manualReview:
        'The $5.00 transmission fee in the total above comes from Table 1B\'s "(3) SPECIAL PERMIT FEES Transmission Fee $5.00", which is priced for trip permits and NOT APPLICABLE for multi-trip and route-specific multi-trip ones. The fee rule then adds it "when applicable" without ever defining when — whether a permit self-issued through PAS incurs it, or only one transmitted by fax or wire service, is not stated anywhere. On a $5.00 minimum permit that is a hundred per cent of the fee. It is included here because the trip-permit column prices it; a self-issued permit may be $5.00 cheaper.',
    },
    FAC_14_26_008,
    EFF_RULE,
  ),

  // ── Conflicts between the rule and FDOT's 2026 operational conditions ────
  escortRule(
    'fl-escort-position-divided-conflict',
    'A single over-width escort on an undivided four-lane road — the rule says "four lane divided" and FDOT’s 2026 conditions say "four lane"',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: ['multilane-undivided'] },
        { kind: 'gt', measure: 'widthIn', value: W12 },
      ],
    },
    {
      advisory:
        'FAC 14-26.012(4) positions a single over-width escort so that it "shall precede the load on two lane highways or follow the load on four lane divided highways". FDOT\'s Blanket Permit Movement Conditions, revised July 27 2026, drop the word divided: "follow the load on four lane highways". On an undivided four-lane road the rule points to the front and the operational conditions point to the rear. The escort COUNT is one either way, so the price is unaffected and neither reading has been adopted.',
    },
    FDOT_2026_CONDITIONS,
    EFF_2026_CONDITIONS,
  ),
  escortRule(
    'fl-keys-escort-condition',
    'Over 10 ft wide — FDOT’s 2026 conditions add a Florida Keys escort the rule does not contain',
    { kind: 'gt', measure: 'widthIn', value: ftIn(10) },
    {
      advisory:
        'FAC 14-26.012(7)(b) requires no escort at all between 10 and 12 feet of width. FDOT\'s Blanket Permit Movement Conditions of July 27 2026 add one for part of the state: "FLORIDA KEYS (South of Florida City): Movement is only permitted between the hours from 9:00 PM to 5:00 AM for vehicles over 10’ wide. Movement is not permitted on holidays. Movement requires a minimum of one (1) Qualified Escort." A quote does not know whether the route runs south of Florida City, so no Keys escort has been added and none has been ruled out.',
    },
    FDOT_2026_CONDITIONS,
    EFF_2026_CONDITIONS,
  ),
  escortRule(
    'fl-route-survey-conflicts',
    'Route survey — the rule and FDOT’s 2026 conditions disagree about who performs it and when the letter must be carried',
    PERMIT_LIKELY,
    {
      advisory:
        'Florida requires a route survey before ANY movement under permit — FAC 14-26.00411(5): "No movement shall be made under any permit until the route has been surveyed" — and the survey is the applicant\'s to perform and pay for, so no survey cost is a state charge or appears in the total. Two disagreements survive. First, the rule makes the APPLICANT responsible and says nothing about who does the work, while FDOT\'s July 2026 conditions add that "the survey must be performed by a qualified escort as described in FAC 14-26.012(2)" — a requirement that is not in the rule and that changes who can be hired. Second, the rule requires the survey letter to be "maintained with the load during movement" on every permitted move, while the 2026 conditions require it on board only "When the load exceeds 15 feet in height and/or 16 feet in width". Neither has been adopted. The 6-inch vertical and 2-foot-per-side horizontal margins apply above 15 ft high and 16 ft wide respectively; applications above 18 ft high or 22 ft wide must be supported by the survey letter, which FAC 14-26.012 elsewhere calls an affidavit.',
    },
    FDOT_2026_CONDITIONS,
    EFF_2026_CONDITIONS,
  ),
  escortRule(
    'fl-tandem-axle-limit-unknown',
    'Florida publishes no figure labelled "tandem axle", and its two candidates differ by 6,000 lb',
    { kind: 'gt', measure: 'grossWeightLbs', value: 80000 },
    {
      advisory:
        'Neither FS 316.535 nor FAC 14-26 uses the word "tandem". The statute\'s axle-spacing table gives 40,000 lb for a first-to-last axle distance of 4 to 8 feet, while the federal formula the same statute adopts in subsections (4) and (5) gives 34,000 lb for two axles 4 feet apart, and the statute says the formula applies "in all cases in which it exceeds state law in effect on January 4, 1975". Both figures are recorded and neither has been adopted. FS 316.545(2)(a) separately builds a 10-percent scale tolerance into the published weight tables, and permit weights "shall be deemed to include all allowable tolerances", so a Florida permit weight is not directly comparable with a neighbouring state\'s.',
    },
    FS_316_535,
    RETRIEVED,
  ),
  escortRule(
    'fl-structural-evaluation-trigger',
    'Any axle over 30,000 lb, or 300,000 lb gross — a structural evaluation is required',
    { kind: 'gte', measure: 'grossWeightLbs', value: 300000 },
    {
      routeSurvey: true,
      manualReview:
        'FAC 14-26.00411(6): "a schematic of the vehicle showing all longitudinal and transverse spacings, axle weights and dimensions must be provided at least ten business days before a proposed move when any axle exceeds 30,000 pounds, or when the vehicle\'s gross weight is 300,000 pounds or more", and an Office of Maintenance Bridge Section engineer may require one below 300,000 lb as well. Florida does not call this a superload — the rule chapter distinguishes only a "Routine Permit" from a non-routine one — and it publishes NO separate structural-evaluation fee. The per-axle half of the trigger is not evaluated here because a quote does not always carry the axle schedule.',
    },
    FAC_14_26_00411,
    EFF_RULE,
  ),
  escortRule(
    'fl-nighttime-and-override',
    'Nighttime movement and loads outside the rule’s limits both bring requirements a quote cannot price',
    { kind: 'gt', measure: 'widthIn', value: ftIn(10) },
    {
      advisory:
        'A permitted move at night is available only when District Traffic Engineering recommends it or the Office of Maintenance requires it, and then only with law-enforcement escorts and warning lights delineating the shape and size of the load (FAC 14-26.012(7)(f)). A load outside the chapter\'s limits altogether needs override authority, which under FAC 14-26.00425 requires "a letter of essentiality from a government entity or the ultimate recipient of an essential service" — and "A letter from the hauler, distributor, or manufacturer will not be accepted." Neither is a fee, and neither is included above. Governmental entities, special taxing districts, the Seminole Tribe, movers of portable public-school buildings, oversize implements of husbandry, and movements under a Governor\'s Declaration of Emergency are exempt from permit fees entirely under FAC 14-26.009.',
    },
    FAC_14_26_00425,
    EFF_CRITERIA,
  ),
  escortRule(
    'fl-qualified-escort-requirements',
    'Escorts on this move must be Florida-qualified, and Florida does not publish which other states it accepts',
    { kind: 'gt', measure: 'widthIn', value: W12 },
    {
      advisory:
        'FAC 14-26.012(2)(c) requires a qualified escort to be 18 or older with a valid licence, to have completed an eight-hour National Safety Council defensive-driving course or hold a Class A, B or C CDL, to have completed an eight-hour pilot/escort flagging course from a Department vendor, to carry the qualification documents, and to requalify every four years on a four-hour refresher. An out-of-state escort is accepted only if that state\'s standards are "equal or more stringent" and the qualification is within four years — and Florida does not publish which states those are. Florida also publishes no course fee: the tuition charged by FDOT\'s approved vendor is a vendor price, not a state fee, and is not in the total. The escort vehicle itself must be a single unit rated at least 2,000 lb and under 26,000 lb, with company identification, Class 2 amber lights, an OVERSIZE LOAD sign and two 18-inch flags.',
    },
    FDOT_PAS,
    RETRIEVED,
  ),
];

// ── The jurisdiction ──────────────────────────────────────────────────────

export const FLORIDA_OSOW_RULES: JurisdictionOsowRules = {
  code: 'FL',
  name: 'Florida',
  country: 'US',

  legalLimits: {
    widthIn: [
      fromUndated(
        102,
        FS_316_515,
        'FS 316.515(1). The same subsection lets FDOT or a local authority restrict vehicles over 96 inches on roads without at least one 12-foot through lane in each direction — a route-specific restriction rather than a statewide limit, so it is not applied here; FDOT\'s own permit guidance repeats it as "exceeds 102" or exceeds 96" on less than 12\' wide travel lane".',
      ),
    ],
    heightIn: [
      fromUndated(
        H13_6,
        FS_316_515,
        'FS 316.515(2): "No vehicle may exceed a height of 13 feet 6 inches, inclusive of load carried thereon. However, an automobile transporter may measure a height not to exceed 14 feet." The transporter allowance is not applied because a quote does not collect the body style.',
      ),
    ],
    /**
     * CONFLICT, AND IT COSTS A REVIEW FLAG ON EVERY FLORIDA QUOTE.
     *
     * FS 316.515(3)(b)2 allows a semitrailer "more than 48 feet but not more
     * than 57 feet" when the kingpin-to-rear-axle distance is 41 feet or less.
     * FAC 14-26.008's Table 1A(1)(b) prices semitrailers "which exceed 53 feet
     * In Length up to 57 feet 6 inches in length", and FAC 14-26.012(11)(c)
     * allows "a trailer length up to 57 feet 6 inches". One statute against two
     * rules, six inches apart, and it decides whether a 57 ft 3 in trailer is
     * legal or over.
     *
     * Filed as a conflict rather than resolved, so the resolver reports the
     * 57 ft to 57 ft 6 in spread and refuses to state a limit. The 48-foot base
     * is deliberately NOT a third candidate: it is not a competing claim about
     * the maximum, it is the floor above which the kingpin condition applies,
     * and a quote does not collect the kingpin distance.
     */
    trailerLengthIn: [
      fromUndated(
        ftIn(57),
        FS_316_515,
        'FS 316.515(3)(b)2: a semitrailer "which is more than 48 feet but not more than 57 feet in extreme overall outside dimension ... may operate on public roads ... if ... The distance between the kingpin ... and the center of the rear axle or rear group of axles does not exceed 41 feet". The 48 ft base in (b)1 is the floor above which that condition bites, not a competing maximum.',
      ),
      fromDated(
        ftIn(57, 6),
        FAC_14_26_008,
        EFF_RULE,
        'Table 1A(1)(b) fees overlength semitrailers "which exceed 53 feet In Length up to 57 feet 6 inches in length", and FAC 14-26.012(11)(c) allows "a trailer length up to 57 feet 6 inches". Six inches longer than the statute permits.',
      ),
    ],
    /**
     * `overallLengthIn` is ABSENT, and Florida says so itself: FS 316.515(3),
     * "Except as otherwise provided in this section, length limitations apply
     * solely to a semitrailer or trailer, and not to a truck tractor or to the
     * overall length of a combination of vehicles." A straight truck is capped
     * at 40 ft and a truck-trailer combination at 68 ft, but neither is the
     * configuration these quotes price.
     */
    frontOverhangIn: [
      fromUndated(
        ftIn(3),
        FS_316_515,
        'FS 316.515(4). A stinger-steered automobile transporter may carry 4 ft; the body style is not collected, so the general limit is used.',
      ),
    ],
    /**
     * `rearOverhangIn` is ABSENT as a positive finding: FS 316.515 states no
     * rear-overhang limit for general freight at all. What Florida regulates
     * instead is lighting and night movement — a warning light on top over 4 ft
     * of overhang with two red lamps and two red reflectors at the extreme rear,
     * and a 10-foot cap on rear overhang during NIGHTTIME movement under FAC
     * 14-26.012(9)(a)1 — and overhang otherwise counts toward the overall length
     * the escort thresholds are read against. An empty list would have claimed we
     * looked for a limit and found nothing; there is none to find.
     */
    grossWeightLbs: [
      fromUndated(
        80000,
        FS_316_535,
        'FS 316.535: "Such overall gross weight of any vehicle or combination of vehicles may not exceed 80,000 pounds, including all enforcement tolerances." The same formula and cap appear in subsection (4) for the Interstate and (5) off it.',
      ),
    ],
    singleAxleLbs: [
      fromUndated(
        20000,
        FS_316_535,
        'FS 316.535(1). FS 316.545(2)(a) builds a 10-percent scale tolerance into the published weight tables, and permit weights "shall be deemed to include all allowable tolerances".',
      ),
    ],
    /**
     * TWO CANDIDATES THAT DISAGREE BY 6,000 LB, filed as the conflict they are.
     * Florida never uses the word "tandem": the statutory table gives 40,000 lb
     * for a 4-to-8-foot axle group and the federal formula the same statute
     * adopts gives 34,000 lb for two axles at 4 feet. The engine does not test
     * axle-group weights against these rows, so the conflict costs no warning on
     * a quote; `fl-tandem-axle-limit-unknown` states it where it matters.
     */
    tandemAxleLbs: [
      fromUndated(
        40000,
        FS_316_535,
        'FS 316.535(3) table, rows "4..........40,000" through "8..........40,000" for the distance between the first and last axle. The statute does not label this a tandem limit.',
      ),
      fromUndated(
        34000,
        FS_316_535,
        'The federal formula W = 500((LN ÷ (N–1)) + 12N + 36) at L=4, N=2, which FS 316.535(4) and (5) apply "in all cases in which it exceeds state law in effect on January 4, 1975".',
      ),
    ],
  },

  /**
   * A SOURCED ZERO. Florida charges no issuance amount on top of its two tables
   * — Table 1A carries the whole dimensional charge and Table 1B the whole
   * weight charge — so the engine suppresses the empty line rather than printing
   * "$0.00" beside a real fee. FS 316.550(6)'s "$5" is a MINIMUM for issuing a
   * permit, not an addition to one, and Table 1A's own bottom row is that $5.
   */
  permitBaseFeeUsd: [
    fromDated(
      0,
      FAC_14_26_008,
      EFF_RULE,
      'FAC 14-26.008 sets out Tables 1A and 1B and no separate base or issuance charge. FS 316.550(6): "The minimum fee for issuing any such permit shall be $5." — a floor that Table 1A\'s $5 row already meets, not an amount added to the tables.',
    ),
  ],

  oversizeFeeBands,

  overweightPricing: [
    fromDated<OverweightPricing>(
      {
        kind: 'perMile',
        explanation:
          'FAC 14-26.008 Table 1B prices the overweight trip permit per mile at a rate stepped by gross weight, from $0.27 up to 95,000 lb to $0.47 up to 162,000 lb, then "$0.003 Per 1,000 Pounds Per Mile" above that. Miles are billed in 25-mile increments rounded up, a $3.33 administrative cost is added for weights over 80,000 lb, and the result is rounded up to the nearest dollar. Florida prices the oversize and overweight components separately and adds them, subject to a combined cap the rule states but does not quantify.',
      },
      FAC_14_26_008,
      EFF_RULE,
    ),
  ],

  /** Florida steps by distance, not by flat weight bands. */
  overweightBands: [],

  overweightPerMile,

  /**
   * EMPTY, AS A FINDING, and specifically NOT the place for the $3.33. That
   * administrative cost is inside the per-mile arithmetic — the rule's own
   * example computes "(75 miles X $0.32) plus $3.33 = $27.33 rounded up to
   * $28.00" — so holding it here would add it a second time and, worse, add it
   * outside the rounding where it produces a different number.
   */
  conditionalFees: [],

  transactionFee: [
    fromDated<TransactionFee>(
      { perPermitUsd: 5, percentOfTotal: 0 },
      FAC_14_26_008,
      EFF_RULE,
      'Table 1B "(3) SPECIAL PERMIT FEES Transmission Fee $5.00", priced in the TRIP PERMIT column and NOT APPLICABLE for multi-trip permits. No percentage surcharge appears anywhere in FAC 14-26; third-party wire-service charges are expressly excluded from the $3.33 by the rule\'s own wording. When the fee is "applicable" is not defined — see `fl-transmission-fee-applicability`.',
    ),
  ],

  /**
   * EMPTY, AND THE EMPTINESS IS THE FINDING. Florida publishes NO
   * structural-evaluation fee: FAC 14-26.008 contains no such row, and the
   * evaluation itself is triggered by FAC 14-26.00411(6) without a charge
   * attached. The route survey is performed and paid for by the applicant, so it
   * is not a state charge either.
   */
  routeAnalysisFeeUsd: [],
  noBridgeRouteFeeUsd: [],

  superload: {
    /**
     * `grossWeight` ABSENT, as a positive finding, AND IT KEEPS FLORIDA OUT OF
     * THE WIDGET'S WEIGHT-CEILING MIRROR ON PURPOSE.
     *
     * Florida has no superload class. FAC 14-26.0041(26) distinguishes only a
     * "Routine Permit" — one "that did not require a structural evaluation,
     * local movement restrictions, or override authorization" — from everything
     * else, and no rule states a gross weight above which a permit stops being
     * issued over the counter. The 300,000 lb figure Florida does publish is a
     * documentation trigger for a schematic and a bridge review, and a 250,000 lb
     * load is still an ordinary trip permit priced by Table 1B row (i).
     *
     * Mirroring 300,000 lb to the widget would therefore let the client accept a
     * 250,000 lb Florida quote that the SERVER refuses, because no rate is held
     * above 162,000 lb. Absent here means the federal 80,000 lb contact-us
     * ceiling stands for Florida lanes, which is the honest client-side answer.
     */
    shortSpacing: [],
    /**
     * No dimensional superload triggers either, for the same reason: the width
     * and height bands above 16 feet tighten the escort and movement conditions
     * without changing the permit class or the fee, which stays at $25.
     */
  },

  /**
   * Florida's survey obligations are keyed on height and width and nothing else.
   * The rule requires a survey before every permitted move, and the LETTER must
   * be carried — with a 6-inch vertical margin above 15 ft and a 2-foot
   * horizontal margin each side above 16 ft — which is the closest thing Florida
   * publishes to an inspection trigger. `lengthIn` is empty rather than guessed.
   */
  routeInspection: {
    widthIn: [
      fromDated<Threshold>(
        { value: ftIn(16), inclusive: false },
        FAC_14_26_00411,
        EFF_RULE,
        'The survey letter must verify "2 feet on each side for width greater than 16 feet". Applications over 22 ft wide must be supported by the letter. The survey is the applicant\'s cost, not a state charge.',
      ),
    ],
    heightIn: [
      fromDated<Threshold>(
        { value: ftIn(15), inclusive: false },
        FAC_14_26_00411,
        EFF_RULE,
        'The survey letter must verify "clearances exceed the requested permitted dimension by a minimum of 6 inches for height greater than 15 feet". Applications over 18 ft high must be supported by the letter.',
      ),
    ],
    lengthIn: [],
  },

  escortRules: FLORIDA_ESCORT_RULES,

  /** Table 1B is a per-mile rate on miles travelled inside Florida. */
  feesDependOnDistance: true,
};

/** Cited for FHP's escort mechanism and for the absence of any published rate. */
export const FLORIDA_POLICE_ESCORT_SOURCE = FHP_510;

/** Cited for the fee floor and the blanket-permit cap. */
export const FLORIDA_PERMIT_FEE_STATUTE = FS_316_550;

/** Cited for the scale tolerance built into every published Florida weight. */
export const FLORIDA_SCALE_TOLERANCE_SOURCE = FS_316_545;
