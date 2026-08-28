/**
 * Importer Search UI round 2 — the four additions, each proved at the seam the
 * UI actually reads.
 *
 * NO NETWORK. Everything runs off the committed fixture + the in-memory cache
 * double, so not a single ImportYeti / Hunter credit can be spent by this file.
 *
 *   R2-1  "Quote this lane" CTA   → the port → facet resolution behind its href
 *   R2-2  alias sub-line          → aliasCountsByCompany + the lead projection
 *   R2-3a audience switcher       → the control + [data-aud] rules are rendered
 *   R2-4a chart delta chip        → deltaChip sign / suppression
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  aliasCountsByCompany,
  dedupImporters,
  findImporterLeads,
  type BolRow,
} from './importerLeads.js';
import { renderImporterSearchPage, AUDIENCES } from './importerPages.js';
import {
  portCodeForEntryPort,
  portStateForEntryPort,
  quoteLaneHref,
} from './entryPortFacets.js';
import { deltaChip, aggregateProfile, renderImporterProfilePage } from './importerProfile.js';
import { FACET_QUERY_KEYS } from './queries.js';
import {
  FIXTURE_SEARCH_ROWS,
  FIXTURE_SEARCH_IMPORTERS,
  FIXTURE_PROFILE_ROWS,
  FIXTURE_PROFILE_SLUG,
  fixtureBolCache,
} from './importerFixture.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

// ── R2-1 ────────────────────────────────────────────────────────────────────
describe('R2-1 · entry port → RFQ facet (the CTA href)', () => {
  it('resolves a coded container gateway to its UN/LOCODE, whatever the state casing', () => {
    // ImportYeti's entry_port is free text: "Savannah, Ga." and "Savannah, GA"
    // are the same gateway and must both resolve.
    expect(portCodeForEntryPort('Savannah, Ga.')).toBe('USSAV');
    expect(portCodeForEntryPort('Savannah, GA')).toBe('USSAV');
    expect(portCodeForEntryPort('savannah')).toBe('USSAV');
    expect(portCodeForEntryPort('Charleston, S.C.')).toBe('USCHS');
    expect(portStateForEntryPort('Savannah, Ga.')).toBe('GA');
  });

  it('falls back to the port STATE for the four ports with no container code', () => {
    // These come from EXTRA_STATE_ENTRY_PORTS and carry no code by design.
    for (const [port, state] of [
      ['Brunswick, GA', 'GA'],
      ['Oakland, CA', 'CA'],
      ['Tacoma, WA', 'WA'],
      ['New York, NY', 'NY'],
    ] as const) {
      expect(portCodeForEntryPort(port)).toBeNull();
      expect(portStateForEntryPort(port)).toBe(state);
    }
  });

  it('resolves NOTHING for an unmappable port, so the card renders no CTA at all', () => {
    // A CTA with neither facet would 302 straight back to /directory — worse
    // than no CTA. Both lookups must come back null for the card to omit it.
    for (const junk of ['Unknown Inland Depot', '', null, undefined, 'Somewhere, ZZ']) {
      expect(portCodeForEntryPort(junk)).toBeNull();
      expect(portStateForEntryPort(junk)).toBeNull();
    }
  });

  it('emits facets the RFQ route actually recognises (else the link bounces)', () => {
    // GET /directory/rfq 302s to /directory unless hasAnyFacet() is true, and
    // hasAnyFacet only looks at FACET_QUERY_KEYS. Both branches must be in it.
    expect(FACET_QUERY_KEYS).toContain('port');
    expect(FACET_QUERY_KEYS).toContain('intermodal');
    expect(FACET_QUERY_KEYS).toContain('state');
  });

  it('builds a drayage-leg href: origin = the gateway, destination = delivery', () => {
    // The recipients are intermodal carriers AT the port, so the seeded move has
    // to be the leg they can actually price — not the DE→US ocean leg.
    const href = quoteLaneHref({
      entryPort: 'Savannah, Ga.',
      destinationState: 'NC',
      product: 'Saw blades & parts',
      hsCode: '820299',
    })!;
    const q = new URLSearchParams(href.split('?')[1]);
    expect(href.startsWith('/directory/rfq?')).toBe(true);
    expect(q.get('port')).toBe('USSAV');
    expect(q.get('intermodal')).toBe('1');
    expect(q.get('origin')).toBe('Savannah, Ga.');
    expect(q.get('destination')).toBe('NC');
    expect(q.get('commodity')).toBe('Saw blades & parts · HS 820299');
    expect(q.get('state')).toBeNull(); // port wins; never both
  });

  it('uses the state facet for an uncoded port and nothing at all for an unknown one', () => {
    const gaOnly = new URLSearchParams(
      quoteLaneHref({ entryPort: 'Brunswick, GA', destinationState: 'GA' })!.split('?')[1],
    );
    expect(gaOnly.get('state')).toBe('GA');
    expect(gaOnly.get('port')).toBeNull();
    expect(quoteLaneHref({ entryPort: 'Unknown Inland Depot' })).toBeNull();
    expect(quoteLaneHref({ entryPort: null })).toBeNull();
  });

  it('builds the CTA in the card renderer, gated on a resolvable facet', () => {
    const html = renderImporterSearchPage();
    expect(html).toContain('Quote this lane');
    // The guard that keeps a dead link off the card.
    expect(html).toContain('if(!l.quote_href) return null');
    // The redundant reveal chip is hidden (not removed) at phone width so the
    // footer is exactly two buttons — no orphan third.
    expect(html).toContain('.imp-foot-r a.imp-soon{display:none}');
  });

  it('makes the PROFILE’s identically-labelled button mean the same thing', () => {
    // It used to read "Quote this lane" and land on /tools — same words, no lane.
    const quota = { allowed: true, remaining: 3, limit: 5, signedIn: false } as never;
    const html = renderImporterProfilePage(
      aggregateProfile([...FIXTURE_PROFILE_ROWS], FIXTURE_PROFILE_SLUG),
      quota,
    );
    expect(html).toContain('Quote this lane');
    expect(html).toContain('/directory/rfq?port=USSAV&amp;intermodal=1');
    expect(html).not.toContain('href="/tools">Quote this lane');
  });
});

// ── R2-2 ────────────────────────────────────────────────────────────────────
describe('R2-2 · alias counts (sample-scoped, $0)', () => {
  const rows: BolRow[] = [
    { company_name: 'Acme Tool Corp', company_basename: 'Acme Tool Corp', company_address: '1 A St, Lincolnton, NC' },
    { company_name: 'Acme  Tool   Corp', company_basename: 'Acme Tool Corp', company_address: '1 a st, lincolnton, nc' },
    { company_name: 'ACME TOOL CORPORATION', company_basename: 'Acme Tool Corp', company_address: '2 B Ave, Charlotte, NC' },
    { company_name: 'Solo Importer Inc', company_basename: 'Solo Importer Inc', company_address: '9 C Rd, Buford, GA' },
    // must be excluded exactly as dedupImporters excludes them
    { company_name: 'Global Freight Logistics', company_basename: 'Global Freight Logistics', company_address: '3 D St' },
    { company_name: 'Hidden Co', company_basename: 'Hidden Co', company_manifest_confidentiality: true, company_address: '4 E St' },
  ];

  it('counts distinct spellings/addresses per importer, normalised like the profile', () => {
    const m = aliasCountsByCompany(rows);
    // "Acme Tool Corp" and "Acme  Tool   Corp" collapse (whitespace), and
    // "ACME TOOL CORPORATION" is a genuine second spelling → 2 names.
    expect(m.get('Acme Tool Corp')).toEqual({ names: 2, addresses: 2 });
    expect(m.get('Solo Importer Inc')).toEqual({ names: 1, addresses: 1 });
  });

  it('groups on the SAME key as dedupImporters and drops the same rows', () => {
    const m = aliasCountsByCompany(rows);
    const keys = dedupImporters(rows).map((r) => String(r.company_basename ?? r.company_name));
    expect([...m.keys()].sort()).toEqual(keys.sort());
    expect(m.has('Global Freight Logistics')).toBe(false); // forwarder
    expect(m.has('Hidden Co')).toBe(false); // confidential
  });

  it('attaches the counts to leads on the cache-only path, spending nothing', async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    const out = await findImporterLeads({
      filters: { entryPort: 'Savannah, GA' },
      bolCache: fixtureBolCache(),
      cacheKey: 'k',
    });
    expect(spy).not.toHaveBeenCalled();
    expect(out.leads.length).toBe(FIXTURE_SEARCH_IMPORTERS);
    const bosch = out.leads.find((l) => l.company === 'Robert Bosch Tool Corp')!;
    // The fixture files this importer under three spellings at two addresses.
    expect(bosch.alias_names).toBe(3);
    expect(bosch.alias_addresses).toBe(2);
    // An importer with a single bill must report 1/1 so the UI's >1 gate hides
    // the sub-line rather than printing "1 name".
    const solo = out.leads.find((l) => l.company === 'Komatsu America Corp')!;
    expect(solo.alias_names).toBe(1);
    expect(solo.alias_addresses).toBe(1);
  });

  it('never claims more than the profile would: counts come only from pulled rows', () => {
    // The whole honesty constraint in one assertion — a company can never show
    // more distinct names than there are bills for it in the sample.
    const m = aliasCountsByCompany(FIXTURE_SEARCH_ROWS);
    for (const [key, v] of m) {
      const bills = FIXTURE_SEARCH_ROWS.filter(
        (r) => (r.company_basename ?? r.company_name) === key,
      ).length;
      expect(v.names).toBeLessThanOrEqual(bills);
      expect(v.addresses).toBeLessThanOrEqual(bills);
    }
  });

  it('gates the sub-line on >1 and labels it as sample-scoped', () => {
    const html = renderImporterSearchPage();
    expect(html).toContain('if(nm<2 && ad<2) return \'\'');
    expect(html).toContain('Also under ');
    expect(html).toContain('in this search sample');
  });
});

// ── R2-3a ───────────────────────────────────────────────────────────────────
describe('R2-3a · audience switcher', () => {
  it('renders exactly the four seats as an aria-pressed segmented group', () => {
    const html = renderImporterSearchPage();
    expect(AUDIENCES.map(([id]) => id)).toEqual(['trucker', 'broker', 'forwarder', 'supplier']);
    for (const [id, label] of AUDIENCES) {
      expect(html).toContain(`id="imp-aud-${id}"`);
      expect(html).toContain(`>${label}</button>`);
    }
    expect(html).toContain('aria-label="Show results for"');
  });

  it('re-weights via CSS/attribute only — no fetch on the switch path', () => {
    const html = renderImporterSearchPage();
    expect(html).toContain('.imp-results[data-aud="trucker"]');
    expect(html).toContain('.imp-results[data-aud="broker"]');
    expect(html).toContain('.imp-results[data-aud="forwarder"]');
    expect(html).toContain('.imp-results[data-aud="supplier"]');
    // The click handler must only set an attribute + persist; if it ever grew a
    // fetch, switching seats would start costing credits.
    const handler = html.slice(html.indexOf('function applyAudience()'), html.indexOf('applyAudience();\n'));
    expect(handler).not.toContain('fetch(');
    expect(html).toContain("ls('qf_imp_aud'");
  });

  it('selects with a tint + outline, never a bright fill (hard UI rule)', () => {
    const html = renderImporterSearchPage();
    expect(html).toContain(
      '.imp-aud button[aria-pressed="true"]{background:color-mix(in srgb,var(--accent) 12%,transparent)',
    );
  });

  it('pairs the four buttons 2x2 on a phone rather than 3+1', () => {
    const html = renderImporterSearchPage();
    expect(html).toContain('.imp-aud{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))');
  });
});

// ── R2-4a ───────────────────────────────────────────────────────────────────
describe('R2-4a · 6-mo vs prior-6-mo delta chip', () => {
  const series = (counts: number[]) =>
    counts.map((count, i) => ({ key: `m${i}`, label: `M${i}`, count }));

  it('reads UP on a rising series and DOWN on a falling one', () => {
    const rising = series([1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2]); // 6 → 12
    expect(deltaChip(rising)).toContain('&#9650;'); // ▲
    expect(deltaChip(rising)).toContain('100%');
    expect(deltaChip(rising)).toContain('impp-delta up');

    const falling = series([...[2, 2, 2, 2, 2, 2], ...[1, 1, 1, 1, 1, 1]]); // 12 → 6
    expect(deltaChip(falling)).toContain('&#9660;'); // ▼
    expect(deltaChip(falling)).toContain('50%');
    expect(deltaChip(falling)).toContain('impp-delta down');
  });

  it('reads level when both halves match, with no percentage', () => {
    const flat = deltaChip(series([3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3]));
    expect(flat).toContain('impp-delta flat');
    expect(flat).not.toMatch(/\d+%/);
  });

  it('is suppressed below 12 months rather than showing a misleading number', () => {
    // The profile fixture is ~7 months; a 6+6 split would be half-empty.
    expect(deltaChip(series([1, 2, 3, 4, 5, 6, 7]))).toBe('');
    expect(deltaChip([])).toBe('');
  });

  it('is suppressed when the prior half is empty (no percentage against zero)', () => {
    expect(deltaChip(series([0, 0, 0, 0, 0, 0, 5, 5, 5, 5, 5, 5]))).toBe('');
  });

  it('compares the last 6 against the 6 BEFORE them, ignoring older months', () => {
    // An 18-month window: only months 7-12 and 13-18 may be read. If the
    // implementation drifted to 12+12 it would pull in the truncated head.
    const withNoisyHead = series([99, 99, 99, 99, 99, 99, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2]);
    expect(deltaChip(withNoisyHead)).toContain('100%');
    expect(deltaChip(withNoisyHead)).toContain('up');
  });
});
