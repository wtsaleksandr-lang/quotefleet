/**
 * MISSOURI — oversize/overweight single-trip permit rules.
 *
 * The state that is running a PILOT PROGRAMME against its own codified rule.
 * MoDOT's 2026 notice to motor carriers raises three law-enforcement escort
 * thresholds — over-width on two-lane highways from 16 ft to 18 ft, over-length
 * on all highways from 150 ft to 200 ft, over-height from 17 ft to 18 ft — while
 * 7 CSR 10-25.020 still says the old numbers and the pilot "applies during the
 * 2026 calendar year and may be terminated without notice". Both are official,
 * both are current, and between the old and new thresholds a move needs a
 * trooper on one reading and does not on the other. All three are encoded as
 * conflicts that fire only in the disputed band.
 *
 * WHAT THE FEE ACTUALLY IS
 * ------------------------
 * $15 plus $20 for each 10,000 lb over the legal gross weight. Not per mile, not
 * per axle. Mileage enters Missouri's schedule in exactly one place — the bridge
 * and roadway analysis fee above 160,000 lb, which steps $425 / $625 / $925 by
 * distance — and 160,000 lb is also where a Missouri permit stops being routine,
 * so the engine has already refused to price the move by the time the mileage
 * would matter. `feesDependOnDistance` is therefore FALSE, which is right and is
 * not an oversight.
 *
 * TWO UNKNOWNS THAT MOVE THE PRICE, AND ARE TREATED AS SUCH
 * --------------------------------------------------------
 * 1. The regulation never says how a PART increment of 10,000 lb is charged.
 *    A load 5,000 lb over legal is either $20 or $0 of increment depending on the
 *    reading, and the bands below assume the increment is charged in full — the
 *    usual statutory convention, but NOT something Missouri writes. That
 *    assumption is flagged on every Missouri overweight quote.
 * 2. Whether the $250 dimensional movement-feasibility fee and the bridge
 *    analysis fee are CUMULATIVE when one move crosses both superload
 *    thresholds is not stated. Both loads are superloads and the engine prices
 *    neither, so this is recorded rather than guessed.
 *
 * MISSOURI HAS WEIGHT-BASED CIVILIAN ESCORT TRIGGERS, which almost no state
 * does, and one of them is conditioned on ANOTHER ESCORT RULE ALREADY FIRING:
 * "Loads exceeding 160,000lbs but not exceeding 220,000lbs that are subject to
 * other dimensional escort provisions require a front escort on two-lane
 * highways." That is `ruleApplies` over the width, height and length rules.
 *
 * DATE WARNING: the escort table, the payment page, the general FAQ and the
 * route-survey Q&A all carry no revision date at all, so their rows are
 * effective only from our retrieval date. The three statutes are from 2017, 2020
 * and 2023.
 */
import type { SourceDoc, Sourced } from '../provenance.js';
import { ftIn, type EscortRule, type RouteClass } from '../escortRules.js';
import type {
  JurisdictionOsowRules,
  OverweightPricing,
  Threshold,
  TransactionFee,
  WeightBand,
} from '../types.js';

const RETRIEVED = '2026-09-01';

// ── Source documents ──────────────────────────────────────────────────────

const RSMO_304_170: SourceDoc = {
  id: 'mo-rsmo-304-170',
  title: 'RSMo §304.170 — Width, height and length limits',
  url: 'https://revisor.mo.gov/main/OneSection.aspx?section=304.170',
  publisher: 'Missouri Revisor of Statutes',
  revisedOn: '2020-08-28',
  retrievedOn: RETRIEVED,
  cite: 'width 102 in; height 14 ft on the interstate system and designated routes, 13 1/2 ft on all other highways; single vehicle 45 ft; truck-tractor/semitrailer 60 ft with a 53 ft semitrailer on the interstate; other combinations 65 ft / 55 ft',
};

const RSMO_304_180: SourceDoc = {
  id: 'mo-rsmo-304-180',
  title: 'RSMo §304.180 — Axle and gross weight limits',
  url: 'https://revisor.mo.gov/main/OneSection.aspx?bid=53871&section=304.180',
  publisher: 'Missouri Revisor of Statutes',
  revisedOn: '2023-08-28',
  retrievedOn: RETRIEVED,
  cite: 'single axle 20,000 lb; tandem axle 34,000 lb, a tandem being axles more than 40 in and not more than 96 in apart; a general-freight steering axle limited to the manufacturer\'s rating and never over 12,000 lb',
};

const RSMO_304_190: SourceDoc = {
  id: 'mo-rsmo-304-190',
  title: 'RSMo §304.190 — Commercial-zone limits',
  url: 'https://revisor.mo.gov/main/OneSection.aspx?section=304.190',
  publisher: 'Missouri Revisor of Statutes',
  revisedOn: '2017-08-28',
  retrievedOn: RETRIEVED,
  cite: 'height 15 ft and single axle 22,400 lb for a vehicle "operating exclusively within" a qualifying commercial zone',
};

const CSR_10_25_020: SourceDoc = {
  id: 'mo-7-csr-10-25-020',
  title: '7 CSR 10-25 — MoDOT oversize/overweight permit rule',
  url: 'https://www.modot.org/media/16315',
  publisher: 'Missouri Department of Transportation',
  revisedOn: '2025-03-30',
  retrievedOn: RETRIEVED,
  cite: 'the seventeen-row special-permit fee schedule; escort positioning at 300 ft; height detection over 15 ft 6 in; codified law-enforcement triggers at 16 ft wide, 150 ft long and 17 ft high; superload thresholds "generally in excess of sixteen feet (16’) wide, sixteen feet (16’) high, one hundred fifty feet (150’) long and/or over one hundred sixty thousand (160,000) pounds"',
};

