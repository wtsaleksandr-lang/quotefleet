/**
 * Mechanical evidence verification and coverage reporting for jurisdiction
 * data. This intentionally checks runtime objects rather than TypeScript
 * declarations: an `as` cast or imported JSON can still omit required proof.
 */
import type { SourceDoc, Sourced } from './provenance.js';
import type { JurisdictionOsowRules } from './types.js';

export type CoverageStatus = 'complete' | 'partial' | 'missing';

export const COVERAGE_CATEGORIES = [
  'legalLimits',
  'permitBaseFeeUsd',
  'overweightBands',
  'conditionalFees',
  'transactionFee',
  'routeAnalysisFeeUsd',
  'noBridgeRouteFeeUsd',
  'superload',
  'routeInspection',
  'escortRules',
] as const;

export type CoverageCategory = (typeof COVERAGE_CATEGORIES)[number];
export type JurisdictionCoverage = Record<CoverageCategory, CoverageStatus>;

export interface EvidenceIssue {
  jurisdiction: string;
  path: string;
  message: string;
}

interface EvidenceSource extends SourceDoc {
  quote?: unknown;
}

function coverageStatus(present: number, expected: number): CoverageStatus {
  if (present === 0) return 'missing';
  return present >= expected ? 'complete' : 'partial';
}

/** Report coverage without treating an explicit unknown as fabricated data. */
export function coverageFor(rules: JurisdictionOsowRules): JurisdictionCoverage {
  const legal = Object.values(rules.legalLimits).filter((rows) => rows.length > 0).length;
  const superload = [rules.superload.grossWeight, rules.superload.shortSpacing]
    .filter((rows) => rows.length > 0).length;
  const routeInspection = [
    rules.routeInspection.widthIn,
    rules.routeInspection.heightIn,
    rules.routeInspection.lengthIn,
  ].filter((rows) => rows.length > 0).length;

  return {
    legalLimits: coverageStatus(legal, 8),
    permitBaseFeeUsd: coverageStatus(rules.permitBaseFeeUsd.length, 1),
    overweightBands: coverageStatus(rules.overweightBands.length, 1),
    conditionalFees: coverageStatus(rules.conditionalFees.length, 1),
    transactionFee: coverageStatus(rules.transactionFee.length, 1),
    routeAnalysisFeeUsd: coverageStatus(rules.routeAnalysisFeeUsd.length, 1),
    noBridgeRouteFeeUsd: coverageStatus(rules.noBridgeRouteFeeUsd.length, 1),
    superload: coverageStatus(superload, 2),
    routeInspection: coverageStatus(routeInspection, 3),
    escortRules: coverageStatus(rules.escortRules.length, 1),
  };
}

function sourceIssues(
  jurisdiction: string,
  path: string,
  source: EvidenceSource | undefined,
): EvidenceIssue[] {
  const issues: EvidenceIssue[] = [];
  if (source === undefined || source === null || typeof source !== 'object') {
    return [{ jurisdiction, path, message: 'value lacks a source document' }];
  }

  if (typeof source.url !== 'string' || source.url.trim() === '') {
    issues.push({ jurisdiction, path, message: 'source URL is missing' });
  } else {
    try {
      const url = new URL(source.url);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        issues.push({ jurisdiction, path, message: 'source URL must use HTTP(S)' });
      }
    } catch {
      issues.push({ jurisdiction, path, message: 'source URL is not valid' });
    }
  }

  if (typeof source.quote !== 'string' || source.quote.trim() === '') {
    issues.push({ jurisdiction, path, message: 'verbatim source quote is missing' });
  }

  if (!Object.hasOwn(source, 'revisedOn')) {
    issues.push({ jurisdiction, path, message: 'revision-date field is missing' });
  } else if (source.revisedOn !== null &&
      (typeof source.revisedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(source.revisedOn))) {
    issues.push({
      jurisdiction,
      path,
      message: 'revision date must be YYYY-MM-DD or null when no complete date is stated',
    });
  }

  if (typeof source.retrievedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(source.retrievedOn)) {
    issues.push({ jurisdiction, path, message: 'retrieval date is missing or invalid' });
  }

  return issues;
}

function sourcedIssues<T>(
  jurisdiction: string,
  path: string,
  rows: readonly Sourced<T>[],
): EvidenceIssue[] {
  return rows.flatMap((row, index) =>
    sourceIssues(jurisdiction, `${path}[${index}]`, row?.source as EvidenceSource | undefined),
  );
}

/** Verify every sourced value and every escort threshold in one data object. */
export function verifyJurisdictionEvidence(
  rules: JurisdictionOsowRules,
): EvidenceIssue[] {
  const jurisdiction = rules.code;
  const issues: EvidenceIssue[] = [];

  for (const [field, rows] of Object.entries(rules.legalLimits)) {
    issues.push(...sourcedIssues(jurisdiction, `legalLimits.${field}`, rows));
  }
  issues.push(...sourcedIssues(jurisdiction, 'permitBaseFeeUsd', rules.permitBaseFeeUsd));
  issues.push(...sourcedIssues(jurisdiction, 'overweightBands', rules.overweightBands));
  issues.push(...sourcedIssues(jurisdiction, 'conditionalFees', rules.conditionalFees));
  issues.push(...sourcedIssues(jurisdiction, 'transactionFee', rules.transactionFee));
  issues.push(...sourcedIssues(jurisdiction, 'routeAnalysisFeeUsd', rules.routeAnalysisFeeUsd));
  issues.push(...sourcedIssues(jurisdiction, 'noBridgeRouteFeeUsd', rules.noBridgeRouteFeeUsd));
  issues.push(...sourcedIssues(jurisdiction, 'superload.grossWeight', rules.superload.grossWeight));
  issues.push(...sourcedIssues(jurisdiction, 'superload.shortSpacing', rules.superload.shortSpacing));
  issues.push(...sourcedIssues(jurisdiction, 'routeInspection.widthIn', rules.routeInspection.widthIn));
  issues.push(...sourcedIssues(jurisdiction, 'routeInspection.heightIn', rules.routeInspection.heightIn));
  issues.push(...sourcedIssues(jurisdiction, 'routeInspection.lengthIn', rules.routeInspection.lengthIn));

  for (const [index, rule] of rules.escortRules.entries()) {
    issues.push(...sourceIssues(
      jurisdiction,
      `escortRules[${index}] (${rule.id})`,
      rule.source as EvidenceSource,
    ));
  }

  return issues;
}

export function verifyJurisdictions(
  jurisdictions: readonly JurisdictionOsowRules[],
): EvidenceIssue[] {
  return jurisdictions.flatMap(verifyJurisdictionEvidence);
}

/** Human-readable table used by the check script and PR logs. */
export function formatCoverageReport(
  jurisdictions: readonly JurisdictionOsowRules[],
): string {
  const header = ['Jurisdiction', ...COVERAGE_CATEGORIES];
  const rows = jurisdictions.map((rules) => {
    const coverage = coverageFor(rules);
    return [rules.code, ...COVERAGE_CATEGORIES.map((category) => coverage[category])];
  });
  const widths = header.map((cell, index) =>
    Math.max(cell.length, ...rows.map((row) => row[index]?.length ?? 0)),
  );
  const render = (row: readonly string[]) =>
    row.map((cell, index) => cell.padEnd(widths[index] ?? cell.length)).join(' | ');
  return [render(header), widths.map((width) => '-'.repeat(width)).join('-|-'), ...rows.map(render)].join('\n');
}
