/**
 * FREE-FOREVER directory profile claims — HTTP layer over directory/claims.ts.
 *
 *   GET   /claim                       — finder page (pick your company)
 *   GET   /claim/:slug                 — the 3-step claim page (a bare USDOT
 *                                        redirects to the slug form)
 *   POST  /api/claim/:usdot/start      — { email?, password? } → begin a claim;
 *                                        creates the free account when needed
 *   POST  /api/claim/:usdot/verify     — { code } → submit the emailed code
 *   GET   /api/admin/claims            — ?status= list (super-admin)
 *   PATCH /api/admin/claims/:id        — { status:'verified'|'rejected', reason? }
 *   POST  /api/tenant/trial/activate   — the "30 days free" upsell action
 *
 * Claiming never touches a plan, a card or a trial: a brand-new claimant gets
 * a tenant with `trialEndsAt: null` + `isDirectoryOwner: true` (free forever).
 * The quote-tool trial is opt-in via /api/tenant/trial/activate only.
 */
import type { Express, Request, Response } from 'express';
import { desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { carrierClaims, magicLinks, tenants, users } from '../../db/schema.js';
import { hashPassword } from '../../auth/password.js';
import { createSession, lookupSession, SESSION_COOKIE_NAME } from '../../auth/session.js';
import { sendEmail } from '../../email/send.js';
import { magicLinkEmail } from '../../email/templates.js';
import { loadEnv } from '../../config.js';
import { requireAuth, requireSuperAdmin, requireTenant } from '../middleware.js';
import { publicAutocompleteLimiter, signupLimiter } from '../rateLimits.js';
import { setNoStore } from '../directory/httpCache.js';
import { carrierBySlug } from '../directory/queries.js';
import { carrierName, renderCarrierNotFound } from '../directory/pages.js';
import { renderClaimFinder, renderClaimPage } from '../directory/claimPage.js';
import {
  activateOwnerTrial,
  dbClaimStore,
  neutralClaimSlug,
  reviewClaim,
  startClaim,
  verifyClaimCode,
  type ClaimStore,
} from '../directory/claims.js';
import { normalizeDot } from '../directory/carrierIngest.js';
import { CURRENT_DPA_VERSION, setCookie } from './auth.js';
import { provisionTrialTenant } from './tenantProvision.js';

const StartSchema = z.object({
  email: z.string().email().optional(),
  /** Optional; when absent the new account is passwordless (magic-link sign-in). */
  password: z.string().min(10).max(200).optional(),
});
const VerifySchema = z.object({ code: z.string().regex(/^\d{6}$/) });
const ReviewSchema = z.object({
  status: z.enum(['verified', 'rejected']),
  reason: z.string().max(500).optional(),
});

/** Magic links live for 15 minutes (mirrors routes/auth.ts). */
const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;

/** Existing account + not signed in → a sign-in link that lands back on the
 *  claim page. Best-effort send; the response never reveals a failure. */
async function issueClaimMagicLink(userId: number, email: string, slug: string): Promise<void> {
  const token = nanoid(32);
  await db().insert(magicLinks).values({
    token,
    userId,
    expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MS),
    redirectTo: `/claim/${encodeURIComponent(slug)}`,
  });
  const base = loadEnv().PUBLIC_BASE_URL.replace(/\/$/, '');
  const tpl = magicLinkEmail({ link: `${base}/auth/magic/${token}`, email, ttlMinutes: 15 });
  try {
    await sendEmail({ to: email, subject: tpl.subject, text: tpl.text, html: tpl.html });
  } catch (err) {
    console.warn('[claim] magic-link send failed:', err);
  }
}