const MODOT_LEGAL_LIMITS: SourceDoc = {
  id: 'modot-legal-limits',
  title: 'MoDOT — Legal limits summary',
  url: 'https://www.modot.org/media/16332',
  publisher: 'Missouri Department of Transportation',
  revisedOn: '2025-03-30',
  retrievedOn: RETRIEVED,
  cite: '"Legal Gross Weight is 80,000 lbs. unless specialized equipment."',
};

const MODOT_ESCORT_TABLE: SourceDoc = {
  id: 'modot-escort-requirements-table',
  title: 'MoDOT — Escort requirements table (2026, undated)',
  url: 'https://www.modot.org/media/54903',
  publisher: 'Missouri Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'width, length, height and weight escort thresholds by divided, multilane undivided and two-lane highway; the Kansas City and St Louis bridge-crawl requirement',
};

const MODOT_2026_PILOT: SourceDoc = {
  id: 'modot-2026-pilot-notice',
  title: 'MoDOT — Important notices to motor carriers (2026 escort pilot)',
  url: 'https://www.modot.org/important-notices-motor-carriers',
  publisher: 'Missouri Department of Transportation',
  revisedOn: '2026-01-01',
  retrievedOn: RETRIEVED,
  cite: '"The threshold for law enforcement escorts for overwidth loads on two-lane highways is currently 16’ and will now apply when the load exceeds 18’ in width."; the same for 150 ft to 200 ft of length and 17 ft to 18 ft of height',
};

const MODOT_PAYMENT: SourceDoc = {
  id: 'modot-mcs-payment',
  title: 'MoDOT Motor Carrier Services — payment fees',
  url: 'https://www.modot.org/mcs',
  publisher: 'Missouri Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: '"These fees equate to 2% of the transaction total, plus + 25 cents per transaction."; eCheck "Transaction fee: 50 cents"',
};

const MODOT_SURVEY_FORM: SourceDoc = {
  id: 'modot-superload-route-survey-form',
  title: 'MoDOT — Superload route survey and emergency plan form',
  url: 'https://www.modot.org/media/16312',
  publisher: 'Missouri Department of Transportation',
  revisedOn: '2026-06-16',
  retrievedOn: RETRIEVED,
  cite: '"The route survey shall be completed no more than 14 days prior to the permit start date."; "Height Pole Setting (if load exceeds 15’6”)"',
};

