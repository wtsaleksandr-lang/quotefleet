/**
 * PER-JURISDICTION MILEAGE — how the engine is TOLD the miles, never how it
 * guesses them.
 *
 * `types.ts` has carried `MILEAGE_SPLIT_NOTE` since Phase 1 and `engine.ts`
 * refuses to price a distance-priced state without in-state miles:
 *
 *     missing.push('miles travelled inside the state')
 *
 * THAT REFUSAL IS CORRECT AND THIS MODULE DOES NOT WEAKEN IT. Nothing here
 * invents a mileage, estimates one from a great-circle line, or divides a lane
 * total by the number of states. Every function below either splits a REAL
 * routed polyline or hands back miles a human supplied — and both label
 * themselves, because a mileage figure that silently varies from the filed route
 * misprices every per-mile and ton-mile state on the lane.
 *
 * WHAT THAT IS WORTH IN DOLLARS, so the labelling is not treated as garnish.
 * Tennessee charges 6¢ per ton-mile: at 40 tons over the legal limit, ONE
 * WRONG MILE is $2.40, and being fifty miles out on the Tennessee leg of a
 * corridor is $120 on that state alone. Arkansas is worse in a different way —
 * its mileage bands select the RATE ($8.00/ton at 100 miles, $16.00/ton past
 * 251) and the published table has a HOLE at exactly 251 miles, so a mileage
 * that lands there produces no priceable band at all.
 *
 * ── TWO WAYS TO SUPPLY MILES, AND A THIRD THAT IS DELIBERATELY ABSENT ──────
 *
 *   1. `splitRouteMileageByState` — intersect an ORDERED ROUTED POLYLINE with
 *      Census TIGER/Line state boundaries. Exact in geography, approximate in
 *      distance (see the chord-sum warning below), and unavailable until
 *      something in the product produces a real routed polyline. QuoteFleet's
 *      `distance.ts` does not: it is haversine × 1.18, a scalar with no
 *      geometry. `routeMap.ts` does get a real `overview_polyline`, but only
 *      from the Google Directions API, which bills.
 *
 *   2. `operatorSuppliedStateMileage` — a dispatcher types the per-state miles
 *      from the routing software they already run (PC*Miler, ProMiles). This is
 *      not a lesser option: those ARE the miles that go on the permit
 *      application, so they are the miles the state bills. It costs nothing and
 *      it is available today, which is why it is the path the engine can
 *      actually use right now.
 *
 *   3. There is NO estimator. A straight line from Houston to Buffalo clips the
 *      corner of states the truck never enters and misses states it drives four
 *      hundred miles across; scaling a lane total by each state's share of the
 *      great-circle path would produce a confident number with no relationship
 *      to the filed route. The engine's existing refusal is a better answer than
 *      that, and it stays.
 *
 * ── WHAT WAS WRONG WITH THE SALVAGED VERSION ──────────────────────────────
 * This file began as `stateMileage.ts` on the abandoned `feat/osow-data-prep`
 * branch, whose author did not finish. It was never reviewed. Adopted with
 * these defects fixed, each noted at the site of the fix:
 *
 *   - IT THREW ON GEOGRAPHY. `stateAtPoint` threw when a midpoint fell outside
 *     every state polygon or on a shared boundary — so a bridge over the
 *     Mississippi, a causeway, a Great Lakes shoreline or a clipped-coastline
 *     vertex took down the entire quote. Nothing else in this engine throws for
 *     a data reason; the contract is a warning and a refusal to price, not an
 *     exception. Now: the miles land in `unassignedMiles`, loudly.
 *   - THE PROVENANCE GUARD GUARDED NOTHING. `parseTigerLineStateZip` stamped
 *     `sourceUrl: TIGER_LINE_STATE_BOUNDARIES_URL` and `resolution: 'full'` on
 *     whatever bytes it was handed, and `assertFullResolutionDataset` then
 *     checked that constant against itself. Feeding it a generalized `cb_*_20m`
 *     cartographic file — the exact thing the guard exists to reject, and the
 *     thing that puts a road on the wrong side of a state line — passed. Now
 *     the parser is told where the bytes came from and records that.
 *   - IT COULD NOT FINISH. Both hot paths were linear in the WHOLE dataset:
 *     `crossingParameters` walked every edge of every bbox-overlapping polygon
 *     for every route segment, and `stateAtPoint` ray-cast the full shell.
 *     Full-resolution TIGER is millions of vertices and a 1,600-mile polyline is
 *     tens of thousands of segments — order 10^10 edge tests. Now both go
 *     through a chunked bounding-box index built once.
 *   - IT SAID NOTHING ABOUT CHORD-SUM UNDERCOUNT. See below; this is the one
 *     that would have mispriced quotes rather than crashed them.
 *
 * ── THE CHORD-SUM CAVEAT, WHICH IS NOT A ROUNDING DETAIL ──────────────────
 * `splitRouteMileageByState` measures each piece as a great-circle chord between
 * consecutive polyline vertices. That is the distance of the POLYLINE, not the
 * distance of the ROAD. On a densely-sampled geometry the two are within a
 * fraction of a percent; on a SIMPLIFIED one — and Google's `overview_polyline`
 * for a 1,600-mile route is heavily simplified — the chords cut every curve and
 * the sum runs SHORT of the odometer. It under-bills, which is the direction
 * that hurts: a per-mile state quoted from a short polyline produces a permit
 * fee lower than the one the state will actually charge.
 *
 * So a `routedPolyline` split is `approximate: true`, always says so, and
 * `totalMiles` is returned specifically so a caller holding a known lane
 * distance can compare. It is deliberately NOT scaled to match: pro-rating the
 * shortfall across states assumes the simplification is uniform, which it is not
 * (a straight run across the Texas panhandle loses almost nothing; the Ohio
 * River crossings lose a lot), and a corrected-looking number nobody can audit
 * is worse than an honest short one that says it is short.
 */
