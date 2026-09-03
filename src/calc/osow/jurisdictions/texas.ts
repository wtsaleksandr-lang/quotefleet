/**
 * TEXAS — oversize/overweight single-trip permit rules.
 *
 * The first jurisdiction, and the proof that the model in `types.ts` holds
 * without special-casing. Every number below is a `Sourced<T>` carrying its
 * URL, the source document's OWN revision date, our retrieval date, and an
 * effective window.
 *
 * TWO THINGS TO KNOW BEFORE TRUSTING ANY NUMBER HERE
 * --------------------------------------------------
 *
 * 1. THE FEE SCHEDULE PDF IS DATED FEBRUARY 2021. It is still the live linked
 *    fee schedule on TxDMV.gov and its figures agree with both the current
 *    HTML pages and Transportation Code 623.077 — but it is five and a half
 *    years old, and "TxDMV publishes it today" is not the same claim as
 *    "TxDMV revised it today". `revisedOn` records 2021-02-01 for exactly
 *    that reason. If a fee changes, it will land on the HTML pages first.
 *
 * 2. MOST TxDMV HTML PAGES CARRY NO DATE AT ALL. For those, `revisedOn` is
 *    `null` and `effectiveFrom` is our RETRIEVAL date — not an earlier date
 *    we would like to be true. We know what the page said on 2026-08-31; we
 *    do not know what it said in 2024, so a backdated quote correctly finds
 *    nothing on file and asks for review rather than inventing history.
 *
 * SOURCE-QUALITY CAVEAT: statutes.capitol.texas.gov and texreg.sos.state.tx.us
 * (the official statute and rule hosts) were both unreachable during
 * collection — the SOS rules portal has migrated. Statutory and TAC figures
 * below therefore come from FindLaw and Cornell LII, which reproduce official
 * text but are SECONDARY publishers. Each such source is marked in its title.
 * Where a secondary source is corroborated by a TxDMV page the agreement is
 * recorded as two rows, which the resolver reads as corroboration rather than
 * conflict.
 */
import type { SourceDoc, Sourced } from '../provenance.js';
import { ftIn, type EscortRule } from '../escortRules.js';
import type {
  JurisdictionOsowRules,
  ConditionalFee,
  OverweightPricing,
  Threshold,
  TransactionFee,
  WeightBand,
} from '../types.js';

const RETRIEVED = '2026-08-31';

// ── Source documents ──────────────────────────────────────────────────────

/** The live fee schedule. Carries a February 2021 revision footer. */
const FEE_PDF: SourceDoc = {
  id: 'txdmv-fee-pdf-2021-02',
  title: 'TxDMV — Oversize/Overweight Permit Fees and Credit Card Payments (PDF)',
  url: 'https://www.txdmv.gov/sites/default/files/body-files/Table_of_Permit_Fees_and_Credit_Card_Payments.pdf',
  publisher: 'Texas Department of Motor Vehicles',
  revisedOn: '2021-02-01',
  retrievedOn: RETRIEVED,
  cite: 'single-page fee table; "February 2021" footer',
};

const GENERAL_SINGLE_TRIP: SourceDoc = {
  id: 'txdmv-general-single-trip',
  title: 'TxDMV — General Single-Trip Permits',
  url: 'https://www.txdmv.gov/motor-carriers/oversize-overweight-permits/general-single-trip',
  publisher: 'Texas Department of Motor Vehicles',
  revisedOn: null,
  retrievedOn: RETRIEVED,
};

const SUPERHEAVY: SourceDoc = {
  id: 'txdmv-superheavy-single-trip',
  title: 'TxDMV — Superheavy Single-Trip Permits',
  url: 'https://www.txdmv.gov/motor-carriers/oversize-overweight-permits/superheavy-single-trip',
  publisher: 'Texas Department of Motor Vehicles',
  revisedOn: null,
  retrievedOn: RETRIEVED,
};

const SIZE_WEIGHT_LIMITS: SourceDoc = {
  id: 'txdmv-size-weight-limits',
  title: 'TxDMV — Texas Size and Weight Limits',
  url: 'https://www.txdmv.gov/motor-carriers/oversize-overweight-permits/texas-size-weight-limits',
  publisher: 'Texas Department of Motor Vehicles',
  revisedOn: null,
  retrievedOn: RETRIEVED,
};

