/**
 * The jurisdiction registry.
 *
 * Phase 1 kept this in `texas.ts` because there was one state. Phase 2 added
 * five more and the registry moved here, so that adding a state is: write the
 * data file, add one line below. Nothing in `engine.ts`, `provenance.ts` or
 * `types.ts` changes to add a jurisdiction — that has been the design
 * constraint since Phase 1 and it still holds.
 *
 * PHASE 3 MOVED ONE THING, ONCE, AND ONLY IN `escortRules.ts`: the `RouteClass`
 * union grew five members for California's pilot-car map colours. That is a
 * vocabulary extension rather than a new branch — no evaluator, no engine path
 * and no existing rule changed — and it was preferred to flattening yellow,
 * green, blue, brown and red onto "divided" and "two-lane", which would have
 * erased two feet of width and thirty-five feet of length between route classes
 * that California prices differently. See `RouteClass` for the reasoning.
 *
 * PHASE 4 MOVED TWO, ON THE SAME TERMS. `RouteClass` grew three more members —
 * a generic `multilane-undivided` and two prefixed ones, `ok-super-two-lane` and
 * `fl-limited-access` — and `PerMileRate` grew three optional fields for the
 * rounding rules Washington and Florida publish in their own fee statutes.
 * Both are data-model extensions with no new engine branch and no change to any
 * existing jurisdiction's behaviour. No `if (state === ...)` has ever been
 * added, which is still the design constraint.
 *
 * PHASE 5 MOVED TWO, AND ONE OF THEM IS THE FIRST CHANGE TO `WeightBand` SINCE
 * PHASE 1. `RouteClass` grew ten `co-` members, because Colorado colours every
 * state-highway segment on a published map exactly as California does and then
 * splits its own legend by lane count — so colour and lane count have to travel
 * together in one value. And `WeightBand` grew three optional fields:
 * `minMiles`/`maxMiles`, because Louisiana's overweight fee is a TABLE of ten
 * weight rows against five distance columns rather than a weight step, and
 * `perAxleUsd`, because Colorado charges "$30 plus $10 per axle" with no weight
 * increment at all. Both are data-model extensions on the Phase 3/4 terms: no
 * evaluator changed, no condition kind was added, a band that declares none of
 * the three prices exactly as it did in Phase 1, and no `if (state === ...)` has
 * ever been added anywhere.
 *
 * PHASE 6 MOVED ONE, AND ONLY INSIDE `WeightBand` AGAIN. ARKANSAS prices the
 * overweight permit BY THE TON — "$17 per permit, plus, for each ton or major
 * fraction thereof to be hauled in excess of the lawful weight", at a rate that
 * steps by mileage — so a band grew four optional fields: `perIncrementUsd`,
 * `incrementLbs`, `incrementBaseLbs` and `incrementRounding`. The mileage is
 * named by the `minMiles`/`maxMiles` Louisiana already added. `RouteClass` did
 * NOT grow: Arkansas splits on "controlled access, divided highway with four or
 * more lanes" against everything else, which `interstate` and `divided` already
 * say, and inventing `ar-` members for a distinction the general vocabulary
 * covers would be the opposite of what the prefix is for. Same terms as every
 * phase before: no evaluator changed, no condition kind was added, a band that
 * declares none of the new fields prices exactly as it did in Phase 1, and no
 * `if (state === ...)` has ever been added anywhere.
 *
 * PHASE 7 MOVED ONE, AND ONLY INSIDE `RouteClass` AGAIN. KENTUCKY is the first
 * state whose LEGAL GROSS WEIGHT is a property of the road segment: 603 KAR
 * 5:066 classifies every state-maintained highway as Class "AAA" (80,000 lb),
 * "AA" (62,000 lb) or "A" (44,000 lb), which is California's map-colour case in
 * a different currency, so three `ky-` members were added. `WeightBand` did NOT
 * grow, and could not have: Kentucky charges one flat $60 for a single-trip
 * permit whether the load is oversize, overweight or both, which is the
 * `includedInBaseFee` case the model already had — and which
 * `OverweightPricing` has cited Kentucky by name for since Phase 2. Same terms
 * as every phase before: no evaluator changed, no condition kind was added, and
 * no `if (state === ...)` has ever been added anywhere.
 *
 * WHAT IS HERE IS EXACTLY WHAT EXISTS. An earlier draft of this file imported
 * Arkansas, Tennessee and Kentucky, whose data files were never written; the
 * build failed on three missing modules. Arkansas got one in Phase 6 and
 * Kentucky has one now; Tennessee still does not, and is still absent. The
 * registry must never name a jurisdiction ahead of its dataset —
 * `calculateOsow` refuses loudly for any state that is not here, and that
 * refusal is the honest answer for a state we have not sourced. Twenty are
 * covered: TX, OH, PA, NY, IL, IN, CA, GA, NC, NJ, VA, WA, AL, FL, MO, OK, LA,
 * CO, AR, KY.
 */
