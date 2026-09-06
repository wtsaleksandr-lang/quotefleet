/**
 * DISTRICT OF COLUMBIA — oversize/overweight single-trip permit rules.
 *
 * THE SIMPLEST FEE IN THE CORPUS, AND THE SHARPEST ESCORT CONFLICT.
 * ═══════════════════════════════════════════════════════════════════════════
 * DC prices a single-trip OS/OW permit at a FLAT $30.00 one way. Not a band,
 * not a formula, not a per-mile rate, not a function of weight — one number for
 * every load the District will permit at all. Most states in this corpus step
 * the overweight charge by pounds; the District publishes no weight schedule of
 * any kind.
 *
 * THAT IS AN AFFIRMATIVE ABSENCE, NOT A RESEARCH GAP, and the distinction
 * matters because the two look identical in a data file. Both DDOT
 * publications — the 2023 OS/OW FAQ and overweight_vehicles.pdf — were read in
 * full, and both give the same flat schedule and no other. What they publish is
 * $30 one way, $50 round trip, and an $85/yr annual tag for tractor trailers
 * and for truck cranes and concrete pump trucks. There is no per-pound rate to
 * find, so `overweightPricing` and `overweightBands` are empty on a checked
 * negative, recorded in `publishedAbsences` rather than left to look like
 * something nobody looked for.
 *
 * THE QUOTED FIGURE IS THE ONE-WAY $30. A lane crossing the District is priced
 * one way; the $50 is the round trip, and charging it on a through-move would
 * double the District on every quote. The two FAQ rows that read "$30 for a
 * trip being oversized only for entry or exit" and "Single Trip: $30.00 one
 * way" are the SAME fee described twice in two documents, as are the two $50
 * rows — four printed rows, two actual prices.
 *
 * THE ESCORT CONFLICT: TWO DDOT DOCUMENTS, SAME YEAR, FOUR DISAGREEMENTS.
 * ----------------------------------------------------------------------
 * This is the cleanest example in the corpus of the case the conflict mechanism
 * exists for, because neither document supersedes the other and neither is
 * stale:
 *
 *                       OSOWFAQ_2023.pdf        overweight_vehicles.pdf
 *   width               15 ft or more           12 ft or wider
 *   length              (not listed)            75 ft or longer
 *   height              exceeds 14 ft 6 in      exceeding 13 ft 6 in
 *   weight              150,000 lb or more      120,000 or more
 *   modality            "may be required",      "Yes for"
 *                       at MPD's discretion
 *
 * A 13 ft wide load is escorted under one document and not under the other. The
 * spread between 12 ft and 15 ft is not a rounding difference — it is most of
 * the oversize market, and the two readings differ by the entire police escort
 * line on a large fraction of DC moves.
 *
 * AND THE MODALITY DISAGREES TOO, which is worse than the numbers. The FAQ
 * calls 75 ft / 12 ft / 13 ft 6 in / 120,000 lb the point at which a
 * pilot/escort vehicle operator is RECOMMENDED. overweight_vehicles.pdf calls
 * those same four numbers the point at which a police escort is REQUIRED. The
 * same agency, in the same year, prints one set of thresholds as advice and as
 * a mandate.
 *
 * SO NO ESCORT COUNT IS PRICED FOR THE DISTRICT. Every rule below carries
 * `manualReview`, and the reason is stated on the rule rather than buried here.
 * That is not timidity: it is the only honest output, because the trigger is
 * contradicted AND the rate is unpublished. Even where the two documents agree
 * — a 200,000 lb load is over both weight thresholds — the District publishes
 * no police escort rate anywhere on DDOT or MPD, so the requirement resolves
 * and its price does not. Inventing a neighbouring state's hourly rate for the
 * District would be the easiest wrong number here; Maryland's and Virginia's
 * rates are not DC's, and MPD's own answer to the question is an email address
 * (motorcarrier@dc.gov), not a schedule.
 *
 * WIDTH IS 8 FT 6 IN FOR THE VEHICLES THIS ENGINE QUOTES, NOT 8 FT.
 * ----------------------------------------------------------------
 * DCMR 18-2501.1 sets the general width at 8 ft, and .2 and .3 raise it to
 * 8 ft 6 in for buses and for tractor-trailer combinations respectively. Those
 * are not conflicting sources — it is one rule with a vehicle-class exception,
 * and every load this engine prices is a tractor-trailer combination. 102 in is
 * recorded with the exception stated, so a reader does not later "correct" it
 * down to 96 and flag every legal-width truck in the District as oversize.
 *
 * THE 1986 RULEMAKING DATE IS NOT STALENESS.
 * ------------------------------------------
 * DCMR 18-2501 carries "Final Rulemaking published at 33 DCR 3716 (June 20,
 * 1986)" and 18-2500 goes back to 1949. Those are ENACTMENT dates for rules
 * still in force, restated verbatim in DDOT's 2023 FAQ, which is the opposite
 * of the expired-PDF problem: an expired document has been withdrawn, an old
 * regulation has not. The dates are recorded as the documents state them.
 *
 * WHAT IS DELIBERATELY ABSENT
 * ---------------------------
 *   - `superload` — the District defines no superload class at any weight. The
 *     GAO's 2015 fifty-state table lists "District of Columbia | Varies" for
 *     superload height, which is secondary, a decade old, and says nothing.
 *   - `routeInspection` — no route survey or bridge-analysis requirement or
 *     cost is published in either DDOT document.
 *   - `routeVocabulary` — the District publishes no per-class limits. The only
 *     road classification it names is the federal one (Interstate, National
 *     Highway System, National Network), inherited "as mandated by Federal
 *     regulations", and it does not vary a single limit or fee. A single
 *     vocabulary is correct for a 68-square-mile jurisdiction.
 *   - the $1,193.00/yr figure that appears in a search snippet and in NEITHER
 *     opened PDF. It is not recorded anywhere in this file.
 *   - permit validity in days, amendment fee, refund policy, pilot-car operator
 *     certification, height-pole specification — none published. The FAQ's
 *     "allow one week for single haul permits" is PROCESSING LEAD TIME, not
 *     validity, and conflating the two would be a fabricated expiry date.
 */
