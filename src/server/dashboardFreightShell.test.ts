import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('dashboard freight shell polish', () => {
  it('loads the dashboard freight shell theme from the app shell', async () => {
    const html = await file('app.html');
    expect(html).toContain('/dashboard-freight-shell.css');
  });

  it('keeps the admin redesign scoped to the light dashboard shell', async () => {
    const css = await file('dashboard-freight-shell.css');

    expect(css).toContain('Phase AV: lighter premium freight dashboard shell');
    expect(css).toContain('html[data-theme="light"] .app-shell');
    expect(css).toContain('html[data-theme="light"] .sidebar');
    expect(css).toContain("content: 'QF'");
    expect(css).toContain('--accent: #3b22f4');
  });
});
