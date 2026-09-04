/**
 * The zero-cost router: build once, query in-process, no server, no monthly bill.
 *
 * Data: TIGER/Line PRIMARYROADS (MTFCC S1100) — US Census Bureau, PUBLIC DOMAIN.
 *       38 MB ZIP, downloaded once, cached on disk.
 *
 * Pipeline:  ZIP -> features -> planarize (crossings + dangling ends)
 *            -> graph -> stitch islands -> Dijkstra on travel time
 *
 * A quote route = local hop (address -> nearest primary road) + network route
 * + local hop. The local hops are charged to the endpoint states, which is the
 * right failure direction: it never removes a state, it only adds miles to one
 * we are already certain about.
 */
import { loadPrimaryRoads, buildGraph, route as dijkstra, makeNodeLocator, haversineMiles } from './buildnet.mjs';
import { planarize3, dedupeFeatures } from './planarize.mjs';
import { stitch, healGaps, healEdgeGaps } from './stitch.mjs';

export const PRIMARY_ROADS_ZIP = 'cache/tl_2025_us_primaryroads.zip';
export const PRIMARY_ROADS_URL =
  'https://www2.census.gov/geo/tiger/TIGER2025/PRIMARYROADS/tl_2025_us_primaryroads.zip';

let cachedNet = null;

export function buildNetwork(opts = {}) {
  const zip = opts.zipPath ?? PRIMARY_ROADS_ZIP;
  const raw = loadPrimaryRoads(zip);
  const feats = opts.dedupe === false ? raw : dedupeFeatures(raw);
  const { pieces, stats } = planarize3(feats, { endTolMeters: opts.endTolMeters ?? 250 });
  const graph = buildGraph(pieces, { snapMeters: opts.snapMeters ?? 200, speedFor: opts.speedFor });
  const st = stitch(graph, { maxGapMiles: opts.maxGapMiles ?? 25 });
  const heal = healGaps(graph, { maxGapMiles: opts.healMiles ?? 1.5, detourFactor: opts.detourFactor ?? 4 });
  // Node-to-node healing above cannot see an interchange whose two mainlines
  // carry no node near it — Macon and Mobile both failed that way. This second
  // pass works edge-to-edge and splits where it has to.
  const healEdges = healEdgeGaps(graph, {
    maxGapMiles: opts.healEdgeMiles ?? 0.5,
    detourFactor: opts.detourFactor ?? 4,
  });
  const locate = makeNodeLocator(graph);
  return { graph, locate, planarizeStats: stats, stitchStats: st, healStats: heal, healEdgeStats: healEdges };
}

export function network(opts = {}) {
  if (!cachedNet) cachedNet = buildNetwork(opts);
  return cachedNet;
}

/**
 * Route between two [lon,lat] points.
 * Returns { path, networkMiles, originHopMiles, destHopMiles, totalMiles }.
 * `path` includes the local hops as straight segments so the state split sees
 * them (they land in the endpoint state, which is what we want).
 */
export function routePoints(net, from, to, opts = {}) {
  const hopFactor = opts.hopFactor ?? 1.25;
  const a = net.locate(from);
  const b = net.locate(to);
  if (!a || !b) return null;
  const r = dijkstra(net.graph, a.node, b.node);
  if (!r) return null;
  const originHop = a.miles * hopFactor;
  const destHop = b.miles * hopFactor;
  const path = [from, ...r.path, to];
  return {
    path,
    networkMiles: r.miles,
    originHopMiles: originHop,
    destHopMiles: destHop,
    totalMiles: r.miles + originHop + destHop,
    hopFactor,
    entryNodeMiles: a.miles,
    exitNodeMiles: b.miles,
  };
}
