import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('AI setup presets', () => {
  it('keeps the AI setup stylesheet mounted but not the retired JS layer', async () => {
    const html = await file('app.html');
    expect(html).toContain('/ai-setup.css');
    // The decorative ai-setup.js coach layer was retired (portal simplification);
    // the stylesheet stays linked.
    expect(html).not.toContain('/ai-setup.js');
  });

  it('adds guardrail preset controls', async () => {
    const js = await file('ai-setup.js');
    const css = await file('ai-setup.css');

    expect(js).toContain('qf-ai-presets');
    expect(js).toContain('data-ai-preset');
    expect(js).toContain('Services offered');
    expect(js).toContain('Callback handoff');
    expect(js).toContain('Written quote');

    expect(css).toContain('Phase BI');
    expect(css).toContain('.qf-ai-presets');
    expect(css).toContain('.qf-ai-preset-buttons');
  });
});
