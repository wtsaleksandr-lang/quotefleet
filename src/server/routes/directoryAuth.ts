/**
 * Directory Pro shipper auth.
 *
 *   POST /api/directory/auth/signup  — create a SHIPPER account (a `users` row
 *                                      with tenantId=null, role='shipper') and
 *                                      log them in. Email + optional password;
 *                                      passwordless accounts get an unusable hash
 *                                      and sign in later via magic link.
 *   GET  /api/directory/auth/me      — SOFT: the current shipper + their Directory
 *                                      Pro entitlement (or { user:null } when not
 *                                      signed in). Never a 401.
 *
 * Login reuses the EXISTING auth stack as-is: POST /api/auth/login (password) and
 * the magic-link routes. So signup is deliberately narrow — it ONLY handles the
 * "new shipper" case. If the email already exists (e.g. a carrier owner adding a
 * Directory Pro entitlement), signup does NOT error: it issues a magic link so
 * they log into their existing account, then subscribe. Never a blind session on
 * an existing account (that would be account takeover).
 *
 * The shipper reuses the same `qf_sess` cookie + `sessions` table as tenants;
 * requireTenant still 403s these tenant-less users out of every seller route, so
 * no seller surface leaks.
 */
import type { Express, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { users, magicLinks } from '../../db/schema.js';
import { hashPassword } from '../../auth/password.js';
import { createSession, SESSION_COOKIE_NAME } from '../../auth/session.js';
import { sendEmail } from '../../email/send.js';
import { magicLinkEmail } from '../../email/templates.js';
import { loadEnv } from '../../config.js';
import { signupLimiter } from '../rateLimits.js';
import { setCookie } from './auth.js';
import { directoryIdentity } from '../directory/entitlement.js';

/** Magic links live for 15 minutes (mirrors routes/auth.ts). */
const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;

const SignupSchema = z.object({
  email: z.string().email(),
  /** Optional. When present, min 10 chars (matches the tenant signup policy).
   *  When absent, the account is passwordless — sign in later via magic link. */
  password: z.string().min(10).max(200).optional(),
});

/** Issue + email a magic link for an existing user id. Best-effort: a send
 *  failure is logged, never surfaced (same privacy posture as auth.ts). */
async function issueMagicLink(userId: number, email: string): Promise<void> {
  const token = nanoid(32);
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MS);
  await db().insert(magicLinks).values({
    token,
    userId,
    expiresAt,
    // Land back on the directory after login so they can subscribe.
    redirectTo: '/directory',
  });
  const env = loadEnv();
  const base = env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const link = `${base}/auth/magic/${token}`;
  const tpl = magicLinkEmail({ link, email, ttlMinutes: 15 });
  try {
    await sendEmail({ to: email, subject: tpl.subject, text: tpl.text, html: tpl.html });
  } catch (err) {
    console.warn('[directory.auth.signup] magic-link send failed:', err);
  }
}

export function registerDirectoryAuthRoutes(app: Express) {
  app.post('/api/directory/auth/signup', signupLimiter, async (req: Request, res: Response) => {
    const parse = SignupSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: 'Invalid input', details: parse.error.flatten() });
    }
    const { email, password } = parse.data;

    // Existing email → NOT an error. Issue a magic link so they log into their
    // existing account (they may be a carrier owner adding Directory Pro). We do
    // NOT create a session here — that would be account takeover.
    const existing = (await db().select().from(users).where(eq(users.email, email)).limit(1))[0];
    if (existing) {
      await issueMagicLink(existing.id, email);
      return res.json({ ok: true, existing: true, login: 'magic_link' });
    }

    // New shipper: a tenant-less user with role='shipper'. Passwordless accounts
    // get a random unusable hash (like OAuth users) and sign in via magic link.
    const passwordHash = password
      ? await hashPassword(password)
      : await hashPassword(nanoid(32));
    let userId: number;
    try {
      const inserted = await db()
        .insert(users)
        .values({ tenantId: null, email, passwordHash, role: 'shipper' })
        .returning({ id: users.id });
      userId = inserted[0].id;
    } catch (err) {
      console.error('[directory.auth.signup] insert failed:', err);
      return res.status(500).json({ error: 'Failed to create account. Try again.' });
    }

    const token = await createSession(userId);
    setCookie(res, token);
    return res.json({ ok: true, existing: false, user: { id: userId, email } });
  });

  // SOFT auth: current shipper + entitlement. Never 401 — an anonymous caller
  // just gets { user: null, directoryPro: null }.
  app.get('/api/directory/auth/me', async (req: Request, res: Response) => {
    const id = await directoryIdentity(req);
    if (id.userId == null) {
      return res.json({ user: null, directoryPro: null });
    }
    return res.json({
      user: { id: id.userId, email: id.email },
      directoryPro: { status: id.status, currentPeriodEnd: id.currentPeriodEnd },
    });
  });
}
