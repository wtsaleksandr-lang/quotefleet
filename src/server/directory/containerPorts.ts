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
import { INTERMODAL_TERMINALS } from './terminals.js';

export interface ContainerPort {
  /** UN/LOCODE (or USCHI for the Chicago inland hub). */
  code: string;
  name: string;
  city: string;
  state: string;
  /** Domicile country of the port: 'US' (default) or 'CA'. */
  country: string;
  lat: number;
  lng: number;
}

/** Top US container gateways + the Chicago inland intermodal hub. */
export const CONTAINER_PORTS: readonly ContainerPort[] = [
  { code: 'USLAX', name: 'Port of Los Angeles', city: 'Los Angeles', state: 'CA', country: 'US', lat: 33.7395, lng: -118.2597 },
  { code: 'USLGB', name: 'Port of Long Beach', city: 'Long Beach', state: 'CA', country: 'US', lat: 33.755, lng: -118.216 },
  { code: 'USNYC', name: 'Port of New York & New Jersey', city: 'Newark', state: 'NJ', country: 'US', lat: 40.6626, lng: -74.045 },
  { code: 'USHOU', name: 'Port of Houston', city: 'Houston', state: 'TX', country: 'US', lat: 29.7264, lng: -95.227 },
  { code: 'USSAV', name: 'Port of Savannah', city: 'Savannah', state: 'GA', country: 'US', lat: 32.0835, lng: -81.0998 },
  { code: 'USSEA', name: 'Northwest Seaport Alliance (Seattle/Tacoma)', city: 'Seattle', state: 'WA', country: 'US', lat: 47.5952, lng: -122.3316 },
  { code: 'USCHS', name: 'Port of Charleston', city: 'Charleston', state: 'SC', country: 'US', lat: 32.81, lng: -79.92 },
  { code: 'USORF', name: 'Port of Virginia (Norfolk)', city: 'Norfolk', state: 'VA', country: 'US', lat: 36.873, lng: -76.33 },
  { code: 'USCHI', name: 'Chicago Intermodal Hub', city: 'Chicago', state: 'IL', country: 'US', lat: 41.837, lng: -87.67 },
  { code: 'USBAL', name: 'Port of Baltimore', city: 'Baltimore', state: 'MD', country: 'US', lat: 39.24, lng: -76.57 },
  { code: 'USMIA', name: 'Port of Miami (PortMiami)', city: 'Miami', state: 'FL', country: 'US', lat: 25.778, lng: -80.174 },
];

/**
 * Major Canadian container gateways (North-America model). Kept in a SEPARATE
 * list — deliberately NOT merged into CONTAINER_PORTS — so nothing that iterates
 * CONTAINER_PORTS changes: the US nearest-port derivation (nearestPortToPoint /
 * nearestPortForZip) and the directory's US port facets/chips stay byte-for-byte
 * identical. Canadian carriers get their port via nearestCaPortForProvince()
 * (province → gateway), and `portByCode` resolves BOTH lists so a stored CA
 * nearestPortCode can render a port name on a carrier page later.
 * Coordinates are the marine-terminal area, rounded to 4 decimals.
 */
export const CA_CONTAINER_PORTS: readonly ContainerPort[] = [
  { code: 'CAVAN', name: 'Port of Vancouver', city: 'Vancouver', state: 'BC', country: 'CA', lat: 49.2889, lng: -123.1139 },
  { code: 'CAPRR', name: 'Port of Prince Rupert', city: 'Prince Rupert', state: 'BC', country: 'CA', lat: 54.3167, lng: -130.3209 },
  { code: 'CAMTR', name: 'Port of Montreal', city: 'Montreal', state: 'QC', country: 'CA', lat: 45.5586, lng: -73.5175 },
  { code: 'CAHAL', name: 'Port of Halifax', city: 'Halifax', state: 'NS', country: 'CA', lat: 44.6488, lng: -63.5752 },
  { code: 'CASJB', name: 'Port of Saint John', city: 'Saint John', state: 'NB', country: 'CA', lat: 45.2652, lng: -66.0763 },
];

