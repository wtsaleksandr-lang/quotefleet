/**
 * Server entry point. Loads env, creates the Express app, listens.
 */
// MUST be the FIRST import: pulls Doppler-only secrets into process.env
// (soft no-op when DOPPLER_TOKEN is unset) BEFORE config.ts / db read env.
import './bootstrapDoppler.js';
import { loadEnv } from '../config.js';
import { ensureSelfHealTables, ensureSelfHealColumns } from '../db/migrate.js';
import { ensureAuthorityRevalidationColumns } from './directory/authorityRevalidation.js';
import { maybeAutoHealCarrierDirectory } from './directory/autoHeal.js';
import { maybeBackfillNearestPortCodes } from './directory/backfillNearestPort.js';
import { ensureFreshDirectoryAggregates } from './directory/queries.js';
import { seedDirectoryTerminals } from './directory/terminals.js';
import { createApp } from './app.js';
import { startMarketplaceCron } from '../marketplace/cron.js';
import { startLifecycleEmailCron } from '../email/lifecycleCron.js';
import { startFollowUpEmailCron } from '../email/followUpCron.js';
import { startDunningEmailCron } from '../email/dunningCron.js';
import { startWeeklyDigestCron } from '../email/weeklyDigestCron.js';
import { startManifestRenewalCron } from '../email/manifestRenewalCron.js';
import { startFuelSurchargeCron } from '../eia/dieselPrice.js';
import { startDirectoryRefreshCron } from './directoryRefreshCron.js';
import { runCronSafely } from './cronSafety.js';
import { ensureJobRunsTable } from './jobHealth.js';
import { startJobHealthWatchdogCron } from './jobHealthWatchdogCron.js';
import { startOpsDigestCron } from './opsDigestCron.js';
import {
  decideUncaughtExceptionAction,
  isServerListening,
  markServerListening,
  maybeScheduleCrashProofSelfTest,
} from './backgroundSafety.js';

// Global crash guards. The two Node fault classes are handled by the SAME
// principle: once the server is LISTENING, a fault bubbling out of background
// work must NEVER take the process down — degrade, don't die. A fault BEFORE
// listen is a genuine startup failure and still fails fast.
//
// unhandledRejection → ALWAYS LOG and SURVIVE. The dominant source in prod is a
// transient Neon idle-connection drop during serving (a pooled socket Neon
// reaps async → a stray rejection with no local catch). That is fully
// recoverable — the driver reconnects on the next query — so killing the
// process over it is self-inflicted downtime (an earlier attempt exited here
// and it drove the flap: every idle drop became a restart). Boot DB work runs in
// the background heal block below (its own try/catch), so a stray rejection
// never means a half-booted server either. Log the thrower and keep serving.
//
// uncaughtException → GATED on whether the server is already listening:
//   • BEFORE listen (still booting): fail fast. Per Node's guidance the process
//     is in an undefined state after an uncaught synchronous throw, and nothing
//     is serving yet — a genuinely-unrecoverable startup error (can't bind port,
//     can't load config) belongs here, so a clean restart is correct.
//   • AFTER listen (serving traffic): LOG and SURVIVE. A throw escaping from a
//     background path — a cron tick, an SWR refresh, a post-listen precompute, a
//     stray DB callback — must NOT exit a healthy server. Exiting would 500
//     every route (including the zero-logic /healthz) and crash-loop under
//     Replit's restart — the exact outage this file's guards exist to prevent.
// Registered BEFORE main() so it covers all DB/cron/background work.
process.on('unhandledRejection', (reason) => {
  console.error('[server] UNHANDLED REJECTION (non-fatal, surviving):', reason);
});
process.on('uncaughtException', (err) => {
  if (decideUncaughtExceptionAction(isServerListening()) === 'survive') {
    console.error(
      '[server] UNCAUGHT EXCEPTION after listen (non-fatal, surviving — background fault must not crash a serving process):',
      err,
    );
    return;
  }
  console.error(
    '[server] UNCAUGHT EXCEPTION during startup (fatal, exiting for clean restart):',
    err,
  );
  process.exit(1);
});

