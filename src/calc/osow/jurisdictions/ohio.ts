/**
 * OHIO — oversize/overweight single-trip permit rules.
 *
 * FOUR THINGS TO KNOW BEFORE TRUSTING A NUMBER HERE
 * -------------------------------------------------
 *
 * 1. THE OVERSIZE CHARGE IS A SURCHARGE, NOT A PERMIT PRICE. OAC 5501:2-1-05
 *    builds every Ohio permit fee the same way: "All permit application
 *    processing fees consist of the basic processing charge of twenty dollars
 *    plus each unit of surcharge that is applicable to that movement." So $20
 *    is the base and $55 / $125 are bands on top of it. That decomposition is
 *    not a guess — it reproduces both totals ODOT publishes in its own guide:
 *    $20 + $55 = the guide's "OS Only $75", and $20 + $125 = its "OS/OW $145".
 *
 * 2. OVERSIZE AND OVERWEIGHT DO NOT ADD IN OHIO. The same rule says: "If a
 *    movement is both overweight and over width and/or over height, only one
 *    basic processing fee ... and the applicable overweight surcharge ... will
 *    be charged." The oversize surcharge is REPLACED. Adding them — which is
 *    what Texas does and what the Phase 1 engine assumed — would bill $200 for
 *    a load Ohio charges $145 for. See `combinedFeeRule`.
 *
 * 3. ABOVE 120,000 lb OHIO IS NOT PRICEABLE FROM A QUOTE. The surcharge stays
 *    $125 but gains "four cents per ton over sixty tons, per mile traveled".
 *    Per-state mileage is not computed yet (see `MILEAGE_SPLIT_NOTE`), so no
 *    band above 120,000 lb is on file and a heavier load correctly produces no
 *    number. `feesDependOnDistance` is nevertheless FALSE, because the distance
 *    component exists only in a band we already refuse to price — setting it
 *    true would send every ordinary Ohio permit to review for a term that does
 *    not apply to it.
 *
 * 4. THE GUIDE IS UNDATED AND THE RULE IS NOT. ODOT's Operational Guide carries
 *    no revision date at all, so every row taken from it is effective only from
 *    our retrieval date. Where the rule and the guide both speak, the rule is
 *    cited: it is the law, it is dated 2023-11-03, and the two agree.
 *
 * WHAT OHIO DOES NOT PUBLISH — recorded as absences, never filled in
 * ------------------------------------------------------------------
 *   - No legal overhang limit. `frontOverhangIn`/`rearOverhangIn` are omitted:
 *     Ohio regulates overhang through FLAGGING (OS-1A: a flag at 4 ft rear
 *     overhang) and not through a numeric legal limit, and no fixed front- or
 *     rear-overhang ESCORT threshold appears anywhere in the current materials.
 *   - No overall combination-length cap for a tractor-semitrailer. ORC 5577.05
 *     caps "any other combination of vehicles coupled together" at 65 ft and
 *     the semitrailer itself at 53 ft; it states no overall figure for a
 *     commercial tractor-semitrailer, so `overallLengthIn` is omitted.
 *   - NO LENGTH SURCHARGE EXISTS. The effective fee rule has no length band at
 *     all, while the undated guide prints a general "OS Only $75" without
 *     saying it covers an overlength-only movement. The bands below are
 *     therefore keyed on width and height only, and an OVERLENGTH-ONLY Ohio
 *     load matches no band — which makes the engine say the published schedule
 *     does not price it instead of quietly charging it the width band.
 *   - No fixed route-survey trigger, no route-survey cost, no special-work or
 *     engineering cost (ODOT bills "the total direct costs incurred"), and no
 *     law-enforcement escort rate. These are carried as an ADVISORY on every
 *     Ohio permit rather than as a review block, because they are real
 *     exclusions from the quote and not defects in it.
 *   - No credit-card processor fee amount. The rule authorises a third-party
 *     processor "at the discretion of the director" and publishes no figure;
 *     what IS published is that Ohio's own calculation is fixed dollars only,
 *     which is recorded as a sourced zero with the unknown noted on the row.
 */
import type { SourceDoc, Sourced } from '../provenance.js';
import { ftIn, type EscortRule } from '../escortRules.js';
import type {
  JurisdictionOsowRules,
  CombinedFeeRule,
  OversizeFeeBand,
  OverweightPricing,
  Threshold,
  TransactionFee,
  WeightBand,
} from '../types.js';

const RETRIEVED = '2026-09-01';

// ── Source documents ──────────────────────────────────────────────────────

