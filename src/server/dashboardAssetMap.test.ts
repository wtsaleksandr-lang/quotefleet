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
    expectOrdered(html, [
      '/style.css',
      '/premium-palette.css',
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
    expectOrdered(html, [
      '/app.js',
      '/premium-saas-polish.js',
      '/dashboard-setup.js',
      '/dashboard-preview.js',
      '/rate-builder.js',
      '/setup-builder.js',
      '/brand-editor.js',
      '/ai-setup.js',
      '/app-quote-actions.js',
      '/app-quote-activity.js',
      '/app-accessorial-tools.js',
      '/app-carrier-profile.js',
    ]);
  });
});
