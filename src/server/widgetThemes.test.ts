import { describe, it, expect } from 'vitest';
import {
  resolveWidgetTheme,
  WIDGET_PRESET_LIST,
  WIDGET_PRESETS,
  WIDGET_FONTS,
  DEFAULT_PRESET_ID,
  DEFAULT_FONT_ID,
  CTA_HOVER_STYLES,
  DEFAULT_CTA_HOVER,
  safeFontColors,
  FONT_COLOR_SWATCHES,
} from './widgetThemes.js';
import { contrastRatio, WCAG, relativeLuminance } from './color/contrast.js';

// The full contract of --w-* variables the widget CSS reads. If a preset
// or override ever fails to emit one of these, the widget falls back to
// Midnight for that slot — this guards against silent gaps.
const REQUIRED_TOKENS = [
  '--w-page-bg', '--w-surface', '--w-surface-2', '--w-surface-2-text',
  '--w-input-bg', '--w-input-bg-hover', '--w-input-text', '--w-input-border',
  '--w-text', '--w-muted', '--w-muted-2', '--w-contact-text', '--w-border',
  '--w-accent', '--w-accent-solid', '--w-accent-hover', '--w-accent-text', '--w-accent-surface',
  '--w-accent-surface-border', '--w-accent-on-surface', '--w-accent-pill-bg',
  '--w-accent-pill-border', '--w-total-text', '--w-pill-text',
  '--w-error-bg', '--w-error-text', '--w-success-bg',
  '--w-success-text', '--w-primary', '--w-primary-hover', '--w-font',
] as const;

describe('resolveWidgetTheme', () => {
  it('defaults a null brand to Midnight + Satoshi (the current widget look)', () => {
    const t = resolveWidgetTheme(null);
    expect(t.preset).toBe(DEFAULT_PRESET_ID);
    expect(t.font).toBe(DEFAULT_FONT_ID);
    expect(t.mode).toBe('dark');
    expect(t.accentOverride).toBeNull();
    // Byte-exact Midnight values — must match the CSS fallbacks in
    // public-calculator-no-gradients.css so existing tenants see zero change.
    expect(t.tokens['--w-page-bg']).toBe('#13181A');
    expect(t.tokens['--w-surface']).toBe('#1E2528');
    expect(t.tokens['--w-surface-2']).toBe('#262E31');
    expect(t.tokens['--w-input-bg']).toBe('#E6E3E0');
    expect(t.tokens['--w-input-text']).toBe('#1E1E1E');
    expect(t.tokens['--w-accent']).toBe('#0D3CFC');
    expect(t.tokens['--w-accent-on-surface']).toBe('#6E8BFF');
    expect(t.tokens['--w-text']).toBe('#FFFFFF');
  });

  it('falls back to Midnight for an unknown preset or font', () => {
    const t = resolveWidgetTheme({ themePreset: 'nope', fontFamily: 'comic-sans' });
    expect(t.preset).toBe('midnight');
    expect(t.font).toBe('satoshi');
  });

  it('resolves the Cream light theme with dark text', () => {
    const t = resolveWidgetTheme({ themePreset: 'cream' });
    expect(t.mode).toBe('light');
    expect(t.tokens['--w-text']).toBe('#232A2C');
    expect(t.tokens['--w-accent']).toBe('#0D3CFC');
    // Light theme gives the "accent chip" a visible hairline border.
    expect(t.tokens['--w-accent-surface-border']).not.toBe(t.tokens['--w-accent-surface']);
  });

  it('applies a custom accent override on top of the preset', () => {
    const t = resolveWidgetTheme({ themePreset: 'ocean', accentOverride: '#8A2BE2' });
    expect(t.accentOverride).toBe('#8A2BE2');
    expect(t.tokens['--w-accent']).toBe('#8A2BE2');
    expect(t.tokens['--w-primary']).toBe('#8A2BE2');
    // Non-accent tokens stay from the base preset (Ocean navy page).
    expect(t.tokens['--w-page-bg']).toBe('#0B1220');
    // Hover is a darkened accent (not equal to the accent).
    expect(t.tokens['--w-accent-hover']).not.toBe('#8A2BE2');
  });

  it('normalizes an accent override without the leading #', () => {
    const t = resolveWidgetTheme({ accentOverride: 'ff0044' });
    expect(t.tokens['--w-accent']).toBe('#ff0044');
  });

  it('ignores an invalid accent override', () => {
    const t = resolveWidgetTheme({ accentOverride: 'not-a-hex' });
    expect(t.accentOverride).toBeNull();
    expect(t.tokens['--w-accent']).toBe('#0D3CFC'); // preset default
  });

  it('selects a self-hosted font stack', () => {
    expect(resolveWidgetTheme({ fontFamily: 'sora' }).fontStack).toContain('Sora');
    expect(resolveWidgetTheme({ fontFamily: 'inter' }).fontStack).toContain('Inter');
    expect(resolveWidgetTheme(null).fontStack).toContain('Satoshi');
  });

  it('every preset emits the full token contract and never uses teal', () => {
    for (const preset of WIDGET_PRESET_LIST) {
      const t = resolveWidgetTheme({ themePreset: preset.id });
      for (const key of REQUIRED_TOKENS) {
        expect(t.tokens[key], `${preset.id} missing ${key}`).toBeTruthy();
      }
      // NO teal anywhere — the old default accent (#06b6d4) must be gone.
      const values = Object.values(t.tokens).join(' ').toLowerCase();
      expect(values, `${preset.id} contains teal`).not.toContain('#06b6d4');
      expect(values, `${preset.id} contains teal`).not.toContain('#0891b2');
    }
  });

  it('exposes exactly six presets and four fonts', () => {
    expect(WIDGET_PRESET_LIST.map((p) => p.id)).toEqual([
      'midnight', 'slate', 'carbon', 'ocean', 'emerald', 'cream',
    ]);
    expect(Object.keys(WIDGET_FONTS).sort()).toEqual(['inter', 'satoshi', 'sora', 'system']);
    expect(WIDGET_PRESETS.midnight.mode).toBe('dark');
  });
});

