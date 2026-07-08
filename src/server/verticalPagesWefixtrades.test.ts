import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('WeFixTrades-style vertical public pages', () => {
  it('mounts the shared public and vertical skins', async () => {
    for (const name of ['for-brokers.html', 'for-ltl.html', 'for-forwarders.html']) {
      const html = await file(name);
      expect(html).toContain('/public-pages-wefixtrades.css');
      expect(html).toContain('/vertical-pages-wefixtrades.css');
      expect(html).toContain('qf-public-wft qf-vertical-wft');
    }
  });

  it('keeps vertical page styling hooks available', async () => {
    const css = await file('vertical-pages-wefixtrades.css');

    expect(css).toContain('Phase BR');
    expect(css).toContain('.qf-vertical-wft .feature-card');
    expect(css).toContain('.qf-vertical-wft .hero h1');
    expect(css).toContain('rgba(17,24,23,.92)');
  });
});
