import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { OSOW_JURISDICTIONS } from './jurisdictions/texas.js';
import { maxQuotableWeightLbs } from './engine.js';
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

const ASOF = '2026-08-31';

describe('widget mirror of the OS/OW weight ceiling', () => {
  it('still declares the 80,000 lb federal fallback', () => {
    expect(widgetSource()).toContain('var MAX_QUOTABLE_WEIGHT_LBS = 80000;');
  });

  it('mirrors exactly the jurisdictions the server covers', () => {
    expect(Object.keys(mirroredThresholds()).sort()).toEqual(
      Object.keys(OSOW_JURISDICTIONS).sort(),
    );
  });

  it('mirrors each jurisdiction’s superload threshold to the pound', () => {
    const mirrored = mirroredThresholds();
    for (const [code, rules] of Object.entries(OSOW_JURISDICTIONS)) {
      const resolved = resolveSourced<Threshold>(
        'superload threshold',
        rules.superload.grossWeight,
        ASOF,
        thresholdsEqual,
      );
      expect(resolved.value, `${code} superload threshold must resolve`).not.toBeNull();
      expect(mirrored[code]).toBe(resolved.value?.value);
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
