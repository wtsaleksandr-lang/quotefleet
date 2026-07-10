/**
 * EIA weekly national diesel price — fetch, cache, and per-tenant FSC resolver.
 *
 * Source of truth: US Energy Information Administration (EIA), weekly U.S.
 * No. 2 on-highway diesel retail price, series EMD_EPD2D_PTE_NUS_DPG. This is
 * a US-Government work → public domain, free to fetch and redistribute.
 *
 * Primary  : EIA API v2  (needs a free EIA_API_KEY).
 * Fallback : USDA agtransport Socrata dataset (keyless) which republishes the
 *            same EIA weekly on-highway series — used when no key is set or the
 *            EIA request fails.
 *
 * The latest price + as-of date are cached in `platform_settings` (global, not
 * per-tenant) and refreshed weekly (via the cron below, or lazily on read when
 * the cached value is older than AUTO_FSC_DEFAULTS.refreshAfterDays). A quote
 * must NEVER break on a fetch failure: read falls back to the last cached value,
 * then to a sane default.
 */
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { platformSettings, type Tenant } from '../db/schema.js';
import { AUTO_FSC_DEFAULTS } from '../calc/defaults.js';
import { autoFscPerMile } from '../calc/fuelSurcharge.js';

const CACHE_KEY = 'eia_diesel_weekly';
const EIA_SERIES = 'EMD_EPD2D_PTE_NUS_DPG';
const DAY_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 12_000;

/** EIA national weekly diesel price, plus provenance. */
export interface DieselPrice {
  /** $/gallon national average. */
  usdPerGal: number;
  /** ISO date (YYYY-MM-DD) the price is "as of" (EIA period). */
  asOf: string;
  /** Where this value came from on the most recent resolve. */
  source: 'eia' | 'usda' | 'cache' | 'default';
  /** True when we could not refresh and are serving a >7-day-old / default value. */
  stale: boolean;
  /** When the cached value was last successfully fetched (ISO), if any. */
  fetchedAt?: string;
}

interface CachedShape {
  usdPerGal: number;
  asOf: string;
  fetchedAt: string;
  source: 'eia' | 'usda';
}

