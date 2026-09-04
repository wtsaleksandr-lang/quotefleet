/**
 * ILLINOIS — oversize/overweight single-trip permit rules.
 *
 * FOUR THINGS TO KNOW BEFORE TRUSTING A NUMBER HERE
 * -------------------------------------------------
 *
 * 1. THE OVERSIZE FEE IS BANDED BY DIMENSION **AND** BY DISTANCE. 625 ILCS
 *    5/15-305 prints five dimensional categories, each with four mileage steps
 *    ("For the first 90 miles $12.00 ... For more than 270 miles $21.00").
 *    Illinois is the only state in this dataset whose OVERSIZE charge moves
 *    with distance, which is why `OversizeFeeBand` carries `minMiles`/`maxMiles`
 *    at all. `feesDependOnDistance` is TRUE and the engine refuses to price
 *    Illinois without in-state mileage rather than billing a whole lane to it.
 *
 * 2. THE OVERWEIGHT FEE CANNOT BE COMPUTED FROM A QUOTE, AND THAT IS RECORDED
 *    RATHER THAN GUESSED. IDOT Table 2 selects the overweight fee from twelve
 *    categories keyed on AXLE COUNT and per-axle-group weights — category f
 *    (6+ axles, 88,000 lb max) and category j (5 axles, 88,000 lb max) cap at
 *    the same gross weight and charge $10 and $20 for the same 45 miles. A
 *    quote collects gross weight, not axle count, so the category cannot be
 *    selected. 625 ILCS 5/15-306's axle-only schedule needs the same missing
 *    data, 15-307 then charges "whichever is the greater, but not for both",
 *    and the out-of-category formula ($50 + 3.5¢ per ton-mile) applies only to
 *    loads already known to be outside those categories. `overweightPricing`
 *    is therefore `notPriceable` — a recorded finding, not an empty array that
 *    would render as a $0 overweight line.
 *
 * 3. ILLINOIS PUBLISHES NO NUMERIC SUPERLOAD THRESHOLD. 92 Ill. Adm. Code 554
 *    says only that "superload moves or moves on nonstandard vehicles or with
 *    nonstandard axle configurations may be authorized if allowable pavement
 *    and bridge stresses are not exceeded". Its "practical maximum" weights
 *    come with an express warning not to read them as cutoffs. `grossWeight` is
 *    therefore ABSENT rather than empty — see `SuperloadTriggers`, where the
 *    difference between "this state publishes none" and "we hold none" is the
 *    whole point of the optional field.
 *
 * 4. THE DISTANCE BOUNDARIES DOUBLE-ASSIGN THEIR OWN ENDPOINTS. The statute
 *    reads "For the first 90 miles" and then "From 90 miles to 180 miles", so a
 *    move of exactly 90 miles is named by both steps, and the same is true at
 *    180 and 270. The rows below reproduce those bounds verbatim, which means a
 *    leg landing exactly on a boundary matches two rows and the resolver
 *    correctly reports a range with manual review instead of picking a step the
 *    statute does not pick. Every other distance matches exactly one row.
 *
 * WHAT ILLINOIS DOES NOT PUBLISH — recorded as absences, never filled in
 * ----------------------------------------------------------------------
 *   - No fixed route-survey price. IDOT bills its own people at $40 per hour
 *     (bridge analysis, pavement analysis, field investigation, accompanying
 *     the move, damage inspection) plus unstated computer costs, and the hours
 *     are not known before the move. `routeAnalysisFeeUsd` is empty and the
 *     exclusion is carried on the advisory escort rule.
 *   - No rear-overhang limit and no overhang-based escort trigger. What
 *     Illinois does publish is a PERMIT trigger at 3 ft of front protrusion,
 *     which is recorded as `frontOverhangIn`; `rearOverhangIn` is omitted.
 *   - No pilot-car operator certification: escort drivers need only be 18 and
 *     licensed, so there is no state certification fee to carry.
 *   - No overall combination-length limit on Class I or Class II highways. The
 *     65 ft row below is the NON-DESIGNATED highway figure and says so; route
 *     class is not collected on a quote, so the statutory cap that does exist
 *     is used and its scope is stated on the row.
 */
import type { SourceDoc, Sourced } from '../provenance.js';
import { ftIn, type EscortRule } from '../escortRules.js';
import type {
  JurisdictionOsowRules,
  OversizeFeeBand,
  OverweightPricing,
  Threshold,
  TransactionFee,
} from '../types.js';

const RETRIEVED = '2026-09-01';

// ── Source documents ──────────────────────────────────────────────────────
//
// The Illinois Vehicle Code sections and the 92 Ill. Adm. Code Part 554 rules
// carry DIFFERENT effective dates, so each is its own `SourceDoc` even where
// two share a host. Collapsing them would attach one section's date to
// another's text, which is the rot `provenance.ts` exists to prevent.

const ILCS_15_102: SourceDoc = {
  id: 'il-625-ilcs-5-15-102',
  title: '625 ILCS 5/15-102 — Width of vehicles',
  url: 'https://ilga.gov/documents/legislation/ilcs/documents/062500050K15-102.htm',
  publisher: 'Illinois General Assembly',
  revisedOn: '2022-05-13',
  retrievedOn: RETRIEVED,
  cite: '8 ft 6 in on Class III and non-designated State and local highways; (e) same width on Class I, Class II and locally designated highways',
};

