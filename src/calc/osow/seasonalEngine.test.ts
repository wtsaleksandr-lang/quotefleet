/**
 * THE ENGINE INTEGRATION — the one assertion the whole design rests on.
 *
 * A seasonal restriction may add WARNINGS to a quote. It may not move a dollar.
 * `seasonal/advisory.ts` sets out the three reasons (the restriction is
 * segment-scoped and we are handed state codes; the reduction depends on the
 * pavement; the freshness is polled, not pushed) — this file proves the code
 * actually behaves that way, by pricing the same load twice and comparing the
 * numbers byte for byte.
 *
 * It also proves the other half of the contract: passing NO seasonal context
 * leaves every existing caller's result exactly as it was.
 */
import { describe, expect, it } from 'vitest';
import { calculateOsow, type OsowLoad } from './engine.js';
import type { SeasonalContext, StateSeasonalSnapshot } from './seasonal/types.js';
import { seasonalSourceFor } from './seasonal/sources.js';

const ASOF = '2026-03-15';

/** Overweight and overwidth in Washington — a leg the engine really prices. */
const HEAVY: OsowLoad = {
  grossWeightLbs: 105_000,
  widthIn: 120,
  heightIn: 168,
  axleCount: 6,
  milesInJurisdiction: 220,
};

/** Legal in every dimension — no permit needed at all. */
const LEGAL: OsowLoad = { grossWeightLbs: 78_000, widthIn: 96, heightIn: 160 };

function waSnapshot(): StateSeasonalSnapshot {
  const spec = seasonalSourceFor('WA')!;
  return {
    code: 'WA',
    name: spec.name,
    programme: spec.programme,
    rows: [
      {
        value: {
          scope: 'route-segment',
          area: 'SR 20 MP 104.0 to MP 131.5, Okanogan County',
          limit: 'Spring thaw load restriction: axle weights reduced to 80 percent of legal maximum.',
          grossLimitLbs: 16_000,
        },
        source: {
          id: spec.sourceId,
          title: spec.authorityTitle,
          url: spec.authorityUrl,
          publisher: spec.publisher,
          revisedOn: '2026-02-24',
          retrievedOn: ASOF,
        },
        effectiveFrom: '2026-02-28',
        effectiveTo: '2026-05-16',
      },
    ],
    retrievedOn: ASOF,
    bulletinDate: '2026-02-24',
    fetchStatus: 'ok',
    verifiedClear: false,
    staleFailureDirection: spec.staleFailureDirection,
    authorityUrl: spec.authorityUrl,
    authorityTitle: spec.authorityTitle,
    lastError: null,
    ageDays: 0,
  };
}

const CTX: SeasonalContext = { snapshots: new Map([['WA', waSnapshot()]]) };

describe('a live restriction changes the WARNINGS and nothing else', () => {
  const without = calculateOsow(['WA'], HEAVY, ASOF);
  const with_ = calculateOsow(['WA'], HEAVY, ASOF, CTX);

  it('prices the leg identically, to the cent', () => {
    expect(with_.totalPermitUsd).toEqual(without.totalPermitUsd);
    const a = without.jurisdictions[0]!;
    const b = with_.jurisdictions[0]!;
    expect(b.subtotalUsd).toEqual(a.subtotalUsd);
    expect(b.subtotalLowUsd).toEqual(a.subtotalLowUsd);
    expect(b.subtotalHighUsd).toEqual(a.subtotalHighUsd);
    expect(b.lines.map((l) => [l.code, l.amountUsd])).toEqual(
      a.lines.map((l) => [l.code, l.amountUsd]),
    );
  });

  it('leaves the over-dimension finding and the escort count untouched', () => {
    const a = without.jurisdictions[0]!;
    const b = with_.jurisdictions[0]!;
    expect(b.overDimension).toEqual(a.overDimension);
    expect(b.escortsRequired).toBe(a.escortsRequired);
    expect(b.superload).toBe(a.superload);
  });

  it('adds the cited seasonal warning to the quote', () => {
    const text = with_.warnings.join(' ');
    expect(text).toContain('SEASONAL WEIGHT RESTRICTION');
    expect(text).toContain('SR 20 MP 104.0');
    expect(text).toContain('2026-02-28 to 2026-05-16');
    expect(text).toContain('wsdot.com');
    // and the caller can reach the structured form without parsing prose
    expect(with_.jurisdictions[0]?.seasonal?.active).toHaveLength(1);
  });

  it('sends an already-overweight leg to review, but does not touch the price it computed', () => {
    expect(with_.jurisdictions[0]?.overDimension.weight).toBe(true);
    expect(with_.requiresManualReview).toBe(true);
    expect(with_.totalPermitUsd).toEqual(without.totalPermitUsd);
  });
});

describe('a legal-weight load through the same live restriction', () => {
  it('is warned, not escalated — the restriction is information, not a blocker', () => {
    const q = calculateOsow(['WA'], LEGAL, ASOF, CTX);
    expect(q.jurisdictions[0]?.permitRequired).toBe(false);
    expect(q.jurisdictions[0]?.seasonal?.requiresManualReview).toBe(false);
    expect(q.warnings.join(' ')).toContain('SEASONAL WEIGHT RESTRICTION');
  });
});

describe('the optional parameter is genuinely optional', () => {
  it('omitting it leaves the result byte-identical to the pre-seasonal engine', () => {
    const q = calculateOsow(['WA', 'TX'], HEAVY, ASOF);
    for (const j of q.jurisdictions) expect(j.seasonal).toBeUndefined();
    // No seasonal sentence anywhere in the warnings or the data-quality channel.
    expect(q.warnings.join(' ')).not.toContain('SEASONAL WEIGHT RESTRICTION');
    expect(q.dataQuality.join(' ')).not.toContain('Seasonal restrictions');
  });

  it('an empty context still speaks — a covered state we hold nothing for is warned about', () => {
    const q = calculateOsow(['WA'], HEAVY, ASOF, { snapshots: new Map() });
    expect(q.warnings.join(' ')).toContain('we hold no current seasonal-restriction data');
    expect(q.requiresManualReview).toBe(true);
  });

  it('a local-only state answers positively in the data-quality channel, not in the customer warnings', () => {
    const q = calculateOsow(['OH'], HEAVY, ASOF, { snapshots: new Map() });
    expect(q.dataQuality.join(' ')).toContain('posts no seasonal weight restriction on the state highway system');
    expect(q.warnings.join(' ')).not.toContain('SEASONAL WEIGHT RESTRICTION');
  });
});
