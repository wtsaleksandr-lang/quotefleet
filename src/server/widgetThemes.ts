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
  // ── STRUCTURAL tokens (Wave 4) ────────────────────────────────────
  // These carry the *design language* — corner radius, border weight,
  // elevation and label typography — so each preset can be a genuinely
  // different shell (sharp Uber ↔ soft Apple), not just a recolour. The
  // widget CSS reads each with the current Midnight value as its fallback,
  // so Midnight (and Cream) stay pixel-for-pixel identical.
  /** Card / shell corner radius (e.g. sharp 2px ↔ soft 18px). */
  '--w-radius-card': string;
  /** Input & select corner radius. */
  '--w-radius-input': string;
  /** CTA / button & total-box corner radius. */
  '--w-radius-btn': string;
  /** Chip / pill corner radius (999px = fully round, small = tab-like). */
  '--w-radius-pill': string;
  /** Card / panel border width (hairline 1px, or 0 for borderless). */
  '--w-border-width': string;
  /** Card elevation — flat `none`, soft-diffuse, or Material-elevated. */
  '--w-card-shadow': string;
  /** Field-label text-transform (`none` sentence-case ↔ `uppercase`). */
  '--w-label-transform': string;
  /** Field-label letter-spacing (tight sentence ↔ wide tracked caps). */
  '--w-label-spacing': string;
  /** Field-label font-weight. */
  '--w-label-weight': string;
  // ── STATEFUL-CONTROL tokens (Wave 5 — the "Uber" active/inactive pattern) ──
  // Drive how the calculator's stateful toggles (service tabs, unit toggles,
  // accessory chips, option flags) read in their ON vs OFF state. Defaults
  // reproduce the current look byte-for-byte, so every preset except mono is
  // unchanged; mono uses them to render Uber's signature "selected = thin black
  // border on white; unselected = soft grey tint, borderless" behaviour.
  /** Visible border colour for the ACTIVE tab / chip (default `transparent`). */
  '--w-active-border-color': string;
  /** Visible border width for the ACTIVE tab / chip (default `0`). */
  '--w-active-border-width': string;
  /** Fill for an INACTIVE tab / chip / flag (default = the input surface). */
  '--w-chip-inactive-bg': string;
  /** Border colour for an INACTIVE chip / flag (default = the input border). */
  '--w-chip-inactive-border': string;
  /** Fill for an ACTIVE accessory chip (default = the solid accent). */
  '--w-chip-active-bg': string;
  /** Text colour for an ACTIVE accessory chip (default = on-accent text). */
  '--w-chip-active-text': string;
  // ── FROSTED-GLASS tokens (Wave 6 — the Cupertino/Apple frosted shell) ──────
  // A translucent surface + backdrop-blur radius that only the cupertino-scoped
  // CSS reads. Always emitted so the token type stays total: a `frosted` preset
  // gets a semi-opaque surface + real blur; every other preset gets its OPAQUE
  // surface value + `0px` blur, so its shell renders byte-for-byte identical.
  /** Frosted shell fill — translucent for frosted presets, else the opaque surface. */
  '--w-surface-frost': string;
  /** Backdrop-blur radius for the frosted shell (`0px` = no blur / no frost). */
  '--w-frost-blur': string;
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
  /** Optional fill colour for accent-filled TEXT surfaces (CTA, total box,
   *  active chip) when it must differ from the identity `accent`. Lets a bright
   *  identity accent (e.g. Harley `#FC6600`, iOS `#007AFF`) stay bright for
   *  route/pins/on-surface labels while the FILLED buttons use a slightly
   *  deeper shade that carries WHITE text at WCAG AA. Omitted → fill = accent. */
  accentSolid?: string;
  accentHover: string;
  accentText: string;
  accentSurface: string;
  accentOnSurface: string;
  errorBg: string;
  errorText: string;
  successBg: string;
  successText: string;
}

// Per-preset STRUCTURAL signature — the non-colour half of the design
// language. Emitted as `--w-*` structural tokens by buildTokens(). Any preset
// may omit fields; DEFAULT_STRUCTURE (= today's Midnight values) fills the gaps
// so the default shell never moves.
interface PresetStructure {
  /** Card / shell radius. */ radiusCard: string;
  /** Input / select radius. */ radiusInput: string;
  /** Button / total-box radius. */ radiusBtn: string;
  /** Chip / pill radius. */ radiusPill: string;
  /** Card / panel border width. */ borderWidth: string;
  /** Card elevation / box-shadow. */ cardShadow: string;
  /** Field-label text-transform. */ labelTransform: string;
  /** Field-label letter-spacing. */ labelSpacing: string;
  /** Field-label font-weight. */ labelWeight: string;
  // ── Optional stateful-control overrides (Wave 5) ──────────────────────────
  // Omitted by every preset except mono; buildTokens fills the gaps with the
  // current-look defaults so all other presets stay pixel-for-pixel identical.
  /** ACTIVE tab/chip border colour. */ activeBorderColor?: string;
  /** ACTIVE tab/chip border width. */ activeBorderWidth?: string;
  /** INACTIVE tab/chip fill. */ chipInactiveBg?: string;
  /** INACTIVE chip/flag border colour. */ chipInactiveBorder?: string;
  /** ACTIVE chip fill. */ chipActiveBg?: string;
  /** ACTIVE chip text colour. */ chipActiveText?: string;
  // ── Optional frosted-glass shell (Wave 6) ─────────────────────────────────
  // Set only by cupertino (Apple). When true, buildTokens emits a translucent
  // `--w-surface-frost` + a real `--w-frost-blur` radius; every other preset
  // leaves it undefined → opaque surface + `0px` blur, so no other shell moves.
  /** Frosted-glass shell (translucent surface + backdrop blur). */ frosted?: boolean;
}

