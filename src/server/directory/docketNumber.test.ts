/**
 * Docket-number formatting — regression cover for the doubled "MC MC357193"
 * prefix that reached live carrier profiles.
 *
 * The stored-value cases below are the forms that ACTUALLY occur in
 * carrier_directory (measured: 4,983 rows "MC"+digits, 18 rows "FF"+digits,
 * zero bare, zero separated, zero untrimmed, zero null/empty); the rest guard
 * the hand-entered tenant path and the shapes a future feed drift could bring.
 */
import { describe, it, expect } from 'vitest';
import { docketParts, formatDocketNumber, canonicalDocketNumber } from './docketNumber.js';
import { normalizeMc } from './carrierIngest.js';
import { renderCarrierProfile, carrierCard } from './pages.js';
import { carrierToExportRow } from './exportSheet.js';
import { heroCarrierCard } from './queries.js';
import type { VisibleCarrier } from './queries.js';

describe('formatDocketNumber — stored forms that exist in the table', () => {
  it('prints a stored "MC"-prefixed docket exactly once', () => {
    // The live bug: "MC012892" rendered as "MC MC012892".
    expect(formatDocketNumber('MC012892')).toBe('MC 012892');
    expect(formatDocketNumber('MC357193')).toBe('MC 357193');
    expect(formatDocketNumber('MC365092')).toBe('MC 365092');
    expect(formatDocketNumber('MC268946')).toBe('MC 268946');
  });

  it('keeps an FF freight-forwarder docket on its own registry', () => {
    // 18 real rows. Re-prefixing these as "MC" would be a worse bug than the
    // doubled prefix: it asserts an operating authority the carrier lacks.
    expect(formatDocketNumber('FF003456')).toBe('FF 003456');
    expect(formatDocketNumber('MX1234')).toBe('MX 1234');
  });

  it('preserves leading zeros — they are part of the printed identifier', () => {
    expect(formatDocketNumber('MC012892')).toBe('MC 012892');
    expect(formatDocketNumber('012892')).toBe('MC 012892');
  });
});

describe('formatDocketNumber — hand-entered and drifted forms', () => {
  it('assumes MC for a bare number (what a human types in the account form)', () => {
    expect(formatDocketNumber('748213')).toBe('MC 748213');
    expect(formatDocketNumber('954120')).toBe('MC 954120');
  });

  it('tolerates any separator and case, and surrounding whitespace', () => {
    expect(formatDocketNumber('mc-012892')).toBe('MC 012892');
    expect(formatDocketNumber('Mc:012892')).toBe('MC 012892');
    expect(formatDocketNumber('mc_012892')).toBe('MC 012892');
    expect(formatDocketNumber('mc.012892')).toBe('MC 012892');
    expect(formatDocketNumber('  MC   012892  ')).toBe('MC 012892');
    expect(formatDocketNumber('\tff-3456\n')).toBe('FF 3456');
  });

  it('is idempotent — formatting an already-formatted value changes nothing', () => {
    expect(formatDocketNumber('MC 012892')).toBe('MC 012892');
    expect(formatDocketNumber(formatDocketNumber('MC012892'))).toBe('MC 012892');
    expect(formatDocketNumber(formatDocketNumber('FF003456'))).toBe('FF 003456');
  });
});

describe('formatDocketNumber — empty, prefix-only and junk', () => {
  it('returns null rather than a dangling "MC " when there is nothing to show', () => {
    for (const v of [null, undefined, '', '   ', '\t\n']) {
      expect(formatDocketNumber(v)).toBeNull();
    }
  });

  it('returns null for a prefix with no digits', () => {
    expect(formatDocketNumber('MC')).toBeNull();
    expect(formatDocketNumber('mc-')).toBeNull();
    expect(formatDocketNumber('FF ')).toBeNull();
    expect(formatDocketNumber('N/A')).toBeNull();
    expect(formatDocketNumber('none')).toBeNull();
  });

  it('never throws on a non-string', () => {
    expect(formatDocketNumber(12892)).toBe('MC 12892');
    expect(formatDocketNumber({})).toBeNull();
    expect(formatDocketNumber([])).toBeNull();
  });

  it('falls back to the operator text when a value holds digits but is not one docket', () => {
    // Better to show what was entered than to drop a real identifier or to
    // mislabel which registry it belongs to.
    expect(formatDocketNumber('MC12 / MC34')).toBe('MC12 / MC34');
  });
});

