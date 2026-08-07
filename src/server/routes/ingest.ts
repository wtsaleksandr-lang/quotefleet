/**
 * Tenant rate-sheet ingest API.
 *
 *   POST /api/tenant/ingest
 *     body: { filename, mimeType, dataBase64 }
 *     → starts a background parse job. Returns { jobId, status: 'parsing' }.
 *     → safety: 5 MB cap, supported mime types only.
 *
 *   GET /api/tenant/ingest/:id
 *     → poll job status + parsed JSON when ready.
 *
 *   POST /api/tenant/ingest/:id/apply
 *     body: { rateCards?, accessorials?, laneZones? } — operator can edit
 *     the parsed draft before submit.
 *     → upserts into rate_cards / accessorials / lane_zones, marks job
 *       'applied', triggers marketplace sync.
 *
 *   POST /api/tenant/ingest/:id/reject
 *     → marks job 'rejected'. No DB writes.
 *
 *   GET /api/tenant/ingest
 *     → list recent jobs.
 *
 * Files are stored base64-encoded in the `ingest_jobs.storage_ref` column
 * for V1 (small files only). For production, swap to object storage and
 * store the URL.
 */
import type { Express, Request, Response } from 'express';
import { eq, and, desc } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client.js';
import {
  ingestJobs,
  rateCards,
  accessorials,
  laneZones,
  rateMatrices,
  rateZones,
  tenants,
} from '../../db/schema.js';
import { requireAuth, requireTenant } from '../middleware.js';
import { aiTenantBurstLimiter, aiTenantDailyLimiter } from '../rateLimits.js';
import { addTrustedSender } from '../emailImport.js';
import {
  parseRateSheet,
  IngestUnsupportedError,
  RateCardDraftSchema,
  AccessorialDraftSchema,
  LaneZoneDraftSchema,
  RateMatrixDraftSchema,
} from '../../ai/ingestFile.js';
import { coerceLtlConfig } from '../../calc/freightClass.js';
import type { LtlConfig } from '../../calc/freightClass.js';
import type { MatrixCellInput, ZoneDefInput } from '../../calc/rateMatrix.js';
import { syncTenantToMarketplace } from '../../marketplace/sync.js';
import {
  calculate,
  currencyForCountry,
  customerFacingLines,
  type CalcRequest,
} from '../../calc/engine.js';
import type { RateCard, Accessorial, LaneZone } from '../../db/schema.js';
import { distanceBetween } from '../../calc/distance.js';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

const StartSchema = z.object({
  filename: z.string().min(1).max(200),
  mimeType: z.string().min(3).max(120),
  dataBase64: z.string().min(8).max(MAX_BYTES * 2), // base64 ≈ 4/3 of binary
});

// Apply boundary validation. Replaces the old loose `z.record(string, unknown)`:
// every draft member is now validated by the shared ingest draft schemas (which
// are lenient/passthrough, so operator-edited drafts and the current simple
// shape still pass) — a non-array or a wholly-wrong-typed member is rejected
// here rather than silently coerced deep in the transaction.
const ApplySchema = z.object({
  rateCards: z.array(RateCardDraftSchema).optional(),
  accessorials: z.array(AccessorialDraftSchema).optional(),
  laneZones: z.array(LaneZoneDraftSchema).optional(),
  rateMatrices: z.array(RateMatrixDraftSchema).optional(),
});

// "Test your rates" — a sample lane the owner runs against the not-yet-applied
// draft, exactly as one of their customers would through the widget.
const PreviewLocationSchema = z.object({
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  country: z.string().optional(),
  portCode: z.string().optional(),
});
const PreviewSchema = z.object({
  service: z.string().min(1),
  equipment: z.string().min(1),
  pickup: PreviewLocationSchema,
  delivery: PreviewLocationSchema,
  weightLbs: z.number().nonnegative().optional(),
  pieces: z.number().nonnegative().optional(),
  lengthIn: z.number().nonnegative().optional(),
  widthIn: z.number().nonnegative().optional(),
  heightIn: z.number().nonnegative().optional(),
  selectedAccessorialCodes: z.array(z.string()).optional(),
  flags: z
    .object({
      residential: z.boolean().optional(),
      hazmat: z.boolean().optional(),
      tempControlled: z.boolean().optional(),
      liftgate: z.boolean().optional(),
    })
    .optional(),
});

