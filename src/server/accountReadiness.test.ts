import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('account readiness polish', () => {
  it('loads account readiness assets from the dashboard polish helper', async () => {
    const loader = await file('premium-saas-polish.js');
    expect(loader).toContain('/account-readiness.css');
    expect(loader).toContain('/account-readiness.js');
  });

  it('adds a non-destructive readiness checklist to the account page', async () => {
    const js = await file('account-readiness.js');
    const css = await file('account-readiness.css');

    expect(js).toContain('Account readiness');
    expect(js).toContain('Ready for launch');
    expect(js).toContain('Profile identity');
    expect(js).toContain('Session control');
    expect(js).toContain('data-account-go');
    expect(js).toContain('Launch rule');

    expect(css).toContain('Phase AP: account readiness polish');
    expect(css).toContain('.qf-account-readiness');
    expect(css).toContain('.qf-account-status.ready');
  });
});
