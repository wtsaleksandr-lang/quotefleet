/**
 * FMCSA CREDENTIALS — the insurance filings, the registration date, and the
 * rating date a shipper checks before tendering a load.
 *
 * ─── WHY THIS EXISTS ──────────────────────────────────────────────────────
 * The ingest already downloaded both source files but read only part of each:
 *   • L&I (`6eyk-hxee`) was read for operating AUTHORITY only. The SAME ROW also
 *     carries the carrier's INSURANCE FILINGS — the first thing a shipper looks
 *     up, and most of why SAFER gets the traffic it does.
 *   • Company Census (`az4n-8mr2`) was read for fleet / cargo / rating only. The
 *     SAME ROW also carries `add_date` (when FMCSA registered the carrier) and
 *     `safety_rating_date` (when the rating we ALREADY publish was assigned).
 * Nothing here costs an extra HTTP request: every column rides along on a fetch
 * the ingest was already making, so the full-directory runtime is unchanged.
 *
 * ─── MEASURED, POPULATION-WIDE (2026-08-30) ───────────────────────────────
 * Exact SoQL counts over the ingest's OWN `$where`, not a sample:
 *   370,752 L&I rows match `(common_stat='A' OR contract_stat='A') AND property_chk='Y'`
 *     bipd_file != '00000' ............ 352,121  = 95.0%   liability filing on record
 *     cargo_file = 'Y' ................  14,032  =  3.8%
 *     bond_file  = 'Y' ................   5,086  =  1.4%
 *     amounts on file (thousands): 750 → 223,337 · 1000 → 117,770 · 300 → 4,589
 *                                  5000 → 2,858 · 2000 → 1,614 · 1500 → 745
 *   2,233,510 active census rows (`status_code='A'`)
 *     add_date ....................... 100.0%
 *     add_date = '19740601' (sentinel)  12,864  =  0.58%   → suppressed, see below
 *     safety_rating .................. S 41,314 · C 11,298 · U 782 = 2.39% rated
 *                                       → 97.61% UNRATED, which is the normal case
 *     safety_rating_date ............. present on 100% of rated carriers
 * A 1,299-carrier stratified sample (14 evenly spaced windows) additionally
 * measured `bipd_file >= min_cov_amount` at 99.4%, confirming the required /
 * on-file pairing, and `bipd_file > min_cov_amount` at 25.4% — a quarter of
 * carriers file ABOVE the federal minimum, which is a real differentiator.
 *
 * METHOD NOTE, because it bit us: L&I is ordered by `dot_number` and DOT numbers
 * are issued in sequence, so ONE contiguous page samples essentially one
 * registration YEAR. A first attempt did that and produced a nonsense bimodal
 * 1994/2017 tenure histogram. Sample across spread offsets, or use `$group`.
 *
 * ─── THE L&I FILE IS FROZEN ───────────────────────────────────────────────
 * `6eyk-hxee` and its sibling `qh9u-swkp` both carry FMCSA's own note: "This
 * dataset was last refreshed on 05/14/2026 and will no longer be updated."
 * Verified substantively, not just from the note — transactions by month in the
 * L&I family run Jan 18,255 · Feb 19,740 · Mar 27,020 · Apr 29,286 · May 13,040
 * (partial) · Jun/Jul/Aug ZERO, while the census file kept registering 12k–17k
 * new carriers every one of those months. (`rowsUpdatedAt` still moves daily on
 * the frozen sets — it tracks metadata touches, not data, so do not trust it.)
 *
 * Consequence, and the reason LI_EXTRACT_DATE exists: EVERY L&I-derived fact we
 * publish — operating authority AND these insurance filings — is a snapshot of
 * 14 May 2026 and gets staler every week. Dating them is not decoration, it is
 * the difference between a fact and a false claim about a real business.
 *
 * ─── HONESTY CONTRACT ─────────────────────────────────────────────────────
 *   1. A FILING IS NOT COVERAGE. L&I records that an insurer filed a form; it is
 *      not proof a policy is in force today — doubly so on a frozen file. Every
 *      rendering says "filing on record", never "insured", never "verified".
 *   2. ABSENCE IS NOT A NEGATIVE. Cargo insurance and a surety bond are not
 *      required of most property carriers, so their absence is unremarkable and
 *      we render NOTHING rather than a "Not on file" that reads as a black mark.
 *      Same rule that governs an unrated carrier in ./safetyData.ts.
 *   3. `add_date` IS A REGISTRATION DATE, NOT A FOUNDING DATE. It is when FMCSA
 *      created the USDOT record. A company can predate its DOT number, and a
 *      re-registration mints a new one, so this is a FLOOR on tenure. The copy
 *      says "FMCSA-registered since 2015" — never "in business since", never
 *      "founded", never "15 years of operation".
 *   4. A RATING WITHOUT ITS DATE IS MISLEADING. Most published ratings are many
 *      years old, so the assignment date travels with the rating and the reader
 *      can weigh it.
 *   5. NO COMPOSITE SCORE. We print the filed amount and the federal minimum
 *      beside it and let the reader compare. No grade, no stars, no index.
 */

