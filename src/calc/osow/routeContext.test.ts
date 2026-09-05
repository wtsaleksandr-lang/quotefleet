/**
 * THE MOVE CONTEXT AND THE PER-JURISDICTION ROAD VOCABULARY.
 *
 * Every fixture here is a TEST FIXTURE. The rules they are modelled on are
 * real and named in the test titles, but no jurisdiction data file is created
 * or changed by this suite — this PR adds capability and encodes no new state.
 * The fixtures exist to prove the mechanism can hold what the research found,
 * which is a different claim from having encoded it.
 */
import { describe, it, expect } from 'vitest';
import {
  DARK_RULES_FOR_WANT_OF_INPUT,
  PRIOR_PERMIT_REUSE_NOTE,
  evaluateContextCondition,
  minutesOfDay,
  newContextTrace,
  routeClassDefinitionFor,
  scaledLimit,
  vocabularyAdmits,
  withinTimeWindow,
  type ContextCondition,
  type MoveContext,
  type RouteVocabulary,
} from './routeContext.js';

// ── The evidence that broke the shared enum ────────────────────────────────
// A four-lane undivided road is "undivided" in Nebraska and "four lanes or
// more" in Kansas. Same road; the two states put the escort on opposite ends.

const KANSAS_VOCAB: RouteVocabulary = {
  name: 'K.A.R. 36-1-36(f) road classes (test fixture)',
  classes: [
    {
      id: 'KS:two-lane',
      publishedName: 'two-lane highway',
      quote: 'on a two-lane highway',
    },
    {
      id: 'KS:four-or-more-lanes',
      publishedName: 'four lanes or more',
      quote: 'on a highway of four lanes or more',
    },
  ],
  explanation: 'Kansas keys its escort positions on LANE COUNT.',
};

const NEBRASKA_VOCAB: RouteVocabulary = {
  name: '408 NAC 3 road classes (test fixture)',
  classes: [
    { id: 'NE:divided', publishedName: 'divided highway', quote: 'a divided highway' },
    { id: 'NE:undivided', publishedName: 'undivided highway', quote: 'an undivided highway' },
    {
      id: 'NE:four-lane-divided-state-highway',
      publishedName: 'four-lane divided State Highways',
      quote: 'four-lane divided State Highways',
    },
  ],
  explanation: 'Nebraska keys on a MEDIAN test, and adds a fifth term besides.',
};

const onFourOrMoreLanes: ContextCondition = {
  kind: 'routeClassIn',
  anyOf: ['KS:four-or-more-lanes'],
};
const onUndivided: ContextCondition = { kind: 'routeClassIn', anyOf: ['NE:undivided'] };

describe('per-state route vocabulary — the same road, two answers', () => {
  it('CALLS ONE FOUR-LANE UNDIVIDED ROAD BY BOTH STATES’ NAMES WITHOUT COLLISION', () => {
    const inKansas: MoveContext = { routeClass: 'KS:four-or-more-lanes' };
    const inNebraska: MoveContext = { routeClass: 'NE:undivided' };

    expect(evaluateContextCondition(onFourOrMoreLanes, inKansas, KANSAS_VOCAB)).toBe(true);
    expect(evaluateContextCondition(onUndivided, inNebraska, NEBRASKA_VOCAB)).toBe(true);

    // And neither state's term can be asserted into the other's rules.
    expect(evaluateContextCondition(onUndivided, inKansas, NEBRASKA_VOCAB)).toBe('unknown');
    expect(evaluateContextCondition(onFourOrMoreLanes, inNebraska, KANSAS_VOCAB)).toBe('unknown');
  });

  it('ANSWERS `unknown`, NEVER `false`, FOR A CLASS THE STATE DOES NOT PUBLISH', () => {
    // The whole failure mode this exists to prevent: a caller who can only say
    // "two-lane" has not answered Kansas's question, and reading that as
    // "not four lanes" silently decides an escort.
    const trace = newContextTrace();
    const verdict = evaluateContextCondition(
      onFourOrMoreLanes,
      { routeClass: 'two-lane' },
      KANSAS_VOCAB,
      trace,
    );
    expect(verdict).toBe('unknown');
    expect([...trace.missing].join(' ')).toContain('four lanes or more');
  });

  it('says `unknown` when no class was supplied at all', () => {
    expect(evaluateContextCondition(onFourOrMoreLanes, {}, KANSAS_VOCAB)).toBe('unknown');
  });

  it('WITHOUT A VOCABULARY, BEHAVES EXACTLY AS THE SHARED ENUM ALWAYS DID', () => {
    // Every one of the 24 encoded jurisdictions takes this path.
    expect(
      evaluateContextCondition({ kind: 'routeClassIn', anyOf: ['two-lane'] }, { routeClass: 'two-lane' }, undefined),
    ).toBe(true);
    expect(
      evaluateContextCondition({ kind: 'routeClassIn', anyOf: ['two-lane'] }, { routeClass: 'interstate' }, undefined),
    ).toBe(false);
    expect(vocabularyAdmits(undefined, 'anything:at-all')).toBe(true);
  });

  it('accepts a general class where the STATE ITSELF equates the two', () => {
    const vocab: RouteVocabulary = {
      name: 'test',
      classes: [
        {
          id: 'IA:primary',
          publishedName: 'primary highway',
          quote: 'primary highways',
          generalEquivalents: ['interstate'],
        },
      ],
      explanation: 'test fixture',
    };
    expect(
      evaluateContextCondition(
        { kind: 'routeClassIn', anyOf: ['IA:primary'] },
        { routeClass: 'interstate' },
        vocab,
      ),
    ).toBe(true);
    expect(routeClassDefinitionFor(vocab, 'interstate')?.id).toBe('IA:primary');
  });
});

