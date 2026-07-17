/**
 * Forward-email auto-import — inbound webhook + dashboard status endpoint.
 *
 *   POST /api/inbound/rate-email        (PUBLIC, shared-secret guarded)
 *     The mail provider (SendGrid Inbound Parse / Mailgun Route / …) POSTs a
 *     forwarded rate email here as provider-agnostic JSON:
 *       { from, to, subject, text, html, attachments: [{ filename,
 *         contentType, contentBase64 }] }
 *     Guarded by the `X-Inbound-Secret` header === INBOUND_WEBHOOK_SECRET.
 *     Resolves the tenant from the `to` address token, parses the best content
 *     via the same parseRateSheet used by the manual uploader, then applies the
 *     SMART SAFETY MODEL (auto-apply only when high-confidence + all-clean;
 *     otherwise hold as a review draft) and emails the owner either way.
 *
 *   GET  /api/tenant/email-import        (authed owner)
 *     Returns the feature state + the tenant's dedicated inbound address (minted
 *     lazily the first time the feature is ON). OFF → no address is exposed.
 *
 * INFRA THE OWNER MUST SET UP (out of scope here — this is plug-and-play once
 * done): point INBOUND_EMAIL_DOMAIN's MX records at the mail provider, create
 * an inbound-parse route that POSTs to /api/inbound/rate-email with the
 * `X-Inbound-Secret` header set to INBOUND_WEBHOOK_SECRET, and map the
 * provider's payload into the JSON contract above.
 */
