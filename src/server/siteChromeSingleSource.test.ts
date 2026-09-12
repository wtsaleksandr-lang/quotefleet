/**
 * SITE CHROME HAS ONE SOURCE, AND A MISMATCH IS LOUD.
 *
 * The defect this file exists to prevent, stated plainly: the header and the
 * footer used to be written out in twenty places — once in siteChrome.ts and
 * again, in full, in nineteen static HTML files that existed only so a regex
 *
 *     html.replace(/<header class="topnav">[\s\S]*?<\/header>/, FULL_SITE_HEADER)
 *
 * had something to match. Three things went wrong with that, and all three were
 * SILENT:
 *
 *   1. NO CHROME. Rename the class the regex looks for and it stops matching.
 *      The response still goes out — with the page's own stale copy, or, once
 *      the copy is removed, with nothing at all.
 *   2. DOUBLE CHROME. Leave a local copy in place next to a working injection
 *      and the page renders two headers. Nothing raises.
 *   3. DRIFT. landing.html was served by `res.sendFile`, so the injector never
 *      ran on it. Its embedded copy — the one every homepage visitor actually
 *      received — was free to diverge from the constants, and did: a stale
 *      four-column PRODUCT / SOLUTIONS / COMPANY / LEGAL footer missing six
 *      destinations, inside a grid built for five columns.
 *
 * The mechanism now: every page declares an empty comment slot, the injector
 * COUNTS the slots and throws `SiteChromeError` on anything but the expected
 * number, `verifySiteChromeSlots` runs that audit over every registered page at
 * boot, and this file checks the same contract in CI. A page cannot render zero
 * or two headers and still pass.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  FOOTER_COLUMNS,
  FULL_SITE_HEADER,
  HEADER_SCRIPTS,
  PREMIUM_FOOTER,
  SITE_BURGER_BTN,
  SITE_FOOTER_SLOT,
  SITE_HEADER_SLOT,
  SITE_MOBILE_MENU_HTML,
  SiteChromeError,
  applySiteChrome,
  footerColumnLadderReport,
  footerTrackLadder,
  renderStaticPage,
  verifySiteChromeSlots,
} from './siteChrome.js';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PUBLIC_DIR = resolve(process.cwd(), 'src/server/public');
const APP_TS = read('src/server/app.ts');

/**
 * Every static page served with site chrome, and which variant it takes.
 * 'full' = canonical header + premium footer. 'auth' = the compact brand bar
 * and no footer (a sign-in page that offers three mega-menus and forty footer
 * links is a page that invites the visitor to leave before finishing).
 */
const CHROMED_PAGES: ReadonlyArray<readonly [string, 'full' | 'auth']> = [
  ['landing.html', 'full'],
  ['pricing.html', 'full'],
  ['compare.html', 'full'],
  ['support.html', 'full'],
  ['security.html', 'full'],
  ['cookie.html', 'full'],
  ['refund.html', 'full'],
  ['terms.html', 'full'],
  ['privacy.html', 'full'],
  ['dpa.html', 'full'],
  ['tools.html', 'full'],
  ['for-brokers.html', 'full'],
  ['for-ltl.html', 'full'],
  ['for-forwarders.html', 'full'],
  ['marketplace.html', 'full'],
  ['marketplace-carrier.html', 'full'],
  ['login.html', 'auth'],
  ['signup.html', 'auth'],
  ['reset-password.html', 'auth'],
];

const AUTH_LINK = { href: '/login', label: 'Sign in' };
const count = (s: string, needle: string) => s.split(needle).length - 1;

