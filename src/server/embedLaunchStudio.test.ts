import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('embed launch workspace polish', () => {
  it('loads embed launch assets from the dashboard shell', async () => {
    const html = await file('app.html');
    expect(html).toContain('/embed-launch-studio.css');
    expect(html).toContain('/embed-launch-studio.js');
  });

  it('adds a launch workspace around live preview and JS embed cards', async () => {
    const js = await file('embed-launch-studio.js');
    const css = await file('embed-launch-studio.css');

    expect(js).toContain('Launch workspace');
    expect(js).toContain('Preview, copy, and publish with confidence');
    expect(js).toContain('qf-embed-launch-grid');
    expect(js).toContain('js embed');

    expect(css).toContain('Phase AU: Embed launch workspace polish');
    expect(css).toContain('.qf-embed-launch-studio');
    expect(css).toContain('.qf-embed-launch-grid');
  });
});