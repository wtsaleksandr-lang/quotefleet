/**
 * Carrier-profile RENDER wiring for Phase-2 overrides (renderCarrierProfile).
 *
 * Pins that a merged VisibleCarrier's override fields actually reach the HTML:
 *   - `aboutOverride` replaces the FMCSA-derived "About" prose (escaped);
 *   - a self-declared `capabilities` flag flips its credential badge from the
 *     muted "claim to add" affordance to an ACTIVE solid badge, WHILE its tooltip
 *     stays "Self-declared." (never FMCSA-verified).
 * Pure HTML render — no DB / no network.
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
    nearestPortCode: 'USSAV',
    aboutOverride: null,
    capabilities: {},
    provenance: { about: 'fmcsa', email: 'fmcsa', phone: 'fmcsa', hidden: 'fmcsa', capabilities: 'fmcsa' },
    ...overrides,
  };
}

describe('renderCarrierProfile — override wiring', () => {
  it('renders the About override instead of the FMCSA-derived prose', () => {
    const html = renderCarrierProfile({ carrier: carrier({ aboutOverride: 'Family-run drayage since 1998. <b>Reefer specialists.</b>' }) });
    // Escaped override text is present…
    expect(html).toContain('Family-run drayage since 1998. &lt;b&gt;Reefer specialists.&lt;/b&gt;');
    // …and the auto-generated FMCSA sentence is NOT.
    expect(html).not.toContain('is an active FMCSA-registered drayage and intermodal carrier');
  });

  it('falls back to FMCSA prose when there is no About override', () => {
    const html = renderCarrierProfile({ carrier: carrier() });
    expect(html).toContain('ACME DRAYAGE INC is an active FMCSA-registered drayage and intermodal carrier');
  });

  it('flips a self-declared capability to a SOLID badge, still tooltip-labeled Self-declared', () => {
    const html = renderCarrierProfile({ carrier: carrier({ capabilities: { uiia: true } }) });
    // Solid active badge (NOT the muted claim variant) for UIIA.
    expect(html).toContain('class="cp-badge cp-tip cp-badge--uiia"');
    // The active UIIA badge is no longer a "claim to add" affordance.
    const uiiaBlock = html.slice(html.indexOf('cp-badge--uiia'), html.indexOf('cp-badge--uiia') + 400);
    expect(uiiaBlock).not.toContain('claim to add');
    // Honesty: even when active, the tooltip flags it Self-declared.
    expect(html).toContain('Self-declared.');
  });

  it('leaves an unset capability as the muted "claim to add" affordance', () => {
    const html = renderCarrierProfile({ carrier: carrier() });
    // No solid UIIA badge…
    expect(html).not.toContain('class="cp-badge cp-tip cp-badge--uiia"');
    // …the muted claim badge with the affordance is shown instead.
    expect(html).toContain('cp-badge--claim');
    expect(html).toContain('claim to add');
  });

  it('a hidden override suppresses public contact on the profile', () => {
    const html = renderCarrierProfile({ carrier: carrier({ contactHidden: true }) });
    expect(html).toContain("hidden at the carrier's request");
    expect(html).not.toContain('href="tel:9125550921"');
  });
});