import type { SourceDoc, Sourced } from '../provenance.js';
import { ftIn, type EscortRule } from '../escortRules.js';
import type {
  CombinedFeeRule,
  FeeDistanceDependence,
  JurisdictionOsowRules,
  PublishedAbsence,
  TransactionFee,
} from '../types.js';

const RETRIEVED = '2026-09-06';

/**
 * Both DDOT PDFs carry 2023 in the filename and no other date anywhere in the
 * body. THE TWO DATE FIELDS THEREFORE DIVERGE, deliberately:
 *
 *   `revisedOn` is the bare year `'2023'`, because a partial date is allowed
 *   there and is the honest record of what the document states. Writing
 *   2023-01-01 into it would claim a precision DDOT never published.
 *
 *   `effectiveFrom` must be a full ISO date, so it is widened to the FIRST day
 *   of that year. That is the conservative direction: the value was in effect
 *   no later than some point in 2023, and January 1 is the earliest instant
 *   consistent with the evidence, so the window never claims the fee took
 *   effect after it actually did. Illinois uses the same widening for its
 *   year-only sources.
 */
const DDOT_REVISED = '2023';
const DDOT_FROM = '2023-01-01';
/** DCMR 18-2501: "Final Rulemaking published at 33 DCR 3716 (June 20, 1986)". */
const DCMR_FROM = '1986-06-20';

// ── Source documents ──────────────────────────────────────────────────────

const DDOT_FAQ: SourceDoc = {
  id: 'dc-ddot-osow-faq-2023',
  title: 'DDOT — Oversize/Overweight Vehicle Permit FAQ',
  url: 'https://ddot.dc.gov/sites/default/files/dc/sites/ddot/publication/attachments/OSOWFAQ_2023.pdf',
  publisher: 'District Department of Transportation',
  revisedOn: DDOT_REVISED,
  retrievedOn: RETRIEVED,
  cite:
    'The document states no revision date in its body; "2023" is taken from the published filename and is recorded as a bare year for that reason.',
};

const DDOT_OVERWEIGHT: SourceDoc = {
  id: 'dc-ddot-overweight-vehicles',
  title: 'DDOT — Overweight Vehicles',
  url: 'https://ddot.dc.gov/sites/default/files/dc/sites/ddot/publication/attachments/overweight_vehicles.pdf',
  publisher: 'District Department of Transportation',
  revisedOn: DDOT_REVISED,
  retrievedOn: RETRIEVED,
  cite:
    'Same publisher and same stated year as the FAQ, and it CONTRADICTS the FAQ on every police-escort threshold. See the module header.',
};

