/**
 * NEW JERSEY — oversize/overweight single-trip permit rules.
 *
 * A formula state. Nothing here is banded by the agency: New Jersey charges a
 * $10 base for an oversize permit, another $10 base for an overweight one,
 * $1.00 per foot of width over 14 ft, $1.00 per foot of length over 63 ft, and
 * $5.00 per 2,000 lb of excess weight — then adds $12 and takes 5%.
 *
 * THE ORDER OF OPERATIONS IS THE PART THAT IS EASY TO GET WRONG, AND NJDOT'S
 * OWN WORKED EXAMPLES SETTLE IT. The 5% service charge applies to a total that
 * ALREADY INCLUDES the $12 transaction fee:
 *
 *     (base + excess dimension + excess weight + $12) × 1.05
 *
 * The fee schedule prints "a transaction fee of $12 plus a service charge of 5%
 * for a total permit fee of $12.60/permit" for a permit with no base fee at
 * all, and "$100 base fee + $12 Transaction Fee + 5% Service charge =
 * $117.60/permit" for the annual ocean-borne container permit. $12 × 1.05 =
 * $12.60 and $112 × 1.05 = $117.60; the other reading — 5% of the fees and then
 * $12 flat — gives $12.00 and $117.00 and matches neither. `TransactionFee`
 * was modelled as flat-plus-percent with the flat amount inside the percentage
 * base for exactly this shape, so New Jersey needs `{ perPermitUsd: 12,
 * percentOfTotal: 5 }` and nothing else.
 *
 * HOW THE TWO $10 BASES ARE CARRIED. New Jersey charges $10 for "either an
 * oversize or overweight vehicle single-trip permit" and $20 "for an oversize
 * AND overweight" one. That $20 is two $10 bases, not a third fee, so each $10
 * is folded into the component it belongs to: the oversize bands below all
 * start at $10, and the overweight bands all start at $10. A load that is only
 * oversize reaches $10, a load that is only overweight reaches $10, and a load
 * that is both reaches $20 — which is what the regulation prints. `permitBase
 * FeeUsd` is therefore a sourced ZERO, and the engine suppresses the empty line.
 * This decomposition is OUR modelling choice; N.J.A.C. 13:18-1.6 states the two
 * amounts and does not say that one is twice the other.
 *
 * TWO CONFLICTS, AND BOTH OF THEM ARE ABOUT WHAT THE FEE IS MEASURED ON.
 *
 *   1. LENGTH. N.J.A.C. 13:18-1.6(b) charges $1.00 per foot when "any
 *      combination of vehicles ... exceed 63 feet in length" — the COMBINATION.
 *      NJDOT's Fee Schedule and the January 2024 Guidebook both say "> 63' in
 *      trailer/load length" — the TRAILER. For an ordinary tractor and 53 ft
 *      trailer those readings differ by about seven dollars and, more
 *      importantly, by whether the fee applies at all. The band evaluator has
 *      no trailer-length input, so neither reading can be priced without
 *      choosing one, and choosing is what this engine refuses to do. The length
 *      excess is left out of the bands and the load goes to review with both
 *      readings stated.
 *
 *   2. WEIGHT. The same section charges $5.00 per 2,000 lb over "either the
 *      axle or gross weight limits--whichever is greater". The Fee Schedule
 *      lists $5.00 per ton over 80,000 lb gross AND $5.00 per ton over the
 *      legal axle weights, and adds a "5% leeway ... on axle weights" that
 *      appears in no regulation. The bands below compute the GROSS excess,
 *      which is the only one a quote's inputs support; any load whose axle
 *      excess is larger is under-quoted, and every overweight New Jersey move
 *      is sent to review saying so.
 *
 * WHERE THOSE CONFLICTS LIVE. Both are conditioned on the load and neither is
 * an escort count. `EscortRule` is the only dimension-conditioned predicate in
 * the data model and `EscortOutcome.manualReview` is the outcome built for a
 * real rule that cannot become a number, so they are carried there and each
 * says so in its own description.
 *
 * DATE WARNING: the courtesy copy of the rules hosted on nj.gov carries the
 * header "Expires on March 9, 2018". Its text is identical to the permit
 * portal's copy and to Cornell LII's reproduction, and the January 2024
 * Guidebook still cites the same fee provisions, so the stamp is recorded as a
 * document-currency warning and not as a substantive conflict. The regulation
 * itself was last amended effective 2010-08-02 — sixteen years ago — and that
 * date, not today's, is what the rows below carry.
 */
