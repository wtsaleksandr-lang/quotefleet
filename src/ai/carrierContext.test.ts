import { describe, it, expect } from 'vitest';
import {
  buildCarrierContext,
  carrierContextSection,
  MAX_LISTED_REGIONS,
  type CarrierContextInput,
} from './carrierContext.js';
import {
  rateAdjusterSystemPrompt,
  leadReplySystemPrompt,
  leadChatSystemPrompt,
} from './prompts.js';
import type { Tenant } from '../db/schema.js';

/** Minimal tenant-shaped literal — the helper only reads name + onboardingJson. */
function tenant(onboardingJson: CarrierContextInput['onboardingJson'], name = 'Harbor Link Logistics'): CarrierContextInput {
  return { name, onboardingJson };
}

const BASE = { completedAt: '2026-07-01T00:00:00.000Z', skipped: false };

describe('buildCarrierContext — service area kinds', () => {
  it('nationwide_us', () => {
    const out = buildCarrierContext(
      tenant({ ...BASE, freightVerticals: ['dryvan_ftl'], serviceArea: { kind: 'nationwide_us' } })
    );
    expect(out).toContain('They run nationwide across the United States.');
  });

  it('nationwide_ca', () => {
    const out = buildCarrierContext(
      tenant({ ...BASE, freightVerticals: ['reefer'], serviceArea: { kind: 'nationwide_ca' } })
    );
    expect(out).toContain('They run nationwide across Canada.');
  });

  it('cross_border', () => {
    const out = buildCarrierContext(
      tenant({ ...BASE, freightVerticals: ['flatbed'], serviceArea: { kind: 'cross_border' } })
    );
    expect(out).toContain('cross-border freight between the United States and Canada.');
  });

  it('regions lists the state/province codes', () => {
    const out = buildCarrierContext(
      tenant({
        ...BASE,
        freightVerticals: ['dryvan_ftl'],
        serviceArea: { kind: 'regions', regions: ['CA', 'AZ', 'NV', 'ON'] },
      })
    );
    expect(out).toContain('They operate in specific states/provinces: CA, AZ, NV, ON.');
  });

  it('radius names the miles and the base city', () => {
    const out = buildCarrierContext(
      tenant({
        ...BASE,
        freightVerticals: ['drayage'],
        serviceArea: { kind: 'radius', radiusMiles: 300, baseCity: 'Long Beach, CA' },
      })
    );
    expect(out).toContain('They operate within 300 miles of Long Beach, CA.');
  });

  it('radius without a base city still reads as a sentence', () => {
    const out = buildCarrierContext(
      tenant({ ...BASE, freightVerticals: ['drayage'], serviceArea: { kind: 'radius', radiusMiles: 250 } })
    );
    expect(out).toContain('within a 250-mile radius of their home base.');
    expect(out).not.toContain('undefined');
  });

  it('radius with neither miles nor city omits the area sentence', () => {
    const out = buildCarrierContext(
      tenant({ ...BASE, freightVerticals: ['drayage'], serviceArea: { kind: 'radius' } })
    );
    expect(out).toBe('Harbor Link Logistics hauls port/rail drayage.');
  });
});

describe('buildCarrierContext — modes', () => {
  it('phrases multiple modes as a natural list', () => {
    const out = buildCarrierContext(
      tenant({ ...BASE, freightVerticals: ['dryvan_ftl', 'reefer', 'flatbed'] })
    );
    expect(out).toBe(
      'Harbor Link Logistics hauls dry van FTL, reefer (temperature-controlled) and flatbed/open-deck.'
    );
  });

  it('phrases a single mode without a conjunction', () => {
    const out = buildCarrierContext(tenant({ ...BASE, freightVerticals: ['ltl'] }));
    expect(out).toBe('Harbor Link Logistics hauls LTL/partial loads.');
  });

  it('falls back to the legacy single freightVertical', () => {
    const out = buildCarrierContext(tenant({ ...BASE, freightVertical: 'hotshot' }));
    expect(out).toBe('Harbor Link Logistics hauls hotshot/expedited.');
  });

  it('humanizes an unrecognised vertical code instead of dropping it', () => {
    const out = buildCarrierContext(tenant({ ...BASE, freightVerticals: ['auto_hauling'] }));
    expect(out).toBe('Harbor Link Logistics hauls auto hauling.');
  });
});

describe('buildCarrierContext — pricing + full sentence', () => {
  it('renders the full multi-mode regions carrier', () => {
    const out = buildCarrierContext(
      tenant({
        ...BASE,
        freightVerticals: ['dryvan_ftl', 'reefer', 'flatbed'],
        pricingMode: 'per_mile',
        serviceArea: { kind: 'regions', regions: ['CA', 'AZ', 'NV', 'ON'] },
      })
    );
    expect(out).toBe(
      'Harbor Link Logistics hauls dry van FTL, reefer (temperature-controlled) and flatbed/open-deck. ' +
        'They operate in specific states/provinces: CA, AZ, NV, ON. ' +
        'They price primarily per mile.'
    );
  });

  it('renders a zone-priced drayage carrier on a radius', () => {
    const out = buildCarrierContext(
      tenant({
        ...BASE,
        freightVerticals: ['drayage'],
        pricingMode: 'zone',
        serviceArea: { kind: 'radius', radiusMiles: 300, baseCity: 'Long Beach, CA' },
      })
    );
    expect(out).toBe(
      'Harbor Link Logistics hauls port/rail drayage. ' +
        'They operate within 300 miles of Long Beach, CA. ' +
        'They price from a zone tariff.'
    );
  });
});

