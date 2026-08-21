/**
 * Referral/affiliate ATTRIBUTION (DB + cookie).
 *
 * Flow:
 *   1. A visitor lands on any marketing page with `?ref=<code>` (or `/r/:code`).
 *      captureRefClick() drops a 90-day `qf_ref` cookie and records a
 *      referral_attributions row (idempotent per browser+code).
 *   2. On tenant signup, linkReferralOnSignup() reads the cookie, ignores
 *      self-referral, links the attribution → new tenant, applies the referee
 *      reward (30-day trial for peer referrals) and queues the referrer's
 *      "1 free month" credit. Affiliate-code signups only link the attribution;
 *      cash commissions accrue in the phase-2 billing job.
 */
import type { Request, Response } from 'express';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../../db/client.js';
import { referralAttributions, referralCredits, tenants } from '../../db/schema.js';
import {
  REF_COOKIE_NAME,
  REF_COOKIE_MAX_AGE_MS,
  REFEREE_TRIAL_DAYS,
  REFEREE_DISCOUNT_PCT,
  REFEREE_DISCOUNT_MONTHS,
  REFERRER_FREE_MONTHS,
  normalizeCode,
  isValidCodeShape,
} from './programs.js';
import { resolveCodeOwner } from './codes.js';

interface RefCookie {
  code: string;
  token: string;
}

/** Parse the `qf_ref` cookie (`<CODE>~<visitorToken>`). */
export function parseRefCookie(raw: unknown): RefCookie | null {
  const s = String(raw ?? '');
  const i = s.indexOf('~');
  if (i <= 0) return null;
  const code = normalizeCode(s.slice(0, i));
  const token = s.slice(i + 1).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  if (!code || !token) return null;
  return { code, token };
}

