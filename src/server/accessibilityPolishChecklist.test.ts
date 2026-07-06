import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const rootDir = process.cwd();

async function read(path: string) {
  return readFile(resolve(rootDir, path), 'utf8');
}

describe('accessibility polish checklist', () => {
  it('documents safe frontend accessibility checks', async () => {
    const doc = await read('docs/accessibility-polish-checklist.md');
    expect(doc).toContain('QuoteFleet accessibility polish checklist');
    expect(doc).toContain('Keyboard access');
    expect(doc).toContain('Labels and names');
    expect(doc).toContain('Layout and responsive polish');
    expect(doc).toContain('Reduced-motion preferences');
    expect(doc).toContain('frontend-only');
  });
});
