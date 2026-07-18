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
  MAP_BLEND_VALUES,
  DEFAULT_MAP_BLEND,
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
  // Structural (design-language) tokens — Wave 4.
  '--w-radius-card', '--w-radius-input', '--w-radius-btn', '--w-radius-pill',
  '--w-border-width', '--w-card-shadow',
  '--w-label-transform', '--w-label-spacing', '--w-label-weight',
  // Stateful-control tokens — Wave 5 (the mono/Uber active-inactive pattern).
  '--w-active-border-color', '--w-active-border-width',
  '--w-chip-inactive-bg', '--w-chip-inactive-border',
  '--w-chip-active-bg', '--w-chip-active-text',
  // Frosted-glass tokens — Wave 6 (the cupertino/Apple frosted shell).
  '--w-surface-frost', '--w-frost-blur',
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
    const t = resolveWidgetTheme({ themePreset: 'tesla', accentOverride: '#8A2BE2' });
    expect(t.accentOverride).toBe('#8A2BE2');
    expect(t.tokens['--w-accent']).toBe('#8A2BE2');
    expect(t.tokens['--w-primary']).toBe('#8A2BE2');
    // Non-accent tokens stay from the base preset (Voltage/Tesla near-black page).
    expect(t.tokens['--w-page-bg']).toBe('#0A0A0B');
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
      // The emitted token set is EXACTLY the contract — no extra, no missing.
      // Locks the count so a new token must be added to REQUIRED_TOKENS too.
      expect(Object.keys(t.tokens).sort(), `${preset.id} token set`).toEqual([...REQUIRED_TOKENS].sort());
      // NO teal anywhere — the old default accent (#06b6d4) must be gone.
      const values = Object.values(t.tokens).join(' ').toLowerCase();
      expect(values, `${preset.id} contains teal`).not.toContain('#06b6d4');
      expect(values, `${preset.id} contains teal`).not.toContain('#0891b2');
    }
  });

  it('exposes exactly thirteen presets and eight fonts', () => {
    expect(WIDGET_PRESET_LIST.map((p) => p.id)).toEqual([
      'midnight', 'mono', 'ironhorse', 'harbor', 'cupertino', 'material',
      'booking', 'tesla', 'stripe', 'stone', 'citron', 'vault', 'cream',
    ]);
    expect(Object.keys(WIDGET_FONTS).sort()).toEqual(
      ['clashdisplay', 'dmsans', 'inter', 'oswald', 'roboto', 'satoshi', 'sora', 'system'],
    );
    expect(WIDGET_PRESETS.midnight.mode).toBe('dark');
    // Ironhorse (Harley) + Harbor (ride-app) are both LIGHT themes.
    expect(WIDGET_PRESETS.ironhorse.mode).toBe('light');
    expect(WIDGET_PRESETS.harbor.mode).toBe('light');
    // Voyage (Booking) is an all-blue DARK theme.
    expect(WIDGET_PRESETS.booking.mode).toBe('dark');
    // Voltage (Tesla) is a near-black DARK theme; Blurple (Stripe) is LIGHT.
    expect(WIDGET_PRESETS.tesla.mode).toBe('dark');
    expect(WIDGET_PRESETS.stripe.mode).toBe('light');
    // Stone (blueprint) is a cool-slate LIGHT theme.
    expect(WIDGET_PRESETS.stone.mode).toBe('light');
    // Citron (lime) + Vault (cream fintech) are both LIGHT themes.
    expect(WIDGET_PRESETS.citron.mode).toBe('light');
    expect(WIDGET_PRESETS.vault.mode).toBe('light');
    // A balanced light + dark lineup (3 dark, 10 light).
    expect(WIDGET_PRESET_LIST.filter((p) => p.mode === 'dark')).toHaveLength(3);
    expect(WIDGET_PRESET_LIST.filter((p) => p.mode === 'light')).toHaveLength(10);
  });

  it('ironhorse (Harley) ships the condensed Oswald voice + orange-on-white moto structure', () => {
    const t = resolveWidgetTheme({ themePreset: 'ironhorse' });
    expect(t.mode).toBe('light');
    expect(t.tokens['--w-surface']).toBe('#FFFFFF');
    expect(t.tokens['--w-accent']).toBe('#FC6600');
    // Sharp small radius + heavy tracked uppercase labels.
    expect(t.tokens['--w-radius-card']).toBe('10px');
    expect(t.tokens['--w-label-transform']).toBe('uppercase');
    expect(t.tokens['--w-label-weight']).toBe('800');
    // Black active border on white — the moto control pattern.
    expect(t.tokens['--w-active-border-color']).toBe('#111111');
    expect(t.tokens['--w-active-border-width']).toBe('2px');
    // Its own default font is the self-hosted condensed Oswald.
    expect(t.font).toBe('oswald');
    expect(t.fontStack).toContain('Oswald');
  });

  it('harbor (ride-app) is a soft teal light theme with filled-teal active tabs', () => {
    const t = resolveWidgetTheme({ themePreset: 'harbor' });
    expect(t.mode).toBe('light');
    expect(t.tokens['--w-surface']).toBe('#FFFFFF');
    expect(t.tokens['--w-accent']).toBe('#0C566B');
    // Soft large radius, sentence-case labels.
    expect(t.tokens['--w-radius-card']).toBe('18px');
    expect(t.tokens['--w-label-transform']).toBe('none');
    // Active tab = filled teal pill (white text, no border); inactive = white + hairline.
    expect(t.tokens['--w-active-border-color']).toBe('transparent');
    expect(t.tokens['--w-chip-active-bg']).toBe('#0C566B');
    expect(t.tokens['--w-chip-active-text']).toBe('#FFFFFF');
    expect(t.tokens['--w-chip-inactive-bg']).toBe('#FFFFFF');
    expect(t.font).toBe('inter');
  });

  it('cupertino (Apple) is a FROSTED white theme with the SF voice + system-blue accent', () => {
    const t = resolveWidgetTheme({ themePreset: 'cupertino' });
    expect(t.mode).toBe('light');
    expect(t.tokens['--w-surface']).toBe('#FFFFFF');
    expect(t.tokens['--w-page-bg']).toBe('#EDEDF2');
    // System-blue #007AFF is the DISPLAY accent; on-surface labels come from #0069E0.
    expect(t.tokens['--w-accent']).toBe('#007AFF');
    expect(t.tokens['--w-accent-on-surface']).toBe('#0069E0');
    // White-on-#007AFF is only ~4:1, so the engine picks a guaranteed-readable
    // label for the SOLID CTA/total fill. Whatever it chooses, the pair clears
    // WCAG AA, and the fill stays imperceptibly close to the display accent.
    expect(contrastRatio(t.tokens['--w-accent-text'], t.tokens['--w-accent-solid'])).toBeGreaterThanOrEqual(WCAG.NORMAL);
    expect(contrastRatio(t.tokens['--w-total-text'], t.tokens['--w-accent-solid'])).toBeGreaterThanOrEqual(WCAG.NORMAL);
    expect(contrastRatio(t.tokens['--w-accent-solid'], t.tokens['--w-accent'])).toBeLessThan(1.3);
    // On-surface accent label reads on the white shell.
    expect(contrastRatio(t.tokens['--w-pill-text'], t.tokens['--w-surface'])).toBeGreaterThanOrEqual(WCAG.UI);
    // Large soft radius, sentence-case labels at Apple's 590 weight.
    expect(t.tokens['--w-radius-card']).toBe('20px');
    expect(t.tokens['--w-label-transform']).toBe('none');
    expect(t.tokens['--w-label-weight']).toBe('590');
    // The frosted-glass tokens: translucent surface + a real blur radius.
    expect(t.tokens['--w-surface-frost']).toBe('rgba(255,255,255,0.72)');
    expect(t.tokens['--w-frost-blur']).toBe('30px');
    // Ships the SF/system font voice.
    expect(t.font).toBe('system');
    expect(t.fontStack).toContain('SF Pro');
    expect(t.fontStack).toContain('-apple-system');
  });

  it('material (Google) ships the Roboto voice + M3-refined structure', () => {
    const t = resolveWidgetTheme({ themePreset: 'material' });
    expect(t.mode).toBe('light');
    expect(t.tokens['--w-surface']).toBe('#FFFFFF');
    expect(t.tokens['--w-accent']).toBe('#1A73E8');
    // M3 refinement: 16px card, Roboto Medium (500) sentence-case labels at 0.01em.
    expect(t.tokens['--w-radius-card']).toBe('16px');
    expect(t.tokens['--w-label-transform']).toBe('none');
    expect(t.tokens['--w-label-weight']).toBe('500');
    expect(t.tokens['--w-label-spacing']).toBe('0.01em');
    // Its own default font is the self-hosted Roboto.
    expect(t.font).toBe('roboto');
    expect(t.fontStack).toContain('Roboto');
    expect(WIDGET_FONTS.roboto.selfHosted).toBe(true);
  });

  it('booking (Voyage) is an all-blue dark theme with the white-border active pattern', () => {
    const t = resolveWidgetTheme({ themePreset: 'booking' });
    expect(t.mode).toBe('dark');
    // All-blue tonal shell: deep-blue card, darker blue page, action-blue accent.
    expect(t.tokens['--w-surface']).toBe('#003B95');
    expect(t.tokens['--w-page-bg']).toBe('#002E77');
    expect(t.tokens['--w-accent']).toBe('#006CE4');
    expect(t.tokens['--w-text']).toBe('#FFFFFF');
    // White body text reads on the deep-blue surface.
    expect(contrastRatio(t.tokens['--w-text'], t.tokens['--w-surface'])).toBeGreaterThanOrEqual(WCAG.NORMAL);
    // Borderless resting shell; the active tab/chip is carried by a 2px WHITE border.
    expect(t.tokens['--w-border-width']).toBe('0');
    expect(t.tokens['--w-active-border-color']).toBe('#FFFFFF');
    expect(t.tokens['--w-active-border-width']).toBe('2px');
    expect(t.tokens['--w-chip-inactive-bg']).toBe('#0D459A');
    expect(t.tokens['--w-chip-active-bg']).toBe('#12509F');
    expect(t.tokens['--w-chip-active-text']).toBe('#FFFFFF');
    // White text passes on the action-blue solid fill (AA).
    expect(contrastRatio(t.tokens['--w-accent-text'], t.tokens['--w-accent-solid'])).toBeGreaterThanOrEqual(WCAG.NORMAL);
    expect(t.font).toBe('inter');
  });

  it('tesla (Voltage) is a near-black dark theme with dark inputs + Tesla-red accent', () => {
    const t = resolveWidgetTheme({ themePreset: 'tesla' });
    expect(t.mode).toBe('dark');
    // Near-black console shell + graphite cards.
    expect(t.tokens['--w-page-bg']).toBe('#0A0A0B');
    expect(t.tokens['--w-surface']).toBe('#141516');
    // DARK inputs with white text — the in-car console look.
    expect(t.tokens['--w-input-bg']).toBe('#1E1F21');
    expect(t.tokens['--w-input-text']).toBe('#FFFFFF');
    // Tesla-red identity accent; the FILLED CTA/total use the deeper #C8151B.
    expect(t.tokens['--w-accent']).toBe('#E82127');
    expect(t.tokens['--w-accent-solid']).toBe('#C8151B');
    // White CTA/total text clears WCAG AA on the deeper red fill.
    expect(contrastRatio(t.tokens['--w-accent-text'], t.tokens['--w-accent-solid'])).toBeGreaterThanOrEqual(WCAG.NORMAL);
    expect(contrastRatio(t.tokens['--w-total-text'], t.tokens['--w-accent-solid'])).toBeGreaterThanOrEqual(WCAG.NORMAL);
    // Thin tracked UPPERCASE micro-labels; medium card radius; near-flat shadow.
    expect(t.tokens['--w-radius-card']).toBe('10px');
    expect(t.tokens['--w-label-transform']).toBe('uppercase');
    expect(t.tokens['--w-label-spacing']).toBe('0.14em');
    expect(t.tokens['--w-label-weight']).toBe('500');
    // Active chip = filled deep-red (white text); inactive = dark graphite tint.
    expect(t.tokens['--w-chip-active-bg']).toBe('#C8151B');
    expect(t.tokens['--w-chip-active-text']).toBe('#FFFFFF');
    expect(t.tokens['--w-chip-inactive-bg']).toBe('#1E1F21');
    // Ships the geometric Sora voice.
    expect(t.font).toBe('sora');
    expect(t.fontStack).toContain('Sora');
  });

  it('stripe (Blurple) is a fintech light theme with the indigo accent + soft float', () => {
    const t = resolveWidgetTheme({ themePreset: 'stripe' });
    expect(t.mode).toBe('light');
    // Surface-gray page under a pure-white card.
    expect(t.tokens['--w-page-bg']).toBe('#F6F9FC');
    expect(t.tokens['--w-surface']).toBe('#FFFFFF');
    // Dark-slate text, never pure black.
    expect(t.tokens['--w-text']).toBe('#0A2540');
    // Blurple identity accent; FILLED surfaces use the deeper #5A52E0.
    expect(t.tokens['--w-accent']).toBe('#635BFF');
    expect(t.tokens['--w-accent-solid']).toBe('#5A52E0');
    // White label clears WCAG AA on the deeper indigo fill.
    expect(contrastRatio(t.tokens['--w-accent-text'], t.tokens['--w-accent-solid'])).toBeGreaterThanOrEqual(WCAG.NORMAL);
    // Generously rounded card, sentence-case labels at Stripe's 560 weight.
    expect(t.tokens['--w-radius-card']).toBe('16px');
    expect(t.tokens['--w-label-transform']).toBe('none');
    expect(t.tokens['--w-label-weight']).toBe('560');
    // The layered slate-blue coloured float shadow (three layers — the Stripe tell).
    expect(t.tokens['--w-card-shadow']).toContain('rgba(50,50,93,.10)');
    // Segmented tabs: active = filled indigo pill (white text); inactive = gray tint.
    expect(t.tokens['--w-chip-active-bg']).toBe('#5A52E0');
    expect(t.tokens['--w-chip-active-text']).toBe('#FFFFFF');
    expect(t.tokens['--w-chip-inactive-bg']).toBe('#F6F9FC');
    expect(t.font).toBe('inter');
    expect(t.fontStack).toContain('Inter');
  });

  it('stone (blueprint) is a cool-slate light theme with the filled-graphite active pattern', () => {
    const t = resolveWidgetTheme({ themePreset: 'stone' });
    expect(t.mode).toBe('light');
    // Cool slate-grey drench — genuinely grey surfaces, tonal shades of one family.
    expect(t.tokens['--w-page-bg']).toBe('#A9B0B8');
    expect(t.tokens['--w-surface']).toBe('#BFC5CB');
    expect(t.tokens['--w-input-bg']).toBe('#CFD4D9');
    expect(t.tokens['--w-text']).toBe('#191F25');
    // Cool graphite accent; FILLED CTA/total surfaces use the deeper #21272D.
    expect(t.tokens['--w-accent']).toBe('#2B3138');
    expect(t.tokens['--w-accent-solid']).toBe('#21272D');
    // White CTA/total text clears WCAG AA on the deeper graphite fill.
    expect(contrastRatio(t.tokens['--w-accent-text'], t.tokens['--w-accent-solid'])).toBeGreaterThanOrEqual(WCAG.NORMAL);
    expect(contrastRatio(t.tokens['--w-total-text'], t.tokens['--w-accent-solid'])).toBeGreaterThanOrEqual(WCAG.NORMAL);
    // Body text reads on the cool-slate surface.
    expect(contrastRatio(t.tokens['--w-text'], t.tokens['--w-surface'])).toBeGreaterThanOrEqual(WCAG.NORMAL);
    // Sharp small radius + tight technical UPPERCASE micro-labels.
    expect(t.tokens['--w-radius-card']).toBe('5px');
    expect(t.tokens['--w-radius-pill']).toBe('4px');
    expect(t.tokens['--w-label-transform']).toBe('uppercase');
    expect(t.tokens['--w-label-spacing']).toBe('0.06em');
    expect(t.tokens['--w-label-weight']).toBe('600');
    // Active chip = filled cool graphite (white text); inactive = cool-slate tint.
    expect(t.tokens['--w-active-border-color']).toBe('transparent');
    expect(t.tokens['--w-chip-active-bg']).toBe('#21272D');
    expect(t.tokens['--w-chip-active-text']).toBe('#FFFFFF');
    expect(t.tokens['--w-chip-inactive-bg']).toBe('#B4BBC2');
    // Active-chip white text clears WCAG AA on the graphite chip fill.
    expect(contrastRatio(t.tokens['--w-chip-active-text'], t.tokens['--w-chip-active-bg'])).toBeGreaterThanOrEqual(WCAG.NORMAL);
    // Ships the neutral Inter (Swiss grotesque) voice.
    expect(t.font).toBe('inter');
    expect(t.fontStack).toContain('Inter');
  });

  it('citron (lime) is a token-driven light theme — near-black identity, LIME accent-solid, chip tokens inherit', () => {
    const t = resolveWidgetTheme({ themePreset: 'citron' });
    expect(t.mode).toBe('light');
    // White cards on an off-white page, near-black ink.
    expect(t.tokens['--w-surface']).toBe('#FFFFFF');
    expect(t.tokens['--w-page-bg']).toBe('#F8F8F8');
    expect(t.tokens['--w-text']).toBe('#292928');
    // Near-black IDENTITY accent (on-white labels), LIME as the accent-solid fill.
    expect(t.tokens['--w-accent']).toBe('#292928');
    expect(t.tokens['--w-accent-solid']).toBe('#C3F832');
    // Lime carries dark text (engine-picked); the pair clears WCAG AA.
    expect(contrastRatio(t.tokens['--w-accent-text'], t.tokens['--w-accent-solid'])).toBeGreaterThanOrEqual(WCAG.NORMAL);
    expect(contrastRatio(t.tokens['--w-total-text'], t.tokens['--w-accent-solid'])).toBeGreaterThanOrEqual(WCAG.NORMAL);
    // chipActive* are INTENTIONALLY omitted → they inherit accent-solid / accent-text
    // (lime now, tenant override later), never a hardcoded literal.
    expect(t.tokens['--w-chip-active-bg']).toBe(t.tokens['--w-accent-solid']);
    expect(t.tokens['--w-chip-active-text']).toBe(t.tokens['--w-accent-text']);
    // Editorial soft shell + DM Sans voice.
    expect(t.tokens['--w-radius-card']).toBe('16px');
    expect(t.tokens['--w-label-transform']).toBe('none');
    expect(t.font).toBe('dmsans');
    expect(t.fontStack).toContain('DM Sans');
    expect(WIDGET_FONTS.dmsans.selfHosted).toBe(true);
  });

  it('citron lime is NOT locked — a tenant accent override recolours the CTA/total fill', () => {
    const t = resolveWidgetTheme({ themePreset: 'citron', accentOverride: '#0057FF' });
    // Override clears accentSolid → the engine drives the fill from the tenant hex.
    expect(t.tokens['--w-accent']).toBe('#0057FF');
    expect(t.tokens['--w-accent-solid']).not.toBe('#C3F832');
    // Whatever the engine picks, CTA/total text still clears WCAG AA on the fill.
    expect(contrastRatio(t.tokens['--w-accent-text'], t.tokens['--w-accent-solid'])).toBeGreaterThanOrEqual(WCAG.NORMAL);
    expect(contrastRatio(t.tokens['--w-total-text'], t.tokens['--w-accent-solid'])).toBeGreaterThanOrEqual(WCAG.NORMAL);
  });

  it('vault (cream fintech) is a light theme with a deep-vermillion CTA fill + Clash Display voice', () => {
    const t = resolveWidgetTheme({ themePreset: 'vault' });
    expect(t.mode).toBe('light');
    // Warm bone page under a lighter cream card (NOT white).
    expect(t.tokens['--w-page-bg']).toBe('#EAE4D9');
    expect(t.tokens['--w-surface']).toBe('#FBF8F2');
    expect(t.tokens['--w-text']).toBe('#1A1714');
    // Vermillion identity accent; the FILLED CTA/total use the deeper #CC3410.
    expect(t.tokens['--w-accent']).toBe('#F04E23');
    expect(t.tokens['--w-accent-solid']).toBe('#CC3410');
    // White CTA/total text clears WCAG AA on the deeper vermillion fill.
    expect(contrastRatio(t.tokens['--w-accent-text'], t.tokens['--w-accent-solid'])).toBeGreaterThanOrEqual(WCAG.NORMAL);
    expect(contrastRatio(t.tokens['--w-total-text'], t.tokens['--w-accent-solid'])).toBeGreaterThanOrEqual(WCAG.NORMAL);
    // Body text reads on the warm cream surface.
    expect(contrastRatio(t.tokens['--w-text'], t.tokens['--w-surface'])).toBeGreaterThanOrEqual(WCAG.NORMAL);
    // Active tab/chip = filled deep-vermillion (white text); inactive = warm cream pill.
    expect(t.tokens['--w-chip-active-bg']).toBe('#CC3410');
    expect(t.tokens['--w-chip-active-text']).toBe('#FFFFFF');
    expect(t.tokens['--w-chip-inactive-bg']).toBe('#FBF8F2');
    // Soft 18px card, sentence-case 600 labels, Clash Display voice.
    expect(t.tokens['--w-radius-card']).toBe('18px');
    expect(t.tokens['--w-label-transform']).toBe('none');
    expect(t.font).toBe('clashdisplay');
    expect(t.fontStack).toContain('Clash Display');
    expect(WIDGET_FONTS.clashdisplay.selfHosted).toBe(true);
  });

  it('ONLY cupertino is frosted — every other preset emits its opaque surface + 0px blur', () => {
    for (const preset of WIDGET_PRESET_LIST) {
      const t = resolveWidgetTheme({ themePreset: preset.id });
      if (preset.id === 'cupertino') continue;
      // Non-frosted presets: frost mirror equals the opaque surface, blur is off,
      // so their shell renders byte-for-byte identical (the frosted CSS is a no-op).
      expect(t.tokens['--w-surface-frost'], `${preset.id} frost`).toBe(t.tokens['--w-surface']);
      expect(t.tokens['--w-frost-blur'], `${preset.id} blur`).toBe('0px');
    }
  });

  it('each preset is a DISTINCT design language, not just a recolour', () => {
    // Midnight (default) must keep the approved structural values exactly.
    const mid = resolveWidgetTheme({ themePreset: 'midnight' }).tokens;
    expect(mid['--w-radius-card']).toBe('8px');
    expect(mid['--w-card-shadow']).toBe('0 24px 60px -32px rgba(0,0,0,.75)');
    expect(mid['--w-label-transform']).toBe('none');
    // Cream (the other locked theme) also keeps defaults.
    expect(resolveWidgetTheme({ themePreset: 'cream' }).tokens['--w-radius-card']).toBe('8px');

    // Stone = small-radius + uppercase tracked labels; Cupertino =
    // large-soft + sentence-case; mono = moderate white-Uber shell.
    const stone = resolveWidgetTheme({ themePreset: 'stone' }).tokens;
    const cup = resolveWidgetTheme({ themePreset: 'cupertino' }).tokens;
    const mono = resolveWidgetTheme({ themePreset: 'mono' }).tokens;
    expect(stone['--w-radius-card']).toBe('5px');
    expect(stone['--w-label-transform']).toBe('uppercase');
    expect(cup['--w-radius-card']).toBe('20px');
    expect(cup['--w-label-transform']).toBe('none');
    expect(mono['--w-radius-card']).toBe('16px');
    expect(mono['--w-label-transform']).toBe('none');

    // The radius, shadow and label-transform genuinely VARY across the set —
    // the whole point of Wave 4 (guards against a future silent flattening).
    const radii = new Set(WIDGET_PRESET_LIST.map((p) => resolveWidgetTheme({ themePreset: p.id }).tokens['--w-radius-card']));
    const shadows = new Set(WIDGET_PRESET_LIST.map((p) => resolveWidgetTheme({ themePreset: p.id }).tokens['--w-card-shadow']));
    const transforms = new Set(WIDGET_PRESET_LIST.map((p) => resolveWidgetTheme({ themePreset: p.id }).tokens['--w-label-transform']));
    expect(radii.size).toBeGreaterThanOrEqual(5);
    expect(shadows.size).toBeGreaterThanOrEqual(6);
    expect(transforms.size).toBe(2); // 'none' and 'uppercase'
  });

  it('mono ("Clarity"/Uber) is a premium WHITE theme with the black active-border pattern', () => {
    const t = resolveWidgetTheme({ themePreset: 'mono' });
    expect(t.mode).toBe('light');
    // Premium white surfaces, high-contrast black text, solid black CTA/accent.
    expect(t.tokens['--w-surface']).toBe('#FFFFFF');
    expect(t.tokens['--w-page-bg']).toBe('#FFFFFF');
    expect(t.tokens['--w-text']).toBe('#111111');
    expect(t.tokens['--w-accent']).toBe('#111111');
    expect(t.tokens['--w-accent-text']).toBe('#FFFFFF'); // white label on the black CTA
    // Uber active/inactive control pattern: black active border, tinted borderless inactive.
    expect(t.tokens['--w-active-border-color']).toBe('#111111');
    expect(t.tokens['--w-active-border-width']).toBe('2.5px');
    expect(t.tokens['--w-chip-inactive-bg']).toBe('#F6F6F6');
    expect(t.tokens['--w-chip-inactive-border']).toBe('transparent');
    expect(t.tokens['--w-chip-active-bg']).toBe('#FFFFFF');
    expect(t.tokens['--w-chip-active-text']).toBe('#111111');
    // Ships its own default font (closest self-hosted match to Uber Move).
    expect(t.font).toBe('satoshi');
    expect(t.fontStack).toContain('Satoshi');
  });

  it('every OTHER preset keeps the current-look stateful-control defaults (unchanged)', () => {
    // Presets that ship a custom stateful-control pattern (mono/Uber,
    // ironhorse/Harley black-border, harbor/ride-app filled pill) are exempt;
    // the remaining presets must emit the neutral defaults so their tabs /
    // chips / flags render byte-for-byte as before (no border, input-surface
    // fill, solid-accent active chip).
    const CUSTOM_STATEFUL = new Set(['mono', 'ironhorse', 'harbor', 'booking', 'tesla', 'stripe', 'stone', 'citron', 'vault']);
    for (const preset of WIDGET_PRESET_LIST) {
      if (CUSTOM_STATEFUL.has(preset.id)) continue;
      const t = resolveWidgetTheme({ themePreset: preset.id });
      expect(t.tokens['--w-active-border-color'], `${preset.id}`).toBe('transparent');
      expect(t.tokens['--w-active-border-width'], `${preset.id}`).toBe('0');
      // Inactive fill/border mirror the input surface; active chip = solid accent.
      expect(t.tokens['--w-chip-inactive-bg'], `${preset.id}`).toBe(t.tokens['--w-input-bg']);
      expect(t.tokens['--w-chip-inactive-border'], `${preset.id}`).toBe(t.tokens['--w-input-border']);
      expect(t.tokens['--w-chip-active-bg'], `${preset.id}`).toBe(t.tokens['--w-accent-solid']);
      expect(t.tokens['--w-chip-active-text'], `${preset.id}`).toBe(t.tokens['--w-accent-text']);
    }
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

  it('every preset ships body text that reads on its surface (validates the lineup)', () => {
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

// ── Map-blend toggle ─────────────────────────────────────────────────
describe('resolveWidgetTheme — map blend', () => {
  it('defaults to off (existing tenants unchanged) and normalizes unknown values', () => {
    expect(resolveWidgetTheme(null).mapBlend).toBe(DEFAULT_MAP_BLEND);
    expect(resolveWidgetTheme(null).mapBlend).toBe('off');
    expect(resolveWidgetTheme({}).mapBlend).toBe('off');
    expect(resolveWidgetTheme({ mapBlend: 'sometimes' }).mapBlend).toBe('off');
    expect(resolveWidgetTheme({ mapBlend: null }).mapBlend).toBe('off');
  });

  it("passes 'on' through and supports every declared value", () => {
    expect(resolveWidgetTheme({ mapBlend: 'on' }).mapBlend).toBe('on');
    for (const v of MAP_BLEND_VALUES) {
      expect(resolveWidgetTheme({ mapBlend: v }).mapBlend).toBe(v);
    }
  });
});
