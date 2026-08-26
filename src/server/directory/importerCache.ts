/**
 * Persistent cache for the Importer Search feature (/importers).
 *
 * ImportYeti's ToS (§5.2) permits storing AND reselling the purchased data, so
 * caching pulled BOL result sets + resolved contacts in our own DB is licensed —
 * and a hard cost guard: a repeat search inside the 14-day TTL spends ZERO
 * external credits (ImportYeti or Hunter). Source data refreshes ~weekly, so a
 * 14-day TTL keeps results fresh while collapsing bursty repeat searches.
 *
 * SAFETY: every read is an INDEXED UNIQUE-KEY lookup (WHERE search_key = / WHERE
 * company_key IN (...)) — never a table scan or aggregate. QuoteFleet had
 * repeated prod outages from unbounded scans; this module must never reintroduce
 * one. Stores are defined behind interfaces so the engine stays DB-free + unit
 * testable; the DB-backed implementations are wired by the route.
 */
import { createHash } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { importerBolCache, importerContactCache } from '../../db/schema.js';
import type { BolRow, ContactConfidence } from './importerLeads.js';
export type { ContactConfidence };

/** 14 days — source BOL data refreshes ~weekly. */
export const IMPORTER_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** Stable hash of the pull-affecting filters → the BOL cache key. */
export function searchKey(parts: Record<string, unknown>): string {
  const norm = Object.entries(parts)
    .map(([k, v]) => [k, String(v ?? '').trim().toLowerCase()] as const)
    .filter(([, v]) => v)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  return createHash('sha256').update(norm).digest('hex');
}

/** Normalized company basename → the contact cache key. */
export function companyKey(name: string): string {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** True when a cached row is still within the TTL. */
export function isFresh(fetchedAt: Date | string | null | undefined, now = Date.now()): boolean {
  if (!fetchedAt) return false;
  const t = fetchedAt instanceof Date ? fetchedAt.getTime() : new Date(fetchedAt).getTime();
  return Number.isFinite(t) && now - t < IMPORTER_CACHE_TTL_MS;
}

// ── BOL result-set cache ─────────────────────────────────────────────────────
export interface BolCacheHit {
  rows: BolRow[];
  creditsRemaining: number | null;
  fetchedAt: Date;
}
export interface BolCacheStore {
  get(key: string): Promise<BolCacheHit | null>;
  put(key: string, rows: BolRow[], creditsRemaining: number | null): Promise<void>;
}

export const dbBolCacheStore: BolCacheStore = {
  async get(key) {
    // Indexed unique-key lookup — never a scan.
    const rows = await db()
      .select({
        rows: importerBolCache.rows,
        creditsRemaining: importerBolCache.creditsRemaining,
        fetchedAt: importerBolCache.fetchedAt,
      })
      .from(importerBolCache)
      .where(eq(importerBolCache.searchKey, key))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return { rows: r.rows ?? [], creditsRemaining: r.creditsRemaining ?? null, fetchedAt: r.fetchedAt };
  },
  async put(key, rows, creditsRemaining) {
    const now = new Date();
    await db()
      .insert(importerBolCache)
      .values({ searchKey: key, rows, creditsRemaining, fetchedAt: now })
      .onConflictDoUpdate({
        target: importerBolCache.searchKey,
        set: { rows, creditsRemaining, fetchedAt: now },
      });
  },
};

// ── Contact cache ────────────────────────────────────────────────────────────
export interface ContactCacheHit {
  companyKey: string;
  domain: string | null;
  confidence: ContactConfidence;
  contact: Record<string, unknown> | null;
  fetchedAt: Date;
}
export interface ContactCacheStore {
  get(key: string): Promise<ContactCacheHit | null>;
  /** Batched indexed lookup (WHERE company_key IN (...)) — never a scan. */
  getMany(keys: string[]): Promise<Map<string, ContactCacheHit>>;
  put(hit: {
    companyKey: string;
    domain: string | null;
    confidence: ContactConfidence;
    contact: Record<string, unknown> | null;
  }): Promise<void>;
}

export const dbContactCacheStore: ContactCacheStore = {
  async get(key) {
    const rows = await db()
      .select()
      .from(importerContactCache)
      .where(eq(importerContactCache.companyKey, key))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      companyKey: r.companyKey,
      domain: r.domain ?? null,
      confidence: r.confidence as ContactConfidence,
      contact: r.contact ?? null,
      fetchedAt: r.fetchedAt,
    };
  },
  async getMany(keys) {
    const out = new Map<string, ContactCacheHit>();
    const uniq = [...new Set(keys.filter(Boolean))];
    if (!uniq.length) return out;
    // Indexed IN() lookup on the unique key — bounded (<= MAX_LEADS keys), never a scan.
    const rows = await db()
      .select()
      .from(importerContactCache)
      .where(inArray(importerContactCache.companyKey, uniq));
    for (const r of rows) {
      out.set(r.companyKey, {
        companyKey: r.companyKey,
        domain: r.domain ?? null,
        confidence: r.confidence as ContactConfidence,
        contact: r.contact ?? null,
        fetchedAt: r.fetchedAt,
      });
    }
    return out;
  },
  async put(hit) {
    const now = new Date();
    await db()
      .insert(importerContactCache)
      .values({
        companyKey: hit.companyKey,
        domain: hit.domain,
        confidence: hit.confidence,
        contact: hit.contact,
        fetchedAt: now,
      })
      .onConflictDoUpdate({
        target: importerContactCache.companyKey,
        set: { domain: hit.domain, confidence: hit.confidence, contact: hit.contact, fetchedAt: now },
      });
  },
};
