/**
 * THE CARRIER-PROFILE HEADER CARD — the owner-reference rebuild.
 *
 * The reference this page was rebuilt against is a blank profile: no location,
 * no phone, no email, no USDOT, four dashed "Add …" rows and nothing else. Ours
 * is not blank, and the single most important property of this rebuild is that
 * it did NOT copy that emptiness: FMCSA gives us an address, a phone and
 * usually an email for essentially every carrier, so POPULATED is the default
 * and the dashed invitation is reserved for the fields a given carrier actually
 * lacks.
 *
 * These tests pin exactly that boundary — a populated carrier must not be able
 * to grow an "Add …" row, and a carrier missing ONE field must get that field's
 * empty state and no other's — plus the header affordances the rebuild added or
 * kept: the mobile back link, the "Claim & edit" pill (which resolves the
 * reference's "Suggest Edit" to the one write path we actually have), and the
 * "Verified owner" badge.
 *
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

/** The four contact rows, in render order, as `{label, html}` pairs. */
function contactRows(html: string): Array<{ label: string; html: string }> {
  const strip = html.slice(html.indexOf('<div class="cp-cstrip">'));
  const out: Array<{ label: string; html: string }> = [];
  for (const m of strip.matchAll(/<div class="cp-cbox(?: cp-cbox--empty)?">[\s\S]*?<\/span><\/span><\/div>/g)) {
    const label = /cp-cbox-k">([^<]+)</.exec(m[0])?.[1] ?? '';
    out.push({ label, html: m[0] });
    if (out.length === 4) break;
  }
  return out;
}

const rowFor = (html: string, label: string) => contactRows(html).find((r) => r.label === label)!;

describe('carrier profile contact card — POPULATED is the default', () => {
  it('renders the four rows in the reference order, with real values, for a complete carrier', () => {
    const rows = contactRows(renderCarrierProfile({ carrier: carrier() }));
    expect(rows.map((r) => r.label)).toEqual(['Location', 'Website', 'Phone', 'Email']);
    expect(rowFor(renderCarrierProfile({ carrier: carrier() }), 'Location').html).toContain('SAVANNAH, GA 31401');
    expect(rowFor(renderCarrierProfile({ carrier: carrier() }), 'Phone').html).toContain('href="tel:9125550921"');
    expect(rowFor(renderCarrierProfile({ carrier: carrier() }), 'Email').html).toContain('href="mailto:dispatch%40acme.com"');
  });

  it('gives a complete carrier NO "Add …" invitation except Website, the one column we do not have', () => {
    const html = renderCarrierProfile({ carrier: carrier() });
    // Location / Phone / Email are facts, so none of them may be dashed…
    for (const label of ['Location', 'Phone', 'Email']) {
      const row = rowFor(html, label);
      expect(row.html, `${label} row must be populated`).not.toContain('cp-cbox--empty');
      expect(row.html, `${label} row must not invite`).not.toContain('Add ');
    }
    // …and "Add website" is the ONLY invitation anywhere on the page. (One
    // occurrence, so a future field cannot quietly join it.)
    expect(html.match(/>Add [a-z]+</g)).toEqual(['>Add website<']);
    const website = rowFor(html, 'Website');
    expect(website.html).toContain('cp-cbox--empty');
    expect(website.html).toContain('href="/claim/acme-drayage-inc-107080">Add website<');
  });

  it('every row carries a 48px icon tile, never a text glyph', () => {
    const html = renderCarrierProfile({ carrier: carrier() });
    for (const row of contactRows(html)) {
      expect(row.html, `${row.label} row icon`).toContain('<svg class="cp-cbox-ic"');
    }
    // The pre-rebuild ☎ / ✉ / ↗ text glyphs are gone.
    expect(html).not.toContain('cp-cbox-glyph');
  });
});

describe('carrier profile contact card — a MISSING field gets that field\'s empty state, and only that one', () => {
  it('a carrier with no email dashes Email alone; Location and Phone stay real', () => {
    const html = renderCarrierProfile({ carrier: carrier({ email: null }) });
    expect(rowFor(html, 'Email').html).toContain('cp-cbox--empty');
    expect(rowFor(html, 'Email').html).toContain('href="/claim/acme-drayage-inc-107080">Add email<');
    expect(rowFor(html, 'Location').html).not.toContain('cp-cbox--empty');
    expect(rowFor(html, 'Phone').html).not.toContain('cp-cbox--empty');
    expect(rowFor(html, 'Phone').html).toContain('href="tel:9125550921"');
    // Website is still the only OTHER invitation — the set grew by exactly one.
    expect(html.match(/>Add [a-z]+</g)).toEqual(['>Add website<', '>Add email<']);
  });

  it('a carrier with no phone dashes Phone alone; Email stays real', () => {
    const html = renderCarrierProfile({ carrier: carrier({ phone: null }) });
    expect(rowFor(html, 'Phone').html).toContain('cp-cbox--empty');
    expect(rowFor(html, 'Phone').html).toContain('href="/claim/acme-drayage-inc-107080">Add phone<');
    expect(rowFor(html, 'Email').html).not.toContain('cp-cbox--empty');
    expect(html.match(/>Add [a-z]+</g)).toEqual(['>Add website<', '>Add phone<']);
  });

  it('the carrier opt-out states the absence, it does NOT invite a stranger to fill it in', () => {
    const html = renderCarrierProfile({ carrier: carrier({ contactHidden: true }) });
    for (const label of ['Phone', 'Email']) {
      const row = rowFor(html, label);
      expect(row.html).toContain('cp-cbox--empty');
      expect(row.html).toContain('Hidden at the carrier’s request');
      expect(row.html).not.toContain('Add ');
    }
  });
});

