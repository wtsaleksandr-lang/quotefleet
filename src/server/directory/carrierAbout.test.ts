/**
 * carrierAbout — deterministic FMCSA-fact "About" summary. Pure string builder,
 * no DB / no network / no AI. These tests pin the null-handling: every clause
 * must drop cleanly when its data is missing, and no invented capability may
 * ever appear.
 */
import { describe, it, expect } from 'vitest';
import { carrierAbout } from './pages.js';
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

describe('carrierAbout', () => {
  it('composes a full factual summary from a complete record', () => {
    const t = carrierAbout(carrier());
    expect(t).toContain('ACME DRAYAGE INC is an active FMCSA-registered drayage and intermodal carrier');
    expect(t).toContain('based in Savannah, GA');
    expect(t).toContain('operating 25 power units and 30 drivers under common authority');
    expect(t).toContain('Its FMCSA safety rating is Satisfactory.');
    expect(t).toContain('container drayage and intermodal moves');
    expect(t).toContain('US container ports');
  });

  it('says "motor carrier" (not drayage) when not intermodal, and omits the drayage sentence', () => {
    const t = carrierAbout(carrier({ intermodal: false }));
    expect(t).toContain('FMCSA-registered motor carrier');
    expect(t).not.toContain('drayage');
    expect(t).not.toContain('container ports');
  });

  it('drops the "active" qualifier when no authority is on file', () => {
    const t = carrierAbout(carrier({ authorityType: null }));
    expect(t).toContain('is an FMCSA-registered');
    expect(t).not.toContain('active FMCSA-registered');
    expect(t).not.toContain('authority.');
  });

  it('omits the fleet clause when both power units and drivers are null', () => {
    const t = carrierAbout(carrier({ powerUnits: null, drivers: null }));
    expect(t).not.toContain('power unit');
    expect(t).not.toContain('driver');
    // Authority still attaches without a fleet clause.
    expect(t).toContain('operating under common authority');
  });

  it('renders a partial fleet clause when only power units are present', () => {
    const t = carrierAbout(carrier({ drivers: null }));
    expect(t).toContain('operating 25 power units under common authority');
    expect(t).not.toContain('drivers');
  });

  it('uses singular units and the full state name when only a state is known', () => {
    const t = carrierAbout(carrier({ city: null, powerUnits: 1, drivers: 1 }));
    expect(t).toContain('based in Georgia');
    expect(t).toContain('1 power unit and 1 driver');
    expect(t).not.toContain('1 power units');
    expect(t).not.toContain('1 drivers');
  });

  it('omits the safety sentence when the carrier is not rated', () => {
    const t = carrierAbout(carrier({ safetyRating: null }));
    expect(t).not.toContain('safety rating is');
  });

  it('handles a bare record (no location, no fleet, no authority, no rating)', () => {
    const t = carrierAbout(
      carrier({ city: null, state: null, powerUnits: null, drivers: null, authorityType: null, safetyRating: null, intermodal: false }),
    );
    expect(t).toBe('ACME DRAYAGE INC is an FMCSA-registered motor carrier.');
  });

  it('uses North American ports / Canadian trade-lane wording for a Canadian province', () => {
    const t = carrierAbout(carrier({ state: 'ON', city: 'TORONTO' }));
    expect(t).toContain('based in Toronto, ON');
    expect(t).toContain('North American container ports');
  });
});
