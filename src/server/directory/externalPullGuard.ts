/**
 * HARD COST GUARD for paid external data providers (ImportYeti / Hunter / the
 * importer AI draft).
 *
 * WHY THIS EXISTS: ~$20 of ImportYeti + Hunter credits were burned in two days,
 * largely by DEV, TEST and AGENT traffic hitting the same code paths production
 * uses. Discipline ("don't run a live search locally") is not a control — this
 * module makes non-production spend STRUCTURALLY IMPOSSIBLE.
 *
 * ── The rule: OFF unless EXPLICITLY opted in ────────────────────────────────
 * Live pulls are OFF everywhere unless the process carries an explicit opt-in
 * flag. Everything without it — dev, a local `node scratchpad/boot_*.mjs`, an
 * agent's checkout, CI, vitest — gets CACHE-ONLY behaviour: the licensed
 * `importer_bol_cache` / `importer_contact_cache` rows are served, and a cache
 * MISS returns an honest "unavailable / cache-only" result. NO SOCKET IS OPENED.
 *
 *   EXTERNAL_PULLS_ENABLED=1   opt in for all providers  ← set in Doppler `prd`
 *   IMPORTYETI_LIVE_PULLS=1    ImportYeti only
 *   HUNTER_LIVE=1              Hunter only
 *   IMPORTER_DRAFTS_LIVE=1     importer AI draft only
 * Setting any of them to 0/false force-DISABLES that provider even in prod, so
 * the kill switch works in both directions (prod incident → flip to 0, redeploy).
 *
 * ── WHY NOT `NODE_ENV === 'production'`? (verified 2026-08-27) ──────────────
 * Because in this project NODE_ENV cannot tell dev from prod. QuoteFleet's
 * Doppler `dev` config is a near-clone of `prd`: it sets **NODE_ENV=production**
 * and the same PUBLIC_BASE_URL (https://quotefleet.net) and HOST_DOMAINS. A
 * local `doppler run -c dev -- node …` boot therefore looks EXACTLY like
 * production to any environment sniffing — which is precisely how dev/test/agent
 * traffic spent real credits. A live boot of this guard's first draft (which did
 * gate on NODE_ENV) issued a real ImportYeti request from a laptop; only an
 * exhausted balance (HTTP 403 "Not enough credits") stopped it costing money.
 *
 * So the ONLY thing that opens the paid path is a flag that exists in exactly
 * one place: the production config. Absence of configuration is never spend.
 * `isRealProduction()` is kept for the admin status view but is deliberately NOT
 * part of the decision.
 *
 * ── Test runners can NEVER be overridden by env ─────────────────────────────
 * Under vitest / NODE_ENV=test the guard is hard-OFF and no environment variable
 * can turn it back on. A test that deliberately drives the (mocked) live path
 * opts in IN CODE via `__setLivePullsForTests(true)`; because that only ever
 * reaches the test's own `globalThis.fetch` stub, it cannot spend a real credit.
 *
 * ── Choke point ─────────────────────────────────────────────────────────────
 * `guardedFetch()` is the ONLY way a paid provider is contacted. It returns
 * `null` — WITHOUT touching the network — when the guard is off, and records
 * every call that DOES go out (in-process meter + persisted `external_api_spend`
 * ledger) so spend is auditable in admin instead of invisible in console output.
 */

/** Paid providers behind the guard. */
export type ExternalProvider = 'importyeti' | 'hunter' | 'anthropic';

/** Per-external-call timeout in ms (AbortController). */
export const EXTERNAL_TIMEOUT_MS = 12_000;

/** Per-provider explicit override env var. */
const OVERRIDE_ENV: Record<ExternalProvider, string> = {
  importyeti: 'IMPORTYETI_LIVE_PULLS',
  hunter: 'HUNTER_LIVE',
  anthropic: 'IMPORTER_DRAFTS_LIVE',
};

/** Master override env var (all providers). */
export const MASTER_ENV = 'EXTERNAL_PULLS_ENABLED';

/**
 * Best-effort credit cost of ONE live call, used for the persisted ledger when
 * the provider does not report an exact number. ImportYeti's own docs + the
 * observed `requestCost` put a 50-row powerquery page at ~5 credits; Hunter
 * bills one credit per domain-search request.
 */
const EST_CREDITS: Record<ExternalProvider, number> = {
  importyeti: 5,
  hunter: 1,
  anthropic: 0,
};

/** Rough USD cents per credit, for the admin spend view (labelled "est."). */
const EST_CENTS_PER_CREDIT: Record<ExternalProvider, number> = {
  importyeti: 9,
  hunter: 4,
  anthropic: 0,
};

