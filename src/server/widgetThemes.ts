/**
 * QuoteFleet widget theming — SINGLE SOURCE OF TRUTH.
 *
 * The customer-facing quote widget (`/w/:slug`) is fully skinned by the
 * tenant's brand config: a curated PRESET THEME, an optional custom ACCENT
 * override, and a self-hosted FONT choice. Wave 1 = this engine. A later
 * dashboard "Customize" panel just writes `theme_preset`, `accent_override`
 * and `font_family` onto `brand_configs`; nothing else needs to change.
 *
 * How it reaches the widget:
 *   - `/api/public/widget/:slug` calls {@link resolveWidgetTheme} and returns
 *     a `theme` object ({ preset, mode, font, fontStack, tokens }).
 *   - `widget.js#applyTheme` writes each `tokens` entry onto the document root
 *     as a CSS custom property and sets the body font-family.
 *   - `public-calculator-no-gradients.css` (the final !important layer) reads
 *     every one of these `--w-*` custom properties, with the Midnight values
 *     baked in as fallbacks — so if a token is ever missing the look is
 *     unchanged. Midnight emits values identical to those fallbacks, i.e. the
 *     current approved widget, pixel-for-pixel.
 *
 * NO teal anywhere. Every accent fill is dark enough to carry its label text
 * at AA-large; light presets flip text/input contrast via `mode`.
 */

// ── CSS custom-property contract ────────────────────────────────────
// The exact set of `--w-*` variables the widget CSS consumes. Keep in
// sync with public-calculator-no-gradients.css.
export interface WidgetThemeTokens {
  '--w-page-bg': string;
  '--w-surface': string;
  '--w-surface-2': string;
  '--w-surface-2-text': string;
  '--w-input-bg': string;
  '--w-input-bg-hover': string;
  '--w-input-text': string;
  '--w-input-border': string;
  '--w-text': string;
  '--w-muted': string;
  '--w-muted-2': string;
  '--w-contact-text': string;
  '--w-border': string;
  '--w-accent': string;
  /** Accent fill for TEXT-bearing accent surfaces (CTA, total box, active
   *  chip). Equals `--w-accent` for well-chosen accents; minimally hardened
   *  only when no foreground could otherwise clear WCAG on the raw accent. */
  '--w-accent-solid': string;
  '--w-accent-hover': string;
  '--w-accent-text': string;
  '--w-accent-surface': string;
  '--w-accent-surface-border': string;
  '--w-accent-on-surface': string;
  '--w-accent-pill-bg': string;
  '--w-accent-pill-border': string;
  // WCAG-computed foregrounds for background-dependent surfaces (contrast
  // engine guarantees these pass against their actual fill — see
  // src/server/color/contrast.ts).
  /** Text/number on the accent-filled "Estimated total" box. */
  '--w-total-text': string;
  /** Text on the accent pill / on-surface accent labels (vs the shell). */
  '--w-pill-text': string;
  '--w-error-bg': string;
  '--w-error-text': string;
  '--w-success-bg': string;
  '--w-success-text': string;
  // Mirrors of the two legacy variables widget-style.css still reads
  // directly (focus ring, suggestion hover, base button bg).
  '--w-primary': string;
  '--w-primary-hover': string;
  '--w-font': string;
}

type ThemeMode = 'dark' | 'light';

// Per-preset explicit palette. The handful of derived tokens (pill tint,
// surface-border, legacy mirrors, font) are filled by buildTokens().
interface PresetPalette {
  mode: ThemeMode;
  pageBg: string;
  surface: string;
  surface2: string;
  surface2Text: string;
  inputBg: string;
  inputBgHover: string;
  inputText: string;
  inputBorder: string;
  text: string;
  muted: string;
  muted2: string;
  contactText: string;
  border: string;
  accent: string;
  accentHover: string;
  accentText: string;
  accentSurface: string;
  accentOnSurface: string;
  errorBg: string;
  errorText: string;
  successBg: string;
  successText: string;
}

export interface WidgetPreset {
  id: string;
  label: string;
  description: string;
  mode: ThemeMode;
  palette: PresetPalette;
}

// ── colour maths — delegated to the WCAG contrast engine ────────────
// One source of truth for luminance / ratio / readable-foreground picking
// so the widget, the customize preview and the tests all agree. See
// src/server/color/contrast.ts.
import {
  WCAG,
  mix,
  darken,
  lighten,
  rgba,
  pickForeground,
  ensureReadable,
  accessibleOnAccent,
  passes,
} from './color/contrast.js';

