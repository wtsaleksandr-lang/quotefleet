/**
 * TENNESSEE — oversize/overweight single-trip permit rules.
 *
 * THE FIRST GENUINELY TWO-DIMENSIONAL FEE IN THE DATASET — AND IT NEEDED NO NEW
 * RATE TYPE.
 * ---------------------------------------------------------------------------
 * Tenn. Code Ann. § 55-7-205(h)(3) is one line: "Excessive weight: Twenty
 * dollars ($20.00) plus six cents (6¢) per ton-mile;". TDOT's own fee table
 * prints the same thing as "Excess Weight .06/ton mile" over "20.00+". A
 * TON-MILE is weight MULTIPLIED BY DISTANCE — fifty tons over five hundred miles
 * is twenty-five thousand ton-miles, and the money moves with the product of the
 * two, not with either one banded.
 *
 * Every earlier state banded on one axis or the other. Louisiana's table is ten
 * weight rows against five distance COLUMNS, so distance selects a cell.
 * Arkansas charges per ton at a rate that STEPS by mileage — the mileage picks
 * the rate and then leaves the arithmetic entirely. Colorado multiplies by axles
 * and ignores distance. None of those is a product.
 *
 * `WeightBand` CANNOT HOLD THIS, and forcing it would misprice by the length of
 * the lane. `perIncrementUsd` is flat in miles: Arkansas's $8.00 a ton is $8.00 a
 * ton whether the move is 40 miles or 240. Encoding Tennessee there would drop
 * the distance multiplication and quote a 500-mile move at the price of a
 * 1-mile one.
 *
 * `PerMileRate` ALREADY HOLDS IT, and it always did. Its own documentation names
 * the shape: "a rate per mile per increment of weight OVER the legal limit
 * ('$0.03 per mile for each 1,000 lb in excess of 80,000 lb')". That is rate ×
 * miles × increments — a product of distance and weight, which is exactly what a
 * ton-mile is, with the increment set to 2,000 lb. Pennsylvania's "4¢ per mile
 * per ton" is the same fee written in different words and has been encoded this
 * way since Phase 2. So Tennessee adds NO field, NO condition kind, NO new type
 * and no `if (state === 'TN')` — the honest finding is that the first
 * two-dimensional fee was already expressible, and inventing a `TonMileRate`
 * beside a type that computes the identical product would have been duplication
 * dressed as rigour. See `TENNESSEE_TON_MILE_MODEL_NOTE`.
 *
 * ── THE $20 IS A BASE FEE, NOT PART OF THE TON-MILE RATE ──────────────────
 * § 55-7-205(h) prints THE SAME TWENTY DOLLARS three times: (h)(1)(A) "Not more
 * than fourteen feet (14′), twenty dollars ($20.00)", (h)(2) "Excessive height or
 * length: Twenty dollars ($20.00)", and (h)(3) "Twenty dollars ($20.00) plus six
 * cents (6¢) per ton-mile". It is reached from every side of the schedule, which
 * is Indiana's case exactly — so it is held in `permitBaseFeeUsd` and the width
 * ladder is held as an INCREMENT above it ($0 up to 14 ft, $10 from 14 ft 1 in to
 * 16 ft, which sum to the published $20 and $30). A legal-size overweight-only
 * permit matches no dimensional band by construction, and folding the $20 into
 * the bands would have dropped it from exactly the permit § 55-7-205(h)(3)
 * charges it for.
 *
 * WHETHER A MOVEMENT OVER IN TWO DIMENSIONS PAYS TWO BASE FEES IS NOT PUBLISHED,
 * AND THE SINGLE-BASE READING IS ENCODED. TDOT's own order-of-operations summary
 * describes a movement's cost as "Base dimension/weight fee + per-ton-mile charge
 * + bridge evaluation fee (if applicable) + credit card surcharge" and adds "Base
 * permit fee applies per movement" — singular, per movement. The alternative
 * reading, that (h)(1) and (h)(2) and (h)(3) each charge their own $20, would add
 * $20 to a load that is over on both width and height. THIS IS OUR READING, it is
 * the cheaper of the two, and it is stated on the quote by
 * `tn-single-base-fee-reading`. See `TENNESSEE_SINGLE_BASE_FEE_READING`.
 *
 * ── THE PARTIAL INCREMENT IS UNKNOWN AND IT MATTERS MORE HERE THAN ANYWHERE ─
 * Neither § 55-7-205(h)(3) nor Tenn. Comp. R. & Regs. 1680-07-01-.24 says whether
 * a PART TON or a PART MILE is rounded up, rounded down, or billed pro rata. On a
 * flat per-mile fee that ambiguity is bounded — Virginia's is thirty cents, which
 * is why `va-mileage-fee-rounding-unpublished` states it and lets the price
 * stand. On a ton-mile it is not bounded by anything: one cent of ambiguity
 * across fifty tons and five hundred miles is $250, and half a ton left
 * unrounded on a 500-mile move is $15 by itself.
 *
 * So this one goes to REVIEW, not to an advisory. The engine still prices the
 * move — a refusal that produced no number would be less useful than a number
 * with its assumption written next to it — and `tn-ton-mile-partial-increment-unknown`
 * says exactly what was assumed and what the other readings would cost. The
 * assumption is `roundIncrementUp: true` (a part ton charged in full) and true
 * pro-rata mileage (`roundMilesUpTo` deliberately absent, the Virginia
 * treatment), because that pair never UNDER-quotes the carrier at the counter.
 * The argument against it is on the record too: Tennessee says "or fraction
 * thereof" twice in this very fee section — § 55-7-205(h)(1)(C)'s "$5.00 for each
 * additional foot or fraction thereof" and 1680-07-01-.24(1)(d)'s "$100 for each
 * additional inch or fraction thereof" — and did NOT say it in (h)(3), which is
 * the Arkansas "major fraction" argument pointing the other way. Neither reading
 * has been adopted. See `TENNESSEE_PARTIAL_INCREMENT_UNKNOWN`.
 *
 * ── THE EXCESS IS COUNTED OVER 80,000 LB, AND THAT IS AN INFERENCE ────────
 * "Six cents per ton-mile" does not say WHICH tons. The research answers it
 * directly — TDOT's FAQ prints "Gross Weight 80,000 pounds Single Axle 20,000
 * pounds Tandem Axle 34,000 pounds" as the permitting baseline — and Tennessee's
 * own drafting elsewhere counts ton-miles on the EXCESS rather than the gross:
 * § 55-7-205(n)(5)(E)(i) charges "twelve cents (12¢) per ton-mile for all weight
 * in excess of one hundred sixty-five thousand pounds (165,000 lbs.)". Reading
 * (h)(3) on the gross instead would multiply a 100,000 lb permit by five. The
 * 80,000 lb base is still OUR CONSTRUCTION and is flagged as one; on an
 * interstate lane the true baseline is the lesser of 80,000 lb and the federal
 * bridge formula, which is lower for a short wheelbase and would leave that move
 * UNDER-billed here. See `TENNESSEE_EXCESS_BASE_INFERENCE_LBS`.
 *
 * ── THE 165,000 LB LINE IS A SUPERLOAD CLASS, AND THE RATE CHANGE ABOVE IT
 *    BELONGS TO A DIFFERENT PRODUCT ────────────────────────────────────────
 * Tennessee publishes 165,000 lb three ways and they are not the same claim.
 *
 *   1. IT IS THE SUPERLOAD THRESHOLD. TDOT's FAQ answers "What is considered a
 *      Superload? Gross Vehicle Weight in excess of 165,000 pounds", and Rule
 *      1680-07-01-.12(1) defines "super heavy" the same way. Above it a move
 *      needs an engineering analysis by the Structures Division, a route survey,
 *      a traffic control plan, a 5-to-30-day processing window and daylight-only
 *      travel. That is a real class, not a fee step, so it is the state's
 *      quotable ceiling and it is mirrored in the widget.
 *   2. IT IS A BRIDGE-EVALUATION FEE TRIGGER — $100 to 250,000 lb, $300 to
 *      500,000 lb, actual cost above. Every one of those bands sits ABOVE the
 *      superload threshold, so the engine emits no priced line that could carry
 *      them. They are transcribed in `TENNESSEE_BRIDGE_EVALUATION_FEES` rather
 *      than encoded as `ConditionalFee` rows, which is Arkansas's treatment of
 *      its own $500 supplement and for the same reason.
 *   3. THE $0.12 PER TON-MILE IS NOT THE GENERAL RATE ABOVE 165,000 LB. Its own
 *      text is about a tow: "if the combined weight of the TOWING VEHICLE AND
 *      TOWED VEHICLE exceeds one hundred sixty-five thousand pounds", codified at
 *      § 55-7-205(n)(5)(E)(i) — heavy-duty towing secondary movements, a separate
 *      product. Nothing on an `OsowLoad` says a move is a wrecker recovery, so
 *      applying it to general heavy haul would invent a rate Tennessee charges
 *      somebody else. § 55-7-205(h)(3) states no upper weight bound at all, which
 *      is why the general rate here runs to the superload line and stops.
 *      Transcribed in `TENNESSEE_HEAVY_DUTY_TOWING_TON_MILE`.
 *
 * ── THE CONFLICTS ────────────────────────────────────────────────────────
 *
 *   1. THE HOUSEBOAT, BY A FACTOR OF EIGHT. § 55-7-205(h)(1)(D) and TDOT's
 *      Permit Prices page band a houseboat at $500 / $750 / $1,000 by width;
 *      Tenn. Comp. R. & Regs. 1680-07-01-.24(1)(d) reads "For houseboats over
 *      seventeen feet (17'): $2,500 plus $100 for each additional inch or
 *      fraction thereof greater than seventeen feet (17')". At 20 ft that is $750
 *      against $6,100. Both are on file in
 *      `TENNESSEE_HOUSEBOAT_SINGLE_TRIP_FEE_USD` and `resolveSourced` refuses to
 *      pick — the Arkansas manufactured-home treatment, because nothing on a load
 *      says it is a houseboat and a width rule that could not tell a houseboat
 *      from a press frame would misprice every wide load in the state. The
 *      research's own conflict analysis was SPLIT ACROSS THE PDF'S TWO-COLUMN
 *      EXTRACTION, its second half landing eleven lines later; it is reassembled
 *      verbatim and nothing was written to bridge it.
 *   2. THE SEED COTTON MODULE, BY FIVE TIMES. TDOT's website fee table lists
 *      "Seed Cotton Module $500.00"; § 55-7-205(b)(3) and 1680-07-01-.24(5)(b)(11)
 *      both codify $100. It is an ANNUAL permit and a commodity this engine
 *      cannot identify, so it is recorded in
 *      `TENNESSEE_SEED_COTTON_ANNUAL_FEE_USD` and never priced. The $400 spread
 *      is eight times the materiality threshold, so it could never have been
 *      absorbed either.
 *   3. THE ROUTE-SURVEY HEIGHT TRIGGER. § 55-7-205(p) and the TDOT FAQ put it at
 *      "exceeds fifteen feet six inches (15′6″)"; Rule 1680-07-01-.10(1)(c) puts
 *      it at "fifteen feet (15') or more". The research states that the statute
 *      "explicitly overrules the agency rule" — and BOTH ARE STILL RECORDED.
 *      `resolveSourced` returns null for the pair and the engine surfaces it only
 *      for a load whose height lands between 15 ft and 15 ft 6 in, which is the
 *      Texas 18'11"-versus-19'0" pattern. Adopting the statute here and deleting
 *      the rule's side would have been us adjudicating; the mechanism exists so
 *      that we do not.
 *   4. THE DIMENSION BOUNDARIES, WHICH LEAVE HOLES. The rules write continuous
 *      ranges — "over ten feet (10') wide but not exceeding twelve feet six
 *      inches (12'6")" — while TDOT's FAQ and fee table step in whole inches —
 *      "10'1” – 12'6”", "14'1" up to 16'". A fractional dimension between two
 *      steps is named by no band. That is Arkansas's 251-mile hole and
 *      Washington's 999-pound band in a third dimension, and it is left as a hole
 *      on BOTH sides of the schedule:
 *        - THE FEE SIDE. The $10 width increment starts at 14 ft 1 in, the range
 *          both documents name, so a load between 14 ft 0 in and 14 ft 1 in
 *          matches no band, the oversize line comes back null and the quote says
 *          the published schedule does not price it. See
 *          `TENNESSEE_WIDTH_BAND_GAP`.
 *        - THE ESCORT SIDE. `tn-escort-boundary-step-gap` fires in exactly the
 *          fractional inches where the regulation requires an escort and the FAQ
 *          does not, quotes both texts and forces review. An escort count is a
 *          REQUIREMENT, so materiality may never absorb it at any dollar value.
 *   5. THE $1,000 HOUSEBOAT ROW CARRIES THE SAME CONFLICT INLINE. The research's
 *      "over twenty feet (20′), one thousand dollars ($1,000)" data point ends
 *      "CONFLICTS with administrative rule Tenn. Comp. R. & Regs.
 *      1680-07-01-.24(1)(d)" — the per-band instance of conflict 1, recorded on
 *      the top band of `TENNESSEE_HOUSEBOAT_SINGLE_TRIP_FEE_USD` rather than
 *      treated as a sixth finding.
 *
 * ── THE FIVE UNKNOWNS, SPLIT BY WHAT THEY COST ───────────────────────────
 *   - PARTIAL TON / PARTIAL MILE — `manualReview`. Unbounded on a ton-mile. See
 *     above.
 *   - THE CREDIT-CARD SURCHARGE RATE — advisory. 1680-07-01-.24(7)(b) says a card
 *     payment is "subject to a transaction surcharge" and publishes no
 *     percentage, so `transactionFee` is an EMPTY LIST and not a sourced zero:
 *     "nobody publishes the rate" is not "the rate is nought". The engine says on
 *     every Tennessee quote that no transaction cost is on file.
 *   - POLICE-ESCORT ANCILLARY FEES — advisory. The hourly rate, the four-hour
 *     minimum, the two-officer minimum and the mileage ARE published; an
 *     application admin fee, an officer per diem and a cancellation charge are
 *     not codified in Title 1340 or in TDOT's rules.
 *   - THE BUCKET TRUCK AND UTILITY NOTIFICATION — advisory. No general numerical
 *     height threshold exists for standard freight; utility coordination is
 *     required for a SITE-BUILT HOUSE move under 1680-07-01-.14(8), a different
 *     product.
 *   - THE ROUTE-SURVEY COST — advisory, and `routeAnalysisFeeUsd` /
 *     `noBridgeRouteFeeUsd` are EMPTY. Tennessee requires the survey and does not
 *     perform it; private surveyors charge market rates. Kentucky's and
 *     Colorado's treatment.
 *
 * ── DATE WARNINGS CARRIED FROM THE SOURCE ────────────────────────────────
 * Tenn. Comp. R. & Regs. Chapter 1680-07-01 — the escort table, the height pole,
 * the route survey, the fee and payment rules — has been effective since May 15,
 * 2018 and is over three years old. The TDOT Permit Prices page and the TDOT
 * OS/OW FAQ are both undated dynamic renders, so every row sourced from them is
 * effective from the retrieval date and nothing earlier — the Texas rule, for the
 * Texas reason. The Tenn. Code Ann. sections are current through the 2025
 * legislative session and carry a BARE YEAR, which `revisedOn` accepts and ranks
 * correctly against full dates; `effectiveFrom` cannot come from a bare year, so
 * those rows also start on the retrieval date. Same rule as Arkansas's 2023
 * booklet and Louisiana's statute rows.
 *
 * (The PDF conversion of the research scrambled its two-column layout: the fee
 * table is printed twice and interleaved with the closing sections, the numbered
 * markers of the UNKNOWNS and CONFLICTS lists are separated from their items, and
 * the two headings appear on adjacent lines with their content following ~50
 * lines later. Nothing is missing — it is out of order — and everything below was
 * reassembled by content. Three data points are marked "CANNOT QUOTE VERBATIM";
 * all three are UNKNOWNs and none was reconstructed.)
 */
