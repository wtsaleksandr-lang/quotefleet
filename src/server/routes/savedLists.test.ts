/**
 * Directory Pro SAVED LISTS endpoints (routes/savedLists.ts) — gating, ownership,
 * idempotent adds, caps and the joined-carrier view. Entitlement is mocked and
 * an in-memory store + carrier lookup are injected, so this is a pure offline
 * unit test (no DB, no express app).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../directory/entitlement.js', () => ({
  hasDirectoryPro: vi.fn(),
  directoryIdentity: vi.fn(),
}));
import { hasDirectoryPro, directoryIdentity } from '../directory/entitlement.js';
import {
  handleGetLists,
  handleCreateList,
  handleDeleteList,
  handleAddItem,
  handleAddItemsBatch,
  handleRemoveItem,
  handleGetList,
  type SavedListsDeps,
} from './savedLists.js';
import type { SavedListsStore, CarrierLookup } from '../directory/savedListsStore.js';
import type { VisibleCarrier } from '../directory/queries.js';

// ─── Test doubles ──────────────────────────────────────────────────────────
function res() {
  const r = {
    statusCode: 200,
    body: undefined as unknown,
    _type: '',
    status(c: number) {
      this.statusCode = c;
      return this;
    },
    json(b: unknown) {
      this.body = b;
      return this;
    },
    type(t: string) {
      this._type = t;
      return this;
    },
    send(b: unknown) {
      this.body = b;
      return this;
    },
  };
  return r as unknown as Response & { statusCode: number; body: any; _type: string };
}

function req(opts: { params?: Record<string, unknown>; body?: unknown } = {}): Request {
  return { params: opts.params ?? {}, body: opts.body } as unknown as Request;
}

/** In-memory SavedListsStore with per-user ownership tracking. */
function memStore(): SavedListsStore {
  let seq = 1;
  const lists = new Map<number, { id: number; userId: number; name: string; updatedAt: number }>();
  const items = new Map<number, string[]>();
  return {
    async listsForUser(userId) {
      return [...lists.values()]
        .filter((l) => l.userId === userId)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((l) => ({ id: l.id, name: l.name, count: (items.get(l.id) ?? []).length }));
    },
    async getListMeta(userId, listId) {
      const l = lists.get(listId);
      return l && l.userId === userId ? { id: l.id, name: l.name } : null;
    },
    async countListsForUser(userId) {
      return [...lists.values()].filter((l) => l.userId === userId).length;
    },
    async createList(userId, name) {
      const id = seq++;
      lists.set(id, { id, userId, name, updatedAt: Date.now() + id });
      items.set(id, []);
      return { id, name, count: 0 };
    },
    async deleteList(userId, listId) {
      const l = lists.get(listId);
      if (!l || l.userId !== userId) return false;
      lists.delete(listId);
      items.delete(listId);
      return true;
    },
    async countItems(listId) {
      return (items.get(listId) ?? []).length;
    },
    async hasItem(listId, dot) {
      return (items.get(listId) ?? []).includes(dot);
    },
    async addItem(listId, dot) {
      const arr = items.get(listId) ?? [];
      if (!arr.includes(dot)) arr.unshift(dot);
      items.set(listId, arr);
    },
    async removeItem(listId, dot) {
      items.set(listId, (items.get(listId) ?? []).filter((d) => d !== dot));
    },
    async itemDots(listId) {
      return [...(items.get(listId) ?? [])];
    },
  };
}

const carriers: CarrierLookup = {
  async byDots(dots) {
    return dots.map(
      (d) =>
        ({
          slug: `carrier-${d}`,
          legalName: `Carrier ${d} LLC`,
          dbaName: null,
          usdot: d,
          city: 'Newark',
          state: 'NJ',
        }) as unknown as VisibleCarrier,
    );
  },
};

/** Point the mocked entitlement at a given user (Pro by default). */
function asUser(userId: number | null, isPro = true) {
  vi.mocked(directoryIdentity).mockResolvedValue({
    userId,
    email: userId ? `u${userId}@co.com` : null,
    isPro,
    status: isPro ? 'active' : null,
    currentPeriodEnd: null,
  });
  vi.mocked(hasDirectoryPro).mockResolvedValue(isPro);
}