const ORC_5577_05: SourceDoc = {
  id: 'oh-orc-5577-05',
  title: 'Ohio Rev. Code §5577.05 — Maximum width, height and length',
  url: 'https://codes.ohio.gov/ohio-revised-code/section-5577.05',
  publisher: 'Ohio Laws and Administrative Rules (Legislative Service Commission)',
  revisedOn: '2013-07-01',
  retrievedOn: RETRIEVED,
  cite: '(B)(5) width; height; (C) length bands',
};

const ORC_5577_04: SourceDoc = {
  id: 'oh-orc-5577-04',
  title: 'Ohio Rev. Code §5577.04 — Maximum axle and gross weights',
  url: 'https://codes.ohio.gov/ohio-revised-code/section-5577.04',
  publisher: 'Ohio Laws and Administrative Rules (Legislative Service Commission)',
  revisedOn: '2001-06-29',
  retrievedOn: RETRIEVED,
  cite: '(B)(1) single axle; (B)(2) tandem axle; (E) 80,000 lb overall cap; (B)(3) bridge formula',
};

/** The fee rule. Dated, effective, and the law — cited in preference to the guide. */
const OAC_FEES: SourceDoc = {
  id: 'oh-oac-5501-2-1-05',
  title: 'Ohio Adm. Code 5501:2-1-05 — Permit application processing fees',
  url: 'https://codes.ohio.gov/ohio-administrative-code/rule-5501%3A2-1-05',
  publisher: 'Ohio Laws and Administrative Rules',
  revisedOn: '2023-11-03',
  retrievedOn: RETRIEVED,
  cite: '(A) basic charge and surcharge units; (A)(1) oversize bands; (A)(2) overweight bands; combination rule',
};

const OAC_ESCORTS: SourceDoc = {
  id: 'oh-oac-5501-2-1-04',
  title: 'Ohio Adm. Code 5501:2-1-04 — Flags, lighting and escort vehicles',
  url: 'https://codes.ohio.gov/ohio-administrative-code/rule-5501%3A2-1-04',
  publisher: 'Ohio Laws and Administrative Rules',
  revisedOn: '2023-11-03',
  retrievedOn: RETRIEVED,
  cite: 'discretionary escorts; flag placement; private escort driver qualification',
};

/**
 * ODOT's Operational Guide. CARRIES NO REVISION DATE AT ALL — `revisedOn` is
 * null and every row from it is effective only from our retrieval date.
 */
const ODOT_GUIDE: SourceDoc = {
  id: 'odot-operational-guide-special-hauling',
  title: 'ODOT — Operational Guide for Vehicles Operating with a Special Hauling Permit',
  url: 'https://www.transportation.ohio.gov/business/publications/operational-guide-special-hauling',
  publisher: 'Ohio Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'single-trip fee tables; superload definition; Section 9 axle limits; law-enforcement escort',
};

