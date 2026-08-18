/**
 * Major US container ports + nearest-port derivation for the carrier directory.
 *
 * The directory lets shippers browse carriers BY PORT (which drayage/intermodal
 * carriers sit near which gateway). We seed the top US container gateways (plus
 * the Chicago inland intermodal hub) with lat/lng, then map each carrier's
 * physical ZIP → the nearest port using the 5-digit ZCTA centroid table
 * (src/calc/zip5Centroids.ts, public-domain Census data).
 *
 * Codes are UN/LOCODEs where one exists; USCHI is used for the Chicago inland
 * intermodal complex. Coordinates are the marine terminal / rail-hub area,
 * rounded to 4 decimals — precise enough for nearest-of-eleven selection.
 *
 * Pure + dependency-light so BOTH the ingester (scripts/ingestFmcsaCarriers.ts)
 * and the read API (src/server/routes/directory.ts) import it.
 */
import { ZIP5_CENTROIDS } from '../../calc/zip5Centroids.js';

export interface ContainerPort {
  /** UN/LOCODE (or USCHI for the Chicago inland hub). */
  code: string;
  name: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
}

/** Top US container gateways + the Chicago inland intermodal hub. */
export const CONTAINER_PORTS: readonly ContainerPort[] = [
  { code: 'USLAX', name: 'Port of Los Angeles', city: 'Los Angeles', state: 'CA', lat: 33.7395, lng: -118.2597 },
  { code: 'USLGB', name: 'Port of Long Beach', city: 'Long Beach', state: 'CA', lat: 33.755, lng: -118.216 },
  { code: 'USNYC', name: 'Port of New York & New Jersey', city: 'Newark', state: 'NJ', lat: 40.6626, lng: -74.045 },
  { code: 'USHOU', name: 'Port of Houston', city: 'Houston', state: 'TX', lat: 29.7264, lng: -95.227 },
  { code: 'USSAV', name: 'Port of Savannah', city: 'Savannah', state: 'GA', lat: 32.0835, lng: -81.0998 },
  { code: 'USSEA', name: 'Northwest Seaport Alliance (Seattle/Tacoma)', city: 'Seattle', state: 'WA', lat: 47.5952, lng: -122.3316 },
  { code: 'USCHS', name: 'Port of Charleston', city: 'Charleston', state: 'SC', lat: 32.81, lng: -79.92 },
  { code: 'USORF', name: 'Port of Virginia (Norfolk)', city: 'Norfolk', state: 'VA', lat: 36.873, lng: -76.33 },
  { code: 'USCHI', name: 'Chicago Intermodal Hub', city: 'Chicago', state: 'IL', lat: 41.837, lng: -87.67 },
  { code: 'USBAL', name: 'Port of Baltimore', city: 'Baltimore', state: 'MD', lat: 39.24, lng: -76.57 },
  { code: 'USMIA', name: 'Port of Miami (PortMiami)', city: 'Miami', state: 'FL', lat: 25.778, lng: -80.174 },
];

const PORT_BY_CODE = new Map(CONTAINER_PORTS.map((p) => [p.code, p]));

/** Look up a port by code (for the API to attach name/city to a count). */
export function portByCode(code: string | null | undefined): ContainerPort | null {
  if (!code) return null;
  return PORT_BY_CODE.get(code) ?? null;
}

/** Great-circle distance in miles between two lat/lng points (haversine). */
function haversineMiles(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 3958.7613; // Earth radius, miles
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Resolve the nearest container-port code to a lat/lng. Never null (11 ports). */
export function nearestPortToPoint(lat: number, lng: number): string {
  let best = CONTAINER_PORTS[0].code;
  let bestD = Infinity;
  for (const p of CONTAINER_PORTS) {
    const d = haversineMiles(lat, lng, p.lat, p.lng);
    if (d < bestD) {
      bestD = d;
      best = p.code;
    }
  }
  return best;
}

/**
 * Map a US ZIP to the nearest container-port code via its ZCTA centroid.
 * Uses the leading 5 digits (handles ZIP+4). Returns null when the ZIP has no
 * known centroid (e.g. PO-box-only ZIPs absent from the ZCTA table).
 */
export function nearestPortForZip(zip: string | null | undefined): string | null {
  if (!zip) return null;
  const z5 = String(zip).replace(/\D/g, '').slice(0, 5);
  if (z5.length !== 5) return null;
  const c = ZIP5_CENTROIDS[z5];
  if (!c) return null;
  return nearestPortToPoint(c[0], c[1]);
}
