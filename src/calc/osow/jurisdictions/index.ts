/**
 * The jurisdiction registry.
 *
 * Phase 1 kept this in `texas.ts` because there was one state. Phase 2 adds
 * five more and the registry moves here, so that adding a state is: write the
 * data file, add one line below. Nothing in `engine.ts`, `escortRules.ts`,
 * `provenance.ts` or `types.ts` changes to add a jurisdiction — that has been
 * the design constraint since Phase 1 and it still holds.
 *
 * WHAT IS HERE IS EXACTLY WHAT EXISTS. An earlier draft of this file imported
 * Arkansas, Tennessee and Kentucky, whose data files were never written; the
 * build failed on three missing modules. The registry must never name a
 * jurisdiction ahead of its dataset — `calculateOsow` refuses loudly for any
 * state that is not here, and that refusal is the honest answer for a state we
 * have not sourced. Six are covered: TX, OH, PA, NY, IL, IN.
 */
import type { JurisdictionOsowRules } from '../types.js';
import { TEXAS_OSOW_RULES } from './texas.js';
import { OHIO_OSOW_RULES } from './ohio.js';
import { PENNSYLVANIA_OSOW_RULES } from './pennsylvania.js';
import { NEW_YORK_OSOW_RULES } from './newYork.js';
import { ILLINOIS_OSOW_RULES } from './illinois.js';
import { INDIANA_OSOW_RULES } from './indiana.js';

export const OSOW_JURISDICTIONS: Record<string, JurisdictionOsowRules> = {
  TX: TEXAS_OSOW_RULES,
  OH: OHIO_OSOW_RULES,
  PA: PENNSYLVANIA_OSOW_RULES,
  NY: NEW_YORK_OSOW_RULES,
  IL: ILLINOIS_OSOW_RULES,
  IN: INDIANA_OSOW_RULES,
};

/** Is there OS/OW coverage for this state/province code? */
export function hasOsowCoverage(code: string): boolean {
  return Object.hasOwn(
    OSOW_JURISDICTIONS,
    String(code ?? '').trim().toUpperCase(),
  );
}

export function osowRulesFor(code: string): JurisdictionOsowRules | null {
  return OSOW_JURISDICTIONS[String(code ?? '').trim().toUpperCase()] ?? null;
}

export {
  TEXAS_OSOW_RULES,
  OHIO_OSOW_RULES,
  PENNSYLVANIA_OSOW_RULES,
  NEW_YORK_OSOW_RULES,
  ILLINOIS_OSOW_RULES,
  INDIANA_OSOW_RULES,
};