describe('a route class that carries a MULTIPLIER — Wisconsin Class B', () => {
  const vocab: RouteVocabulary = {
    name: 'Wis. Stat. § 348.16 highway classes (test fixture)',
    classes: [
      { id: 'WI:class-a', publishedName: 'Class A highway', quote: 'Class A highways' },
      {
        id: 'WI:class-b',
        publishedName: 'Class B highway',
        quote: 'Class B highways',
        limitScale: {
          factor: 0.6,
          appliesTo: ['grossWeightLbs', 'singleAxleLbs', 'tandemAxleLbs'],
          quote: 'exceeding 60 percent',
        },
      },
    ],
    explanation: 'Class B is a PERCENTAGE of Class A, not a second table.',
  };

  it('SCALES THE LIMIT RATHER THAN RESTATING IT', () => {
    expect(scaledLimit(vocab, 'WI:class-b', 'grossWeightLbs', 80_000)).toBe(48_000);
    expect(scaledLimit(vocab, 'WI:class-a', 'grossWeightLbs', 80_000)).toBe(80_000);
  });

  it('leaves limits the multiplier does not name alone', () => {
    expect(scaledLimit(vocab, 'WI:class-b', 'widthIn', 102)).toBe(102);
  });

  it('returns null — not the unscaled figure — for a class outside the vocabulary', () => {
    expect(scaledLimit(vocab, 'two-lane', 'grossWeightLbs', 80_000)).toBeNull();
  });
});

describe('time of day — the mechanism Arizona and Nevada need', () => {
  it('AN ABSENT TIME IS `unknown`, NEVER "DAY"', () => {
    // A.A.C. R17-6-402(D)'s escort thresholds apply only 3:00 a.m. to half an
    // hour before sunrise. Reading a blank departure time as daytime deletes a
    // real escort from a night move.
    const nightRule: ContextCondition = {
      kind: 'timeOfDayBetween',
      fromHhmm: '03:00',
      toHhmm: '05:30',
    };
    expect(evaluateContextCondition(nightRule, {}, undefined)).toBe('unknown');
    expect(evaluateContextCondition(nightRule, { timeOfDay: '04:00' }, undefined)).toBe(true);
    expect(evaluateContextCondition(nightRule, { timeOfDay: '13:00' }, undefined)).toBe(false);
  });

  it('handles a window that wraps midnight, which is how night rules are written', () => {
    expect(withinTimeWindow('23:30', '22:00', '06:00')).toBe(true);
    expect(withinTimeWindow('02:00', '22:00', '06:00')).toBe(true);
    expect(withinTimeWindow('12:00', '22:00', '06:00')).toBe(false);
  });

  it('treats the window as half-open, so a boundary belongs to exactly one side', () => {
    expect(withinTimeWindow('03:00', '03:00', '05:30')).toBe(true);
    expect(withinTimeWindow('05:30', '03:00', '05:30')).toBe(false);
  });

  it('refuses a malformed clock time rather than reading it as a window that excludes everything', () => {
    expect(minutesOfDay('25:00')).toBeNull();
    expect(withinTimeWindow('nonsense', '03:00', '05:30')).toBeNull();
    expect(
      evaluateContextCondition(
        { kind: 'timeOfDayBetween', fromHhmm: '03:00', toHhmm: '05:30' },
        { timeOfDay: 'nonsense' },
        undefined,
      ),
    ).toBe('unknown');
  });

  it('DOES NOT DERIVE DARKNESS FROM THE CLOCK', () => {
    // Sunrise moves with the date and the longitude, and Arizona writes its own
    // rule against "one-half hour before sunrise" rather than a clock time. A
    // computed sunset would be OUR number presented as the state's trigger.
    expect(evaluateContextCondition({ kind: 'inDarkness' }, { timeOfDay: '23:00' }, undefined)).toBe(
      'unknown',
    );
    expect(evaluateContextCondition({ kind: 'inDarkness' }, { darkness: true }, undefined)).toBe(true);
  });
});

