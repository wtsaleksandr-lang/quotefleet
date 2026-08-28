/**
 * Importer Search UI round 3 — structure, layout, usability, functionality.
 *
 * NO NETWORK. Everything renders from the committed fixture, so not a single
 * ImportYeti / Hunter credit can be spent by this file.
 *
 *   R3-1  title-in-field        → every filter keeps its name once it has a value
 *   R3-2  sort control          → the control exists and its orders are declared
 *   R3-3  applied-filter chips  → the results-level filter bar is rendered
 *   R3-4  result-count sentence → total / of / provenance / order are all spoken
 *   R3-5  card footer zones     → three addressable zones, tier note outside them
 *   R3-6  profile section bar   → jump nav + expand-all exist below 1320px
 *   R3-7  chart keyboard access → roving tabindex + per-bar aria-label
 *   R3-8  chart x-axis density  → a long series gets more than three ticks
 *   R3-9  bar rows show a share → the printed figure matches the caption's claim
 */
import { describe, it, expect } from 'vitest';
import { renderImporterSearchPage, SORTS } from './importerPages.js';
import { aggregateProfile, renderImporterProfilePage, anonRevealState, BAR_MIN_PCT } from './importerProfile.js';
import { FIXTURE_PROFILE_ROWS, FIXTURE_PROFILE_SLUG } from './importerFixture.js';

const search = renderImporterSearchPage();

const quota = { allowed: true, used: 2, remaining: 3, limit: 5, signedIn: false } as const;

/** An 18-month rising series, so the long-series chart branches are exercised. */
function syntheticMonths(counts: number[]) {
  const rows: (typeof FIXTURE_PROFILE_ROWS)[number][] = [];
  const now = new Date(2026, 6, 15);
  counts.forEach((c, idx) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (counts.length - 1 - idx), 10);
    for (let k = 0; k < c; k++) {
      rows.push({
        ...FIXTURE_PROFILE_ROWS[k % FIXTURE_PROFILE_ROWS.length],
        arrival_date: `${String(d.getMonth() + 1).padStart(2, '0')}/10/${d.getFullYear()}`,
        bol_number: `SYN${idx}_${k}`,
      });
    }
  });
  return rows;
}

const longProfile = aggregateProfile(
  syntheticMonths([2, 3, 2, 4, 3, 2, 5, 4, 3, 6, 5, 4, 7, 6, 8, 9, 7, 10]),
  FIXTURE_PROFILE_SLUG,
);
const profileHtml = renderImporterProfilePage(longProfile, quota, anonRevealState());

