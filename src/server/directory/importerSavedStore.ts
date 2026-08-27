/**
 * Importer Search — SAVED IMPORTERS store (broker workflow).
 *
 * The DB seam behind the importer-saved endpoints (routes/importerSaved.ts). All
 * `importer_saved` access lives here so the route handlers stay pure and
 * unit-testable against an in-memory double. Every method scopes reads/writes by
 * `userId`, so a user can only ever touch their own saved importers.
 *
 * Distinct from the carrier `savedListsStore` (which groups carriers into named
 * lists): this is a FLAT per-user set of saved importers, each keyed by the
 * ImportYeti company slug, carrying a broker note + pipeline status. Saving is
 * free for any logged-in user (no Directory Pro entitlement).
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { importerSaved } from '../../db/schema.js';

export interface SavedImporter {
  slug: string;
  company: string;
  note: string | null;
  status: string | null;
  updatedAt: Date;
}

/** A partial update to a saved importer's note / status. */
export interface SavedImporterPatch {
  note?: string | null;
  status?: string | null;
}

/** The importer_saved persistence seam. */
export interface ImporterSavedStore {
  /** All of the user's saved importers (newest-updated first). */
  listForUser(userId: number): Promise<SavedImporter[]>;
  /** The saved slugs for a user (for hydrating result-card star states). */
  savedSlugs(userId: number): Promise<string[]>;
  /** How many importers the user already has saved (for the per-user cap). */
  countForUser(userId: number): Promise<number>;
  /** True when the importer is already saved by the user. */
  has(userId: number, slug: string): Promise<boolean>;
  /**
   * Save an importer for the user (idempotent upsert on UNIQUE(user, slug)). On a
   * re-save the company snapshot refreshes and any provided note/status is set;
   * an omitted note/status is left unchanged. Returns the resulting row.
   */
  save(userId: number, slug: string, company: string, patch?: SavedImporterPatch): Promise<SavedImporter>;
  /** Update a saved importer's note / status. Null when not owned / absent. */
  update(userId: number, slug: string, patch: SavedImporterPatch): Promise<SavedImporter | null>;
  /** Remove a saved importer (no-op when absent). True when a row was deleted. */
  remove(userId: number, slug: string): Promise<boolean>;
}

function toSaved(r: {
  slug: string;
  company: string;
  note: string | null;
  status: string | null;
  updatedAt: Date;
}): SavedImporter {
  return { slug: r.slug, company: r.company, note: r.note, status: r.status, updatedAt: r.updatedAt };
}

/** Default DB-backed store. */
export const dbImporterSavedStore: ImporterSavedStore = {
  async listForUser(userId) {
    const rows = await db()
      .select({
        slug: importerSaved.slug,
        company: importerSaved.company,
        note: importerSaved.note,
        status: importerSaved.status,
        updatedAt: importerSaved.updatedAt,
      })
      .from(importerSaved)
      .where(eq(importerSaved.userId, userId))
      .orderBy(desc(importerSaved.updatedAt), desc(importerSaved.id));
    return rows.map(toSaved);
  },

  async savedSlugs(userId) {
    const rows = await db()
      .select({ slug: importerSaved.slug })
      .from(importerSaved)
      .where(eq(importerSaved.userId, userId));
    return rows.map((r) => r.slug);
  },

  async countForUser(userId) {
    const row = await db()
      .select({ n: sql<number>`count(*)::int` })
      .from(importerSaved)
      .where(eq(importerSaved.userId, userId));
    return row[0]?.n ?? 0;
  },

  async has(userId, slug) {
    const row = await db()
      .select({ id: importerSaved.id })
      .from(importerSaved)
      .where(and(eq(importerSaved.userId, userId), eq(importerSaved.slug, slug)))
      .limit(1);
    return row.length > 0;
  },

  async save(userId, slug, company, patch = {}) {
    // Build the mutable set for an upsert: always refresh company + updated_at;
    // set note/status only when explicitly provided (undefined ⇒ leave as-is).
    const setOnConflict: Record<string, unknown> = { company, updatedAt: new Date() };
    if (patch.note !== undefined) setOnConflict.note = patch.note;
    if (patch.status !== undefined) setOnConflict.status = patch.status;
    const row = (
      await db()
        .insert(importerSaved)
        .values({
          userId,
          slug,
          company,
          note: patch.note ?? null,
          status: patch.status ?? null,
        })
        .onConflictDoUpdate({
          target: [importerSaved.userId, importerSaved.slug],
          set: setOnConflict,
        })
        .returning({
          slug: importerSaved.slug,
          company: importerSaved.company,
          note: importerSaved.note,
          status: importerSaved.status,
          updatedAt: importerSaved.updatedAt,
        })
    )[0];
    return toSaved(row);
  },

  async update(userId, slug, patch) {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.note !== undefined) set.note = patch.note;
    if (patch.status !== undefined) set.status = patch.status;
    const row = (
      await db()
        .update(importerSaved)
        .set(set)
        .where(and(eq(importerSaved.userId, userId), eq(importerSaved.slug, slug)))
        .returning({
          slug: importerSaved.slug,
          company: importerSaved.company,
          note: importerSaved.note,
          status: importerSaved.status,
          updatedAt: importerSaved.updatedAt,
        })
    )[0];
    return row ? toSaved(row) : null;
  },

  async remove(userId, slug) {
    const deleted = await db()
      .delete(importerSaved)
      .where(and(eq(importerSaved.userId, userId), eq(importerSaved.slug, slug)))
      .returning({ id: importerSaved.id });
    return deleted.length > 0;
  },
};
