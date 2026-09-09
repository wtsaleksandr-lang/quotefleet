/**
 * COMPANY AUTOSUGGEST — 370,000 carriers, no database, no API, no per-keystroke cost.
 *
 * WHY THIS IS NOT A DATABASE QUERY. `carrier_directory` holds the same data, and
 * querying it on every keypress is precisely the mistake that took production
 * down on 2026-09-08: sustained load against the directory saturated the
 * aggregate limiter, which starved the platform health probe, which restarted
 * the VM every fifteen minutes for a day. Company autosuggest fires on every
 * keypress of every signup — pointing that at the same table would be
 * re-creating the outage deliberately.
 *
 * Reading a committed index instead costs nothing to serve, cannot contend with
 * anything, and keeps working while the database is down, which is the condition
 * this app is explicitly built to survive.
 *
 * THREE THINGS KEEP IT CHEAP IN MEMORY, and they matter because this runs on a
 * small VM that has already proved it can be pushed over:
 *
 *   1. LAZY. The asset is not read until the first company suggestion is asked
 *      for. Boot, idle, and every deployment that never sees a signup pay
 *      nothing at all.
 *   2. NO OBJECTS. 370,142 rows would be tens of megabytes as JavaScript
 *      objects. The decompressed text is held as ONE string and only the
 *      handful of rows that match are ever turned into objects.
 *   3. BINARY SEARCH, NOT A SCAN. The file is sorted by name, and a parallel
 *      Int32Array of line offsets (1.5 MB) makes a prefix lookup ~19
 *      comparisons instead of 370,142. A linear scan would have been ~16 MB of
 *      string work per keystroke.
 *
 * WHAT A MATCH IS WORTH. Each row carries the carrier's DOT number. A carrier
 * picking themselves at signup hands us their verified FMCSA identity, which is
 * worth considerably more than the convenience of not typing.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const CARRIERS_ASSET_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'assets',
  'carriers',
  'carriers.bin.gz',
);

export interface CarrierSuggestion {
  /** Legal name, title-cased from the FMCSA all-caps original. */
  name: string;
  /** Two-letter state of the business address. May be empty. */
  state: string;
  /** Business city. May be empty. */
  city: string;
  /** USDOT number — the reason this is worth more than an autocomplete. */
  dot: string;
  /** "Acme Trucking — Dallas, TX" */
  label: string;
}

/**
 * Three, not two as for places. Company names share long prefixes far more than
 * place names do — "A", "AB", "ABC" match many thousands of carriers each — so
 * two characters returns an arbitrary alphabetical slice rather than anything
 * the user recognises.
 */
export const MIN_QUERY_LENGTH = 3;
export const MAX_SUGGESTIONS = 8;
/*
 * How many prefix matches are collected before ranking. A three-letter prefix
 * can match many thousands of carriers, and ranking all of them would turn a
 * bounded lookup back into a scan. Two hundred is far more than enough for the
 * oldest registration in a prefix to be among them, because DOT numbers are
 * spread evenly through the alphabet rather than clustered.
 */
const CANDIDATE_CAP = 200;

interface Loaded {
  text: string;
  /** Byte offset of each line start, in name order. */
  starts: Int32Array;
  /** Lower-cased name for each line, used only during the binary search. */
  nameAt: (i: number) => string;
}

let loaded: Loaded | null = null;
let loadFailure: Error | null = null;

/**
 * A failed load is cached as a failure and rethrown, matching `loadUsnet` and
 * `loadPlaces`. Retrying a missing 6 MB asset on every keystroke would turn one
 * deployment mistake into a per-request disk storm; the caller degrades.
 */
