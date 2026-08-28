/**
 * Release an unconsumed `fetch` Response body so its underlying socket is freed
 * immediately instead of lingering until GC.
 *
 * WHY THIS EXISTS (the FD/socket leak fix): Node's global `fetch` is undici. When
 * a Response is obtained but its BODY is never consumed (`.json()` / `.text()` /
 * `.arrayBuffer()`), undici does NOT drain the stream — it pins the underlying
 * socket to that request and only reclaims it when the Response is garbage-
 * collected (via a FinalizationRegistry). On the ERROR / early-return paths a lot
 * of our outbound callers do exactly this:
 *
 *     const res = await fetch(url);
 *     if (!res.ok) return null;   // ← body never read → socket pinned until GC
 *
 * Under sustained upstream errors/timeouts (Google Maps 403/429, FMCSA/Nominatim
 * flakiness, etc.) these pinned sockets accumulate FASTER than GC reclaims them,
 * so the process's open file descriptors climb without bound until it can no
 * longer open a socket — `EMFILE: too many open files` — which took down the
 * internal healthcheck (`dial tcp 127.0.0.1:PORT: socket: too many open files`)
 * and only reset on restart. Classic slow, unbounded socket leak.
 *
 * `body.cancel()` tears the stream down and returns undici's socket to the pool
 * at once. This helper is a no-op when there is no body (204 / HEAD) or when the
 * body was already consumed/locked (cancel on a locked stream throws — swallowed),
 * so it is always safe to call on any early-return / throw path after a fetch.
 */
export function releaseBody(res: Response | null | undefined): void {
  try {
    const body = res?.body as ReadableStream<Uint8Array> | null | undefined;
    // A locked stream means a reader is active (the body is being/was consumed) —
    // nothing to release, and cancel() would throw, so skip it.
    if (body && !body.locked && typeof body.cancel === 'function') {
      void body.cancel().catch(() => {
        /* upstream already closed the socket — nothing to do */
      });
    }
  } catch {
    /* body already consumed or not cancellable — nothing to release */
  }
}

/**
 * An abort signal that stays armed for the WHOLE exchange — the headers AND the
 * body read.
 *
 * WHY THIS EXISTS (the RESIDUAL FD leak, the one `releaseBody` does NOT cover):
 * several helpers wrapped a fetch in a manual `AbortController` and cleared the
 * timer in a `finally`, like this:
 *
 *     const ctrl = new AbortController();
 *     const timer = setTimeout(() => ctrl.abort(), ms);
 *     try {
 *       return await fetch(url, { signal: ctrl.signal });   // ← resolves on HEADERS
 *     } finally {
 *       clearTimeout(timer);   // ← disarms the abort before ANY body byte is read
 *     }
 *
 * `fetch()` resolves as soon as response HEADERS arrive; the body has not been
 * read yet. Because the helper RETURNS the Response, the `finally` necessarily
 * runs first and `clearTimeout` disarms the only abort path. The caller then
 * does `await res.json()` with NO deadline at all.
 *
 * An upstream that answers headers and then stalls or dribbles the body — the
 * routine behaviour of a throttled Google Places / EIA / Hunter endpoint, or any
 * intermediate proxy — therefore pins one socket PER REQUEST. This is strictly
 * WORSE than the abandoned-body leak `releaseBody` fixes: an abandoned body is
 * at least reclaimable by undici's FinalizationRegistry, but here the suspended
 * `await` holds a live strong reference to the Response, so GC can never collect
 * it and `releaseBody` is unreachable (the `!res.ok` branch never runs on a 200).
 * The FD is pinned for the lifetime of the process.
 *
 * `AbortSignal.timeout()` is the fix: it is bound to the whole fetch — including
 * body consumption — so a stalled body aborts on schedule and undici destroys
 * the socket. Its internal timer is unref'd by Node, so it never keeps the
 * process alive. When the caller supplies its own signal the two are combined,
 * so caller cancellation still works.
 */
export function exchangeTimeoutSignal(
  ms: number,
  callerSignal?: AbortSignal | null,
): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  if (!callerSignal) return timeout;
  // AbortSignal.any is Node >= 20.3. Fall back to the timeout alone on older
  // runtimes — the FD guarantee (what this helper exists for) still holds.
  const anyOf = (AbortSignal as unknown as {
    any?: (signals: AbortSignal[]) => AbortSignal;
  }).any;
  return typeof anyOf === 'function' ? anyOf.call(AbortSignal, [timeout, callerSignal]) : timeout;
}
