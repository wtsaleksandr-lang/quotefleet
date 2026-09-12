/* ═══════════════════════════════════════════════════════════════════════════
   REGENERATES THE HERO BACKDROP RASTERS
   src/server/public/brand/{hero-wash-light,hero-wash-dark,hero-grain,
                            dir-hero-wash}.webp

   WHY THIS FILE EXISTS.  The hero card's backdrop is a saturated-blue-to-pale
   VERTICAL FADE with film grain over it. Our design law forbids CSS gradients,
   so it ships as decorative rasters over a flat base colour (see the Wave 5
   block at the foot of style.css). A raster that nobody can reproduce is a
   liability, so the rasters are GENERATED — not stock, not an image API — and
   this is the generator. Change a token, re-run this, commit the .webp files.

   ONE-OFF TOOL, NOT PART OF THE BUILD.  Nothing in `pnpm build`, CI or the
   test suite calls it, and Playwright is deliberately NOT a dependency of this
   repo — the script only needs a Chromium to do the pixel work and the WebP
   encode, so point it at any Playwright install you already have:

     node scripts/make-hero-wash.mjs [--playwright <path/to/an/install>]
                                     [--only a,b] [--all] [--measure]

   REPRODUCIBLE.  Every random draw comes from a seeded mulberry32, so two runs
   of this script produce byte-identical files. `--measure` re-reads each field
   and prints its luminance envelope, the exact encoded value of the flat tail
   (which the `--surface-hero` token has to match) and the grain's measured
   amplitude, instead of relying on the eye.

   WHAT `--only` IS FOR.  By default this regenerates the THREE HOMEPAGE assets
   and leaves `dir-hero-wash` alone. The directory hero is signed off and its
   committed .webp predates the seeded RNG, so a bare re-run must not rewrite
   it. `--all` (or naming it in `--only`) opts in deliberately.

   ── THE THREE FIELDS ──────────────────────────────────────────────────────

   `wash` — THE HOMEPAGE CARD.  A VERTICAL FADE, PINNED IN ABSOLUTE PIXELS.

   The brief is the reference's: a strongly saturated blue at the top falling
   smoothly to near-white at the bottom, headline in light ink on the blue,
   content below on the pale. Two facts decide how that is built.

   FACT ONE — `cover` CANNOT CARRY A VERTICAL FADE, and the previous centre-lit
   vignette existed because of it. `cover` crops whichever axis is surplus, so
   at a 2560 viewport (card 2509x839, aspect 2.99) a 2560x1100 field anchored
   at `50% 100%` showed only its BOTTOM 65% — the saturated top would simply
   not have been on screen at the width it matters most. So the wash is no
   longer painted with `cover`: it is `100% 1240px` at `0 0`, i.e. stretched to
   the card's width and pinned to its top at its natural height. One raster
   pixel row == one card pixel row at EVERY viewport, which is the only way
   stops chosen against the layout can be honoured at every viewport.

   FACT TWO — CONTENT DOES NOT SIT AT A FIXED FRACTION OF THE CARD. Measured
   with Playwright at 375 / 1024 / 1440 / 2560 in BOTH audience panels, the
   card's height ranges 727px (1440 shippers) to 1200px (375 carriers) while
   the copy block's ABSOLUTE offsets barely move: the headline starts at 111px
   at every width, and the deepest element that has to sit on the blue — the
   carriers "Start free" ghost button — ends at 465px in all four. A
   proportional fade therefore has no solution (at 375 the action cards begin
   at 40% of the card, at 1440 at 61%); a pixel-pinned one has an easy one.

   THE STOPS, AND THE MEASUREMENTS THAT CHOSE THEM:

       0 → 475px   SATURATED. #016490 at the very top edge easing to #0171A2
                   by 404px and holding. Deepest where the 54px headline sits
                   (111-289) and at its brightest under the button, which is
                   the element with the least contrast headroom.
     475 → 585px   THE TRANSITION, smoothstep. Everything a reader looks at is
                   outside it: carriers CTA ends 465, carriers card TEXT starts
                   573 (375) / 609 (1440), shippers stat row starts 538 — and
                   smoothstep is flat at both ends, so 538px is already 97% of
                   the way to pale rather than halfway.
    585 → 1240px   FLAT `--surface-hero`, held all the way down. 1240 is not a
                   round number: the tallest the card gets at any width tested
                   is 1200px (375, carriers), so the raster COVERS the card
                   outright and its bottom edge is never on screen. The flat
                   base colour underneath is therefore a fallback for a failed
                   image rather than a visible neighbour — but it is still set
                   to the tail's ENCODED value, so a card taller than 1240
                   would meet its own colour rather than a step.

   The band is not a dead rectangle: a two-octave low-frequency mesh and a wide
   shallow lift toward the upper centre give it some direction. Both are capped
   at MESH_CAP levels and both taper to exactly zero before the flat tail.

   `grain` — THE TEXTURE LAYER: ISOTROPIC, BIDIRECTIONAL FILM GRAIN.

   This replaces the white streak tile. The reference was sampled rather than
   guessed. High-frequency luminance sigma, a 9x9 box mean subtracted first so
   the fade itself is not counted, on flat text-free patches:

     hero panel, azure band      2.95 - 3.37   peak 20 - 27
     hero panel, near-white tail 0.49          peak 1.7
     palette panel, periwinkle   4.62 - 5.49   peak 31 - 38

   Ours targets the TOP of that range at both ends, because "visible at 100%
   across the whole field" is the brief and their pale end has none.

   WHY BIDIRECTIONAL, AND WHY THAT IS THE WHOLE REASON THE OLD GRAIN WAS
   INVISIBLE. Every pixel of the old tile was WHITE at a varying alpha, which
   can only LIGHTEN. On the old pale wash that bought nothing: white at 7% over
   #EFF6FF moves the ground 0.7 of a level, which is not a texture, it is a
   rounding error — and no amount of extra alpha fixes it, because the ceiling
   is white itself. Pixels here are white OR black, so the layer works against
   whatever it sits on: on the saturated top the white side does the work
   (+11 levels at its peak), on the near-white bottom the black side does
   (-12), and the amplitude is roughly even end to end.

   THE CONTRAST ARGUMENT CHANGES SHAPE WITH IT. A white-only layer could not
   cost light-theme dark ink anything, so it only ever had to be bounded in
   dark. A bidirectional layer has a worst case at BOTH ends: the lightest
   pixel is the worst case for light ink on the blue, the darkest pixel is the
   worst case for dark ink on the pale. Both are bounded by GRAIN_WHITE /
   GRAIN_BLACK alone, and both are measured on the rendered page rather than
   asserted — see the contrast table in the PR.

   The two alphas are NOT equal, because the leverage is not. Over the azure
   band a white pixel moves the perceived grey by alpha x 148 levels and a
   black one by alpha x 107; over the pale tail it is alpha x 12 against
   alpha x 243. GRAIN_WHITE is therefore the larger of the two.

   OURS IS HEAVIER THAN THE REFERENCE'S, ON PURPOSE. Measured the same way on
   their flat patches, their grain is sigma 2.95-3.37 on the azure and 0.49 on
   the near-white — i.e. essentially none at the pale end. The brief is for
   grain that is obvious at 100% across the WHOLE field, so ours runs ~5 on the
   band and ~3.8 on the tail.

   IT SHIPS AS **TWO** TILES, AND THAT IS AN ENCODER FACT, NOT A DESIGN ONE.
   WebP compresses the alpha channel LOSSLESSLY and the colour channels lossily,
   so the cheapest place to put high-frequency detail by a wide margin is alpha
   — which is why the old white-only tile cost 13.9 KB with a constant RGB
   plane. Putting the sign in RGB instead (white pixels next to black ones)
   makes the colour plane a random binary image, the single most expensive
   thing a lossy encoder can be handed: the same field as one RGBA tile
   measured 67.3 KB. Split into `hero-grain` (white, alpha varies) and
   `hero-grain-ink` (black, alpha varies), both planes are constant-colour
   again and the pair costs a quarter of that. They are generated from ONE
   stream of draws so the sign decision is shared: a pixel that is white in the
   first tile is fully transparent in the second and vice versa, which is what
   keeps the two layers from partly cancelling each other out.

   STILL A SEPARATE, TILED ASSET, for the same mechanical reason as before:
   detail baked into the wash cannot survive, because the wash is RESAMPLED to
   the card's width (1440 -> 2509 at a 2560 viewport, 1440 -> 368 at 375) and
   resampling averages per-pixel texture out of existence. The tile is laid
   over the wash at `background-repeat: repeat` and its NATURAL 256x256 — 1:1
   device pixels, no resampling, identical at every card width, and it carries
   on over the flat base colour below the raster so the texture does not stop
   where the raster does.

   A note on the encode, because it is counter-intuitive: Chromium's canvas
   WebP encoder is LOSSY even at quality 1. That is harmless here (the measured
   amplitude is unchanged and there is no blocking) and it is by far the
   cheapest option for noise, which is otherwise incompressible.

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
   1440px spanning ~25 8-bit levels means a ~58px plateau per level — textbook
   visible banding. A ±1 LSB triangular-PDF perturbation before rounding breaks
   every plateau into noise the eye integrates back to a smooth ramp, and it
   survives the WebP quantiser. It is applied only where the field is actually
   moving: the flat tail is left bit-exact so it can match the base token.
   This is an anti-banding measure and is invisible by design; it is NOT the
   grain.
   ═══════════════════════════════════════════════════════════════════════════ */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'src', 'server', 'public', 'brand');

