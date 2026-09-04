/**
 * ONE TICK, END TO END, WITH NO NETWORK AND NO DATABASE.
 *
 * `./store.js` is mocked so nothing here opens a connection, and every response
 * comes from an injected `fetch`. What is being tested is the DECISION LAYER:
 * which states get contacted, what happens to a 500, what happens to a 200 with
 * an implausible body, and — the one that matters most — that a failure never
 * reaches `recordSuccess`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const recordSuccess = vi.fn(async () => true);
const recordFailure = vi.fn(async () => true);
const loadLastAttempts = vi.fn(async () => new Map<string, number>());
const cachedSnapshot = vi.fn(() => null as unknown);
const noteAttempt = vi.fn();

vi.mock('./store.js', async () => {
  const actual = await vi.importActual<typeof import('./store.js')>('./store.js');
  return {
    ...actual,
    recordSuccess: (...a: unknown[]) => recordSuccess(...(a as [])),
    recordFailure: (...a: unknown[]) => recordFailure(...(a as [])),
    loadLastAttempts: () => loadLastAttempts(),
    cachedSnapshot: (...a: unknown[]) => cachedSnapshot(...(a as [])),
    noteAttempt: (...a: unknown[]) => noteAttempt(...(a as [])),
  };
});

import {
  SEASONAL_USER_AGENT,
  __resetSeasonalValidatorsForTests,
  ingestOneState,
  normaliseForHash,
  requestUrlFor,
  runSeasonalIngestOnce,
} from './ingest.js';
import { seasonalSourceFor } from '../../calc/osow/seasonal/sources.js';
import { ND_LOADRESTRICT_FIXTURE } from './fixtures/ndLoadRestrict.js';

const ND = seasonalSourceFor('ND')!;
const SD = seasonalSourceFor('SD')!;
const WA = seasonalSourceFor('WA')!;

function response(body: string, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(body, {
    status: init.status ?? 200,
    headers: init.headers ?? {},
  });
}

function deps(fetchImpl: typeof fetch, env: NodeJS.ProcessEnv = {}) {
  return {
    fetchImpl,
    now: () => new Date(Date.UTC(2026, 2, 15, 12)),
    sleep: async () => {},
    log: () => {},
    env,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  recordSuccess.mockResolvedValue(true);
  recordFailure.mockResolvedValue(true);
  loadLastAttempts.mockResolvedValue(new Map());
  cachedSnapshot.mockReturnValue(null);
  __resetSeasonalValidatorsForTests();
});

afterEach(() => {
  __resetSeasonalValidatorsForTests();
});

describe('manners', () => {
  it('identifies itself honestly, with a page and a mailbox an administrator can use', () => {
    expect(SEASONAL_USER_AGENT).toContain('quotefleet.net/tools/seasonal-weight-restrictions');
    expect(SEASONAL_USER_AGENT).toContain('hello@quotefleet.net');
  });

  it('sends that User-Agent on every request', async () => {
    const fetchImpl = vi.fn(async () => response(ND_LOADRESTRICT_FIXTURE));
    await ingestOneState(ND, deps(fetchImpl as unknown as typeof fetch));
    const headers = (fetchImpl.mock.calls[0] as unknown[])[1] as { headers: Record<string, string> };
    expect(headers.headers['User-Agent']).toBe(SEASONAL_USER_AGENT);
  });

  it('records the ATTEMPT before the request, so a hanging source cannot be retried every tick', async () => {
    const fetchImpl = vi.fn(async () => {
      expect(noteAttempt).toHaveBeenCalledWith('ND', expect.any(Number));
      return response(ND_LOADRESTRICT_FIXTURE);
    });
    await ingestOneState(ND, deps(fetchImpl as unknown as typeof fetch));
  });
});

describe('a successful fetch', () => {
  it('parses North Dakota and persists the rows with the ORDER\'s own dates', async () => {
    const fetchImpl = vi.fn(async () => response(ND_LOADRESTRICT_FIXTURE));
    const out = await ingestOneState(ND, deps(fetchImpl as unknown as typeof fetch));
    expect(out).toMatchObject({ state: 'ND', result: 'updated', rows: 4, verifiedClear: false });
    expect(recordFailure).not.toHaveBeenCalled();
    const written = (recordSuccess.mock.calls[0] as unknown[])[0] as {
      rows: Array<{ effectiveFrom: string }>;
      bulletinDate: string;
      retrievedOn: string;
    };
    expect(written.rows[0]?.effectiveFrom).toBe('2026-06-25');
    expect(written.bulletinDate).toBe('2026-06-24');
    expect(written.retrievedOn).toBe('2026-03-15');
  });
});

describe('NOTHING that went wrong is allowed to look like an answer', () => {
  it('a 500 is a failure, and recordSuccess is never called', async () => {
    const fetchImpl = vi.fn(async () => response('gateway error', { status: 500 }));
    const out = await ingestOneState(ND, deps(fetchImpl as unknown as typeof fetch));
    expect(out).toMatchObject({ state: 'ND', result: 'failed' });
    expect(recordSuccess).not.toHaveBeenCalled();
    expect(recordFailure).toHaveBeenCalledWith('ND', expect.stringContaining('HTTP 500'));
  });

  it('a THROWN fetch is a failure, not an empty state', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    const out = await ingestOneState(ND, deps(fetchImpl as unknown as typeof fetch));
    expect(out).toMatchObject({ result: 'failed' });
    expect(recordSuccess).not.toHaveBeenCalled();
  });

  it('a 200 with an EMPTY FeatureCollection is a failure — the soft-failure rule', async () => {
    // The exact bug #465 fixed in the FMCSA ingest: a 200 that parses cleanly
    // and contains nothing, written as an authoritative zero.
    const fetchImpl = vi.fn(async () => response('{"type":"FeatureCollection","features":[]}'));
    const out = await ingestOneState(ND, deps(fetchImpl as unknown as typeof fetch));
    expect(out).toMatchObject({ result: 'failed' });
    expect(recordSuccess).not.toHaveBeenCalled();
    expect(recordFailure).toHaveBeenCalledWith(
      'ND',
      expect.stringContaining('cannot clear good data'),
    );
  });

  it('a change-detect page that renders almost no text is a failure, not a change', async () => {
    const fetchImpl = vi.fn(async () => response('<html><body><p>Maintenance</p></body></html>'));
    const out = await ingestOneState(SD, deps(fetchImpl as unknown as typeof fetch));
    expect(out).toMatchObject({ state: 'SD', result: 'failed' });
    expect(recordSuccess).not.toHaveBeenCalled();
  });
});

describe('change-detect states', () => {
  it('records a page hash and NO rows, and never claims a clear', async () => {
    const page = `<html><body>${'South Dakota spring load restrictions are in effect in the following counties. '.repeat(8)}</body></html>`;
    const fetchImpl = vi.fn(async () => response(page));
    const out = await ingestOneState(SD, deps(fetchImpl as unknown as typeof fetch));
    expect(out).toMatchObject({ state: 'SD', result: 'updated', rows: 0, verifiedClear: false });
    const written = (recordSuccess.mock.calls[0] as unknown[])[0] as { contentHash: string };
    expect(written.contentHash).toMatch(/^page-/);
  });

  it('hashes the visible TEXT, so a rotating script or session id is not a change', () => {
    const a = normaliseForHash('<html><script>var t=1</script><p>Zone 1 restricted</p><!-- x --></html>');
    const b = normaliseForHash('<html><script>var t=999</script><p>Zone 1 restricted</p><!-- y --></html>');
    expect(a).toBe(b);
    expect(a).toBe('Zone 1 restricted');
  });
});

describe('the free WSDOT access code', () => {
  it('is appended when set', () => {
    const url = requestUrlFor(WA, { WSDOT_TRAVELER_API_KEY: 'abc 123' });
    expect(url).toContain('AccessCode=abc%20123');
  });

  it('SKIPS the state when unset — a missing free key is not a broken source, and costs nothing', async () => {
    const fetchImpl = vi.fn();
    const out = await ingestOneState(WA, deps(fetchImpl as unknown as typeof fetch, {}));
    expect(out).toMatchObject({ state: 'WA', result: 'skipped' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(recordFailure).not.toHaveBeenCalled();
    expect(recordSuccess).not.toHaveBeenCalled();
  });
});

describe('one tick', () => {
  it('records `skipped` — a HEALTHY outcome — when nothing is due', async () => {
    // Everything attempted one second ago.
    const justNow = Date.UTC(2026, 2, 15, 11, 59, 59);
    loadLastAttempts.mockResolvedValue(
      new Map([
        ['ND', justNow], ['MN', justNow], ['MI', justNow], ['WI', justNow], ['SD', justNow],
        ['MT', justNow], ['ME', justNow], ['AK', justNow], ['ID', justNow], ['NE', justNow],
        ['WY', justNow], ['WA', justNow],
      ]),
    );
    const out = await runSeasonalIngestOnce(deps(vi.fn() as unknown as typeof fetch));
    expect(out.status).toBe('skipped');
    expect(out.detail).toContain('no state is due');
  });

  it('contacts at most three states per tick, even on a cold start with twelve due', async () => {
    // POLITENESS IS THE ASSERTION. Nothing has ever been attempted, so every
    // pollable state is due; a naive implementation would open twelve
    // connections to twelve state web servers inside one tick.
    const fetchImpl = vi.fn(async () => response(ND_LOADRESTRICT_FIXTURE));
    await runSeasonalIngestOnce(deps(fetchImpl as unknown as typeof fetch));
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('reports FAILURE when a state failed, and names it', async () => {
    const fetchImpl = vi.fn(async () => response('nope', { status: 503 }));
    const out = await runSeasonalIngestOnce(deps(fetchImpl as unknown as typeof fetch));
    expect(out.status).toBe('failure');
    expect(out.detail).toContain('HTTP 503');
  });
});
