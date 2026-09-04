/**
 * Planarize TIGER PRIMARYROADS into a routable network — v3 (the one that works).
 *
 * The thing that broke v1/v2: TIGER already encodes an interchange as a VERTEX
 * SHARED BY BOTH FEATURES, mid-line on each. A graph that only makes nodes at
 * feature endpoints therefore sees I-75 and the Ohio Turnpike as two lines that
 * never meet, and the router detours 1,400 miles around it. Splitting at shared
 * vertices is what turns the file into a network.
 *
 * Order of operations:
 *   0. DEDUPE      TIGER stores a concurrency as several identical features
 *                  ("Ohio Tpke" == "I- 80" == "I- 90"). Identical geometry is
 *                  collapsed to one feature, keeping the most specific name,
 *                  or every shared vertex would become a junction.
 *   A. SHARED VERTICES   coordinates used by 2+ distinct features -> junction.
 *   B. TRUE CROSSINGS    geometry that crosses without a shared vertex.
 *   C. DANGLING ENDS     an endpoint sitting within tolerance of another
 *                        feature's line (the ramps TIGER omits).
 *
 * Licence: TIGER/Line, US Census Bureau — PUBLIC DOMAIN.
 */

const CELL = 0.05;
const cellKey = (gx, gy) => gx * 100000 + gy;
const VQ = 1e6; // ~0.11 m — TIGER coordinates are stored to 1e-7ish
const vkey = (p) => `${Math.round(p[0] * VQ)},${Math.round(p[1] * VQ)}`;

function segIntersect(p1, p2, p3, p4) {
  const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
  if (d === 0) return null;
  const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
  const u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
  if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return null;
  return { t, u, pt: [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])] };
}

