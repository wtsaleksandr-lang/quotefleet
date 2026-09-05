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
import { runInNewContext } from 'node:vm';
import { SITE_NAV_HTML, SITE_MOBILE_MENU_HTML, PREMIUM_FOOTER, FULL_SITE_HEADER } from './siteChrome.js';
import { NAV_SHIPPER_SCRIPT } from './directory/pages.js';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const LANDING_HTML = read('src/server/public/landing.html');
const SITE_CHROME_TS = read('src/server/siteChrome.ts');
const SELF_TS = read('src/server/navInformationArchitecture.test.ts');
const PRICING_HTML = read('src/server/public/pricing.html');
const STYLE_CSS = read('src/server/public/style.css');
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
    // WHAT THIS ACTUALLY GUARDS — corrected, because the version of this comment
    // that shipped with the rebuild described a history that never happened. It
    // claimed the sell-side menu was labelled without "& Brokers", and that a
    // broker therefore had nowhere to click;
    // `git show <pre-rebuild main>:src/server/siteChrome.ts`
    // renders "For Carriers &amp; Brokers", so the label was already correct and
    // no broker was ever without an entry. What the rebuild changed was the
    // ORDER (this menu ran second, behind For Shippers) and the third menu
    // ("For Importers", a one-link dropdown → "Free Tools").
    //
    // The label is pinned anyway, and for a real reason: it was momentarily
    // shortened to "For Carriers" INSIDE the rebuild and restored before merge.
    // Losing "& Brokers" would contradict the menu's own third column (Freight
    // Brokers / Freight Forwarders / LTL Carriers) and the homepage eyebrow
    // under it ("FOR CARRIERS, BROKERS & FORWARDERS"). The longer label is
    // measured for header overflow at every width 320–1600 (0px at all of them,
    // anonymous AND signed in; the bar still collapses to the burger at exactly
    // one point, 1024px).
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
  /** The declaration's raw value — meaningful for any property, not just grids. */
  value: string;
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
 * Pull every declaration of `prop` whose selector matches, with the media bounds
 * it sits under. A brace scanner rather than a regex, so a media block's own
 * braces cannot swallow the rules inside it. `prop` defaults to
 * `grid-template-columns` (the footer track ladder above); the nav tests below
 * pass `white-space`, which is the same cascade question about a different
 * property.
 */
