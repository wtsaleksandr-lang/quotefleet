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

describe('customize panel — header logo fill (compact vs full-width)', () => {
  it('validates + persists headerLogoFill as a half|full enum in the brand PUT', async () => {
    const src = await read('src/server/routes/tenant.ts');
    // Enum-validated in BrandPatch, so only the two allowed values persist.
    expect(src).toContain("headerLogoFill: z.enum(['half', 'full']).optional()");
    // BrandPatch column fields spread straight into the update `set` — the
    // field needs no bespoke persistence code, so this is all that's required.
    expect(src).toContain('const set: Record<string, unknown> = { ...columnPatch');
  });

  it('adds a Compact / Full-width control on the appearance-only Customize page', async () => {
    const js = await pub('app.js');
    // Lives in renderBrand's Design tab (appearance). Slice renderBrand up to
    // the next helper (saveBrandPatch) so we capture only the Design controls,
    // not the merged Behavior panel (buildBehaviorPanel) it also mounts.
    const brandFn = js.slice(js.indexOf('function renderBrand'), js.indexOf('function saveBrandPatch'));
    expect(brandFn).toContain('Header logo');
    expect(brandFn).toContain("data-logofill");
    expect(brandFn).toContain("queueSave({ headerLogoFill: o.id }, true)");
    // Reads the saved value to seed the current selection.
    expect(brandFn).toContain('b.headerLogoFill');
  });

  it('renders the logo-fill attribute + robust contain-fit in the public widget', async () => {
    const widgetJs = await pub('widget.js');
    const css = await pub('widget-ux-fixes.css');
    // The widget stamps the mode onto the header bar.
    expect(widgetJs).toContain("h.setAttribute('data-logo-fill'");
    expect(widgetJs).toContain("cfg.brand.headerLogoFill === 'full'");
    // CSS fits ANY logo without cropping/distortion (object-fit:contain) and
    // switches the max-width budget per mode; full hides the redundant name.
    expect(css).toContain('object-fit: contain');
    expect(css).toContain('.qf-header[data-logo-fill="half"] img');
    expect(css).toContain('.qf-header[data-logo-fill="full"] img');
    expect(css).toContain('.qf-header[data-logo-fill="full"] .brand-name');
  });
});

