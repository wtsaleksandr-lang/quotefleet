/**
 * MICHIGAN — oversize/overweight single-trip permit rules.
 *
 * THE STATE THAT DOES NOT FIT THE MODEL, AND THE ONE THE MODEL GREW FOR.
 * ---------------------------------------------------------------------
 * Seven things about Michigan break the shape every other jurisdiction here
 * has. Each is handled by recording what Michigan actually publishes rather
 * than by forcing it into another state's field.
 *
 * 1. THE WEIGHT LAW IS PER-AXLE-AND-SPACING, NOT PER-GROSS. MCL 257.722(1)
 *    sets 18,000 / 13,000 / 9,000 lb keyed to the DISTANCE TO THE NEIGHBOURING
 *    AXLE and MCL 257.719(5)(b) caps the vehicle at eleven axles. There is no
 *    statutory gross-weight limit on a Michigan-law truck at all. The 164,000 lb
 *    figure everyone quotes is MDOT's own statement of the ARITHMETIC RESULT:
 *    "Since 1967, the maximum number of axles has been limited to eleven, and
 *    per-axle load restrictions have resulted in a maximum gross vehicle weight
 *    of 164,000 pounds." `grossWeightLbs` therefore carries MDOT's published
 *    result with a note saying what it is, and the real test lives in
 *    `axleSpacingWeightTables` — a new field, evaluated per adjacent-axle gap.
 *    See `AxleSpacingWeightTable` in `types.ts`.
 *
 * 2. THE REGIME IS SELECTED BY WEIGHT, NOT BY ROUTE. MCL 257.722(12) is the
 *    federal table (20,000 single / 34,000 tandem / bridge formula / 80,000
 *    gross) and MCL 257.722(1)-(3) is Michigan's own, governing "vehicles having
 *    a gross weight in excess of 80,000 pounds". THE SAME TRUCK ON THE SAME ROAD
 *    IS JUDGED BY A DIFFERENT TABLE DEPENDING ON HOW HEAVY IT IS. Every other
 *    state here selects a table by route class. That is a new selector axis and
 *    it is recorded as data on the table, not branched on in the engine.
 *
 * 3. `RouteClass` GREW `mi-designated` AND `mi-non-designated`. Designation
 *    under MCL 257.717(7) controls the legal width (102 in against 96), four
 *    separate length limits, and the 16,000 lb tandem allowance. It is published
 *    on MDOT's Truck Operators' Map and is not derivable from lane count, which
 *    is the California map-colour test.
 *
 * 4. THE FEE IS FLAT: $15 OR $50, AND NOTHING ELSE. No weight band, no per-mile
 *    rate, no per-ton rate, no excess-weight increment appears anywhere in MCL
 *    257.725 (all thirteen subsections opened) or in T-2. A 164,000 lb move over
 *    300 miles and a one-inch-overwidth move across town pay $50 and $15.
 *    `feesDependOnDistance` is false and both band lists carry exactly one row.
 *    MICHIGAN IS THE ONLY STATE IN THIS DIRECTORY WITH NO PARTIAL-INCREMENT
 *    QUESTION AT ALL — the field that dominates Tennessee and Arkansas simply
 *    does not arise. And a 164,000 lb load IS NOT A SUPERLOAD here: Michigan
 *    publishes no gross-weight superload threshold, so `superload.grossWeight`
 *    is ABSENT, which is a finding and not a gap. See point 7.
 *
 * 5. TWO CONSTRAINTS THIS ENGINE DOES NOT MODEL, AND SAYS SO. MCL 257.722(7)
 *    caps the wheel load at "700 pounds per inch of width of tire", and MCL
 *    257.717(4) measures width TWO WAYS IN ONE SUBSECTION — 102 in from tyre to
 *    tyre AND 96 in across the body or load. Tyre width is not on an `OsowLoad`
 *    and the model carries one `widthIn`, so both are recorded as ADVISORIES on
 *    escort rules rather than encoded: an advisory states a real exclusion
 *    without invalidating the price, which is the honest treatment for a rule we
 *    hold but cannot evaluate. Encoding either would need a measurement no quote
 *    collects, and defaulting that measurement would decide the answer.
 *
 * 6. REAR OVERHANG HAS NO INDEPENDENT LIMIT. T-1: "Overhang beyond rear of
 *    vehicles ....... Any amount is permissible if the legal length is not
 *    exceeded." It is consumed by the length limit and the 4 ft figure that
 *    circulates is a FLAGGING trigger, not a permit trigger. `rearOverhangIn` is
 *    therefore ABSENT, following the Georgia precedent — an empty array would
 *    say "we looked for Michigan's limit and found nothing" and push every quote
 *    in the state into review over a limit Michigan does not impose.
 *
 * 7. THERE IS A FOURTH ESCORT ACTOR. Beyond civilian pilot cars, state police
 *    and (elsewhere) local police, Michigan's permit conditions require that a
 *    load crossing the Straits "be escorted across the Mackinac Bridge by a
 *    Mackinac Bridge Authority vehicle", and the same for the International
 *    Bridge. Mandatory, and the cost is published nowhere. `EscortOutcome` has
 *    no slot for a bridge-authority vehicle and inventing one would imply we
 *    could price it, so it is an advisory that names the omission.
 *
 * ── MICHIGAN PUBLISHES NO DIMENSIONAL ESCORT THRESHOLDS. AT ALL. ──────────
 * This is the most important finding in the file and it is a POSITIVE one, of
 * exactly the kind fifteen states' "no published police escort rate" already is.
 *
 * MDOT publishes twenty-two numbered "Special Provisions" — 11 is a rear escort,
 * 12 a front escort, 14 police supervision, 21 radio — and states that "The
 * special permit for this movement will list applicable provision numbers for
 * this movement". WHICH width, height, length or weight causes a provision to be
 * attached is decided inside MiTRIP and appears in NONE of: T-1 (05/2024), T-2
 * (10/2023), T-2 (11/22), the OS/OW FAQ, Form 2465, or the permit conditions
 * PDF. All six were opened in full.
 *
 * The figures that circulate — over 12 ft = rear escort, over 14 ft = front and
 * rear, 90-100 ft = one, over 100 ft = two — appear ONLY on commercial permit
 * services and aggregator sites. THEY ARE NOT ADOPTED HERE. Publishing them
 * would put a third party's numbers behind a citation promise this whole engine
 * exists to keep.
 *
 * The ONE published number is the 14 ft 6 in height pole in Provision 12, and
 * even it is conditional: the provision says that IF the front-escort provision
 * has been assigned AND the load exceeds 14'6", the escort must carry a fixed
 * measuring device. It does not say that over 14'6" a front escort is required.
 * Encoding it as a standalone `heightPole: true` would assert a front escort
 * Michigan has not published, so it is an advisory too.
 *
 * ── FOUR CONFLICTS, NONE ADOPTED ─────────────────────────────────────────
 * 1. THE 16,000 LB TANDEM. MCL 257.722(2)-(3) grants it "on designated
 *    highways"; MDOT's T-1 footnote grants it "On any legal combination of
 *    vehicles" with no route condition. On a non-designated road that is
 *    3,000 lb per axle across two axles — 6,000 lb of payload. Both readings are
 *    on file as `TandemAxleAllowance.routeClasses`, one naming
 *    `mi-designated` and one `null`, and the engine surfaces the disagreement
 *    only for a load with an axle inside the band it can reach.
 * 2. THE 3 1/2 FOOT BOUNDARY. The statute allows 13,000 lb at MORE than 3.5 ft
 *    and 9,000 lb at LESS than 3.5 ft, so a pair spaced at exactly 42.000 inches
 *    is named by NO subdivision; T-1's table closes the hole with "More than or
 *    equal to 3 1/2 feet but less than 9 feet". Four thousand pounds per axle on
 *    one word. Both tables are on file and `axleSpacingRowFor` returns `null` for
 *    the statute at exactly 3.5 ft, which is the defect, faithfully.
 * 3. MICHIGAN.GOV SERVES SUPERSEDED EDITIONS OF ITS OWN OPERATIONAL DOCUMENTS.
 *    michigan.gov serves T-1 (04/19) and T-2 (11/22); MDOT's permit host
 *    mdotjboss.state.mi.us serves T-1 (05/2024) and T-2 (10/2023). Both hosts are
 *    official. These are DIFFERENT EDITIONS, not reflows — the michigan.gov T-2
 *    is eight pages against the jboss T-2's five. Every value row below is taken
 *    from the newer copies and carries that edition's date as its
 *    `effectiveFrom`; the superseded documents are registered in
 *    `MICHIGAN_SUPERSEDED_EDITIONS` with their URLs so the trap is greppable. NO
 *    VALUE IS TAKEN FROM THEM, because their contents were not transcribed —
 *    recording a figure "as it probably read in 2019" would be manufacturing
 *    history, which is the thing `revisedOn` exists to prevent.
 * 4. SINGLE-TRIP VALIDITY. The permit conditions that travel in the cab say
 *    "Permits are valid only for a single trip"; T-2 says a single-trip permit
 *    "may be issued for a five-day period" and "A return move may be requested on
 *    the single trip permit". Materially: whether a round-trip lane buys one $50
 *    permit or two. Carried as an advisory on every Michigan permit.
 *
 * ── DATE WARNINGS ────────────────────────────────────────────────────────
 * The proration sheet is a 2010 PDF with NO printed revision date, still the
 * live linked schedule; the permit-conditions PDF — sole source for every escort,
 * police, utility and bridge row — carries no printed revision date either. Both
 * take `revisedOn: null` and an `effectiveFrom` of our retrieval date, which is
 * the only date on which we can prove what they said. Texas's February-2021
 * treatment, one decade worse.
 */
