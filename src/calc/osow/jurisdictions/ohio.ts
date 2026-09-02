/**
 * OHIO — official OS/OW limits and review triggers.
 *
 * Empty lists are deliberate. Ohio publishes several fees as conditional
 * schedules that this model cannot represent without changing their meaning;
 * those fields must resolve to manual review rather than a plausible guess.
 */
import { ftIn, type EscortRule } from '../escortRules.js';
import type { JurisdictionOsowRules } from '../types.js';
import { escortDates, fromSource, type EvidenceSourceDoc } from './evidence.js';

const RETRIEVED = '2026-09-02';

// ── Source documents ──────────────────────────────────────────────────────

const ORC_5577_05: EvidenceSourceDoc = {
  id: 'oh-orc-5577-05',
  title: 'Ohio Revised Code § 5577.05 — Prohibition against violating maximum width, height, or length limitations',
  url: 'https://codes.ohio.gov/ohio-revised-code/section-5577.05',
  publisher: 'Ohio Laws and Administrative Rules',
  revisedOn: '2013-07-01',
  retrievedOn: RETRIEVED,
  cite: 'divisions (A)(2), (B), and (D)(1)(b)',
  quote: 'One hundred two inches, including load, for all other vehicles, except that the director may prohibit the operation of one hundred two-inch vehicles on such state highways or portions of state highways as the director designates. No such vehicle shall have a height in excess of thirteen feet six inches, with or without load. Fifty-three feet for any semitrailer when operated in a commercial tractor-semitrailer combination, with or without load, except that the director may prohibit the operation of any such commercial tractor-semitrailer combination on such state highways or portions of state highways as the director designates.',
};

const ORC_5577_04: EvidenceSourceDoc = {
  id: 'oh-orc-5577-04',
  title: 'Ohio Revised Code § 5577.04 — Maximum axle load, wheel load, and gross weights',
  url: 'https://codes.ohio.gov/ohio-revised-code/section-5577.04',
  publisher: 'Ohio Laws and Administrative Rules',
  revisedOn: '2001-06-29',
  retrievedOn: RETRIEVED,
  cite: 'divisions (A)(1), (A)(2), and (E)',
  quote: 'On any one axle, twenty thousand pounds; On any tandem axle, thirty-four thousand pounds; Notwithstanding divisions (B) and (D) of this section, the maximum overall gross weight of vehicle and load imposed upon the road surface shall not exceed eighty thousand pounds.',
};

const ADMIN_FEE: EvidenceSourceDoc = {
  id: 'oh-oac-5501-2-1-05',
  title: 'Ohio Administrative Code Rule 5501:2-1-05 — Fees',
  url: 'https://codes.ohio.gov/ohio-administrative-code/rule-5501%3A2-1-05',
  publisher: 'Ohio Laws and Administrative Rules',
  revisedOn: '2023-11-03',
  retrievedOn: RETRIEVED,
  cite: 'paragraph (A)',
  quote: 'All permit application processing fees consist of the basic processing charge of twenty dollars plus each unit of surcharge that is applicable to that movement.',
};

const OPERATIONAL_GUIDE: EvidenceSourceDoc = {
  id: 'oh-odot-operational-guide',
  title: 'Ohio Department of Transportation — Operational Guide for Vehicles Operating with an Oversize/Overweight Special Hauling Permit',
  url: 'https://www.transportation.ohio.gov/business/publications/operational-guide-special-hauling',
  publisher: 'Ohio Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'definitions and escort requirements',
  quote: "Superload - any vehicle or combination or load having a gross weight in excess of 120,000 lbs., axle or group weights in excess of limits set forth in Section 9 of this Guide, overall width in excess of 14'-0\" or overall height in excess of 14'-6\". Law enforcement escort shall be required, in addition to private escorts, on any vehicle or vehicle/load with an overall width in excess of 16 feet",
};

const OS_1A: EvidenceSourceDoc = {
  id: 'oh-odot-os-1a-2018-01',
  title: 'Ohio Department of Transportation — OS-1A Limitations and Provisions on the Use of Special Hauling Permits',
  url: 'https://dam.assets.ohio.gov/image/upload/q_auto/v1751025885/transportation.ohio.gov/permits/special-hauling/os-1a.pdf',
  publisher: 'Ohio Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'escort vehicles, items 1–5; source states “January 2018” without a day',
  documentRevisionText: 'January 2018',
  quote: 'One rear escort vehicle shall be required for the transportation of any vehicle/load with a permitted length in excess of 90 feet. One lead (rear on multiple lane highways) escort vehicle shall be required for the transportation of any vehicle/load with a permitted width in excess of 13 feet. One lead escort vehicle equipped with a height sensing device shall be required for the transportation of any vehicle/load with a permitted height in excess of 14 feet 6 inches. One lead and one rear escort shall be required on any vehicle/load with a permitted width in excess of 14 feet 6 inches, or on any vehicle/load with a permitted height in excess of 14 feet 10 inches. If more than one of the conditions set forth in numbers 2 through 4 above are met, (for example, a load with a permitted width exceeding 13 feet and a permitted length exceeding 90 feet ) two escorts (one lead and one rear) shall be required.',
};

// ── Escort rules ──────────────────────────────────────────────────────────

