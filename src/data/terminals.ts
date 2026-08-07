/**
 * Marine terminals + intermodal rail ramps at major US/Canada ports.
 *
 * Used to seed each new tenant's `terminals` table. The carrier toggles
 * which ones they actually serve and sets per-terminal surcharges.
 *
 * `code` is composed as `<PORTCODE>_<SHORT>` so it's stable across
 * tenants. `name` is what shows in the dropdown. Lat/lng are
 * approximate (terminal entrance gate).
 *
 * Coverage: top 11 US ports + top 4 Canadian ports + Chicago and
 * Memphis inland intermodal (which have synthetic port codes
 * `INL_CHI` and `INL_MEM` — added to PORTS_DATA-by-extension at seed time).
 */
export interface TerminalRow {
  /** Port code from PORTS_DATA, OR an inland synthetic code (see PORTS_INLAND below). */
  portCode: string;
  /** Stable code, unique within tenant. */
  code: string;
  name: string;
  /** Optional: steamship line / rail carrier this terminal serves. */
  carrier?: string;
  address?: string;
  lat?: number;
  lng?: number;
  notes?: string;
  /**
   * Facility kind: 'container' | 'roro' | 'breakbulk' | 'multipurpose' |
   * 'rail-ictf' | 'rail'. Carries the RoRo-vs-container accuracy flag so the
   * UI doesn't imply container drayage at a RoRo/breakbulk-only berth.
   * (Informational — not persisted to the tenant `terminals` table today.)
   */
  type?: string;
}

/**
 * Synthetic "ports" for major inland intermodal hubs. These don't have
 * UN/LOCODEs but customers absolutely think of them as the "port of
 * pickup" (e.g. Chicago BNSF Logistics Park).
 */
export interface InlandHubRow {
  code: string;
  name: string;
  city: string;
  state: string;
  country: 'US' | 'CA';
  lat: number;
  lng: number;
  teuRank: number;
}

export const PORTS_INLAND: InlandHubRow[] = [
  { code: 'INLCHI', name: 'Chicago Intermodal (all ramps)', city: 'Chicago', state: 'IL', country: 'US', lat: 41.8781, lng: -87.6298, teuRank: 50 },
  { code: 'INLMEM', name: 'Memphis Intermodal', city: 'Memphis', state: 'TN', country: 'US', lat: 35.1495, lng: -90.0490, teuRank: 51 },
  { code: 'INLDFW', name: 'Dallas/Fort Worth Intermodal', city: 'Dallas', state: 'TX', country: 'US', lat: 32.7767, lng: -96.7970, teuRank: 52 },
  { code: 'INLKCK', name: 'Kansas City Intermodal', city: 'Kansas City', state: 'KS', country: 'US', lat: 39.1142, lng: -94.6275, teuRank: 53 },
  { code: 'INLATL', name: 'Atlanta Intermodal', city: 'Atlanta', state: 'GA', country: 'US', lat: 33.7490, lng: -84.3880, teuRank: 54 },
  { code: 'INLDET', name: 'Detroit Intermodal', city: 'Detroit', state: 'MI', country: 'US', lat: 42.3314, lng: -83.0458, teuRank: 55 },
  { code: 'INLCMH', name: 'Columbus / Rickenbacker Intermodal', city: 'Columbus', state: 'OH', country: 'US', lat: 39.8136, lng: -82.9277, teuRank: 56 },
  { code: 'INLTOR', name: 'Toronto Intermodal', city: 'Toronto', state: 'ON', country: 'CA', lat: 43.6532, lng: -79.3832, teuRank: 57 },

  // ── Additional inland intermodal metros (directory fill 2026-08) ──
  { code: 'INLIE', name: 'Inland Empire Intermodal', city: 'San Bernardino', state: 'CA', country: 'US', lat: 34.083, lng: -117.29, teuRank: 58 },
  { code: 'INLCV', name: 'Central Valley Intermodal (Stockton/Lathrop)', city: 'Stockton', state: 'CA', country: 'US', lat: 37.93, lng: -121.28, teuRank: 59 },
  { code: 'INLPHX', name: 'Phoenix Intermodal', city: 'Phoenix', state: 'AZ', country: 'US', lat: 33.53, lng: -112.28, teuRank: 60 },
  { code: 'INLSLC', name: 'Salt Lake City Intermodal', city: 'Salt Lake City', state: 'UT', country: 'US', lat: 40.78, lng: -111.94, teuRank: 61 },
  { code: 'INLDEN', name: 'Denver Intermodal', city: 'Denver', state: 'CO', country: 'US', lat: 39.79, lng: -104.94, teuRank: 62 },
  { code: 'INLSAT', name: 'San Antonio Intermodal', city: 'San Antonio', state: 'TX', country: 'US', lat: 29.3, lng: -98.35, teuRank: 63 },
  { code: 'INLELP', name: 'El Paso Intermodal', city: 'El Paso', state: 'TX', country: 'US', lat: 31.77, lng: -106.35, teuRank: 64 },
  { code: 'INLSTL', name: 'St. Louis Intermodal', city: 'St. Louis', state: 'MO', country: 'US', lat: 38.63, lng: -90.2, teuRank: 65 },
  { code: 'INLMSP', name: 'Minneapolis/St. Paul Intermodal', city: 'St. Paul', state: 'MN', country: 'US', lat: 44.95, lng: -93.1, teuRank: 66 },
  { code: 'INLTOL', name: 'Toledo / NW Ohio Intermodal', city: 'North Baltimore', state: 'OH', country: 'US', lat: 41.18, lng: -83.68, teuRank: 67 },
  { code: 'INLCVG', name: 'Cincinnati Intermodal', city: 'Cincinnati', state: 'OH', country: 'US', lat: 39.11, lng: -84.55, teuRank: 68 },
  { code: 'INLCLT', name: 'Charlotte Intermodal', city: 'Charlotte', state: 'NC', country: 'US', lat: 35.23, lng: -80.84, teuRank: 69 },
  { code: 'INLHAR', name: 'Harrisburg Intermodal', city: 'Harrisburg', state: 'PA', country: 'US', lat: 40.28, lng: -76.79, teuRank: 70 },
  { code: 'INLFRR', name: 'Virginia Inland Port (Front Royal)', city: 'Front Royal', state: 'VA', country: 'US', lat: 38.96, lng: -78.15, teuRank: 71 },
  { code: 'INLCGY', name: 'Calgary Intermodal', city: 'Calgary', state: 'AB', country: 'CA', lat: 51.05, lng: -114.07, teuRank: 72 },
  { code: 'INLEDM', name: 'Edmonton Intermodal', city: 'Edmonton', state: 'AB', country: 'CA', lat: 53.5, lng: -113.35, teuRank: 73 },
  { code: 'INLWPG', name: 'Winnipeg Intermodal', city: 'Winnipeg', state: 'MB', country: 'CA', lat: 49.85, lng: -97.1, teuRank: 74 },
];

