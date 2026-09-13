/**
 * THE BAKED WORDMARKS MUST STAY KERNED.
 *
 * WHY THIS FILE EXISTS. Both "QuoteFleet" wordmarks — the footer's (#568) and
 * the header's — are baked outlines: each glyph is drawn at x=0 and placed by
 * an SVG `translate`. Those x positions are the entire risk. Instrument Sans
 * ships its kerning in GPOS and carries NO legacy `kern` table, so
 * opentype.js's `getKerningValue()` returns 0 for every pair, and the FIRST cut
 * of the footer asset shipped silently unkerned: -0.64% of drift across the
 * string and 19.8% of its ink pixels wrong against the live face. Nothing
 * about an unkerned asset looks broken in review — the letters are the right
 * letters, they are just in slightly the wrong places.
 *
 * A WARNING COMMENT WAS THE CONTROL LAST TIME, AND IT DID NOT HOLD. One was
 * left at the call site after the first failure. This file is the control now.
 *
 * THE STRUCTURAL ASSERTION IS THE LOAD-BEARING ONE, and it needs no baked
 * table at all: the string contains the SAME 'e' glyph three times, each
 * followed by a different letter (e→F, e→e, e→t). In an unkerned run every
 * advance out of an 'e' is the same number — the glyph's own advance plus the
 * tracking — so those three deltas are identical by construction. Kerned, they
 * are not. That test cannot be satisfied by an unkerned asset at ANY size, and
 * cannot go stale, because it compares the asset only against itself.
 *
 * The baked vectors below then pin the exact cut that shipped and, more
 * usefully, state what the WRONG answer looks like, so a regeneration that
 * reproduces the old bug fails loudly instead of drifting in.
 *
 * Regenerate with: node scripts/build-wordmark.mjs --size=<px> --tracking=-0.02
 * It prints both vectors; paste them here when adding a size.
 */
import { describe, expect, it } from 'vitest';
import { FOOTER_WORDMARK_SVG, HEADER_WORDMARK_SVG } from './siteChrome.js';

const WORD = 'QuoteFleet';

/**
 * Chromium's own layout of "QuoteFleet" in Instrument Sans 600 at -0.02em,
 * normalised to 1em = 100 units. `kerned` is what the browser really does;
 * `unkerned` is the same run with `font-kerning: none` — i.e. exactly what a
 * font library that cannot read GPOS produces. Measured, not derived.
 */
const LAYOUT = {
  15: {
    kerned: [0, 78.85, 136.98, 193.44, 230.42, 285.52, 342.92, 366.98, 422.71, 476.77],
    unkerned: [0, 78.65, 137.08, 194.79, 233.33, 288.44, 345.83, 369.9, 425, 480.1],
    kernedAdvance: 517.31,
    unkernedAdvance: 520.65,
  },
  19: {
    kerned: [0, 78.87, 136.92, 193.42, 230.43, 285.53, 342.93, 366.94, 422.78, 476.73],
    unkerned: [0, 78.62, 137.01, 194.74, 233.31, 288.4, 345.81, 369.82, 424.92, 480.02],
    kernedAdvance: 517.38,
    unkernedAdvance: 520.67,
  },
} as const;

interface Parsed {
  xs: number[];
  ds: string[];
  advance: number;
  viewBox: string;
}

function parse(svg: string): Parsed {
  const vb = /viewBox="([^"]+)"/.exec(svg);
  if (!vb) throw new Error('no viewBox');
  const glyphs = [...svg.matchAll(/<path transform="translate\((-?[\d.]+),(-?[\d.]+)\)" d="([^"]+)"\/>/g)];
  return {
    xs: glyphs.map((g) => Number(g[1])),
    ds: glyphs.map((g) => g[3]),
    advance: Number(vb[1].split(/\s+/)[2]),
    viewBox: vb[1],
  };
}

const ASSETS: Array<[string, string, 15 | 19]> = [
  ['FOOTER_WORDMARK_SVG', FOOTER_WORDMARK_SVG, 15],
  ['HEADER_WORDMARK_SVG', HEADER_WORDMARK_SVG, 19],
];

