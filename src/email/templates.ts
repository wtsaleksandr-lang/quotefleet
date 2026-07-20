/**
 * Transactional email templates.
 *
 * Email-client-safe HTML: table layout, inline styles, no JS, no
 * external CSS. Renders consistently in Gmail, Outlook, Apple Mail,
 * Yahoo, Hey, and on mobile.
 *
 * Design language (matches the app):
 *   - Off-white background, white card, soft shadow
 *   - Inter font with system fallbacks (most clients fall back to
 *     Helvetica/Arial — that's fine)
 *   - QuoteFleet wordmark (no SVG; SVG is unreliable in Gmail+Outlook).
 *     Just bold text with the freight-truck unicode glyph.
 *   - Single CTA button (table-based for Outlook compatibility)
 *   - Link spelled out below the button (accessibility + button-block)
 *   - Footer with operator attribution + security note
 */

const BRAND = {
  name: 'QuoteFleet',
  operator: 'MR Holdings & Trade LLC',
  // PHYSICAL POSTAL ADDRESS — legally required in the footer of every
  // marketing/lifecycle email under CAN-SPAM (US) and CASL (Canada). Rendered
  // ONLY on marketing/lifecycle emails (isMarketing) — never on transactional,
  // per "don't show it where it isn't mandatory". This is the Wyoming
  // registered office, matching the /privacy, /dpa and /refund legal pages.
  postalAddress: 'MR Holdings & Trade LLC · 30 N Gould St, Ste R, Sheridan, WY 82801',
  primary: '#0D3CFC',          // brand blue (retired teal #0EA5B7)
  primaryDark: '#0A2FCB',
  ink: '#0B0F14',
  inkSoft: '#1E2530',
  muted: '#5A6470',
  mutedSoft: '#8F98A4',
  border: '#E5E7EB',
  bg: '#F7F8FA',
  card: '#FFFFFF',
  support: 'support@quotefleet.net',
  supportUrl: 'https://quotefleet.net/support',
  // Absolute HTTPS logo — the QF icon (colored calculator squares) reads on
  // any background (light card or a dark-mode-inverted client). Lives at
  // src/server/public/brand/mark-keys.png → served at /brand/mark-keys.png.
  logoIcon: 'https://quotefleet.net/brand/mark-keys.png',
  logoW: 30,
  logoH: 32,
};

/** Wraps content in the standard QuoteFleet email shell. Renders the
 *  same in every major client because it's tables-and-inline-styles. */
