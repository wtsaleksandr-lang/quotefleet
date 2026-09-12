/**
 * THE HOMEPAGE BELOW-THE-BENTO-GRID BAND.
 *
 * Three claims are worth pinning here, and each one is a claim a future edit
 * could quietly break:
 *
 *   1. THE HIDDEN SECTIONS ARE HIDDEN, AND STILL RECOVERABLE. Not "styled
 *      display:none" — genuinely absent from the bytes the visitor receives —
 *      while the markup is intact in the partial and comes back from flipping
 *      one flag. A test that only asserted "absent" would be happy with a
 *      `git rm`, which is exactly what was NOT asked for.
 *
 *   2. AN EMPTY MARQUEE SHIPS NOTHING. No section, no stylesheet, no script.
 *      The section is populated from a data array that is deliberately empty,
 *      and "empty" has to mean invisible, not "an empty strip with a heading".
 *
 *   3. THE HEADING CLAIMS NOTHING ABOUT THE COMPANIES UNDER IT. The tiles are
 *      other people's marks, shown because those carriers are LISTED IN an
 *      FMCSA-derived directory. "Built for drivers, brokers and importers" is a
 *      statement about QuoteFleet; "trusted by", a customer count, or any
 *      number at all next to a wall of logos is a statement about them that
 *      none of them has made. Pin the copy, and pin the absence of a count —
 *      including the one this section used to carry honestly.
 *
 *   4. THE STRIP LOOPS SEAMLESSLY AND AT A FIXED PACE. Both are properties of
 *      the stylesheet that a well-meaning edit can silently break: a computed
 *      pixel advance reintroduces the once-per-cycle jump, and a constant
 *      duration makes the scroll speed a function of how many carriers are in
 *      the registry.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyHomeSections,
  renderLogoMarquee,
  HOME_LEGACY_SECTIONS_ENABLED,
  HOME_LEGACY_SECTION_ASSETS,
  HOME_PARTNER_LOGOS,
  LEGACY_SECTIONS_SLOT,
  LOGO_MARQUEE_SLOT,
  MARQUEE_SCRIPT,
  MARQUEE_STYLESHEET,
  verifyHomeSectionSlots,
  type PartnerLogo,
} from './homeSections.js';
import { CURATED_CARRIER_LOGOS, carrierLogoPaths, curatedWideLogoForUsdot } from '../directory/carrierLogos.js';

const publicDir = resolve(process.cwd(), 'src/server/public');
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

/** Comments explain the rules; they are not the code the rules are about. A
 *  sheet whose header says "zero backdrop-filter" must not read as a sheet that
 *  uses one, and a comment dating the change must not read as a hard-coded
 *  count. Every source assertion below runs against the stripped text. */
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/<!--[\s\S]*?-->/g, ' ');

const LANDING_SRC = read('src/server/public/landing.html');
const LEGACY_PARTIAL = read('src/server/home/legacy-below-grid.html');
const MODULE_SRC = read('src/server/home/homeSections.ts');

/** The homepage as served, minus the injected site chrome (which this module
 *  does not touch): landing.html with both below-the-grid slots filled. */
const served = (opts?: Parameters<typeof applyHomeSections>[1]) =>
  applyHomeSections(LANDING_SRC, { ...opts });

/** Markers unique to the sections that were taken off the page. */
const HIDDEN_MARKERS = [
  'class="section how-section"',
  'qf-showcase-section',
  'compare-simple-section',
  'qf-included-section',
  'qf-multimode-section',
  'use-section',
  'qf-wins-section',
  'faq-grid',
  'qf-trust-section',
  'final-section',
];

