/**
 * THE canonical cached Importer-Search dataset.
 *
 * One committed fixture shared by tests, visual gates and the local seed script
 * (`scratchpad/seed_importer_cache.mjs`), so nothing ever has to spend a real
 * ImportYeti credit to have importer data on screen. Before this existed, each
 * gate re-derived its own rows or — worse — ran a live pull.
 *
 * Shape note: these are RAW ImportYeti BOL rows (the `data.data[]` element
 * shape), i.e. exactly what `importer_bol_cache.rows` stores, so the same
 * fixture drives `pullImportBols` stubs, `BolCacheStore` doubles and the DB
 * cache seeder without translation.
 *
 * DELIBERATELY DB-FREE and dependency-free — safe to import from a pure unit
 * test without dragging in the DB layer.
 */
import type { BolRow, BolCacheLike } from './importerLeads.js';

/** The port every fixture search row enters through. */
export const FIXTURE_ENTRY_PORT = 'Savannah, GA';
/** The company whose full history the profile fixture covers. */
export const FIXTURE_PROFILE_SLUG = 'robert-bosch-tool';
/** Filters that produce the search fixture (for computing its cache key). */
export const FIXTURE_SEARCH_FILTERS = { entryPort: FIXTURE_ENTRY_PORT } as const;

interface RowSpec {
  name: string;
  base?: string;
  slug: string;
  addr: string;
  state?: string;
  ships12m: number;
  total: number;
  teu12m: number;
  phone?: string;
  since?: string;
  supplier: string;
  sc: string;
  product: string;
  hs: string;
  incumbent?: string;
  date?: string;
  bol?: string;
  exit?: string;
  scac?: string;
  cont?: string;
}

/** Build one raw ImportYeti-shaped BOL row. Deterministic (no randomness) so a
 *  snapshot / screenshot of the fixture is stable across runs. */
function row(o: RowSpec, seq: number): BolRow {
  return {
    company_name: o.name,
    company_basename: o.base ?? o.name,
    company_link: `/company/${o.slug}`,
    company_address: o.addr,
    company_state: o.state ?? null,
    company_country_code: 'US',
    company_shipments_12m: o.ships12m,
    company_total_shipments: o.total,
    company_teu_12m: o.teu12m,
    company_main_phone_number: o.phone ?? '912-555-0100',
    company_first_shipment_date: o.since ?? '01/2019',
    supplier_name: o.supplier,
    supplier_basename: o.supplier,
    supplier_country_code: o.sc,
    product_description: o.product,
    hs_code: o.hs,
    hs_code_description: o.product,
    entry_port: 'Savannah, Ga.',
    exit_port: o.exit ?? null,
    arrival_date: o.date ?? '07/31/2026',
    bol_number: o.bol ?? `FIXTURE${String(seq).padStart(4, '0')}`,
    notify_party_name: o.incumbent ?? null,
    carrier_scac_code: o.scac ?? 'HLCU',
    container_types: o.cont ?? '40ft',
    weight: 8100,
    quantity: 600,
    quantity_unit: 'pkg',
    containers_count: 1,
  };
}