export function registerClaimRoutes(app: Express, store: ClaimStore = dbClaimStore) {
  app.get('/claim', publicAutocompleteLimiter, (_req: Request, res: Response) => {
    res.type('html').send(renderClaimFinder());
  });

  app.get('/claim/:slug', publicAutocompleteLimiter, async (req: Request, res: Response, next) => {
    try {
      const raw = String(req.params.slug ?? '');
      // The finder links by USDOT (the public search has no slug); resolve it.
      if (/^\d+$/.test(raw)) {
        const dot = normalizeDot(raw);
        const c = dot ? await store.carrierByUsdot(dot) : null;
        if (!c) {
          setNoStore(res);
          return res.status(404).type('html').send(renderCarrierNotFound());
        }
        return res.redirect(302, `/claim/${encodeURIComponent(c.slug)}`);
      }
      const carrier = await carrierBySlug(raw);
      // Personal (signed-in state) and never cacheable.
      setNoStore(res);
      if (!carrier) return res.status(404).type('html').send(renderCarrierNotFound());

      const ctx = await lookupSession(req.cookies?.[SESSION_COOKIE_NAME]);
      let viewer = null;
      if (ctx) {
        const tid = ctx.user.tenantId;
        const owns = tid != null && carrier.claimedTenantId === tid;
        let canActivateTrial = false;
        if (owns && tid != null) {
          const t = await store.tenantTrial(tid);
          canActivateTrial = !!t && t.isDirectoryOwner && t.trialEndsAt == null;
        }
        viewer = { email: ctx.user.email, hasTenant: tid != null, ownsThisProfile: owns, canActivateTrial };
      }
      res.type('html').send(renderClaimPage({ carrier, viewer }));
    } catch (err) {
      next(err);
    }
  });

  // ── Start a claim ────────────────────────────────────────────────────────
  app.post('/api/claim/:usdot/start', signupLimiter, async (req: Request, res: Response) => {
    setNoStore(res);
    const parse = StartSchema.safeParse(req.body ?? {});
    if (!parse.success) {
      return res.status(400).json({ error: 'Invalid input', details: parse.error.flatten() });
    }
    const dot = normalizeDot(String(req.params.usdot));
    const carrier = dot ? await store.carrierByUsdot(dot) : null;
    if (!carrier) return res.status(404).json({ kind: 'not_found', error: 'No such carrier.' });
    if (carrier.claimedTenantId != null) {
      return res.status(409).json({ kind: 'already_claimed', error: 'This profile already has a verified owner.' });
    }

    // Resolve the claimant: the signed-in account, or a brand-new free one.
    let actor: { userId: number; email: string; tenantId: number; verified: boolean };
    const ctx = await lookupSession(req.cookies?.[SESSION_COOKIE_NAME]);
    if (ctx) {
      if (ctx.user.tenantId == null) {
        return res.status(409).json({
          kind: 'no_tenant',
          error: 'This is a shipper account. Sign out and claim with your company email.',
        });
      }
      actor = {
        userId: ctx.user.id,
        email: ctx.user.email,
        tenantId: ctx.user.tenantId,
        verified: await store.userEmailVerified(ctx.user.id),
      };
    } else {
      const email = parse.data.email?.trim().toLowerCase();
      if (!email) return res.status(400).json({ error: 'Enter your work email.' });
      const existing = (await db().select().from(users).where(eq(users.email, email)).limit(1))[0];
      if (existing) {
        // Never a blind session on an existing account — sign them in by link.
        await issueClaimMagicLink(existing.id, email, carrier.slug);
        return res.json({ ok: true, kind: 'magic_link', email });
      }
      const passwordHash = await hashPassword(parse.data.password ?? nanoid(32));
      const companyName = carrier.name;
      let provisioned;
      try {
        provisioned = await provisionTrialTenant({
          companyName,
          email,
          passwordHash,
          countryFocus: 'US',
          dpaVersion: CURRENT_DPA_VERSION,
          // NEUTRAL slug until the claim is verified: starting a claim must
          // not let anyone squat the company's name (finalizeClaim brands it).
          slug: neutralClaimSlug(carrier.usdot, nanoid(8)),
          // FREE FOREVER: no trial, no card, no plan. NOT an owner yet — only a
          // verified claim flips isDirectoryOwner (and unlocks the 30-day trial).
          trialEndsAt: null,
          isDirectoryOwner: false,
          signupSource: 'claim',
        });
      } catch (err) {
        console.error('[claim] provisioning failed:', err);
        return res.status(500).json({ error: 'Could not create your free account. Try again.' });
      }
      setCookie(res, await createSession(provisioned.userId));
      actor = { userId: provisioned.userId, email, tenantId: provisioned.tenantId, verified: false };
    }

    try {
      const r = await startClaim(store, {
        usdot: carrier.usdot,
        tenantId: actor.tenantId,
        actor: { userId: actor.userId, email: actor.email },
        claimantVerified: actor.verified,
      });
      switch (r.kind) {
        case 'not_found':
          return res.status(404).json({ kind: r.kind, error: 'No such carrier.' });
        case 'already_claimed':
          return res.status(409).json({ kind: r.kind, error: 'This profile already has a verified owner.' });
        case 'verified':
          return res.json({ ok: true, kind: r.kind, method: r.method, profileUrl: `/directory/carrier/${encodeURIComponent(r.slug)}` });
        case 'otp_sent':
          return res.json({ ok: true, kind: r.kind, method: 'email_otp', maskedEmail: r.maskedEmail, expiresAt: r.expiresAt.toISOString() });
        case 'needs_manual':
          return res.json({ ok: true, kind: r.kind, method: 'manual', needs_manual: true });
      }
    } catch (err) {
      console.error('[claim] start failed:', err);
      return res.status(500).json({ error: 'Could not start the claim. Try again in a minute.' });
    }
  });

  // ── Verify the emailed code ──────────────────────────────────────────────
  app.post('/api/claim/:usdot/verify', requireAuth, async (req: Request, res: Response) => {
    setNoStore(res);
    const parse = VerifySchema.safeParse(req.body ?? {});
    if (!parse.success) return res.status(400).json({ kind: 'invalid', error: 'Enter the 6-digit code.' });
    const user = req.user!;
    if (user.tenantId == null) return res.status(409).json({ kind: 'no_tenant', error: 'No carrier account on this login.' });
    const r = await verifyClaimCode(store, {
      usdot: String(req.params.usdot),
      tenantId: user.tenantId,
      actor: { userId: user.id, email: user.email },
      code: parse.data.code,
    });
    switch (r.kind) {
      case 'not_found':
        return res.status(404).json({
          kind: r.kind,
          error: 'No code is pending for this profile. Request a new code, or use the support path if your FMCSA record has no email.',
        });
      case 'already_claimed':
        return res.status(409).json({ kind: r.kind, error: 'This profile already has a verified owner.' });
      case 'expired':
        return res.status(410).json({ kind: r.kind, error: 'That code expired.' });
      case 'locked':
        return res.status(423).json({ kind: r.kind, error: 'Too many wrong codes.' });
      case 'wrong_code':
        return res.status(400).json({ kind: r.kind, attemptsLeft: r.attemptsLeft });
      case 'verified':
        return res.json({ ok: true, kind: r.kind, profileUrl: `/directory/carrier/${encodeURIComponent(r.slug)}` });
    }
  });

  // ── Admin review (manual path) ───────────────────────────────────────────
  app.get('/api/admin/claims', requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    const status = typeof req.query.status === 'string' ? req.query.status : 'pending';
    const rows = await db()
      .select({
        id: carrierClaims.id,
        usdot: carrierClaims.usdot,
        tenantId: carrierClaims.tenantId,
        userId: carrierClaims.userId,
        method: carrierClaims.method,
        status: carrierClaims.status,
        attempts: carrierClaims.attempts,
        note: carrierClaims.note,
        createdAt: carrierClaims.createdAt,
        verifiedAt: carrierClaims.verifiedAt,
        rejectedReason: carrierClaims.rejectedReason,
        tenantName: tenants.name,
        claimantEmail: users.email,
      })
      .from(carrierClaims)
      .leftJoin(tenants, eq(tenants.id, carrierClaims.tenantId))
      .leftJoin(users, eq(users.id, carrierClaims.userId))
      .where(eq(carrierClaims.status, status))
      .orderBy(desc(carrierClaims.createdAt))
      .limit(200);
    res.json({ data: rows });
  });

  app.patch('/api/admin/claims/:id', requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid claim id.' });
    const parse = ReviewSchema.safeParse(req.body ?? {});
    if (!parse.success) return res.status(400).json({ error: 'Invalid input', details: parse.error.flatten() });
    const r = await reviewClaim(store, { claimId: id, decision: parse.data.status, reason: parse.data.reason ?? null });
    switch (r.kind) {
      case 'not_found':
        return res.status(404).json({ error: 'Claim not found.' });
      case 'not_pending':
        return res.status(409).json({ error: 'Claim is not pending.' });
      case 'already_claimed':
        return res.status(409).json({ error: 'Profile already verified for another tenant.' });
      default:
        return res.json({ ok: true, status: r.kind });
    }
  });

  // ── The "30 days free" upsell ────────────────────────────────────────────
  app.post('/api/tenant/trial/activate', requireAuth, requireTenant, async (req: Request, res: Response) => {
    setNoStore(res);
    const r = await activateOwnerTrial(store, { tenantId: req.tenant!.id });
    if (r.kind === 'not_eligible') {
      return res.status(409).json({
        error: 'not_eligible',
        message: 'The 30-day trial is for verified profile owners who have not started a trial yet.',
      });
    }
    return res.json({ ok: true, trialEndsAt: r.trialEndsAt.toISOString() });
  });
}
