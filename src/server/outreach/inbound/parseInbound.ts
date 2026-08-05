/**
 * Inbound-email parsing helpers — REVERSE OUTREACH, Phase 1.
 *
 * Pure, dependency-free text utilities used by the (later) inbound harvester to
 * turn a raw broker/carrier marketing email into the fields the pipeline needs:
 * the sender address, the Message-ID (dedupe key), the NEW message text with the
 * quoted reply chain stripped, a rough HTML→text fallback, and a best-effort
 * signature block (name / phone / title).
 *
 * The first four helpers are ported verbatim from WeFixTrades'
 * server/routes/inboundEmailRoutes.ts (they are generic mail helpers). No
 * network, no DB, no env — every function is a pure string transform so it is
 * trivially unit-tested and safe to call anywhere.
 */

/* ─── Sender / Message-ID ─── */

/** Extract a bare email address from a From-style header value. */
export function extractEmail(raw: string): string | null {
  if (!raw) return null;
  const angle = raw.match(/<([^>]+)>/);
  const candidate = (angle ? angle[1] : raw).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;
}

/** Pull the Message-ID from a raw header block (for dedup). */
export function extractMessageId(headers: string): string | null {
  const m = (headers || '').match(/^message-id:\s*(.+)$/im);
  return m ? m[1].trim() : null;
}

/* ─── Quoted-reply stripping ─── */

/** Reply markers — text at/after the earliest one is the quoted original. */
export const QUOTE_MARKERS: RegExp[] = [
  /^On .+ wrote:\s*$/im,                  // Gmail / Apple Mail
  /^-{2,}\s*Original Message\s*-{2,}/im,  // Outlook
  /^_{5,}/m,                              // Outlook divider line
  /^From:\s.+\r?\nSent:\s/im,             // Outlook reply header
];

/** Strip the quoted reply chain — keep just the new message text. */
export function stripQuotedText(text: string): string {
  let cut = text.length;
  for (const re of QUOTE_MARKERS) {
    const m = text.match(re);
    if (m && m.index !== undefined && m.index < cut) cut = m.index;
  }
  let body = text.slice(0, cut);
  // Drop a trailing run of ">"-quoted lines the markers above didn't catch.
  body = body.replace(/(?:^>.*$\r?\n?)+\s*$/m, '');
  return body.trim();
}

/* ─── HTML → text ─── */

/** Rough HTML → text — used only when the mail has no plain-text part. */
export function htmlToText(html: string): string {
  return html
    .replace(/<\s*(br|\/p|\/div)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ─── Signature extraction ─── */

export interface InboundSignature {
  name?: string;
  phone?: string;
  title?: string;
}

/** Sign-off lines that typically precede a signature block. */
const SIGNOFF_RE =
  /^\s*(thanks(?:\s+so\s+much)?|thank\s+you|many\s+thanks|best|best\s+regards|regards|kind\s+regards|warm\s+regards|cheers|sincerely|respectfully|talk\s+soon|all\s+the\s+best|yours\s+truly)[,!.\s]*$/i;

/** Role/title keywords — a line carrying one is the job-title line. */
const TITLE_RE =
  /\b(manager|director|president|vice\s+president|vp|ceo|cfo|coo|cto|founder|co-?founder|owner|proprietor|coordinator|dispatcher|dispatch|brokerage|broker|carrier\s+sales|account\s+executive|account|executive|representative|rep|sales|logistics|operations|supervisor|specialist|principal|partner)\b/i;

/** Reuse enrichCompany's North-American phone shape. */
const PHONE_RE = /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/;

/** A person-name-shaped line: 1–4 capitalized tokens, no digits/@/url. */
const NAME_RE = /^[A-Z][A-Za-z'’.-]*(?:\s+[A-Z][A-Za-z'’.-]*){1,3}$/;

/**
 * Best-effort signature parse. Looks at the trailing block (the lines after the
 * last sign-off, or the final handful of lines) and pulls a name, phone, and
 * title. Heuristic + conservative: it returns only the fields it is reasonably
 * sure about, and never throws.
 */
export function extractSignature(bodyText: string): InboundSignature {
  const sig: InboundSignature = {};
  if (!bodyText) return sig;

  const lines = bodyText.split(/\r?\n/).map((l) => l.trim());

  // Signature candidates = lines after the LAST sign-off marker; if there is
  // none, fall back to the last few non-empty lines.
  let startIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (SIGNOFF_RE.test(lines[i])) { startIdx = i + 1; break; }
  }
  const candidates = (startIdx !== -1
    ? lines.slice(startIdx).filter(Boolean)
    : lines.filter(Boolean).slice(-6)
  ).slice(0, 8);

  for (const line of candidates) {
    if (!sig.phone) {
      const pm = line.match(PHONE_RE);
      if (pm && pm[0].replace(/\D/g, '').length >= 10) sig.phone = pm[0].trim();
    }
    // Name — the first clean person-name line that isn't a title/contact line.
    if (
      !sig.name &&
      NAME_RE.test(line) &&
      !TITLE_RE.test(line) &&
      !/[@\d]/.test(line) &&
      !/https?:/i.test(line)
    ) {
      sig.name = line;
      continue;
    }
    // Title — a role-keyword line that isn't the phone/email line.
    if (
      !sig.title &&
      TITLE_RE.test(line) &&
      !/[@]/.test(line) &&
      !/https?:/i.test(line) &&
      !PHONE_RE.test(line)
    ) {
      sig.title = line.replace(/\s{2,}/g, ' ').trim();
    }
  }

  return sig;
}
