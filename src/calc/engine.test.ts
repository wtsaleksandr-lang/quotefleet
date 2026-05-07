/**
 * Snapshot tests for the quote calculator.
 *
 * The engine handles real money — every line item drift in a future
 * refactor must show up as an explicit snapshot diff so we catch it
 * before customers do. These cases cover:
 *   - basic linehaul (FTL dryvan)
 *   - minimum-charge floor
 *   - drayage lane-zone match (port + radius)
 *   - per-mile + fuel + margin stack
 *   - auto-triggered accessorials (residential, hazmat)
 *   - terminal surcharge add-on
 *   - unsupported equipment → friendly error
 */
import { describe, it, expect } from 'vitest';
import { calculate, type CalcRequest } from './engine.js';
import type { RateCard, Accessorial, LaneZone, Terminal } from '../db/schema.js';

const now = new Date('2026-01-01T00:00:00Z');

function rateCard(o: Partial<RateCard>): RateCard {
  return {
    id: 1, tenantId: 1, service: 'ftl', equipment: 'dryvan',
    label: null, ratePerMile: 2.5, minimumCharge: 350, flatFee: 0,
    fuelSurchargePct: 22, marginPct: 12, maxWeightLbs: null, maxMiles: null,
    enabled: true, sortOrder: 0, notes: null,
    lastAiEditAt: null, lastAiEditReason: null,
    createdAt: now, updatedAt: now,
    ...o,
  };
}
function accessorial(o: Partial<Accessorial>): Accessorial {
  return {
    id: 1, tenantId: 1, code: 'x', label: 'X', description: null,
    kind: 'flat', amount: 100, trigger: 'optional', conditionJson: null,
    appliesToServices: null, enabled: true, sortOrder: 0,
    createdAt: now, updatedAt: now,
    ...o,
  };
}
function laneZone(o: Partial<LaneZone>): LaneZone {
  return {
    id: 1, tenantId: 1, label: 'LAX 0-30', anchorPortCode: 'USLAX',
    anchorCity: null, anchorState: null, radiusMiles: 30, flatPrice: 425,
    equipmentScope: ['container_40'], enabled: true, sortOrder: 0,
    createdAt: now, updatedAt: now,
    ...o,
  };
}
function terminal(o: Partial<Terminal>): Terminal {
  return {
    id: 1, tenantId: 1, portCode: 'USLAX', code: 'USLAX_APM_P400',
    name: 'APM Terminal', carrier: null, address: null, lat: null, lng: null,
    surcharge: 0, notes: null, enabled: true, sortOrder: 0,
    createdAt: now, updatedAt: now,
    ...o,
  };
}

const req = (o: Partial<CalcRequest> = {}): CalcRequest => ({
  service: 'ftl', equipment: 'dryvan', miles: 500, ...o,
});

