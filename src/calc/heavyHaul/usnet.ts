/**
 * TIGER-NET — an in-process routing graph over the federal primary-road network.
 *
 * ── WHAT THIS IS, AND WHY IT EXISTS ───────────────────────────────────────
 * Permits are priced PER STATE. A lane total cannot do that, and a straight
 * line does it wrongly in the one direction that matters: on the evaluation
 * lanes a geodesic split MISSED SIX STATES, including Ohio and Pennsylvania on
 * a 361-mile lane. A missed state is an unbudgeted permit at a scale house.
 *
 * A router fixes it, and every hosted router is either demo-only, non-commercial
 * or a standing monthly bill. So the router is here, in the process, over data
 * the federal government gives away.
 *
 * ── DATA AND LICENCE ──────────────────────────────────────────────────────
 * TIGER/Line PRIMARYROADS (MTFCC S1100), US Census Bureau. A work of the US
 * federal government: PUBLIC DOMAIN under 17 U.S.C. § 105 — no attribution
 * clause, no share-alike, commercial use unrestricted. There is no counterparty
 * and no bill. We cite it anyway, because a quote should say where its miles
 * came from.
 *
 * ── COST ──────────────────────────────────────────────────────────────────
 * $0.00 per month and $0.00 per quote. The 38 MB source ZIP compiles to a
 * 4.5 MB binary (3.5 MB gzipped) by `scripts/tiger-net/build.mjs`, which is
 * committed at `assets/tiger/usnet.bin.gz`. THE BUILD NEVER RUNS ON THE SERVER
 * — it peaks near 1.2 GB of RSS. This file only reads the packed result.
 *
 * ── WHAT IT DOES NOT DO ───────────────────────────────────────────────────
 * It does not choose corridors better than a human. Time-weighted and
 * distance-weighted routing picked identical corridors on 5 of 6 evaluation
 * lanes, so a better cost function is not the missing piece. `routeCorridors`
 * plus a union-of-states permit list is the answer, and it lives in
 * `routedMileage.ts`.
 *
 * Typed arrays only. No dependencies, no network, no database. It answers with
 * the DB down.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

/** Coordinate quantisation in the packed asset: 1e-6 degrees, about 11 cm. */
const COORD_SCALE = 1e6;

/** IUGG mean Earth radius in miles — the same value `stateMileage.ts` uses. */
const EARTH_RADIUS_MILES = 3_958.7613;

