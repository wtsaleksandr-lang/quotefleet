/**
 * THE INGEST — one tick's worth of polling, and the manners that go with it.
 *
 * ── WE ARE A GUEST ON SOMEBODY ELSE'S WEB SERVER ──────────────────────────
 * These are state DOT pages, funded by taxpayers, with no API contract and no
 * obligation to us. So:
 *   • ONE request at a time, spaced by `POLITE_GAP_MS`, at most
 *     `MAX_FETCHES_PER_TICK` states per 30-minute tick. Even a cold start that
 *     finds every state due walks through the registry over several ticks
 *     rather than opening a dozen connections at once.
 *   • A HONEST User-Agent naming the product, the page it serves and a real
 *     mailbox, so an administrator who wants us to stop can find us in one
 *     search of their logs.
 *   • CONDITIONAL GETs. Every response's `ETag` and `Last-Modified` are kept
 *     and sent back; NDDOT's feed serves both, so an in-season poll that finds
 *     no change is a 304 with no body — 2.5 MB saved eight times a day.
 *   • A body cap and a request timeout, so a misbehaving upstream cannot
 *     exhaust this process.
 *   • ZERO PAID CALLS. Every source is a free government publication. Nothing
 *     in this module can reach a metered provider, and the WSDOT feed's free
 *     access code is optional — absent, the state is SKIPPED, never failed.
 *
 * ── AND WE ARE HONEST ABOUT WHAT COMES BACK ───────────────────────────────
 * A non-2xx is a failure. A 200 with an implausible body is ALSO a failure —
 * that is `SeasonalParseError`, and it is the whole reason the adapters throw
 * instead of returning `{ rows: [] }`. A failure reaches `recordFailure`, which
 * cannot touch the stored data, so the last good snapshot survives and simply
 * ages into a visible staleness warning. There is no path from "the fetch went
 * wrong" to "nothing is restricted".
 */
import { jobFailure, jobSkipped, jobSuccess, type JobOutcome } from '../jobHealth.js';
import { todayIso, type IsoDate } from '../../calc/osow/provenance.js';
import {
  MAX_FETCHES_PER_TICK,
  POLITE_GAP_MS,
  cadenceFor,
  dueThisTick,
} from '../../calc/osow/seasonal/schedule.js';
import { pollableSources, type SeasonalSourceSpec } from '../../calc/osow/seasonal/sources.js';
import { SEASONAL_ADAPTERS, SeasonalParseError, type ParsedSource } from './adapters.js';
import {
  cachedSnapshot,
  contentHashOf,
  loadLastAttempts,
  noteAttempt,
  recordFailure,
  recordSuccess,
} from './store.js';

/** Named, contactable, and truthful. See the module header. */
export const SEASONAL_USER_AGENT =
  'QuoteFleetSeasonalRestrictionsBot/1.0 (+https://quotefleet.net/tools/seasonal-weight-restrictions; hello@quotefleet.net)';

export const FETCH_TIMEOUT_MS = 20_000;

/** Hard cap on a downloaded body. NDDOT's real feed is ~2.5 MB. */
export const MAX_BODY_BYTES = 12_000_000;

/** Conditional-GET validators, per state, for this process's lifetime. */
const validators = new Map<string, { etag?: string; lastModified?: string }>();

export function __resetSeasonalValidatorsForTests(): void {
  validators.clear();
}

export interface IngestDeps {
  fetchImpl: typeof fetch;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  log: (msg: string) => void;
  env: NodeJS.ProcessEnv;
}

