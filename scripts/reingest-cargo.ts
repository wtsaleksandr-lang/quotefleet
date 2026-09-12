/* One-off: ensure schema (adds 0050 cargo columns via self-heal + migrations),
   then run the full FMCSA ingest to backfill the 13 cargo-class booleans into
   every existing carrier row. Idempotent upsert — safe to re-run.
   Run: doppler run -p quotefleet -c prd --scope "C:\Users\Owner" -- npx tsx scripts/reingest-cargo.ts */
import { ensureSelfHealTables, runMigrations, ensureSelfHealColumns } from '../src/db/migrate';
import { runIngest } from '../src/server/directory/carrierIngest';

async function main() {
  const t0 = Date.now();
  console.log('[reingest] ensuring schema (tables → migrations → columns)…');
  await ensureSelfHealTables();
  await runMigrations();
  await ensureSelfHealColumns();
  const limit = Number(process.env.INGEST_LIMIT || '0');
  const states = (process.env.INGEST_STATES || '').split(',').map((s) => s.trim()).filter(Boolean);
  console.log(`[reingest] schema ready; ingest limit=${limit || 'ALL'} states=${states.join('|') || 'ALL'}…`);
  const summary = await runIngest(
    { limit, offset: 0, pageSize: 1000, states, dryRun: false },
    undefined,
    { log: (m: string) => console.log(m) },
  );
  console.log('[reingest] DONE in', Math.round((Date.now() - t0) / 1000), 's');
  console.log('[reingest] summary:', JSON.stringify({
    carriersSeen: (summary as any).carriersSeen,
    ingested: (summary as any).ingested,
    intermodal: (summary as any).intermodal,
  }));
  process.exit(0);
}
main().catch((e) => { console.error('[reingest] FAILED', e); process.exit(1); });
