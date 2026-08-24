/**
 * Drizzle client factory.
 *
 * Uses the standard `postgres` driver which works with Replit's built-in
 * PostgreSQL as well as any external Postgres URL (Neon, Supabase, etc).
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';
import { loadEnv } from '../config.js';

let cached: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function db() {
  if (cached) return cached;
  const env = loadEnv();
  // Let the URL's sslmode parameter control SSL — don't override it.
  // Resilience options harden the pool for Neon: close idle conns before Neon
  // reaps them (silent drop → stray async rejection that used to kill the
  // process), and recycle long-lived conns.
  const client = postgres(env.DATABASE_URL, {
    idle_timeout: 30,        // close idle conns before Neon reaps them
    max_lifetime: 60 * 30,   // recycle conns every 30 min
    connect_timeout: 30,     // tolerate Neon serverless cold-wake during boot's
                             // DDL/migration storm (10s was too tight → threw)
    max: 10,
    onnotice: () => {},
  });
  cached = drizzle(client, { schema });
  return cached;
}

export type DB = ReturnType<typeof db>;
