/**
 * Port-GROUP model invariants (presentation-layer consolidation of the combined
 * seaport + inland-rail hub set into display groups). Pure; no DB / network —
 * only the const arrays + lookup helpers. Guards the "one combined list, split
 * only by country, co-located ports merged" taxonomy the directory renders.
 */
import { describe, it, expect } from 'vitest';
import {
  ALL_HUBS,
  PORT_GROUPS,
  portGroupByCode,
  portGroupForMemberCode,
  portGroupAsPort,
  portFilterCodes,
} from './containerPorts.js';

describe('PORT_GROUPS — the combined, deduped display-hub list', () => {
  it('has unique group codes', () => {
    const codes = PORT_GROUPS.map((g) => g.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('covers EVERY ALL_HUBS member code exactly once (deduped, nothing dropped)', () => {
    const members = PORT_GROUPS.flatMap((g) => g.memberCodes);
    // No member appears in two groups.
    expect(new Set(members).size).toBe(members.length);
    // Every hub in the canonical combined set is represented.
    const hubCodes = new Set(ALL_HUBS.map((h) => h.code));
    expect(new Set(members)).toEqual(hubCodes);
  });

  it('is split into exactly the two countries, both present (US + Canada)', () => {
    const countries = new Set(PORT_GROUPS.map((g) => g.country));
    expect([...countries].sort()).toEqual(['CA', 'US']);
  });

  it('merges Los Angeles + Long Beach into ONE "/" hub', () => {
    const la = PORT_GROUPS.find((g) => g.code === 'USLALB');
    expect(la).toBeTruthy();
    expect(la?.label).toContain('/');
    expect(la?.memberCodes.sort()).toEqual(['USLAX', 'USLGB']);
    // The individual codes are NOT their own groups any more.
    expect(portGroupByCode('USLAX')).toBeNull();
    expect(portGroupByCode('USLGB')).toBeNull();
  });

  it('leaves genuinely distinct metros standalone (no over-merging)', () => {
    for (const code of ['USMIA', 'USHOU', 'USOAK', 'CAVAN', 'CAMTR']) {
      const g = portGroupByCode(code);
      expect(g?.memberCodes).toEqual([code]);
    }
  });

  it('every group has a non-empty label / city / 2-letter state and ≥1 member', () => {
    for (const g of PORT_GROUPS) {
      expect(g.label.trim().length).toBeGreaterThan(0);
      expect(g.city.trim().length).toBeGreaterThan(0);
      expect(g.state).toMatch(/^[A-Z]{2}$/);
      expect(g.memberCodes.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('combines seaports AND inland rail ramps in the SAME list (no type split)', () => {
    const codes = new Set(PORT_GROUPS.map((g) => g.code));
    expect(codes.has('USLALB')).toBe(true); // seaport hub
    expect(codes.has('USCHI')).toBe(true); // inland rail ramp
    expect(codes.has('INLMEM')).toBe(true); // inland rail ramp
  });

  it('exposes the newly-added metros as their own standalone display hubs', () => {
    for (const code of ['USMOB', 'USTPA', 'INLOMA', 'INLCLT', 'INLSAS', 'INLREG']) {
      const g = portGroupByCode(code);
      expect(g?.memberCodes).toEqual([code]);
    }
  });
});

describe('ALL_HUBS — corrected seaport coordinates (must match terminals.ts)', () => {
  const hubByCode = new Map(ALL_HUBS.map((h) => [h.code, h]));
  it('carries the five fixed container-terminal coordinates', () => {
    expect(hubByCode.get('USNYC')).toMatchObject({ lat: 40.6816, lng: -74.1505 });
    expect(hubByCode.get('USSAV')).toMatchObject({ lat: 32.121, lng: -81.135 });
    expect(hubByCode.get('USHOU')).toMatchObject({ lat: 29.6819, lng: -94.9983 });
    expect(hubByCode.get('USBAL')).toMatchObject({ lat: 39.2592, lng: -76.5436 });
    expect(hubByCode.get('USCHS')).toMatchObject({ lat: 32.848, lng: -79.873 });
  });
});

describe('portGroupForMemberCode / portGroupAsPort', () => {
  it('maps a stored member code back to its display hub', () => {
    expect(portGroupForMemberCode('USLGB')?.code).toBe('USLALB');
    expect(portGroupForMemberCode('USMIA')?.code).toBe('USMIA');
    expect(portGroupForMemberCode('nope')).toBeNull();
  });

  it('renders a group as a ContainerPort using the "/" label + group code', () => {
    const g = portGroupByCode('USLALB')!;
    const p = portGroupAsPort(g);
    expect(p.code).toBe('USLALB');
    expect(p.name).toContain('/');
    expect(p.country).toBe('US');
    expect(Number.isFinite(p.lat)).toBe(true);
  });

  it('portFilterCodes on a group returns all members (any-member match)', () => {
    expect(portFilterCodes('USLALB').sort()).toEqual(['USLAX', 'USLGB']);
  });
});
