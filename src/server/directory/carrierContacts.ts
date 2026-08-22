/**
 * Enriched carrier contacts — the data + logic layer behind the Directory Pro
 * "Reveal additional contacts" button (PR C).
 *
 * A reveal turns a carrier's PUBLIC census email into a website domain
 * (`emailDomain`), scrapes that site via `enrichCompany`, and returns the
 * ADDITIONAL dispatch contacts it finds — SEPARATE from, and never a re-tiering
 * of, the free FMCSA phone/email on `carrier_directory` (any scraped value that
 * equals the census phone/email is dropped). Results are cached in
 * `carrier_contacts`; every attempt (even an empty one) is marked in
 * `carrier_enrichment_state` so a dead/no-email domain is not re-scraped on
 * every reveal (TTL cache).
 *
 * The whole thing is injectable behind `RevealStore` + a `onBeforeEnrich` quota
 * hook so the route and the tests share one seam: tests pass a fake store + a
 * stub `enrich` and never touch the network / AI. `revealContacts` NEVER throws
 * — any failure degrades to an empty result so the endpoint can't 500.
 */
import { desc, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { carrierContacts, carrierDirectory, carrierEnrichmentState } from '../../db/schema.js';
import { enrichCompany, type CompanyProfile } from '../outreach/enrichCompany.js';
import { emailDomain, isFreemail } from '../outreach/domainResolver.js';

// ─── Types ──────────────────────────────────────────────────────────────
/** A contact as rendered into the profile (display columns only). */
export interface RevealedContact {
  contactName: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  confidence: string | null;
}

/** A freshly-derived contact, ready to persist (adds provenance columns). */
export interface DerivedContact extends RevealedContact {
  source: 'enrich' | 'manual';
  rawJson: Record<string, unknown> | null;
}

export type RevealStatus = 'cached' | 'fresh' | 'empty' | 'capped' | 'error';

export interface RevealResult {
  contacts: RevealedContact[];
  status: RevealStatus;
}

/** The persistence + carrier-lookup seam. DB-backed in prod, faked in tests. */
export interface RevealStore {
  /** The per-DOT attempt marker, or null when never attempted. */
  getState(dot: string): Promise<{ attemptedAt: Date; contactCount: number } | null>;
  /** Cached contacts for a DOT (display columns). */
  getContacts(dot: string): Promise<RevealedContact[]>;
  /** Upsert freshly-derived contacts (dedupe on carrier_dot + email). */
  saveContacts(dot: string, contacts: DerivedContact[]): Promise<void>;
  /** Record that a DOT was attempted, with how many contacts it yielded. */
  recordAttempt(dot: string, contactCount: number): Promise<void>;
  /** The carrier's FREE census contact (used to derive the domain + to dedupe). */
  getCarrierContact(dot: string): Promise<{ email: string | null; phone: string | null } | null>;
}

export interface RevealCoreDeps {
  store: RevealStore;
  /** Defaults to the real `enrichCompany` (network + AI). */
  enrich?: typeof enrichCompany;
  /** Clock seam (ms). Defaults to `Date.now()`. */
  now?: () => number;
  /** Freshness window in days. Defaults to DIRECTORY_ENRICH_TTL_DAYS / 60. */
  ttlDays?: number;
  /** Forwarded to enrichCompany (undefined ⇒ it reads the env keys). */
  anthropicKey?: string;
  fmcsaKey?: string;
  /**
   * Called right before a FRESH enrich (the costly network/AI step). Return
   * false to abort because the caller is over its daily reveal cap. NOT called
   * for a cache hit or a no-domain carrier — those cost nothing.
   */
  onBeforeEnrich?: () => Promise<boolean> | boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────
/** Normalize a USDOT to the directory's stored form: digits, leading zeros
 *  stripped. Returns '' for a non-numeric / all-zero input. */
export function normalizeUsdot(raw: unknown): string {
  return String(raw ?? '')
    .replace(/\D/g, '')
    .replace(/^0+/, '');
}

/** DIRECTORY_ENRICH_TTL_DAYS (default 60) — how long a reveal result is fresh. */
export function enrichTtlDays(): number {
  const raw = process.env.DIRECTORY_ENRICH_TTL_DAYS;
  const n = raw != null ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 60;
}

const digitsOnly = (s: string | null | undefined): string => (s ?? '').replace(/\D/g, '');
const normEmail = (s: string | null | undefined): string => (s ?? '').trim().toLowerCase();

/**
 * Map an enriched `CompanyProfile` to the ADDITIONAL contacts worth surfacing.
 * Model-B / legal: the free FMCSA phone/email stays free — any scraped value
 * equal to the census phone/email is DROPPED, so a reveal only ever returns
 * genuinely-additional contact data (an ops email / number the carrier
 * published on its own site that isn't already the public record).
 */
export function extractAdditionalContacts(
  profile: CompanyProfile,
  freeEmail: string | null,
  freePhone: string | null,
): DerivedContact[] {
  const freeE = normEmail(freeEmail);
  const freeP = digitsOnly(freePhone);
  const scrapedE = normEmail(profile.email);
  const scrapedP = digitsOnly(profile.phone);

  const emailIsAdditional = !!scrapedE && scrapedE !== freeE;
  const phoneIsAdditional = !!scrapedP && scrapedP.length >= 10 && scrapedP !== freeP;
  if (!emailIsAdditional && !phoneIsAdditional) return [];

  const rawJson: Record<string, unknown> = {
    domain: profile.domain,
    website: profile.website,
    serviceModes: profile.serviceModes,
    businessSummary: profile.ai?.businessSummary ?? null,
    fetchNotes: profile.fetchNotes,
  };

  return [
    {
      source: 'enrich',
      contactName: profile.companyName ?? null,
      title: 'Dispatch / operations (from website)',
      email: emailIsAdditional ? profile.email : null,
      phone: phoneIsAdditional ? profile.phone : null,
      confidence: 'low',
      rawJson,
    },
  ];
}

function toRevealed(c: RevealedContact): RevealedContact {
  return {
    contactName: c.contactName ?? null,
    title: c.title ?? null,
    email: c.email ?? null,
    phone: c.phone ?? null,
    confidence: c.confidence ?? null,
  };
}

// ─── Core ──────────────────────────────────────────────────────────────────
/**
 * Reveal (and cache) the additional contacts for a carrier. Never throws.
 *
 * Flow: FRESH cache (marker within TTL) → serve it, possibly empty, no cost.
 * Else derive the domain from the census email; no company domain ⇒ mark
 * attempted-and-empty (so we don't re-scrape) and return empty. Else consult
 * the quota hook, enrich, dedupe against the free record, upsert, mark, return.
 */
export async function revealContacts(usdot: string, deps: RevealCoreDeps): Promise<RevealResult> {
  const dot = normalizeUsdot(usdot);
  if (!dot) return { contacts: [], status: 'empty' };

  const { store } = deps;
  const enrich = deps.enrich ?? enrichCompany;
  const nowMs = deps.now ? deps.now() : Date.now();
  const ttlMs = (deps.ttlDays ?? enrichTtlDays()) * 86_400_000;

  try {
    const state = await store.getState(dot);
    if (state && nowMs - state.attemptedAt.getTime() < ttlMs) {
      // FRESH — serve the cache (empty when the last attempt found nothing).
      const rows = state.contactCount > 0 ? await store.getContacts(dot) : [];
      return { contacts: rows.map(toRevealed), status: 'cached' };
    }

    // Stale / never attempted → try to enrich from the carrier's own website.
    const carrier = await store.getCarrierContact(dot);
    const domain = emailDomain(carrier?.email ?? null);
    if (!domain || isFreemail(domain)) {
      // No company domain (no census email, or a freemail one) ⇒ nothing to
      // scrape. Mark attempted-and-empty so the TTL guards against re-scraping.
      await store.recordAttempt(dot, 0);
      return { contacts: [], status: 'empty' };
    }

    // Costly path — gate on the daily cap BEFORE spending an AI call + fetches.
    if (deps.onBeforeEnrich) {
      const allowed = await deps.onBeforeEnrich();
      if (!allowed) return { contacts: [], status: 'capped' };
    }

    const profile = await enrich(domain, { anthropicKey: deps.anthropicKey, fmcsaKey: deps.fmcsaKey });
    const derived = extractAdditionalContacts(profile, carrier?.email ?? null, carrier?.phone ?? null);
    if (derived.length) await store.saveContacts(dot, derived);
    await store.recordAttempt(dot, derived.length);
    return { contacts: derived.map(toRevealed), status: derived.length ? 'fresh' : 'empty' };
  } catch (err) {
    // HARD RULE: a reveal never 500s — any failure degrades to "no contacts".
    console.warn('[carrierContacts] reveal failed; returning empty (never 500):', err);
    return { contacts: [], status: 'error' };
  }
}

// ─── DB-backed store ─────────────────────────────────────────────────────
export const dbRevealStore: RevealStore = {
  async getState(dot) {
    const rows = await db()
      .select({ attemptedAt: carrierEnrichmentState.attemptedAt, contactCount: carrierEnrichmentState.contactCount })
      .from(carrierEnrichmentState)
      .where(eq(carrierEnrichmentState.carrierDot, dot))
      .limit(1);
    const r = rows[0];
    return r ? { attemptedAt: r.attemptedAt, contactCount: r.contactCount } : null;
  },

  async getContacts(dot) {
    return await db()
      .select({
        contactName: carrierContacts.contactName,
        title: carrierContacts.title,
        email: carrierContacts.email,
        phone: carrierContacts.phone,
        confidence: carrierContacts.confidence,
      })
      .from(carrierContacts)
      .where(eq(carrierContacts.carrierDot, dot))
      .orderBy(desc(carrierContacts.enrichedAt));
  },

  async saveContacts(dot, contacts) {
    const now = new Date();
    for (const c of contacts) {
      await db()
        .insert(carrierContacts)
        .values({
          carrierDot: dot,
          source: c.source,
          contactName: c.contactName,
          title: c.title,
          email: c.email,
          phone: c.phone,
          confidence: c.confidence,
          enrichedAt: now,
          rawJson: c.rawJson ?? null,
        })
        .onConflictDoUpdate({
          target: [carrierContacts.carrierDot, carrierContacts.email],
          set: {
            contactName: c.contactName,
            title: c.title,
            phone: c.phone,
            confidence: c.confidence,
            source: c.source,
            enrichedAt: now,
            rawJson: c.rawJson ?? null,
          },
        });
    }
  },

  async recordAttempt(dot, contactCount) {
    const now = new Date();
    await db()
      .insert(carrierEnrichmentState)
      .values({ carrierDot: dot, attemptedAt: now, contactCount })
      .onConflictDoUpdate({
        target: carrierEnrichmentState.carrierDot,
        set: { attemptedAt: now, contactCount },
      });
  },

  async getCarrierContact(dot) {
    const rows = await db()
      .select({ email: carrierDirectory.email, phone: carrierDirectory.phone })
      .from(carrierDirectory)
      .where(eq(carrierDirectory.usdot, dot))
      .limit(1);
    const r = rows[0];
    return r ? { email: r.email ?? null, phone: r.phone ?? null } : null;
  },
};