const HEX6_RE = /^#[0-9a-fA-F]{6}$/;

// ── Fonts (self-hosted, no CDN at runtime) ──────────────────────────
export interface WidgetFont {
  id: string;
  label: string;
  /** CSS font-family stack. */
  stack: string;
  /** true when we ship @font-face binaries for it (vs. a pure system stack). */
  selfHosted: boolean;
}

const SYSTEM_FALLBACK = "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

export const WIDGET_FONTS: Record<string, WidgetFont> = {
  satoshi: {
    id: 'satoshi',
    label: 'Satoshi',
    stack: `'Satoshi', 'Inter', ${SYSTEM_FALLBACK}`,
    selfHosted: true,
  },
  inter: {
    id: 'inter',
    label: 'Inter',
    stack: `'Inter', ${SYSTEM_FALLBACK}`,
    selfHosted: true,
  },
  sora: {
    id: 'sora',
    label: 'Sora',
    stack: `'Sora', 'Inter', ${SYSTEM_FALLBACK}`,
    selfHosted: true,
  },
  system: {
    id: 'system',
    label: 'System',
    stack: `'Inter', ${SYSTEM_FALLBACK}`,
    selfHosted: false,
  },
};

export const DEFAULT_FONT_ID = 'satoshi';
export const DEFAULT_PRESET_ID = 'midnight';

