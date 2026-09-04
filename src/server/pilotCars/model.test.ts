/**
 * The record's shape — the rules that make this directory different from the
 * two that already exist, asserted rather than described.
 */
import { describe, it, expect } from 'vitest';
import {
  SubmissionSchema,
  certifiedStatesFrom,
  escortDirectoryHref,
  filtersToQuery,
  hasAnyFilter,
  hashManageToken,
  newManageToken,
  parseFilters,
  slugify,
  toPublicOperator,
  VERIFICATION_LABEL,
  VERIFICATION_TIERS,
  type OperatorRow,
} from './model.js';

const GOOD = {
  businessName: 'Blue Ridge Pilot Cars',
  email: 'DISPATCH@Example.com',
  statesCovered: ['nc', 'va', 'tn'],
  certifications: [
    { state: 'NC', status: 'certified', expiresOn: '2027-01-01' },
    { state: 'VA', status: 'certified', expiresOn: '2020-01-01' },
    { state: 'TN', status: 'not-required' },
  ],
  publishPhone: true,
  phone: '+1 555 0100',
  consentPublicListing: true,
};

describe('opt-in is structural, not a checkbox we happen to look at', () => {
  it('refuses a submission without consent', () => {
    const r = SubmissionSchema.safeParse({ ...GOOD, consentPublicListing: false });
    expect(r.success).toBe(false);
  });

  it('refuses a submission with consent MISSING, not just false', () => {
    const { consentPublicListing: _drop, ...rest } = GOOD;
    expect(SubmissionSchema.safeParse(rest).success).toBe(false);
  });

  it('accepts a consented submission and normalises the state codes and email', () => {
    const r = SubmissionSchema.safeParse(GOOD);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.statesCovered).toEqual(['NC', 'VA', 'TN']);
    expect(r.data.email).toBe('dispatch@example.com');
  });
});

