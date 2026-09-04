/**
 * PERSISTENCE for the pilot-car directory.
 *
 * ── THE DATABASE BEING DOWN IS A FIRST-CLASS CASE, NOT AN ERROR PATH ──────
 * The dev Neon branch is over quota and 500s, and Neon's serverless compute
 * suspends in prod. So every read here is wrapped and returns a RESULT OBJECT
 * carrying `unavailable: true` rather than throwing, and the pages render that
 * as "we cannot reach the directory right now" with the operator's own next
 * step.
 *
 * The distinction is the same one the seasonal work drew between *unknown* and
 * *clear*, and it is load-bearing for the same reason. "No operators found"
 * tells a dispatcher there is nobody to call in Kentucky. "We cannot reach the
 * directory" tells them to try again or use the state's own list. Rendering the
 * first when the truth is the second is a lie that costs somebody a load, and
 * it is the single easiest bug to write here: a `catch { return [] }` produces
 * it silently.
 *
 * ── WRITES ────────────────────────────────────────────────────────────────
 * A write that cannot reach the database returns `{ ok: false, unavailable:
 * true }` and the submission page tells the operator their details were NOT
 * saved. It never says "thanks, we'll be in touch" over a failed insert.
 *
 * ── PII AND LOGGING ───────────────────────────────────────────────────────
 * `describeDbError` is the only thing that reaches `console.warn` from here.
 * No row, no email address, no phone number and no manage token is ever logged
 * — a submission body must not end up in a log aggregator, and the way that
 * happens is someone logging the parameters "just for this one bug".
 */
import { sql, type SQL } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { runSelfHealStatements } from '../../db/migrate.js';
import { PILOT_CAR_DIRECTORY_DDL } from '../../db/pilotCarDirectoryDdl.js';
import { describeDbError, withDbRetry } from '../../db/retry.js';
import {
  OPERATORS_PER_PAGE,
  certifiedStatesFrom,
  hashManageToken,
  newManageToken,
  slugify,
  toPublicOperator,
  type OperatorFilters,
  type OperatorRow,
  type PublicOperator,
  type Submission,
  type VerificationTier,
  VERIFICATION_TIERS,
} from './model.js';

/**
 * Created by SELF-HEAL ONLY, on the same terms as `seasonal_restrictions`.
 *
 * Deliberately NOT in `src/db/schema.ts` and NOT in `drizzle/`: Replit's deploy
 * skips db:migrate and its publish tool has repeatedly proposed removing tables
 * the ORM does not know about. Every at-risk object in this codebase is
 * re-asserted on each boot instead.
 */
export async function ensurePilotCarTable(): Promise<void> {
  await runSelfHealStatements('pilot_car_operators', PILOT_CAR_DIRECTORY_DDL);
}

/** Every read returns one of these. `unavailable` is never inferred from 0 rows. */
export interface ListResult {
  operators: PublicOperator[];
  total: number;
  unavailable: boolean;
}

export interface OneResult {
  operator: PublicOperator | null;
  unavailable: boolean;
}

export interface WriteResult {
  ok: boolean;
  unavailable: boolean;
  /** Present only on a successful create. Shown ONCE and never stored raw. */
  manageToken?: string;
  slug?: string;
  error?: string;
}

const PUBLIC_COLUMNS = sql`
  "public_slug", "business_name", "contact_name", "email", "phone", "website",
  "home_base_city", "home_base_state", "service_radius_mi", "states_covered",
  "certified_states", "certifications_json", "reciprocity_claimed_states",
  "languages", "has_height_pole", "height_pole_max_in", "has_oversize_signs",
  "has_flags", "has_amber_light_bar", "has_two_way_radio", "vehicle_class",
  "vehicle_gvwr_lbs", "takes_superloads", "takes_night_moves",
  "insurance_liability_usd", "insurance_expires_on", "verification_tier",
  "verification_note", "verification_source_url", "verified_on",
  "publish_email", "publish_phone", "publish_contact_name", "listing_status",
  "updated_at", "last_confirmed_at"
`;

