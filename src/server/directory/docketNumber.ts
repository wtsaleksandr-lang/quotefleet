/**
 * FMCSA docket-number formatting — the SINGLE source of truth for how an
 * `mc_number` is rendered anywhere in the product.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * `carrier_directory.mc_number` stores the docket VERBATIM as the L&I feed
 * supplies it, which is ALREADY PREFIXED — "MC012892", "FF003456" — never a
 * bare number (see `normalizeMc` in carrierIngest.ts). Render sites that hand-
 * wrote `MC ${mcNumber}` therefore emitted "MC MC012892". Four sites formatted
 * this field by hand, so the bug appeared in four places at once; every site
 * now routes through here.
 *
 * NOT EVERY DOCKET IS AN "MC" DOCKET. FMCSA issues several registries — MC
 * (motor carrier), FF (freight forwarder) and MX (Mexican carrier) — and the
 * directory holds FF rows today. Blindly stripping "MC" and re-prefixing "MC"
 * would relabel a freight forwarder as a motor carrier, which is a worse bug
 * than the doubled prefix. So the stored prefix is PRESERVED when present, and
 * "MC" is assumed only for a bare number (the shape a human types into the
 * account form).
 *
 * Leading zeros are kept: "MC012892" displays as "MC 012892", because the zeros
 * are part of how FMCSA prints the identifier. (Search normalization is a
 * separate concern — see `normalizeMcQuery`, which reduces to bare digits.)
 *
 * Pure + total: never throws, returns null rather than a bare "MC " for an
 * empty or digit-less value. Idempotent — formatting an already-formatted
 * value is a no-op.
 */

/** Registry prefix + the digits it applies to. */
export type DocketParts = { prefix: string; digits: string };

/**
 * A docket is an optional alpha registry prefix, an optional separator, then
 * digits. Anchored on both ends so trailing junk falls through to the caller's
 * verbatim fallback instead of being silently truncated.
 */
const DOCKET_RE = /^([A-Za-z]{1,3})?[\s._:-]*(\d+)$/;

/**
 * Split a stored/entered docket into its registry prefix and digits.
 * Returns null when the value carries no digits at all ("", "MC", "N/A"), or
 * when it does not parse as a single docket — callers decide what to do then.
 */
export function docketParts(value: unknown): DocketParts | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  const m = DOCKET_RE.exec(s);
  if (!m) return null;
  // No prefix in the source ⇒ a bare docket number, which is an MC docket.
  return { prefix: (m[1] ?? 'MC').toUpperCase(), digits: m[2]! };
}

/**
 * Display form: "MC 012892", "FF 003456". Exactly one prefix, one space.
 *
 * Returns null for an empty or prefix-only value, so callers render nothing at
 * all rather than a dangling "MC ". A value that carries digits but does not
 * parse as a single docket is returned trimmed-verbatim — better to show the
 * operator's own text than to drop a real identifier or mislabel its registry.
 */
export function formatDocketNumber(value: unknown): string | null {
  const parts = docketParts(value);
  if (parts) return `${parts.prefix} ${parts.digits}`;
  const s = value == null ? '' : String(value).trim();
  return /\d/.test(s) ? s : null;
}

/**
 * Canonical STORED form: "MC012892" — upper-cased, separators removed, prefix
 * preserved. Used by the ingest so a future feed-format drift ("mc-12892",
 * " MC 12892 ") cannot introduce a second storage shape. Existing rows are
 * already in this form, so this is a no-op for them.
 */
export function canonicalDocketNumber(value: unknown): string | null {
  const parts = docketParts(value);
  if (parts) return `${parts.prefix}${parts.digits}`;
  const s = value == null ? '' : String(value).trim();
  return s.length ? s : null;
}
