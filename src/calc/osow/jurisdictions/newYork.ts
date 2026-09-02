/**
 * NEW YORK — official statutory limits, superload definition, and escorts.
 *
 * The statute itself publishes route-dependent width and trailer-length
 * limits. Both official values are retained so a route-unaware quote resolves
 * to a conflict instead of silently choosing the more permissive number.
 */
import { ftIn, type EscortRule } from '../escortRules.js';
import type { JurisdictionOsowRules } from '../types.js';
import { escortDates, fromSource, type EvidenceSourceDoc } from './evidence.js';

const RETRIEVED = '2026-09-02';

// ── Source documents ──────────────────────────────────────────────────────

const VAT_385: EvidenceSourceDoc = {
  id: 'ny-vat-385-2022-03-25',
  title: 'New York Vehicle and Traffic Law § 385 — Dimensions and weights of vehicles',
  url: 'https://www.nysenate.gov/legislation/laws/VAT/385',
  publisher: 'New York State Senate',
  revisedOn: '2022-03-25',
  retrievedOn: RETRIEVED,
  cite: 'subdivisions 1, 2, 3, 8, and 10',
  quote: 'The width of a vehicle, inclusive of load, shall be not more than ninety-six inches plus safety devices, except that the maximum width of a vehicle, inclusive of load, shall be one hundred two inches, plus safety devices, on any qualifying or access highway. The height of a vehicle from under side of tire to top of vehicle, inclusive of load, shall be not more than thirteen and one-half feet. The length of a semitrailer or trailer shall not exceed forty-eight feet provided, however, that the length of any trailer or semitrailer being operated in combination with another trailer or semitrailer shall not exceed twenty-eight and one-half feet. Except in any city not wholly included within one county, any semitrailer with a length in excess of forty-eight feet, but not exceeding fifty-three feet, may be operated on any qualifying highway or specifically designated access highway if the distance between the kingpin of the semitrailer and the centerline of the rear axle does not exceed forty-three feet. The weight on any one axle of a single vehicle or a combination of vehicles, equipped with pneumatic tires, when loaded, shall be not more than twenty-two thousand four hundred pounds. In no case, however, shall the total weight exceed eighty thousand pounds except for a vehicle if operated by an engine fueled primarily by natural gas which may have a maximum gross weight of up to eighty-two thousand pounds.',
};

const SUPERLOAD: EvidenceSourceDoc = {
  id: 'nydot-superloads',
  title: 'New York State Department of Transportation — Superloads',
  url: 'https://www.dot.ny.gov/nypermits/superloads',
  publisher: 'New York State Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  quote: 'A superload is defined as any vehicle or combination of vehicles which exceed 16 feet in width; or 16 feet in height or greater; or greater than 160 feet in length; or 200,000 pounds or greater in gross weight; or a combination of the above. Due to the extreme size and weight of these vehicles, these permits require a more intensive review process and additional documentation is required. A bond must be submitted to the Department as well.',
};

const ESCORT_MANUAL: EvidenceSourceDoc = {
  id: 'ny-certified-escort-manual-2025',
  title: 'New York State Certified Escort Manual — 2025',
  url: 'https://www.dot.ny.gov/portal/page/portal/nypermits/repository/Vehicle%20Escort%20Manual_Final_2025.pdf',
  publisher: 'New York State Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'cover states 2025 without a complete revision date; pp. 21–22',
  documentRevisionText: '2025',
  quote: 'A front escort vehicle will be required for travel on all two-lane highways when the vehicle/load exceeds 12 feet wide, and/or 80 feet long or greater and/or height of 14 feet or greater, or where the overhang is greater than 10 feet. For overheight vehicles with a width of 12 feet wide or less the front escort must be equipped with a height pole which is 3 inches higher than the overall height of the permitted vehicle/load. For overheight vehicles with a width greater than 12 feet the front escort must be equipped with a height pole that is 6 inches higher than the overall height of the permitted vehicle/load. A rear escort vehicle is required for travel on highways of more than two lanes when vehicle/load is greater than 12 feet wide, 80 feet long or greater, or if the vehicle is a slow moving vehicle, or bridge speed restrictions are required, or where the overhang is greater than 10 feet. Three escort vehicles (two front, one rear) are required for travel whenever the vehicle/load is over 16 feet wide on two-lane highways, 18 feet wide or greater on four-lane highways, or 100 feet long or greater on two-lane highways, 160 feet long or greater on four-lane highways. If the vehicle/load is 160 feet long or greater and is traveling only on interstate highways, only two escorts will be required.',
};

const TWO_LANE_BASE = {
  kind: 'routeClass' as const,
  anyOf: ['two-lane' as const],
};
const MULTILANE_BASE = {
  kind: 'routeClass' as const,
  anyOf: ['interstate' as const, 'divided' as const],
};

// ── Escort rules ──────────────────────────────────────────────────────────

