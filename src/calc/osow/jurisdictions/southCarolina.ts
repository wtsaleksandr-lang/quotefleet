/**
 * SOUTH CAROLINA — oversize/overweight single-trip permit rules.
 *
 * THE BEST-SOURCED STATE IN THE DIRECTORY, AND STILL THE ONE WITH THE LARGEST
 * SINGLE PRICING HOLE.
 * ---------------------------------------------------------------------------
 * SC Code § 57-3-130(A) prints the WHOLE permit fee table in the statute itself,
 * and SCDOT's Guidelines for Movement, Rev. 3/2026, reprints it line for line —
 * sixteen rows, statute and agency, with no divergence. Every statutory figure
 * below comes from scstatehouse.gov, the official South Carolina Legislature
 * host: a PRIMARY source, unlike Texas's FindLaw fallback or Mississippi's.
 *
 * ── FOUR THINGS THAT MAKE SOUTH CAROLINA ITS OWN SHAPE ───────────────────
 *
 * 1. ITS BRIDGE TABLE IS NOT THE FEDERAL BRIDGE TABLE. § 56-5-4140 transcribes
 *    its own, and the two-axle row at 8 ft and under reads 35,200 lb where FHWA
 *    reads 34,000. Its interstate gross ceiling is 75,185 lb before item (4)'s
 *    formula lifts it to 80,000, its twin-tandem exception is stated as one
 *    68,000 lb figure, and cells differ row by row (3 axles at 20 ft = 51,000;
 *    the 4-axle column starts at 12 ft with 50,000). So South Carolina holds a
 *    `stateBridgeTable` and the engine DOES NOT FALL THROUGH to
 *    `bridgeFormula.ts` here. We hold the caps and four cells; the rest of the
 *    printed table was not transcribed, `partial` says so, and an axle group
 *    with no cell on file is reported UNDECIDED rather than judged by another
 *    state's numbers.
 *
 * 2. LEGAL GROSS OFF THE INTERSTATE IS 73,280 LB, NOT 80,000. § 56-5-4140(A)(1)
 *    caps a five-or-more-axle combination at 73,280 lb "upon any section of
 *    highway, including the interstate highway system, except where the formula
 *    in item (4) allows for a higher weight". Item (4) is the interstate path to
 *    80,000. `legalLimits.grossWeightLbs` records 73,280 and
 *    `sc-interstate-gross-73280-to-80000` states what the interstate exception
 *    does with the band between.
 *
 * 3. IT IS DISTANCE-PRICED, BUT ONLY ABOVE 500,000 LB. The megaload impact fee
 *    is $0.05 per 1,000 lb per mile ON THE ENTIRE GROSS VEHICLE WEIGHT — the one
 *    basis in the section that IS published. `feesDependOnDistance` is therefore
 *    TRUE, and the mileage term is DORMANT below 500,000 lb: every ordinary
 *    South Carolina permit is flat. That is a shape no other jurisdiction here
 *    has, and it is why the rate is held in
 *    `SOUTH_CAROLINA_MEGALOAD_IMPACT_FEE` rather than in `overweightPerMile` —
 *    a 500,000 lb load is far past the 130,000 lb superload line, and the engine
 *    deliberately prices no superload, so a row there would be data the fee
 *    block can never reach. § 57-3-180 adds a SECOND distance term the
 *    Guidelines never mention: $10 a trip on an open-end mobile-home permit, and
 *    $1 a trip under twelve miles.
 *
 * 4. IT IS THE ONLY ONE OF ITS NEIGHBOURS' KIND THAT PUBLISHES A POLICE ESCORT
 *    RATE — and the police publish it, not SCDOT. The State Transport Police
 *    "Contractor Request for Escort" form carries the whole card: $50.00 per
 *    hour per officer, a two-hour minimum per officer, $0.76 per mile effective
 *    1 July 2026, a $100-per-officer late-cancellation charge, and a four-hour
 *    charge per officer if the escort is cancelled after dispatch or delayed
 *    more than two hours. SCDOT's own documents say nothing about cost.
 *    THE CAVEAT MUST SURVIVE INTO THE PRICE: the billable mileage is "mileage
 *    driven by the officer to and from the officer's residence AND during the
 *    entire escort", and the billable time likewise includes the commute. The
 *    officer's origin is unknowable at quote time, so only a FLOOR can be
 *    computed — and over 16 ft wide two officers are required, making that floor
 *    2 x 2 x $50.00 = $200.00 plus unquantifiable mileage. See
 *    `escortCost.ts`, where it is the seventh published rate on file.
 *
 * ── THE SUPERLOAD IMPACT FEE IS THE LARGEST HOLE, AND IT IS INSIDE ONE
 *    STATUTE ────────────────────────────────────────────────────────────────
 * "Superload Impact Fee for Loads Over 130,000 pounds $3.00/1,000 pounds." It
 * does not say whether the $3.00 runs on the ENTIRE gross weight or only on the
 * EXCESS over 130,000 lb. At 180,000 lb that is $540 against $150. The statute's
 * OTHER per-poundage fee, in the same section, says "assessed on the entire
 * gross vehicle weight" — so the drafter knew how to say "entire" and did not say
 * it here. THAT IS AN ARGUMENT, NOT AN ANSWER, and neither reading has been
 * adopted. Nor is the partial increment published, nor whether the fee stacks
 * with the engineering-analysis fee that triggers at the same weight. Every
 * South Carolina superload goes to review on this row alone — which costs
 * nothing, because the engine prices no superload anyway, and it is why the
 * figures live in `SOUTH_CAROLINA_SUPERLOAD_IMPACT_FEE_CONFLICT` rather than in
 * a fee field.
 *
 * ── WEIGHT-BASED ESCORT TRIGGER: NONE. STATED AFFIRMATIVELY. ─────────────
 * The Guidelines' escort section is a complete seven-bullet table and every
 * bullet keys on WIDTH, HEIGHT, LENGTH or OVERHANG. No weight figure appears in
 * it. South Carolina's weight thresholds — 130,000 / 180,000 / 300,000 /
 * 500,000 lb — attach fees, insurance, engineering analysis and structural
 * review, and NOT escorts. A 400,000 lb load ten feet wide requires no escort
 * under the published table. Contrast Mississippi, which does publish one at
 * 300,000 lb. This is a published absence, not an unsearched gap, and
 * `sc-no-weight-based-escort-trigger` says so on the quote.
 *
 * ── FIVE CONFLICTS, NONE ADOPTED ────────────────────────────────────────
 *  1. THE SUPERLOAD IMPACT FEE BASIS, above — $540 against $150 at 180,000 lb.
 *  2. THE 180,000 LB INSURANCE BOUNDARY, inside one document: §E-11 says "a load
 *     EXCEEDING 180,000 lbs." and §M-5 says "180,000 lbs. OR GREATER". §M-5 also
 *     adds a width trigger §E-11 lacks, and that width trigger is INCLUSIVE at
 *     16 ft while the escort rule at the same width is EXCLUSIVE — so a load at
 *     exactly 16 ft 0 in needs the insurance certificate and does NOT need the
 *     police escorts. Live on `sc-insurance-180000-boundary`.
 *  3. THE ANNUAL-PERMIT HEIGHT CEILING: § 57-3-190 says "All heights may not
 *     exceed fourteen and one-half feet"; the Guidelines allow 15 ft on every
 *     multiple-trip route-specific permit. Six inches, in a state where 16 ft
 *     triggers a route survey and a height-pole escort. Live on
 *     `sc-annual-permit-height-14-6-vs-15`.
 *  4. THE ROUTE SURVEY IS SELF-CERTIFIED IN §Q AND DEPARTMENT-APPROVED IN
 *     §L-3(c) — same document, same trigger, two processes with two lead times.
 *     Live on `sc-route-survey-self-certified-vs-approved`.
 *  5. A SUPERSEDED COPY OF THE GUIDELINES IS STILL SERVED BY SCDOT.ORG — Rev.
 *     8/2021 at a second URL, unlinked but indexed. The fee table and the whole
 *     escort section were compared line by line and are IDENTICAL, so it is a
 *     warning rather than a substantive disagreement; the sections that did
 *     change (permit types, superload tiers, travel times) would be silently
 *     wrong. See `SOUTH_CAROLINA_SUPERSEDED_GUIDELINES`.
 *
 * ── AND ONE ORDER OF OPERATIONS THAT IS SIMPLY NOT PUBLISHED ────────────
 * The excessive-width steps — $35 over 16 ft, $40 over 18, $45 over 20, $50 over
 * 22 — are printed as separate line items in the same fee table as the $30
 * single-trip permit, and NEITHER DOCUMENT SAYS WHETHER THEY REPLACE IT OR ADD
 * TO IT. $35 or $65 on a 17-ft-wide load. They are therefore NOT encoded as
 * `oversizeFeeBands`: every band they could occupy starts above South Carolina's
 * own 16 ft permit ceiling, where a load is no longer issued over the counter at
 * all but goes through the Resident Maintenance Engineer as a "Frame Building or
 * Other Load of Similar Size" — thirty-mile cap, four escorts, per-county
 * sign-off, 9 a.m. to 3 p.m. So the steps are held in
 * `SOUTH_CAROLINA_EXCESSIVE_WIDTH_STEPS` and stated on the quote by
 * `sc-width-over-16`, which sends the move to review rather than choosing one of
 * the two readings.
 */
