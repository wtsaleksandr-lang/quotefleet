/**
 * Forward-email auto-import — pure, side-effect-free helpers.
 *
 * Carriers who turn the feature ON get a dedicated inbound address
 *   rates-<token>@<INBOUND_EMAIL_DOMAIN>
 * that they forward or BCC their rate emails to. A mail provider (SendGrid
 * Inbound Parse, Mailgun Routes, …) POSTs the parsed message to
 * /api/inbound/rate-email; the handler resolves the tenant from the `to`
 * address token, parses the rate sheet, and — when it's safe — applies it.
 *
 * Everything here is pure so it unit-tests without a DB, network, or clock:
 *   - token generation (stable once minted, unguessable, tenant-scoped)
 *   - address build / parse (round-trips)
 *   - the auto-apply-when-safe decision
 *   - picking the best content out of an inbound payload
 */
import { customAlphabet } from 'nanoid';

/** Local-part prefix for every inbound address: `rates-<token>@…`. */
export const INBOUND_LOCAL_PREFIX = 'rates-';

/** Shown in the dashboard when INBOUND_EMAIL_DOMAIN is unset, so the owner
 *  still sees the address shape while the infra isn't wired yet. */
export const PLACEHOLDER_INBOUND_DOMAIN = 'rates.example.com';

// Lowercase alphanumeric only — no `+`, `.`, `_` or case that could trip an
// email address parser or make the address ambiguous. 24 chars over a 36-char
// alphabet ≈ 124 bits of entropy: unguessable, so randoms can't spam a
// tenant's importer.
const TOKEN_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const makeToken = customAlphabet(TOKEN_ALPHABET, 24);

/** Mint a fresh, unguessable inbound-email token for a tenant. */
export function generateIngestEmailToken(): string {
  return makeToken();
}

/** The domain inbound addresses live under (env, or a visible placeholder). */
export function inboundDomain(domainFromEnv: string | undefined): string {
  const d = (domainFromEnv || '').trim().replace(/^@/, '').toLowerCase();
  return d || PLACEHOLDER_INBOUND_DOMAIN;
}

/** Build the full inbound address for a token under a domain. */
export function buildInboundAddress(token: string, domainFromEnv: string | undefined): string {
  return `${INBOUND_LOCAL_PREFIX}${token}@${inboundDomain(domainFromEnv)}`;
}

/**
 * Extract the tenant token from a single email address (case-insensitive on
 * the local part's prefix). Tolerates a `Display Name <addr>` wrapper and
 * `+suffix` sub-addressing. Returns null when it isn't one of our addresses.
 */
export function parseInboundToken(addr: string): string | null {
  if (!addr || typeof addr !== 'string') return null;
  // Pull the address out of an optional `Name <addr>` wrapper.
  const angle = addr.match(/<([^>]+)>/);
  const raw = (angle ? angle[1] : addr).trim().toLowerCase();
  const at = raw.lastIndexOf('@');
  if (at < 0) return null;
  let local = raw.slice(0, at);
  // Drop any `+suffix` sub-address so `rates-abc+forwarded@…` still resolves.
  const plus = local.indexOf('+');
  if (plus >= 0) local = local.slice(0, plus);
  if (!local.startsWith(INBOUND_LOCAL_PREFIX)) return null;
  const token = local.slice(INBOUND_LOCAL_PREFIX.length);
  // Token must be non-empty and drawn from our alphabet — reject anything else
  // so a malformed local part never resolves to a bogus token.
  if (!token || !/^[0-9a-z]+$/.test(token)) return null;
  return token;
}

/**
 * A `to` field may be a single string, a comma-joined list, or an array of
 * strings/objects (`{ address }`). Scan them all and return the FIRST token
 * that parses — so a forward that CCs other people still resolves off the
 * rates- recipient. Returns null when none match.
 */
export function resolveTokenFromRecipients(to: unknown): string | null {
  const candidates: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === 'string') candidates.push(...v.split(','));
    else if (v && typeof v === 'object') {
      const a = (v as { address?: unknown }).address;
      if (typeof a === 'string') candidates.push(a);
    }
  };
  if (Array.isArray(to)) to.forEach(push);
  else push(to);
  for (const c of candidates) {
    const token = parseInboundToken(c);
    if (token) return token;
  }
  return null;
}

/* ─────────────────────────────────────────────────────────────────────────
 * Pick the best single content out of an inbound payload to parse.
 * ───────────────────────────────────────────────────────────────────────── */

export interface InboundAttachment {
  filename?: string;
  contentType?: string;
  /** base64-encoded bytes. Providers name this differently; the route
   *  normalizes to this before calling here. */
  contentBase64?: string;
}

