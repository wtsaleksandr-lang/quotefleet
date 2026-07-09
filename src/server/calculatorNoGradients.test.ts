import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('calculator global color enforcement without gradients', () => {
  it('loads the no-gradient calculator override after the global color system', async () => {
    const js = await file('public-calculator-conditional-options.js');
    const colorIndex = js.indexOf("/quotefleet-color-system.css");
    const noGradientIndex = js.indexOf("/public-calculator-no-gradients.css");

    expect(colorIndex).toBeGreaterThan(-1);
    expect(noGradientIndex).toBeGreaterThan(colorIndex);
  });

  it('forces the quote tool onto the requested global palette and removes gradient backgrounds', async () => {
    const css = await file('public-calculator-no-gradients.css');

    expect(css).toContain('Phase CB');
    expect(css).toContain('background: #161616 !important');
    expect(css).toContain('background: #181D1F !important');
    expect(css).toContain('background: #E6E3E0 !important');
    expect(css).toContain('background: #D4CFC9 !important');
    expect(css).toContain('background: #0D3CFC !important');
    expect(css).toContain('background-image: none !important');
    expect(css).toContain('body.qf-app-calculator .qf-result');
    expect(css).toContain('body.qf-app-calculator .qf-cta:disabled::after');
    expect(css).not.toContain('linear-gradient');
    expect(css).not.toContain('radial-gradient');
  });
});
