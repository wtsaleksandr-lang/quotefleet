/**
 * Ingest active US freight BROKERS from FMCSA's free public data → broker_leads.
 *
 * SOURCES (free, daily-updated, no key needed — the DOT Open Data Portal /
 * Socrata API over the FMCSA "Data Dissemination Program" files):
 *   - L&I (Licensing & Insurance) Carrier file  — resource 6eyk-hxee
 *       Carries operating AUTHORITY. A row is an active property broker when
 *       broker_stat = 'A' (active broker authority) AND property_chk = 'Y'
 *       (property, i.e. general freight — excludes passenger / HHG-only brokers).
 *       Also supplies docket_number (MC), dot_number, legal/dba name, address, phone.
 *   - Company Census file                        — resource az4n-8mr2
 *       Supplies email_address + power_units + a live status_code (A/I), keyed by
 *       dot_number. (L&I dot_number is zero-padded, census is not, so we strip
 *       leading zeros to join.)
 *
 * We page the Socrata JSON API with a SERVER-SIDE $where filter rather than
 * downloading the multi-hundred-MB bulk CSV/ZIP snapshots: it is streaming,
 * batched, resumable ($offset), dependency-free (no CSV parser), and lets us pull
 * ONLY active property brokers. The equivalent bulk snapshots (CSV/JSON/XML) live
 * at https://data.transportation.gov/api/v3/views/<id>/export.csv?accessType=DOWNLOAD
 * — swap those in later if a full offline load is ever wanted.
 *
 * Idempotent (dbLeadStore.upsert dedupes by mcNumber), resumable (--offset N),
 * and safe to re-run. Flags:
 *   --sample        small run for validation (default 500 brokers).
 *   --limit N       cap total brokers ingested (0 = no cap → full ~25k run).
 *   --offset N      start at L&I page offset N (resume a partial run).
 *   --page N        L&I page size (default 1000).
 *   --dry-run       parse + filter + summarize, but do NOT write to the DB.
 *
 * FULL RUN (orchestrator, dev DB):
 *   doppler run -p quotefleet -c dev --scope "C:\\Users\\Owner" -- \
 *     pnpm exec tsx scripts/ingestFmcsaCensus.ts --limit 0
 */
import { dbLeadStore, type LeadStore, type UpsertLeadInput } from '../src/server/outreach/leadStore.js';

// ─── Socrata sources ──────────────────────────────────────────────────────
const SOCRATA_BASE = 'https://data.transportation.gov/resource';
const LI_CARRIER_ID = '6eyk-hxee'; // Licensing & Insurance — Carrier / authority
const CENSUS_ID = 'az4n-8mr2'; // Company Census file
/** Only active property brokers (SoQL, applied server-side). */
const BROKER_WHERE = "broker_stat='A' AND property_chk='Y'";
const FETCH_UA = 'QuoteFleetOutreachBot/1.0 (+https://quotefleet.net/bot)';

// ─── Raw row shapes (subset of the columns we use) ────────────────────────
export interface LiCarrierRow {
  docket_number?: string;
  dot_number?: string;
  broker_stat?: string;
  property_chk?: string;
  hhg_chk?: string;
  legal_name?: string;
  dba_name?: string;
  bus_street_po?: string;
  bus_city?: string;
  bus_state_code?: string;
  bus_zip_code?: string;
  bus_telno?: string;
}

export interface CensusRow {
  dot_number?: string;
  legal_name?: string;
  email_address?: string;
  power_units?: string;
  phone?: string;
  status_code?: string;
  phy_street?: string;
  phy_city?: string;
  phy_state?: string;
  phy_zip?: string;
}

// ─── Pure normalize / filter helpers (unit-tested) ────────────────────────
export function cleanStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

/** USDOT number with leading zeros stripped, so L&I ("00107080") joins census
 *  ("107080"). Returns null when empty / non-numeric. */
export function normalizeDot(v: unknown): string | null {
  const s = cleanStr(v);
  if (!s) return null;
  const digits = s.replace(/\D/g, '').replace(/^0+/, '');
  return digits.length ? digits : null;
}

/** MC/docket number verbatim (e.g. "MC012892"), trimmed. */
export function normalizeMc(v: unknown): string | null {
  return cleanStr(v);
}

/** Keep a phone only if it has ≥10 digits; store the digit string. */
export function normalizePhone(v: unknown): string | null {
  const s = cleanStr(v);
  if (!s) return null;
  const digits = s.replace(/\D/g, '');
  return digits.length >= 10 ? digits : null;
}

