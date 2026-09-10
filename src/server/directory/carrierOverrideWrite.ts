/**
 * The ONE write path for `carrier_overrides` — the survive-the-ingest edit
 * layer on top of a carrier_directory row (merged on read by carrierBySlug).
 *
 * Extracted from routes/admin.ts so it is shared, never duplicated, by:
 *   - POST /api/admin/carrier/:usdot/override (super-admin edit), and
 *   - the profile-claim flow (src/server/directory/claims.ts), which sets the
 *     public email to the verified claimant's address.
 *
 * Behaviour is byte-identical to the admin original: same validation, same
 * partial-upsert semantics, same audit row (action 'admin.carrier.override').
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client.js';
import {
  auditLog,
  carrierDirectory,
  carrierOverrides,
  type NewCarrierOverrideRow,
} from '../../db/schema.js';
import { normalizeDot } from './carrierIngest.js';

/** Best-effort audit write for super-admin mutations. Mirrors the app-wide
 *  `insert(auditLog)` shape (tenant.ts / inbound.ts) but stamps
 *  `actorKind: 'super_admin'` and the acting operator's user id. Scoped to the
 *  TARGET tenant so the entry surfaces in that tenant's audit log. Never blocks
 *  the response — a failed audit is logged, not thrown. */
export async function recordAdminAudit(
  tenantId: number | null,
  userId: number | null | undefined,
  action: string,
  details: Record<string, unknown>
): Promise<void> {
  try {
    await db().insert(auditLog).values({
      tenantId,
      userId: userId ?? null,
      action,
      actorKind: 'super_admin',
      detailsJson: details,
    });
  } catch (err) {
    console.error('[admin] audit write failed:', err);
  }
}

/**
 * Schema for `POST /api/admin/carrier/:usdot/override`. Every field is optional
 * (partial upsert) and nullable (null clears the override → the profile falls
 * back to the FMCSA value). `.strict()` rejects unknown keys with a clean 400.
 * `capabilities` keys match CarrierCapabilities (schema.ts) 1:1.
 */
export const CarrierOverridePatch = z
  .object({
    about: z.string().max(4000).nullable().optional(),
    // `''` allowed so an admin can clear the email override; normalized to null.
    email: z.string().max(320).email().or(z.literal('')).nullable().optional(),
    phone: z.string().max(40).nullable().optional(),
    hidden: z.boolean().nullable().optional(),
    capabilities: z
      .object({
        uiia: z.boolean().optional(),
        twic: z.boolean().optional(),
        bonded: z.boolean().optional(),
        reefer: z.boolean().optional(),
        transload: z.boolean().optional(),
        yard: z.boolean().optional(),
      })
      .strict()
      .nullable()
      .optional(),
    // Carrier-declared OTHER operating cities/terminals (metros beyond the single
    // FMCSA HQ). Array of `{ city, state }` with a 2-letter state; capped at 25.
    // `[]` / null clears it. City trimmed; state upper-cased in the write below.
    operatingLocations: z
      .array(
        z
          .object({
            city: z.string().trim().min(1).max(80),
            state: z
              .string()
              .trim()
              .regex(/^[A-Za-z]{2}$/, 'state must be a 2-letter code'),
          })
          .strict(),
      )
      .max(25)
      .nullable()
      .optional(),
  })
  .strict();
export type CarrierOverridePatch = z.infer<typeof CarrierOverridePatch>;

/**
 * Core of `POST /api/admin/carrier/:usdot/override`, extracted so it is
 * unit-testable (same pattern as patchTenantAdmin). Upserts a `carrier_overrides`
 * row — the write path the admin UI, the AI-Copilot tool and the claim flow call.
 *
 *  - Validates input; unknown/invalid field → 400.
 *  - USDOT is normalized (leading zeros stripped) to match carrier_directory.
 *  - A USDOT not present in carrier_directory → 404 (never orphan an override).
 *  - On success, writes an audit row and returns the upserted override.
 *
 * This table is NEVER touched by the FMCSA re-ingest, so the override persists
 * across every re-ingest (the merge re-applies it on read via carrierBySlug).
 */
export async function upsertCarrierOverride(opts: {
  usdot: string;
  body: unknown;
  actorUserId?: number | null;
  actorLabel?: string | null;
}): Promise<{ status: number; json: Record<string, unknown> }> {
  const usdot = normalizeDot(opts.usdot);
  if (!usdot) return { status: 400, json: { error: 'Invalid USDOT number.' } };

  const parse = CarrierOverridePatch.safeParse(opts.body);
  if (!parse.success) {
    return { status: 400, json: { error: 'Invalid input', details: parse.error.flatten() } };
  }
  if (Object.keys(parse.data).length === 0) {
    return { status: 400, json: { error: 'No override fields provided.' } };
  }

  // Never create an override for a USDOT that isn't in the public directory.
  const existing = await db()
    .select({ usdot: carrierDirectory.usdot })
    .from(carrierDirectory)
    .where(eq(carrierDirectory.usdot, usdot))
    .limit(1);
  if (!existing[0]) {
    return { status: 404, json: { error: `No carrier with USDOT '${usdot}'.` } };
  }

  const blankToNull = (v: string | null | undefined): string | null =>
    v == null || v.trim() === '' ? null : v;
  // Only the fields the caller SENT are written (partial upsert); updatedAt /
  // updatedBy are always refreshed.
  const set: Partial<NewCarrierOverrideRow> = {
    updatedAt: new Date(),
    updatedBy: opts.actorLabel ?? (opts.actorUserId != null ? String(opts.actorUserId) : null),
  };
  const d = parse.data;
  if ('about' in d) set.aboutOverride = blankToNull(d.about ?? null);
  if ('email' in d) set.emailOverride = blankToNull(d.email ?? null);
  if ('phone' in d) set.phoneOverride = blankToNull(d.phone ?? null);
  if ('hidden' in d) set.hidden = d.hidden ?? null;
  if ('capabilities' in d) set.capabilities = d.capabilities ?? null;
  if ('operatingLocations' in d) {
    // Normalize state to upper-case; an empty array clears the override (→ null).
    const list = d.operatingLocations;
    set.operatingLocations =
      list && list.length ? list.map((l) => ({ city: l.city, state: l.state.toUpperCase() })) : null;
  }

  const upserted = await db()
    .insert(carrierOverrides)
    .values({ usdot, ...set })
    .onConflictDoUpdate({ target: carrierOverrides.usdot, set })
    .returning();

  // Global (not tenant-scoped) admin action → audit with a null tenantId.
  await recordAdminAudit(null, opts.actorUserId, 'admin.carrier.override', {
    usdot,
    fields: Object.keys(d),
  });

  return { status: 200, json: { ok: true, override: upserted[0] ?? null } };
}
