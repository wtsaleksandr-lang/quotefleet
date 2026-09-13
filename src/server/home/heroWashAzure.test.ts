/**
 * THE CARD ICONS AND THE HERO WASH ARE ONE COLOUR DECISION.
 *
 * #552 moved the hero card's backdrop onto the owner's reference azure (hue
 * 198) and left the fifteen card icon tiles on the brand indigo (hue 229),
 * which is the mismatch the owner then reported. The fix was not "paint the
 * icons blue-green" — it was to DERIVE them from the wash, so that the next
 * re-tune of the band cannot leave the icons behind a second time.
 *
 * The wash is a raster. Its colours live in ONE place —
 * `scripts/make-hero-wash.mjs`'s VARIANTS table — and they are numbers in a
 * generator, not tokens a stylesheet can read. So this file is the join: it
 * parses the generator's own anchors and asserts the CSS tokens still equal
 * them. Change the band and this test tells you the icons have to move too.
 *
 * What is pinned, and why each one matters:
 *
 *   1. `--hero-azure-rgb` IS the light band's `base` anchor. It is the tile's
 *      tint, so a tile is literally a 10% dilution of the band above it.
 *   2. `--hero-azure-deep` IS the light band's `deep` anchor (its top edge).
 *      The glyph is a step down the same band rather than a second blue,
 *      because `base` on its own dilution measures 4.18:1 — over the 3:1 floor
 *      for a non-text graphic but under the AA bar #545 set for this glyph.
 *      This is ALSO the second of the two bounds that stopped the re-tuned
 *      band going as light as the owner's reference: `deep` is the band's top
 *      edge, and at #026A98 the glyph measures 4.75:1 on its tile, i.e. about
 *      one step from failing. Lifting the top edge further means giving the
 *      icons a colour that is no longer the band's.
 *   3. THE HUES AGREE. Every azure token, and the band, inside a degree of
 *      198 — and all of them a good 25+ degrees off `--accent`'s 229, which is
 *      the whole point of the change.
 *   4. THE DARK LIFT IS THE SITE'S OWN LIFT. Dark has no azure in the wash
 *      light enough to draw with (its band bottoms out near-black), so
 *      `--hero-azure-lift` is the light band lifted by the same relative-
 *      luminance factor that `--footer-accent` lifts `--accent-fill` by. Not a
 *      colour picked by eye.
 *   5. AA IN BOTH THEMES, on the composited tile, worst ground.
 *   6. THE SCOPE HELD. `--accent`, `--accent-fill`, `--accent-legible` and
 *      `--icon-tile-bg` keep their indigo values — the owner asked for the
 *      icons, not the palette, and the directory's carrier-profile tiles read
 *      `--icon-tile-bg` too.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const STYLE = read('src/server/public/style.css');
const GRID = read('src/server/public/landing-home-grid.css');
const GENERATOR = read('scripts/make-hero-wash.mjs');

type RGB = [number, number, number];

/** `{ name: 'hero-wash-light', ..., deep: [2, 106, 152], base: [4, 117, 168], sky: [...] }` */
function generatorAnchors(variant: string): { deep: RGB; base: RGB; sky: RGB } {
  const entry = GENERATOR.split(/\{\s*name:/)
    .find((chunk) => chunk.startsWith(` '${variant}'`));
  if (!entry) throw new Error(`no '${variant}' variant in make-hero-wash.mjs`);
  const triple = (key: string): RGB => {
    const m = entry.match(new RegExp(`${key}:\\s*\\[\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*\\]`));
    if (!m) throw new Error(`no ${key} anchor on '${variant}'`);
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  };
  return { deep: triple('deep'), base: triple('base'), sky: triple('sky') };
}

/** The value side of a `--token:` declaration in the :root (light) block. */
function token(css: string, name: string): string {
  const m = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`no --${name} in stylesheet`);
  return m[1].trim();
}

const hexToRgb = (h: string): RGB => {
  const v = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)) as RGB;
};
const channel = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: RGB) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const contrast = (a: RGB, b: RGB) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const composite = (fg: RGB, alpha: number, bg: RGB): RGB =>
  fg.map((c, i) => c * alpha + bg[i] * (1 - alpha)) as RGB;
const hue = ([r, g, b]: RGB) => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return ((h * 60) % 360 + 360) % 360;
};

