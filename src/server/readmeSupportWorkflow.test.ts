import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const rootDir = process.cwd();

async function read(path: string) {
  return readFile(resolve(rootDir, path), 'utf8');
}

describe('README support workflow', () => {
  it('documents the support branch and copy guidance', async () => {
    const readme = await read('README.md');

    expect(readme).toContain('Support workflow');
    expect(readme).toContain('automation/support-work');
    expect(readme).toContain('docs/support-docs-index.md');
    expect(readme).toContain('docs/quote-copy-rules.md');
    expect(readme).toContain('hosted branded rate page');
    expect(readme).not.toContain('instant quote desk');
  });
});
