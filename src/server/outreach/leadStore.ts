/**
 * Broker-lead persistence — the ONLY module that reads/writes `broker_leads`.
 *
 * `broker_leads` is the FMCSA property-broker prospect list (populated by
 * scripts/ingestFmcsaCensus.ts). Like prospectDemoStore, this store is
 * deliberately narrow and NEVER touches tenants / users / the tenant-scoped
 * `leads` table — that isolation is what keeps an outreach prospect out of MRR,
 * trials, and every tenant list (by construction, per src/db/schema.ts).
 *
 * Callers depend on the `LeadStore` interface, not this concrete impl, so tests
 * inject a fake store and stay fully DB-free.
 */
import { eq, desc } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { brokerLeads, type BrokerLead } from '../../db/schema.js';

/** Fields the ingest supplies per broker. `mcNumber` is the dedupe key. */
export interface UpsertLeadInput {
  mcNumber: string | null;
  dotNumber: string | null;
  legalName: string;
  dbaName?: string | null;
  phone?: string | null;
  addrStreet?: string | null;
  addrCity?: string | null;
  addrState?: string | null;
  addrZip?: string | null;
  censusEmail?: string | null;
  powerUnits?: number | null;
  segment?: string;
}

/** Partial patch applied alongside a status change (e.g. link a demo/email). */
export interface LeadStatusPatch {
  demoToken?: string | null;
  outreachEmailId?: number | null;
  resolvedDomain?: string | null;
  resolvedEmail?: string | null;
  emailSource?: string | null;
  emailVerified?: boolean;
}

export interface LeadStore {
  /** Dedupe by mcNumber: update the existing row or insert a new one. Rows with
   *  a null mcNumber are always inserted (no dedupe key). */
  upsert(input: UpsertLeadInput): Promise<BrokerLead>;
  getById(id: number): Promise<BrokerLead | null>;
  getByStatus(status: string, limit?: number): Promise<BrokerLead[]>;
  list(limit?: number): Promise<BrokerLead[]>;
  updateStatus(id: number, status: string, patch?: LeadStatusPatch): Promise<void>;
  /** Map of status → count, for the ingest summary + an admin dashboard. */
  countByStatus(): Promise<Record<string, number>>;
}

const DEFAULT_LIMIT = 100;

/** Normalize the upsert payload → the columns we persist (drops undefined). */
function toValues(input: UpsertLeadInput) {
  return {
    mcNumber: input.mcNumber,
    dotNumber: input.dotNumber ?? null,
    legalName: input.legalName,
    dbaName: input.dbaName ?? null,
    phone: input.phone ?? null,
    addrStreet: input.addrStreet ?? null,
    addrCity: input.addrCity ?? null,
    addrState: input.addrState ?? null,
    addrZip: input.addrZip ?? null,
    censusEmail: input.censusEmail ?? null,
    powerUnits: input.powerUnits ?? null,
    segment: input.segment ?? 'broker',
  };
}

export const dbLeadStore: LeadStore = {
  async upsert(input) {
    const values = toValues(input);
    // Rows without an MC number have no dedupe key → always insert.
    if (input.mcNumber) {
      const existing = await db()
        .select()
        .from(brokerLeads)
        .where(eq(brokerLeads.mcNumber, input.mcNumber))
        .limit(1);
      if (existing[0]) {
        const rows = await db()
          .update(brokerLeads)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(brokerLeads.id, existing[0].id))
          .returning();
        return rows[0];
      }
    }
    const rows = await db().insert(brokerLeads).values(values).returning();
    return rows[0];
  },

  async getById(id) {
    const rows = await db().select().from(brokerLeads).where(eq(brokerLeads.id, id)).limit(1);
    return rows[0] ?? null;
  },

  async getByStatus(status, limit = DEFAULT_LIMIT) {
    return db()
      .select()
      .from(brokerLeads)
      .where(eq(brokerLeads.status, status))
      .orderBy(desc(brokerLeads.id))
      .limit(limit);
  },

  async list(limit = DEFAULT_LIMIT) {
    return db().select().from(brokerLeads).orderBy(desc(brokerLeads.id)).limit(limit);
  },

  async updateStatus(id, status, patch) {
    await db()
      .update(brokerLeads)
      .set({ status, ...(patch ?? {}), updatedAt: new Date() })
      .where(eq(brokerLeads.id, id));
  },

  async countByStatus() {
    const rows = await db().select({ status: brokerLeads.status }).from(brokerLeads);
    const out: Record<string, number> = {};
    for (const r of rows) out[r.status] = (out[r.status] ?? 0) + 1;
    return out;
  },
};
