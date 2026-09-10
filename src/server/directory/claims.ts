/**
 * FREE-FOREVER carrier-directory PROFILE CLAIMS — the state machine.
 *
 * A carrier proves it owns its FMCSA directory profile and gets a "Verified
 * owner" badge + the right to edit the public card. Claiming is free forever:
 * no trial, no card, no plan (owner decision). Only the quote tool is paid, and
 * a VERIFIED owner who opts into it gets CLAIM_OWNER_TRIAL_DAYS (30) instead of
 * the usual 14 — see `activateOwnerTrial`.
 *
 * Proof of ownership, chosen by `chooseClaimMethod`:
 *   domain_match — the claimant's email is provider-verified (OAuth) or
 *                  magic-link-verified AND shares a NON-freemail domain with the
 *                  FMCSA census email on the record → verified at once.
 *   email_otp    — the record has a census email → a 6-digit code goes to THAT
 *                  address (never to the claimant). Only its SHA-256 is stored;
 *                  15-min TTL; CLAIM_OTP_MAX_ATTEMPTS wrong guesses lock the row.
 *                  If no real email provider accepts the send, the claim falls
 *                  back to `manual` — a code that only reached a log file is not
 *                  a proof of anything.
 *   manual       — no email on the record → pending row; support verifies out
 *                  of band and an admin flips it (`reviewClaim`).
 *
 * Nothing is granted before verification: the tenant created at `start` is a
 * plain account (neutral slug, `isDirectoryOwner: false`, no trial). Only
 * `finalizeClaim` — which first wins the `claimed_tenant_id IS NULL` race on
 * the directory row — flips the owner flag, brands the slug and exposes the
 * claimant's email on the profile.
 *
 * All DB / email access goes through `ClaimStore` (same seam pattern as
 * carrierIngest's CarrierStore) so every transition is unit-tested against an
 * in-memory store; `dbClaimStore` is the production implementation.
 */
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { and, eq, isNull, isNotNull, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  carrierClaims,
  carrierDirectory,
  magicLinks,
  tenants,
  users,
  type CarrierClaimRow,
  type NewCarrierClaimRow,
} from '../../db/schema.js';
import { loadEnv } from '../../config.js';
import { sendEmail, wasSentByAProvider } from '../../email/send.js';
import { claimCodeEmail } from '../../email/templates.js';
import { CLAIM_OWNER_TRIAL_DAYS } from '../plans.js';
import { deriveAvailableSlug } from '../routes/tenantProvision.js';
import { upsertCarrierOverride } from './carrierOverrideWrite.js';
import { normalizeDot } from './carrierIngest.js';
import { carrierProfileUrls, purgeEdgeUrls } from './edgePurge.js';

export type ClaimMethod = 'email_otp' | 'domain_match' | 'manual';
export type ClaimStatus = 'pending' | 'verified' | 'rejected' | 'expired';

/** Ownership code lifetime. */
export const CLAIM_OTP_TTL_MS = 15 * 60 * 1000;
/** Wrong-code submissions before the pending claim locks (a new code must be requested). */
export const CLAIM_OTP_MAX_ATTEMPTS = 5;

/**
 * Consumer mailbox / residential-ISP providers. A match on one of these
 * domains proves nothing about a company, so `domain_match` is never granted
 * for them. Exact domains here; provider families with many country TLDs
 * (outlook.*, live.*, hotmail.*, yahoo.co.*, protonmail.*, gmx.*) are matched
 * by FREEMAIL_FAMILIES below.
 */
export const FREEMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'ymail.com',
  'rocketmail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'aol.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'gmx.com',
  'gmx.net',
  'mail.com',
  'zoho.com',
  // US residential ISPs — the mailbox a small carrier often runs from, but a
  // match on them still says nothing about the company.
  'att.net',
  'sbcglobal.net',
  'comcast.net',
  'verizon.net',
  'bellsouth.net',
  'cox.net',
  'charter.net',
  'earthlink.net',
  'frontier.com',
  'windstream.net',
  'centurylink.net',
]);

/** Provider families with per-country TLDs: `outlook.fr`, `live.co.uk`,
 *  `hotmail.de`, `yahoo.co.jp`, `protonmail.ch`, `gmx.de`, ... */
const FREEMAIL_FAMILIES = /^(?:outlook|live|hotmail|protonmail|gmx|yahoo)\.(?:[a-z]{2,}\.)?[a-z]{2,}$/;