/** Form OS-1A, stamped "Rev. 01/18" — the only date the form carries. */
const OS_1A: SourceDoc = {
  id: 'odot-os-1a-2018-01',
  title: 'ODOT Form OS-1A — Limitations and Provisions for Special Hauling Permits (PDF)',
  url: 'https://dam.assets.ohio.gov/image/upload/q_auto/v1751025885/transportation.ohio.gov/permits/special-hauling/os-1a.pdf',
  publisher: 'Ohio Department of Transportation',
  revisedOn: '2018-01-01',
  retrievedOn: RETRIEVED,
  cite: 'escort thresholds; height-sensing device; form stamp "Rev. 01/18" (month only — recorded as the 1st)',
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
 * A row from an UNDATED page — effective from our retrieval date, because that
 * is the only date on which we can prove the page said this.
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

const FEE_RULE_FROM = '2023-11-03'; // OAC 5501:2-1-05 effective date
const ESCORT_FROM = '2018-01-01'; // OS-1A "Rev. 01/18"

// ── Escort rules (Form OS-1A) ─────────────────────────────────────────────

function escortRule(
  id: string,
  description: string,
  when: EscortRule['when'],
  then: EscortRule['then'],
  source: SourceDoc = OS_1A,
  effectiveFrom: string = ESCORT_FROM,
): EscortRule {
  return { id, jurisdiction: 'OH', description, when, then, source, effectiveFrom, effectiveTo: null };
}

/**
 * Ohio's escort table, from OS-1A verbatim.
 *
 * The width rule is the one that needs care: "One lead (rear on multiple lane
 * highways) escort vehicle shall be required ... with a permitted width in
 * excess of 13 feet." One escort either way — only the POSITION moves with the
 * road type — so it is a bare `escorts: 1` and a quote does not need the road
 * class to price it. Ohio's 13 ft trigger is materially lower than Texas's
 * 14 ft: the same 13 ft 6 in load that crosses Texas free needs a pilot car
 * here.
 */
export const OHIO_ESCORT_RULES: EscortRule[] = [
  escortRule(
    'oh-length-over-90',
    'Over 90 ft long — one rear escort',
    { kind: 'gt', measure: 'overallLengthIn', value: ftIn(90) },
    { escorts: 1, rear: 1 },
  ),
  escortRule(
    'oh-width-over-13',
    'Over 13 ft up to 14 ft 6 in wide — one escort (lead on a two-lane highway, rear on a multiple-lane highway)',
    {
      kind: 'all',
      of: [
        { kind: 'gt', measure: 'widthIn', value: ftIn(13) },
        { kind: 'between', measure: 'widthIn', min: ftIn(13), max: ftIn(14, 6) },
      ],
    },
    { escorts: 1 },
  ),
  escortRule(
    'oh-width-over-14-6',
    'Over 14 ft 6 in wide — one lead and one rear escort',
    { kind: 'gt', measure: 'widthIn', value: ftIn(14, 6) },
    { escorts: 2, front: 1, rear: 1 },
  ),
  escortRule(
    'oh-height-over-14-6',
    'Over 14 ft 6 in up to 14 ft 10 in high — one lead escort carrying a height-sensing device',
    {
      kind: 'all',
      of: [
        { kind: 'gt', measure: 'heightIn', value: ftIn(14, 6) },
        { kind: 'between', measure: 'heightIn', min: ftIn(14, 6), max: ftIn(14, 10) },
      ],
    },
    { escorts: 1, front: 1, heightPole: true },
  ),
  escortRule(
    'oh-height-over-14-10',
    'Over 14 ft 10 in high — one lead escort with a height-sensing device and one rear escort',
    { kind: 'gt', measure: 'heightIn', value: ftIn(14, 10) },
    { escorts: 2, front: 1, rear: 1, heightPole: true },
  ),
  /**
   * "If more than one of the conditions set forth in numbers 2 through 4 above
   * are met ... two escorts (one lead and one rear) shall be required." Numbers
   * 2–4 are the length, width and height triggers, so this is a 2-of-3 over
   * their outcomes — the same shape Texas needs, written with the same grammar.
   */
  escortRule(
    'oh-two-conditions',
    'Over the escort threshold in two or more of length, width and height — one lead and one rear escort',
    {
      kind: 'atLeast',
      count: 2,
      of: [
        { kind: 'ruleApplies', ruleId: 'oh-length-over-90' },
        {
          kind: 'any',
          of: [
            { kind: 'ruleApplies', ruleId: 'oh-width-over-13' },
            { kind: 'ruleApplies', ruleId: 'oh-width-over-14-6' },
          ],
        },
        {
          kind: 'any',
          of: [
            { kind: 'ruleApplies', ruleId: 'oh-height-over-14-6' },
            { kind: 'ruleApplies', ruleId: 'oh-height-over-14-10' },
          ],
        },
      ],
    },
    { escorts: 2, front: 1, rear: 1 },
  ),
  /**
   * The law-enforcement trigger is numeric and definite — over 16 ft wide —
   * but Ohio publishes NO officer count, NO position and NO rate. Asserting
   * "one front trooper" would be inventing all three, so the requirement is
   * recorded and the move goes to review rather than carrying a fabricated
   * police line.
   */
  escortRule(
    'oh-police-over-16-wide',
    'Over 16 ft wide — a law-enforcement escort is required in addition to the private escorts',
    { kind: 'gt', measure: 'widthIn', value: ftIn(16) },
    {
      manualReview:
        'Ohio requires a law-enforcement escort "in addition to private escorts" on any load over 16 ft wide, but publishes no officer count, no position and no hourly or per-mile rate. The police-escort cost cannot be quoted and must be arranged and priced through ODOT.',
    },
    ODOT_GUIDE,
    RETRIEVED,
  ),
  /**
   * Ohio's known unknowns, on one advisory. They are real exclusions from the
   * quote, not defects in it: blocking every Ohio permit on the possibility of
   * a discretionary escort would make the state unquotable, and hiding them
   * would make the number look more complete than it is.
   */
  escortRule(
    'oh-discretionary-and-unpriced',
    'Ohio may impose escorts, a route survey or special work at the department’s discretion, and publishes no price for any of them',
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
        'Ohio adds several charges this quote cannot include. OAC 5501:2-1-04 lets the director require private or police escorts on any movement, with no numeric weight-only trigger and no published front- or rear-overhang escort threshold. ODOT may request a route survey for a superload, with no fixed trigger and no published cost. Where a movement needs "special work by the department such as special traffic control or special engineering analysis", the applicant reimburses ODOT\'s total direct cost, which is not a fixed amount. None of these is included above.',
    },
    OAC_ESCORTS,
    FEE_RULE_FROM,
  ),
];

