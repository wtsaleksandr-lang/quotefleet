/**
 * Canadian province code ↔ name ↔ slug resolution for the carrier directory.
 * Pure; no DB / network.
 */
import { describe, it, expect } from 'vitest';
import {
  CA_PROVINCES,
  CA_PROVINCE_CODES,
  provinceByCode,
  provinceBySlug,
} from './caProvinces.js';

describe('CA_PROVINCE_CODES', () => {
  it('covers all 10 provinces + 3 territories', () => {
    expect(CA_PROVINCES).toHaveLength(13);
    for (const code of ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT']) {
      expect(CA_PROVINCE_CODES.has(code)).toBe(true);
    }
    // A US state / Mexican code is NOT a province.
    expect(CA_PROVINCE_CODES.has('CA')).toBe(false); // California is a US state, not Canada
    expect(CA_PROVINCE_CODES.has('AG')).toBe(false);
  });
});

describe('provinceByCode', () => {
  it('resolves a known code to {code,name,slug}', () => {
    expect(provinceByCode('ON')).toEqual({ code: 'ON', name: 'Ontario', slug: 'ontario' });
    expect(provinceByCode('bc')).toEqual({
      code: 'BC',
      name: 'British Columbia',
      slug: 'british-columbia',
    });
  });
  it('synthesizes an entry for an unknown-but-valid 2-letter code (renders, not 404)', () => {
    expect(provinceByCode('ZZ')).toEqual({ code: 'ZZ', name: 'ZZ', slug: 'zz' });
  });
  it('returns null for empty / invalid input', () => {
    expect(provinceByCode(null)).toBeNull();
    expect(provinceByCode('1')).toBeNull();
  });
});

describe('provinceBySlug', () => {
  it('resolves a slug back to the province', () => {
    expect(provinceBySlug('quebec')?.code).toBe('QC');
    expect(provinceBySlug('newfoundland-and-labrador')?.code).toBe('NL');
  });
  it('returns null for an unknown slug', () => {
    expect(provinceBySlug('california')).toBeNull();
    expect(provinceBySlug(null)).toBeNull();
  });
});
