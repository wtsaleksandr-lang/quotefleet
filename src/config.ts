/**
 * Centralised env access. Tiny zod-style guard with friendly error
 * messages — we read process.env once at boot and crash early if
 * required keys are missing.
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';

export interface Env {
  DATABASE_URL: string;
  ANTHROPIC_API_KEY: string;
  PUBLIC_BASE_URL: string;
  SESSION_SECRET: string;
  PORT: number;
  HOST: string;
  SUPER_ADMIN_EMAIL?: string;
  MAPBOX_TOKEN?: string;
  EIA_API_KEY?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: number;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  SMTP_FROM?: string;
}

let cached: Env | null = null;

function need(key: string): string {
  const v = process.env[key];
  if (!v || v.trim() === '' || v.startsWith('replace-with-')) {
    throw new Error(
      `Missing required env var ${key}. See .env.example. ` +
        `On Replit, add it under Secrets.`
    );
  }
  return v.trim();
}

function opt(key: string): string | undefined {
  const v = process.env[key];
  if (!v || v.trim() === '') return undefined;
  return v.trim();
}

export function loadEnv(): Env {
  if (cached) return cached;

  // SESSION_SECRET — auto-generate if not set, but warn loudly. Stable
  // across restarts only if you actually set it.
  let sessionSecret = opt('SESSION_SECRET');
  if (!sessionSecret) {
    sessionSecret = randomBytes(32).toString('hex');
    console.warn(
      '[config] SESSION_SECRET not set — generated a random one. ' +
        'Sessions will be invalidated on restart. Set SESSION_SECRET in env for stable sessions.'
    );
  }

  cached = {
    DATABASE_URL: need('DATABASE_URL'),
    ANTHROPIC_API_KEY: need('ANTHROPIC_API_KEY'),
    PUBLIC_BASE_URL: opt('PUBLIC_BASE_URL') ?? 'http://localhost:5000',
    SESSION_SECRET: sessionSecret,
    PORT: Number(opt('PORT') ?? 5000),
    HOST: opt('HOST') ?? '0.0.0.0',
    SUPER_ADMIN_EMAIL: opt('SUPER_ADMIN_EMAIL'),
    MAPBOX_TOKEN: opt('MAPBOX_TOKEN'),
    EIA_API_KEY: opt('EIA_API_KEY'),
    SMTP_HOST: opt('SMTP_HOST'),
    SMTP_PORT: opt('SMTP_PORT') ? Number(opt('SMTP_PORT')) : undefined,
    SMTP_USER: opt('SMTP_USER'),
    SMTP_PASS: opt('SMTP_PASS'),
    SMTP_FROM: opt('SMTP_FROM'),
  };
  return cached;
}