import type { SourceDoc, Sourced } from '../provenance.js';
import { ftIn, type EscortRule, type RouteClass } from '../escortRules.js';
import type {
  JurisdictionOsowRules,
  OversizeFeeBand,
  OverweightPricing,
  PerMileRate,
  Threshold,
} from '../types.js';

const RETRIEVED = '2026-09-03';

/** Chapter 1680-07-01's own stated effective date. */
const EFF_RULES = '2018-05-15';

/**
 * The statute pages state "current through the 2025 legislative session" and
 * nothing finer. A bare year is legal in `revisedOn` and ranks correctly against
 * full dates; it cannot become an `effectiveFrom`, so statute rows start on the
 * retrieval date — the only day we can prove the text read this way.
 */
const STATUTE_YEAR = '2025';

// ── Source documents ──────────────────────────────────────────────────────

const TCA_55_7_201: SourceDoc = {
  id: 'tn-tca-55-7-201',
  title: 'Tenn. Code Ann. § 55-7-201 — Length limits (via Justia — SECONDARY source)',
  url: 'https://law.justia.com/codes/tennessee/title-55/chapter-7/part-2/section-55-7-201/',
  publisher: 'Justia, reproducing the Tennessee Code Annotated',
  revisedOn: STATUTE_YEAR,
  retrievedOn: RETRIEVED,
  cite:
    '(b) 45 ft single unit and 65 ft for a truck-and-trailer combination; (c) the 52 ft towed vehicle and the 41 ft kingpin condition; (d) 28 ft 6 in twins; (f) 75 ft for single-length logs, poles or timber',
};

const TCA_55_7_202: SourceDoc = {
  id: 'tn-tca-55-7-202',
  title: 'Tenn. Code Ann. § 55-7-202 — Width and height limits (via Justia — SECONDARY source)',
  url: 'https://law.justia.com/codes/tennessee/title-55/chapter-7/part-2/section-55-7-202/',
  publisher: 'Justia, reproducing the Tennessee Code Annotated',
  revisedOn: STATUTE_YEAR,
  retrievedOn: RETRIEVED,
  cite:
    '(a)(1) "exceeds eight feet (8′)"; (c) "not exceeding eight feet six inches (8′ 6″) ... over the interstate system and other federal-aid highways"; (d) "does not exceed eight feet six inches (8′ 6″)" and "does not exceed thirteen feet six inches (13′ 6″)"',
};

const TCA_55_7_203: SourceDoc = {
  id: 'tn-tca-55-7-203',
  title: 'Tenn. Code Ann. § 55-7-203 — Weight limits (via Justia — SECONDARY source)',
  url: 'https://law.justia.com/codes/tennessee/title-55/chapter-7/part-2/section-55-7-203/',
  publisher: 'Justia, reproducing the Tennessee Code Annotated',
  revisedOn: STATUTE_YEAR,
  retrievedOn: RETRIEVED,
  cite:
    '(b)(1)(A) 20,000 lb single axle; (b)(2) 34,000 lb tandem; (b)(3) 80,000 lb gross and the interstate bridge-formula proviso',
};

const TCA_55_7_205: SourceDoc = {
  id: 'tn-tca-55-7-205',
  title: 'Tenn. Code Ann. § 55-7-205 — Special permits and fees (via Justia — SECONDARY source)',
  url: 'https://law.justia.com/codes/tennessee/title-55/chapter-7/part-2/section-55-7-205/',
  publisher: 'Justia, reproducing the Tennessee Code Annotated',
  revisedOn: STATUTE_YEAR,
  retrievedOn: RETRIEVED,
  cite:
    '(h)(1)(A)-(D) the width ladder and the houseboat bands; (h)(2) "Excessive height or length: Twenty dollars ($20.00)"; (h)(3) "Excessive weight: Twenty dollars ($20.00) plus six cents (6¢) per ton-mile;"; (h)(4)(A)-(C) the bridge evaluation charges; (l)(1) the ten-day validity; (n)(5)(E)(i) the heavy-duty towing 12¢ ton-mile tier; (p) the route-survey height trigger',
};

/**
 * TDOT's published fee schedule. An undated dynamic render — the page carries no
 * revision line of any kind, so `revisedOn` is null and its rows start on the
 * retrieval date.
 */
const TDOT_FEES: SourceDoc = {
  id: 'tn-tdot-permit-prices',
  title: 'TDOT — OS/OW Permit Prices, Single Trip & Annual (undated)',
  url: 'https://www.tn.gov/tdot/traffic-operations-division/oversize---overweight-permits/single-trip---annual.html',
  publisher: 'Tennessee Department of Transportation, Traffic Operations Division',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite:
    '"8\'6" up to 14\' $20.00"; "14\'1" up to 16\' $30.00"; "Over 16\' $30.00 + $5 for each additional foot or fraction"; "Excess Length $20.00"; "Excess Height $20.00"; "Excess Weight .06/ton mile" over "20.00+"; the bridge fee rows; the mobile home, houseboat, THP escort and annual permit rows',
};

/**
 * The TDOT FAQ. Also undated — and it is the document that steps the escort and
 * fee boundaries in whole inches where the regulation writes continuous ranges.
 * It is additionally the only document on file that reproduces Rule
 * 1680-07-01-.12(1)'s super-heavy definition; that rule was not separately opened
 * and no URL is invented for it.
 */
const TDOT_FAQ: SourceDoc = {
  id: 'tn-tdot-osow-faq',
  title: 'TDOT — OS/OW Permits Frequently Asked Questions (undated)',
  url: 'https://www.tn.gov/tdot/traffic-operations-division/oversize---overweight-permits/frequently-asked-questions.html',
  publisher: 'Tennessee Department of Transportation, Traffic Operations Division',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite:
    '"Width 8\'6”" / "Height 13\'6”"; the escort table "10\'1” – 12\'6”", "12\'7” – 13\'6”", "13\'7” and greater", "15\'1” and greater", "90\'1” – 120\'", "120\'1” and greater"; "When the width of the load exceeds 18\' or the height exceeds 18\' THP escorts are required ... a minimum of two (2) officers for a minimum of four (4) hours at a rate of $65.00 per hour + $.13/mile"; "Gross Vehicle Weight in excess of 165,000 pounds Width in excess of 16\' Height in excess of 15\'6”"; the superload processing times; "If the height of the load exceeds 15\'6” and/or the width exceeds 16\' a route survey will be required"; and, in the same answer, Rule 1680-07-01-.12(1)\'s "super heavy" and "extra-overdimensional" definitions',
};

const RULE_06: SourceDoc = {
  id: 'tn-rule-1680-07-01-06',
  title: 'Tenn. Comp. R. & Regs. 1680-07-01-.06 — Width escort requirements (via Cornell LII — SECONDARY source)',
  url: 'https://www.law.cornell.edu/regulations/tennessee/Tenn-Comp-R-Regs-1680-07-01-.06',
  publisher: 'Cornell Legal Information Institute, reproducing the Tennessee Compilation Rules & Regulations',
  revisedOn: EFF_RULES,
  retrievedOn: RETRIEVED,
  cite:
    '(2)(a)-(c), (3)(a)-(c), (4)(a) and (5)(a)-(b): the continuous width bands, the 24 ft pavement split, the 20 ft bridge flagperson and the route survey over 16 ft',
};

const RULE_10: SourceDoc = {
  id: 'tn-rule-1680-07-01-10',
  title: 'Tenn. Comp. R. & Regs. 1680-07-01-.10 — Height pole and route survey (via Cornell LII — SECONDARY source)',
  url: 'https://www.law.cornell.edu/regulations/tennessee/Tenn-Comp-R-Regs-1680-07-01-.10',
  publisher: 'Cornell Legal Information Institute, reproducing the Tennessee Compilation Rules & Regulations',
  revisedOn: EFF_RULES,
  retrievedOn: RETRIEVED,
  cite:
    '(1)(c) the route survey "If the height of the movement is fifteen feet (15\') or more"; (1)(d) "When the permitted vehicle and load exceeds fifteen feet (15\') in height, the permittee shall determine all vertical clearances by use of a front escort vehicle having protrusions equal to, at a minimum, the height of the permitted vehicle and load."',
};

const RULE_11: SourceDoc = {
  id: 'tn-rule-1680-07-01-11',
  title: 'Tenn. Comp. R. & Regs. 1680-07-01-.11 — Length escort requirements (via Cornell LII — SECONDARY source)',
  url: 'https://www.law.cornell.edu/regulations/tennessee/Tenn-Comp-R-Regs-1680-07-01-.11',
  publisher: 'Cornell Legal Information Institute, reproducing the Tennessee Compilation Rules & Regulations',
  revisedOn: EFF_RULES,
  retrievedOn: RETRIEVED,
  cite:
    '(1)(a) no escort to 90 ft; (2)(a) "One (1) escort vehicle shall immediately follow the movement" over 90 ft to 120 ft; (3)(a) a front and a rear escort in excess of 120 ft',
};

const RULE_14: SourceDoc = {
  id: 'tn-rule-1680-07-01-14',
  title: 'Tenn. Comp. R. & Regs. 1680-07-01-.14 — Site-built house moves (via Cornell LII — SECONDARY source)',
  url: 'https://www.law.cornell.edu/regulations/tennessee/Tenn-Comp-R-Regs-1680-07-01-.14',
  publisher: 'Cornell Legal Information Institute, reproducing the Tennessee Compilation Rules & Regulations',
  revisedOn: EFF_RULES,
  retrievedOn: RETRIEVED,
  cite: '(8) "If it is anticipated that the movement of the building will be delayed by any utility"; (16) "Special Permits shall be valid for ten (10) days."',
};

const RULE_21: SourceDoc = {
  id: 'tn-rule-1680-07-01-21',
  title: 'Tenn. Comp. R. & Regs. 1680-07-01-.21 — Escort vehicle requirements (via Cornell LII — SECONDARY source)',
  url: 'https://www.law.cornell.edu/regulations/tennessee/Tenn-Comp-R-Regs-1680-07-01-.21',
  publisher: 'Cornell Legal Information Institute, reproducing the Tennessee Compilation Rules & Regulations',
  revisedOn: EFF_RULES,
  retrievedOn: RETRIEVED,
  cite:
    '(1)(a) "The escort vehicle must be a vehicle weighing more than 2,000 pounds with a manufacturer\'s gross vehicle weight rating less than 18,000 pounds and must be properly licensed." — vehicle, placard, lighting and equipment standards only; no operator certification anywhere in the section',
};

const RULE_24: SourceDoc = {
  id: 'tn-rule-1680-07-01-24',
  title: 'Tenn. Comp. R. & Regs. 1680-07-01-.24 — Permit fees, payment and refunds (via Cornell LII — SECONDARY source)',
  url: 'https://www.law.cornell.edu/regulations/tennessee/Tenn-Comp-R-Regs-1680-07-01-.24',
  publisher: 'Cornell Legal Information Institute, reproducing the Tennessee Compilation Rules & Regulations',
  revisedOn: EFF_RULES,
  retrievedOn: RETRIEVED,
  cite:
    '(1)(d) the houseboat "$2,500 plus $100 for each additional inch or fraction thereof greater than seventeen feet (17\')"; (3)(a) the $20 plus 6¢ per ton-mile; (3)(b)(2) the heavy-duty towing 12¢ tier; (5)(b)(11) the $100 seed cotton annual; (7)(a)-(c) the payment methods and the unquantified card surcharge; (7)(d) the refund rule',
};