import { inflateRawSync } from 'node:zlib';
import { calculateOsow, type OsowLeg, type OsowLoad, type OsowQuote } from './engine.js';
import { todayIso, type IsoDate } from './provenance.js';

/**
 * The full-resolution Census TIGER/Line state boundary file: public domain, no
 * account, no key, no quota, and about 10 MB.
 *
 * DELIBERATELY NOT a `cb_*_20m` cartographic boundary. Those are generalized for
 * small-scale maps and move state lines by miles in places — enough to attribute
 * a stretch of I-40 to the wrong state, which is a fee error, not a map error.
 */
export const TIGER_LINE_STATE_BOUNDARIES_URL =
  'https://www2.census.gov/geo/tiger/TIGER2025/STATE/tl_2025_us_state.zip';

/** Only a full-resolution `tl_<year>_us_state.zip` is accepted. */
function isFullResolutionTigerUrl(url: string): boolean {
  return /^https:\/\/www2\.census\.gov\/geo\/tiger\/TIGER\d{4}\/STATE\/tl_\d{4}_us_state\.zip$/i.test(
    url,
  );
}

export interface RoutePoint {
  latitude: number;
  longitude: number;
}

export type GeoPosition = [longitude: number, latitude: number];

export interface TigerPolygonGeometry {
  type: 'Polygon';
  coordinates: GeoPosition[][];
}

export interface TigerMultiPolygonGeometry {
  type: 'MultiPolygon';
  coordinates: GeoPosition[][][];
}

export interface TigerStateFeature {
  type: 'Feature';
  properties: {
    /** TIGER/Line shapefile field. */
    STUSPS?: string;
    /** Equivalent field used by TIGERweb exports. */
    STUSAB?: string;
    NAME?: string;
  };
  geometry: TigerPolygonGeometry | TigerMultiPolygonGeometry;
}

export interface TigerStateBoundaryCollection {
  type: 'FeatureCollection';
  tigerLine: {
    /**
     * The URL the bytes were ACTUALLY retrieved from — passed in by the caller
     * that did the fetching, never assumed. The salvaged version hard-coded the
     * constant here, which turned the cartographic-file guard into a tautology.
     */
    sourceUrl: string;
    resolution: 'full';
  };
  features: TigerStateFeature[];
}

/** One contiguous stretch of a route inside one state. */
export interface StateMileageLeg {
  stateCode: string;
  stateName: string;
  miles: number;
}

/**
 * WHERE THE MILES CAME FROM. Carried on the split and repeated in its warnings,
 * because "247 miles in Tennessee" priced at 6¢ a ton-mile reads identically
 * whether it was measured off a filed route or guessed, and the two are not
 * worth the same.
 */
export type MileageBasis =
  /** Geometric split of an ordered routed polyline against TIGER boundaries. */
  | 'routedPolyline'
  /** Per-state miles supplied by a human from routing software. */
  | 'operatorSupplied';

export interface StateMileageSplit {
  /** Contiguous legs in traversal order; a re-entered state appears twice. */
  legs: StateMileageLeg[];
  basis: MileageBasis;
  /** Sum of every leg, including nothing that could not be attributed. */
  totalMiles: number;
  /**
   * Miles the split could not put in a state. NOT dropped silently — dropping
   * them under-bills every per-mile state downstream, so they are reported and
   * they force review when they are more than a rounding artefact.
   */
  unassignedMiles: number;
  /** True when the FIGURES are our approximation rather than a filed number. */
  approximate: boolean;
  warnings: string[];
  requiresManualReview: boolean;
}

/**
 * Unassigned miles under this are treated as boundary-clipping noise — a vertex
 * a few hundred feet offshore on a coastal or river crossing. Above it, part of
 * the route genuinely was not located and the split cannot be trusted to price.
 */
export const UNASSIGNED_MILEAGE_REVIEW_THRESHOLD = 1;

// ──────────────────────────────────────────────────────────────────────────
// Supplying miles: the path that works today
// ──────────────────────────────────────────────────────────────────────────

/**
 * Take per-state miles from whoever is filing the permit.
 *
 * This is the honest zero-cost path and it is not a downgrade. A dispatcher
 * moving an OS/OW load already has state-by-state mileage out of PC*Miler or
 * ProMiles, because the permit application asks for it — so these are the miles
 * the state will bill, which is a stronger claim than anything we could compute
 * from a simplified polyline.
 *
 * `approximate: false` says only that WE are not approximating. The caller's
 * figures are still an unverified input and the warning says so.
 */
