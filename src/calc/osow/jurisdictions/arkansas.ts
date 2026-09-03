/**
 * ARKANSAS — oversize/overweight single-trip permit rules.
 *
 * THE FIRST STATE WHOSE PERMIT IS PRICED BY THE TON.
 * -------------------------------------------------
 * Ark. Code §27-35-210(e) is two sentences and a table: "A charge of seventeen
 * dollars ($17.00) shall be made for each special permit", and then "for each
 * ton or major fraction thereof to be hauled in excess of the lawful weight and
 * load for that vehicle, or combination of vehicles", a per-ton charge that
 * STEPS BY MILEAGE — $8.00 a ton up to 100 miles, $16.00 a ton past 251. The
 * mileage picks the rate and then leaves the arithmetic; nothing is multiplied
 * by the distance. That fits neither `feeUsd` (flat in weight) nor
 * `PerMileRate` (multiplies by miles), so `WeightBand` grew an optional
 * per-increment component, exactly parallel to Colorado's `perAxleUsd`. See
 * `WeightBand` for the Phase 6 note.
 *
 * WHERE THE NUMBERS COME FROM, AND WHERE THEY DO NOT.
 * --------------------------------------------------
 * Everything below is quoted from primary text: ARDOT's own 2023 Permit Rules
 * booklet, the codified 27 CAR Part 111 Appendix, the 2025 redline draft of
 * Part 111, and the Arkansas Code. A paraphrased research summary was supplied
 * with this state and is deliberately NOT cited anywhere in this file — it
 * carried no verbatim quotations and no revision dates, so it could serve as an
 * index to the documents and nothing more. Three of its claims could not be
 * found in primary text at all and are recorded as unknown; they are listed at
 * the end of this header.
 *
 * SOURCE-QUALITY CAVEAT. The two rule documents are OFFICIAL (ardot.gov and
 * codeofarrules.arkansas.gov). The Arkansas Code itself is not available in
 * machine-readable form from arkleg.state.ar.us, and law.justia.com returned
 * 403 throughout collection, so the STATUTE rows come from FindLaw and one
 * corroborating row from Cornell LII. Both are SECONDARY publishers reproducing
 * official text, and both say so in their titles, the way `california.ts` marks
 * its CVC rows.
 *
 * ── THE 251-MILE GAP IS REAL ──────────────────────────────────────────────
 * The statute's top mileage band reads "Over 251 miles". The band below it
 * reads "201 miles to 250 miles, inclusive". A move of EXACTLY 251 miles is
 * therefore priced by no band the statute publishes — and this is not a
 * transcription artefact: FindLaw's rendering of the current §27-35-210(e)(2)
 * and Cornell LII's rendering of the 1992 permit regulation that carried the
 * same table both print "OVER 251 MILES", thirty-three years apart.
 *
 * ARDOT closes the hole in its own documents. The 2023 Permit Rules Appendix 3
 * and the codified 27 CAR Part 111 Appendix both print "251 miles or more".
 *
 * So one document prices a 251-mile move and another does not, which is the
 * Washington 999-pound case in a different dimension — there is no second
 * number to weigh against the first, so it is not a conflict and the resolver
 * has nothing to adjudicate. It is A HOLE IN THE RATE TABLE, and it is left as
 * one: every top-band row starts at 252 miles, the range all three documents
 * name, a 251-mile move matches no band, and the engine says the published
 * schedule does not price it. Nothing is rounded into a band Arkansas did not
 * put it in. See `ARKANSAS_251_MILE_GAP`.
 *
 * The same is true, four times over, of FRACTIONAL mileages. The chart is
 * written in whole miles — "100 Miles or Less", then "101 to 150" — so 100.4
 * miles sits between two bands. Louisiana's five distance columns have exactly
 * this shape and are encoded exactly this way; a mileage between two columns
 * matches nothing and the engine says so.
 *
 * ── THE CONFLICT THE SUMMARY MISSED ───────────────────────────────────────
 * The research reported ZERO source conflicts for Arkansas. There is at least
 * one, it is live, and it changes a REQUIREMENT rather than a fee.
 *
 * 27 CAR §111-505(c) — the codified escort rule for manufactured homes — sets
 * the one-escort/two-escort boundary at FOURTEEN FEET SIX INCHES. Its own
 * authorising statute, Ark. Code §27-35-306, sets it at FOURTEEN FEET NINE
 * INCHES, and so does the Commission's published 2023 Permit Rules booklet at
 * Rule 6.E.3 and Rule 7.F.2. Three inches decides whether a 14 ft 8 in
 * manufactured home moves with one pilot car or two.
 *
 * The 2025 redline draft is what makes the codified text legible: it strikes
 * "six"/"(14' 6")" and adds "nine"/"(14' 9")" in all six places, which is the
 * state itself acknowledging the discrepancy and proposing to fix it. THE DRAFT
 * IS NOT IN FORCE — it is captioned "Proposed Rulemaking", it says "Stricken
 * language would be deleted from and underlined language would be added to the
 * Code of Arkansas Rules", every page is watermarked DRAFT 08/04/2025, and it
 * states no effective date anywhere. So it is used ONLY as evidence of what the
 * codified rule says TODAY (the stricken side), never as a source of
 * prospective values. Louisiana's Acts 2019 No. 301 could displace the older
 * text because it came with an effective date; this cannot, and inventing one
 * would be manufacturing the supersession.
 *
 * Both live readings are on file in `ARKANSAS_MANUFACTURED_HOME_ESCORT_WIDTH_IN`
 * and `resolveSourced` refuses to pick between them — the Louisiana treatment
 * for a conflict a single-trip quote does not price. It is NOT written as an
 * escort rule, because nothing on an `OsowLoad` says a load is a manufactured
 * home, and a 14'6"–14'9" rule with no way to tell a mobile home from a
 * transformer would fire on loads Arkansas's manufactured-home carve-out does
 * not reach. What the escort rules below encode is the GENERAL case, which is
 * how every one of those paragraphs opens: "Except for manufactured home
 * units…". A manufactured home between 14 ft and 14 ft 9 in therefore reads
 * two escorts here where Arkansas would require one — an over-statement of the
 * requirement, stated rather than hidden, and not a priced line either way
 * (`escortCost` is the caller's own pilot-car rate, never a state fee).
 *
 * A SECOND, SMALLER DISCREPANCY, recorded and not modelled: the same redline
 * strikes "December 2, 1992" and adds "December 2, 1982" in the twin-trailer
 * length rule. The codified CAR carries a manufacture-date cutoff a decade off
 * from the one in the 2023 booklet, and 1982 is the date the federal STAA
 * actually uses. It decides 28 ft against 28 ft 6 in for a trailer built in the
 * 1980s in a truck-tractor-semitrailer-trailer combination — a configuration
 * this file does not price and for which Arkansas issues no over-length permit
 * at all (Rule 3.G.5). See `ARKANSAS_TWIN_TRAILER_CUTOFF_DISCREPANCY`.
 *
 * ── WHAT IS INFERRED, AND SAID TO BE ──────────────────────────────────────
 *
 *   1. "MAJOR FRACTION" MEANS MORE THAN HALF. The phrase "for each ton or major
 *      fraction thereof" is verbatim in all three fee documents. Nothing in the
 *      statute, the rules or the appendix defines it, and FindLaw's copy of
 *      §27-35-210 carries no definition either — this was checked directly. So
 *      reading it as "a part ton over 1,000 lb is charged, 1,000 lb or less is
 *      dropped" is OUR CONSTRUCTION of the ordinary meaning of "major", not
 *      Arkansas's words. It is encoded because the alternative reading is
 *      demonstrably wrong — "or major fraction thereof" is not "or fraction
 *      thereof", and treating them alike would over-bill every partial-ton load
 *      in the state — and because refusing to price Arkansas at all over an
 *      undefined adjective would be worse than pricing it with the inference on
 *      the record. It moves at most one ton, which is $8 to $16.
 *      See `ARKANSAS_TON_ROUNDING_INFERENCE`.
 *   2. THE EXCESS IS COUNTED OVER 80,000 LB. The statute counts tons "in excess
 *      of the lawful weight and load for THAT VEHICLE, or combination of
 *      vehicles" — which is the bridge-formula answer for that specific axle
 *      layout, not a constant. 80,000 lb is the lawful gross for the five-or-
 *      more-axle combination that every overweight permit in this file is
 *      priced for, and it is the figure ARDOT's own Table of Legal Dimensions
 *      prints. A three-axle straight truck has a lower lawful weight and would
 *      be UNDER-billed by this base. Flagged as
 *      `ARKANSAS_EXCESS_BASE_INFERENCE_LBS`, the same treatment Washington gives
 *      its own excess base.
 *
 * ── WHAT IS NOT PRICED, AND WHY ───────────────────────────────────────────
 *
 *   - THE MOBILE CONSTRUCTION SCHEDULE. §27-35-210(i) and Appendix 3 print a
 *     SECOND per-ton chart for "mobile construction vehicles and equipment" —
 *     Rule 5's Vehicles of Special Design — and it is progressive: a different
 *     rate for the first five tons, the next five, and everything above, each
 *     stepped by the same five mileage bands. Two things stop it being priced.
 *     Nothing on an `OsowLoad` says a load is a Vehicle of Special Design, so
 *     the engine could not choose between the two charts; and a progressive
 *     tier is not a `WeightBand`, which prices one rate across the whole excess.
 *     The chart is transcribed cell for cell in
 *     `ARKANSAS_MOBILE_CONSTRUCTION_FEE_SCHEDULE` and the general chart is what
 *     the engine applies — which is the CONSERVATIVE direction, since every
 *     mobile-construction rate is below the general rate for the same mileage.
 *   - THE $500 SUPERLOAD SUPPLEMENT. §27-35-210(e)(3): "In addition to the fees
 *     prescribed in subdivisions (e)(1) and (2) of this section, a fee NOT TO
 *     EXCEED five hundred dollars ($500) shall be charged for a vehicle,
 *     unladen or with load, whose gross weight is one hundred eighty thousand
 *     pounds (180,000 lbs.) or greater." A ceiling is not an amount, so it is
 *     not a `ConditionalFee` — and it could never be reached if it were, because
 *     its trigger is the superload threshold itself and the engine emits no
 *     priced lines for a superload. Recorded in
 *     `ARKANSAS_SUPERLOAD_SUPPLEMENTAL_FEE_CEILING_USD`.
 *   - THE TRANSACTION FEE, WHICH ARKANSAS DOES NOT PUBLISH. Rule 2.C. mentions
 *     "the use of approved credit cards" and stops there; no percentage, no
 *     flat charge, nothing in the statute. `transactionFee` is an EMPTY list
 *     rather than a sourced zero, so the engine says on every Arkansas quote
 *     that no transaction cost is on file — the Louisiana treatment.
 *   - THE ROUTE ANALYSIS FEE. Arkansas publishes none. 27 CAR §111-110(b) gives
 *     the Department "the discretion to require engineering examinations" for a
 *     super load and names no charge, so `routeAnalysisFeeUsd` and
 *     `noBridgeRouteFeeUsd` are empty and the whole `routeInspection` block is
 *     empty: there is no published dimensional trigger for a survey, and
 *     inventing one would flag a step Arkansas has not defined.
 *   - THE POLICE ESCORT. Rule 6.E.6 lets the Permit Section "require one or more
 *     vehicles from an appropriate law enforcement agency", with no threshold
 *     and no rate. That is Texas's discretionary case exactly, and it is carried
 *     as an ADVISORY: the price stands and the exclusion is stated.
 *
 * ── CLAIMS FROM THE RESEARCH SUMMARY LEFT UNKNOWN ─────────────────────────
 *   - That Act 871 of 2021 raised the height limit from 13'6" to 14'0". The 14
 *     ft limit is confirmed three times over (§27-35-207, Rule 3.F.1, and both
 *     Tables of Legal Dimensions); the ATTRIBUTION is not. Neither rule document
 *     mentions Act 871, and FindLaw's §27-35-207 page carries no history line.
 *     No 13'6" row is recorded, because no source on file says Arkansas's limit
 *     is or ever was 13'6" — a superseded row we cannot date is not history, it
 *     is a guess.
 *   - That the manufactured-home escort boundary is 14'6". It is, in the
 *     codified rule — and the summary reported only that side, which is how it
 *     came to report zero conflicts. Both sides are on file here.
 *   - That "a partial ton exceeding 1,000 lb rounds up; 1,000 lb or less is
 *     dropped". The rounding PHRASE is verbatim; the pound figure is not in any
 *     primary text and is carried as our inference, above.
 */
