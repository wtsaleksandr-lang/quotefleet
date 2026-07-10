/**
 * Tests for the automatic fuel-surcharge (DOE-index) formula.
 *
 *   FSC ($/mi) = max(0, (diesel − peg) / mpg)
 */
import { describe, it, expect } from 'vitest';
import { autoFscPerMile } from './fuelSurcharge.js';
import { AUTO_FSC_DEFAULTS } from './defaults.js';

const peg = AUTO_FSC_DEFAULTS.pegUsdPerGal; // 1.25
const mpg = AUTO_FSC_DEFAULTS.mpg; // 6.0

describe('autoFscPerMile', () => {
  it('computes $/mile from diesel above the peg', () => {
    // (4.05 − 1.25) / 6 = 0.4666… → 0.467
    expect(autoFscPerMile({ dieselUsdPerGal: 4.05, pegUsdPerGal: peg, mpg })).toBeCloseTo(0.467, 3);
  });

  it('reproduces the classic +$0.01/mi per $0.06 over peg rule at 6 mpg', () => {
    const atPeg = autoFscPerMile({ dieselUsdPerGal: peg, pegUsdPerGal: peg, mpg });
    const sixCentsOver = autoFscPerMile({ dieselUsdPerGal: peg + 0.06, pegUsdPerGal: peg, mpg });
    expect(atPeg).toBe(0);
    expect(sixCentsOver - atPeg).toBeCloseTo(0.01, 5);
  });

  it('never goes negative when diesel is at or below the peg', () => {
    expect(autoFscPerMile({ dieselUsdPerGal: 1.0, pegUsdPerGal: peg, mpg })).toBe(0);
    expect(autoFscPerMile({ dieselUsdPerGal: peg, pegUsdPerGal: peg, mpg })).toBe(0);
  });

  it('guards against a zero / invalid mpg', () => {
    expect(autoFscPerMile({ dieselUsdPerGal: 4.0, pegUsdPerGal: peg, mpg: 0 })).toBe(0);
  });

  it('scales with diesel price', () => {
    const lo = autoFscPerMile({ dieselUsdPerGal: 3.5, pegUsdPerGal: peg, mpg });
    const hi = autoFscPerMile({ dieselUsdPerGal: 5.0, pegUsdPerGal: peg, mpg });
    expect(hi).toBeGreaterThan(lo);
  });
});
