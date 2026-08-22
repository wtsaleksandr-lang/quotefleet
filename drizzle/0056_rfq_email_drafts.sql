-- rfq_recipients — persist the per-carrier email DRAFT (subject + body) generated
-- in the review phase of the two-phase RFQ flow (generate → review/edit → send).
-- The body is the personalized "Dear <Company>," letter the shipper reviews and
-- can edit; the (possibly-edited) value is what the send path renders.
--
-- Both nullable, no backfill, so ADD COLUMN IF NOT EXISTS is safe to re-run on
-- every boot via runMigrations() (the Replit deploy does not run db:migrate).
-- Also mirrored byte-for-byte in src/db/migrate.ts SELF_HEAL_TABLE_STATEMENTS
-- (right after the rfq_recipients CREATE TABLE) so a Replit phantom-drop of the
-- column is re-added before the server serves.
ALTER TABLE "rfq_recipients" ADD COLUMN IF NOT EXISTS "draft_subject" text;
ALTER TABLE "rfq_recipients" ADD COLUMN IF NOT EXISTS "draft_body" text;
