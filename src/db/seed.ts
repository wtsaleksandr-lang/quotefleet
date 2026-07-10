/**
 * Seed script. Idempotent. Run once after `pnpm db:push`. Populates:
 *  - The `ports` reference table (US/Canada)
 *  - The platform `super_admin` user (if SUPER_ADMIN_EMAIL is set)
 *  - A demo tenant `demo` with default rate cards & accessorials,
 *    so the public widget at /w/demo works out of the box for testing.
 *
 * Safe to re-run — uses onConflictDoNothing for idempotency.
 * Uses bulk inserts throughout to keep the build fast.
 */
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from './client.js';
import {
  ports,
  tenants,
  users,
  rateCards,
  accessorials,
  laneZones,
  terminals,
  aiConfigs,
  brandConfigs,
} from './schema.js';
import { PORTS_DATA } from '../data/ports.js';
import { TERMINALS_DATA, PORTS_INLAND } from '../data/terminals.js';
import {
  DEFAULT_RATE_CARDS,
  DEFAULT_ACCESSORIALS,
  generateDefaultLaneZones,
  DEFAULT_AI_SYSTEM_PROMPT,
} from '../calc/defaults.js';
import { hashPassword } from '../auth/password.js';
import { loadEnv, defaultHostDomain } from '../config.js';

async function seedPorts() {
  console.log('[seed] Upserting ports + inland intermodal hubs...');
  const allPorts = [
    ...PORTS_DATA.map((p) => ({
      code: p.code,
      name: p.name,
      city: p.city,
      state: p.state ?? null,
      country: p.country,
      lat: p.lat,
      lng: p.lng,
      teuRank: p.teuRank,
    })),
    ...PORTS_INLAND.map((p) => ({
      code: p.code,
      name: p.name,
      city: p.city,
      state: p.state,
      country: p.country,
      lat: p.lat,
      lng: p.lng,
      teuRank: p.teuRank,
    })),
  ];
  if (allPorts.length > 0) {
    await db().insert(ports).values(allPorts).onConflictDoNothing();
  }
  console.log(`[seed] ${allPorts.length} ports/hubs upserted.`);
}

async function seedTerminalsForTenant(tenantId: number) {
  if (TERMINALS_DATA.length === 0) return;
  const rows = TERMINALS_DATA.map((t, idx) => ({
    tenantId,
    portCode: t.portCode,
    code: t.code,
    name: t.name,
    carrier: t.carrier,
    address: t.address,
    lat: t.lat,
    lng: t.lng,
    notes: t.notes,
    surcharge: 0,
    enabled: true,
    sortOrder: idx,
  }));
  await db().insert(terminals).values(rows).onConflictDoNothing();
}

async function seedSuperAdmin() {
  const env = loadEnv();
  if (!env.SUPER_ADMIN_EMAIL) {
    console.log('[seed] No SUPER_ADMIN_EMAIL set — skipping super-admin user.');
    return;
  }
  const existing = await db()
    .select()
    .from(users)
    .where(eq(users.email, env.SUPER_ADMIN_EMAIL))
    .limit(1);
  if (existing.length > 0) {
    console.log(`[seed] Super-admin ${env.SUPER_ADMIN_EMAIL} already exists.`);
    return;
  }
  const tempPassword = nanoid(20);
  const hash = await hashPassword(tempPassword);
  await db()
    .insert(users)
    .values({
      email: env.SUPER_ADMIN_EMAIL,
      passwordHash: hash,
      name: 'Super Admin',
      role: 'super_admin',
      tenantId: null,
    });
  console.log('────────────────────────────────────────────────');
  console.log(`[seed] SUPER ADMIN created.`);
  console.log(`       Email:    ${env.SUPER_ADMIN_EMAIL}`);
  console.log(`       Password: ${tempPassword}`);
  console.log('       (Change this immediately after first login.)');
  console.log('────────────────────────────────────────────────');
}

async function seedDemoTenant() {
  const slug = 'demo';
  const existing = await db().select().from(tenants).where(eq(tenants.slug, slug)).limit(1);

  let tenantId: number;
  if (existing[0]) {
    tenantId = existing[0].id;
    console.log(`[seed] Demo tenant exists (id=${tenantId}) — repairing.`);
    if (existing[0].plan === 'free' && !existing[0].trialEndsAt) {
      await db()
        .update(tenants)
        .set({ plan: 'pro' })
        .where(eq(tenants.id, tenantId));
      console.log('[seed]   plan: free → pro (demo shows every feature, incl. AI)');
    }
  } else {
    const embedToken = nanoid(24);
    const [t] = await db()
      .insert(tenants)
      .values({
        slug,
        hostDomain: defaultHostDomain(),
        name: 'Demo Drayage & Trucking',
        contactEmail: 'demo@quotefleet.local',
        contactPhone: '+1 555 555 0100',
        countryFocus: 'US',
        embedToken,
        plan: 'pro',
        status: 'active',
      })
      .returning({ id: tenants.id });
    if (!t) throw new Error('Failed to insert demo tenant');
    tenantId = t.id;

    await db().insert(aiConfigs).values({
      tenantId,
      systemPrompt: DEFAULT_AI_SYSTEM_PROMPT,
      tone: 'professional',
      autoReplyEnabled: true,
      chatEnabled: true,
      modelPreference: 'auto',
    });
    await db().insert(brandConfigs).values({
      tenantId,
      displayName: 'Demo Drayage & Trucking',
      tagline: 'Instant quotes • Reliable trucks • Same-day dispatch',
      primaryColor: '#2563eb',
      accentColor: '#6E8BFF',
      ctaText: 'Get instant quote',
      showPoweredBy: true,
    });

    // Bulk insert rate cards, accessorials, lane zones
    if (DEFAULT_RATE_CARDS.length > 0) {
      await db().insert(rateCards).values(DEFAULT_RATE_CARDS.map((c) => ({ ...c, tenantId })));
    }
    if (DEFAULT_ACCESSORIALS.length > 0) {
      await db().insert(accessorials).values(DEFAULT_ACCESSORIALS.map((a) => ({ ...a, tenantId })));
    }
    const zones = generateDefaultLaneZones();
    if (zones.length > 0) {
      await db().insert(laneZones).values(zones.map((z) => ({ ...z, tenantId })));
    }
    console.log(`[seed] Demo tenant created (id=${tenantId}, embed=${embedToken}).`);
  }

  await seedTerminalsForTenant(tenantId);
  console.log(`[seed] Demo tenant terminals upserted (${TERMINALS_DATA.length} rows).`);

  const host = defaultHostDomain();
  console.log(`[seed] Demo widget: /w/${slug}  ·  ${slug}.${host}`);
}

async function main() {
  console.log('[seed] Starting…');
  await seedPorts();
  await seedSuperAdmin();
  await seedDemoTenant();
  console.log('[seed] Done.');
}

main().catch((err) => {
  console.error('[seed] Failed:', err);
  process.exit(1);
});
