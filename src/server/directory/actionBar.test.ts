/**
 * Directory results ACTION BAR — the RFQ + Export bar wired to the pre-built
 * /directory/rfq and /directory/export/* routes.
 *
 * Covers:
 *   - actionBarLinks (the pure link builder): 0 selected → carry the current
 *     FILTER querystring; ≥1 selected → `?dots=…` (dots win over the filter);
 *   - renderDirectoryResults: every card gets an accessible selection checkbox,
 *     and the sticky bar renders the count + both CTAs with the no-JS default
 *     (filter-querystring) links + a live-update enhancement script.
 *
 * Pure HTML render — no DB, no network.
 */
import { describe, it, expect } from 'vitest';
import { actionBarLinks, renderDirectoryResults } from './pages.js';
import {
  normalizeFilters,
  type VisibleCarrier,
  type FacetCounts,
  type DirectorySummary,
  type CarrierListResult,
} from './queries.js';

// ─── actionBarLinks (pure) ─────────────────────────────────────────────────
describe('actionBarLinks — 0-vs-N selection logic', () => {
  it('0 selected → carries the current filter querystring on all four links', () => {
    const l = actionBarLinks({ filterQuery: 'state=TX&equipment=reefer' });
    expect(l.rfq).toBe('/directory/rfq?state=TX&equipment=reefer');
    expect(l.exportView).toBe('/directory/export/view?state=TX&equipment=reefer');
    expect(l.exportXlsx).toBe('/directory/export.xlsx?state=TX&equipment=reefer');
    expect(l.exportCsv).toBe('/directory/export.csv?state=TX&equipment=reefer');
  });

  it('≥1 selected → uses ?dots= (and dots take precedence over the filter)', () => {
    const l = actionBarLinks({ filterQuery: 'state=TX', dots: ['107080', '99999'] });
    expect(l.rfq).toBe('/directory/rfq?dots=107080,99999');
    expect(l.exportView).toBe('/directory/export/view?dots=107080,99999');
    expect(l.exportXlsx).toBe('/directory/export.xlsx?dots=107080,99999');
    expect(l.exportCsv).toBe('/directory/export.csv?dots=107080,99999');
  });

  it('no selection and no filter → bare route paths (still valid links)', () => {
    const l = actionBarLinks({});
    expect(l.rfq).toBe('/directory/rfq');
    expect(l.exportView).toBe('/directory/export/view');
  });

  it('drops empty/blank dots and encodes each dot', () => {
    const l = actionBarLinks({ dots: ['107080', '', '  ', '10 80'] });
    expect(l.rfq).toBe('/directory/rfq?dots=107080,10%2080');
  });
});

// ─── render fixtures ───────────────────────────────────────────────────────
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

// The sidebar reads counts[map][id] (undefined → "—") and counts.ports[code] ?? 0,
// so empty sub-maps are safe; only the scalar totals need real values.
const COUNTS = {
  fleet: {},
  drivers: {},
  equipment: {},
  cargo: {},
  ports: {},
  goodStanding: 2,
  authorityActive: 2,
  intermodal: 2,
  recent: 0,
} as unknown as FacetCounts;

const SUMMARY: DirectorySummary = {
  total: 3,
  intermodalTotal: 2,
  states: 1,
  byState: [],
  byPort: [],
};

function renderResults(): string {
  const filters = normalizeFilters({ state: 'TX', equipment: 'reefer' });
  const list: CarrierListResult = {
    carriers: [carrier(), carrier({ slug: 'blue-line-88', legalName: 'BLUE LINE LOGISTICS', usdot: '880880', intermodal: false })],
    // total (3) intentionally exceeds the 2 shown → the bar's default count must
    // be the FILTERED TOTAL, not the page's card count.
    total: 3,
    page: 1,
    perPage: 24,
    totalPages: 1,
    filters,
  };
  return renderDirectoryResults({ filters, list, counts: COUNTS, summary: SUMMARY });
}

