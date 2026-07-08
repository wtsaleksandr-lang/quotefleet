import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('public auth blue accent cleanup', () => {
  it('loads the auth WeFixTrades skin on login and signup', async () => {
    const login = await file('login.html');
    const signup = await file('signup.html');

    expect(login).toContain('/public-auth-wefixtrades.css');
    expect(login).toContain('qf-auth-wft');
    expect(signup).toContain('/public-auth-wefixtrades.css');
    expect(signup).toContain('qf-auth-wft');
  });

  it('uses blue instead of teal on auth, footer, and chat overrides', async () => {
    const authCss = await file('public-auth-wefixtrades.css');
    const blueFixes = await file('public-blue-fixes.css');
    const landingMotion = await file('landing-motion.js');
    const publicCss = await file('public-pages-wefixtrades.css');

    expect(authCss).toContain('Phase BW');
    expect(authCss).toContain('--accent: #0d3cfc');
    expect(authCss).toContain('.qf-mc-bubble');
    expect(authCss).not.toContain('#5EEAD4');
    expect(authCss).not.toContain('#5eead4');

    expect(blueFixes).toContain('Phase BX');
    expect(blueFixes).toContain('.premium-footer a');
    expect(blueFixes).toContain('.qf-mc-send');
    expect(blueFixes).not.toContain('#5EEAD4');
    expect(blueFixes).not.toContain('#5eead4');

    expect(landingMotion).toContain('/public-blue-fixes.css');
    expect(publicCss).toContain('--accent: #0d3cfc');
  });
});
