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
    expect(css).toContain('--accent: #3356EE');
    expect(css).toContain('--qf-wft-blue: #3356EE');
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

  it('keeps the legacy mockup blocks hidden but preserves the "Everything included" band', async () => {
    const css = await file('landing-wefixtrades-cleanup.css');
    // The "Everything included" band moved OFF the homepage on 2026-09-11 with
    // the rest of the below-the-bento-grid stack, so it is no longer in
    // landing.html — it is in the legacy partial, one flag away from returning
    // (src/server/home/homeSections.ts). Read it from there. This assertion is
    // kept rather than deleted because the point of it stands: those three paid
    // differentiators must be carried by the consolidated band and NOT by the
    // .ai/.pdf/.scheduler mockups, which stay in the hide-list either way.
    const legacy = await readFile(
      resolve(process.cwd(), 'src/server/home/legacy-below-grid.html'),
      'utf8',
    );

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
    // automatic follow-ups) are carried by the consolidated band, not the
    // legacy blocks — and the band was never folded into the hide-list.
    expect(legacy).toContain('class="section qf-included-section"');
    expect(legacy).toContain('24/7 AI service agent');
    expect(legacy).toContain('Branded PDF quotes');
    expect(legacy).toContain('Automatic follow-ups');
    expect(css).toContain('body.qf-wft .qf-included-card');
    expect(hideBlock).not.toContain('.qf-included-section');
    expect(css).toContain('.floating-note');
    expect(css).toContain('.visual-flow');
    expect(css).toContain('.flow-rates');
    expect(css).not.toContain('#59ff75');
    expect(css).not.toContain('#0bd477');
  });

  it('no longer renders that band on the homepage itself', async () => {
    // The other half of the same fact: hidden means ABSENT from what the
    // visitor receives, not styled out of sight. homeSections.test.ts covers
    // the whole band; this pins the one section this file has always tracked.
    const html = await file('landing.html');
    expect(html).not.toContain('qf-included-section');
  });
});
