/**
 * GEORGIA — official DPS/MCCD limits and Secretary of State rules.
 *
 * The administrative rule contains two different superload weight phrasings.
 * Both are retained; the conflict resolver, not this file, decides whether a
 * value can safely be used.
 */
import { ftIn, type EscortRule } from '../escortRules.js';
import type { JurisdictionOsowRules } from '../types.js';
import { escortDates, fromSource, type EvidenceSourceDoc } from './evidence.js';

const RETRIEVED = '2026-09-02';

// ── Source documents ──────────────────────────────────────────────────────

const DPS_LIMITS: EvidenceSourceDoc = {
  id: 'ga-dps-mccd-osow-laws',
  title: 'Georgia Department of Public Safety MCCD — Oversize Permit Laws',
  url: 'https://gamccd.net/ospermit/Laws.aspx',
  publisher: 'Georgia Department of Public Safety, Motor Carrier Compliance Division',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  quote: 'Overall Legal Dimensions Width 8’ 6" Height 13’ 6" Length 100 ft. (including overhang) Weight 80,000 lbs. gross weight. Length The standard trailer unit in Georgia is 53 feet. Legal axle weight is 20,340 pounds. Tandem axle is any two or more axles within 96 inches. If gross weight is less than 73,280 pounds and length is greater than 55 feet, the tandem weight is 40,680 pounds. If gross weight is greater than 73,280 pounds or length is greater than 55 feet, the tandem weight limit is 34,000 pounds.',
};

const ADMIN_RULES: EvidenceSourceDoc = {
  id: 'ga-rules-672-2',
  title: 'Georgia Rules and Regulations Chapter 672-2 — Governing Permits for Vehicles or Loads of Excess Weight or Dimension',
  url: 'https://rules.sos.ga.gov/gac/672-2',
  publisher: 'Georgia Secretary of State',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'Rule 672-2-.01(k) and escort provisions',
  quote: "Superload: A non-divisible load exceeding a width or height of 16' and/or a gross vehicle weight exceeding 150,001 pounds up to a gross vehicle weight of 180,000 pounds. Axle weights and spacing are not required for superloads with dimensions only. However, once the gross vehicle weight exceeds 150,000 pounds, axle weights and spacings are required. For any permitted load whose length exceeds 75' but is less than or equal to 100', a Rear Escort/Amber Light is required. For any permitted load whose length exceeds 100' but is less than or equal to 125', a Vehicle Rear Escort is required. For any permitted load whose length is greater than 125', a Vehicle Front and Vehicle Rear Escort is required. For any permitted load whose height is fifteen feet six inches (15'6\") or greater, a Vehicle Front Escort with a Height Sensor is required unless the applicant has a valid trip approval ticket from NJUNS. For any permitted load whose width exceeds twelve feet (12') but is less than or equal to fourteen feet eight inches (14'8\"), a Vehicle Front Escort is required on a two-lane highway and a Vehicle Rear Escort is required on a four-lane or limited access highway. For any permitted load whose width exceeds fourteen feet eight inches (14'8\") up to sixteen feet (16'), a Vehicle Front and Vehicle Rear Escort is required on a two-lane highway and a Vehicle Rear Escort is required on a four-lane or limited access highway. Loads whose width exceeds sixteen feet (16') shall be reviewed on a case by case basis.",
};

function gaRule(
  id: string,
  description: string,
  when: EscortRule['when'],
  then: EscortRule['then'],
): EscortRule {
  return {
    id,
    jurisdiction: 'GA',
    description,
    when,
    then,
    source: ADMIN_RULES,
    ...escortDates(ADMIN_RULES),
  };
}

// ── Escort rules ──────────────────────────────────────────────────────────

