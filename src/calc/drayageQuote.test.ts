/**
 * End-to-end coverage for the REAL drayage accessorial schedule
 * (Alex's AccessAir rates, reconciled across two live quotes).
 *
 * Drives the actual `calculate` engine over the shipped DEFAULT_RATE_CARDS /
 * DEFAULT_ACCESSORIALS / lane zones — no hand-built fixtures — so a future
 * edit to a real rate or trigger shows up as a failing assertion here.
 */
import { describe, expect, it } from 'vitest';
import { calculate, type CalcRequest } from './engine.js';
import {
  DEFAULT_RATE_CARDS,
  DEFAULT_ACCESSORIALS,
  generateDefaultLaneZones,
} from './defaults.js';
import type { RateCard, Accessorial, LaneZone } from '../db/schema.js';

const now = new Date('2026-01-01T00:00:00Z');

/** Stamp the Omit<…,'tenantId'> seed rows into full DB rows the engine takes. */
const cards: RateCard[] = DEFAULT_RATE_CARDS.map((c, i) => ({
  id: i + 1, tenantId: 1, label: null, notes: null,
  ratePerMile: 0, minimumCharge: 0, flatFee: 0, fuelSurchargePct: 0, marginPct: 0,
  maxWeightLbs: null, maxMiles: null, ltlConfig: null, enabled: true, sortOrder: 0,
  lastAiEditAt: null, lastAiEditReason: null, createdAt: now, updatedAt: now,
  ...c,
} as RateCard));

const accs: Accessorial[] = DEFAULT_ACCESSORIALS.map((a, i) => ({
  id: i + 1, tenantId: 1, description: null, kind: 'flat', amount: 0,
  trigger: 'optional', conditionJson: null, appliesToServices: null,
  enabled: true, sortOrder: 0, createdAt: now, updatedAt: now,
  ...a,
} as Accessorial));

const zones: LaneZone[] = generateDefaultLaneZones().map((z, i) => ({
  id: i + 1, tenantId: 1, anchorCity: null, anchorState: null,
  anchorPortCode: null, equipmentScope: null, enabled: true, sortOrder: 0,
  createdAt: now, updatedAt: now,
  ...z,
} as LaneZone));

const drayReq = (o: Partial<CalcRequest> = {}): CalcRequest => ({
  service: 'drayage', equipment: 'container_40', miles: 22,
  pickupPortCode: 'USLAX', ...o,
});

describe('real drayage quote — engine over shipped defaults', () => {
  it('toggle-driven surcharges auto-apply (hazmat $250, reefer $250, overweight $200)', () => {
    const r = calculate(
      cards, accs, zones,
      drayReq({
        weightLbs: 50000, // > 44,000 → overweight auto
        flags: { hazmat: true, tempControlled: true },
      })
    );
    expect(r.unsupported).toBeUndefined();
    // Zone flat tariff (USLAX 0-30, container_40).
    expect(r.subtotalLinehaul).toBe(425);
    const amt = (code: string) => r.lines.find((l) => l.code === code)?.amount;
    expect(amt('hazmat_flat')).toBe(250);
    expect(amt('reefer_flat')).toBe(250);
    expect(amt('overweight')).toBe(200);
    // OTR percentage hazmat is scoped away from drayage — must NOT double-charge.
    expect(r.lines.find((l) => l.code === 'hazmat')).toBeUndefined();
    // Genset (per_day) contributes $0 with no day count → no line.
    expect(r.lines.find((l) => l.code === 'reefer_genset')).toBeUndefined();
    expect(r.total).toBeGreaterThan(r.subtotalLinehaul);
  });

  it('optional accessorials add at their real flat rates', () => {
    const r = calculate(
      cards, accs, zones,
      drayReq({ selectedAccessorialCodes: ['chassis_split', 'flip_fee', 'rail_terminal_surcharge'] })
    );
    const amt = (code: string) => r.lines.find((l) => l.code === code)?.amount;
    expect(amt('chassis_split')).toBe(100);
    expect(amt('flip_fee')).toBe(200);
    expect(amt('rail_terminal_surcharge')).toBe(195);
  });

  it('per-day storage bills by the day count ($45/night)', () => {
    const r = calculate(
      cards, accs, zones,
      drayReq({ selectedAccessorialCodes: ['storage'], flags: { storageDays: 2 } })
    );
    expect(r.lines.find((l) => l.code === 'storage')?.amount).toBe(90);
  });

  it('drayage fuel surcharge uses the ~32% configurable default of the base', () => {
    const r = calculate(cards, accs, zones, drayReq({}));
    // 32% of the $425 zone tariff.
    expect(r.fuelSurcharge).toBe(136);
  });
});
