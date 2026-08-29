/**
 * Storage helpers for the /guides SEO content engine.
 *
 * Three responsibilities:
 *   1. seo_engine_settings — the singleton DB kill-switch row.
 *   2. seo_content_pages write path — the generator files in_review drafts; the
 *      admin queue lists / edits / approves / rejects them.
 *   3. seo_content_pages read path — published-only fetch for the public route
 *      and the sitemap.
 *
 * THE ANTI-AUTO-PUBLISH GUARANTEE lives here, structurally:
 *   • createSeoContentDraft REFUSES status='published'. The generator has no
 *     path to a live page, even if a caller passed the wrong status.
 *   • approveSeoPage is the ONLY function that writes status='published', and
 *     it only promotes a row that is currently 'in_review', in the same call
 *     that appends the audit row. So "published" always has a named actor and a
 *     timestamp behind it.
 *   • the public read path filters status='published' in ONE place, so a draft
 *     can never leak into a render or the sitemap.
 *
 * Reads degrade rather than throw (the house pattern — see
 * directory/queries.ts): a failure serves an empty-but-valid shape and warns,
 * because a broken guides section must never take a page down with it.
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  seoContentApprovals,
  seoContentPages,
  seoEngineSettings,
  type NewSeoContentApproval,
  type NewSeoContentPage,
  type SeoContentApproval,
  type SeoContentPage,
  type SeoEngineSettingsRow,
} from '../../db/schema.js';

/** The surface discriminator — every row this engine writes carries it, so the
 *  sitemap/public queries stay unambiguous if another surface is ever added. */
export const SEO_SURFACE = 'qf_seo';

/* ─── Kill-switch singleton ───────────────────────────────────────────── */

export async function getSeoEngineSettings(): Promise<SeoEngineSettingsRow> {
  const [row] = await db().select().from(seoEngineSettings).where(eq(seoEngineSettings.id, 1)).limit(1);
  if (row) return row;
  const [created] = await db()
    .insert(seoEngineSettings)
    .values({ id: 1 })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  // Race: another caller inserted it first — re-read.
  const [existing] = await db()
    .select()
    .from(seoEngineSettings)
    .where(eq(seoEngineSettings.id, 1))
    .limit(1);
  return existing;
}

export async function setSeoEngineKillSwitch(
  killSwitch: boolean,
  updatedBy?: number,
): Promise<SeoEngineSettingsRow> {
  await getSeoEngineSettings(); // ensure the singleton row exists
  const [row] = await db()
    .update(seoEngineSettings)
    .set({ killSwitch, updatedAt: new Date(), updatedBy: updatedBy ?? null })
    .where(eq(seoEngineSettings.id, 1))
    .returning();
  return row;
}

/* ─── Write path ──────────────────────────────────────────────────────── */

/**
 * Insert a generator draft. Refuses status='published' — the generator must
 * never create a live page. The only path to 'published' is approveSeoPage().
 */
export async function createSeoContentDraft(data: NewSeoContentPage): Promise<SeoContentPage> {
  if (data.status === 'published') {
    throw new Error(
      "createSeoContentDraft refuses status='published' — drafts enter the human-review queue as 'in_review' and are published only via approveSeoPage().",
    );
  }
  const [row] = await db()
    .insert(seoContentPages)
    .values({ ...data, status: data.status ?? 'in_review', surface: SEO_SURFACE })
    .returning();
  return row;
}

/** Append one immutable audit row. */
export async function appendSeoApproval(data: NewSeoContentApproval): Promise<SeoContentApproval> {
  const [row] = await db().insert(seoContentApprovals).values(data).returning();
  return row;
}

export interface SeoEditFields {
  title?: string;
  metaDescription?: string | null;
  excerpt?: string | null;
  content?: string;
  canonical?: string | null;
}

/** Admin EDIT: patch editable fields + append an 'edited' audit row. Editing
 *  does NOT change status — the page stays in the queue; approval is separate. */
export async function editSeoPage(
  pageId: number,
  fields: SeoEditFields,
  actorId?: number,
  notes?: string,
): Promise<SeoContentPage | null> {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of ['title', 'metaDescription', 'excerpt', 'content', 'canonical'] as const) {
    if (fields[k] !== undefined) patch[k] = fields[k];
  }
  const [row] = await db()
    .update(seoContentPages)
    .set(patch)
    .where(eq(seoContentPages.id, pageId))
    .returning();
  if (!row) return null;
  await appendSeoApproval({
    pageId,
    actorType: 'admin',
    actorId: actorId ?? null,
    action: 'edited',
    notes: notes ?? null,
    metadata: { fields: Object.keys(fields) },
  });
  return row;
}

/**
 * Admin APPROVE: in_review → published. The ONLY writer of status='published'.
 * Only an in_review row can be promoted, so an already-published or archived
 * row cannot be double-published; that case returns null and the route 409s.
 */
export async function approveSeoPage(
  pageId: number,
  actorId?: number,
  notes?: string,
): Promise<SeoContentPage | null> {
  const [row] = await db()
    .update(seoContentPages)
    .set({ status: 'published', publishedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(seoContentPages.id, pageId), eq(seoContentPages.status, 'in_review')))
    .returning();
  if (!row) return null;
  await appendSeoApproval({
    pageId,
    actorType: 'admin',
    actorId: actorId ?? null,
    action: 'approved',
    notes: notes ?? null,
    metadata: null,
  });
  return row;
}

