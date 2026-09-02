/**
 * NORTH CAROLINA — official NCDOT permit handbook and statutory weights.
 *
 * The handbook publishes the single-trip state fee as a $12–$48 range. The
 * endpoints are stored as conflicting official candidates; collapsing the
 * range to either endpoint would invent a permit class the engine does not
 * know.
 */
import { ftIn, type EscortRule } from '../escortRules.js';
import type { JurisdictionOsowRules } from '../types.js';
import { escortDates, fromSource, type EvidenceSourceDoc } from './evidence.js';

const RETRIEVED = '2026-09-02';

// ── Source documents ──────────────────────────────────────────────────────

const HANDBOOK: EvidenceSourceDoc = {
  id: 'nc-ncdot-osow-handbook',
  title: 'North Carolina Department of Transportation — Oversize/Overweight Permit Handbook',
  url: 'https://connect.ncdot.gov/business/trucking/Documents/Oversize%20Overweight%20Permit%20Handbook.pdf',
  publisher: 'North Carolina Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'legal dimensions, fees, superloads, and escort requirements',
  quote: 'Width 102 inches (8 feet 6 inches) – on all roads in North Carolina. Height 14 feet. Single axle – 20,000 pounds. Tandem axle – 38,000 pounds. Truck tractor/53-foot semi-trailer combination with no overall length limitation is allowed on all roads. Loads shall not extend more than 14 feet beyond the rear of the bed or body of the vehicle. Single Trip Permit Fee $12 - $48 (state fee). $100 non-refundable application fee. State fee ($12 – $48) will be charged in addition to $3 per 1,000 pounds over 132,000 pounds gross weight. Gross weight exceeds 132,000 pounds. Width exceeds 16 feet. Internal and bridge engineering reviews. Front escort for permitted loads more than 12 feet wide on two-lane/two-way traffic highways and a rear escort on multi-lane highways. Rear escort required for permitted loads exceeding 110 feet in length. Front and rear escort required for overall length 150 feet or greater. Front escort required for weight greater than 149,999 pounds. Front and rear escort for permitted loads exceeding 14 feet in width on two-lane/two-way roads. Front pole car escort equipped with height pole indicator for permitted loads exceeding 14 feet 5 inches in height.',
};

const STATUTORY_WEIGHT: EvidenceSourceDoc = {
  id: 'ncgs-20-118',
  title: 'North Carolina General Statutes § 20-118 — Weight of vehicles and load',
  url: 'https://ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_20/GS_20-118.html',
  publisher: 'North Carolina General Assembly',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'subsection (b)',
  quote: 'The single-axle weight of a vehicle or combination of vehicles shall not exceed 20,000 pounds. The tandem-axle weight of a vehicle or combination of vehicles shall not exceed 38,000 pounds. This exception does not authorize the operation on an interstate highway of any vehicle or combination of vehicles with a maximum gross weight limit of more than 80,000 pounds.',
};

function ncRule(
  id: string,
  description: string,
  when: EscortRule['when'],
  then: EscortRule['then'],
): EscortRule {
  return {
    id,
    jurisdiction: 'NC',
    description,
    when,
    then,
    source: HANDBOOK,
    ...escortDates(HANDBOOK),
  };
}

export const NORTH_CAROLINA_ESCORT_RULES: EscortRule[] = [
  ncRule('nc-width-over-12-two-lane-front', 'Loads over 12 feet wide require a front escort on two-lane/two-way highways.', { kind: 'all', of: [{ kind: 'gt', measure: 'widthIn', value: ftIn(12) }, { kind: 'routeClass', anyOf: ['two-lane'] }] }, { front: 1 }),
  ncRule('nc-width-over-12-multilane-rear', 'Loads over 12 feet wide require a rear escort on multilane highways.', { kind: 'all', of: [{ kind: 'gt', measure: 'widthIn', value: ftIn(12) }, { kind: 'routeClass', anyOf: ['interstate', 'divided'] }] }, { rear: 1 }),
  ncRule('nc-length-over-110-rear', 'Loads over 110 feet long require a rear escort.', { kind: 'gt', measure: 'overallLengthIn', value: ftIn(110) }, { rear: 1 }),
  ncRule('nc-length-150-front-rear', 'Loads at least 150 feet long require front and rear escorts.', { kind: 'gte', measure: 'overallLengthIn', value: ftIn(150) }, { front: 1, rear: 1 }),
  ncRule('nc-weight-over-149999-front', 'Loads over 149,999 pounds require a front escort.', { kind: 'gt', measure: 'grossWeightLbs', value: 149_999 }, { front: 1 }),
  ncRule('nc-width-over-14-two-lane-front-rear', 'Loads over 14 feet wide require front and rear escorts on two-lane/two-way roads.', { kind: 'all', of: [{ kind: 'gt', measure: 'widthIn', value: ftIn(14) }, { kind: 'routeClass', anyOf: ['two-lane'] }] }, { front: 1, rear: 1 }),
  ncRule('nc-height-over-14-5-front-pole', 'Loads over 14 feet 5 inches high require a front pole-car escort.', { kind: 'gt', measure: 'heightIn', value: ftIn(14, 5) }, { front: 1, heightPole: true }),
];

export const NORTH_CAROLINA_OSOW_RULES: JurisdictionOsowRules = {
  code: 'NC',
  name: 'North Carolina',
  country: 'US',
  legalLimits: {
    widthIn: [fromSource(102, HANDBOOK)],
    heightIn: [fromSource(ftIn(14), HANDBOOK)],
    trailerLengthIn: [fromSource(ftIn(53), HANDBOOK)],
    frontOverhangIn: [],
    rearOverhangIn: [fromSource(ftIn(14), HANDBOOK)],
    grossWeightLbs: [fromSource(80_000, STATUTORY_WEIGHT, 'Interstate maximum gross weight.')],
    singleAxleLbs: [fromSource(20_000, STATUTORY_WEIGHT)],
    tandemAxleLbs: [fromSource(38_000, STATUTORY_WEIGHT)],
  },
  permitBaseFeeUsd: [
    fromSource(12, HANDBOOK, 'Published lower endpoint of the state-fee range.'),
    fromSource(48, HANDBOOK, 'Published upper endpoint of the state-fee range.'),
  ],
  overweightBands: [],
  conditionalFees: [],
  transactionFee: [],
  routeAnalysisFeeUsd: [],
  noBridgeRouteFeeUsd: [],
  superload: {
    grossWeight: [fromSource({ value: 132_000, inclusive: false }, HANDBOOK)],
    shortSpacing: [],
  },
  routeInspection: {
    widthIn: [fromSource({ value: ftIn(16), inclusive: false }, HANDBOOK)],
    heightIn: [],
    lengthIn: [],
  },
  escortRules: NORTH_CAROLINA_ESCORT_RULES,
  feesDependOnDistance: false,
};
