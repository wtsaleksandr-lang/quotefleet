import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');
const routesDir = resolve(process.cwd(), 'src/server/routes');

async function pub(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('onboarding wizard — client overlay', () => {
  it('ships the wizard js + css and exposes the open() API', async () => {
    const js = await pub('onboarding-wizard.js');
    const css = await pub('onboarding-wizard.css');
    expect(js).toContain('window.QFOnboardingWizard');
    expect(js).toContain('/api/tenant/onboarding/apply');
    expect(js).toContain('Skip for now');
    // the four steps, in order: modes → area → quoting → confirm
    expect(js).toContain('What do you haul?');
    expect(js).toContain('Where do you operate?');
    expect(js).toContain('How should we quote?');
    expect(js).toContain('Confirm your top 3 rates');
    // The standalone pricing-mode step was dropped — the pricing model is
    // DERIVED from the first mode and the engine ignores an explicit choice, so
    // asking it as its own screen read as dummy filler.
    expect(js).not.toContain('How do you price it?');
    // The brand-color step was removed — branding isn't needed to produce a
    // working calculator and the dashboard already nudges for it.
    expect(js).not.toContain('Make it yours');
    expect(js).not.toContain('qf-ob-swatch');
    // The single-lane question was replaced by a real service area.
    expect(js).not.toContain('Your main lane?');
    // all six verticals present in the picker
    for (const v of ['drayage', 'dryvan_ftl', 'reefer', 'ltl', 'hotshot', 'flatbed']) {
      expect(js).toContain(v);
    }
    expect(css).toContain('.qf-ob-overlay');
    expect(css).toContain('.qf-ob-card');
  });

  it('adds the confirm-top-3-rates finish step (step 4 of 4)', async () => {
    const js = await pub('onboarding-wizard.js');
    const css = await pub('onboarding-wizard.css');

    // Four steps: modes → service area → quoting rules → confirm. The standalone
    // pricing-mode screen was removed (mode-derived + engine-ignored).
    expect(js).toContain('var STEPS = 4');
    for (const n of [1, 2, 3, 4]) expect(js).toContain(`Step ${n} of 4`);
    expect(js).toContain('Confirm your top 3 rates');
    // No stale "of 5" kicker strings survive the removal.
    expect(js).not.toContain('of 5');

    // Rates are fetched AFTER apply (so the reseed has run) and capped at 3 by
    // sortOrder.
    expect(js).toContain('/api/tenant/rate-cards');
    expect(js).toContain('.slice(0, 3)');
    expect(js).toContain('sortOrder');

    // The primary price field is picked from the non-zero candidate.
    expect(js).toContain("'ratePerMile', 'flatFee', 'minimumCharge'");

    // Edits persist via a PUT of the single changed field on Finish; rows are
    // never deleted (which would flip setup-status.rates back to false).
    expect(js).toContain("method: 'PUT'");
    expect(js).not.toContain("method: 'DELETE'");

    // Copy-link control copies the hosted URL and marks the embed as viewed.
    expect(js).toContain('hostedUrl');
    expect(js).toContain('navigator.clipboard');
    expect(js).toContain('Copy link');
    expect(js).toContain('qf-embed-viewed');

    // Scoped styles for the new step.
    expect(css).toContain('.qf-ob-rate-row');
    expect(css).toContain('.qf-ob-rate-price');
    expect(css).toContain('.qf-ob-copyrow');
    expect(css).toContain('.qf-ob-copy-btn');
  });

  it('asks the quoting rules (fuel surcharge + who sees prices) on step 3', async () => {
    const js = await pub('onboarding-wizard.js');
    const css = await pub('onboarding-wizard.css');

    expect(js).toContain('Step 3 of 4');
    expect(js).toContain('How should we quote?');
    // Fuel surcharge — auto is the DEFAULT (quotes stay current on their own).
    expect(js).toContain('Track diesel automatically');
    expect(js).toContain('Use my own fixed %');
    expect(js).toContain("fscMode: 'auto'");
    // Access — public is the DEFAULT, matching tenants.accessMode's own default
    // so an untouched/skipped wizard never changes existing behavior.
    expect(js).toContain('Show prices instantly');
    expect(js).toContain('Capture contact first');
    expect(js).toContain("accessMode: 'public'");
    // The manual percentage is only sent in manual mode.
    expect(js).toContain("state.fscMode === 'manual'");
    expect(js).toContain('fscPercent');

    // Help copy is a left-aligned hint block, and selected cards stay
    // outline+tint (never a bright solid fill).
    expect(css).toContain('.qf-ob-hint');
    expect(css).toContain('.qf-ob-group-label');
    expect(css).toContain('text-align: left');
  });

  it('collects the OPTIONAL trust details on the final step', async () => {
    const js = await pub('onboarding-wizard.js');
    const css = await pub('onboarding-wizard.css');

    expect(js).toContain('Trust details — optional');
    expect(js).toContain('MC number');
    expect(js).toContain('DOT number');
    expect(js).toContain('Public contact email');
    expect(js).toContain('mcNumber');
    expect(js).toContain('dotNumber');
    expect(js).toContain('publicContactEmail');
    // The public address must NEVER be pre-filled from the operator's private
    // login email (me.email / tenant.contactEmail).
    expect(js).not.toContain('me.email');
    expect(js).not.toContain('contactEmail:');
    expect(js).not.toContain('t.contactEmail');
    // MC + DOT pair 2-up so neither is ever stranded alone on a line.
    expect(css).toContain('.qf-ob-trust');
    expect(css).toContain('.qf-ob-trust-wide');
  });

  it('is loaded + gated in the dashboard shell', async () => {
    const html = await pub('app.html');
    const appjs = await pub('app.js');
    expect(html).toContain('/onboarding-wizard.js');
    expect(html).toContain('/onboarding-wizard.css');
    // boot() gates on the SERVER flag, not localStorage
    expect(appjs).toContain('needsOnboarding');
    expect(appjs).toContain('QFOnboardingWizard');
  });
});

describe('onboarding wizard — server apply endpoint', () => {
  it('registers the apply route with the first-run pristine guard', async () => {
    const tenant = await readFile(resolve(routesDir, 'tenant.ts'), 'utf8');
    expect(tenant).toContain("/api/tenant/onboarding/apply");
    expect(tenant).toContain('isSeedPristine');
    expect(tenant).toContain('getSeedTemplate');
    // reseed only when NOT already completed AND seed is pristine
    expect(tenant).toContain('!alreadyCompleted && pristine');
  });

  it('accepts + persists the quoting rules and trust details, all optional', async () => {
    const tenant = await readFile(resolve(routesDir, 'tenant.ts'), 'utf8');

    // zod — every new field is OPTIONAL so Skip and older clients still work.
    expect(tenant).toContain("fscMode: z.enum(['manual', 'auto']).optional()");
    expect(tenant).toContain('fscPercent: z.number().min(0).max(100).optional()');
    expect(tenant).toContain("accessMode: z.enum(['public', 'private']).optional()");
    expect(tenant).toContain('mcNumber: z.string().max(40).nullable().optional()');
    expect(tenant).toContain('dotNumber: z.string().max(40).nullable().optional()');
    // Email is validated but an empty string is accepted (and normalised to
    // null server-side) so the field can be cleared.
    expect(tenant).toContain(".union([z.string().email().max(160), z.literal('')])");
    expect(tenant).toMatch(/publicContactEmail: z[\s\S]{0,200}?\.nullable\(\)\s*\.optional\(\)/);

    // Persisted onto the tenants row, and ONLY when the client sent the key —
    // an omitted field must never overwrite a value set elsewhere in Settings.
    expect(tenant).toContain('const settingsPatch: Partial<typeof tenants.$inferInsert> = {}');
    expect(tenant).toContain('if (body.fscMode !== undefined) settingsPatch.fscMode = body.fscMode');
    expect(tenant).toContain('if (body.accessMode !== undefined) settingsPatch.accessMode = body.accessMode');
    expect(tenant).toContain('settingsPatch.mcNumber = norm(body.mcNumber)');
    expect(tenant).toContain('settingsPatch.dotNumber = norm(body.dotNumber)');
    expect(tenant).toContain('settingsPatch.publicContactEmail = norm(body.publicContactEmail)');
    expect(tenant).toContain('...settingsPatch,');

    // There is no tenant-level FSC percentage column: manual mode reads each
    // rate card's fuel_surcharge_pct, so the single number is written there —
    // and only when they actually chose manual.
    expect(tenant).toContain("body.fscMode === 'manual' && body.fscPercent !== undefined");
    expect(tenant).toContain('fuelSurchargePct: manualFscPct');

    // SKIP still returns before any of this runs, so it persists nothing but
    // the skip marker.
    const skipAt = tenant.indexOf('return res.json({ ok: true, skipped: true, reseeded: false })');
    expect(skipAt).toBeGreaterThan(-1);
    expect(tenant.indexOf('const settingsPatch')).toBeGreaterThan(skipAt);
  });

  it('surfaces needsOnboarding on /api/auth/me', async () => {
    const auth = await readFile(resolve(routesDir, 'auth.ts'), 'utf8');
    expect(auth).toContain('needsOnboarding');
    expect(auth).toContain('onboardingJson');
  });

  it('reuses the existing rate-card GET (subset by sortOrder) + partial PUT', async () => {
    const tenant = await readFile(resolve(routesDir, 'tenant.ts'), 'utf8');
    // GET returns the tenant's rate cards ordered by sortOrder — the confirm
    // step slices the top 3 from this.
    expect(tenant).toContain("app.get('/api/tenant/rate-cards'");
    expect(tenant).toContain('orderBy(rateCards.sortOrder)');
    // PUT is a partial update (spreads only the provided fields), so editing one
    // price never changes the row COUNT — setup-status.rates stays true.
    expect(tenant).toContain("app.put('/api/tenant/rate-cards/:id'");
    expect(tenant).toContain('...parse.data');
  });
});
