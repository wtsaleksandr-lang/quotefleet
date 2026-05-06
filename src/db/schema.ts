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
} from 'drizzle-orm/pg-core';

// ────────────────────────────────────────────────────────────────────
// TENANTS — one per customer company.
// ────────────────────────────────────────────────────────────────────
export const tenants = pgTable(
  'tenants',
  {
    id: serial('id').primaryKey(),
    /** URL-safe slug — also the subdomain. e.g. "astova" → astova.quotefleet.app. */
    slug: text('slug').notNull().unique(),
    /** Which of the platform-owned host domains hosts this tenant.
     *  e.g. "quotefleet.app", "quotefleet.net", "truckrate.online".
     *  The full hosted URL is `<slug>.<hostDomain>`. */
    hostDomain: text('host_domain').notNull().default('quotefleet.app'),
    /** Optional custom domain (Pro tier). e.g. "quote.astova.com" mapped via CNAME. */
    customDomain: text('custom_domain').unique(),
    /** Public company name shown in the calculator. */
    name: text('name').notNull(),
    /** Contact email for the tenant owner (notifications). */
    contactEmail: text('contact_email').notNull(),
    /** Phone number (optional). */
    contactPhone: text('contact_phone'),
    /** Country focus — 'US', 'CA', or 'BOTH'. Drives rate defaults. */
    countryFocus: text('country_focus').notNull().default('US'),
    /** Random unguessable token used in <script src="...embed.js?t=..."> */
    embedToken: text('embed_token').notNull().unique(),
    /** Plan: 'free', 'starter', 'pro', 'enterprise'. */
    plan: text('plan').notNull().default('free'),
    /** Whether the tenant is active or suspended. */
    status: text('status').notNull().default('active'),
    /** Trial end timestamp. Null = not on trial (paid or grandfathered). */
    trialEndsAt: timestamp('trial_ends_at', { mode: 'date' }),
    /** Optional per-tenant Anthropic API key (encrypted). When set,
     *  overrides the platform default for that tenant's AI calls. */
    anthropicKeyEncrypted: text('anthropic_key_encrypted'),
    /** Created timestamp. */
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('tenants_slug_idx').on(t.slug),
    uniqueIndex('tenants_slug_host_idx').on(t.slug, t.hostDomain),
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
    /** bcrypt hash. */
    passwordHash: text('password_hash').notNull(),
    name: text('name'),
    role: text('role').notNull().default('tenant_owner'),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
    lastLoginAt: timestamp('last_login_at', { mode: 'date' }),
  },
  (t) => [uniqueIndex('users_email_idx').on(t.email)]
);

// ────────────────────────────────────────────────────────────────────
// SESSIONS — opaque cookie tokens.
// ────────────────────────────────────────────────────────────────────
export const sessions = pgTable('sessions', {
  token: text('token').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
});

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
});

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
});

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
  (t) => [uniqueIndex('terminals_tenant_code_idx').on(t.tenantId, t.code)]
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
});

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
// BRAND CONFIG — what the customer's calculator looks like.
// ────────────────────────────────────────────────────────────────────
export const brandConfigs = pgTable('brand_configs', {
  tenantId: integer('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  displayName: text('display_name'), // shown above calculator
  tagline: text('tagline'),
  primaryColor: text('primary_color').notNull().default('#2563eb'),
  accentColor: text('accent_color').notNull().default('#06b6d4'),
  /** Optional logo URL. */
  logoUrl: text('logo_url'),
  /** Optional CTA button text override. */
  ctaText: text('cta_text').notNull().default('Get instant quote'),
  /** Footer text under the widget. */
  footerNote: text('footer_note'),
  /** Whether to show "Powered by QuoteFleet" branding. */
  showPoweredBy: boolean('show_powered_by').notNull().default(true),
  /** Allowed origins for the embed (CSV of domains). Empty = any. */
  allowedDomains: text('allowed_domains'),
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

    /** Selected accessorials (codes, e.g. ["liftgate","residential"]). */
    accessorialCodes: jsonb('accessorial_codes').$type<string[]>(),

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

    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('leads_ref_idx').on(t.refId)]
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
});

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
});

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
  (t) => [uniqueIndex('outreach_email_idx').on(t.contactEmail)]
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
});

// ────────────────────────────────────────────────────────────────────
// PLATFORM SETTINGS — key/value store for app-wide config.
// ────────────────────────────────────────────────────────────────────
export const platformSettings = pgTable('platform_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
});

// ────────────────────────────────────────────────────────────────────
// Type helpers for use in the rest of the codebase.
// ────────────────────────────────────────────────────────────────────
export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type RateCard = typeof rateCards.$inferSelect;
export type NewRateCard = typeof rateCards.$inferInsert;
export type Accessorial = typeof accessorials.$inferSelect;
export type NewAccessorial = typeof accessorials.$inferInsert;
export type LaneZone = typeof laneZones.$inferSelect;
export type NewLaneZone = typeof laneZones.$inferInsert;
export type Terminal = typeof terminals.$inferSelect;
export type NewTerminal = typeof terminals.$inferInsert;
export type AiConfig = typeof aiConfigs.$inferSelect;
export type BrandConfig = typeof brandConfigs.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type Port = typeof ports.$inferSelect;
export type OutreachProspect = typeof outreachProspects.$inferSelect;
export type NewOutreachProspect = typeof outreachProspects.$inferInsert;
export type OutreachCampaign = typeof outreachCampaigns.$inferSelect;
export type OutreachEvent = typeof outreachEvents.$inferSelect;
export type NewOutreachEvent = typeof outreachEvents.$inferInsert;
