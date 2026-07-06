import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('accessorial UI polish', () => {
  it('loads accessorial assets from app shell', async () => {
    const html = await file('app.html');
    expect(html).toContain('/accessorial-search.css');
    expect(html).toContain('/accessorial-search.js');
  });

  it('adds accessorial search classes and scanner styling', async () => {
    const js = await file('accessorial-search.js');
    const css = await file('accessorial-search.css');

    expect(js).toContain('qf-accessorial-searchbar');
    expect(js).toContain('qf-accessorial-search-hidden');
    expect(js).toContain('accessorials');

    expect(css).toContain('Phase BB');
    expect(css).toContain('.qf-accessorial-searchbar');
    expect(css).toContain('.qf-acc-tools');
    expect(css).toContain('.qf-acc-filters');
  });
});
