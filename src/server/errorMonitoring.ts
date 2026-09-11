/**
 * Error monitoring — dormant until a DSN exists, then live with no code change.
 *
 * THE GAP THIS CLOSES
 * ───────────────────
 * Until now a server-side exception went to `console.error` and stopped there.
 * On Replit nobody reads stdout, so "a production feature has been throwing for
 * days" and "production is fine" produced identical observable evidence. That
 * is the same failure the ops health endpoint addresses from the job side; this
 * is the request side.
 *
 * WHY NO `@sentry/node` DEPENDENCY
 * ────────────────────────────────
 * Sentry's ingest is an ordinary HTTPS POST of a newline-delimited envelope.
 * The SDK's value is breadcrumbs, tracing, integrations and async context —
 * none of which this codebase is set up to use, and all of which cost a
 * multi-megabyte dependency, a transitive tree to audit, and a lockfile change
 * that would land in every sibling branch. ~120 lines of envelope-building buys
 * the part that matters: an exception, its stack, where it happened, and an
 * alert. If richer instrumentation is ever wanted, the DSN and this module's
 * call sites are exactly what the real SDK would take over.
 *
 * $0 AND NO ACCOUNT CREATED
 * ─────────────────────────
 * Nothing here signs up for anything or spends anything. `SENTRY_DSN` is UNSET
 * today, and while it is unset every function in this file is a no-op that
 * performs no network call. Sentry's free tier (~5k errors/month) is the
 * intended home, but only the account owner can create the project and the DSN.
 * The PR body lists exactly what to create and which Doppler key to put it in.
 * Any Sentry-compatible ingest (GlitchTip, self-hosted) works with the same DSN
 * shape and the same zero changes here.
 *
 * WHAT IS SCRUBBED, AND WHY IT IS NOT OPTIONAL
 * ───────────────────────────────────────────
 * An exception message is the single most common accidental exfiltration path
 * in a codebase like this one: a failed query prints its parameters, a failed
 * fetch prints its URL, and a URL routinely carries a token. `scrubSensitive`
 * runs over every message and every frame path before anything leaves the
 * process — emails, bearer tokens, `key=`/`token=`/`secret=`/`password=` query
 * and assignment values, Stripe `sk_`/`rk_` keys, and long hex/base64 runs. It
 * is applied at the LAST possible moment, in the serializer, so no future call
 * site can route around it.
 */
import { createHash, randomUUID } from 'node:crypto';

/** Sentry DSN. Unset = this entire module is inert. */
export const SENTRY_DSN_ENV = 'SENTRY_DSN';

/** Optional: tags every event with a deploy identity. */
export const SENTRY_ENVIRONMENT_ENV = 'SENTRY_ENVIRONMENT';
export const SENTRY_RELEASE_ENV = 'SENTRY_RELEASE';

/** Hard ceiling on events per process per hour. A crash loop in a hot route can
 *  emit thousands of identical exceptions in a minute; without a cap that burns
 *  a month of a 5k/month free tier in one incident and then reports nothing for
 *  the rest of the month — the exact silence this module exists to end. */
export const MAX_EVENTS_PER_HOUR = 200;

/** How long an identical error is suppressed after being reported once. Keyed
 *  on a fingerprint of type+message+top frame, so a loop reports once and then
 *  stays quiet, while a genuinely different error is never suppressed. */
export const DEDUPE_WINDOW_MS = 5 * 60 * 1000;

export interface SentryDsn {
  publicKey: string;
  host: string;
  projectId: string;
  /** The full ingest URL an envelope POSTs to. */
  envelopeUrl: string;
}

/**
 * Parse a Sentry DSN.
 *
 * Returns null — never throws — on anything malformed. A typo'd DSN must
 * degrade to "monitoring is off", loudly in the log, and must never take down
 * the boot of a server whose actual job is serving pages.
 *
 * Accepted: `https://<publicKey>@<host>[/<path>]/<projectId>`, with an optional
 * legacy `:<secret>` after the key (ignored — modern ingest does not use it).
 */
