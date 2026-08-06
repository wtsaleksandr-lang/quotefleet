/**
 * Rate-ingestion COMPREHENSION — apply persistence + engine pricing.
 *
 * Deterministic proof that the new comprehension fields flow end-to-end:
 *   (b) applyDraftToTenant maps the LTL-grid fixture → rate_cards.ltlConfig
 *       (+ AMC → minimumCharge, + maxMiles) — asserted by capturing the values
 *       passed to tx.insert(...).values(...); the DB + marketplace sync are mocked.
 *   (c) engine.calculate prices an LTL shipment through the EXTRACTED ltlConfig
 *       and the result differs from the DEFAULT_LTL_CONFIG fallback.
 *   (d) a detention (per_hour) accessorial with freeHours only bills after the
 *       free window.
 *   (e) backward-compat: the legacy simple per-mile draft applies + prices as before.
 *
 * draftToEngineConfig + calculate are REAL (a pricing regression fails here).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ inserts: [] as Array<Record<string, unknown>> }));

vi.mock('../../db/client.js', () => ({
  db: () => ({
    transaction: async (fn: (tx: unknown) => Promise<void>) => {
      await fn({
        insert: () => ({
          values: (v: Record<string, unknown>) => {
            h.inserts.push(v);
            return Promise.resolve();
          },
        }),
        update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      });
    },
  }),
}));
vi.mock('../../marketplace/sync.js', () => ({ syncTenantToMarketplace: vi.fn() }));

import { applyDraftToTenant, draftToEngineConfig } from './ingest.js';
import { calculate, type CalcRequest } from '../../calc/engine.js';
import {
  FIXTURE_LTL_GRID,
  FIXTURE_DRAYAGE_ZONES,
  FIXTURE_ACCESSORIAL_SCHEDULE,
  FIXTURE_LEGACY_SIMPLE,
} from '../../ai/ingestFixtures.js';

beforeEach(() => {
  h.inserts = [];
});

describe('(b) applyDraftToTenant persists the new engine-supported fields', () => {
  it('writes the LTL class/weight config to rate_cards.ltlConfig + folds AMC into minimumCharge', async () => {
    await applyDraftToTenant(1, 99, { rateCards: FIXTURE_LTL_GRID.rateCards });
    const card = h.inserts.find((v) => v.service === 'ltl');
    expect(card).toBeTruthy();
    const cfg = card!.ltlConfig as Record<string, unknown>;
    expect(cfg).toBeTruthy();
    expect(cfg.baseRatePerCwt).toBe(26);
    expect(cfg.discountPct).toBe(65);
    expect(cfg.baseTariffName).toBe('CzarLite XL 2024');
    // AMC (95) becomes the engine-enforced minimum charge.
    expect(card!.minimumCharge).toBe(95);
  });

  it('persists maxMiles ceiling + lane zones for a drayage sheet', async () => {
    await applyDraftToTenant(1, 99, {
      rateCards: FIXTURE_DRAYAGE_ZONES.rateCards,
      laneZones: FIXTURE_DRAYAGE_ZONES.laneZones,
    });
    const card = h.inserts.find((v) => v.service === 'drayage');
    expect(card!.maxMiles).toBe(300);
    const zoneInserts = h.inserts.filter((v) => 'radiusMiles' in v);
    expect(zoneInserts.length).toBe(3);
  });

  it('persists conditional accessorial fields (trigger + conditionJson)', async () => {
    await applyDraftToTenant(1, 99, { accessorials: FIXTURE_ACCESSORIAL_SCHEDULE.accessorials });
    const byCode = Object.fromEntries(
      h.inserts.filter((v) => 'code' in v).map((v) => [v.code, v]),
    );
    expect((byCode.detention.conditionJson as Record<string, unknown>).freeHours).toBe(2);
    expect((byCode.storage.conditionJson as Record<string, unknown>).daysFlag).toBe('storageDays');
    expect((byCode.layover.conditionJson as Record<string, unknown>).daysFlag).toBe('layoverDays');
    expect(byCode.overweight.trigger).toBe('auto_if_weight_over');
    expect((byCode.overweight.conditionJson as Record<string, unknown>).weightLbsOver).toBe(44000);
  });
});

describe('(c) engine prices LTL through the EXTRACTED ltlConfig, not the default', () => {
  const ltlReq = (): CalcRequest => ({
    service: 'ltl',
    equipment: 'pallet',
    miles: 600,
    weightLbs: 8000,
    freightClass: 175, // explicit class → deterministic, no dimension dependence
  });

  it('the extracted config yields a different price than DEFAULT_LTL_CONFIG', () => {
    const { cards } = draftToEngineConfig({ rateCards: FIXTURE_LTL_GRID.rateCards });
    const extracted = calculate(cards, [], [], ltlReq());
    expect(extracted.unsupported).toBeUndefined();
    expect(extracted.ltl?.freightClass).toBe(175);
    expect(extracted.subtotalLinehaul).toBeGreaterThan(0);

    // Same draft with the ltlConfig stripped → engine falls back to DEFAULT_LTL_CONFIG.
    const stripped = FIXTURE_LTL_GRID.rateCards.map((c) => ({ ...c, ltlConfig: null }));
    const { cards: defCards } = draftToEngineConfig({ rateCards: stripped });
    const def = calculate(defCards, [], [], ltlReq());

    expect(Math.abs(extracted.subtotalLinehaul - def.subtotalLinehaul)).toBeGreaterThan(1);
  });
});

describe('(d) detention (per_hour) with freeHours bills only after the free window', () => {
  const draft = {
    rateCards: [{ service: 'ftl', equipment: 'dryvan', ratePerMile: 2, minimumCharge: 0, fuelSurchargePct: 0, marginPct: 0 }],
    accessorials: [
      { code: 'detention', label: 'Detention', kind: 'per_hour', amount: 60, trigger: 'optional', freeHours: 2 },
    ],
    laneZones: [],
  };
  const base: CalcRequest = { service: 'ftl', equipment: 'dryvan', miles: 100, selectedAccessorialCodes: ['detention'] };

  it('does not bill within the free window, bills the overage beyond it', () => {
    const { cards, accs, zones } = draftToEngineConfig(draft);
    const within = calculate(cards, accs, zones, { ...base, flags: { detentionHours: 2 } });
    const over = calculate(cards, accs, zones, { ...base, flags: { detentionHours: 5 } });
    expect(within.subtotalAccessorials).toBe(0);
    expect(over.subtotalAccessorials).toBe(180); // 60 × (5 − 2)
  });
});

describe('(e) backward-compat: the legacy simple per-mile draft still applies + prices', () => {
  it('applies with no ltlConfig and prices like before', async () => {
    await applyDraftToTenant(1, 99, { rateCards: (FIXTURE_LEGACY_SIMPLE.rateCards as Array<Record<string, unknown>>) });
    const card = h.inserts.find((v) => v.service === 'ftl');
    expect(card!.ltlConfig ?? null).toBeNull();
    expect(card!.ratePerMile).toBe(2.5);

    const { cards } = draftToEngineConfig(FIXTURE_LEGACY_SIMPLE as { rateCards: Array<Record<string, unknown>> });
    const r = calculate(cards, [], [], { service: 'ftl', equipment: 'dryvan', miles: 500 });
    // 500×$2.50 = 1250 linehaul; +22% fuel (275) = 1525; +10% margin (152.5) = 1677.5.
    expect(r.total).toBe(1677.5);
  });
});
