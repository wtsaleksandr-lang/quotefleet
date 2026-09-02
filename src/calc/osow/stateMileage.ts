/**
 * Split an ordered route polyline into per-state mileage.
 *
 * DATA SOURCE
 * -----------
 * This module downloads and parses the Census Bureau's full TIGER/Line state
 * shapefile. It deliberately does not use a `cb_*_20m` cartographic boundary:
 * those files are generalized for small-scale maps and can put a road on the
 * wrong side of a state line. The ZIP is public domain, free, and needs no
 * account or API key.
 */
import { inflateRawSync } from 'node:zlib';

export const TIGER_LINE_STATE_BOUNDARIES_URL =
  'https://www2.census.gov/geo/tiger/TIGER2025/STATE/tl_2025_us_state.zip';

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
    sourceUrl: string;
    vintage: number;
    resolution: 'full';
  };
  features: TigerStateFeature[];
}

export interface StateMileage {
  stateCode: string;
  stateName: string;
  miles: number;
}

type BBox = [minLongitude: number, minLatitude: number, maxLongitude: number, maxLatitude: number];

interface PreparedPolygon {
  rings: GeoPosition[][];
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

function fullResolutionTigerUrl(url: string): boolean {
  return /^https:\/\/www2\.census\.gov\/geo\/tiger\/TIGER\d{4}\/STATE\/tl_\d{4}_us_state\.zip$/i.test(url);
}

function assertFullResolutionDataset(data: TigerStateBoundaryCollection): void {
  if (data.tigerLine?.resolution !== 'full' || !fullResolutionTigerUrl(data.tigerLine.sourceUrl)) {
    throw new Error(
      'State boundaries must come from the full-resolution Census TIGER/Line tl_*_us_state.zip dataset; cartographic cb_* / 20m boundaries are not accepted.',
    );
  }
}

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
  const cross = (point[0] - a[0]) * (b[1] - a[1]) -
    (point[1] - a[1]) * (b[0] - a[0]);
  if (Math.abs(cross) > 1e-10) return false;
  return point[0] >= Math.min(a[0], b[0]) - 1e-10 &&
    point[0] <= Math.max(a[0], b[0]) + 1e-10 &&
    point[1] >= Math.min(a[1], b[1]) - 1e-10 &&
    point[1] <= Math.max(a[1], b[1]) + 1e-10;
}

function pointInRing(point: GeoPosition, ring: readonly GeoPosition[]): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const a = ring[index];
    const b = ring[previous];
    if (!a || !b) continue;
    if (pointOnSegment(point, a, b)) return true;
    if ((a[1] > point[1]) !== (b[1] > point[1]) &&
        point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]) {
      inside = !inside;
    }
  }
  return inside;
}

/** Convert ESRI clockwise shells/counter-clockwise holes to GeoJSON polygons. */
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
        candidate.shell !== undefined && pointInRing(probe, candidate.shell))
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
      const partStarts = Array.from(
        { length: partCount },
        (_, index) => view.getInt32(partsOffset + index * 4, true),
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

/** Parse the official full-resolution TIGER/Line ZIP without third-party GIS packages. */
export function parseTigerLineStateZip(bytes: Uint8Array): TigerStateBoundaryCollection {
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
      geometry: polygons.length === 1
        ? { type: 'Polygon', coordinates: polygons[0] as GeoPosition[][] }
        : { type: 'MultiPolygon', coordinates: polygons },
    });
  }

  return {
    type: 'FeatureCollection',
    tigerLine: {
      sourceUrl: TIGER_LINE_STATE_BOUNDARIES_URL,
      vintage: 2025,
      resolution: 'full',
    },
    features,
  };
}

