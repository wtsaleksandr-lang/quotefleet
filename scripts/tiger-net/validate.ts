/**
 * VALIDATION HARNESS for TIGER-NET. Not a test — a measurement tool.
 *
 *   npx tsx scripts/tiger-net/validate.ts            (uses cached references)
 *   npx tsx scripts/tiger-net/validate.ts --refresh  (re-fetches references)
 *
 * ── WHY THIS IS NOT IN THE TEST SUITE ─────────────────────────────────────
 * It routes 80 lanes against a REFERENCE ROUTER over the public internet. The
 * unit tests must make zero network calls and must pass with the database down,
 * so the numbers this produces are transcribed into the tier's declared band in
 * `corridor.ts` and asserted there from committed fixtures. This script is how
 * that band is re-derived when the TIGER vintage changes.
 *
 * ── WHAT THE REFERENCE IS, AND WHAT IT IS NOT ─────────────────────────────
 * The reference is the public OSRM demo server on OpenStreetMap car routing. It
 * is ONE ROUTER'S OPINION, not ground truth. Where it and TIGER-NET pick
 * different corridors neither is "wrong" — the published interstate route logs
 * are the only real ground truth available, and against those TIGER-NET
 * measures +0.11% (I-40 in Tennessee) and +0.42% (I-81 in Virginia).
 *
 * So read the two numbers this prints differently:
 *   · where the corridors AGREE, the per-state error is this method's own
 *     measurement error, and that is the number the band is set from;
 *   · where they DISAGREE, the difference is corridor choice, which is the
 *     ambiguity the union-of-states design exists to absorb.
 *
 * References are cached under assets/tiger/.cache/ref/ (git-ignored), so a
 * second run makes no network calls at all.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadUsnet, routeCorridors, coverageCheck } from '../../src/calc/heavyHaul/usnet.js';
import { loadStateBoundaries, routedStateMileage } from '../../src/calc/heavyHaul/routedMileage.js';
import { splitRouteMileageByState } from '../../src/calc/osow/stateMileage.js';
import { scalarLaneDistance } from '../../src/calc/heavyHaul/corridor.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REF_DIR = path.resolve(HERE, '..', '..', 'assets', 'tiger', '.cache', 'ref');

const MILES_PER_METRE = 1 / 1609.344;

/** [name, longitude, latitude] */
type City = readonly [string, number, number];

