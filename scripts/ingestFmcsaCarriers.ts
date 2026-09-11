/**
 * FMCSA carrier-directory ingest — CLI entry point.
 *
 * The reusable ingest engine (fetch → filter → normalize → upsert) now lives in
 * src/server/directory/carrierIngest.ts so the COMPILED server can import
 * runIngest() for boot-time auto-heal (scripts/ is never compiled into dist/).
 * This file is the thin command-line wrapper: it re-exports the whole core (so
 * the existing unit tests keep importing from here) and adds arg parsing + the
 * run summary print, preserving the exact CLI behavior/flags:
 *   --sample        small run for validation (default 500 carriers).
 *   --limit N       cap total carriers ingested (0 = no cap → full run).
 *   --offset N      start at L&I page offset N (resume a partial run).
 *   --page N        L&I page size (default 1000).
 *   --state XX      restrict to one L&I `bus_state_code` (repeatable) — bounded
 *                   loads. NOTE this filters the L&I file's OWN code spelling,
 *                   which for Mexico differs from the census spelling that ends
 *                   up in `carrier_directory.state`: `--state TM` (L&I
 *                   Tamaulipas) writes rows with state='TA' (census Tamaulipas),
 *                   and `--state BA` writes 'BN'. See src/server/directory/
 *                   mxStates.ts for the full measured mapping.
 *   --include-canada  also ingest Canada-domiciled carriers (tagged country='CA').
 *                     DEFAULT ON — runIngest treats an absent flag as enabled;
 *                     set INGEST_INCLUDE_CANADA=0 to force the legacy US-only run.
 *                     (This line used to say "DEFAULT OFF"; that stopped being
 *                     true when runIngest flipped its own default and the CLI
 *                     started passing `undefined` rather than `false`.)
 *   --dry-run       parse + filter + summarize, but do NOT write to the DB.
 *
 * MEXICO has no flag: it ingests unconditionally, like the US. FMCSA licenses
 * ~14.7k active property carriers domiciled in Mexico under the same authority,
 * and they were dropped outright until carrierCountry() learned the Mexican
 * state codes.
 *
 * DO NOT run a full national load casually — there are ~370k active property
 * carriers. Use --limit or --state for bounded pilot loads.
 *
 * PILOT (orchestrator, dev DB):
 *   doppler run -p quotefleet -c dev --scope "C:\\Users\\Owner" -- \
 *     node node_modules/tsx/dist/cli.mjs scripts/ingestFmcsaCarriers.ts --state RI --state DE
 */
export * from '../src/server/directory/carrierIngest.js';

import { runIngest, type IngestOptions } from '../src/server/directory/carrierIngest.js';

// ─── CLI ──────────────────────────────────────────────────────────────────
function parseArgs(argv: string[]): IngestOptions {
  const has = (f: string) => argv.includes(f);
  const val = (f: string, d: number): number => {
    const i = argv.indexOf(f);
    if (i === -1 || i + 1 >= argv.length) return d;
    const n = Number.parseInt(argv[i + 1], 10);
    return Number.isFinite(n) ? n : d;
  };
  // --state may repeat: --state RI --state DE
  const states: string[] = [];
  argv.forEach((a, i) => {
    if (a === '--state' && argv[i + 1]) states.push(argv[i + 1].toUpperCase());
  });
  const sample = has('--sample');
  return {
    limit: val('--limit', sample ? 500 : 0),
    offset: val('--offset', 0),
    pageSize: val('--page', 1000),
    states,
    dryRun: has('--dry-run'),
    // Explicit flag wins; when absent, runIngest falls back to INGEST_INCLUDE_CANADA=1.
    includeCanada: has('--include-canada') ? true : undefined,
  };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  console.log(
    `[ingest] FMCSA active property carriers → carrier_directory ` +
      `(limit=${opts.limit || 'ALL'}, offset=${opts.offset}, page=${opts.pageSize}` +
      `${opts.states.length ? ', states=' + opts.states.join('+') : ''}` +
      `${opts.includeCanada ? ', +CANADA' : ''}${opts.dryRun ? ', DRY-RUN' : ''})`,
  );
  const t0 = Date.now();
  const s = await runIngest(opts);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const pct = s.ingested ? ((100 * s.intermodal) / s.ingested).toFixed(1) : '0.0';
  console.log('\n[ingest] DONE in ' + secs + 's');
  console.log(`  carriers ingested : ${s.ingested}`);
  console.log(`  intermodal (dray) : ${s.intermodal} (${pct}%)`);
  console.log(`  per-country       : ${s.countryCounts.map(([c, n]) => `${c}=${n}`).join('  ') || '(none)'}`);
  console.log(
    `  unplaceable       : ${s.unplaceable}` +
      (s.unplaceable ? ` (${s.unplaceableCodes.slice(0, 8).map(([c, n]) => `${c}=${n}`).join(' ')})` : ''),
  );
  console.log(`  per-state         : ${s.stateCounts.slice(0, 15).map(([st, c]) => `${st}=${c}`).join('  ') || '(none)'}`);
  console.log(`  per-port          : ${s.portCounts.map(([p, c]) => `${p}=${c}`).join('  ') || '(none)'}`);
}

// Run only when invoked directly (not when imported by the test).
const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('ingestFmcsaCarriers.ts');
if (invokedDirectly) {
  main()
    .then(() => {
      // The app's pg pool (src/db/client.ts) stays open, keeping the event loop
      // alive; exit explicitly so the CLI returns instead of hanging.
      process.exit(0);
    })
    .catch((err) => {
      console.error('[ingest] FAILED:', err);
      process.exit(1);
    });
}