// Post-listen work is deliberately limited to non-destructive, best-effort
// tasks. Production schema changes are managed by Replit's Publish database
// diff; running migrations or DDL inside the web process can hold database
// locks long enough to make otherwise healthy probes time out.
async function runPostListenJobs(): Promise<void> {
  try {
    // Seed/refresh the canonical intermodal-terminal reference list (a few dozen
    // idempotent upserts). It is non-critical to serving.
    try {
      const n = await seedDirectoryTerminals();
      console.log(`[server] directory_terminals seeded (${n} rows)`);
    } catch (err) {
      console.error('[server] directory_terminals seed failed (non-fatal):', err);
    }
    void maybeAutoHealCarrierDirectory().catch((err) => {
      console.error('[autoheal] startup check failed (non-fatal):', err);
    });
    // Journal-INDEPENDENT RE-DERIVATION of carrier_directory.nearest_port_code.
    // The stored column is derived (ZIP/province → nearest hub) but only written at
    // ingest time, so rows loaded under an OLDER hub set kept stale codes. This
    // recomputes the column in place using the SAME current derivation — no FMCSA
    // re-download. Version-gated, single-flighted by its own advisory lock,
    // batched, fire-and-forget, never throws into boot (see backfillNearestPort.ts).
    void maybeBackfillNearestPortCodes().catch((err) => {
      console.error('[directory-backfill] startup check failed (non-fatal):', err);
    });
    // JOURNAL-INDEPENDENT SCHEMA SELF-HEAL. Replit's deploy skips db:migrate and
    // its publish tool can DROP tables/columns, so these idempotent
    // CREATE/ALTER ... IF NOT EXISTS statements must re-assert the at-risk schema
    // on EVERY boot (exactly what their own docstrings promise). This wiring was
    // MISSING on the boot path, so directory_aggregate_cache was never created in
    // prod — silently disabling the persisted-aggregate precompute (the recurring
    // all-domains-down outage fix) and making the hourly aggregate-refresh cron
    // full-table-scan then fail its INSERT into the absent table.
    //
    // Fired POST-LISTEN and non-blocking (`void ... .catch`) — identical to the
    // data heals above — so a brief DDL lock can NEVER delay a healthz probe. Each
    // heal contains ONLY idempotent CREATE TABLE / CREATE INDEX / ADD COLUMN
    // IF NOT EXISTS statements (no backfill / heavy ALTER), each a no-op round-trip
    // on a healthy DB. The directory TABLE heal is chained to the aggregate
    // precompute so directory_aggregate_cache exists before the precompute writes
    // its singleton row; the precompute itself is limiter+timeout bounded and
    // never throws into boot, and the weekly cron keeps the row fresh thereafter.
    //
    // The live-authority cache columns are chained onto this SAME promise rather
    // than fired beside it: they ALTER carrier_directory, which the table heal has
    // just finished touching, and two concurrent ACCESS EXCLUSIVE requests on one
    // table are precisely the lock pile-up that took prod down on 2026-08-28. They
    // run BEFORE the aggregate precompute (a plain read/write that does not need
    // them) so the DDL window closes as early as possible. Their absence is a plain
    // cache miss to the endpoint that reads them, so a deferred heal degrades to
    // the stored snapshot rather than erroring.
    void ensureSelfHealTables()
      .then(() => ensureAuthorityRevalidationColumns())
      .then(() => ensureFreshDirectoryAggregates())
      .catch((err) => {
        console.error(
          '[server] directory table self-heal + aggregate precompute failed (non-fatal):',
          err,
        );
      });
    // brand_configs at-risk columns — same journal-independent phantom-drop guard,
    // independent of the table heal above (different tables → no lock contention),
    // so it neither blocks nor is blocked by it.
    void ensureSelfHealColumns().catch((err) => {
      console.error('[server] brand_configs column self-heal failed (non-fatal):', err);
    });
    // job_runs ledger — a brand-new table touched by nothing else, so it is
    // fired independently of the carrier_directory chain above (no shared lock).
    // Crons begin writing 30s–2min from now and the watchdog first reads at
    // +5min, so this CREATE TABLE IF NOT EXISTS wins the race comfortably; a
    // ledger write that loses it is swallowed and the next tick records fine.
    void ensureJobRunsTable().catch((err) => {
      console.error('[server] job_runs ledger self-heal failed (non-fatal):', err);
    });
    // Register every scheduled cron through runCronSafely. This wrapper (a) catches
    // a throw at registration so one cron failing to register can NEVER stop the
    // siblings below it from registering, and (b) sends a de-duped admin alert +
    // logs the failure instead of it dying silently on an unwatched Replit deploy.
    // Additive: each cron keeps its own internal per-tick try/catch; this only adds
    // the registration-boundary safety + alerting.
    //
    // NOTE for merges: this list is intentionally one runCronSafely call per cron —
    // a future agent adding another cron should add ONE more line in the same shape.
    await runCronSafely('marketplace-cron', () => startMarketplaceCron());
    await runCronSafely('lifecycle-email-cron', () => startLifecycleEmailCron());
    await runCronSafely('followup-email-cron', () => startFollowUpEmailCron());
    // Dunning: emails the card-update sequence to tenants whose subscription
    // payment failed (self-contained — reads the billing past-due marker).
    await runCronSafely('dunning-email-cron', () => startDunningEmailCron());
    await runCronSafely('weekly-digest-cron', () => startWeeklyDigestCron());
    await runCronSafely('manifest-renewal-cron', () => startManifestRenewalCron());
    await runCronSafely('fuel-surcharge-cron', () => startFuelSurchargeCron());
    // NEW: weekly FMCSA carrier-directory refresh (keeps ~321k rows from going
    // stale — see src/server/directoryRefreshCron.ts). Its own tick is wrapped in
    // runCronSafely internally, so a re-ingest throw/hang alerts the admin too.
    await runCronSafely('directory-refresh-cron', () => startDirectoryRefreshCron());
    // NEW: job staleness watchdog. Registered LAST so the jobs it watches have
    // already been scheduled. Every cron above now records each tick to the
    // `job_runs` ledger; this is the piece that notices when one of them STOPS
    // recording — the failure mode no try/catch can see. See jobHealthWatchdog.ts.
    await runCronSafely('job-health-watchdog-cron', () => startJobHealthWatchdogCron());
    // NEW: daily ops digest — pushes the work that must stay human (CBP filings
    // awaiting submission, LAPSED filings, past-due tenants) to the admin instead
    // of requiring someone to remember to open a page. See opsDigestCron.ts.
    await runCronSafely('ops-digest-cron', () => startOpsDigestCron());
    console.log('[server] post-listen jobs registered');
  } catch (err) {
    console.error('[server] post-listen setup failed (non-fatal):', err);
  }
}

