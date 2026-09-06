/**
 * MINNESOTA — oversize/overweight single-trip permit rules.
 *
 * FOUR THINGS DECIDE HOW THIS STATE IS ENCODED, AND EACH ONE IS A SHAPE NO
 * EARLIER JURISDICTION NEEDED.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 1. MINNESOTA MEASURES WIDTH TWICE, IN ONE SENTENCE.
 *    Minn. Stat. § 169.812 subd. 2(a): "no escort vehicle is required if the
 *    width of an overdimensional load is 15 feet or less as measured AT THE
 *    BOTTOM of the load or is 16 feet or less as measured AT THE TOP of the
 *    load." A tank 14 ft across the deck and 17 ft across the shell needs
 *    escorts in Minnesota and reports none against a single `widthIn`.
 *    `widthAtBottomIn` and `widthAtTopIn` are separate measures and NEITHER
 *    falls back to `widthIn`: a load whose profile was not stated leaves both
 *    conditions `unknown`, the escort rules land in `undecided`, and the quote
 *    goes to review naming the two measurements it needs. Deriving them from
 *    the overall width would answer the state's question with a number the
 *    shipper never gave.
 *
 * 2. THE OVERWEIGHT FEE IS PER-MILE, PER-AXLE-GROUP, SUMMED THEN MULTIPLIED.
 *    § 169.86 subd. 5(e): "The additional cost is equal to the product of the
 *    distance traveled times the SUM of the overweight axle group cost factors
 *    shown in the following chart." The order is the statute's — sum the
 *    per-group factors first, then multiply by the distance — and the rounding
 *    attaches to the per-group factor: "The amounts added are rounded to the
 *    nearest cent for each axle or axle group." Two 140,000 lb Minnesota loads
 *    with the same gross and different axle arrangements are DIFFERENT PRICES,
 *    which no banding of gross weight can reproduce. `feesDependOnDistance` is
 *    therefore TRUE, and `perMilePerAxleGroupAmount` answers `null` rather than
 *    a partial sum when any group has no row in the chart — a chart that does
 *    not price a group does not price the move.
 *
 * 3. THE FROST CALENDAR IS A PRICING INPUT, NOT ONLY A LEGALITY ONE.
 *    § 169.86 subd. 5(g): "For vehicles which exceed the width limitations set
 *    forth in section 169.80 by more than 72 inches, an additional cost equal
 *    to $120 added to the amount in paragraph (a) WHEN THE PERMIT IS ISSUED
 *    WHILE SEASONAL LOAD RESTRICTIONS pursuant to section 169.87 ARE IN
 *    EFFECT." 102 in + 72 in = 174 in, so a single trip wider than 14 ft 6 in
 *    costs $135 during the thaw and $15 outside it. It is encoded as three
 *    mutually-exclusive oversize bands, two of them carrying a
 *    `Sourced.appliesWhen` on the restriction state, and the seam is
 *    `seasonalStateFor()` in the engine.
 *
 *    WHAT HAPPENS WHEN THE SEASON IS NOT KNOWN IS THE POINT. `seasonalStateFor`
 *    returns `undefined` for a missing snapshot, an unreachable snapshot store
 *    OR a snapshot older than its own staleness budget — three different
 *    failures making one claim, WE DO NOT KNOW. The $120 row and the $0 row are
 *    then both undecidable, both are retained, they disagree, and the resolver
 *    refuses to pick: the quote says it cannot price the oversize component
 *    until it is told whether seasonal load restrictions are in effect. It does
 *    NOT quietly price the move as summer, which is the failure this whole
 *    mechanism exists to prevent.
 *
 *    MnDOT's allowable PERMIT axle weights are the other half of the same seam
 *    and are recorded, not applied: the page publishes three columns — Spring
 *    Load Restriction / Middle-Range Restriction / Unrestricted — so what a
 *    permit AUTHORISES moves with the season too (a tandem is 34,000 /
 *    36,000 / 46,000 lb across the three). Those are permit ALLOWANCES rather
 *    than legal limits, and the engine's axle machinery evaluates legal limits,
 *    so they are quoted in `singleAxleLbs`'s note rather than encoded as a
 *    table that would mark loads over a ceiling they are entitled to.
 *
 * 4. THE PAVED / UNPAVED SPLIT ON THE LEGAL SINGLE AXLE.
 *    § 169.823 subd. 1(2): "where the gross weight on any single axle exceeds
 *    18,000 pounds on an unpaved street or highway or 20,000 pounds on a paved
 *    street or highway". Two correct numbers about two different moves, which
 *    is exactly the case `Sourced.appliesWhen` was built for and which
 *    `provenance.ts` names Minnesota for. A quote that has not said which road
 *    it runs on keeps BOTH rows, they disagree, and the warning asks for the
 *    fact that would settle it rather than telling a carrier their state
 *    contradicts itself.
 *
 * THE ROUTE VOCABULARY IS A CROSS PRODUCT, AND IT HAS TO BE.
 * ---------------------------------------------------------
 * Minnesota's rules turn on TWO independent properties of the road — paving
 * (§ 169.823, legal axle weight) and median (§ 169.812, escorts) — and a caller
 * passes ONE `routeClass`. Colorado already faced this with map colour against
 * lane count and the answer was the same: the two axes travel together in one
 * value. The generic `divided`, `two-lane`, `multilane-undivided`, `urban` and
 * `interstate` map onto the PAVED variants and not the unpaved ones, because
 * MnDOT's permits are valid on the state trunk, US and interstate systems only
 * — "Minnesota oversize/overweight permits are not valid on county, township,
 * or municipal roads" — and that is the paved network. The unpaved classes have
 * no general equivalent, so a caller must name one deliberately.
 *
 * WHAT IS DELIBERATELY EMPTY, ABSENT OR HELD-BUT-NOT-APPLIED
 * ---------------------------------------------------------
 *   - `frontOverhangIn` / `rearOverhangIn` are ABSENT. §§ 169.80-169.81 were
 *     read and contain no legal overhang limit. What Minnesota publishes is a
 *     MARKING threshold — MnDOT General Provisions (Aug 2024) condition 6:
 *     "flags are required when overhang extends more than 3 feet ahead of the
 *     front bumper or extends 4 feet beyond the rear of the vehicle" — with an
 *     asymmetric operator inside one sentence ("more than 3 feet", exclusive;
 *     "extends 4 feet", unqualified and arguably inclusive). A marking duty is
 *     not a legal limit and is not recorded as one. Iowa's escort table sets
 *     overhang rows; Minnesota's does not.
 *   - `routeAnalysisFeeUsd` and `noBridgeRouteFeeUsd` are EMPTY. MnDOT's May
 *     2025 superload guide states no superload fee at all: a 250,000 lb move
 *     appears to pay the ordinary $15 plus the damage assessment, and any
 *     third-party bridge consultant is engaged and paid by the carrier — "If
 *     the Bridge Office determines that a third-party consultant is necessary
 *     for the analysis, it is the carrier's responsibility to secure the
 *     consultant and cover all associated costs." That asymmetry against Texas
 *     ($500 review + $100 no-bridge route) is a finding, not a gap.
 *   - `conditionalFees` is EMPTY, and the omission is a real hole this file
 *     names rather than papers over. § 169.86 subd. 5a levies "an additional
 *     tax for excessive gross weight ... the difference between the
 *     registration tax paid under section 168.013, subdivision 1e, and the
 *     additional tax that would be due ... at the gross weight allowed under
 *     the permit, prorated by the number of days for which the permit is
 *     effective." It needs the vehicle's registered weight and the § 168.013
 *     subd. 1e rate schedule, neither of which a quote holds. UNKNOWN in
 *     amount, recorded here, never estimated.
 *   - `MINNESOTA_AXLE_SPACING_ROUNDING` is EXPORTED AND NOT APPLIED, and the
 *     reason is at its own definition.
 *
 * DATE DISCIPLINE
 * ---------------
 *   - revisor.mn.gov prints no publication date on the page. `revisedOn` for a
 *     statute is the year in that section's own amendment table — § 169.86
 *     subd. 5 last moved in 2012, § 169.812 in 2021 — and for a rule the
 *     "Published Electronically" line (Minn. R. 7455: 2013-02-25). Bare years
 *     are permitted for `revisedOn` and sort correctly; § 169.86's fee figures
 *     have not been amended in fourteen years, which makes them old numbers
 *     that are still the law rather than a stale scrape.
 *   - TWO "General Provisions" PDFs are live on mndot.gov right now and the
 *     older one has the friendlier URL: `/cvo/permits/GeneralProvisions.pdf`
 *     self-stamps "v.01172022" and is not marked superseded, while the copy
 *     linked from the current Resources page (edocs docId 27830707) stamps
 *     "Version: August 2024" and has different content. Rows here take the
 *     2024 document except where the 2022 one is quoted precisely because it
 *     says something the 2024 one does not.
 *   - The Minnesota Trucking Regulations stop at 2022; the 2023-2026 paths all
 *     404 while MnDOT still links `/cvo/mntruckbook/`.
 *   - MnDOT web pages are undated; their "2026 Minnesota Department of
 *     Transportation" footer is a copyright line, so `revisedOn` is null and
 *     `effectiveFrom` is the retrieval date.
 */