import type { SourceDoc, Sourced } from '../provenance.js';
import { ftIn, type EscortRule } from '../escortRules.js';
import type {
  CombinedFeeRule,
  JurisdictionOsowRules,
  OversizeFeeBand,
  OverweightPricing,
  Threshold,
  TransactionFee,
  WeightBand,
} from '../types.js';

const RETRIEVED = '2026-09-02';

// ── Source documents ──────────────────────────────────────────────────────

const RULE_NJGOV: SourceDoc = {
  id: 'nj-njac-13-18-njgov-courtesy-copy',
  title: 'N.J.A.C. 13:18-1 — NJDOT-hosted courtesy copy (PDF, header states "Expires on March 9, 2018")',
  url: 'https://www.nj.gov/transportation/about/rules/documents/13-18-Current.pdf',
  publisher: 'New Jersey Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: '§1.6(a)2 the $20 oversize-and-overweight base; §1.6(c) the $5.00 per 2,000 lb formula; §1.12(b),(c),(g),(h),(i) escorts',
};

const RULE_PORTAL: SourceDoc = {
  id: 'nj-njac-13-18-portal-copy',
  title: 'N.J.A.C. 13:18-1 — NJDOT permit-portal copy (PDF, undated)',
  url: 'https://nj.gotpermits.com/njpass/Content/state/NJ/PublicMaterials/current-rule.pdf',
  publisher: 'New Jersey Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: '§1.6(a)1 the $10 base; §1.6(d) the $12 transaction fee and 5% service charge; §1.12(a),(d),(e),(f) escorts',
};

const RULE_LII: SourceDoc = {
  id: 'nj-njac-13-18-lii',
  title: 'N.J.A.C. 13:18-1.6 and 13:18-1.12 (via Cornell LII — SECONDARY source, with amendment history)',
  url: 'https://www.law.cornell.edu/regulations/new-jersey/N-J-A-C-13-18-1-6',
  publisher: 'Cornell Legal Information Institute, reproducing the New Jersey Administrative Code',
  revisedOn: '2010-08-02',
  retrievedOn: RETRIEVED,
  cite: '"R.2010 d.169, effective 8/2/2010"; §1.6(b) "exceed 63 feet in length"; §1.6(c) "exceeds either the axle or gross weight limits--whichever is greater"',
};
const EFF_RULE = '2010-08-02';

const STATUTE_39_3_84: SourceDoc = {
  id: 'nj-njsa-39-3-84',
  title: 'N.J.S.A. 39:3-84 — NJDOT-hosted statute copy (PDF, undated)',
  url: 'https://nj.gotpermits.com/njpass/Content/state/NJ/PublicMaterials/39-3-84.pdf',
  publisher: 'New Jersey Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'a(1) width; a(2) height; a(3) length; b(1) single axle; b(2) tandem; b(4) gross weight',
};

const FEE_SCHEDULE: SourceDoc = {
  id: 'nj-fee-schedule',
  title: 'NJDOT — Permit Fee Schedule (PDF, undated)',
  url: 'https://nj.gotpermits.com/njpass/Content/state/NJ/PublicMaterials/Fee-Schedule.pdf',
  publisher: 'New Jersey Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: '"$10 Base Fee + any excess weight fees + $12 Transaction Fee + 5% Service charge"; "$1.00 per foot (or fraction thereof) in excess of 14 feet in width"; "NOTE: 5% leeway is given on axle weights."',
};

const GUIDEBOOK: SourceDoc = {
  id: 'nj-cv-size-weight-guidebook-2024-01',
  title: 'NJDOT — Commercial Vehicle Size and Weight Guidebook, January 2024 (PDF)',
  url: 'https://nj.gotpermits.com/njpass/Content/state/NJ/PublicMaterials/Final%20CVG%202024-01-05.pdf',
  publisher: 'New Jersey Department of Transportation',
  revisedOn: '2024-01-05',
  retrievedOn: RETRIEVED,
  cite: 'Table 4 fee structures; Table 6 escorts; §2.1 size limits; §5.3.3 the over-14 ft utility notification; §5.5 escorts and certification',
};
const EFF_GUIDEBOOK = '2024-01-05';