function shell(opts: {
  preheader: string;
  inner: string;
  footerNote?: string;
  /** Marketing/lifecycle emails ONLY: renders a visible "Unsubscribe from
   *  product updates" link in the footer pointing at this tokenized URL.
   *  Omitted for transactional emails (magic-link, lead/callback/booking
   *  notifications) which are CAN-SPAM/CASL-exempt and must always send. */
  unsubscribeUrl?: string;
  /** CARRIER-BRANDED customer-facing emails ONLY (lead auto-reply, quote-doc
   *  share). When present, the header shows the CARRIER's name/logo instead of
   *  QuoteFleet's, and the footer drops the platform's own support/security/DPA
   *  links, replacing them with a single subtle "Powered by QuoteFleet" line.
   *  Absent → renders EXACTLY as before (QuoteFleet-branded). */
  brand?: { name: string; logoUrl?: string | null };
  /** Reserved: when carrier-branded (`brand` present) the footer already
   *  renders the subtle "Powered by QuoteFleet" line; this flag lets a caller
   *  request it explicitly. Presence of `brand` implies it. */
  poweredBy?: boolean;
}): string {
  // Marketing/lifecycle emails pass an unsubscribeUrl; transactional don't.
  // That presence is our single signal for the fuller (legal) footer.
  const isMarketing = opts.unsubscribeUrl != null && opts.unsubscribeUrl !== '';
  // Carrier-branded customer-facing mode — the header wears the carrier's
  // identity and the footer sheds the platform's own links (see comments below).
  const brand = opts.brand;
  const brandName = brand?.name?.trim() || '';
  const brandLogo = brand?.logoUrl && String(brand.logoUrl).trim() !== '' ? String(brand.logoUrl).trim() : '';
  // Header — carrier brand (no anchor to quotefleet.net; the customer's
  // relationship is with the carrier) vs. the standard QuoteFleet header.
  const header = brand
    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td valign="middle">
                  ${brandLogo ? `<img src="${escape(brandLogo)}" height="${BRAND.logoH}" alt="${escape(brandName)}" style="display:inline-block;vertical-align:middle;border:0;outline:none;text-decoration:none;margin-right:10px;max-height:${BRAND.logoH}px;">` : ''}<span style="font-size:19px;font-weight:700;letter-spacing:-0.01em;color:${BRAND.ink};vertical-align:middle;">${escape(brandName)}</span>
                </td>
              </tr>
            </table>`
    : `<table role="presentation" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td valign="middle">
                  <!-- Logo + wordmark wrapped together in one anchor so tapping
                       the brand opens the site. Inline-block + vertical-align
                       keeps the img/span on one line in every major client. -->
                  <a href="https://quotefleet.net" style="text-decoration:none;display:inline-block;">
                    <img src="${BRAND.logoIcon}" width="${BRAND.logoW}" height="${BRAND.logoH}" alt="${escape(BRAND.name)}" style="display:inline-block;vertical-align:middle;border:0;outline:none;text-decoration:none;margin-right:10px;">
                    <span style="font-size:19px;font-weight:700;letter-spacing:-0.01em;color:${BRAND.ink};vertical-align:middle;">${escape(BRAND.name)}</span>
                  </a>
                </td>
              </tr>
            </table>`;
  // Footer body — carrier mode suppresses the platform's support/security/DPA
  // links (those are QuoteFleet's, not the carrier's) and shows one tiny, muted
  // "Powered by QuoteFleet" line. Non-brand mode is byte-identical to before.
  const footerBody = brand
    ? `
            ${opts.footerNote ? `<div style="margin:0 0 14px 0;">${opts.footerNote}</div>` : ''}${isMarketing ? `
            <div style="margin:0 0 12px 0;color:${BRAND.muted};">
              You're receiving this because you requested a quote from ${escape(brandName)}.
              <a href="${escape(opts.unsubscribeUrl!)}" style="color:${BRAND.muted};text-decoration:underline;">Unsubscribe from these reminders</a>.
            </div>
            <div style="margin:0 0 12px 0;font-size:11px;color:${BRAND.mutedSoft};">
              ${escape(BRAND.postalAddress)}
            </div>` : ''}
            <div style="font-size:11px;color:${BRAND.mutedSoft};">
              Powered by <a href="https://quotefleet.net" style="color:${BRAND.mutedSoft};text-decoration:none;">QuoteFleet</a>
            </div>`
    : `
            ${opts.footerNote ? `<div style="margin:0 0 14px 0;">${opts.footerNote}</div>` : ''}
            <div>
              <a href="${BRAND.supportUrl}" style="color:${BRAND.primary};text-decoration:none;font-size:13px;">Questions? Chat with us&nbsp;→</a>
            </div>
            <div style="margin-top:10px;">
              <a href="mailto:${BRAND.support}" style="color:${BRAND.muted};text-decoration:underline;">${escape(BRAND.support)}</a>
              &nbsp;·&nbsp; The ${escape(BRAND.name)} Team
            </div>
            <div style="margin-top:10px;">
              <a href="https://quotefleet.net/security" style="color:${BRAND.muted};text-decoration:underline;">Security</a>
              &nbsp;·&nbsp;
              <a href="https://quotefleet.net/dpa" style="color:${BRAND.muted};text-decoration:underline;">DPA</a>
            </div>${isMarketing ? `
            <div style="margin-top:10px;">
              You're receiving QuoteFleet product updates because you started a trial.
              <a href="${escape(opts.unsubscribeUrl!)}" style="color:${BRAND.muted};text-decoration:underline;">Unsubscribe from product updates</a>.
              You'll still get essential account emails like sign-in links.
            </div>
            <div style="margin-top:12px;font-size:11px;color:${BRAND.mutedSoft};">
              ${escape(BRAND.postalAddress)}
            </div>` : ''}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escape(BRAND.name)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:'Inter','Helvetica Neue',Arial,sans-serif;color:${BRAND.ink};-webkit-font-smoothing:antialiased;">
<!-- Preheader: shows in inbox preview, hidden in body -->
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${BRAND.bg};">${escape(opts.preheader)}</div>

<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${BRAND.bg};">
  <tr>
    <td align="center" style="padding:36px 16px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:${BRAND.card};border:1px solid ${BRAND.border};border-radius:12px;overflow:hidden;">
        <!-- Header / brand -->
        <tr>
          <td style="padding:24px 32px 18px 32px;border-bottom:1px solid ${BRAND.border};">
            ${header}
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:28px 32px 28px 32px;">
            ${opts.inner}
          </td>
        </tr>
        <!-- Footer — quiet, evenly-spaced, one muted token throughout.
             Marketing (has unsubscribeUrl): adds the legal entity + postal
             address line and the unsubscribe line (CAN-SPAM/CASL). Transactional
             omits both; those aren't legally required and only add clutter. -->
        <tr>
          <td style="padding:18px 32px 22px 32px;border-top:1px solid ${BRAND.border};font-size:11px;color:${BRAND.muted};line-height:1.55;text-align:left;">${footerBody}
          </td>
        </tr>
      </table>${isMarketing ? '' : `
      <!-- Outer received-note — transactional only; marketing carries its own
           "why you got this" in the unsubscribe line above. -->
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;margin-top:14px;">
        <tr>
          <td align="center" style="font-size:11px;color:${BRAND.mutedSoft};line-height:1.5;">
            You're receiving this because you (or someone using your address) requested it from ${escape(brand ? brandName : BRAND.name)}.
            If that wasn't you, ignore this email — no action will be taken.
          </td>
        </tr>
      </table>`}
    </td>
  </tr>
</table>
</body>
</html>`;
}

/** HTML escape for any user-supplied or dynamic content rendered into
 *  the template. Belt-and-suspenders against accidental injection. */
function escape(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Magic sign-in link email — both HTML and plain-text variants. */
export function magicLinkEmail(opts: {
  link: string;
  email: string;
  ttlMinutes?: number;
}): { subject: string; text: string; html: string } {
  const ttl = opts.ttlMinutes ?? 15;
  const subject = 'Your QuoteFleet sign-in link';
  const text =
    `Hi,\n\n` +
    `Click the link below to sign in to your QuoteFleet dashboard. ` +
    `It expires in ${ttl} minutes and can be used only once:\n\n` +
    `${opts.link}\n\n` +
    `If you didn't request this email, you can ignore it — no one can sign in without clicking the link.\n\n` +
    `— QuoteFleet (a product of MR Holdings & Trade LLC)\n` +
    `https://quotefleet.net`;

  const inner = `
    <p style="margin:0 0 8px 0;font-size:13px;font-family:'JetBrains Mono','SF Mono',Menlo,Consolas,monospace;letter-spacing:0.06em;text-transform:uppercase;color:${BRAND.muted};">
      Sign-in link
    </p>
    <h1 style="margin:0 0 14px 0;font-size:24px;line-height:1.2;letter-spacing:-0.02em;color:${BRAND.ink};font-weight:700;">
      One click to your dashboard.
    </h1>
    <p style="margin:0 0 22px 0;font-size:15px;line-height:1.6;color:${BRAND.inkSoft};">
      You requested a sign-in link for <strong style="color:${BRAND.ink};">${escape(opts.email)}</strong>.
      The link is valid for <strong>${ttl} minutes</strong> and can only be used once.
    </p>

    <!-- CTA — table-wrapped for Outlook -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 22px 0;">
      <tr>
        <td align="center" bgcolor="${BRAND.primary}" style="border-radius:8px;background:${BRAND.primary};">
          <a href="${escape(opts.link)}"
             style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;letter-spacing:-0.005em;color:#FFFFFF;background:${BRAND.primary};text-decoration:none;border-radius:8px;">
            Sign me in →
          </a>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 8px 0;font-size:12px;color:${BRAND.muted};">
      Or copy this URL into your browser:
    </p>
    <p style="margin:0;font-family:'JetBrains Mono','SF Mono',Menlo,Consolas,monospace;font-size:12px;line-height:1.55;color:${BRAND.inkSoft};word-break:break-all;background:${BRAND.bg};border:1px solid ${BRAND.border};border-radius:6px;padding:10px 12px;">
      ${escape(opts.link)}
    </p>
  `;

  const footerNote = `
    <strong style="color:${BRAND.inkSoft};">Security note:</strong>
    we will never ask you for your password by email. Always check that
    the link starts with <code style="font-family:'JetBrains Mono',Menlo,monospace;font-size:11px;">https://quotefleet.net</code>
    before signing in.
  `;

  return {
    subject,
    text,
    html: shell({
      preheader: `Sign-in link for ${opts.email} — expires in ${ttl} minutes`,
      inner,
      footerNote,
    }),
  };
}

