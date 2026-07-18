import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('calculator global color enforcement without gradients', () => {
  it('loads the no-gradient calculator override after the global color system', async () => {
    const js = await file('public-calculator-conditional-options.js');
    const colorIndex = js.indexOf("/quotefleet-color-system.css");
    const noGradientIndex = js.indexOf("/public-calculator-no-gradients.css");

    expect(colorIndex).toBeGreaterThan(-1);
    expect(noGradientIndex).toBeGreaterThan(colorIndex);
  });

  it('forces the quote tool onto the requested global palette and removes gradient backgrounds', async () => {
    const css = await file('public-calculator-no-gradients.css');

    expect(css).toContain('Phase CB');
    // Wave-1 theming: colours are now driven by --w-* custom properties whose
    // FALLBACKS are the original Midnight values, so an absent theme payload
    // still renders the current approved widget. Assert the token+fallback form.
    expect(css).toContain('background: var(--w-page-bg, #13181A) !important');
    expect(css).toContain('background: var(--w-surface, #1E2528) !important');
    expect(css).toContain('background: var(--w-input-bg, #E6E3E0) !important');
    expect(css).toContain('background: var(--w-input-bg-hover, #D4CFC9) !important');
    // Accent-filled TEXT surfaces use the WCAG-hardened solid accent (falls
    // back through --w-accent → the Midnight cobalt).
    expect(css).toContain('background: var(--w-accent-solid, var(--w-accent, #0D3CFC)) !important');
    expect(css).toContain('background-image: none !important');
    expect(css).toContain('body.qf-app-calculator .qf-result');
    expect(css).toContain('body.qf-app-calculator .qf-cta:disabled::after');
    // The base/global calculator rules must stay gradient-free — that is the
    // whole point of this override layer. The ONE sanctioned exception is the
    // Blurple (Stripe) preset's decorative aurora accent strip + gradient CTA,
    // strictly scoped to body[data-qf-preset="stripe"]. Strip that scoped tail
    // and assert the remaining (base) CSS is still entirely gradient-free.
    const base = css.replace(/body\[data-qf-preset="stripe"\][\s\S]*$/, '');
    expect(base).not.toContain('linear-gradient');
    expect(base).not.toContain('radial-gradient');
    // Any gradient that DOES survive belongs only to the scoped Stripe block.
    expect(css).not.toContain('radial-gradient');
  });
});
