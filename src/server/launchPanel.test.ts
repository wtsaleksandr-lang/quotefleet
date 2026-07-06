import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('calculator launch panel', () => {
  it('loads the launch panel for the embed route', async () => {
    const loader = await file('premium-saas-polish.js');
    const js = await file('launch-panel.js');
    const css = await file('launch-panel.css');
    expect(loader).toContain('/launch-panel.css');
    expect(loader).toContain('/launch-panel.js');
    expect(js).toContain('Launch workspace');
    expect(js).toContain('Put your calculator where customers already ask for rates.');
    expect(js).toContain('Copy link');
    expect(js).toContain('Launch rule');
    expect(css).toContain('.qf-launch-panel');
    expect(css).toContain('.qf-launch-steps');
  });
});
