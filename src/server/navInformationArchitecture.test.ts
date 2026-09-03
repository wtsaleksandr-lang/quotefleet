/**
 * NAVIGATION / INFORMATION ARCHITECTURE — the structural invariants.
 *
 * Alex: "work on menu structure optimization and logical structure build. its
 * very confusing right now." The rebuild replaced a five-entry, drifting menu
 * with three job-grouped audience menus plus a one-click Pricing link. What made
 * the old one confusing was not the styling — it was four structural faults, and
 * every one of them is pinned here so it cannot come back:
 *
 *   1. THE SAME LABEL TWICE. Directory pages rendered a "For shippers" link in
 *      the action cluster next to the "For Shippers" dropdown.
 *   2. ONE DESTINATION IN TWO PLACES / UNDER TWO NAMES. /importers was
 *      "Importer Search" on the homepage and "Importers Directory" in the shared
 *      chrome; /partners and /signup each appeared twice in the footer.
 *   3. A MENU ENTRY THAT GOES NOWHERE. A bare /directory/rfq 302s straight back
 *      to /directory (see directory/entryPortFacets.ts), so the RFQ menu item
 *      bounced the visitor to the page they came from.
 *   4. THREE DIFFERENT SITE MAPS. The glossary hand-rolled its own `.topnav`
 *      with a different link list, so the site taught two contradictory maps.
 *
 * Plus the copy rule Alex gave directly: the word "pitch" is banned from
 * user-facing copy — "i dont like the title, using the word 'pitch'. we can
 * simply use, importers directory".
 *
 * ─── AND THE BLIND SPOT THAT LET FOUR FOOTER DEFECTS THROUGH ────────────────
 * The first sixteen tests here all passed while the shipped site had four broken
 * footers, because they asserted against PREMIUM_FOOTER and nothing else:
 *
 *   • They never looked at landing.html's INLINE footer. The homepage is a
 *     static file that never passes through applyFullSiteHeader, so it carries
 *     its own copy — and that copy was still the old four-column PRODUCT /
 *     SOLUTIONS / COMPANY / LEGAL block, laid out by a five-track grid, which
 *     is a permanently empty 203–230px trailing column at 981–1600px.
 *   • They asserted nothing RESPONSIVE. Every one of the four defects was a
 *     wrap that strands ONE column alone on the last row, and a track count is
 *     only wrong at the widths where its media query applies:
 *       – homepage 3+1 at 761–980px  (LEGAL alone beside ~620px of dead space)
 *       – every PREMIUM_FOOTER page 2+2+1 at ≤760px, 375px included
 *       – the directory footer 2+1 at 421–720px (FREE TOOLS alone)
 *
 * So the last three describe blocks below assert the two things that were
 * missing: landing.html carries PREMIUM_FOOTER VERBATIM (which collapses the
 * homepage-drift class of bug entirely), and every footer variant is resolved
 * through the real CSS cascade at every width from 320 to 1600 and checked
 * against the standing no-orphan rule.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SITE_NAV_HTML, SITE_MOBILE_MENU_HTML, PREMIUM_FOOTER, FULL_SITE_HEADER } from './siteChrome.js';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const LANDING_HTML = read('src/server/public/landing.html');
const DIRECTORY_PAGES_TS = read('src/server/directory/pages.ts');
const GLOSSARY_TS = read('src/server/directory/glossary.ts');
const NAV_UNIFY_CSS = read('src/server/public/nav-unify.css');
const NAV_IA_CSS = read('src/server/public/nav-ia.css');
const LANDING_MOTION_JS = read('src/server/public/landing-motion.js');
const LANDING_CONVERSION_CSS = read('src/server/public/landing-conversion.css');
const LANDING_HOME_FIXES_CSS = read('src/server/public/landing-home-fixes.css');
const LANDING_FOOTER_POLISH_CSS = read('src/server/public/landing-footer-polish.css');

/** Every `href` in a chunk of nav markup, in document order. */
function hrefs(html: string): string[] {
  return [...html.matchAll(/<a[^>]*href="([^"]+)"/g)].map((m) => m[1]);
}
/** Visible text of every anchor/button/summary, lowercased and collapsed. */
function labels(html: string): string[] {
  return [...html.matchAll(/<(a|button|summary)[^>]*>([\s\S]*?)<\/\1>/g)]
    .map((m) => m[2].replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().toLowerCase())
    .filter(Boolean);
}

