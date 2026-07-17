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
  /** Forward-email auto-import: give this tenant a dedicated inbound address
   *  (`rates-<token>@…`) they can forward/BCC rate emails to, which the system
   *  reads and applies to their calculator automatically. Default false
   *  (opt-IN) — OFF means no inbound address is minted and the inbound webhook
   *  refuses mail for this tenant. */
  emailImport: boolean;
}

/** Default value for every known feature. */
export const FEATURE_DEFAULTS: WidgetFeatures = {
  quoteShare: true,
  quoteBooking: false,
  emailImport: false,
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

/* ──────────────────────────────────────────────────────────────────────────
 * Automated follow-up + promo config (Wave 1) — lives in the SAME featuresJson
 * bag under a nested `followUp` key, exactly like `booking`, so resolveFeatures()
 * never sees it and a merge-PUT toggling one setting never clobbers another.
 *
 * Marketing model (best-practice freight follow-up): 3 touches, the discount
 * saved for the LAST one (don't train customers to wait for a discount), the
 * sequence auto-stops on conversion/reply/unsubscribe. Per-tenant OPT-IN
 * (enabled default false). Three recommended presets + a custom option;
 * 'standard' is the default preset.
 *
 * This wave configures + persists the shape only. The scheduler/sender (cron,
 * the arming migration, promo-code CRUD) is a LATER wave that reads this same
 * resolved config, so the timing/discount math has exactly one source of truth.
 * ────────────────────────────────────────────────────────────────────────── */

/** The three recommended cadence presets, plus a free-form custom option. */
export type FollowUpPreset = 'gentle' | 'standard' | 'assertive' | 'custom';

/** The tunable numbers of a cadence: the three send offsets (days after the
 *  quote) and the discount percent attached to the third (discount) touch. */
export interface FollowUpCadence {
  /** Days after the quote to send FU1 (the gentle nudge). */
  day1: number;
  /** Days after the quote to send FU2 (the reminder). */
  day2: number;
  /** Days after the quote to send FU3 (the discount). */
  day3: number;
  /** Percent off offered in FU3 (0–90). */
  discountPct: number;
}

/** Resolved per-tenant follow-up config: the on/off flag, the chosen preset,
 *  and the effective cadence (from the preset table unless preset='custom'). */
export interface FollowUpConfig extends FollowUpCadence {
  enabled: boolean;
  preset: FollowUpPreset;
}

/** The recommended-preset table. Offsets climb and the discount is always the
 *  FU3 touch. 'standard' is the default. Custom is not in the table — it reads
 *  the tenant's stored values instead. */
export const FOLLOWUP_PRESETS: Record<'gentle' | 'standard' | 'assertive', FollowUpCadence> = {
  gentle: { day1: 3, day2: 7, day3: 12, discountPct: 5 },
  standard: { day1: 2, day2: 5, day3: 9, discountPct: 8 },
  assertive: { day1: 1, day2: 3, day3: 6, discountPct: 10 },
};

const FOLLOWUP_PRESET_KEYS: readonly FollowUpPreset[] = ['gentle', 'standard', 'assertive', 'custom'];

/** Safe defaults: OFF, standard cadence. A tenant that never touched the setting
 *  sends nothing (enabled=false) but carries the standard preset numbers so the
 *  dashboard renders a sensible starting point. */
export const FOLLOWUP_DEFAULTS: FollowUpConfig = {
  enabled: false,
  preset: 'standard',
  ...FOLLOWUP_PRESETS.standard,
};

/** Coerce an unknown day-offset to a positive integer, falling back to a preset
 *  value when it isn't a finite number ≥ 1. */
function coerceOffset(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n >= 1 ? Math.round(n) : fallback;
}

/** Clamp helper. */
function clampInt(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

/** Normalize a custom cadence from raw stored/patched values, enforcing
 *  1 ≤ day1 < day2 < day3 ≤ 30 and discountPct 0–90. Each offset falls back to
 *  the standard preset when missing/invalid, then the strict ordering is forced
 *  so a bad hand-edit can never mint an out-of-order or out-of-range sequence. */
function normalizeCustomCadence(src: Record<string, unknown>): FollowUpCadence {
  const std = FOLLOWUP_PRESETS.standard;
  const d1 = clampInt(coerceOffset(src.day1, std.day1), 1, 28);
  const d2 = clampInt(coerceOffset(src.day2, std.day2), d1 + 1, 29);
  const d3 = clampInt(coerceOffset(src.day3, std.day3), d2 + 1, 30);
  const rawPct = typeof src.discountPct === 'number' ? src.discountPct : Number(src.discountPct);
  const discountPct = Number.isFinite(rawPct) && rawPct >= 0 ? clampInt(rawPct, 0, 90) : std.discountPct;
  return { day1: d1, day2: d2, day3: d3, discountPct };
}

/**
 * Resolve a brand row's raw `featuresJson.followUp` into a fully-populated,
 * typed FollowUpConfig. Null/missing/malformed input falls back to
 * FOLLOWUP_DEFAULTS (OFF, standard). When preset ≠ 'custom' the cadence comes
 * from the preset table; when 'custom' it comes from the (normalized) stored
 * values — so a preset tenant always reflects the canonical numbers even if the
 * stored custom fields drift.
 */
export function resolveFollowUpConfig(brand: BrandLike): FollowUpConfig {
  const raw = (brand && brand.featuresJson) || {};
  const f = (raw as Record<string, unknown>).followUp;
  if (!f || typeof f !== 'object') return { ...FOLLOWUP_DEFAULTS };
  const src = f as Record<string, unknown>;
  const enabled = src.enabled === true;
  const preset = FOLLOWUP_PRESET_KEYS.includes(src.preset as FollowUpPreset)
    ? (src.preset as FollowUpPreset)
    : 'standard';
  if (preset !== 'custom') {
    return { enabled, preset, ...FOLLOWUP_PRESETS[preset] };
  }
  return { enabled, preset: 'custom', ...normalizeCustomCadence(src) };
}

/**
 * Sanitize an incoming follow-up-config patch (from the dashboard PUT) into a
 * full, normalized FollowUpConfig, or undefined when there is nothing valid to
 * write. Mirrors sanitizeBookingPatch: the dashboard sends the WHOLE followUp
 * object on every save, and the server merges it under the `followUp` key so
 * sibling featuresJson keys are never dropped. Non-custom presets take their
 * cadence from the preset table; custom is clamped + order-enforced.
 */
export function sanitizeFollowUpPatch(input: unknown): FollowUpConfig | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const src = input as Record<string, unknown>;
  const RELEVANT = ['enabled', 'preset', 'day1', 'day2', 'day3', 'discountPct'];
  if (!RELEVANT.some((k) => k in src)) return undefined;
  const enabled = src.enabled === true;
  const preset = FOLLOWUP_PRESET_KEYS.includes(src.preset as FollowUpPreset)
    ? (src.preset as FollowUpPreset)
    : 'standard';
  if (preset !== 'custom') {
    return { enabled, preset, ...FOLLOWUP_PRESETS[preset] };
  }
  return { enabled, preset: 'custom', ...normalizeCustomCadence(src) };
}
