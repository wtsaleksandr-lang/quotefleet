/**
 * THE UNCOVERED STATE, CHOSEN AT RUN TIME.
 *
 * Two tests in this suite prove the engine refuses to price a state it does not
 * hold: it names the state, charges nothing for it, and labels the figure a
 * partial rather than a lane total. Both were written against Mississippi
 * because Mississippi happened to be uncovered on the day they were written.
 *
 * Then Mississippi was encoded, the lane priced in full, and both tests failed
 * — not because the refusal broke, but because they had pinned the ANSWER
 * ("Mississippi is uncovered") instead of the RULE ("an uncovered state is
 * named and unpriced"). That is a false alarm, it costs a debugging session
 * every time, and it recurs on every research wave: the set of uncovered states
 * shrinks by design, so any state named in a test is a state the roadmap is
 * actively trying to invalidate.
 *
 * So ask the engine. `hasOsowCoverage` is the same predicate the calculator
 * uses, which makes this test true by construction for as long as any state
 * remains unencoded — and when the last one is encoded it fails LOUDLY, with an
 * instruction, rather than silently asserting nothing.
 */
import { hasOsowCoverage } from '../../src/calc/osow/jurisdictions/index';
import { US_STATES } from '../../src/server/directory/usStates';

/**
 * Preferred first, so the lane stays geographically plausible and the mileage
 * in the test reads like a real leg rather than a teleport. These are ordinary
 * lower-48 states on routes a heavy load actually runs; the fallback below
 * accepts any uncovered state if every preference has since been encoded.
 */
const PREFERRED = ['WV', 'ND', 'SD', 'WY', 'RI', 'CT', 'NH'] as const;

export interface UncoveredState {
  /** Two-letter code, as the form takes it. */
  code: string;
  /** Full name, as the page prints it. */
  name: string;
}

export function anUncoveredState(): UncoveredState {
  const pick =
    PREFERRED.find((code) => !hasOsowCoverage(code)) ??
    US_STATES.find((s) => !hasOsowCoverage(s.code))?.code;

  if (!pick) {
    throw new Error(
      'Every US state now has OS/OW coverage. That is the goal, and it means ' +
        'this test has outlived its subject: there is no longer an uncovered ' +
        'state for it to drive. Delete the refusal tests that call this helper ' +
        'and replace them with a unit test over a synthetic uncovered code, so ' +
        'the refusal path stays covered without depending on a coverage gap.',
    );
  }

  const name = US_STATES.find((s) => s.code === pick)?.name;
  if (!name) throw new Error(`No state name known for code ${pick}.`);
  return { code: pick, name };
}
