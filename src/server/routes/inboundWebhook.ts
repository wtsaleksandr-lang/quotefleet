/**
 * PUBLIC harvest webhook — REVERSE OUTREACH, Phase 2c.
 *
 * A Cloudflare Email Worker fronts harvest@quotefleet.net: every broker/carrier
 * email sent there is POSTed to this endpoint, which runs the already-shipped
 * `handleHarvestedEmail` pipeline (classify → branded demo → warm-reply draft).
 * This turns the manual super-admin paste surface (routes/inboundReview.ts) into
 * a hands-free auto-catch — the same handler, fed by a webhook instead of a form.
 *
 *   POST /api/inbound/webhook   (PUBLIC, shared-secret guarded)
 *     Auth: header `X-Harvest-Secret: <secret>` (or `Authorization: Bearer
 *     <secret>`) must EXACTLY equal env INBOUND_WEBHOOK_SECRET (constant-time
 *     compare). Env unset → 503 (feature disabled); header missing/wrong → 401.
 *     Body: either `{ raw }` (a full MIME/.eml, parsed with mailparser) OR the
 *     explicit fields `{ from, subject, text, html?, messageId?, references?[] }`.
 *     Optional `to` overrides the harvest mailbox recorded on the row.
 *
 * FAIL-SOFT toward the Worker: a parse/handler error returns 200 `{ ok:false }`
 * (never a 5xx) so the Worker doesn't treat it as retryable and infinite-loop;
 * only AUTH failures return 4xx/503. Everything external (the handler, the raw
 * parser, the env reader) is injectable via `deps`, so the tests run with zero
 * network, zero DB, and a fake secret.
 */
import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import { loadEnv as realLoadEnv } from '../../config.js';
import { inboundEmailLimiter } from '../rateLimits.js';
import {
  handleHarvestedEmail as realHandleHarvestedEmail,
  type HandleHarvestedEmailInput,
  type HandleHarvestedEmailResult,
} from '../outreach/inbound/handleHarvestedEmail.js';
import { parseRawEmail, type ParsedRawEmail } from './inboundReview.js';

/** The harvest mailbox the Cloudflare Worker fronts. */
const DEFAULT_HARVEST_MAILBOX = 'harvest@quotefleet.net';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Injectable dependencies — defaults are the real impls. */
export interface InboundWebhookDeps {
  handle?: (input: HandleHarvestedEmailInput) => Promise<HandleHarvestedEmailResult>;
  /** Parse a raw RFC 822 .eml into the pipeline fields (defaults to mailparser). */
  parseRaw?: (raw: string) => Promise<ParsedRawEmail>;
  /** Read env — only INBOUND_WEBHOOK_SECRET is consulted (defaults to config). */
  loadEnv?: () => { INBOUND_WEBHOOK_SECRET?: string };
}

const WebhookBody = z
  .object({
    raw: z.string().optional(),
    from: z.string().optional(),
    subject: z.string().optional(),
    text: z.string().optional(),
    html: z.string().optional(),
    messageId: z.string().optional(),
    references: z.array(z.string()).optional(),
    to: z.string().optional(),
  })
  .passthrough();

/** Constant-time secret compare (guards length first so a wrong-length secret
 *  fails fast without ever calling timingSafeEqual on mismatched buffers). */
function secretMatches(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Pull the secret from `X-Harvest-Secret`, else `Authorization: Bearer <s>`. */
function extractSecret(req: Request): string | undefined {
  const header = req.header('X-Harvest-Secret');
  if (header) return header;
  const auth = req.header('Authorization');
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  return undefined;
}

export function registerInboundWebhookRoutes(app: Express, deps: InboundWebhookDeps = {}) {
  const handle = deps.handle ?? realHandleHarvestedEmail;
  const parseRaw = deps.parseRaw ?? parseRawEmail;
  const loadEnv = deps.loadEnv ?? realLoadEnv;

  app.post('/api/inbound/webhook', inboundEmailLimiter, async (req: Request, res: Response) => {
    // 0. Feature can't accept mail until the shared secret is configured.
    const secret = loadEnv().INBOUND_WEBHOOK_SECRET;
    if (!secret) {
      return res.status(503).json({ ok: false, error: 'Inbound webhook is not configured.' });
    }
    // 1. Shared-secret gate — only the Cloudflare Worker knows this secret.
    if (!secretMatches(extractSecret(req), secret)) {
      return res.status(401).json({ ok: false, error: 'Bad or missing harvest secret.' });
    }

    // 2. Validate the payload shape (either a raw .eml or explicit fields).
    const parse = WebhookBody.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ ok: false, error: 'Invalid payload.' });
    }
    const payload = parse.data;

    // 3. Normalize to the pipeline fields — parse a raw .eml when given, else
    //    take the explicit fields as-is.
    let fields: ParsedRawEmail;
    try {
      if (payload.raw && payload.raw.trim()) {
        fields = await parseRaw(payload.raw);
      } else {
        fields = {
          fromEmail: (payload.from ?? '').trim().toLowerCase(),
          subject: payload.subject ?? '',
          bodyText: payload.text ?? '',
          bodyHtml: payload.html,
          messageId: payload.messageId,
          references: payload.references ?? [],
        };
      }
    } catch (err) {
      // A malformed email is the Worker's problem, not ours — never make it
      // retry. Log + acknowledge so it moves on.
      console.error('[inbound/webhook] parse failed:', err);
      return res.status(200).json({ ok: false });
    }

    // 4. No usable sender → nothing to draft. Acknowledge (200) so the Worker
    //    doesn't retry a permanently-unparseable message.
    if (!fields.fromEmail || !EMAIL_RE.test(fields.fromEmail)) {
      return res.status(200).json({ ok: false });
    }

    const harvestMailbox = (payload.to && payload.to.trim()) || DEFAULT_HARVEST_MAILBOX;

    // 5. Run the harvest pipeline. handleHarvestedEmail is itself fail-soft, but
    //    we still guard so an unexpected throw never surfaces a 5xx to the Worker.
    try {
      const result = await handle({
        harvestMailbox,
        fromEmail: fields.fromEmail,
        subject: fields.subject,
        bodyText: fields.bodyText,
        bodyHtml: fields.bodyHtml,
        messageId: fields.messageId,
        references: fields.references ?? [],
        receivedAt: new Date(),
      });
      return res.json({
        ok: true,
        status: result.status,
        inboundProspectId: result.inboundProspectId,
        demoToken: result.demoToken,
      });
    } catch (err) {
      console.error('[inbound/webhook] handler failed:', err);
      return res.status(200).json({ ok: false });
    }
  });
}
