/**
 * PENNSYLVANIA — oversize/overweight single-trip permit rules.
 *
 * THE LIVE CONFLICT THIS FILE EXISTS TO PRESERVE
 * ----------------------------------------------
 * Pennsylvania is the state `provenance.ts` was designed around. Two official
 * sources give two different oversize issuance fees and NEITHER has been
 * repealed:
 *
 *   - 75 Pa.C.S. §1942 — the statute — prints "$35" for a load up to 14 ft
 *     wide and "$71" above it.
 *   - PennDOT's current hauling-permit fee schedule, stamped "PERMIT FEES –
 *     EFFECTIVE JULY 1, 2025", prints "$46 (If < 14' wide)" and "$97 (If > 14'
 *     wide)".
 *
 * §1904 explains the gap — every fee under Title 75 is CPI-adjusted every 24
 * months — but the adjusted figures live only in a PDF, and the statute still
 * says $35. BOTH ROWS ARE ON FILE AND THE ENGINE REFUSES TO PICK. A 13 ft 6 in
 * load therefore prices as a $35–$46 range with manual review, which is a more
 * useful answer than one confident number that might be $11 wrong on every
 * permit. Do not "resolve" this by deleting a row.
 *
 * A SECOND, NARROWER AMBIGUITY AT EXACTLY 14 FT 0 IN. The current PDF assigns a
 * load of exactly 14 ft to NEITHER band ("< 14'" and "> 14'"); the statute
 * assigns it to the lower one ("up to 14 feet"). The bands below record each
 * boundary exactly as written, which means a load of exactly 14 ft 0 in matches
 * only the statutory row and prices at $35 with that citation attached. That is
 * the sole figure any source assigns to that width — but it is a 2014 amount
 * PennDOT has almost certainly adjusted, so a load sitting exactly on the
 * boundary should be confirmed with the Central Permit Office before it ships.
 *
 * THREE MORE THINGS TO KNOW
 * -------------------------
 *
 * 1. THE OVERWEIGHT FEE IS DISTANCE-PRICED, SO PENNSYLVANIA CANNOT BE QUOTED
 *    WITHOUT IN-STATE MILEAGE. "4¢ per mile per ton by which the gross weight
 *    exceeds the registered gross weight." `feesDependOnDistance` is true and
 *    the engine refuses rather than billing a whole lane's miles to one state.
 *
 * 2. THE STATUTE MEASURES EXCESS FROM THE **REGISTERED** GROSS WEIGHT, not from
 *    the legal limit, and registered weight is not collected on a quote. The
 *    rate row records 80,000 lb as the base — the statutory maximum a
 *    combination can be registered at — and says so on the row. A truck
 *    registered LOWER than 80,000 lb owes MORE than this computes.
 *
 * 3. OVERSIZE AND OVERWEIGHT DO ADD HERE, unlike Ohio: "Fees under subsection
 *    (a) are cumulative so that a vehicle and load which are both oversize and
 *    overweight would be subject to a fee under subsection (a)(1) or (2) and
 *    subsection (a)(3)." That is the engine's default, so no `combinedFeeRule`
 *    row is needed — but it is quoted here so the absence reads as a finding.
 *
 * WHAT PENNSYLVANIA DOES NOT PUBLISH — recorded, never filled in
 * --------------------------------------------------------------
 * No numeric State Police escort rate ("State escort fees vary based on escort
 * personnel status (e.g., overtime) and will be invoiced separately"), no
 * inspection/weighing charge, no engineering-review fee, no route-survey cost,
 * no certified-escort application cost, no rounding rule for fractional tons or
 * miles, and no legal overhang limit (overhang is regulated through the pilot
 * car requirement at 15 ft of rear extension instead). Each is carried as an
 * advisory or a note, not as a number.
 */
import type { SourceDoc, Sourced } from '../provenance.js';
import { ftIn, type EscortRule } from '../escortRules.js';
import type {
  JurisdictionOsowRules,
  OversizeFeeBand,
  OverweightPricing,
  PerMileRate,
  Threshold,
  TransactionFee,
} from '../types.js';

const RETRIEVED = '2026-09-01';

// ── Source documents ──────────────────────────────────────────────────────
//
// Title 75 sections share one URL but carry DIFFERENT amendment dates, so each
// is its own `SourceDoc`. Collapsing them would attach one section's date to
// another's text, which is the exact rot `provenance.ts` exists to prevent.