const CITIES: Record<string, City> = {
  houston: ['Houston, TX', -95.3698, 29.7604],
  dallas: ['Dallas, TX', -96.797, 32.7767],
  sanantonio: ['San Antonio, TX', -98.4936, 29.4241],
  elpaso: ['El Paso, TX', -106.485, 31.7619],
  amarillo: ['Amarillo, TX', -101.8313, 35.222],
  okc: ['Oklahoma City, OK', -97.5164, 35.4676],
  tulsa: ['Tulsa, OK', -95.9928, 36.154],
  littlerock: ['Little Rock, AR', -92.2896, 34.7465],
  fortsmith: ['Fort Smith, AR', -94.3985, 35.3859],
  memphis: ['Memphis, TN', -90.049, 35.1495],
  nashville: ['Nashville, TN', -86.7816, 36.1627],
  knoxville: ['Knoxville, TN', -83.9207, 35.9606],
  chattanooga: ['Chattanooga, TN', -85.3097, 35.0456],
  birmingham: ['Birmingham, AL', -86.8025, 33.5186],
  mobile: ['Mobile, AL', -88.0399, 30.6954],
  montgomery: ['Montgomery, AL', -86.2996, 32.3668],
  neworleans: ['New Orleans, LA', -90.0715, 29.9511],
  batonrouge: ['Baton Rouge, LA', -91.1871, 30.4515],
  shreveport: ['Shreveport, LA', -93.7502, 32.5252],
  atlanta: ['Atlanta, GA', -84.388, 33.749],
  savannah: ['Savannah, GA', -81.0912, 32.0809],
  macon: ['Macon, GA', -83.6324, 32.8407],
  jacksonville: ['Jacksonville, FL', -81.6557, 30.3322],
  orlando: ['Orlando, FL', -81.3792, 28.5383],
  miami: ['Miami, FL', -80.1918, 25.7617],
  tampa: ['Tampa, FL', -82.4572, 27.9506],
  charlotte: ['Charlotte, NC', -80.8431, 35.2271],
  raleigh: ['Raleigh, NC', -78.6382, 35.7796],
  greensboro: ['Greensboro, NC', -79.792, 36.0726],
  wilmington: ['Wilmington, NC', -77.9447, 34.2257],
  richmond: ['Richmond, VA', -77.436, 37.5407],
  norfolk: ['Norfolk, VA', -76.2859, 36.8508],
  roanoke: ['Roanoke, VA', -79.9414, 37.271],
  philadelphia: ['Philadelphia, PA', -75.1652, 39.9526],
  pittsburgh: ['Pittsburgh, PA', -79.9959, 40.4406],
  harrisburg: ['Harrisburg, PA', -76.8867, 40.2732],
  scranton: ['Scranton, PA', -75.6624, 41.4089],
  newark: ['Newark, NJ', -74.1724, 40.7357],
  camden: ['Camden, NJ', -75.1196, 39.9259],
  newyork: ['New York, NY', -74.006, 40.7128],
  buffalo: ['Buffalo, NY', -78.8784, 42.8864],
  albany: ['Albany, NY', -73.7562, 42.6526],
  syracuse: ['Syracuse, NY', -76.1474, 43.0481],
  cleveland: ['Cleveland, OH', -81.6944, 41.4993],
  columbus: ['Columbus, OH', -82.9988, 39.9612],
  cincinnati: ['Cincinnati, OH', -84.512, 39.1031],
  toledo: ['Toledo, OH', -83.5379, 41.6528],
  indianapolis: ['Indianapolis, IN', -86.1581, 39.7684],
  fortwayne: ['Fort Wayne, IN', -85.1394, 41.0793],
  evansville: ['Evansville, IN', -87.5711, 37.9716],
  chicago: ['Chicago, IL', -87.6298, 41.8781],
  springfieldil: ['Springfield, IL', -89.6501, 39.7817],
  rockford: ['Rockford, IL', -89.0937, 42.2711],
  stlouis: ['St Louis, MO', -90.1994, 38.627],
  kansascity: ['Kansas City, MO', -94.5786, 39.0997],
  springfieldmo: ['Springfield, MO', -93.2923, 37.209],
  louisville: ['Louisville, KY', -85.7585, 38.2527],
  lexington: ['Lexington, KY', -84.5037, 38.0406],
  denver: ['Denver, CO', -104.9903, 39.7392],
  coloradosprings: ['Colorado Springs, CO', -104.8214, 38.8339],
  grandjunction: ['Grand Junction, CO', -108.5506, 39.0639],
  losangeles: ['Los Angeles, CA', -118.2437, 34.0522],
  sacramento: ['Sacramento, CA', -121.4944, 38.5816],
  sandiego: ['San Diego, CA', -117.1611, 32.7157],
  oakland: ['Oakland, CA', -122.2712, 37.8044],
  bakersfield: ['Bakersfield, CA', -119.0187, 35.3733],
  seattle: ['Seattle, WA', -122.3321, 47.6062],
  spokane: ['Spokane, WA', -117.426, 47.6588],
  tacoma: ['Tacoma, WA', -122.4443, 47.2529],
};

