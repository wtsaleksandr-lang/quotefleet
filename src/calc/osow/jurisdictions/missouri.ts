/**
 * MISSOURI — current MoDOT OS/OW FAQ data.
 *
 * MoDOT publishes route-dependent height and escort rules. Both legal-height
 * values remain on file; the resolver must not choose a route class for the
 * caller when the route has not supplied one.
 */
import { ftIn, type EscortRule } from '../escortRules.js';
import type { JurisdictionOsowRules } from '../types.js';
import { escortDates, fromSource, type EvidenceSourceDoc } from './evidence.js';

const RETRIEVED = '2026-09-02';

// ── Source documents ──────────────────────────────────────────────────────

const FAQ: EvidenceSourceDoc = {
  id: 'mo-modot-osow-faq',
  title: 'Missouri Department of Transportation — Oversize/Overweight Permit Frequently Asked Questions',
  url: 'https://www.modot.org/sites/default/files/documents/OSOWFAQ_0.pdf',
  publisher: 'Missouri Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'legal dimensions, fees, superloads, and escorts',
  quote: 'Width: 8 feet 6 inches on all Missouri highways. Height: 13 feet 6 inches on all Missouri highways. The exceptions are on interstates, the designated and primary highway system or within 10 air miles of these where the legal height is 14 feet. Weight: 80,000 lbs. (40 tons) on Missouri highways. Length: There is no overall length restriction for a tractor / semi-trailer combination on interstate and the designated highway system or within 10 air miles of these. However, in a tractor / semi-trailer combination, the trailer including load cannot exceed 53 feet. Single Trip – legal weight $15.00. Width: Over 16 feet / Height: Over 16 feet / Length: Over 150 feet overall length / Weight: Over 160,000 lbs. gross. For routine moves, no escort is required for loads up to and including 12’6” in width. One escort is required on the interstate and designated route system for loads over 12’6” to 14’ wide. This escort shall be in the rear on dual-lane, divided, or multi-lane pavement and in the front on two-lane pavement. One rear escort is required on the interstate and other divided highways for loads over 14’ and up to 16’ wide. One front and one rear escort required on all multi-lane undivided and two-lane highways. A rear escort is required when the vehicle and load length exceed 110’ for a combination unit on all highways except divided highways. A height detection vehicle is required to precede overheight loads exceeding 15’6”.',
};

function widthRouteRule(
  id: string,
  description: string,
  min: number,
  max: number,
  routeClasses: ('interstate' | 'divided' | 'two-lane' | 'urban')[],
  then: { front?: number; rear?: number },
): EscortRule {
  return {
    id,
    jurisdiction: 'MO',
    description,
    when: {
      kind: 'all',
      of: [
        { kind: 'between', measure: 'widthIn', min, max, minInclusive: false },
        { kind: 'routeClass', anyOf: routeClasses },
      ],
    },
    then,
    source: FAQ,
    ...escortDates(FAQ),
  };
}

export const MISSOURI_ESCORT_RULES: EscortRule[] = [
  widthRouteRule('mo-width-12-6-to-14-two-lane', 'Loads over 12 feet 6 inches through 14 feet wide use a front escort on two-lane pavement.', ftIn(12, 6), ftIn(14), ['two-lane'], { front: 1 }),
  widthRouteRule('mo-width-12-6-to-14-divided', 'Loads over 12 feet 6 inches through 14 feet wide use a rear escort on divided pavement.', ftIn(12, 6), ftIn(14), ['interstate', 'divided'], { rear: 1 }),
  widthRouteRule('mo-width-14-to-16-two-lane', 'Loads over 14 feet through 16 feet wide use front and rear escorts on two-lane pavement.', ftIn(14), ftIn(16), ['two-lane', 'urban'], { front: 1, rear: 1 }),
  widthRouteRule('mo-width-14-to-16-divided', 'Loads over 14 feet through 16 feet wide use a rear escort on divided highways.', ftIn(14), ftIn(16), ['interstate', 'divided'], { rear: 1 }),
  {
    id: 'mo-length-over-110-not-divided',
    jurisdiction: 'MO',
    description: 'A combination over 110 feet long requires a rear escort except on divided highways.',
    when: {
      kind: 'all',
      of: [
        { kind: 'gt', measure: 'overallLengthIn', value: ftIn(110) },
        { kind: 'routeClass', anyOf: ['two-lane', 'urban'] },
      ],
    },
    then: { rear: 1 },
    source: FAQ,
    ...escortDates(FAQ),
  },
  {
    id: 'mo-height-over-15-6-pole',
    jurisdiction: 'MO',
    description: 'A load over 15 feet 6 inches high requires a preceding height-detection vehicle.',
    when: { kind: 'gt', measure: 'heightIn', value: ftIn(15, 6) },
    then: { front: 1, heightPole: true },
    source: FAQ,
    ...escortDates(FAQ),
  },
];

export const MISSOURI_OSOW_RULES: JurisdictionOsowRules = {
  code: 'MO',
  name: 'Missouri',
  country: 'US',
  legalLimits: {
    widthIn: [fromSource(ftIn(8, 6), FAQ)],
    heightIn: [
      fromSource(ftIn(13, 6), FAQ, 'General Missouri highway limit.'),
      fromSource(ftIn(14), FAQ, 'Interstate, designated, and primary system exception.'),
    ],
    trailerLengthIn: [fromSource(ftIn(53), FAQ)],
    frontOverhangIn: [],
    rearOverhangIn: [],
    grossWeightLbs: [fromSource(80_000, FAQ)],
    singleAxleLbs: [],
    tandemAxleLbs: [],
  },
  permitBaseFeeUsd: [fromSource(15, FAQ, 'Single-trip, legal-weight permit.')],
  overweightBands: [],
  conditionalFees: [],
  transactionFee: [],
  routeAnalysisFeeUsd: [],
  noBridgeRouteFeeUsd: [],
  superload: {
    grossWeight: [fromSource({ value: 160_000, inclusive: false }, FAQ)],
    shortSpacing: [],
  },
  routeInspection: { widthIn: [], heightIn: [], lengthIn: [] },
  escortRules: MISSOURI_ESCORT_RULES,
  feesDependOnDistance: true,
};