import type { SourceDoc, Sourced } from '../provenance.js';
import { ftIn, type EscortRule } from '../escortRules.js';
import type {
  AxleSpacingWeightTable,
  CombinedFeeRule,
  JurisdictionOsowRules,
  OversizeFeeBand,
  OverweightPricing,
  Threshold,
  WeightBand,
  AdditionalAuthority,
} from '../types.js';

const RETRIEVED = '2026-09-05';

// ── Source documents ──────────────────────────────────────────────────────

const MCL_257_717: SourceDoc = {
  id: 'mi-mcl-257-717',
  title: 'MCL 257.717 — width of vehicles (Michigan Legislature)',
  url: 'https://www.legislature.mi.gov/Laws/MCL?objectName=mcl-257-717',
  publisher: 'Michigan Legislature',
  revisedOn: '2019-01-14',
  retrievedOn: RETRIEVED,
  cite: '(1) 96 in general; (3) 108 in for named commodities; (4) 102 in tyre-to-tyre and 96 in body; (5) 102 in body of a trailer or semitrailer; (7) designation power; last amendment "Am. 2018, Act 342, Eff. Jan. 14, 2019"',
};

const MCL_257_719: SourceDoc = {
  id: 'mi-mcl-257-719',
  title: 'MCL 257.719 — height, length, overhang and axle count (Michigan Legislature)',
  url: 'https://www.legislature.mi.gov/Laws/MCL?objectName=mcl-257-719',
  publisher: 'Michigan Legislature',
  revisedOn: '2018-05-22',
  retrievedOn: RETRIEVED,
  cite: '(1) height 13 ft 6 in; (2)(a),(d),(e),(f) non-designated lengths; (3)(a),(b) designated lengths; (5)(b) eleven axles; (5)(e) 3 ft front projection; last amendment "Am. 2018, Act 35, Eff. May 22, 2018"',
};

const MCL_257_722: SourceDoc = {
  id: 'mi-mcl-257-722',
  title: 'MCL 257.722 — axle load maxima (Michigan Legislature)',
  url: 'https://www.legislature.mi.gov/Laws/MCL?objectName=mcl-257-722',
  publisher: 'Michigan Legislature',
  revisedOn: '2025-04-02',
  retrievedOn: RETRIEVED,
  cite: '(1)(a)-(d) the normal loading maximum; (2)-(3) the 16,000 lb tandem on designated highways; (7) 700 lb per inch of tyre; (11) how weight is measured; (12) the federal table and the regime selector; (14)-(15) natural-gas and battery-electric allowances; last amendment "Am. 2024, Act 106, Eff. Apr. 2, 2025"',
};

const MCL_257_725: SourceDoc = {
  id: 'mi-mcl-257-725',
  title: 'MCL 257.725 — special permit fees (Michigan Legislature)',
  url: 'https://www.legislature.mi.gov/Laws/MCL?objectName=mcl-257-725',
  publisher: 'Michigan Legislature',
  revisedOn: '2018-05-14',
  retrievedOn: RETRIEVED,
  cite: '(5) $15 single trip / $30 multiple for over-dimension only, and the CPI escalation clause; the $50/$100 over-weight fee; the $264 construction-equipment annual; the local-authority cap frozen at 1997-09-30 levels; last amendment "Am. 2018, Act 17, Eff. May 14, 2018"',
};

/** The CURRENT T-1, served by MDOT's own permit host. */
const T1_2024: SourceDoc = {
  id: 'mdot-t1-2024-05',
  title: 'MDOT T-1 — Maximum Legal Truck Loadings and Dimensions',
  url: 'https://mdotjboss.state.mi.us/webforms/GetDocument.htm?fileName=T-1.pdf',
  publisher: 'Michigan Department of Transportation',
  revisedOn: '2024-05',
  retrievedOn: RETRIEVED,
  cite: 'form stamp "T-1 (05/2024)"; designated/non-designated width and length table; axle-load table; the tandem footnote',
};

/** The CURRENT T-2, served by MDOT's own permit host. */
const T2_2023: SourceDoc = {
  id: 'mdot-t2-2023-10',
  title: 'MDOT T-2 — Moving Oversize and Overweight Vehicles and Loads',
  url: 'https://mdotjboss.state.mi.us/webforms/GetDocument.htm?fileName=T-2.pdf',
  publisher: 'Michigan Department of Transportation',
  revisedOn: '2023-10',
  retrievedOn: RETRIEVED,
  cite: 'form stamp "T-2 (10/2023)"; Permit Fees; single-trip permit limitations and Superloads; escort vehicle standard; time limitations; holidays',
};

/**
 * THE SOLE SOURCE FOR EVERY MICHIGAN ESCORT, POLICE, UTILITY, PEAK-HOUR AND
 * BRIDGE ROW, AND IT CARRIES NO PRINTED REVISION DATE. The PDF's internal
 * creationDate is 2026-04-27, which is a render stamp and not a revision stamp.
 * `revisedOn` is null and `effectiveFrom` is our retrieval date.
 */
const PERMIT_CONDITIONS: SourceDoc = {
  id: 'mdot-permit-conditions',
  title: 'MDOT — Special Provisions, Conditions and Restrictions for Transport Permits',
  url: 'https://www.michigan.gov/mdot/-/media/Project/Websites/MDOT/Business/Truckers/Restrictions/Permit-general-conditions-restrictions.pdf',
  publisher: 'Michigan Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'Special Provisions 9, 10, 11, 12, 14, 15, 18, 21; paragraphs I, K, Q, X',
};

const FORM_2465: SourceDoc = {
  id: 'mdot-form-2465',
  title: 'MDOT Form 2465 — Route Survey Certification (superload)',
  url: 'https://mdotjboss.state.mi.us/webforms/GetDocument.htm?fileName=2465.pdf',
  publisher: 'Michigan Department of Transportation',
  revisedOn: '2019-05',
  retrievedOn: RETRIEVED,
  cite: 'form stamp "2465 (05/19)"; superload definition; certified route survey requirement; MSP coordination and the pre-movement inspection; fees non-refundable',
};

const OSOW_FAQ: SourceDoc = {
  id: 'mdot-osow-faq',
  title: 'MDOT — Oversize/Overweight frequently asked questions',
  url: 'https://www.michigan.gov/mdot/about/faqs/business/oversize-overweight',
  publisher: 'Michigan Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'single-trip permit cost; processing times; weekend movement allowance; permits on state trunklines only',
};

/**
 * MDOT's own explainer, and the only document that states the 164,000 lb figure
 * as the general maximum. "Effective Date: January 06, 2017 (Update April 7,
 * 2026)" — the update is recent and the body still cites 2012-2013 registration
 * statistics throughout, so it is a mix of current and decade-old content. The
 * 164,000 lb statement is unaffected by the stale statistics.
 */
