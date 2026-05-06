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
  aiConfigs,
  brandConfigs,
} from '../../db/schema.js';
import {
  DEFAULT_RATE_CARDS,
  DEFAULT_ACCESSORIALS,
  generateDefaultLaneZones,
  DEFAULT_AI_SYSTEM_PROMPT,
} from '../../calc/defaults.js';
import { hashPassword, verifyPassword } from '../../auth/password.js';
import {
  createSession,
  destroySession,
  lookupSession,
  SESSION_COOKIE_NAME,
} from '../../auth/session.js';
import { loadEnv } from '../../config.js';

const SignupSchema = z.object({
  companyName: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(6).max(200),
  countryFocus: z.enum(['US', 'CA', 'BOTH']).default('US'),
  contactPhone: z.string().optional(),
});

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

    // Slug — incrementing if conflict
    let baseSlug = slugify(companyName) || 'co';
    let slug = baseSlug;
    let n = 0;
    while ((await db().select().from(tenants).where(eq(tenants.slug, slug)).limit(1))[0]) {
      n++;
      slug = `${baseSlug}-${n}`;
      if (n > 50) {
        slug = `${baseSlug}-${nanoid(6).toLowerCase()}`;
        break;
      }
    }

    const embedToken = nanoid(24);
    const [t] = await db()
      .insert(tenants)
      .values({
        slug,
        name: companyName,
        contactEmail: email,
        contactPhone: contactPhone ?? null,
        countryFocus,
        embedToken,
        plan: 'free',
        status: 'active',
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

    // Owner user. Auto-promote to super_admin if email matches SUPER_ADMIN_EMAIL.
    const env = loadEnv();
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

    return res.json({
      ok: true,
      tenant: { id: t.id, slug, name: companyName, embedToken },
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
    let tenant: { id: number; slug: string; name: string; embedToken: string } | null = null;
    if (ctx.user.tenantId) {
      const t = await db().select().from(tenants).where(eq(tenants.id, ctx.user.tenantId)).limit(1);
      if (t[0]) {
        tenant = {
          id: t[0].id,
          slug: t[0].slug,
          name: t[0].name,
          embedToken: t[0].embedToken,
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
