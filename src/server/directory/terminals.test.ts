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
  it('has a comprehensive but metro-level number of top hubs (~55-70)', () => {
    expect(INTERMODAL_TERMINALS.length).toBeGreaterThanOrEqual(55);
    expect(INTERMODAL_TERMINALS.length).toBeLessThanOrEqual(70);
    expect(INTERMODAL_TERMINAL_COUNT).toBe(INTERMODAL_TERMINALS.length);
  });

  it('has unique codes that are uppercase and ≤6 chars', () => {
    const codes = INTERMODAL_TERMINALS.map((t) => t.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      expect(code).toBe(code.toUpperCase());
      expect(code.length).toBeLessThanOrEqual(6);
      expect(code).toMatch(/^[A-Z0-9]{2,6}$/);
    }
  });

  it('carries an address + operator on the enriched rows (nullable but present where set)', () => {
    // Every row exposes both keys (nullable) …
    for (const t of INTERMODAL_TERMINALS) {
      expect('address' in t).toBe(true);
      expect('operator' in t).toBe(true);
      if (t.address !== null) expect(t.address.trim().length).toBeGreaterThan(0);
      if (t.operator !== null) expect(t.operator.trim().length).toBeGreaterThan(0);
    }
    // … and the anchor-facility address/operator are set on known seaports.
    expect(terminalByCode('USSAV')?.address).toContain('Garden City Terminal');
    expect(terminalByCode('USSAV')?.operator).toBe('Georgia Ports Authority');
    expect(terminalByCode('USMOB')?.address).toContain('APM Terminals');
    expect(terminalByCode('USLAX')?.operator).toBe('Port of Los Angeles');
  });

  it('has the five corrected seaport coordinates', () => {
    expect(terminalByCode('USNYC')).toMatchObject({ lat: 40.6816, lng: -74.1505 });
    expect(terminalByCode('USSAV')).toMatchObject({ lat: 32.121, lng: -81.135 });
    expect(terminalByCode('USHOU')).toMatchObject({ lat: 29.6819, lng: -94.9983 });
    expect(terminalByCode('USBAL')).toMatchObject({ lat: 39.2592, lng: -76.5436 });
    expect(terminalByCode('USCHS')).toMatchObject({ lat: 32.848, lng: -79.873 });
  });

  it('includes the Alex-named + high-value new metros', () => {
    const codes = new Set(INTERMODAL_TERMINALS.map((t) => t.code));
    // Alex explicitly named these missing metros.
    for (const code of ['USMOB', 'INLOMA', 'INLCLT', 'INLSAS', 'INLREG']) {
      expect(codes.has(code)).toBe(true);
    }
    // A sample of the other high-value metros folded in from the research.
    for (const code of ['USTPA', 'USGPT', 'USILM', 'USPHL', 'USBOS', 'INLELP', 'INLLRD', 'INLSAT', 'INLPHX', 'INLCLE']) {
      expect(codes.has(code)).toBe(true);
    }
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
