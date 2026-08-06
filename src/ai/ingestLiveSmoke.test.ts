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
  it('comprehends an LTL class×weight-break grid → non-empty ltlConfig', async () => {
    const { parseRateSheet } = await import('./ingestFile.js');
    const { RAW_CSV_LTL_GRID } = await import('./ingestFixtures.js');
    const res = await parseRateSheet({
      tenantId: 1,
      filename: 'ltl.csv',
      mimeType: 'text/csv',
      dataBase64: Buffer.from(RAW_CSV_LTL_GRID, 'utf8').toString('base64'),
    });
    const ltlCard = res.parsed.rateCards.find((c) => c.service === 'ltl');
    expect(ltlCard).toBeTruthy();
    expect(ltlCard!.ltlConfig).toBeTruthy();
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
