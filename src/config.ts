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
  /** Comma-separated list of platform-owned host domains. The first
   *  entry is the default for new signups. e.g.
   *  "quotefleet.net,truckrate.online,your-quote.online"
   *  — wildcard DNS for each routes `<slug>.<domain>` here. */
  HOST_DOMAINS: string[];
  /** Shared secret between the Cloudflare Worker that fronts wildcard
   *  subdomains and this app. The Worker sets `X-Worker-Auth: <secret>`;
   *  hostInfo middleware refuses to trust `X-Original-Host` unless it
   *  matches. If unset, we fall back to trusting the header (legacy
   *  behavior) but log a warning — production deployments MUST set this. */
  WORKER_AUTH_SECRET?: string;
  /** Soft global daily spend cap on the platform Anthropic key, in USD.
   *  When usage telemetry exceeds this, marketing chat + AI endpoints
   *  short-circuit with a 503 instead of running another API call.
   *  Per-tenant caps live on `tenants.aiDailyUsdCap`. */
  AI_DAILY_USD_CAP?: number;
  /** If set, errors are reported here. Off by default to keep the dev
   *  loop cheap. */
  SENTRY_DSN?: string;
  SUPER_ADMIN_EMAIL?: string;
  GOOGLE_MAPS_API_KEY?: string;
  MAPBOX_TOKEN?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_PUBLISHABLE_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_VITAL_MONTHLY?: string;
  STRIPE_PRICE_PRO_MONTHLY?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  EIA_API_KEY?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: number;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  SMTP_FROM?: string;
  /** Domain the per-tenant inbound rate-email addresses live under, e.g.
   *  "rates.quotefleet.net". Each tenant gets `rates-<token>@<this>`. When
   *  unset the dashboard shows a placeholder + the feature stays non-live
   *  (the address is shown greyed with a "not configured yet" note). */
  INBOUND_EMAIL_DOMAIN?: string;
  /** Shared secret the mail provider (SendGrid Inbound Parse / Mailgun Route /
   *  etc.) must send as `X-Inbound-Secret` when it POSTs a forwarded rate
   *  email to /api/inbound/rate-email. Unset → the inbound endpoint refuses
   *  every request (503), so email-import never accepts mail until configured. */
  INBOUND_WEBHOOK_SECRET?: string;
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

  // SESSION_SECRET — required in production. Auto-generates only in
  // development so a fresh checkout works; if the env says NODE_ENV is
  // production we hard-fail. (Auto-generation in prod silently logs out
  // every user on each restart and is hard to detect.)
  let sessionSecret = opt('SESSION_SECRET');
  if (!sessionSecret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'SESSION_SECRET is required in production. Generate one with ' +
          '`openssl rand -hex 32` and add it to Replit Secrets, then redeploy.'
      );
    }
    sessionSecret = randomBytes(32).toString('hex');
    console.warn(
      '[config] SESSION_SECRET not set — generated a random one. ' +
        'Sessions will be invalidated on restart. Set SESSION_SECRET in env for stable sessions.'
    );
  }

  // Loud guard: BYPASS_TRIAL_ENFORCEMENT disables ALL trial/plan gating
  // (see server/middleware.ts). Harmless in dev/test, catastrophic in prod
  // where it would hand out free unlimited access. Warn — don't change the
  // flag's behavior.
  if (
    process.env.NODE_ENV === 'production' &&
    (process.env.BYPASS_TRIAL_ENFORCEMENT === '1' ||
      process.env.BYPASS_TRIAL_ENFORCEMENT === 'true')
  ) {
    console.warn(
      '[SECURITY] BYPASS_TRIAL_ENFORCEMENT is ON in production — all trial/plan gating is disabled'
    );
  }

  const hostDomainsRaw = opt('HOST_DOMAINS') ?? 'quotefleet.net';
  const hostDomains = hostDomainsRaw
    .split(',')
    .map((s) => s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
    .filter(Boolean);
  if (hostDomains.length === 0) hostDomains.push('quotefleet.net');

  cached = {
    DATABASE_URL: need('DATABASE_URL'),
    ANTHROPIC_API_KEY: opt('ANTHROPIC_API_KEY') ?? '',
    PUBLIC_BASE_URL: opt('PUBLIC_BASE_URL') ?? 'http://localhost:5000',
    SESSION_SECRET: sessionSecret,
    PORT: Number(opt('PORT') ?? 5000),
    HOST: opt('HOST') ?? '0.0.0.0',
    HOST_DOMAINS: hostDomains,
    WORKER_AUTH_SECRET: opt('WORKER_AUTH_SECRET'),
    AI_DAILY_USD_CAP: opt('AI_DAILY_USD_CAP') ? Number(opt('AI_DAILY_USD_CAP')) : undefined,
    SENTRY_DSN: opt('SENTRY_DSN'),
    SUPER_ADMIN_EMAIL: opt('SUPER_ADMIN_EMAIL'),
    GOOGLE_MAPS_API_KEY: opt('GOOGLE_MAPS_API_KEY'),
    MAPBOX_TOKEN: opt('MAPBOX_TOKEN'),
    STRIPE_SECRET_KEY: opt('STRIPE_SECRET_KEY'),
    STRIPE_PUBLISHABLE_KEY: opt('STRIPE_PUBLISHABLE_KEY'),
    STRIPE_WEBHOOK_SECRET: opt('STRIPE_WEBHOOK_SECRET'),
    STRIPE_PRICE_VITAL_MONTHLY: opt('STRIPE_PRICE_VITAL_MONTHLY'),
    STRIPE_PRICE_PRO_MONTHLY: opt('STRIPE_PRICE_PRO_MONTHLY'),
    RESEND_API_KEY: opt('RESEND_API_KEY'),
    RESEND_FROM_EMAIL: opt('RESEND_FROM_EMAIL'),
    EIA_API_KEY: opt('EIA_API_KEY'),
    SMTP_HOST: opt('SMTP_HOST'),
    SMTP_PORT: opt('SMTP_PORT') ? Number(opt('SMTP_PORT')) : undefined,
    SMTP_USER: opt('SMTP_USER'),
    SMTP_PASS: opt('SMTP_PASS'),
    SMTP_FROM: opt('SMTP_FROM'),
    INBOUND_EMAIL_DOMAIN: opt('INBOUND_EMAIL_DOMAIN'),
    INBOUND_WEBHOOK_SECRET: opt('INBOUND_WEBHOOK_SECRET'),
  };
  return cached;
}

/** Default host domain for new signups (first entry of HOST_DOMAINS). */
export function defaultHostDomain(): string {
  return loadEnv().HOST_DOMAINS[0] ?? 'quotefleet.net';
}

/** True if the given host (e.g. "astova.quotefleet.net") is on a
 *  platform-owned domain. Returns the matching base domain if so. */
export function matchHostDomain(host: string): string | null {
  const h = (host || '').toLowerCase().split(':')[0]; // strip port
  if (!h) return null;
  for (const base of loadEnv().HOST_DOMAINS) {
    if (h === base || h.endsWith('.' + base)) return base;
  }
  return null;
}
