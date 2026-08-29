-- 0069 — owned-domain SEO content engine (/guides).
--
-- DOCUMENTATION COPY. Past 0063 the drizzle journal is no longer the executing
-- mechanism (Replit's deploy runs only `pnpm install && pnpm build && pnpm start`,
-- never `db:migrate`). The statements below are mirrored BYTE-FOR-BYTE into
-- SELF_HEAL_TABLE_STATEMENTS in src/db/migrate.ts, which runs them on every boot
-- behind the catalog pre-check + lock_timeout guard. This file exists so the
-- schema history stays readable and so a fresh `drizzle-kit migrate` on a clean
-- database produces the same shape.
--
-- WHY THIS TABLE SET
-- QuoteFleet has ~334k programmatic carrier pages and zero editorial surface.
-- Programmatic pages don't earn links. These tables back /guides — data-backed
-- articles generated from the FMCSA carrier census (public federal data), each
-- one gated behind an anti-thin minimum-sample floor and a human review step.
--
-- SAFETY POSTURE
-- A phantom-drop by Replit's publish tool loses only editorial content, never
-- carrier data. The self-heal re-creates the tables on the next boot; published
-- rows would need re-approval, which is why the approvals audit is append-only.

CREATE TABLE IF NOT EXISTS "seo_content_pages" (
  "id" serial PRIMARY KEY NOT NULL,
  "slug" text NOT NULL,
  "title" text NOT NULL,
  "meta_description" text,
  "excerpt" text,
  "content" text NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "jsonld_type" text DEFAULT 'Article' NOT NULL,
  "author_entity" text DEFAULT 'QuoteFleet Research' NOT NULL,
  "canonical" text,
  "original_data" jsonb,
  "unique_data_score" integer,
  "surface" text DEFAULT 'qf_seo' NOT NULL,
  "published_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Slug is the public URL key (/guides/:slug) and the generator's dedup key.
CREATE UNIQUE INDEX IF NOT EXISTS "seo_content_pages_slug_idx" ON "seo_content_pages" ("slug");
-- The only two queries that matter: the review queue (status='in_review') and
-- the public/sitemap read (status='published' AND surface='qf_seo').
CREATE INDEX IF NOT EXISTS "seo_content_pages_status_surface_idx" ON "seo_content_pages" ("status", "surface");

CREATE TABLE IF NOT EXISTS "seo_content_approvals" (
  "id" serial PRIMARY KEY NOT NULL,
  "page_id" integer NOT NULL,
  "actor_type" text NOT NULL,
  "actor_id" integer,
  "action" text NOT NULL,
  "notes" text,
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "seo_content_approvals_page_idx" ON "seo_content_approvals" ("page_id", "created_at");

-- Singleton kill switch (id = 1). Read by the engine gate, which fails CLOSED:
-- if this row cannot be read the engine stays disabled.
CREATE TABLE IF NOT EXISTS "seo_engine_settings" (
  "id" integer PRIMARY KEY NOT NULL,
  "kill_switch" boolean DEFAULT false NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "updated_by" integer
);
