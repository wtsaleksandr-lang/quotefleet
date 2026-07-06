import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('callback queue search polish', () => {
  it('loads callback search assets from the app shell', async () => {
    const html = await file('app.html');
    expect(html).toContain('/callback-queue-search.css');
    expect(html).toContain('/callback-queue-search.js');
  });

  it('adds searchable callback queue controls', async () => {
    const js = await file('callback-queue-search.js');
    const css = await file('callback-queue-search.css');

    expect(js).toContain('Callback control');
    expect(js).toContain('Search by customer, phone, quote, topic, status, or time.');
    expect(js).toContain('qf-callback-search-hidden');
    expect(js).toContain('/app/callbacks');

    expect(css).toContain('Phase AZ');
    expect(css).toContain('.qf-callback-searchbar');
    expect(css).toContain('.qf-callback-search-hidden');
    expect(css).toContain('html[data-theme="light"] .qf-callback-command');
  });
});