const ESCORT_REQUIREMENTS: SourceDoc = {
  id: 'txdmv-escort-requirements',
  title: 'TxDMV — Escort and Equipment Requirements',
  url: 'https://www.txdmv.gov/motor-carriers/oversize-overweight-permits/escort-and-equipment-requirements',
  publisher: 'Texas Department of Motor Vehicles',
  revisedOn: null,
  retrievedOn: RETRIEVED,
};

const TRANSP_621_101: SourceDoc = {
  id: 'tx-transp-621-101',
  title: 'Tex. Transp. Code §621.101 (via FindLaw — SECONDARY source)',
  url: 'https://codes.findlaw.com/tx/transportation-code/transp-sect-621-101/',
  publisher: 'FindLaw, reproducing the Texas Transportation Code',
  revisedOn: '2026-01-01',
  retrievedOn: RETRIEVED,
  cite: 'axle and gross weight limits; "current as of January 01, 2026"',
};

const TRANSP_621_201: SourceDoc = {
  id: 'tx-transp-621-201',
  title: 'Tex. Transp. Code §621.201 (via FindLaw — SECONDARY source)',
  url: 'https://codes.findlaw.com/tx/transportation-code/transp-sect-621-201/',
  publisher: 'FindLaw, reproducing the Texas Transportation Code',
  revisedOn: '2026-01-01',
  retrievedOn: RETRIEVED,
  cite: 'width limit, expressed as 102 inches',
};

const TRANSP_621_207: SourceDoc = {
  id: 'tx-transp-621-207',
  title: 'Tex. Transp. Code §621.207 (via FindLaw — SECONDARY source)',
  url: 'https://codes.findlaw.com/tx/transportation-code/transp-sect-621-207/',
  publisher: 'FindLaw, reproducing the Texas Transportation Code',
  revisedOn: '2026-01-01',
  retrievedOn: RETRIEVED,
  cite: 'height limit',
};

const TRANSP_623_076: SourceDoc = {
  id: 'tx-transp-623-076',
  title: 'Tex. Transp. Code §623.076 (via FindLaw — SECONDARY source)',
  url: 'https://codes.findlaw.com/tx/transportation-code/transp-sect-623-076/',
  publisher: 'FindLaw, reproducing the Texas Transportation Code',
  revisedOn: '2026-01-01',
  retrievedOn: RETRIEVED,
  cite: '$60 single-trip permit fee; §623.076(b-1) authorises the service charge',
};

const TRANSP_623_077: SourceDoc = {
  id: 'tx-transp-623-077',
  title: 'Tex. Transp. Code §623.077 (via FindLaw — SECONDARY source)',
  url: 'https://codes.findlaw.com/tx/transportation-code/transp-sect-623-077/',
  publisher: 'FindLaw, reproducing the Texas Transportation Code',
  revisedOn: '2026-01-01',
  retrievedOn: RETRIEVED,
  cite: 'highway maintenance fee bands',
};

const TAC_219_11: SourceDoc = {
  id: 'tx-43-tac-219-11',
  title: '43 Tex. Admin. Code §219.11 (via Cornell LII — SECONDARY source)',
  url: 'https://www.law.cornell.edu/regulations/texas/43-Tex-Admin-Code-SS-219-11',
  publisher: 'Cornell Legal Information Institute, reproducing 43 TAC',
  revisedOn: '2024-07-18',
  retrievedOn: RETRIEVED,
  cite: 'escort requirements (k); route inspection triggers (h)(4), (i)(7), (j)(2); amended eff. 2024-07-18, 49 Tex. Reg. 28',
};

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * A row from the February 2021 fee PDF. Effective from the PDF's own revision
 * date — the earliest date we can defend the figure being published.
 */
function fromFeePdf<T>(value: T, note?: string): Sourced<T> {
  return {
    value,
    source: FEE_PDF,
    effectiveFrom: '2021-02-01',
    effectiveTo: null,
    ...(note === undefined ? {} : { note }),
  };
}

