-- Callback requests — visitors and the AI assistant can ask the
-- carrier to call them back. Tenant inbox lives at /app/callbacks.
--
-- Idempotent so the migration is safe to re-run on environments
-- where the table may already exist.
CREATE TABLE IF NOT EXISTS "callback_requests" (
  "id"                      serial PRIMARY KEY,
  "tenant_id"               integer NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "lead_id"                 integer REFERENCES "leads"("id") ON DELETE SET NULL,
  "lead_ref_id"             text,
  "customer_name"           text NOT NULL,
  "customer_phone"          text NOT NULL,
  "customer_email"          text,
  "customer_company"        text,
  "preferred_time"          text,
  "topic"                   text,
  "trigger_source"          text NOT NULL DEFAULT 'visitor_button',
  "ai_context_json"         jsonb,
  "status"                  text NOT NULL DEFAULT 'open',
  "assigned_to_user_id"     integer REFERENCES "users"("id") ON DELETE SET NULL,
  "notes"                   text,
  "completed_at"            timestamp,
  "created_at"              timestamp NOT NULL DEFAULT now(),
  "updated_at"              timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "callback_tenant_status_idx"
  ON "callback_requests" ("tenant_id", "status", "created_at");

CREATE INDEX IF NOT EXISTS "callback_lead_idx"
  ON "callback_requests" ("lead_id");
