-- Opt-in public contact email shown to customers on the calculator widget +
-- hosted quotes. Separate from `tenants.contact_email`, which is the PRIVATE
-- owner/login email (notifications only). Public surfaces render this column
-- ONLY when set; they never fall back to contact_email, so a carrier's login
-- email is never exposed publicly.
--
-- Nullable, no default, no backfill — existing tenants stay hidden until they
-- explicitly set a public email. Idempotent so it's safe to re-run.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "public_contact_email" text;
