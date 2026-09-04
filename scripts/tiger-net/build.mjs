/**
 * BUILD STEP for the TIGER-NET routing graph. Run once per TIGER vintage.
 *
 *   node scripts/tiger-net/build.mjs
 *
 * ── THIS NEVER RUNS ON THE SERVER ─────────────────────────────────────────
 * It peaks around 1.2 GB of RSS for ~15 seconds and reads a 38 MB shapefile.
 * The deployed app reads only the packed artefact this writes, which loads in
 * ~11 ms. Running the build at boot would turn a 4 GB Replit container into a
 * crash loop, so the artefact is COMMITTED and this script is a maintenance
 * tool, not part of any start-up path.
 *
 * ── DATA AND LICENCE ──────────────────────────────────────────────────────
 * TIGER/Line PRIMARYROADS (MTFCC S1100), US Census Bureau. Works of the US
 * federal government are PUBLIC DOMAIN (17 U.S.C. § 105): no attribution is
 * required, there is no share-alike clause, and commercial use is unrestricted.
 * We cite it anyway because a quote should say where its miles came from.
 *
 * ── OUTPUT ────────────────────────────────────────────────────────────────
 *   assets/tiger/usnet.bin.gz        the graph the app ships
 *   assets/tiger/usnet.manifest.json vintage, source URL, counts, checksum
 *
 * The source ZIP is downloaded to assets/tiger/.cache/ (git-ignored) if absent.
 * Pass --zip=<path> to build from a local copy and make zero network calls.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildNetwork } from './net.mjs';
import { contract, simplifyGraph, pack } from './pack.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const ASSETS = path.join(REPO, 'assets', 'tiger');
const CACHE = path.join(ASSETS, '.cache');

export const TIGER_VINTAGE = '2025';
export const PRIMARY_ROADS_URL = `https://www2.census.gov/geo/tiger/TIGER${TIGER_VINTAGE}/PRIMARYROADS/tl_${TIGER_VINTAGE}_us_primaryroads.zip`;

/**
 * Douglas–Peucker tolerance, in metres.
 *
 * Takes the asset from 19.7 MB to 4.5 MB. Edge LENGTHS are kept at full
 * resolution by `simplifyGraph` — it rewrites the geometry and leaves
 * `edge.miles` alone — so this can only move WHERE a state boundary is crossed,
 * by at most 15 m. Measured against the published I-40/I-81 route logs it
 * changed the answer by 0.01 percentage points.
 */
const SIMPLIFY_METERS = 15;

/**
 * Junction snap tolerance, in metres.
 *
 * 25 m, not the 200 m the exploratory build used. Divided carriageways sit
 * ~30 m apart, so a tolerance above that welds the two directions of every
 * interstate into one line and the graph explodes.
 */
const SNAP_METERS = 25;

async function ensureZip(explicit) {
  if (explicit) return explicit;
  const local = path.join(CACHE, `tl_${TIGER_VINTAGE}_us_primaryroads.zip`);
  if (fs.existsSync(local)) return local;
  fs.mkdirSync(CACHE, { recursive: true });
  process.stdout.write(`downloading ${PRIMARY_ROADS_URL}\n`);
  const res = await fetch(PRIMARY_ROADS_URL);
  if (!res.ok) throw new Error(`Census download failed: ${res.status} ${res.statusText}`);
  fs.writeFileSync(local, Buffer.from(await res.arrayBuffer()));
  return local;
}

async function main() {
  const zipArg = process.argv.find((a) => a.startsWith('--zip='));
  const zipPath = await ensureZip(zipArg ? zipArg.slice('--zip='.length) : null);
  fs.mkdirSync(ASSETS, { recursive: true });

  const t0 = Date.now();
  const net = buildNetwork({ zipPath, snapMeters: SNAP_METERS });
  const built = Date.now() - t0;
  console.log(
    `built       ${net.graph.nodes.length.toLocaleString()} nodes  ` +
      `${net.graph.edges.length.toLocaleString()} edges  ${built} ms`,
  );
  console.log(
    `  planarize junctions=${net.planarizeStats.sharedVertexJunctions} ` +
      `crossings=${net.planarizeStats.crossings} welded=${net.planarizeStats.welded}`,
  );
  console.log(`  stitch    ${net.stitchStats.bridges.length} island bridges across ${net.stitchStats.components} components`);
  console.log(`  heal      ${net.healStats.added} node-to-node short-gap links`);
  console.log(
    `  interchange ${net.healEdgeStats.added} edge-to-edge links ` +
      `(${net.healEdgeStats.edgesSplit} edges split, ${net.healEdgeStats.candidates} candidates)`,
  );

  const contracted = contract(net.graph);
  const simplified = simplifyGraph(contracted, SIMPLIFY_METERS);
  console.log(
    `contracted  ${contracted.nodes.length.toLocaleString()} nodes  ` +
      `${contracted.edges.length.toLocaleString()} edges  ` +
      `coords ${simplified.before.toLocaleString()} -> ${simplified.after.toLocaleString()}`,
  );

  const buf = pack(contracted);
  const gz = zlib.gzipSync(buf, { level: 9 });
  fs.writeFileSync(path.join(ASSETS, 'usnet.bin.gz'), gz);

  const manifest = {
    format: 'USNET2',
    tigerVintage: TIGER_VINTAGE,
    sourceUrl: PRIMARY_ROADS_URL,
    licence: 'US Census Bureau TIGER/Line — work of the US federal government, public domain (17 U.S.C. § 105).',
    builtBy: 'scripts/tiger-net/build.mjs',
    simplifyMeters: SIMPLIFY_METERS,
    snapMeters: SNAP_METERS,
    nodeCount: contracted.nodes.length,
    edgeCount: contracted.edges.length,
    coordCount: simplified.after,
    uncompressedBytes: buf.length,
    gzipBytes: gz.length,
    sha256: crypto.createHash('sha256').update(buf).digest('hex'),
  };
  fs.writeFileSync(
    path.join(ASSETS, 'usnet.manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  console.log(
    `packed      ${(buf.length / 1e6).toFixed(1)} MB  ->  ${(gz.length / 1e6).toFixed(1)} MB gzipped`,
  );
  console.log(`sha256      ${manifest.sha256}`);
  console.log(`total       ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
