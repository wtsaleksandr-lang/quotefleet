/**
 * Importer Search — decision-maker CONTACT REVEAL endpoint (Leads Pro).
 *
 *   POST /api/importers/company/:slug/reveal   (auth required)
 *
 * Activates the dormant Hunter enrichment behind a real, gated reveal:
 *
 *   • FREE accounts get a small taste allowance (FREE_REVEAL_TASTE reveals,
 *     all-time), then a "Upgrade to Leads Pro" wall.
 *   • Leads Pro subscribers get a monthly reveal allowance.
 *
 * HONEST CLAIMS: we NEVER fabricate a contact. `resolveContactTiered` returns the
 * best real tier — a verified decision-maker email (Hunter), a role-based email
 * (domain resolved, unverified), or phone_only (the ImportYeti phone + address on
 * the bill). When enrichment turns up nothing, the response says so plainly.
 *
 * COST SAFETY (three levers):
 *   • CACHE-FIRST — a company already resolved (importer_contact_cache, 14-day
 *     TTL, licensed) is served from cache and spends ZERO Hunter credit.
 *   • RE-REVEAL DEDUP — an importer the account already revealed re-opens free
 *     and never decrements the allowance.
 *   • ALLOWANCE — the per-account monthly / free-taste count caps total spend.
 *
 * HARD RULE: the reveal never 500s. Any resolve / DB failure degrades to an
 * honest phone_only (or "no contact found") result.
 */
import type { Express, Request, Response } from 'express';
import { requireAuth } from '../middleware.js';
import { resolveContactTiered, type TieredContact, type ContactConfidence } from './importerLeads.js';
import {
  dbContactCacheStore,
  companyKey,
  isFresh,
  type ContactCacheStore,
  type BolCacheStore,
} from './importerCache.js';
import { dbBolCacheStore } from './importerCache.js';
import {
  getProfileRows,
  profileCacheKey,
  sanitizeSlug,
  titleFromSlug,
} from './importerProfile.js';
import {
  leadsIdentity,
  FREE_REVEAL_TASTE,
  LEADS_PRO_MONTHLY_ALLOWANCE,
  leadsProPurchasable,
} from './leadsEntitlement.js';
import {
  dbLeadsRevealMeter,
  revealBucket,
  leadsAccountKey,
  type LeadsRevealMeter,
} from './leadsRevealUsage.js';

const str = (v: unknown): string => (v == null ? '' : String(v).trim());

/** The client-facing view of a resolved contact — a real tier, never fabricated. */
export interface RevealedContactView {
  confidence: ContactConfidence;
  domain: string | null;
  contact_name: string | null;
  title: string | null;
  email: string | null;
  email_confidence: number | null;
  role_emails: string[];
  phone: string | null;
  address: string | null;
  /** Set when the HARD COST GUARD refused the live Hunter call and nothing was
   *  cached: honest "we did not look", NOT "we looked and found nothing". */
  unavailable?: 'cache-only';
}

/** Reveal outcome for the route to serialize. Never a fabricated contact. */
export type RevealResult =
  | { ok: true; contact: RevealedContactView; remaining: number; tier: 'free' | 'pro'; reused: boolean }
  | { ok: false; reason: 'auth' | 'bad_request' | 'upgrade' | 'allowance_exhausted'; remaining: number; comingSoon?: boolean };

export interface ImporterRevealDeps {
  contactCache?: ContactCacheStore;
  bolCache?: BolCacheStore;
  meter?: LeadsRevealMeter;
  /** Contact resolver seam — defaults to the real (Hunter) resolveContactTiered.
   *  Tests inject a stub so no live Hunter call is made. */
  resolveContact?: (
    company: string,
    opts: { phone?: string | null; address?: string | null },
  ) => Promise<TieredContact>;
  now?: () => Date;
}

/** The importer's display identity from the warm profile cache (no credit spent).
 *  Falls back to a slug-derived name when the profile hasn't been opened/cached. */
async function loadCompanyIdentity(
  slug: string,
  deps: ImporterRevealDeps,
): Promise<{ company: string; phone: string | null; address: string | null }> {
  try {
    const bolCache = deps.bolCache ?? dbBolCacheStore;
    // allowLivePull:false — a reveal must never trigger an ImportYeti pull; the
    // profile open already cached the rows. A cold miss degrades to slug-name.
    const fetched = await getProfileRows(slug, { bolCache, allowLivePull: false });
    const first = (fetched.rows && fetched.rows[0]) || null;
    if (first) {
      const company =
        str(first.company_basename) || str(first.company_name) || titleFromSlug(slug);
      return {
        company,
        phone: str(first.company_main_phone_number) || null,
        address: str(first.company_address) || null,
      };
    }
  } catch {
    /* fall through to slug-derived identity */
  }
  return { company: titleFromSlug(slug), phone: null, address: null };
}

function viewFromTiered(t: TieredContact): RevealedContactView {
  return {
    confidence: t.contact_confidence,
    domain: t.domain,
    contact_name: t.contact_name,
    title: t.title,
    email: t.email,
    email_confidence: t.email_confidence,
    role_emails: t.role_emails ?? [],
    phone: t.phone,
    address: t.address,
  };
}

/**
 * CACHE-FIRST contact resolution. A fresh cached row spends ZERO Hunter credit.
 * Only a miss calls the (real) resolver; the result — including a negative /
 * phone_only result — is cached so it's never re-resolved. Never throws.
 */
