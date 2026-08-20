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
import { renderCarrierProfile, carrierCard } from './pages.js';
import type { VisibleCarrier } from './queries.js';

/** A carrier holding EVERY equipment/credential flag — the maximal case the
 *  no-orphan wrap rule must survive (header groups + list card). */
const MAXIMAL: Partial<VisibleCarrier> = {
  intermodal: true,
  hazmat: true,
  dryVan: true,
  reefer: true,
  tanker: true,
  flatbed: true,
  dryBulk: true,
  safetyRating: 'S',
  authorityType: 'common',
};

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

const badge = (tone: string) => `class="cp-badge cp-tip cp-badge--${tone}"`;

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

describe('badge groups — no single badge is ever stranded on a line (global rule)', () => {
  // The count-aware grid partitions each group by its data-n so no line ends
  // with exactly one badge: 2→2, 3→3, 4→2×2, 5→3+2, 6→3×2. A data-n of 1 is a
  // lone group (nothing to strand), and any n in 2..6 has an orphan-free layout.
  const ORPHAN_SAFE = new Set([1, 2, 3, 4, 5, 6]);

  it('profile header splits credentials + equipment into two orphan-safe groups', () => {
    const html = renderCarrierProfile({ carrier: carrier(MAXIMAL) });
    const groups = [...html.matchAll(/class="cp-badgegroup[^"]*" data-n="(\d+)"/g)].map((m) => Number(m[1]));
    // Two groups: credentials (authority + drayage + hazmat + safety = 4) and
    // equipment (dry van + reefer + tanker + flatbed + dry bulk = 5).
    expect(groups).toEqual([4, 5]);
    for (const n of groups) expect(ORPHAN_SAFE.has(n)).toBe(true);
  });

  it('equipment badges live in the SECOND group, credentials in the first', () => {
    const html = renderCarrierProfile({ carrier: carrier(MAXIMAL) });
    const equipWrap = html.indexOf('cp-badgegroup--equip');
    // Drayage (a credential) precedes the equipment group; dry van (equipment) follows it.
    expect(html.indexOf(badge('dray'))).toBeLessThan(equipWrap);
    expect(html.indexOf(badge('dryvan'))).toBeGreaterThan(equipWrap);
    expect(html).toContain('class="cp-eqlabel">Equipment<');
  });

  it('never emits a badge group with a stranded count (data-n of 0 or >6)', () => {
    for (const sample of [carrier(), carrier(MAXIMAL), carrier({ intermodal: false, safetyRating: null })]) {
      const html = renderCarrierProfile({ carrier: sample });
      for (const m of html.matchAll(/class="cp-badgegroup[^"]*" data-n="(\d+)"/g)) {
        expect(ORPHAN_SAFE.has(Number(m[1]))).toBe(true);
      }
    }
  });

  it('list card caps its chip row to an orphan-safe count and shows "+N more"', () => {
    const html = carrierCard(carrier(MAXIMAL));
    const m = html.match(/class="card-chips" data-n="(\d+)"/);
    expect(m).not.toBeNull();
    const n = Number(m![1]);
    expect(n).toBe(6); // safety + hazmat + 4 shown + "+2 more" → capped at 6 (clean 3×2)
    expect(ORPHAN_SAFE.has(n)).toBe(true);
    expect(html).toContain('+2 more');
  });

  it('list card leaves a small chip set uncapped and orphan-safe', () => {
    // Safety + 2 equipment = 3 pills → data-n 3 (one 3-wide row, no orphan), no "+N".
    const html = carrierCard(carrier({ dryVan: true, reefer: true, hazmat: false, tanker: false, flatbed: false, dryBulk: false }));
    expect(html).toMatch(/class="card-chips" data-n="3"/);
    expect(html).not.toContain('more');
  });
});

describe('renderCarrierProfile — DrayLocator-structured header', () => {
  it('renders a company monogram avatar with up to two uppercase initials', () => {
    // "ACME DRAYAGE INC" → first letter of the first two words → "AD".
    const html = renderCarrierProfile({ carrier: carrier() });
    expect(html).toContain('class="cp-monogram" aria-hidden="true">AD<');
  });

  it('derives two letters from a single-word name', () => {
    const html = renderCarrierProfile({ carrier: carrier({ legalName: 'MOVERS', dbaName: null }) });
    expect(html).toContain('class="cp-monogram" aria-hidden="true">MO<');
  });

  it('shows an FMCSA source marker with NO fabricated date', () => {
    const html = renderCarrierProfile({ carrier: carrier() });
    // Visible marker face is exactly "FMCSA" (no "as of <date>" appended), and its
    // tooltip carries an honest source note — never our ingest timestamp as a date.
    expect(html).toContain(
      '<span class="cp-fmcsa cp-tip" tabindex="0" role="note" aria-label="FMCSA — Profile built from FMCSA public records." data-tip="Profile built from FMCSA public records.">FMCSA</span>',
    );
  });

  it('renders a left-aligned header row: name, Active badge, and claim link', () => {
    const html = renderCarrierProfile({ carrier: carrier() });
    expect(html).toContain('class="cp-headrow"');
    expect(html).toContain('class="cp-badge-active"');
    expect(html).toContain('Own this company?');
  });

  it('orders the subtitle USDOT · MC · City, State', () => {
    const html = renderCarrierProfile({ carrier: carrier() });
    expect(html).toContain('USDOT 107080 · MC MC012892 · SAVANNAH, GA');
  });
});
