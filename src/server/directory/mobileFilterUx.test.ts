/**
 * Mobile filter UX on the faceted directory pages (hub / state / city / master
 * search all share renderFacetedResults, so ONE fixture covers all of them).
 *
 * The phone audit that motivated this (375×812) measured: a 112px dead band
 * between hero and search box, the rail unfolding ABOVE the button that opened
 * it (pushing the button 419px off-screen), a filled-but-uncheckmarked box with
 * no tap feedback, a 1.8–2.8s full navigation per facet, and the applied chips
 * landing under the sticky action bar. These tests pin the server-side half of
 * the fix: source order, partial response, toggle semantics, copy.
 *
 * Pure HTML render — no DB, no network.
 */
import { describe, it, expect } from 'vitest';
import { renderPortPage, renderStatePage, renderDirectoryResults, DIRECTORY_CSS } from './pages.js';
import { normalizeFilters, type FacetCounts, type CarrierListResult, type VisibleCarrier, type DirectorySummary } from './queries.js';
import { portGroupAsPort, portGroupByCode } from './containerPorts.js';

function carrier(overrides: Partial<VisibleCarrier> = {}): VisibleCarrier {
  return {
    slug: 'acme-drayage-inc-107080',
    legalName: 'ACME DRAYAGE INC',
    dbaName: null,
    usdot: '107080',
    mcNumber: 'MC012892',
    city: 'CHICAGO',
    state: 'IL',
    zip: '60601',
    phone: '3125550921',
    email: 'dispatch@acme.com',
    contactHidden: false,
    powerUnits: 25,
    drivers: 30,
    safetyRating: 'S',
    authorityType: 'common',
    intermodal: true,
    nearestPortCode: 'USCHI',
    aboutOverride: null,
    capabilities: {},
    provenance: { about: 'fmcsa', email: 'fmcsa', phone: 'fmcsa', hidden: 'fmcsa', capabilities: 'fmcsa' },
    ...overrides,
  } as VisibleCarrier;
}

const COUNTS = {
  fleet: { '1-25': 12 },
  drivers: {},
  equipment: { reefer: 3 },
  cargo: {},
  ports: {},
  goodStanding: 2,
  authorityActive: 2,
  intermodal: 2,
  recent: 0,
} as unknown as FacetCounts;

const SUMMARY: DirectorySummary = { total: 3, intermodalTotal: 2, states: 1, byState: [], byPort: [] };

function list(filters: ReturnType<typeof normalizeFilters>, total = 3): CarrierListResult {
  return {
    carriers: [carrier(), carrier({ slug: 'blue-line-88', usdot: '880880', legalName: 'BLUE LINE LOGISTICS' })],
    total,
    page: 1,
    perPage: 24,
    totalPages: 1,
    filters,
  };
}

const port = portGroupAsPort(portGroupByCode('USCHI')!);

function hub(opts: { partial?: boolean; query?: Record<string, string> } = {}): string {
  const filters = normalizeFilters(opts.query ?? { fleet: '1-25' }, { port: 'USCHI', state: null, citySlug: null });
  return renderPortPage({ port, list: list(filters), counts: COUNTS, filters, partial: opts.partial });
}

const idx = (html: string, needle: string): number => {
  const i = html.indexOf(needle);
  expect(i, `expected "${needle}" in HTML`).toBeGreaterThan(-1);
  return i;
};

