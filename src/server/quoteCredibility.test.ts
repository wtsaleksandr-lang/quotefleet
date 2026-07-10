/**
 * Guards for customer-facing quote credibility (persona-audit fixes):
 *   - the carrier's margin is NEVER shown on any customer-facing surface
 *   - hosted-quote labels are service-aware (no drayage terms on FTL/LTL)
 *   - the demo brand card doesn't render literal placeholder contact rows
 *
 * These are source-level assertions (same style as accountCompanyDetails.test)
 * so a future edit that re-exposes margin or re-hardcodes drayage terminology
 * fails CI immediately.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');
const routesDir = resolve(process.cwd(), 'src/server/routes');
const aiDir = resolve(process.cwd(), 'src/ai');

const pub = (n: string) => readFile(resolve(publicDir, n), 'utf8');
const route = (n: string) => readFile(resolve(routesDir, n), 'utf8');
const ai = (n: string) => readFile(resolve(aiDir, n), 'utf8');

describe('margin is folded out of every customer-facing surface', () => {
  it('widget calc-result + lead responses fold margin server-side', async () => {
    const p = await route('public.ts');
    // both customer responses go through customerFacingLines
    expect(p).toContain('customerFacingLines(result.lines)');
    expect(p).toContain('customerFacingLines(calc.lines)');
    // the raw margin figure is not shipped on the calc result
    expect(p).toMatch(/margin:\s*0/);
    // the stored breakdown stays RAW (internal dashboard keeps margin)
    expect(p).toContain('breakdownJson: calc.lines.map');
  });

  it('hosted quote-doc folds margin out of the persisted breakdown', async () => {
    const q = await route('quoteDoc.ts');
    expect(q).toContain('customerFacingLines(lead.breakdownJson');
    // and no longer serves the raw breakdown directly
    expect(q).not.toContain('breakdown: lead.breakdownJson ?? []');
  });

  it('customer auto-reply email folds margin out', async () => {
    const r = await ai('replyAgent.ts');
    expect(r).toContain('customerFacingLines(l.breakdownJson');
    const prompts = await ai('prompts.ts');
    // the email prompt must not instruct the model to show margin
    expect(prompts).not.toMatch(/accessorials\s*\/\s*margin/i);
  });

  it('hosted quote client never renders a Margin price group', async () => {
    const js = await pub('quote.js');
    expect(js).not.toContain("byKind(lines, 'margin')");
    expect(js).not.toContain("'Drayage / Linehaul'");
  });
});

describe('hosted-quote labels are service-aware', () => {
  it('drayage-only detail rows are gated behind service === drayage', async () => {
    const js = await pub('quote.js');
    expect(js).toContain('isDrayage');
    // Steamship Line / Tri-axle live inside the drayage-only branch, not the
    // always-on rows array.
    expect(js).toMatch(/isDrayage[\s\S]*Steamship Line/);
    expect(js).toMatch(/isDrayage[\s\S]*Tri-axle/);
    // friendly equipment label preferred over the raw code
    expect(js).toContain('s.equipmentLabel');
  });

  it('pricing polish uses generic subtotal wording off drayage', async () => {
    const js = await pub('quote-polish.js');
    expect(js).toContain('isDrayage');
    // no unconditional "Sub Total Drayage" — it is now behind the ternary
    expect(js).toContain("isDrayage?'Sub Total Drayage':'Subtotal'");
  });

  it('quoteDoc exposes a friendly equipmentLabel', async () => {
    const q = await route('quoteDoc.ts');
    expect(q).toContain('equipmentLabel');
  });
});

describe('widget result shows friendly service + equipment names', () => {
  it('no raw service code / equipment code in the estimate meta', async () => {
    const js = await pub('widget.js');
    expect(js).toContain('SERVICE_LABELS');
    expect(js).toContain('friendlyEquipmentLabel');
    // the old raw-code meta string is gone
    expect(js).not.toContain("(state.service || 'truck') + ' · ' + normalizeEquipmentLabel(state.equipment");
  });
});

describe('demo brand card hides empty placeholder contact rows', () => {
  it('no literal placeholder contact values in the fallback', async () => {
    const js = await pub('public-calculator-conditional-options.js');
    expect(js).not.toContain("phone: 'Phone number'");
    expect(js).not.toContain("address: 'Company address'");
    expect(js).not.toContain("email: 'dispatch@yourcompany.com'");
    expect(js).not.toContain("usdot: 'USDOT #'");
  });
});
