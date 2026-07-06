import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('rate-card health scanner polish', () => {
  it('adds scan states and quick filters to the rate-card builder layer', async () => {
    const helper = await file('rate-builder.js');
    const css = await file('rate-builder.css');

    expect(helper).toContain('Rate health');
    expect(helper).toContain('Scan pricing gaps before sharing.');
    expect(helper).toContain('Needs price');
    expect(helper).toContain('Disabled/draft');
    expect(helper).toContain('qf-rate-row-gap');
    expect(helper).toContain('qf-rate-row-ready');
    expect(helper).toContain('filterRows');
    expect(css).toContain('.qf-rate-scan');
    expect(css).toContain('.qf-rate-row-status');
    expect(css).toContain('qf-rate-row-disabled');
  });
});
