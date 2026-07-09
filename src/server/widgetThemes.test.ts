import { describe, it, expect } from 'vitest';
import {
  resolveWidgetTheme,
  WIDGET_PRESET_LIST,
  WIDGET_PRESETS,
  WIDGET_FONTS,
  DEFAULT_PRESET_ID,
  DEFAULT_FONT_ID,
} from './widgetThemes.js';

// The full contract of --w-* variables the widget CSS reads. If a preset
// or override ever fails to emit one of these, the widget falls back to
// Midnight for that slot — this guards against silent gaps.
const REQUIRED_TOKENS = [
  '--w-page-bg', '--w-surface', '--w-surface-2', '--w-surface-2-text',
  '--w-input-bg', '--w-input-bg-hover', '--w-input-text', '--w-input-border',
  '--w-text', '--w-muted', '--w-muted-2', '--w-contact-text', '--w-border',
  '--w-accent', '--w-accent-hover', '--w-accent-text', '--w-accent-surface',
  '--w-accent-surface-border', '--w-accent-on-surface', '--w-accent-pill-bg',
  '--w-accent-pill-border', '--w-error-bg', '--w-error-text', '--w-success-bg',
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
    expect(t.tokens['--w-page-bg']).toBe('#161616');
    expect(t.tokens['--w-surface']).toBe('#181D1F');
    expect(t.tokens['--w-surface-2']).toBe('#1C1C1C');
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
    expect(t.tokens['--w-text']).toBe('#241F16');
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
