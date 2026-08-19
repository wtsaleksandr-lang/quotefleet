/**
 * Carrier-profile CREDENTIAL BADGES — solid-colour FMCSA-verified badges +
 * muted self-declared "claim to add" badges, each with a pure-CSS hover/focus
 * tooltip. Pure HTML render (renderCarrierProfile), no DB / no network.
 *
 * NB: badge class names also appear inside the embedded <style> block, so every
 * assertion targets the rendered element's `class="cp-badge cp-badge--X"`
 * attribute (which only occurs on a real badge), never the bare class token.
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
    ...overrides,
  };
}

const badge = (tone: string) => `class="cp-badge cp-badge--${tone}"`;

describe('renderCarrierProfile — credential badges', () => {
  it('renders a SOLID Hazmat badge, marked FMCSA-verified, for a hazmat carrier', () => {
    const html = renderCarrierProfile({ carrier: carrier({ hazmat: true }) });
    expect(html).toContain(badge('hazmat'));
    expect(html).toContain('>Hazmat</span>');
    // Tooltip explains the credential AND flags it FMCSA-verified.
    expect(html).toContain('FMCSA-registered to transport hazardous materials.');
    expect(html).toContain('✓ FMCSA-verified.');
  });

  it('does NOT render a Hazmat badge for a non-hazmat carrier', () => {
    const html = renderCarrierProfile({ carrier: carrier({ hazmat: false }) });
    expect(html).not.toContain(badge('hazmat'));
    expect(html).not.toContain('>Hazmat</span>');
  });

  it('renders FMCSA-derived credentials as distinct solid badges', () => {
    const html = renderCarrierProfile({ carrier: carrier() });
    expect(html).toContain(badge('dray')); // Drayage / intermodal
    expect(html).toContain(badge('authority')); // Common authority
    expect(html).toContain(badge('safety-good')); // Satisfactory safety
  });

  it('colours the safety badge by rating tone', () => {
    expect(renderCarrierProfile({ carrier: carrier({ safetyRating: 'C' }) })).toContain(badge('safety-warn'));
    expect(renderCarrierProfile({ carrier: carrier({ safetyRating: 'U' }) })).toContain(badge('safety-bad'));
    // Unrated → no safety badge element rendered at all (honest: nothing to assert).
    const unrated = renderCarrierProfile({ carrier: carrier({ safetyRating: null }) });
    expect(unrated).not.toContain(badge('safety-good'));
    expect(unrated).not.toContain(badge('safety-warn'));
    expect(unrated).not.toContain(badge('safety-bad'));
  });

  it('keeps self-declared credentials muted with a "claim to add" affordance + tooltip', () => {
    const html = renderCarrierProfile({ carrier: carrier() });
    expect(html).toContain(badge('claim'));
    expect(html).toContain('claim to add');
    // Each self-declared badge names the credential and flags it self-declared.
    expect(html).toContain('>UIIA member ');
    expect(html).toContain('Uniform Intermodal Interchange Agreement');
    expect(html).toContain('Self-declared.');
    expect(html).toContain('>TWIC ');
    expect(html).toContain('>Customs-bonded / C-TPAT ');
    expect(html).toContain('>Reefer ');
  });

  it('makes every badge keyboard-focusable with a tooltip + aria-label', () => {
    const html = renderCarrierProfile({ carrier: carrier({ hazmat: true }) });
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('data-tip=');
    expect(html).toContain('aria-label=');
    expect(html).toContain('role="note"');
  });
});
