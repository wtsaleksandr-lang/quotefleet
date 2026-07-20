/**
 * Currency awareness for the AI-written lead reply / quote summary.
 *
 * Context: a quote is priced in the CARRIER's own currency ('USD' | 'CAD',
 * persisted as `leads.quotedCurrency`). Every deterministic surface — the
 * quote-doc breakdown, the notification email, the booking totals — labels
 * that amount via `formatEmailMoney`, giving "$2,450.00" (USD) and
 * "CA$2,450.00" (CAD).
 *
 * `leads.aiSummary` is the one exception: it is AI-written PROSE, and the
 * model defaults to a bare "$". A Canadian carrier's quote page therefore read
 * "CA$8,578.39" in the breakdown and "$8,578.39" in the summary paragraph.
 *
 * This module fixes that at both ends:
 *   1. `currencyInstructionSection()` — an ADDITIVE prompt block telling the
 *      model, concretely, which symbol to write. Appended to the existing lead
 *      reply prompt; nothing existing is reworded or removed.
 *   2. `labelSummaryCurrency()` — a defensive post-format pass for the CAD
 *      case, for when the model ignores the instruction anyway.
 *
 * LABELLING ONLY. Nothing here converts, rounds, or otherwise touches the
 * VALUE of an amount — only the symbol in front of it.
 */
import { formatEmailMoney, type QuoteCurrency } from '../email/templates.js';

export type { QuoteCurrency };

/** Narrow a free-text DB column (`leads.quotedCurrency` is `text`) to the
 *  supported union. Anything unrecognised falls back to USD, matching the
 *  column default and the rest of the codebase. */
export function resolveQuoteCurrency(value: string | null | undefined): QuoteCurrency {
  return value === 'CAD' ? 'CAD' : 'USD';
}

/** The bare symbol for a currency ("$" / "CA$"), derived from the shared
 *  email money formatter so prompt text can never drift from what the
 *  deterministic surfaces actually render. */
export function quoteCurrencySymbol(currency: QuoteCurrency): string {
  // formatEmailMoney(0) -> "$0.00" / "CA$0.00"; strip from the first digit on.
  return formatEmailMoney(0, currency).replace(/[\d.,].*$/, '');
}

/**
 * A labelled prompt section pinning the model to this quote's currency.
 *
 * Deliberately concrete: a vague "use the right currency" does not reliably
 * survive generation, so we name the symbol, show a worked example, and — for
 * CAD — explicitly contradict the US-formatted example that appears earlier in
 * the lead-reply prompt.
 */
export function currencyInstructionSection(
  currency: QuoteCurrency,
  /** Which AI surface this block is appended to. The CAD correction has to name
   *  the right artefact: the lead-reply prompt contains a US-formatted example
   *  ("Quote #QF-2026-0042 — $1,847") that must be explicitly overridden, while
   *  the follow-up chat has no such example and is not writing an email at all.
   *  Defaults to 'email' so the lead-reply prompt is byte-identical. */
  surface: 'email' | 'chat' = 'email'
): string {
  const symbol = quoteCurrencySymbol(currency);
  const example = formatEmailMoney(8578.39, currency);
  const scope =
    surface === 'email'
      ? `This applies to EVERY amount in the email, including the opening line — where the ` +
        `example format shown above uses US formatting, write "Quote #QF-2026-0042 — CA$1,847" instead.`
      : `This applies to EVERY amount you write, including each line when you re-explain ` +
        `the quote breakdown and any total you restate back to the customer.`;
  const cad =
    currency === 'CAD'
      ? ` A bare "$" is WRONG for this quote: write "${example}", never "$8,578.39". ${scope}`
      : '';
  return (
    `\n\nCURRENCY — MANDATORY. This quote is priced in ${currency}. ` +
    `Every monetary amount you write must carry the ${currency} symbol "${symbol}", ` +
    `formatted exactly like "${example}".${cad} ` +
    `Never convert, recalculate, round or restate an amount at a different value — ` +
    `the figures you are given are final and you only re-label them.`
  );
}

/**
 * Defensive post-format pass: upgrade a bare "$" to "CA$" in an
 * already-generated CAD summary.
 *
 * Safety properties (all covered by unit tests):
 *  - USD is returned byte-for-byte untouched.
 *  - Only the "$" CHARACTER is ever rewritten — no digit, separator or other
 *    character is added, removed or moved, so an amount can never change value.
 *  - An amount that is already explicitly labelled ("CA$", "US$", "CAD $",
 *    "USD $") is skipped via a lookbehind for exactly those currency tokens,
 *    so we can never emit "CACA$" and the pass is idempotent.
 */
export function labelSummaryCurrency(
  text: string | null | undefined,
  currency: QuoteCurrency
): string | null | undefined {
  // AI disabled / unavailable → summary may be null. Pass it straight back.
  if (!text || currency !== 'CAD') return text;
  // Matches a "$" that is NOT already preceded by a currency token (optionally
  // with one space between). The leading \b keeps ordinary words that merely
  // END in those letters — "bus $50", "surplus $12" — eligible for relabelling.
  return text.replace(/(?<!\b(?:CA|US|CAD|USD)\s?)\$/g, () => 'CA$');
}