beforeEach(() => {
  vi.mocked(directoryIdentity).mockReset();
  vi.mocked(hasDirectoryPro).mockReset();
  asUser(7, true);
});

// ─── Gating ────────────────────────────────────────────────────────────────
describe('savedLists — gating', () => {
  it('no session → 401 needs-account (never a 500)', async () => {
    asUser(null, false);
    const r = res();
    await handleGetLists(req(), r, { store: memStore(), carriers });
    expect(r.statusCode).toBe(401);
    expect(r.body.reason).toBe('needs-account');
  });

  it('logged-in but not Pro → 403 needs-pro with an upgrade path (never a 500)', async () => {
    asUser(7, false);
    const r = res();
    await handleCreateList(req({ body: { name: 'Reefer shortlist' } }), r, { store: memStore(), carriers });
    expect(r.statusCode).toBe(403);
    expect(r.body.reason).toBe('needs-pro');
    expect(r.body.upgradeUrl).toContain('directory-pro');
  });
});

// ─── CRUD + validation ───────────────────────────────────────────────────
describe('savedLists — CRUD', () => {
  it('create → list appears in GET with a zero count', async () => {
    const deps: SavedListsDeps = { store: memStore(), carriers };
    const c = res();
    await handleCreateList(req({ body: { name: '  Gulf drayage  ' } }), c, deps);
    expect(c.statusCode).toBe(201);
    expect(c.body.list.name).toBe('Gulf drayage'); // trimmed
    const g = res();
    await handleGetLists(req(), g, deps);
    expect(g.body.ok).toBe(true);
    expect(g.body.lists).toHaveLength(1);
    expect(g.body.lists[0].count).toBe(0);
  });

  it('rejects an empty / oversized name (422)', async () => {
    const deps: SavedListsDeps = { store: memStore(), carriers };
    const empty = res();
    await handleCreateList(req({ body: { name: '   ' } }), empty, deps);
    expect(empty.statusCode).toBe(422);
    const big = res();
    await handleCreateList(req({ body: { name: 'x'.repeat(81) } }), big, deps);
    expect(big.statusCode).toBe(422);
  });

  it('delete removes the list', async () => {
    const deps: SavedListsDeps = { store: memStore(), carriers };
    const c = res();
    await handleCreateList(req({ body: { name: 'Temp' } }), c, deps);
    const id = c.body.list.id;
    const d = res();
    await handleDeleteList(req({ params: { id: String(id) } }), d, deps);
    expect(d.body.ok).toBe(true);
    const g = res();
    await handleGetLists(req(), g, deps);
    expect(g.body.lists).toHaveLength(0);
  });
});

