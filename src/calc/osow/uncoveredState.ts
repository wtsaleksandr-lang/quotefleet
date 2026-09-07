/**
 * THE UNCOVERED STATE, ASKED OF THE ENGINE RATHER THAN WRITTEN DOWN.
 *
 * A dozen tests across the unit and end-to-end suites prove that a state the
 * engine does not hold is NAMED and left unpriced — never charged $0, never
 * inferred from a neighbour, never quietly dropped out of a lane total. Every
 * one of them needs a state that is genuinely uncovered to drive that path.
 *
 * WRITING ONE DOWN HAS NOW BROKEN THE SUITE THREE TIMES. Mississippi was the
 * canonical uncovered state until Mississippi was encoded; the tests were moved
 * to West Virginia; West Virginia was then encoded and thirteen tests failed
 * across four files in one commit. Each time the failure looked like a broken
 * refusal and was nothing of the kind — the refusal worked perfectly, on a
 * state that no longer needed it.
 *
 * The set of uncovered states shrinks by design and by roadmap. ANY STATE NAMED
 * IN A TEST IS A STATE THE PROJECT IS ACTIVELY TRYING TO INVALIDATE, which
 * makes a hardcoded code a scheduled false alarm rather than an assertion.
 *
 * So ask `hasOsowCoverage` — the same predicate the calculator itself uses.
 * That makes these tests true by construction for as long as any state remains
 * unencoded, and makes them fail LOUDLY, with an instruction, on the day the
 * last one is added rather than silently asserting nothing.
 *
 * This lives in `src/` rather than beside either suite because both the vitest
 * tests and the Playwright specs import it, and a helper duplicated in two
 * places is the same bug waiting to happen a fourth time.
 */
import { hasOsowCoverage } from './jurisdictions/index.js';

export interface UncoveredState {
  /** Two-letter code, as the form and the API take it. */
  code: string;
  /** Full name, as the page prints it. */
  name: string;
}

/**
 * Preferred first, so a test lane stays geographically plausible and its
 * mileage reads like a real leg rather than a teleport. These are ordinary
 * lower-48 states on routes a heavy load actually runs. The fallback below
 * accepts any uncovered state once every preference has been encoded.
 */
const PREFERRED: ReadonlyArray<UncoveredState> = [
  { code: 'ND', name: 'North Dakota' },
  { code: 'WY', name: 'Wyoming' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'VT', name: 'Vermont' },
  { code: 'ME', name: 'Maine' },
  { code: 'DE', name: 'Delaware' },
  { code: 'MT', name: 'Montana' },
  { code: 'ID', name: 'Idaho' },
];

/**
 * A SECOND uncovered state, for the tests that need a lane touching two of
 * them. Distinct from `anUncoveredState()` by construction.
 */
export function uncoveredStates(howMany: number): UncoveredState[] {
  const found = PREFERRED.filter((s) => !hasOsowCoverage(s.code));
  if (found.length < howMany) {
    throw new Error(
      `Only ${found.length} of the preferred uncovered states are still uncovered, ` +
        `and this test needs ${howMany}. Either add more entries to PREFERRED in ` +
        'src/calc/osow/uncoveredState.ts, or — if the corpus is nearly complete — ' +
        'replace the tests that need several uncovered states with unit tests over ' +
        'synthetic codes, so the refusal path stays covered without depending on a ' +
        'coverage gap.',
    );
  }
  return found.slice(0, howMany);
}

export function anUncoveredState(): UncoveredState {
  return uncoveredStates(1)[0]!;
}
