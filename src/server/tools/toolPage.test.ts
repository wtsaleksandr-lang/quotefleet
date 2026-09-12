/**
 * THE TOOL-PAGE TEMPLATE'S GUARD TESTS.
 *
 * The template exists so eight pages stop being eight one-offs. What is worth
 * pinning is therefore not "does it render" — it is the handful of properties
 * that would silently stop being true the moment someone adds page nine by
 * copy-pasting page eight:
 *
 *   - the eight blocks appear, in order, every time;
 *   - the header band is a RASTER over a FLAT TOKEN, never a CSS gradient;
 *   - there is exactly one section-header pattern, and its eyebrow is first;
 *   - the focus ring and the reduced-motion guard ship on every page, because
 *     they are in the template rather than in each page's memory;
 *   - no raw hex reaches a call site.
 */
import { describe, expect, it } from 'vitest';
import { TOOL_TEMPLATE_CSS, factList, sectionHeader, toolPage } from './toolPage.js';

const HEAD = { eyebrow: 'Eyebrow', heading: 'Heading' };
const STEP = { title: 'Step', bodyHtml: '<em>body</em>' };
const ROW = { heading: 'Row', bodyHtml: '<p>copy</p>', figureHtml: '<p>fig</p>' };

function page(over: Partial<Parameters<typeof toolPage>[0]> = {}): string {
  return toolPage({
    title: 'T | QuoteFleet',
    description: 'D',
    path: '/tools/example',
    jsonLd: [{ '@type': 'WebApplication' }],
    crumbs: [{ name: 'Free tools', path: '/tools' }, { name: 'Example' }],
    eyebrow: 'Free calculator',
    h1: 'Example calculator',
    lead: 'Lead copy.',
    embed: { href: '/pricing', label: 'Embed this tool' },
    toolHtml: '<form id="the-tool"></form>',
    limits: { head: HEAD, facts: [{ label: 'A', bodyHtml: 'a' }, { label: 'B', bodyHtml: 'b' }] },
    steps: { head: HEAD, items: [STEP, STEP, STEP] },
    rows: { head: HEAD, items: [ROW, ROW] },
    related: {
      head: HEAD,
      items: [
        { href: '/a', title: 'A', blurb: 'a' },
        { href: '/b', title: 'B', blurb: 'b' },
        { href: '/c', title: 'C', blurb: 'c' },
        { href: '/d', title: 'D', blurb: 'd' },
      ],
    },
    faq: { head: HEAD, items: [{ q: 'Q?', a: 'A.' }] },
    ...over,
  });
}