const ILCS_15_103: SourceDoc = {
  id: 'il-625-ilcs-5-15-103',
  title: '625 ILCS 5/15-103 — Height of vehicles',
  url: 'https://ilga.gov/documents/legislation/ilcs/documents/062500050K15-103.htm',
  publisher: 'Illinois General Assembly',
  revisedOn: '2002-01-01',
  retrievedOn: RETRIEVED,
  cite: '13 ft 6 in on any highway in the State, inclusive of load',
};

const ILCS_15_107: SourceDoc = {
  id: 'il-625-ilcs-5-15-107',
  title: '625 ILCS 5/15-107 — Length of vehicles',
  url: 'https://www.ilga.gov/documents/legislation/ilcs/documents/062500050K15-107.htm',
  publisher: 'Illinois General Assembly',
  revisedOn: '2026-01-01',
  retrievedOn: RETRIEVED,
  cite: 'single vehicle 42 ft; semitrailer 53 ft; no overall cap on Class I/II; 65 ft on non-designated highways',
};

const ILCS_15_111: SourceDoc = {
  id: 'il-625-ilcs-5-15-111',
  title: '625 ILCS 5/15-111 — Weight limits',
  url: 'https://www.ilga.gov/Documents/legislation/ilcs/documents/062500050K15-111.htm',
  publisher: 'Illinois General Assembly',
  revisedOn: '2026-06-16',
  retrievedOn: RETRIEVED,
  cite: '20,000 lb single axle; 34,000 lb tandem; 80,000 lb gross on 5 or more axles; federal bridge formula',
};

const ILCS_15_302: SourceDoc = {
  id: 'il-625-ilcs-5-15-302',
  title: '625 ILCS 5/15-302 — Determining permit fees',
  url: 'https://ilga.gov/documents/legislation/ilcs/documents/062500050K15-302.htm',
  publisher: 'Illinois General Assembly',
  revisedOn: '2019-01-01',
  retrievedOn: RETRIEVED,
  cite: 'weights to the next highest 1,000 lb; distances from the Illinois Official Highway Map',
};

/** The oversize fee schedule — five dimensional categories x four mileage steps. */
const ILCS_15_305: SourceDoc = {
  id: 'il-625-ilcs-5-15-305',
  title: '625 ILCS 5/15-305 — Fees for overdimension permits',
  url: 'https://www.ilga.gov/Documents/legislation/ilcs/documents/062500050K15-305.htm',
  publisher: 'Illinois General Assembly',
  revisedOn: '2022-05-13',
  retrievedOn: RETRIEVED,
  cite: 'categories (a) through (e), each with "For the first 90 miles" / "From 90 miles to 180 miles" / "From 180 miles to 270 miles" / "For more than 270 miles"',
};

const ILCS_15_306: SourceDoc = {
  id: 'il-625-ilcs-5-15-306',
  title: '625 ILCS 5/15-306 — Overweight axle permit fees (20,000 lb single-axle equivalency)',
  url: 'https://www.ilga.gov/legislation/ILCS/details?ActID=1815&ActName=Illinois+Vehicle+Code.&ChapAct=625+ILCS+5%2F&Chapter=&ChapterID=49&MajorTopic=&Print=True&SeqEnd=169800000&SeqStart=167500000',
  publisher: 'Illinois General Assembly',
  revisedOn: '2010-01-01',
  retrievedOn: RETRIEVED,
  cite: 'flat rates per 45-mile increment by axle-group excess; "not permitted" above the listed excesses',
};

const ILCS_15_307: SourceDoc = {
  id: 'il-625-ilcs-5-15-307',
  title: '625 ILCS 5/15-307 — Overweight gross permit fees',
  url: 'https://ilga.gov/documents/legislation/ilcs/documents/062500050K15-307.htm',
  publisher: 'Illinois General Assembly',
  revisedOn: '2021-07-23',
  retrievedOn: RETRIEVED,
  cite: 'greater-of rule against 15-306; continuation beyond 225 miles; out-of-category rate of $50 plus 3.5 cents per ton-mile',
};

const ILCS_15_312: SourceDoc = {
  id: 'il-625-ilcs-5-15-312',
  title: '625 ILCS 5/15-312 — Charges for Department and State Police escorts',
  url: 'https://www.ilga.gov/documents/legislation/ilcs/documents/062500050K15-312.htm',
  publisher: 'Illinois General Assembly',
  revisedOn: '2026-06-16',
  retrievedOn: RETRIEVED,
  cite: 'IDOT $40 per hour per vehicle, minimum $80; Illinois State Police $125 per hour per vehicle, minimum $500; fractions of an hour rounded up',
};

/** IDOT Table 2. CARRIES NO REVISION DATE AT ALL — `revisedOn` is null. */
const IDOT_TABLE_2: SourceDoc = {
  id: 'idot-overweight-fee-categories-table-2',
  title: 'IDOT — Table 2, Overweight Fee Categories (PDF)',
  url: 'https://idot.illinois.gov/content/dam/soi/en/web/idot/documents/doing-business/specialty-lists/highways/permits/table2.pdf',
  publisher: 'Illinois Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'categories f-r by axle count and axle-group weight, priced in 45-mile steps; included dimensions and the $15 width addition',
};

