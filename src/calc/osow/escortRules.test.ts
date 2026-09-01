import { describe, it, expect } from 'vitest';
import {
  evaluateEscortRules,
  ftIn,
  formatFtIn,
  type EscortRule,
  type EscortContext,
} from './escortRules.js';
import type { SourceDoc } from './provenance.js';

const src: SourceDoc = {
  id: 'test-src',
  title: 'Test escort rule source',
  url: 'https://example.gov/escorts',
  publisher: 'Test DOT',
  revisedOn: '2024-01-01',
  retrievedOn: '2026-08-31',
};

function rule(
  id: string,
  description: string,
  when: EscortRule['when'],
  then: EscortRule['then'],
  effectiveFrom = '2020-01-01',
  effectiveTo: string | null = null,
): EscortRule {
  return {
    id,
    jurisdiction: 'XX',
    description,
    when,
    then,
    source: src,
    effectiveFrom,
    effectiveTo,
  };
}

const ASOF = '2026-08-31';

describe('simple threshold rules (the Texas shape)', () => {
  const widthRule = rule(
    'width-1',
    'One front escort over 14 ft wide',
    { kind: 'gt', measure: 'widthIn', value: ftIn(14) },
    { front: 1 },
  );

  it('does not fire below the threshold', () => {
    const r = evaluateEscortRules([widthRule], { widthIn: ftIn(12) }, ASOF);
    expect(r.front).toBe(0);
    expect(r.applied).toHaveLength(0);
    expect(r.requiresManualReview).toBe(false);
  });

  it('does not fire exactly AT the threshold for a strict `gt`', () => {
    const r = evaluateEscortRules([widthRule], { widthIn: ftIn(14) }, ASOF);
    expect(r.front).toBe(0);
  });

  it('fires one inch over', () => {
    const r = evaluateEscortRules([widthRule], { widthIn: ftIn(14, 1) }, ASOF);
    expect(r.front).toBe(1);
    expect(r.applied[0]?.ruleId).toBe('width-1');
  });

  it('ignores a rule that is not in effect on the as-of date', () => {
    const retired = rule(
      'retired',
      'Old rule',
      { kind: 'gt', measure: 'widthIn', value: ftIn(8) },
      { front: 2 },
      '2015-01-01',
      '2019-12-31',
    );
    const r = evaluateEscortRules([retired], { widthIn: ftIn(16) }, ASOF);
    expect(r.front).toBe(0);
    expect(r.applied).toHaveLength(0);
  });
});

describe('combination semantics', () => {
  it('takes the MAX escort count, never the sum, across firing rules', () => {
    const rules = [
      rule('w', 'Width escort', { kind: 'gt', measure: 'widthIn', value: ftIn(14) }, { front: 1 }),
      rule('h', 'Height escort', { kind: 'gt', measure: 'heightIn', value: ftIn(17) }, { front: 1, heightPole: true }),
    ];
    const r = evaluateEscortRules(rules, { widthIn: ftIn(16), heightIn: ftIn(18) }, ASOF);
    // One front escort carrying a pole — not two escort trucks.
    expect(r.front).toBe(1);
    expect(r.heightPole).toBe(true);
    expect(r.applied).toHaveLength(2);
  });

  it('takes the higher count when two rules disagree on how many', () => {
    const rules = [
      rule('a', 'One escort', { kind: 'gt', measure: 'widthIn', value: ftIn(14) }, { front: 1 }),
      rule('b', 'Two escorts', { kind: 'gt', measure: 'widthIn', value: ftIn(16) }, { front: 2 }),
    ];
    const r = evaluateEscortRules(rules, { widthIn: ftIn(17) }, ASOF);
    expect(r.front).toBe(2);
  });

  it('bills a bare escort count when the rule does not fix the position', () => {
    // Texas: over 14 ft wide is ONE escort — front on a two-lane road, rear on
    // a multi-lane one. The count is what costs money, and it is 1 either way.
    const r = evaluateEscortRules(
      [rule('w', 'One escort over 14 ft', { kind: 'gt', measure: 'widthIn', value: ftIn(14) }, { escorts: 1 })],
      { widthIn: ftIn(15) },
      ASOF,
    );
    expect(r.totalEscorts).toBe(1);
    expect(r.front).toBe(0);
    expect(r.rear).toBe(0);
    // Not knowing which end it rides on must NOT block the quote.
    expect(r.requiresManualReview).toBe(false);
  });

  it('totals front + rear when positions ARE known', () => {
    const r = evaluateEscortRules(
      [rule('w', 'Front and rear over 16 ft', { kind: 'gt', measure: 'widthIn', value: ftIn(16) }, { escorts: 2, front: 1, rear: 1 })],
      { widthIn: ftIn(17) },
      ASOF,
    );
    expect(r.totalEscorts).toBe(2);
    expect(r.front).toBe(1);
    expect(r.rear).toBe(1);
  });

  it('an advisory warns without invalidating the price', () => {
    const r = evaluateEscortRules(
      [rule('police', 'Police escort is discretionary', { kind: 'gt', measure: 'widthIn', value: ftIn(14) }, { advisory: 'Law-enforcement traffic control may be required and is not included.' })],
      { widthIn: ftIn(15) },
      ASOF,
    );
    expect(r.warnings.join(' ')).toContain('not included');
    // The distinction that matters: a known exclusion is not a blocked quote.
    expect(r.requiresManualReview).toBe(false);
  });

  it('ORs the boolean outcomes', () => {
    const rules = [
      rule('a', 'Survey', { kind: 'gt', measure: 'widthIn', value: ftIn(14) }, { routeSurvey: true }),
      rule('b', 'Nothing', { kind: 'gt', measure: 'widthIn', value: ftIn(30) }, { front: 4 }),
    ];
    const r = evaluateEscortRules(rules, { widthIn: ftIn(15) }, ASOF);
    expect(r.routeSurvey).toBe(true);
    expect(r.front).toBe(0);
  });
});

