/**
 * FMCSA SAFETY data — the roadside-inspection, out-of-service and crash record
 * that shippers actually evaluate a carrier on.
 *
 * ─── WHAT WE INGEST (and what we deliberately DON'T) ───────────────────────
 * Two free, unauthenticated Socrata resources on data.transportation.gov, both
 * verified live (probed 2026-08-30, resource ids + column names confirmed
 * empirically against the API — never from memory):
 *
 *   • SMS AB PassProperty — resource `4y6x-dmck`  (716,198 rows)
 *       "All Interstate and Intrastate Hazmat … FMCSA summary results of SMS
 *       data of all active interstate motor carriers". ONE ROW PER CARRIER,
 *       already aggregated by FMCSA over a rolling 24-MONTH measurement period.
 *       This is the key find: it means we do NOT have to aggregate the 8.3M-row
 *       Vehicle Inspection File ourselves. Supplies insp_total,
 *       driver_insp_total, driver_oos_insp_total, vehicle_insp_total,
 *       vehicle_oos_insp_total. Refreshed monthly (rowsUpdatedAt 2026-08-13).
 *
 *       NOTE the sibling `h9zy-gjn8` ("SMS C PassProperty") is the INTRASTATE
 *       NON-HAZMAT file and is NOT the right population for this directory —
 *       our carriers hold interstate operating authority. The two files are
 *       disjoint (verified: DOT 74432 is present in AB, absent from C).
 *
 *   • Crash File — resource `aayw-vxb3`  (4,985,446 rows, updated DAILY)
 *       One row per commercial vehicle per state-reported crash. Aggregated
 *       SERVER-SIDE via SoQL `$group=dot_number` over a 24-month window so the
 *       ingest transfers ~hundreds of rows per page instead of millions. Every
 *       numeric column on this resource is TEXT, so sums need an explicit
 *       `::number` cast (a bare `sum(fatalities)` returns a type-mismatch
 *       error — verified).
 *
 * ─── REJECTED SOURCES (evidence, so nobody re-adds them) ───────────────────
 *   ✗ `p2mt-9ige` "OUT OF SERVICE ORDERS" — REJECTED as unpublishable.
 *       Its `status` column is 84% self-contradictory: of 92,048 rows marked
 *       status='ACTIVE', 77,618 ALSO carry a `rescind_date` (i.e. the order was
 *       lifted). Only 14,430 are ACTIVE with no rescind date, and those include
 *       orders from 2011–2016 for "90 day failure to pay fine" against carriers
 *       that still hold active authority today. Publishing "this company is
 *       under a federal out-of-service order" off a field that disagrees with
 *       itself five times out of six would be defamatory-grade wrong about a
 *       real business. Not worth it. The profile already offers a LIVE FMCSA
 *       QCMobile check, which is the authoritative answer for OOS status.
 *
 *   ✗ SMS BASIC percentiles — DO NOT EXIST in the public feed. Confirmed by
 *       reading the full column list of `4y6x-dmck`: it carries `*_measure`
 *       (raw roadside performance measure) and `*_ac` (Acute/Critical indicator)
 *       but NO percentile column. This matches the FAST Act removal of public
 *       BASIC percentiles for property carriers. Any design that assumes a
 *       percentile is designing around a feed that isn't there.
 *
 *   ✗ SMS BASIC `*_measure` / `*_ac` columns — available, but deliberately NOT
 *       surfaced. They are judgment-laden composite scores that FMCSA itself
 *       cautions against using to draw safety conclusions about an individual
 *       carrier. We publish COUNTS OF OBSERVABLE EVENTS instead (inspections,
 *       out-of-service orders, crashes), which a reader can check against SAFER.
 *
 * ─── HONESTY CONTRACT ──────────────────────────────────────────────────────
 * This is a real business's reputation on a public, indexable page. Therefore:
 *   1. `null` means "FMCSA has no record", NEVER 0. Only ~74% of our carriers
 *      appear in the SMS file at all; rendering a missing record as "0 crashes"
 *      would invent a clean record we cannot support.
 *   2. Rates are suppressed below MIN_INSPECTIONS_FOR_RATE. A carrier with one
 *      inspection that went out-of-service is not a "100% OOS rate" carrier —
 *      that is a statistically meaningless number that would smear them.
 *   3. We never editorialise. No "unsafe", no "poor", no grades, no stars. We
 *      state counts, the arithmetic rate, and the published national average
 *      next to it, and let the reader draw the conclusion.
 *   4. Every safety block carries its as-of date. Stale safety data presented as
 *      current is misleading.
 */