const IAC_554_2012: SourceDoc = {
  id: 'il-92-iac-554-2012',
  title: '92 Ill. Adm. Code Part 554 — Permits for excess size and weight (2012 amendments)',
  url: 'https://www.ilga.gov/agencies/JCAR/EntirePart?titlepart=09200554',
  publisher: 'Illinois Joint Committee on Administrative Rules',
  revisedOn: '2012-08-01',
  retrievedOn: RETRIEVED,
  cite: '554.505/.507/.508/.604/.605/.611 — civilian escort counts, State Police triggers, superload treatment, spacing, route survey',
};

const IAC_554_1988: SourceDoc = {
  id: 'il-92-iac-554-1988',
  title: '92 Ill. Adm. Code 554.408 — Escort vehicle requirements',
  url: 'https://www.ilga.gov/agencies/JCAR/EntirePart?titlepart=09200554',
  publisher: 'Illinois Joint Committee on Administrative Rules',
  revisedOn: '1988-07-29',
  retrievedOn: RETRIEVED,
  cite: 'escort position by highway type; height pole on the leading escort; operator age and licence',
};

const IAC_554_1996: SourceDoc = {
  id: 'il-92-iac-554-910-1996',
  title: '92 Ill. Adm. Code 554.910 — Engineering and investigation charges',
  url: 'https://www.ilga.gov/agencies/JCAR/EntirePart?titlepart=09200554',
  publisher: 'Illinois Joint Committee on Administrative Rules',
  revisedOn: '1996-01-25',
  retrievedOn: RETRIEVED,
  cite: 'bridge and pavement structural analysis, field investigation, accompanying the move and damage inspection at $40 per hour',
};

const IDOT_OPER_993: SourceDoc = {
  id: 'idot-oper-993',
  title: 'IDOT OPER 993 — Special provisions for oversize/overweight permits (PDF)',
  url: 'https://idot.illinois.gov/content/dam/soi/en/web/idot/documents/idot-forms/oper/oper-993.pdf',
  publisher: 'Illinois Department of Transportation',
  revisedOn: '2024-08-07',
  retrievedOn: RETRIEVED,
  cite: 'civilian escort counts; height pole set three inches above permitted load height',
};

const IDOT_CONVENIENCE: SourceDoc = {
  id: 'idot-permit-convenience-fee',
  title: 'IDOT — Apply for an oversize/overweight permit (convenience fees)',
  url: 'https://idot.illinois.gov/doing-business/permit-and-sales-marketplace/oversize-and-overweight-permits/apply.html',
  publisher: 'Illinois Department of Transportation',
  revisedOn: '2019-06-01',
  retrievedOn: RETRIEVED,
  cite: 'JetPay convenience fee of 2.25% of the total amount due, minimum $1.00; E-Check $0.75 per transaction',
};

const ILCS_15_313: SourceDoc = {
  id: 'il-625-ilcs-5-15-313',
  title: '625 ILCS 5/15-313 — Supplemental special permits',
  url: 'https://www.ilga.gov/documents/legislation/ilcs/documents/062500050K15-313.htm',
  publisher: 'Illinois General Assembly',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: '$5 for each supplemental special permit, plus any increase in size or weight; source note gives no effective date',
};

// ── Helpers ───────────────────────────────────────────────────────────────

/** A row from a dated source, effective from a date we can cite. */
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
 * A row from an UNDATED document — effective from our retrieval date, because
 * that is the only date on which we can prove the document said this.
 */
function fromUndatedPage<T>(value: T, source: SourceDoc, note?: string): Sourced<T> {
  return {
    value,
    source,
    effectiveFrom: RETRIEVED,
    effectiveTo: null,
    ...(note === undefined ? {} : { note }),
  };
}

const EFF_15_305 = '2022-05-13';
const EFF_554_2012 = '2012-08-01';
const EFF_554_1988 = '1988-07-29';
const EFF_OPER_993 = '2024-08-07';

// ── Escort rules ──────────────────────────────────────────────────────────

function escortRule(
  id: string,
  description: string,
  when: EscortRule['when'],
  then: EscortRule['then'],
  source: SourceDoc = IAC_554_2012,
  effectiveFrom: string = EFF_554_2012,
): EscortRule {
  return { id, jurisdiction: 'IL', description, when, then, source, effectiveFrom, effectiveTo: null };
}

/**
 * Illinois escorts.
 *
 * The counts do NOT change with highway type — only the POSITION does, and the
 * position is stated in each description rather than modelled as a
 * `routeClass` condition. 92 Ill. Adm. Code 554.408 puts a single escort about
 * 300 ft ahead on a two-lane highway and about 300 ft behind on a multilane
 * divided one, "however, the required escort vehicle with a height pole for
 * overheight movements must travel in front of the load". Making that a
 * road-class condition would send every Illinois quote without a stated
 * highway type to manual review for a distinction that does not change the
 * price by a dollar — the exact failure `EscortOutcome.escorts` exists to
 * prevent.
 *
 * THE 18 FT HEIGHT CONFLICT IS REAL AND BOTH RULES ARE KEPT. The adopted
 * administrative rule requires TWO civilian escorts over 18 ft high; IDOT's
 * current OPER 993 (7 August 2024) requires THREE. Escort outcomes combine
 * with MAX, so a load over 18 ft correctly quotes three — the stricter and
 * newer reading — and the advisory below states that the older rule says two,
 * so nothing is hidden by the arithmetic.
 */
