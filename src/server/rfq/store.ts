/**
 * RFQ persistence — the ONLY place the rfq_* tables are read/written.
 *
 * Injectable behind the `RfqStore` interface so the routes + tests use the same
 * seam: tests pass an in-memory store (no DB), production uses `dbRfqStore`.
 *
 * Opt-out reuses the DIRECTORY's own contact-suppression mechanism: it flips
 * carrier_directory.contact_hidden (the native "carrier asked us to hide their
 * contact" flag, which the FMCSA re-ingest never overwrites) AND upserts
 * carrier_overrides.hidden=true (the survive-the-ingest override layer). Both are
 * what the directory profile + the RFQ resolver already read to suppress a
 * carrier, so a single opt-out click suppresses this RFQ AND all future outreach.
 */
import { desc, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  rfqRequests,
  rfqRecipients,
  rfqQuotes,
  carrierDirectory,
  carrierOverrides,
  type RfqRequest,
  type RfqRecipient,
  type RfqQuote,
  type RfqRecipientStatus,
  type RfqFilterSnapshot,
} from '../../db/schema.js';
import { generateRfqToken } from './tokens.js';

export interface CreateRequestInput {
  shipperName: string;
  shipperCompany?: string | null;
  shipperEmail: string;
  shipperPhone?: string | null;
  origin: string;
  destination: string;
  equipment?: string | null;
  containerType?: string | null;
  commodity?: string | null;
  weight?: string | null;
  readyDate?: string | null;
  targetRate?: string | null;
  notes?: string | null;
  filterSnapshot?: RfqFilterSnapshot | null;
}

export interface CreateRecipientInput {
  carrierDot: string;
  carrierName: string;
  carrierEmail: string | null;
  status: RfqRecipientStatus;
  /** Per-carrier AI/template email draft, generated in the review phase. */
  draftSubject?: string | null;
  draftBody?: string | null;
}

export interface SubmitQuoteInput {
  price?: string | null;
  transitDays?: number | null;
  notes?: string | null;
  validUntil?: string | null;
}

/** A request with its recipients + any submitted quotes — the shipper view. */
export interface RfqView {
  request: RfqRequest;
  recipients: RfqRecipient[];
  quotes: RfqQuote[];
}

/** A carrier's quote page context — the recipient row + its parent request. */
export interface RecipientContext {
  recipient: RfqRecipient;
  request: RfqRequest;
  /** The quote already submitted by this carrier, if any. */
  quote: RfqQuote | null;
}

export interface RfqStore {
  createRequest(input: CreateRequestInput): Promise<RfqRequest>;
  addRecipients(rfqId: number, recipients: CreateRecipientInput[]): Promise<RfqRecipient[]>;
  markRecipientStatus(recipientId: number, status: RfqRecipientStatus, sentAt?: Date | null): Promise<void>;
  /** Persist a shipper-edited draft (subject + body) on a recipient row before send. */
  updateRecipientDraft(recipientId: number, draftSubject: string, draftBody: string): Promise<void>;
  getByViewToken(viewToken: string): Promise<RfqView | null>;
  getByQuoteToken(quoteToken: string): Promise<RecipientContext | null>;
  submitQuote(quoteToken: string, input: SubmitQuoteInput): Promise<boolean>;
  optOutByQuoteToken(quoteToken: string): Promise<{ ok: boolean; carrierDot?: string; carrierName?: string }>;
}