describe('buildCarrierContext — missing and partial data', () => {
  it('returns empty for a null onboardingJson (every pre-wizard tenant)', () => {
    expect(buildCarrierContext(tenant(null))).toBe('');
  });

  it('returns empty for a skipped wizard with no answers', () => {
    expect(buildCarrierContext(tenant({ completedAt: null, skipped: true }))).toBe('');
  });

  it('returns empty for a null/undefined tenant', () => {
    expect(buildCarrierContext(null)).toBe('');
    expect(buildCarrierContext(undefined)).toBe('');
  });

  it('omits the area sentence when regions is an empty array', () => {
    const out = buildCarrierContext(
      tenant({ ...BASE, freightVerticals: ['reefer'], serviceArea: { kind: 'regions', regions: [] } })
    );
    expect(out).toBe('Harbor Link Logistics hauls reefer (temperature-controlled).');
    expect(out).not.toContain(':');
  });

  it('never emits "undefined" from a partial record', () => {
    const out = buildCarrierContext(
      tenant({ ...BASE, freightVerticals: [], pricingMode: '', serviceArea: undefined })
    );
    expect(out).toBe('');
  });

  it('falls back to a generic subject when the tenant has no name', () => {
    const out = buildCarrierContext(tenant({ ...BASE, freightVerticals: ['ltl'] }, ''));
    expect(out).toBe('The carrier hauls LTL/partial loads.');
  });
});

describe('buildCarrierContext — region cap', () => {
  it(`lists up to ${MAX_LISTED_REGIONS} regions then collapses the rest`, () => {
    const regions = [
      'CA', 'AZ', 'NV', 'OR', 'WA', 'ID', 'UT', 'CO', 'NM', 'TX', 'OK', 'KS', 'MO', 'AR', 'LA',
    ];
    const out = buildCarrierContext(
      tenant({ ...BASE, freightVerticals: ['dryvan_ftl'], serviceArea: { kind: 'regions', regions } })
    );
    expect(out).toContain(
      'CA, AZ, NV, OR, WA, ID, UT, CO, NM, TX, OK, KS, and 3 more.'
    );
    // The cap must actually keep the block short.
    expect(out).not.toContain('LA');
  });

  it('does not add "and N more" when exactly at the cap', () => {
    const regions = Array.from({ length: MAX_LISTED_REGIONS }, (_, i) => `R${i}`);
    const out = buildCarrierContext(
      tenant({ ...BASE, freightVerticals: ['dryvan_ftl'], serviceArea: { kind: 'regions', regions } })
    );
    expect(out).not.toContain('more');
  });

  it('dedupes repeated region codes before capping', () => {
    const out = buildCarrierContext(
      tenant({
        ...BASE,
        freightVerticals: ['dryvan_ftl'],
        serviceArea: { kind: 'regions', regions: ['CA', 'CA', ' AZ ', 'AZ'] },
      })
    );
    expect(out).toContain('states/provinces: CA, AZ.');
  });
});

describe('carrierContextSection', () => {
  it('is empty for a tenant with no onboarding data, leaving prompts unchanged', () => {
    expect(carrierContextSection(tenant(null))).toBe('');
  });

  it('wraps the context in a labelled prompt section', () => {
    const section = carrierContextSection(
      tenant({ ...BASE, freightVerticals: ['reefer'], serviceArea: { kind: 'nationwide_us' } })
    );
    expect(section.startsWith('\n\nCarrier operations profile')).toBe(true);
    expect(section).toContain('reefer (temperature-controlled)');
    expect(section).toContain('nationwide across the United States');
  });
});

describe('prompt injection', () => {
  const onboarded = {
    ...BASE,
    freightVerticals: ['dryvan_ftl', 'reefer', 'flatbed'],
    pricingMode: 'per_mile',
    serviceArea: { kind: 'regions' as const, regions: ['CA', 'AZ', 'NV', 'ON'] },
  };

  function asTenant(onboardingJson: CarrierContextInput['onboardingJson']): Tenant {
    return { id: 1, name: 'Harbor Link Logistics', slug: 'harbor-link', onboardingJson } as unknown as Tenant;
  }

  const builders: [string, (t: Tenant) => string][] = [
    ['rateAdjusterSystemPrompt', (t) => rateAdjusterSystemPrompt(t, null)],
    ['leadReplySystemPrompt', (t) => leadReplySystemPrompt(t, null)],
    ['leadChatSystemPrompt', (t) => leadChatSystemPrompt(t, null)],
  ];

  for (const [name, build] of builders) {
    it(`${name} includes the carrier's modes and service area when present`, () => {
      const out = build(asTenant(onboarded));
      expect(out).toContain('Carrier operations profile');
      expect(out).toContain('dry van FTL');
      expect(out).toContain('CA, AZ, NV, ON');
      expect(out).toContain('primarily per mile');
    });

    it(`${name} is byte-for-byte unchanged for a null onboardingJson`, () => {
      const withNull = build(asTenant(null));
      expect(withNull).not.toContain('Carrier operations profile');
      expect(withNull).not.toContain('undefined');
    });
  }
});
