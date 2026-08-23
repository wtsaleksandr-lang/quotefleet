/**
 * Auth routes:
 *   POST /api/auth/signup    — create a tenant + owner user
 *   POST /api/auth/login     — log in (sets cookie)
 *   POST /api/auth/logout    — clear cookie
 *   GET  /api/auth/me        — current user / tenant
 */
import type { Express, Request, Response } from 'express';
import { and, eq, ne, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { db } from '../../db/client.js';
import {
  tenants,
  users,
  sessions,
  magicLinks,
  passwordResetTokens,
} from '../../db/schema.js';
import { sendEmail } from '../../email/send.js';
import { magicLinkEmail, passwordResetEmail } from '../../email/templates.js';
import { hashPassword, verifyPassword } from '../../auth/password.js';
import {
  RESERVED_SLUGS,
  TRIAL_DAYS,
  slugify,
  provisionTrialTenant,
} from './tenantProvision.js';
import {
  createSession,
  destroySession,
  lookupSession,
  SESSION_COOKIE_NAME,
} from '../../auth/session.js';
import { loadEnv, defaultHostDomain } from '../../config.js';
import { DEFAULT_QUOTE_DISCLAIMER } from '../quoteDisclaimer.js';
import { getTrialState, type TrialState } from '../trialGating.js';
import {
  magicLinkLimiter,
  signupLimiter,
  loginLimiter,
  passwordResetRequestLimiter,
  passwordResetIpLimiter,
  passwordResetVerifyLimiter,
} from '../rateLimits.js';
import { parsePaidPlan } from '../plans.js';
import { linkReferralOnSignup } from '../affiliate/attribution.js';
import { REFEREE_TRIAL_DAYS } from '../affiliate/programs.js';

/** Current DPA version published at /dpa. Bumped when the DPA's
 *  substantive terms change; existing tenants are forced to re-accept
 *  before their next billing event when the version differs. */
export const CURRENT_DPA_VERSION = '1.0';

const SignupSchema = z.object({
  companyName: z.string().min(1).max(120),
  /** URL slug → also the subdomain. 3-30 chars, [a-z0-9-]. */
  slug: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'Lowercase letters, numbers and dashes only.')
    .optional(),
  /** Which platform-owned host to put this tenant on. */
  hostDomain: z.string().optional(),
  email: z.string().email(),
  /** Min 10 chars; bumped from 6 after security audit. */
  password: z.string().min(10).max(200),
  /** Selected subscription tier — the card-required 14-day trial is
   *  all-inclusive regardless; this is what Stripe auto-bills at trial end.
   *  Optional here (defaults to Vital) so the API stays lenient; the signup
   *  form always sends an explicit choice. */
  plan: z.enum(['vital', 'pro']).optional(),
  countryFocus: z.enum(['US', 'CA', 'BOTH']).default('US'),
  contactPhone: z.string().optional(),
  /** Required: ticked the DPA + Security-policy checkbox on the signup
   *  form. Server refuses signup without it; we record acceptance time
   *  + version on the tenant row so legal can prove consent. */
  dpaAccepted: z.literal(true, {
    message: 'You must accept the Data Processing Addendum to create an account.',
  }),
  dpaVersion: z.string().min(1).max(20),
});

/** Returns true if `path` is safe to use as a relative redirect target.
 *  Refuses absolute URLs, scheme-less protocol-relative ('//evil'), and
 *  anything that's not strictly under the platform's own origin. */
function isSafeRelativeRedirect(path: string | null | undefined): boolean {
  if (!path) return false;
  if (typeof path !== 'string') return false;
  if (!path.startsWith('/')) return false;
  if (path.startsWith('//')) return false;
  if (path.startsWith('/\\')) return false;
  return true;
}

const MagicLinkSendSchema = z.object({
  email: z.string().email(),
  redirectTo: z.string().optional(),
});

/** Magic links live for 15 minutes. Long enough to switch devices,
 *  short enough that a leaked link is mostly stale by the time anyone
 *  notices. */
const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;

/** Password-reset links live for 45 minutes — long enough to find the email and
 *  switch to a laptop, short enough that a leaked link is mostly stale. */
const PASSWORD_RESET_TTL_MS = 45 * 60 * 1000;