export interface InboundContentPick {
  filename: string;
  mimeType: string;
  dataBase64: string;
}

// Richer formats first — a forwarded rate sheet is usually an attached
// PDF/spreadsheet/image; plain text/csv is the fallback among attachments,
// and the email body is the last resort.
const ATTACHMENT_PRIORITY: Array<{ test: (mt: string) => boolean; rank: number }> = [
  { test: (mt) => mt === 'application/pdf', rank: 0 },
  { test: (mt) => mt.startsWith('image/'), rank: 1 },
  { test: (mt) => mt.includes('spreadsheet') || mt === 'application/vnd.ms-excel', rank: 1 },
  { test: (mt) => mt === 'text/csv', rank: 2 },
  { test: (mt) => mt === 'text/plain' || mt === 'text/html' || mt === 'application/json' || mt === 'text/markdown', rank: 3 },
];

function attachmentRank(contentType: string | undefined): number | null {
  const mt = (contentType || '').toLowerCase().split(';')[0].trim();
  for (const p of ATTACHMENT_PRIORITY) if (p.test(mt)) return p.rank;
  return null;
}

/**
 * Choose the single best thing to parse from an inbound email:
 *   1. the highest-priority SUPPORTED attachment (ties broken by size), else
 *   2. the email body (HTML preferred, then text) as a text/* payload.
 * Returns null when there's nothing parseable at all.
 */
export function pickBestContent(payload: {
  subject?: string;
  text?: string;
  html?: string;
  attachments?: InboundAttachment[];
}): InboundContentPick | null {
  const atts = (payload.attachments ?? []).filter((a) => a && a.contentBase64);
  let best: { att: InboundAttachment; rank: number; size: number } | null = null;
  for (const att of atts) {
    const rank = attachmentRank(att.contentType);
    if (rank == null) continue;
    const size = (att.contentBase64 ?? '').length;
    if (!best || rank < best.rank || (rank === best.rank && size > best.size)) {
      best = { att, rank, size };
    }
  }
  if (best) {
    return {
      filename: best.att.filename || 'rate-sheet',
      mimeType: (best.att.contentType || 'application/octet-stream').split(';')[0].trim().toLowerCase(),
      dataBase64: best.att.contentBase64 as string,
    };
  }

  // Fall back to the email body.
  const html = (payload.html ?? '').trim();
  const text = (payload.text ?? '').trim();
  const body = html || text;
  if (!body) return null;
  const subj = (payload.subject ?? '').trim();
  const composed = subj ? `Subject: ${subj}\n\n${body}` : body;
  return {
    filename: subj ? `${subj.slice(0, 60)}.txt` : 'forwarded-email.txt',
    mimeType: html ? 'text/html' : 'text/plain',
    dataBase64: Buffer.from(composed, 'utf8').toString('base64'),
  };
}

/* ─────────────────────────────────────────────────────────────────────────
 * The auto-apply-when-safe decision.
 * ───────────────────────────────────────────────────────────────────────── */

export interface AutoApplyDecision {
  autoApply: boolean;
  /** Short machine reason, surfaced in the audit entry + logs. */
  reason: string;
}

/**
 * Decide whether an email-imported draft is safe to apply automatically.
 *
 * AUTO-APPLY only when ALL of:
 *   - the parser was HIGH confidence,
 *   - the system auto-check found ZERO flagged sample lanes (and actually ran
 *     ≥1 sample — an empty check is not evidence of safety),
 *   - the draft actually contains something to apply.
 * Anything else is held as a ready_for_review draft for a human glance. This is
 * the safety net: we never blindly apply low-confidence or mis-priced rates.
 */
export function decideEmailImport(
  parsed: { confidence?: string; rateCards?: unknown[]; accessorials?: unknown[]; laneZones?: unknown[] } | null | undefined,
  autoCheck: { total: number; flaggedCount: number },
): AutoApplyDecision {
  const p = parsed || {};
  const hasContent =
    (p.rateCards?.length ?? 0) > 0 ||
    (p.accessorials?.length ?? 0) > 0 ||
    (p.laneZones?.length ?? 0) > 0;
  if (!hasContent) return { autoApply: false, reason: 'nothing_extracted' };
  if (p.confidence !== 'high') return { autoApply: false, reason: `confidence_${p.confidence ?? 'unknown'}` };
  if (autoCheck.total < 1) return { autoApply: false, reason: 'no_autocheck_samples' };
  if (autoCheck.flaggedCount > 0) return { autoApply: false, reason: 'autocheck_flagged' };
  return { autoApply: true, reason: 'high_confidence_all_clean' };
}