const TRUEY = /^(1|true|yes|on)$/i;
const FALSEY = /^(0|false|no|off)$/i;

/** Tri-state env flag: true / false / undefined (unset or unparseable). */
function envFlag(name: string): boolean | undefined {
  const raw = process.env[name];
  if (raw == null) return undefined;
  const v = String(raw).trim();
  if (!v) return undefined;
  if (TRUEY.test(v)) return true;
  if (FALSEY.test(v)) return false;
  return undefined;
}

/** True when this process is a test runner (vitest / jest / NODE_ENV=test). */
export function isTestRunner(): boolean {
  return (
    process.env.NODE_ENV === 'test' ||
    !!process.env.VITEST ||
    !!process.env.VITEST_WORKER_ID ||
    !!process.env.JEST_WORKER_ID
  );
}

/**
 * Informational ONLY — never part of the guard decision. In this project the
 * Doppler `dev` config also sets NODE_ENV=production, so this returns true on a
 * developer's laptop. Kept so the admin status view can show the discrepancy.
 */
export function isRealProduction(): boolean {
  return process.env.NODE_ENV === 'production' && !isTestRunner();
}

/** In-code test opt-in. `null` = follow the normal rule. */
let testOverride: boolean | null = null;

/**
 * TEST-ONLY: force the guard on/off for tests that drive a MOCKED `fetch`.
 * Pass `null` to restore the default (OFF). Ignored outside a test runner, so it
 * can never widen spend in dev or prod.
 */
export function __setLivePullsForTests(value: boolean | null): void {
  testOverride = value;
}

export interface GuardDecision {
  allowed: boolean;
  /** Short, log-safe explanation of the decision. */
  reason: string;
}

/**
 * THE decision. DEFAULT DENY — an unconfigured process never spends.
 *
 * Precedence:
 *   1. test runner                → OFF (in-code test opt-in only; env can't win)
 *   2. per-provider flag = 0      → OFF (per-provider kill switch)
 *   3. master flag = 0            → OFF (global kill switch)
 *   4. per-provider flag = 1      → ON
 *   5. master flag = 1            → ON  (this is what `prd` sets)
 *   6. no flag at all             → OFF
 *
 * Note step 6: NODE_ENV is deliberately NOT consulted — see the module header.
 */
export function livePullsAllowed(provider: ExternalProvider): GuardDecision {
  if (isTestRunner()) {
    if (testOverride === true) return { allowed: true, reason: 'test-opt-in (mocked fetch)' };
    return { allowed: false, reason: 'test runner — live pulls are never allowed' };
  }
  const perProvider = envFlag(OVERRIDE_ENV[provider]);
  if (perProvider === false) return { allowed: false, reason: `${OVERRIDE_ENV[provider]}=0` };

  const master = envFlag(MASTER_ENV);
  if (master === false) return { allowed: false, reason: `${MASTER_ENV}=0` };

  if (perProvider === true) return { allowed: true, reason: `${OVERRIDE_ENV[provider]}=1` };
  if (master === true) return { allowed: true, reason: `${MASTER_ENV}=1` };

  return {
    allowed: false,
    reason: `no live-pull opt-in (${MASTER_ENV} / ${OVERRIDE_ENV[provider]} unset)`,
  };
}

// ── in-process meter ─────────────────────────────────────────────────────────
export interface ProviderMeter {
  /** Live calls this process actually made (a credit was spent). */
  liveCalls: number;
  /** Calls the guard refused before opening a socket. */
  blockedCalls: number;
  /** Credits attributed to this process (provider-reported when known). */
  credits: number;
  /** Last provider-reported remaining balance, when the provider reports one. */
  lastCreditsRemaining: number | null;
  /** ISO timestamp of the most recent LIVE call. */
  lastLiveAt: string | null;
}

const PROVIDERS: ExternalProvider[] = ['importyeti', 'hunter', 'anthropic'];

function emptyMeter(): ProviderMeter {
  return { liveCalls: 0, blockedCalls: 0, credits: 0, lastCreditsRemaining: null, lastLiveAt: null };
}

const meters = new Map<ExternalProvider, ProviderMeter>(
  PROVIDERS.map((p) => [p, emptyMeter()] as const),
);

function meterFor(provider: ExternalProvider): ProviderMeter {
  let m = meters.get(provider);
  if (!m) {
    m = emptyMeter();
    meters.set(provider, m);
  }
  return m;
}

