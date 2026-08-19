/**
 * Carrier-card OVERRIDE MERGE + PROVENANCE (Phase-2 foundation).
 *
 * `mergeCarrierOverride` is the ONLY place a `carrier_overrides` row re-enters a
 * carrier card, and it is PURE (no DB/network), so these tests pin its exact
 * merge + provenance semantics:
 *   - non-null overrides win over the FMCSA value and stamp provenance 'admin';
 *   - a null / blank override leaves the FMCSA value + 'fmcsa' provenance;
 *   - `hidden` OR's with the FMCSA opt-out (can hide, cannot un-hide);
 *   - capabilities flip self-declared flags.
 *
 * The RE-INGEST SURVIVAL test proves the core contract: the FMCSA re-ingest
 * rewrites the carrier_directory row (a new FMCSA base), but re-applying the
 * SAME override still shows the edited values — because overrides live in a
 * separate table the ingest upsert (CARRIER_UPSERT_SET) never references.
 */
import { describe, it, expect } from 'vitest';
import { mergeCarrierOverride, type VisibleCarrier } from './queries.js';
import { CARRIER_UPSERT_SET } from './carrierIngest.js';
import type { CarrierOverrideRow } from '../../db/schema.js';

function base(overrides: Partial<VisibleCarrier> = {}): VisibleCarrier {
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

function override(o: Partial<CarrierOverrideRow> = {}): CarrierOverrideRow {
  return {
    usdot: '107080',
    aboutOverride: null,
    emailOverride: null,
    phoneOverride: null,
    hidden: null,
    capabilities: null,
    updatedAt: new Date('2026-08-19T00:00:00Z'),
    updatedBy: 'admin@quotefleet.net',
    ...o,
  };
}

describe('mergeCarrierOverride', () => {
  it('returns the base unchanged (all FMCSA provenance) when there is no override', () => {
    const b = base();
    const out = mergeCarrierOverride(b, null);
    expect(out).toBe(b); // same reference — no allocation on the no-override path
    expect(out.provenance).toEqual({ about: 'fmcsa', email: 'fmcsa', phone: 'fmcsa', hidden: 'fmcsa', capabilities: 'fmcsa' });
  });

  it('applies about/email/phone overrides and stamps their provenance as admin', () => {
    const out = mergeCarrierOverride(
      base(),
      override({ aboutOverride: 'Hand-written blurb.', emailOverride: 'ops@acme.com', phoneOverride: '9990001111' }),
    );
    expect(out.aboutOverride).toBe('Hand-written blurb.');
    expect(out.email).toBe('ops@acme.com');
    expect(out.phone).toBe('9990001111');
    expect(out.provenance.about).toBe('admin');
    expect(out.provenance.email).toBe('admin');
    expect(out.provenance.phone).toBe('admin');
    // Untouched fields keep FMCSA provenance.
    expect(out.provenance.hidden).toBe('fmcsa');
    expect(out.legalName).toBe('ACME DRAYAGE INC');
  });

  it('treats a blank/whitespace override as no override (keeps FMCSA value + provenance)', () => {
    const out = mergeCarrierOverride(base(), override({ aboutOverride: '   ', emailOverride: '' }));
    expect(out.aboutOverride).toBeNull();
    expect(out.email).toBe('dispatch@acme.com');
    expect(out.provenance.about).toBe('fmcsa');
    expect(out.provenance.email).toBe('fmcsa');
  });

  it('hidden=true hides contact (provenance admin)', () => {
    const out = mergeCarrierOverride(base({ contactHidden: false }), override({ hidden: true }));
    expect(out.contactHidden).toBe(true);
    expect(out.provenance.hidden).toBe('admin');
  });

  it('hidden=false / null never UN-hides an FMCSA opt-out', () => {
    expect(mergeCarrierOverride(base({ contactHidden: true }), override({ hidden: false })).contactHidden).toBe(true);
    expect(mergeCarrierOverride(base({ contactHidden: true }), override({ hidden: null })).contactHidden).toBe(true);
  });

  it('flips self-declared capability flags and stamps capabilities provenance', () => {
    const out = mergeCarrierOverride(base(), override({ capabilities: { uiia: true, twic: true } }));
    expect(out.capabilities).toEqual({ uiia: true, twic: true });
    expect(out.provenance.capabilities).toBe('admin');
  });

  it('all-false capabilities do not claim admin provenance', () => {
    const out = mergeCarrierOverride(base(), override({ capabilities: { uiia: false } }));
    expect(out.provenance.capabilities).toBe('fmcsa');
  });

  it('does not mutate the base card (no aliasing of the shared FMCSA provenance default)', () => {
    const b = base();
    mergeCarrierOverride(b, override({ aboutOverride: 'x', hidden: true, capabilities: { reefer: true } }));
    expect(b.aboutOverride).toBeNull();
    expect(b.contactHidden).toBe(false);
    expect(b.capabilities).toEqual({});
    expect(b.provenance).toEqual({ about: 'fmcsa', email: 'fmcsa', phone: 'fmcsa', hidden: 'fmcsa', capabilities: 'fmcsa' });
  });

  it('SURVIVES a re-ingest: a new FMCSA base + the SAME override still shows the edited values', () => {
    const ov = override({ aboutOverride: 'Carrier-curated summary.', phoneOverride: '8005551234' });

    // v1 FMCSA row + override.
    const merged1 = mergeCarrierOverride(base({ phone: '9125550921' }), ov);
    expect(merged1.phone).toBe('8005551234');
    expect(merged1.aboutOverride).toBe('Carrier-curated summary.');

    // Nightly re-ingest rewrote carrier_directory: phone + name changed on the
    // FMCSA base. Overrides live in carrier_overrides which the ingest never
    // touches, so re-applying the SAME override still wins.
    const merged2 = mergeCarrierOverride(base({ phone: '1112223333', legalName: 'ACME DRAYAGE LLC' }), ov);
    expect(merged2.phone).toBe('8005551234'); // override, not the re-ingested FMCSA phone
    expect(merged2.aboutOverride).toBe('Carrier-curated summary.');
    expect(merged2.legalName).toBe('ACME DRAYAGE LLC'); // non-overridden field DOES track the re-ingest
  });

  it('the FMCSA ingest upsert set never references any override column (overrides cannot be clobbered)', () => {
    const keys = Object.keys(CARRIER_UPSERT_SET);
    for (const forbidden of ['aboutOverride', 'emailOverride', 'phoneOverride', 'hidden', 'capabilities', 'contactHidden']) {
      expect(keys).not.toContain(forbidden);
    }
  });
});
