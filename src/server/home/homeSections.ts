/**
 * THE HOMEPAGE BELOW-THE-BENTO-GRID BAND.
 *
 * Two things live here, and they are together because they are one decision:
 * on 2026-09-11 everything the homepage rendered after the freight-tool bento
 * grid was taken off the live page and replaced by a partner / embed banner and
 * a logo marquee.
 *
 *   1. THE HIDE, AND ITS ONE-LINE UNDO.  The old sections are not deleted and
 *      they are not commented out inline. They sit verbatim in
 *      `legacy-below-grid.html` — a sibling file OUTSIDE src/server/public, so
 *      express.static cannot even serve it by accident — and landing.html keeps
 *      a single `<!--qf:home-legacy-sections-->` slot where they used to be.
 *      Flip HOME_LEGACY_SECTIONS_ENABLED to `true` and they render again, in
 *      their original position and order. That is the whole restore.
 *
 *   2. THE LOGO MARQUEE, WHOSE DATA IS DERIVED.  HOME_PARTNER_LOGOS is built
 *      from the curated carrier-logo registry (directory/carrierLogos.ts) —
 *      the same list the directory's own logo slot reads — so the strip and a
 *      carrier profile can never disagree about whose mark is whose. These
 *      carriers are LISTED IN the FMCSA-derived directory. They are not
 *      customers, partners or endorsers, and the heading above them says only
 *      who QuoteFleet is FOR. An empty registry still means NOTHING ships: not
 *      the section, not its stylesheet, not its script.
 *
 * THE BAND IS NOW ENTIRELY STATIC. It reads no database and holds no cache:
 * `renderLogoMarquee` is a pure function of a committed array. The carrier
 * COUNT that used to headline the marquee — and the cached, background-refreshed
 * read behind it — went with the copy change (see `renderHeading`), which is
 * why `applyHomeSections` no longer takes a total and this module no longer
 * imports from directory/queries.
 */
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { esc, monogramInitials } from '../directory/pages.js';
import { CURATED_CARRIER_LOGOS, carrierLogoPaths } from '../directory/carrierLogos.js';

// ─── 1 · The hidden legacy sections ───────────────────────────────────────

/**
 * THE RESTORE SWITCH. `true` puts the pre-2026-09-11 homepage band back.
 *
 * Hidden 2026-09-11 at the owner's request — the below-the-grid stack
 * (how-it-works, showcase rows, before/after, "Everything included",
 * multi-mode, "Use it your way", wins stats, FAQ, trust band, final CTA) was
 * replaced by the partner banner + logo marquee. Nothing was deleted: the
 * markup is in legacy-below-grid.html and comes straight back when this is
 * `true`.
 */
export const HOME_LEGACY_SECTIONS_ENABLED = false;

/**
 * The stylesheets and scripts that existed ONLY for the hidden sections, and
 * were therefore unlinked from landing.html's <head> at the same time.
 *
 * They are still on disk and still guarded by their own tests — unlinking is
 * not deleting. This list exists so that flipping the flag above is not a
 * half-restore: re-add these to the <head> and the sections look exactly as
 * they did. Kept as data rather than prose so a test can assert that a page
 * with the flag OFF loads none of them.
 */
export const HOME_LEGACY_SECTION_ASSETS: readonly string[] = [
  '/landing-how-polish.css', // .hiw-card — the how-it-works stack only
  '/landing-wins-stats.css', // .qf-wins-* — the wins section only
  '/landing-final-cta.css', // .qf-final-cta + .qf-trust-badges — the final CTA only
  '/landing-video-controls.css', // the play/pause chrome for the marketing videos
  '/landing-lazy-video.js', // lazy-loads those same videos
  '/landing-video-controls.js', // drives that chrome
];

/** Where landing.html expects the legacy band. */
export const LEGACY_SECTIONS_SLOT = '<!--qf:home-legacy-sections-->';
/** Where landing.html expects the server-rendered marquee. */
export const LOGO_MARQUEE_SLOT = '<!--qf:home-logo-marquee-->';

const LEGACY_PARTIAL_PATH = resolvePath(process.cwd(), 'src/server/home/legacy-below-grid.html');

let legacyPartialCache: string | null = null;

/**
 * The legacy markup, read once and cached.
 *
 * Only ever called with the flag ON, so a disabled feature costs no file read;
 * and when it IS on, an unreadable partial throws rather than silently emitting
 * an empty band — a restore that quietly restores nothing is the worst outcome.
 */
function legacySectionsHtml(): string {
  if (legacyPartialCache === null) {
    legacyPartialCache = readFileSync(LEGACY_PARTIAL_PATH, 'utf8');
  }
  return legacyPartialCache;
}

// ─── 2 · The partner logo marquee ─────────────────────────────────────────

/**
 * One tile in the marquee.
 *
 * `src` is OPTIONAL and that is deliberate. The directory has held the same
 * line since it shipped (see the carrier LOGO SLOT note in directory/pages.ts):
 * we do not source company logos automatically, because name→domain→logo
 * matching is ~90% accurate and the other 10% is a company wearing somebody
 * else's mark. So a curated entry with no artwork renders as a monogram built
 * from its own name — the same fallback every carrier profile already uses.
 */
