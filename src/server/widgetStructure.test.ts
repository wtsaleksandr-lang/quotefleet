/**
 * Structural invariants of the customer quote widget (public/widget.html).
 *
 * A stray </div> had been sitting in this file long enough to produce three
 * separate visible bugs, none of which looked like a nesting problem:
 *
 *   1. #qf-step-quote closed BEFORE the CTA / error / result, so those were
 *      siblings of the step rather than children. The step machine hides
 *      #qf-step-quote to show the thanks screen — which left a full 771px
 *      result card, a "Recalculate" button and the disclaimer on screen
 *      underneath the thank-you message.
 *   2. #qf-root closed early too, so #qf-step-thanks, #qf-footer-note and
 *      #qf-powered were <body> children OUTSIDE the widget card — the
 *      powered-by line measured 1412px wide against a 620px card.
 *   3. `body.qf-app-calculator #qf-step-quote > .qf-customer-note {display:none}`
 *      (public-calculator-app-style.css) could never match, so a note somebody
 *      had deliberately hidden shipped anyway.
 *
 * The browser silently swallows the extra tag, so nothing failed loudly. These
 * assertions are cheap and would have caught it on the commit that introduced it.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');
const load = () => readFile(resolve(publicDir, 'widget.html'), 'utf8');

/** Index of the </div> that closes the <div> opened at `openIdx`. */
function matchingClose(html: string, openIdx: number): number {
  const tag = /<div\b|<\/div>/g;
  tag.lastIndex = openIdx;
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(html))) {
    depth += m[0] === '</div>' ? -1 : 1;
    if (depth === 0) return m.index;
  }
  return -1;
}

describe('widget.html structure', () => {
  it('has balanced <div> tags', async () => {
    const html = await load();
    const opens = (html.match(/<div\b/g) ?? []).length;
    const closes = (html.match(/<\/div>/g) ?? []).length;
    expect(closes).toBe(opens);
  });

  it('keeps the CTA, error and result INSIDE #qf-step-quote so the step machine can hide them', async () => {
    const html = await load();
    const start = html.indexOf('id="qf-step-quote"');
    expect(start).toBeGreaterThan(-1);
    const open = html.lastIndexOf('<div', start);
    const close = matchingClose(html, open);
    expect(close).toBeGreaterThan(open);
    const step = html.slice(open, close);
    for (const id of ['qf-calc-btn', 'qf-error', 'qf-result']) {
      expect(step).toContain(`id="${id}"`);
    }
    expect(step).toContain('class="qf-customer-note"');
  });

  it('keeps both steps and both footers INSIDE the #qf-root widget card', async () => {
    const html = await load();
    const open = html.indexOf('<div class="qf-widget" id="qf-root">');
    expect(open).toBeGreaterThan(-1);
    const close = matchingClose(html, open);
    const root = html.slice(open, close);
    for (const id of ['qf-step-quote', 'qf-step-thanks', 'qf-footer-note', 'qf-powered']) {
      expect(root).toContain(`id="${id}"`);
    }
  });

  it('keeps BOTH modals OUT of the widget card', async () => {
    // .qf-map-modal and .qf-modal are position:fixed. A fixed element is
    // positioned against the nearest ancestor with a filter/backdrop-filter/
    // transform — and on the frosted presets #qf-root carries
    // `backdrop-filter: blur(30px)`. Nested inside it, the "full route map"
    // rendered 618px wide, off-centre, 26px larger than the inline map it was
    // supposed to enlarge; #qf-options-modal, already a <body> child, centred
    // correctly in the same page. Both must stay body-level.
    const html = await load();
    const open = html.indexOf('<div class="qf-widget" id="qf-root">');
    const root = html.slice(open, matchingClose(html, open));
    expect(root).not.toContain('id="qf-map-modal"');
    expect(root).not.toContain('id="qf-options-modal"');
    expect(html).toContain('id="qf-map-modal"');
    expect(html).toContain('id="qf-options-modal"');
  });

  it('announces every error slot to assistive tech', async () => {
    const html = await load();
    for (const id of ['qf-error', 'qf-submit-error', 'qf-cb-error']) {
      const idx = html.indexOf(`id="${id}"`);
      expect(idx, `${id} missing`).toBeGreaterThan(-1);
      const tag = html.slice(html.lastIndexOf('<', idx), html.indexOf('>', idx));
      expect(tag, `${id} needs role="alert"`).toContain('role="alert"');
      expect(tag, `${id} needs aria-live`).toContain('aria-live="assertive"');
    }
  });
});