/** 80 lanes, weighted toward the 21 states with encoded fee schedules. */
const LANES: ReadonlyArray<readonly [string, string]> = [
  ['houston', 'buffalo'], ['memphis', 'knoxville'], ['shreveport', 'richmond'],
  ['losangeles', 'newyork'], ['dallas', 'atlanta'], ['chicago', 'houston'],
  ['seattle', 'denver'], ['denver', 'chicago'], ['atlanta', 'philadelphia'],
  ['tampa', 'charlotte'], ['okc', 'stlouis'], ['nashville', 'columbus'],
  ['birmingham', 'louisville'], ['neworleans', 'atlanta'], ['sanantonio', 'okc'],
  ['littlerock', 'memphis'], ['tulsa', 'kansascity'], ['pittsburgh', 'newark'],
  ['cleveland', 'indianapolis'], ['cincinnati', 'nashville'], ['toledo', 'buffalo'],
  ['syracuse', 'philadelphia'], ['albany', 'pittsburgh'], ['richmond', 'raleigh'],
  ['norfolk', 'charlotte'], ['roanoke', 'knoxville'], ['greensboro', 'atlanta'],
  ['savannah', 'jacksonville'], ['orlando', 'mobile'], ['miami', 'tampa'],
  ['jacksonville', 'charlotte'], ['montgomery', 'memphis'], ['batonrouge', 'houston'],
  ['mobile', 'birmingham'], ['macon', 'chattanooga'], ['chattanooga', 'lexington'],
  ['louisville', 'columbus'], ['evansville', 'stlouis'], ['fortwayne', 'chicago'],
  ['springfieldil', 'indianapolis'], ['rockford', 'cleveland'], ['kansascity', 'denver'],
  ['springfieldmo', 'littlerock'], ['stlouis', 'nashville'], ['coloradosprings', 'amarillo'],
  ['grandjunction', 'denver'], ['elpaso', 'sanantonio'], ['amarillo', 'okc'],
  ['fortsmith', 'tulsa'], ['sacramento', 'losangeles'], ['sandiego', 'bakersfield'],
  ['oakland', 'sacramento'], ['losangeles', 'denver'], ['seattle', 'spokane'],
  ['tacoma', 'seattle'], ['spokane', 'denver'], ['camden', 'harrisburg'],
  ['scranton', 'buffalo'], ['newark', 'richmond'], ['philadelphia', 'columbus'],
  ['harrisburg', 'cleveland'], ['newyork', 'charlotte'], ['buffalo', 'chicago'],
  ['wilmington', 'richmond'], ['raleigh', 'philadelphia'], ['charlotte', 'nashville'],
  ['knoxville', 'atlanta'], ['nashville', 'atlanta'], ['memphis', 'dallas'],
  ['houston', 'neworleans'], ['dallas', 'denver'], ['okc', 'chicago'],
  ['indianapolis', 'philadelphia'], ['columbus', 'richmond'], ['cincinnati', 'pittsburgh'],
  ['chicago', 'atlanta'], ['stlouis', 'atlanta'], ['losangeles', 'seattle'],
  ['denver', 'dallas'], ['tulsa', 'memphis'],
];

interface ReferenceRoute {
  miles: number;
  coordinates: Array<[number, number]>;
}

async function reference(a: City, b: City, key: string, refresh: boolean): Promise<ReferenceRoute | null> {
  fs.mkdirSync(REF_DIR, { recursive: true });
  const file = path.join(REF_DIR, `${key}.json`);
  if (!refresh && fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as ReferenceRoute;
  }
  const url =
    `https://router.project-osrm.org/route/v1/driving/${a[1]},${a[2]};${b[1]},${b[2]}` +
    `?overview=full&geometries=geojson`;
  const response = await fetch(url);
  if (!response.ok) return null;
  const body = (await response.json()) as {
    code: string;
    routes?: Array<{ distance: number; geometry: { coordinates: Array<[number, number]> } }>;
  };
  const route = body.routes?.[0];
  if (body.code !== 'Ok' || !route) return null;
  const out: ReferenceRoute = {
    miles: route.distance * MILES_PER_METRE,
    coordinates: route.geometry.coordinates,
  };
  fs.writeFileSync(file, JSON.stringify(out));
  // The demo server is a free community resource. One request every 1.2 s.
  await new Promise((resolve) => setTimeout(resolve, 1200));
  return out;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] as number;
}