import type { SourceDoc, Sourced } from '../provenance.js';
import { ftIn, type EscortRule, type RouteClass } from '../escortRules.js';
import type {
  JurisdictionOsowRules,
  OverweightPricing,
  Threshold,
  WeightBand,
} from '../types.js';

const RETRIEVED = '2026-09-03';

/**
 * FindLaw states "current as of March 28, 2024" on every Title 27 page below —
 * a full date, so it can carry an `effectiveFrom` the way Texas's FindLaw rows
 * do. It is the earliest day on which we can prove the text read this way; it
 * is NOT a claim about when the statute was enacted.
 */
const STATUTE_CURRENT_AS_OF = '2024-03-28';

// ── Source documents ──────────────────────────────────────────────────────

/**
 * ARDOT's own booklet, adopted by the State Highway Commission. Its title page
 * says "2023" and nothing more — no month, no day — which `revisedOn` accepts
 * and ranks correctly against full dates. `effectiveFrom` cannot come from a
 * bare year, so rows sourced here start on the retrieval date, the only day we
 * can prove what the document said. Same rule as Louisiana's statute rows.
 */
const ARDOT_2023_RULES: SourceDoc = {
  id: 'ar-ardot-permit-rules-2023',
  title:
    'ARDOT — Permit Rules for the Movement of Oversize and Overweight Vehicles on the Arkansas State Highway System (2023)',
  url: 'https://www.ardot.gov/wp-content/uploads/2023-Permit-Rules.pdf',
  publisher:
    'Arkansas Department of Transportation, Arkansas Highway Police Division — adopted by the Arkansas State Highway Commission',
  revisedOn: '2023',
  retrievedOn: RETRIEVED,
  cite:
    'Rule 2.A.3 Table of Legal Dimensions and Weight Limits; Rule 2.I super loads; Rule 3.C.2 the $17 fee; Rule 3.E–G escorts, width ceilings and length; Rule 6.D–E escorts; Appendix 3 the overweight fee charts',
};

/**
 * The codified appendix — the fee charts as the Code of Arkansas Rules
 * publishes them, and the document 27 CAR Part 111 links to as its Appendix A.
 * It carries no revision date of any kind.
 */
const CAR_111_APPENDIX: SourceDoc = {
  id: 'ar-car-111-appendix',
  title: '27 CAR Part 111, Appendix — Overweight Fee Chart (undated)',
  url: 'https://codeofarrules.arkansas.gov/docs/CARCodeAppendices/Appendices/226/27CARpt.111Appendix.pdf',
  publisher: 'Code of Arkansas Rules, Arkansas Secretary of State',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite:
    'Appendix 3, "OVERWEIGHT FEE CHART": "for each ton or major fraction thereof to be hauled in excess of the lawful weight and load for that vehicle, or combination of vehicles"; "100 Miles or Less $8.00 … 251 miles or more $16.00"',
};

