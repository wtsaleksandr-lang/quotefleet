/**
 * Directory-fill load tests — the comprehensive US/CA port + rail + CFS
 * directory (Phase 4b) is present and queryable through the data helpers.
 */
import { describe, it, expect } from 'vitest';
import { PORTS_DATA, findPort, expandPortAliases } from './ports.js';
import { PORTS_INLAND, TERMINALS_DATA, terminalsForPort } from './terminals.js';
import { CFS_DATA, LCL_NETWORKS, findCfs, cfsForGateway } from './cfs.js';

describe('PORTS_DATA — new ocean + reconciliation ports', () => {
  it('added the 9 secondary regional ports', () => {
    for (const code of ['USSAN', 'USHUE', 'USGPT', 'USPBI', 'USFEB', 'USGLC', 'USCLE', 'CANAI', 'CAHAM']) {
      expect(findPort(code), code).toBeTruthy();
    }
    expect(PORTS_DATA.length).toBeGreaterThanOrEqual(43);
  });

  it('added the drayage reconciliation codes USEWR + USLALB', () => {
    expect(findPort('USEWR')?.city).toBe('Newark');
    expect(findPort('USLALB')?.name).toMatch(/San Pedro Bay/);
  });

  it('carries the container accuracy flag on RoRo/breakbulk-only ports', () => {
    expect(findPort('USHUE')?.container).toBe(false);
    expect(findPort('USGLC')?.container).toBe(false);
    // Container-capable ports leave the flag undefined (truthy by default).
    expect(findPort('USLAX')?.container).toBeUndefined();
  });
});

describe('expandPortAliases — port-code alias groups', () => {
  it('NY/NJ group: USNYC ⇄ USEWR', () => {
    expect(expandPortAliases('USNYC').sort()).toEqual(['USEWR', 'USNYC']);
    expect(expandPortAliases('usewr').sort()).toEqual(['USEWR', 'USNYC']);
  });
  it('San Pedro Bay pool: USLAX / USLGB / USLALB', () => {
    expect(expandPortAliases('USLGB').sort()).toEqual(['USLALB', 'USLAX', 'USLGB']);
  });
  it('a code with no aliases returns just itself (uppercased); empty → []', () => {
    expect(expandPortAliases('USSAV')).toEqual(['USSAV']);
    expect(expandPortAliases('')).toEqual([]);
    expect(expandPortAliases(null)).toEqual([]);
  });
});

describe('TERMINALS_DATA — previously-empty ports now carry terminals', () => {
  it('the 17 gap-closure ports each resolve to ≥1 terminal', () => {
    for (const code of ['USPDX', 'USJAX', 'USMIA', 'USPEF', 'USPHL', 'USBOS', 'USWIL', 'USILM', 'USGLS', 'USFPO', 'USNOL', 'USMOB', 'USANC', 'USHNL', 'CASTQ', 'CASJB', 'CATOR']) {
      expect(terminalsForPort(code).length, code).toBeGreaterThan(0);
    }
  });
  it('a specific new terminal is findable (Jacksonville / Blount Island)', () => {
    const jax = terminalsForPort('USJAX');
    expect(jax.some((t) => /Blount Island/i.test(t.name))).toBe(true);
  });
  it('USEWR carries its NJ-side marine terminals', () => {
    expect(terminalsForPort('USEWR').length).toBeGreaterThanOrEqual(3);
  });
});

describe('rail ramps — depth beyond Chicago', () => {
  it('added inland hubs for new metros', () => {
    const codes = new Set(PORTS_INLAND.map((h) => h.code));
    for (const c of ['INLIE', 'INLSLC', 'INLDEN', 'INLSTL', 'INLMSP', 'INLCLT', 'INLCGY']) {
      expect(codes.has(c), c).toBe(true);
    }
  });
  it('previously-empty inland hubs (KC / Detroit / Columbus) now carry ramps', () => {
    for (const c of ['INLKCK', 'INLDET', 'INLCMH']) {
      expect(terminalsForPort(c).length, c).toBeGreaterThan(0);
    }
  });
  it('has a healthy total of rail ramp rows', () => {
    const rail = TERMINALS_DATA.filter((t) => t.type === 'rail');
    expect(rail.length).toBeGreaterThanOrEqual(50);
  });
});

describe('CFS_DATA — new bonded CFS / LCL category', () => {
  it('loaded 32 bonded CFS + 5 LCL networks', () => {
    expect(CFS_DATA.length).toBe(32);
    expect(LCL_NETWORKS.length).toBe(5);
  });
  it('findCfs + cfsForGateway resolve a facility', () => {
    expect(findCfs('CFS_LAX_STG')?.operator).toBe('STG Logistics');
    expect(cfsForGateway('USLAX').length).toBeGreaterThan(0);
  });
  it('every CFS row carries a bonded flag and a stable code', () => {
    for (const c of CFS_DATA) {
      expect(typeof c.bonded).toBe('boolean');
      expect(c.code).toMatch(/^CFS_/);
    }
  });
});