describe('the primary nav has exactly three audience menus + Pricing', () => {
  it('names the three menus, and names BROKERS in the sell-side one', () => {
    // "For Carriers" excluded the audience the menu's own third column is built
    // for — Freight Brokers / Freight Forwarders / LTL Carriers — and which the
    // homepage eyebrow directly under it already calls out as "FOR CARRIERS,
    // BROKERS & FORWARDERS". A broker scanning "For Carriers / For Shippers" saw
    // himself in neither. The longer label is measured for header overflow at
    // every width 320–1600 (0px at all of them; the bar still collapses to the
    // burger at exactly one point, 1024px).
    for (const [name, html] of [['SITE_NAV_HTML', SITE_NAV_HTML], ['landing.html', LANDING_HTML]] as const) {
      expect(html, name).toContain('>For Carriers &amp; Brokers<');
      expect(html, name).not.toMatch(/>For Carriers</);
      expect(html, name).toContain('>For Shippers<');
      expect(html, name).toContain('>Free Tools<');
    }
    // Every nav surface, including the two footers, uses the one label.
    expect(SITE_MOBILE_MENU_HTML).toContain('>For Carriers &amp; Brokers<');
    expect(PREMIUM_FOOTER).toContain('<h4>For Carriers &amp; Brokers</h4>');
    expect(DIRECTORY_PAGES_TS).toContain('>For Carriers &amp; Brokers</h2>');
    // Pricing stays a top-level ONE-CLICK link, not a fourth dropdown.
    expect(SITE_NAV_HTML).toContain('<a href="/pricing">Pricing</a>');
    expect((SITE_NAV_HTML.match(/nav-dd-trigger/g) ?? []).length).toBe(3);
  });

  it('drops the one-item "For Importers" menu — a dropdown holding a single link', () => {
    // Manifest Privacy now sits inside For Shippers, where an importer looks.
    expect(SITE_NAV_HTML).not.toContain('For Importers');
    expect(SITE_MOBILE_MENU_HTML).not.toContain('For Importers');
    expect(SITE_NAV_HTML).toContain('href="/manifest-privacy"');
  });

  it('gives every dropdown panel a declared column count', () => {
    // The base rule hard-codes two tracks; a three-group panel silently wrapped
    // its third column onto a second row without this.
    const panels = SITE_NAV_HTML.match(/<div class="nav-dd-panel[^"]*"/g) ?? [];
    expect(panels.length).toBe(3);
    for (const p of panels) expect(p).toMatch(/nav-dd-panel--cols\d/);
    expect(NAV_UNIFY_CSS).toContain('.nav-dd-panel--cols3');
    expect(NAV_IA_CSS).toContain('.nav-dd-panel--cols3');
  });
});

