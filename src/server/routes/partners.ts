/**
 * Affiliate + Referral program routes (Phase 1).
 *
 *   [middleware]  ?ref=<code> on any GET → capture click + set 90-day cookie
 *   GET  /r/:code                 → capture + redirect to '/'
 *   GET  /partners                → public landing (both programs + signup form)
 *   GET  /partners/terms          → full program terms
 *   GET  /partners/dashboard      → an affiliate's dashboard (?code=… gate)
 *   POST /api/partners/signup     → self-serve affiliate signup (email → link)
 *   GET  /api/tenant/referral     → the logged-in tenant's referral link + stats
 *
 * Payout execution + commission accrual are PHASE 2 (see schema
 * affiliate_commissions + src/server/affiliate/*). This file wires the tables,
 * attribution, self-serve signup and dashboards only.
 */
import type { Express, Request, Response, NextFunction } from 'express';
import { and, count, eq, ne, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { affiliates, referralAttributions, referralCredits, tenants } from '../../db/schema.js';
import { requireAuth, requireTenant } from '../middleware.js';
import { signupLimiter } from '../rateLimits.js';
import {
  AFFILIATE_BASE_RATE,
  REFERRER_FREE_MONTHS,
  normalizeCode,
  isValidCodeShape,
} from '../affiliate/programs.js';
import { captureRefClick } from '../affiliate/attribution.js';
import { logAndSwallow } from '../backgroundSafety.js';
import { notifyAffiliateApproved } from '../affiliate/notifications.js';
import { mintUniqueCode, ensureTenantReferralCode } from '../affiliate/codes.js';
import {
  affiliateLink,
  getAffiliateByCode,
  computeAffiliateDashboard,
} from '../affiliate/dashboard.js';
import {
  renderPartnersLanding,
  renderPartnersTerms,
  renderAffiliateDashboard,
  renderDashboardGate,
} from '../affiliate/pages.js';

const REFERRAL_BASE = 'https://quotefleet.net';

const AffiliateSignupSchema = z.object({
  email: z.string().email().max(200),
  name: z.string().max(120).optional(),
});

export function registerPartnersRoutes(app: Express): void {
  // ── ?ref=<code> capture (any request) ────────────────────────────────────
  // Best-effort, non-blocking: records the click + drops the qf_ref cookie, then
  // always calls next() so the normal page still renders. Only fires when a
  // `ref` query param is present, so it's a no-op on the vast majority of hits.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'GET' && typeof req.query?.ref === 'string' && req.query.ref) {
      // Fire-and-forget — never block the response on attribution.
      void captureRefClick(req, res).catch(logAndSwallow('partners captureRefClick'));
    }
    next();
  });

  // ── /r/:code short link → capture + redirect home ────────────────────────
  app.get('/r/:code', async (req: Request, res: Response) => {
    const code = normalizeCode(req.params.code);
    if (code && isValidCodeShape(code)) {
      await captureRefClick(req, res, code);
    }
    return res.redirect(302, '/');
  });

  // ── Public pages ─────────────────────────────────────────────────────────
  app.get('/partners', (_req: Request, res: Response) => {
    res.type('html').send(renderPartnersLanding());
  });

  app.get(['/partners/terms', '/partners/terms/'], (_req: Request, res: Response) => {
    res.type('html').send(renderPartnersTerms());
  });

  app.get('/partners/dashboard', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const code = normalizeCode(req.query.code);
      if (!code) {
        return res
          .type('html')
          .send(renderDashboardGate('Enter your affiliate code to view your dashboard.'));
      }
      const affiliate = await getAffiliateByCode(code);
      if (!affiliate) {
        return res
          .status(404)
          .type('html')
          .send(renderDashboardGate('We couldn’t find an affiliate with that code. Check it and try again.'));
      }
      const dash = await computeAffiliateDashboard(affiliate, REFERRAL_BASE);
      return res.type('html').send(renderAffiliateDashboard(dash));
    } catch (err) {
      return next(err);
    }
  });

  // ── Self-serve affiliate signup ──────────────────────────────────────────
  app.post('/api/partners/signup', signupLimiter, async (req: Request, res: Response) => {
    const parse = AffiliateSignupSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }
    const email = parse.data.email.trim().toLowerCase();
    const name = parse.data.name?.trim() || null;
    try {
      // Idempotent: if this email is already an affiliate, return their existing
      // code (so a repeat submit is friendly, not a duplicate-key error).
      const existing = (
        await db().select().from(affiliates).where(eq(affiliates.email, email)).limit(1)
      )[0];
      if (existing) {
        return res.json({
          ok: true,
          code: existing.code,
          link: affiliateLink(existing.code, REFERRAL_BASE),
          existing: true,
        });
      }
      // Link to an existing tenant/user if this email owns an account (so a
      // customer who becomes an affiliate is connected).
      const owner = (
        await db()
          .select({ id: tenants.id })
          .from(tenants)
          .where(eq(tenants.contactEmail, email))
          .limit(1)
      )[0];

      const code = await mintUniqueCode();
      const inserted = (
        await db()
          .insert(affiliates)
          .values({
            email,
            name,
            code,
            tier: 'base',
            commissionRate: AFFILIATE_BASE_RATE,
            // Self-serve signups are active immediately so their link tracks from
            // day one; commission payout gating happens in the phase-2 billing job.
            status: 'active',
            ownerTenantId: owner?.id ?? null,
          })
          .returning({ id: affiliates.id, code: affiliates.code })
      )[0];
      if (!inserted) throw new Error('affiliate insert returned no row');

      // Best-effort welcome: self-serve affiliates are born `active`, so THIS is
      // the once-per-affiliate "you're approved" moment for this path (the
      // idempotent `existing` branch above returns before here, so a repeat
      // submit never re-emails). Fire-and-forget — never block signup on mail.
      void notifyAffiliateApproved({
        to: email,
        affiliateName: name,
        code: inserted.code,
        commissionRate: AFFILIATE_BASE_RATE,
      }).catch((err) => {
        console.warn('[partners.signup] approved-email notify failed (non-fatal):', err);
      });

      return res.json({
        ok: true,
        code: inserted.code,
        link: affiliateLink(inserted.code, REFERRAL_BASE),
      });
    } catch (err) {
      // Unique-violation race on email/code → treat as already-registered.
      const msg = err instanceof Error ? err.message : String(err);
      if (/duplicate key|unique/i.test(msg)) {
        const again = (
          await db().select().from(affiliates).where(eq(affiliates.email, email)).limit(1)
        )[0];
        if (again) {
          return res.json({
            ok: true,
            code: again.code,
            link: affiliateLink(again.code, REFERRAL_BASE),
            existing: true,
          });
        }
      }
      console.error('[partners.signup] failed:', err);
      return res.status(500).json({ error: 'Could not create your affiliate account. Try again.' });
    }
  });

  // ── Logged-in tenant referral surface (portal "Refer & earn" card) ───────
  app.get('/api/tenant/referral', requireAuth, requireTenant, async (req: Request, res: Response) => {
    const tid = req.tenant!.id;
    const code = await ensureTenantReferralCode(tid);
    const [clicksRow, signupsRow, creditRows] = await Promise.all([
      db().select({ n: count() }).from(referralAttributions).where(eq(referralAttributions.code, code)),
      db()
        .select({ n: count() })
        .from(referralAttributions)
        .where(
          and(
            eq(referralAttributions.code, code),
            isNotNull(referralAttributions.referredTenantId),
            ne(referralAttributions.rewardStatus, 'ignored')
          )
        ),
      db()
        .select({
          status: referralCredits.status,
          months: sql<number>`coalesce(sum(${referralCredits.monthsGranted}), 0)`,
        })
        .from(referralCredits)
        .where(eq(referralCredits.tenantId, tid))
        .groupBy(referralCredits.status),
    ]);
    let pendingMonths = 0;
    let appliedMonths = 0;
    for (const r of creditRows) {
      if (r.status === 'applied') appliedMonths += Number(r.months ?? 0);
      else if (r.status === 'pending') pendingMonths += Number(r.months ?? 0);
    }
    return res.json({
      code,
      link: affiliateLink(code, REFERRAL_BASE),
      freeMonthsPerReferral: REFERRER_FREE_MONTHS,
      stats: {
        clicks: Number(clicksRow[0]?.n ?? 0),
        signups: Number(signupsRow[0]?.n ?? 0),
        creditsPendingMonths: pendingMonths,
        creditsAppliedMonths: appliedMonths,
      },
    });
  });
}