describe('the Nevada I-15 carve-out — direction × day × time × named segment', () => {
  // NAC 484D.655(1)(b)-(c) cuts the width ceiling 14 ft → 12 ft for
  // Friday-afternoon northbound and Sunday-afternoon southbound travel on I-15
  // between the California line and Las Vegas Exit 33.
  const carveOut: ContextCondition = {
    kind: 'allOf',
    of: [
      { kind: 'onNamedSegment', segmentIds: ['NV:i-15-ca-line-to-exit-33'] },
      {
        kind: 'anyOf',
        of: [
          {
            kind: 'allOf',
            of: [
              { kind: 'dayOfWeekIn', anyOf: [5] },
              { kind: 'travelDirectionIn', anyOf: ['northbound'] },
              { kind: 'timeOfDayBetween', fromHhmm: '12:00', toHhmm: '23:59' },
            ],
          },
          {
            kind: 'allOf',
            of: [
              { kind: 'dayOfWeekIn', anyOf: [0] },
              { kind: 'travelDirectionIn', anyOf: ['southbound'] },
              { kind: 'timeOfDayBetween', fromHhmm: '12:00', toHhmm: '23:59' },
            ],
          },
        ],
      },
    ],
  };

  const onSegment = { routeSegments: ['NV:i-15-ca-line-to-exit-33'] };

  it('FIRES ON A FRIDAY-AFTERNOON NORTHBOUND RUN', () => {
    expect(
      evaluateContextCondition(
        carveOut,
        { ...onSegment, dayOfWeek: 5, travelDirection: 'northbound', timeOfDay: '15:00' },
        undefined,
      ),
    ).toBe(true);
  });

  it('does NOT fire on the same stretch on a Thursday', () => {
    expect(
      evaluateContextCondition(
        carveOut,
        { ...onSegment, dayOfWeek: 4, travelDirection: 'northbound', timeOfDay: '15:00' },
        undefined,
      ),
    ).toBe(false);
  });

  it('does NOT fire northbound on Sunday — the two halves are directional', () => {
    expect(
      evaluateContextCondition(
        carveOut,
        { ...onSegment, dayOfWeek: 0, travelDirection: 'northbound', timeOfDay: '15:00' },
        undefined,
      ),
    ).toBe(false);
  });

  it('is `unknown` — not false — when the move is off the segment list entirely', () => {
    // Not naming a segment is not the same as being somewhere else.
    expect(
      evaluateContextCondition(
        carveOut,
        { dayOfWeek: 5, travelDirection: 'northbound', timeOfDay: '15:00' },
        undefined,
      ),
    ).toBe('unknown');
  });

  it('names every fact it wanted, so the quote can ask for them', () => {
    const trace = newContextTrace();
    evaluateContextCondition(carveOut, {}, undefined, trace);
    const missing = [...trace.missing].join(' | ');
    expect(missing).toContain('named route segments');
    expect(missing).toContain('day of the week');
    expect(missing).toContain('direction of travel');
    expect(missing).toContain('time of day');
  });
});

