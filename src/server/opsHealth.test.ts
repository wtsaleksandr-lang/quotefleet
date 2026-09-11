/**
 * The ops health surface, and the error reporter behind it.
 *
 * The tests that carry weight here are the ones that pin down the behaviours
 * the two production incidents needed and did not have:
 *
 *   • an ingest run that completed and changed NOTHING must be readable as a
 *     no-op, and `changed=n/a` must never be readable as a measured zero;
 *   • a 429 from a branded subdomain must be reported as `rate_limited` and as
 *     `down`, not lumped into a generic failure;
 *   • the endpoint must REFUSE anonymous callers, because an ops report names
 *     which jobs are dead;
 *   • the error reporter must be inert with no DSN, and must never let a
 *     secret or an email out when it is active.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';

import {
  parseIngestDetail,
  opsHealthAuth,
  runSyntheticCheck,
  resetSyntheticCacheForTest,
  OPS_HEALTH_TOKEN_ENV,
  OPS_SYNTHETIC_DISABLED_ENV,
  OPS_SYNTHETIC_SLUG_ENV,
  SYNTHETIC_TTL_MS,
  probeHostDomain,
} from './routes/opsHealth.js';
import {
  parseSentryDsn,
  scrubSensitive,
  buildEvent,
  buildEnvelope,
  fingerprint,
  shouldReport,
  captureException,
  initErrorMonitoring,
  isErrorMonitoringActive,
  errorMonitoringStatus,
  resetErrorMonitoringForTest,
  framesFrom,
  MAX_EVENTS_PER_HOUR,
} from './errorMonitoring.js';
import { utcDay, isKnownConversionEvent } from './conversionCounters.js';

// ─────────────────────────────────────────────────────────────────────────────
describe('parseIngestDetail — reading PR #537s honest accounting back out', () => {
  it('reads changed + warnings from the fixed key=value shape', () => {
    const detail =
      'weekly seen=330218 written=330218 changed=1472 warnings=0 duration_ms=900000 '
      + 'finished_at=2026-09-07T09:15:00.000Z';
    expect(parseIngestDetail(detail)).toEqual({ changed: 1472, warnings: 0 });
  });

  it('treats changed=n/a as UNMEASURED (null), never as a measured zero', () => {
    // This distinction is the whole point of the `n/a` sentinel: a run whose
    // store could not measure the diff must not be reportable as "changed
    // nothing", which is a completely different — and alarming — fact.
    const r = parseIngestDetail('weekly seen=1 written=1 changed=n/a warnings=0 duration_ms=5');
    expect(r.changed).toBeNull();
  });

  it('reads a genuine zero as zero', () => {
    const r = parseIngestDetail('weekly seen=330218 written=330218 changed=0 warnings=0 [ingest.noop]');
    expect(r.changed).toBe(0);
  });

  it('counts swallowed errors from warnings=', () => {
    expect(parseIngestDetail('weekly changed=5 warnings=12 DEGRADED').warnings).toBe(12);
  });

  it('degrades safely on a null or unparseable detail', () => {
    expect(parseIngestDetail(null)).toEqual({ changed: null, warnings: 0 });
    expect(parseIngestDetail('something else entirely')).toEqual({ changed: null, warnings: 0 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('opsHealthAuth', () => {
  async function call(
    env: NodeJS.ProcessEnv,
    headers: Record<string, string> = {},
    query = '',
  ): Promise<{ status: number; body: unknown }> {
    const app = express();
    app.get('/api/ops/health', opsHealthAuth(env), (_req, res) => {
      res.json({ ok: true, secretish: 'job list' });
    });
    const server = app.listen(0);
    try {
      const port = (server.address() as AddressInfo).port;
      const res = await fetch(`http://127.0.0.1:${port}/api/ops/health${query}`, { headers });
      const body = await res.json().catch(() => null);
      return { status: res.status, body };
    } finally {
      server.close();
    }
  }

  it('REFUSES an anonymous caller when a token is configured', async () => {
    const r = await call({ [OPS_HEALTH_TOKEN_ENV]: 'correct-horse-battery' });
    // No session either → the session path answers 401.
    expect(r.status).toBe(401);
  });

  it('refuses a WRONG token', async () => {
    const r = await call({ [OPS_HEALTH_TOKEN_ENV]: 'correct-horse-battery' }, {
      authorization: 'Bearer wrong-token-here',
    });
    expect(r.status).toBe(401);
  });

  it('admits the right token as a Bearer header', async () => {
    const r = await call({ [OPS_HEALTH_TOKEN_ENV]: 'correct-horse-battery' }, {
      authorization: 'Bearer correct-horse-battery',
    });
    expect(r.status).toBe(200);
  });

  it('admits the right token as ?token= — an uptime pinger cannot set headers', async () => {
    const r = await call(
      { [OPS_HEALTH_TOKEN_ENV]: 'correct-horse-battery' },
      {},
      '?token=correct-horse-battery',
    );
    expect(r.status).toBe(200);
  });

  it('an UNSET token never means "everyone gets in"', async () => {
    // The dangerous misconfiguration: no token set, so the bearer door is
    // closed entirely and the session door must still refuse an anonymous GET.
    const r = await call({}, { authorization: 'Bearer anything-at-all' });
    expect(r.status).toBe(401);
    expect(r.body).not.toMatchObject({ ok: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('synthetic branded-subdomain probe', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    resetSyntheticCacheForTest();
    for (const k of [OPS_SYNTHETIC_DISABLED_ENV, OPS_SYNTHETIC_SLUG_ENV]) saved[k] = process.env[k];
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    vi.restoreAllMocks();
    resetSyntheticCacheForTest();
  });

  it('skips cleanly when disabled — and says WHY rather than reporting green', () => {
    return runSyntheticCheck(new Date(), { [OPS_SYNTHETIC_DISABLED_ENV]: '1' }).then((r) => {
      expect(r.verdict).toBe('skipped');
      expect(r.detail).toContain(OPS_SYNTHETIC_DISABLED_ENV);
      expect(r.verdict).not.toBe('ok');
    });
  });

  it('reports a 429 as rate_limited — the outage that the apex check missed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429 })));
    const r = await runSyntheticCheck(new Date(), { [OPS_SYNTHETIC_SLUG_ENV]: 'acme' });
    expect(r.verdict).toBe('rate_limited');
    expect(r.status).toBe(429);
    expect(r.url).toContain('acme.');
    expect(r.detail).toMatch(/RATE LIMITED/);
  });

  it('probes the SUBDOMAIN, never the apex', async () => {
    const spy = vi.fn(async (_url: string | URL, _init?: RequestInit) => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', spy);
    const r = await runSyntheticCheck(new Date(), { [OPS_SYNTHETIC_SLUG_ENV]: 'acme' });
    expect(r.verdict).toBe('ok');
    const url = String(spy.mock.calls[0]?.[0]);
    expect(url).toMatch(/^https:\/\/acme\.[^/]+\//);
    expect(url).not.toMatch(/^https:\/\/quotefleet\.net\/$/);
  });

  it('reports a non-429 failure as an error, not as ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    const r = await runSyntheticCheck(new Date(), { [OPS_SYNTHETIC_SLUG_ENV]: 'acme' });
    expect(r.verdict).toBe('error');
    expect(r.status).toBe(503);
  });

  it('turns a thrown transport error into a reported error, never a throw', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const r = await runSyntheticCheck(new Date(), { [OPS_SYNTHETIC_SLUG_ENV]: 'acme' });
    expect(r.verdict).toBe('error');
    expect(r.detail).toContain('ECONNREFUSED');
  });

  it('caches, so polling the endpoint cannot hammer our own edge', async () => {
    const spy = vi.fn(async () => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', spy);
    const t0 = new Date();
    await runSyntheticCheck(t0, { [OPS_SYNTHETIC_SLUG_ENV]: 'acme' });
    await runSyntheticCheck(new Date(t0.getTime() + 1000), { [OPS_SYNTHETIC_SLUG_ENV]: 'acme' });
    await runSyntheticCheck(new Date(t0.getTime() + 60_000), { [OPS_SYNTHETIC_SLUG_ENV]: 'acme' });
    expect(spy).toHaveBeenCalledTimes(1);
    // ...and re-probes once the TTL is past.
    await runSyntheticCheck(new Date(t0.getTime() + SYNTHETIC_TTL_MS + 1), {
      [OPS_SYNTHETIC_SLUG_ENV]: 'acme',
    });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('resolves the host domain WITHOUT requiring the full env to load', () => {
    // The probe must still run in a degraded environment — that is the
    // environment you need it in. Going through loadEnv() would make it
    // hard-fail on a missing DATABASE_URL, which has nothing to do with
    // whether a branded subdomain is serving.
    expect(probeHostDomain({})).toBe('quotefleet.net');
    expect(probeHostDomain({ HOST_DOMAINS: 'truckrate.online,quotefleet.net' })).toBe('truckrate.online');
    expect(probeHostDomain({ HOST_DOMAINS: 'https://QuoteFleet.net/' })).toBe('quotefleet.net');
  });

  it('identifies itself so the request is recognisable in edge logs', async () => {
    const spy = vi.fn(async (_url: string | URL, _init?: RequestInit) => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', spy);
    await runSyntheticCheck(new Date(), { [OPS_SYNTHETIC_SLUG_ENV]: 'acme' });
    const init = spy.mock.calls[0]?.[1];
    expect((init?.headers as Record<string, string>)['User-Agent']).toContain('QuoteFleetOpsProbe');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('conversion counters', () => {
  it('buckets by UTC day, not the server timezone', () => {
    expect(utcDay(new Date('2026-09-11T23:59:59.000Z'))).toBe('2026-09-11');
    expect(utcDay(new Date('2026-09-12T00:00:01.000Z'))).toBe('2026-09-12');
  });

  it('accepts only known event names — this is what bounds the table', () => {
    expect(isKnownConversionEvent('signup_submit')).toBe(true);
    expect(isKnownConversionEvent('rfq_submit')).toBe(true);
    expect(isKnownConversionEvent('attacker_made_this_up')).toBe(false);
    expect(isKnownConversionEvent(null)).toBe(false);
    expect(isKnownConversionEvent(12)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('error monitoring — inert without a DSN', () => {
  beforeEach(() => resetErrorMonitoringForTest());
  afterEach(() => { resetErrorMonitoringForTest(); vi.restoreAllMocks(); });

  it('initialises to OFF when SENTRY_DSN is unset, and says so', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(initErrorMonitoring({})).toBe(false);
    expect(isErrorMonitoringActive()).toBe(false);
    expect(warn.mock.calls.flat().join(' ')).toContain('SENTRY_DSN');
  });

  it('makes NO network call when inert', () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    initErrorMonitoring({});
    captureException(new Error('boom'), { transaction: 'GET /x' });
    expect(spy).not.toHaveBeenCalled();
    expect(errorMonitoringStatus().active).toBe(false);
  });

  it('activates from the env var alone once a DSN exists', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(initErrorMonitoring({ SENTRY_DSN: 'https://abc123@o1.ingest.sentry.io/456' })).toBe(true);
    expect(isErrorMonitoringActive()).toBe(true);
    expect(errorMonitoringStatus().host).toBe('o1.ingest.sentry.io');
  });

  it('a malformed DSN degrades to OFF and never throws at boot', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const bad of ['not-a-url', 'https://o1.ingest.sentry.io/456', 'https://k@host/nope']) {
      resetErrorMonitoringForTest();
      expect(() => initErrorMonitoring({ SENTRY_DSN: bad })).not.toThrow();
      expect(isErrorMonitoringActive()).toBe(false);
    }
  });
});

describe('parseSentryDsn', () => {
  it('builds the envelope URL from a standard DSN', () => {
    const d = parseSentryDsn('https://pub1ickey@o99.ingest.sentry.io/1234567');
    expect(d).not.toBeNull();
    expect(d!.projectId).toBe('1234567');
    expect(d!.envelopeUrl).toBe(
      'https://o99.ingest.sentry.io/api/1234567/envelope/?sentry_key=pub1ickey&sentry_version=7',
    );
  });

  it('tolerates a path prefix (self-hosted / GlitchTip)', () => {
    const d = parseSentryDsn('https://key@errors.example.com/sentry/42');
    expect(d!.envelopeUrl).toContain('/sentry/api/42/envelope/');
  });

  it('returns null for empty/undefined rather than throwing', () => {
    expect(parseSentryDsn(undefined)).toBeNull();
    expect(parseSentryDsn('')).toBeNull();
    expect(parseSentryDsn('   ')).toBeNull();
  });
});

describe('scrubSensitive — nothing sensitive leaves the process', () => {
  it('redacts emails', () => {
    expect(scrubSensitive('insert failed for alex@wefixtrades.com')).not.toContain('@wefixtrades.com');
    expect(scrubSensitive('insert failed for alex@wefixtrades.com')).toContain('[email]');
  });

  it('redacts Stripe secret keys', () => {
    const out = scrubSensitive('stripe error with sk_live_51aBcDeFgHiJkLmNoPqR');
    expect(out).not.toContain('sk_live_51aBcDeFgHiJkLmNoPqR');
    expect(out).toContain('[stripe-key]');
  });

  it('redacts bearer tokens and key=/token=/password= values', () => {
    expect(scrubSensitive('Bearer eyJhbGciOiJIUzI1NiJ9')).toContain('[redacted]');
    expect(scrubSensitive('GET /x?api_key=supersecretvalue')).not.toContain('supersecretvalue');
    expect(scrubSensitive('password: hunter2hunter2')).not.toContain('hunter2hunter2');
  });

  it('redacts a password inside a postgres connection string', () => {
    const out = scrubSensitive('connect ECONNREFUSED postgres://qf:s3cr3tPassw0rd@db.neon.tech/main');
    expect(out).not.toContain('s3cr3tPassw0rd');
  });

  it('redacts long opaque tokens the named rules miss', () => {
    expect(scrubSensitive(`session ${'a'.repeat(48)}`)).toContain('[redacted]');
  });

  it('leaves an ordinary message readable — scrubbing must not destroy the signal', () => {
    const msg = 'Cannot read properties of undefined (reading "slug")';
    expect(scrubSensitive(msg)).toBe(msg);
  });
});

describe('event + envelope shape', () => {
  const at = new Date('2026-09-11T12:00:00.000Z');

  it('carries type, scrubbed message, stack frames and context', () => {
    const err = new Error('failed for alex@wefixtrades.com');
    const ev = buildEvent(err, { transaction: 'GET /directory/:state', tags: { reqId: 'r1' } }, {
      now: at,
      environment: 'production',
    });
    expect(ev.exception.values[0]!.type).toBe('Error');
    expect(ev.exception.values[0]!.value).toContain('[email]');
    expect(ev.exception.values[0]!.value).not.toContain('wefixtrades.com');
    expect(ev.transaction).toBe('GET /directory/:state');
    expect(ev.tags.reqId).toBe('r1');
    expect(ev.timestamp).toBe(Math.floor(at.getTime() / 1000));
    expect(ev.exception.values[0]!.stacktrace!.frames.length).toBeGreaterThan(0);
  });

  it('scrubs frame paths too, not only the message', () => {
    const frames = framesFrom('Error: x\n    at f (/app/?token=abcdefghijkl:12:3)');
    expect(JSON.stringify(frames)).not.toContain('abcdefghijkl');
  });

  it('handles a non-Error throw without losing it', () => {
    const ev = buildEvent('a bare string', {}, { now: at, environment: 'test' });
    expect(ev.exception.values[0]!.value).toBe('a bare string');
  });

  it('builds a 3-line newline-delimited envelope', () => {
    const ev = buildEvent(new Error('x'), {}, { now: at, environment: 'test' });
    const lines = buildEnvelope(ev, 'https://k@h/1', at).trimEnd().split('\n');
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]!).event_id).toBe(ev.event_id);
    expect(JSON.parse(lines[1]!).type).toBe('event');
    expect(JSON.parse(lines[2]!).exception.values[0].value).toBe('x');
  });
});

describe('rate limiting — a crash loop must not burn the whole free tier', () => {
  beforeEach(() => resetErrorMonitoringForTest());
  afterEach(() => resetErrorMonitoringForTest());

  it('dedupes an identical error inside the window', () => {
    const t = 1_000_000;
    expect(shouldReport('same-key', t)).toBe(true);
    expect(shouldReport('same-key', t + 1000)).toBe(false);
    expect(shouldReport('different-key', t + 1000)).toBe(true);
  });

  it('caps events per hour and counts what it dropped', () => {
    const t = 2_000_000;
    for (let i = 0; i < MAX_EVENTS_PER_HOUR; i++) expect(shouldReport(`k${i}`, t + i)).toBe(true);
    expect(shouldReport('one-too-many', t + 9999)).toBe(false);
    // Dropping silently would recreate the original problem, so it is counted
    // and surfaced by the health endpoint.
    expect(errorMonitoringStatus().droppedToCap).toBeGreaterThan(0);
  });

  it('fingerprints two different errors differently and one error stably', () => {
    const a = new Error('alpha');
    const b = new Error('beta');
    expect(fingerprint(a, 'GET /x')).toBe(fingerprint(a, 'GET /x'));
    expect(fingerprint(a, 'GET /x')).not.toBe(fingerprint(b, 'GET /x'));
    expect(fingerprint(a, 'GET /x')).not.toBe(fingerprint(a, 'GET /y'));
  });
});
