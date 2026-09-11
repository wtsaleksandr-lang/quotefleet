import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('QuoteFleet global font system', () => {
  it('defines Inter as the global sans font with the required fallback stack', async () => {
    const css = await file('quotefleet-font-system.css');

    expect(css).toContain('Phase CA');
    // Wave 2: Inter replaces Satoshi. style.css owns the @font-face rules
    // (it is render-blocking on every surface), so this sheet must NOT declare
    // its own copy — a second declaration only duplicates the download.
    expect(css).not.toContain('Satoshi');
    expect(css).not.toContain('@font-face {');
    expect(css).toContain("--font-sans: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif");
    // Mono is a PLATFORM stack, never a webfont: the reference design ships no
    // monospace, but the directory renders USDOT/MC numerals in mono.
    expect(css).toContain('--font-mono: ui-monospace, SFMono-Regular, Menlo, monospace');
    expect(css).not.toContain('DM Mono');
    expect(css).not.toContain('JetBrains Mono');
  });

  it('forces the entire homepage to the Inter stack', async () => {
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

  it('forces homepage hero and section headings to the Inter stack', async () => {
    const css = await file('quotefleet-font-system.css');

    expect(css).toContain('body.qf-wft .hero h1');
    expect(css).toContain('body.qf-wft .section h2');
    expect(css).toContain('body.qf-wft .final-cta-card h2');
    expect(css).toContain('font-family: var(--qf-font-sans) !important;');
  });

  it('uses the platform mono for accent text and keeps the quote widget on Inter fallback', async () => {
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
