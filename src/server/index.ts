/**
 * Server entry point. Loads env, creates the Express app, listens.
 */
// MUST be the FIRST import: pulls Doppler-only secrets into process.env
// (soft no-op when DOPPLER_TOKEN is unset) BEFORE config.ts / db read env.
import './bootstrapDoppler.js';
import { loadEnv } from '../config.js';
import { runMigrations, ensureSelfHealColumns, ensureSelfHealTables } from '../db/migrate.js';
import { maybeAutoHealCarrierDirectory } from './directory/autoHeal.js';
import { maybeBackfillNearestPortCodes } from './directory/backfillNearestPort.js';
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

// Background boot work: schema self-heal + migrations + seed + cron
// registration. Deliberately runs AFTER app.listen() so the process is already
// serving (and the `/` + static healthchecks pass) within a second or two of
// start, instead of blocking on a long serial DB chain against a cold Neon
// compute + the 330k-row prod DB — that blocking chain, when it exceeded a
// driver timeout, threw → process.exit(1) → restart, which was the chronic
// prod flap (~40% uptime). Every route is already resilient to a not-yet-healed
// schema (listCarriers try/catch → empty list, the widget column-scopes its
// selects, /api/health try/catch → 503), so serving empty-state for the few
// seconds the heal takes is correct and far better than not serving at all.
// The whole block is wrapped so a heal failure LOGS and NEVER exits — it simply
// retries on the next boot; it must never kill a process that is serving fine.
async function runBackgroundBoot(): Promise<void> {
  try {
    // Journal-INDEPENDENT re-create of at-risk TABLES — MUST run BEFORE
    // runMigrations(). The public carrier_directory table (0041) can be missing on
    // prod entirely (Replit doesn't run db:migrate and its publish tool phantom-
    // drops tables), while Drizzle's journal still records 0041 as applied. If
    // migrations run first, the very next migration that ALTERs carrier_directory
    // (0042 ADD COLUMN country) throws 42P01 on the missing table. Creating the
    // at-risk tables first makes the pending migrations — all idempotent (ADD
    // COLUMN / CREATE TABLE IF NOT EXISTS) — safe no-ops. CREATE TABLE IF NOT
    // EXISTS is itself a no-op on a healthy DB.
    await ensureSelfHealTables();
    // Apply any pending DB migrations — the Replit deploy doesn't run db:migrate,
    // so this makes every republish self-healing (see db/migrate).
    await runMigrations();
    // Journal-INDEPENDENT re-add of at-risk brand_configs columns (Replit's
    // publish tool keeps phantom-dropping them; Drizzle's journal won't re-add
    // migrations it already recorded). Runs AFTER runMigrations so it never races
    // the (non-IF-NOT-EXISTS) brand_configs column migrations into a duplicate-
    // column error; here it only re-adds columns a phantom-drop actually removed.
    await ensureSelfHealColumns();
    // Seed/refresh the canonical intermodal-terminal reference list (a few dozen
    // idempotent upserts). Non-critical to serving, so a failure is logged but
    // never propagates — the table (self-healed above) still renders, just
    // possibly stale/empty until the next boot re-seeds.
    try {
      const n = await seedDirectoryTerminals();
      console.log(`[server] directory_terminals seeded (${n} rows)`);
    } catch (err) {
      console.error('[server] directory_terminals seed failed (non-fatal):', err);
    }
    // Journal-INDEPENDENT re-population of the carrier_directory DATA. The
    // ensureSelfHealTables step above restores the (empty) table after a Replit
    // phantom-drop, but the ~321k ingested FMCSA rows are gone. This kicks off a
    // background re-ingest when the table is empty. Deliberately NOT awaited: the
    // ingest can run ~30 min. It is single-flighted by a Postgres advisory lock
    // and never throws into boot (see src/server/directory/autoHeal.ts).
    void maybeAutoHealCarrierDirectory();
    // Journal-INDEPENDENT RE-DERIVATION of carrier_directory.nearest_port_code.
    // The stored column is derived (ZIP/province → nearest hub) but only written at
    // ingest time, so rows loaded under an OLDER hub set kept stale codes. This
    // recomputes the column in place using the SAME current derivation — no FMCSA
    // re-download. Version-gated, single-flighted by its own advisory lock,
    // batched, fire-and-forget, never throws into boot (see backfillNearestPort.ts).
    void maybeBackfillNearestPortCodes();
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
    console.log('[server] background schema heal complete');
  } catch (err) {
    // A heal failure must NEVER kill a process that is already serving. Log it;
    // the next boot re-runs the idempotent chain. Routes serve empty-state
    // meanwhile.
    console.error('[server] background heal failed (non-fatal):', err);
  }
}

async function main() {
  const env = loadEnv();
  // Bind the port FIRST — before any DB work — so the process is listening and
  // the `/` healthcheck passes within a second or two. createApp() is fully
  // synchronous and every route handler resolves db() lazily at request time, so
  // nothing a route needs at import/registration time depends on the heal chain.
  const app = createApp();
  app.listen(env.PORT, env.HOST, () => {
    console.log(`[server] QuoteFleet listening on http://${env.HOST}:${env.PORT}`);
    console.log(`[server] Public base URL: ${env.PUBLIC_BASE_URL}`);
    // Kick off the schema self-heal / migrations / seed / cron registration in
    // the BACKGROUND, once we're already listening. void: fire-and-forget, and
    // runBackgroundBoot swallows its own errors so it can never reject unhandled.
    void runBackgroundBoot();
  });
}

main().catch((err) => {
  console.error('[server] Failed to start:', err);
  process.exit(1);
});