/** `[longitude, latitude]`, matching `GeoPosition` in `src/calc/osow/stateMileage.ts`. */
export type NetPoint = [longitude: number, latitude: number];

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function haversineMiles(a: NetPoint, b: NetPoint): number {
  const dLat = radians(b[1] - a[1]);
  const dLon = radians(b[0] - a[0]);
  const latA = radians(a[1]);
  const latB = radians(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(latA) * Math.cos(latB) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_MILES * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// ──────────────────────────────────────────────────────────────────────────
// Loading the packed asset
// ──────────────────────────────────────────────────────────────────────────

export interface UsNet {
  nodeCount: number;
  edgeCount: number;
  coordCount: number;
  /** Node lon/lat interleaved, ×1e6. */
  nodeXY: Int32Array;
  /** Edge endpoints interleaved. */
  edgeAB: Int32Array;
  /** Full-resolution edge length in miles — NOT recomputed from the simplified geometry. */
  edgeMiles: Float32Array;
  /** Edge traversal cost in hours; what Dijkstra minimises. */
  edgeCost: Float32Array;
  /** Prefix offsets into `coordXY` for each edge's geometry. */
  geomOff: Uint32Array;
  /** Shared coordinate pool, lon/lat interleaved, ×1e6. */
  coordXY: Int32Array;
  /** CSR adjacency: row starts. */
  rowStart: Uint32Array;
  /** CSR adjacency: edge ids. */
  adjEdge: Uint32Array;
  /** Route name per edge, as an index into `names`. */
  edgeName: Uint16Array;
  /** Distinct route names; index 0 is the empty name (a ramp or a healed gap). */
  names: string[];
  /** Lazily built spatial index over edge geometry, for snapping. */
  edgeGrid: Map<number, number[]> | null;
  edgeCell: number;
}

/** The route name carried on an edge, or `''` for a ramp, weld or healed gap. */
export function edgeRouteName(net: UsNet, edge: number): string {
  return net.names[net.edgeName[edge] as number] ?? '';
}

/**
 * Where the artefact lives, resolved from THIS MODULE rather than `cwd`.
 *
 * `src/calc/heavyHaul/usnet.ts` and `dist/calc/heavyHaul/usnet.js` are both
 * three directories below the repo root, so one relative path serves the tsx
 * dev process and the compiled server. Resolving from `process.cwd()` instead
 * would break the moment anything starts the app from another directory.
 */
export const USNET_ASSET_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'assets',
  'tiger',
  'usnet.bin.gz',
);

/**
 * Decode the packed graph.
 *
 * The buffer is COPIED into a fresh, 8-byte-aligned ArrayBuffer before any
 * typed-array view is taken. `Buffer` instances can carry a non-zero
 * `byteOffset` into a shared pool, and `new Int32Array(pool, unalignedOffset)`
 * throws; copying once at load costs 4.5 MB and a few milliseconds and makes
 * the read deterministic.
 */
export function decodeUsnet(raw: Uint8Array): UsNet {
  const bytes =
    raw[0] === 0x1f && raw[1] === 0x8b ? new Uint8Array(zlib.gunzipSync(raw)) : raw;

  const aligned = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(aligned).set(bytes);
  const view = new DataView(aligned);

  const magic = String.fromCharCode(...new Uint8Array(aligned, 0, 6));
  if (magic !== 'USNET2') {
    throw new Error(
      `Not a USNET2 routing asset (magic "${magic}"). Rebuild it with: node scripts/tiger-net/build.mjs`,
    );
  }

  const nodeCount = view.getUint32(8, true);
  const edgeCount = view.getUint32(12, true);
  const coordCount = view.getUint32(16, true);
  const nameCount = view.getUint32(20, true);
  const nameBytesLength = view.getUint32(24, true);

  let offset = 28;
  const nodeXY = new Int32Array(aligned, offset, nodeCount * 2);
  offset += nodeCount * 8;
  const edgeAB = new Int32Array(aligned, offset, edgeCount * 2);
  offset += edgeCount * 8;
  const edgeMiles = new Float32Array(aligned, offset, edgeCount);
  offset += edgeCount * 4;
  const edgeCost = new Float32Array(aligned, offset, edgeCount);
  offset += edgeCount * 4;
  const geomOff = new Uint32Array(aligned, offset, edgeCount + 1);
  offset += (edgeCount + 1) * 4;
  const coordXY = new Int32Array(aligned, offset, coordCount * 2);
  offset += coordCount * 8;
  const edgeName = new Uint16Array(aligned, offset, edgeCount);
  offset += edgeCount * 2;
  offset += (edgeCount * 2) % 4 === 0 ? 0 : 4 - ((edgeCount * 2) % 4);
  const nameOffsets = new Uint32Array(aligned, offset, nameCount + 1);
  offset += (nameCount + 1) * 4;
  const nameBlob = new Uint8Array(aligned, offset, nameBytesLength);
  const decoder = new TextDecoder();
  const names: string[] = [];
  for (let i = 0; i < nameCount; i += 1) {
    names.push(
      decoder.decode(nameBlob.subarray(nameOffsets[i] as number, nameOffsets[i + 1] as number)),
    );
  }

  // CSR adjacency, built once. The graph is undirected: every edge appears in
  // both of its endpoints' rows.
  const degree = new Uint32Array(nodeCount + 1);
  for (let e = 0; e < edgeCount; e += 1) {
    degree[edgeAB[e * 2] as number] += 1;
    degree[edgeAB[e * 2 + 1] as number] += 1;
  }
  const rowStart = new Uint32Array(nodeCount + 1);
  for (let i = 0; i < nodeCount; i += 1) {
    rowStart[i + 1] = (rowStart[i] as number) + (degree[i] as number);
  }
  const fill = rowStart.slice();
  const adjEdge = new Uint32Array(rowStart[nodeCount] as number);
  for (let e = 0; e < edgeCount; e += 1) {
    adjEdge[fill[edgeAB[e * 2] as number]++] = e;
    adjEdge[fill[edgeAB[e * 2 + 1] as number]++] = e;
  }

  return {
    nodeCount,
    edgeCount,
    coordCount,
    nodeXY,
    edgeAB,
    edgeMiles,
    edgeCost,
    geomOff,
    coordXY,
    edgeName,
    names,
    rowStart,
    adjEdge,
    edgeGrid: null,
    edgeCell: 0.1,
  };
}

let cached: UsNet | null = null;
let loadFailure: Error | null = null;

/**
 * The process-wide graph.
 *
 * Measured in this repo: 11 ms to load, about 10 MB of retained RSS. Held in a
 * module singleton because that is the whole point — the cost is paid once per
 * process and every quote after it is free.
 *
 * A failed load is CACHED as a failure and rethrown. Retrying a missing or
 * corrupt 4.5 MB asset on every quote would turn one deployment mistake into a
 * per-request disk storm; the caller's job is to fall back, not to retry.
 */
export function loadUsnet(assetPath: string = USNET_ASSET_PATH): UsNet {
  if (cached) return cached;
  if (loadFailure) throw loadFailure;
  try {
    cached = decodeUsnet(new Uint8Array(fs.readFileSync(assetPath)));
    return cached;
  } catch (error) {
    loadFailure = error instanceof Error ? error : new Error(String(error));
    throw loadFailure;
  }
}

/** Test seam. Never called by the server. */
export function resetUsnetCacheForTests(): void {
  cached = null;
  loadFailure = null;
}

function nodePoint(net: UsNet, node: number): NetPoint {
  return [
    (net.nodeXY[node * 2] as number) / COORD_SCALE,
    (net.nodeXY[node * 2 + 1] as number) / COORD_SCALE,
  ];
}

function coordPoint(net: UsNet, index: number): NetPoint {
  return [
    (net.coordXY[index * 2] as number) / COORD_SCALE,
    (net.coordXY[index * 2 + 1] as number) / COORD_SCALE,
  ];
}

// ──────────────────────────────────────────────────────────────────────────
// Dijkstra
// ──────────────────────────────────────────────────────────────────────────

export interface NodeRoute {
  /** Geometry from `src` to `dst`, in traversal order. */
  path: NetPoint[];
  /** Full-resolution road miles. */
  miles: number;
  /** Edge ids used, in order — the input to corridor penalisation. */
  chain: number[];
}

/** A binary heap keyed on cost. Kept local so the graph carries no allocation. */
class CostHeap {
  private readonly cost: number[] = [];
  private readonly node: number[] = [];

  get size(): number {
    return this.cost.length;
  }

  push(cost: number, node: number): void {
    this.cost.push(cost);
    this.node.push(node);
    let i = this.cost.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((this.cost[parent] as number) <= (this.cost[i] as number)) break;
      this.swap(parent, i);
      i = parent;
    }
  }

  pop(): [cost: number, node: number] {
    const cost = this.cost[0] as number;
    const node = this.node[0] as number;
    const lastCost = this.cost.pop() as number;
    const lastNode = this.node.pop() as number;
    if (this.cost.length > 0) {
      this.cost[0] = lastCost;
      this.node[0] = lastNode;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < this.cost.length && (this.cost[left] as number) < (this.cost[smallest] as number)) {
          smallest = left;
        }
        if (right < this.cost.length && (this.cost[right] as number) < (this.cost[smallest] as number)) {
          smallest = right;
        }
        if (smallest === i) break;
        this.swap(smallest, i);
        i = smallest;
      }
    }
    return [cost, node];
  }

  private swap(a: number, b: number): void {
    const c = this.cost[a] as number;
    this.cost[a] = this.cost[b] as number;
    this.cost[b] = c;
    const n = this.node[a] as number;
    this.node[a] = this.node[b] as number;
    this.node[b] = n;
  }
}

