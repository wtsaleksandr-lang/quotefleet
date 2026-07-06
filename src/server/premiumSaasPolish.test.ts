import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('premium SaaS dashboard polish', () => {
  it('loads dashboard feedback, toast, modal, and loading polish', async () => {
    const html = await file('app.html');
    const css = await file('premium-saas-polish.css');
    const js = await file('premium-saas-polish.js');
    expect(html).toContain('/premium-saas-polish.css');
    expect(html).toContain('/premium-saas-polish.js');
    expect(css).toContain('Phase AF: premium SaaS polish');
    expect(css).toContain('.qf-toast-stack');
    expect(css).toContain('.qf-modal-backdrop');
    expect(css).toContain('.qf-page-skeleton');
    expect(js).toContain('window.qfToast');
    expect(js).toContain('window.qfConfirm');
    expect(js).toContain('qf:toast');
  });
});