describe('a submission body can NEVER promote its own record', () => {
  it('has no verification, status or moderation field in the schema at all', () => {
    const r = SubmissionSchema.safeParse({
      ...GOOD,
      verificationTier: 'registry-verified',
      listingStatus: 'published',
      verifiedOn: '2026-01-01',
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    // The keys are stripped, not honoured. Nothing downstream can read them.
    expect(Object.keys(r.data)).not.toContain('verificationTier');
    expect(Object.keys(r.data)).not.toContain('listingStatus');
    expect(Object.keys(r.data)).not.toContain('verifiedOn');
  });

  it('the weakest tier is the first one, so a default can only ever be the weakest', () => {
    expect(VERIFICATION_TIERS[0]).toBe('self-asserted');
  });

  it('every tier label says who said it — none of them reads as an endorsement', () => {
    expect(VERIFICATION_LABEL['self-asserted'].meaning).toMatch(/has not checked/i);
    expect(VERIFICATION_LABEL['document-on-file'].meaning).toMatch(/not the issuer/i);
    expect(VERIFICATION_LABEL['registry-verified'].meaning).toMatch(/register/i);
    for (const t of VERIFICATION_TIERS) {
      expect(VERIFICATION_LABEL[t].label.toLowerCase(), t).not.toMatch(/approved|trusted|vetted/);
    }
  });
});

describe('a listing must be reachable, and only in the ways the operator ticked', () => {
  it('refuses a listing that publishes neither phone nor email', () => {
    const r = SubmissionSchema.safeParse({ ...GOOD, publishPhone: false, publishEmail: false });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(JSON.stringify(r.error.issues)).toMatch(/nobody can book you/);
  });

  it('refuses a pole height with no pole', () => {
    const r = SubmissionSchema.safeParse({ ...GOOD, hasHeightPole: false, heightPoleMaxIn: 180 });
    expect(r.success).toBe(false);
  });

  it('refuses a reciprocity claim with no issuing state', () => {
    const r = SubmissionSchema.safeParse({
      ...GOOD,
      certifications: [{ state: 'GA', status: 'reciprocity' }],
    });
    expect(r.success).toBe(false);
  });
});

describe('certification is per state, and expiry is enforced not decorated', () => {
  it('drops a lapsed certificate from the filterable set, and keeps a live one', () => {
    const certs = SubmissionSchema.parse(GOOD).certifications;
    expect(certifiedStatesFrom(certs, '2026-09-04')).toEqual(['NC']);
  });

  it('a certificate with NO expiry stays filterable — absence is not expiry', () => {
    expect(certifiedStatesFrom([{ state: 'WA', status: 'certified' }], '2026-09-04')).toEqual(['WA']);
  });

  it('a RECIPROCITY claim never satisfies a "certified in" filter', () => {
    // Whether a card travels is the working state's call. Oklahoma publishes no
    // reciprocal list at all, so treating the operator's belief as a fact would
    // put them on a job they may not lawfully take.
    const out = certifiedStatesFrom(
      [{ state: 'OK', status: 'reciprocity', issuedByState: 'GA' }],
      '2026-09-04',
    );
    expect(out).toEqual([]);
  });
});

// ── The projection ─────────────────────────────────────────────────────────

function row(overrides: Partial<OperatorRow> = {}): OperatorRow {
  return {
    public_slug: 'blue-ridge-pilot-cars-nc',
    business_name: 'Blue Ridge Pilot Cars',
    contact_name: 'Dana Mercer',
    email: 'dispatch@example.com',
    phone: '+1 555 0100',
    website: null,
    home_base_city: 'Asheville',
    home_base_state: 'NC',
    service_radius_mi: 400,
    states_covered: ['NC', 'VA'],
    certified_states: ['NC'],
    certifications_json: [{ state: 'NC', status: 'certified', expiresOn: '2020-02-02' }],
    reciprocity_claimed_states: [],
    languages: [],
    has_height_pole: true,
    height_pole_max_in: 186,
    has_oversize_signs: true,
    has_flags: false,
    has_amber_light_bar: true,
    has_two_way_radio: true,
    vehicle_class: 'pickup-full-size',
    vehicle_gvwr_lbs: 9_900,
    takes_superloads: false,
    takes_night_moves: false,
    insurance_liability_usd: 1_000_000,
    insurance_expires_on: '2020-05-05',
    verification_tier: 'self-asserted',
    verification_note: null,
    verification_source_url: null,
    verified_on: null,
    publish_email: false,
    publish_phone: true,
    publish_contact_name: false,
    listing_status: 'published',
    updated_at: '2026-09-01T00:00:00.000Z',
    last_confirmed_at: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('the public projection is the ONLY gate on personal data', () => {
  it('nulls every contact field the operator did not tick', () => {
    const op = toPublicOperator(row(), '2026-09-04');
    expect(op.phone).toBe('+1 555 0100');
    expect(op.email).toBeNull();
    expect(op.contactName).toBeNull();
  });

  it('returns null rather than omitting the key, so a caller cannot coalesce past it', () => {
    const op = toPublicOperator(row(), '2026-09-04');
    expect(Object.prototype.hasOwnProperty.call(op, 'email')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(op, 'contactName')).toBe(true);
  });

  it('marks a lapsed certificate and a lapsed policy as lapsed, rather than hiding either', () => {
    const op = toPublicOperator(row(), '2026-09-04');
    expect(op.certifications[0]?.expired).toBe(true);
    expect(op.insuranceExpired).toBe(true);
  });

  it('carries the STATE\'s own requirement beside the operator\'s claim', () => {
    const op = toPublicOperator(row(), '2026-09-04');
    expect(op.certifications[0]?.stateRequirement).toBe('required');
  });

  it('survives jsonb arriving as a string, which is how some drivers return it', () => {
    const op = toPublicOperator(
      row({ states_covered: '["NC","VA"]', certifications_json: '[]' }),
      '2026-09-04',
    );
    expect(op.statesCovered).toEqual(['NC', 'VA']);
    expect(op.certifications).toEqual([]);
  });

  it('falls back to the WEAKEST tier for an unrecognised stored value', () => {
    const op = toPublicOperator(row({ verification_tier: 'super-verified' }), '2026-09-04');
    expect(op.verificationTier).toBe('self-asserted');
  });
});

// ── Tokens and slugs ───────────────────────────────────────────────────────

describe('the manage token is a bearer secret we cannot read back', () => {
  it('stores only a hash, and the hash is not the token', () => {
    const t = newManageToken();
    expect(t.length).toBeGreaterThan(30);
    expect(hashManageToken(t)).toHaveLength(64);
    expect(hashManageToken(t)).not.toContain(t);
  });

  it('is stable for one token and different for another', () => {
    const a = newManageToken();
    expect(hashManageToken(a)).toBe(hashManageToken(a));
    expect(hashManageToken(a)).not.toBe(hashManageToken(newManageToken()));
  });
});

describe('slugs', () => {
  it('builds a readable, state-qualified slug', () => {
    expect(slugify('Blue Ridge Pilot Cars', 'NC')).toBe('blue-ridge-pilot-cars-nc');
  });
  it('never produces an empty slug', () => {
    expect(slugify('!!!', null)).toBe('operator');
  });
});

// ── Filters ────────────────────────────────────────────────────────────────

describe('filters read columns, never prose', () => {
  it('parses a lane into an AND over states', () => {
    const f = parseFilters({ states: 'tx,ar,tn' });
    expect(f.states).toEqual(['TX', 'AR', 'TN']);
    expect(hasAnyFilter(f)).toBe(true);
  });

  it('silently drops a junk value rather than erroring a shared link', () => {
    const f = parseFilters({ states: 'ZZ,tx', equip: 'teleporter,heightPole', tier: 'gold' });
    expect(f.states).toEqual(['TX']);
    expect(f.equipment).toEqual(['heightPole']);
    expect(f.minTier).toBeNull();
  });

  it('round-trips through a canonical query string', () => {
    const f = parseFilters({ states: 'KY,TN', certin: 'KY', equip: 'heightPole', maxgvwr: '17999' });
    expect(parseFilters(Object.fromEntries(new URLSearchParams(filtersToQuery(f).slice(1))))).toEqual(f);
  });

  it('parses BOTH URL shapes the page emits — repeated params and a comma list', () => {
    // A native <select multiple> posts one parameter per option; the canonical
    // links this module builds use the comma form because it survives a paste
    // into an email. Both are live URLs for this page.
    const repeated = parseFilters({ states: ['KY', 'TN'], equip: ['heightPole', 'flags'] });
    const comma = parseFilters({ states: 'KY,TN', equip: 'heightPole,flags' });
    expect(repeated).toEqual(comma);
    expect(repeated.states).toEqual(['KY', 'TN']);
    expect(repeated.equipment).toEqual(['heightPole', 'flags']);
  });

  it('survives a nested value without emitting "[object Object]" as a state', () => {
    // `qs` produces this for `?states[a]=KY`. Relying on Array.toString would
    // stringify the object into the list instead of dropping it.
    expect(parseFilters({ states: [{ a: 'KY' }, 'TN'] as unknown as string[] }).states).toEqual(['TN']);
  });

  it('an unfiltered query is not "filtered by nothing"', () => {
    expect(hasAnyFilter(parseFilters({}))).toBe(false);
  });
});

describe('the deep link the quote tools emit', () => {
  it('pre-filters on the lane AND on only the states that actually certify', () => {
    // KY certifies nobody, so `certin=KY` would return zero operators forever.
    const href = escortDirectoryHref(['KY', 'WA', 'TN']);
    expect(href).toContain('states=KY%2CWA%2CTN');
    expect(href).toContain('certin=WA');
    expect(href).not.toMatch(/certin=[^&]*KY/);
    expect(href).not.toMatch(/certin=[^&]*TN/);
  });

  it('emits no certin at all when no state on the lane certifies', () => {
    expect(escortDirectoryHref(['KY', 'TN', 'IL'])).toBe('/pilot-cars?states=KY%2CTN%2CIL');
  });

  it('drops a code that is not a state rather than passing it through', () => {
    expect(escortDirectoryHref(['ZZ'])).toBe('/pilot-cars');
  });
});