const MODOT_SURVEY_QA: SourceDoc = {
  id: 'modot-route-survey-qa',
  title: 'MoDOT — Route surveys for superload moves in Missouri (undated Q&A)',
  url: 'https://www.modot.org/media/16314',
  publisher: 'Missouri Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'a superload also "Exceeds ... The maximum allowable weight on an axle; and/or • Is not arranged in a routine configuration"; survey contents including utility letters over 17 ft',
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

function fromUndated<T>(value: T, source: SourceDoc, note?: string): Sourced<T> {
  return {
    value,
    source,
    effectiveFrom: RETRIEVED,
    effectiveTo: null,
    ...(note === undefined ? {} : { note }),
  };
}

const EFF_RULE = '2025-03-30';
const EFF_PILOT = '2026-01-01';

const TWO_LANE: RouteClass[] = ['two-lane'];
const UNDIVIDED: RouteClass[] = ['multilane-undivided'];
const DIVIDED: RouteClass[] = ['divided', 'interstate'];
const TWO_LANE_OR_UNDIVIDED: RouteClass[] = ['two-lane', 'multilane-undivided'];

/**
 * "This load needs a Missouri permit of some kind." The overhang and
 * certification absences and the payment-order note apply to every permit rather
 * than to a dimension, and keying them on width alone would hide them from an
 * overweight legal-size move — which is most of heavy haul.
 */
const PERMIT_LIKELY: EscortRule['when'] = {
  kind: 'any',
  of: [
    { kind: 'gt', measure: 'widthIn', value: 102 },
    { kind: 'gt', measure: 'heightIn', value: ftIn(14) },
    { kind: 'gt', measure: 'grossWeightLbs', value: 80000 },
  ],
};

// ── The overweight increments ─────────────────────────────────────────────

const LEGAL_GROSS = 80000;
const INCREMENT_LBS = 10000;
const INCREMENT_USD = 20;
/**
 * The last band ends at Missouri's own routine ceiling. Above 160,000 lb a
 * permit is a superload, the engine emits no priced lines at all, and the
 * bridge-analysis fee that takes over up there is stepped by distance rather
 * than by weight — so enumerating further would be enumerating a schedule that
 * never reaches a quote.
 */
const TOP_BAND_LBS = 160000;

const overweightBands: Sourced<WeightBand>[] = Array.from(
  { length: (TOP_BAND_LBS - LEGAL_GROSS) / INCREMENT_LBS },
  (_unused, i) => {
    const increments = i + 1;
    return fromDated<WeightBand>(
      {
        minLbs: LEGAL_GROSS + i * INCREMENT_LBS + 1,
        maxLbs: LEGAL_GROSS + increments * INCREMENT_LBS,
        feeUsd: increments * INCREMENT_USD,
      },
      CSR_10_25_020,
      EFF_RULE,
      `"fifteen dollars ($15) plus twenty dollars ($20) per each ten thousand (10,000) pounds in excess of legal gross weight" — ${increments} increment${increments === 1 ? '' : 's'} above 80,000 lb. THE BAND EDGE IS OUR READING: the regulation does not say how a part increment is charged, and this band charges it in full. See \`mo-partial-increment-unknown\`.`,
    );
  },
);

// ── Escort rules ──────────────────────────────────────────────────────────

function escortRule(
  id: string,
  description: string,
  when: EscortRule['when'],
  then: EscortRule['then'],
  source: SourceDoc = MODOT_ESCORT_TABLE,
  effectiveFrom: string = RETRIEVED,
): EscortRule {
  return {
    id,
    jurisdiction: 'MO',
    description,
    when,
    then,
    source,
    effectiveFrom,
    effectiveTo: null,
  };
}

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

function lengthBand(min: number, max: number): EscortRule['when'] {
  return {
    kind: 'between',
    measure: 'overallLengthIn',
    min,
    max,
    minInclusive: false,
    maxInclusive: true,
  };
}

export const MISSOURI_ESCORT_RULES: EscortRule[] = [
  // ── Width ───────────────────────────────────────────────────────────────
  escortRule(
    'mo-width-over-12-6-to-14-divided-or-undivided',
    'Over 12 ft 6 in up to 14 ft wide on a divided or multilane undivided highway — one rear escort',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: [...DIVIDED, ...UNDIVIDED] },
        widthBand(ftIn(12, 6), ftIn(14)),
      ],
    },
    { escorts: 1, rear: 1 },
  ),
  escortRule(
    'mo-width-over-12-6-to-14-two-lane',
    'Over 12 ft 6 in up to 14 ft wide on a two-lane highway — one front escort',
    {
      kind: 'all',
      of: [{ kind: 'routeClass', anyOf: TWO_LANE }, widthBand(ftIn(12, 6), ftIn(14))],
    },
    { escorts: 1, front: 1 },
  ),
  escortRule(
    'mo-width-over-14-to-16-divided',
    'Over 14 ft up to 16 ft wide on a divided highway — one rear escort',
    {
      kind: 'all',
      of: [{ kind: 'routeClass', anyOf: DIVIDED }, widthBand(ftIn(14), ftIn(16))],
    },
    { escorts: 1, rear: 1 },
  ),
  /**
   * THE CASE THAT FORCED `multilane-undivided` INTO `RouteClass`. Between 12 ft
   * 6 in and 14 ft an undivided multilane road takes the DIVIDED treatment (one
   * rear escort); between 14 ft and 16 ft it takes the TWO-LANE treatment (front
   * and rear). It cannot be folded onto either neighbour without losing a pilot
   * car in one band or the other.
   */
  escortRule(
    'mo-width-over-14-to-16-two-lane-or-undivided',
    'Over 14 ft up to 16 ft wide on a two-lane or multilane undivided highway — one front and one rear escort',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: TWO_LANE_OR_UNDIVIDED },
        widthBand(ftIn(14), ftIn(16)),
      ],
    },
    { escorts: 2, front: 1, rear: 1 },
  ),
  escortRule(
    'mo-width-over-16-to-18',
    'Over 16 ft up to 18 ft wide — one front and one rear escort on all highways',
    widthBand(ftIn(16), ftIn(18)),
    { escorts: 2, front: 1, rear: 1 },
  ),
  escortRule(
    'mo-width-over-16-to-18-two-lane-extra-front',
    'Over 16 ft up to 18 ft wide on a two-lane highway — an additional front escort',
    {
      kind: 'all',
      of: [{ kind: 'routeClass', anyOf: TWO_LANE }, widthBand(ftIn(16), ftIn(18))],
    },
    { escorts: 3, front: 2, rear: 1 },
  ),
  escortRule(
    'mo-width-over-18',
    'Over 18 ft wide — one front and one rear civilian escort plus a law-enforcement escort on all highways',
    { kind: 'gt', measure: 'widthIn', value: ftIn(18) },
    {
      escorts: 2,
      front: 1,
      rear: 1,
      policeFront: 1,
      manualReview:
        'MoDOT requires a law-enforcement escort above 18 ft of width on every highway class. Missouri publishes no hourly, mileage or fixed rate for it — 7 CSR 10-25 says only that "All future permitting authority for a carrier may be revoked if the Missouri State Highway Patrol, local or military law enforcement agencies acting as escorts, are not reimbursed for superload escorting services" — and the rule does not say whether the trooper leads or trails. No police-escort amount is included in the total.',
    },
  ),
  escortRule(
    'mo-width-over-18-two-lane-extra-front',
    'Over 18 ft wide on a two-lane highway — an additional front escort',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: TWO_LANE },
        { kind: 'gt', measure: 'widthIn', value: ftIn(18) },
      ],
    },
    { escorts: 3, front: 2, rear: 1 },
  ),

  // ── Length ──────────────────────────────────────────────────────────────
  escortRule(
    'mo-length-over-110-to-125-not-divided',
    'Over 110 ft up to 125 ft long on any highway except a divided one — one rear escort',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: TWO_LANE_OR_UNDIVIDED },
        lengthBand(ftIn(110), ftIn(125)),
      ],
    },
    { escorts: 1, rear: 1 },
  ),
  escortRule(
    'mo-length-over-125-to-200',
    'Over 125 ft up to 200 ft long — one rear escort on all highways',
    lengthBand(ftIn(125), ftIn(200)),
    { escorts: 1, rear: 1 },
  ),
  escortRule(
    'mo-length-over-150-to-200-two-lane-extra-front',
    'Over 150 ft up to 200 ft long on a two-lane highway — an additional front escort',
    {
      kind: 'all',
      of: [{ kind: 'routeClass', anyOf: TWO_LANE }, lengthBand(ftIn(150), ftIn(200))],
    },
    { escorts: 2, front: 1, rear: 1 },
  ),
  escortRule(
    'mo-length-over-200',
    'Over 200 ft long — a rear escort and a law-enforcement escort on all highways',
    { kind: 'gt', measure: 'overallLengthIn', value: ftIn(200) },
    {
      escorts: 1,
      rear: 1,
      policeRear: 1,
      manualReview:
        'A law-enforcement escort is required above 200 ft on every highway class under MoDOT\'s current table. Missouri publishes no rate for it and does not state whether the trooper leads or trails; the position recorded here follows the civilian escort the table pairs it with and is not asserted as MoDOT\'s. No police-escort amount is in the total.',
    },
  ),
  escortRule(
    'mo-length-over-200-two-lane-extra-front',
    'Over 200 ft long on a two-lane highway — an additional front escort',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: TWO_LANE },
        { kind: 'gt', measure: 'overallLengthIn', value: ftIn(200) },
      ],
    },
    { escorts: 2, front: 1, rear: 1 },
  ),

  // ── Height ──────────────────────────────────────────────────────────────
  escortRule(
    'mo-height-over-15-6',
    'Over 15 ft 6 in high — a front height-detection escort vehicle on all highways',
    { kind: 'gt', measure: 'heightIn', value: ftIn(15, 6) },
    {
      escorts: 1,
      front: 1,
      heightPole: true,
      advisory:
        '7 CSR 10-25 specifies only that "The height detection vehicle shall have a vertical clearance detection device and have direct, continuous, uninterrupted, two- (2-) way communication with the power unit". Missouri publishes no numerical pole setting or clearance offset above the load — its own superload route-survey form has a field reading "Height Pole Setting (if load exceeds 15’6”)" and leaves it to the applicant to fill in. The height-detection vehicle serves as the front escort unless the table prescribes more than one.',
    },
    CSR_10_25_020,
    EFF_RULE,
  ),
  escortRule(
    'mo-height-over-16-two-lane-extra-front',
    'Over 16 ft high on a two-lane highway — an additional front escort beyond the height-detection vehicle',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: TWO_LANE },
        { kind: 'gt', measure: 'heightIn', value: ftIn(16) },
      ],
    },
    { escorts: 2, front: 2 },
  ),
  escortRule(
    'mo-height-over-18',
    'Over 18 ft high — a height-detection vehicle and a law-enforcement escort on all highways',
    { kind: 'gt', measure: 'heightIn', value: ftIn(18) },
    {
      policeFront: 1,
      manualReview:
        'MoDOT\'s current table requires a law-enforcement escort above 18 ft of height on every highway class, with no published rate and no stated position. Separately, 7 CSR 10-25 requires that "If the loaded height exceeds seventeen feet (17’), the applicant shall provide a written document from the appropriate utility company indicating approval to disturb aerial lines across the route" — a third-party arrangement whose cost is not a state charge and is not in the total.',
    },
  ),

  // ── Weight, which almost no other state uses for civilian escorts ───────
  /**
   * THE COMPOUND CONDITIONAL. "Loads exceeding 160,000lbs but not exceeding
   * 220,000lbs THAT ARE SUBJECT TO OTHER DIMENSIONAL ESCORT PROVISIONS require a
   * front escort on two-lane highways." The trigger is not the weight alone —
   * it is the weight plus the fact that some other rule has already fired, which
   * is what `ruleApplies` exists for. A 200,000 lb load of ordinary dimensions
   * on a two-lane highway needs no escort for its weight; the same weight on a
   * 13 ft wide load needs one.
   */
  escortRule(
    'mo-weight-160001-to-220000-two-lane-with-other-escort',
    'Over 160,000 lb up to 220,000 lb on a two-lane highway, when a dimensional escort provision already applies — one front escort',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: TWO_LANE },
        {
          kind: 'between',
          measure: 'grossWeightLbs',
          min: 160000,
          max: 220000,
          minInclusive: false,
          maxInclusive: true,
        },
        {
          kind: 'any',
          of: [
            { kind: 'ruleApplies', ruleId: 'mo-width-over-12-6-to-14-two-lane' },
            { kind: 'ruleApplies', ruleId: 'mo-width-over-14-to-16-two-lane-or-undivided' },
            { kind: 'ruleApplies', ruleId: 'mo-width-over-16-to-18' },
            { kind: 'ruleApplies', ruleId: 'mo-width-over-18' },
            { kind: 'ruleApplies', ruleId: 'mo-length-over-110-to-125-not-divided' },
            { kind: 'ruleApplies', ruleId: 'mo-length-over-125-to-200' },
            { kind: 'ruleApplies', ruleId: 'mo-length-over-200' },
            { kind: 'ruleApplies', ruleId: 'mo-height-over-15-6' },
          ],
        },
      ],
    },
    { escorts: 1, front: 1 },
  ),
  escortRule(
    'mo-weight-over-220000-to-350000-two-lane',
    'Over 220,000 lb up to 350,000 lb on a two-lane highway — one front escort, whatever the dimensions',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: TWO_LANE },
        {
          kind: 'between',
          measure: 'grossWeightLbs',
          min: 220000,
          max: 350000,
          minInclusive: false,
          maxInclusive: true,
        },
      ],
    },
    { escorts: 1, front: 1 },
  ),
  escortRule(
    'mo-weight-over-350000',
    'Over 350,000 lb — one front and one rear escort on all highways',
    { kind: 'gt', measure: 'grossWeightLbs', value: 350000 },
    {
      escorts: 2,
      front: 1,
      rear: 1,
      advisory:
        '7 CSR 10-25 additionally requires that "If the gross vehicle weight exceeds three hundred fifty thousand (350,000) pounds, an additional power unit must accompany the load", which Motor Carrier Services may waive for a move limited in length. The extra tractor is the carrier\'s cost and is not a state fee.',
    },
  ),
  escortRule(
    'mo-weight-over-350000-two-lane-extra-front',
    'Over 350,000 lb on a two-lane highway — an additional front escort',
    {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: TWO_LANE },
        { kind: 'gt', measure: 'grossWeightLbs', value: 350000 },
      ],
    },
    { escorts: 3, front: 2, rear: 1 },
  ),
  escortRule(
    'mo-bridge-crawl-over-160000',
    'Over 160,000 lb — a front and two rear escorts while bridge crawling in Kansas City and St Louis',
    { kind: 'gt', measure: 'grossWeightLbs', value: 160000 },
    {
      advisory:
        'MoDOT\'s escort table adds: "BRIDGE CRAWL: Loads exceeding 160,000lbs require a front and two rear escorts when bridge crawling in Kansas City and St Louis." That is three vehicles for the crawl portion only, and a quote does not know whether the route crosses those bridges, so the extra rear escort has not been added and cannot be ruled out.',
    },
  ),

  // ── The 2026 pilot against the codified rule ────────────────────────────
  escortRule(
    'mo-le-width-threshold-conflict',
    'Over 16 ft up to 18 ft wide on a two-lane highway — the codified rule requires a trooper and the 2026 pilot does not',
    {
      kind: 'all',
      of: [{ kind: 'routeClass', anyOf: TWO_LANE }, widthBand(ftIn(16), ftIn(18))],
    },
    {
      manualReview:
        'Missouri\'s two current sources disagree about whether this move needs a law-enforcement escort. Codified 7 CSR 10-25.020 lists "Missouri State Highway Patrol escorts are required when load exceeds — A. Sixteen feet (16’) wide"; MoDOT\'s 2026 notice to motor carriers says "The threshold for law enforcement escorts for overwidth loads on two-lane highways is currently 16’ and will now apply when the load exceeds 18’ in width", and the pilot "applies during the 2026 calendar year and may be terminated without notice". A trooper on one reading and none on the other, on the same load. Neither has been adopted and no police escort has been priced.',
    },
    MODOT_2026_PILOT,
    EFF_PILOT,
  ),
  escortRule(
    'mo-le-length-threshold-conflict',
    'Over 150 ft up to 200 ft long — the codified rule requires a trooper and the 2026 pilot does not',
    lengthBand(ftIn(150), ftIn(200)),
    {
      manualReview:
        'Codified 7 CSR 10-25.020 requires a Highway Patrol escort above "One hundred fifty feet (150’) overall length", and MoDOT\'s undated FAQ still says the same; the 2026 pilot notice and the current escort table both raise it to over 200 feet. The pilot may be terminated without notice. Neither reading has been adopted and no police escort has been priced for this length.',
    },
    MODOT_2026_PILOT,
    EFF_PILOT,
  ),
  escortRule(
    'mo-le-height-threshold-conflict',
    'Over 17 ft up to 18 ft high — the codified rule requires a trooper and the 2026 pilot does not',
    {
      kind: 'between',
      measure: 'heightIn',
      min: ftIn(17),
      max: ftIn(18),
      minInclusive: false,
      maxInclusive: true,
    },
    {
      manualReview:
        'Codified 7 CSR 10-25.020 requires a Highway Patrol escort above "Seventeen feet (17’) high" and MoDOT\'s undated FAQ agrees; the 2026 pilot notice and the current escort table raise it to over 18 feet. Neither has been adopted. Note that the separate obligation to obtain written utility approval above 17 ft of loaded height is NOT part of the pilot and still applies.',
    },
    MODOT_2026_PILOT,
    EFF_PILOT,
  ),

  // ── The unknowns that move the price ────────────────────────────────────
  escortRule(
    'mo-partial-increment-unknown',
    'The overweight fee is charged per 10,000 lb, and Missouri does not say how a part increment is charged',
    { kind: 'gt', measure: 'grossWeightLbs', value: LEGAL_GROSS },
    {
      manualReview:
        '7 CSR 10-25 charges "fifteen dollars ($15) plus twenty dollars ($20) per each ten thousand (10,000) pounds in excess of legal gross weight" and never says what happens to a PART increment. A load 5,000 lb over legal is $20 of increment if a part increment is charged in full and $0 if it is not, and the same ambiguity repeats at every 10,000 lb step. The amount above charges the part increment in full, which is the usual convention in fee statutes but is NOT what Missouri writes. Note also that "legal gross weight" is itself route- and configuration-dependent in Missouri and is not always the 80,000 lb figure used here.',
    },
    CSR_10_25_020,
    EFF_RULE,
  ),
  escortRule(
    'mo-superload-fee-cumulation-unknown',
    'A move that is both a dimensional and a weight superload — Missouri does not say whether the two fees stack',
    {
      kind: 'all',
      of: [
        { kind: 'gt', measure: 'grossWeightLbs', value: 160000 },
        {
          kind: 'any',
          of: [
            { kind: 'gt', measure: 'widthIn', value: ftIn(16) },
            { kind: 'gt', measure: 'heightIn', value: ftIn(16) },
            { kind: 'gt', measure: 'overallLengthIn', value: ftIn(150) },
          ],
        },
      ],
    },
    {
      manualReview:
        'This move crosses both of Missouri\'s superload lines. A dimensional superload carries "fifteen dollars ($15) plus two hundred fifty dollars ($250) movement feasibility fee"; a weight superload over 160,000 lb carries $15 plus the weight increments plus a bridge and roadway analysis fee of $425 for 0–50 miles, $625 for 51–200 miles or $925 over 200 miles. The regulation lists them separately and never says whether the $250 is charged as well when both thresholds are exceeded. No total is quoted for a superload in any case.',
    },
    CSR_10_25_020,
    EFF_RULE,
  ),
  escortRule(
    'mo-superload-definition-conflict',
    'Missouri’s own documents define a superload two different ways',
    { kind: 'gt', measure: 'grossWeightLbs', value: LEGAL_GROSS },
    {
      advisory:
        'MoDOT\'s general rule defines a superload by four thresholds — "generally in excess of sixteen feet (16’) wide, sixteen feet (16’) high, one hundred fifty feet (150’) long and/or over one hundred sixty thousand (160,000) pounds gross weight" — with "generally" doing real work. Its route-survey Q&A adds two more: a load that exceeds "The maximum allowable weight on an axle; and/or • Is not arranged in a routine configuration". A load inside all four thresholds can still be given superload treatment on its axle weights or its configuration, and neither definition has been adopted over the other.',
    },
    MODOT_SURVEY_QA,
    RETRIEVED,
  ),

  // ── Recorded unknowns that do not move a priced line ────────────────────
  escortRule(
    'mo-height-13-6-to-14-route-class',
    'Between 13 ft 6 in and 14 ft high — Missouri’s legal height depends on which highway the move uses',
    {
      kind: 'between',
      measure: 'heightIn',
      min: ftIn(13, 6),
      max: ftIn(14),
      minInclusive: false,
      maxInclusive: true,
    },
    {
      manualReview:
        'RSMo §304.170 sets 14 ft on the interstate system and on routes the Highways and Transportation Commission designates — MoDOT extends the same limit within 10 air miles of that network — and "On all other highways, no vehicle shall have a height, including load, in excess of thirteen and one-half feet". This load is between the two, so whether it needs a permit at all depends on the route rather than on the load. The 14 ft limit has been used, which is the one that applies where freight runs; a move off the designated system at this height needs a permit that is not priced above. A vehicle operating EXCLUSIVELY within a qualifying commercial zone may reach 15 ft under §304.190.',
    },
    RSMO_304_170,
    '2020-08-28',
  ),
  escortRule(
    'mo-route-survey-method-conflict',
    'Route survey — the rule allows modelling software and the undated Q&A says to drive the route',
    { kind: 'gt', measure: 'overallLengthIn', value: ftIn(150) },
    {
      advisory:
        'A route survey is required for every Missouri superload once Motor Carrier Services approves a route, must be completed no more than 14 days before the permit start date, and is performed by the applicant — Missouri publishes no survey fee and no surveyor rate, so no survey cost is in the total. How it may be done is in dispute: 7 CSR 10-25 permits an applicant to "utilize a roadway geometric modeling software application, as approved by the department, or must physically drive the proposed route ... if the load is greater than one hundred fifty feet (150’) long", while MoDOT\'s undated route-survey Q&A instructs the applicant to physically travel the roadways. Neither has been adopted.',
    },
    MODOT_SURVEY_QA,
    RETRIEVED,
  ),
  escortRule(
    'mo-overhang-and-certification-unknowns',
    'Missouri publishes no overhang escort threshold and no pilot-car certification',
    PERMIT_LIKELY,
    {
      advisory:
        'Missouri\'s escort table gives OVERALL LENGTH thresholds and publishes no separate front- or rear-overhang escort trigger, so overhang reaches these rules only through the load\'s total length. Missouri also has no pilot-car certificate: 7 CSR 10-25 requires only that "Operators of escort vehicles shall be properly licensed, obey all traffic laws, and be at least eighteen (18) years of age", so there is no certification cost, validity period or reciprocity provision to apply — and no state-imposed escort cost either. Escorts run approximately 300 ft ahead of or behind the load, adjustable for traffic in cities and towns.',
    },
    CSR_10_25_020,
    EFF_RULE,
  ),
  escortRule(
    'mo-rule-effective-date-and-payment',
    'Missouri’s rule carries two effective dates a day apart, and the card fee is applied in a different order from ours',
    PERMIT_LIKELY,
    {
      advisory:
        'Two small discrepancies worth knowing. The regulation cover and rule history date the current amendments March 30 2025 while MoDOT\'s own OS/OW landing page says March 31 2025; nothing in the schedule changes between the two days. And MoDOT states its card fee as "2% of the transaction total, plus + 25 cents per transaction" — the percentage applied to the permit total and the 25 cents added afterwards — while this engine adds the flat amount first and takes the percentage of the sum, which is a difference of half a cent and can round the service fee one cent high. An eCheck payment is a flat 50 cents with no percentage at all.',
    },
    MODOT_PAYMENT,
    RETRIEVED,
  ),
];