export function operatorSuppliedStateMileage(
  entries: ReadonlyArray<{ stateCode: string; stateName?: string; miles: number }>,
): StateMileageSplit {
  const legs: StateMileageLeg[] = [];
  const warnings: string[] = [];
  let requiresManualReview = false;

  for (const entry of entries) {
    const stateCode = String(entry.stateCode ?? '').trim().toUpperCase();
    if (stateCode === '') {
      warnings.push(
        'A supplied mileage row has no state code and was discarded. The states on a lane cannot be inferred from the ones that were named, so this leg is not priced.',
      );
      requiresManualReview = true;
      continue;
    }
    if (!Number.isFinite(entry.miles) || entry.miles < 0) {
      warnings.push(
        `Supplied mileage for ${stateCode} is not a usable distance, so no mileage is passed to the permit engine for that state. The engine will refuse to price ${stateCode} rather than assume one.`,
      );
      requiresManualReview = true;
      continue;
    }
    legs.push({
      stateCode,
      stateName: String(entry.stateName ?? stateCode),
      miles: entry.miles,
    });
  }

  const totalMiles = legs.reduce((sum, leg) => sum + leg.miles, 0);
  warnings.push(
    `Per-state mileage was SUPPLIED, not measured: ${legs
      .map((leg) => `${leg.stateCode} ${Math.round(leg.miles)} mi`)
      .join(', ')} (${Math.round(totalMiles)} mi total). Every per-mile and ton-mile permit fee below is computed directly from these figures, so they must match the route actually filed with each state — a mileage that differs from the filed route misprices the permit in that state.`,
  );

  return {
    legs,
    basis: 'operatorSupplied',
    totalMiles,
    unassignedMiles: 0,
    approximate: false,
    warnings,
    requiresManualReview,
  };
}

/**
 * The split, as the engine's leg list.
 *
 * Contiguous legs are summed per state here — the engine de-duplicates state
 * codes and would otherwise keep only the FIRST stretch through a re-entered
 * state, which under-bills it. The traversal order is preserved on the split
 * itself for anyone who needs it.
 */
export function osowLegsFrom(split: StateMileageSplit): OsowLeg[] {
  const totals = new Map<string, number>();
  const order: string[] = [];
  for (const leg of split.legs) {
    if (!totals.has(leg.stateCode)) order.push(leg.stateCode);
    totals.set(leg.stateCode, (totals.get(leg.stateCode) ?? 0) + leg.miles);
  }
  return order.map((code) => ({
    code,
    milesInJurisdiction: Math.round((totals.get(code) ?? 0) * 100) / 100,
  }));
}

/**
 * Price a lane from a mileage split, with the split's caveats attached.
 *
 * The ONLY entry point that should be used to price off a split. Calling
 * `calculateOsow(osowLegsFrom(split), ...)` directly works arithmetically and
 * drops every warning about where the miles came from — which is precisely the
 * failure this module exists to prevent, since the resulting quote looks exactly
 * like one built on filed mileage.
 */
export function priceOsowWithStateMileage(
  split: StateMileageSplit,
  load: OsowLoad,
  asOf: IsoDate = todayIso(),
): OsowQuote {
  const quote = calculateOsow(osowLegsFrom(split), load, asOf);
  return {
    ...quote,
    warnings: [...split.warnings, ...quote.warnings],
    requiresManualReview: quote.requiresManualReview || split.requiresManualReview,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// TIGER/Line: reading the Census ZIP without a GIS dependency
// ──────────────────────────────────────────────────────────────────────────

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function ascii(bytes: Uint8Array): string {
  return new TextDecoder('ascii').decode(bytes);
}

/** Minimal ZIP reader: TIGER archives use stored or raw-DEFLATE entries. */
function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = viewOf(bytes);
  const minimum = Math.max(0, bytes.length - 65_557);
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) === 0x0605_4b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error('TIGER/Line download is not a readable ZIP archive.');

  const entryCount = view.getUint16(eocd + 10, true);
  let centralOffset = view.getUint32(eocd + 16, true);
  const entries = new Map<string, Uint8Array>();

  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(centralOffset, true) !== 0x0201_4b50) {
      throw new Error('TIGER/Line ZIP central directory is malformed.');
    }
    const method = view.getUint16(centralOffset + 10, true);
    const compressedSize = view.getUint32(centralOffset + 20, true);
    const uncompressedSize = view.getUint32(centralOffset + 24, true);
    const nameLength = view.getUint16(centralOffset + 28, true);
    const extraLength = view.getUint16(centralOffset + 30, true);
    const commentLength = view.getUint16(centralOffset + 32, true);
    const localOffset = view.getUint32(centralOffset + 42, true);
    const name = ascii(bytes.subarray(centralOffset + 46, centralOffset + 46 + nameLength));

    if (view.getUint32(localOffset, true) !== 0x0403_4b50) {
      throw new Error(`TIGER/Line ZIP entry ${name} has no local header.`);
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize);

    let content: Uint8Array;
    if (method === 0) {
      content = compressed.slice();
    } else if (method === 8) {
      content = new Uint8Array(inflateRawSync(compressed));
    } else {
      throw new Error(`Unsupported ZIP compression method ${method} in ${name}.`);
    }
    if (content.length !== uncompressedSize) {
      throw new Error(`TIGER/Line ZIP entry ${name} was truncated.`);
    }
    entries.set(name.toLowerCase(), content);
    centralOffset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

