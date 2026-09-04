/**
 * THE SURFACING DECISION, PINNED.
 *
 * The failure mode of a frost-law feature is a truck on a posted road, and it
 * is reached in exactly two ways: by presenting an ABSENCE as a clear, or by
 * presenting a STALE reading as a current one. Both are tested here, from both
 * directions, because a warning that is merely present is not the same as a
 * warning that says the true thing.
 *
 * The second contract tested here is the one that had to be argued for rather
 * than assumed: a live restriction changes the WARNINGS and never the PRICE.
 */
import { describe, expect, it } from 'vitest';
import { seasonalAdvisoryFor, isStale, activeRestrictions } from './advisory.js';
import { seasonalSourceFor } from './sources.js';
import type { SeasonalContext, StateSeasonalSnapshot } from './types.js';

const MARCH = new Date(Date.UTC(2026, 2, 15, 12));
const ASOF = '2026-03-15';

function snapshot(over: Partial<StateSeasonalSnapshot> & { code: string }): StateSeasonalSnapshot {
  const spec = seasonalSourceFor(over.code)!;
  return {
    name: spec.name,
    programme: spec.programme,
    rows: [],
    retrievedOn: ASOF,
    bulletinDate: null,
    fetchStatus: 'ok',
    verifiedClear: false,
    staleFailureDirection: spec.staleFailureDirection,
    authorityUrl: spec.authorityUrl,
    authorityTitle: spec.authorityTitle,
    lastError: null,
    ageDays: 0,
    ...over,
    code: spec.code,
  };
}

function ctxOf(...snaps: StateSeasonalSnapshot[]): SeasonalContext {
  return { snapshots: new Map(snaps.map((s) => [s.code, s])) };
}

const LIVE_ND = snapshot({
  code: 'ND',
  rows: [
    {
      value: { scope: 'route-segment', area: 'ND 15 MP 46.3', limit: '7 Ton', orderRef: 'Order 2026-4' },
      source: {
        id: 'nd-loadrestrict-geojson',
        title: 'NDDOT — North Dakota Load Restrictions',
        url: 'https://www.dot.nd.gov/driver/commercial/north-dakota-load-restrictions',
        publisher: 'North Dakota Department of Transportation',
        revisedOn: '2026-03-10',
        retrievedOn: ASOF,
      },
      effectiveFrom: '2026-03-11',
      effectiveTo: null,
    },
  ],
});

const LEGAL = { permitRequired: false, overweight: false };
const OVERWEIGHT_PERMIT = { permitRequired: true, overweight: true };

describe('a live restriction is FLAGGED, never applied', () => {
  const a = seasonalAdvisoryFor('ND', ctxOf(LIVE_ND), ASOF, LEGAL, MARCH);

  it('names the restriction, the area, the limit and the window', () => {
    expect(a.active).toHaveLength(1);
    const text = a.warnings.join(' ');
    expect(text).toContain('SEASONAL WEIGHT RESTRICTION');
    expect(text).toContain('ND 15 MP 46.3');
    expect(text).toContain('7 Ton');
    expect(text).toContain('2026-03-11');
  });

  it('says out loud that it has NOT changed a limit or a fee, and why', () => {
    const text = a.warnings.join(' ');
    expect(text).toContain('CANNOT tell you whether your route touches a restricted segment');
    expect(text).toContain('NOT changed any weight limit or fee');
  });

  it('cites the document and links the state', () => {
    expect(a.sources[0]?.id).toBe('nd-loadrestrict-geojson');
    expect(a.authorityUrl).toContain('dot.nd.gov');
    expect(a.warnings.join(' ')).toContain('rev. 2026-03-10');
  });

  it('does NOT escalate a legal-weight load — it is information, not a blocker', () => {
    expect(a.requiresManualReview).toBe(false);
  });

  it('DOES escalate a load that already needs an overweight permit there', () => {
    const b = seasonalAdvisoryFor('ND', ctxOf(LIVE_ND), ASOF, OVERWEIGHT_PERMIT, MARCH);
    expect(b.requiresManualReview).toBe(true);
    expect(b.warnings.join(' ')).toContain('reduce, re-route or refuse an overweight permit');
  });
});

describe('a lapsed restriction is not a live one', () => {
  it('drops out of `active` once its window closes, with no code change', () => {
    const lapsed = snapshot({
      code: 'MN',
      verifiedClear: true,
      rows: [
        {
          value: { scope: 'zone', area: 'North frost zone', limit: 'Spring load restrictions in force' },
          source: {
            id: 'mn-loadlimits-zone-table',
            title: 'MnDOT',
            url: 'https://www.dot.state.mn.us/loadlimits/',
            publisher: 'MnDOT',
            revisedOn: null,
            retrievedOn: '2026-08-01',
          },
          effectiveFrom: '2026-03-20',
          effectiveTo: '2026-05-15',
        },
      ],
      retrievedOn: '2026-08-01',
      ageDays: 0,
    });
    expect(activeRestrictions(lapsed, '2026-04-01')).toHaveLength(1);
    expect(activeRestrictions(lapsed, '2026-08-01')).toHaveLength(0);
  });
});

