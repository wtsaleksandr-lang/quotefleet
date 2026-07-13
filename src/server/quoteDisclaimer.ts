/**
 * Quote disclaimer / terms — shown at the bottom of every quote (widget
 * result card, hosted quote page, and the printable/PDF quote).
 *
 * Single source of truth for BOTH the default text and the null/empty →
 * default fallback, so every render surface resolves identically. The tenant
 * column `tenants.quote_disclaimer` (nullable text) holds an optional override
 * the carrier edits in Account → Company details.
 *
 * Behavior (see resolveQuoteDisclaimer):
 *   • null / empty / whitespace  → render DEFAULT_QUOTE_DISCLAIMER
 *   • any non-empty text         → render the tenant's own text verbatim
 *
 * We deliberately fall back to the default rather than hiding when the field
 * is blank: a disclaimer is a legal protection, so "blank = the safe default"
 * is safer than "blank = no terms at all". Carriers edit the text to add their
 * own specifics (per-diem, SSL/steamship-line terms, lane-specific clauses).
 */

export const DEFAULT_QUOTE_DISCLAIMER =
  "This quote is subject to the availability of the requested services and " +
  "equipment at the time of booking; if availability changes we'll notify you " +
  "and work with you to find a suitable alternative. Rates assume shipments " +
  "within legal weight and dimension limits — exceeding them may require rate " +
  "adjustments or additional accessorial charges, and weight limits are " +
  "subject to local regulations and road restrictions. We are not responsible " +
  "for delays or obstructions beyond our control, including weather, traffic, " +
  "road closures, labor actions, or port/terminal congestion. Final invoices " +
  "may be adjusted to reflect the actual services rendered, weight, " +
  "dimensions, and accessorial charges; any discrepancies identified at " +
  "pickup or delivery will be reviewed and may result in a revised invoice. " +
  "This quote is valid for 30 days from the date of issue, after which " +
  "pricing and terms may change.";

/**
 * Resolve the disclaimer text to render for a tenant. Returns the tenant's
 * override when set, otherwise the platform default. Always returns a
 * non-empty string (blank falls back to the default).
 */
export function resolveQuoteDisclaimer(raw: string | null | undefined): string {
  const trimmed = (raw ?? '').trim();
  return trimmed.length ? trimmed : DEFAULT_QUOTE_DISCLAIMER;
}
