import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const rootDir = process.cwd();

async function read(path: string) {
  return readFile(resolve(rootDir, path), 'utf8');
}

describe('public support page', () => {
  it('mounts the support route with the full site header, before static serving', async () => {
    const app = await read('src/server/app.ts');
    // /support is served through the shared full-header page list (Solutions
    // dropdown + mobile hamburger + premium footer), registered ahead of the
    // express.static handler so the skinned HTML wins over the raw file.
    expect(app).toContain("['/support', 'support.html']");
    expect(app).toContain('applyFullSiteHeader(html)');
    expect(app.indexOf("['/support', 'support.html']")).toBeLessThan(app.indexOf('express.static'));
  });

  it('documents support channels and safe request guidance', async () => {
    const page = await read('src/server/public/support.html');

    expect(page).toContain('Support — QuoteFleet');
    expect(page).toContain('support@quotefleet.net');
    expect(page).toContain('security@quotefleet.net');
    expect(page).toContain('legal@quotefleet.net');
    expect(page).toContain('Do not send passwords');
    expect(page).toContain('Expected response targets');
  });
});
