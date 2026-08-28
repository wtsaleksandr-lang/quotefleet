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
import type { Request } from 'express';
import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';

const minutes = (n: number) => n * 60 * 1000;

/** Read a positive integer from the environment, else fall back. Lets ops
 *  tune the AI caps without a code change (e.g. AI_TENANT_DAILY_LIMIT=400). */
const envInt = (name: string, fallback: number): number => {
  const raw = process.env[name];
  const n = raw != null ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

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

/** /demo/:token prospect-preview API (widget config / quote / lead / route-preview).
 *  Token-gated (unguessable slug) and DB-write-free, but the quote path still
 *  geocodes + the route-preview proxies Google Static Maps, so a generous cap
 *  stops a scrape loop while never getting in a real prospect's way. Applied
 *  in-handler ONLY once a request is confirmed to target a demo, so it never
 *  double-counts requests that fall through to the tenant endpoints. */
export const publicDemoLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: minutes(1),
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests. Slow down and try again in a minute.' },
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

/**
 * The public directory's `?q=` free-text carrier-name search — the single most
 * expensive thing an anonymous caller can ask this app to do.
 *
 * `q` compiles to `legal_name ILIKE '%term%' OR dba_name ILIKE '%term%'` (see
 * nameSearchCondition). A LEADING wildcard can never use a b-tree, and there is
 * no trigram index, so EVERY `?q=` is a parallel seq scan of all ~330k rows —
 * prod EXPLAIN puts one such scan at cost ~15,325. Worse, `q` is not excluded
 * from any facet dimension, so a single `/directory?q=xx` fans out to roughly
 * ELEVEN of those scans (the list, its count, and ~9 facet counts), and because
 * facetCacheKey includes `q`, every distinct term is a guaranteed cold miss that
 * also evicts a legitimate entry from the 200-entry facet cache.
 *
 * A single request is already bounded — 8s pool-wide statement_timeout, the
 * 8s REQUEST_AGG_BUDGET_MS transaction budget, the 2-slot aggregate semaphore
 * with a bounded queue wait (0068), and NAME_SEARCH_MIN/MAX on the term itself.
 * What was NOT bounded is VOLUME: publicAutocompleteLimiter let one IP drive 120
 * of them a minute. This limiter caps the search path specifically, an order of
 * magnitude tighter, while leaving ordinary facet browsing on the 120/min lane.
 *
 * `skip` means it only ever engages on requests that actually carry a `q`, so a
 * human clicking through cities is completely unaffected by it.
 */
export const directorySearchLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: minutes(1),
  limit: envInt('DIRECTORY_SEARCH_BURST_LIMIT', 12),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req: Request) => {
    const q = (req.query as Record<string, unknown> | undefined)?.q;
    return !(typeof q === 'string' && q.trim() !== '');
  },
  message: { error: 'Too many directory searches. Slow down and try again in a minute.' },
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

/** POST /api/inbound/rate-email — the mail provider posts one forwarded rate
 *  email per real forward, so a modest cap stops a misconfigured provider loop
 *  or a spammer who guessed the shared secret from hammering the AI parser.
 *  Keyed by the recipient token when present (so one busy tenant can't starve
 *  another) and falls back to the caller IP. */
export const inboundEmailLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: minutes(15),
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => {
    const body = (req.body ?? {}) as { to?: unknown };
    const to = typeof body.to === 'string' ? body.to : Array.isArray(body.to) ? body.to.join(',') : '';
    const m = to.match(/rates-([0-9a-z]+)@/i);
    return m ? `inbound:${m[1].toLowerCase()}` : `inbound-ip:${req.ip}`;
  },
  message: { error: 'Too many inbound emails. Try again shortly.' },
});

/** Per-tenant AI limiters — platform-cost protection (audit H3).
 *
 *  The AI rate-chat (`POST /api/ai/rate-chat`) and rate-sheet ingest
 *  (`POST /api/tenant/ingest`) endpoints call Anthropic on each request —
 *  ingest runs a Sonnet VISION pass over an uploaded document — and BOTH fall
 *  back to the shared platform ANTHROPIC_API_KEY when the tenant hasn't set
 *  their own (see ai/client.ts + ai/ingestFile.ts). With no cap, a single
 *  tenant looping uploads/chat runs the platform AI bill up unbounded.
 *
 *  So we gate both routes with TWO limiters keyed by TENANT id (not IP — a
 *  tenant behind one office IP must still get their full quota, and a tenant
 *  can't dodge the cap by rotating IPs): a short-window BURST cap that stops a
 *  tight loop, and a rolling DAILY cap that bounds total daily platform spend.
 *
 *  BYO-key exemption: a tenant that configured its OWN Anthropic key spends its
 *  own budget, not the platform's — so both limiters `skip` those tenants
 *  entirely (effectively unlimited). This is the incentive to bring a key.
 *
 *  Caps are env-overridable so ops can tune them without a deploy. Defaults are
 *  sized for a real freight-SaaS admin: a human adjusting rates or importing a
 *  sheet does a handful of AI actions in a sitting, nowhere near 10/min or
 *  200/day; a runaway loop hits them fast. */
const AI_BURST_LIMIT = envInt('AI_TENANT_BURST_LIMIT', 10); // per minute / tenant
const AI_DAILY_LIMIT = envInt('AI_TENANT_DAILY_LIMIT', 200); // per 24h / tenant

/** Shown on a 429 from either AI limiter — graceful, never a 500, and it points
 *  the tenant at the BYO-key path for a higher ceiling. */
const AI_LIMIT_MESSAGE = {
  error:
    "You've hit the AI usage limit for now — try again in a bit, or add your own API key in Settings for higher limits.",
};

