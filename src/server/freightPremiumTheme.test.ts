import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('premium freight visual theme', () => {
  it('loads the light freight theme and fallback logo assets', async () => {
    const html = await file('widget.html');
    const loader = await file('premium-saas-polish.js');

    expect(html).toContain('/freight-premium-theme.css');
    expect(html).toContain('/freight-brand-refresh.js');
    expect(loader).toContain('/freight-premium-theme.css');
    // freight-brand-refresh was retired from the dashboard polish loader (portal
    // simplification); the public widget still loads it (widget.html, asserted above).
    expect(loader).not.toContain('/freight-brand-refresh.js');
  });

  it('uses a clear premium QF fallback mark and lighter palette', async () => {
    const js = await file('freight-brand-refresh.js');
    const css = await file('freight-premium-theme.css');

    expect(js).toContain('qf-brand-mark');
    expect(js).toContain("mark.textContent = 'QF'");

    expect(css).toContain('Phase AT: lighter premium freight theme');
    expect(css).toContain('--w-primary: #3b22f4');
    expect(css).toContain('--w-accent: #9ee8ff');
    expect(css).toContain('.qf-brand-mark');
    expect(css).toContain('.qf-brand-preview-logo');
  });
});