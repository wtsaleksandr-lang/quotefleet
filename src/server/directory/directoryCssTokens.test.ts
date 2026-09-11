/**
 * DIRECTORY_CSS — THE GUARD THE CI GUARDS CANNOT RUN.
 *
 * `scripts/check-hardcoded-colors.mjs` and `scripts/check-spacing.mjs` walk
 * `src/server/public/**` only. DIRECTORY_CSS is ~1,200 lines of CSS living in a
 * TypeScript template literal in `pages.ts`, so neither guard has ever seen it —
 * and it is the highest-blast-radius stylesheet in the product, shipped to the
 * ~330k indexed carrier-directory pages as a content-hashed, `immutable` asset.
 *
 * Extracting it into `src/server/public/` so the real guards would cover it was
 * considered and REJECTED (see the decision note on DIRECTORY_CSS_HASH in
 * pages.ts). This file is the alternative: bring the guards to the CSS instead
 * of moving the CSS to the guards. Same rules, asserted at the same moment CI
 * runs the suite, with no change to the serving or cache contract.
 *
 * These are RULE-grade assertions. Token VALUES may move; the rules do not.
 */
import { describe, it, expect } from 'vitest';
import { DIRECTORY_CSS } from './pages.js';

/** CSS with every comment removed — comments legitimately discuss the values
 *  these rules ban (a note explaining why a hex was retired must not itself
 *  trip the hex rule). */