const TITLE_75_URL =
  'https://www.legis.state.pa.us/WU01/LI/LI/CT/HTM/75/00.049..HTM';

const PA_4921: SourceDoc = {
  id: 'pa-75-4921',
  title: '75 Pa.C.S. §4921 — Width of vehicles',
  url: TITLE_75_URL,
  publisher: 'Pennsylvania General Assembly',
  revisedOn: '2018-06-12',
  retrievedOn: RETRIEVED,
  cite: 'general rule: 8 ft 6 in; amended 2018-06-12, effective 180 days later',
};

const PA_4922: SourceDoc = {
  id: 'pa-75-4922',
  title: '75 Pa.C.S. §4922 — Height of vehicles',
  url: TITLE_75_URL,
  publisher: 'Pennsylvania General Assembly',
  revisedOn: '2008-11-26',
  retrievedOn: RETRIEVED,
  cite: '13 ft 6 in; amended 2008-11-26, effective 60 days later',
};

const PA_4923: SourceDoc = {
  id: 'pa-75-4923',
  title: '75 Pa.C.S. §4923 — Length of vehicles',
  url: TITLE_75_URL,
  publisher: 'Pennsylvania General Assembly',
  revisedOn: '2018-06-12',
  retrievedOn: RETRIEVED,
  cite: 'single trailer 53 ft; kingpin-to-rear-axle 41 ft',
};

const PA_4941: SourceDoc = {
  id: 'pa-75-4941',
  title: '75 Pa.C.S. §4941 — Maximum gross weight of vehicles',
  url: TITLE_75_URL,
  publisher: 'Pennsylvania General Assembly',
  revisedOn: '2022-11-03',
  retrievedOn: RETRIEVED,
  cite: '80,000 lb general rule; (d) natural-gas/electric allowance up to 2,000 lb',
};

const PA_4943: SourceDoc = {
  id: 'pa-75-4943',
  title: '75 Pa.C.S. §4943 — Maximum axle weight of vehicles',
  url: TITLE_75_URL,
  publisher: 'Pennsylvania General Assembly',
  revisedOn: '1998-12-21',
  retrievedOn: RETRIEVED,
  cite: '(1) steering axle 20,000 lb; single non-steering axle 20,000 lb over 73,280 lb combination',
};

const PA_4962_F2: SourceDoc = {
  id: 'pa-75-4962-f2',
  title: '75 Pa.C.S. §4962(f.2) — One pilot car for 13–14 ft wide, 90–120 ft long',
  url: TITLE_75_URL,
  publisher: 'Pennsylvania General Assembly',
  revisedOn: '2014-06-30',
  retrievedOn: RETRIEVED,
  cite: 'amended 2014-06-30, effective 60 days later',
};

const PA_4962_F6: SourceDoc = {
  id: 'pa-75-4962-f6',
  title: '75 Pa.C.S. §4962(f.6) — Certified escort vehicle for a super load',
  url: TITLE_75_URL,
  publisher: 'Pennsylvania General Assembly',
  revisedOn: '2015-10-30',
  retrievedOn: RETRIEVED,
  cite: 'amended 2015-10-30, effective 60 days later',
};

const PA_STATUTE_URL =
  'https://www.palegis.us/statutes/consolidated/view-statute?chpt=19&div=0&iFrame=true&ttl=75&txtType=HTM';

const PA_1942: SourceDoc = {
  id: 'pa-75-1942',
  title: '75 Pa.C.S. §1942 — Fees for permits (statutory, pre-CPI amounts)',
  url: PA_STATUTE_URL,
  publisher: 'Pennsylvania General Assembly',
  revisedOn: '2014-07-01',
  retrievedOn: RETRIEVED,
  cite: '(a)(1) $35 up to 14 ft wide; (a)(2) $71 over 14 ft; (a)(3) 4¢ per mile per ton; (b) fees are cumulative',
};

const PA_1904: SourceDoc = {
  id: 'pa-75-1904',
  title: '75 Pa.C.S. §1904 — Automatic CPI fee adjustment',
  url: PA_STATUTE_URL,
  publisher: 'Pennsylvania General Assembly',
  revisedOn: '2014-01-01',
  retrievedOn: RETRIEVED,
  cite: 'every succeeding 24-month period; applied "to every fee charged under this title"',
};