export const ILLINOIS_ESCORT_RULES: EscortRule[] = [
  escortRule(
    'il-width-over-14-6',
    'Over 14 ft 6 in wide — one civilian escort (about 300 ft ahead on a two-lane highway, about 300 ft behind on a multilane divided highway)',
    { kind: 'gt', measure: 'widthIn', value: ftIn(14, 6) },
    { escorts: 1 },
  ),
  escortRule(
    'il-height-over-14-6',
    'Over 14 ft 6 in high — one civilian escort leading with a height pole set 3 in above the permitted load height',
    { kind: 'gt', measure: 'heightIn', value: ftIn(14, 6) },
    { escorts: 1, front: 1, heightPole: true },
  ),
  escortRule(
    'il-length-over-110',
    'Over 110 ft long — one civilian escort (about 300 ft ahead on a two-lane highway, about 300 ft behind on a multilane divided highway)',
    { kind: 'gt', measure: 'overallLengthIn', value: ftIn(110) },
    { escorts: 1 },
  ),
  /**
   * "Two civilian escort vehicles are required ... For all moves that exceed
   * both 14 feet 6 inches in width and 14 feet 6 inches in height", and the two
   * other pairings. A 2-of-3 over the single-escort rules is the same shape
   * Texas and Ohio need, written with the same grammar.
   */
  escortRule(
    'il-two-of-three-dimensions',
    'Over the escort threshold in two or more of width, height and length — two civilian escorts, one ahead and one trailing',
    {
      kind: 'atLeast',
      count: 2,
      of: [
        { kind: 'ruleApplies', ruleId: 'il-width-over-14-6' },
        { kind: 'ruleApplies', ruleId: 'il-height-over-14-6' },
        { kind: 'ruleApplies', ruleId: 'il-length-over-110' },
      ],
    },
    { escorts: 2, front: 1, rear: 1 },
  ),
  escortRule(
    'il-height-over-18-adopted-rule',
    'Over 18 ft high — two civilian escorts under the adopted administrative rule',
    { kind: 'gt', measure: 'heightIn', value: ftIn(18) },
    { escorts: 2, front: 1, rear: 1 },
  ),
  /**
   * OPER 993 is IDOT's current permit-provisions form and is nine years newer
   * than the escort counts in the adopted rule. It escalates over 18 ft high to
   * three, where the rule says two. Both are on file; MAX quotes three.
   */
  escortRule(
    'il-three-escorts',
    'Over 16 ft wide, over 18 ft high, or over 145 ft long — three civilian escorts',
    {
      kind: 'any',
      of: [
        { kind: 'gt', measure: 'widthIn', value: ftIn(16) },
        { kind: 'gt', measure: 'heightIn', value: ftIn(18) },
        { kind: 'gt', measure: 'overallLengthIn', value: ftIn(145) },
      ],
    },
    {
      escorts: 3,
      advisory:
        'Illinois requires three civilian escorts over 16 ft wide, over 18 ft high or over 145 ft long (IDOT OPER 993, revised 7 August 2024). For a load over 18 ft high the adopted administrative rule, 92 Ill. Adm. Code 554.611 (2012), still says TWO civilian escorts. Three is quoted because it is the newer and stricter published requirement, but the disagreement is unresolved and the escort count should be confirmed with the IDOT permit office. Illinois also does not publish where the third escort rides.',
    },
    IDOT_OPER_993,
    EFF_OPER_993,
  ),
  /**
   * The State Police triggers are numeric and definite, and — unusually —
   * Illinois publishes rates for them. It publishes TWO, and they disagree, so
   * neither is put in the subtotal.
   */
  escortRule(
    'il-state-police-triggers',
    'Over 18 ft wide, over 200 ft long, or over 18 ft high — an Illinois State Police escort is required in addition to the civilian escorts',
    {
      kind: 'any',
      of: [
        { kind: 'gt', measure: 'widthIn', value: ftIn(18) },
        { kind: 'gt', measure: 'overallLengthIn', value: ftIn(200) },
        { kind: 'gt', measure: 'heightIn', value: ftIn(18) },
      ],
    },
    {
      manualReview:
        'Illinois requires a State Police escort over 18 ft wide, over 200 ft long or over 18 ft high, and its two published charging schedules disagree. 625 ILCS 5/15-312 (effective 16 June 2026) charges $40 per hour per vehicle to IDOT with an $80 minimum per vehicle, plus $125 per hour per vehicle to the Illinois State Police with a $500 minimum per vehicle, counting from pickup to completion including delays, with any fraction of an hour rounded up. The still-published administrative rule instead charges $80 per State Police District crossed ($160 for the Chicago District) plus an unstated ISP hourly fee. Neither the officer count nor the hours are known before the move, so no police-escort amount is included in the permit total.',
    },
    ILCS_15_312,
    '2026-06-16',
  ),
  /**
   * Illinois's condition-based triggers and unpriced charges, on one advisory.
   * They are real exclusions from the quote rather than defects in it: an
   * overweight move only needs a State Police escort when the ROUTE's bridge
   * restrictions require a closure, which cannot be known before the permit
   * issues, and blocking every Illinois quote on that possibility would make
   * the state unquotable.
   */
  escortRule(
    'il-conditional-and-unpriced',
    'Illinois adds escort and engineering conditions that are set when the permit issues, and prices several of them only by the hour',
    {
      kind: 'any',
      of: [
        { kind: 'gt', measure: 'widthIn', value: 102 },
        { kind: 'gt', measure: 'heightIn', value: ftIn(13, 6) },
        { kind: 'gt', measure: 'grossWeightLbs', value: 80000 },
      ],
    },
    {
      advisory:
        'Illinois adds charges this quote cannot include. There is no civilian-escort trigger on weight alone, but a State Police escort is required "for overweight moves where bridge restrictions require that all traffic be kept off of a structure while the permitted vehicle crosses", for any move of an unusual nature needing extra traffic control, and whenever the Department Bridge Office analysis calls for one — none of which is knowable before the route is approved. IDOT charges its own staff time at $40 per hour for bridge structural analysis (plus unstated computer costs), pavement structural analysis, field investigation of movement feasibility, accompanying the move and inspecting for damages; the hours are not published. A route survey by the applicant is required at 16 ft or greater in height and must clear every structure by three inches, a District route survey is required at 17 ft or greater, and a District investigation is required over 16 ft wide — Illinois publishes no fixed price for any of them. A $1.00 charge applies if permits are specially transmitted, and $5 for each supplemental permit.',
    },
    IAC_554_1996,
    '1996-01-25',
  ),
];

