import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('rate builder save states and duplicate action', () => {
  it('keeps the rate builder stylesheet mounted but not the retired JS layer', async () => {
    const html = await file('app.html');
    expect(html).toContain('/rate-builder.css');
    // The decorative rate-builder.js layer was retired (portal simplification);
    // the stylesheet stays linked.
    expect(html).not.toContain('/rate-builder.js');
  });

  it('adds rate-card save-state and duplicate affordances', async () => {
    const js = await file('rate-builder.js');
    const css = await file('rate-builder.css');

    expect(js).toContain('qf-rate-save-panel');
    expect(js).toContain('qf-rate-live');
    expect(js).toContain('qf-rate-duplicate-btn');
    expect(js).toContain('Duplicated as disabled draft');
    expect(js).toContain('/api/tenant/rate-cards');

    expect(css).toContain('Phase BG');
    expect(css).toContain('.qf-rate-save-panel');
    expect(css).toContain('.qf-rate-live');
    expect(css).toContain('.qf-rate-duplicate-btn');
  });
});
