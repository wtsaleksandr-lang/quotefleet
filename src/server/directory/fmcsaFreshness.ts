/**
 * "HOW FRESH IS OUR FMCSA DATA?" — ONE ANSWER, DERIVED FROM THE DATA ITSELF.
 *
 * ─── THE CLAIM THIS MODULE RETIRED ────────────────────────────────────────
 * The homepage said "Synced daily from FMCSA data." and listed "Daily FMCSA
 * sync" as a headline stat. The cron is WEEKLY and always has been — a
 * once-a-week off-peak slot (Sunday 09:00 UTC, directoryRefreshCron.ts), gated
 * by a 6-day cooldown. The product's own carrier pages had been contradicting
 * the homepage in public for weeks, rendering "FMCSA data as of Aug 31, 2026."
 *
 * ─── WHY THIS IS NOT JUST s/daily/weekly/ ─────────────────────────────────
 * A hard-coded cadence word is a claim with no source. It was true once, the
 * schedule moved, and the copy did not — which is precisely how "daily" got
 * there. Swapping in "weekly" would buy a correct sentence and the SAME drift,
 * one schedule change from now. And a cadence is the wrong fact anyway: what a
 * visitor actually wants to know is how old the data is, not how often a job is
 * supposed to run. A cron that has been silently no-opping for a month is
 * "weekly" and useless.
 *
 * So the page states the DATA VINTAGE — `max(updated_at)` across
 * carrier_directory, the same timestamp the carrier profiles already publish —
 * and it cannot drift, because it IS the data. If the ingest stops, the date on
 * the homepage stops with it, in public.
 *
 * ─── COST: ZERO ON THE REQUEST PATH ───────────────────────────────────────
 * The vintage is folded into the persisted directory-aggregate singleton (one
 * extra `max()` inside a transaction that was already scanning), so reading it
 * is a PK lookup behind an in-memory shield. And this module never awaits it on
 * the request path at all: `fmcsaAsOfNow()` is SYNCHRONOUS, answers from a
 * process-local cache, and kicks a background refresh when that cache is stale.
 * The homepage's latency is therefore unchanged, and a DB blip degrades it to
 * the truthful cadence fallback baked into the HTML rather than to an error.
 */
import { getPersistedCarrierDataAsOf } from './queries.js';

/**
 * FMCSA record freshness → "Aug 21, 2026".
 *
 * Formatted from UTC parts so the rendered date is deterministic regardless of
 * the server's timezone — the ~334k carrier profiles are shared-cacheable and
 * must be byte-identical for every visitor. Returns '' for a missing/invalid
 * timestamp so callers omit the line rather than print "Invalid Date".
 *
 * THE single formatter for this date. pages.ts renders the per-carrier
 * "FMCSA data as of …" line through it, and the homepage renders the
 * directory-wide vintage through it, so the two can never disagree on format.
 */
export function formatFmcsaAsOf(d?: Date | null): string {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCDate()}, ${dt.getUTCFullYear()}`;
}

// ─── Process-local cache (the request path never awaits the DB) ───────────

/** How long a read vintage is served before a background refresh is kicked.
 *  The underlying value moves at most once a week, so this is generous. */
export const FMCSA_ASOF_TTL_MS = 30 * 60 * 1000;

let cache: { at: number; val: Date | null } | null = null;
let inflight: Promise<void> | null = null;

/** Background, single-flighted, never-throwing refresh of the cached vintage. */
function kickRefresh(): void {
  if (inflight) return;
  inflight = getPersistedCarrierDataAsOf()
    .then((val) => {
      cache = { at: Date.now(), val };
    })
    .catch(() => {
      // getPersistedCarrierDataAsOf already swallows; this is belt-and-braces so
      // a rejection can never surface as an unhandled promise rejection.
      cache = { at: Date.now(), val: cache?.val ?? null };
    })
    .finally(() => {
      inflight = null;
    });
}

/**
 * The current FMCSA data vintage, or `null` when it is not known yet.
 *
 * SYNCHRONOUS ON PURPOSE. The homepage is the highest-traffic, lowest-latency
 * page in the product and had no DB dependency at all; it does not acquire one
 * here. A cold cache answers `null` — the page then renders the truthful cadence
 * fallback already sitting in the HTML — and the real date takes over on the
 * next request once the background read lands.
 */
export function fmcsaAsOfNow(): Date | null {
  const c = cache;
  if (!c || Date.now() - c.at >= FMCSA_ASOF_TTL_MS) kickRefresh();
  return c?.val ?? null;
}

/** Test seam: drop the cached vintage (and any pending read's claim on it). */
export function resetFmcsaAsOfCacheForTests(): void {
  cache = null;
  inflight = null;
}

// ─── Markup substitution ──────────────────────────────────────────────────

/**
 * The two homepage elements whose text states FMCSA freshness.
 *
 * They carry a TRUTHFUL, SOURCELESS-CLAIM-FREE fallback in the static HTML
 * ("Refreshed weekly from FMCSA data" / "Weekly · FMCSA sync"), so the page is
 * honest even with no database at all, and the injector only ever UPGRADES that
 * to the real vintage. There is no state in which the page claims "daily".
 */
export const FMCSA_ASOF_SLOT = 'data-qf-fmcsa-asof';
export const FMCSA_ASOF_SHORT_SLOT = 'data-qf-fmcsa-asof-short';

/** Replace the inner HTML of the first element carrying `attr`. */
function fillSlot(html: string, attr: string, inner: string): string {
  const re = new RegExp(`(<([a-zA-Z][\\w-]*)\\b[^>]*\\s${attr}\\b[^>]*>)([\\s\\S]*?)(</\\2>)`);
  return html.replace(re, (_m, open: string, _tag: string, _old: string, close: string) => `${open}${inner}${close}`);
}

/**
 * Render the real FMCSA data vintage into a static marketing page.
 *
 * `asOf === null` (cold cache, empty directory, DB unreachable) leaves the
 * page's own fallback copy untouched — which is why that fallback must itself be
 * true. Pure + exported so the substitution is unit-tested without a DB.
 */
export function applyFmcsaFreshness(html: string, asOf: Date | null = fmcsaAsOfNow()): string {
  const label = formatFmcsaAsOf(asOf);
  if (!label) return html;
  let out = fillSlot(html, FMCSA_ASOF_SLOT, `FMCSA data as of ${label}.`);
  out = fillSlot(out, FMCSA_ASOF_SHORT_SLOT, `<strong>${label}</strong> FMCSA data`);
  return out;
}