/**
 * Shortest path between two graph NODES.
 *
 * `penalty` multiplies an edge's cost without changing its mileage — that is
 * how alternate corridors are found, and it is why the miles reported for an
 * alternate are still the real miles of the road it uses.
 */
export function routeNodes(
  net: UsNet,
  src: number,
  dst: number,
  penalty: ReadonlyMap<number, number> | null = null,
): NodeRoute | null {
  if (src === dst) return { path: [nodePoint(net, src)], miles: 0, chain: [] };

  const n = net.nodeCount;
  const dist = new Float64Array(n).fill(Infinity);
  const prevEdge = new Int32Array(n).fill(-1);
  const prevNode = new Int32Array(n).fill(-1);
  const settled = new Uint8Array(n);
  const heap = new CostHeap();

  dist[src] = 0;
  heap.push(0, src);

  while (heap.size > 0) {
    const [cost, u] = heap.pop();
    if (settled[u]) continue;
    settled[u] = 1;
    if (u === dst) break;
    for (let k = net.rowStart[u] as number; k < (net.rowStart[u + 1] as number); k += 1) {
      const e = net.adjEdge[k] as number;
      const a = net.edgeAB[e * 2] as number;
      const b = net.edgeAB[e * 2 + 1] as number;
      const v = a === u ? b : a;
      if (settled[v]) continue;
      const next = cost + (net.edgeCost[e] as number) * (penalty?.get(e) ?? 1);
      if (next < (dist[v] as number)) {
        dist[v] = next;
        prevEdge[v] = e;
        prevNode[v] = u;
        heap.push(next, v);
      }
    }
  }

  if (dist[dst] === Infinity) return null;

  const chain: number[] = [];
  let cursor = dst;
  while (cursor !== src) {
    const e = prevEdge[cursor] as number;
    if (e < 0) return null;
    chain.push(e);
    cursor = prevNode[cursor] as number;
  }
  chain.reverse();

  const pathPoints: NetPoint[] = [nodePoint(net, src)];
  let miles = 0;
  let at = src;
  for (const e of chain) {
    const a = net.edgeAB[e * 2] as number;
    const b = net.edgeAB[e * 2 + 1] as number;
    const forward = a === at;
    const from = net.geomOff[e] as number;
    const to = net.geomOff[e + 1] as number;
    if (forward) {
      for (let i = from + 1; i < to; i += 1) pathPoints.push(coordPoint(net, i));
    } else {
      for (let i = to - 2; i >= from; i -= 1) pathPoints.push(coordPoint(net, i));
    }
    miles += net.edgeMiles[e] as number;
    at = forward ? b : a;
  }

  return { path: pathPoints, miles, chain };
}

