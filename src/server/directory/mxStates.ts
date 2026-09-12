/**
 * Mexican state code ↔ name ↔ URL-slug mapping for the public carrier directory
 * (North-America model).
 *
 * Mirrors usStates.ts / caProvinces.ts so a Mexico-domiciled carrier resolves a
 * real display name instead of falling through to a raw two-letter code or, far
 * worse, a US state label.
 *
 * ─── WHERE THESE CODES COME FROM (measured, not assumed) ───────────────────
 *
 * FMCSA does NOT use ISO 3166-2:MX. It uses its own two-letter codes, and — this
 * is the trap — THE TWO FILES THE INGEST READS DO NOT AGREE WITH EACH OTHER.
 * Both sets were enumerated live on 2026-09-11 with a `$group` over each
 * resource; nothing below is inferred from a published standard.
 *
 *   · Company Census (az4n-8mr2) — has a `phy_country` column, so its Mexican
 *     rows are self-identifying. 32 distinct `phy_state` values under
 *     `phy_country='MX'` (27,212 rows), verified one by one against their top
 *     `phy_city` values (CI → Juárez/Chihuahua, CH → Piedras Negras/Saltillo/
 *     Torreón, TA → Nuevo Laredo/Reynosa, …).
 *   · L&I Carrier (6eyk-hxee) — no country column at all. Inside the ingest's
 *     own filter ((common_stat='A' OR contract_stat='A') AND property_chk='Y')
 *     it carries 28 Mexican `bus_state_code` values, EIGHT of which are spelled
 *     differently from the census (TM/BA/JL/VE/QU/QR/DU/GR), also verified by
 *     top city.
 *
 * TWO CODES MEAN DIFFERENT STATES IN THE TWO FILES:
 *   · `CH` — census Coahuila (Piedras Negras, Saltillo, Torreón);
 *            L&I    Chihuahua (Juárez, Chihuahua).
 *   · `TA` — census Tamaulipas (Nuevo Laredo, Reynosa, Matamoros);
 *            L&I    Tabasco.
 * Classification is unaffected (both readings are Mexico either way), which is
 * why MX_STATE_CODES can safely be the union. NAMES are the part that cannot be
 * the union, so MX_STATES below is keyed to the CENSUS meanings ONLY — because
 * the census is what actually lands in `carrier_directory.state`:
 * `normalizeCarrier` reads `census.phy_state ?? li.bus_state_code`, and the
 * census match rate measured on prod is ~99.9%. The eight L&I-only spellings are
 * therefore classification-only: they are in MX_STATE_CODES so a census-less row
 * is still placed in Mexico, and `mxStateByCode` synthesizes `name = code` for
 * them rather than guessing a name for a row we cannot corroborate.
 *
 * Pure + dependency-free.
 */
export interface MxState {
  /** Two-letter FMCSA census code, upper-cased (e.g. "NL"). */
  code: string;
  /** Display name (e.g. "Nuevo León"). */
  name: string;
  /** URL slug, lower-cased, hyphenated (e.g. "nuevo-leon"). */
  slug: string;
}

/**
 * The 32 FMCSA CENSUS Mexican state codes, with the row count each carried
 * under `phy_country='MX'` when enumerated on 2026-09-11 (for scale, not stored):
 * TA 7,022 · BN 5,898 · CI 3,467 · NL 2,565 · SO 2,288 · SI 1,140 · CH 1,092 · …
 */
const RAW: ReadonlyArray<[string, string]> = [
  ['AG', 'Aguascalientes'], ['BN', 'Baja California'], ['BS', 'Baja California Sur'],
  ['CP', 'Campeche'], ['CS', 'Chiapas'], ['CI', 'Chihuahua'],
  // Census CH is COAHUILA (top cities Piedras Negras / Saltillo / Torreón). L&I
  // spells Chihuahua 'CH' — see the module header; the census meaning wins here.
  ['CH', 'Coahuila'],
  ['CL', 'Colima'], ['DF', 'Ciudad de México'], ['DG', 'Durango'],
  ['GJ', 'Guanajuato'], ['GE', 'Guerrero'], ['HD', 'Hidalgo'], ['JA', 'Jalisco'],
  ['MX', 'México'], ['MC', 'Michoacán'], ['MR', 'Morelos'], ['NA', 'Nayarit'],
  ['NL', 'Nuevo León'], ['OA', 'Oaxaca'], ['PU', 'Puebla'], ['QE', 'Querétaro'],
  ['QI', 'Quintana Roo'], ['SL', 'San Luis Potosí'], ['SI', 'Sinaloa'],
  ['SO', 'Sonora'], ['TB', 'Tabasco'],
  // Census TA is TAMAULIPAS (top cities Nuevo Laredo / Reynosa / Matamoros) and
  // is the single largest Mexican domicile. L&I spells Tabasco 'TA'.
  ['TA', 'Tamaulipas'],
  ['TL', 'Tlaxcala'], ['VC', 'Veracruz'], ['YU', 'Yucatán'], ['ZA', 'Zacatecas'],
];

/**
 * The eight codes that appear ONLY in the L&I carrier file's `bus_state_code`,
 * each confirmed Mexican by its top `bus_city`. They reach the `state` column
 * only for the ~0.1% of carriers with no census row, so they are deliberately
 * CLASSIFICATION-ONLY: present in MX_STATE_CODES (so such a row is still placed
 * in Mexico) but absent from MX_STATES (so no name is asserted for a row the
 * census cannot corroborate). Counts inside the ingest filter, 2026-09-11:
 * TM 4,875 (Nuevo Laredo) · BA 2,748 (Tijuana) · JL 303 (Guadalajara) ·
 * VE 129 (Veracruz) · QU 88 (Querétaro) · DU 59 (Durango) · GR 13 · QR 1.
 */
export const MX_LI_ONLY_STATE_CODES: ReadonlySet<string> = new Set([
  'TM', 'BA', 'JL', 'VE', 'QU', 'QR', 'DU', 'GR',
]);

/** Turn a state name into a URL slug ("Nuevo León" → "nuevo-leon"). */
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '') // strip the accents Mexican names carry
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const MX_STATES: readonly MxState[] = RAW.map(([code, name]) => ({
  code,
  name,
  slug: toSlug(name),
}));

const BY_CODE = new Map(MX_STATES.map((s) => [s.code, s]));

/**
 * Every two-letter code the directory can place as MEXICAN domicile: the census
 * spellings plus the L&I-only ones. This is the union on purpose — see the
 * module header. It overlaps CA_PROVINCE_CODES on exactly ONE code, `NL`, which
 * `carrierCountry` resolves explicitly rather than by set-ordering luck.
 */
export const MX_STATE_CODES: ReadonlySet<string> = new Set([
  ...MX_STATES.map((s) => s.code),
  ...MX_LI_ONLY_STATE_CODES,
]);

/**
 * Resolve a two-letter code to an MxState. An L&I-only or otherwise unknown
 * two-letter code is synthesized (name = code) so a profile still renders a
 * location line instead of blanking — the same graceful fallback stateByCode /
 * provinceByCode use.
 */
export function mxStateByCode(code: string | null | undefined): MxState | null {
  if (!code) return null;
  const c = String(code).toUpperCase().slice(0, 2);
  if (!/^[A-Z]{2}$/.test(c)) return null;
  return BY_CODE.get(c) ?? { code: c, name: c, slug: c.toLowerCase() };
}