const PORTAL_HOME: SourceDoc = {
  id: 'nj-superload-portal-home',
  title: 'NJDOT — SUPERLOAD online permitting system, portal home (undated bulletin)',
  url: 'https://nj.gotpermits.com/njpass',
  publisher: 'New Jersey Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: '"Route survey is required when the overall width exceeds 16\' or height exceeds 14\' 6\'\'."; Port Newark PAPD escort bulletin',
};

const FAQ: SourceDoc = {
  id: 'nj-gotpermits-faq',
  title: 'NJDOT at GotPermits — FAQ (PDF, undated)',
  url: 'https://nj.gotpermits.com/njpass/Permits/DownloadStateAttachment?index=3&name=FAQ',
  publisher: 'New Jersey Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: '"There are limits to which permits can be system issued."; bridge-engineer review status',
};

// ── Helpers ───────────────────────────────────────────────────────────────

function fromUndatedPage<T>(value: T, source: SourceDoc, note?: string): Sourced<T> {
  return {
    value,
    source,
    effectiveFrom: RETRIEVED,
    effectiveTo: null,
    ...(note === undefined ? {} : { note }),
  };
}

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
  source: SourceDoc = RULE_PORTAL,
  effectiveFrom: string = EFF_RULE,
): EscortRule {
  return {
    id,
    jurisdiction: 'NJ',
    description,
    when,
    then,
    source,
    effectiveFrom,
    effectiveTo: null,
  };
}

// ── Fee schedule ──────────────────────────────────────────────────────────

/** Highest width the per-foot schedule is enumerated to. See `widthBands`. */
const MAX_ENUMERATED_WIDTH_FT = 30;
/** Highest gross weight the per-2,000-lb schedule is enumerated to. */
const MAX_ENUMERATED_WEIGHT_LBS = 300000;

/**
 * $10 plus $1.00 for every foot, or part of a foot, of width over 14 ft —
 * enumerated as one-foot bands because `OversizeFeeBand` prices a band and New
 * Jersey prices a formula.
 *
 * "Or fraction thereof" is what fixes the band edges. A load 15 ft 0 in wide is
 * exactly one foot over and owes $1; a load 15 ft 1 in wide is a foot and an
 * inch over and owes $2. So each band's upper edge is INCLUSIVE of the whole
 * foot and its lower edge is exclusive — `overWidthIn` at 15 ft and
 * `upToWidthIn` at 16 ft is the band that costs $2.
 *
 * The schedule is open-ended in the regulation and finite here. It runs to
 * 30 ft, which is far past the 16 ft at which New Jersey starts demanding a
 * route survey and past anything the state's escort table contemplates. A wider
 * load matches no band and is reported as unpriced rather than being folded
 * into the top step — which is the correct outcome, because at that width the
 * permit is going through a bridge engineer anyway.
 *
 * There is no HEIGHT step at all: no height-based fee appears in §1.6, in the
 * Fee Schedule, or in the Guidebook. That absence is inferred from the complete
 * fee text — no source states "there is no height fee" — and it is recorded as
 * an inference, not as a rule.
 */
function widthBands(source: SourceDoc, effectiveFrom: string): Sourced<OversizeFeeBand>[] {
  const note =
    'Oversize side of the New Jersey fee: "$10 permit fee + $1 for every 1\' (or fraction thereof) > 14\' in width". The $10 oversize base is folded into every band so that a load which is both oversize and overweight reaches the $20 the regulation prints for the combined permit. The excess-LENGTH component of the same formula is deliberately NOT in these bands — see the `nj-length-fee-basis-conflict` rule.';
  const bands: Sourced<OversizeFeeBand>[] = [
    fromDated<OversizeFeeBand>(
      {
        label: 'not over 14 ft wide — $10 oversize base, no width excess',
        upToWidthIn: { value: ftIn(14), inclusive: false },
        feeUsd: 10,
      },
      source,
      effectiveFrom,
      note,
    ),
  ];
  for (let ft = 15; ft <= MAX_ENUMERATED_WIDTH_FT; ft += 1) {
    const excessFt = ft - 14;
    bands.push(
      fromDated<OversizeFeeBand>(
        {
          label: `over ${ft - 1} ft up to ${ft} ft wide — $10 base plus $${excessFt} width excess`,
          overWidthIn: { value: ftIn(ft - 1), inclusive: false },
          upToWidthIn: { value: ftIn(ft), inclusive: false },
          feeUsd: 10 + excessFt,
        },
        source,
        effectiveFrom,
        note,
      ),
    );
  }
  return bands;
}

