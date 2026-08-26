/**
 * HS-code / commodity autosuggest — pure matcher tests (no network).
 */
import { describe, it, expect } from 'vitest';
import { suggestCommodity, HS_CODES } from './hsCodes.js';

describe('suggestCommodity', () => {
  it('returns nothing for an empty query', () => {
    expect(suggestCommodity('')).toEqual([]);
    expect(suggestCommodity('   ')).toEqual([]);
  });

  it('matches on a numeric HS code prefix and ranks the exact code first', () => {
    const out = suggestCommodity('8202');
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].value).toBe('8202');
    expect(out[0].kind).toBe('hs');
    expect(out[0].label).toContain('saw');
  });

  it('matches on a description word', () => {
    const out = suggestCommodity('furniture');
    expect(out.some((s) => s.value === '9403')).toBe(true);
  });

  it('matches a plain product keyword via an alias (sneakers → footwear)', () => {
    const out = suggestCommodity('sneakers');
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].kind).toBe('keyword');
    expect(out[0].value).toBe('sneakers');
    expect(out[0].label).toContain('HS 6404');
  });

  it('never returns more than the limit', () => {
    expect(suggestCommodity('a', 5).length).toBeLessThanOrEqual(5);
  });

  it('every reference row has a 4–6 digit code and a description', () => {
    for (const h of HS_CODES) {
      expect(/^[0-9]{4,6}$/.test(h.code)).toBe(true);
      expect(h.description.length).toBeGreaterThan(2);
    }
  });
});