export function registerIngestRoutes(app: Express) {
  // ── Start a job ──────────────────────────────────────────────────
  // Per-tenant AI cost cap (audit H3): the parse runs a Sonnet VISION pass on
  // the uploaded document, on the shared platform key when the tenant has no
  // BYO key. Burst + daily limiters keyed by tenant id gate the UPLOAD (the only
  // AI-spend entry point here — poll/list/apply/preview/reject don't call the
  // model). Chained AFTER requireTenant; BYO-key tenants are skipped.
  app.post('/api/tenant/ingest', requireAuth, requireTenant, aiTenantBurstLimiter, aiTenantDailyLimiter, async (req: Request, res: Response) => {
    const parse = StartSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: 'Invalid input', details: parse.error.flatten() });
    }
    const { filename, mimeType, dataBase64 } = parse.data;
    const sizeBytes = Math.floor((dataBase64.length * 3) / 4);
    if (sizeBytes > MAX_BYTES) {
      return res.status(413).json({ error: `File too large (max ${MAX_BYTES / 1024 / 1024} MB).` });
    }

    const [job] = await db()
      .insert(ingestJobs)
      .values({
        tenantId: req.tenant!.id,
        userId: req.user!.id,
        filename,
        mimeType,
        sizeBytes,
        storageRef: dataBase64, // V1: store inline. Swap to object storage for prod.
        status: 'parsing',
      })
      .returning({ id: ingestJobs.id });
    if (!job) return res.status(500).json({ error: 'Failed to create job' });

    // Fire-and-forget the parse. Caller polls GET /:id for the result.
    void runParse(job.id, req.tenant!.id, filename, mimeType, dataBase64);

    return res.json({ ok: true, jobId: job.id, status: 'parsing' });
  });

  // ── Poll a job ───────────────────────────────────────────────────
  app.get('/api/tenant/ingest/:id', requireAuth, requireTenant, async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const rows = await db()
      .select()
      .from(ingestJobs)
      .where(and(eq(ingestJobs.id, id), eq(ingestJobs.tenantId, req.tenant!.id)))
      .limit(1);
    const job = rows[0];
    if (!job) return res.status(404).json({ error: 'Job not found' });
    return res.json({
      job: {
        id: job.id,
        filename: job.filename,
        mimeType: job.mimeType,
        sizeBytes: job.sizeBytes,
        status: job.status,
        parsed: job.parsedJson,
        errorMessage: job.errorMessage,
        appliedAt: job.appliedAt,
        createdAt: job.createdAt,
        // Provenance (audit gap): the operator must be able to tell an
        // email-sourced draft from a manual upload, and see WHO sent it. All of
        // this is already stored; we simply surface it. `source` is derived so
        // the UI never has to reason about null userId vs sourceEmail itself.
        sourceEmail: job.sourceEmail ?? null,
        source: deriveJobSource(job),
        // For a body-email the retained raw content starts with `Subject: …`;
        // pull it out cheaply so the review header can show it. Null for
        // attachment-sourced or manual jobs (the filename covers those).
        subject: emailSubjectFromStorageRef(job.storageRef),
      },
    });
  });

  // ── List recent jobs ─────────────────────────────────────────────
  app.get('/api/tenant/ingest', requireAuth, requireTenant, async (req: Request, res: Response) => {
    const rows = await db()
      .select({
        id: ingestJobs.id,
        filename: ingestJobs.filename,
        mimeType: ingestJobs.mimeType,
        sizeBytes: ingestJobs.sizeBytes,
        status: ingestJobs.status,
        appliedAt: ingestJobs.appliedAt,
        createdAt: ingestJobs.createdAt,
        // Provenance fields (see detail endpoint). userId is selected only to
        // derive `source`; it isn't returned. storageRef is intentionally NOT
        // selected here (it can be multi-MB base64 × 50 rows) — subject is a
        // detail-view-only field.
        sourceEmail: ingestJobs.sourceEmail,
        userId: ingestJobs.userId,
      })
      .from(ingestJobs)
      .where(eq(ingestJobs.tenantId, req.tenant!.id))
      .orderBy(desc(ingestJobs.createdAt))
      .limit(50);
    const jobs = rows.map((j) => ({
      id: j.id,
      filename: j.filename,
      mimeType: j.mimeType,
      sizeBytes: j.sizeBytes,
      status: j.status,
      appliedAt: j.appliedAt,
      createdAt: j.createdAt,
      sourceEmail: j.sourceEmail ?? null,
      source: deriveJobSource(j),
    }));
    return res.json({ jobs });
  });

  // ── Apply parsed changes ─────────────────────────────────────────
  app.post('/api/tenant/ingest/:id/apply', requireAuth, requireTenant, async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const parse = ApplySchema.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: 'Invalid input' });

    const job = (
      await db()
        .select()
        .from(ingestJobs)
        .where(and(eq(ingestJobs.id, id), eq(ingestJobs.tenantId, req.tenant!.id)))
        .limit(1)
    )[0];
    if (!job) return res.status(404).json({ error: 'Job not found' });
    // Only allow apply when the parse has finished. Earlier we let
    // 'parsing' through, which meant operators could apply an empty
    // draft and the row would be marked 'applied' before parsing even
    // completed (no retry path then).
    if (job.status !== 'ready_for_review') {
      return res.status(409).json({ error: `Job status is "${job.status}", cannot apply. Wait for the parse to finish or upload again.` });
    }

    const tenantId = req.tenant!.id;

    let inserted: ApplyResult;
    try {
      inserted = await applyDraftToTenant(tenantId, id, parse.data as IngestDraft);
    } catch (err) {
      console.error('[ingest.apply] transaction failed:', err);
      return res.status(500).json({ error: 'Apply failed — nothing was changed. Try again.' });
    }

    // Trust-on-approve (audit H2): approving an email-originated import trusts
    // its sender, so future imports from that now-known sender can auto-apply
    // (still subject to the opt-in flag + confidence/auto-check gates). Only
    // email-origin jobs carry a sourceEmail; manual uploads don't and are no-ops.
    if (job.sourceEmail) {
      const current = req.tenant!.ingestTrustedSendersJson;
      const next = addTrustedSender(current, job.sourceEmail);
      if (next.length !== (Array.isArray(current) ? current.length : 0)) {
        try {
          await db()
            .update(tenants)
            .set({ ingestTrustedSendersJson: next, updatedAt: new Date() })
            .where(eq(tenants.id, tenantId));
        } catch (err) {
          // Non-fatal: the rates DID apply; only the trust update failed. Log
          // and continue rather than fail the approve the operator just made.
          console.error('[ingest.apply] trust-on-approve update failed:', err);
        }
      }
    }

    return res.json({ ok: true, inserted });
  });

  // ── System auto-verification of the DRAFT (no persist) ────────────
  // Runs a spread of representative sample quotes against the parsed draft so
  // the owner gets reliability confidence without testing anything by hand.
  app.get('/api/tenant/ingest/:id/autocheck', requireAuth, requireTenant, async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const job = (
      await db()
        .select()
        .from(ingestJobs)
        .where(and(eq(ingestJobs.id, id), eq(ingestJobs.tenantId, req.tenant!.id)))
        .limit(1)
    )[0];
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status !== 'ready_for_review') {
      return res.status(409).json({ error: `Job status is "${job.status}", nothing to check yet.` });
    }
    const summary = runDraftAutoCheck((job.parsedJson ?? {}) as Parameters<typeof runDraftAutoCheck>[0]);
    return res.json({ ok: true, ...summary });
  });

  // ── Preview a quote against the DRAFT (no persist) ────────────────
  // Lets the owner "test your rates" before applying: runs the pure pricing
  // engine over the parsed-but-not-yet-saved draft with a sample lane, so they
  // see exactly what a customer would be quoted. Writes NOTHING to the DB.
  app.post('/api/tenant/ingest/:id/preview-quote', requireAuth, requireTenant, async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const parse = PreviewSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: 'Invalid input', details: parse.error.flatten() });
    }

    // IDOR-scoped: the job must belong to the caller's tenant.
    const job = (
      await db()
        .select()
        .from(ingestJobs)
        .where(and(eq(ingestJobs.id, id), eq(ingestJobs.tenantId, req.tenant!.id)))
        .limit(1)
    )[0];
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status !== 'ready_for_review') {
      return res.status(409).json({ error: `Job status is "${job.status}", nothing to test yet.` });
    }

    const draft = (job.parsedJson ?? {}) as {
      rateCards?: Array<Record<string, unknown>>;
      accessorials?: Array<Record<string, unknown>>;
      laneZones?: Array<Record<string, unknown>>;
    };
    const { cards, accs, zones, matrices, matrixZones } = draftToEngineConfig(draft);

    const body = parse.data;
    // Same distance step as the real widget path (public.ts). Port codes are
    // resolved to coordinates inside geocode(); failures come back gracefully.
    const dist = await distanceBetween(body.pickup, body.delivery);
    if ('error' in dist) {
      return res.status(200).json({ ok: true, unsupported: { reason: dist.error } });
    }

    const calcReq: CalcRequest = {
      service: body.service,
      equipment: body.equipment,
      miles: dist.miles,
      weightLbs: body.weightLbs,
      pieces: body.pieces,
      lengthIn: body.lengthIn,
      widthIn: body.widthIn,
      heightIn: body.heightIn,
      pickupCity: body.pickup.city,
      pickupState: body.pickup.state,
      pickupZip: body.pickup.zip,
      pickupCountry: body.pickup.country,
      pickupLat: dist.origin.lat,
      pickupLng: dist.origin.lng,
      deliveryCity: body.delivery.city,
      deliveryState: body.delivery.state,
      deliveryZip: body.delivery.zip,
      deliveryCountry: body.delivery.country,
      deliveryLat: dist.destination.lat,
      deliveryLng: dist.destination.lng,
      pickupPortCode: body.pickup.portCode,
      deliveryPortCode: body.delivery.portCode,
      selectedAccessorialCodes: body.selectedAccessorialCodes,
      flags: body.flags,
      // Label only — the draft's rates are already in the carrier's own
      // currency, so tag the preview with it. Nothing is converted. BOTH-focus
      // tenants label per resolved lane country (delivery first, then pickup).
      currency: currencyForCountry(req.tenant!.countryFocus, body.delivery.country ?? body.pickup.country),
    };

    // Manual-mode fuel (each draft card's own fuelSurchargePct) — the honest
    // preview of the imported numbers, no tenant auto-FSC overlay. Matrix cells
    // + zone rules are passed so a preview lane prices through the matrix too.
    const result = calculate(cards, accs, zones, calcReq, [], undefined, matrices, matrixZones);

    if (result.unsupported) {
      return res.json({ ok: true, miles: dist.miles, unsupported: result.unsupported });
    }

    // Show it as the CUSTOMER would see it — margin folded away, total unchanged.
    const customerResult = {
      ...result,
      margin: 0,
      lines: customerFacingLines(result.lines),
    };
    return res.json({ ok: true, miles: dist.miles, result: customerResult });
  });

  // ── Reject ──────────────────────────────────────────────────────
  app.post('/api/tenant/ingest/:id/reject', requireAuth, requireTenant, async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    await db()
      .update(ingestJobs)
      .set({ status: 'rejected', updatedAt: new Date() })
      .where(and(eq(ingestJobs.id, id), eq(ingestJobs.tenantId, req.tenant!.id)));
    return res.json({ ok: true });
  });
}