/**
 * $10 plus $5.00 for every 2,000 lb, or part of 2,000 lb, over the legal gross —
 * the same formula-as-bands treatment, at 2,000 lb steps.
 *
 * "Or fractional portion thereof" again decides the edges: 82,000 lb is exactly
 * one increment over and owes $5, and 82,001 lb is into the second increment
 * and owes $10. So band k runs from 80,000 + 2,000(k−1) + 1 through
 * 80,000 + 2,000k and costs $10 + $5k.
 *
 * Enumerated to 300,000 lb. New Jersey publishes NO superload classification —
 * "SUPERLOAD" is the name of its permitting system, not a category of load — so
 * there is no threshold at which the formula stops and no published ceiling to
 * enumerate to. A heavier load matches no band and is reported as unpriced.
 */
function weightBands(source: SourceDoc, effectiveFrom: string): Sourced<WeightBand>[] {
  const note =
    'Overweight side of the New Jersey fee: "$10 Base Fee + any excess weight fees", where the excess fee is "$5.00 for each 2,000 pounds or fractional portion thereof". The $10 overweight base is folded into every band, so an oversize-and-overweight permit reaches the $20 the regulation prints. These bands measure the excess against the 80,000 lb GROSS limit only — see the `nj-overweight-fee-basis-conflict` rule for the axle-weight reading that this cannot compute.';
  const bands: Sourced<WeightBand>[] = [];
  for (let lbs = 82000; lbs <= MAX_ENUMERATED_WEIGHT_LBS; lbs += 2000) {
    const increments = (lbs - 80000) / 2000;
    bands.push(
      fromDated<WeightBand>(
        { minLbs: lbs - 1999, maxLbs: lbs, feeUsd: 10 + 5 * increments },
        source,
        effectiveFrom,
        note,
      ),
    );
  }
  return bands;
}

const oversizeFeeBands: Sourced<OversizeFeeBand>[] = [
  ...widthBands(GUIDEBOOK, EFF_GUIDEBOOK),
  ...widthBands(FEE_SCHEDULE, RETRIEVED),
];

const overweightBands: Sourced<WeightBand>[] = [
  ...weightBands(FEE_SCHEDULE, RETRIEVED),
  ...weightBands(RULE_LII, EFF_RULE),
];

// ── Escort rules (N.J.A.C. 13:18-1.12 and Guidebook Table 6) ──────────────

