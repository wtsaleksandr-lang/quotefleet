/* ═══════════════════════════════════════════════════════════════════════════
   REGENERATES THE HOMEPAGE HERO WASH
   src/server/public/brand/hero-wash-{light,dark}.webp

   WHY THIS FILE EXISTS.  The hero card's backdrop is a soft multi-stop blue.
   Our design law forbids CSS gradients, so it ships as a decorative raster
   over a flat base colour (see the Wave 5 block at the foot of style.css). A
   raster that nobody can reproduce is a liability, so the raster is GENERATED
   — not stock, not an image API — and this is the generator. Change a token,
   re-run this, commit the two .webp files.

   ONE-OFF TOOL, NOT PART OF THE BUILD.  Nothing in `pnpm build`, CI or the
   test suite calls it, and Playwright is deliberately NOT a dependency of this
   repo — the script only needs a Chromium to do the pixel work and the WebP
   encode, so point it at any Playwright install you already have:

     node scripts/make-hero-wash.mjs [--playwright <path/to/an/install>]

   HOW THE FIELD IS BUILT, AND WHY.
   • The colour is computed per pixel in FLOAT and mixed between three anchors
     taken from our tokens — a near-white, a base one step richer than
     `--surface-hero`, and that base carrying ~26% `--accent` — so the wash is
     a sibling of the flat tint rather than an unrelated picture.
   • The deepening runs along the BOTTOM edge (`bottom`), biased toward the
     bottom-left corner (`corner`), lifting to near-white at the opposite
     top-right edge (`lift`). Bottom-anchored is what makes `cover` safe at
     every width: a 375px card crops to a narrow middle column and a 2560px
     one crops off the top, and both still read "light body, deeper base".
   • `mesh` is two octaves of low-frequency value noise at ~±0.09. Without it
     the field is a pure ramp, and a pure ramp is what looks cheap.
   • The dither is the important part. 2560px spanning ~25 8-bit levels means
     a ~100px plateau per level — textbook visible banding. A ±1 LSB
     triangular-PDF perturbation before rounding breaks every plateau into
     noise the eye integrates back to a smooth ramp, and it survives the WebP
     quantiser at q90. Remove it and the wash bands.
   • WebP q90 at 2560×1100 lands at ~13 KB per variant. If a re-render comes
     out large, the field has picked up noise it should not have.
   ═══════════════════════════════════════════════════════════════════════════ */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'src', 'server', 'public', 'brand');

const W = 2560;
const H = 1100; // ~2.33:1, close to the hero card's desktop aspect
const QUALITY = 0.9;

const VARIANTS = [
  // near-white -> a touch richer than --surface-hero (#EFF6FF) -> +~26% --accent
  { name: 'hero-wash-light', pale: [248, 251, 255], base: [233, 241, 254], deep: [190, 206, 250] },
  // a shade under the dark --surface-hero (#131A28) -> #131A28 -> +~22% --accent
  { name: 'hero-wash-dark', pale: [14, 19, 31], base: [19, 26, 40], deep: [26, 39, 84] },
];

function resolveChromium() {
  const flag = process.argv.indexOf('--playwright');
  const candidates = [
    ...(flag > -1 ? [process.argv[flag + 1]] : []),
    path.join(HERE, '..', 'package.json'),
    path.join(process.env.USERPROFILE || process.env.HOME || '.', 'claude-orchestrator', 'package.json'),
  ];
  for (const c of candidates) {
    try {
      return createRequire(c.endsWith('.json') ? c : path.join(c, 'package.json'))('playwright').chromium;
    } catch { /* try the next one */ }
  }
  throw new Error('Playwright not found. Pass --playwright <dir containing node_modules/playwright>.');
}

/* Runs inside the page: everything below here is browser-side. */
const draw = (cfg) => {
  const { W, H, pale, base, deep, quality } = cfg;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);
  const d = img.data;

  const smooth = (e0, e1, x) => {
    let t = (x - e0) / (e1 - e0);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return t * t * (3 - 2 * t);
  };
  const hash = (i, j) => {
    const n = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
    return n - Math.floor(n);
  };
  const vnoise = (x, y) => {
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = x - i;
    const fy = y - j;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = hash(i, j);
    const b = hash(i + 1, j);
    const c = hash(i, j + 1);
    const e = hash(i + 1, j + 1);
    return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + e * ux) * uy;
  };

  let p = 0;
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);

      const bottom = smooth(0.34, 1.14, v) * 0.62;

      const dx = (u + 0.04) / 1.30;
      const dy = (v - 1.06) / 1.04;
      const corner = (1 - smooth(0, 1, Math.sqrt(dx * dx + dy * dy))) * 0.52;

      const lift = smooth(0.46, 1.05, u * 0.60 + (1 - v) * 0.78) * 0.72;

      const mesh = (vnoise(u * 2.3 + 0.7, v * 1.7 + 0.4) - 0.5) * 0.13
        + (vnoise(u * 4.6 + 3.1, v * 3.4 + 1.9) - 0.5) * 0.055;

      let s = bottom + corner + mesh;
      s = s < 0 ? 0 : s > 1 ? 1 : s;
      const l = lift < 0 ? 0 : lift > 1 ? 1 : lift;

      for (let ch = 0; ch < 3; ch++) {
        const mid = base[ch] + (deep[ch] - base[ch]) * s;
        let val = mid + (pale[ch] - mid) * l * (1 - s);
        val += Math.random() + Math.random() - 1; // triangular-PDF dither, ±1 LSB
        val = Math.round(val);
        d[p + ch] = val < 0 ? 0 : val > 255 ? 255 : val;
      }
      d[p + 3] = 255;
      p += 4;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/webp', quality);
};

const chromium = resolveChromium();
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('about:blank');

for (const variant of VARIANTS) {
  const dataUrl = await page.evaluate(draw, { W, H, quality: QUALITY, ...variant });
  const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
  const file = path.join(OUT, `${variant.name}.webp`);
  fs.writeFileSync(file, buf);
  console.log(`${variant.name}.webp  ${W}x${H}  ${(buf.length / 1024).toFixed(1)} KB`);
}

await browser.close();