describe('carrier profile header — the reference affordances', () => {
  it('carries a back link aimed at the DEEPEST linked crumb, not a hardcoded /directory', () => {
    const html = renderCarrierProfile({ carrier: carrier() });
    expect(html).toContain('<a class="cp-back" href="/directory/georgia/savannah">');
    expect(html).toContain('Back to Savannah');
    // The breadcrumb is still in the markup; CSS reveals exactly one per width.
    expect(html).toContain('<nav class="dir-crumbs"');
  });

  it('falls back to /directory when no state or city crumb is linked', () => {
    // A carrier with no resolvable state has only the "Directory" crumb linked.
    const html = renderCarrierProfile({ carrier: carrier({ state: null, city: null }) });
    expect(html).toContain('<a class="cp-back" href="/directory">');
    expect(html).toContain('Back to Directory');
  });

  it('renders ONE claim affordance in the header — the pill — pointed at the real claim flow', () => {
    const html = renderCarrierProfile({ carrier: carrier() });
    const start = html.indexOf('<div class="cp-herocard">');
    const card = html.slice(start, html.indexOf('<div class="cp-cstrip">', start));
    expect(card).toContain('class="cp-editbtn" href="/claim/acme-drayage-inc-107080"');
    expect(card).toContain('Claim &amp; edit');
    // Exactly one — the "Own this company? …" sentence that used to duplicate it
    // one element below is gone.
    expect(card.match(/href="\/claim\//g)).toHaveLength(1);
    // It is NOT labelled "Suggest Edit": there is no suggestion queue behind it
    // (the only carrier_overrides writers are the admin endpoint and the claim
    // flow), and a button that names an action we cannot perform is a lie.
    expect(html).not.toContain('Suggest');
  });

  it('drops the pill on a claimed profile — ownership is proven, there is nothing to claim', () => {
    const html = renderCarrierProfile({
      carrier: carrier({ claimedTenantId: 42, claimedAt: new Date('2026-09-01T00:00:00Z') }),
    });
    expect(html).not.toContain('cp-editbtn');
    expect(html).not.toContain('href="/claim/');
  });
});

describe('carrier profile header — the Verified owner badge', () => {
  it('renders only when claimed_tenant_id is set, and never leaks the id', () => {
    const unclaimed = renderCarrierProfile({ carrier: carrier() });
    expect(unclaimed).not.toContain('cp-badge-verified');
    expect(unclaimed).not.toContain('Verified owner');

    const claimed = renderCarrierProfile({
      carrier: carrier({ claimedTenantId: 42, claimedAt: new Date('2026-09-01T00:00:00Z') }),
    });
    expect(claimed).toContain('cp-badge-verified');
    expect(claimed).toContain('Verified owner</span>');
    expect(claimed).not.toContain('42');
  });

  it('sits in the name line, beside the company name', () => {
    const html = renderCarrierProfile({
      carrier: carrier({ claimedTenantId: 7, claimedAt: new Date('2026-09-01T00:00:00Z') }),
    });
    const nameline = /<div class="cp-nameline">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '';
    expect(nameline).toContain('ACME DRAYAGE INC');
    expect(nameline).toContain('cp-badge-verified');
  });
});

describe('carrier profile header — the logo tile takes both curated crops', () => {
  it('uses the SQUARE crop for the square plate, via carrierLogoUrl()', () => {
    // USDOT 606920 is in the curated registry (carrierLogos.ts).
    const html = renderCarrierProfile({ carrier: carrier({ usdot: '606920' }) });
    expect(html).toContain('class="cp-monogram cp-monogram--img"');
    expect(html).toContain('src="/carrier-logos/square/ats.webp"');
    // …and object-fit: contain is what lets a wide wordmark and a square mark
    // both sit in it without a crop or a stretch.
    expect(html).not.toContain('src="/carrier-logos/ats.webp"');
  });

  it('falls back to the monogram for the ~331k carriers with no reviewed artwork', () => {
    const html = renderCarrierProfile({ carrier: carrier() });
    expect(html).toContain('class="cp-monogram"');
    expect(html).not.toContain('cp-monogram--img');
  });
});

describe('carrier profile — "Help complete this profile" keeps its wiring', () => {
  it('leads with a + tile and links to the free claim flow', () => {
    const html = renderCarrierProfile({ carrier: carrier() });
    const card = /<div class="dir-card cp-claimcard">([\s\S]*?)<\/div>\s*<\/div>/.exec(html)?.[1] ?? '';
    expect(card).toContain('cp-cbox-ic--plus');
    expect(card).toContain('Help complete this profile');
    expect(card).toContain('href="/claim/acme-drayage-inc-107080"');
    expect(card).toContain('no trial, no card, no plan');
  });

  it('is absent entirely once the profile is claimed', () => {
    const html = renderCarrierProfile({
      carrier: carrier({ claimedTenantId: 42, claimedAt: new Date('2026-09-01T00:00:00Z') }),
    });
    expect(html).not.toContain('cp-claimcard');
  });
});
