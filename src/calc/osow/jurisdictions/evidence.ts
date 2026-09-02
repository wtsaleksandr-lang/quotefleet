/**
 * Provenance contract for jurisdiction data added after the Texas pilot.
 *
 * `SourceDoc.cite` is a pinpoint locator. It is not evidence text. The
 * research guard therefore requires every source used by these jurisdiction
 * files to carry the source's exact words separately as `quote`.
 */
import type { SourceDoc, Sourced } from '../provenance.js';

export interface EvidenceSourceDoc extends SourceDoc {
  /** Verbatim text from the official source supporting the stored value. */
  quote: string;
  /** Exact source text when it states only a month or year, not a full ISO date. */
  documentRevisionText?: string;
}

/**
 * Effective dates follow the Texas convention: use the document's own date
 * when it states one, otherwise start the evidence window on retrieval day.
 */
export function fromSource<T>(
  value: T,
  source: EvidenceSourceDoc,
  note?: string,
): Sourced<T> {
  return {
    value,
    source,
    effectiveFrom: source.revisedOn ?? source.retrievedOn,
    effectiveTo: null,
    ...(note === undefined ? {} : { note }),
  };
}

/** Effective-dated escort-rule fields sourced from the same document. */
export function escortDates(source: EvidenceSourceDoc): {
  effectiveFrom: string;
  effectiveTo: null;
} {
  return {
    effectiveFrom: source.revisedOn ?? source.retrievedOn,
    effectiveTo: null,
  };
}
