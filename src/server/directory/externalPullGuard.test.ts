/**
 * HARD COST GUARD — the tests that make non-production spend impossible.
 *
 * The contract under test:
 *   • Default OFF everywhere except a real production process.
 *   • Under a test runner it is off and NO env var can turn it back on.
 *   • A blocked call opens ZERO sockets — `globalThis.fetch` is never invoked.
 *   • A blocked pull degrades to CACHE-ONLY, and never writes a fake empty
 *     result back into the licensed cache.
 *   • Prod still works normally (that is the paid, intended path).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  livePullsAllowed,
  guardedFetch,
  isRealProduction,
  isTestRunner,
  externalCallMeter,
  guardStatus,
  __setLivePullsForTests,
  __resetGuardMetersForTests,
} from './externalPullGuard.js';
import { pullImportBols, resolveContactTiered, enrichContact, findImporterLeads } from './importerLeads.js';
import { FIXTURE_SEARCH_ROWS, FIXTURE_SEARCH_IMPORTERS, fixtureBolCache } from './importerFixture.js';

const ENV_KEYS = [
  'NODE_ENV',
  'VITEST',
  'VITEST_WORKER_ID',
  'JEST_WORKER_ID',
  'EXTERNAL_PULLS_ENABLED',
  'IMPORTYETI_LIVE_PULLS',
  'HUNTER_LIVE',
  'IMPORTER_DRAFTS_LIVE',
  'IMPORTYETI_API_KEY',
  'HUNTER_API_KEY',
] as const;

/** Make `livePullsAllowed` take its NON-test-runner branch, so the real
 *  deployment rule can be asserted. Only ever used around the PURE decision
 *  function — never around a call that could touch the network. */
function asNonTestProcess<T>(fn: () => T): T {
  delete process.env.VITEST;
  delete process.env.VITEST_WORKER_ID;
  delete process.env.JEST_WORKER_ID;
  return fn();
}
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  __resetGuardMetersForTests();
  process.env.IMPORTYETI_API_KEY = 'test-key';
  process.env.HUNTER_API_KEY = 'test-key';
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  __resetGuardMetersForTests();
  vi.restoreAllMocks();
});

describe('the default is DENY — an unconfigured process never spends', () => {
  it('reports this process as a test runner, never as production', () => {
    expect(isTestRunner()).toBe(true);
    expect(isRealProduction()).toBe(false);
  });

  it('blocks every provider by default', () => {
    for (const p of ['importyeti', 'hunter', 'anthropic'] as const) {
      expect(livePullsAllowed(p).allowed).toBe(false);
    }
  });

  it('CANNOT be re-enabled by any env var while a test runner is detected', () => {
    process.env.EXTERNAL_PULLS_ENABLED = '1';
    process.env.IMPORTYETI_LIVE_PULLS = '1';
    process.env.HUNTER_LIVE = '1';
    process.env.NODE_ENV = 'production'; // even claiming prod must not help
    expect(livePullsAllowed('importyeti').allowed).toBe(false);
    expect(livePullsAllowed('hunter').allowed).toBe(false);
    expect(isRealProduction()).toBe(false);
  });
});

// THE REGRESSION TEST FOR THE ACTUAL BUG. QuoteFleet's Doppler `dev` config sets
// NODE_ENV=production and the same PUBLIC_BASE_URL as prod, so a laptop boot is
// indistinguishable from production by environment sniffing. A guard that gated
// on NODE_ENV issued a real ImportYeti request from a dev machine. Absence of
// configuration must never mean spend.
describe('a dev process that CLAIMS NODE_ENV=production is still blocked', () => {
  it('denies every provider when no opt-in flag is present', () => {
    process.env.NODE_ENV = 'production';
    asNonTestProcess(() => {
      expect(isRealProduction()).toBe(true); // it really does look like prod
      for (const p of ['importyeti', 'hunter', 'anthropic'] as const) {
        const d = livePullsAllowed(p);
        expect(d.allowed).toBe(false);
        expect(d.reason).toMatch(/no live-pull opt-in/);
      }
    });
  });

  it('allows pulls ONLY with the explicit opt-in that lives in the prod config', () => {
    process.env.NODE_ENV = 'production';
    process.env.EXTERNAL_PULLS_ENABLED = '1';
    asNonTestProcess(() => {
      expect(livePullsAllowed('importyeti').allowed).toBe(true);
      expect(livePullsAllowed('hunter').allowed).toBe(true);
    });
  });

  it('honours the kill switch in BOTH directions — a 0 beats an opt-in', () => {
    process.env.NODE_ENV = 'production';
    process.env.EXTERNAL_PULLS_ENABLED = '1';
    process.env.IMPORTYETI_LIVE_PULLS = '0'; // prod incident → cut ImportYeti only
    asNonTestProcess(() => {
      expect(livePullsAllowed('importyeti').allowed).toBe(false);
      expect(livePullsAllowed('hunter').allowed).toBe(true);
    });
  });

  it('a master 0 cuts everything even with a per-provider opt-in', () => {
    process.env.NODE_ENV = 'production';
    process.env.EXTERNAL_PULLS_ENABLED = '0';
    process.env.HUNTER_LIVE = '1';
    asNonTestProcess(() => {
      expect(livePullsAllowed('hunter').allowed).toBe(false);
      expect(livePullsAllowed('importyeti').allowed).toBe(false);
    });
  });
});

