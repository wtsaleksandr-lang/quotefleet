/**
 * Engine-level tests for native rate-matrix pricing through calculate().
 *
 * Covers: a matrix lane prices to the CORRECT cell (flat / per_mile), matrix
 * precedence over a lane_zone AND a per-mile card, the min-charge floor on a
 * matrix lane, directional asymmetry end-to-end, FSC/margin flowing through the
 * card path, and — the HARD REQUIREMENT — ZERO regression: with no matrix
 * present the engine prices byte-identically to before.
 */
import { describe, it, expect } from 'vitest';
import { calculate, type CalcRequest } from './engine.js';
import type { RateCard, LaneZone } from '../db/schema.js';
import type { MatrixCellInput, ZoneDefInput } from './rateMatrix.js';

const now = new Date('2026-01-01T00:00:00Z');
function rateCard(o: Partial<RateCard>): RateCard {
  return {
    id: 1, tenantId: 1, service: 'ftl', equipment: 'dryvan',
    label: null, ratePerMile: 2.5, minimumCharge: 350, flatFee: 0,
    fuelSurchargePct: 0, marginPct: 0, maxWeightLbs: null, maxMiles: null,
    ltlConfig: null, enabled: true, sortOrder: 0, notes: null,
    lastAiEditAt: null, lastAiEditReason: null, createdAt: now, updatedAt: now,
    ...o,
  };
}
function laneZone(o: Partial<LaneZone>): LaneZone {
  return {
    id: 1, tenantId: 1, label: 'LAX 0-30', anchorPortCode: 'USLAX',
    anchorCity: null, anchorState: null, radiusMiles: 30, flatPrice: 425,
    equipmentScope: ['container_40'], enabled: true, sortOrder: 0,
    createdAt: now, updatedAt: now, ...o,
  };
}
const req = (o: Partial<CalcRequest> = {}): CalcRequest => ({ service: 'ftl', equipment: 'dryvan', miles: 500, ...o });

const ZONES: ZoneDefInput[] = [
  { zoneId: 'W', matchKind: 'zip_range', matchFrom: '900', matchTo: '902', enabled: true },
  { zoneId: 'E', matchKind: 'zip_range', matchFrom: '850', matchTo: '852', enabled: true },
];

