/**
 * Importer Search — SAVED IMPORTERS endpoints (broker workflow).
 *
 * A logged-in user saves importers (from a result card or the profile header),
 * annotates each with a note + pipeline status, and revisits them at
 * /importers/saved. Saving is FREE for any logged-in account — it is a
 * lead-workflow convenience, NOT a Directory Pro tier — so every route gates on
 * login ONLY:
 *   • no session (userId == null) → 401 { reason: 'needs-account' }
 *   • a logged-in user            → the real save operations
 *
 * Ownership is enforced on every route (the store scopes by userId). Zod
 * validates the slug, note (≤2000) and status (a small pipeline enum). A per-user
 * cap bounds abuse. Saves are idempotent on UNIQUE(user_id, slug) and never 500
 * on a duplicate. Every catch logs and degrades to a JSON error.
 *
 * JSON API (all under /api/importers/saved):
 *   GET    /                       → the user's saved importers
 *   GET    /slugs                  → just the saved slugs (card star hydration)
 *   POST   /            {slug,company,note?,status?} → save (idempotent upsert)
 *   PATCH  /:slug       {note?,status?}              → update note / status
 *   DELETE /:slug                                    → un-save
 *
 * Server-rendered page:
 *   GET /importers/saved           → the login-gated saved-importers view
 */
import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { directoryIdentity } from '../directory/entitlement.js';
import {
  dbImporterSavedStore,
  type ImporterSavedStore,
  type SavedImporter,
} from '../directory/importerSavedStore.js';
import { sanitizeSlug, titleFromSlug } from '../directory/importerProfile.js';
import { renderSavedImportersPage } from '../directory/importerSavedPage.js';

/** Per-user cap on saved importers (overridable via deps for tests). */
export const DEFAULT_MAX_SAVED_IMPORTERS = 500;

export interface ImporterSavedDeps {
  store?: ImporterSavedStore;
  maxSaved?: number;
}

/** The broker pipeline statuses (plus '' / null = no status). */
export const IMPORTER_SAVED_STATUSES = ['new', 'contacted', 'quoted', 'won', 'lost'] as const;

const statusSchema = z
  .union([z.enum(IMPORTER_SAVED_STATUSES), z.literal('')])
  .transform((v) => (v === '' ? null : v));
const noteSchema = z
  .string()
  .max(2000)
  .transform((v) => v.trim())
  .transform((v) => (v === '' ? null : v));
const companySchema = z.string().trim().min(1).max(160);

/** Resolve the caller to a logged-in user id, or write 401 and return null. */
async function gate(req: Request, res: Response): Promise<{ userId: number } | null> {
  const identity = await directoryIdentity(req);
  if (identity.userId == null) {
    res.status(401).json({ ok: false, reason: 'needs-account', loginUrl: '/login' });
    return null;
  }
  return { userId: identity.userId };
}

/** Sanitize a :slug route param (or body slug) to the ImportYeti slug charset. */
function slugOf(raw: unknown): string {
  return sanitizeSlug(raw);
}

export async function handleGetSaved(req: Request, res: Response, deps: ImporterSavedDeps = {}): Promise<void> {
  try {
    const auth = await gate(req, res);
    if (!auth) return;
    const store = deps.store ?? dbImporterSavedStore;
    const saved = await store.listForUser(auth.userId);
    res.json({ ok: true, saved });
  } catch (err) {
    console.error('[importers.saved] getSaved failed:', err);
    res.status(500).json({ ok: false, reason: 'error' });
  }
}

export async function handleGetSavedSlugs(req: Request, res: Response, deps: ImporterSavedDeps = {}): Promise<void> {
  try {
    // Anonymous callers get an empty set (200), NOT a 401 — the search page calls
    // this on load to hydrate star states and must not treat "logged out" as an
    // error. A logged-in user gets their real saved slugs.
    const identity = await directoryIdentity(req);
    if (identity.userId == null) {
      res.json({ ok: true, loggedIn: false, slugs: [] });
      return;
    }
    const store = deps.store ?? dbImporterSavedStore;
    const slugs = await store.savedSlugs(identity.userId);
    res.json({ ok: true, loggedIn: true, slugs });
  } catch (err) {
    console.error('[importers.saved] getSavedSlugs failed:', err);
    res.status(500).json({ ok: false, reason: 'error', slugs: [] });
  }
}