// ── The curated preset set (6) ──────────────────────────────────────
const PRESETS_RAW: WidgetPreset[] = [
  {
    id: 'midnight',
    label: 'Midnight',
    description: 'The QuoteFleet default — charcoal shell, cream inputs, cobalt accent.',
    mode: 'dark',
    palette: {
      mode: 'dark',
      pageBg: '#161616',
      surface: '#181D1F',
      surface2: '#1C1C1C',
      surface2Text: '#E6E3E0',
      inputBg: '#E6E3E0',
      inputBgHover: '#D4CFC9',
      inputText: '#1E1E1E',
      inputBorder: 'rgba(13,60,252,.22)',
      text: '#FFFFFF',
      muted: '#B1C5CE',
      muted2: '#9FB2BB',
      contactText: '#C9D4DA',
      border: 'rgba(255,255,255,.12)',
      accent: '#0D3CFC',
      accentHover: '#0B32D4',
      accentText: '#FFFFFF',
      accentSurface: '#FFFFFF',
      accentOnSurface: '#6E8BFF',
      errorBg: '#F3EDDF',
      errorText: '#1E1E1E',
      successBg: '#E4EDF1',
      successText: '#1E1E1E',
    },
  },
  {
    id: 'slate',
    label: 'Slate',
    description: 'Cool blue-grey shell with a periwinkle accent.',
    mode: 'dark',
    palette: {
      mode: 'dark',
      pageBg: '#14181F',
      surface: '#1B212B',
      surface2: '#212936',
      surface2Text: '#E4E8F0',
      inputBg: '#E7EAF0',
      inputBgHover: '#D6DBE6',
      inputText: '#1B2130',
      inputBorder: 'rgba(110,139,255,.28)',
      text: '#FFFFFF',
      muted: '#AEB8CA',
      muted2: '#9AA6BC',
      contactText: '#C2CBDC',
      border: 'rgba(255,255,255,.12)',
      accent: '#4F6BF0',
      accentHover: '#3F58DC',
      accentText: '#FFFFFF',
      accentSurface: '#EEF1FB',
      accentOnSurface: '#8DA2FF',
      errorBg: '#F1E7E7',
      errorText: '#1E1E1E',
      successBg: '#E4EDF1',
      successText: '#1E1E1E',
    },
  },
  {
    id: 'carbon',
    label: 'Carbon',
    description: 'Neutral near-black with a crisp white/blue accent.',
    mode: 'dark',
    palette: {
      mode: 'dark',
      pageBg: '#0E0E0E',
      surface: '#161616',
      surface2: '#1E1E1E',
      surface2Text: '#EAEAEA',
      inputBg: '#F2F2F0',
      inputBgHover: '#E2E2DF',
      inputText: '#141414',
      inputBorder: 'rgba(37,99,235,.24)',
      text: '#FFFFFF',
      muted: '#B4B4B4',
      muted2: '#9C9C9C',
      contactText: '#C6C6C6',
      border: 'rgba(255,255,255,.12)',
      accent: '#2563EB',
      accentHover: '#1D4FD0',
      accentText: '#FFFFFF',
      accentSurface: '#FFFFFF',
      accentOnSurface: '#7AA2FF',
      errorBg: '#F0E7E7',
      errorText: '#141414',
      successBg: '#E7EDE9',
      successText: '#141414',
    },
  },
  {
    id: 'ocean',
    label: 'Ocean',
    description: 'Deep navy shell with a bright azure accent.',
    mode: 'dark',
    palette: {
      mode: 'dark',
      pageBg: '#0B1220',
      surface: '#111A2E',
      surface2: '#16223C',
      surface2Text: '#E4EAF4',
      inputBg: '#E9EEF6',
      inputBgHover: '#D7DFED',
      inputText: '#0F1B30',
      inputBorder: 'rgba(37,99,235,.28)',
      text: '#FFFFFF',
      muted: '#A7B4CC',
      muted2: '#93A2BF',
      contactText: '#BCC8DE',
      border: 'rgba(255,255,255,.14)',
      accent: '#2563EB',
      accentHover: '#1E52D0',
      accentText: '#FFFFFF',
      accentSurface: '#EAF0FC',
      accentOnSurface: '#6E9BFF',
      errorBg: '#EFE6E4',
      errorText: '#0F1B30',
      successBg: '#E3ECF2',
      successText: '#0F1B30',
    },
  },
  {
    id: 'emerald',
    label: 'Emerald',
    description: 'Dark shell with a rich emerald-green accent.',
    mode: 'dark',
    palette: {
      mode: 'dark',
      pageBg: '#0E1512',
      surface: '#14201B',
      surface2: '#1A2A22',
      surface2Text: '#E4EDE7',
      inputBg: '#E8EDE9',
      inputBgHover: '#D6DED9',
      inputText: '#14231C',
      inputBorder: 'rgba(5,150,105,.30)',
      text: '#FFFFFF',
      muted: '#A9BCB2',
      muted2: '#95A99F',
      contactText: '#BECDC4',
      border: 'rgba(255,255,255,.12)',
      accent: '#059669',
      accentHover: '#047857',
      accentText: '#FFFFFF',
      accentSurface: '#E6F5EF',
      accentOnSurface: '#34D399',
      errorBg: '#EDE7E2',
      errorText: '#14231C',
      successBg: '#E1EFE7',
      successText: '#14231C',
    },
  },
  {
    id: 'cream',
    label: 'Cream',
    description: 'Warm light theme — ivory surfaces, ink text, cobalt accent.',
    mode: 'light',
    palette: {
      mode: 'light',
      pageBg: '#F3EEE4',
      surface: '#FBF8F1',
      surface2: '#F1EADD',
      surface2Text: '#241F16',
      inputBg: '#FFFFFF',
      inputBgHover: '#F5F1E8',
      inputText: '#241F16',
      inputBorder: 'rgba(13,60,252,.24)',
      text: '#241F16',
      muted: '#6B6152',
      muted2: '#7A7062',
      contactText: '#5C5346',
      border: 'rgba(20,16,10,.14)',
      accent: '#0D3CFC',
      accentHover: '#0B32D4',
      accentText: '#FFFFFF',
      accentSurface: '#E7ECFF',
      accentOnSurface: '#0D3CFC',
      errorBg: '#F6E4DD',
      errorText: '#5A1E14',
      successBg: '#E3EFE7',
      successText: '#1E3A26',
    },
  },
];

export const WIDGET_PRESETS: Record<string, WidgetPreset> = Object.fromEntries(
  PRESETS_RAW.map((p) => [p.id, p]),
);

export const WIDGET_PRESET_LIST: WidgetPreset[] = PRESETS_RAW;

// ── CTA hover-effect options ────────────────────────────────────────
// Per-tenant hover treatment for the primary CTA. Default `border` = the
// long-standing clean border-wrap on hover; the rest are subtle premium
// alternatives. All are accent-aware (they reuse the contrast-computed
// --w-* tokens) and keep an accessible focus ring regardless.
export const CTA_HOVER_STYLES = ['border', 'lift', 'glow', 'fill', 'none'] as const;
export type CtaHover = (typeof CTA_HOVER_STYLES)[number];
export const DEFAULT_CTA_HOVER: CtaHover = 'border';

