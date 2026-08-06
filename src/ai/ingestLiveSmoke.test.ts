/**
 * OPTIONAL live smoke test for the real AI ingest pass.
 *
 * Gated behind ANTHROPIC_API_KEY — SKIPPED entirely when the key is unset (so
 * it never runs in CI / the guard set and never spends money there). To run it
 * locally against the shared key:
 *   doppler run -p quotefleet -c dev --scope "C:\\Users\\Owner" -- \
 *     node node_modules/vitest/vitest.mjs run src/ai/ingestLiveSmoke.test.ts
 *
 * It feeds a couple of raw fixture rate-sheet TEXTS through parseRateSheet and
 * asserts the SHAPE the comprehension upgrade should produce (not exact numbers,
 * since the model is non-deterministic): an LTL grid yields a non-empty
 * ltlConfig; an all-in FTL sheet yields fuelSurchargePct 0.
 */
import { describe, it, expect, vi } from 'vitest';

// Mock only the seams that would need a real DB — the model call is REAL.
vi.mock('../db/client.js', () => ({
  db: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
  }),
}));
vi.mock('../config.js', () => ({
  loadEnv: () => ({ ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '' }),
}));

// Only run against a REAL Anthropic key (prefix `sk-ant-`). CI injects a dummy
// `sk-test`, so a mere presence check would run the test and 401 — gate on the
// real prefix so this stays skipped in CI/the guard set and never spends money.
const RUN = /^sk-ant-/.test(process.env.ANTHROPIC_API_KEY ?? '');

