import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
async function read(rel: string) {
  return readFile(resolve(root, rel), 'utf8');
}

// The unified Customize workspace (Alex's directive) merges the Design controls
// and the tenant-editable Behaviour/copy controls into ONE tabbed page that
// shares a single live preview. The standalone Widget-settings page is retired.
// This suite guards that the behaviour/copy controls live in the Behavior tab
// (buildBehaviorPanel), that embedding stays on the Embed page, and that the
// retired route + nav item redirect cleanly instead of dangling.
describe('unified Customize workspace — Behavior tab merge', () => {
  it('exposes lead-capture, copy and powered-by controls in the Behavior panel (buildBehaviorPanel)', async () => {
    const js = await read('src/server/public/app.js');
    // The behaviour/copy controls now live in buildBehaviorPanel, mounted as the
    // Customize workspace's "Behavior" tab. Slice it between its own boundaries
    // (file order: buildBehaviorPanel → renderEmbed).
    const behaviorFn = js.slice(js.indexOf('function buildBehaviorPanel'), js.indexOf('function renderEmbed'));
    const embedFn = js.slice(js.indexOf('function renderEmbed'), js.indexOf('function renderAudit'));

    // Section header on the Behavior panel.
    expect(behaviorFn).toContain('Lead capture & copy');

    // Each re-homed brand_configs behaviour/copy field is wired in the panel.
    for (const key of [
      'requireEmail',
      'requirePhone',
      'showQuoteBeforeContact',
      'showPoweredBy',
      'ctaText',
      'footerNote',
    ]) {
      expect(behaviorFn).toContain(`'${key}'`);
    }

    // renderBrand mounts the Behavior panel + shares the one live preview.
    const brandFn = js.slice(js.indexOf('function renderBrand'), js.indexOf('function saveBrandPatch'));
    expect(brandFn).toContain('buildBehaviorPanel(behaviorPanel');
    // Saves still go through the existing brand PUT (shared saveBrandPatch).
    expect(js).toContain("api('/api/tenant/brand', { method: 'PUT'");

    // Embedding controls live on the Embed page.
    expect(embedFn).toContain('Widget settings — embedding');
    expect(embedFn).toContain("'allowedDomains'");
  });

  it('shares ONE live preview and never reloads the iframe (no-blink live-apply)', async () => {
    const js = await read('src/server/public/app.js');
    // The shared preview component both surfaces reuse.
    expect(js).toContain('function buildLivePreview');
    // Design edits push an instant, in-place patch; saves re-skin without reload.
    expect(js).toContain("qf: 'brand-preview'");
    expect(js).toContain("qf: 'brand-refetch'");
    // The old blink source (re-sourcing the iframe with a cache-buster) is gone.
    expect(js).not.toContain("'?_t=' + Date.now()");
    expect(js).not.toContain('function reloadPreview');
    // Widget applies the messages live (no iframe reload) in a preview context.
    const widget = await read('src/server/public/widget.js');
    expect(widget).toContain('applyBrandPreviewPatch');
    expect(widget).toContain('refetchAndReskin');
    expect(widget).toContain("e.data.qf === 'brand-preview'");
  });

  it('retires the standalone Widget-settings route + nav item (redirects into the Behavior tab)', async () => {
    const js = await read('src/server/public/app.js');
    const html = await read('src/server/public/app.html');
    // Route kept for old deep links, but it now opens the Customize Behavior tab.
    expect(js).toContain("return renderBrand(c, { tab: 'behavior' });");
    // The standalone renderer is gone.
    expect(js).not.toContain('function renderWidgetSettings');
    // No dangling nav item.
    expect(html).not.toContain('data-route="widget-settings"');
  });

  it('does NOT duplicate appearance controls (theme/accent/font/logo/company) on the Embed page', async () => {
    const js = await read('src/server/public/app.js');
    const embedFn = js.slice(js.indexOf('function renderEmbed'), js.indexOf('function renderAudit'));
    for (const appearance of ['themePreset', 'accentOverride', 'fontFamily', 'logoUrl', 'displayName']) {
      expect(embedFn).not.toContain(appearance);
    }
  });

  it('keeps the Design tab appearance-only (behaviour/copy live in the Behavior panel)', async () => {
    const js = await read('src/server/public/app.js');
    // Slice renderBrand up to the next helper (saveBrandPatch) — the Design
    // controls only. Behaviour/copy literals live in buildBehaviorPanel, not here.
    const brandFn = js.slice(js.indexOf('function renderBrand'), js.indexOf('function saveBrandPatch'));
    for (const key of ['requireEmail', 'requirePhone', 'showQuoteBeforeContact', 'ctaText', 'footerNote', 'allowedDomains', 'showPoweredBy']) {
      expect(brandFn).not.toContain(key);
    }
  });
});

describe('brand PUT gating + footer-note rendering', () => {
  it('plan-gates removing the Powered-by badge (Vital+), same tier as the logo', async () => {
    const ts = await read('src/server/routes/tenant.ts');
    expect(ts).toContain("patch.showPoweredBy === false");
    expect(ts).toContain("field: 'showPoweredBy'");
    // Reuses the shared core-plan check.
    expect(ts).toContain('const hasCore =');
  });

  it('renders the footer note in the public widget', async () => {
    const widgetJs = await read('src/server/public/widget.js');
    const widgetHtml = await read('src/server/public/widget.html');
    expect(widgetHtml).toContain('qf-footer-note');
    expect(widgetJs).toContain('cfg.brand.footerNote');
  });
});
