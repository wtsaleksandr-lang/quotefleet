/**
 * INDEXNOW — instant submission to Bing / Yandex / Seznam.
 *
 * What these lock, in the order the protocol punishes you for getting them
 * wrong:
 *   • DEFAULT DENY — an unconfigured process opens NO socket and serves NO
 *     ownership proof, and no env var can turn either on inside a test runner;
 *   • the ownership route serves EXACTLY the key at /<key>.txt and 404s
 *     everything else (driven over real HTTP, not a mocked req/res);
 *   • the POST body is the documented { host, key, keyLocation, urlList } shape
 *     with host derived from the site so it can never disagree;
 *   • a non-2xx is NEVER reported as a success and NEVER records a submission,
 *     so failed URLs stay candidates instead of being silently dropped;
 *   • an unchanged URL is never resubmitted — the rule whose penalty is silent.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import {
  INDEXNOW_ENDPOINT,
  INDEXNOW_KEY_ROUTE,
  INDEXNOW_MAX_URLS_PER_REQUEST,
  INDEXNOW_KEY_PATTERN,
  STATIC_CHANGE_KEY,
  buildIndexNowPayload,
  buildSmallFamilyCandidates,
  describeIndexNowStatus,
  indexNowAllowed,
  indexNowKey,
  indexNowKeyFileHandler,
  indexNowRunCap,
  isIndexNowSuccess,
  keyFilePath,
  resolveIndexNowKeyFile,
  selectChangedCandidates,
  submissionKey,
  submitUrlBatch,
  __resetIndexNowForTests,
  __setIndexNowForTests,
  type IndexNowCandidate,
} from './indexNow.js';

const SITE = 'https://quotefleet.net';
const KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

const ENV_KEYS = ['INDEXNOW_KEY', 'INDEXNOW_ENABLED', 'INDEXNOW_MAX_URLS_PER_RUN'] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  __resetIndexNowForTests();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k] as string;
  }
  __resetIndexNowForTests();
  vi.unstubAllGlobals();
});

// ─── Gate: default deny ─────────────────────────────────────────────────────

describe('gate — default deny', () => {
  it('is OFF with nothing configured, and says why', () => {
    delete process.env.INDEXNOW_KEY;
    delete process.env.INDEXNOW_ENABLED;
    const gate = indexNowAllowed();
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBeTruthy();
  });

  it('cannot be turned on by ENV inside a test runner — only in code', () => {
    // This is the load-bearing safety property: CI and every agent checkout are
    // test runners, and none of them may ever announce our URLs.
    process.env.INDEXNOW_KEY = KEY;
    process.env.INDEXNOW_ENABLED = '1';
    expect(indexNowAllowed().allowed).toBe(false);
    expect(indexNowAllowed().reason).toContain('test runner');

    __setIndexNowForTests(true);
    expect(indexNowAllowed().allowed).toBe(true);
  });

  it('honours the kill switch even with a key and the in-code opt-in', () => {
    process.env.INDEXNOW_KEY = KEY;
    process.env.INDEXNOW_ENABLED = '0';
    __setIndexNowForTests(false);
    expect(indexNowAllowed().allowed).toBe(false);
  });

  it('rejects a malformed key exactly like a missing one', () => {
    process.env.INDEXNOW_KEY = 'short';
    expect(indexNowKey()).toBeNull();
    process.env.INDEXNOW_KEY = 'has spaces and punctuation!!';
    expect(indexNowKey()).toBeNull();
    process.env.INDEXNOW_KEY = KEY;
    expect(indexNowKey()).toBe(KEY);
    expect(INDEXNOW_KEY_PATTERN.test(KEY)).toBe(true);
  });

  it('never lets the per-run cap exceed the protocol ceiling', () => {
    delete process.env.INDEXNOW_MAX_URLS_PER_RUN;
    expect(indexNowRunCap()).toBe(INDEXNOW_MAX_URLS_PER_REQUEST);
    process.env.INDEXNOW_MAX_URLS_PER_RUN = '999999';
    expect(indexNowRunCap()).toBe(INDEXNOW_MAX_URLS_PER_REQUEST);
    process.env.INDEXNOW_MAX_URLS_PER_RUN = '250';
    expect(indexNowRunCap()).toBe(250);
    process.env.INDEXNOW_MAX_URLS_PER_RUN = 'nonsense';
    expect(indexNowRunCap()).toBe(INDEXNOW_MAX_URLS_PER_REQUEST);
  });
});

// ─── Ownership key file, over real HTTP ─────────────────────────────────────

async function startKeyFileServer(): Promise<{ base: string; close: () => Promise<void> }> {
  const app = express();
  app.get(INDEXNOW_KEY_ROUTE, indexNowKeyFileHandler);
  // Stand-in for the rest of the app: anything the handler passes to next()
  // must land here as a 404.
  app.use((_req, res) => {
    res.status(404).type('text/plain').send('Not found');
  });
  const server: Server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no port');
  return {
    base: `http://127.0.0.1:${addr.port}`,
    close: async () => {
      server.close();
      await once(server, 'close');
    },
  };
}

describe('ownership key file — /<key>.txt', () => {
  let srv: Awaited<ReturnType<typeof startKeyFileServer>>;

  beforeEach(async () => {
    srv = await startKeyFileServer();
  });
  afterEach(async () => {
    await srv.close();
  });

  it('serves EXACTLY the key, with no trailing newline', async () => {
    process.env.INDEXNOW_KEY = KEY;
    const res = await fetch(`${srv.base}${keyFilePath(KEY)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    // The spec compares the file BODY to the key; a stray newline is a 403.
    expect(await res.text()).toBe(KEY);
  });

  it('404s when no key is configured — fail closed', async () => {
    delete process.env.INDEXNOW_KEY;
    const res = await fetch(`${srv.base}${keyFilePath(KEY)}`);
    expect(res.status).toBe(404);
  });

  it('404s for a DIFFERENT key of the right shape (no oracle for guessing)', async () => {
    process.env.INDEXNOW_KEY = KEY;
    const other = 'f0e1d2c3b4a5968778695a4b3c2d1e0f';
    expect(INDEXNOW_KEY_PATTERN.test(other)).toBe(true);
    const res = await fetch(`${srv.base}${keyFilePath(other)}`);
    expect(res.status).toBe(404);
  });

  it('404s for a malformed configured key rather than serving it', async () => {
    process.env.INDEXNOW_KEY = 'nope!';
    const res = await fetch(`${srv.base}/nope!.txt`);
    expect(res.status).toBe(404);
  });

  it('does not shadow other root .txt files', async () => {
    process.env.INDEXNOW_KEY = KEY;
    // Falls through to next() → the app's own 404 (in prod: express.static).
    for (const p of ['/robots.txt', '/security.txt', '/ads.txt']) {
      const res = await fetch(`${srv.base}${p}`);
      expect(res.status).toBe(404);
    }
  });

  it('resolveIndexNowKeyFile is fail-closed for every non-match', () => {
    expect(resolveIndexNowKeyFile(keyFilePath(KEY), null)).toBeNull();
    expect(resolveIndexNowKeyFile('/other.txt', KEY)).toBeNull();
    expect(resolveIndexNowKeyFile(keyFilePath(KEY), KEY)).toBe(KEY);
  });
});

// ─── Payload shape ──────────────────────────────────────────────────────────

describe('payload', () => {
  it('is the documented { host, key, keyLocation, urlList } shape', () => {
    const urls = [`${SITE}/directory/carrier/acme-truck-line-inc-52767`];
    const payload = buildIndexNowPayload(SITE, KEY, urls);
    expect(payload).toEqual({
      host: 'quotefleet.net',
      key: KEY,
      keyLocation: `${SITE}/${KEY}.txt`,
      urlList: urls,
    });
  });

  it('derives host from the site so the two can never disagree (422 guard)', () => {
    const payload = buildIndexNowPayload('https://example.test', KEY, []);
    expect(payload.host).toBe('example.test');
    expect(payload.keyLocation.startsWith('https://example.test/')).toBe(true);
  });
});

// ─── Status handling: never a false success ─────────────────────────────────

describe('status handling — honest, never optimistic', () => {
  it('treats ONLY 200 and 202 as success', () => {
    expect(isIndexNowSuccess(200)).toBe(true);
    expect(isIndexNowSuccess(202)).toBe(true);
    for (const s of [201, 204, 299, 400, 403, 422, 429, 500, 503]) {
      expect(isIndexNowSuccess(s)).toBe(false);
    }
  });

  it('has a human-readable meaning for every documented status', () => {
    for (const s of [200, 202, 400, 403, 422, 429]) {
      expect(describeIndexNowStatus(s)).not.toContain('unexpected');
    }
    expect(describeIndexNowStatus(500)).toContain('unexpected');
  });

  it('reports a 200 as submitted', async () => {
    process.env.INDEXNOW_KEY = KEY;
    __setIndexNowForTests(true);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
    const out = await submitUrlBatch(SITE, [`${SITE}/a`]);
    expect(out).toEqual({ status: 'submitted', httpStatus: 200, count: 1 });
  });

  it('POSTs JSON to the documented endpoint', async () => {
    process.env.INDEXNOW_KEY = KEY;
    __setIndexNowForTests(true);
    const spy = vi.fn(async () => new Response('', { status: 202 }));
    vi.stubGlobal('fetch', spy);
    await submitUrlBatch(SITE, [`${SITE}/a`, `${SITE}/b`]);
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(INDEXNOW_ENDPOINT);
    expect(init.method).toBe('POST');
    expect(String((init.headers as Record<string, string>)['Content-Type'])).toContain(
      'application/json',
    );
    expect(JSON.parse(String(init.body))).toMatchObject({
      host: 'quotefleet.net',
      key: KEY,
      urlList: [`${SITE}/a`, `${SITE}/b`],
    });
  });

  for (const status of [400, 403, 422, 429, 500]) {
    it(`reports HTTP ${status} as FAILED, never submitted`, async () => {
      process.env.INDEXNOW_KEY = KEY;
      __setIndexNowForTests(true);
      vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status })));
      const out = await submitUrlBatch(SITE, [`${SITE}/a`]);
      expect(out.status).toBe('failed');
      if (out.status === 'failed') {
        expect(out.httpStatus).toBe(status);
        expect(out.reason).toBeTruthy();
      }
    });
  }

  it('reports a transport failure as failed, not as a silent success', async () => {
    process.env.INDEXNOW_KEY = KEY;
    __setIndexNowForTests(true);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('socket hang up');
      }),
    );
    const out = await submitUrlBatch(SITE, [`${SITE}/a`]);
    expect(out.status).toBe('failed');
    if (out.status === 'failed') expect(out.httpStatus).toBeNull();
  });

  it('backs off after a 429 instead of hammering', async () => {
    process.env.INDEXNOW_KEY = KEY;
    __setIndexNowForTests(true);
    const spy = vi.fn(async () => new Response('', { status: 429 }));
    vi.stubGlobal('fetch', spy);
    expect((await submitUrlBatch(SITE, [`${SITE}/a`])).status).toBe('failed');
    // The next attempt must not open a socket at all.
    const second = await submitUrlBatch(SITE, [`${SITE}/b`]);
    expect(second.status).toBe('skipped');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('refuses a batch over the 10,000-URL cap locally rather than eating a 400', async () => {
    process.env.INDEXNOW_KEY = KEY;
    __setIndexNowForTests(true);
    const spy = vi.fn(async () => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', spy);
    const urls = Array.from({ length: INDEXNOW_MAX_URLS_PER_REQUEST + 1 }, (_v, i) => `${SITE}/${i}`);
    const out = await submitUrlBatch(SITE, urls);
    expect(out.status).toBe('failed');
    expect(spy).not.toHaveBeenCalled();
  });
});

// ─── No-op when disabled ────────────────────────────────────────────────────

describe('no-op when disabled — no socket is ever opened', () => {
  it('does not call fetch when the gate is closed', async () => {
    delete process.env.INDEXNOW_KEY;
    delete process.env.INDEXNOW_ENABLED;
    const spy = vi.fn(async () => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', spy);
    const out = await submitUrlBatch(SITE, [`${SITE}/a`]);
    expect(out.status).toBe('skipped');
    expect(spy).not.toHaveBeenCalled();
  });

  it('does not call fetch when opted in but the key is missing', async () => {
    delete process.env.INDEXNOW_KEY;
    __setIndexNowForTests(true);
    const spy = vi.fn(async () => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', spy);
    expect((await submitUrlBatch(SITE, [`${SITE}/a`])).status).toBe('skipped');
    expect(spy).not.toHaveBeenCalled();
  });

  it('does not call fetch for an EMPTY change set', async () => {
    process.env.INDEXNOW_KEY = KEY;
    __setIndexNowForTests(true);
    const spy = vi.fn(async () => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', spy);
    const out = await submitUrlBatch(SITE, []);
    expect(out.status).toBe('skipped');
    expect(spy).not.toHaveBeenCalled();
  });
});

// ─── Never resubmit an unchanged URL ────────────────────────────────────────

describe('never resubmits an unchanged URL', () => {
  const candidates: IndexNowCandidate[] = [
    { kind: 'page', ref: '/pricing', url: `${SITE}/pricing`, changeKey: STATIC_CHANGE_KEY },
    { kind: 'city', ref: 'texas/houston', url: `${SITE}/directory/texas/houston`, changeKey: STATIC_CHANGE_KEY },
    { kind: 'guide', ref: 'drayage-costs', url: `${SITE}/guides/drayage-costs`, changeKey: '2026-08-01T00:00:00.000Z' },
  ];

  it('drops every candidate whose change key is unchanged', () => {
    const state = new Map(candidates.map((c) => [submissionKey(c.kind, c.ref), c.changeKey]));
    expect(selectChangedCandidates(candidates, state)).toEqual([]);
  });

  it('keeps a candidate that has NEVER been submitted', () => {
    const state = new Map([[submissionKey('page', '/pricing'), STATIC_CHANGE_KEY]]);
    const out = selectChangedCandidates(candidates, state);
    expect(out.map((c) => c.ref)).toEqual(['texas/houston', 'drayage-costs']);
  });

  it('re-announces a URL whose content genuinely changed', () => {
    const state = new Map(candidates.map((c) => [submissionKey(c.kind, c.ref), c.changeKey]));
    state.set(submissionKey('guide', 'drayage-costs'), '2026-01-01T00:00:00.000Z'); // older edit
    expect(selectChangedCandidates(candidates, state).map((c) => c.ref)).toEqual(['drayage-costs']);
  });

  it('never announces the same URL twice inside one batch', () => {
    const dupes = [...candidates, ...candidates];
    const out = selectChangedCandidates(dupes, new Map());
    expect(out).toHaveLength(candidates.length);
    expect(new Set(out.map((c) => c.url)).size).toBe(candidates.length);
  });

  it('gives static families a stable change key so they are announced ONCE', () => {
    const fam = {
      pagePaths: ['/pricing', '/directory'],
      cityHubs: [{ stateSlug: 'texas', citySlug: 'houston' }],
      guides: [],
    };
    const first = buildSmallFamilyCandidates(SITE, fam);
    const second = buildSmallFamilyCandidates(SITE, fam);
    // Identical inputs ⇒ identical change keys ⇒ the second run selects nothing.
    const state = new Map(first.map((c) => [submissionKey(c.kind, c.ref), c.changeKey]));
    expect(selectChangedCandidates(second, state)).toEqual([]);
  });

  it('builds the right URLs for each family', () => {
    const out = buildSmallFamilyCandidates(SITE, {
      pagePaths: ['/pricing'],
      cityHubs: [{ stateSlug: 'texas', citySlug: 'houston' }],
      guides: [{ slug: 'drayage-costs', lastmod: new Date('2026-08-01T00:00:00Z') }],
    });
    expect(out.map((c) => c.url)).toEqual([
      `${SITE}/pricing`,
      `${SITE}/directory/texas/houston`,
      `${SITE}/guides/drayage-costs`,
    ]);
    // A guide carries its REAL last-change timestamp, not a version constant.
    expect(out[2].changeKey).toBe('2026-08-01T00:00:00.000Z');
  });

  it('falls back to the static key for a guide with no usable timestamp', () => {
    const out = buildSmallFamilyCandidates(SITE, {
      pagePaths: [],
      cityHubs: [],
      guides: [{ slug: 'x', lastmod: null }],
    });
    expect(out[0].changeKey).toBe(STATIC_CHANGE_KEY);
  });
});