function gridDecls(css: string, sheet: string, match: RegExp, seed = { n: 0 }, prop = 'grid-template-columns'): GridDecl[] {
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
        const d = body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:([^;}]+)`));
        if (d) {
          out.push({
            sheet,
            order: seed.n++,
            selector: prelude.replace(/\s+/g, ' '),
            value: d[1].trim(),
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

function collect(sheets: Array<[string, string]>, match: RegExp, prop?: string): GridDecl[] {
  const seed = { n: 0 };
  return sheets.flatMap(([name, css]) => gridDecls(css, name, match, seed, prop));
}

/**
 * A LINK COLUMN THAT SPANS EVERY TRACK IS NOT PART OF THE WRAP.
 *
 * The phone footer went from one tall stack to two columns (Alex, 2026-09), and
 * with N=5 that is only legal because the LAST link column spans `1 / -1` and
 * paginates its own links into two CSS columns. A full-bleed row is the same
 * deliberate case the rule already blesses at T=1 — it is a row that holds one
 * column because it was told to, not a wrap that ran out of items. So the
 * arithmetic is applied to the columns that actually wrap:
 *
 *     wrapping = N - (link columns pinned to `grid-column: 1 / -1`)
 *     forbidden  ⟺  wrapping mod T === 1
 *
 * `.footer-brand` never counted (N counts `.footer-col` / `.dirfoot-col` only),
 * so this only ever picks up a deliberately spanned LINK column.
 */
const SPAN_SEL = /footer-col:last-child|dirfoot-col:last-child/;
const FULL_ROW = /^\s*1\s*\/\s*-1\s*(!important)?\s*$/;

/** How many link columns are pinned full-bleed at `width`, per the cascade. */
function spannedAt(sheets: Array<[string, string]>, width: number): number {
  const decls = collect(sheets, SPAN_SEL, 'grid-column');
  const win = winnerAt(decls, width);
  return win !== undefined && FULL_ROW.test(win.value) ? 1 : 0;
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
        /* A link column pinned `1 / -1` owns a row of its own by instruction,
           so it is not one of the columns the grid has to wrap. */
        const wrapping = n - spannedAt(surface.sheets as unknown as Array<[string, string]>, w);
        if (t > 1 && wrapping % t === 1) {
          offenders.push(`${w}px → ${t} tracks for ${wrapping} wrapping columns (${wrapping % t} alone on the last row) via ${win.sheet} "${win.selector}"`);
        }
        if (t > n) offenders.push(`${w}px → ${t} tracks but only ${n} columns: ${t - n} track(s) can never be filled (${win.sheet})`);
      }
      expect(offenders.slice(0, 8), `${offenders.length} offending widths`).toEqual([]);
    },
  );

  /* THE OWNER'S ASK, PINNED. "I don't like that footer it is 1 long stacked
     column in a mobile view. optimize it. make 2 columns." Every variant, at
     the reference phone width, with the remainder still zero. */
  it('is TWO columns at 375px — the reference phone width — with no orphaned row', () => {
    for (const surface of FOOTER_SURFACES) {
      const sheets = surface.sheets as unknown as Array<[string, string]>;
      const t = winnerAt(collect(sheets, surface.sel), 375).tracks;
      expect(t, `${surface.name} at 375px`).toBe(2);
      const wrapping = surface.cols() - spannedAt(sheets, 375);
      expect(wrapping % t, `${surface.name}: ${wrapping} wrapping columns in ${t} tracks`).toBe(0);
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
      const sheets = surface.sheets as unknown as Array<[string, string]>;
      for (const d of collect(sheets, surface.sel)) {
        /* Judge each declaration in the media band it actually governs, so a
           two-track rule is read alongside the span that makes it legal. */
        const probe = Number.isFinite(d.maxWidth) ? d.maxWidth : Math.max(d.minWidth, 1600);
        const wrapping = n - spannedAt(sheets, probe);
        if (d.tracks > 1 && wrapping % d.tracks === 1) bad.push(`${d.sheet} "${d.selector}" → ${d.tracks} tracks for ${wrapping} wrapping columns`);
        if (d.tracks > n) bad.push(`${d.sheet} "${d.selector}" → ${d.tracks} tracks, only ${n} columns exist`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('steps the ladder 5 → 3 → 2 for the five-column footer, on BOTH surfaces', () => {
    for (const surface of FOOTER_SURFACES.filter((s) => s.cols() === 5)) {
      const sheets = surface.sheets as unknown as Array<[string, string]>;
      const decls = collect(sheets, surface.sel);
      const at = (w: number) => winnerAt(decls, w).tracks;
      expect([at(1600), at(1101)], `${surface.name} wide`).toEqual([5, 5]);
      expect([at(1100), at(641)], `${surface.name} mid`).toEqual([3, 3]);
      // The phone step is TWO, not the old full-bleed stack. It is only legal
      // because the last link column is pinned `1 / -1` there, leaving four
      // columns to wrap into two tracks with nothing left over.
      expect([at(640), at(320)], `${surface.name} phone`).toEqual([2, 2]);
      expect([spannedAt(sheets, 640), spannedAt(sheets, 320)], `${surface.name} spanned`).toEqual([1, 1]);
      expect(spannedAt(sheets, 641), `${surface.name} does NOT span above the phone step`).toBe(0);
    }
  });

  it('steps the ladder 4 → 2 for the directory footer', () => {
    const decls = collect(DIRFOOT_SHEETS, /\.dirfoot(?![-\w])/);
    const at = (w: number) => winnerAt(decls, w).tracks;
    expect([at(1600), at(981)]).toEqual([4, 4]);
    // 421–720px used to be `repeat(2, …)` against THREE columns — 2 + 1, with
    // FREE TOOLS alone beside 207–344px of dead space. Four columns make two
    // tracks a true 2×2 — and because 4 mod 2 === 0, the same two tracks are
    // orphan-free at 375px, so the phone step needs no span and no stack.
    expect([at(980), at(721), at(641)]).toEqual([2, 2, 2]);
    expect([at(640), at(320)]).toEqual([2, 2]);
    expect(spannedAt(DIRFOOT_SHEETS, 375)).toBe(0);
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

/* ═══════════════════════════════════════════════════════════════════════════
   THE SIGNED-IN HEADER — the case that had no coverage at all.

   Every assertion above, and every measurement taken during the rebuild, was
   made against the ANONYMOUS header, where the bar fits with ~9px to spare. It
   is not the header most directory traffic sees once a shipper has an account:
   `#nav-shipper` hydrates client-side on all ~334k directory pages, and what it
   used to inject was an INLINE row — the email (capped at 200px), a "Directory
   Pro ✓" chip (125px) and a Manage link (53px) — 403px of new content replacing
   the 52px "Sign in" it hides. The header card's content box is 938px at the
   1024px collapse point and never exceeds 1134px, so the cluster ran past the
   card's right edge: measured 0px anonymous, 131px for a free shipper
   (1024–1132px) and 264px for a Pro shipper, from 1024px all the way out to
   1600px, pushing the "Claim your listing — free" CTA outside the card and
   clipping the theme toggle.

   The fix folds identity, plan and billing action into ONE ~58px control's
   panel. These tests execute the REAL hydration script against a minimal DOM
   stub (there is no jsdom in this suite — `node:vm` plus a few stub objects,
   built-ins only), so they assert the markup that actually ships rather than a
   regex over its source, for all three viewer states.
   ═══════════════════════════════════════════════════════════════════════════ */