export function parseSentryDsn(raw: string | undefined | null): SentryDsn | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    console.warn('[errmon] SENTRY_DSN is not a valid URL — error monitoring stays OFF.');
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    console.warn(`[errmon] SENTRY_DSN protocol '${u.protocol}' is not http(s) — monitoring stays OFF.`);
    return null;
  }
  const publicKey = u.username;
  if (!publicKey) {
    console.warn('[errmon] SENTRY_DSN has no public key before "@" — monitoring stays OFF.');
    return null;
  }
  const segments = u.pathname.split('/').filter(Boolean);
  const projectId = segments.pop() ?? '';
  if (!/^\d+$/.test(projectId)) {
    console.warn('[errmon] SENTRY_DSN has no numeric project id — monitoring stays OFF.');
    return null;
  }
  const prefix = segments.length ? `/${segments.join('/')}` : '';
  return {
    publicKey,
    host: u.host,
    projectId,
    envelopeUrl:
      `${u.protocol}//${u.host}${prefix}/api/${projectId}/envelope/`
      + `?sentry_key=${encodeURIComponent(publicKey)}&sentry_version=7`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SCRUBBING
// ─────────────────────────────────────────────────────────────────────────────

/** Patterns replaced before ANY text leaves the process. Ordered most-specific
 *  first so a Stripe key is labelled as one rather than caught by the generic
 *  long-token rule. */
const SCRUB_RULES: Array<[RegExp, string]> = [
  // Stripe secret/restricted keys.
  [/\b[sr]k_(?:live|test)_[A-Za-z0-9]{8,}/g, '[stripe-key]'],
  // Authorization headers and bearer tokens.
  [/\b[Bb]earer\s+[A-Za-z0-9._~+/-]{8,}=*/g, 'Bearer [redacted]'],
  // key=/token=/secret=/password=/pwd=/api_key= in a query string or an
  // assignment, quoted or not.
  [
    /\b((?:api[_-]?key|access[_-]?token|auth|key|token|secret|password|pwd|session|dsn)\s*[=:]\s*)(?:"|')?[^\s"'&,;)}\]]{4,}/gi,
    '$1[redacted]',
  ],
  // Email addresses — a failed insert or a lookup error prints them constantly.
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[email]'],
  // postgres://user:pass@host — connection strings in driver errors.
  [/\b([a-z+]+:\/\/[^\s:/@]+):[^\s@]+@/gi, '$1:[redacted]@'],
  // Long opaque runs: hex >= 32, or base64url >= 40. Catches raw session ids,
  // JWT segments and anything the rules above did not name.
  [/\b[0-9a-f]{32,}\b/gi, '[redacted]'],
  [/\b[A-Za-z0-9_-]{40,}\b/g, '[redacted]'],
];

/** Redact secrets and personal data from a string. Applied in the serializer,
 *  so every path out of this module is covered. */
export function scrubSensitive(text: string): string {
  let out = text;
  for (const [re, replacement] of SCRUB_RULES) out = out.replace(re, replacement);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT BUILDING
// ─────────────────────────────────────────────────────────────────────────────

export interface CaptureContext {
  /** Route or job that was running, e.g. 'GET /directory/:state'. */
  transaction?: string;
  /** Low-cardinality labels. Values are scrubbed like everything else. */
  tags?: Record<string, string>;
  level?: 'error' | 'warning' | 'fatal';
}

export interface SentryEvent {
  event_id: string;
  timestamp: number;
  platform: 'node';
  level: string;
  environment: string;
  release?: string;
  server_name?: string;
  transaction?: string;
  tags: Record<string, string>;
  exception: {
    values: Array<{
      type: string;
      value: string;
      stacktrace?: { frames: StackFrame[] };
    }>;
  };
}

export interface StackFrame {
  filename: string;
  function?: string;
  lineno?: number;
}

/** Stack frames, oldest-first (Sentry's order), scrubbed, capped. */
export function framesFrom(stack: string | undefined): StackFrame[] {
  if (!stack) return [];
  const frames: StackFrame[] = [];
  for (const line of stack.split('\n').slice(1, 31)) {
    const m = /^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/.exec(line);
    if (!m) continue;
    const frame: StackFrame = { filename: scrubSensitive(m[2] ?? '') };
    if (m[1]) frame.function = scrubSensitive(m[1]);
    const lineno = Number(m[3]);
    if (Number.isFinite(lineno) && lineno > 0) frame.lineno = lineno;
    frames.push(frame);
  }
  return frames.reverse();
}

/** Stable identity for an error, for dedupe. Type + scrubbed message + the
 *  innermost frame — enough that a retry loop collapses to one event and two
 *  different bugs never do. */
export function fingerprint(err: unknown, transaction?: string): string {
  const e = err instanceof Error ? err : new Error(String(err));
  const top = (e.stack ?? '').split('\n')[1] ?? '';
  return createHash('sha256')
    .update(`${e.name}|${scrubSensitive(e.message)}|${scrubSensitive(top)}|${transaction ?? ''}`)
    .digest('hex')
    .slice(0, 16);
}

/** Build the JSON body. PURE — no clock of its own, no network, no env read —
 *  so the payload shape and the scrubbing are directly unit-testable. */
export function buildEvent(
  err: unknown,
  ctx: CaptureContext,
  opts: { now: Date; environment: string; release?: string; serverName?: string },
): SentryEvent {
  const e = err instanceof Error ? err : new Error(String(err));
  const tags: Record<string, string> = {};
  for (const [k, v] of Object.entries(ctx.tags ?? {})) tags[k] = scrubSensitive(String(v));

  return {
    event_id: randomUUID().replace(/-/g, ''),
    timestamp: Math.floor(opts.now.getTime() / 1000),
    platform: 'node',
    level: ctx.level ?? 'error',
    environment: opts.environment,
    release: opts.release,
    server_name: opts.serverName,
    transaction: ctx.transaction ? scrubSensitive(ctx.transaction) : undefined,
    tags,
    exception: {
      values: [
        {
          type: e.name || 'Error',
          value: scrubSensitive(e.message || String(err)),
          stacktrace: { frames: framesFrom(e.stack) },
        },
      ],
    },
  };
}

/** Sentry's newline-delimited envelope: header, item header, item. */
export function buildEnvelope(event: SentryEvent, dsn: string, sentAt: Date): string {
  const header = JSON.stringify({ event_id: event.event_id, sent_at: sentAt.toISOString(), dsn });
  const body = JSON.stringify(event);
  const itemHeader = JSON.stringify({ type: 'event', content_type: 'application/json', length: Buffer.byteLength(body) });
  return `${header}\n${itemHeader}\n${body}\n`;
}

// ─────────────────────────────────────────────────────────────────────────────
// THE REPORTER
// ─────────────────────────────────────────────────────────────────────────────

export interface ErrorMonitorState {
  dsn: SentryDsn | null;
  environment: string;
  release?: string;
  serverName?: string;
  seen: Map<string, number>;
  hourStartMs: number;
  hourCount: number;
  /** Events dropped to the hourly cap — reported by the ops health endpoint so
   *  "monitoring went quiet" is never mistaken for "nothing went wrong". */
  droppedToCap: number;
  /** Total successfully shipped. */
  sent: number;
  /** Last transport failure, so a silently broken DSN is visible. */
  lastError: string | null;
}

const state: ErrorMonitorState = {
  dsn: null,
  environment: 'development',
  release: undefined,
  serverName: undefined,
  seen: new Map(),
  hourStartMs: 0,
  hourCount: 0,
  droppedToCap: 0,
  sent: 0,
  lastError: null,
};

/**
 * Wire up error monitoring. Safe and expected to call when no DSN is set — it
 * logs one line saying monitoring is off and returns false.
 */
export function initErrorMonitoring(env: NodeJS.ProcessEnv = process.env): boolean {
  state.dsn = parseSentryDsn(env[SENTRY_DSN_ENV]);
  state.environment = env[SENTRY_ENVIRONMENT_ENV] ?? env.NODE_ENV ?? 'development';
  state.release = env[SENTRY_RELEASE_ENV];
  state.serverName = env.REPL_SLUG ?? undefined;
  if (!state.dsn) {
    console.warn(
      '[errmon] SENTRY_DSN is not set — server errors are logged to stdout ONLY and nothing '
      + 'will alert on them. Set SENTRY_DSN in Doppler (quotefleet/prd) to activate.',
    );
    return false;
  }
  console.log(`[errmon] error monitoring ACTIVE → ${state.dsn.host} project ${state.dsn.projectId}`);
  return true;
}

/** True when a DSN is configured and events will actually ship. */
export function isErrorMonitoringActive(): boolean {
  return state.dsn !== null;
}

/** Counters for the ops health endpoint. */
export function errorMonitoringStatus(): {
  active: boolean;
  host: string | null;
  sent: number;
  droppedToCap: number;
  lastError: string | null;
} {
  return {
    active: state.dsn !== null,
    host: state.dsn?.host ?? null,
    sent: state.sent,
    droppedToCap: state.droppedToCap,
    lastError: state.lastError,
  };
}

/** Test seam. */
export function resetErrorMonitoringForTest(): void {
  state.dsn = null;
  state.seen.clear();
  state.hourStartMs = 0;
  state.hourCount = 0;
  state.droppedToCap = 0;
  state.sent = 0;
  state.lastError = null;
}

/** Rate-limit + dedupe decision. Exported so the policy is testable without a
 *  network. Mutates the counters exactly as a real send would. */
export function shouldReport(key: string, nowMs: number): boolean {
  if (nowMs - state.hourStartMs >= 3_600_000) {
    state.hourStartMs = nowMs;
    state.hourCount = 0;
  }
  if (state.hourCount >= MAX_EVENTS_PER_HOUR) {
    state.droppedToCap++;
    return false;
  }
  const last = state.seen.get(key);
  if (last !== undefined && nowMs - last < DEDUPE_WINDOW_MS) return false;
  // Bound the dedupe map: a long-lived process with many distinct errors must
  // not accumulate keys forever.
  if (state.seen.size > 500) state.seen.clear();
  state.seen.set(key, nowMs);
  state.hourCount++;
  return true;
}

/**
 * Report an exception. NEVER throws and never rejects into its caller — an
 * error reporter that can itself fail a request is worse than no reporter.
 *
 * Fire-and-forget by design: callers are express error handlers and process
 * hooks, neither of which can await.
 */
export function captureException(err: unknown, ctx: CaptureContext = {}): void {
  try {
    if (!state.dsn) return;
    const now = new Date();
    if (!shouldReport(fingerprint(err, ctx.transaction), now.getTime())) return;

    const event = buildEvent(err, ctx, {
      now,
      environment: state.environment,
      release: state.release,
      serverName: state.serverName,
    });
    const dsnUrl = `https://${state.dsn.publicKey}@${state.dsn.host}/${state.dsn.projectId}`;
    const payload = buildEnvelope(event, dsnUrl, now);

    // A 5s ceiling: a hung ingest must not pin a socket for the life of the
    // process, and a dropped error report is survivable.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 5000);
    void fetch(state.dsn.envelopeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-sentry-envelope' },
      body: payload,
      signal: ac.signal,
    })
      .then((r) => {
        if (r.ok) {
          state.sent++;
          state.lastError = null;
        } else {
          state.lastError = `ingest returned HTTP ${r.status}`;
        }
      })
      .catch((e: unknown) => {
        state.lastError = e instanceof Error ? e.message : String(e);
      })
      .finally(() => clearTimeout(timer));
  } catch (e) {
    // Reporting must never escalate. Log once, locally, and move on.
    console.warn('[errmon] captureException failed:', e instanceof Error ? e.message : String(e));
  }
}
