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

/* ──────────────────────────────────────────────────────────────────────────
 * Booking deposit config (Wave 2a) — lives in the SAME featuresJson bag under
 * a nested `booking` key (`{ depositType, depositValue }`), separate from the
 * boolean feature flags so resolveFeatures() never sees it and the two never
 * clobber each other on the merge-PUT.
 *
 * The deposit is DISPLAY + intent only in this wave — no charge. Wave 2b
 * (Stripe) reads the same resolved config + computeDeposit() to create the
 * actual PaymentIntent, so the money math has exactly one source of truth.
 * ────────────────────────────────────────────────────────────────────────── */

/** How a per-tenant booking deposit is derived from the quote total.
 *  none = no deposit shown; percent = depositValue% of the quote total;
 *  fixed = depositValue dollars flat. */
export type DepositType = 'none' | 'percent' | 'fixed';

/** Resolved per-tenant booking config (display bits). */
export interface BookingConfig {
  depositType: DepositType;
  /** Percent (0–100) when depositType='percent'; dollars when 'fixed'; unused for 'none'. */
  depositValue: number;
}

/** Safe defaults: no deposit. A tenant that never touched the setting shows
 *  a booking request with no money attached. */
export const BOOKING_DEFAULTS: BookingConfig = { depositType: 'none', depositValue: 0 };

const DEPOSIT_TYPES: readonly DepositType[] = ['none', 'percent', 'fixed'];

/** Coerce an unknown deposit value to a finite, non-negative number (NaN /
 *  negative / non-number → 0). Percent is additionally capped at 100. */
function normalizeDepositValue(v: unknown, type: DepositType): number {
  const n = typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
  return type === 'percent' ? Math.min(n, 100) : n;
}

/**
 * Resolve a brand row's raw `featuresJson.booking` into a fully-populated,
 * typed BookingConfig. Null/missing/partial/malformed input falls back to
 * BOOKING_DEFAULTS (depositType 'none'); an unknown depositType or a
 * NaN/negative depositValue can never enable an accidental charge.
 */
export function resolveBookingConfig(brand: BrandLike): BookingConfig {
  const raw = (brand && brand.featuresJson) || {};
  const b = (raw as Record<string, unknown>).booking;
  if (!b || typeof b !== 'object') return { ...BOOKING_DEFAULTS };
  const src = b as Record<string, unknown>;
  const type = DEPOSIT_TYPES.includes(src.depositType as DepositType)
    ? (src.depositType as DepositType)
    : 'none';
  return { depositType: type, depositValue: normalizeDepositValue(src.depositValue, type) };
}

/**
 * Compute the deposit dollar amount for a given quote total under a resolved
 * BookingConfig. Rounds to cents. Guards a NaN/negative/zero total or value
 * → $0, so a malformed quote can never mint a bogus deposit.
 *   none    → 0
 *   percent → total × depositValue% (value capped at 100 by the resolver)
 *   fixed   → depositValue dollars
 */
export function computeDeposit(total: number, cfg: BookingConfig): number {
  if (!cfg || cfg.depositType === 'none') return 0;
  const value = typeof cfg.depositValue === 'number' && Number.isFinite(cfg.depositValue) && cfg.depositValue > 0
    ? cfg.depositValue
    : 0;
  if (value === 0) return 0;
  if (cfg.depositType === 'fixed') return Math.round(value * 100) / 100;
  // percent
  const t = typeof total === 'number' && Number.isFinite(total) && total > 0 ? total : 0;
  if (t === 0) return 0;
  const pct = Math.min(value, 100);
  return Math.round(t * pct) / 100; // (t * pct/100) rounded to cents
}

/**
 * Sanitize an incoming booking-config patch (from the dashboard PUT) into a
 * full, normalized BookingConfig, or undefined when there is nothing valid to
 * write. Mirrors sanitizeFeaturesPatch but for the nested `booking` object.
 */
export function sanitizeBookingPatch(input: unknown): BookingConfig | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const src = input as Record<string, unknown>;
  if (!('depositType' in src) && !('depositValue' in src)) return undefined;
  const type = DEPOSIT_TYPES.includes(src.depositType as DepositType)
    ? (src.depositType as DepositType)
    : 'none';
  return { depositType: type, depositValue: normalizeDepositValue(src.depositValue, type) };
}
