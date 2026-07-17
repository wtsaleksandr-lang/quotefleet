import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('brand studio preview polish', () => {
  it('keeps the retired brand studio preview panel out of the shared polish loader', async () => {
    // brand-studio-preview was retired (portal simplification); the loader must not re-inject it.
    const loader = await file('premium-saas-polish.js');
    expect(loader).not.toContain('/brand-studio-preview.css');
    expect(loader).not.toContain('/brand-studio-preview.js');
  });

  it('adds a live-feel widget preview to the brand page', async () => {
    const js = await file('brand-studio-preview.js');
    const css = await file('brand-studio-preview.css');

    expect(js).toContain('Live brand feel');
    expect(js).toContain('Widget preview');
    expect(js).toContain('CTA button text');
    expect(js).toContain('qf-brand-studio-preview');

    expect(css).toContain('Phase AS: Brand Studio preview polish');
    expect(css).toContain('.qf-brand-studio-preview');
    expect(css).toContain('.qf-brand-preview-card');
  });
});