const SEARCH_SPECS: RowSpec[] = [
  { name: 'Robert Bosch Tool Corp', slug: 'robert-bosch-tool', addr: '1980 Indian Creek Rd, Lincolnton, NC 28092', state: 'NC', ships12m: 10761, total: 169818, teu12m: 18910, supplier: 'Scintilla AG', sc: 'DE', product: 'Saw blades & parts', hs: '820299', incumbent: 'Expeditors Intl' },
  { name: 'Komatsu America Corp', slug: 'komatsu-america', addr: '535 Mawsons Way, Newberry, SC 29108', state: 'SC', ships12m: 6644, total: 68033, teu12m: 19715, supplier: 'Komatsu Changzhou Construction', sc: 'CN', product: 'Wheel-loader frames & booms', hs: '843149' },
  { name: 'Axis Communications Inc', slug: 'axis-communications', addr: '4535 Hamilton Mill Rd, Buford, GA 30518', state: 'GA', ships12m: 1010, total: 7277, teu12m: 1487, supplier: 'Axis Communications AB', sc: 'DE', product: 'Network video recorders', hs: '853890', incumbent: 'Scanfil Logistics' },
  { name: 'Premier Specialty Brands', slug: 'premier-specialty-brands', addr: '5367 New Peachtree Rd, Chamblee, GA 30341', state: 'GA', ships12m: 331, total: 3384, teu12m: 1235, supplier: 'Guangdong Canbo Electrical', sc: 'CN', product: 'Gas / charcoal grills', hs: '732111' },
  { name: 'Orafol America Inc', slug: 'orafol-america', addr: '1100 Oracal Pkwy, Black Creek, GA 31308', state: 'GA', ships12m: 151, total: 1526, teu12m: 319, supplier: 'Orafol Europe GmbH', sc: 'DE', product: 'Adhesive films & papers', hs: '391990' },
  { name: 'Mahlo America Inc', slug: 'mahlo-america', addr: '575 Simuel Rd, Spartanburg, SC 29303', state: 'SC', ships12m: 29, total: 414, teu12m: 35, supplier: 'Mahlo GmbH & Co KG', sc: 'DE', product: 'Textile measuring equipment', hs: '903120', incumbent: 'Milliken & Company' },
];

/**
 * ALIAS variants — extra bills filed by importers already in SEARCH_SPECS under
 * a different name spelling and/or a different address. They share
 * `company_basename` with their parent, so `dedupImporters` collapses them and
 * the importer COUNT is unchanged; what they add is the raw material for the
 * "Also under N names · M addresses" card sub-line, which is derived from the
 * pre-dedup rows (see `aliasCountsByCompany`).
 *
 * `ships12m` is kept BELOW the parent row's so dedup always keeps the parent as
 * the displayed row — the card content stays byte-for-byte what it was.
 */
const ALIAS_SPECS: RowSpec[] = [
  { name: 'Robert Bosch Tool Corporation', base: 'Robert Bosch Tool Corp', slug: 'robert-bosch-tool', addr: '2300 S Watney Way, Ste A, Lincolnton, NC 28092', state: 'NC', ships12m: 9800, total: 169818, teu12m: 18910, supplier: 'Scintilla AG', sc: 'DE', product: 'Saw blades & parts', hs: '820299', incumbent: 'Expeditors Intl' },
  { name: 'Bosch Tool Corp', base: 'Robert Bosch Tool Corp', slug: 'robert-bosch-tool', addr: '1980 Indian Creek Rd, Lincolnton, NC 28092', state: 'NC', ships12m: 9100, total: 169818, teu12m: 18910, supplier: 'Robert Bosch GmbH', sc: 'DE', product: 'Drill bits', hs: '820750', incumbent: 'Expeditors Intl' },
  { name: 'Premier Specialty Brands LLC', base: 'Premier Specialty Brands', slug: 'premier-specialty-brands', addr: '4110 Buford Hwy NE, Atlanta, GA 30345', state: 'GA', ships12m: 300, total: 3384, teu12m: 1235, supplier: 'Guangdong Canbo Electrical', sc: 'CN', product: 'Gas / charcoal grills', hs: '732111' },
];

/** The SEARCH result set: six distinct real-shaped importers entering Savannah,
 *  plus a few alias bills for two of them. None trips `isForwarder`, so all six
 *  importers survive dedup. */
export const FIXTURE_SEARCH_ROWS: readonly BolRow[] = [
  ...SEARCH_SPECS.map((s, i) => row(s, i)),
  ...ALIAS_SPECS.map((s, i) => row(s, 50 + i)),
];

/** Distinct importers the search fixture collapses to (rows > importers now that
 *  the fixture carries alias bills). Asserted by the cost-guard test. */
export const FIXTURE_SEARCH_IMPORTERS = SEARCH_SPECS.length;

