/**
 * WASHINGTON — oversize/overweight single-trip permit rules.
 *
 * The richest dataset in this directory and the one that stress-tests the
 * escort grammar hardest: Washington is the state the `ratioGt` and `subjective`
 * predicates were designed for, and it turned out to need `ruleApplies` as well.
 *
 * FIVE THINGS ABOUT WASHINGTON THAT DECIDE WHETHER A QUOTE IS HONEST
 * -----------------------------------------------------------------
 *
 * 1. THE FEE IS PER MILE, AND IT IS BANDED ON EXCESS WEIGHT, NOT ON GROSS.
 *    RCW 46.44.0941's Overweight Fee Schedule prices "excess weight over legal
 *    capacity, as provided in RCW 46.44.041" — 0–9,999 lb of excess at $0.07 a
 *    mile, rising to $4.25 at 100,000 lb of excess. `PerMileRate` bands on
 *    GROSS weight, so every row below has been converted by adding 80,000 lb.
 *    THAT CONVERSION IS OUR INFERENCE AND IT IS FLAGGED AS ONE — see
 *    `EXCESS_BASE_INFERENCE` below and the advisory rule that carries it onto
 *    every Washington overweight quote.
 *
 * 2. THREE DOCUMENTED CONFLICTS, AND ONE OF THEM IS NOT A DISAGREEMENT AT ALL.
 *    (a) The first band reads "0- 9,999 pounds" in the statute and "1-9,999" on
 *        WSDOT's self-issue portal. (b) The top band reads "95,000-99,999" in
 *        the statute and "95,000-99,000" on WSDOT — which is a different defect:
 *        999 pounds that the statute prices and WSDOT's schedule does not price
 *        AT ALL. (c) The manufactured-home annual permit is $150 a year up to
 *        14 ft wide in statute and $360 a year up to 15 ft wide on WSDOT's
 *        schedule — fee and dimension both. How each is represented is
 *        explained at its own definition; none of them is resolved by picking.
 *
 * 3. THE RCW 46.44.0941 TABLE IS MOSTLY NOT SINGLE-TRIP. Exactly one row of the
 *    fifteen — "All overlegal loads, except overweight, single trip. . . .$
 *    10.00" — is a single-trip permit. Everything else is a 30-day, quarterly or
 *    annual continuous-operation permit. The full table is reproduced verbatim
 *    in `RCW_0941_FULL_FEE_TABLE`, line breaks and all, with each row labelled
 *    by term, so a future reader cannot mistake the $150 tow-truck annual for a
 *    trip fee.
 *
 * 4. WASHINGTON DOES NOT DOUBLE-CHARGE. RCW 46.44.096: "Loads which are
 *    overweight and oversize shall be charged the fee for the overweight permit
 *    without additional fees being assessed for the oversize features." The $10
 *    dimensional fee therefore lives in `oversizeFeeBands` and NOT in
 *    `permitBaseFeeUsd`, and `combinedFeeRule` is `overweightOnly`, so a load
 *    that is both pays the mileage fee alone.
 *
 * 5. THE PERMIT IS FREE TO ISSUE. WSDOT's self-issue page states "There are no
 *    additional charges for self-issuing", so the transaction fee is a SOURCED
 *    ZERO rather than an absent one. The $3.50 an appointed agent may keep is a
 *    share OF the fee under RCW 46.44.096, not an amount added to it.
 *
 * DATE WARNING: the height limit is from 1984, the width limit from 2005, the
 * superload rule from 2005 and the fee-computation rules from 2006. All are the
 * current text on the Legislature's own host and all carry their real dates
 * below. None has been backfilled with the retrieval date.
 *
 * "CANNOT QUOTE VERBATIM": the source dataset used that marker four times —
 * percentage surcharge, weight-based escort triggers, bucket-truck/utility
 * escort thresholds, and outbound pilot-car reciprocity. The researcher
 * declined to paraphrase those, so they are carried as recorded unknowns and
 * nothing has been reconstructed for them.
 */
import type { SourceDoc, Sourced } from '../provenance.js';
import { ftIn, type EscortRule, type RouteClass } from '../escortRules.js';
import type {
  CombinedFeeRule,
  JurisdictionOsowRules,
  OversizeFeeBand,
  OverweightPricing,
  PerMileRate,
  Threshold,
  TransactionFee,
} from '../types.js';

const RETRIEVED = '2026-09-02';

// ── Source documents ──────────────────────────────────────────────────────

const RCW_46_44_010: SourceDoc = {
  id: 'wa-rcw-46-44-010',
  title: 'RCW 46.44.010 — Maximum width',
  url: 'https://app.leg.wa.gov/rcw/default.aspx?cite=46.44.010',
  publisher: 'Washington State Legislature',
  revisedOn: '2005-07-24',
  retrievedOn: RETRIEVED,
  cite: '"The total outside width of any vehicle or load thereon must not exceed eight and one-half feet"; width-exclusive safety devices may add up to three inches',
};

const RCW_46_44_020: SourceDoc = {
  id: 'wa-rcw-46-44-020',
  title: 'RCW 46.44.020 — Maximum height',
  url: 'https://app.leg.wa.gov/rcw/default.aspx?cite=46.44.020',
  publisher: 'Washington State Legislature',
  revisedOn: '1984-03-07',
  retrievedOn: RETRIEVED,
  cite: '"It is unlawful for any vehicle unladen or with load to exceed a height of fourteen feet"',
};

const RCW_46_44_030: SourceDoc = {
  id: 'wa-rcw-46-44-030',
  title: 'RCW 46.44.030 — Maximum length',
  url: 'https://app.leg.wa.gov/rcw/default.aspx?cite=46.44.030',
  publisher: 'Washington State Legislature',
  revisedOn: '2026-06-11',
  retrievedOn: RETRIEVED,
  cite: '"a semitrailer length in excess of 53 feet"; single vehicle 40 ft; two trailing units 61 ft; truck-and-trailer 75 ft overall',
};

const RCW_46_44_034: SourceDoc = {
  id: 'wa-rcw-46-44-034',
  title: 'RCW 46.44.034 — Front and rear protrusions',
  url: 'https://app.leg.wa.gov/rcw/default.aspx?cite=46.44.034',
  publisher: 'Washington State Legislature',
  revisedOn: '2017-07-23',
  retrievedOn: RETRIEVED,
  cite: '(1) three feet beyond the front wheels; (2) fifteen feet beyond the center of the last axle',
};

const RCW_46_44_041: SourceDoc = {
  id: 'wa-rcw-46-44-041',
  title: 'RCW 46.44.041 — Maximum gross weights, axle group table',
  url: 'https://app.leg.wa.gov/rcw/default.aspx?cite=46.44.041',
  publisher: 'Washington State Legislature',
  revisedOn: '2016-06-09',
  retrievedOn: RETRIEVED,
  cite: 'single axle 20,000 lb; two consecutive tandem sets 34,000 lb each at 36 ft or more; W = 500((LN/N-1)+12N+36); table caps at 105,500 lb for 5–9 axles at 86 ft or more',
};

const RCW_46_44_092: SourceDoc = {
  id: 'wa-rcw-46-44-092',
  title: 'RCW 46.44.092 — Maximum widths a special permit may authorise',
  url: 'https://app.leg.wa.gov/rcw/default.aspx?cite=46.44.092',
  publisher: 'Washington State Legislature',
  revisedOn: '2006-07-01',
  retrievedOn: RETRIEVED,
  cite: '"On two-lane highways, fourteen feet; ... where a physical barrier serving as a median divider separates opposing traffic lanes, twenty feet; ... without a physical barrier ..., thirty-two feet."',
};

const RCW_46_44_0941: SourceDoc = {
  id: 'wa-rcw-46-44-0941',
  title: 'RCW 46.44.0941 — Special permit fees and the Overweight Fee Schedule',
  url: 'https://app.leg.wa.gov/rcw/default.aspx?cite=46.44.0941',
  publisher: 'Washington State Legislature',
  revisedOn: '2023-07-23',
  retrievedOn: RETRIEVED,
  cite: 'single-trip oversize $10.00; per-mile Overweight Fee Schedule; proviso (a) $14.00 minimum, (b) $14.00 duplicate, (c) rounding to the nearest whole dollar',
};