// ──────────────────────────────────────────────────────────────────────────
// Snapping to the network — to a POINT ON A ROAD, not to a junction
// ──────────────────────────────────────────────────────────────────────────

/**
 * Chain contraction deletes every node that is not a junction, so the nearest
 * NODE to a rural address can be a hundred miles away even when the road runs
 * past the door. Entering the graph at that node would invent the hop AND every
 * state it crossed. Snapping projects onto the nearest EDGE instead, which is
 * uniformly 0.1–2 miles better on the evaluation lanes and — more importantly —
 * is what makes `coverageCheck` measure the real distance to pavement.
 */
export function buildEdgeIndex(net: UsNet, cellDegrees = 0.1): UsNet {
  const grid = new Map<number, number[]>();
  for (let e = 0; e < net.edgeCount; e += 1) {
    const from = net.geomOff[e] as number;
    const to = net.geomOff[e + 1] as number;
    let lastKey: number | null = null;
    for (let i = from; i < to; i += 1) {
      const gx = Math.floor((net.coordXY[i * 2] as number) / COORD_SCALE / cellDegrees);
      const gy = Math.floor((net.coordXY[i * 2 + 1] as number) / COORD_SCALE / cellDegrees);
      const key = gx * 100_000 + gy;
      if (key === lastKey) continue;
      lastKey = key;
      let bucket = grid.get(key);
      if (!bucket) {
        bucket = [];
        grid.set(key, bucket);
      }
      if (bucket[bucket.length - 1] !== e) bucket.push(e);
    }
  }
  net.edgeGrid = grid;
  net.edgeCell = cellDegrees;
  return net;
}