import type { SourceDoc, Sourced } from '../provenance.js';
import { ftIn, type EscortRule } from '../escortRules.js';
import type { RouteVocabulary } from '../routeContext.js';
import type {
  AxleGroupCostFactor,
  AxleSpacingRounding,
  JurisdictionOsowRules,
  OversizeFeeBand,
  OverweightPricing,
  PerMilePerAxleGroupRate,
  PublishedAbsence,
  Threshold,
  TransactionFee,
} from '../types.js';

const RETRIEVED = '2026-09-05';

// ── Source documents ──────────────────────────────────────────────────────

const MN_169_80: SourceDoc = {
  id: 'mn-stat-169-80',
  title: 'Minn. Stat. § 169.80 — Width, height, length',
  url: 'https://www.revisor.mn.gov/statutes/cite/169.80',
  publisher: 'Office of the Revisor of Statutes, State of Minnesota',
  revisedOn: '2001',
  retrievedOn: RETRIEVED,
  cite: 'subd. 2(a); the page carries no publication date, so the year comes from the section’s own amendment table',
};

const MN_169_81: SourceDoc = {
  id: 'mn-stat-169-81',
  title: 'Minn. Stat. § 169.81 — Height and length of vehicles',
  url: 'https://www.revisor.mn.gov/statutes/cite/169.81',
  publisher: 'Office of the Revisor of Statutes, State of Minnesota',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'subd. 1 (height), subd. 2 (single vehicle and semitrailer), subd. 3 (combination); the amendment table shows no year for subd. 1',
};

const MN_169_812: SourceDoc = {
  id: 'mn-stat-169-812',
  title: 'Minn. Stat. § 169.812 — Escort vehicles',
  url: 'https://www.revisor.mn.gov/statutes/cite/169.812',
  publisher: 'Office of the Revisor of Statutes, State of Minnesota',
  revisedOn: '2021',
  retrievedOn: RETRIEVED,
  cite: 'subd. 2 (width) and subd. 3 (length); History "2020 c 100 s 11; 1Sp2021 c 5 art 4 s 65"',
};

const MN_169_823: SourceDoc = {
  id: 'mn-stat-169-823',
  title: 'Minn. Stat. § 169.823 — Pneumatic-tired vehicles: wheel and axle limits',
  url: 'https://www.revisor.mn.gov/statutes/cite/169.823',
  publisher: 'Office of the Revisor of Statutes, State of Minnesota',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'subd. 1(1)-(4) and subd. 2',
};

const MN_169_824: SourceDoc = {
  id: 'mn-stat-169-824',
  title: 'Minn. Stat. § 169.824 — Axle weight limits table and gross vehicle weight',
  url: 'https://www.revisor.mn.gov/statutes/cite/169.824',
  publisher: 'Office of the Revisor of Statutes, State of Minnesota',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'subd. 1(a) (the table and its measurement-rounding rule), subd. 1(b), subd. 2, subd. 3',
};

const MN_169_86: SourceDoc = {
  id: 'mn-stat-169-86',
  title: 'Minn. Stat. § 169.86 — Special permits; fees',
  url: 'https://www.revisor.mn.gov/statutes/cite/169.86',
  publisher: 'Office of the Revisor of Statutes, State of Minnesota',
  revisedOn: '2012',
  retrievedOn: RETRIEVED,
  cite: 'subd. 5(a) $15 single trip, subd. 5(e) the overweight axle group cost factors, subd. 5(g) the $120 seasonal width surcharge, subd. 5a the excessive-gross-weight tax; History "2012 c 287 art 3 s 35"',
};

const MN_299D_085: SourceDoc = {
  id: 'mn-stat-299d-085',
  title: 'Minn. Stat. § 299D.085 — Overdimensional load escort driver certification',
  url: 'https://www.revisor.mn.gov/statutes/cite/299D.085',
  publisher: 'Office of the Revisor of Statutes, State of Minnesota',
  revisedOn: '2019',
  retrievedOn: RETRIEVED,
  cite: 'subd. 2 (certificate) and subd. 3 (qualifications); History ends "1Sp2019 c 1 art 6 s 1"',
};

const MN_RULE_7455: SourceDoc = {
  id: 'mn-rule-7455',
  title: 'Minn. R. ch. 7455 — Pilot/escort vehicle drivers',
  url: 'https://www.revisor.mn.gov/rules/7455/full',
  publisher: 'Minnesota Department of Public Safety',
  revisedOn: '2013-02-25',
  retrievedOn: RETRIEVED,
  cite: '7455.0300 subp. 1 and subp. 3 (certification and reciprocity), 7455.1000 item (10) (height pole); "Published Electronically: February 25, 2013"',
};

const MNDOT_ESCORTS: SourceDoc = {
  id: 'mndot-escorts-page',
  title: 'MnDOT — Pilot car escorts',
  url: 'https://www.dot.state.mn.us/cvo/oversize/escorts.html',
  publisher: 'Minnesota Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'undated page; the footer "2026 Minnesota Department of Transportation" is a copyright line, not a revision date',
};

const MNDOT_DAMAGE_FEES: SourceDoc = {
  id: 'mndot-damage-assessment-fees',
  title: 'MnDOT — Damage assessment fee calculator',
  url: 'https://www.dot.state.mn.us/cvo/oversize/damage-assessment-fees.html',
  publisher: 'Minnesota Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'the axle-group cost-factor table indexed by TOTAL axle group weight, and MnDOT’s own worked example',
};

const MNDOT_DETERMINE: SourceDoc = {
  id: 'mndot-determine-page',
  title: 'MnDOT — Determine if you need an oversize/overweight permit',
  url: 'https://www.dot.state.mn.us/cvo/oversize/determine.html',
  publisher: 'Minnesota Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
};

const MNDOT_ALLOWABLE_AXLE: SourceDoc = {
  id: 'mndot-allowable-axle-weights',
  title: 'MnDOT — Allowable permit axle weights, 10 ton roads',
  url: 'https://www.dot.state.mn.us/cvo/oversize/allowable-axle-weights.html',
  publisher: 'Minnesota Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'three columns keyed to Spring Load Restriction / Middle-Range Restriction / Unrestricted',
};

const MNDOT_ROUTE_SURVEY: SourceDoc = {
  id: 'mndot-route-survey',
  title: 'MnDOT — Physical route survey',
  url: 'https://www.dot.state.mn.us/cvo/oversize/route-survey.html',
  publisher: 'Minnesota Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
};

const MNDOT_SUPERLOAD: SourceDoc = {
  id: 'mndot-superload-guide-2025-05',
  title: 'MnDOT — Guide to Transporting Superloads in Minnesota',
  url: 'https://edocs-public.dot.state.mn.us/edocs_public/DMResultSet/download?docId=38891212',
  publisher: 'Minnesota Department of Transportation',
  revisedOn: '2025-05-01',
  retrievedOn: RETRIEVED,
  cite: 'printed header "May 2025" on every page; the PDF title metadata ("Route Survey Version 2024") is left over from another document and is not used',
};

const MNDOT_GENERAL_PROVISIONS_2024: SourceDoc = {
  id: 'mndot-general-provisions-2024-08',
  title: 'MnDOT — Oversize/Overweight Permit General Provisions',
  url: 'https://edocs-public.dot.state.mn.us/edocs_public/DMResultSet/download?docId=27830707',
  publisher: 'Minnesota Department of Transportation',
  revisedOn: '2024-08-01',
  retrievedOn: RETRIEVED,
  cite: 'printed "Version: August 2024"; a DIFFERENT General Provisions PDF stamped v.01172022 is still live at /cvo/permits/GeneralProvisions.pdf and is not marked superseded',
};