const RCW_46_44_096: SourceDoc = {
  id: 'wa-rcw-46-44-096',
  title: 'RCW 46.44.096 — Determining fees; agents',
  url: 'https://app.leg.wa.gov/rcw/default.aspx?cite=46.44.096',
  publisher: 'Washington State Legislature',
  revisedOn: '2006-07-01',
  retrievedOn: RETRIEVED,
  cite: '"whichever is the greater"; "Loads which are overweight and oversize shall be charged the fee for the overweight permit without additional fees being assessed for the oversize features."; agents may retain $3.50',
};

const WAC_468_38_100: SourceDoc = {
  id: 'wa-wac-468-38-100',
  title: 'WAC 468-38-100 — Pilot/escort vehicle requirements',
  url: 'https://app.leg.wa.gov/wac/default.aspx?cite=468-38-100',
  publisher: 'Washington State Department of Transportation',
  revisedOn: '2023-03-25',
  retrievedOn: RETRIEVED,
  cite: '(1)(a)–(k) escort triggers; (10)(f) and (14) the height pole; (3) flagperson substitution; (4)(d) operator certification; (16) insurance',
};

const WAC_468_38_405: SourceDoc = {
  id: 'wa-wac-468-38-405',
  title: 'WAC 468-38-405 — Superloads',
  url: 'https://app.leg.wa.gov/wac/default.aspx?cite=468-38-405',
  publisher: 'Washington State Department of Transportation',
  revisedOn: '2005-02-28',
  retrievedOn: RETRIEVED,
  cite: '(1) superload criteria; (2) lead times; (4) applicant cost-sharing in department analysis; (6) additional pilot/escort or law-enforcement vehicles',
};

const WAC_468_38_005: SourceDoc = {
  id: 'wa-wac-468-38-005',
  title: 'WAC 468-38-005 — Definitions',
  url: 'https://app.leg.wa.gov/wac/default.aspx?cite=468-38-005',
  publisher: 'Washington State Department of Transportation',
  revisedOn: '2023-11-21',
  retrievedOn: RETRIEVED,
  cite: '"Multilane highway: A highway with two or more lanes of travel in the same direction."',
};

const WSDOT_SELF_ISSUE: SourceDoc = {
  id: 'wsdot-self-issue-permit',
  title: 'WSDOT — Self-issue a permit (eSNOOPI Pro)',
  url: 'https://wsdot.wa.gov/travel/commercial-vehicles/commercial-vehicle-permits/self-issue-permit',
  publisher: 'Washington State Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: '"There are no additional charges for self-issuing. The cost of the overweight permit is the same as purchasing the permit from a WSDOT office."; the portal displays the first band as "1-9,999" and the top band as "95,000-99,000"',
};

const WSDOT_PERMIT_TYPES: SourceDoc = {
  id: 'wsdot-permit-types-fees',
  title: 'WSDOT — Permit types and fees',
  url: 'https://wsdot.wa.gov/travel/commercial-vehicles/commercial-vehicle-permits/permit-types-fees',
  publisher: 'Washington State Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: '"Single Trip OSOW - A single trip, 3-day, oversize and/or overweight route specific permit."; manufactured housing "$30.00 for 30-days $360.00 per year"',
};

