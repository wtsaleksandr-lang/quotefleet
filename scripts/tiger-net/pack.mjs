/**
 * Compact the built graph into a single binary asset, so the app never parses
 * a shapefile at runtime.
 *
 *  Pure functions only. `build.mjs` is the CLI that drives them.
 *
 * Two reductions:
 *   1. CHAIN CONTRACTION  a node with exactly two incident edges is not a
 *      junction; the two edges become one, geometry concatenated, miles summed.
 *      Splitting at every shared vertex creates hundreds of thousands of these.
 *   2. TYPED ARRAYS       coordinates as int32 at 1e-6 deg (~11 cm), edges as
 *      fixed-width records. No JS objects, so the runtime heap is the buffer.
 *
 * Format (little-endian), "USNET2":
 *   magic "USNET2" u16 version
 *   u32 nodeCount, edgeCount, coordCount, nameCount, nameBytesLength
 *   int32[nodeCount*2]   node lon,lat  (x1e6)
 *   int32[edgeCount*2]   edge a,b
 *   float32[edgeCount]   edge miles
 *   float32[edgeCount]   edge cost (hours)
 *   uint32[edgeCount+1]  geometry offset into coord pool (prefix)
 *   int32[coordCount*2]  coord pool lon,lat (x1e6)
 *   uint16[edgeCount]    route-name index  (pad to 4)
 *   uint32[nameCount+1]  name offset (prefix, into the utf-8 blob)
 *   utf8[nameBytesLength] name blob
 *
 * ── WHY NAMES ARE IN HERE ─────────────────────────────────────────────────
 * The alternates this graph produces have to be shown to a dispatcher as
 * something they recognise. "Corridor 2, 1,567 mi" is not a choice anyone can
 * make; "via I-55 / Memphis" is. Names are the highest-value 120 KB in the
 * asset: there are only a few thousand distinct route names across 55,664
 * edges, so a u16 index plus a shared blob costs about 2 bytes an edge.
 */

const S = 1e6;

export function contract(graph) {
  const { nodes, edges, adj } = graph;
  // NOT a typed array: contraction APPENDS merged edges, and writing past the
  // end of a Uint8Array is silently dropped — which quietly deletes every
  // merged edge and disconnects the network.
  // `healEdgeGaps` RETIRES an edge when it splits it: the pieces are appended
  // and the parent is flagged. Treating a retired parent as alive would emit the
  // road twice and let the router drive straight past the interchange it was
  // split to create.
  const alive = edges.map((e) => (e.dead ? 0 : 1));

  const neighbourEdges = (n) => adj[n].filter((ei) => alive[ei]);

  for (let n = 0; n < nodes.length; n += 1) {
    for (;;) {
      const es = neighbourEdges(n);
      if (es.length !== 2) break;
      const [i, j] = es;
      const e1 = edges[i], e2 = edges[j];
      // do not contract across a class change — the road name/type is used for
      // the cost model and for explaining the route
      if (e1.rttyp !== e2.rttyp) break;
      const a = e1.a === n ? e1.b : e1.a;
      const b = e2.a === n ? e2.b : e2.a;
      if (a === b) break; // would make a self-loop
      const l1 = e1.a === n ? e1.line.slice().reverse() : e1.line;   // ends at n
      const l2 = e2.a === n ? e2.line : e2.line.slice().reverse();   // starts at n
      const line = l1.concat(l2.slice(1));
      alive[i] = 0; alive[j] = 0;
      const idx = edges.length;
      edges.push({ a, b, miles: e1.miles + e2.miles, cost: e1.cost + e2.cost, line, name: e1.name, rttyp: e1.rttyp });
      alive[idx] = 1;
      adj[a].push(idx); adj[b].push(idx);
      adj[n] = [];
      break;
    }
  }

  // rebuild dense
  const nodeMap = new Int32Array(nodes.length).fill(-1);
  const outNodes = [];
  const outEdges = [];
  for (let ei = 0; ei < edges.length; ei += 1) {
    if (!alive[ei]) continue;
    const e = edges[ei];
    for (const nd of [e.a, e.b]) {
      if (nodeMap[nd] < 0) { nodeMap[nd] = outNodes.length; outNodes.push(nodes[nd]); }
    }
    outEdges.push({ a: nodeMap[e.a], b: nodeMap[e.b], miles: e.miles, cost: e.cost, line: e.line, name: e.name, rttyp: e.rttyp });
  }
  return { nodes: outNodes, edges: outEdges };
}

/** Douglas-Peucker in degrees, scaled for latitude. Length is NOT recomputed —
 *  edge.miles keeps the full-resolution figure, so simplification only affects
 *  where a state boundary is crossed, by at most the tolerance. */