// ─── Multi-select batch save ───────────────────────────────────────────────
describe('savedLists — batch add (multi-select save)', () => {
  async function makeList(deps: SavedListsDeps): Promise<string> {
    const c = res();
    await handleCreateList(req({ body: { name: 'Batch shortlist' } }), c, deps);
    return String(c.body.list.id);
  }

  it('adds every selected carrier to the list in one request', async () => {
    const deps: SavedListsDeps = { store: memStore(), carriers };
    const id = await makeList(deps);
    const b = res();
    await handleAddItemsBatch(req({ params: { id }, body: { carrierDots: ['107080', '880880', '999'] } }), b, deps);
    expect(b.statusCode).toBe(200);
    expect(b.body.ok).toBe(true);
    expect(b.body.added).toBe(3);
    expect(b.body.count).toBe(3);
    // The list now really holds all three (verify the write path via GET).
    const g = res();
    await handleGetList(req({ params: { id } }), g, deps);
    expect(g.body.carriers.map((c: { usdot: string }) => c.usdot).sort()).toEqual(['107080', '880880', '999']);
  });

  it('is idempotent + dedupes: re-saving overlapping selections never double-counts', async () => {
    const deps: SavedListsDeps = { store: memStore(), carriers };
    const id = await makeList(deps);
    await handleAddItemsBatch(req({ params: { id }, body: { carrierDots: ['111', '222'] } }), res(), deps);
    const again = res();
    // '111' repeats within the payload AND is already saved; only '333' is new.
    await handleAddItemsBatch(req({ params: { id }, body: { carrierDots: ['111', '111', '222', '333'] } }), again, deps);
    expect(again.statusCode).toBe(200);
    expect(again.body.added).toBe(1); // only 333
    expect(again.body.count).toBe(3); // 111,222,333 — no duplicates
  });

  it('gates like every other route: 401 anon, 403 non-Pro', async () => {
    const deps: SavedListsDeps = { store: memStore(), carriers };
    asUser(null, false);
    const anon = res();
    await handleAddItemsBatch(req({ params: { id: '1' }, body: { carrierDots: ['1'] } }), anon, deps);
    expect(anon.statusCode).toBe(401);
    asUser(7, false);
    const free = res();
    await handleAddItemsBatch(req({ params: { id: '1' }, body: { carrierDots: ['1'] } }), free, deps);
    expect(free.statusCode).toBe(403);
  });

  it("404s on another user's list (ownership) and 422s an empty/invalid selection", async () => {
    const deps: SavedListsDeps = { store: memStore(), carriers };
    asUser(7, true);
    const id = await makeList(deps);
    asUser(9, true);
    const foreign = res();
    await handleAddItemsBatch(req({ params: { id }, body: { carrierDots: ['1'] } }), foreign, deps);
    expect(foreign.statusCode).toBe(404);
    asUser(7, true);
    const empty = res();
    await handleAddItemsBatch(req({ params: { id }, body: { carrierDots: [] } }), empty, deps);
    expect(empty.statusCode).toBe(422);
    const bad = res();
    await handleAddItemsBatch(req({ params: { id }, body: { carrierDots: ['not-a-dot'] } }), bad, deps);
    expect(bad.statusCode).toBe(422);
  });

  it('stops with 409 item-cap when the batch would exceed the per-list limit', async () => {
    const deps: SavedListsDeps = { store: memStore(), carriers, maxItems: 2 };
    const id = await makeList(deps);
    const capped = res();
    await handleAddItemsBatch(req({ params: { id }, body: { carrierDots: ['1', '2', '3'] } }), capped, deps);
    expect(capped.statusCode).toBe(409);
    expect(capped.body.reason).toBe('item-cap');
    expect(capped.body.added).toBe(2); // filled to the cap, then stopped
  });
});

// ─── Ownership ─────────────────────────────────────────────────────────────
describe('savedLists — ownership', () => {
  it("a user cannot read, add to, remove from or delete another user's list → 404", async () => {
    const store = memStore();
    const deps: SavedListsDeps = { store, carriers };
    // User 7 creates a list.
    asUser(7, true);
    const c = res();
    await handleCreateList(req({ body: { name: 'Sevens' } }), c, deps);
    const id = c.body.list.id;

    // User 9 (also Pro) must not touch it — every endpoint 404s.
    asUser(9, true);
    const g = res();
    await handleGetList(req({ params: { id: String(id) } }), g, deps);
    expect(g.statusCode).toBe(404);
    const del = res();
    await handleDeleteList(req({ params: { id: String(id) } }), del, deps);
    expect(del.statusCode).toBe(404);
    const add = res();
    await handleAddItem(req({ params: { id: String(id) }, body: { carrierDot: '107080' } }), add, deps);
    expect(add.statusCode).toBe(404);
    const rm = res();
    await handleRemoveItem(req({ params: { id: String(id), carrierDot: '107080' } }), rm, deps);
    expect(rm.statusCode).toBe(404);

    // And the owner's list is untouched.
    asUser(7, true);
    const owner = res();
    await handleGetList(req({ params: { id: String(id) } }), owner, deps);
    expect(owner.statusCode).toBe(200);
    expect(owner.body.ok).toBe(true);
  });
});