const QUALITY = 0.9;
/* The wash is a long smooth ramp, which is exactly what a lossy encoder is
   worst at (it quantises the flat tail away from the token value it has to
   match). It is also the cheapest thing in the set to encode, so it gets the
   headroom. */
const WASH_QUALITY = 0.97;

/* ── THE FADE, IN CARD PIXELS. See the header for how these were measured. ── */
const BLUE_END = 475;     // saturated down to here
const PALE_START = 585;   // near-white from here
const BAND_SETTLE = 404;  // where the top's deepening has finished easing

/* ── GRAIN AMPLITUDES, 0-1. The reference measures sigma 4.6-6.0 levels on its
   saturated panel; these land ours at ~5 on the blue and ~3.5 on the pale.
   They are also the ONLY bound on the composited worst case at both ends —
   see the header. White is the larger of the two because its leverage is
   smaller: over #2F4FE1 a white pixel moves the perceived grey by alpha x 162
   levels and a black one by alpha x 93, and over the pale tail it is alpha x
   10 against alpha x 245. */
const GRAIN_WHITE = 0.065;
const GRAIN_BLACK = 0.042;
/* GRAIN_FLOOR is the whole reason the amplitudes above can be this large and
   still clear AA. Sigma is what you SEE; the single brightest pixel is what
   the contrast check measures, so the figure of merit is peak/sigma, and it is
   set entirely by the amplitude distribution. A triangular PDF on [-1,1] —
   the obvious choice, and what the dither uses — has peak/sigma 2.85, i.e.
   three-quarters of the contrast budget is spent on rare extremes nobody can
   see. Drawing the MAGNITUDE from [GRAIN_FLOOR, 1] instead takes that to 1.48:
   every pixel carries real texture, none carries a spike. It is also the more
   faithful model — film grain is developed silver crystals, present or absent,
   not a bell curve around zero. */
