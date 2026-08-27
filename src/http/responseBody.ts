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
