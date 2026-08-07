/**
 * FTL quote-polish regressions (the hard-test findings):
 *   1. Equipment dropdown de-dupes to canonical equipment TYPES (not one
 *      lane-named option per ingested rate card).
 *   3. runDraftAutoCheck flags a sample lane that prices at $0 (non-clean).
 *   4. The LTL AMC (absoluteMinCharge) folds into the card's minimumCharge on
 *      apply / preview (via normalizeDraftRateCard → draftToEngineConfig).
 */
import { describe, it, expect } from 'vitest';
import { dedupeEquipmentTypes } from './routes/equipmentOptions.js';
import { runDraftAutoCheck, draftToEngineConfig } from './routes/ingest.js';

describe('dedupeEquipmentTypes — collapse ingested cards to canonical equipment types', () => {
  it('33 reefer lane-cards → ONE reefer option with a clean canonical label', () => {
    // Simulate the polluted card-derived map: many enabled reefer cards, each
    // with a lane-named label, all sharing the equipment value "reefer".
    const polluted = {
      ftl: Array.from({ length: 33 }, (_, i) => ({
        value: 'reefer',
        label: `Reefer – Plant City FL → New York NY (L${String(i + 1).padStart(2, '0')})`,
      })),
    };
    const out = dedupeEquipmentTypes(polluted);
    expect(out.ftl).toHaveLength(1);
    expect(out.ftl[0].value).toBe('reefer');
    // Clean canonical label, NOT the lane-named junk.
    expect(out.ftl[0].label).toBe('Reefer (Refrigerated)');
    expect(out.ftl[0].label).not.toMatch(/→|Plant City|L01/);
  });

  it('keeps distinct equipment types and drops blank values', () => {
    const map = {
      ftl: [
        { value: 'dryvan', label: "53' Dry Van A" },
        { value: 'dryvan', label: "53' Dry Van B" },
        { value: 'flatbed', label: 'Flatbed lane 12' },
        { value: '', label: 'junk' },
      ],
    };
    const out = dedupeEquipmentTypes(map);
    expect(out.ftl.map((e) => e.value).sort()).toEqual(['dryvan', 'flatbed']);
    expect(out.ftl.find((e) => e.value === 'dryvan')?.label).toBe('Dry Van');
    expect(out.ftl.find((e) => e.value === 'flatbed')?.label).toBe('Flatbed');
  });

  it('keeps the most permissive weight ceiling when cards disagree', () => {
    const map = {
      expedited: [
        { value: 'sprinter', label: 'Sprinter A', maxWeightLbs: 3000 },
        { value: 'sprinter', label: 'Sprinter B', maxWeightLbs: 4000 },
      ],
    };
    const out = dedupeEquipmentTypes(map);
    expect(out.expedited).toHaveLength(1);
    expect(out.expedited[0].maxWeightLbs).toBe(4000);
  });
});

describe('runDraftAutoCheck — a $0 sample lane is flagged, not silently clean', () => {
  it('flags a rate card whose rates net to $0', () => {
    const draft = {
      rateCards: [
        // Zero linehaul inputs → the engine can't price it above $0.
        { service: 'ftl', equipment: 'dryvan', ratePerMile: 0, flatFee: 0, minimumCharge: 0, fuelSurchargePct: 0, marginPct: 0 },
      ],
    };
    const summary = runDraftAutoCheck(draft);
    expect(summary.flaggedCount).toBeGreaterThan(0);
    expect(summary.clean).toBeLessThan(summary.total);
    // The flagged entry carries a human reason the review UI surfaces.
    expect(summary.flagged.length).toBeGreaterThan(0);
    expect(summary.flagged[0].reason).toMatch(/\$0|price|manual quote|check/i);
  });

  it('a properly-priced card computes clean', () => {
    const draft = {
      rateCards: [
        { service: 'ftl', equipment: 'dryvan', ratePerMile: 2.5, flatFee: 0, minimumCharge: 350, fuelSurchargePct: 20, marginPct: 10 },
      ],
    };
    const summary = runDraftAutoCheck(draft);
    expect(summary.flaggedCount).toBe(0);
    expect(summary.clean).toBe(summary.total);
  });
});

describe('AMC ingest — absoluteMinCharge folds into the card minimumCharge', () => {
  it('an LTL card with only an ltlConfig.absoluteMinCharge gets that as its minimumCharge', () => {
    const draft = {
      rateCards: [
        {
          service: 'ltl',
          equipment: 'pallet',
          ratePerMile: null,
          minimumCharge: null, // AMC lives ONLY on the rules-sheet-derived ltlConfig
          ltlConfig: {
            baseRatePerCwt: 14.7,
            classRates: { '100': 1.0 },
            weightBreaks: [{ minLbs: 0, rateFactor: 1.0 }],
            distanceFactorPer1000Mi: 0,
            absoluteMinCharge: 95,
          },
        },
      ],
    };
    const { cards } = draftToEngineConfig(draft);
    expect(cards).toHaveLength(1);
    expect(cards[0].minimumCharge).toBe(95);
  });

  it('an explicit minimumCharge still wins over the AMC fallback', () => {
    const draft = {
      rateCards: [
        {
          service: 'ltl',
          equipment: 'pallet',
          minimumCharge: 120,
          ltlConfig: {
            baseRatePerCwt: 14.7,
            classRates: { '100': 1.0 },
            weightBreaks: [{ minLbs: 0, rateFactor: 1.0 }],
            distanceFactorPer1000Mi: 0,
            absoluteMinCharge: 95,
          },
        },
      ],
    };
    const { cards } = draftToEngineConfig(draft);
    expect(cards[0].minimumCharge).toBe(120);
  });
});