// The current approved widget's exact structural values. These MUST equal the
// CSS fallbacks in public-calculator-no-gradients.css / widget-style.css, so a
// preset that spreads DEFAULT_STRUCTURE renders the widget unchanged.
const DEFAULT_STRUCTURE: PresetStructure = {
  // Match the LIVE calculator exactly: shell 8px (no-gradients / maersk card),
  // inputs 6px (maersk control), buttons/chips 4px (maersk button), pills 999px,
  // 1px hairline, the approved deep shadow, and app-style's field labels
  // (weight 760, 0.01em, sentence-case).
  radiusCard: '8px',
  radiusInput: '6px',
  radiusBtn: '4px',
  radiusPill: '999px',
  borderWidth: '1px',
  cardShadow: '0 24px 60px -32px rgba(0,0,0,.75)',
  labelTransform: 'none',
  labelSpacing: '0.01em',
  labelWeight: '760',
};

export interface WidgetPreset {
  id: string;
  label: string;
  description: string;
  mode: ThemeMode;
  palette: PresetPalette;
  /** The design-language / structural signature. */
  structure: PresetStructure;
  /** Preset's default self-hosted font — used when the tenant hasn't picked
   *  one. Omitted → the global DEFAULT_FONT_ID. Lets a preset ship the type
   *  voice its design language needs (e.g. mono's clean geometric grotesque). */
  defaultFont?: string;
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
  roboto: {
    id: 'roboto',
    label: 'Roboto',
    // The Google / Android system font — the Material design-language voice.
    stack: `'Roboto', 'Inter', ${SYSTEM_FALLBACK}`,
    selfHosted: true,
  },
  dmsans: {
    id: 'dmsans',
    label: 'DM Sans',
    // The token-driven lime "Citron" voice — a friendly low-contrast geometric
    // grotesque. Inter falls back for legibility on a slow font-load.
    stack: `'DM Sans', 'Inter', ${SYSTEM_FALLBACK}`,
    selfHosted: true,
  },
  clashdisplay: {
    id: 'clashdisplay',
    label: 'Clash Display',
    // The bold cream fintech "Vault" display voice. Satoshi/Inter fall back for
    // legibility at body size.
    stack: `'Clash Display', 'Satoshi', 'Inter', ${SYSTEM_FALLBACK}`,
    selfHosted: true,
  },
  oswald: {
    id: 'oswald',
    label: 'Oswald',
    // Condensed bold — the Ironhorse / Harley moto voice. Condensed fallbacks
    // first so a slow font-load still reads narrow, then the self-hosted sans.
    stack: `'Oswald', 'Saira Condensed', 'Archivo Narrow', 'Satoshi', 'Inter', ${SYSTEM_FALLBACK}`,
    selfHosted: true,
  },
  system: {
    id: 'system',
    label: 'System',
    // The Apple/SF voice — SF Pro renders natively on Apple devices; Inter is
    // the cross-platform fallback (no binaries shipped, selfHosted stays false).
    // cupertino's defaultFont: 'system' gives it this SF stack.
    stack: `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', 'Inter', system-ui, sans-serif`,
    selfHosted: false,
  },
};

export const DEFAULT_FONT_ID = 'satoshi';
export const DEFAULT_PRESET_ID = 'midnight';

