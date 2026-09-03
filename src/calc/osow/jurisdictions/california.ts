/**
 * CALIFORNIA — oversize/overweight single-trip permit rules.
 *
 * The state that does not fit the shape of any other state in this directory,
 * and the reason `RouteClass` grew five members. Four things about California
 * are genuinely different, and every one of them is a chance to ship a
 * confident wrong number:
 *
 * 1. THE ESCORT TABLE IS KEYED ON A COLOUR, NOT ON A ROAD TYPE. Caltrans
 *    classifies every state highway SEGMENT on its Single Trip Pilot Car Maps
 *    as yellow, green, blue, brown or red, and each colour carries its own
 *    width thresholds and its own length threshold. A 13 ft wide load needs no
 *    pilot car on yellow, one on green or blue, and two on brown. The colour is
 *    a property of the ROUTE, read off the district map or the permit face
 *    (item 36) — not of the load, and not derivable from lane count. It is
 *    encoded through the AST's `routeClass` condition with five new members;
 *    see `RouteClass` in `escortRules.ts` for why extending beat flattening.
 *    A California quote with no colour on it evaluates the width rules to
 *    `unknown` and goes to review, which is the honest answer: without the
 *    segment colour, Caltrans's own table cannot say how many pilot cars the
 *    move needs.
 *
 * 2. CALIFORNIA DOES NOT WANT A HEIGHT POLE. "Height poles will not be a
 *    Caltrans requirement." Every other jurisdiction in this directory requires
 *    one somewhere between 14 ft 5 in and 17 ft; California requires one
 *    nowhere and makes overhead clearance the permittee's own duty. A generic
 *    "overheight ⇒ pole car" assumption would bill a California customer for a
 *    service the state does not ask for, so the absence is recorded as an
 *    explicit advisory rather than left to inference.
 *
 * 3. THE FEE IS $16. Flat. Not banded by width, not banded by weight, not per
 *    mile, not per axle — 21 CCR §1411.3(a) sets one single-trip fee and the
 *    permitted weights are governed by the Extralegal Weight Charts instead of
 *    by a fee schedule. So `oversizeFeeBands` is absent and the overweight
 *    component is `includedInBaseFee`, both as positive findings.
 *
 * 4. AND THEN THERE IS THE $50 AN HOUR. §1411.3(b) charges a special service
 *    charge of $50.00 per hour of Caltrans engineering, routing and
 *    coordination time for any load over 14 ft wide or over 135 ft long (and
 *    for several axle configurations). The HOURS are not published and cannot
 *    be — they depend on how many districts, structures and lane closures the
 *    route touches. That is not a fee we can estimate low; it is a fee that
 *    makes the permit genuinely unquotable in advance, so those loads go to
 *    manual review with the mechanism named. Note the trap: the $50/hr trigger
 *    (over 14 ft wide) is LOWER than the variance-permit trigger (over 15 ft
 *    wide). A load 14 ft 6 in wide is an ordinary permit that still carries an
 *    open-ended hourly charge.
 *
 * 5. THE SEMITRAILER IS REGULATED BY KINGPIN, NOT BY LENGTH — and that is why
 *    California used to send EVERY quote to a human. CVC §35400(b)(4) publishes
 *    no semitrailer length limit at all; it exempts the semitrailer from the
 *    40 ft single-vehicle cap whenever its kingpin-to-rearmost-axle distance is
 *    within limits. With nowhere to record a kingpin distance, `trailerLengthIn`
 *    was an empty list, the engine correctly reported a gap, and the gap fired
 *    on every California load however completely it was specified.
 *
 *    `kingpinToRearAxleIn` now carries the real limit — 40 ft, from the statute
 *    and from Caltrans's own page — and a load that supplies a KPRA is checked
 *    against the rule California actually writes instead of being asked for a
 *    number the state does not publish. A load that does NOT supply one is
 *    treated exactly as before: the length gap stands and the quote goes to
 *    review. The measurement is optional and only ever buys a better answer.
 *
 * WHERE FEE FACTS LIVE IN THE ESCORT LIST. Items 2 and 4 above, and several of
 * California's recorded unknowns, are conditioned on the load's dimensions but
 * are not escort counts. `EscortRule` is the only dimension-conditioned
 * predicate the data model has, and `EscortOutcome` carries `manualReview` and
 * `advisory` precisely so a real rule that resists becoming a number can still
 * reach the quote. Putting them there is a deliberate modelling choice, not an
 * accident: the alternative was inventing an engine mechanism, and every rule
 * that lives there is labelled in its own description.
 *
 * SOURCE-QUALITY CAVEAT: leginfo.legislature.ca.gov (the official statute host)
 * blocks automated fetching, so Vehicle Code text comes from Justia and
 * FindLaw, and 21 CCR §1411.3 from Cornell LII. All three reproduce official
 * text but are SECONDARY publishers, and each is marked in its title.
 *
 * DATE WARNING, PROMINENTLY: the fee rule is 33 years old (operative
 * 1993-02-15), the pilot-car table's route-class definitions are 36 years old
 * (Appendix 19, 1990-02-23), and the pilot-car special conditions are from 2005.
 * All three are still the documents Caltrans links today and all three carry
 * their real dates below. None of them has been backfilled with the retrieval
 * date.
 */
import type { SourceDoc, Sourced } from '../provenance.js';
import { ftIn, type EscortRule } from '../escortRules.js';
import type {
  JurisdictionOsowRules,
  OverweightPricing,
  Threshold,
  TransactionFee,
} from '../types.js';

const RETRIEVED = '2026-09-02';

// ── Source documents ──────────────────────────────────────────────────────

const CCR_1411_3: SourceDoc = {
  id: 'ca-21-ccr-1411-3',
  title: '21 Cal. Code Regs. §1411.3 (via Cornell LII — SECONDARY source)',
  url: 'https://www.law.cornell.edu/regulations/california/21-CCR-1411.3',
  publisher: 'Cornell Legal Information Institute, reproducing 21 CCR',
  revisedOn: '1993-02-15',
  retrievedOn: RETRIEVED,
  cite: '§1411.3(a) permit fees; (b)–(d) the $50/hour special service charge; subsection (a) amended filed 1-12-93, operative 2-15-93 (Register 93, No. 3)',
};
const EFF_1411_3 = '1993-02-15';