// ─── Provenance ───────────────────────────────────────────────────────────
/**
 * The date FMCSA last refreshed the Licensing & Insurance file, from its own
 * published note (see the freeze section above). A CONSTANT rather than a stored
 * column because the file is closed: a per-row as-of stamp would cost a column,
 * would differ from the truth (our read date is not the data's date), and — being
 * a fresh timestamp every run — would mark all ~330k rows as changed on every
 * weekly ingest, manufacturing exactly the fake `<lastmod>` freshness the
 * conditional `updated_at` in carrierIngest.ts exists to prevent.
 *
 * If FMCSA ever resumes publishing (the freeze note would disappear from
 * https://data.transportation.gov/api/views/6eyk-hxee.json), replace this with a
 * real per-run stamp and revisit that trade-off.
 */
export const LI_EXTRACT_DATE = '14 May 2026';

/**
 * FMCSA's bulk-load sentinel in the census `add_date` column: 12,864 active
 * carriers (0.58%) carry `19740601`, which is when a batch of legacy records was
 * loaded, not when those carriers registered. Publishing "FMCSA-registered since
 * 1974 · 52 yrs" off it would invent half a century of tenure for a company that
 * may be five years old, so it is suppressed to null.
 */
export const FMCSA_ADD_DATE_SENTINEL = '19740601';

// ─── L&I amount encoding ──────────────────────────────────────────────────
/**
 * L&I stores coverage as a zero-padded string in THOUSANDS of dollars: "00750"
 * is $750,000, "01000" is $1,000,000. Verified against the live file — the whole
 * observed value set ({300, 750, 1000, 1500, 2000, 3000, 5000, 6000}) is the
 * federal minimum schedule in thousands, and $750,000 is the general-freight
 * minimum. We multiply on the way IN so the column stores real dollars and no
 * later reader can mistake the unit.
 */
export const BIPD_UNIT_DOLLARS = 1_000;

/**
 * Parse an L&I coverage field into DOLLARS, or null.
 *
 * Null for blank, non-numeric AND for zero: "00000" means no filing of that type
 * is on record, which is the same state as "we have no value". Collapsing both
 * to null makes a "$0 of liability cover" string unrenderable by construction.
 */
export function parseCoverageDollars(v: unknown): number | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n * BIPD_UNIT_DOLLARS;
}

/** An L&I Y/N flag. Anything that is not 'Y' is false. */
export function isYes(v: unknown): boolean {
  return String(v ?? '').trim().toUpperCase() === 'Y';
}

/**
 * Parse an FMCSA `YYYYMMDD` date, or null.
 *
 * Census dates arrive bare (`20120413`) and sometimes with a time suffix
 * (`20180709 0000`), so we read the leading eight digits and ignore the rest.
 * Built as a UTC midnight Date so the stored value is byte-stable across runs —
 * an unstable parse would make every weekly ingest look like a change and
 * manufacture fake sitemap freshness across 330k rows.
 *
 * Rejects the bulk-load sentinel, implausible years, and impossible month/day
 * pairs rather than producing a date FMCSA never recorded.
 */
export function parseFmcsaDate(v: unknown): Date | null {
  const s = String(v ?? '').trim();
  if (s.startsWith(FMCSA_ADD_DATE_SENTINEL)) return null;
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1900 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  // Round-trip guard: Date.UTC rolls 20260231 forward into March, which would
  // publish a date that does not exist on the record.
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt;
}

// ─── The persisted facts ──────────────────────────────────────────────────
/**
 * Credential facts stored per carrier.
 *
 * The two amounts and the two dates are NULLABLE — null means "FMCSA has no such
 * filing / no such date on record", never zero and never a default. The two
 * flags are plain booleans because they come from the L&I row that DEFINES a
 * carrier's presence in this directory: if we have the carrier at all we have
 * its Y/N, so there is no third "unknown" state to encode.
 */
