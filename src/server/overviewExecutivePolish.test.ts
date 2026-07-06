import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('overview executive polish', () => {
  it('loads overview executive assets from the dashboard shell', async () => {
    const html = await file('app.html');
    expect(html).toContain('/overview-executive-polish.css');
    expect(html).toContain('/overview-executive-polish.js');
  });

  it('adds a premium overview hero and enhanced stat cards', async () => {
    const js = await file('overview-executive-polish.js');
    const css = await file('overview-executive-polish.css');

    expect(js).toContain('Freight quote command center');
    expect(js).toContain('qf-overview-hero');
    expect(js).toContain('qf-overview-stat-grid');
    expect(js).toContain('Review leads');
    expect(js).toContain('Install widget');

    expect(css).toContain('Phase AW: overview executive summary polish');
    expect(css).toContain('.qf-overview-hero');
    expect(css).toContain('.qf-overview-stat');
    expect(css).toContain('.qf-overview-stat-icon');
  });
});