const GRAIN_FLOOR = 0.55;
const GRAIN_LEVELS = 7;   // per side, across the USED band. 16 RGBA values.
/* Noise is incompressible, so the tile is the one asset whose size is set by
   the encoder rather than by its content. At q1 it is 38 KB; this is the
   lowest quality at which the measured sigma is still within 4% of the
   unencoded field, checked with `--measure`. */
const GRAIN_QUALITY = 0.72;

/* Ceiling on the wash's own low-frequency life, in 8-bit levels. The lightest
   pixel of the blue band is the worst case for the light ink on top of it, so
   the mesh is not allowed to add more than this to it. */
const MESH_CAP = 3;

const VARIANTS = [
  /* HOMEPAGE — `field: 'wash'`, a pixel-pinned vertical fade. Anchors:
     `deep`  the top edge          -> #016490
     `base`  the body of the band  -> #0171A2
     `pale`  the flat tail         -> --surface-hero

     Every anchor is stated PRE-GRAIN and PRE-ENCODE. The grain tile composites
     as c(1 - MW - MB) + 255*MW, which pulls light values down a few levels and
     pushes dark values up a few; `--measure` prints the post-encode envelope
     so the contrast claims are measured rather than asserted.

     `pale` is the tail, and the `--surface-hero` token is set to what this
     anchor ENCODES to rather than to the anchor itself — WebP is lossy, the
     tail came out of the encoder at #F1F6FF, and it is the encoded value the
     base colour has to match if the two are ever to meet without a step.
     `--measure` prints it, so the token is checkable rather than asserted.

     THE BAND IS NOT OUR BRAND BLUE, AND THAT IS DELIBERATE AND OWNER-VISIBLE.
     The owner supplied three reference panels and they are not one palette.
     Sampled off flat, text-free patches:

       hero panel   #0179AD   hue 198  sat 0.99  L 0.166   <- azure / cerulean
       hero panel 2 #0177AB   hue 198  sat 0.99  L 0.162
       palette      #4660E9   hue 230  sat 0.70  L 0.156   <- periwinkle
       ours today   #3356EE   hue 229  sat 0.79  L 0.144

     32 degrees of hue between the hero panels and everything else — a
     different colour, not a near-duplicate, and the azure is the surface the
     owner is actually pointing at for this card. So the band follows it. It is
     a RASTER, so it introduces no token and trips no guard, but it does mean
     the hero no longer matches `--accent`; whether the site's accent should
     follow is the owner's call and is raised in the PR, not decided here.

     `base` #0171A2 is a shade under the reference's own #0172A4 mid-band, and
     the margin is the grain's. The band's brightest pixel is the worst case
     for the white ink on it and the grain's brightest pixel lands on top of
     that: white needs the ground under luminance 0.1833, #0171A2 is 0.1442
     bare and 0.1732 with the brightest grain and mesh on it (4.70:1). The
     reference's own #017BB1 is 0.174 bare, which leaves nothing at all — it
     carries 90px display type and no body copy, and we carry an 18px lead. */
  { name: 'hero-wash-light', home: true, field: 'wash', W: 1440, H: 1240,
    deep: [1, 100, 144], base: [1, 113, 162], pale: [237, 245, 250] },
  /* Dark sibling — the same IDEA inverted, not a suppression. A saturated
     blue-to-white fade is meaningless on a dark page, so this runs deep navy
     to near-black: #0E1A4C at the top edge, #142363 through the band, landing
     on the dark `--surface-hero` #131A28 so the card still separates from the
     #0C111D page ground rather than dissolving into it.

     The dark theme needs NO text inversion — its ink is already light — so the
     constraint here is the opposite one: the ground has to stay DARK ENOUGH.
     `--muted` #90A1B9 needs the ground under luminance 0.0361, so the band is
     capped there INCLUDING the grain's lightest pixel, which is why it tops out
     at #05263A (0.0173 bare, 0.0308 under the brightest grain, 4.80:1) rather
     than at the more obviously teal #062F45 (0.0250 bare, which fails once the
     grain is on it). Same 198-degree hue as the light band, so the two themes
     are the same idea rather than two colours. */
  { name: 'hero-wash-dark', home: true, field: 'wash', W: 1440, H: 1240,
    deep: [3, 28, 43], base: [5, 38, 58], pale: [19, 26, 40] },
  /* The tiled texture. Theme-agnostic; see the `grain` note above. */
  { name: 'hero-grain',     home: true, field: 'grain', side: 'white', W: 256, H: 256, quality: GRAIN_QUALITY },
  { name: 'hero-grain-ink', home: true, field: 'grain', side: 'black', W: 256, H: 256, quality: GRAIN_QUALITY },

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
  const { W, H, pale, base, deep, quality, washQuality, field, maxQuality,
    blueEnd, paleStart, bandSettle, grainWhite, grainBlack, grainFloor, grainLevels, meshCap, side } = cfg;
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

  /* ── The grain tile. WHITE **OR** BLACK pixels at a varying alpha. ─────── */
  if (field === 'grain') {
    /* Three draws per pixel: the SIGN (white or black), the MAGNITUDE, and the
       dither that quantises it. The magnitude is drawn from
       [grainFloor, 1] rather than from [0, 1] — see the GRAIN_FLOOR note at
       the top for why that, and not a bell curve, is what makes a visible
       grain affordable.

       `clump` is a light 2px-scale modulation so the texture has the slight
       unevenness real film has instead of the perfectly uncorrelated look of
       TV static. It is a MULTIPLIER bounded at 1, so it can only ever reduce
       an amplitude, never push one past its cap — which is what lets the
       contrast argument be made against grainWhite / grainBlack alone. */
    const span = 1 - grainFloor;
    const wantWhite = side === 'white';
    const c = wantWhite ? 255 : 0;
    const peak = wantWhite ? grainWhite : grainBlack;
    let q = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        /* BOTH draws happen on every pixel in BOTH passes, whether or not this
           tile is the one that uses them. That is what makes the two files a
           matched pair rather than two unrelated noise fields: the sign
           sequence is identical, so exactly one of the two tiles is opaque at
           any given pixel. */
        const white = rnd() < 0.5;
        const mag = grainFloor + span * rnd();
        if (white !== wantWhite) { d[q] = c; d[q + 1] = c; d[q + 2] = c; d[q + 3] = 0; q += 4; continue; }
        const clump = 0.78 + 0.22 * vnoise(x / 2.3 + 11.7, y / 2.3 + 4.1);
        /* Quantise across the USED band [grainFloor, 1], not across [0, 1]:
           at 10 levels the former spends every level on a value that occurs,
           the latter would waste half of them below the floor. */
        const t = clamp01((mag * clump - grainFloor) / span);
        const lvl = Math.round(t * (grainLevels - 1));
        const alpha = (grainFloor + span * (lvl / (grainLevels - 1))) * peak;
        d[q] = c; d[q + 1] = c; d[q + 2] = c;
        d[q + 3] = Math.round(alpha * 255);
        q += 4;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL('image/webp', maxQuality ? 1 : quality);
  }

  let p = 0;
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);

      let col;
      if (field === 'facet') {
        // The diagonal itself: top-left (0) -> bottom-right (1), eased so the
        // token fill sits through the middle where most of the copy lands.
        const diag = smooth(-0.05, 1.05, (u + v) * 0.5);
        const tex = facet(u, v) * 0.06
          + (vnoise(u * 3.1 + 5.5, v * 2.2 + 1.3) - 0.5) * 0.065;
        const s = clamp01((diag - 0.5) * 2 + tex);   // -> `deep` half
        const l = clamp01((0.5 - diag) * 2 - tex);   // -> `pale` half
        col = [0, 1, 2].map((ch) => {
          const mid = base[ch] + (deep[ch] - base[ch]) * s;
          return mid + (pale[ch] - mid) * l * (1 - s);
        });
        for (let ch = 0; ch < 3; ch++) {
          let val = col[ch] + rnd() + rnd() - 1;       // triangular-PDF dither
          val = Math.round(val);
          d[p + ch] = val < 0 ? 0 : val > 255 ? 255 : val;
        }
        d[p + 3] = 255;
        p += 4;
        continue;
      }

      /* ── THE VERTICAL FADE, IN CARD PIXELS (y IS the card's y). ───────── */

      /* 1. The band's own top-deepening: `deep` at y=0 easing to `base` by
            BAND_SETTLE, then held flat through to BLUE_END. The button with
            the least headroom sits in the held part, so its ground is a known
            constant rather than wherever a ramp happened to be. */
      const bandMix = smooth(0, bandSettle, y);

      /* 2. The fade out of the band. Smoothstep rather than linear precisely
            BECAUSE it is flat at both ends: the two elements closest to the
            transition (the CTA above it, the stat row below it) are inside
            those flat runs, so neither lands on a genuinely intermediate
            tone. */
      const fade = smooth(blueEnd, paleStart, y);

      /* 3. Low-frequency life, capped and tapered to EXACTLY zero before the
            flat tail begins, so the tail can match the base token bit for
            bit. Two octaves of mesh plus a wide shallow lift toward the upper
            centre, which is what stops the band reading as a printed
            rectangle. */
      const live = 1 - smooth(blueEnd - 60, paleStart - 20, y);
      const mesh = ((vnoise(u * 2.4 + 0.7, v * 3.1 + 0.4) - 0.5) * 1.25
        + (vnoise(u * 5.1 + 3.1, v * 6.4 + 1.9) - 0.5) * 0.55);
      const lift = (1 - smooth(0, 0.62, Math.abs(u - 0.5) * 1.55)) * (1 - smooth(0, blueEnd, y)) * 0.8;
      const wobble = (mesh + lift) * meshCap * live;

      for (let ch = 0; ch < 3; ch++) {
        const band = deep[ch] + (base[ch] - deep[ch]) * bandMix;
        let val = band + (pale[ch] - band) * fade;
        if (live > 0.0005) {
          val += wobble;
          val += rnd() + rnd() - 1;                   // triangular-PDF dither
          val = Math.round(val);
        }
        d[p + ch] = val < 0 ? 0 : val > 255 ? 255 : val;
      }
      d[p + 3] = 255;
      p += 4;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/webp', field === 'wash' ? washQuality : quality);
};