describe.each(ASSETS)('%s is a kerned cut', (_name, svg, size) => {
  const got = parse(svg);
  const want = LAYOUT[size];

  it('draws one path per letter, each glyph at x=0 and placed by a transform', () => {
    expect(got.xs).toHaveLength(WORD.length);
    expect(got.ds).toHaveLength(WORD.length);
    // A per-glyph `translate` is what makes the positions inspectable at all;
    // a single pre-positioned path would hide the bug this file exists to catch.
    expect(svg).toContain('transform="translate(0,0)"');
  });

  it('repeats a letter with a byte-identical outline', () => {
    // "QuoteFleet" carries three 'e' and two 't'. If a regeneration produced
    // different outlines for the same letter, the glyph source changed and
    // every position in here is suspect.
    const byChar = new Map<string, string>();
    [...WORD].forEach((ch, i) => {
      const prev = byChar.get(ch);
      if (prev !== undefined) expect(got.ds[i]).toBe(prev);
      byChar.set(ch, got.ds[i]);
    });
    expect(byChar.size).toBe(7); // Q u o t e F l
  });

  /* ── THE ONE THAT CANNOT GO STALE ──────────────────────────────────────── */
  it('advances differently out of the same glyph, which only a kerned run does', () => {
    // Same 'e', three different following letters.
    const eToF = got.xs[5] - got.xs[4];
    const eToE = got.xs[8] - got.xs[7];
    const eToT = got.xs[9] - got.xs[8];
    const spread = Math.max(eToF, eToE, eToT) - Math.min(eToF, eToE, eToT);
    // Unkerned, all three are advance('e') + tracking and the spread is 0.
    expect(spread).toBeGreaterThan(0.5);

    // Same again for 't', which is followed by 'e' once and ends the word once.
    expect(got.xs[4] - got.xs[3]).not.toBeCloseTo(got.advance - got.xs[9], 1);
  });

  it('matches the browser-measured kerned layout', () => {
    got.xs.forEach((x, i) => {
      expect(Math.abs(x - want.kerned[i])).toBeLessThanOrEqual(0.2);
    });
    expect(Math.abs(got.advance - want.kernedAdvance)).toBeLessThanOrEqual(1);
  });

  it('does NOT match the unkerned layout opentype.js would have produced', () => {
    const drift = got.xs.reduce((sum, x, i) => sum + Math.abs(x - want.unkerned[i]), 0);
    // Measured total deviation of the real cut from the unkerned one is ~19
    // units; an unkerned asset scores 0. Ten is a floor with a wide moat.
    expect(drift).toBeGreaterThan(10);
    // The kerned string is ~0.64% tighter overall. The box has to show it.
    expect(want.unkernedAdvance - got.advance).toBeGreaterThan(2);
  });

  it('stays inline, recolourable and out of the accessibility tree', () => {
    // An <img src> would cut currentColor; the mark recolours with its
    // chrome's ink token in all three theme states.
    expect(svg).toContain('fill="currentColor"');
    // The name lives on the anchor, so the graphic must not add a second one.
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).toContain('focusable="false"');
    expect(svg).not.toContain('<title>');
    // Tracking is baked into the transforms. Re-adding letter-spacing would
    // apply it twice.
    expect(svg).not.toContain('letter-spacing');
    // Both axes declared: this is chrome on every page and an undeclared box
    // is a layout shift.
    expect(/ width="[\d.]+em"/.test(svg)).toBe(true);
    expect(/ height="[\d.]+em"/.test(svg)).toBe(true);
  });
});

describe('the two cuts are the same mark at two sizes', () => {
  it('shares every glyph outline', () => {
    const f = parse(FOOTER_WORDMARK_SVG);
    const h = parse(HEADER_WORDMARK_SVG);
    expect(h.ds).toEqual(f.ds);
  });

  it('is re-cut per size rather than scaled, so the positions are not identical', () => {
    const f = parse(FOOTER_WORDMARK_SVG);
    const h = parse(HEADER_WORDMARK_SVG);
    // Chromium rounds advances at the used px size, so a 19px run is not a
    // 15px run scaled. The differences are small but they are real; identical
    // vectors would mean the header asset was copied instead of measured.
    expect(h.xs).not.toEqual(f.xs);
  });
});