import type { SourceDoc, Sourced } from '../provenance.js';
import { ftIn, type EscortRule } from '../escortRules.js';
import type {
  JurisdictionOsowRules,
  OverweightPricing,
  StateBridgeTable,
  Threshold,
} from '../types.js';

const RETRIEVED = '2026-09-05';

// ── Source documents ──────────────────────────────────────────────────────

function scCode(
  id: string,
  section: string,
  chapterUrl: string,
  revisedOn: string,
  cite: string,
): SourceDoc {
  return {
    id,
    title: `S.C. Code Ann. § ${section} (South Carolina Legislature — PRIMARY source)`,
    url: chapterUrl,
    publisher: 'South Carolina Legislature',
    revisedOn,
    retrievedOn: RETRIEVED,
    cite,
  };
}

const T56C005 = 'https://www.scstatehouse.gov/code/t56c005.php';
const T57C003 = 'https://www.scstatehouse.gov/code/t57c003.php';

const SC_56_5_4030 = scCode(
  'sc-code-56-5-4030',
  '56-5-4030',
  T56C005,
  '2002',
  'width 102 inches exclusive of approved safety devices; HISTORY "2002 Act No. 197, SECTION 1" states no finer date',
);

const SC_56_5_4060 = scCode(
  'sc-code-56-5-4060',
  '56-5-4060',
  T56C005,
  '2008-05-22',
  'height 13 ft 6 in, and the free 14 ft routing permit for automobile transporters and saddle-mount combinations; "2008 Act No. 234, SECTION 4, eff upon approval"',
);

const SC_56_5_4070 = scCode(
  'sc-code-56-5-4070',
  '56-5-4070',
  T56C005,
  '2016-05-25',
  '53 ft trailer with a 41 ft kingpin-to-rear-axle limit; 40 ft single vehicle; (E) "there is no overall length limit on combination vehicles"; "2016 Act No. 188 (H.4932), SECTION 1"',
);

const SC_56_5_4080 = scCode(
  'sc-code-56-5-4080',
  '56-5-4080',
  T56C005,
  '1972',
  '3 ft front and 6 ft rear overhang, and the hydraulic boom and bucket carve-out; HISTORY ends at "1972 (57) 2269"',
);

const SC_56_5_4130 = scCode(
  'sc-code-56-5-4130',
  '56-5-4130',
  T56C005,
  '2016-05-25',
  'axle weight by TYRE INFLATION PRESSURE — 16,000 lb on high-pressure tyres, 20,000 lb on low-pressure; "2016 Act No. 188 (H.4932), SECTION 2"',
);

const SC_56_5_4140 = scCode(
  'sc-code-56-5-4140',
  '56-5-4140',
  T56C005,
  '2016-05-25',
  'gross by axle count to 73,280 lb; the interstate provisos at 20,000 / 35,200 / 75,185 lb including all enforcement tolerances; item (4) the bridge formula to 80,000 and the 68,000 lb twin-tandem exception; "2016 Act No. 188 (H.4932), SECTION 3"',
);

const SC_57_3_130 = scCode(
  'sc-code-57-3-130',
  '57-3-130',
  T57C003,
  '2012-02-01',
  'the whole permit and licence fee table, and (B)(5) the megaload impact fee "assessed on the entire gross vehicle weight on a pounds per mile basis"; "2012 Act No. 110, SECTION 2, eff February 1, 2012"',
);

const SC_57_3_180 = scCode(
  'sc-code-57-3-180',
  '57-3-180',
  T57C003,
  '1994',
  'the open-end permit trip fee — $10 a trip, $1 for additional trips of less than twelve miles; "1994 Act No. 497, Part II, SECTION 85A"',
);

const SC_57_3_190 = scCode(
  'sc-code-57-3-190',
  '57-3-190',
  T57C003,
  '1994',
  '"All heights may not exceed fourteen and one-half feet" on open-end and annual permits',
);

const GUIDELINES: SourceDoc = {
  id: 'scdot-guidelines-2026-03',
  title: 'SCDOT — Guidelines for Movement of Oversize/Overweight Vehicles (Rev. 3/2026)',
  url: 'https://www.scdot.org/content/dam/scdot-legacy/business/pdf/osow/GUIDELINES%20FOR%20MOVEMENT%20Updated%203.2026%20(PDF).pdf',
  publisher: 'South Carolina Department of Transportation',
  revisedOn: '2026-03',
  retrievedOn: RETRIEVED,
  cite: 'footer "Rev. 3/2026" on every page; §E permit types and superload tiers; §F payment; §K fees; §L maximum permitted limits; §M insurance and registration; §Q escort requirements',
};

/**
 * THE POLICE RATE, PUBLISHED BY THE POLICE. SCDOT links this form from its own
 * OS/OW page, so the two agencies' documents cross-reference cleanly. Exported
 * because `escortCost.ts` cites the same object rather than re-declaring it —
 * two copies of one document is how a URL and a revision date drift apart.
 */
export const SOUTH_CAROLINA_POLICE_ESCORT_RATE_SOURCE: SourceDoc = {
  id: 'scdps-stp-escort-request-form',
  title: 'SCDPS State Transport Police — Contractor Request for Escort',
  url: 'https://scdps.sc.gov/sites/scdps/files/Documents/scstp/STP_Contractor_Request_for_Escort_Form.pdf',
  publisher: 'South Carolina Department of Public Safety, State Transport Police',
  revisedOn: '2026-07-01',
  retrievedOn: RETRIEVED,
  cite: 'TERMS FOR ESCORT SERVICE — $50.00 per hour per officer, two-hour minimum, $0.76 per mile effective July 1 2026; CANCELLATIONS/DELAYS; 48-hour booking notice. The form carries no revision date of its own; only the mileage clause is dated.',
};

const FHWA_PEVO: SourceDoc = {
  id: 'fhwa-pevo-study-guide',
  title: 'FHWA — Pilot/Escort Vehicle Operator (P/EVO) Best Practices Guide',
  url: 'https://ops.fhwa.dot.gov/publications/fhwahop16054/pevo_study_gde.htm',
  publisher: 'Federal Highway Administration',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: '"As of early 2016, States that require P/EVOs be certified include Arizona, Colorado, Florida, Georgia, Minnesota, New York, North Carolina, Oklahoma, Utah, Virginia, and Washington."',
};

