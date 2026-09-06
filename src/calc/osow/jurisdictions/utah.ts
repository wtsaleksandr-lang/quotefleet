/**
 * UTAH — oversize/overweight single-trip permit rules.
 *
 * THREE ROUNDING DIRECTIONS ON ONE FEE, AND A POUND BASIS WORTH FORTY PER CENT.
 * ═══════════════════════════════════════════════════════════════════════════
 * Utah Code § 72-7-406(7) is the only fee in this corpus that publishes its own
 * partial-increment treatment three times over, and the three do not all run
 * the same way:
 *
 *   (c)(i)   "The MILES used to calculate the fee under this Subsection (7)
 *            shall be rounded UP to the nearest 50 mile increment."
 *   (c)(ii)  "The POUNDS used to calculate the fee under this Subsection (7)
 *            shall be rounded UP to the nearest 25,000 pound increment."
 *   (c)(iii) "The department shall round the DOLLAR amount used to calculate
 *            the fee under this Subsection (7) to the NEAREST $10 increment."
 *
 * Two round up and the third rounds to nearest, in the same sentence group.
 * A computed $184 becomes $180, not $190, and a 205-mile lane is billed as 250.
 * `RoundingRule` carries the direction and the step; `PerMileRate.roundMilesUpTo`,
 * `roundPoundsTo` and `roundDollarsTo` carry the three.
 *
 * AND THE POUND BASIS IS GENUINELY AMBIGUOUS. (b)(i) sets the fee at "$.012 per
 * mile for each 1,000 pounds ABOVE 80,000 pounds"; (c)(ii) then rounds "THE
 * POUNDS", unqualified, and never says whether that is the gross weight or the
 * excess over 80,000 lb. At 126,000 lb over 300 miles the two readings are
 * $180 and $250 — the excess reading rounds 46,000 lb up to 50,000 and charges
 * 50 increments; the gross reading rounds 126,000 lb up to 150,000 and charges
 * 70. Reading A has the better textual argument, because (b)(i) defines the fee
 * base as the excess and "the pounds used to calculate the fee" is most
 * naturally that same quantity. That is an argument, not an answer. BOTH
 * READINGS ARE ON FILE AS TWO `PerMileRate` ROWS DIFFERING ONLY IN
 * `roundPoundsTo.appliesTo`, the resolver refuses to pick, and the quote shows
 * the honest spread. Note that the $80 floor masks the divergence on short
 * lanes — at 50 miles both readings floor to $80 and resolve cleanly — which is
 * the state's own arithmetic doing the disambiguation, not ours.
 *
 * THE FEE SCHEDULE HAS ONE SOURCE AND NO CROSS-CHECK.
 * --------------------------------------------------
 * Utah Admin. Code R909-2 — 1,160 lines, thirty-three sections, the state's
 * operational size-and-weight rule — contains NO fee schedule at all. Every
 * dollar figure below comes from Utah Code § 72-7-406 and nothing corroborates
 * it. That is the opposite of South Carolina, where statute and agency
 * guidelines reprint the same table line for line, and it is recorded so a
 * reader does not mistake a single row for a resolved one.
 *
 * $30, $60, OR THE FORMULA — AND THEY REPLACE EACH OTHER.
 * ------------------------------------------------------
 * Utah issues three different single-trip products and a load takes exactly
 * one:
 *
 *   § 72-7-406(5)(b) — oversize only ................................. $30
 *   § 72-7-406(6)(b) — oversize AND overweight, up to 125,000 lb ..... $60
 *   § 72-7-406(7)(b) — oversize AND overweight, above 125,000 lb ..... formula
 *
 * The $60 does not ADD to the $30 and the formula does not add to either, so
 * `combinedFeeRule` is `overweightOnly` and `permitBaseFeeUsd` is a SOURCED
 * ZERO with the $30 held as the (single, unbounded) oversize band. That is the
 * Pennsylvania/Illinois decomposition: the band carries the whole oversize
 * charge and the base records that nothing sits on top of it.
 *
 * THE (6)-vs-(7) OVERLAP IS A REAL DRAFTING DEFECT AND IT IS RECORDED.
 * § 72-7-406(7)(a) is drafted disjunctively — a single-trip permit may issue
 * for a load that exceeds "(i) one or more of the maximum weight provisions of
 * Section 72-7-404; OR (ii) a gross weight of 125,000 pounds" — so limb (i) has
 * no upper bound and a 100,000 lb load qualifies under both subsections, at $60
 * under (6) or a minimum of $80 under (7). This file adopts the reading that
 * (6) governs at or below 125,000 lb and (7) above it, because the alternative
 * makes (6) entirely redundant and because (6)(a)'s "up to a gross weight of
 * 125,000 pounds" is an express ceiling — and because the $80 floor sitting
 * ABOVE the $60 flat fee is the arithmetic proving the two are alternative
 * products rather than a menu. The divergence is surfaced on every load it can
 * reach; see `ut-subsection-6-7-overlap`.
 *
 * ESCORT COUNTS COMBINE AS "THE MOST STRINGENT REQUIREMENT", NOT ADDITIVELY.
 * -------------------------------------------------------------------------
 * R909-2-14(1)(b): "A motor carrier shall follow the most stringent requirement
 * that applies in Table 3." Where Texas adds a front and a rear car once a load
 * is over in two dimensions, Utah takes the single heaviest published
 * requirement and treats the others as satisfied by it. That is
 * `EscortCountCombination.kind: 'mostStringent'`, recorded from the state's own
 * words, and on a load that trips two of Utah's rows the two readings differ by
 * a whole pilot car.
 *
 * UTAH PUBLISHES A REAL POLICE TRIGGER AND NO POLICE RATE.
 * -------------------------------------------------------
 * Table 3 row 3 is a dimensional, road-class-differentiated police-escort
 * trigger — "Greater than: 20' in width; or 175' in length; or 17'6" of height
 * — 2 pilot escorts and at least 2 police escorts" on a freeway, and the same
 * at 17 ft of width on a secondary highway. That is rarer than it sounds: most
 * states publish neither. What Utah does not publish is what the Highway Patrol
 * charges — R909-2-16(4)(e) says only "the permittee will assume all costs when
 * a certified police escort or escorts are required", and R909-2-14(1)(c) puts
 * the count itself outside UDOT's hands: "The number of police escorts required
 * is determined by the Utah Highway Patrol". The trigger and the absent rate
 * are recorded SEPARATELY, and the $40 figure UDOT does publish is for a UDOT
 * EMPLOYEE and vehicle, not for police — conflating the two would be the
 * easiest wrong number in the state.
 *
 * TABLE 3 WAS RECONSTRUCTED FROM PIXEL OFFSETS. TRUST THIS TRANSCRIPTION.
 * ----------------------------------------------------------------------
 * R909-2-14 Table 3 is four columns (Daylight/Freeway, Daylight/Secondary,
 * Non-Daylight/Freeway, Non-Daylight/Secondary) by three rows, and a plain-text
 * extraction flattens all four cells of a row into one stream with no column
 * markers — which assigns "Up to 12' in width — 1 pilot escort" to the wrong
 * road class. The cells below were reconstructed from the official HTML's own
 * absolute `left` values (column origins at 0, 93, 186.75 and 287.25 pt) and
 * the column headers at those same offsets. A future re-fetch must not silently
 * regress to the flattened reading.
 *
 * BOUNDARY OPERATORS ARE NOT UNIFORM INSIDE ONE TABLE. The daylight cells are
 * EXCLUSIVE ("Greater than: 14' in width") and the non-daylight cells are
 * INCLUSIVE ("12' to 14' in width", "Up to 12' in width"). Both are encoded as
 * printed.
 *
 * WHAT IS DELIBERATELY ABSENT OR EMPTY
 * ------------------------------------
 *   - `legalLimits.overallLengthIn` is ABSENT, on a CLEAN PUBLISHED NEGATIVE
 *     rather than a gap: § 72-7-402(4)(b)(ii) states "There is no overall
 *     length limitation on a truck tractor and semitrailer combination when the
 *     semitrailer length is 53 feet or less." The 65 ft figure in (4)(d) is for
 *     "all other combinations", and recording it here would flag every ordinary
 *     tractor-semitrailer in the state as over-length.
 *   - `superload.grossWeight` is ABSENT. The word "superload" appears nowhere
 *     in R909-2 (all thirty-three sections read) nor in §§ 72-7-402, 72-7-404,
 *     72-7-406 or 72-7-407. What Utah has instead is a PROCESSING QUEUE, and
 *     the fee does not change: the heaviest imaginable Utah load still pays the
 *     § 72-7-406(7) formula capped at $540. See `publishedAbsences`.
 *   - `routeInspection` is EMPTY on all three axes. UDOT's undated page says
 *     "Loads exceeding 18' in height MAY BE REQUIRED to submit a route survey",
 *     which is a discretion and not a trigger, and the word "survey" does not
 *     appear in R909-2 at all. Recording 18 ft as a threshold would assert a
 *     mandatory requirement Utah does not publish; it is carried as an advisory
 *     instead.
 *   - `routeAnalysisFeeUsd` / `noBridgeRouteFeeUsd` are EMPTY. No fee is
 *     published for the UDOT Structures Division dual-lane clearance, and the
 *     one dollar figure in the chain — "$40.00, or the full cost of a
 *     department employee and vehicle, whichever is greater" — is a floor on an
 *     open-ended escort charge, not a review fee.
 *
 * DATE DISCIPLINE
 * ---------------
 *   - R909-2 self-stamps "Effective Date: 03/16/2026" and is the freshest
 *     primary operational document in this corpus. A copy dated 2021 is still
 *     served at trucksmart.udot.utah.gov and carries a superseded escort table
 *     with no indication that it is superseded; it is not used.
 *   - § 72-7-406's page prints no effective banner, only "Amended by Chapter
 *     457, 2024 General Session", so `revisedOn` is the bare year 2024 —
 *     precision the source does not have is not invented.
 *   - Every UDOT web page used here is undated; the "Copyright © 2026 State of
 *     Utah" footer is a render stamp. Four things exist ONLY on those pages:
 *     "ALL SALES ARE FINAL", the $40 department-escort minimum, the 300,000 lb
 *     processing threshold and the 18 ft route-survey discretion.
 */
