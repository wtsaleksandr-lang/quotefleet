import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RATE_CARDS,
  DEFAULT_ACCESSORIALS,
  generateDefaultLaneZones,
} from './defaults.js';
import {
  FREIGHT_VERTICALS,
  getSeedTemplate,
  isSeedPristine,
  listVerticalOptions,
  DEFAULT_SEED_COUNTS,
  CATALOG_ACCESSORIALS,
  type ExistingSeedRows,
} from './seedTemplates.js';

/** Amount lookup for a vertical's selected accessorial, by code. */
function accAmount(vertical: Parameters<typeof getSeedTemplate>[0], code: string): number | undefined {
  return getSeedTemplate(vertical).accessorials.find((a) => a.code === code)?.amount ?? undefined;
}

/** Build the untouched signup-seed rows exactly as auth.ts stamps them. */
function pristineRows(): ExistingSeedRows {
  return {
    rateCards: DEFAULT_RATE_CARDS.map((c) => ({
      service: c.service,
      equipment: c.equipment,
      ratePerMile: c.ratePerMile ?? 0,
      minimumCharge: c.minimumCharge ?? 0,
      flatFee: c.flatFee ?? 0,
    })),
    accessorials: DEFAULT_ACCESSORIALS.map((a) => ({
      code: a.code,
      amount: a.amount ?? 0,
      enabled: a.enabled ?? true,
    })),
    laneZones: generateDefaultLaneZones().map((z) => ({
      anchorPortCode: z.anchorPortCode ?? null,
      flatPrice: z.flatPrice ?? 0,
    })),
  };
}

