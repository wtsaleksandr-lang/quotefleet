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
import { pathToFileURL } from 'node:url';
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
  platformSettings,
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

// ── Demo carrier profile ─────────────────────────────────────────────
// A credible sample carrier so prospects who click "View demo" / open
// /w/demo see a finished, trustworthy page — not skeleton "Your company
// name / USDOT # · MC # / demo@quotefleet.local". Fictional but coherent
// (Long Beach port drayage + FTL/LTL). Kept in one place so both the
// fresh-insert and the idempotent repair path apply the same values.
const DEMO_LOGO_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 96 96'>" +
  "<rect width='96' height='96' rx='22' fill='#0D3CFC'/>" +
  "<text x='48' y='63' font-family='Arial, Helvetica, sans-serif' font-size='40' " +
  "font-weight='700' fill='#ffffff' text-anchor='middle'>HL</text></svg>";
// base64 data URI — valid both as an <img src> AND inside a CSS url()
// (the demo "brand it yourself" preview paints this logo as a
// background-image). Avoids the quoting pitfalls of a `;utf8,`-encoded SVG.
const DEMO_LOGO_URL =
  'data:image/svg+xml;base64,' + Buffer.from(DEMO_LOGO_SVG, 'utf8').toString('base64');

export const DEMO_PROFILE = {
  name: 'Harbor Link Logistics',
  contactEmail: 'dispatch@harborlinklogistics.com',
  // Opt-in public email the demo carrier chose to show customers. Set explicitly
  // (a real business address, not a login) so the demo's public quote renders a
  // contact email — exercising the "publicContactEmail is set" path.
  publicContactEmail: 'dispatch@harborlinklogistics.com',
  contactPhone: '+1 (562) 555-0184',
  countryFocus: 'US',
  mcNumber: '748213',
  dotNumber: '2914776',
  brand: {
    displayName: 'Harbor Link Logistics',
    tagline: 'Port drayage, FTL & LTL across the West — instant rates, same-day dispatch',
    primaryColor: '#0D3CFC',
    accentColor: '#6E8BFF',
    ctaText: 'Get instant quote',
    logoUrl: DEMO_LOGO_URL,
    showPoweredBy: true,
  },
  carrierProfile: {
    addressLine1: '1450 Pier F Avenue',
    addressLine2: 'Suite 210',
    city: 'Long Beach',
    state: 'CA',
    postalCode: '90802',
    country: 'US',
    scac: 'HRLK',
    websiteUrl: 'https://harborlinklogistics.com',
    quoteContactName: 'Marisol Vega',
  },
} as const;

/** Applies the demo carrier profile to a tenant. Idempotent — safe to run
 *  on every seed so a pre-existing PROD demo row (which is NOT re-inserted)
 *  still gets the filled-in name/contact/authority/address/brand/logo. */
async function applyDemoProfile(tenantId: number) {
  await db()
    .update(tenants)
    .set({
      name: DEMO_PROFILE.name,
      contactEmail: DEMO_PROFILE.contactEmail,
      publicContactEmail: DEMO_PROFILE.publicContactEmail,
      contactPhone: DEMO_PROFILE.contactPhone,
      countryFocus: DEMO_PROFILE.countryFocus,
      mcNumber: DEMO_PROFILE.mcNumber,
      dotNumber: DEMO_PROFILE.dotNumber,
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, tenantId));

  await db()
    .insert(brandConfigs)
    .values({ tenantId, ...DEMO_PROFILE.brand })
    .onConflictDoUpdate({
      target: brandConfigs.tenantId,
      set: { ...DEMO_PROFILE.brand, updatedAt: new Date() },
    });

  const carrierKey = `tenant:${tenantId}:carrier-profile`;
  const carrierValue = JSON.stringify(DEMO_PROFILE.carrierProfile);
  await db()
    .insert(platformSettings)
    .values({ key: carrierKey, value: carrierValue })
    .onConflictDoUpdate({
      target: platformSettings.key,
      set: { value: carrierValue, updatedAt: new Date() },
    });
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
        name: DEMO_PROFILE.name,
        contactEmail: DEMO_PROFILE.contactEmail,
        publicContactEmail: DEMO_PROFILE.publicContactEmail,
        contactPhone: DEMO_PROFILE.contactPhone,
        countryFocus: DEMO_PROFILE.countryFocus,
        mcNumber: DEMO_PROFILE.mcNumber,
        dotNumber: DEMO_PROFILE.dotNumber,
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

  // Always (re)apply the credible demo profile — brand, logo, contact,
  // authority, address — so an existing PROD demo row is filled in too.
  await applyDemoProfile(tenantId);
  console.log(`[seed] Demo profile applied (${DEMO_PROFILE.name}).`);

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

// Only run the seed when invoked directly (`tsx src/db/seed.ts`). Importing
// this module (e.g. from tests, to reuse DEMO_PROFILE) must NOT hit the DB.
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error('[seed] Failed:', err);
    process.exit(1);
  });
}