async function withTimeout(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** Primary: EIA API v2. Returns null on any failure (caller falls back). */
async function fetchFromEia(): Promise<{ usdPerGal: number; asOf: string } | null> {
  const key = process.env.EIA_API_KEY;
  if (!key) return null;
  try {
    const params = new URLSearchParams({
      api_key: key,
      frequency: 'weekly',
      'data[0]': 'value',
      'facets[series][]': EIA_SERIES,
      'sort[0][column]': 'period',
      'sort[0][direction]': 'desc',
      length: '1',
    });
    const url = `https://api.eia.gov/v2/petroleum/pri/gnd/data/?${params.toString()}`;
    const res = await withTimeout(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      response?: { data?: Array<{ period?: string; value?: number | string }> };
    };
    const row = json.response?.data?.[0];
    if (!row) return null;
    const usdPerGal = Number(row.value);
    const asOf = String(row.period ?? '').slice(0, 10);
    if (!Number.isFinite(usdPerGal) || usdPerGal <= 0 || !asOf) return null;
    return { usdPerGal, asOf };
  } catch {
    return null;
  }
}

/**
 * Fallback: USDA agtransport Socrata (keyless) — republishes EIA's weekly
 * on-highway diesel. Filter to the national ("U.S.") region, newest first.
 */
async function fetchFromUsda(): Promise<{ usdPerGal: number; asOf: string } | null> {
  try {
    const params = new URLSearchParams({
      '$select': 'date,diesel_price,region',
      '$where': "region='US'",
      '$order': 'date DESC',
      '$limit': '1',
    });
    const url = `https://agtransport.usda.gov/resource/x88w-atzp.json?${params.toString()}`;
    const res = await withTimeout(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const arr = (await res.json()) as Array<{ date?: string; diesel_price?: number | string }>;
    const row = Array.isArray(arr) ? arr[0] : undefined;
    if (!row) return null;
    const usdPerGal = Number(row.diesel_price);
    const asOf = String(row.date ?? '').slice(0, 10);
    if (!Number.isFinite(usdPerGal) || usdPerGal <= 0 || !asOf) return null;
    return { usdPerGal, asOf };
  } catch {
    return null;
  }
}

async function readCache(): Promise<CachedShape | null> {
  try {
    const row = (
      await db()
        .select({ value: platformSettings.value })
        .from(platformSettings)
        .where(eq(platformSettings.key, CACHE_KEY))
        .limit(1)
    )[0];
    if (!row) return null;
    const parsed = JSON.parse(row.value) as CachedShape;
    if (!Number.isFinite(parsed.usdPerGal) || parsed.usdPerGal <= 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeCache(v: CachedShape): Promise<void> {
  const value = JSON.stringify(v);
  await db()
    .insert(platformSettings)
    .values({ key: CACHE_KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: platformSettings.key, set: { value, updatedAt: new Date() } });
}

function ageMs(fetchedAtIso: string): number {
  const t = Date.parse(fetchedAtIso);
  return Number.isFinite(t) ? Date.now() - t : Number.POSITIVE_INFINITY;
}

/** Fetch from EIA then USDA. Returns null if both fail. */
async function fetchFresh(): Promise<CachedShape | null> {
  const eia = await fetchFromEia();
  if (eia) return { ...eia, fetchedAt: new Date().toISOString(), source: 'eia' };
  const usda = await fetchFromUsda();
  if (usda) return { ...usda, fetchedAt: new Date().toISOString(), source: 'usda' };
  return null;
}

/**
 * Current national diesel price. Never throws.
 *
 * @param opts.forceRefresh  ignore cache age and refetch (used by the cron).
 */
export async function getDieselPrice(opts?: { forceRefresh?: boolean }): Promise<DieselPrice> {
  const refreshMs = AUTO_FSC_DEFAULTS.refreshAfterDays * DAY_MS;
  let cache: CachedShape | null = null;
  try {
    cache = await readCache();
  } catch {
    cache = null;
  }

  const needsRefresh = opts?.forceRefresh || !cache || ageMs(cache.fetchedAt) > refreshMs;
  if (needsRefresh) {
    const fresh = await fetchFresh();
    if (fresh) {
      try {
        await writeCache(fresh);
      } catch {
        /* cache write is best-effort */
      }
      return { usdPerGal: fresh.usdPerGal, asOf: fresh.asOf, source: fresh.source, stale: false, fetchedAt: fresh.fetchedAt };
    }
    // Fetch failed — serve stale cache if we have it, else the safe default.
    if (cache) {
      return { usdPerGal: cache.usdPerGal, asOf: cache.asOf, source: 'cache', stale: true, fetchedAt: cache.fetchedAt };
    }
    return { usdPerGal: AUTO_FSC_DEFAULTS.fallbackDieselUsdPerGal, asOf: '', source: 'default', stale: true };
  }

  // Cache is fresh enough.
  return { usdPerGal: cache!.usdPerGal, asOf: cache!.asOf, source: 'cache', stale: false, fetchedAt: cache!.fetchedAt };
}

/** Compact MM/DD label for display, from an ISO YYYY-MM-DD date. */
export function asOfLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${m[2]}/${m[3]}` : '';
}

/** Fuel-surcharge context handed to the calc engine. */
export interface FscContext {
  mode: 'manual' | 'auto';
  /** Present only when mode==='auto': surcharge dollars per mile. */
  perMileUsd?: number;
  dieselUsd?: number;
  /** ISO as-of date of the diesel price. */
  asOf?: string;
  stale?: boolean;
}

/**
 * Resolve the FSC context for a tenant. For 'manual' tenants this is a no-op
 * (`{ mode: 'manual' }`) and the engine keeps using each card's fixed pct.
 * For 'auto' it loads the (cached) diesel price and computes $/mile.
 * Never throws — on any error it degrades to manual so a quote never breaks.
 */
export async function resolveFscForTenant(tenant: Pick<Tenant, 'fscMode'>): Promise<FscContext> {
  if (tenant.fscMode !== 'auto') return { mode: 'manual' };
  try {
    const diesel = await getDieselPrice();
    const perMileUsd = autoFscPerMile({
      dieselUsdPerGal: diesel.usdPerGal,
      pegUsdPerGal: AUTO_FSC_DEFAULTS.pegUsdPerGal,
      mpg: AUTO_FSC_DEFAULTS.mpg,
    });
    return {
      mode: 'auto',
      perMileUsd,
      dieselUsd: diesel.usdPerGal,
      asOf: diesel.asOf,
      stale: diesel.stale,
    };
  } catch {
    return { mode: 'manual' };
  }
}

// ────────────────────────────────────────────────────────────────────
// Weekly refresh cron (mirrors src/marketplace/cron.ts). In-process
// setInterval — fine for a single-instance Replit deploy. Honors
// FUEL_CRON_DISABLED=1 (tests / second instance).
// ────────────────────────────────────────────────────────────────────
const WEEK_MS = 7 * DAY_MS;
const STARTUP_DELAY_MS = 45 * 1000;
let cronStarted = false;

export function startFuelSurchargeCron(): void {
  if (cronStarted) return;
  if (process.env.FUEL_CRON_DISABLED === '1') {
    console.log('[fsc.cron] disabled via FUEL_CRON_DISABLED=1');
    return;
  }
  cronStarted = true;
  setTimeout(() => void refreshOnce('startup'), STARTUP_DELAY_MS);
  setInterval(() => void refreshOnce('weekly'), WEEK_MS);
  console.log(
    `[fsc.cron] scheduled — first run in ${STARTUP_DELAY_MS / 1000}s, then every ${WEEK_MS / DAY_MS} days`
  );
}

async function refreshOnce(reason: string): Promise<void> {
  try {
    const p = await getDieselPrice({ forceRefresh: true });
    console.log(`[fsc.cron] diesel refreshed (${reason}): $${p.usdPerGal}/gal as of ${p.asOf || 'n/a'} (${p.source})`);
  } catch (err) {
    console.warn(`[fsc.cron] refresh failed (${reason}):`, err);
  }
}
