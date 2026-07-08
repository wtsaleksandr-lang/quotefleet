import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('calculator mobile cleanup', () => {
  it('keeps compact shipment option controls mounted', async () => {
    const html = await file('widget.html');

    expect(html).toContain('qf-options-panel');
    expect(html).toContain('Shipment options & add-ons');
    expect(html).toContain('qf-genset-panel');
    expect(html).toContain('Genset required for reefer container');
    expect(html).toContain('qf-hazmat-panel');
    expect(html).toContain('Hazmat class');
    expect(html).toContain('Booking or container #');
    expect(html).toContain('ZIP / postal code required');
    expect(html).toContain('/public-calculator-conditional-options.js');
  });

  it('keeps conditional freight options and mobile styles available', async () => {
    const js = await file('public-calculator-conditional-options.js');
    const css = await file('public-calculator-mobile-cleanup.css');

    expect(js).toContain('public-calculator-mobile-cleanup.css');
    expect(js).toContain('isReefer');
    expect(js).toContain('qf-genset-panel');
    expect(js).toContain('qf-hazmat-panel');

    expect(css).toContain('Phase BM');
    expect(css).toContain('.qf-options-panel');
    expect(css).toContain('.qf-tabs button');
    expect(css).toContain('.qf-accessorials');
  });
});
