/**
 * INDIANA — official Motor Carrier Services limits and permit triggers.
 *
 * The published permit schedule uses weight-dependent per-mile rates. Those
 * rates cannot be stored as a flat surcharge, so only the separately stated
 * executive fee is encoded and mileage-dependent pricing stays on review.
 */
import { ftIn } from '../escortRules.js';
import type { JurisdictionOsowRules } from '../types.js';
import { fromSource, type EvidenceSourceDoc } from './evidence.js';

const RETRIEVED = '2026-09-02';

// ── Source documents ──────────────────────────────────────────────────────

const DOR_LIMITS: EvidenceSourceDoc = {
  id: 'in-dor-osow',
  title: 'Indiana Department of Revenue — Oversize/Overweight',
  url: 'https://www.in.gov/dor/motor-carrier-services/oversizeoverweight-osw/',
  publisher: 'Indiana Department of Revenue',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  quote: 'Indiana law states that drivers must obtain an oversize and/or overweight (OSOW) vehicle permit before traveling on Indiana roads if their vehicle exceeds: 13 feet, 6 inches in height; 8 feet, 6 inches in width; 53 feet (semi-tractor-semi-trailer combination) in length; or 80,000 pounds gross vehicle weight (subject to axle weights)',
};

const FEE_SCHEDULE: EvidenceSourceDoc = {
  id: 'in-dor-osow-fees-2026-07',
  title: 'Indiana Department of Revenue — Oversize/Overweight Vehicle Permit Fees (last revised July 2026)',
  url: 'https://www.in.gov/dor/motor-carrier-services/files/osow-vehicle-permit-fees.pdf',
  publisher: 'Indiana Department of Revenue',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'document states only “Last Revised: July 2026”; no day is supplied',
  documentRevisionText: 'Last Revised: July 2026',
  quote: 'Vehicles over 120,000 lbs. are charged a $10.00 executive fee. A super load permit is a permit for a load that exceeds any of the following: • 15 feet high • 17 feet wide • 110 feet long • 200,000 lbs.',
};

export const INDIANA_OSOW_RULES: JurisdictionOsowRules = {
  code: 'IN',
  name: 'Indiana',
  country: 'US',
  legalLimits: {
    widthIn: [fromSource(ftIn(8, 6), DOR_LIMITS)],
    heightIn: [fromSource(ftIn(13, 6), DOR_LIMITS)],
    trailerLengthIn: [fromSource(ftIn(53), DOR_LIMITS)],
    frontOverhangIn: [],
    rearOverhangIn: [],
    grossWeightLbs: [fromSource(80_000, DOR_LIMITS)],
    singleAxleLbs: [],
    tandemAxleLbs: [],
  },
  permitBaseFeeUsd: [],
  overweightBands: [],
  conditionalFees: [
    fromSource(
      { appliesAbove: { value: 120_000, inclusive: false }, feeUsd: 10 },
      FEE_SCHEDULE,
    ),
  ],
  transactionFee: [],
  routeAnalysisFeeUsd: [],
  noBridgeRouteFeeUsd: [],
  superload: {
    grossWeight: [fromSource({ value: 200_000, inclusive: false }, FEE_SCHEDULE)],
    shortSpacing: [],
  },
  routeInspection: { widthIn: [], heightIn: [], lengthIn: [] },
  escortRules: [],
  feesDependOnDistance: true,
};
