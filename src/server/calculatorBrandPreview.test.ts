import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('calculator brand preview polish', () => {
  it('mounts demo branding and clean addon helpers', async () => {
    const js = await file('public-calculator-conditional-options.js');

    expect(js).toContain('qf-demo-brand-preview-v1');
    expect(js).toContain('Customize demo branding');
    expect(js).toContain('toggleBrandEditor');
    expect(js).toContain('qf-demo-logo-slot');
    expect(js).toContain('Brand preview');
    expect(js).toContain('USDOT');
    expect(js).toContain('MC #');
    expect(js).toContain('FUTURE_CHARGE_RE');
    expect(js).toContain('detention');
    expect(js).toContain('public-calculator-brand-preview.css');
  });

  it('keeps app-style addon controls consistent', async () => {
    const css = await file('public-calculator-brand-preview.css');

    expect(css).toContain('Phase BO');
    expect(css).toContain('.qf-demo-logo-slot em');
    expect(css).toContain('.qf-demo-brand-editor[hidden]');
    expect(css).toContain('.qf-demo-brand-card');
    expect(css).toContain('.qf-acc-chip.active');
    expect(css).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))');
  });
});