/**
 * Provenance marker for an ingest job. An email-originated import carries a
 * `sourceEmail` (normalized From) and is created system-owned (no userId); a
 * manual dashboard upload has neither. Either signal ⇒ 'email' so a job stays
 * correctly classified even if one field is ever backfilled/absent.
 */
export function deriveJobSource(job: { sourceEmail?: string | null; userId?: number | null }): 'email' | 'upload' {
  return job.sourceEmail != null || job.userId == null ? 'email' : 'upload';
}

/**
 * Cheap subject extraction for a body-email ingest job. `pickBestContent`
 * stores a forwarded email BODY as base64 of `Subject: <subj>\n\n<body>`; decode
 * just the first ~300 bytes and pull the leading `Subject:` line. Returns null
 * for attachment-sourced or manual uploads (whose storageRef is opaque file
 * bytes that don't start with a Subject line) — the filename covers those.
 */
export function emailSubjectFromStorageRef(storageRef: string | null | undefined): string | null {
  if (typeof storageRef !== 'string' || storageRef.length < 8) return null;
  let head: string;
  try {
    // 400 base64 chars ≈ 300 decoded bytes — plenty for a subject line, and we
    // never decode a multi-MB attachment just to look for one.
    head = Buffer.from(storageRef.slice(0, 400), 'base64').toString('utf8');
  } catch {
    return null;
  }
  const m = head.match(/^Subject:\s*(.+)$/m);
  if (!m) return null;
  const subj = m[1].trim();
  return subj ? subj.slice(0, 200) : null;
}

