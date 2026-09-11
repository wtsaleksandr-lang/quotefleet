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
 *   3. THE ONE NUMBER ON THE PAGE COMES FROM THE DATABASE. The carrier count is
 *      the kind of figure that gets typed into HTML once and is wrong forever
 *      after. Pin that it moves with its input and that no literal count is
 *      sitting in the source.
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
  applyHomeSections(LANDING_SRC, { carrierTotal: null, ...opts });

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
    expect(() => applyHomeSections(withoutSlot, { carrierTotal: null })).toThrow(
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

  it('uses the generated hero wash, not a CSS gradient or a backdrop filter', () => {
    const css = strip(read('src/server/public/landing-partner-banner.css'));
    expect(css).toContain('background-color: var(--surface-hero)');
    expect(css).toContain('var(--surface-hero-grain), var(--surface-hero-image)');
    expect(css).not.toMatch(/linear-gradient|radial-gradient|conic-gradient/);
    expect(css).not.toContain('backdrop-filter');
    // No keyframes on this one — the marquee's scroll is the page's single,
    // scoped exception and it lives in its own sheet.
    expect(css).not.toContain('@keyframes');
    // Cards never lift on hover; only the button reacts.
    expect(css).not.toMatch(/\.qf-partner-card:hover/);
  });
});

describe('homepage: the logo marquee', () => {
  const LOGOS: PartnerLogo[] = [
    { name: 'Example Freight Co' },
    { name: 'Second Example Logistics', href: '/directory' },
  ];

  it('ships EMPTY, because a partner logo is a claim we cannot yet make', () => {
    expect(HOME_PARTNER_LOGOS).toHaveLength(0);
    expect(renderLogoMarquee(HOME_PARTNER_LOGOS, 331482)).toBe('');
  });

  it('puts no section, no stylesheet and no script on the page while it is empty', () => {
    const html = served();
    expect(html).not.toContain('qf-marquee');
    expect(html).not.toContain(MARQUEE_STYLESHEET);
    expect(html).not.toContain(MARQUEE_SCRIPT);
  });

  it('appears — with its stylesheet and script — as soon as the array has entries', () => {
    const html = served({ logos: LOGOS, carrierTotal: 331482 });
    expect(html).toContain('class="section qf-marquee-section"');
    expect(html).toContain(`<link rel="stylesheet" href="${MARQUEE_STYLESHEET}">`);
    expect(html).toContain(MARQUEE_SCRIPT);
    expect(html.indexOf(MARQUEE_STYLESHEET)).toBeLessThan(html.indexOf('</head>'));
  });

  it('builds a seamless two-row strip and names every company on exactly one of them', () => {
    const out = renderLogoMarquee(LOGOS, 1000);
    const rows = out.match(/<ul class="qf-marquee__row"[^>]*>/g) ?? [];
    expect(rows).toHaveLength(2);
    // The duplicate exists for the loop, not for the reader.
    expect(rows[1]).toContain('aria-hidden="true"');
    expect(out).toContain('>Example Freight Co<');
  });

  it('falls back to a monogram built from the company\'s own name, never a borrowed mark', () => {
    const out = renderLogoMarquee([{ name: 'Example Freight Co' }], 1000);
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
});

describe('homepage: the carrier count is read, not typed', () => {
  const LOGOS: PartnerLogo[] = [{ name: 'Example Freight Co' }];

  it('renders whatever the directory reports, formatted', () => {
    expect(renderLogoMarquee(LOGOS, 331482)).toContain('331,482 carriers');
    // A different directory size gives a different heading — the number tracks
    // its input rather than being decoration around a constant.
    expect(renderLogoMarquee(LOGOS, 7)).toContain('7 carriers');
    expect(renderLogoMarquee(LOGOS, 7)).not.toContain('331,482');
  });

  it('omits the number entirely rather than guessing when the count is unknown', () => {
    const out = renderLogoMarquee(LOGOS, null);
    expect(out).toContain('Carriers listed in the QuoteFleet directory');
    expect(out).not.toMatch(/\d[\d,]*\s+carriers/);
  });

  it('has no carrier-count literal anywhere in the source of the band', () => {
    // A four-or-more digit run (with or without separators) in either the
    // module or the markup is how this drifts: someone pastes today's total in
    // and it is wrong by the next ingest.
    const bandMarkup = strip(LANDING_SRC.slice(LANDING_SRC.indexOf(LEGACY_SECTIONS_SLOT)));
    for (const [label, src] of [
      // MIN_TILES_PER_ROW / the cache TTL are structural constants, not claims;
      // neither is a number the page prints.
      ['homeSections.ts', strip(MODULE_SRC).replace(/^.*(TTL_MS|MIN_TILES_PER_ROW).*$/gm, '')],
      ['the new homepage band', bandMarkup],
    ] as const) {
      const counts = src.match(/\b\d{1,3}(,\d{3})+\b|\b\d{4,}\b/g) ?? [];
      expect(counts, `${label} must not carry a hard-coded count`).toEqual([]);
    }
  });

  it('states a directory size, not a customer or partner count', () => {
    const out = renderLogoMarquee(LOGOS, 331482);
    expect(out).toContain('listed in the QuoteFleet directory');
    expect(out).not.toMatch(/customers|clients|trusted by|companies use/i);
  });
});
