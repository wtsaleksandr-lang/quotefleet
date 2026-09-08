/**
 * US PLACE SUGGESTIONS — in process, from a committed asset, at $0 forever.
 *
 * WHAT THIS REPLACES. WeFixTrades types addresses into Google Places
 * Autocomplete, which bills per request whenever no session token is supplied,
 * and its widget supplies none. QuoteFleet needs no such thing, and the reason
 * is about the product rather than the price: an OS/OW permit is priced PER
 * STATE, and lane mileage comes from the US Census geocoder that
 * `src/calc/heavyHaul/geocode.ts` already calls for free. No street number
 * moves a single figure on the quote. The question a dispatcher is actually
 * asking while they type is "Buffalo NY or Buffalo TX", and that is answerable
 * from a list.
 *
 * For this job the static index is not a cheaper approximation of the paid
 * service, it is better: it answers in well under a millisecond with no network
 * hop per keystroke, it works with the database down — which is the condition
 * this whole tool is built to answer under — it sends nobody's keystrokes to a
 * third party, and it cannot suggest a place in a state the calculator refuses
 * to price.
 *
 * THE ASSET. `assets/places/usplaces.bin.gz`, 32,041 places, 0.43 MB gzipped,
 * built offline by `scripts/places/build.mjs` from the US Census 2024
 * Gazetteer — public domain, 17 U.S.C. § 105, the same source family and the
 * same commit-the-artifact arrangement as `assets/tiger/usnet.bin.gz`. The
 * server never builds it.
 *
 * THE FILE ORDER IS THE RESULT ORDER. Rows are sorted by prominence at build
 * time, so a prefix scan that stops at the first N hits returns Houston TX
 * before Houma LA without ranking anything at request time. Prominence is
 * approximated from the Gazetteer's legal class and land area, because the
 * Gazetteer carries no population; the build asserts the collisions that
 * matter — Buffalo, Houston, Portland, Columbus, Kansas City — rather than
 * trusting the proxy.
 *
 * THE PROXY'S ONE VISIBLE WEAKNESS, recorded rather than hidden: on a bare
 * single letter it can lead with a physically enormous but obscure place —
 * "G" returns Greeley County, KS first, because a Kansas unified government
 * covers a great deal of ground. Every two-or-more character query measured
 * was correct (Sea→Seattle, Dal→Dallas, Atl→Atlanta, Den→Denver, Mem→Memphis,
 * Char→Charlotte), and `MIN_QUERY_LENGTH` is 2 for that reason.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const USPLACES_ASSET_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'assets',
  'places',
  'usplaces.bin.gz',
);

export interface UsPlace {
  /** Place name with the Gazetteer's legal-class descriptor stripped. */
  name: string;
  /** Two-letter USPS state code. Always one of the 50 states or DC. */
  state: string;
  lat: number;
  lng: number;
}

/**
 * A single character matches thousands of places and ranks them on the weakest
 * part of the prominence proxy. Two is where the suggestions start being about
 * what the user typed rather than about land area.
 */
export const MIN_QUERY_LENGTH = 2;
/** Long enough to disambiguate, short enough not to become a scroll. */
export const MAX_SUGGESTIONS = 8;

let cached: UsPlace[] | null = null;
let loadFailure: Error | null = null;

/**
 * A failed load is cached as a failure and rethrown, matching `loadUsnet`.
 * Retrying a missing asset on every keystroke would turn one deployment
 * mistake into a per-request disk storm; the caller's job is to degrade, not
 * to retry.
 */
export function loadPlaces(assetPath: string = USPLACES_ASSET_PATH): UsPlace[] {
  if (cached) return cached;
  if (loadFailure) throw loadFailure;
  try {
    const raw = new Uint8Array(fs.readFileSync(assetPath));
    const text =
      raw[0] === 0x1f && raw[1] === 0x8b
        ? zlib.gunzipSync(raw).toString('utf8')
        : Buffer.from(raw).toString('utf8');
    const out: UsPlace[] = [];
    for (const line of text.split('\n')) {
      if (!line) continue;
      const [name, state, lat, lng] = line.split('\t');
      if (name === undefined || state === undefined) continue;
      out.push({ name, state, lat: Number(lat), lng: Number(lng) });
    }
    cached = out;
    return cached;
  } catch (error) {
    loadFailure = error instanceof Error ? error : new Error(String(error));
    throw loadFailure;
  }
}

/**
 * NORMALISE FOR MATCHING, NOT FOR DISPLAY. Case is folded and accents are
 * stripped so "Espanola" finds "Española"; punctuation is kept, because
 * "St. Louis" and "Winston-Salem" are how people type them and dropping the
 * separators would match across word boundaries that mean something.
 */
function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Split a query into its place part and an optional state part, so that
 * "springfield, il" and "springfield il" both narrow rather than failing to
 * match a name that contains neither comma nor state.
 */
function splitQuery(query: string): { name: string; state: string | null } {
  const q = fold(query).replace(/\s+/g, ' ');
  const comma = q.lastIndexOf(',');
  if (comma > 0) {
    const tail = q.slice(comma + 1).trim();
    if (/^[a-z]{2}$/.test(tail)) return { name: q.slice(0, comma).trim(), state: tail };
    // A comma with a longer tail is someone typing a full address —
    // "1200 Main St, Houston". Match on what comes BEFORE the last comma only
    // if that leaves something; otherwise fall through to the whole string.
    return { name: q.slice(0, comma).trim() || q, state: null };
  }
  const m = /^(.*[a-z].*)\s+([a-z]{2})$/.exec(q);
  if (m) return { name: m[1]!.trim(), state: m[2]! };
  return { name: q, state: null };
}

export interface PlaceSuggestion extends UsPlace {
  /** "Houston, TX" — what the field is filled with on selection. */
  label: string;
}

/**
 * Prefix-match places, most prominent first.
 *
 * PREFIX RATHER THAN SUBSTRING, DELIBERATELY. A substring match on "or" offers
 * Baltimore, Salem and four hundred others, none of which the user was typing
 * towards. The one concession is that a prefix may match ANY word of the name,
 * so "Palm" finds "West Palm Beach" — a word boundary is a place someone
 * plausibly starts from, mid-word is not.
 */
export function suggestPlaces(
  query: string,
  limit: number = MAX_SUGGESTIONS,
  places: UsPlace[] = loadPlaces(),
): PlaceSuggestion[] {
  const { name, state } = splitQuery(query);
  if (name.length < MIN_QUERY_LENGTH) return [];

  const exact: PlaceSuggestion[] = [];
  const wordStart: PlaceSuggestion[] = [];

  for (const p of places) {
    if (state !== null && fold(p.state) !== state) continue;
    const folded = fold(p.name);
    const label = `${p.name}, ${p.state}`;
    if (folded.startsWith(name)) {
      exact.push({ ...p, label });
      // The file is prominence-ordered, so the first `limit` leading matches
      // are the best ones and there is no reason to scan the remaining rows.
      if (exact.length >= limit) return exact;
    } else if (wordStart.length < limit && folded.includes(` ${name}`)) {
      wordStart.push({ ...p, label });
    }
  }
  return [...exact, ...wordStart].slice(0, limit);
}
