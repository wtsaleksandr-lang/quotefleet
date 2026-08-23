/**
 * Directory Pro — SAVED LISTS endpoints (PR D).
 *
 * A logged-in SHIPPER saves carriers into named lists and revisits them. Saved
 * lists are a Directory Pro feature, so every route gates twice:
 *   • no session (userId == null)        → 401 { reason: 'needs-account' }
 *   • session but not Directory Pro       → 403 { reason: 'needs-pro' }
 * The client save widget reads that discriminator to show a sign-in prompt or
 * the "$19/mo" upgrade CTA; a Pro caller gets the real list operations.
 *
 * Ownership is enforced on EVERY route: a user can only see / mutate their own
 * lists (the store scopes by userId; a foreign / missing list → 404). Zod
 * validates names (trim, 1–80) and carrier DOTs; per-user (50) and per-list
 * (500) caps are enforced. Adds are idempotent on UNIQUE(list_id, carrier_dot)
 * and NEVER 500 on a duplicate. Every catch logs and degrades to a JSON error.
 *
 * JSON API (all under /api/directory/lists):
 *   GET    /                       → the user's lists + item counts
 *   POST   /            {name}      → create a list
 *   DELETE /:id                     → delete a list the user owns
 *   POST   /:id/items   {carrierDot}→ add a carrier (idempotent)
 *   DELETE /:id/items/:carrierDot   → remove a carrier
 *   GET    /:id                     → a list + its carriers (joined to directory)
 *
 * Server-rendered page:
 *   GET /directory/lists            → the Pro-gated saved-lists view
 */
import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { directoryIdentity, hasDirectoryPro } from '../directory/entitlement.js';
import {
  dbSavedListsStore,
  dbCarrierLookup,
  type SavedListsStore,
  type CarrierLookup,
} from '../directory/savedListsStore.js';
import { renderSavedListsPage, renderSavedListsUpsell } from '../directory/pages.js';

/** Defaults for the two caps (overridable via deps for tests). */
export const DEFAULT_MAX_LISTS_PER_USER = 50;
export const DEFAULT_MAX_ITEMS_PER_LIST = 500;

const UPGRADE_URL = '/signup?plan=directory-pro';

export interface SavedListsDeps {
  store?: SavedListsStore;
  carriers?: CarrierLookup;
  maxLists?: number;
  maxItems?: number;
}

const nameSchema = z.string().trim().min(1).max(80);
// USDOT is numeric in the FMCSA census; accept a trimmed digit string (bounded).
const dotSchema = z
  .string()
  .trim()
  .min(1)
  .max(15)
  .regex(/^[0-9]+$/);

