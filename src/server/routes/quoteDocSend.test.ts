/**
 * Quote-document EMAIL SEND — behaviour + anti-abuse guards.
 *
 * The send endpoint (`POST /api/tenant/quote-doc/send/:refId`) emails the
 * carrier-branded quote document to the customer. The security-critical
 * properties, all asserted here:
 *
 *   (a) it sends ONLY to the customer email stored on the lead,
 *   (b) it can NEVER be pointed at an attacker-supplied recipient
 *       (the send fn takes no recipient arg; the route never reads req.body),
 *   (c) it is tenant-scoped — a refId not owned by the caller 404s,
 *   (d) it is deduped/rate-limited so it can't be used to spam an inbox,
 *   (e) it is authed (requireAuth + requireTenant) and platform-sender only.
 *
 * Behavioural tests drive `sendQuoteDocEmail` with a mocked db + sendEmail;
 * source-level assertions lock the route wiring in the repo's guard style.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────
const h = vi.hoisted(() => {
  const state = {
    leadRows: [] as Record<string, unknown>[],
    tenantRows: [] as Record<string, unknown>[],
    brandRows: [] as Record<string, unknown>[],
    auditRows: [] as Record<string, unknown>[],
    inserts: [] as Array<{ table: string; values: Record<string, unknown> }>,
  };
  type EmailOut = { ok: boolean; provider?: string; id?: string; error?: string; logged?: boolean };
  const sendEmailMock = vi.fn<(msg: Record<string, unknown>) => Promise<EmailOut>>(
    async () => ({ ok: true, provider: 'resend', id: 'em_1' })
  );
  return { state, sendEmailMock };
});

vi.mock('../../email/send.js', () => ({ sendEmail: h.sendEmailMock }));

vi.mock('../../db/client.js', async () => {
  const { getTableName } = await import('drizzle-orm');
  function rowsFor(table: unknown): Record<string, unknown>[] {
    const n = getTableName(table as never);
    if (n === 'leads') return h.state.leadRows;
    if (n === 'tenants') return h.state.tenantRows;
    if (n === 'brand_configs') return h.state.brandRows;
    if (n === 'audit_log') return h.state.auditRows;
    return [];
  }
  function makeSelect() {
    let table: unknown;
    const chain: Record<string, unknown> = {
      from(t: unknown) { table = t; return chain; },
      where() { return chain; },
      orderBy() { return chain; },
      limit() { return Promise.resolve(rowsFor(table)); },
      then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
        return Promise.resolve(rowsFor(table)).then(res, rej);
      },
    };
    return chain;
  }
  return {
    db: () => ({
      select: () => makeSelect(),
      insert: (t: unknown) => ({
        values: (v: Record<string, unknown>) => {
          h.state.inserts.push({ table: getTableName(t as never), values: v });
          return Promise.resolve();
        },
      }),
    }),
  };
});

const baseLead = () => ({
  id: 10,
  refId: 'QF-ABC123',
  tenantId: 1,
  customerEmail: 'customer@example.com',
  customerName: 'Pat Rivera',
  customerPhone: null,
  customerCompany: null,
  quotedTotal: 1200,
  quotedCurrency: 'USD',
  service: 'drayage',
  equipment: 'container_40',
  distanceMiles: 55,
  pickupCity: 'Los Angeles',
  pickupState: 'CA',
  pickupZip: null,
  deliveryCity: 'San Diego',
  deliveryState: 'CA',
  deliveryZip: null,
});

const baseTenant = () => ({
  id: 1,
  name: 'Acme Freight',
  status: 'active',
  publicContactEmail: 'ops@acme.com',
  contactPhone: '555-0100',
});

beforeEach(() => {
  h.state.leadRows = [baseLead()];
  h.state.tenantRows = [baseTenant()];
  h.state.brandRows = [];
  h.state.auditRows = [];
  h.state.inserts = [];
  h.sendEmailMock.mockClear();
  h.sendEmailMock.mockResolvedValue({ ok: true, provider: 'resend', id: 'em_1' });
  process.env.SESSION_SECRET ||= 'test'.repeat(16);
  process.env.DATABASE_URL ||= 'postgresql://x';
  process.env.ANTHROPIC_API_KEY ||= 'sk-test';
  process.env.PUBLIC_BASE_URL ||= 'https://quotefleet.net';
});

describe('sendQuoteDocEmail — recipient is always the stored customer email', () => {
  it('(a) sends only to the lead.customerEmail and 200s', async () => {
    const { sendQuoteDocEmail } = await import('./quoteDoc.js');
    const r = await sendQuoteDocEmail({ tenantId: 1, refId: 'QF-ABC123', userId: 7 });
    expect(r.status).toBe(200);
    expect(h.sendEmailMock).toHaveBeenCalledTimes(1);
    const arg = h.sendEmailMock.mock.calls[0][0] as { to: string; from?: string; listUnsubscribeUrl?: string };
    expect(arg.to).toBe('customer@example.com');
    expect(r.json.to).toBe('customer@example.com');
  });

  it('(a) uses the CUSTOMER email even when the lead also has other addresses; never a caller value', async () => {
    // The function signature accepts no recipient — the only address it can
    // reach is whatever is on the lead. Prove it tracks the lead field.
    h.state.leadRows = [{ ...baseLead(), customerEmail: 'real-customer@shipper.io' }];
    const { sendQuoteDocEmail } = await import('./quoteDoc.js');
    await sendQuoteDocEmail({ tenantId: 1, refId: 'QF-ABC123' });
    const arg = h.sendEmailMock.mock.calls[0][0] as { to: string };
    expect(arg.to).toBe('real-customer@shipper.io');
  });

  it('(e) sends transactional (no List-Unsubscribe) from the platform sender (no from override)', async () => {
    const { sendQuoteDocEmail } = await import('./quoteDoc.js');
    await sendQuoteDocEmail({ tenantId: 1, refId: 'QF-ABC123' });
    const arg = h.sendEmailMock.mock.calls[0][0] as { from?: string; listUnsubscribeUrl?: string; replyTo?: string };
    expect(arg.listUnsubscribeUrl).toBeUndefined();
    expect(arg.from).toBeUndefined(); // platform default sender
    expect(arg.replyTo).toBe('ops@acme.com'); // carrier's own opt-in inbox
  });
});

describe('sendQuoteDocEmail — no customer email is handled gracefully', () => {
  it('returns 400 no_customer_email and does not send', async () => {
    h.state.leadRows = [{ ...baseLead(), customerEmail: null }];
    const { sendQuoteDocEmail } = await import('./quoteDoc.js');
    const r = await sendQuoteDocEmail({ tenantId: 1, refId: 'QF-ABC123' });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('no_customer_email');
    expect(h.sendEmailMock).not.toHaveBeenCalled();
  });
});

describe('sendQuoteDocEmail — tenant scoping', () => {
  it('(c) 404s when the refId is not owned by the caller (lookup returns nothing)', async () => {
    h.state.leadRows = []; // tenant-scoped query found no matching lead
    const { sendQuoteDocEmail } = await import('./quoteDoc.js');
    const r = await sendQuoteDocEmail({ tenantId: 2, refId: 'QF-ABC123' });
    expect(r.status).toBe(404);
    expect(h.sendEmailMock).not.toHaveBeenCalled();
  });

  it('404s when the carrier tenant is not active', async () => {
    h.state.tenantRows = [{ ...baseTenant(), status: 'suspended' }];
    const { sendQuoteDocEmail } = await import('./quoteDoc.js');
    const r = await sendQuoteDocEmail({ tenantId: 1, refId: 'QF-ABC123' });
    expect(r.status).toBe(404);
    expect(h.sendEmailMock).not.toHaveBeenCalled();
  });
});

describe('sendQuoteDocEmail — dedupe / anti-spam', () => {
  it('(d) 429s a resend of the same quote within the cooldown window', async () => {
    h.state.auditRows = [
      { createdAt: new Date(), action: 'quote.doc_email_sent', detailsJson: { refId: 'QF-ABC123', leadId: 10 } },
    ];
    const { sendQuoteDocEmail } = await import('./quoteDoc.js');
    const r = await sendQuoteDocEmail({ tenantId: 1, refId: 'QF-ABC123' });
    expect(r.status).toBe(429);
    expect(r.json.error).toBe('already_sent');
    expect(h.sendEmailMock).not.toHaveBeenCalled();
  });

  it('allows a resend once the cooldown has elapsed', async () => {
    h.state.auditRows = [
      { createdAt: new Date(Date.now() - 5 * 60_000), action: 'quote.doc_email_sent', detailsJson: { refId: 'QF-ABC123', leadId: 10 } },
    ];
    const { sendQuoteDocEmail } = await import('./quoteDoc.js');
    const r = await sendQuoteDocEmail({ tenantId: 1, refId: 'QF-ABC123' });
    expect(r.status).toBe(200);
    expect(h.sendEmailMock).toHaveBeenCalledTimes(1);
  });

  it("a recent send for a DIFFERENT quote does not block this one", async () => {
    h.state.auditRows = [
      { createdAt: new Date(), action: 'quote.doc_email_sent', detailsJson: { refId: 'QF-OTHER', leadId: 99 } },
    ];
    const { sendQuoteDocEmail } = await import('./quoteDoc.js');
    const r = await sendQuoteDocEmail({ tenantId: 1, refId: 'QF-ABC123' });
    expect(r.status).toBe(200);
  });
});

describe('sendQuoteDocEmail — provider failure + audit record', () => {
  it('returns 502 and records NO audit entry when the provider fails', async () => {
    h.sendEmailMock.mockResolvedValueOnce({ ok: false, error: 'resend HTTP 500' });
    const { sendQuoteDocEmail } = await import('./quoteDoc.js');
    const r = await sendQuoteDocEmail({ tenantId: 1, refId: 'QF-ABC123' });
    expect(r.status).toBe(502);
    expect(h.state.inserts).toHaveLength(0);
  });

  it('records an audit log of the send on success (dedupe source of truth)', async () => {
    const { sendQuoteDocEmail } = await import('./quoteDoc.js');
    await sendQuoteDocEmail({ tenantId: 1, refId: 'QF-ABC123', userId: 7 });
    const audit = h.state.inserts.find((i) => i.table === 'audit_log');
    expect(audit).toBeTruthy();
    expect(audit!.values.action).toBe('quote.doc_email_sent');
    expect(audit!.values.tenantId).toBe(1);
    expect(audit!.values.userId).toBe(7);
    const details = audit!.values.detailsJson as Record<string, unknown>;
    expect(details.to).toBe('customer@example.com');
    expect(details.refId).toBe('QF-ABC123');
  });
});

describe('buildQuoteDocEmail — carrier-branded (NOT QuoteFleet-branded)', () => {
  it('shows the carrier business name and a stable subject/quoteUrl', async () => {
    const { buildQuoteDocEmail } = await import('./quoteDoc.js');
    const out = buildQuoteDocEmail(baseLead() as never, baseTenant() as never, null, 'https://quotefleet.net');
    expect(out.subject).toBe('Quote QF-ABC123 from Acme Freight');
    expect(out.html).toContain('Acme Freight');
    expect(out.html).not.toContain('QuoteFleet');
    expect(out.quoteUrl).toBe('https://quotefleet.net/quote/QF-ABC123');
  });
});

// ── Source-level wiring guards ───────────────────────────────────────
const routesDir = resolve(process.cwd(), 'src/server/routes');
const publicDir = resolve(process.cwd(), 'src/server/public');
const route = (n: string) => readFile(resolve(routesDir, n), 'utf8');
const pub = (n: string) => readFile(resolve(publicDir, n), 'utf8');

describe('send route wiring (source-level)', () => {
  it('is authed + tenant-scoped + rate-limited', async () => {
    const q = await route('quoteDoc.ts');
    expect(q).toContain("'/api/tenant/quote-doc/send/:refId'");
    expect(q).toMatch(/quote-doc\/send\/:refId',\s*\n\s*requireAuth,\s*\n\s*requireTenant,\s*\n\s*quoteEmailSendLimiter/);
  });

  it('(b) the send route NEVER reads a recipient from the request body', async () => {
    const q = await route('quoteDoc.ts');
    // Extract the send handler block and assert it never touches req.body.
    const idx = q.indexOf("'/api/tenant/quote-doc/send/:refId'");
    const handler = q.slice(idx, idx + 700);
    expect(handler).not.toContain('req.body');
    // recipient is derived server-side inside sendQuoteDocEmail, from the lead.
    expect(handler).toContain('sendQuoteDocEmail({');
  });

  it('(c) the lead lookup inside the send fn is scoped by tenantId', async () => {
    const q = await route('quoteDoc.ts');
    expect(q).toMatch(/eq\(leads\.refId, refId\), eq\(leads\.tenantId, params\.tenantId\)/);
  });

  it('a dedicated per-tenant+refId limiter exists', async () => {
    const rl = await readFile(resolve(process.cwd(), 'src/server/rateLimits.ts'), 'utf8');
    expect(rl).toContain('export const quoteEmailSendLimiter');
    expect(rl).toContain('qdoc-send:');
  });
});

describe('dashboard action actually sends (source-level)', () => {
  it('no longer claims the email is preview-only / not sent', async () => {
    const js = await pub('app-quote-actions.js');
    expect(js).not.toContain('does not send email yet');
    expect(js).not.toContain('Template only');
  });

  it('POSTs to the authed send endpoint and surfaces a status', async () => {
    const js = await pub('app-quote-actions.js');
    expect(js).toContain("'/api/tenant/quote-doc/send/'");
    expect(js).toContain("method: 'POST'");
    expect(js).toContain('data-email-send');
    // graceful no-email state
    expect(js).toContain('Add a customer email to this lead');
  });
});