// ── Fee bands ─────────────────────────────────────────────────────────────

/**
 * The oversize surcharge, keyed on WIDTH and HEIGHT only — Ohio's effective fee
 * rule has no length surcharge at all.
 *
 * The bands are built to be MUTUALLY EXCLUSIVE, which is what lets an
 * overlength-only load fall through to "the published schedule does not price
 * this" instead of being silently charged the width band. Each row therefore
 * carries a floor as well as a ceiling: the height band excludes loads that are
 * also over-width (those are already covered by the width band at the same
 * price), so no load can match two rows and be read as a source conflict.
 */
const LEGAL_WIDTH_IN = 102;
const LEGAL_HEIGHT_IN = ftIn(13, 6);
const BAND_WIDTH_IN = ftIn(14);
const BAND_HEIGHT_IN = ftIn(14, 6);

const oversizeFeeBands: Sourced<OversizeFeeBand>[] = [
  fromDated<OversizeFeeBand>(
    {
      label: 'over legal width, up to 14 ft wide and 14 ft 6 in high — $55 outbound surcharge',
      overWidthIn: { value: LEGAL_WIDTH_IN, inclusive: false },
      upToWidthIn: { value: BAND_WIDTH_IN, inclusive: false },
      upToHeightIn: { value: BAND_HEIGHT_IN, inclusive: false },
      feeUsd: 55,
    },
    OAC_FEES,
    FEE_RULE_FROM,
    'OAC 5501:2-1-05(A)(1)(a): "Overall width up to fourteen feet and/or overall height up to fourteen feet six inches: (i) Outbound trip: fifty-five dollars". With the $20 basic charge this reproduces ODOT\'s published "OS Only $75". Return trip is $35 and is not modelled — this engine prices one-way single trips.',
  ),
  fromDated<OversizeFeeBand>(
    {
      label: 'over legal height, up to 14 ft 6 in high, at or under legal width — $55 outbound surcharge',
      overHeightIn: { value: LEGAL_HEIGHT_IN, inclusive: false },
      upToWidthIn: { value: LEGAL_WIDTH_IN, inclusive: false },
      upToHeightIn: { value: BAND_HEIGHT_IN, inclusive: false },
      feeUsd: 55,
    },
    OAC_FEES,
    FEE_RULE_FROM,
    'The same $55 band reached on height alone. Bounded at legal width so it cannot also match a load already covered by the width row above — two matching rows with different bounds would be read by the resolver as two sources disagreeing, which they are not.',
  ),
  fromDated<OversizeFeeBand>(
    {
      label: 'over 14 ft wide — $125 outbound surcharge',
      overWidthIn: { value: BAND_WIDTH_IN, inclusive: false },
      feeUsd: 125,
    },
    OAC_FEES,
    FEE_RULE_FROM,
    'OAC 5501:2-1-05(A)(1)(b): "Overall width in excess of fourteen feet and/or overall height in excess of fourteen feet, six inches: (i) Outbound trip: one hundred twenty-five dollars". Note that a load in this band is ALSO a superload under ODOT\'s definition, so in practice the engine refuses to price it and this row exists for completeness.',
  ),
  fromDated<OversizeFeeBand>(
    {
      label: 'over 14 ft 6 in high, at or under 14 ft wide — $125 outbound surcharge',
      overHeightIn: { value: BAND_HEIGHT_IN, inclusive: false },
      upToWidthIn: { value: BAND_WIDTH_IN, inclusive: false },
      feeUsd: 125,
    },
    OAC_FEES,
    FEE_RULE_FROM,
    'The same $125 band reached on height alone, bounded at 14 ft wide for the same mutual-exclusivity reason as the $55 pair.',
  ),
];

