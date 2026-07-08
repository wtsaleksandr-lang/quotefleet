import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('WeFixTrades-style secondary public pages', () => {
  it('mounts the shared public page skin on pricing, support, and security', async () => {
    const pricing = await file('pricing.html');
    const support = await file('support.html');
    const security = await file('security.html');

    expect(pricing).toContain('/public-pages-wefixtrades.css');
    expect(pricing).toContain('qf-public-wft');
    expect(support).toContain('/public-pages-wefixtrades.css');
    expect(support).toContain('qf-public-wft');
    expect(security).toContain('/public-pages-wefixtrades.css');
    expect(security).toContain('qf-public-wft');
  });

  it('keeps the shared public page skin available', async () => {
    const css = await file('public-pages-wefixtrades.css');

    expect(css).toContain('Phase BQ');
    expect(css).toContain('/quotefleet-color-system.css');
    expect(css).toContain('--qf-wft-blue: #0D3CFC');
    expect(css).toContain('#181D1F');
    expect(css).toContain('#22282A');
    expect(css).toContain('#E4EDF1');
    expect(css).toContain('#B1C5CE');
    expect(css).toContain('.price-card.featured');
    expect(css).toContain('.support-card');
    expect(css).toContain('.sec-shell');
  });
});
