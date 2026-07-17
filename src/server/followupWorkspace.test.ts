import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('follow-up workspace polish', () => {
  it('keeps the retired follow-up workspace panel unloaded (retired source intact)', async () => {
    const js = await file('premium-saas-polish.js');
    const followupJs = await file('followup-workspace.js');
    const followupCss = await file('followup-workspace.css');
    // Retired (portal simplification): the polish loader must not re-inject it.
    expect(js).not.toContain('/followup-workspace.css');
    expect(js).not.toContain('/followup-workspace.js');
    expect(followupJs).toContain('Follow-up workspace');
    expect(followupJs).toContain('Lead follow-up');
    expect(followupJs).toContain('Callback workspace');
    expect(followupJs).toContain('Follow-up rule');
    expect(followupCss).toContain('Phase AH: follow-up and activity workspace polish');
    expect(followupCss).toContain('.qf-followup-board');
  });
});
