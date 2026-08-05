/**
 * Branded quote PDF — behaviour + guards.
 *
 * `generateQuotePdf` renders the server-side branded PDF for a public refId
 * (the "Download PDF" one-click action on the hosted quote page + widget). It
 * reuses the SAME quote data source as the hosted quote / branded email, so the
 * PDF always matches what the customer sees. Properties asserted:
 *
 *   (a) a valid refId → 200 + a valid PDF (starts with %PDF), non-trivial size,
 *       attachment filename, and the quote total + company name present in the
 *       drawn text (decoded from the PDF content streams),
 *   (b) a bad refId → 404; a suspended tenant → 404; an empty refId → 400,
 *   (c) the private-calculator access gate is honoured (denied → 403),
 *   (d) PLAN GATING — a Pro / trialing tenant gets the un-badged branded PDF;
 *       every other tenant gets the SAME PDF with the "Powered by QuoteFleet"
 *       footer badge (never a 500 for free),
 *   (e) the pure drawer (buildQuotePdf) emits a valid PDF and honours currency.
 *
 * Harness mirrors quoteDocShare.test.ts: a mocked db + email module. PDF text is
 * verified by inflating the content streams and hex-decoding the TJ strings
 * (PDFKit stores standard-font text as hex-encoded show operators).
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────
const h = vi.hoisted(() => {
  const state = {
    leadRows: [] as Record<string, unknown>[],
    tenantRows: [] as Record<string, unknown>[],
    brandRows: [] as Record<string, unknown>[],
    rateCardRows: [] as Record<string, unknown>[],
    inserts: [] as Array<{ table: string; values: Record<string, unknown> }>,
  };
  return { state };
});

vi.mock('../../email/send.js', () => ({
  sendEmail: vi.fn(async () => ({ ok: true, provider: 'resend', id: 'em_1' })),
  brandedFrom: (name: string) => `${(name || 'QuoteFleet')} <hello@quotefleet.net>`,
}));

vi.mock('../../db/client.js', async () => {
  const { getTableName } = await import('drizzle-orm');
  function rowsFor(table: unknown): Record<string, unknown>[] {
    const n = getTableName(table as never);
    if (n === 'leads') return h.state.leadRows;
    if (n === 'tenants') return h.state.tenantRows;
    if (n === 'brand_configs') return h.state.brandRows;
    if (n === 'rate_cards') return h.state.rateCardRows;
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

// ── PDF text extraction ──────────────────────────────────────────────
// PDFKit writes standard-font text as hex-encoded strings inside TJ/Tj show
// operators. Inflate every content stream, then hex-decode every <...> token to
// reconstruct the drawn text so we can assert on the total / company / badge.
function extractPdfText(buf: Buffer): string {
  const s = buf.toString('latin1');
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  let text = '';
  while ((m = streamRe.exec(s)) !== null) {
    const raw = Buffer.from(m[1], 'latin1');
    let out: Buffer;
    try { out = inflateSync(raw); } catch { out = raw; }
    const st = out.toString('latin1');
    const hexRe = /<([0-9A-Fa-f\s]+)>/g;
    let hm: RegExpExecArray | null;
    while ((hm = hexRe.exec(st)) !== null) {
      const hex = hm[1].replace(/\s+/g, '');
      if (hex.length % 2 !== 0) continue;
      text += Buffer.from(hex, 'hex').toString('latin1');
    }
  }
  return text;
}

const baseLead = () => ({
  id: 10,
  refId: 'QF-ABC123',
  tenantId: 1,
  customerEmail: 'customer@example.com',
  customerName: 'Pat Rivera',
  quotedTotal: 1450.75,
  quotedCurrency: 'USD',
  service: 'drayage',
  equipment: 'container_40',
  distanceMiles: 88,
  pickupCity: 'Los Angeles',
  pickupState: 'CA',
  deliveryCity: 'Long Beach',
  deliveryState: 'CA',
  breakdownJson: [
    { name: 'Line haul', amount: 1200, kind: 'linehaul' },
    { name: 'Fuel surcharge', amount: 250.75, kind: 'fuel' },
  ],
  createdAt: new Date('2026-08-01T12:00:00Z'),
});

const baseTenant = () => ({
  id: 1,
  name: 'Acme Freight',
  status: 'active',
  accessMode: 'public',
  plan: 'free',
  trialEndsAt: null as Date | null,
  publicContactEmail: 'ops@acme.com',
  contactPhone: '555-0100',
  mcNumber: '842197',
  dotNumber: '2551043',
  quoteDisclaimer: null,
});

const gen = async (over: Record<string, unknown> = {}) => {
  const { generateQuotePdf } = await import('./quoteDoc.js');
  return generateQuotePdf({ refId: 'QF-ABC123', fetchLogo: async () => null, ...over } as never);
};

beforeEach(() => {
  h.state.leadRows = [baseLead()];
  h.state.tenantRows = [baseTenant()];
  h.state.brandRows = [];
  h.state.rateCardRows = [];
  h.state.inserts = [];
  process.env.SESSION_SECRET ||= 'test'.repeat(16);
  process.env.DATABASE_URL ||= 'postgresql://x';
  process.env.ANTHROPIC_API_KEY ||= 'sk-test';
  process.env.PUBLIC_BASE_URL ||= 'https://quotefleet.net';
});

describe('generateQuotePdf — happy path', () => {
  it('(a) returns a valid, non-trivial PDF with an attachment filename', async () => {
    const r = await gen();
    expect(r.status).toBe(200);
    expect(r.filename).toBe('quote-QF-ABC123.pdf');
    expect(r.buffer).toBeInstanceOf(Buffer);
    // Valid PDF magic + non-trivial size.
    expect(r.buffer!.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(r.buffer!.length).toBeGreaterThan(1500);
  });

  it('(a) the drawn PDF contains the quote total and company name', async () => {
    const r = await gen();
    const text = extractPdfText(r.buffer!);
    expect(text).toContain('Acme Freight');
    expect(text).toContain('$1,450.75');
    expect(text).toContain('Long Beach, CA'); // lane delivery
  });
});

describe('generateQuotePdf — access + lookup guards', () => {
  it('(b) 404 when the refId has no lead', async () => {
    h.state.leadRows = [];
    const r = await gen({ refId: 'QF-NOPE' });
    expect(r.status).toBe(404);
    expect(r.buffer).toBeUndefined();
  });

  it('(b) 404 when the carrier tenant is not active', async () => {
    h.state.tenantRows = [{ ...baseTenant(), status: 'suspended' }];
    const r = await gen();
    expect(r.status).toBe(404);
  });

  it('(b) 400 when the refId is empty', async () => {
    const r = await gen({ refId: '   ' });
    expect(r.status).toBe(400);
  });

  it('(c) 403 when the private-calculator access gate denies', async () => {
    const r = await gen({ checkAccess: async () => false });
    expect(r.status).toBe(403);
    expect(r.json!.error).toBe('access_denied');
    expect(r.buffer).toBeUndefined();
  });

  it('(c) allows the download when the access gate passes', async () => {
    const r = await gen({ checkAccess: async () => true });
    expect(r.status).toBe(200);
    expect(r.buffer).toBeInstanceOf(Buffer);
  });
});

describe('generateQuotePdf — plan gating (Pro vs free branding)', () => {
  it('(d) a FREE tenant gets a functional PDF WITH the QuoteFleet badge', async () => {
    h.state.tenantRows = [{ ...baseTenant(), plan: 'free', trialEndsAt: null }];
    const r = await gen();
    expect(r.status).toBe(200);
    expect(r.hasBadge).toBe(true);
    expect(extractPdfText(r.buffer!)).toContain('Powered by QuoteFleet');
  });

  it('(d) a PRO tenant gets the un-badged branded PDF', async () => {
    h.state.tenantRows = [{ ...baseTenant(), plan: 'pro', trialEndsAt: null }];
    const r = await gen();
    expect(r.status).toBe(200);
    expect(r.hasBadge).toBe(false);
    expect(extractPdfText(r.buffer!)).not.toContain('Powered by QuoteFleet');
  });

  it('(d) a TRIALING tenant tastes Pro → un-badged', async () => {
    h.state.tenantRows = [{ ...baseTenant(), plan: 'vital', trialEndsAt: new Date(Date.now() + 7 * 864e5) }];
    const r = await gen();
    expect(r.hasBadge).toBe(false);
  });

  it('(d) a VITAL (post-trial) tenant keeps the badge', async () => {
    h.state.tenantRows = [{ ...baseTenant(), plan: 'vital', trialEndsAt: new Date(Date.now() - 864e5) }];
    const r = await gen();
    expect(r.hasBadge).toBe(true);
    expect(extractPdfText(r.buffer!)).toContain('Powered by QuoteFleet');
  });
});

describe('buildQuotePdf — pure drawer', () => {
  const input = (over: Record<string, unknown> = {}) => ({
    refId: 'QF-XYZ',
    generatedAt: new Date('2026-08-01T00:00:00Z'),
    expiresAt: new Date('2026-08-31T00:00:00Z'),
    currency: 'USD',
    total: 987.65,
    distanceMiles: 240,
    transitText: '1–2 business days',
    lane: { pickup: 'Dallas, TX', delivery: 'Houston, TX' },
    service: 'FTL / Dry Van',
    breakdown: [{ name: 'Line haul', amount: 987.65, kind: 'linehaul' }],
    disclaimer: 'Estimate only.',
    carrier: { name: 'Lone Star Freight', phone: '555', email: 'a@b.co', mcNumber: '1', dotNumber: '2' },
    brand: { primaryColor: '#0D5FCF', accentColor: '#F2A007', logo: null },
    proBranding: true,
    ...over,
  });

  it('(e) emits a valid PDF; hasBadge follows proBranding', async () => {
    const { buildQuotePdf } = await import('../quotePdf.js');
    const pro = await buildQuotePdf(input({ proBranding: true }) as never);
    expect(pro.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pro.hasBadge).toBe(false);
    const free = await buildQuotePdf(input({ proBranding: false }) as never);
    expect(free.hasBadge).toBe(true);
    expect(extractPdfText(free.buffer)).toContain('Powered by QuoteFleet');
  });

  it('(e) formats the total in the quote currency (CAD)', async () => {
    const { buildQuotePdf } = await import('../quotePdf.js');
    const r = await buildQuotePdf(input({ currency: 'CAD', total: 1234.5 }) as never);
    const text = extractPdfText(r.buffer);
    expect(text).toContain('CA$1,234.50');
    expect(text).toContain('Lone Star Freight');
  });

  it('(e) survives a malformed brand color without throwing', async () => {
    const { buildQuotePdf } = await import('../quotePdf.js');
    const r = await buildQuotePdf(input({ brand: { primaryColor: 'not-a-color', accentColor: '', logo: null } }) as never);
    expect(r.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});

// ── Source-level wiring guards ───────────────────────────────────────
const routesDir = resolve(process.cwd(), 'src/server/routes');
const route = (n: string) => readFile(resolve(routesDir, n), 'utf8');

describe('PDF route wiring (source-level)', () => {
  it('is a PUBLIC endpoint, rate-limited, and wires the access predicate', async () => {
    const q = await route('quoteDoc.ts');
    expect(q).toContain("'/api/public/quote-doc/:refId/pdf'");
    expect(q).toMatch(/quote-doc\/:refId\/pdf',\s*publicDocLimiter/);
    expect(q).toContain('checkAccess: (tenant) => tenantAccessAllowed(tenant, req)');
  });

  it('streams application/pdf as a download attachment', async () => {
    const q = await route('quoteDoc.ts');
    expect(q).toContain("res.setHeader('Content-Type', 'application/pdf')");
    expect(q).toContain('attachment; filename=');
  });
});
