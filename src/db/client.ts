/**
 * Drizzle client factory.
 *
 * Production: Neon serverless driver (HTTP — no persistent connections,
 * works on Replit's reserved-VM and serverless deployments).
 *
 * Local dev: same Neon driver — pointed at any Postgres URL. We don't
 * support local SQLite to keep the schema single-source-of-truth.
 */
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema.js';
import { loadEnv } from '../config.js';

let cached: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function db() {
  if (cached) return cached;
  const env = loadEnv();
  const sql = neon(env.DATABASE_URL);
  cached = drizzle(sql, { schema });
  return cached;
}

export type DB = ReturnType<typeof db>;