const MNDOT_GENERAL_PROVISIONS_2022: SourceDoc = {
  id: 'mndot-general-provisions-2022-01',
  title: 'MnDOT — Oversize/Overweight Permit General Provisions (v.01172022)',
  url: 'https://www.dot.state.mn.us/cvo/permits/GeneralProvisions.pdf',
  publisher: 'Minnesota Department of Transportation',
  revisedOn: '2022-01-17',
  retrievedOn: RETRIEVED,
  cite: 'quoted only for the seven-state pilot-car list, which the August 2024 version drops entirely',
};

const MN_TRUCK_BOOK_2022: SourceDoc = {
  id: 'mn-trucking-regulations-2022-s05',
  title: 'Minnesota Trucking Regulations (2022), section 05 — Permits',
  url: 'https://www.dot.state.mn.us/cvo/mntruckbook/2022/section-05.pdf',
  publisher: 'Minnesota Department of Transportation',
  revisedOn: '2022',
  retrievedOn: RETRIEVED,
  cite: 'the newest edition published at that path; 2023, 2024, 2025 and 2026 all return 404',
};

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * A YEAR IS ALL revisor.mn.gov GIVES, AND MINNESOTA PUBLISHES HOW TO READ IT.
 *
 * The Revisor's pages carry no publication date; the only date a section states
 * is the YEAR in its own amendment table. `revisedOn` records that bare year,
 * which is the honest precision — but `effectiveFrom` feeds `isInEffect` and
 * must be a real day. Minn. Stat. § 645.02 supplies it: "Each act, except one
 * making appropriations, enacted finally at any session of the legislature
 * takes effect on August 1 next following its final enactment, unless a
 * different date is specified in the act." So a 2012 amendment is in effect
 * from 1 August 2012. That is the state's own default rule rather than a date
 * this file invented, and it errs LATE — a quote backdated inside the gap finds
 * nothing on file and asks, instead of quietly pricing from a row that had not
 * commenced.
 */