/** Count of rows written by an apply. */
export interface ApplyResult {
  rateCards: number;
  accessorials: number;
  laneZones: number;
  rateMatrices: number;
  rateZones: number;
}

/** A parsed/edited draft in the loose shape the AI parser + apply path use. */
export interface IngestDraft {
  rateCards?: Array<Record<string, unknown>>;
  accessorials?: Array<Record<string, unknown>>;
  laneZones?: Array<Record<string, unknown>>;
  rateMatrices?: Array<Record<string, unknown>>;
}

/** One normalized matrix CELL ready for persistence / engine pricing. */
interface NormMatrixCell {
  mode: string;
  equipment: string | null;
  originKey: string;
  destKey: string;
  rate: number;
  unitBasis: string;
  minCharge: number | null;
  currency: string | null;
  effectiveDate: string | null;
  sourceRef: string | null;
}
/** One normalized zone-legend rule ready for persistence / engine resolution. */
interface NormZone {
  zoneId: string;
  matchKind: string;
  matchValue: string | null;
  matchFrom: string | null;
  matchTo: string | null;
  label: string | null;
}

const MATRIX_UNIT_BASES = new Set(['flat', 'per_mile', 'per_container']);
const ZONE_MATCH_KINDS = new Set(['zip5', 'zip3', 'city_state', 'zip_range']);

function strOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

/**
 * Flatten the loose `rateMatrices` draft blocks into normalized cells + zone
 * rules. Each block carries defaults (mode / equipment / unitBasis / currency /
 * effectiveDate / minCharge / sourceRef) that each cell inherits unless it
 * overrides them. Cells missing an origin/dest key or a mode are dropped. Zone
 * rules are de-duplicated across blocks by (zoneId, matchKind, value/range).
 * Shared by the DB apply path and the in-memory preview so both persist and
 * price identically.
 */
function normalizeDraftMatrices(
  blocks: Array<Record<string, unknown>>,
): { cells: NormMatrixCell[]; zones: NormZone[] } {
  const cells: NormMatrixCell[] = [];
  const zones: NormZone[] = [];
  const seenZone = new Set<string>();

  for (const block of blocks ?? []) {
    if (!block || typeof block !== 'object') continue;
    const mode = String(block.mode ?? '').trim().toLowerCase();
    const blockEquip = strOrNull(block.equipment);
    const rawBlockUnit = String(block.unitBasis ?? 'flat').trim();
    const blockUnit = MATRIX_UNIT_BASES.has(rawBlockUnit) ? rawBlockUnit : 'flat';
    const blockCurrency = strOrNull(block.currency);
    const blockEffective = strOrNull(block.effectiveDate);
    const blockSource = strOrNull(block.sourceRef);
    const blockMin = numOrNull(block.minCharge);

    const rawCells = Array.isArray(block.cells) ? (block.cells as Array<Record<string, unknown>>) : [];
    for (const c of rawCells) {
      if (!c || typeof c !== 'object') continue;
      const originKey = strOrNull(c.originKey);
      const destKey = strOrNull(c.destKey);
      if (!originKey || !destKey || !mode) continue; // un-priceable without keys/mode
      const rawUnit = String(c.unitBasis ?? blockUnit).trim();
      const unitBasis = MATRIX_UNIT_BASES.has(rawUnit) ? rawUnit : blockUnit;
      cells.push({
        mode,
        equipment: blockEquip,
        originKey,
        destKey,
        rate: numOrNull(c.rate) ?? 0,
        unitBasis,
        minCharge: numOrNull(c.minCharge) ?? blockMin,
        currency: blockCurrency,
        effectiveDate: blockEffective,
        sourceRef: blockSource,
      });
    }

    const rawZones = Array.isArray(block.zones) ? (block.zones as Array<Record<string, unknown>>) : [];
    for (const z of rawZones) {
      if (!z || typeof z !== 'object') continue;
      const zoneId = strOrNull(z.zoneId);
      const rawKind = String(z.matchKind ?? '').trim();
      if (!zoneId || !ZONE_MATCH_KINDS.has(rawKind)) continue;
      const matchValue = strOrNull(z.matchValue);
      const matchFrom = strOrNull(z.matchFrom);
      const matchTo = strOrNull(z.matchTo);
      const dedupeKey = `${zoneId}|${rawKind}|${matchValue ?? ''}|${matchFrom ?? ''}|${matchTo ?? ''}`;
      if (seenZone.has(dedupeKey)) continue;
      seenZone.add(dedupeKey);
      zones.push({
        zoneId,
        matchKind: rawKind,
        matchValue,
        matchFrom,
        matchTo,
        label: strOrNull(z.label),
      });
    }
  }

  return { cells, zones };
}

