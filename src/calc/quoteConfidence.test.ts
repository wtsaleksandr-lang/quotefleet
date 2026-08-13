/**
 * Rate-confidence / estimated-range / quote-validity tests.
 *
 * These cover the premium KPI the widget renders on the result card:
 *   - confidence is derived from MATCH QUALITY (exact matrix cell = high;
 *     zone/flat tariff, per-mile / LTL card, or a coarse matrix match = medium)
 *   - low/high bracket the headline total by a confidence-scaled band, snapped
 *     to clean dollars
 *   - validityDays aligns with the single QUOTE_VALIDITY_DAYS source that the
 *     terms disclaimer also interpolates (never a contradictory second value)
 */
import { describe, it, expect } from 'vitest';
import { calculate, QUOTE_VALIDITY_DAYS, type CalcRequest } from './engine.js';
import type { RateCard, LaneZone } from '../db/schema.js';
import type { MatrixCellInput, ZoneDefInput } from './rateMatrix.js';
import { DEFAULT_QUOTE_DISCLAIMER } from '../server/quoteDisclaimer.js';

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

describe('confidence + range + validity', () => {
  it('exact matrix cell with ZIPs → high confidence, ±4% clean-dollar band', () => {
    const cells: MatrixCellInput[] = [{ id: 1, mode: 'ftl', equipment: 'dryvan', originKey: 'W', destKey: 'E', rate: 1900, unitBasis: 'flat' }];
    const r = calculate([], [], [], req({ pickupZip: '90045', deliveryZip: '85003' }), [], undefined, cells, ZONES);
    expect(r.total).toBe(1900);
    expect(r.confidence).toBe('high');
    // step for a $1,900 total is $10; ±4% → 1824 / 1976 → snapped 1820 / 1980.
    expect(r.low).toBe(1820);
    expect(r.high).toBe(1980);
    expect(r.low!).toBeLessThan(r.total);
    expect(r.high!).toBeGreaterThan(r.total);
    expect(r.validityDays).toBe(QUOTE_VALIDITY_DAYS);
  });

  it('a matrix cell matched WITHOUT a ZIP (coarse city/state input) is medium', () => {
    // Cell keyed directly on "city,state" — matches a request that carries only
    // city/state and NO ZIP, so despite hitting the matrix tier the confidence
    // must fall to medium (no precise input to stand behind a "high").
    const cells: MatrixCellInput[] = [
      { id: 1, mode: 'ftl', equipment: 'dryvan', originKey: 'los angeles,ca', destKey: 'phoenix,az', rate: 1900, unitBasis: 'flat' },
    ];
    const r = calculate([], [], [], req({ pickupCity: 'Los Angeles', pickupState: 'CA', deliveryCity: 'Phoenix', deliveryState: 'AZ' }), [], undefined, cells, []);
    expect(r.total).toBe(1900);
    expect(r.confidence).toBe('medium');
  });

  it('per-mile card (no matrix) → medium confidence, ±8% band brackets total', () => {
    const r = calculate([rateCard({})], [], [], req({ miles: 500 }), []);
    expect(r.total).toBe(1250);
    expect(r.confidence).toBe('medium');
    expect(r.low!).toBeLessThan(1250);
    expect(r.high!).toBeGreaterThan(1250);
    // medium band is wider than a high band would be around the same total.
    expect(r.total - r.low!).toBeGreaterThanOrEqual(1250 * 0.07);
    expect(r.validityDays).toBe(QUOTE_VALIDITY_DAYS);
  });

  it('zone flat tariff → medium confidence', () => {
    const zone = laneZone({ flatPrice: 425 });
    const r = calculate([], [], [zone], req({ equipment: 'container_40', service: 'drayage', miles: 12, pickupPortCode: 'USLAX' }), []);
    expect(r.total).toBe(425);
    expect(r.confidence).toBe('medium');
  });

  it('low / high always snap to clean dollars (no cents)', () => {
    const r = calculate([rateCard({ ratePerMile: 2.37, minimumCharge: 100 })], [], [], req({ miles: 433 }), []);
    expect(Number.isInteger(r.low)).toBe(true);
    expect(Number.isInteger(r.high)).toBe(true);
  });

  it('an unsupported lane carries no confidence / range / validity', () => {
    const r = calculate([], [], [], req({ service: 'ftl', equipment: 'nonexistent' }), []);
    expect(r.unsupported).toBeDefined();
    expect(r.confidence).toBeUndefined();
    expect(r.low).toBeUndefined();
    expect(r.high).toBeUndefined();
  });

  it('validity aligns with the terms disclaimer (single source, no drift)', () => {
    expect(DEFAULT_QUOTE_DISCLAIMER).toContain(`${QUOTE_VALIDITY_DAYS} days`);
  });
});