describe('every chromed page declares slots instead of carrying a copy', () => {
  it.each(CHROMED_PAGES.map(([f, v]) => [f, v] as const))(
    '%s declares exactly one header slot and the right footer slot count',
    (file, variant) => {
      const html = read(`src/server/public/${file}`);
      expect(count(html, SITE_HEADER_SLOT), `${file} header slots`).toBe(1);
      expect(count(html, SITE_FOOTER_SLOT), `${file} footer slots`).toBe(variant === 'full' ? 1 : 0);
      // And no local copy left behind next to the slot.
      expect(html, `${file} still carries a literal <header>`).not.toMatch(/<header[\s>]/);
      expect(html, `${file} still carries a literal <footer>`).not.toMatch(/<footer[\s>]/);
    },
  );

  it('renders exactly one header and one footer per page — the DOM-level contract', () => {
    for (const [file, variant] of CHROMED_PAGES) {
      const html = renderStaticPage(file, { variant, authLink: AUTH_LINK });
      expect(count(html, '<header'), `${file} rendered headers`).toBe(1);
      expect(count(html, '</header>'), `${file} rendered header closers`).toBe(1);
      expect(count(html, '<footer'), `${file} rendered footers`).toBe(variant === 'full' ? 1 : 0);
      expect(count(html, SITE_HEADER_SLOT), `${file} unfilled header slot`).toBe(0);
      expect(count(html, SITE_FOOTER_SLOT), `${file} unfilled footer slot`).toBe(0);
    }
  });

  it('leaves no static page in public/ carrying the retired chrome markup', () => {
    // A page that kept `<header class="topnav">` would be one the injector no
    // longer touches — i.e. exactly the landing.html failure, reintroduced.
    const offenders = readdirSync(PUBLIC_DIR)
      .filter((f) => f.endsWith('.html'))
      .filter((f) => {
        const html = readFileSync(resolve(PUBLIC_DIR, f), 'utf8');
        return /<header class="(?:topnav|site-header)"/.test(html)
          || /<footer class="(?:site-footer|premium-footer)"/.test(html);
      });
    expect(offenders).toEqual([]);
  });
});

describe('a slot mismatch is LOUD — zero, double and leftover chrome all throw', () => {
  const page = (body: string) => `<!doctype html><html><head></head><body>${body}</body></html>`;

  it('throws when the header slot is missing — no more silently unchromed pages', () => {
    expect(() => applySiteChrome(page(`<main></main>${SITE_FOOTER_SLOT}`), { label: 'x.html' }))
      .toThrow(SiteChromeError);
    expect(() => applySiteChrome(page(`<main></main>${SITE_FOOTER_SLOT}`), { label: 'x.html' }))
      .toThrow(/expected exactly 1/);
  });

  it('throws when a slot appears twice — no more silently doubled chrome', () => {
    const twice = page(`${SITE_HEADER_SLOT}${SITE_HEADER_SLOT}${SITE_FOOTER_SLOT}`);
    expect(() => applySiteChrome(twice, { label: 'x.html' })).toThrow(/found 2/);
  });

  it('throws when a page keeps a literal header or footer beside the slot', () => {
    const stale = page(`<header class="topnav"></header>${SITE_HEADER_SLOT}${SITE_FOOTER_SLOT}`);
    expect(() => applySiteChrome(stale, { label: 'x.html' })).toThrow(/literal <header>/);
  });

  it('throws when an auth page declares a footer slot it does not take', () => {
    const withFooter = page(`${SITE_HEADER_SLOT}${SITE_FOOTER_SLOT}`);
    expect(() => applySiteChrome(withFooter, { variant: 'auth', authLink: AUTH_LINK, label: 'x.html' }))
      .toThrow(/expects 0/);
  });

  it('names the file, so the failure says which page to fix', () => {
    expect(() => applySiteChrome(page('<main></main>'), { label: 'cookie.html' }))
      .toThrow(/^cookie\.html:/);
  });

  it('audits every registered page at boot, and reports ALL offenders at once', () => {
    // The real registry passes — that is the point of running it here too.
    expect(() => verifySiteChromeSlots(
      PUBLIC_DIR,
      CHROMED_PAGES.map(([file, variant]) => ({ file, variant })),
    )).not.toThrow();
    // And a page that is registered but absent is reported rather than ignored.
    expect(() => verifySiteChromeSlots(PUBLIC_DIR, [{ file: 'nope.html', variant: 'full' }]))
      .toThrow(/nope\.html/);
  });
});