const TDOT_NEWS: SourceDoc = {
  id: 'tn-tdot-news-memos',
  title: 'TDOT — OS/OW Permits News & Memos (undated)',
  url: 'https://www.tn.gov/tdot/traffic-operations-division/oversize---overweight-permits/news---memos.html',
  publisher: 'Tennessee Department of Transportation, Traffic Operations Division',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: '"01.15.26 Emergency Declaration" — the emergency and holiday restriction portal',
};

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * A row from an UNDATED page. `effectiveFrom` is the retrieval date, because
 * that is the only day on which we can prove the page said this. Both TDOT
 * pages are undated dynamic renders.
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

/** A row from a dated source, effective from a date the document states. */
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
 * A row from a statute page whose only date is a bare year. The year is recorded
 * in `revisedOn` and ranks correctly; `effectiveFrom` is the retrieval date,
 * because a year cannot window a row. Arkansas's and Louisiana's rule.
 */
function fromStatute<T>(value: T, source: SourceDoc, note?: string): Sourced<T> {
  return fromDated(value, source, RETRIEVED, note);
}

function escortRule(
  id: string,
  description: string,
  when: EscortRule['when'],
  then: EscortRule['then'],
  source: SourceDoc = RULE_06,
  effectiveFrom: string = EFF_RULES,
): EscortRule {
  return {
    id,
    jurisdiction: 'TN',
    description,
    when,
    then,
    source,
    effectiveFrom,
    effectiveTo: null,
  };
}

// ── Tennessee's own road vocabulary ───────────────────────────────────────

/**
 * PAVEMENT WIDTH IS TENNESSEE'S SECOND ROAD AXIS, AND IT IS A PUBLISHED PROPERTY
 * OF THE SEGMENT RATHER THAN ANYTHING DERIVABLE FROM LANE COUNT.
 *
 * 1680-07-01-.06(2) splits its escort requirement on it and nothing else: "No
 * escort will be required ... on two-lane highways with a minimum pavement width
 * (excluding paved shoulders) of twenty-four feet (24'). ... One (1) escort
 * vehicle is required to precede the movement where the minimum pavement width
 * (excluding paved shoulders) is less than twenty-four feet (24')." Two identical
 * two-lane roads, one pilot car apart, decided by a measurement TDOT holds for
 * the segment and a dispatcher can look up.
 *
 * That is California's map-colour test exactly — a segment property, published,
 * not inferable from the load or from the lane count — so `RouteClass` is
 * EXTENDED with two `tn-` members rather than having the distinction flattened
 * onto `two-lane`, which would have thrown away a whole escort in one direction
 * or invented one in the other.
 *
 * IT DOES NOT CROSS WITH LANE COUNT, and that is deliberate rather than a
 * compromise. Colorado needed ten `co-` members because NEITHER of its axes
 * existed in the general vocabulary. Tennessee's pavement-width split is a
 * SUB-classification of `two-lane` — it never applies to an interstate or a
 * four-lane road, because .06(2)(a) already exempts those outright — so the two
 * live on one axis and one `routeClass` value answers both. Kentucky's test,
 * passed from the other side.
 *
 * A caller that passes plain `two-lane` has answered the lane count and not the
 * pavement width. That case is NOT silently read as the wide variant: it fires
 * `tn-width-over-10-to-12-6-pavement-unknown`, which sends the move to review
 * naming the missing measurement. A caller that passes no road type at all
 * leaves both rules `unknown` and reaches the same place.
 */
const TN_TWO_LANE_NARROW: RouteClass = 'tn-two-lane-under-24ft-pavement';
const TN_TWO_LANE_WIDE: RouteClass = 'tn-two-lane-24ft-pavement-or-more';

/**
 * ".06(2)(a) exempts the interstate highway system and highways with four or more
 * lanes." Four-or-more-lanes covers a divided highway and an undivided one alike,
 * so `multilane-undivided` belongs here — the Kentucky grouping, and Tennessee's
 * rule text draws no median distinction anywhere.
 */
const FOUR_LANE: RouteClass[] = ['interstate', 'divided', 'multilane-undivided'];

/**
 * EVERY ROUTE CLASS THAT ACTUALLY ANSWERS .06(2), and it is written as a positive
 * list so that the "cannot tell" rule can be its NEGATION.
 *
 * The list is exhaustive on purpose. A route described as `urban` has not said
 * whether it is a two-lane street or a four-lane arterial, and neither has one
 * described by another state's map legend; testing only for `two-lane` would have
 * let every one of those fall through both rules and read as "no escort
 * required" — a pilot car dropped by an absence, which is exactly what the
 * three-valued contract exists to prevent. Arkansas met the same problem and
 * solved it the same way, by writing its residual category as a negation so an
 * urban arterial lands in it rather than nowhere.
 */
const PAVEMENT_ANSWERED: RouteClass[] = [
  ...FOUR_LANE,
  TN_TWO_LANE_NARROW,
  TN_TWO_LANE_WIDE,
];

// ── The findings and inferences, named so they can be audited ─────────────

/**
 * WHY THERE IS NO `TonMileRate`, IN ONE PLACE THAT CAN BE CITED.
 *
 * "Six cents per ton-mile" and "six cents per mile for each 2,000 lb over the
 * lawful weight" are the same sentence. `PerMileRate` computes
 * `ratePerMileUsd × miles × increments`, which is a product of distance and
 * weight, and its own documentation names that shape as one of the three it was
 * built for. Pennsylvania's "4¢ per mile per ton" has been encoded this way since
 * Phase 2 without anybody calling it two-dimensional.
 *
 * What was genuinely new about Tennessee is that both factors are LARGE at once —
 * Pennsylvania's rate is a rounding error beside Tennessee's on the same move —
 * which is why the partial-increment question escalates here and does not there.
 * That is a materiality finding, not a model gap.
 */
export const TENNESSEE_TON_MILE_MODEL_NOTE =
  'Tennessee\'s $0.06 per ton-mile is encoded as a PerMileRate with perIncrementLbs = 2,000 and excessBaseLbs = 80,000, because "six cents per ton-mile" and "six cents per mile for each ton over the lawful weight" are the same arithmetic and PerMileRate already multiplies a rate by the miles AND by the weight increments. WeightBand could not hold it: its perIncrementUsd component (Arkansas) is flat in miles, so a 500-mile Tennessee move would have priced as a 1-mile one. No field, no condition kind and no engine branch was added for this state.';

/**
 * THE 80,000 LB BASE — OUR CONSTRUCTION, and the one number here that moves the
 * fee by a multiple rather than by a margin.
 *
 * § 55-7-205(h)(3) says "per ton-mile" and never says which tons. Two things put
 * the excess reading beyond reasonable doubt and neither of them is the statute
 * saying so: TDOT's FAQ prints "Gross Weight 80,000 pounds" as the permitting
 * baseline, and § 55-7-205(n)(5)(E)(i) — the only other ton-mile charge Tennessee
 * writes — counts "all weight IN EXCESS OF one hundred sixty-five thousand
 * pounds". Reading (h)(3) on the gross instead would price a 100,000 lb permit at
 * five times this figure.
 *
 * WHERE IT IS WRONG, AND IN WHICH DIRECTION. On the interstate system the lawful
 * weight is the LESSER of 80,000 lb and the federal bridge formula, which for a
 * short wheelbase is well below 80,000 lb — so a compact heavy load is
 * UNDER-billed here. Washington's and Arkansas's own excess bases carry the same
 * caveat for the same reason.
 */
export const TENNESSEE_EXCESS_BASE_INFERENCE_LBS = 80000;

/**
 * THE PARTIAL INCREMENT, WHICH IS SILENT IN BOTH DOCUMENTS AND IS THE REASON
 * EVERY OVERWEIGHT TENNESSEE QUOTE GOES TO A HUMAN.
 *
 * Held as a plain record rather than as `Sourced<T>` rows: there is no second
 * value to weigh, only an absence, and a sourced row would be something the
 * resolver could price.
 */
export const TENNESSEE_PARTIAL_INCREMENT_UNKNOWN = {
  assumedTonRounding: 'up' as const,
  assumedMileRounding: 'pro-rata' as const,
  statute: 'Tenn. Code Ann. § 55-7-205(h)(3)',
  rule: 'Tenn. Comp. R. & Regs. 1680-07-01-.24',
  detail:
    'Neither Tenn. Code Ann. § 55-7-205(h)(3) nor Tenn. Comp. R. & Regs. 1680-07-01-.24 states whether a partial ton or a partial mile is rounded up, rounded down, or billed pro rata. This engine charges a PART TON IN FULL and bills the true mileage PRO RATA, which never under-quotes the carrier; a floor-the-tons reading is up to one ton cheaper on every load, which is $0.06 x the in-state miles. Tennessee uses the phrase "or fraction thereof" twice in this same schedule — § 55-7-205(h)(1)(C) and 1680-07-01-.24(1)(d) — and did not use it in (h)(3), which is the argument for the other reading. Neither has been adopted and every overweight Tennessee quote carries a review flag saying so.',
} as const;

/**
 * WHETHER TENNESSEE CHARGES ONE BASE FEE PER MOVEMENT OR ONE PER OVER-DIMENSION.
 * OUR READING, and the cheaper of the two.
 */
export const TENNESSEE_SINGLE_BASE_FEE_READING =
  'Tenn. Code Ann. § 55-7-205(h) prints the same twenty dollars as the floor of its width ladder (h)(1)(A), as the whole charge for excessive height or length (h)(2), and as the base of the excessive-weight charge (h)(3), and it never says what a movement over in two of the three pays. This engine charges ONE base fee per movement plus the width increment plus the ton-mile charge, following TDOT\'s own order-of-operations summary — "Base dimension/weight fee + per-ton-mile charge + bridge evaluation fee (if applicable) + credit card surcharge", with "Base permit fee applies per movement". The competing reading, that each subdivision charges its own $20, would add $20 to a movement that is over on both width and height or length. OUR READING, not the state\'s words.';

/**
 * THE FEE-SIDE HOLE THE STEPPED BOUNDARIES LEAVE — Arkansas's 251-mile gap in a
 * dimension.
 *
 * The statute bands the second width step as "Over fourteen feet (14′) but not
 * more than sixteen feet (16′)"; TDOT's fee table prints "14'1" up to 16'". They
 * agree from 14 ft 1 in upward and disagree about everything in between, so only
 * the range both documents name is priced. A load measuring 14 ft 0½ in matches
 * no band, the oversize line comes back null, and the quote says the published
 * schedule does not price it. Nothing is rounded into a step Tennessee did not
 * put it in.
 */
export const TENNESSEE_WIDTH_BAND_GAP = {
  statuteSecondBand: 'Over fourteen feet (14′) but not more than sixteen feet (16′), thirty dollars ($30.00)',
  agencySecondBand: "14'1\" up to 16' $30.00",
  pricedToIn: ftIn(14),
  pricedFromIn: ftIn(14, 1),
  detail:
    'Tenn. Code Ann. § 55-7-205(h)(1)(B) opens its $30 band immediately above 14 ft 0 in while TDOT\'s published fee table opens it at 14 ft 1 in. The $20 band closes at exactly 14 ft 0 in on both readings. A width strictly between 14 ft 0 in and 14 ft 1 in is therefore priced by no band either document publishes, and the permit fee must be confirmed with the TDOT Permit Office.',
} as const;

/**
 * THE ESCORT-SIDE HOLES, WHICH ARE THE SAME DEFECT AND CANNOT BE ABSORBED AT ANY
 * DOLLAR VALUE BECAUSE THEY DECIDE A REQUIREMENT.
 *
 * The research names two of them. The third follows identically from the two
 * texts it quotes and is OUR OBSERVATION rather than the source's analysis; it is
 * carried in the same rule and labelled as ours on the quote.
 */
export const TENNESSEE_ESCORT_BOUNDARY_GAPS: ReadonlyArray<{
  fromIn: number;
  toIn: number;
  ruleText: string;
  faqText: string;
  namedByResearch: boolean;
}> = [
  {
    fromIn: ftIn(10),
    toIn: ftIn(10, 1),
    ruleText: "over ten feet (10') wide but not exceeding twelve feet six inches (12'6\")",
    faqText: "10'1” – 12'6”",
    namedByResearch: true,
  },
  {
    fromIn: ftIn(12, 6),
    toIn: ftIn(12, 7),
    ruleText: "over twelve feet six inches (12'6\") wide but not exceeding thirteen feet six inches (13'6\")",
    faqText: "12'7” – 13'6”",
    namedByResearch: true,
  },
  {
    fromIn: ftIn(13, 6),
    toIn: ftIn(13, 7),
    ruleText: "over thirteen feet six inches (13'6\") wide but not exceeding sixteen feet (16')",
    faqText: "13'7” and greater",
    namedByResearch: false,
  },
];

/**
 * THE HOUSEBOAT, WHERE TWO OFFICIAL TENNESSEE DOCUMENTS DIFFER BY A FACTOR OF
 * EIGHT — held open by the mechanism and NOT written as a fee band.
 *
 * Nothing on an `OsowLoad` says a load is a houseboat, and a width rule that
 * could not tell one from a press frame would put $6,100 on the wrong load. This
 * is Arkansas's manufactured-home treatment: both readings on file, no adopted
 * value, `resolveSourced` refusing to pick, and the disagreement stated on any
 * quote wide enough for it to matter.
 *
 * The research's own conflict analysis was SPLIT BY THE PDF EXTRACTION — its
 * first half ends "whereas the older administrative" and its second half,
 * "code imposes a base fee of $2,500 + $100/inch above 17'.", appears fourteen
 * lines later after an intervening heading. It is reassembled verbatim below and
 * nothing was written to bridge it.
 */
