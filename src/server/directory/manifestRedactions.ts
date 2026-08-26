/**
 * Manifest Privacy redactions — the in-app "Hidden on QuoteFleet" set.
 *
 * When CBP confirms a confidentiality request, the admin confirm flow inserts a
 * `manifest_redactions` row for every protected name variation. This module owns
 * the READ side used by the two directory choke-points:
 *
 *   1. Search cards — applyPostFilters() in importerLeads.ts drops any lead whose
 *      companyKey ∈ the active redaction set.
 *   2. Profile — handleImporterProfile() short-circuits a redacted slug to a
 *      neutral "not available" page and SPENDS NO ImportYeti credit.
 *
 * The active name_key set is cached in memory (short TTL) so a redacted profile
 * check is O(1) and never adds a DB round-trip to the hot directory path.
 * `invalidateRedactionCache()` is called after any write (confirm/revoke) so a
 * new redaction takes effect immediately, not just after the TTL.
 *
 * HONEST-CLAIMS: this hides the importer on OUR directory only. It is NOT the CBP
 * filing and NOT removal from the CBP feed — copy everywhere says "Hidden on
 * QuoteFleet". The redaction is inserted ONLY on CBP confirm, never before.
 */
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { manifestRedactions } from '../../db/schema.js';
import { companyKey } from './importerCache.js';

/** Cache TTL — short, so a manual DB edit propagates within a minute even
 *  without an explicit invalidation. Writes invalidate immediately. */
const CACHE_TTL_MS = 60 * 1000;

let cache: { set: Set<string>; at: number } | null = null;
let inflight: Promise<Set<string>> | null = null;

async function loadActiveKeys(): Promise<Set<string>> {
  try {
    const rows = await db()
      .select({ nameKey: manifestRedactions.nameKey })
      .from(manifestRedactions)
      .where(eq(manifestRedactions.active, true));
    return new Set(rows.map((r) => r.nameKey).filter(Boolean));
  } catch (err) {
    // A DB hiccup must never 500 the public directory — degrade to "nothing
    // redacted" (fail-open on read). The set refreshes on the next tick.
    console.warn('[manifest.redactions] load failed; treating as empty set:', err);
    return new Set();
  }
}

/** Resolve the active redaction key set (cached, deduped in-flight). */
export async function activeRedactionKeys(): Promise<Set<string>> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.set;
  if (inflight) return inflight;
  inflight = (async () => {
    const set = await loadActiveKeys();
    cache = { set, at: Date.now() };
    inflight = null;
    return set;
  })();
  return inflight;
}

/** True when a company name (any casing/spacing) is currently redacted. */
export async function isRedacted(companyName: string): Promise<boolean> {
  const key = companyKey(companyName);
  if (!key) return false;
  const set = await activeRedactionKeys();
  return set.has(key);
}

/** Synchronous check against an already-loaded set (hot-path callers resolve the
 *  set once via activeRedactionKeys(), then test many leads without awaiting). */
export function isKeyRedacted(set: Set<string>, companyName: string): boolean {
  const key = companyKey(companyName);
  return key ? set.has(key) : false;
}

/** Drop the cache so the next read reloads — call after any redaction write. */
export function invalidateRedactionCache(): void {
  cache = null;
  inflight = null;
}
