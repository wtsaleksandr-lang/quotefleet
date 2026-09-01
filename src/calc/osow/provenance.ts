/**
 * OS/OW provenance + effective-dating.
 *
 * EVERY number in the oversize/overweight engine — every fee, every legal
 * limit, every escort threshold — is stored as a `Sourced<T>`: the value plus
 * the document it came from, that document's OWN revision date, the date we
 * retrieved it, and the window it is effective for.
 *
 * This is not bookkeeping garnish. Two things forced it:
 *
 *   1. STATE SOURCES CONTRADICT EACH OTHER. Pennsylvania's statute quotes
 *      $35/$71 for oversize permit issuance while the state's own application
 *      form says $46/$97. Both are official. Without provenance you cannot
 *      even *state* the disagreement, let alone adjudicate it — you just pick
 *      one at random and ship a wrong number with a confident face.
 *
 *   2. UNDATED DATA ROTS SILENTLY. AccessToNorth carries a latent bug from
 *      discarding an `EFF_DATE` column: the rows are still there, nobody can
 *      say which ones apply today. A fee schedule without an effective-from is
 *      a fee schedule you cannot safely reprice from.
 *
 * The resolution rule is the important part, and it is deliberately unlike a
 * normal lookup: **when two in-effect sources disagree, we do not pick.** We
 * return both, mark the field unresolved, and force `requiresManualReview`.
 * A range the customer can see ("issuance is $35–$46, our sources disagree")
 * is worth more than a single confident number that might be wrong. This
 * mirrors LoadMode's `DutyResult` contract, where an unknown degrades to a
 * warning rather than a guess.
 */

/** `YYYY-MM-DD`. Compared lexicographically, which is correct for ISO dates. */
export type IsoDate = string;

/** A free, public, citable source document. No paywalled or vendor sources. */
export interface SourceDoc {
  /** Stable key so a row can be traced to its document in logs and tests. */
  id: string;
  title: string;
  /** Public URL. State DOT / eCFR / statute sites only — never a competitor. */
  url: string;
  publisher: string;
  /**
   * The revision or publication date the SOURCE DOCUMENT ITSELF carries — a
   * PDF footer, a rule's stated effective date, a "last revised" line.
   *
   * `null` means the document states no date. That is a RECORDED FACT, not a
   * gap to be filled in with today's date. TxDMV's OS/OW fee schedule, for
   * instance, carries a February 2021 footer — "we downloaded it today" tells
   * you nothing about whether the numbers are current, and conflating the two
   * is how a five-year-old fee ends up presented as this morning's price.
   */
  revisedOn: IsoDate | null;
  /** When WE fetched and read it. Always known. */
  retrievedOn: IsoDate;
  /** Pinpoint cite: 'p. 2, "Single Trip"', '43 TAC §219.11(b)(2)'. */
  cite?: string;
}

/** A value that knows where it came from and when it applies. */
export interface Sourced<T> {
  value: T;
  source: SourceDoc;
  /**
   * First date this value is in effect. Required — a value with no known
   * start is not usable, and defaulting it to "forever" is the exact bug
   * described in the module header.
   */
  effectiveFrom: IsoDate;
  /** Last date in effect; `null` = open-ended (no end date stated). */
  effectiveTo: IsoDate | null;
  /** Free-text qualifier, e.g. 'statute figure; the application form differs'. */
  note?: string;
}

/** Outcome of resolving a set of candidate values for one field. */
export interface Resolution<T> {
  /** Human-readable field name, used in warning text. */
  field: string;
  /**
   * The resolved value, or `null` when it cannot be resolved — no in-effect
   * candidate, or in-effect candidates that disagree. Callers MUST handle
   * null; there is no "close enough" fallback here on purpose.
   */
  value: T | null;
  /** The winning row when exactly one value is in effect (or all agree). */
  chosen: Sourced<T> | null;
  /** Every candidate in effect on the as-of date. */
  candidates: Sourced<T>[];
  /** True when in-effect candidates carry DIFFERENT values. */
  conflict: boolean;
  warnings: string[];
  requiresManualReview: boolean;
}

/** Anything effective-dated — a `Sourced<T>` value or an `EscortRule`. */
export interface EffectiveDated {
  effectiveFrom: IsoDate;
  effectiveTo: IsoDate | null;
}

/** True when `asOf` falls inside the row's effective window. */
export function isInEffect(row: EffectiveDated, asOf: IsoDate): boolean {
  if (asOf < row.effectiveFrom) return false;
  if (row.effectiveTo !== null && asOf > row.effectiveTo) return false;
  return true;
}

