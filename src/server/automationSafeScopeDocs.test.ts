import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const rootDir = process.cwd();

async function read(path: string) {
  return readFile(resolve(rootDir, path), 'utf8');
}

describe('automation safe scope documentation', () => {
  it('documents safe work boundaries for automated build-loop passes', async () => {
    const doc = await read('docs/automation-safe-scope.md');
    expect(doc).toContain('QuoteFleet automation safe scope');
    expect(doc).toContain('Allowed work');
    expect(doc).toContain('Avoided work');
    expect(doc).toContain('High-conflict files');
    expect(doc).toContain('src/server/public/app.js');
    expect(doc).toContain('quote calculation logic');
    expect(doc).toContain('Use a branch and pull request when possible');
  });
});
