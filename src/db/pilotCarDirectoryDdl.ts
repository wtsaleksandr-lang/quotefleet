/**
 * DDL for `pilot_car_operators`, in a LEAF module for the same reason
 * `seasonalRestrictionsDdl.ts` is one.
 *
 * Two places need these exact statements — `migrate.ts`, which folds them into
 * `SELF_HEAL_TABLE_STATEMENTS` so the boot self-heal and the schema tests both
 * see them, and `server/pilotCars/store.ts`, which owns the table. `store.ts`
 * already imports `migrate.ts` for `runSelfHealStatements`, so migrate cannot
 * import store back without a cycle, and copy-pasting the SQL into both is how
 * two "identical" definitions drift by a column.
 *
 * WHY SELF-HEAL AT ALL, rather than a drizzle migration: Replit's deploy skips
 * `db:migrate`, and its publish tool has repeatedly proposed removing tables the
 * ORM does not know about. Every at-risk object in this codebase is re-asserted
 * on each boot instead, so a phantom removal repairs itself on the next start.
 *
 * WHY THESE SHAPES: `selfHealTarget()` recognises exactly
 * `CREATE TABLE IF NOT EXISTS "t"` and `CREATE [UNIQUE] INDEX IF NOT EXISTS "i"`,
 * and that recognition is what gives the healthy-boot case a catalog pre-check
 * and therefore NO table lock at all. `ADD COLUMN IF NOT EXISTS` takes
 * ACCESS EXCLUSIVE *before* it checks existence — "idempotent" is not "free" —
 * which is what took prod down on 2026-08-28. Anything added here must keep one
 * of the two recognised shapes.
 *
 * ── WHY THE SHAPE OF THE TABLE IS WHAT IT IS ───────────────────────────────
 * The whole point of this directory is that the attributes deciding whether an
 * operator can LEGALLY take a job are columns, not prose. Both incumbent
 * directories store a name and a free-text blurb, which is why neither can
 * answer "who can escort a 14-ft-wide load through Kentucky and Tennessee this
 * week". So:
 *
 *  • `states_covered` / `certified_states` are jsonb ARRAYS with GIN indexes,
 *    queried by containment (`@>`). A state is either in the array or it is not.
 *  • `certifications_json` holds ONE ROW PER STATE — `{state, status, issuedOn,
 *    expiresOn, verification}` — because certification is a per-state fact with
 *    its own expiry. A global `is_certified` boolean is the exact modelling
 *    error that makes the incumbents unfilterable, and it cannot express
 *    "certified in Washington, expired in Georgia".
 *  • `vehicle_gvwr_lbs` is separate from certification because an operator can
 *    be certified and still illegal: Tennessee refuses an escort vehicle rated
 *    at 18,000 lb GVWR or more whatever card the driver holds, and several
 *    Canadian provinces cap the escort vehicle by mass.
 *  • `verification_tier` is a THREE-VALUE enum defaulting to `self-asserted`.
 *    There is no boolean `verified` here, because a boolean invites a UI that
 *    renders "not yet checked" as a tick.
 *
 * ── PII ────────────────────────────────────────────────────────────────────
 * `email`, `phone` and `contact_name` are personal data for a small business.
 * They are stored so the operator can be reached and so the record can be
 * deleted on request, and each has its OWN `publish_*` flag: what is public is
 * the operator's choice, per field, recorded at submission. `manage_token_hash`
 * is a SHA-256 of the token — the token itself is shown once and never stored,
 * so a database read cannot impersonate an operator.
 */
export const PILOT_CAR_DIRECTORY_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS "pilot_car_operators" (
    "id" serial PRIMARY KEY NOT NULL,
    "public_slug" text NOT NULL,
    "manage_token_hash" text NOT NULL,
    "business_name" text NOT NULL,
    "contact_name" text,
    "email" text NOT NULL,
    "phone" text,
    "website" text,
    "home_base_city" text,
    "home_base_state" text,
    "service_radius_mi" integer,
    "states_covered" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "certified_states" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "certifications_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "reciprocity_claimed_states" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "languages" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "has_height_pole" boolean DEFAULT false NOT NULL,
    "height_pole_max_in" integer,
    "has_oversize_signs" boolean DEFAULT false NOT NULL,
    "has_flags" boolean DEFAULT false NOT NULL,
    "has_amber_light_bar" boolean DEFAULT false NOT NULL,
    "has_two_way_radio" boolean DEFAULT false NOT NULL,
    "vehicle_class" text,
    "vehicle_gvwr_lbs" integer,
    "takes_superloads" boolean DEFAULT false NOT NULL,
    "takes_night_moves" boolean DEFAULT false NOT NULL,
    "insurance_liability_usd" integer,
    "insurance_expires_on" date,
    "verification_tier" text DEFAULT 'self-asserted' NOT NULL,
    "verification_note" text,
    "verification_source_url" text,
    "verified_on" date,
    "publish_email" boolean DEFAULT false NOT NULL,
    "publish_phone" boolean DEFAULT false NOT NULL,
    "publish_contact_name" boolean DEFAULT false NOT NULL,
    "listing_status" text DEFAULT 'pending' NOT NULL,
    "moderation_note" text,
    "consent_public_listing" boolean DEFAULT false NOT NULL,
    "consent_recorded_at" timestamptz,
    "created_at" timestamptz DEFAULT now() NOT NULL,
    "updated_at" timestamptz DEFAULT now() NOT NULL,
    "last_confirmed_at" timestamptz
  )`,
  // The slug is the profile URL. UNIQUE so two operators can never collide onto
  // one page, and so the insert's retry loop has something to fail against
  // rather than a read-then-write race it can lose.
  `CREATE UNIQUE INDEX IF NOT EXISTS "pilot_car_operators_slug_idx" ON "pilot_car_operators" ("public_slug")`,
  // The manage link's only lookup. UNIQUE because a collision would hand one
  // operator's record to another.
  `CREATE UNIQUE INDEX IF NOT EXISTS "pilot_car_operators_token_idx" ON "pilot_car_operators" ("manage_token_hash")`,
  // Every public list query filters on status first — the published set is the
  // only thing the directory renders, and it is a small fraction of the table
  // once a moderation queue exists.
  `CREATE INDEX IF NOT EXISTS "pilot_car_operators_status_idx" ON "pilot_car_operators" ("listing_status")`,
  // The two filters that carry the product. GIN over jsonb answers `@> '["KY"]'`
  // without scanning, which is what makes a state filter cheap enough to be the
  // default rather than an advanced option.
  `CREATE INDEX IF NOT EXISTS "pilot_car_operators_states_idx" ON "pilot_car_operators" USING gin ("states_covered")`,
  `CREATE INDEX IF NOT EXISTS "pilot_car_operators_certified_idx" ON "pilot_car_operators" USING gin ("certified_states")`,
];
