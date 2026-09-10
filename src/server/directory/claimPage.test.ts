/**
 * /claim/:slug + /claim renders (directory/claimPage.ts) — copy and structure
 * the owner decision pins: free forever, left-aligned hero, 3-step stepper,
 * the upsell at the BOTTOM and again on the success step, the already-claimed
 * state, the signed-in state. Plus: the trial signup page hands ?claim= links
 * to /claim instead of showing the old banner shim.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { renderClaimFinder, renderClaimPage } from './claimPage.js';
import type { VisibleCarrier } from './queries.js';

function carrier(overrides: Partial<VisibleCarrier> = {}): VisibleCarrier {
  return {
    slug: 'acme-drayage-inc-107080',
    legalName: 'ACME DRAYAGE INC',
    dbaName: null,
    usdot: '107080',
    mcNumber: 'MC012892',
    city: 'SAVANNAH',
    state: 'GA',
    zip: '31401',
    phone: '9125550921',
    email: 'dispatch@acme.com',
    contactHidden: false,
    powerUnits: 25,
    drivers: 30,
    safetyRating: 'S',
    authorityType: 'common',
    intermodal: true,
    hazmat: false,
    dryVan: false,
    reefer: false,
    tanker: false,
    flatbed: false,
    dryBulk: false,
    householdGoods: false,
    beverages: false,
    produce: false,
    motorVehicles: false,
    livestock: false,
    grainFeed: false,
    oilfield: false,
    meat: false,
    paper: false,
    construction: false,
    farmSupplies: false,
    coalCoke: false,
    buildingMaterials: false,
    nearestPortCode: 'USSAV',
    aboutOverride: null,
    capabilities: {},
    provenance: { about: 'fmcsa', email: 'fmcsa', phone: 'fmcsa', hidden: 'fmcsa', capabilities: 'fmcsa' },
    ...overrides,
  } as VisibleCarrier;
}

const count = (s: string, needle: string) => s.split(needle).length - 1;

describe('/claim/:slug — anonymous visitor, unclaimed profile', () => {
  const html = renderClaimPage({ carrier: carrier(), viewer: null });

  it('hero: eyebrow, H1, sub — free forever, no trial / card / plan', () => {
    expect(html).toContain('<div class="claim-eyebrow">Free · forever</div>');
    expect(html).toContain('<h1>Claim ACME DRAYAGE INC — free, forever</h1>');
    expect(html).toContain('USDOT 107080 · SAVANNAH, GA. Claiming is free and always will be. No trial, no card, no plan.');
    // Left-aligned directory hero, never the centered marketing one.
    expect(html).toContain('<section class="hero dir-hero">');
  });

  it('3-step stepper: Your email → Verify ownership → Done, step 1 current', () => {
    expect(html).toContain('<li aria-current="step">Your email</li>');
    expect(html).toContain('<li>Verify ownership</li>');
    expect(html).toContain('<li>Done</li>');
    expect(html).toContain('data-step="1"');
    expect(html).toContain('data-step="2" hidden');
    expect(html).toContain('data-step="3" hidden');
  });

  it('title-in-field inputs: email + optional password, help copy in the label', () => {
    expect(html).toContain('<span class="join-field-label">Work email</span>');
    expect(html).toContain('<span class="join-field-label">Password (optional, 10+ characters)</span>');
    expect(html).toContain('autocomplete="one-time-code"');
  });

  it('step 2 carries all three verification variants with the exact manual copy', () => {
    expect(html).toContain('data-variant="otp"');
    expect(html).toContain('data-variant="manual"');
    expect(html).toContain('data-variant="magic_link"');
    expect(html).toContain(
      "We couldn't find an email on your FMCSA record. Email <a href=\"mailto:support@quotefleet.net\">support@quotefleet.net</a> from your company address with your USDOT and we'll verify within 1 business day.",
    );
    expect(html).toContain('Codes expire in 15 minutes');
  });

  it('success step: Verified owner + Open my profile', () => {
    expect(html).toContain('Verified owner of ACME DRAYAGE INC');
    expect(html).toContain('href="/directory/carrier/acme-drayage-inc-107080">Open my profile');
    expect(html).toContain('cp-badge-verified');
  });

  it('the upsell card appears TWICE: on the success step and muted at the bottom', () => {
    expect(count(html, '<div class="claim-upsell')).toBe(2);
    expect(count(html, 'Optional — turn your profile into a lead machine.')).toBe(2);
    expect(count(html, 'Profile owners get 30 days free (not 14), no card.')).toBe(2);
    expect(count(html, 'Start my 30 free days')).toBe(2);
    expect(count(html, 'Not now — just keep my free profile')).toBe(2);
    expect(count(html, 'claim-upsell--bottom')).toBe(1);
    // The bottom card is the LAST thing in main, i.e. after step 3.
    expect(html.lastIndexOf('claim-upsell--bottom')).toBeGreaterThan(html.indexOf('data-step="3"'));
  });

  it('no emoji anywhere in the page copy', () => {
    expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });

  it('is noindex (per-carrier action page) but keeps its links crawlable', () => {
    expect(html).toContain('<meta name="robots" content="noindex, follow">');
    expect(html).toContain('<link rel="canonical" href="https://quotefleet.net/claim/acme-drayage-inc-107080">');
  });

  it('client script posts to the claim API for this USDOT', () => {
    expect(html).toContain('data-usdot="107080"');
    expect(html).toContain("'/api/claim/'+encodeURIComponent(usdot)+'/start'");
    expect(html).toContain("'/api/claim/'+encodeURIComponent(usdot)+'/verify'");
    expect(html).toContain("'/api/tenant/trial/activate'");
  });
});

describe('/claim/:slug — signed-in states', () => {
  it('a carrier account uses the session (no email field, "Claiming as")', () => {
    const html = renderClaimPage({
      carrier: carrier(),
      viewer: { email: 'owner@acme.com', hasTenant: true, ownsThisProfile: false, canActivateTrial: false },
    });
    expect(html).toContain('Claiming as <strong>owner@acme.com</strong>');
    expect(html).not.toContain('<span class="join-field-label">Work email</span>');
    expect(html).toContain('data-claim-start novalidate');
  });

  it('a shipper account is told to sign out (no claim form)', () => {
    const html = renderClaimPage({
      carrier: carrier(),
      viewer: { email: 'buyer@shipper.com', hasTenant: false, ownsThisProfile: false, canActivateTrial: false },
    });
    expect(html).toContain('shipper account');
    expect(html).not.toContain('data-claim-start novalidate');
  });

  it('the verified owner sees their success state + the upsell (only while no trial)', () => {
    const own = renderClaimPage({
      carrier: carrier({ claimedTenantId: 42 }),
      viewer: { email: 'owner@acme.com', hasTenant: true, ownsThisProfile: true, canActivateTrial: true },
    });
    expect(own).toContain('You are the verified owner of ACME DRAYAGE INC');
    expect(count(own, '<div class="claim-upsell')).toBe(1);
    const trialing = renderClaimPage({
      carrier: carrier({ claimedTenantId: 42 }),
      viewer: { email: 'owner@acme.com', hasTenant: true, ownsThisProfile: true, canActivateTrial: false },
    });
    expect(count(trialing, '<div class="claim-upsell')).toBe(0);
  });
});

describe('/claim/:slug — already claimed by someone else', () => {
  const html = renderClaimPage({ carrier: carrier({ claimedTenantId: 99 }), viewer: null });

  it('shows the Already claimed state with the support address and no form', () => {
    expect(html).toContain('<h2>Already claimed</h2>');
    expect(html).toContain('Not you? Contact <a href="mailto:support@quotefleet.net">support@quotefleet.net</a>');
    expect(html).not.toContain('data-claim-start novalidate');
    expect(html).not.toContain('<div class="claim-upsell');
    expect(html).not.toContain('<ol class="claim-stepper"');
  });
});

describe('/claim — finder', () => {
  const html = renderClaimFinder();
  it('free-forever hero + a title-in-field search that links results to /claim/<usdot>', () => {
    expect(html).toContain('<div class="claim-eyebrow">Free · forever</div>');
    expect(html).toContain('<h1>Claim your carrier profile — free, forever</h1>');
    expect(html).toContain('<span class="join-field-label">USDOT, MC number or company name</span>');
    expect(html).toContain('/api/public/carrier-search?');
    expect(html).toContain("href=\"/claim/'+encodeURIComponent(r.usdot)");
  });
});

describe('signup.html hands legacy ?claim= links to the free claim flow', () => {
  it('redirects instead of rendering the old claim banner; plan picker sits below the fields', async () => {
    const html = await readFile(resolve(process.cwd(), 'src/server/public/signup.html'), 'utf8');
    expect(html).not.toContain('claim-banner');
    expect(html).not.toContain('Claim your carrier listing');
    expect(html).toContain("location.replace(id ? '/claim/' + encodeURIComponent(id) : '/claim')");
    // Trial notice + plan picker come AFTER the last account field (countryFocus).
    const fields = html.indexOf('id="countryFocus"');
    const notice = html.indexOf('14-day all-inclusive trial — every Pro feature unlocked.');
    const plans = html.indexOf('id="plan-choice"');
    expect(fields).toBeGreaterThan(0);
    expect(notice).toBeGreaterThan(fields);
    expect(plans).toBeGreaterThan(notice);
  });
});
