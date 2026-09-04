# TIGER-NET — the routing graph, and how to rebuild it

Per-state mileage for an oversize/overweight quote, at **$0/month and $0/quote**,
computed in this process with no router, no server and no API key.

## What ships, and why it is committed

| File | Size | Committed? |
|---|---|---|
| `assets/tiger/usnet.bin.gz` | 3.5 MB | **yes** |
| `assets/tiger/usnet.manifest.json` | <1 KB | **yes** — vintage, counts, SHA-256 |
| `assets/tiger/tl_2025_us_state.zip` | 10 MB | **yes** — byte-identical to Census |
| `assets/tiger/.cache/` | 38 MB+ | no, git-ignored |

**Why committed rather than fetched at deploy.** The alternative is a boot-time
download from `www2.census.gov`, which makes every container start depend on a
third party being up, and makes a rollback to an older commit silently pick up a
newer TIGER vintage — so the same commit would quote different miles on different
days. A committed artefact makes the mileage basis a property of the commit,
which is what a quote needs it to be. 13.5 MB once a year is the price.

**Why the state archive is the raw Census ZIP.** `parseTigerLineStateZip` refuses
any URL that is not the full-resolution `tl_<year>_us_state.zip`, because
generalized cartographic (`cb_*`) boundaries move state lines by miles and would
bill road mileage to the wrong state. Repacking those polygons into a smaller
custom format would leave that check comparing a constant with itself. The 10 MB
stays and the provenance check stays real.

**Both files are US Census Bureau TIGER/Line** — works of the US federal
government, **public domain** under 17 U.S.C. § 105. No attribution clause, no
share-alike, commercial use unrestricted.

## Rebuilding

```bash
node scripts/tiger-net/build.mjs                 # downloads the ZIP if absent
node scripts/tiger-net/build.mjs --zip=<path>    # zero network calls
```

Run it when the Census publishes a new TIGER vintage — annually. Then bump
`TIGER_VINTAGE` in `build.mjs`, re-run `scripts/tiger-net/validate.ts`, and move
the bands in `MILEAGE_TIERS.routedPrimaryNetwork` if the measurement moved.

**This must never run on the server.** It peaks near **1.2 GB of RSS for ~30 s**
and reads a 38 MB shapefile. On a Replit container that is a crash loop. The
deployed app only ever reads the packed result: **~11 ms and ~25 MB**.

Current build, on this machine:

```
built       25,053 nodes  57,810 edges  30 s
  planarize junctions=73823 crossings=32035 welded=36036
  stitch    402 island bridges across 67 components
  heal      4572 node-to-node short-gap links
  interchange 1064 edge-to-edge links (712 edges split)
contracted  24,642 nodes  57,146 edges  coords 3,065,444 -> 402,993
packed      4.7 MB  ->  3.6 MB gzipped
```

## The pipeline

```
tl_2025_us_primaryroads.zip  (38 MB, MTFCC S1100, public domain)
  shpline.mjs    polyline shapefile + DBF reader
  planarize.mjs  shared-vertex junctions, true crossings, angle-filtered
                 near-crossings, dangling-end welds
  buildnet.mjs   graph assembly and Dijkstra
  stitch.mjs     island bridging, healGaps, healEdgeGaps
  pack.mjs       chain contraction, Douglas-Peucker @15 m, binary
  build.mjs      the CLI that drives all of it
```

## Four things that are not obvious, each of which cost real accuracy

**1. TIGER encodes an interchange as a shared interior vertex, not an endpoint.**
A graph that only makes nodes where features *end* cannot see it. Detroit→Buffalo
routed **1,741 mi instead of 375** until junctions were made at shared vertices.

**2. Component analysis is not a health check.** A graph can be fully connected
and catastrophically wrong, because "connected the long way round" looks
identical to "connected" until you measure a route. I-30 in Little Rock could
not reach I-40 three miles north except by an **848-mile loop through Texas**,
and the component count reported the network healthy the whole time.
`healGaps` — two nodes within 1.5 mi whose shortest path is more than 4× that
are missing a link — added 4,572 links and took aggregate per-state error from
50.2% to 30.1%.

**3. The same bug exists one level down, between edges.** `healGaps` compares
node to node, and a node only exists where the planarizer found a junction. When
two interstates meet through ramps that TIGER keeps in a *different* file (MTFCC
S1630), the mainlines pass each other with **no node anywhere near** the
interchange. I-16 and I-75 in Macon pass within **0.268 mi** and the graph could
not turn between them: Macon→Chattanooga routed **642 mi instead of 201**. I-10
and I-65 at Mobile pass within **0.228 mi**: Mobile→Birmingham routed **420
instead of 256**. `healEdgeGaps` splits both edges at the closest approach and
links them; it added 1,064 interchanges and halved the mean lane error.

**4. Snap to a point on a road, not to the nearest node.** Chain contraction
deletes every non-junction node, so on a rural corridor the nearest *node* can be
100+ miles away. `snapToNetwork` projects onto the edge and enters the graph
there — uniformly 0.1–2 mi better, and it is what makes the coverage guard
measure the real distance to pavement.

## Validating

```bash
npx tsx scripts/tiger-net/validate.ts            # cached references
npx tsx scripts/tiger-net/validate.ts --refresh  # re-fetch them
```

80 lanes against a reference router. **It is not a test** — it makes network
calls, and the unit suite must not. The numbers it produces are transcribed into
`MILEAGE_TIERS.routedPrimaryNetwork.basis` and the two guards' constants, and are
asserted offline in `src/calc/heavyHaul/routedMileage.test.ts` against the
published I-40 and I-81 route logs, which are the only real ground truth here.

Last measured, on the 66 lanes of 80 that pass the guards:

```
TOTAL MILES |error|   mean 2.10%  p50 0.69%  p90 6.12%  p95 8.93%  max 13.05%
  scalar x1.18        mean 4.81%                                   max 12.33%
  geodesic            mean 12.24%                                  max 21.83%

PER-STATE |error|, corridors agreeing, legs >= 25 mi
                      mean 2.68%  p90 9.28%  p95 14.44%  max 57.61%

CORRIDOR AGREEMENT    corridors cross the same states  56/66 (85%)
                      best corridor == reference       56/66 (85%)

FAILURE DIRECTION     states the best corridor missed  12
                      states the UNION still missed     1   <- the one that matters
```