/** CONFLICT 5 — a five-year-old copy of the Guidelines, still served, unlinked. */
export const SOUTH_CAROLINA_SUPERSEDED_GUIDELINES = {
  source: {
    id: 'scdot-guidelines-2021-08-superseded',
    title: 'SCDOT — Guidelines for Movement (Rev. 8/2021), SUPERSEDED but still served',
    url: 'https://www.scdot.org/content/dam/scdot-legacy/business/pdf/osow/OSOW_Guidelinesfor_movement.pdf',
    publisher: 'South Carolina Department of Transportation',
    revisedOn: '2021-08',
    retrievedOn: RETRIEVED,
    cite: '13 pages against Rev. 3/2026’s 14; not linked from the OS/OW page and still served and indexed',
  } as SourceDoc,
  detail:
    'A five-year-old copy of the Guidelines is still served at a second scdot.org URL. It is a WARNING RATHER THAN A SUBSTANTIVE CONFLICT: the fee table and the entire escort section were compared line by line against Rev. 3/2026 and are IDENTICAL, so no figure in this file changes either way. But the sections that DID change between the two — permit types, superload tiers and travel times — would be silently wrong for anyone who landed on the older URL, which carries no indication that it has been superseded. Every row in this file is taken from Rev. 3/2026.',
} as const;

// ── The findings that are not fee fields ──────────────────────────────────

/**
 * THE FOUR EXCESSIVE-WIDTH STEPS, AND WHY THEY ARE NOT `oversizeFeeBands`.
 *
 * Two reasons, and either alone would be enough. First, the order of operations
 * is not published: § 57-3-130(A) prints "Single Trip $30.00" and then
 * "Excessive Width Over 16 feet $35.00" as separate line items in one list of
 * "rates for oversize or overweight permits and licenses", and neither the
 * statute nor the Guidelines says whether the step REPLACES the $30 or is ADDED
 * to it. The escalating ladder reads as replacement; the separate line items read
 * as addition; $35 against $65 on a 17-ft-wide load, seventeen per cent of the
 * permit. Encoding either as a band would adopt a reading.
 *
 * Second, every band they could occupy starts ABOVE South Carolina's own permit
 * ceiling. The Guidelines cap a permitted load at 16 ft wide, and a wider one is
 * not issued over the counter at all: it goes through the Resident Maintenance
 * Engineer as a frame building, capped at thirty miles, four escorts, per-county
 * sign-off and a 9 a.m.-to-3 p.m. window. `sc-width-over-16` states all of that
 * and sends the move to review.
 *
 * All four boundaries are EXCLUSIVE ("Over 16 feet"), which lines up exactly with
 * the escort rule's "Width exceeding 16 feet" — good evidence that the fee
 * table's "Over" is meant exclusively too.
 */
export const SOUTH_CAROLINA_EXCESSIVE_WIDTH_STEPS: ReadonlyArray<{
  overWidthFt: number;
  feeUsd: number;
}> = [
  { overWidthFt: 16, feeUsd: 35 },
  { overWidthFt: 18, feeUsd: 40 },
  { overWidthFt: 20, feeUsd: 45 },
  { overWidthFt: 22, feeUsd: 50 },
];

/** CONFLICT 1 — the largest pricing hole in the state, and it is inside one section. */
export const SOUTH_CAROLINA_SUPERLOAD_IMPACT_FEE_CONFLICT = {
  quote: 'Superload Impact Fee for Loads Over 130,000 pounds $3.00/1,000 pounds',
  usdPerThousandLbs: 3,
  overLbs: 130000,
  entireGvwAt180000Usd: 540,
  excessOnlyAt180000Usd: 150,
  detail:
    'The fee table states a rate and no basis. Read on the ENTIRE gross vehicle weight, a 180,000 lb load pays $540; read on the EXCESS over 130,000 lb it pays $150. The statute’s OTHER per-poundage fee, § 57-3-130(B)(5), is explicit — "there is an additional megaload impact fee assessed ON THE ENTIRE GROSS VEHICLE WEIGHT on a pounds per mile basis" — so the drafter used the word in one place in the section and omitted it in the other. Reading the superload fee on the entire GVW makes that clarification redundant; reading it on the excess makes the two fees inconsistent in basis. THAT IS AN ARGUMENT, NOT AN ANSWER, and neither reading has been adopted. Two further inputs are unpublished: whether a part increment (130,500 lb is half an increment over) rounds up, down or pro rata, and whether the impact fee STACKS with the engineering-analysis fee, which triggers at the same "Over 130,000 pounds". The Guidelines Rev. 3/2026 reprint both lines verbatim and add nothing.',
} as const;

/** The department's own review charge, in three bands — and it is not the impact fee. */
export const SOUTH_CAROLINA_SUPERLOAD_ENGINEERING_FEES: ReadonlyArray<{
  overLbs: number;
  feeUsd: number;
}> = [
  { overLbs: 130000, feeUsd: 100 },
  { overLbs: 200000, feeUsd: 200 },
  { overLbs: 300000, feeUsd: 350 },
];

export const SOUTH_CAROLINA_SUPERLOAD_ENGINEERING_FEE_NOTE =
  '§ 57-3-130(A): "Superload Engineer Analysis Over 130,000 pounds $100.00 / Superload Engineer Analysis Over 200,000 pounds $200.00 / Superload Engineer Analysis Over 300,000 pounds $350.00", plus a "Superload Application (Non-Refundable) $100.00" — the ONLY non-refundable fee in South Carolina, where everything else is returned on denial. All three analysis boundaries are exclusive. WHETHER THE BANDS ARE CUMULATIVE OR EXCLUSIVE IS NOT PUBLISHED: at 350,000 lb the analysis fee is either $350 or $100+$200+$350 = $650. Bands in a fee ladder are normally exclusive and that is the natural reading, but neither document says so, and $300 is not a rounding question. These are SCDOT’s review charges; the independent structural analysis the Guidelines "may require the carrier to provide" above 300,000 lb is the carrier’s own cost and is unquantified. None of this is quoted, because a load over 130,000 lb is a South Carolina superload and the engine prices no superload.';

/**
 * THE DORMANT MILEAGE TERM. Held as a constant with its published shape rather
 * than as an `overweightPerMile` row, because a 500,000 lb load is nearly four
 * times South Carolina's 130,000 lb superload threshold and the engine
 * deliberately emits no priced line for a superload — a row there could never be
 * reached. `feesDependOnDistance` is true because the state's own schedule
 * contains this term and § 57-3-180's, not because the ordinary permit uses one.
 */
export const SOUTH_CAROLINA_MEGALOAD_IMPACT_FEE = {
  overLbs: 500000,
  usdPerThousandLbsPerMile: 0.05,
  basis: 'entire gross vehicle weight' as const,
  detail:
    '§ 57-3-130(A): "Additional Megaload Impact Fee for Loads Over 500,000 pounds $.05/1000 lbs/mile", and § 57-3-130(B)(5) publishes the basis, which the superload impact fee does not: "For loads exceeding five hundred thousand pounds, there is an additional megaload impact fee assessed on the entire gross vehicle weight on a pounds per mile basis as provided in the permits and licenses rates table contained in subsection (A)." The Guidelines corroborate at §E-11. "Additional" makes it stack on top of the $3.00 per 1,000 lb superload impact fee. The partial mile and the partial 1,000 lb are both unpublished. This is the only genuinely distance-priced fee in South Carolina and it is dormant below 500,000 lb.',
} as const;