const WSDOT_PILOT_ESCORT: SourceDoc = {
  id: 'wsdot-pilot-escort-vehicle',
  title: 'WSDOT — Pilot and escort vehicles',
  url: 'https://wsdot.wa.gov/travel/commercial-vehicles/commercial-vehicle-permits/pilot-escort-vehicle',
  publisher: 'Washington State Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'inbound recognition of Arizona, Colorado, Georgia, Minnesota, North Carolina, Oklahoma, Utah and Virginia certifications',
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

/** A row from an UNDATED page: effective only from the day we can prove it. */
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

const EFF_FEES = '2023-07-23';
const EFF_ESCORTS = '2023-03-25';
const EFF_SUPERLOAD = '2005-02-28';
const EFF_096 = '2006-07-01';
const EFF_092 = '2006-07-01';

// ── Route classes ─────────────────────────────────────────────────────────

/**
 * WAC 468-38-005 defines a multilane highway as one "with two or more lanes of
 * travel in the same direction", which covers a divided freeway and an
 * undivided arterial alike. WAC 468-38-100 then splits them back apart for the
 * 20-foot rule, and RCW 46.44.092 prices permits on the same split — 20 ft on a
 * divided multilane against 32 ft on an undivided one. Both readings are needed,
 * so both groupings are named here rather than repeated inline.
 */
const TWO_LANE: RouteClass[] = ['two-lane'];
const MULTILANE: RouteClass[] = ['divided', 'interstate', 'multilane-undivided'];
const MULTILANE_UNDIVIDED: RouteClass[] = ['multilane-undivided'];
const MULTILANE_DIVIDED: RouteClass[] = ['divided', 'interstate'];

/**
 * "This load needs a Washington special permit of some kind." Some of the
 * recorded unknowns below are true of every permit rather than of a dimension —
 * the percentage-surcharge question, the pilot-car reciprocity gap — and keying
 * them on width alone would hide them from an overweight legal-size move, which
 * is most of heavy haul. This keeps them off a fully legal load, which needs no
 * permit and should not collect warnings about one.
 */
const PERMIT_LIKELY: EscortRule['when'] = {
  kind: 'any',
  of: [
    { kind: 'gt', measure: 'widthIn', value: 102 },
    { kind: 'gt', measure: 'heightIn', value: ftIn(14) },
    { kind: 'gt', measure: 'grossWeightLbs', value: 80000 },
  ],
};

// ── The verbatim RCW 46.44.0941 fee table ─────────────────────────────────

/**
 * RCW 46.44.0941's special-permit fee table, reproduced with the statute's own
 * line breaks — which are not cosmetic. The Legislature's HTML wraps each fee
 * description mid-sentence, and re-flowing it into prose is how "Continuous
 * operation ... for a period of one year. . . .$ 150.00" quietly becomes a
 * number someone reads as a trip fee.
 *
 * `term` is the load-bearing field. ONE row of fifteen is a single-trip permit.
 * The engine prices single-trip permits, so every other row is here to be cited
 * and NOT to be charged.
 */
export interface WashingtonFeeTableRow {
  /** The statute's own text, line breaks preserved. */
  verbatim: string;
  feeUsd: number;
  term: 'single-trip' | '30-day' | 'quarterly' | 'annual' | 'per-1000-lb-annual';
}

export const RCW_0941_FULL_FEE_TABLE: WashingtonFeeTableRow[] = [
  {
    verbatim: 'All overlegal loads, except overweight, single\n\ntrip. . . .$ 10.00',
    feeUsd: 10,
    term: 'single-trip',
  },
  {
    verbatim:
      'Continuous operation of overlegal loads\n\nhaving either overwidth or overheight\n\nfeatures only, for a period not to exceed\n\n30 days. . . .$ 20.00',
    feeUsd: 20,
    term: '30-day',
  },
  {
    verbatim:
      'Continuous operations of overlegal loads\n\nhaving overlength features only, for a\n\nperiod not to exceed 30 days. . . .$ 10.00',
    feeUsd: 10,
    term: '30-day',
  },
  {
    verbatim:
      'Continuous operation of a combination of\n\nvehicles having one trailing unit that\n\nexceeds 53 feet and is not\n\nmore than 56 feet in length, for\n\na period of one year. . . .$ 100.00',
    feeUsd: 100,
    term: 'annual',
  },
  {
    verbatim:
      'Continuous operation of a combination of\n\nvehicles having two trailing units\n\nwhich together exceed 61 feet and\n\nare not more than 68 feet in\n\nlength, for a period of one year. . . .$ 100.00',
    feeUsd: 100,
    term: 'annual',
  },
  {
    verbatim:
      'Continuous operation of a combination of\n\nvehicles having two trailing units\n\nhauling fluid/liquid nondivisible milk,\n\nwhich together exceed 61 feet and\n\nare not more than 85 feet in length, for\n\na period of one year. . . .$ 300.00',
    feeUsd: 300,
    term: 'annual',
  },
  {
    verbatim:
      'Continuous operation of a three-axle fixed\n\nload vehicle having less than 65,000\n\npounds gross weight, for a period not\n\nto exceed 30 days. . . .$ 70.00',
    feeUsd: 70,
    term: '30-day',
  },
  {
    verbatim:
      'Continuous operation of a four-axle fixed load\n\nvehicle meeting the requirements of\n\nRCW 46.44.091(1) and weighing less than\n\n86,000 pounds gross weight, not to exceed\n\n30 days. . . .$ 90.00',
    feeUsd: 90,
    term: '30-day',
  },
  {
    verbatim:
      'Continuous movement of a mobile home or manufactured\n\nhome having nonreducible features not to\n\nexceed 85 feet in total length and\n\n14 feet in width, for a period of\n\none year. . . .$ 150.00',
    feeUsd: 150,
    term: 'annual',
  },
  {
    verbatim:
      'Continuous operation of a class C tow truck or a\n\nclass E tow truck with a class C rating while\n\nperforming emergency and nonemergency tows of\n\noversize or overweight, or both, vehicles and\n\nvehicle combinations, under rules adopted by the\n\ntransportation commission, for a period of\n\none year. . . .$ 150.00',
    feeUsd: 150,
    term: 'annual',
  },
  {
    verbatim:
      'Continuous operation of a class B tow truck or a\n\nclass E tow truck with a class B rating while\n\nperforming emergency and nonemergency tows of\n\noversize or overweight, or both, vehicles and\n\nvehicle combinations, under rules adopted by the\n\ntransportation commission, for a period of\n\none year. . . .$ 75.00',
    feeUsd: 75,
    term: 'annual',
  },
  {
    verbatim:
      'Continuous operation of a two or three-axle\n\ncollection truck, actually engaged in the\n\ncollection of solid waste or recyclables,\n\nor both, under chapter 81.77 or 35.21 RCW\n\nor by contract under RCW 36.58.090, for\n\none year with an additional 6,000\n\npounds more than the weight authorized in\n\nRCW 46.16A.455 on the rear axle of a two-axle\n\ntruck or 8,000 pounds for the tandem\n\naxles of a three-axle truck. RCW 46.44.041\n\nand 46.44.091 notwithstanding, the tire limits\n\nspecified in RCW 46.44.042 apply, but none of\n\nthe excess weight is valid or may be permitted\n\non any part of the federal interstate highway\n\nsystem. . . .$ 42.00\n\nper thousand pounds',
    feeUsd: 42,
    term: 'per-1000-lb-annual',
  },
  {
    verbatim:
      '(1) Farmers in the course of farming activities,\n\nfor any three-month period. . . .$ 10.00',
    feeUsd: 10,
    term: 'quarterly',
  },
  {
    verbatim:
      '(2) Farmers in the course of farming activities,\n\nfor a period not to exceed one year. . . .$ 25.00',
    feeUsd: 25,
    term: 'annual',
  },
  {
    verbatim:
      '(3) Persons engaged in the business of the\n\nsale, repair, or maintenance of such\n\nfarm implements, for any three-month period. . . .$ 25.00',
    feeUsd: 25,
    term: 'quarterly',
  },
  {
    verbatim:
      '(4) Persons engaged in the business of the\n\nsale, repair, or maintenance of such\n\nfarm implements, for a period not to\n\nexceed one year. . . .$ 100.00',
    feeUsd: 100,
    term: 'annual',
  },
];

// ── CONFLICT (c): the manufactured-home annual permit ─────────────────────

/**
 * CONFLICT, RECORDED THROUGH THE RESOLVER RATHER THAN THE PRICE LINES.
 *
 * RCW 46.44.0941 sets an annual manufactured-home permit at $150.00 for a home
 * "not to exceed 85 feet in total length and 14 feet in width". WSDOT's permit
 * types and fees page publishes "$30.00 for 30-days $360.00 per year" for
 * manufactured housing "Up to 15 ft. high, 15 ft. wide (include a 12-inch eave)
 * and trailer length not to exceed 75 ft."
 *
 * FEE AND DIMENSION BOTH DIFFER, and the two are not reconcilable as a
 * clarification: $360 is 2.4× $150 and the width entitlement differs by a foot.
 * Neither is adopted. Both are exported so `resolveSourced` holds them as a
 * conflict with an honest $150–$360 spread, and the width pair likewise.
 *
 * They are NOT in `permitBaseFeeUsd`, because this engine prices SINGLE-TRIP
 * permits and an annual manufactured-home permit is a different product. The
 * dedicated escort-list rule `wa-manufactured-home-annual-conflict` states the
 * disagreement on a load sitting in the 14–15 ft width band where it bites.
 */
export const WASHINGTON_MANUFACTURED_HOME_ANNUAL_FEE_USD: Sourced<number>[] = [
  fromDated(
    150,
    RCW_46_44_0941,
    EFF_FEES,
    '"Continuous movement of a mobile home or manufactured home having nonreducible features not to exceed 85 feet in total length and 14 feet in width, for a period of one year. . . .$ 150.00"',
  ),
  fromUndatedPage(
    360,
    WSDOT_PERMIT_TYPES,
    '"Manufactured Housing - Dimensional only permit. Up to 15 ft. high, 15 ft. wide (include a 12-inch eave) and trailer length not to exceed 75 ft. (including tongue length). $30.00 for 30-days $360.00 per year"',
  ),
];

/** The same conflict's dimensional half: 14 ft in statute, 15 ft on WSDOT. */
export const WASHINGTON_MANUFACTURED_HOME_ANNUAL_WIDTH_IN: Sourced<number>[] = [
  fromDated(ftIn(14), RCW_46_44_0941, EFF_FEES, 'statute: "14 feet in width"'),
  fromUndatedPage(
    ftIn(15),
    WSDOT_PERMIT_TYPES,
    'WSDOT schedule: "15 ft. wide (include a 12-inch eave)"',
  ),
];

// ── The excess-weight conversion, flagged as our inference ────────────────

/**
 * OUR INFERENCE, STATED PLAINLY.
 *
 * RCW 46.44.0941 bands the per-mile fee on EXCESS weight over legal capacity;
 * `PerMileRate` bands on GROSS weight. Converting one to the other needs a
 * number for "legal capacity", and RCW 46.44.096 says that capacity is "gross
 * loadings in excess of loadings authorized by law or axle loadings in excess of
 * loadings authorized by law, whichever is the greater" — a function of the
 * axle layout, not a constant.
 *
 * 80,000 lb is used, and here is the whole of the justification: RCW
 * 46.44.041's own formula W = 500((LN/(N-1)) + 12N + 36) gives 79,875 lb — which
 * the statute rounds to 80,000 — for the ordinary five-axle tractor-semitrailer
 * at 51 ft of extreme axle spacing, and federal law caps regular Interstate
 * operation at the same 80,000 lb. It is the right base for the configuration
 * almost every quoted load actually is.
 *
 * IT IS STILL AN INFERENCE. A six-axle combination on 45 ft, or any layout that
 * reaches up the RCW table toward its 105,500 lb ceiling, has a higher legal
 * capacity, less excess, and a cheaper band than the rows below will select.
 * The advisory rule `wa-excess-base-is-configuration-dependent` says so on every
 * Washington overweight quote rather than leaving it in a comment.
 */
export const EXCESS_BASE_INFERENCE = 80000;

/**
 * The Overweight Fee Schedule, converted to gross-weight bands.
 *
 * NOTE WHAT IS MISSING ON PURPOSE: there is no row for 179,001–179,999 lb gross
 * (99,001–99,999 lb of excess). See `WASHINGTON_999_POUND_GAP`.
 */
const EXCESS_BANDS: Array<{ minExcess: number; maxExcess: number; rate: number }> = [
  { minExcess: 1, maxExcess: 9999, rate: 0.07 },
  { minExcess: 10000, maxExcess: 14999, rate: 0.14 },
  { minExcess: 15000, maxExcess: 19999, rate: 0.21 },
  { minExcess: 20000, maxExcess: 24999, rate: 0.28 },
  { minExcess: 25000, maxExcess: 29999, rate: 0.35 },
  { minExcess: 30000, maxExcess: 34999, rate: 0.49 },
  { minExcess: 35000, maxExcess: 39999, rate: 0.63 },
  { minExcess: 40000, maxExcess: 44999, rate: 0.79 },
  { minExcess: 45000, maxExcess: 49999, rate: 0.93 },
  { minExcess: 50000, maxExcess: 54999, rate: 1.14 },
  { minExcess: 55000, maxExcess: 59999, rate: 1.35 },
  { minExcess: 60000, maxExcess: 64999, rate: 1.56 },
  { minExcess: 65000, maxExcess: 69999, rate: 1.77 },
  { minExcess: 70000, maxExcess: 74999, rate: 2.12 },
  { minExcess: 75000, maxExcess: 79999, rate: 2.47 },
  { minExcess: 80000, maxExcess: 84999, rate: 2.82 },
  { minExcess: 85000, maxExcess: 89999, rate: 3.17 },
  { minExcess: 90000, maxExcess: 94999, rate: 3.52 },
  // The statute's row is "95,000-99,999"; WSDOT's is "95,000-99,000". Only the
  // range both documents name is priced. See `WASHINGTON_999_POUND_GAP`.
  { minExcess: 95000, maxExcess: 99000, rate: 3.87 },
  { minExcess: 100000, maxExcess: 100000, rate: 4.25 },
  // "$4.25 plus 50 cents for each 5,000 pound increment or portion thereof
  // exceeding 100,000 pounds", enumerated to the 200,000 lb gross superload
  // line, above which no fee is quoted at all.
  { minExcess: 100001, maxExcess: 105000, rate: 4.75 },
  { minExcess: 105001, maxExcess: 110000, rate: 5.25 },
  { minExcess: 110001, maxExcess: 115000, rate: 5.75 },
  { minExcess: 115001, maxExcess: 120000, rate: 6.25 },
];

function perMileRow(
  band: { minExcess: number; maxExcess: number; rate: number },
  source: SourceDoc,
  effectiveFrom: string,
  note?: string,
): Sourced<PerMileRate> {
  return fromDated<PerMileRate>(
    {
      minLbs: EXCESS_BASE_INFERENCE + band.minExcess,
      maxLbs: EXCESS_BASE_INFERENCE + band.maxExcess,
      ratePerMileUsd: band.rate,
      perIncrementLbs: null,
      excessBaseLbs: null,
      roundIncrementUp: false,
      // RCW 46.44.0941 proviso (a): "The minimum fee for any overweight permit
      // shall be $14.00". A short crossing does not buy a cheap permit.
      minimumUsd: 14,
      maximumUsd: null,
      // Proviso (c): carried to the next full dollar at 50 cents, reduced to it
      // at 49. Without this the engine is off by up to 49 cents on every
      // Washington permit whose per-mile product is not a whole dollar.
      roundDollars: 'nearest',
    },
    source,
    effectiveFrom,
    note,
  );
}

const overweightPerMile: Sourced<PerMileRate>[] = [
  ...EXCESS_BANDS.map((b) =>
    perMileRow(
      b,
      RCW_46_44_0941,
      EFF_FEES,
      b.minExcess >= 100001
        ? `Computed from "The fee for weights in excess of 100,000 pounds is $4.25 plus 50 cents for each 5,000 pound increment or portion thereof exceeding 100,000 pounds." — ${Math.ceil((b.minExcess - 100000) / 5000)} increment(s) above the $4.25 row. Enumerated only to the 200,000 lb gross superload line.`
        : `Overweight Fee Schedule: ${b.minExcess.toLocaleString()}–${b.maxExcess.toLocaleString()} lb of excess over legal capacity at $${b.rate.toFixed(2)} per mile. Expressed here as gross weight by adding the ${EXCESS_BASE_INFERENCE.toLocaleString()} lb base — see EXCESS_BASE_INFERENCE.`,
    ),
  ),
  /**
   * WSDOT's portal corroborates the two bands the source dataset quotes it on,
   * and it agrees with the statute about the RATE on the ranges both name. The
   * places they part company are boundaries, not amounts, which is why they are
   * recorded as boundary conflicts rather than as competing rate rows: two rows
   * carrying $0.07 with different floors would be read by the resolver as two
   * sources disagreeing about a fee they in fact agree on, and would refuse to
   * price the whole band.
   */
  perMileRow(
    EXCESS_BANDS[0] as { minExcess: number; maxExcess: number; rate: number },
    WSDOT_SELF_ISSUE,
    RETRIEVED,
    'WSDOT self-issue portal prints this band as "1-9,999", against the statute\'s "0- 9,999". Both give $0.07 per mile; only the floor differs, and the disagreement is carried by the rule `wa-first-band-floor-conflict`.',
  ),
  perMileRow(
    EXCESS_BANDS[18] as { minExcess: number; maxExcess: number; rate: number },
    WSDOT_SELF_ISSUE,
    RETRIEVED,
    'WSDOT self-issue portal prints this band as "95,000-99,000", against the statute\'s "95,000-99,999". Only the range they BOTH name is priced; the 999 lb above it is left unpriced — see WASHINGTON_999_POUND_GAP.',
  ),
];

/**
 * THE 999-POUND GAP, AND WHY IT IS NOT MODELLED AS A DISAGREEMENT.
 *
 * A conflict is two documents naming different values for the same thing; the
 * resolver answers it with `null`, both candidates, and a spread. This is not
 * that. RCW 46.44.0941 prices 95,000–99,999 lb of excess at $3.87 a mile.
 * WSDOT's self-issue schedule stops that band at 99,000 and its next row is
 * "100,000 pounds . . . . $ 4.25" — exactly 100,000, not "100,000 and over". On
 * WSDOT's schedule, a load with 99,001 to 99,999 lb of excess falls in NO ROW.
 * There is no second number to weigh against the first; one document prices the
 * load and the other has nothing to say about it.
 *
 * So it is represented as what it is: A HOLE IN THE RATE TABLE. No `PerMileRate`
 * row covers 179,001–179,999 lb gross, which makes the engine answer "No
 * per-mile overweight rate on file covers 179,500 lb in Washington. The permit
 * fee cannot be computed" and send the move to review — structurally the same
 * answer WSDOT's own schedule gives. The escort-list rule
 * `wa-999-pound-fee-gap` then names both documents verbatim so the reader can
 * see that this is an undefined range rather than a research gap, and can ring
 * the permit office knowing exactly what to ask.
 *
 * Quoting the statute's $3.87 here would have been the tempting move, and it is
 * the wrong one: it resolves in favour of one document a defect that consists
 * precisely of the two documents not covering the same ground.
 */
export const WASHINGTON_999_POUND_GAP = {
  minGrossLbs: EXCESS_BASE_INFERENCE + 99001,
  maxGrossLbs: EXCESS_BASE_INFERENCE + 99999,
  statuteText: '95,000-99,999 pounds . . . . $ 3.87',
  wsdotText: '95,000-99,000',
} as const;

// ── Escort rules — WAC 468-38-100(1) ──────────────────────────────────────

function escortRule(
  id: string,
  description: string,
  when: EscortRule['when'],
  then: EscortRule['then'],
  source: SourceDoc = WAC_468_38_100,
  effectiveFrom: string = EFF_ESCORTS,
): EscortRule {
  return {
    id,
    jurisdiction: 'WA',
    description,
    when,
    then,
    source,
    effectiveFrom,
    effectiveTo: null,
  };
}

/**
 * Washington's escorts. Every boundary in WAC 468-38-100(1) is the word
 * "exceeds", so every one of these is a strict `gt`: a load measuring exactly
 * 11 ft 0 in wide, or exactly 14 ft 6 in high, needs no escort at all.
 */
export const WASHINGTON_ESCORT_RULES: EscortRule[] = [
  escortRule(
    'wa-width-over-11-two-lane',
    'Over 11 ft wide on a two-lane highway — two pilot/escort vehicles, one in front and one at the rear',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: TWO_LANE },
        { kind: 'gt', measure: 'widthIn', value: ftIn(11) },
      ],
    },
    { escorts: 2, front: 1, rear: 1 },
  ),
  escortRule(
    'wa-width-over-14-multilane',
    'Over 14 ft wide on a multilane highway — one escort vehicle at the rear',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: MULTILANE },
        { kind: 'gt', measure: 'widthIn', value: ftIn(14) },
      ],
    },
    { escorts: 1, rear: 1 },
  ),
  escortRule(
    'wa-width-over-20-multilane-undivided',
    'Over 20 ft wide on a multilane UNDIVIDED highway — two pilot/escort vehicles, one in front and one at the rear',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: MULTILANE_UNDIVIDED },
        { kind: 'gt', measure: 'widthIn', value: ftIn(20) },
      ],
    },
    { escorts: 2, front: 1, rear: 1 },
  ),

  /**
   * THE RATIO RULE. WAC 468-38-100(1)(d) has two independent triggers in one
   * sentence, and the second has no threshold in feet at all: "when the rear
   * overhang of a load measured from the center of the rear axle exceeds
   * one-third of the trailer length including load". A 40 ft trailer trips it at
   * 13 ft 4 in of overhang and a 53 ft trailer does not trip it until 17 ft 8 in.
   * Approximating it as any fixed number of feet would be wrong for every
   * trailer that is not the length the approximation was fitted to, so it is
   * `ratioGt` and it evaluates to `unknown` — not to "no escort" — whenever the
   * trailer length is missing.
   */
  escortRule(
    'wa-trailer-over-105-or-overhang-ratio-two-lane',
    'Trailer length over 105 ft, or rear overhang over one-third of the trailer length, on a two-lane highway — one pilot/escort vehicle at the rear',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: TWO_LANE },
        {
          kind: 'any',
          of: [
            { kind: 'gt', measure: 'trailerLengthIn', value: ftIn(105) },
            {
              kind: 'ratioGt',
              measure: 'rearOverhangIn',
              ofMeasure: 'trailerLengthIn',
              numerator: 1,
              denominator: 3,
            },
          ],
        },
      ],
    },
    {
      escorts: 1,
      rear: 1,
      advisory:
        'WAC 468-38-100(3) allows a riding certified flagperson to substitute for this rear pilot/escort vehicle when the special permit authorises it. The quote assumes a pilot car, which is the more expensive of the two.',
    },
  ),
  escortRule(
    'wa-trailer-over-125-multilane',
    'Trailer length over 125 ft on a multilane highway — one pilot/escort vehicle at the rear',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: MULTILANE },
        { kind: 'gt', measure: 'trailerLengthIn', value: ftIn(125) },
      ],
    },
    {
      escorts: 1,
      rear: 1,
      advisory:
        'WAC 468-38-100(3) allows a riding certified flagperson to substitute for this rear pilot/escort vehicle when the special permit authorises it.',
    },
  ),
  escortRule(
    'wa-front-overhang-over-20-two-lane',
    'Front overhang over 20 ft, measured from the center of the front steer axle, on a two-lane highway — one pilot/escort vehicle at the front',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: TWO_LANE },
        { kind: 'gt', measure: 'frontOverhangIn', value: ftIn(20) },
      ],
    },
    { escorts: 1, front: 1 },
  ),
  /**
   * WAC 468-38-100(1)(g) applies to "a load on a single unit vehicle", and a
   * quote does not collect the vehicle type. The rule fires anyway, and it does
   * not over-quote: for a combination, rule (d)'s one-third ratio has already
   * asked for the same single rear car at any overhang over 20 ft on a trailer
   * shorter than 60 ft, and escort counts combine with MAX rather than SUM. The
   * vehicle-type limitation is stated so a reader is not misled about the
   * source's scope.
   */
  escortRule(
    'wa-rear-overhang-over-20-two-lane',
    'Rear overhang over 20 ft on a single unit vehicle, measured from the center of the rear axle, on a two-lane highway — one pilot/escort vehicle at the rear',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: TWO_LANE },
        { kind: 'gt', measure: 'rearOverhangIn', value: ftIn(20) },
      ],
    },
    { escorts: 1, rear: 1 },
  ),
  escortRule(
    'wa-height-over-14-6',
    'Over 14 ft 6 in high — one pilot/escort vehicle with a height-measuring pole at the front, on all highways',
    { kind: 'gt', measure: 'heightIn', value: ftIn(14, 6) },
    {
      escorts: 1,
      front: 1,
      heightPole: true,
      advisory:
        'WAC 468-38-100(10)(f) and (14): the pole must be nonconductive and nondestructive with a flexible upper portion, must extend between three and six inches above the load, and must be mounted on the front of the lead pilot/escort vehicle. It may be waived only by an alternative authorisation stated on the special permit.',
    },
  ),

  /**
   * THE COMPOUND CONDITIONAL. WAC 468-38-100(1)(i) does not test a dimension
   * against a number — it tests a dimension against ANOTHER RULE'S OUTCOME: "The
   * vehicle(s) or load exceeds 12 feet in width on a multilane highway AND HAS A
   * HEIGHT THAT REQUIRES A FRONT PILOT/ESCORT VEHICLE: One rear pilot/escort
   * vehicle is required." The reason is operational — the lead car is watching
   * overhead clearance instead of the load's width, so the state wants a second
   * car behind — and it drops the multilane rear-escort trigger from 14 ft to
   * 12 ft for exactly those moves.
   *
   * Note the polarity. `escortRules.ts` anticipated Washington as the case for
   * `ruleDoesNotApply`, "a width rule that only applies if no height escort is
   * already on the move". The published rule is the mirror image of that, so
   * this is `ruleApplies`; the comment in `escortRules.ts` has been corrected to
   * record the finding rather than left to mislead the next reader.
   */
  escortRule(
    'wa-width-over-12-multilane-with-height-escort',
    'Over 12 ft wide on a multilane highway when the load’s height already requires a front pilot/escort vehicle — one rear pilot/escort vehicle',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: MULTILANE },
        { kind: 'gt', measure: 'widthIn', value: ftIn(12) },
        { kind: 'ruleApplies', ruleId: 'wa-height-over-14-6' },
      ],
    },
    { escorts: 1, rear: 1 },
  ),

  /**
   * THE SUBJECTIVE RULE, AND THE ONE THE `subjective` PREDICATE EXISTS FOR.
   *
   * WAC 468-38-100(1)(j): "The operator, using rearview mirrors, cannot see 200
   * feet to the rear of the vehicle or vehicle combination when measured from
   * either side of the edge of the load or last vehicle in the combination,
   * whichever is larger: One pilot/escort vehicle is required at the rear on all
   * highways."
   *
   * No dimension answers this. It depends on the mirrors fitted, where the
   * driver sits, and the shape of the load — and it is decidable on the day by
   * a person sitting in the cab, not by a quote. So the outcome is `manualReview`
   * ALONE. It deliberately carries no escort count, not even the one the WAC
   * states, because adding `rear: 1` here would put a billable pilot car on the
   * quote on the strength of a judgement the engine is in no position to make;
   * and defaulting it the other way would silently price the move as if the
   * driver can see, which is the same error with the sign flipped. The count the
   * rule requires when it IS true is written into the review text, so the
   * information survives without becoming a number.
   */
  escortRule(
    'wa-mirror-visibility-under-200ft',
    'Rear visibility — whether the driver can see 200 ft behind the load in the mirrors',
    {
      kind: 'subjective',
      key: 'wa-cannot-see-200ft-in-mirrors',
      question:
        'using the rearview mirrors, can the driver see 200 feet to the rear of the load, measured from the wider of either edge of the load or the last vehicle?',
    },
    {
      manualReview:
        'WAC 468-38-100(1)(j) requires ONE rear pilot/escort vehicle on all highways whenever the operator, using the rearview mirrors, cannot see 200 feet behind the load. Whether that is so depends on the mirrors, the driver\'s seating position and the shape of the load, and it is settled from the cab rather than from a dimension sheet. No escort has been added or ruled out for it, and the escort count on this quote may be one car short.',
    },
  ),

  // ── Boundary conflicts (a) and (b), surfaced only where they bite ────────
  /**
   * CONFLICT (a). The statute's first overweight band reads "0- 9,999 pounds"
   * and WSDOT's self-issue portal reads "1-9,999". They agree on $0.07 a mile
   * and disagree about a single pound: whether a load with EXACTLY ZERO excess
   * over legal capacity is inside the schedule at all. Read literally, the
   * statute charges seven cents a mile for a load that is not overweight; the
   * portal's floor of 1 lb reads as WSDOT declining to do that.
   *
   * Following the engine's established treatment of a boundary conflict (Texas's
   * 18 ft 11 in against 19 ft 0 in, New York's 160 ft), it is surfaced on the
   * load that actually sits in the disputed band and on no other. Everything at
   * 80,001 lb and above is unaffected and prices cleanly from two corroborating
   * sources.
   */
  escortRule(
    'wa-first-band-floor-conflict',
    'Gross weight exactly at the legal limit — the statute and WSDOT’s portal disagree about whether the overweight schedule reaches it',
    {
      kind: 'between',
      measure: 'grossWeightLbs',
      min: EXCESS_BASE_INFERENCE,
      max: EXCESS_BASE_INFERENCE,
    },
    {
      manualReview:
        'This load sits exactly on the legal gross-weight capacity, which is the one pound Washington\'s own sources disagree about. RCW 46.44.0941 opens the Overweight Fee Schedule at "0- 9,999 pounds . . . . $ .07", which on its face charges a per-mile overweight fee to a load carrying no excess weight at all; WSDOT\'s self-issue portal prints the same band as "1-9,999". Neither reading has been adopted, and no overweight fee is asserted for a load at exactly the legal limit.',
    },
    RCW_46_44_0941,
    EFF_FEES,
  ),
  /**
   * CONFLICT (b) — the 999-pound hole. See `WASHINGTON_999_POUND_GAP` for why
   * this is represented as an undefined range rather than as a disagreement.
   */
  escortRule(
    'wa-999-pound-fee-gap',
    'Between 179,001 and 179,999 lb gross — the statute prices this load and WSDOT’s published schedule has no row for it at all',
    {
      kind: 'between',
      measure: 'grossWeightLbs',
      min: WASHINGTON_999_POUND_GAP.minGrossLbs,
      max: WASHINGTON_999_POUND_GAP.maxGrossLbs,
    },
    {
      manualReview:
        'No fee is quoted for this load, and the reason is not that two sources disagree — it is that one of them does not price it. RCW 46.44.0941 runs its band to "95,000-99,999 pounds . . . . $ 3.87" of excess weight. WSDOT\'s self-issue fee schedule stops the same band at "95,000-99,000" and its next row is "100,000 pounds . . . . $ 4.25" — exactly 100,000, not 100,000 and over. Between 99,001 and 99,999 pounds of excess, WSDOT\'s published schedule defines no fee whatever. Quoting the statute\'s $3.87 would settle in one document\'s favour a defect that consists of the two documents not covering the same ground, so the rate is left on file and the permit must be priced by WSDOT.',
    },
    RCW_46_44_0941,
    EFF_FEES,
  ),
  /**
   * CONFLICT (c) — the manufactured-home annual permit. Not a single-trip
   * product and therefore not in the price lines, but it fires exactly in the
   * 14–15 ft width band where the two documents give different answers, so a
   * dispatcher moving a manufactured home is told before they budget the year.
   */
  escortRule(
    'wa-manufactured-home-annual-conflict',
    'Between 14 ft and 15 ft wide — statute and WSDOT disagree about the annual manufactured-home permit, on both the fee and the width it covers',
    {
      kind: 'between',
      measure: 'widthIn',
      min: ftIn(14),
      max: ftIn(15),
      minInclusive: false,
      maxInclusive: true,
    },
    {
      advisory:
        'If this is a manufactured or mobile home, note that Washington publishes two different annual permits for it. RCW 46.44.0941 sets "$150.00" a year for a home "not to exceed 85 feet in total length and 14 feet in width"; WSDOT\'s permit types and fees schedule sets "$30.00 for 30-days $360.00 per year" for manufactured housing "Up to 15 ft. high, 15 ft. wide (include a 12-inch eave) and trailer length not to exceed 75 ft." The fee differs by a factor of 2.4 and the width entitlement by a foot, and neither has been adopted. This quote prices a SINGLE-TRIP permit, so no annual fee is included either way.',
    },
    WSDOT_PERMIT_TYPES,
    RETRIEVED,
  ),

  // ── Permit-width ceilings: the move the state will not permit at all ─────
  /**
   * NOT AN ESCORT RULE. RCW 46.44.092 caps what a special permit MAY AUTHORISE,
   * by route class, outside city limits — and a load over the cap is not an
   * expensive permit, it is no permit. That belongs on the quote well before an
   * escort count does, and `EscortRule` is the only dimension-conditioned
   * predicate in the model, so it lives here with `manualReview`. The statute's
   * own exceptions (highway segments designed for greater width, and hardship,
   * military and emergency moves) are stated rather than applied, because none
   * of them is derivable from a dimension.
   */
  escortRule(
    'wa-permit-width-ceiling',
    'Over the width RCW 46.44.092 allows a special permit to authorise on this class of highway outside city limits',
    {
      kind: 'any',
      of: [
        {
          kind: 'all',
          of: [
            { kind: 'routeClass', anyOf: TWO_LANE },
            { kind: 'gt', measure: 'widthIn', value: ftIn(14) },
          ],
        },
        {
          kind: 'all',
          of: [
            { kind: 'routeClass', anyOf: MULTILANE_DIVIDED },
            { kind: 'gt', measure: 'widthIn', value: ftIn(20) },
          ],
        },
        {
          kind: 'all',
          of: [
            { kind: 'routeClass', anyOf: MULTILANE_UNDIVIDED },
            { kind: 'gt', measure: 'widthIn', value: ftIn(32) },
          ],
        },
      ],
    },
    {
      manualReview:
        'RCW 46.44.092: "Special permits may not be issued for movements on any state highway outside the limits of any city or town in excess of the following widths: On two-lane highways, fourteen feet; On multiple-lane highways where a physical barrier serving as a median divider separates opposing traffic lanes, twenty feet; On multiple-lane highways without a physical barrier serving as a median divider, thirty-two feet." This load is over the ceiling for the road class given, so the question is not what the permit costs but whether WSDOT will issue one. The statute allows more on segments specifically designed to accommodate greater width and under hardship, military and emergency provisions; none of those is derivable from a dimension and none has been assumed.',
    },
    RCW_46_44_092,
    EFF_092,
  ),

  // ── Superload, by trailing-unit length ──────────────────────────────────
  /**
   * WAC 468-38-405(1) makes a trailing unit plus load over 125 ft a superload.
   * That is a TRAILER measurement, not an overall combination length, so it
   * cannot go in `superload.overallLengthIn` — recording it there would compare
   * the threshold against the tractor as well and call an ordinary move a
   * superload. `trailerLengthIn` is a `Measure` in the escort AST, so the
   * trigger is expressible here and nowhere else in the model.
   */
  escortRule(
    'wa-superload-trailing-unit-over-125',
    'Trailing unit plus load over 125 ft — a superload by WAC 468-38-405(1)',
    { kind: 'gt', measure: 'trailerLengthIn', value: ftIn(125) },
    {
      superload: true,
      manualReview:
        'WAC 468-38-405(1): "A superload is any nondivisible load that exceeds two hundred thousand pounds and/or exceeds outside dimensions of sixteen feet in height, or sixteen feet in width or have a trailing unit(s) plus load in excess of one hundred twenty-five feet in length." This load crosses the trailing-unit criterion. A dimensional superload application must be filed at least seven calendar days ahead, and the permit is priced after WSDOT\'s review.',
    },
    WAC_468_38_405,
    EFF_SUPERLOAD,
  ),

  // ── Recorded unknowns, split by materiality ─────────────────────────────
  /**
   * MATERIAL: this one moves a priced line, so it is `manualReview` rather than
   * an advisory. See `EXCESS_BASE_INFERENCE`.
   */
  escortRule(
    'wa-excess-base-is-configuration-dependent',
    'Overweight fee band selected from an assumed 80,000 lb legal capacity',
    { kind: 'gt', measure: 'grossWeightLbs', value: EXCESS_BASE_INFERENCE },
    {
      manualReview:
        'Washington prices the overweight permit on EXCESS weight over legal capacity, and RCW 46.44.096 defines that capacity as "gross loadings in excess of loadings authorized by law or axle loadings in excess of loadings authorized by law, whichever is the greater" — a function of the axle layout, not a constant. The band on this quote was selected by treating legal capacity as 80,000 lb, which is what RCW 46.44.041\'s own formula gives for an ordinary five-axle tractor-semitrailer and what federal law allows on the Interstate. THAT IS OUR ASSUMPTION, NOT THE STATE\'S: a longer or heavier-axled configuration reaches further up the RCW 46.44.041 table, toward its 105,500 lb ceiling, and would carry less excess and a cheaper band than the fee shown. Confirm the legal capacity for this configuration with WSDOT before billing.',
    },
    RCW_46_44_096,
    EFF_096,
  ),
  escortRule(
    'wa-no-weight-escort-trigger-published',
    'Weight-based escort triggers — none published, and additional escorts remain at the department’s discretion',
    { kind: 'gt', measure: 'grossWeightLbs', value: EXCESS_BASE_INFERENCE },
    {
      advisory:
        'WAC 468-38-100(1) publishes no weight-based pilot/escort trigger, so no escort has been added for this load\'s weight. That is not the same as none being required: WAC 468-38-405(6) provides that "Additional pilot/escort vehicles, and/or law enforcement vehicles, may be required as a result of the dimension of the load relative to the route and the time of day the move will be made", authorised through the department\'s administrator for commercial vehicle services under WAC 468-38-100(1)(k). The source dataset marked the weight-escort question CANNOT QUOTE VERBATIM and nothing has been reconstructed for it.',
    },
    WAC_468_38_405,
    EFF_SUPERLOAD,
  ),
  escortRule(
    'wa-police-escort-no-published-rate',
    'Law-enforcement escort — discretionary, and Washington publishes no rate for it',
    PERMIT_LIKELY,
    {
      advisory:
        'A law-enforcement escort may be required under WAC 468-38-405(6) and WAC 468-38-100(1)(k), and uniformed off-duty officers may perform escort duties under WAC 468-38-100(15). Neither the Washington State Patrol nor WSDOT publishes an application fee, hourly trooper rate, mileage rate, minimum hours, per diem or cancellation charge in the RCW, the WAC or their own FAQs — WSP\'s own answer to "When is an escort car required?" is "Please contact WSDOT". No police-escort amount is included in this quote and none can be estimated from published sources.',
    },
    WAC_468_38_405,
    EFF_SUPERLOAD,
  ),
  escortRule(
    'wa-overhead-obstacle-unknowns',
    'Over 14 ft high — Washington publishes no bucket-truck or utility-notification threshold',
    { kind: 'gt', measure: 'heightIn', value: ftIn(14) },
    {
      advisory:
        'Washington sets no numerical height at which a bucket truck must accompany the move and no advance-notice threshold for notifying overhead utility owners; the source dataset marked both CANNOT QUOTE VERBATIM and neither has been reconstructed. What the rules do require is that the applicant prerun an overheight route (WAC 468-38-070(1)(b)), that a superload traffic-control plan state "Arrangements for the movement of overhead obstacles" (WAC 468-38-405(3)(d)(iv)), and that a building move over 16 ft wide on two lanes or 20 ft on multilane have every overhead obstacle approved by the region traffic engineer (WAC 468-38-360(6)(c)). Any bucket truck, utility standby or wire lift is a third-party cost and is not in the permit total.',
    },
    WAC_468_38_405,
    EFF_SUPERLOAD,
  ),
  escortRule(
    'wa-no-percentage-surcharge-on-file',
    'Permit processing — no percentage surcharge is codified, and self-issuing adds nothing',
    PERMIT_LIKELY,
    {
      advisory:
        'The permit total carries no percentage-based processing surcharge, because WSDOT states "There are no additional charges for self-issuing. The cost of the overweight permit is the same as purchasing the permit from a WSDOT office." The source dataset separately marked the percentage-surcharge question CANNOT QUOTE VERBATIM, recording only that neither RCW 46.44 nor WAC 468-38 establishes one; nothing has been reconstructed for it. Note that the $3.50 an appointed agent may keep under RCW 46.44.096 is a share OF the permit fee, not an amount added to it, so buying through an agent does not change the total above.',
    },
    WSDOT_SELF_ISSUE,
    RETRIEVED,
  ),
  escortRule(
    'wa-pilot-car-certification',
    'Pilot/escort operator certification — required in Washington, with eight partner states recognised inbound and no outbound list published',
    { kind: 'gt', measure: 'widthIn', value: ftIn(11) },
    {
      advisory:
        'Any pilot car on this move must be run by a certified operator: WAC 468-38-100(4)(d) requires an eight-hour initial course or a four-hour recertification, a written test at 80 percent or better, and renewal every three years, with for-hire operators insured to $100,000 per person, $300,000 per accident and $50,000 property damage under WAC 468-38-100(16). Washington recognises certifications from Arizona, Colorado, Georgia, Minnesota, North Carolina, Oklahoma, Utah and Virginia. It publishes no list of the states that accept a Washington card in return — the source dataset marked outbound reciprocity CANNOT QUOTE VERBATIM — so a Washington-certified operator crossing a state line should confirm acceptance before the move. Course tuition is charged by department-approved vendors at a market rate and is not a state fee.',
    },
    WSDOT_PILOT_ESCORT,
    RETRIEVED,
  ),
];