function rowsOf(result: unknown): OperatorRow[] {
  if (Array.isArray(result)) return result as OperatorRow[];
  const wrapped = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(wrapped) ? (wrapped as OperatorRow[]) : [];
}

/**
 * The WHERE clause, built from validated filters only.
 *
 * Every value is a bound parameter — `sql` interpolation in drizzle parameterises,
 * and the only strings that reach it have already passed the membership checks in
 * `parseFilters`, so a state code is a state code and an equipment key names a
 * real column.
 *
 * `@>` CONTAINMENT IS WHY THE STATE FILTER IS THE DEFAULT rather than an
 * advanced option: it reads the GIN index instead of scanning, so filtering a
 * seven-state lane costs the same as filtering one.
 */
function whereFor(f: OperatorFilters): SQL {
  const parts: SQL[] = [sql`"listing_status" = 'published'`];

  if (f.states.length > 0) {
    parts.push(sql`"states_covered" @> ${JSON.stringify(f.states)}::jsonb`);
  }
  if (f.certifiedIn.length > 0) {
    parts.push(sql`"certified_states" @> ${JSON.stringify(f.certifiedIn)}::jsonb`);
  }
  for (const key of f.equipment) {
    // A closed map, not string interpolation: the column name never comes from
    // the request even though `parseFilters` already restricted it to the enum.
    const column =
      key === 'heightPole'
        ? sql`"has_height_pole"`
        : key === 'oversizeSigns'
          ? sql`"has_oversize_signs"`
          : key === 'flags'
            ? sql`"has_flags"`
            : key === 'amberLightBar'
              ? sql`"has_amber_light_bar"`
              : sql`"has_two_way_radio"`;
    parts.push(sql`${column} = true`);
  }
  if (f.maxGvwrLbs != null) {
    // An operator who has not stated a GVWR is EXCLUDED from a GVWR filter
    // rather than assumed to fit. Tennessee refuses an escort vehicle at or
    // above 18,000 lb GVWR whatever the driver holds, so "unstated" cannot be
    // allowed to satisfy "under the cap".
    parts.push(sql`"vehicle_gvwr_lbs" IS NOT NULL AND "vehicle_gvwr_lbs" <= ${f.maxGvwrLbs}`);
  }
  if (f.vehicleClass != null) {
    parts.push(sql`"vehicle_class" = ${f.vehicleClass}`);
  }
  if (f.superloads) parts.push(sql`"takes_superloads" = true`);
  if (f.nightMoves) parts.push(sql`"takes_night_moves" = true`);
  if (f.minInsuranceUsd != null) {
    parts.push(
      sql`"insurance_liability_usd" IS NOT NULL AND "insurance_liability_usd" >= ${f.minInsuranceUsd}`,
    );
  }
  if (f.minTier != null) {
    const allowed = VERIFICATION_TIERS.slice(VERIFICATION_TIERS.indexOf(f.minTier));
    parts.push(sql`"verification_tier" = ANY(${sql.raw(`ARRAY[${allowed.map((t) => `'${t}'`).join(',')}]`)})`);
  }

  return sql.join(parts, sql` AND `);
}

/**
 * A page of published operators matching `filters`.
 *
 * ORDERING is deliberate and is not relevance: the strongest verification tier
 * first, then the most recently confirmed. A directory whose top result is
 * whoever paid or whoever signed up first is the thing that makes trade
 * directories worthless, and sorting by a claim nobody checked is the same
 * mistake wearing a badge.
 */
