import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('AI import polish', () => {
  it('keeps the retired AI import panel out of the dashboard polish layer', async () => {
    // ai-import-polish was retired (portal simplification); the loader must not re-inject it.
    const polish = await file('premium-saas-polish.js');
    expect(polish).not.toContain('/ai-import-polish.css');
    expect(polish).not.toContain('/ai-import-polish.js');
  });

  it('adds import readiness, filters, and safe apply guidance', async () => {
    const script = await file('ai-import-polish.js');
    const css = await file('ai-import-polish.css');
    expect(script).toContain('AI import readiness');
    expect(script).toContain('Ready to review');
    expect(script).toContain('Before applying');
    expect(script).toContain('missing prices');
    expect(script).toContain('data-import-filter="ready_for_review"');
    expect(css).toContain('Phase AN: AI import readiness and safer apply polish');
    expect(css).toContain('.qf-import-readiness');
    expect(css).toContain('.qf-import-safe-apply');
  });
});