export function simplifyGraph(g, toleranceMeters = 15) {
  const tol = toleranceMeters / 111320;
  let before = 0, after = 0;
  for (const e of g.edges) {
    before += e.line.length;
    e.line = dp(e.line, tol);
    after += e.line.length;
  }
  return { before, after };
}
function dp(line, tol) {
  if (line.length < 3) return line;
  const keep = new Uint8Array(line.length);
  keep[0] = 1; keep[line.length - 1] = 1;
  const kx = Math.cos((line[0][1] * Math.PI) / 180);
  const stack = [[0, line.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let best = -1, bestD = tol;
    const a = line[i], b = line[j];
    const vx = (b[0] - a[0]) * kx, vy = b[1] - a[1];
    const len2 = vx * vx + vy * vy;
    for (let k = i + 1; k < j; k += 1) {
      const wx = (line[k][0] - a[0]) * kx, wy = line[k][1] - a[1];
      let t = len2 === 0 ? 0 : (wx * vx + wy * vy) / len2;
      t = Math.max(0, Math.min(1, t));
      const dx = wx - t * vx, dy = wy - t * vy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > bestD) { bestD = d; best = k; }
    }
    if (best > 0) { keep[best] = 1; stack.push([i, best], [best, j]); }
  }
  const out = [];
  for (let i = 0; i < line.length; i += 1) if (keep[i]) out.push(line[i]);
  return out;
}

/**
 * TIGER writes interstate names with a space after the dash ("I- 40") and pads
 * US routes the same way. Left alone, a corridor label reads as a typo, and two
 * spellings of the same road split the name table.
 */
export function normaliseRouteName(raw) {
  const name = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (name === '' || name === '(snap)') return '';
  return name.replace(/^([A-Za-z]+)-\s+/, '$1-');
}

export function pack(g) {
  const nodeCount = g.nodes.length;
  const edgeCount = g.edges.length;
  let coordCount = 0;
  for (const e of g.edges) coordCount += e.line.length;

  // Name table: one entry per DISTINCT route name, u16 index per edge. Index 0
  // is always the empty name, so an unnamed weld or ramp needs no special case.
  const nameIndex = new Map([['', 0]]);
  const names = [''];
  const edgeName = new Uint16Array(edgeCount);
  for (let i = 0; i < edgeCount; i += 1) {
    const name = normaliseRouteName(g.edges[i].name);
    let id = nameIndex.get(name);
    if (id === undefined) {
      if (names.length >= 65535) {
        // u16 would wrap and silently mislabel every corridor past the limit.
        throw new Error(`Route-name table overflowed u16 (${names.length} names).`);
      }
      id = names.length;
      nameIndex.set(name, id);
      names.push(name);
    }
    edgeName[i] = id;
  }
  const nameBuffers = names.map((n) => Buffer.from(n, 'utf8'));
  const nameBytesLength = nameBuffers.reduce((sum, b) => sum + b.length, 0);

  const header = 28;
  const namePad = (edgeCount * 2) % 4 === 0 ? 0 : 4 - ((edgeCount * 2) % 4);
  const bytes =
    header +
    nodeCount * 8 +
    edgeCount * 8 +
    edgeCount * 4 +
    edgeCount * 4 +
    (edgeCount + 1) * 4 +
    coordCount * 8 +
    edgeCount * 2 +
    namePad +
    (names.length + 1) * 4 +
    nameBytesLength;

  const buf = Buffer.alloc(bytes);
  buf.write('USNET2', 0, 'ascii');
  buf.writeUInt16LE(2, 6);
  buf.writeUInt32LE(nodeCount, 8);
  buf.writeUInt32LE(edgeCount, 12);
  buf.writeUInt32LE(coordCount, 16);
  buf.writeUInt32LE(names.length, 20);
  buf.writeUInt32LE(nameBytesLength, 24);

  let o = header;
  for (const p of g.nodes) {
    buf.writeInt32LE(Math.round(p[0] * S), o);
    buf.writeInt32LE(Math.round(p[1] * S), o + 4);
    o += 8;
  }
  for (const e of g.edges) {
    buf.writeInt32LE(e.a, o);
    buf.writeInt32LE(e.b, o + 4);
    o += 8;
  }
  for (const e of g.edges) { buf.writeFloatLE(e.miles, o); o += 4; }
  for (const e of g.edges) { buf.writeFloatLE(e.cost, o); o += 4; }
  let acc = 0;
  for (const e of g.edges) { buf.writeUInt32LE(acc, o); o += 4; acc += e.line.length; }
  buf.writeUInt32LE(acc, o); o += 4;
  for (const e of g.edges) {
    for (const p of e.line) {
      buf.writeInt32LE(Math.round(p[0] * S), o);
      buf.writeInt32LE(Math.round(p[1] * S), o + 4);
      o += 8;
    }
  }
  for (let i = 0; i < edgeCount; i += 1) { buf.writeUInt16LE(edgeName[i], o); o += 2; }
  o += namePad;
  let nameAcc = 0;
  for (const b of nameBuffers) { buf.writeUInt32LE(nameAcc, o); o += 4; nameAcc += b.length; }
  buf.writeUInt32LE(nameAcc, o); o += 4;
  for (const b of nameBuffers) { b.copy(buf, o); o += b.length; }

  if (o !== bytes) throw new Error(`pack wrote ${o} bytes, expected ${bytes}`);
  return buf;
}
