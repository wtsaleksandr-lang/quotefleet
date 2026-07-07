import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

async function file(path: string) {
  return readFile(resolve(process.cwd(), path), 'utf8');
}

describe('guided setup note', () => {
  it('keeps the guided setup note mounted', async () => {
    const doc = await file('docs/setup-onboarding-added.md');
    expect(doc).toContain('clickable preset answers');
    expect(doc).toContain('custom answer option');
    expect(doc).toContain('Assistant setup');
  });
});