interface EdgeProjection {
  distanceMiles: number;
  /** Segment index within the coordinate pool. */
  segment: number;
  /** Position along that segment, 0..1. */
  t: number;
  point: NetPoint;
}

function projectOnEdge(net: UsNet, edge: number, target: NetPoint): EdgeProjection | null {
  const from = net.geomOff[edge] as number;
  const to = net.geomOff[edge + 1] as number;
  // Longitude degrees shrink with latitude; without this a projection near the
  // Canadian border is biased east–west by a factor of two.
  const kx = Math.cos(radians(target[1]));
  let best: EdgeProjection | null = null;
  for (let i = from; i + 1 < to; i += 1) {
    const ax = (net.coordXY[i * 2] as number) / COORD_SCALE;
    const ay = (net.coordXY[i * 2 + 1] as number) / COORD_SCALE;
    const bx = (net.coordXY[(i + 1) * 2] as number) / COORD_SCALE;
    const by = (net.coordXY[(i + 1) * 2 + 1] as number) / COORD_SCALE;
    const vx = (bx - ax) * kx;
    const vy = by - ay;
    const wx = (target[0] - ax) * kx;
    const wy = target[1] - ay;
    const len2 = vx * vx + vy * vy;
    let t = len2 === 0 ? 0 : (wx * vx + wy * vy) / len2;
    t = Math.max(0, Math.min(1, t));
    const point: NetPoint = [ax + t * (bx - ax), ay + t * (by - ay)];
    const distanceMiles = haversineMiles(target, point);
    if (!best || distanceMiles < best.distanceMiles) {
      best = { distanceMiles, segment: i, t, point };
    }
  }
  return best;
}

interface SnapCandidate extends EdgeProjection {
  edge: number;
}

export interface NetworkSnap {
  edge: number;
  /** Straight-line miles from the address to the pavement. */
  hopMiles: number;
  point: NetPoint;
  /** Segment index RELATIVE to the edge's first coordinate. */
  segment: number;
  t: number;
  /** How far along the edge the projection sits, 0..1. */
  alongFraction: number;
}

