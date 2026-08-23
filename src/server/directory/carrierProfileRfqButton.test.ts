/**
 * Carrier-profile "Request a rate" button (shipper conversion — audit finding H2).
 *
 * A shipper landing on a single carrier's profile (common from SEO/search) needs a
 * direct way to request a rate from THAT carrier — the multi-select results action
 * bar is the only other RFQ entry point. The profile header now carries a PRIMARY
 * "Request a rate" button that starts the same /directory/rfq flow pre-seeded with
 * the profile carrier's USDOT (a single ?dots=<usdot> resolves to a one-recipient
 * RFQ). These tests pin:
 *   - the button renders as a primary action linking to /directory/rfq?dots=<usdot>;
 *   - it sits inside the header action group alongside the Save control;
 *   - no broken link is emitted when the carrier has no USDOT.
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

describe('renderCarrierProfile — "Request a rate" primary CTA', () => {
  it('renders a primary RFQ button linking to /directory/rfq?dots=<usdot>', () => {
    const html = renderCarrierProfile({ carrier: carrier() });
    expect(html).toContain('href="/directory/rfq?dots=107080"');
    expect(html).toContain('class="btn btn-primary btn-sm cp-rfq-btn"');
    expect(html).toContain('>Request a rate <span class="arr">→</span></a>');
  });

  it('places the RFQ button in the header action group alongside the Save control', () => {
    const html = renderCarrierProfile({ carrier: carrier() });
    const ctaIdx = html.indexOf('<div class="cp-headcta">');
    expect(ctaIdx).toBeGreaterThan(-1);
    // Both controls live inside the action group; RFQ (primary) precedes Save.
    // Match RENDERED markup (the bare `cp-rfq-btn` token also appears in the
    // embedded <style>, so anchor on the full rendered element strings).
    const rfqIdx = html.indexOf('<a class="btn btn-primary btn-sm cp-rfq-btn"');
    const saveIdx = html.indexOf('<div class="qf-save"');
    expect(rfqIdx).toBeGreaterThan(ctaIdx);
    expect(saveIdx).toBeGreaterThan(rfqIdx);
  });

  it('does not render a broken link when the carrier has no USDOT', () => {
    const html = renderCarrierProfile({ carrier: carrier({ usdot: '' as unknown as string }) });
    // The rendered anchor + its href are absent (the `.cp-rfq-btn` CSS token in
    // the embedded <style> is expected and is not the rendered button).
    expect(html).not.toContain('<a class="btn btn-primary btn-sm cp-rfq-btn"');
    expect(html).not.toContain('/directory/rfq?dots=');
    // The Save control still renders — the header action group is unbroken.
    expect(html).toContain('<div class="qf-save"');
  });
});
