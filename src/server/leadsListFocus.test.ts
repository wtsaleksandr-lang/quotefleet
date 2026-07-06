import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('leads list focus polish', () => {
  it('loads the leads focus assets from the dashboard polish layer', async () => {
    const loader = await file('premium-saas-polish.js');
    const helper = await file('leads-list-focus.js');
    const css = await file('leads-list-focus.css');

    expect(loader).toContain('/leads-list-focus.css');
    expect(loader).toContain('/leads-list-focus.js');
    expect(helper).toContain('Work the hottest leads first');
    expect(helper).toContain('Needs attention');
    expect(helper).toContain('High value');
    expect(helper).toContain('Last 24h');
    expect(helper).toContain('qf-lead-hot-row');
    expect(css).toContain('Phase AI: leads list focus and scanning polish');
    expect(css).toContain('.qf-leads-toolbar');
  });
});
