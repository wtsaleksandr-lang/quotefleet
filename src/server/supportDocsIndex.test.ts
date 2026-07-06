import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const rootDir = process.cwd();

async function read(path: string) {
  return readFile(resolve(rootDir, path), 'utf8');
}

describe('support docs index', () => {
  it('links core support and maintenance docs', async () => {
    const doc = await read('docs/support-docs-index.md');
    expect(doc).toContain('QuoteFleet support docs index');
    expect(doc).toContain('docs/automation-safe-scope.md');
    expect(doc).toContain('docs/automation-runbook.md');
    expect(doc).toContain('docs/product-todo.md');
    expect(doc).toContain('docs/dashboard-asset-map.md');
    expect(doc).toContain('docs/homepage-maintenance.md');
    expect(doc).toContain('docs/accessibility-polish-checklist.md');
    expect(doc).toContain('docs/quote-copy-rules.md');
  });
});
