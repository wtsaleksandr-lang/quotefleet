import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('public calculator result polish', () => {
  it('loads the isolated result polish script on the widget page', async () => {
    const html = await file('widget.html');
    expect(html).toContain('public-calculator-result.js');
    expect(html).toContain('widget.js');
  });

  it('keeps the print helper but drops the redundant "Estimate ready" guide card', async () => {
    const js = await file('public-calculator-result.js');

    // Print / PDF path preserved — the minimal result's compact "Print / PDF"
    // link calls window.qfPrintQuote, which builds the print summary.
    expect(js).toContain('qfPrintQuote');
    expect(js).toContain('qf-print-summary');

    // The cluttered "Estimate ready" card (mini-grid + its own Print button) is
    // retired for the minimal result — it is no longer injected.
    expect(js).not.toContain('qf-result-guide');
    expect(js).not.toContain('Estimate ready');
    expect(js).not.toContain('qf-result-mini-grid');
  });
});