// ─── Socrata resources (verified live 2026-08-30) ─────────────────────────
/** SMS AB PassProperty — one pre-aggregated 24-month safety row per carrier. */
export const SMS_AB_ID = '4y6x-dmck';
/** FMCSA Crash File — one row per vehicle per state-reported crash. */
export const CRASH_ID = 'aayw-vxb3';

/**
 * Rolling window, in months, that BOTH sources describe. FMCSA computes the SMS
 * file over a 24-month measurement period, so the crash aggregation uses the
 * same window to keep the two halves of the safety block comparable.
 */
export const SAFETY_WINDOW_MONTHS = 24;

/**
 * National roadside out-of-service rates, used ONLY as neutral context beside a
 * carrier's own rate.
 *
 * Computed from the SMS AB file itself rather than quoted from memory, so the
 * benchmark and the carrier both come from one population:
 *   $select=sum(driver_insp_total::number), sum(driver_oos_insp_total::number),
 *           sum(vehicle_insp_total::number), sum(vehicle_oos_insp_total::number)
 * Measured 2026-08-30 → driver 269,174 / 4,956,496 = 5.43%
 *                        vehicle 684,741 / 3,184,955 = 21.50%
 * (Both land within a few tenths of the published CVSA figures, which is the
 * sanity check that the cast + column mapping are right.)
 *
 * Re-measure with the query above if the numbers drift; they move very slowly.
 */
export const NATIONAL_DRIVER_OOS_RATE = 0.0543;
export const NATIONAL_VEHICLE_OOS_RATE = 0.215;

/**
 * Minimum inspections before we will show a PERCENTAGE. Below this the sample is
 * too small for a rate to mean anything, and a spuriously extreme number (1 of 1
 * = "100%") would misrepresent a real company. Counts are still shown — they are
 * facts; only the derived rate is suppressed.
 */
export const MIN_INSPECTIONS_FOR_RATE = 10;

// ─── Raw row shapes (subset of columns we request) ────────────────────────
/** A row of SMS AB PassProperty (`4y6x-dmck`). All columns are TEXT. */
export interface SmsSafetyRow {
  dot_number?: string;
  insp_total?: string;
  driver_insp_total?: string;
  driver_oos_insp_total?: string;
  vehicle_insp_total?: string;
  vehicle_oos_insp_total?: string;
}

/** One `$group=dot_number` aggregate row off the Crash File (`aayw-vxb3`). */
export interface CrashAggRow {
  dot_number?: string;
  crashes?: string;
  fatalities?: string;
  injuries?: string;
  tow_aways?: string;
}

/**
 * The safety facts we persist per carrier. Every field is nullable and `null`
 * strictly means "FMCSA published no record", never "zero".
 */
export interface CarrierSafety {
  /** Total roadside inspections in the 24-month window. */
  inspTotal: number | null;
  /** Driver inspections, and how many had >=1 driver out-of-service violation. */
  driverInspTotal: number | null;
  driverOosTotal: number | null;
  /** Vehicle inspections, and how many had >=1 vehicle out-of-service violation. */
  vehicleInspTotal: number | null;
  vehicleOosTotal: number | null;
  /** State-reported crashes in the same window, and their severity split. */
  crashesTotal: number | null;
  crashesFatal: number | null;
  crashesInjury: number | null;
  crashesTow: number | null;
  /** When the underlying FMCSA extract was read. Null ⇒ no safety data at all. */
  safetyDataAsOf: Date | null;
}

/** All-null safety facts — the honest default for a carrier we have no data on. */
export const EMPTY_SAFETY: CarrierSafety = {
  inspTotal: null,
  driverInspTotal: null,
  driverOosTotal: null,
  vehicleInspTotal: null,
  vehicleOosTotal: null,
  crashesTotal: null,
  crashesFatal: null,
  crashesInjury: null,
  crashesTow: null,
  safetyDataAsOf: null,
};

/**
 * Parse a Socrata TEXT numeric into a non-negative integer, or null.
 * Returns null (not 0) for absent/blank/garbage so "no record" never collapses
 * into "zero" — the single most important rule in this module.
 */
export function toCount(v: unknown): number | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/**
 * Merge an SMS row + a crash aggregate into the persisted safety facts.
 *
 * `asOf` is threaded in (rather than read from the clock here) so the whole
 * ingest run stamps ONE consistent as-of date and the function stays pure.
 *
 * Crash semantics: the crash query is a GROUP BY over every DOT on the page, so
 * a carrier ABSENT from the result genuinely had zero crashes in the window —
 * that is a real 0, not a missing value. We therefore only default crashes to 0
 * when `crashQueried` is true (the fetch succeeded). If the crash fetch failed
 * we leave them null rather than publishing a clean record we didn't verify.
 */