/* ──────────────────────────────────────────────────────────────────────
 * Shared content building blocks — used by every transactional template
 * below so they stay brand-consistent (blue accent, same spacing scale,
 * Outlook-safe buttons). All values that could be dynamic are escaped.
 * ────────────────────────────────────────────────────────────────────── */

/** Small mono uppercase eyebrow above the headline. */
function eyebrow(label: string): string {
  return `<p style="margin:0 0 8px 0;font-size:13px;font-family:'JetBrains Mono','SF Mono',Menlo,Consolas,monospace;letter-spacing:0.06em;text-transform:uppercase;color:${BRAND.muted};">${escape(label)}</p>`;
}

/** Page headline. */
function heading(text: string): string {
  return `<h1 style="margin:0 0 14px 0;font-size:24px;line-height:1.2;letter-spacing:-0.02em;color:${BRAND.ink};font-weight:700;">${escape(text)}</h1>`;
}

/** Body paragraph. `html` is trusted markup already assembled by the
 *  caller (escape dynamic pieces before passing them in). */
function paragraph(html: string): string {
  return `<p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:${BRAND.inkSoft};">${html}</p>`;
}

/** Outlook-safe, table-wrapped primary CTA button. */
function ctaButton(label: string, href: string): string {
  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:4px 0 22px 0;">
      <tr>
        <td align="center" bgcolor="${BRAND.primary}" style="border-radius:8px;background:${BRAND.primary};">
          <a href="${escape(href)}" style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;letter-spacing:-0.005em;color:#FFFFFF;background:${BRAND.primary};text-decoration:none;border-radius:8px;">${escape(label)} →</a>
        </td>
      </tr>
    </table>`;
}

/** Sanitizes a phone string into a dial-safe `tel:` href value — strips every
 *  non-digit except a single leading `+` (kept for international numbers). */
function telHref(phone: string): string {
  const cleaned = String(phone ?? '').replace(/[^\d+]/g, '');
  // Drop any '+' that isn't the very first character.
  return 'tel:' + cleaned.replace(/(?!^)\+/g, '');
}

/** Primary filled CTA plus up to two smaller secondary/outline buttons in a
 *  row (they wrap → stack on narrow screens). Email-safe: the primary is a
 *  table (Outlook), the secondaries are inline-block anchors that wrap. */
function ctaActions(
  primary: { label: string; href: string },
  secondaries: Array<{ label: string; href: string }>,
): string {
  const secs = secondaries
    .map(
      (s) =>
        `<a href="${escape(s.href)}" style="display:inline-block;padding:10px 20px;font-size:13px;font-weight:600;letter-spacing:-0.005em;color:${BRAND.primary};background:${BRAND.card};border:1px solid ${BRAND.border};border-radius:8px;text-decoration:none;margin:0 8px 8px 0;">${escape(s.label)}</a>`,
    )
    .join('');
  const secBlock = secs ? `<div style="margin:0 0 22px 0;">${secs}</div>` : '';
  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:4px 0 ${secs ? '12px' : '22px'} 0;">
      <tr>
        <td align="center" bgcolor="${BRAND.primary}" style="border-radius:8px;background:${BRAND.primary};">
          <a href="${escape(primary.href)}" style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;letter-spacing:-0.005em;color:#FFFFFF;background:${BRAND.primary};text-decoration:none;border-radius:8px;">${escape(primary.label)} →</a>
        </td>
      </tr>
    </table>${secBlock}`;
}

