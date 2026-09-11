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
    expect(css).toContain('--qf-color-accent: #3356EE');
    expect(css).toContain('--qf-color-white: #FFFFFF');
    expect(css).toContain('--qf-color-bg: #0C111D');
    expect(css).toContain('--qf-color-card-dark: #131A28');
    expect(css).toContain('--qf-color-card-light: #F2F4F7');
    expect(css).toContain('--qf-color-muted: #90A1B9');
    expect(css).toContain('--qf-color-warm-card: #F2F4F7');
    expect(css).toContain('--qf-color-warm-muted: #E2E8F0');
    expect(css).toContain('--qf-color-neutral-card: #EAECF0');
    expect(css).toContain('--qf-color-neutral-card-hover: #CAD5E2');
    expect(css).toContain('--qf-color-light-text: #020618');
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
