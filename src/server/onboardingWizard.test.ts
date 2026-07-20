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
    // the four steps
    expect(js).toContain('What do you haul?');
    expect(js).toContain('How do you price it?');
    expect(js).toContain('Where do you operate?');
    expect(js).toContain('Confirm your top 3 rates');
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

    // The wizard runs four steps since the brand-color step was dropped.
    expect(js).toContain('var STEPS = 4');
    expect(js).toContain('Step 4 of 4');
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