/** Known accessorial triggers the engine understands. Anything else → 'optional'
 *  (an unrecognized trigger would otherwise make the accessorial un-applyable —
 *  it is neither an `auto_*` case nor the customer-selectable `optional`). */
const KNOWN_TRIGGERS = new Set([
  'optional',
  'auto',
  'auto_if_residential',
  'auto_if_hazmat',
  'auto_if_temp_controlled',
  'auto_if_no_dock',
  'auto_if_loose',
  'auto_if_weight_over',
]);

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalize a loose draft rate card into the columns the engine reads. Shared
 * by the DB apply path and the in-memory preview mapping so both persist and
 * price identically. Folds an LTL card's absoluteMinCharge into minimumCharge
 * (the engine enforces that floor) and coerces ltlConfig to a valid shape.
 */
function normalizeDraftRateCard(c: Record<string, unknown>): {
  service: string;
  equipment: string;
  label: string | null;
  ratePerMile: number;
  minimumCharge: number;
  flatFee: number;
  fuelSurchargePct: number;
  marginPct: number;
  maxWeightLbs: number | null;
  maxMiles: number | null;
  ltlConfig: LtlConfig | null;
} {
  const ltlConfig = coerceLtlConfig(c.ltlConfig);
  // AMC on the LTL config is the minimum-charge floor the engine enforces.
  const minFromAmc = ltlConfig?.absoluteMinCharge ?? null;
  const minimumCharge = numOrNull(c.minimumCharge) ?? minFromAmc ?? 0;
  return {
    service: String(c.service ?? 'ftl'),
    equipment: String(c.equipment ?? 'dryvan'),
    label: c.label != null ? String(c.label) : null,
    ratePerMile: numOrNull(c.ratePerMile) ?? 0,
    minimumCharge,
    flatFee: numOrNull(c.flatFee) ?? 0,
    fuelSurchargePct: numOrNull(c.fuelSurchargePct) ?? 0,
    marginPct: numOrNull(c.marginPct) ?? 0,
    maxWeightLbs: numOrNull(c.maxWeightLbs),
    maxMiles: numOrNull(c.maxMiles),
    ltlConfig,
  };
}

/**
 * Normalize a loose draft accessorial. Whitelists the trigger, and folds the
 * free-time fields (freeHours / daysFlag) plus any explicit conditionJson /
 * weightLbsOver into ONE conditionJson object — exactly the keys the engine's
 * applyAccessorial + autoTriggered read (`freeHours`, `daysFlag`, `weightLbsOver`).
 */
function normalizeDraftAccessorial(a: Record<string, unknown>): {
  code: string;
  label: string;
  kind: string;
  amount: number;
  trigger: string;
  conditionJson: Record<string, unknown> | null;
  appliesToServices: string[] | null;
} {
  const kind = String(a.kind ?? 'flat');
  const rawTrigger = typeof a.trigger === 'string' ? a.trigger : 'optional';
  const trigger = KNOWN_TRIGGERS.has(rawTrigger) ? rawTrigger : 'optional';

  const cond: Record<string, unknown> = {};
  if (a.conditionJson && typeof a.conditionJson === 'object') {
    Object.assign(cond, a.conditionJson as Record<string, unknown>);
  }
  const freeHours = numOrNull(a.freeHours);
  if (kind === 'per_hour' && freeHours !== null) cond.freeHours = freeHours;
  if (kind === 'per_day' && (a.daysFlag === 'layoverDays' || a.daysFlag === 'storageDays')) {
    cond.daysFlag = a.daysFlag;
  }
  const conditionJson = Object.keys(cond).length ? cond : null;

  return {
    code: String(a.code ?? 'misc'),
    label: String(a.label ?? a.code ?? 'Accessorial'),
    kind,
    amount: numOrNull(a.amount) ?? 0,
    trigger,
    conditionJson,
    appliesToServices: Array.isArray(a.appliesToServices) ? (a.appliesToServices as string[]) : null,
  };
}

/**
 * Persist a parsed ingest draft to a tenant's live rate book and mark the job
 * 'applied'. Shared by the operator-triggered apply endpoint AND the inbound
 * email auto-import path so the coercion/defaults + the "all-or-nothing"
 * transaction are identical.
 *
 * Every insert + the status flip run in ONE transaction: a failure halfway
 * leaves the job un-applied (retryable) rather than half-applied + marked done.
 * Marketplace sync is fired best-effort AFTER commit.
 */