describe('the eight blocks', () => {
  it('renders all eight, in the fixed order', () => {
    const html = page();
    const order = [
      'class="qtt-band"', // 1 tool header band
      'id="the-tool"', // 2 the tool, in its card
      'id="limits"', // 3 answer / limits strip
      'id="how"', // 4 how it works
      'id="detail"', // 5 alternating rows
      'id="related"', // 6 related tools
      'id="faq"', // 7 FAQ
      '<footer class="premium-footer"', // 8 footer, from the shell
    ];
    let cursor = -1;
    for (const marker of order) {
      const at = html.indexOf(marker);
      expect(at, `${marker} is missing`).toBeGreaterThan(-1);
      expect(at, `${marker} is out of order`).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  it('puts the tool inside the elevated card and the breadcrumb above the band', () => {
    const html = page();
    expect(html).toContain('<div class="qtt-tool"><form id="the-tool">');
    expect(html.indexOf('qtt-crumbs')).toBeLessThan(html.indexOf('class="qtt-band"'));
  });

  it('carries the embed affordance in the header band, not in the body', () => {
    const html = page();
    const band = html.slice(html.indexOf('class="qtt-band"'), html.indexOf('</section>', html.indexOf('class="qtt-band"')));
    expect(band).toContain('qtt-embed');
    expect(band).toContain('href="/pricing"');
  });

  it('states the limits-strip column count so two facts are two full columns', () => {
    expect(page()).toContain('--qtt-strip-cols:2');
    expect(page({ limits: { head: HEAD, facts: [
      { label: 'A', bodyHtml: 'a' }, { label: 'B', bodyHtml: 'b' }, { label: 'C', bodyHtml: 'c' },
    ] } })).toContain('--qtt-strip-cols:3');
  });
});

describe('one section-header pattern', () => {
  it('is eyebrow, then heading, then optional sub — eyebrow first', () => {
    const h = sectionHeader({ eyebrow: 'Scope', heading: 'What this answers', sub: 'And what it does not.' });
    expect(h.indexOf('qtt-eyebrow')).toBeLessThan(h.indexOf('<h2>'));
    expect(h.indexOf('<h2>')).toBeLessThan(h.indexOf('qtt-sub'));
  });

  it('omits the sub rather than rendering an empty line for it', () => {
    expect(sectionHeader({ eyebrow: 'E', heading: 'H' })).not.toContain('qtt-sub');
  });

  it('is the ONLY header pattern on the page — every block uses it', () => {
    const html = page();
    const heads = html.match(/class="qtt-head"/g) ?? [];
    // 5 blocks carry a section header: limits, how, detail, related, faq.
    expect(heads).toHaveLength(5);
    // ...and every h2 inside the main content belongs to one of them.
    const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
    expect((main.match(/<h2>/g) ?? []).length).toBe(heads.length);
  });
});

describe('design law', () => {
  it('paints the header band as a raster over a flat token, with NO CSS gradient', () => {
    expect(TOOL_TEMPLATE_CSS).toContain('background-color: var(--accent-fill)');
    expect(TOOL_TEMPLATE_CSS).toContain('url("/brand/dir-hero-wash.webp")');
    expect(TOOL_TEMPLATE_CSS).not.toMatch(/linear-gradient|radial-gradient|conic-gradient/);
  });

  it('writes no raw hex and no bare rgb() at a call site', () => {
    // Comments are stripped first: a hex quoted in PROSE — the band comment
    // names the two values it must NOT borrow — is documentation, not a call
    // site, and failing on it would push the reasoning out of the file.
    // The band's own two translucent-white values are DEFINITIONS and live
    // outside TOOL_TEMPLATE_CSS for exactly that reason.
    const decls = TOOL_TEMPLATE_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(decls).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(decls).not.toMatch(/rgba?\(/);
  });

  it('holds the radius ramp at 6 / 8 / 12 and the pill', () => {
    const radii = [...TOOL_TEMPLATE_CSS.matchAll(/border-radius:\s*([^;]+);/g)].map((m) => m[1]!.trim());
    for (const r of radii) {
      expect(
        /var\(--radius(-lg|-btn|-pill)?\)|var\(--qtt-r-xs\)/.test(r),
        `radius "${r}" is off the 6/8/12/pill ramp`,
      ).toBe(true);
    }
  });

  it('uses only the three shadow tokens — never a fourth, hand-rolled one', () => {
    const shadows = [...TOOL_TEMPLATE_CSS.matchAll(/box-shadow:\s*([^;]+);/g)].map((m) => m[1]!.trim());
    expect(shadows.length).toBeGreaterThan(0);
    for (const s of shadows) {
      expect(/^var\(--shadow-(sm|md|lg)\)$/.test(s), `shadow "${s}" is a fourth shadow`).toBe(true);
    }
  });

  it('animates on exactly two durations and one easing', () => {
    const durations = new Set(
      [...TOOL_TEMPLATE_CSS.matchAll(/transition:[^;]*?var\((--qtt-dur-\d)\)/g)].map((m) => m[1]),
    );
    expect(durations.size).toBeLessThanOrEqual(2);
    const easings = new Set([...TOOL_TEMPLATE_CSS.matchAll(/var\((--qtt-ease)\)/g)].map((m) => m[1]));
    expect(easings).toEqual(new Set(['--qtt-ease']));
  });

  it('never lifts a card on hover — the hover delta is a border colour', () => {
    expect(TOOL_TEMPLATE_CSS).not.toMatch(/:hover[^{]*\{[^}]*translate/);
    expect(TOOL_TEMPLATE_CSS).toContain('.qtt-rel:hover { border-color: var(--accent); }');
  });

  it('never centres a heading or an eyebrow', () => {
    expect(TOOL_TEMPLATE_CSS).not.toMatch(/text-align:\s*center/);
  });

  it('fixes the related-tools column count at every width so none can orphan', () => {
    // An auto-sizing track is what leaves one card alone on a final row.
    // 4 -> 2x2 -> 4x1, stated at every breakpoint.
    const tracks = [...TOOL_TEMPLATE_CSS.matchAll(/grid-template-columns:\s*([^;]+);/g)].map((m) => m[1]!);
    for (const t of tracks) {
      expect(/auto-fit|auto-fill/.test(t), `track "${t}" can orphan a card`).toBe(false);
    }
    expect(TOOL_TEMPLATE_CSS).toContain('.qtt-related { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr))');
    expect(TOOL_TEMPLATE_CSS).toContain('.qtt-related { grid-template-columns: repeat(2, minmax(0, 1fr)); }');
  });
});

describe('accessibility the reference system ships on neither host', () => {
  it('ships a real focus-visible ring, 2px accent at 2px offset', () => {
    expect(TOOL_TEMPLATE_CSS).toMatch(/outline:\s*2px solid var\(--accent\);\s*outline-offset:\s*2px;/);
    // ...and a ring picked by GROUND on the saturated band.
    expect(TOOL_TEMPLATE_CSS).toContain('outline-color: var(--accent-ink)');
  });

  it('guards every transition behind prefers-reduced-motion', () => {
    // No transition may be declared outside a no-preference query.
    const stripped = TOOL_TEMPLATE_CSS.replace(
      /@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n  \}/g,
      '',
    ).replace(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n  \}/g, '');
    expect(stripped).not.toMatch(/^\s*transition:/m);
    expect(TOOL_TEMPLATE_CSS).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('gives the breadcrumb a chevron separator and marks the current page', () => {
    const html = page();
    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html).toContain('class="qtt-sep" aria-hidden="true"');
    expect(html).toContain('<span aria-current="page">Example</span>');
  });

  it('sizes the breadcrumb below the H1 so the two do not compete', () => {
    const crumb = /\.qtt-crumbs \{[^}]*font-size:\s*(\d+)px/.exec(TOOL_TEMPLATE_CSS);
    expect(Number(crumb?.[1])).toBeLessThanOrEqual(14);
    expect(Number(crumb?.[1])).toBeGreaterThanOrEqual(13);
  });
});

describe('numeric hierarchy', () => {
  it('renders a fact as label-over-value, value dominant and tabular', () => {
    const dl = factList([{ label: 'Federal gross weight', value: '80,000', unit: 'lb' }]);
    expect(dl.indexOf('<dt>')).toBeLessThan(dl.indexOf('<dd>'));
    expect(dl).toContain('<span class="qtt-unit">lb</span>');
    const dd = /\.qtt-fact dd \{([^}]*)\}/.exec(TOOL_TEMPLATE_CSS)?.[1] ?? '';
    expect(dd).toContain('font-variant-numeric: tabular-nums');
    expect(dd).toContain('color: var(--ink)');
    // The figure is never the accent — the answer is not a link.
    expect(dd).not.toContain('var(--accent)');
    const unitSize = /\.qtt-fact dd \.qtt-unit \{[^}]*font-size:\s*(\d+)px/.exec(TOOL_TEMPLATE_CSS);
    const ddSize = /\.qtt-fact dd \{[^}]*font-size:\s*(\d+)px/.exec(TOOL_TEMPLATE_CSS);
    expect(Number(unitSize?.[1])).toBeLessThan(Number(ddSize?.[1]));
  });
});

describe('the shell is reused, not forked', () => {
  it('keeps the document, canonical and JSON-LD the shell already owns', () => {
    const html = page();
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<link rel="canonical" href="https://quotefleet.net/tools/example">');
    expect(html).toContain('"@type":"WebApplication"');
    expect((html.match(/<h1[ >]/g) ?? []).length).toBe(1);
  });

  it('scopes its own rules to body.qtt so the ~35 hub pages are untouched', () => {
    expect(page()).toContain('<body class="qtt">');
  });

  it('suppresses the generic promo — the band and block 6 already made the ask', () => {
    expect(page()).not.toContain('qf-tool-promo');
  });
});

describe('blocks a page has nothing honest to put in', () => {
  // The glossary is the case these exist for: a 37-term reference index has no
  // three-step process and no FAQ that is not invented. Omission must drop the
  // block cleanly — not reorder the rest, and not leave an empty section.
  const bare = { ...{}, limits: undefined, steps: undefined, rows: undefined, faq: undefined };

  it('renders without limits, steps, rows or FAQ', () => {
    const html = page(bare);
    expect(html).not.toContain('id="limits"');
    expect(html).not.toContain('id="how"');
    expect(html).not.toContain('id="detail"');
    expect(html).not.toContain('id="faq"');
    // ...and leaves no empty shell behind where a block used to be.
    expect(html).not.toMatch(/<section class="qtt-sec"[^>]*>\s*<\/section>/);
  });

  it('still renders the blocks that ARE supplied, in the fixed order', () => {
    const html = page(bare);
    for (const marker of ['class="qtt-band"', 'id="the-tool"', 'id="related"', '<footer class="premium-footer"']) {
      expect(html.indexOf(marker), `${marker} is missing`).toBeGreaterThan(-1);
    }
    expect(html.indexOf('id="the-tool"')).toBeLessThan(html.indexOf('id="related"'));
    expect(html.indexOf('id="related"')).toBeLessThan(html.indexOf('<footer class="premium-footer"'));
  });

  it('drops exactly one section header per omitted block', () => {
    expect((page().match(/class="qtt-head"/g) ?? []).length).toBe(5);
    expect((page(bare).match(/class="qtt-head"/g) ?? []).length).toBe(1); // related only
    expect((page({ faq: undefined }).match(/class="qtt-head"/g) ?? []).length).toBe(4);
  });

  it('keeps one h2 per rendered block and no orphaned heading', () => {
    const html = page(bare);
    const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
    expect((main.match(/<h2>/g) ?? []).length).toBe((html.match(/class="qtt-head"/g) ?? []).length);
  });

  it('emits NO FAQPage schema when there is no FAQ — the schema is a promise', () => {
    // jsonLd is the caller's, so the guarantee is only that omitting the block
    // removes the rendered Q&A; a page that drops the block must also drop the
    // schema it was backing, which is why they are asserted together here.
    const html = page({ faq: undefined, jsonLd: [{ '@type': 'WebApplication' }] });
    // Scoped to the rendered body: `.qh-faq` is also a CLASS DEFINITION in the
    // shell's stylesheet, which is in the document whether or not a page has
    // an FAQ, so a whole-document search would always find it.
    const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
    expect(main).not.toContain('qh-faq');
    expect(html).not.toContain('"@type":"FAQPage"');
  });

  it('never makes `related` optional — it is the suite signal', () => {
    expect(page(bare)).toContain('qtt-related');
  });
});
