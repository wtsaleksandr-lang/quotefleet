import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('public static page smoke checks', () => {
  it('landing page has primary conversion routes', async () => {
    const html = await file('landing.html');
    expect(html).toContain('/w/demo');
    expect(html).toContain('/signup');
    expect(html).toContain('/pricing');
    expect(html).toContain('/marketplace/');
  });

  it('widget loads required scripts and controls', async () => {
    const html = await file('widget.html');
    expect(html).toContain('/widget.js');
    expect(html).toContain('/widget-terminal-search.js');
    expect(html).toContain('qf-calc-btn');
    expect(html).toContain('qf-pickup-terminal');
  });

  it('hosted quote page loads quote helpers', async () => {
    const html = await file('quote.html');
    expect(html).toContain('/quote.js');
    expect(html).toContain('/quote-polish.js');
    expect(html).toContain('/quote-print.css');
    expect(html).toContain('qdoc-print-hint');
  });
});
