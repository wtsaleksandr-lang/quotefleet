/**
 * Canonical North-American INTERMODAL TERMINAL dataset for the carrier directory.
 *
 * The seaport-only gateway list (src/server/directory/containerPorts.ts) covers
 * the coastal container ports, but drayage/intermodal carriers also cluster
 * around the major INLAND rail-ramp metros (Memphis, Kansas City, Dallas/Ft
 * Worth, Denver, Atlanta, Detroit, Toronto, Calgary, …). This module is the
 * FOUNDATION for the carrier terminal-coverage feature: one canonical, metro-
 * level list of the top intermodal hubs across the US + Canada — the coastal
 * SEAPORT gateways PLUS the major inland RAIL metros — each with a stable code,
 * public coordinates, and (new) the anchor facility's ADDRESS + OPERATOR.
 *
 * Metro-level, NOT individual berths/ramps: one row per gateway metro (e.g.
 * "Chicago Intermodal Hub", "Port of Los Angeles"), so it stays a small,
 * canonical browse facet and the nearest-hub derivation (nearestPortToPoint)
 * stays a nearest-of-N over distinct metros. A metro that spans many facilities
 * (Chicago = LPC Elwood + Global IV + Corwith + Cicero…) is anchored to its
 * PRIMARY container/intermodal facility, whose street address + operator fill
 * `address` / `operator`. Per-terminal berth/ramp detail lives elsewhere
 * (src/data/terminals.ts, tenant-scoped).
 *
 * 61 metros: 22 US seaports, 5 CA seaports, 28 US inland-rail metros, 6 CA
 * inland-rail metros. Enriched (2026-08) from a validated 97-entry North-
 * American freight-terminal research set: every row carries an anchor-facility
 * `address` + `operator` where one exists, and five confirmed-wrong seaport
 * coordinates were corrected to their actual working container terminal (USNYC
 * → Port Newark-Elizabeth, USSAV → Garden City, USHOU → Barbours Cut, USBAL →
 * Seagirt, USCHS → Wando Welch). The same five fixes are mirrored in
 * containerPorts.ts (coords are duplicated there) so ALL_HUBS dedup stays exact.
 *
 * DATA PROVENANCE: every coordinate + address is a WIDELY-KNOWN PUBLIC
 * infrastructure fact — port-authority / municipal / Class-I rail-hub locations,
 * coordinates rounded to 4 decimals (~11 m). Seaport rows reuse the same
 * coordinates published in containerPorts.ts. NOTHING here is copied from any
 * proprietary or login-gated terminal directory.
 *
 * `type`:
 *   'seaport' — a coastal/river deep-water container gateway.
 *   'rail'    — an inland Class-I rail intermodal metro (no marine berth).
 *
 * Pure + dependency-light (no DB / network at import time) so BOTH the seed
 * (seedDirectoryTerminals, run at boot) and any read path can import it.
 */
import { sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { directoryTerminals } from '../../db/schema.js';

export interface IntermodalTerminal {
  /** Stable code: UN/LOCODE for seaports, an `INL`-prefixed code for inland rail metros. Unique. */
  code: string;
  name: string;
  city: string;
  /** Two-letter US state / CA province (upper-cased). */
  state: string;
  /** Domicile country: 'US' or 'CA'. */
  country: 'US' | 'CA';
  /** 'seaport' (coastal container gateway) | 'rail' (inland rail intermodal metro). */
  type: 'seaport' | 'rail';
  lat: number;
  lng: number;
  /** Anchor-facility street address (the primary container terminal / rail ramp
   *  for the metro), or null when the metro is a multi-carrier anchor with no
   *  single facility address. */
  address: string | null;
  /** Port-authority / Class-I rail operator of the anchor facility, or null. */
  operator: string | null;
}

/**
 * The canonical intermodal-terminal metros. Coastal SEAPORT gateways first
 * (US then CA), then the inland RAIL metros (US then CA). 61 of the most
 * significant North-American intermodal hubs — comprehensive but still strictly
 * metro-level (one row per gateway/metro), deliberately NOT one row per facility.
 */
export const INTERMODAL_TERMINALS: readonly IntermodalTerminal[] = [
  // ─── US seaport gateways ─────────────────────────────────────────────
  { code: 'USLAX', name: 'Port of Los Angeles', city: 'Los Angeles', state: 'CA', country: 'US', type: 'seaport', lat: 33.7395, lng: -118.2597, address: '425 S Palos Verdes St, San Pedro, CA 90731', operator: 'Port of Los Angeles' },
  { code: 'USLGB', name: 'Port of Long Beach', city: 'Long Beach', state: 'CA', country: 'US', type: 'seaport', lat: 33.755, lng: -118.216, address: '415 W Ocean Blvd, Long Beach, CA 90802', operator: 'Port of Long Beach' },
  // FIX: was 40.6626,-74.045 (Bayonne/Upper Bay) → Port Newark-Elizabeth container complex.
  { code: 'USNYC', name: 'Port of New York & New Jersey', city: 'Newark', state: 'NJ', country: 'US', type: 'seaport', lat: 40.6816, lng: -74.1505, address: 'Port Newark-Elizabeth Marine Terminal, Elizabeth, NJ 07201', operator: 'Port Authority of NY & NJ' },
  // FIX: was 32.0835,-81.0998 (downtown Savannah) → Garden City Terminal (the container facility).
  { code: 'USSAV', name: 'Port of Savannah', city: 'Savannah', state: 'GA', country: 'US', type: 'seaport', lat: 32.121, lng: -81.135, address: 'Garden City Terminal, 2 Main St, Garden City, GA 31408', operator: 'Georgia Ports Authority' },
  // FIX: was 29.7264,-95.227 (Turning Basin, general cargo) → Barbours Cut Container Terminal.
  { code: 'USHOU', name: 'Port of Houston', city: 'Houston', state: 'TX', country: 'US', type: 'seaport', lat: 29.6819, lng: -94.9983, address: 'Barbours Cut Container Terminal, 1515 E Barbours Cut Blvd, La Porte, TX 77571', operator: 'Port Houston' },
  { code: 'USSEA', name: 'Northwest Seaport Alliance (Seattle/Tacoma)', city: 'Seattle', state: 'WA', country: 'US', type: 'seaport', lat: 47.5952, lng: -122.3316, address: 'Terminal 18, 2001 6th Ave SW, Seattle, WA 98134', operator: 'Northwest Seaport Alliance' },
  { code: 'USOAK', name: 'Port of Oakland', city: 'Oakland', state: 'CA', country: 'US', type: 'seaport', lat: 37.7995, lng: -122.3128, address: '530 Water St, Oakland, CA 94607', operator: 'Port of Oakland' },
  // FIX: was 32.81,-79.92 (downtown Charleston) → Wando Welch Terminal (the working container terminal).
  { code: 'USCHS', name: 'Port of Charleston', city: 'Charleston', state: 'SC', country: 'US', type: 'seaport', lat: 32.848, lng: -79.873, address: 'Wando Welch Terminal, 1971 Wando Welch Rd, Mount Pleasant, SC 29464', operator: 'South Carolina Ports Authority' },
  { code: 'USORF', name: 'Port of Virginia (Norfolk)', city: 'Norfolk', state: 'VA', country: 'US', type: 'seaport', lat: 36.873, lng: -76.33, address: 'Norfolk International Terminals, 7737 Hampton Blvd, Norfolk, VA 23505', operator: 'Virginia Port Authority' },
  // FIX: was 39.24,-76.57 → Seagirt Marine Terminal (Baltimore's container facility).
  { code: 'USBAL', name: 'Port of Baltimore', city: 'Baltimore', state: 'MD', country: 'US', type: 'seaport', lat: 39.2592, lng: -76.5436, address: 'Seagirt Marine Terminal, 2600 Broening Hwy, Baltimore, MD 21224', operator: 'Ports America Chesapeake / Maryland Port Administration' },
  { code: 'USMIA', name: 'Port of Miami (PortMiami)', city: 'Miami', state: 'FL', country: 'US', type: 'seaport', lat: 25.778, lng: -80.174, address: '1015 N America Way, Miami, FL 33132', operator: 'PortMiami (Miami-Dade County)' },
  { code: 'USPDX', name: 'Port of Portland', city: 'Portland', state: 'OR', country: 'US', type: 'seaport', lat: 45.635, lng: -122.786, address: 'Terminal 6, 7201 N Marine Dr, Portland, OR 97203', operator: 'Port of Portland' },
  { code: 'USNOL', name: 'Port of New Orleans', city: 'New Orleans', state: 'LA', country: 'US', type: 'seaport', lat: 29.933, lng: -90.106, address: 'Napoleon Avenue Container Terminal, 5901 Terminal Dr, New Orleans, LA 70115', operator: 'Port of New Orleans (Port NOLA)' },
  { code: 'USJAX', name: 'Port of Jacksonville (JAXPORT)', city: 'Jacksonville', state: 'FL', country: 'US', type: 'seaport', lat: 30.394, lng: -81.529, address: 'Blount Island Marine Terminal, 9620 Dave Rawls Blvd, Jacksonville, FL 32226', operator: 'Jacksonville Port Authority (JAXPORT)' },
  { code: 'USMOB', name: 'Port of Mobile', city: 'Mobile', state: 'AL', country: 'US', type: 'seaport', lat: 30.6673, lng: -88.0408, address: 'APM Terminals Mobile, 901 Ezra Trice Blvd, Mobile, AL 36603', operator: 'Alabama Port Authority / APM Terminals' },
  { code: 'USTPA', name: 'Port Tampa Bay', city: 'Tampa', state: 'FL', country: 'US', type: 'seaport', lat: 27.916, lng: -82.4298, address: 'Container Terminal, 2999 Guy N Verger Blvd, Tampa, FL 33605', operator: 'Tampa Port Authority / Ports America' },
  { code: 'USGPT', name: 'Port of Gulfport', city: 'Gulfport', state: 'MS', country: 'US', type: 'seaport', lat: 30.3619, lng: -89.0947, address: '1000 30th Ave S Extension, Gulfport, MS 39501', operator: 'Mississippi State Port Authority' },
  { code: 'USPEF', name: 'Port Everglades', city: 'Fort Lauderdale', state: 'FL', country: 'US', type: 'seaport', lat: 26.0682, lng: -80.122, address: 'Southport, 1850 Eller Dr, Fort Lauderdale, FL 33316', operator: 'Broward County / Port Everglades' },
  { code: 'USILM', name: 'Port of Wilmington (NC)', city: 'Wilmington', state: 'NC', country: 'US', type: 'seaport', lat: 34.176, lng: -77.955, address: '1 Shipyard Blvd, Wilmington, NC 28401', operator: 'North Carolina State Ports Authority' },
  { code: 'USILG', name: 'Port of Wilmington (DE)', city: 'Wilmington', state: 'DE', country: 'US', type: 'seaport', lat: 39.7183, lng: -75.5236, address: '1 Hausel Rd, Wilmington, DE 19801', operator: 'Enstructure / Diamond State Port Corp' },
  { code: 'USPHL', name: 'PhilaPort (Philadelphia)', city: 'Philadelphia', state: 'PA', country: 'US', type: 'seaport', lat: 39.9058, lng: -75.1369, address: 'Packer Avenue Marine Terminal, 3301 S Christopher Columbus Blvd, Philadelphia, PA 19148', operator: 'PhilaPort / Greenwich Terminals LLC' },
  { code: 'USBOS', name: 'Port of Boston', city: 'Boston', state: 'MA', country: 'US', type: 'seaport', lat: 42.341, lng: -71.0354, address: 'Paul W. Conley Container Terminal, 700 Summer St, South Boston, MA 02127', operator: 'Massport' },

  // ─── Canadian seaport gateways ───────────────────────────────────────
  { code: 'CAVAN', name: 'Port of Vancouver', city: 'Vancouver', state: 'BC', country: 'CA', type: 'seaport', lat: 49.2889, lng: -123.1139, address: 'Centerm, Centennial Rd, Vancouver, BC V6A', operator: 'Vancouver Fraser Port Authority' },
  { code: 'CAPRR', name: 'Port of Prince Rupert', city: 'Prince Rupert', state: 'BC', country: 'CA', type: 'seaport', lat: 54.3167, lng: -130.3209, address: 'Fairview Container Terminal, Prince Rupert, BC V8J', operator: 'DP World / Prince Rupert Port Authority' },
  { code: 'CAMTR', name: 'Port of Montreal', city: 'Montreal', state: 'QC', country: 'CA', type: 'seaport', lat: 45.5586, lng: -73.5175, address: '2100 Av Pierre-Dupuy, Montreal, QC H3C 3R5', operator: 'Montreal Port Authority' },
  { code: 'CAHAL', name: 'Port of Halifax', city: 'Halifax', state: 'NS', country: 'CA', type: 'seaport', lat: 44.6488, lng: -63.5752, address: 'PSA Halifax, 100 Marginal Rd, Halifax, NS B3H', operator: 'Halifax Port Authority (PSA Halifax)' },
  { code: 'CASJB', name: 'Port of Saint John', city: 'Saint John', state: 'NB', country: 'CA', type: 'seaport', lat: 45.2652, lng: -66.0763, address: '111 Water St, Saint John, NB E2L', operator: 'Port Saint John / DP World' },

  // ─── US inland rail intermodal metros ────────────────────────────────
  { code: 'USCHI', name: 'Chicago Intermodal Hub', city: 'Chicago', state: 'IL', country: 'US', type: 'rail', lat: 41.837, lng: -87.67, address: 'BNSF Logistics Park Chicago (LPC), 26664 S Elwood International Port Rd, Elwood, IL 60421', operator: 'BNSF / UP / NS / CSX / CN / CPKC' },
  { code: 'INLMEM', name: 'Memphis Intermodal', city: 'Memphis', state: 'TN', country: 'US', type: 'rail', lat: 35.1495, lng: -90.049, address: 'BNSF Memphis Intermodal Facility, 4814 Lamar Ave, Memphis, TN 38118', operator: 'BNSF / CN / NS / UP' },
  { code: 'INLKCK', name: 'Kansas City Intermodal', city: 'Kansas City', state: 'KS', country: 'US', type: 'rail', lat: 39.1142, lng: -94.6275, address: 'BNSF Logistics Park Kansas City (LPKC), 32880 W 191st St, Edgerton, KS 66030', operator: 'BNSF / UP / NS / KCS' },
  { code: 'INLDFW', name: 'Dallas/Fort Worth Intermodal', city: 'Dallas', state: 'TX', country: 'US', type: 'rail', lat: 32.7767, lng: -96.797, address: 'BNSF Alliance Intermodal Facility, 1111 Intermodal Pkwy, Haslet, TX 76052', operator: 'BNSF / UP' },
  { code: 'INLDEN', name: 'Denver Intermodal', city: 'Denver', state: 'CO', country: 'US', type: 'rail', lat: 39.79, lng: -104.94, address: null, operator: 'UP / BNSF' },
  { code: 'INLATL', name: 'Atlanta Intermodal', city: 'Atlanta', state: 'GA', country: 'US', type: 'rail', lat: 33.749, lng: -84.388, address: 'CSX Fairburn Intermodal Terminal, 6700 McLarin Rd, Fairburn, GA 30213', operator: 'NS / CSX' },
  { code: 'INLDET', name: 'Detroit Intermodal', city: 'Detroit', state: 'MI', country: 'US', type: 'rail', lat: 42.3314, lng: -83.0458, address: null, operator: 'CN / CSX / NS' },
  { code: 'INLCMH', name: 'Columbus / Rickenbacker Intermodal', city: 'Columbus', state: 'OH', country: 'US', type: 'rail', lat: 39.8136, lng: -82.9277, address: 'NS Rickenbacker Intermodal Terminal, 3329 Thoroughbred Dr, Columbus, OH 43217', operator: 'Norfolk Southern' },
  { code: 'INLCVG', name: 'Cincinnati Intermodal', city: 'Cincinnati', state: 'OH', country: 'US', type: 'rail', lat: 39.11, lng: -84.55, address: null, operator: 'NS / CSX' },
  { code: 'INLIND', name: 'Indianapolis Intermodal', city: 'Indianapolis', state: 'IN', country: 'US', type: 'rail', lat: 39.7684, lng: -86.1581, address: null, operator: 'CSX / NS' },
  { code: 'INLLOU', name: 'Louisville Intermodal', city: 'Louisville', state: 'KY', country: 'US', type: 'rail', lat: 38.2527, lng: -85.7585, address: null, operator: 'CSX / NS' },
  { code: 'INLBNA', name: 'Nashville Intermodal', city: 'Nashville', state: 'TN', country: 'US', type: 'rail', lat: 36.1627, lng: -86.7816, address: null, operator: 'CSX' },
  { code: 'INLSLC', name: 'Salt Lake City Intermodal', city: 'Salt Lake City', state: 'UT', country: 'US', type: 'rail', lat: 40.78, lng: -111.94, address: null, operator: 'Union Pacific' },
  { code: 'INLSTL', name: 'St. Louis Intermodal', city: 'St. Louis', state: 'MO', country: 'US', type: 'rail', lat: 38.63, lng: -90.2, address: null, operator: 'UP / BNSF / NS' },
  { code: 'INLMSP', name: 'Minneapolis/St. Paul Intermodal', city: 'St. Paul', state: 'MN', country: 'US', type: 'rail', lat: 44.95, lng: -93.1, address: null, operator: 'BNSF / UP / CPKC' },
  { code: 'INLOMA', name: 'Omaha/Council Bluffs Intermodal', city: 'Council Bluffs', state: 'IA', country: 'US', type: 'rail', lat: 41.221, lng: -95.829, address: 'UP Council Bluffs Intermodal Terminal, 2722 South Ave, Council Bluffs, IA 51503', operator: 'Union Pacific' },
  { code: 'INLCLT', name: 'Charlotte Intermodal', city: 'Charlotte', state: 'NC', country: 'US', type: 'rail', lat: 35.197, lng: -80.97, address: 'Charlotte Regional Intermodal Facility (CRIF), 5333 Old Dowd Rd, Charlotte, NC 28208', operator: 'Norfolk Southern' },
  { code: 'INLELP', name: 'El Paso Intermodal', city: 'El Paso', state: 'TX', country: 'US', type: 'rail', lat: 31.76, lng: -106.43, address: null, operator: 'UP / BNSF' },
  { code: 'INLLRD', name: 'Laredo Intermodal', city: 'Laredo', state: 'TX', country: 'US', type: 'rail', lat: 27.5306, lng: -99.4803, address: null, operator: 'UP / CPKC' },
  { code: 'INLSAT', name: 'San Antonio Intermodal', city: 'San Antonio', state: 'TX', country: 'US', type: 'rail', lat: 29.38, lng: -98.53, address: null, operator: 'Union Pacific' },
  { code: 'INLPHX', name: 'Phoenix Intermodal', city: 'Phoenix', state: 'AZ', country: 'US', type: 'rail', lat: 33.43, lng: -112.14, address: null, operator: 'UP / BNSF' },
  { code: 'INLCLE', name: 'Cleveland Intermodal', city: 'Cleveland', state: 'OH', country: 'US', type: 'rail', lat: 41.4993, lng: -81.6944, address: null, operator: 'CSX / NS' },
  { code: 'INLSCK', name: 'Central Valley / Stockton Intermodal', city: 'Stockton', state: 'CA', country: 'US', type: 'rail', lat: 37.87, lng: -121.29, address: 'UP Lathrop Intermodal Terminal, 1000 E Roth Rd, French Camp, CA 95231', operator: 'UP / BNSF' },
  { code: 'INLBUF', name: 'Buffalo Intermodal', city: 'Buffalo', state: 'NY', country: 'US', type: 'rail', lat: 42.8864, lng: -78.8784, address: null, operator: 'CSX / NS' },
  { code: 'INLHAR', name: 'Harrisburg Intermodal (Rutherford)', city: 'Harrisburg', state: 'PA', country: 'US', type: 'rail', lat: 40.24, lng: -76.83, address: 'NS Rutherford Intermodal Terminal, Harrisburg, PA', operator: 'Norfolk Southern' },
  { code: 'INLPIT', name: 'Pittsburgh Intermodal', city: 'Pittsburgh', state: 'PA', country: 'US', type: 'rail', lat: 40.4406, lng: -79.9959, address: null, operator: 'NS / CSX' },
  { code: 'INLWOR', name: 'Worcester Intermodal', city: 'Worcester', state: 'MA', country: 'US', type: 'rail', lat: 42.2626, lng: -71.8023, address: 'CSX Worcester Intermodal Terminal, Worcester, MA', operator: 'CSX' },
  { code: 'INLSYR', name: 'Syracuse Intermodal (DeWitt)', city: 'Syracuse', state: 'NY', country: 'US', type: 'rail', lat: 43.0481, lng: -76.1474, address: 'CSX DeWitt Intermodal Terminal, Syracuse, NY', operator: 'CSX' },

  // ─── Canadian inland rail intermodal metros ──────────────────────────
  { code: 'INLTOR', name: 'Toronto Intermodal', city: 'Toronto', state: 'ON', country: 'CA', type: 'rail', lat: 43.6532, lng: -79.3832, address: 'CN Brampton Intermodal Terminal, 76 Intermodal Dr, Brampton, ON L6T 5K1', operator: 'CN / CPKC' },
  { code: 'INLCGY', name: 'Calgary Intermodal', city: 'Calgary', state: 'AB', country: 'CA', type: 'rail', lat: 51.05, lng: -114.07, address: 'CN Calgary Logistics Park, 250050 Lantz Way, Rocky View County, AB T1Z 0A8', operator: 'CN / CPKC' },
  { code: 'INLWPG', name: 'Winnipeg Intermodal', city: 'Winnipeg', state: 'MB', country: 'CA', type: 'rail', lat: 49.85, lng: -97.1, address: 'CN Winnipeg Intermodal Terminal, 560 Plessis Rd, Winnipeg, MB R2C 2Z4', operator: 'CN / CPKC' },
  { code: 'INLEDM', name: 'Edmonton Intermodal', city: 'Edmonton', state: 'AB', country: 'CA', type: 'rail', lat: 53.5, lng: -113.35, address: 'CN Edmonton Intermodal Terminal (McBain), 12311 184 St NW, Edmonton, AB T5V 1T3', operator: 'CN / CPKC' },
  { code: 'INLSAS', name: 'Saskatoon Intermodal', city: 'Saskatoon', state: 'SK', country: 'CA', type: 'rail', lat: 52.1052, lng: -106.7384, address: 'CN Saskatoon Intermodal Terminal, 1701 Chappell Dr, Saskatoon, SK S7M 5P5', operator: 'CN' },
  { code: 'INLREG', name: 'Regina Intermodal (Global Transportation Hub)', city: 'Regina', state: 'SK', country: 'CA', type: 'rail', lat: 50.436, lng: -104.756, address: 'CPKC Regina Intermodal, Global Transportation Hub, Pinkie Rd, Regina, SK S4W', operator: 'CPKC' },
];

/** Total count of canonical intermodal terminals (for the directory landing). */
export const INTERMODAL_TERMINAL_COUNT = INTERMODAL_TERMINALS.length;

const TERMINAL_BY_CODE = new Map(INTERMODAL_TERMINALS.map((t) => [t.code, t]));

/** Look up a canonical terminal by code (null when unknown). */
export function terminalByCode(code: string | null | undefined): IntermodalTerminal | null {
  if (!code) return null;
  return TERMINAL_BY_CODE.get(code) ?? null;
}

/**
 * Upsert the canonical list into the `directory_terminals` table (by unique
 * `code`). Idempotent: re-running refreshes name/coords/type/address/operator
 * for a changed row and inserts any new metro; never deletes. Safe to call on
 * every boot — a few dozen tiny upserts. Returns the number of rows written.
 */
export async function seedDirectoryTerminals(): Promise<number> {
  const rows = INTERMODAL_TERMINALS.map((t) => ({
    code: t.code,
    name: t.name,
    city: t.city,
    state: t.state,
    country: t.country,
    type: t.type,
    lat: t.lat,
    lng: t.lng,
    address: t.address,
    operator: t.operator,
  }));
  await db()
    .insert(directoryTerminals)
    .values(rows)
    .onConflictDoUpdate({
      target: directoryTerminals.code,
      set: {
        name: sql`excluded.name`,
        city: sql`excluded.city`,
        state: sql`excluded.state`,
        country: sql`excluded.country`,
        type: sql`excluded.type`,
        lat: sql`excluded.lat`,
        lng: sql`excluded.lng`,
        address: sql`excluded.address`,
        operator: sql`excluded.operator`,
        updatedAt: sql`now()`,
      },
    });
  return rows.length;
}
