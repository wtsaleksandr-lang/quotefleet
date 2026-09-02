/**
 * ALABAMA — official ALDOT rules presentation and superload guidance.
 *
 * The published fee table mixes total permit prices by permit type; treating
 * them as additive engine bands would double-charge. Fee arrays stay empty.
 */
import { ftIn, type EscortRule } from '../escortRules.js';
import type { JurisdictionOsowRules } from '../types.js';
import { escortDates, fromSource, type EvidenceSourceDoc } from './evidence.js';

const RETRIEVED = '2026-09-02';

// ── Source documents ──────────────────────────────────────────────────────

const RULES_PRESENTATION: EvidenceSourceDoc = {
  id: 'al-aldot-osow-rules-presentation',
  title: 'Alabama Department of Transportation — Rules and Regulations Presentation',
  url: 'https://www.dot.state.al.us/business/permits/pdf/RulesandRegulationsPresentation.pdf',
  publisher: 'Alabama Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'legal dimensions and escort requirements effective after June 1, 2017',
  quote: 'Legal Width: 8’ 6”. Legal Height: 13’ 6”. No vehicle shall exceed in length 40 feet; EXCEPT, that the length of a truck-semi-trailer combination, semi-trailers, including load, used in a truck tractor-semi-trailer combination, shall not exceed 57 feet. Legal Overhang Length: 5’ Maximum Legal Overhang (Front and Rear) = 5’. Overwidth: >12’ = 1 Front and 1 Rear Escort. Overheight: >15’6” = 1 Front Escort with Height Pole. Overlength: 76’-105’ inclusive = 1 Rear Escort; >105’-150’ = 1 Front Escort and 1 Rear Escort. Overhang: ≥10’ Front Overhang = 1 Front Escort; >5’ Rear Overhang = 1 Rear Escort.',
};

const SUPERLOAD: EvidenceSourceDoc = {
  id: 'al-aldot-superload-information',
  title: 'Alabama Department of Transportation — Superload Information',
  url: 'https://www.dot.state.al.us/business/permits/pdf/SuperloadInformation.pdf',
  publisher: 'Alabama Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  quote: 'In Alabama, a Superload will be defined as any load where one or more of the following dimensions are exceeded: Width 16 feet Height 16 feet Length 150 feet Weight 300,000 lbs. gross weight. A detailed route survey is required for all Superloads. A minimum of two (2) State Trooper or Police Escorts are required for all Superloads.',
};

function alRule(
  id: string,
  description: string,
  when: EscortRule['when'],
  then: EscortRule['then'],
  source: EvidenceSourceDoc = RULES_PRESENTATION,
): EscortRule {
  return {
    id,
    jurisdiction: 'AL',
    description,
    when,
    then,
    source,
    ...escortDates(source),
  };
}

export const ALABAMA_ESCORT_RULES: EscortRule[] = [
  alRule('al-width-over-12-front-rear', 'Loads over 12 feet wide require front and rear escorts.', { kind: 'gt', measure: 'widthIn', value: ftIn(12) }, { front: 1, rear: 1 }),
  alRule('al-height-over-15-6-front-pole', 'Loads over 15 feet 6 inches high require a front height-pole escort.', { kind: 'gt', measure: 'heightIn', value: ftIn(15, 6) }, { front: 1, heightPole: true }),
  alRule('al-length-76-to-105-rear', 'Loads 76 through 105 feet long require one rear escort.', { kind: 'between', measure: 'overallLengthIn', min: ftIn(76), max: ftIn(105) }, { rear: 1 }),
  alRule('al-length-over-105-to-150-front-rear', 'Loads over 105 through 150 feet long require front and rear escorts.', { kind: 'between', measure: 'overallLengthIn', min: ftIn(105), max: ftIn(150), minInclusive: false }, { front: 1, rear: 1 }),
  alRule('al-front-overhang-10-front', 'Front overhang of at least 10 feet requires a front escort.', { kind: 'gte', measure: 'frontOverhangIn', value: ftIn(10) }, { front: 1 }),
  alRule('al-rear-overhang-over-5-rear', 'Rear overhang over 5 feet requires a rear escort.', { kind: 'gt', measure: 'rearOverhangIn', value: ftIn(5) }, { rear: 1 }),
  alRule(
    'al-superload-survey-police',
    'Any published Alabama superload dimension requires a route survey and at least two police escorts.',
    {
      kind: 'any',
      of: [
        { kind: 'gt', measure: 'widthIn', value: ftIn(16) },
        { kind: 'gt', measure: 'heightIn', value: ftIn(16) },
        { kind: 'gt', measure: 'overallLengthIn', value: ftIn(150) },
        { kind: 'gt', measure: 'grossWeightLbs', value: 300_000 },
      ],
    },
    {
      routeSurvey: true,
      superload: true,
      manualReview: 'Alabama requires at least two State Trooper or police escorts; the publication does not state their positions or price.',
    },
    SUPERLOAD,
  ),
];

export const ALABAMA_OSOW_RULES: JurisdictionOsowRules = {
  code: 'AL',
  name: 'Alabama',
  country: 'US',
  legalLimits: {
    widthIn: [fromSource(ftIn(8, 6), RULES_PRESENTATION)],
    heightIn: [fromSource(ftIn(13, 6), RULES_PRESENTATION)],
    trailerLengthIn: [fromSource(ftIn(57), RULES_PRESENTATION)],
    frontOverhangIn: [fromSource(ftIn(5), RULES_PRESENTATION)],
    rearOverhangIn: [fromSource(ftIn(5), RULES_PRESENTATION)],
    grossWeightLbs: [],
    singleAxleLbs: [],
    tandemAxleLbs: [],
  },
  permitBaseFeeUsd: [],
  overweightBands: [],
  conditionalFees: [],
  transactionFee: [],
  routeAnalysisFeeUsd: [],
  noBridgeRouteFeeUsd: [],
  superload: {
    grossWeight: [fromSource({ value: 300_000, inclusive: false }, SUPERLOAD)],
    shortSpacing: [],
  },
  routeInspection: {
    widthIn: [fromSource({ value: ftIn(16), inclusive: false }, SUPERLOAD)],
    heightIn: [fromSource({ value: ftIn(16), inclusive: false }, SUPERLOAD)],
    lengthIn: [fromSource({ value: ftIn(150), inclusive: false }, SUPERLOAD)],
  },
  escortRules: ALABAMA_ESCORT_RULES,
  feesDependOnDistance: false,
};
