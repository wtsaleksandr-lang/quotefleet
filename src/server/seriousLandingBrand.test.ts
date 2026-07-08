import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('serious landing brand polish', () => {
  it('uses a QF monogram mark instead of the truck icon on the landing page', async () => {
    const html = await file('landing.html');

    expect(html).toContain('site-logo-qf');
    expect(html).toContain('<span>QF</span>');
    expect(html).toContain('Freight rate desk software');
    expect(html).not.toContain('<circle cx="7" cy="17" r="2"');
    expect(html).not.toContain('<circle cx="17" cy="17" r="2"');
  });

  it('keeps restrained freight-tech brand styling mounted', async () => {
    const css = await file('landing-s-polish.css');

    expect(css).toContain('Phase BL');
    expect(css).toContain('serious WiseCargo-style landing brand polish');
    expect(css).toContain('.site-logo-qf');
    expect(css).toContain('#3fb8c5');
    expect(css).toContain('#0a1018');
  });
});
