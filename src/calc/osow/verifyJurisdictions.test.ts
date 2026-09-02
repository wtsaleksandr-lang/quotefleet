import { describe, expect, it } from 'vitest';
import { REQUESTED_OSOW_JURISDICTIONS } from './jurisdictions/index.js';
import type { SourceDoc } from './provenance.js';
import type { JurisdictionOsowRules } from './types.js';
import {
  COVERAGE_CATEGORIES,
  formatCoverageReport,
  verifyJurisdictionEvidence,
  verifyJurisdictions,
} from './verifyJurisdictions.js';

describe('OS/OW jurisdiction evidence guard', () => {
  it('accepts every registered data-preparation jurisdiction', () => {
    expect(verifyJurisdictions(REQUESTED_OSOW_JURISDICTIONS)).toEqual([]);
  });

  it('fails on a deliberately incomplete source fixture', () => {
    const incompleteSource = {
      id: 'fixture-missing-evidence',
      title: 'Deliberately incomplete fixture',
      url: '',
      publisher: 'Test only',
      retrievedOn: '2026-09-02',
      // Deliberately lacks both `quote` and `revisedOn`.
    } as unknown as SourceDoc;

    const fixture: JurisdictionOsowRules = {
      code: 'ZZ',
      name: 'Incomplete Fixture',
      country: 'US',
      legalLimits: {
        widthIn: [{
          value: 102,
          source: incompleteSource,
          effectiveFrom: '2026-09-02',
          effectiveTo: null,
        }],
        heightIn: [],
        trailerLengthIn: [],
        frontOverhangIn: [],
        rearOverhangIn: [],
        grossWeightLbs: [],
        singleAxleLbs: [],
        tandemAxleLbs: [],
      },
      permitBaseFeeUsd: [],
      overweightBands: [],
      conditionalFees: [],
      transactionFee: [],
      routeAnalysisFeeUsd: [],
      noBridgeRouteFeeUsd: [],
      superload: { grossWeight: [], shortSpacing: [] },
      routeInspection: { widthIn: [], heightIn: [], lengthIn: [] },
      escortRules: [],
      feesDependOnDistance: false,
    };

    const messages = verifyJurisdictionEvidence(fixture).map((issue) => issue.message);
    expect(messages).toContain('source URL is missing');
    expect(messages).toContain('verbatim source quote is missing');
    expect(messages).toContain('revision-date field is missing');
  });

  it('prints all ten coverage categories for every jurisdiction', () => {
    const report = formatCoverageReport(REQUESTED_OSOW_JURISDICTIONS);
    expect(COVERAGE_CATEGORIES).toHaveLength(10);
    for (const category of COVERAGE_CATEGORIES) expect(report).toContain(category);
    for (const rules of REQUESTED_OSOW_JURISDICTIONS) expect(report).toContain(rules.code);
  });
});
