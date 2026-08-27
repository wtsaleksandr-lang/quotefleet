/**
 * QuoteFleet — multi-tenant SaaS schema.
 *
 * Each tenant is one drayage / trucking company. They configure their own
 * rates, accessorials, AI prompt, and brand. End-customers (the people
 * who fill out the calculator on the tenant's website) become "leads".
 *
 * Hierarchy:
 *   tenants
 *     ├── users (login accounts; many per tenant)
 *     ├── rate_cards (one per equipment_type per tenant)
 *     ├── accessorials (configurable extras)
 *     ├── ai_config (one per tenant — system prompt, model, persona)
 *     ├── brand_config (logo, colors, company name)
 *     ├── leads (incoming quote requests from end-customers)
 *     │     └── conversations (AI chat with the lead)
 *     ├── distance_cache (origin→dest miles, shared across tenants)
 *     └── audit_log (for AI agent's actions on rates)
 */
import {
  pgTable,
  serial,
  text,
  integer,
  doublePrecision,
  boolean,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import type { LtlConfig } from '../calc/freightClass.js';
// Type-only imports (erased at runtime — no module cycle) so the precomputed
// directory_aggregate_cache JSONB columns stay in lock-step with the shapes the
// query layer computes. See directoryAggregateCache below.
import type { DirectorySummary as DirectorySummaryJson, FacetCounts as FacetCountsJson } from '../server/directory/queries.js';

// ────────────────────────────────────────────────────────────────────
// TENANTS — one per customer company.
// ────────────────────────────────────────────────────────────────────
export const tenants = pgTable(
  'tenants',
  {
    id: serial('id').primaryKey(),
    /** URL-safe slug — also the subdomain. e.g. "astova" → astova.quotefleet.net. */
    slug: text('slug').notNull().unique(),
    /** Which of the platform-owned host domains hosts this tenant.
     *  e.g. "quotefleet.net", "truckrate.net", "drayrate.online".
     *  The full hosted URL is `<slug>.<hostDomain>`. */
    hostDomain: text('host_domain').notNull().default('quotefleet.net'),
    /** Optional custom domain (Pro tier). e.g. "quote.astova.com" mapped via CNAME. */
    customDomain: text('custom_domain').unique(),
    /** When the operator's TXT-based ownership proof for `customDomain`
     *  was confirmed. Until this is non-null, hostInfo middleware refuses
     *  to route the domain — prevents an unverified claim from going live. */
    customDomainVerifiedAt: timestamp('custom_domain_verified_at', { mode: 'date' }),
    /** Public company name shown in the calculator. */
    name: text('name').notNull(),
    /** PRIVATE owner/login email — seeded from the signup login email and used
     *  ONLY for internal notifications (quote alerts, lifecycle, Stripe customer
     *  email). NEVER render this on any public/customer-facing surface: doing so
     *  leaks the operator's login address. Use `publicContactEmail` for that. */
    contactEmail: text('contact_email').notNull(),
    /** OPT-IN public contact email shown to customers on the calculator widget +
     *  hosted quotes. Nullable and NOT seeded at signup — the carrier sets it
     *  explicitly in Account → Company details. When null, the email row is
     *  omitted from public surfaces (we never fall back to `contactEmail`). */
    publicContactEmail: text('public_contact_email'),
    /** Optional per-tenant quote disclaimer / terms shown at the BOTTOM of
     *  every quote (widget result, hosted quote page, printable/PDF). Nullable:
     *  null or blank → the platform DEFAULT_QUOTE_DISCLAIMER is rendered (see
     *  src/server/quoteDisclaimer.ts); non-empty → the carrier's own text. The
     *  carrier edits it in Account → Company details. */
    quoteDisclaimer: text('quote_disclaimer'),
    /** Phone number (optional). */
    contactPhone: text('contact_phone'),
    /** Country focus — 'US', 'CA', or 'BOTH'. Drives rate defaults. */
    countryFocus: text('country_focus').notNull().default('US'),
    /** Random unguessable token used in <script src="...embed.js?t=..."> */
    embedToken: text('embed_token').notNull().unique(),
    /** Short, shareable REFERRAL code minted on tenant creation (see
     *  src/server/affiliate/codes.ts). Every tenant's referral link is
     *  `https://quotefleet.net/?ref=<referralCode>`; a peer who signs up through
     *  it gets the referee reward (30-day trial + intro discount) and this tenant
     *  is queued a "1 free month" account credit (referral_credits). Distinct from
     *  embedToken (public widget loader) and ingestEmailToken (inbound email
     *  secret) — this one is meant to be shared. Nullable + minted lazily so
     *  existing rows read null until backfilled/self-healed; unique so a code
     *  resolves to exactly one tenant. */
    referralCode: text('referral_code').unique(),
    /** Secret token for the tenant's dedicated inbound rate-email address
     *  (`rates-<token>@<INBOUND_EMAIL_DOMAIN>`). DISTINCT from embedToken —
     *  embedToken is public (it ships in the widget <script> src), so it must
     *  never be reused as the inbound address secret. Nullable + minted lazily
     *  the first time a tenant turns the email-import feature ON; null until
     *  then. Kept unguessable so randoms can't spam a tenant's importer. */
    ingestEmailToken: text('ingest_email_token').unique(),
    /** Trusted sender allowlist for the inbound rate-email importer. An
     *  email-imported rate sheet may only AUTO-APPLY to live pricing when its
     *  normalized `from` address is on this list (in addition to the opt-in
     *  feature flag + high-confidence/auto-check gates). An import from an
     *  unrecognized sender is HELD for human review instead — approving it adds
     *  the sender here, so subsequent imports from that now-known sender can
     *  auto-apply ("hold the first, trust after approval"). Normalized lowercase
     *  addresses. NOT NULL DEFAULT '[]' — existing tenants start empty, so their
     *  next inbound import is safely held rather than silently applied. */
    ingestTrustedSendersJson: jsonb('ingest_trusted_senders_json')
      .$type<string[]>()
      .notNull()
      .default([]),
    /** Billed/selected tier: 'free' | 'vital' | 'pro'. Feature access is
     *  computed from this via src/server/plans.ts (a trialing tenant gets
     *  Pro regardless). Legacy 'starter'/'enterprise' rows normalize to
     *  Vital/Pro in code. */
    plan: text('plan').notNull().default('free'),
    /** Whether the tenant is active or suspended. */
    status: text('status').notNull().default('active'),
    /** Calculator access mode: 'public' (anyone with the link can get a
     *  quote — the original behavior) or 'private' (invite-only; only
     *  visitors holding a valid access_links token / signed access cookie
     *  can reach the calculator or its rate/quote APIs). DEFAULT 'public'
     *  keeps every existing tenant unchanged. Enforced in src/server/access.ts. */
    accessMode: text('access_mode').notNull().default('public'),
    /** Fuel-surcharge mode: 'manual' (default — each rate card's fixed
     *  fuel_surcharge_pct is used, original behavior) or 'auto' (surcharge
     *  is derived weekly from the EIA national diesel price via the standard
     *  DOE-index formula). Opt-in; existing tenants stay on 'manual'. */
    fscMode: text('fsc_mode').notNull().default('manual'),
    /** Trial end timestamp. Null = not on trial (paid or grandfathered). */
    trialEndsAt: timestamp('trial_ends_at', { mode: 'date' }),
    /** Marketplace exposure: carrier opts in to having their PUBLIC rate
     *  profile (carrier name, locations, equipment, current rates) visible
     *  to shippers/forwarders browsing the rates dashboard. Default OFF.
     *  Anonymized benchmarks include all tenants regardless. */
    marketplaceOptIn: boolean('marketplace_opt_in').notNull().default(false),
    /** Optional MC# / DOT# — surfaced on the public marketplace profile. */
    mcNumber: text('mc_number'),
    dotNumber: text('dot_number'),
    /** Stripe Customer ID — set on first checkout. */
    stripeCustomerId: text('stripe_customer_id').unique(),
    /** Active Stripe Subscription ID; null when on trial or cancelled. */
    stripeSubscriptionId: text('stripe_subscription_id'),
    /** When the current subscription period ends (mirrored from Stripe). */
    subscriptionEndsAt: timestamp('subscription_ends_at', { mode: 'date' }),
    /** Stripe Connect (Express) connected-account id for this carrier — set
     *  the first time the owner starts payout onboarding via
     *  POST /api/tenant/connect/onboard. Null until then; every existing
     *  tenant reads null (additive, no backfill). This is the account that
     *  will later collect deposits from shippers with QuoteFleet as the
     *  platform taking a fee. Money movement is a LATER PR — this column
     *  only records the onboarding link. */
    stripeConnectAccountId: text('stripe_connect_account_id').unique(),
    /** Cached Connect readiness flags, refreshed from Stripe on every
     *  /connect/status read and by the account.updated webhook. The live
     *  Stripe account is authoritative; these are a convenience cache so the
     *  UI can render "ready to accept deposits" without a round-trip. Null
     *  until the account exists / first status read. */
    connectDetailsSubmitted: boolean('connect_details_submitted'),
    connectChargesEnabled: boolean('connect_charges_enabled'),
    connectPayoutsEnabled: boolean('connect_payouts_enabled'),
    /** Tracks one-shot lifecycle emails so the cron doesn't re-send.
     *  Keys: 'welcome', 'day_7', 'trialReminderDay11SentAt',
     *  'trialReminderDay14SentAt', 'day_14_expired', etc.
     *  Values: ISO timestamp of when sent. */
    lifecycleEmailsJson: jsonb('lifecycle_emails_json').$type<Record<string, string>>(),
    /** When the last WEEKLY performance digest was sent to this tenant. The
     *  weekly-digest cron (src/email/weeklyDigestCron.ts) skips any tenant sent
     *  within the last 6 days — the double-send guard across ticks/restarts.
     *  Null = never sent. Additive, no backfill (existing tenants read null and
     *  simply become eligible on the next Monday tick). */
    lastWeeklyDigestAt: timestamp('last_weekly_digest_at', { mode: 'date' }),
    /** Marketing/lifecycle email opt-out (CAN-SPAM / CASL). Set true when a
     *  tenant clicks the tokenized unsubscribe link (GET/POST /unsubscribe).
     *  The lifecycle cron SKIPS any tenant with this true. Transactional email
     *  (sign-in links, lead/callback/booking alerts) ignores this flag and
     *  always sends. Default false; existing tenants read false. */
    marketingOptOut: boolean('marketing_opt_out').notNull().default(false),
    /** Post-signup guided-onboarding record. Null until the trucker finishes
     *  (or skips) the wizard. `needsOnboarding` on /api/auth/me is derived as
     *  (completedAt == null && !skipped) — a server flag, so the wizard survives
     *  a billing/Stripe redirect (localStorage would not). `freightVertical` +
     *  `pricingMode` also feed the AI context. Additive, no signup backfill —
     *  existing tenants read null and simply never see the wizard. */
    onboardingJson: jsonb('onboarding_json').$type<{
      completedAt: string | null;
      skipped: boolean;
      /** Primary vertical. Kept for back-compat with rows written before
       *  multi-mode onboarding; new writes also set `freightVerticals`. */
      freightVertical?: string;
      /** Every mode the carrier runs — dry van + reefer + flatbed is an
       *  ordinary combination, not an edge case. Seeding only one left the
       *  calculator unable to quote most of their business. */
      freightVerticals?: string[];
      pricingMode?: string;
      /** Superseded by `serviceArea`. Retained so existing rows still read. */
      mainLane?: { from: string | null; to: string | null };
      /** Where the carrier actually operates. Carriers describe coverage as
       *  regions / states / provinces / nationwide — not one lane. Stored and
       *  used for AI context, quote examples and the carrier profile; NOT
       *  enforced against incoming quotes (enforcing would reject real
       *  business whenever a carrier under-declares their coverage). */
      serviceArea?: {
        kind: 'nationwide_us' | 'nationwide_ca' | 'cross_border' | 'regions' | 'radius';
        /** State/province codes, e.g. ['CA','AZ','NV','ON'] — kind 'regions'. */
        regions?: string[];
        /** kind 'radius' — e.g. 300 mi around 'Long Beach, CA'. */
        radiusMiles?: number;
        baseCity?: string | null;
      };
      /** Quoting rules answered in the wizard, recorded for provenance/AI
       *  context. The AUTHORITATIVE values live in the tenant columns
       *  (`fscMode`, `accessMode`) — this is a record of what was chosen
       *  during onboarding, not a second source of truth. */
      fscMode?: 'manual' | 'auto';
      /** The fixed percentage chosen with fscMode 'manual'. There is no
       *  tenant-level FSC column — manual mode reads each rate card's
       *  `fuelSurchargePct`, which onboarding writes across the board — so
       *  this is the only record of the single number they typed. */
      fscPercent?: number;
      accessMode?: 'public' | 'private';
    }>(),
    /** Optional per-tenant Anthropic API key (encrypted). When set,
     *  overrides the platform default for that tenant's AI calls. */
    anthropicKeyEncrypted: text('anthropic_key_encrypted'),
    /** When (and which version of) the Data Processing Addendum was
     *  accepted by the tenant owner. Required at signup. We force re-
     *  acceptance if `dpaVersion` differs from the current published
     *  version (lets us update the DPA without breaking existing
     *  contracts — they re-accept on next login or before next charge). */
    dpaAcceptedAt: timestamp('dpa_accepted_at', { mode: 'date' }),
    dpaVersion: text('dpa_version'),
    /** Created timestamp. */
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('tenants_slug_idx').on(t.slug),
    uniqueIndex('tenants_slug_host_idx').on(t.slug, t.hostDomain),
    // hostInfo middleware looks up by custom_domain on every request to
    // any host that doesn't match HOST_DOMAINS — needs an index.
    index('tenants_custom_domain_idx').on(t.customDomain),
    // embed.js loader hits this column on every iframe load.
    index('tenants_embed_token_idx').on(t.embedToken),
  ]
);

// ────────────────────────────────────────────────────────────────────
// USERS — login accounts. role: 'super_admin' | 'tenant_owner' | 'tenant_member'
// super_admin has tenantId = null and can access all tenants.
// ────────────────────────────────────────────────────────────────────
export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').references(() => tenants.id, {
      onDelete: 'cascade',
    }),
    email: text('email').notNull(),
    /** bcrypt hash. Always set — OAuth-created users get a random unusable
     *  hash (they sign in via the provider; they can claim a real password
     *  later via the magic-link → change-password flow). */
    passwordHash: text('password_hash').notNull(),
    name: text('name'),
    role: text('role').notNull().default('tenant_owner'),
    /** Stable provider subject IDs for social login (see
     *  src/server/oauth/providers.ts). Nullable + minted the first time a
     *  user signs in with that provider. Matching on the sub (not the email)
     *  keeps repeat logins reliable even if the provider's display email
     *  changes. Postgres allows many NULLs under a UNIQUE index, so
     *  password-only users (all null) never collide. */
    googleSub: text('google_sub'),
    microsoftSub: text('microsoft_sub'),
    metaSub: text('meta_sub'),
    /** Sign in with Apple stable subject id (see src/server/oauth/apple.ts).
     *  Same nullable + unique-index pattern as the other *_sub columns:
     *  minted the first time a user signs in with Apple; password-only users
     *  read null and never collide under the UNIQUE index. */
    appleSub: text('apple_sub'),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
    lastLoginAt: timestamp('last_login_at', { mode: 'date' }),
  },
  (t) => [
    uniqueIndex('users_email_idx').on(t.email),
    index('users_tenant_idx').on(t.tenantId),
    uniqueIndex('users_google_sub_idx').on(t.googleSub),
    uniqueIndex('users_microsoft_sub_idx').on(t.microsoftSub),
    uniqueIndex('users_meta_sub_idx').on(t.metaSub),
    uniqueIndex('users_apple_sub_idx').on(t.appleSub),
  ]
);

// ────────────────────────────────────────────────────────────────────
// SESSIONS — opaque cookie tokens.
// ────────────────────────────────────────────────────────────────────
export const sessions = pgTable(
  'sessions',
  {
    token: text('token').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('sessions_user_idx').on(t.userId),
    index('sessions_expires_idx').on(t.expiresAt),
  ]
);

