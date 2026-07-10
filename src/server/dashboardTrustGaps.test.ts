import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEMO_PROFILE } from '../db/seed.js';

const publicDir = resolve(process.cwd(), 'src/server/public');
const srcDir = resolve(process.cwd(), 'src');

async function pub(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('dashboard trust gaps — canonical customer link', () => {
  it('app.js publishes the canonical hosted widget URL as window.__qfWidget', async () => {
    const app = await pub('app.js');
    expect(app).toContain('window.__qfWidget');
    // Derived from the tenant.hostedUrl (<slug>.<hostDomain>), not a guess.
    expect(app).toContain('t.hostedUrl');
  });

  it('every dashboard customer-link surface uses the canonical URL, never a fake yourquote.net', async () => {
    const files = [
      'dashboard-preview.js',
      'brand-editor.js',
      'launch-panel.js',
      'share-readiness.js',
    ];
    for (const name of files) {
      const js = await pub(name);
      // The old bug: appending `.yourquote.net` to a host-qualified slug.
      expect(js, `${name} must not render a fake yourquote.net link`).not.toMatch(
        /\$\{[^}]*\}\.yourquote\.net/
      );
      expect(js, `${name} must read the shared canonical link`).toContain('__qfWidget');
    }
  });

  it('the preview card displays the canonical host (window.__qfWidget.host)', async () => {
    const preview = await pub('dashboard-preview.js');
    expect(preview).toContain('widget().host');
    expect(preview).toContain('widget().url');
  });
});

describe('dashboard trust gaps — in-app billing management', () => {
  it('app.js wires an in-app control to the built /api/billing/portal', async () => {
    const app = await pub('app.js');
    expect(app).toContain('/api/billing/portal');
    expect(app).toContain('openBillingPortal');
    // Graceful degradation when Stripe isn't configured / no customer yet.
    expect(app).toContain('e.status === 503');
    expect(app).toContain('e.status === 404');
  });

  it('the trial banner Manage plan action opens the portal, not just /pricing', async () => {
    const app = await pub('app.js');
    expect(app).toContain('data-manage-billing');
  });
});

describe('dashboard trust gaps — new-lead / callback nav badges', () => {
  it('renders count pills on the Leads and Callbacks nav items', async () => {
    const html = await pub('app.html');
    expect(html).toContain('data-badge="leads"');
    expect(html).toContain('data-badge="callbacks"');
  });

  it('app.js fetches counts and styles a brand-blue pill for both themes', async () => {
    const app = await pub('app.js');
    const css = await pub('style.css');
    expect(app).toContain('refreshNavBadges');
    expect(app).toContain('d.stats.newLeads');
    expect(app).toContain('d.stats.pendingCallbacks');
    expect(css).toContain('.qf-nav-badge');
    // Uses the theme-aware brand-fill token (works in light + dark).
    expect(css).toMatch(/\.qf-nav-badge[\s\S]*?background:\s*var\(--accent-fill\)/);
  });

  it('the overview route returns a pendingCallbacks count', async () => {
    const route = await readFile(resolve(srcDir, 'server/routes/tenant.ts'), 'utf8');
    expect(route).toContain('pendingCallbacks');
  });
});

describe('dashboard trust gaps — credible demo tenant profile', () => {
  it('DEMO_PROFILE is a filled-in, non-skeleton carrier', () => {
    // No placeholder / scaffolding values leak to prospects.
    expect(DEMO_PROFILE.name).not.toMatch(/your company/i);
    expect(DEMO_PROFILE.contactEmail).not.toContain('quotefleet.local');
    expect(DEMO_PROFILE.contactEmail).toMatch(/@[a-z0-9.-]+\.[a-z]{2,}$/i);

    // Real-looking authority + contact + brand identity present.
    expect(DEMO_PROFILE.mcNumber).toMatch(/\d{4,}/);
    expect(DEMO_PROFILE.dotNumber).toMatch(/\d{4,}/);
    expect(DEMO_PROFILE.contactPhone).toMatch(/\d/);
    expect(DEMO_PROFILE.brand.displayName.length).toBeGreaterThan(3);
    expect(DEMO_PROFILE.brand.tagline.length).toBeGreaterThan(10);

    // A real logo mark, not the "Your logo" placeholder.
    expect(DEMO_PROFILE.brand.logoUrl).toMatch(/^data:image\/svg\+xml/);

    // A credible address so the widget contact block renders in full.
    expect(DEMO_PROFILE.carrierProfile.addressLine1.length).toBeGreaterThan(3);
    expect(DEMO_PROFILE.carrierProfile.city).toBeTruthy();
    expect(DEMO_PROFILE.carrierProfile.state).toBeTruthy();
    expect(DEMO_PROFILE.carrierProfile.postalCode).toBeTruthy();
  });

  it('the demo brand palette stays on-brand (no teal)', () => {
    const colors = [DEMO_PROFILE.brand.primaryColor, DEMO_PROFILE.brand.accentColor];
    for (const c of colors) {
      expect(c).toMatch(/^#[0-9a-fA-F]{6}$/);
      // Guard against teal (#0D9488-ish): high green + high blue, low red.
      const r = parseInt(c.slice(1, 3), 16);
      const g = parseInt(c.slice(3, 5), 16);
      const b = parseInt(c.slice(5, 7), 16);
      const isTeal = r < 0x40 && g > 0x90 && b > 0x90;
      expect(isTeal, `${c} reads as teal`).toBe(false);
    }
  });
});
