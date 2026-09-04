/**
 * Polyline shapefile + DBF reader for TIGER/Line PRIMARYROADS.
 * Same ZIP/DBF machinery as tiger.mjs (which only handles polygons, type 5).
 * Public domain data: US Census Bureau TIGER/Line.
 */
import { inflateRawSync } from 'node:zlib';

function viewOf(b) { return new DataView(b.buffer, b.byteOffset, b.byteLength); }
function ascii(b) { return new TextDecoder('ascii').decode(b); }

export function unzip(bytes) {
  const view = viewOf(bytes);
  const minimum = Math.max(0, bytes.length - 65_557);
  let eocd = -1;
  for (let o = bytes.length - 22; o >= minimum; o -= 1) if (view.getUint32(o, true) === 0x06054b50) { eocd = o; break; }
  if (eocd < 0) throw new Error('not a readable ZIP');
  const entryCount = view.getUint16(eocd + 10, true);
  let c = view.getUint32(eocd + 16, true);
  const entries = new Map();
  for (let i = 0; i < entryCount; i += 1) {
    const method = view.getUint16(c + 10, true);
    const cs = view.getUint32(c + 20, true);
    const us = view.getUint32(c + 24, true);
    const nl = view.getUint16(c + 28, true);
    const el = view.getUint16(c + 30, true);
    const cl = view.getUint16(c + 32, true);
    const lo = view.getUint32(c + 42, true);
    const name = ascii(bytes.subarray(c + 46, c + 46 + nl));
    const lnl = view.getUint16(lo + 26, true);
    const lel = view.getUint16(lo + 28, true);
    const dataOffset = lo + 30 + lnl + lel;
    const comp = bytes.subarray(dataOffset, dataOffset + cs);
    let content;
    if (method === 0) content = comp.slice();
    else if (method === 8) content = new Uint8Array(inflateRawSync(comp));
    else throw new Error('unsupported compression ' + method);
    if (content.length !== us) throw new Error('truncated ' + name);
    entries.set(name.toLowerCase(), content);
    c += 46 + nl + el + cl;
  }
  return entries;
}

export function parseDbf(bytes) {
  const view = viewOf(bytes);
  const recordCount = view.getUint32(4, true);
  const headerLength = view.getUint16(8, true);
  const recordLength = view.getUint16(10, true);
  const fields = [];
  let fo = 1;
  for (let o = 32; o + 32 <= headerLength && bytes[o] !== 0x0d; o += 32) {
    const name = ascii(bytes.subarray(o, o + 11)).replace(/\0.*$/, '').trim();
    const len = bytes[o + 16] ?? 0;
    fields.push({ name, offset: fo, length: len });
    fo += len;
  }
  const out = [];
  for (let i = 0; i < recordCount; i += 1) {
    const base = headerLength + i * recordLength;
    if (bytes[base] === 0x2a) { out.push(null); continue; }
    const row = {};
    for (const f of fields) row[f.name] = ascii(bytes.subarray(base + f.offset, base + f.offset + f.length)).trim();
    out.push(row);
  }
  return out;
}

/** Returns array of arrays-of-parts; each part is [[lon,lat],...] */
export function parsePolylineShp(bytes) {
  const view = viewOf(bytes);
  if (view.getInt32(0, false) !== 9994) throw new Error('not a shapefile');
  const fileType = view.getInt32(32, true);
  if (fileType !== 3 && fileType !== 13) throw new Error('not a polyline shapefile, type=' + fileType);
  const records = [];
  let offset = 100;
  while (offset + 8 <= bytes.length) {
    const contentBytes = view.getInt32(offset + 4, false) * 2;
    const start = offset + 8;
    if (contentBytes < 4 || start + contentBytes > bytes.length) break;
    const st = view.getInt32(start, true);
    if (st === 0) records.push(null);
    else {
      const partCount = view.getInt32(start + 36, true);
      const pointCount = view.getInt32(start + 40, true);
      const partsOffset = start + 44;
      const pointsOffset = partsOffset + partCount * 4;
      const partStarts = Array.from({ length: partCount }, (_, i) => view.getInt32(partsOffset + i * 4, true));
      const parts = [];
      for (let p = 0; p < partCount; p += 1) {
        const first = partStarts[p] ?? 0;
        const last = partStarts[p + 1] ?? pointCount;
        const line = [];
        for (let q = first; q < last; q += 1) {
          const o = pointsOffset + q * 16;
          line.push([view.getFloat64(o, true), view.getFloat64(o + 8, true)]);
        }
        parts.push(line);
      }
      records.push(parts);
    }
    offset = start + contentBytes;
  }
  return records;
}