// ── The curated preset set (11 — a premium light + dark lineup) ─────
// Wave 4: each preset is now a DISTINCT DESIGN LANGUAGE, not a recolour. The
// `structure` block drives corner radius, border weight, elevation and label
// typography; the palette drives a premium, brand-evocative colour world.
// Together they make the calculators look like they came from different design
// teams (sharp mono Uber ↔ airy soft Apple ↔ elevated Google ↔ glassy Linear).
//
// Every accent was chosen so its guaranteed-readable label text is clean, not
// borderline; the WCAG engine still hardens anything that drifts. Brand
// inspiration lives in `description` only; the user-facing `label` is a neutral
// premium name (no trademarks). Midnight (default) + Cream keep their exact
// palettes AND spread DEFAULT_STRUCTURE, so they render pixel-for-pixel as
// before.
const PRESETS_RAW: WidgetPreset[] = [
  {
    id: 'midnight',
    label: 'Midnight',
    description: 'The QuoteFleet default — charcoal shell, cream inputs, cobalt accent.',
    mode: 'dark',
    // UNCHANGED — the approved default. Standard 8px shell, hairline border,
    // restrained deep shadow, sentence-case labels.
    structure: { ...DEFAULT_STRUCTURE },
    palette: {
      mode: 'dark',
      // Effortel-family premium charcoal (cool green-grey undertone) with clear
      // depth between the shell layers — richer than a flat near-black.
      pageBg: '#13181A',
      surface: '#1E2528',
      surface2: '#262E31',
      surface2Text: '#E6E3E0',
      inputBg: '#E6E3E0',
      inputBgHover: '#D4CFC9',
      inputText: '#1E1E1E',
      inputBorder: 'rgba(13,60,252,.22)',
      text: '#FFFFFF',
      muted: '#B1C5CE',
      muted2: '#9FB2BB',
      contactText: '#C9D4DA',
      border: 'rgba(255,255,255,.10)',
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
    id: 'mono',
    label: 'Clarity',
    description: 'Inspired by Uber — premium WHITE surfaces, high-contrast black text and a solid black CTA. Selected controls take a thin black border on white; unselected controls are borderless with a soft grey tint. Moderate radius, clean geometric grotesque type.',
    mode: 'light',
    // The Uber design language: white shell, black ink, moderate radius, a
    // barely-there elevation and clean sentence-case labels. The active/inactive
    // control pattern lives in the stateful-control tokens below.
    structure: {
      radiusCard: '16px',
      radiusInput: '10px',
      radiusBtn: '12px',
      radiusPill: '10px',
      borderWidth: '1px',
      cardShadow: '0 1px 2px rgba(0,0,0,.05), 0 14px 34px -20px rgba(0,0,0,.16)',
      labelTransform: 'none',
      labelSpacing: 'normal',
      labelWeight: '600',
      // Uber pattern: ON = white fill + a BOLD black border; OFF = grey tint,
      // borderless. These override the current-look defaults for mono only.
      // 2.5px matches the heavy selected outline in the Uber reference.
      activeBorderColor: '#111111',
      activeBorderWidth: '2.5px',
      chipInactiveBg: '#F6F6F6',
      chipInactiveBorder: 'transparent',
      chipActiveBg: '#FFFFFF',
      chipActiveText: '#111111',
    },
    // Satoshi — the closest self-hosted match to Uber Move (a clean geometric
    // grotesque with a tall x-height). Reads the most Uber-like of the three.
    defaultFont: 'satoshi',
    palette: {
      mode: 'light',
      // Premium white — the whole shell is white, not grey; surface-2 is the
      // soft #F6F6F6 tint used for inactive controls and quiet sub-panels.
      pageBg: '#FFFFFF',
      surface: '#FFFFFF',
      surface2: '#F6F6F6',
      surface2Text: '#111111',
      inputBg: '#FFFFFF',
      inputBgHover: '#F6F6F6',
      inputText: '#111111',
      inputBorder: '#E4E4E4',
      text: '#111111',
      muted: '#6B6B6B',
      muted2: '#8A8A8A',
      contactText: '#4A4A4A',
      border: '#EAEAEA',
      // Solid BLACK accent: CTA / total box render black with white label text
      // (engine-picked) — Uber's signature high-contrast button. On-surface
      // accent is also black so pill/label accents read as clean ink on white.
      accent: '#111111',
      accentHover: '#000000',
      accentText: '#FFFFFF',
      accentSurface: '#FFFFFF',
      accentOnSurface: '#111111',
      errorBg: '#FBE9E7',
      errorText: '#7A1712',
      successBg: '#E8F3EC',
      successText: '#14532D',
    },
  },
  {
    id: 'ironhorse',
    label: 'Ironhorse',
    description:
      'Inspired by Harley-Davidson — bold orange-on-black moto identity: heavy uppercase condensed labels, black active borders on white, sharp small radius.',
    mode: 'light',
    // Moto identity: white shell, near-black ink, sharp small corners, heavy
    // tracked uppercase labels, a BLACK active border on the orange-accented
    // controls. Ships Oswald (condensed) as its type voice.
    structure: {
      radiusCard: '10px',
      radiusInput: '8px',
      radiusBtn: '6px',
      radiusPill: '999px',
      borderWidth: '1.5px',
      cardShadow: '0 1px 2px rgba(17,17,17,.05), 0 16px 40px -24px rgba(17,17,17,.22)',
      labelTransform: 'uppercase',
      labelSpacing: '0.08em',
      labelWeight: '800',
      activeBorderColor: '#111111',
      activeBorderWidth: '2px',
      chipInactiveBg: '#F4F4F5',
      chipInactiveBorder: 'transparent',
      chipActiveBg: '#FC6600',
      chipActiveText: '#111111',
    },
    defaultFont: 'oswald',
    palette: {
      mode: 'light',
      pageBg: '#F3F3F4',
      surface: '#FFFFFF',
      surface2: '#F4F4F5',
      surface2Text: '#111111',
      inputBg: '#FFFFFF',
      inputBgHover: '#F5F5F5',
      inputText: '#111111',
      inputBorder: 'rgba(17,17,17,.18)',
      text: '#0F0F0F',
      muted: '#5A5A5A',
      muted2: '#767676',
      contactText: '#3A3A3A',
      border: 'rgba(17,17,17,.16)',
      accent: '#FC6600',
      accentHover: '#E25B00',
      accentText: '#111111',
      accentSurface: '#FFEAD9',
      accentOnSurface: '#C2410C',
      errorBg: '#FBE4E0',
      errorText: '#7A1712',
      successBg: '#E7F3EA',
      successText: '#14532D',
    },
  },
  {
    id: 'harbor',
    label: 'Harbor',
    description:
      'Inspired by premium ride-share apps — deep petrol-teal accent, soft large radius, sentence-case labels, white pill tabs that fill teal when active.',
    mode: 'light',
    // Ride-app polish: white shell, deep petrol-teal accent, soft large radius,
    // relaxed sentence-case labels. Stateful pattern: ACTIVE tab = filled teal
    // pill (white text, no border); INACTIVE tab = white pill + light hairline.
    structure: {
      radiusCard: '18px',
      radiusInput: '12px',
      radiusBtn: '12px',
      radiusPill: '999px',
      borderWidth: '1px',
      cardShadow: '0 1px 2px rgba(9,42,53,.05), 0 18px 44px -20px rgba(9,42,53,.22)',
      labelTransform: 'none',
      labelSpacing: 'normal',
      labelWeight: '600',
      activeBorderColor: 'transparent',
      activeBorderWidth: '0',
      chipInactiveBg: '#FFFFFF',
      chipInactiveBorder: 'rgba(15,42,51,.16)',
      chipActiveBg: '#0C566B',
      chipActiveText: '#FFFFFF',
    },
    defaultFont: 'inter',
    palette: {
      mode: 'light',
      pageBg: '#EAEEF3',
      surface: '#FFFFFF',
      surface2: '#F1F5F8',
      surface2Text: '#0F2A33',
      inputBg: '#FFFFFF',
      inputBgHover: '#F1F5F8',
      inputText: '#0F2A33',
      inputBorder: 'rgba(12,86,107,.24)',
      text: '#0F2A33',
      muted: '#5A6B73',
      muted2: '#79878E',
      contactText: '#3E4E55',
      border: 'rgba(15,42,51,.12)',
      accent: '#0C566B',
      accentHover: '#083F50',
      accentText: '#FFFFFF',
      accentSurface: '#E5F0F3',
      accentOnSurface: '#0C566B',
      errorBg: '#FCEAE7',
      errorText: '#7A1A12',
      successBg: '#E3F1E9',
      successText: '#14532D',
    },
  },
  {
    id: 'cupertino',
    label: 'Cupertino',
    description: 'Inspired by Apple / iOS — airy FROSTED-glass shell over a soft grey page, generous whitespace, LARGE soft radius, hairline borders, translucent panels with a backdrop blur, sentence-case labels, system-blue accent, SF type voice.',
    mode: 'light',
    // The softest, airiest shell — now a genuine Apple FROSTED-GLASS card:
    // large 20px corners, a gentle two-layer diffuse shadow, relaxed
    // sentence-case labels at Apple's 590 weight, and the frosted flag that
    // turns the shell + inner panels + map badges translucent (cupertino-scoped
    // CSS reads --w-surface-frost / --w-frost-blur). Minimal and premium.
    structure: {
      radiusCard: '20px',
      radiusInput: '12px',
      radiusBtn: '12px',
      radiusPill: '999px',
      borderWidth: '1px',
      cardShadow: '0 8px 30px -8px rgba(60,60,67,.16), 0 2px 8px -3px rgba(60,60,67,.12)',
      labelTransform: 'none',
      labelSpacing: 'normal',
      labelWeight: '590',
      frosted: true,
    },
    // SF voice — the `system` font stack now points at SF Pro (native on Apple
    // devices) with Inter as the cross-platform fallback.
    defaultFont: 'system',
    palette: {
      mode: 'light',
      // Soft cool-grey page so the translucent white card reads as frosted glass
      // lifted off it; pristine white surface, iOS grouped-list secondary.
      pageBg: '#EDEDF2',
      surface: '#FFFFFF',
      surface2: '#F2F2F7',
      surface2Text: '#1C1C1E',
      inputBg: '#FFFFFF',
      inputBgHover: '#F2F2F7',
      inputText: '#1C1C1E',
      inputBorder: 'rgba(60,60,67,0.18)',
      text: '#1C1C1E',
      muted: '#6E6E73',
      muted2: '#8E8E93',
      contactText: '#48484A',
      border: 'rgba(60,60,67,0.12)',
      // System-blue #007AFF as the DISPLAY accent (on-surface labels/icons).
      // The FILLED CTA + total box use the slightly deeper #0069E0 so Apple's
      // iconic WHITE-on-blue text clears WCAG AA (white-on-#0069E0 ≈ 4.9:1;
      // #007AFF alone would keep dark text at 4.59:1).
      accent: '#007AFF',
      accentSolid: '#0069E0',
      accentHover: '#0056BD',
      accentText: '#FFFFFF',
      accentSurface: '#E9F1FF',
      accentOnSurface: '#0069E0',
      errorBg: '#FCE7E5',
      errorText: '#7A1512',
      successBg: '#E4F7EA',
      successText: '#248A3D',
    },
  },
  {
    id: 'material',
    label: 'Material',
    description: 'Inspired by Google / Android — tonal light surfaces, ELEVATED cards with a visible Material shadow, larger radius, Roboto Medium labels, Material-3 segmented service tabs, Google-blue accent.',
    mode: 'light',
    // The one card that clearly floats — a two-layer Material elevation. M3
    // refinement: 16px corners, Roboto Medium (500) sentence-case labels at
    // 0.01em tracking. The segmented tabs / blue focus / tonal surfaces / green
    // ETA live in the material-scoped block of public-calculator-no-gradients.css.
    structure: {
      radiusCard: '16px',
      radiusInput: '8px',
      radiusBtn: '8px',
      radiusPill: '999px',
      borderWidth: '1px',
      cardShadow: '0 1px 3px rgba(60,64,67,.30), 0 8px 24px -6px rgba(60,64,67,.24)',
      labelTransform: 'none',
      labelSpacing: '0.01em',
      labelWeight: '500',
    },
    // Roboto — the Google/Android system font, the Material type voice.
    defaultFont: 'roboto',
    palette: {
      mode: 'light',
      pageBg: '#F1F3F4',
      surface: '#FFFFFF',
      surface2: '#F1F3F4',
      surface2Text: '#202124',
      inputBg: '#FFFFFF',
      inputBgHover: '#F1F3F4',
      inputText: '#202124',
      inputBorder: 'rgba(26,115,232,.24)',
      text: '#202124',
      muted: '#5F6368',
      muted2: '#80868B',
      contactText: '#3C4043',
      border: 'rgba(60,64,67,.16)',
      accent: '#1A73E8',
      accentHover: '#1667D6',
      accentText: '#FFFFFF',
      accentSurface: '#E8F0FE',
      accentOnSurface: '#1A73E8',
      errorBg: '#FCE8E6',
      errorText: '#7A1A12',
      successBg: '#E6F4EA',
      successText: '#137333',
    },
  },
  {
    id: 'booking',
    label: 'Voyage',
    description:
      'Inspired by Booking.com — an all-blue tonal DARK shell: deep-blue card over a darker blue page, borderless resting controls that take a 2px WHITE border when active, white text, a bright action-blue accent.',
    mode: 'dark',
    // The Booking signature: a borderless resting shell (borderWidth 0) whose
    // ACTIVE tab / chip is carried by a 2px white border on a tonal-blue fill —
    // not a colour swap. Medium 16px card, soft deep drop shadow, semibold
    // sentence-case labels. The active-tab label + white focus ring + contact
    // link colour live in the booking-scoped block of no-gradients.css.
    structure: {
      radiusCard: '16px',
      radiusInput: '12px',
      radiusBtn: '12px',
      radiusPill: '10px',
      borderWidth: '0',
      cardShadow: '0 24px 60px -30px rgba(0,10,40,.55)',
      labelTransform: 'none',
      labelSpacing: '0.01em',
      labelWeight: '600',
      activeBorderColor: '#FFFFFF',
      activeBorderWidth: '2px',
      chipInactiveBg: '#0D459A',
      chipInactiveBorder: 'transparent',
      chipActiveBg: '#12509F',
      chipActiveText: '#FFFFFF',
    },
    defaultFont: 'inter',
    palette: {
      mode: 'dark',
      pageBg: '#002E77',
      surface: '#003B95',
      surface2: '#0D459A',
      surface2Text: '#FFFFFF',
      inputBg: '#00337F',
      inputBgHover: '#0A3F8C',
      inputText: '#FFFFFF',
      inputBorder: 'rgba(255,255,255,.16)',
      text: '#FFFFFF',
      muted: 'rgba(255,255,255,.72)',
      muted2: 'rgba(255,255,255,.58)',
      contactText: 'rgba(255,255,255,.80)',
      border: 'rgba(255,255,255,.12)',
      accent: '#006CE4',
      accentHover: '#0059C2',
      accentText: '#FFFFFF',
      accentSurface: '#0D459A',
      accentOnSurface: '#9DBEF5',
      errorBg: '#FCE7E4',
      errorText: '#7A1512',
      successBg: '#E4F7EA',
      successText: '#177A3D',
    },
  },
  {
    id: 'tesla',
    label: 'Voltage',
    description:
      'Inspired by Tesla — an in-car-console DARK theme: near-black page, faintly-lifted graphite cards, DARK inputs with white text, thin tracked UPPERCASE micro-labels, and the Tesla-red accent used sparingly on the CTA / total / active chip.',
    mode: 'dark',
    // The Tesla instrument-cluster voice: near-flat elevation (hairline dividers
    // do the structural work), small-medium corners, thin tracked UPPERCASE
    // micro-labels. Active control = FILLED Tesla red (white text); inactive =
    // dark graphite tint + a faint hairline. Ships the geometric Sora voice.
    structure: {
      radiusCard: '10px',
      radiusInput: '8px',
      radiusBtn: '8px',
      radiusPill: '999px',
      borderWidth: '1px',
      cardShadow: '0 1px 2px rgba(0,0,0,.5)',
      labelTransform: 'uppercase',
      labelSpacing: '0.14em',
      labelWeight: '500',
      activeBorderColor: 'transparent',
      activeBorderWidth: '0',
      chipInactiveBg: '#1E1F21',
      chipInactiveBorder: 'rgba(255,255,255,.10)',
      chipActiveBg: '#C8151B',
      chipActiveText: '#FFFFFF',
    },
    defaultFont: 'sora',
    palette: {
      mode: 'dark',
      // The Tesla console void: near-black page, faintly-lifted graphite cards.
      pageBg: '#0A0A0B',
      surface: '#141516',
      surface2: '#1E1F21',
      surface2Text: '#F5F5F7',
      // DARK input fields with white text — the in-car console look (distinct
      // from graphite's LIGHT cream inputs).
      inputBg: '#1E1F21',
      inputBgHover: '#26282B',
      inputText: '#FFFFFF',
      inputBorder: 'rgba(255,255,255,.14)',
      text: '#FFFFFF',
      muted: '#A8AAAD',
      muted2: '#85878B',
      contactText: '#C7C9CC',
      border: 'rgba(255,255,255,.09)',
      // Tesla RED identity — pure #E82127 for route line, pins, on-surface accents.
      accent: '#E82127',
      // Deeper red so WHITE CTA/total/active-chip text clears WCAG AA (5.87:1).
      accentSolid: '#C8151B',
      accentHover: '#B81419',
      accentText: '#FFFFFF',
      accentSurface: '#FFFFFF',
      // Brightened red that reads on the dark surface (5.99:1) for on-surface labels.
      accentOnSurface: '#FF5A5F',
      errorBg: '#F2E4E4',
      errorText: '#5A1416',
      successBg: '#E3EEE8',
      successText: '#14432A',
    },
  },
  {
    id: 'stripe',
    label: 'Blurple',
    description:
      'Inspired by Stripe — a refined fintech LIGHT theme: a surface-gray page under a pure-white card, a soft layered slate-blue float shadow, a top aurora accent strip, and the signature indigo (blurple) accent with a gradient CTA.',
    mode: 'light',
    // Stripe polish: generously rounded card, the layered SOFT float with the
    // slate-blue (50,50,93) coloured shadow (three layers = the floating-card
    // tell), quiet sentence-case labels at Stripe's 560 weight. Segmented tabs:
    // ACTIVE = filled indigo pill (white text, no border); INACTIVE = surface-
    // gray tint + hairline. Ships Inter (closest free match to Söhne).
    structure: {
      radiusCard: '16px',
      radiusInput: '8px',
      radiusBtn: '10px',
      radiusPill: '999px',
      borderWidth: '1px',
      cardShadow:
        '0 7px 14px 0 rgba(50,50,93,.10), 0 3px 6px 0 rgba(0,0,0,.06), 0 18px 40px -12px rgba(50,50,93,.14)',
      labelTransform: 'none',
      labelSpacing: '0.01em',
      labelWeight: '560',
      activeBorderColor: 'transparent',
      activeBorderWidth: '0',
      chipInactiveBg: '#F6F9FC',
      chipInactiveBorder: 'rgba(10,37,64,.10)',
      chipActiveBg: '#5A52E0',
      chipActiveText: '#FFFFFF',
    },
    defaultFont: 'inter',
    palette: {
      mode: 'light',
      // Stripe's signature surface-gray page so the pure-white card floats on it.
      pageBg: '#F6F9FC',
      surface: '#FFFFFF',
      surface2: '#F6F9FC',
      surface2Text: '#0A2540',
      inputBg: '#FFFFFF',
      inputBgHover: '#F6F9FC',
      inputText: '#0A2540',
      // Stripe's neutral field border (#E3E8EE) — indigo only appears on focus.
      inputBorder: '#E3E8EE',
      // Stripe primary text = dark slate, never pure black.
      text: '#0A2540',
      muted: '#425466',
      muted2: '#697386',
      contactText: '#425466',
      border: 'rgba(10,37,64,.10)',
      // The blurple identity.
      accent: '#635BFF',
      // Deeper indigo for FILLED text surfaces so WHITE clears AA comfortably
      // (white-on-#635BFF ≈ 4.70:1 borderline; white-on-#5A52E0 ≈ 5.6:1).
      accentSolid: '#5A52E0',
      accentHover: '#5147E6',
      accentText: '#FFFFFF',
      accentSurface: '#EFEEFF',
      accentOnSurface: '#514BE0',
      errorBg: '#FCE9EC',
      errorText: '#7A1A2E',
      successBg: '#E3F5EC',
      successText: '#0E6245',
    },
  },
  {
    id: 'stone',
    label: 'Stone',
    description: 'Inspired by architectural blueprint / industrial concrete — a COOL slate-grey MONOCHROME drench: page, card, inputs and panels are all tonal shades of one cool blue-grey slate, sharp small corners, tight technical uppercase labels, and a single restrained cool-graphite accent on the CTA / total / active tab / route.',
    mode: 'light',
    // Cool / sharp / technical blueprint voice: sharp small radius, cool hairline
    // borders, a crisp cool-tinted shadow, tight technical UPPERCASE micro-labels.
    // The one distinctive active state = FILLED cool graphite (crisp white text);
    // INACTIVE = borderless cool-slate tint (Booking/Tesla-style intentional fill,
    // drenched in the theme's own cool family).
    structure: {
      radiusCard: '5px',
      radiusInput: '4px',
      radiusBtn: '4px',
      radiusPill: '4px',
      borderWidth: '1px',
      cardShadow: '0 1px 2px rgba(30,42,54,.10), 0 14px 32px -20px rgba(24,34,44,.34)',
      labelTransform: 'uppercase',
      labelSpacing: '0.06em',
      labelWeight: '600',
      activeBorderColor: 'transparent',
      activeBorderWidth: '0',
      chipInactiveBg: '#B4BBC2',
      chipInactiveBorder: 'transparent',
      chipActiveBg: '#21272D',
      chipActiveText: '#FFFFFF',
    },
    // Inter — the neutral Swiss grotesque: cool, precise, architectural. Reads as
    // blueprint/technical (vs Satoshi's warmth), matching the cool-slate drench.
    defaultFont: 'inter',
    palette: {
      mode: 'light',
      // COOL SLATE drench — every layer a tonal shade of ONE cool blue-grey slate.
      pageBg: '#A9B0B8',
      surface: '#BFC5CB',
      surface2: '#B4BBC2',
      surface2Text: '#1B2127',
      inputBg: '#CFD4D9',
      inputBgHover: '#C4CAD0',
      inputText: '#1A2026',
      inputBorder: 'rgba(38,52,66,.24)',
      text: '#191F25',
      muted: '#414A53',
      muted2: '#454E58',
      contactText: '#2F373F',
      border: 'rgba(30,42,54,.20)',
      // Cool graphite / gunmetal steel — the single restrained accent.
      accent: '#2B3138',
      // Deeper cool graphite so WHITE CTA/total/active-chip text clears WCAG AA.
      accentSolid: '#21272D',
      accentHover: '#161B20',
      accentText: '#FFFFFF',
      accentSurface: '#D3D8DD',
      accentOnSurface: '#2B3138',
      errorBg: '#E6DBDA',
      errorText: '#6C231B',
      successBg: '#DAE2DE',
      successText: '#25402F',
    },
  },
  {
    id: 'citron',
    label: 'Citron',
    description:
      'A crisp editorial LIGHT theme — white cards on an off-white page, near-black identity ink, and a signature LIME fill (token-driven) on the CTA, estimate-total and active controls. The lime lives in the accent-solid token, so a tenant accent override recolours every filled surface; the identity accent stays near-black for on-white labels. DM Sans type voice.',
    mode: 'light',
    // Editorial lime voice: soft 16px card, hairline border, quiet layered
    // shadow, sentence-case 600 labels. The lime is wired through accentSolid so
    // the CTA/total/active states are recolourable; chipActive* are intentionally
    // OMITTED so active chips inherit the lime now and a tenant override later.
    structure: {
      radiusCard: '16px',
      radiusInput: '12px',
      radiusBtn: '12px',
      radiusPill: '999px',
      borderWidth: '1px',
      cardShadow: '0 1px 2px rgba(41,41,40,.05), 0 16px 40px -24px rgba(41,41,40,.16)',
      labelTransform: 'none',
      labelSpacing: 'normal',
      labelWeight: '600',
      activeBorderColor: 'transparent',
      activeBorderWidth: '0',
      chipInactiveBg: '#FFFFFF',
      chipInactiveBorder: 'rgba(41,41,40,.16)',
      // chipActiveBg / chipActiveText intentionally omitted → inherit accent-solid
      // (lime now, tenant override later). Never hardcode the lime here.
    },
    defaultFont: 'dmsans',
    palette: {
      mode: 'light',
      pageBg: '#F8F8F8',
      surface: '#FFFFFF',
      surface2: '#F1F1F0',
      surface2Text: '#292928',
      inputBg: '#FFFFFF',
      inputBgHover: '#F5F5F4',
      inputText: '#292928',
      inputBorder: 'rgba(41,41,40,.18)',
      text: '#292928',
      muted: '#5C5C5A',
      muted2: '#6A6A68',
      contactText: '#3C3C3A',
      border: 'rgba(41,41,40,.12)',
      // Identity accent = near-black (on-white labels / eyebrow badge / links).
      accent: '#292928',
      // FILLED accent surfaces (CTA, total, active tab/chip/segment) = LIME.
      // accessibleOnAccent(#C3F832) → dark text automatically; cleared on a tenant
      // override so the CTA is editor-recolourable.
      accentSolid: '#C3F832',
      accentHover: '#B4E824',
      accentText: '#292928',
      accentSurface: '#EDEDEC',
      accentOnSurface: '#292928',
      errorBg: '#FBE9E7',
      errorText: '#7A1712',
      successBg: '#EAF6C9',
      successText: '#3B4A0A',
    },
  },
  {
    id: 'vault',
    label: 'Vault',
    description:
      'A bold cream fintech LIGHT theme — warm bone page under a lighter cream card, a diagonal grey HATCH texture (hero band + receipt panel + money box), vermillion identity accent with a deeper vermillion CTA fill, and prominent light-blue info surfaces. Clash Display display voice.',
    mode: 'light',
    // Cream fintech voice: soft 18px card, warm layered shadow, sentence-case 600
    // labels. ACTIVE tab/chip = FILLED deep-vermillion pill (white text, no
    // border); INACTIVE = warm cream pill + grey hairline. The hatch texture +
    // light-blue surfaces live in the vault-scoped block of no-gradients.css.
    structure: {
      radiusCard: '18px',
      radiusInput: '12px',
      radiusBtn: '14px',
      radiusPill: '999px',
      borderWidth: '1px',
      cardShadow: '0 1px 2px rgba(40,28,18,.05), 0 20px 48px -24px rgba(40,28,18,.26)',
      labelTransform: 'none',
      labelSpacing: 'normal',
      labelWeight: '600',
      activeBorderColor: 'transparent',
      activeBorderWidth: '0',
      chipInactiveBg: '#FBF8F2',
      chipInactiveBorder: 'rgba(119,119,129,.42)',
      chipActiveBg: '#CC3410',
      chipActiveText: '#FFFFFF',
    },
    defaultFont: 'clashdisplay',
    palette: {
      mode: 'light',
      pageBg: '#EAE4D9',
      surface: '#FBF8F2',
      surface2: '#F1EBDF',
      surface2Text: '#1A1714',
      inputBg: '#FFFDF9',
      inputBgHover: '#F6F1E8',
      inputText: '#1A1714',
      inputBorder: 'rgba(119,119,129,.44)',
      text: '#1A1714',
      muted: '#5B5B62',
      muted2: '#6C6C73',
      contactText: '#3A3A40',
      border: 'rgba(119,119,129,.42)',
      // Vermillion IDENTITY (route, pins, on-surface highlight).
      accent: '#F04E23',
      // Deeper vermillion so WHITE CTA/total text clears AA (~5.16:1).
      accentSolid: '#CC3410',
      accentHover: '#B02D0D',
      accentText: '#FFFFFF',
      accentSurface: '#FBE3DB',
      accentOnSurface: '#B8340F',
      errorBg: '#FBE4DE',
      errorText: '#7A1E12',
      successBg: '#E6EFE1',
      successText: '#2C4A1E',
    },
  },
  {
    id: 'cream',
    label: 'Cream',
    description: 'Soft light theme — effortel sage-tinted surfaces, ink text, cobalt accent.',
    mode: 'light',
    // UNCHANGED — the approved soft light shell. Spreads DEFAULT_STRUCTURE.
    structure: { ...DEFAULT_STRUCTURE },
    palette: {
      mode: 'light',
      // Effortel-family light: a soft sage-tinted shell + cool near-white
      // surfaces with cool ink/muted text — cleaner and more premium than the
      // old warm beige.
      pageBg: '#E7EDEA',
      surface: '#F6FAF8',
      surface2: '#ECF1EE',
      surface2Text: '#232A2C',
      inputBg: '#FFFFFF',
      inputBgHover: '#EFF3F1',
      inputText: '#232A2C',
      inputBorder: 'rgba(13,60,252,.24)',
      text: '#232A2C',
      muted: '#5F6F77',
      muted2: '#6E7C83',
      contactText: '#4E5A61',
      border: 'rgba(34,40,42,.12)',
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

// ── Map-blend toggle ────────────────────────────────────────────────
// Optional per-tenant flag that feathers the route-map's edges into the
// calculator surface (a theme-agnostic, token-driven effect). Off by default →
// existing tenants render the map exactly as before. Mirrors the ctaHover axis:
// resolved here, emitted on the theme payload, applied as a body attribute.
export const MAP_BLEND_VALUES = ['on', 'off'] as const;
export type MapBlend = (typeof MAP_BLEND_VALUES)[number];
export const DEFAULT_MAP_BLEND: MapBlend = 'off';

function normalizeMapBlend(v: string | null | undefined): MapBlend {
  return (MAP_BLEND_VALUES as readonly string[]).includes(v ?? '')
    ? (v as MapBlend)
    : DEFAULT_MAP_BLEND;
}

// ── Token assembly ──────────────────────────────────────────────────
// `fontColor` is an optional tenant text-colour override (a #RRGGBB hex, or
// null for "Auto"). It is applied ONLY on surfaces where it still clears the
// WCAG bar; any surface it would fail on (e.g. the accent-filled total box)
// falls back to the contrast-engine's auto colour — so nothing ever renders
// below threshold.
function buildTokens(
  p: PresetPalette,
  s: PresetStructure,
  fontStack: string,
  fontColor: string | null,
): WidgetThemeTokens {
  const accentSurfaceBorder =
    p.mode === 'light' ? 'rgba(20,16,10,.14)' : p.accentSurface;

  // Accent-filled TEXT surfaces (CTA, total box, active chip): a guaranteed
  // readable {fill, text} pair. `solid` is `accentSolid` when the preset sets
  // one (a deeper shade so WHITE text passes, keeping the identity `accent`
  // bright), else the raw accent — hardened only if no pure foreground could
  // clear 4.5:1 on it (rare borderline hues).
  const onAccent = accessibleOnAccent(p.accentSolid ?? p.accent, WCAG.NORMAL);
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
    // Structural tokens — the design-language half of the theme.
    '--w-radius-card': s.radiusCard,
    '--w-radius-input': s.radiusInput,
    '--w-radius-btn': s.radiusBtn,
    '--w-radius-pill': s.radiusPill,
    '--w-border-width': s.borderWidth,
    '--w-card-shadow': s.cardShadow,
    '--w-label-transform': s.labelTransform,
    '--w-label-spacing': s.labelSpacing,
    '--w-label-weight': s.labelWeight,
    // Stateful-control tokens — defaults reproduce the current look exactly so
    // every preset except mono renders unchanged; mono overrides via `structure`.
    '--w-active-border-color': s.activeBorderColor ?? 'transparent',
    '--w-active-border-width': s.activeBorderWidth ?? '0',
    '--w-chip-inactive-bg': s.chipInactiveBg ?? p.inputBg,
    '--w-chip-inactive-border': s.chipInactiveBorder ?? p.inputBorder,
    '--w-chip-active-bg': s.chipActiveBg ?? onAccent.bg,
    '--w-chip-active-text': s.chipActiveText ?? accentText,
    // Frosted-glass tokens — always emitted so the type stays total. A frosted
    // preset (cupertino) gets a translucent surface + real blur; every other
    // preset gets its OPAQUE surface value + `0px` blur → shell unchanged.
    '--w-surface-frost': s.frosted ? 'rgba(255,255,255,0.72)' : p.surface,
    '--w-frost-blur': s.frosted ? '30px' : '0px',
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
    // A custom accent replaces BOTH the identity accent and the filled-button
    // colour — drop any preset-specific accentSolid so the tenant's hex drives
    // the CTA/total fill (engine-hardened) rather than the preset's paired shade.
    accentSolid: undefined,
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
  /** Per-tenant feathered-map-edges toggle ('on' | 'off', default 'off'). */
  mapBlend: MapBlend;
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
  /** Per-tenant feathered-map-edges toggle ('on' | 'off'). Default 'off'. */
  mapBlend?: string | null;
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
  // Tenant's explicit font wins; otherwise the preset's own default font (its
  // design-language voice); otherwise the global default.
  const presetFont = preset.defaultFont && WIDGET_FONTS[preset.defaultFont] ? preset.defaultFont : DEFAULT_FONT_ID;
  const fontId = brand?.fontFamily && WIDGET_FONTS[brand.fontFamily] ? brand.fontFamily : presetFont;
  const font = WIDGET_FONTS[fontId];

  const accentOverride = normalizeHex(brand?.accentOverride);
  let palette = preset.palette;
  if (accentOverride) palette = applyAccentOverride(palette, accentOverride);

  // Tenant font-colour override: 'auto'/null → engine picks per surface.
  const fontColor =
    brand?.fontColor && brand.fontColor !== 'auto' ? normalizeHex(brand.fontColor) : null;
  const ctaHover = normalizeCtaHover(brand?.ctaHover);
  const mapBlend = normalizeMapBlend(brand?.mapBlend);

  return {
    preset: presetId,
    mode: preset.mode,
    font: fontId,
    fontStack: font.stack,
    accentOverride,
    fontColor: fontColor ?? 'auto',
    ctaHover,
    mapBlend,
    tokens: buildTokens(palette, preset.structure, font.stack, fontColor),
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
