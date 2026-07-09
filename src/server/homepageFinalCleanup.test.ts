import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('homepage final cleanup styles', () => {
  it('loads the final homepage cleanup stylesheet last', async () => {
    const js = await file('landing-motion.js');
    const colorIndex = js.indexOf('/quotefleet-color-system.css');
    const cleanupIndex = js.indexOf('/landing-home-fixes.css');

    expect(colorIndex).toBeGreaterThan(-1);
    expect(cleanupIndex).toBeGreaterThan(colorIndex);
  });

  it('removes duplicate top CTA, replaces logo visually, and loosens hero title/card layout', async () => {
    const css = await file('landing-home-fixes.css');

    expect(css).toContain('Phase CC');
    expect(css).toContain('body.qf-wft .site-actions .btn-primary');
    expect(css).toContain('display: none !important;');
    expect(css).toContain('body.qf-wft .site-logo svg');
    expect(css).toContain('body.qf-wft .site-logo::before');
    expect(css).toContain('body.qf-wft .site-logo::after');
    expect(css).toContain('max-width: 860px !important;');
    expect(css).toContain('line-height: 1.03 !important;');
    expect(css).toContain('grid-template-columns: minmax(0, 1.08fr) minmax(460px, .92fr)');
    expect(css).toContain('body.qf-wft .flow-icon');
    expect(css).toContain('width: 54px !important;');
    expect(css).toContain('body.qf-wft .step-art');
    expect(css).toContain('min-height: 112px !important;');
  });
});
