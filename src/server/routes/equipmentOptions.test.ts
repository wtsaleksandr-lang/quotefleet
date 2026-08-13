import { describe, it, expect } from 'vitest';
import {
  matrixEquipmentLabel,
  dedupeEquipmentTypes,
  type EquipmentOption,
} from './equipmentOptions.js';

describe('matrixEquipmentLabel', () => {
  it('shows the 40\' high-cube container as the short "40\'HQ" label', () => {
    // Alex: the customer-facing label for container_40hc is "40'HQ" everywhere.
    expect(matrixEquipmentLabel('container_40hc')).toBe("40'HQ");
  });

  it('keeps the other container size labels intact', () => {
    expect(matrixEquipmentLabel('container_20')).toBe("20' Container");
    expect(matrixEquipmentLabel('container_40')).toBe("40' Container");
    expect(matrixEquipmentLabel('container_45')).toBe("45' Container");
  });

  it('title-cases an unmapped code as a fallback', () => {
    expect(matrixEquipmentLabel('container_53re')).toBe('Container 53re');
  });

  it('gives each hotshot trailer-type band its clean trailer name', () => {
    expect(matrixEquipmentLabel('hotshot_bumperpull')).toBe('Bumper-pull flatbed');
    expect(matrixEquipmentLabel('hotshot_gooseneck')).toBe('Gooseneck (30-35 ft)');
    expect(matrixEquipmentLabel('hotshot_gooseneck40')).toBe('Gooseneck 40 ft (CDL)');
    expect(matrixEquipmentLabel('hotshot_dovetail')).toBe('Dovetail / tilt');
    expect(matrixEquipmentLabel('hotshot_stepdeck')).toBe('Step-deck / lowboy');
  });
});

describe('dedupeEquipmentTypes canonical container order', () => {
  it('orders drayage containers smallest→largest so 20\' leads (widget default)', () => {
    // Arrival order is intentionally shuffled (mirrors the non-deterministic
    // updatedAt/id order a bulk-seeded tenant's rate cards come back in).
    const byService: Record<string, EquipmentOption[]> = {
      drayage: [
        { value: 'container_45', label: 'x' },
        { value: 'container_40hc', label: 'x' },
        { value: 'container_20', label: 'x' },
        { value: 'container_40', label: 'x' },
      ],
    };
    const out = dedupeEquipmentTypes(byService);
    expect(out.drayage.map((e) => e.value)).toEqual([
      'container_20',
      'container_40',
      'container_40hc',
      'container_45',
    ]);
    // And the leading option carries the canonical label.
    expect(out.drayage[0].label).toBe("20' Container");
  });

  it('leaves non-container modes in their arrival order', () => {
    const byService: Record<string, EquipmentOption[]> = {
      ftl: [
        { value: 'reefer', label: 'x' },
        { value: 'dryvan', label: 'x' },
      ],
    };
    const out = dedupeEquipmentTypes(byService);
    expect(out.ftl.map((e) => e.value)).toEqual(['reefer', 'dryvan']);
  });
});
