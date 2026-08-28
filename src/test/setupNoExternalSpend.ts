/**
 * Vitest global setup — the test suite CANNOT spend money.
 *
 * Two independent belts, because $20 of ImportYeti + Hunter credits were burned
 * in two days largely by dev/test/agent traffic:
 *
 *  1. THE COST GUARD IS FORCED OFF. `NODE_ENV=test` is asserted and every
 *     live-pull override env var is deleted, so `externalPullGuard` refuses
 *     ImportYeti / Hunter / draft calls. Under a test runner the guard ignores
 *     env overrides entirely — only the in-code `__setLivePullsForTests(true)`
 *     hook can open the path, and that only ever reaches a test's own `fetch`
 *     stub.
 *
 *  2. A NETWORK SENTINEL replaces `globalThis.fetch`. Any test that reaches the
 *     real network — including a test that forgot to install its own stub, or
 *     one whose `afterEach` restored "the real fetch" — throws loudly instead of
 *     making a request. Tests that need provider data use the committed fixture
 *     (`directory/importerFixture.ts`) via the seeded cache.
 */

// 1. Guard OFF, unambiguously.
process.env.NODE_ENV = 'test';
delete process.env.EXTERNAL_PULLS_ENABLED;
delete process.env.IMPORTYETI_LIVE_PULLS;
delete process.env.HUNTER_LIVE;
delete process.env.IMPORTER_DRAFTS_LIVE;

// 2. Network sentinel. Test files capture `globalThis.fetch` at import time and
//    restore it in afterEach — so what they restore is THIS, not real fetch.
//    LOOPBACK IS ALLOWED: several suites boot a real Express app on 127.0.0.1 and
//    drive it over HTTP, which costs nothing. Everything OFF-BOX throws.
const LOOPBACK = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/i;
const PAID_PROVIDER = /(importyeti|hunter\.io|api\.anthropic\.com)/i;

const realFetch = globalThis.fetch;

globalThis.fetch = (async (input: unknown, init?: unknown): Promise<Response> => {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : String((input as { url?: unknown })?.url ?? input);
  if (LOOPBACK.test(url)) {
    return (realFetch as (i: unknown, n?: unknown) => Promise<Response>)(input, init);
  }
  const paid = PAID_PROVIDER.test(url) ? ' PAID PROVIDER —' : '';
  throw new Error(
    `[test] outbound fetch blocked:${paid} ${url.slice(0, 120)}. ` +
      'The test suite must never make off-box network calls. Stub globalThis.fetch, or use the ' +
      'committed fixture in src/server/directory/importerFixture.ts via the seeded cache.',
  );
}) as unknown as typeof fetch;