const CALTRANS_SINGLE_TRIP: SourceDoc = {
  id: 'caltrans-single-trip-application',
  title: 'Caltrans — Apply for a Single Trip Permit',
  url: 'https://dot.ca.gov/programs/traffic-operations/transportation-permits/application-single-trip',
  publisher: 'California Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: '"Single trip permits are $16 for each trip completed."',
};

const CALTRANS_FAQ: SourceDoc = {
  id: 'caltrans-permits-faq',
  title: 'Caltrans — Transportation Permits FAQ',
  url: 'https://dot.ca.gov/programs/traffic-operations/transportation-permits/faq',
  publisher: 'California Department of Transportation',
  // The page prints "Last Updated 5/2026". It is an editorial stamp, not a
  // render stamp — it differs from the date we fetched the page — so it is
  // recorded as the document's own revision, which is what it claims to be.
  revisedOn: '2026-05-01',
  retrievedOn: RETRIEVED,
  cite: 'Q2 fee table; Q7 CHP scheduling; Q11 permitted axle maxima; Q14 variance processing and the >17 ft route survey',
};
const EFF_FAQ = '2026-05-01';

const CALTRANS_PERMITS_HOME: SourceDoc = {
  id: 'caltrans-transportation-permits-home',
  title: 'Caltrans — Transportation Permits',
  url: 'https://dot.ca.gov/programs/traffic-operations/transportation-permits',
  publisher: 'California Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: '"Variance Permit - vehicles greater than 15\'-0" wide, 17\'-0" high, and 135\'-0" long"',
};

const CALTRANS_HEIGHT: SourceDoc = {
  id: 'caltrans-legal-height',
  title: 'Caltrans — Legal Truck Access: Height (CVC §35250)',
  url: 'https://dot.ca.gov/programs/traffic-operations/legal-truck-access/height',
  publisher: 'California Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
};

const CALTRANS_LENGTHS: SourceDoc = {
  id: 'caltrans-legal-lengths',
  title: 'Caltrans — Legal Truck Access: Vehicle Lengths (CVC §§35400–35401)',
  url: 'https://dot.ca.gov/programs/traffic-operations/legal-truck-access/vehicle-lengths',
  publisher: 'California Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: '§35400(b)(4) KPRA 40 ft / 38 ft; §35401.5(a)(1) STAA semitrailer 48 ft in exclusive combination and 53 ft with the KPRA condition; §35401(e)–(f) and §35401.1 on local restriction of KPRA to no less than 38 ft',
};

/**
 * THE STATUTE THAT REGULATES A CALIFORNIA SEMITRAILER — BY KINGPIN, NOT LENGTH.
 *
 * leginfo.legislature.ca.gov blocks automated fetching (see the module header),
 * so the text comes from Public.Law, the same secondary publisher already used
 * for §35550. FindLaw's reproduction of (b)(4) was checked against it and is
 * word-for-word identical, which is the closest thing to verification available
 * without the official host.
 *
 * NO AMENDMENT HISTORY LINE IS PRINTED on either reproduction, so `revisedOn`
 * is null rather than backfilled. What the section DOES date is the figure
 * itself: §35400(c) says the Legislature increased "the maximum permissible
 * kingpin to rearmost axle distance to 40 feet effective January 1, 1987", and
 * that operative date is what `effectiveFrom` carries.
 */
const CVC_35400: SourceDoc = {
  id: 'ca-cvc-35400',
  title: 'Cal. Veh. Code §35400 (via Public.Law — SECONDARY source)',
  url: 'https://california.public.law/codes/vehicle_code_section_35400',
  publisher: 'Public.Law, reproducing the California Vehicle Code',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: '§35400(a) 40 ft single-vehicle cap; §35400(b)(4) the kingpin-to-rearmost-axle exemption; §35400(c) "effective January 1, 1987"',
};
/** §35400(c)'s own stated operative date for the 40 ft KPRA figure. */
const EFF_KPRA = '1987-01-01';

const CALTRANS_WEIGHT: SourceDoc = {
  id: 'caltrans-legal-weight',
  title: 'Caltrans — Legal Truck Access: Weight Limitation (CVC §§35550–35558)',
  url: 'https://dot.ca.gov/programs/traffic-operations/legal-truck-access/weight-limitation',
  publisher: 'California Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
};

const CVC_35100: SourceDoc = {
  id: 'ca-cvc-35100',
  title: 'Cal. Veh. Code §35100 (via Justia — SECONDARY source)',
  url: 'https://law.justia.com/codes/california/code-veh/division-15/chapter-2/section-35100/',
  publisher: 'Justia, reproducing the California Vehicle Code',
  revisedOn: '1988-09-28',
  retrievedOn: RETRIEVED,
  cite: '"The total outside width of any vehicle or its load shall not exceed 102 inches"; Stats. 1988, Ch. 1452',
};

const CVC_35550: SourceDoc = {
  id: 'ca-cvc-35550',
  title: 'Cal. Veh. Code §35550 (via California Public Law — SECONDARY source)',
  url: 'https://california.public.law/codes/vehicle_code_section_35550',
  publisher: 'Public.Law, reproducing the California Vehicle Code',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: '"any one axle of a vehicle shall not exceed 20,000 pounds"',
};

const CTPS_CARD: SourceDoc = {
  id: 'caltrans-ctps-credit-card-2025-04',
  title: 'Caltrans — CTPS Credit Card Payment Instructions (PDF)',
  url: 'https://dot.ca.gov/-/media/dot-media/programs/traffic-operations/documents/transportation-permits/stars2/20250416-ctps-credit-card-payment-instructions-a11y.pdf',
  publisher: 'California Department of Transportation',
  revisedOn: '2025-04-16',
  retrievedOn: RETRIEVED,
  cite: '"there is a 2.3% charge for all transactions"',
};

const PCMAP_LEGEND: SourceDoc = {
  id: 'caltrans-pilot-car-map-legend-2021-06',
  title: 'Caltrans — Single Trip Pilot Car Map Legend, June 2021 (PDF)',
  url: 'https://dot.ca.gov/-/media/dot-media/programs/traffic-operations/documents/transportation-permits/pilot-car-maps/single-trip/2021-cvo-pcmap-single-trip-legend-a11y.pdf',
  publisher: 'California Department of Transportation',
  revisedOn: '2021-06-01',
  retrievedOn: RETRIEVED,
  cite: 'pilot-car table by route colour; CHP escort table; Note 1 ("Until width exceeds 15\' 0", the maximum number of pilot cars is one"); Note 2',
};
const EFF_LEGEND = '2021-06-01';