// ── The oversize fee schedule (625 ILCS 5/15-305) ─────────────────────────

const W10 = ftIn(10);
const W12 = ftIn(12);
const W14 = ftIn(14);
const W18 = ftIn(18);
const H14_6 = ftIn(14, 6);
const H15 = ftIn(15);
const H16 = ftIn(16);
const L70 = ftIn(70);
const L85 = ftIn(85);
const L100 = ftIn(100);
const L120 = ftIn(120);

/** "10 feet or less" — the band survives at exactly 10 ft and stops above it. */
const upTo = (value: number): Threshold => ({ value, inclusive: false });
/** "more than 10 feet" — the band starts only once the measurement passes it. */
const over = (value: number): Threshold => ({ value, inclusive: false });

/** The dimensional part of one row. */
type Shape = Pick<
  OversizeFeeBand,
  | 'overWidthIn'
  | 'upToWidthIn'
  | 'overHeightIn'
  | 'upToHeightIn'
  | 'overLengthIn'
  | 'upToLengthIn'
>;

/**
 * The four mileage steps, reproduced with the statute's own bounds. See point 4
 * of the header for why 90, 180 and 270 deliberately belong to two steps each.
 */
const DISTANCE_STEPS: Array<{ minMiles: number; maxMiles: number | null; label: string }> = [
  { minMiles: 0, maxMiles: 90, label: 'first 90 miles' },
  { minMiles: 90, maxMiles: 180, label: '90 to 180 miles' },
  { minMiles: 180, maxMiles: 270, label: '180 to 270 miles' },
  { minMiles: 270, maxMiles: null, label: 'more than 270 miles' },
];

/**
 * The five statutory categories.
 *
 * Each category is an envelope on width AND height AND length, and each one
 * contains every category below it — so the rows are written as the DIFFERENCE
 * between a category and its predecessor, split into mutually exclusive shapes.
 * Category (b) is "(b) and not (a)", which is (over 10 ft wide) or (over 70 ft
 * long), and that disjunction becomes two rows because `OversizeFeeBand` ANDs
 * its bounds. Without the split a 9-ft-wide 60-ft load would match (a) and (b)
 * at once and the resolver would read two different fees as two sources
 * disagreeing, which they are not.
 */
const CATEGORIES: Array<{
  key: string;
  envelope: string;
  fees: [number, number, number, number];
  shapes: Array<{ label: string; shape: Shape }>;
}> = [
  {
    key: '(a)',
    envelope: 'up to 10 ft wide, 14 ft 6 in high and 70 ft long',
    fees: [12, 15, 18, 21],
    shapes: [
      {
        label: 'within 10 ft wide, 14 ft 6 in high and 70 ft long',
        shape: { upToWidthIn: upTo(W10), upToHeightIn: upTo(H14_6), upToLengthIn: upTo(L70) },
      },
    ],
  },
  {
    key: '(b)',
    envelope: 'up to 12 ft wide, 14 ft 6 in high and 85 ft long',
    fees: [15, 20, 25, 30],
    shapes: [
      {
        label: 'over 10 ft up to 12 ft wide, within 14 ft 6 in high and 85 ft long',
        shape: {
          overWidthIn: over(W10),
          upToWidthIn: upTo(W12),
          upToHeightIn: upTo(H14_6),
          upToLengthIn: upTo(L85),
        },
      },
      {
        label: 'over 70 ft up to 85 ft long, within 10 ft wide and 14 ft 6 in high',
        shape: {
          upToWidthIn: upTo(W10),
          upToHeightIn: upTo(H14_6),
          overLengthIn: over(L70),
          upToLengthIn: upTo(L85),
        },
      },
    ],
  },
  {
    key: '(c)',
    envelope: 'up to 14 ft wide, 15 ft high and 100 ft long',
    fees: [25, 30, 35, 40],
    shapes: [
      {
        label: 'over 12 ft up to 14 ft wide, within 15 ft high and 100 ft long',
        shape: {
          overWidthIn: over(W12),
          upToWidthIn: upTo(W14),
          upToHeightIn: upTo(H15),
          upToLengthIn: upTo(L100),
        },
      },
      {
        label: 'over 14 ft 6 in up to 15 ft high, within 12 ft wide and 100 ft long',
        shape: {
          upToWidthIn: upTo(W12),
          overHeightIn: over(H14_6),
          upToHeightIn: upTo(H15),
          upToLengthIn: upTo(L100),
        },
      },
      {
        label: 'over 85 ft up to 100 ft long, within 12 ft wide and 14 ft 6 in high',
        shape: {
          upToWidthIn: upTo(W12),
          upToHeightIn: upTo(H14_6),
          overLengthIn: over(L85),
          upToLengthIn: upTo(L100),
        },
      },
    ],
  },
  {
    key: '(d)',
    envelope: 'up to 18 ft wide, 16 ft high and 120 ft long',
    fees: [30, 40, 50, 60],
    shapes: [
      {
        label: 'over 14 ft up to 18 ft wide, within 16 ft high and 120 ft long',
        shape: {
          overWidthIn: over(W14),
          upToWidthIn: upTo(W18),
          upToHeightIn: upTo(H16),
          upToLengthIn: upTo(L120),
        },
      },
      {
        label: 'over 15 ft up to 16 ft high, within 14 ft wide and 120 ft long',
        shape: {
          upToWidthIn: upTo(W14),
          overHeightIn: over(H15),
          upToHeightIn: upTo(H16),
          upToLengthIn: upTo(L120),
        },
      },
      {
        label: 'over 100 ft up to 120 ft long, within 14 ft wide and 15 ft high',
        shape: {
          upToWidthIn: upTo(W14),
          upToHeightIn: upTo(H15),
          overLengthIn: over(L100),
          upToLengthIn: upTo(L120),
        },
      },
    ],
  },
  {
    key: '(e)',
    envelope: 'more than 18 ft wide, 16 ft high or 120 ft long',
    fees: [50, 75, 100, 125],
    shapes: [
      { label: 'over 18 ft wide', shape: { overWidthIn: over(W18) } },
      {
        label: 'over 16 ft high, within 18 ft wide',
        shape: { upToWidthIn: upTo(W18), overHeightIn: over(H16) },
      },
      {
        label: 'over 120 ft long, within 18 ft wide and 16 ft high',
        shape: {
          upToWidthIn: upTo(W18),
          upToHeightIn: upTo(H16),
          overLengthIn: over(L120),
        },
      },
    ],
  },
];

