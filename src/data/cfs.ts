/**
 * Container Freight Stations (CFS) + LCL consolidation terminals — US + Canada.
 *
 * A CFS is a (usually CBP-bonded) warehouse where LCL (Less-than-Container-Load)
 * cargo is consolidated for export or deconsolidated on import. This is the
 * third directory category alongside PORTS_DATA (ocean) and the rail ramps in
 * TERMINALS_DATA. Served read-only to the widget via
 * GET /api/public/autocomplete/cfs.
 *
 * Two shapes:
 *   - CFS_DATA         — specific verified facilities (STG network + independent
 *                        LA/LB bonded operators), addresses where published.
 *   - LCL_NETWORKS     — neutral NVOCC LCL consolidators, listed at the
 *                        metro/gateway level (they run proprietary CFS at each
 *                        gateway) rather than a single fabricated street address.
 *
 * Coords are approximate (facility / metro port-area), suitable for map pins and
 * drayage distance calc — verify before billing-critical use.
 */

export interface CfsRow {
  /** Stable id, form CFS_<CITY>_<OPERATOR>. */
  code: string;
  name: string;
  operator: string;
  city: string;
  state: string;
  country: 'US' | 'CA';
  lat: number;
  lng: number;
  /** 'CFS-bonded' | 'CFS' | 'LCL-consolidation'. */
  type: string;
  /** Nearest PORTS_DATA code this CFS serves; null for pure inland. */
  gatewayPort: string | null;
  /** CBP/CBSA-bonded facility. */
  bonded: boolean;
  address?: string;
  notes?: string;
}

export interface LclNetworkRow {
  code: string;
  name: string;
  operator: string;
  type: string;
  country: string;
  /** Metros where this NVOCC runs a CFS. */
  gateways: string[];
  notes?: string;
}

