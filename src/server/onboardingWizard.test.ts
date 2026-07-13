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
    expect(js).toContain('What do you haul most?');
    expect(js).toContain('How do you price it?');
    expect(js).toContain('Your main lane?');
    expect(js).toContain('Make it yours');
    // all six verticals present in the picker
    for (const v of ['drayage', 'dryvan_ftl', 'reefer', 'ltl', 'hotshot', 'flatbed']) {
      expect(js).toContain(v);
    }
    expect(css).toContain('.qf-ob-overlay');
    expect(css).toContain('.qf-ob-card');
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
});
