/**
 * Overview KPI aggregation — pure `summarizeKpis` correctness.
 *
 * Seeds leads straddling the current / prior window boundaries and asserts the
 * tile scalars, period-over-period deltas, conversion %, the daily/weekly
 * series bucketing, top-lane grouping, and equipment mix. No DB, no clock —
 * mirrors the weeklyDigest pure-summarizer test pattern.
 */
import { describe, it, expect } from 'vitest';
import { summarizeKpis, CONVERTED_STATUSES, type KpiLeadRow } from './overviewStats.js';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-07-15T12:00:00.000Z');

function daysAgo(n: number): Date {
  return new Date(now.getTime() - n * DAY);
}

function lead(over: Partial<KpiLeadRow> = {}): KpiLeadRow {
  return {
    createdAt: daysAgo(1),
    status: 'new',
    quotedTotal: null,
    equipment: null,
    pickupCity: null,
    deliveryCity: null,
    ...over,
  };
}

describe('summarizeKpis — tiles + deltas (30d)', () => {
  const result = summarizeKpis({
    now,
    period: '30d',
    leadRows: [
      // ── current window (4 quotes; won + booking_requested = 2 conversions) ──
      lead({ createdAt: daysAgo(1), status: 'won', quotedTotal: 1000 }),
      lead({ createdAt: daysAgo(5), status: 'booking_requested', quotedTotal: 3000 }),
      lead({ createdAt: daysAgo(10), status: 'new', quotedTotal: 2000 }),
      lead({ createdAt: daysAgo(29), status: 'lost', quotedTotal: null }),
      // ── prior window (2 quotes; 1 conversion) ──
      lead({ createdAt: daysAgo(35), status: 'won', quotedTotal: 500 }),
      lead({ createdAt: daysAgo(59), status: 'new', quotedTotal: 500 }),
      // ── outside both windows — ignored ──
      lead({ createdAt: daysAgo(70), status: 'new', quotedTotal: 9999 }),
    ],
  });

  it('splits quotes current vs prior and computes the delta %', () => {
    expect(result.tiles.quotes.current).toBe(4);
    expect(result.tiles.quotes.previous).toBe(2);
    expect(result.tiles.quotes.deltaPct).toBe(100); // (4-2)/2
  });

  it('counts conversions (won + booking_requested) and conversion %', () => {
    expect(result.tiles.won.current).toBe(2);
    expect(result.tiles.won.previous).toBe(1);
    expect(result.tiles.conversionPct).toBe(50); // 2 / 4
  });

  it('sums quoted value and averages per quote', () => {
    expect(result.tiles.quotedValue.current).toBe(6000); // 1000+3000+2000+0
    expect(result.tiles.quotedValue.previous).toBe(1000);
    expect(result.tiles.quotedValue.deltaPct).toBe(500);
    expect(result.tiles.avgQuote.current).toBe(1500); // 6000 / 4
    expect(result.tiles.avgQuote.previous).toBe(500); // 1000 / 2
    expect(result.tiles.avgQuote.deltaPct).toBe(200);
  });

  it('reports period on the result', () => {
    expect(result.period).toBe('30d');
  });
});

describe('summarizeKpis — deltaPct is null with no prior baseline', () => {
  it('returns null (not ∞) when the previous window is empty', () => {
    const result = summarizeKpis({
      now,
      period: '7d',
      leadRows: [lead({ createdAt: daysAgo(1), status: 'won', quotedTotal: 100 })],
    });
    expect(result.tiles.quotes.current).toBe(1);
    expect(result.tiles.quotes.previous).toBe(0);
    expect(result.tiles.quotes.deltaPct).toBeNull();
    expect(result.tiles.avgQuote.deltaPct).toBeNull();
  });
});

describe('summarizeKpis — series bucketing', () => {
  it('emits 30 daily buckets for 30d and tiles the window', () => {
    const result = summarizeKpis({
      now,
      period: '30d',
      leadRows: [
        lead({ createdAt: daysAgo(1) }), // newest → last bucket
        lead({ createdAt: daysAgo(10) }),
        lead({ createdAt: daysAgo(29) }), // oldest in window → near first bucket
      ],
    });
    expect(result.series).toHaveLength(30);
    const total = result.series.reduce((s, p) => s + p.quotes, 0);
    expect(total).toBe(3);
    // First bucket starts 30 days before `now`.
    expect(result.series[0].date).toBe('2026-06-15');
    // Newest lead (1 day ago) lands in the final daily bucket.
    expect(result.series[29].quotes).toBe(1);
  });

  it('emits weekly buckets for 90d', () => {
    const result = summarizeKpis({
      now,
      period: '90d',
      leadRows: [lead({ createdAt: daysAgo(3) }), lead({ createdAt: daysAgo(80) })],
    });
    expect(result.series).toHaveLength(13); // ceil(90 / 7)
    const total = result.series.reduce((s, p) => s + p.quotes, 0);
    expect(total).toBe(2);
  });
});

describe('summarizeKpis — top lanes + equipment mix', () => {
  it('groups lanes pickup→delivery, sorts by count, caps at 5', () => {
    const rows: KpiLeadRow[] = [];
    // 6 distinct lanes so the top-5 cap is exercised; LA→CHI is busiest (3).
    for (let i = 0; i < 3; i++) rows.push(lead({ pickupCity: 'Los Angeles', deliveryCity: 'Chicago', quotedTotal: 100 }));
    for (let i = 0; i < 2; i++) rows.push(lead({ pickupCity: 'Newark', deliveryCity: 'Boston', quotedTotal: 200 }));
    rows.push(lead({ pickupCity: 'Miami', deliveryCity: 'Atlanta' }));
    rows.push(lead({ pickupCity: 'Dallas', deliveryCity: 'Houston' }));
    rows.push(lead({ pickupCity: 'Seattle', deliveryCity: 'Portland' }));
    rows.push(lead({ pickupCity: 'Denver', deliveryCity: 'Phoenix' }));

    const result = summarizeKpis({ now, period: '30d', leadRows: rows });
    expect(result.topLanes).toHaveLength(5);
    expect(result.topLanes[0]).toEqual({ lane: 'Los Angeles → Chicago', count: 3, value: 300 });
    expect(result.topLanes[1]).toEqual({ lane: 'Newark → Boston', count: 2, value: 400 });
  });

  it('counts equipment mix, sorted by count, skipping blanks', () => {
    const result = summarizeKpis({
      now,
      period: '30d',
      leadRows: [
        lead({ equipment: 'Dry Van' }),
        lead({ equipment: 'Dry Van' }),
        lead({ equipment: 'Reefer' }),
        lead({ equipment: '' }),
        lead({ equipment: null }),
      ],
    });
    expect(result.equipmentMix).toEqual([
      { equipment: 'Dry Van', count: 2 },
      { equipment: 'Reefer', count: 1 },
    ]);
  });
});

describe('CONVERTED_STATUSES', () => {
  it('is the shared won + booking_requested definition', () => {
    expect(CONVERTED_STATUSES.has('won')).toBe(true);
    expect(CONVERTED_STATUSES.has('booking_requested')).toBe(true);
    expect(CONVERTED_STATUSES.has('new')).toBe(false);
  });
});
