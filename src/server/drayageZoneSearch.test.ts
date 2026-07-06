import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('drayage zone UI polish', () => {
  it('loads drayage zone assets from app shell', async () => {
    const html = await file('app.html');
    expect(html).toContain('/drayage-zone-search.css');
    expect(html).toContain('/drayage-zone-search.js');
  });

  it('adds drayage zone search classes and styling', async () => {
    const js = await file('drayage-zone-search.js');
    const css = await file('drayage-zone-search.css');

    expect(js).toContain('qf-zone-searchbar');
    expect(js).toContain('qf-zone-search-hidden');
    expect(js).toContain('/app/zones');

    expect(css).toContain('Phase BC');
    expect(css).toContain('.qf-zone-searchbar');
    expect(css).toContain('.qf-zone-search-hidden');
    expect(css).toContain('html[data-theme="light"] .qf-zone-health');
  });
});
