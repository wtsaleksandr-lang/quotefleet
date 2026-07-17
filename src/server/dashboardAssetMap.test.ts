import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');
const rootDir = process.cwd();

async function read(path: string) {
  return readFile(resolve(rootDir, path), 'utf8');
}

function expectOrdered(source: string, assets: string[]) {
  let cursor = -1;
  for (const asset of assets) {
    const next = source.indexOf(asset);
    expect(next, `${asset} should be present`).toBeGreaterThan(-1);
    expect(next, `${asset} should appear after previous asset`).toBeGreaterThan(cursor);
    cursor = next;
  }
}

describe('dashboard asset map', () => {
  it('documents the dashboard asset layers', async () => {
    const doc = await read('docs/dashboard-asset-map.md');
    expect(doc).toContain('QuoteFleet dashboard asset map');
    expect(doc).toContain('/premium-palette.css');
    expect(doc).toContain('/premium-saas-polish.js');
    expect(doc).toContain('Maintenance rules');
  });

  it('keeps app asset load order intentional', async () => {
    const html = await readFile(resolve(publicDir, 'app.html'), 'utf8');
    // premium-palette.css was removed from the dashboard: its teal light/dark
    // theme overrode style.css's WeFixTrades tokens on /app + /admin. The
    // dashboard now shares style.css's palette with the public site.
    expect(html).not.toContain('/premium-palette.css');
    expectOrdered(html, [
      '/style.css',
      '/dashboard-polish.css',
      '/dashboard-setup.css',
      '/dashboard-preview.css',
      '/rate-builder.css',
      '/setup-builder.css',
      '/brand-editor.css',
      '/ai-setup.css',
      '/premium-saas-polish.css',
      '/app-quote-actions.css',
    ]);
    // Retired (portal simplification): the dashboard-setup, dashboard-preview,
    // rate-builder, setup-builder, brand-editor, and ai-setup JS layers were
    // removed from the shell (their stylesheets remain linked above). The
    // remaining scripts must still load in this intentional order.
    expectOrdered(html, [
      '/app.js',
      '/premium-saas-polish.js',
      '/app-quote-actions.js',
      '/app-quote-activity.js',
      '/app-accessorial-tools.js',
      '/app-carrier-profile.js',
    ]);
    // The retired builder JS layers must not be re-added to the shell.
    for (const retired of [
      '/dashboard-setup.js',
      '/dashboard-preview.js',
      '/rate-builder.js',
      '/setup-builder.js',
      '/brand-editor.js',
      '/ai-setup.js',
    ]) {
      expect(html, `${retired} should stay retired`).not.toContain(retired);
    }
  });
});
