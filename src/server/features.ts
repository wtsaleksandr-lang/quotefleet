/**
 * Per-tenant widget feature toggles — single source of truth.
 *
 * `brand_configs.features_json` is an optional, extensible JSON bag of opt-in
 * widget features (see src/db/schema.ts). This module resolves that raw column
 * — which may be null (existing tenants), missing keys, or partially set —
 * into a fully-populated, typed `WidgetFeatures` object with defaults applied.
 *
 * Every surface that needs to know whether a feature is on (the public widget
 * config, the share endpoint's 403 gate, the dashboard toggle) resolves through
 * `resolveFeatures` so the defaults never drift.
 *
 * Defaults:
 *   quoteShare  = true   — the customer share / email / print / PDF action bar
 *                          is ON out of the box (opt-OUT).
 *   quoteBooking = false  — reserved for a later booking wave (opt-IN).
 *
 * Adding a feature later = add a key to WidgetFeatures + FEATURE_DEFAULTS. The
 * resolver, the widget config, and the PUT allow-list keep working unchanged.
 */

/** The fully-resolved set of per-tenant widget features. */
export interface WidgetFeatures {
  /** Show the customer-facing share / email me / print / download-PDF action
   *  bar under the quote result. Default true. */
  quoteShare: boolean;
  /** Reserved: let customers request a booking straight from the quote.
   *  Default false — a later wave owns this. */
  quoteBooking: boolean;
}

/** Default value for every known feature. */
export const FEATURE_DEFAULTS: WidgetFeatures = {
  quoteShare: true,
  quoteBooking: false,
};

/** The keys the dashboard toggle + PUT allow-list may write. Anything else in
 *  the incoming JSON is dropped so a client can't stuff arbitrary keys. */
export const FEATURE_KEYS = Object.keys(FEATURE_DEFAULTS) as Array<keyof WidgetFeatures>;

type BrandLike = { featuresJson?: Record<string, unknown> | null } | null | undefined;

/**
 * Resolve a brand row's raw `featuresJson` into a fully-populated, typed
 * feature set. Null/missing/partial input falls back to FEATURE_DEFAULTS per
 * key; only genuine booleans override a default (a non-boolean value is
 * ignored so a malformed column can never disable a feature by accident).
 */
export function resolveFeatures(brand: BrandLike): WidgetFeatures {
  const raw = (brand && brand.featuresJson) || {};
  const out = { ...FEATURE_DEFAULTS };
  for (const key of FEATURE_KEYS) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v === 'boolean') out[key] = v;
  }
  return out;
}

/**
 * Sanitize an incoming partial features patch (from the dashboard PUT) to just
 * the known boolean keys, so the persisted column never accumulates junk keys.
 * Returns undefined when there is nothing valid to write.
 */
export function sanitizeFeaturesPatch(input: unknown): Partial<WidgetFeatures> | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const src = input as Record<string, unknown>;
  const out: Partial<WidgetFeatures> = {};
  for (const key of FEATURE_KEYS) {
    if (typeof src[key] === 'boolean') out[key] = src[key] as boolean;
  }
  return Object.keys(out).length ? out : undefined;
}
