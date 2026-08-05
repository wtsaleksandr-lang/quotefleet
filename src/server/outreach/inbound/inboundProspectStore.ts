/**
 * Inbound-prospect persistence — the ONLY module that reads/writes
 * `inbound_prospects` (REVERSE OUTREACH, Phase 0).
 *
 * Narrow by design: harvest an inbound broker/carrier marketing email (dedupe by
 * its Message-ID), look one up, list the recent harvest, and advance its status
 * as the pipeline runs. Like prospectDemoStore / outreachEmailStore it NEVER
 * touches tenants / users / leads — that isolation keeps a harvested prospect out
 * of MRR, trials, quota, and every tenant list by construction.
 *
 * Routes/pollers depend on the `InboundProspectStore` interface (not this
 * concrete impl), so tests inject a fake store and stay fully DB-free.
 *
 * SHIPS INERT: nothing calls the poller yet — this store is scaffolding for a
 * later phase.
 */
import { desc, eq } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { inboundProspects, type ProspectInbound } from '../../../db/schema.js';

/** Fields the harvester supplies when recording an inbound email. */
export interface UpsertInboundProspectInput {
  harvestMailbox: string;
  fromEmail: string;
  fromDomain: string;
  /** RFC 5322 Message-ID — the dedupe key when present. */
  originalMessageId?: string | null;
  originalReferences?: string[] | null;
  originalSubject?: string | null;
  receivedAt?: Date | null;
  signatureJson?: Record<string, unknown> | null;
  classifyCategory?: string | null;
  /** Initial pipeline state; defaults to 'harvested' when omitted. */
  status?: string;
  demoToken?: string | null;
  outreachEmailId?: number | null;
}

/** Optional filters for a recent-first listing. */
export interface ListInboundProspectsOpts {
  status?: string;
  limit?: number;
}

/** Partial fields updatable alongside a status transition. */
export interface InboundProspectStatusPatch {
  classifyCategory?: string | null;
  demoToken?: string | null;
  outreachEmailId?: number | null;
}

export interface InboundProspectStore {
  /** Record a harvested inbound. Dedupe by `originalMessageId` when present
   *  (update the existing row in place); otherwise insert a new row. */
  upsert(input: UpsertInboundProspectInput): Promise<ProspectInbound>;
  /** Look up by RFC 5322 Message-ID (idempotent-harvest check). */
  getByMessageId(messageId: string): Promise<ProspectInbound | null>;
  /** Look up by row id. */
  getById(id: number): Promise<ProspectInbound | null>;
  /** Recent-first listing, optionally filtered by status. */
  list(opts?: ListInboundProspectsOpts): Promise<ProspectInbound[]>;
  /** Advance the pipeline status, optionally patching related fields. */
  updateStatus(id: number, status: string, patch?: InboundProspectStatusPatch): Promise<void>;
}

export const dbInboundProspectStore: InboundProspectStore = {
  async upsert(input) {
    const messageId = input.originalMessageId ?? null;
    if (messageId) {
      const existing = await this.getByMessageId(messageId);
      if (existing) {
        const rows = await db()
          .update(inboundProspects)
          .set({
            harvestMailbox: input.harvestMailbox,
            fromEmail: input.fromEmail,
            fromDomain: input.fromDomain,
            originalReferences: input.originalReferences ?? null,
            originalSubject: input.originalSubject ?? null,
            receivedAt: input.receivedAt ?? null,
            signatureJson: input.signatureJson ?? null,
            ...(input.classifyCategory !== undefined ? { classifyCategory: input.classifyCategory } : {}),
            ...(input.status !== undefined ? { status: input.status } : {}),
            ...(input.demoToken !== undefined ? { demoToken: input.demoToken } : {}),
            ...(input.outreachEmailId !== undefined ? { outreachEmailId: input.outreachEmailId } : {}),
            updatedAt: new Date(),
          })
          .where(eq(inboundProspects.id, existing.id))
          .returning();
        return rows[0];
      }
    }
    const rows = await db()
      .insert(inboundProspects)
      .values({
        harvestMailbox: input.harvestMailbox,
        fromEmail: input.fromEmail,
        fromDomain: input.fromDomain,
        originalMessageId: messageId,
        originalReferences: input.originalReferences ?? null,
        originalSubject: input.originalSubject ?? null,
        receivedAt: input.receivedAt ?? null,
        signatureJson: input.signatureJson ?? null,
        classifyCategory: input.classifyCategory ?? null,
        ...(input.status !== undefined ? { status: input.status } : {}),
        demoToken: input.demoToken ?? null,
        outreachEmailId: input.outreachEmailId ?? null,
      })
      .returning();
    return rows[0];
  },

  async getByMessageId(messageId) {
    if (!messageId) return null;
    const rows = await db()
      .select()
      .from(inboundProspects)
      .where(eq(inboundProspects.originalMessageId, messageId))
      .limit(1);
    return rows[0] ?? null;
  },

  async getById(id) {
    if (!id) return null;
    const rows = await db()
      .select()
      .from(inboundProspects)
      .where(eq(inboundProspects.id, id))
      .limit(1);
    return rows[0] ?? null;
  },

  async list(opts) {
    const limit = opts?.limit ?? 100;
    const base = db().select().from(inboundProspects);
    const filtered = opts?.status
      ? base.where(eq(inboundProspects.status, opts.status))
      : base;
    return filtered.orderBy(desc(inboundProspects.createdAt)).limit(limit);
  },

  async updateStatus(id, status, patch) {
    if (!id) return;
    await db()
      .update(inboundProspects)
      .set({
        status,
        ...(patch?.classifyCategory !== undefined ? { classifyCategory: patch.classifyCategory } : {}),
        ...(patch?.demoToken !== undefined ? { demoToken: patch.demoToken } : {}),
        ...(patch?.outreachEmailId !== undefined ? { outreachEmailId: patch.outreachEmailId } : {}),
        updatedAt: new Date(),
      })
      .where(eq(inboundProspects.id, id));
  },
};