describe('facts about the truck and its paperwork, not the load', () => {
  it('READS MARYLAND’S REGISTERED GROSS WEIGHT AS ITS OWN AXIS', () => {
    // Transp. § 24-108(a)(1): 22,400 lb single axle at or under 73,000 lb
    // REGISTERED, 20,000 lb above it. Not a property of the load at all.
    const heavy: ContextCondition = {
      kind: 'registeredGrossWeight',
      op: 'gt',
      valueLbs: 73_000,
    };
    expect(evaluateContextCondition(heavy, { registeredGrossWeightLbs: 80_000 }, undefined)).toBe(true);
    expect(evaluateContextCondition(heavy, { registeredGrossWeightLbs: 73_000 }, undefined)).toBe(false);
    // A load weight is NOT a registration weight, and supplying one does not
    // answer the other.
    expect(evaluateContextCondition(heavy, {}, undefined)).toBe('unknown');
  });

  it('reads a vehicle configuration — Nevada’s mechanically steered rear axle', () => {
    const steered: ContextCondition = {
      kind: 'vehicleConfiguration',
      property: 'mechanicallySteeredRearAxle',
      is: true,
    };
    expect(
      evaluateContextCondition(steered, { vehicleConfiguration: { mechanicallySteeredRearAxle: true } }, undefined),
    ).toBe(true);
    expect(
      evaluateContextCondition(steered, { vehicleConfiguration: { stingerSteered: true } }, undefined),
    ).toBe('unknown');
  });

  it('reads a driver credential — Iowa selects a route class by it', () => {
    const cdl: ContextCondition = { kind: 'driverCredentialIn', anyOf: ['cdl'] };
    expect(evaluateContextCondition(cdl, { driverCredential: 'cdl' }, undefined)).toBe(true);
    expect(evaluateContextCondition(cdl, { driverCredential: 'non-cdl' }, undefined)).toBe(false);
    expect(evaluateContextCondition(cdl, {}, undefined)).toBe('unknown');
  });

  it('reads the seasonal restriction state — the frost-law pricing seam', () => {
    const thaw: ContextCondition = { kind: 'seasonalRestrictionsInEffect' };
    expect(evaluateContextCondition(thaw, { seasonalRestriction: 'in-effect' }, undefined)).toBe(true);
    expect(evaluateContextCondition(thaw, { seasonalRestriction: 'not-in-effect' }, undefined)).toBe(false);
    expect(evaluateContextCondition(thaw, {}, undefined)).toBe('unknown');
  });
});

describe('three-valued composition', () => {
  const known: ContextCondition = { kind: 'onHoliday' };
  const unknown: ContextCondition = { kind: 'inDarkness' };

  it('allOf is FALSE as soon as one branch is definitely false, unknown or not', () => {
    expect(
      evaluateContextCondition({ kind: 'allOf', of: [known, unknown] }, { holiday: false }, undefined),
    ).toBe(false);
  });

  it('allOf is UNKNOWN when nothing is false and something is undecided', () => {
    expect(
      evaluateContextCondition({ kind: 'allOf', of: [known, unknown] }, { holiday: true }, undefined),
    ).toBe('unknown');
  });

  it('anyOf is TRUE as soon as one branch is definitely true', () => {
    expect(
      evaluateContextCondition({ kind: 'anyOf', of: [known, unknown] }, { holiday: true }, undefined),
    ).toBe(true);
  });

  it('noneOf propagates unknown rather than flipping it to a definite answer', () => {
    expect(evaluateContextCondition({ kind: 'noneOf', of: [unknown] }, {}, undefined)).toBe('unknown');
    expect(
      evaluateContextCondition({ kind: 'noneOf', of: [known] }, { holiday: false }, undefined),
    ).toBe(true);
  });
});

describe('what was deliberately deferred, recorded in code', () => {
  it('records prior-permit reuse as a requirement with its reason', () => {
    expect(PRIOR_PERMIT_REUSE_NOTE).toContain('NOT modelled');
    expect(PRIOR_PERMIT_REUSE_NOTE).toContain('persisted quote state');
    // And says which direction the error runs, which is the reason it is safe
    // to defer: a quote that ignores reuse is never too cheap.
    expect(PRIOR_PERMIT_REUSE_NOTE).toContain('over-states');
  });

  it('lists the rules that are dark for want of an input no quote collects', () => {
    const inputs = DARK_RULES_FOR_WANT_OF_INPUT.map((d) => d.input).join(' | ');
    expect(inputs).toContain('tire');
    expect(inputs).toContain('registered gross weight');
    expect(inputs).toContain('pavement');
    for (const entry of DARK_RULES_FOR_WANT_OF_INPUT) {
      // Every entry names the jurisdictions it costs and the rule it darkens —
      // this list is the argument for collecting the input later, and a bare
      // field name would not be one.
      expect(entry.jurisdictions.length).toBeGreaterThan(0);
      expect(entry.rule.length).toBeGreaterThan(40);
    }
  });
});