/**
 * The overweight surcharge. ONE band, and it stops at 120,000 lb on purpose.
 *
 * "Overweight up to one hundred twenty thousand pounds gross vehicle weight:
 * (i) Outbound trip: one hundred twenty-five dollars". Above that the rule adds
 * "four cents per ton over sixty tons, per mile traveled" — a term we cannot
 * evaluate without per-state mileage — so there is deliberately NO band above
 * 120,000 lb and a heavier Ohio load produces no number at all.
 */
const overweightBands: Sourced<WeightBand>[] = [
  fromDated<WeightBand>(
    { minLbs: 80001, maxLbs: 120000, feeUsd: 125 },
    OAC_FEES,
    FEE_RULE_FROM,
    'Outbound trip. With the $20 basic charge this reproduces ODOT\'s published "OS/OW $145".',
  ),
];

// ── The jurisdiction ──────────────────────────────────────────────────────

export const OHIO_OSOW_RULES: JurisdictionOsowRules = {
  code: 'OH',
  name: 'Ohio',
  country: 'US',

  legalLimits: {
    widthIn: [
      fromDated(
        LEGAL_WIDTH_IN,
        ORC_5577_05,
        '2013-07-01',
        '§5577.05(B)(5): "One hundred two inches, including load, for all other vehicles". Stated in inches by the statute, so no conversion is applied.',
      ),
    ],
    heightIn: [
      fromDated(
        LEGAL_HEIGHT_IN,
        ORC_5577_05,
        '2013-07-01',
        '§5577.05: "No such vehicle shall have a height in excess of thirteen feet six inches, with or without load."',
      ),
    ],
    trailerLengthIn: [
      fromDated(
        ftIn(53),
        ORC_5577_05,
        '2013-07-01',
        '§5577.05(C): "Fifty-three feet for any semitrailer when operated in a commercial tractor-semitrailer combination". This is the SEMITRAILER limit; Ohio states no overall length for the combination, which is why `overallLengthIn` is absent.',
      ),
    ],
    // `overallLengthIn`, `frontOverhangIn` and `rearOverhangIn` are absent by
    // design. See the module header — Ohio publishes none of the three.
    grossWeightLbs: [
      fromDated(
        80000,
        ORC_5577_04,
        '2001-06-29',
        '§5577.04: "the maximum overall gross weight of vehicle and load imposed upon the road surface shall not exceed eighty thousand pounds." Posted limits and the bridge formula can still produce a lower legal weight.',
      ),
    ],
    singleAxleLbs: [
      fromDated(20000, ORC_5577_04, '2001-06-29', '§5577.04: "On any one axle, twenty thousand pounds"'),
    ],
    tandemAxleLbs: [
      fromDated(
        34000,
        ORC_5577_04,
        '2001-06-29',
        '§5577.04(B)(2): "On any tandem axle, thirty-four thousand pounds". On NON-interstate roads §5577.04(D) offers an alternative reaching 40,000 lb on axles spaced over 4 ft, and division (I) lets the carrier take whichever division yields the higher gross. Route class is not collected on a quote, so the interstate figure is used and the alternative is recorded here rather than applied.',
      ),
    ],
  },

  /**
   * $20 — the basic processing charge, and the ONLY flat component. Everything
   * else is a surcharge band. Charged once even when several surcharges apply:
   * "only one basic processing fee ... will be charged".
   */
  permitBaseFeeUsd: [
    fromDated(
      20,
      OAC_FEES,
      FEE_RULE_FROM,
      '"All permit application processing fees consist of the basic processing charge of twenty dollars plus each unit of surcharge that is applicable to that movement."',
    ),
  ],

  oversizeFeeBands,

  /**
   * THE RULE THAT MAKES OHIO DIFFERENT FROM TEXAS. Recorded as sourced data so
   * no future edit can quietly restore the additive behaviour.
   */
  combinedFeeRule: [
    fromDated<CombinedFeeRule>(
      {
        kind: 'overweightOnly',
        explanation:
          'Ohio charges the overweight surcharge instead of the oversize one when a movement is both: "If a movement is both overweight and over width and/or over height, only one basic processing fee as set forth in paragraph (A) of this rule and the applicable overweight surcharge set forth in paragraph (A)(1)(a), (A)(1)(b), (A)(2)(a), or (A)(2)(b) of this rule will be charged." (OAC 5501:2-1-05.)',
      },
      OAC_FEES,
      FEE_RULE_FROM,
    ),
  ],

  overweightPricing: [
    fromDated<OverweightPricing>(
      {
        kind: 'bands',
        explanation:
          'OAC 5501:2-1-05 sets a flat $125 outbound overweight surcharge up to 120,000 lb gross. Above 120,000 lb the rule charges "one hundred twenty-five dollars plus four cents per ton over sixty tons, per mile traveled" — a distance term that cannot be evaluated without per-jurisdiction mileage, so no band above 120,000 lb is on file.',
      },
      OAC_FEES,
      FEE_RULE_FROM,
    ),
    fromUndatedPage<OverweightPricing>(
      {
        kind: 'bands',
        explanation:
          'ODOT\'s guide prints one flat routine OS/OW total ($145 one way) and shows the ton-mile term only in its superload table, where it is defined as "[(GVW - 120,000)/2000] times $0.04 per mile travelled".',
      },
      ODOT_GUIDE,
    ),
  ],

  overweightBands,

  /**
   * Empty deliberately. Ohio's ton-mile term is real and quoted in
   * `overweightPricing`, but the engine only consults per-mile rates when the
   * pricing MODEL resolves to `perMile`. Recording a rate here that nothing
   * reads would be worse than not recording it: it would look like coverage.
   */
  overweightPerMile: [],

  conditionalFees: [],

  /**
   * ZERO, and sourced — not an absent row. Ohio's published calculation is
   * fixed-dollar units only, with no percentage or flat service component. The
   * one genuine unknown is recorded on the row rather than guessed at.
   */
  transactionFee: [
    fromDated<TransactionFee>(
      { perPermitUsd: 0, percentOfTotal: 0 },
      OAC_FEES,
      FEE_RULE_FROM,
      'Ohio publishes no percentage surcharge: the fee "consist[s] of the basic processing charge of twenty dollars plus each unit of surcharge". UNKNOWN, recorded and not filled in: the rule also says "At the discretion of the director, a third party processor service may be utilized for credit card transactions" and publishes no processor fee amount or percentage. Any card fee is that processor\'s, not Ohio\'s.',
    ),
  ],

  /**
   * Empty, and that is the finding. Ohio publishes NO fixed engineering or
   * route-analysis fee — "the applicant will be responsible for the
   * reimbursement of the total direct costs incurred by the department". A
   * superload already refuses to quote a price, so no number escapes; the
   * exclusion is stated on the advisory escort rule.
   */
  routeAnalysisFeeUsd: [],
  noBridgeRouteFeeUsd: [],

  superload: {
    grossWeight: [
      fromUndatedPage<Threshold>(
        { value: 120000, inclusive: false },
        ODOT_GUIDE,
        '"Superload - any vehicle or combination or load having a gross weight in excess of 120,000 lbs." — exclusive, so a load at exactly 120,000 lb is still an ordinary permit and is priced by the $125 band.',
      ),
    ],
    /**
     * Ohio also makes a load a superload on AXLE OR GROUP weights over its
     * Section 9 limits (single 29,000 lb over 16 ft spacing; tandem 36,000 /
     * 50,000; tri-axle 47,000 / 60,000; quad 60,000 / 80,000, by spacing).
     * Those are per-group weights, which `shortSpacing` cannot express and a
     * quote does not collect — recorded here in words rather than modelled as a
     * spacing rule it is not.
     */
    shortSpacing: [],
    widthIn: [
      fromUndatedPage<Threshold>(
        { value: ftIn(14), inclusive: false },
        ODOT_GUIDE,
        '"overall width in excess of 14\'-0\\""',
      ),
    ],
    heightIn: [
      fromUndatedPage<Threshold>(
        { value: ftIn(14, 6), inclusive: false },
        ODOT_GUIDE,
        '"overall height in excess of 14\'-6\\""',
      ),
    ],
  },

  /**
   * Empty on all three axes, and this is a recorded absence rather than an
   * oversight: ODOT publishes NO numeric route-survey trigger. Its guide says
   * only that "additional information may be requested, such as route survey"
   * for a superload. Inventing a width or height trigger to fill the field
   * would put a requirement on the quote that Ohio has not written. The
   * discretionary reality is carried by the advisory escort rule instead.
   */
  routeInspection: { widthIn: [], heightIn: [], lengthIn: [] },

  escortRules: OHIO_ESCORT_RULES,

  /**
   * FALSE — and the reasoning matters. Ohio's ton-mile term exists only above
   * 120,000 lb, a band this file deliberately does not price. Setting this true
   * would push every ordinary Ohio permit into manual review over a distance
   * term that does not apply to it, while changing nothing about the heavy band
   * that already refuses to quote.
   */
  feesDependOnDistance: false,
};