function load(assetPath: string = CARRIERS_ASSET_PATH): Loaded {
  if (loaded) return loaded;
  if (loadFailure) throw loadFailure;
  try {
    const raw = new Uint8Array(fs.readFileSync(assetPath));
    const text =
      raw[0] === 0x1f && raw[1] === 0x8b
        ? zlib.gunzipSync(raw).toString('utf8')
        : Buffer.from(raw).toString('utf8');

    // One pass to record where each line begins. Int32Array rather than a
    // number[] — 370k boxed numbers is several megabytes of heap for data that
    // is just offsets.
    const offsets: number[] = [0];
    for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) {
      offsets.push(i + 1);
    }
    if (offsets[offsets.length - 1] >= text.length) offsets.pop();
    const starts = Int32Array.from(offsets);

    const nameAt = (i: number): string => {
      const from = starts[i]!;
      const tab = text.indexOf('\t', from);
      return text.slice(from, tab === -1 ? from : tab).toLowerCase();
    };

    loaded = { text, starts, nameAt };
    return loaded;
  } catch (error) {
    loadFailure = error instanceof Error ? error : new Error(String(error));
    throw loadFailure;
  }
}

function rowAt(idx: Loaded, i: number): CarrierSuggestion | null {
  const from = idx.starts[i]!;
  const end = i + 1 < idx.starts.length ? idx.starts[i + 1]! - 1 : idx.text.length;
  // key TAB name TAB state TAB city TAB dot — column 0 is the normalised search
  // key and is never displayed, so every field below is shifted by one.
  const parts = idx.text.slice(from, end).split('\t');
  const name = parts[1];
  if (!name) return null;
  const state = parts[2] ?? '';
  const city = parts[3] ?? '';
  const dot = parts[4] ?? '';
  const where = [city, state].filter(Boolean).join(', ');
  return { name, state, city, dot, label: where ? `${name} — ${where}` : name };
}

/** First line whose lower-cased name is >= `prefix`. */
function lowerBound(idx: Loaded, prefix: string): number {
  let lo = 0;
  let hi = idx.starts.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (idx.nameAt(mid) < prefix) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Prefix-match carrier names, oldest registration first.
 *
 * Plain alphabetical was the first rule here and it was wrong — see the ranking
 * note inside the function for what it did to "schneider" and why the DOT number
 * replaced it.
 */
export function suggestCarriers(
  query: string,
  limit: number = MAX_SUGGESTIONS,
): CarrierSuggestion[] {
  // Normalised the same way the builder normalised the stored key, so what a
  // person types matches what FMCSA recorded regardless of punctuation.
  const q = query.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (q.length < MIN_QUERY_LENGTH) return [];

  const idx = load();
  const hits: CarrierSuggestion[] = [];
  for (
    let i = lowerBound(idx, q);
    i < idx.starts.length && hits.length < CANDIDATE_CAP;
    i += 1
  ) {
    if (!idx.nameAt(i).startsWith(q)) break;
    const row = rowAt(idx, i);
    if (row) hits.push(row);
  }

  /*
   * RANKED BY REGISTRATION AGE, and this has to happen HERE rather than in the
   * file. The index is sorted by key so it can be binary-searched, and within a
   * prefix that ordering is alphabetical on the full key — "schneiderbrothers"
   * precedes "schneidernational". Returning the file's own order answered
   * "schneider" with Schneider Brothers Trucking and Schneider Cattle Trucking
   * while Schneider National sat thousands of rows away.
   *
   * FMCSA has issued DOT numbers sequentially since the 1980s, so a lower number
   * is a longer-established carrier — Old Dominion 90,849 and Estes 121,018
   * against Schneider Brothers 2,919,971. It is a proxy rather than a fleet
   * count, and it is one already sitting in the row: the truer measure lives in
   * the FMCSA census file, which is 2.45M rows, 500s at deep offsets, and stores
   * power_units as TEXT so it cannot even be ordered numerically server-side.
   */
  hits.sort((a, b) => Number(a.dot) - Number(b.dot));
  return hits.slice(0, limit);
}

/** Test seam: forget the cached index so a fresh asset can be loaded. */
export function resetCarrierIndexForTests(): void {
  loaded = null;
  loadFailure = null;
}