/** The current, adjusted schedule. Stamped with its own effective date. */
const PA_FEE_PDF: SourceDoc = {
  id: 'penndot-hauling-fees-2025-07',
  title: 'PennDOT — Hauling Permit Fees, effective July 1 2025 (PDF)',
  url: 'https://www.pa.gov/content/dam/copapwp-pagov/en/penndot/documents/programs-and-doing-business/permits/haulinginformation/documents/hauling-permit-2025-fees.pdf',
  publisher: 'Pennsylvania Department of Transportation',
  revisedOn: '2025-07-01',
  retrievedOn: RETRIEVED,
  cite: 'row "66 - A Vehicle (Oversize) Single Trip"; heading "PERMIT FEES – EFFECTIVE JULY 1, 2025"',
};

const PA_QUICK_REF: SourceDoc = {
  id: 'penndot-load-type-quick-reference-2025-10',
  title: 'PennDOT — Load Type Quick Reference Guide (October 2025, PDF)',
  url: 'https://www.pa.gov/content/dam/copapwp-pagov/en/penndot/documents/programs-and-doing-business/permits/haulinginformation/load-type-quick-reference-guide-2025%20version2.pdf',
  publisher: 'Pennsylvania Department of Transportation',
  revisedOn: '2025-10-01',
  retrievedOn: RETRIEVED,
  cite: 'super load thresholds; preliminary fees $68 + $12/county; "State escort fees vary". Month-only date, recorded as the 1st.',
};

const PA_CODE_179: SourceDoc = {
  id: 'pa-67-code-179',
  title: '67 Pa. Code Chapter 179 — Oversize and overweight loads',
  url: 'https://www.pacodeandbulletin.gov/secure/pacode/data/067/chapter179/chap179toc.html',
  publisher: 'Pennsylvania Code and Bulletin',
  revisedOn: '1993-08-13',
  retrievedOn: RETRIEVED,
  cite: '§179.9 additional fees; §179.10 pilot cars and police escorts',
};

const PA_CODE_185: SourceDoc = {
  id: 'pa-67-code-185',
  title: '67 Pa. Code Chapter 185 — Bridge formula table (PDF)',
  url: 'https://www.pacodeandbulletin.gov/secure/pacode/data/067/chapter185/067_0185.pdf',
  publisher: 'Pennsylvania Code and Bulletin',
  revisedOn: '1981-01-17',
  retrievedOn: RETRIEVED,
  cite: 'Bridge Formula Table, 2-axle group at 4 ft = 34,000 lb; PDF serial date April 1998',
};

const PA_3108: SourceDoc = {
  id: 'pa-75-3108',
  title: '75 Pa.C.S. §3108 — "Super load" definition',
  url: 'https://www.palegis.us/statutes/consolidated/view-statute?chpt=31&div=0&iFrame=true&sctn=8&subsctn=0&ttl=75&txtType=HTM',
  publisher: 'Pennsylvania General Assembly',
  revisedOn: '2015-10-30',
  retrievedOn: RETRIEVED,
  cite: '"gross weight exceeding 201,000 pounds, a total length exceeding 160 feet or a total width exceeding 16 feet"',
};

const PA_APRAS_AGREEMENT: SourceDoc = {
  id: 'penndot-m-936ras-2025-01',
  title: 'PennDOT Form M-936RAS — APRAS supplemental agreement (January 2025, PDF)',
  url: 'https://www.pa.gov/content/dam/copapwp-pagov/en/penndot/documents/public/pubsforms/forms/m-936ras.pdf',
  publisher: 'Pennsylvania Department of Transportation',
  revisedOn: '2025-01-01',
  retrievedOn: RETRIEVED,
  cite: '"a per transaction surcharge of One Dollar ($1.00)". Month-only date, recorded as the 1st.',
};

const PA_APRAS_FAQ: SourceDoc = {
  id: 'penndot-apras-faq-2020-02',
  title: 'PennDOT — APRAS FAQ (PDF)',
  url: 'https://www.pa.gov/content/dam/copapwp-pagov/en/penndot/documents/programs-and-doing-business/permits/haulinginformation/apras%20faq.pdf',
  publisher: 'Pennsylvania Department of Transportation',
  revisedOn: '2020-02-19',
  retrievedOn: RETRIEVED,
  cite: 'route survey required over 14 ft 6 in high and for every super load',
};