function fromDated<T>(
  value: T,
  source: SourceDoc,
  effectiveFromYearOrDate: string,
  note?: string,
): Sourced<T> {
  return {
    value,
    source,
    effectiveFrom: /^\d{4}$/.test(effectiveFromYearOrDate)
      ? `${effectiveFromYearOrDate}-08-01`
      : effectiveFromYearOrDate,
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

// ── Route vocabulary — paving × median, because both decide something ─────

const MINNESOTA_ROUTE_VOCABULARY: RouteVocabulary = {
  name: 'Minn. Stat. §§ 169.812 / 169.823 road classes',
  explanation:
    'Minnesota decides two different things on two independent properties of the road: § 169.823 subd. 1 sets the legal wheel and single-axle limits by PAVING (9,000/10,000 lb per wheel and 18,000/20,000 lb per axle, unpaved against paved) and § 169.812 subd. 2-3 sets the escort counts by MEDIAN ("multilane divided roadway" against "any undivided roadway"). A caller passes one route class, so the two axes travel together in one value — the same answer Colorado reached for map colour against lane count. The generic classes map onto the PAVED variants only: MnDOT permits are "not valid on county, township, or municipal roads", so the network a Minnesota permit covers is the paved state trunk, US and interstate system. An unpaved class must be named deliberately.',
  classes: [
    {
      id: 'MN:paved-multilane-divided',
      publishedName: 'paved multilane divided roadway',
      quote:
        '§ 169.812 subd. 2(b): "Only one rear escort vehicle is required on a multilane divided roadway if the width of an overdimensional load is more than 15 feet as measured at the bottom of the load or is more than 16 feet as measured at the top of the load." § 169.823 subd. 1(2): "20,000 pounds on a paved street or highway".',
      generalEquivalents: ['interstate', 'divided'],
    },
    {
      id: 'MN:paved-undivided',
      publishedName: 'paved undivided roadway',
      quote:
        '§ 169.812 subd. 2(c): "Only one lead escort vehicle and one rear escort vehicle is required on any undivided roadway if the width of an overdimensional load is more than 15 feet as measured at the bottom of the load or is more than 16 feet as measured at the top of the load."',
      generalEquivalents: ['two-lane', 'multilane-undivided', 'urban'],
    },
    {
      id: 'MN:unpaved-multilane-divided',
      publishedName: 'unpaved multilane divided roadway',
      quote:
        '§ 169.823 subd. 1(2): "where the gross weight on any single axle exceeds 18,000 pounds on an unpaved street or highway". No general class maps here — an unpaved road must be named deliberately.',
    },
    {
      id: 'MN:unpaved-undivided',
      publishedName: 'unpaved undivided roadway',
      quote:
        '§ 169.823 subd. 1(1)-(2): 9,000 lb per wheel and 18,000 lb per single axle on an unpaved street or highway.',
    },
  ],
};

const PAVED_CLASSES = ['MN:paved-multilane-divided', 'MN:paved-undivided'] as const;
const UNPAVED_CLASSES = ['MN:unpaved-multilane-divided', 'MN:unpaved-undivided'] as const;
const DIVIDED_CLASSES = [
  'MN:paved-multilane-divided',
  'MN:unpaved-multilane-divided',
] as const;
const UNDIVIDED_CLASSES = ['MN:paved-undivided', 'MN:unpaved-undivided'] as const;

// ── § 169.824 subd. 1(a)'s measurement rule ───────────────────────────────

/**
 * THE MOST EXPLICIT AXLE-SPACING ROUNDING RULE IN THIS CORPUS — HELD, AND NOT
 * YET APPLIED, WITH THE REASON STATED.
 *
 * § 169.824 subd. 1(a): "Unless otherwise noted, the distance between axles
 * must be measured longitudinally to the nearest even foot, and when the
 * measurement is a fraction of exactly one-half foot the next largest whole
 * number in feet shall be used, EXCEPT THAT when the distance between axles is
 * more than three feet four inches and less than three feet six inches the
 * distance of four feet shall be used."
 *
 * WHY IT IS NOT APPLIED. `AxleSpacingRounding` is read by
 * `evaluateAxleSpacingTable`, which needs an `AxleSpacingWeightTable` — a
 * PER-AXLE law keyed to the gap to the neighbouring axle, which is Michigan's
 * shape. Minnesota's § 169.824 subd. 1 table is a GROUP law: it bounds "the
 * total gross weight on any group of two or more consecutive axles ... for the
 * distance between the centers of the first and last axles". Forcing it into
 * the per-axle table would restate group maxima as axle maxima, and forcing it
 * into `stateBridgeTable` would switch the federal bridge check off for every
 * Minnesota load on a transcription this research explicitly marks as partial —
 * the parenthesised cells' meaning is set by subd. 1(b)-(e), which was not
 * fully captured. Either would be a confident wrong number. So the rule is held
 * here with its citation, exercised by `roundedSpacingFt` in the tests, and
 * wired to nothing.
 *
 * THE CARVE-OUT'S BOUNDS ARE THE ONE PLACE THIS ENCODING DIVERGES FROM THE
 * STATUTE, AND IT IS DELIBERATE. The statute's band is OPEN at both ends
 * ("more than three feet four inches and less than three feet six inches") and
 * `AxleSpacingRounding.carveOuts` are INCLUSIVE. Axle spacings are measured in
 * whole inches, and the only whole-inch value strictly inside the statute's
 * band is 3 ft 5 in — so the band is written as 3 ft 5 in to 3 ft 6 in.
 * Including 3 ft 6 in changes nothing, because the general rule already sends a
 * fraction of exactly one-half foot up to 4 ft. Writing the band from 3 ft 4 in
 * would have been the real error: at exactly 3 ft 4 in the general rule gives
 * 3 ft and the carve-out would have given 4 ft.
 */
export const MINNESOTA_AXLE_SPACING_ROUNDING: AxleSpacingRounding = {
  direction: 'nearest',
  toMultipleOfFt: 1,
  carveOuts: [
    {
      fromFt: 3 + 5 / 12,
      toFt: 3.5,
      treatAsFt: 4,
      quote:
        '§ 169.824 subd. 1(a): "except that when the distance between axles is more than three feet four inches and less than three feet six inches the distance of four feet shall be used."',
    },
  ],
  quote:
    '§ 169.824 subd. 1(a): "the distance between axles must be measured longitudinally to the nearest even foot, and when the measurement is a fraction of exactly one-half foot the next largest whole number in feet shall be used".',
};

// ── Escort rules ──────────────────────────────────────────────────────────

/** § 169.812 was last amended in the 2021 first special session. */
const ESCORT_FROM = '2021';

function escortRule(
  id: string,
  description: string,
  when: EscortRule['when'],
  then: EscortRule['then'],
  source: SourceDoc,
  effectiveFrom: string = ESCORT_FROM,
): EscortRule {
  return {
    id,
    jurisdiction: 'MN',
    description,
    when,
    then,
    source,
    // Same § 645.02 expansion as `fromDated` — see the comment there.
    effectiveFrom: /^\d{4}$/.test(effectiveFrom) ? `${effectiveFrom}-08-01` : effectiveFrom,
    effectiveTo: null,
  };
}

/**
 * THE TWO WIDTHS, IN THE STATUTE'S OWN DISJUNCTION. Subd. 2(a) exempts a load
 * that is "15 feet or less as measured at the bottom OR is 16 feet or less as
 * measured at the top", and (b)/(c) trigger on "more than 15 feet ... at the
 * bottom or is more than 16 feet ... at the top". Whichever measurement is
 * exceeded triggers, so the condition is an `any` of the two — and because
 * neither measure is derived from `widthIn`, a load stating only its overall
 * width leaves both branches `unknown` and the rule lands in `undecided`.
 */
const WIDTH_TRIGGER: EscortRule['when'] = {
  kind: 'any',
  of: [
    { kind: 'gt', measure: 'widthAtBottomIn', value: ftIn(15) },
    { kind: 'gt', measure: 'widthAtTopIn', value: ftIn(16) },
  ],
};

export const MINNESOTA_ESCORT_RULES: EscortRule[] = [
  escortRule(
    'mn-width-multilane-divided',
    'Over 15 ft at the bottom or 16 ft at the top, on a multilane divided roadway — one rear escort',
    {
      kind: 'all',
      of: [
        WIDTH_TRIGGER,
        { kind: 'context', of: { kind: 'routeClassIn', anyOf: [...DIVIDED_CLASSES] } },
      ],
    },
    { escorts: 1, rear: 1 },
    MN_169_812,
  ),
  escortRule(
    'mn-width-undivided',
    'Over 15 ft at the bottom or 16 ft at the top, on an undivided roadway — one lead and one rear escort',
    {
      kind: 'all',
      of: [
        WIDTH_TRIGGER,
        { kind: 'context', of: { kind: 'routeClassIn', anyOf: [...UNDIVIDED_CLASSES] } },
      ],
    },
    { escorts: 2, front: 1, rear: 1 },
    MN_169_812,
  ),
  escortRule(
    'mn-length-over-110-multilane-divided',
    'Over 110 ft long on a multilane divided roadway — one rear escort',
    {
      kind: 'all',
      of: [
        { kind: 'gt', measure: 'overallLengthIn', value: ftIn(110) },
        { kind: 'context', of: { kind: 'routeClassIn', anyOf: [...DIVIDED_CLASSES] } },
      ],
    },
    { escorts: 1, rear: 1 },
    MN_169_812,
  ),
  escortRule(
    'mn-length-over-150-multilane-divided',
    'Over 150 ft long on a multilane divided roadway — one lead and one rear escort',
    {
      kind: 'all',
      of: [
        { kind: 'gt', measure: 'overallLengthIn', value: ftIn(150) },
        { kind: 'context', of: { kind: 'routeClassIn', anyOf: [...DIVIDED_CLASSES] } },
      ],
    },
    { escorts: 2, front: 1, rear: 1 },
    MN_169_812,
  ),
  /**
   * NO 150 FT STEP ON AN UNDIVIDED ROAD — it is already two escorts at 110 ft,
   * so the statute does not need one. Encoded as the state wrote it rather than
   * mirrored from the divided column.
   */
  escortRule(
    'mn-length-over-110-undivided',
    'Over 110 ft long on an undivided roadway — one lead and one rear escort',
    {
      kind: 'all',
      of: [
        { kind: 'gt', measure: 'overallLengthIn', value: ftIn(110) },
        { kind: 'context', of: { kind: 'routeClassIn', anyOf: [...UNDIVIDED_CLASSES] } },
      ],
    },
    { escorts: 2, front: 1, rear: 1 },
    MN_169_812,
  ),
  /**
   * THE PEACE-OFFICER TRIGGER IS POSITIONAL, NOT DIMENSIONAL. § 169.812 subd.
   * 2(d) attaches to a load crossing the centerline of an undivided roadway,
   * which is a function of the segment's lane width — the same shape as
   * Wisconsin's Trans 254.15(3)(a), except that Minnesota escalates it to a
   * sworn officer plus two civilians. Nothing on a quote settles it, so it is
   * an advisory: the price stands and the exclusion is stated.
   */
  escortRule(
    'mn-centerline-peace-officer',
    'Load crossing the centerline on an undivided roadway — a lead peace officer plus front and rear escorts',
    { kind: 'gt', measure: 'widthIn', value: 102 },
    {
      advisory:
        'Minn. Stat. § 169.812 subd. 2(d): "One lead escort vehicle, one rear escort vehicle, and one lead licensed peace officer is required when any part of an overdimensional load or a vehicle transporting an overdimensional load extends beyond the left of the centerline on an undivided roadway." Whether this load crosses the centerline depends on the lane width of each segment, which this quote does not hold — in practice a load wider than about 15 ft on a 12 ft lane will. NO PEACE-OFFICER COST IS INCLUDED: § 169.812, § 299D.085 and Minn. R. 7455 state no rate, and MnDOT devolves scheduling and terms to three tiers of agency ("Statewide: State Patrol - Minnesota / County: Sheriff Departments - Minnesota / Local: contact the city police department direct ... individual agency requirements may vary"). Note also that Minnesota requires the officer to hold the same § 299D.085 escort certificate as a civilian, so not every trooper qualifies.',
    },
    MN_169_812,
  ),
  /**
   * THE HIGHEST-VALUE CONFLICT IN THE MINNESOTA SET, because it decides whether
   * a move can be STAFFED rather than what it costs. Three official documents,
   * two answers, and MnDOT publishes both readings itself. It is an ADVISORY
   * and not a `manualReview` for the reason the outcome types draw the line:
   * the requirement is real, the price does not move, and what is unresolved is
   * a fact about the escort company rather than about the load.
   */
  escortRule(
    'mn-pilot-car-reciprocity-conflict',
    'Pilot-car certification reciprocity — a closed list of seven states against an open SC&RA/FHWA standard',
    {
      kind: 'any',
      of: [
        { kind: 'ruleApplies', ruleId: 'mn-width-multilane-divided' },
        { kind: 'ruleApplies', ruleId: 'mn-width-undivided' },
        { kind: 'ruleApplies', ruleId: 'mn-length-over-110-multilane-divided' },
        { kind: 'ruleApplies', ruleId: 'mn-length-over-110-undivided' },
      ],
    },
    {
      advisory:
        'Minnesota escort drivers must be certified, and its own sources give two different answers about whose certificate counts. Minn. R. 7455.0300 subp. 3 — the Department of Public Safety rule, which is the law — states an OPEN standard: an out-of-state driver may work "with another state\'s certification credential, provided the course meets the minimum requirements outlined in the Pilot/Escort Training Manual - Best Practices Guidelines as endorsed by the Specialized Carriers and Rigging Association, Federal Highway Administration", and "The department SHALL enter into a reciprocal agreement with any other state" that demonstrates it. MnDOT\'s escorts page and its 2022 General Provisions state a CLOSED list instead: "Colorado, Florida, North Carolina, Oklahoma, Utah, Virginia and Washington certification holders are allowed to escort overdimensional loads in Minnesota." MnDOT\'s own 2022 Trucking Regulations then restate the open standard. Neither reading is adopted. This is commercially material and not merely academic: a driver certified in an unlisted state is qualified under the rule and unlisted by the agency, and a Wisconsin-based escort has no home-state credential at all because Wisconsin issues none. Confirm the escort\'s certification with the MnDOT permit office before booking.',
    },
    MNDOT_ESCORTS,
    RETRIEVED,
  ),
  /**
   * THE DAMAGE-ASSESSMENT INDEX DISAGREEMENT. The statute keys the cost factors
   * to the pounds EXCEEDING the § 169.823-169.829 limits; MnDOT's calculator
   * keys the identical rates to the TOTAL axle group weight on fixed bases of
   * 34,000 / 42,000 / 50,000 lb. Inside the chart's own spacing brackets the
   * two agree exactly. They part company wherever the statutory limit is not
   * one of those three numbers — a group spaced outside the bracket, an unpaved
   * road, or the § 169.826 ten-per-cent winter increase.
   *
   * ONLY ONE OF THE TWO CAN BE ENCODED AS A COMPETING CHART, because a caller
   * supplies a group's WEIGHT and the statute's index is an EXCESS over a limit
   * that itself moves with spacing, paving and season. So the chart held below
   * is MnDOT's — the index the input shape actually matches — and the
   * divergence is surfaced here on exactly the loads it can reach. A group
   * spaced outside the chart's brackets matches no row at all and
   * `perMilePerAxleGroupAmount` already refuses to price the move rather than
   * summing the groups it does cover.
   */
  escortRule(
    'mn-damage-assessment-index-conflict',
    'Damage assessment fee — the statute indexes on excess weight and MnDOT’s calculator on total group weight',
    { kind: 'gt', measure: 'grossWeightLbs', value: 80_000 },
    {
      advisory:
        'Minnesota states its overweight cost factors twice under two different indices. Minn. Stat. § 169.86 subd. 5(e) charges them against the "Weight (pounds) exceeding weight limitations on axles" — the EXCESS over the §§ 169.823-169.829 limits. MnDOT\'s damage-assessment calculator prints the identical rates against "Total axle group weight (in pounds)", starting "0 - 34,000 $0.00 / 34,001 - 36,000 $0.12", which assumes fixed legal bases of 34,000 lb for a tandem, 42,000 lb for a tridem and 50,000 lb for a quad. Those bases are not fixed: § 169.824 subd. 1 makes the two-axle group limit a function of spacing (34,000 lb at 4-8 ft, 35,000 at 9 ft, 36,000 at 10-11 ft), § 169.823 subd. 1 drops the single-axle limit to 18,000 lb on an unpaved road, and § 169.826 raises every limit ten per cent during the winter increase. MnDOT\'s worked example of the divergence: a two-axle group at 11 ft spacing weighing 38,000 lb is 2,000 lb over the statutory 36,000 and prices at $0.12 per mile under the statute, while MnDOT\'s table reads 38,000 lb as the "36,001 - 38,000" row at $0.14 per mile. The chart used here is MnDOT\'s, because a quote states a group\'s weight and not its statutory excess; neither reading has been adopted, and a group spaced outside the chart\'s own brackets is reported unpriced rather than priced on the wrong base.',
    },
    MNDOT_DAMAGE_FEES,
    RETRIEVED,
  ),
  /**
   * A HEIGHT POLE THAT IS DOUBLY CONDITIONED. Minn. R. 7455.1000 item (10)
   * requires the pole "IF REQUIRED AS A CONDITION of the overdimensional load
   * permit", and § 169.812 sets no height escort trigger at all — so there may
   * be no front pilot car to carry it unless MnDOT adds one under subd. 2(e).
   * `heightPole: true` would assert a requirement the rule makes conditional,
   * so this states it instead.
   */
  escortRule(
    'mn-height-pole-over-15ft6',
    'Over 15 ft 6 in high — a height pole, but only where the permit imposes one',
    { kind: 'gt', measure: 'heightIn', value: ftIn(15, 6) },
    {
      advisory:
        'Minn. R. 7455.1000 item (10) requires "a height pole, IF REQUIRED AS A CONDITION of the overdimensional load permit, which must be nonconductive, nondestructive, flexible, and readily breakable and installed and in use by the front pilot car at all times when an overdimensional load exceeds 15 feet six inches in height". Minnesota publishes NO height-based escort trigger — § 169.812 has a width subdivision and a length subdivision and nothing else — so there may be no front pilot car to carry the pole unless MnDOT adds one under subd. 2(e). No height-pole cost is included. Separately, MnDOT states that "Minnesota does not recognize pole vehicles": a live height pole is not a substitute for the completed physical route survey.',
    },
    MN_RULE_7455,
    '2013-02-25',
  ),
  /**
   * MINNESOTA'S DISCRETIONARY ESCORT POWER IS NARROWER THAN MOST, AND THAT IS
   * QUOTABLE. Unlike Texas's open-ended discretion, § 169.812 subd. 2(e)
   * obliges the commissioner to write the number and the type ON THE PERMIT.
   */
  escortRule(
    'mn-additional-escorts-discretionary',
    'Additional escorts at the commissioner’s discretion — count and type stated on the permit',
    { kind: 'gt', measure: 'widthIn', value: 102 },
    {
      advisory:
        'Minn. Stat. § 169.812 subd. 2(e), repeated verbatim as subd. 3(c): "The commissioner may require additional escorts when deemed necessary to protect public safety or to ensure against undue damage to the road foundations, surfaces, or structures. The commissioner must specify in the permit (1) the number of additional escorts required; and (2) whether the operators of the escort vehicles must be licensed peace officers or may be escort drivers." No number triggers it, so none is priced — but unlike most states the count and the type will be written on the permit itself. Note also the no-multitasking rule: an escort driver "cannot act as the tillerperson to steer/navigate a rear steer trailer system", so a rear-steer trailer needs a dedicated tillerman IN ADDITION to the escorts.',
    },
    MN_169_812,
  ),
  /**
   * THE ROUTE SURVEY IS MANDATORY, ITS THRESHOLDS ARE IN
   * `routeInspection`, AND ITS WIDTH TRIGGER IS HIGHER THAN THE SUPERLOAD
   * WIDTH — an asymmetry that is easy to transpose and is stated here so it
   * cannot be.
   */
  escortRule(
    'mn-route-survey-obligations',
    'Physical route survey — mandatory above 16 ft high, 20 ft wide or 175 ft long',
    {
      kind: 'any',
      of: [
        { kind: 'gt', measure: 'heightIn', value: ftIn(16) },
        { kind: 'gt', measure: 'widthIn', value: ftIn(20) },
        { kind: 'gt', measure: 'overallLengthIn', value: ftIn(175) },
      ],
    },
    {
      advisory:
        'MnDOT requires a certified physical route survey "When any one dimension exceeds 16 feet high; or 20 feet wide; or 175 feet long", performed within 14 days of the permit start date by the driver of the permitted vehicle or by a Minnesota-certified pilot/escort driver, and valid for up to 60 days while the dimensions, the carrier and a 14-day movement cadence hold. NOTE THE ASYMMETRY: the survey WIDTH trigger is 20 ft while the SUPERLOAD width trigger is 16 ft, so a 17 ft wide load is a superload without automatically needing a survey, while a 17 ft HIGH load is both. The 2022 Trucking Regulations — still the newest edition MnDOT publishes at that path — leave the length trigger indeterminate ("and in some cases, excessive length") where the current page fixes it at 175 ft. No survey fee is published and none is included here.',
    },
    MNDOT_ROUTE_SURVEY,
    RETRIEVED,
  ),
];

// ── The oversize fee: $15 flat, plus $120 during the thaw above 14 ft 6 in ─

/**
 * THREE MUTUALLY EXCLUSIVE BANDS, TWO OF THEM SEASON-CONDITIONED.
 *
 * Minnesota charges NO dimensional oversize fee — § 169.86 subd. 5 has no
 * width, height or length term at all, and the whole state oversize charge for
 * an ordinary single trip is the $15 base. The one dimensional charge in the
 * subdivision is subd. 5(g)'s $120, and it applies only above 174 in of width
 * AND only while seasonal load restrictions are in force. So the "band" here
 * carries $0 for every ordinary oversize move and $120 for the one case the
 * statute names.
 *
 * The two rows above 174 in are the same source under opposite conditions, and
 * that is what makes them safe: the resolver filters on the restriction state,
 * keeps an undecidable row rather than dropping it, and refuses to pick when
 * both survive. A quote with no seasonal context therefore says it cannot price
 * the oversize component until it is told whether restrictions are in effect,
 * instead of quietly charging $0.
 */
const oversizeFeeBands: Sourced<OversizeFeeBand>[] = [
  fromDated<OversizeFeeBand>(
    {
      label: 'no seasonal width surcharge — width at or under 14 ft 6 in',
      upToWidthIn: { value: 174, inclusive: false },
      feeUsd: 0,
    },
    MN_169_86,
    '2012',
    'Minnesota charges no dimensional oversize fee: § 169.86 subd. 5 prices a single trip at "$15 for each single trip permit" with no width, height or length component anywhere in the subdivision. This $0 band records that positively, so a load under the § 169.86 subd. 5(g) width is priced rather than falling through the schedule.',
  ),
  {
    ...fromDated<OversizeFeeBand>(
      {
        label: 'seasonal width surcharge — over 14 ft 6 in while load restrictions are in effect',
        overWidthIn: { value: 174, inclusive: false },
        feeUsd: 120,
      },
      MN_169_86,
      '2012',
      '§ 169.86 subd. 5(g): "For vehicles which exceed the width limitations set forth in section 169.80 by more than 72 inches, an additional cost equal to $120 added to the amount in paragraph (a) when the permit is issued while seasonal load restrictions pursuant to section 169.87 are in effect." 102 in + 72 in = 174 in; EXCLUSIVE ("by more than 72 inches"). This is the one place in Minnesota law where the frost calendar changes a permit PRICE rather than its legality.',
    ),
    appliesWhen: { kind: 'seasonalRestrictionsInEffect' },
  },
  {
    ...fromDated<OversizeFeeBand>(
      {
        label: 'over 14 ft 6 in with no seasonal load restrictions in effect — no surcharge',
        overWidthIn: { value: 174, inclusive: false },
        feeUsd: 0,
      },
      MN_169_86,
      '2012',
      'The other half of § 169.86 subd. 5(g). The $120 attaches ONLY "when the permit is issued while seasonal load restrictions ... are in effect", so outside the restriction season an extra-wide single trip is still $15. Held as its own row so that a quote which cannot state the season keeps both readings and is told what would settle it, rather than being priced as summer by default.',
    ),
    appliesWhen: { kind: 'noneOf', of: [{ kind: 'seasonalRestrictionsInEffect' }] },
  },
];

// ── The overweight cost-factor chart ──────────────────────────────────────

/**
 * MnDOT's damage-assessment table, transcribed against TOTAL axle group weight.
 * Every row equals the statute's § 169.86 subd. 5(e) rate for the same excess
 * over the implied base — 34,000 lb for a tandem, 42,000 for a tridem, 50,000
 * for a quad — which is why the two documents corroborate inside the chart's
 * own spacing brackets. See `mn-damage-assessment-index-conflict` for where
 * they do not.
 *
 * A weight above the last row in a column is "N/A" on MnDOT's table and "Not
 * permitted" in the statute. No row is written for it: the group then matches
 * nothing, `perMilePerAxleGroupAmount` returns `null`, and the engine reports
 * the move unpriced instead of billing the top row.
 */
function factors(
  axleCount: number,
  maxSpacingFt: number,
  baseLbs: number,
  rates: number[],
): AxleGroupCostFactor[] {
  const label = `${axleCount} consecutive axles spaced within ${maxSpacingFt} feet or less`;
  const rows: AxleGroupCostFactor[] = [
    {
      label: `${label}, at or under ${baseLbs.toLocaleString()} lb`,
      axleCount,
      minSpacingFt: null,
      maxSpacingFt,
      minLbs: 0,
      maxLbs: baseLbs,
      costPerMileUsd: 0,
    },
  ];
  rates.forEach((rate, i) => {
    const lo = baseLbs + i * 2_000 + 1;
    const hi = baseLbs + (i + 1) * 2_000;
    rows.push({
      label: `${label}, ${lo.toLocaleString()}–${hi.toLocaleString()} lb`,
      axleCount,
      minSpacingFt: null,
      maxSpacingFt,
      minLbs: lo,
      maxLbs: hi,
      costPerMileUsd: rate,
    });
  });
  return rows;
}

const MINNESOTA_COST_FACTORS: PerMilePerAxleGroupRate = {
  name: 'MnDOT damage assessment fee calculator (Minn. Stat. § 169.86 subd. 5(e) overweight axle group cost factors)',
  factors: [
    ...factors(2, 8, 34_000, [0.12, 0.14, 0.18, 0.21, 0.26, 0.3]),
    ...factors(3, 9, 42_000, [0.05, 0.06, 0.07, 0.09, 0.1, 0.12, 0.14, 0.17, 0.19]),
    ...factors(
      4,
      14,
      50_000,
      [0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.11, 0.12, 0.15, 0.16, 0.2],
    ),
  ],
  /**
   * THE STATUTE SAYS WHERE THE ROUNDING GOES AND IT IS NOT ON THE TOTAL. "The
   * amounts added are rounded to the nearest cent for each axle or axle group."
   * Rounding after the sum and rounding before it differ by cents per mile,
   * which over a 400-mile lane is dollars.
   */
  roundFactorToCents: true,
  minimumUsd: null,
  maximumUsd: null,
  explanation:
    'Minn. Stat. § 169.86 subd. 5(e): "The additional cost is equal to the product of the distance traveled times the sum of the overweight axle group cost factors shown in the following chart." MnDOT\'s calculator states the same arithmetic and gives a worked example: "with a single axle steer group at 13,000, a tandem drive group at 38,000, and a tridem lowbed at 60,000, the damage rate would be $ 0.33 ($0 + $0.14 + $0.19) per mile traveled", and "For an overweight single trip permit, add the damage assessment fee to the base $15.00 permit fee." The statute never uses the phrase "damage assessment fee" and the calculator never uses "overweight axle group cost factor"; they are the same charge under two names. TWO SILENCES ARE RECORDED AND NOT FILLED: the statute states no rounding of PARTIAL MILES (Iowa, by contrast, says fees "will not be prorated for fractions of miles"), and its bands are whole pounds so a group 2,000.4 lb over the limit falls in a gap. A SINGLE axle has no column in the chart at all.',
};

// ── The jurisdiction ──────────────────────────────────────────────────────

export const MINNESOTA_OSOW_RULES: JurisdictionOsowRules = {
  code: 'MN',
  name: 'Minnesota',
  country: 'US',

  routeVocabulary: [
    fromDated<RouteVocabulary>(MINNESOTA_ROUTE_VOCABULARY, MN_169_812, ESCORT_FROM),
  ],

  legalLimits: {
    widthIn: [
      fromDated(
        102,
        MN_169_80,
        '2001',
        '§ 169.80 subd. 2(a): "The total outside width of a vehicle exclusive of rearview mirrors or load securement devices which are not an integral part of the vehicle and not exceeding three inches on each side, or the load may not exceed 102 inches". INCLUSIVE — 102.0 in is legal. The mirror and load-securement exclusion is capped at THREE INCHES PER SIDE, so up to 6 in of measured width can be exempt. § 169.80 subd. 2(c) also allows a low-bed trailer or equipment dolly carrying farm machinery or construction equipment 9 ft on non-interstate roads while requiring a permit for the same rig on the interstate — a route-conditioned exemption, recorded and not applied.',
      ),
      fromUndatedPage(
        102,
        MNDOT_DETERMINE,
        'MnDOT: "Width 8\' - 6\"". 8 ft 6 in = 102 in; corroborates.',
      ),
    ],
    heightIn: [
      fromDated(
        ftIn(13, 6),
        MN_169_81,
        '2001',
        '§ 169.81 subd. 1(a): "Except as provided in paragraph (b), no vehicle unladen or with load shall exceed a height of 13 feet six inches." EXCLUSIVE. Paragraph (b) allows a double-deck bus 14 ft 3 in under an annual permit; not applied.',
      ),
      fromUndatedPage(ftIn(13, 6), MNDOT_DETERMINE, 'MnDOT: "Height 13\' - 6\"".'),
    ],
    /**
     * 53 FT, WITH THE CONDITION THAT UNLOCKS IT HELD SEPARATELY.
     *
     * § 169.81 subd. 2(b) is one rule with a condition, not two figures: "no
     * semitrailer may exceed 48 feet ... However, statewide, a single
     * semitrailer may exceed 48 feet, but not 53 feet, if the distance from the
     * kingpin to the centerline of the rear axle group of the semitrailer does
     * not exceed 43 feet." 53 ft is the statewide maximum and the 43 ft KPRA in
     * `kingpinToRearAxleIn` is what buys the last five feet.
     *
     * THE LIMITATION IS STATED RATHER THAN HIDDEN: a 50 ft trailer whose KPRA
     * is not supplied is not flagged here, though the statute would flag it
     * unless the kingpin condition is met. Recording 48 ft instead would have
     * flagged every ordinary 53 ft trailer in the state, which is wrong in the
     * expensive direction on far more loads.
     */
    trailerLengthIn: [
      fromDated(
        ftIn(53),
        MN_169_81,
        '2001',
        '§ 169.81 subd. 2(b), quoted in full above. The 53 ft allowance is conditioned on a kingpin-to-rear-axle-group distance of 43 ft or less, which is held in `kingpinToRearAxleIn`; the unconditional figure is 48 ft. A trailer between 48 and 53 ft whose KPRA is not stated is NOT flagged by this row.',
      ),
    ],
    kingpinToRearAxleIn: [
      fromDated(
        ftIn(43),
        MN_169_81,
        '2001',
        '§ 169.81 subd. 2(b): "if the distance from the kingpin to the centerline of the rear axle group of the semitrailer does not exceed 43 feet". INCLUSIVE. This is the measurement that lets a Minnesota semitrailer run between 48 and 53 ft.',
      ),
    ],
    overallLengthIn: [
      fromDated(
        ftIn(75),
        MN_169_81,
        '2001',
        '§ 169.81 subd. 3(a): "Statewide, except on the highways identified under provisions in paragraph (c), no combination of vehicles may exceed a total length of 75 feet." EXCLUSIVE. Paragraph (c) lifts the cap on "divided highways having four or more lanes of travel, and on other highways as may be designated by the commissioner" — the twin-trailer network — and paragraph (b) lifts it entirely for poles, piling, pole-length pulpwood and public-utility emergency repair loads. Both are recorded and not applied: a quote does not state that it is running the designated LCV network or hauling utility poles.',
      ),
      fromUndatedPage(
        ftIn(75),
        MNDOT_DETERMINE,
        'MnDOT: "75\' - 0\" (Combination vehicles)". Also "45\' - 0\" (Single vehicles) / 48\' - 0\" (Mobile cranes)", which § 169.81 subd. 2(a) states as the single-vehicle cap.',
      ),
    ],
    /**
     * `frontOverhangIn` AND `rearOverhangIn` ARE BOTH ABSENT. §§ 169.80-169.81
     * publish no legal overhang limit; MnDOT's General Provisions publish a
     * MARKING threshold instead — "flags are required when overhang extends
     * more than 3 feet ahead of the front bumper or extends 4 feet beyond the
     * rear of the vehicle, or when exceeding 9 feet wide" — with an asymmetric
     * operator inside the same sentence, "more than 3 feet" (exclusive) against
     * "extends 4 feet" (unqualified, arguably inclusive at exactly 4 ft). A
     * flagging duty is not a legal limit, so neither figure is recorded as one,
     * and no Minnesota overhang escort trigger exists to be ported from a
     * neighbouring state.
     */
    grossWeightLbs: [
      fromDated(
        80_000,
        MN_169_824,
        '2001',
        '§ 169.824 subd. 2: "The gross vehicle weight of all axles of a vehicle or combination of vehicles must not exceed: (1) 80,000 pounds for any vehicle or combination of vehicles on all streets and highways, unless posted at a lower axle weight under section 169.87, subdivision 1". INCLUSIVE. Clause (2) allows 88,000 lb for six-or-more-axle livestock hauls on non-interstate trunk highways with a § 169.86 subd. 5(j) permit; § 169.824 subd. 3 adds cumulative allowances of 550 lb for idle- or emissions-reduction technology and 2,000 lb for a natural-gas vehicle. None is applied — a quote states neither the commodity nor the powertrain.',
      ),
      fromUndatedPage(80_000, MNDOT_DETERMINE, 'MnDOT: "Weight 80,000 lbs."'),
    ],
    /**
     * THE PAVED / UNPAVED SPLIT, AS TWO CONDITIONED ROWS RATHER THAN A
     * CONFLICT. Both numbers are correct and they are about different moves;
     * feeding them to a resolver that reads difference as disagreement would
     * send every Minnesota quote to review over a contradiction that does not
     * exist. A quote that has NOT said which road it runs on keeps both, and is
     * told that naming the road would settle it.
     */
    singleAxleLbs: [
      {
        ...fromDated(
          20_000,
          MN_169_823,
          '2001',
          '§ 169.823 subd. 1(2): "where the gross weight on any single axle exceeds 18,000 pounds on an unpaved street or highway or 20,000 pounds on a paved street or highway, unless posted to a lesser weight under section 169.87, subdivision 1". EXCLUSIVE. Subd. 1(1) additionally caps a wheel at 9,000 lb unpaved / 10,000 lb paved, and subd. 1(3) at 600 lb per inch of tire width on the foremost and rearmost steering axles and 500 lb per inch elsewhere — a limit that binds before the axle limit on narrow-tire heavy haul and that a quote cannot evaluate, because tire width is not collected. Subd. 2 reduces every limit by 40 per cent for a vehicle not on pneumatic tires. WHAT A PERMIT AUTHORISES IS A DIFFERENT AND SEASONAL NUMBER: MnDOT publishes allowable PERMIT axle weights in three columns — Spring Load Restriction / Middle-Range Restriction / Unrestricted — of 20,000 / 22,000 / 24,000 lb on a single axle, 34,000 / 36,000 / 46,000 on a tandem at 3\'-5" to 8\'-0", 42,000 / 51,000 / 63,000 on a tridem at 7\'-0" to 9\'-0", and 51,000 / 68,000 / 72,000 (annual trip log) or 80,000 (single trip) on a quad at 14\'-0" or less. Those are allowances, not limits, and are recorded here rather than encoded.',
        ),
        appliesWhen: { kind: 'routeClassIn', anyOf: [...PAVED_CLASSES] },
      },
      {
        ...fromDated(
          18_000,
          MN_169_823,
          '2001',
          'The unpaved half of the same sentence in § 169.823 subd. 1(2). Two thousand pounds per axle, decided by the surface of the road.',
        ),
        appliesWhen: { kind: 'routeClassIn', anyOf: [...UNPAVED_CLASSES] },
      },
    ],
    tandemAxleLbs: [
      fromDated(
        34_000,
        MN_169_824,
        '2001',
        '§ 169.824 subd. 1(a) sets a table of maximum gross weights on "any group of two or more consecutive axles ... for the distance between the centers of the first and last axles", and its value for two consecutive axles at 4 to 8 ft is 34,000 lb. The same subdivision publishes Minnesota\'s measurement rule — see `MINNESOTA_AXLE_SPACING_ROUNDING`. Subd. 1(b) sets a THREE-axle group spanning seven or eight feet at 34,000 lb as well, "except for vehicles manufactured before August 1, 1991" — a permanent grandfather clause a quote cannot evaluate. The parenthesised cells of the published table are governed by subd. 1(b)-(e), which was not fully captured, so the table itself is not encoded.',
      ),
    ],
  },

  permitBaseFeeUsd: [
    fromDated(
      15,
      MN_169_86,
      '2012',
      '§ 169.86 subd. 5(a): "$15 for each single trip permit." This is the ENTIRE state fee for an oversize-only single trip — there is no width, height or length component anywhere in the subdivision. Subd. 5(b) prices a job permit, for "like loads carried on a specific route for a period not to exceed two months", at $36; the same per-mile overweight charge applies on top of either.',
    ),
    fromUndatedPage(
      15,
      MNDOT_DETERMINE,
      'MnDOT permit types: "Single Trip Permit / Valid for 7 days and issued for individual trips of non-divisible loads. ... Fee: $15", and for the overweight product "Fee: $15 + Damage Assessment Fee".',
    ),
  ],

  oversizeFeeBands,

  overweightPricing: [
    fromDated<OverweightPricing>(
      {
        kind: 'perMilePerAxleGroup',
        explanation:
          '§ 169.86 subd. 5(e) charges "the product of the distance traveled times the sum of the overweight axle group cost factors shown in the following chart" — a function of the axle CONFIGURATION rather than of gross weight, so two loads of the same gross with different arrangements are different prices.',
      },
      MN_169_86,
      '2012',
    ),
    fromUndatedPage<OverweightPricing>(
      {
        kind: 'perMilePerAxleGroup',
        explanation:
          'MnDOT: "A damage assessment fee is calculated by adding the rate for each axle group and then multiplying the sum by the miles traveled."',
      },
      MNDOT_DAMAGE_FEES,
    ),
  ],

  /** Minnesota steps nothing by gross weight; the chart below carries it all. */
  overweightBands: [],
  overweightPerMile: [],

  overweightPerMilePerAxleGroup: [
    fromUndatedPage<PerMilePerAxleGroupRate>(
      MINNESOTA_COST_FACTORS,
      MNDOT_DAMAGE_FEES,
      'Indexed by TOTAL axle group weight, which is the index a quote\'s stated group weight matches. The identical rates appear in § 169.86 subd. 5(e) indexed by the EXCESS over the §§ 169.823-169.829 limits; see `mn-damage-assessment-index-conflict`.',
    ),
  ],

  /**
   * EMPTY, AND THE HOLE IS NAMED. § 169.86 subd. 5a levies an additional tax
   * for excessive gross weight computed from the vehicle's REGISTERED weight
   * and the § 168.013 subd. 1e rate schedule, prorated by permit days. Neither
   * input is held, and `ConditionalFee` triggers on gross weight alone, so
   * there is no honest way to express it. MnDOT itself pushes carriers to
   * settle it outside the permit: "The MnDOT permit does not adjust the vehicle
   * license registration. A permitted, over-legal weight vehicle must be
   * properly licensed through the Office of Prorate for its total gross
   * operating weight."
   */
  conditionalFees: [],

  transactionFee: [
    fromDated<TransactionFee>(
      { perPermitUsd: 0, percentOfTotal: 0 },
      MN_TRUCK_BOOK_2022,
      '2022',
      'No convenience fee, no percentage and no per-transaction charge is stated in any Minnesota source opened. The 2022 Trucking Regulations say only "Payment must be made before a permit will be issued. Payment can be made using Visa, MC, American Express, and Discover." UNKNOWN, recorded and not filled in: the online permit system itself was not exercised.',
    ),
  ],

  /**
   * BOTH EMPTY, AND FOR A REASON MINNESOTA STATES BY OMISSION. The May 2025
   * superload guide describes an extensive process — manual bridge review,
   * possible third-party consultant, five business days to months of
   * coordination, possible roadway improvements requiring environmental review
   * — and publishes NO fee for any of it. A Minnesota superload appears to pay
   * the ordinary $15 plus the damage assessment, with the consultant engaged
   * and paid by the carrier: "it is the carrier's responsibility to secure the
   * consultant and cover all associated costs." That is an asymmetry against
   * Texas's $500 review fee, and it is recorded as one rather than assumed to
   * hide a charge.
   */
  routeAnalysisFeeUsd: [],
  noBridgeRouteFeeUsd: [],

  superload: {
    grossWeight: [
      fromDated<Threshold>(
        { value: 250_000, inclusive: false },
        MNDOT_SUPERLOAD,
        '2025-05-01',
        'MnDOT: "Minnesota defines a superload as a vehicle or load that exceeds any one of the following: Height: 16 feet Width: 16 feet Length: 150 feet Weight: 250,000 GVW". All four are EXCLUSIVE ("exceeds any one of"). This is agency policy, not statute — the word "superload" appears nowhere in §§ 169.80-169.88 or in Minn. R. 7455 — and unlike Texas there is no short-axle-spacing side trigger.',
      ),
    ],
    widthIn: [
      fromDated<Threshold>({ value: ftIn(16), inclusive: false }, MNDOT_SUPERLOAD, '2025-05-01'),
    ],
    heightIn: [
      fromDated<Threshold>({ value: ftIn(16), inclusive: false }, MNDOT_SUPERLOAD, '2025-05-01'),
    ],
    overallLengthIn: [
      fromDated<Threshold>({ value: ftIn(150), inclusive: false }, MNDOT_SUPERLOAD, '2025-05-01'),
    ],
    /** No short-axle-spacing superload trigger is published in Minnesota. */
    shortSpacing: [],
  },

  routeInspection: {
    widthIn: [
      fromUndatedPage<Threshold>(
        { value: ftIn(20), inclusive: false },
        MNDOT_ROUTE_SURVEY,
        'MnDOT: "When any one dimension exceeds 16 feet high; or 20 feet wide; or 175 feet long". EXCLUSIVE. Corroborated by the 2022 Trucking Regulations for width and height.',
      ),
    ],
    heightIn: [
      fromUndatedPage<Threshold>({ value: ftIn(16), inclusive: false }, MNDOT_ROUTE_SURVEY),
      fromDated<Threshold>(
        { value: ftIn(16), inclusive: false },
        MN_TRUCK_BOOK_2022,
        '2022',
        '"Route Survey: Mandatory for loaded or unloaded vehicles that exceed 16\'0" high or 20\'0" wide (and in some cases, excessive length)". The 2022 book leaves LENGTH indeterminate where the current page fixes it at 175 ft — a determinacy divergence rather than a value one, so only the current page carries a length row.',
      ),
    ],
    lengthIn: [
      fromUndatedPage<Threshold>({ value: ftIn(175), inclusive: false }, MNDOT_ROUTE_SURVEY),
    ],
  },

  escortRules: MINNESOTA_ESCORT_RULES,

  publishedAbsences: [
    fromDated<PublishedAbsence>(
      {
        subject: 'weightEscortTrigger',
        statement:
          '§ 169.812 consists of subd. 1 (definitions), subd. 2 ("Escort vehicles required; width") and subd. 3 ("Escort vehicles required; length"). The word "weight" appears in the section only inside the definition of "overdimensional load" and inside the discretionary clause of subd. 2(e)/3(c). § 299D.085, Minn. R. 7455 in full, the MnDOT escorts page, both versions of the General Provisions, the May 2025 superload guide and the 2022 Trucking Regulations were all opened and searched.',
        consequence:
          'No Minnesota escort attaches to gross weight at any figure. What weight triggers is the per-mile damage assessment and, above 250,000 lb GVW, the superload process.',
      },
      MN_169_812,
      ESCORT_FROM,
    ),
    fromDated<PublishedAbsence>(
      {
        subject: 'heightEscortTrigger',
        statement:
          '§ 169.812 has no height subdivision at all. Height instead drives three other things: the Minn. R. 7455.1000 height-pole rule at 15 ft 6 in, MnDOT\'s route-survey trigger at 16 ft, and MnDOT\'s superload threshold at 16 ft.',
        consequence:
          'A height escort can arise in Minnesota only through the commissioner\'s discretion under § 169.812 subd. 2(e), and the permit will then state the count and the type. None is priced here.',
      },
      MN_169_812,
      ESCORT_FROM,
    ),
    fromDated<PublishedAbsence>(
      {
        subject: 'policeEscortRate',
        statement:
          'No peace-officer escort rate is published in § 169.812, in § 299D.085, in Minn. R. 7455, on the MnDOT escorts page or in the May 2025 superload guide. The one Minnesota rule that does set a price — Minn. R. 7455.0300 subp. 1(A), "$180" for the initial certification course and "$90" for one additional four-year certification — prices the CIVILIAN course, not officer time. MnDOT devolves the escort itself to three tiers of agency and says "individual agency requirements may vary".',
        consequence:
          'A Minnesota peace-officer escort cost is not quotable in advance and is surfaced as an excluded cost. Contrast Iowa, which caps it in statute at $250 per day per person and car.',
      },
      MNDOT_SUPERLOAD,
      '2025-05-01',
    ),
    fromDated<PublishedAbsence>(
      {
        subject: 'superloadFee',
        statement:
          'The May 2025 superload guide sets out the whole superload process and states no fee for any part of it. Where the Bridge Office needs a third-party consultant, "it is the carrier\'s responsibility to secure the consultant and cover all associated costs", and roadway or turning-radius improvements "may require a special review from Environmental Stewardship".',
        consequence:
          'A Minnesota superload appears to pay the ordinary $15 single-trip fee plus the damage assessment, with unquantified third-party costs on top. No superload fee is quoted and none is invented.',
      },
      MNDOT_SUPERLOAD,
      '2025-05-01',
    ),
  ],

  /**
   * TRUE, AND IT IS THE WHOLE FEE. The base is $15 flat, and everything above
   * it is the distance times the sum of the axle-group cost factors. Without
   * in-state miles the engine refuses to price the overweight component rather
   * than billing the lane's whole mileage to Minnesota.
   */
  feesDependOnDistance: true,
};