// ─── renderDirectoryResults — checkboxes + action bar ──────────────────────
describe('renderDirectoryResults — selection + action bar', () => {
  const html = renderResults();

  it('adds an accessible selection checkbox (data-dot) to each carrier card', () => {
    expect(html).toContain('class="cc-cb" data-dot="107080"');
    expect(html).toContain('class="cc-cb" data-dot="880880"');
    expect(html).toContain('aria-label="Select ACME DRAYAGE INC to save, request rates or export"');
  });

  it('checkbox toggles WITHOUT navigating: label wraps the input (not the card <a>) + stops click propagation', () => {
    // The selection control is a <label> sibling of the card <a>, so a tap
    // toggles the checkbox and never reaches the card link. Both the label and
    // the input stop click propagation as belt-and-suspenders.
    expect(html).toContain('<label class="cc-check"');
    expect(html).toMatch(/<label class="cc-check"[^>]*onclick="event\.stopPropagation\(\)"/);
    expect(html).toMatch(/<input type="checkbox" class="cc-cb"[^>]*onclick="event\.stopPropagation\(\)"/);
    // The checkbox is NOT an anchor and carries no href — ticking it can't be a nav.
    const label = html.slice(html.indexOf('<label class="cc-check"'));
    const labelEnd = label.indexOf('</label>');
    expect(label.slice(0, labelEnd)).not.toContain('href');
    expect(label.slice(0, labelEnd)).not.toContain('<a ');
  });

  it('checkbox reads as a selection control (visible chip + grid legend explaining it)', () => {
    expect(html).toContain('class="cc-box"'); // bordered chip around the box
    expect(html).toContain('class="cc-legend"');
    expect(html).toContain("Tick a card's box to save");
  });

  it('renders a company-name search box wired to q, preserving active facets as hidden inputs', () => {
    expect(html).toContain('class="dir-search"');
    expect(html).toContain('name="q"');
    expect(html).toContain('type="search" id="dir-q"');
    // The active facets (state, equipment) ride along as hidden inputs so a search
    // AND-combines with them; `q` is NOT duplicated as a hidden input.
    expect(html).toContain('<input type="hidden" name="equipment" value="reefer">');
    expect(html).toMatch(/<input type="hidden" name="state" value="[^"]+">/);
    expect(html).not.toContain('<input type="hidden" name="q"');
  });

  it('renders the sticky action bar with the count + both CTAs', () => {
    expect(html).toContain('class="qf-actionbar"');
    // Labels carry mobile-shortenable spans (the full words hide at <=640px so
    // all three actions fit one compact row): "Request rates[ from]", "Export[ list]".
    expect(html).toContain('>Request rates<span class="qf-ab-rfqfull"> from</span>');
    expect(html).toContain('>Export<span class="qf-ab-exportfull"> list</span>');
    // Default count = filtered TOTAL (3), not the 2 shown cards.
    expect(html).toContain('data-total="3"');
    expect(html).toContain('<span class="qf-ab-rfqn">3</span>');
    // Total (3) is under the RFQ cap → no "of N" over-promise clause.
    expect(html).toContain('<span class="qf-ab-rfqof"></span>');
  });

  it('no-JS default links act on ALL filtered carriers (filter querystring, not dots)', () => {
    // Pull the filter querystring the server baked in, then assert every CTA
    // uses it verbatim (so the bar works before the enhancement script runs).
    const m = html.match(/data-filter-qs="([^"]*)"/);
    expect(m).toBeTruthy();
    const qs = (m as RegExpMatchArray)[1];
    expect(qs).toContain('equipment=reefer');
    expect(qs).toContain('state=');
    expect(qs).not.toContain('dots=');
    // Attribute value is HTML-escaped (& → &amp;); links use the same escaped form.
    expect(html).toContain(`href="/directory/rfq?${qs}"`);
    expect(html).toContain(`href="/directory/export/view?${qs}"`);
    expect(html).toContain(`href="/directory/export.xlsx?${qs}"`);
    expect(html).toContain(`href="/directory/export.csv?${qs}"`);
  });

  it('ships the progressive-enhancement script that swaps to ?dots= on selection', () => {
    expect(html).toContain("bar.setAttribute('data-mode',dots.length?'dots':'filter')");
    expect(html).toContain("'?dots='+dots.join(',')");
  });
});

// ─── D1 — unified filter+sort toolbar ──────────────────────────────────────
describe('renderDirectoryResults — filter + sort co-located in one toolbar (D1)', () => {
  const html = renderResults();

  it('renders a single results-toolbar containing BOTH the sort control and the count', () => {
    expect(html).toContain('class="results-toolbar"');
    const tb = html.slice(html.indexOf('class="results-toolbar"'));
    const end = tb.indexOf('class="dir-grid"'); // toolbar precedes the card grid
    const toolbar = tb.slice(0, end);
    expect(toolbar).toContain('class="sort-ctl"'); // sort lives INSIDE the toolbar
    expect(toolbar).toContain('carriers match'); // as does the result count
  });

  it('relocates the mobile "Filters" toggle INTO the toolbar (co-located with sort)', () => {
    // Exactly one rail-toggle button, and it sits inside the toolbar (not the aside).
    expect(html.match(/id="rail-toggle"/g)?.length).toBe(1);
    const tbStart = html.indexOf('class="results-toolbar"');
    const railIdx = html.indexOf('id="rail-toggle"');
    const gridIdx = html.indexOf('class="dir-grid"');
    expect(railIdx).toBeGreaterThan(tbStart);
    expect(railIdx).toBeLessThan(gridIdx);
  });

  it('folds the applied-filter chips into the toolbar (not a separate region)', () => {
    const tb = html.slice(html.indexOf('class="results-toolbar"'), html.indexOf('class="dir-grid"'));
    // state=TX is active in the fixture → a removable chip renders inside the toolbar.
    expect(tb).toContain('class="applied-chip"');
  });
});