/** Bordered 2-column detail table. Left cell = label (muted, top-aligned),
 *  right cell = value (bold ink) — so every value left-aligns in its own
 *  column and long values wrap gracefully. Rows with an empty value are
 *  skipped. Client-safe: two `<td>`s per `<tr>`, per-row bottom border. */
function detailBox(rows: Array<[string, string | null | undefined]>): string {
  const visible = rows.filter(([, v]) => v != null && String(v).trim() !== '');
  if (!visible.length) return '';
  const cells = visible
    .map(([label, value], i) => {
      const border = i < visible.length - 1 ? `border-bottom:1px solid ${BRAND.border};` : '';
      return `<tr><td width="40%" valign="top" style="padding:10px 14px;font-size:14px;line-height:1.5;color:${BRAND.muted};${border}">${escape(label)}</td><td valign="top" style="padding:10px 14px;font-size:14px;line-height:1.5;font-weight:700;color:${BRAND.ink};word-break:break-word;${border}">${escape(String(value))}</td></tr>`;
    })
    .join('');
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 20px 0;border:1px solid ${BRAND.border};border-radius:8px;overflow:hidden;background:${BRAND.bg};">${cells}</table>`;
}

/** Route-snapshot map image. `url` is the ABSOLUTE server-side proxy URL
 *  (GET /api/public/quote-map/:refId.png) — the Google Maps API key is
 *  resolved server-side and never appears in the markup. Email-safe: a plain
 *  <img> with fixed max-width + reserved rounded frame. */
function routeMapImage(url: string): string {
  return `<img src="${escape(url)}" width="100%" alt="Route map" style="display:block;width:100%;max-width:496px;border:1px solid ${BRAND.border};border-radius:8px;margin:0 0 20px 0;">`;
}

/** Renders a block of plain text (e.g. an AI-written reply) into safe,
 *  brand-styled paragraphs — blank lines become paragraph breaks, single
 *  newlines become <br>. Every character is escaped. */
function plainTextToParagraphs(text: string): string {
  return String(text ?? '')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => paragraph(escape(block).replace(/\n/g, '<br>')))
    .join('');
}

/* ── Lead auto-reply (customer-facing, AI-written) ─────────────────────── */
export function leadAutoReplyEmail(opts: {
  aiBody: string;
  refId: string;
  quoteUrl?: string;
  /** Absolute route-map proxy URL; rendered under the heading when present. */
  mapUrl?: string;
  /** Carrier display name — this email goes to the carrier's OWN customer, so
   *  it wears the carrier's brand, not QuoteFleet's. */
  brandName: string;
  /** Carrier logo (absolute HTTPS). When empty/null, the header shows the name only. */
  brandLogoUrl?: string | null;
}): string {
  const inner =
    eyebrow(`Quote ${opts.refId}`) +
    heading('Thanks for your request') +
    (opts.mapUrl ? routeMapImage(opts.mapUrl) : '') +
    plainTextToParagraphs(opts.aiBody) +
    (opts.quoteUrl ? ctaButton('View your quote', opts.quoteUrl) : '');
  return shell({
    preheader: `Your quote ${opts.refId} — details inside`,
    inner,
    brand: { name: opts.brandName, logoUrl: opts.brandLogoUrl },
  });
}

/* ── Quote currency labelling ──────────────────────────────────────────────
 * A quote is priced in exactly ONE currency and is never converted, so this is
 * pure LABELLING: the amount is never touched, only the symbol in front of it.
 *
 * The locale is pinned to 'en-US' for EVERY currency — matching the existing
 * precedent in src/server/routes/quoteDoc.ts. This matters: an 'en-CA' locale
 * formats CAD as a bare "$", indistinguishable from USD to the customer
 * reading the email. 'en-US' gives "$" for USD and "CA$" for CAD.
 * ────────────────────────────────────────────────────────────────────────── */

export type QuoteCurrency = 'USD' | 'CAD';

const MONEY_LOCALE = 'en-US';

function moneyFormatter(currency: QuoteCurrency | undefined): Intl.NumberFormat {
  return new Intl.NumberFormat(MONEY_LOCALE, { style: 'currency', currency: currency || 'USD' });
}

/** Format a raw amount for an email: "$2,450.00" (USD) / "CA$2,450.00" (CAD).
 *  Callers that build a pre-formatted total should use this rather than
 *  hand-rolling `` `$${n.toFixed(2)}` ``, which hardcodes the US symbol. */
export function formatEmailMoney(amount: number, currency: QuoteCurrency = 'USD'): string {
  return moneyFormatter(currency).format(Number.isFinite(amount) ? amount : 0);
}

