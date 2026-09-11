/**
 * WE MUST NOT ASSERT, IN MACHINE-READABLE FORM, A BUSINESS FACT THE SOURCE DATA
 * DOES NOT SUPPORT — ABOUT ~330,000 COMPANIES WE DO NOT OWN.
 *
 * ─── THE CLAIM THIS FILE RETIRED ──────────────────────────────────────────
 * Every carrier profile's JSON-LD used to carry:
 *
 *     "areaServed": "SAVANNAH, GA"
 *
 * i.e. "this carrier's service area is the one city it is headquartered in".
 * That is false for a motor carrier. An active FMCSA common/contract authority
 * is INTERSTATE operating authority — a Savannah-domiciled carrier lawfully
 * runs nationwide — and FMCSA's address field says where the company sits, not
 * where it hauls. Shipped across ~330k pages, it is a factual misstatement
 * about third parties, published by us.
 *
 * ─── AND THE ONE THIS FILE REFUSES TO LET REPLACE IT ──────────────────────
 * The fix is NOT a broader claim. `areaServed: "United States"` would be the
 * same error with a bigger blast radius: L&I says a carrier HOLDS authority, it
 * does not say the carrier serves the country. So these tests assert the
 * absence of an `areaServed` key at all — any value — and assert that what
 * replaced it is a literal restatement of the FMCSA field (the common/contract
 * authority status), omitted entirely when FMCSA has nothing on file.
 *
 * Pure HTML render, no DB / no network.
 */
import { describe, it, expect } from 'vitest';
import { renderCarrierProfile } from './pages.js';
import type { VisibleCarrier } from './queries.js';

function carrier(overrides: Partial<VisibleCarrier> = {}): VisibleCarrier {
  return {
    slug: 'acme-drayage-inc-107080',
    legalName: 'ACME DRAYAGE INC',
    dbaName: null,
    usdot: '107080',
    mcNumber: 'MC012892',
    city: 'SAVANNAH',
    state: 'GA',
    zip: '31401',
    phone: '9125550921',
    email: 'dispatch@acme.com',
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
    nearestPortCode: 'USSAV',
    aboutOverride: null,
    capabilities: {},
    provenance: { about: 'fmcsa', email: 'fmcsa', phone: 'fmcsa', hidden: 'fmcsa', capabilities: 'fmcsa' },
    ...overrides,
  } as VisibleCarrier;
}

/** Every `<script type="application/ld+json">` block on the page, parsed. */
function jsonLdBlocks(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    out.push(JSON.parse(m[1]) as Record<string, unknown>);
  }
  return out;
}

/** The LocalBusiness/Organization block — the one that describes the CARRIER. */
function carrierLd(html: string): Record<string, unknown> {
  const block = jsonLdBlocks(html).find((b) => {
    const t = b['@type'];
    return Array.isArray(t) ? t.includes('LocalBusiness') : t === 'LocalBusiness';
  });
  expect(block, 'carrier LocalBusiness JSON-LD must be present').toBeTruthy();
  return block!;
}

describe('carrier JSON-LD asserts no unsupported service area', () => {
  it('emits no areaServed key at all — not the HQ city, not a broader guess', () => {
    const ld = carrierLd(renderCarrierProfile({ carrier: carrier() }));
    expect(Object.keys(ld)).not.toContain('areaServed');
  });

  it('does not smuggle the claim back in under any casing, on any block', () => {
    // Scoped to the raw JSON-LD, not the whole page: prose elsewhere may
    // legitimately discuss service areas in hedged, human language.
    const html = renderCarrierProfile({ carrier: carrier() });
    for (const block of jsonLdBlocks(html)) {
      expect(JSON.stringify(block).toLowerCase()).not.toContain('areaserved');
    }
  });

  it('still publishes the HQ as an ADDRESS — a location fact FMCSA does publish', () => {
    // Removing the false claim must not throw away the true one beside it.
    const ld = carrierLd(renderCarrierProfile({ carrier: carrier() }));
    const addr = ld.address as Record<string, unknown>;
    expect(addr.addressLocality).toBe('SAVANNAH');
    expect(addr.addressRegion).toBe('GA');
    expect(addr['@type']).toBe('PostalAddress');
  });

  it('restates the FMCSA operating authority verbatim in its place', () => {
    const ld = carrierLd(renderCarrierProfile({ carrier: carrier({ authorityType: 'common,contract' }) }));
    const props = ld.additionalProperty as Array<Record<string, unknown>>;
    expect(props).toHaveLength(1);
    expect(props[0].name).toBe('FMCSA operating authority');
    expect(props[0].value).toBe('Common + Contract authority');
  });

  it('omits the authority property entirely when FMCSA has none on file', () => {
    // The rule is "assert only what the source supports" — an absent field is
    // omitted, never filled with a default or a guess.
    const ld = carrierLd(renderCarrierProfile({ carrier: carrier({ authorityType: null }) }));
    expect(Object.keys(ld)).not.toContain('additionalProperty');
  });

  it('keeps the identifiers that ARE verbatim FMCSA facts', () => {
    const ld = carrierLd(renderCarrierProfile({ carrier: carrier() }));
    const ids = ld.identifier as Array<Record<string, unknown>>;
    expect(ids.map((i) => i.propertyID)).toEqual(['USDOT', 'MC']);
  });
});
