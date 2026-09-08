/**
 * BUILD THE US PLACE INDEX — the data behind address autosuggest, at $0.
 *
 * WHY THIS EXISTS RATHER THAN A PLACES API KEY.
 * --------------------------------------------
 * WeFixTrades uses Google Places Autocomplete, which bills per request when no
 * session token is supplied. QuoteFleet does not need it, and not as a
 * cost-saving compromise: an OS/OW permit is priced PER STATE, and the lane
 * mileage comes from the Census geocoder that `src/calc/heavyHaul/geocode.ts`
 * already calls for free. Street-level precision changes no number on the
 * quote. What the dispatcher actually needs while typing is "did I mean Buffalo
 * NY or Buffalo TX", and that is a city-and-state question.
 *
 * Answered from a static index, the suggestion is also strictly better than the
 * paid one for this job: it returns in under a millisecond with no network hop
 * per keystroke, it works with the database down, it sends no keystrokes to a
 * third party, and it cannot offer a place in a state the engine does not
 * cover.
 *
 * THE SOURCE. US Census Bureau 2024 Gazetteer, places file — a work of the US
 * federal government and public domain under 17 U.S.C. § 105, the same family
 * and the same licence as the TIGER road network already committed under
 * `assets/tiger/`. 32,334 rows in, one row per incorporated place and census
 * designated place.
 *
 * RUN IT OFFLINE AND COMMIT THE RESULT:
 *     node scripts/places/build.mjs
 * The server never builds this. It reads `assets/places/usplaces.bin.gz`, the
 * same arrangement as `usnet.bin.gz` — see `src/calc/heavyHaul/usnet.ts`.
 *
 * WHAT GETS DROPPED, AND WHY EACH ONE
 * -----------------------------------
 *  - PUERTO RICO AND THE TERRITORIES. The OS/OW calculator already refuses a
 *    territory leg with "not reachable by road from the mainland, so it is not
 *    offered on the form either". A suggestion list that offers what the form
 *    rejects is two surfaces disagreeing about the product.
 *  - THE LSAD SUFFIX. The Gazetteer writes "Buffalo city", "Buffalo Gap town",
 *    "Abanda CDP". Only the FINAL token is a descriptor, so "New York Mills
 *    village" must become "New York Mills" and not "New York" — the strip is
 *    anchored to the end and matched against the closed set of descriptors the
 *    file actually uses, counted rather than assumed.
 *
 * RANKING. The Gazetteer carries no population, so prominence is approximated
 * from two things it does carry: the legal class (a `city` outranks a `town`,
 * which outranks a `CDP`) and land area. That is a proxy, and it is checked
 * against the cases that matter rather than trusted — the build asserts that
 * Buffalo NY beats Buffalo TX and Houston TX beats every other Houston, which
 * are exactly the collisions a freight dispatcher hits.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const VINTAGE = '2024';
const SOURCE_URL = `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/${VINTAGE}_Gazetteer/${VINTAGE}_Gaz_place_national.zip`;

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT_DIR = path.join(ROOT, 'assets', 'places');
const CACHE = path.join(OUT_DIR, '.cache');

/**
 * The fifty states plus DC. Deliberately NOT `US_STATE_CODES` from the
 * directory, which carries PR, VI and GU — see the header.
 */
const STATES = new Set(
  ('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS ' +
    'MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY')
    .split(' '),
);

/**
 * EVERY TRAILING DESCRIPTOR THE FILE ACTUALLY USES, LONGEST PHRASE FIRST.
 *
 * The first version of this stripped a single trailing token, and the build's
 * own guard caught it on "Lexington-Fayette urban county" — a TWO-WORD
 * descriptor that would have shipped as "Lexington-Fayette urban". Fourteen
 * rows carry multi-word descriptors and they are not obscure: they are the
 * consolidated city-county governments, which include Indianapolis, Nashville,
 * Louisville, Anchorage, Athens, Augusta and Lexington. Getting them wrong
 * would mangle the name of a major freight destination in each case.
 *
 * Order matters and is longest-first, so "metropolitan government (balance)" is
 * matched before "government" or "(balance)" can take a bite out of it.
 */
const LSAD_SUFFIXES = [
  'unified government (balance)',
  'consolidated government (balance)',
  'metropolitan government (balance)',
  'metro government (balance)',
  'urban county government',
  'unified government',
  'consolidated government',
  'metropolitan government',
  'metro government',
  'urban county',
  'city (balance)',
  '(balance)',
  'municipality',
  'corporation',
  'township',
  'comunidad',
  'village',
  'borough',
  'urbana',
  'city',
  'town',
  'CDP',
];

/**
 * `city` reads as more prominent than `CDP`; used only for ranking. The
 * consolidated-government forms are all cities in substance, so they rank with
 * cities rather than falling to zero.
 */
