import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('audit log polish', () => {
  it('loads audit log polish assets from the dashboard polish helper', async () => {
    const loader = await file('premium-saas-polish.js');
    expect(loader).toContain('/audit-log-polish.css');
    expect(loader).toContain('/audit-log-polish.js');
  });

  it('adds a non-destructive scanner and filters to the audit page', async () => {
    const js = await file('audit-log-polish.js');
    const css = await file('audit-log-polish.css');

    expect(js).toContain('Audit activity scanner');
    expect(js).toContain('data-audit-filter="security"');
    expect(js).toContain('data-audit-filter="ai"');
    expect(js).toContain('data-audit-filter="change"');
    expect(js).toContain('Audit rule');

    expect(css).toContain('Phase AQ: audit log scanner polish');
    expect(css).toContain('.qf-audit-polish');
    expect(css).toContain('.qf-audit-tag.security');
  });
});