export const TERMINALS_DATA: TerminalRow[] = [
  // ─── Port of Los Angeles (POLA) ──────────────────────────────────
  { portCode: 'USLAX', code: 'USLAX_APM_P400', name: 'APM Terminals — Pier 400', carrier: 'Maersk / Sealand', lat: 33.7390, lng: -118.2538 },
  { portCode: 'USLAX', code: 'USLAX_FENIX_P300', name: 'Fenix Marine Services — Pier 300', carrier: 'CMA CGM / APL', lat: 33.7414, lng: -118.2629 },
  { portCode: 'USLAX', code: 'USLAX_TRAPAC', name: 'TraPac LA', carrier: 'MOL / Mitsui', lat: 33.7515, lng: -118.2738 },
  { portCode: 'USLAX', code: 'USLAX_WBCT', name: 'West Basin Container Terminal (WBCT)', carrier: 'YML / Hyundai', lat: 33.7569, lng: -118.2658 },
  { portCode: 'USLAX', code: 'USLAX_YTI', name: 'Yusen Terminals (YTI)', carrier: 'NYK / ONE', lat: 33.7407, lng: -118.2662 },
  { portCode: 'USLAX', code: 'USLAX_EVERPORT', name: 'Everport Terminal Services', carrier: 'Evergreen / Cosco', lat: 33.7445, lng: -118.2549 },

  // ─── Port of Long Beach (POLB) ───────────────────────────────────
  { portCode: 'USLGB', code: 'USLGB_SSA_PIERAJ', name: 'SSA Marine — Pier A/J', carrier: 'Matson / various', lat: 33.7621, lng: -118.2218 },
  { portCode: 'USLGB', code: 'USLGB_ITS', name: 'International Transportation Service (ITS)', carrier: 'K-Line / ONE', lat: 33.7538, lng: -118.2128 },
  { portCode: 'USLGB', code: 'USLGB_LBCT', name: 'Long Beach Container Terminal (LBCT)', carrier: 'OOCL / Cosco', lat: 33.7440, lng: -118.2265 },
  { portCode: 'USLGB', code: 'USLGB_PCT', name: 'Pacific Container Terminal (PCT)', carrier: 'Hapag-Lloyd / various', lat: 33.7488, lng: -118.2154 },
  { portCode: 'USLGB', code: 'USLGB_TTI', name: 'Total Terminals International (TTI)', carrier: 'HMM / Hyundai', lat: 33.7495, lng: -118.2103 },
  { portCode: 'USLGB', code: 'USLGB_PMS', name: 'Pacific Maritime Services', carrier: 'various', lat: 33.7515, lng: -118.2046 },

  // ─── Port of NY / NJ ─────────────────────────────────────────────
  { portCode: 'USNYC', code: 'USNYC_APM_ELIZ', name: 'APM Terminals Elizabeth', carrier: 'Maersk / MSC', lat: 40.6772, lng: -74.1500 },
  { portCode: 'USNYC', code: 'USNYC_MAHER', name: 'Maher Terminals (Elizabeth)', carrier: 'CMA CGM / others', lat: 40.6726, lng: -74.1491 },
  { portCode: 'USNYC', code: 'USNYC_PNCT', name: 'Port Newark Container Terminal (PNCT)', carrier: 'Ports America', lat: 40.6857, lng: -74.1531 },
  { portCode: 'USNYC', code: 'USNYC_GCT_BAY', name: 'GCT Bayonne', carrier: 'GCT', lat: 40.6627, lng: -74.0884 },
  { portCode: 'USNYC', code: 'USNYC_GCT_NY', name: 'GCT New York (Staten Island)', carrier: 'GCT', lat: 40.6386, lng: -74.1718 },
  { portCode: 'USNYC', code: 'USNYC_RHCT', name: 'Red Hook Container Terminal (Brooklyn)', carrier: 'breakbulk / project', lat: 40.6781, lng: -74.0117, notes: 'Smaller — mostly project cargo.' },

  // ─── Port of Savannah ────────────────────────────────────────────
  { portCode: 'USSAV', code: 'USSAV_GCT', name: 'Garden City Terminal', carrier: 'all major lines', lat: 32.1224, lng: -81.1428, notes: 'Single dominant terminal — largest in N. America.' },
  { portCode: 'USSAV', code: 'USSAV_OCT', name: 'Ocean Terminal', carrier: 'breakbulk / RoRo', lat: 32.0857, lng: -81.0911 },

  // ─── Port of Charleston ──────────────────────────────────────────
  { portCode: 'USCHS', code: 'USCHS_LEATHERMAN', name: 'Hugh K. Leatherman Terminal', carrier: 'all major lines', lat: 32.8503, lng: -79.9586 },
  { portCode: 'USCHS', code: 'USCHS_WANDO', name: 'Wando Welch Terminal', carrier: 'major Asia lines', lat: 32.8156, lng: -79.8847 },
  { portCode: 'USCHS', code: 'USCHS_NCT', name: 'North Charleston Terminal', carrier: 'various', lat: 32.8767, lng: -79.9542 },

  // ─── Port of Norfolk / Hampton Roads ─────────────────────────────
  { portCode: 'USNOR', code: 'USNOR_VIG', name: 'Virginia International Gateway (VIG)', carrier: 'major Asia / Europe lines', lat: 36.8533, lng: -76.3786 },
  { portCode: 'USNOR', code: 'USNOR_NIT', name: 'Norfolk International Terminals (NIT)', carrier: 'various', lat: 36.9114, lng: -76.3325 },
  { portCode: 'USNOR', code: 'USNOR_PMT', name: 'Portsmouth Marine Terminal', carrier: 'breakbulk / project', lat: 36.8381, lng: -76.3083 },

  // ─── Port of Houston ─────────────────────────────────────────────
  { portCode: 'USHOU', code: 'USHOU_BAYPORT', name: 'Bayport Container Terminal', carrier: 'all major lines', lat: 29.6147, lng: -95.0103 },
  { portCode: 'USHOU', code: 'USHOU_BARBOURS', name: 'Barbours Cut Container Terminal', carrier: 'all major lines', lat: 29.6797, lng: -94.9967 },

  // ─── Port of Oakland ─────────────────────────────────────────────
  { portCode: 'USOAK', code: 'USOAK_OICT', name: 'Oakland International Container Terminal (OICT)', carrier: 'major lines', lat: 37.7995, lng: -122.3128 },
  { portCode: 'USOAK', code: 'USOAK_TRAPAC', name: 'TraPac Oakland', carrier: 'MOL / various', lat: 37.8089, lng: -122.3221 },
  { portCode: 'USOAK', code: 'USOAK_BEN_NUTTER', name: 'Ben E. Nutter Terminal', carrier: 'Evergreen / others', lat: 37.7950, lng: -122.3088 },
  { portCode: 'USOAK', code: 'USOAK_OHT', name: 'Outer Harbor Terminal', carrier: 'various', lat: 37.8136, lng: -122.3228 },

  // ─── Port of Seattle ─────────────────────────────────────────────
  { portCode: 'USSEA', code: 'USSEA_T5', name: 'Terminal 5 (SSA)', carrier: 'major Asia lines', lat: 47.5817, lng: -122.3650 },
  { portCode: 'USSEA', code: 'USSEA_T18', name: 'Terminal 18 (SSA)', carrier: 'major Asia lines', lat: 47.5825, lng: -122.3486 },
  { portCode: 'USSEA', code: 'USSEA_T30', name: 'Terminal 30', carrier: 'various', lat: 47.5786, lng: -122.3433 },

  // ─── Port of Tacoma ──────────────────────────────────────────────
  { portCode: 'USTIW', code: 'USTIW_HUSKY', name: 'Husky Terminal (SSA)', carrier: 'major lines', lat: 47.2667, lng: -122.4138 },
  { portCode: 'USTIW', code: 'USTIW_WUT', name: 'Washington United Terminals (WUT)', carrier: 'major lines', lat: 47.2750, lng: -122.4081 },
  { portCode: 'USTIW', code: 'USTIW_PCT', name: 'Pierce County Terminal', carrier: 'various', lat: 47.2575, lng: -122.4181 },

  // ─── Port of Vancouver (CA) ──────────────────────────────────────
  { portCode: 'CAVAN', code: 'CAVAN_CENTERM', name: 'DP World Centerm', carrier: 'major Asia lines', lat: 49.2884, lng: -123.0974 },
  { portCode: 'CAVAN', code: 'CAVAN_DELTAPORT', name: 'GCT Deltaport', carrier: 'GCT', lat: 49.0058, lng: -123.1503 },
  { portCode: 'CAVAN', code: 'CAVAN_VANTERM', name: 'GCT Vanterm', carrier: 'GCT', lat: 49.2858, lng: -123.0728 },
  { portCode: 'CAVAN', code: 'CAVAN_FRASER', name: 'Fraser Surrey Docks', carrier: 'breakbulk / project', lat: 49.1828, lng: -122.8458 },

  // ─── Port of Prince Rupert ──────────────────────────────────────
  { portCode: 'CAPRR', code: 'CAPRR_FAIRVIEW', name: 'Fairview Container Terminal', carrier: 'major Asia lines', lat: 54.3175, lng: -130.3019 },

  // ─── Port of Montreal ───────────────────────────────────────────
  { portCode: 'CAMTR', code: 'CAMTR_TERMONT', name: 'Termont (Cast Terminal)', carrier: 'CMA CGM / Hapag-Lloyd', lat: 45.5564, lng: -73.5269 },
  { portCode: 'CAMTR', code: 'CAMTR_RACINE', name: 'Racine Terminal', carrier: 'MSC', lat: 45.5503, lng: -73.5428 },
  { portCode: 'CAMTR', code: 'CAMTR_BICKERDIKE', name: 'Bickerdike Terminal', carrier: 'various', lat: 45.4889, lng: -73.5403 },

  // ─── Port of Halifax ────────────────────────────────────────────
  { portCode: 'CAHAL', code: 'CAHAL_HALTERM', name: 'PSA Halifax (Halterm)', carrier: 'all major lines', lat: 44.6303, lng: -63.5586 },
  { portCode: 'CAHAL', code: 'CAHAL_FAIRVIEW', name: 'Fairview Cove (Cerescorp)', carrier: 'major Atlantic lines', lat: 44.6789, lng: -63.6225 },

  // ─── Port of Baltimore ──────────────────────────────────────────
  { portCode: 'USBAL', code: 'USBAL_SEAGIRT', name: 'Seagirt Marine Terminal', carrier: 'major lines', lat: 39.2528, lng: -76.5439 },
  { portCode: 'USBAL', code: 'USBAL_DUNDALK', name: 'Dundalk Marine Terminal', carrier: 'breakbulk / RoRo', lat: 39.2542, lng: -76.5283 },

  // ─── Chicago Intermodal Ramps ───────────────────────────────────
  { portCode: 'INLCHI', code: 'INLCHI_BNSF_LPC', name: 'BNSF Logistics Park Chicago (LPC) — Joliet/Elwood', carrier: 'BNSF', lat: 41.4297, lng: -88.1356, notes: 'The big one. Most LA/LB→Chicago boxes land here.' },
  { portCode: 'INLCHI', code: 'INLCHI_BNSF_CICERO', name: 'BNSF Cicero', carrier: 'BNSF', lat: 41.8525, lng: -87.7553 },
  { portCode: 'INLCHI', code: 'INLCHI_BNSF_CORWITH', name: 'BNSF Corwith', carrier: 'BNSF', lat: 41.8089, lng: -87.7269 },
  { portCode: 'INLCHI', code: 'INLCHI_UP_GLOBAL_IV', name: 'UP Global IV — Joliet', carrier: 'UP', lat: 41.4581, lng: -88.0392 },
  { portCode: 'INLCHI', code: 'INLCHI_UP_G3', name: 'UP G3 — Rochelle', carrier: 'UP', lat: 41.9244, lng: -89.0689 },
  { portCode: 'INLCHI', code: 'INLCHI_UP_YARDCENTER', name: 'UP Yard Center — Dolton', carrier: 'UP', lat: 41.6342, lng: -87.6011 },
  { portCode: 'INLCHI', code: 'INLCHI_UP_GLOBAL_I', name: 'UP Global I', carrier: 'UP', lat: 41.8675, lng: -87.7531 },
  { portCode: 'INLCHI', code: 'INLCHI_UP_GLOBAL_II', name: 'UP Global II — Northlake', carrier: 'UP', lat: 41.9097, lng: -87.8997 },
  { portCode: 'INLCHI', code: 'INLCHI_UP_GLOBAL_III', name: 'UP Global III — Rochelle', carrier: 'UP', lat: 41.9217, lng: -89.0717 },
  { portCode: 'INLCHI', code: 'INLCHI_CN_HARVEY', name: 'CN Harvey', carrier: 'CN', lat: 41.6097, lng: -87.6464 },
  { portCode: 'INLCHI', code: 'INLCHI_CN_JOLIET', name: 'CN Joliet (Markham)', carrier: 'CN', lat: 41.5914, lng: -87.6917 },
  { portCode: 'INLCHI', code: 'INLCHI_CSX_BEDFORDPK', name: 'CSX Bedford Park', carrier: 'CSX', lat: 41.7506, lng: -87.7892 },
  { portCode: 'INLCHI', code: 'INLCHI_CSX_59TH', name: 'CSX 59th Street', carrier: 'CSX', lat: 41.7928, lng: -87.6781 },
  { portCode: 'INLCHI', code: 'INLCHI_NS_LANDERS', name: 'NS Landers Yard', carrier: 'NS', lat: 41.8625, lng: -87.7706 },
  { portCode: 'INLCHI', code: 'INLCHI_NS_47TH', name: 'NS 47th Street', carrier: 'NS', lat: 41.8083, lng: -87.6819 },
  { portCode: 'INLCHI', code: 'INLCHI_NS_63RD', name: 'NS 63rd Street', carrier: 'NS', lat: 41.7794, lng: -87.6833 },

  // ─── Memphis Intermodal ─────────────────────────────────────────
  { portCode: 'INLMEM', code: 'INLMEM_BNSF', name: 'BNSF Memphis Intermodal', carrier: 'BNSF', lat: 35.0683, lng: -89.9486 },
  { portCode: 'INLMEM', code: 'INLMEM_NS', name: 'NS Forrest Yard', carrier: 'NS', lat: 35.1297, lng: -89.9956 },
  { portCode: 'INLMEM', code: 'INLMEM_CN', name: 'CN Memphis (Harrison Yard)', carrier: 'CN', lat: 35.1389, lng: -89.9514 },

  // ─── Dallas/Fort Worth Intermodal ───────────────────────────────
  { portCode: 'INLDFW', code: 'INLDFW_BNSF_ALLIANCE', name: 'BNSF Alliance — Haslet', carrier: 'BNSF', lat: 32.9931, lng: -97.2986 },
  { portCode: 'INLDFW', code: 'INLDFW_UP_DALLAS', name: 'UP Dallas Intermodal — Mesquite', carrier: 'UP', lat: 32.7681, lng: -96.5994 },

  // ─── Atlanta Intermodal ─────────────────────────────────────────
  { portCode: 'INLATL', code: 'INLATL_NS_INMAN', name: 'NS Inman Yard / Whitaker', carrier: 'NS', lat: 33.7997, lng: -84.4275 },
  { portCode: 'INLATL', code: 'INLATL_CSX_HULSEY', name: 'CSX Hulsey Yard', carrier: 'CSX', lat: 33.7456, lng: -84.3789 },

  // ─── Toronto Intermodal ─────────────────────────────────────────
  { portCode: 'INLTOR', code: 'INLTOR_CN_BRAMPTON', name: 'CN Brampton Intermodal', carrier: 'CN', lat: 43.7569, lng: -79.7456 },
  { portCode: 'INLTOR', code: 'INLTOR_CP_VAUGHAN', name: 'CP Vaughan Intermodal', carrier: 'CP', lat: 43.7886, lng: -79.5847 },

  // ═══ Marine terminals for previously-empty + regional ports (fill 2026-08) ═══
  // Port of Portland (USPDX)
  { portCode: 'USPDX', code: 'USPDX_TERMINAL_6', name: 'Terminal 6 — Oregon Container Terminal', carrier: 'Harbor Industrial Services', type: 'container', lat: 45.635, lng: -122.786, notes: 'Oregon\'s only international container terminal; Harbor took over commercial ops Jan 1 2026 (formerly ICTSI Oregon).' },
  // Port of Jacksonville (JAXPORT) (USJAX)
  { portCode: 'USJAX', code: 'USJAX_SSA_JACKSONVILLE', name: 'SSA Jacksonville Container Terminal — Blount Island', carrier: 'SSA Marine', type: 'container', lat: 30.394, lng: -81.529, notes: 'JAXPORT\'s largest facility; 47ft channel, 6 electric cranes.' },
  { portCode: 'USJAX', code: 'USJAX_DAMES_POINT', name: 'Dames Point / TraPac Container Terminal', carrier: 'Ceres Terminals', type: 'container', lat: 30.387, lng: -81.556, notes: 'Ceres acquired the 158-acre terminal after MOL/TraPac exited in 2022.' },
  { portCode: 'USJAX', code: 'USJAX_TALLEYRAND_MARINE', name: 'Talleyrand Marine Terminal', carrier: 'JAXPORT', type: 'multipurpose', lat: 30.351, lng: -81.627, notes: 'Container/breakbulk/auto.' },
  // PortMiami (USMIA)
  { portCode: 'USMIA', code: 'USMIA_POMTOC_PORT', name: 'POMTOC (Port of Miami Terminal Operating Company)', carrier: 'POMTOC', type: 'container', lat: 25.7745, lng: -80.164, notes: 'Only non-carrier terminal operator; 75 acres, 50ft depth.' },
  { portCode: 'USMIA', code: 'USMIA_SOUTH_FLORIDA', name: 'South Florida Container Terminal (SFCT)', carrier: 'APM Terminals / CMA CGM JV', type: 'container', lat: 25.779, lng: -80.169 },
  { portCode: 'USMIA', code: 'USMIA_SEABOARD_MARINE', name: 'Seaboard Marine Terminal', carrier: 'Seaboard Marine', type: 'container', lat: 25.772, lng: -80.173, notes: 'Caribbean / Latin America services.' },
  // Port Everglades (USPEF)
  { portCode: 'USPEF', code: 'USPEF_FLORIDA_INTERNATIONAL', name: 'Florida International Terminal (FIT)', carrier: 'Hanseatic Global Terminals (Hapag-Lloyd)', type: 'container', lat: 26.087, lng: -80.118, notes: '46-acre Southport terminal; HGT became full owner Apr 2026.' },
  { portCode: 'USPEF', code: 'USPEF_SOUTHPORT_CONTAINER', name: 'Southport Container Berths', carrier: 'Port Everglades / SAAM Terminals stevedoring', type: 'container', lat: 26.09, lng: -80.117, notes: 'MSC, ZIM and others; served by near-dock ICTF.' },
  { portCode: 'USPEF', code: 'USPEF_INTERMODAL_CONTAINER', name: 'Intermodal Container Transfer Facility (ICTF)', carrier: 'Florida East Coast Railway', type: 'rail-ictf', lat: 26.079, lng: -80.142, notes: '43-acre near-dock rail; connects to CSX/NS via FEC.' },
  // Port of Philadelphia (PhilaPort) (USPHL)
  { portCode: 'USPHL', code: 'USPHL_PACKER_AVENUE', name: 'Packer Avenue Marine Terminal', carrier: 'Holt Logistics (Astro Holdings)', type: 'container', lat: 39.913, lng: -75.14, notes: '~350k TEU/yr; ~50% reefers, 2,200+ reefer plugs.' },
  { portCode: 'USPHL', code: 'USPHL_TIOGA_MARINE', name: 'Tioga Marine Terminal', carrier: 'Holt Logistics', type: 'breakbulk', lat: 39.982, lng: -75.093, notes: 'Reefer/breakbulk (fruit).' },
  // Port of Boston (USBOS)
  { portCode: 'USBOS', code: 'USBOS_PAUL_W', name: 'Paul W. Conley Container Terminal', carrier: 'Massport (Massachusetts Port Authority)', type: 'container', lat: 42.338, lng: -71.033, notes: 'Only full-service container terminal in New England.' },
  // Port of Wilmington (DE) (USWIL)
  { portCode: 'USWIL', code: 'USWIL_PORT_OF', name: 'Port of Wilmington Marine Terminal', carrier: 'Enstructure (GT USA Wilmington)', type: 'multipurpose', lat: 39.715, lng: -75.522, notes: 'Leading North American gateway for fresh fruit/reefer (Dole, Chiquita); Enstructure took over ops July 2023. Edgemoor container expansion planned.' },
  // Port of Wilmington (NC) (USILM)
  { portCode: 'USILM', code: 'USILM_WILMINGTON_CONTAINER', name: 'Wilmington Container Terminal', carrier: 'North Carolina State Ports Authority', type: 'container', lat: 34.19, lng: -77.954, notes: '2 neo-Panamax cranes; PortCity transload solution on site.' },
  // Port of Galveston (USGLS)
  { portCode: 'USGLS', code: 'USGLS_GALVESTON_WHARVES', name: 'Galveston Wharves (Piers 38-41)', carrier: 'Ports America Texas / Metro Ports', type: 'roro', lat: 29.31, lng: -94.79, notes: 'Primarily RoRo (Wallenius Wilhelmsen, ARC, K-Line, NYK) + breakbulk/project; limited container.' },
  // Port Freeport (USFPO)
  { portCode: 'USFPO', code: 'USFPO_VELASCO_CONTAINER', name: 'Velasco Container Terminal (Berths 7 & 8)', carrier: 'Port Freeport', type: 'container', lat: 28.933, lng: -95.312, notes: '1,800ft berth, 2 post-Panamax STS cranes, 20+ acre yard.' },
  { portCode: 'USFPO', code: 'USFPO_FREEPORT_RORO', name: 'Freeport RoRo Terminal', carrier: 'Amports', type: 'roro', lat: 28.94, lng: -95.32, notes: '10,000+ vehicle spots.' },
  // Port of New Orleans (Port NOLA) (USNOL)
  { portCode: 'USNOL', code: 'USNOL_NAPOLEON_AVENUE', name: 'Napoleon Avenue Container Terminal', carrier: 'New Orleans Terminal LLC (Ports America / Terminal Investment Ltd)', type: 'container', lat: 29.933, lng: -90.106, notes: '47-acre complex, 2 berths, 45ft depth, ~366k TEU/yr; air-draft limited by Crescent City Connection bridge.' },
  { portCode: 'USNOL', code: 'USNOL_LOUISIANA_INTERNATIONAL', name: 'Louisiana International Terminal (LIT) — Violet (future)', carrier: 'APM Terminals / Port NOLA', type: 'container', lat: 29.889, lng: -89.899, notes: '~$500M downriver deep-water container terminal under development in St. Bernard Parish.' },
  // Port of Mobile (USMOB)
  { portCode: 'USMOB', code: 'USMOB_APM_TERMINALS', name: 'APM Terminals Mobile', carrier: 'APM Terminals', type: 'container', lat: 30.664, lng: -88.033, notes: 'High-productivity container terminal; near-dock ICTF connects CSX/CN/NS.' },
  // Don Young Port of Alaska (Anchorage) (USANC)
  { portCode: 'USANC', code: 'USANC_TERMINAL_1', name: 'Terminal 1 (LoLo/RoRo)', carrier: 'Matson & TOTE Maritime', type: 'multipurpose', lat: 61.238, lng: -149.888, notes: 'Handles ~half of all Alaska inbound freight; Matson containerships + TOTE RoRo, twice-weekly from Tacoma.' },
  // Honolulu Harbor (USHNL)
  { portCode: 'USHNL', code: 'USHNL_MATSON_SAND', name: 'Matson Sand Island Terminal', carrier: 'Matson', type: 'container', lat: 21.308, lng: -157.888, notes: 'Berths 60-63; container + RoRo.' },
  { portCode: 'USHNL', code: 'USHNL_KAPALAMA_CONTAINER', name: 'Kapalama Container Terminal (KCT)', carrier: 'Pasha Hawaii / Hawaii Stevedores', type: 'container', lat: 21.317, lng: -157.883, notes: '86-acre new terminal; Pasha Hawaii moved from Sand Island.' },
  // Port of San Diego (USSAN)
  { portCode: 'USSAN', code: 'USSAN_TENTH_AVENUE', name: 'Tenth Avenue Marine Terminal', carrier: 'San Diego Unified Port District', type: 'multipurpose', lat: 32.6957, lng: -117.144, notes: 'Omni-terminal: reefer container, breakbulk, dry bulk; 96 acres, 4 berths.' },
  { portCode: 'USSAN', code: 'USSAN_NATIONAL_CITY', name: 'National City Marine Terminal', carrier: 'Pasha Automotive Services', type: 'roro', lat: 32.6664, lng: -117.113, notes: 'Primarily autos/RoRo.' },
  // Port of Hueneme (USHUE)
  { portCode: 'USHUE', code: 'USHUE_PORT_OF', name: 'Port of Hueneme (Oxnard Harbor District)', carrier: 'Ports America / Del Monte / Chiquita', type: 'roro', lat: 34.1478, lng: -119.2073, notes: 'Autos + reefer produce (bananas, citrus); limited container.' },
  // Port of Gulfport (USGPT)
  { portCode: 'USGPT', code: 'USGPT_MISSISSIPPI_STATE', name: 'Mississippi State Port at Gulfport', carrier: 'Mississippi State Port Authority', type: 'container', lat: 30.3566, lng: -89.0911, notes: 'Reefer container gateway — Crowley, Chiquita, Dole (Central America/Caribbean fruit).' },
  // Port of Palm Beach (USPBI)
  { portCode: 'USPBI', code: 'USPBI_PORT_OF', name: 'Port of Palm Beach', carrier: 'Tropical Shipping (stevedored)', type: 'container', lat: 26.7717, lng: -80.045, notes: '4th-busiest container port in Florida; Bahamas/Caribbean via Tropical Shipping.' },
  // Port of Fernandina (USFEB)
  { portCode: 'USFEB', code: 'USFEB_FERNANDINA_CONTAINER', name: 'Fernandina Container Terminal', carrier: 'Worldwide Terminals Fernandina', type: 'container', lat: 30.6697, lng: -81.467, notes: 'Small Caribbean/Puerto Rico container + breakbulk.' },
  // Gloucester Marine Terminal (Delaware River) (USGLC)
  { portCode: 'USGLC', code: 'USGLC_GLOUCESTER_MARINE', name: 'Gloucester Marine Terminal', carrier: 'Holt Logistics', type: 'breakbulk', lat: 39.894, lng: -75.125, notes: 'Reefer/fruit + breakbulk on the Delaware River (Holt).' },
  // Port of Cleveland (USCLE)
  { portCode: 'USCLE', code: 'USCLE_CLEVELAND_BULK', name: 'Cleveland Bulk / Cleveland-Europe Express Terminal', carrier: 'Cleveland-Cuyahoga County Port Authority (Spliethoff)', type: 'container', lat: 41.51, lng: -81.705, notes: 'Great Lakes container liner service to Antwerp (Cleveland-Europe Express) + breakbulk.' },
  // Port of Nanaimo (CANAI)
  { portCode: 'CANAI', code: 'CANAI_DP_WORLD', name: 'DP World Nanaimo — Duke Point Terminal', carrier: 'DP World', type: 'container', lat: 49.133, lng: -123.889, notes: 'Vancouver Island container gateway; berth expanding to 325m / 280k TEU capacity (construction from Apr 2025).' },
  { portCode: 'CANAI', code: 'CANAI_NANAIMO_ASSEMBLY', name: 'Nanaimo Assembly Wharf', carrier: 'DP World / Nanaimo Port Authority', type: 'breakbulk', lat: 49.167, lng: -123.933, notes: 'Breakbulk/forest products.' },
  // Port of Quebec (CASTQ)
  { portCode: 'CASTQ', code: 'CASTQ_BEAUPORT_SECTOR', name: 'Beauport Sector Terminals', carrier: 'QSL', type: 'multipurpose', lat: 46.834, lng: -71.183, notes: 'Bulk/breakbulk + limited container; designated international container port.' },
  { portCode: 'CASTQ', code: 'CASTQ_LAURENTIA_CONTAINER', name: 'Laurentia Container Terminal (future)', carrier: 'Hutchison Ports / CN Rail', type: 'container', lat: 46.83, lng: -71.19, notes: 'Planned C$775M deep-water terminal, 16m depth, 13,000 TEU vessels — not yet operational.' },
  // Port of Saint John (CASJB)
  { portCode: 'CASJB', code: 'CASJB_DP_WORLD', name: 'DP World Saint John — West Side Container Terminal', carrier: 'DP World', type: 'container', lat: 45.262, lng: -66.077, notes: 'Atlantic Canada\'s fastest-growing gateway; 239k TEU in 2025 (+29%). CAD$247M West Side Modernization completed Jan 2026.' },
  // Port of Toronto (CATOR)
  { portCode: 'CATOR', code: 'CATOR_MARINE_TERMINAL', name: 'Marine Terminal 51 / Container Distribution Centre', carrier: 'PortsToronto', type: 'multipurpose', lat: 43.642, lng: -79.348, notes: 'Regional container depot (100k sqft heated storage, rail + truck docks) + Great Lakes breakbulk; not a deep-sea container gateway.' },
  // Port of Hamilton (CAHAM)
  { portCode: 'CAHAM', code: 'CAHAM_HAMILTON_CONTAINER', name: 'Hamilton Container Terminal (Pier 18)', carrier: 'Hamilton Container Terminal (HCT) / HOPA Ports', type: 'container', lat: 43.29, lng: -79.8, notes: 'Container depot / inland rail terminal (CBSA-backed) for southern Ontario; ~300 TEU capacity depot at a port handling ~600k tonnes.' },
  // Port Newark-Elizabeth (USEWR) — NJ-side marine terminals
  { portCode: 'USEWR', code: 'USEWR_APM_ELIZ', name: 'APM Terminals Elizabeth', carrier: 'APM Terminals (Maersk)', type: 'container', lat: 40.6772, lng: -74.15 },
  { portCode: 'USEWR', code: 'USEWR_PNCT', name: 'Port Newark Container Terminal (PNCT)', carrier: 'Ports America / Terminal Investment Ltd', type: 'container', lat: 40.6857, lng: -74.1531 },
  { portCode: 'USEWR', code: 'USEWR_MAHER', name: 'Maher Terminals (Elizabeth)', carrier: 'Maher Terminals', type: 'container', lat: 40.6726, lng: -74.1491 },
  { portCode: 'USEWR', code: 'USEWR_EXPRESSRAIL', name: 'ExpressRail Elizabeth (on-dock rail)', carrier: 'CSX / NS (PANYNJ)', type: 'rail', lat: 40.68, lng: -74.15 },

  // ═══ Class-I intermodal rail ramps by metro (fill 2026-08) ═══
  // Los Angeles — rail ramps → USLAX
  { portCode: 'USLAX', code: 'RAMP_BNSF_HOBART', name: 'BNSF Los Angeles Intermodal Facility (Hobart)', carrier: 'BNSF', type: 'rail', lat: 34.006, lng: -118.157, notes: 'near-dock — Largest intermodal facility in North America; 1M+ lifts/yr.' },
  { portCode: 'USLAX', code: 'RAMP_UP_ICTF', name: 'UP Intermodal Container Transfer Facility (ICTF)', carrier: 'UP', type: 'rail', lat: 33.808, lng: -118.212, notes: 'near-dock — 2401 E Sepulveda Blvd; serves POLA/POLB.' },
  { portCode: 'USLAX', code: 'RAMP_UP_LATC', name: 'UP Los Angeles Transportation Center (LATC)', carrier: 'UP', type: 'rail', lat: 34.065, lng: -118.222, notes: 'inland — 599 N Mission Rd.' },
  // Inland Empire — rail ramps → INLIE
  { portCode: 'INLIE', code: 'RAMP_BNSF_SANBERN', name: 'BNSF San Bernardino Intermodal Facility', carrier: 'BNSF', type: 'rail', lat: 34.083, lng: -117.29, notes: 'inland' },
  { portCode: 'INLIE', code: 'RAMP_BNSF_BARSTOW', name: 'BNSF Barstow Classification/Intermodal Yard', carrier: 'BNSF', type: 'rail', lat: 34.9, lng: -117.05, notes: 'inland — Barstow International Gateway master-hub under development.' },
  { portCode: 'INLIE', code: 'RAMP_UP_CITYINDUSTRY', name: 'UP City of Industry (East Los Angeles) Intermodal', carrier: 'UP', type: 'rail', lat: 34.019, lng: -117.96, notes: 'inland' },
  // Bay Area — rail ramps → USOAK
  { portCode: 'USOAK', code: 'RAMP_BNSF_OAKLAND', name: 'BNSF Oakland International Gateway (OIG)', carrier: 'BNSF', type: 'rail', lat: 37.803, lng: -122.311, notes: 'on-dock' },
  { portCode: 'USOAK', code: 'RAMP_UP_OAKLAND', name: 'UP Railport Oakland', carrier: 'UP', type: 'rail', lat: 37.795, lng: -122.298, notes: 'near-dock' },
  // Central Valley — rail ramps → INLCV
  { portCode: 'INLCV', code: 'RAMP_UP_LATHROP', name: 'UP Lathrop Intermodal Terminal', carrier: 'UP', type: 'rail', lat: 37.82, lng: -121.3, notes: 'inland' },
  { portCode: 'INLCV', code: 'RAMP_BNSF_STOCKTON', name: 'BNSF Stockton Intermodal', carrier: 'BNSF', type: 'rail', lat: 37.93, lng: -121.28, notes: 'inland' },
  // Phoenix — rail ramps → INLPHX
  { portCode: 'INLPHX', code: 'RAMP_UP_PHOENIX', name: 'UP Phoenix Intermodal Terminal', carrier: 'UP', type: 'rail', lat: 33.53, lng: -112.28, notes: 'inland' },
  // Salt Lake City — rail ramps → INLSLC
  { portCode: 'INLSLC', code: 'RAMP_UP_SLC', name: 'UP Salt Lake City Intermodal Terminal (SLCIT)', carrier: 'UP', type: 'rail', lat: 40.78, lng: -111.94, notes: 'inland' },
  // Denver — rail ramps → INLDEN
  { portCode: 'INLDEN', code: 'RAMP_UP_DENVER', name: 'UP Denver (36th Street) Intermodal', carrier: 'UP', type: 'rail', lat: 39.78, lng: -104.95, notes: 'inland' },
  { portCode: 'INLDEN', code: 'RAMP_BNSF_DENVER', name: 'BNSF Denver (Front Range) Intermodal', carrier: 'BNSF', type: 'rail', lat: 39.8, lng: -104.93, notes: 'inland' },
  // Seattle/Tacoma — rail ramps → USSEA
  { portCode: 'USSEA', code: 'RAMP_BNSF_SEATTLE', name: 'BNSF Seattle International Gateway (SIG)', carrier: 'BNSF', type: 'rail', lat: 47.573, lng: -122.335, notes: 'near-dock' },
  { portCode: 'USSEA', code: 'RAMP_UP_SEATTLE', name: 'UP Seattle (Argo) Intermodal', carrier: 'UP', type: 'rail', lat: 47.55, lng: -122.33, notes: 'near-dock' },
  { portCode: 'USSEA', code: 'RAMP_BNSF_TACOMA', name: 'BNSF Tacoma (South Seattle) Intermodal', carrier: 'BNSF', type: 'rail', lat: 47.27, lng: -122.42, notes: 'near-dock' },
  { portCode: 'USSEA', code: 'RAMP_UP_TACOMA', name: 'UP Tacoma (Fife/Pierce) Intermodal', carrier: 'UP', type: 'rail', lat: 47.24, lng: -122.36, notes: 'near-dock' },
  // Portland — rail ramps → USPDX
  { portCode: 'USPDX', code: 'RAMP_UP_PORTLAND', name: 'UP Albina (Portland) Intermodal', carrier: 'UP', type: 'rail', lat: 45.55, lng: -122.68, notes: 'inland' },
  { portCode: 'USPDX', code: 'RAMP_BNSF_PORTLAND', name: 'BNSF Portland (Lake Yard) Intermodal', carrier: 'BNSF', type: 'rail', lat: 45.6, lng: -122.72, notes: 'inland' },
  // Houston — rail ramps → USHOU
  { portCode: 'USHOU', code: 'RAMP_UP_HOUSTON', name: 'UP Englewood (Settegast) Intermodal', carrier: 'UP', type: 'rail', lat: 29.8, lng: -95.3, notes: 'inland — 6800 Kirkpatrick Blvd.' },
  { portCode: 'USHOU', code: 'RAMP_BNSF_HOUSTON', name: 'BNSF Houston (Pearland) Intermodal', carrier: 'BNSF', type: 'rail', lat: 29.55, lng: -95.3, notes: 'inland' },
  // San Antonio — rail ramps → INLSAT
  { portCode: 'INLSAT', code: 'RAMP_UP_SANANTONIO', name: 'UP San Antonio Intermodal Terminal (SAIT)', carrier: 'UP', type: 'rail', lat: 29.3, lng: -98.35, notes: 'inland' },
  // El Paso — rail ramps → INLELP
  { portCode: 'INLELP', code: 'RAMP_UP_ELPASO', name: 'UP El Paso Intermodal', carrier: 'UP', type: 'rail', lat: 31.77, lng: -106.35, notes: 'inland — US-Mexico gateway.' },
  // Kansas City — rail ramps → INLKCK
  { portCode: 'INLKCK', code: 'RAMP_BNSF_ARGENTINE', name: 'BNSF Argentine Yard Intermodal', carrier: 'BNSF', type: 'rail', lat: 39.09, lng: -94.66, notes: 'inland' },
  { portCode: 'INLKCK', code: 'RAMP_BNSF_LPKC', name: 'BNSF Logistics Park Kansas City (LPKC)', carrier: 'BNSF', type: 'rail', lat: 38.79, lng: -94.96, notes: 'inland — Large CenterPoint intermodal + warehousing park.' },
  { portCode: 'INLKCK', code: 'RAMP_UP_KC_NEFF', name: 'UP Kansas City (Neff Yard) Intermodal', carrier: 'UP', type: 'rail', lat: 39.1, lng: -94.52, notes: 'inland' },
  { portCode: 'INLKCK', code: 'RAMP_CPKC_KC', name: 'CPKC Kansas City (Knoche Yard) Intermodal', carrier: 'CPKC', type: 'rail', lat: 39.13, lng: -94.58, notes: 'inland — CPKC single-line US-Mexico-Canada hub.' },
  { portCode: 'INLKCK', code: 'RAMP_NS_KC', name: 'NS Kansas City (Voltz) Intermodal', carrier: 'NS', type: 'rail', lat: 39.11, lng: -94.63, notes: 'inland' },
  // St. Louis — rail ramps → INLSTL
  { portCode: 'INLSTL', code: 'RAMP_UP_STLOUIS', name: 'UP Dupo (St. Louis) Intermodal', carrier: 'UP', type: 'rail', lat: 38.52, lng: -90.2, notes: 'inland' },
  { portCode: 'INLSTL', code: 'RAMP_BNSF_STLOUIS', name: 'BNSF St. Louis (Lindenwood) Intermodal', carrier: 'BNSF', type: 'rail', lat: 38.6, lng: -90.28, notes: 'inland' },
  { portCode: 'INLSTL', code: 'RAMP_NS_STLOUIS', name: 'NS St. Louis (Luther Yard) Intermodal', carrier: 'NS', type: 'rail', lat: 38.66, lng: -90.25, notes: 'inland' },
  // Minneapolis/St. Paul — rail ramps → INLMSP
  { portCode: 'INLMSP', code: 'RAMP_BNSF_STPAUL', name: 'BNSF St. Paul (Midway) Intermodal', carrier: 'BNSF', type: 'rail', lat: 44.96, lng: -93.17, notes: 'inland' },
  { portCode: 'INLMSP', code: 'RAMP_UP_MINNEAPOLIS', name: 'UP Minneapolis (Shoreham) Intermodal', carrier: 'UP', type: 'rail', lat: 45, lng: -93.28, notes: 'inland' },
  // Detroit — rail ramps → INLDET
  { portCode: 'INLDET', code: 'RAMP_CSX_DETROIT', name: 'CSX Detroit (Livernois-Junction) Intermodal', carrier: 'CSX', type: 'rail', lat: 42.32, lng: -83.13, notes: 'inland' },
  { portCode: 'INLDET', code: 'RAMP_NS_DETROIT', name: 'NS Detroit (Delray/Melvindale) Intermodal', carrier: 'NS', type: 'rail', lat: 42.28, lng: -83.15, notes: 'inland' },
  { portCode: 'INLDET', code: 'RAMP_CN_DETROIT', name: 'CN Detroit (Moterm) Intermodal', carrier: 'CN', type: 'rail', lat: 42.3, lng: -83.16, notes: 'inland — CN cross-border via Detroit River tunnel.' },
  // Columbus — rail ramps → INLCMH
  { portCode: 'INLCMH', code: 'RAMP_NS_RICKENBACKER', name: 'NS Rickenbacker Intermodal Terminal', carrier: 'NS', type: 'rail', lat: 39.8136, lng: -82.9277, notes: 'inland — Adjacent to Rickenbacker International Airport / inland port.' },
  // Toledo/NW Ohio — rail ramps → INLTOL
  { portCode: 'INLTOL', code: 'RAMP_CSX_NWOHIO', name: 'CSX Northwest Ohio Intermodal Terminal', carrier: 'CSX', type: 'rail', lat: 41.18, lng: -83.68, notes: 'inland — CSX\'s flagship hub-and-spoke intermodal terminal.' },
  // Cincinnati — rail ramps → INLCVG
  { portCode: 'INLCVG', code: 'RAMP_CSX_QUEENSGATE', name: 'CSX Queensgate (Cincinnati) Intermodal', carrier: 'CSX', type: 'rail', lat: 39.11, lng: -84.55, notes: 'inland' },
  // Charlotte — rail ramps → INLCLT
  { portCode: 'INLCLT', code: 'RAMP_NS_CHARLOTTE', name: 'NS Charlotte Intermodal Terminal (CIT)', carrier: 'NS', type: 'rail', lat: 35.31, lng: -80.72, notes: 'inland' },
  // Jacksonville — rail ramps → USJAX
  { portCode: 'USJAX', code: 'RAMP_CSX_JACKSONVILLE', name: 'CSX Jacksonville (Simpson Yard) Intermodal', carrier: 'CSX', type: 'rail', lat: 30.4, lng: -81.66, notes: 'inland' },
  { portCode: 'USJAX', code: 'RAMP_FEC_JACKSONVILLE', name: 'FEC Jacksonville Intermodal', carrier: 'FEC', type: 'rail', lat: 30.33, lng: -81.63, notes: 'inland — Florida East Coast; links to CSX/NS.' },
  // Harrisburg — rail ramps → INLHAR
  { portCode: 'INLHAR', code: 'RAMP_NS_RUTHERFORD', name: 'NS Rutherford (Harrisburg) Intermodal', carrier: 'NS', type: 'rail', lat: 40.28, lng: -76.79, notes: 'inland' },
  // New York/New Jersey — rail ramps → USNYC
  { portCode: 'USNYC', code: 'RAMP_CSX_NORTHBERGEN', name: 'CSX North Bergen Intermodal', carrier: 'CSX', type: 'rail', lat: 40.85, lng: -74.02, notes: 'near-dock' },
  { portCode: 'USNYC', code: 'RAMP_NS_CROXTON', name: 'NS Croxton Intermodal', carrier: 'NS', type: 'rail', lat: 40.75, lng: -74.07, notes: 'near-dock' },
  { portCode: 'USNYC', code: 'RAMP_EXPRESSRAIL_ELIZABETH', name: 'ExpressRail Elizabeth (on-dock)', carrier: 'CSX', type: 'rail', lat: 40.68, lng: -74.15, notes: 'on-dock — PANYNJ on-dock rail served by CSX + NS at APM/Maher/PNCT.' },
  // Baltimore — rail ramps → USBAL
  { portCode: 'USBAL', code: 'RAMP_CSX_SEAGIRT', name: 'CSX Seagirt On-Dock Rail (Baltimore)', carrier: 'CSX', type: 'rail', lat: 39.25, lng: -76.54, notes: 'on-dock' },
  { portCode: 'USBAL', code: 'RAMP_NS_BAYVIEW', name: 'NS Bayview (Baltimore) Intermodal', carrier: 'NS', type: 'rail', lat: 39.28, lng: -76.55, notes: 'near-dock' },
  // Hampton Roads — rail ramps → USNOR
  { portCode: 'USNOR', code: 'RAMP_NS_NIT', name: 'NS Norfolk International Terminals On-Dock Rail', carrier: 'NS', type: 'rail', lat: 36.91, lng: -76.33, notes: 'on-dock' },
  // Front Royal — rail ramps → INLFRR
  { portCode: 'INLFRR', code: 'RAMP_NS_VIRGINIAINLAND', name: 'NS Virginia Inland Port (VIP)', carrier: 'NS', type: 'rail', lat: 38.96, lng: -78.15, notes: 'inland — Inland port feeding Port of Virginia.' },
  // Montreal — rail ramps → CAMTR
  { portCode: 'CAMTR', code: 'RAMP_CN_TASCHEREAU', name: 'CN Taschereau Yard Intermodal', carrier: 'CN', type: 'rail', lat: 45.45, lng: -73.68, notes: 'inland' },
  { portCode: 'CAMTR', code: 'RAMP_CPKC_LACHINE', name: 'CPKC Lachine Intermodal Terminal', carrier: 'CPKC', type: 'rail', lat: 45.44, lng: -73.68, notes: 'inland' },
  // Vancouver — rail ramps → CAVAN
  { portCode: 'CAVAN', code: 'RAMP_CN_THORNTON', name: 'CN Thornton Yard Intermodal', carrier: 'CN', type: 'rail', lat: 49.19, lng: -122.83, notes: 'near-dock' },
  { portCode: 'CAVAN', code: 'RAMP_CPKC_VANCOUVER', name: 'CPKC Vancouver Intermodal (Pitt Meadows)', carrier: 'CPKC', type: 'rail', lat: 49.22, lng: -122.7, notes: 'near-dock' },
  // Calgary — rail ramps → INLCGY
  { portCode: 'INLCGY', code: 'RAMP_CN_CALGARY', name: 'CN Calgary Logistics Park', carrier: 'CN', type: 'rail', lat: 51.15, lng: -113.85, notes: 'inland' },
  { portCode: 'INLCGY', code: 'RAMP_CPKC_CALGARY', name: 'CPKC Calgary Intermodal (Shepard)', carrier: 'CPKC', type: 'rail', lat: 50.98, lng: -113.92, notes: 'inland' },
  // Edmonton — rail ramps → INLEDM
  { portCode: 'INLEDM', code: 'RAMP_CN_EDMONTON', name: 'CN Edmonton (Walker Yard) Intermodal', carrier: 'CN', type: 'rail', lat: 53.5, lng: -113.35, notes: 'inland' },
  // Winnipeg — rail ramps → INLWPG
  { portCode: 'INLWPG', code: 'RAMP_CN_WINNIPEG', name: 'CN Winnipeg (Symington) Intermodal', carrier: 'CN', type: 'rail', lat: 49.85, lng: -97.05, notes: 'inland' },
  { portCode: 'INLWPG', code: 'RAMP_CPKC_WINNIPEG', name: 'CPKC Winnipeg Intermodal', carrier: 'CPKC', type: 'rail', lat: 49.89, lng: -97.2, notes: 'inland' },
  // Prince Rupert — rail ramps → CAPRR
  { portCode: 'CAPRR', code: 'RAMP_CN_PRINCERUPERT', name: 'CN Fairview On-Dock Rail (Prince Rupert)', carrier: 'CN', type: 'rail', lat: 54.3175, lng: -130.3019, notes: 'on-dock' },
  // Halifax — rail ramps → CAHAL
  { portCode: 'CAHAL', code: 'RAMP_CN_HALIFAX', name: 'CN Halifax On-Dock Rail', carrier: 'CN', type: 'rail', lat: 44.6303, lng: -63.5586, notes: 'on-dock' },
];

/** Look up all terminals at a given port. */
export function terminalsForPort(portCode: string): TerminalRow[] {
  return TERMINALS_DATA.filter((t) => t.portCode === portCode);
}
