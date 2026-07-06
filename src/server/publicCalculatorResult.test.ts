import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('public calculator result polish', () => {
  it('loads the isolated result polish script on the widget page', async () => {
    const html = await file('widget.html');
    expect(html).toContain('public-calculator-result.js');
    expect(html).toContain('widget.js');
  });

  it('adds quote result guidance without changing pricing logic', async () => {
    const js = await file('public-calculator-result.js');
    const css = await file('public-calculator-ux.css');

    expect(js).toContain('Estimate ready');
    expect(js).toContain('Next step:');
    expect(js).toContain('Written follow-up');
    expect(js).toContain('qf-result-guide');

    expect(css).toContain('.qf-result-guide');
    expect(css).toContain('.qf-result-pill');
    expect(css).toContain('.qf-result-mini-grid');
  });
});