const LIGHT_BAND = generatorAnchors('hero-wash-light');
const AZURE_RGB = token(STYLE, 'hero-azure-rgb').split(',').map((n) => Number(n.trim())) as RGB;
const AZURE_DEEP = hexToRgb(token(STYLE, 'hero-azure-deep'));
const AZURE_LIFT = hexToRgb(token(STYLE, 'hero-azure-lift'));

describe('the card icon tile is derived from the hero wash', () => {
  it('takes its tint straight from the light band\'s `base` anchor', () => {
    expect(AZURE_RGB).toEqual(LIGHT_BAND.base);
    // ...and the tile is that tint, at the alphas #545 measured for the tile.
    expect(token(STYLE, 'icon-tile-azure-bg')).toBe('rgba(var(--hero-azure-rgb), 0.10)');
    expect(STYLE).toContain('--icon-tile-azure-bg: rgba(var(--hero-azure-rgb), 0.28)');
  });

  it('takes its glyph from the same band\'s `deep` anchor, not a second blue', () => {
    expect(AZURE_DEEP).toEqual(LIGHT_BAND.deep);
    expect(token(STYLE, 'icon-azure')).toBe('var(--hero-azure-deep)');
    expect(STYLE).toContain('--icon-azure:         var(--hero-azure-lift)');
  });

  it('is ONE hue — the wash\'s 198, a long way from the accent\'s 229', () => {
    for (const rgb of [LIGHT_BAND.base, LIGHT_BAND.deep, AZURE_RGB, AZURE_DEEP, AZURE_LIFT]) {
      expect(hue(rgb)).toBeGreaterThan(197);
      expect(hue(rgb)).toBeLessThan(199);
    }
    // The mismatch this change exists to close: the brand accent is elsewhere.
    expect(hue(hexToRgb('#3356EE'))).toBeGreaterThan(225);
  });

  /**
   * THE BAND'S CEILING IS A CONTRAST BOUND, AND THIS IS WHERE IT IS WRITTEN
   * DOWN. The owner asked for the wash to be lighter and to keep brightening
   * on the way down, against a reference whose sky reaches rgb(6,140,198) at
   * 40% — 3.77:1 for white, i.e. a sky that cannot carry body copy and, in the
   * reference, does not have to. Our card runs an 18px carriers lead and a
   * 16px shippers lead on the band down to y=417, so `base` is pinned to the
   * lightest azure that still clears AA for white BODY text before the grain
   * is on it. If a future re-tune wants a lighter band it has to move the copy
   * off the band first; this test is the thing that will say so.
   */
  it('tops the band out at the lightest azure white body copy can sit on', () => {
    const white: RGB = [255, 255, 255];
    expect(contrast(white, LIGHT_BAND.base)).toBeGreaterThanOrEqual(4.5);
    // ...and it really is at the ceiling: one more step of the same climb
    // (the per-channel delta from `deep` to `base`) would fail.
    const overshoot = LIGHT_BAND.base.map(
      (c, i) => Math.min(255, c + (c - LIGHT_BAND.deep[i])),
    ) as RGB;
    expect(contrast(white, overshoot)).toBeLessThan(4.5);
    // The band CLIMBS. `deep` is the top edge and `base` the body, so a
    // re-tune that makes the top the brighter of the two has inverted the
    // fade the owner asked for rather than adjusted it.
    expect(luminance(LIGHT_BAND.base)).toBeGreaterThan(luminance(LIGHT_BAND.deep));
    // `sky` is the waypoint the ramp opens up through on its way to white —
    // the thing that makes the run read as a fade rather than a dump. It is
    // the same hue family as the band, and unambiguously lighter than it.
    expect(hue(LIGHT_BAND.sky)).toBeGreaterThan(197);
    expect(hue(LIGHT_BAND.sky)).toBeLessThan(200);
    expect(luminance(LIGHT_BAND.sky)).toBeGreaterThan(luminance(LIGHT_BAND.base) * 2.5);
  });

  it('lifts for dark by the same factor the site already lifts its accent', () => {
    const factor = luminance(hexToRgb('#8DA2F9')) / luminance(hexToRgb('#3356EE'));
    const target = luminance(AZURE_RGB) * factor;
    // Within 2% of the target luminance — i.e. derived, not eyeballed.
    expect(Math.abs(luminance(AZURE_LIFT) - target) / target).toBeLessThan(0.02);
  });

  it('is AA on the composited tile, worst ground, in BOTH themes', () => {
    // Light: the bento card's `--surface-2` is the darkest ground a light tile
    // sits on, so it is the worst case for a dark glyph.
    const lightTile = composite(AZURE_RGB, 0.10, hexToRgb('#F2F4F7'));
    expect(contrast(AZURE_DEEP, lightTile)).toBeGreaterThanOrEqual(4.5);
    // Dark: both grids' cards are `--surface-2` #1A2333.
    const darkTile = composite(AZURE_RGB, 0.28, hexToRgb('#1A2333'));
    expect(contrast(AZURE_LIFT, darkTile)).toBeGreaterThanOrEqual(4.5);
    // And the reason dark lifts at all, stated as a measurement.
    expect(contrast(AZURE_RGB, darkTile)).toBeLessThan(3);
  });

  it('is what the card tiles actually paint with', () => {
    expect(GRID).toContain('background: var(--icon-tile-azure-bg)');
    expect(GRID).toContain('color: var(--icon-azure)');
  });

  it('left the brand accent where it was — this was the icons, not the palette', () => {
    // The indigo tokens keep their values. `--icon-tile-bg`/`--accent-legible`
    // in particular are read by the directory's carrier-profile tiles, which
    // this change is explicitly not touching.
    expect(STYLE).toContain('--accent-legible: var(--accent-fill)');
    expect(STYLE).toContain('--icon-tile-bg:   rgba(51, 86, 238, 0.10)');
    expect(STYLE).toContain('--icon-tile-bg:   rgba(51, 86, 238, 0.28)');
    expect(read('src/server/directory/pages.ts')).toContain('background: var(--icon-tile-bg)');
  });
});

