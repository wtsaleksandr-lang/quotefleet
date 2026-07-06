import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const rootDir = process.cwd();

async function read(path: string) {
  return readFile(resolve(rootDir, path), 'utf8');
}

describe('automation runbook documentation', () => {
  it('documents the safe automation run process', async () => {
    const doc = await read('docs/automation-runbook.md');
    expect(doc).toContain('QuoteFleet automation runbook');
    expect(doc).toContain('Start checklist');
    expect(doc).toContain('Safe task types');
    expect(doc).toContain('PR checklist');
    expect(doc).toContain('Handoff format');
  });
});
