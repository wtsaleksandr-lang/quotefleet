import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_QUOTE_DISCLAIMER, resolveQuoteDisclaimer } from './quoteDisclaimer.js';

const publicDir = resolve(process.cwd(), 'src/server/public');
const routesDir = resolve(process.cwd(), 'src/server/routes');
const pub = (name: string) => readFile(resolve(publicDir, name), 'utf8');
const route = (name: string) => readFile(resolve(routesDir, name), 'utf8');

describe('quote disclaimer — resolver', () => {
  it('renders the platform default when unset (null)', () => {
    expect(resolveQuoteDisclaimer(null)).toBe(DEFAULT_QUOTE_DISCLAIMER);
    expect(resolveQuoteDisclaimer(undefined)).toBe(DEFAULT_QUOTE_DISCLAIMER);
  });

  it('renders the default when blank / whitespace-only (safe fallback)', () => {
    expect(resolveQuoteDisclaimer('')).toBe(DEFAULT_QUOTE_DISCLAIMER);
    expect(resolveQuoteDisclaimer('   \n\t ')).toBe(DEFAULT_QUOTE_DISCLAIMER);
  });

  it("renders the tenant's own text when set, trimmed", () => {
    expect(resolveQuoteDisclaimer('Our custom terms apply.')).toBe('Our custom terms apply.');
    expect(resolveQuoteDisclaimer('  Per-diem billed after 2 free days.  ')).toBe(
      'Per-diem billed after 2 free days.',
    );
  });

  it('the default is a clean GENERAL freight disclaimer (no company-specific clauses)', () => {
    expect(DEFAULT_QUOTE_DISCLAIMER).toMatch(/availability of the requested services/i);
    expect(DEFAULT_QUOTE_DISCLAIMER).toMatch(/valid for 30 days/i);
    expect(DEFAULT_QUOTE_DISCLAIMER).toMatch(/legal weight and dimension limits/i);
    // Must NOT hardcode a specific carrier's terms (e.g. WSL/SSL clauses).
    expect(DEFAULT_QUOTE_DISCLAIMER).not.toMatch(/\bWSL\b|\bSSL\b/);
  });
});

describe('quote disclaimer — schema + migration', () => {
  it('adds a nullable quote_disclaimer column to tenants', async () => {
    const schema = await readFile(resolve(process.cwd(), 'src/db/schema.ts'), 'utf8');
    expect(schema).toContain("quoteDisclaimer: text('quote_disclaimer')");
    // Nullable — no .notNull() chained on this column.
    expect(schema).not.toContain("quoteDisclaimer: text('quote_disclaimer').notNull()");
  });

  it('ships an additive, idempotent migration + journal entry', async () => {
    const sql = await readFile(resolve(process.cwd(), 'drizzle/0014_quote_disclaimer.sql'), 'utf8');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "quote_disclaimer" text');
    const journal = await readFile(resolve(process.cwd(), 'drizzle/meta/_journal.json'), 'utf8');
    expect(journal).toContain('0014_quote_disclaimer');
  });
});

describe('quote disclaimer — server payloads resolve the text', () => {
  it('hosted/printable quote-doc includes the resolved disclaimer', async () => {
    const doc = await route('quoteDoc.ts');
    expect(doc).toContain("import { resolveQuoteDisclaimer } from '../quoteDisclaimer.js'");
    expect(doc).toContain('disclaimer: resolveQuoteDisclaimer(tenant.quoteDisclaimer)');
  });

  it('widget config includes the resolved disclaimer', async () => {
    const publicRoute = await route('public.ts');
    expect(publicRoute).toContain("import { resolveQuoteDisclaimer } from '../quoteDisclaimer.js'");
    expect(publicRoute).toContain('disclaimer: resolveQuoteDisclaimer(tenant.quoteDisclaimer)');
  });
});

describe('quote disclaimer — renders on all quote surfaces', () => {
  it('widget result card renders it at the bottom', async () => {
    const html = await pub('widget.html');
    expect(html).toContain('id="qf-disclaimer"');
    const js = await pub('widget.js');
    expect(js).toContain('function renderDisclaimer()');
    expect(js).toContain('state.config.disclaimer');
    expect(js).toContain('renderDisclaimer()');
  });

  it('hosted + printable quote page renders a Terms section', async () => {
    const html = await pub('quote.html');
    expect(html).toContain('id="qdoc-terms"');
    expect(html).toContain('Terms &amp; Conditions');
    const js = await pub('quote.js');
    expect(js).toContain('data.quote.disclaimer');
    expect(js).toContain("text('qdoc-terms', terms)");
    // Terms styling exists (small print) for both screen + print.
    const css = await pub('quote.css');
    expect(css).toContain('.qdoc-terms-text');
  });
});

describe('quote disclaimer — tenant-editable control + round-trip', () => {
  it('profile route accepts + persists quoteDisclaimer and exposes it on /me', async () => {
    const auth = await route('auth.ts');
    expect(auth).toContain('quoteDisclaimer: z.string().max(4000).nullable().optional()');
    expect(auth).toContain('tenantUpdate.quoteDisclaimer = parse.data.quoteDisclaimer');
    expect(auth).toContain('quoteDisclaimer: t[0].quoteDisclaimer ?? null');
    // The default is exposed so the Account textarea can show it as placeholder.
    expect(auth).toContain('defaultQuoteDisclaimer: DEFAULT_QUOTE_DISCLAIMER');
  });

  it('Account Company details card has a Quote disclaimer textarea wired to profile', async () => {
    const app = await pub('app.js');
    expect(app).toContain("text: 'Quote disclaimer'");
    expect(app).toContain('data-co-disc');
    expect(app).toContain('quoteDisclaimer: quoteDisclaimer');
    // Placeholder shows the default so the carrier sees what they'd get.
    expect(app).toContain('r.tenant.defaultQuoteDisclaimer');
  });
});
