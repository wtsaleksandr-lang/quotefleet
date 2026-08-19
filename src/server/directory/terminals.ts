/**
 * Canonical North-American INTERMODAL TERMINAL dataset for the carrier directory.
 *
 * The seaport-only gateway list (src/server/directory/containerPorts.ts) covers
 * the coastal container ports, but drayage/intermodal carriers also cluster
 * around the major INLAND rail-ramp metros (Memphis, Kansas City, Dallas/Ft
 * Worth, Denver, Atlanta, Detroit, Toronto, Calgary, …). This module is the
 * FOUNDATION for the carrier terminal-coverage feature: one canonical, metro-
 * level list of the ~top intermodal hubs across the US + Canada — the coastal
 * SEAPORT gateways PLUS the major inland RAIL metros — each with a stable code
 * and public coordinates.
 *
 * Metro-level, NOT individual berths/ramps: one row per gateway metro (e.g.
 * "Chicago Intermodal Hub", "Port of Los Angeles"), so it stays a small,
 * canonical browse facet. Per-terminal berth/ramp detail lives elsewhere
 * (src/data/terminals.ts, tenant-scoped).
 *
 * DATA PROVENANCE: every coordinate is a WIDELY-KNOWN PUBLIC infrastructure
 * fact — port-authority / municipal / Class-I rail-hub locations, rounded to 4
 * decimals (~11 m), enough to anchor a metro. Seaport rows reuse the same
 * coordinates already published in containerPorts.ts. NOTHING here is copied
 * from any proprietary or login-gated terminal directory.
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
}

/**
 * The canonical intermodal-terminal metros. Coastal SEAPORT gateways first
 * (US then CA), then the inland RAIL metros (US then CA). ~38 of the most
 * significant North-American intermodal hubs — deliberately NOT exhaustive.
 */