import type { JurisdictionOsowRules } from '../types.js';
import { TEXAS_OSOW_RULES } from './texas.js';
import { OHIO_OSOW_RULES } from './ohio.js';
import { PENNSYLVANIA_OSOW_RULES } from './pennsylvania.js';
import { NEW_YORK_OSOW_RULES } from './newYork.js';
import { ILLINOIS_OSOW_RULES } from './illinois.js';
import { INDIANA_OSOW_RULES } from './indiana.js';
import { CALIFORNIA_OSOW_RULES } from './california.js';
import { GEORGIA_OSOW_RULES } from './georgia.js';
import { NORTH_CAROLINA_OSOW_RULES } from './northCarolina.js';
import { NEW_JERSEY_OSOW_RULES } from './newJersey.js';
import { VIRGINIA_OSOW_RULES } from './virginia.js';
import { WASHINGTON_OSOW_RULES } from './washington.js';
import { ALABAMA_OSOW_RULES } from './alabama.js';
import { FLORIDA_OSOW_RULES } from './florida.js';
import { MISSOURI_OSOW_RULES } from './missouri.js';
import { OKLAHOMA_OSOW_RULES } from './oklahoma.js';
import { LOUISIANA_OSOW_RULES } from './louisiana.js';
import { COLORADO_OSOW_RULES } from './colorado.js';
import { ARKANSAS_OSOW_RULES } from './arkansas.js';
import { KENTUCKY_OSOW_RULES } from './kentucky.js';

export const OSOW_JURISDICTIONS: Record<string, JurisdictionOsowRules> = {
  TX: TEXAS_OSOW_RULES,
  OH: OHIO_OSOW_RULES,
  PA: PENNSYLVANIA_OSOW_RULES,
  NY: NEW_YORK_OSOW_RULES,
  IL: ILLINOIS_OSOW_RULES,
  IN: INDIANA_OSOW_RULES,
  CA: CALIFORNIA_OSOW_RULES,
  GA: GEORGIA_OSOW_RULES,
  NC: NORTH_CAROLINA_OSOW_RULES,
  NJ: NEW_JERSEY_OSOW_RULES,
  VA: VIRGINIA_OSOW_RULES,
  WA: WASHINGTON_OSOW_RULES,
  AL: ALABAMA_OSOW_RULES,
  FL: FLORIDA_OSOW_RULES,
  MO: MISSOURI_OSOW_RULES,
  OK: OKLAHOMA_OSOW_RULES,
  LA: LOUISIANA_OSOW_RULES,
  CO: COLORADO_OSOW_RULES,
  AR: ARKANSAS_OSOW_RULES,
  KY: KENTUCKY_OSOW_RULES,
};

/** Is there OS/OW coverage for this state/province code? */
export function hasOsowCoverage(code: string): boolean {
  return Object.hasOwn(
    OSOW_JURISDICTIONS,
    String(code ?? '').trim().toUpperCase(),
  );
}

export function osowRulesFor(code: string): JurisdictionOsowRules | null {
  return OSOW_JURISDICTIONS[String(code ?? '').trim().toUpperCase()] ?? null;
}

export {
  TEXAS_OSOW_RULES,
  OHIO_OSOW_RULES,
  PENNSYLVANIA_OSOW_RULES,
  NEW_YORK_OSOW_RULES,
  ILLINOIS_OSOW_RULES,
  INDIANA_OSOW_RULES,
  CALIFORNIA_OSOW_RULES,
  GEORGIA_OSOW_RULES,
  NORTH_CAROLINA_OSOW_RULES,
  NEW_JERSEY_OSOW_RULES,
  VIRGINIA_OSOW_RULES,
  WASHINGTON_OSOW_RULES,
  ALABAMA_OSOW_RULES,
  FLORIDA_OSOW_RULES,
  MISSOURI_OSOW_RULES,
  OKLAHOMA_OSOW_RULES,
  LOUISIANA_OSOW_RULES,
  COLORADO_OSOW_RULES,
  ARKANSAS_OSOW_RULES,
  KENTUCKY_OSOW_RULES,
};