export async function handleSave(req: Request, res: Response, deps: ImporterSavedDeps = {}): Promise<void> {
  try {
    const auth = await gate(req, res);
    if (!auth) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const slug = slugOf(body.slug);
    if (!slug) {
      res.status(422).json({ ok: false, reason: 'invalid-slug' });
      return;
    }
    // Company snapshot is best-effort: fall back to the slug's title-case form.
    const companyParsed = companySchema.safeParse(body.company);
    const company = companyParsed.success ? companyParsed.data : titleFromSlug(slug);
    const noteParsed = body.note === undefined ? undefined : noteSchema.safeParse(body.note);
    const statusParsed = body.status === undefined ? undefined : statusSchema.safeParse(body.status);
    if (noteParsed && !noteParsed.success) {
      res.status(422).json({ ok: false, reason: 'invalid-note' });
      return;
    }
    if (statusParsed && !statusParsed.success) {
      res.status(422).json({ ok: false, reason: 'invalid-status' });
      return;
    }
    const store = deps.store ?? dbImporterSavedStore;
    const maxSaved = deps.maxSaved ?? DEFAULT_MAX_SAVED_IMPORTERS;
    const already = await store.has(auth.userId, slug);
    if (!already && (await store.countForUser(auth.userId)) >= maxSaved) {
      res.status(409).json({ ok: false, reason: 'saved-cap', max: maxSaved });
      return;
    }
    const patch = {
      ...(noteParsed ? { note: noteParsed.data } : {}),
      ...(statusParsed ? { status: statusParsed.data } : {}),
    };
    const saved = await store.save(auth.userId, slug, company, patch);
    res.status(already ? 200 : 201).json({ ok: true, saved, added: !already });
  } catch (err) {
    console.error('[importers.saved] save failed:', err);
    res.status(500).json({ ok: false, reason: 'error' });
  }
}

export async function handleUpdateSaved(req: Request, res: Response, deps: ImporterSavedDeps = {}): Promise<void> {
  try {
    const auth = await gate(req, res);
    if (!auth) return;
    const slug = slugOf(req.params.slug);
    if (!slug) {
      res.status(404).json({ ok: false, reason: 'not-found' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: { note?: string | null; status?: string | null } = {};
    if (body.note !== undefined) {
      const p = noteSchema.safeParse(body.note);
      if (!p.success) {
        res.status(422).json({ ok: false, reason: 'invalid-note' });
        return;
      }
      patch.note = p.data;
    }
    if (body.status !== undefined) {
      const p = statusSchema.safeParse(body.status);
      if (!p.success) {
        res.status(422).json({ ok: false, reason: 'invalid-status' });
        return;
      }
      patch.status = p.data;
    }
    const store = deps.store ?? dbImporterSavedStore;
    const updated = await store.update(auth.userId, slug, patch);
    if (!updated) {
      res.status(404).json({ ok: false, reason: 'not-found' });
      return;
    }
    res.json({ ok: true, saved: updated });
  } catch (err) {
    console.error('[importers.saved] updateSaved failed:', err);
    res.status(500).json({ ok: false, reason: 'error' });
  }
}

export async function handleRemoveSaved(req: Request, res: Response, deps: ImporterSavedDeps = {}): Promise<void> {
  try {
    const auth = await gate(req, res);
    if (!auth) return;
    const slug = slugOf(req.params.slug);
    if (!slug) {
      res.status(404).json({ ok: false, reason: 'not-found' });
      return;
    }
    const store = deps.store ?? dbImporterSavedStore;
    const removed = await store.remove(auth.userId, slug);
    if (!removed) {
      res.status(404).json({ ok: false, reason: 'not-found' });
      return;
    }
    res.json({ ok: true, slug });
  } catch (err) {
    console.error('[importers.saved] removeSaved failed:', err);
    res.status(500).json({ ok: false, reason: 'error' });
  }
}

/**
 * Server-rendered saved-importers view. Anonymous users get a sign-in prompt; a
 * logged-in user gets their saved importers with per-item note + status. Never
 * 500s — a store failure degrades to an empty view.
 */
export async function handleSavedPage(req: Request, res: Response, deps: ImporterSavedDeps = {}): Promise<void> {
  try {
    const identity = await directoryIdentity(req);
    if (identity.userId == null) {
      res.status(200).type('html').send(renderSavedImportersPage({ loggedIn: false, saved: [] }));
      return;
    }
    const store = deps.store ?? dbImporterSavedStore;
    let saved: SavedImporter[] = [];
    try {
      saved = await store.listForUser(identity.userId);
    } catch (err) {
      // A store read failure degrades to an empty list, never a 500.
      console.error('[importers.saved] saved page store read failed:', err);
    }
    res.status(200).type('html').send(renderSavedImportersPage({ loggedIn: true, saved }));
  } catch (err) {
    console.error('[importers.saved] saved page failed:', err);
    res.status(200).type('html').send(renderSavedImportersPage({ loggedIn: false, saved: [] }));
  }
}

export function registerImporterSavedRoutes(app: Express, deps: ImporterSavedDeps = {}): void {
  // Server-rendered page. Registered by the importer-routes module which is
  // mounted after the directory :stateSlug catch-all, so "saved" is unambiguous.
  app.get(['/importers/saved', '/importers/saved/'], (req, res) => handleSavedPage(req, res, deps));

  // JSON API. The /slugs route is registered before /:slug-style routes so it is
  // never shadowed (Express matches in order, but these are distinct paths).
  app.get('/api/importers/saved', (req, res) => handleGetSaved(req, res, deps));
  app.get('/api/importers/saved/slugs', (req, res) => handleGetSavedSlugs(req, res, deps));
  app.post('/api/importers/saved', (req, res) => handleSave(req, res, deps));
  app.patch('/api/importers/saved/:slug', (req, res) => handleUpdateSaved(req, res, deps));
  app.delete('/api/importers/saved/:slug', (req, res) => handleRemoveSaved(req, res, deps));
}
