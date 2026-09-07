/**
 * THE UNCOVERED STATE, FOR THE BROWSER SUITE.
 *
 * A thin re-export. The logic and the preference list live in
 * `src/calc/osow/uncoveredState.ts` so that the vitest suites and these
 * Playwright specs cannot drift apart — two copies of "which state is
 * uncovered" is the same bug that has already broken this project three times,
 * just waiting for a fourth.
 *
 * See that file for why it is asked of the engine rather than written down.
 */
export { anUncoveredState, uncoveredStates, type UncoveredState } from '../../src/calc/osow/uncoveredState';