// ── profile history for FIXTURE_PROFILE_SLUG ────────────────────────────────
// Deliberately includes ImportYeti's signature alias variants (several name
// spellings + several addresses for the same importer) so the profile page's
// "N names on file" / "other addresses" rendering has real data to exercise.
const PROFILE_NAMES = [
  'Robert Bosch Tool Corp',
  'Robert Bosch Tool Corporation',
  'Bosch Tool Corp',
  'Robert Bosch Tool Corp.',
];
const PROFILE_ADDRS = [
  '1980 Indian Creek Rd, Lincolnton, NC 28092',
  '2300 S Watney Way, Ste A, Lincolnton, NC 28092',
  'Robert Bosch Tool Corp, Mt Prospect, IL 60056',
];
const PROFILE_SUPPLIERS = [
  { supplier: 'Scintilla AG', sc: 'CH', hs: '820299', product: 'Saw blades & parts' },
  { supplier: 'Robert Bosch GmbH', sc: 'DE', hs: '820750', product: 'Drill bits' },
  { supplier: 'Bosch Power Tools', sc: 'CN', hs: '846790', product: 'Power-tool parts' },
];
const PROFILE_DATES = [
  '01/12/2026', '02/09/2026', '03/15/2026', '04/20/2026',
  '05/18/2026', '06/22/2026', '07/26/2026', '07/31/2026',
];
const PROFILE_EXITS = ['Genova', 'Bremerhaven', 'Yantian'];

/** The PROFILE history: eight bills across six months, three suppliers, with
 *  alias name/address variants. */
export const FIXTURE_PROFILE_ROWS: readonly BolRow[] = PROFILE_DATES.map((date, i) => {
  const sup = PROFILE_SUPPLIERS[i % PROFILE_SUPPLIERS.length];
  return row(
    {
      name: PROFILE_NAMES[i % PROFILE_NAMES.length],
      base: 'Robert Bosch Tool Corp',
      slug: FIXTURE_PROFILE_SLUG,
      addr: PROFILE_ADDRS[i % PROFILE_ADDRS.length],
      state: 'NC',
      ships12m: 10761,
      total: 169818,
      teu12m: 18910,
      incumbent: 'Expeditors Intl',
      date,
      bol: `BOSCH${i}`,
      exit: PROFILE_EXITS[i % PROFILE_EXITS.length],
      ...sup,
    },
    100 + i,
  );
});

/** Provider-reported credit balance stored alongside the seeded rows. */
export const FIXTURE_CREDITS_REMAINING = 999;

// ── helpers ─────────────────────────────────────────────────────────────────
/**
 * An in-memory `BolCacheStore` pre-loaded with the fixture. Key-agnostic by
 * default (any `get` is a hit) so a test does not have to reproduce the caller's
 * cache-key derivation just to prove the CACHE path — which is exactly the path
 * the cost guard leaves available.
 */
export function fixtureBolCache(
  opts: { rows?: readonly BolRow[]; fetchedAt?: Date; keyed?: boolean } = {},
): BolCacheLike & { puts: Array<{ key: string; rows: BolRow[] }>; map: Map<string, BolRow[]> } {
  const rows = [...(opts.rows ?? FIXTURE_SEARCH_ROWS)];
  const fetchedAt = opts.fetchedAt ?? new Date();
  const map = new Map<string, BolRow[]>();
  const puts: Array<{ key: string; rows: BolRow[] }> = [];
  return {
    map,
    puts,
    async get(key: string) {
      if (opts.keyed) {
        const hit = map.get(key);
        return hit ? { rows: hit, creditsRemaining: FIXTURE_CREDITS_REMAINING, fetchedAt } : null;
      }
      return { rows, creditsRemaining: FIXTURE_CREDITS_REMAINING, fetchedAt };
    },
    async put(key: string, r: BolRow[]) {
      map.set(key, r);
      puts.push({ key, rows: r });
    },
  };
}

/**
 * Seed BOTH fixture entries into any `BolCacheStore` (the DB-backed one from the
 * local seed script, or an in-memory one). Keys are passed in so this module
 * stays free of the cache/profile modules (and therefore of the DB).
 */
export async function seedFixtureCache(
  store: BolCacheLike,
  keys: { searchKey: string; profileKey: string },
): Promise<void> {
  await store.put(keys.searchKey, [...FIXTURE_SEARCH_ROWS], FIXTURE_CREDITS_REMAINING);
  await store.put(keys.profileKey, [...FIXTURE_PROFILE_ROWS], FIXTURE_CREDITS_REMAINING);
}