describe('source order — the rail unfolds UNDER the Filters button', () => {
  const html = hub();

  it('renders head (search + toolbar) → rail → results, so on a phone the rail opens below the toggle', () => {
    const search = idx(html, 'class="dir-search"');
    const toolbar = idx(html, 'class="results-toolbar"');
    const toggle = idx(html, 'id="rail-toggle"');
    const rail = idx(html, 'class="dir-rail"');
    const grid = idx(html, 'class="dir-grid"');
    expect(search).toBeLessThan(toolbar);
    expect(toolbar).toBeLessThan(toggle);
    expect(toggle).toBeLessThan(rail);
    expect(rail).toBeLessThan(grid);
  });

  it('wraps the three regions as grid items the desktop CSS places explicitly', () => {
    expect(html).toContain('<div class="dir-head">');
    expect(html).toContain('<aside class="dir-rail" id="dir-rail">');
    expect(html).toContain('<div class="dir-results">');
    expect(DIRECTORY_CSS).toContain('.dir-rail { position: sticky; top: 16px; grid-column: 1; grid-row: 1 / 3; }');
    expect(DIRECTORY_CSS).toContain('.dir-results { grid-column: 2; grid-row: 2; min-width: 0; }');
  });

  it('applied chips are the FIRST row of the toolbar (above the count), so the active state is visible at once', () => {
    const toolbar = idx(html, 'class="results-toolbar"');
    const chips = idx(html, 'class="applied-chips"');
    const count = idx(html, 'carriers match');
    expect(chips).toBeGreaterThan(toolbar);
    expect(chips).toBeLessThan(count);
    expect(html).toContain('class="applied-clear"');
  });

  it('the toolbar is focusable (tabindex=-1) so focus can move to it after an in-page swap', () => {
    expect(html).toMatch(/<div class="results-toolbar"[^>]*tabindex="-1"/);
  });

  it('mobile spacing: zero grid gap + tightened hero/shell so the hero→search dead band collapses', () => {
    const mobile = DIRECTORY_CSS.slice(DIRECTORY_CSS.indexOf('@media (max-width: 900px)'));
    expect(mobile).toContain('.dir-layout { grid-template-columns: 1fr; grid-template-rows: none; gap: 0; }');
    expect(mobile).toContain('.dir-hero p.lead { margin-bottom: 12px; }');
    expect(mobile).toContain('.dir-shell { padding-top: 12px; }');
  });
});

