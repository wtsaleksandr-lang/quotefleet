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
  // Context foregrounds — contrast-audit fixes (footer / hints / result card /
  // active tab), each engine-guaranteed ≥ AA on its own rendered surface.
  '--w-footer-text', '--w-hint-text',
  '--w-oncard-text', '--w-oncard-muted', '--w-oncard-accent',
  '--w-tab-active-text',
] as const;

const HEX6 = /^#[0-9a-fA-F]{6}$/;

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

  it('resolves the Cream (now matte-slate DARK) theme with near-white text', () => {
    const t = resolveWidgetTheme({ themePreset: 'cream' });
    expect(t.mode).toBe('dark');
    expect(t.tokens['--w-text']).toBe('#F5F7FA');
    expect(t.tokens['--w-page-bg']).toBe('#16181D');
    expect(t.tokens['--w-accent']).toBe('#0D3CFC');
    // Near-white body text clears WCAG AA on the dark card surface.
    expect(contrastRatio(t.tokens['--w-text'], t.tokens['--w-surface'])).toBeGreaterThanOrEqual(WCAG.NORMAL);
    // Dark theme: the accent-surface border mirrors the accent surface itself.
    expect(t.tokens['--w-accent-surface-border']).toBe(t.tokens['--w-accent-surface']);
  });

  it('applies a custom accent override on top of the preset', () => {
    const t = resolveWidgetTheme({ themePreset: 'citron', accentOverride: '#8A2BE2' });
    expect(t.accentOverride).toBe('#8A2BE2');
    expect(t.tokens['--w-accent']).toBe('#8A2BE2');
    expect(t.tokens['--w-primary']).toBe('#8A2BE2');
    // Non-accent tokens stay from the base preset (Citron off-white page).
    expect(t.tokens['--w-page-bg']).toBe('#F8F8F8');
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

  it('exposes exactly five presets and eight fonts', () => {
    expect(WIDGET_PRESET_LIST.map((p) => p.id)).toEqual([
      'midnight', 'mono', 'citron', 'vault', 'cream',
    ]);
    expect(Object.keys(WIDGET_FONTS).sort()).toEqual(
      ['clashdisplay', 'dmsans', 'inter', 'oswald', 'roboto', 'satoshi', 'sora', 'system'],
    );
    expect(WIDGET_PRESETS.midnight.mode).toBe('dark');
    // Clarity (mono/Uber) is a premium WHITE light theme.
    expect(WIDGET_PRESETS.mono.mode).toBe('light');
    // Citron (lime) + Vault (cream fintech) are both LIGHT themes.
    expect(WIDGET_PRESETS.citron.mode).toBe('light');
    expect(WIDGET_PRESETS.vault.mode).toBe('light');
    // Cream is now a premium matte-slate DARK theme (was light).
    expect(WIDGET_PRESETS.cream.mode).toBe('dark');
    // A balanced light + dark lineup (2 dark, 3 light).
    expect(WIDGET_PRESET_LIST.filter((p) => p.mode === 'dark')).toHaveLength(2);
    expect(WIDGET_PRESET_LIST.filter((p) => p.mode === 'light')).toHaveLength(3);
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

  it('no remaining preset is frosted — every preset emits its opaque surface + 0px blur', () => {
    for (const preset of WIDGET_PRESET_LIST) {
      const t = resolveWidgetTheme({ themePreset: preset.id });
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

    // mono = moderate white-Uber shell; vault = soft large-radius fintech;
    // citron = soft editorial shell — each a distinct radius/shadow.
    const vault = resolveWidgetTheme({ themePreset: 'vault' }).tokens;
    const citron = resolveWidgetTheme({ themePreset: 'citron' }).tokens;
    const mono = resolveWidgetTheme({ themePreset: 'mono' }).tokens;
    expect(vault['--w-radius-card']).toBe('18px');
    expect(vault['--w-label-transform']).toBe('none');
    expect(citron['--w-radius-card']).toBe('16px');
    expect(citron['--w-label-transform']).toBe('none');
    expect(mono['--w-radius-card']).toBe('16px');
    expect(mono['--w-label-transform']).toBe('none');

    // The radius + shadow genuinely VARY across the set — the whole point of
    // Wave 4 (guards against a future silent flattening). Every remaining preset
    // uses sentence-case labels, so label-transform is uniformly 'none'.
    const radii = new Set(WIDGET_PRESET_LIST.map((p) => resolveWidgetTheme({ themePreset: p.id }).tokens['--w-radius-card']));
    const shadows = new Set(WIDGET_PRESET_LIST.map((p) => resolveWidgetTheme({ themePreset: p.id }).tokens['--w-card-shadow']));
    const transforms = new Set(WIDGET_PRESET_LIST.map((p) => resolveWidgetTheme({ themePreset: p.id }).tokens['--w-label-transform']));
    expect(radii.size).toBeGreaterThanOrEqual(3);
    expect(shadows.size).toBeGreaterThanOrEqual(3);
    expect(transforms.size).toBe(1); // all remaining presets are sentence-case
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
    // citron/lime, vault/cream fintech) are exempt; the remaining presets
    // (midnight, cream) must emit the neutral defaults so their tabs /
    // chips / flags render byte-for-byte as before (no border, input-surface
    // fill, solid-accent active chip).
    const CUSTOM_STATEFUL = new Set(['mono', 'citron', 'vault']);
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

  it('context foregrounds clear WCAG AA on their OWN surface for every preset', () => {
    // These tokens fix the axe-core contrast audit: each renders over a surface
    // the shell-level muted/text tokens can't safely carry.
    for (const preset of WIDGET_PRESET_LIST) {
      const t = resolveWidgetTheme({ themePreset: preset.id }).tokens;
      // Footer ("Powered by") sits on the page background. booking/tesla express
      // muted as translucent rgba() (unmeasurable + already AA on their dark
      // page), so only assert the solid-hex footer values (the presets we fixed).
      if (HEX6.test(t['--w-footer-text'])) {
        const r = contrastRatio(t['--w-footer-text'], t['--w-page-bg']);
        expect(r, `${preset.id}: footer ${t['--w-footer-text']} on page ${t['--w-page-bg']} = ${r.toFixed(2)}`)
          .toBeGreaterThanOrEqual(WCAG.NORMAL);
      }
      // Field hints on the tinted surface-2 panels.
      const rHint = contrastRatio(t['--w-hint-text'], t['--w-surface-2']);
      expect(rHint, `${preset.id}: hint ${t['--w-hint-text']} on surface-2 ${t['--w-surface-2']} = ${rHint.toFixed(2)}`)
        .toBeGreaterThanOrEqual(WCAG.NORMAL);
      // Result-card foregrounds on --w-input-bg (light even on dark Midnight).
      for (const key of ['--w-oncard-text', '--w-oncard-muted', '--w-oncard-accent'] as const) {
        const r = contrastRatio(t[key], t['--w-input-bg']);
        expect(r, `${preset.id}: ${key} ${t[key]} on card ${t['--w-input-bg']} = ${r.toFixed(2)}`)
          .toBeGreaterThanOrEqual(WCAG.NORMAL);
      }
      // Active service-tab label on the sliding indicator's default fill.
      const rTab = contrastRatio(t['--w-tab-active-text'], t['--w-accent-surface']);
      expect(rTab, `${preset.id}: tab-text ${t['--w-tab-active-text']} on indicator ${t['--w-accent-surface']} = ${rTab.toFixed(2)}`)
        .toBeGreaterThanOrEqual(WCAG.NORMAL);
    }
  });

  it('Midnight result-card text stays legible on its CREAM card (was 1.4:1)', () => {
    // Midnight is a DARK theme whose result card paints the light cream input
    // surface; its light shell muted (#B1C5CE) was illegible there. The oncard
    // tokens must read on the cream card, NOT match the shell muted.
    const t = resolveWidgetTheme({ themePreset: 'midnight' }).tokens;
    expect(t['--w-input-bg']).toBe('#E6E3E0');
    expect(contrastRatio(t['--w-oncard-muted'], '#E6E3E0')).toBeGreaterThanOrEqual(WCAG.NORMAL);
    expect(t['--w-oncard-muted']).not.toBe(t['--w-muted']);
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
    // White on the Cream (now dark) surface passes → applied to body text.
    const t = resolveWidgetTheme({ themePreset: 'cream', fontColor: '#FFFFFF' });
    expect(t.fontColor).toBe('#FFFFFF');
    expect(t.tokens['--w-text']).toBe('#FFFFFF');
    expect(contrastRatio(t.tokens['--w-text'], t.tokens['--w-surface'])).toBeGreaterThanOrEqual(WCAG.NORMAL);
  });

  it('falls back to the safe auto colour on any surface the choice would fail', () => {
    // Charcoal on the Cream (now dark) surface FAILS → body text must NOT be charcoal.
    const t = resolveWidgetTheme({ themePreset: 'cream', fontColor: '#141414' });
    expect(t.tokens['--w-text']).not.toBe('#141414');
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
