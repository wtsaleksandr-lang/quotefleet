/**
 * WCAG contrast engine — SINGLE SOURCE OF TRUTH for readable colour pairing.
 *
 * Pure, dependency-free colour maths (sRGB relative-luminance + contrast
 * ratio, per WCAG 2.1) plus a deterministic {@link pickForeground} /
 * {@link ensureReadable} that guarantee a foreground meets a target ratio
 * against ANY background — no matter what colour a tenant picks.
 *
 * Alex's benchmarks (WCAG 2.1 AA):
 *   - Normal text  (< 18pt / < 14pt bold):  ≥ 4.5:1   → {@link WCAG.NORMAL}
 *   - Large text   (≥ 18pt / ≥ 14pt bold):  ≥ 3:1     → {@link WCAG.LARGE}
 *   - UI / graphics (icons, borders, badges): ≥ 3:1    → {@link WCAG.UI}
 *
 * Used by widgetThemes.ts so every background-dependent foreground token
 * (`--w-accent-text`, `--w-total-text`, `--w-pill-text`, custom-accent text,
 * tenant font colour) is COMPUTED to pass, not hand-guessed. The customize
 * dashboard mirrors this maths client-side to only ever offer WCAG-passing
 * font-colour swatches for the currently-selected background.
 */

export const WCAG = {
  /** Normal body text (< 18pt / < 14pt bold). */
  NORMAL: 4.5,
  /** Large text (≥ 18pt / ≥ 14pt bold). */
  LARGE: 3,
  /** UI components + meaningful graphics (icons, borders, badges). */
  UI: 3,
} as const;

export type Rgb = { r: number; g: number; b: number };

