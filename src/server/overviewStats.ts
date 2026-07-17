/**
 * Overview KPI stats — shared, pure aggregation for the tenant dashboard.
 *
 * Single source of truth for "what counts as a conversion" (CONVERTED_STATUSES),
 * shared with the weekly digest (src/email/weeklyDigest.ts). Given a tenant's
 * leads over [now - 2*period, now), it splits them into a CURRENT and a prior
 * equal-length window and emits big-number KPI tiles (with period-over-period
 * deltas), a quotes-over-time series, the top lanes, and the equipment mix.
 *
 * No DB, no clock — fully deterministic and unit-testable, mirroring the
 * summarizeWeeklyActivity() pure-summarizer pattern so the counting logic can
 * be tested without a database.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Lead statuses that count as a "conversion" — the customer either accepted
 *  the quote (won) or asked to book it. This is the ONE definition shared by
 *  the dashboard KPIs and the weekly digest so both surfaces always agree. */
export const CONVERTED_STATUSES = new Set(['won', 'booking_requested']);

export type KpiPeriod = '7d' | '30d' | '90d';

/** period key → window length in days. */
export const PERIOD_DAYS: Record<KpiPeriod, number> = { '7d': 7, '30d': 30, '90d': 90 };

/** Narrow a raw query value to a valid period (defaults handled by callers). */
export function isKpiPeriod(v: unknown): v is KpiPeriod {
  return v === '7d' || v === '30d' || v === '90d';
}

/** Row shape the summarizer needs — narrowed so tests can seed plain objects
 *  without constructing full Drizzle rows. */
export interface KpiLeadRow {
  createdAt: Date;
  status: string;
  quotedTotal: number | null;
  equipment: string | null;
  pickupCity: string | null;
  deliveryCity: string | null;
}

export interface KpiDelta {
  current: number;
  previous: number;
  /** Whole-percent change vs the prior equal-length window. null when previous
   *  is 0 — there is no baseline to compute growth against, so the UI shows a
   *  neutral "—" instead of a fake ∞% jump. */
  deltaPct: number | null;
}

export interface KpiTiles {
  quotes: KpiDelta;
  /** Conversions (CONVERTED_STATUSES) in each window. */
  won: KpiDelta;
  /** conversions / quotes in the CURRENT window, whole percent (0 when none). */
  conversionPct: number;
  /** Sum of quotedTotal in each window (rounded to whole currency units). */
  quotedValue: KpiDelta;
  /** Mean quotedTotal per quote in each window (rounded). */
  avgQuote: KpiDelta;
}

export interface KpiSeriesPoint {
  /** ISO date (YYYY-MM-DD) of the bucket start. */
  date: string;
  quotes: number;
}

export interface KpiLane {
  /** "pickupCity → deliveryCity". */
  lane: string;
  count: number;
  value: number;
}

export interface KpiEquipment {
  equipment: string;
  count: number;
}

export interface KpiResult {
  period: KpiPeriod;
  tiles: KpiTiles;
  series: KpiSeriesPoint[];
  topLanes: KpiLane[];
  equipmentMix: KpiEquipment[];
}

export interface KpiInput {
  now: Date;
  period: KpiPeriod;
  /** Leads created since 2*period ago (both windows) for ONE tenant. */
  leadRows: KpiLeadRow[];
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Whole-percent change, or null when there is no prior baseline. */
function deltaPct(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** Pure aggregation over already-fetched rows. No DB, no clock. */
export function summarizeKpis(input: KpiInput): KpiResult {
  const { now, period, leadRows } = input;
  const periodDays = PERIOD_DAYS[period];
  const windowMs = periodDays * DAY_MS;
  const windowStart = new Date(now.getTime() - windowMs);
  const prevStart = new Date(now.getTime() - 2 * windowMs);

  let quotesCur = 0;
  let quotesPrev = 0;
  let wonCur = 0;
  let wonPrev = 0;
  let valueCur = 0;
  let valuePrev = 0;

  // Daily buckets for 7d/30d, weekly buckets for 90d — tiling the CURRENT
  // window exactly (the final 90d bucket may be short; that's fine for a trend).
  const bucketDays = period === '90d' ? 7 : 1;
  const bucketMs = bucketDays * DAY_MS;
  const numBuckets = Math.ceil(periodDays / bucketDays);
  const series: KpiSeriesPoint[] = [];
  for (let i = 0; i < numBuckets; i++) {
    series.push({ date: isoDate(new Date(windowStart.getTime() + i * bucketMs)), quotes: 0 });
  }

  const laneMap = new Map<string, KpiLane>();
  const equipMap = new Map<string, number>();

  for (const row of leadRows) {
    const t = row.createdAt.getTime();
    const val = row.quotedTotal ?? 0;
    const inCurrent = t >= windowStart.getTime() && t < now.getTime();
    const inPrevious = t >= prevStart.getTime() && t < windowStart.getTime();

    if (inCurrent) {
      quotesCur++;
      valueCur += val;
      if (CONVERTED_STATUSES.has(row.status)) wonCur++;

      const idx = Math.floor((t - windowStart.getTime()) / bucketMs);
      if (idx >= 0 && idx < numBuckets) series[idx].quotes++;

      const lane = `${row.pickupCity || '—'} → ${row.deliveryCity || '—'}`;
      const entry = laneMap.get(lane) ?? { lane, count: 0, value: 0 };
      entry.count++;
      entry.value += val;
      laneMap.set(lane, entry);

      const equipment = (row.equipment ?? '').trim();
      if (equipment) equipMap.set(equipment, (equipMap.get(equipment) ?? 0) + 1);
    } else if (inPrevious) {
      quotesPrev++;
      valuePrev += val;
      if (CONVERTED_STATUSES.has(row.status)) wonPrev++;
    }
  }

  const avgCur = quotesCur > 0 ? Math.round(valueCur / quotesCur) : 0;
  const avgPrev = quotesPrev > 0 ? Math.round(valuePrev / quotesPrev) : 0;
  const conversionPct = quotesCur > 0 ? Math.round((wonCur / quotesCur) * 100) : 0;

  const topLanes = [...laneMap.values()]
    .sort((a, b) => b.count - a.count || b.value - a.value)
    .slice(0, 5);

  const equipmentMix = [...equipMap.entries()]
    .map(([equipment, count]) => ({ equipment, count }))
    .sort((a, b) => b.count - a.count);

  return {
    period,
    tiles: {
      quotes: { current: quotesCur, previous: quotesPrev, deltaPct: deltaPct(quotesCur, quotesPrev) },
      won: { current: wonCur, previous: wonPrev, deltaPct: deltaPct(wonCur, wonPrev) },
      conversionPct,
      quotedValue: {
        current: Math.round(valueCur),
        previous: Math.round(valuePrev),
        deltaPct: deltaPct(valueCur, valuePrev),
      },
      avgQuote: { current: avgCur, previous: avgPrev, deltaPct: deltaPct(avgCur, avgPrev) },
    },
    series,
    topLanes,
    equipmentMix,
  };
}
