import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('accessorial charge scanner polish', () => {
  it('adds charge health states and filters to the accessorial helper', async () => {
    const helper = await file('app-accessorial-tools.js');
    const css = await file('app-quote-actions.css');

    expect(helper).toContain('Accessorial scanner');
    expect(helper).toContain('Spot missing prices, duplicate extras, and disabled add-ons before sharing a quote.');
    expect(helper).toContain('Needs price');
    expect(helper).toContain('Possible duplicate');
    expect(helper).toContain('No stored rates are changed by these filters.');
    expect(helper).toContain('rowState');
    expect(helper).toContain('duplicatesMap');
    expect(helper).toContain('qf-acc-state-tag');
    expect(css).toContain('.qf-acc-tools');
    expect(css).toContain('.qf-acc-metrics');
    expect(css).toContain('.qf-acc-state-missing');
    expect(css).toContain('.qf-acc-state-duplicate');
  });
});