/* Reads a just-written .webp back and prints what the CSS comments claim:
   the luminance envelope of the band and of the tail, the EXACT encoded value
   of the flat tail (which `--surface-hero` has to equal), and — for the tile —
   the composited amplitude on both grounds it has to work on. */
const measure = async ({ dataUrl, cfg, pairUrl }) => {
  const read = async (u) => {
    const im = new Image();
    im.src = u;
    await im.decode();
    const cv = document.createElement('canvas');
    cv.width = im.width; cv.height = im.height;
    const c2 = cv.getContext('2d', { willReadFrequently: true });
    c2.drawImage(im, 0, 0);
    return { d: c2.getImageData(0, 0, cv.width, cv.height).data, w: cv.width, h: cv.height };
  };
  const main = await read(dataUrl);
  const D = main.d;
  const c = { width: main.w, height: main.h };
  const hex = (r, g, b) => '#' + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0').toUpperCase()).join('');
  const L = (r, g, b) => {
    const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };

  if (cfg.field === 'grain') {
    /* Composite BOTH tiles over each ground the pair has to work on — one
       alone is only half the field — and report the high-frequency sigma and
       the worst single-pixel excursion in each direction. Those two numbers
       ARE the contrast bound the CSS comments claim. */
    const P = pairUrl ? (await read(pairUrl)).d : null;
    const out = [];
    for (const [label, g] of [['on band #0171A2', [1, 113, 162]], ['on pale #EDF5FA', [237, 245, 250]], ['on dark #05263A', [5, 38, 58]]]) {
      let sum = 0, sq = 0, n = 0, lo = 9, hi = -1;
      for (let i = 0; i < D.length; i += 4) {
        const a = D[i + 3] / 255;
        let r = g[0] * (1 - a) + D[i] * a;
        let gg = g[1] * (1 - a) + D[i + 1] * a;
        let b = g[2] * (1 - a) + D[i + 2] * a;
        if (P) {
          const a2 = P[i + 3] / 255;
          r = r * (1 - a2) + P[i] * a2;
          gg = gg * (1 - a2) + P[i + 1] * a2;
          b = b * (1 - a2) + P[i + 2] * a2;
        }
        const grey = 0.299 * r + 0.587 * gg + 0.114 * b;
        sum += grey; sq += grey * grey; n++;
        const l = L(r, gg, b);
        if (l < lo) lo = l; if (l > hi) hi = l;
      }
      const mean = sum / n;
      out.push(`GRAIN PAIR ${label}  sigma ${Math.sqrt(sq / n - mean * mean).toFixed(2)} levels  meanGrey ${mean.toFixed(1)}  L ${lo.toFixed(4)}..${hi.toFixed(4)}`);
    }
    return out;
  }

  const rowAt = (y) => {
    let lo = 9, hi = -1, sr = 0, sg = 0, sb = 0, n = 0;
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      const l = L(D[i], D[i + 1], D[i + 2]);
      if (l < lo) lo = l; if (l > hi) hi = l;
      sr += D[i]; sg += D[i + 1]; sb += D[i + 2]; n++;
    }
    return { lo, hi, hex: hex(sr / n, sg / n, sb / n) };
  };
  const rows = [0, 111, 289, 326, 465, cfg.blueEnd, 530, cfg.paleStart, 640, c.height - 1];
  const lines = rows.map((y) => {
    const r = rowAt(y);
    return `y=${String(y).padStart(4)}  ${r.hex}  L ${r.lo.toFixed(4)}..${r.hi.toFixed(4)}`;
  });
  /* The one number the CSS depends on: is the tail actually flat, and at what
     value did the encoder leave it? */
  let tailMin = [255, 255, 255], tailMax = [0, 0, 0];
  for (let y = cfg.paleStart + 30; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        if (D[i + ch] < tailMin[ch]) tailMin[ch] = D[i + ch];
        if (D[i + ch] > tailMax[ch]) tailMax[ch] = D[i + ch];
      }
    }
  }
  lines.push(`TAIL encoded ${hex(...tailMin)} .. ${hex(...tailMax)}   (must equal --surface-hero)`);
  return lines;
};