describe('facet rows are real toggles', () => {
  const html = hub();

  it('every facet anchor carries aria-pressed reflecting its active state', () => {
    const rows = html.match(/<a class="facet-opt[^"]*" href="[^"]*"[^>]*>/g) ?? [];
    expect(rows.length).toBeGreaterThan(10);
    // Every row except the "All states & ports →" link (which is not a toggle)
    // must declare aria-pressed.
    for (const r of rows) expect(r).toMatch(/aria-pressed="(true|false)"/);
    expect(html).toMatch(/<a class="facet-opt active" href="[^"]*" aria-pressed="true"/);
    expect(html).toMatch(/<a class="facet-opt " href="[^"]*" aria-pressed="false"/);
  });

  it('multi-select facets (equipment/cargo) are flagged data-multi; single-choice ones are not', () => {
    const reefer = html.match(/<a class="facet-opt[^>]*>\s*<span class="lbl"><span class="facet-check"><\/span>Reefer/)?.[0] ?? '';
    expect(reefer).toContain('data-multi="1"');
    const fleet = html.match(/<a class="facet-opt[^>]*>\s*<span class="lbl"><span class="facet-check"><\/span>1–25 trucks/)?.[0]
      ?? html.match(/<a class="facet-opt[^>]*>\s*<span class="lbl"><span class="facet-check"><\/span>1-25 trucks/)?.[0]
      ?? '';
    expect(fleet).not.toContain('data-multi');
  });

  it('a checked box draws a real ✓ (CSS border-trick, theme token, no glyph)', () => {
    expect(DIRECTORY_CSS).toContain('.facet-opt.active .facet-check::after { content: \'\'; position: absolute;');
    expect(DIRECTORY_CSS).toContain('border: solid var(--accent-ink); border-width: 0 2px 2px 0; transform: rotate(45deg);');
    expect(DIRECTORY_CSS).toContain('.facet-opt.is-loading .cb::after');
  });

  it('the search hint no longer says "at left" (wrong on a phone)', () => {
    expect(html).toContain('Combine with the filters to narrow results.');
    expect(html).not.toContain('filters at left');
  });
});

describe('X-QF-Partial render — only the swappable block', () => {
  const full = hub();
  const partial = hub({ partial: true });

  it('the partial is the .dir-layout block with the new title + total as data-*', () => {
    expect(partial.startsWith('<div class="dir-layout" data-qf-partial="1" data-title="')).toBe(true);
    expect(partial).toContain(`data-total="3"`);
    expect(partial).toContain('data-title="Chicago');
    expect(partial).toContain('class="dir-results"');
    expect(partial).toContain('class="dir-rail"');
    expect(partial).toContain('class="results-toolbar"');
  });

  it('the partial carries no document chrome, hero, or scripts', () => {
    expect(partial).not.toContain('<html');
    expect(partial).not.toContain('<head');
    expect(partial).not.toContain('dir-hero');
    expect(partial).not.toContain('site-header');
    expect(partial).not.toContain('<script');
    expect(partial).not.toContain('application/ld+json');
  });

  it('the full page still has everything crawlers need (hero, JSON-LD, canonical) plus the nav script once', () => {
    expect(full).toContain('<html');
    expect(full).toContain('class="hero dir-hero"');
    expect(full).toContain('application/ld+json');
    expect(full).toContain('<link rel="canonical"');
    expect(full.match(/window\.__qfDirNav=\{go:go\}/g)?.length).toBe(1);
    // The scripts live OUTSIDE .dir-layout (the swapped block), so they survive a swap.
    const layoutEnd = full.indexOf('<script>', full.indexOf('<div class="dir-layout">'));
    expect(full.slice(full.indexOf('<div class="dir-layout">'), layoutEnd)).not.toContain('<script');
  });

  it('the partial and the full page share one inner block (they can never drift)', () => {
    const inner = partial.slice(partial.indexOf('>') + 1, partial.lastIndexOf('</div>'));
    expect(full).toContain(inner.trim().slice(0, 400));
  });

  it('the client fetches with the header AND a qf_partial=1 cache-key param, and swaps in place', () => {
    expect(full).toContain("headers:{'X-QF-Partial':'1'}");
    expect(full).toContain("p.searchParams.set('qf_partial','1')");
    expect(full).toContain("history.pushState({qf:1},'',url.pathname+url.search)");
    expect(full).toContain('root.innerHTML=next.innerHTML');
    expect(full).toContain("window.addEventListener('popstate'");
  });

  it('the rail toggle does not auto-collapse when the URL carries a facet or sessionStorage.qfRailOpen is 1', () => {
    expect(full).toContain("var STORE='qfRailOpen';");
    expect(full).toContain("function railWanted(){return read()==='1'||hasFacet(location.search);}");
    expect(full).toContain("if(open){e.r.removeAttribute('data-collapsed');e.t.setAttribute('aria-expanded','true');e.t.textContent='Hide filters \\u25B4';ensureGroupOpen();}");
  });

  it('after a swap the scroll target is the results toolbar under the sticky header — never page top', () => {
    expect(full).toContain('function scrollToToolbar(){var tb=document.querySelector(\'.results-toolbar\')');
    expect(full).toContain('window.pageYOffset-headerOffset()-8');
    // Desktop never jumps when the toolbar is already on screen (the rail would
    // move out from under the cursor); phones always land on the toolbar.
    expect(full).toContain('function scrollAfterSwap(){if(isMobile()||!toolbarInView())scrollToToolbar();}');
    expect(full).toContain('rebind(state);\n        scrollAfterSwap();');
  });
});

describe('sticky action bar on phones collapses to one row', () => {
  const html = hub();

  it('renders the ⋯ expand control and splits the count label so "carriers" can be dropped when collapsed', () => {
    expect(html).toContain('<button type="button" class="qf-ab-more" aria-expanded="false" aria-label="More actions">');
    expect(html).toContain('<span class="qf-ab-lblw">carriers</span> <span class="qf-ab-lbls">filtered</span>');
    expect(DIRECTORY_CSS).toContain('.qf-actionbar:not([data-expanded="1"]) { flex-direction: row; align-items: center; flex-wrap: nowrap; gap: 8px; padding: 8px 12px; min-height: 56px;');
    expect(DIRECTORY_CSS).toContain('body.qf-ab-open .qf-mc-fab { display: none; }');
    // Desktop unchanged: the control is hidden outside the phone breakpoint.
    expect(DIRECTORY_CSS).toContain('.qf-ab-more { display: none; }');
  });
});

describe('all three faceted page types share the template', () => {
  it('state page and master search render the same head → rail → results order and partial root', () => {
    const f = normalizeFilters({ fleet: '1-25' }, { state: 'TX', port: null, citySlug: null });
    const state = renderStatePage({
      state: { code: 'TX', slug: 'texas', name: 'Texas' } as never,
      list: list(f),
      counts: COUNTS,
      filters: f,
      cities: [],
      partial: true,
    });
    expect(state.startsWith('<div class="dir-layout" data-qf-partial="1"')).toBe(true);
    expect(state.indexOf('id="rail-toggle"')).toBeLessThan(state.indexOf('class="dir-rail"'));

    const g = normalizeFilters({ state: 'TX', equipment: 'reefer' });
    const all = renderDirectoryResults({ filters: g, list: list(g), counts: COUNTS, summary: SUMMARY });
    expect(all).toContain('<html');
    expect(all.indexOf('id="rail-toggle"')).toBeLessThan(all.indexOf('class="dir-rail"'));
    expect(all).toContain('Combine with the filters to narrow results.');
  });
});