import type { Express, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import { db } from '../../db/client.js';
import { tenants, brandConfigs, ingestJobs, auditLog } from '../../db/schema.js';
import { loadEnv } from '../../config.js';
import { requireAuth, requireTenant } from '../middleware.js';
import { resolveFeatures } from '../features.js';
import { parseRateSheet } from '../../ai/ingestFile.js';
import { runDraftAutoCheck, applyDraftToTenant, type IngestDraft } from './ingest.js';
import { sendEmail } from '../../email/send.js';
import { inboundEmailLimiter } from '../rateLimits.js';
import {
  resolveTokenFromRecipients,
  pickBestContent,
  decideEmailImport,
  buildInboundAddress,
  generateIngestEmailToken,
  type InboundAttachment,
} from '../emailImport.js';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB — mirrors the manual uploader cap.

const AttachmentSchema = z
  .object({
    filename: z.string().optional(),
    contentType: z.string().optional(),
    contentBase64: z.string().optional(),
    // Common provider alias — normalized to contentBase64 below.
    content: z.string().optional(),
  })
  .passthrough();

const InboundSchema = z
  .object({
    from: z.string().optional(),
    to: z.union([z.string(), z.array(z.unknown())]),
    subject: z.string().optional(),
    text: z.string().optional(),
    html: z.string().optional(),
    attachments: z.array(AttachmentSchema).optional(),
  })
  .passthrough();

/** Constant-time secret compare (guards length first). */
function secretMatches(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function dashboardLink(): string {
  return loadEnv().PUBLIC_BASE_URL.replace(/\/$/, '') + '/app/ingest';
}

/** Best-effort owner notification — never throws into the request path. */
async function notifyOwner(to: string, subject: string, text: string, html: string): Promise<void> {
  try {
    await sendEmail({ to, subject, text, html });
  } catch (err) {
    console.error('[inbound.rate-email] owner notify failed:', err);
  }
}

export function registerInboundRoutes(app: Express) {
  // ── Owner: feature state + dedicated address ─────────────────────
  app.get('/api/tenant/email-import', requireAuth, requireTenant, async (req: Request, res: Response) => {
    const env = loadEnv();
    const t = req.tenant!;
    const brand = await db()
      .select({ featuresJson: brandConfigs.featuresJson })
      .from(brandConfigs)
      .where(eq(brandConfigs.tenantId, t.id))
      .limit(1);
    const features = resolveFeatures(brand[0]);

    let address: string | null = null;
    if (features.emailImport) {
      let token = t.ingestEmailToken;
      if (!token) {
        // Mint lazily on first enable + persist, so the address is stable.
        token = generateIngestEmailToken();
        await db()
          .update(tenants)
          .set({ ingestEmailToken: token, updatedAt: new Date() })
          .where(eq(tenants.id, t.id));
      }
      address = buildInboundAddress(token, env.INBOUND_EMAIL_DOMAIN);
    }

    res.json({
      enabled: features.emailImport,
      address,
      // Tells the dashboard whether the infra is live yet (else the address is
      // shown with a "not configured yet" note).
      domainConfigured: !!env.INBOUND_EMAIL_DOMAIN,
      webhookConfigured: !!env.INBOUND_WEBHOOK_SECRET,
    });
  });

  // ── Provider webhook: a forwarded rate email arrives ─────────────
  app.post('/api/inbound/rate-email', inboundEmailLimiter, async (req: Request, res: Response) => {
    const env = loadEnv();

    // 0. Feature can't accept mail until the shared secret is configured.
    if (!env.INBOUND_WEBHOOK_SECRET) {
      return res.status(503).json({ error: 'Inbound email import is not configured.' });
    }
    // 1. Shared-secret gate — only the mail provider knows this header.
    if (!secretMatches(req.header('X-Inbound-Secret'), env.INBOUND_WEBHOOK_SECRET)) {
      return res.status(401).json({ error: 'Bad or missing inbound secret.' });
    }

    // 2. Validate the provider payload shape.
    const parse = InboundSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: 'Invalid inbound payload.' });
    }
    const payload = parse.data;

    // 3. Resolve the tenant from the `to` address token.
    const token = resolveTokenFromRecipients(payload.to);
    if (!token) {
      return res.status(404).json({ error: 'No rates- recipient found.' });
    }
    const tenantRow = (
      await db().select().from(tenants).where(eq(tenants.ingestEmailToken, token)).limit(1)
    )[0];
    if (!tenantRow) {
      return res.status(404).json({ error: 'Unknown inbound address.' });
    }

    // 4. Feature must be ON for this tenant (OFF → refuse to accept).
    const brand = await db()
      .select({ featuresJson: brandConfigs.featuresJson })
      .from(brandConfigs)
      .where(eq(brandConfigs.tenantId, tenantRow.id))
      .limit(1);
    if (!resolveFeatures(brand[0]).emailImport) {
      return res.status(403).json({ error: 'Email import is turned off for this tenant.' });
    }

    // 5. Pick the single best content to parse (best attachment, else body).
    const attachments: InboundAttachment[] = (payload.attachments ?? []).map((a) => ({
      filename: a.filename,
      contentType: a.contentType,
      contentBase64: a.contentBase64 ?? a.content,
    }));
    const pick = pickBestContent({
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
      attachments,
    });
    if (!pick) {
      return res.status(200).json({ ok: true, status: 'no_parseable_content' });
    }
    const sizeBytes = Math.floor((pick.dataBase64.length * 3) / 4);
    if (sizeBytes > MAX_BYTES) {
      return res.status(413).json({ error: 'Attached rate sheet is too large (max 5 MB).' });
    }

    const ownerEmail = tenantRow.contactEmail;
    const link = dashboardLink();

    // 6. Create the ingest job (system-owned, no userId).
    const [job] = await db()
      .insert(ingestJobs)
      .values({
        tenantId: tenantRow.id,
        filename: pick.filename,
        mimeType: pick.mimeType,
        sizeBytes,
        storageRef: pick.dataBase64,
        status: 'parsing',
      })
      .returning({ id: ingestJobs.id });
    if (!job) return res.status(500).json({ error: 'Failed to create ingest job.' });

    // 7. Parse. A parse failure is graceful: mark failed, tell the owner, 200.
    let parsedResult;
    try {
      parsedResult = await parseRateSheet({
        tenantId: tenantRow.id,
        filename: pick.filename,
        mimeType: pick.mimeType,
        dataBase64: pick.dataBase64,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db()
        .update(ingestJobs)
        .set({ status: 'failed', errorMessage: message, updatedAt: new Date() })
        .where(eq(ingestJobs.id, job.id));
      await recordAudit(tenantRow.id, 'ingest.email_failed', { jobId: job.id, from: payload.from, error: message });
      await notifyOwner(
        ownerEmail,
        "We couldn't read the rates you emailed",
        `We received an email at your rate-import address but couldn't read a rate sheet from it.\n\n` +
          `Open your dashboard to upload it manually: ${link}`,
        ownerHtml(
          "We couldn't read the rates you emailed",
          `We received an email at your rate-import address but couldn't read a rate sheet from it. You can upload it manually from your dashboard.`,
          link,
          'Open AI import',
        ),
      );
      return res.status(200).json({ ok: true, status: 'parse_failed' });
    }

    const draft = parsedResult.parsed as IngestDraft & { confidence?: string };
    await db()
      .update(ingestJobs)
      .set({ status: 'ready_for_review', parsedJson: draft as Record<string, unknown>, updatedAt: new Date() })
      .where(eq(ingestJobs.id, job.id));

    // 8. Smart safety model — auto-apply only when high-confidence + all-clean.
    const autoCheck = runDraftAutoCheck(draft);
    const decision = decideEmailImport(draft, autoCheck);

    if (decision.autoApply) {
      let counts;
      try {
        counts = await applyDraftToTenant(tenantRow.id, job.id, draft);
      } catch (err) {
        // Apply failed after a clean check — fall back to a held draft rather
        // than lose the email. Job stays ready_for_review (retryable).
        console.error('[inbound.rate-email] auto-apply failed, holding as draft:', err);
        await recordAudit(tenantRow.id, 'ingest.email_held', {
          jobId: job.id, from: payload.from, reason: 'apply_failed', confidence: draft.confidence,
        });
        await notifyOwner(
          ownerEmail,
          'New rates received by email need a quick review',
          `We read new rates from an email you forwarded, but couldn't apply them automatically. ` +
            `Review and apply them here: ${link}`,
          ownerHtml('New rates received by email need a quick review',
            `We read new rates from an email you forwarded, but need you to review and apply them.`, link, 'Review rates'),
        );
        return res.status(200).json({ ok: true, status: 'held_for_review' });
      }

      await recordAudit(tenantRow.id, 'ingest.email_auto_applied', {
        jobId: job.id, from: payload.from, confidence: draft.confidence, counts,
      });
      const summary =
        `${counts.rateCards} rate card${counts.rateCards === 1 ? '' : 's'}` +
        (counts.accessorials ? ` and ${counts.accessorials} accessorial${counts.accessorials === 1 ? '' : 's'}` : '');
      await notifyOwner(
        ownerEmail,
        'We updated your rates from the email you forwarded',
        `We read the email you forwarded and updated your calculator automatically — ${summary}. ` +
          `You can review the change anytime: ${link}`,
        ownerHtml('We updated your rates from the email you forwarded',
          `We read the email you forwarded and updated your calculator automatically — ${summary}. Review the change anytime.`,
          link, 'Review update'),
      );
      return res.status(200).json({ ok: true, status: 'auto_applied', counts });
    }

    // 9. Held for review — never blindly apply ambiguous/low-confidence rates.
    await recordAudit(tenantRow.id, 'ingest.email_held', {
      jobId: job.id, from: payload.from, reason: decision.reason,
      confidence: draft.confidence, flagged: autoCheck.flaggedCount,
    });
    await notifyOwner(
      ownerEmail,
      'New rates received by email need a quick review',
      `We received new rates by email and read them, but a quick human review is needed before they go live. ` +
        `Review and apply them here: ${link}`,
      ownerHtml('New rates received by email need a quick review',
        `We received new rates by email and read them, but a quick human review is needed before they go live.`,
        link, 'Review rates'),
    );
    return res.status(200).json({ ok: true, status: 'held_for_review', reason: decision.reason });
  });
}

/** Insert a system audit entry; best-effort (never blocks the response). */
async function recordAudit(tenantId: number, action: string, details: Record<string, unknown>): Promise<void> {
  try {
    await db().insert(auditLog).values({
      tenantId,
      action,
      actorKind: 'system',
      detailsJson: details,
    });
  } catch (err) {
    console.error('[inbound.rate-email] audit write failed:', err);
  }
}

/** Minimal, on-brand HTML body for the owner notifications. */
function ownerHtml(title: string, body: string, url: string, cta: string): string {
  return (
    `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:520px;margin:0 auto;color:#0f172a;">` +
    `<h2 style="font-size:18px;margin:0 0 10px;">${escapeHtml(title)}</h2>` +
    `<p style="font-size:14px;line-height:1.5;margin:0 0 18px;color:#334155;">${escapeHtml(body)}</p>` +
    `<a href="${url}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;` +
    `padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600;">${escapeHtml(cta)}</a>` +
    `</div>`
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}
