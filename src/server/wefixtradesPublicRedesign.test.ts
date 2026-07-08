import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('WeFixTrades-style public redesign', () => {
  it('mounts the redesigned public landing assets and structure', async () => {
    const html = await file('landing.html');

    expect(html).toContain('qf-wft');
    expect(html).toContain('/landing-wefixtrades.css');
    expect(html).toContain('Built for freight rate desks');
    expect(html).toContain('RatePage™');
    expect(html).toContain('QuoteDoc™');
    expect(html).toContain('RateDesk™');
    expect(html).toContain('Start free — no card');
    expect(html).toContain('wft-footer-grid');
  });

  it('keeps the WeFixTrades visual system tokens available', async () => {
    const css = await file('landing-wefixtrades.css');

    expect(css).toContain('Phase BP');
    expect(css).toContain('WeFixTrades-style public website redesign');
    expect(css).toContain('--qf-wft-blue: #0d3cfc');
    expect(css).toContain('--qf-wft-footer: #22282a');
    expect(css).toContain('.wft-product-card.large');
    expect(css).toContain('.wft-footer-grid');
    expect(css).toContain('JetBrains Mono');
  });
});