interface SlotState { html: string; hidden: boolean; classes: string[] }

/** Run NAV_SHIPPER_SCRIPT against a stub DOM and report what it wrote. */
async function hydrateAccountSlot(me: unknown): Promise<SlotState> {
  const state: SlotState = { html: '', hidden: true, classes: [] };
  const slot = {
    set innerHTML(v: string) { state.html = v; },
    get innerHTML() { return state.html; },
    classList: { add: (c: string) => { state.classes.push(c); } },
    removeAttribute: (a: string) => { if (a === 'hidden') state.hidden = false; },
    querySelector: () => null,
  };
  const sandbox = {
    window: {} as Record<string, unknown>,
    document: {
      getElementById: (id: string) => (id === 'nav-shipper' ? slot : null),
      addEventListener: () => {},
    },
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve(me) }),
  };
  runInNewContext(NAV_SHIPPER_SCRIPT, sandbox);
  // One macrotask drains every microtask both realms queued.
  await new Promise((r) => setTimeout(r, 0));
  return state;
}

/** The content between <summary> and </summary> — i.e. what shows in the bar. */
const summaryOf = (html: string) => html.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)?.[1] ?? '';
/** Everything from the panel open tag on — i.e. what is hidden until clicked. */
const panelOf = (html: string) => html.slice(html.indexOf('<div class="nav-acct-panel">'));

