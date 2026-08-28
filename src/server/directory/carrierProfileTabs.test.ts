/**
 * Carrier-profile TAB STRUCTURE + newly-surfaced FMCSA data.
 *
 * The profile is split into four accessible, SEO-safe tabs (Overview · Services
 * & Equipment · Safety & Compliance · Contact & Location) rendered with a
 * pure-CSS native-radio mechanism — every panel is present in the HTML, CSS only
 * hides the inactive ones. These tests pin:
 *   - the tab scaffold (radios, labels, panels, default = Overview);
 *   - the 13 FMCSA cargo-class specialties now render (stored, never shown before);
 *   - ZIP now appears on the location line;
 *   - the "FMCSA data as of …" freshness line from `updatedAt`;
 *   - no NEW gating was introduced (the enriched "More dispatch contacts" panel
 *     is unchanged and nothing else is gated).
 * Pure HTML render (renderCarrierProfile), no DB / no network.
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

describe('renderCarrierProfile — four-tab scaffold', () => {
  it('renders a labelled radio-group tab container', () => {
    const html = renderCarrierProfile({ carrier: carrier() });
    expect(html).toContain('class="cp-tabs" role="group" aria-label="Carrier profile sections"');
  });

  it('renders all four keyboard-focusable radio inputs, Overview checked by default', () => {
    const html = renderCarrierProfile({ carrier: carrier() });
    for (const id of ['cp-tab-overview', 'cp-tab-services', 'cp-tab-safety', 'cp-tab-contact']) {
      expect(html).toContain(`id="${id}" class="cp-tab-input"`);
    }
    expect(html).toContain('id="cp-tab-overview" class="cp-tab-input" checked');
  });

  it('renders all four panels IN THE HTML (SEO-safe — CSS hides inactive, no lazy-load)', () => {
    const html = renderCarrierProfile({ carrier: carrier() });
    for (const p of ['cp-panel--overview', 'cp-panel--services', 'cp-panel--safety', 'cp-panel--contact']) {
      expect(html).toContain(`<div class="cp-panel ${p}">`);
    }
  });

  it('carries full desktop labels + short mobile labels for each tab', () => {
    const html = renderCarrierProfile({ carrier: carrier() });
    expect(html).toContain('<span class="cp-tab-lg">Services &amp; equipment</span>');
    expect(html).toContain('<span class="cp-tab-sm">Services</span>');
    expect(html).toContain('<span class="cp-tab-lg">Safety &amp; compliance</span>');
    expect(html).toContain('<span class="cp-tab-lg">Contact &amp; location</span>');
  });

  it('moves the live-verify widget into the Safety & Compliance panel (exactly once)', () => {
    const html = renderCarrierProfile({ carrier: carrier() });
    expect((html.match(/id="live-verify"/g) || []).length).toBe(1);
    const safetyIdx = html.indexOf('<div class="cp-panel cp-panel--safety">');
    const contactIdx = html.indexOf('<div class="cp-panel cp-panel--contact">');
    const verifyIdx = html.indexOf('id="live-verify"');
    expect(verifyIdx).toBeGreaterThan(safetyIdx);
    expect(verifyIdx).toBeLessThan(contactIdx);
  });
});

describe('renderCarrierProfile — 13 FMCSA cargo-class specialties (NEW render)', () => {
  const ALL_CARGO: Partial<VisibleCarrier> = {
    householdGoods: true, beverages: true, produce: true, motorVehicles: true, livestock: true,
    grainFeed: true, oilfield: true, meat: true, paper: true, construction: true,
    farmSupplies: true, coalCoke: true, buildingMaterials: true,
  };
  const LABELS = [
    'Household goods', 'Beverages', 'Produce', 'Motor vehicles', 'Livestock', 'Grain &amp; feed',
    'Oilfield', 'Meat', 'Paper products', 'Construction', 'Farm supplies', 'Coal / coke', 'Building materials',
  ];

  it('renders each cargo-class as a human-labelled chip when its flag is true', () => {
    const html = renderCarrierProfile({ carrier: carrier(ALL_CARGO) });
    expect(html).toContain('Cargo specialties');
    for (const lbl of LABELS) {
      expect(html).toContain(`class="cp-badge cp-badge--cargo">${lbl}</span>`);
    }
  });

  it('renders ONLY the cargo classes that are true', () => {
    const html = renderCarrierProfile({ carrier: carrier({ meat: true, produce: true }) });
    expect(html).toContain('>Meat</span>');
    expect(html).toContain('>Produce</span>');
    expect(html).not.toContain('>Household goods</span>');
    expect(html).not.toContain('>Building materials</span>');
  });

  it('omits the cargo group entirely when no cargo class is set', () => {
    const html = renderCarrierProfile({ carrier: carrier() });
    expect(html).not.toContain('Cargo specialties');
    // No cargo CHIP element (the `.cp-badge--cargo` token still appears once in
    // the embedded <style>, so target the rendered span, not the bare class).
    expect(html).not.toContain('<span class="cp-badge cp-badge--cargo">');
  });
});

describe('renderCarrierProfile — ZIP + FMCSA freshness (NEW render)', () => {
  it('appends the stored ZIP to the location line', () => {
    const html = renderCarrierProfile({ carrier: carrier() });
    expect(html).toContain('Based in SAVANNAH, GA 31401.');
  });

  it('falls back to City, State when no ZIP is stored', () => {
    const html = renderCarrierProfile({ carrier: carrier({ zip: null }) });
    expect(html).toContain('Based in SAVANNAH, GA.');
  });

  it('renders a "FMCSA data as of …" line from updatedAt (formatted, deterministic)', () => {
    const html = renderCarrierProfile({ carrier: carrier({ updatedAt: new Date('2026-08-21T12:00:00Z') }) });
    expect(html).toContain('FMCSA data as of Aug 21, 2026.');
  });

  it('omits the freshness line when updatedAt is absent (no fabricated date)', () => {
    const html = renderCarrierProfile({ carrier: carrier() });
    expect(html).not.toContain('FMCSA data as of');
  });
});

describe('renderCarrierProfile — NO new gating (public FMCSA data stays free)', () => {
  it('renders the additional-contacts gate (free teaser) without touching public FMCSA contact', () => {
    const html = renderCarrierProfile({ carrier: carrier() });
    expect(html).toContain('More dispatch contacts');
    expect(html).toContain('Unlock with Directory Pro — $19/mo');
    // Public FMCSA phone + email stay FREE + visible regardless of the gate.
    expect(html).toContain('href="tel:9125550921"');
    expect(html).toContain('href="mailto:dispatch%40acme.com"');
  });

  it('does not gate the cargo classes, ZIP, freshness line or credential/equipment strips', () => {
    const html = renderCarrierProfile({
      carrier: carrier({ meat: true, updatedAt: new Date('2026-08-21T12:00:00Z') }),
    });
    // The only gated block is the single "More dispatch contacts" affordance —
    // count the rendered DIV (the `.cp-gated` class token also appears in CSS,
    // and now in the client-side Pro hydrator too, so match the real element).
    expect((html.match(/<div class="cp-gated" data-cp-gated/g) || []).length).toBe(1);
    // Newly-surfaced data renders without any "registered users" / account wall.
    const meatIdx = html.indexOf('>Meat</span>');
    const asOfIdx = html.indexOf('FMCSA data as of');
    const gatedIdx = html.indexOf('<div class="cp-gated" data-cp-gated');
    expect(meatIdx).toBeGreaterThan(-1);
    expect(asOfIdx).toBeGreaterThan(-1);
    expect(meatIdx).not.toBe(gatedIdx);
  });
});