const argOnly = process.argv.indexOf('--only');
const wanted = argOnly > -1 ? new Set(String(process.argv[argOnly + 1]).split(',')) : null;
const all = process.argv.includes('--all');
const doMeasure = process.argv.includes('--measure');
const targets = VARIANTS.filter((v) => (wanted ? wanted.has(v.name) : all || v.home));

const grainUrls = {};
let grainCfg = null;

const chromium = resolveChromium();
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('about:blank');

for (const variant of targets) {
  const cfg = {
    quality: QUALITY, washQuality: WASH_QUALITY,
    blueEnd: BLUE_END, paleStart: PALE_START, bandSettle: BAND_SETTLE,
    grainWhite: GRAIN_WHITE, grainBlack: GRAIN_BLACK, grainFloor: GRAIN_FLOOR,
    grainLevels: GRAIN_LEVELS,
    meshCap: MESH_CAP, ...variant,
  };
  const dataUrl = await page.evaluate(draw, cfg);
  const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
  const file = path.join(OUT, `${variant.name}.webp`);
  fs.writeFileSync(file, buf);
  console.log(`${variant.name}.webp  ${variant.W}x${variant.H}  ${(buf.length / 1024).toFixed(1)} KB`);
  if (variant.field === 'grain') { grainUrls[variant.side] = dataUrl; grainCfg = cfg; continue; }
  if (doMeasure) {
    for (const line of await page.evaluate(measure, { dataUrl, cfg })) console.log(`   ${line}`);
  }
}

if (doMeasure && grainUrls.white && grainUrls.black) {
  for (const line of await page.evaluate(measure, { dataUrl: grainUrls.white, pairUrl: grainUrls.black, cfg: grainCfg })) {
    console.log(`   ${line}`);
  }
}

await browser.close();
