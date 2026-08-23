/**
 * Directory Pro — SAVED LISTS store (PR D).
 *
 * The DB seam behind the saved-lists endpoints (routes/savedLists.ts): all
 * saved_lists / saved_list_items access lives here so the route handlers stay
 * pure and unit-testable against an in-memory double. Every method scopes writes
 * and ownership checks by `userId`, so a user can only ever touch their own
 * lists (defence-in-depth on top of the route-layer entitlement gate).
 *
 * Carrier rows for a saved list are joined from `carrier_directory` by USDOT via
 * `CarrierLookup` (same identity the rest of the directory uses) so the saved
 * view renders real carrier rows, preserving the saved order.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { savedLists, savedListItems, carrierDirectory } from '../../db/schema.js';
import { visibleCarrier, type VisibleCarrier } from './queries.js';

export interface SavedListSummary {
  id: number;
  name: string;
  /** Number of carriers currently in the list. */
  count: number;
}

/** Ownership + name of a list, or null when the list is not owned / absent. */
export interface SavedListMeta {
  id: number;
  name: string;
}

/** The saved_lists / saved_list_items persistence seam. */
export interface SavedListsStore {
  /** All of the user's lists (newest-updated first) with item counts. */
  listsForUser(userId: number): Promise<SavedListSummary[]>;
  /** The list's id+name IF it belongs to the user, else null (ownership check). */
  getListMeta(userId: number, listId: number): Promise<SavedListMeta | null>;
  /** How many lists the user already owns (for the per-user cap). */
  countListsForUser(userId: number): Promise<number>;
  /** Create a list for the user. Returns the new (empty) list summary. */
  createList(userId: number, name: string): Promise<SavedListSummary>;
  /** Delete a list the user owns. True when a row was deleted (owned + existed). */
  deleteList(userId: number, listId: number): Promise<boolean>;
  /** How many carriers are in a list (for the per-list cap). */
  countItems(listId: number): Promise<number>;
  /** True when the carrier is already saved in the list. */
  hasItem(listId: number, carrierDot: string): Promise<boolean>;
  /** Add a carrier to a list. Idempotent (no-op on the UNIQUE(list,dot) conflict). */
  addItem(listId: number, carrierDot: string): Promise<void>;
  /** Remove a carrier from a list (no-op when absent). */
  removeItem(listId: number, carrierDot: string): Promise<void>;
  /** The saved carrier USDOTs for a list, in saved order (newest first). */
  itemDots(listId: number): Promise<string[]>;
}

/** Resolve saved USDOTs → real carrier rows for the saved view. */
export interface CarrierLookup {
  byDots(dots: string[]): Promise<VisibleCarrier[]>;
}

/** Touch a list's updated_at so "recently used" ordering stays meaningful. */
async function touchList(listId: number): Promise<void> {
  await db().update(savedLists).set({ updatedAt: new Date() }).where(eq(savedLists.id, listId));
}

/** Default DB-backed store. */
export const dbSavedListsStore: SavedListsStore = {
  async listsForUser(userId) {
    const rows = await db()
      .select({
        id: savedLists.id,
        name: savedLists.name,
        count: sql<number>`count(${savedListItems.id})::int`,
      })
      .from(savedLists)
      .leftJoin(savedListItems, eq(savedListItems.listId, savedLists.id))
      .where(eq(savedLists.userId, userId))
      .groupBy(savedLists.id)
      .orderBy(desc(savedLists.updatedAt));
    return rows.map((r) => ({ id: r.id, name: r.name, count: r.count ?? 0 }));
  },

  async getListMeta(userId, listId) {
    const row = (
      await db()
        .select({ id: savedLists.id, name: savedLists.name })
        .from(savedLists)
        .where(and(eq(savedLists.id, listId), eq(savedLists.userId, userId)))
        .limit(1)
    )[0];
    return row ?? null;
  },

  async countListsForUser(userId) {
    const row = await db()
      .select({ n: sql<number>`count(*)::int` })
      .from(savedLists)
      .where(eq(savedLists.userId, userId));
    return row[0]?.n ?? 0;
  },

  async createList(userId, name) {
    const row = (
      await db()
        .insert(savedLists)
        .values({ userId, name })
        .returning({ id: savedLists.id, name: savedLists.name })
    )[0];
    return { id: row.id, name: row.name, count: 0 };
  },

  async deleteList(userId, listId) {
    const deleted = await db()
      .delete(savedLists)
      .where(and(eq(savedLists.id, listId), eq(savedLists.userId, userId)))
      .returning({ id: savedLists.id });
    return deleted.length > 0;
  },

  async countItems(listId) {
    const row = await db()
      .select({ n: sql<number>`count(*)::int` })
      .from(savedListItems)
      .where(eq(savedListItems.listId, listId));
    return row[0]?.n ?? 0;
  },

  async hasItem(listId, carrierDot) {
    const row = await db()
      .select({ id: savedListItems.id })
      .from(savedListItems)
      .where(and(eq(savedListItems.listId, listId), eq(savedListItems.carrierDot, carrierDot)))
      .limit(1);
    return row.length > 0;
  },

  async addItem(listId, carrierDot) {
    await db()
      .insert(savedListItems)
      .values({ listId, carrierDot })
      .onConflictDoNothing({ target: [savedListItems.listId, savedListItems.carrierDot] });
    await touchList(listId);
  },

  async removeItem(listId, carrierDot) {
    await db()
      .delete(savedListItems)
      .where(and(eq(savedListItems.listId, listId), eq(savedListItems.carrierDot, carrierDot)));
    await touchList(listId);
  },

  async itemDots(listId) {
    const rows = await db()
      .select({ dot: savedListItems.carrierDot })
      .from(savedListItems)
      .where(eq(savedListItems.listId, listId))
      .orderBy(desc(savedListItems.addedAt), desc(savedListItems.id));
    return rows.map((r) => r.dot);
  },
};

/** Default carrier lookup — joins carrier_directory by USDOT, preserving the
 *  caller's dot order (saved order) and dropping any DOT no longer in the
 *  directory. Never throws: a read failure degrades to an empty set. */
export const dbCarrierLookup: CarrierLookup = {
  async byDots(dots) {
    const clean = [...new Set(dots.filter((d) => d != null && String(d).trim() !== ''))];
    if (clean.length === 0) return [];
    try {
      const rows = await db()
        .select()
        .from(carrierDirectory)
        .where(inArray(carrierDirectory.usdot, clean));
      const byDot = new Map(rows.map((r) => [r.usdot, visibleCarrier(r)]));
      // Preserve the requested (saved) order; skip dots with no directory row.
      return clean.map((d) => byDot.get(d)).filter((c): c is VisibleCarrier => c != null);
    } catch (err) {
      console.warn('[directory.savedLists] carrier lookup failed; serving empty set:', err);
      return [];
    }
  },
};