const DCMR_18_2501: SourceDoc = {
  id: 'dc-dcmr-18-2501',
  title: 'DCMR Title 18 § 2501 — Width, Height and Length of Vehicles',
  url: 'https://dcregs.dc.gov/Common/DCMR/RuleList.aspx?ChapterNum=18-25',
  publisher: 'District of Columbia Municipal Regulations',
  revisedOn: DCMR_FROM,
  retrievedOn: RETRIEVED,
  cite:
    '"Final Rulemaking published at 33 DCR 3716 (June 20, 1986)". An enactment date for a rule still in force and restated verbatim in DDOT\'s 2023 FAQ — not a stale document.',
};

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
 * THE CONFLICT, RESTATED ON EVERY RULE THAT FIRES.
 *
 * Repeated rather than cross-referenced because this string is what a
 * dispatcher reads on the quote, and a pointer to a module comment is not an
 * explanation to someone holding a permit application.
 */
const DC_ESCORT_CONFLICT =
  'The District publishes two contradictory police-escort tables. OSOWFAQ_2023.pdf sets the triggers at 15 ft wide, 14 ft 6 in high or 150,000 lb and says an escort "may be required" at MPD\'s discretion; overweight_vehicles.pdf sets them at 12 ft wide, 75 ft long, 13 ft 6 in high or 120,000 lb and says "Yes for". Both are DDOT documents carrying the same year and neither supersedes the other. Separately, NO police escort rate is published anywhere on DDOT or MPD — the District\'s own answer to the question is an email address, motorcarrier@dc.gov. The requirement cannot be resolved and its price does not exist, so no escort count and no escort cost is quoted for the District.';

export const DISTRICT_OF_COLUMBIA_ESCORT_RULES: EscortRule[] = [
  {
    id: 'dc-escort-width-conflict',
    jurisdiction: 'DC',
    description:
      'At or over 12 ft wide — police escort required under overweight_vehicles.pdf, not until 15 ft under the DDOT FAQ, and no rate is published under either.',
    when: { kind: 'gte', measure: 'widthIn', value: ftIn(12) },
    then: { manualReview: DC_ESCORT_CONFLICT },
    source: DDOT_OVERWEIGHT,
    effectiveFrom: DDOT_FROM,
    effectiveTo: null,
  },
  {
    id: 'dc-escort-height-conflict',
    jurisdiction: 'DC',
    description:
      'Over 13 ft 6 in high — police escort required under overweight_vehicles.pdf, not until 14 ft 6 in under the DDOT FAQ, and no rate is published under either.',
    when: { kind: 'gt', measure: 'heightIn', value: ftIn(13, 6) },
    then: { manualReview: DC_ESCORT_CONFLICT },
    source: DDOT_OVERWEIGHT,
    effectiveFrom: DDOT_FROM,
    effectiveTo: null,
  },
  {
    id: 'dc-escort-length-conflict',
    jurisdiction: 'DC',
    description:
      'At or over 75 ft long — police escort required under overweight_vehicles.pdf; the DDOT FAQ publishes no length trigger at all, so this one is unopposed rather than contradicted, and it is still unpriced.',
    when: { kind: 'gte', measure: 'overallLengthIn', value: ftIn(75) },
    then: { manualReview: DC_ESCORT_CONFLICT },
    source: DDOT_OVERWEIGHT,
    effectiveFrom: DDOT_FROM,
    effectiveTo: null,
  },
  {
    id: 'dc-escort-weight-conflict',
    jurisdiction: 'DC',
    description:
      'At or over 120,000 lb — police escort required under overweight_vehicles.pdf, not until 150,000 lb under the DDOT FAQ, and no rate is published under either.',
    when: { kind: 'gte', measure: 'grossWeightLbs', value: 120_000 },
    then: { manualReview: DC_ESCORT_CONFLICT },
    source: DDOT_OVERWEIGHT,
    effectiveFrom: DDOT_FROM,
    effectiveTo: null,
  },
];

