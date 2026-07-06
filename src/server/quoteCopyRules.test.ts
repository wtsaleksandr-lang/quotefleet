import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const rootDir = process.cwd();

async function read(path: string) {
  return readFile(resolve(rootDir, path), 'utf8');
}

describe('QuoteFleet copy rules', () => {
  it('documents approved and avoided messaging', async () => {
    const doc = await read('docs/quote-copy-rules.md');

    expect(doc).toContain('QuoteFleet copy rules');
    expect(doc).toContain('companyname.yourquote.net');
    expect(doc).toContain('no website changes needed');
    expect(doc).toContain('optional AI chat');
    expect(doc).toContain('branded PDF quotes');
    expect(doc).toContain('quote desk');
    expect(doc).toContain('unsupported speed, conversion, or revenue statistics');
    expect(doc).toContain('Safe support-work rule');
  });
});