// ── The three shapes a Texas-only schema could not have expressed ──────────

describe('Washington-style grammar: compound conditionals', () => {
  // "Two escorts over 16 ft wide — unless a height escort is already required,
  //  in which case one." The width rule references the HEIGHT RULE'S OUTCOME.
  const heightRule = rule(
    'height-escort',
    'Front escort with height pole over 15 ft 6 in',
    { kind: 'gt', measure: 'heightIn', value: ftIn(15, 6) },
    { front: 1, heightPole: true },
  );
  const widthRule = rule(
    'width-escort-no-height',
    'Two escorts over 16 ft wide when no height escort already applies',
    {
      kind: 'all',
      of: [
        { kind: 'gt', measure: 'widthIn', value: ftIn(16) },
        { kind: 'ruleDoesNotApply', ruleId: 'height-escort' },
      ],
    },
    { front: 2 },
  );
  const rules = [heightRule, widthRule];

  it('applies the width rule when the height escort does NOT apply', () => {
    const r = evaluateEscortRules(rules, { widthIn: ftIn(17), heightIn: ftIn(13) }, ASOF);
    expect(r.front).toBe(2);
    expect(r.heightPole).toBe(false);
  });

  it('suppresses the width rule when the height escort already applies', () => {
    const r = evaluateEscortRules(rules, { widthIn: ftIn(17), heightIn: ftIn(16) }, ASOF);
    expect(r.front).toBe(1);
    expect(r.heightPole).toBe(true);
    expect(r.applied.map((a) => a.ruleId)).toEqual(['height-escort']);
  });

  it('goes to manual review when the referenced rule cannot be decided', () => {
    // Height unknown ⇒ height-escort unknown ⇒ the width rule is unknown too.
    const r = evaluateEscortRules(rules, { widthIn: ftIn(17) }, ASOF);
    expect(r.requiresManualReview).toBe(true);
    expect(r.undecided.map((u) => u.ruleId).sort()).toEqual([
      'height-escort',
      'width-escort-no-height',
    ]);
  });

  it('supports positive references too (`ruleApplies`)', () => {
    const police = rule(
      'police',
      'Police escort when a height escort applies on a two-lane road',
      {
        kind: 'all',
        of: [
          { kind: 'ruleApplies', ruleId: 'height-escort' },
          { kind: 'routeClass', anyOf: ['two-lane'] },
        ],
      },
      { policeFront: 1 },
    );
    const r = evaluateEscortRules(
      [heightRule, police],
      { heightIn: ftIn(16), routeClass: 'two-lane' },
      ASOF,
    );
    expect(r.policeFront).toBe(1);
  });

  it('does not resolve a circular rule reference — it reports it', () => {
    const a = rule('a', 'Rule A', { kind: 'ruleApplies', ruleId: 'b' }, { front: 1 });
    const b = rule('b', 'Rule B', { kind: 'ruleApplies', ruleId: 'a' }, { front: 1 });
    const r = evaluateEscortRules([a, b], { widthIn: ftIn(20) }, ASOF);
    expect(r.requiresManualReview).toBe(true);
    expect(r.front).toBe(0);
    expect(r.warnings.join(' ')).toMatch(/reference each other|could not be resolved/);
  });

  it('reports a reference to a rule that is not in effect', () => {
    const dangling = rule('x', 'Depends on a retired rule', { kind: 'ruleApplies', ruleId: 'gone' }, { front: 1 });
    const r = evaluateEscortRules([dangling], { widthIn: ftIn(20) }, ASOF);
    expect(r.requiresManualReview).toBe(true);
    expect(r.warnings.join(' ')).toContain('"gone"');
  });
});