describe('seedTemplates — vertical selection', () => {
  it('exposes exactly the six verticals', () => {
    expect(FREIGHT_VERTICALS).toEqual([
      'drayage',
      'dryvan_ftl',
      'reefer',
      'ltl',
      'hotshot',
      'flatbed',
    ]);
    expect(listVerticalOptions().map((o) => o.vertical)).toEqual(FREIGHT_VERTICALS);
  });

  it('drayage: 4 container cards, real drayage accessorial schedule, all 39 zones, zone tariff', () => {
    const t = getSeedTemplate('drayage');
    expect(t.rateCards.map((c) => c.equipment).sort()).toEqual([
      'container_20', 'container_40', 'container_40hc', 'container_45',
    ]);
    expect(t.rateCards.every((c) => c.service === 'drayage')).toBe(true);
    // Real AccessAir schedule reconciled across two live quotes.
    expect(t.accessorials.length).toBe(27);
    const codes = t.accessorials.map((a) => a.code);
    expect(codes).toContain('chassis_split');
    expect(codes).toContain('flip_fee');
    expect(codes).toContain('triaxle');
    expect(codes).toContain('rail_terminal_surcharge');
    expect(codes).toContain('weekend_fee');
    expect(codes).toContain('reefer_storage');
    expect(codes).toContain('detention_terminal');
    // toggle-driven conditional surcharges
    expect(codes).toContain('hazmat_flat');
    expect(codes).toContain('reefer_flat');
    expect(codes).toContain('overweight');
    expect(t.laneZones.length).toBe(39);
    expect(t.pricingMode).toBe('zone');
  });

  it('drayage: exact real rates + units + triggers (Alex’s reconciled schedule)', () => {
    const byCode = new Map(getSeedTemplate('drayage').accessorials.map((a) => [a.code, a]));
    const expectAcc = (code: string, kind: string, amount: number, trigger: string) => {
      const a = byCode.get(code);
      expect(a, `missing accessorial ${code}`).toBeDefined();
      expect(a!.kind, `${code} kind`).toBe(kind);
      expect(a!.amount, `${code} amount`).toBe(amount);
      expect(a!.trigger, `${code} trigger`).toBe(trigger);
    };
    // Chassis
    expectAcc('chassis_rental', 'per_day', 40, 'optional');
    expectAcc('chassis_split', 'flat', 100, 'optional');
    expectAcc('chassis_positioning', 'flat', 0, 'optional');
    expectAcc('chassis_return', 'flat', 0, 'optional');
    expectAcc('flip_fee', 'flat', 200, 'optional');
    expectAcc('triaxle', 'per_day', 85, 'optional');
    // Moves / storage
    expectAcc('prepull', 'flat', 145, 'optional');
    expectAcc('stop_off', 'flat', 150, 'optional');
    expectAcc('wait_time', 'flat', 150, 'optional');
    expectAcc('storage', 'per_day', 45, 'optional');
    expectAcc('reefer_storage', 'per_day', 95, 'optional');
    expectAcc('detention_terminal', 'per_hour', 100, 'optional');
    expectAcc('rail_terminal_surcharge', 'flat', 195, 'optional');
    expectAcc('weekend_fee', 'flat', 250, 'optional');
    expectAcc('toll_pass_through', 'flat', 0, 'optional');
    // Conditional / toggle-driven auto surcharges
    expectAcc('hazmat_flat', 'flat', 250, 'auto_if_hazmat');
    expectAcc('reefer_flat', 'flat', 250, 'auto_if_temp_controlled');
    expectAcc('in_bond', 'flat', 250, 'optional');
    expectAcc('overweight', 'flat', 200, 'auto_if_weight_over');
    // Universal reconciled value
    expectAcc('residential', 'flat', 150, 'auto_if_residential');
  });

  it('dryvan_ftl: dry-van card @ $2.55/mi, sensible default accessorial set, no zones, per-mile', () => {
    const t = getSeedTemplate('dryvan_ftl');
    expect(t.rateCards.length).toBe(1);
    expect(t.rateCards[0]).toMatchObject({ service: 'ftl', equipment: 'dryvan', ratePerMile: 2.55 });
    expect(t.accessorials.map((a) => a.code).sort()).toEqual(
      ['detention', 'driver_assist', 'extra_stop', 'hazmat', 'layover', 'lumper', 'redelivery', 'scale_ticket', 'tonu'].sort()
    );
    // representative editable-default amounts
    expect(accAmount('dryvan_ftl', 'detention')).toBe(99);
    expect(accAmount('dryvan_ftl', 'lumper')).toBe(150);
    expect(accAmount('dryvan_ftl', 'redelivery')).toBe(175);
    expect(t.laneZones.length).toBe(0);
    expect(t.pricingMode).toBe('per_mile');
  });

  it('reefer: reefer card @ $2.95/mi + reefer-specific handling, no zones, per-mile', () => {
    const t = getSeedTemplate('reefer');
    expect(t.rateCards.length).toBe(1);
    expect(t.rateCards[0]).toMatchObject({ service: 'ftl', equipment: 'reefer', ratePerMile: 2.95 });
    expect(t.accessorials.map((a) => a.code).sort()).toEqual(
      ['detention', 'driver_assist', 'extra_stop', 'layover', 'reefer_genset', 'reefer_monitoring', 'reefer_precool', 'reefer_washout', 'tonu'].sort()
    );
    expect(accAmount('reefer', 'reefer_genset')).toBe(75);
    expect(accAmount('reefer', 'reefer_precool')).toBe(50);
    expect(accAmount('reefer', 'reefer_washout')).toBe(50);
    expect(t.laneZones.length).toBe(0);
    expect(t.pricingMode).toBe('per_mile');
  });

  it('flatbed: flatbed+step_deck+conestoga @ $3.25/mi base, open-deck accessorials, no zones, per-mile', () => {
    const t = getSeedTemplate('flatbed');
    expect(t.rateCards.map((c) => c.equipment).sort()).toEqual(
      ['conestoga', 'flatbed', 'step_deck'].sort()
    );
    const flatbedCard = t.rateCards.find((c) => c.equipment === 'flatbed');
    expect(flatbedCard?.ratePerMile).toBe(3.25);
    expect(t.accessorials.map((a) => a.code).sort()).toEqual(
      ['coil_rack', 'detention', 'driver_assist', 'extra_straps_chains', 'layover', 'oversize_permit', 'overweight', 'pilot_car', 'tarping', 'tonu'].sort()
    );
    expect(accAmount('flatbed', 'tarping')).toBe(100);
    expect(accAmount('flatbed', 'oversize_permit')).toBe(250);
    expect(accAmount('flatbed', 'coil_rack')).toBe(75);
    expect(t.laneZones.length).toBe(0);
    expect(t.pricingMode).toBe('per_mile');
  });

  it('hotshot: hotshot+sprinter+box_truck, expedite/waiting set, no zones, per-mile', () => {
    const t = getSeedTemplate('hotshot');
    expect(t.rateCards.map((c) => c.equipment).sort()).toEqual(
      ['box_truck', 'flatbed', 'sprinter'].sort()
    );
    const hotshotCard = t.rateCards.find((c) => c.service === 'hotshot');
    expect(hotshotCard?.ratePerMile).toBe(2.6);
    expect(t.accessorials.map((a) => a.code).sort()).toEqual(
      ['detention', 'driver_wait_delivery', 'driver_wait_pickup', 'expedite_fee', 'extra_stop', 'liftgate', 'tonu', 'weekend_after_hours'].sort()
    );
    expect(accAmount('hotshot', 'expedite_fee')).toBe(150);
    expect(accAmount('hotshot', 'weekend_after_hours')).toBe(175);
    expect(t.laneZones.length).toBe(0);
    expect(t.pricingMode).toBe('per_mile');
  });

  it('ltl: class-rated card (min $125), full LTL accessorial set, no zones, min+mileage', () => {
    const t = getSeedTemplate('ltl');
    expect(t.rateCards.length).toBe(1);
    expect(t.rateCards[0]).toMatchObject({ service: 'ltl', minimumCharge: 125 });
    expect(t.accessorials.map((a) => a.code).sort()).toEqual(
      ['appointment', 'delivery_notification', 'inside_delivery', 'liftgate', 'limited_access', 'ltl_no_dock', 'overlength', 'residential', 'reweigh_reclass', 'sort_and_segregate'].sort()
    );
    expect(accAmount('ltl', 'liftgate')).toBe(95);
    expect(accAmount('ltl', 'reweigh_reclass')).toBe(45);
    expect(accAmount('ltl', 'overlength')).toBe(95);
    expect(t.laneZones.length).toBe(0);
    expect(t.pricingMode).toBe('min_mileage');
  });

  it('every selected row is a real catalog row (no invented numbers)', () => {
    for (const v of FREIGHT_VERTICALS) {
      const t = getSeedTemplate(v);
      for (const c of t.rateCards) {
        expect(DEFAULT_RATE_CARDS).toContainEqual(c);
      }
      for (const a of t.accessorials) {
        // Accessorials may come from either DEFAULT_ACCESSORIALS or the
        // EXPANDED_ACCESSORIAL_LIBRARY — both merged into CATALOG_ACCESSORIALS.
        expect(CATALOG_ACCESSORIALS).toContainEqual(a);
      }
    }
  });

  it('every non-drayage vertical selects a sensible 8-10 accessorial default set', () => {
    for (const v of ['dryvan_ftl', 'reefer', 'ltl', 'hotshot', 'flatbed'] as const) {
      const n = getSeedTemplate(v).accessorials.length;
      expect(n, `${v} accessorial count`).toBeGreaterThanOrEqual(8);
      expect(n, `${v} accessorial count`).toBeLessThanOrEqual(10);
    }
  });
});

