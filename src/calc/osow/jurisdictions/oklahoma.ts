/**
 * OKLAHOMA — official ODOT size, axle-weight, and permit-fee publications.
 *
 * The overweight fee is incremental per thousand pounds and cannot be stored
 * as a fixed weight band. Only the unambiguous oversize base is encoded.
 */
import { ftIn } from '../escortRules.js';
import type { JurisdictionOsowRules } from '../types.js';
import { fromSource, type EvidenceSourceDoc } from './evidence.js';

const RETRIEVED = '2026-09-02';

// ── Source documents ──────────────────────────────────────────────────────

const ODOT_LIMITS: EvidenceSourceDoc = {
  id: 'ok-odot-size-weight-permits',
  title: 'Oklahoma Department of Transportation — Size and Weight Permits',
  url: 'https://oklahoma.gov/odot/about-us/laws-and-rules/size-and-weight-permits.html',
  publisher: 'Oklahoma Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  quote: 'Anything over 13-6 high, 8-6 wide and length varies with type of vehicle.',
};

const AXLE_LIMITS: EvidenceSourceDoc = {
  id: 'ok-odot-axle-weight-limits',
  title: 'Oklahoma Department of Transportation — Axle Weight Limits',
  url: 'https://oklahoma.gov/content/dam/ok/en/odot/about-us/laws-rules/size-and-weight-permits/size-weight-restrictions/axle-weight-limits.pdf',
  publisher: 'Oklahoma Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  quote: 'Single Axle weight limit is 20,000 lbs or 21,600 lbs with Variance Permit. If any weight category is exceeded, it violates the Variance Permit for that trip.',
};

const PERMIT_FEES: EvidenceSourceDoc = {
  id: 'ok-odot-permit-fees',
  title: 'Oklahoma Department of Transportation — Permit Fees',
  url: 'https://oklahoma.gov/content/dam/ok/en/odot/about-us/laws-rules/size-and-weight-permits/permit-fees.pdf',
  publisher: 'Oklahoma Department of Transportation',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'single trip/monthly fee schedule',
  quote: 'Permit Fees (a) Single trip/monthly 1. Oversize $40.00 2. Overweight $40.00 (Plus $10 for each 1,000 lb. when load exceeds legal load limit) 3. Oversize & Overweight $80.00 (Plus $10 for each 1,000 lb. when load exceeds legal load limit)',
};

export const OKLAHOMA_OSOW_RULES: JurisdictionOsowRules = {
  code: 'OK',
  name: 'Oklahoma',
  country: 'US',
  legalLimits: {
    widthIn: [fromSource(ftIn(8, 6), ODOT_LIMITS)],
    heightIn: [fromSource(ftIn(13, 6), ODOT_LIMITS)],
    trailerLengthIn: [],
    frontOverhangIn: [],
    rearOverhangIn: [],
    grossWeightLbs: [],
    singleAxleLbs: [fromSource(20_000, AXLE_LIMITS)],
    tandemAxleLbs: [],
  },
  permitBaseFeeUsd: [fromSource(40, PERMIT_FEES, 'Single-trip oversize permit.')],
  overweightBands: [],
  conditionalFees: [],
  transactionFee: [],
  routeAnalysisFeeUsd: [],
  noBridgeRouteFeeUsd: [],
  superload: { grossWeight: [], shortSpacing: [] },
  routeInspection: { widthIn: [], heightIn: [], lengthIn: [] },
  escortRules: [],
  feesDependOnDistance: false,
};