/** The bare symbol for a currency ("$" / "CA$"), derived from the same
 *  formatter so it can never drift from `formatEmailMoney`. */
function currencySymbol(currency: QuoteCurrency | undefined): string {
  const part = moneyFormatter(currency).formatToParts(0).find((p) => p.type === 'currency');
  return part ? part.value : '$';
}

/** Re-label an ALREADY-formatted money string for `currency`.
 *  Templates receive totals pre-formatted by their caller (today always "$…"),
 *  so when the quote is CAD we upgrade the bare "$" to "CA$". Digits are never
 *  altered. Strings that carry no "$", or that are already explicitly labelled
 *  ("CA$…", "US$…"), are returned untouched. */
function labelMoney(total: string, currency?: QuoteCurrency): string {
  const c = currency ?? 'USD';
  if (c === 'USD') return total;
  if (!total.includes('$')) return total;
  if (/[A-Za-z]{2,3}\s*\$/.test(total)) return total;
  return total.replace('$', currencySymbol(c));
}

/* ── Lead notification (carrier-facing) ────────────────────────────────── */
export function leadNotificationEmail(opts: {
  refId: string;
  total: string;
  /** Currency the quote was priced in. Labelling only — defaults to USD. */
  currency?: QuoteCurrency;
  customerName: string;
  contactLine: string;
  /** Customer contact channels — when present, render "Email"/"Call" CTAs
   *  alongside the primary dashboard button. */
  customerEmail?: string | null;
  customerPhone?: string | null;
  laneFrom: string;
  laneTo: string;
  miles?: number | string | null;
  equipment?: string | null;
  dashboardUrl: string;
  /** Absolute route-map proxy URL; rendered under the lane details when present. */
  mapUrl?: string;
}): string {
  const total = labelMoney(opts.total, opts.currency);
  const inner =
    eyebrow('New lead') +
    heading(`New quote request — ${total}`) +
    paragraph(`<strong style="color:${BRAND.ink};">${escape(opts.customerName)}</strong> ${escape(opts.contactLine)} just requested a quote.`) +
    detailBox([
      ['Quote', opts.refId],
      ['Total', total],
      ['Lane', `${opts.laneFrom} → ${opts.laneTo}${opts.miles ? ` (${opts.miles} mi)` : ''}`],
      ['Equipment', opts.equipment ?? null],
    ]) +
    (opts.mapUrl ? routeMapImage(opts.mapUrl) : '') +
    ctaActions(
      { label: 'View in dashboard', href: opts.dashboardUrl },
      [
        ...(opts.customerEmail ? [{ label: `Email ${opts.customerName}`, href: `mailto:${opts.customerEmail}` }] : []),
        ...(opts.customerPhone ? [{ label: `Call ${opts.customerName}`, href: telHref(opts.customerPhone) }] : []),
      ],
    );
  return shell({
    preheader: `${opts.customerName} — ${opts.laneFrom} → ${opts.laneTo} — ${total}`,
    inner,
  });
}

/* ── Callback requested (carrier-facing) ───────────────────────────────── */
export function callbackRequestedEmail(opts: {
  refId: string;
  customerName: string;
  phone: string;
  email?: string | null;
  preferredTime?: string | null;
  topic?: string | null;
  escalationNote?: string | null;
  dashboardUrl: string;
}): string {
  const inner =
    eyebrow('Callback requested') +
    heading(`${opts.customerName} wants a call`) +
    paragraph(`They requested a callback for quote <strong style="color:${BRAND.ink};">${escape(opts.refId)}</strong>.`) +
    detailBox([
      ['Phone', opts.phone],
      ['Email', opts.email ?? null],
      ['Preferred time', opts.preferredTime ?? null],
      ['Topic', opts.topic ?? null],
    ]) +
    (opts.escalationNote ? paragraph(`<em style="color:${BRAND.muted};">${escape(opts.escalationNote)}</em>`) : '') +
    ctaActions(
      { label: 'Open in dashboard', href: opts.dashboardUrl },
      [
        ...(opts.email ? [{ label: `Email ${opts.customerName}`, href: `mailto:${opts.email}` }] : []),
        ...(opts.phone ? [{ label: `Call ${opts.customerName}`, href: telHref(opts.phone) }] : []),
      ],
    );
  return shell({
    preheader: `${opts.customerName} requested a callback — ${opts.phone}`,
    inner,
  });
}

/* ── Booking accepted (carrier-facing) ─────────────────────────────────── */
export function bookingAcceptedEmail(opts: {
  refId: string;
  customerName: string;
  contactLine: string;
  total: string;
  /** Currency the quote was priced in. Labelling only — defaults to USD. */
  currency?: QuoteCurrency;
  /** Deposit to book (e.g. "$150.00"), or null when no deposit is configured. */
  deposit?: string | null;
  laneFrom: string;
  laneTo: string;
  preferredDate?: string | null;
  readyByTime?: string | null;
  note?: string | null;
  dashboardUrl: string;
}): string {
  const total = labelMoney(opts.total, opts.currency);
  const inner =
    eyebrow('Booking requested') +
    heading(`${opts.customerName} accepted the quote`) +
    paragraph(`Quote <strong style="color:${BRAND.ink};">${escape(opts.refId)}</strong> was accepted and a booking was requested.`) +
    detailBox([
      ['Contact', opts.contactLine],
      ['Total', total],
      ['Deposit to book', opts.deposit ? labelMoney(opts.deposit, opts.currency) : null],
      ['Lane', `${opts.laneFrom} → ${opts.laneTo}`],
      ['Requested date', opts.preferredDate ?? null],
      ['Ready by', opts.readyByTime ?? null],
      ['Note', opts.note ?? null],
    ]) +
    ctaButton('View in dashboard', opts.dashboardUrl);
  return shell({
    preheader: `${opts.customerName} accepted quote ${opts.refId} — ${total}`,
    inner,
  });
}

