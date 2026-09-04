/**
 * Build an in-process routing graph over the US primary-road network
 * (TIGER/Line PRIMARYROADS, MTFCC S1100 — interstates, US routes, state
 * principal arterials). Public domain (US Census Bureau).
 *
 * No server, no VM, no monthly cost. Loads from a single ZIP.
 */
import fs from 'node:fs';
import { unzip, parseDbf, parsePolylineShp } from './shpline.mjs';

const R_MI = 3958.7613;
const rad = (d) => (d * Math.PI) / 180;
export function haversineMiles(a, b) {
  const dLat = rad(b[1] - a[1]), dLon = rad(b[0] - a[0]);
  const la = rad(a[1]), lb = rad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLon / 2) ** 2;
  return R_MI * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

const QUANT = 1e5; // ~1.1 m
const key = (p) => `${Math.round(p[0] * QUANT)},${Math.round(p[1] * QUANT)}`;

export function loadPrimaryRoads(zipPath) {
  const bytes = new Uint8Array(fs.readFileSync(zipPath));
  const entries = unzip(bytes);
  const shp = [...entries.keys()].find((k) => k.endsWith('.shp'));
  const dbf = [...entries.keys()].find((k) => k.endsWith('.dbf'));
  const rows = parseDbf(entries.get(dbf));
  const shapes = parsePolylineShp(entries.get(shp));
  const feats = [];
  for (let i = 0; i < rows.length; i += 1) {
    if (!shapes[i] || !rows[i]) continue;
    for (const line of shapes[i]) {
      if (line.length < 2) continue;
      feats.push({ name: rows[i].FULLNAME, rttyp: rows[i].RTTYP, line });
    }
  }
  return feats;
}

export function defaultSpeed(f) {
  if (f.rttyp === 'I') return 65;
  if (/\bI-\s?\d/i.test(f.name || '')) return 65;
  if (f.rttyp === 'W') return 30; // weld/ramp: cheap but not free
  if (f.rttyp === 'U') return 50;
  return 45;
}

/**
 * @param opts.snapMeters  endpoint-to-endpoint snap tolerance
 * @param opts.classes     Set of RTTYP values to include (null = all)
 * @param opts.speedFor    (feature) => mph used as routing cost. Time-based
 *                         routing keeps the path on interstates instead of
 *                         shortcutting through slower arterials.
 */
export function buildGraph(feats, opts = {}) {
  const snapMeters = opts.snapMeters ?? 60;
  const classes = opts.classes ?? null;
  const speedFor = opts.speedFor ?? defaultSpeed;

  const nodeIndex = new Map();
  const nodes = [];
  const edges = [];
  const adj = [];

  const nodeIdFor = (p) => {
    const k = key(p);
    let id = nodeIndex.get(k);
    if (id === undefined) { id = nodes.length; nodes.push([p[0], p[1]]); adj.push([]); nodeIndex.set(k, id); }
    return id;
  };

  for (const f of feats) {
    if (classes && !classes.has(f.rttyp)) continue;
    let miles = 0;
    for (let i = 0; i + 1 < f.line.length; i += 1) miles += haversineMiles(f.line[i], f.line[i + 1]);
    if (miles <= 0) continue;
    const a = nodeIdFor(f.line[0]);
    const b = nodeIdFor(f.line[f.line.length - 1]);
    if (a === b) continue;
    const idx = edges.length;
    edges.push({ a, b, miles, cost: miles / speedFor(f), line: f.line, name: f.name, rttyp: f.rttyp });
    adj[a].push(idx); adj[b].push(idx);
  }

  // Endpoint snapping. Two ways to do it:
  //   mergeSnap:true  (default) UNION the nodes — one node, no extra edge.
  //   mergeSnap:false           add a zero-cost connector edge.
  // Merging is what makes the packed asset small: the connector form adds ~1.1M
  // edges to the US network for no routing benefit whatsoever.
  const snapMi = snapMeters / 1609.344;
  const cell = Math.max(0.0015, (snapMeters * 1.2) / 111320);
  const grid = new Map();
  for (let i = 0; i < nodes.length; i += 1) {
    const gk = `${Math.floor(nodes[i][0] / cell)},${Math.floor(nodes[i][1] / cell)}`;
    let arr = grid.get(gk); if (!arr) { arr = []; grid.set(gk, arr); }
    arr.push(i);
  }
  let snapped = 0;
  const mergeSnap = opts.mergeSnap !== false;
  const parent = mergeSnap ? new Int32Array(nodes.length).map((_, i) => i) : null;
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let i = 0; i < nodes.length; i += 1) {
    const gx = Math.floor(nodes[i][0] / cell), gy = Math.floor(nodes[i][1] / cell);
    for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) {
      const arr = grid.get(`${gx + dx},${gy + dy}`); if (!arr) continue;
      for (const j of arr) {
        if (j <= i) continue;
        const d = haversineMiles(nodes[i], nodes[j]);
        if (d > snapMi) continue;
        snapped += 1;
        if (mergeSnap) { const ra = find(i), rb = find(j); if (ra !== rb) parent[rb] = ra; }
        else {
          const idx = edges.length;
          edges.push({ a: i, b: j, miles: d, cost: d / 55, line: [nodes[i], nodes[j]], name: '(snap)', rttyp: 'X' });
          adj[i].push(idx); adj[j].push(idx);
        }
      }
    }
  }

  if (!mergeSnap) return { nodes, edges, adj, snapped };

  // rebuild with merged nodes
  const remap = new Int32Array(nodes.length).fill(-1);
  const outNodes = [];
  const outEdges = [];
  const outAdj = [];
  const idFor = (i) => {
    const r = find(i);
    if (remap[r] < 0) { remap[r] = outNodes.length; outNodes.push(nodes[r]); outAdj.push([]); }
    return remap[r];
  };
  for (const e of edges) {
    const a = idFor(e.a), b = idFor(e.b);
    if (a === b) continue;
    const idx = outEdges.length;
    outEdges.push({ a, b, miles: e.miles, cost: e.cost, line: e.line, name: e.name, rttyp: e.rttyp });
    outAdj[a].push(idx); outAdj[b].push(idx);
  }
  return { nodes: outNodes, edges: outEdges, adj: outAdj, snapped };
}