/**
 * Categories (d) and (e) carry a stated restriction the fee alone does not
 * show, so it travels on every row that can reach them.
 */
const SPECIAL_CONDITIONS_NOTE =
  '625 ILCS 5/15-305 states that this width is "authorized only under special conditions and for limited distances", so a load in this category may not be permitted on the requested route at any price.';

const oversizeFeeBands: Sourced<OversizeFeeBand>[] = CATEGORIES.flatMap((cat) =>
  cat.shapes.flatMap((s) =>
    DISTANCE_STEPS.map((step, i) =>
      fromDated<OversizeFeeBand>(
        {
          label: `category ${cat.key} — ${s.label}; ${step.label}`,
          ...s.shape,
          minMiles: step.minMiles,
          maxMiles: step.maxMiles,
          feeUsd: cat.fees[i] as number,
        },
        ILCS_15_305,
        EFF_15_305,
        `625 ILCS 5/15-305${cat.key}: ${cat.envelope}; "${step.label === 'first 90 miles' ? 'For the first 90 miles' : step.label === 'more than 270 miles' ? 'For more than 270 miles' : `From ${step.label}`}" $${(cat.fees[i] as number).toFixed(2)}. Rows are written as the difference between this category and the one below it, so exactly one matches any load. ${cat.key === '(d)' || cat.key === '(e)' ? SPECIAL_CONDITIONS_NOTE : ''}`.trim(),
      ),
    ),
  ),
);

// ── The jurisdiction ──────────────────────────────────────────────────────

