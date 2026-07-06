import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const rootDir = process.cwd();

async function read(path: string) {
  return readFile(resolve(rootDir, path), 'utf8');
}

describe('pull request template', () => {
  it('includes support-work checklist items', async () => {
    const template = await read('.github/pull_request_template.md');
    expect(template).toContain('Scope check');
    expect(template).toContain('docs, smoke tests');
    expect(template).toContain('business logic');
    expect(template).toContain('quote calculation');
    expect(template).toContain('latest `main`');
    expect(template).toContain('Manual development note');
  });
});