/** A second distance term, on a product the Guidelines never mention. */
export const SOUTH_CAROLINA_OPEN_END_TRIP_FEE = {
  usdPerTrip: 10,
  usdPerShortTrip: 1,
  shortTripUnderMiles: 12,
  detail:
    '§ 57-3-180: "The fee of ten dollars a trip, required to be paid pursuant to Section 56-3-710, must be paid to the Department of Transportation with each report filed. However, the fee for additional trips of less than twelve miles distance made under the open-end permits is one dollar a trip." Exclusive at twelve miles. It applies ONLY to the open-end mobile-home, modular-unit, utility-building and steel-tank product, is self-reported quarterly, and is backed by a $500 bond or deposit under § 57-3-170. The Guidelines never mention it. It is not the single-trip permit this engine prices and is recorded rather than applied.',
} as const;

// ── Helpers ───────────────────────────────────────────────────────────────

const GUIDELINES_FROM = '2026-03-01';

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
 * A row from a statute whose HISTORY line states a YEAR and nothing finer.
 * `revisedOn` keeps the bare year — see `SourceDoc.revisedOn`, where partial
 * dates are allowed and only there — while `effectiveFrom` must be a full date,
 * so it takes 1 January of that year, which is the earliest date the amendment
 * can have been in force.
 */
function fromYearDatedStatute<T>(
  value: T,
  source: SourceDoc,
  year: string,
  note?: string,
): Sourced<T> {
  return {
    value,
    source,
    effectiveFrom: `${year}-01-01`,
    effectiveTo: null,
    ...(note === undefined ? {} : { note }),
  };
}

// ── South Carolina's own bridge table ─────────────────────────────────────

/**
 * NOT THE FEDERAL TABLE, AND THE ENGINE MUST NOT REACH FOR ONE.
 *
 * Four cells and the caps are what the research transcribed; § 56-5-4140 prints
 * more. `partial: true` is therefore load-bearing: a group whose (span, axle
 * count) is not on file comes back UNDECIDED and is named, rather than being
 * judged by FHWA's number for the same cell. The 35,200 lb tandem row is the
 * proof that substitution would be wrong — the federal figure there is 34,000.
 */
const SC_BRIDGE_TABLE: StateBridgeTable = {
  name: "South Carolina's own axle-group weight table, § 56-5-4140",
  cells: [
    { spanFt: 20, axleCount: 3, maxWeightLbs: 51000 },
    { spanFt: 12, axleCount: 4, maxWeightLbs: 50000 },
  ],
  singleAxleLbs: 20000,
  tandemAxleLbs: 35200,
  tandemMaxSpanFt: 8,
  grossLbs: 80000,
  twinTandemSpanFt: 36,
  twinTandemLbs: 68000,
  partial: true,
  explanation:
    '§ 56-5-4140(A)(1) caps a five-or-more-axle combination at 73,280 lb "upon any section of highway, including the interstate highway system, except where the formula in item (4) allows for a higher weight", and the same paragraph sets the interstate figures INCLUDING all enforcement tolerances: "the gross weight on a single axle operated on the interstate may not exceed 20,000 pounds ... the gross weight on a tandem axle operated on the interstate may not exceed 35,200 pounds ... the overall gross weight for vehicles operated on the interstate may not exceed 75,185 pounds ... except as provided in item (4)". Item (4) transcribes W = 500(LN/N-1 + 12N + 36) up to 80,000 lb with the exception that "two consecutive sets of tandem axles may carry a gross load of 68,000 pounds if the overall distance between the first and last axles of the consecutive sets of tandem axles is 36 feet or more". THE TABLE IS NOT FHWA’S: its two-axle row at 8 ft and under is 35,200 lb where the federal table is 34,000, three axles at 20 ft is 51,000, and the four-axle column starts at 12 ft with 50,000. Only the cells transcribed here are held; a group with no cell on file is reported undecided rather than tested against the federal value. A SINGLE AXLE OVER 20,000 LB IS ALSO A SUPERLOAD TRIGGER IN ITS OWN RIGHT — "any single axle weight that exceeds 20,000 lbs. will require additional routing analysis" — which a gross-weight check alone would miss on a 95,000 lb load with one heavy axle.',
};

// ── Escort rules ──────────────────────────────────────────────────────────

function escortRule(
  id: string,
  description: string,
  when: EscortRule['when'],
  then: EscortRule['then'],
  source: SourceDoc = GUIDELINES,
  effectiveFrom: string = GUIDELINES_FROM,
): EscortRule {
  return {
    id,
    jurisdiction: 'SC',
    description,
    when,
    then,
    source,
    effectiveFrom,
    effectiveTo: null,
  };
}

const NEEDS_A_SOUTH_CAROLINA_PERMIT: EscortRule['when'] = {
  kind: 'any',
  of: [
    { kind: 'gt', measure: 'widthIn', value: 102 },
    { kind: 'gt', measure: 'heightIn', value: ftIn(13, 6) },
    { kind: 'gt', measure: 'trailerLengthIn', value: ftIn(53) },
    { kind: 'gt', measure: 'frontOverhangIn', value: ftIn(3) },
    { kind: 'gt', measure: 'rearOverhangIn', value: ftIn(6) },
    { kind: 'gt', measure: 'grossWeightLbs', value: 73280 },
  ],
};