async function resolveCacheFirst(
  info: { company: string; phone: string | null; address: string | null },
  deps: ImporterRevealDeps,
): Promise<{ view: RevealedContactView; hitCache: boolean; blocked: boolean }> {
  const cache = deps.contactCache ?? dbContactCacheStore;
  const key = companyKey(info.company);
  try {
    const hit = await cache.get(key);
    if (hit && isFresh(hit.fetchedAt)) {
      const c = (hit.contact ?? {}) as Partial<RevealedContactView>;
      // Rehydrate from cache; ALWAYS backfill phone/address from the current
      // record so phone_only stays answerable even if the cached payload was thin.
      return {
        hitCache: true,
        blocked: false,
        view: {
          confidence: hit.confidence,
          domain: hit.domain ?? c.domain ?? null,
          contact_name: c.contact_name ?? null,
          title: c.title ?? null,
          email: c.email ?? null,
          email_confidence: c.email_confidence ?? null,
          role_emails: c.role_emails ?? [],
          phone: c.phone ?? info.phone,
          address: c.address ?? info.address,
        },
      };
    }
  } catch {
    /* cache down → resolve live */
  }

  const resolver = deps.resolveContact ?? resolveContactTiered;
  const tiered = await resolver(info.company, { phone: info.phone, address: info.address });
  const view = viewFromTiered(tiered);
  // HARD COST GUARD refused the live Hunter call: this is NOT a real negative
  // result. Do NOT cache it (that would poison the licensed 14-day contact cache
  // with a fake "nothing found") and let the caller skip the allowance charge.
  if (tiered.live_blocked) {
    console.warn('[importers] reveal served cache-only (cost guard) — no Hunter call made');
    return { view: { ...view, unavailable: 'cache-only' }, hitCache: false, blocked: true };
  }
  try {
    await cache.put({
      companyKey: key,
      domain: view.domain,
      confidence: view.confidence,
      contact: view as unknown as Record<string, unknown>,
    });
  } catch {
    /* never break the reveal on a cache-write failure */
  }
  return { view, hitCache: false, blocked: false };
}

/**
 * Core reveal logic — pure of Express, injectable seams, NEVER throws. The route
 * passes the already-resolved identity (isSubscriber + allowance) so there is no
 * second DB lookup; `slug` is already sanitized by the caller.
 */
export async function revealWithIdentity(
  slug: string,
  accountKey: string,
  deps: ImporterRevealDeps,
  meter: LeadsRevealMeter,
  identity?: { isSubscriber: boolean; revealAllowance: number },
): Promise<RevealResult> {
  const isSub = identity?.isSubscriber ?? false;
  const cap = isSub
    ? identity?.revealAllowance || LEADS_PRO_MONTHLY_ALLOWANCE
    : FREE_REVEAL_TASTE;
  const tier: 'free' | 'pro' = isSub ? 'pro' : 'free';
  const bucket = revealBucket(isSub, deps.now ? deps.now() : undefined);

  const info = await loadCompanyIdentity(slug, deps);

  // Re-reveal of a company this account already unlocked → free, no decrement.
  if (await meter.hasRevealed(accountKey, slug)) {
    const { view } = await resolveCacheFirst(info, deps);
    const used = await meter.getReveals(accountKey, bucket);
    return { ok: true, contact: view, remaining: Math.max(0, cap - used), tier, reused: true };
  }

  // A NEW reveal → gate on the allowance BEFORE resolving anything.
  const used = await meter.getReveals(accountKey, bucket);
  if (used >= cap) {
    if (isSub) return { ok: false, reason: 'allowance_exhausted', remaining: 0 };
    return { ok: false, reason: 'upgrade', remaining: 0, comingSoon: !leadsProPurchasable() };
  }

  const { view, blocked } = await resolveCacheFirst(info, deps);
  // The cost guard blocked the live lookup and nothing was cached — we did not
  // actually reveal anything, so we must NOT burn one of the user's reveals.
  if (blocked) {
    return { ok: true, contact: view, remaining: Math.max(0, cap - used), tier, reused: false };
  }
  const newUsed = await meter.record(accountKey, bucket, slug);
  return { ok: true, contact: view, remaining: Math.max(0, cap - newUsed), tier, reused: false };
}

/** Testable Express handler — inject seams; no app needed. */
export async function handleImporterReveal(
  req: Request,
  res: Response,
  deps: ImporterRevealDeps = {},
): Promise<void> {
  try {
    const slug = sanitizeSlug((req.params as Record<string, unknown>)?.slug);
    if (!slug) {
      res.status(400).json({ ok: false, reason: 'bad_request', remaining: 0 });
      return;
    }
    const identity = await leadsIdentity(req);
    const userId = identity.userId ?? req.user?.id ?? null;
    if (userId == null) {
      res.status(401).json({ ok: false, reason: 'auth', remaining: 0 });
      return;
    }
    const meter = deps.meter ?? dbLeadsRevealMeter;
    const result = await revealWithIdentity(
      slug,
      leadsAccountKey(userId),
      deps,
      meter,
      { isSubscriber: identity.isSubscriber, revealAllowance: identity.revealAllowance },
    );
    res.status(200).json(result);
  } catch (err) {
    // HARD RULE: never 500. Degrade to an honest "no contact found" (phone_only).
    console.warn('[importers.reveal] handler error; returning empty contact:', err);
    res.status(200).json({
      ok: true,
      reused: false,
      tier: 'free',
      remaining: 0,
      contact: {
        confidence: 'phone_only',
        domain: null,
        contact_name: null,
        title: null,
        email: null,
        email_confidence: null,
        role_emails: [],
        phone: null,
        address: null,
      },
    });
  }
}

export function registerImporterRevealRoutes(app: Express, deps: ImporterRevealDeps = {}): void {
  app.post('/api/importers/company/:slug/reveal', requireAuth, (req: Request, res: Response) =>
    handleImporterReveal(req, res, deps),
  );
}