export async function applyDraftToTenant(
  tenantId: number,
  jobId: number,
  draft: IngestDraft,
): Promise<ApplyResult> {
  const inserted: ApplyResult = { rateCards: 0, accessorials: 0, laneZones: 0, rateMatrices: 0, rateZones: 0 };
  await db().transaction(async (tx) => {
    for (const c of draft.rateCards ?? []) {
      const n = normalizeDraftRateCard(c);
      await tx.insert(rateCards).values({
        tenantId,
        service: n.service,
        equipment: n.equipment,
        label: n.label,
        ratePerMile: n.ratePerMile,
        minimumCharge: n.minimumCharge,
        flatFee: n.flatFee,
        fuelSurchargePct: n.fuelSurchargePct,
        marginPct: n.marginPct,
        // Persist the engine-enforced ceilings + the LTL class/weight config the
        // extractor now captures. Previously these were never written, so every
        // imported LTL card silently fell back to DEFAULT_LTL_CONFIG.
        maxWeightLbs: n.maxWeightLbs,
        maxMiles: n.maxMiles,
        ltlConfig: n.ltlConfig,
        enabled: true,
        notes: 'Imported from rate-sheet ingest job #' + jobId,
        lastAiEditAt: new Date(),
        lastAiEditReason: 'rate-sheet ingest',
      });
      inserted.rateCards++;
    }
    for (const a of draft.accessorials ?? []) {
      const n = normalizeDraftAccessorial(a);
      await tx.insert(accessorials).values({
        tenantId,
        code: n.code,
        label: n.label,
        kind: n.kind,
        amount: n.amount,
        // Persist the extractor's trigger + conditionJson (freeHours / daysFlag /
        // weightLbsOver) instead of hard-coding 'optional'. This unlocks the
        // engine's auto-trigger + free-time accessorial pricing on import.
        trigger: n.trigger,
        conditionJson: n.conditionJson ?? undefined,
        appliesToServices: n.appliesToServices ?? undefined,
        enabled: true,
      });
      inserted.accessorials++;
    }
    for (const z of draft.laneZones ?? []) {
      await tx.insert(laneZones).values({
        tenantId,
        label: String(z.label ?? 'Imported zone'),
        anchorPortCode: z.anchorPortCode != null ? String(z.anchorPortCode) : null,
        anchorCity: z.anchorCity != null ? String(z.anchorCity) : null,
        anchorState: z.anchorState != null ? String(z.anchorState) : null,
        radiusMiles: Number(z.radiusMiles ?? 0),
        flatPrice: Number(z.flatPrice ?? 0),
        equipmentScope: Array.isArray(z.equipmentScope) ? (z.equipmentScope as string[]) : undefined,
        enabled: true,
      });
      inserted.laneZones++;
    }
    // ── Rate matrices + zone legends (Tier 2 native matrix pricing) ────
    const { cells, zones } = normalizeDraftMatrices(draft.rateMatrices ?? []);
    for (const z of zones) {
      await tx.insert(rateZones).values({
        tenantId,
        zoneId: z.zoneId,
        matchKind: z.matchKind,
        matchValue: z.matchValue ?? undefined,
        matchFrom: z.matchFrom ?? undefined,
        matchTo: z.matchTo ?? undefined,
        label: z.label ?? undefined,
        enabled: true,
      });
      inserted.rateZones++;
    }
    for (const c of cells) {
      await tx.insert(rateMatrices).values({
        tenantId,
        mode: c.mode,
        equipment: c.equipment ?? undefined,
        originKey: c.originKey,
        destKey: c.destKey,
        rate: c.rate,
        unitBasis: c.unitBasis,
        minCharge: c.minCharge ?? undefined,
        currency: c.currency ?? undefined,
        effectiveDate: c.effectiveDate ?? undefined,
        sourceRef: c.sourceRef ?? undefined,
        enabled: true,
      });
      inserted.rateMatrices++;
    }
    await tx
      .update(ingestJobs)
      .set({ status: 'applied', appliedAt: new Date(), updatedAt: new Date() })
      .where(eq(ingestJobs.id, jobId));
  });

  void syncTenantToMarketplace(tenantId);
  return inserted;
}

/**
 * Map a parsed-but-unsaved ingest draft to the shapes `calculate()` expects.
 *
 * The draft rows are loose (the AI parser emits partial records); we stamp the
 * columns the engine reads with the same coercion/defaults the apply path uses,
 * so the preview quote is faithful to what applying WOULD produce. Nothing here
 * touches the database.
 */
