/**
 * MISSISSIPPI — oversize/overweight single-trip permit rules.
 *
 * THE OVERWEIGHT FEE IS PRINTED IN THE WRONG UNIT AND THERE IS NOTHING TO CHECK
 * IT AGAINST.
 * ------------------------------------------------------------------------
 * MDOT's fee sheet reads: "Overweight is charged for weight exceeding 80,000
 * lbs. or over axle for weights exceeding 20,000 lbs. on a single axle or 34,000
 * lbs. on a tandem at .05 cents per thousand lbs. times the miles traveled."
 *
 * ".05 cents" IS $0.0005. The figure the sheet almost certainly means is $0.05.
 * That is a factor of ONE HUNDRED — a hundredth of a cent against five cents —
 * and 100,000 lb over 100 Mississippi miles is $1.00 on one reading and $100.00
 * on the other. (OUR ARITHMETIC, and it corrects the research brief this file was
 * written from, which called the spread 200x while its own worked example gave
 * the same $1.00 against $100.00. Five cents divided by a hundredth of a cent is
 * a hundred; the figure recorded here is the one the worked example supports.)
 * There is no second source
 * to break the tie: Miss. Code Ann. § 63-5-51 authorises the permit and SETS NO
 * FEE, and the Rule and the Manual both describe overweight pricing as "based on
 * weight and per mile travel" without stating a rate. A single-source figure
 * whose own unit is self-contradictory.
 *
 * Three more things the same sentence does not say, and each moves the price:
 *   - THE PARTIAL INCREMENT. Nothing says whether a part-thousand pounds rounds
 *     up, rounds down or bills pro rata.
 *   - THE PARTIAL MILE. Nothing says whether mileage is whole miles, rounded, or
 *     true distance.
 *   - WHICH EXCESS. The sentence names three independent triggers — gross over
 *     80,000, single axle over 20,000, tandem over 34,000 — joined by "or", and
 *     does not say whether the charge runs on the gross excess, the worst axle
 *     excess, or their sum. On a load legal on gross and over on one axle there
 *     is no stated basis at all.
 *
 * So `overweightPricing` is `notPriceable` and EVERY MISSISSIPPI OVERWEIGHT
 * QUOTE GOES TO MANUAL REVIEW. `overweightPerMile` is deliberately EMPTY rather
 * than holding the $0.05 shape: populating it would make the engine pick a
 * reading, and the shape is recorded in prose instead — see
 * `MISSISSIPPI_OVERWEIGHT_RATE_UNIT_CONFLICT`.
 *
 * ── TWO LIVE, DISAGREEING MDOT DOCUMENTS ─────────────────────────────────
 * The RULE — Sub-Part 6601, Chapter 03001, adopted by the Mississippi
 * Transportation Commission and published with the Secretary of State, PDF
 * internally created 2020-04-01 — and the MANUAL, the Permit & Motor Carrier
 * Division Manual with a printed cover date of 9/21/2024, which the MDOT permits
 * portal links from every permit type. Same lineage; the Manual is a 2024
 * expansion of the 2020 Rule. On NINE points they disagree, and NEITHER HAS BEEN
 * ADOPTED. The Rule is the legally adopted instrument; the Manual is newer and
 * says of itself that "nothing herein is meant to exceed the authority of the
 * Commission granted by law". That is an argument, not an answer.
 *
 *  1. THE OVERWEIGHT RATE UNIT — above, and `MISSISSIPPI_OVERWEIGHT_RATE_UNIT_CONFLICT`.
 *  2. POLICE-ESCORT WIDTH: the Rule's 20 ft against the Manual's 18 ft. A
 *     two-foot band, live on `ms-police-escort-width-18-vs-20`.
 *  3. UTILITY / RAILROAD NOTIFICATION: the Rule's 16 ft against the Manual's
 *     16 ft 7 in. Live on `ms-utility-railroad-height-16-vs-16-7`.
 *  4. THE SPECIAL HEAVY HAUL AXLE TABLE, REWRITTEN WHOLESALE — six-axle gross
 *     120,000 against 117,000, quad 80,000 against 60,000. See
 *     `MISSISSIPPI_SPECIAL_HEAVY_HAUL_TABLE_CONFLICT`.
 *  5. "THE LEGAL WEIGHT OF 80,000 POUNDS" against § 63-5-29's 57,650 lb cap on
 *     undesignated highways. Live in `legalLimits.grossWeightLbs`, where both
 *     rows are on file and the resolver refuses to pick.
 *  6. THE SUPERLOAD WEIGHT BOUNDARY CONTRADICTS ITSELF INSIDE ONE SENTENCE —
 *     "exceeds any of the following limits: ... 189,999 pounds or greater". Live
 *     in `superload.grossWeight`, as two rows from one document.
 *  7. THE OVERSIZE BLANKET ENVELOPE gains a height limit in the Manual. See
 *     `MISSISSIPPI_BLANKET_ENVELOPE_CONFLICT`.
 *  8. THE POLE BLANKET: $200 a YEAR on the fee sheet, $200 a MONTH in the
 *     Manual. Twelvefold. See `MISSISSIPPI_POLE_BLANKET_CONFLICT`.
 *  9. INSURANCE: a DOT number OR a certificate in the Rule, AND in the Manual,
 *     with the Rule's exception clause deleted. Live on
 *     `ms-insurance-or-versus-and`.
 *
 * ── THE 57,650 LB TABLE NOBODY MENTIONS ──────────────────────────────────
 * Miss. Code Ann. § 63-5-29 Table I governs "all highways of the State of
 * Mississippi except those referred to in Sections 63-5-31 and 63-5-33" and tops
 * out at 57,650 lb. The 80,000 lb figure is § 63-5-33 Table III and applies only
 * "on those highways or parts of highways designated by the Mississippi
 * Transportation Commission as being capable of carrying the maximum load
 * limits" — designation by an order "entered upon its minutes and published once
 * each week for three (3) consecutive weeks in a daily newspaper". NO
 * CONSOLIDATED LIST OR MAP OF DESIGNATED HIGHWAYS WAS LOCATED, so the engine
 * cannot tell which table a Mississippi segment falls under.
 *
 * That is why no `ms-` route class was minted for it: a vocabulary member no
 * caller could ever answer is worse than an honest conflict. Both weights are on
 * file, `resolveSourced` refuses to pick, and `ms-overweight-charge-not-priceable`
 * states on every overweight quote what is missing and why no figure is given.
 *
 * ── ESCORT COUNTS FOR LENGTH AND OVERHANG ARE INDETERMINATE ──────────────
 * Three separate rules say a move "will require a permit and a FRONT AND/OR REAR
 * escort". "And/or" states no count, and the count is what costs money. Those
 * three go to review rather than to a guess. The WIDTH rules, by contrast, are
 * fully determinate — one front escort on a Two Lane Roadway, one rear on a
 * Divided Highway — and are priced.
 *
 * ── MISSISSIPPI'S ROAD VOCABULARY MAPS ONTO THE GENERAL ONE ──────────────
 * The Manual defines exactly two classes: "Two Lane Roadway - one lane per
 * direction of travel" and "Divided Highway - two (2) or more through lanes per
 * direction of travel". THE SECOND NAME LIES AND THE DEFINITION GOVERNS: a
 * four-lane UNDIVIDED arterial is a "Divided Highway" for escort purposes
 * because it has two through lanes each way. So `divided`, `multilane-undivided`
 * and `interstate` all satisfy it and every width rule below names all three; no
 * `ms-` member was minted, because a private synonym for a definition the general
 * vocabulary already expresses is a member a caller cannot know to pass.
 *
 * THE PAIR IS NOT EXHAUSTIVE, and that is handled explicitly. An `urban` street
 * answers NEITHER definition, and `ms-road-class-answers-neither` sends it to
 * review instead of letting it fall silently through to "no escort".
 *
 * ── SOURCE QUALITY ───────────────────────────────────────────────────────
 * The official Mississippi Code is a LexisNexis product with no free official
 * host; law.justia.com returned HTTP 403 to a plain fetch and to a full headless
 * browser session. Every statutory figure below therefore comes from
 * codes.findlaw.com, which reproduces the text and is a SECONDARY publisher —
 * marked in every source title, following the Texas and Tennessee precedent. No
 * Mississippi statutory text here has been read against an official primary
 * source. FindLaw's own snapshot is demonstrably stale in at least one place:
 * § 63-5-33(5)(d) contains a repealer that has already fired ("This subsection
 * (5) shall stand repealed from and after July 1, 2025") and the 2025-01-01
 * snapshot still prints the subsection.
 *
 * THE FEE SHEET — the SOLE SOURCE FOR EVERY MISSISSIPPI PRICE — carries no
 * printed revision date at all and its PDF was created on 2019-11-14. There is
 * no statutory backstop. `revisedOn` is null and `effectiveFrom` is our
 * retrieval date.
 */
