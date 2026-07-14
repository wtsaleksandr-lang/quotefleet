/**
 * PUBLIC unsubscribe route — no auth. Honors marketing/lifecycle opt-out for
 * CAN-SPAM / CASL compliance.
 *
 *   GET  /unsubscribe?token=…   — human click from the email footer link
 *   POST /unsubscribe           — RFC 8058 List-Unsubscribe-Post one-click
 *                                 (token in query or body)
 *
 * Both verify the signed token (src/email/unsubscribe.ts), set the tenant's
 * `marketing_opt_out` flag, and return a simple branded confirmation page.
 * Essential/transactional email (sign-in links, lead alerts) is unaffected —
 * only lifecycle/marketing sends check this flag.
 */
import type { Express, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { tenants } from '../../db/schema.js';
import { verifyUnsubscribeToken } from '../../email/unsubscribe.js';

const BRAND_BLUE = '#0D3CFC';
const INK = '#0B0F14';
const MUTED = '#5A6470';
const BG = '#F7F8FA';
const CARD = '#FFFFFF';
const BORDER = '#E5E7EB';

function page(opts: { title: string; heading: string; body: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${opts.title} · QuoteFleet</title>
</head>
<body style="margin:0;padding:0;background:${BG};font-family:'Inter','Helvetica Neue',Arial,sans-serif;color:${INK};-webkit-font-smoothing:antialiased;">
  <div style="max-width:520px;margin:0 auto;padding:64px 20px;">
    <div style="background:${CARD};border:1px solid ${BORDER};border-radius:12px;padding:36px 32px;">
      <div style="font-size:19px;font-weight:700;letter-spacing:-0.01em;color:${INK};margin-bottom:20px;">
        <a href="https://quotefleet.net" style="color:${INK};text-decoration:none;">QuoteFleet</a>
      </div>
      <h1 style="margin:0 0 12px 0;font-size:22px;line-height:1.25;letter-spacing:-0.02em;color:${INK};font-weight:700;">${opts.heading}</h1>
      <p style="margin:0;font-size:15px;line-height:1.6;color:${MUTED};">${opts.body}</p>
      <div style="margin-top:26px;">
        <a href="https://quotefleet.net" style="display:inline-block;padding:11px 22px;font-size:14px;font-weight:600;color:#FFFFFF;background:${BRAND_BLUE};text-decoration:none;border-radius:8px;">Back to QuoteFleet</a>
      </div>
    </div>
  </div>
</body>
</html>`;
}

export const CONFIRM_PAGE = page({
  title: 'Unsubscribed',
  heading: "You've been unsubscribed",
  body:
    "You've been unsubscribed from QuoteFleet product updates. " +
    "You'll still receive essential account emails like sign-in links.",
});

const INVALID_PAGE = page({
  title: 'Link expired',
  heading: 'This unsubscribe link is invalid',
  body:
    'We couldn’t verify this unsubscribe link. It may be malformed or from a very old email. ' +
    'If you keep receiving product updates you don’t want, reply to any QuoteFleet email and we’ll remove you.',
});

/** Read the token from the query string first, then the parsed body (the
 *  one-click POST may deliver it either way depending on the mail client). */
function tokenFrom(req: Request): string | undefined {
  const q = req.query?.token;
  if (typeof q === 'string' && q.trim()) return q.trim();
  const b = (req.body as Record<string, unknown> | undefined)?.token;
  if (typeof b === 'string' && b.trim()) return b.trim();
  return undefined;
}

async function handleUnsubscribe(req: Request, res: Response): Promise<void> {
  const tenantId = verifyUnsubscribeToken(tokenFrom(req));
  if (tenantId == null) {
    res.status(400).type('html').send(INVALID_PAGE);
    return;
  }
  try {
    await db()
      .update(tenants)
      .set({ marketingOptOut: true, updatedAt: new Date() })
      .where(eq(tenants.id, tenantId));
  } catch (err) {
    // Never surface a raw DB error to an anonymous visitor; log and show the
    // generic confirmation (the opt-out cron re-checks the flag each send).
    console.error(`[unsubscribe] failed to set opt-out for tenant ${tenantId}:`, err);
    res.status(500).type('html').send(
      page({
        title: 'Something went wrong',
        heading: 'We hit a snag',
        body: 'We couldn’t record your preference right now. Please try the link again in a minute.',
      })
    );
    return;
  }
  res.status(200).type('html').send(CONFIRM_PAGE);
}

export function registerUnsubscribeRoutes(app: Express): void {
  app.get('/unsubscribe', (req, res) => void handleUnsubscribe(req, res));
  // RFC 8058 List-Unsubscribe-Post one-click. The mail client POSTs
  // `List-Unsubscribe=One-Click`; we only need the token (query or body).
  app.post('/unsubscribe', (req, res) => void handleUnsubscribe(req, res));
}
