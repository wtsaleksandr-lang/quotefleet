/**
 * Signup plan-default guard — the cheaper tier must be pre-selected.
 *
 * Conversion/ethics fix (onboarding audit 2026-08): the signup form used to
 * ship with the pricier **Pro ($34.80)** radio `checked` by default. Because
 * the selected tier is what the trial→bill flow treats as the customer's
 * intended plan, defaulting to the more expensive tier is a soft dark pattern
 * and a chargeback/support risk. The default MUST be **Vital ($14.80)**, the
 * cheaper tier — the user actively opts UP to Pro, never silently into it.
 *
 * This asserts against the real shipped markup (src/server/public/signup.html)
 * so a regression that moves `checked` back to Pro fails the suite.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, 'signup.html'), 'utf8');

/** Extract the single <input …> tag for the plan radio of the given value. */
function planRadio(value: 'vital' | 'pro'): string {
  const re = new RegExp(`<input[^>]*name="plan"[^>]*value="${value}"[^>]*>`);
  const m = html.match(re);
  expect(m, `plan radio for "${value}" must exist`).toBeTruthy();
  return m![0];
}

describe('signup.html — plan default', () => {
  it('pre-selects Vital (the cheaper tier), not Pro', () => {
    expect(/\bchecked\b/.test(planRadio('vital'))).toBe(true);
    expect(/\bchecked\b/.test(planRadio('pro'))).toBe(false);
  });

  it('exactly one plan radio is checked by default', () => {
    const checked = (html.match(/<input[^>]*name="plan"[^>]*\bchecked\b[^>]*>/g) || []).length;
    expect(checked).toBe(1);
  });

  it('still renders both tiers with their current prices', () => {
    expect(html).toContain('Vital — $14.80/mo');
    expect(html).toContain('Pro — $34.80/mo');
  });
});
