/**
 * Rate limiters + abuse-prevention middleware.
 *
 * Why:
 *   - /api/public/quote/:slug and /api/public/lead/:slug call Anthropic
 *     per request. A loop attacker can rack up $100+/hr in AI bills.
 *   - /api/public/autocomplete/locations is an unmetered Google/Mapbox
 *     proxy — same problem, different vendor.
 *   - /api/auth/magic-link/send can be used to email-bomb users.
 *   - /api/auth/signup can be spammed to seed thousands of orphan tenants.
 *
 * Strategy: in-memory token-bucket via `express-rate-limit`. Single-
 * instance Reserved VM means in-memory works. For multi-instance, swap
 * to a Redis store later.
 *
 * IP source: we trust X-Forwarded-For via `app.set('trust proxy', 1)`
 * in app.ts, so `req.ip` is the real client IP behind Cloudflare.
 */
import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';

const minutes = (n: number) => n * 60 * 1000;

/** /api/public/quote/:slug — costly per-call (calls Anthropic and DB).
 *  30 / IP / minute is generous for a real customer typing quotes,
 *  brutal for a bot loop. */
export const publicCalcLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: minutes(1),
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests. Slow down and try again in a minute.' },
});

/** /api/public/lead/:slug — submitting a lead triggers an Anthropic
 *  auto-reply call AND an SMTP send to the tenant's notification email.
 *  Real users submit one or two leads, never 30/min. Tighter cap to
 *  prevent inbox-flood + Anthropic spend. */
export const publicLeadLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: minutes(1),
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many lead submissions. Please wait a minute.' },
});

/** /api/public/chat/:refId — also per-call AI cost. Tighter cap because
 *  a real conversation has natural pauses. */
export const publicChatLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: minutes(1),
  limit: 12,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many chat messages. Pause for a minute.' },
});

/** Hosted quote-doc reads + view/activity beacons (`/api/public/quote-doc/:refId`,
 *  `/api/public/quote-email-preview/:refId`, `/api/public/quote-activity/:refId`).
 *  These are cheap DB reads / audit inserts with NO AI cost, so they must NOT
 *  share the tight chat limiter — a transient chat 429 was blanking the entire
 *  rendered quote. Generous cap that still stops a scrape loop. */
export const publicDocLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: minutes(1),
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests. Slow down and try again in a minute.' },
});

/** /api/public/quote-map/:refId.png — public route-snapshot proxy. It's
 *  refId-gated (only serves maps for a REAL lead's stored coords — no arbitrary
 *  coordinate input), the PNG is persisted in route_map_cache so a hit never
 *  re-bills Google, and the browser caches it for a week. A quote page loads it
 *  once (plus any email/widget render), so a generous cap still stops a scrape
 *  loop from hammering the Static Maps API on cold (uncached) lanes. */
export const quoteMapLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: minutes(1),
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many map requests. Slow down and try again in a minute.' },
});

/** /api/public/autocomplete/* — cheap per call but Google/Mapbox bills.
 *  120/min/IP is plenty for type-ahead with debounce. */
export const publicAutocompleteLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: minutes(1),
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many autocomplete requests. Slow down.' },
});

/** /api/tenant/quote-doc/send/:refId — authed owner action that sends the
 *  carrier-branded quote email to the lead's stored customer address. Real use
 *  is a click or two per lead, so a tight per-tenant+refId cap plus the
 *  in-handler resend cooldown stops a double-click / hammer loop from spamming
 *  the customer's inbox or the mail provider. Keyed by tenant+refId (falls back
 *  to IP) so one noisy quote can't exhaust another's budget. */
export const quoteEmailSendLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: minutes(15),
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => {
    const tenantId = req.tenant?.id;
    const refId = typeof req.params?.refId === 'string' ? req.params.refId : '';
    return tenantId ? `qdoc-send:${tenantId}:${refId}` : `qdoc-send-ip:${req.ip}`;
  },
  message: { error: 'Too many send attempts for this quote. Try again in a few minutes.' },
});

/** /api/auth/magic-link/send — anti-email-bomb. */
export const magicLinkLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: minutes(60),
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Limit per email address, not per IP — attacker rotating IPs still
  // can't email-bomb a single inbox. Falls back to IP if no body.
  keyGenerator: (req) => {
    const email = (req.body && typeof req.body.email === 'string')
      ? req.body.email.trim().toLowerCase()
      : '';
    return email ? `magic:${email}` : `magic-ip:${req.ip}`;
  },
  message: { error: 'Too many sign-in link requests. Try again in an hour.' },
});

/** /api/auth/signup — anti-orphan-tenant-spam. */
export const signupLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: minutes(60),
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many signups from this IP. Try again in an hour.' },
});

/** /api/auth/login — anti-credential-stuffing. */
export const loginLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: minutes(15),
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
});