/**
 * THE REDLINE, AND IT IS NOT IN FORCE. Captioned "Proposed Rulemaking";
 * "Stricken language would be deleted from and underlined language would be
 * added to the Code of Arkansas Rules"; every page watermarked DRAFT 08/04/2025;
 * no effective date stated anywhere in seventy-two pages.
 *
 * It is cited for ONE thing only: what the CURRENTLY CODIFIED rule says. The
 * stricken side of a redline is the text in force, so §111-505(c)'s stricken
 * "fourteen feet six inches (14' 6")" is direct evidence of the codified
 * boundary — better evidence than any secondary reproduction, because it is the
 * agency quoting its own rule in order to amend it. `revisedOn` is the draft's
 * own date and `effectiveFrom` is the retrieval date, because what we are
 * dating is the CODIFIED text this document quotes, not the amendment.
 */
const CAR_111_PROPOSED_2025: SourceDoc = {
  id: 'ar-car-111-proposed-2025-draft',
  title:
    '27 CAR Part 111 — Proposed Rulemaking redline (DRAFT 2025-08-04, NOT IN FORCE; cited only as evidence of the codified text it strikes)',
  url: 'https://www.arkleg.state.ar.us/Home/FTPDocument?path=%2FAssembly%2FMeeting+Attachments%2F040%2F27958%2FE.1.a+ADT+SHC+Permit+Rules+for+the+Mvmt+of+Oversize+and+Overweight+Vehicles+on+the+Ark+St+Hwy+System+and+Acts+256+and+700+of+2025.pdf',
  publisher: 'Arkansas State Highway Commission',
  revisedOn: '2025-08-04',
  retrievedOn: RETRIEVED,
  cite:
    '§111-110(a) super loads, text unchanged; §111-505(c) and §111-606(b), which strike "fourteen feet six inches (14\' 6")" and add "fourteen feet nine inches (14\' 9")"',
};

const AC_27_35_203: SourceDoc = {
  id: 'ar-code-27-35-203',
  title: 'Ark. Code §27-35-203 — Weight of vehicles (via FindLaw — SECONDARY source)',
  url: 'https://codes.findlaw.com/ar/title-27-transportation/ar-code-sect-27-35-203/',
  publisher: 'FindLaw, reproducing the Arkansas Code',
  revisedOn: STATUTE_CURRENT_AS_OF,
  retrievedOn: RETRIEVED,
  cite:
    '(a) "shall not exceed twenty thousand pounds (20,000 lbs.)" single axle; (b) "shall not exceed thirty-four thousand pounds (34,000 lbs.)" tandem; (d) "when the gross weight is in excess of eighty thousand pounds (80,000 lbs.)"',
};

const AC_27_35_206: SourceDoc = {
  id: 'ar-code-27-35-206',
  title: 'Ark. Code §27-35-206 — Width of vehicles (via FindLaw — SECONDARY source)',
  url: 'https://codes.findlaw.com/ar/title-27-transportation/ar-code-sect-27-35-206/',
  publisher: 'FindLaw, reproducing the Arkansas Code',
  revisedOn: STATUTE_CURRENT_AS_OF,
  retrievedOn: RETRIEVED,
  cite:
    '"a vehicle operated upon the highways of this state shall not have a total outside width, unladen or with load, in excess of one hundred two inches (102″)"',
};

const AC_27_35_207: SourceDoc = {
  id: 'ar-code-27-35-207',
  title: 'Ark. Code §27-35-207 — Height of vehicles (via FindLaw — SECONDARY source)',
  url: 'https://codes.findlaw.com/ar/title-27-transportation/ar-code-sect-27-35-207/',
  publisher: 'FindLaw, reproducing the Arkansas Code',
  revisedOn: STATUTE_CURRENT_AS_OF,
  retrievedOn: RETRIEVED,
  cite:
    '"A vehicle operated upon the highways of this state, unladen or with load, shall not exceed a height of fourteen feet (14′)"; the page carries no history line and does not mention Act 871 of 2021',
};

const AC_27_35_208: SourceDoc = {
  id: 'ar-code-27-35-208',
  title: 'Ark. Code §27-35-208 — Length of vehicles (via FindLaw — SECONDARY source)',
  url: 'https://codes.findlaw.com/ar/title-27-transportation/ar-code-sect-27-35-208/',
  publisher: 'FindLaw, reproducing the Arkansas Code',
  revisedOn: STATUTE_CURRENT_AS_OF,
  retrievedOn: RETRIEVED,
  cite:
    '"The state shall not establish or enforce any rule which imposes a semitrailer or trailer length limitation of less than fifty-three feet six inches (53′ 6″)"; "No single truck … shall have an overall length in excess of forty feet (40′)"',
};

const AC_27_35_210: SourceDoc = {
  id: 'ar-code-27-35-210',
  title:
    'Ark. Code §27-35-210 — Permits for special cargoes (via FindLaw — SECONDARY source)',
  url: 'https://codes.findlaw.com/ar/title-27-transportation/ar-code-sect-27-35-210/',
  publisher: 'FindLaw, reproducing the Arkansas Code',
  revisedOn: STATUTE_CURRENT_AS_OF,
  retrievedOn: RETRIEVED,
  cite:
    '(e)(1) "A charge of seventeen dollars ($17.00) shall be made for each special permit."; (e)(2) the per-ton mileage table, whose top band reads "Over 251 miles"; (e)(3) "a fee not to exceed five hundred dollars ($500) … whose gross weight is one hundred eighty thousand pounds (180,000 lbs.) or greater"; the section defines no "major fraction"',
};

const AC_27_35_306: SourceDoc = {
  id: 'ar-code-27-35-306',
  title:
    'Ark. Code §27-35-306 — Manufactured home escort vehicles (via FindLaw — SECONDARY source)',
  url: 'https://codes.findlaw.com/ar/title-27-transportation/ar-code-sect-27-35-306/',
  publisher: 'FindLaw, reproducing the Arkansas Code',
  revisedOn: STATUTE_CURRENT_AS_OF,
  retrievedOn: RETRIEVED,
  cite:
    '"The movement of manufactured homes in excess of twelve feet (12′) in width through fourteen feet nine inches (14′ 9″) in width shall be accompanied by one (1) escort vehicle."',
};

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * A row from a source whose only date is a bare year, or none at all.
 * `effectiveFrom` is the retrieval date — the only day on which we can prove
 * what the document said.
 */
function fromRetrieval<T>(value: T, source: SourceDoc, note?: string): Sourced<T> {
  return {
    value,
    source,
    effectiveFrom: RETRIEVED,
    effectiveTo: null,
    ...(note === undefined ? {} : { note }),
  };
}

/** A row whose start date the source states outright. */
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

/** A statute row, effective from the date FindLaw states the text was current. */
function fromStatute<T>(value: T, source: SourceDoc, note?: string): Sourced<T> {
  return fromDated(value, source, STATUTE_CURRENT_AS_OF, note);
}

function escortRule(
  id: string,
  description: string,
  when: EscortRule['when'],
  then: EscortRule['then'],
  source: SourceDoc = ARDOT_2023_RULES,
): EscortRule {
  return {
    id,
    jurisdiction: 'AR',
    description,
    when,
    then,
    source,
    effectiveFrom: RETRIEVED,
    effectiveTo: null,
  };
}