export function buildCarrierSafety(
  sms: SmsSafetyRow | undefined,
  crash: CrashAggRow | undefined,
  asOf: Date | null,
  crashQueried: boolean,
): CarrierSafety {
  // No as-of ⇒ the safety fetch didn't run for this carrier at all.
  if (!asOf) return EMPTY_SAFETY;
  const hasAny = !!sms || crashQueried;
  if (!hasAny) return EMPTY_SAFETY;

  const crashDefault = crashQueried ? 0 : null;
  return {
    inspTotal: toCount(sms?.insp_total),
    driverInspTotal: toCount(sms?.driver_insp_total),
    driverOosTotal: toCount(sms?.driver_oos_insp_total),
    vehicleInspTotal: toCount(sms?.vehicle_insp_total),
    vehicleOosTotal: toCount(sms?.vehicle_oos_insp_total),
    crashesTotal: toCount(crash?.crashes) ?? crashDefault,
    crashesFatal: toCount(crash?.fatalities) ?? crashDefault,
    crashesInjury: toCount(crash?.injuries) ?? crashDefault,
    crashesTow: toCount(crash?.tow_aways) ?? crashDefault,
    safetyDataAsOf: asOf,
  };
}

/**
 * Out-of-service RATE as a fraction, or null when it must not be shown:
 *   - no inspection record at all, or
 *   - fewer than MIN_INSPECTIONS_FOR_RATE inspections (sample too small), or
 *   - an out-of-service count that exceeds the inspection count (bad upstream
 *     row — refuse rather than render >100%).
 */
export function oosRate(oos: number | null, inspections: number | null): number | null {
  if (oos == null || inspections == null) return null;
  if (inspections < MIN_INSPECTIONS_FOR_RATE) return null;
  if (oos > inspections) return null;
  return oos / inspections;
}

/** A rate as a one-decimal percentage string, e.g. 0.0543 → "5.4%". */
export function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

/**
 * NEUTRAL comparison of a carrier's rate to the national average. Deliberately
 * returns only 'below' / 'above' / 'near' — arithmetic facts — and never a
 * judgement word like "good" or "unsafe". A rate within ±10% RELATIVE of the
 * benchmark reads as 'near', because a hair's difference is noise, not a signal.
 */
export type RateComparison = 'below' | 'near' | 'above';

export function compareToNational(rate: number, national: number): RateComparison {
  const delta = (rate - national) / national;
  if (delta < -0.1) return 'below';
  if (delta > 0.1) return 'above';
  return 'near';
}

/**
 * Human phrase for a comparison. "below the national average" is a statement of
 * arithmetic about an out-of-service RATE — lower is fewer orders — so it is
 * factual, not editorial. We never translate it into a verdict about the carrier.
 */
export function comparisonPhrase(cmp: RateComparison): string {
  switch (cmp) {
    case 'below':
      return 'below the national average';
    case 'above':
      return 'above the national average';
    default:
      return 'about the national average';
  }
}

/**
 * The exact regulatory meaning of an FMCSA safety rating, including the case
 * that matters most: NO RATING.
 *
 * ~Most carriers in this directory are unrated, and that is NORMAL — FMCSA only
 * assigns a rating after it conducts a compliance review, and it has never
 * reviewed the large majority of the ~330k authorised carriers. An unrated
 * carrier has NOT failed anything. Rendering "not rated" as a negative would be
 * flatly false, so the copy below says so in plain words and the tone stays
 * neutral ('none'), never 'bad'.
 */
export function safetyRatingExplainer(code: string | null): string {
  switch ((code || '').toUpperCase()) {
    case 'S':
      return 'FMCSA assigned a Satisfactory rating after a compliance review.';
    case 'C':
      return 'FMCSA assigned a Conditional rating after a compliance review, meaning it found deficiencies at the time of that review. It does not stop the carrier operating.';
    case 'U':
      return 'FMCSA assigned an Unsatisfactory rating after a compliance review.';
    default:
      return 'Most carriers are unrated. FMCSA only issues a safety rating after it conducts a compliance review, and it has not reviewed the majority of registered carriers. Unrated does not mean the carrier failed a review — it means no review has produced a rating.';
  }
}

/** ISO-ish "as of" date for display, e.g. "30 Aug 2026". UTC to stay stable. */
export function formatAsOf(d: Date): string {
  return d.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * `report_date` boundary (YYYYMMDD, the format the Crash File stores) for the
 * start of the rolling window. Pure + injectable `now` so tests are stable.
 */
export function crashWindowStart(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCMonth(d.getUTCMonth() - SAFETY_WINDOW_MONTHS);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}
