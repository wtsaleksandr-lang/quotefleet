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
  primary: '#0EA5B7',          // accent-strong from light theme
  primaryDark: '#086675',
  ink: '#0B0F14',
  inkSoft: '#1E2530',
  muted: '#5A6470',
  mutedSoft: '#8F98A4',
  border: '#E5E7EB',
  bg: '#F7F8FA',
  card: '#FFFFFF',
};

/** Wraps content in the standard QuoteFleet email shell. Renders the
 *  same in every major client because it's tables-and-inline-styles. */
function shell(opts: {
  preheader: string;
  inner: string;
  footerNote?: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
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
          <td style="padding:28px 32px 20px 32px;border-bottom:1px solid ${BRAND.border};">
            <span style="font-size:18px;font-weight:700;letter-spacing:-0.01em;color:${BRAND.ink};">${escape(BRAND.name)}</span>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:28px 32px 28px 32px;">
            ${opts.inner}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:18px 32px 22px 32px;border-top:1px solid ${BRAND.border};font-size:12px;color:${BRAND.muted};line-height:1.55;">
            ${opts.footerNote ?? ''}
            <div style="margin-top:8px;">
              ${escape(BRAND.name)} is operated by <strong style="color:${BRAND.inkSoft};">${escape(BRAND.operator)}</strong>.
              <br>
              <a href="https://quotefleet.net/security" style="color:${BRAND.muted};text-decoration:underline;">Security</a> ·
              <a href="https://quotefleet.net/dpa" style="color:${BRAND.muted};text-decoration:underline;">DPA</a> ·
              <a href="mailto:legal@quotefleet.net" style="color:${BRAND.muted};text-decoration:underline;">legal@quotefleet.net</a>
            </div>
          </td>
        </tr>
      </table>
      <!-- Outer footer -->
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;margin-top:14px;">
        <tr>
          <td align="center" style="font-size:11px;color:${BRAND.mutedSoft};line-height:1.5;">
            You're receiving this because you (or someone using your address) requested it from ${escape(BRAND.name)}.
            If that wasn't you, ignore this email — no action will be taken.
          </td>
        </tr>
      </table>
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