/**
 * ARKANSAS SPLITS ON ONE DISTINCTION AND STATES IT THE SAME WAY EVERY TIME:
 * "any controlled access, divided highway with four or more lanes" against "all
 * highways that are not controlled access or divided highways with four or more
 * lanes". So the road test is written once — a positive list and its NEGATION —
 * rather than enumerated per rule.
 *
 * THE NEGATION IS THE POINT, not a shorthand for a second list. Arkansas's
 * second category is RESIDUAL: it is defined as everything the first is not, so
 * `not` reproduces it exactly and a route class nobody anticipated lands on the
 * side the state's own wording puts it. `urban` is the case that shows it — an
 * urban arterial is not a controlled-access divided four-lane highway, so it
 * correctly takes the two-escort treatment rather than being left undecided.
 * Enumerating `['two-lane', 'multilane-undivided', 'urban']` instead would have
 * quietly dropped every future member of the union out of both categories.
 *
 * What genuinely IS undecided is a quote with NO road type at all: the
 * `routeClass` condition answers `unknown`, `not` propagates it, and the rule
 * goes to `undecided` with a warning naming the missing input. That is the
 * honest answer here in a way it would not be in Texas or Louisiana, because
 * the COUNT moves with the road — one escort over 14 ft on a divided highway,
 * two on anything else.
 *
 * No `ar-` prefixed `RouteClass` member was needed. Unlike California's map
 * colours and Colorado's legend, Arkansas's classes are ordinary road taxonomy
 * that `interstate` and `divided` already name.
 */
const DIVIDED_FOUR_LANE: RouteClass[] = ['interstate', 'divided'];

/** "all highways that are not controlled access or divided highways with four or more lanes". */
const NOT_DIVIDED_FOUR_LANE: EscortRule['when'] = {
  kind: 'not',
  of: { kind: 'routeClass', anyOf: DIVIDED_FOUR_LANE },
};

// ── The inferences, named so they can be audited ──────────────────────────

/**
 * The base the per-ton excess is counted above. THE STATUTE DOES NOT STATE A
 * CONSTANT — it says "in excess of the lawful weight and load for that vehicle,
 * or combination of vehicles", which is the bridge-formula answer for that axle
 * layout. 80,000 lb is the lawful gross for the five-or-more-axle combination
 * this file prices, and the figure ARDOT's own Table of Legal Dimensions
 * prints. A shorter combination has a lower lawful weight and is UNDER-billed
 * by this base.
 */
export const ARKANSAS_EXCESS_BASE_INFERENCE_LBS = 80000;

/**
 * "For each ton or major fraction thereof." The phrase is verbatim in the
 * statute, the 2023 rules and the codified appendix. NOTHING DEFINES IT — not
 * §27-35-210, not Part 111, not the appendix. Reading "major fraction" as "more
 * than half a ton" is our construction of the ordinary meaning of "major", and
 * it is the reading the whole state dataset turns on, so it is named here
 * rather than buried in a band.
 */
export const ARKANSAS_TON_ROUNDING_INFERENCE =
  'Ark. Code §27-35-210(e)(2) charges "for each ton or major fraction thereof to be hauled in excess of the lawful weight". No Arkansas source defines "major fraction". This engine reads it as more than half a ton — a part ton over 1,000 lb is charged in full, 1,000 lb or less is dropped — which is the ordinary meaning of "major" but is OUR INFERENCE, not the state\'s words. It moves at most one ton, $8.00 to $16.00 depending on the mileage band.';

/**
 * THE HOLE AT EXACTLY 251 MILES, AND WHY IT IS NOT MODELLED AS A DISAGREEMENT.
 *
 * A conflict is two documents naming different values for one thing; the
 * resolver answers it with `null`, both candidates and a spread. This is not
 * that. Ark. Code §27-35-210(e)(2) prices "201 miles to 250 miles, inclusive"
 * at $14.00 a ton and "Over 251 miles" at $16.00 a ton, and says nothing at all
 * about a move of exactly 251 miles. ARDOT's Appendix 3 and the codified 27 CAR
 * Part 111 Appendix both print "251 miles or more" and do price it. There is no
 * second number to weigh against the first: one document prices the load and
 * the other has nothing to say about it.
 *
 * So it is represented as what it is — a hole in the rate table. Every top-band
 * row starts at 252 miles, the range all three documents name, which makes the
 * engine answer "No overweight fee band on file covers … in Arkansas" for a
 * 251-mile move and send it to review. That is structurally the same answer the
 * statute's own table gives.
 *
 * Corroborated across thirty-three years: Cornell LII's copy of the 1992
 * predecessor regulation (001.01.92 Ark. Code R. 003 §IX, effective 1992-08-25)
 * prints "OVER 251 MILES" against the same four lower bands, with a $12.00 base
 * fee. That 1992 rule is superseded and is NOT recorded as a live row here —
 * carrying its $12 would manufacture a fee conflict with a regulation that no
 * longer exists.
 */
export const ARKANSAS_251_MILE_GAP = {
  statuteTopBand: 'Over 251 miles',
  ruleTopBand: '251 miles or more',
  pricedFromMiles: 252,
  unpricedMiles: 251,
  detail:
    'Ark. Code §27-35-210(e)(2) bands the per-ton charge "201 miles to 250 miles, inclusive" and then "Over 251 miles", which prices no move of exactly 251 miles. ARDOT Permit Rules Appendix 3 and 27 CAR Part 111 Appendix both read "251 miles or more" and do price it. Only the range all three documents name — 252 miles and up — is priced here; a 251-mile move matches no band and the permit fee must be confirmed with the Permit Section.',
} as const;

/**
 * §27-35-210(e)(3), verbatim in the cite on `AC_27_35_210`. A CEILING, not an
 * amount — "a fee not to exceed five hundred dollars ($500)" — so it is not a
 * `ConditionalFee`, which carries a definite `feeUsd`. It could not be reached
 * even if it were one: its trigger is 180,000 lb or greater, which is exactly
 * the superload threshold, and the engine emits no priced lines for a superload.
 */
export const ARKANSAS_SUPERLOAD_SUPPLEMENTAL_FEE_CEILING_USD = 500;

/**
 * §27-35-210(i) and Appendix 3, transcribed cell for cell. A PROGRESSIVE tier —
 * one rate for the first five tons of excess, a second for the next five, a
 * third for everything above — stepped by the same five mileage bands as the
 * general chart, and applying only to a Vehicle of Special Design under Rule 5
 * (a non-articulated mobile construction vehicle carrying no load but its own
 * weight, reduced until further reduction is impractical).
 *
 * NOT PRICED. Nothing on an `OsowLoad` identifies a Vehicle of Special Design,
 * so the engine cannot choose between the two charts, and a progressive tier is
 * not a `WeightBand` — which applies one rate across the whole excess. The
 * general chart is applied instead, which over-quotes rather than under-quotes:
 * every rate below is under the general rate for the same mileage.
 *
 * The top row's mileage bound carries the same 251-mile hole as the general
 * chart, from the same two documents.
 */
export const ARKANSAS_MOBILE_CONSTRUCTION_FEE_SCHEDULE: Array<{
  minMiles: number;
  maxMiles: number | null;
  label: string;
  firstFiveTonsUsd: number;
  nextFiveTonsUsd: number;
  additionalTonsUsd: number;
}> = [
  { minMiles: 0, maxMiles: 100, label: '100 Miles or Less', firstFiveTonsUsd: 1.25, nextFiveTonsUsd: 2.5, additionalTonsUsd: 3.75 },
  { minMiles: 101, maxMiles: 150, label: '101 to 150, inclusive', firstFiveTonsUsd: 2.0, nextFiveTonsUsd: 3.5, additionalTonsUsd: 5.0 },
  { minMiles: 151, maxMiles: 200, label: '151 to 200, inclusive', firstFiveTonsUsd: 2.5, nextFiveTonsUsd: 4.5, additionalTonsUsd: 6.25 },
  { minMiles: 201, maxMiles: 250, label: '201 to 250, inclusive', firstFiveTonsUsd: 3.25, nextFiveTonsUsd: 5.5, additionalTonsUsd: 7.5 },
  { minMiles: 252, maxMiles: null, label: '251 miles or more (statute: "Over 251 miles")', firstFiveTonsUsd: 3.75, nextFiveTonsUsd: 6.25, additionalTonsUsd: 8.75 },
];