interface DbfField {
  name: string;
  offset: number;
  length: number;
}

function parseDbf(bytes: Uint8Array): Array<Record<string, string> | null> {
  const view = viewOf(bytes);
  const recordCount = view.getUint32(4, true);
  const headerLength = view.getUint16(8, true);
  const recordLength = view.getUint16(10, true);
  const fields: DbfField[] = [];
  let fieldOffset = 1;

  for (let offset = 32; offset + 32 <= headerLength && bytes[offset] !== 0x0d; offset += 32) {
    const rawName = ascii(bytes.subarray(offset, offset + 11));
    const name = rawName.replace(/\0.*$/, '').trim();
    const length = bytes[offset + 16] ?? 0;
    fields.push({ name, offset: fieldOffset, length });
    fieldOffset += length;
  }

  const records: Array<Record<string, string> | null> = [];
  for (let index = 0; index < recordCount; index += 1) {
    const offset = headerLength + index * recordLength;
    if (offset + recordLength > bytes.length) throw new Error('TIGER/Line DBF is truncated.');
    if (bytes[offset] === 0x2a) {
      records.push(null);
      continue;
    }
    const record: Record<string, string> = {};
    for (const field of fields) {
      record[field.name] = ascii(
        bytes.subarray(offset + field.offset, offset + field.offset + field.length),
      ).trim();
    }
    records.push(record);
  }
  return records;
}

/**
 * Shoelace, on a ring the shapefile format guarantees is already closed (first
 * point equals last), which is why no wrap-around term is added.
 */
function signedRingArea(ring: readonly GeoPosition[]): number {
  let twiceArea = 0;
  for (let index = 0; index + 1 < ring.length; index += 1) {
    const current = ring[index];
    const next = ring[index + 1];
    if (current && next) twiceArea += current[0] * next[1] - next[0] * current[1];
  }
  return twiceArea / 2;
}

function pointOnSegment(point: GeoPosition, a: GeoPosition, b: GeoPosition): boolean {
  const cross = (point[0] - a[0]) * (b[1] - a[1]) - (point[1] - a[1]) * (b[0] - a[0]);
  if (Math.abs(cross) > 1e-10) return false;
  return (
    point[0] >= Math.min(a[0], b[0]) - 1e-10 &&
    point[0] <= Math.max(a[0], b[0]) + 1e-10 &&
    point[1] >= Math.min(a[1], b[1]) - 1e-10 &&
    point[1] <= Math.max(a[1], b[1]) + 1e-10
  );
}

