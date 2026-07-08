import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('landing WeFixTrades cleanup skin', () => {
  it('loads the final cleanup stylesheet from the landing script', async () => {
    const js = await file('landing-motion.js');

    expect(js).toContain('/landing-wefixtrades-cleanup.css');
    expect(js).toContain('document.head.appendChild(link)');
  });

  it('forces blue contrast and removes noisy teal/green landing artifacts', async () => {
    const css = await file('landing-wefixtrades-cleanup.css');

    expect(css).toContain('Phase BU');
    expect(css).toContain('--accent: #0d3cfc');
    expect(css).toContain('--qf-wft-blue: #0d3cfc');
    expect(css).toContain('.hero-quick-points');
    expect(css).toContain('display: none !important');
    expect(css).toContain('.floating-note');
    expect(css).toContain('.visual-flow');
    expect(css).not.toContain('#59ff75');
    expect(css).not.toContain('#0bd477');
  });
});