describe.skipIf(!RUN)('LIVE ingest smoke (ANTHROPIC_API_KEY set)', () => {
  it('comprehends an LTL class×weight-break grid → populated ltlConfig that PRICES non-default', async () => {
    const { parseRateSheet } = await import('./ingestFile.js');
    const { RAW_CSV_LTL_GRID } = await import('./ingestFixtures.js');
    const { draftToEngineConfig } = await import('../server/routes/ingest.js');
    const { calculate } = await import('../calc/engine.js');

    const res = await parseRateSheet({
      tenantId: 1,
      filename: 'ltl.csv',
      mimeType: 'text/csv',
      dataBase64: Buffer.from(RAW_CSV_LTL_GRID, 'utf8').toString('base64'),
    });
    const ltlCard = res.parsed.rateCards.find((c) => c.service === 'ltl');
    expect(ltlCard, 'model should emit an LTL rate card').toBeTruthy();
    // The headline capability: a real LTL grid must yield a POPULATED class/
    // weight-break config, not a null fallback.
    const cfg = ltlCard!.ltlConfig as Record<string, unknown> | null | undefined;
    expect(cfg, 'LTL card must carry a populated ltlConfig').toBeTruthy();
    expect(Number(cfg!.baseRatePerCwt)).toBeGreaterThan(0);
    expect(cfg!.classRates && Object.keys(cfg!.classRates as object).length).toBeGreaterThan(1);
    expect(Array.isArray(cfg!.weightBreaks) && (cfg!.weightBreaks as unknown[]).length).toBeGreaterThan(1);

    // And it must actually PRICE through the engine — a sane, non-default quote.
    const { cards } = draftToEngineConfig({ rateCards: res.parsed.rateCards });
    const req = { service: 'ltl', equipment: String(ltlCard!.equipment ?? 'pallet'), miles: 600, weightLbs: 6000, freightClass: 175 };
    const extracted = calculate(cards, [], [], req);
    expect(extracted.unsupported).toBeUndefined();
    expect(extracted.subtotalLinehaul).toBeGreaterThan(0);

    // vs the DEFAULT_LTL_CONFIG fallback (same card, ltlConfig stripped).
    const { cards: defCards } = draftToEngineConfig({
      rateCards: res.parsed.rateCards.map((c) => ({ ...c, ltlConfig: null })),
    });
    const def = calculate(defCards, [], [], req);
    expect(Math.abs(extracted.subtotalLinehaul - def.subtotalLinehaul)).toBeGreaterThan(1);
  }, 90_000);

  it('comprehends a zip3/zone FTL origin×dest matrix → rateMatrices that PRICE to the correct cell', async () => {
    const { parseRateSheet } = await import('./ingestFile.js');
    const { RAW_CSV_ZONE_MATRIX } = await import('./ingestFixtures.js');
    const { draftToEngineConfig } = await import('../server/routes/ingest.js');
    const { calculate } = await import('../calc/engine.js');

    const res = await parseRateSheet({
      tenantId: 1,
      filename: 'zone-matrix.csv',
      mimeType: 'text/csv',
      dataBase64: Buffer.from(RAW_CSV_ZONE_MATRIX, 'utf8').toString('base64'),
    });
    // The headline capability: a real matrix is captured NATIVELY, not flattened.
    expect(res.parsed.rateMatrices, 'model should emit rateMatrices').toBeTruthy();
    expect(res.parsed.rateMatrices!.length).toBeGreaterThan(0);

    const { cards, accs, zones, matrices, matrixZones } = draftToEngineConfig({ rateMatrices: res.parsed.rateMatrices });
    expect(matrices.length).toBeGreaterThan(1);

    const price = (pickupZip: string, deliveryZip: string) =>
      calculate(cards, accs, zones, { service: 'ftl', equipment: 'dryvan', miles: 400, pickupZip, deliveryZip }, [], undefined, matrices, matrixZones);

    // ≥3 specific lanes must price to the EXACT printed cell (all-in → linehaul == cell).
    expect(price('90045', '85003').subtotalLinehaul).toBe(1900); // W → E
    expect(price('85003', '90045').subtotalLinehaul).toBe(1750); // E → W (asymmetric)
    expect(price('60601', '90045').subtotalLinehaul).toBe(2350); // M → W
  }, 90_000);

  it('comprehends a drayage port→zone per-container matrix → prices the correct container cell', async () => {
    const { parseRateSheet } = await import('./ingestFile.js');
    const { RAW_CSV_DRAYAGE_MATRIX } = await import('./ingestFixtures.js');
    const { draftToEngineConfig } = await import('../server/routes/ingest.js');
    const { calculate } = await import('../calc/engine.js');

    const res = await parseRateSheet({
      tenantId: 1,
      filename: 'dray-matrix.csv',
      mimeType: 'text/csv',
      dataBase64: Buffer.from(RAW_CSV_DRAYAGE_MATRIX, 'utf8').toString('base64'),
    });
    expect(res.parsed.rateMatrices!.length).toBeGreaterThan(0);

    const { cards, accs, zones, matrices, matrixZones } = draftToEngineConfig({ rateMatrices: res.parsed.rateMatrices });
    expect(matrices.length).toBeGreaterThan(2);

    const price = (equipment: string, deliveryZip: string) =>
      calculate(cards, accs, zones, {
        service: 'drayage', equipment, miles: 25, pickupPortCode: 'USLAX', deliveryZip,
      }, [], undefined, matrices, matrixZones);

    // Per-container cells — linehaul == the printed container rate (fuel is on fscDetected, no card).
    expect(price('container_40', '90045').subtotalLinehaul).toBe(425);
    expect(price('container_20', '92602').subtotalLinehaul).toBe(560);
    expect(price('container_40hc', '90680').subtotalLinehaul).toBe(545);
  }, 90_000);

  it('comprehends an all-in FTL rate con → fuelSurchargePct 0', async () => {
    const { parseRateSheet } = await import('./ingestFile.js');
    const { RAW_TEXT_FTL_ALL_IN } = await import('./ingestFixtures.js');
    const res = await parseRateSheet({
      tenantId: 1,
      filename: 'ratecon.txt',
      mimeType: 'text/plain',
      dataBase64: Buffer.from(RAW_TEXT_FTL_ALL_IN, 'utf8').toString('base64'),
    });
    const card = res.parsed.rateCards[0];
    expect(card).toBeTruthy();
    expect(Number(card.fuelSurchargePct ?? 0)).toBe(0);
  }, 90_000);
});