export const GEORGIA_ESCORT_RULES: EscortRule[] = [
  gaRule('ga-length-75-to-125-rear', 'Loads over 75 through 125 feet long require a rear escort.', { kind: 'between', measure: 'overallLengthIn', min: ftIn(75), max: ftIn(125), minInclusive: false }, { rear: 1 }),
  gaRule('ga-length-over-125-front-rear', 'Loads over 125 feet long require front and rear escorts.', { kind: 'gt', measure: 'overallLengthIn', value: ftIn(125) }, { front: 1, rear: 1 }),
  gaRule(
    'ga-height-15-6-front-pole-without-njuns',
    'Loads at least 15 feet 6 inches high require a front height-sensor escort unless a valid NJUNS approval applies.',
    {
      kind: 'all',
      of: [
        { kind: 'gte', measure: 'heightIn', value: ftIn(15, 6) },
        {
          kind: 'not',
          of: {
            kind: 'subjective',
            key: 'hasValidNjunsTripApproval',
            question: 'Does this move have a valid NJUNS trip approval ticket for the overheight route?',
          },
        },
      ],
    },
    { front: 1, heightPole: true },
  ),
  gaRule('ga-width-12-to-14-8-two-lane', 'Loads over 12 through 14 feet 8 inches wide require a front escort on two-lane highways.', { kind: 'all', of: [{ kind: 'between', measure: 'widthIn', min: ftIn(12), max: ftIn(14, 8), minInclusive: false }, { kind: 'routeClass', anyOf: ['two-lane'] }] }, { front: 1 }),
  gaRule('ga-width-12-to-14-8-divided', 'Loads over 12 through 14 feet 8 inches wide require a rear escort on four-lane or limited-access highways.', { kind: 'all', of: [{ kind: 'between', measure: 'widthIn', min: ftIn(12), max: ftIn(14, 8), minInclusive: false }, { kind: 'routeClass', anyOf: ['interstate', 'divided'] }] }, { rear: 1 }),
  gaRule('ga-width-14-8-to-16-two-lane', 'Loads over 14 feet 8 inches through 16 feet wide require front and rear escorts on two-lane highways.', { kind: 'all', of: [{ kind: 'between', measure: 'widthIn', min: ftIn(14, 8), max: ftIn(16), minInclusive: false }, { kind: 'routeClass', anyOf: ['two-lane'] }] }, { front: 1, rear: 1 }),
  gaRule('ga-width-14-8-to-16-divided', 'Loads over 14 feet 8 inches through 16 feet wide require a rear escort on four-lane or limited-access highways.', { kind: 'all', of: [{ kind: 'between', measure: 'widthIn', min: ftIn(14, 8), max: ftIn(16), minInclusive: false }, { kind: 'routeClass', anyOf: ['interstate', 'divided'] }] }, { rear: 1 }),
  gaRule('ga-width-over-16-review', 'Loads over 16 feet wide are reviewed case by case.', { kind: 'gt', measure: 'widthIn', value: ftIn(16) }, { manualReview: 'Georgia reviews escort requirements over 16 feet wide case by case.' }),
];

export const GEORGIA_OSOW_RULES: JurisdictionOsowRules = {
  code: 'GA',
  name: 'Georgia',
  country: 'US',
  legalLimits: {
    widthIn: [fromSource(ftIn(8, 6), DPS_LIMITS)],
    heightIn: [fromSource(ftIn(13, 6), DPS_LIMITS)],
    trailerLengthIn: [fromSource(ftIn(53), DPS_LIMITS)],
    frontOverhangIn: [],
    rearOverhangIn: [],
    grossWeightLbs: [fromSource(80_000, DPS_LIMITS)],
    singleAxleLbs: [fromSource(20_340, DPS_LIMITS)],
    tandemAxleLbs: [],
  },
  permitBaseFeeUsd: [],
  overweightBands: [],
  conditionalFees: [],
  transactionFee: [],
  routeAnalysisFeeUsd: [],
  noBridgeRouteFeeUsd: [],
  superload: {
    grossWeight: [
      fromSource({ value: 150_001, inclusive: false }, ADMIN_RULES, 'Superload definition wording.'),
      fromSource({ value: 150_000, inclusive: false }, ADMIN_RULES, 'Axle-data trigger wording in the same official rule.'),
    ],
    shortSpacing: [],
  },
  routeInspection: { widthIn: [], heightIn: [], lengthIn: [] },
  escortRules: GEORGIA_ESCORT_RULES,
  feesDependOnDistance: false,
};