export const TENNESSEE_HOUSEBOAT_CONFLICT_ANALYSIS =
  'The statute and agency website list three distinct stepped bands starting at 16\' ($500, $750, $1,000), whereas the older administrative code imposes a base fee of $2,500 + $100/inch above 17\'.';

export const TENNESSEE_HOUSEBOAT_SINGLE_TRIP_FEE_USD: {
  /** Width, in inches, the two readings are compared at. */
  atWidthIn: number;
  statuteAndAgency: Sourced<number>[];
  administrativeRule: Sourced<number>[];
} = {
  atWidthIn: ftIn(20),
  statuteAndAgency: [
    fromStatute(
      1000,
      TCA_55_7_205,
      '§ 55-7-205(h)(1)(D)(i): "Over sixteen feet (16′) but not more than eighteen feet (18′), five hundred dollars ($500)"; "Over eighteen feet (18′) but not more than twenty feet (20′), seven hundred fifty dollars ($750)"; "Over twenty feet (20′), one thousand dollars ($1,000)". At exactly 20 ft the middle band applies and the fee is $750; the $1,000 figure recorded here is the top band, and it is the row on which the research marks "CONFLICTS with administrative rule Tenn. Comp. R. & Regs. 1680-07-01-.24(1)(d)".',
    ),
    fromUndatedPage(
      1000,
      TDOT_FEES,
      'TDOT Permit Prices: "Width 16\' up to 18\' $500.00", "Width 18\' up to 20\' $750.00", "Width over 20\' $1000.00" — the agency page corroborates the statute band for band.',
    ),
  ],
  administrativeRule: [
    fromDated(
      6100,
      RULE_24,
      EFF_RULES,
      '1680-07-01-.24(1)(d): "For houseboats over seventeen feet (17\'): $2,500 plus $100 for each additional inch or fraction thereof greater than seventeen feet (17\')." At 20 ft that is $2,500 + $100 x 36 inches = $6,100, against $750 under the statute\'s middle band — a factor of eight on the same boat. The rule also has no upper band at all, so the two schedules diverge further with every additional inch.',
    ),
  ],
};

/**
 * THE SEED COTTON MODULE — an ANNUAL permit, a commodity this engine cannot
 * identify, and a five-fold disagreement. Recorded, never priced.
 *
 * $400 is eight times the $50 materiality threshold, so even if a load could be
 * identified as a seed cotton module the conflict would escalate to review rather
 * than be absorbed at the higher figure.
 */
export const TENNESSEE_SEED_COTTON_ANNUAL_FEE_USD: Sourced<number>[] = [
  fromStatute(
    100,
    TCA_55_7_205,
    '§ 55-7-205(b)(3), corroborated by 1680-07-01-.24(5)(b)(11): the annual seed cotton module permit costs $100.',
  ),
  fromUndatedPage(
    500,
    TDOT_FEES,
    'TDOT\'s published fee table lists "Seed Cotton Module $500.00" in the Annual Permit Cost column — five times the figure codified in both the statute and the administrative rules.',
  ),
];

/**
 * THE BRIDGE EVALUATION CHARGES, TRANSCRIBED AND NOT ENCODED.
 *
 * Three reasons, any one of which is sufficient. They are BANDED and
 * `ConditionalFee` carries a single `appliesAbove` and a single amount. The top
 * band is "actual cost", which is not an amount at all — Arkansas's $500 ceiling
 * argument. And every band sits above the 165,000 lb superload threshold, so the
 * engine emits no priced lines that could carry them; a `ConditionalFee` here
 * would be dead code that looked live.
 *
 * THE 250,000/251,000 BOUNDARY IS A SECOND HOLE OF THE SAME KIND. § 55-7-205(h)(4)
 * bands "over two hundred fifty thousand pounds (250,000 lbs.) but not more than
 * five hundred thousand pounds"; TDOT's table prints "251,000 lbs - 500,000 lbs".
 * A movement between 250,001 lb and 250,999 lb is named by the statute and not by
 * the agency table. It is recorded here because it is real and is not encoded
 * because nothing above 165,000 lb is priced.
 */
export const TENNESSEE_BRIDGE_EVALUATION_FEES: ReadonlyArray<{
  statuteBand: string;
  agencyBand: string;
  feeUsd: number | null;
}> = [
  {
    statuteBand: 'over 165,000 lbs. but not more than 250,000 lbs.',
    agencyBand: '165,000 lbs - 250,000 lbs',
    feeUsd: 100,
  },
  {
    statuteBand: 'over 250,000 lbs. but not more than 500,000 lbs.',
    agencyBand: '251,000 lbs - 500,000 lbs',
    feeUsd: 300,
  },
  {
    // NOT a zero and not a number: § 55-7-205(h)(4)(C) says "actual cost".
    statuteBand: 'over 500,000 lbs.',
    agencyBand: '500,000 lbs and over',
    feeUsd: null,
  },
];

/**
 * THE $0.12 TON-MILE TIER, WHICH BELONGS TO A TOW AND NOT TO GENERAL FREIGHT.
 *
 * Its own words are about "the combined weight of the towing vehicle and towed
 * vehicle", it is codified in § 55-7-205(n)(5) — heavy-duty towing secondary
 * movements — and 1680-07-01-.24(3)(b)(2) carries it in the same place. Nothing
 * on an `OsowLoad` identifies a wrecker recovery, so the general (h)(3) rate is
 * what this file applies, and (h)(3) states no upper weight bound of its own.
 * Above 165,000 lb the load is a superload here regardless and no line is priced.
 */
export const TENNESSEE_HEAVY_DUTY_TOWING_TON_MILE = {
  aboveLbs: 165000,
  usdPerTonMile: 0.12,
  quote:
    'provided, however, that if the combined weight of the towing vehicle and towed vehicle exceeds one hundred sixty-five thousand pounds (165,000 lbs.), the cost of the permit shall also include the additional fee of twelve cents (12¢) per ton-mile for all weight in excess of one hundred sixty-five thousand pounds (165,000 lbs.) together with the applicable charge for evaluating bridges and other structures as provided in subdivision (h)(4)',
  detail:
    'Tenn. Code Ann. § 55-7-205(n)(5)(E)(i) and Tenn. Comp. R. & Regs. 1680-07-01-.24(3)(b)(2). This is a HEAVY-DUTY TOWING secondary movement rate, not the general overweight rate above 165,000 lb: § 55-7-205(h)(3) states no upper weight bound. It is not applied here because no field on a load says a movement is a tow, and because 165,000 lb is Tennessee\'s superload threshold, above which no line is priced at all.',
} as const;

/**
 * THE PER-FOOT WIDTH STEP ABOVE 16 FT, RECORDED AND NOT BANDED.
 *
 * `OversizeFeeBand.feeUsd` is a flat amount with no per-unit component, and the
 * band would be unreachable in any case: over 16 ft wide is "extra-overdimensional"
 * under Rule 1680-07-01-.12(1) and a superload here, so the engine prices nothing.
 */
export const TENNESSEE_OVER_16FT_WIDTH_FEE = {
  baseUsd: 30,
  perAdditionalFootUsd: 5,
  aboveIn: ftIn(16),
  quote: "over sixteen feet (16′), thirty dollars ($30.00), plus five dollars ($5.00) for each additional foot or fraction thereof greater than sixteen feet (16′)",
} as const;

/**
 * THE THP ESCORT RATE, WHICH TENNESSEE ACTUALLY PUBLISHES — unusually — and which
 * still cannot be added to a permit total because the hours are set on the day.
 *
 * The floor IS computable and is stated on the quote: two officers x four hours x
 * $65.00 = $520.00, plus $0.13 a mile per officer.
 */
export const TENNESSEE_THP_ESCORT_RATE = {
  usdPerHourPerOfficer: 65,
  minimumHours: 4,
  minimumOfficers: 2,
  usdPerMile: 0.13,
  minimumUsd: 520,
} as const;

/** Annual permit fees — a different product, recorded for completeness. */
export const TENNESSEE_ANNUAL_PERMIT_FEES_USD = {
  overweightTo100000: 750,
  overweightTo120000: 1500,
  overweightTo140000: 2250,
  fixedLoad150000: 3000,
  overweightTo155000: 3000,
  overweightTo165000: 3500,
  overDimensionHeight13ft10in: 100,
  overDimensionWidth13ft6in: 100,
  overDimensionLength90ft: 100,
  mobileHome14ft: 1000,
  mobileHome16ft: 2000,
  roofTruss: 500,
  oceanGoingContainer: 750,
  towTruck: 500,
  nonCommercialBoatWidth8ft7inTo14ft: 40,
  nonCommercialBoatWidth14ft1inTo16ft: 60,
  nonCommercialBoatLengthOver65ft: 40,
  nonCommercialBoatHeightOver13ft6in: 40,
} as const;

/** Single-trip mobile-home fees — a vehicle class this engine cannot identify. */
export const TENNESSEE_MOBILE_HOME_SINGLE_TRIP_FEES_USD = {
  widthUpTo14ft: 50,
  widthUpTo16ft: 100,
  heightOver14ft2in: 50,
  length: 25,
} as const;

/**
 * The escrow minimum, published on the FAQ. Not a permit fee and not a
 * transaction fee — it is a balance a carrier maintains with TDOT Finance.
 */
export const TENNESSEE_ESCROW_MINIMUM_BALANCE_USD = 1000;

// ── Escort rules (1680-07-01-.06, -.10, -.11, -.21; TDOT FAQ) ─────────────