const TRUCK_WEIGHT_LAW: SourceDoc = {
  id: 'mdot-truck-weight-law',
  title: "MDOT — Michigan's Truck Weight Law and Truck User Fees",
  url: 'https://www.michigan.gov/mdot/-/media/Project/Websites/MDOT/Business/Truckers/Rules-and-Guidelines/Michigan-Truck-Weight-Law-Truck-User-Fees.pdf',
  publisher: 'Michigan Department of Transportation',
  revisedOn: '2026-04-07',
  retrievedOn: RETRIEVED,
  cite: '"per-axle load restrictions have resulted in a maximum gross vehicle weight of 164,000 pounds"',
};

/**
 * THE PRORATION SHEET. Sixteen years old, no printed revision date, PDF internal
 * creationDate 2010-07-20, and still the live linked schedule. See
 * `MICHIGAN_NAME_LETTER_PRORATION`.
 */
const FEE_SCHEDULE_2010: SourceDoc = {
  id: 'mdot-fee-schedule-proration',
  title: 'MDOT — Transport Permit Fee Schedule (extended-permit proration)',
  url: 'https://www.michigan.gov/-/media/Project/Websites/MDOT/Business/Truckers/Rules-and-Guidelines/MDOT-Transport-Permit-Fee-Schedule.pdf',
  publisher: 'Michigan Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'the 12x12 proration matrix keyed to the first letter of the applicant company name; "Use 10% of the overweight prorated fee for farm-to-farm-only permits."',
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

/**
 * THE SUPERSEDED EDITIONS MICHIGAN.GOV STILL SERVES — CONFLICT 3, kept as data
 * so the trap is greppable rather than buried in prose.
 *
 * Both hosts are official MDOT. Anyone re-deriving Michigan's figures from
 * michigan.gov gets a schedule at least one revision old and is told nothing.
 * NO VALUE ROW IN THIS FILE COMES FROM EITHER: their contents were not
 * transcribed, and writing down what they "probably" said would invent the
 * history that `revisedOn` and `effectiveTo` exist to record honestly.
 */
export const MICHIGAN_SUPERSEDED_EDITIONS: ReadonlyArray<{
  supersededBy: string;
  source: SourceDoc;
}> = [
  {
    supersededBy: 'T-1 (05/2024) at mdotjboss.state.mi.us',
    source: {
      id: 'mdot-t1-2019-04-superseded',
      title: 'MDOT T-1 (04/19) — SUPERSEDED copy still served by michigan.gov',
      url: 'https://www.michigan.gov/mdot/-/media/Project/Websites/MDOT/Business/Truckers/Rules-and-Guidelines/Maximum-Legal-Truck-Loadings-Dimensions.pdf',
      publisher: 'Michigan Department of Transportation',
      revisedOn: '2019-04',
      retrievedOn: RETRIEVED,
      cite: 'form stamp "T-1 (04/19)"; seven years old and one revision behind the permit host',
    },
  },
  {
    supersededBy: 'T-2 (10/2023) at mdotjboss.state.mi.us',
    source: {
      id: 'mdot-t2-2022-11-superseded',
      title: 'MDOT T-2 (11/22) — SUPERSEDED copy still served by michigan.gov',
      url: 'https://www.michigan.gov/mdot/-/media/Project/Websites/MDOT/Business/Truckers/Rules-and-Guidelines/Moving-Oversize-Overweight-Vehicles-Loads.pdf',
      publisher: 'Michigan Department of Transportation',
      revisedOn: '2022-11',
      retrievedOn: RETRIEVED,
      cite: 'eight pages against the permit host copy of five — a different edition, not a reflow',
    },
  },
];

/**
 * OUR ARITHMETIC, AND IT IS NOT ENCODED ANYWHERE.
 *
 * Neither MDOT nor the statute publishes the axle configuration that sums to
 * 164,000 lb. One arrangement that reaches it under MCL 257.722(1)-(3) is three
 * axles at 18,000 lb each spaced 9 ft or more from their neighbours, one tandem
 * assembly at 16,000 lb per axle, and six axles at 13,000 lb:
 * 54,000 + 32,000 + 78,000 = 164,000. THAT SUM IS OURS, NOT MICHIGAN'S. It is
 * recorded here only to show the published number is reachable, it is a
 * flagged INFERENCE, and no row in this file is built from it.
 *
 * The engine does not derive a ceiling either. `maxAxles` times the heaviest row
 * is 11 x 18,000 = 198,000 lb, which is not 164,000 and is not achievable — an
 * 18,000 lb axle needs 9 ft of clearance on both sides and eleven of them do not
 * fit in a legal combination. And MCL 257.719(5)(b) lets a permit authorise MORE
 * than eleven axles, so 164,000 lb is not an absolute ceiling in either
 * direction.
 */
export const MICHIGAN_164000_RECONSTRUCTION =
  'MDOT publishes 164,000 lb as the maximum allowable gross vehicle weight and states it is the result of the eleven-axle cap and the per-axle spacing maxima, not a statutory figure. It does not publish the configuration. One arrangement that reaches it under MCL 257.722(1)-(3) is 3 axles at 18,000 lb (each 9 ft or more from its neighbours) + 1 tandem assembly at 16,000 lb per axle + 6 axles at 13,000 lb = 54,000 + 32,000 + 78,000 = 164,000 lb. THAT ARITHMETIC IS OURS, NOT MICHIGAN’S, it is offered only as evidence the number is reachable, and it is encoded in no rule, fee or limit in this file.';

/**
 * A FEE DETERMINED BY THE APPLICANT'S NAME. Nothing in this schema expresses it
 * and nothing tries to.
 *
 * MDOT staggers extended-permit expiry alphabetically, and the one-time
 * proration of a new extended permit is read off a 12x12 matrix crossing the
 * expiry month with THE FIRST LETTER OF THE APPLICANT COMPANY'S NAME —
 * $30-$57 for an oversize permit and $100-$191 for an overweight one. The sheet
 * assigns months only to A,B / C,D / E,F,G,H / I,J,K,L / M / N,O,P,Q / R,S /
 * T,U,V / W,X,Y,Z, leaves June, July and August with no letter group at all, and
 * says nothing about a company name beginning with a digit or a symbol.
 *
 * Single-trip permits — the only product this engine prices — are never
 * prorated, so this affects no quoted figure. It is recorded because a carrier
 * buying an annual permit will be quoted a number this engine cannot reproduce.
 */
export const MICHIGAN_NAME_LETTER_PRORATION =
  'A new Michigan extended (annual) permit is prorated once, from a 12x12 matrix crossing the month the existing permit expires with THE FIRST LETTER OF THE APPLICANT COMPANY’S NAME: $30-$57 for an oversize permit and $100-$191 for an overweight one, with farm-to-farm-only permits at 10% of the overweight prorated fee. MDOT’s worked example: "The new extended transport fee for the oversize permit (prorated this year only) is $47.00." No field in this model expresses a fee keyed to an applicant’s name, and none is invented. The sheet itself carries NO printed revision date and its PDF was created on 2010-07-20 — sixteen years old and still the live linked schedule. It leaves June, July and August unassigned to any letter group, and says nothing about a company name beginning with a digit.';

// ── Helpers ───────────────────────────────────────────────────────────────

function fromStatute<T>(
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

/** A row from a dated MDOT form, effective from that edition's own stamp. */
function fromForm<T>(
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
 * A row from an UNDATED document. `effectiveFrom` is the retrieval date, because
 * that is the only date on which we can prove the page said this.
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

const T1_FROM = '2024-05-01';
const T2_FROM = '2023-10-01';
const MCL_717_FROM = '2019-01-14';
const MCL_719_FROM = '2018-05-22';
const MCL_722_FROM = '2025-04-02';
const MCL_725_FROM = '2018-05-14';

// ── The axle-spacing weight tables (the Phase 9 extension) ────────────────

/**
 * THE FEDERAL REGIME, selected by gross weight at or under 80,000 lb.
 *
 * One row, not three. MCL 257.722(12)(a) is the only per-axle figure in the
 * subsection — "Twenty thousand pounds on any 1 axle, including all enforcement
 * tolerances" — and it is not conditioned on spacing at all, so it is recorded
 * with no spacing bounds. The tandem limit of (12)(b) and the bridge formula of
 * (12)(c) are GROUP limits, not per-axle ones: they are carried by
 * `legalLimits.tandemAxleLbs` and by `bridgeFormula.ts`, which runs for Michigan
 * exactly as it does for every state that adopts the federal table. Restating
 * 34,000 lb here as "17,000 per axle" would be our arithmetic wearing the
 * statute's clothes.
 */
const MICHIGAN_FEDERAL_TABLE: AxleSpacingWeightTable = {
  name: 'the federal loading maximum, MCL 257.722(12)',
  selector: { kind: 'grossWeightAtOrUnder', thresholdLbs: 80000 },
  rows: [
    {
      label: 'any single axle, at any spacing',
      minSpacingFt: null,
      minInclusive: true,
      maxSpacingFt: null,
      maxInclusive: true,
      maxAxleLoadLbs: 20000,
      conditionedOn: null,
    },
  ],
  maxAxles: null,
  tandemAllowance: null,
  explanation:
    'MCL 257.722(12) applies to interstate highways and to designated highways for vehicles at or under 80,000 lb: "Twenty thousand pounds on any 1 axle, including all enforcement tolerances", "A tandem axle weight of 34,000 pounds, including all enforcement tolerances", the federal bridge formula, and "The gross vehicle weight must not exceed 80,000 pounds including all enforcement tolerances." The same subsection is the regime selector: "vehicles having a gross weight in excess of 80,000 pounds ... are subject to the maximum axle loads of subsections (1), (2), and (3)."',
};

/**
 * MICHIGAN'S OWN TABLE AS THE STATUTE WRITES IT — and the 3 1/2 ft hole is real.
 *
 * (b) needs MORE than 3.5 ft and (c) needs LESS than 3.5 ft, so a pair spaced at
 * exactly 42.000 inches is named by neither. `axleSpacingRowFor` returns null
 * there, the engine reports it, and nothing is rounded into a band the statute
 * did not put it in.
 */
const MICHIGAN_STATUTE_TABLE: AxleSpacingWeightTable = {
  name: 'the normal loading maximum, MCL 257.722(1) as the statute writes it',
  selector: { kind: 'grossWeightAbove', thresholdLbs: 80000 },
  rows: [
    {
      label: '(a) axle spacing 9 feet or more between axles',
      minSpacingFt: 9,
      minInclusive: true,
      maxSpacingFt: null,
      maxInclusive: true,
      maxAxleLoadLbs: 18000,
      conditionedOn: 'vehicles equipped with high pressure pneumatic or balloon tires',
    },
    {
      label: '(b) less than 9 feet between 2 axles but MORE THAN 3 1/2 feet',
      minSpacingFt: 3.5,
      minInclusive: false,
      maxSpacingFt: 9,
      maxInclusive: false,
      maxAxleLoadLbs: 13000,
      conditionedOn: 'high pressure pneumatic or balloon tires',
    },
    {
      label: '(c) axles spaced less than 3 1/2 feet apart',
      minSpacingFt: null,
      minInclusive: true,
      maxSpacingFt: 3.5,
      maxInclusive: false,
      maxAxleLoadLbs: 9000,
      conditionedOn: null,
    },
  ],
  maxAxles: 11,
  tandemAllowance: {
    perAxleLbs: 16000,
    routeClasses: ['mi-designated'],
    minClearanceFt: 9,
    maxAssemblies: 1,
    maxAssembliesOnShortTractorSemitrailer: 2,
    quote:
      'MCL 257.722(3): "A combination of vehicles may operate on designated highways with not more than 1 tandem axle assembly having a gross weight of 16,000 pounds per axle, if there is no other axle within 9 feet of the assembly. On a combination of truck tractor and semitrailer having not more than 5 axles, 2 consecutive tandem axle assemblies may operate on designated highways at a gross permissible weight of 16,000 pounds per axle."',
  },
  explanation:
    'MCL 257.722(1): "(a) If the axle spacing is 9 feet or more between axles, the maximum axle load must not exceed 18,000 pounds ... (b) If the axle spacing is less than 9 feet between 2 axles but more than 3-1/2 feet, the maximum axle load must not exceed 13,000 pounds ... (c) If the axles are spaced less than 3-1/2 feet apart, the maximum axle load must not exceed 9,000 pounds per axle. (d) Subdivisions (a), (b), and (c) shall be known as the normal loading maximum." MCL 257.719(5)(b) caps the vehicle at eleven axles except under permit. There is no gross-weight figure anywhere in the section.',
};

/**
 * THE SAME TABLE AS MDOT PRINTS IT, AND IT IS NOT THE SAME TABLE.
 *
 * T-1's row reads "More than or equal to 3 1/2 feet but less than 9 feet", which
 * closes the statute's hole, and its footnote drops the "on designated highways"
 * condition from the 16,000 lb allowance entirely. Two rows, two divergences,
 * both recorded, neither adopted.
 */
const MICHIGAN_MDOT_TABLE: AxleSpacingWeightTable = {
  name: 'the axle-load table as MDOT T-1 (05/2024) prints it',
  selector: { kind: 'grossWeightAbove', thresholdLbs: 80000 },
  rows: [
    {
      label: '9 feet or more between axles',
      minSpacingFt: 9,
      minInclusive: true,
      maxSpacingFt: null,
      maxInclusive: true,
      maxAxleLoadLbs: 18000,
      conditionedOn: null,
    },
    {
      label: 'more than or equal to 3 1/2 feet but less than 9 feet',
      minSpacingFt: 3.5,
      minInclusive: true,
      maxSpacingFt: 9,
      maxInclusive: false,
      maxAxleLoadLbs: 13000,
      conditionedOn: null,
    },
    {
      label: 'less than 3 1/2 feet apart',
      minSpacingFt: null,
      minInclusive: true,
      maxSpacingFt: 3.5,
      maxInclusive: false,
      maxAxleLoadLbs: 9000,
      conditionedOn: null,
    },
  ],
  maxAxles: 11,
  tandemAllowance: {
    perAxleLbs: 16000,
    routeClasses: null,
    minClearanceFt: 9,
    maxAssemblies: 1,
    maxAssembliesOnShortTractorSemitrailer: 2,
    quote:
      'MDOT T-1 (05/2024) footnote: "On any legal combination of vehicles, only one (1) tandem axle assembly shall be permitted at the gross weight of 16,000 lbs. per axle and no other tandem axle assembly in such combination of vehicles shall exceed a gross weight of 13,000 lbs. per axle. On a combination of a truck tractor and semitrailer having not more than 5 axles, two (2) consecutive tandem axle assemblies shall be permitted at a gross permissible weight of 16,000 lbs. per axle, if there is no other axle within 9 feet of any axle of the assembly." The phrase "on designated highways", which the statute uses twice, does not appear.',
  },
  explanation:
    'MDOT’s operational restatement of MCL 257.722(1)-(3). It differs from the statute in exactly two places: the 13,000 lb band is written inclusive at 3 1/2 feet, closing a hole the statute leaves open, and the 16,000 lb tandem allowance carries no route condition where the statute confines it to designated highways.',
};

// ── Escort rules ──────────────────────────────────────────────────────────

function escortRule(
  id: string,
  description: string,
  when: EscortRule['when'],
  then: EscortRule['then'],
  source: SourceDoc = PERMIT_CONDITIONS,
  effectiveFrom: string = RETRIEVED,
): EscortRule {
  return {
    id,
    jurisdiction: 'MI',
    description,
    when,
    then,
    source,
    effectiveFrom,
    effectiveTo: null,
  };
}

/** True of any load that needs a Michigan transport permit at all. */
const NEEDS_A_MICHIGAN_PERMIT: EscortRule['when'] = {
  kind: 'any',
  of: [
    { kind: 'gt', measure: 'widthIn', value: 102 },
    { kind: 'gt', measure: 'heightIn', value: ftIn(13, 6) },
    { kind: 'gt', measure: 'overallLengthIn', value: ftIn(75) },
    { kind: 'gt', measure: 'trailerLengthIn', value: ftIn(53) },
    { kind: 'gt', measure: 'frontOverhangIn', value: ftIn(3) },
    { kind: 'gt', measure: 'grossWeightLbs', value: 80000 },
  ],
};

export const MICHIGAN_ESCORT_RULES: EscortRule[] = [
  /**
   * THE CENTRAL FINDING, STATED AS A RULE SO IT REACHES EVERY QUOTE IT COULD
   * AFFECT. Michigan assigns escorts by attaching numbered Special Provisions
   * inside MiTRIP and publishes no dimension that triggers one.
   *
   * It is a `manualReview`, not an `advisory`, and the difference is deliberate.
   * An advisory says "there is a cost we cannot price"; this says "we cannot
   * tell you whether this move needs a pilot car at all", which is a different
   * and larger claim, and a dispatcher who books no escort on the strength of a
   * silent quote gets the load stopped.
   */
  escortRule(
    'mi-escort-thresholds-not-published',
    'Escort requirements are assigned per permit inside MiTRIP and no dimensional trigger is published',
    NEEDS_A_MICHIGAN_PERMIT,
    {
      manualReview:
        'MDOT assigns escorts by attaching numbered Special Provisions to the issued permit — 11 is "To be followed by one escort vehicle", 12 is "To be preceded by one escort vehicle", 14 is "Police supervision of traffic required on move" — and states that "The special permit for this movement will list applicable provision numbers for this movement". WHICH width, height, length or weight causes a provision to be attached is decided inside MiTRIP and appears in none of T-1 (05/2024), T-2 (10/2023), T-2 (11/22), the MDOT OS/OW FAQ, Form 2465 or this permit-conditions document, all of which were opened in full. The figures that circulate on commercial permit-service sites (over 12 ft wide = rear escort, over 14 ft = front and rear, 90-100 ft = one escort) are third-party and are NOT adopted here. No escort count is quoted for Michigan and none should be inferred from its absence.',
    },
  ),

  /**
   * THE ONE PUBLISHED NUMBER IN MICHIGAN'S ESCORT SCHEME — and it is an
   * advisory, not a `heightPole: true`, because of the shape of the sentence.
   * Provision 12 does not say a front escort is required over 14'6". It says
   * that IF provision 12 has been assigned AND the load exceeds 14'6", THEN the
   * escort must carry a fixed measuring device. Asserting the pole would assert
   * the escort.
   */
  escortRule(
    'mi-height-pole-14-6-conditional',
    'Over 14 ft 6 in high — a height pole is required IF a front escort has been assigned, and whether one is assigned is not published',
    { kind: 'gt', measure: 'heightIn', value: ftIn(14, 6) },
    {
      advisory:
        'MDOT Special Provision 12: "To be preceded by one escort vehicle ... If height of the vehicle or load exceeds 14′6″, the escort vehicle will be required to have a fixed measuring device set at a height to assure clearance of the load." This is the ONLY numeric escort figure Michigan publishes, and it is conditional on the front-escort provision having been assigned — which MDOT decides per permit and does not publish a threshold for. No height-pole cost is included, and no front escort is asserted. Separately, T-2 requires that "all applicants requesting permits in excess of 13 feet 6 inches shall verify that the proposed route has been traveled to assure vertical clearance" — a duty on the applicant, at the legal height, with no fee.',
    },
  ),

  /**
   * NO POLICE THRESHOLD AND NO POLICE RATE, plus a cost a quote would otherwise
   * miss entirely: a Michigan police escort drags a mandatory MSP inspection
   * with it.
   */
  escortRule(
    'mi-police-supervision-no-threshold-no-rate',
    'Police supervision of traffic — no published trigger, no published rate, and it forces an MSP inspection',
    NEEDS_A_MICHIGAN_PERMIT,
    {
      advisory:
        'MDOT Special Provision 14 reads, in full, "Police supervision of traffic required on move." No width, height, length or weight triggers it and no rate is published — Michigan publishes no hourly rate, no minimum hours, no officer minimum and no mileage rate for a Michigan State Police escort, in michigan.gov/msp, T-1, either revision of T-2, the permit conditions, Form 2465 or the OS/OW FAQ. The $50-$150 per hour "industry range" that appears on carrier blogs is not substituted. Form 2465 adds a cost that would otherwise be missed: "When a police escort is required by MDOT, the permit also requires that the vehicle, load, and driver be inspected by a motor carrier officer prior to movement" — no fee is published for that inspection either.',
      },
    FORM_2465,
    '2019-05-01',
  ),

  /**
   * THE FOURTH ESCORT ACTOR. `EscortOutcome` has slots for civilian and police
   * escorts and nothing else, and a bridge-authority vehicle is neither.
   */
  escortRule(
    'mi-bridge-authority-escorts',
    'Mackinac and International Bridge crossings carry a mandatory bridge-authority escort whose cost is not published',
    NEEDS_A_MICHIGAN_PERMIT,
    {
      advisory:
        'A permitted load crossing the Straits or the St Marys River is escorted by the bridge authority’s own vehicle, not by a pilot car this quote can count. Permit condition Q: "Contact the Mackinac Bridge Authority (906) 643-7600 not less than 24 hours prior to the planned arrival for all moves crossing the bridge. Permit requires that the vehicle be escorted across the Mackinac Bridge by a Mackinac Bridge Authority vehicle." Condition X requires the same of the International Bridge at Sault Ste. Marie. Blue Water (810-984-3131) and Ambassador (313-849-5244) require 24 hours’ notice only. NO CHARGE IS PUBLISHED for either mandatory escort, so none is included. Any I-75 lane crossing the Straits, and any Sarnia, Sault or Detroit border lane, hits one of these.',
    },
  ),

  /**
   * The two constraints the model cannot evaluate, stated rather than dropped.
   */
  escortRule(
    'mi-tyre-width-and-two-width-measures',
    'Two published Michigan constraints this quote cannot evaluate: 700 lb per inch of tyre width, and width measured two ways in one subsection',
    NEEDS_A_MICHIGAN_PERMIT,
    {
      advisory:
        'MCL 257.722(7): "the maximum wheel load permissible for any wheel must not exceed 700 pounds per inch of width of tire", and T-2 enforces the same on permits with an 850 lb allowance for empty self-propelled earth-moving equipment. Tyre width is not collected on a quote, so this SECOND, INDEPENDENT weight constraint is recorded and not applied — a load legal on every axle figure above can still fail it. MCL 257.717(4) also measures width TWO WAYS IN ONE SENTENCE: "the maximum width from the outside of 1 wheel and tire to the outside of the opposite wheel and tire shall not exceed 102 inches, and the outside width of the body of the vehicle or the load on the vehicle shall not exceed 96 inches." This model carries one width. A load 100 in across the tyres but 95 in across the body is legal on a non-designated road and a 100-in body is not; only the single figure supplied has been tested.',
    },
    MCL_257_722,
    MCL_722_FROM,
  ),

  /**
   * The width band where the designated/non-designated split decides whether a
   * permit is needed at all. Recorded as a rule rather than as a second
   * `widthIn` row, because the two figures are not in conflict — they are two
   * different roads.
   */
  escortRule(
    'mi-width-96-to-102-non-designated',
    'Over 96 in up to 102 in wide — legal statewide on a trailer body, and over the limit for a LOAD on a non-designated highway',
    {
      kind: 'all',
      of: [
        { kind: 'gt', measure: 'widthIn', value: 96 },
        { kind: 'between', measure: 'widthIn', min: 96, max: 102 },
        { kind: 'routeClass', anyOf: ['mi-non-designated'] },
      ],
    },
    {
      manualReview:
        'MCL 257.717(1) caps "the total outside width of a vehicle or the load on a vehicle" at 96 inches, and MDOT’s T-1 prints "Non-Designated Highways / Width ....... 96 inches". The 102 inches recorded as Michigan’s legal width comes from MCL 257.717(5), which caps the BODY of "a trailer, a semitrailer" at 102 inches on every highway, and from MCL 257.717(7)’s designated-highway allowance. THIS IS OUR READING OF WHICH SUBSECTION GOVERNS A TRACTOR-SEMITRAILER, and it is the permissive one, taken because recording 96 inches would put an over-width permit on every ordinary 102-inch trailer in the state. On a route that is NOT designated, a LOAD between 96 and 102 inches wide needs a permit this quote has not priced.',
    },
    MCL_257_717,
    MCL_717_FROM,
  ),

  /**
   * The same split on trailer length.
   */
  escortRule(
    'mi-trailer-50-to-53-non-designated',
    'A semitrailer over 50 ft up to 53 ft — designated highways only',
    {
      kind: 'all',
      of: [
        { kind: 'gt', measure: 'trailerLengthIn', value: ftIn(50) },
        { kind: 'between', measure: 'trailerLengthIn', min: ftIn(50), max: ftIn(53) },
        { kind: 'routeClass', anyOf: ['mi-non-designated'] },
      ],
    },
    {
      manualReview:
        'MCL 257.719(3)(a) allows a 53 ft semitrailer on DESIGNATED highways; (2)(d) allows 50 ft off them, and T-1 states it plainly: "Length of semitrailers longer than 50 feet shall operate on designated highways only." The 53 ft recorded as Michigan’s legal semitrailer length is the designated figure — OUR READING, and the permissive one, taken because an ordinary 53 ft trailer is the normal case. On a non-designated route this trailer is over length and needs a permit this quote has not priced. The same split runs through three more length limits: a truck and semitrailer or trailer is 59 ft off the designated system and 65 ft on it, and a truck tractor with semitrailer and trailer is 59 ft off it.',
    },
    MCL_257_719,
    MCL_719_FROM,
  ),

  /**
   * CONFLICT 4 — what a single-trip permit actually buys.
   */
  escortRule(
    'mi-single-trip-validity-conflict',
    'Single-trip validity: "valid only for a single trip" against "a five-day period" with a return move',
    NEEDS_A_MICHIGAN_PERMIT,
    {
      advisory:
        'The permit conditions that travel in the cab say, at paragraph I, "Permits are valid only for a single trip." T-2 (10/2023) says "Single trip permits may be issued for a five-day period. A single trip permit is valid for one trip. A return move may be requested on the single trip permit to be completed within the same five-day period for an exact same configuration or empty trailer with reversed route", and the MDOT FAQ corroborates the five-day window. A return move is a second trip. Whether a round-trip lane buys one $50 permit or two turns on that disagreement; this quote prices ONE permit and neither reading has been adopted.',
    },
  ),

  /**
   * Michigan certifies nobody, and both directions of the reciprocity question
   * resolve from that single fact.
   */
  escortRule(
    'mi-no-pilot-car-certification',
    'Michigan does not certify pilot/escort vehicle operators',
    NEEDS_A_MICHIGAN_PERMIT,
    {
      advisory:
        'Michigan is not on FHWA’s list of states requiring P/EVO certification ("As of early 2016, States that require P/EVOs be certified include Arizona, Colorado, Florida, Georgia, Minnesota, New York, North Carolina, Oklahoma, Utah, Virginia, and Washington"), and independently MDOT’s own escort text specifies VEHICLE, LIGHTING AND SIGNAGE ONLY — "An escort vehicle must be a passenger vehicle with at least one flashing or rotating light on top of the cab ... an OVERSIZE LOAD sign 5 feet long by 12 inches high with 8-inch-high black letters on yellow background" — and imposes no operator qualification of any kind. INBOUND, no Michigan certification exists to require, so an out-of-state card is neither demanded nor refused. OUTBOUND, Michigan issues no card, so a Michigan escort must obtain the certification of any certifying state it enters. There is no reciprocity list because there is nothing to reciprocate.',
    },
    FHWA_PEVO,
    RETRIEVED,
  ),
];

// ── The jurisdiction ──────────────────────────────────────────────────────

/**
 * $15 IF OVER-DIMENSION ONLY, $50 IF OVERWEIGHT — AND THE $50 IS NOT ADDED TO
 * THE $15.
 *
 * MCL 257.725 states the WHOLE single-trip fee twice: "$15.00 for a single trip"
 * for a vehicle that exceeds the maximum size "but do not exceed the maximum
 * weight", and "the fee ... for a single trip shall be $50.00" otherwise. T-2
 * prints the same two lines: "$15.00 For a load that is over-dimension only,
 * legal in weight / $50.00 For a load that is over-dimension and/or over legal
 * axle weight."
 *
 * So the $50 REPLACES the $15 on a load that is both, which is exactly Ohio's
 * `overweightOnly` rule in different words, and `permitBaseFeeUsd` is a SOURCED
 * ZERO in the Pennsylvania/Illinois sense: Michigan charges nothing on top of
 * the figure the schedule prints. The three lines below reproduce the state's
 * own arithmetic exactly — $15, $50, or $50, and never $65.
 */
const OVERSIZE_ONLY_BAND: OversizeFeeBand = {
  label: 'over-dimension only, legal in weight',
  feeUsd: 15,
};

const OVERWEIGHT_BAND: WeightBand = {
  minLbs: 0,
  maxLbs: null,
  feeUsd: 50,
};

export const MICHIGAN_OSOW_RULES: JurisdictionOsowRules = {
  code: 'MI',
  name: 'Michigan',
  country: 'US',

  legalLimits: {
    /**
     * 102 INCHES, AND IT IS OUR READING OF WHICH SUBSECTION GOVERNS.
     * MCL 257.717(1) caps a vehicle or its load at 96 in; (5) caps the BODY of
     * "a trailer, a semitrailer" at 102 in on every highway, designated or not;
     * (7) lets an authority designate a highway for 102 in operation. Recording
     * 96 would flag every ordinary 102-inch trailer in Michigan as over-width.
     * `mi-width-96-to-102-non-designated` states the reading and says what it
     * costs on a road that is not designated.
     */
    widthIn: [
      fromStatute(
        102,
        MCL_257_717,
        MCL_717_FROM,
        'MCL 257.717(5): "The total outside body width of a school bus, a bus, a trailer coach, a trailer, a semitrailer, a truck camper, or a motor home shall not exceed 102 inches." MCL 257.717(1) caps a vehicle or the load on it at 96 inches, and MCL 257.717(7) lets the state transportation department, a county road commission or a local authority designate a highway for 102-inch operation. OUR READING is that a tractor-semitrailer is governed by (5) and by the designated-highway allowance; on a non-designated route a LOAD over 96 inches is over the limit. MCL 257.717(4) additionally measures width two ways at once — 102 inches tyre-to-tyre and 96 inches across the body or load — which this model, carrying one width, cannot express.',
      ),
      fromForm(
        102,
        T1_2024,
        T1_FROM,
        'T-1 prints "Designated Highways / Width ....... 102 inches" and "Non-Designated Highways / Width ....... 96 inches". The 102-inch figure is recorded; the 96-inch one is carried by mi-width-96-to-102-non-designated.',
      ),
    ],
    heightIn: [
      fromStatute(
        ftIn(13, 6),
        MCL_257_719,
        MCL_719_FROM,
        'MCL 257.719(1): "A vehicle unloaded or with load shall not exceed a height of 13 feet 6 inches." Exclusive, and with no designated/non-designated split. The same subsection makes the owner liable for damage to a bridge or viaduct "whether the clearance of the bridge or viaduct is posted or not".',
      ),
      fromForm(ftIn(13, 6), T1_2024, T1_FROM, 'T-1: "Height ....... 13 feet, 6 inches".'),
    ],
    /**
     * 53 FT, THE DESIGNATED FIGURE — again OUR READING, and again the permissive
     * one. See `mi-trailer-50-to-53-non-designated`.
     */
    trailerLengthIn: [
      fromStatute(
        ftIn(53),
        MCL_257_719,
        MCL_719_FROM,
        'MCL 257.719(3)(a): "Truck tractor and semitrailer combinations: no overall length limit, the semitrailer 53 feet." MCL 257.719(2)(d) allows 50 ft off the designated system. OUR READING records the designated figure, because a 53 ft trailer is the ordinary case; a non-designated route is handled by mi-trailer-50-to-53-non-designated.',
      ),
      fromForm(
        ftIn(53),
        T1_2024,
        T1_FROM,
        'T-1: "Length of semitrailers longer than 50 feet shall operate on designated highways only."',
      ),
    ],
    /**
     * ABSENT, and it is a finding. MCL 257.719(2)(d) and (3)(a) both say a truck
     * tractor and semitrailer combination has "no overall length" limit, on the
     * designated system and off it. An empty array would claim we looked for a
     * cap and found nothing; there is no cap.
     */
    frontOverhangIn: [
      fromStatute(
        ftIn(3),
        MCL_257_719,
        MCL_719_FROM,
        'MCL 257.719(5)(e): "a vehicle or a combination of vehicles shall not carry a load extending more than 3 feet beyond the front of the lead vehicle." T-1 corroborates: "Projection beyond front of vehicles ....... 3 feet". A stinger-steered combination may extend 4 ft beyond the front and 6 ft beyond the rear under MCL 257.719(2), which this model does not distinguish.',
      ),
      fromForm(ftIn(3), T1_2024, T1_FROM),
    ],
    /**
     * `rearOverhangIn` IS ABSENT, and that is the Georgia treatment.
     * T-1: "Overhang beyond rear of vehicles ....... Any amount is permissible if
     * the legal length is not exceeded. However, if this overhang is 4 feet or
     * more, there shall be displayed on the extreme rear of such a load a 12-inch
     * red square flag in the daytime and a red light or lantern at night."
     * Michigan sets no independent rear-overhang limit — it is consumed by the
     * overall length — and the 4 ft figure is a MARKING trigger, not a permit
     * trigger. A `rearOverhangIn` threshold is the wrong shape here, and an
     * EMPTY array would push every Michigan quote into review over a limit
     * Michigan does not impose.
     */
    /**
     * 164,000 LB IS MDOT'S PUBLISHED RESULT, NOT A STATUTORY CAP, and the note
     * says so on every quote that cites it. The real test is
     * `axleSpacingWeightTables`.
     */
    grossWeightLbs: [
      fromStatute(
        164000,
        TRUCK_WEIGHT_LAW,
        '2026-04-07',
        'MDOT: "Since 1967, the maximum number of axles has been limited to eleven, and per-axle load restrictions have resulted in a maximum gross vehicle weight of 164,000 pounds", and "The maximum allowable gross vehicle weight on the heaviest ‘Michigan-weight-law truck’ is 164,000 pounds, which can only be achieved by use of eleven properly spaced axles." THIS IS AN ARITHMETIC RESULT, NOT A STATUTORY LIMIT: no Michigan statute states a general gross-weight cap, and the binding constraints are MCL 257.722(1)’s per-axle maxima keyed to axle spacing and MCL 257.719(5)(b)’s eleven-axle cap — both evaluated in axleSpacingWeightTables. MCL 257.719(5)(b) also permits MORE than eleven axles under permit, so 164,000 lb is not an absolute ceiling. The only other appearance of 164,000 in the Michigan Vehicle Code is MCL 257.719(3)(b), a cap on a LOG CRIB VEHICLE ("A crib vehicle and semitrailer or trailer designed to and used to transport saw logs shall not exceed a gross vehicle weight of 164,000 pounds") and must not be cited as the general limit.',
      ),
    ],
    /**
     * THE FEDERAL FIGURES, because they are the ones that govern at or under
     * 80,000 lb — which is where a single-axle question is normally asked. Above
     * 80,000 lb Michigan's own table governs and the per-axle maximum is 18,000,
     * 13,000 or 9,000 lb depending on the spacing; recording those here as
     * competing candidates would read as a conflict when it is a regime switch.
     */
    singleAxleLbs: [
      fromStatute(
        20000,
        MCL_257_722,
        MCL_722_FROM,
        'MCL 257.722(12)(a): "Twenty thousand pounds on any 1 axle, including all enforcement tolerances." This is the FEDERAL regime, which MCL 257.722(12) applies to interstate highways and to designated highways for vehicles at or under 80,000 lb. Above 80,000 lb the Michigan table of MCL 257.722(1) governs instead and the per-axle maximum is 18,000, 13,000 or 9,000 lb by spacing — see axleSpacingWeightTables. The two are not in conflict; they are selected by gross weight.',
      ),
    ],
    tandemAxleLbs: [
      fromStatute(
        34000,
        MCL_257_722,
        MCL_722_FROM,
        'MCL 257.722(12)(b): "A tandem axle weight of 34,000 pounds, including all enforcement tolerances." Federal regime, at or under 80,000 lb gross. Above it, MCL 257.722(2)-(3) allow ONE tandem assembly at 16,000 lb per axle — 32,000 lb — "on designated highways", a route condition MDOT’s own T-1 footnote omits. That disagreement is carried in axleSpacingWeightTables, where both readings are on file and neither is adopted.',
      ),
    ],
  },

  /**
   * A SOURCED ZERO. MCL 257.725 states the whole single-trip fee as $15 or $50
   * and charges nothing on top of it, so the base line is suppressed and the
   * band carries the figure — the Pennsylvania and Illinois treatment.
   */
  permitBaseFeeUsd: [
    fromStatute(
      0,
      MCL_257_725,
      MCL_725_FROM,
      'Michigan charges no issuance fee on top of the printed single-trip figure. MCL 257.725(5) sets the whole over-dimension fee at "$15.00 for a single trip", and the same section sets the whole over-weight fee at "$50.00" for a single trip. Recorded as a sourced zero so the $15 and $50 rows below are the complete permit price and nothing is added to them.',
    ),
  ],

  /**
   * One band, no dimensional bounds, because Michigan charges one flat $15 for
   * an over-dimension move of any size. Three sources, in agreement.
   */
  oversizeFeeBands: [
    fromStatute(
      OVERSIZE_ONLY_BAND,
      MCL_257_725,
      MCL_725_FROM,
      'MCL 257.725(5): "The fee charged by the state transportation department for an intrastate or an out-of-state vehicle or combination of vehicles that exceed the maximum size specified in this chapter but do not exceed the maximum weight or load specified in this chapter or are otherwise not in conformity with this chapter shall be $15.00 for a single trip and $30.00 for multiple trips or on an annual basis." The same subsection authorises an annual CPI increase, "rounded to the nearest whole dollar", which MDOT has not applied — T-2 (10/2023) and the FAQ both still print $15.',
    ),
    fromForm(
      OVERSIZE_ONLY_BAND,
      T2_2023,
      T2_FROM,
      'T-2: "Single Trip Permit: $15.00 For a load that is over-dimension only, legal in weight".',
    ),
    fromUndated(
      OVERSIZE_ONLY_BAND,
      OSOW_FAQ,
      'FAQ: "What is the cost of a single trip permit? Oversize: $15 Oversize/Overweight: $50".',
    ),
  ],

  /**
   * OHIO'S RULE, IN MICHIGAN'S WORDS. "$50.00 For a load that is over-dimension
   * AND/OR over legal axle weight" — the $50 covers both, so the $15 oversize
   * charge is not added to it.
   */
  combinedFeeRule: [
    fromStatute<CombinedFeeRule>(
      {
        kind: 'overweightOnly',
        explanation:
          'MCL 257.725 sets the single-trip fee at $15.00 for a load that exceeds the size limits "but do not exceed the maximum weight", and at $50.00 otherwise. T-2 prints the same split: "$50.00 For a load that is over-dimension and/or over legal axle weight." The $50 is the whole fee for a load that is both, not an addition to the $15.',
      },
      MCL_257_725,
      MCL_725_FROM,
    ),
    fromForm<CombinedFeeRule>(
      {
        kind: 'overweightOnly',
        explanation:
          'T-2 (10/2023) Permit Fees: "$15.00 For a load that is over-dimension only, legal in weight / $50.00 For a load that is over-dimension and/or over legal axle weight."',
      },
      T2_2023,
      T2_FROM,
    ),
  ],

  /**
   * FLAT. Not banded by weight, not priced by the mile, not priced by the ton,
   * and with no excess-weight increment — MCL 257.725 was read in full and no
   * weight-graduated or distance-graduated charge appears in any of its thirteen
   * subsections. The row exists so that a one-row band list is unmistakably a
   * published flat fee rather than a research gap.
   */
  overweightPricing: [
    fromStatute<OverweightPricing>(
      {
        kind: 'bands',
        explanation:
          'MCL 257.725 charges one flat $50.00 for a single-trip overweight permit whatever the load weighs and however far it travels. There is no weight band, no per-mile rate, no per-ton rate and no excess-weight increment anywhere in the section. Michigan is consequently the one state in this directory with no partial-increment question at all.',
      },
      MCL_257_725,
      MCL_725_FROM,
    ),
    fromForm<OverweightPricing>(
      {
        kind: 'bands',
        explanation:
          'T-2 (10/2023) prints one flat figure per permit type and no per-mile or per-ton column of any kind.',
      },
      T2_2023,
      T2_FROM,
    ),
  ],

  overweightBands: [
    fromStatute(
      OVERWEIGHT_BAND,
      MCL_257_725,
      MCL_725_FROM,
      'MCL 257.725: "Except as otherwise provided in this section, the fee charged by the state transportation department for an intrastate or an out-of-state vehicle for a single trip shall be $50.00 and for multiple trips or on an annual basis shall be $100.00." Flat at every weight — a 164,000 lb move over 300 miles is a $50 permit.',
    ),
    fromForm(
      OVERWEIGHT_BAND,
      T2_2023,
      T2_FROM,
      'T-2: "$50.00 For a load that is over-dimension and/or over legal axle weight". T-2 says "over legal AXLE weight" where the statute says "exceed the maximum weight or load" — the same trigger in practice, given that Michigan’s weight law is axle-based.',
    ),
    fromUndated(OVERWEIGHT_BAND, OSOW_FAQ, 'FAQ: "Oversize/Overweight: $50".'),
  ],

  /** No distance-priced component exists to hold. See `overweightPricing`. */
  overweightPerMile: [],

  conditionalFees: [],

  /**
   * EMPTY, AND IT MEANS "NOBODY PUBLISHES A RATE" — never "the rate is zero".
   * T-2 says only "Payments shall be made through the MDOT Permit Gateway (MPG)
   * Shopping Cart using credit card, debit card or electronic check", and no
   * surcharge, convenience fee or percentage appears in T-2, the FAQ, the fee
   * schedule or MCL 257.725. Tennessee's, Arkansas's and Louisiana's treatment.
   */
  transactionFee: [],

  /**
   * BOTH EMPTY, AND FOR A REASON MICHIGAN STATES. The APPLICANT performs and
   * certifies the superload route survey on Form 2465; MDOT does not perform it
   * and publishes no charge to review it. The only money sentence anywhere in
   * the superload package is "PERMIT APPLICATION AND/OR PERMIT FEES ARE
   * NON-REFUNDABLE." Contrast Texas's $500 review fee. Kentucky's, Colorado's
   * and Tennessee's treatment.
   */
  routeAnalysisFeeUsd: [],
  noBridgeRouteFeeUsd: [],

  superload: {
    /**
     * `grossWeight` IS ABSENT, AND IT IS THE MOST SURPRISING FINDING IN THE FILE.
     *
     * T-2's Superloads paragraph lists three limits and all three are
     * DIMENSIONAL: "Permits shall not be issued for transportation of loads
     * exceeding the following limitations: 16 feet in width / 15 feet in height /
     * 150 feet in overall combination length". No weight figure appears in it,
     * and none appears in Form 2465's superload definition either. That is
     * consistent with Michigan's whole design — weight is governed by the axle
     * table, so a 164,000 lb move on eleven properly spaced axles is an ORDINARY
     * $50 single-trip permit and not a superload.
     *
     * ABSENT, not empty. An empty array would say "Michigan has a weight
     * threshold and we hold none of it", which would send every heavy Michigan
     * quote to review over a number Michigan does not publish. Illinois's
     * treatment. It is also why Michigan gets no quotable weight ceiling in the
     * widget mirror: there is no threshold to mirror, and inventing one would let
     * a client wave through a load the server would then have to refuse.
     */
    shortSpacing: [],
    widthIn: [
      fromForm<Threshold>(
        { value: ftIn(16), inclusive: false },
        T2_2023,
        T2_FROM,
        'T-2: "Permits shall not be issued for transportation of loads exceeding the following limitations: 16 feet in width / 15 feet in height / 150 feet in overall combination length ... Superloads / Efforts should be made to move vehicles or loads exceeding these limitations by some means other than by state trunkline or to dismantle the object being moved to comply with the standard permit limitations." Exclusive: at exactly 16 ft 0 in it is an ordinary single-trip permit.',
      ),
      fromForm<Threshold>(
        { value: ftIn(16), inclusive: false },
        FORM_2465,
        '2019-05-01',
        'Form 2465: "Requests for transport permit loads exceeding 16 feet in width, 15 feet in height, and/or 150 feet in length are considered superloads."',
      ),
    ],
    heightIn: [
      fromForm<Threshold>({ value: ftIn(15), inclusive: false }, T2_2023, T2_FROM),
      fromForm<Threshold>({ value: ftIn(15), inclusive: false }, FORM_2465, '2019-05-01'),
    ],
    overallLengthIn: [
      fromForm<Threshold>(
        { value: ftIn(150), inclusive: false },
        T2_2023,
        T2_FROM,
        'T-2 says "150 feet in overall combination length"; Form 2465 says "150 feet in length". Same number, and T-2’s phrasing is the operative one.',
      ),
      fromForm<Threshold>({ value: ftIn(150), inclusive: false }, FORM_2465, '2019-05-01'),
    ],
  },

  /**
   * Michigan's route "inspection" is a CERTIFIED ROUTE SURVEY the applicant
   * performs, and its triggers are the superload limits exactly. Form 2465: "A
   * certified route survey is required with a superload application exceeding
   * 150 feet in length, 16 feet width, and/or 15 feet in height."
   */
  routeInspection: {
    widthIn: [
      fromForm<Threshold>({ value: ftIn(16), inclusive: false }, FORM_2465, '2019-05-01'),
    ],
    heightIn: [
      fromForm<Threshold>({ value: ftIn(15), inclusive: false }, FORM_2465, '2019-05-01'),
    ],
    lengthIn: [
      fromForm<Threshold>({ value: ftIn(150), inclusive: false }, FORM_2465, '2019-05-01'),
    ],
  },

  /**
   * THE FOUR ROWS THAT REPLACE A GROSS-WEIGHT LIMIT.
   *
   * One federal table selected at or under 80,000 lb, and TWO readings of
   * Michigan's own table selected above it — the statute's and MDOT's — which
   * differ at exactly 3 1/2 feet of spacing and about whether the 16,000 lb
   * tandem allowance is confined to designated highways. The engine evaluates
   * every governing table and reports a disagreement only when the two verdicts
   * differ for the load in front of it.
   */
  axleSpacingWeightTables: [
    fromStatute(MICHIGAN_FEDERAL_TABLE, MCL_257_722, MCL_722_FROM),
    fromStatute(MICHIGAN_STATUTE_TABLE, MCL_257_722, MCL_722_FROM),
    fromForm(
      MICHIGAN_MDOT_TABLE,
      T1_2024,
      T1_FROM,
      'MDOT’s operational table. It closes the statute’s 3 1/2 ft boundary hole and drops the designated-highway condition from the 16,000 lb tandem allowance. Neither divergence has been adopted.',
    ),
  ],

  escortRules: MICHIGAN_ESCORT_RULES,

  /**
   * MDOT PERMITS STATE TRUNKLINES AND NOTHING ELSE, AND SAYS SO ON THE PERMIT.
   *
   * Permit condition K: "This permit not valid on County roads or city streets.
   * If the equipment is to be moved on any county road or city street,
   * permission must be obtained from the appropriate authorities." The FAQ says
   * the same: MDOT "does not permit movement on county roads". Almost every real
   * lane has a non-trunkline first or last mile, so a Michigan subtotal that
   * looks complete is missing a second permit unless the whole move is on
   * trunkline. MCL 257.725 caps a local authority's fee at $50 single-trip and
   * $100 annual and freezes it at its 1997-09-30 level, but the actual figure
   * varies by authority and is not published centrally, so it is not priceable.
   * New York's Thruway Authority treatment.
   */
  additionalAuthorities: [
    fromUndated<AdditionalAuthority>(
      {
        name: 'county road commission or city',
        appliesWhen:
          'Any part of the move that leaves the state trunkline system — which almost every lane does at its first or last mile.',
        priceable: false,
      },
      PERMIT_CONDITIONS,
      'Permit condition K: "This permit not valid on County roads or city streets. If the equipment is to be moved on any county road or city street, permission must be obtained from the appropriate authorities." MCL 257.725 caps the local fee at $50 for a single trip and $100 annually and freezes it at the level charged on 30 September 1997, but each authority sets its own and none is published centrally.',
    ),
  ],

  /** $15 or $50, whatever the distance. There is no mileage term to compute. */
  feesDependOnDistance: false,
};
