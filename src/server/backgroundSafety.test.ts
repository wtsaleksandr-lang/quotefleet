import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decideUncaughtExceptionAction,
  isServerListening,
  logAndSwallow,
  markServerListening,
  resetServerListeningForTest,
} from './backgroundSafety.js';

describe('decideUncaughtExceptionAction (the boot-vs-serving crash guard)', () => {
  it('EXITS on an uncaughtException that happens BEFORE the server is listening', () => {
    // Still booting → a genuinely-unrecoverable startup error should fail fast so
    // the container gets a clean restart (can't bind port / can't load config).
    expect(decideUncaughtExceptionAction(false)).toBe('exit');
  });

  it('SURVIVES an uncaughtException once the server IS listening', () => {
    // Serving traffic → a throw escaping background work (cron/SWR/precompute/DB)
    // must NOT exit a healthy process, or every route (incl. /healthz) 500s and
    // Replit crash-loops it. This is the core "forever" guarantee.
    expect(decideUncaughtExceptionAction(true)).toBe('survive');
  });
});

describe('server-listening gate', () => {
  afterEach(() => resetServerListeningForTest());

  it('starts false (booting) and flips true after markServerListening()', () => {
    expect(isServerListening()).toBe(false);
    markServerListening();
    expect(isServerListening()).toBe(true);
  });

  it('drives the guard from exit → survive as boot completes', () => {
    expect(decideUncaughtExceptionAction(isServerListening())).toBe('exit');
    markServerListening();
    expect(decideUncaughtExceptionAction(isServerListening())).toBe('survive');
  });
});

describe('logAndSwallow', () => {
  afterEach(() => vi.restoreAllMocks());

  it('logs the error with context and NEVER rethrows (swallows)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler = logAndSwallow('unit-test job');
    const boom = new Error('background boom');
    // Must not throw — a fire-and-forget .catch(logAndSwallow(...)) can never
    // re-raise into an unhandledRejection.
    expect(() => handler(boom)).not.toThrow();
    expect(spy).toHaveBeenCalledTimes(1);
    const [msg, err] = spy.mock.calls[0];
    expect(String(msg)).toContain('unit-test job');
    expect(err).toBe(boom);
  });

  it('is a real rejection handler: catching a rejected promise with it resolves cleanly', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // If logAndSwallow rethrew, this await would reject.
    await expect(
      Promise.reject(new Error('rejected')).catch(logAndSwallow('promise path')),
    ).resolves.toBeUndefined();
  });
});
