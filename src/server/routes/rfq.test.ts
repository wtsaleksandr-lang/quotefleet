/**
 * Multi-carrier RFQ route tests — full flow over a real express server, but with
 * an in-memory store + injected resolver/sender/reingest (NO DB, NO network).
 *
 * Proves:
 *   - POST /directory/rfq creates the request + recipient rows, DRY-RUN by
 *     default (the sender is never called), and shows the shipper their
 *     responses link + counts;
 *   - live send actually calls the injected sender;
 *   - carrier quote submission flips the recipient to 'quoted' + stores the quote;
 *   - one-click opt-out flips the recipient to 'opted_out';
 *   - token guards: bad/absent tokens 404;
 *   - the reingest endpoint: 404 without the admin token, 202 (+ kick) with it;
 *   - the submit rate-limit eventually 429s.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { registerRfqRoutes, type RfqRouteDeps } from './rfq.js';
import { generateRfqToken } from '../rfq/tokens.js';
import type {
  RfqStore,
  CreateRequestInput,
  CreateRecipientInput,
  SubmitQuoteInput,
  RfqView,
  RecipientContext,
} from '../rfq/store.js';
import type { RfqRequest, RfqRecipient, RfqQuote, RfqRecipientStatus } from '../../db/schema.js';
import type { ResolveDeps, CarrierLite } from '../rfq/resolve.js';
import type { EmailOut } from '../../email/send.js';

// The live-send path calls brandedFrom() → loadEnv(), which requires
// DATABASE_URL; satisfy it with a dummy so the live send test doesn't throw.
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test/test';

// ─── In-memory RfqStore ────────────────────────────────────────────────────
class MemStore implements RfqStore {
  requests: RfqRequest[] = [];
  recipients: RfqRecipient[] = [];
  quotes: RfqQuote[] = [];
  private seq = 1;

  async createRequest(input: CreateRequestInput): Promise<RfqRequest> {
    const row: RfqRequest = {
      id: this.seq++,
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
      createdAt: new Date(),
    };
    this.requests.push(row);
    return row;
  }

  async addRecipients(rfqId: number, recipients: CreateRecipientInput[]): Promise<RfqRecipient[]> {
    const rows = recipients.map((r) => ({
      id: this.seq++,
      rfqId,
      carrierDot: r.carrierDot,
      carrierName: r.carrierName,
      carrierEmail: r.carrierEmail,
      status: r.status,
      quoteToken: generateRfqToken(),
      sentAt: null,
      createdAt: new Date(),
    })) as RfqRecipient[];
    this.recipients.push(...rows);
    return rows;
  }

  async markRecipientStatus(id: number, status: RfqRecipientStatus, sentAt?: Date | null): Promise<void> {
    const r = this.recipients.find((x) => x.id === id);
    if (r) {
      r.status = status;
      if (sentAt !== undefined) r.sentAt = sentAt;
    }
  }

  async getByViewToken(viewToken: string): Promise<RfqView | null> {
    const request = this.requests.find((r) => r.viewToken === viewToken);
    if (!request) return null;
    return {
      request,
      recipients: this.recipients.filter((r) => r.rfqId === request.id),
      quotes: this.quotes.filter((q) => q.rfqId === request.id),
    };
  }

  async getByQuoteToken(quoteToken: string): Promise<RecipientContext | null> {
    const recipient = this.recipients.find((r) => r.quoteToken === quoteToken);
    if (!recipient) return null;
    const request = this.requests.find((r) => r.id === recipient.rfqId);
    if (!request) return null;
    return { recipient, request, quote: this.quotes.find((q) => q.recipientId === recipient.id) ?? null };
  }

  async submitQuote(quoteToken: string, input: SubmitQuoteInput): Promise<boolean> {
    const ctx = await this.getByQuoteToken(quoteToken);
    if (!ctx || ctx.recipient.status === 'opted_out') return false;
    const existing = this.quotes.find((q) => q.recipientId === ctx.recipient.id);
    if (existing) {
      Object.assign(existing, input);
    } else {
      this.quotes.push({
        id: this.seq++,
        rfqId: ctx.recipient.rfqId,
        recipientId: ctx.recipient.id,
        carrierDot: ctx.recipient.carrierDot,
        price: input.price ?? null,
        transitDays: input.transitDays ?? null,
        notes: input.notes ?? null,
        validUntil: input.validUntil ?? null,
        createdAt: new Date(),
      } as RfqQuote);
    }
    ctx.recipient.status = 'quoted';
    return true;
  }

  async optOutByQuoteToken(quoteToken: string): Promise<{ ok: boolean; carrierDot?: string; carrierName?: string }> {
    const recipient = this.recipients.find((r) => r.quoteToken === quoteToken);
    if (!recipient) return { ok: false };
    if (recipient.status !== 'quoted') recipient.status = 'opted_out';
    return { ok: true, carrierDot: recipient.carrierDot, carrierName: recipient.carrierName };
  }
}

const carrier = (over: Partial<CarrierLite> = {}): CarrierLite => ({
  usdot: '100',
  name: 'Acme Freight',
  email: 'ops@acme.example',
  contactHidden: false,
  ...over,
});

/** ResolveDeps that hand back a fixed carrier set for the dots path. */
function fixedResolveDeps(carriers: CarrierLite[]): ResolveDeps {
  return {
    listByFilters: async () => ({ carriers, total: carriers.length }),
    listByDots: async () => carriers,
    optedOutDots: async () => new Set<string>(),
    isEmailSuppressed: async () => false,
  };
}