function pointInRing(point: GeoPosition, ring: readonly GeoPosition[]): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const a = ring[index];
    const b = ring[previous];
    if (!a || !b) continue;
    if (pointOnSegment(point, a, b)) return true;
    if (
      (a[1] > point[1]) !== (b[1] > point[1]) &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** Convert ESRI clockwise shells / counter-clockwise holes to GeoJSON polygons. */
function polygonizeRings(rings: GeoPosition[][]): GeoPosition[][][] {
  const shells = rings
    .filter((ring) => ring.length >= 4 && signedRingArea(ring) < 0)
    .map((ring) => [ring]);
  const holes = rings.filter((ring) => ring.length >= 4 && signedRingArea(ring) >= 0);

  // A malformed or differently-oriented record should still fail visibly,
  // not disappear. Promote the largest ring to a shell before assigning holes.
  if (shells.length === 0 && holes.length > 0) {
    holes.sort((a, b) => Math.abs(signedRingArea(b)) - Math.abs(signedRingArea(a)));
    const promoted = holes.shift();
    if (promoted) shells.push([promoted]);
  }

  for (const hole of holes) {
    const probe = hole[0];
    if (!probe) continue;
    const containing = shells
      .map((polygon, index) => ({ index, shell: polygon[0] }))
      .filter((candidate): candidate is { index: number; shell: GeoPosition[] } =>
        candidate.shell !== undefined && pointInRing(probe, candidate.shell),
      )
      .sort((a, b) => Math.abs(signedRingArea(a.shell)) - Math.abs(signedRingArea(b.shell)))[0];
    if (containing) shells[containing.index]?.push(hole);
    else shells.push([hole]);
  }
  return shells;
}

function parseShapeRecords(bytes: Uint8Array): Array<GeoPosition[][][] | null> {
  const view = viewOf(bytes);
  if (view.getInt32(0, false) !== 9994 || view.getInt32(32, true) !== 5) {
    throw new Error('TIGER/Line .shp is not a polygon shapefile.');
  }

  const records: Array<GeoPosition[][][] | null> = [];
  let offset = 100;
  while (offset + 8 <= bytes.length) {
    const contentBytes = view.getInt32(offset + 4, false) * 2;
    const start = offset + 8;
    if (contentBytes < 4 || start + contentBytes > bytes.length) {
      throw new Error('TIGER/Line shapefile record is truncated.');
    }
    const shapeType = view.getInt32(start, true);
    if (shapeType === 0) {
      records.push(null);
    } else {
      if (shapeType !== 5) throw new Error(`Unexpected TIGER/Line shape type ${shapeType}.`);
      const partCount = view.getInt32(start + 36, true);
      const pointCount = view.getInt32(start + 40, true);
      const partsOffset = start + 44;
      const pointsOffset = partsOffset + partCount * 4;
      const partStarts = Array.from({ length: partCount }, (_, index) =>
        view.getInt32(partsOffset + index * 4, true),
      );
      const rings: GeoPosition[][] = [];
      for (let part = 0; part < partCount; part += 1) {
        const first = partStarts[part] ?? 0;
        const last = partStarts[part + 1] ?? pointCount;
        const ring: GeoPosition[] = [];
        for (let point = first; point < last; point += 1) {
          const pointOffset = pointsOffset + point * 16;
          ring.push([
            view.getFloat64(pointOffset, true),
            view.getFloat64(pointOffset + 8, true),
          ]);
        }
        rings.push(ring);
      }
      records.push(polygonizeRings(rings));
    }
    offset = start + contentBytes;
  }
  return records;
}

/**
 * Parse the official full-resolution TIGER/Line ZIP with no third-party GIS
 * dependency.
 *
 * `sourceUrl` IS REQUIRED and is not defaulted. The salvaged version stamped the
 * module's own constant onto whatever bytes it was given, so the
 * cartographic-file check downstream compared that constant with itself and
 * could never fail — a generalized `cb_*_20m` file, which is exactly what must
 * be refused, sailed straight through it.
 */
export function parseTigerLineStateZip(
  bytes: Uint8Array,
  sourceUrl: string,
): TigerStateBoundaryCollection {
  if (!isFullResolutionTigerUrl(sourceUrl)) {
    throw new Error(
      `State boundaries must come from the full-resolution Census TIGER/Line tl_<year>_us_state.zip dataset; generalized cartographic (cb_*) boundaries move state lines by miles and would attribute road mileage to the wrong state. Refusing: ${sourceUrl}`,
    );
  }
  const entries = unzip(bytes);
  const shpName = [...entries.keys()].find((name) => name.endsWith('.shp'));
  const dbfName = [...entries.keys()].find((name) => name.endsWith('.dbf'));
  if (!shpName || !dbfName) throw new Error('TIGER/Line ZIP lacks its .shp or .dbf component.');
  const shapes = parseShapeRecords(entries.get(shpName) as Uint8Array);
  const rows = parseDbf(entries.get(dbfName) as Uint8Array);
  if (shapes.length !== rows.length) {
    throw new Error('TIGER/Line geometry and attribute record counts do not match.');
  }

  const features: TigerStateFeature[] = [];
  for (let index = 0; index < shapes.length; index += 1) {
    const polygons = shapes[index];
    const row = rows[index];
    if (!polygons || !row) continue;
    const stateCode = row.STUSPS;
    if (!stateCode) throw new Error(`TIGER/Line record ${index + 1} has no STUSPS code.`);
    features.push({
      type: 'Feature',
      properties: { STUSPS: stateCode, NAME: row.NAME ?? stateCode },
      geometry:
        polygons.length === 1
          ? { type: 'Polygon', coordinates: polygons[0] as GeoPosition[][] }
          : { type: 'MultiPolygon', coordinates: polygons },
    });
  }

  return {
    type: 'FeatureCollection',
    tigerLine: { sourceUrl, resolution: 'full' },
    features,
  };
}

/**
 * Download the public Census ZIP.
 *
 * NOT CACHED HERE, ON PURPOSE. The archive is about 10 MB and the boundaries
 * change once a year; a caller that splits more than one route must fetch once,
 * `prepareTigerStateBoundaries` once, and reuse the prepared object. Caching
 * inside a pure calculation module would hide a 10 MB allocation from whoever
 * owns the process's memory.
 */
export async function fetchTigerLineStateBoundaries(
  fetchImpl: typeof fetch = globalThis.fetch,
  url: string = TIGER_LINE_STATE_BOUNDARIES_URL,
): Promise<TigerStateBoundaryCollection> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(
      `Census TIGER/Line download failed (${response.status} ${response.statusText}).`,
    );
  }
  return parseTigerLineStateZip(new Uint8Array(await response.arrayBuffer()), url);
}

// ──────────────────────────────────────────────────────────────────────────
// Preparing boundaries: the index that makes the split finishable
// ──────────────────────────────────────────────────────────────────────────

type BBox = [minLongitude: number, minLatitude: number, maxLongitude: number, maxLatitude: number];

/**
 * How many consecutive edges share one bounding box in the ring index.
 *
 * The salvaged code had no index at all: every route segment was tested against
 * every edge of every polygon whose bbox it touched, and a state's shell is
 * hundreds of thousands of vertices in the full-resolution file. Chunking the
 * ring and testing the chunk's box first skips ~99% of that work for a few
 * bytes per chunk, with no change to the result — a chunk whose box the segment
 * misses cannot contain an edge the segment crosses.
 */
const RING_CHUNK_EDGES = 32;

interface RingChunk {
  /** Index of the first edge (ring[start] → ring[start + 1]) in this chunk. */
  start: number;
  /** One past the last edge index. */
  end: number;
  bbox: BBox;
}

