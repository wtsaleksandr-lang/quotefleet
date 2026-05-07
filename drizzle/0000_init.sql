CREATE TABLE "accessorials" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"kind" text DEFAULT 'flat' NOT NULL,
	"amount" double precision DEFAULT 0 NOT NULL,
	"trigger" text DEFAULT 'optional' NOT NULL,
	"condition_json" jsonb,
	"applies_to_services" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_configs" (
	"tenant_id" integer PRIMARY KEY NOT NULL,
	"system_prompt" text DEFAULT '' NOT NULL,
	"tone" text DEFAULT 'professional' NOT NULL,
	"auto_reply_enabled" boolean DEFAULT true NOT NULL,
	"chat_enabled" boolean DEFAULT true NOT NULL,
	"model_preference" text DEFAULT 'auto' NOT NULL,
	"knowledge_json" jsonb,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer,
	"user_id" integer,
	"action" text NOT NULL,
	"actor_kind" text DEFAULT 'user' NOT NULL,
	"details_json" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_configs" (
	"tenant_id" integer PRIMARY KEY NOT NULL,
	"display_name" text,
	"tagline" text,
	"primary_color" text DEFAULT '#2563eb' NOT NULL,
	"accent_color" text DEFAULT '#06b6d4' NOT NULL,
	"logo_url" text,
	"cta_text" text DEFAULT 'Get instant quote' NOT NULL,
	"footer_note" text,
	"show_powered_by" boolean DEFAULT true NOT NULL,
	"allowed_domains" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"channel" text NOT NULL,
	"lead_id" integer,
	"user_id" integer,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"metadata_json" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "distance_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"origin_key" text NOT NULL,
	"dest_key" text NOT NULL,
	"miles" double precision NOT NULL,
	"source" text DEFAULT 'haversine' NOT NULL,
	"route_json" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "geocode_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"query_key" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"canonical_address" text,
	"city" text,
	"state" text,
	"zip" text,
	"country" text,
	"source" text DEFAULT 'nominatim' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "geocode_cache_query_key_unique" UNIQUE("query_key")
);
--> statement-breakpoint
CREATE TABLE "ingest_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"user_id" integer,
	"filename" text NOT NULL,
	"mime_type" text,
	"size_bytes" integer,
	"storage_ref" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"parsed_json" jsonb,
	"review_notes" text,
	"error_message" text,
	"applied_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lane_zones" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"label" text NOT NULL,
	"anchor_port_code" text,
	"anchor_city" text,
	"anchor_state" text,
	"radius_miles" double precision NOT NULL,
	"flat_price" double precision NOT NULL,
	"equipment_scope" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"ref_id" text NOT NULL,
	"customer_name" text,
	"customer_email" text,
	"customer_phone" text,
	"customer_company" text,
	"service" text NOT NULL,
	"equipment" text NOT NULL,
	"pickup_address" text,
	"pickup_city" text,
	"pickup_state" text,
	"pickup_zip" text,
	"pickup_country" text DEFAULT 'US',
	"pickup_lat" double precision,
	"pickup_lng" double precision,
	"delivery_address" text,
	"delivery_city" text,
	"delivery_state" text,
	"delivery_zip" text,
	"delivery_country" text DEFAULT 'US',
	"delivery_lat" double precision,
	"delivery_lng" double precision,
	"pickup_date" text,
	"delivery_date" text,
	"pickup_terminal_code" text,
	"delivery_terminal_code" text,
	"ocean_carrier" text,
	"booking_number" text,
	"bill_of_lading_number" text,
	"container_numbers" text,
	"weight_lbs" double precision,
	"pieces" integer,
	"commodity" text,
	"notes" text,
	"accessorial_codes" jsonb,
	"distance_miles" double precision,
	"breakdown_json" jsonb,
	"quoted_total" double precision,
	"quoted_currency" text DEFAULT 'USD' NOT NULL,
	"ai_summary" text,
	"source" text,
	"source_url" text,
	"source_ip" text,
	"user_agent" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"auto_reply_sent" boolean DEFAULT false NOT NULL,
	"auto_reply_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "leads_ref_id_unique" UNIQUE("ref_id")
);
--> statement-breakpoint
CREATE TABLE "magic_links" (
	"token" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"redirect_to" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketplace_aggregates" (
	"id" serial PRIMARY KEY NOT NULL,
	"service" text NOT NULL,
	"equipment" text NOT NULL,
	"anchor_type" text,
	"anchor_code" text,
	"sample_size" integer NOT NULL,
	"p25_rate_per_mile" double precision,
	"p50_rate_per_mile" double precision,
	"p75_rate_per_mile" double precision,
	"p25_minimum" double precision,
	"p50_minimum" double precision,
	"p75_minimum" double precision,
	"p25_flat_price" double precision,
	"p50_flat_price" double precision,
	"p75_flat_price" double precision,
	"computed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketplace_carriers" (
	"tenant_id" integer PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"country_focus" text DEFAULT 'US' NOT NULL,
	"mc_number" text,
	"dot_number" text,
	"summary" text,
	"public_slug" text NOT NULL,
	"equipment_json" jsonb,
	"services_json" jsonb,
	"visible" boolean DEFAULT false NOT NULL,
	"last_synced_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketplace_lanes" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"anchor_type" text NOT NULL,
	"anchor_code" text NOT NULL,
	"radius_miles" double precision,
	"equipment_json" jsonb,
	"services_json" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketplace_rate_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"service" text NOT NULL,
	"equipment" text NOT NULL,
	"rate_per_mile" double precision,
	"minimum_charge" double precision,
	"flat_fee" double precision,
	"fuel_surcharge_pct" double precision,
	"lane_anchor_code" text,
	"lane_radius_miles" double precision,
	"lane_flat_price" double precision,
	"source_kind" text NOT NULL,
	"source_meta" jsonb,
	"captured_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach_campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"external_id" text NOT NULL,
	"provider" text DEFAULT 'smartlead' NOT NULL,
	"name" text NOT NULL,
	"sending_domain" text,
	"subject_line" text,
	"body_template" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"stats_json" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"prospect_id" integer NOT NULL,
	"campaign_id" integer,
	"event_type" text NOT NULL,
	"step_index" integer,
	"payload_json" jsonb,
	"occurred_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach_prospects" (
	"id" serial PRIMARY KEY NOT NULL,
	"external_id" text,
	"provider" text DEFAULT 'smartlead' NOT NULL,
	"source" text,
	"company_name" text,
	"company_domain" text,
	"company_phone" text,
	"company_address" text,
	"company_city" text,
	"company_state" text,
	"company_country" text,
	"segment" text,
	"size_band" text,
	"website_url" text,
	"website_snapshot_json" jsonb,
	"contact_name" text,
	"contact_title" text,
	"contact_email" text,
	"contact_phone" text,
	"contact_linkedin" text,
	"status" text DEFAULT 'new' NOT NULL,
	"last_touched_at" timestamp,
	"next_followup_at" timestamp,
	"notes" text,
	"converted_tenant_id" integer,
	"tags" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ports" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"city" text NOT NULL,
	"state" text,
	"country" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"teu_rank" integer DEFAULT 0,
	CONSTRAINT "ports_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "rate_cards" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"service" text NOT NULL,
	"equipment" text NOT NULL,
	"label" text,
	"rate_per_mile" double precision DEFAULT 0 NOT NULL,
	"minimum_charge" double precision DEFAULT 0 NOT NULL,
	"flat_fee" double precision DEFAULT 0 NOT NULL,
	"fuel_surcharge_pct" double precision DEFAULT 0 NOT NULL,
	"margin_pct" double precision DEFAULT 0 NOT NULL,
	"max_weight_lbs" double precision,
	"max_miles" double precision,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"last_ai_edit_at" timestamp,
	"last_ai_edit_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"host_domain" text DEFAULT 'quotefleet.app' NOT NULL,
	"custom_domain" text,
	"name" text NOT NULL,
	"contact_email" text NOT NULL,
	"contact_phone" text,
	"country_focus" text DEFAULT 'US' NOT NULL,
	"embed_token" text NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"trial_ends_at" timestamp,
	"marketplace_opt_in" boolean DEFAULT false NOT NULL,
	"mc_number" text,
	"dot_number" text,
	"anthropic_key_encrypted" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug"),
	CONSTRAINT "tenants_custom_domain_unique" UNIQUE("custom_domain"),
	CONSTRAINT "tenants_embed_token_unique" UNIQUE("embed_token")
);
--> statement-breakpoint
CREATE TABLE "terminals" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"port_code" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"carrier" text,
	"address" text,
	"lat" double precision,
	"lng" double precision,
	"surcharge" double precision DEFAULT 0 NOT NULL,
	"notes" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text,
	"role" text DEFAULT 'tenant_owner' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_login_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "accessorials" ADD CONSTRAINT "accessorials_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_configs" ADD CONSTRAINT "ai_configs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_configs" ADD CONSTRAINT "brand_configs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_jobs" ADD CONSTRAINT "ingest_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_jobs" ADD CONSTRAINT "ingest_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lane_zones" ADD CONSTRAINT "lane_zones_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "magic_links" ADD CONSTRAINT "magic_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_carriers" ADD CONSTRAINT "marketplace_carriers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_lanes" ADD CONSTRAINT "marketplace_lanes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_rate_snapshots" ADD CONSTRAINT "marketplace_rate_snapshots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_events" ADD CONSTRAINT "outreach_events_prospect_id_outreach_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."outreach_prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_events" ADD CONSTRAINT "outreach_events_campaign_id_outreach_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."outreach_campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_prospects" ADD CONSTRAINT "outreach_prospects_converted_tenant_id_tenants_id_fk" FOREIGN KEY ("converted_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_cards" ADD CONSTRAINT "rate_cards_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminals" ADD CONSTRAINT "terminals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "distance_cache_idx" ON "distance_cache" USING btree ("origin_key","dest_key");--> statement-breakpoint
CREATE UNIQUE INDEX "geocode_query_idx" ON "geocode_cache" USING btree ("query_key");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_ref_idx" ON "leads" USING btree ("ref_id");--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_aggregates_idx" ON "marketplace_aggregates" USING btree ("service","equipment","anchor_type","anchor_code");--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_carriers_slug_idx" ON "marketplace_carriers" USING btree ("public_slug");--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_lanes_idx" ON "marketplace_lanes" USING btree ("tenant_id","anchor_type","anchor_code");--> statement-breakpoint
CREATE UNIQUE INDEX "outreach_email_idx" ON "outreach_prospects" USING btree ("contact_email");--> statement-breakpoint
CREATE UNIQUE INDEX "ports_code_idx" ON "ports" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_slug_idx" ON "tenants" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_slug_host_idx" ON "tenants" USING btree ("slug","host_domain");--> statement-breakpoint
CREATE UNIQUE INDEX "terminals_tenant_code_idx" ON "terminals" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");