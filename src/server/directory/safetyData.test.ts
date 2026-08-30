import { describe, expect, it } from 'vitest';
import {
  EMPTY_SAFETY,
  MIN_INSPECTIONS_FOR_RATE,
  NATIONAL_DRIVER_OOS_RATE,
  NATIONAL_VEHICLE_OOS_RATE,
  SAFETY_WINDOW_MONTHS,
  buildCarrierSafety,
  compareToNational,
  comparisonPhrase,
  crashWindowStart,
  formatAsOf,
  formatRate,
  oosRate,
  safetyRatingExplainer,
  toCount,
  type CrashAggRow,
  type SmsSafetyRow,
} from './safetyData.js';
import {
  CARRIER_CHANGED_SQL,
  CARRIER_MUTABLE_COLUMNS,
  CARRIER_SAFETY_COLUMNS,
  CARRIER_UPSERT_SET,
  filterAndNormalizeCarriers,
  safetyColumnSql,
  type LiCarrierRow,
  type SafetyLookup,
} from './carrierIngest.js';

/**
 * REAL rows captured from the live FMCSA Socrata API on 2026-08-30 and frozen
 * here as a fixture. CI must never hit the portal — being a good citizen of a
 * free public API means not hammering it on every push — but the shapes below
 * are genuine, so a schema drift upstream shows up as a test that no longer
 * matches reality rather than as a test that was always fictional.
 *
 *   SMS AB PassProperty (4y6x-dmck), DOT 74432
 *   Crash File (aayw-vxb3) $group=dot_number over the 24-month window, DOT 74432
 */
const SMS_FIXTURE: SmsSafetyRow = {
  dot_number: '74432',
  insp_total: '5043',
  driver_insp_total: '5034',
  driver_oos_insp_total: '26',
  vehicle_insp_total: '2658',
  vehicle_oos_insp_total: '381',
};
const CRASH_FIXTURE: CrashAggRow = {
  dot_number: '74432',
  crashes: '200',
  fatalities: '7',
  injuries: '67',
  tow_aways: '192',
};

const AS_OF = new Date('2026-08-30T00:00:00Z');

describe('toCount — "no record" must never collapse into "zero"', () => {
  it('parses a real count', () => {
    expect(toCount('5043')).toBe(5043);
  });

  it('keeps a genuine zero as 0, NOT null', () => {
    // A carrier FMCSA inspected zero times is different from a carrier FMCSA
    // has no row for. Both must survive the round-trip distinctly.
    expect(toCount('0')).toBe(0);
  });

  it('returns null (not 0) for absent / blank / garbage', () => {
    for (const v of [undefined, null, '', '   ', 'N/A', 'abc']) expect(toCount(v)).toBeNull();
  });

  it('rejects negatives rather than publishing a nonsense count', () => {
    expect(toCount('-3')).toBeNull();
  });
});

describe('buildCarrierSafety', () => {
  it('maps a real SMS + crash pair onto the persisted shape', () => {
    const s = buildCarrierSafety(SMS_FIXTURE, CRASH_FIXTURE, AS_OF, true);
    expect(s).toEqual({
      inspTotal: 5043,
      driverInspTotal: 5034,
      driverOosTotal: 26,
      vehicleInspTotal: 2658,
      vehicleOosTotal: 381,
      crashesTotal: 200,
      crashesFatal: 7,
      crashesInjury: 67,
      crashesTow: 192,
      safetyDataAsOf: AS_OF,
    });
  });

  it('with no as-of stamp returns the all-null record', () => {
    expect(buildCarrierSafety(SMS_FIXTURE, CRASH_FIXTURE, null, true)).toEqual(EMPTY_SAFETY);
  });

  it('treats ABSENCE from a SUCCESSFUL crash group-by as a real zero', () => {
    // The crash query is a GROUP BY across every DOT on the page, so a carrier
    // missing from the result genuinely had no crashes in the window.
    const s = buildCarrierSafety(SMS_FIXTURE, undefined, AS_OF, true);
    expect(s.crashesTotal).toBe(0);
    expect(s.crashesFatal).toBe(0);
  });

  it('leaves crashes NULL when the crash fetch FAILED', () => {
    // The critical distinction: a failed fetch must not publish a clean crash
    // record we never actually verified.
    const s = buildCarrierSafety(SMS_FIXTURE, undefined, AS_OF, false);
    expect(s.crashesTotal).toBeNull();
    expect(s.crashesFatal).toBeNull();
    // …but the SMS half that DID succeed still lands.
    expect(s.inspTotal).toBe(5043);
  });

  it('leaves inspection counts NULL for a carrier absent from the SMS file', () => {
    // ~26% of directory carriers have no SMS row at all. They must read as
    // "no record", never as a carrier with zero inspections.
    const s = buildCarrierSafety(undefined, CRASH_FIXTURE, AS_OF, true);
    expect(s.inspTotal).toBeNull();
    expect(s.driverInspTotal).toBeNull();
    expect(s.crashesTotal).toBe(200);
  });
});

