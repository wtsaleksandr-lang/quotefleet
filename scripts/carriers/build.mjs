/**
 * BUILD THE CARRIER NAME INDEX — company autosuggest with no database and no API.
 *
 * WHY NOT JUST QUERY `carrier_directory`. The table is right there with the same
 * data in it, and querying it per keystroke is exactly the mistake that took
 * production down on 2026-09-08: sustained load against the directory saturated
 * the aggregate limiter, which starved the platform health probe, which
 * restarted the VM every 15 minutes for a day. Company autosuggest fires on
 * every keypress of every signup. Pointing that at the same table would be
 * re-creating the outage on purpose.
 *
 * A committed index costs nothing to serve, cannot contend with anything, and
 * keeps working when the database is down — which is the condition this app is
 * explicitly built to survive.
 *
 * THE SOURCE is the same public FMCSA Licensing & Insurance dataset that
 * `src/server/directory/carrierIngest.ts` already ingests, filtered the same
 * way: active common or contract authority, property carriers. Public domain,
 * no key, no quota. Building from the source rather than from our own table
 * means this script never touches production at all.
 *
 * RUN IT OFFLINE AND COMMIT THE RESULT:
 *     node scripts/carriers/build.mjs
 *
 * WHY THE OUTPUT IS DELIBERATELY LEAN. There are ~370,000 active property
 * carriers. Every byte per row is ~370 KB on disk and rather more in memory, so
 * the row is name, state, city and DOT number — the four things a person needs
 * to recognise their own company in a list and nothing else. The DOT number is
 * the payload: a carrier picking themselves at signup hands us their verified
 * FMCSA identity, which is worth more than the autocomplete itself.
 *
 * TWO THINGS THE FIRST VERSION GOT WRONG, both found by trying real queries.
 *
 * "jb hunt" RETURNED NOTHING. FMCSA stores the name as "J B HUNT", so a plain
 * prefix match against the display name fails on every company whose punctuation
 * or spacing a person does not reproduce exactly — and carrier names are full of
 * it ("J.B.", "&", ",", "INC."). Each row therefore carries a NORMALISED SEARCH
 * KEY with punctuation and spaces stripped, and the file is sorted by that key
 * so the reader can binary-search it. "jbhunt", "j b hunt" and "J.B. Hunt" all
 * land in the same place.
 *
 * "schneider" RETURNED Schneider Brothers Trucking AND Schneider Cattle
 * Trucking, and not Schneider National. Alphabetical order is the least
 * surprising rule in the abstract and the wrong one here: the person typing a
 * well-known carrier's name means the well-known carrier. Matches are ranked by
 * ASCENDING DOT NUMBER instead — FMCSA has issued them sequentially since the
 * 1980s, so a low number is a long-established carrier. The ordering note above
 * the sort below records what that replaced and why.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const SOCRATA = 'https://data.transportation.gov/resource/6eyk-hxee.json';
const CENSUS = 'https://data.transportation.gov/resource/az4n-8mr2.json';
const WHERE = "(common_stat='A' OR contract_stat='A') AND property_chk='Y'";
const UA = 'QuoteFleetDirectoryBot/1.0 (+https://quotefleet.net/bot)';
const PAGE = 50_000;
const SEP = String.fromCharCode(9);
const EOL = String.fromCharCode(10);

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT_DIR = path.join(ROOT, 'assets', 'carriers');
const CACHE = path.join(OUT_DIR, '.cache');

/** Title-case a SHOUTED legal name without destroying real capitalisation. */
function tidyName(raw) {
  const s = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!s) return '';
  // FMCSA stores legal names in upper case. Lower-casing wholesale would turn
  // "JB HUNT" into "Jb Hunt", so short all-caps tokens that look like initials
  // or common carrier abbreviations are left alone.
  const KEEP_UPPER = new Set([
    'LLC', 'INC', 'LTD', 'LP', 'LLP', 'PLC', 'CO', 'DBA', 'USA', 'US', 'LC',
    'PC', 'II', 'III', 'IV', 'JR', 'SR', 'TX', 'CA', 'NY', 'FL', 'AZ', 'AL',
  ]);
  return s
    .split(' ')
    .map((w) => {
      const bare = w.replace(/[^A-Za-z]/g, '');
      if (KEEP_UPPER.has(bare.toUpperCase())) return w.toUpperCase();
      // Two letters or fewer with no vowel reads as initials — "JB", "TL".
      if (bare.length <= 2 && !/[AEIOU]/i.test(bare)) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ');
}

async function fetchPage(offset) {
  const url =
    `${SOCRATA}?$select=legal_name,dot_number,bus_city,bus_state_code` +
    `&$where=${encodeURIComponent(WHERE)}` +
    `&$order=dot_number&$limit=${PAGE}&$offset=${offset}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`FMCSA page at offset ${offset}: HTTP ${res.status}`);
  return res.json();
}

/**
 * The key the index is SORTED and SEARCHED by. Case, punctuation and spacing all
 * removed, so what a person types finds what FMCSA stored regardless of how
 * either wrote it.
 */
function searchKey(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

fs.mkdirSync(CACHE, { recursive: true });
const rawPath = path.join(CACHE, 'li_carriers.json');

let rows;
if (fs.existsSync(rawPath)) {
  process.stdout.write('using cached FMCSA download\n');
  rows = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
} else {
  rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await fetchPage(offset);
    rows.push(...page);
    process.stdout.write(`  fetched ${rows.length}\n`);
    if (page.length < PAGE) break;
  }
  fs.writeFileSync(rawPath, JSON.stringify(rows));
}

const seen = new Set();
const out = [];
let noName = 0;
let duplicate = 0;

for (const r of rows) {
  const name = tidyName(r.legal_name);
  const dot = String(r.dot_number || '').trim();
  const key = searchKey(name);
  if (!name || !dot || !key) { noName += 1; continue; }
  // One row per DOT number. The L&I file can carry a carrier more than once
  // across authority types, and a list that offers the same company twice looks
  // broken to the person trying to find themselves in it.
  if (seen.has(dot)) { duplicate += 1; continue; }
  seen.add(dot);
  out.push({
    key,
    name,
    state: String(r.bus_state_code || '').trim().toUpperCase(),
    city: tidyName(r.bus_city),
    dot,
  });
}

/*
 * SORTED BY THE NORMALISED KEY — that is what the reader binary-searches — and
 * ties broken by ASCENDING DOT NUMBER.
 *
 * The DOT number is the ranking signal, and it is free because it is already in
 * this file. FMCSA has issued them sequentially since the 1980s, so a low number
 * means a long-established carrier, which correlates well enough with the one a
 * person typing a shared name actually means:
 *
 *   Old Dominion Freight Line        90,849
 *   Estes Express Lines             121,018
 *   Schneider National Bulk         164,311
 *   Schneider Cattle Trucking     1,309,402
 *   Schneider Brothers Trucking   2,919,971
 *
 * The first attempt at this joined the FMCSA CENSUS file for `power_units`,
 * which is a truer measure of fleet size. It was abandoned rather than
 * shipped: the census covers every registered entity (2.45M rows, Socrata
 * returns HTTP 500 at deep offsets) and `power_units` is stored as TEXT, so it
 * cannot even be ordered numerically server-side. A fragile cross-dataset join
 * for a slightly better proxy is a bad trade against a signal already sitting in
 * the row.
 */
out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : Number(a.dot) - Number(b.dot)));

/*
 * SANITY CHECKS ON REAL CARRIERS, not on the row count. The count moves every
 * time FMCSA republishes; what must not change is that a household-name carrier
 * is findable by typing its name.
 */
const matching = (needle) => {
  const k = searchKey(needle);
  return out.filter((c) => c.key.startsWith(k));
};
for (const probe of ['Schneider', 'Werner', 'Knight', 'Swift', 'Old Dominion', 'JB Hunt']) {
  if (matching(probe).length === 0) {
    throw new Error(
      `Sanity check: nothing matches "${probe}". The FMCSA filter, the name ` +
        'tidier or the search key is wrong — do not ship an index that cannot ' +
        'find the largest carriers in the country.',
    );
  }
}

/*
 * AND THE ESTABLISHED CARRIER MUST LEAD ITS PREFIX. This check would have caught
 * the original pure-alphabetical ordering, which answered "schneider" with
 * Schneider Brothers Trucking and Schneider Cattle Trucking while Schneider
 * National sat thousands of rows away.
 */
for (const [probe, expectDotBelow] of [
  ['Schneider', 1_000_000],
  ['Old Dominion', 1_000_000],
  ['Estes Express', 1_000_000],
]) {
  /*
   * Ranked THE WAY THE READER RANKS, which is the only check worth making. The
   * file is sorted by key so it can be binary-searched, and within a prefix that
   * ordering is alphabetical on the FULL key — "schneiderbrothers" precedes
   * "schneidernational", so the file's own tie-break never fires for a prefix
   * query. Ranking by registration age therefore belongs to the reader, which
   * collects a prefix's matches and orders them before returning the top few.
   * An earlier version of this check read the file order directly and failed,
   * correctly, for exactly that reason.
   */
  const top = matching(probe).sort((a, b) => Number(a.dot) - Number(b.dot))[0];
  if (!top || Number(top.dot) >= expectDotBelow) {
    throw new Error(
      `Ranking check: "${probe}" leads with ${top ? `${top.name} (DOT ${top.dot})` : 'nothing'}, ` +
        `expected a DOT below ${expectDotBelow}. The tie-break is not ordering by ` +
        'registration age, so a prefix would bury the carrier the user meant.',
    );
  }
}

const body = out.map((c) => [c.key, c.name, c.state, c.city, c.dot].join(SEP)).join(EOL);
const gz = zlib.gzipSync(Buffer.from(body, 'utf8'), { level: 9 });

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'carriers.bin.gz'), gz);
fs.writeFileSync(
  path.join(OUT_DIR, 'carriers.manifest.json'),
  `${JSON.stringify(
    {
      format: 'CARRIERS2',
      sourceUrl: SOCRATA,
      sourceFilter: WHERE,
      licence:
        'FMCSA Licensing & Insurance, via data.transportation.gov — US federal government open data, public domain.',
      builtBy: 'scripts/carriers/build.mjs',
      carrierCount: out.length,
      droppedNoNameOrDot: noName,
      droppedDuplicateDot: duplicate,
      uncompressedBytes: body.length,
      gzipBytes: gz.length,
      sha256: crypto.createHash('sha256').update(gz).digest('hex'),
    },
    null,
    2,
  )}\n`,
);

process.stdout.write(
  `carriers: ${out.length} active property carriers, ` +
    `${(body.length / 1e6).toFixed(1)} MB -> ${(gz.length / 1e6).toFixed(1)} MB gzipped\n`,
);
