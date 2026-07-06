import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('callback queue polish', () => {
  it('ships a callback command center and loads it from an existing dashboard layer', async () => {
    const css = await file('callback-queue-polish.css');
    const js = await file('callback-queue-polish.js');
    const activity = await file('app-quote-activity.js');

    expect(css).toContain('Phase AI: callback queue workspace polish');
    expect(css).toContain('.qf-callback-command');
    expect(css).toContain('.qf-callback-plan');
    expect(js).toContain('Daily call desk');
    expect(js).toContain('Highlight call-first');
    expect(js).toContain('Call flow');
    expect(js).toContain('Priority tags');
    expect(activity).toContain('/callback-queue-polish.css');
    expect(activity).toContain('/callback-queue-polish.js');
  });
});
