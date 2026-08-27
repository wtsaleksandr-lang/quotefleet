/**
 * Shipper Directory Pro join surface + post-checkout confirmation banner.
 *
 * These render pure HTML (no db / no network), so they're tested directly like
 * carrierProfileContact.test.ts. Covers:
 *   • renderDirectoryJoin — anonymous (email magic-link form, NOT carrier
 *     /signup), signed-in free (Subscribe → checkout), Pro (Manage subscription).
 *   • The join client script wires the three real endpoints (auth/signup,
 *     billing/checkout, billing/portal).
 *   • renderDirectoryLanding — the ?upgrade=success / cancelled banners.
 *
 * NOTE: the client JS references every data-* hook as a `[selector]`, so tests
 * assert the ELEMENT form (`data-x>` for buttons, `data-x method` for the form)
 * to distinguish rendered markup from the script's selector strings.
 */
import { describe, it, expect } from 'vitest';
import { renderDirectoryJoin, renderDirectoryLanding } from './pages.js';
import type { DirectoryIdentity } from './entitlement.js';
import type { DirectorySummary } from './queries.js';

const anon: DirectoryIdentity = { userId: null, email: null, isPro: false, status: null, currentPeriodEnd: null };
const free: DirectoryIdentity = { userId: 5, email: 'ship@acme.com', isPro: false, status: null, currentPeriodEnd: null };
const pro: DirectoryIdentity = { userId: 5, email: 'ship@acme.com', isPro: true, status: 'active', currentPeriodEnd: null };

const summary: DirectorySummary = { total: 1000, intermodalTotal: 100, states: 40, byState: [], byPort: [] };

describe('renderDirectoryJoin — anonymous', () => {
  const html = renderDirectoryJoin({ identity: anon, intent: 'signin' });
  it('renders a passwordless email form posting to the shipper signup endpoint', () => {
    expect(html).toContain('data-join-signup-form method="post"');
    expect(html).toContain('action="/api/directory/auth/signup"');
    expect(html).toContain('type="email"');
  });
  it('is the dedicated shipper flow — never the carrier /signup', () => {
    // (the shared marketing nav's "Claim your listing" href="/signup" is expected
    // on every page; the shipper surface must not route shippers THROUGH it.)
    expect(html).not.toContain('/signup?plan=directory-pro');
    expect(html).not.toContain('name="subdomain"');
    expect(html).not.toContain('name="hostDomain"');
    expect(html).not.toContain('name="company"');
  });
  it('shows no subscribe/manage buttons until signed in', () => {
    expect(html).not.toContain('data-subscribe-btn>');
    expect(html).not.toContain('data-manage-btn>');
  });
  it('shows the $19/mo price and a free-vs-paid split before sign-in', () => {
    expect(html).toContain('$19/mo');
    expect(html).toContain('cancel anytime');
    expect(html).toContain('Free account');
    expect(html).toContain('Directory Pro');
    expect(html).toContain('join-split');
  });
  it('subscribe intent frames the email step as leading to checkout', () => {
    const sub = renderDirectoryJoin({ identity: anon, intent: 'subscribe' });
    expect(sub).toContain('data-intent="subscribe"');
    expect(sub.toLowerCase()).toContain('secure checkout');
  });
});

describe('renderDirectoryJoin — signed-in free', () => {
  const html = renderDirectoryJoin({ identity: free, intent: 'signin' });
  it('shows the Subscribe button and the shipper email, no email form', () => {
    expect(html).toContain('data-subscribe-btn>');
    expect(html).toContain('Subscribe');
    expect(html).toContain('ship@acme.com');
    expect(html).not.toContain('data-join-signup-form method');
  });
  it('the panel is pre-set to the subscribe intent', () => {
    expect(html).toContain('data-intent="subscribe"');
  });
});

describe('renderDirectoryJoin — Directory Pro', () => {
  const html = renderDirectoryJoin({ identity: pro, intent: 'signin' });
  it('shows a Pro badge + Manage subscription, no subscribe/email form', () => {
    expect(html).toContain('Directory Pro');
    expect(html).toContain('data-manage-btn>');
    expect(html).toContain('Manage subscription');
    expect(html).not.toContain('data-subscribe-btn>');
    expect(html).not.toContain('data-join-signup-form method');
  });
});

describe('renderDirectoryJoin — client wiring', () => {
  const html = renderDirectoryJoin({ identity: anon });
  it('wires the three real Directory Pro endpoints', () => {
    expect(html).toContain('/api/directory/auth/signup');
    expect(html).toContain('/api/directory/billing/checkout');
    expect(html).toContain('/api/directory/billing/portal');
  });
  it('escapes dynamic email through esc()', () => {
    const evil: DirectoryIdentity = { ...free, email: '<script>@x.com' };
    const out = renderDirectoryJoin({ identity: evil });
    expect(out).not.toContain('<script>@x.com');
    expect(out).toContain('&lt;script&gt;@x.com');
  });
});

describe('renderDirectoryLanding — post-checkout confirmation banner', () => {
  it('upgrade=success renders the "You\'re on Directory Pro" banner', () => {
    const html = renderDirectoryLanding(summary, { upgrade: 'success' });
    expect(html).toContain('class="dir-upgrade-banner dir-upgrade-banner--ok"');
    expect(html).toContain("You're on Directory Pro");
    expect(html).toContain('unlocked');
  });
  it('upgrade=cancelled renders a no-charge notice with a retry link', () => {
    const html = renderDirectoryLanding(summary, { upgrade: 'cancelled' });
    expect(html).toContain('class="dir-upgrade-banner dir-upgrade-banner--info"');
    expect(html).toContain('no charge');
    expect(html).toContain('/directory/join?intent=subscribe');
  });
  it('no upgrade param → no banner', () => {
    // (the class NAME lives in the inlined stylesheet on every page; assert the
    // absence of the rendered ELEMENT + its copy instead.)
    const html = renderDirectoryLanding(summary);
    expect(html).not.toContain('class="dir-upgrade-banner');
    expect(html).not.toContain("You're on Directory Pro");
  });
});

describe('renderDirectoryLanding — shipper discoverability (H1)', () => {
  const html = renderDirectoryLanding(summary);
  it('renders the shipper value-prop (one rate request to many carriers)', () => {
    expect(html).toContain('Get freight rates from many carriers');
    expect(html).toContain('class="aud-card"');
    // Directory Pro feature summary is present on the landing.
    expect(html).toContain('carriers at once');
  });
  it('exposes an RFQ / get-quotes entry point + a Directory Pro CTA', () => {
    expect(html).toContain('Get freight quotes');
    // "Get freight quotes" starts a real rate request (RFQ flow), not a re-sort.
    expect(html).toContain('href="/directory/rfq?sort=featured"');
    // The browse/filter CTA keeps the faceted-search destination (distinct).
    expect(html).toContain('href="/directory?sort=featured"');
    expect(html).toContain('href="/directory/join"');
    expect(html).toContain('Directory Pro — $19/mo');
  });
  it('carries a "For shippers" nav link reaching /directory/join', () => {
    expect(html).toContain('href="/directory/join">For shippers');
  });
  it('coexists with the carrier "Claim your listing — free" path', () => {
    // Both audiences framed; the carrier claim path is not buried.
    expect(html).toContain('For carriers');
    expect(html).toContain('Claim your listing');
    expect(html).toContain('href="/signup"');
  });
});