export interface PartnerLogo {
  /** The company's own name. Used as the accessible label, and for the monogram. */
  name: string;
  /** Same-origin path to the carrier's own mark. Omit for a monogram tile. */
  src?: string;
  /** Optional destination — typically that carrier's directory profile. */
  href?: string;
}

/**
 * THE MARQUEE'S DATA — DERIVED, NOT TYPED IN.
 *
 * It is the curated carrier-logo registry (directory/carrierLogos.ts), mapped
 * into tiles. That registry is the SAME list the directory's own logo slot
 * reads through `carrierLogoUrl()`, which is the whole reason this is a
 * derivation rather than a second hand-kept array: a homepage strip and a
 * carrier profile that disagree about whose mark is whose is a
 * misidentification, and two lists drift the first time one is edited alone.
 *
 * WHAT THESE TILES CLAIM. Exactly what the heading above them says: these
 * carriers are LISTED IN the FMCSA-derived directory. They are not customers,
 * partners or endorsers — no company here has any relationship with QuoteFleet
 * — and no copy around this section may imply one. The marks stay the property
 * of their owners and are shown to identify the carrier; the footer's
 * data-source note carries that line and an address to request removal.
 *
 * A registry entry with no artwork maps to a tile with NO `src`, which renders
 * the monogram fallback — see `PartnerLogo` above for why that is a real state
 * and not a gap. An empty registry would still mean `renderLogoMarquee`
 * returns '' and the homepage ships no section, stylesheet or script.
 */
export const HOME_PARTNER_LOGOS: readonly PartnerLogo[] = CURATED_CARRIER_LOGOS.map((c) => ({
  name: c.displayName,
  ...(c.logo ? { src: carrierLogoPaths(c.logo).wide } : {}),
}));

/** Injected into <head> only when the marquee actually renders. */
export const MARQUEE_STYLESHEET = '/landing-logo-marquee.css';
/** Injected with the section only when the marquee actually renders. */
export const MARQUEE_SCRIPT = '/landing-logo-marquee.js';

/**
 * How many times the tile list is repeated inside ONE row.
 *
 * The loop works by laying two IDENTICAL rows end to end and sliding the pair
 * left by exactly half its width, so the moment row A leaves, row B is in the
 * same place row A started — seamless, with no measurement and no JS. That only
 * looks right if a single row is at least as wide as the viewport, which four
 * tiles are not. So a short list is repeated until the row is comfortably wider
 * than any desktop, and the two-row structure is unchanged.
 */
const MIN_TILES_PER_ROW = 12;

function repeatToFill<T>(items: readonly T[]): T[] {
  if (items.length === 0) return [];
  const times = Math.max(1, Math.ceil(MIN_TILES_PER_ROW / items.length));
  const out: T[] = [];
  for (let i = 0; i < times; i++) out.push(...items);
  return out;
}

/**
 * NOT `loading="lazy"`, and that is the one non-obvious line in this function.
 *
 * A lazy image loads when it INTERSECTS the viewport, and every tile on this
 * strip is moved by a CSS transform inside an `overflow: clip` box. Tiles well
 * to the right of the cut therefore sit outside the viewport until the moment
 * the animation carries them in — which is exactly when a blank tile would be
 * most visible, and the loop's seam is the worst place for one to appear. The
 * whole set is ~130KB of 2-9KB WebP served with a 7-day TTL, and the duplicate
 * row re-requests nothing, so eager is cheap. `fetchpriority="low"` keeps it
 * behind everything above the fold.
 */
function renderTile(logo: PartnerLogo): string {
  const label = esc(logo.name);
  const inner = logo.src
    ? `<img class="qf-logo-tile__img" src="${esc(logo.src)}" alt="${label}" decoding="async" fetchpriority="low">`
    : `<span class="qf-logo-tile__mono" aria-hidden="true">${esc(monogramInitials(logo.name))}</span><span class="visually-hidden">${label}</span>`;
  const body = logo.href
    ? `<a class="qf-logo-tile__link" href="${esc(logo.href)}">${inner}</a>`
    : inner;
  return `<li class="qf-logo-tile">${body}</li>`;
}

/**
 * THE HEADING — TWO-TONE, LEFT-ALIGNED, AND IT MAKES NO CLAIM ABOUT ANYONE.
 *
 * "Built for drivers, brokers and importers" describes WHO THE PRODUCT IS FOR.
 * That is a statement about QuoteFleet, and it is the only kind of statement
 * this section is allowed to make, because the tiles below it are marks of
 * companies that have no relationship with QuoteFleet. "Trusted by", "our
 * customers", "partners", or ANY count of users next to a wall of other
 * people's logos reads as an endorsement none of them has given.
 *
 * It also carries no number at all, which is a deliberate reversal. The
 * previous heading stated the directory's carrier count, read from the
 * persisted aggregate so it could not go stale. That number was honest but it
 * was the wrong sentence for a logo wall — a figure sitting above a row of
 * marks invites the reader to bind the two — so the count went and with it
 * every line of plumbing that fetched it. The directory still publishes its own
 * size on its own page, where the number is about the page it is on.
 *
 * Two tones, one size, no eyebrow: the lead phrase in `--ink`, the audience in
 * the muted tone — the same idiom as `.qf-toolgrid-head__soft` on the bento
 * grid above and `.qf-partner-title__soft` on the banner between them.
 */
