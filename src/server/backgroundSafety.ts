/**
 * Crash-proofing for background / async work.
 *
 * WHY THIS EXISTS:
 * Prod has repeatedly crash-looped (every route 500, including the zero-logic
 * /healthz) when a background path threw — a cron tick, an SWR refresh, a
 * post-listen precompute, or a stray DB rejection. The failure reached a
 * process-level guard in index.ts that called process.exit(1); Replit restarted
 * the container; the same background path threw again → an endless flap that
 * took DOWN an otherwise-healthy server serving traffic.
 *
 * The DEEPER guarantee this module encodes: once the HTTP server is LISTENING,
 * NOTHING from background work may exit the process. A genuinely-unrecoverable
 * STARTUP error (can't bind the port, can't load config) still fails fast — that
 * happens BEFORE listen, so the boot-vs-serving gate below distinguishes the two
 * cleanly. After listen, the process logs and DEGRADES instead of dying.
 *
 * Two seams:
 *   - logAndSwallow(context): the standard rejection handler for every
 *     fire-and-forget `void somePromise()` so a rejection can never surface as an
 *     unhandledRejection (and, defensively, is logged with context).
 *   - the boot-vs-serving state + decideUncaughtExceptionAction(): the pure,
 *     unit-testable decision the index.ts uncaughtException handler applies.
 *
 * Everything here is deliberately dependency-free and synchronous so it can
 * never itself be the thing that throws.
 */

/**
 * Standard rejection handler for a fire-and-forget background promise. Logs the
 * error WITH its call-site context and swallows it — it NEVER rethrows, so a
 * rejected `void somePromise().catch(logAndSwallow('x'))` can never become an
 * unhandledRejection. Use at every fire-and-forget site in the server.
 */
export function logAndSwallow(context: string): (err: unknown) => void {
  return (err: unknown) => {
    console.error(`[background] ${context} failed (non-fatal, swallowed):`, err);
  };
}

// ─── Boot-vs-serving gate ───────────────────────────────────────────────────
//
// `listening` flips true the moment app.listen()'s callback fires (see
// index.ts). Before that we are still in startup; after it the server is serving
// traffic. The uncaughtException handler keys its fatal-vs-survive decision off
// this single bit.

let listening = false;

/** Called from the app.listen() callback — the server is now serving traffic. */
export function markServerListening(): void {
  listening = true;
}

/** True once the HTTP listener is up (past startup). */
export function isServerListening(): boolean {
  return listening;
}

/** Test seam: reset the gate so a test can exercise both branches. */
export function resetServerListeningForTest(): void {
  listening = false;
}

/** What the process-level uncaughtException handler should do. */
export type UncaughtAction = 'exit' | 'survive';

/**
 * Pure decision for an uncaughtException: fail fast ONLY while still booting
 * (nothing is serving yet and the process may be half-initialised, so a clean
 * restart is correct); once LISTENING, SURVIVE — a throw bubbling out of
 * background work must never take down a server that is answering requests, or
 * we recreate the crash-loop this module exists to kill. Exported so the exact
 * behaviour is unit-testable with no process/timers.
 */
export function decideUncaughtExceptionAction(serverIsListening: boolean): UncaughtAction {
  return serverIsListening ? 'survive' : 'exit';
}

/**
 * CHAOS PROBE — inert unless CRASHPROOF_SELFTEST=1.
 *
 * When the flag is set, schedule a background timer that throws SYNCHRONOUSLY
 * after listen — i.e. exactly the class of failure that used to crash-loop prod:
 * a stray uncaughtException raised from background work while the server is
 * healthy and serving. With the index.ts guard in place the process must SURVIVE
 * it (the handler logs and returns) and /healthz must keep returning 200. The
 * crashProofBoot integration test sets the flag and asserts precisely that.
 *
 * The flag is never set in any deploy config, so this is a no-op in prod. The
 * timer is unref'd so it can never, by itself, hold the process open.
 */
export function maybeScheduleCrashProofSelfTest(delayMs = 200): void {
  if (process.env.CRASHPROOF_SELFTEST !== '1') return;
  console.error('[crashproof-selftest] armed — will raise a simulated background throw after listen');
  const timer = setTimeout(() => {
    // A synchronous throw inside a timer callback surfaces as a Node
    // 'uncaughtException'. The post-listen guard must swallow it and survive.
    throw new Error('[crashproof-selftest] simulated background uncaughtException');
  }, delayMs);
  if (typeof (timer as { unref?: () => void }).unref === 'function') {
    (timer as { unref: () => void }).unref();
  }
}
