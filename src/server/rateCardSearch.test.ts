import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('rate card UI polish', () => {
  it('loads rate card assets from app shell', async () => {
    const html = await file('app.html');
    expect(html).toContain('/rate-card-search.css');
    expect(html).toContain('/rate-card-search.js');
  });

  it('adds rate card search classes and styling', async () => {
    const js = await file('rate-card-search.js');
    const css = await file('rate-card-search.css');

    expect(js).toContain('qf-rate-searchbar');
    expect(js).toContain('qf-rate-search-hidden');
    expect(js).toContain('/app/rates');

    expect(css).toContain('Phase BA');
    expect(css).toContain('.qf-rate-searchbar');
    expect(css).toContain('.qf-rate-search-hidden');
    expect(css).toContain('.qf-rate-search-count');
  });
});