function defaultDeps(): IngestDeps {
  return {
    fetchImpl: (...args: Parameters<typeof fetch>) => fetch(...args),
    now: () => new Date(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (msg) => console.log(msg),
    env: process.env,
  };
}

export type StateOutcome =
  | { state: string; result: 'updated'; rows: number; verifiedClear: boolean; persisted: boolean }
  | { state: string; result: 'unchanged' }
  | { state: string; result: 'skipped'; why: string }
  | { state: string; result: 'failed'; error: string };

/**
 * Normalise a page before hashing it, for CHANGE-DETECT sources.
 *
 * State pages carry session ids, CSRF tokens, rotating banner slots and
 * "generated at" stamps. Hashing the raw body would report a change on every
 * single poll, which is the same as reporting none: a change signal that is
 * always on is not a signal. Scripts, styles, comments and whitespace are
 * removed so what remains is the visible text the restriction is written in.
 */
export function normaliseForHash(body: string): string {
  return String(body ?? '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The URL we actually request, with a free access code appended if needed. */
export function requestUrlFor(spec: SeasonalSourceSpec, env: NodeJS.ProcessEnv): string | null {
  const base = spec.fetchUrl ?? spec.authorityUrl;
  if (!spec.freeApiKey) return base;
  const key = env[spec.freeApiKey.envVar];
  if (!key) return null;
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}AccessCode=${encodeURIComponent(key)}`;
}

/** Fetch one state, parse it, and persist the outcome. Never throws. */
export async function ingestOneState(
  spec: SeasonalSourceSpec,
  deps: IngestDeps,
): Promise<StateOutcome> {
  const url = requestUrlFor(spec, deps.env);
  if (url === null) {
    // A missing FREE access code is a configuration gap, not a broken source.
    // Reporting it as a failure would put a permanent red mark on a state whose
    // publication is working perfectly, and would train the alert to be ignored.
    return {
      state: spec.code,
      result: 'skipped',
      why: `${spec.freeApiKey?.envVar} is not set; ${spec.name} needs a free WSDOT Traveler Information access code (${spec.freeApiKey?.signupUrl}). Nothing is fetched and nothing is charged.`,
    };
  }

  noteAttempt(spec.code, deps.now().getTime());
  const retrievedOn: IsoDate = todayIso(deps.now());
  const validator = validators.get(spec.code) ?? {};
  const headers: Record<string, string> = {
    'User-Agent': SEASONAL_USER_AGENT,
    Accept: spec.format === 'geojson' || spec.format === 'json-api' ? 'application/json' : 'text/html',
  };
  const cached = cachedSnapshot(spec.code);
  // Only send validators when we still HOLD the body they validate. Otherwise a
  // 304 would leave us with nothing to record.
  if (cached !== null) {
    if (validator.etag) headers['If-None-Match'] = validator.etag;
    if (validator.lastModified) headers['If-Modified-Since'] = validator.lastModified;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await deps.fetchImpl(url, { headers, redirect: 'follow', signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    const error = `fetch failed: ${err instanceof Error ? err.message : String(err)}`;
    await recordFailure(spec.code, error);
    return { state: spec.code, result: 'failed', error };
  }
  clearTimeout(timer);

  if (res.status === 304 && cached !== null) {
    // Nothing changed upstream. Re-record the SAME content so `retrieved_on`
    // moves (we did confirm it today) while `updated_at` does not (nothing
    // changed) — invariant 2 in `store.ts`, delivered for free by the hash.
    const persisted = await recordSuccess({
      state: spec.code,
      rows: cached.rows,
      bulletinDate: cached.bulletinDate,
      retrievedOn,
      verifiedClear: cached.verifiedClear,
      recordCount: cached.rows.length,
      contentHash: contentHashOf(cached.rows, cached.verifiedClear),
    });
    if (!persisted) deps.log(`[seasonal.ingest] ${spec.code} unchanged upstream but the confirmation write failed`);
    return { state: spec.code, result: 'unchanged' };
  }

  if (!res.ok) {
    const error = `HTTP ${res.status} from ${spec.publisher}`;
    await recordFailure(spec.code, error);
    return { state: spec.code, result: 'failed', error };
  }

  const lengthHeader = Number(res.headers.get('content-length') ?? '0');
  if (Number.isFinite(lengthHeader) && lengthHeader > MAX_BODY_BYTES) {
    const error = `response is ${lengthHeader} bytes, over the ${MAX_BODY_BYTES} cap`;
    await recordFailure(spec.code, error);
    return { state: spec.code, result: 'failed', error };
  }

  let body: string;
  try {
    body = await res.text();
  } catch (err) {
    const error = `could not read body: ${err instanceof Error ? err.message : String(err)}`;
    await recordFailure(spec.code, error);
    return { state: spec.code, result: 'failed', error };
  }
  if (body.length > MAX_BODY_BYTES) {
    const error = `body is ${body.length} bytes, over the ${MAX_BODY_BYTES} cap`;
    await recordFailure(spec.code, error);
    return { state: spec.code, result: 'failed', error };
  }

  const etag = res.headers.get('etag');
  const lastModified = res.headers.get('last-modified');
  validators.set(spec.code, {
    ...(etag ? { etag } : {}),
    ...(lastModified ? { lastModified } : {}),
  });

  let parsed: ParsedSource;
  if (spec.ingestion === 'parse') {
    const adapter = spec.adapter === null ? undefined : SEASONAL_ADAPTERS[spec.adapter];
    if (adapter === undefined) {
      const error = `no adapter registered for "${spec.adapter}"`;
      await recordFailure(spec.code, error);
      return { state: spec.code, result: 'failed', error };
    }
    try {
      parsed = adapter(body, spec, retrievedOn);
    } catch (err) {
      // A SeasonalParseError is the soft-failure guard doing its job: the
      // upstream answered 200 with something implausible, and we are refusing
      // to write it. Anything else is a genuine parser defect, and is reported
      // the same way so it cannot hide behind a healthy-looking tick either.
      const error =
        err instanceof SeasonalParseError
          ? `implausible payload, treated as a FAILED fetch so it cannot clear good data: ${err.message}`
          : `parser threw: ${err instanceof Error ? err.message : String(err)}`;
      await recordFailure(spec.code, error);
      return { state: spec.code, result: 'failed', error };
    }
  } else {
    // CHANGE-DETECT. We hold no rows and claim no clear; what we record is that
    // we reached the page today and what it hashed to, so a change is visible
    // and the link is always current.
    const text = normaliseForHash(body);
    if (text.length < 200) {
      const error = `page rendered only ${text.length} characters of text — treating as a failed fetch`;
      await recordFailure(spec.code, error);
      return { state: spec.code, result: 'failed', error };
    }
    parsed = { rows: [], bulletinDate: null, verifiedClear: false, recordCount: 1, truncated: false };
    // Hash the page text rather than the (empty) rows, so a bulletin change on
    // a page we do not parse still moves `updated_at`.
    const persisted = await recordSuccess({
      state: spec.code,
      rows: [],
      bulletinDate: null,
      retrievedOn,
      verifiedClear: false,
      recordCount: 1,
      contentHash: `page-${fnv1a(text)}`,
    });
    return { state: spec.code, result: 'updated', rows: 0, verifiedClear: false, persisted };
  }

  const persisted = await recordSuccess({
    state: spec.code,
    rows: parsed.rows,
    bulletinDate: parsed.bulletinDate,
    retrievedOn,
    verifiedClear: parsed.verifiedClear,
    recordCount: parsed.recordCount,
    contentHash: contentHashOf(parsed.rows, parsed.verifiedClear),
  });
  return {
    state: spec.code,
    result: 'updated',
    rows: parsed.rows.length,
    verifiedClear: parsed.verifiedClear,
    persisted,
  };
}

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * ONE TICK.
 *
 * The tick itself is cheap and usually does nothing: it asks the scheduler
 * which states are due — which, out of season, is a handful a week — and
 * contacts at most `MAX_FETCHES_PER_TICK` of them. A tick with nothing due is
 * `skipped`, which is HEALTHY in the ledger's model and is exactly the signal
 * the staleness watchdog needs from a job whose real work is seasonal: it
 * proves the scheduler is alive in July.
 */
export async function runSeasonalIngestOnce(
  overrides: Partial<IngestDeps> = {},
): Promise<JobOutcome> {
  const deps: IngestDeps = { ...defaultDeps(), ...overrides };
  const now = deps.now();
  const specs = pollableSources();
  const attempts = await loadLastAttempts();
  const due = dueThisTick(specs, attempts, now, MAX_FETCHES_PER_TICK);

  if (due.length === 0) {
    return jobSkipped(
      `no state is due — ${specs.length} source(s) polled on their own cadence ` +
        `(${specs.filter((s) => cadenceFor(s, now).tier === 'in-season').length} in season)`,
    );
  }

  const outcomes: StateOutcome[] = [];
  for (const [i, spec] of due.entries()) {
    if (i > 0) await deps.sleep(POLITE_GAP_MS);
    const outcome = await ingestOneState(spec, deps);
    outcomes.push(outcome);
    deps.log(`[seasonal.ingest] ${spec.code}: ${JSON.stringify(outcome)}`);
  }

  type Of<R extends StateOutcome['result']> = Extract<StateOutcome, { result: R }>;
  const failed = outcomes.filter((o): o is Of<'failed'> => o.result === 'failed');
  const skipped = outcomes.filter((o): o is Of<'skipped'> => o.result === 'skipped');
  const updated = outcomes.filter(
    (o): o is Of<'updated'> | Of<'unchanged'> => o.result === 'updated' || o.result === 'unchanged',
  );

  if (failed.length > 0) {
    // ANY failure is reported as a failure. A single transient blip does NOT
    // page anyone — `runTrackedJob` holds the email until two consecutive
    // failures or thirty unhealthy minutes — so this can afford to be strict,
    // and being strict is what stops a state that has been 404ing since March
    // from sitting inside a green tick.
    return jobFailure(
      `${failed.length} of ${due.length} state(s) failed: ` +
        failed.map((f) => `${f.state} (${f.error})`).join('; ') +
        (updated.length > 0 ? ` — ${updated.length} succeeded` : ''),
    );
  }

  if (updated.length === 0) {
    return jobSkipped(
      `nothing fetched: ${skipped.map((s) => `${s.state} — ${s.why}`).join('; ')}`,
    );
  }

  return jobSuccess(
    updated.length,
    updated
      .map((o) =>
        o.result === 'unchanged'
          ? `${o.state} unchanged`
          : `${o.state} ${o.rows} row(s)${o.verifiedClear ? ', verified clear' : ''}${o.persisted ? '' : ' (NOT PERSISTED — DB write failed)'}`,
      )
      .join('; '),
  );
}
