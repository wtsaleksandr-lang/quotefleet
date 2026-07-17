import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('lead CRM polish layer', () => {
  it('keeps the retired lead CRM panel unloaded (retired source intact)', async () => {
    const loader = await file('premium-saas-polish.js');
    const helper = await file('lead-crm-polish.js');
    const styles = await file('lead-crm-polish.css');

    // Retired (portal simplification): the polish loader must not re-inject it.
    expect(loader).not.toContain('/lead-crm-polish.css');
    expect(loader).not.toContain('/lead-crm-polish.js');
    expect(helper).toContain('Lead workspace');
    expect(helper).toContain('Owner:');
    expect(helper).toContain('Priority:');
    expect(helper).toContain('First response');
    expect(helper).toContain('CRM tip:');
    expect(styles).toContain('Phase AI: lead detail CRM polish');
    expect(styles).toContain('.qf-lead-crm-actions');
  });
});