/* ── Lifecycle emails (tenant-facing) ──────────────────────────────────── */
export function lifecycleWelcomeEmail(opts: {
  hostedUrl: string;
  loginUrl: string;
  unsubscribeUrl?: string;
}): string {
  const inner =
    eyebrow('Welcome aboard') +
    heading('Your QuoteFleet account is ready') +
    paragraph('Welcome to QuoteFleet. Everything is set up and waiting for you.') +
    detailBox([
      ['Your hosted quote page', opts.hostedUrl],
      ['Your dashboard', opts.loginUrl],
    ]) +
    paragraph('Three things to do in the next 10 minutes:') +
    paragraph(
      `1. Sign in and tweak your default rate cards (or upload your rate sheet under <strong style="color:${BRAND.ink};">AI import</strong>).<br>` +
        `2. Upload your logo + brand colors so the widget matches your site.<br>` +
        `3. Drop the embed snippet on your website (/app → Embed code) or share your hosted page link.`
    ) +
    ctaButton('Open your dashboard', opts.loginUrl) +
    paragraph(`You're on your 14-day all-inclusive trial — every Pro feature unlocked, unlimited quotes and leads. When it ends, you choose whether to continue on Vital ($14.80/mo) or Pro ($34.80/mo) — cancel anytime.`);
  return shell({
    preheader: 'Your QuoteFleet account is ready — 3 quick steps to go live',
    inner,
    unsubscribeUrl: opts.unsubscribeUrl,
  });
}

export function lifecycleDay7Email(opts: {
  loginUrl: string;
  pricingUrl: string;
  unsubscribeUrl?: string;
}): string {
  const inner =
    eyebrow('Halfway check') +
    heading("You're 7 days into your trial") +
    paragraph('Quick check-in — here are the highest-leverage things left to do:') +
    paragraph(
      `• <strong style="color:${BRAND.ink};">Embed the widget</strong> on your site — 30 seconds, one &lt;script&gt; tag from /app → Embed code.<br>` +
        `• <strong style="color:${BRAND.ink};">Tune your rate cards</strong> — the defaults are within ~15% of market, but yours will be tighter.<br>` +
        `• Want a hand? Just reply to this email and we'll personally walk you through anything.`
    ) +
    ctaButton('Open your dashboard', opts.loginUrl) +
    paragraph(`Your trial ends in 7 days, then your plan starts — Vital $14.80/mo or Pro $34.80/mo. <a href="${escape(opts.pricingUrl)}" style="color:${BRAND.primary};text-decoration:underline;">Compare plans</a>. Manage or switch anytime from your dashboard.`);
  return shell({
    preheader: "You're halfway through your QuoteFleet trial — 2 quick wins left",
    inner,
    unsubscribeUrl: opts.unsubscribeUrl,
  });
}

export function lifecycleDay12Email(opts: {
  appUrl: string;
  pricingUrl: string;
  unsubscribeUrl?: string;
}): string {
  const inner =
    eyebrow('2 days left') +
    heading('Your trial ends in 2 days') +
    paragraph('If you\'ve added a card, your plan starts automatically with no interruption. If not, your hosted page stays live but new leads pause until you choose a plan.') +
    paragraph(
      `<strong style="color:${BRAND.ink};">Vital — $14.80/mo:</strong> hosted page, widget, unlimited quotes, lead inbox, branded quotes.<br>` +
        `<strong style="color:${BRAND.ink};">Pro — $34.80/mo:</strong> everything in Vital plus AI auto-reply &amp; 24/7 chat, branded PDF quotes, automation, custom domain, and analytics.`
    ) +
    ctaButton('Choose your plan', opts.appUrl) +
    paragraph(`<a href="${escape(opts.pricingUrl)}" style="color:${BRAND.primary};text-decoration:underline;">Compare plans</a> · Reply if you have questions — happy to extend the trial if you need a few extra days.`);
  return shell({
    preheader: 'Your QuoteFleet trial ends in 2 days — pick a plan to stay live',
    inner,
    unsubscribeUrl: opts.unsubscribeUrl,
  });
}

/* ── Weekly performance digest (tenant-facing, recurring) ──────────────── */

/** One big-number stat tile. `delta` (optional) renders a small +N / −N chip
 *  under the value, colored green for a gain and muted for flat/down. */
