/**
 * Hub KIND labels — an inland rail ramp is an "intermodal hub", not a "port".
 *
 * The directory's 61 hubs share ONE URL space (/directory/port/:code — kept
 * verbatim, it is sitemapped + canonical) but are two physical things: 27
 * seaports with marine terminals, and 34 inland rail-intermodal metros
 * (Minneapolis, Denver, Kansas City, Chicago, …) with no berth at all. Before
 * `kind` existed every page called Minneapolis a "port", its "nearest US
 * container gateway", and the FAQ (emitted as FAQPage JSON-LD) claimed drayage
 * runs "between Minneapolis/St. Paul Intermodal's marine terminals" for "ocean
 * containers". These tests pin the kind-aware wording on every surface that
 * names a hub, and that the seaport wording is untouched. Pure renders, no DB.
 */
import { describe, it, expect } from 'vitest';
import {
  ALL_HUBS,
  CONTAINER_PORTS,
  CA_CONTAINER_PORTS,
  PORT_GROUPS,
  portByCode,
  portGroupByCode,
  portGroupAsPort,
  hubNoun,
  hubGatewayLabel,
} from './containerPorts.js';
import { renderPortPage, renderDirectoryLanding, renderCarrierProfile, carrierAbout } from './pages.js';
import {
  normalizeFilters,
  FLEET_BUCKETS,
  DRIVERS_BUCKETS,
  EQUIPMENT_OPTIONS,
  CARGO_OPTIONS,
  type VisibleCarrier,
} from './queries.js';

const zeros = (ids: readonly string[]) => Object.fromEntries(ids.map((i) => [i, 0]));
const counts = {
  fleet: zeros(FLEET_BUCKETS.map((b) => b.id)),
  drivers: zeros(DRIVERS_BUCKETS.map((b) => b.id)),
  equipment: zeros(EQUIPMENT_OPTIONS.map((e) => e.id)),
  cargo: zeros(CARGO_OPTIONS.map((c) => c.id)),
  goodStanding: 0,
  ports: Object.fromEntries(PORT_GROUPS.map((g) => [g.code, 0])),
  authorityActive: 0,
  intermodal: 0,
  recent: 0,
} as never;

function hubPage(code: string): string {
  const group = portGroupByCode(code);
  const port = group ? portGroupAsPort(group) : portByCode(code);
  if (!port) throw new Error(`unknown hub ${code}`);
  const filters = normalizeFilters({ port: port.code });
  return renderPortPage({
    port,
    list: { carriers: [], total: 120, page: 1, perPage: 24, totalPages: 5, filters } as never,
    counts,
    filters,
  });
}

function carrier(overrides: Partial<VisibleCarrier> = {}): VisibleCarrier {
  return {
    slug: 'north-star-drayage-107080',
    legalName: 'NORTH STAR DRAYAGE INC',
    dbaName: null,
    usdot: '107080',
    mcNumber: 'MC012892',
    city: 'ST. PAUL',
    state: 'MN',
    zip: '55101',
    phone: '6515550921',
    email: 'dispatch@example.com',
    contactHidden: false,
    powerUnits: 25,
    drivers: 30,
    safetyRating: 'S',
    authorityType: 'common',
    intermodal: true,
    hazmat: false,
    dryVan: false,
    reefer: false,
    tanker: false,
    flatbed: false,
    dryBulk: false,
    householdGoods: false,
    beverages: false,
    produce: false,
    motorVehicles: false,
    livestock: false,
    grainFeed: false,
    oilfield: false,
    meat: false,
    paper: false,
    construction: false,
    farmSupplies: false,
    coalCoke: false,
    buildingMaterials: false,
    nearestPortCode: 'INLMSP',
    aboutOverride: null,
    capabilities: {},
    provenance: { about: 'fmcsa', email: 'fmcsa', phone: 'fmcsa', hidden: 'fmcsa', capabilities: 'fmcsa' },
    ...overrides,
  } as VisibleCarrier;
}