describe('calculate', () => {
  it('FTL dryvan — basic linehaul + fuel + margin', () => {
    const r = calculate([rateCard({})], [], [], req({ miles: 500 }));
    expect(r.unsupported).toBeUndefined();
    // 500 mi × $2.50 = $1,250 linehaul.
    // fuel 22% of $1,250 = $275.
    // margin 12% of (1250 + 0 + 275) = $183.
    // total = $1,708
    expect(r.subtotalLinehaul).toBe(1250);
    expect(r.fuelSurcharge).toBe(275);
    expect(r.margin).toBe(183);
    expect(r.total).toBe(1708);
  });

  it('Below minimum-charge — minimum kicks in', () => {
    const r = calculate(
      [rateCard({ ratePerMile: 2.5, minimumCharge: 500 })],
      [], [],
      req({ miles: 50 })
    );
    // 50 × 2.5 = 125 → below minimum 500 → linehaul = 500
    expect(r.subtotalLinehaul).toBe(500);
    expect(r.lines.find((l) => l.kind === 'minimum')).toBeDefined();
  });

  it('Drayage zone match — flat tariff replaces per-mile', () => {
    const dr = rateCard({ service: 'drayage', equipment: 'container_40', ratePerMile: 4.5, minimumCharge: 400 });
    const r = calculate(
      [dr], [], [laneZone({})],
      req({ service: 'drayage', equipment: 'container_40', miles: 22, pickupPortCode: 'USLAX' })
    );
    // Lane-zone match: flat $425. fuel 22% applies to $425 = $93.50, margin 12% of $518.50 = $62.22.
    expect(r.subtotalLinehaul).toBe(425);
    expect(r.fuelSurcharge).toBe(93.5);
    expect(r.total).toBe(580.72);
  });

  it('Auto-triggered residential accessorial', () => {
    const acc = accessorial({
      code: 'residential', label: 'Residential', kind: 'flat', amount: 85,
      trigger: 'auto_if_residential', appliesToServices: ['ftl'],
    });
    const r = calculate(
      [rateCard({})], [acc], [],
      req({ miles: 100, flags: { residential: true } })
    );
    expect(r.lines.find((l) => l.code === 'residential')).toBeDefined();
    expect(r.subtotalAccessorials).toBe(85);
  });

  it('Auto-triggered hazmat % accessorial', () => {
    const acc = accessorial({
      code: 'hazmat', label: 'Hazmat', kind: 'pct_of_base', amount: 18,
      trigger: 'auto_if_hazmat',
    });
    const r = calculate(
      [rateCard({})], [acc], [],
      req({ miles: 200, flags: { hazmat: true } })
    );
    // 200 × 2.50 = 500 → 18% of 500 = 90
    expect(r.subtotalAccessorials).toBe(90);
  });

  it('Terminal surcharge added when terminalCode supplied', () => {
    const r = calculate(
      [rateCard({ service: 'drayage', equipment: 'container_40' })], [],
      [laneZone({})],
      req({
        service: 'drayage', equipment: 'container_40', miles: 22,
        pickupPortCode: 'USLAX', pickupTerminalCode: 'USLAX_APM_P400',
      }),
      [terminal({ surcharge: 75 })]
    );
    expect(r.lines.find((l) => l.code === 'terminal_surcharge')).toBeDefined();
    expect(r.subtotalAccessorials).toBeGreaterThanOrEqual(75);
  });

  it('Unsupported equipment → friendly error', () => {
    const r = calculate([rateCard({ enabled: false })], [], [], req({}));
    expect(r.unsupported).toBeDefined();
    expect(r.unsupported?.reason).toMatch(/no rate card/i);
  });

  it('User-selected optional accessorial included', () => {
    const acc = accessorial({ code: 'liftgate', label: 'Liftgate', amount: 95 });
    const r = calculate(
      [rateCard({})], [acc], [],
      req({ miles: 100, selectedAccessorialCodes: ['liftgate'] })
    );
    expect(r.lines.find((l) => l.code === 'liftgate')?.amount).toBe(95);
  });

  it('Per-hour detention applied via flag', () => {
    const acc = accessorial({ code: 'detention', label: 'Detention', kind: 'per_hour', amount: 75 });
    const r = calculate(
      [rateCard({})], [acc], [],
      req({ miles: 100, selectedAccessorialCodes: ['detention'], flags: { detentionHours: 3 } })
    );
    expect(r.lines.find((l) => l.code === 'detention')?.amount).toBe(225);
  });

  it('Snapshot — full breakdown for representative quote', () => {
    const r = calculate(
      [rateCard({ marginPct: 10 })],
      [accessorial({ code: 'residential', label: 'Residential', kind: 'flat', amount: 85, trigger: 'auto_if_residential' })],
      [],
      req({ miles: 350, flags: { residential: true } })
    );
    expect(r.lines.map((l) => ({ kind: l.kind, name: l.name, amount: l.amount }))).toMatchInlineSnapshot(`
      [
        {
          "amount": 875,
          "kind": "linehaul",
          "name": "Linehaul (350 mi × $2.50/mi)",
        },
        {
          "amount": 85,
          "kind": "accessorial",
          "name": "Residential",
        },
        {
          "amount": 192.5,
          "kind": "fuel",
          "name": "Fuel surcharge (22.0% of linehaul)",
        },
        {
          "amount": 115.25,
          "kind": "margin",
          "name": "Margin (10.0%)",
        },
      ]
    `);
    expect(r.total).toBe(1267.75);
  });
});
