import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('setup onboarding and empty states', () => {
  it('keeps the setup stylesheet mounted but not the retired dashboard-setup JS layer', async () => {
    const html = await file('app.html');
    expect(html).toContain('/dashboard-setup.css');
    // The decorative dashboard-setup.js coach layer was retired (portal simplification);
    // the stylesheet stays linked.
    expect(html).not.toContain('/dashboard-setup.js');
  });

  it('adds route-specific setup coaching and stronger empty-state guidance', async () => {
    const js = await file('dashboard-setup.js');
    const css = await file('dashboard-setup.css');

    expect(js).toContain('qf-setup-coach');
    expect(js).toContain('qf-setup-launch-note');
    expect(js).toContain('qf-setup-empty-checks');
    expect(js).toContain('Start small');
    expect(js).toContain('Test a quote');

    expect(css).toContain('Phase BF');
    expect(css).toContain('.qf-setup-coach');
    expect(css).toContain('.qf-setup-launch-note');
    expect(css).toContain('.qf-setup-empty-checks');
  });
});