describe('hub kind taxonomy', () => {
  it('USCHI and every INL* code is an inland hub; the seaport gateways are seaports', () => {
    const byCode = new Map(ALL_HUBS.map((h) => [h.code, h]));
    expect(byCode.get('USCHI')?.kind).toBe('inland-hub');
    const inland = ALL_HUBS.filter((h) => h.code.startsWith('INL'));
    expect(inland.length).toBeGreaterThan(0);
    for (const h of inland) expect(h.kind, h.code).toBe('inland-hub');
    expect(byCode.get('USLAX')?.kind).toBe('seaport');
    expect(byCode.get('CAVAN')?.kind).toBe('seaport');
    expect(byCode.get('INLMSP')?.kind).toBe('inland-hub');
  });

  it('every hub carries a kind, and the legacy seaport lists are seaports except Chicago', () => {
    for (const h of ALL_HUBS) expect(['seaport', 'inland-hub'], h.code).toContain(h.kind);
    for (const p of [...CONTAINER_PORTS, ...CA_CONTAINER_PORTS]) {
      expect(p.kind, p.code).toBe(p.code === 'USCHI' ? 'inland-hub' : 'seaport');
    }
  });

  it('kind propagates onto display groups and portGroupAsPort', () => {
    expect(portGroupByCode('USLALB')?.kind).toBe('seaport');
    expect(portGroupByCode('INLMSP')?.kind).toBe('inland-hub');
    expect(portGroupByCode('USCHI')?.kind).toBe('inland-hub');
    expect(portGroupAsPort(portGroupByCode('INLDEN')!).kind).toBe('inland-hub');
    expect(portGroupAsPort(portGroupByCode('USLALB')!).kind).toBe('seaport');
  });

  it('hubNoun / hubGatewayLabel read an absent kind as the historic seaport default', () => {
    expect(hubNoun('inland-hub')).toBe('intermodal hub');
    expect(hubNoun('seaport')).toBe('port');
    expect(hubNoun(undefined)).toBe('port');
    expect(hubGatewayLabel('inland-hub', 'US')).toBe('inland rail ramp');
    expect(hubGatewayLabel('seaport', 'US')).toBe('US container gateway');
    expect(hubGatewayLabel('seaport', 'CA')).toBe('Canadian container gateway');
    expect(hubGatewayLabel(undefined, undefined)).toBe('US container gateway');
  });
});

describe('inland hub page (INLMSP) — no seaport vocabulary', () => {
  const html = hubPage('INLMSP');

  it('never calls the rail ramp a port / gateway or talks about marine terminals', () => {
    expect(html).not.toContain('marine terminals');
    expect(html).not.toContain('ocean containers');
    expect(html).not.toContain('container gateway');
    expect(html).not.toContain('nearest port');
  });

  it('says what it is: an intermodal hub, in the intro, <title> and FAQ', () => {
    expect(html).toContain('whose nearest intermodal hub is Minneapolis/St. Paul Intermodal');
    // The hub's own name already says "Intermodal", so the title does not
    // append "Intermodal Hub" again (it read "… Intermodal Intermodal Hub …").
    expect(html).toContain('<title>Minneapolis/St. Paul Intermodal Drayage &amp; Trucking Carriers — 120 Near St. Paul | QuoteFleet</title>');
    expect(html).not.toContain('Intermodal Intermodal');
    expect(html).toContain('rail ramps and intermodal terminals');
    expect(html).toContain('intermodal containers');
  });

  it('keeps the canonical /directory/port/INLMSP URL (no URL change)', () => {
    expect(html).toContain('<link rel="canonical" href="https://quotefleet.net/directory/port/INLMSP">');
  });

  it('labels the sibling-hub chips as ports & intermodal hubs', () => {
    expect(html).toContain('Other US ports &amp; intermodal hubs');
    expect(html).not.toContain('>Other US ports<');
  });

  it('emits the kind-aware FAQ into the FAQPage JSON-LD too', () => {
    const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) ?? [];
    const faq = ld.find((s) => s.includes('"FAQPage"'));
    expect(faq).toBeTruthy();
    expect(faq).not.toContain('marine terminals');
    expect(faq).toContain('intermodal containers');
    // Still valid JSON.
    const body = faq!.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
    expect(() => JSON.parse(body)).not.toThrow();
  });
});

