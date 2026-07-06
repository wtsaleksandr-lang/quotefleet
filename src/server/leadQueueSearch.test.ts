import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('lead queue search polish', () => {
  it('loads lead queue search assets from the dashboard shell', async () => {
    const html = await file('app.html');
    expect(html).toContain('/lead-queue-search.css');
    expect(html).toContain('/lead-queue-search.js');
  });

  it('adds searchable lead queue controls without touching lead logic', async () => {
    const js = await file('lead-queue-search.js');
    const css = await file('lead-queue-search.css');

    expect(js).toContain('Lead queue control');
    expect(js).toContain('Search by ref, customer, service, lane, status, or amount.');
    expect(js).toContain('qf-lead-search-hidden');
    expect(js).toContain('/app/leads');

    expect(css).toContain('Phase AX: lead queue search and premium list polish');
    expect(css).toContain('.qf-lead-searchbar');
    expect(css).toContain('.qf-lead-search-hidden');
    expect(css).toContain('html[data-theme="light"] .qf-leads-focus');
  });
});
