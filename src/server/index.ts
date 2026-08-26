/**
 * Server entry point. Loads env, creates the Express app, listens.
 */
// MUST be the FIRST import: pulls Doppler-only secrets into process.env
// (soft no-op when DOPPLER_TOKEN is unset) BEFORE config.ts / db read env.
import './bootstrapDoppler.js';
import { loadEnv } from '../config.js';
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
import { startFuelSurchargeCron } from '../eia/dieselPrice.js';
import { startDirectoryRefreshCron } from './directoryRefreshCron.js';
import { runCronSafely } from './cronSafety.js';

// Global crash guards. The two Node fault classes need OPPOSITE handling:
//
// unhandledRejection → LOG and SURVIVE. The dominant source in prod is a
// transient Neon idle-connection drop during serving (a pooled socket Neon
// reaps async → a stray rejection with no local catch). That is fully
// recoverable — the driver reconnects on the next query — so killing the
// process over it is self-inflicted downtime (an earlier attempt exited here
// and it drove the flap: every idle drop became a restart). Since the boot DB
// work no longer runs on the path that exits the process (it lives in the
// background heal block below, which has its own try/catch), a stray rejection
// no longer means a half-booted server either. Log the thrower and keep serving.
//
// uncaughtException → LOG and EXIT. Per Node's guidance the process is in an
// undefined state after an uncaught synchronous throw; a clean restart is the
// only safe response. Registered BEFORE main() so it covers all DB/cron work.
process.on('unhandledRejection', (reason) => {
  console.error('[server] UNHANDLED REJECTION (non-fatal, surviving):', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[server] UNCAUGHT EXCEPTION (fatal, exiting for clean restart):', err);
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
    // LAZY PRECOMPUTE of the persisted global directory aggregates. If the
    // singleton directory_aggregate_cache row is missing or stale (>24h), compute
    // it ONCE here (off the request path, limiter+timeout bounded) and persist it,
    // so the very first /directory hit after a deploy serves a single-row lookup
    // instead of triggering the 330k-row scan stampede that took all domains down.
    // Fire-and-forget, never throws into boot; the weekly cron keeps it fresh.
    void ensureFreshDirectoryAggregates().catch((err) => {
      console.error('[directory-aggregates] startup precompute failed (non-fatal):', err);
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
    await runCronSafely('fuel-surcharge-cron', () => startFuelSurchargeCron());
    // NEW: weekly FMCSA carrier-directory refresh (keeps ~321k rows from going
    // stale — see src/server/directoryRefreshCron.ts). Its own tick is wrapped in
    // runCronSafely internally, so a re-ingest throw/hang alerts the admin too.
    await runCronSafely('directory-refresh-cron', () => startDirectoryRefreshCron());
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
  app.listen(env.PORT, env.HOST, () => {
    console.log(`[server] QuoteFleet listening on http://${env.HOST}:${env.PORT}`);
    console.log(`[server] Public base URL: ${env.PUBLIC_BASE_URL}`);
    // Fire-and-forget post-listen work; this function catches its own errors.
    void runPostListenJobs();
  });
}

main().catch((err) => {
  console.error('[server] Failed to start:', err);
  process.exit(1);
});
