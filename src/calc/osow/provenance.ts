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
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ONE ROW CAN NOW BE CONFINED TO PART OF A JURISDICTION — `appliesWhen`.
 * ─────────────────────────────────────────────────────────────────────────
 * The resolver's contract above rests on an assumption that held for nine
 * phases and does not hold for the tenth: that two rows for one field are two
 * READINGS OF THE SAME RULE, so different values mean the sources disagree.
 *
 * Kansas breaks it. K.S.A. 8-1909(a)(2) caps gross weight at 80,000 lb ON THE
 * INTERSTATE SYSTEM, and the same section's printed table governs off it and
 * reaches higher. Nebraska is the same shape — NDOT: "Legal gross weight on
 * Interstate-designated routes is 80,000 lbs. Legal gross weight on US and
 * State routes is 94,000 lbs." Maryland's legal single axle is 22,400 lb or
 * 20,000 lb by the vehicle's REGISTERED weight. Minnesota's differs between
 * paved and unpaved roads. In every one of those the two numbers are both
 * correct, about different moves, and feeding them to a resolver that reads
 * difference as conflict would send every quote in four states to review over a
 * disagreement that does not exist.
 *
 * So a row may carry a `ContextCondition`. Rows the context DEFINITELY excludes
 * drop out; rows it definitely includes stay; rows that cannot be decided stay
 * TOO, because dropping them would answer from the rows that happened to be
 * decidable — and if they then disagree, the conflict is real and the warning
 * names the fact that would settle it.
 *
 * A ROW WITHOUT `appliesWhen` IS UNCONDITIONAL, and a `resolveSourced` call
 * with no context behaves exactly as it did before this existed. That is not a
 * hope: no jurisdiction on file carries a conditioned row, so every one of them
 * takes the untouched path.
 */
import type { ContextCondition, MoveContext, RouteVocabulary } from './routeContext.js';
import { evaluateContextCondition, newContextTrace } from './routeContext.js';

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
   *
   * A PARTIAL DATE IS ALLOWED HERE, AND ONLY HERE. Some documents state a year
   * and nothing else. The Virginia Law Portal's history lines are the case:
   * §46.2-1124 and §46.2-1127 — the statutes that set Virginia's axle and gross
   * weight limits — show "1989" with no month and no day. Writing `1989-01-01`
   * would invent a precision the source does not have, and writing `null` would
   * throw away the single most useful thing the line says, which is that
   * Virginia's weight law has not been touched in thirty-seven years. So
   * `YYYY` and `YYYY-MM` are both accepted for `revisedOn`, they sort correctly
   * against full dates under the lexicographic comparison the resolver uses
   * (`'1989' < '2023-03-01'`), and a bare year ranks as the OLDER evidence
   * against any full date inside the same year — the conservative reading.
   *
   * `effectiveFrom`, `effectiveTo` and `retrievedOn` stay strict `YYYY-MM-DD`.
   * They feed `isInEffect`, where a partial date would silently mis-window a row.
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
  /**
   * A condition confining this row to SOME moves in the jurisdiction — a road
   * class, a named segment, a time of day, a season, a registered weight, a
   * vehicle configuration. OPTIONAL, and absent means the row is unconditional,
   * which is what every row on file today is.
   *
   * It is the difference between "two sources disagree about one number" and
   * "one source states two numbers about two different moves". See the module
   * header for the four states that forced it.
   */
  appliesWhen?: ContextCondition;
}

/**
 * What a conditioned row is resolved against.
 *
 * Passing none is the same as passing a context with nothing in it EXCEPT in
 * one respect, and the difference matters: with no context at all, a
 * conditioned row is undecidable and is retained; that is deliberate, because
 * "we were not asked about the road class" and "we were asked and the answer is
 * no" must not produce the same row set.
 */