export const TENNESSEE_ESCORT_RULES: EscortRule[] = [
  /**
   * THE PAVEMENT-WIDTH SPLIT. .06(2) requires nothing on an interstate, on a
   * four-or-more-lane highway, or on a two-lane road with at least 24 ft of
   * pavement, and one front escort where the pavement is narrower. The rule is
   * written against the narrow member alone so that a wide two-lane segment
   * correctly reads FALSE rather than undecided.
   */
  escortRule(
    'tn-width-over-10-to-12-6-narrow-two-lane',
    'Over 10 ft up to 12 ft 6 in wide on a two-lane road with less than 24 ft of pavement — one front escort',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: [TN_TWO_LANE_NARROW] },
        {
          kind: 'between',
          measure: 'widthIn',
          min: ftIn(10),
          max: ftIn(12, 6),
          minInclusive: false,
        },
      ],
    },
    {
      escorts: 1,
      front: 1,
      advisory:
        '1680-07-01-.06(2)(b): "One (1) escort vehicle is required to precede the movement where the minimum pavement width (excluding paved shoulders) is less than twenty-four feet (24\')." The same subsection requires NO escort at this width on the interstate system, on a highway with four or more lanes, or on a two-lane highway with 24 ft or more of pavement.',
    },
  ),
  /**
   * THE HONEST GAP IN THE MIDDLE, WRITTEN AS A NEGATION SO NOTHING FALLS THROUGH
   * IT.
   *
   * A caller who says "two-lane" has answered the lane count and not the pavement
   * width; one who says "urban" has answered neither. Both are the same question
   * — .06(2) cannot be evaluated — and one pilot car over a long Tennessee leg is
   * not a distinction to guess at, so the rule fires on ANY route class that is
   * not on the answered list rather than on `two-lane` alone. A route class that
   * IS on the list has its answer already and hears nothing.
   *
   * `manualReview` rather than an advisory, for the reason `materiality.ts` rule 1
   * gives: an escort count is a requirement and is never a rounding question.
   */
  escortRule(
    'tn-width-over-10-to-12-6-pavement-unknown',
    'Over 10 ft up to 12 ft 6 in wide on a road whose pavement width was not stated — Tennessee decides the escort on that measurement',
    {
      kind: 'all',
      of: [
        { kind: 'not', of: { kind: 'routeClass', anyOf: PAVEMENT_ANSWERED } },
        {
          kind: 'between',
          measure: 'widthIn',
          min: ftIn(10),
          max: ftIn(12, 6),
          minInclusive: false,
        },
      ],
    },
    {
      manualReview:
        'Tennessee splits this escort requirement on a measurement this quote does not have. 1680-07-01-.06(2) requires no escort at this width "on the interstate highway system, on highways with four or more lanes, or on two-lane highways with a minimum pavement width (excluding paved shoulders) of twenty-four feet (24\')", and one front escort "where the minimum pavement width (excluding paved shoulders) is less than twenty-four feet (24\')". This route was described in terms that answer neither — a two-lane road with no pavement width, or a class such as "urban" that does not even settle the lane count — so whether this move needs a pilot car cannot be determined. Supply the segment as tn-two-lane-under-24ft-pavement or tn-two-lane-24ft-pavement-or-more, or confirm with the TDOT Permit Office.',
    },
  ),

  /**
   * ONE ESCORT WHATEVER THE ROAD, WHICH IS WHY NO ROAD TYPE IS REQUIRED TO PRICE
   * IT. .06(3) puts the car in FRONT on a two-lane highway and in the REAR on the
   * interstate or a four-lane highway — different position, same count, and the
   * count is the thing that costs money. Asserting a position here would force a
   * review on every quote without a road type for a distinction that cannot move
   * the price by a dollar. Texas's pattern, for Texas's reason.
   */
  escortRule(
    'tn-width-over-12-6-to-13-6',
    'Over 12 ft 6 in up to 13 ft 6 in wide — one escort (front on a two-lane highway, rear on the interstate or a four-lane highway)',
    {
      kind: 'between',
      measure: 'widthIn',
      min: ftIn(12, 6),
      max: ftIn(13, 6),
      minInclusive: false,
    },
    {
      escorts: 1,
      advisory:
        '1680-07-01-.06(3): "One (1) escort vehicle is required to follow the movement on the interstate highway system or highways with four or more lanes. ... One (1) escort vehicle is required to precede the movement on two-lane highways." One car either way; only its position changes with the road, so the road type is not needed to count or to price it.',
    },
  ),
  escortRule(
    'tn-width-over-13-6-to-16',
    'Over 13 ft 6 in up to 16 ft wide — a front and a rear escort on every highway',
    {
      kind: 'between',
      measure: 'widthIn',
      min: ftIn(13, 6),
      max: ftIn(16),
      minInclusive: false,
    },
    { escorts: 2, front: 1, rear: 1 },
  ),
  escortRule(
    'tn-width-over-16',
    'Over 16 ft wide — a front and a rear escort on every highway, and a route survey before the permit issues',
    { kind: 'gt', measure: 'widthIn', value: ftIn(16) },
    {
      escorts: 2,
      front: 1,
      rear: 1,
      routeSurvey: true,
      advisory:
        '1680-07-01-.06(5): "Movements in excess of sixteen feet (16\') may be permitted, as provided in Rule 1680-07-01-.12, if the movement is not detrimental or unsafe to the traveling public and the highway can accommodate the movement. A route survey shall be required prior to the issuance of a permit." A movement this wide is "extra-overdimensional" under Rule 1680-07-01-.12(1) and is priced by TDOT after review, so no permit amount is quoted for it. The published width fee above 16 ft is $30.00 plus $5.00 for each additional foot or fraction thereof, which is recorded in TENNESSEE_OVER_16FT_WIDTH_FEE and is not applied.',
    },
  ),

  /**
   * THE FRACTIONAL INCHES WHERE THE REGULATION AND THE FAQ GIVE OPPOSITE ANSWERS.
   *
   * The regulation's bands are continuous and its neighbour begins where the last
   * one ends; the FAQ steps in whole inches and leaves the fraction between two
   * steps in neither. Inside those inches one document requires a pilot car and
   * the other requires none. This is Arkansas's 251-mile hole and Washington's
   * 999-pound band, and it is left as a hole: the count is not chosen, the two
   * texts are quoted, and the move goes to a human.
   */
  escortRule(
    'tn-escort-boundary-step-gap',
    'A fractional width between two of TDOT’s whole-inch escort steps — the regulation and the FAQ disagree in exactly these inches',
    {
      kind: 'any',
      of: TENNESSEE_ESCORT_BOUNDARY_GAPS.map((g) => ({
        kind: 'between' as const,
        measure: 'widthIn' as const,
        min: g.fromIn,
        max: g.toIn,
        minInclusive: false,
        maxInclusive: false,
      })),
    },
    {
      manualReview:
        'This load\'s width falls between two of TDOT\'s published escort steps. Tenn. Comp. R. & Regs. 1680-07-01-.06 writes CONTINUOUS bands — "over ten feet (10\') wide but not exceeding twelve feet six inches (12\'6")", "over twelve feet six inches (12\'6") wide but not exceeding thirteen feet six inches (13\'6")", "over thirteen feet six inches (13\'6") wide but not exceeding sixteen feet (16\')" — so a fraction above a boundary is already in the next band. TDOT\'s FAQ instead lists DISCRETE whole-inch steps — "10\'1” – 12\'6”", "12\'7” – 13\'6”", "13\'7” and greater" — which name no band for the fraction between them. Inside these inches the regulation requires an escort the FAQ does not, so the escort requirement cannot be determined from the published rules and no count has been adopted. The research names the 10\'0"–10\'1" and 12\'6"–12\'7" holes; the 13\'6"–13\'7" hole follows identically from the same two quoted texts and is OUR OBSERVATION rather than the source\'s analysis. Confirm the escort requirement with the TDOT Permit Office.',
    },
  ),

  /**
   * THE HEIGHT POLE, AND TENNESSEE COMMANDS THE ESCORT RATHER THAN EQUIPPING ONE.
   *
   * This is where Tennessee parts company with Kentucky and Colorado. Their texts
   * say "the ESCORTED load", presupposing a car that is already there, so
   * `ky-height-pole-over-15` and `co-height-pole-over-16` assert no count.
   * 1680-07-01-.10(1)(d) says the permittee "shall determine all vertical
   * clearances BY USE OF A FRONT ESCORT VEHICLE having protrusions equal to, at a
   * minimum, the height of the permitted vehicle and load" — the front escort is
   * the instrument the rule requires, not an assumption about one. TDOT's FAQ
   * agrees in the escort table: "15\'1” and greater Front escort with height pole
   * required". So the count IS asserted here.
   */
  escortRule(
    'tn-height-over-15-front-escort-with-pole',
    'Over 15 ft high — one front escort carrying a height pole set to the load’s height',
    { kind: 'gt', measure: 'heightIn', value: ftIn(15) },
    {
      escorts: 1,
      front: 1,
      heightPole: true,
      advisory:
        '1680-07-01-.10(1)(d): "When the permitted vehicle and load exceeds fifteen feet (15\') in height, the permittee shall determine all vertical clearances by use of a front escort vehicle having protrusions equal to, at a minimum, the height of the permitted vehicle and load. The escort vehicle shall be capable of immediately communicating with the permitted vehicle at all times ... The permitted vehicle shall follow the escort vehicle at such a distance and at such a speed as will permit stopping on receipt of advice that any vertical clearance is less than the height of the permitted vehicle and load." TDOT\'s FAQ states the same requirement as "15\'1” and greater Front escort with height pole required" — the same boundary in whole inches — and separately notes that for a ROUTE SURVEY "Height poles should be set at 6” greater than the height of the load", which is a survey specification and not the escort pole\'s.',
    },
    RULE_10,
  ),

  escortRule(
    'tn-length-over-90-to-120',
    'Over 90 ft up to 120 ft long — one rear escort',
    {
      kind: 'between',
      measure: 'overallLengthIn',
      min: ftIn(90),
      max: ftIn(120),
      minInclusive: false,
    },
    { escorts: 1, rear: 1 },
    RULE_11,
  ),
  escortRule(
    'tn-length-over-120',
    'Over 120 ft long — a front and a rear escort',
    { kind: 'gt', measure: 'overallLengthIn', value: ftIn(120) },
    { escorts: 2, front: 1, rear: 1 },
    RULE_11,
  ),
  escortRule(
    'tn-length-over-75-signs-and-lights',
    'Over 75 ft long — front and rear signs and an amber strobe, but no escort until 90 ft',
    { kind: 'gt', measure: 'overallLengthIn', value: ftIn(75) },
    {
      advisory:
        '1680-07-01-.11(1)(a) requires NO escort vehicle for a length "exceeding the limits established by law ... but not exceeding ninety feet (90\')". Over 75 ft the movement must still display front and rear signs and a rotating or strobing amber light. That is equipment on the load rather than a pilot car, Tennessee publishes no charge for it, and no cost for it is included in this quote.',
    },
    RULE_11,
  ),

  /**
   * OVERHANG — A RECORDED ABSENCE. Several states set an overhang at which a
   * pilot car becomes mandatory; Tennessee sets none, and its overhang rules are
   * about lamps. Keyed on the general over-dimensional disjunction rather than on
   * an overhang threshold, because inventing one would be exactly the error this
   * rule exists to report.
   */
  escortRule(
    'tn-overhang-no-escort-trigger',
    'Tennessee publishes no escort trigger based on overhang alone',
    {
      kind: 'any',
      of: [
        { kind: 'gt', measure: 'widthIn', value: 102 },
        { kind: 'gt', measure: 'heightIn', value: ftIn(13, 6) },
        { kind: 'gt', measure: 'overallLengthIn', value: ftIn(75) },
      ],
    },
    {
      advisory:
        'Tennessee publishes no legal overhang limit and no standalone escort trigger based on overhang: the escort tables in 1680-07-01-.06 and -.11 run on width, height and overall length only. What an overhang does trigger is lighting — "On each side of the projecting load, one red side marker lamp, visible from the side, located to indicate maximum overhang" — so a projecting load is carried by the length rules above and by the marking requirements, and no pilot car is counted for overhang by itself.',
    },
    TDOT_FAQ,
    RETRIEVED,
  ),

  escortRule(
    'tn-bridge-flagperson-narrow-structures',
    'A flagperson is required at every bridge whose roadway is under 20 ft wide, which a quote cannot see',
    { kind: 'gt', measure: 'widthIn', value: ftIn(10) },
    {
      advisory:
        '1680-07-01-.06(2)(c) and (3)(c): "A flagperson will be required at all bridge structures where the roadway width is less than twenty feet (20\')." That is a property of individual structures on the chosen route, is not published as a route-level attribute, and is settled when TDOT approves the route. A flagperson is not a pilot car and no cost for one is included in the escort count or the permit total above.',
    },
  ),

  /**
   * THE THP ESCORT, WHICH HAS A REAL NUMERIC TRIGGER AND A REAL PUBLISHED RATE —
   * and still cannot be totalled, because the hours are set on the day of the
   * move. Indiana's treatment: `manualReview` with the arithmetic stated.
   *
   * Both triggers are already past a superload threshold (16 ft wide, 15 ft 6 in
   * high), so a load reaching this rule is priced by TDOT after review anyway.
   */
  escortRule(
    'tn-thp-escort-over-18',
    'Over 18 ft wide or over 18 ft high — Tennessee Highway Patrol escorts, minimum two officers for a minimum of four hours',
    {
      kind: 'any',
      of: [
        { kind: 'gt', measure: 'widthIn', value: ftIn(18) },
        { kind: 'gt', measure: 'heightIn', value: ftIn(18) },
      ],
    },
    {
      manualReview:
        'TDOT FAQ: "When the width of the load exceeds 18\' or the height exceeds 18\' THP escorts are required. Especially complex movements may also require THP escorts. THP escorts are in addition to other required escorts. The THP Request Form will be required. Once the Permit Office has approved the movement it will be forwarded to THP who will then contact the carrier to schedule the move. THP moves require a minimum of two (2) officers for a minimum of four (4) hours at a rate of $65.00 per hour + $.13/mile." The floor is computable — 2 officers x 4 hours x $65.00 = $520.00, plus $0.13 per mile — but the hours actually charged are set by THP on the day, so no police-escort amount is included in the permit total. Rule 1680-07-01-.12(4) separately lets the Permit Office require law-enforcement escorts on a super-heavy movement with no threshold at all.',
    },
    TDOT_FAQ,
    RETRIEVED,
  ),
  escortRule(
    'tn-police-escort-ancillary-fees-unpublished',
    'Tennessee publishes the trooper rate but not the admin fee, the per diem or the cancellation charge',
    {
      kind: 'any',
      of: [
        { kind: 'gt', measure: 'widthIn', value: ftIn(16) },
        { kind: 'gt', measure: 'heightIn', value: ftIn(15, 6) },
      ],
    },
    {
      advisory:
        'Tennessee is unusual in publishing a law-enforcement escort RATE — $65.00 per hour per officer, a four-hour minimum, two officers minimum and $0.13 per mile. What it does not publish is the rest of the bill: the Department of Safety & Homeland Security rules (Tenn. Comp. R. & Regs. Title 1340) and TDOT\'s own rules codify no per-application administrative fee, no officer per diem and no cancellation penalty for an OS/OW escort, and billing is administered through TDOT\'s THP Request process rather than from a published schedule. Those amounts are not in the total above and their absence must not be read as their being nil.',
    },
    TDOT_FAQ,
    RETRIEVED,
  ),

  /**
   * THE TON-MILE ASSUMPTION, AND THE REASON EVERY OVERWEIGHT TENNESSEE QUOTE
   * CARRIES A REVIEW FLAG. See `TENNESSEE_PARTIAL_INCREMENT_UNKNOWN`.
   */
  escortRule(
    'tn-ton-mile-partial-increment-unknown',
    'Tennessee never says how a part ton or a part mile is billed, and on a ton-mile that is not a small question',
    { kind: 'gt', measure: 'grossWeightLbs', value: 80000 },
    {
      manualReview:
        'Tennessee prices the overweight permit at "Twenty dollars ($20.00) plus six cents (6¢) per ton-mile" (Tenn. Code Ann. § 55-7-205(h)(3); Tenn. Comp. R. & Regs. 1680-07-01-.24(3)(a)) and NEITHER document says whether a partial ton or a partial mile is rounded up, rounded down, or billed pro rata. On a ton-mile that ambiguity is not bounded the way a flat per-mile fee\'s is: one cent of it across fifty tons and five hundred miles is $250, and a single unrounded half-ton over 500 miles is $15 by itself. THIS QUOTE CHARGES A PART TON IN FULL AND BILLS THE TRUE MILEAGE PRO RATA. That pair never under-quotes the carrier at the counter, and it is the reading PerMileRate documents as the statutory norm. The argument the other way is Tennessee\'s own: it writes "or fraction thereof" in § 55-7-205(h)(1)(C) and in 1680-07-01-.24(1)(d) and did not write it in (h)(3). Neither reading has been adopted; the excess is also counted over 80,000 lb, which is OUR CONSTRUCTION from TDOT\'s published permitting baseline and not the statute\'s words. Confirm the fee with the TDOT Permit Office before the quote is committed.',
    },
    TCA_55_7_205,
    RETRIEVED,
  ),

  /**
   * WHICH READING OF THE BASE FEE IS PRICED, STATED ON ANY MOVEMENT WHERE THE TWO
   * READINGS DIVERGE — that is, a load over in a dimension AND in weight, or over
   * in width AND in height or length.
   */
  escortRule(
    'tn-single-base-fee-reading',
    'Tennessee does not say whether a movement over in two dimensions pays two base fees — this quote charges one',
    {
      kind: 'atLeast',
      count: 2,
      of: [
        { kind: 'gt', measure: 'widthIn', value: 102 },
        { kind: 'gt', measure: 'heightIn', value: ftIn(13, 6) },
        { kind: 'gt', measure: 'grossWeightLbs', value: 80000 },
      ],
    },
    {
      advisory:
        'Tenn. Code Ann. § 55-7-205(h) prints the same twenty dollars three times — as the floor of the width ladder in (h)(1)(A), as the whole charge for "Excessive height or length" in (h)(2), and as the base of the excessive-weight charge in (h)(3) — and never says what a movement over in two of the three pays. This quote charges ONE base fee per movement plus the width increment plus the ton-mile charge, following TDOT\'s own summary that the total is a "Base dimension/weight fee + per-ton-mile charge + bridge evaluation fee (if applicable) + credit card surcharge" and that the "Base permit fee applies per movement". Reading each subdivision as charging its own $20 would add $20 to this permit. OUR READING, not the state\'s words, and neither has been adopted.',
    },
    TCA_55_7_205,
    RETRIEVED,
  ),

  /**
   * THE 8 FT BASELINE OFF THE DESIGNATED SYSTEM — the Kentucky National Truck
   * Network case in Tennessee's vocabulary. § 55-7-202(a)(1) caps width at 8 ft
   * generally while (c) and (d) allow 8 ft 6 in on the interstate system, on
   * federal-aid highways designated by the commissioner, and on the federal and
   * state highway system. Recording 8 ft as the legal width would put an
   * over-width permit on every ordinary 102-inch trailer in the state, so the
   * 8 ft 6 in figure is recorded and this rule states the other one.
   */
  escortRule(
    'tn-width-over-96-off-designated-highways',
    'Over 8 ft wide — legal on the designated system, over the general statutory limit off it',
    { kind: 'gt', measure: 'widthIn', value: 96 },
    {
      advisory:
        'Tenn. Code Ann. § 55-7-202(a)(1) forbids operating a vehicle "whose width, including any part of the load, exceeds eight feet (8′) (that is, four feet (4′) on each side of the center line of the vehicle)", while § 55-7-202(c) permits "Motor vehicles not exceeding eight feet six inches (8′ 6″) in width ... to operate over the interstate system and other federal-aid highways designated by the commissioner" and § 55-7-202(d) allows the same 8 ft 6 in on the federal and state highway system. TDOT\'s FAQ publishes the legal width as 8\'6”, and that is the figure recorded here — OUR READING of which network a quoted lane uses, and the permissive one. A route that leaves the designated system is governed by the 8 ft figure and an ordinary 102-inch trailer needs an over-width permit on it.',
    },
    TCA_55_7_202,
    RETRIEVED,
  ),
  escortRule(
    'tn-length-over-65-truck-and-trailer',
    'Over 65 ft overall — a limit Tennessee sets for a truck-and-trailer combination and not for a tractor-semitrailer',
    { kind: 'gt', measure: 'overallLengthIn', value: ftIn(65) },
    {
      advisory:
        'Tenn. Code Ann. § 55-7-201(b) forbids operating a truck drawing another vehicle "the total length of which combination, including any part of the body or load, exceeds sixty-five feet (65′)", while § 55-7-201(c) regulates a truck-tractor and semitrailer by the TOWED VEHICLE instead — "the towed vehicle shall not exceed fifty-two feet (52′) in length from the point of attachment to the tractor" — and caps no overall length for that combination. This engine records the 52 ft towed-vehicle figure and NO overall length limit, because an ordinary tractor and trailer measures about 70 ft over the bumpers and recording 65 ft would flag every one of them as over-length. A straight truck drawing a trailer is capped at 65 ft overall and a single unit at 45 ft; single-length logs, poles or timber may run to 75 ft under § 55-7-201(f) before a permit is needed. If this movement is one of those configurations, the over-length permit is not reflected above.',
    },
    TCA_55_7_201,
    RETRIEVED,
  ),

  /**
   * THE BUCKET TRUCK — a recorded absence, and the absence is the finding.
   * Tennessee sets no general height at which a utility crew must accompany a
   * move; what it does set is the route survey, and, for a SITE-BUILT HOUSE only,
   * utility coordination under 1680-07-01-.14(8).
   */
  escortRule(
    'tn-bucket-truck-no-codified-trigger',
    'Tennessee sets no codified height at which a bucket truck or utility notification becomes mandatory',
    { kind: 'gt', measure: 'heightIn', value: ftIn(13, 6) },
    {
      advisory:
        'No general numerical height threshold requiring a bucket truck or a utility-company notification is published anywhere in Chapter 1680-07-01 or in Title 55 Chapter 7 for standard commercial freight, so none is counted here. What Tennessee does require over height is a front escort with a height pole over 15 ft and a route survey over 15 ft 6 in. For a SITE-BUILT STRUCTURE move — a different product — 1680-07-01-.14(8) requires coordination with the utilities along the route where overhead wires or facilities will delay the movement. If overhead facilities on the chosen route have to be lifted or de-energised, that cost is not in this quote.',
    },
    RULE_14,
  ),

  /**
   * THE SURVEY TENNESSEE REQUIRES AND DOES NOT PERFORM. `routeAnalysisFeeUsd` is
   * empty rather than a sourced zero for exactly this reason — Kentucky's and
   * Colorado's treatment.
   */
  escortRule(
    'tn-route-survey-cost-unpublished',
    'Over 15 ft 6 in high or over 16 ft wide — Tennessee requires a route survey and publishes no cost for one',
    {
      kind: 'any',
      of: [
        { kind: 'gt', measure: 'heightIn', value: ftIn(15, 6) },
        { kind: 'gt', measure: 'widthIn', value: ftIn(16) },
      ],
    },
    {
      routeSurvey: true,
      advisory:
        'TDOT FAQ: "If the height of the load exceeds 15\'6” and/or the width exceeds 16\' a route survey will be required. You may download a copy of the route survey form here. Surveys must be submitted on the correct form to be evaluated. Height poles should be set at 6” greater than the height of the load for surveys." The State of Tennessee does not conduct the survey and publishes no fee for one: the applicant completes and submits the official form, and private surveyors or the carrier perform the work at market rates. No route-analysis charge appears in the total above and none is recorded as a zero.',
    },
    TDOT_FAQ,
    RETRIEVED,
  ),

  /**
   * THE CARD SURCHARGE THAT EXISTS AND HAS NO PUBLISHED RATE. `transactionFee` is
   * an EMPTY list, so the engine already says on every Tennessee quote that no
   * transaction cost is on file; this states WHY, which is the difference between
   * a research gap and a publication gap.
   */
  escortRule(
    'tn-card-surcharge-rate-unpublished',
    'Tennessee charges a card surcharge and publishes no percentage for it',
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
        '1680-07-01-.24(7) lists the ways a permit may be paid for: "(a) Personal, business, or cashier\'s check; (b) Credit card (subject to a transaction surcharge); or (c) From an escrow account established with TDOT". The surcharge is real and its RATE is published nowhere — not in the administrative code and not on the FAQ — so no transaction cost is included in the total above, and that absence is a gap in what Tennessee publishes rather than a finding that the surcharge is nil. Paying by check or from an escrow account avoids it; the FAQ states "The minimum balance to open an escrow account is $1,000.00", and funds must reach TDOT Finance at least five business days before the permit issues.',
    },
    RULE_24,
  ),

  /**
   * PILOT-CAR CERTIFICATION — RECORDED POSITIVELY BECAUSE THE ANSWER IS "NONE"
   * and several neighbouring states answer otherwise. Virginia certifies and
   * publishes a seven-state reciprocity list; Florida, Oklahoma, Washington and
   * Colorado all run programmes. Tennessee runs none and recognises none.
   */
  escortRule(
    'tn-no-pilot-car-certification',
    'Tennessee neither certifies escort-vehicle operators nor recognises another state’s certification',
    { kind: 'gt', measure: 'widthIn', value: ftIn(10) },
    {
      advisory:
        'Tenn. Comp. R. & Regs. 1680-07-01-.21 sets the escort VEHICLE standard — "The escort vehicle must be a vehicle weighing more than 2,000 pounds with a manufacturer\'s gross vehicle weight rating less than 18,000 pounds and must be properly licensed" — together with placard, lighting and safety-equipment requirements, and it mandates no driver certification, no examination and no reciprocity in either direction. Any driver meeting the ordinary licence and equipment rules may escort in Tennessee, so a certificate earned elsewhere buys nothing here and a Tennessee-only operator carries none into a state that requires one. The reciprocity question is UNKNOWN only in the sense that there is no Tennessee certification to reciprocate.',
    },
    RULE_21,
  ),

  escortRule(
    'tn-permit-validity-and-refunds',
    'A Tennessee single-trip permit runs ten days, moves around the clock, and is not refundable',
    {
      kind: 'any',
      of: [
        { kind: 'gt', measure: 'widthIn', value: 102 },
        { kind: 'gt', measure: 'grossWeightLbs', value: 80000 },
      ],
    },
    {
      advisory:
        'Tenn. Code Ann. § 55-7-205(l)(1): a single-trip permit "shall allow for continuous movement twenty-four (24) hours a day, seven (7) days a week, and shall be valid for ten (10) calendar days for each single trip". A single-trip MOBILE HOME permit runs six days and a site-built house permit ten (1680-07-01-.14(16)); a houseboat permit over 16 ft wide is valid only for movements on a Tuesday, Wednesday or Thursday under § 55-7-205(h)(1)(D)(ii). 1680-07-01-.24(7)(d): "No single trip or annual permit fee will be refunded after issuance of the permit; provided, however, if a single trip permit for excessive weight is cancelled by the permittee prior to the beginning date of the permit and before the permitted movement actually occurs, the ton mile portion of the fee shall be refunded or credited to the permittee if another permit is issued in place of the cancelled permit for the same movement." TDOT adds that a permit "may be amended one time".',
    },
    TCA_55_7_205,
    RETRIEVED,
  ),

  /**
   * ABOVE THE SUPERLOAD LINE — the process, the bridge charges and the tow rate,
   * all in one place, because they all begin at 165,000 lb and none of them is
   * priced.
   */
  escortRule(
    'tn-superheavy-process-and-charges',
    'Over 165,000 lb — a super-heavy movement, priced by TDOT after an engineering review',
    { kind: 'gt', measure: 'grossWeightLbs', value: 165000 },
    {
      advisory:
        'TDOT FAQ: "Superload permit approximate processing times: 165,000 pounds and under 3 days 165,001 – 250,000 pounds 5 days 250,001 – 500,000 pounds 15 days Greater than 500,000 pounds 30 days", with an engineering analysis by the Structures Division, a route survey, a traffic control plan and daylight-only movement. Tenn. Code Ann. § 55-7-205(h)(4) adds a bridge evaluation charge of $100 to 250,000 lb, $300 to 500,000 lb and ACTUAL COST above it — the statute bands the middle step as "over two hundred fifty thousand pounds (250,000 lbs.)" while TDOT\'s table prints "251,000 lbs - 500,000 lbs", so a movement between 250,001 lb and 250,999 lb is named by the statute and not by the agency table. § 55-7-205(n)(5)(E)(i) separately adds twelve cents per ton-mile on the excess over 165,000 lb for a HEAVY-DUTY TOWING secondary movement, which is a different product from general freight and is not applied here. None of these amounts is in the total above, and no permit price is quoted for a super-heavy movement.',
    },
    TDOT_FAQ,
    RETRIEVED,
  ),

  /**
   * THE HOUSEBOAT DISAGREEMENT, STATED ON A LOAD WIDE ENOUGH FOR IT TO MATTER AND
   * NOT PRICED. Nothing on a load says it is a houseboat, so the fee itself lives
   * in `TENNESSEE_HOUSEBOAT_SINGLE_TRIP_FEE_USD` where the resolver refuses to
   * pick between the two readings.
   */
  escortRule(
    'tn-houseboat-fee-conflict',
    'Over 16 ft wide — if this is a houseboat, two official Tennessee schedules differ by a factor of eight',
    { kind: 'gt', measure: 'widthIn', value: ftIn(16) },
    {
      advisory:
        'Tennessee publishes two incompatible houseboat schedules. Tenn. Code Ann. § 55-7-205(h)(1)(D)(i) and TDOT\'s Permit Prices page band a single-trip houseboat permit at $500 over 16 ft to 18 ft, $750 over 18 ft to 20 ft and $1,000 over 20 ft. Tenn. Comp. R. & Regs. 1680-07-01-.24(1)(d) reads "For houseboats over seventeen feet (17\'): $2,500 plus $100 for each additional inch or fraction thereof greater than seventeen feet (17\')" — which at 20 ft is $6,100 against the statute\'s $750, and diverges further with every inch. The research\'s own analysis: "The statute and agency website list three distinct stepped bands starting at 16\' ($500, $750, $1,000), whereas the older administrative code imposes a base fee of $2,500 + $100/inch above 17\'." Neither figure has been adopted and NEITHER IS IN THE TOTAL ABOVE: no field on a load identifies a houseboat, so the general width schedule is what was priced. If this movement is a houseboat, the permit fee must be obtained from the TDOT Permit Office, and note that § 55-7-205(h)(1)(D)(ii) restricts the movement to a Tuesday, Wednesday or Thursday.',
    },
    RULE_24,
  ),

  escortRule(
    'tn-emergency-and-holiday-restrictions',
    'Tennessee posts holiday restrictions and emergency declarations that a quote cannot see',
    {
      kind: 'any',
      of: [
        { kind: 'gt', measure: 'widthIn', value: 102 },
        { kind: 'gt', measure: 'grossWeightLbs', value: 80000 },
      ],
    },
    {
      advisory:
        'TDOT maintains holiday movement restrictions and emergency declarations on its OS/OW News & Memos portal — the most recent on file is captioned "01.15.26 Emergency Declaration". Those notices temporarily suspend or tighten size and weight rules for disaster relief and holiday traffic; they do not change the codified fee schedule priced above, and they are published day by day rather than as a route attribute this quote can read. Check the portal for the movement dates before the permit is applied for.',
    },
    TDOT_NEWS,
    RETRIEVED,
  ),
];

