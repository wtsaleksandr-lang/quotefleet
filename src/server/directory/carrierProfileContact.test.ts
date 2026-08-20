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
});
