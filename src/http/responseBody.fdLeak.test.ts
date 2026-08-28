/**
 * FD-LEAK REGRESSION TEST — "the abort must stay armed through the BODY read".
 *
 * This is the automated form of the load harness that diagnosed the residual
 * production socket leak (prod refusing NEW connections after ~13h while the DB
 * stayed healthy — the EMFILE signature).
 *
 * The leak was NOT an abandoned body (PR #429 fixed those with `releaseBody`).
 * It was helpers shaped like this:
 *
 *     const ctrl = new AbortController();
 *     const timer = setTimeout(() => ctrl.abort(), ms);
 *     try {
 *       return await fetch(url, { signal: ctrl.signal });  // resolves on HEADERS
 *     } finally {
 *       clearTimeout(timer);   // disarms the abort before any body byte is read
 *     }
 *
 * The caller then ran `await res.json()` with no deadline at all. An upstream
 * that answers headers and stalls its body therefore pinned ONE SOCKET PER
 * REQUEST, forever — and unlike an abandoned body it is not even GC-reclaimable,
 * because the suspended `await` holds a strong reference to the Response.
 *
 * Both patterns are exercised here against a real local server that sends
 * headers and then never finishes the body, counting the sockets it still holds
 * open afterwards. The old pattern must pin one per request; the shipped
 * `exchangeTimeoutSignal` must end at zero.
 */
import { createServer, type Server } from 'node:http';
import type { Socket } from 'node:net';
import { once } from 'node:events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exchangeTimeoutSignal } from './responseBody.js';

/** How long each request is allowed before its abort must fire. */
const TIMEOUT_MS = 300;
/** Requests per pattern. Enough that a 1:1 leak is unambiguous. */
const REQUESTS = 25;
/** How long a correctly-aborted request is given to release its socket. Sized
 *  for a heavily-loaded CI box, where abort timers fire well behind schedule. */
const DRAIN_BUDGET_MS = 10_000;

let server: Server;
let port: number;
/**
 * EVERY connection the stalling upstream is still holding open, including the
 * idle keep-alive connections undici keeps for its pool. Only used to tear the
 * fixture down in `afterEach` — never to assert on. See `requestSockets`.
 */
const liveSockets = new Set<Socket>();
/**
 * The subset of `liveSockets` that actually carried an HTTP REQUEST — the only
 * population this test is about, because a leaked FD is by definition a socket
 * still pinned to a request nobody will ever finish reading.
 *
 * WHY THE DISTINCTION EXISTS (it is what made this suite red on Linux CI while
 * green on Windows): undici does not just destroy the socket when a request is
 * aborted — it then opens a FRESH connection into its pool. That replacement
 * carries no request and is reaped on undici's own keep-alive schedule, which
 * is version-dependent: ~3.00s on the undici bundled with Node 22 (what CI
 * runs), but ~0ms on Node 24 (local Windows). Counting raw connections
 * therefore reports a perfectly healthy abort as a "pinned socket" for three
 * seconds on CI and not at all locally.
 *
 * That linger is ordinary connection reuse, not a leak: a plain request that is
 * answered and fully consumed — no abort, no timeout signal anywhere near it —
 * leaves an identical ~3s idle connection behind on both platforms. Keying the
 * assertions off request-carrying sockets measures the leak itself instead of
 * undici's pool, so the test means the same thing on every runtime.
 */
const requestSockets = new Set<Socket>();