/** Download the public Census ZIP and prepare it for local route splitting. */
export async function fetchTigerLineStateBoundaries(
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<TigerStateBoundaryCollection> {
  const response = await fetchImpl(TIGER_LINE_STATE_BOUNDARIES_URL);
  if (!response.ok) {
    throw new Error(`Census TIGER/Line download failed (${response.status} ${response.statusText}).`);
  }
  return parseTigerLineStateZip(new Uint8Array(await response.arrayBuffer()));
}

function bboxOfRing(ring: readonly GeoPosition[]): BBox {
  let minLongitude = Infinity;
  let minLatitude = Infinity;
  let maxLongitude = -Infinity;
  let maxLatitude = -Infinity;
  for (const [longitude, latitude] of ring) {
    minLongitude = Math.min(minLongitude, longitude);
    minLatitude = Math.min(minLatitude, latitude);
    maxLongitude = Math.max(maxLongitude, longitude);
    maxLatitude = Math.max(maxLatitude, latitude);
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

function preparePolygon(rings: GeoPosition[][]): PreparedPolygon {
  if (rings.length === 0) throw new Error('TIGER/Line polygon has no rings.');
  return { rings, bbox: bboxOfRing(rings[0] as GeoPosition[]) };
}

/** Validate and precompute bounding boxes once per downloaded TIGER dataset. */
export function prepareTigerStateBoundaries(
  data: TigerStateBoundaryCollection,
): PreparedTigerStateBoundaries {
  assertFullResolutionDataset(data);
  const states = data.features.map((feature) => {
    const stateCode = feature.properties.STUSPS ?? feature.properties.STUSAB;
    if (!stateCode) throw new Error('TIGER/Line state feature lacks STUSPS/STUSAB.');
    const polygonCoordinates = feature.geometry.type === 'Polygon'
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;
    const polygons = polygonCoordinates.map(preparePolygon);
    return {
      stateCode,
      stateName: feature.properties.NAME ?? stateCode,
      polygons,
      bbox: mergeBboxes(polygons.map((polygon) => polygon.bbox)),
    };
  });
  return { sourceUrl: data.tigerLine.sourceUrl, states };
}

function boxesIntersect(a: BBox, b: BBox): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function bboxContains(box: BBox, point: GeoPosition): boolean {
  return point[0] >= box[0] && point[0] <= box[2] && point[1] >= box[1] && point[1] <= box[3];
}

function pointInPolygon(point: GeoPosition, polygon: PreparedPolygon): boolean {
  const shell = polygon.rings[0];
  if (!shell || !bboxContains(polygon.bbox, point) || !pointInRing(point, shell)) return false;
  return !polygon.rings.slice(1).some((hole) => pointInRing(point, hole));
}

function stateAtPoint(point: GeoPosition, states: readonly PreparedState[]): PreparedState {
  const matches = states.filter((state) =>
    bboxContains(state.bbox, point) && state.polygons.some((polygon) => pointInPolygon(point, polygon)),
  );
  if (matches.length === 0) {
    throw new Error(`Route segment at ${point[1]},${point[0]} is outside every TIGER/Line state boundary.`);
  }
  if (matches.length > 1) {
    throw new Error(`Route segment at ${point[1]},${point[0]} lies on an ambiguous shared state boundary.`);
  }
  return matches[0] as PreparedState;
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
        for (let index = 0; index + 1 < ring.length; index += 1) {
          const edgeStart = ring[index];
          const edgeEnd = ring[index + 1];
          if (!edgeStart || !edgeEnd) continue;
          const crossing = segmentIntersectionT(start, end, edgeStart, edgeEnd);
          if (crossing !== null) crossings.push(crossing);
        }
      }
    }
  }
  crossings.sort((a, b) => a - b);
  return crossings.filter((value, index) => index === 0 || Math.abs(value - (crossings[index - 1] ?? 0)) > 1e-10);
}

function interpolate(start: GeoPosition, end: GeoPosition, t: number): GeoPosition {
  return [
    start[0] + (end[0] - start[0]) * t,
    start[1] + (end[1] - start[1]) * t,
  ];
}

function radians(degrees: number): number {
  return degrees * Math.PI / 180;
}

/** Great-circle miles using the IUGG mean Earth radius. */
export function haversineMiles(start: GeoPosition, end: GeoPosition): number {
  const latitudeDelta = radians(end[1] - start[1]);
  const longitudeDelta = radians(end[0] - start[0]);
  const startLatitude = radians(start[1]);
  const endLatitude = radians(end[1]);
  const a = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 3_958.7613 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function routePosition(point: RoutePoint, index: number): GeoPosition {
  if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude) ||
      point.latitude < -90 || point.latitude > 90 ||
      point.longitude < -180 || point.longitude > 180) {
    throw new Error(`Route point ${index} has invalid latitude/longitude.`);
  }
  return [point.longitude, point.latitude];
}

/**
 * Return contiguous per-state mileage legs in traversal order. If a route
 * leaves and later re-enters a state, that state appears twice, preserving the
 * route's actual sequence instead of hiding it in a map keyed by state code.
 */
export function splitRouteMileageByState(
  route: readonly RoutePoint[],
  boundaries: PreparedTigerStateBoundaries | TigerStateBoundaryCollection,
): StateMileage[] {
  if (route.length < 2) throw new Error('A route polyline needs at least two ordered points.');
  const prepared = 'states' in boundaries ? boundaries : prepareTigerStateBoundaries(boundaries);
  if (!fullResolutionTigerUrl(prepared.sourceUrl)) {
    throw new Error('Prepared state boundaries are not full-resolution Census TIGER/Line data.');
  }

  const result: StateMileage[] = [];
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
      const state = stateAtPoint(midpoint, prepared.states);
      const miles = haversineMiles(interpolate(start, end, from), interpolate(start, end, to));
      const previous = result[result.length - 1];
      if (previous?.stateCode === state.stateCode) previous.miles += miles;
      else result.push({ stateCode: state.stateCode, stateName: state.stateName, miles });
    }
  }
  return result;
}
