import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { OSOW_JURISDICTIONS } from './jurisdictions/index.js';
import { maxQuotableWeightLbs, quotableCeilingFor } from './engine.js';
import { resolveSourced } from './provenance.js';
import { thresholdsEqual, type Threshold } from './types.js';

/**
 * The widget is a hand-rolled browser bundle that cannot import the TypeScript
 * calc layer, so it mirrors the superload thresholds as a literal. A mirror
 * that silently drifts is worse than no mirror: the client would wave through
 * a load the server then rejects, or block one the server could price. These
 * tests fail the build the moment the two disagree.
 */

const here = dirname(fileURLToPath(import.meta.url));
const WIDGET = join(here, '..', '..', 'server', 'public', 'widget.js');

function widgetSource(): string {
  return readFileSync(WIDGET, 'utf8');
}

/** Parse the `var OSOW_SUPERLOAD_LBS = { TX: 254300 };` literal. */
function mirroredThresholds(): Record<string, number> {
  const src = widgetSource();
  const match = /var OSOW_SUPERLOAD_LBS = \{([^}]*)\};/.exec(src);
  expect(match, 'widget.js must declare OSOW_SUPERLOAD_LBS').not.toBeNull();
  const body = (match as RegExpExecArray)[1] as string;
  const out: Record<string, number> = {};
  for (const pair of body.split(',')) {
    const trimmed = pair.trim();
    if (trimmed === '') continue;
    const [key, value] = trimmed.split(':').map((s) => s.trim());
    out[(key as string).replace(/['"]/g, '')] = Number(value);
  }
  return out;
}

/**
 * Phase 4 moved this a day forward and Phase 5 moved it one more, for the same
 * reason both times. Alabama's superload memorandum carries NO revision date, so
 * its threshold row is effective only from the date we read it; Louisiana's
 * statutes state a bare year and Colorado's CDOT fee page states nothing, so
 * both of their threshold rows start on THEIR retrieval date (2026-09-03). A
 * mirror test running on the day before would find the server refusing a ceiling
 * the widget publishes, which is the exact drift these tests exist to catch. The
 * date is a retrieval date, not a convenience.
 */
const ASOF = '2026-09-03';

/**
 * The ceiling the SERVER would allow for a same-state lane, or `null` where the
 * server has no defensible ceiling above the federal fallback — Illinois
 * publishes no numeric gross-weight superload threshold, and Indiana's agencies
 * publish three that disagree. Those two must NOT appear in the widget's table:
 * mirroring a threshold the server refuses to resolve would let the client wave
 * through a load the server then sends to a human.
 */
function serverCeilingFor(code: string): number | null {
  const rules = OSOW_JURISDICTIONS[code];
  if (rules === undefined) return null;
  const rows = rules.superload.grossWeight;
  if (rows === undefined) return null;
  const resolved = resolveSourced<Threshold>(
    `${code} superload threshold`,
    rows,
    ASOF,
    thresholdsEqual,
  );
  return resolved.value === null ? null : quotableCeilingFor(resolved.value);
}

describe('widget mirror of the OS/OW weight ceiling', () => {
  it('still declares the 80,000 lb federal fallback', () => {
    expect(widgetSource()).toContain('var MAX_QUOTABLE_WEIGHT_LBS = 80000;');
  });

  it('mirrors exactly the jurisdictions whose superload threshold resolves', () => {
    const expected = Object.keys(OSOW_JURISDICTIONS)
      .filter((code) => serverCeilingFor(code) !== null)
      .sort();
    expect(Object.keys(mirroredThresholds()).sort()).toEqual(expected);
  });

  it('omits a covered state whose superload threshold does not resolve', () => {
    // Illinois publishes none; Indiana publishes three that disagree. Oklahoma
    // defines a superload against Standard Drawing OL-1, a configuration rather
    // than a weight. Florida has no superload class at all — and mirroring the
    // 300,000 lb structural-evaluation trigger it DOES publish would be the
    // worst case of all, because the server's Florida per-mile schedule stops at
    // 162,000 lb and would refuse a load the widget had already accepted.
    // All four are covered jurisdictions and all four keep the federal ceiling.
    const mirrored = mirroredThresholds();
    for (const code of ['IL', 'IN', 'OK', 'FL']) {
      expect(OSOW_JURISDICTIONS[code], `${code} must still be covered`).toBeDefined();
      expect(serverCeilingFor(code), `${code} must not resolve a ceiling`).toBeNull();
      expect(mirrored[code]).toBeUndefined();
      expect(maxQuotableWeightLbs(code, code, 80000, ASOF)).toBe(80000);
    }
  });

  it('mirrors each jurisdiction’s quotable ceiling to the pound', () => {
    const mirrored = mirroredThresholds();
    for (const code of Object.keys(mirrored)) {
      const ceiling = serverCeilingFor(code);
      expect(ceiling, `${code} superload threshold must resolve`).not.toBeNull();
      expect(mirrored[code]).toBe(ceiling);
      // The mirror is only useful if it agrees with the function the server
      // actually calls, for every state in it — not just for Texas.
      expect(maxQuotableWeightLbs(code, code, 80000, ASOF)).toBe(
        Math.max(80000, ceiling as number),
      );
    }
  });

  it('agrees with the server function on a same-state covered lane', () => {
    const mirrored = mirroredThresholds();
    expect(maxQuotableWeightLbs('TX', 'TX', 80000, ASOF)).toBe(mirrored['TX']);
    expect(maxQuotableWeightLbs('tx', 'TX', 80000, ASOF)).toBe(254300);
  });

  it('agrees that a cross-state lane keeps the 80,000 lb ceiling', () => {
    // We know the endpoints, not the route. A TX→OK load crosses at least one
    // state we hold no permit data for.
    expect(maxQuotableWeightLbs('TX', 'OK', 80000, ASOF)).toBe(80000);
    expect(maxQuotableWeightLbs('OK', 'OK', 80000, ASOF)).toBe(80000);
  });

  it('agrees that an unknown or missing state keeps the 80,000 lb ceiling', () => {
    expect(maxQuotableWeightLbs(undefined, undefined, 80000, ASOF)).toBe(80000);
    expect(maxQuotableWeightLbs('TX', '', 80000, ASOF)).toBe(80000);
    expect(maxQuotableWeightLbs(null, 'TX', 80000, ASOF)).toBe(80000);
    expect(maxQuotableWeightLbs('ZZ', 'ZZ', 80000, ASOF)).toBe(80000);
  });

  it('never returns a ceiling BELOW the federal fallback', () => {
    // A jurisdiction whose threshold were somehow under 80,000 must not
    // narrow what we already quote today.
    for (const code of Object.keys(OSOW_JURISDICTIONS)) {
      expect(maxQuotableWeightLbs(code, code, 80000, ASOF)).toBeGreaterThanOrEqual(80000);
    }
  });

  it('calls the mirrored helper from the widget’s weight guard', () => {
    expect(widgetSource()).toContain(
      'req.weightLbs > maxQuotableWeightLbs(req.pickup, req.delivery)',
    );
  });
});