// ── The fee schedule ──────────────────────────────────────────────────────

/**
 * THE WIDTH LADDER AS AN INCREMENT ABOVE THE $20 BASE — Indiana's decomposition,
 * and the reason a legal-size overweight permit still carries its base fee.
 *
 * $20 + $0 reproduces § 55-7-205(h)(1)(A)'s "Not more than fourteen feet (14′),
 * twenty dollars ($20.00)" and TDOT's "8'6" up to 14' $20.00". $20 + $10
 * reproduces (h)(1)(B)'s thirty dollars and TDOT's "14'1" up to 16' $30.00".
 *
 * NEITHER BAND BOUNDS HEIGHT OR LENGTH, which is what makes an over-height or
 * over-length load pick up the $20 base and no increment — the published
 * "Excess Height $20.00" and "Excess Length $20.00" rows.
 *
 * THE GAP BETWEEN THEM IS DELIBERATE. The $20 band closes at exactly 14 ft 0 in
 * on both documents; the $10 increment opens at 14 ft 1 in, the point both
 * documents name. A width strictly between them matches no band, the oversize
 * line comes back null, and the quote says so. See `TENNESSEE_WIDTH_BAND_GAP`.
 */
const oversizeFeeBands: Sourced<OversizeFeeBand>[] = [
  fromStatute<OversizeFeeBand>(
    {
      label: 'up to 14 ft wide — no increment above the $20 base fee',
      upToWidthIn: { value: ftIn(14), inclusive: false },
      feeUsd: 0,
    },
    TCA_55_7_205,
    '§ 55-7-205(h)(1)(A): "Not more than fourteen feet (14′), twenty dollars ($20.00)". INCLUSIVE — a load measuring exactly 14 ft 0 in is in this band. The $20 IS the base fee held in `permitBaseFeeUsd`, so this band adds nothing and the two together are the published $20. The band bounds width only, which is why an over-height or over-length load within 14 ft also lands here and pays the same $20 the schedule prints for "Excess Height" and "Excess Length".',
  ),
  fromUndatedPage<OversizeFeeBand>(
    {
      label: 'up to 14 ft wide — no increment above the $20 base fee',
      upToWidthIn: { value: ftIn(14), inclusive: false },
      feeUsd: 0,
    },
    TDOT_FEES,
    'TDOT Permit Prices: "Excess Width: 8\'6" up to 14\' $20.00", and "Excess Length $20.00" / "Excess Height $20.00" at the same amount.',
  ),
  fromStatute<OversizeFeeBand>(
    {
      label: 'over 14 ft 1 in up to 16 ft wide — $10 above the base fee',
      overWidthIn: { value: ftIn(14, 1), inclusive: true },
      upToWidthIn: { value: ftIn(16), inclusive: false },
      feeUsd: 10,
    },
    TCA_55_7_205,
    '§ 55-7-205(h)(1)(B): "Over fourteen feet (14′) but not more than sixteen feet (16′), thirty dollars ($30.00)" — the $20 base plus this $10 increment. THE FLOOR RECORDED HERE IS 14 FT 1 IN, NOT THE STATUTE\'S "over fourteen feet": TDOT\'s fee table opens the same band at "14\'1"", and only the range both documents name is priced. A width strictly between 14 ft 0 in and 14 ft 1 in matches no band and the schedule does not price it. See TENNESSEE_WIDTH_BAND_GAP.',
  ),
  fromUndatedPage<OversizeFeeBand>(
    {
      label: 'over 14 ft 1 in up to 16 ft wide — $10 above the base fee',
      overWidthIn: { value: ftIn(14, 1), inclusive: true },
      upToWidthIn: { value: ftIn(16), inclusive: false },
      feeUsd: 10,
    },
    TDOT_FEES,
    'TDOT Permit Prices: "Excess Width: 14\'1" up to 16\' $30.00" — the $20 base plus this $10 increment. Above 16 ft the table reads "$30.00 + $5 for each additional foot or fraction", which has no flat amount to band and is unreachable behind the 16 ft superload trigger; it is recorded in TENNESSEE_OVER_16FT_WIDTH_FEE.',
  ),
];