export const NEW_JERSEY_ESCORT_RULES: EscortRule[] = [
  /**
   * A bare count. New Jersey positions the single escort at the REAR on a
   * highway with four or more traffic lanes and at the FRONT on a highway with
   * fewer than four — and it is one vehicle either way, so the price does not
   * turn on the lane count and the quote does not need it. Note the regulation
   * uses LANE COUNT, not "divided" or "controlled access"; a two-lane divided
   * road is in the fewer-than-four category.
   */
  escortRule(
    'nj-width-over-14',
    'Over 14 ft wide — one escort (rear on a highway with four or more lanes, front on a highway with fewer)',
    { kind: 'gt', measure: 'widthIn', value: ftIn(14) },
    { escorts: 1 },
  ),
  escortRule(
    'nj-width-over-16',
    'Over 16 ft wide — two escorts, one front and one rear',
    { kind: 'gt', measure: 'widthIn', value: ftIn(16) },
    { escorts: 2, front: 1, rear: 1 },
    RULE_NJGOV,
    EFF_RULE,
  ),
  escortRule(
    'nj-length-over-100',
    'Over 100 ft long — one escort (rear on a highway with four or more lanes, front on a highway with fewer)',
    { kind: 'gt', measure: 'overallLengthIn', value: ftIn(100) },
    { escorts: 1 },
    GUIDEBOOK,
    EFF_GUIDEBOOK,
  ),
  escortRule(
    'nj-length-over-120',
    'Over 120 ft long — two escorts, one front and one rear',
    { kind: 'gt', measure: 'overallLengthIn', value: ftIn(120) },
    { escorts: 2, front: 1, rear: 1 },
    RULE_LII,
    EFF_RULE,
  ),

  /**
   * NO HEIGHT ESCORT, NO HEIGHT POLE, AND A DUTY INSTEAD. New Jersey is the
   * second state in this directory (with California) that does not turn height
   * into a pole car. §1.12(d) sends an over-14 ft load to N.J.S.A. 39:4-28,
   * which is a notification obligation, and the permit is VOID if the permittee
   * does not discharge it. Third-party permit sites claim a New Jersey height
   * pole over 14 ft or 15 ft; no official source says so and the claim is
   * disregarded here.
   */
  escortRule(
    'nj-height-over-14-utility-notification',
    'Over 14 ft high — no escort and no height pole, but a statutory duty to notify every public utility on the route',
    { kind: 'gt', measure: 'heightIn', value: ftIn(14) },
    {
      advisory:
        'New Jersey requires NO escort and NO height pole for an overheight load. What it requires instead is notification: "When a permitted vehicle and/or load is in excess of 14\' in height it is the responsibility of the permittee to notify all Public Utility Companies" on the route (N.J.S.A. 39:4-28; Guidebook §5.3.3), and the permit is void if that is not done. No height-pole cost is included in this quote because New Jersey does not require one — third-party claims of a 14 ft or 15 ft New Jersey pole requirement appear in no official source. A route survey IS required over 14 ft 6 in; that is priced separately as a route-inspection trigger.',
    },
    GUIDEBOOK,
    EFF_GUIDEBOOK,
  ),

  escortRule(
    'nj-night-waiver-additional-escort',
    'An oversize move travelling between sunset and sunrise under a waiver needs one additional escort',
    { kind: 'gt', measure: 'widthIn', value: 102 },
    {
      advisory:
        'N.J.A.C. 13:18-1.12(c) and (g) add ONE escort vehicle to an oversize move that has been granted a waiver to travel between sunset and sunrise — and the Guidebook adds that a load under 14 ft wide and 100 ft long, which would otherwise need none, still needs one escort at night under a waiver. The third escort travels in the adjacent lane on a highway of three or more lanes and otherwise follows. A quote does not collect the travel window, so no night escort is included; if this move runs after dark under a waiver, add one. New Jersey publishes no weight-based escort trigger at all — Table 6 has only width and length rows — and no overhang trigger, because overhang counts toward the overall length that is the trigger.',
    },
    GUIDEBOOK,
    EFF_GUIDEBOOK,
  ),

  escortRule(
    'nj-no-state-police-escort',
    'New Jersey assigns only private escorts, and publishes no state police escort trigger or rate',
    { kind: 'gt', measure: 'widthIn', value: ftIn(14) },
    {
      advisory:
        'NJDOT states that "Only private escorts are assigned to permitted loads" (Guidebook §5.5), and no state-level police-escort trigger or rate is published by NJDOT or the State Police. One local exception is on file: a Port Authority Police escort is required for movements through Port Newark, arranged directly with PAPD, and its cost is not a state fee and is not included here. New Jersey also has no pilot-car operator certification — the Guidebook says in terms that "there currently is no certification requirement or certification process in place" — so no certification cost arises. Escort spacing is regulated: 200 to 500 ft ahead for a front escort, 100 to 250 ft behind for a rear one.',
    },
    GUIDEBOOK,
    EFF_GUIDEBOOK,
  ),

  escortRule(
    'nj-system-issuance-limits-unpublished',
    'Above unpublished limits a New Jersey permit is not system-issued and goes to a state or bridge engineer',
    { kind: 'gt', measure: 'grossWeightLbs', value: 80000 },
    {
      advisory:
        'NJDOT\'s FAQ says "There are limits to which permits can be system issued." and that a permit beyond them goes to a state or bridge engineer for up to three business days. The limits themselves are NOT published, and neither is any engineering-review fee — none appears in the regulation, the fee schedule or the Guidebook. So a New Jersey permit can take three days longer than the fee schedule suggests, at no stated additional cost. New Jersey publishes no superload classification of any kind: "SUPERLOAD" is the name of the online permitting system, and every non-divisible load uses the same single-trip permit and the same fee formula. The 200,000 lb-style superload thresholds that appear on aggregator sites are not in any official New Jersey source.',
    },
    FAQ,
    RETRIEVED,
  ),

  /**
   * NOT AN ESCORT RULE — CONFLICT #1, the excess-LENGTH fee basis. See the
   * module header. Fires for any load long enough for the disagreement to cost
   * money on either reading, which for a tractor-semitrailer is most of them.
   */
  escortRule(
    'nj-length-fee-basis-conflict',
    'New Jersey’s own documents disagree about which length the $1.00-per-foot excess fee is measured on',
    { kind: 'gt', measure: 'overallLengthIn', value: ftIn(63) },
    {
      manualReview:
        'New Jersey charges $1.00 per foot, or fraction of a foot, of excess length, and its own sources disagree about what is measured. N.J.A.C. 13:18-1.6(b) applies it when "any combination of vehicles ... exceed 63 feet in length" — the whole COMBINATION, which this load does. NJDOT\'s Fee Schedule and the January 2024 Guidebook both apply it to "trailer/load length" over 63 ft, which for an ordinary tractor and 53 ft trailer is not exceeded at all. The two readings differ by the entire excess-length charge. Neither has been adopted: the oversize fee below carries the $10 base and the width excess only, and the length excess — up to about $1 per foot of combination over 63 ft on the regulation\'s reading — is NOT included. A separate $1.00 per foot over 70 ft of OVERALL length applies to a house-type trailer and its towing vehicle, which a quote does not identify.',
    },
    RULE_LII,
    EFF_RULE,
  ),

  /**
   * NOT AN ESCORT RULE — CONFLICT #2, the excess-WEIGHT fee basis.
   */
  escortRule(
    'nj-overweight-fee-basis-conflict',
    'New Jersey’s regulation and fee schedule disagree about whether the excess-weight fee is the greater of the axle and gross excess or both of them',
    { kind: 'gt', measure: 'grossWeightLbs', value: 80000 },
    {
      manualReview:
        'The overweight amount below is computed from the GROSS excess over 80,000 lb, at $5.00 per 2,000 lb or fraction, and New Jersey\'s sources do not agree that this is the whole charge. N.J.A.C. 13:18-1.6(c) charges the excess over "either the axle or gross weight limits--whichever is greater", so a load whose single-axle or tandem excess is larger than its gross excess owes MORE than this figure. NJDOT\'s Fee Schedule instead lists $5.00 per ton over 80,000 lb gross AND $5.00 per ton over the 22,400 lb single-axle and 34,000 lb tandem limits, which reads as cumulative, and adds "NOTE: 5% leeway is given on axle weights" — a leeway that appears in no regulation and whose basis is unknown. Per-axle weights are not collected here, so neither the greater-of reading nor the cumulative one can be evaluated, and the New Jersey permit fee must be confirmed with the permitting office. One case is settled and is not this one: a Code 23 registered trailer pays no base fee and no excess weight fee at all, only the $12 transaction fee and the 5%.',
    },
    RULE_LII,
    EFF_RULE,
  ),
];

