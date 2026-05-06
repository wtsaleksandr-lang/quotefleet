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
  rateCards,
  accessorials,
  laneZones,
  terminals,
  aiConfigs,
  brandConfigs,
} from '../../db/schema.js';
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

const RESERVED_SLUGS = new Set([
  'www', 'app', 'admin', 'api', 'mail', 'docs', 'help', 'status', 'static',
  'cdn', 'assets', 'login', 'signup', 'logout', 'pricing', 'about', 'blog',
  'support', 'demo', 'test', 'staging', 'dev', 'public', 'private',
  'auth', 'oauth', 'embed', 'widget', 'chat', 'webhook', 'webhooks',
]);

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
  password: z.string().min(6).max(200),
  countryFocus: z.enum(['US', 'CA', 'BOTH']).default('US'),
  contactPhone: z.string().optional(),
});

const TRIAL_DAYS = 14;

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
  const isHttps = (env.PUBLIC_BASE_URL ?? '').startsWith('https://');
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
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

  app.post('/api/auth/signup', async (req: Request, res: Response) => {
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
    const [t] = await db()
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
      })
      .returning({ id: tenants.id });
    if (!t) return res.status(500).json({ error: 'Failed to create tenant' });

    // Default config rows.
    await db().insert(aiConfigs).values({
      tenantId: t.id,
      systemPrompt: DEFAULT_AI_SYSTEM_PROMPT,
      tone: 'professional',
      autoReplyEnabled: true,
      chatEnabled: true,
    });
    await db().insert(brandConfigs).values({
      tenantId: t.id,
      displayName: companyName,
      tagline: 'Instant freight quotes',
      primaryColor: '#2563eb',
      accentColor: '#06b6d4',
      ctaText: 'Get instant quote',
      showPoweredBy: true,
    });
    for (const card of DEFAULT_RATE_CARDS) {
      await db().insert(rateCards).values({ ...card, tenantId: t.id });
    }
    for (const a of DEFAULT_ACCESSORIALS) {
      await db().insert(accessorials).values({ ...a, tenantId: t.id });
    }
    for (const z of generateDefaultLaneZones()) {
      await db().insert(laneZones).values({ ...z, tenantId: t.id });
    }
    // Seed terminals — full set; tenant disables ones they don't serve.
    let termIdx = 0;
    for (const term of TERMINALS_DATA) {
      await db().insert(terminals).values({
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
        sortOrder: termIdx++,
      });
    }

    // Owner user. Auto-promote to super_admin if email matches SUPER_ADMIN_EMAIL.
    const isSuperAdmin = env.SUPER_ADMIN_EMAIL && email === env.SUPER_ADMIN_EMAIL;
    const passwordHash = await hashPassword(password);
    const [u] = await db()
      .insert(users)
      .values({
        tenantId: t.id,
        email,
        passwordHash,
        role: isSuperAdmin ? 'super_admin' : 'tenant_owner',
        name: companyName,
      })
      .returning({ id: users.id });
    if (!u) return res.status(500).json({ error: 'Failed to create user' });

    const token = await createSession(u.id);
    setCookie(res, token);

    const proto = env.PUBLIC_BASE_URL.startsWith('http://') ? 'http:' : 'https:';
    return res.json({
      ok: true,
      tenant: {
        id: t.id,
        slug,
        hostDomain,
        hostedUrl: `${proto}//${slug}.${hostDomain}/`,
        name: companyName,
        embedToken,
        trialEndsAt,
      },
      role: isSuperAdmin ? 'super_admin' : 'tenant_owner',
    });
  });

  app.post('/api/auth/login', async (req: Request, res: Response) => {
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

  app.post('/api/auth/logout', async (req: Request, res: Response) => {
    const token = req.cookies[SESSION_COOKIE_NAME];
    if (token) await destroySession(token);
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
    });
  });
}
