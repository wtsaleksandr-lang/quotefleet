import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('homepage final cleanup styles', () => {
  it('loads the final homepage cleanup stylesheet last and directly from the homepage head', async () => {
    const js = await file('landing-motion.js');
    const html = await file('landing.html');
    const colorIndex = js.indexOf('/quotefleet-color-system.css');
    const cleanupIndex = js.indexOf('/landing-home-fixes.css');

    expect(colorIndex).toBeGreaterThan(-1);
    expect(cleanupIndex).toBeGreaterThan(colorIndex);
    expect(html).toContain('/landing-home-fixes.css');
  });

  it('uses the brand mark image and keeps a non-duplicate header CTA', async () => {
    const html = await file('landing.html');

    expect(html).toContain('/brand/mark-keys.png');
    expect(html).toContain('View demo <span class="arr">→</span>');
    expect(html).toContain('<a class="btn btn-primary btn-lg" href="/signup">Start free');
    expect(html).not.toContain('<a class="btn btn-primary" href="/signup">Start free');
  });

  it('widens the hero title, hero visual cards, and under-hero step containers', async () => {
    const css = await file('landing-home-fixes.css');

    expect(css).toContain('Phase CC');
    expect(css).toContain('body.qf-wft .site-actions .btn-secondary');
    expect(css).toContain('body.qf-wft .site-logo svg.qf-route-logo');
    expect(css).toContain('max-width: 880px !important;');
    expect(css).toContain('line-height: 1.03 !important;');
    expect(css).toContain('grid-template-columns: minmax(0, 1.08fr) minmax(520px, .92fr)');
    expect(css).toContain('max-width: 620px !important;');
    expect(css).toContain('width: 58px !important;');
    expect(css).toContain('width: min(1440px, calc(100vw - 56px)) !important;');
    expect(css).toContain('grid-template-columns: repeat(4, minmax(280px, 1fr))');
    expect(css).toContain('min-height: 138px !important;');
  });
});