beforeEach(async () => {
  liveSockets.clear();
  requestSockets.clear();
  server = createServer((req, res) => {
    requestSockets.add(req.socket);
    // Headers land (so `fetch()` RESOLVES), then the body never completes:
    // content-length promises far more than we ever write, so any reader waits
    // forever. This is what a throttled Google/EIA/Hunter endpoint looks like.
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': '100000' });
    res.write('{"status":"OK"');
  });
  server.on('connection', (socket: Socket) => {
    liveSockets.add(socket);
    const forget = () => {
      liveSockets.delete(socket);
      requestSockets.delete(socket);
    };
    socket.on('close', forget);
    socket.on('error', forget);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  port = address.port;
});

afterEach(async () => {
  for (const socket of liveSockets) socket.destroy();
  server.close();
  await once(server, 'close');
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Poll until every request-carrying socket has been released, then report what
 * is still pinned.
 *
 * Polls to a bounded deadline instead of sampling once after a fixed sleep:
 * under full-suite parallel load the abort timers fire late, and a fixed window
 * reports a socket as "pinned" when it was merely slow to be reclaimed. A
 * correctly aborted request reaches zero well inside this budget; a genuinely
 * pinned one never drops at all, so the leak case pays the full wait exactly
 * once and still returns a non-zero count. Callers keep asserting `toBe(0)` —
 * polling costs the leak nothing in strictness, only time.
 */
async function drainPinnedSockets(): Promise<number> {
  const deadline = Date.now() + DRAIN_BUDGET_MS;
  while (Date.now() < deadline && requestSockets.size > 0) {
    await sleep(100);
    (globalThis as { gc?: () => void }).gc?.();
  }
  return requestSockets.size;
}

/**
 * Fire N body reads through `doFetch`, then report sockets still pinned.
 *
 * The reads are deliberately NOT awaited: under the buggy pattern they never
 * settle at all (that IS the leak), so awaiting them would hang the test rather
 * than measure it. We start them, wait well past the deadline, and count what
 * the upstream is still holding open.
 */
async function pinnedAfter(doFetch: (url: string) => Promise<Response>): Promise<number> {
  for (let i = 0; i < REQUESTS; i++) {
    void doFetch(`http://127.0.0.1:${port}/?i=${i}`)
      .then((res) => res.json())
      .catch(() => {
        // An abort/parse rejection is the CORRECT outcome — what this test
        // asserts is the fate of the socket, measured by the caller below.
      });
  }
  // 1. Wait for every request to actually REACH the server. Without this the
  //    drain poll below would exit immediately on a still-empty set.
  const connectDeadline = Date.now() + DRAIN_BUDGET_MS;
  while (Date.now() < connectDeadline && requestSockets.size < REQUESTS) await sleep(25);
  expect(requestSockets.size).toBe(REQUESTS);

  // 2. Then wait for them to drain.
  return drainPinnedSockets();
}

describe('outbound fetch FD hygiene: the abort must cover the body read', () => {
  it('REGRESSION: clearing the timer in `finally` pins one socket per request', async () => {
    const pinned = await pinnedAfter(async (url) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        return await fetch(url, { signal: controller.signal });
      } finally {
        // The bug: `fetch` resolved on HEADERS, so this disarms the abort
        // before the caller reads a single body byte.
        clearTimeout(timer);
      }
    });
    // Every request leaks its socket — this is the shape that took prod down.
    expect(pinned).toBe(REQUESTS);
  }, 40_000);

  it('exchangeTimeoutSignal releases every socket (stays armed through the body)', async () => {
    const pinned = await pinnedAfter((url) =>
      fetch(url, { signal: exchangeTimeoutSignal(TIMEOUT_MS) }),
    );
    expect(pinned).toBe(0);
  }, 40_000);

  it('still honours a caller-supplied signal when one is combined in', async () => {
    const caller = new AbortController();
    const url = `http://127.0.0.1:${port}/combined`;
    const inflight = fetch(url, {
      // A deliberately huge timeout: only the caller's abort can end this.
      signal: exchangeTimeoutSignal(60_000, caller.signal),
    }).then((res) => res.json());

    await sleep(150);
    caller.abort();

    // The CALLER's abort must be what ends this. `AbortSignal.timeout` rejects
    // with a `TimeoutError`, so pinning the name to `AbortError` proves the
    // combine actually forwarded the caller's cancellation rather than the
    // exchange dying of something else.
    await expect(inflight).rejects.toMatchObject({ name: 'AbortError' });

    // ...and the socket the stalled body was holding must come back. If the
    // combine dropped the caller's signal, nothing else could end this exchange
    // inside the budget — the 60s timeout is far beyond it — so the socket
    // would stay pinned for the full poll and this assertion would fail.
    expect(await drainPinnedSockets()).toBe(0);
  }, 40_000);
});
