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
import { calculate, customerFacingLines, type CalcRequest } from './engine.js';
import type { RateCard, Accessorial, LaneZone, Terminal } from '../db/schema.js';
import { getSeedTemplate, type FreightVertical } from './seedTemplates.js';

const now = new Date('2026-01-01T00:00:00Z');

function rateCard(o: Partial<RateCard>): RateCard {
  return {
    id: 1, tenantId: 1, service: 'ftl', equipment: 'dryvan',
    label: null, ratePerMile: 2.5, minimumCharge: 350, flatFee: 0,
    fuelSurchargePct: 22, marginPct: 12, maxWeightLbs: null, maxMiles: null,
    ltlConfig: null,
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

  it('Auto FSC — EIA-derived $/mile replaces the card fixed %', () => {
    // diesel $4.05 → (4.05−1.25)/6 = $0.4667/mi. 500 mi → $233.33 fuel.
    // (vs manual 22% of $1,250 = $275.)
    const r = calculate(
      [rateCard({})], [], [],
      req({ miles: 500 }),
      [],
      { mode: 'auto', perMileUsd: 0.4667, dieselUsd: 4.05, asOfLabel: '07/07' }
    );
    expect(r.fuelSurcharge).toBeCloseTo(233.35, 1);
    const fuelLine = r.lines.find((l) => l.kind === 'fuel');
    expect(fuelLine?.name).toContain('national avg diesel $4.05/gal');
    expect(fuelLine?.name).toContain('wk of 07/07');
    // margin 12% of (1250 + 233.35) recomputes off the new fuel figure.
    expect(r.margin).toBeCloseTo(178.0, 0);
  });

  it('Manual FSC (default) — card % is used when no fsc arg / mode manual', () => {
    const noArg = calculate([rateCard({})], [], [], req({ miles: 500 }));
    const manual = calculate([rateCard({})], [], [], req({ miles: 500 }), [], { mode: 'manual', perMileUsd: 0.4667 });
    expect(noArg.fuelSurcharge).toBe(275); // 22% of 1250
    expect(manual.fuelSurcharge).toBe(275); // manual ignores perMileUsd
    expect(manual.lines.find((l) => l.kind === 'fuel')?.name).toContain('22.0% of linehaul');
  });

  it('Auto FSC — a diesel price at/below peg yields $0 fuel (no line)', () => {
    const r = calculate([rateCard({})], [], [], req({ miles: 500 }), [], {
      mode: 'auto', perMileUsd: 0, dieselUsd: 1.2, asOfLabel: '07/07',
    });
    expect(r.fuelSurcharge).toBe(0);
    expect(r.lines.find((l) => l.kind === 'fuel')).toBeUndefined();
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

  it('Per-day accessorials read their own day flag (no cross-charge)', () => {
    const storage = accessorial({ code: 'storage', label: 'Storage', kind: 'per_day', amount: 45 });
    const layover = accessorial({ code: 'layover', label: 'Layover', kind: 'per_day', amount: 350, conditionJson: { daysFlag: 'layoverDays' } });
    const r = calculate(
      [rateCard({})], [storage, layover], [],
      req({ miles: 100, selectedAccessorialCodes: ['storage', 'layover'], flags: { storageDays: 2, layoverDays: 1 } })
    );
    // storage bills its 2 storage days (not 3 = storage+layover); layover bills its 1 layover day
    expect(r.lines.find((l) => l.code === 'storage')?.amount).toBe(90);
    expect(r.lines.find((l) => l.code === 'layover')?.amount).toBe(350);
  });

  it('Per-day accessorial does not bill against the other flag (no phantom days)', () => {
    const storage = accessorial({ code: 'storage', label: 'Storage', kind: 'per_day', amount: 45 });
    const r = calculate(
      [rateCard({})], [storage], [],
      req({ miles: 100, selectedAccessorialCodes: ['storage'], flags: { storageDays: 0, layoverDays: 5 } })
    );
    // zero storage days -> no storage charge, even with layover days present
    expect(r.lines.find((l) => l.code === 'storage')).toBeUndefined();
  });

  it('Optional accessorial out of service scope is not applied', () => {
    const drayOnly = accessorial({ code: 'flip_fee', label: 'Flip', kind: 'flat', amount: 200, appliesToServices: ['drayage'] });
    const r = calculate(
      [rateCard({})], [drayOnly], [],
      req({ service: 'ftl', miles: 100, selectedAccessorialCodes: ['flip_fee'] })
    );
    expect(r.lines.find((l) => l.code === 'flip_fee')).toBeUndefined();
  });

  it('Per-hour accessorial bills only hours over the free window', () => {
    const det = accessorial({ code: 'detention', label: 'Detention', kind: 'per_hour', amount: 99, conditionJson: { freeHours: 2 } });
    const r = calculate(
      [rateCard({})], [det], [],
      req({ miles: 100, selectedAccessorialCodes: ['detention'], flags: { detentionHours: 3 } })
    );
    // (3 - 2 free) * 99
    expect(r.lines.find((l) => l.code === 'detention')?.amount).toBe(99);
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

  it('LTL — weight drives price (1,200 lb ≠ 40,000 lb) and class is surfaced', () => {
    const ltlCard = rateCard({ service: 'ltl', equipment: 'pallet', ratePerMile: 0, minimumCharge: 125, flatFee: 50, fuelSurchargePct: 0, marginPct: 0 });
    const dims = { lengthIn: 48, widthIn: 40, heightIn: 48 };
    const light = calculate([ltlCard], [], [], req({ service: 'ltl', equipment: 'pallet', miles: 600, weightLbs: 1200, ...dims }));
    const heavy = calculate([ltlCard], [], [], req({ service: 'ltl', equipment: 'pallet', miles: 600, weightLbs: 40000, ...dims }));
    expect(light.unsupported).toBeUndefined();
    expect(heavy.total).toBeGreaterThan(light.total);
    // Freight class is computed from density and exposed for the UI.
    expect(light.ltl?.freightClass).toBeGreaterThan(0);
    expect(light.ltl?.classSource).toBe('derived');
    expect(light.lines.find((l) => l.kind === 'linehaul')?.name).toMatch(/class/i);
  });

  it('LTL — dimensions change density → class → price (same weight)', () => {
    const ltlCard = rateCard({ service: 'ltl', equipment: 'pallet', ratePerMile: 0, minimumCharge: 125, flatFee: 50, fuelSurchargePct: 0, marginPct: 0 });
    const dense = calculate([ltlCard], [], [], req({ service: 'ltl', equipment: 'pallet', miles: 600, weightLbs: 2000, lengthIn: 40, widthIn: 40, heightIn: 40 }));
    const bulky = calculate([ltlCard], [], [], req({ service: 'ltl', equipment: 'pallet', miles: 600, weightLbs: 2000, lengthIn: 80, widthIn: 60, heightIn: 60 }));
    // Bulky = lower density = higher class = higher price.
    expect(bulky.ltl!.freightClass).toBeGreaterThan(dense.ltl!.freightClass);
    expect(bulky.total).toBeGreaterThan(dense.total);
  });

  it('LTL — aggregate freightClass override is priced AND surfaced (displayed = priced = stored)', () => {
    // Multi-pallet reality: the widget aggregates all item rows into one class
    // (weight ÷ SUMMED volume) and sends it as `freightClass`. The server must
    // price + report THAT class, not re-derive a lower one from total-weight ÷
    // the single-largest-item volume. Here 500 lb over two 48×40×48 pallets is
    // class 200; the single-item derivation would wrongly land on ~100.
    const ltlCard = rateCard({ service: 'ltl', equipment: 'pallet', ratePerMile: 0, minimumCharge: 125, flatFee: 50, fuelSurchargePct: 0, marginPct: 0 });
    const dims = { lengthIn: 48, widthIn: 40, heightIn: 48 };
    const derived = calculate([ltlCard], [], [], req({ service: 'ltl', equipment: 'pallet', miles: 600, weightLbs: 500, ...dims }));
    const overridden = calculate([ltlCard], [], [], req({ service: 'ltl', equipment: 'pallet', miles: 600, weightLbs: 500, freightClass: 200, ...dims }));
    // The override wins end-to-end.
    expect(overridden.ltl?.classSource).toBe('override');
    expect(overridden.ltl?.freightClass).toBe(200);
    // The linehaul label the customer sees reflects the SAME class.
    expect(overridden.lines.find((l) => l.kind === 'linehaul')?.name).toMatch(/class 200/i);
    // And it prices higher than the (wrong, cheaper) single-item derivation.
    expect(derived.ltl?.freightClass).toBeLessThan(200);
    expect(overridden.total).toBeGreaterThan(derived.total);
  });

  it('LTL — no dock auto-adds liftgate; loose auto-adds handling', () => {
    const ltlCard = rateCard({ service: 'ltl', equipment: 'pallet', ratePerMile: 0, minimumCharge: 125, flatFee: 50, fuelSurchargePct: 0, marginPct: 0 });
    const noDock = accessorial({ code: 'ltl_no_dock', label: 'Liftgate / No-dock', kind: 'flat', amount: 95, trigger: 'auto_if_no_dock', appliesToServices: ['ltl'] });
    const loose = accessorial({ code: 'ltl_loose_handling', label: 'Loose Handling', kind: 'flat', amount: 60, trigger: 'auto_if_loose', appliesToServices: ['ltl'] });
    const r = calculate([ltlCard], [noDock, loose], [], req({ service: 'ltl', equipment: 'pallet', miles: 400, weightLbs: 1000, lengthIn: 48, widthIn: 40, heightIn: 48, flags: { loadedFromDock: false, palletized: false } }));
    expect(r.lines.find((l) => l.code === 'ltl_no_dock')?.amount).toBe(95);
    expect(r.lines.find((l) => l.code === 'ltl_loose_handling')?.amount).toBe(60);
  });

  it('LTL — dock + palletized do NOT add the auto accessorials', () => {
    const ltlCard = rateCard({ service: 'ltl', equipment: 'pallet', ratePerMile: 0, minimumCharge: 125, flatFee: 50 });
    const noDock = accessorial({ code: 'ltl_no_dock', label: 'Liftgate', kind: 'flat', amount: 95, trigger: 'auto_if_no_dock', appliesToServices: ['ltl'] });
    const loose = accessorial({ code: 'ltl_loose_handling', label: 'Loose', kind: 'flat', amount: 60, trigger: 'auto_if_loose', appliesToServices: ['ltl'] });
    const r = calculate([ltlCard], [noDock, loose], [], req({ service: 'ltl', equipment: 'pallet', miles: 400, weightLbs: 1000, lengthIn: 48, widthIn: 40, heightIn: 48, flags: { loadedFromDock: true, palletized: true } }));
    expect(r.lines.find((l) => l.code === 'ltl_no_dock')).toBeUndefined();
    expect(r.lines.find((l) => l.code === 'ltl_loose_handling')).toBeUndefined();
  });

  it('Distance guard — per-mile lane beyond card.maxMiles is unsupported', () => {
    // Drayage card capped at 300 mi; a 2,066-mi "drayage" must NOT silently
    // price at $4.50/mi ($12k) — it should flag as out of range.
    const dr = rateCard({ service: 'drayage', equipment: 'container_40', ratePerMile: 4.5, maxMiles: 300 });
    const r = calculate([dr], [], [], req({ service: 'drayage', equipment: 'container_40', miles: 2066 }));
    expect(r.unsupported).toBeDefined();
    expect(r.unsupported?.reason).toMatch(/beyond|range|custom quote/i);
    expect(r.total).toBe(0);
  });

  it('Distance guard — within maxMiles still prices normally', () => {
    const dr = rateCard({ service: 'drayage', equipment: 'container_40', ratePerMile: 4.5, maxMiles: 300 });
    const r = calculate([dr], [], [], req({ service: 'drayage', equipment: 'container_40', miles: 120 }));
    expect(r.unsupported).toBeUndefined();
    expect(r.total).toBeGreaterThan(0);
  });

  it('Distance guard — a matched lane-zone flat tariff is exempt from maxMiles', () => {
    // req.miles here is the anchor→delivery distance used for radius matching,
    // which is small; the guard must never fire on a zone match.
    const dr = rateCard({ service: 'drayage', equipment: 'container_40', ratePerMile: 4.5, maxMiles: 300 });
    const r = calculate([dr], [], [laneZone({})], req({ service: 'drayage', equipment: 'container_40', miles: 22, pickupPortCode: 'USLAX' }));
    expect(r.unsupported).toBeUndefined();
    expect(r.subtotalLinehaul).toBe(425);
  });
});

describe('seed-template verticals — each computes a real quote with its default set', () => {
  // Hydrate the (Omit<_, 'tenantId'>) seed rows into full engine rows.
  function cardsFor(v: FreightVertical): RateCard[] {
    return getSeedTemplate(v).rateCards.map((c) => rateCard(c as Partial<RateCard>));
  }
  function accsFor(v: FreightVertical): Accessorial[] {
    return getSeedTemplate(v).accessorials.map((a, i) => accessorial({ ...(a as Partial<Accessorial>), id: i + 1 }));
  }

  const cases: Array<{ v: FreightVertical; req: Partial<CalcRequest>; flatAcc: string }> = [
    { v: 'dryvan_ftl', req: { service: 'ftl', equipment: 'dryvan', miles: 500 }, flatAcc: 'lumper' },
    { v: 'reefer', req: { service: 'ftl', equipment: 'reefer', miles: 500, flags: { tempControlled: true } }, flatAcc: 'reefer_precool' },
    { v: 'flatbed', req: { service: 'ftl', equipment: 'flatbed', miles: 500 }, flatAcc: 'tarping' },
    { v: 'hotshot', req: { service: 'hotshot', equipment: 'flatbed', miles: 300 }, flatAcc: 'expedite_fee' },
    { v: 'ltl', req: { service: 'ltl', equipment: 'pallet', miles: 400, weightLbs: 1500, lengthIn: 48, widthIn: 40, heightIn: 48 }, flatAcc: 'reweigh_reclass' },
  ];

  for (const { v, req: r, flatAcc } of cases) {
    it(`${v}: prices a valid quote and applies a selected default accessorial`, () => {
      const cards = cardsFor(v);
      const accs = accsFor(v);
      const base = calculate(cards, accs, [], req(r));
      expect(base.unsupported, `${v} should price`).toBeUndefined();
      expect(base.total).toBeGreaterThan(0);

      // Selecting a flat default accessorial adds its amount to the quote.
      const picked = accs.find((a) => a.code === flatAcc)!;
      const withAcc = calculate(cards, accs, [], req({ ...r, selectedAccessorialCodes: [flatAcc] }));
      expect(withAcc.lines.find((l) => l.code === flatAcc)?.amount).toBe(picked.amount);
      expect(withAcc.subtotalAccessorials).toBeGreaterThanOrEqual(picked.amount);
    });
  }
});

describe('customerFacingLines — margin is never shown to the customer', () => {
  it('drops the margin line and folds its amount into linehaul (sum unchanged)', () => {
    const r = calculate([rateCard({ marginPct: 12 })], [], [], req({ miles: 500 }));
    // Engine output KEEPS margin (internal/admin view).
    expect(r.lines.some((l) => l.kind === 'margin')).toBe(true);
    const internalSum = r.lines.reduce((s, l) => s + l.amount, 0);

    const customer = customerFacingLines(r.lines);
    // No margin line, and the literal word "margin" appears nowhere.
    expect(customer.some((l) => l.kind === 'margin')).toBe(false);
    expect(customer.some((l) => /margin/i.test(String(l.name)))).toBe(false);
    // Displayed line items still sum to the same grand total.
    const customerSum = customer.reduce((s, l) => s + (l.amount || 0), 0);
    expect(Math.round(customerSum * 100) / 100).toBe(Math.round(internalSum * 100) / 100);
    expect(Math.round(customerSum * 100) / 100).toBe(r.total);
    // The engine's own lines were not mutated.
    expect(r.lines.some((l) => l.kind === 'margin')).toBe(true);
  });

  it('works on persisted breakdownJson-shaped rows', () => {
    const stored = [
      { name: 'Linehaul (500 mi × $2.50/mi)', amount: 1250, kind: 'linehaul' },
      { name: 'Fuel surcharge (22.0% of linehaul)', amount: 275, kind: 'fuel' },
      { name: 'Margin (12.0%)', amount: 183, kind: 'margin' },
    ];
    const customer = customerFacingLines(stored);
    expect(customer.some((l) => l.kind === 'margin')).toBe(false);
    const linehaul = customer.find((l) => l.kind === 'linehaul');
    expect(linehaul?.amount).toBe(1433); // 1250 + 183 folded in
    expect(customer.reduce((s, l) => s + (l.amount || 0), 0)).toBe(1708);
  });

  it('is a no-op when there is no margin line', () => {
    const stored = [{ name: 'Linehaul', amount: 1000, kind: 'linehaul' }];
    expect(customerFacingLines(stored)).toEqual(stored);
  });
});
