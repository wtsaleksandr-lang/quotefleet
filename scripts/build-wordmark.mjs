#!/usr/bin/env node
/**
 * BUILD THE BAKED "QuoteFleet" WORDMARK — positions from the BROWSER, never
 * from a font library's advance maths.
 *
 * WHY THIS SCRIPT EXISTS. The footer wordmark (#568) was first cut with
 * opentype.js. Instrument Sans ships its kerning in GPOS and carries NO legacy
 * `kern` table, so `getKerningValue()` returned 0 for every pair and the asset
 * shipped SILENTLY unkerned — it drifted -0.63% across the string and 19.8% of
 * its ink pixels were wrong against the live face. A warning comment was left
 * at the call site. A comment is not a mechanism, so the next person to need
 * the mark at a different size got the same trap. This script is the mechanism:
 * it is the only supported way to cut the asset, and `wordmarkKerning.test.ts`
 * fails if a hand-cut unkerned asset is ever pasted back in.
 *
 * WHAT IT TAKES FROM WHERE.
 *   • GLYPH OUTLINES come from the shipped footer asset. They were verified
 *     against the live webfont at 100px and differ only in anti-aliasing (2.5%
 *     of ink, edge hairlines). Outlines do not change with size, so there is
 *     nothing to regenerate and no font file to fetch for them.
 *   • GLYPH POSITIONS are measured in Chromium, from its own shaping of the
 *     whole string in the real webfont at the size the mark will ship at, using
 *     Range prefix widths. That is the ONLY number that was ever wrong, and it
 *     is the one this script refuses to guess.
 *
 * WHY POSITIONS ARE RE-MEASURED PER SIZE rather than scaled from the footer's.
 * Chromium resolves advances and applies GPOS at the used px size and rounds
 * there, so a 19px run is not a 15px run times 19/15. The differences are
 * sub-pixel per pair but they accumulate across ten glyphs, and the whole point
 * of a baked mark is that it is indistinguishable from the live face.
 *
 * USAGE (needs network for fonts.gstatic.com; free, no API keys):
 *   node scripts/build-wordmark.mjs --size=19 --tracking=-0.02
 * Prints the <svg> literal to paste into siteChrome.ts, plus the kerned and
 * unkerned position vectors — paste BOTH into the test's baked baseline when
 * adding a new size.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
// `@playwright/test` is the repo's devDependency and re-exports the driver.
const { chromium } = require('@playwright/test');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHROME_TS = path.join(HERE, '..', 'src', 'server', 'siteChrome.ts');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  }),
);
const SIZE = Number(args.size ?? 19);
const TRACKING = Number(args.tracking ?? -0.02); // em
const WEIGHT = Number(args.weight ?? 600);
const CLASS = args.class ?? 'qf-header-wordmark-svg';
const WORD = 'QuoteFleet';

/** The em box the outlines are drawn in. 1em = 100 units, matching #568. */
const UPEM = 100;
/** Face ascender/descender box, from the footer asset's own viewBox. */
const VB_Y = -97;
const VB_H = 122;

// ── 1. Glyph outlines, lifted from the shipped footer asset ─────────────────
function glyphLibrary() {
  const src = fs.readFileSync(CHROME_TS, 'utf8');
  const m = src.match(/export const FOOTER_WORDMARK_SVG = `([\s\S]*?)`;/);
  if (!m) throw new Error('FOOTER_WORDMARK_SVG not found in siteChrome.ts');
  const paths = [...m[1].matchAll(/<path transform="translate\(([-\d.]+),([-\d.]+)\)" d="([^"]+)"\/>/g)];
  if (paths.length !== WORD.length) throw new Error(`expected ${WORD.length} glyphs, found ${paths.length}`);
  const lib = {};
  paths.forEach((p, i) => {
    const ch = WORD[i];
    const d = p[3];
    if (lib[ch] && lib[ch] !== d) throw new Error(`two different outlines for "${ch}"`);
    lib[ch] = d;
  });
  return lib;
}

