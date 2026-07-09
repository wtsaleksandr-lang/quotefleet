import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
async function read(rel: string) {
  return readFile(resolve(root, rel), 'utf8');
}

// The "stupid-simple" Customize rebuild dropped the tenant-editable widget
// behaviour/copy controls from the UI (their brand_configs columns still
// exist). This suite guards that they were re-homed onto the Embed page and
// that the Customize page did NOT re-absorb them.
describe('widget settings re-homed onto the Embed page', () => {
  it('exposes lead-capture, copy, powered-by and embedding controls in renderEmbed', async () => {
    const js = await read('src/server/public/app.js');
    const embedFn = js.slice(js.indexOf('function renderEmbed'), js.indexOf('function renderAudit'));

    // Section headers
    expect(embedFn).toContain('Widget settings — lead capture & copy');
    expect(embedFn).toContain('Widget settings — embedding');

    // Each re-exposed brand_configs field is wired in the embed surface.
    for (const key of [
      'requireEmail',
      'requirePhone',
      'showQuoteBeforeContact',
      'showPoweredBy',
      'ctaText',
      'footerNote',
      'allowedDomains',
    ]) {
      expect(embedFn).toContain(`'${key}'`);
    }

    // Saves go through the existing brand PUT.
    expect(embedFn).toContain("api('/api/tenant/brand', { method: 'PUT'");
    // Embed page must also fetch the brand config to seed the controls.
    expect(embedFn).toContain("api('/api/tenant/brand')");
  });

  it('does NOT duplicate appearance controls (theme/accent/font/logo/company) on the Embed page', async () => {
    const js = await read('src/server/public/app.js');
    const embedFn = js.slice(js.indexOf('function renderEmbed'), js.indexOf('function renderAudit'));
    for (const appearance of ['themePreset', 'accentOverride', 'fontFamily', 'logoUrl', 'displayName']) {
      expect(embedFn).not.toContain(appearance);
    }
  });

  it('keeps the Customize page appearance-only (no behaviour/copy controls)', async () => {
    const js = await read('src/server/public/app.js');
    const brandFn = js.slice(js.indexOf('function renderBrand'), js.indexOf('function renderEmbed'));
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