interface PreparedRing {
  points: GeoPosition[];
  bbox: BBox;
  chunks: RingChunk[];
}

interface PreparedPolygon {
  rings: PreparedRing[];
  bbox: BBox;
}

interface PreparedState {
  stateCode: string;
  stateName: string;
  polygons: PreparedPolygon[];
  bbox: BBox;
}

export interface PreparedTigerStateBoundaries {
  sourceUrl: string;
  states: PreparedState[];
}

function bboxOfPoints(points: readonly GeoPosition[], from = 0, to = points.length): BBox {
  let minLongitude = Infinity;
  let minLatitude = Infinity;
  let maxLongitude = -Infinity;
  let maxLatitude = -Infinity;
  for (let index = from; index < to; index += 1) {
    const point = points[index];
    if (!point) continue;
    minLongitude = Math.min(minLongitude, point[0]);
    minLatitude = Math.min(minLatitude, point[1]);
    maxLongitude = Math.max(maxLongitude, point[0]);
    maxLatitude = Math.max(maxLatitude, point[1]);
  }
  if (!Number.isFinite(minLongitude)) throw new Error('TIGER/Line contains an empty polygon ring.');
  return [minLongitude, minLatitude, maxLongitude, maxLatitude];
}

function mergeBboxes(boxes: readonly BBox[]): BBox {
  if (boxes.length === 0) throw new Error('TIGER/Line contains a state with no polygon geometry.');
  return [
    Math.min(...boxes.map((box) => box[0])),
    Math.min(...boxes.map((box) => box[1])),
    Math.max(...boxes.map((box) => box[2])),
    Math.max(...boxes.map((box) => box[3])),
  ];
}

function prepareRing(ring: GeoPosition[]): PreparedRing {
  /**
   * CLOSED EXPLICITLY, so the two point-in-ring implementations in this file
   * cannot disagree. `pointInRing` walks the wrap-around edge (last → first)
   * and the chunked `pointInPreparedRing` walks only edges (i, i+1); on a
   * closed ring the wrap-around edge is degenerate and the two are identical,
   * which is the case for every TIGER/Line ring by shapefile spec. On an
   * UNCLOSED ring they would silently return different answers — one used to
   * assign holes to shells, the other to price mileage — so the assumption is
   * enforced here rather than trusted.
   */
  const first = ring[0];
  const last = ring[ring.length - 1];
  const points =
    first !== undefined && last !== undefined && (first[0] !== last[0] || first[1] !== last[1])
      ? [...ring, first]
      : ring;

  const chunks: RingChunk[] = [];
  for (let start = 0; start + 1 < points.length; start += RING_CHUNK_EDGES) {
    const end = Math.min(start + RING_CHUNK_EDGES, points.length - 1);
    // +1 because a chunk of EDGES [start, end) touches VERTICES [start, end].
    chunks.push({ start, end, bbox: bboxOfPoints(points, start, end + 1) });
  }
  return { points, bbox: bboxOfPoints(points), chunks };
}

function preparePolygon(rings: GeoPosition[][]): PreparedPolygon {
  if (rings.length === 0) throw new Error('TIGER/Line polygon has no rings.');
  const prepared = rings.map(prepareRing);
  // The shell contains every hole, so its box is the polygon's box.
  return { rings: prepared, bbox: (prepared[0] as PreparedRing).bbox };
}

/** Validate provenance and build the ring index once per downloaded dataset. */
export function prepareTigerStateBoundaries(
  data: TigerStateBoundaryCollection,
): PreparedTigerStateBoundaries {
  if (data.tigerLine?.resolution !== 'full' || !isFullResolutionTigerUrl(data.tigerLine.sourceUrl)) {
    throw new Error(
      'State boundaries must come from the full-resolution Census TIGER/Line tl_<year>_us_state.zip dataset; cartographic cb_* / 20m boundaries are not accepted.',
    );
  }
  const states = data.features.map((feature) => {
    const stateCode = feature.properties.STUSPS ?? feature.properties.STUSAB;
    if (!stateCode) throw new Error('TIGER/Line state feature lacks STUSPS/STUSAB.');
    const polygonCoordinates =
      feature.geometry.type === 'Polygon'
        ? [feature.geometry.coordinates]
        : feature.geometry.coordinates;
    const polygons = polygonCoordinates.map(preparePolygon);
    return {
      stateCode: stateCode.toUpperCase(),
      stateName: feature.properties.NAME ?? stateCode,
      polygons,
      bbox: mergeBboxes(polygons.map((polygon) => polygon.bbox)),
    };
  });
  return { sourceUrl: data.tigerLine.sourceUrl, states };
}

// ──────────────────────────────────────────────────────────────────────────
// The split itself
// ──────────────────────────────────────────────────────────────────────────

function boxesIntersect(a: BBox, b: BBox): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function bboxContains(box: BBox, point: GeoPosition): boolean {
  return point[0] >= box[0] && point[0] <= box[2] && point[1] >= box[1] && point[1] <= box[3];
}

