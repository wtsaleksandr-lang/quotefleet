import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('widget preview initialization', () => {
  it('handles Replit preview hosts without using the random subdomain as tenant slug', async () => {
    const js = await file('public-calculator-conditional-options.js');

    expect(js).toContain('PREVIEW_HOST_RE');
    expect(js).toContain('replit.dev');
    expect(js).toContain("location.replace('/w/demo'");
    expect(js).toContain('shouldRedirectPreviewToDemo');
    expect(js).toContain('scheduleSync');
  });
});
