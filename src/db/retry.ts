/**
 * Retry for TRANSIENT database failures — and, just as importantly, a precise
 * definition of which failures are not transient.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Neon's serverless compute suspends when idle. The first query after a
 * suspend has to wake it, and that wake can surface as a connection that is
 * refused, reset, or times out mid-handshake — a failure that is gone by the
 * next attempt a few hundred milliseconds later. Every one of QuoteFleet's
 * crons opens with a database read, so a wake blip lands as a whole failed
 * tick: an alert email, a `failure` ledger row, and a job that is not actually
 * broken. 2026-08-31 15:48:57 is the recorded example — `lifecycle-email`
 * failed once and succeeded on the very next tick with nothing changed.
 *
 * THE DANGEROUS HALF OF A RETRY
 * ─────────────────────────────
 * A retry that is too eager is worse than none, in two distinct ways:
 *
 *   1. It hides real breakage. A query against a dropped column fails
 *      identically every time; retrying it three times turns an instant, clear
 *      error into a slow, identical one. So the classifier is an ALLOW-list:
 *      unless an error is positively identified as a connection/wake class, it
 *      is rethrown on the first attempt. Anything unrecognised is permanent.
 *
 *   2. It duplicates side effects. `withDbRetry` is safe ONLY around an
 *      operation that can run twice with no consequence — a pure SELECT, or an
 *      append that is harmless to double. It must NEVER wrap a cron pass that
 *      sends email: re-running the pass would re-send every message it had
 *      already delivered before the connection dropped. The call sites are
 *      deliberately narrow for this reason (see the callers of this function).
 *
 * EXHAUSTION RETHROWS — ALWAYS
 * ────────────────────────────
 * When the last attempt fails the original error is rethrown untouched. It is
 * never converted into an empty result. #465 fixed exactly that bug in the
 * FMCSA ingest — "the fetch failed so I found nothing" rendered as a legitimate
 * zero, which then overwrote good data with emptiness. A failed read must stay
 * a failure all the way up to the ledger, which is what makes `jobFailure`
 * meaningful.
 */

/**
 * postgres.js's own client-side codes (it sets `err.code` to these strings, not
 * to a SQLSTATE, when the failure is below the protocol). Verified against
 * node_modules/postgres/src — these four are the complete set.
 */
const POSTGRES_JS_CONNECTION_CODES: ReadonlySet<string> = new Set([
  'CONNECTION_CLOSED',
  'CONNECTION_DESTROYED',
  'CONNECTION_ENDED',
  'CONNECT_TIMEOUT',
]);

/** Node socket/DNS failures that mean "the network hiccuped", not "you are wrong". */
const TRANSIENT_SYSCALL_CODES: ReadonlySet<string> = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETDOWN',
  // Temporary resolver failure. ENOTFOUND is deliberately EXCLUDED: a hostname
  // that does not resolve is a wrong URL, and retrying it just delays the truth.
  'EAI_AGAIN',
]);

/**
 * SQLSTATEs that mean the server was unreachable or is shutting down/starting.
 * Class 08 is "connection exception" in its entirety; the 57Pxx entries are the
 * server telling us, in the protocol, that it is going away or not up yet —
 * 57P03 (`cannot_connect_now`) is precisely what a waking compute answers.
 */
const TRANSIENT_SQLSTATES: ReadonlySet<string> = new Set([
  '08000', // connection_exception
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08003', // connection_does_not_exist
  '08004', // sqlserver_rejected_establishment_of_sqlconnection
  '08006', // connection_failure
  '08007', // transaction_resolution_unknown
  '08P01', // protocol_violation
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now  ← a Neon compute that is still waking
  '53300', // too_many_connections ← transient under a cron thundering herd
]);

/**
 * Errors that LOOK infrastructural but are permanent, listed explicitly so the
 * reasoning is on the record rather than implied by absence:
 *
 *   53000 configuration_limit_exceeded — Neon's "project has exceeded the
 *         active time quota". The endpoint answers instantly and will keep
 *         answering this until the plan or the month changes. Retrying burns
 *         time and changes nothing. This is the exact error the dev branch
 *         returned throughout the 2026-08-31 alert storm.
 *   57014 query_canceled — our own statement_timeout fired. The query really
 *         did exceed its budget; retrying re-runs the same expensive scan.
 *   28P01 invalid_password / 28000 — credentials are wrong.
 *   42P01 undefined_table / 42703 undefined_column — schema drift.
 *   3D000 invalid_catalog_name — wrong database.
 */
const EXPLICITLY_PERMANENT: ReadonlySet<string> = new Set([
  '53000',
  '57014',
  '28P01',
  '28000',
  '42P01',
  '42703',
  '3D000',
]);