export const NEW_YORK_ESCORT_RULES: EscortRule[] = [
  ...(['widthIn', 'overallLengthIn', 'heightIn'] as const).flatMap((measure) => {
    const limit = measure === 'widthIn' ? ftIn(12) : measure === 'heightIn' ? ftIn(14) : ftIn(80);
    const comparator = measure === 'widthIn' ? 'gt' as const : 'gte' as const;
    return [
      {
        id: `ny-${measure}-two-lane-front`,
        jurisdiction: 'NY',
        description: `New York two-lane escort threshold for ${measure}.`,
        when: { kind: 'all' as const, of: [{ kind: comparator, measure, value: limit }, TWO_LANE_BASE] },
        then: { front: 1, ...(measure === 'heightIn' ? { heightPole: true } : {}) },
        source: ESCORT_MANUAL,
        ...escortDates(ESCORT_MANUAL),
      },
      {
        id: `ny-${measure}-multilane-rear`,
        jurisdiction: 'NY',
        description: `New York multilane escort threshold for ${measure}.`,
        when: { kind: 'all' as const, of: [{ kind: comparator, measure, value: limit }, MULTILANE_BASE] },
        then: { rear: 1 },
        source: ESCORT_MANUAL,
        ...escortDates(ESCORT_MANUAL),
      },
    ];
  }),
  {
    id: 'ny-overhang-over-10-two-lane-front',
    jurisdiction: 'NY',
    description: 'Overhang over 10 feet requires a front escort on a two-lane highway.',
    when: {
      kind: 'all',
      of: [
        {
          kind: 'any',
          of: [
            { kind: 'gt', measure: 'frontOverhangIn', value: ftIn(10) },
            { kind: 'gt', measure: 'rearOverhangIn', value: ftIn(10) },
          ],
        },
        TWO_LANE_BASE,
      ],
    },
    then: { front: 1 },
    source: ESCORT_MANUAL,
    ...escortDates(ESCORT_MANUAL),
  },
  {
    id: 'ny-overhang-over-10-multilane-rear',
    jurisdiction: 'NY',
    description: 'Overhang over 10 feet requires a rear escort on a highway of more than two lanes.',
    when: {
      kind: 'all',
      of: [
        {
          kind: 'any',
          of: [
            { kind: 'gt', measure: 'frontOverhangIn', value: ftIn(10) },
            { kind: 'gt', measure: 'rearOverhangIn', value: ftIn(10) },
          ],
        },
        MULTILANE_BASE,
      ],
    },
    then: { rear: 1 },
    source: ESCORT_MANUAL,
    ...escortDates(ESCORT_MANUAL),
  },
  {
    id: 'ny-three-escorts-two-lane',
    jurisdiction: 'NY',
    description: 'Two-lane travel requires two front and one rear escort above the published width or length trigger.',
    when: {
      kind: 'all',
      of: [
        TWO_LANE_BASE,
        {
          kind: 'any',
          of: [
            { kind: 'gt', measure: 'widthIn', value: ftIn(16) },
            { kind: 'gte', measure: 'overallLengthIn', value: ftIn(100) },
          ],
        },
      ],
    },
    then: { front: 2, rear: 1 },
    source: ESCORT_MANUAL,
    ...escortDates(ESCORT_MANUAL),
  },
  {
    id: 'ny-three-escorts-four-lane',
    jurisdiction: 'NY',
    description: 'Four-lane travel requires two front and one rear escort above the published width or length trigger.',
    when: {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: ['divided'] },
        {
          kind: 'any',
          of: [
            { kind: 'gte', measure: 'widthIn', value: ftIn(18) },
            { kind: 'gte', measure: 'overallLengthIn', value: ftIn(160) },
          ],
        },
      ],
    },
    then: { front: 2, rear: 1 },
    source: ESCORT_MANUAL,
    ...escortDates(ESCORT_MANUAL),
  },
  {
    id: 'ny-interstate-length-160-two-escorts',
    jurisdiction: 'NY',
    description: 'A load at least 160 feet long traveling only on interstates requires two escorts.',
    when: {
      kind: 'all',
      of: [
        { kind: 'routeClass', anyOf: ['interstate'] },
        { kind: 'gte', measure: 'overallLengthIn', value: ftIn(160) },
      ],
    },
    then: { escorts: 2 },
    source: ESCORT_MANUAL,
    ...escortDates(ESCORT_MANUAL),
  },
];

export const NEW_YORK_OSOW_RULES: JurisdictionOsowRules = {
  code: 'NY',
  name: 'New York',
  country: 'US',
  legalLimits: {
    widthIn: [
      fromSource(96, VAT_385, 'General highway limit.'),
      fromSource(102, VAT_385, 'Qualifying or access highway limit.'),
    ],
    heightIn: [fromSource(ftIn(13, 6), VAT_385)],
    trailerLengthIn: [
      fromSource(ftIn(48), VAT_385, 'General trailer limit.'),
      fromSource(ftIn(53), VAT_385, 'Qualifying or specifically designated access highway limit.'),
    ],
    frontOverhangIn: [],
    rearOverhangIn: [],
    grossWeightLbs: [fromSource(80_000, VAT_385)],
    singleAxleLbs: [fromSource(22_400, VAT_385)],
    tandemAxleLbs: [],
  },
  permitBaseFeeUsd: [],
  overweightBands: [],
  conditionalFees: [],
  transactionFee: [],
  routeAnalysisFeeUsd: [],
  noBridgeRouteFeeUsd: [],
  superload: {
    grossWeight: [fromSource({ value: 200_000, inclusive: true }, SUPERLOAD)],
    shortSpacing: [],
  },
  routeInspection: { widthIn: [], heightIn: [], lengthIn: [] },
  escortRules: NEW_YORK_ESCORT_RULES,
  feesDependOnDistance: false,
};