// ── The jurisdiction ──────────────────────────────────────────────────────

export const NEW_JERSEY_OSOW_RULES: JurisdictionOsowRules = {
  code: 'NJ',
  name: 'New Jersey',
  country: 'US',

  legalLimits: {
    /**
     * 102 in on the National Network and New Jersey access routes; 96 in
     * everywhere else. That is TWO LIMITS FOR TWO NETWORKS, not two sources
     * disagreeing, so only the network these quotes are priced for is recorded
     * and the other is carried as a note. Filing both as candidates would
     * manufacture a conflict out of a route distinction and stop the state
     * pricing at all.
     */
    widthIn: [
      fromUndatedPage(
        102,
        STATUTE_39_3_84,
        'N.J.S.A. 39:3-84.a(1): "shall be no more than 102 inches" on the National Network and New Jersey access routes. The Guidebook §2.1.1 states 96 inches on routes that are neither, and the Commissioner may set 96 inches on designated roads — a quote cannot establish which roads a lane uses, so the National Network figure is used.',
      ),
    ],
    heightIn: [
      fromUndatedPage(ftIn(13, 6), STATUTE_39_3_84, 'N.J.S.A. 39:3-84.a(2): "shall not exceed 13 feet, 6 inches".'),
    ],
    trailerLengthIn: [
      fromDated(
        ftIn(53),
        GUIDEBOOK,
        EFF_GUIDEBOOK,
        '"53 feet on National Network and access routes 48 feet on other routes" (N.J.S.A. 39:3-84.a(4)). A 41 ft kingpin-to-rear-axle limit also applies and is not modelled, because a quote does not collect the kingpin distance; a non-divisible load may run to 63 ft of semitrailer.',
      ),
    ],
    /**
     * `overallLengthIn` is ABSENT because New Jersey says so in terms: "There
     * is no maximum overall length for a truck tractor-trailer/semitrailer
     * combination". The 62 ft figure in the Guidebook is for a truck-trailer or
     * truck-semitrailer combination, which is a different vehicle.
     *
     * Overhang limits are absent for the same positive reason: "there is no
     * maximum longitudinal load overhang limit". Overhang counts toward the
     * overall length, and overall length is what the escort rules test.
     */
    grossWeightLbs: [
      fromUndatedPage(80000, STATUTE_39_3_84, 'N.J.S.A. 39:3-84.b(4): "shall not exceed 80,000 pounds". The federal bridge formula table also applies on the Interstate system and is checked separately.'),
    ],
    /**
     * 22,400 lb, which is 2,400 lb above the federal single-axle figure and
     * above every other jurisdiction in this directory. It is stated outright
     * in N.J.S.A. 39:3-84.b(1); assuming 20,000 lb from a neighbouring state
     * would report a legal New Jersey axle as over weight.
     */
    singleAxleLbs: [
      fromUndatedPage(22400, STATUTE_39_3_84, 'N.J.S.A. 39:3-84.b(1): "shall not exceed 22,400 pounds".'),
    ],
    tandemAxleLbs: [
      fromUndatedPage(
        34000,
        STATUTE_39_3_84,
        'N.J.S.A. 39:3-84.b(2): "shall not exceed 34,000 pounds where the distance between consecutive axle centers is 40 inches or more" (and not more than 96 inches).',
      ),
    ],
  },

  /**
   * A SOURCED ZERO — see the module header. New Jersey's two $10 bases are
   * folded into the oversize and overweight components so that the combined
   * permit reaches the $20 the regulation prints. The row is kept on file so
   * the decomposition is auditable, and the engine suppresses the empty line.
   */
  permitBaseFeeUsd: [
    fromDated(
      0,
      GUIDEBOOK,
      EFF_GUIDEBOOK,
      'Guidebook Table 4 prints the oversize fee as "$10 permit fee + ..." and the overweight fee as "$10 Base Fee + ...", and N.J.A.C. 13:18-1.6(a) prints $10.00 for either permit and $20.00 for both. There is no third issuance charge, so the whole base is inside the two components.',
    ),
  ],

  oversizeFeeBands,

  /**
   * CUMULATIVE, and stated rather than defaulted, because it is what makes the
   * $20 combined base come out right: $10 inside the oversize band plus $10
   * inside the overweight band.
   */
  combinedFeeRule: [
    fromDated<CombinedFeeRule>(
      {
        kind: 'cumulative',
        explanation:
          'N.J.A.C. 13:18-1.6(a)2 charges $20.00 "For an oversize and overweight vehicle single-trip permit ... plus excess oversize and excess overweight fees", which is the $10 oversize permit and the $10 overweight permit charged together with both excess formulas.',
      },
      RULE_NJGOV,
      EFF_RULE,
    ),
  ],

  overweightPricing: [
    fromDated<OverweightPricing>(
      {
        kind: 'bands',
        explanation:
          'N.J.A.C. 13:18-1.6(c) charges "$5.00 for each 2,000 pounds or fractional portion thereof" of excess weight — a formula, not a per-mile rate, not a per-axle-count schedule and not an agency band table. It is enumerated here at 2,000 lb steps up to 300,000 lb; New Jersey publishes no superload classification and therefore no ceiling, so a heavier load is reported as unpriced rather than folded into the top step.',
      },
      RULE_LII,
      EFF_RULE,
    ),
    fromUndatedPage<OverweightPricing>(
      {
        kind: 'bands',
        explanation:
          'The Fee Schedule states the same structure as "$10 Base Fee + any excess weight fees + $12 Transaction Fee + 5% Service charge".',
      },
      FEE_SCHEDULE,
    ),
  ],

  overweightBands,
  overweightPerMile: [],
  conditionalFees: [],

  /**
   * $12.00 flat AND 5%, with the flat amount inside the percentage base. This
   * is the shape `applyTransactionFee` computes — (subtotal + 12) × 1.05 — and
   * it reproduces both figures NJDOT publishes: a bare transaction is $12.60,
   * and the $100 annual container permit is $117.60.
   *
   * RECORDED UNKNOWN: the Fee Schedule calls the 5% a "credit card service
   * charge" while the regulation calls it a "service charge" with no card
   * qualifier, and no source says whether a payment made from an escrow account
   * avoids it. The regulation's unqualified wording is what is applied.
   */
  transactionFee: [
    fromDated<TransactionFee>(
      { perPermitUsd: 12, percentOfTotal: 5 },
      RULE_PORTAL,
      EFF_RULE,
      'N.J.A.C. 13:18-1.6(d): "$12.00 plus a service charge of five percent of the total permit fee, for each permit transaction". One permit covering both oversize and overweight is ONE transaction. A government vehicle is charged the $12 and the 5% and nothing else.',
    ),
    fromUndatedPage<TransactionFee>(
      { perPermitUsd: 12, percentOfTotal: 5 },
      FEE_SCHEDULE,
      'The Fee Schedule\'s own worked examples fix the order of operations: "$12 plus a service charge of 5% for a total permit fee of $12.60/permit", and "$100 base fee + $12 Transaction Fee + 5% Service charge = $117.60/permit". Both require the 5% to apply to a total that already includes the $12.',
    ),
  ],

  /**
   * EMPTY, and that is the finding. New Jersey describes a bridge-engineer
   * review in its FAQ and publishes no fee for it anywhere — not in the
   * regulation, not in the Fee Schedule, not in the Guidebook. Recording a zero
   * would assert that the review is free, which no source says. Neither row is
   * ever read, because New Jersey has no superload path.
   */
  routeAnalysisFeeUsd: [],
  noBridgeRouteFeeUsd: [],

  superload: {
    /**
     * NO `grossWeight` ROW, AS A POSITIVE FINDING — and the reason New Jersey
     * is absent from the widget's weight-ceiling mirror. New Jersey publishes
     * no superload classification at all: every non-divisible load uses the
     * same single-trip permit and the same fee formula, and "SUPERLOAD" is
     * simply the brand of NJDOT's online permitting system. There is no number
     * to hold and no threshold to warn about, so the federal 80,000 lb
     * contact-us ceiling stands for New Jersey lanes.
     */
    shortSpacing: [],
  },

  /**
   * New Jersey's route survey is an administrative requirement posted on the
   * permit portal rather than a codified rule, and it has two triggers — width
   * over 16 ft and height over 14 ft 6 in. No length trigger is published, so
   * that list is empty rather than guessed.
   */
  routeInspection: {
    widthIn: [
      fromUndatedPage<Threshold>(
        { value: ftIn(16), inclusive: false },
        PORTAL_HOME,
        '"Route survey is required when the overall width exceeds 16\' or height exceeds 14\' 6\'\'." The survey is attached to the application, is carrier-supplied, and NJDOT publishes no fee for it.',
      ),
    ],
    heightIn: [
      fromUndatedPage<Threshold>({ value: ftIn(14, 6), inclusive: false }, PORTAL_HOME),
    ],
    lengthIn: [],
  },

  escortRules: NEW_JERSEY_ESCORT_RULES,

  /** A formula on dimensions and weight. Nothing in it depends on distance. */
  feesDependOnDistance: false,
};

/** Cited for the Guidebook's confirmation that the 2010 fee provisions still stand. */
export const NEW_JERSEY_GUIDEBOOK_SOURCE = GUIDEBOOK;