/**
 * A row from an UNDATED page. `effectiveFrom` is the retrieval date, because
 * that is the only date on which we can prove the page said this. Claiming an
 * earlier start would be manufacturing history.
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

// ── Escort rules (43 TAC §219.11(k)) ──────────────────────────────────────

const ESCORT_EFFECTIVE_FROM = '2024-07-18'; // TAC amendment effective date

function escortRule(
  id: string,
  description: string,
  when: EscortRule['when'],
  then: EscortRule['then'],
  source: SourceDoc = ESCORT_REQUIREMENTS,
): EscortRule {
  return {
    id,
    jurisdiction: 'TX',
    description,
    when,
    then,
    source,
    effectiveFrom: ESCORT_EFFECTIVE_FROM,
    effectiveTo: null,
  };
}

/**
 * Texas escorts. Note how the WIDTH and LENGTH rules use a bare `escorts`
 * count rather than front/rear: Texas positions that single escort in FRONT
 * on a two-lane road and in the REAR on a multi-lane one. The count — the
 * thing that costs money — is one either way, so the quote does not need the
 * road type to price it correctly.
 */
export const TEXAS_ESCORT_RULES: EscortRule[] = [
  escortRule(
    'tx-width-14-to-16',
    'Over 14 ft up to 16 ft wide — one escort (front on a two-lane road, rear on a multi-lane road)',
    {
      kind: 'all',
      of: [
        { kind: 'gt', measure: 'widthIn', value: ftIn(14) },
        { kind: 'between', measure: 'widthIn', min: ftIn(14), max: ftIn(16) },
      ],
    },
    { escorts: 1 },
  ),
  escortRule(
    'tx-width-over-16',
    'Over 16 ft wide — two escorts, front and rear, on all roads',
    { kind: 'gt', measure: 'widthIn', value: ftIn(16) },
    { escorts: 2, front: 1, rear: 1 },
  ),
  escortRule(
    'tx-height-over-17',
    'Over 17 ft high — one front escort carrying a non-conductive height pole',
    { kind: 'gt', measure: 'heightIn', value: ftIn(17) },
    { escorts: 1, front: 1, heightPole: true },
  ),
  escortRule(
    'tx-height-over-18',
    'Over 18 ft high — two escorts, front and rear, on all roads',
    { kind: 'gt', measure: 'heightIn', value: ftIn(18) },
    { escorts: 2, front: 1, rear: 1, heightPole: true },
  ),
  escortRule(
    'tx-length-110-to-125',
    'Over 110 ft up to 125 ft long — one escort (front on a two-lane road, rear on a multi-lane road)',
    {
      kind: 'all',
      of: [
        { kind: 'gt', measure: 'overallLengthIn', value: ftIn(110) },
        {
          kind: 'between',
          measure: 'overallLengthIn',
          min: ftIn(110),
          max: ftIn(125),
        },
      ],
    },
    { escorts: 1 },
  ),
  escortRule(
    'tx-length-over-125',
    'Over 125 ft long — two escorts, front and rear, on all roads',
    { kind: 'gt', measure: 'overallLengthIn', value: ftIn(125) },
    { escorts: 2, front: 1, rear: 1 },
  ),
  escortRule(
    'tx-front-overhang-over-20',
    'Front overhang over 20 ft — one rear escort',
    { kind: 'gt', measure: 'frontOverhangIn', value: ftIn(20) },
    { escorts: 1, rear: 1 },
  ),
  escortRule(
    'tx-rear-overhang-over-20',
    'Rear overhang over 20 ft — one rear escort',
    { kind: 'gt', measure: 'rearOverhangIn', value: ftIn(20) },
    { escorts: 1, rear: 1 },
  ),
  /**
   * The compound rule. "If a load exceeds escort thresholds in TWO dimensions,
   * both a front and a rear escort are required." Written as a 2-of-N over the
   * other rules' outcomes — no new grammar was needed, and adding a ninth
   * dimension later means adding one line to `of`, not rewriting the rule.
   */
  escortRule(
    'tx-two-dimensions',
    'Over the escort threshold in two or more dimensions — both a front and a rear escort are required',
    {
      kind: 'atLeast',
      count: 2,
      of: [
        { kind: 'any', of: [
          { kind: 'ruleApplies', ruleId: 'tx-width-14-to-16' },
          { kind: 'ruleApplies', ruleId: 'tx-width-over-16' },
        ] },
        { kind: 'any', of: [
          { kind: 'ruleApplies', ruleId: 'tx-height-over-17' },
          { kind: 'ruleApplies', ruleId: 'tx-height-over-18' },
        ] },
        { kind: 'any', of: [
          { kind: 'ruleApplies', ruleId: 'tx-length-110-to-125' },
          { kind: 'ruleApplies', ruleId: 'tx-length-over-125' },
        ] },
        { kind: 'any', of: [
          { kind: 'ruleApplies', ruleId: 'tx-front-overhang-over-20' },
          { kind: 'ruleApplies', ruleId: 'tx-rear-overhang-over-20' },
        ] },
      ],
    },
    { escorts: 2, front: 1, rear: 1 },
  ),
  /**
   * Police escorts in Texas have NO numeric trigger. 43 TAC §219.11 says law
   * enforcement "may be required by TxDOT to control traffic" inside city
   * limits or wherever TxDOT judges it necessary. That is discretionary, so
   * modelling it as a threshold would invent a rule the state did not write —
   * and forcing every Texas quote to manual review over the possibility would
   * make the engine useless. It is an ADVISORY: the price stands, and the
   * exclusion is stated on the quote.
   */
  escortRule(
    'tx-police-discretionary',
    'Police escort — discretionary, no published threshold',
    { kind: 'gt', measure: 'widthIn', value: ftIn(14) },
    {
      advisory:
        'TxDOT may require law-enforcement traffic control inside city limits or wherever it judges it necessary for safety. 43 TAC §219.11 sets no width, height, or length threshold that triggers this automatically, so no police-escort cost is included in this quote.',
    },
    TAC_219_11,
  ),
];

