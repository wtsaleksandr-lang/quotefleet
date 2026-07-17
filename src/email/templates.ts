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
  // marketing/lifecycle email under CAN-SPAM (US) and CASL (Canada).
  // TODO(compliance): REPLACE THIS PLACEHOLDER with the real registered
  // mailing address BEFORE any lifecycle/marketing email is sent at scale.
  postalAddress: 'MR Holdings & Trade LLC · [POSTAL ADDRESS — set before sending marketing email]',
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
}): string {
  // Marketing/lifecycle emails pass an unsubscribeUrl; transactional don't.
  // That presence is our single signal for the fuller (legal) footer.
  const isMarketing = opts.unsubscribeUrl != null && opts.unsubscribeUrl !== '';
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
            <table role="presentation" cellspacing="0" cellpadding="0" border="0">
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
            </table>
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
          <td style="padding:18px 32px 22px 32px;border-top:1px solid ${BRAND.border};font-size:12px;color:${BRAND.muted};line-height:1.55;text-align:left;">
            ${opts.footerNote ? `<div style="margin:0 0 14px 0;">${opts.footerNote}</div>` : ''}
            <div>
              <a href="${BRAND.supportUrl}" style="color:${BRAND.primary};text-decoration:none;">Questions? Chat with us&nbsp;→</a>
            </div>
            <div style="margin-top:10px;">
              <a href="mailto:${BRAND.support}" style="color:${BRAND.muted};text-decoration:underline;">${escape(BRAND.support)}</a>
              &nbsp;·&nbsp; The ${escape(BRAND.name)} Team
            </div>${isMarketing ? `
            <div style="margin-top:10px;">
              ${escape(BRAND.postalAddress)}
            </div>` : ''}
            <div style="margin-top:10px;">
              <a href="https://quotefleet.net/security" style="color:${BRAND.muted};text-decoration:underline;">Security</a>
              &nbsp;·&nbsp;
              <a href="https://quotefleet.net/dpa" style="color:${BRAND.muted};text-decoration:underline;">DPA</a>
            </div>${isMarketing ? `
            <div style="margin-top:10px;">
              You're receiving QuoteFleet product updates because you started a trial.
              <a href="${escape(opts.unsubscribeUrl!)}" style="color:${BRAND.muted};text-decoration:underline;">Unsubscribe from product updates</a>.
              You'll still get essential account emails like sign-in links.
            </div>` : ''}
          </td>
        </tr>
      </table>${isMarketing ? '' : `
      <!-- Outer received-note — transactional only; marketing carries its own
           "why you got this" in the unsubscribe line above. -->
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;margin-top:14px;">
        <tr>
          <td align="center" style="font-size:11px;color:${BRAND.mutedSoft};line-height:1.5;">
            You're receiving this because you (or someone using your address) requested it from ${escape(BRAND.name)}.
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

/** Bordered label/value detail box. Rows with an empty value are skipped. */
function detailBox(rows: Array<[string, string | null | undefined]>): string {
  const visible = rows.filter(([, v]) => v != null && String(v).trim() !== '');
  if (!visible.length) return '';
  const cells = visible
    .map(([label, value], i) => {
      const border = i < visible.length - 1 ? `border-bottom:1px solid ${BRAND.border};` : '';
      return `<tr><td style="padding:10px 14px;font-size:14px;color:${BRAND.inkSoft};${border}"><span style="color:${BRAND.muted};">${escape(label)}:</span> <strong style="color:${BRAND.ink};">${escape(String(value))}</strong></td></tr>`;
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
  });
}

/* ── Lead notification (carrier-facing) ────────────────────────────────── */
export function leadNotificationEmail(opts: {
  refId: string;
  total: string;
  customerName: string;
  contactLine: string;
  laneFrom: string;
  laneTo: string;
  miles?: number | string | null;
  equipment?: string | null;
  dashboardUrl: string;
  /** Absolute route-map proxy URL; rendered under the lane details when present. */
  mapUrl?: string;
}): string {
  const inner =
    eyebrow('New lead') +
    heading(`New quote request — ${opts.total}`) +
    paragraph(`<strong style="color:${BRAND.ink};">${escape(opts.customerName)}</strong> ${escape(opts.contactLine)} just requested a quote.`) +
    detailBox([
      ['Quote', opts.refId],
      ['Total', opts.total],
      ['Lane', `${opts.laneFrom} → ${opts.laneTo}${opts.miles ? ` (${opts.miles} mi)` : ''}`],
      ['Equipment', opts.equipment ?? null],
    ]) +
    (opts.mapUrl ? routeMapImage(opts.mapUrl) : '') +
    ctaButton('View in dashboard', opts.dashboardUrl);
  return shell({
    preheader: `${opts.customerName} — ${opts.laneFrom} → ${opts.laneTo} — ${opts.total}`,
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
    ctaButton('Open in dashboard', opts.dashboardUrl);
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
  /** Deposit to book (e.g. "$150.00"), or null when no deposit is configured. */
  deposit?: string | null;
  laneFrom: string;
  laneTo: string;
  preferredDate?: string | null;
  readyByTime?: string | null;
  note?: string | null;
  dashboardUrl: string;
}): string {
  const inner =
    eyebrow('Booking requested') +
    heading(`${opts.customerName} accepted the quote`) +
    paragraph(`Quote <strong style="color:${BRAND.ink};">${escape(opts.refId)}</strong> was accepted and a booking was requested.`) +
    detailBox([
      ['Contact', opts.contactLine],
      ['Total', opts.total],
      ['Deposit to book', opts.deposit ?? null],
      ['Lane', `${opts.laneFrom} → ${opts.laneTo}`],
      ['Requested date', opts.preferredDate ?? null],
      ['Ready by', opts.readyByTime ?? null],
      ['Note', opts.note ?? null],
    ]) +
    ctaButton('View in dashboard', opts.dashboardUrl);
  return shell({
    preheader: `${opts.customerName} accepted quote ${opts.refId} — ${opts.total}`,
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
    // TODO(phase2): real email OPENS + link CLICKS need an ESP (Resend/SES)
    // open+click webhook we don't ingest yet. Show a clearly-labeled
    // placeholder rather than fabricating numbers.
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 20px 0;border:1px dashed ${BRAND.border};border-radius:8px;background:${BRAND.card};">
      <tr><td style="padding:10px 14px;font-size:13px;color:${BRAND.mutedSoft};">
        <span style="color:${BRAND.muted};">Emails opened / links clicked:</span> <strong style="color:${BRAND.mutedSoft};">coming soon</strong>
      </td></tr>
    </table>` +
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