// ── 2. Positions, measured in Chromium from its own layout ──────────────────
async function measure() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html><head>
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@${WEIGHT}&display=block">
      <style>
        body { margin: 0; }
        .probe {
          font-family: "Instrument Sans";
          font-weight: ${WEIGHT};
          font-size: ${SIZE}px;
          letter-spacing: ${TRACKING}em;
          line-height: 1;
          white-space: pre;
          display: inline-block;
        }
        /* The control run: same everything, kerning switched OFF. This is what
           a font library that cannot read GPOS produces, and it is what the
           test refuses to let back in. */
        .nokern { font-kerning: none; font-feature-settings: "kern" 0, "liga" 0; font-variant-ligatures: none; }
      </style></head><body>
      <span class="probe" id="kerned">${WORD}</span><br>
      <span class="probe nokern" id="unkerned">${WORD}</span>
      </body></html>`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    // Fail loudly rather than silently baking a fallback face.
    const loaded = await page.evaluate((w) => document.fonts.check(`${w} 19px "Instrument Sans"`), WEIGHT);
    if (!loaded) throw new Error('Instrument Sans did not load — refusing to bake a fallback face');

    return await page.evaluate(({ word, size, tracking }) => {
      /* PEN POSITIONS THE ONLY HONEST WAY: measure the width of the PREFIX of
         the same single text node. Because it is one node and one shaping run,
         every GPOS kern between the pair at the cut is already applied. Slicing
         the string into per-character spans, or summing advances, is exactly
         the mistake this file exists to prevent — both destroy the pair. */
      function pens(id) {
        const el = document.getElementById(id);
        const node = el.firstChild;
        const out = [];
        for (let i = 0; i < word.length; i++) {
          if (i === 0) { out.push(0); continue; }
          const r = document.createRange();
          r.setStart(node, 0);
          r.setEnd(node, i);
          out.push(r.getBoundingClientRect().width);
        }
        /* TOTAL ADVANCE, MINUS THE TRAILING LETTER-SPACE. Chromium adds the
           tracking after EVERY character, the last one included, so the
           element's own width carries a phantom gap past the final glyph. A
           mark's box is the advance box of its last glyph, so that gap is
           subtracted back out — this is why the footer asset's viewBox reads
           517.3 and not 515.3: same correction, same number. */
        out.push(el.getBoundingClientRect().width - tracking * size);
        return out.map((v) => +(v / size * 100).toFixed(2));
      }
      return { kerned: pens('kerned'), unkerned: pens('unkerned') };
    }, { word: WORD, size: SIZE, tracking: TRACKING });
  } finally {
    await browser.close();
  }
}

// ── 3. Emit ─────────────────────────────────────────────────────────────────
const lib = glyphLibrary();
const { kerned, unkerned } = await measure();
const advance = kerned[kerned.length - 1];
const xs = kerned.slice(0, WORD.length);

const paths = [...WORD].map((ch, i) => `<path transform="translate(${xs[i]},0)" d="${lib[ch]}"/>`).join('');
const svg =
  `<svg class="${CLASS}" viewBox="0 ${VB_Y} ${advance} ${VB_H}"` +
  ` width="${+(advance / UPEM).toFixed(3)}em" height="${+(VB_H / UPEM).toFixed(2)}em"` +
  ` aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">` +
  `<g fill="currentColor">${paths}</g></svg>`;

const drift = +(((advance - unkerned[unkerned.length - 1]) / unkerned[unkerned.length - 1]) * 100).toFixed(3);
const movedPairs = xs.filter((x, i) => Math.abs(x - unkerned[i]) > 0.05).length;

console.log(`# size=${SIZE}px weight=${WEIGHT} tracking=${TRACKING}em`);
console.log(`# kerned   x: [${kerned.join(', ')}]`);
console.log(`# unkerned x: [${unkerned.join(', ')}]`);
console.log(`# kerning moves ${movedPairs}/${WORD.length} glyphs; total advance ${drift}% vs unkerned`);
if (movedPairs === 0) {
  console.error('FATAL: kerned and unkerned layouts are identical — the face did not load with GPOS applied.');
  process.exit(1);
}
console.log('');
console.log(svg);
