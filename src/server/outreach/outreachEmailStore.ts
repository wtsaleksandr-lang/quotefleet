/**
 * Outreach-email persistence — the ONLY module that reads/writes `outreach_emails`.
 *
 * Narrow by design: save a drafted email, look one up by its unsubscribe token,
 * and mark it suppressed when the recipient clicks unsubscribe. It NEVER touches
 * tenants / users / leads — the same isolation prospect_demos keeps.
 *
 * Routes depend on the `OutreachEmailStore` interface (not this concrete impl),
 * so tests inject a fake store and stay fully DB-free.
 */
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { outreachEmails, type OutreachEmail } from '../../db/schema.js';

/** Fields the drafter supplies when persisting a draft. */
export interface SaveOutreachEmailInput {
  demoToken: string | null;
  domain: string;
  recipientEmail: string | null;
  unsubscribeToken: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  aiGenerated: boolean;
}

export interface OutreachEmailStore {
  /** Persist a drafted email so Phase 3 can send the exact reviewed copy. */
  saveDraft(input: SaveOutreachEmailInput): Promise<OutreachEmail>;
  /** Look up a draft by its per-recipient unsubscribe token. */
  getByUnsubscribeToken(token: string): Promise<OutreachEmail | null>;
  /** Mark suppressed (opt-out). Returns true if a matching row was found. */
  suppressByToken(token: string): Promise<boolean>;
}

export const dbOutreachEmailStore: OutreachEmailStore = {
  async saveDraft(input) {
    const rows = await db()
      .insert(outreachEmails)
      .values({
        demoToken: input.demoToken,
        domain: input.domain,
        recipientEmail: input.recipientEmail,
        unsubscribeToken: input.unsubscribeToken,
        subject: input.subject,
        bodyHtml: input.bodyHtml,
        bodyText: input.bodyText,
        aiGenerated: input.aiGenerated,
      })
      .returning();
    return rows[0];
  },

  async getByUnsubscribeToken(token) {
    if (!token) return null;
    const rows = await db()
      .select()
      .from(outreachEmails)
      .where(eq(outreachEmails.unsubscribeToken, token))
      .limit(1);
    return rows[0] ?? null;
  },

  async suppressByToken(token) {
    if (!token) return false;
    const rows = await db()
      .update(outreachEmails)
      .set({ suppressed: true, suppressedAt: new Date(), updatedAt: new Date() })
      .where(eq(outreachEmails.unsubscribeToken, token))
      .returning({ id: outreachEmails.id });
    return rows.length > 0;
  },
};