describe('guardedFetch is the choke point', () => {
  it('opens ZERO sockets when blocked', async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    const r = await guardedFetch('importyeti', 'unit', 'https://data.importyeti.com/anything');
    expect(r).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    expect(externalCallMeter().importyeti.blockedCalls).toBe(1);
    expect(externalCallMeter().importyeti.liveCalls).toBe(0);
  });

  it('logs ONE clear BLOCKED line naming the cost guard', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await guardedFetch('hunter', 'unit', 'https://api.hunter.io/v2/domain-search');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('live pull BLOCKED (cost guard) — cache-only');
  });

  it('surfaces per-provider status for the admin view', () => {
    const s = guardStatus();
    expect(s.realProduction).toBe(false);
    expect(s.providers.importyeti.allowed).toBe(false);
    expect(s.providers.hunter.reason).toMatch(/test runner/i);
  });
});

describe('with the guard OFF, the paid paths perform ZERO fetches', () => {
  it('pullImportBols never calls fetch and reports blocked', async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    const out = await pullImportBols({ entryPort: 'Savannah, GA' });
    expect(spy).not.toHaveBeenCalled();
    expect(out.blocked).toBe(true);
    expect(out.rows).toEqual([]);
    expect(out.creditsRemaining).toBeNull();
  });

  it('the Hunter path (resolveContactTiered) never calls fetch', async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    const c = await resolveContactTiered('Robert Bosch Tool Corp', { phone: '912-555-0100', address: 'NC' });
    expect(spy).not.toHaveBeenCalled();
    // Honest phone_only, explicitly flagged as "we did not look" so the caller
    // neither caches it as a negative nor charges a reveal.
    expect(c.contact_confidence).toBe('phone_only');
    expect(c.live_blocked).toBe(true);
    expect(c.email).toBeNull();
  });

  it('enrichContact never calls fetch', async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    expect(await enrichContact('Robert Bosch Tool Corp')).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('findImporterLeads on a cache MISS returns an empty cache-only result and never calls fetch', async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    const store = { get: vi.fn(async () => null), put: vi.fn(async () => {}) };
    const out = await findImporterLeads({
      filters: { entryPort: 'Savannah, GA' },
      bolCache: store,
      cacheKey: 'k',
    });
    expect(spy).not.toHaveBeenCalled();
    expect(out.leads).toEqual([]);
    expect(out.liveBlocked).toBe(true);
    expect(out.pulledLive).toBe(false);
    // CRITICAL: never write an empty "no results" row into the licensed 14-day
    // cache — that would turn a blocked pull into a lasting lie.
    expect(store.put).not.toHaveBeenCalled();
  });
});

describe('cache-only degradation still serves real data', () => {
  it('a cache HIT is served in full with the guard off, spending nothing', async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    const out = await findImporterLeads({
      filters: { entryPort: 'Savannah, GA' },
      bolCache: fixtureBolCache(),
      cacheKey: 'k',
    });
    expect(spy).not.toHaveBeenCalled();
    expect(out.cached).toBe(true);
    expect(out.liveBlocked).toBe(false);
    // Leads are DEDUPED importers, not raw bills — the fixture carries alias
    // rows (same company_basename, different spelling/address) on purpose.
    expect(out.leads.length).toBe(FIXTURE_SEARCH_IMPORTERS);
    expect(out.leads[0].company).toBe('Robert Bosch Tool Corp');
  });
});

describe('the opted-in path still works (the paid, intended prod path)', () => {
  it('the in-code test opt-in routes through the mocked fetch and meters the call', async () => {
    const spy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ requestCost: 5, creditsRemaining: 123, data: { data: [...FIXTURE_SEARCH_ROWS] } }),
    })) as unknown as typeof fetch;
    globalThis.fetch = spy;
    __setLivePullsForTests(true);
    try {
      const out = await pullImportBols({ entryPort: 'Savannah, GA' });
      expect(out.blocked).toBe(false);
      expect(out.rows.length).toBe(FIXTURE_SEARCH_ROWS.length);
      expect(out.creditsRemaining).toBe(123);
      // Every live call is metered so spend is auditable, not invisible.
      expect(externalCallMeter().importyeti.liveCalls).toBe(1);
      expect(externalCallMeter().importyeti.lastCreditsRemaining).toBe(123);
    } finally {
      __setLivePullsForTests(null);
    }
  });
});