const APPENDIX_19: SourceDoc = {
  id: 'caltrans-tpm-appendix-19-1990',
  title: 'Caltrans Transportation Permits Manual, Appendix 19 (PDF, 1990)',
  url: 'https://dot.ca.gov/-/media/dot-media/programs/traffic-operations/documents/transportation-permits/tpm/f0018179-19900223-appendix19.pdf',
  publisher: 'California Department of Transportation',
  revisedOn: '1990-02-23',
  retrievedOn: RETRIEVED,
  cite: '"Height poles will not be a Caltrans requirement."; route-colour definitions',
};
const EFF_APPENDIX_19 = '1990-02-23';

const SC_PILOTCAR: SourceDoc = {
  id: 'caltrans-special-conditions-pilot-car-2005-09',
  title: 'Caltrans — Special Conditions for Pilot Cars (PDF, September 2005)',
  url: 'https://dot.ca.gov/-/media/dot-media/programs/traffic-operations/documents/transportation-permits/application-forms-accompaniments/f0018341-sc-pilotcar.pdf',
  publisher: 'California Department of Transportation',
  revisedOn: '2005-09-01',
  retrievedOn: RETRIEVED,
  cite: '"The pilot car follows the escorted vehicle on conventional highways having four or more lanes"',
};
const EFF_SC_PILOTCAR = '2005-09-01';

const PERMIT_CONDITIONS: SourceDoc = {
  id: 'caltrans-permit-conditions-2025-12',
  title: 'Caltrans — Transportation Permit Conditions, December 2025 (PDF)',
  url: 'https://dot.ca.gov/-/media/dot-media/programs/traffic-operations/documents/transportation-permits/application-forms-accompaniments/2025-cvo-transporation-permit-conditions-a11y.pdf',
  publisher: 'California Department of Transportation',
  revisedOn: '2025-12-01',
  retrievedOn: RETRIEVED,
  cite: 'item 6 (permittee checks clearances); item 18 (over-10 ft curfews); item 19 (warning signs)',
};
const EFF_PERMIT_CONDITIONS = '2025-12-01';

const CVC_35795: SourceDoc = {
  id: 'ca-cvc-35795',
  title: 'Cal. Veh. Code §35795 (via FindLaw — SECONDARY source)',
  url: 'https://codes.findlaw.com/ca/vehicle-code/veh-sect-35795',
  publisher: 'FindLaw, reproducing the California Vehicle Code',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: '§35795(a)(3): special services "may be billed separately for each permit"; §35795(b): local fees capped at the state fee',
};

const CVC_35252: SourceDoc = {
  id: 'ca-cvc-35252',
  title: 'Cal. Veh. Code §35252 (via Justia — SECONDARY source)',
  url: 'https://law.justia.com/codes/california/code-veh/division-15/chapter-3/section-35252/',
  publisher: 'Justia, reproducing the California Vehicle Code',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'vertical clearance measuring device: permitted equipment, not a required one',
};

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * A row from an UNDATED page. `effectiveFrom` is the retrieval date, because
 * that is the only date on which we can prove the page said this.
 */
function fromUndatedPage<T>(
  value: T,
  source: SourceDoc,
  note?: string,
): Sourced<T> {
  return {
    value,
    source,
    effectiveFrom: RETRIEVED,
    effectiveTo: null,
    ...(note === undefined ? {} : { note }),
  };
}

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

function escortRule(
  id: string,
  description: string,
  when: EscortRule['when'],
  then: EscortRule['then'],
  source: SourceDoc = PCMAP_LEGEND,
  effectiveFrom: string = EFF_LEGEND,
): EscortRule {
  return {
    id,
    jurisdiction: 'CA',
    description,
    when,
    then,
    source,
    effectiveFrom,
    effectiveTo: null,
  };
}

// ── Escort rules ──────────────────────────────────────────────────────────

/** `min < width <= max`, the way the legend's ">12'–13'" cells read. */
function widthBand(min: number, max: number): EscortRule['when'] {
  return {
    kind: 'between',
    measure: 'widthIn',
    min,
    max,
    minInclusive: false,
    maxInclusive: true,
  };
}

function onColour(
  colour: 'ca-yellow' | 'ca-green' | 'ca-blue' | 'ca-brown',
  width: EscortRule['when'],
): EscortRule['when'] {
  return { kind: 'all', of: [{ kind: 'routeClass', anyOf: [colour] }, width] };
}

/**
 * California's pilot cars, one colour at a time.
 *
 * The four colours genuinely disagree with each other. At 13 ft wide: yellow
 * wants one pilot car, green wants one, blue wants one, brown wants two. At
 * 14 ft 6 in: yellow one, green two, blue two, brown two. At 15 ft 6 in:
 * yellow two, and everything else has escalated to CHP. Collapsing them onto
 * "divided vs two-lane" would have thrown away two feet of width and 35 feet of
 * length between green and brown, both of which are two-lane roads.
 *
 * POSITION comes from the September 2005 Special Conditions, not from the
 * legend: one pilot car LEADS on two- or three-lane conventional roads (brown,
 * blue, green) and FOLLOWS on conventional highways with four or more lanes,
 * divided highways and freeways (yellow). Two pilot cars are one leading and
 * one following. The rear-overhang pilot car always follows.
 */
