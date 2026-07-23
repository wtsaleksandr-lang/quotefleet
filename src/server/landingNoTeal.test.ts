import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('landing WeFixTrades cleanup skin', () => {
  it('loads the final cleanup stylesheet from the landing script', async () => {
    const js = await file('landing-motion.js');

    expect(js).toContain('/landing-wefixtrades-cleanup.css');
    expect(js).toContain('document.head.appendChild(link)');
  });

  it('forces blue contrast and removes noisy teal/green landing artifacts', async () => {
    const css = await file('landing-wefixtrades-cleanup.css');

    expect(css).toContain('Phase BV');
    expect(css).toContain('--accent: #0d3cfc');
    expect(css).toContain('--qf-wft-blue: #0d3cfc');
    expect(css).toContain('--qf-wft-bg: #1f2628');
    expect(css).toContain('--qf-wft-cream: #e7e2dc');
    expect(css).toContain('.hero-quick-points');
    expect(css).toContain('.use-section');
    expect(css).toContain('.ai-section');
    expect(css).toContain('.pdf-section');
    expect(css).toContain('.scheduler-section');
    expect(css).toContain('display: none !important');
    // The before/after section (.compare-simple-section, "Stop losing loads to
    // slow quotes") is now an intentional, VISIBLE feature — the cleanup skin
    // must never hide it. Guard that it stays out of the display:none block.
    expect(css).not.toContain('.compare-simple-section');
  });

  it('keeps the legacy mockup blocks hidden but surfaces their features via the "Everything included" band', async () => {
    const css = await file('landing-wefixtrades-cleanup.css');
    const html = await file('landing.html');

    // The four legacy hero-mockup blocks stay in the display:none hide-list —
    // .use-section is redundant with the hero/how-it-works, and the .ai/.pdf/
    // .scheduler mockups are superseded by the consolidated band below.
    const hideBlock = css.slice(
      css.indexOf('body.qf-wft .use-section,'),
      css.indexOf('body.qf-wft .use-section,') + 220,
    );
    expect(hideBlock).toContain('.ai-section');
    expect(hideBlock).toContain('.pdf-section');
    expect(hideBlock).toContain('.scheduler-section');
    expect(hideBlock).toContain('display: none !important');

    // The real paid differentiators (24/7 AI service agent, branded PDF,
    // automatic follow-ups) ARE now surfaced — as one clean, on-brand
    // consolidated band, not the legacy blocks. Present and NOT in the hide-list.
    expect(html).toContain('class="section qf-included-section"');
    expect(html).toContain('24/7 AI service agent');
    expect(html).toContain('Branded PDF quotes');
    expect(html).toContain('Automatic follow-ups');
    expect(css).toContain('body.qf-wft .qf-included-card');
    expect(hideBlock).not.toContain('.qf-included-section');
    expect(css).toContain('.floating-note');
    expect(css).toContain('.visual-flow');
    expect(css).toContain('.flow-rates');
    expect(css).not.toContain('#59ff75');
    expect(css).not.toContain('#0bd477');
  });
});
