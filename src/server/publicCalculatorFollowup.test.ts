import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('public calculator follow-up card retired', () => {
  it('no longer loads the follow-up injector on the widget page', async () => {
    const html = await file('widget.html');
    // The "Need help? — Choose the fastest follow-up path" card duplicated the
    // real Ask-a-question / Request-callback actions, so it was removed for the
    // minimal result. Neither the script nor its stylesheet is loaded anymore.
    expect(html).not.toContain('public-calculator-followup.js');
    expect(html).not.toContain('public-calculator-followup.css');
  });

  it('leaves the injector as an inert no-op stub with no card markup', async () => {
    const js = await file('public-calculator-followup.js');
    expect(js).toContain('RETIRED');
    expect(js).not.toContain('Choose the fastest follow-up path');
    expect(js).not.toContain('qf-followup-choice-panel');
  });
});