export async function listOperators(
  filters: OperatorFilters,
  asOf: string,
): Promise<ListResult> {
  const offset = (filters.page - 1) * OPERATORS_PER_PAGE;
  try {
    const where = whereFor(filters);
    const result = await withDbRetry(
      () =>
        db().execute(sql`
          SELECT ${PUBLIC_COLUMNS},
                 count(*) OVER () AS "total_count"
            FROM "pilot_car_operators"
           WHERE ${where}
           ORDER BY CASE "verification_tier"
                      WHEN 'registry-verified' THEN 0
                      WHEN 'document-on-file' THEN 1
                      ELSE 2
                    END,
                    coalesce("last_confirmed_at", "updated_at") DESC NULLS LAST,
                    "business_name" ASC
           LIMIT ${OPERATORS_PER_PAGE} OFFSET ${offset}
        `),
      { label: 'pilot_car_operators list' },
    );
    const rows = rowsOf(result);
    const total = Number((rows[0] as unknown as { total_count?: unknown })?.total_count ?? rows.length);
    return {
      operators: rows.map((r) => toPublicOperator(r, asOf)),
      total: Number.isFinite(total) ? total : rows.length,
      unavailable: false,
    };
  } catch (err) {
    console.warn(`[pilotCars.store] list failed: ${describeDbError(err)}`);
    // NOT an empty list. The caller must be able to tell these apart.
    return { operators: [], total: 0, unavailable: true };
  }
}

/** One published operator by slug. `operator: null` means "not published". */
export async function getOperatorBySlug(slug: string, asOf: string): Promise<OneResult> {
  try {
    const result = await withDbRetry(
      () =>
        db().execute(sql`
          SELECT ${PUBLIC_COLUMNS}
            FROM "pilot_car_operators"
           WHERE "public_slug" = ${slug} AND "listing_status" = 'published'
           LIMIT 1
        `),
      { label: 'pilot_car_operators bySlug' },
    );
    const row = rowsOf(result)[0];
    return { operator: row ? toPublicOperator(row, asOf) : null, unavailable: false };
  } catch (err) {
    console.warn(`[pilotCars.store] bySlug failed: ${describeDbError(err)}`);
    return { operator: null, unavailable: true };
  }
}

/**
 * The operator's own record, by their manage token, at ANY status.
 *
 * Deliberately not filtered on `listing_status`: the whole point of the manage
 * link is that a pending or withdrawn record is still reachable BY ITS OWNER,
 * including to delete it. `publish_*` gating is bypassed here for the same
 * reason — an operator looking at their own record must see the private fields
 * they submitted, or they cannot correct them.
 */
export async function getOperatorByToken(token: string, asOf: string): Promise<
  OneResult & { status: string | null; private: { email: string | null; phone: string | null; contactName: string | null } | null }
> {
  try {
    const result = await withDbRetry(
      () =>
        db().execute(sql`
          SELECT ${PUBLIC_COLUMNS}
            FROM "pilot_car_operators"
           WHERE "manage_token_hash" = ${hashManageToken(token)}
           LIMIT 1
        `),
      { label: 'pilot_car_operators byToken' },
    );
    const row = rowsOf(result)[0];
    if (!row) return { operator: null, unavailable: false, status: null, private: null };
    return {
      operator: toPublicOperator({ ...row, publish_email: true, publish_phone: true, publish_contact_name: true }, asOf),
      unavailable: false,
      status: String(row.listing_status),
      private: { email: row.email, phone: row.phone, contactName: row.contact_name },
    };
  } catch (err) {
    console.warn(`[pilotCars.store] byToken failed: ${describeDbError(err)}`);
    return { operator: null, unavailable: true, status: null, private: null };
  }
}

/**
 * Create a PENDING record from a validated submission.
 *
 * `listing_status` is hardcoded `'pending'` and `verification_tier` is
 * hardcoded `'self-asserted'`. Neither is taken from the request under any
 * circumstance — a self-promoting submission body is exactly the attack that
 * turns an honest directory into the incumbents.
 */
