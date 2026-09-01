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

/**
 * Server-side ceiling on a single statement, in milliseconds.
 *
 * KEPT AT 8s DELIBERATELY. It was re-examined on 2026-08-31 against the
 * question "is this too tight for a Neon cold wake?" and the answer is no, for
 * two independent reasons:
 *
 *   • statement_timeout is a SERVER-side clock. It starts when the backend
 *     begins executing a statement, which is after the connection exists.
 *     Waking a suspended compute happens during connect, and that wait is
 *     bounded by `connect_timeout` (30s below), not by this.
 *   • Nothing comes close to it. Across every job run recorded in the
 *     production ledger the slowest was marketplace-aggregates at 1,136 ms;
 *     every other job's 95th percentile is under 120 ms.
 *
 * What it protects against is unchanged and still worth having: a heavy
 * directory scan under crawler load holding a pooled connection until the pool
 * (max: 10) starves and the whole app stalls. Raising it would widen that
 * window in exchange for headroom nothing is using.
 *
 * (The previous comment here claimed "15s" while the code said 8000 — the
 * number is now named once and referenced, so the two cannot drift again.)
 */
export const STATEMENT_TIMEOUT_MS = 8000;

export function db() {
  if (cached) return cached;
  const env = loadEnv();

  // Prefer the pooled (PgBouncer) endpoint when one is configured. See
  // config.ts's DATABASE_POOLED_URL for why migrations keep the direct URL.
  const pooled = env.DATABASE_POOLED_URL?.trim();
  const url = pooled || env.DATABASE_URL;
  if (pooled) {
    console.log('[db] app pool using DATABASE_POOLED_URL (prepared statements disabled)');
  }

  // Let the URL's sslmode parameter control SSL — don't override it.
  // Resilience options harden the pool for Neon: close idle conns before Neon
  // reaps them (silent drop → stray async rejection that used to kill the
  // process), and recycle long-lived conns.
  const client = postgres(url, {
    idle_timeout: 30,        // close idle conns before Neon reaps them
    max_lifetime: 60 * 30,   // recycle conns every 30 min
    connect_timeout: 30,     // tolerate Neon serverless cold-wake during boot's
                             // DDL/migration storm (10s was too tight → threw)
    max: 10,
    // PgBouncer in transaction pooling mode gives each statement whichever
    // backend is free, so a statement PREPAREd on one connection is not there
    // when the next one EXECUTEs it. postgres.js prepares by default, so the
    // pooled endpoint is only safe with this off. Direct endpoint keeps
    // prepared statements (and their plan caching).
    prepare: pooled ? false : undefined,
    // Bound every query server-side so no single statement can hold a pooled
    // connection indefinitely — see STATEMENT_TIMEOUT_MS above. The boot
    // self-heal/migration DDL runs through its OWN separate
    // `postgres(..., { max: 1 })` clients (see db/migrate.ts), not this pool,
    // so the ceiling protects request serving without risking the heal.
    // Value is milliseconds; postgres.js's ConnectionParameters type declares
    // statement_timeout as a number, so it's passed numerically (serialized to
    // the wire protocol identically to a string).
    connection: { statement_timeout: STATEMENT_TIMEOUT_MS },
    onnotice: () => {},
  });
  cached = drizzle(client, { schema });
  return cached;
}

export type DB = ReturnType<typeof db>;