export function draftToEngineConfig(draft: {
  rateCards?: Array<Record<string, unknown>>;
  accessorials?: Array<Record<string, unknown>>;
  laneZones?: Array<Record<string, unknown>>;
  rateMatrices?: Array<Record<string, unknown>>;
}): {
  cards: RateCard[];
  accs: Accessorial[];
  zones: LaneZone[];
  matrices: MatrixCellInput[];
  matrixZones: ZoneDefInput[];
} {
  const cards = (draft.rateCards ?? []).map((c, i) => {
    const n = normalizeDraftRateCard(c);
    return {
      id: -(i + 1),
      tenantId: -1,
      service: n.service,
      equipment: n.equipment,
      label: n.label,
      ratePerMile: n.ratePerMile,
      minimumCharge: n.minimumCharge,
      flatFee: n.flatFee,
      fuelSurchargePct: n.fuelSurchargePct,
      marginPct: n.marginPct,
      // Mirror the apply path: the preview/auto-check now sees the SAME ceilings
      // and LTL config that applying would persist, so "test your rates" is faithful.
      maxWeightLbs: n.maxWeightLbs,
      maxMiles: n.maxMiles,
      ltlConfig: n.ltlConfig,
      enabled: true,
      sortOrder: 0,
      notes: null,
      lastAiEditAt: null,
      lastAiEditReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }) as unknown as RateCard[];

  const accs = (draft.accessorials ?? []).map((a, i) => {
    const n = normalizeDraftAccessorial(a);
    return {
      id: -(i + 1),
      tenantId: -1,
      code: n.code,
      label: n.label,
      description: null,
      kind: n.kind,
      amount: n.amount,
      // Mirror the apply path: the extractor's trigger + conditionJson drive the
      // preview exactly as the persisted rows will (auto-trigger + free-time).
      trigger: n.trigger,
      conditionJson: n.conditionJson,
      appliesToServices: n.appliesToServices,
      enabled: true,
      sortOrder: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }) as unknown as Accessorial[];

  const zones = (draft.laneZones ?? []).map((z, i) => ({
    id: -(i + 1),
    tenantId: -1,
    label: String(z.label ?? 'Imported zone'),
    anchorPortCode: z.anchorPortCode != null ? String(z.anchorPortCode) : null,
    anchorCity: z.anchorCity != null ? String(z.anchorCity) : null,
    anchorState: z.anchorState != null ? String(z.anchorState) : null,
    radiusMiles: Number(z.radiusMiles ?? 0),
    flatPrice: Number(z.flatPrice ?? 0),
    equipmentScope: Array.isArray(z.equipmentScope) ? (z.equipmentScope as string[]) : null,
    enabled: true,
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  })) as unknown as LaneZone[];

  // Native matrix pricing: flatten the draft blocks into engine-shaped cells +
  // zone-resolution rules, exactly as apply persists them, so preview/autocheck
  // price via the matrix identically to what applying would produce.
  const { cells: normCells, zones: normZones } = normalizeDraftMatrices(draft.rateMatrices ?? []);
  const matrices: MatrixCellInput[] = normCells.map((c, i) => ({
    id: -(i + 1),
    mode: c.mode,
    equipment: c.equipment,
    originKey: c.originKey,
    destKey: c.destKey,
    rate: c.rate,
    unitBasis: c.unitBasis,
    minCharge: c.minCharge,
    currency: c.currency,
    enabled: true,
  }));
  const matrixZones: ZoneDefInput[] = normZones.map((z) => ({
    zoneId: z.zoneId,
    matchKind: z.matchKind,
    matchValue: z.matchValue,
    matchFrom: z.matchFrom,
    matchTo: z.matchTo,
    enabled: true,
  }));

  return { cards, accs, zones, matrices, matrixZones };
}

/**
 * System auto-verification for a parsed draft.
 *
 * Reliability comes from the SYSTEM, not the owner's manual labor: when a parse
 * finishes, we quote a small SPREAD of representative sample lanes (short /
 * medium / long per parsed service, plus each lane-zone anchor) against the
 * not-yet-applied draft using the SAME pure engine the live widget uses. No DB
 * writes. The owner sees a calm "we checked N lanes — all clean" summary, and a
 * genuine problem (a lane that won't price, or prices at $0) is surfaced BEFORE
 * apply — without the owner testing anything by hand.
 */
export interface AutoCheckSampleResult {
  label: string;
  service: string;
  ok: boolean;
  total?: number;
  reason?: string;
}
export interface AutoCheckSummary {
  total: number;
  clean: number;
  flaggedCount: number;
  flagged: Array<{ label: string; reason: string }>;
  samples: AutoCheckSampleResult[];
}

interface AutoSample { label: string; request: CalcRequest }

// Well-known lanes with pre-set mileage, so auto-check needs NO geocoding /
// network — it exercises the pricing math only, deterministically.
const REP_LANES = [
  { miles: 18, label: 'Long Beach → Carson, CA', pu: { city: 'Long Beach', state: 'CA' }, de: { city: 'Carson', state: 'CA' } },
  { miles: 275, label: 'Los Angeles, CA → Las Vegas, NV', pu: { city: 'Los Angeles', state: 'CA' }, de: { city: 'Las Vegas', state: 'NV' } },
  { miles: 1015, label: 'Dallas, TX → Chicago, IL', pu: { city: 'Dallas', state: 'TX' }, de: { city: 'Chicago', state: 'IL' } },
];

/** A representative shipment ZIP that resolves to a named matrix zone, so an
 *  auto-check probe of a zone-keyed matrix cell actually matches. */
function zoneRepresentativeZip(zoneId: string, zones: ZoneDefInput[]): string | undefined {
  const z = zones.find((r) => r.enabled !== false && r.zoneId === zoneId);
  if (!z) return undefined;
  if (z.matchKind === 'zip5' && z.matchValue) return String(z.matchValue);
  if (z.matchKind === 'zip3' && z.matchValue) return `${String(z.matchValue)}01`;
  if (z.matchKind === 'zip_range' && z.matchFrom) {
    const d = String(z.matchFrom).replace(/\D/g, '');
    return d.length <= 3 ? `${d.padStart(3, '0').slice(0, 3)}01` : d.padStart(5, '0').slice(0, 5);
  }
  return undefined;
}

/** Turn a matrix key into the pickup/delivery location a probe needs: a literal
 *  zip when numeric, else a representative zip resolved from the zone legend. */
function matrixKeyToZip(key: string, zones: ZoneDefInput[]): string | undefined {
  if (/^\d{3,5}$/.test(key)) return key.length === 3 ? `${key}01` : key.padStart(5, '0').slice(0, 5);
  return zoneRepresentativeZip(key, zones);
}

export function buildAutoCheckSamples(
  cards: RateCard[],
  zones: LaneZone[],
  matrices: MatrixCellInput[] = [],
  matrixZones: ZoneDefInput[] = [],
): AutoSample[] {
  const samples: AutoSample[] = [];

  // One probe per matrix cell (up to 3) so a native matrix lane is verified to
  // price through the engine, not just approximated.
  for (const cell of matrices.slice(0, 3)) {
    const puZip = matrixKeyToZip(cell.originKey, matrixZones);
    const deZip = matrixKeyToZip(cell.destKey, matrixZones);
    if (!puZip || !deZip) continue;
    samples.push({
      label: `${String(cell.mode).toUpperCase()} matrix ${cell.originKey} → ${cell.destKey}`,
      request: {
        service: cell.mode,
        equipment: cell.equipment ?? cards.find((c) => c.service === cell.mode)?.equipment ?? 'dryvan',
        miles: 500,
        pickupZip: puZip,
        deliveryZip: deZip,
        pickupCountry: 'US',
        deliveryCountry: 'US',
      },
    });
  }

  // One flat-tariff probe per lane zone (drayage short-haul within radius).
  for (const z of zones.slice(0, 2)) {
    const equipment = z.equipmentScope?.[0] ?? cards.find((c) => c.service === 'drayage')?.equipment ?? 'container_40';
    const miles = Math.max(1, Math.floor((z.radiusMiles || 20) / 2));
    const anchor = z.anchorPortCode ?? z.anchorCity ?? 'zone';
    samples.push({
      label: `${anchor} drayage (${miles} mi zone)`,
      request: {
        service: 'drayage',
        equipment,
        miles,
        pickupPortCode: z.anchorPortCode ?? undefined,
        pickupCity: z.anchorCity ?? undefined,
        pickupState: z.anchorState ?? undefined,
      },
    });
  }

  // Short / medium / long lane per parsed service.
  const services: string[] = [];
  for (const c of cards) if (c.enabled && services.indexOf(c.service) < 0) services.push(c.service);
  for (const service of services) {
    const equipment = cards.find((c) => c.service === service)?.equipment ?? 'dryvan';
    for (const lane of REP_LANES) {
      const request: CalcRequest = {
        service,
        equipment,
        miles: lane.miles,
        pickupCity: lane.pu.city,
        pickupState: lane.pu.state,
        pickupCountry: 'US',
        deliveryCity: lane.de.city,
        deliveryState: lane.de.state,
        deliveryCountry: 'US',
      };
      // LTL prices on class/weight, not distance — give it a realistic shipment
      // so the probe reflects a true quote rather than a bare minimum.
      if (service === 'ltl') {
        request.weightLbs = 8000;
        request.lengthIn = 48; request.widthIn = 40; request.heightIn = 48;
      }
      samples.push({ label: `${service.toUpperCase()} · ${lane.label}`, request });
    }
  }

  return samples.slice(0, 10);
}

export function runDraftAutoCheck(draft: {
  rateCards?: Array<Record<string, unknown>>;
  accessorials?: Array<Record<string, unknown>>;
  laneZones?: Array<Record<string, unknown>>;
  rateMatrices?: Array<Record<string, unknown>>;
}): AutoCheckSummary {
  const { cards, accs, zones, matrices, matrixZones } = draftToEngineConfig(draft);
  const samples = buildAutoCheckSamples(cards, zones, matrices, matrixZones);
  const results: AutoCheckSampleResult[] = samples.map((s) => {
    // No tenant in scope here — this is a pure sanity check over a parsed
    // draft (does each service price above $0?), and the currency label is
    // never surfaced from these results. Engine defaults to USD; that is a
    // label on a throwaway probe, not a converted amount.
    const r = calculate(cards, accs, zones, s.request, [], undefined, matrices, matrixZones);
    if (r.unsupported) {
      return { label: s.label, service: s.request.service, ok: false, reason: r.unsupported.reason };
    }
    if (!(r.total > 0)) {
      return { label: s.label, service: s.request.service, ok: false, reason: 'Priced at $0 — check the imported rate for this service.' };
    }
    return { label: s.label, service: s.request.service, ok: true, total: r.total };
  });
  const flagged = results.filter((r) => !r.ok);
  return {
    total: results.length,
    clean: results.length - flagged.length,
    flaggedCount: flagged.length,
    flagged: flagged.map((f) => ({ label: f.label, reason: f.reason || 'Could not price this lane.' })),
    samples: results,
  };
}

async function runParse(
  jobId: number,
  tenantId: number,
  filename: string,
  mimeType: string,
  dataBase64: string
) {
  try {
    const result = await parseRateSheet({ tenantId, filename, mimeType, dataBase64 });
    await db()
      .update(ingestJobs)
      .set({
        status: 'ready_for_review',
        parsedJson: result.parsed as unknown as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(ingestJobs.id, jobId));
  } catch (err) {
    const message =
      err instanceof IngestUnsupportedError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    await db()
      .update(ingestJobs)
      .set({ status: 'failed', errorMessage: message, updatedAt: new Date() })
      .where(eq(ingestJobs.id, jobId));
  }
}
