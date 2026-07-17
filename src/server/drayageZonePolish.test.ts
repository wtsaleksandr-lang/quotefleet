import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('drayage zone polish', () => {
  it('keeps the retired zone scanner panel out of the dashboard polish layer', async () => {
    // drayage-zone-polish was retired (portal simplification); the loader must not re-inject it.
    const polish = await file('premium-saas-polish.js');
    expect(polish).not.toContain('/drayage-zone-polish.css');
    expect(polish).not.toContain('/drayage-zone-polish.js');
  });

  it('labels common drayage zone readiness gaps', async () => {
    const script = await file('drayage-zone-polish.js');
    const css = await file('drayage-zone-polish.css');
    expect(script).toContain('Drayage zone readiness');
    expect(script).toContain('Missing anchor');
    expect(script).toContain('Needs radius');
    expect(script).toContain('Needs price');
    expect(script).toContain('smallest matching zone wins');
    expect(css).toContain('Phase AM: drayage zone coverage and readiness polish');
    expect(css).toContain('.qf-zone-health');
    expect(css).toContain('.qf-zone-status.ready');
  });
});
