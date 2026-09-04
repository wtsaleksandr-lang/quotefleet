/**
 * Stitch a fragmented road graph into one component.
 *
 * Even after planarizing, the TIGER primary-road file leaves whole corridors
 * (I-65, I-15/I-84, I-16, I-8 ...) as islands, because the junction that would
 * join them is a ramp — and ramps (MTFCC S1630) are not in this file. The fix
 * is to bridge each island to the mainland at its nearest node pair, as a
 * connector edge priced at the straight-line distance x 1.25.
 *
 * Bridges longer than maxGapMiles are refused, which correctly keeps Alaska,
 * Hawaii and Puerto Rico as separate islands.
 */
import { haversineMiles } from './buildnet.mjs';

export function componentsOf(graph) {
  const comp = new Int32Array(graph.nodes.length).fill(-1);
  let nc = 0;
  for (let s = 0; s < graph.nodes.length; s += 1) {
    if (comp[s] >= 0) continue;
    const st = [s]; comp[s] = nc;
    while (st.length) {
      const u = st.pop();
      for (const ei of graph.adj[u]) { const e = graph.edges[ei]; const v = e.a === u ? e.b : e.a; if (comp[v] < 0) { comp[v] = nc; st.push(v); } }
    }
    nc += 1;
  }
  return { comp, count: nc };
}

export function stitch(graph, opts = {}) {
  const maxGapMiles = opts.maxGapMiles ?? 25;
  const rounds = opts.rounds ?? 12;
  const bridges = [];

  for (let round = 0; round < rounds; round += 1) {
    const { comp, count } = componentsOf(graph);
    if (count <= 1) break;
    // component sizes by edge miles, so "mainland" is the road-mileage giant
    const sizes = new Float64Array(count);
    for (const e of graph.edges) sizes[comp[e.a]] += e.miles;
    let main = 0;
    for (let i = 1; i < count; i += 1) if (sizes[i] > sizes[main]) main = i;

    // grid over mainland nodes
    const cell = 0.35;
    const grid = new Map();
    for (let i = 0; i < graph.nodes.length; i += 1) {
      if (comp[i] !== main) continue;
      const p = graph.nodes[i];
      const gk = `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)}`;
      let a = grid.get(gk); if (!a) { a = []; grid.set(gk, a); }
      a.push(i);
    }

    // for every non-mainland node, nearest mainland node; keep best per component
    const best = new Map(); // compId -> {d, a, b}
    for (let i = 0; i < graph.nodes.length; i += 1) {
      const c = comp[i];
      if (c === main) continue;
      const p = graph.nodes[i];
      const gx = Math.floor(p[0] / cell), gy = Math.floor(p[1] / cell);
      let bd = Infinity, bj = -1;
      for (let ring = 0; ring <= 3; ring += 1) {
        for (let dx = -ring; dx <= ring; dx += 1) for (let dy = -ring; dy <= ring; dy += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const arr = grid.get(`${gx + dx},${gy + dy}`); if (!arr) continue;
          for (const j of arr) { const d = haversineMiles(p, graph.nodes[j]); if (d < bd) { bd = d; bj = j; } }
        }
        if (bj >= 0 && ring >= 1) break;
      }
      if (bj < 0) continue;
      const cur = best.get(c);
      if (!cur || bd < cur.d) best.set(c, { d: bd, a: i, b: bj });
    }

    let added = 0;
    for (const [c, b] of best) {
      if (b.d > maxGapMiles) continue;
      const idx = graph.edges.length;
      const miles = b.d * 1.25; // a real connector is never a straight line
      graph.edges.push({ a: b.a, b: b.b, miles, cost: miles / 40, line: [graph.nodes[b.a], graph.nodes[b.b]], name: '(bridge)', rttyp: 'B' });
      graph.adj[b.a].push(idx); graph.adj[b.b].push(idx);
      bridges.push({ comp: c, miles: b.d });
      added += 1;
    }
    if (added === 0) break;
  }

  const { comp, count } = componentsOf(graph);
  const sizes = new Float64Array(count);
  for (const e of graph.edges) sizes[comp[e.a]] += e.miles;
  let main = 0;
  for (let i = 1; i < count; i += 1) if (sizes[i] > sizes[main]) main = i;
  const total = sizes.reduce((s, v) => s + v, 0);
  return { bridges, components: count, mainlandShare: sizes[main] / total, comp, main };
}

