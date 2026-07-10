import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');
const routesDir = resolve(process.cwd(), 'src/server/routes');

async function pub(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}
async function route(name: string) {
  return readFile(resolve(routesDir, name), 'utf8');
}

describe('account phone + company details consolidation', () => {
  it('adds a phone field bound to contactPhone in the Profile card', async () => {
    const app = await pub('app.js');
    expect(app).toContain("profileRow('Phone', 'contactPhone', 'tel')");
  });

  it('adds a Company details card wired to the real stores (no parallel copy)', async () => {
    const app = await pub('app.js');
    expect(app).toContain("text: 'Company details'");
    expect(app).toContain('Shown to your customers on your calculator and quotes');
    // Address -> carrier-profile, dispatch email -> profile, USDOT/MC -> marketplace-settings.
    expect(app).toContain("api('/api/tenant/carrier-profile'");
    expect(app).toContain("api('/api/tenant/marketplace-settings'");
    expect(app).toContain("coField('Dispatch email', 'contactEmail'");
    expect(app).toContain("coField('USDOT number', 'dotNumber'");
    expect(app).toContain("coField('MC number', 'mcNumber'");
    expect(app).toContain("coField('Address line 1', 'addressLine1'");
  });

  it('profile route accepts + persists tenant contactEmail and contactPhone', async () => {
    const auth = await route('auth.ts');
    expect(auth).toContain('contactEmail: z.string().email().max(200).nullable().optional()');
    expect(auth).toContain('tenantUpdate.contactEmail = parse.data.contactEmail');
    expect(auth).toContain('tenantUpdate.contactPhone = parse.data.contactPhone');
    // /api/auth/me exposes them so the Account page can prefill.
    expect(auth).toContain('contactEmail: t[0].contactEmail ?? null');
    expect(auth).toContain('contactPhone: t[0].contactPhone ?? null');
  });

  it('carrier-profile PUT merges instead of replacing (split editors are safe)', async () => {
    const cp = await route('carrierProfile.ts');
    expect(cp).toContain('const existing = await loadCarrierProfile(req.tenant!.id)');
    expect(cp).toContain('{ ...existing, ...normalize(parsed.data) }');
  });

  it('de-duplicates: Brand carrier-profile card drops address fields', async () => {
    const carrier = await pub('app-carrier-profile.js');
    expect(carrier).not.toContain("['addressLine1', 'Address line 1']");
    expect(carrier).not.toContain("['city', 'City']");
    expect(carrier).toContain("['quoteContactName', 'Quote contact name']");
    expect(carrier).toContain("['scac', 'SCAC']");
  });

  it('widget renders a contact block from the public config', async () => {
    const publicRoute = await route('public.ts');
    expect(publicRoute).toContain('contact,');
    expect(publicRoute).toContain('phone: tenant.contactPhone || null');
    expect(publicRoute).toContain('email: tenant.contactEmail || null');

    const html = await pub('widget.html');
    expect(html).toContain('id="qf-contact"');

    const js = await pub('widget.js');
    expect(js).toContain('renderContact(cfg.contact)');
    expect(js).toContain('function renderContact(contact)');
  });
});