export const CALIFORNIA_ESCORT_RULES: EscortRule[] = [
  // ── YELLOW: multilane freeways and expressways ─────────────────────────
  escortRule(
    'ca-yellow-width-over-12-to-15',
    'Yellow route (multilane freeway/expressway), over 12 ft up to 15 ft wide — one pilot car, following',
    onColour('ca-yellow', widthBand(ftIn(12), ftIn(15))),
    { escorts: 1, rear: 1 },
  ),
  escortRule(
    'ca-yellow-width-over-15-to-16',
    'Yellow route, over 15 ft up to 16 ft wide — two pilot cars, one leading and one following',
    onColour('ca-yellow', widthBand(ftIn(15), ftIn(16))),
    { escorts: 2, front: 1, rear: 1 },
  ),

  // ── GREEN: two-lane, 12 ft lanes, shoulder 4 ft or wider ───────────────
  escortRule(
    'ca-green-width-over-12-to-14',
    'Green route (two-lane, 12 ft lanes with a 4 ft or wider shoulder), over 12 ft up to 14 ft wide — one pilot car, leading',
    onColour('ca-green', widthBand(ftIn(12), ftIn(14))),
    { escorts: 1, front: 1 },
  ),
  escortRule(
    'ca-green-width-over-14-to-15',
    'Green route, over 14 ft up to 15 ft wide — two pilot cars, one leading and one following',
    onColour('ca-green', widthBand(ftIn(14), ftIn(15))),
    { escorts: 2, front: 1, rear: 1 },
  ),

  // ── BLUE: two-lane with a 0–4 ft shoulder, or multilane substandard ─────
  escortRule(
    'ca-blue-width-over-11-to-13',
    'Blue route (two-lane, 12 ft lanes with a 0–4 ft shoulder, or multilane with substandard lanes), over 11 ft up to 13 ft wide — one pilot car, leading',
    onColour('ca-blue', widthBand(ftIn(11), ftIn(13))),
    { escorts: 1, front: 1 },
  ),
  escortRule(
    'ca-blue-width-over-13-to-15',
    'Blue route, over 13 ft up to 15 ft wide — two pilot cars, one leading and one following',
    onColour('ca-blue', widthBand(ftIn(13), ftIn(15))),
    { escorts: 2, front: 1, rear: 1 },
  ),

  // ── BROWN: two-lane with 11 ft or 10 ft lanes ──────────────────────────
  escortRule(
    'ca-brown-width-over-10-to-12',
    'Brown route (two-lane with 11 ft or 10 ft lanes), over 10 ft up to 12 ft wide — one pilot car, leading',
    onColour('ca-brown', widthBand(ftIn(10), ftIn(12))),
    { escorts: 1, front: 1 },
  ),
  escortRule(
    'ca-brown-width-over-12-to-15',
    'Brown route, over 12 ft up to 15 ft wide — two pilot cars, one leading and one following',
    onColour('ca-brown', widthBand(ftIn(12), ftIn(15))),
    { escorts: 2, front: 1, rear: 1 },
  ),

  /**
   * NOTE 1 CONTRADICTS THE TABLE IT IS PRINTED ON, AND THIS IS OUR READING.
   *
   * The June 2021 legend carries the note "Until width exceeds 15' 0", the
   * maximum number of pilot cars is one" directly beside a table whose green
   * row asks for two pilot cars from over 14 ft, whose blue row asks for two
   * from over 13 ft, and whose brown row asks for two from over 12 ft. Read
   * literally, the note caps every one of those cells at one pilot car — a
   * difference of a whole vehicle, on the most common permitted widths there
   * are.
   *
   * INFERENCE FLAG: that the note and the table contradict each other is OUR
   * reading of one document, not something Caltrans says. The source dataset
   * transcribed both without reconciling them. We do not pick. The table's
   * count stands (it is the higher, and quoting the cheaper reading would
   * under-bill), and this rule fires in exactly the disputed band on exactly
   * the three colours it affects, forcing the move to review with both
   * readings stated. Yellow is untouched: its two-pilot cell begins above
   * 15 ft, where the note no longer applies.
   */
  escortRule(
    'ca-note1-conflicts-with-table',
    'Two pilot cars are required by the table at this width, but the legend’s own Note 1 caps the count at one below 15 ft',
    {
      kind: 'any',
      of: [
        onColour('ca-green', widthBand(ftIn(14), ftIn(15))),
        onColour('ca-blue', widthBand(ftIn(13), ftIn(15))),
        onColour('ca-brown', widthBand(ftIn(12), ftIn(15))),
      ],
    },
    {
      manualReview:
        'The June 2021 Single Trip Pilot Car Map Legend contradicts itself for this load. Its table asks for two pilot cars at this width on this route colour, while Note 1 on the same page reads "Until width exceeds 15\' 0", the maximum number of pilot cars is one". Both readings are official and neither has been adopted here: the quote carries the table\'s two-vehicle count because it is the higher of the two, and the pilot-car count must be confirmed with the Caltrans district permit office before it is billed.',
    },
  ),

  // ── Length, by colour ──────────────────────────────────────────────────
  escortRule(
    'ca-yellow-green-length-over-120',
    'Yellow or green route, over 120 ft long — one pilot car',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: ['ca-yellow', 'ca-green'] },
        { kind: 'gt', measure: 'overallLengthIn', value: ftIn(120) },
      ],
    },
    { escorts: 1 },
  ),
  escortRule(
    'ca-blue-length-over-100',
    'Blue route, over 100 ft long — one pilot car',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: ['ca-blue'] },
        { kind: 'gt', measure: 'overallLengthIn', value: ftIn(100) },
      ],
    },
    { escorts: 1 },
  ),
  escortRule(
    'ca-brown-length-over-85',
    'Brown route, over 85 ft long — one pilot car',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: ['ca-brown'] },
        { kind: 'gt', measure: 'overallLengthIn', value: ftIn(85) },
      ],
    },
    { escorts: 1 },
  ),

  /** Overhang is the one trigger that is the same on every colour. */
  escortRule(
    'ca-rear-overhang-over-25',
    'Rear overhang over 25 ft — one pilot car, following, on every route colour',
    { kind: 'gt', measure: 'rearOverhangIn', value: ftIn(25) },
    { escorts: 1, rear: 1 },
    SC_PILOTCAR,
    EFF_SC_PILOTCAR,
  ),

  /**
   * RED ROUTES are not a threshold at all — they are an operational
   * restriction whose terms live in the Red Route Summary Table on
   * calroute.dot.ca.gov, which is not in the sources on file. A red segment
   * cannot be priced from this dataset and says so.
   */
  escortRule(
    'ca-red-route-restricted',
    'Red route — movement is restricted and governed by the Red Route Summary Table',
    { kind: 'routeClass', anyOf: ['ca-red'] },
    {
      manualReview:
        'Caltrans classifies this segment red, which is an operational restriction rather than a pilot-car count. The governing terms are in the Red Route Summary Table on calroute.dot.ca.gov, which is not held in this dataset, so neither the escort requirement nor the feasibility of the move can be determined here.',
    },
  ),

  // ── CHP (law enforcement) ──────────────────────────────────────────────
  /**
   * The legend's width column stops being a pilot-car count and becomes "CHP"
   * at 16 ft on yellow and 15 ft everywhere else, and the separate CHP Escort
   * Table on the same page agrees. Neither document states how many CHP units
   * are required or where they ride, and no CHP hourly or per-mile rate exists
   * in chp.ca.gov, dot.ca.gov or 21 CCR — the only hourly figure California
   * publishes is the $50 Caltrans staff rate in §1411.3(c)(4), which is a
   * different agency and a different service. So no police count and no police
   * cost is asserted; the requirement is recorded and the move goes to review.
   */
  escortRule(
    'ca-chp-escort-required',
    'CHP escort required — over 16 ft wide on yellow, over 15 ft wide on green/blue/brown, over 185 ft long on yellow/green, over 135 ft long on blue/brown, or 17 ft or higher on blue/brown',
    {
      kind: 'any',
      of: [
        {
          kind: 'all',
          of: [
            { kind: 'routeClass', anyOf: ['ca-yellow'] },
            {
              kind: 'any',
              of: [
                { kind: 'gt', measure: 'widthIn', value: ftIn(16) },
                { kind: 'gt', measure: 'overallLengthIn', value: ftIn(185) },
              ],
            },
          ],
        },
        {
          kind: 'all',
          of: [
            { kind: 'routeClass', anyOf: ['ca-green'] },
            {
              kind: 'any',
              of: [
                { kind: 'gt', measure: 'widthIn', value: ftIn(15) },
                { kind: 'gt', measure: 'overallLengthIn', value: ftIn(185) },
              ],
            },
          ],
        },
        {
          kind: 'all',
          of: [
            { kind: 'routeClass', anyOf: ['ca-blue', 'ca-brown'] },
            {
              kind: 'any',
              of: [
                { kind: 'gt', measure: 'widthIn', value: ftIn(15) },
                { kind: 'gt', measure: 'overallLengthIn', value: ftIn(135) },
                { kind: 'gte', measure: 'heightIn', value: ftIn(17) },
              ],
            },
          ],
        },
      ],
    },
    {
      manualReview:
        'California requires a CHP escort for this move. Neither the pilot-car legend nor the CHP escort table states how many CHP units are required or where they ride, and no CHP hourly or per-mile escort rate is published by chp.ca.gov, dot.ca.gov or 21 CCR — the $50 per hour figure in 21 CCR §1411.3(c)(4) is for Caltrans traffic-operations staff, not for the Highway Patrol. The permittee schedules the escort directly with CHP (FAQ Q7). No police-escort amount is included in the permit total and none can be estimated from published sources.',
    },
  ),
  escortRule(
    'ca-chp-operational-triggers',
    'CHP escort is also required whenever opposing lanes are used or the load slows while crossing a structure',
    {
      kind: 'any',
      of: [
        {
          kind: 'subjective',
          key: 'ca-uses-opposing-lanes',
          question: 'will the move use opposing lanes at any point on the route?',
        },
        {
          kind: 'subjective',
          key: 'ca-slows-crossing-structure',
          question: 'will the load slow while crossing any structure on the route?',
        },
      ],
    },
    {
      manualReview:
        'A CHP escort is required on any route colour when opposing lanes are used or when the load slows while crossing a structure. Whether this move does either is a routing judgement no dimension answers, so it must be settled with the Caltrans district permit office and CHP.',
    },
  ),

  // ── The $50-an-hour charge that makes a permit unquotable ──────────────
  /**
   * NOT AN ESCORT RULE — A FEE RULE, carried here because `EscortRule` is the
   * only dimension-conditioned predicate in the data model and `manualReview`
   * is the outcome built for a real rule that cannot become a number. See the
   * module header.
   */
  escortRule(
    'ca-special-service-charge',
    'Over 14 ft wide or over 135 ft long — Caltrans bills a $50.00 per hour special service charge whose hours are not knowable in advance',
    {
      kind: 'any',
      of: [
        { kind: 'gt', measure: 'widthIn', value: ftIn(14) },
        { kind: 'gt', measure: 'overallLengthIn', value: ftIn(135) },
      ],
    },
    {
      manualReview:
        '21 CCR §1411.3(b) adds a special service charge of $50.00 for each hour Caltrans expends on this permit — engineering investigations, definition of routing, coordination with CHP and adjacent jurisdictions, and control of the movement — for any load over 14 ft wide or over 135 ft long. The hours are summed across HQ Permits, HQ Structures, the district permit office and district maintenance and traffic, and rounded to the nearest whole hour; they depend on how many districts, structures and lane closures the route touches and are not published anywhere. The $16 permit fee below is therefore NOT the price of this permit, and no total is quoted. Note that this charge begins at 14 ft of width, a foot BELOW the 15 ft variance-permit line — an ordinary permit can carry it.',
    },
    CCR_1411_3,
    EFF_1411_3,
  ),
  escortRule(
    'ca-special-service-axle-configurations',
    'Heavy or side-by-side configurations also draw the $50 per hour charge, and the configuration is not collected on a quote',
    { kind: 'gt', measure: 'grossWeightLbs', value: 80000 },
    {
      advisory:
        '21 CCR §1411.3(b)(3) also applies the $50 per hour special service charge to a load needing more than a 13-axle single-width combination, to a 13-axle single-width combination whose load-deck inner bordering axles are 40 ft or more apart, and to two or more vehicles travelling side by side with a combined width of 14 ft or more. A quote does not collect the axle layout or whether the move is side by side, so this charge is not included and cannot be ruled out for an overweight California move.',
    },
    CCR_1411_3,
    EFF_1411_3,
  ),

  // ── California does NOT want a height pole ─────────────────────────────
  /**
   * The opposite of every other jurisdiction in this directory, and worth
   * saying out loud on the quote: a customer moving an overheight load through
   * Texas, Pennsylvania, New York, Virginia or North Carolina pays for a pole
   * car, and in California pays for nothing of the kind.
   */
  escortRule(
    'ca-no-height-pole-required',
    'California does not require a height pole at any height — overhead clearance is the permittee’s own responsibility',
    { kind: 'gt', measure: 'heightIn', value: ftIn(14) },
    {
      advisory:
        'California requires NO height pole, at any height: the Transportation Permits Manual states "Height poles will not be a Caltrans requirement." A permittee may request a pilot car with a clearance device, and CVC §35252 sets what that device must do if one is used, but it is a permittee request rather than a state requirement, and the June 2021 pilot-car legend has no height column at all. What California does require instead (Permit Conditions, December 2025, item 6) is that the permittee check every underpass, wire and overhead structure on the route. No height-pole cost is included in this quote because California does not ask for one — do not carry a pole-car line across from another state.',
    },
    APPENDIX_19,
    EFF_APPENDIX_19,
  ),

  // ── Route survey, curfews and the other stated exclusions ─────────────
  escortRule(
    'ca-route-survey-over-17-high',
    'Over 17 ft high — the applicant must supply a written route survey',
    { kind: 'gt', measure: 'heightIn', value: ftIn(17) },
    {
      routeSurvey: true,
      advisory:
        'Caltrans requires a WRITTEN ROUTE SURVEY from the applicant for any load over 17 ft high (FAQ Q14). The survey is performed and paid for by the applicant — Caltrans publishes no survey fee — so its cost is not a state charge and is not in the permit total. Caltrans\'s own routing and engineering time on the same move is the separate $50 per hour charge.',
    },
    CALTRANS_FAQ,
    EFF_FAQ,
  ),
  escortRule(
    'ca-width-curfews',
    'Over 10 ft wide — weekday curfews apply in the Los Angeles, Sacramento, San Diego and San Francisco areas',
    { kind: 'gt', measure: 'widthIn', value: ftIn(10) },
    {
      advisory:
        'Transportation Permit Conditions (December 2025, item 18): "loads and/or vehicles over 10 feet in width are not authorized Monday through Friday" during the posted hours in the Los Angeles, Sacramento, San Diego and San Francisco curfew map areas. The hours are on the individual curfew maps and are not held here. This is a scheduling restriction, not a cost, but it can decide whether a delivery window is achievable. Item 19 additionally requires warning signs for a load over 8 ft 6 in wide, 80 ft or more long, or with more than 10 ft of overhang.',
    },
    PERMIT_CONDITIONS,
    EFF_PERMIT_CONDITIONS,
  ),
  escortRule(
    'ca-kpra-dashed-routes',
    'A pilot car is also required on dashed routes when the kingpin-to-rear-axle distance exceeds 38 ft, and which segments are dashed is a property of the district map',
    { kind: 'gt', measure: 'widthIn', value: 102 },
    {
      advisory:
        'The June 2021 legend adds a pilot car on DASHED routes whenever the kingpin-to-rear-axle distance exceeds 38 ft 0 in. KPRA can now be supplied on a quote and is checked against California\'s 40 ft statutory limit, but the dashed segments are a property of the district map and are not held here, so this extra pilot car can neither be applied nor ruled out even when the KPRA is known. California also has no pilot-car operator certification programme — CVC §§28100–28103 regulate escort equipment only — so no certification cost arises, and any pilot-car price is the operator\'s market rate rather than a state fee.',
    },
    PCMAP_LEGEND,
    EFF_LEGEND,
  ),

  /**
   * THE TWO WAYS CALIFORNIA'S 40 FT KPRA IS REALLY 38 FT.
   *
   * Stated as an advisory rather than modelled, because both turn on facts a
   * quote does not carry — the trailer's axle count, and whether a particular
   * city or county has exercised its power to restrict. Conditioning a rule on
   * the KPRA measure itself would read `unknown` on every quote that does not
   * supply one and would put a warning and an undecided rule on loads that were
   * clean before this measure existed, which is precisely the regression the
   * optional-measure design exists to avoid. The trigger is therefore the same
   * over-width condition its sibling rule uses, and the outcome is an advisory:
   * the price stands and the exclusion is stated.
   */
  escortRule(
    'ca-kpra-38-ft-cases',
    'California’s 40 ft kingpin limit drops to 38 ft for a single-axle semitrailer, and a city or county may restrict it to 38 ft on its own highways',
    { kind: 'gt', measure: 'widthIn', value: 102 },
    {
      advisory:
        'The 40 ft kingpin-to-rearmost-axle limit used here is CVC §35400(b)(4)\'s figure for a semitrailer "having two or more axles". A SINGLE-AXLE semitrailer is limited to 38 feet, and a quote does not collect the trailer\'s axle count, so a single-axle trailer between 38 ft and 40 ft of KPRA is over the limit and will not be detected here. Separately, the 40 ft figure is a state maximum that local authorities may cut: CVC §35401(e) lets "Any city or county ... restrict the kingpin to rearmost axle distance to 38 feet, but not less" on highways under its jurisdiction, §35401(f) lets Caltrans recommend the same restriction on certain highways, and §35401.1 provides that a combination with a KPRA of 38 to 40 feet "may be operated on local highways only where it is deemed to be safe". None of those local restrictions is held here, so a KPRA between 38 ft and 40 ft is quoted as legal on the state highway system and must be checked against the actual route.',
    },
    CALTRANS_LENGTHS,
    RETRIEVED,
  ),
];