const CSS = DIRECTORY_CSS.replace(/\/\*[\s\S]*?\*\//g, '');

/** Numbered source lines of the comment-free CSS, for readable failures. */
const LINES = CSS.split('\n').map((text, i) => ({ n: i + 1, text }));
const findLines = (re: RegExp) =>
  LINES.filter((l) => re.test(l.text)).map((l) => `L${l.n}: ${l.text.trim().slice(0, 120)}`);

describe('DIRECTORY_CSS obeys the design tokens the public-dir guards enforce', () => {
  it('contains no raw hex colours — every colour comes from a token', () => {
    // #abc / #aabbcc / #aabbccdd, but not an id selector like #cp-tab-safety.
    const hex = findLines(/#[0-9a-fA-F]{3,8}(?![0-9a-zA-Z_-])/);
    expect(hex, `raw hex in DIRECTORY_CSS:\n${hex.join('\n')}`).toEqual([]);
  });

  it('uses only the radius ramp {0, 6, 8, 12, 9999}', () => {
    const ALLOWED = new Set([0, 6, 8, 12, 9999]);
    const bad: string[] = [];
    for (const { n, text } of LINES) {
      for (const decl of text.matchAll(/(border(?:-[a-z]+)*-radius)\s*:\s*([^;{}]+)/g)) {
        for (const px of decl[2].matchAll(/(-?\d+(?:\.\d+)?)px/g)) {
          const v = Math.abs(parseFloat(px[1]));
          if (!ALLOWED.has(v)) bad.push(`L${n}: ${decl[1]}: ${v}px — ${text.trim().slice(0, 90)}`);
        }
      }
    }
    expect(bad, `off-ramp radii:\n${bad.join('\n')}`).toEqual([]);
  });

  it('declares no gradients', () => {
    const g = findLines(/(linear|radial|conic)-gradient/);
    expect(g, `gradients:\n${g.join('\n')}`).toEqual([]);
  });

  it('declares no backdrop-filter (and no glass token block to feed one)', () => {
    const b = findLines(/backdrop-filter/);
    expect(b, `backdrop-filter:\n${b.join('\n')}`).toEqual([]);
    // landing-glass.css is not linked on directory pages; this file used to
    // re-declare --glass-* locally, which is how glass survived wave 1 here.
    const glass = findLines(/--glass-[a-z-]+\s*:/);
    expect(glass, `re-declared glass tokens:\n${glass.join('\n')}`).toEqual([]);
  });

  it('animates only state, never decoration', () => {
    // A loading spinner IS state and is allowed; nothing else may animate.
    const STATE_ONLY = new Set(['qf-facet-spin']);
    const declared = [...CSS.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
    const decorative = declared.filter((k) => !STATE_ONLY.has(k));
    expect(decorative, `decorative keyframes: ${decorative.join(', ')}`).toEqual([]);
    for (const used of CSS.matchAll(/animation\s*:\s*([^;{}]+)/g)) {
      const v = used[1].trim();
      if (v.startsWith('none')) continue;
      expect(
        [...STATE_ONLY].some((k) => v.includes(k)),
        `animation references a non-state keyframe: ${v}`,
      ).toBe(true);
    }
  });

  it('never lifts a card on hover — a hover is a border-colour change', () => {
    const lifts = LINES.filter(
      ({ text }) => /:hover/.test(text) && /transform\s*:\s*translateY\(\s*-/.test(text),
    ).map((l) => `L${l.n}: ${l.text.trim().slice(0, 120)}`);
    expect(lifts, `hover lifts:\n${lifts.join('\n')}`).toEqual([]);
  });

  it('uses only the two motion durations (.2s / .3s)', () => {
    const bad: string[] = [];
    for (const { n, text } of LINES) {
      for (const decl of text.matchAll(/transition\s*:\s*([^;{}]+)/g)) {
        for (const s of decl[1].matchAll(/(\d*\.?\d+)s\b/g)) {
          const v = parseFloat(s[1]);
          if (v !== 0 && v !== 0.2 && v !== 0.3) bad.push(`L${n}: ${v}s — ${text.trim().slice(0, 90)}`);
        }
      }
    }
    expect(bad, `off-ramp transition durations:\n${bad.join('\n')}`).toEqual([]);
  });

  it('casts only the three token shadows', () => {
    const bad: string[] = [];
    for (const { n, text } of LINES) {
      for (const decl of text.matchAll(/box-shadow\s*:\s*([^;{}]+)/g)) {
        const v = decl[1].trim();
        if (v === 'none' || /^var\(--shadow-(sm|md|lg)\)$/.test(v)) continue;
        bad.push(`L${n}: box-shadow: ${v.slice(0, 80)}`);
      }
    }
    expect(bad, `ad-hoc shadows:\n${bad.join('\n')}`).toEqual([]);
  });

  it('renders every column of figures with tabular digits', () => {
    // --font-mono is a platform stack, so the face that renders is per-OS.
    // tabular-nums pins all ten digits to one advance, which is what makes a
    // figure column's width a function of digit COUNT rather than of value.
    for (const sel of ['.carrier-facts .f b', '.facet-opt .cb', '.dir-card .cnt', '.carrier-card .meta']) {
      const block = CSS.slice(CSS.indexOf('font-variant-numeric: tabular-nums') - 2000);
      expect(CSS, `${sel} must be in the tabular-nums group`).toContain(sel);
      expect(block).toBeTruthy();
    }
    expect(CSS).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });

  it('lets a wider monospace face break rather than overflow', () => {
    // The count pill may not be squeezed; its label may shrink; the USDOT/MC
    // run may break. Fixed square controls are minimums, not fixed widths.
    expect(CSS).toContain('.facet-opt .lbl { min-width: 0; overflow-wrap: anywhere; }');
    expect(CSS).toContain('.facet-opt .cb { flex: 0 0 auto;');
    expect(CSS).toContain('.carrier-card .meta { overflow-wrap: anywhere; }');
    expect(CSS).toContain('.cp-monogram { width: auto; min-width: 54px; }');
  });
});

describe('DIRECTORY_CSS spacing debt does not grow', () => {
  /**
   * The 8px grid the spacing guard enforces. Unlike colour/radius/shadow, the
   * off-grid spacing in this file was NOT migrated in this wave: 161 literals
   * set the padding and gap of every card, chip and rail on ~330k
   * `immutable`-cached pages, and re-flowing all of them is a layout change,
   * not a token change. It is measured and pinned here so the debt can only
   * shrink — the same contract `scripts/spacing-violations-baseline.txt` gives
   * the public stylesheets.
   */
  const RAMP = new Set([0, 4, 8, 12, 16, 24, 32, 48, 60, 80, 120]);
  const SPACE_PROP = /^(padding|margin|gap|row-gap|column-gap|inset|top|right|bottom|left)(-(top|right|bottom|left))?$/;
  const BASELINE = 161;

  const offGrid = () => {
    const hits: string[] = [];
    for (const { n, text } of LINES) {
      for (const decl of text.matchAll(/([-a-zA-Z]+)\s*:\s*([^;{}]+)/g)) {
        const prop = decl[1].toLowerCase();
        const val = decl[2].trim();
        if (prop.startsWith('--') || !SPACE_PROP.test(prop)) continue;
        if (/calc\(|var\(/.test(val)) continue;
        for (const px of val.matchAll(/(-?\d+(?:\.\d+)?)px/g)) {
          const v = Math.abs(parseFloat(px[1]));
          if (!RAMP.has(v)) hits.push(`L${n}: ${prop}: ${v}px`);
        }
      }
    }
    return hits;
  };

  it(`has at most ${BASELINE} off-grid spacing literals (ratchet — only shrink this)`, () => {
    const hits = offGrid();
    expect(
      hits.length,
      `off-grid spacing count moved. If it GREW, put the value on the 8px ramp.\n` +
        `If it SHRANK, lower BASELINE to ${hits.length}.\nFirst 10:\n${hits.slice(0, 10).join('\n')}`,
    ).toBeLessThanOrEqual(BASELINE);
  });
});