/** Hash a raw reset token for storage/lookup. We persist ONLY this SHA-256 hash
 *  (never the raw token), so a dump of password_reset_tokens can't be replayed.
 *  SHA-256 is correct here (not bcrypt): the token is high-entropy random
 *  (48-char nanoid ~285 bits), so it isn't brute-forceable and doesn't need a
 *  slow KDF — and the lookup must be a fast, deterministic point-read by PK. */
function hashResetToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export function setCookie(res: Response, token: string) {
  const env = loadEnv();
  const isHttps =
    (env.PUBLIC_BASE_URL ?? '').startsWith('https://') ||
    process.env.NODE_ENV === 'production';
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    // Lax (not Strict) so magic-link emails opened from a browser still
    // arrive logged-in on first hop. Wildcard *.<host-domain> means a
    // compromised tenant subdomain is "same site" — combine with CSRF
    // origin checks on state-changing endpoints.
    sameSite: 'lax',
    secure: isHttps,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

function clearCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
}

export function registerAuthRoutes(app: Express) {
  // Public endpoint for the signup page to discover available host domains
  // and check slug availability before submit.
  app.get('/api/auth/signup-options', (_req, res) => {
    const env = loadEnv();
    return res.json({
      hostDomains: env.HOST_DOMAINS,
      defaultHostDomain: defaultHostDomain(),
      trialDays: TRIAL_DAYS,
      reservedSlugs: Array.from(RESERVED_SLUGS),
    });
  });

  app.get('/api/auth/check-slug', async (req: Request, res: Response) => {
    const slug = String(req.query.slug ?? '').toLowerCase().trim();
    if (!slug) return res.json({ ok: false, reason: 'empty' });
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) {
      return res.json({ ok: false, reason: 'format' });
    }
    if (slug.length < 3 || slug.length > 30) {
      return res.json({ ok: false, reason: 'length' });
    }
    if (RESERVED_SLUGS.has(slug)) return res.json({ ok: false, reason: 'reserved' });
    const t = await db().select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
    if (t[0]) return res.json({ ok: false, reason: 'taken' });
    return res.json({ ok: true });
  });

  app.post('/api/auth/signup', signupLimiter, async (req: Request, res: Response) => {
    const parse = SignupSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: 'Invalid input', details: parse.error.flatten() });
    }
    const { companyName, email, password, countryFocus, contactPhone } = parse.data;

    // Email uniqueness
    const existing = await db().select().from(users).where(eq(users.email, email)).limit(1);
    if (existing[0]) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Slug — caller-provided wins if valid + free; otherwise derive from company name.
    let slug = (parse.data.slug ?? '').toLowerCase().trim();
    if (slug) {
      if (RESERVED_SLUGS.has(slug)) {
        return res.status(400).json({ error: `Slug "${slug}" is reserved.` });
      }
      const taken = await db().select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
      if (taken[0]) {
        return res.status(409).json({ error: `Slug "${slug}" is already taken.` });
      }
    } else {
      const baseSlug = slugify(companyName) || 'co';
      slug = baseSlug;
      let n = 0;
      while (
        RESERVED_SLUGS.has(slug) ||
        (await db().select().from(tenants).where(eq(tenants.slug, slug)).limit(1))[0]
      ) {
        n++;
        slug = `${baseSlug}-${n}`;
        if (n > 50) {
          slug = `${baseSlug}-${nanoid(6).toLowerCase()}`;
          break;
        }
      }
    }

    // Host domain — must be one of the platform-owned domains.
    const env = loadEnv();
    let hostDomain = (parse.data.hostDomain ?? '').toLowerCase().trim();
    if (hostDomain && !env.HOST_DOMAINS.includes(hostDomain)) {
      return res.status(400).json({ error: `Host "${hostDomain}" is not available.` });
    }
    if (!hostDomain) hostDomain = defaultHostDomain();

    const passwordHash = await hashPassword(password);

    // ATOMIC SIGNUP: tenant + ai_config + brand + rate cards + accessorials
    // + lane zones + terminals + owner user — all-or-nothing. Factored into
    // provisionTrialTenant() so social login (routes/oauth.ts) creates a
    // first-time OAuth user's tenant through the exact same path. We do NOT
    // auto-promote to super_admin here even when email matches
    // SUPER_ADMIN_EMAIL — super-admin is seeded/promoted out of band.
    let result: Awaited<ReturnType<typeof provisionTrialTenant>>;
    try {
      result = await provisionTrialTenant({
        companyName,
        email,
        passwordHash,
        countryFocus,
        contactPhone: contactPhone ?? null,
        dpaVersion: parse.data.dpaVersion,
        slug,
        hostDomain,
      });
    } catch (err) {
      console.error('[auth.signup] transaction failed:', err);
      // Slug-pick race: a concurrent signup may have grabbed our slug
      // between the check above and the insert. Friendly 409.
      const msg = err instanceof Error ? err.message : String(err);
      if (/duplicate key|unique/i.test(msg) && /slug/i.test(msg)) {
        return res.status(409).json({ error: `Slug "${slug}" was just taken — try another.` });
      }
      return res.status(500).json({ error: 'Failed to create account. Try again.' });
    }
    let trialEndsAt = result.trialEndsAt;
    const embedToken = result.embedToken;

    // Referral/affiliate attribution: link any pending `?ref` click to this new
    // tenant, apply the referee reward (peer referrals → 30-day trial + queued
    // referrer credit) and ignore self-referral. Non-fatal — never blocks signup.
    const referral = await linkReferralOnSignup({
      req,
      tenantId: result.tenantId,
      signupEmail: email,
    });
    if (referral?.kind === 'referral') {
      // Mirror the extended trial the linker wrote to the DB into the response.
      trialEndsAt = new Date(Date.now() + REFEREE_TRIAL_DAYS * 24 * 60 * 60 * 1000);
    }

    const token = await createSession(result.userId);
    setCookie(res, token);

    // Card-AFTER-trial: signup is ALWAYS card-free — we do NOT create a Stripe
    // Checkout session at signup, even when billing is configured. The card is
    // collected LATER, at subscribe / trial-end, not up front. Product decision
    // 2026-08-03 (see plans.ts + memory project_quotefleet_pricing_model): don't
    // gate signup behind a card. Every signup lands on a card-free 14-day
    // all-inclusive trial and the client goes straight to /app (checkoutUrl is
    // always null). The day-14 paywall + the in-app "subscribe" escape (which
    // DOES collect the card via createTrialCheckoutSession) + the trial-reminder
    // emails live elsewhere (trial-gating middleware + billing routes), NOT here.
    const selectedPlan = parsePaidPlan(parse.data.plan);
    const checkoutUrl: string | null = null;

    const proto = env.PUBLIC_BASE_URL.startsWith('http://') ? 'http:' : 'https:';
    return res.json({
      ok: true,
      tenant: {
        id: result.tenantId,
        slug,
        hostDomain,
        hostedUrl: `${proto}//${slug}.${hostDomain}/`,
        name: companyName,
        embedToken,
        trialEndsAt,
      },
      plan: selectedPlan,
      // Always null now — signup is card-free (card-after-trial). Kept in the
      // response shape for client compatibility: the client lands on /app when
      // checkoutUrl is absent/null (the norm). The card is collected later at
      // subscribe / trial-end, not at signup.
      checkoutUrl,
      role: 'tenant_owner',
    });
  });

  app.post('/api/auth/login', loginLimiter, async (req: Request, res: Response) => {
    const parse = LoginSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: 'Invalid input' });
    }
    const { email, password } = parse.data;
    const rows = await db().select().from(users).where(eq(users.email, email)).limit(1);
    const u = rows[0];
    if (!u) return res.status(401).json({ error: 'Invalid email or password' });
    const ok = await verifyPassword(password, u.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid email or password' });
    await db().update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, u.id));
    const token = await createSession(u.id);
    setCookie(res, token);

    let tenant: { slug: string; name: string } | null = null;
    if (u.tenantId) {
      const t = await db().select().from(tenants).where(eq(tenants.id, u.tenantId)).limit(1);
      if (t[0]) tenant = { slug: t[0].slug, name: t[0].name };
    }
    return res.json({ ok: true, role: u.role, tenant });
  });

  // ── Magic link: send ─────────────────────────────────────────────
  // Always returns 200 (even on unknown email) — prevents email enumeration.
  app.post('/api/auth/magic-link/send', magicLinkLimiter, async (req: Request, res: Response) => {
    const parse = MagicLinkSendSchema.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: 'Invalid input' });
    const { email, redirectTo } = parse.data;
    // Refuse absolute / protocol-relative redirect targets (open-redirect
    // phishing). Only same-origin relative paths under '/' are stored.
    const safeRedirect = isSafeRelativeRedirect(redirectTo) ? redirectTo! : null;
    const u = (await db().select().from(users).where(eq(users.email, email)).limit(1))[0];
    if (!u) {
      return res.json({ ok: true });
    }
    const token = nanoid(32);
    const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MS);
    await db().insert(magicLinks).values({
      token,
      userId: u.id,
      expiresAt,
      redirectTo: safeRedirect,
    });
    const env = loadEnv();
    const base = env.PUBLIC_BASE_URL.replace(/\/$/, '');
    const link = `${base}/auth/magic/${token}`;
    const tpl = magicLinkEmail({ link, email, ttlMinutes: 15 });
    try {
      const result = await sendEmail({
        to: email,
        subject: tpl.subject,
        text: tpl.text,
        html: tpl.html,
      });
      // If we fell through to the stdout fallback in dev, log loudly so
      // operators notice — the email was NOT actually delivered.
      if (result.logged) {
        console.warn(
          `[magic-link] delivered to STDOUT only — no email provider configured. ` +
            `Set RESEND_API_KEY (preferred) or SMTP_HOST/USER/PASS in env to actually send. ` +
            `Recipient: ${email}, link: ${link}`
        );
      } else if (!result.ok) {
        // A configured provider failed — surface it loudly so a dead key can't
        // silently kill 100% of logins. Keep the same {ok:true} privacy
        // response to the client below (no user-facing change).
        console.error(`[email] magic-link send FAILED for user: ${result.error ?? 'unknown error'}`);
      }
    } catch (err) {
      console.warn('[magic-link] send failed:', err);
    }
    return res.json({ ok: true });
  });

  // ── Magic link: consume ─────────────────────────────────────────
  // GET so it works as a plain link in email. Sets the cookie and
  // redirects to /app (or to ?next=... if provided at send time).
  app.get('/auth/magic/:token', async (req: Request, res: Response) => {
    const token = String(req.params.token ?? '');
    if (!token) return res.redirect('/login?error=missing-token');
    const rows = await db().select().from(magicLinks).where(eq(magicLinks.token, token)).limit(1);
    const row = rows[0];
    if (!row) return res.redirect('/login?error=invalid-token');
    if (row.usedAt) return res.redirect('/login?error=link-used');
    if (row.expiresAt < new Date()) return res.redirect('/login?error=link-expired');
    // Mark used + create session.
    await db().update(magicLinks).set({ usedAt: new Date() }).where(eq(magicLinks.token, token));
    await db().update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, row.userId));
    const sess = await createSession(row.userId);
    setCookie(res, sess);
    // Re-validate the stored redirectTo on consumption — defense in depth
    // in case a stale row was written before the validation was added.
    const dest = isSafeRelativeRedirect(row.redirectTo) ? row.redirectTo! : '/app';
    return res.redirect(dest);
  });

  // ── Forgot password: request a reset link ───────────────────────
  // Always returns the SAME 200 body regardless of whether the email maps to a
  // real account (or is even well-formed) — no probe can enumerate accounts.
  // Closes the "magic-link login but can't set a password" dead-end: a user who
  // forgot their password gets an emailed link to set a NEW one without knowing
  // the old one. Rate-limited per-email (anti-bomb).
  const ForgotPasswordSchema = z.object({ email: z.string().email() });
  app.post(
    '/api/auth/password/forgot',
    passwordResetIpLimiter,
    passwordResetRequestLimiter,
    async (req: Request, res: Response) => {
      // One identical response for every outcome (bad input / unknown email /
      // sent). Never reveals whether an account exists.
      const genericOk = () =>
        res.json({
          ok: true,
          message: "If that email has an account, we've sent a reset link.",
        });
      const parse = ForgotPasswordSchema.safeParse(req.body);
      if (!parse.success) return genericOk();
      const email = parse.data.email.trim().toLowerCase();
      const u = (await db().select().from(users).where(eq(users.email, email)).limit(1))[0];
      if (!u) return genericOk();

      // Neutralise any still-valid earlier reset tokens for this user, so only
      // the newest emailed link works (a previously-leaked link is burned on
      // re-request).
      await db()
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(and(eq(passwordResetTokens.userId, u.id), isNull(passwordResetTokens.usedAt)));

      const rawToken = nanoid(48);
      const tokenHash = hashResetToken(rawToken);
      const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
      await db().insert(passwordResetTokens).values({ tokenHash, userId: u.id, expiresAt });

      const env = loadEnv();
      const base = env.PUBLIC_BASE_URL.replace(/\/$/, '');
      // Raw token in the link ONLY — it is never stored or logged.
      const link = `${base}/reset-password?token=${rawToken}`;
      const ttlMinutes = Math.round(PASSWORD_RESET_TTL_MS / 60000);
      const tpl = passwordResetEmail({ link, email, ttlMinutes });
      // CONSTANT-TIME response: do NOT await delivery. Awaiting the email
      // round-trip only on the existing-user branch would make that branch
      // measurably slower than the unknown-email branch — a timing oracle that
      // re-introduces enumeration. Fire-and-forget so both branches return the
      // generic 200 in the same time; log the outcome from the settled promise.
      void sendEmail({
        to: email,
        subject: tpl.subject,
        text: tpl.text,
        html: tpl.html,
      })
        .then((result) => {
          if (result.logged) {
            // Dev fallback (no provider) — the link was NOT delivered. Log the
            // recipient (never the token) so an operator notices a dead provider.
            console.warn(
              `[password-reset] delivered to STDOUT only — no email provider configured. ` +
                `Set RESEND_API_KEY (preferred) or SMTP_HOST/USER/PASS in env to actually send. ` +
                `Recipient: ${email}`,
            );
          } else if (!result.ok) {
            console.error(
              `[email] password-reset send FAILED for user: ${result.error ?? 'unknown error'}`,
            );
          }
        })
        .catch((err) => {
          console.warn('[password-reset] send failed:', err);
        });
      return genericOk();
    },
  );

  // ── Forgot password: set a new password with a reset token ──────
  // Validates the token (exists, unused, unexpired), sets the new password with
  // the SAME hashing + strength rules as signup/change-password, burns the
  // token, and revokes EVERY session for the user (a reset is the moment to sign
  // out any stale/attacker device). The user then signs in fresh with the new
  // password. Rate-limited per-IP.
  const ResetPasswordSchema = z.object({
    token: z.string().min(1),
    // Same strength rule as SignupSchema.password / PasswordSchema.next.
    password: z.string().min(10).max(200),
  });
  app.post(
    '/api/auth/password/reset',
    passwordResetVerifyLimiter,
    async (req: Request, res: Response) => {
      const parse = ResetPasswordSchema.safeParse(req.body);
      if (!parse.success) {
        return res.status(400).json({ error: 'New password must be at least 10 characters.' });
      }
      const tokenHash = hashResetToken(parse.data.token);
      const row = (
        await db()
          .select()
          .from(passwordResetTokens)
          .where(eq(passwordResetTokens.tokenHash, tokenHash))
          .limit(1)
      )[0];
      // One message for every bad-token case (missing / used / expired) — no
      // signal about which. The token is random, so this leaks nothing about
      // accounts.
      const invalid = () =>
        res
          .status(400)
          .json({ error: 'This reset link is invalid or has expired. Request a new one.' });
      if (!row) return invalid();
      if (row.usedAt) return invalid();
      if (row.expiresAt < new Date()) return invalid();

      // ATOMIC single-use: CLAIM the token before doing any work. The read above
      // is only a fast-fail; the real guard is this conditional burn. Two
      // concurrent requests with the same token both pass the read (usedAt is
      // still NULL for both), but `WHERE usedAt IS NULL` means exactly ONE
      // UPDATE flips it — the loser affects zero rows and is rejected. We claim
      // FIRST (before the slow bcrypt hash + password write) so only the winner
      // proceeds and no duplicate reset can slip through the check-then-act gap.
      const burned = await db()
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(and(eq(passwordResetTokens.tokenHash, tokenHash), isNull(passwordResetTokens.usedAt)))
        .returning({ tokenHash: passwordResetTokens.tokenHash });
      if (burned.length !== 1) return invalid();

      const newHash = await hashPassword(parse.data.password);
      await db().update(users).set({ passwordHash: newHash }).where(eq(users.id, row.userId));
      // Revoke every session for this user (all devices) — the reset invalidates
      // any prior session, incl. one an attacker may hold.
      await db().delete(sessions).where(eq(sessions.userId, row.userId));
      return res.json({ ok: true });
    },
  );

  app.post('/api/auth/logout', async (req: Request, res: Response) => {
    const token = req.cookies[SESSION_COOKIE_NAME];
    if (token) await destroySession(token);
    clearCookie(res);
    return res.json({ ok: true });
  });

  // ── Profile updates ─────────────────────────────────────────────
  // The Account page in the dashboard uses these to let the user
  // change their name / contact email / phone, change their password,
  // and sign out of every other session.
  const ProfileSchema = z.object({
    name: z.string().min(1).max(120).optional(),
    email: z.string().email().max(200).optional(),
    // Tenant-level contact fields on the tenant row (NOT the user row —
    // `email` above is the owner's *login* email).
    //   • contactPhone — customer-facing phone (widget + hosted quotes).
    //   • publicContactEmail — OPT-IN customer-facing email (widget + hosted
    //     quotes). Nullable; when unset the email row is hidden on public
    //     surfaces. This is what the Account "Company details" card edits.
    //   • contactEmail — PRIVATE owner/login email (notifications only). Kept
    //     in the schema for API back-compat, but the UI no longer edits it and
    //     it is never rendered publicly.
    contactPhone: z.string().max(50).nullable().optional(),
    publicContactEmail: z.string().email().max(200).nullable().optional(),
    contactEmail: z.string().email().max(200).nullable().optional(),
    //   • quoteDisclaimer — customer-facing terms shown at the bottom of every
    //     quote. Nullable; when null/blank the platform default is rendered.
    quoteDisclaimer: z.string().max(4000).nullable().optional(),
  });
  app.put('/api/auth/profile', async (req: Request, res: Response) => {
    const token = req.cookies[SESSION_COOKIE_NAME];
    const ctx = await lookupSession(token);
    if (!ctx) return res.status(401).json({ error: 'Unauthorized' });
    const parse = ProfileSchema.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: 'Invalid input' });
    const update: Record<string, unknown> = {};
    if (parse.data.name !== undefined) update.name = parse.data.name;
    if (parse.data.email !== undefined && parse.data.email !== ctx.user.email) {
      // Refuse if a different user already has the new email.
      const taken = await db()
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, parse.data.email))
        .limit(1);
      if (taken[0] && taken[0].id !== ctx.user.id) {
        return res.status(409).json({ error: 'That email is already in use.' });
      }
      update.email = parse.data.email;
    }
    if (Object.keys(update).length > 0) {
      await db().update(users).set(update).where(eq(users.id, ctx.user.id));
    }
    // Tenant-level contact fields (shown to customers on the widget +
    // hosted quotes). Only touch the ones actually provided so partial
    // saves from the Account "Company details" card don't clobber siblings.
    if (ctx.user.tenantId) {
      const tenantUpdate: Record<string, unknown> = {};
      if (parse.data.contactPhone !== undefined) tenantUpdate.contactPhone = parse.data.contactPhone;
      if (parse.data.publicContactEmail !== undefined) tenantUpdate.publicContactEmail = parse.data.publicContactEmail;
      if (parse.data.quoteDisclaimer !== undefined) tenantUpdate.quoteDisclaimer = parse.data.quoteDisclaimer;
      if (parse.data.contactEmail !== undefined) tenantUpdate.contactEmail = parse.data.contactEmail;
      if (Object.keys(tenantUpdate).length > 0) {
        tenantUpdate.updatedAt = new Date();
        await db().update(tenants).set(tenantUpdate).where(eq(tenants.id, ctx.user.tenantId));
      }
    }
    return res.json({ ok: true });
  });

  // Password change — requires the current password (defence vs cookie
  // theft / shared workstation). Min length 10 enforced server-side.
  const PasswordSchema = z.object({
    current: z.string().min(1),
    next: z.string().min(10).max(200),
  });
  app.put('/api/auth/password', async (req: Request, res: Response) => {
    const token = req.cookies[SESSION_COOKIE_NAME];
    const ctx = await lookupSession(token);
    if (!ctx) return res.status(401).json({ error: 'Unauthorized' });
    const parse = PasswordSchema.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: 'New password must be at least 10 characters.' });
    const ok = await verifyPassword(parse.data.current, ctx.user.passwordHash);
    if (!ok) return res.status(403).json({ error: 'Current password does not match.' });
    const newHash = await hashPassword(parse.data.next);
    await db().update(users).set({ passwordHash: newHash }).where(eq(users.id, ctx.user.id));
    // Revoke every OTHER session so changing the password (esp. after a suspected
    // cookie theft) actually signs out other devices. The current session stays
    // valid — matching the Account UI's "You stay signed in here".
    await db().delete(sessions).where(and(eq(sessions.userId, ctx.user.id), ne(sessions.token, token ?? '')));
    return res.json({ ok: true });
  });

  // Sign out every session for this user (including the current one).
  // Useful after a suspected leak of the session cookie or to revoke
  // access from a shared computer.
  app.post('/api/auth/sign-out-all', async (req: Request, res: Response) => {
    const token = req.cookies[SESSION_COOKIE_NAME];
    const ctx = await lookupSession(token);
    if (!ctx) return res.status(401).json({ error: 'Unauthorized' });
    await db().delete(sessions).where(eq(sessions.userId, ctx.user.id));
    clearCookie(res);
    return res.json({ ok: true });
  });

  app.get('/api/auth/me', async (req: Request, res: Response) => {
    const token = req.cookies[SESSION_COOKIE_NAME];
    const ctx = await lookupSession(token);
    if (!ctx) return res.json({ user: null });
    let tenant:
      | {
          id: number;
          slug: string;
          hostDomain: string;
          hostedUrl: string;
          name: string;
          contactEmail: string | null;
          publicContactEmail: string | null;
          contactPhone: string | null;
          quoteDisclaimer: string | null;
          defaultQuoteDisclaimer: string;
          embedToken: string;
          plan: string;
          trialEndsAt: Date | null;
          needsOnboarding: boolean;
        }
      | null = null;
    let trial: TrialState | null = null;
    if (ctx.user.tenantId) {
      const t = await db().select().from(tenants).where(eq(tenants.id, ctx.user.tenantId)).limit(1);
      if (t[0]) {
        const env = loadEnv();
        const proto = env.PUBLIC_BASE_URL.startsWith('http://') ? 'http:' : 'https:';
        tenant = {
          id: t[0].id,
          slug: t[0].slug,
          hostDomain: t[0].hostDomain,
          hostedUrl: `${proto}//${t[0].slug}.${t[0].hostDomain}/`,
          name: t[0].name,
          contactEmail: t[0].contactEmail ?? null,
          publicContactEmail: t[0].publicContactEmail ?? null,
          contactPhone: t[0].contactPhone ?? null,
          // Raw override (null = using the default) + the default text itself so
          // the Account "Quote disclaimer" textarea can prefill and show the
          // default as its placeholder.
          quoteDisclaimer: t[0].quoteDisclaimer ?? null,
          defaultQuoteDisclaimer: DEFAULT_QUOTE_DISCLAIMER,
          embedToken: t[0].embedToken,
          plan: t[0].plan,
          trialEndsAt: t[0].trialEndsAt,
          // Server-side gate for the post-signup guided wizard. True until the
          // trucker finishes OR skips it. A server flag (not localStorage) so
          // it survives the billing/Stripe redirect after signup.
          needsOnboarding:
            (t[0].onboardingJson?.completedAt ?? null) == null &&
            !t[0].onboardingJson?.skipped,
        };
        trial = await getTrialState(t[0]);
      }
    }
    return res.json({
      user: {
        id: ctx.user.id,
        email: ctx.user.email,
        name: ctx.user.name,
        role: ctx.user.role,
      },
      tenant,
      trial,
    });
  });
}
