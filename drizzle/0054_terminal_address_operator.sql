-- directory_terminals — add nullable `address` + `operator` to the canonical
-- intermodal-terminal reference list. `address` holds the anchor facility's
-- street address (so calculators can auto-fill a real terminal address from a
-- port/hub code); `operator` names the port-authority / Class-I rail operator.
-- Both nullable — inland multi-carrier metros may seed with no single facility.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS, no backfill) so it is safe to re-run on
-- every boot via runMigrations() — the Replit deploy does not run db:migrate.
-- Also mirrored byte-for-byte in src/db/migrate.ts SELF_HEAL_TABLE_STATEMENTS
-- (right after the directory_terminals CREATE) so a Replit phantom-drop of the
-- columns is re-added before the server serves.
ALTER TABLE "directory_terminals" ADD COLUMN IF NOT EXISTS "address" text;
ALTER TABLE "directory_terminals" ADD COLUMN IF NOT EXISTS "operator" text;