/** PennDOT's certified-escort policy. UNDATED — `revisedOn` is null. */
const PA_CEV_POLICY: SourceDoc = {
  id: 'penndot-certified-escort-program',
  title: 'PennDOT — Certified Escort Program Information (PDF)',
  url: 'https://www.pa.gov/content/dam/copapwp-pagov/en/penndot/documents/programs-and-doing-business/permits/haulinginformation/certifiedescortprograminformation.pdf',
  publisher: 'Pennsylvania Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'certification requirements; conditions when a CEV may escort a super load; accepted out-of-state classes',
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

// Amendment dates plus the delay each amendment states, so an effective-from is
// a date we can defend rather than the date the bill was signed.
const EFF_4921 = '2018-12-09'; // amended 2018-06-12 + 180 days
const EFF_4922 = '2009-01-25'; // amended 2008-11-26 + 60 days
const EFF_4923 = '2018-12-09';
const EFF_4941 = '2023-01-02'; // amended 2022-11-03 + 60 days
const EFF_4943 = '1999-02-19'; // amended 1998-12-21 + 60 days
const EFF_179 = '1993-08-13';
const EFF_1942 = '2014-07-01';
const EFF_FEE_PDF = '2025-07-01';
const EFF_3108 = '2015-12-29'; // amended 2015-10-30 + 60 days
const EFF_4962_F2 = '2014-08-29'; // amended 2014-06-30 + 60 days

const WIDTH_BAND_IN = ftIn(14);

// ── Escort rules (67 Pa. Code §179.10) ────────────────────────────────────

function escortRule(
  id: string,
  description: string,
  when: EscortRule['when'],
  then: EscortRule['then'],
  source: SourceDoc = PA_CODE_179,
  effectiveFrom: string = EFF_179,
): EscortRule {
  return { id, jurisdiction: 'PA', description, when, then, source, effectiveFrom, effectiveTo: null };
}

/**
 * Pennsylvania's pilot-car rules.
 *
 * The width rule is POSITION-DEPENDENT but not COUNT-dependent: §179.10 puts
 * the car behind the load "when operating on highways having two or more lanes
 * which carry traffic in the same direction" and in front "on highways having
 * only one lane which carries traffic in the same direction". One car either
 * way, so the rule emits a bare `escorts: 1` and a quote does not need the road
 * class to price it. A real route that mixes both kinds of highway can end up
 * carrying a car in each position, which is why a broker quote for the same
 * load may show two — that is an operational consequence of the route, not a
 * second requirement in the regulation, and it is called out on the advisory.
 */
export const PENNSYLVANIA_ESCORT_RULES: EscortRule[] = [
  escortRule(
    'pa-width-over-13',
    'Over 13 ft wide — one pilot car (following on a highway with two or more lanes in the direction of travel, preceding where there is only one)',
    { kind: 'gt', measure: 'widthIn', value: ftIn(13) },
    { escorts: 1 },
  ),
  escortRule(
    'pa-height-over-14-6',
    'Over 14 ft 6 in high — one pilot car preceding by 1,000–3,000 ft with a height pole, on all highways',
    { kind: 'gt', measure: 'heightIn', value: ftIn(14, 6) },
    { escorts: 1, front: 1, heightPole: true },
  ),
  escortRule(
    'pa-length-over-90',
    'Over 90 ft long — one pilot car following, on all highways',
    { kind: 'gt', measure: 'overallLengthIn', value: ftIn(90) },
    { escorts: 1, rear: 1 },
  ),
  escortRule(
    'pa-rear-extension-over-15',
    'Load extending more than 15 ft beyond the rear of the combination — one pilot car following, on all highways',
    { kind: 'gt', measure: 'rearOverhangIn', value: ftIn(15) },
    { escorts: 1, rear: 1 },
  ),
  /**
   * §4962(f.2) caps the requirement at ONE pilot car for a load that is over
   * 13 ft but not over 14 ft wide AND over 90 ft but not over 120 ft long —
   * exactly the overlap where the width and length rules would otherwise each
   * ask for a car in a different position. The evaluator combines with MAX, so
   * the two rules above already produce one car and the cap needs no arithmetic
   * of its own; what it does need is to be SAID, because it also tells PennDOT
   * (not the carrier) to choose the position.
   */
  escortRule(
    'pa-one-pilot-car-cap',
    'Over 13 ft but not over 14 ft wide and over 90 ft but not over 120 ft long — one pilot car only, positioned front or rear by PennDOT',
    {
      kind: 'all',
      of: [
        { kind: 'between', measure: 'widthIn', min: ftIn(13), max: WIDTH_BAND_IN, minInclusive: false },
        { kind: 'between', measure: 'overallLengthIn', min: ftIn(90), max: ftIn(120), minInclusive: false },
      ],
    },
    {
      escorts: 1,
      advisory:
        '75 Pa.C.S. §4962(f.2): a load over 13 ft but not over 14 ft wide needs only ONE pilot car even where its length would otherwise add a second, and "the position of the pilot car to the front or rear of the permitted vehicle may be determined by the department".',
    },
    PA_4962_F2,
    EFF_4962_F2,
  ),
  /**
   * The police-escort rule is itself a documented conflict, so it does not
   * emit a police count. §179.10 (1993) says an escort by State or local police
   * "shall be required" for every super load, unconditionally. §4962(f.6)
   * (2015) says a super load needs one CERTIFIED escort vehicle "unless
   * otherwise determined ... that an additional certified escort vehicle or a
   * Pennsylvania State Police escort is necessary", and PennDOT's current
   * policy lets a certified escort cover loads up to 18 ft wide or 260 ft long
   * on multi-lane highways. Later law makes the police escort conditional; the
   * older regulation is still published. Neither reading can be priced anyway —
   * PennDOT publishes no trooper rate at all.
   */
  escortRule(
    'pa-superload-police-conflict',
    'Super load, or a building over 16 ft wide — police escort requirement, on which the regulation and the later statute disagree',
    {
      kind: 'any',
      of: [
        { kind: 'gt', measure: 'widthIn', value: ftIn(16) },
        { kind: 'gt', measure: 'overallLengthIn', value: ftIn(160) },
        { kind: 'gt', measure: 'grossWeightLbs', value: 201000 },
      ],
    },
    {
      manualReview:
        '67 Pa. Code §179.10 (1993) requires a uniformed State or local police escort for every super load, while 75 Pa.C.S. §4962(f.6) (2015) requires one certified escort vehicle unless PennDOT determines a State Police escort is necessary, and PennDOT\'s current policy allows a certified escort up to 18 ft wide or 260 ft long on highways with at least two lanes in one direction. The two cannot be reconciled from the published sources, and Pennsylvania publishes no trooper rate — "State escort fees vary based on escort personnel status (e.g., overtime) and will be invoiced separately". No police-escort requirement or cost is quoted.',
    },
    PA_4962_F6,
    EFF_3108,
  ),
  /**
   * Pennsylvania's condition-based escort triggers and its unpriced charges, on
   * one advisory. Condition-based means they depend on what the ISSUED PERMIT
   * says — bridge speed restrictions, single-vehicle-on-span conditions — which
   * cannot be known before the permit exists. Modelling them as `subjective`
   * conditions would make every Pennsylvania quote undecidable; ignoring them
   * would make the escort count look more certain than it is.
   */
  escortRule(
    'pa-permit-conditions-and-unpriced',
    'Pennsylvania adds escort and cost conditions that are set when the permit issues, and publishes no price for several of them',
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
        'Pennsylvania sets further escort conditions on the permit itself: "If the permit requires the permitted vehicle to travel over bridges at reduced speeds, a pilot car shall follow", and where the permit requires the load to be alone on a span or to occupy more than one lane, pilot cars must precede AND follow on each such bridge. There is no fixed weight that triggers this — it depends on the route\'s structures. Pennsylvania also publishes no numeric State Police escort rate, no inspection/weighing charge ("calculated either on an actual cost basis or a standard unit cost basis"), no route-survey cost and no engineering-review fee; none is included above. Note too that §179.10 positions ONE pilot car behind the load on multi-lane highways and in front on single-lane ones, so a route using both may in practice need a car in each position.',
    },
  ),
];