export const INTERMODAL_TERMINALS: readonly IntermodalTerminal[] = [
  // ─── US seaport gateways ─────────────────────────────────────────────
  { code: 'USLAX', name: 'Port of Los Angeles', city: 'Los Angeles', state: 'CA', country: 'US', type: 'seaport', lat: 33.7395, lng: -118.2597 },
  { code: 'USLGB', name: 'Port of Long Beach', city: 'Long Beach', state: 'CA', country: 'US', type: 'seaport', lat: 33.755, lng: -118.216 },
  { code: 'USNYC', name: 'Port of New York & New Jersey', city: 'Newark', state: 'NJ', country: 'US', type: 'seaport', lat: 40.6626, lng: -74.045 },
  { code: 'USSAV', name: 'Port of Savannah', city: 'Savannah', state: 'GA', country: 'US', type: 'seaport', lat: 32.0835, lng: -81.0998 },
  { code: 'USHOU', name: 'Port of Houston', city: 'Houston', state: 'TX', country: 'US', type: 'seaport', lat: 29.7264, lng: -95.227 },
  { code: 'USSEA', name: 'Northwest Seaport Alliance (Seattle/Tacoma)', city: 'Seattle', state: 'WA', country: 'US', type: 'seaport', lat: 47.5952, lng: -122.3316 },
  { code: 'USOAK', name: 'Port of Oakland', city: 'Oakland', state: 'CA', country: 'US', type: 'seaport', lat: 37.7995, lng: -122.3128 },
  { code: 'USCHS', name: 'Port of Charleston', city: 'Charleston', state: 'SC', country: 'US', type: 'seaport', lat: 32.81, lng: -79.92 },
  { code: 'USORF', name: 'Port of Virginia (Norfolk)', city: 'Norfolk', state: 'VA', country: 'US', type: 'seaport', lat: 36.873, lng: -76.33 },
  { code: 'USBAL', name: 'Port of Baltimore', city: 'Baltimore', state: 'MD', country: 'US', type: 'seaport', lat: 39.24, lng: -76.57 },
  { code: 'USMIA', name: 'Port of Miami (PortMiami)', city: 'Miami', state: 'FL', country: 'US', type: 'seaport', lat: 25.778, lng: -80.174 },
  { code: 'USPDX', name: 'Port of Portland', city: 'Portland', state: 'OR', country: 'US', type: 'seaport', lat: 45.635, lng: -122.786 },
  { code: 'USNOL', name: 'Port of New Orleans', city: 'New Orleans', state: 'LA', country: 'US', type: 'seaport', lat: 29.933, lng: -90.106 },
  { code: 'USJAX', name: 'Port of Jacksonville (JAXPORT)', city: 'Jacksonville', state: 'FL', country: 'US', type: 'seaport', lat: 30.394, lng: -81.529 },

  // ─── Canadian seaport gateways ───────────────────────────────────────
  { code: 'CAVAN', name: 'Port of Vancouver', city: 'Vancouver', state: 'BC', country: 'CA', type: 'seaport', lat: 49.2889, lng: -123.1139 },
  { code: 'CAPRR', name: 'Port of Prince Rupert', city: 'Prince Rupert', state: 'BC', country: 'CA', type: 'seaport', lat: 54.3167, lng: -130.3209 },
  { code: 'CAMTR', name: 'Port of Montreal', city: 'Montreal', state: 'QC', country: 'CA', type: 'seaport', lat: 45.5586, lng: -73.5175 },
  { code: 'CAHAL', name: 'Port of Halifax', city: 'Halifax', state: 'NS', country: 'CA', type: 'seaport', lat: 44.6488, lng: -63.5752 },
  { code: 'CASJB', name: 'Port of Saint John', city: 'Saint John', state: 'NB', country: 'CA', type: 'seaport', lat: 45.2652, lng: -66.0763 },

  // ─── US inland rail intermodal metros ────────────────────────────────
  { code: 'USCHI', name: 'Chicago Intermodal Hub', city: 'Chicago', state: 'IL', country: 'US', type: 'rail', lat: 41.837, lng: -87.67 },
  { code: 'INLMEM', name: 'Memphis Intermodal', city: 'Memphis', state: 'TN', country: 'US', type: 'rail', lat: 35.1495, lng: -90.049 },
  { code: 'INLKCK', name: 'Kansas City Intermodal', city: 'Kansas City', state: 'KS', country: 'US', type: 'rail', lat: 39.1142, lng: -94.6275 },
  { code: 'INLDFW', name: 'Dallas/Fort Worth Intermodal', city: 'Dallas', state: 'TX', country: 'US', type: 'rail', lat: 32.7767, lng: -96.797 },
  { code: 'INLDEN', name: 'Denver Intermodal', city: 'Denver', state: 'CO', country: 'US', type: 'rail', lat: 39.79, lng: -104.94 },
  { code: 'INLATL', name: 'Atlanta Intermodal', city: 'Atlanta', state: 'GA', country: 'US', type: 'rail', lat: 33.749, lng: -84.388 },
  { code: 'INLDET', name: 'Detroit Intermodal', city: 'Detroit', state: 'MI', country: 'US', type: 'rail', lat: 42.3314, lng: -83.0458 },
  { code: 'INLCMH', name: 'Columbus / Rickenbacker Intermodal', city: 'Columbus', state: 'OH', country: 'US', type: 'rail', lat: 39.8136, lng: -82.9277 },
  { code: 'INLCVG', name: 'Cincinnati Intermodal', city: 'Cincinnati', state: 'OH', country: 'US', type: 'rail', lat: 39.11, lng: -84.55 },
  { code: 'INLIND', name: 'Indianapolis Intermodal', city: 'Indianapolis', state: 'IN', country: 'US', type: 'rail', lat: 39.7684, lng: -86.1581 },
  { code: 'INLLOU', name: 'Louisville Intermodal', city: 'Louisville', state: 'KY', country: 'US', type: 'rail', lat: 38.2527, lng: -85.7585 },
  { code: 'INLBNA', name: 'Nashville Intermodal', city: 'Nashville', state: 'TN', country: 'US', type: 'rail', lat: 36.1627, lng: -86.7816 },
  { code: 'INLSLC', name: 'Salt Lake City Intermodal', city: 'Salt Lake City', state: 'UT', country: 'US', type: 'rail', lat: 40.78, lng: -111.94 },
  { code: 'INLSTL', name: 'St. Louis Intermodal', city: 'St. Louis', state: 'MO', country: 'US', type: 'rail', lat: 38.63, lng: -90.2 },
  { code: 'INLMSP', name: 'Minneapolis/St. Paul Intermodal', city: 'St. Paul', state: 'MN', country: 'US', type: 'rail', lat: 44.95, lng: -93.1 },

  // ─── Canadian inland rail intermodal metros ──────────────────────────
  { code: 'INLTOR', name: 'Toronto Intermodal', city: 'Toronto', state: 'ON', country: 'CA', type: 'rail', lat: 43.6532, lng: -79.3832 },
  { code: 'INLCGY', name: 'Calgary Intermodal', city: 'Calgary', state: 'AB', country: 'CA', type: 'rail', lat: 51.05, lng: -114.07 },
  { code: 'INLWPG', name: 'Winnipeg Intermodal', city: 'Winnipeg', state: 'MB', country: 'CA', type: 'rail', lat: 49.85, lng: -97.1 },
  { code: 'INLEDM', name: 'Edmonton Intermodal', city: 'Edmonton', state: 'AB', country: 'CA', type: 'rail', lat: 53.5, lng: -113.35 },
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
 * `code`). Idempotent: re-running refreshes name/coords/type for a changed row
 * and inserts any new metro; never deletes. Safe to call on every boot — a few
 * dozen tiny upserts. Returns the number of rows written.
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
        updatedAt: sql`now()`,
      },
    });
  return rows.length;
}