describe('ABSENCE IS NEVER A CLEAR', () => {
  it('holding nothing for a restricting state produces a loud warning, not silence', () => {
    const a = seasonalAdvisoryFor('MI', { snapshots: new Map() }, ASOF, LEGAL, MARCH);
    expect(a.warnings.join(' ')).toContain('we hold no current seasonal-restriction data');
    expect(a.warnings.join(' ')).toContain('illegal on the same road during the thaw');
    expect(a.authorityUrl).toContain('mdotjboss.state.mi.us');
  });

  it('a DOWN DATABASE says "we do not know", not "no restrictions"', () => {
    const a = seasonalAdvisoryFor(
      'MI',
      { snapshots: new Map(), storeUnavailable: true },
      ASOF,
      LEGAL,
      MARCH,
    );
    expect(a.warnings.join(' ')).toContain('store was unreachable');
    expect(a.active).toHaveLength(0);
  });

  it('a fetched-but-unclassified snapshot warns; only a VERIFIED clear stays quiet', () => {
    // Michigan's bulletins are prose. "We read the page and could not tell" and
    // "the state says it is clear" produce the same empty row list and must NOT
    // produce the same output.
    const unknown = seasonalAdvisoryFor('MI', ctxOf(snapshot({ code: 'MI' })), ASOF, LEGAL, MARCH);
    expect(unknown.warnings.join(' ')).toContain('have not been able to confirm');

    const cleared = seasonalAdvisoryFor(
      'MI',
      ctxOf(snapshot({ code: 'MI', verifiedClear: true })),
      ASOF,
      LEGAL,
      MARCH,
    );
    expect(cleared.warnings).toHaveLength(0);
    expect(cleared.dataQuality.join(' ')).toContain('none in force');
  });
});

describe('STALENESS IS VISIBLE, and says which way it errs', () => {
  it('an over-restricting source is described as erring safe', () => {
    const old = snapshot({ code: 'ND', retrievedOn: '2026-03-01', rows: LIVE_ND.rows });
    expect(isStale(old, ASOF, MARCH)).toBe(true);
    const a = seasonalAdvisoryFor('ND', ctxOf(old), ASOF, LEGAL, MARCH);
    const text = a.warnings.join(' ');
    expect(text).toContain('14 day(s) old');
    expect(text).toContain('WRONG WAY SAFE');
    expect(text).toContain('already lifted');
  });

  it('an under-restricting source is described as erring DANGEROUS, in those words', () => {
    const old = snapshot({ code: 'MN', retrievedOn: '2026-03-01', verifiedClear: true });
    const a = seasonalAdvisoryFor('MN', ctxOf(old), ASOF, LEGAL, MARCH);
    const text = a.warnings.join(' ');
    expect(text).toContain('WRONG WAY DANGEROUS');
    expect(text).toContain('Absence of a restriction here is not evidence of one');
  });

  it('carries the last fetch error into the warning, so the cause is not hidden', () => {
    const old = snapshot({ code: 'ND', retrievedOn: '2026-03-01', lastError: 'HTTP 503 from NDDOT' });
    const a = seasonalAdvisoryFor('ND', ctxOf(old), ASOF, LEGAL, MARCH);
    expect(a.warnings.join(' ')).toContain('HTTP 503 from NDDOT');
  });

  it('does NOT call an off-season snapshot stale for being a week old', () => {
    // The budget follows the cadence. Six days is on schedule in August.
    const august = new Date(Date.UTC(2026, 7, 20, 12));
    const s = snapshot({ code: 'ND', retrievedOn: '2026-08-14' });
    expect(isStale(s, '2026-08-20', august)).toBe(false);
  });
});

describe('the states that do NOT restrict', () => {
  it('answers a local-only state positively, and points at the right authority', () => {
    const a = seasonalAdvisoryFor('OH', { snapshots: new Map() }, ASOF, OVERWEIGHT_PERMIT, MARCH);
    expect(a.warnings).toHaveLength(0);
    expect(a.requiresManualReview).toBe(false);
    expect(a.dataQuality.join(' ')).toContain('local road agencies post their own');
    expect(a.dataQuality.join(' ')).toContain('county engineer');
  });

  it('says nothing at all for a state outside the registry', () => {
    const a = seasonalAdvisoryFor('TX', { snapshots: new Map() }, ASOF, LEGAL, MARCH);
    expect(a.warnings).toHaveLength(0);
    expect(a.dataQuality).toHaveLength(0);
  });
});