interface Harness {
  server: Server;
  baseUrl: string;
  store: MemStore;
  send: ReturnType<typeof vi.fn>;
  forceReingest: ReturnType<typeof vi.fn>;
}

async function boot(over: Partial<RfqRouteDeps> = {}): Promise<Harness> {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  const store = new MemStore();
  const send = vi.fn(async (): Promise<EmailOut> => ({ ok: true, provider: 'resend', id: 'msg_1' }));
  const forceReingest = vi.fn(async () => 'started' as const);
  registerRfqRoutes(app, {
    store,
    resolveDeps: fixedResolveDeps([carrier({ usdot: '1', email: 'a@x.example' }), carrier({ usdot: '2', email: 'b@x.example' }), carrier({ usdot: '3', email: null })]),
    isEmailSuppressed: async () => false,
    send,
    liveSend: false,
    baseUrl: 'https://test.local',
    throttleMs: 0,
    forceReingest,
    ...over,
  });
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${port}`, store, send, forceReingest };
}

const form = (fields: Record<string, string>) =>
  new URLSearchParams(fields).toString();

const postForm = (baseUrl: string, path: string, fields: Record<string, string>) =>
  fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form(fields),
  });

const validShipper = {
  origin: 'Los Angeles, CA',
  destination: 'Dallas, TX',
  shipper_name: 'Dana Shipper',
  shipper_email: 'dana@shipper.example',
};

describe('RFQ routes', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await boot();
  });
  afterAll(() => {
    h.server.close();
  });

  it('GET /directory/rfq renders the form with the recipient count', async () => {
    const r = await fetch(`${h.baseUrl}/directory/rfq?dots=1,2,3`);
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain('Requesting rates from');
    expect(html).toContain('3'); // 3 carriers resolved
  });

  it('GET /directory/rfq with no selection redirects to /directory', async () => {
    const r = await fetch(`${h.baseUrl}/directory/rfq`, { redirect: 'manual' });
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/directory');
  });

  it('POST /directory/rfq creates request + recipients, DRY-RUN (no send), shows link', async () => {
    const r = await postForm(h.baseUrl, '/directory/rfq', { ...validShipper, dots: '1,2,3' });
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain('responses link');
    expect(html).toContain('https://test.local/directory/rfq/');
    // DRY-RUN: sender NEVER called.
    expect(h.send).not.toHaveBeenCalled();
    // One request + three recipients created.
    expect(h.store.requests).toHaveLength(1);
    expect(h.store.recipients).toHaveLength(3);
    const statuses = h.store.recipients.map((x) => x.status).sort();
    // 2 pending → sent (dry-run), 1 no_email.
    expect(statuses).toEqual(['no_email', 'sent', 'sent']);
  });

  it('POST validation: bad email re-renders the form with an error (no rows)', async () => {
    const before = h.store.requests.length;
    const r = await postForm(h.baseUrl, '/directory/rfq', {
      ...validShipper,
      shipper_email: 'not-an-email',
      dots: '1,2,3',
    });
    expect(r.status).toBe(400);
    expect(await r.text()).toContain('valid email');
    expect(h.store.requests).toHaveLength(before);
  });

  it('live send calls the injected sender for pending recipients', async () => {
    const h2 = await boot({ liveSend: true });
    const r = await postForm(h2.baseUrl, '/directory/rfq', { ...validShipper, dots: '1,2,3' });
    expect(r.status).toBe(200);
    // 2 pending recipients (the 3rd has no email) → 2 sends.
    expect(h2.send).toHaveBeenCalledTimes(2);
    h2.server.close();
  });

  it('carrier quote submission flips the recipient to quoted + stores the quote', async () => {
    const req = await h.store.createRequest({ ...toCreate(validShipper) });
    const [rec] = await h.store.addRecipients(req.id, [
      { carrierDot: '1', carrierName: 'Acme', carrierEmail: 'a@x.example', status: 'sent' },
    ]);
    // GET the quote page.
    const g = await fetch(`${h.baseUrl}/directory/rfq/quote/${rec.quoteToken}`);
    expect(g.status).toBe(200);
    expect(await g.text()).toContain('Los Angeles, CA');
    // POST the quote.
    const p = await postForm(h.baseUrl, `/directory/rfq/quote/${rec.quoteToken}`, {
      price: '$2,400',
      transit_days: '3',
      valid_until: '2026-09-15',
      notes: 'Reefer, appt required',
    });
    expect(p.status).toBe(200);
    expect(await p.text()).toContain('your quote is in');
    const updated = h.store.recipients.find((x) => x.id === rec.id);
    expect(updated?.status).toBe('quoted');
    const q = h.store.quotes.find((x) => x.recipientId === rec.id);
    expect(q?.price).toBe('$2,400');
    expect(q?.transitDays).toBe(3);
  });

  it('quote POST without a price re-renders with an error', async () => {
    const req = await h.store.createRequest({ ...toCreate(validShipper) });
    const [rec] = await h.store.addRecipients(req.id, [
      { carrierDot: '9', carrierName: 'NoPrice', carrierEmail: 'n@x.example', status: 'sent' },
    ]);
    const p = await postForm(h.baseUrl, `/directory/rfq/quote/${rec.quoteToken}`, { price: '' });
    expect(p.status).toBe(400);
    expect(await p.text()).toContain('all-in rate');
  });

  it('one-click opt-out flips the recipient to opted_out', async () => {
    const req = await h.store.createRequest({ ...toCreate(validShipper) });
    const [rec] = await h.store.addRecipients(req.id, [
      { carrierDot: '7', carrierName: 'OptMe', carrierEmail: 'o@x.example', status: 'sent' },
    ]);
    const r = await fetch(`${h.baseUrl}/directory/rfq/optout/${rec.quoteToken}`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("You're opted out");
    expect(h.store.recipients.find((x) => x.id === rec.id)?.status).toBe('opted_out');
    // The quote page for an opted-out recipient shows the opt-out confirmation.
    const g = await fetch(`${h.baseUrl}/directory/rfq/quote/${rec.quoteToken}`);
    expect(await g.text()).toContain('opted out');
  });

  it('shipper view renders the recipients + quotes table', async () => {
    const req = await h.store.createRequest({ ...toCreate(validShipper) });
    await h.store.addRecipients(req.id, [
      { carrierDot: '1', carrierName: 'Acme', carrierEmail: 'a@x.example', status: 'sent' },
    ]);
    const r = await fetch(`${h.baseUrl}/directory/rfq/${req.viewToken}`);
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain('Acme');
    expect(html).toContain('Carriers');
  });

  it('token guards: malformed + unknown tokens 404', async () => {
    expect((await fetch(`${h.baseUrl}/directory/rfq/quote/NOT_A_TOKEN`)).status).toBe(404);
    expect((await fetch(`${h.baseUrl}/directory/rfq/quote/${generateRfqToken()}`)).status).toBe(404);
    expect((await fetch(`${h.baseUrl}/directory/rfq/${generateRfqToken()}`)).status).toBe(404);
    expect((await fetch(`${h.baseUrl}/directory/rfq/optout/short`)).status).toBe(404);
  });
});

describe('RFQ reingest endpoint guard', () => {
  const ORIGINAL = process.env.INGEST_ADMIN_TOKEN;
  afterAll(() => {
    if (ORIGINAL === undefined) delete process.env.INGEST_ADMIN_TOKEN;
    else process.env.INGEST_ADMIN_TOKEN = ORIGINAL;
  });

  it('404 when the admin token is unset (hides the endpoint)', async () => {
    delete process.env.INGEST_ADMIN_TOKEN;
    const h = await boot();
    const r = await fetch(`${h.baseUrl}/api/public/directory/reingest`, {
      method: 'POST',
      headers: { 'x-ingest-token': 'anything' },
    });
    expect(r.status).toBe(404);
    expect(h.forceReingest).not.toHaveBeenCalled();
    h.server.close();
  });

  it('404 on a wrong / missing token', async () => {
    process.env.INGEST_ADMIN_TOKEN = 'secret-admin-token';
    const h = await boot();
    expect(
      (await fetch(`${h.baseUrl}/api/public/directory/reingest`, { method: 'POST' })).status,
    ).toBe(404);
    expect(
      (
        await fetch(`${h.baseUrl}/api/public/directory/reingest`, {
          method: 'POST',
          headers: { 'x-ingest-token': 'wrong' },
        })
      ).status,
    ).toBe(404);
    expect(h.forceReingest).not.toHaveBeenCalled();
    h.server.close();
  });

  it('202 + kicks the re-ingest on the correct token', async () => {
    process.env.INGEST_ADMIN_TOKEN = 'secret-admin-token';
    const h = await boot();
    const r = await fetch(`${h.baseUrl}/api/public/directory/reingest`, {
      method: 'POST',
      headers: { 'x-ingest-token': 'secret-admin-token' },
    });
    expect(r.status).toBe(202);
    expect(await r.json()).toEqual({ status: 'started' });
    expect(h.forceReingest).toHaveBeenCalledTimes(1);
    h.server.close();
  });
});

describe('RFQ submit rate-limit', () => {
  it('eventually 429s a hammering client', async () => {
    const h = await boot();
    let saw429 = false;
    let sawOk = false;
    for (let i = 0; i < 20; i++) {
      const r = await postForm(h.baseUrl, '/directory/rfq', { ...validShipper, dots: '1,2,3' });
      if (r.status === 429) saw429 = true;
      else if (r.status === 200) sawOk = true;
    }
    expect(sawOk).toBe(true);
    expect(saw429).toBe(true);
    h.server.close();
  });
});

/** Map the shipper form shape to a CreateRequestInput for direct store seeding. */
function toCreate(f: Record<string, string>): CreateRequestInput {
  return {
    shipperName: f.shipper_name,
    shipperEmail: f.shipper_email,
    origin: f.origin,
    destination: f.destination,
  };
}
