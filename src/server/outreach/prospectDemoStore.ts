/**
 * Prospect-demo persistence — the ONLY module that reads/writes `prospect_demos`.
 *
 * Deliberately narrow: get-by-token (public demo page), get-by-domain + upsert
 * (super-admin provisioner, dedupe by domain), and mark-viewed. It NEVER touches
 * tenants / users / leads — that isolation is what keeps a demo out of MRR,
 * trials, and every tenant list (by construction, per src/db/schema.ts).
 *
 * The routes depend on the `ProspectDemoStore` interface, not this concrete
 * impl, so tests inject a fake store and stay fully DB-free.
 */
import { eq, isNull, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../../db/client.js';
import { prospectDemos, type ProspectDemo } from '../../db/schema.js';
import type {
  ProspectDemoBrand,
  ProspectDemoConfig,
} from '../../db/schema.js';

/** Fields the provisioner supplies when creating/updating a demo. */
export interface UpsertProspectDemoInput {
  domain: string;
  companyName: string | null;
  profileJson: Record<string, unknown> | null;
  brandJson: ProspectDemoBrand | null;
  configJson: ProspectDemoConfig | null;
}

export interface ProspectDemoStore {
  getByToken(token: string): Promise<ProspectDemo | null>;
  getByDomain(domain: string): Promise<ProspectDemo | null>;
  /** Dedupe by domain: update the existing row (keeping its token) or insert a
   *  new one with a fresh unguessable token. */
  upsert(input: UpsertProspectDemoInput): Promise<ProspectDemo>;
  /** Stamp viewed_at on first public load (no-op if already viewed). */
  markViewed(token: string): Promise<void>;
}

/** Mint an unguessable, URL-safe demo token. */
export function newDemoToken(): string {
  return nanoid(20);
}

export const dbProspectDemoStore: ProspectDemoStore = {
  async getByToken(token) {
    if (!token) return null;
    const rows = await db().select().from(prospectDemos).where(eq(prospectDemos.token, token)).limit(1);
    return rows[0] ?? null;
  },

  async getByDomain(domain) {
    if (!domain) return null;
    const rows = await db().select().from(prospectDemos).where(eq(prospectDemos.domain, domain)).limit(1);
    return rows[0] ?? null;
  },

  async upsert(input) {
    const existing = await this.getByDomain(input.domain);
    if (existing) {
      const rows = await db()
        .update(prospectDemos)
        .set({
          companyName: input.companyName,
          profileJson: input.profileJson,
          brandJson: input.brandJson,
          configJson: input.configJson,
          updatedAt: new Date(),
        })
        .where(eq(prospectDemos.id, existing.id))
        .returning();
      return rows[0];
    }
    const rows = await db()
      .insert(prospectDemos)
      .values({
        token: newDemoToken(),
        domain: input.domain,
        companyName: input.companyName,
        profileJson: input.profileJson,
        brandJson: input.brandJson,
        configJson: input.configJson,
      })
      .returning();
    return rows[0];
  },

  async markViewed(token) {
    if (!token) return;
    await db()
      .update(prospectDemos)
      .set({ viewedAt: new Date() })
      .where(and(eq(prospectDemos.token, token), isNull(prospectDemos.viewedAt)));
  },
};