export async function createOperator(
  input: Submission,
  asOf: string,
  now: Date = new Date(),
): Promise<WriteResult> {
  const token = newManageToken();
  const certifiedStates = certifiedStatesFrom(input.certifications, asOf);
  const base = slugify(input.businessName, input.homeBaseState ?? null);

  // A slug collision is resolved by SUFFIXING and retrying, never by reading
  // first and then writing: two submissions of the same business name in the
  // same second would both read "free" and one insert would fail anyway. The
  // unique index is the arbiter and this loop just answers it.
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
    try {
      await withDbRetry(
        () =>
          db().execute(sql`
            INSERT INTO "pilot_car_operators" (
              "public_slug", "manage_token_hash", "business_name", "contact_name", "email",
              "phone", "website", "home_base_city", "home_base_state", "service_radius_mi",
              "states_covered", "certified_states", "certifications_json",
              "reciprocity_claimed_states", "languages", "has_height_pole",
              "height_pole_max_in", "has_oversize_signs", "has_flags", "has_amber_light_bar",
              "has_two_way_radio", "vehicle_class", "vehicle_gvwr_lbs", "takes_superloads",
              "takes_night_moves", "insurance_liability_usd", "insurance_expires_on",
              "verification_tier", "publish_email", "publish_phone", "publish_contact_name",
              "listing_status", "consent_public_listing", "consent_recorded_at",
              "created_at", "updated_at", "last_confirmed_at"
            ) VALUES (
              ${slug}, ${hashManageToken(token)}, ${input.businessName},
              ${input.contactName ?? null}, ${input.email}, ${input.phone ?? null},
              ${input.website && input.website !== '' ? input.website : null},
              ${input.homeBaseCity ?? null}, ${input.homeBaseState ?? null},
              ${input.serviceRadiusMi ?? null},
              ${JSON.stringify(input.statesCovered)}::jsonb,
              ${JSON.stringify(certifiedStates)}::jsonb,
              ${JSON.stringify(input.certifications)}::jsonb,
              ${JSON.stringify(input.reciprocityClaimedStates)}::jsonb,
              ${JSON.stringify(input.languages)}::jsonb,
              ${input.hasHeightPole}, ${input.heightPoleMaxIn ?? null},
              ${input.hasOversizeSigns}, ${input.hasFlags}, ${input.hasAmberLightBar},
              ${input.hasTwoWayRadio}, ${input.vehicleClass ?? null},
              ${input.vehicleGvwrLbs ?? null}, ${input.takesSuperloads},
              ${input.takesNightMoves}, ${input.insuranceLiabilityUsd ?? null},
              ${input.insuranceExpiresOn ?? null},
              'self-asserted', ${input.publishEmail}, ${input.publishPhone},
              ${input.publishContactName}, 'pending', true, ${now.toISOString()},
              ${now.toISOString()}, ${now.toISOString()}, ${now.toISOString()}
            )
          `),
        { label: 'pilot_car_operators insert', attempts: 1 },
      );
      return { ok: true, unavailable: false, manageToken: token, slug };
    } catch (err) {
      const message = describeDbError(err);
      if (/duplicate key|unique constraint/i.test(message) && /slug/i.test(message)) continue;
      console.warn(`[pilotCars.store] insert failed: ${message}`);
      return { ok: false, unavailable: true };
    }
  }
  return {
    ok: false,
    unavailable: false,
    error: 'That business name is already listed several times over. Add your city to the name and try again.',
  };
}

/**
 * Update the operator's OWN record from their manage token.
 *
 * Re-derives `certified_states` from the submitted certifications rather than
 * taking it from the request: it is a projection of the per-state rows and a
 * second writable copy would immediately disagree with them.
 *
 * Any edit sends the record BACK TO `'pending'` unless it was already rejected
 * or withdrawn. A published record whose states and certifications can be
 * rewritten silently is a moderation queue with a hole in it.
 */
