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
  it('names the three menus', () => {
    for (const [name, html] of [['SITE_NAV_HTML', SITE_NAV_HTML], ['landing.html', LANDING_HTML]] as const) {
      expect(html, name).toContain('>For Carriers<');
      expect(html, name).toContain('>For Shippers<');
      expect(html, name).toContain('>Free Tools<');
    }
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