// ─── Items: idempotent add, remove, joined carrier view ──────────────────
describe('savedLists — items', () => {
  it('adding the same carrier twice is idempotent (no dup, no 500)', async () => {
    const deps: SavedListsDeps = { store: memStore(), carriers };
    const c = res();
    await handleCreateList(req({ body: { name: 'Dupes' } }), c, deps);
    const id = String(c.body.list.id);

    const a1 = res();
    await handleAddItem(req({ params: { id }, body: { carrierDot: '107080' } }), a1, deps);
    expect(a1.body.ok).toBe(true);
    expect(a1.body.count).toBe(1);
    expect(a1.body.added).toBe(true);

    const a2 = res();
    await handleAddItem(req({ params: { id }, body: { carrierDot: '107080' } }), a2, deps);
    expect(a2.statusCode).toBe(200);
    expect(a2.body.ok).toBe(true);
    expect(a2.body.count).toBe(1); // still one
    expect(a2.body.added).toBe(false);
  });

  it('rejects a non-numeric carrier DOT (422)', async () => {
    const deps: SavedListsDeps = { store: memStore(), carriers };
    const c = res();
    await handleCreateList(req({ body: { name: 'Bad dot' } }), c, deps);
    const id = String(c.body.list.id);
    const a = res();
    await handleAddItem(req({ params: { id }, body: { carrierDot: 'DROP TABLE' } }), a, deps);
    expect(a.statusCode).toBe(422);
  });

  it('GET :id renders the saved carriers joined to directory data', async () => {
    const deps: SavedListsDeps = { store: memStore(), carriers };
    const c = res();
    await handleCreateList(req({ body: { name: 'Joined' } }), c, deps);
    const id = String(c.body.list.id);
    await handleAddItem(req({ params: { id }, body: { carrierDot: '111' } }), res(), deps);
    await handleAddItem(req({ params: { id }, body: { carrierDot: '222' } }), res(), deps);

    const g = res();
    await handleGetList(req({ params: { id } }), g, deps);
    expect(g.body.ok).toBe(true);
    expect(g.body.carriers).toHaveLength(2);
    // Real carrier fields from the lookup are present (name/city/state).
    expect(g.body.carriers[0]).toMatchObject({ name: expect.stringContaining('Carrier'), city: 'Newark', state: 'NJ' });
    expect(g.body.carriers.map((x: { usdot: string }) => x.usdot).sort()).toEqual(['111', '222']);
  });

  it('remove drops the carrier from the list', async () => {
    const deps: SavedListsDeps = { store: memStore(), carriers };
    const c = res();
    await handleCreateList(req({ body: { name: 'Removable' } }), c, deps);
    const id = String(c.body.list.id);
    await handleAddItem(req({ params: { id }, body: { carrierDot: '111' } }), res(), deps);
    const rm = res();
    await handleRemoveItem(req({ params: { id, carrierDot: '111' } }), rm, deps);
    expect(rm.body.ok).toBe(true);
    expect(rm.body.count).toBe(0);
  });
});

// ─── Caps ────────────────────────────────────────────────────────────────
describe('savedLists — caps', () => {
  it('enforces the per-user list cap (409 list-cap)', async () => {
    const deps: SavedListsDeps = { store: memStore(), carriers, maxLists: 2 };
    await handleCreateList(req({ body: { name: 'A' } }), res(), deps);
    await handleCreateList(req({ body: { name: 'B' } }), res(), deps);
    const third = res();
    await handleCreateList(req({ body: { name: 'C' } }), third, deps);
    expect(third.statusCode).toBe(409);
    expect(third.body.reason).toBe('list-cap');
  });

  it('enforces the per-list item cap, but an already-saved carrier still succeeds', async () => {
    const deps: SavedListsDeps = { store: memStore(), carriers, maxItems: 2 };
    const c = res();
    await handleCreateList(req({ body: { name: 'Full' } }), c, deps);
    const id = String(c.body.list.id);
    await handleAddItem(req({ params: { id }, body: { carrierDot: '1' } }), res(), deps);
    await handleAddItem(req({ params: { id }, body: { carrierDot: '2' } }), res(), deps);
    // A NEW carrier at the cap is rejected.
    const capped = res();
    await handleAddItem(req({ params: { id }, body: { carrierDot: '3' } }), capped, deps);
    expect(capped.statusCode).toBe(409);
    expect(capped.body.reason).toBe('item-cap');
    // Re-adding one already in the list is still fine (idempotent).
    const dup = res();
    await handleAddItem(req({ params: { id }, body: { carrierDot: '1' } }), dup, deps);
    expect(dup.statusCode).toBe(200);
    expect(dup.body.ok).toBe(true);
  });
});
