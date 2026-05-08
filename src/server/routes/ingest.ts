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
    const inserted = { rateCards: 0, accessorials: 0, laneZones: 0 };

    // Wrap every insert + the status flip in one transaction so a failure
    // halfway leaves the job in 'ready_for_review' (retryable) instead
    // of half-applied + marked done (which was the previous bug).
    try {
      await db().transaction(async (tx) => {
        for (const c of parse.data.rateCards ?? []) {
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
            notes: 'Imported from rate-sheet ingest job #' + id,
            lastAiEditAt: new Date(),
            lastAiEditReason: 'rate-sheet ingest',
          });
          inserted.rateCards++;
        }
        for (const a of parse.data.accessorials ?? []) {
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
        for (const z of parse.data.laneZones ?? []) {
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
          .where(eq(ingestJobs.id, id));
      });
    } catch (err) {
      console.error('[ingest.apply] transaction failed:', err);
      return res.status(500).json({ error: 'Apply failed — nothing was changed. Try again.' });
    }

    void syncTenantToMarketplace(tenantId);

    return res.json({ ok: true, inserted });
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