export function clamp8(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

export function hexToRgb(hex: string): Rgb | null {
  if (typeof hex !== 'string') return null;
  let s = hex.trim().replace(/^#/, '');
  // Expand 3-digit shorthand (#abc → #aabbcc).
  if (/^[0-9a-f]{3}$/i.test(s)) s = s.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(s)) return null;
  const int = parseInt(s, 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => clamp8(v).toString(16).padStart(2, '0')).join('');
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };

/** Mix `hex` toward `target` (default white) by `amount` (0..1). */
export function mix(hex: string, amount: number, target: Rgb = WHITE): string {
  const c = hexToRgb(hex);
  if (!c) return hex;
  const t = Math.max(0, Math.min(1, amount));
  return rgbToHex(
    c.r + (target.r - c.r) * t,
    c.g + (target.g - c.g) * t,
    c.b + (target.b - c.b) * t,
  );
}

export const lighten = (hex: string, amount: number): string => mix(hex, amount, WHITE);
export const darken = (hex: string, amount: number): string => mix(hex, amount, BLACK);

/** rgba() string from a hex + alpha (falls through non-hex input untouched). */
export function rgba(hex: string, alpha: number): string {
  const c = hexToRgb(hex);
  if (!c) return hex;
  return `rgba(${c.r},${c.g},${c.b},${alpha})`;
}

function channelLinear(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance (0 = black, 1 = white). */
export function relativeLuminance(hex: string): number {
  const c = hexToRgb(hex);
  if (!c) return 0;
  return 0.2126 * channelLinear(c.r) + 0.7152 * channelLinear(c.g) + 0.0722 * channelLinear(c.b);
}

/** WCAG contrast ratio between two colours (1 → 21). Order-independent. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** True when `fg` on `bg` meets the required ratio (default AA normal). */
export function passes(fg: string, bg: string, level: number = WCAG.NORMAL): boolean {
  return contrastRatio(fg, bg) >= level - 1e-9;
}

/** Rounded ratio, handy for logs / test messages. */
export function ratio(a: string, b: string): number {
  return Math.round(contrastRatio(a, b) * 100) / 100;
}

const DEFAULT_CANDIDATES = ['#FFFFFF', '#141414'];

export interface PickOpts {
  /** Required ratio. Use WCAG.LARGE for ≥18pt / ≥14pt-bold text. */
  level?: number;
  /** Alias for `level: WCAG.LARGE`. */
  large?: boolean;
  /** Ordered preference list; the first that passes wins. */
  candidates?: string[];
}

/**
 * Return a foreground colour that meets the target ratio on `bg`.
 *
 * 1. Prefer the first candidate (white, then near-black by default) that
 *    already passes.
 * 2. If none pass, take the higher-contrast candidate and push it toward
 *    white (on a dark bg) or black (on a light bg) until it clears the
 *    threshold — so even a mid-tone accent gets a guaranteed-readable label.
 *
 * Deterministic: same input → same output, on server + client + preview.
 */
export function pickForeground(bg: string, opts: PickOpts = {}): string {
  const level = opts.level ?? (opts.large ? WCAG.LARGE : WCAG.NORMAL);
  const candidates = opts.candidates && opts.candidates.length ? opts.candidates : DEFAULT_CANDIDATES;

  for (const c of candidates) {
    if (contrastRatio(c, bg) >= level - 1e-9) return c; // first passing candidate wins
  }

  // No candidate passed outright. Pick the DIRECTION (toward pure white or
  // pure black) that yields more contrast on this background — comparing the
  // true extremes, so a mid-tone that only a near-black could carry isn't
  // wrongly pushed toward white. Then walk a soft anchor to that extreme.
  const preferWhite = contrastRatio('#FFFFFF', bg) >= contrastRatio('#000000', bg);
  const anchor = preferWhite ? '#FFFFFF' : '#141414';
  const target: Rgb = preferWhite ? WHITE : BLACK;
  for (let step = 0; step <= 20; step++) {
    const out = mix(anchor, step / 20, target);
    if (contrastRatio(out, bg) >= level - 1e-9) return out;
  }
  // Absolute fallback: the pure extreme (guarantees maximal contrast).
  return preferWhite ? '#FFFFFF' : '#000000';
}

/**
 * Keep a *preferred* foreground when it already passes on `bg`; otherwise
 * nudge it toward higher contrast, and if it still can't clear the bar,
 * fall back to {@link pickForeground}. Use this to honour a tenant's chosen
 * font colour / a preset's tuned on-surface colour while never rendering
 * below threshold.
 */
export interface AccentPair {
  /** The fill to render behind the text (the accent, minimally hardened only
   *  if no pure foreground could otherwise clear the bar). */
  bg: string;
  /** A foreground guaranteed to meet the target ratio on `bg`. */
  text: string;
}

/**
 * Produce a guaranteed-readable {fill, text} pair for an accent-filled surface
 * (CTA button, total box, active chip…).
 *
 * Preference order:
 *  1. Keep the exact accent and pick a passing white / near-black foreground.
 *  2. If NO pure foreground can clear the bar on this accent (a genuinely
 *     borderline mid-tone like periwinkle), darken/lighten the FILL by the
 *     smallest amount needed so white (or near-black) passes — an
 *     imperceptible shift that mature design systems make for brand buttons.
 *
 * For any well-chosen accent this returns the accent unchanged.
 */
export function accessibleOnAccent(accent: string, level: number = WCAG.NORMAL): AccentPair {
  const fg = pickForeground(accent, { level });
  if (passes(fg, accent, level)) return { bg: accent, text: fg };

  // Harden the fill: find the minimal darken (for white text) or lighten (for
  // near-black text) that clears the bar, then take whichever moved least.
  let darkBg = accent;
  let darkOk = false;
  for (let s = 1; s <= 24; s++) {
    darkBg = mix(accent, s / 48, BLACK);
    if (contrastRatio('#FFFFFF', darkBg) >= level - 1e-9) { darkOk = true; break; }
  }
  let lightBg = accent;
  let lightOk = false;
  for (let s = 1; s <= 24; s++) {
    lightBg = mix(accent, s / 48, WHITE);
    if (contrastRatio('#141414', lightBg) >= level - 1e-9) { lightOk = true; break; }
  }
  const dist = (a: string, b: string): number => {
    const ca = hexToRgb(a)!;
    const cb = hexToRgb(b)!;
    return Math.abs(ca.r - cb.r) + Math.abs(ca.g - cb.g) + Math.abs(ca.b - cb.b);
  };
  if (darkOk && (!lightOk || dist(accent, darkBg) <= dist(accent, lightBg))) {
    return { bg: darkBg, text: '#FFFFFF' };
  }
  if (lightOk) return { bg: lightBg, text: '#141414' };
  // Unreachable in practice; return the best-effort foreground on the accent.
  return { bg: accent, text: fg };
}

export function ensureReadable(fg: string, bg: string, opts: PickOpts = {}): string {
  const level = opts.level ?? (opts.large ? WCAG.LARGE : WCAG.NORMAL);
  if (passes(fg, bg, level)) return fg;

  // Nudge the ORIGINAL colour toward the contrast-increasing extreme, keeping
  // as much of its hue as possible before giving up.
  const preferWhite = contrastRatio('#FFFFFF', bg) >= contrastRatio('#000000', bg);
  const target: Rgb = preferWhite ? WHITE : BLACK;
  for (let step = 1; step <= 20; step++) {
    const out = mix(fg, step / 20, target);
    if (contrastRatio(out, bg) >= level - 1e-9) return out;
  }
  return pickForeground(bg, opts);
}