export function normalizeEmail(v: unknown): string | null {
  const s = cleanStr(v);
  if (!s) return null;
  const e = s.toLowerCase();
  // Basic shape check — census emails are dirty (spaces, "N/A", etc.).
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

function toInt(v: unknown): number | null {
  const s = cleanStr(v);
  if (!s) return null;
  const n = Number.parseInt(s.replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

/** True iff the L&I row is an ACTIVE PROPERTY broker. */
export function isActivePropertyBroker(li: LiCarrierRow): boolean {
  return li.broker_stat === 'A' && li.property_chk === 'Y';
}

/** Census status 'I' means not allowed to operate; missing census = keep (L&I
 *  active broker authority already implies allowed to broker). */
export function censusAllowsOperate(census: CensusRow | undefined): boolean {
  if (!census) return true;
  return census.status_code !== 'I';
}

/**
 * Normalize one L&I broker row (+ optional census match) into an upsert payload.
 * Returns null when the row is NOT an active property broker, is not allowed to
 * operate, or has no usable legal/dba name (legal_name is NOT NULL).
 */
export function normalizeBroker(
  li: LiCarrierRow,
  census: CensusRow | undefined,
): UpsertLeadInput | null {
  if (!isActivePropertyBroker(li)) return null;
  if (!censusAllowsOperate(census)) return null;

  const legalName = cleanStr(li.legal_name) ?? cleanStr(census?.legal_name) ?? cleanStr(li.dba_name);
  if (!legalName) return null; // legal_name is NOT NULL

  return {
    mcNumber: normalizeMc(li.docket_number),
    dotNumber: normalizeDot(li.dot_number ?? census?.dot_number),
    legalName,
    dbaName: cleanStr(li.dba_name),
    phone: normalizePhone(census?.phone) ?? normalizePhone(li.bus_telno),
    addrStreet: cleanStr(census?.phy_street) ?? cleanStr(li.bus_street_po),
    addrCity: cleanStr(census?.phy_city) ?? cleanStr(li.bus_city),
    addrState: (cleanStr(census?.phy_state) ?? cleanStr(li.bus_state_code))?.toUpperCase() ?? null,
    addrZip: cleanStr(census?.phy_zip) ?? cleanStr(li.bus_zip_code),
    censusEmail: normalizeEmail(census?.email_address),
    powerUnits: toInt(census?.power_units),
    segment: 'broker',
  };
}

/**
 * Filter + normalize a page of L&I rows against a census lookup (keyed by
 * NORMALIZED dot number). Pure — this is the unit under test.
 */
export function filterAndNormalizeBrokers(
  liRows: LiCarrierRow[],
  censusByDot: Map<string, CensusRow>,
): UpsertLeadInput[] {
  const out: UpsertLeadInput[] = [];
  for (const li of liRows) {
    const dot = normalizeDot(li.dot_number);
    const census = dot ? censusByDot.get(dot) : undefined;
    const lead = normalizeBroker(li, census);
    if (lead) out.push(lead);
  }
  return out;
}

// ─── Network (Socrata JSON API) ───────────────────────────────────────────
async function socrataJson<T>(resource: string, params: Record<string, string>): Promise<T[]> {
  const qs = new URLSearchParams(params).toString();
  const url = `${SOCRATA_BASE}/${resource}.json?${qs}`;
  const res = await fetch(url, { headers: { 'User-Agent': FETCH_UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Socrata ${resource} ${res.status}: ${await res.text().catch(() => '')}`);
  return (await res.json()) as T[];
}

/** One page of active property brokers, ordered by docket_number for stable paging. */
export async function fetchBrokerPage(offset: number, limit: number): Promise<LiCarrierRow[]> {
  return socrataJson<LiCarrierRow>(LI_CARRIER_ID, {
    $select: 'docket_number,dot_number,broker_stat,property_chk,hhg_chk,legal_name,dba_name,bus_street_po,bus_city,bus_state_code,bus_zip_code,bus_telno',
    $where: BROKER_WHERE,
    $order: 'docket_number',
    $limit: String(limit),
    $offset: String(offset),
  });
}

/** Census rows for a batch of NORMALIZED dot numbers → Map keyed by normalized dot. */
export async function fetchCensusByDots(dots: string[]): Promise<Map<string, CensusRow>> {
  const map = new Map<string, CensusRow>();
  const unique = [...new Set(dots.filter(Boolean))];
  if (unique.length === 0) return map;
  // Chunk the IN() list so the URL stays well under limits.
  const CHUNK = 200;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const inList = chunk.map((d) => `'${d}'`).join(',');
    const rows = await socrataJson<CensusRow>(CENSUS_ID, {
      $select: 'dot_number,legal_name,email_address,power_units,phone,status_code,phy_street,phy_city,phy_state,phy_zip',
      $where: `dot_number in (${inList})`,
      $limit: String(chunk.length),
    });
    for (const r of rows) {
      const dot = normalizeDot(r.dot_number);
      if (dot) map.set(dot, r);
    }
  }
  return map;
}

// ─── Ingest orchestrator ──────────────────────────────────────────────────
export interface IngestOptions {
  limit: number; // 0 = no cap
  offset: number;
  pageSize: number;
  dryRun: boolean;
}

export interface IngestSummary {
  brokersSeen: number;
  ingested: number;
  withCensusEmail: number;
  topStates: Array<[string, number]>;
}

export async function runIngest(
  opts: IngestOptions,
  store: LeadStore = dbLeadStore,
  deps: {
    fetchBrokers?: typeof fetchBrokerPage;
    fetchCensus?: typeof fetchCensusByDots;
    log?: (msg: string) => void;
  } = {},
): Promise<IngestSummary> {
  const fetchBrokers = deps.fetchBrokers ?? fetchBrokerPage;
  const fetchCensus = deps.fetchCensus ?? fetchCensusByDots;
  const log = deps.log ?? ((m: string) => console.log(m));

  let brokersSeen = 0;
  let ingested = 0;
  let withCensusEmail = 0;
  const stateCounts = new Map<string, number>();
  let offset = opts.offset;

  for (;;) {
    if (opts.limit > 0 && ingested >= opts.limit) break;
    const liRows = await fetchBrokers(offset, opts.pageSize);
    if (liRows.length === 0) break;
    brokersSeen += liRows.length;

    const dots = liRows.map((r) => normalizeDot(r.dot_number)).filter((d): d is string => !!d);
    const censusByDot = await fetchCensus(dots);
    const leads = filterAndNormalizeBrokers(liRows, censusByDot);

    for (const lead of leads) {
      if (opts.limit > 0 && ingested >= opts.limit) break;
      if (lead.censusEmail) withCensusEmail += 1;
      if (lead.addrState) stateCounts.set(lead.addrState, (stateCounts.get(lead.addrState) ?? 0) + 1);
      if (!opts.dryRun) await store.upsert(lead);
      ingested += 1;
    }

    log(`  …offset ${offset}: +${leads.length} brokers (running total ${ingested}, email ${withCensusEmail})`);
    offset += liRows.length;
    if (liRows.length < opts.pageSize) break; // last page
  }

  const topStates = [...stateCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  return { brokersSeen, ingested, withCensusEmail, topStates };
}

// ─── CLI ──────────────────────────────────────────────────────────────────
function parseArgs(argv: string[]): IngestOptions {
  const has = (f: string) => argv.includes(f);
  const val = (f: string, d: number): number => {
    const i = argv.indexOf(f);
    if (i === -1 || i + 1 >= argv.length) return d;
    const n = Number.parseInt(argv[i + 1], 10);
    return Number.isFinite(n) ? n : d;
  };
  const sample = has('--sample');
  return {
    limit: val('--limit', sample ? 500 : 0),
    offset: val('--offset', 0),
    pageSize: val('--page', 1000),
    dryRun: has('--dry-run'),
  };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  console.log(
    `[ingest] FMCSA active property brokers → broker_leads ` +
      `(limit=${opts.limit || 'ALL'}, offset=${opts.offset}, page=${opts.pageSize}${opts.dryRun ? ', DRY-RUN' : ''})`,
  );
  const t0 = Date.now();
  const s = await runIngest(opts);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const pct = s.ingested ? ((100 * s.withCensusEmail) / s.ingested).toFixed(1) : '0.0';
  console.log('\n[ingest] DONE in ' + secs + 's');
  console.log(`  brokers ingested : ${s.ingested}`);
  console.log(`  with census email: ${s.withCensusEmail} (${pct}%)`);
  console.log(`  top states       : ${s.topStates.map(([st, c]) => `${st}=${c}`).join('  ') || '(none)'}`);
}

// Run only when invoked directly (not when imported by the test).
const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('ingestFmcsaCensus.ts');
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