describe('docketParts', () => {
  it('splits registry from digits', () => {
    expect(docketParts('MC012892')).toEqual({ prefix: 'MC', digits: '012892' });
    expect(docketParts('ff-3456')).toEqual({ prefix: 'FF', digits: '3456' });
    expect(docketParts('012892')).toEqual({ prefix: 'MC', digits: '012892' });
    expect(docketParts('MC')).toBeNull();
    expect(docketParts('')).toBeNull();
  });
});

describe('canonicalDocketNumber / ingest write path', () => {
  it('is a no-op for the forms already stored — no migration churn', () => {
    expect(canonicalDocketNumber('MC012892')).toBe('MC012892');
    expect(canonicalDocketNumber('FF003456')).toBe('FF003456');
  });

  it('collapses a drifted feed value to the one storage shape', () => {
    expect(canonicalDocketNumber(' mc-012892 ')).toBe('MC012892');
    expect(canonicalDocketNumber('MC 012892')).toBe('MC012892');
  });

  it('the ingest normalizer keeps the registry prefix rather than baring it', () => {
    expect(normalizeMc('MC012892')).toBe('MC012892');
    expect(normalizeMc(' ff-3456 ')).toBe('FF3456');
    expect(normalizeMc('')).toBeNull();
    expect(normalizeMc(null)).toBeNull();
  });
});

// ── Render sites — the four that hand-rolled `MC ${…}` and produced the bug ──

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
    ...overrides,
  } as VisibleCarrier;
}

describe('no render site doubles the prefix', () => {
  it('profile header badge + subtitle print it once', () => {
    const html = renderCarrierProfile({ carrier: carrier() });
    expect(html).not.toContain('MC MC012892');
    const badges = html.slice(html.indexOf('class="cp-hbadges"'));
    expect(badges).toContain('MC 012892');
  });

  it('profile FMCSA grid prints it once', () => {
    const html = renderCarrierProfile({ carrier: carrier() });
    expect(html).toContain('MC / Docket');
    expect(html).not.toContain('>MC012892<');
  });

  it('carrier card id meta prints it once', () => {
    const html = carrierCard(carrier());
    expect(html).not.toContain('MC MC012892');
    expect(html).toContain('MC 012892');
  });

  it('hero card ids print it once', () => {
    const row = { mcNumber: 'MC357193', usdot: '801828', publicSlug: 's', legalName: 'X', dbaName: null } as never;
    expect(heroCarrierCard(row).ids).toBe('USDOT 801828 · MC 357193');
  });

  it('hero card still handles a bare stored value and a missing one', () => {
    const row = (mc: string | null) =>
      ({ mcNumber: mc, usdot: '2841196', publicSlug: 's', legalName: 'X', dbaName: null }) as never;
    expect(heroCarrierCard(row('954120')).ids).toBe('USDOT 2841196 · MC 954120');
    expect(heroCarrierCard(row(null)).ids).toBe('USDOT 2841196');
  });

  it('export sheet prints it once and keeps an FF registry', () => {
    expect(carrierToExportRow(carrier()).mc).toBe('MC 012892');
    expect(carrierToExportRow(carrier({ mcNumber: 'FF003456' })).mc).toBe('FF 003456');
  });

  it('an FF docket is never relabelled MC anywhere on the profile', () => {
    const html = renderCarrierProfile({ carrier: carrier({ mcNumber: 'FF003456' }) });
    expect(html).not.toContain('MC FF003456');
    expect(html).not.toContain('MC 003456');
    expect(html.slice(html.indexOf('class="cp-hbadges"'))).toContain('FF 003456');
  });

  it('structured data carries the real registry and bare digits, never a doubled prefix', () => {
    const html = renderCarrierProfile({ carrier: carrier({ mcNumber: 'FF003456' }) });
    expect(html).toContain('"propertyID":"FF","value":"003456"');
    const mc = renderCarrierProfile({ carrier: carrier() });
    expect(mc).toContain('"propertyID":"MC","value":"012892"');
  });

  it('a carrier with no docket renders no dangling "MC" badge', () => {
    // The FMCSA grid still shows its "MC / Docket" LABEL (value "—"); what must
    // not exist is a code badge or a subtitle segment holding a bare prefix.
    const html = renderCarrierProfile({ carrier: carrier({ mcNumber: null }) });
    expect(html).not.toMatch(/cp-hbadge--code">MC\s*</);
    expect(html).toContain('<span class="v">—</span>');
    expect(carrierCard(carrier({ mcNumber: null }))).not.toMatch(/·\s*MC\s*</);
  });

  it('a prefix-only stored value renders nothing, not a bare "MC"', () => {
    const html = renderCarrierProfile({ carrier: carrier({ mcNumber: 'MC' }) });
    expect(html).not.toMatch(/cp-hbadge--code">MC\s*</);
  });
});
