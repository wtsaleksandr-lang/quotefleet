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
} from '../../db/schema.js';
import { requireAuth, requireTenant } from '../middleware.js';
import { parseRateSheet, IngestUnsupportedError } from '../../ai/ingestFile.js';
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

const ApplySchema = z.object({
  rateCards: z.array(z.record(z.string(), z.unknown())).optional(),
  accessorials: z.array(z.record(z.string(), z.unknown())).optional(),
  laneZones: z.array(z.record(z.string(), z.unknown())).optional(),
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
  app.post('/api/tenant/ingest', requireAuth, requireTenant, async (req: Request, res: Response) => {
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
      })
      .from(ingestJobs)
      .where(eq(ingestJobs.tenantId, req.tenant!.id))
      .orderBy(desc(ingestJobs.createdAt))
      .limit(50);
    return res.json({ jobs: rows });
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
      inserted = await applyDraftToTenant(tenantId, id, parse.data);
    } catch (err) {
      console.error('[ingest.apply] transaction failed:', err);
      return res.status(500).json({ error: 'Apply failed — nothing was changed. Try again.' });
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
    const { cards, accs, zones } = draftToEngineConfig(draft);

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
      // currency, so tag the preview with it. Nothing is converted.
      currency: currencyForCountry(req.tenant!.countryFocus),
    };

    // Manual-mode fuel (each draft card's own fuelSurchargePct) — the honest
    // preview of the imported numbers, no tenant auto-FSC overlay.
    const result = calculate(cards, accs, zones, calcReq);

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

/** Count of rows written by an apply. */
export interface ApplyResult {
  rateCards: number;
  accessorials: number;
  laneZones: number;
}

/** A parsed/edited draft in the loose shape the AI parser + apply path use. */
export interface IngestDraft {
  rateCards?: Array<Record<string, unknown>>;
  accessorials?: Array<Record<string, unknown>>;
  laneZones?: Array<Record<string, unknown>>;
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
  const inserted: ApplyResult = { rateCards: 0, accessorials: 0, laneZones: 0 };
  await db().transaction(async (tx) => {
    for (const c of draft.rateCards ?? []) {
      await tx.insert(rateCards).values({
        tenantId,
        service: String(c.service ?? 'ftl'),
        equipment: String(c.equipment ?? 'dryvan'),
        label: c.label != null ? String(c.label) : null,
        ratePerMile: Number(c.ratePerMile ?? 0),
        minimumCharge: Number(c.minimumCharge ?? 0),
        flatFee: Number(c.flatFee ?? 0),
        fuelSurchargePct: Number(c.fuelSurchargePct ?? 0),
        marginPct: Number(c.marginPct ?? 0),
        enabled: true,
        notes: 'Imported from rate-sheet ingest job #' + jobId,
        lastAiEditAt: new Date(),
        lastAiEditReason: 'rate-sheet ingest',
      });
      inserted.rateCards++;
    }
    for (const a of draft.accessorials ?? []) {
      await tx.insert(accessorials).values({
        tenantId,
        code: String(a.code ?? 'misc'),
        label: String(a.label ?? a.code ?? 'Accessorial'),
        kind: String(a.kind ?? 'flat'),
        amount: Number(a.amount ?? 0),
        trigger: 'optional',
        appliesToServices: Array.isArray(a.appliesToServices) ? (a.appliesToServices as string[]) : undefined,
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
}): { cards: RateCard[]; accs: Accessorial[]; zones: LaneZone[] } {
  const cards = (draft.rateCards ?? []).map((c, i) => ({
    id: -(i + 1),
    tenantId: -1,
    service: String(c.service ?? 'ftl'),
    equipment: String(c.equipment ?? 'dryvan'),
    label: c.label != null ? String(c.label) : null,
    ratePerMile: Number(c.ratePerMile ?? 0),
    minimumCharge: Number(c.minimumCharge ?? 0),
    flatFee: Number(c.flatFee ?? 0),
    fuelSurchargePct: Number(c.fuelSurchargePct ?? 0),
    marginPct: Number(c.marginPct ?? 0),
    maxWeightLbs: null,
    maxMiles: null,
    ltlConfig: null,
    enabled: true,
    sortOrder: 0,
    notes: null,
    lastAiEditAt: null,
    lastAiEditReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  })) as unknown as RateCard[];

  const accs = (draft.accessorials ?? []).map((a, i) => ({
    id: -(i + 1),
    tenantId: -1,
    code: String(a.code ?? 'misc'),
    label: String(a.label ?? a.code ?? 'Accessorial'),
    description: null,
    kind: String(a.kind ?? 'flat'),
    amount: Number(a.amount ?? 0),
    // Draft rows carry no trigger; apply defaults them to 'optional', so the
    // customer picks them by code in the test modal (same as the live widget).
    trigger: 'optional',
    conditionJson: null,
    appliesToServices: Array.isArray(a.appliesToServices) ? (a.appliesToServices as string[]) : null,
    enabled: true,
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  })) as unknown as Accessorial[];

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

  return { cards, accs, zones };
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

export function buildAutoCheckSamples(cards: RateCard[], zones: LaneZone[]): AutoSample[] {
  const samples: AutoSample[] = [];

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

  return samples.slice(0, 8);
}

export function runDraftAutoCheck(draft: {
  rateCards?: Array<Record<string, unknown>>;
  accessorials?: Array<Record<string, unknown>>;
  laneZones?: Array<Record<string, unknown>>;
}): AutoCheckSummary {
  const { cards, accs, zones } = draftToEngineConfig(draft);
  const samples = buildAutoCheckSamples(cards, zones);
  const results: AutoCheckSampleResult[] = samples.map((s) => {
    // No tenant in scope here — this is a pure sanity check over a parsed
    // draft (does each service price above $0?), and the currency label is
    // never surfaced from these results. Engine defaults to USD; that is a
    // label on a throwaway probe, not a converted amount.
    const r = calculate(cards, accs, zones, s.request);
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
