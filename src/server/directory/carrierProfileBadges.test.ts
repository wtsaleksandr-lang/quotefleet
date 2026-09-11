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

  it('keeps self-declared credentials muted with a compact "Claim" affordance + explanatory tooltip', () => {
    const html = renderCarrierProfile({ carrier: carrier() });
    expect(html).toContain(badge('claim'));
    // Compact one-word affordance (was "claim to add"), same size on every card.
    expect(html).toContain('>Claim</span>');
    expect(html).not.toContain('claim to add');
    // Terse "Claim" is explained by the tooltip's claim call-to-action.
    expect(html).toContain('Claim this profile to verify &amp; add this credential.');
    // Each self-declared badge names the credential and flags it self-declared.
    expect(html).toContain('>UIIA member</span>');
    expect(html).toContain('Uniform Intermodal Interchange Agreement');
    expect(html).toContain('Self-declared.');
    expect(html).toContain('>TWIC</span>');
    expect(html).toContain('>Customs-bonded / C-TPAT</span>');
    expect(html).toContain('>Reefer</span>');
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
    // authority + drayage + safety + hazmat + 5 equipment = 9 → 5 shown + "+4 more".
    expect(n).toBe(6); // capped at 6 (clean 3×2)
    expect(ORPHAN_SAFE.has(n)).toBe(true);
    expect(html).toContain('+4 more');
  });

  it('list card leaves a small chip set uncapped and orphan-safe', () => {
    // authority + drayage + safety + 2 equipment = 5 pills → data-n 5 (3+2, no orphan).
    const html = carrierCard(carrier({ dryVan: true, reefer: true, hazmat: false, tanker: false, flatbed: false, dryBulk: false }));
    expect(html).toMatch(/class="card-chips" data-n="5"/);
    expect(html).not.toContain('more');
  });

  it('list card leads its chip row with the AUTHORITY TYPE, not a country', () => {
    // The reference design put an All/CA/US/MX country segment here. Our data is
    // the FMCSA census — US-only — so the equivalent real classification is the
    // operating authority, and no country pill may ever be rendered.
    const html = carrierCard(carrier(MAXIMAL));
    const first = html.slice(html.indexOf('class="card-chips"'));
    expect(first).toMatch(/<span class="pill pill-auth">Common authority<\/span>/);
    expect(html).not.toMatch(/>(Canada|Mexico|MX|CA\/US)</);
  });

  it('list card renders a logo slot: a deterministic monogram when there is no logo', () => {
    const html = carrierCard(carrier());
    // Hue is pinned to the brand band (214–242) so 5,000 tiles read as one family.
    const m = html.match(/class="cc-logo" style="--dir-logo-h: (\d+)" aria-hidden="true">AD</);
    expect(m, html.slice(0, 400)).not.toBeNull();
    const hue = Number(m![1]);
    expect(hue).toBeGreaterThanOrEqual(214);
    expect(hue).toBeLessThanOrEqual(242);
    // Stable across renders — a carrier's tile must not change colour per request.
    expect(carrierCard(carrier())).toContain(`--dir-logo-h: ${hue}`);
  });
});

describe('renderCarrierProfile — DrayLocator-structured header', () => {
  it('renders a company monogram avatar with up to two uppercase initials', () => {
    // "ACME DRAYAGE INC" → first letter of the first two words → "AD". The tile
    // also carries its deterministic brand-band tint (--dir-logo-h).
    const html = renderCarrierProfile({ carrier: carrier() });
    expect(html).toMatch(/class="cp-monogram" style="--dir-logo-h: \d+" aria-hidden="true">AD</);
  });

  it('derives two letters from a single-word name', () => {
    const html = renderCarrierProfile({ carrier: carrier({ legalName: 'MOVERS', dbaName: null }) });
    expect(html).toMatch(/class="cp-monogram" style="--dir-logo-h: \d+" aria-hidden="true">MO</);
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

  it('puts the ADDRESS in the header subtitle and the identifiers in the badge row', () => {
    // The header now reads like the reference: pin + full address under the
    // name, with USDOT / MC moved into the wrapped badge row beside the fleet
    // figures. Both facts are still in the header, in a stable order.
    const html = renderCarrierProfile({ carrier: carrier() });
    const subStart = html.indexOf('class="lead cp-subtitle"');
    const sub = html.slice(subStart, html.indexOf('</p>', subStart));
    expect(sub).toContain('SAVANNAH, GA 31401');
    expect(sub).toContain('<svg class="dir-ico"'); // the pin
    const badges = html.slice(html.indexOf('class="cp-hbadges"'));
    const dot = badges.indexOf('USDOT 107080');
    const mc = badges.indexOf('MC MC012892');
    expect(dot).toBeGreaterThan(-1);
    expect(mc).toBeGreaterThan(dot);
    // Fleet figures are badges too, and they are the stored FMCSA values.
    expect(badges).toContain('25 trucks');
    expect(badges).toContain('30 drivers');
  });
});