function normalizeCtaHover(v: string | null | undefined): CtaHover {
  return (CTA_HOVER_STYLES as readonly string[]).includes(v ?? '')
    ? (v as CtaHover)
    : DEFAULT_CTA_HOVER;
}

// ── Token assembly ──────────────────────────────────────────────────
// `fontColor` is an optional tenant text-colour override (a #RRGGBB hex, or
// null for "Auto"). It is applied ONLY on surfaces where it still clears the
// WCAG bar; any surface it would fail on (e.g. the accent-filled total box)
// falls back to the contrast-engine's auto colour — so nothing ever renders
// below threshold.
function buildTokens(
  p: PresetPalette,
  fontStack: string,
  fontColor: string | null,
): WidgetThemeTokens {
  const accentSurfaceBorder =
    p.mode === 'light' ? 'rgba(20,16,10,.14)' : p.accentSurface;

  // Accent-filled TEXT surfaces (CTA, total box, active chip): a guaranteed
  // readable {fill, text} pair. `solid` is the accent, hardened only if no
  // pure foreground could clear 4.5:1 on the raw accent (rare borderline hues).
  const onAccent = accessibleOnAccent(p.accent, WCAG.NORMAL);
  const autoAccentText = onAccent.text;
  const autoTotalText = onAccent.text;
  // Pill / on-surface accent labels render over the shell surface.
  const autoPillText = ensureReadable(p.accentOnSurface, p.surface, { level: WCAG.NORMAL });

  const fc = fontColor && HEX6_RE.test(fontColor) ? fontColor : null;
  const text = fc && passes(fc, p.surface, WCAG.NORMAL) ? fc : p.text;
  // A tenant font colour is only honoured on the accent fill if IT passes on
  // the (hardened) solid fill — else the engine's auto colour wins there.
  const accentText = fc && passes(fc, onAccent.bg, WCAG.NORMAL) ? fc : autoAccentText;
  const totalText = fc && passes(fc, onAccent.bg, WCAG.NORMAL) ? fc : autoTotalText;
  const pillText = fc && passes(fc, p.surface, WCAG.NORMAL) ? fc : autoPillText;

  return {
    '--w-page-bg': p.pageBg,
    '--w-surface': p.surface,
    '--w-surface-2': p.surface2,
    '--w-surface-2-text': p.surface2Text,
    '--w-input-bg': p.inputBg,
    '--w-input-bg-hover': p.inputBgHover,
    '--w-input-text': p.inputText,
    '--w-input-border': p.inputBorder,
    '--w-text': text,
    '--w-muted': p.muted,
    '--w-muted-2': p.muted2,
    '--w-contact-text': p.contactText,
    '--w-border': p.border,
    '--w-accent': p.accent,
    '--w-accent-solid': onAccent.bg,
    '--w-accent-hover': p.accentHover,
    '--w-accent-text': accentText,
    '--w-accent-surface': p.accentSurface,
    '--w-accent-surface-border': accentSurfaceBorder,
    '--w-accent-on-surface': p.accentOnSurface,
    '--w-accent-pill-bg': rgba(p.accentOnSurface, 0.1),
    '--w-accent-pill-border': rgba(p.accentOnSurface, 0.34),
    '--w-total-text': totalText,
    '--w-pill-text': pillText,
    '--w-error-bg': p.errorBg,
    '--w-error-text': p.errorText,
    '--w-success-bg': p.successBg,
    '--w-success-text': p.successText,
    '--w-primary': p.accent,
    '--w-primary-hover': p.accentHover,
    '--w-font': fontStack,
  };
}

/**
 * Apply a custom accent hex over a palette. Supersedes the preset accent
 * (fill, hover, text-on-accent, tint surfaces, on-surface variant, pill).
 * All other tokens (bg / inputs / text / borders) are untouched.
 *
 * text-on-accent + on-surface are now computed by the WCAG engine so ANY
 * accent — yellow, cream, red, navy — carries readable labels automatically.
 */
function applyAccentOverride(p: PresetPalette, hex: string): PresetPalette {
  const accent = hex;
  const accentHover = darken(accent, 0.14);
  const accentText = pickForeground(accent, { level: WCAG.NORMAL });
  // On-surface accent variant: keep the preset's direction (darker in light
  // themes, lighter in dark themes) then guarantee it reads on the shell.
  const baseOnSurface = p.mode === 'light' ? accent : lighten(accent, 0.32);
  const onSurface = ensureReadable(baseOnSurface, p.surface, { level: WCAG.NORMAL });
  const accentSurface = p.mode === 'light' ? mix(accent, 0.86) : '#FFFFFF';
  return {
    ...p,
    accent,
    accentHover,
    accentText,
    accentOnSurface: onSurface,
    accentSurface,
    inputBorder: rgba(accent, 0.24),
  };
}