// ────────────────────────────────────────────────────────────────────
// MAGIC LINKS — single-use email login tokens.
// Created on POST /api/auth/magic-link/send, consumed on
// GET /auth/magic/:token (sets a session cookie + redirects to /app).
// ────────────────────────────────────────────────────────────────────
export const magicLinks = pgTable(
  'magic_links',
  {
    token: text('token').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
    usedAt: timestamp('used_at', { mode: 'date' }),
    /** Optional next-URL to redirect to after consume. */
    redirectTo: text('redirect_to'),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [index('magic_links_user_idx').on(t.userId)]
);

// ────────────────────────────────────────────────────────────────────
// PASSWORD RESET TOKENS — single-use, short-lived "forgot password" links.
//
// Created on POST /api/auth/password/forgot (only when the email maps to a
// real user — the endpoint's HTTP response is identical either way, so it never
// leaks whether an account exists), consumed on POST /api/auth/password/reset
// (validates + sets the new password + revokes every session).
//
// SECURITY: unlike magic_links (which store the raw token), we store ONLY the
// SHA-256 hash of the token — the raw token lives solely in the emailed link,
// so a leak of this table cannot be replayed to reset anyone's password. The
// primary key IS the hash, so a lookup is a hash-then-point-read. `usedAt`
// makes a token single-use; `expiresAt` bounds its lifetime (~45 min).
// ────────────────────────────────────────────────────────────────────
export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    /** SHA-256 hex of the random token. The raw token is never stored. */
    tokenHash: text('token_hash').primaryKey(),
    /** Owning user. No FK constraint by design — this table is healed via
     *  SELF_HEAL_TABLE_STATEMENTS (a bare CREATE TABLE IF NOT EXISTS that can't
     *  retrofit constraints), so schema + DDL stay consistent by both omitting
     *  the FK (same convention as saved_lists / rfq_* / carrier_* healed
     *  tables). References `users` only, never `tenants`. */
    userId: integer('user_id').notNull(),
    expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
    usedAt: timestamp('used_at', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [index('password_reset_tokens_user_idx').on(t.userId)]
);

export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;

// ────────────────────────────────────────────────────────────────────
// ACCESS LINKS — per-customer invite links for a PRIVATE calculator.
//
// When a tenant sets `tenants.access_mode = 'private'`, the calculator
// (`/w/:slug`, the hosted subdomain, and every public rate/quote API)
// is locked. The tenant creates one named link per customer; opening
// `…/?key=<token>` validates the token, drops a signed access cookie,
// and lets that visitor use the calculator. Revoking a link (active =
// false) stops it working immediately. No customer accounts.
//
// Token is a 32-char nanoid (~190 bits) — unguessable, so a leaked
// token is the only exposure and it's individually revocable.
// ────────────────────────────────────────────────────────────────────
export const accessLinks = pgTable(
  'access_links',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Cryptographically-random invite token (nanoid(32)). Unique. */
    token: text('token').notNull().unique(),
    /** Human label — the customer / company this link was issued to. */
    label: text('label').notNull(),
    /** Revocable switch. false = link no longer grants access. */
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
    /** Last time this link was opened (grant issued). */
    lastUsedAt: timestamp('last_used_at', { mode: 'date' }),
    /** How many times the link has been opened. */
    useCount: integer('use_count').notNull().default(0),
  },
  (t) => [
    uniqueIndex('access_links_token_idx').on(t.token),
    index('access_links_tenant_idx').on(t.tenantId),
  ]
);

// ────────────────────────────────────────────────────────────────────
// RATE CARDS — one per equipment_type per tenant.
// "service" is one of: 'drayage' | 'ftl' | 'ltl' | 'expedited' | 'hotshot'
// "equipment" is one of: 'dryvan' | 'reefer' | 'flatbed' | 'step_deck' |
//                       'conestoga' | 'container_20' | 'container_40' |
//                       'container_40hc' | 'container_45' | 'sprinter' |
//                       'box_truck' | 'tractor_only'
// ────────────────────────────────────────────────────────────────────
export const rateCards = pgTable('rate_cards', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  service: text('service').notNull(),
  equipment: text('equipment').notNull(),
  label: text('label'), // human label shown in widget, e.g. "53' Dry Van"
  /** Base $/mile. */
  ratePerMile: doublePrecision('rate_per_mile').notNull().default(0),
  /** Minimum charge (USD). If miles × rate < min, use min. */
  minimumCharge: doublePrecision('minimum_charge').notNull().default(0),
  /** Flat per-load fee added on top of mile-based price. */
  flatFee: doublePrecision('flat_fee').notNull().default(0),
  /** Fuel surcharge as percent of base linehaul. */
  fuelSurchargePct: doublePrecision('fuel_surcharge_pct').notNull().default(0),
  /** Markup % applied AFTER everything else (carrier's profit margin). */
  marginPct: doublePrecision('margin_pct').notNull().default(0),
  /** Optional max weight (lbs) before "overweight" accessorial triggers. */
  maxWeightLbs: doublePrecision('max_weight_lbs'),
  /** Optional max miles — if quote exceeds this, AI flags "out of service area". */
  maxMiles: doublePrecision('max_miles'),
  /**
   * LTL only: class + weight-break rate model. When null, the engine uses
   * DEFAULT_LTL_CONFIG so LTL still prices credibly. Ignored for non-LTL
   * services (which use the per-mile ratePerMile / lane-zone paths).
   */
  ltlConfig: jsonb('ltl_config').$type<LtlConfig>(),
  /** Whether this rate card is currently visible/usable. */
  enabled: boolean('enabled').notNull().default(true),
  /** Display order in the widget. */
  sortOrder: integer('sort_order').notNull().default(0),
  /** Free-form internal notes. */
  notes: text('notes'),
  /** AI agent metadata: when the agent last touched this row + why. */
  lastAiEditAt: timestamp('last_ai_edit_at', { mode: 'date' }),
  lastAiEditReason: text('last_ai_edit_reason'),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
}, (t) => [
  index('rate_cards_tenant_idx').on(t.tenantId),
]);

// ────────────────────────────────────────────────────────────────────
// ACCESSORIALS — extras added on top of base rate.
// kind: 'flat' (USD) | 'per_mile' (USD/mi) | 'pct_of_base' (%)
// trigger: 'optional' (user picks) | 'auto' (always added) |
//          'auto_if_weight_over' | 'auto_if_residential' | etc.
// ────────────────────────────────────────────────────────────────────
export const accessorials = pgTable('accessorials', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  /** Codes like 'fuel', 'chassis', 'prepull', 'liftgate', 'residential', 'hazmat', ...  */
  code: text('code').notNull(),
  label: text('label').notNull(),
  description: text('description'),
  kind: text('kind').notNull().default('flat'),
  amount: doublePrecision('amount').notNull().default(0),
  trigger: text('trigger').notNull().default('optional'),
  /** Optional condition expressed as JSON. e.g.
   *  { "weightLbsOver": 44000 } — ai-readable. */
  conditionJson: jsonb('condition_json').$type<Record<string, unknown>>(),
  /** When applicable — which services/equipment this accessorial applies to.
   *  Empty / null = applies to all. */
  appliesToServices: jsonb('applies_to_services').$type<string[]>(),
  enabled: boolean('enabled').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
}, (t) => [
  index('accessorials_tenant_idx').on(t.tenantId),
]);

// ────────────────────────────────────────────────────────────────────
// TERMINALS — tenant-scoped list of marine terminals / rail ramps the
// carrier serves. Solves the "I don't know which terminal" problem:
// the widget shows the tenant's terminals filtered by selected port,
// always with an "I don't know yet" first option.
//
// Each terminal can carry a per-move surcharge (some are slower /
// pricier than others — APM Pier 400 vs WBCT can differ by $150).
// ────────────────────────────────────────────────────────────────────
export const terminals = pgTable(
  'terminals',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Reference to ports.code — anchors this terminal to a port/city. */
    portCode: text('port_code').notNull(),
    /** Stable internal code, e.g. "USLAX_APM_P400" or "CHI_BNSF_LPC". */
    code: text('code').notNull(),
    /** Display name shown in the dropdown. */
    name: text('name').notNull(),
    /** Optional steamship line / rail carrier this terminal serves. */
    carrier: text('carrier'),
    address: text('address'),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    /** Per-move surcharge ($) when this specific terminal is picked. */
    surcharge: doublePrecision('surcharge').notNull().default(0),
    /** Optional note shown under the terminal name in the dropdown. */
    notes: text('notes'),
    enabled: boolean('enabled').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('terminals_tenant_code_idx').on(t.tenantId, t.code),
    index('terminals_tenant_port_idx').on(t.tenantId, t.portCode),
  ]
);

// ────────────────────────────────────────────────────────────────────
// LANE ZONES — used for drayage where rates aren't a flat $/mile but
// a stepped tariff by destination zone radius from the port.
// ────────────────────────────────────────────────────────────────────
export const laneZones = pgTable('lane_zones', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  /** Reference label, e.g. "Long Beach Port → 50mi zone". */
  label: text('label').notNull(),
  /** Anchor (origin) — typically a port code or city. */
  anchorPortCode: text('anchor_port_code'),
  anchorCity: text('anchor_city'),
  anchorState: text('anchor_state'),
  /** Inclusive radius (miles) from anchor. */
  radiusMiles: doublePrecision('radius_miles').notNull(),
  /** Flat price for any move from anchor → within radius (USD). */
  flatPrice: doublePrecision('flat_price').notNull(),
  /** Equipment scope — empty = any. */
  equipmentScope: jsonb('equipment_scope').$type<string[]>(),
  enabled: boolean('enabled').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
}, (t) => [
  index('lane_zones_tenant_idx').on(t.tenantId),
]);

// ────────────────────────────────────────────────────────────────────
// RATE ZONES — zip/city → zone-id legend for matrix pricing (Tier 2).
//
// A carrier tariff often ships the zone legend as a SEPARATE tab (research
// pattern 3): "zip3 900-902 = Zone A". This table stores those definitions so a
// shipment's origin/dest can resolve to the matrix key a `rate_matrices` cell is
// stored under. DISTINCT from `lane_zones` (a drayage radius-band flat tariff) —
// these are pure lookup rows, not priced.
//
//   zone_id     — the key a rate_matrices cell references (origin_key/dest_key).
//   match_kind  — 'zip5' | 'zip3' | 'city_state' | 'zip_range'.
//   match_value — the literal for zip5/zip3/city_state ('90802', '900', 'los angeles,ca').
//   match_from / match_to — inclusive bounds for 'zip_range'.
// ────────────────────────────────────────────────────────────────────
export const rateZones = pgTable('rate_zones', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  /** The matrix key this rule resolves to (matches rate_matrices.origin_key/dest_key). */
  zoneId: text('zone_id').notNull(),
  /** How a shipment location is matched: 'zip5' | 'zip3' | 'city_state' | 'zip_range'. */
  matchKind: text('match_kind').notNull(),
  /** Literal to match for zip5 / zip3 / city_state. Null for zip_range. */
  matchValue: text('match_value'),
  /** Inclusive lower bound (zip3 or zip5) for match_kind='zip_range'. */
  matchFrom: text('match_from'),
  /** Inclusive upper bound (zip3 or zip5) for match_kind='zip_range'. */
  matchTo: text('match_to'),
  /** Human label, e.g. "Zone A (LA Basin)". */
  label: text('label'),
  enabled: boolean('enabled').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
}, (t) => [
  index('rate_zones_tenant_idx').on(t.tenantId),
  index('rate_zones_tenant_zone_idx').on(t.tenantId, t.zoneId),
]);

// ────────────────────────────────────────────────────────────────────
// RATE MATRICES — native origin×dest / zone / drayage per-container pricing.
//
// One row per priced lane CELL (research patterns 1, 3, 5). Where Tier 1
// flattened a matrix to lane_zones + warned, this stores the real grid so the
// engine prices the exact cell. origin_key/dest_key are matrix keys — a zip5,
// zip3, a rate_zones.zone_id, a "city,state", or a port/UN-LOCODE — resolved
// from a shipment via zone/key resolution. DIRECTIONAL (A→B ≠ B→A).
//
//   mode        — service the cell prices ('ftl' | 'drayage' | …).
//   equipment   — equipment/container scope; null = any.
//   unit_basis  — 'flat' | 'per_mile' | 'per_container'.
//   rate        — the cell value in `unit_basis`.
//   min_charge  — per-cell minimum-charge floor (nullable).
//   source_ref  — provenance (file+tab+cell) for audit.
// ────────────────────────────────────────────────────────────────────
export const rateMatrices = pgTable('rate_matrices', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  /** Service mode this cell prices, e.g. 'ftl' | 'drayage'. */
  mode: text('mode').notNull(),
  /** Equipment / container scope, e.g. 'dryvan' | 'container_40'. Null = any. */
  equipment: text('equipment'),
  /** Matrix origin key (zip5/zip3/zone_id/city,state/port code). */
  originKey: text('origin_key').notNull(),
  /** Matrix destination key. */
  destKey: text('dest_key').notNull(),
  /** Cell rate expressed in `unitBasis`. */
  rate: doublePrecision('rate').notNull(),
  /** 'flat' | 'per_mile' | 'per_container'. */
  unitBasis: text('unit_basis').notNull().default('flat'),
  /** Per-cell minimum charge floor (USD/CAD), applied as max(computed, min). */
  minCharge: doublePrecision('min_charge'),
  /** Currency the cell was priced in (label only; never converted). */
  currency: text('currency'),
  /** Effective date (YYYY-MM-DD) if the sheet stated one. */
  effectiveDate: text('effective_date'),
  /** Provenance: source file / tab / cell for audit. */
  sourceRef: text('source_ref'),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
}, (t) => [
  index('rate_matrices_tenant_idx').on(t.tenantId),
  index('rate_matrices_lookup_idx').on(t.tenantId, t.mode, t.originKey, t.destKey),
]);