/** Snapshot of the in-process external-call meter (admin / health view). */
export function externalCallMeter(): Record<ExternalProvider, ProviderMeter> {
  const out = {} as Record<ExternalProvider, ProviderMeter>;
  for (const p of PROVIDERS) out[p] = { ...meterFor(p) };
  return out;
}

/** Guard status for the admin view — what is on, and why. */
export function guardStatus(): {
  nodeEnv: string;
  realProduction: boolean;
  providers: Record<ExternalProvider, GuardDecision>;
} {
  const providers = {} as Record<ExternalProvider, GuardDecision>;
  for (const p of PROVIDERS) providers[p] = livePullsAllowed(p);
  return {
    nodeEnv: process.env.NODE_ENV || 'development',
    realProduction: isRealProduction(),
    providers,
  };
}

/** Test-only reset of the in-process meter + the test override. */
export function __resetGuardMetersForTests(): void {
  for (const p of PROVIDERS) meters.set(p, emptyMeter());
  testOverride = null;
}

// ── persisted spend ledger (lazy — keeps this module DB-free for unit tests) ──
/**
 * Fire-and-forget write to `external_api_spend`. Imported lazily so the pure
 * engine modules never pull the DB layer into a unit test's module graph — and
 * so a ledger failure can never break a request that already succeeded.
 */
function persistSpend(row: {
  provider: ExternalProvider;
  context: string;
  credits: number;
  creditsRemaining: number | null;
  estUsdCents: number;
}): void {
  if (isTestRunner()) return; // tests never touch the DB (the in-process meter still counts)
  void import('./externalSpend.js')
    .then((m) => m.recordLiveCall(row))
    .catch(() => {
      /* ledger is observability, never a hard dependency */
    });
}

/**
 * Refine the most recent ledger row for a provider with the numbers the provider
 * itself reported (ImportYeti returns `requestCost` + `creditsRemaining` in the
 * response body, which is only known after the call). Also updates the
 * in-process meter. Never throws.
 */
export function reportProviderCost(
  provider: ExternalProvider,
  cost: number | null,
  creditsRemaining: number | null,
): void {
  const m = meterFor(provider);
  if (cost != null && Number.isFinite(cost)) {
    // Replace this call's estimate with the reported number.
    m.credits = Math.max(0, m.credits - EST_CREDITS[provider] + cost);
  }
  if (creditsRemaining != null && Number.isFinite(creditsRemaining)) {
    m.lastCreditsRemaining = creditsRemaining;
  }
  if (isTestRunner()) return; // tests never touch the DB
  void import('./externalSpend.js')
    .then((mod) =>
      mod.noteReportedCost(provider, cost, creditsRemaining, EST_CENTS_PER_CREDIT[provider]),
    )
    .catch(() => {
      /* observability only */
    });
}

// ── the choke point ──────────────────────────────────────────────────────────
/**
 * Timeout wrapper — every external call goes through here so a hung provider
 * trips an AbortError instead of holding the request open indefinitely.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = EXTERNAL_TIMEOUT_MS,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * THE SINGLE CHOKE POINT for every paid outbound call.
 *
 * Returns `null` when the cost guard is off — WITHOUT opening a socket — so the
 * caller degrades to cache-only. Otherwise performs the (timeout-wrapped) call
 * and records it in the in-process meter + the persisted spend ledger.
 *
 * @param provider which paid provider is being billed
 * @param context  short, log-safe description ("search page=1", "profile:acme")
 */
export async function guardedFetch(
  provider: ExternalProvider,
  context: string,
  url: string,
  init: RequestInit = {},
  timeoutMs = EXTERNAL_TIMEOUT_MS,
): Promise<Response | null> {
  const decision = livePullsAllowed(provider);
  if (!decision.allowed) {
    meterFor(provider).blockedCalls += 1;
    console.warn(
      `[importers] live pull BLOCKED (cost guard) — cache-only · provider=${provider} ctx=${context} reason=${decision.reason}`,
    );
    return null;
  }
  const m = meterFor(provider);
  m.liveCalls += 1;
  m.credits += EST_CREDITS[provider];
  m.lastLiveAt = new Date().toISOString();
  persistSpend({
    provider,
    context,
    credits: EST_CREDITS[provider],
    creditsRemaining: null,
    estUsdCents: EST_CREDITS[provider] * EST_CENTS_PER_CREDIT[provider],
  });
  return fetchWithTimeout(url, init, timeoutMs);
}

/** Human-readable note surfaced in dev responses when a pull was blocked. */
export const CACHE_ONLY_NOTE = 'live pulls disabled — cached data only';