// ── Fee bands — the conflict, preserved ───────────────────────────────────

/**
 * FOUR ROWS, TWO SCHEDULES, ONE UNRESOLVED DISAGREEMENT.
 *
 * Bands are mutually exclusive WITHIN each schedule and overlap ACROSS them,
 * which is exactly right: a 13 ft 6 in load matches the PDF's $46 row and the
 * statute's $35 row, the resolver sees two in-effect candidates with different
 * values, and Pennsylvania prices as a range with manual review.
 *
 * The inclusivity flags carry the boundary wording verbatim:
 *   - "If < 14' wide"      → `upToWidthIn { 168, inclusive: true }`  (out at 168)
 *   - "width up to 14 feet"→ `upToWidthIn { 168, inclusive: false }` (in at 168)
 */
const oversizeFeeBands: Sourced<OversizeFeeBand>[] = [
  fromDated<OversizeFeeBand>(
    {
      label: 'under 14 ft wide — PennDOT current schedule',
      upToWidthIn: { value: WIDTH_BAND_IN, inclusive: true },
      feeUsd: 46,
    },
    PA_FEE_PDF,
    EFF_FEE_PDF,
    'Row "66 - A Vehicle (Oversize) Single Trip $46 (If < 14\' wide)". The notation is strictly "< 14\'", so a load of exactly 14 ft is NOT in this band.',
  ),
  fromDated<OversizeFeeBand>(
    {
      label: 'over 14 ft wide — PennDOT current schedule',
      overWidthIn: { value: WIDTH_BAND_IN, inclusive: false },
      feeUsd: 97,
    },
    PA_FEE_PDF,
    EFF_FEE_PDF,
    '"$97 (If > 14\' wide)". Strictly "> 14\'", so a load of exactly 14 ft is not in this band either — the current PDF assigns that width to no band at all.',
  ),
  fromDated<OversizeFeeBand>(
    {
      label: 'up to 14 ft wide — 75 Pa.C.S. §1942 statutory amount',
      upToWidthIn: { value: WIDTH_BAND_IN, inclusive: false },
      feeUsd: 35,
    },
    PA_1942,
    EFF_1942,
    '"(1) Oversize vehicle or load, or both, having a width up to 14 feet and not exceeding legal weight limit, $35." Retained, not discarded: §1904 CPI-adjusts every Title 75 fee every 24 months and PennDOT\'s adjusted figure is $46, but §1942 has not been amended and still prints $35. Both are official; the engine reports the spread rather than choosing.',
  ),
  fromDated<OversizeFeeBand>(
    {
      label: 'over 14 ft wide — 75 Pa.C.S. §1942 statutory amount',
      overWidthIn: { value: WIDTH_BAND_IN, inclusive: false },
      feeUsd: 71,
    },
    PA_1942,
    EFF_1942,
    '"(2) Oversize vehicle or load, or both, having a width exceeding 14 feet and not exceeding any legal weight limit, $71." The CPI-adjusted counterpart is $97.',
  ),
];