import type { SourceDoc, Sourced } from '../provenance.js';
import { ftIn, type EscortCountCombination, type EscortRule } from '../escortRules.js';
import type { ContextCondition, RouteVocabulary } from '../routeContext.js';
import type {
  CombinedFeeRule,
  FeeDistanceDependence,
  JurisdictionOsowRules,
  OversizeFeeBand,
  OverweightPricing,
  PerMileRate,
  PublishedAbsence,
  RoundingRule,
  TransactionFee,
} from '../types.js';

const RETRIEVED = '2026-09-05';

// ── Source documents ──────────────────────────────────────────────────────

const UT_72_7_402: SourceDoc = {
  id: 'ut-code-72-7-402',
  title: 'Utah Code § 72-7-402 — Width, height, and length limitations',
  url: 'https://le.utah.gov/xcode/Title72/Chapter7/72-7-S402.html',
  publisher: 'Utah State Legislature',
  revisedOn: '2017-05-09',
  retrievedOn: RETRIEVED,
  cite: 'page header "Effective 5/9/2017"; "Amended by Chapter 96, 2017 General Session"',
};

const UT_72_7_404: SourceDoc = {
  id: 'ut-code-72-7-404',
  title: 'Utah Code § 72-7-404 — Maximum weight limitations and bridge formula',
  url: 'https://le.utah.gov/xcode/Title72/Chapter7/72-7-S404.html',
  publisher: 'Utah State Legislature',
  revisedOn: '2019-05-14',
  retrievedOn: RETRIEVED,
  cite: 'page header "Effective 5/14/2019"; "Amended by Chapter 251, 2019 General Session"',
};

const UT_72_7_406: SourceDoc = {
  id: 'ut-code-72-7-406',
  title: 'Utah Code § 72-7-406 — Permits for excess size and weight',
  url: 'https://le.utah.gov/xcode/Title72/Chapter7/72-7-S406.html',
  publisher: 'Utah State Legislature',
  revisedOn: '2024',
  retrievedOn: RETRIEVED,
  cite: '"Amended by Chapter 457, 2024 General Session"; the page prints no effective-date banner, so the amendment session is the finest date available. THE ONLY SOURCE FOR ANY UTAH FEE — R909-2 publishes none.',
};

const R909_2: SourceDoc = {
  id: 'ut-adm-r909-2',
  title: 'Utah Admin. Code R909-2 — Motor carrier size, weight, and permit rules',
  url: 'https://adminrules.utah.gov/public/rule/R909-2/Current%20Rules',
  publisher: 'Utah Department of Transportation',
  revisedOn: '2026-03-16',
  retrievedOn: RETRIEVED,
  cite: '"Effective Date: 03/16/2026"; "Date of Last Change: March 16, 2026"; "Notice of Continuation: April 30, 2024". Table 3 (escorts) was reconstructed from the official HTML\'s absolute pixel offsets — see the module header.',
};

const UDOT_PROVISIONS: SourceDoc = {
  id: 'udot-osow-provisions',
  title: 'UDOT — Oversize & Overweight Provisions',
  url: 'https://connect.udot.utah.gov/business/motor-carriers/size-weight-permitting/oversize-overweight-provisions/',
  publisher: 'Utah Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'undated; the only date on the page is a "Copyright © 2026 State of Utah" footer, which is a render stamp',
};