export function snapToNetwork(net: UsNet, target: NetPoint): NetworkSnap | null {
  if (!net.edgeGrid) buildEdgeIndex(net);
  const cell = net.edgeCell;
  const gx = Math.floor(target[0] / cell);
  const gy = Math.floor(target[1] / cell);

  // A one-slot holder rather than a `let`: the assignment sits four loops deep,
  // and TypeScript's flow analysis gives up at that depth and reports the
  // variable as still `null` afterwards.
  const found: SnapCandidate[] = [];
  const seen = new Set<number>();
  // 40 rings at 0.1° is roughly 275 miles — far enough to find pavement
  // anywhere in the lower 48, and bounded so an offshore point terminates.
  for (let ring = 0; ring <= 40; ring += 1) {
    for (let dx = -ring; dx <= ring; dx += 1) {
      for (let dy = -ring; dy <= ring; dy += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const bucket = net.edgeGrid?.get((gx + dx) * 100_000 + (gy + dy));
        if (!bucket) continue;
        for (const edge of bucket) {
          if (seen.has(edge)) continue;
          seen.add(edge);
          const projection = projectOnEdge(net, edge, target);
          if (projection === null) continue;
          const incumbent = found[0];
          if (!incumbent || projection.distanceMiles < incumbent.distanceMiles) {
            found[0] = { ...projection, edge };
          }
        }
      }
    }
    // One extra ring after the first hit: the nearest road may sit in a
    // neighbouring cell, and stopping on first contact biases the snap.
    if (found.length > 0 && ring >= 1) break;
  }
  const best = found[0];
  if (!best) return null;

  const from = net.geomOff[best.edge] as number;
  const to = net.geomOff[best.edge + 1] as number;
  let total = 0;
  let along = 0;
  for (let i = from; i + 1 < to; i += 1) {
    const segmentMiles = haversineMiles(coordPoint(net, i), coordPoint(net, i + 1));
    if (i < best.segment) along += segmentMiles;
    else if (i === best.segment) along += segmentMiles * best.t;
    total += segmentMiles;
  }

  return {
    edge: best.edge,
    hopMiles: best.distanceMiles,
    point: best.point,
    segment: best.segment - from,
    t: best.t,
    alongFraction: total > 0 ? along / total : 0,
  };
}

function edgeGeometry(
  net: UsNet,
  edge: number,
  fromSegment: number,
  fromT: number,
  toSegment: number,
  toT: number,
): NetPoint[] {
  const base = net.geomOff[edge] as number;
  const lerp = (i: number, t: number): NetPoint => {
    const a = coordPoint(net, i);
    const b = coordPoint(net, i + 1);
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  };
  const points: NetPoint[] = [lerp(base + fromSegment, fromT)];
  for (let i = base + fromSegment + 1; i <= base + toSegment; i += 1) points.push(coordPoint(net, i));
  points.push(lerp(base + toSegment, toT));
  return points;
}

// ──────────────────────────────────────────────────────────────────────────
// Address to address
// ──────────────────────────────────────────────────────────────────────────

export interface SnappedRoute {
  /** Address → pavement → road → pavement → address, ready for the state split. */
  path: NetPoint[];
  /** Miles measured on the road network. */
  networkMiles: number;
  originHopMiles: number;
  destinationHopMiles: number;
  totalMiles: number;
  chain: number[];
}

export interface RouteOptions {
  /**
   * Circuity applied to the straight-line hop from an address to the nearest
   * primary road. Local streets are not in this dataset, so the hop is
   * estimated; 1.25 is the same order as the ×1.18 line-haul factor and is
   * charged to the ENDPOINT state, which can only add miles to a state we are
   * already certain about — never introduce a new one.
   */
  hopFactor?: number;
  penalty?: ReadonlyMap<number, number> | null;
}