describe('the routes actually go through that path — including the homepage', () => {
  it('registers every chromed page before express.static', () => {
    const staticAt = APP_TS.indexOf('express.static');
    expect(staticAt).toBeGreaterThan(-1);
    for (const [file] of CHROMED_PAGES) {
      if (file === 'landing.html') continue; // '/' is registered after the static handler by design
      expect(APP_TS.indexOf(`'${file}'`), `${file} route`).toBeGreaterThan(-1);
      expect(APP_TS.indexOf(`'${file}'`), `${file} must precede express.static`).toBeLessThan(staticAt);
    }
  });

  it('no longer sendFiles a marketing page — that was the homepage bug', () => {
    // `res.sendFile` bypasses the injector entirely. It is how landing.html
    // came to be the one page the shared constants did not govern.
    for (const file of ['landing.html', 'login.html', 'signup.html', 'reset-password.html']) {
      expect(APP_TS, `${file} is still sendFile'd`).not.toContain(`sendFile('${file}'`);
    }
    expect(APP_TS).toContain("applyFullSiteHeader(html, 'landing.html')");
  });

  it('runs the boot-time slot audit from createApp', () => {
    expect(APP_TS).toContain('verifySiteChromeSlots(publicDir, [');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE FOOTER COLUMN COUNT IS DATA.

   It used to be the literal 5 in three languages: the markup repeated the five
   `.footer-col` blocks, nav-unify.css hard-coded a 5 → 3 → 2 track ladder, and
   nav-ia.css hard-coded the same ladder again for the homepage. Nothing tied
   them together, so adding a sixth column would have left a five-track grid
   with a permanently empty sixth column and removing one a five-track grid
   wrapping four — both of them silent.

   Now `FOOTER_COLUMNS` is the count, the markup is generated from it, the count
   is written into `data-cols`, and `footerTrackLadder()` derives the track
   counts arithmetically (T is legal only where `N mod T !== 1`, because a
   remainder of one strands a column alone on the last row). Each stylesheet
   states what it implements in a `qf-footer-ladder:` sentinel, and the numbers
   are compared here. Change the array and this test names every sheet that has
   not caught up, with the numbers it needs.
   ═══════════════════════════════════════════════════════════════════════════ */

interface Sentinel { columns: number; wide: number; mid: number; phone: number; spanLast: boolean }

function sentinelOf(css: string): Sentinel | null {
  const m = css.match(
    /qf-footer-ladder:\s*columns=(\d+)\s+wide=(\d+)\s+mid=(\d+)\s+phone=(\d+)\s+span-last=(yes|no)/,
  );
  if (!m) return null;
  return {
    columns: Number(m[1]), wide: Number(m[2]), mid: Number(m[3]), phone: Number(m[4]),
    spanLast: m[5] === 'yes',
  };
}

const LADDER_SHEETS: ReadonlyArray<readonly [string, string]> = [
  ['nav-unify.css', read('src/server/public/nav-unify.css')],
  ['nav-ia.css', read('src/server/public/nav-ia.css')],
];

describe('the footer column count is derived, not written down twice', () => {
  it('derives an orphan-free ladder for any column count', () => {
    // `N mod T === 1` is the forbidden case at every T above 1.
    for (let n = 2; n <= 12; n += 1) {
      const l = footerTrackLadder(n);
      for (const t of [l.wide, l.mid]) {
        expect(t, `N=${n} T=${t}`).toBeGreaterThanOrEqual(1);
        if (t > 1) expect(n % t, `N=${n} in ${t} tracks strands one`).not.toBe(1);
      }
      // THE PHONE STEP TAKES TWO TRACKS ONLY WHEN TWO DIVIDE THE COUNT.
      // It used to be two unconditionally, with an odd count paying for it by
      // pinning its last column `1 / -1`. The arithmetic was legal, but once
      // the columns became collapsed disclosures the spanned column read as
      // one lone summary bar under two rows of two — the orphan SHAPE the rule
      // exists to prevent. An odd count now stacks, which the law blesses
      // without qualification (T=1 is a deliberate stack, never a remainder).
      expect(l.phone).toBe(n % 2 === 0 ? 2 : 1);
      expect(l.phone === 1 || n % l.phone === 0, `N=${n} phone remainder`).toBe(true);
      // Nothing spans any more: two tracks are only used when they divide.
      expect(l.phoneSpansLast, `N=${n} must not need a spanned column`).toBe(false);
    }
    // Worked examples: 4 cannot use three tracks (4 mod 3 === 1), 5 can.
    expect(footerTrackLadder(4).mid).toBe(2);
    expect(footerTrackLadder(5).mid).toBe(3);
    expect(footerTrackLadder(6).mid).toBe(3);
  });

  it('writes the live count into the markup so CSS can key on it', () => {
    const n = FOOTER_COLUMNS.length;
    const ladder = footerTrackLadder(n);
    expect((PREMIUM_FOOTER.match(/class="footer-col"/g) ?? []).length).toBe(n);
    expect(PREMIUM_FOOTER).toContain(`data-cols="${n}"`);
    expect(PREMIUM_FOOTER.includes('data-cols-odd')).toBe(ladder.phoneSpansLast);
    // Headings come from the array, in order — no second hand-written list.
    for (const col of FOOTER_COLUMNS) expect(PREMIUM_FOOTER).toContain(`<h4>${col.heading}</h4>`);
  });

  it.each(LADDER_SHEETS.map(([n, c]) => [n, c] as const))(
    '%s implements the ladder the column count requires',
    (name, css) => {
      const want = footerTrackLadder(FOOTER_COLUMNS.length);
      const got = sentinelOf(css);
      expect(got, `${name}: no qf-footer-ladder sentinel — the ladder is unstated`).not.toBeNull();
      expect(got, `${name} must implement ${footerColumnLadderReport()}`).toEqual({
        columns: want.columns,
        wide: want.wide,
        mid: want.mid,
        phone: want.phone,
        spanLast: want.phoneSpansLast,
      });
      // And the rules must actually be keyed on the count, so a changed count
      // stops matching them rather than inheriting a grid meant for another N.
      expect(css, name).toContain(`.premium-footer-inner[data-cols="${want.columns}"]`);
      expect(css, name).toContain(`repeat(${want.wide}, minmax(0, 1fr))`);
      expect(css, name).toContain(`repeat(${want.mid}, minmax(0, 1fr))`);
      expect(css, name).toContain(`repeat(${want.phone}, minmax(0, 1fr))`);
    },
  );
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE RESTYLE — the properties the design system actually specifies, and the
   interaction contract that had to survive it.
   ═══════════════════════════════════════════════════════════════════════════ */

const NAV_UNIFY = read('src/server/public/nav-unify.css');
const NAV_IA = read('src/server/public/nav-ia.css');
const STYLE_CSS = read('src/server/public/style.css');

describe('the header is flat, opaque and stateless', () => {
  it('defines the chrome geometry ONCE, as tokens', () => {
    for (const token of [
      '--chrome-h:', '--chrome-h-compact:', '--chrome-bg:',
      '--chrome-panel-radius:', '--chrome-panel-pad:', '--chrome-card-radius:',
      '--footer-bg:', '--footer-ink:', '--footer-link:', '--footer-accent:',
    ]) {
      expect(STYLE_CSS, token).toContain(token);
    }
    expect(STYLE_CSS).toContain('--chrome-h:          83px');
    // The footer ground is the dark surface in BOTH themes.
    expect(STYLE_CSS).toContain('--footer-bg:      var(--surface-dark)');
    expect(STYLE_CSS).toMatch(/--surface-dark:\s*#0C111D/);
  });

  it('reads those tokens from both chrome sheets — no second set of numbers', () => {
    for (const [name, css] of [['nav-unify.css', NAV_UNIFY], ['nav-ia.css', NAV_IA]] as const) {
      expect(css, name).toContain('min-height: var(--chrome-h)');
      expect(css, name).toContain('background: var(--chrome-bg)');
      expect(css, name).toContain('background: var(--footer-bg)');
      expect(css, name).toContain('border-radius: var(--chrome-panel-radius)');
      expect(css, name).toContain('padding: var(--chrome-panel-pad)');
      expect(css, name).toContain('gap: var(--chrome-panel-pad)');
      expect(css, name).toContain('border-radius: var(--chrome-card-radius)');
      // No literal height/colour that could drift from the token.
      expect(css, `${name} hard-codes the header height`).not.toContain('min-height: 83px');
    }
  });

  it('drops the border, the blur and the scroll-state change', () => {
    const wave3 = NAV_UNIFY.slice(NAV_UNIFY.indexOf('WAVE 3 — THE CHROME'));
    expect(wave3).toMatch(/\.site-header \{[^}]*border: 0;/);
    expect(wave3).toMatch(/\.site-header \{[^}]*box-shadow: none;/);
    expect(wave3).toMatch(/\.site-header \{[^}]*backdrop-filter: none;/);
    // A header that restyles itself on scroll is a second header to get wrong.
    expect(wave3).toMatch(/\.site-header \{[^}]*transition: none;/);
    expect(NAV_IA).toContain('backdrop-filter: none !important');
  });

  it('makes the mega-panel dividers out of GAP over the canvas, not borders', () => {
    for (const [name, css] of [['nav-unify.css', NAV_UNIFY], ['nav-ia.css', NAV_IA]] as const) {
      const panel = css.slice(css.indexOf('Mega-menu panel'));
      // The shell is the canvas; the groups are cards; the 4px gap between them
      // is what reads as a divider.
      expect(panel, name).toContain('background: var(--chrome-panel-bg)');
      expect(panel, name).toContain('background: var(--chrome-card-bg)');
      expect(panel, name).toMatch(/border: 0/);
      expect(panel, name).toContain('box-shadow: var(--qf-shadow-md)');
    }
  });

  /* WAVE 4. Reported as "the mega-menu is too transparent — the hero shows
     straight through it". The fill was never translucent (measured: alpha 1,
     opacity 1, backdrop-filter none, and a pixel diff of the panel interior
     taken with and without a lurid marker behind the header comes back
     byte-identical). What it lacked was an EDGE: --surface-2 shell on the --bg
     ground is 1.05:1 apart on light, and the only other cue was --qf-shadow-md
     at 4% black, invisible on light and absent on dark. These are the four
     declarations that fixed it, pinned so the next sheet to touch this panel
     cannot quietly undo them. */
  it('gives the flyout a real edge and real elevation, in BOTH themes', () => {
    for (const [name, css] of [['nav-unify.css', NAV_UNIFY], ['nav-ia.css', NAV_IA]] as const) {
      const at = css.indexOf('WAVE 4');
      expect(at, `${name} has no WAVE 4 block`).toBeGreaterThan(-1);
      const wave4 = css.slice(at);
      // Opaque, stated as a longhand so no later shorthand can slide a
      // translucent fill or an image back under the link text.
      expect(wave4, name).toContain('background-color: var(--chrome-panel-bg)');
      expect(wave4, name).toMatch(/background-image: none/);
      expect(wave4, name).toMatch(/opacity: 1/);
      // The LARGEST of the three shadow tokens, named directly rather than via
      // --shadow-lg, which the dark theme re-points at --qf-shadow-md.
      expect(wave4, name).toContain('box-shadow: var(--qf-shadow-lift)');
      expect(wave4, `${name} must not reach the flyout elevation through --shadow-lg`)
        .not.toContain('box-shadow: var(--shadow-lg)');
      // A hairline that does not depend on how the shadow renders.
      expect(wave4, name).toMatch(/border: 1px solid var\(--border-strong\)/);
      // Blur is forbidden by the design law AND is the wrong fix: it would
      // still let shapes through.
      expect(wave4, name).toMatch(/backdrop-filter: none/);
      // The drawer had no z-index at all; both surfaces now state one.
      expect(wave4, name).toMatch(/z-index: 80/);
      // `.2s ease` on open, as a keyframe: the panel is revealed by toggling
      // `hidden`, and `display` is not animatable.
      expect(wave4, name).toContain('qf-flyout-in');
      expect(wave4, name).toMatch(/animation: qf-flyout-in \.2s ease/);
      expect(wave4, `${name} must honour prefers-reduced-motion`)
        .toContain('@media (prefers-reduced-motion: reduce)');
      // The chat launcher is fixed at z-index 2147483000 in the ROOT stacking
      // context — the one thing that painted over the drawer at 375px.
      expect(wave4, name).toContain('#site-burger[aria-expanded="true"]');
      expect(wave4, name).toContain('.qf-mc-fab');
    }
  });
});

describe('the interaction contract survived the restyle', () => {
  it('keeps the drawer, the burger and their ARIA wiring in the one header', () => {
    const header = renderStaticPage('landing.html');
    expect(header).toContain('id="site-mobile-menu"');
    expect(header).toContain('id="site-burger"');
    expect(header).toMatch(/id="site-burger"[^>]*aria-expanded="false"/);
    expect(header).toMatch(/id="site-burger"[^>]*aria-controls="site-mobile-menu"/);
    expect(header).toMatch(/class="qf-theme-btn"[^>]*aria-pressed="false"/);
    expect(header).toContain('id="year"');
  });

  it('keeps the header sticky and the ONE 1023px collapse point', () => {
    for (const [name, css] of [['nav-unify.css', NAV_UNIFY], ['nav-ia.css', NAV_IA]] as const) {
      expect(css, name).toContain('@media (max-width: 1023px)');
      expect(css, `${name}: the header must stay sticky`).toMatch(/position: sticky/);
    }
    // directory/pages.ts positions its filter rail against the sticky header.
    expect(read('src/server/directory/pages.ts')).toContain('.site-header');
  });

  it('keeps every auth page on its own contextual link and no footer', () => {
    const pairs: Array<[string, string]> = [
      ['login.html', '/signup'],
      ['signup.html', '/login'],
      ['reset-password.html', '/login'],
    ];
    for (const [file, href] of pairs) {
      const html = renderStaticPage(file, { variant: 'auth', authLink: { href, label: 'x' } });
      expect(html, file).toContain(`<a class="nav-link" href="${href}">`);
      expect(count(html, '<footer'), `${file} must not grow a footer`).toBe(0);
      expect(html, file).toContain('class="qf-theme-btn"');
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   WAVE 6 — THE DRAWER OVERLAYS THE PAGE. Reported as "it opens without any
   premium android effect and when I scroll down I can actually see the hero
   section of the website under the menu, so it's pushing the website down
   instead of overlapping it".

   Both halves of that are ONE fact: the panel was laid out in normal flow as
   the last child of a `position: sticky` header, so opening it grew the
   header's flow box (the page moved down) and the document underneath was
   still free to scroll (the hero slid up behind it). Measured on main at 375:
   +762px of document on /, +786px on /directory and /tools, and a 500px wheel
   with the drawer open moved the content 500px every time.

   After: the panel is `position: fixed`, the body is pinned while it is open,
   and the same wheel moves the page 0px on all three — with 0 of 225,000
   sampled pixels changing below the drawer, and CLS 0 on open AND on close.

   These are the declarations that hold that, pinned here so the next sheet to
   touch this drawer cannot quietly put it back in flow.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('the mobile drawer overlays the page instead of displacing it', () => {
  const wave6 = (() => {
    const at = NAV_UNIFY.indexOf('WAVE 6');
    expect(at, 'nav-unify.css has no WAVE 6 block').toBeGreaterThan(-1);
    return NAV_UNIFY.slice(at);
  })();

  it('takes the panel out of flow and puts it above the chat launcher', () => {
    // The fix itself. `position: fixed` on the OPEN state — stated with the id
    // because seven sheets style `.site-mobile-menu`, three of them injected
    // after this one, most of them with !important.
    expect(wave6).toMatch(/#site-mobile-menu:not\(\[hidden\]\)\s*\{[^}]*position: fixed !important/);
    expect(wave6).toMatch(/#site-menu-scrim\s*\{[^}]*position: fixed/);
    // Above the marketing chat launcher's 2147483000 root-stacking-context FAB.
    // Declared in the script, not the sheet: the header's promotion rides the
    // same inline-!important pin as its position (see the next test).
    expect(HEADER_SCRIPTS).toContain('2147483004');
    // And the drawer must never be reachable above the collapse point.
    expect(wave6).toMatch(/min-width: 1024px[\s\S]*?#site-mobile-menu \{ display: none !important/);
  });

  it('locks the page behind it without losing the scroll position', () => {
    // Neither cheap lock survives `html, body { height: 100% }` plus the
    // homepage's `body { overflow-y: auto }`: both clamp scrollY to 0 on /.
    expect(wave6).toMatch(/html\[data-qf-menu="open"\] body\s*\{[^}]*position: fixed !important/);
    expect(wave6).toMatch(/html\[data-qf-menu="open"\] body\s*\{[^}]*top: calc\(var\(--qf-lock-y/);
    // A fixed body with the homepage's own overflow would become a second
    // scroll container and leak the lock straight back in.
    expect(wave6).toMatch(/html\[data-qf-menu="open"\] body\s*\{[^}]*overflow: visible !important/);
    // The pinned header leaves flow; --qf-lock-pad is what puts it back.
    expect(wave6).toMatch(/padding-top: var\(--qf-lock-pad/);
    // The script measures, pins, and restores.
    expect(HEADER_SCRIPTS).toContain('--qf-lock-y');
    expect(HEADER_SCRIPTS).toContain('--qf-lock-pad');
    expect(HEADER_SCRIPTS).toContain('--qf-sbw');
    expect(HEADER_SCRIPTS).toContain('window.scrollTo(0, lockY)');
    // The header pin is inline-!important, not a rule: nav-ia.css restates the
    // homepage header at (0,4,2) with `position: sticky !important` and loads
    // last, and this element cannot take an id (three tests pin the literal
    // `<header class="site-header">`).
    expect(HEADER_SCRIPTS).toMatch(/setProperty\(PIN\[i\]\[0\], PIN\[i\]\[1\], 'important'\)/);
  });

  it('frosts the panel, with an OPAQUE fallback as the base declaration', () => {
    // Progressive enhancement, so a browser without backdrop-filter gets a
    // solid sheet rather than body text floating on the hero — and so the
    // fallback cannot rot: it is the rule that always applies.
    expect(wave6).toMatch(/#site-mobile-menu:not\(\[hidden\]\)\s*\{[^}]*background-color: var\(--chrome-panel-bg\) !important/);
    expect(wave6).toMatch(/#site-mobile-menu:not\(\[hidden\]\)\s*\{[^}]*backdrop-filter: none !important/);
    const supports = wave6.slice(wave6.indexOf('@supports ((backdrop-filter'));
    expect(supports, 'the blur must live INSIDE @supports').toMatch(/backdrop-filter: blur\(var\(--qf-menu-blur\)\)/);
    expect(supports).toMatch(/-webkit-backdrop-filter: blur\(var\(--qf-menu-blur\)\)/);
    expect(supports).toMatch(/background-color: var\(--qf-menu-tint\) !important/);
    // Both themes AND the un-stamped state, which is what most visitors get.
    expect(wave6).toMatch(/html\[data-theme="dark"\]\s*\{[^}]*--qf-menu-tint/);
    expect(wave6).toMatch(/@media \(prefers-color-scheme: dark\)[\s\S]{0,400}--qf-menu-tint/);
  });

  it('animates on two durations and returns to instant under reduced motion', () => {
    // The design law's two durations, used the conventional way round.
    expect(wave6).toMatch(/--qf-menu-dur-in: \.3s;/);
    expect(wave6).toMatch(/--qf-menu-dur-out: \.2s;/);
    // The one added curve is scoped to this block and justified in it.
    expect(wave6).toMatch(/--qf-menu-ease-emphasized: cubic-bezier\(0\.2, 0, 0, 1\);/);
    expect(NAV_UNIFY.slice(0, NAV_UNIFY.indexOf('WAVE 6')),
      'the emphasised curve must not leak outside the drawer')
      .not.toContain('--qf-menu-ease-emphasized');
    const reduced = wave6.slice(wave6.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('#site-mobile-menu:not([hidden])');
    expect(reduced).toContain('#site-menu-scrim');
    expect(reduced).toContain('#site-burger .qf-burger-bar');
    expect(reduced).toMatch(/transition: none !important/);
    // The script has to shorten with it, or the panel sits invisible-but-present
    // for 200ms after every close.
    expect(HEADER_SCRIPTS).toContain("matchMedia('(prefers-reduced-motion: reduce)')");
    expect(HEADER_SCRIPTS).toMatch(/reduce\.matches \? 0 : EXIT_MS/);
  });

  it('morphs the burger rather than swapping two glyphs', () => {
    expect(SITE_BURGER_BTN).toContain('qf-burger-bar');
    expect(count(SITE_BURGER_BTN, 'qf-burger-bar')).toBe(3);
    // `display` is not animatable, which is what made the old two-icon swap a
    // hard cut.
    expect(SITE_BURGER_BTN).not.toContain('ico-open');
    expect(SITE_BURGER_BTN).not.toContain('ico-close');
    expect(wave6).toMatch(/#site-burger\[aria-expanded="true"\] \.qf-burger-bar:nth-child\(1\) \{ transform: translateY\(7px\) rotate\(45deg\)/);
    expect(wave6).toMatch(/#site-burger\[aria-expanded="true"\] \.qf-burger-bar:nth-child\(3\) \{ transform: translateY\(-7px\) rotate\(-45deg\)/);
  });

  it('names the panel, traps focus over it, and hands focus back', () => {
    const header = renderStaticPage('landing.html');
    expect(header).toContain('id="site-menu-scrim"');
    expect(header).toMatch(/id="site-mobile-menu"[^>]*role="navigation"/);
    expect(header).toMatch(/id="site-mobile-menu"[^>]*aria-label="Site menu"/);
    expect(header).toMatch(/id="site-mobile-menu"[^>]*tabindex="-1"/);
    // The burger is INSIDE the cycle: it is the close control and it lives
    // outside the panel, so a trap that excluded it would strand a keyboard
    // visitor with no way to close what they opened. Same reason the panel is
    // not `aria-modal` — that would hide the close control from assistive tech.
    expect(header).not.toContain('aria-modal');
    expect(HEADER_SCRIPTS).toContain("if (e.key !== 'Tab') return;");
    expect(HEADER_SCRIPTS).toMatch(/e\.key === 'Escape' && isOpen/);
    expect(HEADER_SCRIPTS).toMatch(/sc\.addEventListener\('click'/);
    expect(HEADER_SCRIPTS).toMatch(/giveBackFocus !== false\) b\.focus\(\)/);
    // Following a link closes WITHOUT taking focus — the page is navigating.
    expect(HEADER_SCRIPTS).toMatch(/closest\('a'\)\) close\(false\)/);
    const wave6Focus = wave6.slice(wave6.indexOf('#site-mobile-menu a:focus-visible'));
    expect(wave6Focus).toMatch(/outline: 2px solid var\(--accent\) !important/);
  });

  it('keeps the navigation usable with JavaScript disabled', () => {
    // Every route into this drawer AND into the three desktop mega-panels is a
    // script, and both ship `hidden`, which CSS cannot undo on a click. So with
    // scripting off the burger is removed and the drawer renders as a plain
    // expanded list in the header's flow — the groups are <details>, so they
    // still open and close on their own.
    expect(SITE_MOBILE_MENU_HTML).toContain('<noscript><link rel="stylesheet" href="/nav-nojs.css"></noscript>');
    const nojs = read('src/server/public/nav-nojs.css');
    expect(nojs).toMatch(/#site-burger,\s*\n#site-menu-scrim \{ display: none !important; \}/);
    expect(nojs).toMatch(/#site-mobile-menu\[hidden\] \{[^}]*display: flex !important/);
    expect(nojs).toMatch(/#site-mobile-menu\[hidden\] \{[^}]*position: static !important/);
    // Opaque in flow: there is nothing to float it over once it is on the page.
    expect(nojs).toMatch(/#site-mobile-menu\[hidden\] \{[^}]*background-color: var\(--chrome-panel-bg\) !important/);
    expect(nojs).toMatch(/\.nav-dd:focus-within > \.nav-dd-panel\[hidden\] \{ display: grid !important; \}/);
  });

  it('ships the drawer on all four shells, from the one constant', () => {
    // The scrim and the <noscript> travel WITH the panel, so a shell cannot
    // acquire one without the others — either by interpolating the drawer
    // constant itself (the directory subsite builds its own <header>) or by
    // interpolating FULL_SITE_HEADER, which already contains it.
    expect(FULL_SITE_HEADER).toContain(SITE_MOBILE_MENU_HTML);
    expect(FULL_SITE_HEADER).toContain(SITE_BURGER_BTN);
    for (const [name, src] of [
      ['directory/pages.ts', read('src/server/directory/pages.ts')],
      ['osow/hubShell.ts', read('src/server/osow/hubShell.ts')],
      ['routes/pilotCars.ts', read('src/server/routes/pilotCars.ts')],
    ] as const) {
      const wired = src.includes('SITE_MOBILE_MENU_HTML') || src.includes('FULL_SITE_HEADER');
      expect(wired, `${name} must render the drawer from the shared chrome`).toBe(true);
      expect(src, `${name} must ship the drawer's script`).toContain('HEADER_SCRIPTS');
    }
  });
});