describe('matrix pricing through calculate()', () => {
  it('prices a flat matrix lane to the correct cell (no card FSC/margin)', () => {
    const cells: MatrixCellInput[] = [{ id: 1, mode: 'ftl', equipment: 'dryvan', originKey: 'W', destKey: 'E', rate: 1900, unitBasis: 'flat' }];
    const r = calculate([], [], [], req({ pickupZip: '90045', deliveryZip: '85003' }), [], undefined, cells, ZONES);
    expect(r.unsupported).toBeUndefined();
    expect(r.subtotalLinehaul).toBe(1900);
    expect(r.total).toBe(1900);
    expect(r.lines[0].kind).toBe('linehaul');
    expect(r.lines[0].name).toMatch(/matrix lane rate/i);
  });

  it('per_mile matrix cell = rate × miles, and card FSC + margin flow on top', () => {
    const card = rateCard({ fuelSurchargePct: 20, marginPct: 10, ratePerMile: 99 /* ignored: matrix wins */ });
    const cells: MatrixCellInput[] = [{ id: 1, mode: 'ftl', equipment: 'dryvan', originKey: 'W', destKey: 'E', rate: 2, unitBasis: 'per_mile' }];
    const r = calculate([card], [], [], req({ miles: 500, pickupZip: '90045', deliveryZip: '85003' }), [], undefined, cells, ZONES);
    // linehaul 500×$2 = 1000; fuel 20% = 200; margin 10% of (1000+200) = 120; total 1320.
    expect(r.subtotalLinehaul).toBe(1000);
    expect(r.fuelSurcharge).toBe(200);
    expect(r.margin).toBe(120);
    expect(r.total).toBe(1320);
  });

  it('min-charge floor lifts a below-minimum matrix lane', () => {
    const cells: MatrixCellInput[] = [{ id: 1, mode: 'ftl', equipment: 'dryvan', originKey: 'W', destKey: 'E', rate: 1, unitBasis: 'per_mile', minCharge: 800 }];
    const r = calculate([], [], [], req({ miles: 100, pickupZip: '90045', deliveryZip: '85003' }), [], undefined, cells, ZONES);
    expect(r.subtotalLinehaul).toBe(800);
    expect(r.lines.find((l) => l.kind === 'minimum')).toBeDefined();
  });

  it('is directional end-to-end (A→B ≠ B→A)', () => {
    const cells: MatrixCellInput[] = [
      { id: 1, mode: 'ftl', equipment: 'dryvan', originKey: 'W', destKey: 'E', rate: 1900, unitBasis: 'flat' },
      { id: 2, mode: 'ftl', equipment: 'dryvan', originKey: 'E', destKey: 'W', rate: 1750, unitBasis: 'flat' },
    ];
    const fwd = calculate([], [], [], req({ pickupZip: '90045', deliveryZip: '85003' }), [], undefined, cells, ZONES);
    const rev = calculate([], [], [], req({ pickupZip: '85003', deliveryZip: '90045' }), [], undefined, cells, ZONES);
    expect(fwd.subtotalLinehaul).toBe(1900);
    expect(rev.subtotalLinehaul).toBe(1750);
  });

  it('PRECEDENCE: a matrix cell wins over a matching lane_zone', () => {
    // A drayage zone would match on port + radius; the matrix cell must win.
    const dr = rateCard({ service: 'drayage', equipment: 'container_40', ratePerMile: 4.5 });
    const zone = laneZone({ flatPrice: 425 });
    const cells: MatrixCellInput[] = [{ id: 1, mode: 'drayage', equipment: 'container_40', originKey: 'USLAX', destKey: '900', rate: 610, unitBasis: 'per_container' }];
    const r = calculate([dr], [], [zone], req({
      service: 'drayage', equipment: 'container_40', miles: 22, pickupPortCode: 'USLAX',
      pickupZip: '90731', deliveryZip: '90045',
    }), [], undefined, cells, []);
    // Matrix (610) wins, NOT the zone flat 425.
    expect(r.subtotalLinehaul).toBe(610);
    expect(r.lines[0].name).toMatch(/matrix/i);
  });

  it('PRECEDENCE: a matrix cell wins over the per-mile rate card', () => {
    const card = rateCard({ ratePerMile: 2.5, minimumCharge: 350 });
    const cells: MatrixCellInput[] = [{ id: 1, mode: 'ftl', equipment: 'dryvan', originKey: 'W', destKey: 'E', rate: 1234, unitBasis: 'flat' }];
    const r = calculate([card], [], [], req({ miles: 500, pickupZip: '90045', deliveryZip: '85003' }), [], undefined, cells, ZONES);
    expect(r.subtotalLinehaul).toBe(1234); // not 500×2.5 = 1250
  });

  it('falls through to today\'s behavior unchanged when no matrix cell matches', () => {
    const card = rateCard({ ratePerMile: 2.5, minimumCharge: 350 });
    const cells: MatrixCellInput[] = [{ id: 1, mode: 'ftl', equipment: 'dryvan', originKey: 'W', destKey: 'E', rate: 1234, unitBasis: 'flat' }];
    // Lane 600→700 doesn't resolve to W/E → matrix ignored → per-mile card.
    const r = calculate([card], [], [], req({ miles: 500, pickupZip: '60007', deliveryZip: '10001' }), [], undefined, cells, ZONES);
    expect(r.subtotalLinehaul).toBe(1250);
  });
});

describe('ZERO REGRESSION — an empty matrix must not change any existing quote', () => {
  const lanes: Array<{ label: string; cards: RateCard[]; zones: LaneZone[]; req: CalcRequest }> = [
    { label: 'per-mile FTL + fuel + margin', cards: [rateCard({ fuelSurchargePct: 22, marginPct: 12 })], zones: [], req: req({ miles: 500 }) },
    { label: 'below-minimum', cards: [rateCard({ ratePerMile: 2.5, minimumCharge: 500 })], zones: [], req: req({ miles: 50 }) },
    { label: 'drayage lane-zone flat', cards: [rateCard({ service: 'drayage', equipment: 'container_40', ratePerMile: 4.5, fuelSurchargePct: 22, marginPct: 12 })], zones: [laneZone({})], req: req({ service: 'drayage', equipment: 'container_40', miles: 22, pickupPortCode: 'USLAX' }) },
    { label: 'LTL class/weight', cards: [rateCard({ service: 'ltl', equipment: 'pallet', ratePerMile: 0, minimumCharge: 125, flatFee: 50 })], zones: [], req: req({ service: 'ltl', equipment: 'pallet', miles: 600, weightLbs: 8000, lengthIn: 48, widthIn: 40, heightIn: 48 }) },
  ];

  for (const l of lanes) {
    it(`${l.label}: 6-arg call === 8-arg call with empty matrices`, () => {
      const before = calculate(l.cards, [], l.zones, l.req);
      const after = calculate(l.cards, [], l.zones, l.req, [], undefined, [], []);
      expect(after).toEqual(before);
    });

    it(`${l.label}: a NON-matching matrix present still prices identically`, () => {
      const before = calculate(l.cards, [], l.zones, l.req);
      const nonMatching: MatrixCellInput[] = [{ id: 1, mode: 'ftl', equipment: 'dryvan', originKey: '999', destKey: '888', rate: 9999, unitBasis: 'flat' }];
      const after = calculate(l.cards, [], l.zones, l.req, [], undefined, nonMatching, []);
      expect(after.total).toBe(before.total);
      expect(after.subtotalLinehaul).toBe(before.subtotalLinehaul);
    });
  }
});