// ── WCAG contrast guarantees ──────────────────────────────────────────
// This block FAILS if any preset OR accent-override combination produces an
// on-accent / total / pill / body foreground that drops below the WCAG bar —
// exactly the "dark text on the blue box" class of bug this wave fixes.
describe('resolveWidgetTheme — WCAG contrast guarantees', () => {
  // A wide accent spread incl. Alex's hard cases (yellow, cream, red, navy)
  // plus edge greys + saturated hues.
  const ACCENTS = [
    '#0D3CFC', '#2563EB', '#059669', '#7C3AED', '#D14343', '#F59E0B',
    '#F5D400', '#EAB308', '#FFF3B0', '#FFF7E0', '#0B1220', '#111827',
    '#6E8BFF', '#9EE8FF', '#00A3A3', '#767676', '#808080', '#123456',
    '#ff0044', '#3b22f4', '#c8e8ff', '#FDE68A', '#E6E3E0',
  ];

  it('every preset ships body text that reads on its surface (validates the 6)', () => {
    for (const preset of WIDGET_PRESET_LIST) {
      const t = resolveWidgetTheme({ themePreset: preset.id });
      const r = contrastRatio(t.tokens['--w-text'], t.tokens['--w-surface']);
      expect(r, `${preset.id}: text ${t.tokens['--w-text']} on surface ${t.tokens['--w-surface']} = ${r.toFixed(2)}`)
        .toBeGreaterThanOrEqual(WCAG.NORMAL);
    }
  });

  it('accent-text, total-text and pill-text meet WCAG for EVERY preset × accent combo', () => {
    for (const preset of WIDGET_PRESET_LIST) {
      for (const accentOverride of ACCENTS) {
        const t = resolveWidgetTheme({ themePreset: preset.id, accentOverride });
        // The REAL fill behind text is the (possibly hardened) solid accent.
        const solid = t.tokens['--w-accent-solid'];
        const surface = t.tokens['--w-surface'];

        // The solid fill stays close to the chosen accent (imperceptible shift).
        const drift = contrastRatio(solid, t.tokens['--w-accent']);
        expect(drift, `${preset.id}+${accentOverride}: solid ${solid} drifted from accent ${t.tokens['--w-accent']}`)
          .toBeLessThan(1.3);

        // Button label + arrow on the accent fill.
        const rAccent = contrastRatio(t.tokens['--w-accent-text'], solid);
        expect(rAccent, `${preset.id}+${accentOverride}: accent-text ${t.tokens['--w-accent-text']} on ${solid} = ${rAccent.toFixed(2)}`)
          .toBeGreaterThanOrEqual(WCAG.NORMAL);

        // Big number + label on the accent-filled "Estimated total" box.
        const rTotal = contrastRatio(t.tokens['--w-total-text'], solid);
        expect(rTotal, `${preset.id}+${accentOverride}: total-text ${t.tokens['--w-total-text']} on ${solid} = ${rTotal.toFixed(2)}`)
          .toBeGreaterThanOrEqual(WCAG.NORMAL);

        // Pill / on-surface accent label reads on the shell surface.
        const rPill = contrastRatio(t.tokens['--w-pill-text'], surface);
        expect(rPill, `${preset.id}+${accentOverride}: pill-text ${t.tokens['--w-pill-text']} on ${surface} = ${rPill.toFixed(2)}`)
          .toBeGreaterThanOrEqual(WCAG.UI);
      }
    }
  });

  it('the reported bug is gone: default Midnight total box is white on cobalt', () => {
    const t = resolveWidgetTheme(null);
    expect(t.tokens['--w-accent']).toBe('#0D3CFC');
    expect(t.tokens['--w-total-text']).toBe('#FFFFFF');
    expect(contrastRatio('#FFFFFF', '#0D3CFC')).toBeGreaterThanOrEqual(WCAG.NORMAL);
  });

  it('a yellow accent flips the on-accent text to dark (not white)', () => {
    const t = resolveWidgetTheme({ accentOverride: '#F5D400' });
    expect(relativeLuminance(t.tokens['--w-total-text'])).toBeLessThan(0.5); // a dark ink
    expect(contrastRatio(t.tokens['--w-total-text'], '#F5D400')).toBeGreaterThanOrEqual(WCAG.NORMAL);
    expect(contrastRatio(t.tokens['--w-accent-text'], '#F5D400')).toBeGreaterThanOrEqual(WCAG.NORMAL);
  });
});

