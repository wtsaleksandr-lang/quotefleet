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

describe('carrier-profile claim CTAs are explicitly free', () => {
  const html = renderCarrierProfile({ carrier: carrier() });

  it("the 'Own this company?' line states claiming is free", () => {
    expect(html).toContain("Claim this profile — it's free →");
  });
});