export async function updateOperatorByToken(
  token: string,
  input: Submission,
  asOf: string,
  now: Date = new Date(),
): Promise<WriteResult> {
  const certifiedStates = certifiedStatesFrom(input.certifications, asOf);
  try {
    const result = await withDbRetry(
      () =>
        db().execute(sql`
          UPDATE "pilot_car_operators" SET
            "business_name" = ${input.businessName},
            "contact_name" = ${input.contactName ?? null},
            "email" = ${input.email},
            "phone" = ${input.phone ?? null},
            "website" = ${input.website && input.website !== '' ? input.website : null},
            "home_base_city" = ${input.homeBaseCity ?? null},
            "home_base_state" = ${input.homeBaseState ?? null},
            "service_radius_mi" = ${input.serviceRadiusMi ?? null},
            "states_covered" = ${JSON.stringify(input.statesCovered)}::jsonb,
            "certified_states" = ${JSON.stringify(certifiedStates)}::jsonb,
            "certifications_json" = ${JSON.stringify(input.certifications)}::jsonb,
            "reciprocity_claimed_states" = ${JSON.stringify(input.reciprocityClaimedStates)}::jsonb,
            "languages" = ${JSON.stringify(input.languages)}::jsonb,
            "has_height_pole" = ${input.hasHeightPole},
            "height_pole_max_in" = ${input.heightPoleMaxIn ?? null},
            "has_oversize_signs" = ${input.hasOversizeSigns},
            "has_flags" = ${input.hasFlags},
            "has_amber_light_bar" = ${input.hasAmberLightBar},
            "has_two_way_radio" = ${input.hasTwoWayRadio},
            "vehicle_class" = ${input.vehicleClass ?? null},
            "vehicle_gvwr_lbs" = ${input.vehicleGvwrLbs ?? null},
            "takes_superloads" = ${input.takesSuperloads},
            "takes_night_moves" = ${input.takesNightMoves},
            "insurance_liability_usd" = ${input.insuranceLiabilityUsd ?? null},
            "insurance_expires_on" = ${input.insuranceExpiresOn ?? null},
            "publish_email" = ${input.publishEmail},
            "publish_phone" = ${input.publishPhone},
            "publish_contact_name" = ${input.publishContactName},
            -- A material edit re-enters the queue. A verified tier is NOT
            -- carried over an edit either: the document we checked described
            -- the record as it was.
            "listing_status" = CASE WHEN "listing_status" = 'published' THEN 'pending' ELSE "listing_status" END,
            "verification_tier" = 'self-asserted',
            "verification_note" = NULL,
            "verification_source_url" = NULL,
            "verified_on" = NULL,
            "updated_at" = ${now.toISOString()},
            "last_confirmed_at" = ${now.toISOString()}
          WHERE "manage_token_hash" = ${hashManageToken(token)}
        `),
      { label: 'pilot_car_operators update' },
    );
    const changed = Number((result as { count?: unknown } | null)?.count ?? 1);
    return changed > 0
      ? { ok: true, unavailable: false }
      : { ok: false, unavailable: false, error: 'That manage link does not match a listing.' };
  } catch (err) {
    console.warn(`[pilotCars.store] update failed: ${describeDbError(err)}`);
    return { ok: false, unavailable: true };
  }
}

/**
 * THE DELETION PATH. A hard `DELETE`, not a status flag.
 *
 * The record is personal data for a small business — a name, an email, often a
 * mobile number — held only because that person asked us to publish it. When
 * they ask us to stop, "published: false" is not what they asked for. There is
 * no archive copy, no soft-delete column and nothing to un-delete, which is
 * also why the confirmation on the page says the link stops working.
 */
export async function deleteOperatorByToken(token: string): Promise<WriteResult> {
  try {
    await withDbRetry(
      () =>
        db().execute(sql`
          DELETE FROM "pilot_car_operators" WHERE "manage_token_hash" = ${hashManageToken(token)}
        `),
      { label: 'pilot_car_operators delete' },
    );
    return { ok: true, unavailable: false };
  } catch (err) {
    console.warn(`[pilotCars.store] delete failed: ${describeDbError(err)}`);
    return { ok: false, unavailable: true };
  }
}