async function main() {
  const env = loadEnv();
  // Bind the port before any optional database work so the service becomes
  // reachable as soon as Express is constructed.
  const app = createApp();
  const server = app.listen(env.PORT, env.HOST, () => {
    // The server is now serving traffic. Flip the boot-vs-serving gate BEFORE any
    // background work starts so that from here on an uncaughtException escaping a
    // background path is SURVIVED (see the process.on('uncaughtException') guard
    // above) instead of crash-looping a healthy, listening process.
    markServerListening();
    console.log(`[server] QuoteFleet listening on http://${env.HOST}:${env.PORT}`);
    console.log(`[server] Public base URL: ${env.PUBLIC_BASE_URL}`);
    // Fire-and-forget post-listen work; this function catches its own errors.
    void runPostListenJobs();
    // Chaos probe — inert unless CRASHPROOF_SELFTEST=1 (never set in any deploy).
    // When armed it raises a simulated background uncaughtException shortly after
    // listen; the guard above must swallow it and /healthz must stay 200.
    maybeScheduleCrashProofSelfTest();
  });

  // ── INBOUND SOCKET BACKSTOP ────────────────────────────────────────────────
  // The listener's return value used to be discarded, so none of these was ever
  // set. Node's keepAlive default (5s) is already safe, but `requestTimeout`
  // (5 min) and an unbounded `maxConnections` mean a slow-loris / stalled-body
  // client can hold FDs for minutes with no ceiling. These are a BACKSTOP, not
  // the leak fix (that is the whole-exchange fetch deadlines) — they cap how
  // much damage any single inbound stall can do.
  //
  // headersTimeout MUST stay > keepAliveTimeout, else a keep-alive socket that
  // is reused just as it expires races and drops a legitimate request.
  server.keepAliveTimeout = 15_000;
  server.headersTimeout = 20_000;
  server.requestTimeout = 60_000;
  // Well under a typical container's 1024-FD limit, leaving ample headroom for
  // the DB pool + outbound sockets. Past the cap Node stops accepting (and the
  // edge retries) instead of the process running out of descriptors entirely.
  server.maxConnections = 512;

  // Close the listener on a redeploy signal so in-flight requests drain and
  // sockets are released cleanly rather than being severed by process exit.
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => {
      console.log(`[server] ${sig} received — closing listener and draining.`);
      server.close(() => process.exit(0));
      // Idle keep-alive sockets have no request in flight, so hang them up at
      // once — otherwise `close()` waits out keepAliveTimeout on every one and
      // a routine redeploy stalls for no reason.
      server.closeIdleConnections?.();
      // Don't hang forever on a genuinely stuck request.
      setTimeout(() => process.exit(0), 10_000).unref();
    });
  }
}

main().catch((err) => {
  console.error('[server] Failed to start:', err);
  process.exit(1);
});
