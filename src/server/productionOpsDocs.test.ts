import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const rootDir = process.cwd();

async function read(path: string) {
  return readFile(resolve(rootDir, path), 'utf8');
}

describe('production operations docs', () => {
  it('documents launch operations coverage', async () => {
    const doc = await read('docs/production-launch-ops.md');

    expect(doc).toContain('production launch operations checklist');
    expect(doc).toContain('Monitoring');
    expect(doc).toContain('Backups and restore');
    expect(doc).toContain('Incident process');
    expect(doc).toContain('Support process');
    expect(doc).toContain('Terms, privacy, and customer notices');
    expect(doc).toContain('Data retention');
    expect(doc).toContain('Pre-launch smoke test');
  });

  it('links the operations checklist from support docs and README', async () => {
    const index = await read('docs/support-docs-index.md');
    const readme = await read('README.md');

    expect(index).toContain('docs/production-launch-ops.md');
    expect(index).toContain('docs/launch-qa-matrix.md');
    expect(readme).toContain('Production launch operations');
    expect(readme).toContain('docs/production-launch-ops.md');
  });
});