export const CFS_DATA: CfsRow[] = [
  { code: 'CFS_LAX_STG', name: 'STG Logistics — Los Angeles CFS', operator: 'STG Logistics', city: 'Compton', state: 'CA', country: 'US', lat: 33.876, lng: -118.24, type: 'CFS-bonded', gatewayPort: 'USLAX', bonded: true, address: '1650 S. Central Ave, Compton, CA 90220', notes: 'STG\'s flagship SoCal CFS.' },
  { code: 'CFS_LAX_STGCOI', name: 'STG Logistics / St. George — City of Industry CFS', operator: 'STG Logistics', city: 'City of Industry', state: 'CA', country: 'US', lat: 33.993, lng: -117.89, type: 'CFS-bonded', gatewayPort: 'USLAX', bonded: true, address: '18591 E San Jose Ave, City of Industry, CA 91748' },
  { code: 'CFS_LGB_PRICE', name: 'Price Transfer — Bonded CFS', operator: 'Price Transfer, Inc.', city: 'Long Beach', state: 'CA', country: 'US', lat: 33.833, lng: -118.19, type: 'CFS-bonded', gatewayPort: 'USLGB', bonded: true, address: '2711 E. Dominguez St, Long Beach, CA 90810' },
  { code: 'CFS_LGB_SBCFS', name: 'SBCFS Bonded CFS', operator: 'SBCFS', city: 'Long Beach', state: 'CA', country: 'US', lat: 33.8, lng: -118.21, type: 'CFS-bonded', gatewayPort: 'USLGB', bonded: true, address: '2131 Willow St, Long Beach, CA 90810' },
  { code: 'CFS_LAX_EMPIRE', name: 'Empire CFS', operator: 'Empire CFS', city: 'Rancho Dominguez', state: 'CA', country: 'US', lat: 33.86, lng: -118.22, type: 'CFS-bonded', gatewayPort: 'USLAX', bonded: true, notes: '180k sqft import + 130k sqft export bonded warehousing, ~7 mi from ports.' },
  { code: 'CFS_LAX_IMPERIAL', name: 'Imperial CFS', operator: 'Imperial CFS, Inc.', city: 'Carson', state: 'CA', country: 'US', lat: 33.83, lng: -118.25, type: 'CFS-bonded', gatewayPort: 'USLAX', bonded: true, notes: '300k sqft, 52 docks.' },
  { code: 'CFS_LAX_NOVA', name: 'Nova CFS', operator: 'Nova', city: 'Carson', state: 'CA', country: 'US', lat: 33.84, lng: -118.26, type: 'CFS-bonded', gatewayPort: 'USLAX', bonded: true, notes: '260k sqft; can handle 200 containers.' },
  { code: 'CFS_SFO_STG', name: 'STG Logistics — San Francisco/Oakland CFS', operator: 'STG Logistics', city: 'San Leandro', state: 'CA', country: 'US', lat: 37.722, lng: -122.19, type: 'CFS-bonded', gatewayPort: 'USOAK', bonded: true, address: '1500 Doolittle Drive, San Leandro, CA 94577' },
  { code: 'CFS_SEA_STG', name: 'Summit NW — STG Logistics Seattle CFS', operator: 'STG Logistics / Summit NW', city: 'Kent', state: 'WA', country: 'US', lat: 47.39, lng: -122.25, type: 'CFS-bonded', gatewayPort: 'USSEA', bonded: true, address: '21607 88th Ave South, Kent, WA 98031' },
  { code: 'CFS_POR_STG', name: 'ACT 2 — STG Logistics Portland CFS', operator: 'STG Logistics / ACT 2', city: 'Portland', state: 'OR', country: 'US', lat: 45.545, lng: -122.51, type: 'CFS-bonded', gatewayPort: 'USPDX', bonded: true, address: '5545 NE 148th Ave Ste B, Portland, OR 97230' },
  { code: 'CFS_NYK_STG', name: 'STG Logistics — North Bergen CFS', operator: 'STG Logistics', city: 'North Bergen', state: 'NJ', country: 'US', lat: 40.783, lng: -74.043, type: 'CFS-bonded', gatewayPort: 'USNYC', bonded: true, address: '6801 West Side Ave, North Bergen, NJ 07047' },
  { code: 'CFS_PHI_STG', name: 'Falcon Express — STG Philadelphia CFS', operator: 'STG Logistics / Falcon Express', city: 'Philadelphia', state: 'PA', country: 'US', lat: 40.01, lng: -75.09, type: 'CFS-bonded', gatewayPort: 'USPHL', bonded: true, address: '2250 Church Street, Philadelphia, PA 19124' },
  { code: 'CFS_BAL_STG', name: 'STG Logistics — Baltimore CFS', operator: 'STG Logistics (partner)', city: 'Baltimore', state: 'MD', country: 'US', lat: 39.28, lng: -76.53, type: 'CFS-bonded', gatewayPort: 'USBAL', bonded: true, address: '6201 Seaforth St, Baltimore, MD 21224' },
  { code: 'CFS_NFK_STG', name: 'STG Logistics — Norfolk CFS', operator: 'STG Logistics', city: 'Portsmouth', state: 'VA', country: 'US', lat: 36.83, lng: -76.33, type: 'CFS-bonded', gatewayPort: 'USNOR', bonded: true, address: '3600 Elm Ave, Portsmouth, VA 23704', notes: 'Opened Aug 2024.' },
  { code: 'CFS_BOS_STG', name: 'Boston Freight Terminal — STG CFS', operator: 'STG Logistics / Boston Freight Terminal', city: 'Stoughton', state: 'MA', country: 'US', lat: 42.12, lng: -71.1, type: 'CFS-bonded', gatewayPort: 'USBOS', bonded: true, address: '139 Shuman Ave, Stoughton, MA 02072' },
  { code: 'CFS_CHS_STG', name: 'STG Logistics — Charleston CFS', operator: 'STG Logistics', city: 'Charleston', state: 'SC', country: 'US', lat: 32.92, lng: -79.96, type: 'CFS-bonded', gatewayPort: 'USCHS', bonded: true, address: '1980A Technology Drive, Charleston, SC 29492' },
  { code: 'CFS_SAV_STG', name: 'STG Logistics — Savannah CFS', operator: 'STG Logistics', city: 'Savannah', state: 'GA', country: 'US', lat: 32.16, lng: -81.19, type: 'CFS-bonded', gatewayPort: 'USSAV', bonded: true, address: '155 Knowlton Way, Suite 300, Savannah, GA 31407' },
  { code: 'CFS_CRL_STG', name: 'STG Logistics — Charlotte CFS', operator: 'STG Logistics', city: 'Charlotte', state: 'NC', country: 'US', lat: 35.247, lng: -80.82, type: 'CFS-bonded', gatewayPort: null, bonded: true, address: '3408 North Graham St, Charlotte, NC 28206', notes: 'Inland CFS; opened Oct 2024.' },
  { code: 'CFS_ATL_STG', name: 'STG Logistics — Atlanta CFS', operator: 'STG Logistics', city: 'Forest Park', state: 'GA', country: 'US', lat: 33.62, lng: -84.369, type: 'CFS-bonded', gatewayPort: null, bonded: true, notes: 'Inland CFS serving Atlanta / NS Inman + CSX Hulsey ramps.' },
  { code: 'CFS_FLD_STG', name: 'IWS (an STG Logistics Company) — Fort Lauderdale CFS', operator: 'STG Logistics / IWS', city: 'Fort Lauderdale', state: 'FL', country: 'US', lat: 26.09, lng: -80.13, type: 'CFS-bonded', gatewayPort: 'USPEF', bonded: true, address: '3413 McIntosh Rd, Fort Lauderdale, FL 33316', notes: 'Serves PortMiami + Port Everglades.' },
  { code: 'CFS_JAX_STG', name: 'Coastal International Logistics — STG Jacksonville CFS', operator: 'STG Logistics / Coastal International', city: 'Jacksonville', state: 'FL', country: 'US', lat: 30.32, lng: -81.76, type: 'CFS-bonded', gatewayPort: 'USJAX', bonded: true, address: '2730 Pickettville Rd Ste 101, Jacksonville, FL 32220' },
  { code: 'CFS_NOL_STG', name: 'Southwest Freight — STG New Orleans CFS', operator: 'STG Logistics / Southwest Freight', city: 'New Orleans', state: 'LA', country: 'US', lat: 30.01, lng: -89.96, type: 'CFS-bonded', gatewayPort: 'USNOL', bonded: true, address: '12301 Old Gentilly Road, New Orleans, LA 70129' },
  { code: 'CFS_MOB_STG', name: 'Montgomery Air Freight — STG Mobile CFS', operator: 'STG Logistics / Montgomery Air Freight', city: 'Mobile', state: 'AL', country: 'US', lat: 30.64, lng: -88.06, type: 'CFS-bonded', gatewayPort: 'USMOB', bonded: true, address: '2215 Ave O, Mobile, AL 36615' },
  { code: 'CFS_HOU_STG', name: 'STG Logistics — Houston CFS', operator: 'STG Logistics', city: 'Pasadena', state: 'TX', country: 'US', lat: 29.61, lng: -95.06, type: 'CFS-bonded', gatewayPort: 'USHOU', bonded: true, address: '4035 Underwood, Pasadena, TX 77507' },
  { code: 'CFS_DAL_STG', name: 'STG Logistics — Dallas CFS', operator: 'STG Logistics', city: 'Arlington', state: 'TX', country: 'US', lat: 32.756, lng: -97.068, type: 'CFS-bonded', gatewayPort: null, bonded: true, address: '3701 East Randol Mill Rd, Arlington, TX 76011', notes: 'Inland CFS serving DFW intermodal.' },
  { code: 'CFS_BEN_STG', name: 'Channel Distribution / STG Logistics — Chicago CFS', operator: 'STG Logistics / Channel Distribution', city: 'Bensenville', state: 'IL', country: 'US', lat: 41.955, lng: -87.94, type: 'CFS-bonded', gatewayPort: null, bonded: true, address: '1531 Red Hollow Road, Bensenville, IL 60106', notes: 'Inland CFS serving Chicago intermodal ramps.' },
  { code: 'CFS_CLE_STG', name: 'STG Logistics — Cleveland CFS', operator: 'STG Logistics', city: 'Willoughby', state: 'OH', country: 'US', lat: 41.64, lng: -81.406, type: 'CFS-bonded', gatewayPort: null, bonded: true, notes: 'Inland CFS.' },
  { code: 'CFS_COL_STG', name: 'STG Logistics — Columbus CFS', operator: 'STG Logistics', city: 'Grove City', state: 'OH', country: 'US', lat: 39.88, lng: -83.09, type: 'CFS-bonded', gatewayPort: null, bonded: true, address: '1819 Feddern Ave, Grove City, OH 43123', notes: 'Inland CFS serving Rickenbacker intermodal.' },
  { code: 'CFS_KAS_STG', name: 'Spin Freight — STG Kansas City CFS', operator: 'STG Logistics / Spin Freight', city: 'Kansas City', state: 'MO', country: 'US', lat: 39.14, lng: -94.57, type: 'CFS-bonded', gatewayPort: null, bonded: true, address: '1225 Erie St, Kansas City, MO 64116', notes: 'Inland CFS.' },
  { code: 'CFS_MEM_STG', name: 'Accelerated Inc — STG Memphis CFS', operator: 'STG Logistics / Accelerated', city: 'Memphis', state: 'TN', country: 'US', lat: 35.06, lng: -89.97, type: 'CFS-bonded', gatewayPort: null, bonded: true, address: '5280 Meltech Blvd, Memphis, TN 38118', notes: 'Inland CFS serving Memphis intermodal.' },
  { code: 'CFS_MIN_STG', name: 'Koch Logistics — STG Minneapolis CFS', operator: 'STG Logistics / Koch Logistics', city: 'St. Paul', state: 'MN', country: 'US', lat: 44.97, lng: -93.19, type: 'CFS-bonded', gatewayPort: null, bonded: true, address: '2230 Energy Park Drive, St. Paul, MN 55108' },
  { code: 'CFS_MON_STG', name: 'Airtime — STG Montreal CFS', operator: 'STG Logistics / Airtime', city: 'Dorval', state: 'QC', country: 'CA', lat: 45.46, lng: -73.72, type: 'CFS-bonded', gatewayPort: 'CAMTR', bonded: true, address: '10765 Cote de Liesse, Dorval, QC H9P 1H2', notes: 'Canada CFS near Montreal / YUL.' },
];