describe('ONE DESTINATION, ONE HOME', () => {
  it('never lists the same href twice inside the primary nav', () => {
    const all = hrefs(SITE_NAV_HTML);
    expect(all.length).toBeGreaterThan(10);
    expect(new Set(all).size, `duplicates: ${all.filter((h, i) => all.indexOf(h) !== i)}`).toBe(all.length);
  });

  it('never lists the same href twice inside the mobile drawer', () => {
    const all = hrefs(SITE_MOBILE_MENU_HTML);
    expect(new Set(all).size, `duplicates: ${all.filter((h, i) => all.indexOf(h) !== i)}`).toBe(all.length);
  });

  it('never lists the same href twice across the footer link columns', () => {
    // /partners was "Partners" AND "Affiliate program"; /signup was "Start free"
    // AND "Claim your listing". Same page, two names, one column apart.
    // Scoped to `.footer-col`: the brand block deliberately points logo AND
    // wordmark at "/", which is a single affordance rendered in two parts.
    const cols = [...PREMIUM_FOOTER.matchAll(/<div class="footer-col">[\s\S]*?<\/div>/g)].map((m) => m[0]);
    expect(cols.length).toBe(5);
    const all = cols.flatMap(hrefs);
    expect(new Set(all).size, `duplicates: ${all.filter((h, i) => all.indexOf(h) !== i)}`).toBe(all.length);
  });

  it('never shows the same LABEL twice in one header — the defect Alex flagged', () => {
    // The directory header carried a "For shippers" action link beside the
    // "For Shippers" menu. Assert against the real directory header markup.
    const dirHeader = DIRECTORY_PAGES_TS.match(/<header class="site-header">[\s\S]*?<\/header>/)?.[0] ?? '';
    expect(dirHeader, 'directory header must be extractable').toContain('site-actions');
    expect(dirHeader).not.toMatch(/>For shippers</i);
    // The account slot survives (it hydrates email / Pro chip / Manage) but ships
    // EMPTY and hidden, which also keeps the CDN-cached HTML auth-invariant.
    expect(dirHeader).toContain('<span class="nav-shipper" id="nav-shipper" hidden></span>');

    // Only ONE of the two nav surfaces is on screen at a time, so the drawer is
    // stripped before checking: it is supposed to repeat the desktop labels.
    const desktopOnly = (h: string) => h.replace(/<div class="site-mobile-menu"[\s\S]*$/, '');
    for (const [name, header] of [['FULL_SITE_HEADER', FULL_SITE_HEADER], ['directory header', dirHeader]] as const) {
      const seen = labels(desktopOnly(header));
      const dup = seen.filter((l, i) => seen.indexOf(l) !== i);
      expect(dup, `${name} duplicate labels`).toEqual([]);
    }
  });

  it('calls /importers "Importers Directory" everywhere in the chrome', () => {
    for (const [name, html] of [
      ['SITE_NAV_HTML', SITE_NAV_HTML],
      ['SITE_MOBILE_MENU_HTML', SITE_MOBILE_MENU_HTML],
      ['landing.html nav', LANDING_HTML.match(/<nav class="site-nav"[\s\S]*?<\/nav>/)?.[0] ?? ''],
    ] as const) {
      expect(html, name).toMatch(/>Importers Directory</);
      expect(html, name).not.toMatch(/>Importer Search</);
    }
    expect(PREMIUM_FOOTER).toContain('>Importers directory<');
  });
});

describe('no menu entry is a dead end', () => {
  it('deep-links RFQ so it cannot bounce back to /directory', () => {
    // directory/entryPortFacets.ts: "/directory/rfq 302s straight back to
    // /directory unless the query carries a key from FACET_QUERY_KEYS".
    for (const [name, html] of [
      ['SITE_NAV_HTML', SITE_NAV_HTML],
      ['SITE_MOBILE_MENU_HTML', SITE_MOBILE_MENU_HTML],
      ['PREMIUM_FOOTER', PREMIUM_FOOTER],
    ] as const) {
      expect(html, name).toContain('/directory/rfq?sort=featured');
      expect(html, name).not.toMatch(/href="\/directory\/rfq"/);
    }
  });
});

describe('ONE site map — every surface ships the same chrome', () => {
  it('the glossary uses the canonical header/footer instead of its own topnav', () => {
    expect(GLOSSARY_TS).toContain('FULL_SITE_HEADER');
    expect(GLOSSARY_TS).toContain('PREMIUM_FOOTER');
    expect(GLOSSARY_TS).not.toContain('topnav--mobile-menu');
    expect(GLOSSARY_TS).toContain('/nav-unify.css');
  });

  it('landing.html carries the shared constants VERBATIM', () => {
    expect(LANDING_HTML).toContain(SITE_NAV_HTML);
    expect(LANDING_HTML).toContain(SITE_MOBILE_MENU_HTML);
  });
});