export const SOUTH_CAROLINA_ESCORT_RULES: EscortRule[] = [
  /**
   * THE BANDS ABUT CLEANLY — "up to and including 14" / "exceeding 14 up to and
   * including 16" / "exceeding 16" — so unlike Tennessee's whole-inch steps
   * there is no hole anywhere in the South Carolina escort ladder.
   */
  escortRule(
    'sc-width-12-to-14-two-lane',
    'Over 12 ft up to and including 14 ft wide — one FRONT escort on a two-lane highway',
    {
      kind: 'all',
      of: [
        { kind: 'gt', measure: 'widthIn', value: ftIn(12) },
        { kind: 'between', measure: 'widthIn', min: ftIn(12), max: ftIn(14), minInclusive: false },
        { kind: 'routeClass', anyOf: ['two-lane'] },
      ],
    },
    {
      escorts: 1,
      front: 1,
      advisory:
        '§Q: "Width exceeding 12 feet up to and including 14 feet: One front escort is required when traveling on a two-lane highway; the Department reserves the right to require a rear escort where it is deemed necessary for safety purposes." OFF a two-lane highway this band requires no escort at all. "Two-lane highway" IS NOT DEFINED anywhere in the Guidelines — Mississippi defines its equivalent term and South Carolina does not — so a route whose class is not supplied leaves this rule undecided rather than answering "no escort". The discretionary rear escort is not priced.',
    },
  ),
  escortRule(
    'sc-width-14-to-16',
    'Over 14 ft up to and including 16 ft wide — one FRONT and one REAR escort on all roadways',
    {
      kind: 'all',
      of: [
        { kind: 'gt', measure: 'widthIn', value: ftIn(14) },
        { kind: 'between', measure: 'widthIn', min: ftIn(14), max: ftIn(16), minInclusive: false },
      ],
    },
    {
      escorts: 2,
      front: 1,
      rear: 1,
      advisory:
        '§Q: "Width exceeding 14 feet up to and including 16 feet: One front and one rear escort required on all roadways." Road-independent. The same band also carries two route restrictions this quote does not evaluate: such loads "shall travel on four-lane highways", and shall "be the only vehicle on any bridge that is 18 feet wide or less".',
    },
  ),
  /**
   * OVER 16 FT: FOUR ESCORTS, A MANDATORY POLICE PAIR, AND THE FEE STEPS THIS
   * ENGINE WILL NOT CHOOSE A READING FOR.
   */
  escortRule(
    'sc-width-over-16',
    'Over 16 ft wide — one front and one rear CIVILIAN escort AND one front and one rear POLICE escort',
    { kind: 'gt', measure: 'widthIn', value: ftIn(16) },
    {
      escorts: 2,
      front: 1,
      rear: 1,
      policeFront: 1,
      policeRear: 1,
      manualReview:
        '§Q: "Width exceeding 16 feet: One front and one rear civilian escort AND one front and one rear police escort is required on all roadways, (exceptions can be made upon written approval from the Department’s Permit Director)." MANDATORY, not discretionary — four vehicles. THE PERMIT FEE FOR THIS LOAD IS NOT QUOTED, for two reasons. First, 16 ft is South Carolina’s own maximum permitted width (§L-4: "Mobile homes - 16 feet maximum / Non Divisible Loads - 16 feet maximum"), and a wider load is not issued over the counter at all: §F handles it as a "Frame Building or Other Load of Similar Size" through the Resident Maintenance Engineer, with a THIRTY-MILE cap ("The maximum travel distance for a frame building or load in excess of 16 feet is thirty 30 miles"), a 9 a.m. to 3 p.m. weekday window, a per-county RME signature with a five-working-day turnaround, EMS and fire notification in every town on the route, and a bridge rule requiring the load to be 24 inches narrower than the guard rails. Second, § 57-3-130(A) prints excessive-width steps — $35.00 over 16 ft, $40.00 over 18 ft, $45.00 over 20 ft, $50.00 over 22 ft — and NEITHER the statute NOR the Guidelines says whether they replace the $30 single-trip fee or are added to it: $35 or $65 on a 17-ft-wide load. Neither reading has been adopted. The escorting agency may be "local, county, city, Highway Patrol or State Transport Police" and only the State Transport Police rate is published, so a county or municipal escort is unpriced.',
    },
  ),
  /**
   * THE PUBLISHED POLICE RATE, AND THE PART OF IT THAT CANNOT BE COMPUTED.
   */
  escortRule(
    'sc-police-escort-rate-published-floor-only',
    'The State Transport Police publish a rate, and the billable mileage includes the officer’s commute',
    { kind: 'gt', measure: 'widthIn', value: ftIn(16) },
    {
      advisory:
        'South Carolina is the only one of its region that publishes a law-enforcement escort rate, and the police publish it rather than SCDOT: "Services shall be rendered at an inclusive rate of $50.00 per hour for each officer. Billed time shall include travel time to and from the officer’s residence and all time during which the officer is made available for an escort. There will be a minimum charge of two (2) hours per officer. The company will reimburse the Division (STP) for mileage driven by the officer to and from the officer’s residence and during the entire escort. Effective July 1, 2026, the rate is calculated at $0.76 per mile." OVER 16 FT WIDE TWO OFFICERS ARE REQUIRED, so the computable FLOOR is 2 officers x 2 hours x $50.00 = $200.00. IT IS ONLY A FLOOR: the billable mileage and the billable time both include the officer’s commute from and to their residence, which is unknowable at quote time, so the true charge is higher by an amount this quote cannot state. A late cancellation costs "a minimum charge of $100.00 per officer", and a cancellation after dispatch — or a delay of more than two hours, which is DEEMED a cancellation — costs four hours per officer, $200.00 each. The request must be signed and returned 48 hours ahead, excluding weekends and holidays.',
      },
    SOUTH_CAROLINA_POLICE_ESCORT_RATE_SOURCE,
    '2026-07-01',
  ),
  escortRule(
    'sc-height-16-or-more',
    '16 ft high or more — one FRONT escort with a height pole for the entire move, and a route survey',
    { kind: 'gte', measure: 'heightIn', value: ftIn(16) },
    {
      escorts: 1,
      front: 1,
      heightPole: true,
      routeSurvey: true,
      advisory:
        '§Q: "Height 16 feet and greater: One front escort with a height measuring device is required during entire movement on all roadways. A route survey, certified as correct by the applicant, shall also be provided to the permit office prior to permit issuance." INCLUSIVE — exactly 16 ft 0 in triggers it. Related duties at any permitted height: the load "must be at least 3 inches less than any overhead structures on a route granted by the permit", and the transporter must arrange the raising or removal of overhead wires "no less than a minimum of 3 working days prior to the move". That utility work is the carrier’s cost and is unquantified.',
    },
  ),
  escortRule(
    'sc-length-125-to-150',
    '125 ft up to and including 150 ft overall — one REAR civilian escort on all roadways',
    {
      kind: 'between',
      measure: 'overallLengthIn',
      min: ftIn(125),
      max: ftIn(150),
    },
    {
      escorts: 1,
      rear: 1,
      advisory:
        '§Q: "Overall length of 125 feet up to and including 150 feet: One rear civilian escort is required on all roadways." THE BOTTOM BOUNDARY IS INCLUSIVE — "of 125 feet up to" — which differs from every width band in the same list, all of which read "exceeding". 125 ft is also the permit ceiling for a non-divisible load, so this band is only reachable through §L’s discretionary exception, which needs drawings, photographs and a requested route submitted at least five days ahead.',
    },
  ),
  escortRule(
    'sc-length-over-150',
    'Over 150 ft overall — one FRONT and one REAR civilian escort on all roadways',
    { kind: 'gt', measure: 'overallLengthIn', value: ftIn(150) },
    { escorts: 2, front: 1, rear: 1 },
  ),
  escortRule(
    'sc-rear-overhang-15-to-25',
    'Rear overhang over 15 ft up to 25 ft — one REAR escort and an 18-inch red flag',
    {
      kind: 'all',
      of: [
        { kind: 'gt', measure: 'rearOverhangIn', value: ftIn(15) },
        { kind: 'between', measure: 'rearOverhangIn', min: ftIn(15), max: ftIn(25), minInclusive: false },
      ],
    },
    {
      escorts: 1,
      rear: 1,
      advisory:
        '§Q: "All loads with overhang exceeding 15 feet up to 25 feet over the rear of the trailer are required to have a red flag, not less than 18 inches square, at the end of the load AND one rear escort during entire movement over all highways." §L-2(a) caps a permitted rear overhang at 15 ft on a trailer under 48 ft and at 10 ft on a 48 or 53 ft trailer, so this band is only reachable through the §L exception.',
    },
  ),
  escortRule(
    'sc-rear-overhang-over-25-unpublished',
    'Above 25 ft of rear overhang South Carolina publishes no escort rule at all',
    { kind: 'gt', measure: 'rearOverhangIn', value: ftIn(25) },
    {
      manualReview:
        'The overhang escort band has a TOP — "exceeding 15 feet up to 25 feet" — and nothing is published above it. No escort count, no warning device and no prohibition. The band is also already past §L-2(a)’s 15 ft permitted maximum, so a load here needs the §L discretionary exception before the question even arises. Nothing has been extrapolated from the band below.',
    },
  ),
  /**
   * A DISJUNCTION THE CARRIER CHOOSES, not a requirement — and getting it wrong
   * in either direction misprices the move.
   */
  escortRule(
    'sc-overhang-warning-device-or-escort',
    'Between 6 ft and 15 ft of rear overhang the warning requirement is a CHOICE, not an escort',
    {
      kind: 'all',
      of: [
        { kind: 'gt', measure: 'rearOverhangIn', value: ftIn(6) },
        { kind: 'between', measure: 'rearOverhangIn', min: ftIn(6), max: ftIn(15), minInclusive: false },
      ],
    },
    {
      advisory:
        '§L-2(a): "Flags and a rotating amber beacon or strobe light must be on the rear of the load OR flags on the rear of the load and a rear civilian escort with such warning devices required by the Department", and the same structure at 6 ft on expandable or pole trailers. THE CARRIER CHOOSES. An engine that always booked the escort would over-quote and one that never booked it would under-quote whenever the beacon is unavailable, so NO escort is priced for this band and the choice is stated instead.',
    },
  ),
  /**
   * STATED AFFIRMATIVELY, because the absence is the finding.
   */
  escortRule(
    'sc-no-weight-based-escort-trigger',
    'South Carolina publishes NO weight-based escort trigger',
    { kind: 'gt', measure: 'grossWeightLbs', value: 73280 },
    {
      advisory:
        'The Guidelines’ escort section is a complete seven-bullet table and every bullet keys on WIDTH, HEIGHT, LENGTH or OVERHANG: over 12 ft to 14 ft, over 14 ft to 16 ft, over 16 ft, 16 ft high and greater, 125 ft to 150 ft long, over 150 ft long, and overhang over 15 ft. NO WEIGHT FIGURE APPEARS IN IT. South Carolina’s weight thresholds — 130,000, 180,000, 300,000 and 500,000 lb — attach fees, an insurance certificate, engineering analysis and structural review, and NOT escorts. A 400,000 lb load ten feet wide requires no escort under the published table. This is a published absence, not an unsearched gap; contrast Mississippi, which publishes two blue-light escorts at 300,000 lb. SCDOT does reserve a general discretion — "The Department reserves the right to require escorts where it is deemed necessary for safety purposes" — which sets no threshold and is not priced.',
    },
  ),
  /**
   * CONFLICT 1, on the quote, for every load it can reach.
   */
  escortRule(
    'sc-superload-impact-fee-basis-unpublished',
    'Over 130,000 lb — the superload impact fee states a rate and no basis',
    { kind: 'gt', measure: 'grossWeightLbs', value: 130000 },
    {
      manualReview: `${SOUTH_CAROLINA_SUPERLOAD_IMPACT_FEE_CONFLICT.detail} ${SOUTH_CAROLINA_SUPERLOAD_ENGINEERING_FEE_NOTE}`,
      },
    SC_57_3_130,
    '2012-02-01',
  ),
  escortRule(
    'sc-megaload-impact-fee-over-500000',
    'Over 500,000 lb — an additional megaload impact fee, per mile, on the entire gross vehicle weight',
    { kind: 'gt', measure: 'grossWeightLbs', value: 500000 },
    {
      manualReview: SOUTH_CAROLINA_MEGALOAD_IMPACT_FEE.detail,
    },
    SC_57_3_130,
    '2012-02-01',
  ),
  /**
   * The interstate exception to the 73,280 lb headline, stated where it bites.
   */
  escortRule(
    'sc-interstate-gross-73280-to-80000',
    'Between 73,280 lb and 80,000 lb the interstate formula may make the load legal where the headline table does not',
    {
      kind: 'between',
      measure: 'grossWeightLbs',
      min: 73281,
      max: 80000,
    },
    {
      advisory:
        '§ 56-5-4140(A)(1) caps a five-or-more-axle combination at 73,280 lb "upon any section of highway, INCLUDING the interstate highway system, except where the formula in item (4) allows for a higher weight", and item (4) lets a vehicle over 75,185 lb "operate upon any section of highway in the Interstate System up to an overall maximum of 80,000 pounds" if it satisfies South Carolina’s own bridge table. This quote records 73,280 lb as the legal gross, which is the statute’s headline figure and the correct one off the interstate; ON an interstate route with compliant axle spacing this load may be legal and need no permit at all. A ten per cent enforcement TOLERANCE also exists off the interstate (fifteen per cent for unprocessed forest products and for sod) — but a tolerance is an enforcement concept, not a permit threshold, and it has not been added to the limit.',
      },
    SC_56_5_4140,
    '2016-05-25',
  ),
  /** CONFLICT 2 — a one-pound band, inside one document. */
  escortRule(
    'sc-insurance-180000-boundary',
    'At exactly 180,000 lb one paragraph of the Guidelines requires an insurance certificate and another does not',
    { kind: 'between', measure: 'grossWeightLbs', min: 180000, max: 180000 },
    {
      advisory:
        'Guidelines §E-11: "A load EXCEEDING 180,000 lbs. must be submitted with a Certificate of Insurance or have a Certificate of Insurance form on file with the SC Permit office." Guidelines §M-5: "Proof of insurance must be provided with application submittal when the gross vehicle weight is 180,000 lbs. OR GREATER and/or the overall width is 16 feet or greater." Same document, same requirement, and at exactly 180,000 lb they disagree. §M-5 also adds a WIDTH trigger §E-11 lacks, and that trigger is INCLUSIVE at 16 ft while the escort rule at the same width is EXCLUSIVE — so a load at exactly 16 ft 0 in needs the insurance certificate and does not need the police escorts. Neither reading has been adopted. South Carolina’s baseline insurance requirement is a $1,000,000 automobile and $1,000,000 general liability minimum, double Mississippi’s $500,000 single limit.',
    },
  ),
  /** CONFLICT 3 — six inches, on an annual permit. */
  escortRule(
    'sc-annual-permit-height-14-6-vs-15',
    'Annual permit height ceiling: the statute says 14 ft 6 in and the Guidelines allow 15 ft',
    {
      kind: 'between',
      measure: 'heightIn',
      min: ftIn(14, 6),
      max: ftIn(15),
      minInclusive: false,
    },
    {
      advisory:
        '§ 57-3-190: "The Department of Transportation ... may issue open-end or annual permits for moving oversize loads and vehicles, oversize mobile homes, modular home units, utility buildings, and steel tanks, pursuant to Sections 57-3-160, 57-3-170, and 57-3-180. ALL HEIGHTS MAY NOT EXCEED FOURTEEN AND ONE-HALF FEET." Guidelines §E-4 allows "A maximum height of 15 feet" on every multiple-trip route-specific permit — non-divisible loads, mobile homes and containerised cargo alike. Six inches, in a state where 16 ft triggers a route survey and a height-pole escort. The statute’s ceiling is arguably confined to the open-end products of §§ 57-3-160/170/180 rather than to every multiple-trip permit, which would dissolve the conflict — but its own words are "All heights". Both are on file and neither has been adjudicated. This quote prices a SINGLE-TRIP permit, on which no such ceiling is stated.',
      },
    SC_57_3_190,
    '1994-01-01',
  ),
  /** CONFLICT 4 — same document, same trigger, two processes. */
  escortRule(
    'sc-route-survey-self-certified-vs-approved',
    'The 16 ft route survey is self-certified in one paragraph and department-approved in another',
    { kind: 'gte', measure: 'heightIn', value: ftIn(16) },
    {
      advisory:
        '§Q: "A route survey, CERTIFIED AS CORRECT BY THE APPLICANT, shall also be provided to the permit office prior to permit issuance." §L-3(c): "ALL loads 16 feet in height and above must provide a DEPARTMENT APPROVED route survey prior to permit issuance." Same document, same trigger, two different processes with two different lead times — self-certification is same-day and department approval is not. It affects schedule rather than price, and neither reading has been adopted. SCDOT publishes no charge for the survey and no charge to review it.',
    },
  ),
  /**
   * The bucket-truck carve-out, which is the only one of its kind in the three
   * states added in this phase.
   */
  escortRule(
    'sc-boom-and-bucket-not-load',
    'A permanently attached hydraulic boom and bucket on an electric-line vehicle is not "load" up to 8 ft of front projection',
    { kind: 'gt', measure: 'frontOverhangIn', value: ftIn(3) },
    {
      advisory:
        '§ 56-5-4080: "the hydraulic boom and bucket permanently attached to a vehicle used in the maintenance and construction of electric service lines shall not be considered as load within the meaning of this section. Provided, further, that such boom and bucket shall not extend more than eight feet beyond the foremost part of the vehicle." So a bucket truck at 7 ft of front projection is legal and unpermitted where an identical projection on any other vehicle needs a permit at 3 ft. The quote does not collect vehicle type, so the ordinary 3 ft limit has been applied and this exemption has NOT been taken; if the projection is a permanently attached boom and bucket on a line-maintenance vehicle, the front-overhang permit above is not needed.',
      },
    SC_56_5_4080,
    '1972-01-01',
  ),
  escortRule(
    'sc-open-end-and-megaload-distance-terms',
    'South Carolina has two distance-priced fees and neither is on the single-trip permit',
    NEEDS_A_SOUTH_CAROLINA_PERMIT,
    {
      advisory: `${SOUTH_CAROLINA_OPEN_END_TRIP_FEE.detail} The other is the megaload impact fee above 500,000 lb. Neither reaches the single-trip permit this quote prices, which is flat.`,
      },
    SC_57_3_180,
    '1994-01-01',
  ),
  escortRule(
    'sc-no-pilot-car-certification',
    'South Carolina does not certify pilot/escort vehicle operators — and both its I-95 neighbours do',
    NEEDS_A_SOUTH_CAROLINA_PERMIT,
    {
      advisory:
        'South Carolina is not on FHWA’s certification list, and independently the Guidelines’ §Q specifies VEHICLE, LIGHTING, SIGNAGE, SPACING AND RADIO ONLY — one roof-mounted amber light visible 500 ft at 360 degrees, a 12 in x 7 ft OVERSIZE LOAD or WIDE LOAD banner front and rear, a rear escort 3-4 seconds back and a front escort no more than half a mile ahead, and two-way radio — with no operator qualification of any kind. INBOUND, no South Carolina certification exists to require. OUTBOUND MATTERS MORE HERE THAN ANYWHERE: BOTH of South Carolina’s I-95 neighbours, North Carolina and Georgia, ARE on FHWA’s certification list, so a South Carolina pilot car cannot legally cross either state line without obtaining that state’s certification. Note also that "An escorting vehicle shall not escort or communicate with more than one towing vehicle at a time" and that multiple permitted loads "shall NOT travel in a convoy ... must be at least 2 miles apart", which together make a multi-load move genuinely expensive.',
      },
    FHWA_PEVO,
    RETRIEVED,
  ),
];