const CLASS_RANK = {
  city: 4,
  'city (balance)': 4,
  'metropolitan government (balance)': 4,
  'metro government (balance)': 4,
  'consolidated government (balance)': 4,
  'unified government (balance)': 4,
  'metropolitan government': 4,
  'metro government': 4,
  'consolidated government': 4,
  'unified government': 4,
  'urban county government': 4,
  'urban county': 4,
  municipality: 4,
  corporation: 3,
  town: 3,
  borough: 3,
  '(balance)': 3,
  village: 2,
  township: 2,
  CDP: 1,
};

function stripSuffix(name) {
  const trimmed = name.trim();
  for (const suffix of LSAD_SUFFIXES) {
    if (trimmed.length > suffix.length + 1 && trimmed.endsWith(` ${suffix}`)) {
      return { display: trimmed.slice(0, -(suffix.length + 1)).trim(), klass: suffix };
    }
  }
  return { display: trimmed, klass: '' };
}

/**
 * READ THE ONE ENTRY OUT OF THE ARCHIVE, WITHOUT A DEPENDENCY.
 *
 * The first attempt shelled out to `tar`, which reads zips on most platforms
 * and exited 128 on this one. A once-a-year build step is not worth a package,
 * and it is not worth being platform-dependent either: the Gazetteer archive
 * holds a single deflated member, so the local file header is enough.
 *
 * Layout (PKZIP APPNOTE 4.3.7): signature PK, then the compression
 * method at offset 8, the compressed size at 18, and two lengths at 26 and 28
 * that say how far past the 30-byte header the payload starts.
 */
function unzipSingleEntry(buf) {
  if (buf.readUInt32LE(0) !== 0x04034b50) {
    throw new Error('Not a zip archive — the Gazetteer download is corrupt or redirected.');
  }
  const method = buf.readUInt16LE(8);
  let size = buf.readUInt32LE(18);
  const nameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  const start = 30 + nameLen + extraLen;
  // A streamed zip writes zero here and puts the real size in a trailing data
  // descriptor. Inflating to the central directory is correct either way.
  if (size === 0) {
    const cd = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), start);
    size = (cd < 0 ? buf.length : cd) - start;
  }
  const body = buf.subarray(start, start + size);
  if (method === 0) return body;
  if (method === 8) return zlib.inflateRawSync(body);
  throw new Error(`Unsupported zip compression method ${method}.`);
}

async function fetchGazetteer() {
  fs.mkdirSync(CACHE, { recursive: true });
  const zipPath = path.join(CACHE, `gaz_place_${VINTAGE}.zip`);
  if (!fs.existsSync(zipPath)) {
    process.stdout.write(`downloading ${SOURCE_URL}\n`);
    const res = await fetch(SOURCE_URL);
    if (!res.ok) throw new Error(`Gazetteer download failed: HTTP ${res.status}`);
    fs.writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
  }
  const txtPath = path.join(CACHE, `${VINTAGE}_Gaz_place_national.txt`);
  if (!fs.existsSync(txtPath)) {
    fs.writeFileSync(txtPath, unzipSingleEntry(fs.readFileSync(zipPath)));
  }
  return fs.readFileSync(txtPath, 'utf8');
}

const raw = await fetchGazetteer();
const lines = raw.split('\n');
const header = lines[0].split('\t').map((h) => h.trim());
const col = (n) => {
  const i = header.indexOf(n);
  if (i < 0) throw new Error(`Gazetteer column ${n} missing — the file layout changed.`);
  return i;
};
const [cUsps, cName, cLand, cLat, cLng] = [
  col('USPS'), col('NAME'), col('ALAND'), col('INTPTLAT'), col('INTPTLONG'),
];

const seenSuffix = new Map();
const rows = [];
let skippedTerritory = 0;