/**
 * THE CONFLICT THE RESEARCH SUMMARY DID NOT FIND, held open by the mechanism
 * rather than settled in a comment.
 *
 * The codified 27 CAR §111-505(c) and §111-606(b) put the manufactured-home
 * one-escort/two-escort boundary at 14 ft 6 in (174 in). Ark. Code §27-35-306 —
 * the statute those rules are issued under and cite by number — and the
 * Commission's own 2023 Permit Rules at Rule 6.E.3 and Rule 7.F.2 put it at
 * 14 ft 9 in (177 in). All three are published and current.
 *
 * `resolveSourced` returns `null`, keeps both candidates with their provenance,
 * forces manual review and publishes the spread. It is not resolved here even
 * though the statute is the higher authority and the state has proposed to
 * conform the rule to it, for the same reason Louisiana's four supersession
 * arguments are not acted on: "the statute probably wins" is a legal opinion,
 * and a permit officer applying the codified rule would not be doing anything
 * this quote can demonstrate to be wrong.
 */
export const ARKANSAS_MANUFACTURED_HOME_ESCORT_WIDTH_IN: Sourced<number>[] = [
  fromRetrieval(
    ftIn(14, 6),
    CAR_111_PROPOSED_2025,
    'The codified 27 CAR §111-505(c) and §111-606(b) read "fourteen feet six inches (14\' 6")". The 2025 redline strikes exactly that text in all six places, which is the agency quoting its own rule in force in order to change it.',
  ),
  fromRetrieval(
    ftIn(14, 9),
    ARDOT_2023_RULES,
    'Rule 6.E.3 and Rule 7.F.2: "any manufactured home in excess of fourteen feet nine inches (14\'9") in width shall be accompanied by one escort vehicle" / "which exceeds fourteen feet nine inches (14\'9") … two escort vehicles".',
  ),
  fromStatute(
    ftIn(14, 9),
    AC_27_35_306,
    'The statute the rule is issued under, and which the rule cites by number.',
  ),
];

/**
 * The second discrepancy, recorded and not modelled. The 2025 redline strikes
 * "December 2, 1992" and adds "December 2, 1982" in the twin-trailer length
 * rule, so the codified 27 CAR §111-207(e)(2)(A) carries a manufacture-date
 * cutoff a decade later than the one at Rule 3.G.5.a of the 2023 booklet — and
 * 1982 is the date the federal STAA actually uses.
 *
 * It decides 28 ft against 28 ft 6 in for a trailer built in the 1980s in a
 * truck-tractor-semitrailer-trailer combination. That configuration is not
 * priced here and Arkansas issues no over-length permit for it at all ("No over
 * length permit shall be issued for an over length truck tractor-semitrailer-
 * trailer combination"), so there is no value for the conflict mechanism to
 * hold — but the finding is on the record rather than lost.
 */
export const ARKANSAS_TWIN_TRAILER_CUTOFF_DISCREPANCY =
  'The codified 27 CAR §111-207(e)(2)(A) sets the twin-trailer manufacture-date cutoff at December 2, 1992; ARDOT\'s 2023 Permit Rules Rule 3.G.5.a sets it at December 2, 1982, which is the federal STAA date. The 2025 redline strikes 1992 and adds 1982. Not priced: Arkansas issues no over-length permit for a truck tractor-semitrailer-trailer combination.';

/** Manufactured-home permit fees, §27-35-304 via Rule 7.C.3 — a different product from the single-trip permit priced here. */
export const ARKANSAS_MANUFACTURED_HOME_PERMIT_FEES_USD = {
  upTo16ft6in: 17,
  over16ft6in: 150,
} as const;

// ── Escort rules (Rule 3.E–G, Rule 5.E, Rule 6.D–E; 27 CAR §§111-205, 111-505) ──

