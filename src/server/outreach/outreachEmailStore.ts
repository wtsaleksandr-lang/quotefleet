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
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { outreachEmails, type OutreachEmail } from '../../db/schema.js';

/** Normalize an email address for suppression comparison (trim + lowercase). */
export function normalizeEmailAddress(email: string | null | undefined): string {
  return String(email ?? '').trim().toLowerCase();
}

/** The outcome fields Phase 3 records on a row after attempting a send. */
export interface RecordSendInput {
  status: 'sent' | 'failed' | 'skipped' | 'unconfigured';
  sentAt?: Date | null;
  providerId?: string | null;
  error?: string | null;
  step?: number;
}

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
  /** Look up a persisted draft by its row id (Phase 3 send-by-id). */
  getById(id: number): Promise<OutreachEmail | null>;
  /** Mark suppressed (opt-out). Returns true if a matching row was found. */
  suppressByToken(token: string): Promise<boolean>;
  /**
   * True if ANY prior outreach_emails row for this (normalized) recipient address
   * is suppressed — the address-level opt-out that Phase 3 honors before sending,
   * independent of which specific draft carries the unsubscribe token.
   */
  isRecipientSuppressed(email: string): Promise<boolean>;
  /** Record the outcome of a send attempt on a row (sent/failed/skipped/...). */
  recordSend(id: number, input: RecordSendInput): Promise<void>;
  /** Record the first CTA/demo-link click for a token (optional tracking). */
  markClickedByToken(token: string): Promise<OutreachEmail | null>;
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

  async getById(id) {
    if (!id) return null;
    const rows = await db()
      .select()
      .from(outreachEmails)
      .where(eq(outreachEmails.id, id))
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

  async isRecipientSuppressed(email) {
    const normalized = normalizeEmailAddress(email);
    if (!normalized) return false;
    const rows = await db()
      .select({ id: outreachEmails.id })
      .from(outreachEmails)
      .where(
        and(
          eq(outreachEmails.suppressed, true),
          eq(sql`lower(${outreachEmails.recipientEmail})`, normalized),
        ),
      )
      .limit(1);
    return rows.length > 0;
  },

  async recordSend(id, input) {
    if (!id) return;
    await db()
      .update(outreachEmails)
      .set({
        status: input.status,
        sentAt: input.sentAt ?? null,
        providerId: input.providerId ?? null,
        sendError: input.error ?? null,
        ...(input.step ? { step: input.step } : {}),
        updatedAt: new Date(),
      })
      .where(eq(outreachEmails.id, id));
  },

  async markClickedByToken(token) {
    if (!token) return null;
    // Only stamp the FIRST click (COALESCE keeps an existing timestamp).
    const rows = await db()
      .update(outreachEmails)
      .set({ clickedAt: sql`COALESCE(${outreachEmails.clickedAt}, now())`, updatedAt: new Date() })
      .where(eq(outreachEmails.unsubscribeToken, token))
      .returning();
    return rows[0] ?? null;
  },
};
