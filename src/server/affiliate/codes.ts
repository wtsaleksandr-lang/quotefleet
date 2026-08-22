/**
 * Referral/affiliate CODE minting + resolution (DB-touching).
 *
 * A code lives in ONE of two namespaces but shares a single global keyspace so a
 * `?ref=<code>` resolves unambiguously:
 *   • tenants.referral_code   — a peer-referral code (every tenant owns one)
 *   • affiliates.code         — a public affiliate's code
 * mintUniqueCode() therefore checks BOTH tables before returning.
 */
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { tenants, affiliates } from '../../db/schema.js';
import { generateCode, normalizeCode } from './programs.js';

/** True when `code` is already used by a tenant OR an affiliate. */
export async function codeExists(code: string): Promise<boolean> {
  const [t, a] = await Promise.all([
    db().select({ id: tenants.id }).from(tenants).where(eq(tenants.referralCode, code)).limit(1),
    db().select({ id: affiliates.id }).from(affiliates).where(eq(affiliates.code, code)).limit(1),
  ]);
  return !!t[0] || !!a[0];
}

/**
 * Mint a globally-unique code. Retries on collision; falls back to a longer code
 * after several tries so it always terminates. The DB UNIQUE constraints on both
 * columns are the final race guard (callers handle the unique-violation error).
 */
export async function mintUniqueCode(maxTries = 8): Promise<string> {
  for (let i = 0; i < maxTries; i++) {
    const code = generateCode();
    if (!(await codeExists(code))) return code;
  }
  // Last resort: append entropy so this effectively never collides.
  const fallback = normalizeCode(generateCode() + generateCode()).slice(0, 12);
  return fallback;
}

/**
 * Ensure a tenant has a referral code, minting + persisting one if missing.
 * Idempotent: returns the existing code when already set. Used both in the
 * provision path and as a lazy backfill for tenants created before this feature.
 */
export async function ensureTenantReferralCode(tenantId: number): Promise<string> {
  const row = (
    await db().select({ code: tenants.referralCode }).from(tenants).where(eq(tenants.id, tenantId)).limit(1)
  )[0];
  if (row?.code) return row.code;
  const code = await mintUniqueCode();
  await db().update(tenants).set({ referralCode: code }).where(eq(tenants.id, tenantId));
  return code;
}

export type CodeOwner =
  | { kind: 'referral'; tenantId: number; ownerEmail: string | null }
  | { kind: 'affiliate'; affiliateId: number; ownerEmail: string | null; ownerTenantId: number | null }
  | null;

/** Resolve a code to its owner (tenant referral or affiliate), or null. */
export async function resolveCodeOwner(rawCode: string): Promise<CodeOwner> {
  const code = normalizeCode(rawCode);
  if (!code) return null;
  const t = (
    await db()
      .select({ id: tenants.id, email: tenants.contactEmail })
      .from(tenants)
      .where(eq(tenants.referralCode, code))
      .limit(1)
  )[0];
  if (t) return { kind: 'referral', tenantId: t.id, ownerEmail: t.email ?? null };
  const a = (
    await db()
      .select({
        id: affiliates.id,
        email: affiliates.email,
        ownerTenantId: affiliates.ownerTenantId,
        status: affiliates.status,
      })
      .from(affiliates)
      .where(eq(affiliates.code, code))
      .limit(1)
  )[0];
  if (a) {
    // Only an ACTIVE affiliate attributes. A suspended/pending affiliate's link
    // must not track signups or estimate earnings — treat it as no-owner so the
    // click resolves like any unknown code. Tenant referral codes are unaffected.
    if (a.status !== 'active') return null;
    return {
      kind: 'affiliate',
      affiliateId: a.id,
      ownerEmail: a.email ?? null,
      ownerTenantId: a.ownerTenantId ?? null,
    };
  }
  return null;
}