// ─── D2 — multi-select save moved to the action bar ────────────────────────
describe('renderDirectoryResults — multi-select save in the action bar (D2)', () => {
  const html = renderResults();

  it('adds a "Save selected" button to the action bar', () => {
    expect(html).toContain('data-role="save-selected"');
    // "selected" is a mobile-hideable span (short label "Save (N)" on phones).
    expect(html).toContain('>Save<span class="qf-ab-savefull"> selected</span>');
    expect(html).toContain('class="qf-ab-saven"');
  });

  it('removes the redundant per-card save control from the results grid', () => {
    // The old per-card "Save to list" popover control is gone from the CARD grid
    // (the .qf-save-* CSS classes still exist for the profile page's single save).
    const grid = html.slice(html.indexOf('class="dir-grid"'), html.indexOf('class="qf-actionbar"'));
    expect(grid).not.toContain('qf-save');
    expect(grid).not.toContain('Save to list');
  });

  it('ships the save script wired to the batch API, with an empty-state modal path', () => {
    expect(html).toContain('/items/batch'); // batch save endpoint
    expect(html).toContain('carrierDots'); // posts the selected DOTs
    expect(html).toContain('function renderEmpty'); // 0-selected how-it-works modal
    expect(html).toContain('aria-modal'); // accessible dialog
    expect(html).toContain("e.key==='Escape'"); // keyboard-dismissible
  });
});

// ─── D4 — long facet lists fold ────────────────────────────────────────────
describe('renderDirectoryResults — long facet lists fold (D4)', () => {
  const html = renderResults();

  it('wraps the 13-option cargo facet in a Show-more fold (all rows still rendered)', () => {
    expect(html).toContain('id="fold-cargo"');
    expect(html).toContain('data-fold');
    expect(html).toContain('class="facet-more"');
    expect(html).toContain('data-fold-toggle');
    // All 13 cargo options are present in the HTML (crawlable / no-JS safe).
    expect(html).toContain('Household goods');
    expect(html).toContain('Building materials');
  });
});

// ─── renderDirectoryResults — RFQ button honours the send cap ──────────────
describe('renderDirectoryResults — RFQ CTA reflects the recipient cap', () => {
  function renderBig(): string {
    const filters = normalizeFilters({ state: 'TX' });
    const list: CarrierListResult = {
      // Only a couple of cards are on the page, but the FILTERED total (300) far
      // exceeds the default RFQ_MAX_RECIPIENTS (25) — the button must not promise
      // to email all 300.
      carriers: [carrier(), carrier({ slug: 'blue-line-88', usdot: '880880' })],
      total: 300,
      page: 1,
      perPage: 24,
      totalPages: 13,
      filters,
    };
    return renderDirectoryResults({ filters, list, counts: COUNTS, summary: SUMMARY });
  }
  const html = renderBig();

  it('caps the button count and shows "of N" when the total exceeds the cap', () => {
    expect(html).toContain('data-rfq-cap="25"');
    // Button promises only the 25 that actually get emailed…
    expect(html).toContain('<span class="qf-ab-rfqn">25</span>');
    expect(html).toContain('<span class="qf-ab-rfqof"> of 300</span>');
  });

  it('still surfaces the TRUE filtered total in the info count (not the cap)', () => {
    expect(html).toContain('data-total="300"');
    expect(html).toContain('<b class="qf-ab-n">300</b>');
    expect(html).toContain('carriers filtered');
  });
});

// ─── renderDirectoryResults — carrier-name search (q) ──────────────────────
describe('renderDirectoryResults — name search chip + input echo', () => {
  function renderWithQuery(): string {
    const filters = normalizeFilters({ q: 'harbor link' });
    const list: CarrierListResult = {
      carriers: [carrier({ legalName: 'HARBOR LINK LOGISTICS', usdot: '107080' })],
      total: 1,
      page: 1,
      perPage: 24,
      totalPages: 1,
      filters,
    };
    return renderDirectoryResults({ filters, list, counts: COUNTS, summary: SUMMARY });
  }
  const html = renderWithQuery();

  it('echoes the active query back into the search input value', () => {
    expect(html).toContain('name="q" class="dir-search-input" value="harbor link"');
  });

  it('renders a removable applied chip for the active name query', () => {
    expect(html).toContain('class="applied-chip"');
    expect(html).toContain('Name:');
    expect(html).toContain('harbor link');
  });
});