import type { SourceDoc, Sourced } from '../provenance.js';
import { ftIn, type EscortRule } from '../escortRules.js';
import type {
  JurisdictionOsowRules,
  OverweightPricing,
  Threshold,
} from '../types.js';

const RETRIEVED = '2026-09-05';

// ── Source documents ──────────────────────────────────────────────────────

/**
 * EVERY MISSISSIPPI PRICE RESTS ON THIS ONE UNDATED SHEET. No printed revision
 * date anywhere on it; PDF internal creationDate 2019-11-14. § 63-5-51 sets no
 * fee, so there is nothing to cross-check it against.
 */
const FEE_SHEET: SourceDoc = {
  id: 'msdot-permit-fees-sheet',
  title: 'MDOT — Permit and Blanket Fees (ExpressPass)',
  url: 'https://permits.mdot.ms.gov/PermitFees.pdf',
  publisher: 'Mississippi Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'Flat Permit Fees and Blanket Fees; no printed revision date; PDF created 2019-11-14',
};

/** The newer of the two live documents, and the only one with a date on its face. */
const MANUAL: SourceDoc = {
  id: 'msdot-permits-manual-2024-09-21',
  title: 'MDOT — Permit & Motor Carrier Division Manual (9/21/2024)',
  url: 'https://mdot.ms.gov/documents/Enforcement/Permits/Permits%20Manual%2009.21.24.pdf',
  publisher: 'Mississippi Department of Transportation',
  revisedOn: '2024-09-21',
  retrievedOn: RETRIEVED,
  cite: 'cover "PERMIT & MOTOR CARRIER DIVISION MANUAL 9/21/2024"; definitions 2, 3, 4, 15, 18, 19, 21; General Permit Regulations; Super Load section',
};

/**
 * The Commission-adopted, Secretary-of-State-published instrument — and the
 * OLDER of the two. No printed revision date; PDF internally created
 * 2020-04-01, so `effectiveFrom` is our retrieval date.
 */
const RULE: SourceDoc = {
  id: 'msdot-permit-rules-6601-03001',
  title: 'MDOT — Over-Dimensional Permits, Sub-Part 6601 Ch. 03001 (Commission Rule)',
  url: 'https://mdot.ms.gov/documents/Enforcement/Permits/Permit%20Rules.pdf',
  publisher:
    'Mississippi Transportation Commission, published with the Mississippi Secretary of State',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: '§§ 200, 201, 213, 301, 308-313, 318, 400, 403, 800-804, 900; no printed revision date; PDF created 2020-04-01',
};

function statute(section: string, slug: string, cite: string): SourceDoc {
  return {
    id: `ms-code-${section.replace(/[^0-9]/g, '-')}`,
    title: `Miss. Code Ann. § ${section} (via FindLaw — SECONDARY source)`,
    url: `https://codes.findlaw.com/ms/title-63-motor-vehicles-and-traffic-regulations/ms-code-sect-${slug}/`,
    publisher: 'FindLaw, reproducing the Mississippi Code Annotated',
    revisedOn: '2025-01-01',
    retrievedOn: RETRIEVED,
    cite: `${cite}; FindLaw states "Current as of January 01, 2025"`,
  };
}

const MS_63_5_13 = statute('63-5-13', '63-5-13', 'width, 8 1/2 feet');
const MS_63_5_17 = statute(
  '63-5-17',
  '63-5-17',
  'height 13 ft 6 in, and the separate 12 ft 6 in liability line',
);
const MS_63_5_19 = statute(
  '63-5-19',
  '63-5-19',
  'single vehicle 40 ft; semitrailer 53 ft; three-unit trailer 30 ft; the 28 ft forest-product rear projection; NO overall combination length',
);
const MS_63_5_27 = statute(
  '63-5-27',
  '63-5-27',
  '20,000 lb single axle and 34,000 lb tandem, exclusive of the § 63-5-33 tolerance; 550 lb per inch of tyre width',
);
const MS_63_5_29 = statute(
  '63-5-29',
  '63-5-29',
  'Table I — undesignated highways, "36 and greater — 57,650 maximum", measured longitudinally to the nearest foot',
);
const MS_63_5_33 = statute(
  '63-5-33',
  '63-5-33',
  'Table III — 80,000 lb, but only on highways the Commission has designated as capable of the maximum load limits; the federal bridge formula',
);
const MS_63_5_51 = statute(
  '63-5-51',
  '63-5-51',
  'the permit authority itself — subsections (1)(a)-(d) and (2) read in full, and NO fee, formula or fee-setting delegation appears anywhere in it',
);

const FHWA_PEVO: SourceDoc = {
  id: 'fhwa-pevo-study-guide',
  title: 'FHWA — Pilot/Escort Vehicle Operator (P/EVO) Best Practices Guide',
  url: 'https://ops.fhwa.dot.gov/publications/fhwahop16054/pevo_study_gde.htm',
  publisher: 'Federal Highway Administration',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: '"As of early 2016, States that require P/EVOs be certified include Arizona, Colorado, Florida, Georgia, Minnesota, New York, North Carolina, Oklahoma, Utah, Virginia, and Washington."',
};