/** Withdraw a listing without deleting it — the reversible half of the pair. */
export async function setListingStatusByToken(
  token: string,
  status: 'published' | 'withdrawn',
  now: Date = new Date(),
): Promise<WriteResult> {
  try {
    await withDbRetry(
      () =>
        db().execute(sql`
          UPDATE "pilot_car_operators"
             SET "listing_status" = ${status === 'withdrawn' ? 'withdrawn' : 'pending'},
                 "updated_at" = ${now.toISOString()}
           WHERE "manage_token_hash" = ${hashManageToken(token)}
        `),
      { label: 'pilot_car_operators status' },
    );
    return { ok: true, unavailable: false };
  } catch (err) {
    console.warn(`[pilotCars.store] status failed: ${describeDbError(err)}`);
    return { ok: false, unavailable: true };
  }
}

// ── Moderation ─────────────────────────────────────────────────────────────

export interface ModerationRow extends PublicOperator {
  status: string;
}

/** The queue, newest first. Admin-only; the route enforces that, not this. */
export async function listForModeration(
  status: string,
  asOf: string,
): Promise<{ rows: ModerationRow[]; unavailable: boolean }> {
  try {
    const result = await withDbRetry(
      () =>
        db().execute(sql`
          SELECT ${PUBLIC_COLUMNS}
            FROM "pilot_car_operators"
           WHERE "listing_status" = ${status}
           ORDER BY "updated_at" DESC
           LIMIT 200
        `),
      { label: 'pilot_car_operators moderation' },
    );
    return {
      rows: rowsOf(result).map((r) => ({
        ...toPublicOperator({ ...r, publish_email: true, publish_phone: true, publish_contact_name: true }, asOf),
        status: String(r.listing_status),
      })),
      unavailable: false,
    };
  } catch (err) {
    console.warn(`[pilotCars.store] moderation list failed: ${describeDbError(err)}`);
    return { rows: [], unavailable: true };
  }
}

/**
 * A moderator decision.
 *
 * `tier` may only be raised with the evidence that justifies it:
 * `registry-verified` REQUIRES a `sourceUrl`, because that tier's whole claim is
 * "we checked it against the issuer's own register" and a tier with no link is
 * the incumbent's unfalsifiable badge.
 */
export async function moderateOperator(
  slug: string,
  decision: {
    status: 'published' | 'rejected' | 'pending';
    tier?: VerificationTier;
    note?: string | null;
    sourceUrl?: string | null;
  },
  now: Date = new Date(),
): Promise<WriteResult> {
  if (decision.tier === 'registry-verified' && !decision.sourceUrl) {
    return {
      ok: false,
      unavailable: false,
      error: 'A registry-verified tier needs the URL of the register it was checked against.',
    };
  }
  try {
    const tier = decision.tier ?? null;
    await withDbRetry(
      () =>
        db().execute(sql`
          UPDATE "pilot_car_operators" SET
            "listing_status" = ${decision.status},
            "moderation_note" = ${decision.note ?? null},
            "verification_tier" = coalesce(${tier}, "verification_tier"),
            "verification_note" = ${decision.note ?? null},
            "verification_source_url" = ${decision.sourceUrl ?? null},
            "verified_on" = ${tier && tier !== 'self-asserted' ? now.toISOString().slice(0, 10) : null},
            "updated_at" = ${now.toISOString()}
          WHERE "public_slug" = ${slug}
        `),
      { label: 'pilot_car_operators moderate' },
    );
    return { ok: true, unavailable: false };
  } catch (err) {
    console.warn(`[pilotCars.store] moderate failed: ${describeDbError(err)}`);
    return { ok: false, unavailable: true };
  }
}
