/**
 * Opaque-token sessions stored in DB. Cookie name: 'qf_sess'.
 * 30-day expiry, sliding (touched on each authenticated request).
 */
import { eq, gt, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../db/client.js';
import { sessions, users, type User } from '../db/schema.js';

const COOKIE_NAME = 'qf_sess';
const TTL_DAYS = 30;

export const SESSION_COOKIE_NAME = COOKIE_NAME;

export async function createSession(userId: number): Promise<string> {
  const token = nanoid(48);
  const expires = new Date(Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000);
  await db().insert(sessions).values({
    token,
    userId,
    expiresAt: expires,
  });
  return token;
}

export async function destroySession(token: string): Promise<void> {
  await db().delete(sessions).where(eq(sessions.token, token));
}

export interface AuthContext {
  user: User;
  token: string;
}

export async function lookupSession(
  token: string | undefined
): Promise<AuthContext | null> {
  if (!token) return null;
  const now = new Date();
  const rows = await db()
    .select({
      session: sessions,
      user: users,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, now)))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return { user: r.user, token: r.session.token };
}