describe('Washington-style grammar: ratio rules', () => {
  // "Rear overhang greater than one-third of trailer length."
  const overhang = rule(
    'overhang-third',
    'Rear escort when rear overhang exceeds one-third of trailer length',
    {
      kind: 'ratioGt',
      measure: 'rearOverhangIn',
      ofMeasure: 'trailerLengthIn',
      numerator: 1,
      denominator: 3,
    },
    { rear: 1 },
  );

  it('fires when the overhang exceeds the fraction', () => {
    const r = evaluateEscortRules(
      [overhang],
      { rearOverhangIn: ftIn(20), trailerLengthIn: ftIn(48) },
      ASOF,
    );
    expect(r.rear).toBe(1);
  });

  it('does not fire when it does not', () => {
    const r = evaluateEscortRules(
      [overhang],
      { rearOverhangIn: ftIn(10), trailerLengthIn: ftIn(48) },
      ASOF,
    );
    expect(r.rear).toBe(0);
    expect(r.requiresManualReview).toBe(false);
  });

  it('is UNKNOWN, not false, when the trailer length is missing', () => {
    const r = evaluateEscortRules([overhang], { rearOverhangIn: ftIn(20) }, ASOF);
    expect(r.rear).toBe(0);
    expect(r.requiresManualReview).toBe(true);
    expect(r.undecided[0]?.reason).toContain('trailer length');
  });
});

describe('Washington-style grammar: subjective rules', () => {
  const mirrors = rule(
    'mirror-visibility',
    'Escort required when the load obstructs the driver’s view in the mirrors',
    {
      kind: 'subjective',
      key: 'mirrorsObstructed',
      question: 'whether the load obstructs the mirrors',
    },
    { rear: 1 },
  );

  it('cannot be decided from measurements alone — it asks for review', () => {
    const r = evaluateEscortRules([mirrors], { widthIn: ftIn(12) }, ASOF);
    expect(r.requiresManualReview).toBe(true);
    expect(r.rear).toBe(0);
    expect(r.undecided[0]?.reason).toContain('obstructs the mirrors');
  });

  it('resolves once a dispatcher answers it', () => {
    const ctx: EscortContext = {
      widthIn: ftIn(12),
      subjectiveAnswers: { mirrorsObstructed: true },
    };
    const r = evaluateEscortRules([mirrors], ctx, ASOF);
    expect(r.rear).toBe(1);
    expect(r.requiresManualReview).toBe(false);
  });

  it('resolves to "no escort" when the dispatcher answers no', () => {
    const r = evaluateEscortRules(
      [mirrors],
      { subjectiveAnswers: { mirrorsObstructed: false } },
      ASOF,
    );
    expect(r.rear).toBe(0);
    expect(r.requiresManualReview).toBe(false);
  });

  it('routes an explicitly unpriceable outcome to manual review', () => {
    const superload = rule(
      'superload',
      'Superload review',
      { kind: 'gt', measure: 'grossWeightLbs', value: 254300 },
      { superload: true, manualReview: 'Superload permits are priced by the state after an engineering review; no published fee exists.' },
    );
    const r = evaluateEscortRules([superload], { grossWeightLbs: 300000 }, ASOF);
    expect(r.superload).toBe(true);
    expect(r.requiresManualReview).toBe(true);
    expect(r.warnings.join(' ')).toContain('engineering review');
  });
});