// ── The jurisdiction ──────────────────────────────────────────────────────

/**
 * Highway maintenance fee, Transp. Code §623.077. Weight-banded ONLY.
 *
 * Texas's general single-trip OS/OW permit has NO mileage component — the fee
 * is a flat step by gross weight. (Texas does have per-mile permits, but they
 * are different products: mobile crane, well-service unit, unladen lift
 * equipment. Conflating them would inflate every heavy-haul quote by the lane
 * length.) `feesDependOnDistance` is therefore false, which is why Phase 1 is
 * complete without per-state mileage splitting.
 *
 * Each band is recorded twice — once from the statute (effective from the
 * 2013 amendment) and once from the February 2021 fee PDF. They agree, so the
 * resolver treats them as corroboration and cites the newer document.
 */
const HMF_BANDS: Array<{ min: number; max: number | null; fee: number }> = [
  { min: 80001, max: 120000, fee: 150 },
  { min: 120001, max: 160000, fee: 225 },
  { min: 160001, max: 200000, fee: 300 },
  { min: 200001, max: null, fee: 375 },
];

const overweightBands: Sourced<WeightBand>[] = HMF_BANDS.flatMap((b) => [
  fromDated<WeightBand>(
    { minLbs: b.min, maxLbs: b.max, feeUsd: b.fee },
    TRANSP_623_077,
    // Last amended by Acts 2013, 83rd Leg., HB 2202, effective 2013-09-01.
    '2013-09-01',
  ),
  fromFeePdf<WeightBand>({ minLbs: b.min, maxLbs: b.max, feeUsd: b.fee }),
]);

