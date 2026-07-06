import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('overview command center polish', () => {
  it('loads overview command center assets from the dashboard polish helper', async () => {
    const loader = await file('premium-saas-polish.js');
    expect(loader).toContain('/overview-command-center.css');
    expect(loader).toContain('/overview-command-center.js');
  });

  it('groups recent leads and edits into an actionable overview queue', async () => {
    const js = await file('overview-command-center.js');
    const css = await file('overview-command-center.css');

    expect(js).toContain('Today’s operating queue');
    expect(js).toContain('data-qf-overview-filter="open"');
    expect(js).toContain('data-qf-overview-filter="ai"');
    expect(js).toContain('qf-overview-workgrid');

    expect(css).toContain('Phase AR: overview command center polish');
    expect(css).toContain('.qf-overview-command');
    expect(css).toContain('.qf-overview-workgrid');
  });
});
