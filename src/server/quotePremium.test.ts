import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('premium quote document polish', () => {
  it('loads premium quote/PDF styles after base polish', async () => {
    const html = await file('quote.html');
    const css = await file('quote-premium.css');
    expect(html).toContain('/quote.css');
    expect(html).toContain('/quote-polish.css');
    expect(html).toContain('/quote-premium.css');
    expect(html).toContain('/quote-print.css');
    expect(html.indexOf('/quote-premium.css')).toBeGreaterThan(html.indexOf('/quote-polish.css'));
    expect(html.indexOf('/quote-print.css')).toBeGreaterThan(html.indexOf('/quote-premium.css'));
    expect(html).toContain('Preparing quote');
    expect(css).toContain('Phase AG: premium quote/PDF experience polish');
    expect(css).toContain('--qdoc-primary: #0F9F8C');
    expect(css).toContain('.qdoc-actions::before');
    expect(css).toContain('@media print');
  });
});