export const ARKANSAS_ESCORT_RULES: EscortRule[] = [
  /**
   * The count MOVES with the road type here, unlike Texas and Louisiana, so
   * these are two rules rather than one bare-count rule. Rule 3.E.4 and Rule
   * 6.E.2.a: one escort behind, at 200 ft, on a controlled-access divided
   * highway with four or more lanes. Rule 3.E.6 and Rule 6.E.2.b: two escorts,
   * front and rear, on anything else. A quote without a road type correctly
   * leaves both undecided rather than picking the cheaper.
   */
  escortRule(
    'ar-width-over-14-divided',
    'Over 14 ft wide on a controlled-access divided highway with four or more lanes — one escort 200 ft behind the load',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: DIVIDED_FOUR_LANE },
        { kind: 'gt', measure: 'widthIn', value: ftIn(14) },
      ],
    },
    { escorts: 1, rear: 1 },
  ),
  escortRule(
    'ar-width-over-12-to-14-other',
    'Over 12 ft and up to 14 ft wide on any highway that is not a controlled-access divided highway with four or more lanes — one escort in front',
    {
      kind: 'all',
      of: [
        NOT_DIVIDED_FOUR_LANE,
        {
          kind: 'between',
          measure: 'widthIn',
          min: ftIn(12),
          max: ftIn(14),
          minInclusive: false,
        },
      ],
    },
    { escorts: 1, front: 1 },
  ),
  escortRule(
    'ar-width-over-14-other',
    'Over 14 ft wide on any highway that is not a controlled-access divided highway with four or more lanes — two escorts, one preceding and one following',
    {
      kind: 'all',
      of: [NOT_DIVIDED_FOUR_LANE, { kind: 'gt', measure: 'widthIn', value: ftIn(14) }],
    },
    { escorts: 2, front: 1, rear: 1 },
  ),

  /**
   * Rule 6.E.1.a — "One escort shall FOLLOW a vehicle with a load of one hundred
   * feet (100') or more in length on Interstates, controlled access, and divided
   * highways with four or more lanes, and LEAD … on all other highways." Only
   * the position moves, so this is one rule with a bare count: the Texas
   * pattern, and it keeps a quote without a road type out of review over a
   * distinction that does not change the price.
   *
   * INCLUSIVE at exactly 100 ft — "100 feet or more" — which is also the point
   * at which the load becomes a SUPERLOAD on length alone under §111-110(a). A
   * 100 ft move therefore gets this escort AND no priced permit. Both are what
   * Arkansas publishes.
   */
  escortRule(
    'ar-length-100-or-more',
    'Load 100 ft or more in length — one escort (behind on interstates, controlled-access and divided four-lane highways; ahead on all others)',
    { kind: 'gte', measure: 'overallLengthIn', value: ftIn(100) },
    { escorts: 1 },
  ),
  /**
   * Rule 6.E.1.b — "Two escorts (one leading and one following) are required on
   * all highways with FEWER THAN FOUR LANES for a load that exceeds one hundred
   * fifteen feet (115')." `two-lane` is the only `RouteClass` member that means
   * fewer than four lanes; `multilane-undivided` is two or more lanes EACH WAY.
   * `urban` is excluded for the reason given at `DIVIDED_FOUR_LANE`.
   */
  escortRule(
    'ar-length-over-115-two-lane',
    'Over 115 ft long on a highway with fewer than four lanes — two escorts, one leading and one following',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: ['two-lane'] },
        { kind: 'gt', measure: 'overallLengthIn', value: ftIn(115) },
      ],
    },
    { escorts: 2, front: 1, rear: 1 },
  ),

  /**
   * Rule 3.F.2, Rule 6.D.11.a and Rule 6.E.4.a, all identically: over 15 ft
   * high, one escort ahead "equipped with a clearance bar that extends six
   * inches (6") above the permitted height". Arkansas REQUIRES the bar, so
   * `heightPole` is set — unlike Louisiana, which only recommends one.
   */
  escortRule(
    'ar-height-over-15',
    'Over 15 ft high — one escort preceding the load with a clearance bar 6 in above the permitted height',
    { kind: 'gt', measure: 'heightIn', value: ftIn(15) },
    { escorts: 1, front: 1, heightPole: true },
  ),
  /**
   * Rule 3.F.3 and Rule 6.E.4.b. Over 17 ft the mover must obtain written
   * agreements signed by the owners of every overhead facility on the route,
   * and the move is accompanied by their representatives unless each owner
   * writes to decline. That is not a pilot car and cannot be counted as one:
   * the parties, the lead time and the cost all depend on a route Arkansas has
   * not yet approved. It is a real requirement that cannot be turned into a
   * number, which is what `manualReview` is for.
   */
  escortRule(
    'ar-height-over-17-utility-agreements',
    'Over 17 ft high — written agreements from every overhead-facility owner on the route, and their representatives accompany the move unless each declines in writing',
    { kind: 'gt', measure: 'heightIn', value: ftIn(17) },
    {
      manualReview:
        'Over 17 ft high, ARDOT Rule 3.F.3 requires written agreements signed by the owners of overhead facilities (utilities, traffic signals) along the route, and the move must be accompanied by their representatives unless each owner writes to say it does not wish to attend. The owners are not known until the route is approved and Arkansas publishes no charge for their attendance, so no cost for it is included in this quote.',
    },
  ),

  /**
   * Rule 3.G.3.f and Rule 5.E.2, both flat: "No permit will be issued for any
   * vehicle with a front overhang in excess of twenty feet (20')." A door, not
   * a ladder — the same shape as Colorado's red-segment rule.
   */
  escortRule(
    'ar-front-overhang-over-20',
    'Front overhang over 20 ft — Arkansas will not issue a permit',
    { kind: 'gt', measure: 'frontOverhangIn', value: ftIn(20) },
    {
      manualReview:
        'ARDOT Rule 3.G.3.f: "No permit will be issued for any vehicle with a front overhang in excess of twenty feet (20\')." This move cannot be permitted as configured and must be reduced or re-engineered before it can be priced.',
    },
  ),
  /**
   * Rule 3.E.3 — the Interstate width ceiling, 18 ft "inclusive of overhangs,
   * clearance lights, or any other appurtenances", manufactured homes excepted.
   */
  escortRule(
    'ar-width-over-18-interstate',
    'Over 18 ft wide on an Interstate highway — over the maximum width Arkansas permits there',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: ['interstate'] },
        { kind: 'gt', measure: 'widthIn', value: ftIn(18) },
      ],
    },
    {
      manualReview:
        'ARDOT Rule 3.E.3: except for manufactured homes, the maximum overall width authorised by permit on Interstate highways is 18 ft, inclusive of overhangs, clearance lights and any other appurtenances. A wider load must be routed off the Interstate system, which changes the escort requirement and the mileage the fee is banded on.',
    },
  ),
  /**
   * Rule 3.E.1 and 3.E.2 — 20 ft is the ordinary ceiling on non-Interstate
   * highways, and 24 ft is available only "under emergency conditions and at the
   * discretion of the Permit Section … for short moves". A discretionary
   * emergency allowance is not a threshold this engine can apply.
   */
  escortRule(
    'ar-width-over-20',
    'Over 20 ft wide — over the maximum width Arkansas permits outside an emergency',
    { kind: 'gt', measure: 'widthIn', value: ftIn(20) },
    {
      manualReview:
        'ARDOT Rule 3.E.1 caps a permitted vehicle at 20 ft wide on non-Interstate highways, "based on public safety, the condition of the highway, distance traveled, and the volume or type of traffic". Rule 3.E.2 allows up to 24 ft only under emergency conditions, for short moves, at the sole discretion of the Permit Section. Neither is a figure this quote can apply on its own.',
    },
  ),

  /**
   * THE DISCRETIONARY ESCORT, WHICH HAS NO THRESHOLD AND IS NOT PRICED.
   * Rule 3.E.7 and Rule 6.E.6: an officer of command rank "may require
   * additional escorts as deemed necessary", and the Permit Section "may require
   * one or more vehicles from an appropriate law enforcement agency". Rule 4.H.2
   * says the same in the other direction — a legal-size overweight move needs no
   * escort "unless deemed necessary by the Permit Section". No width, height,
   * length or weight triggers any of it, so modelling it as a threshold would
   * invent a rule Arkansas did not write, and sending every permitted move to
   * review over the possibility would make the engine useless. Texas's
   * treatment, for Texas's reason: an ADVISORY, and the price stands.
   */
  escortRule(
    'ar-additional-escorts-discretionary',
    'Additional or law-enforcement escorts — discretionary, no published threshold',
    {
      kind: 'any',
      of: [
        { kind: 'gt', measure: 'widthIn', value: 102 },
        { kind: 'gt', measure: 'heightIn', value: ftIn(14) },
        { kind: 'gt', measure: 'grossWeightLbs', value: 80000 },
      ],
    },
    {
      advisory:
        'An officer of command rank of the Arkansas Highway Police may require additional escorts, and the Permit Section may require one or more law-enforcement vehicles, wherever either judges it necessary for the safety of the travelling public (ARDOT Rules 3.E.7, 4.H.2 and 6.E.6). No width, height, length or weight threshold triggers this automatically and Arkansas publishes no officer rate, so no additional escort cost is included in this quote.',
    },
  ),
];

// ── The overweight fee chart ──────────────────────────────────────────────

/**
 * The five mileage bands of Appendix 3, as whole miles.
 *
 * THE TOP BAND STARTS AT 252, NOT 251, AND THAT IS DELIBERATE. See
 * `ARKANSAS_251_MILE_GAP`: the statute prices "Over 251 miles" and the two rule
 * documents price "251 miles or more", so 252 is the range all three name. A
 * 251-mile move matches no band and the engine says the schedule does not price
 * it, rather than quietly adopting the one document that does.
 *
 * The gaps BETWEEN the bands are the source's too — "100 Miles or Less" then
 * "101 to 150" assigns 100.4 miles to nothing. Louisiana's five distance
 * columns have the same shape and are left the same way.
 */
const MILEAGE_BANDS: Array<{
  minMiles: number;
  maxMiles: number | null;
  perTonUsd: number;
  label: string;
}> = [
  { minMiles: 0, maxMiles: 100, perTonUsd: 8, label: '100 Miles or Less' },
  { minMiles: 101, maxMiles: 150, perTonUsd: 10, label: '101 to 150, inclusive' },
  { minMiles: 151, maxMiles: 200, perTonUsd: 12, label: '151 to 200, inclusive' },
  { minMiles: 201, maxMiles: 250, perTonUsd: 14, label: '201 to 250, inclusive' },
  { minMiles: 252, maxMiles: null, perTonUsd: 16, label: '251 miles or more' },
];

/**
 * `feeUsd: 0` is not a fee — the $17 lives in `permitBaseFeeUsd`, exactly as the
 * chart describes it ("a charge of seventeen dollars ($17) shall be made for
 * each permit. IN ADDITION, for each ton or major fraction thereof…"). The band
 * carries only the per-ton component, so a load that is oversize but not
 * overweight never reaches one and never pays it.
 */