// ── The jurisdiction ──────────────────────────────────────────────────────

export const CALIFORNIA_OSOW_RULES: JurisdictionOsowRules = {
  code: 'CA',
  name: 'California',
  country: 'US',

  legalLimits: {
    widthIn: [
      fromDated(102, CVC_35100, '1988-09-28', 'CVC §35100; Caltrans permit pages express the same figure as 8 ft 6 in.'),
    ],
    heightIn: [
      fromUndatedPage(
        ftIn(14),
        CALTRANS_HEIGHT,
        'CVC §35250: "No vehicle or load shall exceed a height of 14 feet." A double-deck bus may reach 14 ft 3 in, and a load over 13 ft 6 in may travel only on routes the owner has determined are safe — neither is modelled, because a quote does not collect the body style and the route determination is the owner\'s.',
      ),
    ],
    /**
     * STILL EMPTY, AND STILL ON PURPOSE. California publishes no semitrailer
     * LENGTH limit. CVC §35400(a) caps a vehicle at 40 ft, and §35400(b)(4)
     * then EXCLUDES a semitrailer in a tractor-semitrailer combination from
     * that cap whenever its kingpin-to-rearmost-axle distance is within limits.
     * California regulates the trailer by KPRA, which is exactly why a
     * California-legal 53 ft trailer exists and is ordinary.
     *
     * Recording the 40 ft figure here would flag every standard 53 ft trailer
     * in the state as over-length and attach a permit and a fee to a legal
     * load — a confident wrong number. Recording 53 ft would be inventing a
     * limit for the network the load is not necessarily on: 53 ft is the
     * §35401.5(a)(1) cap for STAA vehicles on the National Network and Terminal
     * Access routes, and 23 CFR 658.13 preempts a state overall-length cap
     * there, while a California Legal (non-STAA) route has no semitrailer
     * length cap at all — the binding constraint off the network is the 65 ft
     * combination limit in §35401(a). A quote does not know which network the
     * route uses.
     *
     * WHAT CHANGED IS THE OTHER HALF. The gap this empty list reports is real
     * until the caller supplies the measurement California actually regulates
     * on. `kingpinToRearAxleIn` below now carries that limit, and when a KPRA
     * is on the load the engine withdraws this warning instead of demanding a
     * trailer length the state does not publish. With no KPRA, nothing here
     * changes: the gap stands and the quote still goes to review.
     */
    trailerLengthIn: [],
    /**
     * 40 FEET, AND IT IS THE ONLY SEMITRAILER NUMBER CALIFORNIA PUBLISHES.
     *
     * Two independent sources, one statutory and one the agency's own, and they
     * agree — so they corroborate rather than conflict and the resolver returns
     * a clean 40 ft.
     *
     * BOUNDARY: "does not exceed 40 feet" is INCLUSIVE of 40 ft 0 in. A KPRA of
     * exactly 480 in is legal; 481 in is not. `overLimit` compares with `>`,
     * which is that reading.
     *
     * THE 38 FT CASE IS NOT RECORDED AS A SECOND ROW, and that is deliberate.
     * §35400(b)(4)'s 38 ft figure is for a SINGLE-AXLE semitrailer, not a
     * competing limit on the same vehicle — putting it in this list would read
     * as two sources disagreeing about one number and would refuse to price a
     * load that is unambiguously fine. A quote does not collect the trailer's
     * axle count, so the ordinary two-or-more-axle figure is used and the
     * single-axle case is stated in `ca-kpra-38-ft-cases` below. Same treatment,
     * for the same reason, as §35551.5's alternate axle table.
     */
    kingpinToRearAxleIn: [
      fromDated(
        ftIn(40),
        CVC_35400,
        EFF_KPRA,
        'CVC §35400(b)(4): "A semitrailer while being towed by a motortruck or truck tractor, if the distance from the kingpin to the rearmost axle of the semitrailer does not exceed 40 feet for semitrailers having two or more axles, or 38 feet for semitrailers having one axle." The 40 ft figure is the two-or-more-axle case, which is the ordinary tractor-semitrailer. §35400(c) records the date: the Legislature increased "the maximum permissible kingpin to rearmost axle distance to 40 feet effective January 1, 1987" and added that it "does not intend this action to be considered a precedent for any future increases in truck size and length limitations".',
      ),
      fromUndatedPage(
        ftIn(40),
        CALTRANS_LENGTHS,
        'Caltrans states the same 40 ft figure for BOTH networks, which is why this is one row and not two: on California Legal routes "the kingpin-to-rearmost-axle (KPRA) distance of the semitrailer does not exceed 40 feet for semitrailers having two or more axles, or 38 feet for semitrailers having one axle", and on STAA routes (National Network and Terminal Access) §35401.5(a)(1) reads "The semitrailer is not more than 53 feet in length, with two or more rear axles and a maximum 40\' KPRA, or with a single axle and a maximum 38-foot KPRA." The KPRA threshold does not vary by network; the semitrailer LENGTH cap does, which is why `trailerLengthIn` stays empty.',
      ),
    ],
    /**
     * `overallLengthIn` is ABSENT rather than empty. CVC §35401(a) caps a
     * combination at 65 ft and §35401(b)(1) at 75 ft for a tractor and two
     * trailers neither over 28 ft 6 in — but STAA vehicles are exempt on the
     * National Network and Terminal Access routes, which is where freight
     * runs, and 23 CFR 658.13 preempts a state overall-length cap there.
     * Applying 65 ft would put every ordinary tractor-semitrailer over the
     * legal limit in California. Absent means "California does not cap the
     * overall combination length on the network these quotes are priced for",
     * which is a different and quieter claim than "we looked and found
     * nothing".
     *
     * Overhang limits are absent for the ordinary reason: California publishes
     * none, and what it does publish about overhang (the 25 ft pilot-car
     * trigger, the 10 ft warning-sign trigger) is in the escort rules above.
     */
    grossWeightLbs: [
      fromUndatedPage(
        80000,
        CALTRANS_WEIGHT,
        'CVC §35551 table: "Vehicle Combination | 80,000 pounds". 80,000 lb is the maximum the table REACHES — at 45 ft of axle spacing on six axles, 51 ft on five, or 57 ft on four — not a flat allowance at any spacing. The federal bridge formula is checked separately in `bridgeFormula.ts`.',
      ),
    ],
    singleAxleLbs: [
      fromUndatedPage(20000, CALTRANS_WEIGHT, 'CVC §35550(a); 10,500 lb per wheel-end.'),
      fromUndatedPage(
        20000,
        CVC_35550,
        'CVC §35550(a): "any one axle of a vehicle shall not exceed 20,000 pounds". §35551.5 offers an ALTERNATE table capping a single axle at 18,000 lb and the steering axle at 12,500 lb for combinations that elect it; the election is not collected on a quote, so the standard table is used and the alternative is recorded here.',
      ),
    ],
    tandemAxleLbs: [
      fromUndatedPage(
        34000,
        CALTRANS_WEIGHT,
        'CVC §35551(a) table, the row for an axle group with less than 8 ft 6 in between outer axles. §35551(b) allows two consecutive tandems at 34,000 lb each when they are 36 ft or more apart, combined not over 68,000 lb.',
      ),
    ],
  },

  /**
   * $16. That is the whole state permit fee, for any single trip, at any width,
   * at any weight. 21 CCR §1411.3(a) publishes one figure and Caltrans's own
   * application page and FAQ repeat it, so three rows corroborate rather than
   * conflict. An annual or repetitive permit is $90 and a Direct Crossing
   * permit is free; neither is a single trip and neither is priced here.
   */
  permitBaseFeeUsd: [
    fromDated(
      16,
      CCR_1411_3,
      EFF_1411_3,
      '"Single trip permit or rider ... $16.00 / Annual permit ... $90.00". Statutory authority CVC §35795. Note that the single-trip fee is charged even if the move is cancelled (TPPM 2002-07R).',
    ),
    fromUndatedPage(16, CALTRANS_SINGLE_TRIP, '"Single trip permits are $16 for each trip completed." Valid for 7 consecutive days.'),
    fromDated(16, CALTRANS_FAQ, EFF_FAQ, 'FAQ Q2 fee table: Single Trip $16 (7 consecutive days), Annual $90 (1 year), Repetitive $90 (max 90 days).'),
  ],

  /**
   * ABSENT, as a finding. California has no dimension-banded oversize schedule
   * to record — §1411.3(a) is one line and Caltrans publishes no width, height
   * or length fee steps anywhere. An empty array would have read as a research
   * gap and pushed every oversize California quote to review over a schedule
   * the state does not have.
   */

  /**
   * INCLUDED IN THE BASE FEE, and stated by the regulation rather than inferred
   * from an empty band list. §1411.3(a) charges one single-trip fee regardless
   * of weight; what a permit will ALLOW by weight is set by the Extralegal
   * Weight Charts (Orange/Green/Purple plus Bonus, Plates 25-3/25-4/25-5), not
   * by a fee schedule. So an overweight California permit costs $16, the same
   * as an oversize one, and the same as one that is both.
   */
  overweightPricing: [
    fromDated<OverweightPricing>(
      {
        kind: 'includedInBaseFee',
        explanation:
          '21 CCR §1411.3(a) sets a single flat single-trip fee with no weight bands, no per-mile component and no per-axle component. California governs permitted weights through the Caltrans Extralegal Weight Charts rather than through the fee schedule, so an overweight permit costs the same $16 as any other single trip.',
      },
      CCR_1411_3,
      EFF_1411_3,
    ),
    fromDated<OverweightPricing>(
      {
        kind: 'includedInBaseFee',
        explanation:
          'The Caltrans FAQ fee table lists one single-trip price and no weight-dependent row. FAQ Q11 gives the permitted axle maxima — single axle 20,000 lb generally and never over 30,000 lb, tandem up to 46,725 / 58,406 / 60,000 lb by spacing, tyres and width, tridem 51,450 / 52,500 lb — as ALLOWANCES, not as fee steps.',
      },
      CALTRANS_FAQ,
      EFF_FAQ,
    ),
  ],

  overweightBands: [],
  overweightPerMile: [],
  conditionalFees: [],

  /**
   * 2.3% on the card transaction, and no flat component — the mirror image of
   * Pennsylvania, which charges $1.00 flat and no percentage. `applyTransaction
   * Fee` computes (16 + 0) × 1.023, which is $16.37 all-in for an ordinary
   * California single trip.
   *
   * RECORDED UNKNOWN: whether the 2.3% also applies to special-service charges
   * billed separately under §1411.3(b) is not stated anywhere, and the answer
   * only matters for a load already in manual review over those hours. The
   * surcharge is also not charged at all on a cheque, money order or billing
   * account — which the CTPS instructions imply but do not state, so it is
   * recorded as an implication rather than a rule.
   */
  transactionFee: [
    fromDated<TransactionFee>(
      { perPermitUsd: 0, percentOfTotal: 2.3 },
      CTPS_CARD,
      '2025-04-16',
      '"there is a 2.3% charge for all transactions", processed through the Elavon hosted payment page. It applies to card payments; the instructions describe it under "Credit Card selected as the Payment Method" and do not state that a cheque or billing-account payment avoids it, so that is an implication and not a recorded rule. Payment is due within 6 business hours of conditional approval for a single trip.',
    ),
  ],

  /**
   * EMPTY, and that is the finding. California charges no flat review fee for a
   * route or bridge analysis: HQ Structures bridge analysis is billed inside
   * the $50 per hour special service charge in §1411.3(b), which has no
   * published ceiling and no published typical duration. Recording any amount
   * here would put a number on the one part of a California variance that
   * genuinely has none. The `ca-special-service-charge` rule carries the
   * mechanism instead.
   */
  routeAnalysisFeeUsd: [],
  noBridgeRouteFeeUsd: [],

  superload: {
    /**
     * ABSENT, as a positive finding — and the reason California is deliberately
     * missing from the widget's weight-ceiling mirror. California publishes NO
     * numeric gross-weight superload threshold. A weight superload is defined
     * by HAULING CONFIGURATION instead: §1411.3(b)(3) reaches loads needing
     * more than a 13-axle single-width combination, 13-axle combinations whose
     * load-deck inner bordering axles are 40 ft or more apart, and side-by-side
     * moves 14 ft or wider combined. There is no pound figure to hold, so the
     * federal 80,000 lb contact-us ceiling stands for California lanes.
     */
    shortSpacing: [],
    widthIn: [
      fromUndatedPage<Threshold>(
        { value: ftIn(15), inclusive: false },
        CALTRANS_PERMITS_HOME,
        '"Variance Permit - vehicles greater than 15\'-0" wide, 17\'-0" high, and 135\'-0" long". A variance is applied for at least 30 days ahead, addressed to the Variance Coordinator, with inspection reports, manufacturer\'s engineering justification and a drawing of the item.',
      ),
    ],
    heightIn: [
      fromUndatedPage<Threshold>({ value: ftIn(17), inclusive: false }, CALTRANS_PERMITS_HOME),
    ],
    overallLengthIn: [
      fromUndatedPage<Threshold>({ value: ftIn(135), inclusive: false }, CALTRANS_PERMITS_HOME),
    ],
  },

  /**
   * California's only published route-survey trigger is on HEIGHT, and the
   * survey is the applicant's to perform and pay for. No width or length
   * survey trigger is published, so those lists are empty rather than guessed —
   * and an empty list here is silent by design, because inventing a width
   * trigger would send loads to an inspection California never asked for.
   */
  routeInspection: {
    widthIn: [],
    heightIn: [
      fromDated<Threshold>(
        { value: ftIn(17), inclusive: false },
        CALTRANS_FAQ,
        EFF_FAQ,
        'FAQ Q14: "Written route surveys are required from the applicant for heights greater than 17 feet." Permit Conditions item 6 makes clearance-checking the permittee\'s duty for any load over the legal height, but does not require a formal survey below 17 ft.',
      ),
    ],
    lengthIn: [],
  },

  escortRules: CALIFORNIA_ESCORT_RULES,

  /** $16 flat. Nothing in California's single-trip fee depends on distance. */
  feesDependOnDistance: false,
};

/**
 * Cited for the statutory basis of the special service charge and for the fact
 * that a local jurisdiction's own permit fee is capped at the state's under
 * CVC §35795(b) — which is why Tehama County's $15/$70 and Orange County's
 * 110 ft combination length are LOCAL ordinances rather than conflicts with the
 * state figures above.
 */
export const CALIFORNIA_SPECIAL_SERVICE_STATUTE = CVC_35795;

/** Cited for what a clearance device must do IF a permittee chooses to use one. */
export const CALIFORNIA_HEIGHT_POLE_EQUIPMENT_SOURCE = CVC_35252;
