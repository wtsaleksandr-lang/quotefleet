/**
 * Multi-carrier RFQ (rate request) routes — the flow that beats LoadMatch: a
 * shipper filters carriers in the public directory, sends ONE rate request that
 * fans out to every selected/filtered carrier, and collects quotes in one place.
 *
 * All NEW modules + NEW routes (per the feature's hard scope rule): this does NOT
 * touch the directory results page, the filter sidebar, or the facet model. It
 * only READS the query layer (normalizeFilters / listCarriers via resolve.ts) to
 * turn a directory selection into a recipient set.
 *
 *   GET  /directory/rfq                     → the rate-request form
 *   POST /directory/rfq                     → create request + fan out + confirm
 *   GET  /directory/rfq/:viewToken          → shipper's live responses table
 *   GET  /directory/rfq/quote/:token        → carrier's quote-submission form
 *   POST /directory/rfq/quote/:token        → submit/update a quote
 *   GET  /directory/rfq/optout/:token       → carrier one-click opt-out
 *   POST /api/public/directory/reingest     → admin force FMCSA re-ingest (guarded)
 *
 * Everything is behind injectable deps (store / resolve / sender / gate) so the
 * whole flow unit-tests with no DB and no network.
 */
import type { Express, Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import {
  normalizeFilters,
  FACET_QUERY_KEYS,
  type DirectoryFilters,
} from '../directory/queries.js';
import {
  rfqSubmitIpLimiter,
  rfqSubmitEmailLimiter,
  rfqQuoteLimiter,
} from '../rateLimits.js';
import { dbRfqStore, type RfqStore } from '../rfq/store.js';
import {
  resolveRfqRecipients,
  dbResolveDeps,
  parseDots,
  type ResolveDeps,
} from '../rfq/resolve.js';
import { sendRfqToCarrier, rfqLiveSendEnabled, type SendRfqDeps } from '../rfq/email.js';
import { draftRfqEmail, type RfqCarrierFacts } from '../rfq/draftEmail.js';
import type { complete } from '../../ai/client.js';
import { isValidRfqToken } from '../rfq/tokens.js';
import {
  renderRfqForm,
  renderRfqReview,
  renderRfqConfirmation,
  renderShipperView,
  renderCarrierQuotePage,
  renderQuoteSubmitted,
  renderOptOutConfirmation,
  renderRfqNotFound,
} from '../rfq/pages.js';
import { dbOutreachEmailStore, normalizeEmailAddress } from '../outreach/outreachEmailStore.js';
import { forceReingestCarrierDirectory } from '../directory/autoHeal.js';
import type { RfqFilterSnapshot, RfqRecipientStatus } from '../../db/schema.js';

/** Default recipient cap (env-overridable, RFQ_MAX_RECIPIENTS). */
export function rfqMaxRecipients(): number {
  const raw = process.env.RFQ_MAX_RECIPIENTS;
  const n = raw != null ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 25;
}

/** Per-send throttle (ms) between LIVE sends so one RFQ can't blast a burst. */
function rfqThrottleMs(): number {
  const raw = process.env.RFQ_SEND_THROTTLE_MS;
  const n = raw != null ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 200;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Injectable seams — production wires the DB/network defaults; tests inject fakes. */
export interface RfqRouteDeps {
  store?: RfqStore;
  resolveDeps?: ResolveDeps;
  /** Injected email sender (defaults to the app's real sendEmail). */
  send?: SendRfqDeps['send'];
  /** Injected suppression check (defaults to the outreach suppression store). */
  isEmailSuppressed?: (email: string) => Promise<boolean>;
  /** Override the live-send gate (defaults to RFQ_LIVE_SEND). */
  liveSend?: boolean;
  baseUrl?: string;
  maxRecipients?: number;
  throttleMs?: number;
  /** Force-reingest kicker (defaults to the real autoHeal fn). */
  forceReingest?: () => Promise<'started' | 'lock-held' | 'disabled'>;
  /** Injected AI client for the per-carrier drafter (defaults to the app client). */
  aiComplete?: typeof complete;
  /** Presence gates the AI draft step (defaults to ANTHROPIC_API_KEY). */
  anthropicKey?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Serialize the directory facet params present on a raw query into a stable
 *  querystring (drops paging) — carried through the form so POST re-resolves the
 *  SAME selection the shipper saw. */
function serializeFacetQuery(raw: Record<string, unknown>): string {
  const p = new URLSearchParams();
  for (const k of FACET_QUERY_KEYS) {
    if (k === 'page') continue;
    const v = raw[k];
    if (v != null && String(v).trim() !== '') p.set(k, String(v));
  }
  return p.toString();
}

/** True when a facet querystring carries at least one real filter. */
function hasAnyFacet(query: string): boolean {
  if (!query) return false;
  const params = new URLSearchParams(query);
  for (const k of FACET_QUERY_KEYS) {
    if (k === 'page') continue;
    const v = params.get(k);
    if (v != null && v.trim() !== '') return true;
  }
  return false;
}

function filtersFromQuery(query: string): DirectoryFilters {
  const obj = Object.fromEntries(new URLSearchParams(query).entries());
  return normalizeFilters(obj);
}

/** Resolve the selection (dots | filter querystring) into a recipient set. */
async function resolveSelection(
  dots: string[],
  filterQuery: string,
  cap: number,
  deps: ResolveDeps,
): Promise<Awaited<ReturnType<typeof resolveRfqRecipients>>> {
  if (dots.length) return resolveRfqRecipients({ dots }, cap, deps);
  if (hasAnyFacet(filterQuery)) return resolveRfqRecipients({ filters: filtersFromQuery(filterQuery) }, cap, deps);
  return { recipients: [], totalMatched: 0, capped: false, cappedOut: 0, cap };
}

function baseUrlOf(deps: RfqRouteDeps, req: Request): string {
  return deps.baseUrl ?? process.env.PUBLIC_BASE_URL ?? `${req.protocol}://${req.get('host') ?? 'localhost'}`;
}

export function registerRfqRoutes(app: Express, deps: RfqRouteDeps = {}) {
  const store = deps.store ?? dbRfqStore;
  const resolveDeps = deps.resolveDeps ?? dbResolveDeps(dbOutreachEmailStore);
  const isEmailSuppressed =
    deps.isEmailSuppressed ??
    (async (email: string) => {
      try {
        return await dbOutreachEmailStore.isRecipientSuppressed(normalizeEmailAddress(email));
      } catch {
        return false;
      }
    });
  const forceReingest = deps.forceReingest ?? forceReingestCarrierDirectory;

  // ── GET the form ─────────────────────────────────────────────────────────
  app.get('/directory/rfq', async (req: Request, res: Response, next) => {
    try {
      const cap = deps.maxRecipients ?? rfqMaxRecipients();
      const dots = parseDots(req.query.dots);
      const filterQuery = dots.length ? '' : serializeFacetQuery(req.query as Record<string, unknown>);
      // No selection at all → nothing to request; send them to the directory.
      if (!dots.length && !hasAnyFacet(filterQuery)) return res.redirect(302, '/directory');
      const resolved = await resolveSelection(dots, filterQuery, cap, resolveDeps);
      res.type('html').send(
        renderRfqForm({
          recipientCount: resolved.recipients.length,
          totalMatched: resolved.totalMatched,
          cap: resolved.cap,
          capped: resolved.capped,
          dots: dots.length ? dots.join(',') : undefined,
          filterQuery: filterQuery || undefined,
        }),
      );
    } catch (err) {
      next(err);
    }
  });

  // ── POST the form → create + fan out + confirm ───────────────────────────
  app.post(
    '/directory/rfq',
    rfqSubmitIpLimiter,
    rfqSubmitEmailLimiter,
    async (req: Request, res: Response, next) => {
      try {
        const cap = deps.maxRecipients ?? rfqMaxRecipients();
        const body = (req.body ?? {}) as Record<string, unknown>;
        const str = (v: unknown) => String(v ?? '').trim();

        const dots = parseDots(body.dots);
        const filterQuery = dots.length ? '' : str(body.filters);

        const prefill: Record<string, string> = {
          origin: str(body.origin),
          destination: str(body.destination),
          equipment: str(body.equipment),
          container_type: str(body.container_type),
          commodity: str(body.commodity),
          weight: str(body.weight),
          ready_date: str(body.ready_date),
          target_rate: str(body.target_rate),
          notes: str(body.notes),
          shipper_name: str(body.shipper_name),
          shipper_company: str(body.shipper_company),
          shipper_email: str(body.shipper_email),
          shipper_phone: str(body.shipper_phone),
        };

        // Resolve the recipient set first (needed for both the error re-render
        // and the create path).
        const resolved = await resolveSelection(dots, filterQuery, cap, resolveDeps);

        const reRenderError = (msg: string) =>
          res.status(400).type('html').send(
            renderRfqForm({
              recipientCount: resolved.recipients.length,
              totalMatched: resolved.totalMatched,
              cap: resolved.cap,
              capped: resolved.capped,
              dots: dots.length ? dots.join(',') : undefined,
              filterQuery: filterQuery || undefined,
              prefill,
              error: msg,
            }),
          );

        // Validate.
        if (!prefill.origin || !prefill.destination) return reRenderError('Origin and destination are required.');
        if (!prefill.shipper_name) return reRenderError('Please tell carriers your name.');
        if (!EMAIL_RE.test(prefill.shipper_email)) return reRenderError('Please enter a valid email so we can send your responses link.');
        if (!resolved.recipients.length) return reRenderError('No carriers matched this selection. Adjust your filters and try again.');

        // Create the request row.
        const snapshot: RfqFilterSnapshot = {
          ...(dots.length ? { dots } : {}),
          ...(filterQuery ? { filterQuery } : {}),
        };
        const request = await store.createRequest({
          shipperName: prefill.shipper_name,
          shipperCompany: prefill.shipper_company || null,
          shipperEmail: prefill.shipper_email,
          shipperPhone: prefill.shipper_phone || null,
          origin: prefill.origin,
          destination: prefill.destination,
          equipment: prefill.equipment || null,
          containerType: prefill.container_type || null,
          commodity: prefill.commodity || null,
          weight: prefill.weight || null,
          readyDate: prefill.ready_date || null,
          targetRate: prefill.target_rate || null,
          notes: prefill.notes || null,
          filterSnapshot: snapshot,
        });

        // PHASE 1 — GENERATE. Draft a personalized "Dear <Company>," letter per
        // PENDING recipient (AI-drafted, else the deterministic template). This
        // does NOT send anything: the shipper reviews/edits on the next screen and
        // confirms send in phase 2. Non-pending rows (no_email/opted_out) get no
        // draft. A per-carrier draft failure never blocks — draftRfqEmail always
        // returns a usable letter (template fallback).
        const aiComplete = deps.aiComplete;
        const anthropicKey = deps.anthropicKey;
        const drafts = await Promise.all(
          resolved.recipients.map(async (r) => {
            if (r.status !== 'pending') return { subject: null as string | null, body: null as string | null };
            const facts: RfqCarrierFacts = r.facts ?? { name: r.name };
            const d = await draftRfqEmail(request, facts, { aiComplete, anthropicKey });
            return { subject: d.subject, body: d.body };
          }),
        );

        // Create recipient rows (each with its classified status + its draft).
        const created = await store.addRecipients(
          request.id,
          resolved.recipients.map((r, i) => ({
            carrierDot: r.usdot,
            carrierName: r.name,
            carrierEmail: r.email,
            status: r.status,
            draftSubject: drafts[i].subject,
            draftBody: drafts[i].body,
          })),
        );

        const baseUrl = baseUrlOf(deps, req);
        const reviewUrl = `${baseUrl.replace(/\/$/, '')}/directory/rfq/${request.viewToken}/review`;
        res.type('html').send(
          renderRfqReview({
            request,
            recipients: created,
            reviewUrl,
            actionUrl: `/directory/rfq/${request.viewToken}/send`,
            noEmail: created.filter((r) => r.status === 'no_email').length,
            optedOut: created.filter((r) => r.status === 'opted_out').length,
            cappedOut: resolved.cappedOut,
            total: resolved.totalMatched,
            dryRun: !(deps.liveSend ?? rfqLiveSendEnabled()),
          }),
        );
      } catch (err) {
        next(err);
      }
    },
  );

  // ── Carrier quote-submission (GET form) — registered BEFORE :viewToken so the
  //    literal /quote/ and /optout/ segments win over the token param. ────────
  app.get('/directory/rfq/quote/:token', async (req: Request, res: Response, next) => {
    try {
      const token = String(req.params.token);
      if (!isValidRfqToken(token)) return res.status(404).type('html').send(renderRfqNotFound());
      const ctx = await store.getByQuoteToken(token);
      if (!ctx) return res.status(404).type('html').send(renderRfqNotFound());
      if (ctx.recipient.status === 'opted_out') {
        return res.type('html').send(renderOptOutConfirmation({ carrierName: ctx.recipient.carrierName }));
      }
      res.type('html').send(renderCarrierQuotePage({ request: ctx.request, recipient: ctx.recipient, quote: ctx.quote }));
    } catch (err) {
      next(err);
    }
  });

  // ── Carrier quote-submission (POST) ──────────────────────────────────────
  app.post('/directory/rfq/quote/:token', rfqQuoteLimiter, async (req: Request, res: Response, next) => {
    try {
      const token = String(req.params.token);
      if (!isValidRfqToken(token)) return res.status(404).type('html').send(renderRfqNotFound());
      const ctx = await store.getByQuoteToken(token);
      if (!ctx) return res.status(404).type('html').send(renderRfqNotFound());
      if (ctx.recipient.status === 'opted_out') {
        return res.type('html').send(renderOptOutConfirmation({ carrierName: ctx.recipient.carrierName }));
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      const str = (v: unknown) => String(v ?? '').trim();
      const price = str(body.price);
      if (!price) {
        return res.status(400).type('html').send(
          renderCarrierQuotePage({
            request: ctx.request,
            recipient: ctx.recipient,
            quote: ctx.quote,
            error: 'Please enter an all-in rate.',
          }),
        );
      }
      const transitRaw = str(body.transit_days);
      const transitNum = transitRaw ? parseInt(transitRaw, 10) : NaN;
      await store.submitQuote(token, {
        price,
        transitDays: Number.isFinite(transitNum) ? transitNum : null,
        validUntil: str(body.valid_until) || null,
        notes: str(body.notes) || null,
      });
      res.type('html').send(renderQuoteSubmitted({ request: ctx.request }));
    } catch (err) {
      next(err);
    }
  });

  // ── Carrier one-click opt-out ────────────────────────────────────────────
  app.get('/directory/rfq/optout/:token', async (req: Request, res: Response, next) => {
    try {
      const token = String(req.params.token);
      if (!isValidRfqToken(token)) return res.status(404).type('html').send(renderRfqNotFound());
      const result = await store.optOutByQuoteToken(token);
      if (!result.ok) return res.status(404).type('html').send(renderRfqNotFound());
      res.type('html').send(renderOptOutConfirmation({ carrierName: result.carrierName }));
    } catch (err) {
      next(err);
    }
  });

  // ── PHASE 1 review screen (GET) — re-open the editable drafts for a request.
  //    Registered before the bare :viewToken GET (extra /review segment). ─────
  app.get('/directory/rfq/:viewToken/review', async (req: Request, res: Response, next) => {
    try {
      const token = String(req.params.viewToken);
      if (!isValidRfqToken(token)) return res.status(404).type('html').send(renderRfqNotFound());
      const view = await store.getByViewToken(token);
      if (!view) return res.status(404).type('html').send(renderRfqNotFound());
      const baseUrl = baseUrlOf(deps, req);
      res.type('html').send(
        renderRfqReview({
          request: view.request,
          recipients: view.recipients,
          reviewUrl: `${baseUrl.replace(/\/$/, '')}/directory/rfq/${view.request.viewToken}/review`,
          actionUrl: `/directory/rfq/${view.request.viewToken}/send`,
          noEmail: view.recipients.filter((r) => r.status === 'no_email').length,
          optedOut: view.recipients.filter((r) => r.status === 'opted_out').length,
          cappedOut: 0,
          total: view.recipients.length,
          dryRun: !(deps.liveSend ?? rfqLiveSendEnabled()),
        }),
      );
    } catch (err) {
      next(err);
    }
  });

  // ── PHASE 2 — CONFIRM & SEND. Persist the shipper's (possibly-edited) drafts,
  //    then run the fan-out over ONLY the approved/pending recipients (dry-run
  //    unless RFQ_LIVE_SEND), honoring suppression + one-click opt-out. ────────
  app.post('/directory/rfq/:viewToken/send', async (req: Request, res: Response, next) => {
    try {
      const token = String(req.params.viewToken);
      if (!isValidRfqToken(token)) return res.status(404).type('html').send(renderRfqNotFound());
      const view = await store.getByViewToken(token);
      if (!view) return res.status(404).type('html').send(renderRfqNotFound());

      const { request } = view;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const str = (v: unknown) => String(v ?? '').trim();

      const liveSend = deps.liveSend ?? rfqLiveSendEnabled();
      const throttleMs = deps.throttleMs ?? rfqThrottleMs();
      const baseUrl = baseUrlOf(deps, req);

      const finalStatus = new Map<number, RfqRecipientStatus>();
      for (const rec of view.recipients) finalStatus.set(rec.id, rec.status as RfqRecipientStatus);

      // Skip anything already terminal for THIS send (only pending rows are sent).
      // Re-sending a request whose recipients are already 'sent' is a no-op.
      for (const rec of view.recipients) {
        if (rec.status !== 'pending') continue;

        // Persist the shipper's edit (falls back to the stored draft when the
        // form omitted the field). The edited value is what actually gets sent.
        const editedSubject = body[`subject_${rec.id}`] !== undefined ? str(body[`subject_${rec.id}`]) : rec.draftSubject ?? '';
        const editedBody = body[`body_${rec.id}`] !== undefined ? str(body[`body_${rec.id}`]) : rec.draftBody ?? '';
        if (editedSubject !== (rec.draftSubject ?? '') || editedBody !== (rec.draftBody ?? '')) {
          await store.updateRecipientDraft(rec.id, editedSubject, editedBody);
        }

        const result = await sendRfqToCarrier(
          request,
          {
            carrierName: rec.carrierName,
            carrierEmail: rec.carrierEmail,
            quoteToken: rec.quoteToken,
            draftSubject: editedSubject || null,
            draftBody: editedBody || null,
          },
          { send: deps.send, isEmailSuppressed, liveSend, baseUrl },
        );
        const nextStatus: RfqRecipientStatus =
          result.status === 'sent' ? 'sent' : result.status === 'opted_out' ? 'opted_out' : 'failed';
        await store.markRecipientStatus(rec.id, nextStatus, nextStatus === 'sent' ? new Date() : null);
        finalStatus.set(rec.id, nextStatus);
        if (liveSend && throttleMs > 0) await sleep(throttleMs);
      }

      let sent = 0;
      let noEmail = 0;
      let optedOut = 0;
      for (const s of finalStatus.values()) {
        if (s === 'sent') sent++;
        else if (s === 'no_email') noEmail++;
        else if (s === 'opted_out') optedOut++;
      }

      const viewUrl = `${baseUrl.replace(/\/$/, '')}/directory/rfq/${request.viewToken}`;
      res.type('html').send(
        renderRfqConfirmation({
          viewUrl,
          sent,
          noEmail,
          optedOut,
          cappedOut: 0,
          total: view.recipients.length,
          dryRun: !liveSend,
        }),
      );
    } catch (err) {
      next(err);
    }
  });

  // ── Shipper's live responses view (registered LAST — token param) ────────
  app.get('/directory/rfq/:viewToken', async (req: Request, res: Response, next) => {
    try {
      const token = String(req.params.viewToken);
      if (!isValidRfqToken(token)) return res.status(404).type('html').send(renderRfqNotFound());
      const view = await store.getByViewToken(token);
      if (!view) return res.status(404).type('html').send(renderRfqNotFound());
      res.type('html').send(renderShipperView(view));
    } catch (err) {
      next(err);
    }
  });

  // ── Admin: force FMCSA re-ingest (backfill new columns after publish) ─────
  // Guarded by a shared secret in `x-ingest-token` (constant-time compared to
  // INGEST_ADMIN_TOKEN). Missing/unset/mismatch → 404 (hide the endpoint's
  // existence). Match → kick a background force re-ingest, return 202.
  app.post('/api/public/directory/reingest', async (req: Request, res: Response, next) => {
    try {
      const expected = process.env.INGEST_ADMIN_TOKEN;
      const provided = req.header('x-ingest-token');
      if (!secretMatches(provided, expected)) {
        return res.status(404).json({ error: 'not found' });
      }
      const outcome = await forceReingest();
      return res.status(202).json({ status: outcome });
    } catch (err) {
      next(err);
    }
  });
}

/** Constant-time secret compare — a missing/unset expected secret or a
 *  wrong-length provided secret both fail fast without throwing. */
function secretMatches(provided: string | undefined, expected: string | undefined): boolean {
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
