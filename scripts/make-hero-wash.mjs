/* ═══════════════════════════════════════════════════════════════════════════
   REGENERATES THE HERO BACKDROP RASTERS
   src/server/public/brand/{hero-wash-light,hero-wash-dark,hero-grain,
                            dir-hero-wash}.webp

   WHY THIS FILE EXISTS.  The hero card's backdrop is a soft multi-stop blue.
   Our design law forbids CSS gradients, so it ships as decorative rasters over
   a flat base colour (see the Wave 5 block at the foot of style.css). A raster
   that nobody can reproduce is a liability, so the rasters are GENERATED — not
   stock, not an image API — and this is the generator. Change a token, re-run
   this, commit the .webp files.

   ONE-OFF TOOL, NOT PART OF THE BUILD.  Nothing in `pnpm build`, CI or the
   test suite calls it, and Playwright is deliberately NOT a dependency of this
   repo — the script only needs a Chromium to do the pixel work and the WebP
   encode, so point it at any Playwright install you already have:

     node scripts/make-hero-wash.mjs [--playwright <path/to/an/install>]
                                     [--only a,b] [--all] [--measure]

   REPRODUCIBLE.  Every random draw comes from a seeded mulberry32, so two runs
   of this script produce byte-identical files. `--measure` re-reads each field
   and prints its luminance envelope instead of relying on the eye.

   WHAT `--only` IS FOR.  By default this regenerates the THREE HOMEPAGE assets
   and leaves `dir-hero-wash` alone. The directory hero is signed off and its
   committed .webp predates the seeded RNG, so a bare re-run must not rewrite
   it. `--all` (or naming it in `--only`) opts in deliberately.

   ── THE THREE FIELDS ──────────────────────────────────────────────────────

   `wash` — THE HOMEPAGE CARD.  A CENTRE-LIT VIGNETTE, not a corner ramp.
   The card is painted with `background-size: cover`, and `cover` crops a
   2560-wide field down to the middle 66% at a 1440 viewport and the middle
   ~10% at 375. A corner-anchored ramp therefore disappears on the widths most
   people use — which is exactly how the first cut ended up reading as a flat,
   almost-white field. So the field is built the other way round:

     • a LIGHT COLUMN down the centre, which is the slice that survives every
       crop and the only slice narrow viewports ever see. Its floor is set by
       contrast, not by taste: `--muted` (#475467) is the hero lead's colour
       and needs 4.5:1, so no pixel in the centre column goes below luminance
       ~0.60 in light / above ~0.0386 in dark.
     • a VIGNETTE deepening toward the left and right EDGES. Those bands are
       structurally text-free (the copy is capped at 780px inside a card up to
       2509px wide), so they carry the real tonal range — and because they sit
       exactly where the card meets the page, they are what makes the rounded
       corners and the side rails read as an edge instead of vanishing.
     • a VERTICAL RAMP top→bottom plus a bottom-left corner bias, so the field
       still has direction rather than being a symmetric tunnel.
     • `mesh`, two octaves of low-frequency value noise. Without it the field
       is a pure ramp, and a pure ramp is what looks cheap.

   The single most important number is the LIGHTEST pixel. The page ground is
   `--bg` #F8FAFC (luminance 0.9536); the first cut lifted to 0.948 at its top
   corner, i.e. a 1.01:1 step — mathematically invisible, which is why the card
   had no visible corners. The lift here is capped so the palest pixel stays
   near 0.785, a ~1.20:1 step, and the edge bands go much further.

   `grain` — THE TEXTURE LAYER, and why it is a SEPARATE, TILED asset.
   Grain baked into the wash cannot survive: `cover` DOWNSCALES the 2560px
   field to ~1411px at a 1440 viewport, and the browser's resampler averages
   per-pixel noise straight out of existence. So the grain ships as its own
   256×256 tile laid over the wash at `background-repeat: repeat` and its
   NATURAL size — 1:1 device pixels, no resampling, identical at every card
   width, and small because 256×256 of 16-level grey is a handful of distinct
   RGBA values that WebP lossless stores as a palette.

   Each pixel is a uniform grey over a constant low alpha, so compositing gives
   `c·(1−a) + g·a`: a symmetric ±(a·255)/2 perturbation around a slightly
   shifted mean. One asset serves both themes — on a light ground the speckles
   read as darkening, on a dark ground as lightening, at the same amplitude.
   ALPHA is the whole tuning knob. Measured off the reference treatment the
   owner cited, visible film grain sits at ~2.7 LSB mean-absolute / ~4.3 RMS
   deviation from the local mean; `GRAIN_ALPHA` below is set to land in that
   band and no higher. Past it the surface stops reading as texture and starts
   reading as dirt, and it costs text contrast for nothing. As shipped the tile
   measures 3.37 mean-absolute / 3.85 RMS once composited — just inside the
   reference, with the contrast headroom kept.

   A note on the encode, because it is counter-intuitive: Chromium's canvas
   WebP encoder is LOSSY even at quality 1 — it re-quantises the 16 written
   greys down to 9 unevenly-spaced ones. That is harmless here (the measured
   amplitude is unchanged and there is no blocking; the tile carries no detail
   to lose) and it is by far the cheapest option — 17.5 KB against 42.5 KB for
   a truly lossless PNG of the same noise. Noise is incompressible, so the tile
   size is set by its AREA: 192² is the largest period that stays cheap, and at
   this amplitude the repeat is not findable by eye.

   `facet` — THE DIRECTORY HERO. A top-left → bottom-right DIAGONAL with a
   faint angular facet texture over it. One variant only, because the surface
   it replaces is theme-invariant by design: `--accent-fill` is #3356EE and
   `--accent-ink` is #FFFFFF in BOTH themes, so there is no dark twin to make.

   THE STOPS ARE PICKED BY CONTRAST, NOT BY EYE. White text sits on all of
   this, so every pixel has to clear AA (4.5:1), i.e. stay under luminance
   0.1833. Deep navy #1B2E7D = 11.34:1 at the top-left, the token fill
   #3356EE = 5.68:1 through the body, and #2E5BFF = 5.23:1 at the bottom-right
   — brighter and more saturated than the fill (blue channel pinned at 255)
   while being LOWER in luminance than a lighter-looking #4361F2 would be,
   which is what buys the headroom. The facet and dither amplitudes are capped
   so the brightest single pixel still clears AA.

   ── DITHER ────────────────────────────────────────────────────────────────
   2560px spanning ~25 8-bit levels means a ~100px plateau per level — textbook
   visible banding. A ±1 LSB triangular-PDF perturbation before rounding breaks
   every plateau into noise the eye integrates back to a smooth ramp, and it
   survives the WebP quantiser at q90. Remove it and the wash bands. This is
   an anti-banding measure and is invisible by design; it is NOT the grain.
   ═══════════════════════════════════════════════════════════════════════════ */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'src', 'server', 'public', 'brand');

