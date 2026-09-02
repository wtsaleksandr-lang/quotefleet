/**
 * ILLINOIS — official statutory legal limits.
 *
 * Illinois's permit fees and escort rules are intentionally left unknown:
 * no current official row was found that could be represented without
 * route- or configuration-dependent qualifications the model would erase.
 */
import { ftIn } from '../escortRules.js';
import type { JurisdictionOsowRules } from '../types.js';
import { fromSource, type EvidenceSourceDoc } from './evidence.js';

const RETRIEVED = '2026-09-02';

// ── Source documents ──────────────────────────────────────────────────────

const WIDTH: EvidenceSourceDoc = {
  id: 'il-625-ilcs-5-15-102',
  title: '625 ILCS 5/15-102 — Width of Vehicles',
  url: 'https://www.ilga.gov/Documents/legislation/ilcs/documents/062500050K15-102.htm',
  publisher: 'Illinois General Assembly',
  revisedOn: '2022-05-13',
  retrievedOn: RETRIEVED,
  cite: 'subsection (a)',
  quote: 'On Class III and non-designated State and local highways, the total outside width of any vehicle or load thereon shall not exceed 8 feet 6 inches.',
};

const HEIGHT: EvidenceSourceDoc = {
  id: 'il-625-ilcs-5-15-103',
  title: '625 ILCS 5/15-103 — Height of Vehicles',
  url: 'https://ilga.gov/documents/legislation/ilcs/documents/062500050K15-103.htm',
  publisher: 'Illinois General Assembly',
  revisedOn: '2002-01-01',
  retrievedOn: RETRIEVED,
  quote: 'The height of a vehicle from the under side of the tire to the top of the vehicle, inclusive of load, shall not exceed 13 feet, 6 inches on any highway in the State.',
};

const LENGTH: EvidenceSourceDoc = {
  id: 'il-625-ilcs-5-15-107',
  title: '625 ILCS 5/15-107 — Length of Vehicles',
  url: 'https://www.ilga.gov/Documents/legislation/ilcs/documents/062500050K15-107.htm',
  publisher: 'Illinois General Assembly',
  revisedOn: '2026-01-01',
  retrievedOn: RETRIEVED,
  cite: 'subsections (a) and (g)',
  quote: 'The length of a semitrailer, unladen or with load, in combination with a truck tractor may not exceed 53 feet. The load upon any vehicle operated alone, or the load upon the front vehicle of a combination of vehicles, shall not extend more than 3 feet beyond the front wheels of the vehicle or the front bumper of the vehicle if it is equipped with a front bumper.',
};

const WEIGHT: EvidenceSourceDoc = {
  id: 'il-625-ilcs-5-15-111',
  title: '625 ILCS 5/15-111 — Wheel and axle loads and gross weights',
  url: 'https://www.ilga.gov/Documents/legislation/ilcs/documents/062500050K15-111.htm',
  publisher: 'Illinois General Assembly',
  revisedOn: '2026-06-16',
  retrievedOn: RETRIEVED,
  cite: 'subsection (a)',
  quote: 'No vehicle or combination of vehicles with pneumatic tires may be operated, unladen or with load, when the total weight on the road surface exceeds the following: 20,000 pounds on a single axle; 34,000 pounds on a tandem axle with no axle within the tandem exceeding 20,000 pounds; 80,000 pounds gross weight for vehicle combinations of 5 or more axles; or a total weight on a group of 2 or more consecutive axles in excess of that weight produced by the application of the following formula.',
};

export const ILLINOIS_OSOW_RULES: JurisdictionOsowRules = {
  code: 'IL',
  name: 'Illinois',
  country: 'US',
  legalLimits: {
    widthIn: [fromSource(ftIn(8, 6), WIDTH)],
    heightIn: [fromSource(ftIn(13, 6), HEIGHT)],
    trailerLengthIn: [fromSource(ftIn(53), LENGTH)],
    frontOverhangIn: [fromSource(ftIn(3), LENGTH)],
    rearOverhangIn: [],
    grossWeightLbs: [fromSource(80_000, WEIGHT)],
    singleAxleLbs: [fromSource(20_000, WEIGHT)],
    tandemAxleLbs: [fromSource(34_000, WEIGHT)],
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
  feesDependOnDistance: false,
};
