/**
 * Affiliate/referral PURE terms + tier logic + code format.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveTier,
  commissionRateForTier,
  tierProgress,
  estimateMonthlyCommissionCents,
  generateCode,
  normalizeCode,
  isValidCodeShape,
  AFFILIATE_BASE_RATE,
  AFFILIATE_PRO_RATE,
  AFFILIATE_PRO_THRESHOLD,
  AFFILIATE_PARTNER_RATE,
  CODE_ALPHABET,
  CODE_LENGTH,
} from './programs.js';

describe('affiliate tier + commission logic', () => {
  it('maps active-customer count to the right tier', () => {
    expect(resolveTier(0)).toBe('base');
    expect(resolveTier(9)).toBe('base');
    expect(resolveTier(10)).toBe('pro');
    expect(resolveTier(50)).toBe('pro');
  });

  it('returns the published rate per tier', () => {
    expect(commissionRateForTier('base')).toBe(AFFILIATE_BASE_RATE);
    expect(commissionRateForTier('pro')).toBe(AFFILIATE_PRO_RATE);
    expect(commissionRateForTier('partner')).toBe(AFFILIATE_PARTNER_RATE);
    expect(AFFILIATE_BASE_RATE).toBe(0.25);
    expect(AFFILIATE_PRO_RATE).toBe(0.3);
  });

  it('reports progress toward the next tier for a base affiliate', () => {
    const p = tierProgress(3);
    expect(p.tier).toBe('base');
    expect(p.nextTier).toBe('pro');
    expect(p.toNextTier).toBe(AFFILIATE_PRO_THRESHOLD - 3);
    expect(p.rate).toBe(AFFILIATE_BASE_RATE);
  });

  it('treats a pro affiliate as top-of-ladder with partner next', () => {
    const p = tierProgress(12);
    expect(p.tier).toBe('pro');
    expect(p.toNextTier).toBe(0);
    expect(p.nextTier).toBe('partner');
  });

  it('keeps a hand-set partner at partner regardless of count', () => {
    const p = tierProgress(2, 'partner');
    expect(p.tier).toBe('partner');
    expect(p.nextTier).toBeNull();
    expect(p.rate).toBe(AFFILIATE_PARTNER_RATE);
  });

  it('estimates monthly commission from customers × revenue × rate', () => {
    // 4 customers × $24.80 × 25% = $24.80 → 2480 cents
    expect(estimateMonthlyCommissionCents(4, 2480, 0.25)).toBe(2480);
    expect(estimateMonthlyCommissionCents(0, 2480, 0.25)).toBe(0);
  });
});

describe('referral/affiliate code format', () => {
  it('generates codes of the right length from the safe alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateCode();
      expect(code).toHaveLength(CODE_LENGTH);
      for (const ch of code) expect(CODE_ALPHABET).toContain(ch);
      expect(isValidCodeShape(code)).toBe(true);
    }
  });

  it('is deterministic given an injected randomness source', () => {
    const seq = [0, 0, 0, 0, 0, 0, 0, 0];
    let i = 0;
    const rand = () => seq[i++ % seq.length];
    expect(generateCode(rand)).toBe(CODE_ALPHABET[0].repeat(CODE_LENGTH));
  });

  it('normalizes user-supplied ?ref values (case, junk, length)', () => {
    expect(normalizeCode('  abcd2345 ')).toBe('ABCD2345');
    expect(normalizeCode('ab-cd_23')).toBe('ABCD23');
    expect(normalizeCode('')).toBe('');
    expect(normalizeCode(null)).toBe('');
    expect(normalizeCode('x'.repeat(40))).toHaveLength(16);
  });

  it('rejects malformed code shapes', () => {
    expect(isValidCodeShape('AB')).toBe(false); // too short
    expect(isValidCodeShape('ABCD2345')).toBe(true);
    expect(isValidCodeShape('')).toBe(false);
  });
});
