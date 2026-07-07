import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const rootDir = process.cwd();

async function read(path: string) {
  return readFile(resolve(rootDir, path), 'utf8');
}

describe('automation runbook', () => {
  it('keeps support work on the reusable automation branch and PR path', async () => {
    const doc = await read('docs/automation-runbook.md');

    expect(doc).toContain('automation/support-work');
    expect(doc).toContain('move toward `main` only through a pull request');
    expect(doc).toContain('Reset `automation/support-work` to latest `main`');
    expect(doc).toContain('Avoid creating one-off support branches');
    expect(doc).toContain('Cleanup checklist');
    expect(doc).toContain('stop and summarize instead of forcing a change');
  });
});
