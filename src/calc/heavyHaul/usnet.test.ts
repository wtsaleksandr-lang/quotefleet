/**
 * TIGER-NET graph runtime.
 *
 * Reads the COMMITTED artefact — `assets/tiger/usnet.bin.gz` — so what is
 * asserted here is what deploys. No network, no database, no fixtures that
 * could drift from the thing being tested.
 */
import { describe, expect, it } from 'vitest';

import {
  MAX_HOP_MILES,
  coverageCheck,
  decodeUsnet,
  edgeRouteName,
  haversineMiles,
  loadUsnet,
  routeCorridors,
  routeSnapped,
  snapToNetwork,
  type NetPoint,
} from './usnet.js';

const net = loadUsnet();

/** Downtown coordinates, so a snap failure shows up as a large hop. */
const MEMPHIS: NetPoint = [-90.049, 35.1495];
const KNOXVILLE: NetPoint = [-83.9207, 35.9606];
const MACON: NetPoint = [-83.6324, 32.8407];
const CHATTANOOGA: NetPoint = [-85.3097, 35.0456];
const MOBILE: NetPoint = [-88.0399, 30.6954];
const BIRMINGHAM: NetPoint = [-86.8025, 33.5186];
const HOUSTON: NetPoint = [-95.3698, 29.7604];
const BUFFALO: NetPoint = [-78.8784, 42.8864];
/** US-50 and US-93 are below MTFCC S1100, so nothing is mapped near here. */
const ELY_NEVADA: NetPoint = [-114.8883, 39.2472];
const TORONTO: NetPoint = [-79.3832, 43.6532];

describe('the packed artefact', () => {
  it('is a USNET2 graph with the counts the build recorded', () => {
    expect(net.nodeCount).toBeGreaterThan(20_000);
    expect(net.edgeCount).toBeGreaterThan(50_000);
    expect(net.coordCount).toBeGreaterThan(300_000);
    // Every edge's geometry has to lie inside the coordinate pool, or a route
    // would read a neighbouring road's vertices and report someone else's miles.
    expect(net.geomOff[net.edgeCount]).toBe(net.coordCount);
    expect(net.edgeName.length).toBe(net.edgeCount);
    expect(net.names[0]).toBe('');
  });

  it('REFUSES A FILE THAT IS NOT THE ASSET rather than reading it as coordinates', () => {
    const notAGraph = new Uint8Array(64);
    notAGraph.set([...'NOPE!!'].map((c) => c.charCodeAt(0)));
    expect(() => decodeUsnet(notAGraph)).toThrow(/USNET2/);
  });

  it('carries route names, normalised out of TIGER spelling', () => {
    // TIGER writes "I- 40"; a corridor labelled that reads as a typo, and two
    // spellings of one road would split the name table.
    const names = new Set(net.names);
    expect(names.has('I-40')).toBe(true);
    expect(names.has('I-81')).toBe(true);
    expect([...names].some((n) => /^I-\s/.test(n))).toBe(false);
  });
});

describe('snapping', () => {
  it('snaps to a POINT ON A ROAD, not to the nearest junction', () => {
    // Chain contraction deletes every non-junction node, so the nearest NODE on
    // a rural corridor can be a hundred miles away. If this ever regresses to
    // node snapping, the hop below grows by orders of magnitude and the coverage
    // guard starts measuring the wrong thing.
    const snap = snapToNetwork(net, MEMPHIS);
    expect(snap).not.toBeNull();
    expect(snap?.hopMiles).toBeLessThan(2);
    expect(snap?.alongFraction).toBeGreaterThanOrEqual(0);
    expect(snap?.alongFraction).toBeLessThanOrEqual(1);
  });
});