function statTile(opts: { value: string; label: string; delta?: string; deltaUp?: boolean }): string {
  const deltaHtml = opts.delta
    ? `<div style="margin-top:6px;font-size:12px;font-weight:600;color:${opts.deltaUp ? '#0E7C3A' : BRAND.mutedSoft};">${escape(opts.delta)}</div>`
    : '';
  return `<td width="33%" valign="top" style="padding:16px 12px;text-align:center;">
    <div style="font-size:32px;line-height:1.1;font-weight:700;letter-spacing:-0.02em;color:${BRAND.primary};">${escape(opts.value)}</div>
    <div style="margin-top:4px;font-size:12px;line-height:1.4;color:${BRAND.muted};">${escape(opts.label)}</div>
    ${deltaHtml}
  </td>`;
}

/** A row of big-number stat tiles (email-safe table). */
function statGrid(tiles: string[]): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 20px 0;border:1px solid ${BRAND.border};border-radius:10px;background:${BRAND.bg};">
    <tr>${tiles.join('')}</tr>
  </table>`;
}

export function weeklyDigestEmail(opts: {
  companyName: string;
  /** Human date range, e.g. "Jul 7 – Jul 14". */
  dateRange: string;
  quotes: number;
  /** Week-over-week quote delta; omit to hide the chip. */
  quotesDelta?: number;
  conversions: number;
  conversionPct: number;
  callbacks: number;
  autoReplies: number;
  chatConversations: number;
  views: number;
  pdfSaves: number;
  dashboardUrl: string;
  unsubscribeUrl?: string;
}): string {
  const deltaChip =
    opts.quotesDelta != null && opts.quotesDelta !== 0
      ? { delta: `${opts.quotesDelta > 0 ? '+' : ''}${opts.quotesDelta} vs last week`, deltaUp: opts.quotesDelta > 0 }
      : {};

  const secondaryRows: Array<[string, string | null]> = [
    ['Auto-replies sent', opts.autoReplies > 0 ? String(opts.autoReplies) : null],
    ['Chat conversations', opts.chatConversations > 0 ? String(opts.chatConversations) : null],
    ['Quote page views', opts.views > 0 ? String(opts.views) : null],
    ['PDF quotes saved', opts.pdfSaves > 0 ? String(opts.pdfSaves) : null],
  ];

  const inner =
    eyebrow('Weekly recap') +
    heading('Your week on QuoteFleet') +
    paragraph(`Here's how <strong style="color:${BRAND.ink};">${escape(opts.companyName)}</strong> did over the last 7 days (${escape(opts.dateRange)}).`) +
    statGrid([
      statTile({ value: String(opts.quotes), label: 'Quotes requested', ...deltaChip }),
      statTile({ value: String(opts.conversions), label: `Booked / won (${opts.conversionPct}%)` }),
      statTile({ value: String(opts.callbacks), label: 'Callbacks requested' }),
    ]) +
    detailBox(secondaryRows) +
    ctaButton('View your dashboard', opts.dashboardUrl) +
    paragraph(`See the full breakdown — every lead, chat, and callback — in your analytics dashboard.`);

  return shell({
    preheader: `${opts.quotes} quote${opts.quotes === 1 ? '' : 's'} this week — your QuoteFleet recap`,
    inner,
    unsubscribeUrl: opts.unsubscribeUrl,
  });
}

export function lifecycleExpiredEmail(opts: {
  appUrl: string;
  unsubscribeUrl?: string;
}): string {
  const inner =
    eyebrow('Trial ended') +
    heading('Your 14-day trial has ended') +
    paragraph('Your hosted page is still live, but new leads now return a "not accepting requests" message until you choose a plan.') +
    paragraph('Vital $14.80/mo or Pro $34.80/mo — pick one in a single click.') +
    ctaButton('Choose your plan', opts.appUrl) +
    paragraph("Or, if QuoteFleet wasn't the right fit, just reply and let us know what missed — useful even if it's a no.");
  return shell({
    preheader: 'Your QuoteFleet trial ended — reactivate in one click',
    inner,
    unsubscribeUrl: opts.unsubscribeUrl,
  });
}

/* ──────────────────────────────────────────────────────────────────────
 * Automated follow-up sequence (Wave 1) — carrier-branded, customer-facing.
 *
 * Three touches sent to a customer who got a quote but didn't book, with the
 * discount saved for the LAST touch (don't train customers to wait for a
 * deal). These are COMMERCIAL emails: each renders through the carrier-branded
 * shell WITH an unsubscribeUrl, so the footer carries the CAN-SPAM / CASL
 * unsubscribe line + physical postal address + the subtle "Powered by
 * QuoteFleet" attribution. The sequence auto-stops on book / reply /
 * unsubscribe — that machinery is a later wave; this file only renders.
 * ────────────────────────────────────────────────────────────────────── */

/** Shared args for every follow-up touch. */
interface FollowUpArgs {
  refId: string;
  customerName: string;
  brandName: string;
  brandLogoUrl?: string | null;
  quoteUrl: string;
  laneFrom: string;
  laneTo: string;
  /** Pre-formatted, currency-styled total, e.g. "$2,450.00" / "CA$2,450.00".
   *  Build it with `formatEmailMoney(amount, currency)`. */
  total: string;
  /** Currency the quote was priced in. Labelling only — defaults to USD.
   *  When set to 'CAD', a total that arrives with a bare "$" is re-labelled
   *  "CA$" so a Canadian customer is never shown an ambiguous symbol. */
  currency?: QuoteCurrency;
  unsubscribeUrl: string;
}