export const ILLINOIS_OSOW_RULES: JurisdictionOsowRules = {
  code: 'IL',
  name: 'Illinois',
  country: 'US',

  legalLimits: {
    widthIn: [
      fromDated(
        102,
        ILCS_15_102,
        '2022-05-13',
        '§15-102: "On Class III and non-designated State and local highways, the total outside width of any vehicle or load thereon shall not exceed 8 feet 6 inches." Subsection (e) allows the same 8 ft 6 in on Class I, Class II and locally designated highways, so the figure is uniform across highway classes.',
      ),
    ],
    heightIn: [
      fromDated(
        ftIn(13, 6),
        ILCS_15_103,
        '2002-01-01',
        '§15-103: "The height of a vehicle from the under side of the tire to the top of the vehicle, inclusive of load, shall not exceed 13 feet, 6 inches on any highway in the State."',
      ),
    ],
    trailerLengthIn: [
      fromDated(
        ftIn(53),
        ILCS_15_107,
        '2026-01-01',
        '§15-107: "The length of a semitrailer, unladen or with load, in combination with a truck tractor may not exceed 53 feet." A kingpin-to-rear-axle limit also applies — 45 ft 6 in on Class I and Class II highways, 42 ft 6 in on non-designated highways, for a semitrailer longer than 48 ft — and is not modelled, because a quote does not collect the kingpin distance.',
      ),
    ],
    /**
     * 65 ft, with its scope on the row. Illinois states NO overall combination
     * length on Class I or Class II highways; the cap exists only on
     * non-designated highways. Route class is not collected on a quote, so the
     * cap that Illinois does publish is used rather than omitting the field —
     * omitting it would assert that Illinois publishes no overall limit, which
     * is false.
     */
    overallLengthIn: [
      fromDated(
        ftIn(65),
        ILCS_15_107,
        '2026-01-01',
        '§15-107: "On non-designated highways ... A truck tractor in combination with a semitrailer may not exceed 65 feet overall dimension." On Class I and Class II highways "there are no overall length limitations on motor vehicles operating in combinations" provided the 53 ft semitrailer and kingpin limits are met, so a combination over 65 ft may be entirely legal on the designated network and the permit requirement here should be confirmed against the actual route.',
      ),
    ],
    /**
     * A 3 ft front protrusion is where Illinois requires a permit, which is the
     * operative legal limit even though the rule states it as a permit trigger.
     * NO rear-overhang figure is published anywhere in the sources on file, so
     * `rearOverhangIn` is absent rather than empty.
     */
    frontOverhangIn: [
      fromDated(
        ftIn(3),
        IAC_554_2012,
        EFF_554_2012,
        '92 Ill. Adm. Code 554: "Permits are required ... for loads on a single vehicle or on the first vehicle of a combination that protrude 3 feet beyond the front bumper." Illinois publishes no separate front- or rear-overhang ESCORT threshold — its escort triggers are stated in overall width, height and length.',
      ),
    ],
    grossWeightLbs: [
      fromDated(
        80000,
        ILCS_15_111,
        '2026-06-16',
        '§15-111: "80,000 pounds gross weight for vehicle combinations of 5 or more axles", subject also to the federal bridge formula W = 500 x ((LN / (N-1)) + 12N + 36). Axle count, axle spacing and posted restrictions can each produce a lower legal weight.',
      ),
    ],
    singleAxleLbs: [
      fromDated(20000, ILCS_15_111, '2026-06-16', '§15-111: "20,000 pounds on a single axle"'),
    ],
    tandemAxleLbs: [
      fromDated(
        34000,
        ILCS_15_111,
        '2026-06-16',
        '§15-111: "34,000 pounds on a tandem axle with no axle within the tandem exceeding 20,000 pounds."',
      ),
    ],
  },

  /**
   * A SOURCED ZERO. Illinois charges no flat issuance fee on top of the
   * 15-305 schedule — the category-and-distance amount is the whole oversize
   * charge. Recorded rather than omitted so the absence is a finding, and
   * suppressed from the printed lines by the engine so a quote does not show a
   * "$0.00 permit" beside a real fee.
   */
  permitBaseFeeUsd: [
    fromDated(
      0,
      ILCS_15_305,
      EFF_15_305,
      '15-305 prints one amount per category per mileage step and no separate issuance charge. Two optional charges exist and are not included, because neither applies to an ordinary single-trip application: $1.00 "when special transmission of permits by electronic communications equipment is requested", and $5 for each supplemental special permit under 15-313.',
    ),
  ],

  oversizeFeeBands,

  /**
   * No `combinedFeeRule` row. 15-307 states a greater-of rule BETWEEN the two
   * overweight schedules (gross and axle), not between oversize and overweight
   * — for those it says "An additional fee in accordance with the schedule set
   * forth in Section 15-305 shall be charged for each overdimension", which is
   * cumulative and is the engine's default. The "for each overdimension"
   * wording could also be read as charging the 15-305 amount once per
   * over-dimension rather than once per load; the schedule's own categories are
   * three-dimensional envelopes, which reads as one fee per load, and that is
   * what is priced. A load over in more than one dimension should have the
   * count confirmed with the IDOT permit office.
   */

  /**
   * NOT PRICEABLE, and recorded as such rather than left as an empty band list
   * that would render as a $0 overweight line. See point 2 of the header.
   */
  overweightPricing: [
    fromUndatedPage<OverweightPricing>(
      {
        kind: 'notPriceable',
        explanation:
          'IDOT Table 2 selects the overweight fee from twelve categories keyed on total axle count and on front and rear axle-group weights, then prices it in 45-mile steps. Categories f and j both cap at 88,000 lb gross and charge $10 and $20 for the same 0-45 miles, so gross weight alone cannot choose between them, and a quote does not collect axle count or axle-group weights.',
      },
      IDOT_TABLE_2,
    ),
    fromDated<OverweightPricing>(
      {
        kind: 'notPriceable',
        explanation:
          '625 ILCS 5/15-306 prices an overweight AXLE permit from the excess over a 20,000 lb single-axle equivalency per axle or axle group, in 45-mile steps, and marks several combinations "not permitted"; 15-307 then says "one fee only shall be charged, whichever is the greater, but not for both". Both inputs are per-axle. The out-of-category rate — "$50 plus 3.5 cents per ton-mile in excess of legal weight" — applies only to loads already known to fall outside the Table 2 categories, which is the same determination we cannot make. 15-302 additionally requires weights to be taken "to the next highest 1,000 pounds" and distances "from the Illinois Official Highway Map", not from a routing engine.',
      },
      ILCS_15_307,
      '2021-07-23',
    ),
  ],

  overweightBands: [],
  overweightPerMile: [],
  conditionalFees: [],

  /**
   * 2.25% and no flat component — the closest `TransactionFee` can come to
   * Illinois's processor charge. The $1.00 FLOOR cannot be expressed by the
   * type and is recorded on the row instead: on a permit under about $45 the
   * computed percentage is below the minimum and this understates the charge by
   * up to about 45 cents. The E-Check alternative ($0.75 flat, no percentage)
   * is a different payment method and is noted rather than modelled.
   */
  transactionFee: [
    fromDated<TransactionFee>(
      { perPermitUsd: 0, percentOfTotal: 2.25 },
      IDOT_CONVENIENCE,
      '2019-06-01',
      'IDOT: "Credit or Debit card convenience fee is 2.25% of the total amount due (minimum of $1.00)." The $1.00 minimum is NOT applied here — the type has no floor — so a small permit understates this charge slightly. UNKNOWN and recorded rather than assumed: the exact rounding of the percentage, and whether every ancillary charge (police, engineering, supplemental) enters the "total amount due" base. Paying by E-Check instead costs $0.75 per transaction with no percentage. The fee is JetPay\'s, not the State\'s.',
    ),
  ],

  /**
   * Empty, and that is the finding. Illinois publishes no FLAT engineering or
   * route-analysis fee — it bills its own staff time at "$40 per hour" for
   * bridge structural analysis (plus unstated computer costs), pavement
   * analysis, field investigation, accompanying the move and damage inspection.
   * Hours are not knowable before the move, so recording any amount here would
   * be inventing the one input the rule withholds. The exclusion is carried on
   * the advisory escort rule.
   */
  routeAnalysisFeeUsd: [],
  noBridgeRouteFeeUsd: [],

  superload: {
    /**
     * `grossWeight` IS ABSENT, and that is a positive finding rather than a
     * gap. 92 Ill. Adm. Code 554 defines superload treatment qualitatively —
     * "superload moves or moves on nonstandard vehicles or with nonstandard
     * axle configurations may be authorized if allowable pavement and bridge
     * stresses are not exceeded" — and its "practical maximum" weights (120,000
     * lb on a 6-or-more-axle combination, 100,000 lb on a 5-axle, and so on)
     * come with an express warning not to read them as automatic cutoffs. There
     * is no number to hold, and an EMPTY array would warn on every Illinois
     * quote about a threshold Illinois has not written. See `SuperloadTriggers`.
     *
     * `widthIn`, `heightIn` and `overallLengthIn` are absent for the same
     * reason: the (e) category of 15-305 is a FEE band, not a superload
     * definition, and no source calls a load over 18 ft wide a superload.
     */
    /**
     * Illinois DOES have an automatic superload rule, and it is on AXLE
     * SPACING: a towed permit is processed as a superload if the steer to
     * first-tractor-tandem spacing is under 8 ft 1 in, the spacing before the
     * trailer's first axle is under 18 ft 6 in, or the sum of all axle spacings
     * is under 43 ft 6 in. `shortSpacing` pairs one spacing minimum with one
     * weight band and cannot express three independent spacing minima with no
     * weight band at all, and a quote collects none of the three measurements —
     * so the rule is recorded here in words rather than modelled as something
     * it is not.
     */
    shortSpacing: [],
  },

  /**
   * Route-survey triggers. Illinois publishes a LADDER rather than a single
   * threshold on height — the applicant performs the survey at 16 ft or
   * greater, and at 17 ft or greater IDOT District personnel perform one as
   * well. The lower figure is the point at which a survey is first required and
   * is what the trigger records; the escalation is noted on the row rather than
   * added as a second candidate, because two different REQUIREMENTS at two
   * heights are not two sources disagreeing about one threshold and must not
   * resolve as a conflict.
   *
   * `lengthIn` is empty because Illinois publishes no length-based route-survey
   * trigger — that is one of its recorded unknowns, not an oversight here.
   */
  routeInspection: {
    widthIn: [
      fromDated<Threshold>(
        { value: ftIn(16), inclusive: false },
        IAC_554_2012,
        EFF_554_2012,
        '"Moves of vehicles or objects over 16 feet in width require a District investigation."',
      ),
    ],
    heightIn: [
      fromDated<Threshold>(
        { value: ftIn(16), inclusive: true },
        IAC_554_2012,
        EFF_554_2012,
        '"For movements at 16 feet or greater in height, the applicant shall perform a route survey, listing all overhead obstructions ... The surveyed route must clear all structures by three inches." At 17 ft or greater the applicant must additionally contact every overhead-utility owner and IDOT District personnel perform their own route survey. Illinois publishes no price for either.',
      ),
    ],
    lengthIn: [],
  },

  escortRules: ILLINOIS_ESCORT_RULES,

  /**
   * TRUE, and unusually it is the OVERSIZE fee that depends on distance, not
   * the overweight one: every category in 15-305 steps at 90, 180 and 270
   * miles. Illinois cannot be priced without miles travelled inside Illinois,
   * and the engine refuses rather than billing the whole lane to it.
   */
  feesDependOnDistance: true,
};

/** Cited for the escort positions and the height-pole requirement. */
export const ILLINOIS_ESCORT_POSITION_SOURCE = IAC_554_1988;

/** Cited for the $5 supplemental-permit fee, which a single trip does not incur. */
export const ILLINOIS_SUPPLEMENTAL_PERMIT_SOURCE = ILCS_15_313;

/** Cited for the axle-only overweight schedule that makes Illinois unpriceable. */
export const ILLINOIS_AXLE_FEE_SOURCE = ILCS_15_306;

/** Cited for the rounding rules on weight and distance. */
export const ILLINOIS_ROUNDING_SOURCE = ILCS_15_302;

/** Cited for the statutory IDOT and Illinois State Police escort charges. */
export const ILLINOIS_POLICE_ESCORT_RATE_SOURCE = ILCS_15_312;

/**
 * Cited for the STILL-PUBLISHED administrative rule that charges per State
 * Police District crossed instead of per hour — the other half of Illinois's
 * live disagreement about what a trooper escort costs.
 */
export const ILLINOIS_POLICE_ESCORT_RULE_SOURCE = IAC_554_2012;
