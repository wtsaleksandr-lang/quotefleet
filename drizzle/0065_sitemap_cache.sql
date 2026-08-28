CREATE TABLE IF NOT EXISTS "sitemap_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"xml" text NOT NULL,
	"url_count" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL
);