export const OHIO_ESCORT_RULES: EscortRule[] = [
  {
    id: 'oh-length-over-90-rear',
    jurisdiction: 'OH',
    description: 'A permitted load over 90 feet long requires one rear escort.',
    when: { kind: 'gt', measure: 'overallLengthIn', value: ftIn(90) },
    then: { rear: 1 },
    source: OS_1A,
    ...escortDates(OS_1A),
  },
  {
    id: 'oh-width-over-13-two-lane-front',
    jurisdiction: 'OH',
    description: 'A load over 13 feet wide uses a lead escort on a two-lane road.',
    when: {
      kind: 'all',
      of: [
        { kind: 'gt', measure: 'widthIn', value: ftIn(13) },
        { kind: 'routeClass', anyOf: ['two-lane'] },
      ],
    },
    then: { front: 1 },
    source: OS_1A,
    ...escortDates(OS_1A),
  },
  {
    id: 'oh-width-over-13-multilane-rear',
    jurisdiction: 'OH',
    description: 'A load over 13 feet wide uses a rear escort on a multilane highway.',
    when: {
      kind: 'all',
      of: [
        { kind: 'gt', measure: 'widthIn', value: ftIn(13) },
        { kind: 'routeClass', anyOf: ['interstate', 'divided'] },
      ],
    },
    then: { rear: 1 },
    source: OS_1A,
    ...escortDates(OS_1A),
  },
  {
    id: 'oh-height-over-14-6-front-pole',
    jurisdiction: 'OH',
    description: 'A load over 14 feet 6 inches high requires a lead height-sensing escort.',
    when: { kind: 'gt', measure: 'heightIn', value: ftIn(14, 6) },
    then: { front: 1, heightPole: true },
    source: OS_1A,
    ...escortDates(OS_1A),
  },
  {
    id: 'oh-width-over-14-6-two-escorts',
    jurisdiction: 'OH',
    description: 'A load over 14 feet 6 inches wide requires a lead and rear escort.',
    when: { kind: 'gt', measure: 'widthIn', value: ftIn(14, 6) },
    then: { front: 1, rear: 1 },
    source: OS_1A,
    ...escortDates(OS_1A),
  },
  {
    id: 'oh-height-over-14-10-two-escorts',
    jurisdiction: 'OH',
    description: 'A load over 14 feet 10 inches high requires a lead and rear escort.',
    when: { kind: 'gt', measure: 'heightIn', value: ftIn(14, 10) },
    then: { front: 1, rear: 1, heightPole: true },
    source: OS_1A,
    ...escortDates(OS_1A),
  },
  {
    id: 'oh-multiple-dimensional-escort-conditions',
    jurisdiction: 'OH',
    description: 'Meeting more than one of Ohio’s width, height, or two-escort dimensional conditions requires a lead and rear escort.',
    when: {
      kind: 'atLeast',
      count: 2,
      of: [
        { kind: 'gt', measure: 'widthIn', value: ftIn(13) },
        { kind: 'gt', measure: 'heightIn', value: ftIn(14, 6) },
        {
          kind: 'any',
          of: [
            { kind: 'gt', measure: 'widthIn', value: ftIn(14, 6) },
            { kind: 'gt', measure: 'heightIn', value: ftIn(14, 10) },
          ],
        },
      ],
    },
    then: { front: 1, rear: 1 },
    source: OS_1A,
    ...escortDates(OS_1A),
  },
  {
    id: 'oh-width-and-length-example-two-escorts',
    jurisdiction: 'OH',
    description: 'Ohio’s published example requires lead and rear escorts when a load is both over 13 feet wide and over 90 feet long.',
    when: {
      kind: 'all',
      of: [
        { kind: 'gt', measure: 'widthIn', value: ftIn(13) },
        { kind: 'gt', measure: 'overallLengthIn', value: ftIn(90) },
      ],
    },
    then: { front: 1, rear: 1 },
    source: OS_1A,
    ...escortDates(OS_1A),
  },
  {
    id: 'oh-width-over-16-law-enforcement',
    jurisdiction: 'OH',
    description: 'A load over 16 feet wide additionally requires law-enforcement escort.',
    when: { kind: 'gt', measure: 'widthIn', value: ftIn(16) },
    then: {
      manualReview: 'Ohio requires law-enforcement escort but the published rule does not specify its position or agency price.',
    },
    source: OPERATIONAL_GUIDE,
    ...escortDates(OPERATIONAL_GUIDE),
  },
];

export const OHIO_OSOW_RULES: JurisdictionOsowRules = {
  code: 'OH',
  name: 'Ohio',
  country: 'US',
  legalLimits: {
    widthIn: [fromSource(102, ORC_5577_05)],
    heightIn: [fromSource(ftIn(13, 6), ORC_5577_05)],
    trailerLengthIn: [fromSource(ftIn(53), ORC_5577_05)],
    frontOverhangIn: [],
    rearOverhangIn: [],
    grossWeightLbs: [fromSource(80_000, ORC_5577_04)],
    singleAxleLbs: [fromSource(20_000, ORC_5577_04)],
    tandemAxleLbs: [fromSource(34_000, ORC_5577_04)],
  },
  permitBaseFeeUsd: [fromSource(20, ADMIN_FEE)],
  overweightBands: [],
  conditionalFees: [],
  transactionFee: [],
  routeAnalysisFeeUsd: [],
  noBridgeRouteFeeUsd: [],
  superload: {
    grossWeight: [
      fromSource({ value: 120_000, inclusive: false }, OPERATIONAL_GUIDE),
    ],
    shortSpacing: [],
  },
  routeInspection: { widthIn: [], heightIn: [], lengthIn: [] },
  escortRules: OHIO_ESCORT_RULES,
  feesDependOnDistance: true,
};
