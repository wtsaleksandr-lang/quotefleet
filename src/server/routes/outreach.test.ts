/**
 * Outreach route tests — super-admin gating + input validation.
 *
 * Uses the REAL `requireSuperAdmin` middleware over a tiny express app. A
 * stand-in for `requireAuth` attaches `req.user` from a test header so we can
 * exercise every role without a live session/DB:
 *   - no user           → 401
 *   - non-super-admin   → 403
 *   - super admin       → reaches the handler
 * Plus a source-level guard that the shipped route chains requireAuth +
 * requireSuperAdmin (so the gate can't be silently dropped in a refactor).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { requireSuperAdmin } from '../middleware.js';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  // Stand in for requireAuth: attach req.user from `x-test-role` (omit → none).
  app.use((req, _res, next) => {
    const role = req.header('x-test-role');
    if (role) req.user = { id: 1, role } as never;
    next();
  });
  app.post('/api/admin/outreach/enrich', requireSuperAdmin, (_req, res) => {
    res.json({ ok: true, reached: true });
  });

  await new Promise<void>((r) => {
    server = app.listen(0, () => r());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

async function hit(role?: string) {
  const res = await fetch(`${baseUrl}/api/admin/outreach/enrich`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(role ? { 'x-test-role': role } : {}),
    },
    body: JSON.stringify({ domain: 'acme.com' }),
  });
  return { status: res.status, json: (await res.json()) as { reached?: boolean; error?: string } };
}

describe('super-admin gating', () => {
  it('401s an unauthenticated caller', async () => {
    const r = await hit();
    expect(r.status).toBe(401);
    expect(r.json.reached).toBeUndefined();
  });

  it('403s a non-super-admin (tenant_owner)', async () => {
    const r = await hit('tenant_owner');
    expect(r.status).toBe(403);
    expect(r.json.reached).toBeUndefined();
  });

  it('403s a plain tenant user', async () => {
    const r = await hit('user');
    expect(r.status).toBe(403);
  });

  it('lets a super_admin reach the handler', async () => {
    const r = await hit('super_admin');
    expect(r.status).toBe(200);
    expect(r.json.reached).toBe(true);
  });
});

describe('route wiring (source-level)', () => {
  it('the enrich route chains requireAuth + requireSuperAdmin', async () => {
    const src = await readFile(resolve(process.cwd(), 'src/server/routes/outreach.ts'), 'utf8');
    expect(src).toContain("'/api/admin/outreach/enrich'");
    expect(src).toMatch(
      /outreach\/enrich',\s*requireAuth,\s*requireSuperAdmin/,
    );
  });

  it('is registered in app.ts', async () => {
    const app = await readFile(resolve(process.cwd(), 'src/server/app.ts'), 'utf8');
    expect(app).toContain('registerOutreachRoutes(app)');
  });
});
