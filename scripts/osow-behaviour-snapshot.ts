/**
 * BEHAVIOURAL SNAPSHOT OF EVERY ENCODED OS/OW JURISDICTION.
 *
 * This exists to answer one question with evidence rather than assertion:
 * *did a schema change move any number for a state that was already encoded?*
 *
 * The OS/OW data model grows by adding OPTIONAL fields. Optional is a promise,
 * and the promise is only worth what it can be checked against: every
 * jurisdiction on file is run through `calculateOsowForJurisdiction` over a
 * fixed matrix of loads and as-of dates, and the whole result — every fee line,
 * every warning string, every escort count, every data-quality note — is
 * serialised deterministically. Run it before a change, run it after, diff the
 * two files. An empty diff is the proof.
 *
 *   pnpm exec tsx scripts/osow-behaviour-snapshot.ts > before.json
 *   ...make the change...
 *   pnpm exec tsx scripts/osow-behaviour-snapshot.ts > after.json
 *   diff before.json after.json
 *
 * The matrix deliberately includes loads that are legal, over on one dimension,
 * over on several, overweight with and without an axle layout, superload-heavy,
 * and priced with and without in-state mileage — because the interesting
 * regressions live in the branches that a single happy-path load never reaches.
 */
import { calculateOsowForJurisdiction, type OsowLoad } from '../src/calc/osow/engine.js';
import { OSOW_JURISDICTIONS } from '../src/calc/osow/jurisdictions/index.js';
import { ftIn } from '../src/calc/osow/escortRules.js';

const AS_OF_DATES = ['2026-09-05', '2025-01-15'];

const LOADS: Array<{ name: string; load: OsowLoad }> = [
  { name: 'legal-dry-van', load: { grossWeightLbs: 78_000, widthIn: 102, heightIn: ftIn(13, 6), overallLengthIn: ftIn(70), trailerLengthIn: ftIn(53) } },
  { name: 'over-width-only', load: { grossWeightLbs: 78_000, widthIn: ftIn(12), heightIn: ftIn(13, 6), overallLengthIn: ftIn(75), trailerLengthIn: ftIn(53) } },
  { name: 'over-width-14ft', load: { grossWeightLbs: 79_000, widthIn: ftIn(14), heightIn: ftIn(14), overallLengthIn: ftIn(80), trailerLengthIn: ftIn(53) } },
  { name: 'over-height-only', load: { grossWeightLbs: 78_000, widthIn: 102, heightIn: ftIn(15, 6), overallLengthIn: ftIn(75), trailerLengthIn: ftIn(53) } },
  { name: 'over-length-only', load: { grossWeightLbs: 78_000, widthIn: 102, heightIn: ftIn(13, 6), overallLengthIn: ftIn(120), trailerLengthIn: ftIn(60) } },
  { name: 'overweight-only', load: { grossWeightLbs: 120_000, widthIn: 102, heightIn: ftIn(13, 6), overallLengthIn: ftIn(75), trailerLengthIn: ftIn(53), axleCount: 7 } },
  { name: 'overweight-with-miles', load: { grossWeightLbs: 120_000, widthIn: 102, heightIn: ftIn(13, 6), overallLengthIn: ftIn(75), trailerLengthIn: ftIn(53), axleCount: 7, milesInJurisdiction: 137 } },
  {
    name: 'os-ow-combined-with-axles',
    load: {
      grossWeightLbs: 152_000,
      widthIn: ftIn(15, 6),
      heightIn: ftIn(15),
      overallLengthIn: ftIn(110),
      trailerLengthIn: ftIn(53),
      frontOverhangIn: ftIn(3),
      rearOverhangIn: ftIn(8),
      kingpinToRearAxleIn: ftIn(40),
      milesInJurisdiction: 212,
      axleSpacingFt: 51,
      axles: [
        { positionFt: 0, weightLbs: 12_000 },
        { positionFt: 17, weightLbs: 20_000 },
        { positionFt: 21, weightLbs: 20_000 },
        { positionFt: 42, weightLbs: 25_000 },
        { positionFt: 46, weightLbs: 25_000 },
        { positionFt: 50, weightLbs: 25_000 },
        { positionFt: 54, weightLbs: 25_000 },
      ],
    },
  },
  { name: 'superload-weight', load: { grossWeightLbs: 310_000, widthIn: ftIn(16), heightIn: ftIn(16), overallLengthIn: ftIn(180), trailerLengthIn: ftIn(80), axleCount: 13, milesInJurisdiction: 300, axleSpacingFt: 60 } },
  { name: 'nothing-known', load: {} },
];

const ROUTE_CLASSES = [undefined, 'interstate', 'two-lane', 'divided', 'multilane-undivided'] as const;

function main(): void {
  const out: Record<string, unknown> = {};
  for (const code of Object.keys(OSOW_JURISDICTIONS).sort()) {
    const rules = OSOW_JURISDICTIONS[code];
    if (rules === undefined) continue;
    for (const asOf of AS_OF_DATES) {
      for (const { name, load } of LOADS) {
        for (const routeClass of ROUTE_CLASSES) {
          const key = `${code}|${asOf}|${name}|${routeClass ?? 'no-route-class'}`;
          out[key] = calculateOsowForJurisdiction(
            rules,
            routeClass === undefined ? load : { ...load, routeClass },
            asOf,
          );
        }
      }
    }
  }
  process.stdout.write(JSON.stringify(out, null, 1));
}

main();