describe('THE SIGNED-IN HEADER — identity folds into one control, not an inline row', () => {
  it('renders NOTHING for an anonymous visitor, and leaves the slot hidden', async () => {
    for (const me of [{ user: null }, null]) {
      const s = await hydrateAccountSlot(me);
      expect(s.html, JSON.stringify(me)).toBe('');
      expect(s.hidden, 'an empty slot must stay hidden').toBe(true);
    }
  });

  it('gives a free shipper ONE control, with plan + action inside its panel', async () => {
    const s = await hydrateAccountSlot({ user: { email: 'dispatch@harborlink.example' }, directoryPro: null });
    expect(s.hidden).toBe(false);
    expect((s.html.match(/<details/g) ?? []).length, 'exactly one control').toBe(1);
    expect(s.html).toMatch(/^<details class="nav-acct">/);
    expect(s.html).not.toContain('nav-acct--pro');
    const panel = panelOf(s.html);
    expect(panel).toContain('dispatch@harborlink.example');
    expect(panel).toContain('Free account');
    expect(panel).toContain('/directory/join?intent=subscribe');
  });

  it('gives a Pro shipper the chip and the billing portal — also inside the panel', async () => {
    const s = await hydrateAccountSlot({
      user: { email: 'ops@transglobal-logistics.example' },
      directoryPro: { status: 'active' },
    });
    expect(s.html).toMatch(/^<details class="nav-acct nav-acct--pro">/);
    const panel = panelOf(s.html);
    expect(panel).toContain('Directory Pro ✓');
    expect(panel).toContain('data-nav-portal');
    expect(panel).toContain('Manage billing');
    // 'trialing' is a live subscriber too (DIRECTORY_IS_PRO_JS).
    const trial = await hydrateAccountSlot({ user: { email: 'a@b.example' }, directoryPro: { status: 'trialing' } });
    expect(trial.html).toContain('nav-acct--pro');
  });

  it('puts NOTHING wide in the header bar itself — that is the whole fix', async () => {
    // The overflow was 403px of email + chip + link sitting in `.site-actions`.
    // Whatever the panel holds, the BAR may only ever carry the avatar and the
    // caret; anything else here re-opens the defect at some width.
    for (const me of [
      { user: { email: 'ops@transglobal-logistics.example' }, directoryPro: { status: 'active' } },
      { user: { email: 'dispatch@harborlink.example' }, directoryPro: null },
    ]) {
      const html = (await hydrateAccountSlot(me)).html;
      const bar = summaryOf(html);
      expect(bar, 'no address in the bar').not.toMatch(/@/);
      expect(bar).not.toContain('nav-pro-chip');
      expect(bar).not.toContain('nav-manage');
      expect(bar).not.toContain('nav-upgrade');
      expect(bar).not.toContain('nav-email');
      expect(bar).toContain('nav-acct-ini');
      expect(bar).toContain('nav-acct-caret');
      // The full address is still one hover away.
      expect(html).toMatch(/<summary [^>]*title="[^"]+@/);
    }
  });

  it('still escapes the address it echoes', async () => {
    const s = await hydrateAccountSlot({ user: { email: 'a<script>@"x.example' }, directoryPro: null });
    expect(s.html).not.toContain('<script>');
    expect(s.html).toContain('ascript@x.example');
  });

  it('styles the control with an OUTLINE when open, never a fill', () => {
    // DESIGN-SYSTEM.md §4 — the recurring "selected state is a bright fill" bug.
    expect(DIRECTORY_PAGES_TS).toMatch(/\.nav-acct\[open\] > summary \{[^}]*border-color: var\(--accent\)/);
    expect(DIRECTORY_PAGES_TS).toMatch(/\.nav-acct-panel \{[\s\S]*?position: absolute/);
    // Out of flow, so the panel can never widen the header cluster.
    expect(DIRECTORY_PAGES_TS).toMatch(/\.nav-acct-panel \{[\s\S]*?right: 0/);
    // The 200px ellipsis cap was for the retired inline row; the panel lifts it.
    expect(DIRECTORY_PAGES_TS).toMatch(/\.nav-acct-panel \.nav-email \{[^}]*max-width: none/);
  });

  it('keeps the slot off the collapsed header, and the server HTML auth-invariant', () => {
    // Both were already true and must stay true: below the single 1024px
    // collapse point the bar is brand + theme + CTA + burger, and the
    // CDN-cached HTML still ships the same empty slot to everyone.
    expect(DIRECTORY_PAGES_TS).toMatch(/@media \(max-width: 1023px\)[\s\S]{0,200}\.nav-shipper \{ display: none; \}/);
    expect(DIRECTORY_PAGES_TS).toContain('<span class="nav-shipper" id="nav-shipper" hidden></span>');
    expect(NAV_SHIPPER_SCRIPT).not.toMatch(/@[\w.-]+\.(com|net|org)/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   A CONTROL NEVER WRAPS ITS OWN LABEL — and never buys it with overflow.
   ═══════════════════════════════════════════════════════════════════════════ */

const NAV_SHEETS: Array<[string, string]> = [
  ['nav-unify.css', NAV_UNIFY_CSS],
  ['nav-ia.css', NAV_IA_CSS],
];

describe('no nav control breaks its label across two lines', () => {
  it('resolves to white-space: nowrap on the triggers at every desktop width', () => {
    // Measured before the fix: "For Carriers &/Brokers", "For/Shippers",
    // "Free/Tools" and "Sign/in" all broke in two on /directory, /carrier/*,
    // /city/* and /compliance across 1024–1100px (77 widths), and on the
    // homepage across 1024–1032px. /pricing, /glossary, /partners and /support
    // were clean, because their action cluster is 88px narrower.
    for (const [name, css] of NAV_SHEETS) {
      const decls = gridDecls(css, name, /nav-dd-trigger/, { n: 0 }, 'white-space');
      expect(decls.length, `${name}: no white-space rule on the trigger`).toBeGreaterThan(0);
      for (const w of [1024, 1032, 1060, 1100, 1140, 1280, 1600]) {
        expect(winnerAt(decls, w)?.value, `${name} @${w}px`).toBe('nowrap');
      }
    }
  });

  it('NEVER ships that nowrap without the compaction that pays for it', () => {
    // A nowrap flex item's automatic minimum size is its full label width, so
    // nowrap ALONE stops the controls shrinking and overflows the header card
    // instead — trading a wrap for the exact defect the 1024px collapse point
    // exists to prevent. The 1024–1140px band takes the nav from 491px to
    // ~420px and the action cluster from 337px to ~312px, against a 938px card
    // at the low end. The two halves are one fix and must stay together.
    for (const [name, css] of NAV_SHEETS) {
      const band = css.slice(css.indexOf('@media (min-width: 1024px) and (max-width: 1140px)'));
      expect(css.includes('@media (min-width: 1024px) and (max-width: 1140px)'), `${name}: the compaction band is gone`).toBe(true);
      expect(band, name).toContain('.site-nav { gap: 0; }');
      expect(band, name).toMatch(/padding-left: 8px; padding-right: 8px; font-size: 13px/);
      expect(band, name).toContain('.site-actions { gap: 8px; }');
    }
    // The collapse point itself is untouched: still exactly one, still 1024px.
    expect(NAV_UNIFY_CSS).toContain('@media (max-width: 1023px)');
    expect(NAV_IA_CSS).toContain('@media (max-width: 1023px)');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE FOUR-ITEM TRUST BAR — 2×2, never 3+1.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('.qf-footer-trustbar never strands its fourth claim on a line alone', () => {
  const TRUSTBAR_SURFACES: Array<[string, Array<[string, string]>]> = [
    ['shared marketing chrome', PREMIUM_SHEETS_SHARED],
    ['homepage', PREMIUM_SHEETS_HOMEPAGE],
  ];

  it('has exactly four claims — the count the ladder is derived from', () => {
    const bar = PREMIUM_FOOTER.match(/<ul class="qf-footer-trustbar"[\s\S]*?<\/ul>/)?.[0] ?? '';
    expect((bar.match(/<li>/g) ?? []).length).toBe(4);
  });

  it.each(TRUSTBAR_SURFACES)('%s: two tracks below 720px, one row above', (_name, sheets) => {
    // N=4 in T tracks strands `4 mod T` on the last row, so T=3 is the single
    // forbidden count and the ladder is 4 → 2. Measured before the fix: the
    // fourth claim sat alone from 459–673px on the homepage and 495–697px on
    // every PREMIUM_FOOTER page.
    const decls = collect(sheets, /qf-footer-trustbar/, 'grid-template-columns');
    for (const w of [320, 375, 459, 500, 640, 673, 697, 720]) {
      const win = winnerAt(decls, w);
      expect(win, `no trust-bar rule applies at ${w}px`).toBeDefined();
      expect(win.tracks, `${w}px`).toBe(2);
    }
    // Above 720px all four fit on one flex line on both surfaces (they need
    // <=650px of the >=673px available), so there is deliberately no grid rule.
    for (const w of [721, 900, 1120, 1600]) {
      expect(winnerAt(decls, w), `${w}px should stay a plain flex row`).toBeUndefined();
    }
  });

  it('leaves .qf-payrow-trust alone — its one-per-line stack is deliberate', () => {
    // style.css: "One badge per line is a deliberate stack, not an orphaned
    // wrap." Three items going fully vertical is a stack; it is not the 3+1
    // remainder this rule is about, and it must not be "fixed".
    expect(STYLE_CSS).toContain('One badge per line is a deliberate stack, not an orphaned wrap.');
    expect(STYLE_CSS).toMatch(/\.qf-payrow-trust \{\s*flex-direction: column/);
    // The nav sheets may NAME it in a comment (they explain why it is exempt);
    // what they must not do is open a rule block for it.
    for (const [name, css] of NAV_SHEETS) {
      const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
      expect(rules, name).not.toContain('.qf-payrow-trust');
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE HOMEPAGE FAQ, AND THE PAGE HEADER THAT WAS CENTRED.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('the FAQ is reachable from the footer again', () => {
  it('is filed in the SHARED footer, as a root-relative anchor', () => {
    // Replacing the homepage's bespoke footer with the shared one gained six
    // destinations and dropped the one in-page shortcut the old footer uniquely
    // had, leaving `id="faq"` reachable only by scrolling.
    //
    // ROOT-RELATIVE is what makes an in-page anchor legal in a footer that is
    // byte-identical on every page: a bare "#faq" resolves against /pricing or
    // a carrier profile, where no such element exists, and does nothing.
    for (const [name, html] of [
      ['PREMIUM_FOOTER', PREMIUM_FOOTER],
      ['landing.html', LANDING_HTML],
      ['.dirfoot', DIRECTORY_PAGES_TS],
    ] as const) {
      expect(html, name).toContain('<a href="/#faq">FAQ</a>');
      expect(html, name).not.toMatch(/href="#faq"/);
    }
  });

  it('still has a target to reach, and one filing decision for it', () => {
    expect(LANDING_HTML).toMatch(/<section[^>]*id="faq"/);
    const columnOf = (html: string, cls: string, tag: string) => {
      const col = [...html.matchAll(new RegExp(`<div class="${cls}">[\\s\\S]*?</div>`, 'g'))]
        .map((m) => m[0]).find((c) => c.includes('href="/#faq"')) ?? '';
      return col.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`))?.[1] ?? null;
    };
    expect(columnOf(PREMIUM_FOOTER, 'footer-col', 'h4')).toBe('Company');
    expect(columnOf(DIRECTORY_PAGES_TS, 'dirfoot-col', 'h2')).toBe('Company');
  });

  it('does not break the shared-footer-verbatim invariant', () => {
    expect(LANDING_HTML).toContain(PREMIUM_FOOTER);
  });
});

describe('/pricing gets the standing left-aligned page header', () => {
  it('overrides the shared .hero centring, for the whole hero', () => {
    // `.hero` in style.css sets `text-align: center`; every other hero on the
    // site overrides it (.dir-hero, .gl-hero, the compliance/profile heroes).
    // /pricing never did — measured `text-align: center`, gapL 106 / gapR 106
    // at 1440px. The sub-line and CTA row centre themselves independently
    // (`margin: 0 auto`, `justify-content: center`), so overriding the heading
    // alone would leave them centred under a left-aligned title.
    expect(STYLE_CSS).toMatch(/\.hero \{[\s\S]*?text-align: center/);
    expect(PRICING_HTML).toMatch(/\.qf-public-wft \.hero \{[^}]*text-align: left/);
    expect(PRICING_HTML).toMatch(/\.qf-public-wft \.hero p\.lead \{[^}]*margin-left: 0/);
    expect(PRICING_HTML).toMatch(/\.hero-cta,\s*\.qf-public-wft \.hero \.hero-meta \{[^}]*justify-content: flex-start/);
  });

  it('aligns the heading to the plan grid, not to an arbitrary edge', () => {
    // 808 - 2x24 = the 760px the `.pricing` box occupies, and both are centred,
    // so the two content columns coincide at every width (measured delta 0px at
    // 320/375/480/760/900/1100/1440/1600). Dropping the section's own side
    // padding is the narrow half of that: it was stacking 28px (22px under
    // 720px) on top of the container's 24px.
    expect(PRICING_HTML).toMatch(/\.qf-public-wft \.hero \.container-narrow \{[^}]*max-width: 808px/);
    expect(PRICING_HTML).toMatch(/\.qf-public-wft \.hero \{[^}]*padding-left: 0; padding-right: 0/);
  });

  it('has no eyebrow to mis-place', () => {
    // Rule 4 governs an eyebrow above a heading; this hero is H1 + lead only,
    // so there is nothing to align. Pinned so that adding one later fails here
    // and gets placed top-left deliberately.
    const hero = PRICING_HTML.match(/<section class="hero"[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(hero, 'the pricing hero must be extractable').toContain('<h1');
    expect(hero).not.toMatch(/class="[^"]*\b(tag|eyebrow|section-kicker)\b/);
  });
});

describe('the comments in this repo describe what actually happened', () => {
  it('no longer claims the sell-side menu shipped without "& Brokers"', () => {
    // The rebuild's own comment asserted a pre-rebuild state that never
    // existed. The repo tests its comments, so an inaccurate one is a defect.
    //
    // The two retired phrases are ASSEMBLED, not written out: this file is one
    // of the two sources being scanned, so a literal pattern would match its
    // own test and fail forever.
    const retired = [['menu', 'said', 'only'], ['had', 'no', 'entry', 'point']]
      .map((words) => new RegExp(words.join('\\s+')));
    for (const [name, src] of [
      ['siteChrome.ts', SITE_CHROME_TS],
      ['navInformationArchitecture.test.ts', SELF_TS],
    ] as const) {
      for (const re of retired) expect(src, `${name} still carries "${re.source}"`).not.toMatch(re);
    }
  });

  it('states the change that DID happen — order, and the third menu', () => {
    expect(SITE_CHROME_TS).toContain('It ran SECOND, behind For Shippers');
    expect(SITE_CHROME_TS).toContain('that slot used to be "For Importers"');
    expect(SITE_CHROME_TS).toMatch(/shortened to "For Carriers" mid-PR, then put/);
    expect(SITE_CHROME_TS).toMatch(/it ALREADY DID before the/);
  });
});
