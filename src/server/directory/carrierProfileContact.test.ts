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

/**
 * The Pro contacts gate used to be a SERVER-SIDE `isPro ? pro : free` branch.
 * It is now always rendered free + hydrated client-side, so the ~334k profile
 * URLs are byte-identical for every visitor and can be cached by a shared cache
 * (see directory/httpCache.ts). These tests pin BOTH halves of that contract.
 */
describe('renderCarrierProfile — Directory Pro contacts gate', () => {
  it('always server-renders the FREE variant: teaser + "$19/mo" CTA + disabled reveal', () => {
    const html = renderCarrierProfile({ carrier: carrier() });
    expect(html).toContain('Unlock with Directory Pro — $19/mo');
    expect(html).toContain('href="/directory/join?intent=subscribe"');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Reveal contacts<\/button>/);
    // The gate ELEMENT served to everyone is the free one. (The Pro markup does
    // appear in the page — as a STRING inside the hydrate script — so assert on
    // the rendered element, not on raw substring absence.)
    expect(html).toContain('<div class="cp-gated" data-cp-gated');
    expect(html).not.toMatch(/<div class="cp-gated cp-gated--pro"/);
  });

  it('carries no server-side entitlement input at all — the render is identity-free', () => {
    // renderCarrierProfile has no `isPro` parameter to pass (a compile-time
    // guarantee), so two renders of the same carrier are byte-identical. That
    // IS the caching contract: a shared cache may hand one visitor's copy to
    // any other visitor.
    expect(renderCarrierProfile({ carrier: carrier() })).toBe(renderCarrierProfile({ carrier: carrier() }));
  });

  it('ships the Pro variant in a client-side hydrator keyed on the real reveal endpoint', () => {
    const html = renderCarrierProfile({ carrier: carrier() });
    // The endpoint travels as a data-attribute the hydrator reads, so the free
    // markup stays inert while the Pro form can still POST to the right URL.
    expect(html).toContain('data-reveal-action="/api/directory/carrier/107080/reveal"');
    expect(html).toContain('cp-gated--pro');
    expect(html).toContain('Reveal additional contacts');
    // Hydration must gate on a LIVE subscription, never merely on being signed in.
    expect(html).toContain("s==='active'||s==='trialing'");
    // And it must reuse the single shared /me request, not open a second one.
    expect(html).toContain('window.__qfDirMe');
  });

  it('the gate NEVER hides the public FMCSA phone/email (free data stays free)', () => {
    const html = renderCarrierProfile({ carrier: carrier() });
    expect(html).toContain('href="tel:9125550921"');
    expect(html).toContain('href="mailto:dispatch%40acme.com"');
  });
});