async function main(): Promise<void> {
  const refresh = process.argv.includes('--refresh');
  const net = loadUsnet();
  const boundaries = loadStateBoundaries();

  const totalErrors: number[] = [];
  const scalarErrors: number[] = [];
  const geodesicTotalErrors: number[] = [];
  /** Per-state |error| %, only where BOTH methods crossed the state. */
  const agreeStateErrors: Array<{ lane: string; state: string; pct: number; refMiles: number }> = [];
  let corridorSetsAgree = 0;
  let laneCount = 0;
  let refCorridorAgree = 0;
  let missedStates = 0;
  let missedMiles = 0;
  let missedStatesUnion = 0;
  let invented = 0;
  let routeTimeTotal = 0;
  const worst: Array<{ lane: string; note: string }> = [];
  const refusals = new Map<string, number>();
  let refusedErrorSum = 0;
  let refusedCount = 0;

  for (const [fromKey, toKey] of LANES) {
    const a = CITIES[fromKey] as City;
    const b = CITIES[toKey] as City;
    const laneName = `${a[0]} -> ${b[0]}`;
    const ref = await reference(a, b, `${fromKey}-${toKey}`, refresh);
    if (!ref) {
      console.log(`SKIP (no reference) ${laneName}`);
      continue;
    }

    const origin = { latitude: a[2], longitude: a[1] };
    const destination = { latitude: b[2], longitude: b[1] };

    const started = Date.now();
    const result = routedStateMileage(origin, destination, { net, boundaries });
    routeTimeTotal += Date.now() - started;

    if (!result.ok) {
      refusals.set(result.reason, (refusals.get(result.reason) ?? 0) + 1);
      refusedCount += 1;
      // What the refused lanes WOULD have measured, to show the gate is
      // catching the bad population rather than a random slice of it.
      const unguarded = routedStateMileage(origin, destination, {
        net, boundaries, corridorCount: 1,
      });
      if (unguarded.ok || result.reason === 'networkDetour') {
        const miles = unguarded.ok ? unguarded.best.totalMiles : NaN;
        if (Number.isFinite(miles)) {
          refusedErrorSum += Math.abs(((miles - ref.miles) / ref.miles) * 100);
        }
      }
      console.log(`REFUSED (${result.reason}) ${laneName}`);
      continue;
    }
    laneCount += 1;

    const refSplit = splitRouteMileageByState(
      ref.coordinates.map(([longitude, latitude]) => ({ longitude, latitude })),
      boundaries,
    );
    const refByState = new Map<string, number>();
    for (const leg of refSplit.legs) {
      refByState.set(leg.stateCode, (refByState.get(leg.stateCode) ?? 0) + leg.miles);
    }
    const ourByState = new Map<string, number>();
    for (const leg of result.best.legs) {
      ourByState.set(leg.stateCode, (ourByState.get(leg.stateCode) ?? 0) + leg.miles);
    }

    const totalPct = ((result.best.totalMiles - ref.miles) / ref.miles) * 100;
    totalErrors.push(Math.abs(totalPct));
    const scalar = scalarLaneDistance(origin, destination);
    scalarErrors.push(Math.abs(((scalar.totalMiles - ref.miles) / ref.miles) * 100));
    geodesicTotalErrors.push(
      Math.abs((((scalar.straightLineMiles ?? 0) - ref.miles) / ref.miles) * 100),
    );

    if (result.corridorsAgree) corridorSetsAgree += 1;

    // Did the BEST corridor cross the same states as the reference?
    const refStates = [...refByState.keys()].sort();
    const ourStates = [...ourByState.keys()].sort();
    const sameCorridor =
      refStates.length === ourStates.length && refStates.every((s, i) => s === ourStates[i]);
    if (sameCorridor) refCorridorAgree += 1;

    for (const [state, refMiles] of refByState) {
      if (!ourByState.has(state)) {
        // The reference crossed it and the BEST corridor did not.
        missedStates += 1;
        missedMiles += refMiles;
        if (!result.permitStates.includes(state)) {
          // The UNION did not catch it either. This is the number that matters.
          missedStatesUnion += 1;
          worst.push({ lane: laneName, note: `UNION MISSED ${state} (${refMiles.toFixed(0)} mi)` });
        }
        continue;
      }
      const ours = ourByState.get(state) as number;
      const pct = ((ours - refMiles) / refMiles) * 100;
      if (sameCorridor) agreeStateErrors.push({ lane: laneName, state, pct: Math.abs(pct), refMiles });
    }
    for (const state of ourByState.keys()) if (!refByState.has(state)) invented += 1;
  }

  const sortedTotal = totalErrors.slice().sort((x, y) => x - y);
  const sortedScalar = scalarErrors.slice().sort((x, y) => x - y);
  const sortedGeo = geodesicTotalErrors.slice().sort((x, y) => x - y);
  const stateSorted = agreeStateErrors.map((e) => e.pct).sort((x, y) => x - y);
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);

  console.log(`\n=== ${laneCount} lanes measured ===`);
  console.log(`route time            mean ${(routeTimeTotal / Math.max(1, laneCount)).toFixed(0)} ms/lane (5 corridors + state split)`);
  console.log(`\nTOTAL MILES, |error| vs reference router`);
  console.log(`  TIGER-NET   mean ${mean(totalErrors).toFixed(2)}%  p50 ${percentile(sortedTotal, 50).toFixed(2)}%  p90 ${percentile(sortedTotal, 90).toFixed(2)}%  p95 ${percentile(sortedTotal, 95).toFixed(2)}%  max ${percentile(sortedTotal, 100).toFixed(2)}%`);
  console.log(`  scalar x1.18 mean ${mean(scalarErrors).toFixed(2)}%  p50 ${percentile(sortedScalar, 50).toFixed(2)}%  p90 ${percentile(sortedScalar, 90).toFixed(2)}%  max ${percentile(sortedScalar, 100).toFixed(2)}%`);
  console.log(`  geodesic     mean ${mean(geodesicTotalErrors).toFixed(2)}%  p50 ${percentile(sortedGeo, 50).toFixed(2)}%  max ${percentile(sortedGeo, 100).toFixed(2)}%`);

  console.log(`\nCORRIDOR AGREEMENT`);
  console.log(`  our 5 corridors cross the same states   ${corridorSetsAgree}/${laneCount} (${((corridorSetsAgree / laneCount) * 100).toFixed(0)}%)`);
  console.log(`  our best corridor == reference corridor ${refCorridorAgree}/${laneCount} (${((refCorridorAgree / laneCount) * 100).toFixed(0)}%)`);

  console.log(`\nPER-STATE |error| WHERE THE CORRIDOR AGREES (n=${stateSorted.length})`);
  console.log(`  mean ${mean(stateSorted).toFixed(2)}%  p50 ${percentile(stateSorted, 50).toFixed(2)}%  p75 ${percentile(stateSorted, 75).toFixed(2)}%  p90 ${percentile(stateSorted, 90).toFixed(2)}%  p95 ${percentile(stateSorted, 95).toFixed(2)}%  max ${percentile(stateSorted, 100).toFixed(2)}%`);
  const bigLegs = agreeStateErrors.filter((e) => e.refMiles >= 25).map((e) => e.pct).sort((x, y) => x - y);
  console.log(`  legs >= 25 mi only (n=${bigLegs.length}): mean ${mean(bigLegs).toFixed(2)}%  p90 ${percentile(bigLegs, 90).toFixed(2)}%  p95 ${percentile(bigLegs, 95).toFixed(2)}%  max ${percentile(bigLegs, 100).toFixed(2)}%`);

  console.log(`\nFAILURE DIRECTION`);
  console.log(`  states the BEST corridor missed vs reference   ${missedStates} (${missedMiles.toFixed(0)} mi)`);
  console.log(`  states the UNION still missed                  ${missedStatesUnion}   <-- the number that matters`);
  console.log(`  states the best corridor invented              ${invented}`);

  const worstFive = agreeStateErrors
    .filter((e) => e.refMiles >= 25)
    .sort((x, y) => y.pct - x.pct)
    .slice(0, 8);
  console.log(`\nWORST PER-STATE LEGS (agreeing corridors, >= 25 mi)`);
  for (const e of worstFive) {
    console.log(`  ${e.pct.toFixed(1).padStart(6)}%  ${e.state}  ref ${e.refMiles.toFixed(0)} mi   ${e.lane}`);
  }
  for (const w of worst) console.log(`  !! ${w.note}  ${w.lane}`);

  // Coverage guard, on record.
  const ely = coverageCheck(net, [-114.8883, 39.2472], [-83.9207, 35.9606]);
  console.log(`\nCOVERAGE GUARD  Ely NV -> Knoxville: ok=${ely.ok} hop=${(ely.originHopMiles ?? 0).toFixed(0)} mi`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
