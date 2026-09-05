/**
 * THE TWO AXLE CALCULATORS' GUARD TESTS.
 *
 * The arithmetic itself is already pinned by `bridgeFormula.test.ts`, which
 * walks all 265 published federal table cells. What is tested here is the layer
 * on top of it — the part a calculator gets wrong in a way a user cannot see:
 *
 *   - that EVERY group is enumerated, not the obvious three;
 *   - that the headroom column is the allowance minus the load, so a group
 *     sitting exactly on its limit reads 0 rather than passing silently;
 *   - that a state whose own documents disagree produces "cannot tell" rather
 *     than a verdict;
 *   - and that the endpoint refuses bad geometry instead of computing on it.
 */
import { describe, expect, it } from 'vitest';
import {
  AXLE_PRESETS,
  axleGroups,
  evaluateAxles,
  renderAxleToolPage,
  renderBridgeToolPage,
} from './osowTools.js';

const ASOF = '2026-09-05';

const FIVE_AXLE = AXLE_PRESETS.find((p) => p.id === 'five-axle')!.axles;
const THREE_AXLE = AXLE_PRESETS.find((p) => p.id === 'three-axle')!.axles;
const NINE_AXLE = AXLE_PRESETS.find((p) => p.id === 'nine-axle')!.axles;

describe('every group is checked', () => {
  it('enumerates N(N-1)/2 groups, not the three anyone would name', () => {
    for (const preset of AXLE_PRESETS) {
      const n = preset.axles.length;
      const r = evaluateAxles({ axles: preset.axles, asOf: ASOF });
      expect(r.groupsChecked).toBe((n * (n - 1)) / 2);
      expect(r.groups).toHaveLength((n * (n - 1)) / 2);
    }
    // The headline case: a 5-axle rig has ten groups, not three.
    expect(evaluateAxles({ axles: FIVE_AXLE, asOf: ASOF }).groupsChecked).toBe(10);
    expect(evaluateAxles({ axles: NINE_AXLE, asOf: ASOF }).groupsChecked).toBe(36);
  });

  it('reports headroom as allowance minus load on every group', () => {
    for (const g of axleGroups(FIVE_AXLE)) {
      expect(g.headroomLbs).toBe(g.allowedLbs - g.actualLbs);
      expect(g.lastAxle).toBeGreaterThan(g.firstAxle);
      expect(g.axleCount).toBe(g.lastAxle - g.firstAxle + 1);
    }
  });

  /**
   * The standard 80,000 lb van is legal ONLY because of the statutory
   * two-tandem exception; the bare formula allows 66,000 lb across that
   * geometry. A calculator that loses the exception flags every legal van in
   * the country, which is the loudest possible way to be wrong.
   */
  it('passes the standard 5-axle van at exactly 80,000 lb', () => {
    const r = evaluateAxles({ axles: FIVE_AXLE, asOf: ASOF });
    expect(r.grossWeightLbs).toBe(80000);
    expect(r.compliant).toBe(true);
    expect(r.violations).toHaveLength(0);
  });

  it('catches the short-wheelbase rig a gross-weight check would pass', () => {
    const heavy = THREE_AXLE.map((a) => ({ ...a, weightLbs: a.weightLbs + 3000 }));
    const gross = heavy.reduce((s, a) => s + a.weightLbs, 0);
    expect(gross).toBeLessThan(80000);
    const r = evaluateAxles({ axles: heavy, asOf: ASOF });
    expect(r.compliant).toBe(false);
    expect(r.violations.length).toBeGreaterThan(0);
  });

  /**
   * A group's allowance is capped by the VEHICLE's own weight, not by the
   * federal 80,000 lb gross limit. Clamping at 80,000 fabricates overages of up
   * to 25,500 lb on permitted loads whose groups are in fact compliant — on
   * exactly the heavy-haul moves the tool exists for.
   */
  it('does not fabricate overages on a permitted load above 80,000 lb', () => {
    const r = evaluateAxles({ axles: NINE_AXLE, asOf: ASOF });
    expect(r.grossWeightLbs).toBeGreaterThan(80000);
    // The ONLY violation is the flat federal gross limit — a limit on the
    // VEHICLE. Every axle group is inside its own allowance.
    expect(r.violations.map((v) => v.rule)).toEqual(['gross-weight']);
    // And the proof that no 80,000 lb clamp is in play: at least one group is
    // allowed more than the federal gross limit, because a group's ceiling is
    // the vehicle's own weight rather than the statutory gross figure.
    expect(Math.max(...r.groups.map((g) => g.allowedLbs))).toBeGreaterThan(80000);
  });
});

