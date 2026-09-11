/**
 * THE HOMEPAGE BELOW-THE-BENTO-GRID BAND.
 *
 * Three things live here, and they are together because they are one decision:
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
 *   2. THE LOGO MARQUEE, WHICH SHIPS EMPTY ON PURPOSE.  HOME_PARTNER_LOGOS is
 *      `[]`. A marquee of other companies' marks is a claim about who works
 *      with us, so it stays empty until there is something true to put in it —
 *      a carrier that has genuinely claimed its profile, or an owner-curated
 *      partner. While it is empty NOTHING ships: not the section, not its
 *      stylesheet, not its script. Adding entries to that one array is the only
 *      change needed to turn it on.
 *
 *   3. THE ONE NUMBER ON THE PAGE, TAKEN FROM THE DATA.  The marquee heading
 *      states the size of the carrier directory, and it is read from the
 *      persisted directory summary rather than typed into the HTML — the same
 *      discipline (and the same reason) as directory/fmcsaFreshness.ts: a
 *      hard-coded count is a claim with no source that is true exactly once.
 *      A cold cache renders the heading with NO number instead of a guess.
 *
 * COST ON THE REQUEST PATH: ZERO DB WORK. `homeCarrierTotalNow()` is
 * SYNCHRONOUS, answers from a process-local cache, and kicks a background
 * read when that cache is stale. The homepage acquires no DB dependency.
 */
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { esc, monogramInitials } from '../directory/pages.js';
import { getPersistedCarrierTotal } from '../directory/queries.js';

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
  /** Path to a logo asset WE are licensed to display. Omit for a monogram tile. */
  src?: string;
  /** Optional destination — typically that carrier's directory profile. */
  href?: string;
}

/**
 * THE MARQUEE'S DATA, AND IT IS EMPTY ON PURPOSE.
 *
 * Populate it later from carriers that have genuinely CLAIMED their profile
 * (directory/claims.ts) or from an owner-curated partner set — and only with
 * marks we are licensed to display. Every entry is a public statement that the
 * named company works with us, so an entry with no such relationship behind it
 * is a fabricated endorsement, not a placeholder.
 *
 * While this is `[]`, `renderLogoMarquee` returns the empty string and the
 * homepage ships no section, no stylesheet and no script for it.
 */
export const HOME_PARTNER_LOGOS: readonly PartnerLogo[] = [];

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

function renderTile(logo: PartnerLogo): string {
  const label = esc(logo.name);
  const inner = logo.src
    ? `<img class="qf-logo-tile__img" src="${esc(logo.src)}" alt="${label}" loading="lazy" decoding="async">`
    : `<span class="qf-logo-tile__mono" aria-hidden="true">${esc(monogramInitials(logo.name))}</span><span class="visually-hidden">${label}</span>`;
  const body = logo.href
    ? `<a class="qf-logo-tile__link" href="${esc(logo.href)}">${inner}</a>`
    : inner;
  return `<li class="qf-logo-tile">${body}</li>`;
}

/**
 * The marquee heading — two-tone, left-aligned, and its number comes from the
 * directory rather than from this file.
 *
 * `total === null` (cold cache, no database, an aggregate that has never been
 * computed) drops the number entirely instead of guessing one. The remaining
 * sentence is still true, which is the only bar a marketing line has to clear.
 */
function renderHeading(total: number | null): string {
  if (total === null) {
    return `<h2 class="qf-marquee-head"><span class="qf-marquee-head__soft">Carriers listed in the QuoteFleet directory</span></h2>`;
  }
  const n = total.toLocaleString('en-US');
  return (
    `<h2 class="qf-marquee-head"><span class="qf-marquee-head__n">${esc(n)} carriers</span> ` +
    `<span class="qf-marquee-head__soft">listed in the QuoteFleet directory</span></h2>`
  );
}

/**
 * The whole marquee section, or the EMPTY STRING when there is nothing to show.
 *
 * Pure and exported so the "empty means absent" contract is unit-testable
 * without a server or a database.
 */
export function renderLogoMarquee(
  logos: readonly PartnerLogo[] = HOME_PARTNER_LOGOS,
  total: number | null = null,
): string {
  if (logos.length === 0) return '';
  const tiles = repeatToFill(logos).map(renderTile).join('');
  return (
    `<section class="section qf-marquee-section" data-reveal>` +
    `<div class="qf-hhero__inner">` +
    renderHeading(total) +
    `<div class="qf-marquee" data-qf-marquee>` +
    `<div class="qf-marquee__track">` +
    `<ul class="qf-marquee__row" role="list">${tiles}</ul>` +
    `<ul class="qf-marquee__row" role="list" aria-hidden="true">${tiles}</ul>` +
    `</div></div></div></section>` +
    `<script src="${MARQUEE_SCRIPT}" defer></script>`
  );
}

// ─── 3 · The carrier total, cached off the request path ───────────────────

/** How long a read total is served before a background refresh is kicked. The
 *  underlying number moves at most once a week, so this is generous. */
export const HOME_CARRIER_TOTAL_TTL_MS = 30 * 60 * 1000;

let totalCache: { at: number; val: number | null } | null = null;
let totalInflight: Promise<void> | null = null;

/** Background, single-flighted, never-throwing refresh of the cached total. */
function kickTotalRefresh(): void {
  if (totalInflight) return;
  totalInflight = getPersistedCarrierTotal()
    .then((val) => {
      totalCache = { at: Date.now(), val };
    })
    .catch(() => {
      // getPersistedCarrierTotal already swallows; belt-and-braces so a
      // rejection can never surface as an unhandled promise rejection.
      totalCache = { at: Date.now(), val: totalCache?.val ?? null };
    })
    .finally(() => {
      totalInflight = null;
    });
}

/**
 * The current directory carrier total, or `null` when it is not known yet.
 *
 * SYNCHRONOUS ON PURPOSE — see the module header. A cold cache answers `null`,
 * the heading renders without a number, and the real count takes over on the
 * next request once the background read lands.
 */
export function homeCarrierTotalNow(): number | null {
  const c = totalCache;
  if (!c || Date.now() - c.at >= HOME_CARRIER_TOTAL_TTL_MS) kickTotalRefresh();
  return c?.val ?? null;
}

/** Test seam: drop the cached total (and any pending read's claim on it). */
export function resetHomeCarrierTotalCacheForTests(): void {
  totalCache = null;
  totalInflight = null;
}

// ─── 4 · Markup substitution ──────────────────────────────────────────────

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
    carrierTotal?: number | null;
  } = {},
): string {
  const legacyEnabled = opts.legacyEnabled ?? HOME_LEGACY_SECTIONS_ENABLED;
  const logos = opts.logos ?? HOME_PARTNER_LOGOS;
  const total = opts.carrierTotal === undefined ? homeCarrierTotalNow() : opts.carrierTotal;

  let out = fillSlot(html, LEGACY_SECTIONS_SLOT, legacyEnabled ? legacySectionsHtml() : '', 'home legacy sections');
  const marquee = renderLogoMarquee(logos, total);
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