// ── The findings that are not values ──────────────────────────────────────

/**
 * CONFLICT 1 — the rate unit, a hundredfold apart, with no statutory tiebreak.
 *
 * Held as a constant rather than as a `PerMileRate` row because a row would
 * force the engine to price one of the two readings. The shape IS a
 * `PerMileRate` — rate x miles x increments, with `perIncrementLbs` 1,000 and
 * `excessBaseLbs` 80,000 — and that is exactly why it is not encoded: three of
 * the five fields the shape needs are unpublished.
 */
export const MISSISSIPPI_OVERWEIGHT_RATE_UNIT_CONFLICT = {
  quote:
    'Overweight is charged for weight exceeding 80,000 lbs. or over axle for weights exceeding 20,000 lbs. on a single axle or 34,000 lbs. on a tandem at .05 cents per thousand lbs. times the miles traveled.',
  literalUsdPerThousandLbPerMile: 0.0005,
  intendedUsdPerThousandLbPerMile: 0.05,
  factor: 100,
  detail:
    'Read literally, ".05 cents" is $0.0005 per 1,000 lb per mile and a 100,000 lb load over 100 Mississippi miles costs $1.00 in excess-weight charge. Read as the industry reads it — five cents, $0.05 — the same move costs $100.00. A factor of ONE HUNDRED, in the only document that states a Mississippi permit price. There is NO statutory backstop: Miss. Code Ann. § 63-5-51 authorises the permit and sets no fee, no formula and no fee-setting delegation, and both the Rule and the Manual describe overweight pricing as "based on weight and per mile travel" without a rate. Three further inputs the same sentence never supplies: whether a part-thousand pounds rounds up, down or pro rata; whether mileage is whole miles, rounded or true distance; and WHICH excess the charge runs on, since gross over 80,000, a single axle over 20,000 and a tandem over 34,000 are joined by "or" with no stated basis. Neither reading has been adopted and no Mississippi overweight amount is quoted.',
} as const;

/** CONFLICT 4 — the Special Heavy Haul axle table, rewritten wholesale. */
export const MISSISSIPPI_SPECIAL_HEAVY_HAUL_TABLE_CONFLICT = {
  product: 'Special Heavy Haul / Special Heavy Equipment Blanket Permit, $4,500 per year',
  detail:
    'Both documents print a table headed "Maximum Axle Weights and Minimum Spacing / Special Heavy Haul Blanket Permit" and they do not agree on a single row above five axles. SIX AXLES: the Rule prints 80,000-120,000 lb with a 14,000 lb steering axle, a 42,000 lb tandem and a 64,000 lb tri-axle; the Manual prints 80,000-117,000 lb with a 15,000 lb steering axle, a 45,000 lb tandem and a 57,000 lb triaxle. SEVEN AXLES OR MORE: the Rule prints 80,000-150,000 lb with a 56,000 lb tandem and an 80,000 lb quad; the Manual prints 80,000-142,000 lb with a 45,000 lb tandem and a 60,000 lb quad. The Manual also introduces an "Eight Axles or More (80,000 lbs. to 150,000 lbs.)" row the Rule does not have. The differences run to 20,000 lb on a quad group and 8,000 lb of allowed gross. The five-axle row (14,000 / 40,500 / 40,500) is the one row both share. Anyone pricing a Mississippi Special Heavy Haul move must know which table the permit writer is using. Neither has been adopted, and this engine does not price the annual blanket product.',
} as const;

/** CONFLICT 7 — the annual Oversize Blanket envelope gains a height limit. */
export const MISSISSIPPI_BLANKET_ENVELOPE_CONFLICT = {
  product: 'Oversize Blanket Permit, $100 per year per company',
  detail:
    'Rule § 900: "Authorizes the movement of loads not exceeding 14 feet in width, 120 feet in length with no more than 14 feet 11 inches rear overhang and must be one continuous piece." — no height at all. Manual: "This permit authorizes the movement of loads not exceeding fourteen (14) feet in width, FOURTEEN (14) FEET IN HEIGHT, one hundred twenty (120) feet in length, with no more than fourteen (14) feet eleven (11) inches rear overhang." A 14 ft 6 in high, 12 ft wide load is inside the Rule’s envelope and outside the Manual’s — covered by the $100 annual blanket under one document and needing a separate single-trip permit under the other.',
} as const;

/** CONFLICT 8 — twelvefold, on what $200 buys. */
export const MISSISSIPPI_POLE_BLANKET_CONFLICT = {
  product: 'Pole Blanket Permit, $200',
  detail:
    'The fee sheet lists "Pole Blanket $200.00" under Blanket Fees and states that "The Blanket Permits are not prorated, all permits are issued for one (1) year unless otherwise specified". The Manual states "The Pole Blanket Permit is valid for one (1) month at a cost of $200.00 per fleet of vehicles." A twelvefold difference in what $200 buys. The fee sheet’s "unless otherwise specified" arguably yields to the Manual, but the fee sheet does not itself specify otherwise. Both on file; neither adopted.',
} as const;

// ── Helpers ───────────────────────────────────────────────────────────────

const MANUAL_FROM = '2024-09-21';
const STATUTE_FROM = '2025-01-01';

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
 * A row from an UNDATED document — the fee sheet and the Commission Rule are
 * both undated. `effectiveFrom` is the retrieval date, because that is the only
 * date on which we can prove what they said.
 */
function fromUndated<T>(value: T, source: SourceDoc, note?: string): Sourced<T> {
  return {
    value,
    source,
    effectiveFrom: RETRIEVED,
    effectiveTo: null,
    ...(note === undefined ? {} : { note }),
  };
}

// ── Escort rules ──────────────────────────────────────────────────────────

function escortRule(
  id: string,
  description: string,
  when: EscortRule['when'],
  then: EscortRule['then'],
  source: SourceDoc = MANUAL,
  effectiveFrom: string = MANUAL_FROM,
): EscortRule {
  return {
    id,
    jurisdiction: 'MS',
    description,
    when,
    then,
    source,
    effectiveFrom,
    effectiveTo: null,
  };
}

/** Mississippi's "Divided Highway" is defined by lane count, not by a median. */
const MS_DIVIDED_HIGHWAY: EscortRule['when'] = {
  kind: 'routeClass',
  anyOf: ['divided', 'multilane-undivided', 'interstate'],
};

const MS_TWO_LANE_ROADWAY: EscortRule['when'] = {
  kind: 'routeClass',
  anyOf: ['two-lane'],
};

