/**
 * Canonical intermodal-terminal dataset invariants. Pure; no DB / network
 * (only imports the const array + lookup helper).
 */
import { describe, it, expect } from 'vitest';
import {
  INTERMODAL_TERMINALS,
  INTERMODAL_TERMINAL_COUNT,
  terminalByCode,
} from './terminals.js';

describe('INTERMODAL_TERMINALS', () => {
  it('has a meaningful number of top hubs (~30-40)', () => {
    expect(INTERMODAL_TERMINALS.length).toBeGreaterThanOrEqual(30);
    expect(INTERMODAL_TERMINALS.length).toBeLessThanOrEqual(45);
    expect(INTERMODAL_TERMINAL_COUNT).toBe(INTERMODAL_TERMINALS.length);
  });

  it('has unique codes', () => {
    const codes = INTERMODAL_TERMINALS.map((t) => t.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('has non-empty name / city / state on every row', () => {
    for (const t of INTERMODAL_TERMINALS) {
      expect(t.code.trim()).not.toBe('');
      expect(t.name.trim()).not.toBe('');
      expect(t.city.trim()).not.toBe('');
      expect(t.state).toMatch(/^[A-Z]{2}$/);
    }
  });

  it('has valid lat/lng ranges (North America)', () => {
    for (const t of INTERMODAL_TERMINALS) {
      expect(Number.isFinite(t.lat)).toBe(true);
      expect(Number.isFinite(t.lng)).toBe(true);
      // Global sanity...
      expect(t.lat).toBeGreaterThanOrEqual(-90);
      expect(t.lat).toBeLessThanOrEqual(90);
      expect(t.lng).toBeGreaterThanOrEqual(-180);
      expect(t.lng).toBeLessThanOrEqual(180);
      // ...tightened to the North-American box these hubs live in.
      expect(t.lat).toBeGreaterThan(20);
      expect(t.lat).toBeLessThan(60);
      expect(t.lng).toBeGreaterThan(-140);
      expect(t.lng).toBeLessThan(-60);
    }
  });

  it('only uses the two known countries, with BOTH present', () => {
    const countries = new Set(INTERMODAL_TERMINALS.map((t) => t.country));
    expect([...countries].sort()).toEqual(['CA', 'US']);
  });

  it('only uses the two known types, with BOTH present', () => {
    const types = new Set(INTERMODAL_TERMINALS.map((t) => t.type));
    expect([...types].sort()).toEqual(['rail', 'seaport']);
  });

  it('covers the key inland rail metros the coverage check flagged', () => {
    const codes = new Set(INTERMODAL_TERMINALS.map((t) => t.code));
    for (const code of ['USCHI', 'INLMEM', 'INLKCK', 'INLDFW', 'INLDEN', 'INLATL', 'INLTOR', 'INLCGY', 'INLWPG', 'INLEDM']) {
      expect(codes.has(code)).toBe(true);
    }
  });

  it('keeps the existing seaport gateways as seaport rows', () => {
    for (const code of ['USLAX', 'USNYC', 'CAVAN', 'CAMTR']) {
      expect(terminalByCode(code)?.type).toBe('seaport');
    }
  });
});

describe('terminalByCode', () => {
  it('resolves a known code and returns null otherwise', () => {
    expect(terminalByCode('USLAX')?.name).toBe('Port of Los Angeles');
    expect(terminalByCode('NOPE')).toBeNull();
    expect(terminalByCode(null)).toBeNull();
    expect(terminalByCode(undefined)).toBeNull();
  });
});