// ── The jurisdiction ──────────────────────────────────────────────────────

export const SOUTH_CAROLINA_OSOW_RULES: JurisdictionOsowRules = {
  code: 'SC',
  name: 'South Carolina',
  country: 'US',

  legalLimits: {
    widthIn: [
      fromYearDatedStatute(
        102,
        SC_56_5_4030,
        '2002',
        '§ 56-5-4030(B): "The total outside width of a vehicle or the load on it may not exceed one hundred two inches exclusive of safety devices approved by the Department of Public Safety." Exclusive. Non-commercial motor homes, travel trailers and truck campers get an extra six inches on one side and four on the other under (C); an exempt vehicle — fire apparatus, road machinery, products of husbandry, timber equipment — may reach 12 ft, and a farm implement 16 ft, in clear weather during daylight only.',
      ),
    ],
    heightIn: [
      fromDated(
        ftIn(13, 6),
        SC_56_5_4060,
        '2008-05-22',
        '§ 56-5-4060(A)(1): "No vehicle, unladen or with load, may exceed a height of thirteen feet six inches except that the height of an automobile transporter unit or a heavy truck transporting one or more other heavy trucks in a saddle mount combination may not exceed fourteen feet." THE 14 FT EXCEPTION IS FREE BUT CONDITIONAL: "All applicants shall be issued routing permits at no charge upon providing the department with evidence of its general liability coverage. Routing permits shall remain valid for twelve months from the date of issuance." A permit required at a fee of zero — a distinct thing from a fee we do not know, and not modelled here.',
      ),
    ],
    trailerLengthIn: [
      fromDated(
        ftIn(53),
        SC_56_5_4070,
        '2016-05-25',
        '§ 56-5-4070(A)(1): "No trailer or semitrailer may be operated in a two unit truck tractor-trailer or truck tractor-semitrailer combination in excess of fifty-three feet, inclusive of the load carried on it."',
      ),
    ],
    /**
     * SOUTH CAROLINA REGULATES BOTH LENGTH AND KINGPIN DISTANCE, in the same
     * sentence, so both fields are populated — see `LegalLimits.kingpinToRearAxleIn`
     * for why they are two fields rather than two rows of one.
     */
    kingpinToRearAxleIn: [
      fromDated(
        ftIn(41),
        SC_56_5_4070,
        '2016-05-25',
        '§ 56-5-4070(A)(1): "A fifty-three foot long trailer must be equipped with a rear underride guard, and the distance between the kingpin of the vehicle and the center of the rear axle assembly or to the center of the tandem axle assembly if equipped with two axles may be no greater than forty-one feet." A motorsports exception raises it to 46 ft for trailers "used exclusively or primarily to transport vehicles used in connection with motorsports competition events", which the quote does not collect and which is therefore recorded rather than applied.',
      ),
    ],
    /**
     * `overallLengthIn` IS ABSENT, AND IT IS A CLEAN, EXPLICIT NEGATIVE:
     * § 56-5-4070(E), "Except where specifically prohibited in this article,
     * there is no overall length limit on combination vehicles." South Carolina's
     * length triggers come from the PERMIT ceiling (125 ft non-divisible) and
     * from the ESCORT rules (125 ft and 150 ft), not from a legal-length limit,
     * and an empty array would claim we looked for one and found nothing.
     */
    frontOverhangIn: [
      fromYearDatedStatute(
        ftIn(3),
        SC_56_5_4080,
        '1972',
        '§ 56-5-4080: "the load upon any vehicle operated alone or the load upon the front vehicle of a combination of vehicles shall not extend more than three feet beyond the foremost part of the vehicle". A permanently attached hydraulic boom and bucket on an electric-line maintenance vehicle is expressly NOT load and may reach 8 ft — see sc-boom-and-bucket-not-load. §L-2(b) caps a PERMITTED front overhang at 3 ft as well: "A maximum of 3 feet front overhang is allowed on all trailers."',
      ),
    ],
    rearOverhangIn: [
      fromYearDatedStatute(
        ftIn(6),
        SC_56_5_4080,
        '1972',
        '§ 56-5-4080: "the load upon any vehicle operated alone or the load upon the rear vehicle of a combination of vehicles shall not extend more than six feet beyond the rear of the bed or body of such vehicle". THE DATUM IS THE REAR OF THE BED OR BODY, not the rear axle. §L-2(a) caps a PERMITTED rear overhang at 15 ft on a trailer under 48 ft and at 10 ft on a 48 ft or 53 ft trailer.',
      ),
    ],
    /**
     * 73,280 LB, NOT 80,000 — the statute's own headline figure, applying "upon
     * any section of highway, including the interstate highway system". The
     * interstate path to 80,000 is item (4)'s formula and is stated by
     * `sc-interstate-gross-73280-to-80000` for the band it can reach.
     */
    grossWeightLbs: [
      fromDated(
        73280,
        SC_56_5_4140,
        '2016-05-25',
        '§ 56-5-4140(A)(1): "The gross weight of a vehicle or combination of vehicles, operated or moved upon any section of highway, including the interstate highway system, except where the formula in item (4) allows for a higher weight, shall not exceed: (The following weight limits do not include applicable tolerances) ... (g) Combination of vehicles with five or more axles 73,280 lbs." The table is BY AXLE COUNT: 35,000 / 46,000 / 63,500 / 65,000 lb for a single-unit vehicle of two, three, four and five or more axles, and 50,000 / 65,000 / 73,280 lb for a combination of three, four and five or more. Item (4) is the interstate exception to 80,000 lb through South Carolina’s own bridge table, which is held in stateBridgeTable and is NOT the federal one. The ten per cent enforcement tolerance of § 56-5-4160 is an enforcement concept and is deliberately not added here: SCDOT’s permit trigger is the un-toleranced limit.',
      ),
    ],
    singleAxleLbs: [
      fromDated(
        20000,
        SC_56_5_4140,
        '2016-05-25',
        'THE STATUTORY AXLE LIMIT DEPENDS ON TYRE INFLATION PRESSURE AND SCDOT DOES NOT USE IT THAT WAY. § 56-5-4130(A)(1) sets 16,000 lb on "high-pressure pneumatic, solid rubber or cushion tires" and 20,000 lb on "low-pressure pneumatic tires", and (B) defines a high-pressure tyre as one inflated to 100 psi or more — which describes essentially every modern truck tyre and would cap the axle at 16,000 lb. But § 56-5-4140’s interstate proviso and SCDOT’s own §L-6(a) ("Single axle 20,000 lbs.") both work from 20,000, and that is the figure recorded. The distinction is not resolvable from the published text. A single axle over 20,000 lb is ALSO a superload trigger in its own right, which a gross-weight check on a 95,000 lb load would miss.',
      ),
    ],
    tandemAxleLbs: [
      fromDated(
        36000,
        SC_56_5_4140,
        '2016-05-25',
        '§ 56-5-4140: "The gross weight imposed upon any highway or section of highway OTHER THAN THE INTERSTATE by two or more consecutive axles in tandem ... spaced not less than forty inches nor more than ninety-six inches apart shall not exceed thirty-six thousand pounds." SOUTH CAROLINA’S NON-INTERSTATE TANDEM IS HIGHER THAN ITS INTERSTATE ONE, which is the reverse of the usual pattern: on the interstate the cap is 35,200 lb INCLUDING all enforcement tolerances, and that figure lives in stateBridgeTable because it is a row of South Carolina’s own bridge table where the federal table reads 34,000.',
      ),
    ],
  },

  /** $30, statute and agency, verbatim. */
  permitBaseFeeUsd: [
    fromDated(
      30,
      SC_57_3_130,
      '2012-02-01',
      '§ 57-3-130(A): "The department may charge the following rates for oversize or overweight permits and licenses: Single Trip $30.00". The excessive-width steps in the same table are NOT added here — see SOUTH_CAROLINA_EXCESSIVE_WIDTH_STEPS and sc-width-over-16 for why.',
    ),
    fromDated(
      30,
      GUIDELINES,
      GUIDELINES_FROM,
      'Guidelines §K: "Permit Fees: Single Trip Permit $30.00". A single-trip permit is valid for 7 days — the longest window of the three states added in this phase, against Mississippi’s 3 and Michigan’s 5 — and offers NO return move: "Permit is valid for 7 days to allow for a one-time/one trip move."',
    ),
  ],

  /**
   * INCLUDED IN THE BASE FEE, and that is a priced answer rather than a gap.
   *
   * South Carolina's fee table prints NO weight-graduated charge at all below
   * the 130,000 lb superload line: the $30 single-trip permit covers an
   * overweight move, an oversize move, or both. Every poundage fee in § 57-3-130
   * — the $3.00 per 1,000 lb impact fee, the $100/$200/$350 engineering analysis
   * and the $0.05 per 1,000 lb per mile megaload fee — starts at or above
   * 130,000 lb, which is the superload threshold, and the engine deliberately
   * prices no superload.
   */
  overweightPricing: [
    fromDated<OverweightPricing>(
      {
        kind: 'includedInBaseFee',
        explanation:
          '§ 57-3-130(A) prints no weight-stepped, per-ton or per-mile charge on the ordinary permit: the $30 single-trip fee covers an overweight move up to the 130,000 lb superload line. Above that line the load is a superload, is not issued over the counter, and attracts a $100 non-refundable application fee, a $100/$200/$350 engineering-analysis fee and a $3.00 per 1,000 lb impact fee whose basis the statute does not state — none of which is quoted here.',
      },
      SC_57_3_130,
      '2012-02-01',
    ),
    fromDated<OverweightPricing>(
      {
        kind: 'includedInBaseFee',
        explanation:
          'The Guidelines reprint § 57-3-130(A) line for line and add no weight-graduated charge to the single-trip permit.',
      },
      GUIDELINES,
      GUIDELINES_FROM,
    ),
  ],

  overweightBands: [],
  /**
   * EMPTY, AND THE MILEAGE TERM IS REAL BUT DORMANT. See
   * `SOUTH_CAROLINA_MEGALOAD_IMPACT_FEE`: the only genuinely distance-priced fee
   * starts at 500,000 lb, nearly four times the superload threshold, so a row
   * here could never be reached by the fee block. Recording it anyway would be
   * data that looks priced and is not.
   */
  overweightPerMile: [],
  conditionalFees: [],

  /**
   * EMPTY. SCDOT names the charge and declines to quantify it: "Please note when
   * transferring monies from a credit card to an escrow account an additional
   * fee is charged by the credit card authorizer." It is a third party's charge,
   * not a state fee, and "named but not quantified" is not zero.
   */
  transactionFee: [],

  /**
   * BOTH EMPTY. The APPLICANT provides the route survey and SCDOT publishes no
   * charge for it and none to review it. The $100/$200/$350 engineering-analysis
   * fees are WEIGHT-triggered superload review, not route-survey review, and are
   * held in `SOUTH_CAROLINA_SUPERLOAD_ENGINEERING_FEES` because a load heavy
   * enough to owe one is a superload the engine does not price.
   */
  routeAnalysisFeeUsd: [],
  noBridgeRouteFeeUsd: [],

  superload: {
    /**
     * WEIGHT-DEFINED ONLY. South Carolina has no dimensional superload class at
     * all — a wide load runs into the 16 ft PERMIT CEILING and the frame-building
     * process instead, which `sc-width-over-16` carries.
     */
    grossWeight: [
      fromDated<Threshold>(
        { value: 130000, inclusive: false },
        GUIDELINES,
        GUIDELINES_FROM,
        'Guidelines §E-11: "Superload: Any non-divisible load exceeding 130,000 pounds and/or any single axle weight that exceeds 20,000 lbs. will require additional routing analysis. This process may take from 3 to 5 business days." Both boundaries exclusive. THE AXLE TRIGGER IS THE ONE THAT GETS MISSED — a 95,000 lb load on a short wheelbase with one axle at 20,500 lb is a South Carolina superload even though its gross is well under 130,000 — and it is checked by stateBridgeTable, whose single-axle cap is the same 20,000 lb, whenever axle detail is supplied. §L-5 corroborates the weight line from the other side by capping a PERMITTED combination at 130,000 lb on seven axles.',
      ),
    ],
    shortSpacing: [],
  },

  /**
   * The route survey South Carolina requires, and its one published trigger.
   * Width and length have none: a wide or long load runs into the permit ceiling
   * and the §L discretionary-exception process instead.
   */
  routeInspection: {
    widthIn: [],
    heightIn: [
      fromDated<Threshold>(
        { value: ftIn(16), inclusive: true },
        GUIDELINES,
        GUIDELINES_FROM,
        'Guidelines §L-3(c): "ALL loads 16 feet in height and above must provide a department approved route survey prior to permit issuance. A front escort vehicle with a height pole shall be required during the entire move." Inclusive. §Q states the same trigger with a different process — see sc-route-survey-self-certified-vs-approved.',
      ),
    ],
    lengthIn: [],
  },

  /**
   * SOUTH CAROLINA'S OWN BRIDGE TABLE — the field that keeps the engine out of
   * `bridgeFormula.ts` for this state. See `SC_BRIDGE_TABLE` and
   * `StateBridgeTable`.
   */
  stateBridgeTable: [
    fromDated(SC_BRIDGE_TABLE, SC_56_5_4140, '2016-05-25'),
  ],

  escortRules: SOUTH_CAROLINA_ESCORT_RULES,

  /**
   * TRUE, AND THE TERM IS DORMANT ON AN ORDINARY PERMIT. South Carolina's
   * schedule contains two distance terms — the megaload impact fee at $0.05 per
   * 1,000 lb per mile above 500,000 lb, and § 57-3-180's $10 a trip (or $1 under
   * twelve miles) on an open-end permit — so recording `false` would say the
   * state's fees are flat, which is untrue of its own schedule. Every ordinary
   * single-trip permit is nevertheless flat at $30, and the engine's distance
   * guard is what makes sure a lane whose in-state mileage is unknown is not
   * quoted as though the state had no mileage term at all.
   */
  feesDependOnDistance: true,
};