/**
 * THE TON-MILE RATE. `ratePerMileUsd` x `miles` x `increments` is exactly six
 * cents per ton-mile, with the increment set to a ton and counted above the
 * lawful weight.
 *
 * `roundIncrementUp: true` — a part ton charged in full. UNPUBLISHED, assumed,
 * and flagged: see `TENNESSEE_PARTIAL_INCREMENT_UNKNOWN` and
 * `tn-ton-mile-partial-increment-unknown`, which sends every overweight Tennessee
 * quote to review.
 *
 * `roundMilesUpTo` DELIBERATELY ABSENT rather than set to 1 — Virginia's rule.
 * Tennessee says "per ton-mile" and stops; a `Math.ceil` on the mileage would add
 * up to one full ton-mile per ton to every quote on the authority of nothing.
 *
 * `addAfterUsd` IS NOT USED, and that is the whole point of the decomposition
 * above: the $20 in (h)(3) is the SAME $20 as in (h)(1)(A) and (h)(2), so it
 * lives in `permitBaseFeeUsd` where a legal-size overweight permit can reach it.
 * Putting it here as well would have double-charged every combined move.
 *
 * NO MINIMUM AND NO MAXIMUM: Tennessee publishes neither, and § 55-7-205(h)(3)
 * states no upper weight bound either — the schedule simply runs into the
 * superload class at 165,000 lb, where the engine stops pricing.
 */
const overweightPerMile: Sourced<PerMileRate>[] = [
  fromStatute<PerMileRate>(
    {
      minLbs: 80001,
      maxLbs: null,
      ratePerMileUsd: 0.06,
      perIncrementLbs: 2000,
      excessBaseLbs: TENNESSEE_EXCESS_BASE_INFERENCE_LBS,
      roundIncrementUp: true,
      minimumUsd: null,
      maximumUsd: null,
    },
    TCA_55_7_205,
    '§ 55-7-205(h)(3): "Excessive weight: Twenty dollars ($20.00) plus six cents (6¢) per ton-mile;" — the $20 is carried by permitBaseFeeUsd and the six cents is this rate. Tenn. Comp. R. & Regs. 1680-07-01-.24(3)(a) states the same charge. The 2,000 lb increment is the ton; the 80,000 lb base is OUR CONSTRUCTION from TDOT\'s published permitting baseline and from § 55-7-205(n)(5)(E)(i), which counts its own ton-miles on "all weight in excess of" a stated figure — the statute itself does not say which tons. On the interstate system the lawful weight is the lesser of 80,000 lb and the federal bridge formula, so a short-wheelbase load is under-billed by this base.',
  ),
  fromUndatedPage<PerMileRate>(
    {
      minLbs: 80001,
      maxLbs: null,
      ratePerMileUsd: 0.06,
      perIncrementLbs: 2000,
      excessBaseLbs: TENNESSEE_EXCESS_BASE_INFERENCE_LBS,
      roundIncrementUp: true,
      minimumUsd: null,
      maximumUsd: null,
    },
    TDOT_FEES,
    'TDOT Permit Prices prints the same charge as "Excess Weight" / ".06/ton mile" over "20.00+" — the two-column extraction separates the "20.00+" from its row, and it is the same $20 base the statute states. The agency table publishes no upper weight bound for this rate either.',
  ),
];