// ── Tenant font-colour override (Wave 3) ─────────────────────────────
describe('resolveWidgetTheme — font-colour override', () => {
  it("'auto' / null leaves the engine's picked foregrounds in place", () => {
    const t = resolveWidgetTheme({ themePreset: 'midnight', fontColor: 'auto' });
    expect(t.fontColor).toBe('auto');
    expect(t.tokens['--w-text']).toBe('#FFFFFF'); // Midnight default
  });

  it('applies a chosen colour ONLY where it passes WCAG on that surface', () => {
    // Charcoal on the Cream light surface passes → applied to body text.
    const t = resolveWidgetTheme({ themePreset: 'cream', fontColor: '#141414' });
    expect(t.fontColor).toBe('#141414');
    expect(t.tokens['--w-text']).toBe('#141414');
    expect(contrastRatio(t.tokens['--w-text'], t.tokens['--w-surface'])).toBeGreaterThanOrEqual(WCAG.NORMAL);
  });

  it('falls back to the safe auto colour on any surface the choice would fail', () => {
    // White text on the Cream (light) surface FAILS → body text must NOT be white.
    const t = resolveWidgetTheme({ themePreset: 'cream', fontColor: '#FFFFFF' });
    expect(t.tokens['--w-text']).not.toBe('#FFFFFF');
    expect(contrastRatio(t.tokens['--w-text'], t.tokens['--w-surface'])).toBeGreaterThanOrEqual(WCAG.NORMAL);
  });

  it('never renders the total box below threshold even with a clashing font colour', () => {
    // A near-accent font colour would fail on the accent fill → total-text auto.
    const t = resolveWidgetTheme({ themePreset: 'midnight', accentOverride: '#0D3CFC', fontColor: '#1E3AAA' });
    expect(contrastRatio(t.tokens['--w-total-text'], t.tokens['--w-accent'])).toBeGreaterThanOrEqual(WCAG.NORMAL);
  });
});

// ── safeFontColors (panel option universe) ───────────────────────────
describe('safeFontColors', () => {
  it('only returns swatches that clear WCAG on ALL given backgrounds', () => {
    for (const surfaces of [['#161616', '#181D1F'], ['#F3EEE4', '#FBF8F1'], ['#0B1220']]) {
      for (const sw of safeFontColors(surfaces)) {
        for (const bg of surfaces) {
          expect(contrastRatio(sw.hex, bg), `${sw.hex} on ${bg}`).toBeGreaterThanOrEqual(WCAG.NORMAL);
        }
      }
    }
  });

  it('offers DIFFERENT sets for a dark vs a light background', () => {
    const darkIds = safeFontColors(['#161616', '#181D1F']).map((s) => s.id);
    const lightIds = safeFontColors(['#F3EEE4', '#FBF8F1']).map((s) => s.id);
    // White is safe on the dark shell but not the cream one; charcoal is the reverse.
    expect(darkIds).toContain('white');
    expect(darkIds).not.toContain('charcoal');
    expect(lightIds).toContain('charcoal');
    expect(lightIds).not.toContain('white');
  });

  it('every curated swatch is a real hex', () => {
    for (const sw of FONT_COLOR_SWATCHES) expect(sw.hex).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});

// ── CTA hover setting ────────────────────────────────────────────────
describe('resolveWidgetTheme — CTA hover', () => {
  it('defaults to border and normalizes unknown values', () => {
    expect(resolveWidgetTheme(null).ctaHover).toBe(DEFAULT_CTA_HOVER);
    expect(resolveWidgetTheme(null).ctaHover).toBe('border');
    expect(resolveWidgetTheme({ ctaHover: 'wobble' }).ctaHover).toBe('border');
  });

  it('passes through each supported style', () => {
    for (const style of CTA_HOVER_STYLES) {
      expect(resolveWidgetTheme({ ctaHover: style }).ctaHover).toBe(style);
    }
  });
});
