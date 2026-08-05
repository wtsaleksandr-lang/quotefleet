/**
 * PUBLIC prospect unsubscribe route — no auth.
 *
 *   GET  /outreach/unsubscribe/:token — human click from a cold-email footer.
 *   POST /outreach/unsubscribe/:token — RFC 8058 List-Unsubscribe-Post one-click.
 *
 * Distinct from /unsubscribe (that opts a TENANT out of product/marketing email
 * via a signed tenant token). THIS route opts a PROSPECT out of the AI Outreach
 * Engine: it marks the matching `outreach_emails` row `suppressed` so Phase 3
 * never sends to them again, then shows a simple confirmation page. Always
 * returns a friendly page (even for an unknown/old token) so a recipient never
 * sees an error for exercising their opt-out right.
 */
import type { Express, Request, Response } from 'express';
import { dbOutreachEmailStore, type OutreachEmailStore } from '../outreach/outreachEmailStore.js';
import { SENDER_NAME } from '../outreach/draftEmail.js';
import { loadEnv } from '../../config.js';

export interface OutreachUnsubscribeDeps {
  emailStore?: OutreachEmailStore;
}

function confirmationPage(): string {
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>Unsubscribed · ${SENDER_NAME}</title>`,
    '<link rel="stylesheet" href="/style.css">',
    '</head><body style="display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center">',
    '<div style="max-width:460px;padding:32px">',
    '<h1>You’re unsubscribed</h1>',
    `<p class="muted">You won’t receive any more outreach emails from ${SENDER_NAME}. `,
    'It can take a moment to take effect across in-flight sends. Sorry for the interruption.</p>',
    '</div></body></html>',
  ].join('');
}

async function handle(req: Request, res: Response, emailStore: OutreachEmailStore): Promise<void> {
  const token = String(req.params.token || '').trim();
  try {
    if (token) await emailStore.suppressByToken(token);
  } catch (err) {
    // Never surface a raw error to an anonymous recipient — log and still show
    // the confirmation (the send path re-checks the suppressed flag).
    console.error('[outreach/unsubscribe] failed to suppress:', err);
  }
  res.status(200).type('html').send(confirmationPage());
}

/**
 * PUBLIC click-tracking redirect — no auth.
 *
 *   GET /outreach/click/:token — records the FIRST CTA/demo-link click on the
 *   matching `outreach_emails` row, then 302-redirects the recipient onward to
 *   their branded demo. Safe against open-redirect: the destination is derived
 *   from the row's own `demo_token` (never from a client-supplied URL). Unknown
 *   tokens still redirect to the home base so a recipient never sees an error.
 *
 * NOTE (follow-up): the emailed CTA currently links straight to /demo/:token;
 * routing it THROUGH this endpoint (so clicks are captured) is a small drafter
 * change deferred to a later phase — the mechanism is ready here.
 */
async function handleClick(req: Request, res: Response, emailStore: OutreachEmailStore): Promise<void> {
  const token = String(req.params.token || '').trim();
  const base = loadEnv().PUBLIC_BASE_URL.replace(/\/$/, '');
  let dest = base || '/';
  try {
    if (token) {
      const row = await emailStore.markClickedByToken(token);
      if (row?.demoToken) dest = `${base}/demo/${row.demoToken}`;
    }
  } catch (err) {
    console.error('[outreach/click] failed to record click:', err);
  }
  res.redirect(302, dest);
}

export function registerOutreachUnsubscribeRoutes(app: Express, deps: OutreachUnsubscribeDeps = {}): void {
  const emailStore = deps.emailStore ?? dbOutreachEmailStore;
  app.get('/outreach/unsubscribe/:token', (req, res) => void handle(req, res, emailStore));
  // RFC 8058 one-click POST (mail clients may POST instead of GET).
  app.post('/outreach/unsubscribe/:token', (req, res) => void handle(req, res, emailStore));
  // Optional click tracking → records + redirects to the prospect's demo.
  app.get('/outreach/click/:token', (req, res) => void handleClick(req, res, emailStore));
}