describe('oosRate — a percentage is only published when it means something', () => {
  it('computes the rate on a healthy sample', () => {
    expect(oosRate(26, 5034)).toBeCloseTo(26 / 5034, 10);
  });

  it('SUPPRESSES the rate below the minimum sample', () => {
    // 1-of-1 is not a "100% out-of-service carrier"; publishing that about a
    // real business would be a smear built out of noise.
    expect(oosRate(1, 1)).toBeNull();
    expect(oosRate(1, MIN_INSPECTIONS_FOR_RATE - 1)).toBeNull();
  });

  it('publishes at exactly the minimum sample', () => {
    expect(oosRate(1, MIN_INSPECTIONS_FOR_RATE)).toBeCloseTo(1 / MIN_INSPECTIONS_FOR_RATE, 10);
  });

  it('returns null when either side is missing', () => {
    expect(oosRate(null, 500)).toBeNull();
    expect(oosRate(5, null)).toBeNull();
  });

  it('refuses an impossible >100% rate from a bad upstream row', () => {
    expect(oosRate(20, 10)).toBeNull();
  });

  it('a genuine clean record still renders as 0%', () => {
    expect(oosRate(0, 500)).toBe(0);
  });
});

describe('compareToNational — arithmetic, never a verdict', () => {
  it('calls a materially lower rate "below"', () => {
    expect(compareToNational(0.005, NATIONAL_DRIVER_OOS_RATE)).toBe('below');
  });

  it('calls a materially higher rate "above"', () => {
    expect(compareToNational(0.3, NATIONAL_VEHICLE_OOS_RATE)).toBe('above');
  });

  it('treats a hair either side of the benchmark as noise, not signal', () => {
    expect(compareToNational(NATIONAL_DRIVER_OOS_RATE, NATIONAL_DRIVER_OOS_RATE)).toBe('near');
    expect(compareToNational(NATIONAL_DRIVER_OOS_RATE * 1.05, NATIONAL_DRIVER_OOS_RATE)).toBe('near');
    expect(compareToNational(NATIONAL_DRIVER_OOS_RATE * 0.95, NATIONAL_DRIVER_OOS_RATE)).toBe('near');
  });

  it('never emits a judgement word', () => {
    for (const cmp of ['below', 'near', 'above'] as const) {
      const phrase = comparisonPhrase(cmp);
      expect(phrase).toMatch(/national average/);
      expect(phrase).not.toMatch(/unsafe|dangerous|poor|bad|good|excellent|risky/i);
    }
  });
});

describe('safetyRatingExplainer — "not rated" must never read as bad', () => {
  it('explains that unrated is normal and is not a failure', () => {
    const txt = safetyRatingExplainer(null);
    expect(txt).toMatch(/Most carriers are unrated/i);
    expect(txt).toMatch(/does not mean the carrier failed/i);
    // The words that would turn an un-reviewed company into an accused one.
    expect(txt).not.toMatch(/unsafe|dangerous|poor|risky|avoid/i);
  });

  it('gives the same neutral copy for an unrecognised code', () => {
    expect(safetyRatingExplainer('')).toBe(safetyRatingExplainer(null));
    expect(safetyRatingExplainer('X')).toBe(safetyRatingExplainer(null));
  });

  it('states each real rating as an FMCSA finding, not our own', () => {
    for (const code of ['S', 'C', 'U']) {
      expect(safetyRatingExplainer(code)).toMatch(/FMCSA assigned/);
    }
    expect(safetyRatingExplainer('s')).toMatch(/Satisfactory/);
  });

  it('never editorialises about a Conditional or Unsatisfactory carrier', () => {
    for (const code of ['C', 'U']) {
      expect(safetyRatingExplainer(code)).not.toMatch(/unsafe|dangerous|avoid|do not use/i);
    }
  });
});

describe('formatting', () => {
  it('renders a rate to one decimal place', () => {
    expect(formatRate(0.0543)).toBe('5.4%');
    expect(formatRate(0)).toBe('0.0%');
  });

  it('renders the as-of date in UTC so it never drifts by timezone', () => {
    expect(formatAsOf(new Date('2026-08-30T23:30:00Z'))).toBe('Aug 30, 2026');
  });
});

