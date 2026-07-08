import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('QuoteFleet global color system', () => {
  it('defines the requested brand palette and button hover rules', async () => {
    const css = await file('quotefleet-color-system.css');

    expect(css).toContain('Phase BZ');
    expect(css).toContain('--qf-color-accent: #0D3CFC');
    expect(css).toContain('--qf-color-white: #FFFFFF');
    expect(css).toContain('--qf-color-bg: #181D1F');
    expect(css).toContain('--qf-color-card-dark: #22282A');
    expect(css).toContain('--qf-color-card-light: #E4EDF1');
    expect(css).toContain('--qf-color-muted: #B1C5CE');
    expect(css).toContain('--qf-color-warm-card: #F3EDDF');
    expect(css).toContain('--qf-color-warm-muted: #EFE7D8');
    expect(css).toContain('--qf-color-neutral-card: #E6E3E0');
    expect(css).toContain('--qf-color-neutral-card-hover: #D4CFC9');
    expect(css).toContain('--qf-color-light-text: #1E1E1E');
    expect(css).toContain('border-color: var(--qf-color-white) !important;');
    expect(css).toContain('border-color: var(--qf-color-accent) !important;');
  });

  it('loads the color system on public landing, dashboard, admin, and quote tool', async () => {
    const landingMotion = await file('landing-motion.js');
    const app = await file('app.html');
    const admin = await file('admin.html');
    const calculator = await file('public-calculator-conditional-options.js');
    const auth = await file('public-auth-wefixtrades.css');
    const publicPages = await file('public-pages-wefixtrades.css');
    const verticalPages = await file('vertical-pages-wefixtrades.css');

    expect(landingMotion).toContain('/quotefleet-color-system.css');
    expect(app).toContain('/quotefleet-color-system.css');
    expect(admin).toContain('/quotefleet-color-system.css');
    expect(calculator).toContain('/quotefleet-color-system.css');
    expect(auth).toContain('/quotefleet-color-system.css');
    expect(publicPages).toContain('/quotefleet-color-system.css');
    expect(verticalPages).toContain('/quotefleet-color-system.css');
  });
});
