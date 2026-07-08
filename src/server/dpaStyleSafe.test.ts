import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const publicDir = resolve(root, 'src/server/public');

async function file(path: string) {
  return readFile(resolve(root, path), 'utf8');
}

async function publicFile(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('safe DPA visual alignment', () => {
  it('serves DPA with injected styling without rewriting the legal HTML file', async () => {
    const app = await file('src/server/app.ts');
    const dpa = await publicFile('dpa.html');

    expect(app).toContain('applyDpaPageSkin');
    expect(app).toContain('/public-pages-wefixtrades.css');
    expect(app).toContain('/dpa-wefixtrades.css');
    expect(app).toContain('<body class="qf-public-wft">');
    expect(app.indexOf("app.get('/dpa'")).toBeLessThan(app.indexOf('express.static'));

    expect(dpa).toContain('The Processor will notify the Controller of any intended addition or replacement of a Sub-processor');
    expect(dpa).toContain('The European Commission\'s Standard Contractual Clauses');
    expect(dpa).not.toContain('/dpa-wefixtrades.css');
    expect(dpa).not.toContain('qf-public-wft');
  });

  it('keeps DPA-specific public styling available', async () => {
    const css = await publicFile('dpa-wefixtrades.css');

    expect(css).toContain('Phase BS');
    expect(css).toContain('DPA visual alignment without changing legal copy');
    expect(css).toContain('.qf-public-wft .dpa-shell');
    expect(css).toContain('var(--qf-wft-cream)');
  });
});