const UDOT_NON_DIVISIBLE: SourceDoc = {
  id: 'udot-oversize-non-divisible-provisions',
  title: 'UDOT — Oversize Non-Divisible Load Provisions',
  url: 'https://connect.udot.utah.gov/business/motor-carriers/size-weight-permitting/oversize-overweight-provisions/oversize-non-divisible-load-provisions/',
  publisher: 'Utah Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
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

function fromUndatedPage<T>(value: T, source: SourceDoc, note?: string): Sourced<T> {
  return {
    value,
    source,
    effectiveFrom: RETRIEVED,
    effectiveTo: null,
    ...(note === undefined ? {} : { note }),
  };
}

const RULE_FROM = '2026-03-16';
/**
 * § 72-7-406's page prints no effective-date banner, only "Amended by Chapter
 * 457, 2024 General Session", so `revisedOn` stays the bare year. `effectiveFrom`
 * needs a real day, and Utah publishes the default: Utah Code § 68-3-3 provides
 * that an act takes effect sixty days after the adjournment sine die of the
 * session that passed it unless the act says otherwise, and the 2024 General
 * Session adjourned on 1 March 2024. 1 May 2024 is that date, and it errs LATE
 * rather than early — a quote backdated inside the gap finds nothing on file
 * and asks, instead of pricing from a row that had not commenced.
 */
const FEE_FROM = '2024-05-01';

// ── Route vocabulary — four published names for two classes ───────────────

/**
 * UTAH'S ROAD VOCABULARY IS NOT SELF-CONSISTENT AND EACH TERM DECIDES AN ESCORT
 * COUNT. R909-2-14 Table 3 uses "Freeway" and "Secondary Highway"; R909-2-16(4)
 * uses "two-lane routes" and "interstates" for what is evidently the same
 * 17 ft / 20 ft threshold pair; UDOT's page uses "secondary highways" and
 * "freeways" and adds a 175 ft length trigger the regulation omits. FOUR TERMS,
 * TWO CLASSES, AND NONE OF THE FOUR IS DEFINED IN R909-2-3. Both published
 * spellings are preserved on each class rather than normalised away.
 */
const UTAH_ROUTE_VOCABULARY: RouteVocabulary = {
  name: 'Utah Admin. Code R909-2-14 Table 3 road classes',
  explanation:
    'Utah publishes four names for what is evidently two road classes and uses different pairs in different sections for the same rule: R909-2-14 Table 3 says "Freeway" and "Secondary Highway"; R909-2-16(4) says "interstates" and "two-lane routes"; UDOT\'s own page says "freeways" and "secondary highways" and adds a 175 ft length trigger R909-2-16(4) omits. NONE of the four is defined in R909-2-3, so a four-lane divided US highway is plainly not a "two-lane route" and it is not stated whether it is a Freeway or a Secondary Highway — and the answer decides whether an 18 ft wide load needs two police escorts. Both spellings are carried on each class. NOTE THE ASYMMETRY WITH WEIGHT: unlike Kansas and Nebraska, Utah applies 80,000 lb uniformly on every road class, so route class matters enormously to Utah ESCORTS and not at all to Utah LEGAL WEIGHT.',
  classes: [
    {
      id: 'UT:freeway',
      publishedName: 'Freeway',
      quote:
        'R909-2-14 Table 3 column header: "Daylight Hours on a Freeway" / "Non-Daylight Hours on a Freeway". R909-2-16(4) calls the same class "interstates": "Loads or vehicles exceeding 17 feet in width on two-lane routes, 20 feet in width on interstates, or 17 feet 6 inches in height on public highways may be allowed under the following terms and conditions". UDOT\'s page uses "freeways" with the same 20 ft figure.',
      generalEquivalents: ['interstate', 'divided'],
    },
    {
      id: 'UT:secondary-highway',
      publishedName: 'Secondary Highway',
      quote:
        'R909-2-14 Table 3 column header: "Daylight Hours on a Secondary Highway" / "Non-Daylight Hours on a Secondary Highway". R909-2-16(4) calls the same class "two-lane routes" and sets the same 17 ft width figure against it; UDOT\'s page says "secondary highways".',
      generalEquivalents: ['two-lane', 'multilane-undivided', 'urban'],
    },
  ],
};

const FREEWAY: ContextCondition = { kind: 'routeClassIn', anyOf: ['UT:freeway'] };
const SECONDARY: ContextCondition = {
  kind: 'routeClassIn',
  anyOf: ['UT:secondary-highway'],
};
const IN_DARKNESS: ContextCondition = { kind: 'inDarkness' };
const IN_DAYLIGHT: ContextCondition = { kind: 'noneOf', of: [{ kind: 'inDarkness' }] };

// ── Escort rules — R909-2-14 Table 3, cell by cell ────────────────────────

function escortRule(
  id: string,
  description: string,
  when: EscortRule['when'],
  then: EscortRule['then'],
  source: SourceDoc = R909_2,
  effectiveFrom: string = RULE_FROM,
): EscortRule {
  return {
    id,
    jurisdiction: 'UT',
    description,
    when,
    then,
    source,
    effectiveFrom,
    effectiveTo: null,
  };
}

/** `all` of a road class, a lighting condition and the cell's own dimensions. */
function cell(
  road: ContextCondition,
  light: ContextCondition,
  dimensions: EscortRule['when'],
): EscortRule['when'] {
  return {
    kind: 'all',
    of: [
      { kind: 'context', of: road },
      { kind: 'context', of: light },
      dimensions,
    ],
  };
}

export const UTAH_ESCORT_RULES: EscortRule[] = [
  // ── Table 3, row 1 — one pilot escort ───────────────────────────────
  escortRule(
    'ut-daylight-freeway-one-pilot',
    'Daylight, freeway: over 14 ft wide, 120 ft long or 20 ft of overhang — one pilot escort',
    cell(FREEWAY, IN_DAYLIGHT, {
      kind: 'any',
      of: [
        { kind: 'gt', measure: 'widthIn', value: ftIn(14) },
        { kind: 'gt', measure: 'overallLengthIn', value: ftIn(120) },
        { kind: 'gt', measure: 'frontOverhangIn', value: ftIn(20) },
        { kind: 'gt', measure: 'rearOverhangIn', value: ftIn(20) },
      ],
    }),
    { escorts: 1 },
  ),
  escortRule(
    'ut-daylight-secondary-one-pilot',
    'Daylight, secondary highway: over 12 ft wide, 105 ft long or 20 ft of overhang — one pilot escort',
    cell(SECONDARY, IN_DAYLIGHT, {
      kind: 'any',
      of: [
        { kind: 'gt', measure: 'widthIn', value: ftIn(12) },
        { kind: 'gt', measure: 'overallLengthIn', value: ftIn(105) },
        { kind: 'gt', measure: 'frontOverhangIn', value: ftIn(20) },
        { kind: 'gt', measure: 'rearOverhangIn', value: ftIn(20) },
      ],
    }),
    { escorts: 1 },
  ),
  // ── Table 3, row 2 — two pilot escorts ──────────────────────────────
  /**
   * THE HEIGHT TRIGGER ENTERS HERE, AT 16 FT, AND ONLY HERE. Row 1 has no
   * height cell at all, so a 15 ft high, 10 ft wide load on a daylight freeway
   * needs no escort under Table 3.
   */
  escortRule(
    'ut-daylight-freeway-two-pilots',
    'Daylight, freeway: over 16 ft wide or 16 ft high — two pilot escorts',
    cell(FREEWAY, IN_DAYLIGHT, {
      kind: 'any',
      of: [
        { kind: 'gt', measure: 'widthIn', value: ftIn(16) },
        { kind: 'gt', measure: 'heightIn', value: ftIn(16) },
      ],
    }),
    { escorts: 2 },
  ),
  escortRule(
    'ut-daylight-secondary-two-pilots',
    'Daylight, secondary highway: over 14 ft wide, 120 ft long or 16 ft high — two pilot escorts',
    cell(SECONDARY, IN_DAYLIGHT, {
      kind: 'any',
      of: [
        { kind: 'gt', measure: 'widthIn', value: ftIn(14) },
        { kind: 'gt', measure: 'overallLengthIn', value: ftIn(120) },
        { kind: 'gt', measure: 'heightIn', value: ftIn(16) },
      ],
    }),
    { escorts: 2 },
  ),
  // ── Table 3, row 3 — two pilots AND at least two police ─────────────
  /**
   * THE FREEWAY/SECONDARY WIDTH SPLIT IS 20 FT AGAINST 17 FT — a three-foot
   * band in which the same load needs police on one road class and not the
   * other. "At least 2" is a floor whose real count R909-2-14(1)(c) puts in the
   * Utah Highway Patrol's hands, so no upper bound is quotable; the position is
   * not published either, and 1 front + 1 rear is the two-officer shape this
   * corpus uses elsewhere for exactly that reason.
   */
  escortRule(
    'ut-daylight-freeway-police',
    'Daylight, freeway: over 20 ft wide, 175 ft long or 17 ft 6 in high — two pilot escorts and at least two police escorts',
    cell(FREEWAY, IN_DAYLIGHT, {
      kind: 'any',
      of: [
        { kind: 'gt', measure: 'widthIn', value: ftIn(20) },
        { kind: 'gt', measure: 'overallLengthIn', value: ftIn(175) },
        { kind: 'gt', measure: 'heightIn', value: ftIn(17, 6) },
      ],
    }),
    { escorts: 2, policeFront: 1, policeRear: 1 },
  ),
  escortRule(
    'ut-daylight-secondary-police',
    'Daylight, secondary highway: over 17 ft wide, 175 ft long or 17 ft 6 in high — two pilot escorts and at least two police escorts',
    cell(SECONDARY, IN_DAYLIGHT, {
      kind: 'any',
      of: [
        { kind: 'gt', measure: 'widthIn', value: ftIn(17) },
        { kind: 'gt', measure: 'overallLengthIn', value: ftIn(175) },
        { kind: 'gt', measure: 'heightIn', value: ftIn(17, 6) },
      ],
    }),
    { escorts: 2, policeFront: 1, policeRear: 1 },
  ),
  // ── Table 3, the non-daylight columns ───────────────────────────────
  /**
   * THE NIGHT COLUMNS INVERT THE LOGIC AND THEIR BOUNDARIES ARE INCLUSIVE. At
   * night on a freeway a load of "12' to 14' in width" takes one pilot; on a
   * secondary highway a load "Up to 12' in width" takes one. Anything wider is
   * dealt with by the not-authorized cell below rather than by a bigger escort.
   */
  escortRule(
    'ut-night-freeway-one-pilot',
    'Non-daylight, freeway: 12 ft to 14 ft wide — one pilot escort',
    cell(FREEWAY, IN_DARKNESS, {
      kind: 'between',
      measure: 'widthIn',
      min: ftIn(12),
      max: ftIn(14),
      minInclusive: true,
      maxInclusive: true,
    }),
    { escorts: 1 },
  ),
  escortRule(
    'ut-night-secondary-one-pilot',
    'Non-daylight, secondary highway: up to 12 ft wide — one pilot escort',
    cell(SECONDARY, IN_DARKNESS, {
      kind: 'not',
      of: { kind: 'gt', measure: 'widthIn', value: ftIn(12) },
    }),
    { escorts: 1 },
  ),
  /**
   * A TRAVEL PROHIBITION, NOT AN ESCORT COUNT. Rows 2 and 3 of the two
   * non-daylight columns are identical and both read "Not authorized during
   * non-daylight hours". That is a hard scheduling constraint and it has no
   * price, so it is a `manualReview`: the move as described cannot be made at
   * night at all.
   */
  escortRule(
    'ut-night-freeway-not-authorized',
    'Non-daylight, freeway: over 14 ft wide, 105 ft long, 14 ft 6 in high or 10 ft of overhang — not authorized',
    cell(FREEWAY, IN_DARKNESS, {
      kind: 'any',
      of: [
        { kind: 'gt', measure: 'widthIn', value: ftIn(14) },
        { kind: 'gt', measure: 'overallLengthIn', value: ftIn(105) },
        { kind: 'gt', measure: 'heightIn', value: ftIn(14, 6) },
        { kind: 'gt', measure: 'frontOverhangIn', value: ftIn(10) },
        { kind: 'gt', measure: 'rearOverhangIn', value: ftIn(10) },
      ],
    }),
    {
      manualReview:
        'R909-2-14 Table 3, non-daylight freeway column: "Greater than: 14\' in width; or 105\' in length; or 14\'6" of height; or 10\' of overhang — Not authorized during non-daylight hours." This is a travel prohibition rather than an escort requirement — the load may not move at all in hours of darkness — so no escort count is quoted and the schedule of the move must be confirmed with UDOT.',
    },
  ),
  escortRule(
    'ut-night-secondary-not-authorized',
    'Non-daylight, secondary highway: over 12 ft wide, 105 ft long, 14 ft 6 in high or 10 ft of overhang — not authorized',
    cell(SECONDARY, IN_DARKNESS, {
      kind: 'any',
      of: [
        { kind: 'gt', measure: 'widthIn', value: ftIn(12) },
        { kind: 'gt', measure: 'overallLengthIn', value: ftIn(105) },
        { kind: 'gt', measure: 'heightIn', value: ftIn(14, 6) },
        { kind: 'gt', measure: 'frontOverhangIn', value: ftIn(10) },
        { kind: 'gt', measure: 'rearOverhangIn', value: ftIn(10) },
      ],
    }),
    {
      manualReview:
        'R909-2-14 Table 3, non-daylight secondary-highway column: "Greater than: 12\' in width; or 105\' in length; or 14\'6" of height; or 10\' of overhang — Not authorized during non-daylight hours." A travel prohibition, not an escort count.',
    },
  ),
  // ── R909-2-14(1)(d): overhang decides POSITION, not only count ──────
  /**
   * UTAH PUBLISHES THE POSITION AND IT IS THE REVERSE OF TEXAS, where both a
   * front and a rear overhang over 20 ft take a REAR escort. Table 3 already
   * requires one pilot at over 20 ft of overhang in both daylight columns; (d)
   * says where to put it.
   */
  escortRule(
    'ut-front-overhang-over-20',
    'Front overhang over 20 ft — the pilot escort rides in front',
    { kind: 'gt', measure: 'frontOverhangIn', value: ftIn(20) },
    { escorts: 1, front: 1 },
  ),
  escortRule(
    'ut-rear-overhang-over-20',
    'Rear overhang over 20 ft — the pilot escort rides behind',
    { kind: 'gt', measure: 'rearOverhangIn', value: ftIn(20) },
    { escorts: 1, rear: 1 },
  ),
  // ── Findings that are real and are not counts ───────────────────────
  /**
   * THE ESCORT RULES REACH ONLY NON-DIVISIBLE LOADS, WHICH NEITHER KANSAS NOR
   * NEBRASKA SAYS. A divisible oversize load in Utah — a long LCV, an over-81 ft
   * cargo length — takes no escorts under Table 3 whatever its dimensions. A
   * quote does not state divisibility, so the escorts above are priced on the
   * non-divisible reading and the carve-out is stated.
   */
  escortRule(
    'ut-escorts-non-divisible-only',
    'Table 3 applies only to non-divisible loads',
    { kind: 'gt', measure: 'widthIn', value: 102 },
    {
      advisory:
        'R909-2-14(1)(g): "The escort requirements in this section apply only to non-divisible loads." A divisible oversize load in Utah takes no Table 3 escorts at any dimension — an unusually explicit carve-out that neither Kansas nor Nebraska draws. This quote does not state whether the load is divisible, so the escorts above are priced on the non-divisible reading, which is the conservative one. R909-2-14(1)(e) also lets the division "require a motor carrier to have more pilot and police escorts than required by Table 3", with no number attached.',
    },
  ),
  /**
   * THE POLICE COUNT IS SET BY A BODY OUTSIDE UDOT AND THE RATE IS PUBLISHED
   * NOWHERE. The trigger and the absent rate are separate findings and are
   * recorded separately.
   */
  escortRule(
    'ut-police-escort-no-published-rate',
    'Police escort — trigger published, count set by the Highway Patrol, rate published nowhere',
    {
      kind: 'any',
      of: [
        { kind: 'ruleApplies', ruleId: 'ut-daylight-freeway-police' },
        { kind: 'ruleApplies', ruleId: 'ut-daylight-secondary-police' },
      ],
    },
    {
      advisory:
        'Utah publishes the police-escort TRIGGER and not the rate. R909-2-14(1)(c): "The number of police escorts required is determined by the Utah Highway Patrol and is based on the area, time, difficulty of travel, and applicable state and local rules, laws, and ordinances", so the "at least 2" in Table 3 is a floor set outside UDOT and no upper bound is quotable. R909-2-16(4)(e): "the permittee will assume all costs when a certified police escort or escorts are required." No hourly, mileage, minimum-call or cancellation figure appears in R909-2, in Utah Code §§ 72-7-402/404/406/407, on any UDOT page or on the Utah Highway Patrol site; escorts are arranged "by sending the Utah Highway Patrol a letter of understanding by email ... as soon as possible, but at least 48 hours, prior to the move". NO POLICE COST IS INCLUDED IN THIS QUOTE. Do not confuse this with the one Utah escort figure that IS published — "$40.00, or the full cost of a department employee and vehicle, whichever is greater", with time "at actual rate plus expense and overtime" — which is a UDOT EMPLOYEE escort, is discretionary, and is itself a floor rather than a price.',
    },
    UDOT_NON_DIVISIBLE,
    RETRIEVED,
  ),
  /**
   * THE (6)-vs-(7) DRAFTING OVERLAP, surfaced on exactly the loads it reaches:
   * a non-divisible overweight load at or under 125,000 lb, where (6)(b)'s flat
   * $60 and (7)(b)(ii)'s $80 floor both have a textual claim.
   */
  escortRule(
    'ut-subsection-6-7-overlap',
    'Overweight at or under 125,000 lb — § 72-7-406(6) and (7) both claim the load',
    {
      kind: 'between',
      measure: 'grossWeightLbs',
      min: 80_001,
      max: 125_000,
      minInclusive: true,
      maxInclusive: true,
    },
    {
      advisory:
        'Two adjacent subsections of § 72-7-406 claim this load. (6)(a) authorises an oversize-and-overweight permit "for a vehicle or combination of vehicles carrying a nondivisible load that exceeds one or more of the maximum weight provisions of Section 72-7-404 UP TO A GROSS WEIGHT OF 125,000 POUNDS", at a flat $60 single trip. (7)(a) authorises one for a load that exceeds "(i) one or more of the maximum weight provisions of Section 72-7-404; OR (ii) a gross weight of 125,000 pounds" — limb (i) with no upper bound at all — at the per-mile formula with an $80 floor. This engine prices the load under (6) at $60, because the alternative makes (6) entirely redundant and because the $80 floor sitting above the $60 flat fee is the arithmetic showing the two are alternative products for different weight ranges. The reading is stated rather than assumed: if it is wrong it is a $20 error on every mid-weight Utah lane.',
    },
    UT_72_7_406,
    FEE_FROM,
  ),
  /**
   * THE MULTI-TRIP HEIGHT CEILING: SIX INCHES, AND $600 OVER TWENTY MOVES.
   * It reaches only a repeat lane, and only in the 14 ft to 14 ft 6 in band.
   */
  escortRule(
    'ut-multi-trip-height-ceiling-conflict',
    'Height between 14 ft and 14 ft 6 in — statute and rule disagree about the multi-trip ceiling',
    {
      kind: 'between',
      measure: 'heightIn',
      min: ftIn(14),
      max: ftIn(14, 6),
      minInclusive: false,
      maxInclusive: true,
    },
    {
      advisory:
        'Utah\'s statute and its rule set the multi-trip oversize ceiling six inches apart in the band this load sits in. § 72-7-406(5)(a)(ii): "the department may issue only a single trip oversize permit for a vehicle or combination of vehicles that is more than 14 feet 6 inches wide, 14 FEET HIGH, or 105 feet long." R909-2-16(1)(b): "semi-annual and annual permits may be issued for dimensions up to, but not exceeding: (i) 14 FEET 6 INCHES IN HEIGHT; (ii) 14 feet 6 inches in width; and (iii) 105 feet in length." The rule is newer (March 2026) and is the operational document; the statute is the higher authority and its WIDTH figure matches the rule exactly, which makes the height divergence look deliberate rather than a typo. Neither is adopted. It decides whether a repeat load at this height can hold a $90 annual permit or must buy a $30 single trip for every move — $90 against $600 over twenty moves. The single-trip fee quoted here is unaffected.',
    },
    UT_72_7_406,
    FEE_FROM,
  ),
  /**
   * THE SUPERLOAD SUBSTITUTE: A QUEUE, NOT A PRODUCT. It costs schedule rather
   * than money, and the 300,000 lb figure appears in no statute and no rule.
   */
  escortRule(
    'ut-manual-processing-queue',
    'Over 17 ft wide, 17 ft 6 in high or 300,000 lb — manual processing, up to 14 days',
    {
      kind: 'any',
      of: [
        { kind: 'gt', measure: 'widthIn', value: ftIn(17) },
        { kind: 'gt', measure: 'heightIn', value: ftIn(17, 6) },
        { kind: 'gt', measure: 'grossWeightLbs', value: 300_000 },
      ],
    },
    {
      advisory:
        'UDOT: "Because of additional processing requirements, loads exceeding 17′ 6″ in height, 17′ in width, or have a gross weight over 300,000 lbs. will only be processed during Monday through Friday from 8 a.m. to 5 p.m. (Mountain Standard Time), and may take up to 14 Days for approval." THE FEE DOES NOT CHANGE — Utah has no superload product and the § 72-7-406(7) formula still caps at $540 — so what this costs is schedule, not money. The permit goes to a superload team, then to the Right of Way Permitting office in each region, which "may take up to 2 weeks", and "If the new route is not possible, the permit will be denied." R909-2-16(4)(c) separately requires the permittee to request authorisation "at least two business days in advance of the movement", and (d) makes the permit invalid "until the permittee has assumed the cost and responsibility to obtain utility company authorizations and clearances" — an unpriced third-party cost. The 300,000 lb figure appears in no statute and no rule; it is published only on this undated page.',
    },
    UDOT_PROVISIONS,
    RETRIEVED,
  ),
  escortRule(
    'ut-dual-lane-structures-clearance',
    'Dual-lane trailers over 10 ft wide — a Structures Division clearance, minimum 14 business days, every trip',
    { kind: 'gt', measure: 'widthIn', value: ftIn(10) },
    {
      advisory:
        'UDOT: "Overweight/Oversize Loads using dual lane trailers (over 10 feet wide) that do not pass bridge validation require clearance from the UDOT Structures Division. ... This clearance can take a minimum of 14 business days, or longer, and should be applied for prior to purchasing the permit. UDOT Structures Division approvals are for a single trip only. Carriers utilizing the same configurations/equipment are required to obtain a new approval prior to each move." NO FEE IS PUBLISHED for the clearance — contrast Texas\'s $500 route-analysis review — and the "new approval prior to each move" is the operationally expensive part, because a repeat dual-lane lane cannot be pre-cleared once and reused. This quote does not state whether the trailer is dual-lane, so the clearance is flagged rather than assumed.',
    },
    UDOT_PROVISIONS,
    RETRIEVED,
  ),
  escortRule(
    'ut-route-survey-discretionary-over-18ft',
    'Over 18 ft high — a route survey MAY be required',
    { kind: 'gt', measure: 'heightIn', value: ftIn(18) },
    {
      advisory:
        'UDOT: "Loads exceeding 18\' in height may be required to submit a route survey." DISCRETIONARY, not mandatory — and the word "survey" does not appear anywhere in R909-2, so this undated agency page is the only source. No survey fee is published and none is included. Recorded as an advisory rather than as a route-inspection threshold, because encoding 18 ft as a trigger would assert a mandatory requirement Utah does not publish.',
    },
    UDOT_NON_DIVISIBLE,
    RETRIEVED,
  ),
  /**
   * THREE TIME-AND-WEATHER RULES WHOSE DIMENSION TESTS ARE JOINED BY "AND",
   * THREE TIMES, IN A RULE REVISED SIX MONTHS AGO. Read literally a load must
   * exceed ALL THREE dimensions to be restricted, which would let a 16 ft wide,
   * 60 ft long, 13 ft high load travel the Wasatch Front curfew on Christmas Day
   * in a snowstorm. The disjunctive reading is almost certainly right and the
   * conjunctive one is what the rule says; neither is adopted.
   */
  escortRule(
    'ut-travel-restrictions-and-or-conflict',
    'Curfew, holiday and weather restrictions — the rule joins its three dimension tests with "and"',
    {
      kind: 'any',
      of: [
        { kind: 'gt', measure: 'widthIn', value: ftIn(12) },
        { kind: 'gt', measure: 'overallLengthIn', value: ftIn(105) },
        { kind: 'gt', measure: 'heightIn', value: ftIn(14, 6) },
      ],
    },
    {
      advisory:
        'Utah publishes three travel restrictions this load may fall under, and all three are drafted with "and" where the parallel construction in Table 3 uses "or". R909-2-12(1): "travel is prohibited for loads or vehicles more than 12 feet wide, 105 feet overall length, AND 14 feet 6 inches in height, Monday through Friday between 6 a.m. and 9 a.m. and between 3:30 p.m. and 6 p.m. mountain time" on the named Wasatch Front corridors — highways south of the Perry Willard Interchange (I-15 Exit 357), highways in Weber, Davis and Salt Lake Counties, Utah County north of I-15 Exit 261, SR 68 north of milepost 16, I-80 between Salt Lake County Exits 140 and 99, and I-84 west of milepost 94. R909-2-13(1) prohibits the same class of load on six holidays "from 2 p.m. the day before the holiday ... to sunrise the day after", with Monday holidays starting at 2 p.m. on the Friday before and reopening for the weekend. R909-2-11(2) prohibits movement of a non-divisible load "more than 10 feet wide, 105 feet long, AND 10 feet front or rear overhang" on "any accumulation of snow and ice on the roadway" or below 1,000 ft of visibility — an absolute standard, and R909-2-11(3) makes that section supersede any conflicting provision of the rule. READ LITERALLY a load must exceed all three dimensions to be restricted; read as evidently intended, any one suffices. Neither reading is adopted, and no delay cost is priced.',
    },
  ),
];

// ── The oversize fee, the overweight formula, and how they combine ────────

/**
 * ONE UNBOUNDED BAND. Utah's oversize single trip is $30 whatever the load
 * measures, so the band places no dimensional condition at all and matches
 * every oversize load. It is a BAND rather than `permitBaseFeeUsd` because the
 * $60 and the formula REPLACE it — see `combinedFeeRule` — and the base must be
 * a sourced zero for that replacement to leave nothing behind.
 */
const oversizeFeeBands: Sourced<OversizeFeeBand>[] = [
  fromDated<OversizeFeeBand>(
    {
      label: 'single trip oversize permit, 96 continuous hours — § 72-7-406(5)(b)',
      feeUsd: 30,
    },
    UT_72_7_406,
    FEE_FROM,
    '§ 72-7-406(5)(b): "The fee is $30 for a single trip oversize permit under this Subsection (5). This permit is valid for not more than 96 continuous hours." FLAT — no weight term, no mileage term, no dimensional band. "96 continuous hours" is four days measured in hours from issue and does not stop for a weekend. The semiannual product is $75/180 days and the annual $90/365 days, so a Utah annual oversize permit pays for itself in four trips.',
  ),
];

const MILES_ROUNDING_QUOTE =
  '§ 72-7-406(7)(c)(i): "The miles used to calculate the fee under this Subsection (7) shall be rounded up to the nearest 50 mile increment."';

const DOLLAR_ROUNDING: RoundingRule = {
  direction: 'nearest',
  toMultipleOf: 10,
  quote:
    '§ 72-7-406(7)(c)(iii): "The department shall round the dollar amount used to calculate the fee under this Subsection (7) to the nearest $10 increment."',
};

const POUNDS_ROUNDING_QUOTE =
  '§ 72-7-406(7)(c)(ii): "The pounds used to calculate the fee under this Subsection (7) shall be rounded up to the nearest 25,000 pound increment."';

/** The § 72-7-406(7) formula, once per reading of "the pounds". */
function formulaRate(appliesTo: 'gross' | 'excessOverBase'): PerMileRate {
  return {
    minLbs: 125_001,
    maxLbs: null,
    ratePerMileUsd: 0.012,
    perIncrementLbs: 1_000,
    excessBaseLbs: 80_000,
    roundIncrementUp: true,
    minimumUsd: 80,
    maximumUsd: 540,
    roundMilesUpTo: 50,
    roundPoundsTo: {
      direction: 'up',
      toMultipleOf: 25_000,
      appliesTo,
      quote: POUNDS_ROUNDING_QUOTE,
    },
    roundDollarsTo: DOLLAR_ROUNDING,
  };
}

const overweightPerMile: Sourced<PerMileRate>[] = [
  /**
   * § 72-7-406(6)(b) — A FLAT $60 THAT IS NOT A PER-MILE FEE AT ALL, expressed
   * as a rate of zero with the minimum and the maximum both set to the fee.
   * That is the only shape in `PerMileRate` that is INDEPENDENT of the miles,
   * which is exactly what the subsection is, and it keeps Utah's two products
   * in one weight-banded list where the engine selects between them on gross
   * weight. `feeDistanceDependence` records separately that this charge does
   * not depend on distance.
   */
  fromDated<PerMileRate>(
    {
      minLbs: 80_001,
      maxLbs: 125_000,
      ratePerMileUsd: 0,
      perIncrementLbs: null,
      excessBaseLbs: null,
      roundIncrementUp: false,
      minimumUsd: 60,
      maximumUsd: 60,
    },
    UT_72_7_406,
    FEE_FROM,
    '§ 72-7-406(6): "(a) The department may issue an oversize and overweight permit under this section for a vehicle or combination of vehicles carrying a nondivisible load that exceeds one or more of the maximum weight provisions of Section 72-7-404 up to a gross weight of 125,000 pounds. (b) The fee is $60 for a single trip oversize and overweight permit under this Subsection (6). This permit is valid for not more than 96 continuous hours." THIS IS THE EASIEST UTAH FEE TO GET WRONG: under 125,000 lb gross the (7) per-mile formula does NOT apply, and running it would produce the $80 minimum instead of the correct $60 on every such lane. The rate is written as zero per mile with a minimum and a maximum of $60 because the charge is flat in both distance and weight.',
  ),
  fromDated<PerMileRate>(
    formulaRate('excessOverBase'),
    UT_72_7_406,
    FEE_FROM,
    'READING A — "the pounds" means the EXCESS over 80,000 lb. § 72-7-406(7)(b)(i): "The fee for a single trip oversize and overweight permit under this Subsection (7), which is valid for not more than 96 continuous hours, is $.012 per mile for each 1,000 pounds above 80,000 pounds subject to the rounding described in Subsection (7)(c)." (b)(ii) sets a minimum of $80 and (b)(iii) a maximum of $540. This reading has the better textual argument, because (b)(i) defines the fee base as the excess and (c)(ii)\'s "the pounds used to calculate the fee" is most naturally that same quantity. It is NOT adopted. ' +
      MILES_ROUNDING_QUOTE +
      ' ' +
      POUNDS_ROUNDING_QUOTE,
  ),
  fromDated<PerMileRate>(
    formulaRate('gross'),
    UT_72_7_406,
    FEE_FROM,
    'READING B — "the pounds" means the GROSS WEIGHT. § 72-7-406(7)(c)(ii) rounds "The pounds used to calculate the fee", unqualified, and the statute never says which pounds. At 126,000 lb over 300 miles the two readings are $180 and $250 — forty per cent apart on an ordinary heavy-haul lane, and the gap grows with distance. Reading B produces the tidier arithmetic against a 25,000 lb grain. It is NOT adopted either; both rows stay on file and the resolver refuses to pick. The $80 floor masks the divergence on short lanes, where both readings floor to the same figure and resolve cleanly.',
  ),
];

const UTAH_COMBINED_FEE: CombinedFeeRule = {
  kind: 'overweightOnly',
  explanation:
    'Utah issues ONE permit and charges ONE fee. § 72-7-406(5) prices an oversize-only single trip at $30; (6) and (7) price an "oversize AND overweight" single trip at $60 or at the per-mile formula. The overweight product REPLACES the oversize product rather than adding to it — there is no subsection anywhere in § 72-7-406 that charges both — so a load that is over on size and on weight pays the (6) or (7) figure alone.',
};

// ── The jurisdiction ──────────────────────────────────────────────────────

export const UTAH_OSOW_RULES: JurisdictionOsowRules = {
  code: 'UT',
  name: 'Utah',
  country: 'US',

  routeVocabulary: [fromDated<RouteVocabulary>(UTAH_ROUTE_VOCABULARY, R909_2, RULE_FROM)],

  legalLimits: {
    widthIn: [
      fromDated(
        102,
        UT_72_7_402,
        '2017-05-09',
        '§ 72-7-402(2): "A vehicle unladen or with a load may not exceed a width of 8-1/2 feet." EXCLUSIVE. § 72-7-402(1) excludes "all state or federally approved safety devices and any other lawful appurtenant devices, including refrigeration units, hitches, air line connections, and load securing devices ... if the devices are not designed or used for carrying cargo", and separately excludes load-induced tire bulge from the width measurement only.',
      ),
      fromDated(
        102,
        R909_2,
        RULE_FROM,
        'R909-2-4(1)(b): "width: eight feet six inches". Corroborates the statute from the freshest primary operational document in this corpus.',
      ),
    ],
    heightIn: [
      fromDated(
        ftIn(14),
        UT_72_7_402,
        '2017-05-09',
        '§ 72-7-402(3): "A vehicle unladen or with a load may not exceed a height of 14 feet." EXCLUSIVE. Utah is a 14 ft state, not a 13 ft 6 in one.',
      ),
      fromDated(ftIn(14), R909_2, RULE_FROM, 'R909-2-4(1)(a): "height: 14 feet".'),
    ],
    trailerLengthIn: [
      fromDated(
        ftIn(53),
        UT_72_7_402,
        '2017-05-09',
        '§ 72-7-402(4)(b)(i): "A semitrailer, unladen or with a load, may not exceed a length of 53 feet excluding refrigeration units, hitches, air line connections, and safety appurtenances." EXCLUSIVE at 53 ft. NOTE A DATUM DIVERGENCE between the two sources for the same figure: R909-2-4 Table 1 comments the semitrailer row "Measured from bumper to bumper", which is not the statute\'s exclusion of refrigeration units, hitches and appurtenances. The number is the same either way; the measurement is not. R909-2-19 separately allows "Trailers exceeding 53 feet but not to exceed 57 feet" to buy a permit — so a 57 ft trailer needs a Utah permit and is legal without one in several neighbouring states.',
      ),
      fromDated(
        ftIn(53),
        R909_2,
        RULE_FROM,
        'R909-2-4 Table 1: "Semitrailer 53\' Measured from bumper to bumper." The full table also sets a truck tractor and a straight truck at 45 ft, a full trailer at 53 ft, doubles and triples at 61 ft measured trailer-front to trailer-rear with the tractor excluded, a truck and one or two trailers at 65 ft, a stringer steered combination at 80 ft, a saddle mount at 97 ft and a drawbar at 15 ft.',
      ),
    ],
    /**
     * ABSENT ON A CLEAN PUBLISHED NEGATIVE, not on a gap. § 72-7-402(4)(b)(ii):
     * "There is no overall length limitation on a truck tractor and semitrailer
     * combination when the semitrailer length is 53 feet or less." The 65 ft in
     * (4)(d) governs "all other combinations of vehicles", and recording it
     * here would flag every ordinary tractor-semitrailer in Utah as
     * over-length. (4)(d) also carries Utah's public-utility emergency-night
     * exemption, which is not a bucket-truck rule.
     */
    frontOverhangIn: [
      fromDated(
        ftIn(3),
        UT_72_7_402,
        '2017-05-09',
        '§ 72-7-402(5)(a): "a vehicle or combination of vehicles may not carry any load extending more than three feet beyond the front of the body of the vehicle or more than six feet beyond the rear of the bed or body of the vehicle." EXCLUSIVE. NOTE THE DATUM DIVERGENCE: the statute measures "beyond the front of the BODY OF THE VEHICLE" and R909-2-4 Table 1 measures "from the front of the POWER UNIT". Table 1 footnote three raises the front figure to 4 ft "when a stinger steer is in use", a configuration a quote does not state. Utah is the only state in this three-state set that publishes overhang limits at all — and, consequently, the only one with overhang ESCORT triggers.',
      ),
      fromDated(ftIn(3), R909_2, RULE_FROM, 'R909-2-4 Table 1: "Front overhang 3\' *** Measured from the front of the power unit."'),
    ],
    rearOverhangIn: [
      fromDated(
        ftIn(6),
        UT_72_7_402,
        '2017-05-09',
        '§ 72-7-402(5)(a): "more than six feet beyond the rear of the bed or body of the vehicle". EXCLUSIVE. Statute and rule agree on this datum, unlike the front-overhang row.',
      ),
      fromDated(ftIn(6), R909_2, RULE_FROM, 'R909-2-4 Table 1: "Rear overhang 6\' Measured from the rear of the bed or body of the vehicle."'),
    ],
    grossWeightLbs: [
      fromDated(
        80_000,
        UT_72_7_404,
        '2019-05-14',
        '§ 72-7-404(2)(b): "Subject to the limitations of Subsection (3), the gross vehicle weight of any vehicle or combination of vehicles may not exceed 80,000 pounds." EXCLUSIVE, and applied UNIFORMLY on every road class — Utah has no interstate/non-interstate split in the legal gross, which is worth stating because its escort rules turn on road class completely. Subsection (3) is the federal bridge formula, W = 500{LN/(N-1) + 12N + 36}, with W rounded TO THE NEAREST 500 lb and L rounded UP whenever the fraction is one inch or more — two rounding rules running in opposite directions inside one subsection. R909-2-5(5) allows a natural-gas or battery-electric vehicle up to 82,000 lb by the weight of its fuel system; R909-2-5(4) allows emergency vehicles up to 86,000 lb; R909-2-5(3) exempts a covered heavy-duty tow and recovery vehicle from Table 2 entirely. None is applied — a quote states neither powertrain nor vocation.',
      ),
      fromDated(80_000, R909_2, RULE_FROM, 'R909-2-5 Table 2: "Gross Vehicle Weight 80,000 pounds".'),
    ],
    singleAxleLbs: [
      fromDated(
        20_000,
        UT_72_7_404,
        '2019-05-14',
        '§ 72-7-404(2)(a)(ii): "a single axle load in excess of 20,000 pounds". EXCLUSIVE. "Axle load" is defined at (1)(a)(i) as "the total load on all wheels whose centers may be included between two parallel transverse vertical planes 40 inches apart". § 72-7-404(2)(a)(i) also caps a single WHEEL at 10,500 lb — not the 10,000 lb of several neighbours, a 500 lb difference that matters on a heavily loaded steer. R909-2-6 adds a hard cap that sits UNDER every permit allowance: "The load of a tire may not exceed the load rating as indicated by the manufacturer on the sidewall of the tire", calculated on "the load rating of the lowest-rated tire in the relevant axle or axle group". Tire ratings are not collected on a quote.',
      ),
      fromDated(20_000, R909_2, RULE_FROM, 'R909-2-5 Table 2: "Single Axle 20,000 pounds".'),
    ],
    tandemAxleLbs: [
      fromDated(
        34_000,
        UT_72_7_404,
        '2019-05-14',
        '§ 72-7-404(2)(a)(iii): "a tandem axle load in excess of 34,000 pounds." "Tandem axle" is defined at (1)(a)(ii) as "two or more axles spaced not less than 40 inches nor more than 96 inches apart and having at least one common point of weight suspension". Utah publishes NO flat tridem figure: R909-2-5 Table 2 reads "Tridem Axle — Must comply with the bridge formula", so no default tridem number may be substituted for this state.',
      ),
      fromDated(34_000, R909_2, RULE_FROM, 'R909-2-5 Table 2: "Tandem Axle 34,000 pounds".'),
    ],
  },

  /**
   * A SOURCED ZERO. Utah charges nothing on top of whichever of its three
   * single-trip products applies — § 72-7-406 authorises no issuance charge, no
   * processing charge and no percentage — so the band above carries the whole
   * oversize fee and this row records that nothing sits over it. The engine
   * suppresses the empty line rather than printing "$0.00".
   */
  permitBaseFeeUsd: [
    fromDated(
      0,
      UT_72_7_406,
      FEE_FROM,
      '§ 72-7-406 prices three single-trip products — $30 oversize, $60 oversize-and-overweight to 125,000 lb, and the (7) formula above it — and adds nothing to any of them. R909-2 publishes no fee at all. § 72-7-406(4) does make the permit invalid unless the vehicle is "properly registered for the weight authorized by the permit" or "registered for a gross laden weight of 78,001 pounds or over, if the gross laden weight authorized by the permit exceeds 80,000 pounds", but unlike Kansas Utah sells no temporary registration alongside the permit — the registration is a precondition, not an add-on, so Utah\'s headline fee is much closer to the carrier\'s real cost.',
    ),
  ],

  oversizeFeeBands,

  combinedFeeRule: [fromDated<CombinedFeeRule>(UTAH_COMBINED_FEE, UT_72_7_406, FEE_FROM)],

  overweightPricing: [
    fromDated<OverweightPricing>(
      {
        kind: 'perMile',
        explanation:
          '§ 72-7-406(7)(b)(i) prices the single-trip overweight permit at "$.012 per mile for each 1,000 pounds above 80,000 pounds subject to the rounding described in Subsection (7)(c)", floored at $80 and capped at $540. Below 125,001 lb the charge is § 72-7-406(6)(b)\'s flat $60, held as a weight-banded rate of zero per mile with a minimum and maximum of $60.',
      },
      UT_72_7_406,
      FEE_FROM,
    ),
  ],

  overweightBands: [],
  overweightPerMile,

  /**
   * THE $540 CAP IS A HARD ONE AND IT MAKES UTAH CHEAP AT THE TOP END. A
   * 400,000 lb superheavy crossing the whole state pays the same $540 as a
   * 200,000 lb load on a long lane; the cap binds at 650 miles for a 150,000 lb
   * load and at 260 miles for a 250,000 lb one. It is on the rate rather than
   * here because § 72-7-406(7)(b)(iii) states it as a property of that fee.
   */
  conditionalFees: [],

  transactionFee: [
    fromDated<TransactionFee>(
      { perPermitUsd: 0, percentOfTotal: 0 },
      UT_72_7_406,
      FEE_FROM,
      'AN AFFIRMATIVE ABSENCE, not a gap. § 72-7-406 contains no service, processing or percentage fee, R909-2 contains none, and UDOT\'s provisions page describes only that "permits may be purchased online with a major credit card" without naming a surcharge. Contrast Texas, where Transp. Code § 623.076(b-1) authorises $0.25 plus 2.25%. The order of operations for Utah is therefore trivial: the § 72-7-406(7) rounding rules are the only arithmetic and nothing is applied on top. TWO SMALL UNKNOWNS ARE RECORDED AND NOT FILLED IN: R909-2-9(1) allows a permit to be transferred "up to two times per permit FOR A FEE" and never names the amount, and § 72-7-406 authorises no transfer fee at all; and UDOT\'s undated page states a refund rule in three words — "ALL SALES ARE FINAL" — with no statutory or regulatory backing found.',
    ),
  ],

  routeAnalysisFeeUsd: [],
  noBridgeRouteFeeUsd: [],

  superload: {
    /**
     * `grossWeight` IS ABSENT, on a checked negative. The word "superload"
     * appears nowhere in R909-2 (all thirty-three sections read) nor in Utah
     * Code §§ 72-7-402, 72-7-404, 72-7-406 or 72-7-407; the only occurrence in
     * any official Utah source is UDOT's description of an internal TEAM. What
     * Utah has instead is a processing queue above 17 ft wide, 17 ft 6 in high
     * or 300,000 lb gross — a schedule rule, not a fee rule — carried by
     * `ut-manual-processing-queue`. THE FEE DOES NOT CHANGE: the heaviest
     * imaginable Utah load still pays the § 72-7-406(7) formula capped at $540.
     * Contrast Kansas's $200 superload permit and Nebraska's $250/$400/$800
     * statutory tier.
     */
    shortSpacing: [],
  },

  /**
   * EMPTY ON ALL THREE AXES. UDOT publishes a route-survey DISCRETION — "Loads
   * exceeding 18' in height may be required to submit a route survey" — and
   * R909-2 contains no survey provision at all. Encoding 18 ft as a threshold
   * would turn a "may" into a "shall"; it is carried as an advisory instead.
   */
  routeInspection: {
    widthIn: [],
    heightIn: [],
    lengthIn: [],
  },

  escortRules: UTAH_ESCORT_RULES,

  escortCountCombination: [
    fromDated<EscortCountCombination>(
      {
        kind: 'mostStringent',
        explanation:
          'R909-2-14(1)(b): "A motor carrier shall follow the most stringent requirement that applies in Table 3." The single heaviest published requirement governs outright and the others are satisfied by it, rather than being added to it as Texas adds a front and a rear car once a load is over in two dimensions. R909-2-14(1)(a) frames the whole table this way — "As specified in Table 3 and this Subsection (1), a motor carrier shall be accompanied by a pilot or police escort" — and (1)(e) leaves the division free to require more.',
      },
      R909_2,
      RULE_FROM,
    ),
  ],

  feeDistanceDependence: [
    fromDated<FeeDistanceDependence>(
      {
        component: 'overweight',
        dependsOnDistance: false,
        quote:
          '§ 72-7-406(6)(b): "The fee is $60 for a single trip oversize and overweight permit under this Subsection (6)." A flat charge with no mileage term, for any non-divisible load up to 125,000 lb gross.',
      },
      UT_72_7_406,
      FEE_FROM,
      'Utah is distance-dependent for the § 72-7-406(7) formula above 125,000 lb and flat for the (6) product at or below it. The jurisdiction-wide boolean is TRUE because the formula is the case that must never be priced without in-state miles; this row records that the (6) charge does not need them.',
    ),
  ],

  publishedAbsences: [
    fromDated<PublishedAbsence>(
      {
        subject: 'weightEscortTrigger',
        statement:
          'R909-2-14 Table 3 contains no weight column and no pounds figure; R909-2-14 states no weight threshold; R909-2-22, the overweight rule, contains no escort provision. Table 3, R909-2-14, R909-2-22 and the UDOT pages were all read in full.',
        consequence:
          'A 300,000 lb load at legal width, height, length and overhang requires ZERO escorts in Utah. The only weight-linked process trigger anywhere in the state is the 300,000 lb figure on UDOT\'s undated page, and it governs processing hours rather than escorts.',
      },
      R909_2,
      RULE_FROM,
    ),
    fromDated<PublishedAbsence>(
      {
        subject: 'superloadDefinition',
        statement:
          'The word "superload" appears in no Utah statute and in no section of R909-2. Utah publishes a processing threshold instead: over 17 ft wide, 17 ft 6 in high or 300,000 lb gross the permit leaves the automated system and enters a manual queue that "may take up to 14 Days for approval".',
        consequence:
          'No gross-weight superload threshold is held for Utah, so no superload ceiling is mirrored to the public calculator and no Utah load is flagged as a superload. The superload cost in Utah is schedule, not money.',
      },
      R909_2,
      RULE_FROM,
    ),
    fromDated<PublishedAbsence>(
      {
        subject: 'superloadFee',
        statement:
          'With no superload class there is no superload fee, and none of the escalated processes carries one either: no fee is published for the UDOT Structures Division dual-lane clearance, for the superload team\'s route-planner review, or for the regional Right of Way clearance.',
        consequence:
          'The heaviest imaginable Utah load pays the § 72-7-406(7) formula capped at $540. The one published figure in the escort chain — "$40.00, or the full cost of a department employee and vehicle, whichever is greater" — is a UDOT employee escort, is discretionary, and is a floor on an open-ended charge rather than a price.',
      },
      UDOT_NON_DIVISIBLE,
      RETRIEVED,
    ),
    fromDated<PublishedAbsence>(
      {
        subject: 'policeEscortRate',
        statement:
          'R909-2 (all thirty-three sections), Utah Code §§ 72-7-402, 72-7-404, 72-7-406 and 72-7-407, UDOT\'s Oversize & Overweight Provisions page, its Oversize Non-Divisible Load Provisions page, its Pilot/Escort Requirements page and the Utah Highway Patrol site were all searched. No hourly rate, mileage rate, minimum hours, per diem or cancellation charge is published anywhere. What IS published is the 48-hour notice requirement and the contact channel.',
        consequence:
          'A Utah quote above the Table 3 row-3 thresholds cannot be completed and must go to review. The rate is genuinely absent from Utah\'s published law rather than missing from this research, and R909-2-14(1)(c) puts the COUNT outside UDOT as well: "The number of police escorts required is determined by the Utah Highway Patrol."',
      },
      R909_2,
      RULE_FROM,
    ),
  ],

  /**
   * TRUE, for the § 72-7-406(7) formula above 125,000 lb, which is priced per
   * mile and cannot be quoted without in-state mileage. `feeDistanceDependence`
   * records that the (6) product below that weight is flat.
   */
  feesDependOnDistance: true,
};
