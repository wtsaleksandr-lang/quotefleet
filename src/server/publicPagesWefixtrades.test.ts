import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('WeFixTrades-style secondary public pages', () => {
  it('mounts the shared public page skin on pricing and support', async () => {
    const pricing = await file('pricing.html');
    const support = await file('support.html');

    expect(pricing).toContain('/public-pages-wefixtrades.css');
    expect(pricing).toContain('qf-public-wft');
    expect(support).toContain('/public-pages-wefixtrades.css');
    expect(support).toContain('qf-public-wft');
  });

  it('keeps the shared public page skin available', async () => {
    const css = await file('public-pages-wefixtrades.css');

    expect(css).toContain('Phase BQ');
    expect(css).toContain('--qf-wft-blue: #0d3cfc');
    expect(css).toContain('.price-card.featured');
    expect(css).toContain('.support-card');
  });
});