/** Admin REJECT: in_review → archived (never deleted — kept for audit). */
export async function rejectSeoPage(
  pageId: number,
  actorId?: number,
  notes?: string,
): Promise<SeoContentPage | null> {
  const [row] = await db()
    .update(seoContentPages)
    .set({ status: 'archived', updatedAt: new Date() })
    .where(and(eq(seoContentPages.id, pageId), eq(seoContentPages.status, 'in_review')))
    .returning();
  if (!row) return null;
  await appendSeoApproval({
    pageId,
    actorType: 'admin',
    actorId: actorId ?? null,
    action: 'rejected',
    notes: notes ?? null,
    metadata: null,
  });
  return row;
}

/* ─── Read path ───────────────────────────────────────────────────────── */

/** Slug existence check across ALL statuses — the generator uses this to skip
 *  cleanly instead of colliding with the unique index. */
export async function seoSlugExists(slug: string): Promise<boolean> {
  const [row] = await db()
    .select({ id: seoContentPages.id })
    .from(seoContentPages)
    .where(eq(seoContentPages.slug, slug))
    .limit(1);
  return !!row;
}

/** Any row by id, regardless of status — the admin preview/approve flow needs
 *  to see in_review + archived rows the public path deliberately hides. */
export async function getSeoPageById(id: number): Promise<SeoContentPage | null> {
  const [row] = await db().select().from(seoContentPages).where(eq(seoContentPages.id, id)).limit(1);
  return row ?? null;
}

/** Drafts awaiting human review, newest first. */
export async function listSeoPagesInReview(): Promise<SeoContentPage[]> {
  try {
    return await db()
      .select()
      .from(seoContentPages)
      .where(eq(seoContentPages.status, 'in_review'))
      .orderBy(desc(seoContentPages.createdAt));
  } catch (err) {
    console.warn('[seo] review queue read failed; serving empty queue:', (err as Error)?.message);
    return [];
  }
}

/** Full audit history for a page, newest first. */
export async function listSeoApprovals(pageId: number): Promise<SeoContentApproval[]> {
  try {
    return await db()
      .select()
      .from(seoContentApprovals)
      .where(eq(seoContentApprovals.pageId, pageId))
      .orderBy(desc(seoContentApprovals.createdAt));
  } catch (err) {
    console.warn('[seo] audit read failed; serving empty history:', (err as Error)?.message);
    return [];
  }
}

/** Fetch a single PUBLISHED page by slug. Returns null for any
 *  missing/draft/in_review/archived slug, so the route redirects to the hub. */
export async function getPublishedSeoPageBySlug(slug: string): Promise<SeoContentPage | null> {
  try {
    const [row] = await db()
      .select()
      .from(seoContentPages)
      .where(and(eq(seoContentPages.slug, slug), eq(seoContentPages.status, 'published')))
      .limit(1);
    return row ?? null;
  } catch (err) {
    console.warn('[seo] published page read failed:', (err as Error)?.message);
    return null;
  }
}

export interface PublishedGuideSummary {
  slug: string;
  title: string;
  excerpt: string;
  authorEntity: string;
  publishedAt: Date | null;
  updatedAt: Date | null;
  sampleSize: number | null;
}

/** Every PUBLISHED guide — the hub index and the sitemap both read this. The
 *  published-only filter lives here so neither caller can forget it. */
export async function listPublishedGuides(): Promise<PublishedGuideSummary[]> {
  try {
    const rows = await db()
      .select({
        slug: seoContentPages.slug,
        title: seoContentPages.title,
        excerpt: seoContentPages.excerpt,
        metaDescription: seoContentPages.metaDescription,
        authorEntity: seoContentPages.authorEntity,
        originalData: seoContentPages.originalData,
        publishedAt: seoContentPages.publishedAt,
        updatedAt: seoContentPages.updatedAt,
      })
      .from(seoContentPages)
      .where(and(eq(seoContentPages.status, 'published'), eq(seoContentPages.surface, SEO_SURFACE)))
      .orderBy(desc(seoContentPages.publishedAt));

    return rows.map((r) => ({
      slug: r.slug,
      title: r.title,
      excerpt: r.excerpt ?? r.metaDescription ?? '',
      authorEntity: r.authorEntity,
      publishedAt: r.publishedAt,
      updatedAt: r.updatedAt,
      sampleSize:
        typeof (r.originalData as Record<string, unknown> | null)?.sampleSize === 'number'
          ? ((r.originalData as Record<string, number>).sampleSize as number)
          : null,
    }));
  } catch (err) {
    console.warn('[seo] guide list failed; serving empty list:', (err as Error)?.message);
    return [];
  }
}

/** Count of published guides — cheap enough for the admin header. */
export async function countPublishedGuides(): Promise<number> {
  try {
    const rows = await db()
      .select({ n: sql<number>`count(*)::int` })
      .from(seoContentPages)
      .where(eq(seoContentPages.status, 'published'));
    return Number(rows[0]?.n ?? 0);
  } catch {
    return 0;
  }
}