describe('homepage: the hidden below-the-grid band', () => {
  it('ships the page with BOTH slots present so neither fill can silently no-op', () => {
    expect(LANDING_SRC).toContain(LEGACY_SECTIONS_SLOT);
    expect(LANDING_SRC).toContain(LOGO_MARQUEE_SLOT);
    expect(() => verifyHomeSectionSlots(publicDir)).not.toThrow();
  });

  it('throws rather than quietly dropping a section when a slot goes missing', () => {
    const withoutSlot = LANDING_SRC.replace(LEGACY_SECTIONS_SLOT, '');
    expect(() => applyHomeSections(withoutSlot)).toThrow(
      /home legacy sections/,
    );
  });

  it('renders NONE of the hidden sections — they are absent, not display:none', () => {
    // Stripped: landing.html keeps a comment NAMING what moved out, which is
    // the point of the comment and must not read as the markup itself.
    const html = strip(served());
    for (const marker of HIDDEN_MARKERS) {
      expect(html, `${marker} must not reach the homepage`).not.toContain(marker);
    }
    // Copy that only ever lived below the grid.
    expect(html).not.toContain('Every promise in writing');
    expect(html).not.toContain('Launch your branded quote tool in 5 minutes');
    // And no <video>: the marketing clips went with the sections, which is
    // why the two video scripts could be unlinked.
    expect(html).not.toContain('<video');
  });

  it('keeps every hidden section intact in the partial, so the hide is reversible', () => {
    for (const marker of HIDDEN_MARKERS) {
      expect(LEGACY_PARTIAL, `${marker} must survive in the partial`).toContain(marker);
    }
    // The inline trust-badge handler moved with the markup it drives.
    expect(LEGACY_PARTIAL).toContain(".qf-trust-badges .qf-badge");
    // The partial lives OUTSIDE src/server/public, so express.static cannot
    // serve it back by accident.
    expect(() => readFileSync(resolve(publicDir, 'legacy-below-grid.html'))).toThrow();
  });

  it('restores the whole band from the single flag, in its original position', () => {
    expect(HOME_LEGACY_SECTIONS_ENABLED).toBe(false);
    const restored = served({ legacyEnabled: true });
    for (const marker of HIDDEN_MARKERS) {
      expect(restored, `${marker} must return when the flag is on`).toContain(marker);
    }
    // Original position: straight after the tool bento grid and before the new
    // partner banner, exactly where the slot sits.
    expect(restored.indexOf('qf-toolgrid-section')).toBeLessThan(restored.indexOf('how-section'));
    expect(restored.indexOf('how-section')).toBeLessThan(restored.indexOf('qf-partner-section'));
  });

  it('loads nothing for content that no longer renders', () => {
    const html = served();
    for (const asset of HOME_LEGACY_SECTION_ASSETS) {
      expect(html, `${asset} must not be fetched by a page that cannot use it`).not.toContain(
        `"${asset}"`,
      );
    }
    // Unlinked, NOT deleted — every one is still on disk with its tests.
    for (const asset of HOME_LEGACY_SECTION_ASSETS) {
      expect(() => readFileSync(resolve(publicDir, asset.slice(1)))).not.toThrow();
    }
  });
});

