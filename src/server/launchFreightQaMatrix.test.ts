import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { calculate } from '../calc/engine.js';

const rootDir = process.cwd();

async function read(path: string) {
  return readFile(resolve(rootDir, path), 'utf8');
}

const ftlCard = {
  enabled: true,
  service: 'ftl',
  equipment: 'dryvan',
  ratePerMile: 2.35,
  flatFee: 75,
  minimumCharge: 650,
  fuelSurchargePct: 18,
  marginPct: 8,
};

const drayageCard = {
  enabled: true,
  service: 'drayage',
  equipment: 'container_40hc',
  ratePerMile: 4.25,
  flatFee: 0,
  minimumCharge: 500,
  fuelSurchargePct: 12,
  marginPct: 0,
};

const freightAccessorials = [
  { enabled: true, code: 'residential', label: 'Residential delivery', trigger: 'auto_if_residential', kind: 'flat', amount: 125, appliesToServices: ['ftl', 'ltl'] },
  { enabled: true, code: 'hazmat', label: 'Hazmat handling', trigger: 'auto_if_hazmat', kind: 'flat', amount: 175, appliesToServices: ['ftl', 'ltl', 'drayage'] },
  { enabled: true, code: 'overweight', label: 'Overweight review', trigger: 'auto_if_weight_over', kind: 'flat', amount: 250, conditionJson: { weightLbsOver: 42000 }, appliesToServices: ['ftl', 'drayage'] },
  { enabled: true, code: 'liftgate', label: 'Liftgate service', trigger: 'optional', kind: 'flat', amount: 95, appliesToServices: ['ftl', 'ltl'] },
  { enabled: true, code: 'chassis', label: 'Chassis split', trigger: 'optional', kind: 'flat', amount: 75, appliesToServices: ['drayage'] },
  { enabled: true, code: 'storage', label: 'Storage days', trigger: 'optional', kind: 'per_day', amount: 60, appliesToServices: ['drayage'] },
] as any[];

describe('launch freight QA matrix', () => {
  it('documents required launch freight scenarios', async () => {
    const doc = await read('docs/launch-qa-matrix.md');
    expect(doc).toContain('FTL dry van');
    expect(doc).toContain('Drayage port pickup');
    expect(doc).toContain('Drayage unknown terminal');
    expect(doc).toContain('Missing rate card');
    expect(doc).toContain('Canada postal');
    expect(doc).toContain('Manual QA sign-off template');
  });

  it('calculates a messy FTL lane with automatic and selected accessorials', () => {
    const result = calculate(
      [ftlCard] as any,
      freightAccessorials as any,
      [] as any,
      {
        service: 'ftl',
        equipment: 'dryvan',
        miles: 850,
        weightLbs: 45000,
        pickupCity: 'Chicago',
        pickupState: 'IL',
        deliveryCity: 'Atlanta',
        deliveryState: 'GA',
        selectedAccessorialCodes: ['liftgate'],
        flags: { residential: true, hazmat: true },
      },
    );

    expect(result.unsupported).toBeUndefined();
    expect(result.subtotalLinehaul).toBe(2072.5);
    expect(result.subtotalAccessorials).toBe(645);
    expect(result.fuelSurcharge).toBe(373.05);
    expect(result.margin).toBe(247.24);
    expect(result.total).toBe(3337.79);
    expect(result.lines.map((line) => line.code)).toEqual(expect.arrayContaining(['residential', 'hazmat', 'overweight', 'liftgate']));
  });

  it('calculates a drayage zone tariff with terminal and unknown-terminal-safe add-ons', () => {
    const result = calculate(
      [drayageCard] as any,
      freightAccessorials as any,
      [{ enabled: true, label: 'LAX local drayage', anchorPortCode: 'USLAX', radiusMiles: 45, flatPrice: 625, equipmentScope: ['container_40hc'] }] as any,
      {
        service: 'drayage',
        equipment: 'container_40hc',
        miles: 32,
        pickupPortCode: 'USLAX',
        pickupTerminalCode: 'WBCT',
        deliveryCity: 'Ontario',
        deliveryState: 'CA',
        selectedAccessorialCodes: ['chassis', 'storage'],
        flags: { storageDays: 2 },
      },
      [{ enabled: true, code: 'WBCT', name: 'West Basin Container Terminal', surcharge: 35 }] as any,
    );

    expect(result.unsupported).toBeUndefined();
    expect(result.subtotalLinehaul).toBe(625);
    expect(result.subtotalAccessorials).toBe(230);
    expect(result.fuelSurcharge).toBe(75);
    expect(result.total).toBe(930);
    expect(result.lines.map((line) => line.code)).toEqual(expect.arrayContaining(['chassis', 'storage', 'terminal_surcharge']));
  });

  it('returns clear unsupported guidance when no service and equipment match exists', () => {
    const result = calculate(
      [] as any,
      [] as any,
      [] as any,
      { service: 'expedited', equipment: 'sprinter', miles: 120 },
    );

    expect(result.total).toBe(0);
    expect(result.unsupported?.reason).toContain('No rate card configured');
    expect(result.unsupported?.reason).toContain('expedited');
    expect(result.unsupported?.reason).toContain('sprinter');
  });
});
