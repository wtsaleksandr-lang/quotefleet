/**
 * VIRGINIA — official DMV legal limits and single-trip fee.
 *
 * Virginia's 48/53-foot trailer limits are route-dependent. Both values are
 * kept as sourced candidates so an unspecified route cannot be priced using
 * the interstate exception by accident.
 */
import { ftIn } from '../escortRules.js';
import type { JurisdictionOsowRules } from '../types.js';
import { fromSource, type EvidenceSourceDoc } from './evidence.js';

const RETRIEVED = '2026-09-02';

// ── Source documents ──────────────────────────────────────────────────────

const DMV_HAULING: EvidenceSourceDoc = {
  id: 'va-dmv-hauling-permits',
  title: 'Virginia Department of Motor Vehicles — Hauling Permits',
  url: 'https://www.dmv.virginia.gov/businesses/hauling',
  publisher: 'Virginia Department of Motor Vehicles',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'maximum dimensions and permit types',
  quote: 'Maximum Dimensions: Height: 13 feet 6 inches Width: 8 feet 6 inches Length (Motorized Vehicles other than Buses or Motor Homes): 40 feet Length (Trailers): 48 feet (53-foot trailers are allowed on interstate system) Length (Vehicle/Trailer Combination): 65 feet, Overhang: 4 feet - Rear 3 feet - Front Weight (Single Axle): 20,000 pounds Weight (Tandem Axle): 34,000 pounds. Single Trip | One move between origin and destination. | $20 Note: A mileage fee of 30 cents per mile is added if overweight or if the vehicle configuration cannot be licensed in Virginia.',
};

const INTERSTATE_WEIGHT: EvidenceSourceDoc = {
  id: 'va-code-46-2-1127',
  title: 'Code of Virginia § 46.2-1127 — Weight limits on interstate highways',
  url: 'https://law.lis.virginia.gov/vacodefull/title46.2/chapter10/article17/',
  publisher: 'Virginia Legislative Information System',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: '§ 46.2-1127; history lists amendment years but no complete revision date',
  quote: 'No motor vehicle or combination of vehicles shall travel on an interstate highway in the Commonwealth with a single axle weight in excess of 20,000 pounds, tandem axle weight in excess of 34,000 pounds, or a gross weight, regardless of axle spacing, in excess of 80,000 pounds, unless otherwise permitted by the proper authority.',
};

export const VIRGINIA_OSOW_RULES: JurisdictionOsowRules = {
  code: 'VA',
  name: 'Virginia',
  country: 'US',
  legalLimits: {
    widthIn: [fromSource(ftIn(8, 6), DMV_HAULING)],
    heightIn: [fromSource(ftIn(13, 6), DMV_HAULING)],
    trailerLengthIn: [
      fromSource(ftIn(48), DMV_HAULING, 'General trailer limit.'),
      fromSource(ftIn(53), DMV_HAULING, 'Interstate-system exception.'),
    ],
    frontOverhangIn: [fromSource(ftIn(3), DMV_HAULING)],
    rearOverhangIn: [fromSource(ftIn(4), DMV_HAULING)],
    grossWeightLbs: [fromSource(80_000, INTERSTATE_WEIGHT, 'Interstate highway limit.')],
    singleAxleLbs: [fromSource(20_000, DMV_HAULING)],
    tandemAxleLbs: [fromSource(34_000, DMV_HAULING)],
  },
  permitBaseFeeUsd: [fromSource(20, DMV_HAULING, 'Single-trip permit fee before mileage.')],
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