// ─── DB-backed implementation ──────────────────────────────────────────────
export const dbRfqStore: RfqStore = {
  async createRequest(input) {
    const rows = await db()
      .insert(rfqRequests)
      .values({
        viewToken: generateRfqToken(),
        shipperName: input.shipperName,
        shipperCompany: input.shipperCompany ?? null,
        shipperEmail: input.shipperEmail,
        shipperPhone: input.shipperPhone ?? null,
        origin: input.origin,
        destination: input.destination,
        equipment: input.equipment ?? null,
        containerType: input.containerType ?? null,
        commodity: input.commodity ?? null,
        weight: input.weight ?? null,
        readyDate: input.readyDate ?? null,
        targetRate: input.targetRate ?? null,
        notes: input.notes ?? null,
        filterSnapshot: input.filterSnapshot ?? null,
        status: 'open',
      })
      .returning();
    return rows[0];
  },

  async addRecipients(rfqId, recipients) {
    if (!recipients.length) return [];
    const rows = await db()
      .insert(rfqRecipients)
      .values(
        recipients.map((r) => ({
          rfqId,
          carrierDot: r.carrierDot,
          carrierName: r.carrierName,
          carrierEmail: r.carrierEmail,
          status: r.status,
          draftSubject: r.draftSubject ?? null,
          draftBody: r.draftBody ?? null,
          quoteToken: generateRfqToken(),
        })),
      )
      .returning();
    return rows;
  },

  async markRecipientStatus(recipientId, status, sentAt) {
    await db()
      .update(rfqRecipients)
      .set({ status, ...(sentAt !== undefined ? { sentAt } : {}) })
      .where(eq(rfqRecipients.id, recipientId));
  },

  async updateRecipientDraft(recipientId, draftSubject, draftBody) {
    await db()
      .update(rfqRecipients)
      .set({ draftSubject, draftBody })
      .where(eq(rfqRecipients.id, recipientId));
  },

  async getByViewToken(viewToken) {
    const reqRows = await db().select().from(rfqRequests).where(eq(rfqRequests.viewToken, viewToken)).limit(1);
    const request = reqRows[0];
    if (!request) return null;
    const [recipients, quotes] = await Promise.all([
      db().select().from(rfqRecipients).where(eq(rfqRecipients.rfqId, request.id)).orderBy(rfqRecipients.id),
      db().select().from(rfqQuotes).where(eq(rfqQuotes.rfqId, request.id)).orderBy(desc(rfqQuotes.createdAt)),
    ]);
    return { request, recipients, quotes };
  },

  async getByQuoteToken(quoteToken) {
    const recRows = await db().select().from(rfqRecipients).where(eq(rfqRecipients.quoteToken, quoteToken)).limit(1);
    const recipient = recRows[0];
    if (!recipient) return null;
    const [reqRows, quoteRows] = await Promise.all([
      db().select().from(rfqRequests).where(eq(rfqRequests.id, recipient.rfqId)).limit(1),
      db().select().from(rfqQuotes).where(eq(rfqQuotes.recipientId, recipient.id)).limit(1),
    ]);
    const request = reqRows[0];
    if (!request) return null;
    return { recipient, request, quote: quoteRows[0] ?? null };
  },

  async submitQuote(quoteToken, input) {
    const ctx = await this.getByQuoteToken(quoteToken);
    if (!ctx) return false;
    const { recipient } = ctx;
    // Opted-out carriers cannot submit (the page never links here for them, but
    // guard the write regardless).
    if (recipient.status === 'opted_out') return false;
    const values = {
      rfqId: recipient.rfqId,
      recipientId: recipient.id,
      carrierDot: recipient.carrierDot,
      price: input.price ?? null,
      transitDays: input.transitDays ?? null,
      notes: input.notes ?? null,
      validUntil: input.validUntil ?? null,
    };
    // One quote per recipient — re-submitting UPDATES the existing quote.
    await db()
      .insert(rfqQuotes)
      .values(values)
      .onConflictDoUpdate({
        target: rfqQuotes.recipientId,
        set: {
          price: values.price,
          transitDays: values.transitDays,
          notes: values.notes,
          validUntil: values.validUntil,
          createdAt: new Date(),
        },
      });
    await db().update(rfqRecipients).set({ status: 'quoted' }).where(eq(rfqRecipients.id, recipient.id));
    return true;
  },

  async optOutByQuoteToken(quoteToken) {
    const recRows = await db().select().from(rfqRecipients).where(eq(rfqRecipients.quoteToken, quoteToken)).limit(1);
    const recipient = recRows[0];
    if (!recipient) return { ok: false };
    // 1. Mark THIS recipient opted out (unless it already quoted — respect that).
    if (recipient.status !== 'quoted') {
      await db().update(rfqRecipients).set({ status: 'opted_out' }).where(eq(rfqRecipients.id, recipient.id));
    }
    // 2. Reuse the directory's contact-suppression mechanism so future outreach
    //    (directory profile display + the RFQ resolver) also suppresses this
    //    carrier: flip the native contact_hidden flag AND the survive-the-ingest
    //    override. Best-effort — an opt-out must confirm even if a heal fails.
    try {
      await db()
        .update(carrierDirectory)
        .set({ contactHidden: true, updatedAt: new Date() })
        .where(eq(carrierDirectory.usdot, recipient.carrierDot));
    } catch (err) {
      console.warn('[rfq] optout: contact_hidden update failed (non-fatal):', err);
    }
    try {
      await db()
        .insert(carrierOverrides)
        .values({ usdot: recipient.carrierDot, hidden: true, updatedBy: 'rfq-optout' })
        .onConflictDoUpdate({
          target: carrierOverrides.usdot,
          set: { hidden: true, updatedAt: new Date(), updatedBy: 'rfq-optout' },
        });
    } catch (err) {
      console.warn('[rfq] optout: carrier_overrides upsert failed (non-fatal):', err);
    }
    return { ok: true, carrierDot: recipient.carrierDot, carrierName: recipient.carrierName };
  },
};

