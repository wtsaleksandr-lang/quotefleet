/**
 * Auth routes:
 *   POST /api/auth/signup    — create a tenant + owner user
 *   POST /api/auth/login     — log in (sets cookie)
 *   POST /api/auth/logout    — clear cookie
 *   GET  /api/auth/me        — current user / tenant
 */
import type { Express, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { db } from '../../db/client.js';
import {
  tenants,
  users,
  sessions,
  rateCards,
  accessorials,
  laneZones,
  terminals,
  aiConfigs,
  brandConfigs,
  magicLinks,
} from '../../db/schema.js';
import { sendEmail } from '../../email/send.js';
import { magicLinkEmail } from '../../email/templates.js';
import {
  DEFAULT_RATE_CARDS,
  DEFAULT_ACCESSORIALS,
  generateDefaultLaneZones,
  DEFAULT_AI_SYSTEM_PROMPT,
} from '../../calc/defaults.js';
import { TERMINALS_DATA } from '../../data/terminals.js';
import { hashPassword, verifyPassword } from '../../auth/password.js';
import {
  createSession,
  destroySession,
  lookupSession,
  SESSION_COOKIE_NAME,
} from '../../auth/session.js';
import { loadEnv, defaultHostDomain } from '../../config.js';
import { getTrialState, type TrialState } from '../trialGating.js';
import { magicLinkLimiter, signupLimiter, loginLimiter } from '../rateLimits.js';

const RESERVED_SLUGS = new Set([
  'www', 'app', 'admin', 'api', 'mail', 'docs', 'help', 'status', 'static',
  'cdn', 'assets', 'login', 'signup', 'logout', 'pricing', 'about', 'blog',
  'support', 'demo', 'test', 'staging', 'dev', 'public', 'private',
  'auth', 'oauth', 'embed', 'widget', 'chat', 'webhook', 'webhooks',
]);

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

const TRIAL_DAYS = 14;

const MagicLinkSendSchema = z.object({
  email: z.string().email(),
  redirectTo: z.string().optional(),
});

/** Magic links live for 15 minutes. Long enough to switch devices,
 *  short enough that a leaked link is mostly stale by the time anyone
 *  notices. */
const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40);
}

function setCookie(res: Response, token: string) {
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

    const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    const embedToken = nanoid(24);
    const passwordHash = await hashPassword(password);

    // ATOMIC SIGNUP: tenant + ai_config + brand + rate cards + accessorials
    // + lane zones + terminals + owner user — all-or-nothing. A failure
    // halfway used to leave orphaned tenants with no login.
    let result: { tenantId: number; userId: number };
    try {
      result = await db().transaction(async (tx) => {
        const [t] = await tx
          .insert(tenants)
          .values({
            slug,
            hostDomain,
            name: companyName,
            contactEmail: email,
            contactPhone: contactPhone ?? null,
            countryFocus,
            embedToken,
            plan: 'free',
            status: 'active',
            trialEndsAt,
            // Stamp DPA consent so we can prove later when + which
            // version of the DPA the tenant accepted.
            dpaAcceptedAt: new Date(),
            dpaVersion: parse.data.dpaVersion,
          })
          .returning({ id: tenants.id });
        if (!t) throw new Error('tenant insert returned no row');

        await tx.insert(aiConfigs).values({
          tenantId: t.id,
          systemPrompt: DEFAULT_AI_SYSTEM_PROMPT,
          tone: 'professional',
          autoReplyEnabled: true,
          chatEnabled: true,
        });
        await tx.insert(brandConfigs).values({
          tenantId: t.id,
          displayName: companyName,
          tagline: 'Instant freight quotes',
          primaryColor: '#2563eb',
          accentColor: '#06b6d4',
          ctaText: 'Get instant quote',
          showPoweredBy: true,
        });
        if (DEFAULT_RATE_CARDS.length > 0) {
          await tx.insert(rateCards).values(
            DEFAULT_RATE_CARDS.map((c) => ({ ...c, tenantId: t.id }))
          );
        }
        if (DEFAULT_ACCESSORIALS.length > 0) {
          await tx.insert(accessorials).values(
            DEFAULT_ACCESSORIALS.map((a) => ({ ...a, tenantId: t.id }))
          );
        }
        const zones = generateDefaultLaneZones();
        if (zones.length > 0) {
          await tx.insert(laneZones).values(zones.map((z) => ({ ...z, tenantId: t.id })));
        }
        if (TERMINALS_DATA.length > 0) {
          await tx.insert(terminals).values(
            TERMINALS_DATA.map((term, idx) => ({
              tenantId: t.id,
              portCode: term.portCode,
              code: term.code,
              name: term.name,
              carrier: term.carrier,
              address: term.address,
              lat: term.lat,
              lng: term.lng,
              notes: term.notes,
              surcharge: 0,
              enabled: true,
              sortOrder: idx,
            }))
          );
        }

        // Owner user. We do NOT auto-promote to super_admin here even
        // when email matches SUPER_ADMIN_EMAIL — that would let anyone
        // who guesses the operator's email and signs up first claim root.
        // Super-admin is created by the seed script (once, before signups
        // are accepted) or promoted manually later via SQL.
        const [u] = await tx
          .insert(users)
          .values({
            tenantId: t.id,
            email,
            passwordHash,
            role: 'tenant_owner',
            name: companyName,
          })
          .returning({ id: users.id });
        if (!u) throw new Error('user insert returned no row');

        return { tenantId: t.id, userId: u.id };
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

    const token = await createSession(result.userId);
    setCookie(res, token);

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
    contactPhone: z.string().max(50).nullable().optional(),
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
    if (parse.data.contactPhone !== undefined && ctx.user.tenantId) {
      await db()
        .update(tenants)
        .set({ contactPhone: parse.data.contactPhone, updatedAt: new Date() })
        .where(eq(tenants.id, ctx.user.tenantId));
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
          embedToken: string;
          plan: string;
          trialEndsAt: Date | null;
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
          embedToken: t[0].embedToken,
          plan: t[0].plan,
          trialEndsAt: t[0].trialEndsAt,
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