/** True of any load needing a Mississippi over-dimensional permit. */
const NEEDS_A_MISSISSIPPI_PERMIT: EscortRule['when'] = {
  kind: 'any',
  of: [
    { kind: 'gt', measure: 'widthIn', value: 102 },
    { kind: 'gt', measure: 'heightIn', value: ftIn(13, 6) },
    { kind: 'gt', measure: 'overallLengthIn', value: ftIn(99) },
    { kind: 'gt', measure: 'trailerLengthIn', value: ftIn(53) },
    { kind: 'gt', measure: 'frontOverhangIn', value: ftIn(3) },
    { kind: 'gt', measure: 'grossWeightLbs', value: 57650 },
  ],
};

export const MISSISSIPPI_ESCORT_RULES: EscortRule[] = [
  /**
   * THE DETERMINATE CASE, and the only Mississippi escort rules that can be
   * priced. Daylight, and the count is one either way — only the position
   * changes with the road, which is exactly what `front`/`rear` are for.
   */
  escortRule(
    'ms-day-two-lane-width-13',
    'Daylight on a Two Lane Roadway, 13 ft wide or more — one FRONT escort',
    {
      kind: 'all',
      of: [{ kind: 'gte', measure: 'widthIn', value: ftIn(13) }, MS_TWO_LANE_ROADWAY],
    },
    { escorts: 1, front: 1 },
  ),
  escortRule(
    'ms-day-divided-width-13',
    'Daylight on a Divided Highway (two or more through lanes per direction), 13 ft wide or more — one REAR escort',
    {
      kind: 'all',
      of: [{ kind: 'gte', measure: 'widthIn', value: ftIn(13) }, MS_DIVIDED_HIGHWAY],
    },
    { escorts: 1, rear: 1 },
  ),
  /**
   * THE GAP THE TWO-CLASS VOCABULARY LEAVES. Mississippi defines a Two Lane
   * Roadway and a Divided Highway and nothing else, and an `urban` street or an
   * unclassified segment answers neither. Falling through to "no escort" would
   * drop a real pilot car on the strength of a definition that does not reach
   * the road.
   */
  escortRule(
    'ms-road-class-answers-neither',
    'A route that is neither a Two Lane Roadway nor a Divided Highway leaves the width escort rules undecided',
    {
      kind: 'all',
      of: [
        { kind: 'gte', measure: 'widthIn', value: ftIn(13) },
        { kind: 'not', of: { kind: 'any', of: [MS_TWO_LANE_ROADWAY, MS_DIVIDED_HIGHWAY] } },
      ],
    },
    {
      manualReview:
        'Mississippi’s escort rules turn on exactly two defined road classes — "Two Lane Roadway - one lane per direction of travel" and "Divided Highway - two (2) or more through lanes per direction of travel" — and this route answers neither. The pair is not exhaustive over the general road vocabulary, so no escort count has been derived. The requirement must be confirmed with the MDOT Permit Division.',
    },
  ),
  /**
   * NIGHT MOVES ESCORT THREE FEET LOWER, and this quote prices a daylight move.
   * Stated rather than encoded, because the grammar has no notion of time of day
   * and adding a subjective "is this a night move?" question would send every
   * Mississippi quote in the band to review over a fact most callers never
   * intend.
   */
  escortRule(
    'ms-night-movement-escorts-at-10ft',
    'At night the escort threshold drops from 13 ft to 10 ft — this quote prices a daylight move',
    {
      kind: 'all',
      of: [
        { kind: 'gte', measure: 'widthIn', value: ftIn(10) },
        { kind: 'between', measure: 'widthIn', min: ftIn(10), max: ftIn(13), maxInclusive: false },
      ],
    },
    {
      advisory:
        'Mississippi escorts three feet lower at night than by day: "When moving at night operating on a Two Lane Roadway, loads ten (10) feet wide or greater will require, at minimum, the use of a front escort", and the same at ten feet on a Divided Highway with a rear escort. Under ten feet the Manual is explicit that "No escort is required." This load is between 10 ft and 13 ft wide, so it needs an escort at night and none by day. THIS QUOTE PRICES A DAYLIGHT MOVE — OUR READING, and the cheaper one. Note also that Mississippi NARROWS the day by half an hour at each end for a load over 12 ft wide ("thirty (30) minutes after sunrise to thirty (30) minutes before sunset"), where Texas, Tennessee and Michigan all widen it.',
    },
  ),
  /**
   * THE NIGHT-MOVEMENT SENTENCE IS BROKEN, IDENTICALLY, IN BOTH DOCUMENTS.
   */
  escortRule(
    'ms-night-movement-sentence-defective',
    'The night-movement eligibility sentence reads as a disjunction and inverts its own polarity',
    NEEDS_A_MISSISSIPPI_PERMIT,
    {
      advisory:
        'Manual and Rule § 313, identically: "Night movements may be permitted for loads not exceeding twelve (12) feet in width, or 150,000 pounds or ninety-nine (99) feet long or height exceeding thirteen (13) feet six (6) inches (the maximum height is dependent on the route). Maximum rear overhang is four (4) feet." The disjunctions should almost certainly be conjunctions, and the last clause inverts the polarity mid-sentence — read literally, a load qualifies for night movement if it satisfies ANY one condition, including BEING OVER 13 ft 6 in high. No reading has been adopted and no night-movement eligibility is asserted by this quote.',
    },
  ),
  /**
   * CONFLICT 2, surfaced only in the band where the two documents actually
   * differ. Above 20 ft both contemplate a police escort and there is nothing to
   * disagree about.
   */
  escortRule(
    'ms-police-escort-width-18-vs-20',
    'Between 18 ft and 20 ft wide the Manual contemplates a police escort and the Commission Rule does not',
    {
      kind: 'between',
      measure: 'widthIn',
      min: ftIn(18),
      max: ftIn(20),
      maxInclusive: false,
    },
    {
      manualReview:
        'The Commission Rule § 318.3 reads "Police escorts may be required for all loads 20 Feet wide and over depending on the route and load conditions." The 2024 Manual reads "A police escort (“blue lights”) may be required for all loads eighteen (18) feet wide and over, depending on the route and load conditions, and at the discretion of the Executive Director or the Commission." Both are current MDOT publications linked from mdot.ms.gov; the Rule is the adopted instrument and the Manual is newer and adds a discretion clause the Rule lacks. This load falls in the two-foot band where they disagree. Neither has been adopted, and Mississippi publishes NO law-enforcement escort rate of any kind, so no police cost is included either way.',
    },
  ),
  escortRule(
    'ms-police-escort-width-over-20',
    '20 ft wide or more — both documents contemplate a police escort, and neither prices one',
    { kind: 'gte', measure: 'widthIn', value: ftIn(20) },
    {
      advisory:
        'Both the Commission Rule and the 2024 Manual say a police ("blue light") escort MAY be required at this width, at the discretion of the Executive Director or the Commission. Neither states how many officers, and neither MDOT nor the Mississippi Department of Public Safety publishes an hourly rate, a minimum, a mileage charge or a cancellation charge. No police-escort cost is included in this quote and no industry range has been substituted.',
    },
  ),
  /**
   * THE THREE INDETERMINATE RULES. "A front AND/OR rear escort" states no count,
   * and a count is what costs money.
   */
  escortRule(
    'ms-length-over-99-escort-count-indeterminate',
    'Over 99 ft overall — "a front and/or rear escort", with no count stated',
    { kind: 'gt', measure: 'overallLengthIn', value: ftIn(99) },
    {
      manualReview:
        'Manual and Rule § 311, identically: "Vehicles with a total length exceeding ninety-nine (99) feet will require a permit and a front and/or rear escort." "And/or" does not say whether that is one escort or two, or which end, and one pilot car either way is the difference between one engagement and two on every over-99-ft Mississippi lane. No escort count has been derived. Note also that Miss. Code Ann. § 63-5-19 was read in full and sets NO overall combination length limit at all — the 99 ft figure is MDOT’s, appears identically in both documents, and is treated by MDOT as the legal length.',
    },
  ),
  escortRule(
    'ms-rear-overhang-15-escort-count-indeterminate',
    'Rear overhang of 15 ft or more — "a front and/or rear escort", with no count stated',
    { kind: 'gte', measure: 'rearOverhangIn', value: ftIn(15) },
    {
      manualReview:
        'Manual and Rule § 309: "A rear overhang of fifteen (15) feet or greater will require a permit and a front and/or rear escort. Forest products may have a twenty-eight (28) foot overhang but only daylight movement is allowed." Inclusive at 15 ft, and no escort count is stated. The 28 ft forest-product allowance has statutory backing in § 63-5-19(6), which measures the projection "beyond the rear axle" where MDOT measures overhang — different datums, same number.',
    },
  ),
  escortRule(
    'ms-front-projection-15-escort-count-indeterminate',
    'Front projection of 15 ft or more — "front and/or rear escort", with no count stated',
    { kind: 'gte', measure: 'frontOverhangIn', value: ftIn(15) },
    {
      manualReview:
        'Manual and Rule § 310: "Front projection exceeding three (3) feet will require a permit. Projection of fifteen (15) feet or greater requires front and/or rear escort." TWO DIFFERENT BOUNDARY WORDS IN ONE SENTENCE — the permit trigger is exclusive at 3 ft and the escort trigger inclusive at 15 ft — and both are preserved exactly. No escort count is stated.',
    },
  ),
  /**
   * MISSISSIPPI'S WEIGHT-BASED ESCORT TRIGGER. STATED AFFIRMATIVELY: this state
   * DOES publish one, at 300,000 lb, inclusive, and it appears ONLY in the 2024
   * Manual — the 2020 Rule has no weight-keyed escort rule at all. Between
   * 189,999 lb and 300,000 lb there is no published escort requirement keyed to
   * weight.
   */
  escortRule(
    'ms-superload-blue-lights-weight-300000',
    '300,000 lb or more — two blue-light (police) escorts, one front and one rear',
    { kind: 'gte', measure: 'grossWeightLbs', value: 300000 },
    {
      policeFront: 1,
      policeRear: 1,
      advisory:
        'Manual, Super Load requirements iv: "Two blue light escorts are required for loads 300,000 pounds or more. Exceptions may be allowed at the discretion of the MDOT Permit Division Director, based on the load’s route." Inclusive. This is Mississippi’s ONLY weight-keyed escort rule and it is NOT in the 2020 Commission Rule, which has no weight escort trigger at all. Mississippi publishes no law-enforcement escort rate, so the two officers are required and unpriced.',
    },
  ),
  escortRule(
    'ms-superload-blue-lights-length-160',
    '160 ft or more overall — two blue-light (police) escorts, one front and one rear',
    { kind: 'gte', measure: 'overallLengthIn', value: ftIn(160) },
    {
      policeFront: 1,
      policeRear: 1,
      advisory:
        'Manual, Super Load requirements ii: "Two blue light escorts (one front/ one rear) on all loads beginning at one hundred sixty (160) feet in total length." Inclusive, and not in the 2020 Rule. Unpriced — Mississippi publishes no officer rate.',
    },
  ),
  escortRule(
    'ms-superload-height-15-9-three-escorts',
    '15 ft 9 in or more high — two blue-light escorts PLUS a height-pole escort',
    { kind: 'gte', measure: 'heightIn', value: ftIn(15, 9) },
    {
      policeFront: 1,
      policeRear: 1,
      front: 1,
      heightPole: true,
      advisory:
        'Manual, Super Load requirements iii: "Two blue light escorts along with a height pole escort will be required on loads starting at fifteen (15) feet (9) inches tall or more." (The "(9) inches" is a typographical slip for "nine (9) inches" and is reproduced as printed.) THREE escorts at 15 ft 9 in against ONE height pole at 15 ft 7 in — a two-inch band. Not in the 2020 Rule. The two officers are unpriced.',
    },
  ),
  escortRule(
    'ms-height-pole-15-7',
    '15 ft 7 in or more high — a height pole is required',
    { kind: 'gte', measure: 'heightIn', value: ftIn(15, 7) },
    {
      heightPole: true,
      advisory:
        'Manual, Super Load requirements i: "A height pole will be required if the load is fifteen (15) feet seven (7) inches tall or more." Inclusive, and the figure equals the superload height threshold exactly, so the pole attaches at the moment a load becomes a superload. NOT IN THE 2020 RULE AT ALL — the Rule’s traffic-control-plan section ends at the encroachment questions and contains no height pole, no blue-light thresholds and no weight escort trigger. Nothing contradicts it; it is simply newer.',
    },
  ),
  /**
   * A POSITIVE FINDING: Mississippi publishes NO general height-based escort
   * trigger. The complete escort clause was quoted and contains no height
   * figure; height escorting exists only inside the Super Load process.
   */
  escortRule(
    'ms-no-general-height-escort-trigger',
    'Below the superload height there is no published height-based escort requirement at all',
    {
      kind: 'between',
      measure: 'heightIn',
      min: ftIn(13, 6),
      max: ftIn(15, 7),
      minInclusive: false,
      maxInclusive: false,
    },
    {
      advisory:
        'Mississippi’s complete escort clause (Manual General Permit Regulation 18) keys on width, on bridges and on police discretion and contains NO height figure. Height-based escorting exists only inside the Super Load process, which starts at 15 ft 7 in. An ordinary permit at, say, 15 ft 0 in high therefore carries no published escort or height-pole requirement in Mississippi. Stated affirmatively: this is a published absence, not an unsearched gap.',
    },
  ),
  /**
   * THE PRICING BLOCK'S VOICE ON EVERY OVERWEIGHT MOVE. Fires wherever any
   * Mississippi weight question can arise — at 57,651 lb, the lower of the two
   * gross limits on file.
   */
  escortRule(
    'ms-overweight-charge-not-priceable',
    'No Mississippi overweight amount is quoted: the published rate is printed in the wrong unit and the applicable weight table is undetermined',
    { kind: 'gt', measure: 'grossWeightLbs', value: 57650 },
    {
      manualReview: `${MISSISSIPPI_OVERWEIGHT_RATE_UNIT_CONFLICT.detail} Separately, WHICH WEIGHT TABLE APPLIES IS ALSO UNDETERMINED: MDOT’s Manual states flatly that "A Single Trip – Overweight permit must be purchased if the truck, trailer and load combined exceed the legal weight of 80,000 pounds", with no route qualifier, while Miss. Code Ann. § 63-5-29 Table I caps "all highways of the State of Mississippi except those referred to in Sections 63-5-31 and 63-5-33" at 57,650 lb and § 63-5-33 confines the 80,000 lb table to highways the Commission has designated by an order "published once each week for three (3) consecutive weeks in a daily newspaper". No consolidated list or map of designated highways was located, so the engine cannot say which table a Mississippi segment falls under — a 22,350 lb difference in the legal ceiling.`,
    },
    FEE_SHEET,
    RETRIEVED,
  ),
  /** CONFLICT 3, surfaced only in the seven-inch band where it bites. */
  escortRule(
    'ms-utility-railroad-height-16-vs-16-7',
    'Between 16 ft and 16 ft 7 in high the Rule requires utility and railroad sign-off and the Manual does not',
    {
      kind: 'between',
      measure: 'heightIn',
      min: ftIn(16),
      max: ftIn(16, 7),
      minInclusive: false,
      maxInclusive: true,
    },
    {
      manualReview:
        'Rule § 801.5: "Written acknowledgement and permission from utility and railroad companies are required for a load exceeding 16 feet in height." Manual, Super Load application item 5: "Written acknowledgement and permission from the affected utility and railroad companies are required for a load exceeding sixteen (16) feet seven (7) inches in height." A seven-inch band in which one document requires utility sign-off — a real scheduling and cost item — and the other does not. Neither has been adopted and no utility-coordination cost is included. A related requirement at 120 ft has the same shape in miniature: the Rule requires railroad permission for "vehicle and load length exceeding 120 feet" and the Manual for "a load length exceeding one hundred twenty (120) feet" — same number, different datum.',
    },
  ),
  /** CONFLICT 9 — not a price difference, but an eligibility and lead-time one. */
  escortRule(
    'ms-insurance-or-versus-and',
    'Insurance: a DOT number OR a certificate in the Commission Rule, AND both in the Manual',
    NEEDS_A_MISSISSIPPI_PERMIT,
    {
      advisory:
        'Rule § 301: "Applicants shall provide a valid Federal DOT number OR a Certificate of Insurance with the Department listed as the certificate holder with no less than Five Hundred Thousand Dollars ($500,000) single limit liability on file with the Department. Exceptions may be made when in the opinion of Department a movement is not of a nature likely to cause damage to the highway or one time personal movements." Manual § 1 makes it AND — "(1) a valid Federal DOT number and (2) a Certificate of Insurance" — and deletes the exception clause entirely. A carrier with a USDOT number and no MDOT-named certificate satisfies the Rule and fails the Manual. Not a price difference; a lead-time and eligibility one on every Mississippi permit.',
    },
  ),
  escortRule(
    'ms-bridge-escorts-and-posted-bridges',
    'Escorts may be required at bridges, and movement is prohibited on every posted bridge',
    NEEDS_A_MISSISSIPPI_PERMIT,
    {
      advisory:
        'Manual: "Escorts may be required when crossing bridges on a permitted route." No bridge list and no threshold, so no cost is included. Separately, and absolutely: "Movement is prohibited on all posted bridges" — ALL of them, whatever the permitted weight, with the posted-bridge map published at GoMDOT.com. Route feasibility is not evaluated here.',
    },
  ),
  escortRule(
    'ms-no-pilot-car-certification',
    'Mississippi does not certify pilot/escort vehicle operators',
    NEEDS_A_MISSISSIPPI_PERMIT,
    {
      advisory:
        'Mississippi is not on FHWA’s list of states requiring P/EVO certification, and independently MDOT’s own "Escort Vehicle" definition (Manual § 4, Rule § 201, identical) specifies VEHICLE EQUIPMENT, SIGNAGE, LIGHTING AND RADIO ONLY — "a flashing or revolving amber light, two warning flags mounted on the vehicle, an Oversize Load or Wide Load sign mounted on top of the vehicle ... Two-way communication is required" — and imposes no operator qualification of any kind. INBOUND, no Mississippi certification exists to require, so an out-of-state card is neither demanded nor refused. OUTBOUND, Mississippi issues no card, so a Mississippi escort must obtain the certification of any certifying state it enters. No reciprocity list exists on either side because there is nothing to reciprocate. Failure to carry a required escort "may result in up to thirty (30) days suspension of the permit holder from the permit system" — new in the 2024 Manual, with no equivalent in the Rule.',
    },
    FHWA_PEVO,
    RETRIEVED,
  ),
];

