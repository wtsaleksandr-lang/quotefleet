/**
 * Signed unsubscribe token — round-trip + tamper rejection.
 *
 * The token authorizes an anonymous opt-out (GET/POST /unsubscribe), so a
 * forged/tampered token must NEVER resolve to a tenantId. Behavioral: we run
 * the real HMAC (keyed with a fixed SESSION_SECRET) rather than asserting a
 * frozen string.
 */
import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'x'.repeat(64);
  if (!process.env.DATABASE_URL)
    process.env.DATABASE_URL = 'postgresql://dummy:dummy@localhost:5432/dummy';
});

describe('unsubscribe token', () => {
  it('round-trips make → verify for the same tenant', async () => {
    const { makeUnsubscribeToken, verifyUnsubscribeToken } = await import('./unsubscribe.js');
    const token = makeUnsubscribeToken(42);
    expect(verifyUnsubscribeToken(token)).toBe(42);
  });

  it('rejects a tampered signature', async () => {
    const { makeUnsubscribeToken, verifyUnsubscribeToken } = await import('./unsubscribe.js');
    const token = makeUnsubscribeToken(42);
    // Flip the last hex char of the signature.
    const last = token.slice(-1);
    const tampered = token.slice(0, -1) + (last === 'a' ? 'b' : 'a');
    expect(verifyUnsubscribeToken(tampered)).toBeNull();
  });

  it('rejects a swapped tenantId (sig no longer matches the id)', async () => {
    const { makeUnsubscribeToken, verifyUnsubscribeToken } = await import('./unsubscribe.js');
    const token = makeUnsubscribeToken(42);
    const sig = token.slice(token.indexOf('.') + 1);
    // Same signature, different tenantId → must fail (id is part of the HMAC).
    expect(verifyUnsubscribeToken(`99.${sig}`)).toBeNull();
  });

  it('rejects malformed / empty tokens', async () => {
    const { verifyUnsubscribeToken } = await import('./unsubscribe.js');
    expect(verifyUnsubscribeToken(undefined)).toBeNull();
    expect(verifyUnsubscribeToken('')).toBeNull();
    expect(verifyUnsubscribeToken('nodot')).toBeNull();
    expect(verifyUnsubscribeToken('.abc')).toBeNull();
    expect(verifyUnsubscribeToken('notanum.abc')).toBeNull();
  });

  it('builds a tokenized URL rooted at the base (trailing slash tolerated)', async () => {
    const { unsubscribeUrl, verifyUnsubscribeToken } = await import('./unsubscribe.js');
    const url = unsubscribeUrl('https://quotefleet.net/', 7);
    expect(url.startsWith('https://quotefleet.net/unsubscribe?token=')).toBe(true);
    const token = decodeURIComponent(url.split('token=')[1]);
    expect(verifyUnsubscribeToken(token)).toBe(7);
  });
});
