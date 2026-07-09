import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('QuoteFleet global font system', () => {
  it('defines Satoshi as the global sans font with the required fallback stack', async () => {
    const css = await file('quotefleet-font-system.css');

    expect(css).toContain('Phase CA');
    expect(css).toContain("font-family: 'Satoshi'");
    // Satoshi is loaded from the discrete weight files that actually exist on
    // disk (satoshi-300..900.woff2) — the old Satoshi-Variable/EtNono/DNMono
    // references 404'd and dropped the dashboard to system fonts.
    expect(css).toContain('/fonts/satoshi-400.woff2');
    expect(css).toContain('/fonts/satoshi-700.woff2');
    expect(css).not.toContain('Satoshi-Variable.woff2');
    expect(css).not.toContain('EtNono');
    expect(css).not.toContain('DNMono');
    expect(css).toContain("--font-sans: 'Satoshi', 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif");
    expect(css).toContain("--font-mono: 'DM Mono', 'JetBrains Mono'");
  });

  it('forces the entire homepage to the Satoshi stack', async () => {
    const css = await file('quotefleet-font-system.css');

    expect(css).toContain('body.qf-wft {');
    expect(css).toContain('--qf-wft-sans: var(--qf-font-sans) !important;');
    expect(css).toContain('--qf-wft-mono: var(--qf-font-mono) !important;');
    expect(css).toContain('body.qf-wft *');
    expect(css).toContain('body.qf-wft .site-header *');
    expect(css).toContain('body.qf-wft .hero *');
    expect(css).toContain('body.qf-wft .section *');
    expect(css).toContain('body.qf-wft .visual-flow *');
    expect(css).toContain('body.qf-wft .premium-footer *');
    expect(css).toContain('font-family: var(--qf-font-sans) !important;');
  });

  it('forces homepage hero and section headings to the Satoshi stack', async () => {
    const css = await file('quotefleet-font-system.css');

    expect(css).toContain('body.qf-wft .hero h1');
    expect(css).toContain('body.qf-wft .section h2');
    expect(css).toContain('body.qf-wft .final-cta-card h2');
    expect(css).toContain('font-family: var(--qf-font-sans) !important;');
  });

  it('uses Et Nono / DN Mono for accent text and keeps the quote widget on Inter fallback', async () => {
    const css = await file('quotefleet-font-system.css');
    const widget = await file('widget-style.css');
    const colorSystem = await file('quotefleet-color-system.css');

    expect(css).toContain('.eyebrow');
    expect(css).toContain('.section-kicker');
    expect(css).toContain('.field-label');
    expect(css).toContain('font-family: var(--qf-font-mono)');
    expect(css).toContain('body.qf-app-calculator');
    expect(css).toContain("font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif");

    expect(widget).toContain("font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif");
    expect(widget).not.toContain('Satoshi');
    expect(colorSystem).toContain("@import url('/quotefleet-font-system.css');");
  });
});
