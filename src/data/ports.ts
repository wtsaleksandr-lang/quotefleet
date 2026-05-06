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
];

export function findPort(code: string): PortRow | undefined {
  return PORTS_DATA.find((p) => p.code.toUpperCase() === code.toUpperCase());
}
