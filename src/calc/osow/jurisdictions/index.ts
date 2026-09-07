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
 * PHASE 8 MOVED ONE, INSIDE `RouteClass` FOR THE THIRD TIME — AND THE HEADLINE
 * IS WHAT IT DID *NOT* HAVE TO MOVE. TENNESSEE charges "$20.00 plus six cents
 * (6¢) per ton-mile", the first fee in this directory that is a genuine PRODUCT
 * of weight and distance rather than a step by one of them. It needed no new rate
 * type: `PerMileRate` has computed `rate × miles × weight increments` since Phase
 * 2 — its own documentation names "a rate per mile per increment of weight OVER
 * the legal limit" as one of the three shapes it was built for — and a ton-mile
 * is that shape with the increment set to 2,000 lb. Pennsylvania's "4¢ per mile
 * per ton" is the same fee in different words. What `WeightBand` could NOT have
 * done is the point: Arkansas's `perIncrementUsd` is flat in miles, so encoding
 * Tennessee there would have priced a 500-mile move as a 1-mile one.
 *
 * The two new `RouteClass` members are `tn-two-lane-under-24ft-pavement` and
 * `tn-two-lane-24ft-pavement-or-more`, because 1680-07-01-.06(2) decides one
 * pilot car on the segment's PAVEMENT WIDTH — a published property of the road
 * that nothing on the load implies, which is the California test. They are
 * cheaper than Colorado's ten because they cross nothing: the split lives inside
 * `two-lane` and never reaches a four-lane road. Same terms as every phase
 * before: no evaluator changed, no condition kind was added, and no
 * `if (state === ...)` has ever been added anywhere.
 *
 * WHAT IS HERE IS EXACTLY WHAT EXISTS. An earlier draft of this file imported
 * Arkansas, Tennessee and Kentucky, whose data files were never written; the
 * build failed on three missing modules. Arkansas got one in Phase 6, Kentucky in
 * Phase 7, and Tennessee now has one too — the last of the three, and the
 * registry named none of them before its dataset existed. `calculateOsow`
 * refuses loudly for any state that is not here, and that refusal is the honest
 * answer for a state we have not sourced.
 *
 * PHASE 9 MOVED THREE, AND ONE OF THEM IS THE FIRST STRUCTURAL ADDITION TO
 * `JurisdictionOsowRules` SINCE THE MODEL WAS WRITTEN.
 *
 * MICHIGAN HAS NO GROSS-WEIGHT LIMIT TO RECORD. MCL 257.722(1) sets its axle
 * maxima by the DISTANCE TO THE NEIGHBOURING AXLE — 18,000 / 13,000 / 9,000 lb —
 * MCL 257.719(5)(b) caps the vehicle at eleven axles, and MDOT states in its own
 * words that the famous 164,000 lb figure is the ARITHMETIC RESULT of those two
 * and not a number the statute writes. No `Sourced<number>` can express that, so
 * `axleSpacingWeightTables` was added: a spacing table evaluated per
 * adjacent-axle gap, with the inclusivity of BOTH bounds recorded, because the
 * statute leaves exactly 3 1/2 ft named by no subdivision and MDOT's own T-1
 * closes the hole. Michigan also brought a NEW SELECTOR AXIS — its two tables
 * are chosen by GROSS WEIGHT ("in excess of 80,000 pounds"), not by route, so
 * the same truck on the same road is judged by a different table depending on
 * how heavy it is — and two `RouteClass` members, `mi-designated` and
 * `mi-non-designated`, which control a width, four lengths and a tandem weight.
 *
 * SOUTH CAROLINA BROUGHT THE SECOND: `stateBridgeTable`. § 56-5-4140 transcribes
 * its OWN bridge table and the two-axle row at 8 ft reads 35,200 lb where FHWA
 * reads 34,000, so falling through to `bridgeFormula.ts` would test a South
 * Carolina load against another state's numbers. When the field is present the
 * federal check is not run, and a group with no cell on file is reported
 * undecided rather than judged by the wrong table.
 *
 * MISSISSIPPI NEEDED NOTHING NEW, AND THAT IS THE POINT OF CHECKING. Its
 * overweight fee is unpriceable — ".05 cents per thousand lbs. times the miles
 * traveled" is $0.0005 read literally and $0.05 as intended, a hundredfold,
 * with no statutory backstop — which is the `notPriceable` case the model has
 * had since Phase 2. Its two road classes are defined by lane count and map onto
 * `two-lane`, `divided`, `multilane-undivided` and `interstate`, so no `ms-`
 * member was minted; a private synonym for a definition the general vocabulary
 * already expresses is a member a caller cannot know to pass.
 *
 * Same terms as every phase before: no evaluator changed its meaning for any
 * existing state, no condition kind was added, a jurisdiction that declares
 * neither new field behaves exactly as it did in Phase 8, and no
 * `if (state === ...)` has ever been added anywhere.
 *
 * PHASE 10 IS THE FIRST THAT ADDS NO JURISDICTION AT ALL — IT ADDS THE ROOM FOR
 * NINE.
 * -------------------------------------------------------------------------
 * Wisconsin, Minnesota, Iowa, Maryland, Arizona, Nevada, Kansas, Utah and
 * Nebraska were researched to 792 primary-source data points and none of them
 * can be encoded in the Phase 9 model without either flattening a real
 * distinction or writing a per-state special case — and the whole value of this
 * engine is that it has neither. So this phase changes the SCHEMA and leaves
 * the registry below at twenty-four, deliberately: capability first, data
 * second, with the boundary between them visible in the history.
 *
 * The one that could not be patched around is the road vocabulary. A four-lane
 * undivided road is "undivided" in Nebraska and "four lanes or more" in Kansas
 * — the same road, and the two states put the escort on opposite ends of the
 * load. Nine phases of adding prefixed members to one shared union cannot hold
 * that, because the problem is not naming; it is that a caller passes ONE route
 * class and the two states ask different questions of it. So the vocabulary
 * became per-jurisdiction data in `routeContext.ts`, the existing members stay
 * exactly where they are as `SharedRouteClass`, and a class a state does not
 * publish now evaluates `unknown` rather than false — the guarantee the shared
 * union never made.
 *
 * Around it: a MAX/absorption combinator for fees and for escort counts
 * (Wisconsin's weight fee absorbs every size fee; Utah takes "the most
 * stringent requirement" where Texas is additive), named route segments and
 * sub-jurisdictions that REPLACE the state permit rather than adding to it (the
 * Kansas Turnpike), time-of-day and named-segment conditions (Arizona publishes
 * escort thresholds only between 3 a.m. and half an hour before sunrise;
 * Nevada's permit envelope itself shrinks 14 ft to 12 ft at night), an escort
 * outcome that is a REVIEW rather than a count ("one or more properly equipped
 * escorts"), a second width measurement (Minnesota measures at the bottom and
 * the top of the load in one sentence), and a rounding rule with a direction
 * and a step (Utah applies three different roundings to one fee).
 *
 * Same terms as every phase before, and checked rather than asserted: no
 * evaluator changed its meaning for any existing state, no `if (state === ...)`
 * exists anywhere, and every one of the twenty-four below produces byte-
 * identical output across a matrix of loads, dates and route classes — see
 * `scripts/osow-behaviour-snapshot.ts`.
 *
 *
 * PHASE 11 SPENDS THE ROOM PHASE 10 MADE, AND ADDS NO SCHEMA AT ALL.
 * -------------------------------------------------------------------------
 * WISCONSIN, MINNESOTA AND UTAH are encoded from 259 primary-source data
 * points, and they were chosen first because between them they exercise every
 * mechanism Phase 10 built:
 *
 *   WISCONSIN is the ABSORPTION state. Wis. Stat. § 348.25(8)(c) and (d) make
 *   the width-or-height fee absorb the length fee and the WEIGHT fee absorb
 *   every size fee — a MAX over a two-level lattice, not a sum and not a
 *   comparison — so a load that is over-length, over-width, over-height AND
 *   overweight pays the weight fee alone. It is also the first jurisdiction
 *   whose overweight fee is DERIVED rather than tabled ("10 percent of the fee
 *   specified in par. (b) 3. for an annual permit for the comparable gross
 *   weight"), the first `reviewRequired` outcome in a real dataset ("All loads
 *   exceeding 16 feet in width shall have one or more properly equipped
 *   escorts" — no count), and the first `RouteClassLimitScale` (class "B" is
 *   sixty per cent of class "A").
 *
 *   MINNESOTA is the two-widths state and the frost seam. § 169.812 subd. 2
 *   measures width at the BOTTOM and at the TOP of the load in one sentence, so
 *   `widthAtBottomIn` and `widthAtTopIn` finally have a jurisdiction; § 169.86
 *   subd. 5(e) is the first `perMilePerAxleGroup` fee, summed then multiplied;
 *   § 169.86 subd. 5(g) adds $120 to a wide single trip only while seasonal
 *   load restrictions are in effect, which is the first `Sourced.appliesWhen`
 *   in any dataset and the first time `seasonalStateFor()` reaches a PRICE; and
 *   § 169.823 subd. 1 is the paved/unpaved split `provenance.ts` named
 *   Minnesota for when `appliesWhen` was written.
 *
 *   UTAH is three roundings on one fee. § 72-7-406(7)(c) rounds miles UP to 50,
 *   pounds UP to 25,000 and dollars TO THE NEAREST $10 — the case `RoundingRule`
 *   exists for — and never says whether "the pounds" are the gross or the excess
 *   over 80,000 lb, which is $180 against $250 on one ordinary lane and is on
 *   file as two rows neither of which is adopted. R909-2-14(1)(b) takes "the
 *   most stringent requirement that applies" where Texas is additive, which is
 *   the first `EscortCountCombination`.
 *
 * ONE THING MOVED IN THE ENGINE AND IT IS THE COMBINATOR PHASE 10 DECLARED AND
 * DID NOT WIRE: `CombinedFeeRule.kind: 'absorption'` reached the fee block and
 * fell through to the `greaterOf` arm, which is a comparison where absorption
 * is a statement about which charge exists at all. It now runs
 * `applyFeeAbsorption` over the components a load actually incurs. No
 * jurisdiction encoded before this phase declares `absorption`, so the arm is
 * unreachable for all twenty-four and `scripts/osow-behaviour-snapshot.ts`
 * checks that rather than asserting it. `describePerMile` also learned to
 * render `roundPoundsTo` and `roundDollarsTo`, because a modifier that is
 * priced and not described is a fee line whose note does not reconcile.
 *
 * Same terms as every phase before: no evaluator changed its meaning for any
 * existing state, no condition kind was added, and no `if (state === ...)`
 * exists anywhere.
 *
 * Twenty-seven are covered: TX, OH, PA, NY, IL, IN, CA, GA, NC, NJ, VA, WA, AL,
 * FL, MO, OK, LA, CO, AR, KY, TN, MI, MS, SC, WI, MN, UT.
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
import { TENNESSEE_OSOW_RULES } from './tennessee.js';
import { MICHIGAN_OSOW_RULES } from './michigan.js';
import { MISSISSIPPI_OSOW_RULES } from './mississippi.js';
import { SOUTH_CAROLINA_OSOW_RULES } from './southCarolina.js';
import { WISCONSIN_OSOW_RULES } from './wisconsin.js';
import { MINNESOTA_OSOW_RULES } from './minnesota.js';
import { UTAH_OSOW_RULES } from './utah.js';
import { DISTRICT_OF_COLUMBIA_OSOW_RULES } from './districtOfColumbia.js';
import { SOUTH_DAKOTA_OSOW_RULES } from './southDakota.js';
import { NEVADA_OSOW_RULES } from './nevada.js';
import { WEST_VIRGINIA_OSOW_RULES } from './westVirginia.js';

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
  TN: TENNESSEE_OSOW_RULES,
  MI: MICHIGAN_OSOW_RULES,
  MS: MISSISSIPPI_OSOW_RULES,
  SC: SOUTH_CAROLINA_OSOW_RULES,
  WI: WISCONSIN_OSOW_RULES,
  MN: MINNESOTA_OSOW_RULES,
  UT: UTAH_OSOW_RULES,
  DC: DISTRICT_OF_COLUMBIA_OSOW_RULES,
  SD: SOUTH_DAKOTA_OSOW_RULES,
  NV: NEVADA_OSOW_RULES,
  WV: WEST_VIRGINIA_OSOW_RULES,
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
  DISTRICT_OF_COLUMBIA_OSOW_RULES,
  SOUTH_DAKOTA_OSOW_RULES,
  NEVADA_OSOW_RULES,
  WEST_VIRGINIA_OSOW_RULES,
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
  TENNESSEE_OSOW_RULES,
  MICHIGAN_OSOW_RULES,
  MISSISSIPPI_OSOW_RULES,
  SOUTH_CAROLINA_OSOW_RULES,
  WISCONSIN_OSOW_RULES,
  MINNESOTA_OSOW_RULES,
  UTAH_OSOW_RULES,
};