export const TENNESSEE_OSOW_RULES: JurisdictionOsowRules = {
  code: 'TN',
  name: 'Tennessee',
  country: 'US',

  legalLimits: {
    /**
     * 102 INCHES (8 FT 6 IN) — THE DESIGNATED-SYSTEM FIGURE, AND A READING.
     * § 55-7-202(a)(1) says 8 ft generally; (c) and (d) allow 8 ft 6 in on the
     * interstate system, on designated federal-aid highways and on the federal
     * and state highway system, and TDOT publishes 8'6" as the legal width.
     * Recording 8 ft would put an over-width permit on every ordinary 102-inch
     * trailer in the state — the trap Kentucky and Colorado both avoided. The
     * 8 ft figure is stated on the quote by `tn-width-over-96-off-designated-highways`.
     */
    widthIn: [
      fromStatute(
        102,
        TCA_55_7_202,
        '§ 55-7-202(c): "Motor vehicles not exceeding eight feet six inches (8′ 6″) in width are permitted to operate over the interstate system and other federal-aid highways designated by the commissioner." INCLUSIVE. § 55-7-202(d) states the same 8 ft 6 in for the federal and state highway system: "whose width, including any part of the load, does not exceed eight feet six inches (8′ 6″) (that is, four feet three inches (4′ 3″) on each side of the center line of the vehicle)". § 55-7-202(a)(1) sets 8 ft as the general limit and is carried as an advisory rather than recorded here.',
      ),
      fromUndatedPage(
        102,
        TDOT_FAQ,
        'TDOT OS/OW FAQ, under "What are the legal dimensions in Tennessee?": "Width 8\'6”".',
      ),
    ],
    heightIn: [
      fromStatute(
        ftIn(13, 6),
        TCA_55_7_202,
        '§ 55-7-202: no vehicle "whose height, including any part of the load, exceeds thirteen and one-half feet (13½′), shall be operated on any highway". EXCLUSIVE — exactly 13 ft 6 in is legal, and § 55-7-202(d) reaffirms it from the other side as "does not exceed thirteen feet six inches (13′ 6″)".',
      ),
      fromUndatedPage(
        ftIn(13, 6),
        TDOT_FAQ,
        'TDOT OS/OW FAQ: "Height 13\'6”".',
      ),
    ],
    /**
     * 52 FT, THE TOWED-VEHICLE FIGURE. Tennessee regulates a truck-tractor and
     * semitrailer by the trailer and states no overall cap for that combination,
     * which is why the trailer limit is recorded and the overall one is not.
     */
    trailerLengthIn: [
      fromStatute(
        ftIn(52),
        TCA_55_7_201,
        '§ 55-7-201(c): "provided, that the towed vehicle shall not exceed fifty-two feet (52′) in length from the point of attachment to the tractor." INCLUSIVE. TDOT\'s FAQ separately publishes "Truck Tractor & Semi Trailer 50\' from kingpin to rear of trailer", which is a DIFFERENT measurement — kingpin to the rear of the trailer, not the towed vehicle\'s length and not the kingpin-to-rearmost-axle distance — and is not recorded as a competing value for either field.',
      ),
    ],
    /**
     * 41 FT KPRA, AND IT IS CONDITIONAL — the Virginia case exactly. Tennessee
     * imposes it only on a towed vehicle over 48 ft that is not carrying
     * livestock, motor vehicle parts or motor vehicles. OPTIONAL and silent: a
     * caller that supplies no kingpin distance is priced exactly as it would be
     * if this row did not exist.
     */
    kingpinToRearAxleIn: [
      fromStatute(
        ftIn(41),
        TCA_55_7_201,
        '§ 55-7-201(c): "If the towed vehicle exceeds forty-eight feet (48′) in length from the point of attachment to the tractor and the load on the vehicle does not consist of livestock, motor vehicle parts, or motor vehicles, or any combination of such items, the distance between the kingpin and a point midway between the two (2) rear axles shall not exceed forty-one feet (41′)." INCLUSIVE, and CONDITIONAL: it binds only a towed vehicle over 48 ft carrying something other than livestock, motor vehicle parts or motor vehicles. This engine applies it whenever a kingpin distance is supplied, which over-states the limit for a trailer of 48 ft or less and for the exempt commodities; a load caught by it on those facts should be confirmed with the TDOT Permit Office.',
      ),
    ],
    /**
     * `overallLengthIn` IS DELIBERATELY ABSENT, NOT EMPTY — the Kentucky and
     * Arkansas treatment. § 55-7-201(b)'s 65 ft governs a truck drawing another
     * vehicle and § 55-7-201(f)'s 75 ft governs single-length logs, poles or
     * timber; § 55-7-201(c) regulates a truck-tractor and semitrailer by the
     * towed vehicle and caps no overall length at all. Recording a flat 65 ft
     * would flag every ordinary tractor and trailer — about 70 ft over the
     * bumpers — as over-length on every Tennessee lane. Both figures are stated
     * on the quote by `tn-length-over-65-truck-and-trailer`, and the length
     * ESCORT thresholds at 90 ft and 120 ft still read the supplied overall
     * length directly.
     *
     * `frontOverhangIn` and `rearOverhangIn` are absent for a stronger reason:
     * Tennessee publishes NO numeric legal overhang at all. Its overhang rules
     * are lighting rules, and the finding is recorded by
     * `tn-overhang-no-escort-trigger`. An empty list would report a gap in our
     * research where the state has simply not written the rule.
     */
    grossWeightLbs: [
      fromStatute(
        80000,
        TCA_55_7_203,
        '§ 55-7-203(b)(3): "The total gross weight of a vehicle, freight motor vehicle, truck-tractor, trailer or semitrailer or combinations of these vehicles operated over, on or upon the public highways of this state shall not exceed eighty thousand pounds (80,000 lbs.)". INCLUSIVE. The same subdivision adds that on the interstate system the total gross weight "shall not exceed the lesser of eighty thousand pounds (80,000 lbs.) or the weight produced by application of" the federal bridge formula, which is implemented in bridgeFormula.ts; the 80,000 lb figure is the flat cap and is what a quote without axle positions can test.',
      ),
      fromUndatedPage(
        80000,
        TDOT_FAQ,
        'TDOT OS/OW FAQ: "Gross Weight 80,000 pounds Single Axle 20,000 pounds Tandem Axle 34,000 pounds" — the same figure TDOT publishes as the permitting baseline, which is why it is also the base the ton-mile excess is counted over.',
      ),
    ],
    singleAxleLbs: [
      fromStatute(
        20000,
        TCA_55_7_203,
        '§ 55-7-203(b)(1)(A): "No axle shall carry a load in excess of twenty thousand pounds (20,000 lbs.)." EXCLUSIVE.',
      ),
      fromUndatedPage(20000, TDOT_FAQ, 'TDOT OS/OW FAQ: "Single Axle 20,000 pounds".'),
    ],
    tandemAxleLbs: [
      fromStatute(
        34000,
        TCA_55_7_203,
        '§ 55-7-203(b)(2): "The total gross weight concentrated on the highway surface from any tandem axle group shall not exceed thirty-four thousand pounds (34,000 lbs.) for each tandem axle group." INCLUSIVE, with the group defined by a spacing of more than 40 in and not more than 96 in.',
      ),
      fromUndatedPage(34000, TDOT_FAQ, 'TDOT OS/OW FAQ: "Tandem Axle 34,000 pounds".'),
    ],
  },

  /**
   * $20 — THE SAME TWENTY DOLLARS THE SCHEDULE REACHES FROM EVERY SIDE.
   * § 55-7-205(h)(1)(A) for a width up to 14 ft, (h)(2) for excessive height or
   * length, and (h)(3) as the base of the excessive-weight charge. Held here
   * rather than folded into the bands so that a LEGAL-SIZE overweight permit —
   * which matches no dimensional band by construction — still carries it. That is
   * Indiana's decomposition and it exists for exactly the same reason.
   */
  permitBaseFeeUsd: [
    fromStatute(
      20,
      TCA_55_7_205,
      '§ 55-7-205(h): "(1)(A) Not more than fourteen feet (14′), twenty dollars ($20.00)"; "(2) Excessive height or length: Twenty dollars ($20.00)"; "(3) Excessive weight: Twenty dollars ($20.00) plus six cents (6¢) per ton-mile;". One figure reached from three directions, which is why it is the base rather than a band.',
    ),
    fromUndatedPage(
      20,
      TDOT_FEES,
      'TDOT Permit Prices prints $20.00 as the first width step, as "Excess Length", as "Excess Height" and as the "20.00+" that precedes the ".06/ton mile" on the Excess Weight row.',
    ),
  ],

  oversizeFeeBands,

  /**
   * NO `combinedFeeRule`, which means CUMULATIVE — and here that is base plus
   * width increment plus ton-mile charge, not two whole fees added together. See
   * `TENNESSEE_SINGLE_BASE_FEE_READING` for the reading that makes those the same
   * thing, and `tn-single-base-fee-reading` for how it is stated on the quote.
   */

  overweightPricing: [
    fromStatute<OverweightPricing>(
      {
        kind: 'perMile',
        explanation:
          'Tenn. Code Ann. § 55-7-205(h)(3) prices the overweight permit at "Twenty dollars ($20.00) plus six cents (6¢) per ton-mile" — a charge that is the PRODUCT of the excess weight and the distance travelled inside the state, not a step by either. It is encoded as a per-mile rate whose increment is a ton, because six cents per ton-mile and six cents per mile for each ton over the lawful weight are the same arithmetic. The statute states no upper weight bound; above 165,000 lb the movement is super heavy and TDOT prices it after an engineering review.',
      },
      TCA_55_7_205,
    ),
    fromUndatedPage<OverweightPricing>(
      {
        kind: 'perMile',
        explanation:
          'TDOT\'s published fee table prices excess weight as ".06/ton mile" over a "20.00+" base, with no weight bracket and no flat alternative anywhere in the single-trip column. The bridge evaluation rows below it are a separate charge that begins at 165,000 lb.',
      },
      TDOT_FEES,
    ),
  ],

  /**
   * EMPTY, AND IT MEANS SOMETHING. `overweightPricing` records that Tennessee
   * prices the overweight component per ton-mile, so there is no weight ladder to
   * hold — not a schedule we failed to source. The bridge evaluation charges ARE
   * banded by weight, and they are not here either: every band sits above the
   * superload threshold where no line is priced, and the top one is "actual cost"
   * rather than an amount. See `TENNESSEE_BRIDGE_EVALUATION_FEES`.
   */
  overweightBands: [],

  overweightPerMile,

  /**
   * EMPTY. Tennessee attaches no flat fee to a weight threshold on a single-trip
   * permit. The bridge evaluation charge is the only candidate and it is banded,
   * partly unquantified and entirely above the superload gate — Arkansas's
   * reasoning for its own $500 supplement, three times over.
   */
  conditionalFees: [],

  /**
   * EMPTY, AND EMPHATICALLY NOT A SOURCED ZERO. 1680-07-01-.24(7)(b) states that
   * a credit-card payment is "subject to a transaction surcharge" — so the charge
   * exists — and neither the administrative code nor the FAQ publishes the
   * percentage. Recording a zero would turn "Tennessee does not publish the rate"
   * into "Tennessee charges nothing", which is the confident wrong number this
   * engine exists to refuse. The engine therefore says on every Tennessee quote
   * that no transaction cost is on file, and `tn-card-surcharge-rate-unpublished`
   * says why. Arkansas's and Louisiana's treatment.
   */
  transactionFee: [],

  /**
   * BOTH EMPTY, AND NOT AS SOURCED ZEROS. Tennessee REQUIRES a route survey over
   * 15 ft 6 in high or 16 ft wide and does not perform it — the applicant submits
   * the official form and private surveyors do the work at market rates — so
   * there is no state review fee to record. It publishes no no-bridge-route
   * discount of any kind. Kentucky's and Colorado's treatment; the bridge
   * evaluation charges that DO exist are weight-banded superload charges and are
   * held in `TENNESSEE_BRIDGE_EVALUATION_FEES`.
   */
  routeAnalysisFeeUsd: [],
  noBridgeRouteFeeUsd: [],

  superload: {
    /**
     * 165,000 LB, EXCLUSIVE — A REAL CLASS RATHER THAN A FEE TRIGGER, WHICH IS
     * THE DISTINCTION FLORIDA'S 300,000 LB FAILED.
     *
     * TDOT's FAQ answers "What is considered a Superload? Gross Vehicle Weight in
     * excess of 165,000 pounds", and the same answer reproduces Rule
     * 1680-07-01-.12(1): "'super heavy' means that the total gross weight of the
     * vehicle and load exceeds 165,000 pounds". Above it a movement needs an
     * engineering analysis by the Structures Division, a route survey, a traffic
     * control plan, a 5-to-30-day processing window and daylight-only travel.
     *
     * IT IS SAFE TO MIRROR IN THE WIDGET, and Florida's failure cannot occur
     * here: § 55-7-205(h)(3)'s ton-mile rate has NO upper weight bound, so the
     * server prices every pound below the threshold that the client accepts.
     * Florida's 300,000 lb was a structural-evaluation trigger sitting far above
     * a per-mile schedule that stopped at 162,000 lb — a client that accepted a
     * load the server could not reach.
     *
     * THE 165,000 LB RATE CHANGE IS A DIFFERENT FACT FROM THIS CEILING. The 12¢
     * tier above it belongs to heavy-duty towing secondary movements under
     * § 55-7-205(n)(5)(E)(i) and the bridge evaluation charge to § 55-7-205(h)(4);
     * both are rate and fee boundaries for products this engine does not price,
     * and neither is what makes 165,000 lb the ceiling. The superload CLASS is.
     */
    grossWeight: [
      fromUndatedPage<Threshold>(
        { value: 165000, inclusive: false },
        TDOT_FAQ,
        'TDOT OS/OW FAQ: "What is considered a Superload? Gross Vehicle Weight in excess of 165,000 pounds". EXCLUSIVE — exactly 165,000 lb is still an ordinary permit. The same answer reproduces Rule 1680-07-01-.12(1): "For the purposes of this rule, \'super heavy\' means that the total gross weight of the vehicle and load exceeds 165,000 pounds". That rule was not separately opened and no URL has been invented for it; the FAQ is the document on file that carries the text.',
      ),
    ],
    /** Tennessee publishes no axle-spacing superload trigger. */
    shortSpacing: [],
    /**
     * THE DIMENSIONAL TRIGGERS, WHICH TENNESSEE CALLS "EXTRA-OVERDIMENSIONAL".
     * Both are published as superload criteria in the same FAQ answer and in the
     * same rule definition, and both sit below fee bands this file records but
     * does not reach — the over-16-ft width step in particular. That is the
     * correct behaviour and not an oversight: 1680-07-01-.06(5) makes a movement
     * over 16 ft wide discretionary and survey-gated, so a published $5-a-foot
     * step is not an over-the-counter price.
     */
    widthIn: [
      fromUndatedPage<Threshold>(
        { value: ftIn(16), inclusive: false },
        TDOT_FAQ,
        'TDOT OS/OW FAQ: "Width in excess of 16\'". EXCLUSIVE. Rule 1680-07-01-.12(1), as reproduced in the same answer: "\'extra-overdimensional\' means that the width of the vehicle and load exceeds sixteen feet (16\')".',
      ),
    ],
    heightIn: [
      fromUndatedPage<Threshold>(
        { value: ftIn(15, 6), inclusive: false },
        TDOT_FAQ,
        'TDOT OS/OW FAQ: "Height in excess of 15\'6”". EXCLUSIVE. Rule 1680-07-01-.12(1): "\'extra-overdimensional\' means that ... the height of the vehicle and load exceeds fifteen feet six inches (15\'6")".',
      ),
    ],
  },

  /**
   * THE ROUTE-SURVEY TRIGGER, AND THE HEIGHT ROW IS A GENUINE CONFLICT LEFT
   * UNRESOLVED ON PURPOSE.
   *
   * § 55-7-205(p) says an applicant "is not required, as a condition for the
   * issuance or renewal of the permit, to complete or submit a route survey of
   * the proposed route of travel unless the height of the vehicle and load
   * exceeds fifteen feet six inches (15′6″)", and TDOT's FAQ says the same.
   * Rule 1680-07-01-.10(1)(c) requires one "If the height of the movement is
   * fifteen feet (15') or more".
   *
   * THE RESEARCH STATES THAT THE STATUTE EXPLICITLY OVERRULES THE RULE, AND BOTH
   * ARE STILL RECORDED. That reading is almost certainly right, and "almost
   * certainly" is not this engine's standard for deleting a source: the rule is
   * live text in a chapter TDOT still publishes, and adopting one side here would
   * be us adjudicating a question the mechanism exists to surface. `resolveSourced`
   * returns null for the pair and the engine raises it ONLY for a load whose
   * height lands between 15 ft and 15 ft 6 in — the Texas 18'11"-versus-19'0"
   * pattern. A 12 ft load never hears about it.
   *
   * The WIDTH row is single-valued and clean. The LENGTH list is EMPTY because
   * Tennessee publishes no length route-survey trigger at all — the Kentucky and
   * Colorado treatment for a step a state has not defined, rather than borrowing
   * one from the escort table.
   */
  routeInspection: {
    widthIn: [
      fromUndatedPage<Threshold>(
        { value: ftIn(16), inclusive: false },
        TDOT_FAQ,
        'TDOT OS/OW FAQ: "If the height of the load exceeds 15\'6” and/or the width exceeds 16\' a route survey will be required." EXCLUSIVE. Corroborated by 1680-07-01-.06(5)(a): "A route survey shall be required prior to the issuance of a permit" for movements over 16 ft wide.',
      ),
    ],
    heightIn: [
      fromStatute<Threshold>(
        { value: ftIn(15, 6), inclusive: false },
        TCA_55_7_205,
        '§ 55-7-205(p): an applicant "is not required, as a condition for the issuance or renewal of the permit, to complete or submit a route survey of the proposed route of travel unless the height of the vehicle and load exceeds fifteen feet six inches (15′6″)". EXCLUSIVE, and TDOT\'s FAQ states the same figure. The research reports that this statute explicitly overrules Rule 1680-07-01-.10(1)(c); the rule\'s own figure is still recorded below rather than dropped.',
      ),
      fromDated<Threshold>(
        { value: ftIn(15), inclusive: true },
        RULE_10,
        EFF_RULES,
        '1680-07-01-.10(1)(c) requires a route survey "If the height of the movement is fifteen feet (15\') or more". INCLUSIVE at 15 ft, six inches below the statute. Recorded as a live candidate: the chapter is current and the rule has not been withdrawn, so the disagreement is surfaced for a load between 15 ft and 15 ft 6 in rather than silently resolved in the statute\'s favour.',
      ),
    ],
    lengthIn: [],
  },

  escortRules: TENNESSEE_ESCORT_RULES,

  /**
   * TRUE, AND MORE CONSEQUENTIALLY THAN ANYWHERE ELSE IN THIS DIRECTORY. Every
   * other distance-priced state multiplies a rate by the miles; Tennessee
   * multiplies it by the miles AND by the tons, so billing a whole corridor's
   * mileage to one state would be wrong by the excess weight as well as by the
   * distance. The engine refuses to price the overweight component without
   * in-state miles.
   */
  feesDependOnDistance: true,
};

/** Cited for the escort vehicle standard and the absence of any certification. */
export const TENNESSEE_ESCORT_VEHICLE_SOURCE = RULE_21;

/** Cited for the houseboat rule schedule, the payment methods and the refund rule. */
export const TENNESSEE_FEE_RULE_SOURCE = RULE_24;

/** Cited for the site-built house move and its utility coordination requirement. */
export const TENNESSEE_HOUSE_MOVE_SOURCE = RULE_14;

/** Cited for the holiday restrictions and emergency declarations portal. */
export const TENNESSEE_NEWS_AND_MEMOS_SOURCE = TDOT_NEWS;

/** Cited for the Tennessee Highway Patrol escort rate, its four-hour minimum and its two-officer minimum. */
export const TENNESSEE_POLICE_ESCORT_RATE_SOURCE = TDOT_FAQ;
