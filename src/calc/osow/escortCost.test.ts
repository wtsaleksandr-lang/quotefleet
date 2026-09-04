/**
 * ESCORT COST — the two channels, and the wall between them.
 *
 * The claims worth pinning here are not arithmetic ones. They are:
 *
 *   1. a state that PUBLISHES a trooper rate produces a cited floor that
 *      reproduces that state's own published arithmetic;
 *   2. a state that publishes NONE says so, with the finding, and never $0;
 *   3. the civilian side defaults to "we hold no pilot-car rates" and takes the
 *      CALLER's rate when there is one, rather than synthesising a market rate;
 *   4. our optional fallback band is always a band and never collapses to a
 *      point;
 *   5. nothing in this module can move a permit fee by a cent.
 */
import { describe, it, expect } from 'vitest';
import { calculateOsow, type OsowLoad } from './engine.js';
import {
  ESCORT_ESTIMATE_DISCLAIMER,
  ESCORT_NO_RATE_NOTE,
  ESCORT_USER_RATE_NOTE,
  NO_PUBLISHED_POLICE_ESCORT_RATE,
  POLICE_ESCORT_RATES,
  QUOTEFLEET_INTERNAL_PILOT_CAR_BAND,
  estimateLaneEscortCost,
  policeEscortFloorUsd,
  type LaneEscortEstimate,
  type UserPilotCarRate,
} from './escortCost.js';
import { OSOW_JURISDICTIONS } from './jurisdictions/index.js';

const ASOF = '2026-09-03';

interface Leg {
  code: string;
  miles: number;
}

function price(
  load: OsowLoad,
  legs: Leg[],
  options: { pilotCarRate?: UserPilotCarRate; useInternalBand?: boolean } = {},
): LaneEscortEstimate {
  const quote = calculateOsow(
    legs.map((l) => ({ code: l.code, milesInJurisdiction: l.miles })),
    load,
    ASOF,
  );
  return estimateLaneEscortCost(
    quote,
    Object.fromEntries(legs.map((l) => [l.code, l.miles])),
    { asOf: ASOF, ...options },
  );
}

/** 19 ft wide trips the police trigger in Illinois, New York and Tennessee. */
const WIDE_LOAD: OsowLoad = {
  grossWeightLbs: 150_000,
  widthIn: 19 * 12,
  heightIn: 14 * 12,
  overallLengthIn: 100 * 12,
  axleCount: 9,
  routeClass: 'interstate',
};