export const TEXAS_OSOW_RULES: JurisdictionOsowRules = {
  code: 'TX',
  name: 'Texas',
  country: 'US',

  legalLimits: {
    // The statute says 102 inches; TxDMV says 8 ft 6 in. Same value in
    // different units — normalised to inches here so it reads as the
    // corroboration it is, not a false conflict.
    widthIn: [
      fromDated(102, TRANSP_621_201, '2026-01-01', 'statute states 102 inches'),
      fromUndatedPage(102, SIZE_WEIGHT_LIMITS, 'page states 8 ft 6 in'),
    ],
    heightIn: [
      fromDated(ftIn(14), TRANSP_621_207, '2026-01-01'),
      fromUndatedPage(ftIn(14), SIZE_WEIGHT_LIMITS),
    ],
    trailerLengthIn: [
      fromUndatedPage(
        ftIn(59),
        SIZE_WEIGHT_LIMITS,
        'semitrailer in a truck-tractor/semitrailer combination, excluding the towing device (Transp. Code §621.204)',
      ),
    ],
    frontOverhangIn: [fromUndatedPage(ftIn(3), SIZE_WEIGHT_LIMITS)],
    rearOverhangIn: [fromUndatedPage(ftIn(4), SIZE_WEIGHT_LIMITS)],
    /**
     * 80,000 lb is TxDMV's simplification. Transp. Code §621.101 does not
     * state a flat number — it adopts the federal bridge formula, and
     * §621.101(b-1) additionally allows natural-gas and battery-electric
     * vehicles up to 2,000 lb more, capped at 82,000. The bridge formula is
     * implemented in `bridgeFormula.ts`; the NGV/EV allowance is recorded
     * here as a note rather than silently applied, because we do not collect
     * the powertrain on a quote and must not assume it.
     */
    grossWeightLbs: [
      fromUndatedPage(80000, SIZE_WEIGHT_LIMITS),
      fromDated(
        80000,
        TRANSP_621_101,
        '2026-01-01',
        '§621.101 adopts the federal bridge formula rather than a flat cap; §621.101(b-1) allows natural-gas and battery-electric vehicles up to 2,000 lb more, capped at 82,000 lb. Powertrain is not collected on a quote, so the allowance is not applied.',
      ),
    ],
    singleAxleLbs: [
      fromDated(20000, TRANSP_621_101, '2026-01-01', 'includes all enforcement tolerances'),
      fromUndatedPage(20000, SIZE_WEIGHT_LIMITS),
    ],
    tandemAxleLbs: [
      fromDated(34000, TRANSP_621_101, '2026-01-01', 'includes all enforcement tolerances'),
      fromUndatedPage(34000, SIZE_WEIGHT_LIMITS),
    ],
  },

  /** $60, corroborated by three independent sources. */
  permitBaseFeeUsd: [
    fromDated(60, TRANSP_623_076, '2026-01-01'),
    fromFeePdf(60),
    fromUndatedPage(60, GENERAL_SINGLE_TRIP),
  ],

  /**
   * Texas steps the overweight charge by gross weight and charges nothing per
   * mile. Recorded explicitly rather than inferred from a populated
   * `overweightBands`, so that a state with an EMPTY band list is unambiguous:
   * it either folds overweight into one fee or we have not sourced it, and
   * only the model row can tell those apart.
   */
  overweightPricing: [
    fromDated<OverweightPricing>(
      {
        kind: 'bands',
        explanation:
          'Transp. Code §623.077 sets a highway maintenance fee in four flat gross-weight steps. The general single-trip permit has no mileage component.',
      },
      TRANSP_623_077,
      '2013-09-01',
    ),
    fromFeePdf<OverweightPricing>({
      kind: 'bands',
      explanation:
        'The TxDMV fee table prints one flat total per weight band, with no per-mile column.',
    }),
  ],

  overweightBands,

  /** Texas's general single-trip permit has no distance-priced component. */
  overweightPerMile: [],

  /**
   * Vehicle Supervision Fee — $35 on loads over 200,000 lb. This is what
   * makes the published 200,001–254,300 lb total $470 rather than $435:
   * $60 base + $375 highway maintenance + $35 VSF.
   */
  conditionalFees: [
    fromFeePdf<ConditionalFee>(
      {
        appliesAbove: { value: 200000, inclusive: false },
        feeUsd: 35,
      },
      'Vehicle Supervision Fee. $60 + $375 + $35 = the $470 total the PDF prints for the 200,001–254,300 lb band.',
    ),
    fromUndatedPage<ConditionalFee>(
      { appliesAbove: { value: 200000, inclusive: false }, feeUsd: 35 },
      GENERAL_SINGLE_TRIP,
    ),
  ],

  /**
   * Texas.gov processing: $0.25 per permit PLUS 2.25% of the transaction —
   * percentage-based, not a flat administrative fee. On a $60 permit that is
   * about $1.61, and the PDF's own printed totals confirm the arithmetic
   * ($60 × 1.0225 + $0.25 ≈ $61.61; $210 × 1.0225 + $0.25 = $214.98).
   * Authorised by Transp. Code §623.076(b-1).
   */
  transactionFee: [
    fromFeePdf<TransactionFee>({ perPermitUsd: 0.25, percentOfTotal: 2.25 }),
    fromUndatedPage<TransactionFee>(
      { perPermitUsd: 0.25, percentOfTotal: 2.25 },
      GENERAL_SINGLE_TRIP,
    ),
  ],

  /**
   * $500 is what TxDOT charges to REVIEW a state-approved private engineer's
   * route and bridge analysis. The engineer's own fee is separate, is paid to
   * the engineer, and is not a state charge — so it is not modelled here and
   * the engine says so rather than implying $500 buys the whole survey.
   */
  routeAnalysisFeeUsd: [
    fromFeePdf(500, 'TxDOT review of a state-approved private engineer’s analysis. The engineer’s own fee is separate and is not a state charge.'),
    fromUndatedPage(500, SUPERHEAVY),
  ],

  noBridgeRouteFeeUsd: [
    fromFeePdf(100, 'Applies when the approved route crosses no bridges.'),
    fromUndatedPage(100, SUPERHEAVY),
  ],

  superload: {
    grossWeight: [
      fromUndatedPage<Threshold>(
        { value: 254300, inclusive: false },
        SUPERHEAVY,
      ),
      fromUndatedPage<Threshold>(
        { value: 254300, inclusive: false },
        GENERAL_SINGLE_TRIP,
      ),
    ],
    /**
     * The trigger most often missed: 200,001–254,300 lb on less than 95 ft of
     * axle spacing is a superload in Texas even though it is under the
     * headline weight. A gross-weight-only check reads a 210,000 lb load on a
     * short trailer as an ordinary permit and underprices it by the entire
     * superheavy process.
     */
    shortSpacing: [
      fromUndatedPage(
        { minLbs: 200001, maxLbs: 254300, minAxleSpacingFt: 95 },
        SUPERHEAVY,
      ),
    ],
  },

  /**
   * Dimensional triggers for a physical route inspection.
   *
   * THE HEIGHT ROW IS A GENUINE SOURCE CONFLICT, DELIBERATELY LEFT UNRESOLVED.
   * TxDMV's own page says a route inspection is triggered by height
   * "exceeding 18 ft 11 in"; 43 TAC §219.11(j)(2) as reproduced by Cornell
   * says "19 ft or greater". For whole inches those agree. At 18 ft 11½ in
   * they do not — one triggers an inspection and the other does not.
   *
   * The TAC rule is the law and the TxDMV page is guidance, so the TAC
   * reading probably wins. "Probably" is not good enough to hard-code: the
   * official SOS copy was unreachable, so LII's rendering is itself
   * unverified. Both rows stay on file and the resolver refuses to pick,
   * which surfaces the discrepancy on any quote that lands in the gap
   * instead of silently choosing one.
   */
  routeInspection: {
    widthIn: [
      fromUndatedPage<Threshold>(
        { value: ftIn(20), inclusive: false },
        GENERAL_SINGLE_TRIP,
      ),
      fromDated<Threshold>(
        { value: ftIn(20), inclusive: false },
        TAC_219_11,
        ESCORT_EFFECTIVE_FROM,
        '§219.11(h)(4)',
      ),
    ],
    heightIn: [
      fromUndatedPage<Threshold>(
        { value: ftIn(18, 11), inclusive: false },
        GENERAL_SINGLE_TRIP,
        'TxDMV page: "exceeding 18 ft 11 in"',
      ),
      fromDated<Threshold>(
        { value: ftIn(19), inclusive: true },
        TAC_219_11,
        ESCORT_EFFECTIVE_FROM,
        '§219.11(j)(2): "19 ft or greater" — differs from the TxDMV page in the sub-inch band',
      ),
    ],
    lengthIn: [
      fromUndatedPage<Threshold>(
        { value: ftIn(125), inclusive: false },
        GENERAL_SINGLE_TRIP,
      ),
      fromDated<Threshold>(
        { value: ftIn(125), inclusive: false },
        TAC_219_11,
        ESCORT_EFFECTIVE_FROM,
        '§219.11(i)(7)',
      ),
    ],
  },

  escortRules: TEXAS_ESCORT_RULES,

  /** Texas's general single-trip permit fee has no mileage component. */
  feesDependOnDistance: false,
};

/**
 * The registry that used to live here moved to `./index.ts` when Phase 2 added
 * six more states. Adding a jurisdiction is still exactly two steps: write a
 * data file like this one, and add one line to that registry.
 */