function renderHeading(): string {
  return (
    `<h2 class="qf-marquee-head"><span class="qf-marquee-head__lead">Built for</span> ` +
    `<span class="qf-marquee-head__soft">drivers, brokers and importers</span></h2>`
  );
}

/**
 * The whole marquee section, or the EMPTY STRING when there is nothing to show.
 *
 * Pure and exported so the "empty means absent" contract is unit-testable
 * without a server or a database.
 *
 * `--qf-marquee-tiles` is the ONE piece of data the stylesheet cannot work out
 * for itself, and it buys a constant scroll SPEED. The animation's duration is
 * `tiles × seconds-per-tile`, so adding a carrier to the registry lengthens the
 * cycle instead of speeding the strip up: eleven tiles and twenty-six tiles
 * both travel at the same px/s. It is advisory only — the loop's own geometry
 * is a `-50%` translate of the track, which is self-correcting and stays
 * seamless whatever this number says (see landing-logo-marquee.css).
 */
export function renderLogoMarquee(logos: readonly PartnerLogo[] = HOME_PARTNER_LOGOS): string {
  if (logos.length === 0) return '';
  const row = repeatToFill(logos);
  const tiles = row.map(renderTile).join('');
  return (
    `<section class="section qf-marquee-section" data-reveal>` +
    `<div class="qf-hhero__inner">` +
    renderHeading() +
    `<div class="qf-marquee" data-qf-marquee style="--qf-marquee-tiles: ${row.length}">` +
    `<div class="qf-marquee__track">` +
    `<ul class="qf-marquee__row" role="list">${tiles}</ul>` +
    `<ul class="qf-marquee__row" role="list" aria-hidden="true">${tiles}</ul>` +
    `</div></div></div></section>` +
    `<script src="${MARQUEE_SCRIPT}" defer></script>`
  );
}

// ─── 3 · Markup substitution ──────────────────────────────────────────────

class HomeSectionSlotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HomeSectionSlotError';
  }
}

/** Fill a slot comment, loudly. A missing slot is a silent no-op otherwise —
 *  exactly the failure mode where the page quietly loses a whole section. */
function fillSlot(html: string, slot: string, value: string, label: string): string {
  if (!html.includes(slot)) {
    throw new HomeSectionSlotError(`${label}: expected the slot ${slot} and it is not there`);
  }
  return html.replace(slot, () => value);
}

/**
 * Render the homepage's below-the-grid band into landing.html.
 *
 * Both slots are filled on every call — with the empty string when the feature
 * behind them is off, which is what "hidden" means here: the page ships without
 * the markup rather than with display:none'd markup a crawler still reads.
 */
export function applyHomeSections(
  html: string,
  opts: {
    legacyEnabled?: boolean;
    logos?: readonly PartnerLogo[];
  } = {},
): string {
  const legacyEnabled = opts.legacyEnabled ?? HOME_LEGACY_SECTIONS_ENABLED;
  const logos = opts.logos ?? HOME_PARTNER_LOGOS;

  let out = fillSlot(html, LEGACY_SECTIONS_SLOT, legacyEnabled ? legacySectionsHtml() : '', 'home legacy sections');
  const marquee = renderLogoMarquee(logos);
  out = fillSlot(out, LOGO_MARQUEE_SLOT, marquee, 'home logo marquee');
  // The marquee's stylesheet rides with the marquee. Linking it unconditionally
  // would be a render-blocking download for a section that is not on the page.
  if (marquee) {
    out = out.replace('</head>', () => `  <link rel="stylesheet" href="${MARQUEE_STYLESHEET}">\n</head>`);
  }
  return out;
}

/**
 * BOOT-TIME SLOT AUDIT, in the same spirit as verifySiteChromeSlots.
 *
 * `applyHomeSections` throwing on a request is correct but late. This runs once
 * while the app is being constructed, so a landing.html that lost a slot fails
 * the very first `createApp()` — in the test suite, in CI, and before a deploy
 * can serve a homepage with a section silently missing.
 */
export function verifyHomeSectionSlots(publicDir: string): void {
  const html = readFileSync(resolvePath(publicDir, 'landing.html'), 'utf8');
  for (const slot of [LEGACY_SECTIONS_SLOT, LOGO_MARQUEE_SLOT]) {
    if (!html.includes(slot)) {
      throw new HomeSectionSlotError(`landing.html is missing the slot ${slot}`);
    }
  }
  if (HOME_LEGACY_SECTIONS_ENABLED) legacySectionsHtml(); // throws now, not on a request
}
