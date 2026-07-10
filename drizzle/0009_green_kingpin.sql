-- LTL size/weight-aware pricing.
-- rate_cards.ltl_config: tenant LTL rate model (class multipliers + weight breaks).
-- leads: shipment dimensions + derived freight class / density + palletized / dock flags.
ALTER TABLE "rate_cards" ADD COLUMN IF NOT EXISTS "ltl_config" jsonb;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "length_in" double precision;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "width_in" double precision;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "height_in" double precision;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "freight_class" double precision;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "density_pcf" double precision;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "palletized" boolean;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "loaded_from_dock" boolean;
