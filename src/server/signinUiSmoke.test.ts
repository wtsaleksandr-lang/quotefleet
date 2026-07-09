import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('signin UI smoke coverage', () => {
  it('keeps signup guidance mounted', async () => {
    const signup = await file('signup.html');
    expect(signup).toContain('autocomplete="organization"');
    expect(signup).toContain('Confirm');
    expect(signup).toContain('normalizeEmail');
    // Two-tier signup: plan chooser + card-required all-inclusive trial copy.
    expect(signup).toContain('14-day all-inclusive trial');
    expect(signup).toContain('name="plan"');
  });

  it('keeps login guidance mounted', async () => {
    const login = await file('login.html');
    expect(login).toContain('current-');
    expect(login).toContain('If that email exists');
    expect(login).toContain('one-time email link');
    expect(login).toContain('normalizeEmail');
    expect(login).toContain('Security note');
  });
});
