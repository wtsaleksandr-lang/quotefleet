/**
 * US state code ↔ name ↔ URL-slug mapping for the public carrier directory.
 *
 * The directory browses carriers BY STATE (carrier_directory.state is the
 * 2-letter physical state). The landing + state pages need a human name and a
 * clean slug (e.g. "CA" ↔ "California" ↔ "california") for SEO-friendly URLs
 * like /directory/california.
 *
 * Pure + dependency-free. Covers the 50 states + DC. Any other 2-letter code
 * present in the data (US territories: PR, VI, GU, …) is handled gracefully by
 * `stateByCode` / `stateBySlug`, which synthesize an entry from the raw code so
 * the page still renders rather than 404-ing.
 */
export interface UsState {
  /** Two-letter USPS code, upper-cased (e.g. "CA"). */
  code: string;
  /** Display name (e.g. "California"). */
  name: string;
  /** URL slug, lower-cased, hyphenated (e.g. "california", "new-york"). */
  slug: string;
}

const RAW: ReadonlyArray<[string, string]> = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'],
  ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'],
  ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'],
  ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'],
  ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'],
  ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'],
  ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'],
  ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'],
  ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'],
  ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'],
  ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'],
  ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
  // Territories that appear in FMCSA data.
  ['PR', 'Puerto Rico'], ['VI', 'U.S. Virgin Islands'], ['GU', 'Guam'],
];

/** Turn a state name into a URL slug ("New York" → "new-york"). */
function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export const US_STATES: readonly UsState[] = RAW.map(([code, name]) => ({
  code,
  name,
  slug: toSlug(name),
}));

const BY_CODE = new Map(US_STATES.map((s) => [s.code, s]));
const BY_SLUG = new Map(US_STATES.map((s) => [s.slug, s]));

/**
 * Resolve a 2-letter code to a UsState. Unknown-but-valid 2-letter codes are
 * synthesized (name = code) so a page still renders instead of 404-ing.
 */
export function stateByCode(code: string | null | undefined): UsState | null {
  if (!code) return null;
  const c = String(code).toUpperCase().slice(0, 2);
  if (!/^[A-Z]{2}$/.test(c)) return null;
  return BY_CODE.get(c) ?? { code: c, name: c, slug: c.toLowerCase() };
}

/** Resolve a URL slug to a UsState, or null when it isn't a known state. */
export function stateBySlug(slug: string | null | undefined): UsState | null {
  if (!slug) return null;
  const s = String(slug).toLowerCase().trim();
  return BY_SLUG.get(s) ?? null;
}