/** A tenant with its own configured Anthropic key isn't spending platform
 *  budget, so the platform-cost caps don't apply to it. */
function tenantHasByoKey(req: Request): boolean {
  return !!req.tenant?.anthropicKeyEncrypted;
}

/** Key AI limits by tenant id (falls back to IP for the — unreachable behind
 *  requireTenant — case where no tenant is resolved). */
const aiTenantKey = (prefix: string) => (req: Request): string =>
  req.tenant?.id != null ? `${prefix}:${req.tenant.id}` : `${prefix}-ip:${req.ip}`;

export const aiTenantBurstLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: minutes(1),
  limit: AI_BURST_LIMIT,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: aiTenantKey('ai-burst'),
  skip: tenantHasByoKey,
  message: AI_LIMIT_MESSAGE,
});

export const aiTenantDailyLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: minutes(60 * 24),
  limit: AI_DAILY_LIMIT,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: aiTenantKey('ai-daily'),
  skip: tenantHasByoKey,
  message: AI_LIMIT_MESSAGE,
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

/** /api/auth/password/forgot — anti-email-bomb on the reset-link request.
 *  Same posture as magicLinkLimiter: keyed per EMAIL (not IP) so an attacker
 *  rotating IPs still can't flood one inbox with reset emails; falls back to IP
 *  when no email is present. 5 / hour is generous for a real forgetful user. */
export const passwordResetRequestLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: minutes(60),
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = (req.body && typeof req.body.email === 'string')
      ? req.body.email.trim().toLowerCase()
      : '';
    return email ? `pwreset:${email}` : `pwreset-ip:${req.ip}`;
  },
  message: { error: 'Too many password-reset requests. Try again in an hour.' },
});

/** /api/auth/password/forgot — per-IP companion to the per-email limiter above.
 *  The per-email cap alone lets a single host probe UNLIMITED distinct emails
 *  (enumeration + reset-spam) because each address has its own bucket. This caps
 *  total reset requests from ONE IP regardless of which addresses it targets.
 *  Keyed by the real client IP (default `req.ip` behind trust-proxy, same as the
 *  login/verify limiters). Stacked alongside passwordResetRequestLimiter. */
export const passwordResetIpLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: minutes(60),
  limit: 25,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many password-reset requests. Try again in an hour.' },
});

/** POST /api/auth/password/reset — the token-verify + set-new-password step.
 *  Per-IP cap that stops a bot brute-forcing reset tokens (the token is 48-char
 *  nanoid ~285 bits so it's already infeasible, but a hard cap makes it
 *  moot). Same shape as loginLimiter. */
export const passwordResetVerifyLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: minutes(15),
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in 15 minutes.' },
});

/** /api/auth/signup — anti-orphan-tenant-spam. */
export const signupLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: minutes(60),
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many signups from this IP. Try again in an hour.' },
});

/** POST /directory/rfq — a shipper sending a multi-carrier rate request fans out
 *  up to RFQ_MAX_RECIPIENTS carrier emails, so it must be abuse-capped on TWO
 *  axes: per IP (stop a bot loop) and per shipper email (stop one address from
 *  blasting request after request). Real shippers send a handful of requests, so
 *  these caps never touch legitimate use. Applied as an array on the route. */
export const rfqSubmitIpLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: minutes(15),
  limit: 8,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many rate requests from this network. Try again in a few minutes.' },
});

export const rfqSubmitEmailLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: minutes(60),
  limit: 12,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Key by the shipper's email so an attacker rotating IPs still can't spam
  // requests under one identity. Falls back to IP when no email is present.
  keyGenerator: (req) => {
    const email =
      req.body && typeof req.body.shipper_email === 'string' ? req.body.shipper_email.trim().toLowerCase() : '';
    return email ? `rfq:${email}` : `rfq-ip:${req.ip}`;
  },
  message: { error: 'Too many rate requests for this email. Please wait a bit.' },
});

/** POST /directory/rfq/quote/:token — a carrier submitting/updating a quote. One
 *  token = one carrier; a tight cap stops a hammer/replay loop on a leaked link
 *  while allowing a few edits. Keyed by the quote token (falls back to IP). */
export const rfqQuoteLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: minutes(10),
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => {
    const token = typeof req.params?.token === 'string' ? req.params.token : '';
    return token ? `rfq-quote:${token}` : `rfq-quote-ip:${req.ip}`;
  },
  message: { error: 'Too many submissions. Slow down and try again shortly.' },
});

/** POST /api/directory/carrier/:usdot/reveal — a FRESH reveal costs 1 AI call +
 *  up to 3 HTTP fetches, so this coarse per-IP burst cap stops a hammer loop
 *  from one network before the per-user DAILY meter (the real cost lever) even
 *  runs. Real Pro use is a click or two per carrier page. Keyed by IP; the
 *  limit is env-tunable (DIRECTORY_REVEAL_BURST_LIMIT). */
export const directoryRevealLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: minutes(1),
  limit: envInt('DIRECTORY_REVEAL_BURST_LIMIT', 20),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many reveal requests. Slow down and try again in a minute.' },
});

/** POST /api/importers/search — each search costs ONE ImportYeti pull (~1
 *  credit / ~10 records). This coarse per-IP burst cap stops a hammer loop from
 *  draining credits; real browse use is a handful of searches. Keyed by IP;
 *  limit is env-tunable (IMPORTER_SEARCH_BURST_LIMIT). */
export const importerSearchLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: minutes(1),
  limit: envInt('IMPORTER_SEARCH_BURST_LIMIT', 15),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'rate_limited',
    message: 'Too many searches. Slow down and try again in a minute.',
  },
});

/** /api/auth/login — anti-credential-stuffing. */
export const loginLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: minutes(15),
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
});
