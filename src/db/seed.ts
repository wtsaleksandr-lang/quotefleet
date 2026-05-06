/**
 * Seed script. Idempotent. Run once after `pnpm db:push`. Populates:
 *  - The `ports` reference table (US/Canada)
 *  - The platform `super_admin` user (if SUPER_ADMIN_EMAIL is set)
 *  - A demo tenant `demo` with default rate cards & accessorials,
 *    so the public widget at /w/demo works out of the box for testing.
 *
 * Safe to re-run — uses onConflictDoNothing for idempotency.
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
  for (const p of PORTS_DATA) {
    await db()
      .insert(ports)
      .values({
        code: p.code,
        name: p.name,
        city: p.city,
        state: p.state ?? null,
        country: p.country,
        lat: p.lat,
        lng: p.lng,
        teuRank: p.teuRank,
      })
      .onConflictDoNothing();
  }
  // Inland intermodal hubs (Chicago, Memphis, etc.) are surfaced as
  // synthetic "ports" so the widget treats them uniformly.
  for (const p of PORTS_INLAND) {
    await db()
      .insert(ports)
      .values({
        code: p.code,
        name: p.name,
        city: p.city,
        state: p.state,
        country: p.country,
        lat: p.lat,
        lng: p.lng,
        teuRank: p.teuRank,
      })
      .onConflictDoNothing();
  }
  console.log(
    `[seed] ${PORTS_DATA.length + PORTS_INLAND.length} ports/hubs upserted.`
  );
}

async function seedTerminalsForTenant(tenantId: number) {
  let idx = 0;
  for (const t of TERMINALS_DATA) {
    await db()
      .insert(terminals)
      .values({
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
        sortOrder: idx++,
      })
      .onConflictDoNothing();
  }
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
  if (existing[0]) {
    console.log('[seed] Demo tenant already exists — skipping.');
    return;
  }

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
      plan: 'free',
      status: 'active',
    })
    .returning({ id: tenants.id });
  if (!t) throw new Error('Failed to insert demo tenant');

  // ai_config + brand_config
  await db().insert(aiConfigs).values({
    tenantId: t.id,
    systemPrompt: DEFAULT_AI_SYSTEM_PROMPT,
    tone: 'professional',
    autoReplyEnabled: true,
    chatEnabled: true,
    modelPreference: 'auto',
  });
  await db().insert(brandConfigs).values({
    tenantId: t.id,
    displayName: 'Demo Drayage & Trucking',
    tagline: 'Instant quotes • Reliable trucks • Same-day dispatch',
    primaryColor: '#2563eb',
    accentColor: '#06b6d4',
    ctaText: 'Get instant quote',
    showPoweredBy: true,
  });

  // Rate cards
  for (const card of DEFAULT_RATE_CARDS) {
    await db().insert(rateCards).values({ ...card, tenantId: t.id });
  }
  // Accessorials
  for (const a of DEFAULT_ACCESSORIALS) {
    await db().insert(accessorials).values({ ...a, tenantId: t.id });
  }
  // Lane zones
  for (const z of generateDefaultLaneZones()) {
    await db().insert(laneZones).values({ ...z, tenantId: t.id });
  }
  // Terminals (full set; carrier disables ones they don't serve later)
  await seedTerminalsForTenant(t.id);

  const host = defaultHostDomain();
  console.log(`[seed] Demo tenant created at https://${slug}.${host}/`);
  console.log(`       Legacy widget URL still works: /w/${slug}`);
  console.log(`       Embed token: ${embedToken}`);
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