/**
 * The FULL hub set the directory maps carriers to: the coastal seaport gateways
 * PLUS the inland rail-intermodal metros (Memphis, KC, Dallas, Atlanta, Columbus,
 * Minneapolis, Toronto, Calgary, …), sourced from the canonical terminals dataset
 * (terminals.ts). Shaped as ContainerPort (drop the terminal `type`). Deduped by
 * code — a code already present in CONTAINER_PORTS / CA_CONTAINER_PORTS wins, so
 * the existing seaport coordinates stay authoritative.
 */
export const ALL_HUBS: readonly ContainerPort[] = (() => {
  const seen = new Map<string, ContainerPort>();
  for (const p of [...CONTAINER_PORTS, ...CA_CONTAINER_PORTS]) seen.set(p.code, p);
  for (const t of INTERMODAL_TERMINALS) {
    if (seen.has(t.code)) continue;
    seen.set(t.code, {
      code: t.code,
      name: t.name,
      city: t.city,
      state: t.state,
      country: t.country,
      lat: t.lat,
      lng: t.lng,
    });
  }
  return [...seen.values()];
})();

/** US hubs (seaports + inland rail metros) — the candidate set a US carrier's
 *  ZIP centroid maps to. Precomputed once (runs per-carrier over 321k rows). */
const US_HUBS: readonly ContainerPort[] = ALL_HUBS.filter((p) => p.country === 'US');

// Resolve a hub by code across the US + CA seaport gateways AND the inland rail
// metros, so a stored nearest_port_code (seaport OR inland) always renders a name.
const PORT_BY_CODE = new Map(ALL_HUBS.map((p) => [p.code, p]));

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

/**
 * Resolve the nearest US hub code to a lat/lng — the nearest of the coastal
 * seaport gateways OR the inland rail-intermodal metros (US_HUBS). Never null.
 * A carrier near a coast still maps to its seaport; an interior carrier maps to
 * its nearest inland ramp (e.g. Columbus → INLCMH, Memphis → INLMEM).
 */
export function nearestPortToPoint(lat: number, lng: number): string {
  let best = US_HUBS[0].code;
  let bestD = Infinity;
  for (const p of US_HUBS) {
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

/**
 * Province → nearest Canadian hub code. Canadian postal codes are NOT in the US
 * ZCTA centroid table (ZIP5_CENTROIDS), so nearestPortForZip can't resolve a
 * Canadian carrier — we map by province to that province's dominant intermodal
 * metro, which may be a seaport OR an inland rail hub:
 *   BC → Vancouver (CAVAN, the Pacific gateway); Prairies map to their inland
 *   rail ramps — AB → Calgary (INLCGY), SK/MB → Winnipeg (INLWPG); ON → Toronto
 *   (INLTOR, the country's largest inland ramp); QC → Montreal (CAMTR);
 *   Atlantic → Halifax (CAHAL); NB → Saint John (CASJB); the territories default
 *   to Vancouver. Prince Rupert (CAPRR) / Edmonton (INLEDM) are seeded for hub
 *   pages but are not a province default.
 */
const CA_PROVINCE_PORT: Readonly<Record<string, string>> = {
  BC: 'CAVAN',
  AB: 'INLCGY',
  SK: 'INLWPG',
  MB: 'INLWPG',
  YT: 'CAVAN',
  NT: 'CAVAN',
  NU: 'CAVAN',
  ON: 'INLTOR',
  QC: 'CAMTR',
  NS: 'CAHAL',
  PE: 'CAHAL',
  NL: 'CAHAL',
  NB: 'CASJB',
};

/**
 * Nearest Canadian container-port code for a province code (upper-cased). Returns
 * null for an unknown/absent province — the CA carrier is still kept, just with a
 * null nearestPortCode (same as a US carrier whose ZIP has no centroid).
 */
export function nearestCaPortForProvince(state: string | null | undefined): string | null {
  if (!state) return null;
  const p = String(state).toUpperCase().slice(0, 2);
  return CA_PROVINCE_PORT[p] ?? null;
}