export interface CarrierCredentials {
  /** BIPD (bodily-injury & property-damage) liability ON FILE, in dollars. */
  bipdOnFile: number | null;
  /** The minimum BIPD this authority REQUIRES, in dollars. */
  bipdRequired: number | null;
  /** A cargo-insurance filing is on record. */
  cargoInsuranceOnFile: boolean;
  /** A surety-bond filing is on record. */
  bondOnFile: boolean;
  /** Census `add_date` — when FMCSA registered the carrier. A FLOOR on tenure,
   *  not a founding date. See rule 3 of the honesty contract. */
  fmcsaRegisteredSince: Date | null;
  /** Census `safety_rating_date` — when the published rating was assigned. */
  safetyRatingDate: Date | null;
}

/** No credential facts at all — the honest default for an unmatched carrier. */
export const EMPTY_CREDENTIALS: CarrierCredentials = {
  bipdOnFile: null,
  bipdRequired: null,
  cargoInsuranceOnFile: false,
  bondOnFile: false,
  fmcsaRegisteredSince: null,
  safetyRatingDate: null,
};

/** The L&I insurance columns and the census date columns, as raw strings. */
export interface CredentialSource {
  /** L&I `bipd_file` — coverage on file, thousands. */
  bipd_file?: string;
  /** L&I `min_cov_amount` — minimum required, thousands. */
  min_cov_amount?: string;
  /** L&I `cargo_file` / `bond_file` — Y/N. */
  cargo_file?: string;
  bond_file?: string;
  /** Census `add_date` / `safety_rating_date` — YYYYMMDD. */
  add_date?: string;
  safety_rating_date?: string;
}

/**
 * Merge the L&I insurance columns and the census date columns into the persisted
 * credential facts. Pure. A missing census row leaves both dates null — the same
 * shape an unmatched carrier already gets for fleet size.
 */
export function buildCarrierCredentials(
  li: CredentialSource | undefined,
  census: CredentialSource | undefined,
): CarrierCredentials {
  return {
    bipdOnFile: parseCoverageDollars(li?.bipd_file),
    bipdRequired: parseCoverageDollars(li?.min_cov_amount),
    cargoInsuranceOnFile: isYes(li?.cargo_file),
    bondOnFile: isYes(li?.bond_file),
    fmcsaRegisteredSince: parseFmcsaDate(census?.add_date),
    safetyRatingDate: parseFmcsaDate(census?.safety_rating_date),
  };
}

// ─── Display helpers ──────────────────────────────────────────────────────
/** Whole dollars with separators, e.g. 1000000 → "$1,000,000". */
export function formatCoverage(dollars: number): string {
  return `$${dollars.toLocaleString('en-US')}`;
}

/**
 * Full years since FMCSA registration, or null when there is no date — or when
 * the date is in the future, which is a bad upstream row rather than a negative
 * tenure.
 */
export function yearsRegistered(since: Date | null, now: Date = new Date()): number | null {
  if (!since) return null;
  const ms = now.getTime() - since.getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.floor(ms / (365.2425 * 24 * 60 * 60 * 1000));
}

/**
 * The tenure phrase. Deliberately "FMCSA-registered since YYYY" and never "in
 * business since" / "founded" — see rule 3. Under one full year reads
 * "FMCSA-registered 2026" so we never publish "0 yrs".
 */
export function registeredSinceLabel(since: Date | null, now: Date = new Date()): string | null {
  const yrs = yearsRegistered(since, now);
  if (!since || yrs == null) return null;
  const y = since.getUTCFullYear();
  return yrs < 1 ? `FMCSA-registered ${y}` : `FMCSA-registered since ${y} · ${yrs} yr${yrs === 1 ? '' : 's'}`;
}

/** "12 Mar 2007" — UTC, so the rendered date is deterministic on any server. */
export function formatCredentialDate(d: Date): string {
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/**
 * True when there is at least one insurance filing worth publishing — the gate
 * on whether the insurance card renders at all. A card that said only "nothing
 * on file" would turn absence into an accusation, which rule 2 forbids.
 */
export function hasInsuranceFilings(c: CarrierCredentials | null | undefined): boolean {
  return !!c && (c.bipdOnFile != null || c.cargoInsuranceOnFile || c.bondOnFile);
}