/**
 * The overweight rate, recorded PER POUND rather than per ton on purpose.
 *
 * §1942(a)(3) says "4¢ per mile per ton" and publishes NO rounding rule for a
 * fractional ton — that omission is one of Pennsylvania's recorded unknowns.
 * Charging whole tons would force a choice the statute does not make: at
 * 113,000 lb the excess is 16.5 tons, which rounds to $0.64 or $0.68 per mile
 * depending on the direction. Storing $0.00002 per pound-mile is the same
 * arithmetic with no rounding invented: 33,000 lb × $0.00002 = $0.66 per mile.
 */
const overweightPerMile: Sourced<PerMileRate>[] = [
  fromDated<PerMileRate>(
    {
      minLbs: 80001,
      maxLbs: null,
      ratePerMileUsd: 0.00002,
      perIncrementLbs: 1,
      excessBaseLbs: 80000,
      roundIncrementUp: false,
      minimumUsd: null,
      maximumUsd: null,
    },
    PA_1942,
    EFF_1942,
    '"Vehicle and load weighing in excess of legal weight limit, 4¢ per mile per ton by which the gross weight exceeds the REGISTERED gross weight." Two caveats travel with this row. (1) The statute measures the excess from the registered gross weight, which a quote does not collect; 80,000 lb — the statutory maximum a combination may be registered at — is used, so a truck registered LOWER than 80,000 lb owes MORE than this computes. (2) No rounding rule for a fractional ton or a fractional mile is published anywhere, so none is applied.',
  ),
];

// ── The jurisdiction ──────────────────────────────────────────────────────