/** Compact citation for warning text: title, revision date, URL. */
export function citeOf(source: SourceDoc): string {
  const rev = source.revisedOn
    ? `rev. ${source.revisedOn}`
    : 'no revision date stated';
  const pin = source.cite ? `, ${source.cite}` : '';
  return `${source.title} (${rev}${pin}) ${source.url}`;
}

/**
 * Resolve one field from its candidate rows, as of a date.
 *
 * Cases, in order:
 *   - nothing in effect  → value null, manual review. (We may hold rows that
 *     expired or have not started; saying "we don't know today's fee" is the
 *     honest answer, and the warning lists what windows we DO hold.)
 *   - one in effect      → that value, clean.
 *   - several, all equal → corroboration, not conflict. Newest source revision
 *     wins as `chosen`; no warning, because nothing is in dispute.
 *   - several, disagree  → CONFLICT. value null, both cited in the warning,
 *     manual review. Callers can still show a range via `spreadOf`.
 */
export function resolveSourced<T>(
  field: string,
  candidates: Sourced<T>[],
  asOf: IsoDate,
  equals: (a: T, b: T) => boolean = (a, b) => a === b,
): Resolution<T> {
  const inEffect = candidates.filter((c) => isInEffect(c, asOf));

  if (inEffect.length === 0) {
    const held = candidates.length === 0
      ? 'we hold no data for this field'
      : `we hold ${candidates.length} row(s), effective ${candidates
          .map((c) => `${c.effectiveFrom}–${c.effectiveTo ?? 'open'}`)
          .join(', ')}`;
    return {
      field,
      value: null,
      chosen: null,
      candidates: [],
      conflict: false,
      warnings: [
        `No ${field} is on file as effective on ${asOf} — ${held}. This figure must be confirmed against the issuing agency before it is quoted.`,
      ],
      requiresManualReview: true,
    };
  }

  // Newest source revision first; undated documents sort last, because a
  // document that will not say when it was written is the weakest evidence.
  const ranked = [...inEffect].sort((a, b) => {
    const ar = a.source.revisedOn ?? '';
    const br = b.source.revisedOn ?? '';
    if (ar !== br) return br.localeCompare(ar);
    return b.effectiveFrom.localeCompare(a.effectiveFrom);
  });

  const first = ranked[0] as Sourced<T>;
  const disagree = ranked.some((r) => !equals(r.value, first.value));

  if (!disagree) {
    return {
      field,
      value: first.value,
      chosen: first,
      candidates: ranked,
      conflict: false,
      warnings: [],
      requiresManualReview: false,
    };
  }

  // Deliberately does NOT pick a winner. See module header.
  const detail = ranked
    .map((r) => `${JSON.stringify(r.value)} per ${citeOf(r.source)}`)
    .join(' — versus — ');
  return {
    field,
    value: null,
    chosen: null,
    candidates: ranked,
    conflict: true,
    warnings: [
      `Official sources disagree on ${field}: ${detail}. Both are on file; neither has been adopted. This permit must be priced by the agency before the quote is issued.`,
    ],
    requiresManualReview: true,
  };
}

/**
 * Low/high across a numeric field's in-effect candidates. Lets a conflicted
 * field still be shown as an honest RANGE ("$35–$46, sources disagree")
 * instead of vanishing from the breakdown entirely. Returns nulls when there
 * is nothing in effect.
 */
export function spreadOf(
  resolution: Resolution<number>,
): { low: number | null; high: number | null } {
  if (resolution.candidates.length === 0) return { low: null, high: null };
  const values = resolution.candidates.map((c) => c.value);
  return { low: Math.min(...values), high: Math.max(...values) };
}

/**
 * Every distinct source behind a set of resolutions, in first-seen order —
 * the citation list rendered under a quote so a customer (or a DOT officer)
 * can check our arithmetic against the state's own documents.
 */
export function citedSources(
  resolutions: Array<Resolution<unknown>>,
): SourceDoc[] {
  const seen = new Map<string, SourceDoc>();
  for (const r of resolutions) {
    for (const c of r.candidates) {
      if (!seen.has(c.source.id)) seen.set(c.source.id, c.source);
    }
  }
  return [...seen.values()];
}

/** Today as `YYYY-MM-DD` (UTC), the default as-of date for a live quote. */
export function todayIso(now: Date = new Date()): IsoDate {
  return now.toISOString().slice(0, 10);
}
