import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveWidgetTheme, WIDGET_PRESETS, WIDGET_FONTS } from './widgetThemes.js';

const root = process.cwd();
const publicDir = resolve(root, 'src/server/public');

async function read(path: string) {
  return readFile(resolve(root, path), 'utf8');
}
async function pub(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('customize panel — brand endpoint (Wave 2 theming fields)', () => {
  it('accepts theme_preset / accent_override / font_family in the brand PUT schema', async () => {
    const src = await read('src/server/routes/tenant.ts');
    // BrandPatch validates the new fields against the theme engine's lists.
    expect(src).toContain('themePreset: z.enum(PRESET_IDS)');
    expect(src).toContain('fontFamily: z.enum(FONT_IDS)');
    expect(src).toContain('accentOverride');
    expect(src).toContain('#[0-9a-fA-F]{6}'); // hex-or-null validation
    // GET returns option lists derived from widgetThemes (single source).
    expect(src).toContain('WIDGET_PRESET_LIST.map');
    expect(src).toContain('presets, fonts');
    // logo data-URLs are size-capped server-side.
    expect(src).toContain('MAX_LOGO_CHARS');
  });

  it('preset + font ids the panel writes all resolve in the theme engine', () => {
    // Every id the endpoint validates against must round-trip through the
    // Wave 1 resolver without falling back — guards drift between panel + engine.
    for (const presetId of Object.keys(WIDGET_PRESETS)) {
      for (const fontId of Object.keys(WIDGET_FONTS)) {
        const t = resolveWidgetTheme({ themePreset: presetId, fontFamily: fontId });
        expect(t.preset).toBe(presetId);
        expect(t.font).toBe(fontId);
      }
    }
    // A custom accent override supersedes the preset accent.
    const withAccent = resolveWidgetTheme({ themePreset: 'midnight', accentOverride: '#7C3AED' });
    expect(withAccent.tokens['--w-accent'].toLowerCase()).toBe('#7c3aed');
    // Null accent falls back to the preset accent.
    const noAccent = resolveWidgetTheme({ themePreset: 'midnight', accentOverride: null });
    expect(noAccent.tokens['--w-accent']).toBe(WIDGET_PRESETS.midnight.palette.accent);
  });
});

describe('customize panel — dashboard UI', () => {
  it('renders a single-purpose Customize page with presets, accent, font, logo + live preview', async () => {
    const js = await pub('app.js');
    expect(js).toContain('Customize your calculator');
    expect(js).toContain('qf-customize');
    expect(js).toContain('qf-cz-preset');          // theme preset cards
    expect(js).toContain('qf-cz-swatch');          // accent swatches
    expect(js).toContain('accentOverride: null');  // "Use theme default"
    expect(js).toContain('qf-cz-select');          // font dropdown
    expect(js).toContain('qf-cz-dropzone');        // drag-drop logo
    expect(js).toContain("canvas.toDataURL");      // client downscale
    expect(js).toContain('qf-cz-frame');           // live preview iframe
    expect(js).toContain("'/w/' + encodeURIComponent(slug)"); // preview of real widget
  });

  it('ships the customize stylesheet with the scoped clutter suppressor', async () => {
    const html = await pub('app.html');
    expect(html).toContain('/customize-panel.css');
    const css = await pub('customize-panel.css');
    expect(css).toContain('.qf-customize');
    // Suppressor is scoped to the customize page and hides the legacy noise.
    expect(css).toContain('#page-content:has(.qf-customize) .qf-share-readiness');
    expect(css).toContain('#page-content:has(.qf-customize) .qf-onboarding-panel');
    expect(css).toContain('#page-content:has(.qf-customize) .qf-brand-editor');
  });

  it('de-clutters the brand route in the shared injector scripts', async () => {
    const setup = await pub('dashboard-setup.js');
    expect(setup).toContain("route !== 'brand'");
    const share = await pub('share-readiness.js');
    expect(share).toContain("if (route() === 'brand') return;");
    const preview = await pub('dashboard-preview.js');
    // 'brand' removed from the preview-card route list.
    expect(preview).not.toContain("'zones', 'brand', 'ai'");
    // Brand-only mock injectors are retired (early return retained strings).
    const editor = await pub('brand-editor.js');
    expect(editor).toMatch(/if \(!content\) return;\s*\n[\s\S]*?\n\s*return;/);
    const studio = await pub('brand-studio-preview.js');
    expect(studio).toMatch(/function mount\(\) \{\s*\n[\s\S]*?\n\s*return;/);
  });
});