describe('seedTemplates — first-run pristine guard (never clobber a customized tenant)', () => {
  it('DEFAULT_SEED_COUNTS matches the signup seed', () => {
    expect(DEFAULT_SEED_COUNTS).toEqual({
      rateCards: DEFAULT_RATE_CARDS.length,
      accessorials: DEFAULT_ACCESSORIALS.length,
      laneZones: generateDefaultLaneZones().length,
    });
  });

  it('untouched signup seed is detected as pristine → reseed allowed', () => {
    expect(isSeedPristine(pristineRows())).toBe(true);
  });

  it('an edited rate → NOT pristine → tenant is NOT reseeded', () => {
    const rows = pristineRows();
    rows.rateCards[0].ratePerMile += 0.5; // trucker raised their dry-van rate
    expect(isSeedPristine(rows)).toBe(false);
  });

  it('a disabled accessorial → NOT pristine', () => {
    const rows = pristineRows();
    rows.accessorials[0].enabled = false;
    expect(isSeedPristine(rows)).toBe(false);
  });

  it('a deleted rate card (count mismatch) → NOT pristine', () => {
    const rows = pristineRows();
    rows.rateCards.pop();
    expect(isSeedPristine(rows)).toBe(false);
  });

  it('an extra user-added card → NOT pristine', () => {
    const rows = pristineRows();
    rows.rateCards.push({ service: 'ftl', equipment: 'dryvan', ratePerMile: 9.99, minimumCharge: 1, flatFee: 0 });
    expect(isSeedPristine(rows)).toBe(false);
  });

  it('an edited lane-zone price → NOT pristine', () => {
    const rows = pristineRows();
    rows.laneZones[0].flatPrice += 100;
    expect(isSeedPristine(rows)).toBe(false);
  });
});