// ── The jurisdiction ──────────────────────────────────────────────────────

export const WASHINGTON_OSOW_RULES: JurisdictionOsowRules = {
  code: 'WA',
  name: 'Washington',
  country: 'US',

  legalLimits: {
    widthIn: [
      fromDated(
        102,
        RCW_46_44_010,
        '2005-07-24',
        'RCW 46.44.010 states the limit as "eight and one-half feet"; normalised to inches. A width-exclusive safety device identified under RCW 46.44.101 may extend up to three inches beyond the body, and a motor home, travel trailer or camper may carry appurtenances four inches beyond the body or six for an awning (RCW 46.44.013) — none of which is applied, because a quote does not collect the device or the body style.',
      ),
    ],
    heightIn: [
      fromDated(
        ftIn(14),
        RCW_46_44_020,
        '1984-03-07',
        'Unlike Missouri and Oklahoma, Washington sets ONE height for every public highway — there is no county-road or non-designated-route step down to 13 ft 6 in. The exemption is for emergency vehicles and public-utility repair equipment only.',
      ),
    ],
    trailerLengthIn: [
      fromDated(
        ftIn(53),
        RCW_46_44_030,
        '2026-06-11',
        'RCW 46.44.030(2)(a) regulates the trailing unit, not the combination: "a semitrailer length in excess of 53 feet". A tractor and two trailers is capped at 61 ft of combined trailer length, and unladen inventory trailers under 26,000 lb may reach 82 ft overall under (2)(b).',
      ),
    ],
    /**
     * `overallLengthIn` is ABSENT, and the distinction matters. RCW 46.44.030
     * caps a SINGLE vehicle at 40 ft and a truck-and-trailer or log truck with a
     * stinger-steered pole trailer at 75 ft overall — but for the
     * tractor-semitrailer these quotes price, the statute regulates the
     * semitrailer alone and states no overall combination cap. Recording 40 ft
     * or 75 ft here would put every ordinary tractor-semitrailer over the legal
     * limit in Washington. Absent means "Washington does not cap the overall
     * combination length for this configuration", which is a quieter and truer
     * claim than an empty list's "we looked and found nothing".
     */
    frontOverhangIn: [
      fromDated(
        ftIn(3),
        RCW_46_44_034,
        '2017-07-23',
        'Measured beyond the front wheels, or beyond the front bumper where one is fitted.',
      ),
    ],
    rearOverhangIn: [
      fromDated(
        ftIn(15),
        RCW_46_44_034,
        '2017-07-23',
        'Measured from the CENTER OF THE LAST AXLE, not from the rear of the deck — the same datum WAC 468-38-100(1)(d) and (g) use for their escort triggers, so the legal limit and the escort thresholds are on the same measurement.',
      ),
    ],
    /**
     * 80,000 lb, with the RCW table's real ceiling recorded in the note rather
     * than as a second competing row. See `EXCESS_BASE_INFERENCE`: the two
     * numbers are not two sources disagreeing, they are one table read at two
     * axle spacings, and filing them as a conflict would refuse to price every
     * Washington quote over a question the statute answers plainly.
     */
    grossWeightLbs: [
      fromDated(
        80000,
        RCW_46_44_041,
        '2016-06-09',
        'RCW 46.44.041 states no flat gross cap. Its table is generated by W = 500((LN/(N-1)) + 12N + 36), rounded to the nearest 500 lb, and RISES TO 105,500 lb for five to nine axles at 86 ft or more of extreme spacing. 80,000 lb is what the same formula gives for the ordinary five-axle tractor-semitrailer at 51 ft, and what federal law allows for regular Interstate operation. A load that is legal in Washington at 95,000 lb on a long spread is therefore shown here as overweight; that is conservative in the customer\'s favour on the permit question and NOT conservative on the fee, which is why `wa-excess-base-is-configuration-dependent` sends any overweight Washington move to review. RCW 46.44.041 separately allows up to 80,000 lb, off the Interstate, for loads legally haulable in a bordering sales-tax state moving to a port district within four miles of that border.',
      ),
    ],
    singleAxleLbs: [
      fromDated(
        20000,
        RCW_46_44_041,
        '2016-06-09',
        'RCW 46.44.042 additionally caps any tire at 600 lb per inch of tire width, requires four or more tires on an axle carrying over 10,000 lb, and derates a two-tire axle to 500 lb per inch — none of which is applied here, because a quote does not collect tire width or count. That section does not apply to a nonreducible load moving under an oversize or overweight permit.',
      ),
    ],
    tandemAxleLbs: [
      fromDated(
        34000,
        RCW_46_44_041,
        '2016-06-09',
        'The statutory table gives 34,000 lb for two axles spaced from 4 ft up to and including 8 ft, and two consecutive tandem sets may each carry 34,000 lb when the first and last axles of the sets are 36 ft or more apart. Where inches are involved the statute rounds the spacing: "Under six inches take lower, six inches or over take higher."',
      ),
    ],
  },

  /**
   * A SOURCED ZERO, and it has to be, because of RCW 46.44.096.
   *
   * Washington's single-trip dimensional charge is the $10 row of RCW
   * 46.44.0941 — and RCW 46.44.096 then says a load that is both overweight and
   * oversize "shall be charged the fee for the overweight permit without
   * additional fees being assessed for the oversize features". If the $10 sat
   * here it would be added to every combined permit as a base fee, above the
   * combination rule, and Washington would over-quote every overweight
   * heavy-haul move by $10. So the $10 lives in `oversizeFeeBands`, where
   * `combinedFeeRule` can suppress it, and this row records the separate fact
   * that Washington charges NOTHING on top of its schedule. The engine
   * suppresses the empty line rather than printing "$0.00" beside a real fee.
   */
  permitBaseFeeUsd: [
    fromDated(
      0,
      RCW_46_44_0941,
      EFF_FEES,
      'RCW 46.44.0941 lists a flat fee per permit type and no separate issuance or processing charge on top of it. The whole single-trip oversize charge is the $10.00 row, held in `oversizeFeeBands` so that RCW 46.44.096\'s no-double-charging rule can reach it.',
    ),
  ],

  /**
   * One band, no dimensional bounds — because Washington does not step the
   * oversize fee by dimension at all. "All overlegal loads, except overweight,
   * single trip. . . .$ 10.00" is the entire schedule: the same $10 whether the
   * load is an inch over width or 30 ft wide.
   */
  oversizeFeeBands: [
    fromDated<OversizeFeeBand>(
      {
        label: 'single-trip permit, any overlegal dimension',
        feeUsd: 10,
      },
      RCW_46_44_0941,
      EFF_FEES,
      '"All overlegal loads, except overweight, single\\n\\ntrip. . . .$ 10.00" — the first and only single-trip row of the RCW 46.44.0941 table. WSDOT prints the permit\'s validity as three days.',
    ),
  ],

  /**
   * RCW 46.44.096, in as many words: "Loads which are overweight and oversize
   * shall be charged the fee for the overweight permit without additional fees
   * being assessed for the oversize features." Same shape as Ohio's rule and for
   * the same reason — recorded as sourced data so no later edit can quietly
   * restore the additive behaviour and inflate every combined Washington permit
   * by the $10 dimensional fee.
   */
  combinedFeeRule: [
    fromDated<CombinedFeeRule>(
      {
        kind: 'overweightOnly',
        explanation:
          'RCW 46.44.096: "Loads which are overweight and oversize shall be charged the fee for the overweight permit without additional fees being assessed for the oversize features." The $10.00 dimensional fee is not billed alongside the mileage fee.',
      },
      RCW_46_44_096,
      EFF_096,
    ),
  ],

  overweightPricing: [
    fromDated<OverweightPricing>(
      {
        kind: 'perMile',
        explanation:
          'RCW 46.44.0941\'s Overweight Fee Schedule is a per-mile rate stepped by excess weight over legal capacity — $0.07 a mile at the bottom, $4.25 at 100,000 lb of excess, then $4.25 plus 50 cents for each further 5,000 lb increment or portion thereof. RCW 46.44.096 measures the mileage from the department\'s planning survey records and takes the excess as "gross loadings in excess of loadings authorized by law or axle loadings in excess of loadings authorized by law, whichever is the greater". A $14.00 minimum applies to any overweight permit, and the computed amount is carried to the next full dollar at 50 cents and reduced to it at 49.',
      },
      RCW_46_44_0941,
      EFF_FEES,
    ),
  ],

  /** Washington steps by distance, not by flat weight bands. */
  overweightBands: [],

  overweightPerMile,

  /**
   * EMPTY, AS A FINDING. Washington attaches no weight-conditioned surcharge to
   * a single-trip permit — no supervision fee, no superload surcharge. The
   * charges that do exist above the schedule are for OTHER products: $14.00 for
   * a duplicate permit, $2.80 per day per 2,000 lb for a temporary additional
   * tonnage permit under RCW 46.44.095, $50.00 a year for a log tolerance permit
   * under RCW 46.44.047, and $100 a month or $1,000 a year for a heavy haul
   * industrial corridor permit under RCW 46.44.0915. None is a single-trip fee
   * and none is charged here.
   */
  conditionalFees: [],

  /**
   * A SOURCED ZERO, on WSDOT's own words. This is not "we found no fee" — it is
   * WSDOT stating there is none: "There are no additional charges for
   * self-issuing. The cost of the overweight permit is the same as purchasing
   * the permit from a WSDOT office." The $3.50 an appointed agent may retain
   * under RCW 46.44.096 comes OUT of the fee the carrier already pays and is
   * not added to it, so it does not belong in this field either.
   */
  transactionFee: [
    fromUndatedPage<TransactionFee>(
      { perPermitUsd: 0, percentOfTotal: 0 },
      WSDOT_SELF_ISSUE,
      'Self-issued through eSNOOPI Pro at no surcharge. RCW 46.44.096 lets an appointed agent "retain three dollars and fifty cents for each permit sold" — a share of the fee, not an addition to it.',
    ),
  ],

  /**
   * EMPTY, AND THAT IS THE FINDING. Washington publishes no flat route- or
   * bridge-analysis review fee. WAC 468-38-405(4) instead says that "If, due to
   * the size of the configuration, the analysis will require a significant
   * expenditure of department resources, the applicant may be required to share
   * in those costs", with an estimate given before the work begins. There is a
   * charge, it has no published amount, and putting a number here would invent
   * one. Loads over 200,000 lb never reach a priced line anyway — they are
   * superloads and the engine emits no fee for them.
   */
  routeAnalysisFeeUsd: [],
  noBridgeRouteFeeUsd: [],

  superload: {
    grossWeight: [
      fromDated<Threshold>(
        { value: 200000, inclusive: false },
        WAC_468_38_405,
        EFF_SUPERLOAD,
        '"A superload is any nondivisible load that exceeds two hundred thousand pounds". "Exceeds" — 200,000 lb exactly is still an ordinary permit. RCW 46.44.091(5) requires the application at least thirty calendar days ahead.',
      ),
    ],
    /**
     * EMPTY. Washington publishes no weight band that becomes a superload on
     * short axle spacing — its superload test is a flat 200,000 lb plus three
     * dimensional triggers. Empty here is silent by design; the engine only
     * consults this list when a resolved band exists.
     */
    shortSpacing: [],
    widthIn: [
      fromDated<Threshold>(
        { value: ftIn(16), inclusive: false },
        WAC_468_38_405,
        EFF_SUPERLOAD,
        'A dimensional superload application must be filed at least seven calendar days before the move.',
      ),
    ],
    heightIn: [
      fromDated<Threshold>({ value: ftIn(16), inclusive: false }, WAC_468_38_405, EFF_SUPERLOAD),
    ],
    /**
     * `overallLengthIn` is ABSENT. Washington's fourth superload criterion is a
     * "trailing unit(s) plus load in excess of one hundred twenty-five feet" —
     * a trailer measurement, not an overall combination length. Testing it
     * against the whole combination would include the tractor and call ordinary
     * moves superloads, so it is carried by the escort rule
     * `wa-superload-trailing-unit-over-125`, which can read `trailerLengthIn`.
     */
  },

  /**
   * WAC 468-38-070(1)(b) requires the applicant to prerun the route for a load
   * over 14 ft high, and WAC 468-38-405 puts the duty in general terms: "It is
   * the responsibility of the permit applicant to check, or prerun, the proposed
   * route and provide for safe maneuvers around the obstruction or detours as
   * necessary." Washington publishes no width or length prerun trigger, so those
   * lists are empty rather than guessed — an invented width trigger would send
   * loads to an inspection the state never asked for. An empty list here is
   * silent by design.
   */
  routeInspection: {
    widthIn: [],
    heightIn: [
      fromDated<Threshold>(
        { value: ftIn(14), inclusive: false },
        WAC_468_38_405,
        EFF_SUPERLOAD,
        'The prerun is performed and paid for by the applicant, so it is not a state charge and is not in the permit total.',
      ),
    ],
    lengthIn: [],
  },

  escortRules: WASHINGTON_ESCORT_RULES,

  /** Per mile travelled inside Washington, on WSDOT's planning survey records. */
  feesDependOnDistance: true,
};