/** A centered, letter-spaced mono chip for a short code (promo / voucher).
 *  Same visual language as magicLinkEmail's URL box (mono, soft bg, hairline
 *  border) but sized + centered for a short token. */
function codeChip(code: string): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 20px 0;">
      <tr>
        <td align="center" style="padding:14px 16px;background:${BRAND.bg};border:1px dashed ${BRAND.primary};border-radius:8px;font-family:'JetBrains Mono','SF Mono',Menlo,Consolas,monospace;font-size:22px;font-weight:700;letter-spacing:0.14em;color:${BRAND.ink};">${escape(code)}</td>
      </tr>
    </table>`;
}

/** Appends a `promo=<code>` query param to the quote URL (preserving any
 *  existing query string) so the discount is pre-applied on arrival. */
function withPromo(quoteUrl: string, promoCode: string): string {
  const sep = quoteUrl.indexOf('?') > -1 ? '&' : '?';
  return `${quoteUrl}${sep}promo=${encodeURIComponent(promoCode)}`;
}

/* ── FU1 — the gentle nudge ─────────────────────────────────────────────── */
export function followupNudgeEmail(opts: FollowUpArgs): { subject: string; html: string } {
  const subject = `Still planning that shipment, ${opts.customerName}?`;
  const total = labelMoney(opts.total, opts.currency);
  const inner =
    eyebrow(`Quote ${opts.refId}`) +
    heading('Your quote is ready when you are') +
    paragraph(`Hi ${escape(opts.customerName)}, just circling back — your ${escape(opts.brandName)} quote is saved and the price below is locked in. Whenever you're ready to move, you're one click from booking.`) +
    detailBox([
      ['Lane', `${opts.laneFrom} → ${opts.laneTo}`],
      ['Your locked total', total],
    ]) +
    ctaButton('View your quote', opts.quoteUrl) +
    paragraph(`<span style="color:${BRAND.muted};">Questions about the lane, timing, or accessorials? Just reply to this email — a real person will help.</span>`);
  return {
    subject,
    html: shell({
      preheader: `Your ${opts.brandName} quote ${opts.refId} is saved — ${total}`,
      inner,
      brand: { name: opts.brandName, logoUrl: opts.brandLogoUrl },
      unsubscribeUrl: opts.unsubscribeUrl,
    }),
  };
}

/* ── FU2 — the reminder (more urgency, no discount) ─────────────────────── */
export function followupReminderEmail(opts: FollowUpArgs): { subject: string; html: string } {
  const subject = `Your ${opts.brandName} quote ${opts.refId} is still held.`;
  const total = labelMoney(opts.total, opts.currency);
  const inner =
    eyebrow(`Quote ${opts.refId}`) +
    heading('This rate is still honored — for now') +
    paragraph(`Freight rates move with the market, but we're still holding the price we quoted you. Lock it in before capacity or fuel shifts it.`) +
    detailBox([
      ['Lane', `${opts.laneFrom} → ${opts.laneTo}`],
      ['Held total', total],
    ]) +
    ctaButton('Book this shipment', opts.quoteUrl) +
    paragraph(`<span style="color:${BRAND.muted};">Need to adjust the pickup date, equipment, or stops? Reply and we'll re-quote in minutes.</span>`);
  return {
    subject,
    html: shell({
      preheader: `We're still holding your ${total} rate on ${opts.laneFrom} → ${opts.laneTo}`,
      inner,
      brand: { name: opts.brandName, logoUrl: opts.brandLogoUrl },
      unsubscribeUrl: opts.unsubscribeUrl,
    }),
  };
}

/* ── FU3 — the discount (ONLY ever rendered with a real promo code) ─────── */
export function followupDiscountEmail(
  opts: FollowUpArgs & { promoCode: string; percentOff: number },
): { subject: string; html: string } {
  // Hard invariant: the discount touch NEVER renders without a real code +
  // a positive percent. The sender must supply an active promo code; a missing
  // code means there is no discount to offer, so refuse rather than send an
  // empty "here's your discount" email.
  const code = String(opts.promoCode ?? '').trim();
  const pct = Number(opts.percentOff);
  if (!code || !Number.isFinite(pct) || pct <= 0) {
    throw new Error('followupDiscountEmail requires a non-empty promoCode and a positive percentOff');
  }
  const subject = `A discount on your ${opts.brandName} quote — code ${code}.`;
  const total = labelMoney(opts.total, opts.currency);
  const inner =
    eyebrow(`${pct}% off`) +
    heading(`Here's ${pct}% off to get you rolling`) +
    paragraph(`We'd love to move your load on ${escape(opts.laneFrom)} → ${escape(opts.laneTo)}. Use the code below at checkout for ${pct}% off your ${escape(total)}.`) +
    codeChip(code) +
    ctaButton(`Claim ${pct}% off`, withPromo(opts.quoteUrl, code)) +
    paragraph(`<span style="color:${BRAND.muted};">Apply <strong style="color:${BRAND.inkSoft};">${escape(code)}</strong> at checkout, or just tap the button above and it's added for you.</span>`);
  return {
    subject,
    html: shell({
      preheader: `${pct}% off your ${opts.brandName} quote with code ${code}`,
      inner,
      brand: { name: opts.brandName, logoUrl: opts.brandLogoUrl },
      unsubscribeUrl: opts.unsubscribeUrl,
    }),
  };
}