const QUALITY = 0.9;

/* Grain alpha, 0-255. 13/255 ≈ 5.1% → a ±6.5-level uniform perturbation,
   ~3.75 RMS from the local mean. The reference treatment measures ~4.3 RMS;
   we sit just inside it so the texture reads without eating text contrast. */
const GRAIN_ALPHA = 13;
const GRAIN_LEVELS = 16;   // 16 greys + one alpha = 16 RGBA values → palette-coded

const VARIANTS = [
  /* HOMEPAGE — `field: 'wash'`, centre-lit vignette. Anchors, in order:
     `pale`  the lit centre/top, a clear step below --bg so the card has edges
     `base`  the body of the field, ~ --surface-hero one step richer
     `deep`  the side rails and bottom corners, carrying ~40% --accent

     Every anchor is stated PRE-GRAIN. The grain tile composites as
     `c·(1−a) + 127.5·a`, which pulls light values down ~4.7 levels and pushes
     dark values up ~5, so the anchors are pre-compensated by that shift and
     the `--measure` envelope below is the pre-composite one. */
  { name: 'hero-wash-light', home: true, field: 'wash', W: 2560, H: 1100,
    pale: [225, 236, 254], base: [204, 223, 252], deep: [141, 178, 242] },
  /* Dark sibling. The ceiling here is the one that matters: dark `--muted`
     (#90A1B9) needs the ground to stay UNDER luminance 0.0386, so the whole
     field is capped there rather than only its centre column. */
  { name: 'hero-wash-dark', home: true, field: 'wash', W: 2560, H: 1100,
    pale: [24, 32, 47], base: [26, 36, 58], deep: [31, 48, 93] },
  /* The tiled texture. Theme-agnostic; see the `grain` note above. */
  { name: 'hero-grain', home: true, field: 'grain', W: 192, H: 192, maxQuality: true },

  /* DIRECTORY — signed off; excluded from the default set on purpose. */
  { name: 'dir-hero-wash', home: false, field: 'facet', W: 2560, H: 1000,
    pale: [27, 46, 125], base: [51, 86, 238], deep: [46, 91, 255] },
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
  const { W, H, pale, base, deep, quality, field, grainAlpha, grainLevels, maxQuality } = cfg;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);
  const d = img.data;

  /* Seeded PRNG — the dither and the grain must be identical run to run, or
     `git status` lights up on every regeneration and nobody can tell a real
     change from noise. */
  let seed = 0x9E3779B9;
  const rnd = () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const smooth = (e0, e1, x) => {
    const t = clamp01((x - e0) / (e1 - e0));
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

  /* Flat-shaded triangular facets on a rotated, non-square lattice. Rotating
     the frame is what stops the split diagonals reading as a checkerboard, and
     flat shading (one value per triangle, hard edges) is what makes them read
     as FACETS rather than as blur. Amplitude is tiny on purpose — you should
     only find it if you go looking. */
  const facet = (u, v) => {
    const c = Math.cos(0.38), si = Math.sin(0.38);
    const a = (u * c - v * si) * 7.5 + 11.3;
    const b = (u * si + v * c) * 4.1 + 7.7;
    const i = Math.floor(a), j = Math.floor(b);
    const fa = a - i, fb = b - j;
    const half = fa + fb > 1 ? 0.5 : 0;
    return hash(i * 2.13 + half, j * 3.71 + half) - 0.5;
  };

  /* ── The grain tile. Uniform grey, constant alpha; see the header. ────── */
  if (field === 'grain') {
    let q = 0;
    for (let i = 0; i < W * H; i++) {
      const g = Math.round((Math.floor(rnd() * grainLevels) / (grainLevels - 1)) * 255);
      d[q] = g; d[q + 1] = g; d[q + 2] = g; d[q + 3] = grainAlpha;
      q += 4;
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL('image/webp', maxQuality ? 1 : quality);
  }

  let p = 0;
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);

      let s, l;
      if (field === 'facet') {
        // The diagonal itself: top-left (0) -> bottom-right (1), eased so the
        // token fill sits through the middle where most of the copy lands.
        const diag = smooth(-0.05, 1.05, (u + v) * 0.5);
        const tex = facet(u, v) * 0.06
          + (vnoise(u * 3.1 + 5.5, v * 2.2 + 1.3) - 0.5) * 0.065;
        s = clamp01((diag - 0.5) * 2 + tex);   // -> `deep` half
        l = clamp01((0.5 - diag) * 2 - tex);   // -> `pale` half
      } else {
        /* Distance out of the light column, 0 in the middle -> 1 at whichever
           edge is nearer. The column is centred slightly left of true centre
           so the field is not mirror-symmetric. */
        const cx = 0.47;
        const hx = Math.abs(u - cx) / (u < cx ? cx : 1 - cx);
        /* Flat across the middle ~52%, then falls away to the rails. This is
           the term that carries the card's tonal range. */
        const side = smooth(0.26, 1.0, hx) * 0.86;

        /* Top -> bottom. Deliberately gentle: this one DOES run under text at
           narrow widths, so it is the term the contrast floor constrains. */
        const down = smooth(0.06, 1.12, v) * 0.34;

        /* Bottom-left bias, so the vignette has a direction. */
        const dx = (u + 0.10) / 1.18;
        const dy = (v - 1.04) / 1.12;
        const corner = (1 - smooth(0, 1, Math.sqrt(dx * dx + dy * dy))) * 0.30;

        const mesh = (vnoise(u * 2.3 + 0.7, v * 1.7 + 0.4) - 0.5) * 0.12
          + (vnoise(u * 4.6 + 3.1, v * 3.4 + 1.9) - 0.5) * 0.05;

        /* THE CONTRAST FLOOR, expressed as geometry. Everything except the
           vignette itself is damped inside the light column, so the deepest
           the column can get is bounded no matter how the ramp, the corner
           bias and the mesh happen to line up. Drop this and the bottom of a
           375px card — which is pure centre column — sinks under `--muted`. */
        const inner = 0.54 + 0.46 * smooth(0.18, 0.92, hx);

        s = clamp01(side + (down + corner + mesh) * inner);

        /* The lift toward `pale`: strongest high in the light column, which is
           what keeps the crop every narrow viewport sees on the light end. */
        l = clamp01(smooth(0.22, 1.05, (1 - v) * 0.62 + (1 - hx) * 0.58) * 0.94);
      }

      for (let ch = 0; ch < 3; ch++) {
        const mid = base[ch] + (deep[ch] - base[ch]) * s;
        let val = mid + (pale[ch] - mid) * l * (1 - s);
        val += rnd() + rnd() - 1; // triangular-PDF dither, ±1 LSB
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

/* Reads a just-written .webp back and prints its luminance envelope, so the
   contrast claims in the CSS comments are measured rather than asserted. */
const measure = async (dataUrl) => {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const cx = c.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0);
  const L = (r, g, b) => {
    const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const band = (x0, w, label) => {
    const d = cx.getImageData(x0, 0, w, c.height).data;
    let lo = 9, hi = -1, sum = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = L(d[i], d[i + 1], d[i + 2]);
      if (l < lo) lo = l; if (l > hi) hi = l; sum += l; n++;
    }
    return `${label} L ${lo.toFixed(4)}..${hi.toFixed(4)} mean ${(sum / n).toFixed(4)}`;
  };
  const mid = Math.round(c.width * 0.47);
  return [
    band(0, c.width, 'FULL   '),
    band(mid - Math.round(c.width * 0.06), Math.round(c.width * 0.12), 'CENTRE '),
    band(0, Math.round(c.width * 0.08), 'L-RAIL '),
  ];
};

const argOnly = process.argv.indexOf('--only');
const wanted = argOnly > -1 ? new Set(String(process.argv[argOnly + 1]).split(',')) : null;
const all = process.argv.includes('--all');
const doMeasure = process.argv.includes('--measure');
const targets = VARIANTS.filter((v) => (wanted ? wanted.has(v.name) : all || v.home));

const chromium = resolveChromium();
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('about:blank');

for (const variant of targets) {
  const dataUrl = await page.evaluate(draw, {
    quality: QUALITY, grainAlpha: GRAIN_ALPHA, grainLevels: GRAIN_LEVELS, ...variant,
  });
  const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
  const file = path.join(OUT, `${variant.name}.webp`);
  fs.writeFileSync(file, buf);
  console.log(`${variant.name}.webp  ${variant.W}x${variant.H}  ${(buf.length / 1024).toFixed(1)} KB`);
  if (doMeasure && variant.field !== 'grain') {
    for (const line of await page.evaluate(measure, dataUrl)) console.log(`   ${line}`);
  }
}

await browser.close();