// ═══════════════════════════════════════════════════════════════════════════
describe('the police-rate dataset', () => {
  it('covers every jurisdiction exactly once, as a rate or as a positive absence', () => {
    const withRate = new Set(POLICE_ESCORT_RATES.map((r) => r.value.jurisdiction));
    const withoutRate = new Set(NO_PUBLISHED_POLICE_ESCORT_RATE.map((n) => n.jurisdiction));
    const covered = Object.keys(OSOW_JURISDICTIONS);

    expect([...withRate].sort()).toEqual(['AL', 'IL', 'IN', 'LA', 'NY', 'TN']);
    expect(withoutRate.size).toBe(15);
    // No state may be in both lists, and between them they must be the whole
    // corpus — a state in neither would silently fall through to "no finding".
    const overlap = [...withRate].filter((c) => withoutRate.has(c));
    const missing = covered.filter((c) => !withRate.has(c) && !withoutRate.has(c));
    expect({ overlap, missing }).toEqual({ overlap: [], missing: [] });
  });

  it('cites a real document on every rate row and points at a real rule on every absence', () => {
    const defects: string[] = [];
    for (const row of POLICE_ESCORT_RATES) {
      if (!row.source.url.startsWith('http')) defects.push(`${row.value.jurisdiction}: no URL`);
      if (row.source.retrievedOn === '') defects.push(`${row.value.jurisdiction}: no retrievedOn`);
      if (row.value.triggeringEscortRuleIds.length === 0) {
        defects.push(`${row.value.jurisdiction}: no triggering rule ids`);
      }
      const known = new Set(
        (OSOW_JURISDICTIONS[row.value.jurisdiction]?.escortRules ?? []).map((r) => r.id),
      );
      for (const id of row.value.triggeringEscortRuleIds) {
        if (!known.has(id)) defects.push(`${row.value.jurisdiction}: unknown rule ${id}`);
      }
    }
    for (const finding of NO_PUBLISHED_POLICE_ESCORT_RATE) {
      const known = new Set(
        (OSOW_JURISDICTIONS[finding.jurisdiction]?.escortRules ?? []).map((r) => r.id),
      );
      if (!known.has(finding.escortRuleId)) {
        defects.push(`${finding.jurisdiction}: unknown rule ${finding.escortRuleId}`);
      }
    }
    expect(defects).toEqual([]);
  });

  it('reproduces each state\'s own published floor arithmetic', () => {
    const floorFor = (code: string, officers: number): number | null => {
      const row = POLICE_ESCORT_RATES.find(
        (r) => r.value.jurisdiction === code && r.value.usdPerHourPerOfficer !== null,
      );
      return row === undefined ? null : policeEscortFloorUsd(row.value, officers);
    };
    expect({
      // TDOT prints its own working: "2 officers x 4 hours x $65.00 = $520.00".
      TN: floorFor('TN', 2),
      // NYSDOT's dataset: "a single officer costs at least $433.98" (3 h overtime).
      NY: floorFor('NY', 1),
      // ALEA: $200.00 administrative fee + four hours at $100.00, two officers.
      AL: floorFor('AL', 2),
      // P.O. 1107: "$75.00 per hour with a two-hour minimum."
      LA: floorFor('LA', 1),
      // 625 ILCS 5/15-312: "minimum $500 per vehicle" — a money floor, not hours.
      IL: floorFor('IL', 1),
    }).toEqual({ TN: 520, NY: 433.98, AL: 1000, LA: 150, IL: 500 });
  });

  it('refuses a floor for a state that publishes a rate and no minimum', () => {
    const indiana = POLICE_ESCORT_RATES.find((r) => r.value.jurisdiction === 'IN');
    expect(indiana?.value.usdPerHourPerOfficer).toBe(43);
    // Null, not zero. $43 x 0 hours is not "a police escort is free".
    expect(policeEscortFloorUsd(indiana?.value as never, 1)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('a state that publishes a police-escort rate', () => {
  const est = price(WIDE_LOAD, [{ code: 'TN', miles: 300 }]);
  const tn = est.byJurisdiction[0];

  it('prices the published floor and cites the document it came from', () => {
    expect(tn?.policeRequired).toBe(true);
    expect(tn?.policeOfficers).toBe(2);
    expect(tn?.policeFloorUsd).toBe(520);
    expect(tn?.policeSources.map((s) => s.publisher)).toContain(
      'Tennessee Department of Transportation, Traffic Operations Division',
    );
    expect(tn?.warnings.join(' ')).toMatch(/FLOOR/);
  });

  it('calls it a floor and never a total, and keeps it out of the permit fees', () => {
    expect(tn?.warnings.join(' ')).toMatch(/never a total/i);
    expect(tn?.warnings.join(' ')).toMatch(/not part of the permit total/i);
    // The hours are set on the day, so a floor is always a reason to look.
    expect(est.requiresManualReview).toBe(true);
  });

  it('bills the state\'s own two-officer minimum even though it publishes no count', () => {
    expect(tn?.policeCountUnpublished).toBe(true);
    expect(tn?.warnings.join(' ')).toMatch(/does not publish HOW MANY/);
  });
});

describe('a state that publishes none', () => {
  // Florida over 16 ft high assigns one law-enforcement escort by position, and
  // publishes no rate for it anywhere — FHP escorts are off-duty employment.
  const est = price(
    {
      grossWeightLbs: 90_000,
      widthIn: 12 * 12,
      heightIn: 17 * 12,
      overallLengthIn: 90 * 12,
      axleCount: 6,
      routeClass: 'fl-limited-access',
    },
    [{ code: 'FL', miles: 400 }],
  );
  const fl = est.byJurisdiction[0];

  it('says the escort is required and its cost is unknown — never $0', () => {
    expect(fl?.policeRequired).toBe(true);
    expect(fl?.policeFloorUsd).toBeNull();
    expect(fl?.policeFloorLowUsd).toBeNull();
    expect(est.policeFloorUsd).toBeNull();
    expect(est.policeStatesWithoutFloor).toEqual(['FL']);
  });

  it('ships the POSITIVE finding, not a shrug', () => {
    const text = fl?.warnings.join(' ') ?? '';
    expect(text).toMatch(/publishes no rate/i);
    expect(text).toMatch(/OFF-DUTY POLICE EMPLOYMENT/i);
    expect(text).toMatch(/fl-length-over-250/);
    expect(text).toMatch(/unknown — not zero/i);
    expect(est.requiresManualReview).toBe(true);
  });
});

describe('two published schedules that disagree', () => {
  // Illinois: the 2026 statute charges per hour with a $500 floor; the still
  // published administrative rule charges per State Police District crossed and
  // states no hourly rate of its own.
  const est = price(WIDE_LOAD, [{ code: 'IL', miles: 200 }]);
  const il = est.byJurisdiction[0];

  it('refuses to pick, exactly as a disputed permit fee would', () => {
    expect(il?.policeRequired).toBe(true);
    expect(il?.policeFloorUsd).toBeNull();
    expect(il?.warnings.join(' ')).toMatch(/Official sources disagree/);
    expect(il?.policeSources).toHaveLength(2);
    expect(est.requiresManualReview).toBe(true);
  });
});

describe('a lane mixing both', () => {
  const est = price(WIDE_LOAD, [
    { code: 'TN', miles: 300 }, // publishes a rate → $520
    { code: 'NY', miles: 120 }, // publishes a rate → $433.98
    { code: 'IL', miles: 200 }, // publishes two that disagree → no floor
    { code: 'IN', miles: 150 }, // publishes a rate and no minimum → no floor
    { code: 'LA', miles: 90 }, // publishes a rate → $150
    { code: 'AL', miles: 220 }, // publishes a rate → $600 for one officer
    { code: 'VA', miles: 180 }, // publishes none, and requires none here
  ]);

  it('sums only the states it can floor, and names the ones it cannot', () => {
    expect(est.policeFloorUsd).toBe(520 + 433.98 + 150 + 600);
    expect(est.policeStatesWithoutFloor).toEqual(['IL', 'IN']);
    expect(est.policeFloorIncomplete).toBe(true);
  });

  it('says in words that the police figure is partial rather than a total', () => {
    expect(est.warnings.join(' ')).toMatch(/INCOMPLETE — it is a partial floor, not a total/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('the civilian side defaults to the honest answer', () => {
  const est = price(WIDE_LOAD, [{ code: 'TN', miles: 300 }]);

  it('holds no pilot-car rates and says so, rather than inventing one', () => {
    expect(est.pilotCarBasis).toBe('none');
    expect(est.pilotCarUsd).toBeNull();
    expect(est.pilotCarLowUsd).toBeNull();
    expect(est.pilotCarHighUsd).toBeNull();
    expect(est.internalBand).toBeNull();
    expect(est.disclaimer).toBe(ESCORT_NO_RATE_NOTE);
    expect(est.warnings.join(' ')).toMatch(/we hold no pilot-car rates/i);
  });

  it('reports the requirement as UNKNOWN cost, never as zero', () => {
    const tn = est.byJurisdiction[0];
    expect(tn?.pilotCars).toBe(2);
    expect(tn?.pilotCarUsd).toBeNull();
    expect(tn?.warnings.join(' ')).toMatch(/UNKNOWN — not zero/);
  });

  it('reports a genuine zero where the state requires no pilot car at all', () => {
    const co = price(WIDE_LOAD, [{ code: 'CO', miles: 180 }]).byJurisdiction[0];
    expect(co?.pilotCars).toBe(0);
    expect(co?.pilotCarBasis).toBe('notApplicable');
    expect(co?.pilotCarUsd).toBe(0);
  });
});

describe('the caller\'s own rate is the primary path', () => {
  it('prices from $/mile and labels the figure as theirs', () => {
    const est = price(WIDE_LOAD, [{ code: 'TN', miles: 300 }], {
      pilotCarRate: { usdPerMile: 2.25 },
    });
    expect(est.pilotCarBasis).toBe('userSupplied');
    expect(est.pilotCarUsd).toBe(1350); // 300 mi x $2.25 x 2 pilot cars
    expect(est.disclaimer).toBe(ESCORT_USER_RATE_NOTE);
    expect(est.userRate).toEqual({ usdPerMile: 2.25 });
  });

  it('adds a day rate when the caller states the days, and honours their minimum', () => {
    const est = price(WIDE_LOAD, [{ code: 'LA', miles: 90 }], {
      pilotCarRate: {
        usdPerMile: 1.5,
        usdPerDay: 400,
        daysPerJurisdiction: 2,
        minimumUsdPerJurisdiction: 500,
      },
    });
    // 90 mi x $1.50 = $135, plus 2 days x $400 = $800 → $935, over the $500 floor.
    expect(est.byJurisdiction[0]?.pilotCarUsd).toBe(935);
    expect(est.byJurisdiction[0]?.billedDaysPerPilotCar).toBe(2);
  });

  it('applies the caller\'s own per-engagement minimum on a short crossing', () => {
    const est = price(WIDE_LOAD, [{ code: 'NY', miles: 20 }], {
      pilotCarRate: { usdPerMile: 2.25, minimumUsdPerJurisdiction: 500 },
    });
    // 20 mi x $2.25 = $45, floored at the operator's own $500.
    expect(est.byJurisdiction[0]?.pilotCarUsd).toBe(500);
    expect(est.byJurisdiction[0]?.warnings.join(' ')).toMatch(
      /short crossing does not buy a short day/,
    );
  });

  it('REFUSES a day rate with no day count instead of assuming one day', () => {
    const est = price(WIDE_LOAD, [{ code: 'TN', miles: 300 }], {
      pilotCarRate: { usdPerDay: 400 },
    });
    expect(est.pilotCarUsd).toBeNull();
    expect(est.byJurisdiction[0]?.pilotCarUsd).toBeNull();
    expect(est.warnings.join(' ')).toMatch(/one day is not a safe default/);
    expect(est.requiresManualReview).toBe(true);
  });

  it('never infers a day count from a state\'s permit validity period', () => {
    // Tennessee's single-trip permit runs ten calendar days. A 300-mile leg is
    // not a ten-day engagement, and nothing here reads that number.
    const est = price(WIDE_LOAD, [{ code: 'TN', miles: 300 }], {
      pilotCarRate: { usdPerMile: 2.25 },
    });
    expect(est.byJurisdiction[0]?.billedDaysPerPilotCar).toBeNull();
  });

  it('wins over the fallback band when both are offered', () => {
    const est = price(WIDE_LOAD, [{ code: 'TN', miles: 300 }], {
      pilotCarRate: { usdPerMile: 2.25 },
      useInternalBand: true,
    });
    expect(est.pilotCarBasis).toBe('userSupplied');
    expect(est.internalBand).toBeNull();
    expect(est.pilotCarLowUsd).toBeNull();
  });
});

describe('the fallback band, when a caller opts in', () => {
  it('is not a Sourced<T> and has nowhere to put a citation', () => {
    const keys = Object.keys(QUOTEFLEET_INTERNAL_PILOT_CAR_BAND);
    expect(keys).not.toContain('source');
    expect(keys).not.toContain('effectiveFrom');
    expect(keys).not.toContain('revisedOn');
    expect(QUOTEFLEET_INTERNAL_PILOT_CAR_BAND.lowUsdPerMile).toBeLessThan(
      QUOTEFLEET_INTERNAL_PILOT_CAR_BAND.highUsdPerMile,
    );
  });

  it('NEVER collapses its range to a point, at either layer', () => {
    const lanes: Leg[][] = [
      [{ code: 'TN', miles: 300 }],
      [{ code: 'NY', miles: 20 }],
      [{ code: 'IL', miles: 200 }, { code: 'IN', miles: 150 }],
      [{ code: 'TN', miles: 300 }, { code: 'NY', miles: 120 }, { code: 'VA', miles: 180 }],
    ];
    const collapsed: string[] = [];
    for (const legs of lanes) {
      const est = price(WIDE_LOAD, legs, { useInternalBand: true });
      if (est.pilotCarsRequired > 0 && !((est.pilotCarHighUsd ?? 0) > (est.pilotCarLowUsd ?? 0))) {
        collapsed.push(`lane ${legs.map((l) => l.code).join('+')}`);
      }
      for (const j of est.byJurisdiction) {
        if (j.pilotCars > 0 && !((j.pilotCarHighUsd ?? 0) > (j.pilotCarLowUsd ?? 0))) {
          collapsed.push(`${j.jurisdiction} in ${legs.map((l) => l.code).join('+')}`);
        }
      }
    }
    expect(collapsed).toEqual([]);
  });

  it('keeps the point field and the band fields mutually exclusive', () => {
    const both: string[] = [];
    for (const opts of [
      { useInternalBand: true },
      { pilotCarRate: { usdPerMile: 2 } },
      {},
    ]) {
      const est = price(WIDE_LOAD, [{ code: 'TN', miles: 300 }], opts);
      for (const j of est.byJurisdiction) {
        if (j.pilotCarUsd !== null && j.pilotCarLowUsd !== null) {
          both.push(`${j.jurisdiction} ${JSON.stringify(opts)}`);
        }
      }
      if (est.pilotCarUsd !== null && est.pilotCarLowUsd !== null) {
        both.push(`lane ${JSON.stringify(opts)}`);
      }
    }
    expect(both).toEqual([]);
  });

  it('labels itself as ours and admits it understates a short crossing', () => {
    const est = price(WIDE_LOAD, [{ code: 'NY', miles: 20 }], { useInternalBand: true });
    expect(est.pilotCarBasis).toBe('internalBand');
    expect(est.disclaimer).toBe(ESCORT_ESTIMATE_DISCLAIMER);
    expect(est.disclaimer).toMatch(/QUOTEFLEET'S OWN ESTIMATE/);
    expect(est.byJurisdiction[0]?.warnings.join(' ')).toMatch(/UNDERSTATED/);
    expect(est.requiresManualReview).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('the wall between escorts and permits', () => {
  const LEGS: Leg[] = [
    { code: 'TN', miles: 300 },
    { code: 'NY', miles: 120 },
    { code: 'AL', miles: 220 },
  ];

  it('cannot move a permit fee, whatever escort options are passed', () => {
    const build = () =>
      calculateOsow(
        LEGS.map((l) => ({ code: l.code, milesInJurisdiction: l.miles })),
        WIDE_LOAD,
        ASOF,
      );
    const miles = Object.fromEntries(LEGS.map((l) => [l.code, l.miles]));
    const untouched = JSON.stringify(build());

    const variants = [
      {},
      { useInternalBand: true },
      { pilotCarRate: { usdPerMile: 2.25 } },
      { pilotCarRate: { usdPerDay: 900, daysPerJurisdiction: 3 } },
    ];
    const drifted: string[] = [];
    for (const options of variants) {
      const quote = build();
      estimateLaneEscortCost(quote, miles, { asOf: ASOF, ...options });
      if (JSON.stringify(quote) !== untouched) drifted.push(JSON.stringify(options));
    }
    expect(drifted).toEqual([]);
  });

  it('never publishes a figure that is the two channels added together', () => {
    const est = price(WIDE_LOAD, LEGS, { pilotCarRate: { usdPerMile: 2.25 } });
    const blended = (est.pilotCarUsd ?? 0) + (est.policeFloorUsd ?? 0);
    expect(est.pilotCarUsd).not.toBe(blended);
    expect(est.policeFloorUsd).not.toBe(blended);
    // And no other number on the object happens to be that sum either.
    const numbers = Object.values(est).filter((v): v is number => typeof v === 'number');
    expect(numbers).not.toContain(blended);
  });

  it('marks itself as not a sourced figure, in the type as well as the data', () => {
    const est = price(WIDE_LOAD, LEGS);
    expect(est.isSourcedFigure).toBe(false);
  });
});
