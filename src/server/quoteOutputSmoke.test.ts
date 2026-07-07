import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('quote output helper', () => {
  it('keeps the result helper mounted', async () => {
    const html = await file('widget.html');
    expect(html).toContain('/public-calculator-result.js');
  });

  it('keeps printable quote output hooks mounted', async () => {
    const js = await file('public-calculator-result.js');
    const css = await file('public-calculator-ux.css');

    expect(js).toContain('qf-print-summary');
    expect(js).toContain('qf-print-quote-btn');
    expect(js).toContain('qfPrintQuote');

    expect(css).toContain('Phase BH');
    expect(css).toContain('.qf-pdf-actions');
    expect(css).toContain('.qf-print-summary');
  });
});
