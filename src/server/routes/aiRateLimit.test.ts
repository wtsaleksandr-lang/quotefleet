/**
 * Per-tenant AI rate-limit tests (audit H3).
 *
 * The AI rate-chat (`POST /api/ai/rate-chat`) and rate-sheet ingest
 * (`POST /api/tenant/ingest`) endpoints call Anthropic on the SHARED platform
 * key when a tenant has no BYO key, so an unbounded loop by one tenant runs up
 * the platform AI bill. `aiTenantBurstLimiter` + `aiTenantDailyLimiter` cap that
 * per TENANT (not per IP) and are skipped for BYO-key tenants.
 *
 * Behavioural coverage (real express app, real limiter middleware):
 *   - under the limit → pass; over the burst limit → 429 (never 500)
 *   - the cap is PER-TENANT — a different tenant is unaffected
 *   - the daily cap trips independently of the burst window
 *   - a BYO-key tenant is exempt (blows past both caps, never 429)
 * Plus source-level wiring guards that both routes chain the limiters.
 *
 * Caps are pinned low via env BEFORE importing rateLimits.js so the test is fast
 * and deterministic (burst 5 / day 8).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { RateLimitRequestHandler } from 'express-rate-limit';

// Pin the caps small + deterministic. Must be set before rateLimits.js is
// imported (its constants read the env at module load).
process.env.AI_TENANT_BURST_LIMIT = '5';
process.env.AI_TENANT_DAILY_LIMIT = '8';

let server: Server;
let baseUrl: string;
let burstLimiter: RateLimitRequestHandler;

beforeAll(async () => {
  const { aiTenantBurstLimiter, aiTenantDailyLimiter } = await import('../rateLimits.js');
  burstLimiter = aiTenantBurstLimiter;

  const app = express();
  app.use(express.json());
  // Stand in for requireAuth+requireTenant: attach req.tenant from test headers.
  // `x-test-tenant-id` → tenant id; `x-test-byo: 1` → tenant has a BYO key.
  app.use((req, _res, next) => {
    const id = Number(req.header('x-test-tenant-id'));
    req.tenant = {
      id: Number.isFinite(id) ? id : undefined,
      anthropicKeyEncrypted: req.header('x-test-byo') === '1' ? 'enc:byo' : null,
    } as never;
    next();
  });
  app.post('/ai', aiTenantBurstLimiter, aiTenantDailyLimiter, (_req, res) => {
    res.json({ ok: true });
  });

  await new Promise<void>((r) => {
    server = app.listen(0, () => r());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

async function hit(tenantId: number, opts: { byo?: boolean } = {}) {
  const res = await fetch(`${baseUrl}/ai`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-test-tenant-id': String(tenantId),
      ...(opts.byo ? { 'x-test-byo': '1' } : {}),
    },
    body: '{}',
  });
  return { status: res.status, json: (await res.json()) as { ok?: boolean; error?: string } };
}

describe('per-tenant AI burst limiter', () => {
  it('passes under the cap, then 429s over it (never 500)', async () => {
    const tenant = 1001;
    // Burst cap is 5 → first 5 pass.
    for (let i = 0; i < 5; i++) {
      const r = await hit(tenant);
      expect(r.status).toBe(200);
      expect(r.json.ok).toBe(true);
    }
    // 6th trips the limiter → graceful 429 with the BYO-key hint, NOT a 500.
    const over = await hit(tenant);
    expect(over.status).toBe(429);
    expect(over.status).not.toBe(500);
    expect(over.json.error).toMatch(/AI usage limit/i);
    expect(over.json.error).toMatch(/API key/i);
  });

  it('is isolated PER TENANT — a different tenant is unaffected', async () => {
    // tenant 1002 exhausts its own burst quota.
    for (let i = 0; i < 5; i++) expect((await hit(1002)).status).toBe(200);
    expect((await hit(1002)).status).toBe(429);
    // A DIFFERENT tenant still has a full quota — one noisy tenant can't starve
    // another (limit is keyed by tenant id, not a shared/IP bucket).
    const other = await hit(1003);
    expect(other.status).toBe(200);
    expect(other.json.ok).toBe(true);
  });
});

describe('per-tenant AI daily limiter', () => {
  it('caps total daily calls independently of the burst window', async () => {
    const tenant = 2001;
    // Reset the burst key before each call so the burst window never blocks —
    // this isolates the DAILY cap (8). The rolling daily count keeps climbing.
    for (let i = 0; i < 8; i++) {
      burstLimiter.resetKey(`ai-burst:${tenant}`);
      const r = await hit(tenant);
      expect(r.status).toBe(200);
    }
    // 9th call: burst reset again, so ONLY the daily cap can block it → 429.
    burstLimiter.resetKey(`ai-burst:${tenant}`);
    const over = await hit(tenant);
    expect(over.status).toBe(429);
    expect(over.json.error).toMatch(/AI usage limit/i);
  });
});

describe('BYO-key tenant exemption', () => {
  it('a tenant with its own Anthropic key blows past both caps, never 429', async () => {
    const tenant = 3001;
    // Fire well past burst (5) AND daily (8) — a BYO-key tenant spends its own
    // budget, so both limiters skip it entirely.
    for (let i = 0; i < 15; i++) {
      const r = await hit(tenant, { byo: true });
      expect(r.status).toBe(200);
      expect(r.json.ok).toBe(true);
    }
  });
});

// ── Source-level wiring guards (mirror quoteDocSend.test.ts) ─────────────
const routesDir = resolve(process.cwd(), 'src/server/routes');
const route = (n: string) => readFile(resolve(routesDir, n), 'utf8');

describe('route wiring (source-level)', () => {
  it('the limiter constants exist and skip BYO-key tenants', async () => {
    const rl = await readFile(resolve(process.cwd(), 'src/server/rateLimits.ts'), 'utf8');
    expect(rl).toContain('export const aiTenantBurstLimiter');
    expect(rl).toContain('export const aiTenantDailyLimiter');
    // Keyed by tenant id (prefixes), exempts BYO-key tenants.
    expect(rl).toContain("aiTenantKey('ai-burst')");
    expect(rl).toContain("aiTenantKey('ai-daily')");
    expect(rl).toContain('req.tenant?.id');
    expect(rl).toContain('tenantHasByoKey');
    expect(rl).toContain('anthropicKeyEncrypted');
  });

  it('rate-chat chains both AI limiters after requireTenant', async () => {
    const a = await route('ai.ts');
    expect(a).toContain('aiTenantBurstLimiter');
    expect(a).toContain('aiTenantDailyLimiter');
    expect(a).toMatch(
      /rate-chat',\s*requireAuth,\s*requireTenant,\s*aiTenantBurstLimiter,\s*aiTenantDailyLimiter/,
    );
  });

  it('ingest upload chains both AI limiters after requireTenant', async () => {
    const g = await route('ingest.ts');
    expect(g).toContain('aiTenantBurstLimiter');
    expect(g).toContain('aiTenantDailyLimiter');
    expect(g).toMatch(
      /'\/api\/tenant\/ingest',\s*requireAuth,\s*requireTenant,\s*aiTenantBurstLimiter,\s*aiTenantDailyLimiter/,
    );
  });
});