function perTonBand(band: (typeof MILEAGE_BANDS)[number]): WeightBand {
  return {
    minLbs: ARKANSAS_EXCESS_BASE_INFERENCE_LBS + 1,
    maxLbs: null,
    feeUsd: 0,
    perIncrementUsd: band.perTonUsd,
    incrementLbs: 2000,
    incrementBaseLbs: ARKANSAS_EXCESS_BASE_INFERENCE_LBS,
    incrementRounding: 'majorFraction',
    minMiles: band.minMiles,
    maxMiles: band.maxMiles,
  };
}

const TOP_BAND_NARROWED =
  ' Recorded from 252 miles rather than the 251 this document prints: Ark. Code §27-35-210(e)(2) reads "Over 251 miles" and prices no move of exactly 251 miles, so only the range all three documents name is priced. See ARKANSAS_251_MILE_GAP.';

/**
 * Three documents, identical figures — the statute, ARDOT's Appendix 3 and the
 * codified Part 111 Appendix — so every band resolves as corroboration rather
 * than conflict, and the citation shown is the newest revision on file.
 */
const overweightBands: Sourced<WeightBand>[] = MILEAGE_BANDS.flatMap((band) => {
  const isTop = band.maxMiles === null;
  const rate = `$${band.perTonUsd.toFixed(2)}`;
  return [
    fromStatute<WeightBand>(
      perTonBand(band),
      AC_27_35_210,
      `Ark. Code §27-35-210(e)(2), the "${band.label}" band at ${rate} on each ton or major fraction thereof over the lawful weight.${isTop ? ' The statute prints this band as "Over 251 miles"; see ARKANSAS_251_MILE_GAP.' : ''}`,
    ),
    fromRetrieval<WeightBand>(
      perTonBand(band),
      ARDOT_2023_RULES,
      `ARDOT Permit Rules Appendix 3, OVERWEIGHT FEE CHART: "${band.label}" at ${rate}.${isTop ? TOP_BAND_NARROWED : ''}`,
    ),
    fromRetrieval<WeightBand>(
      perTonBand(band),
      CAR_111_APPENDIX,
      `27 CAR Part 111 Appendix, OVERWEIGHT FEE CHART: "${band.label}" at ${rate}.${isTop ? TOP_BAND_NARROWED : ''}`,
    ),
  ];
});

// ── The jurisdiction ──────────────────────────────────────────────────────

