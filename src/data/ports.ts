/**
 * Major US/Canada container ports relevant to drayage. UN/LOCODE + lat/lng.
 * Sorted approximately by container TEU volume (top → bottom).
 */
export interface PortRow {
  code: string;
  name: string;
  city: string;
  state?: string;
  country: 'US' | 'CA';
  lat: number;
  lng: number;
  teuRank: number;
  /** Broad geographic region, e.g. "US Pacific", "CA Atlantic". */
  region?: string;
  /**
   * Container-service accuracy flag. `false` = RoRo / breakbulk / bulk-only
   * (no container drayage here); omitted/undefined = container-capable.
   * Prevents advertising container service where none exists.
   */
  container?: boolean;
  /** Accuracy caveat (RoRo-dominant, future/under-construction, approximate). */
  note?: string;
}

export const PORTS_DATA: PortRow[] = [
  // West Coast US
  { code: 'USLAX', name: 'Port of Los Angeles', city: 'Los Angeles', state: 'CA', country: 'US', lat: 33.7361, lng: -118.2922, teuRank: 1 },
  { code: 'USLGB', name: 'Port of Long Beach', city: 'Long Beach', state: 'CA', country: 'US', lat: 33.7544, lng: -118.2169, teuRank: 2 },
  { code: 'USOAK', name: 'Port of Oakland', city: 'Oakland', state: 'CA', country: 'US', lat: 37.8044, lng: -122.3145, teuRank: 7 },
  { code: 'USSEA', name: 'Port of Seattle', city: 'Seattle', state: 'WA', country: 'US', lat: 47.6043, lng: -122.3493, teuRank: 8 },
  { code: 'USTIW', name: 'Port of Tacoma', city: 'Tacoma', state: 'WA', country: 'US', lat: 47.2657, lng: -122.4257, teuRank: 9 },
  { code: 'USPDX', name: 'Port of Portland', city: 'Portland', state: 'OR', country: 'US', lat: 45.5779, lng: -122.7530, teuRank: 18 },

  // East Coast US
  { code: 'USNYC', name: 'Port of New York and New Jersey', city: 'Newark', state: 'NJ', country: 'US', lat: 40.6815, lng: -74.1483, teuRank: 3 },
  { code: 'USSAV', name: 'Port of Savannah', city: 'Savannah', state: 'GA', country: 'US', lat: 32.1308, lng: -81.1517, teuRank: 4 },
  { code: 'USNOR', name: 'Port of Virginia (Norfolk)', city: 'Norfolk', state: 'VA', country: 'US', lat: 36.8847, lng: -76.3289, teuRank: 6 },
  { code: 'USCHS', name: 'Port of Charleston', city: 'Charleston', state: 'SC', country: 'US', lat: 32.7917, lng: -79.9237, teuRank: 10 },
  { code: 'USJAX', name: 'Port of Jacksonville (JAXPORT)', city: 'Jacksonville', state: 'FL', country: 'US', lat: 30.4012, lng: -81.5727, teuRank: 16 },
  { code: 'USMIA', name: 'Port of Miami', city: 'Miami', state: 'FL', country: 'US', lat: 25.7822, lng: -80.1646, teuRank: 14 },
  { code: 'USPEF', name: 'Port Everglades', city: 'Fort Lauderdale', state: 'FL', country: 'US', lat: 26.0917, lng: -80.1188, teuRank: 17 },
  { code: 'USBAL', name: 'Port of Baltimore', city: 'Baltimore', state: 'MD', country: 'US', lat: 39.2641, lng: -76.5806, teuRank: 13 },
  { code: 'USPHL', name: 'Port of Philadelphia (PhilaPort)', city: 'Philadelphia', state: 'PA', country: 'US', lat: 39.8896, lng: -75.1356, teuRank: 19 },
  { code: 'USBOS', name: 'Port of Boston', city: 'Boston', state: 'MA', country: 'US', lat: 42.3501, lng: -71.0270, teuRank: 22 },
  { code: 'USWIL', name: 'Port of Wilmington (DE)', city: 'Wilmington', state: 'DE', country: 'US', lat: 39.7236, lng: -75.5230, teuRank: 25 },
  { code: 'USILM', name: 'Port of Wilmington (NC)', city: 'Wilmington', state: 'NC', country: 'US', lat: 34.1791, lng: -77.9514, teuRank: 26 },

  // Gulf Coast US
  { code: 'USHOU', name: 'Port of Houston', city: 'Houston', state: 'TX', country: 'US', lat: 29.7252, lng: -95.0699, teuRank: 5 },
  { code: 'USGLS', name: 'Port of Galveston', city: 'Galveston', state: 'TX', country: 'US', lat: 29.3109, lng: -94.7935, teuRank: 21 },
  { code: 'USFPO', name: 'Port Freeport', city: 'Freeport', state: 'TX', country: 'US', lat: 28.9477, lng: -95.3275, teuRank: 23 },
  { code: 'USNOL', name: 'Port of New Orleans', city: 'New Orleans', state: 'LA', country: 'US', lat: 29.9505, lng: -90.0560, teuRank: 15 },
  { code: 'USMOB', name: 'Port of Mobile', city: 'Mobile', state: 'AL', country: 'US', lat: 30.6809, lng: -88.0399, teuRank: 12 },

  // Other
  { code: 'USANC', name: 'Port of Anchorage', city: 'Anchorage', state: 'AK', country: 'US', lat: 61.2453, lng: -149.8819, teuRank: 30 },
  { code: 'USHNL', name: 'Honolulu Harbor', city: 'Honolulu', state: 'HI', country: 'US', lat: 21.3105, lng: -157.8584, teuRank: 27 },

  // Canada
  { code: 'CAVAN', name: 'Port of Vancouver', city: 'Vancouver', state: 'BC', country: 'CA', lat: 49.2872, lng: -123.1109, teuRank: 11 },
  { code: 'CAPRR', name: 'Port of Prince Rupert', city: 'Prince Rupert', state: 'BC', country: 'CA', lat: 54.3150, lng: -130.3204, teuRank: 20 },
  { code: 'CAMTR', name: 'Port of Montreal', city: 'Montreal', state: 'QC', country: 'CA', lat: 45.5588, lng: -73.5278, teuRank: 24 },
  { code: 'CAHAL', name: 'Port of Halifax', city: 'Halifax', state: 'NS', country: 'CA', lat: 44.6488, lng: -63.5752, teuRank: 28 },
  { code: 'CASTQ', name: 'Port of Quebec', city: 'Quebec City', state: 'QC', country: 'CA', lat: 46.8139, lng: -71.2080, teuRank: 31 },
  { code: 'CASJB', name: 'Port of Saint John', city: 'Saint John', state: 'NB', country: 'CA', lat: 45.2733, lng: -66.0633, teuRank: 33 },
  { code: 'CATOR', name: 'Port of Toronto', city: 'Toronto', state: 'ON', country: 'CA', lat: 43.6406, lng: -79.3712, teuRank: 35 },

  // ── Secondary / regional ocean ports (directory fill 2026-08) ─────
  { code: 'USSAN', name: 'Port of San Diego', city: 'San Diego', state: 'CA', country: 'US', lat: 32.6957, lng: -117.144, teuRank: 40, region: 'US Pacific' },
  { code: 'USHUE', name: 'Port of Hueneme', city: 'Port Hueneme', state: 'CA', country: 'US', lat: 34.1478, lng: -119.2073, teuRank: 42, region: 'US Pacific', container: false, note: 'Autos + reefer produce (bananas, citrus); limited container.' },
  { code: 'USGPT', name: 'Port of Gulfport', city: 'Gulfport', state: 'MS', country: 'US', lat: 30.3566, lng: -89.0911, teuRank: 38, region: 'US Gulf' },
  { code: 'USPBI', name: 'Port of Palm Beach', city: 'Riviera Beach', state: 'FL', country: 'US', lat: 26.7717, lng: -80.045, teuRank: 39, region: 'US South Atlantic' },
  { code: 'USFEB', name: 'Port of Fernandina', city: 'Fernandina Beach', state: 'FL', country: 'US', lat: 30.6697, lng: -81.467, teuRank: 44, region: 'US South Atlantic' },
  { code: 'USGLC', name: 'Gloucester Marine Terminal (Delaware River)', city: 'Gloucester City', state: 'NJ', country: 'US', lat: 39.894, lng: -75.125, teuRank: 45, region: 'US Mid Atlantic', container: false, note: 'Reefer/fruit + breakbulk on the Delaware River (Holt).' },
  { code: 'USCLE', name: 'Port of Cleveland', city: 'Cleveland', state: 'OH', country: 'US', lat: 41.51, lng: -81.705, teuRank: 48, region: 'US Great Lakes' },
  { code: 'CANAI', name: 'Port of Nanaimo', city: 'Nanaimo', state: 'BC', country: 'CA', lat: 49.133, lng: -123.889, teuRank: 41, region: 'CA Pacific' },
  { code: 'CAHAM', name: 'Port of Hamilton', city: 'Hamilton', state: 'ON', country: 'CA', lat: 43.29, lng: -79.8, teuRank: 47, region: 'CA Great Lakes' },

  // ── Port-code reconciliation: drayage rate sheets key on these ────
  // codes; adding them (and their alias groups below) makes an ingested
  // matrix lane resolve against what the autosuggest picks.
  { code: 'USEWR', name: 'Port Newark-Elizabeth (NY/NJ)', city: 'Newark', state: 'NJ', country: 'US', lat: 40.6857, lng: -74.1531, teuRank: 3, region: 'US North Atlantic', note: 'Marine-terminal complex inside the Port of NY/NJ; drayage rate sheets key on USEWR. Aliased to USNYC for matrix matching.' },
  { code: 'USLALB', name: 'Los Angeles / Long Beach (San Pedro Bay)', city: 'Los Angeles / Long Beach', state: 'CA', country: 'US', lat: 33.7500, lng: -118.2500, teuRank: 1, region: 'US Pacific', note: 'Combined San Pedro Bay drayage pool; matrix lanes for either USLAX or USLGB resolve here.' },
];