// ── The jurisdiction ──────────────────────────────────────────────────────

export const MISSISSIPPI_OSOW_RULES: JurisdictionOsowRules = {
  code: 'MS',
  name: 'Mississippi',
  country: 'US',

  legalLimits: {
    widthIn: [
      fromDated(
        102,
        MS_63_5_13,
        STATUTE_FROM,
        '§ 63-5-13(1): "the total outside width of any vehicle, exclusive of required safety devices, or the load thereon shall not exceed eight and one-half (8-1/2) feet". Exclusive. The 9 ft 6 in allowance for unprocessed forest products off the interstate, and the 10 ft 6 in side-by-side manufactured-products permit envelope, are commodity-conditioned and are recorded rather than applied.',
      ),
      fromDated(
        102,
        MANUAL,
        MANUAL_FROM,
        'Manual: "Movement of loads in excess of eight (8) feet six (6) inches (102 inches) in width requires a permit."',
      ),
    ],
    heightIn: [
      fromDated(
        ftIn(13, 6),
        MS_63_5_17,
        STATUTE_FROM,
        'TWO HEIGHTS IN ONE SENTENCE. § 63-5-17 sets the permit trigger at 13 ft 6 in and then makes 12 FT 6 IN A LIABILITY LINE: "no person, firm or corporation, or the State of Mississippi or any subdivision thereof, shall be required to raise, alter, construct or reconstruct any underpass, wire, pole, trestle, or other structure to permit the passage of any vehicle having a height ... in excess of twelve feet, six inches. Full liability for damage to any structure caused by any vehicle having a height in excess of twelve feet, six inches, shall be borne entirely by the motor carrier or operator." Nothing in this model records a liability threshold; it is worth stating on any Mississippi lane over 12 ft 6 in.',
      ),
    ],
    trailerLengthIn: [
      fromDated(
        ftIn(53),
        MS_63_5_19,
        STATUTE_FROM,
        '§ 63-5-19(2): "No semitrailer operating in a truck tractor-semitrailer combination and no trailer drawn by a motor vehicle shall exceed a length of fifty-three (53) feet."',
      ),
      fromDated(
        ftIn(53),
        MANUAL,
        MANUAL_FROM,
        'Manual § 12 and Rule § 312, identical: "Trailers exceeding fifty-three (53) feet in length will require an Oversize Permit."',
      ),
    ],
    /**
     * AN AGENCY LIMIT WITH NO STATUTORY COUNTERPART, and it is recorded as such.
     * § 63-5-19 was read in full and sets no overall combination length at all —
     * it caps the single vehicle at 40 ft, the semitrailer at 53, the three-unit
     * trailer at 30, the motor home at 45, and stops. The 99 ft figure is MDOT's,
     * appears identically in the Rule and the Manual, and is treated by MDOT as
     * THE legal length.
     */
    overallLengthIn: [
      fromDated(
        ftIn(99),
        MANUAL,
        MANUAL_FROM,
        'Manual § 11: "Vehicles with a total length exceeding ninety-nine (99) feet will require a permit and a front and/or rear escort", and "A Single Trip – Oversize Permit must be purchased if the truck, trailer or load exceeds ... ninety-nine (99) feet in length". Exclusive. NO STATUTORY COUNTERPART WAS LOCATED: Miss. Code Ann. § 63-5-19 was opened in full and sets no overall combination length limit.',
      ),
      fromUndated(
        ftIn(99),
        RULE,
        'Rule § 311 states the 99 ft figure in identical words.',
      ),
    ],
    frontOverhangIn: [
      fromDated(
        ftIn(3),
        MANUAL,
        MANUAL_FROM,
        'Manual § 10: "Front projection exceeding three (3) feet will require a permit." Exclusive. The escort trigger in the same sentence is INCLUSIVE at 15 ft and is carried by ms-front-projection-15-escort-count-indeterminate.',
      ),
      fromUndated(ftIn(3), RULE, 'Rule § 310, identical.'),
    ],
    rearOverhangIn: [
      fromDated(
        ftIn(15),
        MANUAL,
        MANUAL_FROM,
        'Manual § 9: "A rear overhang of fifteen (15) feet or greater will require a permit and a front and/or rear escort." THE TRIGGER IS INCLUSIVE and this field is tested exclusively, so the boundary case — exactly 15 ft 0 in — is carried by ms-rear-overhang-15-escort-count-indeterminate, which fires at 15 ft or more.',
      ),
      fromUndated(ftIn(15), RULE, 'Rule § 309, identical.'),
    ],
    /**
     * CONFLICT 5, LIVE. Two statutory tables and one agency statement, and the
     * resolver refuses to pick between 80,000 and 57,650 lb.
     *
     * The disagreement is real and is not resolvable from the published record:
     * the 80,000 lb table applies only where the Commission has DESIGNATED the
     * highway, designation happens by an order published in a newspaper, and no
     * consolidated list or map of designated highways was located. A route class
     * was deliberately NOT minted for it — a vocabulary member no caller could
     * ever answer is worse than an honest conflict — and
     * `ms-overweight-charge-not-priceable` states the consequence on every
     * overweight quote.
     */
    grossWeightLbs: [
      fromDated(
        80000,
        MS_63_5_33,
        STATUTE_FROM,
        '§ 63-5-33(1) Table III, but ONLY "on those highways or parts of highways designated by the Mississippi Transportation Commission as being capable of carrying the maximum load limits and, in addition thereto, such other highways or parts of highways found by the commission to be suitable ... and so designated as such by order of the commission entered upon its minutes and published once each week for three (3) consecutive weeks in a daily newspaper published in this state". Table III is the federal bridge table and carries the standard 36-ft twin-tandem exception at 34,000 lb each.',
      ),
      fromDated(
        57650,
        MS_63_5_29,
        STATUTE_FROM,
        '§ 63-5-29 Table I governs "all highways of the State of Mississippi except those referred to in Sections 63-5-31 and 63-5-33" and its top row reads "36 and greater — 57,650 maximum". Selected published values: 4 ft 28,650; 10 ft 34,550; 20 ft 43,900; 30 ft 52,650; 35 ft 56,800. The section also publishes a rounding rule — spacing is "measured longitudinally to the nearest foot", one of very few explicit rounding statements in this whole directory — and a driving-axle cap: "the maximum load carried on any group of two (2) axles shall not exceed twenty-four thousand (24,000) pounds in instances where one or more of such axles is a driving axle".',
      ),
      fromDated(
        80000,
        MANUAL,
        MANUAL_FROM,
        'Manual: "A Single Trip – Overweight permit must be purchased if the truck, trailer and load combined exceed the legal weight of 80,000 pounds" — stated flatly, with no route qualifier. The Manual never mentions § 63-5-29 or the 57,650 lb table.',
      ),
    ],
    singleAxleLbs: [
      fromDated(
        20000,
        MS_63_5_27,
        STATUTE_FROM,
        '§ 63-5-27(2), and note "EXCLUSIVE OF THE TOLERANCE provided in Section 63-5-33" — unlike South Carolina’s and Michigan’s interstate figures, which are stated as INCLUDING tolerances. MDOT’s fee sheet uses the same figure as an overweight-charge trigger: "over axle for weights exceeding 20,000 lbs. on a single axle". § 63-5-27(1) adds a second, independent constraint this model cannot evaluate: "the gross single or tandem axle weights shall not exceed five hundred fifty (550) pounds per inch of tire width", with a 500 lb tolerance. Tyre width is not collected on a quote; on a 20,000 lb single axle that rule binds unless the tyres total at least 36.4 in of width.',
      ),
    ],
    tandemAxleLbs: [
      fromDated(
        34000,
        MS_63_5_27,
        STATUTE_FROM,
        '§ 63-5-27(3): "The gross weight imposed on the highway by any tandem axle shall not exceed thirty-four thousand (34,000) pounds exclusive of the tolerance provided in Section 63-5-33. A tandem axle shall be defined as any two (2) or more consecutive axles whose centers are more than forty (40) inches but not more than ninety-six (96) inches apart."',
      ),
    ],
  },

  /** $10, and it is the whole oversize charge. */
  permitBaseFeeUsd: [
    fromUndated(
      10,
      FEE_SHEET,
      'Fee sheet, Flat Permit Fees: "Oversize permit $10.00". NO PRINTED REVISION DATE on the sheet; PDF created 2019-11-14, and § 63-5-51 sets no fee to check it against.',
    ),
    fromDated(
      10,
      MANUAL,
      MANUAL_FROM,
      'Manual: "A Single Trip – Oversize Permit costs $10.00." A round trip is purchasable on the same permit and its price is not stated. An out-of-state non-IRP truck also pays the $25.00 72-hour legal trip permit, ADDITIVELY: "Own Power vehicles are charged $25.00 trip permit, plus additional charges for weight or size that exceed the legal limits" — the only place Mississippi states an order of operations, and it is pure addition.',
    ),
  ],

  /**
   * NOT PRICEABLE, AND THIS IS THE HEADLINE. See the module header and
   * `MISSISSIPPI_OVERWEIGHT_RATE_UNIT_CONFLICT`. `overweightPerMile` stays EMPTY
   * on purpose: the fee's SHAPE is a per-mile rate, but three of the five fields
   * that shape needs are unpublished and the rate's own unit is
   * self-contradictory by a factor of one hundred. Populating it would make the engine
   * choose a reading.
   */
  overweightPricing: [
    fromUndated<OverweightPricing>(
      {
        kind: 'notPriceable',
        explanation: MISSISSIPPI_OVERWEIGHT_RATE_UNIT_CONFLICT.detail,
      },
      FEE_SHEET,
    ),
    fromDated<OverweightPricing>(
      {
        kind: 'notPriceable',
        explanation:
          'Miss. Code Ann. § 63-5-51 authorises the Mississippi Transportation Commission to "issue a special permit in writing authorizing the applicant to operate or move a vehicle or combination of vehicles of a size or weight of vehicle or load exceeding the maximum specified in this chapter" and sets NO dollar amount, NO formula and NO fee-setting delegation anywhere in subsections (1)(a)-(d) or (2), all of which were read in full. Every Mississippi permit price therefore rests solely on one undated MDOT fee sheet, with no statutory backstop.',
      },
      MS_63_5_51,
      STATUTE_FROM,
    ),
  ],

  overweightBands: [],
  overweightPerMile: [],
  conditionalFees: [],

  /**
   * EMPTY — "nobody publishes a rate", never "the rate is zero". No convenience
   * fee, percentage or per-transaction charge appears on the fee sheet, in the
   * Manual, in the Rule or in § 63-5-51. Permits are bought through ExpressPass
   * and the payment page's charges are in no published document.
   */
  transactionFee: [],

  /**
   * BOTH EMPTY. The fee sheet has no superload line, no engineering-analysis
   * fee, no application fee and no impact fee; the APPLICANT performs the route
   * survey and MDOT publishes no charge to review it. The Manual says only that
   * "The Super Load Permit may contain one or more permits, i.e. overweight and
   * or oversize" — a superload pays the ordinary $10 oversize charge and the
   * unpriceable per-mile weight charge, and nothing extra. Contrast South
   * Carolina's $100 application plus $100/$200/$350 analysis plus a $3.00 per
   * 1,000 lb impact fee.
   */
  routeAnalysisFeeUsd: [],
  noBridgeRouteFeeUsd: [],

  superload: {
    /**
     * CONFLICT 6 — THE BOUNDARY CONTRADICTS ITSELF INSIDE ONE SENTENCE, and both
     * readings are on file as two rows from the SAME document.
     *
     * "A Super Load is considered to be any vehicle that EXCEEDS any of the
     * following limits: ... 4. Gross Weight of 189,999 pounds OR GREATER." At
     * exactly 189,999 lb the stem says no and the item says yes. It is a
     * one-pound band and it decides whether a move is an ordinary permit or the
     * whole superload process — route survey, traffic control plan, engineering
     * review, blue-light escorts. The Rule § 800.4 reproduces the identical
     * defect, so there is no newer/older tiebreak either.
     *
     * The consequence is deliberate: `resolveSourced` refuses to pick, Mississippi
     * resolves no quotable weight ceiling, and the widget mirror therefore
     * publishes none — a client must not wave through a load the server would
     * send to a human.
     */
    grossWeight: [
      fromDated<Threshold>(
        { value: 189999, inclusive: false },
        MANUAL,
        MANUAL_FROM,
        'The stem: "A Super Load is considered to be any vehicle that EXCEEDS any of the following limits". Read through the stem, item 4 is exclusive and a load of exactly 189,999 lb is NOT a superload.',
      ),
      fromDated<Threshold>(
        { value: 189999, inclusive: true },
        MANUAL,
        MANUAL_FROM,
        'Item 4 itself: "Gross Weight of 189,999 pounds OR GREATER". Read on its own terms it is inclusive and a load of exactly 189,999 lb IS a superload. Rule § 800.4 prints the identical wording, so both documents carry the same defect and neither can break the tie.',
      ),
    ],
    shortSpacing: [],
    widthIn: [
      fromDated<Threshold>(
        { value: ftIn(17), inclusive: false },
        MANUAL,
        MANUAL_FROM,
        'Manual: "A Super Load is considered to be any vehicle that exceeds any of the following limits: 1. Overall Width of seventeen (17) feet." Exclusive via the stem. Rule § 800.1 identical.',
      ),
    ],
    heightIn: [
      fromDated<Threshold>(
        { value: ftIn(15, 7), inclusive: false },
        MANUAL,
        MANUAL_FROM,
        'Manual: "3. Overall Height of fifteen (15) feet seven (7) inches." Exclusive via the stem, and the same figure as the height-pole trigger — the pole attaches at the moment a load becomes a superload.',
      ),
    ],
    overallLengthIn: [
      fromDated<Threshold>(
        { value: ftIn(121), inclusive: false },
        MANUAL,
        MANUAL_FROM,
        'Manual: "2. Overall Length of one hundred twenty-one (121) feet." Exclusive via the stem. Rule § 800.2 identical.',
      ),
    ],
  },

  /**
   * Mississippi's route "inspection" is a certified ROUTE SURVEY the applicant
   * provides with a superload application, and its triggers are the superload
   * dimensions exactly.
   */
  routeInspection: {
    widthIn: [
      fromDated<Threshold>({ value: ftIn(17), inclusive: false }, MANUAL, MANUAL_FROM),
    ],
    heightIn: [
      fromDated<Threshold>({ value: ftIn(15, 7), inclusive: false }, MANUAL, MANUAL_FROM),
    ],
    lengthIn: [
      fromDated<Threshold>(
        { value: ftIn(121), inclusive: false },
        MANUAL,
        MANUAL_FROM,
        'Manual: "A route survey must include ... Route(s) surveyed. List of obstructions such as highway signs (roadside and overhead), bridge rails, overhead traffic signals, and overhead power lines, railroad crossings on the route or shoulders affecting the move. Pull-off areas to allow traffic to pass". Rule § 803 identical. MDOT publishes no charge for it and no lead time for a Mississippi superload.',
      ),
    ],
  },

  escortRules: MISSISSIPPI_ESCORT_RULES,

  /**
   * TRUE, and the mileage term is real even though it cannot be priced: the
   * overweight charge is "per thousand lbs. times the miles traveled". The
   * engine will refuse to price a Mississippi overweight leg without in-state
   * mileage — and will refuse it with the mileage too, because the rate's unit
   * is unresolvable. Recording `false` would say Mississippi's fee is flat,
   * which is a different and wrong claim about the state's own schedule.
   */
  feesDependOnDistance: true,
};