export interface SourcedContext {
  move: MoveContext;
  /** The jurisdiction's own road vocabulary, when it declares one. */
  vocabulary?: RouteVocabulary;
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
  /**
   * Context facts that would have decided which conditioned row applies, and
   * were not supplied. OPTIONAL and absent unless a row carried `appliesWhen`.
   *
   * It is populated even when the resolution came out clean, because "these
   * rows agree so it did not matter this time" is worth saying once and is not
   * worth a warning. It becomes a warning only when the undecided rows are what
   * produced the conflict — see `resolveSourced`.
   */
  conditionsUnresolved?: string[];
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
 *
 * `context` filters CONDITIONED rows before any of that runs — see
 * `Sourced.appliesWhen`. Rows the context definitely excludes are gone as if
 * they had expired; rows it cannot decide are kept, so an undecidable condition
 * can never quietly narrow the evidence. When keeping them is what produces the
 * conflict, the warning names the fact that would have settled it, because
 * "sources disagree" is the wrong thing to tell someone whose real problem is
 * that they did not say which road they are on.
 */
export function resolveSourced<T>(
  field: string,
  candidates: Sourced<T>[],
  asOf: IsoDate,
  equals: (a: T, b: T) => boolean = (a, b) => a === b,
  context?: SourcedContext,
): Resolution<T> {
  const dated = candidates.filter((c) => isInEffect(c, asOf));

  // FAST PATH, AND IT IS THE ONLY PATH ANY JURISDICTION ON FILE TAKES. With no
  // conditioned row there is nothing to filter, no trace to build and no field
  // to add — the resolution is byte-identical to the pre-`appliesWhen` one.
  const conditioned = dated.some((c) => c.appliesWhen !== undefined);
  let inEffect = dated;
  let unresolvedConditions: string[] = [];
  if (conditioned) {
    const kept: Sourced<T>[] = [];
    const missing = new Set<string>();
    for (const row of dated) {
      if (row.appliesWhen === undefined) {
        kept.push(row);
        continue;
      }
      if (context === undefined) {
        // Not asked. The row might apply; dropping it would answer from the
        // unconditioned rows alone, which is a different and quieter claim.
        // Evaluating against an EMPTY context is how the labels are collected —
        // every leaf reports the fact it wanted, which is exactly the list a
        // caller needs to make this resolvable.
        kept.push(row);
        const blank = newContextTrace();
        evaluateContextCondition(row.appliesWhen, {}, undefined, blank);
        for (const label of blank.missing) missing.add(label);
        continue;
      }
      const trace = newContextTrace();
      const verdict = evaluateContextCondition(
        row.appliesWhen,
        context.move,
        context.vocabulary,
        trace,
      );
      if (verdict === false) continue;
      kept.push(row);
      if (verdict === 'unknown') for (const label of trace.missing) missing.add(label);
    }
    inEffect = kept;
    unresolvedConditions = [...missing];
  }

  if (inEffect.length === 0) {
    const held = candidates.length === 0
      ? 'we hold no data for this field'
      : `we hold ${candidates.length} row(s), effective ${candidates
          .map((c) => `${c.effectiveFrom}–${c.effectiveTo ?? 'open'}`)
          .join(', ')}`;
    // Every row was ruled out by the move itself rather than by the calendar.
    // That is a different sentence and it must be said, or a carrier reads
    // "nothing on file" as a research gap when the real answer is that this
    // state publishes nothing for the road it named.
    const excluded =
      dated.length > 0
        ? ` Every row we hold for ${asOf} is confined to conditions this move does not meet (${dated
            .map((c) => c.note ?? c.source.title)
            .join('; ')}).`
        : '';
    return {
      field,
      value: null,
      chosen: null,
      candidates: [],
      conflict: false,
      warnings: [
        `No ${field} is on file as effective on ${asOf} — ${held}.${excluded} This figure must be confirmed against the issuing agency before it is quoted.`,
      ],
      requiresManualReview: true,
      ...(unresolvedConditions.length > 0 ? { conditionsUnresolved: unresolvedConditions } : {}),
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
    // Rows we could not place still AGREE with the ones we could, so the
    // undecided condition changed nothing. It is recorded and not warned about
    // — a warning on a question whose answer would not have moved the number
    // is exactly the noise that trains people to skip warnings.
    return {
      field,
      value: first.value,
      chosen: first,
      candidates: ranked,
      conflict: false,
      warnings: [],
      requiresManualReview: false,
      ...(unresolvedConditions.length > 0 ? { conditionsUnresolved: unresolvedConditions } : {}),
    };
  }

  // Deliberately does NOT pick a winner. See module header.
  const detail = ranked
    .map((r) => `${JSON.stringify(r.value)} per ${citeOf(r.source)}`)
    .join(' — versus — ');
  // THE DISAGREEMENT MAY NOT BE A DISAGREEMENT. When an undecided condition is
  // what left both rows standing, the rows may be about two different moves and
  // the fix is an answer, not an adjudication — so the warning asks for the
  // answer instead of telling a carrier their state contradicts itself.
  const because =
    unresolvedConditions.length > 0
      ? ` One or more of these rows applies only under conditions this quote does not state (${unresolvedConditions.join('; ')}) — supplying that would decide between them.`
      : '';
  return {
    field,
    value: null,
    chosen: null,
    candidates: ranked,
    conflict: true,
    warnings: [
      `Official sources disagree on ${field}: ${detail}.${because} Both are on file; neither has been adopted. This permit must be priced by the agency before the quote is issued.`,
    ],
    requiresManualReview: true,
    ...(unresolvedConditions.length > 0 ? { conditionsUnresolved: unresolvedConditions } : {}),
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
