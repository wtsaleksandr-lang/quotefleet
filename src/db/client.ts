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
  const client = postgres(env.DATABASE_URL, { ssl: 'prefer' });
  cached = drizzle(client, { schema });
  return cached;
}

export type DB = ReturnType<typeof db>;