/**
 * Heal short gaps INSIDE the connected component.
 *
 * Stitching islands is not enough. The primary-road file also contains gaps of
 * a few hundred metres in the middle of the mainland — most damagingly at
 * interchanges, where the ramps that would join two interstates are MTFCC
 * S1630 and live in a different TIGER file. The graph stays connected (you can
 * always go the long way round), so component analysis reports it healthy while
 * the router quietly detours: I-30 downtown Little Rock could not reach I-40
 * three miles north except by an 848-mile loop through Texas.
 *
 * The rule: two nodes within `maxGapMiles` of each other, whose shortest path
 * through the graph is more than `detourFactor` times that, are missing a link.
 * Add one, priced at the straight-line distance x 1.3.
 *
 * Deliberately conservative — a 1.5-mile cap means the worst a false positive
 * can do is shave a mile off a quote, while a false negative costs hundreds.
 */
export function healGaps(graph, opts = {}) {
  const maxGapMiles = opts.maxGapMiles ?? 1.5;
  const detourFactor = opts.detourFactor ?? 4;
  const { nodes, edges, adj } = graph;

  const cell = maxGapMiles / 45; // ~degrees
  const grid = new Map();
  for (let i = 0; i < nodes.length; i += 1) {
    const gk = `${Math.floor(nodes[i][0] / cell)},${Math.floor(nodes[i][1] / cell)}`;
    let a = grid.get(gk); if (!a) { a = []; grid.set(gk, a); }
    a.push(i);
  }

  // bounded Dijkstra on MILES, abandoned past `limit`
  const dist = new Float64Array(nodes.length).fill(Infinity);
  const touched = [];
  const reaches = (src, dst, limit) => {
    for (const t of touched) dist[t] = Infinity;
    touched.length = 0;
    const heap = [[0, src]];
    dist[src] = 0; touched.push(src);
    const push = (it) => { heap.push(it); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; const t = heap[p]; heap[p] = heap[i]; heap[i] = t; i = p; } };
    const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let s = i; if (l < heap.length && heap[l][0] < heap[s][0]) s = l; if (r < heap.length && heap[r][0] < heap[s][0]) s = r; if (s === i) break; const t = heap[s]; heap[s] = heap[i]; heap[i] = t; i = s; } } return top; };
    while (heap.length) {
      const [d, u] = pop();
      if (d > dist[u]) continue;
      if (u === dst) return true;
      if (d > limit) return false;
      for (const ei of adj[u]) {
        const e = edges[ei];
        const v = e.a === u ? e.b : e.a;
        const nd = d + e.miles;
        if (nd < dist[v] && nd <= limit) { if (dist[v] === Infinity) touched.push(v); dist[v] = nd; push([nd, v]); }
      }
    }
    return false;
  };

  const candidates = [];
  for (let i = 0; i < nodes.length; i += 1) {
    const gx = Math.floor(nodes[i][0] / cell), gy = Math.floor(nodes[i][1] / cell);
    for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) {
      const arr = grid.get(`${gx + dx},${gy + dy}`); if (!arr) continue;
      for (const j of arr) {
        if (j <= i) continue;
        const d = haversineMiles(nodes[i], nodes[j]);
        if (d > maxGapMiles || d < 1e-4) continue;
        candidates.push([d, i, j]);
      }
    }
  }
  candidates.sort((a, b) => a[0] - b[0]);

  let added = 0;
  for (const [d, i, j] of candidates) {
    if (reaches(i, j, d * detourFactor)) continue;
    const miles = d * 1.3;
    const idx = edges.length;
    edges.push({ a: i, b: j, miles, cost: miles / 35, line: [nodes[i], nodes[j]], name: '(gap)', rttyp: 'G' });
    adj[i].push(idx); adj[j].push(idx);
    added += 1;
  }
  return { candidates: candidates.length, added };
}

/**
 * Heal gaps between two roads that pass close to each other MID-EDGE.
 *
 * ── WHY `healGaps` ABOVE IS NOT ENOUGH ────────────────────────────────────
 * `healGaps` compares NODE to NODE. A node only exists where the planarizer
 * found a junction, so when two interstates meet through ramps that TIGER keeps
 * in a different file (MTFCC S1630), the two mainlines run past each other with
 * NO NODE ANYWHERE NEAR the interchange, and a node-to-node scan is blind to it.
 *
 * Measured, before this function existed:
 *   I-16 and I-75 in Macon, Georgia pass within 0.268 mi of each other and the
 *   graph could not turn between them: Macon -> Chattanooga routed 642 mi
 *   instead of 201, out to Savannah and back.
 *   I-10 and I-65 at Mobile, Alabama pass within 0.228 mi. Mobile -> Birmingham
 *   routed 420 mi instead of 256, around through Mississippi.
 *
 * Both are the SAME BUG the module header describes, one level down: the graph
 * was fully connected and quietly, expensively wrong. Component analysis
 * reported it healthy in both cases, which is why it is not a health check.
 *
 * ── THE RULE ──────────────────────────────────────────────────────────────
 * Two edges whose geometries come within `maxGapMiles`, where the graph's own
 * shortest path between those two places is more than `detourFactor` times the
 * distance that would be travelled through the gap, are missing an interchange.
 * Split both edges at the closest approach and link the two new nodes.
 *
 * ── THE FALSE POSITIVE, AND WHY IT IS THE CHEAP ERROR ─────────────────────
 * This can invent a turn at an overpass that has no ramps. The cap is a third
 * of `healGaps`' — half a mile — so the worst an invented interchange can do is
 * shorten a lane by a fraction of a mile. A MISSED interchange, by contrast,
 * sent one 201-mile lane 441 miles the wrong way and would have quoted permits
 * for states the truck never enters. The asymmetry decides it.
 */
