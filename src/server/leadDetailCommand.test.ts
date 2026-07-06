import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('lead detail UI polish', () => {
  it('loads lead detail assets from app shell', async () => {
    const html = await file('app.html');
    expect(html).toContain('/lead-detail-command.css');
    expect(html).toContain('/lead-detail-command.js');
  });

  it('adds lead detail summary and quick navigation classes', async () => {
    const js = await file('lead-detail-command.js');
    const css = await file('lead-detail-command.css');

    expect(js).toContain('qf-lead-command-desk');
    expect(js).toContain('qf-lead-command-actions');
    expect(js).toContain('qf-lead-command-facts');
    expect(js).toContain('/app/leads');

    expect(css).toContain('Phase AY');
    expect(css).toContain('.qf-lead-command-desk');
    expect(css).toContain('.qf-lead-command-facts');
    expect(css).toContain('.qf-lead-command-pulse');
  });
});
