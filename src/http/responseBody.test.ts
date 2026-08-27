import { describe, it, expect, vi } from 'vitest';
import { releaseBody } from './responseBody.js';

/**
 * Unit coverage for the FD/socket-leak guard. `releaseBody` must cancel an
 * unconsumed fetch body (returning undici's socket to the pool) and be a safe
 * no-op on every shape it can legitimately receive on an error/early-return path.
 */
describe('releaseBody', () => {
  it('cancels an unconsumed, unlocked body (frees the socket)', () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    releaseBody({ body: { locked: false, cancel } } as unknown as Response);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('does NOT cancel a locked body (a reader is active / body being consumed)', () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    releaseBody({ body: { locked: true, cancel } } as unknown as Response);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('is a no-op for a bodyless response (204 / HEAD)', () => {
    expect(() => releaseBody({ body: null } as unknown as Response)).not.toThrow();
  });

  it('is a no-op for null / undefined', () => {
    expect(() => releaseBody(null)).not.toThrow();
    expect(() => releaseBody(undefined)).not.toThrow();
  });

  it('swallows a rejected cancel() so it can never surface as an unhandled rejection', () => {
    const cancel = vi.fn().mockRejectedValue(new Error('socket already closed'));
    expect(() => releaseBody({ body: { locked: false, cancel } } as unknown as Response)).not.toThrow();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('really cancels a live WHATWG ReadableStream body without throwing', async () => {
    // A genuine Response with an unconsumed stream body — releaseBody must cancel
    // it (not throw), leaving it unusable for a subsequent read.
    const res = new Response('unconsumed-body-bytes');
    expect(res.body).toBeTruthy();
    releaseBody(res);
    // After cancel the body is no longer readable; a read must reject/throw.
    await expect(res.text()).rejects.toBeTruthy();
  });
});