export const PENNSYLVANIA_OSOW_RULES: JurisdictionOsowRules = {
  code: 'PA',
  name: 'Pennsylvania',
  country: 'US',

  legalLimits: {
    widthIn: [
      fromDated(
        102,
        PA_4921,
        EFF_4921,
        '§4921: "The total outside width of a vehicle, including any load, shall not exceed eight feet six inches except as otherwise provided in this section."',
      ),
    ],
    heightIn: [
      fromDated(
        ftIn(13, 6),
        PA_4922,
        EFF_4922,
        '§4922: "No vehicle, including any load, shall exceed a height of 13 feet 6 inches." The section adds that public authorities are not required to provide clearance for it.',
      ),
    ],
    trailerLengthIn: [
      fromDated(
        ftIn(53),
        PA_4923,
        EFF_4923,
        '§4923: "The length of a single trailer being towed by a truck or truck tractor shall not exceed 53 feet." A 41 ft kingpin-to-rear-axle limit also applies and is not modelled — a quote does not collect the kingpin distance.',
      ),
    ],
    // `overallLengthIn` is absent: Pennsylvania states no single overall length
    // for a tractor/single-trailer combination in §4923 — it regulates the
    // trailer and the kingpin distance instead. `frontOverhangIn` and
    // `rearOverhangIn` are absent for the same kind of reason: the only
    // overhang figure Pennsylvania publishes is the 15 ft rear extension that
    // triggers a pilot car, which lives in the escort rules above.
    grossWeightLbs: [
      fromDated(
        80000,
        PA_4941,
        EFF_4941,
        '§4941: "no combination driven upon a highway shall have a gross weight exceeding 80,000 pounds, or the applicable weight set as forth in subsection (b) or (c), whichever is less." §4941(d) allows a natural-gas or battery-electric vehicle up to 2,000 lb more, limited to the qualifying equipment-weight difference; powertrain is not collected on a quote, so the allowance is recorded and not applied.',
      ),
    ],
    singleAxleLbs: [
      fromDated(
        20000,
        PA_4943,
        EFF_4943,
        '§4943(1): "The maximum axle weight upon a steering axle shall not exceed 20,000 pounds", and a combination over 73,280 lb may not exceed 20,000 lb on any single non-steering axle. Every axle is additionally capped at the lesser of this and the manufacturer\'s rated capacity, which a quote does not collect.',
      ),
    ],
    tandemAxleLbs: [
      fromDated(
        34000,
        PA_CODE_185,
        '1981-01-17',
        'From the Chapter 185 Bridge Formula Table, "For Determining Maximum Axle Weights When Registered and Gross Weight Exceed 73,280 Pounds": a 2-axle group at 4 ft centre-to-centre is 34,000 lb. Pennsylvania publishes NO universal tandem figure independent of spacing — group limits rise with spacing — so 34,000 lb is the closest-spaced case and is a floor, not a general rule.',
      ),
    ],
  },

  /**
   * A SOURCED ZERO. Pennsylvania's single-trip fee is the banded amount and
   * nothing else — the fee schedule shows no flat issuance charge on top of the
   * $46/$97 row. Recorded rather than omitted so the absence is a finding, and
   * suppressed from the printed lines by the engine so a quote does not show a
   * "$0.00 permit" beside a real fee.
   */
  permitBaseFeeUsd: [
    fromDated(
      0,
      PA_FEE_PDF,
      EFF_FEE_PDF,
      'The single-trip rows print one banded amount ("$46 (If < 14\' wide) + .04 ton-mile for overweight") with no separate issuance charge. The whole oversize fee is in `oversizeFeeBands`.',
    ),
  ],

  oversizeFeeBands,

  /**
   * No `combinedFeeRule` row: Pennsylvania is cumulative, which is the engine's
   * default. §1942(b): "Fees under subsection (a) are cumulative so that a
   * vehicle and load which are both oversize and overweight would be subject to
   * a fee under subsection (a)(1) or (2) and subsection (a)(3)."
   */

  overweightPricing: [
    fromDated<OverweightPricing>(
      {
        kind: 'perMile',
        explanation:
          '75 Pa.C.S. §1942(a)(3) prices the overweight component per mile per ton of excess, with no weight bands and no per-axle schedule.',
      },
      PA_1942,
      EFF_1942,
    ),
    fromDated<OverweightPricing>(
      {
        kind: 'perMile',
        explanation:
          'PennDOT\'s current schedule prints the same structure beside every single-trip row: "+ .04 ton-mile for overweight".',
      },
      PA_FEE_PDF,
      EFF_FEE_PDF,
    ),
  ],

  overweightBands: [],
  overweightPerMile,
  conditionalFees: [],

  /**
   * $1.00 per transaction, and no percentage. The APRAS supplemental agreement
   * is explicit: "APPLICANT is responsible for the cost of telephone lines and
   * usage and a per transaction surcharge of One Dollar ($1.00)". No
   * percentage-based surcharge was located in the fee schedule, in §179.9's
   * additional-fee provisions, or in the current APRAS agreement.
   */
  transactionFee: [
    fromDated<TransactionFee>(
      { perPermitUsd: 1, percentOfTotal: 0 },
      PA_APRAS_AGREEMENT,
      '2025-01-01',
      'Applies to APRAS electronic-access transactions, which is how single-trip permits are ordinarily issued. Pennsylvania publishes no percentage surcharge.',
    ),
  ],

  /**
   * Empty, and that is the finding. Pennsylvania publishes NO separately priced
   * engineering-review fee. What it does publish for a super load is a
   * preliminary fee of "$68 + $12/County" — county-count dependent, and a quote
   * does not know the county count — so no amount is recorded here and the
   * super-load path states the exclusion instead.
   */
  routeAnalysisFeeUsd: [],
  noBridgeRouteFeeUsd: [],

  superload: {
    grossWeight: [
      fromDated<Threshold>(
        { value: 201000, inclusive: false },
        PA_3108,
        EFF_3108,
        '"A vehicle or combination or load having a gross weight exceeding 201,000 pounds" — exclusive.',
      ),
    ],
    shortSpacing: [],
    widthIn: [
      fromDated<Threshold>({ value: ftIn(16), inclusive: false }, PA_3108, EFF_3108, '"a total width exceeding 16 feet"'),
    ],
    overallLengthIn: [
      fromDated<Threshold>({ value: ftIn(160), inclusive: false }, PA_3108, EFF_3108, '"a total length exceeding 160 feet"'),
    ],
    // No `heightIn` row, and that is deliberate. PennDOT's own quick-reference
    // guide lists the super-load thresholds and prints "Height - Not Specified".
    // An overheight load still needs a route survey and a height-pole escort;
    // it just is not a super load on height alone.
  },

  /**
   * Pennsylvania's route survey has ONE published dimensional trigger and it is
   * on height: "Any load exceeding 14'6" high will require a M-936 ARS (Route
   * Survey)". A survey is also required for every super load, which the super
   * load path already handles. No width or length trigger is published, so
   * those lists are empty rather than guessed.
   */
  routeInspection: {
    widthIn: [],
    heightIn: [
      fromDated<Threshold>({ value: ftIn(14, 6), inclusive: false }, PA_APRAS_FAQ, '2020-02-19'),
    ],
    lengthIn: [],
  },

  escortRules: PENNSYLVANIA_ESCORT_RULES,

  /**
   * TRUE. The overweight component is "4¢ per mile per ton", so Pennsylvania
   * cannot be priced at all without miles travelled inside Pennsylvania. The
   * engine refuses rather than billing the whole lane to one state.
   */
  feesDependOnDistance: true,
};

/**
 * PennDOT's certified-escort programme, recorded for completeness and NOT
 * priced. Certification is mandatory for the driver of a certified escort
 * vehicle escorting a super load (21 years old, 3 years' experience, 8 hours of
 * classroom training), Pennsylvania accepts classes from Virginia, Georgia,
 * North Carolina, the Colorado/Utah RSA Network, Florida and Washington, and it
 * publishes NO application, card or renewal fee and NO validity period. A
 * pilot-car operator's certification cost is the operator's, not the state's,
 * and never belongs in a permit subtotal.
 */
export const PENNSYLVANIA_ESCORT_CERTIFICATION_SOURCE = PA_CEV_POLICY;

/** Cited for the CPI mechanism that explains the $35/$46 gap. See the header. */
export const PENNSYLVANIA_CPI_SOURCE = PA_1904;

/** Cited for the super-load preliminary fee and the "escort fees vary" note. */
export const PENNSYLVANIA_QUICK_REFERENCE_SOURCE = PA_QUICK_REF;