/**
 * Ray-cast against a chunked ring.
 *
 * A chunk is skipped when the probe's latitude is outside the chunk's latitude
 * range (no edge in it can straddle the ray) or when the whole chunk lies west
 * of the probe (no edge in it can cross the ray, which is cast eastward). Both
 * prunes are exact — this returns the same answer as walking every edge.
 */
function pointInPreparedRing(point: GeoPosition, ring: PreparedRing): boolean {
  if (!bboxContains(ring.bbox, point)) {
    // Still needs the on-boundary test at the box edge, which `bboxContains`
    // already covers, so a strict miss here is a genuine miss.
    return false;
  }
  let inside = false;
  for (const chunk of ring.chunks) {
    if (point[1] < chunk.bbox[1] || point[1] > chunk.bbox[3]) continue;
    if (chunk.bbox[2] < point[0]) continue;
    for (let index = chunk.start; index < chunk.end; index += 1) {
      const a = ring.points[index];
      const b = ring.points[index + 1];
      if (!a || !b) continue;
      if (pointOnSegment(point, a, b)) return true;
      if (
        (a[1] > point[1]) !== (b[1] > point[1]) &&
        point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
      ) {
        inside = !inside;
      }
    }
  }
  return inside;
}

function pointInPolygon(point: GeoPosition, polygon: PreparedPolygon): boolean {
  const shell = polygon.rings[0];
  if (!shell || !bboxContains(polygon.bbox, point) || !pointInPreparedRing(point, shell)) {
    return false;
  }
  return !polygon.rings.slice(1).some((hole) => pointInPreparedRing(point, hole));
}

/**
 * Which state a point is in — or `null`.
 *
 * THE SALVAGED VERSION THREW HERE, in both branches, and that was the worst
 * defect in the file. A midpoint lands outside every state polygon whenever the
 * route crosses water the boundary file clips out (a Mississippi bridge, a
 * causeway, a Great Lakes shoreline) and on a shared boundary whenever a road
 * runs along a state line; neither is exotic on a real corridor, and each threw
 * away the whole quote rather than one segment of it. Nothing else in this
 * engine raises for a data reason — the contract is a warning plus a refusal to
 * price — so this reports and the caller accumulates it as unassigned mileage.
 */
function stateAtPoint(
  point: GeoPosition,
  states: readonly PreparedState[],
): { state: PreparedState | null; reason: 'outside' | 'ambiguous' | null } {
  const matches = states.filter(
    (state) =>
      bboxContains(state.bbox, point) &&
      state.polygons.some((polygon) => pointInPolygon(point, polygon)),
  );
  if (matches.length === 0) return { state: null, reason: 'outside' };
  if (matches.length > 1) return { state: null, reason: 'ambiguous' };
  return { state: matches[0] as PreparedState, reason: null };
}

function segmentIntersectionT(
  routeStart: GeoPosition,
  routeEnd: GeoPosition,
  edgeStart: GeoPosition,
  edgeEnd: GeoPosition,
): number | null {
  const rx = routeEnd[0] - routeStart[0];
  const ry = routeEnd[1] - routeStart[1];
  const sx = edgeEnd[0] - edgeStart[0];
  const sy = edgeEnd[1] - edgeStart[1];
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) < 1e-14) return null;
  const qx = edgeStart[0] - routeStart[0];
  const qy = edgeStart[1] - routeStart[1];
  const t = (qx * sy - qy * sx) / denominator;
  const u = (qx * ry - qy * rx) / denominator;
  return t >= -1e-12 && t <= 1 + 1e-12 && u >= -1e-12 && u <= 1 + 1e-12
    ? Math.min(1, Math.max(0, t))
    : null;
}

/**
 * Every parameter along `start → end` where the segment meets a state boundary,
 * plus the two endpoints, sorted and de-duplicated. Between two consecutive
 * parameters the segment is inside exactly one state, which is what lets the
 * midpoint decide the whole piece.
 */
function crossingParameters(
  start: GeoPosition,
  end: GeoPosition,
  states: readonly PreparedState[],
): number[] {
  const segmentBox: BBox = [
    Math.min(start[0], end[0]),
    Math.min(start[1], end[1]),
    Math.max(start[0], end[0]),
    Math.max(start[1], end[1]),
  ];
  const crossings = [0, 1];
  for (const state of states) {
    if (!boxesIntersect(segmentBox, state.bbox)) continue;
    for (const polygon of state.polygons) {
      if (!boxesIntersect(segmentBox, polygon.bbox)) continue;
      for (const ring of polygon.rings) {
        if (!boxesIntersect(segmentBox, ring.bbox)) continue;
        for (const chunk of ring.chunks) {
          if (!boxesIntersect(segmentBox, chunk.bbox)) continue;
          for (let index = chunk.start; index < chunk.end; index += 1) {
            const edgeStart = ring.points[index];
            const edgeEnd = ring.points[index + 1];
            if (!edgeStart || !edgeEnd) continue;
            const crossing = segmentIntersectionT(start, end, edgeStart, edgeEnd);
            if (crossing !== null) crossings.push(crossing);
          }
        }
      }
    }
  }
  crossings.sort((a, b) => a - b);
  return crossings.filter(
    (value, index) => index === 0 || Math.abs(value - (crossings[index - 1] ?? 0)) > 1e-10,
  );
}