// ── The jurisdiction ──────────────────────────────────────────────────────

export const MISSOURI_OSOW_RULES: JurisdictionOsowRules = {
  code: 'MO',
  name: 'Missouri',
  country: 'US',

  legalLimits: {
    widthIn: [
      fromDated(
        102,
        RSMO_304_170,
        '2020-08-28',
        '"No vehicle operated upon the highways of this state shall have a width, including load, in excess of one hundred two inches". Clearance lights, mirrors and legally required accessories are excluded by the statute.',
      ),
    ],
    /**
     * 14 ft — the interstate and designated-route limit, which is where freight
     * runs. Missouri's second limit of 13 ft 6 in "on all other highways" is a
     * different claim about a different network rather than a competing claim
     * about the same one, so recording both as candidates would manufacture a
     * conflict and disable the over-height check entirely. The 6-inch band where
     * the two give different answers is carried by
     * `mo-height-13-6-to-14-route-class`.
     */
    heightIn: [
      fromDated(
        ftIn(14),
        RSMO_304_170,
        '2020-08-28',
        '"No vehicle operated upon the interstate highway system or upon any route designated by the state highways and transportation commission shall have a height, including load, in excess of fourteen feet." MoDOT applies the same limit within 10 air miles of that network. Off it the limit is 13 1/2 ft, and inside a qualifying commercial zone §304.190 allows 15 ft for a vehicle operating exclusively there. A vehicle transporting automobiles may be 14 ft anywhere under the statutory exception.',
      ),
    ],
    trailerLengthIn: [
      fromDated(
        ftIn(53),
        RSMO_304_170,
        '2020-08-28',
        '"The length of such semitrailer shall not exceed fifty-three feet" for a truck-tractor/semitrailer on the interstate system, where the statute drops the overall cap and regulates the trailing unit instead.',
      ),
    ],
    /**
     * `overallLengthIn` is ABSENT. RSMo §304.170 caps a truck-tractor/semitrailer
     * combination at 60 ft generally, and then removes that cap on the interstate
     * system, where the combination may be "the length of the truck-tractor plus
     * the semitrailer" with a 53 ft trailing unit — which is how every ordinary
     * tractor-semitrailer runs. Recording 60 ft would put the whole national
     * fleet over the legal limit in Missouri. Other combinations are capped at
     * 65 ft on the primary and interstate system and within ten miles of it, and
     * 55 ft elsewhere; neither is the configuration these quotes price.
     *
     * Overhang limits are absent for the ordinary reason: Missouri publishes
     * none, and its escort table reaches overhang only through overall length.
     */
    grossWeightLbs: [
      fromDated(
        80000,
        MODOT_LEGAL_LIMITS,
        EFF_RULE,
        '"Legal Gross Weight is 80,000 lbs. unless specialized equipment." Axle, tandem, bridge-formula, posted-bridge, commodity and commercial-zone limits also apply and can bind below this figure; the federal bridge formula is checked separately in `bridgeFormula.ts`.',
      ),
    ],
    singleAxleLbs: [
      fromDated(
        20000,
        RSMO_304_180,
        '2023-08-28',
        'A steering axle used by a transporter of general freight over regular routes is limited to the manufacturer\'s rating and may not exceed 12,000 lb. Inside a qualifying commercial zone §304.190 allows 22,400 lb on one axle for a vehicle operating exclusively there.',
      ),
    ],
    tandemAxleLbs: [
      fromDated(
        34000,
        RSMO_304_180,
        '2023-08-28',
        'The statute defines a tandem as two or more axles whose extremes are more than 40 inches and not more than 96 inches apart.',
      ),
    ],
  },

  /** $15. The same base fee whether the permit is oversize, overweight or both. */
  permitBaseFeeUsd: [
    fromDated(
      15,
      CSR_10_25_020,
      EFF_RULE,
      '"Single trip oversize permits—fifteen dollars ($15);" and "Single trip overweight permits up to and including one hundred sixty thousand (160,000) pounds gross weight—fifteen dollars ($15) plus twenty dollars ($20) per each ten thousand (10,000) pounds in excess of legal gross weight". The $15 is common to both, so it is the base and the weight increments sit on top of it.',
    ),
  ],

  /**
   * ABSENT, as a finding. Missouri does not step the oversize fee by dimension
   * at all: a load an inch over width and a load 15 ft wide both pay the same
   * $15. The one dimensional step Missouri does publish — $250 on top of the $15
   * for a permit "in excess of sixteen feet (16’) wide, sixteen feet (16’) high,
   * or one hundred fifty feet (150’) long" — sits exactly on the dimensional
   * superload thresholds, so the engine has already stopped pricing by the time
   * it applies. It is stated by `mo-superload-fee-cumulation-unknown` instead.
   */

  overweightPricing: [
    fromDated<OverweightPricing>(
      {
        kind: 'bands',
        explanation:
          '7 CSR 10-25 charges "twenty dollars ($20) per each ten thousand (10,000) pounds in excess of legal gross weight" on top of the $15 base — a weight-increment formula, not a per-mile or per-axle rate. Distance enters Missouri\'s schedule only in the bridge and roadway analysis fee above 160,000 lb ($425 for 0–50 miles, $625 for 51–200, $925 over 200), and 160,000 lb is also where the permit stops being routine.',
      },
      CSR_10_25_020,
      EFF_RULE,
    ),
  ],

  overweightBands,

  /** No mileage component below the superload line. */
  overweightPerMile: [],

  /** Missouri attaches no weight-conditioned surcharge to a routine permit. */
  conditionalFees: [],

  transactionFee: [
    fromUndated<TransactionFee>(
      { perPermitUsd: 0.25, percentOfTotal: 2 },
      MODOT_PAYMENT,
      '"These fees equate to 2% of the transaction total, plus + 25 cents per transaction." MoDOT applies the percentage to the total and adds the 25 cents afterwards; this engine adds the flat amount first, a difference of half a cent that can round one cent high. Paying by eCheck costs a flat 50 cents with no percentage.',
    ),
  ],

  /**
   * $425 — the bridge and roadway analysis fee for a move of 0 to 50 miles, and
   * also the escrow figure the rule names: "A minimum of four hundred twenty-five
   * dollars ($425) may be required in escrow (to cover the cost of a bridge
   * analysis) before an application can be processed." The two longer distance
   * steps are recorded in the note rather than as competing rows, because they
   * are not a disagreement — they are one schedule read at three distances, and
   * filing them as three candidates would resolve to null and lose the figure
   * entirely.
   */
  routeAnalysisFeeUsd: [
    fromDated(
      425,
      CSR_10_25_020,
      EFF_RULE,
      'The 0–50 mile step of the bridge and roadway analysis fee, which is also the minimum escrow. It rises to $625 for 51–200 miles and $925 over 200 miles. An identical reapplication is charged once if the original study is under 30 days old above 300,000 lb or under 60 days old below it, and modifying dimensions or weights after an analysis has completed costs a further $425.',
    ),
  ],

  /** Missouri publishes no reduced fee for a route that crosses no bridges. */
  noBridgeRouteFeeUsd: [],

  superload: {
    grossWeight: [
      fromDated<Threshold>(
        { value: 160000, inclusive: false },
        CSR_10_25_020,
        EFF_RULE,
        '"generally in excess of ... one hundred sixty thousand (160,000) pounds gross weight". The word "generally" is the regulation\'s own, and MoDOT\'s route-survey Q&A adds axle weight and non-routine configuration as further routes into superload treatment — see `mo-superload-definition-conflict`. Two weeks should be allowed for the route evaluation, and $2,000,000 combined single-limit automobile liability is required.',
      ),
    ],
    /** Missouri publishes no short-axle-spacing superload trigger. */
    shortSpacing: [],
    widthIn: [
      fromDated<Threshold>({ value: ftIn(16), inclusive: false }, CSR_10_25_020, EFF_RULE),
    ],
    heightIn: [
      fromDated<Threshold>({ value: ftIn(16), inclusive: false }, CSR_10_25_020, EFF_RULE),
    ],
    overallLengthIn: [
      fromDated<Threshold>({ value: ftIn(150), inclusive: false }, CSR_10_25_020, EFF_RULE),
    ],
  },

  /**
   * Missouri's survey obligations are keyed on length and on height. Over 150 ft
   * the applicant must model or drive the route; over 17 ft of loaded height the
   * applicant must obtain written utility approval to disturb aerial lines.
   * Neither is a state charge. No width trigger is published, so that list is
   * empty rather than guessed.
   */
  routeInspection: {
    widthIn: [],
    heightIn: [
      fromDated<Threshold>(
        { value: ftIn(17), inclusive: false },
        CSR_10_25_020,
        EFF_RULE,
        '"If the loaded height exceeds seventeen feet (17’), the applicant shall provide a written document from the appropriate utility company indicating approval to disturb aerial lines across the route."',
      ),
    ],
    lengthIn: [
      fromDated<Threshold>(
        { value: ftIn(150), inclusive: false },
        CSR_10_25_020,
        EFF_RULE,
        'Above 150 ft the applicant must use department-approved roadway geometric modelling software or physically drive the proposed route.',
      ),
    ],
  },

  escortRules: MISSOURI_ESCORT_RULES,

  /**
   * FALSE, and deliberately so. The only distance-priced element in Missouri's
   * schedule is the bridge and roadway analysis fee above 160,000 lb, which is
   * above the superload line where the engine emits no priced lines at all.
   * Setting this true would refuse to price every ordinary Missouri permit for
   * want of a mileage figure that never enters the arithmetic.
   */
  feesDependOnDistance: false,
};

/** Cited for the commercial-zone height and axle allowances. */
export const MISSOURI_COMMERCIAL_ZONE_SOURCE = RSMO_304_190;

/** Cited for the superload route-survey timing requirement. */
export const MISSOURI_ROUTE_SURVEY_FORM_SOURCE = MODOT_SURVEY_FORM;
