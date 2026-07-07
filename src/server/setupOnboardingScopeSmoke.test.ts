import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

async function file(path: string) {
  return readFile(resolve(process.cwd(), path), 'utf8');
}

describe('setup onboarding scope', () => {
  it('keeps the setup scope document mounted', async () => {
    const doc = await file('docs/setup-onboarding-scope.md');

    expect(doc).toContain('Rate cards');
    expect(doc).toContain('Accessorials');
    expect(doc).toContain('Brand page');
    expect(doc).toContain('preset answers');
    expect(doc).toContain('custom answer');
  });
});