/** Lower-cased domain part of an email, or null when there is none. */
export function emailDomain(email: string | null | undefined): string | null {
  const at = String(email ?? '').trim().toLowerCase().lastIndexOf('@');
  if (at < 0) return null;
  const d = String(email).trim().toLowerCase().slice(at + 1);
  return d || null;
}

export function isFreemailDomain(domain: string | null | undefined): boolean {
  if (!domain) return false;
  const d = domain.toLowerCase();
  return FREEMAIL_DOMAINS.has(d) || FREEMAIL_FAMILIES.test(d);
}

/** `dispatch@acme.com` → `d***@acme.com`. Reveals only the first character +
 *  the domain, which is enough for the claimant to recognise the mailbox
 *  without the page leaking the address. */
export function maskEmail(email: string): string {
  const s = String(email).trim();
  const at = s.lastIndexOf('@');
  if (at <= 0) return '***';
  return `${s[0]}***@${s.slice(at + 1)}`;
}

/** SHA-256 hex of the code — the only form ever stored. (A 6-digit code is
 *  guessable in principle, which is why `attempts` caps it, not the hash.) */
export function hashOtp(code: string): string {
  return createHash('sha256').update(String(code).trim()).digest('hex');
}

/** Six random digits, zero-padded, from the CSPRNG. */
export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Does the submitted code match the stored hash? Constant-time on the hash. */
export function otpMatches(code: string, storedHash: string | null | undefined): boolean {
  if (!storedHash) return false;
  const a = Buffer.from(hashOtp(code), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The placeholder slug a claim-created tenant carries until its claim is
 *  verified — `claim-<usdot>-<random>`. Nobody can squat a company's name by
 *  merely STARTING a claim; the branded slug is derived in finalizeClaim. */
export function neutralClaimSlug(usdot: string, random: string): string {
  return `claim-${usdot}-${random.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}
export function isNeutralClaimSlug(slug: string | null | undefined): boolean {
  return /^claim-\d+-[a-z0-9]+$/.test(String(slug ?? ''));
}

/**
 * Which proof to require. PURE.
 *  - census email + verified claimant on the same non-freemail domain → domain_match
 *  - census email present → email_otp
 *  - no census email → manual
 */
export function chooseClaimMethod(opts: {
  claimantEmail: string;
  censusEmail: string | null | undefined;
  /** Provider-verified (OAuth) or magic-link-verified claimant address. */
  claimantVerified: boolean;
}): ClaimMethod {
  const census = opts.censusEmail?.trim() ? opts.censusEmail.trim() : null;
  if (!census) return 'manual';
  const cd = emailDomain(opts.claimantEmail);
  const xd = emailDomain(census);
  if (opts.claimantVerified && cd && xd && cd === xd && !isFreemailDomain(cd)) return 'domain_match';
  return 'email_otp';
}

// ─── Store seam ─────────────────────────────────────────────────────────────

/** The slice of a carrier_directory row the claim flow needs. */
export interface ClaimCarrier {
  usdot: string;
  slug: string;
  /** Display name (DBA when present, else legal). */
  name: string;
  mcNumber: string | null;
  /** FMCSA census email — the OTP recipient. */
  email: string | null;
  claimedTenantId: number | null;
}

export interface ClaimActor {
  userId: number;
  email: string;
}

export interface ClaimStore {
  carrierByUsdot(usdot: string): Promise<ClaimCarrier | null>;
  /** The open (pending) claim by this tenant on this USDOT, if any. */
  pendingClaim(usdot: number, tenantId: number): Promise<CarrierClaimRow | null>;
  claimById(id: number): Promise<CarrierClaimRow | null>;
  insertClaim(row: NewCarrierClaimRow): Promise<CarrierClaimRow>;
  updateClaim(id: number, patch: Partial<NewCarrierClaimRow>): Promise<void>;
  /** Mirror a verified claim onto carrier_directory.claimed_* — ONLY if the
   *  row is still unclaimed. Returns the number of rows written (1 = won,
   *  0 = someone else got there first). */
  markCarrierClaimed(usdot: string, tenantId: number, method: ClaimMethod, at: Date): Promise<number>;
  /** Flag the tenant as a directory owner; fill dot/mc ONLY where empty. */
  markTenantOwner(tenantId: number, ids: { dotNumber: string; mcNumber: string | null }): Promise<void>;
  /** Replace a neutral `claim-<usdot>-…` slug with one derived from the company
   *  name. A tenant that already has a real slug is left alone. */
  brandTenantSlug(tenantId: number, companyName: string): Promise<void>;
  /** Set the profile's public email to the verified claimant's address. */
  setPublicEmail(usdot: string, email: string, actor: ClaimActor): Promise<void>;
  /** Email the ownership code to the CENSUS address. Resolves true ONLY when a
   *  real provider accepted the message; false when it would only have been
   *  logged (no provider configured / undeliverable address). */
  sendOtpEmail(to: string, opts: { code: string; company: string }): Promise<boolean>;
  /** Has this user ever proven control of their address (OAuth sub or a
   *  consumed magic link)? Gates domain_match. */
  userEmailVerified(userId: number): Promise<boolean>;
  userById(userId: number): Promise<{ id: number; email: string } | null>;
  tenantTrial(tenantId: number): Promise<{ isDirectoryOwner: boolean; trialEndsAt: Date | null } | null>;
  /** Does a directory row name this tenant as its verified owner? */
  hasVerifiedClaim(tenantId: number): Promise<boolean>;
  setTrialEndsAt(tenantId: number, trialEndsAt: Date): Promise<void>;
  /** Best-effort edge purge of the profile after a verified claim. Never throws. */
  purgeProfileCache(slug: string): Promise<void>;
}

// ─── Transitions ────────────────────────────────────────────────────────────

export type StartClaimResult =
  | { kind: 'not_found' }
  | { kind: 'already_claimed' }
  | { kind: 'verified'; method: 'domain_match'; claimId: number; slug: string }
  | { kind: 'otp_sent'; claimId: number; maskedEmail: string; expiresAt: Date }
  | { kind: 'needs_manual'; claimId: number };

/**
 * Begin (or restart) a claim by `tenantId` on `usdot`. Picks the proof method,
 * sends the code when applicable, and returns what the page should show next.
 * Restarting an open email_otp claim issues a fresh code and resets attempts
 * (the caller rate-limits; a fresh code is a fresh 1-in-a-million guess).
 */
export async function startClaim(
  store: ClaimStore,
  input: { usdot: string; tenantId: number; actor: ClaimActor; claimantVerified: boolean; now?: Date },
): Promise<StartClaimResult> {
  const now = input.now ?? new Date();
  const dot = normalizeDot(input.usdot);
  if (!dot) return { kind: 'not_found' };
  const carrier = await store.carrierByUsdot(dot);
  if (!carrier) return { kind: 'not_found' };
  if (carrier.claimedTenantId != null) return { kind: 'already_claimed' };

  const method = chooseClaimMethod({
    claimantEmail: input.actor.email,
    censusEmail: carrier.email,
    claimantVerified: input.claimantVerified,
  });
  const usdotInt = Number(dot);
  const existing = await store.pendingClaim(usdotInt, input.tenantId);
  const note = `claimant:${input.actor.email}`;

  /** Reuse the tenant's open claim row (fresh method/code) or insert one. */
  const upsertPending = async (patch: Partial<NewCarrierClaimRow>): Promise<CarrierClaimRow> => {
    if (existing) {
      await store.updateClaim(existing.id, { ...patch, note });
      return { ...existing, ...patch, note } as CarrierClaimRow;
    }
    return store.insertClaim({
      usdot: usdotInt,
      tenantId: input.tenantId,
      userId: input.actor.userId,
      method,
      status: 'pending',
      note,
      ...patch,
    });
  };

  if (method === 'domain_match') {
    const claim = await upsertPending({ method, otpHash: null, otpExpiresAt: null });
    const won = await finalizeClaim(store, { claim, carrier, actor: input.actor, method, now });
    if (!won) return { kind: 'already_claimed' };
    return { kind: 'verified', method, claimId: claim.id, slug: carrier.slug };
  }

  if (method === 'email_otp') {
    const code = generateOtp();
    const otpExpiresAt = new Date(now.getTime() + CLAIM_OTP_TTL_MS);
    const claim = await upsertPending({ method, otpHash: hashOtp(code), otpExpiresAt, attempts: 0 });
    // The census email is non-null here by construction (chooseClaimMethod).
    const delivered = await store.sendOtpEmail(carrier.email as string, { code, company: carrier.name });
    if (!delivered) {
      // A code nobody received proves nothing — and a code that only reached a
      // log file must never be honoured. Drop the hash and hand the claim to
      // support instead of reporting a send that did not happen.
      await store.updateClaim(claim.id, { method: 'manual', otpHash: null, otpExpiresAt: null, attempts: 0 });
      return { kind: 'needs_manual', claimId: claim.id };
    }
    return { kind: 'otp_sent', claimId: claim.id, maskedEmail: maskEmail(carrier.email as string), expiresAt: otpExpiresAt };
  }

  const claim = await upsertPending({ method, otpHash: null, otpExpiresAt: null });
  return { kind: 'needs_manual', claimId: claim.id };
}

export type VerifyClaimResult =
  | { kind: 'not_found' }
  | { kind: 'already_claimed' }
  | { kind: 'expired' }
  | { kind: 'locked' }
  | { kind: 'wrong_code'; attemptsLeft: number }
  | { kind: 'verified'; claimId: number; slug: string };

/** Submit the emailed code for the tenant's open email_otp claim on `usdot`. */
export async function verifyClaimCode(
  store: ClaimStore,
  input: { usdot: string; tenantId: number; actor: ClaimActor; code: string; now?: Date },
): Promise<VerifyClaimResult> {
  const now = input.now ?? new Date();
  const dot = normalizeDot(input.usdot);
  if (!dot) return { kind: 'not_found' };
  const carrier = await store.carrierByUsdot(dot);
  if (!carrier) return { kind: 'not_found' };
  if (carrier.claimedTenantId != null) return { kind: 'already_claimed' };

  const claim = await store.pendingClaim(Number(dot), input.tenantId);
  if (!claim || claim.method !== 'email_otp' || !claim.otpHash) return { kind: 'not_found' };
  if (claim.attempts >= CLAIM_OTP_MAX_ATTEMPTS) return { kind: 'locked' };
  if (!claim.otpExpiresAt || claim.otpExpiresAt.getTime() <= now.getTime()) {
    await store.updateClaim(claim.id, { status: 'expired' });
    return { kind: 'expired' };
  }
  if (!otpMatches(input.code, claim.otpHash)) {
    const attempts = claim.attempts + 1;
    await store.updateClaim(claim.id, { attempts });
    const attemptsLeft = Math.max(0, CLAIM_OTP_MAX_ATTEMPTS - attempts);
    return attemptsLeft === 0 ? { kind: 'locked' } : { kind: 'wrong_code', attemptsLeft };
  }
  const won = await finalizeClaim(store, { claim, carrier, actor: input.actor, method: 'email_otp', now });
  if (!won) return { kind: 'already_claimed' };
  return { kind: 'verified', claimId: claim.id, slug: carrier.slug };
}

export type ReviewClaimResult =
  | { kind: 'not_found' }
  | { kind: 'not_pending' }
  | { kind: 'already_claimed' }
  | { kind: 'verified' }
  | { kind: 'rejected' };

/** Admin decision on a pending (usually manual) claim. */
export async function reviewClaim(
  store: ClaimStore,
  input: { claimId: number; decision: 'verified' | 'rejected'; reason?: string | null; now?: Date },
): Promise<ReviewClaimResult> {
  const now = input.now ?? new Date();
  const claim = await store.claimById(input.claimId);
  if (!claim) return { kind: 'not_found' };
  if (claim.status !== 'pending') return { kind: 'not_pending' };
  if (input.decision === 'rejected') {
    await store.updateClaim(claim.id, { status: 'rejected', rejectedReason: input.reason ?? null });
    return { kind: 'rejected' };
  }
  const carrier = await store.carrierByUsdot(String(claim.usdot));
  if (!carrier) return { kind: 'not_found' };
  if (carrier.claimedTenantId != null) return { kind: 'already_claimed' };
  const user = await store.userById(claim.userId);
  if (!user) return { kind: 'not_found' };
  // An admin approval is the manual method regardless of how the claim began.
  const won = await finalizeClaim(store, { claim, carrier, actor: { userId: user.id, email: user.email }, method: 'manual', now });
  if (!won) return { kind: 'already_claimed' };
  return { kind: 'verified' };
}

/**
 * The single "it is verified" commit, shared by every method. Returns false
 * (and rejects the claim) when the directory row was claimed by someone else
 * in the meantime — the losing racer is never marked verified or owner.
 *   1. win the `claimed_tenant_id IS NULL` write on carrier_directory;
 *   2. claim row → verified;
 *   3. tenant flagged as directory owner, dot/mc filled where empty, neutral
 *      slug replaced by the branded one;
 *   4. public email on the profile → the claimant's address (carrier_overrides);
 *   5. best-effort edge purge of the profile so the badge shows up.
 */
async function finalizeClaim(
  store: ClaimStore,
  opts: { claim: CarrierClaimRow; carrier: ClaimCarrier; actor: ClaimActor; method: ClaimMethod; now: Date },
): Promise<boolean> {
  const won = await store.markCarrierClaimed(opts.carrier.usdot, opts.claim.tenantId, opts.method, opts.now);
  if (won < 1) {
    await store.updateClaim(opts.claim.id, {
      status: 'rejected',
      rejectedReason: 'already_claimed',
      otpHash: null,
      otpExpiresAt: null,
    });
    return false;
  }
  await store.updateClaim(opts.claim.id, {
    status: 'verified',
    method: opts.method,
    verifiedAt: opts.now,
    otpHash: null,
    otpExpiresAt: null,
  });
  await store.markTenantOwner(opts.claim.tenantId, { dotNumber: opts.carrier.usdot, mcNumber: opts.carrier.mcNumber });
  await store.brandTenantSlug(opts.claim.tenantId, opts.carrier.name);
  await store.setPublicEmail(opts.carrier.usdot, opts.actor.email, opts.actor);
  await store.purgeProfileCache(opts.carrier.slug);
  return true;
}

export type ActivateTrialResult =
  | { kind: 'not_eligible' }
  | { kind: 'activated'; trialEndsAt: Date };

/**
 * The "30 days free" upsell action. ONLY a VERIFIED directory owner (the
 * owner flag AND a directory row naming this tenant) with no trial on record
 * may start it; everyone else — an unverified claimant, a regular signup, a
 * tenant already in or past a trial — is refused, so this can never be used
 * to obtain or extend a trial without proving ownership.
 */
export async function activateOwnerTrial(
  store: ClaimStore,
  input: { tenantId: number; now?: Date },
): Promise<ActivateTrialResult> {
  const now = input.now ?? new Date();
  const t = await store.tenantTrial(input.tenantId);
  if (!t || !t.isDirectoryOwner || t.trialEndsAt != null) return { kind: 'not_eligible' };
  if (!(await store.hasVerifiedClaim(input.tenantId))) return { kind: 'not_eligible' };
  const trialEndsAt = new Date(now.getTime() + CLAIM_OWNER_TRIAL_DAYS * 24 * 60 * 60 * 1000);
  await store.setTrialEndsAt(input.tenantId, trialEndsAt);
  return { kind: 'activated', trialEndsAt };
}

// ─── Production store ───────────────────────────────────────────────────────

/** Is a real email provider configured? Mirrors sendEmail's precedence. The
 *  check is made BEFORE calling sendEmail so the ownership code never reaches
 *  the stdout dev fallback (which prints the message body). */
function emailProviderConfigured(): boolean {
  const env = loadEnv();
  return !!env.RESEND_API_KEY || !!(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
}

export const dbClaimStore: ClaimStore = {
  async carrierByUsdot(usdot) {
    const r = (
      await db()
        .select({
          usdot: carrierDirectory.usdot,
          slug: carrierDirectory.publicSlug,
          legalName: carrierDirectory.legalName,
          dbaName: carrierDirectory.dbaName,
          mcNumber: carrierDirectory.mcNumber,
          email: carrierDirectory.email,
          claimedTenantId: carrierDirectory.claimedTenantId,
        })
        .from(carrierDirectory)
        .where(eq(carrierDirectory.usdot, usdot))
        .limit(1)
    )[0];
    if (!r) return null;
    return {
      usdot: r.usdot,
      slug: r.slug,
      name: r.dbaName?.trim() || r.legalName,
      mcNumber: r.mcNumber,
      email: r.email?.trim() ? r.email.trim().toLowerCase() : null,
      claimedTenantId: r.claimedTenantId,
    };
  },
  async pendingClaim(usdot, tenantId) {
    return (
      (
        await db()
          .select()
          .from(carrierClaims)
          .where(and(eq(carrierClaims.usdot, usdot), eq(carrierClaims.tenantId, tenantId), eq(carrierClaims.status, 'pending')))
          .limit(1)
      )[0] ?? null
    );
  },
  async claimById(id) {
    return (await db().select().from(carrierClaims).where(eq(carrierClaims.id, id)).limit(1))[0] ?? null;
  },
  async insertClaim(row) {
    const inserted = await db().insert(carrierClaims).values(row).returning();
    if (!inserted[0]) throw new Error('carrier_claims insert returned no row');
    return inserted[0];
  },
  async updateClaim(id, patch) {
    await db().update(carrierClaims).set(patch).where(eq(carrierClaims.id, id));
  },
  async markCarrierClaimed(usdot, tenantId, method, at) {
    const rows = await db()
      .update(carrierDirectory)
      .set({ claimedTenantId: tenantId, claimedAt: at, claimMethod: method })
      .where(and(eq(carrierDirectory.usdot, usdot), isNull(carrierDirectory.claimedTenantId)))
      .returning({ usdot: carrierDirectory.usdot });
    return rows.length;
  },
  async markTenantOwner(tenantId, ids) {
    // COALESCE: never overwrite a DOT/MC the tenant typed themselves.
    await db()
      .update(tenants)
      .set({
        isDirectoryOwner: true,
        dotNumber: sql`COALESCE(NULLIF(${tenants.dotNumber}, ''), ${ids.dotNumber})`,
        mcNumber: sql`COALESCE(NULLIF(${tenants.mcNumber}, ''), ${ids.mcNumber})`,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenantId));
  },
  async brandTenantSlug(tenantId, companyName) {
    const t = (await db().select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, tenantId)).limit(1))[0];
    if (!t || !isNeutralClaimSlug(t.slug)) return;
    try {
      const slug = await deriveAvailableSlug(companyName);
      await db().update(tenants).set({ slug, updatedAt: new Date() }).where(eq(tenants.id, tenantId));
    } catch (err) {
      // A unique-violation race just means the neutral slug stays — it works.
      console.warn('[claims] slug branding skipped (non-fatal):', err instanceof Error ? err.message : err);
    }
  },
  async setPublicEmail(usdot, email, actor) {
    const r = await upsertCarrierOverride({
      usdot,
      body: { email },
      actorUserId: actor.userId,
      actorLabel: `claim:${actor.email}`,
    });
    if (r.status !== 200) console.warn('[claims] public email override failed:', r.json);
  },
  async sendOtpEmail(to, opts) {
    if (!emailProviderConfigured()) {
      console.warn('[claims] no email provider configured — ownership code NOT sent; falling back to manual review');
      return false;
    }
    const tpl = claimCodeEmail({ code: opts.code, company: opts.company, ttlMinutes: CLAIM_OTP_TTL_MS / 60_000 });
    const out = await sendEmail({ to, subject: tpl.subject, text: tpl.text, html: tpl.html });
    if (!wasSentByAProvider(out)) {
      console.warn(`[claims] ownership code not accepted by a provider (${out.error ?? out.provider ?? 'logged'}); falling back to manual review`);
      return false;
    }
    return true;
  },
  async userEmailVerified(userId) {
    const u = (
      await db()
        .select({ googleSub: users.googleSub, metaSub: users.metaSub, appleSub: users.appleSub })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)
    )[0];
    if (!u) return false;
    if (u.googleSub || u.metaSub || u.appleSub) return true;
    const used = (
      await db()
        .select({ token: magicLinks.token })
        .from(magicLinks)
        .where(and(eq(magicLinks.userId, userId), isNotNull(magicLinks.usedAt)))
        .limit(1)
    )[0];
    return !!used;
  },
  async userById(userId) {
    return (await db().select({ id: users.id, email: users.email }).from(users).where(eq(users.id, userId)).limit(1))[0] ?? null;
  },
  async tenantTrial(tenantId) {
    return (
      (
        await db()
          .select({ isDirectoryOwner: tenants.isDirectoryOwner, trialEndsAt: tenants.trialEndsAt })
          .from(tenants)
          .where(eq(tenants.id, tenantId))
          .limit(1)
      )[0] ?? null
    );
  },
  async hasVerifiedClaim(tenantId) {
    const r = (
      await db()
        .select({ usdot: carrierDirectory.usdot })
        .from(carrierDirectory)
        .where(eq(carrierDirectory.claimedTenantId, tenantId))
        .limit(1)
    )[0];
    return !!r;
  },
  async setTrialEndsAt(tenantId, trialEndsAt) {
    await db().update(tenants).set({ trialEndsAt, updatedAt: new Date() }).where(eq(tenants.id, tenantId));
  },
  async purgeProfileCache(slug) {
    try {
      await purgeEdgeUrls(carrierProfileUrls(slug));
    } catch (err) {
      console.warn('[claims] edge purge failed (non-fatal):', err instanceof Error ? err.message : err);
    }
  },
};
