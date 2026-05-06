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
];

/** Look up all terminals at a given port. */
export function terminalsForPort(portCode: string): TerminalRow[] {
  return TERMINALS_DATA.filter((t) => t.portCode === portCode);
}