describe('homepage: the partner / embed banner', () => {
  const html = served();

  it('renders one banner whose CTA points at a route that exists', () => {
    expect(html).toContain('class="section qf-partner-section"');
    expect(html).toContain('Become a partner');
    // /w/demo is the live embeddable widget — the surface /embed.js loads.
    expect(html).toContain('class="qf-partner-cta" href="/w/demo"');
  });

  it('is two-tone, with an icon tile and a single CTA', () => {
    expect(html).toContain('qf-partner-ico');
    expect(html).toContain('qf-partner-title__soft');
    expect(html.match(/qf-partner-cta"/g) ?? []).toHaveLength(1);
  });

  it('uses the generated grain tiles, not a CSS gradient or a backdrop filter', () => {
    const css = strip(read('src/server/public/landing-partner-banner.css'));
    expect(css).toContain('background-color: var(--surface-hero)');
    // The wash raster itself is GONE from this card. It became a pixel-pinned
    // vertical fade whose top 475 rows are saturated azure, and there is no
    // crop of that a 260px-tall band with dark ink on it can take. Its flat
    // tail is `--surface-hero` by construction, so the token alone is
    // pixel-identical to sampling it. What the card keeps is the texture.
    expect(css).toContain('var(--surface-hero-grain), var(--surface-hero-grain-ink)');
    expect(css).not.toContain('--surface-hero-image');
    expect(css).not.toMatch(/linear-gradient|radial-gradient|conic-gradient/);
    expect(css).not.toContain('backdrop-filter');
    // No keyframes on this one — the marquee's scroll is the page's single,
    // scoped exception and it lives in its own sheet.
    expect(css).not.toContain('@keyframes');
    // Cards never lift on hover; only the button reacts.
    expect(css).not.toMatch(/\.qf-partner-card:hover/);
  });

  it('suppresses the frame divider on both new sections, which have no top padding', () => {
    // landing-frame.css paints a 1px rule at `top: 0` of every `main > section`
    // at z-index 4, on the assumption of `.section { padding: 72px 0 }` — i.e.
    // that the line lands in empty space. These two sections deliberately have
    // NO top padding, so it would paint across the partner card's own border
    // and the marquee's heading: the exact artifact #545 removed from the hero
    // when #535's `.hero` -> `.qf-hhero` rename orphaned its exemption.
    const frame = strip(read('src/server/public/landing-frame.css'));
    expect(frame).toContain('main > section::after');
    expect(frame).toMatch(/main > section\.hero::after \{\s*display: none/);

    const css = strip(read('src/server/public/landing-partner-banner.css'));
    expect(css).toMatch(/main > section\.qf-partner-section::after/);
    expect(css).toMatch(/main > section\.qf-marquee-section::after/);
    // The premise: zero top padding is what makes the divider land on content.
    expect(css).toMatch(/\.qf-partner-section \{\s*padding: 0 0 80px !important/);
    const marquee = strip(read('src/server/public/landing-logo-marquee.css'));
    expect(marquee).toMatch(/\.qf-marquee-section \{\s*padding: 0 0 80px !important/);
  });

  it('wears the icon tile and button hover the rest of the page wears', () => {
    // #545 gave all fifteen cards a 48px tinted icon tile and moved every
    // primary button's hover to the brand fill with a 4px chevron slide. A
    // banner sitting directly under those cards must not invent a third look.
    const css = strip(read('src/server/public/landing-partner-banner.css'));
    expect(css).toContain('background: var(--icon-tile-bg)');
    expect(css).toContain('color: var(--accent-legible)');
    expect(css).toContain('background: var(--accent-fill)');
    expect(css).toMatch(/\.qf-partner-cta:hover \.qf-partner-cta__chev \{\s*transform: translateX\(4px\)/);
    // The dead `--cta-bg-hover` repaint #545 retired must not come back.
    expect(css).not.toContain('--cta-bg-hover');
  });
});

describe('homepage: the logo marquee', () => {
  const LOGOS: PartnerLogo[] = [
    { name: 'Example Freight Co' },
    { name: 'Second Example Logistics', href: '/directory' },
  ];

  it('is DERIVED from the curated registry, so it cannot drift from the directory', () => {
    // The one invariant that matters: the strip and the directory's own logo
    // slot read the same list. A second hand-kept array is how a company ends
    // up with one mark on the homepage and a different one on its profile.
    expect(HOME_PARTNER_LOGOS).toHaveLength(CURATED_CARRIER_LOGOS.length);
    expect(HOME_PARTNER_LOGOS.map((l) => l.name)).toEqual(
      CURATED_CARRIER_LOGOS.map((c) => c.displayName),
    );
    for (const c of CURATED_CARRIER_LOGOS) {
      const tile = HOME_PARTNER_LOGOS.find((l) => l.name === c.displayName);
      // A curated carrier with artwork carries the WIDE crop of exactly the
      // mark the directory resolves for the same USDOT; one without carries no
      // src at all and falls through to the monogram.
      expect(tile?.src ?? null).toBe(c.logo ? carrierLogoPaths(c.logo).wide : null);
      if (c.logo) expect(curatedWideLogoForUsdot(c.usdot)).toBe(tile?.src);
    }
  });

  it('still ships NOTHING — no section, stylesheet or script — when the list is empty', () => {
    // The empty-means-absent contract is what lets the registry be emptied
    // (a takedown request, say) without leaving a headed, tile-less strip.
    expect(renderLogoMarquee([])).toBe('');
    const html = served({ logos: [] });
    expect(html).not.toContain('qf-marquee');
    expect(html).not.toContain(MARQUEE_STYLESHEET);
    expect(html).not.toContain(MARQUEE_SCRIPT);
  });

  it('appears — with its stylesheet and script — as soon as the array has entries', () => {
    const html = served({ logos: LOGOS });
    expect(html).toContain('class="section qf-marquee-section"');
    expect(html).toContain(`<link rel="stylesheet" href="${MARQUEE_STYLESHEET}">`);
    expect(html).toContain(MARQUEE_SCRIPT);
    expect(html.indexOf(MARQUEE_STYLESHEET)).toBeLessThan(html.indexOf('</head>'));
  });

  it('builds a seamless two-row strip and names every company on exactly one of them', () => {
    const out = renderLogoMarquee(LOGOS);
    const rows = out.match(/<ul class="qf-marquee__row"[^>]*>/g) ?? [];
    expect(rows).toHaveLength(2);
    // The duplicate exists for the loop, not for the reader.
    expect(rows[1]).toContain('aria-hidden="true"');
    expect(out).toContain('>Example Freight Co<');
  });

  it('publishes the rendered tile count, and it matches the tiles it rendered', () => {
    // The stylesheet multiplies this by a per-tile pace to get the cycle
    // length, so a count that disagrees with the DOM is a strip running at the
    // wrong speed. The loop GEOMETRY does not depend on it (see below), which
    // is why being wrong here is a pace bug and not a seam.
    const out = renderLogoMarquee(LOGOS);
    const declared = Number(out.match(/--qf-marquee-tiles:\s*(\d+)/)?.[1]);
    // Count the tiles in the FIRST row only — the second is the loop's copy.
    const firstRow = out.slice(0, out.indexOf('<ul class="qf-marquee__row" role="list" aria-hidden'));
    const perRow = (firstRow.match(/<li class="qf-logo-tile">/g) ?? []).length;
    expect(declared).toBe(perRow);
    // A two-entry list is padded up to MIN_TILES_PER_ROW, so the count tracks
    // what was RENDERED rather than what was passed in.
    expect(declared).toBeGreaterThan(LOGOS.length);
    // The real registry is long enough that no padding happens at all.
    expect(Number(renderLogoMarquee(HOME_PARTNER_LOGOS).match(/--qf-marquee-tiles:\s*(\d+)/)?.[1]))
      .toBe(HOME_PARTNER_LOGOS.length);
  });

  it('loads its tiles eagerly, because a transformed strip defeats lazy loading', () => {
    // A lazy image loads on intersection, and these tiles are moved by a
    // transform inside an `overflow: clip` box — so the ones off to the right
    // would pop in exactly as the animation carried them past the cut.
    const out = renderLogoMarquee([{ name: 'Example Freight Co', src: '/carrier-logos/example.webp' }]);
    expect(out).toContain('<img');
    expect(out).not.toContain('loading="lazy"');
    expect(out).toContain('fetchpriority="low"');
  });

  it('falls back to a monogram built from the company\'s own name, never a borrowed mark', () => {
    const out = renderLogoMarquee([{ name: 'Example Freight Co' }]);
    expect(out).toContain('qf-logo-tile__mono');
    expect(out).toContain('>EF<'); // monogramInitials('Example Freight Co')
    expect(out).not.toContain('<img');
  });

  it('runs ONE named, contained animation and honours prefers-reduced-motion', () => {
    const css = read('src/server/public/landing-logo-marquee.css');
    const names = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
    expect(names).toEqual(['qf-logo-marquee-scroll']);
    // Paused by default; only runs while the strip is on screen.
    expect(css).toContain('animation-play-state: paused');
    expect(css).toContain('.qf-marquee.is-inview .qf-marquee__track');
    // Reduced motion: no animation, and a manually scrollable single row.
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('animation: none');
    expect(reduced).toContain('overflow-x: auto');
    expect(reduced).toContain('.qf-marquee__row[aria-hidden="true"] { display: none; }');
  });

  it('keeps the loop self-correcting and the pace independent of list length', () => {
    const css = strip(read('src/server/public/landing-logo-marquee.css'));
    // THE SEAM. A half-track translate always matches whatever was laid out, so
    // adding a carrier cannot introduce a jump. A hand-computed pixel advance
    // could, which is why one must not appear here.
    expect(css).toMatch(/to\s*\{\s*transform:\s*translate3d\(-50%, 0, 0\)/);
    // THE PACE. Duration is tiles × per-tile seconds, so eleven tiles and
    // twenty-six tiles travel at the same px/s. A bare `60s` is the regression.
    expect(css).toContain('calc(var(--qf-marquee-tiles, 12) * var(--qf-marquee-tile-secs))');
    expect(css).not.toMatch(/animation:\s*qf-logo-marquee-scroll\s+\d+s/);
    // The two rows are separated by exactly the in-row gap, or the join reads
    // as a wide seam once per cycle.
    const row = css.slice(css.indexOf('.qf-marquee__row {'));
    expect(row).toMatch(/gap: 24px/);
    expect(row).toMatch(/margin: 0 24px 0 0/);
  });

  it('paints the tiles on a light surface in BOTH themes, so no mark can vanish', () => {
    // These tiles hold other companies' artwork, drawn for a light ground and
    // not ours to invert or filter. Flipping the tile with the theme does not
    // adapt the wall — it deletes whichever marks happen to be dark (Werner,
    // TCI) and leaves the rest untouched.
    const css = strip(read('src/server/public/landing-logo-marquee.css'));
    expect(css).toContain('--qf-logo-tile-bg:');
    expect(css).toMatch(/\.qf-logo-tile \{[^}]*background: var\(--qf-logo-tile-bg\)/);
    expect(css).toMatch(/\.qf-logo-tile \{[^}]*border: 1px solid var\(--qf-logo-tile-border\)/);
    // The tile surface must NOT be one of the flipping theme tokens.
    expect(css).not.toMatch(/\.qf-logo-tile \{[^}]*background: var\(--surface/);
    // …and nothing else in the sheet may hardcode a colour: exactly the three
    // pinned tile values, all declared together on the one scope.
    const literals = [...css.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((m) => m[0]);
    expect(literals).toHaveLength(3);
  });

  it('sizes the tile to the artwork canvas so no mark is resampled down', () => {
    // Every mark is normalised onto a 220x96 sheet with its optical weight
    // matched to the rest. A narrower tile silently rescales all of them, and
    // the 180x96-with-padding this section shipped with rescaled them to ~59%.
    // 222x98 with `border-box` is that canvas plus its 1px rim, so the CONTENT
    // box is exactly 220x96 and no mark is resampled at all.
    const css = strip(read('src/server/public/landing-logo-marquee.css'));
    const tile = css.slice(css.indexOf('.qf-logo-tile {'), css.indexOf('.qf-logo-tile__link'));
    expect(tile).toMatch(/box-sizing: border-box/);
    expect(tile).toMatch(/width: 222px/);
    expect(tile).toMatch(/height: 98px/);
    expect(tile).toMatch(/padding: 0/);
  });
});

describe('homepage: the marquee heading claims nothing about the companies below it', () => {
  const LOGOS: PartnerLogo[] = [{ name: 'Example Freight Co' }];

  it('says who the product is FOR, in two tones and one size', () => {
    const out = renderLogoMarquee(LOGOS);
    expect(out).toContain('>Built for<');
    expect(out).toContain('>drivers, brokers and importers<');
    expect(out).toContain('qf-marquee-head__lead');
    expect(out).toContain('qf-marquee-head__soft');
  });

  it('never implies these carriers use, trust or endorse QuoteFleet', () => {
    // The tiles are marks of companies with NO relationship to QuoteFleet. This
    // is the assertion that stops a future copy edit from turning a directory
    // listing into a customer claim.
    const out = renderLogoMarquee(HOME_PARTNER_LOGOS);
    expect(out).not.toMatch(
      /customers?|clients?|trusted by|companies use|our partners|powered by|work with us|join \d/i,
    );
  });

  it('prints NO count anywhere in the band — not of carriers, and not of users', () => {
    // The heading used to state the directory's size. It was sourced and it was
    // true, but a figure above a wall of other people's logos invites the
    // reader to bind the two, so the number went and the plumbing with it.
    const bandMarkup = strip(LANDING_SRC.slice(LANDING_SRC.indexOf(LEGACY_SECTIONS_SLOT)));
    for (const [label, src] of [
      // MIN_TILES_PER_ROW is a structural constant, not a claim the page prints.
      ['homeSections.ts', strip(MODULE_SRC).replace(/^.*MIN_TILES_PER_ROW.*$/gm, '')],
      ['the new homepage band', bandMarkup],
      ['the rendered marquee', strip(renderLogoMarquee(HOME_PARTNER_LOGOS))],
    ] as const) {
      const counts = src.match(/\b\d{1,3}(,\d{3})+\b|\b\d{4,}\b/g) ?? [];
      expect(counts, `${label} must not carry a hard-coded count`).toEqual([]);
    }
    expect(renderLogoMarquee(LOGOS)).not.toMatch(/\b\d[\d,]*\s+(carriers|shippers|users|companies|businesses)\b/i);
  });

  it('reads no database at all — the band is a pure function of committed data', () => {
    // `applyHomeSections` used to take a carrier total fetched behind a cache.
    // Nothing here may reach for the directory's queries again: the homepage's
    // request path has no DB dependency and this is what keeps it that way.
    expect(strip(MODULE_SRC)).not.toContain('getPersistedCarrierTotal');
    expect(strip(MODULE_SRC)).not.toContain("from '../directory/queries.js'");
    expect(renderLogoMarquee(HOME_PARTNER_LOGOS)).toBe(renderLogoMarquee(HOME_PARTNER_LOGOS));
  });
});