describe('ONE responsive collapse point — no band without navigation', () => {
  it('collapses to the burger at the same width everywhere', () => {
    // landing-conversion.css hid .site-nav at ≤720px while the burger only
    // appeared at ≤640px, so 641–720px had NO menu and NO burger at all.
    expect(NAV_UNIFY_CSS).toContain('@media (max-width: 1023px)');
    expect(NAV_IA_CSS).toContain('@media (max-width: 1023px)');
    expect(NAV_IA_CSS).toMatch(/max-width: 1023px[\s\S]*?\.site-burger[\s\S]*?display: inline-flex !important/);
    expect(DIRECTORY_PAGES_TS).toMatch(/@media \(max-width: 1023px\)[\s\S]{0,120}\.nav-shipper/);
  });

  it('loads the homepage IA sheet after the glass sheet', () => {
    const glass = LANDING_MOTION_JS.indexOf("loadStylesheet('/landing-glass.css')");
    const navIa = LANDING_MOTION_JS.indexOf("loadStylesheet('/nav-ia.css')");
    expect(glass).toBeGreaterThan(-1);
    expect(navIa).toBeGreaterThan(glass);
  });
});

describe('the audience toggle rides the hero column', () => {
  it('wraps the toggle in a .hero-grid row so it inherits the hero inset', () => {
    // Free-standing it rendered at x=0 at every width while the hero copy sat at
    // 12–210px, so it was clipped at the viewport edge and crossed the header
    // card's left border. Measured delta was up to 182px at 1600px.
    expect(LANDING_HTML).toContain('<div class="hero-grid qf-aud-togglerow">');
    expect(NAV_IA_CSS).toContain('.qf-aud-togglerow');
  });
});