/** Binary-heap Dijkstra over edge.cost; returns geometry + road miles. */
export function route(graph, srcNode, dstNode) {
  const { edges, adj, nodes } = graph;
  const n = nodes.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prevEdge = new Int32Array(n).fill(-1);
  const prevNode = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const heap = [[0, srcNode]];
  const push = (item) => {
    heap.push(item); let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; const t = heap[p]; heap[p] = heap[i]; heap[i] = t; i = p; }
  };
  const pop = () => {
    const top = heap[0]; const last = heap.pop();
    if (heap.length) {
      heap[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let s = i;
        if (l < heap.length && heap[l][0] < heap[s][0]) s = l;
        if (r < heap.length && heap[r][0] < heap[s][0]) s = r;
        if (s === i) break;
        const t = heap[s]; heap[s] = heap[i]; heap[i] = t; i = s;
      }
    }
    return top;
  };
  dist[srcNode] = 0;
  let settled = 0;
  while (heap.length) {
    const top = pop();
    const d = top[0], u = top[1];
    if (done[u]) continue;
    done[u] = 1; settled += 1;
    if (u === dstNode) break;
    for (const ei of adj[u]) {
      const e = edges[ei];
      const v = e.a === u ? e.b : e.a;
      if (done[v]) continue;
      const nd = d + e.cost;
      if (nd < dist[v]) { dist[v] = nd; prevEdge[v] = ei; prevNode[v] = u; push([nd, v]); }
    }
  }
  if (dist[dstNode] === Infinity) return null;
  const chain = [];
  let cur = dstNode;
  while (cur !== srcNode) { const ei = prevEdge[cur]; if (ei < 0) return null; chain.push(ei); cur = prevNode[cur]; }
  chain.reverse();
  const path = [nodes[srcNode]];
  let miles = 0;
  let at = srcNode;
  for (const ei of chain) {
    const e = edges[ei];
    const forward = e.a === at;
    const line = forward ? e.line : e.line.slice().reverse();
    for (let i = 1; i < line.length; i += 1) path.push(line[i]);
    miles += e.miles;
    at = forward ? e.b : e.a;
  }
  return { path, miles, settled, hours: dist[dstNode] };
}

/** Nearest graph node to a lon/lat. */
export function makeNodeLocator(graph) {
  const cell = 0.25; // ~17 mi
  const grid = new Map();
  graph.nodes.forEach((p, i) => {
    const gk = `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)}`;
    let a = grid.get(gk); if (!a) { a = []; grid.set(gk, a); }
    a.push(i);
  });
  return function nearest(pt, filter = null) {
    const gx = Math.floor(pt[0] / cell), gy = Math.floor(pt[1] / cell);
    let best = -1, bestD = Infinity;
    for (let ring = 0; ring <= 16; ring += 1) {
      for (let dx = -ring; dx <= ring; dx += 1) for (let dy = -ring; dy <= ring; dy += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const arr = grid.get(`${gx + dx},${gy + dy}`); if (!arr) continue;
        for (const i of arr) {
          if (filter && !filter(i)) continue;
          const d = haversineMiles(pt, graph.nodes[i]);
          if (d < bestD) { bestD = d; best = i; }
        }
      }
      // one extra ring beyond the first hit, because a nearer node can live in
      // the next ring out when the point sits near a cell edge
      if (best >= 0 && ring >= 1) return { node: best, miles: bestD };
    }
    return best >= 0 ? { node: best, miles: bestD } : null;
  };
}
