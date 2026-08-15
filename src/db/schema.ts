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
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
    lastLoginAt: timestamp('last_login_at', { mode: 'date' }),
  },
  (t) => [
    uniqueIndex('users_email_idx').on(t.email),
    index('users_tenant_idx').on(t.tenantId),
    uniqueIndex('users_google_sub_idx').on(t.googleSub),
    uniqueIndex('users_microsoft_sub_idx').on(t.microsoftSub),
    uniqueIndex('users_meta_sub_idx').on(t.metaSub),
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
export type AiConfig = typeof aiConfigs.$inferSelect;
export type BrandConfig = typeof brandConfigs.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type BrokerLead = typeof brokerLeads.$inferSelect;
export type NewBrokerLead = typeof brokerLeads.$inferInsert;
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