describe('routing', () => {
  it('routes Memphis to Knoxville on I-40, not around it', () => {
    const route = routeSnapped(net, MEMPHIS, KNOXVILLE);
    expect(route).not.toBeNull();
    // Published I-40 across Tennessee is 455 mi; this lane is most of it.
    expect(route?.totalMiles).toBeGreaterThan(370);
    expect(route?.totalMiles).toBeLessThan(410);
    const roads = new Set(route?.chain.map((e) => edgeRouteName(net, e)));
    expect(roads.has('I-40')).toBe(true);
  });

  it('TURNS AT THE MACON INTERCHANGE — the gap that cost 441 miles', () => {
    // I-16 and I-75 pass within 0.268 mi at Macon and TIGER keeps the ramps
    // joining them in a different file, so the graph could not turn between
    // them: this lane routed 642 mi out to Savannah and back. The graph was
    // fully connected the whole time, which is why component analysis is not a
    // health check. `healEdgeGaps` is what fixed it.
    const route = routeSnapped(net, MACON, CHATTANOOGA);
    expect(route).not.toBeNull();
    expect(route?.totalMiles).toBeLessThan(260);
  });

  it('TURNS AT THE MOBILE INTERCHANGE — the same bug, 164 miles', () => {
    // I-10 and I-65 pass within 0.228 mi at Mobile. Without the fix this lane
    // went around through Mississippi: 420 mi against a real 256.
    const route = routeSnapped(net, MOBILE, BIRMINGHAM);
    expect(route).not.toBeNull();
    expect(route?.totalMiles).toBeLessThan(300);
  });

  it('offers distinct, plausible corridors rather than one road twice', () => {
    const corridors = routeCorridors(net, HOUSTON, BUFFALO, { count: 5 });
    expect(corridors.length).toBeGreaterThan(1);

    // NOT SORTED BY MILES, and that is deliberate. Dijkstra minimises COST,
    // which is hours, so corridor 0 is the fastest way to run the lane and an
    // alternate can be a mile or two shorter while being slower. Miles are what
    // price the permit; the fastest corridor is what a driver actually takes,
    // and quoting the miles of a road nobody drives would be the worse error.
    const best = corridors[0]?.totalMiles as number;

    // An alternate more than 12% longer than the best is not a real option and
    // is dropped, which is what stops the union from collecting states off a
    // route no dispatcher would run.
    for (const corridor of corridors) {
      expect(corridor.totalMiles).toBeLessThanOrEqual(best * 1.12 + 1);
    }

    // They must be genuinely different roads, not the same interstate found
    // twice: penalising the previous corridor's edges could otherwise just walk
    // the opposite carriageway of the same highway.
    const chains = corridors.map((c) => c.chain.join(','));
    expect(new Set(chains).size).toBe(corridors.length);
  });
});

describe('the coverage guard', () => {
  it('REFUSES Ely, Nevada instead of inventing a 121-mile hop', () => {
    // US-50 and US-93 across central Nevada are classified below S1100, so the
    // nearest mapped road is 121 mi away. Routing from there would invent that
    // mileage AND any state the invented hop crossed. This is the single most
    // important guard in the tier: an endpoint far from the network must refuse.
    const coverage = coverageCheck(net, ELY_NEVADA, KNOXVILLE);
    expect(coverage.ok).toBe(false);
    expect(coverage.requiresManualReview).toBe(true);
    expect(coverage.originHopMiles).toBeGreaterThan(100);
    expect(coverage.warnings.join(' ')).toMatch(/pickup is \d+ mi/);
  });

  it('REFUSES Canadian endpoints, which is correct and not a bug', () => {
    // There are no Canadian roads and no provincial boundaries in this dataset,
    // so a Canadian lane has no per-state answer to give.
    const coverage = coverageCheck(net, TORONTO, KNOXVILLE);
    expect(coverage.ok).toBe(false);
    expect(coverage.originHopMiles).toBeGreaterThan(MAX_HOP_MILES);
  });

  it('passes an ordinary lane between two cities', () => {
    const coverage = coverageCheck(net, MEMPHIS, KNOXVILLE);
    expect(coverage.ok).toBe(true);
    expect(coverage.requiresManualReview).toBe(false);
    expect(coverage.warnings).toEqual([]);
  });
});

describe('haversineMiles', () => {
  it('agrees with the published Memphis–Knoxville great-circle distance', () => {
    // Shares the IUGG mean radius with `stateMileage.ts`; if the two ever
    // diverge, network miles and state miles stop summing to the same lane.
    expect(haversineMiles(MEMPHIS, KNOXVILLE)).toBeCloseTo(348.95, 1);
    expect(haversineMiles(MEMPHIS, MEMPHIS)).toBe(0);
  });
});
