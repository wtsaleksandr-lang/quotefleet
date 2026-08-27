/**
 * Importer SAVED endpoints (routes/importerSaved.ts) — login gating, ownership,
 * idempotent upsert, note/status updates, the per-user cap and the saved-slugs
 * hydration. directoryIdentity is mocked and an in-memory store is injected, so
 * this is a pure offline unit test (no DB, no express app).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../directory/entitlement.js', () => ({
  directoryIdentity: vi.fn(),
}));
import { directoryIdentity } from '../directory/entitlement.js';
import {
  handleGetSaved,
  handleGetSavedSlugs,
  handleSave,
  handleUpdateSaved,
  handleRemoveSaved,
  type ImporterSavedDeps,
} from './importerSaved.js';
import type { ImporterSavedStore, SavedImporter } from '../directory/importerSavedStore.js';

function res() {
  const r = {
    statusCode: 200,
    body: undefined as unknown,
    status(c: number) {
      this.statusCode = c;
      return this;
    },
    json(b: unknown) {
      this.body = b;
      return this;
    },
    type() {
      return this;
    },
    send(b: unknown) {
      this.body = b;
      return this;
    },
  };
  return r as unknown as Response & { statusCode: number; body: any };
}

function req(opts: { params?: Record<string, unknown>; body?: unknown } = {}): Request {
  return { params: opts.params ?? {}, body: opts.body } as unknown as Request;
}

/** In-memory ImporterSavedStore scoped by user. */
function memStore(): ImporterSavedStore {
  const rows = new Map<string, SavedImporter & { userId: number }>();
  const k = (u: number, s: string) => `${u}::${s}`;
  return {
    async listForUser(userId) {
      return [...rows.values()]
        .filter((r) => r.userId === userId)
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        .map(({ userId: _u, ...rest }) => rest);
    },
    async savedSlugs(userId) {
      return [...rows.values()].filter((r) => r.userId === userId).map((r) => r.slug);
    },
    async countForUser(userId) {
      return [...rows.values()].filter((r) => r.userId === userId).length;
    },
    async has(userId, slug) {
      return rows.has(k(userId, slug));
    },
    async save(userId, slug, company, patch = {}) {
      const existing = rows.get(k(userId, slug));
      const row = {
        userId,
        slug,
        company,
        note: patch.note !== undefined ? patch.note : (existing?.note ?? null),
        status: patch.status !== undefined ? patch.status : (existing?.status ?? null),
        updatedAt: new Date(),
      };
      rows.set(k(userId, slug), row);
      const { userId: _u, ...rest } = row;
      return rest;
    },
    async update(userId, slug, patch) {
      const existing = rows.get(k(userId, slug));
      if (!existing) return null;
      if (patch.note !== undefined) existing.note = patch.note;
      if (patch.status !== undefined) existing.status = patch.status;
      existing.updatedAt = new Date();
      const { userId: _u, ...rest } = existing;
      return rest;
    },
    async remove(userId, slug) {
      return rows.delete(k(userId, slug));
    },
  };
}

const asAnon = () => (directoryIdentity as any).mockResolvedValue({ userId: null, email: null, isPro: false });
const asUser = (id: number) => (directoryIdentity as any).mockResolvedValue({ userId: id, email: 'u@e.com', isPro: false });

let deps: ImporterSavedDeps;
beforeEach(() => {
  vi.clearAllMocks();
  deps = { store: memStore() };
});

describe('login gating', () => {
  it('save requires a logged-in account (401 needs-account)', async () => {
    asAnon();
    const r = res();
    await handleSave(req({ body: { slug: 'valbruna-stainless', company: 'Valbruna' } }), r, deps);
    expect(r.statusCode).toBe(401);
    expect((r.body as any).reason).toBe('needs-account');
  });

  it('saved-slugs returns an empty set (200) for an anonymous visitor, not a 401', async () => {
    asAnon();
    const r = res();
    await handleGetSavedSlugs(req(), r, deps);
    expect(r.statusCode).toBe(200);
    expect((r.body as any).loggedIn).toBe(false);
    expect((r.body as any).slugs).toEqual([]);
  });
});

describe('save + list + ownership', () => {
  it('saves an importer (201) then lists it for that user only', async () => {
    asUser(1);
    const c = res();
    await handleSave(req({ body: { slug: 'valbruna-stainless', company: 'Valbruna Stainless' } }), c, deps);
    expect(c.statusCode).toBe(201);
    expect((c.body as any).added).toBe(true);

    const g = res();
    await handleGetSaved(req(), g, deps);
    expect((g.body as any).saved).toHaveLength(1);
    expect((g.body as any).saved[0].slug).toBe('valbruna-stainless');

    // A different user sees none.
    asUser(2);
    const g2 = res();
    await handleGetSaved(req(), g2, deps);
    expect((g2.body as any).saved).toHaveLength(0);
  });

  it('re-saving the same importer is idempotent (200 added:false)', async () => {
    asUser(1);
    await handleSave(req({ body: { slug: 'axis', company: 'Axis' } }), res(), deps);
    const again = res();
    await handleSave(req({ body: { slug: 'axis', company: 'Axis' } }), again, deps);
    expect(again.statusCode).toBe(200);
    expect((again.body as any).added).toBe(false);
  });

  it('rejects an invalid slug (422)', async () => {
    asUser(1);
    const r = res();
    await handleSave(req({ body: { slug: 'Not A Slug!!', company: 'X' } }), r, deps);
    expect(r.statusCode).toBe(422);
    expect((r.body as any).reason).toBe('invalid-slug');
  });

  it('enforces the per-user cap', async () => {
    asUser(1);
    deps = { store: memStore(), maxSaved: 1 };
    await handleSave(req({ body: { slug: 'aaa', company: 'A' } }), res(), deps);
    const capped = res();
    await handleSave(req({ body: { slug: 'bbb', company: 'B' } }), capped, deps);
    expect(capped.statusCode).toBe(409);
    expect((capped.body as any).reason).toBe('saved-cap');
  });
});

describe('note / status update + remove', () => {
  it('updates note + status on a saved importer', async () => {
    asUser(1);
    await handleSave(req({ body: { slug: 'axis', company: 'Axis' } }), res(), deps);
    const u = res();
    await handleUpdateSaved(req({ params: { slug: 'axis' }, body: { note: '  called Tue  ', status: 'contacted' } }), u, deps);
    expect(u.statusCode).toBe(200);
    expect((u.body as any).saved.note).toBe('called Tue'); // trimmed
    expect((u.body as any).saved.status).toBe('contacted');
  });

  it('rejects an out-of-range status (422)', async () => {
    asUser(1);
    await handleSave(req({ body: { slug: 'axis', company: 'Axis' } }), res(), deps);
    const u = res();
    await handleUpdateSaved(req({ params: { slug: 'axis' }, body: { status: 'bogus' } }), u, deps);
    expect(u.statusCode).toBe(422);
  });

  it('update of a non-saved importer is 404', async () => {
    asUser(1);
    const u = res();
    await handleUpdateSaved(req({ params: { slug: 'never-saved' }, body: { note: 'x' } }), u, deps);
    expect(u.statusCode).toBe(404);
  });

  it('removes a saved importer', async () => {
    asUser(1);
    await handleSave(req({ body: { slug: 'axis', company: 'Axis' } }), res(), deps);
    const d = res();
    await handleRemoveSaved(req({ params: { slug: 'axis' } }), d, deps);
    expect(d.statusCode).toBe(200);
    const g = res();
    await handleGetSaved(req(), g, deps);
    expect((g.body as any).saved).toHaveLength(0);
  });
});