export function routeSnapped(
  net: UsNet,
  from: NetPoint,
  to: NetPoint,
  options: RouteOptions = {},
): SnappedRoute | null {
  const hopFactor = options.hopFactor ?? 1.25;
  const a = snapToNetwork(net, from);
  const b = snapToNetwork(net, to);
  if (!a || !b) return null;

  const partial = (snap: NetworkSnap) => {
    const miles = net.edgeMiles[snap.edge] as number;
    return {
      edge: snap.edge,
      a: net.edgeAB[snap.edge * 2] as number,
      b: net.edgeAB[snap.edge * 2 + 1] as number,
      toA: miles * snap.alongFraction,
      toB: miles * (1 - snap.alongFraction),
    };
  };
  const pa = partial(a);
  const pb = partial(b);

  // Both ends on the same edge: no graph search, and no risk of the search
  // leaving the edge and coming back.
  if (pa.edge === pb.edge) {
    const forward = a.alongFraction <= b.alongFraction;
    const geometry = forward
      ? edgeGeometry(net, pa.edge, a.segment, a.t, b.segment, b.t)
      : edgeGeometry(net, pa.edge, b.segment, b.t, a.segment, a.t).reverse();
    const miles = Math.abs(b.alongFraction - a.alongFraction) * (net.edgeMiles[pa.edge] as number);
    return {
      path: [from, ...geometry, to],
      networkMiles: miles,
      originHopMiles: a.hopMiles * hopFactor,
      destinationHopMiles: b.hopMiles * hopFactor,
      totalMiles: miles + (a.hopMiles + b.hopMiles) * hopFactor,
      chain: [pa.edge],
    };
  }

  // Either end of the snapped edge can be the way in or out; try all four and
  // keep the shortest. Picking the nearer endpoint greedily routes the wrong
  // way down a divided highway and adds an interchange's worth of miles.
  let best: {
    miles: number;
    route: NodeRoute;
    startFromB: boolean;
    endToB: boolean;
  } | null = null;
  const starts: Array<[node: number, miles: number, fromB: boolean]> = [
    [pa.a, pa.toA, false],
    [pa.b, pa.toB, true],
  ];
  const ends: Array<[node: number, miles: number, toB: boolean]> = [
    [pb.a, pb.toA, false],
    [pb.b, pb.toB, true],
  ];
  for (const [startNode, startMiles, startFromB] of starts) {
    for (const [endNode, endMiles, endToB] of ends) {
      const route = routeNodes(net, startNode, endNode, options.penalty ?? null);
      if (!route) continue;
      const miles = startMiles + route.miles + endMiles;
      if (!best || miles < best.miles) best = { miles, route, startFromB, endToB };
    }
  }
  if (!best) return null;

  const lastSegment = (edge: number): number =>
    (net.geomOff[edge + 1] as number) - (net.geomOff[edge] as number) - 2;

  const startGeometry = best.startFromB
    ? edgeGeometry(net, pa.edge, a.segment, a.t, lastSegment(pa.edge), 1)
    : edgeGeometry(net, pa.edge, 0, 0, a.segment, a.t).reverse();
  const endGeometry = best.endToB
    ? edgeGeometry(net, pb.edge, b.segment, b.t, lastSegment(pb.edge), 1)
    : edgeGeometry(net, pb.edge, 0, 0, b.segment, b.t).reverse();

  return {
    path: [from, ...startGeometry, ...best.route.path, ...endGeometry.slice().reverse(), to],
    networkMiles: best.miles,
    originHopMiles: a.hopMiles * hopFactor,
    destinationHopMiles: b.hopMiles * hopFactor,
    totalMiles: best.miles + (a.hopMiles + b.hopMiles) * hopFactor,
    chain: [pa.edge, ...best.route.chain, pb.edge],
  };
}

export interface CorridorOptions extends RouteOptions {
  /** How many distinct corridors to look for. Three is what was measured. */
  count?: number;
  /** Cost multiplier applied to the previous corridor's edges. */
  penaltyFactor?: number;
  /** An alternate longer than this much over the best one is not a real option. */
  maxDetourPct?: number;
}

/**
 * Up to `count` distinct corridors, best first.
 *
 * ── THE DESIGN DECISION THIS FUNCTION EXISTS FOR ──────────────────────────
 * Single-corridor routing fails in BOTH directions: on the evaluation lanes it
 * invented 4 states and MISSED 3, one of them 597 miles. Those are not the same
 * mistake. An omitted permit is an illegal load; an invented one is a phone call
 * and a small over-quote.
 *
 * So the two questions are answered from different places: the permit LIST comes
 * from the UNION of these corridors' states (measured: 0 states missed, 0 miles
 * missed) and the PRICE comes from the best corridor's miles, with the
 * alternates shown by name so a dispatcher can say which way they are running.
 * `routedMileage.ts` does that split; this function supplies the corridors.
 */