export function healEdgeGaps(graph, opts = {}) {
  const maxGapMiles = opts.maxGapMiles ?? 0.5;
  const detourFactor = opts.detourFactor ?? 4;
  const { nodes, edges, adj } = graph;
  const originalEdgeCount = edges.length;

  // ── bounded Dijkstra on miles, abandoned past `limit` ────────────────────
  const dist = new Float64Array(nodes.length).fill(Infinity);
  const touched = [];
  const reaches = (src, dst, limit) => {
    if (src === dst) return true;
    for (const t of touched) dist[t] = Infinity;
    touched.length = 0;
    const heap = [[0, src]];
    dist[src] = 0; touched.push(src);
    const push = (it) => { heap.push(it); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; const t = heap[p]; heap[p] = heap[i]; heap[i] = t; i = p; } };
    const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let s = i; if (l < heap.length && heap[l][0] < heap[s][0]) s = l; if (r < heap.length && heap[r][0] < heap[s][0]) s = r; if (s === i) break; const t = heap[s]; heap[s] = heap[i]; heap[i] = t; i = s; } } return top; };
    while (heap.length) {
      const [d, u] = pop();
      if (d > dist[u]) continue;
      if (u === dst) return true;
      if (d > limit) return false;
      for (const ei of adj[u]) {
        const e = edges[ei];
        const v = e.a === u ? e.b : e.a;
        const nd = d + e.miles;
        if (nd < dist[v] && nd <= limit) { if (dist[v] === Infinity) touched.push(v); dist[v] = nd; push([nd, v]); }
      }
    }
    return false;
  };

  // ── cumulative chord distance along an edge, so a split can price halves ─
  const cumulative = (line) => {
    const cum = new Float64Array(line.length);
    for (let i = 1; i < line.length; i += 1) cum[i] = cum[i - 1] + haversineMiles(line[i - 1], line[i]);
    return cum;
  };

  // ── index every vertex of every edge into a grid of ~maxGapMiles cells ───
  const cell = maxGapMiles / 45;
  const grid = new Map();
  for (let ei = 0; ei < originalEdgeCount; ei += 1) {
    const line = edges[ei].line;
    for (let vi = 0; vi < line.length; vi += 1) {
      const key = Math.floor(line[vi][0] / cell) * 1000000 + Math.floor(line[vi][1] / cell);
      let bucket = grid.get(key);
      if (!bucket) { bucket = []; grid.set(key, bucket); }
      bucket.push(ei, vi);
    }
  }

  // ── closest approach per edge pair ───────────────────────────────────────
  const bestPerPair = new Map();
  for (let ei = 0; ei < originalEdgeCount; ei += 1) {
    const ea = edges[ei];
    const line = ea.line;
    for (let vi = 0; vi < line.length; vi += 1) {
      const gx = Math.floor(line[vi][0] / cell);
      const gy = Math.floor(line[vi][1] / cell);
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          const bucket = grid.get((gx + dx) * 1000000 + (gy + dy));
          if (!bucket) continue;
          for (let k = 0; k < bucket.length; k += 2) {
            const ej = bucket[k];
            if (ej <= ei) continue;
            const eb = edges[ej];
            // Already joined: nothing to heal, and a link would be a self-loop.
            if (eb.a === ea.a || eb.a === ea.b || eb.b === ea.a || eb.b === ea.b) continue;
            const vj = bucket[k + 1];
            const d = haversineMiles(line[vi], eb.line[vj]);
            if (d > maxGapMiles || d < 1e-6) continue;
            const key = ei * originalEdgeCount + ej;
            const prev = bestPerPair.get(key);
            if (!prev || d < prev.d) bestPerPair.set(key, { d, ei, ej, vi, vj });
          }
        }
      }
    }
  }

  // ── reachability filter, on the UNMODIFIED graph ─────────────────────────
  const cumCache = new Map();
  const cumOf = (ei) => {
    let c = cumCache.get(ei);
    if (!c) { c = cumulative(edges[ei].line); cumCache.set(ei, c); }
    return c;
  };

  const accepted = [];
  const candidates = [...bestPerPair.values()].sort((x, y) => x.d - y.d);
  for (const cand of candidates) {
    const ea = edges[cand.ei];
    const eb = edges[cand.ej];
    const ca = cumOf(cand.ei);
    const cb = cumOf(cand.ej);
    const aTotal = ca[ca.length - 1] || 1;
    const bTotal = cb[cb.length - 1] || 1;
    // The NEAREST ENDPOINT of each edge to the approach point, and how far along
    // the road it is. Testing those two nodes is what makes the detour ratio
    // measure a real driving penalty rather than an arbitrary one.
    const aFromStart = ca[cand.vi];
    const aNode = aFromStart <= aTotal - aFromStart ? ea.a : ea.b;
    const aAlong = Math.min(aFromStart, aTotal - aFromStart) * (ea.miles / aTotal);
    const bFromStart = cb[cand.vj];
    const bNode = bFromStart <= bTotal - bFromStart ? eb.a : eb.b;
    const bAlong = Math.min(bFromStart, bTotal - bFromStart) * (eb.miles / bTotal);
    const throughGap = aAlong + cand.d + bAlong;
    if (reaches(aNode, bNode, throughGap * detourFactor)) continue;
    accepted.push(cand);
  }

  // ── split each edge at every accepted vertex, once ───────────────────────
  const splitsByEdge = new Map();
  for (const cand of accepted) {
    if (!splitsByEdge.has(cand.ei)) splitsByEdge.set(cand.ei, new Set());
    if (!splitsByEdge.has(cand.ej)) splitsByEdge.set(cand.ej, new Set());
    splitsByEdge.get(cand.ei).add(cand.vi);
    splitsByEdge.get(cand.ej).add(cand.vj);
  }

  /** edgeIndex -> (vertexIndex -> nodeId) for every split point. */
  const nodeAtVertex = new Map();
  for (const [ei, vertexSet] of splitsByEdge) {
    const edge = edges[ei];
    const line = edge.line;
    const cum = cumOf(ei);
    const total = cum[cum.length - 1] || 1;
    const map = new Map();
    map.set(0, edge.a);
    map.set(line.length - 1, edge.b);
    // Endpoints are already nodes; cutting there would emit a zero-length edge.
    const cuts = [...vertexSet].filter((v) => v > 0 && v < line.length - 1).sort((x, y) => x - y);
    if (cuts.length === 0) { nodeAtVertex.set(ei, map); continue; }

    // Retire the original edge, then re-emit it in pieces.
    for (const n of [edge.a, edge.b]) {
      const at = adj[n].indexOf(ei);
      if (at >= 0) adj[n].splice(at, 1);
    }
    edge.dead = true;

    for (const v of cuts) {
      map.set(v, nodes.length);
      nodes.push(line[v]);
      adj.push([]);
    }
    const boundaries = [0, ...cuts, line.length - 1];
    for (let s = 0; s + 1 < boundaries.length; s += 1) {
      const from = boundaries[s];
      const to = boundaries[s + 1];
      // Scaled by the parent's own full-resolution mileage so the pieces sum
      // back to what the whole edge measured. Re-measuring the chords instead
      // would quietly lose the difference between chord and road length.
      const miles = ((cum[to] - cum[from]) / total) * edge.miles;
      const a = map.get(from);
      const b = map.get(to);
      const index = edges.length;
      edges.push({
        a, b, miles,
        cost: (miles / edge.miles) * edge.cost,
        line: line.slice(from, to + 1),
        name: edge.name,
        rttyp: edge.rttyp,
      });
      adj[a].push(index);
      adj[b].push(index);
    }
    nodeAtVertex.set(ei, map);
  }

  // ── link the accepted pairs ──────────────────────────────────────────────
  let added = 0;
  for (const cand of accepted) {
    const a = nodeAtVertex.get(cand.ei)?.get(cand.vi);
    const b = nodeAtVertex.get(cand.ej)?.get(cand.vj);
    if (a === undefined || b === undefined || a === b) continue;
    const miles = cand.d * 1.3;
    const index = edges.length;
    edges.push({
      a, b, miles,
      cost: miles / 35,
      line: [nodes[a], nodes[b]],
      name: '(interchange)',
      rttyp: 'G',
    });
    adj[a].push(index);
    adj[b].push(index);
    added += 1;
  }

  return { candidates: candidates.length, accepted: accepted.length, added, edgesSplit: splitsByEdge.size };
}