/** Pull `.code` off an error-ish value without assuming a shape. */
function codeOf(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

/**
 * Walk an error's `cause` chain, outermost first.
 *
 * This matters more than it looks. drizzle-orm wraps every driver error in a
 * `DrizzleQueryError` whose `message` is only `"Failed query: <the entire SQL>
 * params: ..."` — the real error survives ONLY as `.cause`. That wrapper is why
 * the 2026-08-31 alert emails were pages of SELECT text with no cause in sight,
 * and why a quota error was mistaken for a prod outage for hours. Anything that
 * classifies or reports a DB error has to unwrap it.
 */
export function errorChain(err: unknown, maxDepth = 8): unknown[] {
  const chain: unknown[] = [];
  let cur: unknown = err;
  for (let i = 0; i < maxDepth && cur != null; i++) {
    chain.push(cur);
    const next = (cur as { cause?: unknown }).cause;
    if (next === cur) break;
    cur = next;
  }
  return chain;
}

/**
 * The most informative message in the chain: the innermost cause that actually
 * says something, falling back outward. Used for ledger detail and alert
 * bodies so they name the failure ("...exceeded the active time quota") instead
 * of quoting the SQL that happened to be in flight.
 */
export function describeDbError(err: unknown): string {
  const chain = errorChain(err);
  for (let i = chain.length - 1; i >= 0; i--) {
    const link = chain[i];
    const msg = link instanceof Error ? link.message : typeof link === 'string' ? link : '';
    const trimmed = msg.trim();
    // Skip drizzle's wrapper, which carries the SQL rather than the diagnosis.
    if (!trimmed || trimmed.startsWith('Failed query:')) continue;
    const code = codeOf(link);
    return code ? `${trimmed} (${code})` : trimmed;
  }
  // Everything in the chain was a wrapper — say so rather than dumping SQL.
  const outer = err instanceof Error ? err.message : String(err);
  return outer.startsWith('Failed query:')
    ? `database query failed (driver gave no cause): ${outer.slice(0, 160)}`
    : outer;
}

/**
 * True only for failures that a later attempt could plausibly survive.
 * Unrecognised errors are PERMANENT by construction — see the header.
 */
export function isTransientDbError(err: unknown): boolean {
  for (const link of errorChain(err)) {
    const code = codeOf(link);
    if (!code) continue;
    // An explicit permanent code anywhere in the chain settles it immediately:
    // a quota rejection wrapped in a connection error is still a quota
    // rejection, and must not be retried.
    if (EXPLICITLY_PERMANENT.has(code)) return false;
    if (
      POSTGRES_JS_CONNECTION_CODES.has(code) ||
      TRANSIENT_SYSCALL_CODES.has(code) ||
      TRANSIENT_SQLSTATES.has(code)
    ) {
      return true;
    }
  }
  return false;
}

export interface DbRetryOptions {
  /** Total attempts including the first. 3 → at most 2 retries. */
  attempts?: number;
  /** Delay before retry #1; each subsequent wait multiplies by `factor`. */
  baseDelayMs?: number;
  factor?: number;
  /** Injected for tests — real sleep by default. */
  sleep?: (ms: number) => Promise<void>;
  /** Jitter source in [0,1). Injected for tests; Math.random by default. */
  random?: () => number;
  log?: (msg: string) => void;
  /** Label used in the retry log line. */
  label?: string;
}

export const DB_RETRY_ATTEMPTS = 3;
export const DB_RETRY_BASE_DELAY_MS = 150;
export const DB_RETRY_FACTOR = 3;

/**
 * Wait before attempt `n` (1-indexed retry number), with ±25% jitter.
 *
 * The jitter is not decoration. Eleven crons share one hourly instant, so a
 * fixed backoff would have them all wake, all fail, and all retry in lockstep —
 * re-creating the herd the stagger exists to break up. Spreading the retries
 * keeps a wake blip from turning into a self-inflicted connection storm.
 */
export function retryDelayMs(retryNumber: number, opts: DbRetryOptions = {}): number {
  const base = opts.baseDelayMs ?? DB_RETRY_BASE_DELAY_MS;
  const factor = opts.factor ?? DB_RETRY_FACTOR;
  const rand = opts.random ?? Math.random;
  const flat = base * Math.pow(factor, Math.max(0, retryNumber - 1));
  const jitter = 0.75 + rand() * 0.5; // [0.75, 1.25)
  return Math.round(flat * jitter);
}

/**
 * Run `fn`, retrying ONLY transient connection/wake failures.
 *
 * Safe exclusively around idempotent work — see the header's second warning.
 * The original error is rethrown once attempts are exhausted, and immediately
 * for anything the classifier does not positively recognise as transient.
 */
export async function withDbRetry<T>(fn: () => Promise<T>, opts: DbRetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? DB_RETRY_ATTEMPTS);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = opts.log ?? ((msg: string) => console.warn(msg));
  const label = opts.label ?? 'db';

  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isLast = attempt === attempts;
      if (!isTransientDbError(err)) throw err;
      if (isLast) {
        log(
          `[db-retry] ${label}: giving up after ${attempts} attempts — ${describeDbError(err)}`,
        );
        throw err;
      }
      const wait = retryDelayMs(attempt, opts);
      log(
        `[db-retry] ${label}: transient failure on attempt ${attempt}/${attempts}, ` +
          `retrying in ${wait}ms — ${describeDbError(err)}`,
      );
      await sleep(wait);
    }
  }
  // Unreachable: the loop either returns or throws. Rethrow defensively rather
  // than returning a fabricated value.
  throw lastErr;
}
