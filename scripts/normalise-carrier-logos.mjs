#!/usr/bin/env node
/**
 * ─── NORMALISE A CURATED CARRIER LOGO ─────────────────────────────────────
 *
 * Turns a logo fetched from a carrier's OWN website into one of the tiles in
 * src/server/public/carrier-logos/. Run it once per new entry in
 * src/server/directory/carrierLogos.ts:
 *
 *   node scripts/normalise-carrier-logos.mjs <source-image> <slug>
 *   # e.g. node scripts/normalise-carrier-logos.mjs /tmp/lynden.svg lynden
 *
 * It writes BOTH crops the registry expects — the wide one for the homepage
 * marquee tile and the square one for the directory's avatar tile. Two crops,
 * because the two tiles are two different shapes: a canvas shaped for the
 * marquee wastes over half the height of a square tile, which is how a round
 * seal ends up rendering at 15px inside a 48px avatar next to a monogram that
 * fills it.
 *
 * ── WHY THIS EXISTS AT ALL ───────────────────────────────────────────────
 * Logos arrive wildly inconsistent: a 7:1 wordmark, a 1:1 seal, a mark with
 * 40% built-in padding, an 8000px SVG next to a 100px PNG. Dropping those into
 * one strip as-is is what makes most logo walls look broken.
 *
 * ── WHY A PLAIN CONTAIN-FIT IS NOT ENOUGH ────────────────────────────────
 * `object-fit: contain` in a fixed box equalises BOUNDING BOXES, not INK. A
 * 7:1 wordmark hits the width cap and renders as a thin sliver; a 1:1 seal
 * hits the height cap and renders as a big solid block. Same box, and the seal
 * looks twice the size. Measured on this set, contain-fit alone left the
 * largest mark 43% heavier than the smallest.
 *
 * So the scale factor is the GEOMETRIC MEAN of two scales:
 *   sArea — the scale that gives this logo the same rendered AREA as the rest
 *   sCap  — the scale that contain-fits it in the content box
 * sqrt(sArea · sCap) stops a square mark dwarfing a wordmark without shrinking
 * an extreme wordmark into illegibility, and is then hard-clamped by sCap so
 * nothing can overflow its tile. That took the spread on this set from 43% to
 * ~19%, which reads as one family.
 *
 * ── THE OTHER TWO THINGS IT DOES ─────────────────────────────────────────
 * TRIM FIRST. Source padding is not optical padding — a mark with a big
 * transparent margin would otherwise be scaled as though that margin were ink
 * and come out visibly small. Trimming is what makes the area maths mean
 * anything.
 *
 * REJECT KNOCKOUTS. Plenty of sites serve only a white/reversed logo in the
 * header (it sits on a dark bar). That file is INVISIBLE on the light tile
 * both surfaces use, and it fails silently — a blank tile, no error. So a
 * source whose ink is >88% near-white is refused here, with the advice to find
 * the on-light variant. Marten was caught by exactly this check.
 *
 * DEPENDENCY NOTE: `sharp` is a build-time image tool, not a runtime dependency
 * of the server, so it is intentionally NOT in package.json. Run this with a
 * sharp available (`npx sharp-cli`'s dep, a global install, or `npm i -D sharp`
 * in a scratch directory) — the script says so plainly if it cannot load one.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** The two emitted canvases. `cw`/`ch` is the box the artwork may never exceed,
 *  `area` the px² of ink each mark aims for inside that canvas. */
const VARIANTS = {
  wide:   { dir: '',       w: 220, h: 96,  cw: 216, ch: 92,  area: 6400 }, // marquee (~2.1:1)
  square: { dir: 'square', w: 112, h: 112, cw: 104, ch: 104, area: 4200 }, // directory avatar (1:1)
};
const DENSITY = 1100;      // SVG rasterisation density
const KNOCKOUT_MAX = 0.88; // >this share of near-white ink = unusable

let sharp;
try {
  ({ default: sharp } = await import('sharp'));
} catch {
  console.error(
    'normalise-carrier-logos: needs `sharp`, which is deliberately not a\n' +
    'dependency of this app (it is a build-time image tool). Install one\n' +
    'locally — e.g. `npm i -D sharp` — and re-run.',
  );
  process.exit(2);
}

/** Load a source file, rasterising SVG at a density high enough to downscale cleanly. */
function load(file) {
  const buf = readFileSync(file);
  const head = buf.subarray(0, 400).toString('utf8');
  return /^\s*(<\?xml|<svg|<!--)/i.test(head) ? sharp(buf, { density: DENSITY }) : sharp(buf);
}

/** Strip the padding baked into the source: a uniform transparent OR flat-colour border. */
async function trimmed(img) {
  const meta = await img.metadata();
  const s = meta.hasAlpha ? img : img.ensureAlpha();
  try {
    const o = await s.clone().trim({ threshold: 12 }).toBuffer({ resolveWithObject: true });
    if (o.info.width > 4 && o.info.height > 4) return sharp(o.data);
  } catch {
    // trim() throws on an image that is entirely one colour. Nothing to trim.
  }
  return s;
}

/** Share of visible pixels that are near-white — a reversed logo scores ~1. */
async function whiteRatio(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let opaque = 0, white = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i + 3] < 40) continue;
    opaque += 1;
    if (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2] > 232) white += 1;
  }
  return opaque ? white / opaque : 1;
}

export async function normaliseLogo(src, dest, v) {
  const art = await trimmed(load(src));
  const { width: w, height: h } = await art.metadata();

  const sArea = Math.sqrt(v.area / (w * h));
  const sCap = Math.min(v.cw / w, v.ch / h);
  const scale = Math.min(Math.sqrt(sArea * sCap), sCap);
  const aw = Math.max(1, Math.round(w * scale));
  const ah = Math.max(1, Math.round(h * scale));

  const scaled = await art.resize({ width: aw, height: ah, fit: 'fill', kernel: 'lanczos3' }).png().toBuffer();

  const ratio = await whiteRatio(scaled);
  if (ratio > KNOCKOUT_MAX) {
    throw new Error(
      `${src} is a KNOCKOUT logo (${Math.round(ratio * 100)}% near-white ink). It would be\n` +
      'invisible on the light tile. Find the on-light / full-colour variant on the same site.',
    );
  }

  const out = await sharp({
    create: { width: v.w, height: v.h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: scaled, gravity: 'centre' }])
    .webp({ quality: 92, effort: 6, alphaQuality: 100 })
    .toBuffer();

  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, out);
  return { source: `${w}x${h}`, art: `${aw}x${ah}`, inkArea: aw * ah, tile: `${v.w}x${v.h}`, bytes: out.length };
}

const [srcArg, slug] = process.argv.slice(2);
if (!srcArg || !slug) {
  console.error('usage: node scripts/normalise-carrier-logos.mjs <source-image> <slug>');
  process.exit(1);
}
for (const [kind, v] of Object.entries(VARIANTS)) {
  const dest = resolve(process.cwd(), 'src/server/public/carrier-logos', v.dir, `${slug}.webp`);
  const r = await normaliseLogo(resolve(process.cwd(), srcArg), dest, v);
  console.log(`${kind.padEnd(6)} ${slug}.webp  source=${r.source}  art=${r.art}  ink=${r.inkArea}px²  tile=${r.tile}  ${(r.bytes / 1024).toFixed(1)} KB`);
}
