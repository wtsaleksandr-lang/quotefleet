/**
 * Copy guarantees:
 *   - the free calculator (tools.html) shows the market-averages disclaimer near
 *     the result/CTA;
 *   - the carrier-profile claim CTAs make clear that claiming is FREE.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
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

describe('free calculator disclaimer', () => {
  it('renders the market-averages / not-a-binding-quote line', async () => {
    const html = await readFile(resolve(process.cwd(), 'src/server/public/tools.html'), 'utf8');
    expect(html).toContain('Estimate based on market averages — not a binding quote.');
  });
});

describe('carrier-profile claim CTAs are explicitly free, forever', () => {
  const html = renderCarrierProfile({ carrier: carrier() });

  /**
   * The header's claim affordance is now the ONE "Claim & edit" pill (it
   * replaced a "Own this company? Claim this profile — free, forever →" line
   * that sat one element below it and said the same thing). The free-forever
   * promise did not move off the header with it: the pill's own title states
   * it, and the "Help complete this profile" card below states it in full —
   * both asserted here, so the guarantee cannot be dropped silently.
   */
  it('the header claim pill states claiming is free, forever', () => {
    expect(html).toContain('class="cp-editbtn" href="/claim/acme-drayage-inc-107080"');
    expect(html).toContain('title="Claim this profile to edit it — free, forever"');
    expect(html).toContain('Claim &amp; edit');
    // …and it is the only claim CTA in the header (the old line is gone).
    expect(html).not.toContain('Own this company?');
  });

  it('every claim CTA points at the free claim page, never the trial signup', () => {
    expect(html).toContain('href="/claim/acme-drayage-inc-107080"');
    expect(html).not.toContain('/signup?claim=');
    expect(html).toContain('Is this your company?');
    expect(html).toContain('Claim this profile — free, forever <span class="arr">→</span>');
    expect(html).toContain('no trial, no card, no plan');
  });

  it('an unclaimed profile shows no Verified owner badge', () => {
    expect(html).not.toContain('cp-badge-verified');
  });
});

describe('a CLAIMED carrier profile', () => {
  const html = renderCarrierProfile({ carrier: carrier({ claimedTenantId: 42, claimedAt: new Date('2026-09-01T00:00:00Z') }) });

  it('renders the Verified owner badge in the head row', () => {
    expect(html).toContain('cp-badge-verified');
    expect(html).toContain('Verified owner</span>');
    // The owning tenant id is never rendered.
    expect(html).not.toMatch(/tenant[-_ ]?id/i);
  });

  it('hides every claim CTA', () => {
    expect(html).not.toContain('Own this company?');
    expect(html).not.toContain('Is this your company?');
    expect(html).not.toContain('cp-claimcard');
    expect(html).not.toContain('href="/claim/');
  });
});