export const ARKANSAS_OSOW_RULES: JurisdictionOsowRules = {
  code: 'AR',
  name: 'Arkansas',
  country: 'US',

  legalLimits: {
    widthIn: [
      fromStatute(
        102,
        AC_27_35_206,
        '§27-35-206 states 102 inches; the exception for compacted seed cotton (108 in on non-Interstate highways) is a commodity carve-out this engine does not model, and a cotton move quoted at the 102 in limit is over-permitted rather than under.',
      ),
      fromRetrieval(102, ARDOT_2023_RULES, 'Table of Legal Dimensions: "WIDTH: 8 feet, 6 inches (8 feet for manufactured homes)".'),
    ],
    heightIn: [
      fromStatute(ftIn(14), AC_27_35_207),
      fromRetrieval(
        ftIn(14),
        ARDOT_2023_RULES,
        'Rule 3.F.1 and the Table of Legal Dimensions both state 14 ft. No 13\'6" row is recorded: no source on file states that limit, and the research summary\'s attribution of the change to Act 871 of 2021 could not be verified in primary text.',
      ),
    ],
    trailerLengthIn: [
      fromStatute(
        ftIn(53, 6),
        AC_27_35_208,
        '"The state shall not establish or enforce any rule which imposes a semitrailer or trailer length limitation of less than fifty-three feet six inches (53′ 6″)."',
      ),
      fromRetrieval(
        ftIn(53, 6),
        ARDOT_2023_RULES,
        'Rule 3.G.1: "If a semitrailer or trailer, laden or unladen, does not exceed 53 feet and six inches (53\'6"), there is no overall length restriction, and the vehicle is considered to be in compliance with the length law."',
      ),
    ],
    /**
     * `overallLengthIn` IS DELIBERATELY ABSENT, not empty. Arkansas's 60 ft
     * figure is CONDITIONAL and only bites the other side of the trailer limit:
     * Rule 3.G.1 says a combination whose trailer is within 53'6" has "no
     * overall length restriction", and Rule 3.G.2 introduces the 60 ft cap only
     * for a trailer that EXCEEDS 53'6". Recording a flat 60 ft here would flag
     * every ordinary 70 ft tractor-semitrailer in the state as over-length. The
     * other overall figures Arkansas publishes are vehicle-class specific —
     * 80 ft for an auto transporter, 82 ft for a towaway transporter combination
     * (§27-35-208), 90 ft as the point past which a permitted move is daylight-
     * only (Rule 3.G.3.c) — and none of them is a general cap either.
     */
    /**
     * Rule 3.G.3.e: a permit is required once the load "extends more than three
     * feet (3') beyond the front wheels of the vehicle or beyond the front
     * bumper". `rearOverhangIn` is ABSENT because Arkansas publishes no general
     * rear-overhang limit at all — Rule 3.G.3.d folds a rear projection into the
     * TRAILER's measured length instead, and the only rear figure in the rules
     * is the 25 ft log-truck exemption in Rule 3.H.1.a. An empty list would
     * report a gap where the state has simply chosen a different measurement.
     */
    frontOverhangIn: [
      fromRetrieval(
        ftIn(3),
        ARDOT_2023_RULES,
        'Rule 3.G.3.e. Rule 3.G.3.f caps the permitted front overhang at 20 ft; that ceiling is carried by `ar-front-overhang-over-20`.',
      ),
    ],
    grossWeightLbs: [
      fromStatute(
        80000,
        AC_27_35_203,
        '§27-35-203(d). The 85,000 lb five-axle farm and forest allowance and the 70,000 lb three-axle non-Interstate figure are commodity and configuration carve-outs this engine does not model.',
      ),
      fromRetrieval(
        80000,
        ARDOT_2023_RULES,
        'Table of Legal Dimensions: "80,000 pounds gross weight of vehicle(s) and cargo on 5 or more axles. Must meet the Federal bridge formula for 80,000 pounds."',
      ),
    ],
    singleAxleLbs: [
      fromStatute(20000, AC_27_35_203, '§27-35-203(a).'),
      fromRetrieval(
        20000,
        ARDOT_2023_RULES,
        'Table of Legal Dimensions: "Single Load-Carrying Axle: 20,000 pounds". Rule 4.F.1 sets the same figure as the PERMITTED maximum, so Arkansas will not issue a permit for a heavier single axle at any fee.',
      ),
    ],
    tandemAxleLbs: [
      fromStatute(34000, AC_27_35_203, '§27-35-203(b).'),
      fromRetrieval(
        34000,
        ARDOT_2023_RULES,
        'Table of Legal Dimensions: "Tandem Axle Group: 34,000 pounds". Rule 4.F.2 permits up to 46,000 lb on a tandem under an overweight permit, with no single axle of the group over 23,000 lb — a permit ceiling, not a legal limit.',
      ),
    ],
  },

  /** $17, corroborated by three independent documents. */
  permitBaseFeeUsd: [
    fromStatute(
      17,
      AC_27_35_210,
      '§27-35-210(e)(1): "A charge of seventeen dollars ($17.00) shall be made for each special permit."',
    ),
    fromRetrieval(
      17,
      ARDOT_2023_RULES,
      'Rule 3.C.2: "Unless otherwise specified in these Rules, the fee for a permit to move an over dimensional vehicle or load is seventeen dollars ($17)." The same $17 base recurs at Rules 8, 9, 10, 15, 17 and 18, which is why it is recorded as the state\'s single-trip base rather than a per-product figure.',
    ),
    fromRetrieval(
      17,
      CAR_111_APPENDIX,
      'Appendix 3: "a charge of seventeen dollars ($17) shall be made for each permit".',
    ),
  ],

  /**
   * NO DIMENSIONAL BANDS. Arkansas charges one flat $17 whatever the load
   * measures — there is no $46/$97 width step and no $20/$30/$40 ladder. Texas's
   * shape, and `oversizeFeeBands` is therefore absent rather than a single
   * all-covering band, so an oversize-only move prices from the base fee alone.
   */

  overweightPricing: [
    fromStatute<OverweightPricing>(
      {
        kind: 'bands',
        explanation:
          'Ark. Code §27-35-210(e)(2) charges "for each ton or major fraction thereof to be hauled in excess of the lawful weight and load for that vehicle, or combination of vehicles" at a rate stepped by the mileage to be travelled — $8.00 a ton up to 100 miles, rising to $16.00 a ton past 251. The mileage selects the rate; it is not multiplied through.',
      },
      AC_27_35_210,
    ),
    fromRetrieval<OverweightPricing>(
      {
        kind: 'bands',
        explanation:
          'ARDOT Permit Rules Appendix 3 prints the same per-ton chart against the same five mileage bands, with no per-mile column.',
      },
      ARDOT_2023_RULES,
    ),
  ],

  overweightBands,

  /** Arkansas's overweight charge is per ton, never per mile. */
  overweightPerMile: [],

  /**
   * EMPTY, AND NOT FOR WANT OF LOOKING. The only conditional charge Arkansas
   * publishes is §27-35-210(e)(3)'s supplement for a load of 180,000 lb or
   * greater, and it is a CEILING — "a fee not to exceed five hundred dollars
   * ($500)" — which `ConditionalFee.feeUsd` cannot express without asserting a
   * number the statute declines to fix. It would also be unreachable: 180,000 lb
   * is the superload threshold itself, and no priced line is emitted for a
   * superload. See `ARKANSAS_SUPERLOAD_SUPPLEMENTAL_FEE_CEILING_USD`.
   */
  conditionalFees: [],

  /**
   * EMPTY, NOT ZERO. Rule 2.C mentions "the use of approved credit cards" and
   * names no surcharge; neither the statute nor Part 111 states a percentage or
   * a processing fee. A sourced zero would assert something no document
   * supports, so the engine says on every Arkansas quote that no transaction
   * cost is on file.
   */
  transactionFee: [],

  /**
   * EMPTY. 27 CAR §111-110(b) and Rule 2.I.2 give the Department "the discretion
   * to require engineering examinations" for a super load and attach no charge
   * to them, and Arkansas publishes no bridge-analysis review fee of any kind.
   */
  routeAnalysisFeeUsd: [],
  noBridgeRouteFeeUsd: [],

  superload: {
    /**
     * 180,000 LB, INCLUSIVE, AND IT IS A REAL SUPERLOAD CLASS RATHER THAN A FEE
     * TRIGGER — which is the distinction Florida's 300,000 lb failed. 27 CAR
     * §111-110(a) is a classification: the Department "SHALL HAVE THE DISCRETION
     * to issue a permit for the movement of super loads of extraordinary weight
     * (gross weight of 180,000 lbs. or more)", which are issued only when
     * "essential to public health, welfare, safety, or defense" and may be made
     * to carry engineering examinations. That is not an over-the-counter permit.
     *
     * It safely enters the widget's weight-ceiling mirror at 179,999 lb, and
     * Florida's failure mode cannot occur here: Arkansas's per-ton chart has no
     * upper weight bound at all, so the server can price every pound below the
     * threshold the client publishes.
     *
     * The statute corroborates both the number and the inclusivity from the
     * other side — §27-35-210(e)(3) attaches its supplemental fee at "one
     * hundred eighty thousand pounds (180,000 lbs.) or greater".
     */
    grossWeight: [
      fromRetrieval<Threshold>(
        { value: 180000, inclusive: true },
        ARDOT_2023_RULES,
        'Rule 2.I.1: "super loads of extraordinary weight (gross weight of 180,000 or more pounds) … that are essential to public health, welfare, safety or defense". Rule 2.I.2 adds the discretionary engineering examination.',
      ),
      fromRetrieval<Threshold>(
        { value: 180000, inclusive: true },
        CAR_111_PROPOSED_2025,
        '27 CAR §111-110(a), quoted unchanged in the 2025 redline: "gross weight of one hundred eighty thousand pounds (180,000 lbs.) or more". No part of this provision is struck or added, so the draft is evidence of the codified text rather than a proposed change to it.',
      ),
    ],
    /** Arkansas states no axle-spacing superload trigger. */
    shortSpacing: [],
    /**
     * SIZE ALONE ESCALATES HERE, AND THE LENGTH TRIGGER IS THE ONE THAT BITES
     * ORDINARY HEAVY HAUL: 100 ft or more overall is a super load in Arkansas
     * whatever it weighs. Both documents state it identically, so it is recorded
     * as published — a 100 ft move gets no priced permit and goes to the agency.
     * The inclusivity is not uniform and is not smoothed: width is "MORE THAN
     * 16 feet 6 inches" while length and height are "or more".
     */
    widthIn: [
      fromRetrieval<Threshold>({ value: ftIn(16, 6), inclusive: false }, ARDOT_2023_RULES, 'Rule 2.I.1: "width of more than 16 feet 6 inches (16\'6")".'),
      fromRetrieval<Threshold>({ value: ftIn(16, 6), inclusive: false }, CAR_111_PROPOSED_2025, '27 CAR §111-110(a), unchanged in the 2025 redline.'),
    ],
    heightIn: [
      fromRetrieval<Threshold>({ value: ftIn(15, 6), inclusive: true }, ARDOT_2023_RULES, 'Rule 2.I.1: "height of 15 feet 6 inches (15\'6") or more".'),
      fromRetrieval<Threshold>({ value: ftIn(15, 6), inclusive: true }, CAR_111_PROPOSED_2025, '27 CAR §111-110(a), unchanged in the 2025 redline.'),
    ],
    overallLengthIn: [
      fromRetrieval<Threshold>({ value: ftIn(100), inclusive: true }, ARDOT_2023_RULES, 'Rule 2.I.1: "overall length of 100 feet (100\') or more".'),
      fromRetrieval<Threshold>({ value: ftIn(100), inclusive: true }, CAR_111_PROPOSED_2025, '27 CAR §111-110(a), unchanged in the 2025 redline.'),
    ],
  },

  /**
   * ALL THREE EMPTY, AS A FINDING. Arkansas publishes no dimensional trigger for
   * a physical route inspection or an engineering review. What it publishes
   * instead is discretion — 27 CAR §111-110(b): "The department shall have the
   * discretion to require engineering examinations and an application shall be
   * submitted far enough in advance to allow for such examinations" — attached
   * to the super-load class rather than to a measurement. Inventing a width or a
   * height here would put a step on the quote that Arkansas has not defined; an
   * empty list is silent, which is the same treatment Louisiana's `lengthIn`
   * gets.
   */
  routeInspection: {
    widthIn: [],
    heightIn: [],
    lengthIn: [],
  },

  escortRules: ARKANSAS_ESCORT_RULES,

  /**
   * TRUE, AND IN THE LOUISIANA SENSE RATHER THAN THE VIRGINIA ONE: the fee does
   * not scale with mileage, it STEPS with it. Twenty tons of overload is $160 up
   * to 100 miles and $320 past 251, so a quote without Arkansas miles cannot
   * pick a rate at all — `weightBandApplies` leaves every band undecided rather
   * than quietly billing the cheapest.
   */
  feesDependOnDistance: true,
};
