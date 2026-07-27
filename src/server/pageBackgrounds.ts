/**
 * Per-tenant HOSTED-PAGE BACKGROUND — the decorative surface the calculator
 * card sits ON at `/w/:slug`. Single source of truth for the option universe +
 * the resolve/sanitize plumbing.
 *
 * WHERE IT LIVES: the tenant's choice is a single string key,
 * `brand_configs.features_json.pageBackground`, exactly like the nested
 * `booking` / `followUp` objects in src/server/features.ts — so NO migration is
 * needed and it never collides with the boolean feature flags. resolveFeatures()
 * ignores it (it isn't a known boolean key); this module owns it.
 *
 * HOW IT REACHES THE PAGE:
 *   - `/api/public/widget/:slug` calls {@link resolvePageBackground} and returns
 *     `pageBackground` (a bare id string) on the widget config.
 *   - `widget.js` sets the matching `qf-bg-<id>` class on <body>; the CSS in
 *     public/page-backgrounds.css paints a fixed `::before` layer behind the
 *     card. The DEFAULT 'solid' has NO ::before rule → the page is pixel-for-
 *     pixel identical to today for every existing tenant (opt-in decoration).
 *
 * VISUAL CONTRACT: every pattern is theme-aware — it derives its ink from the
 * runtime `--w-text` / `--w-accent` tokens (white on dark presets, ink on light
 * presets) at very low opacity, so it reads on BOTH a dark and a light
 * `--w-page-bg` base and always stays subtle/premium, never loud.
 *
 * Brand inspiration lives in `inspiration` only; `label` is a neutral premium
 * name (no trademarks). Adding a background later = add an entry here + a
 * `.qf-bg-<id>` rule in page-backgrounds.css; the resolver/sanitizer/PUT keep
 * working unchanged.
 */

/** One selectable hosted-page background. */
export interface PageBackground {
  /** Stable id — also the CSS class suffix (`qf-bg-<id>`). */
  id: string;
  /** Neutral, user-facing name (no trademarks). */
  label: string;
  /** One-line description of the look. */
  description: string;
  /** The big-company surface it's inspired by (shown as a caption). */
  inspiration: string;
}

/**
 * The curated set. `solid` is the default (the current flat `--w-page-bg`, no
 * pattern). Order is the order the customize picker renders them.
 */
export const PAGE_BACKGROUNDS: readonly PageBackground[] = [
  {
    id: 'solid',
    label: 'Solid',
    description: 'A clean flat page in your theme color. No pattern — the default.',
    inspiration: 'QuoteFleet default',
  },
  {
    id: 'dots',
    label: 'Dot grid',
    description: 'A subtle grid of soft dots for gentle depth.',
    inspiration: 'Tailwind / Linear',
  },
  {
    id: 'dashed',
    label: 'Dashed grid',
    description: 'A light dashed line grid — technical but understated.',
    inspiration: 'Figma / design tools',
  },
  {
    id: 'stripes',
    label: 'Diagonal lines',
    description: 'Thin diagonal pinstripes for quiet texture.',
    inspiration: 'GitHub / Vercel',
  },
  {
    id: 'blueprint',
    label: 'Blueprint',
    description: 'A fine crosshatch grid with a faint accent tint.',
    inspiration: 'Notion / engineering docs',
  },
  {
    id: 'mesh',
    label: 'Gradient mesh',
    description: 'A soft multi-point gradient wash in your accent.',
    inspiration: 'Stripe',
  },
  {
    id: 'aurora',
    label: 'Aurora',
    description: 'Blurred accent blobs drifting behind the card.',
    inspiration: 'Linear / Vercel',
  },
  {
    id: 'glow',
    label: 'Halo glow',
    description: 'A single soft accent halo rising from the top.',
    inspiration: 'Framer / product launch pages',
  },
  {
    id: 'grain',
    label: 'Fine grain',
    description: 'A whisper of premium film-grain texture.',
    inspiration: 'Apple / premium hardware sites',
  },
] as const;

/** The default background — the current flat page, no decoration. */
export const DEFAULT_PAGE_BACKGROUND = 'solid';

/** Fast id lookup / membership test. */
const PAGE_BACKGROUND_IDS: ReadonlySet<string> = new Set(PAGE_BACKGROUNDS.map((b) => b.id));

/** True for a known background id. */
export function isPageBackgroundId(v: unknown): v is string {
  return typeof v === 'string' && PAGE_BACKGROUND_IDS.has(v);
}

type BrandLike = { featuresJson?: Record<string, unknown> | null } | null | undefined;

/**
 * Resolve a brand row's raw `featuresJson.pageBackground` into a known id.
 * Null / missing / unknown / malformed input falls back to
 * DEFAULT_PAGE_BACKGROUND ('solid') — so a corrupt or hand-edited column can
 * never render an undefined class or change the default look by accident.
 */
export function resolvePageBackground(brand: BrandLike): string {
  const raw = (brand && brand.featuresJson) || {};
  const v = (raw as Record<string, unknown>).pageBackground;
  return isPageBackgroundId(v) ? v : DEFAULT_PAGE_BACKGROUND;
}

/**
 * Sanitize an incoming page-background patch (the dashboard sends the id under
 * `featuresJson.pageBackground`). Returns a known id string to persist, or
 * undefined when there is nothing valid to write (so the merge-PUT never stores
 * junk and never drops sibling featuresJson keys). Mirrors sanitizeBookingPatch
 * / sanitizeFollowUpPatch, but the value is a single string, not an object.
 */
export function sanitizePageBackgroundPatch(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const v = (input as Record<string, unknown>).pageBackground;
  if (v === undefined) return undefined;
  return isPageBackgroundId(v) ? v : DEFAULT_PAGE_BACKGROUND;
}
