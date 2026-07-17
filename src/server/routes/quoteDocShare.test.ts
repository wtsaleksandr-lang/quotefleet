/**
 * Quote-document customer SHARE — behaviour + guards.
 *
 * `shareQuoteDoc` emails the carrier-branded quote document to one or more
 * recipients the CUSTOMER names (the "share with others" / "email me a copy"
 * action bar under the quote result). Security/behaviour properties asserted:
 *
 *   (a) valid emails are sent the branded quote (returns { sent: n }),
 *   (b) an invalid address rejects the WHOLE request (400) — never a silent drop,
 *   (c) more than 5 recipients is capped (400),
 *   (d) a disabled tenant (quoteShare:false) → 403,
 *   (e) the private-calculator access gate is honoured (denied → 403),
 *   (f) duplicate addresses are de-duped (sent once),
 *   (g) one audit entry summarises the share.
 *
 * Same harness style as quoteDocSend.test.ts: a mocked db + sendEmail.
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
    inserts: [] as Array<{ table: string; values: Record<string, unknown> }>,
  };
  type EmailOut = { ok: boolean; provider?: string; id?: string; error?: string };
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
  quotedTotal: 1200,
  quotedCurrency: 'USD',
  service: 'drayage',
  equipment: 'container_40',
  distanceMiles: 55,
  pickupCity: 'Los Angeles',
  pickupState: 'CA',
  deliveryCity: 'San Diego',
  deliveryState: 'CA',
});

const baseTenant = () => ({
  id: 1,
  name: 'Acme Freight',
  status: 'active',
  accessMode: 'public',
  publicContactEmail: 'ops@acme.com',
  contactPhone: '555-0100',
});

beforeEach(() => {
  h.state.leadRows = [baseLead()];
  h.state.tenantRows = [baseTenant()];
  h.state.brandRows = []; // null brand → resolveFeatures defaults → quoteShare ON
  h.state.inserts = [];
  h.sendEmailMock.mockClear();
  h.sendEmailMock.mockResolvedValue({ ok: true, provider: 'resend', id: 'em_1' });
  process.env.SESSION_SECRET ||= 'test'.repeat(16);
  process.env.DATABASE_URL ||= 'postgresql://x';
  process.env.ANTHROPIC_API_KEY ||= 'sk-test';
  process.env.PUBLIC_BASE_URL ||= 'https://quotefleet.net';
});

describe('shareQuoteDoc — happy path', () => {
  it('(a) sends the branded quote to each valid recipient and returns { sent }', async () => {
    const { shareQuoteDoc } = await import('./quoteDoc.js');
    const r = await shareQuoteDoc({ refId: 'QF-ABC123', recipients: ['a@x.com', 'b@y.com'] });
    expect(r.status).toBe(200);
    expect(r.json.sent).toBe(2);
    expect(h.sendEmailMock).toHaveBeenCalledTimes(2);
    const tos = h.sendEmailMock.mock.calls.map((c) => (c[0] as { to: string }).to).sort();
    expect(tos).toEqual(['a@x.com', 'b@y.com']);
    // The shared email is the carrier-branded quote doc (not QuoteFleet-branded).
    const html = (h.sendEmailMock.mock.calls[0][0] as { html: string }).html;
    expect(html).toContain('Acme Freight');
  });

  it('(g) records exactly one audit entry summarising the share', async () => {
    const { shareQuoteDoc } = await import('./quoteDoc.js');
    await shareQuoteDoc({ refId: 'QF-ABC123', recipients: ['a@x.com', 'b@y.com'] });
    const audits = h.state.inserts.filter((i) => i.table === 'audit_log');
    expect(audits).toHaveLength(1);
    expect(audits[0].values.action).toBe('quote.doc_shared');
    const details = audits[0].values.detailsJson as Record<string, unknown>;
    expect(details.refId).toBe('QF-ABC123');
    expect(details.sent).toBe(2);
  });

  it('(f) de-dupes duplicate addresses (case-insensitive) — sent once', async () => {
    const { shareQuoteDoc } = await import('./quoteDoc.js');
    const r = await shareQuoteDoc({ refId: 'QF-ABC123', recipients: ['a@x.com', 'A@X.com'] });
    expect(r.status).toBe(200);
    expect(r.json.sent).toBe(1);
    expect(h.sendEmailMock).toHaveBeenCalledTimes(1);
  });
});

describe('shareQuoteDoc — validation', () => {
  it('(b) rejects the whole request when ANY address is invalid (400) and sends nothing', async () => {
    const { shareQuoteDoc } = await import('./quoteDoc.js');
    const r = await shareQuoteDoc({ refId: 'QF-ABC123', recipients: ['good@x.com', 'not-an-email'] });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('invalid_email');
    expect(h.sendEmailMock).not.toHaveBeenCalled();
  });

  it('(c) caps at 5 recipients (400)', async () => {
    const { shareQuoteDoc } = await import('./quoteDoc.js');
    const six = ['1@x.com', '2@x.com', '3@x.com', '4@x.com', '5@x.com', '6@x.com'];
    const r = await shareQuoteDoc({ refId: 'QF-ABC123', recipients: six });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('too_many');
    expect(h.sendEmailMock).not.toHaveBeenCalled();
  });

  it('exactly 5 recipients is allowed', async () => {
    const { shareQuoteDoc } = await import('./quoteDoc.js');
    const five = ['1@x.com', '2@x.com', '3@x.com', '4@x.com', '5@x.com'];
    const r = await shareQuoteDoc({ refId: 'QF-ABC123', recipients: five });
    expect(r.status).toBe(200);
    expect(r.json.sent).toBe(5);
  });

  it('empty / non-array recipients → 400 no_recipients', async () => {
    const { shareQuoteDoc } = await import('./quoteDoc.js');
    expect((await shareQuoteDoc({ refId: 'QF-ABC123', recipients: [] })).status).toBe(400);
    expect((await shareQuoteDoc({ refId: 'QF-ABC123', recipients: 'a@x.com' })).status).toBe(400);
    expect(h.sendEmailMock).not.toHaveBeenCalled();
  });
});

describe('shareQuoteDoc — gating', () => {
  it('(d) 403s when the tenant has quoteShare turned OFF', async () => {
    h.state.brandRows = [{ tenantId: 1, featuresJson: { quoteShare: false } }];
    const { shareQuoteDoc } = await import('./quoteDoc.js');
    const r = await shareQuoteDoc({ refId: 'QF-ABC123', recipients: ['a@x.com'] });
    expect(r.status).toBe(403);
    expect(r.json.error).toBe('sharing_disabled');
    expect(h.sendEmailMock).not.toHaveBeenCalled();
  });

  it('(e) honours the private-calculator access gate (denied → 403)', async () => {
    const { shareQuoteDoc } = await import('./quoteDoc.js');
    const r = await shareQuoteDoc({
      refId: 'QF-ABC123',
      recipients: ['a@x.com'],
      checkAccess: async () => false, // private tenant, no grant
    });
    expect(r.status).toBe(403);
    expect(r.json.error).toBe('access_denied');
    expect(h.sendEmailMock).not.toHaveBeenCalled();
  });

  it('allows the send when the access gate passes', async () => {
    const { shareQuoteDoc } = await import('./quoteDoc.js');
    const r = await shareQuoteDoc({ refId: 'QF-ABC123', recipients: ['a@x.com'], checkAccess: async () => true });
    expect(r.status).toBe(200);
    expect(r.json.sent).toBe(1);
  });

  it('404s when the refId has no lead', async () => {
    h.state.leadRows = [];
    const { shareQuoteDoc } = await import('./quoteDoc.js');
    const r = await shareQuoteDoc({ refId: 'QF-NOPE', recipients: ['a@x.com'] });
    expect(r.status).toBe(404);
  });

  it('404s when the carrier tenant is not active', async () => {
    h.state.tenantRows = [{ ...baseTenant(), status: 'suspended' }];
    const { shareQuoteDoc } = await import('./quoteDoc.js');
    const r = await shareQuoteDoc({ refId: 'QF-ABC123', recipients: ['a@x.com'] });
    expect(r.status).toBe(404);
    expect(h.sendEmailMock).not.toHaveBeenCalled();
  });
});

describe('shareQuoteDoc — provider failure', () => {
  it('502s and records NO audit entry when every send fails', async () => {
    h.sendEmailMock.mockResolvedValue({ ok: false, error: 'resend HTTP 500' });
    const { shareQuoteDoc } = await import('./quoteDoc.js');
    const r = await shareQuoteDoc({ refId: 'QF-ABC123', recipients: ['a@x.com'] });
    expect(r.status).toBe(502);
    expect(h.state.inserts.filter((i) => i.table === 'audit_log')).toHaveLength(0);
  });
});

// ── Source-level wiring guards ───────────────────────────────────────
const routesDir = resolve(process.cwd(), 'src/server/routes');
const route = (n: string) => readFile(resolve(routesDir, n), 'utf8');

describe('share route wiring (source-level)', () => {
  it('is a PUBLIC endpoint, rate-limited, and wires the access predicate', async () => {
    const q = await route('quoteDoc.ts');
    expect(q).toContain("'/api/public/quote-doc/:refId/share'");
    expect(q).toMatch(/quote-doc\/:refId\/share',\s*publicDocLimiter/);
    expect(q).toContain('checkAccess: (tenant) => tenantAccessAllowed(tenant, req)');
  });

  it('exposes the resolved features on the public widget config', async () => {
    const p = await route('public.ts');
    expect(p).toContain('features: resolveFeatures(brand)');
  });
});

describe('public widget config includes features (behaviour)', () => {
  it('resolveFeatures is exported and defaults share ON', async () => {
    const { resolveFeatures } = await import('../features.js');
    expect(resolveFeatures(null).quoteShare).toBe(true);
  });
});
