/**
 * Canadian province/territory code ↔ name ↔ URL-slug mapping for the public
 * carrier directory (North-America model).
 *
 * Mirrors the shape of usStates.ts so the directory routes can resolve province
 * pages the same way they resolve US-state pages (e.g. "ON" ↔ "Ontario" ↔
 * "ontario" for SEO-friendly URLs like /directory/ca/ontario later). The 2-letter
 * codes are the standard Canada Post province/territory abbreviations, which are
 * exactly what FMCSA returns in phy_state / bus_state_code for the ~9k Canada-
 * domiciled carriers that hold US cross-border authority.
 *
 * Pure + dependency-free. Covers all 10 provinces + 3 territories. Any other
 * 2-letter code is handled gracefully by `provinceByCode` (synthesizes an entry
 * from the raw code) so a page still renders rather than 404-ing.
 */
export interface CaProvince {
  /** Two-letter Canada Post code, upper-cased (e.g. "ON"). */
  code: string;
  /** Display name (e.g. "Ontario"). */
  name: string;
  /** URL slug, lower-cased, hyphenated (e.g. "ontario", "british-columbia"). */
  slug: string;
}

const RAW: ReadonlyArray<[string, string]> = [
  ['AB', 'Alberta'], ['BC', 'British Columbia'], ['MB', 'Manitoba'], ['NB', 'New Brunswick'],
  ['NL', 'Newfoundland and Labrador'], ['NS', 'Nova Scotia'], ['NT', 'Northwest Territories'],
  ['NU', 'Nunavut'], ['ON', 'Ontario'], ['PE', 'Prince Edward Island'], ['QC', 'Quebec'],
  ['SK', 'Saskatchewan'], ['YT', 'Yukon'],
];

/** Turn a province name into a URL slug ("British Columbia" → "british-columbia"). */
function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export const CA_PROVINCES: readonly CaProvince[] = RAW.map(([code, name]) => ({
  code,
  name,
  slug: toSlug(name),
}));

const BY_CODE = new Map(CA_PROVINCES.map((p) => [p.code, p]));
const BY_SLUG = new Map(CA_PROVINCES.map((p) => [p.slug, p]));

/**
 * The 2-letter codes the directory can place as Canadian domicile (10 provinces
 * + 3 territories). A carrier whose physical-domicile state is in this set is
 * tagged country='CA' by the ingest (when includeCanada is on); otherwise it is
 * treated as non-North-American and dropped.
 */
export const CA_PROVINCE_CODES: ReadonlySet<string> = new Set(CA_PROVINCES.map((p) => p.code));

/**
 * Resolve a 2-letter code to a CaProvince. Unknown-but-valid 2-letter codes are
 * synthesized (name = code) so a page still renders instead of 404-ing.
 */
export function provinceByCode(code: string | null | undefined): CaProvince | null {
  if (!code) return null;
  const c = String(code).toUpperCase().slice(0, 2);
  if (!/^[A-Z]{2}$/.test(c)) return null;
  return BY_CODE.get(c) ?? { code: c, name: c, slug: c.toLowerCase() };
}

/** Resolve a URL slug to a CaProvince, or null when it isn't a known province. */
export function provinceBySlug(slug: string | null | undefined): CaProvince | null {
  if (!slug) return null;
  const s = String(slug).toLowerCase().trim();
  return BY_SLUG.get(s) ?? null;
}
