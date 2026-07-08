import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('premium calculator UI', () => {
  it('keeps premium calculator assets mounted', async () => {
    const html = await file('widget.html');
    expect(html).toContain('/widget-style.css');
    expect(html).toContain('/public-calculator-ux.css');
    expect(html).toContain('qf-trust-strip');
    expect(html).toContain('qf-mini-stepper');
    expect(html).toContain('qf-result');
  });

  it('keeps premium visual hooks in the calculator stylesheet', async () => {
    const css = await file('public-calculator-ux.css');

    expect(css).toContain('Phase BJ');
    expect(css).toContain('premium calculator visual system');
    expect(css).toContain('.qf-widget::before');
    expect(css).toContain('.qf-widget::after');
    expect(css).toContain('Instant freight estimate');
    expect(css).toContain('Quote estimate');
    expect(css).toContain('radial-gradient');
    expect(css).toContain('.qf-result::before');
  });
});