describe('seaport page — wording untouched', () => {
  it('USLAX still reads as a Port of / US container gateway with marine terminals', () => {
    const html = hubPage('USLAX');
    expect(html).toContain('Port of Los Angeles');
    expect(html).toContain('whose nearest US container gateway is Port of Los Angeles');
    expect(html).toContain("Port of Los Angeles's marine terminals");
    expect(html).toContain('ocean containers');
    expect(html).toContain('<title>Port of Los Angeles Drayage &amp; Trucking Carriers — 120 Near Los Angeles | QuoteFleet</title>');
    expect(html).not.toContain('Intermodal Hub Drayage');
  });

  it('the merged LA / Long Beach display hub is a seaport too', () => {
    const html = hubPage('USLALB');
    expect(html).toContain('whose nearest US container gateway is Los Angeles / Long Beach');
  });

  it('a Canadian seaport is a Canadian container gateway, not a US one', () => {
    const html = hubPage('CAVAN');
    expect(html).toContain('whose nearest Canadian container gateway is Port of Vancouver');
  });
});

describe('landing page — ports & hubs', () => {
  it('headlines the hub grid as ports & hubs and browses by port, intermodal hub and state', () => {
    const html = renderDirectoryLanding({
      total: 1000,
      intermodalTotal: 100,
      states: 2,
      byState: [{ state: 'MN', count: 500 }, { state: 'CA', count: 500 }],
      byPort: [
        { code: 'INLMSP', name: 'Minneapolis/St. Paul Intermodal', city: 'St. Paul', state: 'MN', count: 500 },
        { code: 'USLALB', name: 'Los Angeles / Long Beach', city: 'Los Angeles', state: 'CA', count: 500 },
      ],
    });
    expect(html).toContain('<h2>Top US ports &amp; hubs</h2>');
    expect(html).not.toContain('<h2>Top US ports</h2>');
    expect(html).toContain('by port, intermodal hub and state');
    expect(html).not.toContain('by port and by state');
  });
});

describe('carrier profile + about — nearest hub vs nearest port', () => {
  it('an inland-hub carrier gets "Nearest hub" and "nearest intermodal hub", never "nearest port"', () => {
    const html = renderCarrierProfile({ carrier: carrier() });
    expect(html).toContain('<span class="lk">Nearest hub</span> Minneapolis/St. Paul Intermodal');
    expect(html).toContain('nearest intermodal hub Minneapolis/St. Paul Intermodal');
    expect(html).not.toContain('Nearest port');
    expect(html).not.toContain('nearest port');
    expect(html).toContain('at US ports and rail ramps');
    expect(html).not.toContain('at US container ports');
  });

  it('a seaport carrier keeps "Nearest port"', () => {
    const html = renderCarrierProfile({ carrier: carrier({ city: 'SAVANNAH', state: 'GA', nearestPortCode: 'USSAV' }) });
    expect(html).toContain('<span class="lk">Nearest port</span> Port of Savannah');
    expect(html).toContain('nearest port Port of Savannah');
    expect(html).not.toContain('Nearest hub');
  });

  it('carrierAbout names intermodal hubs for an inland carrier and container ports for a seaport one', () => {
    expect(carrierAbout(carrier())).toContain('US intermodal hubs such as Minneapolis/St. Paul Intermodal');
    expect(carrierAbout(carrier())).not.toContain('container ports');
    const sea = carrierAbout(carrier({ city: 'SAVANNAH', state: 'GA', nearestPortCode: 'USSAV' }));
    expect(sea).toContain('US container ports such as Port of Savannah');
  });
});