for (let i = 1; i < lines.length; i += 1) {
  const f = lines[i].split('\t');
  if (f.length <= cLng) continue;
  const usps = f[cUsps].trim();
  if (!STATES.has(usps)) { skippedTerritory += 1; continue; }
  const { display, klass } = stripSuffix(f[cName]);
  if (klass) seenSuffix.set(klass, (seenSuffix.get(klass) ?? 0) + 1);
  const lat = Number(f[cLat]);
  const lng = Number(f[cLng]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
  rows.push({
    name: display,
    state: usps,
    lat: Math.round(lat * 10000) / 10000,
    lng: Math.round(lng * 10000) / 10000,
    rank: (CLASS_RANK[klass] ?? 0) * 1e12 + Number(f[cLand] || 0),
  });
}

/**
 * ANY DESCRIPTOR NOT IN THE LIST IS A BUILD FAILURE, not a warning. An unknown
 * trailing token means the vintage introduced a class we do not strip, and the
 * symptom would be a suggestion list quietly showing "Fooville municipality".
 */
const unknown = [];
for (let i = 1; i < lines.length; i += 1) {
  const f = lines[i].split('\t');
  if (f.length <= cName) continue;
  if (!STATES.has(f[cUsps].trim())) continue;
  const trimmed = f[cName].trim();
  const { klass } = stripSuffix(trimmed);
  // A trailing lowercase word or a parenthetical is a descriptor we did not
  // recognise. A single-word name is its own name and can carry none.
  const last = trimmed.split(' ').pop();
  if (!klass && trimmed.includes(' ') && /^[a-z(]/.test(last)) {
    unknown.push(trimmed);
  }
}
if (unknown.length > 0) {
  throw new Error(
    `Unrecognised place-class suffixes in the ${VINTAGE} Gazetteer — add them to ` +
      `LSAD_SUFFIXES after checking they really are descriptors:\n  ` +
      [...new Set(unknown)].slice(0, 20).join('\n  '),
  );
}

/**
 * SORTED BY PROMINENCE, NOT ALPHABETICALLY, AND THE SERVING CODE DEPENDS ON IT.
 *
 * The reader does a linear prefix scan and takes the first N hits, so the file
 * order IS the result order: type "Hou" and Houston TX must come back before
 * Houghton Lake MI. Alphabetical order would return whichever name sorts first,
 * which is not what anyone means by a suggestion.
 *
 * A scan of 32,041 rows costs well under a millisecond in process, so nothing
 * is gained by a prefix tree or a binary search over an alphabetical file — and
 * both would need the rank carried per row and re-sorted at query time anyway.
 */
rows.sort((a, b) => (b.rank - a.rank) || a.name.localeCompare(b.name, 'en'));

/**
 * THE RANKING IS CHECKED, NOT TRUSTED. These are the collisions a freight
 * dispatcher actually hits, and a proxy that gets them wrong is not worth
 * shipping.
 */
function topFor(name) {
  return rows.filter((r) => r.name === name).sort((a, b) => b.rank - a.rank)[0];
}
/**
 * THE CONSOLIDATED CITY-COUNTY NAMES, checked by display rather than by rank.
 * These are the rows the multi-word descriptors live on, and a regression here
 * mangles the name of a major freight destination rather than merely
 * mis-ordering two of them.
 */
for (const [want, state] of [
  ['Indianapolis', 'IN'],
  ['Nashville-Davidson', 'TN'],
  ['Louisville/Jefferson County', 'KY'],
  ['Lexington-Fayette', 'KY'],
  ['Anchorage', 'AK'],
  ['Athens-Clarke County', 'GA'],
  ['Butte-Silver Bow', 'MT'],
]) {
  if (!rows.some((r) => r.name === want && r.state === state)) {
    throw new Error(
      `Consolidated-city check: "${want}, ${state}" is not in the index under that ` +
        'name. A descriptor phrase is being stripped wrongly — check LSAD_SUFFIXES ' +
        'is still longest-first.',
    );
  }
}

const checks = [
  ['Buffalo', 'NY'],
  ['Houston', 'TX'],
  ['Portland', 'OR'],
  ['Columbus', 'OH'],
  ['Kansas City', 'MO'],
];
for (const [name, expect] of checks) {
  const got = topFor(name);
  if (!got) throw new Error(`Ranking check: "${name}" is not in the index at all.`);
  if (got.state !== expect) {
    throw new Error(
      `Ranking check: "${name}" ranks ${got.state} first, expected ${expect}. ` +
        'The land-area-and-class proxy no longer holds; fix the ranking rather ' +
        'than the expectation.',
    );
  }
}

// One row per line: name \t state \t lat \t lng. Plain text so a human can read
// the asset and diff it; gzip does the compressing.
const body = rows.map((r) => `${r.name}\t${r.state}\t${r.lat}\t${r.lng}`).join('\n');
const gz = zlib.gzipSync(Buffer.from(body, 'utf8'), { level: 9 });

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'usplaces.bin.gz'), gz);
fs.writeFileSync(
  path.join(OUT_DIR, 'usplaces.manifest.json'),
  `${JSON.stringify(
    {
      format: 'USPLACES1',
      gazetteerVintage: VINTAGE,
      sourceUrl: SOURCE_URL,
      licence:
        'US Census Bureau Gazetteer — a work of the US federal government, public domain (17 U.S.C. § 105).',
      builtBy: 'scripts/places/build.mjs',
      placeCount: rows.length,
      skippedTerritoryRows: skippedTerritory,
      classCounts: Object.fromEntries([...seenSuffix].sort((a, b) => b[1] - a[1])),
      uncompressedBytes: body.length,
      gzipBytes: gz.length,
      sha256: crypto.createHash('sha256').update(gz).digest('hex'),
    },
    null,
    2,
  )}\n`,
);

process.stdout.write(
  `usplaces: ${rows.length} places, ${skippedTerritory} territory rows dropped, ` +
    `${(body.length / 1e6).toFixed(2)} MB -> ${(gz.length / 1e6).toFixed(2)} MB gzipped\n`,
);