export function routeCorridors(
  net: UsNet,
  from: NetPoint,
  to: NetPoint,
  options: CorridorOptions = {},
): SnappedRoute[] {
  const count = options.count ?? 3;
  const penaltyFactor = options.penaltyFactor ?? 1.6;
  const maxDetourPct = options.maxDetourPct ?? 12;
  const penalty = new Map<number, number>();
  const corridors: SnappedRoute[] = [];

  for (let i = 0; i < count; i += 1) {
    const route = routeSnapped(net, from, to, { ...options, penalty });
    if (!route) break;
    const bestSoFar = corridors[0];
    if (bestSoFar && route.totalMiles > bestSoFar.totalMiles * (1 + maxDetourPct / 100)) break;
    corridors.push(route);
    for (const edge of route.chain) penalty.set(edge, (penalty.get(edge) ?? 1) * penaltyFactor);
  }
  return corridors;
}

// ──────────────────────────────────────────────────────────────────────────
// Coverage guard
// ──────────────────────────────────────────────────────────────────────────

/**
 * How far an address may sit from a mapped primary road before this method
 * refuses to answer.
 *
 * TIGER PRIMARYROADS IS NOT A COMPLETE ROAD NETWORK. US-50 and US-93 across
 * central Nevada are classified below S1100 and are simply absent, so the
 * nearest mapped road to Ely, Nevada is 111 miles away. Without this guard the
 * router would quietly invent that hop — and every state it crossed — and
 * present the result with the same confidence as a good one.
 *
 * 25 miles is far enough to cover an industrial park off the interstate and
 * short enough that the invented hop can never cross a state line unnoticed.
 */
export const MAX_HOP_MILES = 25;

export interface CoverageResult {
  ok: boolean;
  requiresManualReview: boolean;
  originHopMiles: number | null;
  destinationHopMiles: number | null;
  warnings: string[];
}

/**
 * Is this lane inside the network's coverage?
 *
 * Canadian endpoints fail this today (Toronto 38 mi, Montreal 34 mi to the
 * nearest US primary road) and that is CORRECT, not a bug: there are no
 * Canadian roads and no provincial boundaries in this dataset, so a Canadian
 * lane has no per-state answer to give. Refusing sends the quote back to the
 * corridor-list-and-ask path, which is right.
 */
export function coverageCheck(
  net: UsNet,
  from: NetPoint,
  to: NetPoint,
  maxHopMiles: number = MAX_HOP_MILES,
): CoverageResult {
  const a = snapToNetwork(net, from);
  const b = snapToNetwork(net, to);
  if (!a || !b) {
    return {
      ok: false,
      requiresManualReview: true,
      originHopMiles: a?.hopMiles ?? null,
      destinationHopMiles: b?.hopMiles ?? null,
      warnings: [
        'No mapped primary road was found anywhere near one end of this lane, so no route can be measured for it.',
      ],
    };
  }
  const warnings: string[] = [];
  if (a.hopMiles > maxHopMiles) {
    warnings.push(
      `The pickup is ${Math.round(a.hopMiles)} mi from the nearest road in the federal primary-road network, which is further than this method will estimate (${maxHopMiles} mi). Measuring it would invent that mileage and possibly a state with it.`,
    );
  }
  if (b.hopMiles > maxHopMiles) {
    warnings.push(
      `The delivery is ${Math.round(b.hopMiles)} mi from the nearest road in the federal primary-road network, which is further than this method will estimate (${maxHopMiles} mi). Measuring it would invent that mileage and possibly a state with it.`,
    );
  }
  return {
    ok: warnings.length === 0,
    requiresManualReview: warnings.length > 0,
    originHopMiles: a.hopMiles,
    destinationHopMiles: b.hopMiles,
    warnings,
  };
}
