import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('public static page smoke checks', () => {
  it('landing page has premium conversion CTAs and no placeholder footer links', async () => {
    const html = await file('landing.html');
    expect(html).toContain('/w/demo');
    expect(html).toContain('/signup');
    expect(html).toContain('/pricing');
    expect(html).toContain('/security');
    expect(html).toContain('No customer account required');
    expect(html).toContain('No card required');
    expect(html).toContain('Acme Drayage quote desk');
    expect(html).not.toContain('/for/forwarders');
    expect(html).not.toContain('/for/brokers');
    expect(html).not.toContain('/for/ltl');
    expect(html).not.toContain('simple-dock');
  });

  it('landing page includes social metadata', async () => {
    const html = await file('landing.html');
    expect(html).toContain('property="og:title"');
    expect(html).toContain('name="twitter:card"');
    expect(html).toContain('/og.svg');
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