// ────────────────────────────────────────────────────────────────────
// AI CONFIG — one per tenant. Stores the system prompt the tenant
// edits ("you are XYZ Trucking's AI quote assistant. We focus on
// dryvan loads in TX. Always quote within 5 minutes...").
// ────────────────────────────────────────────────────────────────────
export const aiConfigs = pgTable('ai_configs', {
  tenantId: integer('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  systemPrompt: text('system_prompt').notNull().default(''),
  /** Tone: 'professional' | 'friendly' | 'concise' | 'enthusiastic' */
  tone: text('tone').notNull().default('professional'),
  /** Whether to auto-reply to incoming leads with email. */
  autoReplyEnabled: boolean('auto_reply_enabled').notNull().default(true),
  /** Whether to allow customer-service chat after quote. */
  chatEnabled: boolean('chat_enabled').notNull().default(true),
  /** Model preference for this tenant. Defaults to 'auto' (cheapest). */
  modelPreference: text('model_preference').notNull().default('auto'),
  /** Anything else the AI should know. JSON. */
  knowledgeJson: jsonb('knowledge_json').$type<Record<string, unknown>>(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
});

// ────────────────────────────────────────────────────────────────────
// HOSTED TRUST-WRAP (Phase 1) — the lean conversion landing shell that
// surrounds the calculator on a tenant's HOSTED page (/w/:slug). The
// embedded JS-snippet widget + the /w/demo showcase are unaffected. All
// three JSON shapes below are stored verbatim in brand_configs jsonb
// columns; the render (src/server/hostedPage.ts) + the PUT sanitizer
// (routes/tenant.ts) share these types so shape drift can't creep in.
// ────────────────────────────────────────────────────────────────────
/** One short social-proof review shown on the hosted page. */
export interface HostedTestimonial {
  quote: string;
  author: string;
  company?: string;
  /** Optional 1–5 star rating. */
  rating?: number;
}
/** A hosted-page call-to-action button. */
export interface HostedCta {
  label: string;
  /** How the button acts: dial a number, open a mail client, or a URL. */
  type: 'call' | 'email' | 'url';
  /** The phone number / email address / URL the button targets. */
  value: string;
}
/** Hosted-page background / theme settings. */
export interface HostedBackground {
  /** Page theme for the wrap chrome. Omitted → follows the widget theme mode. */
  theme?: 'light' | 'dark';
  /** A named colour/gradient preset id (see hostedPage.ts HOSTED_BG_PRESETS). */
  preset?: string;
  /** Optional hero background image (data-URL or URL). A legibility scrim is
   *  always painted over it so headline/badge text stays readable. */
  imageUrl?: string;
  /** Scrim strength over the hero image, 0–100 (default 55). */
  scrim?: number;
}

// ────────────────────────────────────────────────────────────────────
// BRAND CONFIG — what the customer's calculator looks like.
// ────────────────────────────────────────────────────────────────────
export const brandConfigs = pgTable('brand_configs', {
  tenantId: integer('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  displayName: text('display_name'), // shown above calculator
  tagline: text('tagline'),
  primaryColor: text('primary_color').notNull().default('#2563eb'),
  accentColor: text('accent_color').notNull().default('#6E8BFF'),
  /** Widget theming (Wave 1). A curated preset drives every widget colour;
   *  an optional accent override supersedes the preset accent; a self-hosted
   *  font is chosen from WIDGET_FONTS. Existing rows default to Midnight +
   *  Satoshi, which reproduces the current widget look exactly. See
   *  src/server/widgetThemes.ts. */
  themePreset: text('theme_preset').notNull().default('midnight'),
  accentOverride: text('accent_override'),
  fontFamily: text('font_family').notNull().default('satoshi'),
  /** Optional logo URL. */
  logoUrl: text('logo_url'),
  /** How much of the header bar the logo fills: 'half' (default — compact, the
   *  logo at its natural size beside the brand-name, today's look) or 'full'
   *  (a full-width contained banner; the brand-name text is hidden). The widget
   *  applies it as #qf-header[data-logo-fill]. In BOTH modes the logo is fit
   *  with object-fit:contain so aspect ratio is always preserved and nothing is
   *  ever cropped/stretched — this only changes the logo's max-WIDTH budget.
   *  See renderHeader (widget.js) + widget-ux-fixes.css. Default 'half' leaves
   *  existing tenants unchanged. */
  headerLogoFill: text('header_logo_fill').notNull().default('half'),
  /** Header logo size — 's' | 'm' | 'l' | 'xl'. Independent of whether the name
   *  shows, so a carrier can run a BIG logo AND keep the name + tagline. Logos
   *  are always object-fit:contain (never cropped). Default 'm' matches today. */
  headerLogoSize: text('header_logo_size').notNull().default('m'),
  /** Header layout — 'beside' (logo next to name, today's look) or 'stacked'
   *  (logo on its own line above the name + tagline — best for wide wordmarks). */
  headerLayout: text('header_layout').notNull().default('beside'),
  /** Whether the company name + tagline show alongside the logo. Off = logo-only
   *  (for carriers whose logo already contains their name). Default on. */
  headerShowName: boolean('header_show_name').notNull().default(true),
  /** Header alignment — 'left' (default) or 'center'. */
  headerAlign: text('header_align').notNull().default('left'),
  /** Whether the calculator header shows the carrier's credentials — USDOT/MC +
   *  public phone/email — as muted "meta lines" under the company name/tagline.
   *  Single source of truth: the numbers themselves live on `tenants`
   *  (dotNumber/mcNumber/publicContactEmail/contactPhone); this is only the
   *  on/off toggle. Default true so a carrier who already has the data shows it
   *  unless they opt out. See renderHeader (widget.js) + public-calculator-ux.css
   *  and migration 0040 (self-healed in src/db/migrate.ts). */
  headerShowCredentials: boolean('header_show_credentials').notNull().default(true),
  /** Whether the calculator header shows the carrier's tagline — the one short
   *  sentence under the company name (#qf-tagline). Default true so existing
   *  widgets are unchanged; a carrier can toggle it off to hide the tagline
   *  entirely. The de-rounded kicker chip beside the name is separate and
   *  always shown. See renderHeader (widget.js) + public-calculator-ux.css and
   *  migration 0045 (self-healed in src/db/migrate.ts). */
  showTagline: boolean('show_tagline').notNull().default(true),
  /** Tagline chip SIZE — 's' | 'm' | 'l'. Sizes the eyebrow chip's font in the
   *  calculator header (widget.js renderHeader sets data-tagline-size; CSS in
   *  public-calculator-ux.css sizes .brand-name::after per size). Default 'm'
   *  matches today. See migration 0047 (self-healed in src/db/migrate.ts). */
  taglineSize: text('tagline_size').notNull().default('m'),
  /** Tagline chip visual STYLE — 'solid' (bright brand-color fill, today's look)
   *  | 'subtle' (light accent tint + accent text) | 'plain' (accent text only,
   *  no chrome). widget.js renderHeader sets data-tagline-style; CSS variants in
   *  public-calculator-ux.css. Default 'solid' leaves existing widgets unchanged.
   *  See migration 0047 (self-healed in src/db/migrate.ts). */
  taglineStyle: text('tagline_style').notNull().default('solid'),
  /** Optional CTA button text override. */
  ctaText: text('cta_text').notNull().default('Get instant quote'),
  /** Optional label for the post-quote "confirm the rate" CTA (#qf-continue-btn)
   *  that reveals the contact form. Nullable — when null the widget falls back to
   *  its default ('Get the rate confirmed', or 'Claim this quote →' when
   *  showQuoteBeforeContact is on). A tenant value wins in both states. Kept
   *  separate from ctaText (the calculate button) so the two CTAs are
   *  independently editable. See renderHeader/applyContactRules in widget.js. */
  claimCtaText: text('claim_cta_text'),
  /** Footer text under the widget. */
  footerNote: text('footer_note'),
  /** How long each quote's "Valid until" date lasts, in days. Null = the app
   *  default (QUOTE_VALIDITY_DAYS). Lets rate-sensitive carriers shorten it. */
  quoteValidityDays: integer('quote_validity_days'),
  /** Where new quote-request lead notifications are emailed. Null/empty = the
   *  account contact email (today's behavior). */
  leadEmailTo: text('lead_email_to'),
  /** Comma-separated extra addresses to CC on every lead notification (e.g. a
   *  dispatch / sales inbox, or the wider team). */
  leadEmailCc: text('lead_email_cc'),
  /** Whether to show "Powered by QuoteFleet" branding. */
  showPoweredBy: boolean('show_powered_by').notNull().default(true),
  /** Allowed origins for the embed (CSV of domains). Empty = any. */
  allowedDomains: text('allowed_domains'),
  /** When true, customer must enter an email to submit a quote.
   *  Default true preserves the original required-email behavior. */
  requireEmail: boolean('require_email').notNull().default(true),
  /** When true, customer must enter a phone number to submit a quote.
   *  Default false — most carriers accept email-only inquiries. */
  requirePhone: boolean('require_phone').notNull().default(false),
  /** When true, the widget shows the calculated price BEFORE asking for
   *  contact info (the contact step is moved to the "claim quote" CTA).
   *  Default false preserves the standard contact-then-quote flow. */
  showQuoteBeforeContact: boolean('show_quote_before_contact').notNull().default(false),
  /** Per-tenant CTA hover effect: border (default) | lift | glow | fill | none.
   *  Default 'border' preserves the long-standing border-on-hover behaviour.
   *  See CTA_HOVER_STYLES in src/server/widgetThemes.ts. */
  ctaHover: text('cta_hover').notNull().default('border'),
  /** Tenant text/font colour: 'auto' (WCAG engine picks a safe foreground per
   *  surface) or a #RRGGBB hex that is only applied where it passes WCAG.
   *  Default 'auto' leaves existing tenants unchanged. */
  fontColor: text('font_color').notNull().default('auto'),
  /** Per-tenant MAP STYLE for the calculator's base + route maps: one of
   *  'branded' | 'grayscale' | 'standard' | 'dark_routes'. Nullable — null
   *  resolves to 'branded' (resolveMapStyle in src/server/routeMap.ts), which
   *  reproduces the current theme-aware look, so existing tenants are unchanged. */
  mapStyle: text('map_style'),
  /** Per-tenant MAP-BLEND toggle: 'on' feathers the route-map's edges into the
   *  calculator surface (a theme-agnostic, token-driven effect); 'off' (default)
   *  keeps the map's crisp rectangular edge — the current look. Read by
   *  resolveWidgetTheme (src/server/widgetThemes.ts, MAP_BLEND_VALUES) and applied
   *  as body[data-qf-map-blend]. notNull default 'off' so existing rows are
   *  unchanged with no backfill. */
  mapBlend: text('map_blend').notNull().default('off'),
  /** Per-tenant MAP-BLEND OPACITY (0–100). 0 = OFF (crisp rectangular map, the
   *  default); 1–100 = blend ON at that feather intensity. The on/off master
   *  (map_blend / body[data-qf-map-blend]) is DERIVED from opacity>0; this value
   *  scales the feather via the --qf-map-blend-opacity custom property. Backfilled
   *  from the legacy map_blend flag ('on'→60, 'off'→0) in migration 0033. notNull
   *  default 0 so existing rows are unchanged. See widgetThemes.ts. */
  mapBlendOpacity: integer('map_blend_opacity').notNull().default(0),
  /** Per-tenant optional feature toggles. A single, extensible JSON bag so new
   *  opt-in widget features never need a new column. Nullable — null resolves
   *  to the defaults in src/server/features.ts (resolveFeatures). Known keys:
   *    { quoteShare?: boolean, quoteBooking?: boolean }
   *  quoteShare (default ON) gates the customer share/email/print/PDF action
   *  bar; quoteBooking (default OFF) is reserved for a later booking wave. */
  featuresJson: jsonb('features_json').$type<Record<string, boolean>>(),
  // ── Hosted trust-wrap (Phase 1) ──────────────────────────────────────
  // The lean conversion landing shell around the HOSTED calculator page
  // (/w/:slug). ALL nullable / safe-defaulted so the deploy is non-breaking
  // and every existing tenant renders exactly as before (no headline, no
  // badges, no testimonials → the wrap degrades to the bare calculator with
  // only the theme background). The embed snippet + /w/demo are unaffected.
  // See src/server/hostedPage.ts + migration 0035.
  /** Marketing headline shown above/beside the calculator. */
  hostedHeadline: text('hosted_headline'),
  /** Supporting subhead under the headline. */
  hostedSubhead: text('hosted_subhead'),
  /** When true, surface the carrier's USDOT / MC / insurance credibility
   *  badges from data already collected (tenants.dotNumber / mcNumber). No
   *  new input required. Default false leaves existing tenants unchanged. */
  hostedTrustBadges: boolean('hosted_trust_badges').notNull().default(false),
  /** 2–4 short customer reviews. See HostedTestimonial. */
  hostedTestimonialsJson: jsonb('hosted_testimonials_json').$type<HostedTestimonial[]>(),
  /** 2–3 call-to-action buttons (call / email / URL). See HostedCta. */
  hostedCtasJson: jsonb('hosted_ctas_json').$type<HostedCta[]>(),
  /** Page background / theme + optional hero image. See HostedBackground. */
  hostedBackgroundJson: jsonb('hosted_background_json').$type<HostedBackground>(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
});

// ────────────────────────────────────────────────────────────────────
// LEADS — incoming quote requests from end-customers (the visitors
// to the tenant's website who used the calculator).
// ────────────────────────────────────────────────────────────────────
export const leads = pgTable(
  'leads',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Public reference shown to customer (e.g. "QF-2026-0042"). */
    refId: text('ref_id').notNull().unique(),

    // ─── customer contact ─────────────────────────────────────────
    customerName: text('customer_name'),
    customerEmail: text('customer_email'),
    customerPhone: text('customer_phone'),
    customerCompany: text('customer_company'),

    // ─── shipment details ─────────────────────────────────────────
    service: text('service').notNull(), // drayage | ftl | ltl | ...
    equipment: text('equipment').notNull(),

    pickupAddress: text('pickup_address'),
    pickupCity: text('pickup_city'),
    pickupState: text('pickup_state'),
    pickupZip: text('pickup_zip'),
    pickupCountry: text('pickup_country').default('US'),
    pickupLat: doublePrecision('pickup_lat'),
    pickupLng: doublePrecision('pickup_lng'),

    deliveryAddress: text('delivery_address'),
    deliveryCity: text('delivery_city'),
    deliveryState: text('delivery_state'),
    deliveryZip: text('delivery_zip'),
    deliveryCountry: text('delivery_country').default('US'),
    deliveryLat: doublePrecision('delivery_lat'),
    deliveryLng: doublePrecision('delivery_lng'),

    pickupDate: text('pickup_date'),
    deliveryDate: text('delivery_date'),

    /** Drayage: terminal codes when known. Match `terminals.code`. */
    pickupTerminalCode: text('pickup_terminal_code'),
    deliveryTerminalCode: text('delivery_terminal_code'),
    /** Drayage: ocean carrier (steamship line) name, e.g. "Maersk", "MSC". */
    oceanCarrier: text('ocean_carrier'),
    /** Drayage: booking number from the steamship line. */
    bookingNumber: text('booking_number'),
    /** Drayage: bill-of-lading or sea-waybill number. */
    billOfLadingNumber: text('bill_of_lading_number'),
    /** Drayage: container number(s) when known. */
    containerNumbers: text('container_numbers'),

    weightLbs: doublePrecision('weight_lbs'),
    pieces: integer('pieces'),
    commodity: text('commodity'),
    notes: text('notes'),

    // ─── LTL size/weight rating ───────────────────────────────────
    /** Shipment dimensions (inches) — used to derive freight class. */
    lengthIn: doublePrecision('length_in'),
    widthIn: doublePrecision('width_in'),
    heightIn: doublePrecision('height_in'),
    /** Derived NMFC freight class (e.g. 70). */
    freightClass: doublePrecision('freight_class'),
    /** Derived density in lb/ft³ that produced the class. */
    densityPcf: doublePrecision('density_pcf'),
    /** LTL: freight on pallets (vs loose / floor-loaded). */
    palletized: boolean('palletized'),
    /** LTL: loaded/unloaded at a dock (false ⇒ liftgate service). */
    loadedFromDock: boolean('loaded_from_dock'),

    /** Selected accessorials (codes, e.g. ["liftgate","residential"]). */
    accessorialCodes: jsonb('accessorial_codes').$type<string[]>(),

    /** Flexible client-collected extras persisted verbatim for the dispatcher:
     *  the LTL per-commodity breakdown (`ltlItems`), the aggregate LTL class,
     *  and the drayage OOG oversize dimensions (`oversize`). */
    metaJson: jsonb('meta_json').$type<Record<string, unknown>>(),

    /** Computed at quote time. */
    distanceMiles: doublePrecision('distance_miles'),
    /** Calc breakdown — line items so the customer can see the math. */
    breakdownJson: jsonb('breakdown_json').$type<
      Array<{ name: string; amount: number; kind?: string; note?: string }>
    >(),
    quotedTotal: doublePrecision('quoted_total'),
    quotedCurrency: text('quoted_currency').notNull().default('USD'),

    /** Plain-English explanation generated by AI. */
    aiSummary: text('ai_summary'),

    /** Where the request came from (referrer). */
    source: text('source'),
    sourceUrl: text('source_url'),
    sourceIp: text('source_ip'),
    userAgent: text('user_agent'),

    /** Status: 'draft' (calc only, no contact yet) | 'new' | 'replied' |
     *  'won' | 'lost' | 'spam' */
    status: text('status').notNull().default('draft'),

    /** Whether AI auto-reply was sent. */
    autoReplySent: boolean('auto_reply_sent').notNull().default(false),
    autoReplyAt: timestamp('auto_reply_at', { mode: 'date' }),

    /** Automated shipper follow-up bookkeeping (src/email/followUpCron.ts).
     *  Records which touches have already been sent so the cron is idempotent
     *  and can run every hour without ever double-sending. Keys mirror the
     *  three touches: 'nudge' | 'reminder' | 'discount'. Values: ISO timestamp
     *  of when that touch went out. Null/absent ⇒ nothing sent yet. Additive,
     *  no backfill — existing leads read null and simply become eligible. */
    followUpsSentJson: jsonb('follow_ups_sent_json').$type<Record<string, string>>(),
    /** Customer opted OUT of this carrier's follow-up sequence (clicked the
     *  tokenized unsubscribe link in a follow-up email → GET/POST /unsubscribe
     *  with a lead-scoped `L<id>.<sig>` token). The follow-up cron SKIPS any
     *  lead with this true. Scoped to the LEAD, not the tenant — one customer
     *  opting out never silences the carrier's other customers. Default false;
     *  existing leads read false. */
    followUpOptOut: boolean('follow_up_opt_out').notNull().default(false),

    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('leads_ref_idx').on(t.refId),
    // Dashboard list-by-tenant ordered by date is the hot read on this
    // table. Composite index gives index-only scans for the common case.
    index('leads_tenant_created_idx').on(t.tenantId, t.createdAt),
    index('leads_tenant_status_idx').on(t.tenantId, t.status),
  ]
);

// ────────────────────────────────────────────────────────────────────
// CALLBACK REQUESTS — when a visitor wants a human to call them back.
//
// Two creation paths:
//   1. Visitor clicks "Request a callback" in the post-quote chat UI.
//      (`leadId` is set, source = 'chat_escalation' or 'visitor_button')
//   2. AI assistant escalates because it can't resolve a question,
//      it surfaced a non-standard accessorial, or visitor explicitly
//      asked for a human. (source = 'chat_escalation', `aiContext`
//      captures the convo snippet that triggered the escalation.)
//
// Lifecycle: open → in_progress → completed | no_answer | cancelled.
// Tenant gets an email notification on creation; the inbox lives at
// /app/callbacks.
// ────────────────────────────────────────────────────────────────────
export const callbackRequests = pgTable(
  'callback_requests',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Linked lead when one exists (post-quote callback). Null for
     *  visitor-initiated callbacks that happen before quote submit. */
    leadId: integer('lead_id').references(() => leads.id, { onDelete: 'set null' }),
    /** Denormalized lead refId for ops convenience (logs, emails). */
    leadRefId: text('lead_ref_id'),

    customerName: text('customer_name').notNull(),
    customerPhone: text('customer_phone').notNull(),
    customerEmail: text('customer_email'),
    customerCompany: text('customer_company'),

    /** Free-form preferred time, e.g. "weekday afternoons PT". */
    preferredTime: text('preferred_time'),
    /** What they want to discuss. */
    topic: text('topic'),

    /** Where the request came from:
     *  'visitor_button' — tapped the "Request a callback" CTA
     *  'chat_escalation' — AI tool-called request_callback during chat
     *  'human'           — operator entered it manually */
    triggerSource: text('trigger_source').notNull().default('visitor_button'),

    /** Snapshot of the chat conversation that led to the escalation
     *  (when triggerSource = 'chat_escalation'). Useful so the human
     *  doesn't have to re-ask what the AI already covered. */
    aiContextJson: jsonb('ai_context_json').$type<{
      messages?: Array<{ role: string; content: string }>;
      reason?: string;
    }>(),

    /** Lifecycle. */
    status: text('status').notNull().default('open'),
    assignedToUserId: integer('assigned_to_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** Operator notes (call outcome, follow-ups, etc.). */
    notes: text('notes'),
    completedAt: timestamp('completed_at', { mode: 'date' }),

    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('callback_tenant_status_idx').on(t.tenantId, t.status, t.createdAt),
    index('callback_lead_idx').on(t.leadId),
  ]
);

// ────────────────────────────────────────────────────────────────────
// CONVERSATIONS — chat between AI and lead (or between AI and tenant
// admin for rate adjustment). channel: 'lead_chat' | 'admin_rate_chat'.
// ────────────────────────────────────────────────────────────────────
export const conversations = pgTable('conversations', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  channel: text('channel').notNull(), // 'lead_chat' | 'admin_rate_chat'
  leadId: integer('lead_id').references(() => leads.id, {
    onDelete: 'cascade',
  }),
  userId: integer('user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  role: text('role').notNull(), // 'user' | 'assistant' | 'tool'
  content: text('content').notNull(),
  /** Optional tool-use payload. */
  metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
}, (t) => [
  index('conversations_tenant_lead_idx').on(t.tenantId, t.leadId, t.createdAt),
  index('conversations_lead_idx').on(t.leadId),
]);

// ────────────────────────────────────────────────────────────────────
// DISTANCE CACHE — shared across all tenants. Key = (origin_key, dest_key)
// where keys are normalised "ZIP|country" or "lat,lng" rounded to 0.01.
// ────────────────────────────────────────────────────────────────────
export const distanceCache = pgTable(
  'distance_cache',
  {
    id: serial('id').primaryKey(),
    originKey: text('origin_key').notNull(),
    destKey: text('dest_key').notNull(),
    miles: doublePrecision('miles').notNull(),
    /** Source: 'haversine' | 'osrm' | 'mapbox' | 'manual'. */
    source: text('source').notNull().default('haversine'),
    routeJson: jsonb('route_json').$type<unknown>(),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('distance_cache_idx').on(t.originKey, t.destKey)]
);

// ────────────────────────────────────────────────────────────────────
// GEOCODE CACHE — query string → lat/lng + canonical fields.
// ────────────────────────────────────────────────────────────────────
export const geocodeCache = pgTable(
  'geocode_cache',
  {
    id: serial('id').primaryKey(),
    queryKey: text('query_key').notNull().unique(),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    canonicalAddress: text('canonical_address'),
    city: text('city'),
    state: text('state'),
    zip: text('zip'),
    country: text('country'),
    source: text('source').notNull().default('nominatim'),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('geocode_query_idx').on(t.queryKey)]
);

// ────────────────────────────────────────────────────────────────────
// ROUTE-MAP CACHE — persisted rendered PNG for the quote route snapshot.
// Key = `${laneCacheKey}|${theme}` (rounded origin+dest coords + light|dark).
// Stores the fetched Google Static Maps PNG as base64 so redeploys and
// multi-instance never re-bill the Directions/Static APIs for the same lane.
// Shared across all tenants (the lane geometry is not tenant-specific).
// ────────────────────────────────────────────────────────────────────
export const routeMapCache = pgTable(
  'route_map_cache',
  {
    id: serial('id').primaryKey(),
    /** `${laneCacheKey}|light` or `${laneCacheKey}|dark`. */
    cacheKey: text('cache_key').notNull(),
    /** Base64-encoded PNG bytes of the rendered static map. */
    pngBase64: text('png_base64').notNull(),
    /** 'route' = real road polyline; 'straight' = straight-line fallback. */
    kind: text('kind').notNull().default('route'),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('route_map_cache_idx').on(t.cacheKey)]
);

// ────────────────────────────────────────────────────────────────────
// AUDIT LOG — record every AI agent action that changes data.
// ────────────────────────────────────────────────────────────────────
export const auditLog = pgTable('audit_log', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id, {
    onDelete: 'cascade',
  }),
  userId: integer('user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  /** 'rate_card.update', 'accessorial.add', 'lead.reply', etc. */
  action: text('action').notNull(),
  actorKind: text('actor_kind').notNull().default('user'), // 'user' | 'ai_agent' | 'system'
  /** Free-form details. */
  detailsJson: jsonb('details_json').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
}, (t) => [
  index('audit_log_tenant_created_idx').on(t.tenantId, t.createdAt),
]);

// ────────────────────────────────────────────────────────────────────
// PORTS — read-only reference for drayage origin lookups (US/Canada).
// Seeded from data/ports.ts at deploy time.
// ────────────────────────────────────────────────────────────────────
export const ports = pgTable(
  'ports',
  {
    id: serial('id').primaryKey(),
    /** UN/LOCODE, e.g. USLAX, USLGB, CAVAN, CAMTR. */
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    city: text('city').notNull(),
    state: text('state'),
    country: text('country').notNull(),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    /** Container traffic indicator (TEUs) for sort. */
    teuRank: integer('teu_rank').default(0),
  },
  (t) => [uniqueIndex('ports_code_idx').on(t.code)]
);

// ────────────────────────────────────────────────────────────────────
// OUTREACH PROSPECTS — platform-level (no tenantId). Owners are the
// super-admins running cold campaigns to acquire new tenants.
//
// We don't send mail from this DB — sending happens via Smartlead
// (or Instantly), which has its own queueing, warmup, and reputation
// management. We just track the prospect pipeline and statuses so you
// have a single dashboard.
//
// Status flow: new → enriched → queued → sent → opened → replied →
//              meeting → trial_started → subscribed → churned
//              (or 'unqualified' / 'bounced' / 'unsubscribed')
// ────────────────────────────────────────────────────────────────────
export const outreachProspects = pgTable(
  'outreach_prospects',
  {
    id: serial('id').primaryKey(),
    /** Stable external ID from Smartlead / Instantly when synced. */
    externalId: text('external_id'),
    /** Which provider this prospect lives in. */
    provider: text('provider').notNull().default('smartlead'),
    /** Source of the lead — 'scrape:google_maps', 'manual', 'csv_upload', 'apollo_export'. */
    source: text('source'),

    // ── company ──────────────────────────────────────────────────
    companyName: text('company_name'),
    companyDomain: text('company_domain'),
    companyPhone: text('company_phone'),
    companyAddress: text('company_address'),
    companyCity: text('company_city'),
    companyState: text('company_state'),
    companyCountry: text('company_country'),
    /** Carrier sub-segment: drayage / FTL / LTL / 3PL / freight forwarder / etc. */
    segment: text('segment'),
    /** Estimated fleet size, employees, or revenue band. */
    sizeBand: text('size_band'),
    websiteUrl: text('website_url'),
    /** What we found on their site (has-quote-tool? form-only? phone-only?). */
    websiteSnapshotJson: jsonb('website_snapshot_json').$type<Record<string, unknown>>(),

    // ── contact person ───────────────────────────────────────────
    contactName: text('contact_name'),
    contactTitle: text('contact_title'),
    contactEmail: text('contact_email'),
    contactPhone: text('contact_phone'),
    contactLinkedin: text('contact_linkedin'),

    // ── pipeline ─────────────────────────────────────────────────
    status: text('status').notNull().default('new'),
    /** ISO date strings of the most recent state transition. */
    lastTouchedAt: timestamp('last_touched_at', { mode: 'date' }),
    nextFollowupAt: timestamp('next_followup_at', { mode: 'date' }),
    /** Free-form notes typed by the operator. */
    notes: text('notes'),
    /** When converted, link to the resulting tenant. */
    convertedTenantId: integer('converted_tenant_id').references(() => tenants.id, {
      onDelete: 'set null',
    }),

    /** Custom tags / lists, e.g. ["fmcsa-import", "nyc", "drayage"]. */
    tags: jsonb('tags').$type<string[]>(),

    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('outreach_email_idx').on(t.contactEmail),
    index('outreach_prospects_status_idx').on(t.status),
  ]
);

// ────────────────────────────────────────────────────────────────────
// OUTREACH CAMPAIGNS — campaign metadata mirrored from Smartlead.
// ────────────────────────────────────────────────────────────────────
export const outreachCampaigns = pgTable('outreach_campaigns', {
  id: serial('id').primaryKey(),
  /** Smartlead / Instantly campaign ID. */
  externalId: text('external_id').notNull(),
  provider: text('provider').notNull().default('smartlead'),
  name: text('name').notNull(),
  /** Sending domain used for this campaign — separate from the product brand. */
  sendingDomain: text('sending_domain'),
  /** Subject line + body templates (synced from provider for visibility). */
  subjectLine: text('subject_line'),
  bodyTemplate: text('body_template'),
  status: text('status').notNull().default('draft'), // draft | warming | active | paused | done
  /** Aggregate stats refreshed on a schedule. */
  statsJson: jsonb('stats_json').$type<{
    sent?: number;
    opened?: number;
    replied?: number;
    meetings?: number;
    bounced?: number;
    unsubscribed?: number;
    lastSyncedAt?: string;
  }>(),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
});

// ────────────────────────────────────────────────────────────────────
// OUTREACH EVENTS — per-prospect activity log (sends, opens, replies).
// Mirrored from Smartlead webhooks so the admin dashboard timeline is
// fast to read without round-tripping the API.
// ────────────────────────────────────────────────────────────────────
export const outreachEvents = pgTable('outreach_events', {
  id: serial('id').primaryKey(),
  prospectId: integer('prospect_id')
    .notNull()
    .references(() => outreachProspects.id, { onDelete: 'cascade' }),
  campaignId: integer('campaign_id').references(() => outreachCampaigns.id, {
    onDelete: 'set null',
  }),
  /** 'sent' | 'opened' | 'clicked' | 'replied' | 'meeting_booked' |
   *  'bounced' | 'unsubscribed' | 'note' | 'manual' */
  eventType: text('event_type').notNull(),
  /** Step in the campaign sequence (1 = initial, 2 = first followup, …). */
  stepIndex: integer('step_index'),
  /** Free-form payload (subject, body excerpt, link clicked, etc.). */
  payloadJson: jsonb('payload_json').$type<Record<string, unknown>>(),
  occurredAt: timestamp('occurred_at', { mode: 'date' }).notNull().defaultNow(),
}, (t) => [
  index('outreach_events_prospect_occurred_idx').on(t.prospectId, t.occurredAt),
]);

// ════════════════════════════════════════════════════════════════════
// MARKETPLACE — cross-tenant rate index.
//
// Two surfaces sit on top of these tables:
//   - **Public marketplace** (browsable by shippers / forwarders): only
//     shows tenants where `marketplaceOptIn = true`. They see carrier
//     name, locations, equipment, current rates per lane.
//   - **Anonymized benchmarks** (always-on, GDPR-safe): aggregated
//     stats — median, P25, P75 per (lane, equipment) — computed across
//     ALL tenants. No carrier names. Useful for the rate-tuning AI to
//     answer "how does my $2.55/mi compare to the market?".
//
// Sync model: every UPDATE / INSERT on rate_cards / accessorials /
// lane_zones / terminals fires `syncTenantToMarketplace(tenantId)`,
// which upserts the carrier profile and snapshots its current rates.
// See src/marketplace/sync.ts.
// ════════════════════════════════════════════════════════════════════
export const marketplaceCarriers = pgTable(
  'marketplace_carriers',
  {
    /** 1:1 with tenants.id — also the PK. */
    tenantId: integer('tenant_id')
      .primaryKey()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Cached from tenants.name at last sync — denormalized so the public
     *  view is fast even when joining many carriers. */
    displayName: text('display_name').notNull(),
    /** Country focus: 'US', 'CA', 'BOTH'. */
    countryFocus: text('country_focus').notNull().default('US'),
    mcNumber: text('mc_number'),
    dotNumber: text('dot_number'),
    /** Free-text description from the carrier's brand profile. */
    summary: text('summary'),
    /** Slug-or-URL of public profile page. */
    publicSlug: text('public_slug').notNull(),
    /** Equipment types the carrier offers (rolled up from rate_cards). */
    equipmentJson: jsonb('equipment_json').$type<string[]>(),
    /** Services the carrier offers (drayage / ftl / ltl / expedited / hotshot). */
    servicesJson: jsonb('services_json').$type<string[]>(),
    /** Whether this row is publicly visible. Mirrors tenants.marketplace_opt_in. */
    visible: boolean('visible').notNull().default(false),
    /** Last successful sync timestamp. */
    lastSyncedAt: timestamp('last_synced_at', { mode: 'date' }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('marketplace_carriers_slug_idx').on(t.publicSlug)]
);

// Per-carrier lane footprint — anchored either at a port (drayage) or
// a metro area (over-the-road). Computed from lane_zones + recent
// quote-form pickup/delivery patterns.
export const marketplaceLanes = pgTable(
  'marketplace_lanes',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Anchor: 'port' | 'metro' | 'state' | 'national'. */
    anchorType: text('anchor_type').notNull(),
    /** PORTS_DATA.code for port anchors, USPS state code for state, etc. */
    anchorCode: text('anchor_code').notNull(),
    /** Inclusive radius from anchor in miles. */
    radiusMiles: doublePrecision('radius_miles'),
    /** Equipment scope (rolled up from any matching rate cards). */
    equipmentJson: jsonb('equipment_json').$type<string[]>(),
    /** Services this lane covers. */
    servicesJson: jsonb('services_json').$type<string[]>(),
    enabled: boolean('enabled').notNull().default(true),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('marketplace_lanes_idx').on(t.tenantId, t.anchorType, t.anchorCode),
    index('marketplace_lanes_tenant_idx').on(t.tenantId),
  ]
);

// Periodic snapshots of a carrier's rate book. Each material change
// (rate edit, accessorial change, zone tariff edit) writes a new row.
// Lets the marketplace dashboard show rate history + trend lines, and
// gives the AI context like "rates at this carrier moved up 7% in 30 days."
export const marketplaceRateSnapshots = pgTable(
  'marketplace_rate_snapshots',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Service + equipment slot the snapshot describes. */
    service: text('service').notNull(),
    equipment: text('equipment').notNull(),
    /** Snapshot of the rate card values at this point in time. */
    ratePerMile: doublePrecision('rate_per_mile'),
    minimumCharge: doublePrecision('minimum_charge'),
    flatFee: doublePrecision('flat_fee'),
    fuelSurchargePct: doublePrecision('fuel_surcharge_pct'),
    /** Optional anchor (port/metro) — present when this snapshot is
     *  scoped to a specific lane zone rather than a generic rate card. */
    laneAnchorCode: text('lane_anchor_code'),
    laneRadiusMiles: doublePrecision('lane_radius_miles'),
    laneFlatPrice: doublePrecision('lane_flat_price'),
    /** What triggered this snapshot — for audit. */
    sourceKind: text('source_kind').notNull(), // 'rate_card_edit' | 'lane_zone_edit' | 'ai_ingest' | 'periodic'
    sourceMeta: jsonb('source_meta').$type<Record<string, unknown>>(),
    capturedAt: timestamp('captured_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('marketplace_snapshots_tenant_captured_idx').on(t.tenantId, t.capturedAt),
  ]
);

// Anonymized aggregates per (service, equipment, lane-anchor). Refreshed
// on a schedule (e.g. nightly). Always queryable — no opt-in required.
export const marketplaceAggregates = pgTable(
  'marketplace_aggregates',
  {
    id: serial('id').primaryKey(),
    service: text('service').notNull(),
    equipment: text('equipment').notNull(),
    /** Optional anchor — null means "national average". */
    anchorType: text('anchor_type'),
    anchorCode: text('anchor_code'),
    /** Number of carriers in the sample. Suppressed display when < 5. */
    sampleSize: integer('sample_size').notNull(),
    /** $/mi statistics. */
    p25RatePerMile: doublePrecision('p25_rate_per_mile'),
    p50RatePerMile: doublePrecision('p50_rate_per_mile'),
    p75RatePerMile: doublePrecision('p75_rate_per_mile'),
    /** Minimum-charge statistics. */
    p25Minimum: doublePrecision('p25_minimum'),
    p50Minimum: doublePrecision('p50_minimum'),
    p75Minimum: doublePrecision('p75_minimum'),
    /** Flat-tariff statistics for drayage (when anchor is a port). */
    p25FlatPrice: doublePrecision('p25_flat_price'),
    p50FlatPrice: doublePrecision('p50_flat_price'),
    p75FlatPrice: doublePrecision('p75_flat_price'),
    computedAt: timestamp('computed_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('marketplace_aggregates_idx').on(t.service, t.equipment, t.anchorType, t.anchorCode),
  ]
);

// File ingest jobs — the AI agent accepts a rate sheet (PDF / image /
// Excel / .eml) and extracts structured rate data. The job stores the
// raw input + the model's structured output until the user confirms or
// rejects. Only on confirm do we apply the changes to rate_cards etc.
export const ingestJobs = pgTable('ingest_jobs', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  /** Friendly file name for the dashboard. */
  filename: text('filename').notNull(),
  /** MIME type as detected. */
  mimeType: text('mime_type'),
  /** Size in bytes. */
  sizeBytes: integer('size_bytes'),
  /** Where the file is stored. We use base64-in-DB for MVP (small files
   *  only). For production swap to object storage and store the URL. */
  storageRef: text('storage_ref'),
  /** Status: 'pending' | 'parsing' | 'ready_for_review' | 'applied' | 'rejected' | 'failed'. */
  status: text('status').notNull().default('pending'),
  /** What the model extracted. JSON mirroring NewRateCard / NewAccessorial / NewLaneZone shapes. */
  parsedJson: jsonb('parsed_json').$type<Record<string, unknown>>(),
  /** For email-originated jobs: the normalized `from` address the rate sheet
   *  arrived from. Null for manual dashboard uploads. Recorded so that when an
   *  operator APPROVES a held email import, its sender can be added to the
   *  tenant's `ingestTrustedSendersJson` allowlist (trust-on-approve). */
  sourceEmail: text('source_email'),
  /** Human notes from the operator during review. */
  reviewNotes: text('review_notes'),
  /** Error message when status='failed'. */
  errorMessage: text('error_message'),
  appliedAt: timestamp('applied_at', { mode: 'date' }),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
}, (t) => [
  index('ingest_jobs_tenant_status_idx').on(t.tenantId, t.status),
]);

// ────────────────────────────────────────────────────────────────────
// PLATFORM SETTINGS — key/value store for app-wide config.
// ────────────────────────────────────────────────────────────────────
export const platformSettings = pgTable('platform_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
});

// ────────────────────────────────────────────────────────────────────
// PROSPECT DEMOS — lightweight, shareable, on-brand preview pages for the
// AI Outreach Engine. Given a freight company's domain, the super-admin
// provisioner enriches it and stores a PROSPECT preview here — NOT a tenant.
//
// A prospect_demo is deliberately isolated from every tenant system: it
// creates NO tenant, user, brand_config, rate_card, or lead row, so it never
// shows up in tenant lists, MRR, trials, reminders, or quota. It only holds
// the brand + a small sample-rate calculator config, keyed by an unguessable
// `token` used in the public `/demo/:token` URL. The public demo page renders
// the REAL widget themed with this brand and computes quotes from the stored
// sample rates via the in-memory calc engine (no DB writes).
// ────────────────────────────────────────────────────────────────────

/** Brand identity captured from enrichment, persisted on a prospect_demo. */
export interface ProspectDemoBrand {
  primary: string | null;
  secondary: string | null;
  logoUrl: string | null;
  companyName: string | null;
  /** Confidence behind `primary` — 'high' = an explicit brand signal (e.g.
   *  theme-color meta), 'low' = a best-effort guess (or discarded entirely,
   *  see deriveDemoBrand). Optional so a later human/vision step can review
   *  or override low-confidence picks. Absent on older rows. */
  brandColorConfidence?: 'high' | 'low';
}

/** One in-memory sample rate card the demo calculator prices against. Mirrors
 *  the pricing-relevant subset of `rate_cards` — never persisted as a real card. */
export interface ProspectDemoSampleCard {
  service: string;
  equipment: string;
  label: string;
  ratePerMile: number;
  minimumCharge: number;
  flatFee: number;
  fuelSurchargePct: number;
  marginPct: number;
  maxMiles: number | null;
  maxWeightLbs: number | null;
}

/** The widget config a prospect_demo renders from — modes + fields + SAMPLE
 *  rates. Shaped so the public demo endpoints can synthesize the exact
 *  `/api/public/widget/:slug` response the (unforked) widget expects. */
export interface ProspectDemoConfig {
  /** Best-fit calculator mode for this company (e.g. 'drayage', 'ftl'). */
  primaryMode: string;
  /** Services + their equipment options rendered as the widget's mode buttons. */
  services: Array<{
    service: string;
    label: string;
    equipments: Array<{ equipment: string; label: string }>;
  }>;
  /** Sample rate cards the calc engine prices against. */
  sampleCards: ProspectDemoSampleCard[];
  /** The mode-appropriate input fields the AI suggested (drayage → port/chassis…). */
  fields: string[];
  /** Currency/label focus. */
  countryFocus: 'US' | 'CA';
}

export const prospectDemos = pgTable(
  'prospect_demos',
  {
    id: serial('id').primaryKey(),
    /** Unguessable slug used in the public /demo/:token URL. */
    token: text('token').notNull(),
    /** Normalized apex/host this demo was built for (dedupe key). */
    domain: text('domain').notNull(),
    companyName: text('company_name'),
    /** The full CompanyProfile from enrichCompany (for the admin + regeneration). */
    profileJson: jsonb('profile_json').$type<Record<string, unknown>>(),
    /** Brand identity applied to the widget theme + demo page header. */
    brandJson: jsonb('brand_json').$type<ProspectDemoBrand>(),
    /** Widget config: modes + fields + sample rates. */
    configJson: jsonb('config_json').$type<ProspectDemoConfig>(),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
    /** First time the public demo page was loaded; null until then. */
    viewedAt: timestamp('viewed_at', { mode: 'date' }),
    /** Base64 PNG of the prospect's branded quote, captured at provision time.
     *  Served at /demo-shot/:token.png and embedded (clickable) in the outreach
     *  email. Null until a shot is captured. Stored in-DB so the Replit app can
     *  serve a shot the (Playwright-capable) orchestrator produced. */
    quoteShotB64: text('quote_shot_b64'),
    /** When the quote shot was last captured. */
    quoteShotAt: timestamp('quote_shot_at', { mode: 'date' }),
  },
  (t) => [
    uniqueIndex('prospect_demos_token_idx').on(t.token),
    uniqueIndex('prospect_demos_domain_idx').on(t.domain),
  ]
);

// ────────────────────────────────────────────────────────────────────
// INBOUND PROSPECTS — REVERSE OUTREACH (Phase 0, ships inert).
//
// Every row is one inbound broker/carrier MARKETING email harvested from a
// freight company's own mailbox. A later phase replies IN-THREAD with that
// sender's OWN branded QuoteFleet demo. Like prospect_demos / outreach_emails,
// this table is DELIBERATELY ISOLATED: it NEVER touches tenants / users /
// leads, so a harvested prospect stays out of MRR, trials, quota, and every
// tenant list by construction. Nothing writes here until the poller phase lands.
// ────────────────────────────────────────────────────────────────────
export const inboundProspects = pgTable(
  'inbound_prospects',
  {
    id: serial('id').primaryKey(),
    /** Which harvested mailbox this inbound was pulled from (e.g. a monitored
     *  broker inbox). Lets multiple source mailboxes coexist. */
    harvestMailbox: text('harvest_mailbox').notNull(),
    /** Sender's email address (the broker/carrier marketer we'll reply to). */
    fromEmail: text('from_email').notNull(),
    /** Normalized apex/host of `fromEmail` — the demo dedupe/build key. */
    fromDomain: text('from_domain').notNull(),
    /** RFC 5322 Message-ID of the harvested email — the in-thread reply anchor.
     *  Nullable (some emails omit it); UNIQUE when present for idempotent harvest. */
    originalMessageId: text('original_message_id'),
    /** The harvested email's References chain (In-Reply-To + References), stored
     *  as a jsonb string array to match the schema's other jsonb usage. */
    originalReferences: jsonb('original_references').$type<string[]>(),
    /** Subject line of the harvested email (context for the reply draft). */
    originalSubject: text('original_subject'),
    /** When the harvested email was received (from its Date header). */
    receivedAt: timestamp('received_at', { mode: 'date' }),
    /** Parsed signature block (name/title/phone/company…) for personalization. */
    signatureJson: jsonb('signature_json').$type<Record<string, unknown>>(),
    /** Classifier verdict (e.g. 'broker_marketing', 'irrelevant'); null until run. */
    classifyCategory: text('classify_category'),
    /** Pipeline state: harvested → (classified → demoed → replied …). */
    status: text('status').notNull().default('harvested'),
    /** The prospect_demos token minted for this sender's branded demo, if any. */
    demoToken: text('demo_token'),
    /** FK-by-value to outreach_emails.id once an in-thread reply is drafted/sent. */
    outreachEmailId: integer('outreach_email_id'),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    // Nullable-unique: PG allows many NULLs, so message-less emails don't collide
    // while a present Message-ID dedupes an idempotent re-harvest.
    uniqueIndex('inbound_prospects_message_id_idx').on(t.originalMessageId),
  ]
);

// ────────────────────────────────────────────────────────────────────
// OUTREACH EMAILS — persisted AI-drafted cold emails (Phase 2 of the
// AI Outreach Engine). Each row is a reviewed-before-send draft: the
// personalized subject/body plus the per-recipient unsubscribe token so
// CASL/CAN-SPAM opt-out works and Phase 3 can send the exact draft a human
// approved. Like prospect_demos, this NEVER touches tenants/users/leads.
// ────────────────────────────────────────────────────────────────────
export const outreachEmails = pgTable(
  'outreach_emails',
  {
    id: serial('id').primaryKey(),
    /** The prospect_demos token this email links to (their branded demo). */
    demoToken: text('demo_token'),
    /** Normalized apex/host the email was drafted for. */
    domain: text('domain').notNull(),
    /** Best-known recipient email (may be null until a contact is chosen). */
    recipientEmail: text('recipient_email'),
    /** Per-recipient unsubscribe token used in the one-click opt-out link (UNIQUE). */
    unsubscribeToken: text('unsubscribe_token').notNull(),
    subject: text('subject').notNull(),
    bodyHtml: text('body_html').notNull(),
    bodyText: text('body_text').notNull(),
    /** True when the AI wrote the copy; false when the template fallback was used. */
    aiGenerated: boolean('ai_generated').notNull().default(false),
    /** Set true when the recipient clicks unsubscribe — Phase 3 must not send. */
    suppressed: boolean('suppressed').notNull().default(false),
    suppressedAt: timestamp('suppressed_at', { mode: 'date' }),
    // ── Phase 3 send + sequence + tracking ──────────────────────────────
    /** When the email was actually handed to the provider (null until sent). */
    sentAt: timestamp('sent_at', { mode: 'date' }),
    /** Send outcome: null (draft) | 'sent' | 'failed' | 'skipped' | 'unconfigured'. */
    status: text('status'),
    /** Provider message id on a successful send (Resend id, etc.). */
    providerId: text('provider_id'),
    /** Human-readable failure summary on a failed send (never a secret value). */
    sendError: text('send_error'),
    /** Sequence step 1..3 — only step 1 is sent today; follow-ups are a scaffold. */
    step: integer('step').notNull().default(1),
    /** When a future scheduled follow-up may fire (null = none queued). */
    nextFollowupAt: timestamp('next_followup_at', { mode: 'date' }),
    /** First time the CTA/demo link was clicked through the tracking route. */
    clickedAt: timestamp('clicked_at', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('outreach_emails_unsub_token_idx').on(t.unsubscribeToken),
    index('outreach_emails_domain_idx').on(t.domain),
  ]
);

// ────────────────────────────────────────────────────────────────────
// BROKER LEADS — FMCSA property-broker prospect list (outreach pipeline).
//
// Each row is one active US freight BROKER ingested from FMCSA's free public
// data: the L&I / Licensing-&-Insurance Carrier file supplies the operating
// authority (broker_stat='A' + property_chk='Y') and the docket/MC number, and
// the Company Census file supplies the e-mail address + power units. Populated
// by scripts/ingestFmcsaCensus.ts and read/written ONLY through
// src/server/outreach/leadStore.ts.
//
// Like prospect_demos / inbound_prospects / outreach_emails, this table is
// DELIBERATELY ISOLATED: it NEVER references tenants / users / the tenant-scoped
// `leads` table, so an outreach prospect stays out of MRR, trials, quota, and
// every tenant list by construction. (Named `broker_leads`, not `leads`, because
// `leads` above is the tenant-scoped end-customer quote-request table.)
//
//   mc_number        — L&I docket_number (e.g. "MC012892"); UNIQUE dedupe key.
//   dot_number       — USDOT number (census/L&I join key, leading zeros stripped).
//   legal_name/dba   — from L&I / census.
//   phone, addr_*    — physical business contact from L&I/census.
//   census_email     — email_address from the Census file (may be null).
//   resolved_domain  — apex resolved from the email / a later web step (null now).
//   resolved_email   — best send-to address after resolution (null now).
//   email_source     — where resolved_email came from ('census' | 'web' | …).
//   email_verified   — set once an address passes verification (false until then).
//   power_units      — census power_units (fleet-size proxy).
//   segment          — 'broker' (this ingest); reserved for future segments.
//   demo_token       — prospect_demos token minted for this lead, if any.
//   outreach_email_id— FK-by-value to outreach_emails.id once a draft exists.
//   status           — pipeline state (default 'new').
// ────────────────────────────────────────────────────────────────────
export const brokerLeads = pgTable(
  'broker_leads',
  {
    id: serial('id').primaryKey(),
    /** L&I docket number (e.g. "MC012892") — UNIQUE dedupe key for re-runs. */
    mcNumber: text('mc_number'),
    /** USDOT number, leading zeros stripped so it joins census ⇄ L&I. */
    dotNumber: text('dot_number'),
    legalName: text('legal_name').notNull(),
    dbaName: text('dba_name'),
    phone: text('phone'),
    addrStreet: text('addr_street'),
    addrCity: text('addr_city'),
    addrState: text('addr_state'),
    addrZip: text('addr_zip'),
    /** Email captured from the FMCSA Census file (`email_address`); may be null. */
    censusEmail: text('census_email'),
    /** Apex domain resolved from the email / a later enrichment step. */
    resolvedDomain: text('resolved_domain'),
    /** Best send-to address after resolution (null until an outreach phase runs). */
    resolvedEmail: text('resolved_email'),
    /** Provenance of resolvedEmail: 'census' | 'web' | 'manual' | … */
    emailSource: text('email_source'),
    emailVerified: boolean('email_verified').notNull().default(false),
    /** Census power_units — a fleet-size proxy. */
    powerUnits: integer('power_units'),
    segment: text('segment').notNull().default('broker'),
    /** prospect_demos token minted for this lead's branded demo, if any. */
    demoToken: text('demo_token'),
    /** FK-by-value to outreach_emails.id once a draft/send exists. */
    outreachEmailId: integer('outreach_email_id'),
    status: text('status').notNull().default('new'),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    // Nullable-unique: PG allows many NULLs, so a lead without an MC number
    // doesn't collide, while a present MC number dedupes an idempotent re-ingest.
    uniqueIndex('broker_leads_mc_number_idx').on(t.mcNumber),
  ]
);

// ────────────────────────────────────────────────────────────────────
// CARRIER DIRECTORY — public, browsable US motor-carrier directory.
//
// Every row is one ACTIVE US motor CARRIER with operating authority
// (common and/or contract, property) ingested from FMCSA's free public
// data by scripts/ingestFmcsaCarriers.ts:
//   - L&I Carrier file (6eyk-hxee) supplies authority (common_stat /
//     contract_stat = 'A' + property_chk = 'Y'), the docket/MC number and
//     the physical business address.
//   - Company Census file (az4n-8mr2) supplies power_units, total_drivers,
//     safety_rating, and the cargo-classification flags — notably
//     crgo_intermodal ('X') which marks container/drayage carriers.
//
// UNLIKE broker_leads (a private outreach prospect list), this table backs
// PUBLIC directory pages, so it carries a derived `nearest_port_code`
// (ZIP → nearest major US container port) and a unique `public_slug`.
// It is platform-level: no tenantId, no reference to tenants / users /
// leads, so it never touches MRR, trials, or any tenant list.
// ────────────────────────────────────────────────────────────────────
export const carrierDirectory = pgTable(
  'carrier_directory',
  {
    id: serial('id').primaryKey(),
    /** USDOT number, leading zeros stripped — UNIQUE identity + dedupe key. */
    usdot: text('usdot').notNull(),
    /** L&I docket number (e.g. "MC012892"); may be null / non-MC prefix. */
    mcNumber: text('mc_number'),
    legalName: text('legal_name').notNull(),
    dbaName: text('dba_name'),
    city: text('city'),
    /** Two-letter physical state/province (upper-cased); the primary browse facet. */
    state: text('state'),
    /**
     * Domicile country: 'US' (default) or 'CA'. Defaults 'US' so every existing
     * + newly-ingested US row is unchanged; Canadian carriers (gated behind the
     * ingest's includeCanada flag) are tagged 'CA'. Keeps the North-America
     * directory country-partitioned without disturbing the live US-only browse.
     */
    country: text('country').notNull().default('US'),
    zip: text('zip'),
    phone: text('phone'),
    /** Census email_address (normalized lower-case); null until a re-ingest populates it. */
    email: text('email'),
    /**
     * Carrier opt-out flag. When true the public profile hides BOTH phone and
     * email (a carrier emailed us to hide their contact details). Defaults false.
     * NEVER overwritten by the ingest upsert — a carrier who opted out stays
     * hidden across every future re-ingest.
     */
    contactHidden: boolean('contact_hidden').notNull().default(false),
    /** Census power_units — fleet size. */
    powerUnits: integer('power_units'),
    /** Census total_drivers. */
    drivers: integer('drivers'),
    /** Census safety_rating: 'S' satisfactory / 'C' conditional / 'U' unsatisfactory / null unrated. */
    safetyRating: text('safety_rating'),
    /** 'common' | 'contract' | 'common,contract' — from L&I *_stat flags. */
    authorityType: text('authority_type'),
    /** Census crgo_intermodal === 'X' — container/drayage carrier flag. */
    intermodal: boolean('intermodal').notNull().default(false),
    /** Census hm_ind === 'Y' — FMCSA-registered hazmat carrier. Defaults false so
     *  every existing row is unchanged until re-ingested (self-healed in migrate.ts). */
    hazmat: boolean('hazmat').notNull().default(false),
    // ── Equipment / cargo-type flags from the FMCSA census crgo_* columns
    //    (0049_carrier_equipment.sql). All default false so existing rows stay
    //    valid until a re-ingest backfills them; self-healed in migrate.ts.
    /** crgo_genfreight === 'X' — dry van / general freight. */
    dryVan: boolean('dry_van').notNull().default(false),
    /** crgo_coldfood === 'X' — reefer / temperature-controlled. */
    reefer: boolean('reefer').notNull().default(false),
    /** crgo_liqgas OR crgo_chem === 'X' — tanker (bulk liquids/gas/chemicals). */
    tanker: boolean('tanker').notNull().default(false),
    /** crgo_metalsheet OR crgo_machlrg OR crgo_logpole === 'X' — flatbed / oversized. */
    flatbed: boolean('flatbed').notNull().default(false),
    /** crgo_drybulk === 'X' — dry bulk. */
    dryBulk: boolean('dry_bulk').notNull().default(false),
    // ── Additional FMCSA cargo-CLASS specialties from the census crgo_* columns
    //    (0050_carrier_cargo_classes.sql). Shipper-relevant specialties beyond the
    //    equipment flags above. All default false so existing rows stay valid until
    //    a re-ingest backfills them; self-healed in migrate.ts.
    /** crgo_household === 'X' — household goods / HHG. */
    householdGoods: boolean('household_goods').notNull().default(false),
    /** crgo_beverages === 'X' — liquor / beverages. */
    beverages: boolean('beverages').notNull().default(false),
    /** crgo_produce === 'X' — fresh produce. */
    produce: boolean('produce').notNull().default(false),
    /** crgo_motoveh === 'X' — motor vehicles. */
    motorVehicles: boolean('motor_vehicles').notNull().default(false),
    /** crgo_livestock === 'X' — livestock. */
    livestock: boolean('livestock').notNull().default(false),
    /** crgo_grainfeed === 'X' — grain & feed. */
    grainFeed: boolean('grain_feed').notNull().default(false),
    /** crgo_oilfield === 'X' — oilfield equipment / supplies. */
    oilfield: boolean('oilfield').notNull().default(false),
    /** crgo_meat === 'X' — meat / perishable. */
    meat: boolean('meat').notNull().default(false),
    /** crgo_paperprod === 'X' — paper products. */
    paper: boolean('paper').notNull().default(false),
    /** crgo_construct === 'X' — construction. */
    construction: boolean('construction').notNull().default(false),
    /** crgo_farmsupp === 'X' — farm supplies. */
    farmSupplies: boolean('farm_supplies').notNull().default(false),
    /** crgo_coalcoke === 'X' — coal / coke. */
    coalCoke: boolean('coal_coke').notNull().default(false),
    /** crgo_bldgmat === 'X' — building materials. */
    buildingMaterials: boolean('building_materials').notNull().default(false),
    /** Derived: nearest major container/rail hub UN/LOCODE (ZIP centroid). */
    nearestPortCode: text('nearest_port_code'),
    /** Unique URL slug for the public carrier page (slug(name)-usdot). */
    publicSlug: text('public_slug').notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('carrier_directory_usdot_idx').on(t.usdot),
    uniqueIndex('carrier_directory_slug_idx').on(t.publicSlug),
    index('carrier_directory_state_idx').on(t.state),
    index('carrier_directory_port_idx').on(t.nearestPortCode),
  ]
);

/**
 * PRECOMPUTED global directory aggregates — a single-row table that removes the
 * ~330k-row `carrier_directory` scan from the /directory request path.
 *
 * WHY THIS EXISTS: the directory index page's `summary` (per-state / per-port /
 * intermodal totals) and its UNFILTERED base `facet counts` are IDENTICAL for
 * every visitor and only change on the weekly FMCSA ingest. Computing them on
 * the request path (even single-flighted + cached) meant that after every
 * deploy/restart a cold-cache burst of concurrent /directory hits stampeded the
 * small Neon compute + connection pool and took ALL QuoteFleet domains down
 * (every request hanging → HTTP 000). Persisting the two global aggregates lets
 * the request path serve them from a single-row PK lookup and NEVER run the
 * heavy scan itself; it is (re)populated OFF the request path by the FMCSA
 * ingest, the weekly refresh cron, and a lazy boot check (see
 * src/server/directory/aggregateCache.ts). FILTERED facet combos still compute
 * live (rare + already capped by the aggregate limiter/timeout).
 *
 * Single row, pinned at id=1 (SINGLETON_ID). Self-healed on every boot via
 * ensureSelfHealTables() (Replit skips db:migrate), so a phantom-drop just loses
 * a cache that the next ingest/cron/boot recomputes — never any real data.
 */
export const directoryAggregateCache = pgTable('directory_aggregate_cache', {
  /** Pinned singleton key — always 1. There is at most one row. */
  id: integer('id').primaryKey(),
  /** Precomputed global DirectorySummary (JSON) — see queries.ts. */
  summary: jsonb('summary').$type<DirectorySummaryJson>().notNull(),
  /** Precomputed UNFILTERED FacetCounts (JSON) — the /directory index base case. */
  baseFacets: jsonb('base_facets').$type<FacetCountsJson>().notNull(),
  /** When these aggregates were last recomputed (staleness clock for the boot check). */
  computedAt: timestamp('computed_at', { mode: 'date' }).notNull().defaultNow(),
});

export type DirectoryAggregateCacheRow = typeof directoryAggregateCache.$inferSelect;

/**
 * Persistent cache of ImportYeti bill-of-lading result sets for the Importer
 * Search feature (/importers). ImportYeti's ToS permits storing AND reselling
 * the purchased data, so this is a deliberate, licensed strategic asset — and a
 * hard cost guard: a repeat search inside the TTL spends ZERO external credits.
 *
 * Keyed by a stable hash of the pull-affecting filters (entry_port + hs/product
 * + supplier_country + page_size, normalized). ALWAYS read by the UNIQUE index
 * on `search_key` — never a table scan (we just had repeated prod outages from
 * unbounded scans). A phantom-drop loses only a re-fetchable cache, never real
 * data; self-healed on every boot (Replit skips db:migrate).
 */
export const importerBolCache = pgTable(
  'importer_bol_cache',
  {
    id: serial('id').primaryKey(),
    /** sha256 hex of the normalized pull filters — the lookup key. */
    searchKey: text('search_key').notNull(),
    /** The raw ImportYeti BOL rows (JSON array). */
    rows: jsonb('rows').$type<Record<string, unknown>[]>().notNull(),
    /** Last-known ImportYeti credit balance (informational). */
    creditsRemaining: integer('credits_remaining'),
    /** Staleness clock — rows older than the 14-day TTL trigger a refetch. */
    fetchedAt: timestamp('fetched_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => ({
    searchKeyIdx: uniqueIndex('importer_bol_cache_key_idx').on(t.searchKey),
  }),
);
export type ImporterBolCacheRow = typeof importerBolCache.$inferSelect;

/**
 * Persistent cache of resolved decision-maker / role-based contacts for the
 * Importer Search reveal path, keyed by a normalized company key (basename).
 * A cache hit inside the TTL spends ZERO Hunter credits. Negative results are
 * cached too (contact NULL, confidence='phone_only') so a fruitless lookup is
 * not repeated. ALWAYS read by the UNIQUE index on `company_key` — never a scan.
 */
export const importerContactCache = pgTable(
  'importer_contact_cache',
  {
    id: serial('id').primaryKey(),
    /** Normalized company basename — the lookup key. */
    companyKey: text('company_key').notNull(),
    /** Resolved domain, if any. */
    domain: text('domain'),
    /** Confidence tier: 'verified' | 'role_based' | 'phone_only'. */
    confidence: text('confidence').notNull(),
    /** The resolved contact payload (JSON) — NULL for a phone-only/negative hit. */
    contact: jsonb('contact').$type<Record<string, unknown> | null>(),
    /** Staleness clock — older than the 14-day TTL triggers a re-resolve. */
    fetchedAt: timestamp('fetched_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => ({
    companyKeyIdx: uniqueIndex('importer_contact_cache_key_idx').on(t.companyKey),
  }),
);
export type ImporterContactCacheRow = typeof importerContactCache.$inferSelect;

/**
 * Self-declared carrier capabilities stored on a `carrier_overrides` row.
 *
 * Each flag flips the matching profile credential badge from the muted "claim
 * to add" affordance to an ACTIVE solid badge — but the badge stays labeled
 * "Self-declared." in its tooltip (these are NOT FMCSA-verified). The keys
 * intentionally match the `tone` ids of SELF_DECLARED_CREDENTIALS in
 * src/server/directory/pages.ts so the merge maps one-to-one.
 */
export interface CarrierCapabilities {
  uiia?: boolean;
  twic?: boolean;
  bonded?: boolean;
  reefer?: boolean;
  transload?: boolean;
  yard?: boolean;
}

/**
 * One carrier-DECLARED operating city/terminal metro, stored on a
 * `carrier_overrides` row's `operating_locations` array.
 *
 * FMCSA public data gives a carrier ONE physical HQ location; a claimed carrier
 * declares the additional metros it actually serves via the override system, and
 * the profile renders them as an "Also operating in" list. Never fabricated —
 * only what the carrier has declared. `state` is a 2-letter US/CA code.
 */
export interface CarrierOperatingLocation {
  city: string;
  /** Two-letter US state / CA province code (upper-cased). */
  state: string;
}

/**
 * Human-editable OVERRIDES for a carrier card, keyed by USDOT.
 *
 * PROVENANCE LAYER. The nightly FMCSA re-ingest rewrites `carrier_directory`
 * (see CARRIER_UPSERT_SET in carrierIngest.ts) but NEVER touches this table, so
 * any admin/carrier edit here PERSISTS across every re-ingest — the same
 * survive-the-ingest guarantee already proven by `carrier_directory.contact_hidden`,
 * lifted out into a dedicated table so we can edit ANY card field (not just the
 * opt-out) without the ingest clobbering it.
 *
 * Every column is nullable: a NULL override means "no override — fall back to
 * the FMCSA value". The merge layer (src/server/directory/queries.ts) LEFT JOINs
 * this table on the profile read and applies the non-null overrides, tagging
 * each field's provenance so the card can tell FMCSA-sourced from admin-edited.
 * Only the profile (carrierBySlug) merges overrides today; list/card queries are
 * unchanged.
 */
export const carrierOverrides = pgTable('carrier_overrides', {
  /** USDOT (leading zeros stripped, same normalization as carrier_directory.usdot). */
  usdot: text('usdot').primaryKey(),
  /** Replaces the auto-generated FMCSA "About" prose when present. */
  aboutOverride: text('about_override'),
  /** Replaces the FMCSA census email on the profile when present. */
  emailOverride: text('email_override'),
  /** Replaces the FMCSA census phone on the profile when present. */
  phoneOverride: text('phone_override'),
  /** When true, hides public contact on the profile (OR'd with the FMCSA opt-out). */
  hidden: boolean('hidden'),
  /** Self-declared credentials (UIIA / TWIC / bonded / reefer / transload / yard). */
  capabilities: jsonb('capabilities').$type<CarrierCapabilities>(),
  /** Carrier-declared OTHER operating cities/terminals (metros beyond the single
   *  FMCSA HQ). JSONB array of `{ city, state }`; null = none declared. Rendered
   *  as the profile's "Also operating in" list — never fabricated. */
  operatingLocations: jsonb('operating_locations').$type<CarrierOperatingLocation[]>(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
  /** Actor identity (admin email / user id) that last wrote this override. */
  updatedBy: text('updated_by'),
});

// ────────────────────────────────────────────────────────────────────
// DIRECTORY_TERMINALS — canonical, PLATFORM-LEVEL reference list of major
// North-American intermodal terminal metros (coastal SEAPORT gateways +
// inland RAIL intermodal metros). Distinct from the tenant-scoped `terminals`
// table above (which lists the individual berths/ramps a specific carrier
// serves): this one is a single global browse facet for the public carrier
// directory, seeded from src/server/directory/terminals.ts. No tenantId — like
// carrier_directory it never references tenants / users / leads, so it stays
// out of MRR, trials, and every tenant list by construction.
// ────────────────────────────────────────────────────────────────────
export const directoryTerminals = pgTable(
  'directory_terminals',
  {
    id: serial('id').primaryKey(),
    /** UN/LOCODE (seaport) or `INL`-prefixed inland-rail code. UNIQUE identity. */
    code: text('code').notNull(),
    name: text('name').notNull(),
    city: text('city').notNull(),
    /** Two-letter US state / CA province (upper-cased); the primary browse facet. */
    state: text('state').notNull(),
    /** Domicile country: 'US' or 'CA'. */
    country: text('country').notNull().default('US'),
    /** 'seaport' (coastal container gateway) | 'rail' (inland rail intermodal metro). */
    type: text('type').notNull(),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    /** Primary-facility street address for the metro's anchor terminal — the
     *  specific marine terminal / rail ramp (e.g. "Garden City Terminal, 2 Main
     *  St, Garden City, GA 31408"). Nullable: some inland metros are seeded as a
     *  multi-carrier anchor with no single facility address. Lets calculators
     *  auto-fill a real terminal address from a port/hub code. */
    address: text('address'),
    /** Port-authority / Class-I rail operator of the anchor facility (e.g.
     *  "Georgia Ports Authority", "BNSF / UP / NS / CSX"). Nullable. */
    operator: text('operator'),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('directory_terminals_code_idx').on(t.code),
    index('directory_terminals_country_idx').on(t.country),
    index('directory_terminals_type_idx').on(t.type),
  ]
);

// ────────────────────────────────────────────────────────────────────
// MULTI-CARRIER RFQ (rate request) — the "beat LoadMatch" flow. A shipper
// filters carriers in the public directory, then sends ONE rate request that
// fans out to every filtered/selected carrier and collects quotes back in one
// place. PLATFORM-LEVEL (no tenantId — this lives on the public directory
// surface, not inside a tenant workspace), exactly like carrier_directory.
//
// Tokens (view_token on a request, quote_token per recipient) are unguessable
// (nanoid, 32 chars) — they ARE the auth for the shipper's responses page and
// each carrier's private quote page, so no login is required for either side.
// ────────────────────────────────────────────────────────────────────
export const rfqRequests = pgTable(
  'rfq_requests',
  {
    id: serial('id').primaryKey(),
    /** Unguessable token — the shipper's private responses link (/directory/rfq/:viewToken). */
    viewToken: text('view_token').notNull(),
    shipperName: text('shipper_name').notNull(),
    shipperCompany: text('shipper_company'),
    shipperEmail: text('shipper_email').notNull(),
    shipperPhone: text('shipper_phone'),
    origin: text('origin').notNull(),
    destination: text('destination').notNull(),
    /** Equipment id/label (e.g. 'reefer', 'flatbed', 'drayage'). */
    equipment: text('equipment'),
    /** Container type when drayage/intermodal (e.g. "40ft HC"). */
    containerType: text('container_type'),
    commodity: text('commodity'),
    /** Free-text weight (e.g. "42,000 lbs") — kept as text so units survive. */
    weight: text('weight'),
    /** Free-text ready date (e.g. "2026-09-01" or "ASAP"). */
    readyDate: text('ready_date'),
    /** Optional shipper target rate (free-text so "$2,400" / "2400" both work). */
    targetRate: text('target_rate'),
    notes: text('notes'),
    /** The directory selection that generated the recipient set: explicit dots
     *  and/or the normalized filter querystring — recorded for provenance. */
    filterSnapshot: jsonb('filter_snapshot').$type<RfqFilterSnapshot>(),
    /** 'open' | 'closed'. */
    status: text('status').notNull().default('open'),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('rfq_requests_view_token_idx').on(t.viewToken)]
);

export const rfqRecipients = pgTable(
  'rfq_recipients',
  {
    id: serial('id').primaryKey(),
    rfqId: integer('rfq_id').notNull(),
    /** Carrier USDOT (leading zeros stripped, same normalization as carrier_directory). */
    carrierDot: text('carrier_dot').notNull(),
    carrierName: text('carrier_name').notNull(),
    /** Public carrier email at fan-out time; null when the carrier has no email on file. */
    carrierEmail: text('carrier_email'),
    /** 'pending' | 'sent' | 'no_email' | 'opted_out' | 'quoted' | 'failed'. */
    status: text('status').notNull().default('pending'),
    /** AI-drafted (or template) per-carrier email subject, generated in the
     *  review phase and editable by the shipper before send. Null until drafted. */
    draftSubject: text('draft_subject'),
    /** AI-drafted (or template) per-carrier email body — the personalized
     *  "Dear <Company>," letter the shipper reviews/edits, then sends. Null until
     *  drafted; the (possibly-edited) value is what the send path renders. */
    draftBody: text('draft_body'),
    /** Unguessable token — the carrier's private quote page (/directory/rfq/quote/:quoteToken). */
    quoteToken: text('quote_token').notNull(),
    sentAt: timestamp('sent_at', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('rfq_recipients_quote_token_idx').on(t.quoteToken),
    index('rfq_recipients_rfq_idx').on(t.rfqId),
  ]
);

export const rfqQuotes = pgTable(
  'rfq_quotes',
  {
    id: serial('id').primaryKey(),
    rfqId: integer('rfq_id').notNull(),
    recipientId: integer('recipient_id').notNull(),
    carrierDot: text('carrier_dot').notNull(),
    /** Free-text price (e.g. "$2,400") — units/formatting preserved as the carrier typed. */
    price: text('price'),
    transitDays: integer('transit_days'),
    notes: text('notes'),
    /** Free-text quote validity (e.g. "2026-09-15" or "7 days"). */
    validUntil: text('valid_until'),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('rfq_quotes_rfq_idx').on(t.rfqId),
    uniqueIndex('rfq_quotes_recipient_idx').on(t.recipientId),
  ]
);

/** The directory selection that generated an RFQ's recipient set (stored on
 *  rfq_requests.filter_snapshot for provenance / later re-resolution). */
export interface RfqFilterSnapshot {
  /** Explicitly selected carrier USDOTs (the `?dots=` path). */
  dots?: string[];
  /** The directory filter querystring (the `?state=…&equipment=…` path). */
  filterQuery?: string;
}

export type RfqRequest = typeof rfqRequests.$inferSelect;
export type NewRfqRequest = typeof rfqRequests.$inferInsert;
export type RfqRecipient = typeof rfqRecipients.$inferSelect;
export type NewRfqRecipient = typeof rfqRecipients.$inferInsert;
export type RfqQuote = typeof rfqQuotes.$inferSelect;
export type NewRfqQuote = typeof rfqQuotes.$inferInsert;
/** The lifecycle states a recipient row moves through. */
export type RfqRecipientStatus = 'pending' | 'sent' | 'no_email' | 'opted_out' | 'quoted' | 'failed';

// ────────────────────────────────────────────────────────────────────
// Type helpers for use in the rest of the codebase.
// ────────────────────────────────────────────────────────────────────
export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type AccessLink = typeof accessLinks.$inferSelect;
export type NewAccessLink = typeof accessLinks.$inferInsert;
export type RateCard = typeof rateCards.$inferSelect;
export type NewRateCard = typeof rateCards.$inferInsert;
export type Accessorial = typeof accessorials.$inferSelect;
export type NewAccessorial = typeof accessorials.$inferInsert;
export type LaneZone = typeof laneZones.$inferSelect;
export type NewLaneZone = typeof laneZones.$inferInsert;
export type RateZone = typeof rateZones.$inferSelect;
export type NewRateZone = typeof rateZones.$inferInsert;
export type RateMatrix = typeof rateMatrices.$inferSelect;
export type NewRateMatrix = typeof rateMatrices.$inferInsert;
export type Terminal = typeof terminals.$inferSelect;
export type NewTerminal = typeof terminals.$inferInsert;
export type DirectoryTerminal = typeof directoryTerminals.$inferSelect;
export type NewDirectoryTerminal = typeof directoryTerminals.$inferInsert;
export type AiConfig = typeof aiConfigs.$inferSelect;
export type BrandConfig = typeof brandConfigs.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type BrokerLead = typeof brokerLeads.$inferSelect;
export type NewBrokerLead = typeof brokerLeads.$inferInsert;
export type CarrierDirectoryRow = typeof carrierDirectory.$inferSelect;
export type NewCarrierDirectoryRow = typeof carrierDirectory.$inferInsert;
export type CarrierOverrideRow = typeof carrierOverrides.$inferSelect;
export type NewCarrierOverrideRow = typeof carrierOverrides.$inferInsert;
export type CallbackRequest = typeof callbackRequests.$inferSelect;
export type NewCallbackRequest = typeof callbackRequests.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type Port = typeof ports.$inferSelect;
export type OutreachProspect = typeof outreachProspects.$inferSelect;
export type NewOutreachProspect = typeof outreachProspects.$inferInsert;
export type ProspectDemo = typeof prospectDemos.$inferSelect;
export type NewProspectDemo = typeof prospectDemos.$inferInsert;
export type ProspectInbound = typeof inboundProspects.$inferSelect;
export type NewProspectInbound = typeof inboundProspects.$inferInsert;
export type OutreachEmail = typeof outreachEmails.$inferSelect;
export type NewOutreachEmail = typeof outreachEmails.$inferInsert;
export type OutreachCampaign = typeof outreachCampaigns.$inferSelect;
export type OutreachEvent = typeof outreachEvents.$inferSelect;
export type NewOutreachEvent = typeof outreachEvents.$inferInsert;
export type MarketplaceCarrier = typeof marketplaceCarriers.$inferSelect;
export type NewMarketplaceCarrier = typeof marketplaceCarriers.$inferInsert;
export type MarketplaceLane = typeof marketplaceLanes.$inferSelect;
export type NewMarketplaceLane = typeof marketplaceLanes.$inferInsert;
export type MarketplaceRateSnapshot = typeof marketplaceRateSnapshots.$inferSelect;
export type NewMarketplaceRateSnapshot = typeof marketplaceRateSnapshots.$inferInsert;
export type MarketplaceAggregate = typeof marketplaceAggregates.$inferSelect;
export type IngestJob = typeof ingestJobs.$inferSelect;
export type NewIngestJob = typeof ingestJobs.$inferInsert;

// ════════════════════════════════════════════════════════════════════
// AFFILIATE + REFERRAL PROGRAM (Phase 1)
//
// Two related growth programs share these tables:
//   1. REFERRAL (existing tenants → peers, double-sided). Every tenant owns a
//      `tenants.referral_code`; a peer who signs up through
//      `/?ref=<code>` gets the referee reward (30-day trial + intro discount)
//      and the referrer is queued a "1 free month" account credit
//      (referral_credits).
//   2. AFFILIATE (public marketers/creators, tiered recurring cash). Anyone can
//      self-serve register an `affiliates` row (email + minted code) and earn a
//      recurring % commission on customers they refer. A 90-day cookie attributes
//      a click → a signup (referral_attributions), and a phase-2 billing job
//      writes affiliate_commissions rows for payout.
//
// Payouts + the commission-accrual job are PHASE 2 — these tables + the
// self-serve signup + the dashboards are phase 1. See src/server/affiliate/*.
// ════════════════════════════════════════════════════════════════════

// ── AFFILIATES — a partner earning recurring commission on referred tenants. ──
// The owner is EITHER an existing customer (ownerTenantId/ownerUserId set) OR a
// standalone marketer with no QuoteFleet account (both null; identified by
// `email`). `code` is the shareable slug used in `/?ref=<code>`.
export const affiliates = pgTable(
  'affiliates',
  {
    id: serial('id').primaryKey(),
    /** Optional link to an existing tenant (a customer who is also an affiliate). */
    ownerTenantId: integer('owner_tenant_id').references(() => tenants.id, {
      onDelete: 'set null',
    }),
    /** Optional link to a specific user account. */
    ownerUserId: integer('owner_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** Contact/login email — always set (the standalone affiliate's identity). */
    email: text('email').notNull(),
    /** Optional display / payout name. */
    name: text('name'),
    /** Unique short code used in the referral link (`/?ref=<code>`). */
    code: text('code').notNull().unique(),
    /** Commission tier: 'base' (25%) | 'pro' (30% for 12mo once 10+ active) |
     *  'partner' (negotiated lifetime % for top partners). */
    tier: text('tier').notNull().default('base'),
    /** Current commission rate as a fraction (0.25 = 25%). Denormalized from
     *  `tier` so a phase-2 billing job reads one authoritative number, and a
     *  hand-negotiated 'partner' rate can differ from the tier default. */
    commissionRate: doublePrecision('commission_rate').notNull().default(0.25),
    /** Lifecycle: 'pending' (self-registered, not yet approved) | 'active' |
     *  'suspended'. */
    status: text('status').notNull().default('pending'),
    /** How the affiliate wants to be paid: 'paypal' | 'stripe' | 'bank' | null. */
    payoutMethod: text('payout_method'),
    /** Free-form payout target (PayPal email, etc.). Nullable until they set it. */
    payoutDetails: text('payout_details'),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('affiliates_code_idx').on(t.code),
    index('affiliates_email_idx').on(t.email),
    index('affiliates_owner_tenant_idx').on(t.ownerTenantId),
  ]
);

// ── REFERRAL ATTRIBUTIONS — one click of a `?ref=<code>` link. ──────────────
// Written when a visitor lands with `?ref` (or `/r/:code`); `referredTenantId`
// is filled in on signup, `convertedAt` when that tenant becomes paying.
export const referralAttributions = pgTable(
  'referral_attributions',
  {
    id: serial('id').primaryKey(),
    /** The referral/affiliate code that was clicked (tenants.referral_code OR
     *  affiliates.code). Denormalized so the row survives even if the code is
     *  later rotated. */
    code: text('code').notNull(),
    /** Which program the code belonged to at capture: 'referral' (a tenant's
     *  peer code) | 'affiliate' (a public affiliate) | 'unknown'. */
    kind: text('kind').notNull().default('unknown'),
    /** The tenant that signed up through this click — null until signup links it. */
    referredTenantId: integer('referred_tenant_id').references(() => tenants.id, {
      onDelete: 'set null',
    }),
    /** Opaque per-visitor token stored in the `qf_ref` cookie; dedupes repeat
     *  clicks from the same browser before signup. */
    visitorToken: text('visitor_token').notNull(),
    landedAt: timestamp('landed_at', { mode: 'date' }).notNull().defaultNow(),
    /** When the referred tenant converted to a PAYING subscription (phase-2
     *  billing job). Null while trialing / free. */
    convertedAt: timestamp('converted_at', { mode: 'date' }),
    /** Reward pipeline state: 'pending' (click only) | 'signed_up' (linked to a
     *  tenant, referee reward applied, referrer credit queued) | 'converted'
     *  (tenant paying) | 'rewarded' (referrer credit granted) | 'ignored'
     *  (self-referral / invalid). */
    rewardStatus: text('reward_status').notNull().default('pending'),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('referral_attributions_code_idx').on(t.code),
    index('referral_attributions_tenant_idx').on(t.referredTenantId),
    index('referral_attributions_visitor_idx').on(t.visitorToken),
  ]
);

// ── REFERRAL CREDITS — the "1 free month" reward owed to a REFERRER. ─────────
// Queued (appliedAt null) when a referred peer signs up; a phase-2 billing job
// grants the free month (sets appliedAt + status 'applied') once the referee is
// paying.
export const referralCredits = pgTable(
  'referral_credits',
  {
    id: serial('id').primaryKey(),
    /** The REFERRER tenant that earns the free month. */
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** The attribution that produced this credit. */
    sourceAttributionId: integer('source_attribution_id').references(
      () => referralAttributions.id,
      { onDelete: 'set null' }
    ),
    /** How many free months this credit grants (default 1). */
    monthsGranted: integer('months_granted').notNull().default(1),
    /** 'pending' (queued, awaiting referee payment) | 'applied' | 'void'. */
    status: text('status').notNull().default('pending'),
    /** When the free month was actually applied to the referrer's subscription
     *  (phase-2). Null while pending. */
    appliedAt: timestamp('applied_at', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('referral_credits_tenant_idx').on(t.tenantId),
    index('referral_credits_status_idx').on(t.status),
  ]
);

// ── AFFILIATE COMMISSIONS — monthly accrual per referred customer. ──────────
// Created by a PHASE-2 billing job (one row per affiliate × referred tenant ×
// billing month). Created empty in phase 1 so the schema + payout dashboard
// seam exists; nothing writes to it yet.
export const affiliateCommissions = pgTable(
  'affiliate_commissions',
  {
    id: serial('id').primaryKey(),
    affiliateId: integer('affiliate_id')
      .notNull()
      .references(() => affiliates.id, { onDelete: 'cascade' }),
    /** The referred paying tenant this commission is for. */
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Billing month, 'YYYY-MM'. One accrual row per affiliate/tenant/month. */
    periodMonth: text('period_month').notNull(),
    /** Commission amount in cents (integer money — never floats for payouts). */
    amountCents: integer('amount_cents').notNull().default(0),
    /** Rate applied for this row (fraction), snapshotted for audit. */
    rate: doublePrecision('rate').notNull().default(0.25),
    /** 'pending' (accrued) | 'approved' (cleared for payout) | 'paid'. */
    status: text('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('affiliate_commissions_affiliate_idx').on(t.affiliateId),
    index('affiliate_commissions_tenant_idx').on(t.tenantId),
    uniqueIndex('affiliate_commissions_uniq_idx').on(t.affiliateId, t.tenantId, t.periodMonth),
  ]
);

export type Affiliate = typeof affiliates.$inferSelect;
export type NewAffiliate = typeof affiliates.$inferInsert;
export type ReferralAttribution = typeof referralAttributions.$inferSelect;
export type NewReferralAttribution = typeof referralAttributions.$inferInsert;
export type ReferralCredit = typeof referralCredits.$inferSelect;
export type NewReferralCredit = typeof referralCredits.$inferInsert;
export type AffiliateCommission = typeof affiliateCommissions.$inferSelect;
export type NewAffiliateCommission = typeof affiliateCommissions.$inferInsert;

// ────────────────────────────────────────────────────────────────────
// DIRECTORY SUBSCRIPTIONS — "Directory Pro" ($19/mo) per-SHIPPER entitlement.
//
// The buyer is a SHIPPER persona: a `users` row with `tenantId = null` and
// `role = 'shipper'` (reusing the existing auth/session stack). This table is
// FULLY DECOUPLED from `tenants.plan` — Directory Pro is an access subscription
// on a user account, NOT the QuoteQuick calculator tenant's plan. One row per
// user (userId UNIQUE). The Stripe webhook (applyDirectorySubscription) upserts
// this by `stripe_customer_id`; entitlement is `status IN ('active','trialing')`
// AND (`current_period_end IS NULL OR > now`).
//
// Platform-level like carrier_directory: it references `users` only, never
// `tenants`, so a Directory Pro subscription stays out of tenant MRR/plan/trial
// by construction. Self-healed in src/db/migrate.ts (Replit skips db:migrate).
// ────────────────────────────────────────────────────────────────────
export const directorySubscriptions = pgTable(
  'directory_subscriptions',
  {
    id: serial('id').primaryKey(),
    /** The shipper user this entitlement belongs to. One row per user. */
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 'active' | 'trialing' | 'past_due' | 'inactive'. Default 'inactive'
     *  until the Stripe webhook confirms a live subscription. */
    status: text('status').notNull().default('inactive'),
    /** Stripe Customer id — the join key the webhook upserts by. UNIQUE. */
    stripeCustomerId: text('stripe_customer_id'),
    /** Stripe Subscription id (kept for portal / reference). */
    stripeSubscriptionId: text('stripe_subscription_id'),
    /** The Stripe Price id ($19/mo Directory Pro price) on the subscription. */
    priceId: text('price_id'),
    /** Current billing period end — entitlement lapses after this when the
     *  subscription is no longer live. Null when unknown. */
    currentPeriodEnd: timestamp('current_period_end', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('directory_subscriptions_user_idx').on(t.userId),
    uniqueIndex('directory_subscriptions_customer_idx').on(t.stripeCustomerId),
  ]
);

export type DirectorySubscription = typeof directorySubscriptions.$inferSelect;
export type NewDirectorySubscription = typeof directorySubscriptions.$inferInsert;
/** The lifecycle states a Directory Pro subscription moves through. */
export type DirectorySubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'inactive';

/**
 * directory_rfq_usage — per-account monthly RFQ (rate-request) send meter.
 *
 * The un-gameable meter behind RFQ gating: sending a multi-carrier rate request
 * requires a logged-in shipper account, and each account gets a monthly BLAST
 * allowance (free tier small, Directory Pro larger). One POST /directory/rfq =
 * ONE increment regardless of how many carriers it fans out to.
 *
 *   account_key — the identified account, `user:<id>` (never anonymous — RFQ
 *                 requires an account, so there is always a key to meter on).
 *   period      — the billing month, `YYYY-MM` in UTC.
 *   sends       — blasts started this period (incremented once per blast).
 *
 * UNIQUE(account_key, period) so the counter is a single upsert-and-increment
 * row per account per month. Platform-level (references neither `tenants` nor a
 * FK) so it stays out of tenant MRR/plan by construction — same posture as
 * directory_subscriptions.
 */
export const directoryRfqUsage = pgTable(
  'directory_rfq_usage',
  {
    id: serial('id').primaryKey(),
    /** The identified account this meter belongs to (`user:<id>`). */
    accountKey: text('account_key').notNull(),
    /** Billing period, `YYYY-MM` (UTC). */
    period: text('period').notNull(),
    /** Blasts started this period — one POST /directory/rfq = one increment. */
    sends: integer('sends').notNull().default(0),
  },
  (t) => [uniqueIndex('directory_rfq_usage_account_period_idx').on(t.accountKey, t.period)]
);

export type DirectoryRfqUsage = typeof directoryRfqUsage.$inferSelect;
export type NewDirectoryRfqUsage = typeof directoryRfqUsage.$inferInsert;

// ────────────────────────────────────────────────────────────────────
// CARRIER CONTACTS — cached ENRICHED contacts behind the Directory Pro
// "Reveal additional contacts" button (PR C).
//
// These are the ADDITIONAL / enriched dispatch contacts a Pro reveal turns up
// (scraped from the carrier's own website via `enrichCompany`) — SEPARATE from
// and never a re-tiering of the free FMCSA phone/email on `carrier_directory`.
// The free public contact stays free; nothing here duplicates it (the reveal
// pipeline dedupes any scraped value equal to the census phone/email).
//
// Keyed by normalized USDOT (leading zeros stripped) so it joins the public
// directory without a FK to it. UNIQUE(carrier_dot, email) makes an upsert
// idempotent across re-reveals. Platform-level (no tenant / user FK) like the
// rest of the directory. Self-healed in src/db/migrate.ts (Replit skips
// db:migrate and can phantom-drop tables); a phantom-drop only loses a cache
// that the next reveal re-fills — never any entitlement/billing state.
// ────────────────────────────────────────────────────────────────────
export const carrierContacts = pgTable(
  'carrier_contacts',
  {
    id: serial('id').primaryKey(),
    /** Normalized USDOT (leading zeros stripped) — the join key to carrier_directory. */
    carrierDot: text('carrier_dot').notNull(),
    /** 'enrich' (auto, from the website scrape) | 'manual' (admin-entered). */
    source: text('source').notNull(),
    contactName: text('contact_name'),
    title: text('title'),
    email: text('email'),
    phone: text('phone'),
    /** 'high' | 'low' — confidence in the derived contact. */
    confidence: text('confidence'),
    enrichedAt: timestamp('enriched_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    /** The raw enrichment payload (AI insights / fetch notes) for provenance. */
    rawJson: jsonb('raw_json').$type<Record<string, unknown>>(),
  },
  (t) => [
    uniqueIndex('carrier_contacts_dot_email_idx').on(t.carrierDot, t.email),
    index('carrier_contacts_dot_idx').on(t.carrierDot),
  ]
);

export type CarrierContact = typeof carrierContacts.$inferSelect;
export type NewCarrierContact = typeof carrierContacts.$inferInsert;

// ────────────────────────────────────────────────────────────────────
// CARRIER ENRICHMENT STATE — per-DOT "we already tried" marker.
//
// Records that a USDOT was ATTEMPTED (with how many contacts it yielded) so a
// dead / bot-walled / no-email domain is NOT re-scraped on every reveal. The
// reveal endpoint treats a marker younger than DIRECTORY_ENRICH_TTL_DAYS as
// FRESH and serves the cache (even when that cache is empty), never re-hitting
// the network / AI. One row per carrier_dot (UNIQUE). Self-healed like the rest.
// ────────────────────────────────────────────────────────────────────
export const carrierEnrichmentState = pgTable(
  'carrier_enrichment_state',
  {
    id: serial('id').primaryKey(),
    carrierDot: text('carrier_dot').notNull(),
    attemptedAt: timestamp('attempted_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    /** How many contacts the last attempt yielded (0 = attempted-and-empty). */
    contactCount: integer('contact_count').notNull().default(0),
  },
  (t) => [uniqueIndex('carrier_enrichment_state_dot_idx').on(t.carrierDot)]
);

export type CarrierEnrichmentState = typeof carrierEnrichmentState.$inferSelect;
export type NewCarrierEnrichmentState = typeof carrierEnrichmentState.$inferInsert;

// ────────────────────────────────────────────────────────────────────
// DIRECTORY REVEAL USAGE — per-account DAILY reveal meter (cost governor).
//
// Each FRESH reveal costs 1 AI call + up to 3 HTTP fetches, so a paying Pro
// account is capped at DIRECTORY_REVEAL_DAILY_CAP fresh reveals per UTC day. A
// cached reveal (marker fresh) is free and never increments this. Same
// upsert-and-increment shape as directory_rfq_usage, bucketed by DAY. One row
// per account per day (UNIQUE(account_key, period)). A phantom-drop loses only
// the current day's counts (a bounded, self-refilling meter).
// ────────────────────────────────────────────────────────────────────
export const directoryRevealUsage = pgTable(
  'directory_reveal_usage',
  {
    id: serial('id').primaryKey(),
    /** The identified account this meter belongs to (`user:<id>`). */
    accountKey: text('account_key').notNull(),
    /** Billing bucket, `YYYY-MM-DD` (UTC). */
    period: text('period').notNull(),
    /** Fresh reveals this account has run today — one increment per fresh reveal. */
    reveals: integer('reveals').notNull().default(0),
  },
  (t) => [uniqueIndex('directory_reveal_usage_account_period_idx').on(t.accountKey, t.period)]
);

export type DirectoryRevealUsage = typeof directoryRevealUsage.$inferSelect;
export type NewDirectoryRevealUsage = typeof directoryRevealUsage.$inferInsert;

// ────────────────────────────────────────────────────────────────────
// SAVED LISTS — Directory Pro shippers save carriers into named lists (PR D).
//
// A logged-in SHIPPER (a `users` row, tenant-less, role='shipper') groups
// carriers into named lists and revisits them. Directory Pro feature — the
// entitlement is enforced at the route layer (hasDirectoryPro); the tables
// themselves reference `users` only, never `tenants`, so saved lists stay out of
// tenant MRR/plan by construction (same posture as directory_subscriptions).
//
//   saved_lists       — one row per (user, list name). Indexed by user_id for
//                       the "my lists" query.
//   saved_list_items  — carriers saved into a list, keyed by carrier USDOT (the
//                       carrier_directory identity). UNIQUE(list_id, carrier_dot)
//                       makes an add idempotent; indexed by list_id.
//
// Self-healed in src/db/migrate.ts (Replit skips db:migrate). A phantom-drop
// loses saved lists (user data, not billing state); the CREATE TABLE IF NOT
// EXISTS self-heal re-creates the empty tables on boot.
// ────────────────────────────────────────────────────────────────────
export const savedLists = pgTable(
  'saved_lists',
  {
    id: serial('id').primaryKey(),
    /** The shipper user this list belongs to. */
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The list's display name (trimmed, 1–80 chars; enforced at the route). */
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [index('saved_lists_user_idx').on(t.userId)]
);

export type SavedList = typeof savedLists.$inferSelect;
export type NewSavedList = typeof savedLists.$inferInsert;

export const savedListItems = pgTable(
  'saved_list_items',
  {
    id: serial('id').primaryKey(),
    /** The parent list. Cascade-deleted with the list. */
    listId: integer('list_id')
      .notNull()
      .references(() => savedLists.id, { onDelete: 'cascade' }),
    /** The saved carrier's USDOT (the carrier_directory identity). */
    carrierDot: text('carrier_dot').notNull(),
    addedAt: timestamp('added_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('saved_list_items_list_dot_idx').on(t.listId, t.carrierDot),
    index('saved_list_items_list_idx').on(t.listId),
  ]
);

export type SavedListItem = typeof savedListItems.$inferSelect;
export type NewSavedListItem = typeof savedListItems.$inferInsert;

// ────────────────────────────────────────────────────────────────────
// MANIFEST PRIVACY — the managed CBP vessel-manifest-confidentiality service.
//
// Sold as a QuoteFleet upsell off the importer-profile funnel: an importer who
// finds their exposed customs profile on /importers can pay us to prepare +
// submit a 19 CFR 103.31(d) confidentiality request to CBP on their behalf, and
// we then HIDE them from OUR directory. Four platform-level tables, all
// referencing `users` only (never `tenants`) so they stay out of tenant
// MRR/plan by construction — exactly like directory_subscriptions.
//
// The subscription stack is CLONED from directory_subscriptions (the SHIPPER
// stack), NOT the tenant plans.ts stack. Self-healed in src/db/migrate.ts
// (Replit skips db:migrate + can phantom-drop tables) — a phantom-drop only
// loses a re-derivable meter/cache, never the signed-POA record or its audit
// trail (both are real, retained data, so a drop of poa_applications is a
// genuine data-loss event the self-heal CREATE re-establishes the shape for).
// ────────────────────────────────────────────────────────────────────

/** Manifest Privacy subscription — clone of directory_subscriptions plus a
 *  `tier` (basic|professional|enterprise) and `entity_quota`. One row per user. */
export const manifestSubscriptions = pgTable(
  'manifest_subscriptions',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 'basic' | 'professional' | 'enterprise' — the plan bought. */
    tier: text('tier').notNull().default('basic'),
    /** 'active' | 'trialing' | 'past_due' | 'inactive'. */
    status: text('status').notNull().default('inactive'),
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    priceId: text('price_id'),
    currentPeriodEnd: timestamp('current_period_end', { mode: 'date' }),
    /** How many distinct legal entities this plan may protect (1 for Basic;
     *  higher for Professional/Enterprise multi-entity). */
    entityQuota: integer('entity_quota').notNull().default(1),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('manifest_subscriptions_user_idx').on(t.userId),
    uniqueIndex('manifest_subscriptions_customer_idx').on(t.stripeCustomerId),
  ]
);

export type ManifestSubscription = typeof manifestSubscriptions.$inferSelect;
export type NewManifestSubscription = typeof manifestSubscriptions.$inferInsert;
export type ManifestTier = 'basic' | 'professional' | 'enterprise';
export type ManifestSubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'inactive';

/**
 * POA applications — the in-house e-signed Limited Power of Attorney authorizing
 * QuoteFleet to file the CBP confidentiality request. This is the RETAINED,
 * reproducible ESIGN/UETA record: consent + typed/drawn signature + IP/UA/UTC +
 * the SHA-256 of the generated PDF. Status walks Draft → Signed → Submitted →
 * Confirmed → Active → Renewal due (honest-status vocabulary; never shows
 * "Hidden/Protected" before CBP confirms).
 *
 * `docs` is a free-form bag for uploaded supporting documents — it is stamped
 * ONLY with "on file" / "self-reported" flags, NEVER a "verified" claim (FTC §5).
 */
export const poaApplications = pgTable(
  'poa_applications',
  {
    id: serial('id').primaryKey(),
    /** Unguessable nanoid — the soft-auth handle for the public onboarding flow
     *  (like an importer profile's public token). UNIQUE. */
    publicToken: text('public_token').notNull(),
    /** The owning shipper user once they sign in / subscribe; null for an
     *  anonymous draft (a free visitor can build + e-sign one POA). */
    userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** draft | signed | submitted | confirmed | active | renewal_due | expired | revoked */
    status: text('status').notNull().default('draft'),
    grantorLegalName: text('grantor_legal_name'),
    entityType: text('entity_type'),
    stateOfOrg: text('state_of_org'),
    grantorAddress: text('grantor_address'),
    einOrImporterNo: text('ein_or_importer_no'),
    /** The name variations to protect — the product differentiator; captured
     *  liberally. string[]. */
    nameVariations: jsonb('name_variations').$type<string[]>(),
    addressVariations: jsonb('address_variations').$type<string[]>(),
    /** The /importers directory slug this POA was started from (for redaction). */
    importerSlug: text('importer_slug'),
    signerName: text('signer_name'),
    signerTitle: text('signer_title'),
    signerEmail: text('signer_email'),
    /** Version tag of the consent + ESIGN disclosure the signer accepted. */
    consentDisclosureVersion: text('consent_disclosure_version'),
    /** Typed legal name entered as the e-signature. */
    signatureTyped: text('signature_typed'),
    /** Drawn-signature canvas as a data: PNG (base64). */
    signatureDrawnPng: text('signature_drawn_png'),
    signedAt: timestamp('signed_at', { withTimezone: true, mode: 'date' }),
    signerIp: text('signer_ip'),
    signerUa: text('signer_ua'),
    /** SHA-256 (hex) of the generated POA PDF bytes — tamper-evidence. */
    docSha256: text('doc_sha256'),
    /** How the human ops step filed it: 'portal' | 'email' | 'mail'. */
    cbpChannel: text('cbp_channel'),
    cbpSubmittedAt: timestamp('cbp_submitted_at', { withTimezone: true, mode: 'date' }),
    cbpConfirmedAt: timestamp('cbp_confirmed_at', { withTimezone: true, mode: 'date' }),
    /** When protection took effect (== cbpConfirmedAt) and when it expires
     *  (+2 years) — CBP confidentiality is valid 2 years from receipt. */
    effectiveAt: timestamp('effective_at', { withTimezone: true, mode: 'date' }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    /** Last renewal reminder sent — the cron double-send guard. */
    lastReminderAt: timestamp('last_reminder_at', { withTimezone: true, mode: 'date' }),
    /** Uploaded supporting docs, "on file"/"self-reported" only — NEVER verified. */
    docs: jsonb('docs').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('poa_applications_token_idx').on(t.publicToken),
    index('poa_applications_user_idx').on(t.userId),
    index('poa_applications_status_idx').on(t.status),
    index('poa_applications_expires_idx').on(t.expiresAt),
  ]
);

export type PoaApplication = typeof poaApplications.$inferSelect;
export type NewPoaApplication = typeof poaApplications.$inferInsert;
export type PoaStatus =
  | 'draft'
  | 'signed'
  | 'submitted'
  | 'confirmed'
  | 'active'
  | 'renewal_due'
  | 'expired'
  | 'revoked';

/** Append-only audit trail for each POA application (ESIGN attribution +
 *  lifecycle events). Never updated or deleted — one INSERT per event. */
export const poaAuditEvents = pgTable(
  'poa_audit_events',
  {
    id: serial('id').primaryKey(),
    applicationId: integer('application_id')
      .notNull()
      .references(() => poaApplications.id, { onDelete: 'cascade' }),
    /** e.g. 'created' | 'consent' | 'signed' | 'pdf_generated' | 'submitted' |
     *  'confirmed' | 'renewal_reminded' | 'revoked'. */
    event: text('event').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    meta: jsonb('meta').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [index('poa_audit_events_application_idx').on(t.applicationId)]
);

export type PoaAuditEvent = typeof poaAuditEvents.$inferSelect;
export type NewPoaAuditEvent = typeof poaAuditEvents.$inferInsert;

/** Active redactions — the in-app "Hidden on QuoteFleet" set. One row per
 *  companyKey-normalized name variation; the redaction choke-points load the
 *  active set into memory. Inserted ONLY on CBP confirm (never before). */
export const manifestRedactions = pgTable(
  'manifest_redactions',
  {
    id: serial('id').primaryKey(),
    /** companyKey()-normalized name (or variation) to hide from the directory. */
    nameKey: text('name_key').notNull(),
    applicationId: integer('application_id').references(() => poaApplications.id, {
      onDelete: 'cascade',
    }),
    reason: text('reason'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('manifest_redactions_name_key_idx').on(t.nameKey)]
);

export type ManifestRedaction = typeof manifestRedactions.$inferSelect;
export type NewManifestRedaction = typeof manifestRedactions.$inferInsert;
