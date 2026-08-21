/**
 * Shared tenant-provisioning core.
 *
 * The atomic "create a brand-new trial tenant + its owner user + all the
 * seed rows (ai config, brand, rate cards, accessorials, lane zones,
 * terminals)" transaction lived inline in the email/password signup route.
 * Social login (src/server/routes/oauth.ts) needs the EXACT same tenant
 * creation for a first-time OAuth user, so it's factored here and shared —
 * never duplicated — by both entry points.
 *
 * The password-signup route keeps its own user-facing slug validation (it
 * returns specific "reserved" / "taken" errors); it passes the already
 * resolved slug + host domain in. The OAuth route has no slug field, so it
 * derives one from the company name via deriveAvailableSlug().
 */
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../../db/client.js';
import {
  tenants,
  users,
  rateCards,
  accessorials,
  laneZones,
  terminals,
  aiConfigs,
  brandConfigs,
} from '../../db/schema.js';
import {
  DEFAULT_RATE_CARDS,
  DEFAULT_ACCESSORIALS,
  generateDefaultLaneZones,
  DEFAULT_AI_SYSTEM_PROMPT,
} from '../../calc/defaults.js';
import { TERMINALS_DATA } from '../../data/terminals.js';
import { defaultHostDomain } from '../../config.js';

export const TRIAL_DAYS = 14;

export const RESERVED_SLUGS = new Set([
  'www', 'app', 'admin', 'api', 'mail', 'docs', 'help', 'status', 'static',
  'cdn', 'assets', 'login', 'signup', 'logout', 'pricing', 'about', 'blog',
  'support', 'demo', 'test', 'staging', 'dev', 'public', 'private',
  'auth', 'oauth', 'embed', 'widget', 'chat', 'webhook', 'webhooks',
]);

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40);
}

/**
 * Derive a free, reserved-safe slug from a company name (or email local part).
 * Used by the OAuth signup path, which has no user-supplied slug. Appends a
 * numeric suffix on collision, then a random suffix as the last resort. The
 * tenant insert has a UNIQUE(slug) constraint that is the final race guard.
 */
export async function deriveAvailableSlug(companyName: string): Promise<string> {
  const base = slugify(companyName) || 'co';
  let slug = base;
  let n = 0;
  while (
    RESERVED_SLUGS.has(slug) ||
    (await db().select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug)).limit(1))[0]
  ) {
    n++;
    slug = `${base}-${n}`;
    if (n > 50) {
      slug = `${base}-${nanoid(6).toLowerCase()}`;
      break;
    }
  }
  return slug;
}

/** Which nullable users.* column stores this provider's stable subject id. */
export type OAuthSubColumn = 'googleSub' | 'microsoftSub' | 'metaSub' | 'appleSub';

export interface ProvisionTenantInput {
  companyName: string;
  /** Normalized (lowercased) login email. */
  email: string;
  /** bcrypt hash. For OAuth users this is a random unusable hash. */
  passwordHash: string;
  countryFocus: 'US' | 'CA' | 'BOTH';
  contactPhone?: string | null;
  /** Owner display name. Falls back to companyName. */
  ownerName?: string | null;
  dpaVersion: string;
  /** Final slug — resolved + validated by the caller. */
  slug: string;
  /** Final host domain — falls back to the platform default. */
  hostDomain?: string;
  /** When present, stamps the provider sub on the new owner user so a repeat
   *  social login matches this account directly. */
  oauth?: { column: OAuthSubColumn; sub: string };
}

export interface ProvisionTenantResult {
  tenantId: number;
  userId: number;
  slug: string;
  hostDomain: string;
  embedToken: string;
  trialEndsAt: Date;
}

/**
 * Atomically create a trial tenant + its owner user + all seed rows.
 * All-or-nothing: a failure halfway rolls back so we never leave an orphaned
 * tenant with no login. Throws on failure (callers map to their own error
 * response); a duplicate-slug race surfaces as a unique-violation error.
 */
export async function provisionTrialTenant(
  input: ProvisionTenantInput
): Promise<ProvisionTenantResult> {
  const hostDomain = input.hostDomain || defaultHostDomain();
  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  const embedToken = nanoid(24);
  const ownerName = input.ownerName?.trim() || input.companyName;

  const result = await db().transaction(async (tx) => {
    const [t] = await tx
      .insert(tenants)
      .values({
        slug: input.slug,
        hostDomain,
        name: input.companyName,
        contactEmail: input.email,
        contactPhone: input.contactPhone ?? null,
        countryFocus: input.countryFocus,
        embedToken,
        plan: 'free',
        status: 'active',
        trialEndsAt,
        dpaAcceptedAt: new Date(),
        dpaVersion: input.dpaVersion,
      })
      .returning({ id: tenants.id });
    if (!t) throw new Error('tenant insert returned no row');

    await tx.insert(aiConfigs).values({
      tenantId: t.id,
      systemPrompt: DEFAULT_AI_SYSTEM_PROMPT,
      tone: 'professional',
      autoReplyEnabled: true,
      chatEnabled: true,
    });
    await tx.insert(brandConfigs).values({
      tenantId: t.id,
      displayName: input.companyName,
      tagline: 'Instant freight quotes',
      primaryColor: '#2563eb',
      accentColor: '#6E8BFF',
      ctaText: 'Get instant quote',
      showPoweredBy: true,
    });
    if (DEFAULT_RATE_CARDS.length > 0) {
      await tx.insert(rateCards).values(
        DEFAULT_RATE_CARDS.map((c) => ({ ...c, tenantId: t.id }))
      );
    }
    if (DEFAULT_ACCESSORIALS.length > 0) {
      await tx.insert(accessorials).values(
        DEFAULT_ACCESSORIALS.map((a) => ({ ...a, tenantId: t.id }))
      );
    }
    const zones = generateDefaultLaneZones();
    if (zones.length > 0) {
      await tx.insert(laneZones).values(zones.map((z) => ({ ...z, tenantId: t.id })));
    }
    if (TERMINALS_DATA.length > 0) {
      await tx.insert(terminals).values(
        TERMINALS_DATA.map((term, idx) => ({
          tenantId: t.id,
          portCode: term.portCode,
          code: term.code,
          name: term.name,
          carrier: term.carrier,
          address: term.address,
          lat: term.lat,
          lng: term.lng,
          notes: term.notes,
          surcharge: 0,
          enabled: true,
          sortOrder: idx,
        }))
      );
    }

    const [u] = await tx
      .insert(users)
      .values({
        tenantId: t.id,
        email: input.email,
        passwordHash: input.passwordHash,
        role: 'tenant_owner',
        name: ownerName,
        ...(input.oauth ? { [input.oauth.column]: input.oauth.sub } : {}),
      })
      .returning({ id: users.id });
    if (!u) throw new Error('user insert returned no row');

    return { tenantId: t.id, userId: u.id };
  });

  return {
    tenantId: result.tenantId,
    userId: result.userId,
    slug: input.slug,
    hostDomain,
    embedToken,
    trialEndsAt,
  };
}
