import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('public calculator follow-up polish', () => {
  it('loads isolated follow-up assets on the widget page', async () => {
    const html = await file('widget.html');
    expect(html).toContain('public-calculator-followup.css');
    expect(html).toContain('public-calculator-followup.js');
  });

  it('adds customer guidance for chat and callback choices', async () => {
    const js = await file('public-calculator-followup.js');
    const css = await file('public-calculator-followup.css');

    expect(js).toContain('Choose the fastest follow-up path');
    expect(js).toContain('Ask AI');
    expect(js).toContain('Request callback');
    expect(js).toContain('qf-followup-choice-panel');

    expect(css).toContain('Phase AR: public calculator follow-up choices');
    expect(css).toContain('.qf-followup-choice-panel');
    expect(css).toContain('.qf-followup-choice-grid');
  });
});