export function findPort(code: string): PortRow | undefined {
  return PORTS_DATA.find((p) => p.code.toUpperCase() === code.toUpperCase());
}

/**
 * Port-code alias groups — codes in the same group refer to the same physical
 * drayage gateway and must match interchangeably in matrix keying.
 *
 * WHY: an ingested drayage matrix keys a lane on whatever port code appears on
 * the rate sheet (e.g. `USEWR` for Port Newark-Elizabeth), but the customer's
 * autosuggest may resolve Newark to the umbrella `USNYC`. Without aliasing, the
 * matrix cell's origin key never matches the shipment's resolved port and the
 * lane silently fails to price. Grouping the equivalent codes fixes that in both
 * directions, and folds LA + Long Beach into one San Pedro Bay pool.
 */
export const PORT_CODE_ALIAS_GROUPS: readonly string[][] = [
  ['USNYC', 'USEWR'],
  ['USLAX', 'USLGB', 'USLALB'],
];

const ALIAS_INDEX: Map<string, string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const group of PORT_CODE_ALIAS_GROUPS) {
    const upper = group.map((c) => c.toUpperCase());
    for (const code of upper) m.set(code, upper);
  }
  return m;
})();

/**
 * Expand a port code to every code it should match in matrix keying — itself
 * plus any pooled/aliased codes. Returns `[]` for a null/empty code, and
 * `[CODE]` (uppercased) for a code with no aliases. Order-stable, de-duped.
 */
export function expandPortAliases(code?: string | null): string[] {
  const c = String(code ?? '').trim().toUpperCase();
  if (!c) return [];
  const group = ALIAS_INDEX.get(c);
  if (!group) return [c];
  return group.includes(c) ? group.slice() : [c, ...group];
}
