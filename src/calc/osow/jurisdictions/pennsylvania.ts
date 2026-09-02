/**
 * PENNSYLVANIA — official statutory legal limits.
 *
 * Permit fees and operational thresholds remain empty until an official,
 * current publication supplies values that fit the engine's exact semantics.
 */
import { ftIn } from '../escortRules.js';
import type { JurisdictionOsowRules } from '../types.js';
import { fromSource, type EvidenceSourceDoc } from './evidence.js';

const RETRIEVED = '2026-09-02';

// ── Source documents ──────────────────────────────────────────────────────

const WIDTH: EvidenceSourceDoc = {
  id: 'pa-75-4921',
  title: '75 Pa.C.S. § 4921 — Width of vehicles',
  url: 'https://www.legis.state.pa.us/WU01/LI/LI/CT/HTM/75/00.049.021.000..HTM',
  publisher: 'Pennsylvania General Assembly',
  revisedOn: '2022-11-03',
  retrievedOn: RETRIEVED,
  cite: 'subsection (a)',
  quote: 'The total outside width of a vehicle, including any load, shall not exceed eight feet six inches except as otherwise provided in this section.',
};

const HEIGHT: EvidenceSourceDoc = {
  id: 'pa-75-4922',
  title: '75 Pa.C.S. § 4922 — Height of vehicles',
  url: 'https://www.legis.state.pa.us/WU01/LI/LI/CT/HTM/75/00.049.022.000..HTM',
  publisher: 'Pennsylvania General Assembly',
  revisedOn: '2008-11-26',
  retrievedOn: RETRIEVED,
  cite: 'subsection (a)',
  quote: 'No vehicle, including any load, shall exceed a height of 13 feet 6 inches. This provision shall not be construed to require public authorities to provide sufficient vertical clearance to permit the operation of such vehicles.',
};

const LENGTH: EvidenceSourceDoc = {
  id: 'pa-75-4923',
  title: '75 Pa.C.S. § 4923 — Length of vehicles',
  url: 'https://www.legis.state.pa.us/WU01/LI/LI/CT/HTM/75/00.049.023.000..HTM',
  publisher: 'Pennsylvania General Assembly',
  revisedOn: '2018-06-12',
  retrievedOn: RETRIEVED,
  cite: 'subsection (a)(1)',
  quote: 'The length of a single trailer being towed by a truck or truck tractor shall not exceed 53 feet. Truck or truck tractors towing trailers equipped with a kingpin shall not be operated when the distance between the kingpin and the center line of the rear axle or rear axle group exceeds 41 feet.',
};

const GROSS_WEIGHT: EvidenceSourceDoc = {
  id: 'pa-75-4941',
  title: '75 Pa.C.S. § 4941 — Maximum gross weight of vehicles',
  url: 'https://www.legis.state.pa.us/WU01/LI/LI/CT/HTM/75/00.049.041.000..HTM',
  publisher: 'Pennsylvania General Assembly',
  revisedOn: '2022-11-03',
  retrievedOn: RETRIEVED,
  cite: 'subsection (a)',
  quote: 'Except as provided for in subsection (d), no vehicle shall, when operated upon a highway, have a gross weight exceeding 80,000 pounds, and no combination driven upon a highway shall have a gross weight exceeding 80,000 pounds, or the applicable weight set as forth in subsection (b) or (c), whichever is less.',
};

export const PENNSYLVANIA_OSOW_RULES: JurisdictionOsowRules = {
  code: 'PA',
  name: 'Pennsylvania',
  country: 'US',
  legalLimits: {
    widthIn: [fromSource(ftIn(8, 6), WIDTH)],
    heightIn: [fromSource(ftIn(13, 6), HEIGHT)],
    trailerLengthIn: [fromSource(ftIn(53), LENGTH)],
    frontOverhangIn: [],
    rearOverhangIn: [],
    grossWeightLbs: [fromSource(80_000, GROSS_WEIGHT)],
    singleAxleLbs: [],
    tandemAxleLbs: [],
  },
  permitBaseFeeUsd: [],
  overweightBands: [],
  conditionalFees: [],
  transactionFee: [],
  routeAnalysisFeeUsd: [],
  noBridgeRouteFeeUsd: [],
  superload: { grossWeight: [], shortSpacing: [] },
  routeInspection: { widthIn: [], heightIn: [], lengthIn: [] },
  escortRules: [],
  feesDependOnDistance: true,
};
