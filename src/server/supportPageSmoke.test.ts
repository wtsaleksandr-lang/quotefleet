import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const rootDir = process.cwd();

async function read(path: string) {
  return readFile(resolve(rootDir, path), 'utf8');
}

describe('public support page', () => {
  it('mounts the support route', async () => {
    const app = await read('src/server/app.ts');
    expect(app).toContain("app.get('/support'");
    expect(app).toContain("support.html");
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
