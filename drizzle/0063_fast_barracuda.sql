CREATE TABLE "directory_aggregate_cache" (
	"id" integer PRIMARY KEY NOT NULL,
	"summary" jsonb NOT NULL,
	"base_facets" jsonb NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL
);