const listIdParam = (raw: unknown): number | null => {
  const n = Number.parseInt(String(raw ?? ''), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * Resolve the caller to a Pro shipper user id, or write the gate response and
 * return null. Centralises the needs-account (401) / needs-pro (403) discriminator.
 */
async function gate(req: Request, res: Response): Promise<{ userId: number } | null> {
  const identity = await directoryIdentity(req);
  if (identity.userId == null) {
    res.status(401).json({ ok: false, reason: 'needs-account', loginUrl: '/login' });
    return null;
  }
  if (!(await hasDirectoryPro(req))) {
    res.status(403).json({ ok: false, reason: 'needs-pro', upgradeUrl: UPGRADE_URL });
    return null;
  }
  return { userId: identity.userId };
}

// ─── Handlers (pure; entitlement mocked + store injected in tests) ─────────

export async function handleGetLists(req: Request, res: Response, deps: SavedListsDeps = {}): Promise<void> {
  try {
    const auth = await gate(req, res);
    if (!auth) return;
    const store = deps.store ?? dbSavedListsStore;
    const lists = await store.listsForUser(auth.userId);
    res.json({ ok: true, lists });
  } catch (err) {
    console.error('[directory.savedLists] getLists failed:', err);
    res.status(500).json({ ok: false, reason: 'error' });
  }
}

export async function handleCreateList(req: Request, res: Response, deps: SavedListsDeps = {}): Promise<void> {
  try {
    const auth = await gate(req, res);
    if (!auth) return;
    const parsed = nameSchema.safeParse((req.body ?? {}).name);
    if (!parsed.success) {
      res.status(422).json({ ok: false, reason: 'invalid-name' });
      return;
    }
    const store = deps.store ?? dbSavedListsStore;
    const maxLists = deps.maxLists ?? DEFAULT_MAX_LISTS_PER_USER;
    if ((await store.countListsForUser(auth.userId)) >= maxLists) {
      res.status(409).json({ ok: false, reason: 'list-cap', max: maxLists });
      return;
    }
    const list = await store.createList(auth.userId, parsed.data);
    res.status(201).json({ ok: true, list });
  } catch (err) {
    console.error('[directory.savedLists] createList failed:', err);
    res.status(500).json({ ok: false, reason: 'error' });
  }
}

export async function handleDeleteList(req: Request, res: Response, deps: SavedListsDeps = {}): Promise<void> {
  try {
    const auth = await gate(req, res);
    if (!auth) return;
    const listId = listIdParam(req.params.id);
    if (listId == null) {
      res.status(404).json({ ok: false, reason: 'not-found' });
      return;
    }
    const store = deps.store ?? dbSavedListsStore;
    const deleted = await store.deleteList(auth.userId, listId);
    if (!deleted) {
      res.status(404).json({ ok: false, reason: 'not-found' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[directory.savedLists] deleteList failed:', err);
    res.status(500).json({ ok: false, reason: 'error' });
  }
}

export async function handleAddItem(req: Request, res: Response, deps: SavedListsDeps = {}): Promise<void> {
  try {
    const auth = await gate(req, res);
    if (!auth) return;
    const listId = listIdParam(req.params.id);
    if (listId == null) {
      res.status(404).json({ ok: false, reason: 'not-found' });
      return;
    }
    const parsed = dotSchema.safeParse((req.body ?? {}).carrierDot);
    if (!parsed.success) {
      res.status(422).json({ ok: false, reason: 'invalid-dot' });
      return;
    }
    const store = deps.store ?? dbSavedListsStore;
    const meta = await store.getListMeta(auth.userId, listId); // ownership check
    if (!meta) {
      res.status(404).json({ ok: false, reason: 'not-found' });
      return;
    }
    const dot = parsed.data;
    const maxItems = deps.maxItems ?? DEFAULT_MAX_ITEMS_PER_LIST;
    const already = await store.hasItem(listId, dot);
    if (!already && (await store.countItems(listId)) >= maxItems) {
      res.status(409).json({ ok: false, reason: 'item-cap', max: maxItems });
      return;
    }
    // Idempotent: a duplicate add is a no-op and still returns 200, never a 500.
    await store.addItem(listId, dot);
    res.json({ ok: true, listId, carrierDot: dot, count: await store.countItems(listId), added: !already });
  } catch (err) {
    console.error('[directory.savedLists] addItem failed:', err);
    res.status(500).json({ ok: false, reason: 'error' });
  }
}

export async function handleRemoveItem(req: Request, res: Response, deps: SavedListsDeps = {}): Promise<void> {
  try {
    const auth = await gate(req, res);
    if (!auth) return;
    const listId = listIdParam(req.params.id);
    if (listId == null) {
      res.status(404).json({ ok: false, reason: 'not-found' });
      return;
    }
    const parsed = dotSchema.safeParse(req.params.carrierDot);
    if (!parsed.success) {
      res.status(422).json({ ok: false, reason: 'invalid-dot' });
      return;
    }
    const store = deps.store ?? dbSavedListsStore;
    const meta = await store.getListMeta(auth.userId, listId); // ownership check
    if (!meta) {
      res.status(404).json({ ok: false, reason: 'not-found' });
      return;
    }
    await store.removeItem(listId, parsed.data);
    res.json({ ok: true, listId, carrierDot: parsed.data, count: await store.countItems(listId) });
  } catch (err) {
    console.error('[directory.savedLists] removeItem failed:', err);
    res.status(500).json({ ok: false, reason: 'error' });
  }
}

export async function handleGetList(req: Request, res: Response, deps: SavedListsDeps = {}): Promise<void> {
  try {
    const auth = await gate(req, res);
    if (!auth) return;
    const listId = listIdParam(req.params.id);
    if (listId == null) {
      res.status(404).json({ ok: false, reason: 'not-found' });
      return;
    }
    const store = deps.store ?? dbSavedListsStore;
    const meta = await store.getListMeta(auth.userId, listId); // ownership check
    if (!meta) {
      res.status(404).json({ ok: false, reason: 'not-found' });
      return;
    }
    const carriers = deps.carriers ?? dbCarrierLookup;
    const dots = await store.itemDots(listId);
    const rows = dots.length ? await carriers.byDots(dots) : [];
    res.json({
      ok: true,
      list: { id: meta.id, name: meta.name },
      carriers: rows.map((c) => ({
        slug: c.slug,
        usdot: c.usdot,
        name: c.dbaName && (c.dbaName.includes(' ') || c.dbaName.length >= 8) ? c.dbaName : c.legalName,
        city: c.city,
        state: c.state,
      })),
    });
  } catch (err) {
    console.error('[directory.savedLists] getList failed:', err);
    res.status(500).json({ ok: false, reason: 'error' });
  }
}

/**
 * Server-rendered saved-lists view (Pro-gated). Anonymous / free users get the
 * upsell (sign-in or upgrade); a Pro shipper gets their lists with the saved
 * carriers rendered as directory rows. Never 500s — a store failure degrades to
 * an empty lists view.
 */
export async function handleListsPage(req: Request, res: Response, deps: SavedListsDeps = {}): Promise<void> {
  try {
    const identity = await directoryIdentity(req);
    if (identity.userId == null) {
      res.status(200).type('html').send(renderSavedListsUpsell('needs-account'));
      return;
    }
    if (!(await hasDirectoryPro(req))) {
      res.status(200).type('html').send(renderSavedListsUpsell('needs-pro'));
      return;
    }
    const store = deps.store ?? dbSavedListsStore;
    const carriers = deps.carriers ?? dbCarrierLookup;
    const summaries = await store.listsForUser(identity.userId);
    // Load each list's carriers (saved order) for the server-rendered view.
    const lists = await Promise.all(
      summaries.map(async (s) => {
        const dots = await store.itemDots(s.id);
        const rows = dots.length ? await carriers.byDots(dots) : [];
        return { id: s.id, name: s.name, carriers: rows };
      }),
    );
    res.status(200).type('html').send(renderSavedListsPage({ lists }));
  } catch (err) {
    console.error('[directory.savedLists] lists page failed:', err);
    res.status(200).type('html').send(renderSavedListsPage({ lists: [] }));
  }
}

export function registerSavedListsRoutes(app: Express, deps: SavedListsDeps = {}): void {
  // Server-rendered page — MUST be registered before /directory/:stateSlug so
  // "lists" is not swallowed as a state slug (see app.ts ordering).
  app.get(['/directory/lists', '/directory/lists/'], (req, res) => handleListsPage(req, res, deps));

  // JSON API.
  app.get('/api/directory/lists', (req, res) => handleGetLists(req, res, deps));
  app.post('/api/directory/lists', (req, res) => handleCreateList(req, res, deps));
  app.get('/api/directory/lists/:id', (req, res) => handleGetList(req, res, deps));
  app.delete('/api/directory/lists/:id', (req, res) => handleDeleteList(req, res, deps));
  app.post('/api/directory/lists/:id/items', (req, res) => handleAddItem(req, res, deps));
  app.delete('/api/directory/lists/:id/items/:carrierDot', (req, res) => handleRemoveItem(req, res, deps));
}