describe('customize panel — confirm-rate CTA (customizable claim button)', () => {
  it('persists claim_cta_text as a nullable brand_configs column', async () => {
    const schema = await read('src/db/schema.ts');
    // Nullable (no default) so the widget owns the fallback copy; kept separate
    // from cta_text (the calculate button) so both CTAs edit independently.
    expect(schema).toContain("claimCtaText: text('claim_cta_text')");
  });

  it('adds a NEW idempotent migration registered in the boot-migrator journal', async () => {
    const mig = await read('drizzle/0036_claim_cta_text.sql');
    expect(mig).toContain('ADD COLUMN IF NOT EXISTS "claim_cta_text" text');
    const journal = await read('drizzle/meta/_journal.json');
    expect(journal).toContain('0036_claim_cta_text');
  });

  it('validates claimCtaText (nullable) in the brand PUT schema', async () => {
    const src = await read('src/server/routes/tenant.ts');
    // Nullable string so null clears back to the default; spreads into the
    // update `set` via columnPatch like every other scalar brand field (so a
    // GET→PUT→GET round-trip persists it with no bespoke code).
    expect(src).toContain('claimCtaText: z.string().max(120).nullable().optional()');
    expect(src).toContain('const set: Record<string, unknown> = { ...columnPatch');
    // GET returns the whole brand row, so the saved value round-trips back.
    expect(src).toContain('brand: row[0] ?? null');
  });

  it('adds a Confirm-rate button label control beside the CTA text field', async () => {
    const js = await pub('app.js');
    expect(js).toContain("brandSettingField(b, 'Confirm-rate button', 'claimCtaText'");
    expect(js).toContain('Get the rate confirmed'); // the placeholder / new default
  });

  it('applies the customizable label (default + variant) on the public widget', async () => {
    const widgetJs = await pub('widget.js');
    // A saved claimCtaText wins; else the new default, or the show-price variant.
    expect(widgetJs).toContain('brand.claimCtaText');
    expect(widgetJs).toContain("'Get the rate confirmed'");
    expect(widgetJs).toContain("'Claim this quote →'");
    // The old hardcoded string is gone.
    expect(widgetJs).not.toContain('Get this quote in writing');
    // Live-preview no-blink path carries the field.
    expect(widgetJs).toContain("'showQuoteBeforeContact', 'claimCtaText'");
  });

  it('unfolds the contact form inline below the result instead of a step jump', async () => {
    const widgetJs = await pub('widget.js');
    const html = await pub('widget.html');
    const css = await pub('widget-motion.css');
    // The CTA now unfolds the drawer instead of switching steps.
    expect(widgetJs).toContain('openInlineContact()');
    expect(widgetJs).toContain('function openInlineContact');
    expect(widgetJs).toContain('function closeInlineContact');
    // Reuses the shared premium fold + reduced-motion aware helper.
    expect(widgetJs).toContain('animateFold(drawer, true)');
    // The contact form lives inside the result card as a folding drawer, and the
    // old separate contact step is gone.
    expect(html).toContain('id="qf-inline-contact"');
    expect(html).not.toContain('id="qf-step-contact"');
    // Drawer styling: eased reveal + hide the redundant CTA while open.
    expect(css).toContain('.qf-inline-contact');
    expect(css).toContain('.qf-result.qf-contact-open #qf-continue-btn { display: none; }');
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

describe('customize panel — map-blend opacity slider (persist + UI + setup meter)', () => {
  it('accepts mapBlendOpacity (0–100) in the brand PUT schema', async () => {
    const src = await read('src/server/routes/tenant.ts');
    // The 0–100 intensity supersedes the binary toggle. The legacy mapBlend enum
    // is still accepted for backward-compat (both wired into BrandPatch).
    expect(src).toContain('mapBlendOpacity: z.number().int().min(0).max(100)');
    expect(src).toContain('MAP_BLEND_VALUES');
    expect(src).toContain('mapBlend: z.enum([...MAP_BLEND_VALUES]');
  });

  it('persists map_blend_opacity as a real brand_configs column with a safe default', async () => {
    const schema = await read('src/db/schema.ts');
    // notNull default 0 = OFF — existing tenants render the map exactly as before.
    expect(schema).toContain("mapBlendOpacity: integer('map_blend_opacity').notNull().default(0)");
    // The legacy on/off column is retained (the on/off master is derived from it +
    // the new opacity).
    expect(schema).toContain("mapBlend: text('map_blend').notNull().default('off')");
    // A NEW migration adds the column (idempotent) and backfills legacy 'on' → 60
    // so a fresh prod deploy doesn't 500 and blended tenants keep blending.
    const mig = await read('drizzle/0033_map_blend_opacity.sql');
    expect(mig).toContain('ADD COLUMN IF NOT EXISTS "map_blend_opacity" integer NOT NULL DEFAULT 0');
    expect(mig).toContain('SET "map_blend_opacity" = 60 WHERE "map_blend" = \'on\'');
    // The original on/off migration is still present.
    const legacyMig = await read('drizzle/0022_brand_map_blend.sql');
    expect(legacyMig).toContain('ADD COLUMN IF NOT EXISTS "map_blend" text NOT NULL DEFAULT \'off\'');
    // Both are registered in the boot-migrator journal.
    const journal = await read('drizzle/meta/_journal.json');
    expect(journal).toContain('0022_brand_map_blend');
    expect(journal).toContain('0033_map_blend_opacity');
  });

  it('renders a Map-blend opacity slider that saves through the brand PUT', async () => {
    const js = await pub('app.js');
    expect(js).toContain('Map blend');
    // A 0–100 range input, not an on/off chip.
    expect(js).toContain("type: 'range', min: '0', max: '100'");
    expect(js).toContain('queueSave({ mapBlendOpacity: v }');
    // Backward-compat: legacy mapBlend='on' rows open at 60%.
    expect(js).toContain("(b.mapBlend === 'on' ? 60 : 0)");
  });

  it('the setup-status Brand step counts the Customize panel theming columns', async () => {
    const src = await read('src/server/routes/tenant.ts');
    // brandConfigured now also credits any non-default theming (preset/accent/
    // font/map style/CTA hover/text color/map blend + opacity), not just logo/name.
    expect(src).toContain('themeCustomized');
    expect(src).toContain("(brand.themePreset ?? 'midnight') !== 'midnight'");
    expect(src).toContain("(brand.mapBlend ?? 'off') !== 'off'");
    expect(src).toContain('(brand.mapBlendOpacity ?? 0) > 0');
    expect(src).toContain("(brand.ctaHover ?? 'border') !== 'border'");
    expect(src).toContain("(brand.fontColor ?? 'auto') !== 'auto'");
    expect(src).toContain('brand.mapStyle');
    expect(src).toContain('brand.accentOverride');
    // …and it's OR-ed into the final brand-configured decision.
    expect(src).toContain('themeCustomized);');
  });
});

describe('customize panel — drag-scroll carousels (theme presets + map styles)', () => {
  it('wraps both selectors in a single reusable makeCarousel helper', async () => {
    const js = await pub('app.js');
    expect(js).toContain('function makeCarousel(track)');
    // Both selectors go through it (consistent interaction).
    expect(js).toContain('themeSec.appendChild(makeCarousel(grid))');
    expect(js).toContain('mapSec.appendChild(makeCarousel(mapRow))');
    // Subtle prev/next arrows + a scrollable track.
    expect(js).toContain('qf-cz-carousel-arrow qf-cz-carousel-prev');
    expect(js).toContain('qf-cz-carousel-arrow qf-cz-carousel-next');
    expect(js).toContain('qf-cz-carousel-track');
    // Drag distinguished from a tap so click-to-select still fires.
    expect(js).toContain("track.classList.add('is-grabbing')");
    // A movement threshold distinguishes a drag from a tap; on a drag the
    // trailing click is suppressed so click-to-select only fires on a real tap.
    expect(js).toContain('DRAG_THRESHOLD');
    expect(js).toContain('if (moved > DRAG_THRESHOLD) { e.stopPropagation(); e.preventDefault(); }');
  });

  it('ships the carousel + slider styling (scrollable strip, hidden bar, arrows)', async () => {
    const css = await pub('customize-panel.css');
    expect(css).toContain('.qf-cz-carousel-track');
    expect(css).toContain('overflow-x: auto');
    expect(css).toContain('flex-wrap: nowrap');
    expect(css).toContain('scroll-snap-type: x proximity');
    expect(css).toContain('.qf-cz-carousel-arrow');
    expect(css).toContain('.qf-cz-blend-slider');
  });
});

describe('customize panel — guided-editing pointer (active arrow + preview align)', () => {
  it('maps each Design container to a widget section + activates one at a time', async () => {
    const js = await pub('app.js');
    // Containers are tagged with the widget section they govern…
    expect(js).toContain('data-preview-target');
    expect(js).toContain("[company, 'header']");
    expect(js).toContain("[mapSec, 'map']");
    expect(js).toContain("[blendSec, 'map']");
    // …click + focus mark exactly one container active (via .is-cz-active).
    expect(js).toContain("leftCol.addEventListener('click', onActivate)");
    expect(js).toContain("leftCol.addEventListener('focusin', onActivate)");
    expect(js).toContain("classList.toggle('is-cz-active', s === sec)");
    expect(js).toContain("closest('.qf-cz-section[data-preview-target]')");
    // The floating arrow element is appended to each targeted container.
    expect(js).toContain("class: 'qf-cz-arrow'");
  });

  it('scroll-aligns the preview via the SAME-ORIGIN iframe doc, guarded', async () => {
    const js = await pub('app.js');
    // alignTo is exposed by the live preview and reads the widget section from
    // the same-origin iframe document, guarded so cross-origin/missing no-ops.
    expect(js).toContain('alignTo: alignTo');
    expect(js).toContain('preview.alignTo(sec.getAttribute(\'data-preview-target\'), sec)');
    expect(js).toContain('iframe.contentDocument');
    expect(js).toContain('function alignTo(key, containerEl)');
    // Reduced-motion aware smooth scroll of the preview viewport.
    expect(js).toContain('behavior: czReduce ? \'auto\' : \'smooth\'');
  });

  it('ships the arrow + fixed-height scroll-viewport styling', async () => {
    const css = await pub('customize-panel.css');
    // The preview frame is a fixed-height, internally-scrollable viewport.
    expect(css).toContain('overflow-y: auto');
    expect(css).toContain('.qf-cz-section.is-cz-active .qf-cz-arrow');
    expect(css).toContain('.qf-cz-arrow');
    // Token-only accent styling (no raw hex) + reduced-motion guard.
    expect(css).toContain('background: var(--accent-soft)');
    expect(css).toContain('@keyframes qf-cz-arrow-nudge');
  });
});