describe('R3-1 · title-in-field on every filter', () => {
  it('renders a persistent in-field caption for each of the three primary filters', () => {
    for (const label of ['Entry port', 'Entry state', 'Commodity / HS code']) {
      expect(search).toContain(`<span class="imp-cap" aria-hidden="true">${label}</span>`);
    }
  });

  it('keeps the caption out of the accessibility tree — aria-label already names the field', () => {
    // Duplicating the name would make a screen reader say it twice.
    const caps = search.match(/<span class="imp-cap"[^>]*>/g) ?? [];
    expect(caps.length).toBeGreaterThanOrEqual(4);
    expect(caps.every((c) => c.includes('aria-hidden="true"'))).toBe(true);
  });

  it('still carries the accessible name on the input itself', () => {
    expect(search).toContain('aria-label="Entry port"');
    expect(search).toContain('aria-label="Commodity / HS code"');
  });

  it('gives the caption room inside the box instead of overlapping the value', () => {
    // The caption is absolutely positioned at the top of the field, so the
    // control needs matching top padding or the value renders underneath it.
    expect(search).toMatch(/\.imp-capfield input,\.imp-capfield select\{padding:21px 12px 7px/);
  });
});

describe('R3-2 · sort control', () => {
  it('declares the orders a broker actually re-ranks by', () => {
    expect(SORTS.map(([v]) => v)).toEqual(['ships', 'total', 'teu', 'recent', 'win', 'company']);
  });

  it('defaults to the order the server already returns, so the label is honest', () => {
    // runSearch re-ranks by 12-month shipments before the page ever sees the
    // list; anything else as the default would mislabel an unsorted list.
    expect(SORTS[0][0]).toBe('ships');
  });

  it('renders the select with every order as an option', () => {
    // R4 added a scope title to the control; assert the control, not its attributes.
    expect(search).toMatch(/<select id="imp-sort"[^>]*>/);
    for (const [value, label] of SORTS) {
      expect(search).toContain(`<option value="${value}">`);
      expect(search).toContain(label);
    }
  });

  it('labels the control in-field like every other filter', () => {
    expect(search).toContain('<span class="imp-cap" aria-hidden="true">Sort by</span>');
    expect(search).toContain('<label for="imp-sort">Sort results by</label>');
  });

  it('sorts CLIENT-side — no sort key is added to the search request', () => {
    // A sort that re-queried would spend ImportYeti credits on a reorder.
    expect(search).not.toMatch(/body:\s*JSON\.stringify\(\{[^}]*sort/);
    expect(search).toContain('function sortLeads(rows)');
  });

  it('remembers the chosen order', () => {
    expect(search).toContain("ls('qf_imp_sort'");
  });
});

describe('R3-3 · applied-filter chips', () => {
  it('renders a results-level filter bar, hidden until something is applied', () => {
    expect(search).toContain('<div class="imp-chips" id="imp-chips" hidden>');
    // R4 added a scope title to the caption; assert the caption, not its attributes.
    expect(search).toMatch(/<span class="imp-chips-cap"[^>]*>Filtered by<\/span>/);
  });

  it('offers a clear-all alongside the per-chip removal', () => {
    expect(search).toContain('id="imp-chips-clear"');
    expect(search).toContain('function renderChips()');
    expect(search).toContain('function addChip(label,onRemove)');
  });

  it('names each chip for assistive tech, not just the × glyph', () => {
    expect(search).toContain("'Remove filter: '+label");
  });
});

describe('R3-4 · result-count sentence', () => {
  it('states the total, the filtered subset, the provenance and the order', () => {
    expect(search).toContain("frag('Showing all ')");
    expect(search).toContain("frag(' of ')");
    expect(search).toContain("frag(' \\u00b7 built from ')");
    expect(search).toContain("frag(' \\u00b7 sorted by ')");
  });

  it('drops the record-count clause when nothing was scanned', () => {
    // Rendering "built from 0 customs records" would be a false provenance claim.
    expect(search).toContain('if(totalScanned){');
  });
});

describe('R3-5 · card footer zones', () => {
  it('lays the footer out as three addressable columns', () => {
    expect(search).toMatch(/\.imp-foot\{display:grid;grid-template-columns:auto minmax\(0,1fr\) auto/);
    expect(search).toContain('.imp-foot>.imp-incumb{grid-column:1}');
    expect(search).toContain('.imp-foot>.imp-tier{grid-column:2;justify-self:start}');
    expect(search).toContain('.imp-foot>.imp-foot-r{grid-column:3}');
  });

  it('appends the contact-tier note to the FOOTER, not to the action group', () => {
    // Inside the action group its x-position drifted with the button count.
    expect(search).toContain('foot.appendChild(tierEl);');
  });

  it('collapses to a wrapping row on narrow screens', () => {
    expect(search).toContain('.imp-foot{display:flex;flex-wrap:wrap}');
  });

  it('never strands a single action button at half width', () => {
    // A lead with no mappable entry port has no "Quote this lane"; auto-fit
    // collapses the empty track so ☆ Save stretches instead of orphaning.
    expect(search).toMatch(/\.imp-foot-r\{width:100%;[^}]*repeat\(auto-fit,minmax\(130px,1fr\)\)/);
  });

  it('reads the reveal action as one control rather than a nested pill', () => {
    expect(search).toContain("'Reveal on profile '");
  });
});

describe('R3-6 · profile section bar', () => {
  it('renders a horizontal jump nav covering every section', () => {
    expect(profileHtml).toContain('<nav class="impp-tabs" aria-label="Jump to section">');
    for (const id of ['overview', 'chart', 'suppliers', 'products', 'origins', 'recent', 'contact']) {
      expect(profileHtml).toContain(`data-dot="${id}"`);
    }
  });

  it('takes over exactly where the fixed dot rail drops out', () => {
    expect(profileHtml).toContain('@media(max-width:1320px){.impp-dots{display:none}}');
    // R4 moved the reveal onto the scroll wrapper (which hosts the edge fade +
    // chevrons); the strip still takes over at exactly the width the rail drops.
    expect(profileHtml).toMatch(/@media\(max-width:1320px\)\{\s*\.impp-tabswrap\{display:block\}/);
  });

  it('shares one click handler and scroll-spy between both navs', () => {
    // Keyed on [data-dot], not on the rail's class.
    expect(profileHtml).toContain("querySelectorAll('[data-dot]')");
  });

  it('offers expand-all, since five of the eleven sections load folded', () => {
    expect(profileHtml).toContain('id="impp-expand"');
    expect(profileHtml).toContain('function allOpen()');
    expect(profileHtml).toContain("expandBtn.textContent = on ? 'Collapse all' : 'Expand all'");
  });

  it('offsets scroll targets so the sticky bar does not cover a section heading', () => {
    expect(profileHtml).toContain('scroll-margin-top:72px');
  });
});

describe('R3-7 · chart keyboard access', () => {
  it('puts exactly one bar in the tab order and none of the other seventeen', () => {
    expect(longProfile.months.length).toBe(18);
    const tabbable = profileHtml.match(/class="bar[^"]*"[^>]*tabindex="0"/g) ?? [];
    const skipped = profileHtml.match(/class="bar[^"]*"[^>]*tabindex="-1"/g) ?? [];
    expect(tabbable.length).toBe(1);
    expect(skipped.length).toBe(17);
  });

  it('announces the month and count on each bar', () => {
    expect(profileHtml).toMatch(/role="img" aria-label="[A-Z][a-z]{2} \d{4}: \d+ shipments?"/);
  });

  it('tells the user the arrow keys work', () => {
    expect(profileHtml).toContain('arrow keys step through the series');
    expect(profileHtml).toContain('Use the arrow keys to step through the months.');
  });

  it('handles arrows, Home, End and Escape', () => {
    for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End', 'Escape']) {
      expect(profileHtml).toContain(`'${key}'`);
    }
  });

  it('marks the group as a group once its children are focusable', () => {
    // role="img" would hide the now-navigable bars from assistive tech.
    expect(profileHtml).toContain('class="impp-chart" id="impp-chart"');
    expect(profileHtml).toMatch(/id="impp-chart"[^>]*role="group"/);
  });
});

describe('R3-8 · chart x-axis density', () => {
  it('labels an 18-month series with six ticks, not three', () => {
    const axis = /<div class="impp-xaxis">(.*?)<\/div>/s.exec(profileHtml)?.[1] ?? '';
    // R5 changed the axis to one slot PER MONTH, labelled only at the ticks, so
    // that a label is centred under its OWN bar (the old evenly-spread row put
    // every label after the third under the wrong bar). The density this spec
    // protects is the number of LABELLED slots, which is unchanged at six.
    const labelled = axis.match(/<span>[^<]+<\/span>/g) ?? [];
    expect(labelled.length).toBe(6);
    expect((axis.match(/<span>/g) ?? []).length).toBe(18);
  });

  it('always anchors both ends of the series', () => {
    const axis = /<div class="impp-xaxis">(.*?)<\/div>/s.exec(profileHtml)?.[1] ?? '';
    expect(axis).toContain(longProfile.months[0].label);
    expect(axis).toContain(longProfile.months[longProfile.months.length - 1].label);
  });

  it('never invents more ticks than there are months', () => {
    const short = aggregateProfile(syntheticMonths([4, 7]), FIXTURE_PROFILE_SLUG);
    const html = renderImporterProfilePage(short, quota, anonRevealState());
    const axis = /<div class="impp-xaxis">(.*?)<\/div>/s.exec(html)?.[1] ?? '';
    expect((axis.match(/<span>/g) ?? []).length).toBe(short.months.length);
  });
});

describe('R3-9 · bar rows print the share their caption promises', () => {
  it('shows a percentage beside the raw count', () => {
    const shares = profileHtml.match(/<span class="bp">(\d+%|<1%)<\/span>/g) ?? [];
    expect(shares.length).toBeGreaterThanOrEqual(4);
  });

  it('computes the share against the sample TOTAL, not the largest row', () => {
    // Both the printed figure and the bar length are shares of the sample total,
    // so no row may read 100% unless it truly is the whole sample.
    expect(profileHtml).not.toContain('<span class="bp">100%</span>');
    const hs = longProfile.hsBreakdown;
    const total = hs.reduce((s, h) => s + h.n, 0);
    const expected = `${Math.round((hs[0].n / total) * 100)}%`;
    expect(profileHtml).toContain(`<span class="bp">${expected}</span>`);
  });

  it('spells out the denominator in the row tooltip', () => {
    expect(profileHtml).toMatch(/title="[^"]*of [\d,]+ sampled shipments \(\d+%\)"/);
  });

  it('never rounds a present slice down to 0%', () => {
    const many = Array.from({ length: 60 }, (_, i) => (i === 0 ? 400 : 1));
    const wide = aggregateProfile(syntheticMonths(many), FIXTURE_PROFILE_SLUG);
    const html = renderImporterProfilePage(wide, quota, anonRevealState());
    expect(html).not.toContain('<span class="bp">0%</span>');
  });
});

/* Bar LENGTH used to scale to the largest row, so the top row rendered a
 * full-width bar while its own label said e.g. "38%" — length contradicted the
 * printed number. Length is now the true share of the sample, floored at
 * BAR_MIN_PCT so a sub-1% slice stays visible. */
describe('bar LENGTH encodes the true share of the sample', () => {
  /** {rendered width %, printed share} for every bar row in a profile. */
  const rows = (html: string): Array<{ width: number; share: string }> =>
    [...html.matchAll(/<div class="impp-brow"[\s\S]*?<\/div>/g)].map((m) => ({
      width: Number(/width:(\d+)%/.exec(m[0])?.[1] ?? NaN),
      share: /<span class="bp">(.*?)<\/span>/.exec(m[0])?.[1] ?? '',
    }));

  it('renders a bar for every row it prints a share for', () => {
    expect(rows(profileHtml).length).toBeGreaterThanOrEqual(4);
  });

  it('sets each bar width to exactly the share printed beside it', () => {
    for (const r of rows(profileHtml)) {
      if (!r.share || r.share === '<1%') continue;
      expect(r.width).toBe(Number(r.share.replace('%', '')));
    }
  });

  it('never renders a full-width bar for a partial slice', () => {
    // The regression: the biggest row always painted 100% of the track.
    for (const r of rows(profileHtml)) {
      if (r.share && r.share !== '100%') expect(r.width).toBeLessThan(100);
    }
  });

  /** One dominant HS code plus a long tail of single-bill codes, so the top-6
   *  list genuinely contains sub-1% slices AND is genuinely truncated. */
  const longTail = () => {
    const base = FIXTURE_PROFILE_ROWS[0];
    const out: (typeof FIXTURE_PROFILE_ROWS)[number][] = [];
    for (let i = 0; i < 400; i++) out.push({ ...base, hs_code: '999999', bol_number: `DOM${i}` });
    for (let i = 0; i < 60; i++) out.push({ ...base, hs_code: `1000${String(i).padStart(2, '0')}`, bol_number: `TAIL${i}` });
    return out;
  };

  it('floors a sub-1% slice at BAR_MIN_PCT instead of hiding it', () => {
    const wide = aggregateProfile(longTail(), FIXTURE_PROFILE_SLUG);
    const html = renderImporterProfilePage(wide, quota, anonRevealState());
    const tiny = rows(html).filter((r) => r.share === '<1%');
    expect(tiny.length).toBeGreaterThan(0);
    for (const r of tiny) expect(r.width).toBe(BAR_MIN_PCT);
    // …and the floor is genuinely small: it must never inflate a tiny slice into
    // something that reads as a real share.
    expect(BAR_MIN_PCT).toBeLessThanOrEqual(3);
  });

  it('measures the share against the SAMPLE, not the visible top-N rows', () => {
    const wide = aggregateProfile(longTail(), FIXTURE_PROFILE_SLUG);
    // 6 of 61 codes are drawn; their shares must NOT renormalise to 100%.
    expect(wide.hsBreakdown.length).toBe(6);
    expect(wide.hsCodeCount).toBe(61);
    expect(wide.hsTotal).toBe(460);
    const html = renderImporterProfilePage(wide, quota, anonRevealState());
    // Scope to the Product-breakdown section — the origins section is a separate
    // population with its own denominator.
    const products = /id="sec-products"[\s\S]*?id="sec-origins"/.exec(html)?.[0] ?? '';
    const drawn = rows(products).filter((r) => r.share);
    const sum = drawn.reduce((s, r) => s + (r.share === '<1%' ? 0 : Number(r.share.replace('%', ''))), 0);
    expect(sum).toBeLessThan(100);
    // the dominant code is 400/460 ≈ 87%, never a full-width bar
    expect(drawn.some((r) => r.share === '87%' && r.width === 87)).toBe(true);
    // and a truncated list says so in its section header
    expect(html).toContain('6 of 61 HS codes');
  });

  it('captions both bar sections with what the length means', () => {
    expect(profileHtml).toContain('bar length = share of the sampled shipments');
    expect((profileHtml.match(/bar length = share of the sampled shipments/g) ?? []).length).toBe(2);
  });
});