describe('state limits', () => {
  it('carries the statute and both dates on every resolved verdict line', () => {
    const r = evaluateAxles({ axles: FIVE_AXLE, state: 'TX', asOf: ASOF });
    expect(r.state?.code).toBe('TX');
    expect(r.state?.lines).toHaveLength(3);
    for (const line of r.state!.lines) {
      if (line.limit === null) continue;
      expect(line.sourceUrl).toMatch(/^https?:\/\//);
      expect(line.retrievedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(['under', 'over']).toContain(line.verdict);
    }
  });

  /**
   * Georgia's own documents disagree on the single-axle and tandem limits. The
   * honest output is "cannot tell" with both readings — never the newer one
   * picked silently, and never a pass.
   */
  it('refuses a verdict where the state disagrees with itself', () => {
    const r = evaluateAxles({ axles: FIVE_AXLE, state: 'GA', asOf: ASOF });
    const conflicted = r.state!.lines.filter((l) => l.absence === 'conflict');
    expect(conflicted.length).toBeGreaterThan(0);
    for (const line of conflicted) {
      expect(line.verdict).toBe('unknown');
      expect(line.limit).toBeNull();
      expect((line.conflict ?? []).length).toBeGreaterThan(1);
    }
    expect(r.requiresManualReview).toBe(true);
    expect(r.warnings.some((w) => w.includes('disagree'))).toBe(true);
  });

  it('warns rather than silently ignoring an uncovered state', () => {
    const r = evaluateAxles({ axles: FIVE_AXLE, state: 'WY', asOf: ASOF });
    expect(r.state).toBeNull();
    expect(r.warnings.some((w) => w.includes('WY'))).toBe(true);
  });

  it('applies no state limits when none was asked for', () => {
    expect(evaluateAxles({ axles: FIVE_AXLE, asOf: ASOF }).state).toBeNull();
  });
});

describe('refusals', () => {
  it('refuses to compute on axles that do not run front to rear', () => {
    const r = evaluateAxles({
      axles: [
        { positionFt: 0, weightLbs: 12000 },
        { positionFt: 20, weightLbs: 17000 },
        { positionFt: 10, weightLbs: 17000 },
      ],
      asOf: ASOF,
    });
    expect(r.compliant).toBe(false);
    expect(r.requiresManualReview).toBe(true);
    expect(r.groupsChecked).toBe(0);
    expect(r.groups).toHaveLength(0);
    expect(r.warnings.join(' ')).toMatch(/must increase from front to rear/);
  });

  it('names what the answer does not include, in every response', () => {
    const r = evaluateAxles({ axles: FIVE_AXLE, asOf: ASOF });
    expect(r.notIncluded.length).toBeGreaterThan(2);
    expect(r.notIncluded.join(' ')).toMatch(/escort/i);
    expect(r.notIncluded.join(' ')).toMatch(/permit fee/i);
  });
});

describe('the tool pages', () => {
  const pages: Array<[string, string]> = [
    ['bridge formula', renderBridgeToolPage()],
    ['axle weights', renderAxleToolPage()],
  ];

  it.each(pages)('%s has one H1, a canonical and valid JSON-LD', (_n, html) => {
    expect((html.match(/<h1[ >]/g) ?? []).length).toBe(1);
    expect(html).toContain('<link rel="canonical" href="https://quotefleet.net/tools/');
    const blocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) ?? [];
    expect(blocks.length).toBeGreaterThan(0);
    for (const b of blocks) {
      const json = b.replace(/^<script type="application\/ld\+json">/, '').replace(/<\/script>$/, '');
      expect(() => JSON.parse(json)).not.toThrow();
    }
  });

  it.each(pages)('%s declares itself a free WebApplication', (_n, html) => {
    expect(html).toContain('"@type":"WebApplication"');
    expect(html).toContain('"price":"0"');
  });

  it('offers exactly four presets, so the pill grid never orphans one', () => {
    expect(AXLE_PRESETS).toHaveLength(4);
    expect(new Set(AXLE_PRESETS.map((p) => p.id)).size).toBe(4);
  });

  it('offers a state selector on the axle tool and not on the bridge tool', () => {
    const [, bridge] = pages[0]!;
    const [, axle] = pages[1]!;
    expect(axle).toContain('id="qt-state"');
    expect(bridge).not.toContain('id="qt-state"');
  });

  it('cross-links the two tools and the reference hub', () => {
    const [, bridge] = pages[0]!;
    const [, axle] = pages[1]!;
    expect(bridge).toContain('/tools/axle-weights');
    expect(bridge).toContain('/oversize/bridge-formula');
    expect(axle).toContain('/oversize/legal-limits');
    expect(axle).toContain('/tools/oversize-permits');
  });
});
