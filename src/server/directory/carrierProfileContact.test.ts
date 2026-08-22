/**
 * Carrier-profile CONTACT rendering — phone + email display and the carrier
 * opt-out. Pure HTML render (renderCarrierProfile), no DB / no network.
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
  };
}

describe('renderCarrierProfile — contact display', () => {
  it('shows phone as a tel: link and email as a mailto: link when present + visible', () => {
    const html = renderCarrierProfile({ carrier: carrier() });
    expect(html).toContain('href="tel:9125550921"');
    expect(html).toContain('>9125550921<');
    expect(html).toContain('href="mailto:dispatch%40acme.com"'); // @ encoded
    expect(html).toContain('>dispatch@acme.com<');
    expect(html).not.toContain("hidden at the carrier's request");
  });

  it('omits the email row (no empty "Email —") when email is null', () => {
    const html = renderCarrierProfile({ carrier: carrier({ email: null }) });
    expect(html).toContain('href="tel:9125550921"'); // phone still shown
    expect(html).not.toContain('mailto:');
    expect(html).not.toContain('>Email<');
  });

  it('omits the phone row when phone is null', () => {
    const html = renderCarrierProfile({ carrier: carrier({ phone: null }) });
    expect(html).not.toContain('href="tel:');
    expect(html).not.toContain('>Phone<');
    expect(html).toContain('mailto:dispatch%40acme.com'); // email still shown
  });

  it('hides BOTH phone and email and shows a muted opt-out line when contactHidden', () => {
    const html = renderCarrierProfile({ carrier: carrier({ contactHidden: true }) });
    expect(html).not.toContain('href="tel:');
    expect(html).not.toContain('mailto:');
    expect(html).not.toContain('dispatch@acme.com');
    expect(html).not.toContain('9125550921'); // not leaked in JSON-LD either
    expect(html).toContain("Contact details hidden at the carrier's request.");
    // The rest of the profile still renders.
    expect(html).toContain('ACME DRAYAGE INC');
    expect(html).toContain('USDOT');
  });

  it('carries a compliance opt-out note + support email in the claim section', () => {
    const html = renderCarrierProfile({ carrier: carrier() });
    expect(html).toContain('sourced from public FMCSA records');
    expect(html).toContain('support@quotefleet.net');
  });

  it('renders the "Also operating in" block with a chip per declared city when present', () => {
    const html = renderCarrierProfile({
      carrier: carrier({
        operatingLocations: [
          { city: 'ATLANTA', state: 'GA' },
          { city: 'jacksonville', state: 'FL' },
        ],
      }),
    });
    expect(html).toContain('cp-alsoloc-row'); // the render-only block wrapper
    expect(html).toContain('>Also operating in<'); // the label element (not just the CSS comment)
    // City title-cased, state upper 2-letter; each in its own chip.
    expect(html).toContain('>Atlanta, GA<');
    expect(html).toContain('>Jacksonville, FL<');
  });

  it('omits the "Also operating in" block entirely when there are no declared locations', () => {
    // Assert on the render-only class (the phrase also appears in a CSS comment).
    expect(renderCarrierProfile({ carrier: carrier() })).not.toContain('cp-alsoloc-row');
    expect(renderCarrierProfile({ carrier: carrier({ operatingLocations: [] }) })).not.toContain('cp-alsoloc-row');
  });

  it('escapes declared city values (no raw HTML injection)', () => {
    const html = renderCarrierProfile({
      carrier: carrier({ operatingLocations: [{ city: '<b>x</b>', state: 'GA' }] }),
    });
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('&lt;'); // angle brackets HTML-escaped
  });
});

describe('renderCarrierProfile — Directory Pro contacts gate', () => {
  it('free / anonymous: renders the teaser + "Unlock with Directory Pro — $19/mo" CTA + disabled reveal', () => {
    const html = renderCarrierProfile({ carrier: carrier() }); // isPro defaults to false
    expect(html).toContain('<div class="cp-gated">');
    expect(html).toContain('Unlock with Directory Pro — $19/mo');
    expect(html).toContain('href="/signup?plan=directory-pro"');
    // A disabled "Reveal contacts" affordance (the real reveal is Pro-only, PR C).
    expect(html).toContain('Reveal contacts');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Reveal contacts<\/button>/);
    // NOT the live Pro reveal button/endpoint.
    expect(html).not.toContain('Reveal additional contacts');
    expect(html).not.toContain('/reveal"');
  });

  it('Pro: renders a live "Reveal additional contacts" button posting to the reveal endpoint, no upgrade CTA', () => {
    const html = renderCarrierProfile({ carrier: carrier(), isPro: true });
    expect(html).toContain('cp-gated--pro');
    expect(html).toContain('Reveal additional contacts');
    expect(html).toContain('action="/api/directory/carrier/107080/reveal"');
    // No upgrade wall for a paying subscriber.
    expect(html).not.toContain('Unlock with Directory Pro');
    expect(html).not.toContain('/signup?plan=directory-pro');
  });

  it('the gate NEVER hides the public FMCSA phone/email (free data stays free) in either state', () => {
    for (const isPro of [false, true]) {
      const html = renderCarrierProfile({ carrier: carrier(), isPro });
      expect(html).toContain('href="tel:9125550921"');
      expect(html).toContain('href="mailto:dispatch%40acme.com"');
    }
  });
});
