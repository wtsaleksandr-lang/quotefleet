import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('public calculator UX polish', () => {
  it('loads customer-facing flow polish', async () => {
    const html = await file('widget.html');
    const css = await file('public-calculator-ux.css');
    expect(html).toContain('/public-calculator-ux.css');
    expect(html).toContain('Fast estimate');
    expect(html).toContain('Written quote option');
    expect(html).toContain('Calculate estimate');
    expect(html).toContain('Get written quote');
    expect(html).toContain('Send written quote request');
    expect(css).toContain('Phase AE: customer-facing calculator UX polish');
    expect(css).toContain('.qf-result-actions');
    expect(css).toContain('.qf-mini-stepper');
  });
});