export const DISTRICT_OF_COLUMBIA_OSOW_RULES: JurisdictionOsowRules = {
  code: 'DC',
  name: 'District of Columbia',
  country: 'US',

  /**
   * EMPTY ON A CHECKED NEGATIVE. The District varies no limit and no fee by
   * road class. The only classification either document names is the federal
   * one — "Routes that are classified as part of the Interstate, National
   * Highway System and, or, National Network were included in the route system
   * as mandated by Federal regulations" — which is an inherited designation,
   * not a DC vocabulary with DC consequences.
   */
  routeVocabulary: [],

  legalLimits: {
    widthIn: [
      fromDated(
        102,
        DCMR_18_2501,
        DCMR_FROM,
        '§ 2501.3: "Tractor-trailer combinations may have an overall width not to exceed eight feet, six inches (8 ft 6 in)". EXCLUSIVE — DDOT requires a permit for "Any vehicle wider than 8 feet – 6 inches (including load)". NOTE THE VEHICLE-CLASS EXCEPTION rather than a conflict: § 2501.1 sets the general limit at 8 ft and § 2501.2 raises buses to 8 ft 6 in. Every load this engine prices is a tractor-trailer combination, so 102 in is the operative figure; recording 96 would flag every legal-width truck in the District as oversize.',
      ),
      fromDated(
        102,
        DDOT_FAQ,
        DDOT_FROM,
        'DDOT FAQ: a permit is required for "Any vehicle wider than 8 feet – 6 inches (including load)". Corroborates the regulation from the operational document, and confirms the measurement is taken INCLUDING the load.',
      ),
    ],
    heightIn: [
      fromDated(
        ftIn(13, 6),
        DCMR_18_2501,
        DCMR_FROM,
        '§ 2501.5: "No vehicle which is higher than thirteen feet, six inches (13 ft. 6 in.), including the height of any load on that vehicle, shall operate on a public District highway, street, or road." EXCLUSIVE, and measured including the load by the rule\'s own words.',
      ),
      fromDated(
        ftIn(13, 6),
        DDOT_FAQ,
        DDOT_FROM,
        'DDOT FAQ: a permit is required for "A vehicle higher than 13 feet – 6 inches (including load)".',
      ),
    ],
    /**
     * EMPTY ON A CHECKED NEGATIVE, not on a gap. Neither DDOT document and no
     * section of DCMR Title 18 chapter 25 sets a SEMITRAILER length limit. The
     * District regulates length twice and both figures are about the whole
     * vehicle: 40 ft for "any vehicle, other than a bus" (a single unit) and
     * 55 ft for the combination. Recording 40 ft here would read as a trailer
     * cap and would flag every ordinary 48 ft and 53 ft trailer entering the
     * District as over-length on the wrong axis — the real constraint is the
     * 55 ft OVERALL figure below, which those trailers do breach, on a
     * combination basis and for a different reason.
     */
    trailerLengthIn: [],

    /**
     * 55 FT COMBINED IS THE BINDING FIGURE FOR A TRACTOR-SEMITRAILER, and it is
     * unusually short — most states in this corpus permit 65 ft or publish no
     * overall limit at all. An ordinary 53 ft trailer behind a tractor exceeds
     * 55 ft overall, so a very large share of ordinary DC freight needs a
     * permit on LENGTH alone, before any oversize cargo is considered.
     */
    overallLengthIn: [
      fromDated(
        ftIn(55),
        DDOT_FAQ,
        DDOT_FROM,
        'DDOT FAQ: a permit is required for "A vehicle with a combined overall length of over 55 feet". EXCLUSIVE. The FAQ separately requires a permit for "Any vehicle, other than a bus, over 40 feet long" — that 40 ft figure governs a SINGLE vehicle and is not the combination limit; applying it to a tractor-semitrailer would be wrong in the other direction. Buses are permitted to 60 ft and are not priced here.',
      ),
    ],
    grossWeightLbs: [
      fromDated(
        80_000,
        DDOT_OVERWEIGHT,
        DDOT_FROM,
        '"Tractor trailers are allowed 80,000 pounds gross vehicle weight prior to requiring the issuance of a permit." EXCLUSIVE.',
      ),
      fromDated(
        80_000,
        DDOT_FAQ,
        DDOT_FROM,
        'The FAQ requires a permit for "Any vehicle exceeding the District axle and gross weight limitations". The two DDOT documents agree on every weight figure — it is only the ESCORT thresholds they contradict.',
      ),
    ],
    singleAxleLbs: [
      fromDated(
        21_000,
        DDOT_FAQ,
        DDOT_FROM,
        '"Any vehicle exceeding the District axle and gross weight limitations 21,000 for single axle, 34,000 for tandem axle". EXCLUSIVE. NOTE THAT 21,000 lb IS 1,000 lb ABOVE THE FEDERAL 20,000: the District is more permissive on the single axle than most of this corpus, and assuming the federal figure would flag a compliant 20,500 lb steer as overweight.',
      ),
    ],
    tandemAxleLbs: [
      fromDated(
        34_000,
        DDOT_FAQ,
        DDOT_FROM,
        '"34,000 for tandem axle". EXCLUSIVE, and identical to the federal figure.',
      ),
    ],
  },

  /**
   * THE WHOLE FEE, AS A FLAT NUMBER. $30.00 buys a one-way single-trip permit
   * whether the load is oversize, overweight or both — there is no dimension
   * band to add and no weight schedule to add, so this row is not a base with
   * charges on top of it, it is the entire published price.
   *
   * THE ONE-WAY FIGURE IS THE CORRECT ONE FOR A LANE. The $50 is the round
   * trip; a through-move or a delivery is priced one way, and quoting $50 would
   * double the District on every lane that merely crosses it.
   */
  permitBaseFeeUsd: [
    fromDated(
      30,
      DDOT_FAQ,
      DDOT_FROM,
      '"Single Trip: $30.00 one way or $50.00 roundtrip". overweight_vehicles.pdf states the same two prices in different words — "The fee is $30 for a trip being oversized only for entry or exit to the District" and "The fee is $50 when a vehicle\'s land load will be oversized both coming into and exiting the District" — so the four printed rows across the two documents are TWO fees, not four. The District also sells an $85.00/yr annual tag for tractor trailers and for truck cranes and concrete pump trucks; those are annual products and are not a single-trip alternative. A "Dump Truck, Cement Mixer & Trash Truck" annual tag is mentioned in the FAQ with no amount, and no amount is invented for it here.',
    ),
    fromDated(
      30,
      DDOT_OVERWEIGHT,
      DDOT_FROM,
      '"The fee is $30 for a trip being oversized only for entry or exit to the District." The second DDOT document corroborates the single-trip price exactly, which is worth recording given that this same pair of documents contradicts itself on escorts.',
    ),
  ],

  /**
   * EMPTY, AND THE $30 ABOVE IS WHY. There is no dimensional band: the District
   * charges the same $30 at 8 ft 7 in wide and at 15 ft wide.
   */
  oversizeFeeBands: [],

  combinedFeeRule: [
    fromDated<CombinedFeeRule>(
      {
        kind: 'cumulative',
        explanation:
          'Nominally cumulative and practically moot: the District publishes ONE single-trip fee covering oversize, overweight or both, so there are no two buckets to combine. Recorded as cumulative rather than left unset so the arithmetic is explicit — $30 plus an empty oversize band plus an empty overweight schedule is $30 — and so a future editor who adds a DC weight schedule inherits the summing behaviour every other flat-fee state in this corpus already has.',
      },
      DDOT_FAQ,
      DDOT_FROM,
    ),
  ],

  /**
   * EMPTY ON AN AFFIRMATIVE ABSENCE — see `publishedAbsences` below. The
   * District publishes no per-pound rate, no weight bands and no formula.
   */
  overweightPricing: [],
  overweightBands: [],
  overweightPerMile: [],
  conditionalFees: [],

  transactionFee: [
    fromDated<TransactionFee>(
      { perPermitUsd: 0, percentOfTotal: 0 },
      DDOT_FAQ,
      DDOT_FROM,
      'AN AFFIRMATIVE ABSENCE. Neither DDOT document names a service, processing, administrative or percentage charge on top of the permit fee. Contrast Texas, where Transp. Code § 623.076(b-1) authorises $0.25 plus 2.25%. Nothing is added here, so the $30 the shipper sees is the $30 the District charges.',
    ),
  ],

  routeAnalysisFeeUsd: [],
  noBridgeRouteFeeUsd: [],

  /**
   * NO SUPERLOAD CLASS AT ANY WEIGHT. Neither DDOT document defines one, sets a
   * threshold, or prices one. The only fifty-state table that lists the
   * District — GAO's 2015 survey — reads "District of Columbia | Varies" for
   * superload height, which is secondary, a decade old, and is not a number.
   * The heaviest load the District will permit pays the same $30.
   */
  superload: {
    shortSpacing: [],
  },

  /**
   * EMPTY ON ALL THREE AXES. No route survey and no bridge or structural
   * analysis requirement, threshold, performer or cost is published in either
   * DDOT document. In a 68-square-mile jurisdiction with no published
   * engineering review, inventing a threshold would be inventing a fee.
   */
  routeInspection: {
    widthIn: [],
    heightIn: [],
    lengthIn: [],
  },

  escortRules: DISTRICT_OF_COLUMBIA_ESCORT_RULES,
  escortCountCombination: [],

  feeDistanceDependence: [
    fromDated<FeeDistanceDependence>(
      {
        component: 'overweight',
        dependsOnDistance: false,
        quote:
          '"Single Trip: $30.00 one way or $50.00 roundtrip." A flat charge with no mileage term of any kind.',
      },
      DDOT_FAQ,
      DDOT_FROM,
      'The District is the clearest distance-independent jurisdiction in the corpus: it is roughly ten miles across, and its fee does not reference distance even notionally. In-state mileage is not needed to price it, which is why `feesDependOnDistance` is false below.',
    ),
  ],

  publishedAbsences: [
    fromDated<PublishedAbsence>(
      {
        subject: 'partialIncrementRule',
        statement:
          'There is no increment to round. The District publishes no weight-banded fee, no per-pound rate, no per-mile rate and no formula — only the flat $30/$50 single-trip fee and the $85/yr annual tags. Both DDOT publications were read in full and DCMR Title 18 chapter 25 contains no fee schedule.',
        consequence:
          'No rounding rule is held for the District because no computed quantity exists to round. A quote for DC is the published number, exactly.',
      },
      DDOT_FAQ,
      DDOT_FROM,
    ),
    fromDated<PublishedAbsence>(
      {
        subject: 'policeEscortRate',
        statement:
          'No police escort rate — hourly, minimum hours, mileage, per diem or cancellation — is published on DDOT, on MPD, or in either OS/OW document. The FAQ directs the applicant to contact MPD at motorcarrier@dc.gov to find out WHETHER an escort is required, and publishes nothing about what one costs.',
        consequence:
          'No escort cost is quoted for the District at any dimension or weight. Substituting a neighbouring state\'s rate would be inventing a District price out of Maryland or Virginia data.',
      },
      DDOT_FAQ,
      DDOT_FROM,
    ),
    fromDated<PublishedAbsence>(
      {
        subject: 'policeEscortTrigger',
        statement:
          'The trigger is not absent — it is published TWICE, differently, by the same agency in the same year. OSOWFAQ_2023.pdf: 15 ft wide, over 14 ft 6 in high, 150,000 lb or more, "may be required" at MPD discretion. overweight_vehicles.pdf: 12 ft wide, 75 ft long, over 13 ft 6 in high, 120,000 lb or more, "Yes for". Neither document supersedes the other.',
        consequence:
          'Every DC load that crosses the LOWER of the two thresholds goes to manual review rather than being priced against a chosen reading. Picking the higher thresholds would under-quote escorts on loads between 12 and 15 ft wide; picking the lower would over-quote them; both would present a settled answer the District has not given.',
      },
      DDOT_OVERWEIGHT,
      DDOT_FROM,
    ),
    fromDated<PublishedAbsence>(
      {
        subject: 'superloadDefinition',
        statement:
          'Neither DDOT document defines a superload, sets a superload threshold, or describes an escalated process above any weight, width or height.',
        consequence:
          'No DC load is flagged as a superload and no superload ceiling is mirrored to the public calculator.',
      },
      DDOT_FAQ,
      DDOT_FROM,
    ),
    fromDated<PublishedAbsence>(
      {
        subject: 'roadClassification',
        statement:
          'The District publishes no permit route classes and no per-class limits. The only classification named is the inherited federal one — "Interstate, National Highway System and, or, National Network ... as mandated by Federal regulations" — and it changes no limit and no fee.',
        consequence:
          'A single route vocabulary applies District-wide, so no DC quote depends on naming a road class.',
      },
      DDOT_FAQ,
      DDOT_FROM,
    ),
  ],

  feesDependOnDistance: false,
};