describe('crashWindowStart', () => {
  it('walks back exactly the SMS measurement period, in YYYYMMDD', () => {
    expect(crashWindowStart(new Date('2026-08-30T12:00:00Z'))).toBe('20240830');
    expect(SAFETY_WINDOW_MONTHS).toBe(24);
  });

  it('is stable across a month boundary', () => {
    expect(crashWindowStart(new Date('2026-01-15T00:00:00Z'))).toBe('20240115');
  });
});

// ─── Ingest wiring ────────────────────────────────────────────────────────
const LI: LiCarrierRow = {
  dot_number: '00074432',
  docket_number: 'MC012892',
  common_stat: 'A',
  property_chk: 'Y',
  legal_name: 'FIXTURE CARRIER INC',
  bus_state_code: 'TX',
};

const lookup = (over: Partial<SafetyLookup> = {}): SafetyLookup => ({
  sms: new Map([['74432', SMS_FIXTURE]]),
  crashes: new Map([['74432', CRASH_FIXTURE]]),
  asOf: AS_OF,
  crashQueried: true,
  ...over,
});

describe('filterAndNormalizeCarriers — safety wiring', () => {
  it('joins safety on the ZERO-STRIPPED dot number (L&I zero-pads)', () => {
    // L&I says "00074432"; the SMS/crash files say "74432". A join that forgot
    // to strip would silently produce no safety data for every carrier.
    const [rec] = filterAndNormalizeCarriers([LI], new Map(), false, lookup());
    expect(rec.usdot).toBe('74432');
    expect(rec.safety.inspTotal).toBe(5043);
    expect(rec.safety.crashesTotal).toBe(200);
    expect(rec.safety.safetyDataAsOf).toEqual(AS_OF);
  });

  it('defaults to the all-null record when no lookup is supplied', () => {
    const [rec] = filterAndNormalizeCarriers([LI], new Map());
    expect(rec.safety).toEqual(EMPTY_SAFETY);
  });

  it('records no safety at all when BOTH fetches failed', () => {
    const [rec] = filterAndNormalizeCarriers(
      [LI],
      new Map(),
      false,
      lookup({ sms: new Map(), crashes: new Map(), asOf: null, crashQueried: false }),
    );
    expect(rec.safety).toEqual(EMPTY_SAFETY);
  });
});

describe('safety upsert — a failed fetch must never wipe stored data', () => {
  it('keeps the stored value when the incoming as-of is null', () => {
    const expr = safetyColumnSql('insp_total');
    expect(expr).toBe(
      `CASE WHEN excluded."safety_data_as_of" IS NOT NULL THEN excluded."insp_total" ELSE "carrier_directory"."insp_total" END`,
    );
  });

  it('gates every safety column on the same as-of stamp, so the block is atomic', () => {
    // Half-written safety (new inspections, stale crashes) would be worse than
    // either — the block has one as-of date, so it moves as one unit.
    for (const col of CARRIER_SAFETY_COLUMNS) {
      expect(safetyColumnSql(col)).toContain('excluded."safety_data_as_of" IS NOT NULL');
    }
  });

  it('routes safety columns through the CASE in the upsert SET, not a bare excluded.', () => {
    const set = CARRIER_UPSERT_SET as unknown as Record<string, { toString(): string }>;
    for (const prop of ['inspTotal', 'crashesTotal', 'safetyDataAsOf']) {
      expect(Object.keys(set)).toContain(prop);
    }
  });

  it('compares the EFFECTIVE safety value in the change tuple', () => {
    // If the raw `excluded.` value were compared, a failed safety fetch would
    // look like "every safety column just went null" on all ~330k rows, bump
    // every updated_at, and reintroduce the fake weekly <lastmod> freshness that
    // CARRIER_CHANGED_SQL exists to prevent.
    for (const col of CARRIER_SAFETY_COLUMNS) {
      expect(CARRIER_CHANGED_SQL).toContain(safetyColumnSql(col));
    }
  });

  it('still lists the safety columns as mutable, so none is silently skipped', () => {
    for (const col of CARRIER_SAFETY_COLUMNS) expect(CARRIER_MUTABLE_COLUMNS).toContain(col);
  });

  it('never touches the carrier contact opt-out', () => {
    expect(CARRIER_SAFETY_COLUMNS).not.toContain('contact_hidden');
  });
});
