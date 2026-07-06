import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('brand and embed share readiness polish', () => {
  it('loads share readiness assets from the dashboard polish helper', async () => {
    const loader = await file('premium-saas-polish.js');
    expect(loader).toContain('/share-readiness.css');
    expect(loader).toContain('/share-readiness.js');
  });

  it('adds a non-destructive checklist for brand and embed pages', async () => {
    const js = await file('share-readiness.js');
    const css = await file('share-readiness.css');

    expect(js).toContain('Public widget readiness');
    expect(js).toContain('Ready to share');
    expect(js).toContain('Open public page');
    expect(js).toContain('before sending the link to customers');
    expect(js).toContain('data-share-go');

    expect(css).toContain('Phase AO: brand and embed readiness polish');
    expect(css).toContain('.qf-share-readiness');
    expect(css).toContain('.qf-share-status.warn');
  });
});