function interpolate(start: GeoPosition, end: GeoPosition, t: number): GeoPosition {
  return [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t];
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle miles using the IUGG mean Earth radius. */
export function haversineMiles(start: GeoPosition, end: GeoPosition): number {
  const latitudeDelta = radians(end[1] - start[1]);
  const longitudeDelta = radians(end[0] - start[0]);
  const startLatitude = radians(start[1]);
  const endLatitude = radians(end[1]);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 3_958.7613 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function routePosition(point: RoutePoint, index: number): GeoPosition {
  if (
    !Number.isFinite(point?.latitude) ||
    !Number.isFinite(point?.longitude) ||
    point.latitude < -90 ||
    point.latitude > 90 ||
    point.longitude < -180 ||
    point.longitude > 180
  ) {
    throw new Error(`Route point ${index} has invalid latitude/longitude.`);
  }
  return [point.longitude, point.latitude];
}

/**
 * Split an ordered ROUTED polyline into per-state mileage.
 *
 * "Routed" is load-bearing: this must be the geometry of the road the truck will
 * drive, not a line between two endpoints. A great-circle Houston→Buffalo line
 * passes through states the route never enters and skips ones it crosses for
 * hundreds of miles, and the result would be a confident, cited-looking,
 * completely wrong per-state split.
 *
 * Contiguous legs come back in traversal order. A route that leaves and re-enters
 * a state produces two legs, preserving the sequence; `osowLegsFrom` sums them
 * before the engine sees them, because the engine keys on state code.
 *
 * `approximate` is always TRUE here — see the chord-sum caveat in the module
 * header. This measures the polyline, and the state bills the road.
 */
export function splitRouteMileageByState(
  route: readonly RoutePoint[],
  boundaries: PreparedTigerStateBoundaries | TigerStateBoundaryCollection,
): StateMileageSplit {
  if (route.length < 2) throw new Error('A route polyline needs at least two ordered points.');
  const prepared = 'states' in boundaries ? boundaries : prepareTigerStateBoundaries(boundaries);
  if (!isFullResolutionTigerUrl(prepared.sourceUrl)) {
    throw new Error('Prepared state boundaries are not full-resolution Census TIGER/Line data.');
  }

  const legs: StateMileageLeg[] = [];
  const warnings: string[] = [];
  let unassignedMiles = 0;
  let outsideMiles = 0;
  let ambiguousMiles = 0;

  for (let segment = 0; segment + 1 < route.length; segment += 1) {
    const start = routePosition(route[segment] as RoutePoint, segment);
    const end = routePosition(route[segment + 1] as RoutePoint, segment + 1);
    if (start[0] === end[0] && start[1] === end[1]) continue;
    const crossings = crossingParameters(start, end, prepared.states);
    for (let index = 0; index + 1 < crossings.length; index += 1) {
      const from = crossings[index] as number;
      const to = crossings[index + 1] as number;
      if (to - from <= 1e-10) continue;
      const midpoint = interpolate(start, end, (from + to) / 2);
      const miles = haversineMiles(interpolate(start, end, from), interpolate(start, end, to));
      const { state, reason } = stateAtPoint(midpoint, prepared.states);
      if (state === null) {
        unassignedMiles += miles;
        if (reason === 'ambiguous') ambiguousMiles += miles;
        else outsideMiles += miles;
        continue;
      }
      const previous = legs[legs.length - 1];
      if (previous?.stateCode === state.stateCode) previous.miles += miles;
      else legs.push({ stateCode: state.stateCode, stateName: state.stateName, miles });
    }
  }

  const totalMiles = legs.reduce((sum, leg) => sum + leg.miles, 0);

  warnings.push(
    `Per-state mileage was MEASURED FROM A ROUTE POLYLINE, not taken from a filed route sheet. Each piece is summed as straight-line chords between the polyline's own vertices, so on a simplified geometry the figures run SHORT of the road distance the state bills — which under-quotes every per-mile and ton-mile permit below. Measured total: ${Math.round(totalMiles)} mi across ${legs.length} leg${legs.length === 1 ? '' : 's'}; compare it against the lane distance you hold before quoting.`,
  );

  if (unassignedMiles > 0) {
    const parts: string[] = [];
    if (outsideMiles > 0) {
      parts.push(
        `${Math.round(outsideMiles * 10) / 10} mi fell outside every state boundary (a water crossing, a causeway, or a shoreline the boundary file clips)`,
      );
    }
    if (ambiguousMiles > 0) {
      parts.push(
        `${Math.round(ambiguousMiles * 10) / 10} mi sat on a shared state line and could not be attributed to one side`,
      );
    }
    warnings.push(
      `${Math.round(unassignedMiles * 10) / 10} mi of this route could not be assigned to a state: ${parts.join('; ')}. Those miles are NOT included in any state's figure above, so every distance-priced permit on this lane is quoted from less mileage than the truck drives.`,
    );
  }

  return {
    legs,
    basis: 'routedPolyline',
    totalMiles,
    unassignedMiles,
    approximate: true,
    warnings,
    requiresManualReview: unassignedMiles > UNASSIGNED_MILEAGE_REVIEW_THRESHOLD,
  };
}
