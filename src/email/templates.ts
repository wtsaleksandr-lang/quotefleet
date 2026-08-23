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
  // Absolute HTTPS logo — the full QuoteFleet business mark (calculator squares
  // fused with a semi-truck), the same lockup used in the site footer. It reads
  // on the light email header. Lives at src/server/public/brand/logo-full.png →
  // served at /brand/logo-full.png. The mark is ~3:2 (374×252), so we render it
  // height-first at ~40px tall with auto width for a tasteful header size. It is
  // the graphic shown where the client allows images; the live-text wordmark
  // beside it is the reliable brand element that ALWAYS renders. (The old dual
  // light/dark <img> swap was removed — it showed as two broken red-X boxes in
  // Outlook. See shell() header.)
  logoIcon: 'https://quotefleet.net/brand/logo-full.png',
  // Dark-optimized variant of the SAME mark: the truck is drawn with a WHITE
  // outline so it reads on a dark email surface (the default dark-outlined truck
  // in logoIcon vanishes on dark). Swapped in via the .qf-logo-light /
  // .qf-logo-dark display swap under @media (prefers-color-scheme: dark) — see
  // shell() header + the <head> <style>. Same absolute-host pattern as logoIcon.
  logoIconDark: 'https://quotefleet.net/brand/logo-full-ondark.png',
  logoW: 60,
  logoH: 40,
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
                  <!-- QuoteFleet header: ONE hosted logo image + a live-text
                       wordmark, wrapped in a single anchor to the homepage
                       (new tab). The image is the graphic where the client
                       allows images (Gmail / Apple Mail / Outlook.com); its
                       ALT is styled (Inter, brand-blue) so a blocked-image
                       client shows a clean "QuoteFleet" instead of a broken
                       red-X box. The <span> wordmark ALWAYS renders — it is the
                       reliable brand element — and is dark-mode-lightened via the
                       .qf-wordmark rule in <head>. Inline-block + vertical-align
                       keeps img + span on one line in every major client;
                       height-first (width auto) so the ~3:2 mark never distorts. -->
                  <a href="https://quotefleet.net" target="_blank" rel="noopener" style="text-decoration:none;display:inline-block;">
                    <!-- Decorative logo, light/dark swap: alt="" on both so a
                         blocked-image client shows NOTHING here (no broken-image
                         glyph, no ALT text) — the live-text <span> beside it is
                         the single wordmark. .qf-logo-light (dark-outlined truck)
                         shows by default; under @media (prefers-color-scheme:
                         dark) it hides and .qf-logo-dark (WHITE-outlined truck,
                         logo-full-ondark.png) shows so the mark reads on dark.
                         MSO/Outlook-desktop ignores the media query and keeps the
                         light image — accepted minority. -->
                    <img src="${BRAND.logoIcon}" class="qf-logo-light qf-wordmark" width="${BRAND.logoW}" height="${BRAND.logoH}" alt="" style="display:inline-block;vertical-align:middle;border:0;outline:none;text-decoration:none;margin-right:10px;height:${BRAND.logoH}px;width:auto;font-family:'Inter','Helvetica Neue',Arial,sans-serif;font-size:19px;font-weight:700;color:${BRAND.primary};">
                    <img src="${BRAND.logoIconDark}" class="qf-logo-dark qf-wordmark" width="${BRAND.logoW}" height="${BRAND.logoH}" alt="" style="display:none;vertical-align:middle;border:0;outline:none;text-decoration:none;margin-right:10px;height:${BRAND.logoH}px;width:auto;font-family:'Inter','Helvetica Neue',Arial,sans-serif;font-size:19px;font-weight:700;color:#FFFFFF;">
                    <span class="qf-wordmark" style="font-size:19px;font-weight:700;letter-spacing:-0.01em;color:${BRAND.primary};vertical-align:middle;">${escape(BRAND.name)}</span>
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
              <a href="${BRAND.supportUrl}" class="qf-chat-link" style="display:inline-block;padding:10px 18px;color:${BRAND.primary};text-decoration:none;font-size:13px;font-weight:600;line-height:1.2;background:transparent;border:1.5px solid ${BRAND.primary};border-radius:10px;">Questions? Chat with us&nbsp;→</a>
            </div>
            <div style="margin-top:10px;">
              <a href="mailto:${BRAND.support}" style="color:${BRAND.muted};text-decoration:underline;">${escape(BRAND.support)}</a>
            </div>
            <!-- Legal/utility links — one single line, · -separated:
                 Privacy · Terms · Security · DPA -->
            <div style="margin-top:10px;">
              <a href="https://quotefleet.net/privacy" style="color:${BRAND.muted};text-decoration:underline;">Privacy</a>
              &nbsp;·&nbsp;
              <a href="https://quotefleet.net/terms" style="color:${BRAND.muted};text-decoration:underline;">Terms</a>
              &nbsp;·&nbsp;
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
<style>
  /* Dark-mode adaptations for clients that honor prefers-color-scheme (Apple
     Mail, iOS Mail, modern Outlook mobile) and Outlook.com dark mode
     ([data-ogsc]). Light clients are unaffected. In dark clients the live-text
     wordmark (and the img color fallback) turns WHITE, the header logo swaps
     from the dark-outlined truck (.qf-logo-light) to the white-outlined
     on-dark asset (.qf-logo-dark), and the "Chat with us" outline button turns
     white — so all three read on the dark surface. MSO/Outlook-desktop ignores
     these media queries and keeps the light logo; that's an accepted minority. */
  @media (prefers-color-scheme: dark) {
    .qf-wordmark { color: #FFFFFF !important; }
    .qf-logo-light { display: none !important; }
    .qf-logo-dark { display: inline-block !important; }
    .qf-chat-link { color: #FFFFFF !important; border-color: rgba(255,255,255,0.55) !important; }
  }
  [data-ogsc] .qf-wordmark { color: #FFFFFF !important; }
  [data-ogsc] .qf-logo-light { display: none !important; }
  [data-ogsc] .qf-logo-dark { display: inline-block !important; }
  [data-ogsc] .qf-chat-link { color: #FFFFFF !important; border-color: rgba(255,255,255,0.55) !important; }
</style>
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

    <!-- CTA — bulletproof. Modern clients render the padded <a> (blue + 10px
         radius on the <a> alone, so its rounded corners always show; no square
         <td> fill bleeding through). Outlook desktop (Word engine, ignores
         border-radius + <a> backgrounds) renders the mso-conditional VML
         <roundrect> sibling as the SAME filled, rounded button (arcsize 21% ≈
         10px). Label centered on both axes. -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 22px 0;">
      <tr>
        <td align="center">
          <!--[if mso]>
          <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${escape(opts.link)}" style="height:48px;v-text-anchor:middle;width:220px;" arcsize="21%" strokecolor="${BRAND.primary}" fillcolor="${BRAND.primary}">
            <w:anchorlock/>
            <center style="color:#FFFFFF;font-family:'Inter','Helvetica Neue',Arial,sans-serif;font-size:15px;font-weight:600;">Sign me in →</center>
          </v:roundrect>
          <![endif]-->
          <!--[if !mso]><!-->
          <a href="${escape(opts.link)}" align="center"
             style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;line-height:20px;letter-spacing:-0.005em;color:#FFFFFF;background:${BRAND.primary};text-decoration:none;border-radius:10px;text-align:center;">Sign me in →</a>
          <!--<![endif]-->
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

/** Password-reset link email — both HTML and plain-text variants. Sent by
 *  POST /api/auth/password/forgot when the address maps to a real account. The
 *  link carries a single-use, short-lived token; the copy states the expiry and
 *  reassures a recipient who didn't request it (no action = nothing happens). */
export function passwordResetEmail(opts: {
  link: string;
  email: string;
  ttlMinutes?: number;
}): { subject: string; text: string; html: string } {
  const ttl = opts.ttlMinutes ?? 45;
  const subject = 'Reset your QuoteFleet password';
  const text =
    `Hi,\n\n` +
    `We received a request to reset the password for your QuoteFleet account ` +
    `(${opts.email}). Click the link below to choose a new password. ` +
    `It expires in ${ttl} minutes and can be used only once:\n\n` +
    `${opts.link}\n\n` +
    `If you didn't request this, you can safely ignore this email — your ` +
    `password won't change until you open the link and set a new one.\n\n` +
    `— QuoteFleet (a product of MR Holdings & Trade LLC)\n` +
    `https://quotefleet.net`;

  const inner =
    eyebrow('Password reset') +
    heading('Choose a new password') +
    paragraph(
      `We received a request to reset the password for ` +
        `<strong style="color:${BRAND.ink};">${escape(opts.email)}</strong>. ` +
        `This link is valid for <strong>${ttl} minutes</strong> and can only be used once.`,
    ) +
    ctaButton('Reset my password', opts.link) +
    `<p style="margin:0 0 8px 0;font-size:12px;color:${BRAND.muted};">Or copy this URL into your browser:</p>` +
    `<p style="margin:0;font-family:'JetBrains Mono','SF Mono',Menlo,Consolas,monospace;font-size:12px;line-height:1.55;color:${BRAND.inkSoft};word-break:break-all;background:${BRAND.bg};border:1px solid ${BRAND.border};border-radius:6px;padding:10px 12px;">${escape(opts.link)}</p>`;

  const footerNote = `
    <strong style="color:${BRAND.inkSoft};">Didn't request this?</strong>
    You can ignore this email — your password stays the same until you open the
    link and set a new one. We will never ask for your password by email.
  `;

  return {
    subject,
    text,
    html: shell({
      preheader: `Reset your QuoteFleet password — link expires in ${ttl} minutes`,
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

/** Approximate pixel width for the Outlook/VML roundrect fallback of a primary
 *  button, sized to the label (+ the appended " →") so the centered VML text is
 *  never clipped. Outlook-desktop only; modern clients use the padded <a> and
 *  size to content. ~9px per glyph at 15px/600 + horizontal padding, min 200. */
function vmlButtonWidth(label: string): number {
  return Math.max(200, Math.round((String(label).length + 2) * 9) + 64);
}

/** Bulletproof, table-wrapped primary CTA button. Modern clients render the
 *  padded <a> — only it paints the blue and carries the 10px radius, so the
 *  rounded corners always show (no square <td> fill bleeding through). Outlook
 *  desktop (Word engine, ignores border-radius + <a> backgrounds) renders the
 *  mso-conditional VML <roundrect> sibling as the SAME filled, rounded button
 *  (arcsize 21% ≈ 10px). Label centered on both axes. */
function ctaButton(label: string, href: string): string {
  const w = vmlButtonWidth(label);
  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:4px 0 22px 0;">
      <tr>
        <td align="center">
          <!--[if mso]>
          <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${escape(href)}" style="height:48px;v-text-anchor:middle;width:${w}px;" arcsize="21%" strokecolor="${BRAND.primary}" fillcolor="${BRAND.primary}">
            <w:anchorlock/>
            <center style="color:#FFFFFF;font-family:'Inter','Helvetica Neue',Arial,sans-serif;font-size:15px;font-weight:600;">${escape(label)} →</center>
          </v:roundrect>
          <![endif]-->
          <!--[if !mso]><!-->
          <a href="${escape(href)}" align="center" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;line-height:20px;letter-spacing:-0.005em;color:#FFFFFF;background:${BRAND.primary};text-decoration:none;border-radius:10px;text-align:center;">${escape(label)} →</a>
          <!--<![endif]-->
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
        `<a href="${escape(s.href)}" align="center" style="display:inline-block;padding:11px 20px;font-size:13px;font-weight:600;line-height:18px;letter-spacing:-0.005em;color:${BRAND.primary};background:${BRAND.card};border:1px solid ${BRAND.border};border-radius:8px;text-decoration:none;text-align:center;margin:0 8px 8px 0;">${escape(s.label)}</a>`,
    )
    .join('');
  const secBlock = secs ? `<div style="margin:0 0 22px 0;">${secs}</div>` : '';
  const w = vmlButtonWidth(primary.label);
  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:4px 0 ${secs ? '12px' : '22px'} 0;">
      <tr>
        <td align="center">
          <!--[if mso]>
          <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${escape(primary.href)}" style="height:48px;v-text-anchor:middle;width:${w}px;" arcsize="21%" strokecolor="${BRAND.primary}" fillcolor="${BRAND.primary}">
            <w:anchorlock/>
            <center style="color:#FFFFFF;font-family:'Inter','Helvetica Neue',Arial,sans-serif;font-size:15px;font-weight:600;">${escape(primary.label)} →</center>
          </v:roundrect>
          <![endif]-->
          <!--[if !mso]><!-->
          <a href="${escape(primary.href)}" align="center" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;line-height:20px;letter-spacing:-0.005em;color:#FFFFFF;background:${BRAND.primary};text-decoration:none;border-radius:10px;text-align:center;">${escape(primary.label)} →</a>
          <!--<![endif]-->
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

/* ── Trial-end card reminders (tenant-facing) ──────────────────────────────
 * Two honest, non-pushy nudges that complete the card-after-trial model:
 * signup is card-free, so as the 14-day trial winds down we remind the owner
 * to add a card BEFORE it ends — helpful, not a dark pattern. Both link to the
 * dashboard billing flow (/app → plan settings) where the card is added, and
 * both render through the marketing shell WITH an unsubscribeUrl so the footer
 * carries the CAN-SPAM/CASL unsubscribe line + postal address.
 * ────────────────────────────────────────────────────────────────────────── */

/** Day 11 — ~3 days before the 14-day trial ends. */
export function trialReminderDay11Email(opts: {
  appUrl: string;
  pricingUrl: string;
  unsubscribeUrl?: string;
}): string {
  const inner =
    eyebrow('3 days left') +
    heading('3 days left on your QuoteFleet trial') +
    paragraph('Your all-inclusive trial ends in about 3 days. Add a card now and your calculator, hosted page, and lead inbox keep running with zero interruption — nothing changes for you or your customers.') +
    paragraph(
      `<strong style="color:${BRAND.ink};">Vital — $14.80/mo:</strong> hosted page, widget, unlimited quotes, lead inbox, branded quotes.<br>` +
        `<strong style="color:${BRAND.ink};">Pro — $34.80/mo:</strong> everything in Vital plus AI auto-reply &amp; 24/7 chat, branded PDF quotes, automation, custom domain, and analytics.`
    ) +
    ctaButton('Add a card', opts.appUrl) +
    paragraph(`No rush — you won't be charged until the trial ends, and you can cancel anytime. <a href="${escape(opts.pricingUrl)}" style="color:${BRAND.primary};text-decoration:underline;">Compare plans</a> or just reply with any questions.`);
  return shell({
    preheader: '3 days left on your QuoteFleet trial — add a card to keep your calculator live',
    inner,
    unsubscribeUrl: opts.unsubscribeUrl,
  });
}

/** Day 14 — the last day of the trial (before it actually expires). */
export function trialReminderDay14Email(opts: {
  appUrl: string;
  unsubscribeUrl?: string;
}): string {
  const inner =
    eyebrow('Last day') +
    heading('Your QuoteFleet trial ends today') +
    paragraph('Today is the last day of your trial. Add a card to keep your calculator running — your hosted page and widget stay live and no leads are missed. If you add it before the day is out, the switch is seamless.') +
    paragraph('If you don\'t, your hosted page stays up but new leads pause until you choose a plan — you can pick one back up anytime.') +
    ctaButton('Add a card to keep it running', opts.appUrl) +
    paragraph(`Vital $14.80/mo or Pro $34.80/mo — cancel anytime. Questions, or need a few more days? Just reply — a real person will help.`);
  return shell({
    preheader: 'Your QuoteFleet trial ends today — add a card to keep it running',
    inner,
    unsubscribeUrl: opts.unsubscribeUrl,
  });
}

/* ── Dunning: failed-payment card-update sequence (tenant-facing) ──────────
 * TRANSACTIONAL billing notices sent to an EXISTING paying customer whose
 * renewal charge failed (Stripe `past_due`). Escalates day 0 → day 3 → day 6,
 * each with a single clear CTA to the in-app billing page (/app → Plan
 * settings) that opens the Stripe Customer Portal to update the card. Rendered
 * through the transactional shell (no unsubscribeUrl) — a failed-payment notice
 * concerns an active transaction and must always deliver, so it is NOT gated on
 * the marketing opt-out and carries no unsubscribe header (like the magic-link
 * email). See src/email/dunning.ts for the stage/recovery logic.
 * ────────────────────────────────────────────────────────────────────────── */

/** Per-stage copy for the dunning sequence. Keyed by DunningStage.id. */
const DUNNING_COPY: Record<'0' | '3' | '6', {
  eyebrow: string;
  subject: string;
  preheader: string;
  heading: string;
  intro: string;
  cta: string;
  closing: string;
}> = {
  '0': {
    eyebrow: 'Payment issue',
    subject: 'Action needed: your QuoteFleet payment didn\'t go through',
    preheader: 'Your last QuoteFleet payment failed — update your card to avoid interruption',
    heading: 'Your last payment didn\'t go through',
    intro:
      'We tried to charge the card on file for your QuoteFleet subscription and it was declined. ' +
      'No need to worry — your calculator, hosted page, and lead inbox are still running. ' +
      'Just update your card and we\'ll take care of the rest.',
    cta: 'Update your card',
    closing:
      'Common causes are an expired card, a new card number, or a temporary hold from your bank. ' +
      'We\'ll automatically retry over the next few days. Questions? Just reply — a real person will help.',
  },
  '3': {
    eyebrow: 'Reminder',
    subject: 'Reminder: update your card to keep QuoteFleet running',
    preheader: 'Your QuoteFleet payment is still failing — a quick card update fixes it',
    heading: 'Your QuoteFleet payment is still failing',
    intro:
      'It\'s been a few days and we still couldn\'t process payment for your QuoteFleet subscription. ' +
      'Your account is active for now, but to avoid any interruption to your calculator and lead inbox, ' +
      'please update your card.',
    cta: 'Update your card',
    closing:
      'It takes less than a minute — update your card and everything keeps running exactly as it is. ' +
      'If you need a hand, just reply to this email.',
  },
  '6': {
    eyebrow: 'Final notice',
    subject: 'Final notice: your QuoteFleet account is about to pause',
    preheader: 'Last reminder — update your card now to keep your QuoteFleet account active',
    heading: 'Last reminder before your account pauses',
    intro:
      'We still haven\'t been able to process payment for your QuoteFleet subscription. ' +
      'This is the final reminder: if the card isn\'t updated soon, your account will be paused — ' +
      'your hosted page will stop accepting new leads until payment succeeds.',
    cta: 'Update your card now',
    closing:
      'You won\'t lose any of your data or settings — updating your card reactivates everything instantly. ' +
      'If something\'s changed or you\'d like to talk it through, just reply and we\'ll help.',
  },
};

/** Failed-payment dunning email for the given stage. `appUrl` is the in-app
 *  billing page (/app → Plan settings) that opens the Stripe Customer Portal. */
export function billingDunningEmail(opts: {
  stageId: '0' | '3' | '6';
  appUrl: string;
}): { subject: string; html: string } {
  const c = DUNNING_COPY[opts.stageId];
  const inner =
    eyebrow(c.eyebrow) +
    heading(c.heading) +
    paragraph(c.intro) +
    ctaButton(c.cta, opts.appUrl) +
    paragraph(c.closing);
  return {
    subject: c.subject,
    // Transactional: no unsubscribeUrl → always-deliver footer, no unsubscribe.
    html: shell({ preheader: c.preheader, inner }),
  };
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

/* ── Referral + affiliate program emails (tenant/affiliate-facing) ─────────
 * Event-triggered account notifications — NOT a marketing drip — so they render
 * through the standard QuoteFleet-branded shell as TRANSACTIONAL email (no
 * unsubscribeUrl → no CAN-SPAM footer; they fire once on a discrete account
 * event, like a booking/lead alert). Every dynamic value is escaped. The
 * program terms (free-month count, commission rates, pro threshold) are passed
 * in by the caller, which sources them from src/server/affiliate/programs.ts —
 * never hardcoded here — so the copy can never drift from the real program.
 * ────────────────────────────────────────────────────────────────────────── */

/** Sent to the REFERRER when a referred signup links + their free-month credit
 *  is queued (a real conversion — never on a bare click). `freeMonths` comes
 *  from REFERRER_FREE_MONTHS. */
export function referralCreditEarnedEmail(opts: {
  referrerName?: string | null;
  freeMonths: number;
  dashboardUrl: string;
  referralUrl?: string | null;
}): { subject: string; text: string; html: string } {
  const months = Math.max(1, Math.floor(Number(opts.freeMonths) || 1));
  const monthWord = months === 1 ? 'month' : 'months';
  const name = String(opts.referrerName ?? '').trim();
  const greeting = name ? `Hi ${name},` : 'Hi,';
  const subject =
    months === 1
      ? 'You earned a free month of QuoteFleet'
      : `You earned ${months} free months of QuoteFleet`;
  const headline = months === 1 ? 'You earned a free month' : `You earned ${months} free months`;

  const inner =
    eyebrow('Referral reward') +
    heading(headline) +
    paragraph(
      `Someone just signed up for QuoteFleet with your referral link — so you've earned ` +
        `<strong style="color:${BRAND.ink};">${months} free ${monthWord}</strong>, credited to your ` +
        `account and applied automatically to an upcoming invoice.`,
    ) +
    ctaButton('View your referral dashboard', opts.dashboardUrl) +
    (opts.referralUrl
      ? paragraph(
          `Keep sharing your link and earn another free month for every business that signs up:<br>` +
            `<a href="${escape(opts.referralUrl)}" style="color:${BRAND.primary};text-decoration:underline;word-break:break-all;">${escape(opts.referralUrl)}</a>`,
        )
      : paragraph('Keep sharing your link and earn another free month for every business that signs up.'));

  const text =
    `${greeting}\n\n` +
    `Someone just signed up for QuoteFleet with your referral link, so you've earned ` +
    `${months} free ${monthWord} — credited to your account and applied automatically to an ` +
    `upcoming invoice.\n\n` +
    `View your referral dashboard: ${opts.dashboardUrl}\n` +
    (opts.referralUrl ? `Your referral link: ${opts.referralUrl}\n` : '') +
    `\nKeep sharing to earn another free month for every business that signs up.\n\n` +
    `— QuoteFleet\n`;

  return { subject, text, html: shell({ preheader: subject, inner }) };
}

/** Sent to an AFFILIATE the moment their account becomes `active` (self-serve
 *  signup auto-activates, or an admin flips status → active). `commissionRatePct`
 *  is the affiliate's own headline rate; `proRatePct`/`proThreshold` describe the
 *  next rung so the ladder is honest. All sourced from programs.ts by the caller. */
export function affiliateApprovedEmail(opts: {
  affiliateName?: string | null;
  code: string;
  link: string;
  dashboardUrl: string;
  commissionRatePct: number;
  proRatePct: number;
  proThreshold: number;
}): { subject: string; text: string; html: string } {
  const name = String(opts.affiliateName ?? '').trim();
  const greeting = name ? `Hi ${name},` : 'Hi,';
  const ratePct = Math.max(0, Math.round(Number(opts.commissionRatePct) || 0));
  const proPct = Math.max(0, Math.round(Number(opts.proRatePct) || 0));
  const threshold = Math.max(0, Math.floor(Number(opts.proThreshold) || 0));
  const subject = "You're approved — your QuoteFleet affiliate link is live";
  // Only pitch the pro rung when there's genuinely a higher rate to climb to
  // (a hand-set partner rate can already exceed the pro rate).
  const showLadder = proPct > ratePct && threshold > 0;

  const inner =
    eyebrow('Affiliate approved') +
    heading("You're approved — start earning") +
    paragraph(
      `Your QuoteFleet affiliate account is active. Share your link below and earn ` +
        `<strong style="color:${BRAND.ink};">${ratePct}% recurring commission</strong> on every ` +
        `customer you refer.` +
        (showLadder
          ? ` Refer ${threshold}+ active customers and your rate rises to <strong style="color:${BRAND.ink};">${proPct}%</strong>.`
          : ''),
    ) +
    codeChip(opts.code) +
    ctaButton('Open your affiliate dashboard', opts.dashboardUrl) +
    paragraph(
      `Your referral link:<br>` +
        `<a href="${escape(opts.link)}" style="color:${BRAND.primary};text-decoration:underline;word-break:break-all;">${escape(opts.link)}</a>`,
    );

  const text =
    `${greeting}\n\n` +
    `Your QuoteFleet affiliate account is active. Share your link and earn ${ratePct}% ` +
    `recurring commission on every customer you refer.` +
    (showLadder ? ` Refer ${threshold}+ active customers and your rate rises to ${proPct}%.` : '') +
    `\n\n` +
    `Your affiliate code: ${opts.code}\n` +
    `Your referral link: ${opts.link}\n` +
    `Your affiliate dashboard: ${opts.dashboardUrl}\n\n` +
    `— QuoteFleet\n`;

  return { subject, text, html: shell({ preheader: subject, inner }) };
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
  /** TENANT-CUSTOMIZED COPY (all optional — templates own the defaults).
   *  `customIntro` replaces THIS touch's lead paragraph; the detail box + CTA
   *  are still rendered by the template. `contact` renders an optional footer
   *  contact block; `signature` an optional sign-off line. Plain text — every
   *  field is HTML-escaped at render (newlines → <br>). */
  customIntro?: string | null;
  contact?: { phone?: string | null; email?: string | null } | null;
  signature?: string | null;
}

/** Render a touch's lead paragraph: the tenant's `customIntro` when set
 *  (escaped, newlines → <br>), otherwise the template's default markup. */
function followUpIntro(customIntro: string | null | undefined, fallbackHtml: string): string {
  const custom = typeof customIntro === 'string' ? customIntro.trim() : '';
  if (!custom) return paragraph(fallbackHtml);
  return paragraph(escape(custom).replace(/\n/g, '<br>'));
}

/** Optional footer contact block — rendered only when the tenant enabled it AND
 *  supplied at least one channel. Phone dials via tel:, email opens via mailto:.
 *  Returns '' when there's nothing to show. */
function followUpContactBlock(contact: { phone?: string | null; email?: string | null } | null | undefined): string {
  if (!contact) return '';
  const phone = String(contact.phone ?? '').trim();
  const email = String(contact.email ?? '').trim();
  if (!phone && !email) return '';
  const parts: string[] = [];
  if (phone) {
    parts.push(`<a href="${escape(telHref(phone))}" style="color:${BRAND.primary};text-decoration:none;">${escape(phone)}</a>`);
  }
  if (email) {
    parts.push(`<a href="mailto:${escape(email)}" style="color:${BRAND.primary};text-decoration:none;">${escape(email)}</a>`);
  }
  return `<p style="margin:20px 0 8px 0;font-size:14px;line-height:1.6;color:${BRAND.muted};">Questions? Reach us at ${parts.join('&nbsp;·&nbsp;')}.</p>`;
}

/** Optional sign-off line appended after the contact block. Escaped; newlines
 *  become <br>. Returns '' when unset. */
function followUpSignature(signature: string | null | undefined): string {
  const sig = String(signature ?? '').trim();
  if (!sig) return '';
  return `<p style="margin:8px 0 0 0;font-size:14px;line-height:1.6;color:${BRAND.inkSoft};">${escape(sig).replace(/\n/g, '<br>')}</p>`;
}

/** The custom contact block + signature, appended to every follow-up touch. */
function followUpFooterBlocks(opts: FollowUpArgs): string {
  return followUpContactBlock(opts.contact) + followUpSignature(opts.signature);
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
    followUpIntro(
      opts.customIntro,
      `Hi ${escape(opts.customerName)}, just circling back — your ${escape(opts.brandName)} quote is saved and the price below is locked in. Whenever you're ready to move, you're one click from booking.`,
    ) +
    detailBox([
      ['Lane', `${opts.laneFrom} → ${opts.laneTo}`],
      ['Your locked total', total],
    ]) +
    ctaButton('View your quote', opts.quoteUrl) +
    paragraph(`<span style="color:${BRAND.muted};">Questions about the lane, timing, or accessorials? Just reply to this email — a real person will help.</span>`) +
    followUpFooterBlocks(opts);
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
    followUpIntro(
      opts.customIntro,
      `Freight rates move with the market, but we're still holding the price we quoted you. Lock it in before capacity or fuel shifts it.`,
    ) +
    detailBox([
      ['Lane', `${opts.laneFrom} → ${opts.laneTo}`],
      ['Held total', total],
    ]) +
    ctaButton('Book this shipment', opts.quoteUrl) +
    paragraph(`<span style="color:${BRAND.muted};">Need to adjust the pickup date, equipment, or stops? Reply and we'll re-quote in minutes.</span>`) +
    followUpFooterBlocks(opts);
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
    followUpIntro(
      opts.customIntro,
      `We'd love to move your load on ${escape(opts.laneFrom)} → ${escape(opts.laneTo)}. Use the code below at checkout for ${pct}% off your ${escape(total)}.`,
    ) +
    codeChip(code) +
    ctaButton(`Claim ${pct}% off`, withPromo(opts.quoteUrl, code)) +
    paragraph(`<span style="color:${BRAND.muted};">Apply <strong style="color:${BRAND.inkSoft};">${escape(code)}</strong> at checkout, or just tap the button above and it's added for you.</span>`) +
    followUpFooterBlocks(opts);
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
