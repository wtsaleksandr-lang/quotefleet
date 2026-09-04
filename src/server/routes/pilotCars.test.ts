/**
 * The rendered surfaces.
 *
 * These are string assertions and they are not a substitute for the e2e suite —
 * a regex cannot see an orphaned pill or a sideways scrollbar, which is what
 * `tests/e2e/pilot-car-directory.spec.ts` is for. What they CAN pin is the set
 * of sentences this feature is not allowed to stop saying, and the two failures
 * that would make it worse than the directories it replaces: a self-reported
 * claim rendered as a checked one, and an unreachable database rendered as an
 * empty trade.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PILOT_CAR_JOIN_PATH,
  PILOT_CAR_PATH,
  renderIndexPage,
  renderJoinPage,
  renderManagePage,
  renderProfilePage,
} from './pilotCars.js';
import { parseFilters, toPublicOperator, type OperatorRow } from '../pilotCars/model.js';
import { SITE_NAV_HTML, SITE_MOBILE_MENU_HTML, PREMIUM_FOOTER } from '../siteChrome.js';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const LANDING_HTML = read('src/server/public/landing.html');
const DIRECTORY_PAGES_TS = read('src/server/directory/pages.ts');
const SITEMAP_TS = read('src/server/directory/sitemapCache.ts');

function row(overrides: Partial<OperatorRow> = {}): OperatorRow {
  return {
    public_slug: 'blue-ridge-pilot-cars-nc',
    business_name: 'Blue Ridge Pilot Cars',
    contact_name: 'Dana Mercer',
    email: 'dispatch@example.com',
    phone: '+1 555 0100',
    website: null,
    home_base_city: 'Asheville',
    home_base_state: 'NC',
    service_radius_mi: 400,
    states_covered: ['NC', 'VA'],
    certified_states: ['NC'],
    certifications_json: [{ state: 'NC', status: 'certified', expiresOn: '2027-02-02' }],
    reciprocity_claimed_states: ['GA'],
    languages: ['English'],
    has_height_pole: true,
    height_pole_max_in: 186,
    has_oversize_signs: true,
    has_flags: false,
    has_amber_light_bar: true,
    has_two_way_radio: true,
    vehicle_class: 'pickup-full-size',
    vehicle_gvwr_lbs: 9_900,
    takes_superloads: false,
    takes_night_moves: false,
    insurance_liability_usd: 1_000_000,
    insurance_expires_on: '2027-05-05',
    verification_tier: 'self-asserted',
    verification_note: null,
    verification_source_url: null,
    verified_on: null,
    publish_email: false,
    publish_phone: true,
    publish_contact_name: false,
    listing_status: 'published',
    updated_at: '2026-09-01T00:00:00.000Z',
    last_confirmed_at: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

const OP = toPublicOperator(row(), '2026-09-04');
const EMPTY_FILTERS = parseFilters({});

describe('the database being down is a DIFFERENT SENTENCE from an empty result', () => {
  const down = renderIndexPage(EMPTY_FILTERS, { operators: [], total: 0, unavailable: true });

  it('renders a full page rather than an error', () => {
    expect(down).toContain('<!doctype html>');
    expect(down).toContain('Pilot Car &amp; Escort Operator Directory');
  });

  it('says it cannot REACH the directory, and says that is not "none found"', () => {
    expect(down).toContain('We cannot reach the directory right now');
    expect(down).toContain('This is not "no operators found"');
  });

  it('never says "no operators" as the reason', () => {
    expect(down).not.toContain('No listed operator matches all of that');
  });

  it('still renders the compiled certification table, which needs no database', () => {
    expect(down).toContain('Which states certify pilot-car operators');
    expect(down).toContain('Certification required');
  });

  it('the EMPTY result says something different again', () => {
    const empty = renderIndexPage(parseFilters({ states: 'TX,AR,TN' }), {
      operators: [],
      total: 0,
      unavailable: false,
    });
    expect(empty).toContain('No listed operator matches all of that');
    expect(empty).not.toContain('We cannot reach the directory right now');
    // And it explains WHY an AND over three states is a narrow ask, with a way out.
    expect(empty).toContain('all 3 states');
    expect(empty).toContain('states=TX');
  });
});

describe('a self-reported claim never wears a checked badge', () => {
  const page = renderIndexPage(EMPTY_FILTERS, { operators: [OP], total: 1, unavailable: false });

  it('labels the default tier on the card, in words', () => {
    expect(page).toContain('Self-reported');
    expect(page).toContain('QuoteFleet has not checked it against any state record');
  });

  it('draws a self-reported tier as a DASHED outline, never a filled badge', () => {
    expect(page).toMatch(/\.pc-tier \{[^}]*border: 1px dashed/);
    expect(page).toMatch(/\.pc-tier \{[^}]*background: transparent/);
  });

  it('reserves the solid outline for the tiers where something was checked', () => {
    expect(page).toMatch(/\.pc-tier\.is-registry \{[^}]*border-style: solid/);
    expect(page).toMatch(/\.pc-tier\.is-doc \{[^}]*border-style: solid/);
  });

  it('a registry-verified record shows WHEN and links the register it was checked against', () => {
    const verified = toPublicOperator(
      row({
        verification_tier: 'registry-verified',
        verified_on: '2026-08-01',
        verification_source_url: 'https://example.gov/register',
      }),
      '2026-09-04',
    );
    const html = renderProfilePage(verified);
    expect(html).toContain('Checked against the state register');
    expect(html).toContain('2026-08-01');
    expect(html).toContain('https://example.gov/register');
  });
});

describe('the profile publishes only what the operator ticked', () => {
  const html = renderProfilePage(OP);

  it('shows the published phone and withholds the unpublished email and name', () => {
    expect(html).toContain('+1 555 0100');
    expect(html).not.toContain('dispatch@example.com');
    expect(html).not.toContain('Dana Mercer');
  });

  it('says so plainly when nothing is published, rather than showing an empty block', () => {
    const quiet = renderProfilePage(
      toPublicOperator(row({ publish_phone: false, publish_email: false }), '2026-09-04'),
    );
    expect(quiet).toContain('has not published a contact method');
  });

  it('shows a reciprocity belief as the OPERATOR\'S claim, not as a permission', () => {
    expect(html).toContain('That is their reading of a reciprocity table, not ours and not the state');
  });

  it('puts the STATE\'S OWN requirement beside the operator\'s claim, with the source', () => {
    expect(html).toContain('What the state requires');
    expect(html).toContain('Source for the state');
  });

  it('marks a lapsed certificate as LAPSED rather than dropping it', () => {
    const lapsed = renderProfilePage(
      toPublicOperator(
        row({ certifications_json: [{ state: 'NC', status: 'certified', expiresOn: '2020-01-01' }] }),
        '2026-09-04',
      ),
    );
    expect(lapsed).toContain('LAPSED');
  });
});

describe('the submission form is an opt-in, per field', () => {
  const html = renderJoinPage();

  it('requires an explicit consent tick and says what happens without it', () => {
    expect(html).toContain('id="pc-consent"');
    expect(html).toContain('the submission is refused rather than stored unpublished');
  });

  it('asks per field what may be published', () => {
    expect(html).toContain('id="pc-pub-phone"');
    expect(html).toContain('id="pc-pub-email"');
    expect(html).toContain('id="pc-pub-contact"');
  });

  it('promises a deletion path in the same words the API implements', () => {
    expect(html).toContain('removes the row rather than hiding it');
  });

  it('tells the operator up front that their record starts as self-reported', () => {
    expect(html).toContain('Self-reported');
    expect(html).toContain('We do not tick a badge because you typed a number in a box');
  });

  it('says WHY the escort vehicle is asked for — a cited rule, not a form field', () => {
    expect(html).toContain('18,000 lb GVWR');
    expect(html).toContain('certified and still illegal');
  });
});

describe('the manage page is a bearer link to one person\'s own data', () => {
  it('is noindex, and says not to share it', () => {
    const html = renderManagePage('tok', { operator: OP, unavailable: false, status: 'published' });
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(html).toContain('Do not share it');
  });

  it('distinguishes withdraw from delete, and says delete is permanent', () => {
    const html = renderManagePage('tok', { operator: OP, unavailable: false, status: 'published' });
    expect(html).toContain('id="pc-withdraw"');
    expect(html).toContain('id="pc-delete"');
    expect(html).toContain('cannot be undone');
    expect(html).toContain('We keep no archive copy');
  });

  it('shows the database-down banner rather than "no such listing" when the store is unreachable', () => {
    const html = renderManagePage('tok', { operator: null, unavailable: true, status: null });
    expect(html).toContain('We cannot reach the directory right now');
    expect(html).not.toContain('does not match a listing');
  });
});

describe('house UI rules', () => {
  const html = renderIndexPage(EMPTY_FILTERS, { operators: [OP], total: 1, unavailable: false });

  it('left-aligns the hero and its eyebrow — the shared .hero centres, so it is overridden', () => {
    expect(html).toMatch(/\.pc-hero \{[^}]*text-align: left/);
    expect(html).toMatch(/\.pc-eyebrow \{[^}]*text-align: left/);
    expect(html).toMatch(/\.pc-hero h1 \{[^}]*text-align: left/);
  });

  it('centres no heading anywhere in the page CSS', () => {
    expect(html).not.toMatch(/\.pc-[a-z-]* h[1-3] \{[^}]*text-align: center/);
  });

  it('puts the eyebrow above the H1, at the top left', () => {
    expect(html.indexOf('pc-eyebrow')).toBeLessThan(html.indexOf('<h1>'));
  });

  it('uses only design tokens — no raw hex or named colour in the page CSS', () => {
    const css = html.slice(html.indexOf('.pc-shell'), html.indexOf('</style>'));
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/:\s*(white|black)\b/i);
  });

  it('selected state is an OUTLINE, never a bright fill', () => {
    expect(html).toMatch(/\.pc-pill \{[^}]*background: transparent/);
    expect(html).toMatch(/\.pc-pill\.is-cert \{[^}]*border-color: var\(--accent\)/);
  });

  it('a pill never breaks across two lines', () => {
    expect(html).toMatch(/\.pc-pill \{[^}]*white-space: nowrap/);
    expect(html).toMatch(/\.pc-tier \{[^}]*white-space: nowrap/);
  });

  it('input titles sit IN the field with the help text above and left, 2px apart', () => {
    expect(html).toMatch(/\.pc-lab \{[^}]*position: absolute/);
    expect(html).toMatch(/\.pc-field \+ \.pc-help \{ margin-top: 2px/);
    expect(html).toMatch(/\.pc-field--list \+ \.pc-help \{ margin-top: 2px/);
  });

  it('a multi-select gets a title that cannot land on top of its first row', () => {
    // `padding-top` does not move a list box's options, so the absolutely
    // positioned title printed over the first state. The wrapper carries the
    // box and the padding; the select inside it has neither.
    expect(html).toMatch(/\.pc-field--list \{[^}]*padding: 24px 4px 4px/);
    expect(html).toMatch(/\.pc-field--list select \{[^}]*border: 0/);
    expect(html).toContain('<label class="pc-field--list"><span class="pc-lab">States on the route</span><select name="states"');
  });

  it('uses overflow: clip, not hidden, on the scroll-containing state box', () => {
    expect(html).toMatch(/\.pc-statebox \{[^}]*overflow-x: clip/);
    expect(html).not.toMatch(/\.pc-statebox \{[^}]*overflow-x: hidden/);
  });

  it('the wide table scrolls INSIDE its own box, so the document never scrolls sideways', () => {
    expect(html).toMatch(/\.pc-tablewrap \{ overflow-x: auto/);
    expect(html).toMatch(/\.pc-table \{[^}]*min-width: 560px/);
  });

  it('collapses the two-column layout and the state grid at phone width', () => {
    expect(html).toMatch(/@media \(max-width: 960px\)[\s\S]*?\.pc-grid \{ grid-template-columns: minmax\(0, 1fr\)/);
    expect(html).toMatch(/@media \(max-width: 760px\)[\s\S]*?\.pc-statebox \{ grid-template-columns: repeat\(2/);
  });

  it('keeps every tap target at 48px on the controls', () => {
    expect(html).toMatch(/\.pc-field select, \.pc-field input \{[^}]*min-height: 48px/);
    expect(html).toMatch(/\.pc-actions \.btn \{[^}]*min-height: 48px/);
  });
});

describe('the filter is a plain GET form — every view is a shareable URL', () => {
  const html = renderIndexPage(parseFilters({ states: 'KY,TN', certin: 'WA' }), {
    operators: [],
    total: 0,
    unavailable: false,
  });

  it('submits by GET to the directory itself', () => {
    expect(html).toContain(`<form class="pc-filters" method="get" action="${PILOT_CAR_PATH}">`);
  });

  it('needs no JavaScript to filter — the script tag is for the submission form only', () => {
    const formBlock = html.slice(html.indexOf('<form class="pc-filters"'), html.indexOf('</form>'));
    expect(formBlock).not.toContain('onclick');
    expect(formBlock).not.toContain('<script');
  });

  it('re-selects what the URL asked for, so a shared link renders its own state', () => {
    expect(html).toMatch(/<option value="KY" selected>/);
    expect(html).toMatch(/<option value="WA" selected>/);
  });
});

describe('wired into the site the same way every other public surface is', () => {
  it('appears in the desktop nav, the mobile drawer and BOTH footers', () => {
    expect(SITE_NAV_HTML).toContain('href="/pilot-cars"');
    expect(SITE_MOBILE_MENU_HTML).toContain('href="/pilot-cars"');
    expect(PREMIUM_FOOTER).toContain('href="/pilot-cars"');
    expect(DIRECTORY_PAGES_TS).toContain('href="/pilot-cars"');
  });

  it('the homepage carries the same links, since it ships its own copy of the chrome', () => {
    expect(LANDING_HTML).toContain('href="/pilot-cars"');
  });

  it('is in the sitemap — the index and the join page, never an unapproved profile', () => {
    expect(SITEMAP_TS).toContain("{ path: '/pilot-cars', changefreq: 'weekly', priority: '0.7' }");
    expect(SITEMAP_TS).toContain("{ path: '/pilot-cars/join'");
    expect(SITEMAP_TS).not.toMatch(/path: `\/pilot-cars\/\$\{/);
  });

  it('the join path constant is the one the nav points at', () => {
    expect(PILOT_CAR_JOIN_PATH).toBe('/pilot-cars/join');
  });
});

describe('the quote tools link in here, pre-filtered', () => {
  const OSOW_TS = read('src/server/routes/osowPermits.ts');
  const OSOW_JS = read('src/server/public/osow-calculator.js');
  const HH_TS = read('src/server/routes/heavyHaulQuote.ts');
  const HH_JS = read('src/server/public/heavy-haul-quote.js');

  it('the OS/OW API computes the href server-side from the states that need an escort', () => {
    expect(OSOW_TS).toContain('directoryHref: string | null;');
    expect(OSOW_TS).toContain('escortDirectoryHref(');
    expect(OSOW_TS).toContain('j.escortsRequired > 0');
  });

  it('the OS/OW page renders it inside the escort section, not as a separate advert', () => {
    expect(OSOW_JS).toContain('data.escorts.directoryHref');
    expect(OSOW_JS).toContain('head + find + yours + notes');
  });

  it('the heavy-haul API does the same, and returns null when no escort is required', () => {
    expect(HH_TS).toContain('escortDirectoryHref: string | null;');
    expect(HH_TS).toContain('states.length > 0 ? escortDirectoryHref(states) : null');
  });

  it('the heavy-haul page renders nothing at all when there is no escort to find', () => {
    expect(HH_JS).toContain("if (!res.escortDirectoryHref) return '';");
    expect(HH_JS).toContain('renderEscortDirectory(res)');
  });
});