export const LCL_NETWORKS: LclNetworkRow[] = [
  { code: 'LCL_VANGUARD', name: 'Vanguard Logistics Services', operator: 'Vanguard Logistics', type: 'LCL-consolidation', country: 'US/CA', gateways: ['Los Angeles/Long Beach', 'New York/New Jersey', 'Chicago', 'Houston', 'Savannah', 'Miami', 'Seattle', 'Oakland', 'Toronto', 'Vancouver', 'Montreal'], notes: 'Largest owned/directly-operated CFS network of any NVOCC; 2M+ sqft globally. Neutral (wholesale) LCL consolidator with bonded CFS at each US/CA gateway.' },
  { code: 'LCL_ECU', name: 'ECU Worldwide', operator: 'ECU Worldwide (Allcargo)', type: 'LCL-consolidation', country: 'US/CA', gateways: ['Miami', 'Los Angeles/Long Beach', 'New York/New Jersey', 'Houston', 'Chicago', 'Savannah', 'Seattle', 'Toronto', 'Vancouver', 'Montreal'], notes: 'US HQ Miami. One of the largest global LCL consolidators; proprietary CFS at 15+ regional US/CA ports.' },
  { code: 'LCL_SHIPCO', name: 'Shipco Transport', operator: 'Shipco Transport', type: 'LCL-consolidation', country: 'US/CA', gateways: ['New York/New Jersey', 'Los Angeles/Long Beach', 'Chicago', 'Houston', 'Miami', 'Savannah', 'Seattle', 'Norfolk', 'Boston', 'Toronto', 'Vancouver', 'Montreal'], notes: 'US HQ Fairfield, NJ. Neutral NVOCC LCL consolidator with weekly direct CFS-to-CFS services.' },
  { code: 'LCL_CAROTRANS', name: 'CaroTrans International', operator: 'CaroTrans', type: 'LCL-consolidation', country: 'US/CA', gateways: ['New York/New Jersey', 'Los Angeles/Long Beach', 'Chicago', 'Houston', 'Miami', 'Savannah', 'Charleston', 'Seattle', 'Norfolk', 'Baltimore', 'Toronto', 'Vancouver', 'Montreal'], notes: 'Neutral NVOCC LCL consolidator; publishes a nationwide USA CFS network list.' },
  { code: 'LCL_RHENUS', name: 'Rhenus Logistics (LCL)', operator: 'Rhenus', type: 'LCL-consolidation', country: 'US/CA', gateways: ['New York/New Jersey', 'Los Angeles/Long Beach', 'Chicago', 'Houston', 'Miami', 'Savannah'], notes: 'Global LCL consolidator with proprietary CFS at major US gateways.' },
];

/** Look up a CFS by its stable code. */
export function findCfs(code: string): CfsRow | undefined {
  return CFS_DATA.find((c) => c.code.toUpperCase() === code.toUpperCase());
}

/** All CFS facilities that serve a given gateway port code. */
export function cfsForGateway(portCode: string): CfsRow[] {
  return CFS_DATA.filter((c) => c.gatewayPort === portCode);
}
