/**
 * Server entry point. Loads env, creates the Express app, listens.
 */
// MUST be the FIRST import: pulls Doppler-only secrets into process.env
// (soft no-op when DOPPLER_TOKEN is unset) BEFORE config.ts / db read env.
import './bootstrapDoppler.js';
import { loadEnv } from '../config.js';
import { runMigrations, ensureSelfHealColumns, ensureSelfHealTables } from '../db/migrate.js';
import { maybeAutoHealCarrierDirectory } from './directory/autoHeal.js';
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

async function main() {
  const env = loadEnv();
  // Journal-INDEPENDENT re-create of at-risk TABLES — MUST run BEFORE
  // runMigrations(). The public carrier_directory table (0041) can be missing on
  // prod entirely (Replit doesn't run db:migrate and its publish tool phantom-
  // drops tables), while Drizzle's journal still records 0041 as applied. If
  // migrations run first, the very next migration that ALTERs carrier_directory
  // (0042 ADD COLUMN country) throws 42P01 on the missing table and the unguarded
  // throw crash-loops boot → "deployment could not be reached" on every domain
  // (prod outage 2026-08-19). Creating the at-risk tables first makes the pending
  // migrations — all idempotent (ADD COLUMN / CREATE TABLE IF NOT EXISTS) — safe
  // no-ops. CREATE TABLE IF NOT EXISTS is itself a no-op on a healthy DB.
  await ensureSelfHealTables();
  // Apply any pending DB migrations BEFORE serving — the Replit deploy doesn't
  // run db:migrate, so this makes every republish self-healing (see db/migrate).
  await runMigrations();
  // Journal-INDEPENDENT re-add of at-risk brand_configs columns (Replit's
  // publish tool keeps phantom-dropping them; Drizzle's journal won't re-add
  // migrations it already recorded). Runs AFTER runMigrations so it never races
  // the (non-IF-NOT-EXISTS) brand_configs column migrations into a duplicate-
  // column error; here it only re-adds columns a phantom-drop actually removed.
  await ensureSelfHealColumns();
  // Seed/refresh the canonical intermodal-terminal reference list (a few dozen
  // idempotent upserts). Non-critical to serving, so a failure is logged but
  // NEVER crashes boot — the table (self-healed above) still renders, just
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
  // ingest can run ~30 min and MUST NOT block the server from listening. It is
  // fire-and-forget, single-flighted by a Postgres advisory lock, and never
  // throws into boot (see src/server/directory/autoHeal.ts).
  void maybeAutoHealCarrierDirectory();
  const app = createApp();
  app.listen(env.PORT, env.HOST, () => {
    console.log(`[server] QuoteFleet listening on http://${env.HOST}:${env.PORT}`);
    console.log(`[server] Public base URL: ${env.PUBLIC_BASE_URL}`);
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
}

main().catch((err) => {
  console.error('[server] Failed to start:', err);
  process.exit(1);
});
