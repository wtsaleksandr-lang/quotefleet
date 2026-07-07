import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('public widget terminal search UX', () => {
  it('loads the terminal search asset from the public widget', async () => {
    const html = await file('widget.html');
    expect(html).toContain('/widget-terminal-search.js');
    expect(html).toContain('/public-calculator-ux.css');
  });

  it('adds searchable terminal selector affordances', async () => {
    const script = await file('widget-terminal-search.js');
    const css = await file('public-calculator-ux.css');

    expect(script).toContain('qf-terminal-search-input');
    expect(script).toContain('aria-autocomplete');
    expect(script).toContain('No matching terminal found');
    expect(script).toContain('Dispatcher will confirm');

    expect(css).toContain('Phase BE');
    expect(css).toContain('.qf-terminal-search-field');
    expect(css).toContain('.qf-terminal-suggestions');
    expect(css).toContain('.qf-terminal-search-help');
  });
});