describe('three-valued logic', () => {
  it('`all` is false as soon as one branch is false, even with an unknown', () => {
    const r = evaluateEscortRules(
      [
        rule(
          'r',
          'Wide AND tall',
          {
            kind: 'all',
            of: [
              { kind: 'gt', measure: 'widthIn', value: ftIn(14) },
              { kind: 'gt', measure: 'heightIn', value: ftIn(14) },
            ],
          },
          { front: 1 },
        ),
      ],
      { widthIn: ftIn(10) }, // width fails outright; height unknown
      ASOF,
    );
    expect(r.requiresManualReview).toBe(false);
    expect(r.front).toBe(0);
  });

  it('`any` is true as soon as one branch is true, even with an unknown', () => {
    const r = evaluateEscortRules(
      [
        rule(
          'r',
          'Wide OR tall',
          {
            kind: 'any',
            of: [
              { kind: 'gt', measure: 'widthIn', value: ftIn(14) },
              { kind: 'gt', measure: 'heightIn', value: ftIn(14) },
            ],
          },
          { front: 1 },
        ),
      ],
      { widthIn: ftIn(20) }, // width passes; height unknown but irrelevant
      ASOF,
    );
    expect(r.front).toBe(1);
    expect(r.requiresManualReview).toBe(false);
  });

  it('`atLeast` is true once enough branches are true, without resolving the rest', () => {
    // Two dimensions over ⇒ fires, even though length is unknown.
    const r = evaluateEscortRules(
      [
        rule(
          'two-dims',
          'Front and rear when over in two dimensions',
          {
            kind: 'atLeast',
            count: 2,
            of: [
              { kind: 'gt', measure: 'widthIn', value: ftIn(14) },
              { kind: 'gt', measure: 'heightIn', value: ftIn(17) },
              { kind: 'gt', measure: 'overallLengthIn', value: ftIn(110) },
            ],
          },
          { escorts: 2, front: 1, rear: 1 },
        ),
      ],
      { widthIn: ftIn(15), heightIn: ftIn(18) },
      ASOF,
    );
    expect(r.totalEscorts).toBe(2);
    expect(r.requiresManualReview).toBe(false);
  });

  it('`atLeast` is false once even the unknowns could not reach the count', () => {
    const r = evaluateEscortRules(
      [
        rule(
          'two-dims',
          'Two dimensions',
          {
            kind: 'atLeast',
            count: 2,
            of: [
              { kind: 'gt', measure: 'widthIn', value: ftIn(14) },
              { kind: 'gt', measure: 'heightIn', value: ftIn(17) },
              { kind: 'gt', measure: 'overallLengthIn', value: ftIn(110) },
            ],
          },
          { escorts: 2 },
        ),
      ],
      // All three under: 0 true, 0 unknown ⇒ definitively false, no review.
      { widthIn: ftIn(10), heightIn: ftIn(13), overallLengthIn: ftIn(70) },
      ASOF,
    );
    expect(r.totalEscorts).toBe(0);
    expect(r.requiresManualReview).toBe(false);
  });

  it('`atLeast` is unknown when the unknowns could still tip it', () => {
    const r = evaluateEscortRules(
      [
        rule(
          'two-dims',
          'Two dimensions',
          {
            kind: 'atLeast',
            count: 2,
            of: [
              { kind: 'gt', measure: 'widthIn', value: ftIn(14) },
              { kind: 'gt', measure: 'heightIn', value: ftIn(17) },
            ],
          },
          { escorts: 2 },
        ),
      ],
      { widthIn: ftIn(15) }, // 1 true, 1 unknown ⇒ could be 2
      ASOF,
    );
    expect(r.requiresManualReview).toBe(true);
  });

  it('`not` of unknown stays unknown', () => {
    const r = evaluateEscortRules(
      [rule('r', 'Not wide', { kind: 'not', of: { kind: 'gt', measure: 'widthIn', value: ftIn(8) } }, { front: 1 })],
      {},
      ASOF,
    );
    expect(r.requiresManualReview).toBe(true);
  });

  it('a `between` band is inclusive by default and respects exclusive bounds', () => {
    const inclusive = rule('i', 'band', { kind: 'between', measure: 'widthIn', min: 100, max: 200 }, { front: 1 });
    expect(evaluateEscortRules([inclusive], { widthIn: 100 }, ASOF).front).toBe(1);
    expect(evaluateEscortRules([inclusive], { widthIn: 200 }, ASOF).front).toBe(1);
    const exclusive = rule('e', 'band', { kind: 'between', measure: 'widthIn', min: 100, max: 200, minInclusive: false, maxInclusive: false }, { front: 1 });
    expect(evaluateEscortRules([exclusive], { widthIn: 100 }, ASOF).front).toBe(0);
    expect(evaluateEscortRules([exclusive], { widthIn: 150 }, ASOF).front).toBe(1);
  });

  it('names the missing measurement in the warning so the gap is actionable', () => {
    const r = evaluateEscortRules(
      [rule('r', 'Over-height escort', { kind: 'gt', measure: 'heightIn', value: ftIn(14) }, { front: 1 })],
      { widthIn: ftIn(10) },
      ASOF,
    );
    expect(r.warnings[0]).toContain('height');
    expect(r.warnings[0]).toContain('example.gov/escorts');
  });
});

describe('unit helpers', () => {
  it('converts feet and inches', () => {
    expect(ftIn(14)).toBe(168);
    expect(ftIn(8, 6)).toBe(102);
  });

  it('formats inches back to feet and inches', () => {
    expect(formatFtIn(168)).toBe("14'");
    expect(formatFtIn(102)).toBe('8\'6"');
  });
});