describe('the card puts its icon on the title\'s line', () => {
  const cardRule = (selector: string) => {
    const m = GRID.match(new RegExp(`\\n\\${selector} \\{([^}]*)\\}`));
    if (!m) throw new Error(`no rule for ${selector}`);
    return m[1];
  };

  it('lays both grids\' cards out as a two-column grid', () => {
    for (const sel of ['.qf-hcard', '.qf-toolcard']) {
      const rule = cardRule(sel);
      expect(rule).toContain('display: grid');
      expect(rule).toContain('grid-template-columns: auto minmax(0, 1fr)');
      // Row 2 is the `1fr` that floor-pins the action bar now that the card is
      // not a flex column — without it every card's buttons float up to their
      // own content height and #545's shared baseline is gone.
      expect(rule).toContain('grid-template-rows: auto 1fr auto');
    }
  });

  it('puts the tile and the title in row 1, both vertically centred', () => {
    expect(GRID).toMatch(/\.qf-toolcard__ico \{\s*grid-column: 1;\s*grid-row: 1;\s*align-self: center;/);
    expect(GRID).toMatch(/\.qf-toolcard__body h3 \{\s*grid-column: 2;\s*grid-row: 1;\s*align-self: center;/);
  });

  it('drops the body wrapper into the grid instead of rewriting fifteen cards', () => {
    // `display: contents` is what lets the h3 and the sub land in different
    // grid areas while the markup stays exactly as #545 left it.
    expect(GRID).toMatch(/\.qf-toolcard__body \{\s*display: contents;\s*\}/);
    // ...and the markup did stay: the svg is still a direct child of the card,
    // the copy still inside the body. If this ever changes, the CSS above is
    // the thing that has to change with it.
    const landing = read('src/server/public/landing.html');
    expect(landing).toMatch(/<li class="qf-hcard">\s*<svg class="qf-toolcard__ico"/);
    expect(landing).toMatch(/<li class="qf-toolcard">\s*<svg class="qf-toolcard__ico"/);
  });

  it('keeps the description and the action bar full-width under both', () => {
    expect(GRID).toMatch(/\.qf-toolcard__sub \{\s*grid-column: 1 \/ -1;\s*grid-row: 2;/);
    expect(GRID).toMatch(/\.qf-toolcard__actions \{\s*grid-column: 1 \/ -1;\s*grid-row: 3;/);
    // The nowrap bar is the other half of the shared baseline; #545 bought it
    // and folding the icon into the title row must not spend it.
    expect(GRID).toContain('flex-wrap: nowrap');
  });
});

/**
 * THE HERO'S PRIMARY CTA IS THE BAND TOO (Wave 10).
 *
 * #570 painted it `--accent-fill` — the brand indigo, hue 229, on a hue-198
 * band — and the owner reported the same mismatch he had reported for the card
 * icons. Measured live off the rendered page (button hidden, band pixel-
 * sampled, four widths, both themes) the indigo was also only 1.02:1 against
 * the darkest band pixel behind it, so the fill was carrying no boundary at
 * all; the rim was the whole control.
 *
 * These tests pin the REPLACEMENT to the generator's anchors the same way the
 * icon tests above do, so a future re-tune of the wash cannot leave the CTA
 * behind — and they encode the two things that are easy to get wrong here:
 *
 *   1. THE STEP FLIPS DIRECTION WITH THE THEME. Light's band is a mid azure,
 *      so the CTA steps DOWN from it; dark's band is teal-navy near-black,
 *      where 3:1 below is off the bottom of the gamut, so it steps UP. A
 *      change that makes both themes step the same way has broken one of them.
 *   2. HOVER MOVES FURTHER FROM THE BAND, NEVER TOWARDS IT. That is what keeps
 *      the label's contrast rising on hover instead of collapsing — the exact
 *      failure `--accent-strong` caused (#2440C4 in light, a PALE LAVENDER
 *      #B4C2FC in dark, and the lavender in both on `.landing-v2`).
 */
describe('the hero CTA is the band, stepped away from itself', () => {
  const DARK_BAND = generatorAnchors('hero-wash-dark');

  /** Every `--token: #hex;` declaration, in source order. */
  const hexes = (css: string, name: string): RGB[] =>
    [...css.matchAll(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})\\s*;`, 'g'))].map((m) => hexToRgb(m[1]));

  const CTA_FILL = hexes(STYLE, 'hero-cta-fill');
  const CTA_HOVER = hexes(STYLE, 'hero-cta-fill-hover');
  /* [light, dark, light] — the third is the prefers-color-scheme: light
     fallback, which has to agree with the first or the two light paths drift. */
  const [LIGHT_FILL, DARK_FILL, LIGHT_FILL_FALLBACK] = CTA_FILL;
  const [LIGHT_HOVER, DARK_HOVER, LIGHT_HOVER_FALLBACK] = CTA_HOVER;

  it('declares one light value and one dark value, and the light fallback agrees', () => {
    expect(CTA_FILL).toHaveLength(3);
    expect(LIGHT_FILL).toEqual(LIGHT_FILL_FALLBACK);
    expect(CTA_HOVER).toHaveLength(3);
    expect(LIGHT_HOVER).toEqual(LIGHT_HOVER_FALLBACK);
  });

  it('is the WASH hue in both themes, not the accent’s', () => {
    for (const rgb of [LIGHT_FILL, DARK_FILL, LIGHT_HOVER, DARK_HOVER]) {
      expect(hue(rgb)).toBeGreaterThan(197);
      expect(hue(rgb)).toBeLessThan(199);
    }
    // The mismatch this change exists to close.
    expect(hue(hexToRgb('#3356EE'))).toBeGreaterThan(225);
  });

  it('steps DOWN from the light band and UP from the dark one', () => {
    expect(luminance(LIGHT_FILL)).toBeLessThan(luminance(LIGHT_BAND.base));
    expect(luminance(DARK_FILL)).toBeGreaterThan(luminance(DARK_BAND.base));
  });

  /**
   * WCAG 1.4.11 asks for 3:1 on whatever VISUALLY IDENTIFIES the component,
   * not on its fill. Which part of this button that is differs by theme, and
   * getting it backwards is how the first pass at this shipped a near-black
   * button: requiring 3:1 of the FILL against a band pinned as "the lightest
   * azure white body copy can sit on" forces the fill to #001F2C, which
   * measured 1.11:1 against the sixteen `--cta-bg` tool buttons under it.
   */
  it('puts 3:1 on whatever identifies the control — the rim in light, the fill in dark', () => {
    // DARK: the fill does it unaided. `sky` sits bluer than the straight line
    // from `base` to `pale`, so it — not `base` — is the worst case for a fill
    // that has stepped UP.
    expect(contrast(DARK_FILL, DARK_BAND.base)).toBeGreaterThanOrEqual(3);
    expect(contrast(DARK_FILL, DARK_BAND.sky)).toBeGreaterThanOrEqual(3);

    // LIGHT: the fill deliberately does NOT, and that is the point — this
    // assertion is what stops someone "fixing" it back to near-black.
    expect(contrast(LIGHT_FILL, LIGHT_BAND.base)).toBeLessThan(3);
    // ...so the 2px rim carries it, on BOTH sides.
    const RIM_LIGHT = hexToRgb('#FFFFFF'); // --hero-cta-rim -> --hero-wash-ink -> --accent-ink
    expect(contrast(RIM_LIGHT, LIGHT_FILL)).toBeGreaterThanOrEqual(3);
    expect(contrast(RIM_LIGHT, LIGHT_BAND.base)).toBeGreaterThanOrEqual(3);
    expect(GRID).toContain('border: 2px solid var(--hero-cta-rim) !important;');
    expect(STYLE).toContain('--hero-cta-rim:        var(--hero-wash-ink);');
    // Dark's rim is decorative BECAUSE its fill is not — keep them from being
    // "unified" by a later cleanup that does not know why they differ.
    expect(STYLE).toContain('--hero-cta-rim:        var(--hero-wash-line);');
  });

  it('stays distinguishable from the sixteen neutral tool-card buttons', () => {
    // The whole point of one primary among sixteen neutrals. #001F2C — the
    // fill a 3:1-on-the-fill rule produces — measured 1.11:1 here and read as
    // just another dark button.
    expect(contrast(LIGHT_FILL, hexToRgb('#0C111D'))).toBeGreaterThan(1.5);
  });

  it('is AA for its label, which is the site’s own theme-inverting CTA ink', () => {
    // `--hero-cta-ink: var(--cta-text)` — #FFFFFF in light, #0C111D in dark.
    expect(STYLE).toContain('--hero-cta-ink:        var(--cta-text);');
    expect(contrast(hexToRgb('#FFFFFF'), LIGHT_FILL)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hexToRgb('#0C111D'), DARK_FILL)).toBeGreaterThanOrEqual(4.5);
    // `--accent-ink` would have been white in BOTH, i.e. white on a bright
    // azure in dark. This is the reason the ink is not that token.
    expect(contrast(hexToRgb('#FFFFFF'), DARK_FILL)).toBeLessThan(4.5);
  });

  it('hovers AWAY from the band, so the label gets MORE contrast, never less', () => {
    expect(luminance(LIGHT_HOVER)).toBeLessThan(luminance(LIGHT_FILL));
    expect(luminance(DARK_HOVER)).toBeGreaterThan(luminance(DARK_FILL));
    expect(contrast(hexToRgb('#FFFFFF'), LIGHT_HOVER))
      .toBeGreaterThan(contrast(hexToRgb('#FFFFFF'), LIGHT_FILL));
    expect(contrast(hexToRgb('#0C111D'), DARK_HOVER))
      .toBeGreaterThan(contrast(hexToRgb('#0C111D'), DARK_FILL));
    // ...and each hover moves FURTHER from its own band than the resting fill
    // is. (Light's fill is not required to clear 3:1 — see the rim test above;
    // dark's is, and still does on hover.)
    expect(contrast(LIGHT_HOVER, LIGHT_BAND.base))
      .toBeGreaterThan(contrast(LIGHT_FILL, LIGHT_BAND.base));
    expect(contrast(DARK_HOVER, DARK_BAND.sky)).toBeGreaterThanOrEqual(3);
  });

  it('is what the button actually paints with — no `--accent-fill` left on the CTA', () => {
    expect(GRID).toContain('background: var(--hero-cta-fill) !important;');
    expect(GRID).toContain('background: var(--hero-cta-fill-hover) !important;');
    expect(GRID).toContain('color: var(--hero-cta-ink) !important;');
    /* EVERY rule body whose selector reaches `.hero-cta .btn`, and only those.
       An earlier version of this sliced from the first CTA rule to EOF, which
       made it fail the moment an unrelated rule was appended below — the
       `.qf-dir-submit:hover` fix at the foot of the sheet, which is CORRECTLY
       `--accent-fill` because that button is still the indigo one. Scoping to
       the rule bodies is what makes this assertion mean what it says. */
    const bodies = [...GRID.matchAll(/([^{}]*\.hero-cta \.btn[^{}]*)\{([^}]*)\}/g)];
    expect(bodies.length).toBeGreaterThanOrEqual(2); // the rest rule and its hover
    for (const [, selector, body] of bodies) {
      expect(`${selector} => ${body}`).not.toContain('var(--accent-fill)');
      expect(`${selector} => ${body}`).not.toContain('var(--accent-ink)');
    }
  });

  it('left the brand accent where it was — hero-scoped, not a palette change', () => {
    // A global accent change would ripple through every link, focus ring and
    // selection on the product. The indigo tokens keep their values.
    expect(STYLE).toContain('--accent:        #3356EE;');
    expect(STYLE).toContain('--accent-fill:   #3356EE;');
    expect(STYLE).toContain('--accent-legible: var(--accent-fill)');
  });
});

/**
 * THE AUDIENCE TOGGLE IS A SLIDING SWITCH (Wave 11).
 *
 * History, because both previous shapes are things this file has to keep out:
 *  • it was a WHITE PILL — 9999px radius, a #FFFFFF flood on the selected side,
 *    a 0px border and a near-black label — while citing design-system §4
 *    ("Selected/focused row visual = subtle outline, NEVER a bright fill") as
 *    its justification for doing the exact thing §4 forbids;
 *  • Wave 10 replaced it with two outlined rectangles, which fixed the fill and
 *    left the GRAMMAR wrong: two identical peers side by side is how you draw a
 *    filter, and the owner reported that nobody could tell it swapped the page.
 *
 * It is now one pill track containing one capsule that SLIDES. These tests pin
 * the three things that are load-bearing rather than decorative: the selected
 * side is never flooded, the control cannot reflow when you switch it, and the
 * tablist semantics underneath are untouched.
 */
describe('the audience toggle is a sliding switch, not a filter', () => {
  const V2 = read('src/server/public/landing-hero-fixes-v2.css');
  const rule = (sel: string) => {
    const at = V2.indexOf(sel);
    if (at < 0) throw new Error(`no rule for ${sel}`);
    return V2.slice(at, V2.indexOf('}', at));
  };
  const SEG = 'html body.landing-v2.qf-wft .qf-aud-toggle .qf-aud-seg {';
  const SEG_ON = 'html body.landing-v2.qf-wft .qf-aud-toggle .qf-aud-seg.is-active {';
  const TRACK = 'html body.landing-v2.qf-wft .qf-aud-toggle {';
  const CAPSULE = 'html body.landing-v2.qf-wft .qf-aud-toggle::before {';
  const CAPSULE_ON =
    'html body.landing-v2.qf-wft .qf-aud-hero[data-audience="shippers"] .qf-aud-toggle::before {';

  it('slides ONE capsule rather than lighting up one of two boxes', () => {
    // The capsule is a pseudo-element on the track, so it is out of flow and
    // cannot move anything; the travel is exactly one column.
    expect(rule(CAPSULE)).toContain('position: absolute !important;');
    expect(rule(CAPSULE)).toContain('width: calc(50% - 4px) !important;');
    expect(rule(CAPSULE)).toContain('background: var(--hero-switch-thumb) !important;');
    expect(rule(CAPSULE_ON)).toContain('transform: translateX(100%) !important;');
  });

  it('cannot reflow: equal fixed columns, zero border, colour is the only state', () => {
    // 1fr columns mean the two halves are identical whichever is selected —
    // the Wave 10 property (identical box metrics) now holds structurally.
    expect(rule(TRACK)).toContain('grid-auto-columns: 1fr !important;');
    expect(rule(SEG)).toContain('border: 0 !important;');
    // The selected rule may change colour. It must not touch the box.
    expect(rule(SEG_ON)).toContain('color: var(--hero-switch-ink-on) !important;');
    expect(rule(SEG_ON)).not.toMatch(/border:\s|padding:\s|min-height:\s|font-size:\s/);
  });

  it('never floods the selected side, and never borrows the hero CTA', () => {
    // No white pill, and no reaching for the one opaque fill in the hero —
    // this is a mode control, not a second call to action.
    expect(rule(SEG_ON)).toContain('background: none !important;');
    expect(rule(SEG_ON)).not.toContain('var(--surface)');
    for (const r of [rule(TRACK), rule(SEG), rule(SEG_ON), rule(CAPSULE)]) {
      expect(r).not.toContain('--hero-cta-fill');
      expect(r).not.toContain('--accent-fill');
    }
  });

  it('derives track and capsule from the band, stepped per theme', () => {
    // Light band is a mid azure so the step is DOWN; dark is near-black so it
    // is UP. Same derivation as --hero-cta-fill two blocks above it.
    expect(STYLE).toContain('--hero-switch-step-rgb: 0, 0, 0;');
    expect(STYLE).toContain('--hero-switch-thumb:    rgba(var(--hero-switch-step-rgb), 0.22);');
    expect(STYLE).toContain('--hero-switch-step-rgb: var(--hero-wash-ink-rgb);');
    // The rim is what identifies the control (WCAG 1.4.11); the capsule
    // measures ~1.7:1 on the band and is not asked to carry it.
    expect(rule(TRACK)).toContain('border: 1px solid var(--hero-switch-rim) !important;');
    expect(STYLE).toContain('--hero-switch-rim:      var(--hero-wash-line);');
  });

  it('keeps the inactive label above AA — quieter, never greyed out', () => {
    expect(STYLE).toContain('--hero-switch-ink:      rgba(var(--hero-wash-ink-rgb), 0.86);');
    const ink = Number(
      STYLE.match(/--hero-switch-ink:\s*rgba\(var\(--hero-wash-ink-rgb\),\s*([\d.]+)\)/)![1],
    );
    // Pixel-sampled worst case at 0.86 is 5.03:1 (light/375/idle). Dropping the
    // ink toward the reference's grey takes the word under 4.5:1 on this band.
    expect(ink).toBeGreaterThanOrEqual(0.86);
  });

  it('animates the slide on the site durations, and skips it for reduced motion', () => {
    expect(rule(CAPSULE)).toContain('transition: var(--motion-state) !important;');
    expect(STYLE).toContain('--motion-state:  all .2s ease;');
    const rm = V2.indexOf('@media (prefers-reduced-motion: reduce) {', V2.indexOf(CAPSULE));
    expect(rm).toBeGreaterThan(-1);
    const block = V2.slice(rm, V2.indexOf('\n}', rm));
    expect(block).toContain('.qf-aud-toggle::before');
    expect(block).toContain('transition: none !important;');
  });

  it('takes the pill as a SCOPED exception — the ramp is untouched elsewhere', () => {
    // 6/8/12 "plus the pill idiom" (style.css radius ramp). A two-up track at
    // radius 8 reads as a segmented picker; the pill is what makes it a switch.
    expect(rule(TRACK)).toContain('border-radius: var(--radius-pill) !important;');
    expect(rule(CAPSULE)).toContain('border-radius: var(--radius-pill) !important;');
    expect(STYLE).toContain('--radius-pill: 9999px;');
    // Scoped: no raw 9999px / 50% radius anywhere in the hero sheet, and no
    // radius literal off the 6/8/12 ramp either.
    for (const m of V2.matchAll(/border-radius:\s*([^;!]+)/g)) {
      const v = m[1].trim();
      if (v.startsWith('var(')) continue;
      expect(v).toMatch(/^(0|2px|6px|8px|12px)$/);
    }
  });

  it('is still a real tablist with a 44px tap target', () => {
    const landing = read('src/server/public/landing.html');
    expect(landing).toContain('<div class="qf-aud-toggle" role="tablist"');
    expect(landing).toContain('role="tab" data-aud="carriers"');
    expect(landing).toContain('role="tab" data-aud="shippers"');
    expect(landing).toContain('aria-selected="true"');
    // Roving tabindex — the arrow-key behaviour in landing-audience-toggle.js
    // depends on exactly one segment being tabbable.
    expect(landing).toContain('aria-selected="false" tabindex="-1"');
    // It is a tablist, NOT role="switch": two named destinations, not a binary.
    expect(landing).not.toContain('role="switch"');
    expect(rule(SEG)).toContain('min-height: 44px !important;');
  });
});