export interface ResolvedWidgetTheme {
  preset: string;
  mode: ThemeMode;
  font: string;
  fontStack: string;
  accentOverride: string | null;
  /** Applied tenant text-colour: 'auto' (engine-picked) or a #RRGGBB hex. */
  fontColor: string;
  /** Per-tenant CTA hover effect. */
  ctaHover: CtaHover;
  tokens: WidgetThemeTokens;
}

/** Brand-config shape this resolver needs (a subset of `brand_configs`). */
export interface BrandThemeInput {
  themePreset?: string | null;
  accentOverride?: string | null;
  fontFamily?: string | null;
  /** Optional tenant text-colour override ('auto' or a #RRGGBB hex). */
  fontColor?: string | null;
  /** Per-tenant CTA hover effect (border | lift | glow | fill | none). */
  ctaHover?: string | null;
  /** Legacy column — used only as an accent override when set to a real
   *  non-default value and no explicit accentOverride is present. */
  primaryColor?: string | null;
}

const HEX_RE = /^#?[0-9a-f]{6}$/i;
function normalizeHex(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.trim();
  if (!HEX_RE.test(s)) return null;
  return s.startsWith('#') ? s : '#' + s;
}

/**
 * Resolve a tenant's brand config into a fully-applied widget theme.
 * Safe against nulls / unknown ids: falls back to Midnight + Satoshi.
 */
export function resolveWidgetTheme(brand: BrandThemeInput | null | undefined): ResolvedWidgetTheme {
  const presetId = brand?.themePreset && WIDGET_PRESETS[brand.themePreset] ? brand.themePreset : DEFAULT_PRESET_ID;
  const preset = WIDGET_PRESETS[presetId];
  const fontId = brand?.fontFamily && WIDGET_FONTS[brand.fontFamily] ? brand.fontFamily : DEFAULT_FONT_ID;
  const font = WIDGET_FONTS[fontId];

  const accentOverride = normalizeHex(brand?.accentOverride);
  let palette = preset.palette;
  if (accentOverride) palette = applyAccentOverride(palette, accentOverride);

  // Tenant font-colour override: 'auto'/null → engine picks per surface.
  const fontColor =
    brand?.fontColor && brand.fontColor !== 'auto' ? normalizeHex(brand.fontColor) : null;
  const ctaHover = normalizeCtaHover(brand?.ctaHover);

  return {
    preset: presetId,
    mode: preset.mode,
    font: fontId,
    fontStack: font.stack,
    accentOverride,
    fontColor: fontColor ?? 'auto',
    ctaHover,
    tokens: buildTokens(palette, font.stack, fontColor),
  };
}

/**
 * The curated font-colour swatches the customize panel MAY offer, filtered at
 * runtime to those that clear WCAG against the currently-selected background
 * (and, where relevant, the accent fill). Exposed so the panel + server agree
 * on the option universe. 'auto' is always available and is the default.
 */
export const FONT_COLOR_SWATCHES: Array<{ id: string; label: string; hex: string }> = [
  { id: 'white', label: 'White', hex: '#FFFFFF' },
  { id: 'charcoal', label: 'Charcoal', hex: '#141414' },
  { id: 'ink', label: 'Ink', hex: '#1E1E1E' },
  { id: 'light-gray', label: 'Light gray', hex: '#E6E3E0' },
  { id: 'slate', label: 'Slate', hex: '#334155' },
  { id: 'cream', label: 'Cream', hex: '#F5F1E8' },
];

/**
 * Given a background (and optional accent fill), return the subset of curated
 * font colours that pass WCAG AA on ALL supplied surfaces — i.e. the colours
 * the panel is allowed to show for that background. Deterministic; mirrors the
 * client-side filter used for instant feedback.
 */
export function safeFontColors(
  surfaces: string[],
  level: number = WCAG.NORMAL,
): Array<{ id: string; label: string; hex: string }> {
  const real = surfaces.filter((s) => HEX6_RE.test(s));
  return FONT_COLOR_SWATCHES.filter((sw) => real.every((bg) => passes(sw.hex, bg, level)));
}
