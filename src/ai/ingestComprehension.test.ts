/**
 * Rate-ingestion COMPREHENSION — Zod schema + salvage validation.
 *
 * The AI call is non-deterministic, so we test the deterministic seam: the
 * widened contract (IngestParsedSchema / validateParsed) must
 *   (a) ACCEPT every representative fixture (FTL all-in, linehaul+FSC, LTL
 *       class×weight grid, drayage zones, rate-con, rate-card email, accessorial
 *       schedule) AND the legacy simple shape — backward-compatible widening,
 *   (b) REJECT a structurally-malformed top-level object, and
 *   (c) SALVAGE a partially-valid array (drop the bad member + warn) rather than
 *       hard-failing the whole job.
 */
import { describe, it, expect } from 'vitest';
import {
  IngestParsedSchema,
  validateParsed,
  RateCardDraftSchema,
} from './ingestFile.js';
import {
  ALL_VALID_FIXTURES,
  FIXTURE_LTL_GRID,
  FIXTURE_LEGACY_SIMPLE,
  FIXTURE_MALFORMED_TOPLEVEL,
  FIXTURE_PARTIAL_SALVAGE,
  FIXTURE_ACCESSORIAL_SCHEDULE,
} from './ingestFixtures.js';

describe('IngestParsedSchema — accepts every representative fixture', () => {
  for (const { name, parsed } of ALL_VALID_FIXTURES) {
    it(`accepts: ${name}`, () => {
      expect(IngestParsedSchema.safeParse(parsed).success).toBe(true);
      const out = validateParsed(parsed);
      // No member was dropped — every fixture is well-formed.
      expect(out.warnings.some((w) => /Dropped malformed/.test(w))).toBe(false);
      const inCards = (parsed as { rateCards?: unknown[] }).rateCards ?? [];
      expect(out.rateCards.length).toBe(inCards.length);
    });
  }
});

describe('validateParsed — preserves the new comprehension fields', () => {
  it('keeps the LTL class/weight-break config intact', () => {
    const out = validateParsed(FIXTURE_LTL_GRID);
    const cfg = out.rateCards[0].ltlConfig as Record<string, unknown>;
    expect(cfg).toBeTruthy();
    expect(cfg.baseRatePerCwt).toBe(26);
    expect(cfg.absoluteMinCharge).toBe(95);
    expect(cfg.discountPct).toBe(65);
    expect(cfg.baseTariffName).toBe('CzarLite XL 2024');
    expect(Array.isArray(cfg.weightBreaks)).toBe(true);
    // Top-level carry-alongs.
    expect(out.currency).toBe('USD');
    expect(out.effectiveDate).toBe('2026-03-01');
  });

  it('keeps conditional accessorial fields (freeHours / daysFlag / weightLbsOver)', () => {
    const out = validateParsed(FIXTURE_ACCESSORIAL_SCHEDULE);
    const byCode = Object.fromEntries(out.accessorials.map((a) => [a.code, a]));
    expect((byCode.detention as Record<string, unknown>).freeHours).toBe(2);
    expect((byCode.storage as Record<string, unknown>).daysFlag).toBe('storageDays');
    expect((byCode.layover as Record<string, unknown>).daysFlag).toBe('layoverDays');
    expect((byCode.overweight as Record<string, unknown>).trigger).toBe('auto_if_weight_over');
  });
});

describe('validateParsed — backward compatibility', () => {
  it('accepts the current simple per-mile shape unchanged', () => {
    expect(IngestParsedSchema.safeParse(FIXTURE_LEGACY_SIMPLE).success).toBe(true);
    const out = validateParsed(FIXTURE_LEGACY_SIMPLE);
    expect(out.rateCards.length).toBe(1);
    expect(out.rateCards[0].service).toBe('ftl');
    expect(out.rateCards[0].ratePerMile).toBe(2.5);
    expect(out.accessorials.length).toBe(1);
    // No LTL config, no dropped members.
    expect(out.rateCards[0].ltlConfig ?? null).toBeNull();
    expect(out.warnings.some((w) => /Dropped/.test(w))).toBe(false);
  });
});

describe('validateParsed — rejects / salvages malformed output', () => {
  it('the schema REJECTS a structurally-malformed top-level object', () => {
    expect(IngestParsedSchema.safeParse(FIXTURE_MALFORMED_TOPLEVEL).success).toBe(false);
    // …and validateParsed degrades gracefully (never throws), yielding no cards.
    const out = validateParsed(FIXTURE_MALFORMED_TOPLEVEL);
    expect(out.rateCards).toEqual([]);
  });

  it('a non-object array member is rejected by the item schema', () => {
    expect(RateCardDraftSchema.safeParse(42).success).toBe(false);
  });

  it('SALVAGES a partially-valid array: keeps the good card, drops + warns on the bad one', () => {
    const out = validateParsed(FIXTURE_PARTIAL_SALVAGE);
    expect(out.rateCards.length).toBe(1);
    expect(out.rateCards[0].ratePerMile).toBe(2.4);
    expect(out.warnings.some((w) => /Dropped malformed rate card #2/.test(w))).toBe(true);
  });
});