describe('Alex banned the word "pitch" from user-facing copy', () => {
  it('is gone from the homepage', () => {
    expect(LANDING_HTML).not.toMatch(/pitch/i);
    expect(LANDING_HTML).toContain('Importers Directory &rarr;');
  });

  it('is gone from every chrome constant', () => {
    for (const [name, html] of [
      ['SITE_NAV_HTML', SITE_NAV_HTML],
      ['SITE_MOBILE_MENU_HTML', SITE_MOBILE_MENU_HTML],
      ['PREMIUM_FOOTER', PREMIUM_FOOTER],
    ] as const) {
      expect(html, name).not.toMatch(/pitch/i);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   FOOTERS — every variant, responsively.

   THE TWO FOOTER VARIANTS ON THE SITE:
     • PREMIUM_FOOTER — five link columns. Rendered by applyFullSiteHeader on
       every static marketing/legal page, by the server-rendered marketing pages
       (/partners, /glossary), and — as a LITERAL EMBEDDED COPY — by the static
       homepage, which never passes through the skinner.
     • `.dirfoot`   — the directory subsite footer in directory/pages.ts, now
       four columns (three header menus + Company).

   THE RULE THEY BOTH ANSWER TO: no row of a footer may hold exactly ONE column.
   (DESIGN-SYSTEM.md §8 — a group never wraps so one item sits alone on a line.)
   Expressed as arithmetic: with N columns in T tracks the last row holds
   `N mod T` columns, so every T where `N mod T === 1` is forbidden. A single
   full-bleed track (T=1) is the deliberate phone stack, not a wrap remainder,
   and is allowed; what is never allowed is a remainder of one, or a declared
   track that no column can ever occupy.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Split a `grid-template-columns` value into top-level tokens (parens-aware). */
function topLevelTokens(v: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of v.trim()) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** How many grid tracks a `grid-template-columns` value declares. */
function trackCount(value: string): number {
  return topLevelTokens(value.replace(/!important/g, '')).reduce((n, tok) => {
    const rep = tok.match(/^repeat\(\s*(\d+)\s*,([\s\S]*)\)$/);
    return n + (rep ? Number(rep[1]) * trackCount(rep[2]) : 1);
  }, 0);
}

interface GridDecl {
  sheet: string;
  order: number;
  selector: string;
  tracks: number;
  important: boolean;
  minWidth: number;
  maxWidth: number;
  specificity: number;
}

/** a-b-c specificity, packed so it compares numerically. */
function specificity(sel: string): number {
  const one = sel.split(',')[0];
  const ids = (one.match(/#[\w-]+/g) ?? []).length;
  const classes = (one.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;
  const types = (one.replace(/[.#][\w-]+|\[[^\]]+\]|::?[\w-]+/g, '').match(/[a-z][\w-]*/gi) ?? []).length;
  return ids * 10_000 + classes * 100 + types;
}

/**
 * Pull every `grid-template-columns` declaration whose selector matches, with
 * the media bounds it sits under. A brace scanner rather than a regex, so a
 * media block's own braces cannot swallow the rules inside it.
 */
function gridDecls(css: string, sheet: string, match: RegExp, seed = { n: 0 }): GridDecl[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: GridDecl[] = [];
  const walk = (text: string, minWidth: number, maxWidth: number): void => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf('{', i);
      if (open < 0) return;
      const prelude = text.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') depth--;
        j++;
      }
      const body = text.slice(open + 1, j - 1);
      if (prelude.startsWith('@media')) {
        const mn = prelude.match(/min-width:\s*(\d+)px/);
        const mx = prelude.match(/max-width:\s*(\d+)px/);
        walk(body, Math.max(minWidth, mn ? Number(mn[1]) : 0), Math.min(maxWidth, mx ? Number(mx[1]) : Infinity));
      } else if (prelude.startsWith('@')) {
        /* @supports / @keyframes etc. — not a media context, skip. */
      } else if (match.test(prelude)) {
        const d = body.match(/(?:^|;)\s*grid-template-columns\s*:([^;}]+)/);
        if (d) {
          out.push({
            sheet,
            order: seed.n++,
            selector: prelude.replace(/\s+/g, ' '),
            tracks: trackCount(d[1]),
            important: /!important/.test(d[1]),
            minWidth,
            maxWidth,
            specificity: specificity(prelude),
          });
        }
      }
      i = j;
    }
  };
  walk(src, 0, Infinity);
  return out;
}

/** The CSS cascade, for this one property: !important, then specificity, then order. */
function winnerAt(decls: GridDecl[], width: number): GridDecl {
  const live = decls.filter((d) => width >= d.minWidth && width <= d.maxWidth);
  return live.reduce((best, d) =>
    !best
    || (d.important !== best.important ? d.important
      : d.specificity !== best.specificity ? d.specificity > best.specificity
        : d.order > best.order)
      ? d : best,
  undefined as unknown as GridDecl);
}

const DIRECTORY_CSS = (() => {
  const start = DIRECTORY_PAGES_TS.indexOf('export const DIRECTORY_CSS = `');
  const end = DIRECTORY_PAGES_TS.indexOf('\n`;', start);
  return DIRECTORY_PAGES_TS.slice(start, end);
})();

/** Link columns in a footer's markup. */
const countCols = (html: string, cls: string) => (html.match(new RegExp(`class="${cls}"`, 'g')) ?? []).length;

const PREMIUM_COLS = countCols(PREMIUM_FOOTER, 'footer-col');
const DIRFOOT_COLS = countCols(DIRECTORY_PAGES_TS, 'dirfoot-col');

/** Every sheet that styles a given footer's grid, in the order the page loads them. */
const PREMIUM_SHEETS_HOMEPAGE: Array<[string, string]> = [
  ['landing-conversion.css', LANDING_CONVERSION_CSS],
  ['landing-home-fixes.css', LANDING_HOME_FIXES_CSS],
  ['landing-footer-polish.css', LANDING_FOOTER_POLISH_CSS],
  ['nav-ia.css', NAV_IA_CSS], // injected last by landing-motion.js
];
const PREMIUM_SHEETS_SHARED: Array<[string, string]> = [['nav-unify.css', NAV_UNIFY_CSS]];
const DIRFOOT_SHEETS: Array<[string, string]> = [['directory/pages.ts DIRECTORY_CSS', DIRECTORY_CSS]];

function collect(sheets: Array<[string, string]>, match: RegExp): GridDecl[] {
  const seed = { n: 0 };
  return sheets.flatMap(([name, css]) => gridDecls(css, name, match, seed));
}

const FOOTER_SURFACES = [
  { name: 'homepage (landing.html + nav-ia.css)', cols: () => PREMIUM_COLS, sheets: PREMIUM_SHEETS_HOMEPAGE, sel: /premium-footer-inner/ },
  { name: 'shared marketing chrome (nav-unify.css)', cols: () => PREMIUM_COLS, sheets: PREMIUM_SHEETS_SHARED, sel: /premium-footer-inner/ },
  { name: 'directory subsite (.dirfoot)', cols: () => DIRFOOT_COLS, sheets: DIRFOOT_SHEETS, sel: /\.dirfoot(?![-\w])/ },
] as const;

const WIDTHS = Array.from({ length: 1600 - 320 + 1 }, (_, i) => 320 + i);

describe('NO FOOTER ROW EVER HOLDS ONE COLUMN — every variant, 320→1600px', () => {
  it('knows how many columns each footer variant actually has', () => {
    expect(PREMIUM_COLS, 'PREMIUM_FOOTER link columns').toBe(5);
    expect(DIRFOOT_COLS, '.dirfoot link columns').toBe(4);
  });

  it.each(FOOTER_SURFACES.map((s) => [s.name, s] as const))(
    '%s resolves to an orphan-free track count at every width',
    (_name, surface) => {
      const decls = collect(surface.sheets as unknown as Array<[string, string]>, surface.sel);
      expect(decls.length, 'no grid declarations found — the selector moved').toBeGreaterThan(0);
      const n = surface.cols();
      const offenders: string[] = [];
      for (const w of WIDTHS) {
        const win = winnerAt(decls, w);
        expect(win, `no rule applies at ${w}px`).toBeDefined();
        const t = win.tracks;
        if (t > 1 && n % t === 1) {
          offenders.push(`${w}px → ${t} tracks for ${n} columns (${n % t} alone on the last row) via ${win.sheet} "${win.selector}"`);
        }
        if (t > n) offenders.push(`${w}px → ${t} tracks but only ${n} columns: ${t - n} track(s) can never be filled (${win.sheet})`);
      }
      expect(offenders.slice(0, 8), `${offenders.length} offending widths`).toEqual([]);
    },
  );

  it('is checked at 375px specifically — the reference phone width', () => {
    for (const surface of FOOTER_SURFACES) {
      const decls = collect(surface.sheets as unknown as Array<[string, string]>, surface.sel);
      const t = winnerAt(decls, 375).tracks;
      expect(t, `${surface.name} at 375px`).toBe(1);
    }
  });

  it('holds even for rules that are currently OUTRANKED — no stale sheet lying in wait', () => {
    // Defect #1 was exactly this: a five-track rule that was correct for the
    // shared footer applied to a homepage that still had four columns. Any
    // declaration that could ever win must be safe on its own, so specificity
    // accidents cannot resurrect an orphan.
    const bad: string[] = [];
    for (const surface of FOOTER_SURFACES) {
      const n = surface.cols();
      for (const d of collect(surface.sheets as unknown as Array<[string, string]>, surface.sel)) {
        if (d.tracks > 1 && n % d.tracks === 1) bad.push(`${d.sheet} "${d.selector}" → ${d.tracks} tracks for ${n} columns`);
        if (d.tracks > n) bad.push(`${d.sheet} "${d.selector}" → ${d.tracks} tracks, only ${n} columns exist`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('steps the ladder 5 → 3 → 1 for the five-column footer, on BOTH surfaces', () => {
    for (const surface of FOOTER_SURFACES.filter((s) => s.cols() === 5)) {
      const decls = collect(surface.sheets as unknown as Array<[string, string]>, surface.sel);
      const at = (w: number) => winnerAt(decls, w).tracks;
      expect([at(1600), at(1101)], `${surface.name} wide`).toEqual([5, 5]);
      expect([at(1100), at(641)], `${surface.name} mid`).toEqual([3, 3]);
      expect([at(640), at(320)], `${surface.name} phone`).toEqual([1, 1]);
    }
  });

  it('steps the ladder 4 → 2 → 1 for the directory footer', () => {
    const decls = collect(DIRFOOT_SHEETS, /\.dirfoot(?![-\w])/);
    const at = (w: number) => winnerAt(decls, w).tracks;
    expect([at(1600), at(981)]).toEqual([4, 4]);
    // 421–720px used to be `repeat(2, …)` against THREE columns — 2 + 1, with
    // FREE TOOLS alone beside 207–344px of dead space. Four columns make two
    // tracks a true 2×2.
    expect([at(980), at(721), at(641)]).toEqual([2, 2, 2]);
    expect([at(640), at(320)]).toEqual([1, 1]);
  });
});

describe('the homepage ships the SHARED footer, not a copy of an old one', () => {
  it('embeds PREMIUM_FOOTER verbatim', () => {
    // THE BUG THIS PINS: landing.html had its own hardcoded four-column footer
    // (PRODUCT / SOLUTIONS / COMPANY / LEGAL) that the last regroup never
    // touched, so `/` taught a different site map than every other page AND
    // rendered four columns inside a five-track grid.
    expect(LANDING_HTML).toContain(PREMIUM_FOOTER);
    expect((LANDING_HTML.match(/<footer/g) ?? []).length, 'exactly one footer').toBe(1);
  });

  it('no longer ships the retired column headings', () => {
    for (const dead of ['<h4>Product</h4>', '<h4>Solutions</h4>']) {
      expect(LANDING_HTML, dead).not.toContain(dead);
    }
  });

  it('links the six destinations the old homepage footer dropped', () => {
    // Each of these existed only in PREMIUM_FOOTER, so the homepage — the page
    // that gets the most traffic — linked to none of them.
    for (const href of [
      '/importers', '/manifest-privacy', '/guides', '/directory/join',
      '/directory/rfq?sort=featured', '/partners',
    ]) {
      expect(LANDING_HTML, href).toContain(`href="${href}"`);
    }
  });
});

describe('one filing decision per destination, applied to BOTH footers', () => {
  /** The column heading a href sits under, in whichever footer markup is given. */
  function columnOf(html: string, colClass: string, headTag: string, href: string): string | null {
    const cols = [...html.matchAll(new RegExp(`<div class="${colClass}">[\\s\\S]*?</div>`, 'g'))].map((m) => m[0]);
    const hit = cols.find((c) => c.includes(`href="${href}"`));
    if (!hit) return null;
    return (hit.match(new RegExp(`<${headTag}[^>]*>([^<]+)</${headTag}>`))?.[1] ?? '').replace(/&amp;/g, '&');
  }
  const premium = (href: string) => columnOf(PREMIUM_FOOTER, 'footer-col', 'h4', href);
  const dirfoot = (href: string) => columnOf(DIRECTORY_PAGES_TS, 'dirfoot-col', 'h2', href);

  it('files /pricing under the audience that buys it, in both footers', () => {
    // It was "Free Tools" in PREMIUM_FOOTER and "For Carriers" in .dirfoot. It
    // is not a free tool in either — it is the sell-side purchase decision.
    expect(premium('/pricing')).toBe('For Carriers & Brokers');
    expect(dirfoot('/pricing')).toBe('For Carriers & Brokers');
  });

  it('files /guides as shipper-side reference, not as a "tool"', () => {
    // The market guides are editorial reference pages ("Trucking Companies in
    // Houston, TX") that deep-link into /directory — read, not operated.
    expect(premium('/guides')).toBe('For Shippers');
    expect(dirfoot('/guides')).toBe('For Shippers');
    expect(SITE_NAV_HTML).toMatch(/nav-shippers-menu[\s\S]*?href="\/guides"[\s\S]*?nav-free-trigger/);
  });

  it('leaves Free Tools holding only things you operate', () => {
    for (const [name, html] of [['PREMIUM_FOOTER', PREMIUM_FOOTER], ['.dirfoot', DIRECTORY_PAGES_TS]] as const) {
      const col = html.match(/(?:<h4>|dirfoot-head">)Free Tools<\/(?:h4|h2)>[\s\S]*?<\/div>/)?.[0] ?? '';
      expect(col, name).toContain('/tools');
      expect(col, name).toContain('/glossary');
      expect(col, name).not.toContain('/guides');
      expect(col, name).not.toContain('/pricing');
    }
  });

  it('gives /partners a home on EVERY surface — it had one, sitewide', () => {
    // A revenue surface that lived only in PREMIUM_FOOTER's Company column was
    // unreachable from the homepage (own footer) and from all ~334k directory
    // pages (own footer). Both now carry it.
    expect(premium('/partners')).toBe('Company');
    expect(dirfoot('/partners')).toBe('Company');
    expect(LANDING_HTML).toContain('href="/partners"');
  });
});

describe('the directory footer matches its own comment', () => {
  const dirFooterHtml = DIRECTORY_PAGES_TS.match(/<nav class="dirfoot"[\s\S]*?<\/nav>/)?.[0] ?? '';

  it('runs the header menus in the HEADER\'S order, then Company', () => {
    // The comment claimed "mirrors the three header menus in the same order"
    // while the markup ran For Shippers → For Carriers → Free Tools. Header
    // order is For Carriers & Brokers → For Shippers → Free Tools.
    const heads = [...dirFooterHtml.matchAll(/dirfoot-head">([^<]+)</g)].map((m) => m[1].replace(/&amp;/g, '&'));
    expect(heads).toEqual(['For Carriers & Brokers', 'For Shippers', 'Free Tools', 'Company']);

    const navOrder = [...SITE_NAV_HTML.matchAll(/nav-dd-trigger[^>]*>([^<]+)</g)]
      .map((m) => m[1].replace(/&amp;/g, '&').trim());
    expect(heads.slice(0, 3)).toEqual(navOrder);
  });

  it('says what it does', () => {
    const comment = DIRECTORY_PAGES_TS.match(/Directory subsite footer[\s\S]*?\*\//)?.[0] ?? '';
    expect(comment).toContain('For Carriers & Brokers');
    expect(comment).not.toMatch(/mirrors the three header menus in the same order with the same labels/);
  });

  it('never repeats a destination between its columns', () => {
    const cols = [...dirFooterHtml.matchAll(/<div class="dirfoot-col">[\s\S]*?<\/div>/g)].map((m) => m[0]);
    expect(cols.length).toBe(4);
    const all = cols.flatMap(hrefs);
    expect(new Set(all).size, `duplicates: ${all.filter((h, i) => all.indexOf(h) !== i)}`).toBe(all.length);
  });
});

describe('/glossary content sits inside its own header card', () => {
  it('centres the hero column on the body column instead of flushing it left', () => {
    // Measured at 1440px: the eyebrow and H1 started at x=52 while the floating
    // header card started at x=130 and the page body at x=298 — the only page on
    // the site whose content overhung its header card. `margin: 0` on a 900px
    // box was the cause. Hero and body now share one centred column, so the
    // heading stays left-ALIGNED but starts on the body's left edge (x=298 at
    // 1440px, i.e. 168px inside the card).
    expect(GLOSSARY_TS).toMatch(/\.gl-hero \.container-narrow \{[^}]*margin: 0 auto/);
    expect(GLOSSARY_TS).not.toMatch(/\.gl-hero \.container-narrow \{[^}]*margin: 0;/);
    // 844 = the .gl-shell 900px box minus its 2 × 28px padding.
    expect(GLOSSARY_TS).toMatch(/\.gl-hero \.container-narrow \{[^}]*max-width: 844px/);
    expect(GLOSSARY_TS).toMatch(/\.gl-hero \{[^}]*text-align: left/);
  });
});
