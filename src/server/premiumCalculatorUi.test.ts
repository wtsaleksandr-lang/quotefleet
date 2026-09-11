import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('premium calculator UI', () => {
  it('keeps premium calculator assets mounted', async () => {
    const html = await file('widget.html');
    expect(html).toContain('/widget-style.css');
    expect(html).toContain('/public-calculator-ux.css');
    expect(html).toContain('qf-trust-strip');
    expect(html).toContain('qf-mini-stepper');
    expect(html).toContain('qf-result');
  });

  it('keeps the calculator visual hooks — flat, with no decorative layers', async () => {
    const css = await file('public-calculator-ux.css');

    expect(css).toContain('Phase BJ');
    expect(css).toContain('premium calculator visual system');
    // The header eyebrow badge is data-driven (shows the carrier's tagline,
    // live) instead of a hardcoded string; the "Instant freight estimate"
    // fallback moved to renderHeader() in widget.js.
    expect(css).toContain('attr(data-eyebrow)');
    // The result badge is a real labelled affordance, not decoration — it stays.
    expect(css).toContain('Quote estimate');
    expect(css).toContain('.qf-result::before');

    // Design refactor wave 1 — the measured reference design has ZERO
    // gradients, so the calculator must not reintroduce one. This file used to
    // REQUIRE a radial-gradient aurora plus the .qf-widget::before/::after
    // decorative stack, directly contradicting calculatorNoGradients.test.ts.
    // The contradiction is resolved in favour of NO GRADIENTS;
    // calculatorNoGradients.test.ts remains the authoritative rule.
    expect(css).not.toContain('radial-gradient');
    expect(css).not.toContain('linear-gradient');
    expect(css).not.toContain('.qf-widget::before');
    expect(css).not.toContain('.qf-widget::after');
  });
});
