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
