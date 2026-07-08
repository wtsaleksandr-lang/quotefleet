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

describe('tools and marketplace WeFixTrades styling', () => {
  it('injects shared styling for tools and marketplace routes before static serving', async () => {
    const app = await file('src/server/app.ts');

    expect(app).toContain('applyToolsMarketplaceSkin');
    expect(app).toContain('/tools-marketplace-wefixtrades.css');
    expect(app).toContain('qf-tools-marketplace');
    expect(app.indexOf("app.get(['/tools', '/tools/']")).toBeLessThan(app.indexOf('express.static'));
    expect(app.indexOf("app.get(['/marketplace', '/marketplace/']")).toBeLessThan(app.indexOf('express.static'));
    expect(app.indexOf("app.get('/marketplace/carrier/:slug'")).toBeLessThan(app.indexOf('express.static'));
  });

  it('keeps route HTML files unchanged while adding external styling hooks', async () => {
    const tools = await publicFile('tools.html');
    const marketplace = await publicFile('marketplace.html');
    const carrier = await publicFile('marketplace-carrier.html');

    expect(tools).toContain('Free freight rate calculator');
    expect(marketplace).toContain('Carrier marketplace');
    expect(carrier).toContain('QuoteFleet marketplace');
    expect(tools).not.toContain('/tools-marketplace-wefixtrades.css');
    expect(marketplace).not.toContain('qf-tools-marketplace');
    expect(carrier).not.toContain('qf-tools-marketplace');
  });

  it('keeps tools and marketplace page styling available', async () => {
    const css = await publicFile('tools-marketplace-wefixtrades.css');

    expect(css).toContain('Phase BT');
    expect(css).toContain('.qf-public-wft.qf-tools-marketplace .tool-card');
    expect(css).toContain('.qf-public-wft.qf-tools-marketplace .mp-card');
    expect(css).toContain('var(--qf-wft-cream)');
  });
});