function writeRefCookie(res: Response, code: string, token: string): void {
  const secure = process.env.NODE_ENV === 'production';
  res.cookie(REF_COOKIE_NAME, `${code}~${token}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: REF_COOKIE_MAX_AGE_MS,
    path: '/',
  });
}

/**
 * Capture a `?ref=<code>` (or an explicit code from `/r/:code`) into the cookie
 * + a referral_attributions row. Never throws into the request — attribution is
 * best-effort. Returns true when a (new) capture happened.
 */
export async function captureRefClick(
  req: Request,
  res: Response,
  explicitCode?: string
): Promise<boolean> {
  try {
    const raw = explicitCode ?? (req.query?.ref as string | undefined);
    const code = normalizeCode(raw);
    if (!code || !isValidCodeShape(code)) return false;

    const existing = parseRefCookie(req.cookies?.[REF_COOKIE_NAME]);
    // Same code already captured in this browser → refresh cookie TTL, no dupe row.
    if (existing && existing.code === code) {
      writeRefCookie(res, code, existing.token);
      return false;
    }
    const token = existing?.token || nanoid(16);
    writeRefCookie(res, code, token);

    const owner = await resolveCodeOwner(code);
    const kind = owner ? owner.kind : 'unknown';
    await db().insert(referralAttributions).values({
      code,
      kind,
      visitorToken: token,
      rewardStatus: 'pending',
    });
    return true;
  } catch (err) {
    console.warn('[affiliate] captureRefClick failed (non-fatal):', err);
    return false;
  }
}

export interface ReferralLinkResult {
  kind: 'referral' | 'affiliate';
  attributionId: number;
  /** Peer referral: the referee reward applied to the NEW tenant. */
  refereeTrialDays?: number;
  refereeDiscountPct?: number;
  refereeDiscountMonths?: number;
  /** Peer referral: the referrer tenant queued a free-month credit. */
  referrerTenantId?: number;
  referrerFreeMonths?: number;
  /** Affiliate: the affiliate credited with this signup. */
  affiliateId?: number;
}

/**
 * Link a pending attribution to a freshly-created tenant + apply rewards.
 * Idempotent + self-referral-safe; never throws into the signup path (returns
 * null on any miss/error). `signupEmail` is the new owner's login email — used
 * to detect + ignore self-referral.
 */
export async function linkReferralOnSignup(opts: {
  req: Request;
  tenantId: number;
  signupEmail: string;
}): Promise<ReferralLinkResult | null> {
  try {
    const cookie = parseRefCookie(opts.req.cookies?.[REF_COOKIE_NAME]);
    if (!cookie) return null;
    const owner = await resolveCodeOwner(cookie.code);
    if (!owner) return null;

    const email = opts.signupEmail.trim().toLowerCase();
    const ownerEmail = (owner.ownerEmail ?? '').trim().toLowerCase();
    const selfByEmail = !!ownerEmail && ownerEmail === email;
    const selfByTenant =
      (owner.kind === 'referral' && owner.tenantId === opts.tenantId) ||
      (owner.kind === 'affiliate' && owner.ownerTenantId === opts.tenantId);

    // Find (or create) the attribution row for this browser+code.
    let attribution = (
      await db()
        .select()
        .from(referralAttributions)
        .where(
          and(
            eq(referralAttributions.visitorToken, cookie.token),
            eq(referralAttributions.code, cookie.code),
            isNull(referralAttributions.referredTenantId)
          )
        )
        .orderBy(desc(referralAttributions.landedAt))
        .limit(1)
    )[0];

    if (!attribution) {
      attribution = (
        await db()
          .insert(referralAttributions)
          .values({
            code: cookie.code,
            kind: owner.kind,
            visitorToken: cookie.token,
            rewardStatus: 'pending',
          })
          .returning()
      )[0];
    }
    if (!attribution) return null;

    if (selfByEmail || selfByTenant) {
      await db()
        .update(referralAttributions)
        .set({ referredTenantId: opts.tenantId, rewardStatus: 'ignored' })
        .where(eq(referralAttributions.id, attribution.id));
      return null;
    }

    // Link the attribution to the new tenant.
    await db()
      .update(referralAttributions)
      .set({ referredTenantId: opts.tenantId, kind: owner.kind, rewardStatus: 'signed_up' })
      .where(eq(referralAttributions.id, attribution.id));

    if (owner.kind === 'referral') {
      // Referee reward: extend the trial to 30 days (only ever extends — the
      // fresh tenant was provisioned at 14). The 20%-off intro discount is
      // recorded as a program constant + read at billing time (phase-2 seam,
      // getRefereeDiscountForTenant); no live coupon is created here.
      const trialEndsAt = new Date(Date.now() + REFEREE_TRIAL_DAYS * 24 * 60 * 60 * 1000);
      await db().update(tenants).set({ trialEndsAt }).where(eq(tenants.id, opts.tenantId));

      // Queue the referrer's free-month credit — idempotent (one per attribution).
      const already = (
        await db()
          .select({ id: referralCredits.id })
          .from(referralCredits)
          .where(eq(referralCredits.sourceAttributionId, attribution.id))
          .limit(1)
      )[0];
      if (!already) {
        await db().insert(referralCredits).values({
          tenantId: owner.tenantId,
          sourceAttributionId: attribution.id,
          monthsGranted: REFERRER_FREE_MONTHS,
          status: 'pending',
        });
      }
      return {
        kind: 'referral',
        attributionId: attribution.id,
        refereeTrialDays: REFEREE_TRIAL_DAYS,
        refereeDiscountPct: REFEREE_DISCOUNT_PCT,
        refereeDiscountMonths: REFEREE_DISCOUNT_MONTHS,
        referrerTenantId: owner.tenantId,
        referrerFreeMonths: REFERRER_FREE_MONTHS,
      };
    }

    // Affiliate code — cash commission accrues in phase 2; nothing more here.
    return { kind: 'affiliate', attributionId: attribution.id, affiliateId: owner.affiliateId };
  } catch (err) {
    console.warn('[affiliate] linkReferralOnSignup failed (non-fatal):', err);
    return null;
  }
}

/**
 * PHASE-2 SEAM: the referee intro-discount a tenant is entitled to, or null.
 * A tenant qualifies when it signed up through a PEER-referral code (an
 * attribution row referredTenantId=tenant, kind='referral', not ignored). The
 * billing job reads this to apply the 20%-off-first-3-months coupon.
 */
export async function getRefereeDiscountForTenant(
  tenantId: number
): Promise<{ pct: number; months: number } | null> {
  const row = (
    await db()
      .select({ id: referralAttributions.id, status: referralAttributions.rewardStatus })
      .from(referralAttributions)
      .where(
        and(
          eq(referralAttributions.referredTenantId, tenantId),
          eq(referralAttributions.kind, 'referral')
        )
      )
      .limit(1)
  )[0];
  if (!row || row.status === 'ignored') return null;
  return { pct: REFEREE_DISCOUNT_PCT, months: REFEREE_DISCOUNT_MONTHS };
}