function pointSeg(p, a, b, kx) {
  const vx = (b[0] - a[0]) * kx, vy = b[1] - a[1];
  const wx = (p[0] - a[0]) * kx, wy = p[1] - a[1];
  const len2 = vx * vx + vy * vy;
  let t = len2 === 0 ? 0 : (wx * vx + wy * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  const dx = wx - t * vx, dy = wy - t * vy;
  return { t, d2: dx * dx + dy * dy };
}

const specificity = (n) => (/^I-/i.test(n || '') ? 3 : /^US Hwy/i.test(n || '') ? 2 : 1);

/** Collapse features whose geometry is identical (TIGER concurrency aliases). */
export function dedupeFeatures(feats) {
  const byGeom = new Map();
  for (const f of feats) {
    const k = `${vkey(f.line[0])}|${vkey(f.line[f.line.length - 1])}|${f.line.length}`;
    const cur = byGeom.get(k);
    if (!cur) { byGeom.set(k, f); continue; }
    if (specificity(f.name) > specificity(cur.name)) byGeom.set(k, f);
  }
  return [...byGeom.values()];
}

export function planarize3(feats, opts = {}) {
  const endTolMeters = opts.endTolMeters ?? 250;
  const endTolDeg = endTolMeters / 111320;
  const nearCrossMeters = opts.nearCrossMeters ?? 150;
  const nearCrossDeg = nearCrossMeters / 111320;
  const MAX_COS = Math.cos((opts.minCrossAngleDeg ?? 25) * Math.PI / 180);

  // ---- segment index ------------------------------------------------------
  const buckets = new Map();
  for (let f = 0; f < feats.length; f += 1) {
    const line = feats[f].line;
    for (let s = 0; s + 1 < line.length; s += 1) {
      const a = line[s], b = line[s + 1];
      const gx0 = Math.floor(Math.min(a[0], b[0]) / CELL), gx1 = Math.floor(Math.max(a[0], b[0]) / CELL);
      const gy0 = Math.floor(Math.min(a[1], b[1]) / CELL), gy1 = Math.floor(Math.max(a[1], b[1]) / CELL);
      for (let gx = gx0; gx <= gx1; gx += 1) for (let gy = gy0; gy <= gy1; gy += 1) {
        const k = cellKey(gx, gy);
        let arr = buckets.get(k); if (!arr) { arr = []; buckets.set(k, arr); }
        arr.push(f, s);
      }
    }
  }

  // ---- A. shared vertices, but only where the SHARING CHANGES --------------
  // A vertex shared by two features is a junction only at the ENDS of the
  // shared run. TIGER encodes a concurrency (I-80 == I-90 == "Ohio Tpke" for
  // 400 miles) as several features with identical vertices; splitting at every
  // one of those produced 670k nodes and a 49 MB asset for no routing benefit.
  const vertexOwners = new Map(); // vkey -> feature id | Set(feature ids)
  for (let f = 0; f < feats.length; f += 1) {
    for (const p of feats[f].line) {
      const k = vkey(p);
      const cur = vertexOwners.get(k);
      if (cur === undefined) vertexOwners.set(k, f);
      else if (typeof cur === 'number') { if (cur !== f) vertexOwners.set(k, new Set([cur, f])); }
      else cur.add(f);
    }
  }
  const partnerSig = (p, f) => {
    const cur = vertexOwners.get(vkey(p));
    if (cur === undefined || typeof cur === 'number') return '';
    const others = [...cur].filter((x) => x !== f);
    return others.length ? others.sort((a, b) => a - b).join(',') : '';
  };
  const isShared = (p) => {
    const cur = vertexOwners.get(vkey(p));
    return cur !== undefined && typeof cur !== 'number';
  };
  // per-feature junction flags: a vertex where the partner set differs from the
  // previous vertex's, or from the next vertex's
  const junctionFlags = [];
  for (let f = 0; f < feats.length; f += 1) {
    const line = feats[f].line;
    const sigs = new Array(line.length);
    for (let i = 0; i < line.length; i += 1) sigs[i] = partnerSig(line[i], f);
    const flags = new Uint8Array(line.length);
    for (let i = 0; i < line.length; i += 1) {
      const prev = i > 0 ? sigs[i - 1] : null;
      const next = i + 1 < line.length ? sigs[i + 1] : null;
      flags[i] = (sigs[i] !== '' && (sigs[i] !== prev || sigs[i] !== next)) ? 1 : 0;
    }
    junctionFlags.push(flags);
  }

  // ---- split bookkeeping --------------------------------------------------
  const splits = feats.map(() => new Map());
  const addSplit = (f, s, t, pt) => {
    if (t <= 1e-12 || t >= 1 - 1e-12) return;
    let m = splits[f].get(s); if (!m) { m = []; splits[f].set(s, m); }
    m.push({ t, pt });
  };

  // ---- B. true crossings + angle-filtered near-crossings -------------------
  let crossings = 0, nearCrossings = 0;
  const seen = new Set();
  const welds = [];
  for (const arr of buckets.values()) {
    const n = arr.length / 2;
    if (n < 2) continue;
    for (let i = 0; i < n; i += 1) {
      const fi = arr[i * 2], si = arr[i * 2 + 1];
      const a1 = feats[fi].line[si], a2 = feats[fi].line[si + 1];
      for (let j = i + 1; j < n; j += 1) {
        const fj = arr[j * 2], sj = arr[j * 2 + 1];
        if (fi === fj) continue;
        const b1 = feats[fj].line[sj], b2 = feats[fj].line[sj + 1];
        if (Math.min(a1[0], a2[0]) > Math.max(b1[0], b2[0])) continue;
        if (Math.max(a1[0], a2[0]) < Math.min(b1[0], b2[0])) continue;
        if (Math.min(a1[1], a2[1]) > Math.max(b1[1], b2[1])) continue;
        if (Math.max(a1[1], a2[1]) < Math.min(b1[1], b2[1])) continue;
        const x = segIntersect(a1, a2, b1, b2);
        if (x) {
          const k = vkey(x.pt);
          if (seen.has(k)) continue;
          seen.add(k);
          addSplit(fi, si, x.t, x.pt); addSplit(fj, sj, x.u, x.pt);
          crossings += 1;
          continue;
        }
        // NEAR-CROSSING, angle-filtered. A grade-separated interchange (I-30 x
        // I-40 at Little Rock) has no shared vertex and no 2-D intersection —
        // the ramps that join them are MTFCC S1630 and are not in this file, so
        // without this the router cannot get from I-30 onto I-40 at all and
        // detours 800 miles. The angle filter is what stops this from welding
        // the two carriageways of one divided highway together at every vertex:
        // carriageways are parallel (~0 deg), interchanges cross at an angle.
        if (nearCrossDeg <= 0) continue;
        const kx = Math.cos((a1[1] * Math.PI) / 180);
        const d1x = (a2[0] - a1[0]) * kx, d1y = a2[1] - a1[1];
        const d2x = (b2[0] - b1[0]) * kx, d2y = b2[1] - b1[1];
        const n1 = Math.hypot(d1x, d1y), n2 = Math.hypot(d2x, d2y);
        if (n1 === 0 || n2 === 0) continue;
        const cosang = Math.abs((d1x * d2x + d1y * d2y) / (n1 * n2));
        if (cosang > MAX_COS) continue;           // too close to parallel
        let bestPair = null;
        for (const [p, of_, os_, o1, o2, isA] of [[a1, fj, sj, b1, b2, true], [a2, fj, sj, b1, b2, true], [b1, fi, si, a1, a2, false], [b2, fi, si, a1, a2, false]]) {
          const rr = pointSeg(p, o1, o2, kx);
          if (rr.d2 > nearCrossDeg * nearCrossDeg) continue;
          if (!bestPair || rr.d2 < bestPair.d2) bestPair = { p, of_, os_, t: rr.t, d2: rr.d2, isA };
        }
        if (!bestPair) continue;
        const bp = bestPair;
        const target = feats[bp.of_].line;
        const pt = [target[bp.os_][0] + bp.t * (target[bp.os_ + 1][0] - target[bp.os_][0]),
                    target[bp.os_][1] + bp.t * (target[bp.os_ + 1][1] - target[bp.os_][1])];
        const k2 = vkey(pt);
        if (seen.has(k2)) continue;
        seen.add(k2);
        addSplit(bp.of_, bp.os_, bp.t, pt);
        nearCrossings += 1;
        welds.push([[bp.p[0], bp.p[1]], pt]);
      }
    }
  }
  seen.clear();

  // ---- C. dangling endpoints ---------------------------------------------
  for (let f = 0; f < feats.length; f += 1) {
    const line = feats[f].line;
    for (const p of [line[0], line[line.length - 1]]) {
      // NB: do NOT skip when this vertex is already shared with SOME feature.
      // I-30 ends ON I-40 at North Little Rock while also sharing its endpoint
      // with its own carriageway pair; skipping on "already shared" left the
      // whole of I-40 across eastern Arkansas as an island and cost the router
      // 780 miles on the Houston -> Buffalo lane.
      const kx = Math.cos((p[1] * Math.PI) / 180);
      let best = null;
      const gx = Math.floor(p[0] / CELL), gy = Math.floor(p[1] / CELL);
      for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) {
        const arr = buckets.get(cellKey(gx + dx, gy + dy)); if (!arr) continue;
        for (let i = 0; i < arr.length; i += 2) {
          const fo = arr[i]; if (fo === f) continue;
          const so = arr[i + 1];
          const a = feats[fo].line[so], b = feats[fo].line[so + 1];
          const r = pointSeg(p, a, b, kx);
          if (r.d2 > endTolDeg * endTolDeg) continue;
          if (!best || r.d2 < best.d2) best = { fo, so, t: r.t, d2: r.d2, a, b };
        }
      }
      if (!best) continue;
      const pt = [best.a[0] + best.t * (best.b[0] - best.a[0]), best.a[1] + best.t * (best.b[1] - best.a[1])];
      addSplit(best.fo, best.so, best.t, pt);
      welds.push([[p[0], p[1]], pt]);
    }
  }

  // ---- rebuild ------------------------------------------------------------
  const out = [];
  for (let f = 0; f < feats.length; f += 1) {
    const line = feats[f].line;
    const sp = splits[f];
    const pts = [line[0]];
    const isJ = [true];
    for (let s = 0; s + 1 < line.length; s += 1) {
      const list = sp.get(s);
      if (list) {
        list.sort((x, y) => x.t - y.t);
        for (const it of list) {
          const last = pts[pts.length - 1];
          if (Math.abs(last[0] - it.pt[0]) < 1e-9 && Math.abs(last[1] - it.pt[1]) < 1e-9) { isJ[isJ.length - 1] = true; continue; }
          pts.push(it.pt); isJ.push(true);
        }
      }
      const nxt = line[s + 1];
      pts.push(nxt);
      isJ.push(s + 2 === line.length || junctionFlags[f][s + 1] === 1);
    }
    let start = 0;
    for (let i = 1; i < pts.length; i += 1) {
      if (!isJ[i]) continue;
      const piece = pts.slice(start, i + 1);
      if (piece.length >= 2) out.push({ name: feats[f].name, rttyp: feats[f].rttyp, line: piece });
      start = i;
    }
  }
  for (const [p, q] of welds) {
    if (Math.abs(p[0] - q[0]) < 1e-12 && Math.abs(p[1] - q[1]) < 1e-12) continue;
    out.push({ name: '(weld)', rttyp: 'W', line: [p, q] });
  }
  let sharedCount = 0;
  for (const fl of junctionFlags) for (const v of fl) sharedCount += v;
  return { pieces: out, welds, stats: { crossings, nearCrossings, welded: welds.length, sharedVertexJunctions: sharedCount } };
}
