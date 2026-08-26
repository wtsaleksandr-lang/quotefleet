import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('public static page smoke checks', () => {
  it('landing page has simple visual-first positioning and no placeholder links', async () => {
    const html = await file('landing.html');
    expect(html).toContain('See your own freight quote calculator &mdash; live in seconds.');
    expect(html).toContain('Stop losing loads to slow, manual quoting.');
    expect(html).toContain('For carriers, brokers &amp; forwarders');
    expect(html).toContain('acmetrucking.yourquote.net');
    expect(html).toContain('email signature');
    // CRO hero: outcome-first subhead, short toggle labels, FMCSA trust line,
    // and the redundant "See a live demo" link removed from the hero.
    expect(html).toContain('A branded quote page your customers fill out themselves');
    expect(html).toContain('>Carriers</button>');
    expect(html).toContain('>Shippers</button>');
    expect(html).toContain('Set up in ~5 minutes · sourced from FMCSA public data.');
    // The hero's redundant "See a live demo" link (class="demo-link") is gone.
    expect(html).not.toContain('class="demo-link"');
    expect(html).toContain('Branded PDF quotes');
    expect(html).toContain('Automatic follow-ups');
    expect(html).toContain('24/7 AI service agent');
    expect(html).toContain('Everything included');
    expect(html).toContain('No contracts');
    expect(html).toContain('/w/demo');
    expect(html).toContain('/signup');
    expect(html).toContain('/security');
    expect(html).toContain('/landing-s-polish.css');
    expect(html).toContain('/landing-motion.js');
    expect(html).toContain('data-reveal');
    expect(html).toContain("document.documentElement.classList.add('js')");
    expect(html).toContain('/for/brokers');
    expect(html).toContain('/for/forwarders');
    expect(html).toContain('/for/ltl');
    expect(html).toContain('/tools');
    expect(html).not.toContain('simple-dock');
    expect(html).not.toContain('quote desk');
    expect(html).not.toContain('freight quote leads');
    expect(html).not.toContain('Private rates by default');
  });

  it('landing reveal CSS keeps content visible without JavaScript', async () => {
    const css = await file('landing-s-polish.css');
    // premium-palette.css import removed: its retired teal logistics theme was
    // re-injecting teal at :root; the landing runs on the style.css brand palette.
    expect(css).not.toContain("@import url('/premium-palette.css')");
    expect(css).toContain('.js [data-reveal]');
    expect(css).toContain('.js [data-reveal].is-visible');
    expect(css).not.toContain('\n[data-reveal] {');
  });

  it('premium palette uses logistics SaaS colors', async () => {
    const css = await file('premium-palette.css');
    expect(css).toContain('--bg: #0B1117');
    expect(css).toContain('--accent: #26D0B2');
    expect(css).toContain('--accent-2: #F5A524');
    expect(css).toContain('midnight navy');
  });

  it('dashboard loads premium calculator-editing polish', async () => {
    const html = await file('app.html');
    const css = await file('dashboard-polish.css');
    // premium-palette.css was removed from the dashboard (its teal theme
    // overrode the shared WeFixTrades palette on /app + /admin).
    expect(html).not.toContain('/premium-palette.css');
    expect(html).toContain('/dashboard-polish.css');
    expect(css).toContain('Dashboard polish for calculator setup screens');
    expect(css).toContain('data-route="rates"');
    expect(css).toContain('.qf-tab.active');
    expect(css).toContain('.qf-filter-row th');
  });

  it('dashboard loads short interactive setup UX', async () => {
    const html = await file('app.html');
    const js = await file('dashboard-setup.js');
    const css = await file('dashboard-setup.css');
    const todo = await readFile(resolve(process.cwd(), 'docs/product-todo.md'), 'utf8');
    expect(html).toContain('/dashboard-setup.css');
    // dashboard-setup.js JS layer retired (portal simplification); stylesheet stays.
    expect(html).not.toContain('/dashboard-setup.js');
    expect(js).toContain('Calculator setup');
    expect(js).toContain('Get your rate page ready');
    expect(js).toContain('qf-setup-panel');
    expect(js).toContain('qf-setup-empty');
    expect(css).toContain('Phase Y: short interactive calculator setup UX');
    expect(todo).toContain('Phase 1 — Calculator setup dashboard UX');
    expect(todo).toContain('Phase 7 — Premium SaaS polish');
  });

  it('dashboard loads customer calculator preview layer', async () => {
    const html = await file('app.html');
    const js = await file('dashboard-preview.js');
    const css = await file('dashboard-preview.css');
    expect(html).toContain('/dashboard-preview.css');
    // dashboard-preview.js JS layer retired (portal simplification); stylesheet stays.
    expect(html).not.toContain('/dashboard-preview.js');
    expect(js).toContain('Customer preview');
    expect(js).toContain('See what customers open from your link.');
    expect(js).toContain('qf-preview-card');
    expect(js).toContain('Copy link');
    expect(css).toContain('Phase Z: lightweight customer calculator preview');
    expect(css).toContain('.qf-preview-phone');
  });

  it('dashboard loads rate builder UX layer', async () => {
    const html = await file('app.html');
    const js = await file('rate-builder.js');
    const css = await file('rate-builder.css');
    expect(html).toContain('/rate-builder.css');
    // rate-builder.js JS layer retired (portal simplification); stylesheet stays.
    expect(html).not.toContain('/rate-builder.js');
    expect(js).toContain('Rate builder');
    expect(js).toContain('Start with one simple rate card.');
    expect(js).toContain('qf-builder-hero');
    expect(js).toContain('qf-rate-table-wrap');
    expect(css).toContain('Phase AA: make rate cards feel like a calculator builder');
    // Declutter pass: the 4-stat tile block is gone; the compact header now
    // carries a single top-left `?` help-cue disclosure instead.
    expect(css).not.toContain('.qf-builder-stats');
    expect(css).toContain('.qf-help-cue');
    expect(js).toContain('qf-help-cue');
  });

  it('dashboard loads accessorial and zone builder UX layer', async () => {
    const html = await file('app.html');
    const js = await file('setup-builder.js');
    const css = await file('setup-builder.css');
    expect(html).toContain('/setup-builder.css');
    // setup-builder.js JS layer retired (portal simplification); stylesheet stays.
    expect(html).not.toContain('/setup-builder.js');
    expect(js).toContain('Charge builder');
    expect(js).toContain('Zone builder');
    expect(js).toContain('Add the charges customers usually ask about.');
    expect(js).toContain('Build local zones for faster drayage pricing.');
    expect(css).toContain('Phase AB: builder UX for accessorials and zones');
    expect(css).toContain('.qf-setup-table-wrap');
  });

  it('dashboard loads brand page editor UX layer', async () => {
    const html = await file('app.html');
    const js = await file('brand-editor.js');
    const css = await file('brand-editor.css');
    expect(html).toContain('/brand-editor.css');
    // brand-editor.js JS layer retired (portal simplification); stylesheet stays.
    expect(html).not.toContain('/brand-editor.js');
    expect(js).toContain('Brand page editor');
    expect(js).toContain('Make the calculator look like your company.');
    expect(js).toContain('qf-brand-editor');
    expect(js).toContain('Brand setup checklist');
    expect(css).toContain('Phase AC: make brand setup feel like a customer page editor');
    expect(css).toContain('.qf-brand-page-mock');
  });

  it('dashboard loads safer AI setup UX layer', async () => {
    const html = await file('app.html');
    const js = await file('ai-setup.js');
    const css = await file('ai-setup.css');
    expect(html).toContain('/ai-setup.css');
    // ai-setup.js JS layer retired (portal simplification); stylesheet stays.
    expect(html).not.toContain('/ai-setup.js');
    expect(js).toContain('AI setup');
    expect(js).toContain('Give the assistant clear rules before customers use it.');
    expect(js).toContain('Do not promise');
    expect(js).toContain('Safety rule');
    expect(css).toContain('Phase AD: safer, clearer AI setup UX');
    expect(css).toContain('.qf-ai-card');
  });

  it('landing page no longer mounts the rates-database globe (removed on request 2026-08-01)', async () => {
    const html = await file('landing.html');
    // The interactive rate-intelligence globe section was intentionally removed
    // from the homepage. Assert only on the actual mount artifacts — the canvas
    // element and the self-hosted script/vendor paths — since a documentation
    // comment still references the old class/id names.
    expect(html).not.toContain('id="qf-globe-canvas"');
    expect(html).not.toContain('/quotefleet-rates-globe.js');
    expect(html).not.toContain('/vendor/globe.gl.min.js');
    expect(html).not.toContain('/vendor/topojson-client.min.js');
  });

  it('rates globe module is self-hosted, lazy, reduced-motion aware and teal-free', async () => {
    const js = await file('quotefleet-rates-globe.js');
    const css = await file('quotefleet-rates-globe.css');
    // Self-hosted land data, no CDN fetch at runtime
    expect(js).toContain('/vendor/land-110m.json');
    expect(js).not.toContain('jsdelivr');
    expect(js).not.toContain('cdn.');
    expect(js).not.toContain('unpkg');
    // Lazy init + reduced motion
    expect(js).toContain('IntersectionObserver');
    expect(js).toContain('prefers-reduced-motion');
    // QuoteFleet blue, not WeFixTrades cyan/teal
    expect(js).toContain('#0d3cfc');
    expect(js).not.toContain('102,232,250');
    expect(css).not.toContain('102,232,250');
    expect(css).not.toContain('#26D0B2');
    expect(css).not.toContain('#59ff75');
    expect(css).not.toContain('#0bd477');
  });

  it('landing page includes social metadata', async () => {
    const html = await file('landing.html');
    expect(html).toContain('property="og:title"');
    expect(html).toContain('name="twitter:card"');
    expect(html).toContain('/brand/og-image-1200x630.png');
  });

  it('landing page wires the brand favicon + manifest', async () => {
    const html = await file('landing.html');
    expect(html).toContain('rel="icon" href="/favicon.ico"');
    expect(html).toContain('/brand/favicon-32.png');
    expect(html).toContain('rel="apple-touch-icon"');
    expect(html).toContain('rel="manifest" href="/site.webmanifest"');
    // brand mark image replaces the old inline route SVG (white-outline on-dark variant)
    expect(html).toContain('/brand/mark-keys-ondark.png');
    expect(html).not.toContain('qf-route-logo');
    // footer features the FULL logo lockup (calculator + truck, white-outline on-dark)
    expect(html).toContain('/brand/logo-full-ondark.png');
    expect(html).toContain('class="qf-footer-logo"');
  });

  it('demo showcase shell frames the live widget with device + theme toggles', async () => {
    const html = await file('widget-demo-shell.html');
    // device + theme toggle controls
    expect(html).toContain('id="qfd-desktop"');
    expect(html).toContain('id="qfd-mobile"');
    expect(html).toContain('id="qfd-dark"');
    expect(html).toContain('id="qfd-light"');
    // frames the RAW widget (no recursion into the shell) and maps themes to presets
    expect(html).toContain('/w/demo?raw=1');
    expect(html).toContain("dark: 'midnight'");
    // Light maps to a genuinely LIGHT preset (cupertino). It previously pointed
    // at 'cream', which was repaletted to a DARK shell in widgetThemes.ts — so
    // the demo's Light button rendered dark in both modes. See widget-demo-shell.html.
    expect(html).toContain("light: 'cupertino'");
  });

  it('widget client forwards a demo preset override to the config endpoint', async () => {
    const js = await file('widget.js');
    expect(js).toContain("get('preset')");
    expect(js).toContain("'preset=' + encodeURIComponent(themePreset)");
  });

  it('web manifest points at the generated brand icons', async () => {
    const manifest = JSON.parse(await file('site.webmanifest'));
    expect(manifest.icons.map((i: { src: string }) => i.src)).toContain('/brand/icon-512.png');
    expect(manifest.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true);
  });

  it('homepage motion helper is safe and optional', async () => {
    const js = await file('landing-motion.js');
    expect(js).toContain('IntersectionObserver');
    expect(js).toContain('prefers-reduced-motion');
    expect(js).toContain('data-reveal');
    expect(js).toContain('is-visible');
  });

  it('landing glass system is injected LAST and defines the canonical tokens', async () => {
    // landing-motion.js must load the glass sheet AFTER the cleanup sheets so it
    // out-cascades them (re-glasses the light nav/dropdown those sheets flatten).
    const motion = await file('landing-motion.js');
    const cleanupIdx = motion.indexOf('/landing-wefixtrades-cleanup.css');
    const glassIdx = motion.indexOf('/landing-glass.css');
    expect(cleanupIdx).toBeGreaterThan(-1);
    expect(glassIdx).toBeGreaterThan(cleanupIdx);

    const css = await file('landing-glass.css');
    // Canonical glass tokens (codified in DESIGN-SYSTEM.md for other surfaces).
    expect(css).toContain('--glass-ultra-bg: rgba(255, 255, 255, 0.60)');
    expect(css).toContain('--glass-thin-bg: rgba(255, 255, 255, 0.50)');
    expect(css).toContain('--glass-radius: 18px');
    expect(css).toContain('rgba(18, 22, 26, 0.58)'); // dark ultra override
    // Every glass element pairs the -webkit- prefix and ships a solid fallback.
    expect(css).toContain('-webkit-backdrop-filter');
    expect(css).toContain('@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))');
    // Selected audience segment = brand-blue OUTLINE, not a bright fill.
    expect(css).toContain('inset 0 0 0 1px var(--accent)');
  });

  it('hero device pair rests phone-front with both videos looping', async () => {
    const js = await file('landing-hero-swap.js');
    // Resting composition is pinned to stage-phone (phone sharp, laptop blurred
    // behind) — no swap-back to a lone laptop; both clips keep looping.
    expect(js).toContain("wrap.classList.add('stage-phone')");
    expect(js).not.toContain("stage('laptop')");
    expect(js).toContain('lapV.loop = true; phV.loop = true;');
    // Player API stays exposed for landing-video-controls.js.
    expect(js).toContain('window.qfHeroSwap');
  });

  it('widget loads required scripts and controls', async () => {
    const html = await file('widget.html');
    expect(html).toContain('/widget.js');
    expect(html).toContain('/widget-terminal-search.js');
    expect(html).toContain('qf-calc-btn');
    expect(html).toContain('qf-pickup-terminal');
  });

  it('hosted quote page loads quote helpers', async () => {
    const html = await file('quote.html');
    expect(html).toContain('/quote.js');
    expect(html).toContain('/quote-polish.js');
    expect(html).toContain('/quote-print.css');
    expect(html).toContain('qdoc-print-hint');
  });
});

describe('"Find your company" carrier finder', () => {
  it('landing carrier hero renders the finder input + accessible listbox + microcopy', async () => {
    const html = await file('landing.html');
    // Input, placeholder, combobox/listbox wiring, and the FMCSA microcopy.
    expect(html).toContain('data-carrier-finder');
    expect(html).toContain('id="qf-finder-input"');
    expect(html).toContain('placeholder="Enter your trucking company name"');
    expect(html).toContain('role="combobox"');
    expect(html).toContain('id="qf-finder-listbox"');
    expect(html).toContain('role="listbox"');
    expect(html).toContain('No sign-up. We pull your details from public FMCSA records.');
    // The client script is registered on the page.
    expect(html).toContain('/landing-carrier-finder.js');
  });

  it('landing finder client calls the public endpoint and redirects to the prefilled demo', async () => {
    const js = await file('landing-carrier-finder.js');
    expect(js).toContain('/api/public/carrier-search');
    // Debounced + min-length so it never hammers the endpoint.
    expect(js).toContain('250');
    // Redirects to the demo with the carrier params (company/usdot/mc/city/state/phone).
    expect(js).toContain("'/w/demo'");
    expect(js).toContain("add('company'");
    expect(js).toContain("add('usdot'");
    expect(js).toContain("add('mc'");
    // Escapes injected values via textContent, never an .innerHTML assignment.
    expect(js).not.toContain('.innerHTML');
    expect(js).toContain('textContent');
  });

  it('demo calculator reads a URL-param prefill layer above localStorage/defaults', async () => {
    const js = await file('public-calculator-conditional-options.js');
    expect(js).toContain('function urlBrand()');
    expect(js).toContain("p.get('company')");
    expect(js).toContain("p.get('usdot')");
    expect(js).toContain("p.get('mc')");
    expect(js).toContain("p.get('city')");
    expect(js).toContain("p.get('state')");
    expect(js).toContain("p.get('phone')");
    // URL layer is applied LAST in readBrand, so it wins over localStorage/defaults.
    expect(js).toContain('Object.assign(fallback, stored, urlBrand())');
  });

  it('demo calculator patches the credential block (USDOT/MC/phone/address) and clears email', async () => {
    const js = await file('public-calculator-conditional-options.js');
    // Patches window.QF_WIDGET_CONFIG.contact in place from the URL identity so
    // the credential block reads as the visitor, not the demo tenant.
    expect(js).toContain('applyUrlCarrierCredentials');
    expect(js).toContain('c.dotNumber = u.usdot');
    expect(js).toContain('c.mcNumber = u.mc');
    expect(js).toContain('c.phone = u.phone');
    expect(js).toContain('c.address = u.address');
    // Email is CLEARED (visitor's is unknown — never show the demo tenant's).
    expect(js).toContain("c.email = ''");
    // Re-renders the header from the patched config via the widget.js hook.
    expect(js).toContain('window.QF_RERENDER_HEADER');
  });

  it('widget exposes the QF_RERENDER_HEADER hook that rebuilds the header from config', async () => {
    const js = await file('widget.js');
    expect(js).toContain('window.QF_RERENDER_HEADER');
    expect(js).toContain('renderHeader(state.config)');
  });

  it('personalized demo neutralizes the Harbor Link logo + tagline', async () => {
    const js = await file('public-calculator-conditional-options.js');
    // urlBrand paints a visitor-initials logo badge (no FMCSA logo asset exists).
    expect(js).toContain('out.logo = initialsBadgeDataUri(company)');
    // The brand patch clears the demo-tenant logo + tagline and sets the name.
    expect(js).toContain('b.logoUrl = ');
    expect(js).toContain("b.tagline = ''");
    expect(js).toContain('b.displayName = u.name');
  });

  it('carrierInitials derives the logo badge from the visitor name, skipping legal suffixes', async () => {
    const js = await file('public-calculator-conditional-options.js');
    const suffixes = js.match(/const LOGO_SUFFIXES = \{[\s\S]*?\};/);
    const fnSrc = js.match(/function carrierInitials\(name\) \{[\s\S]*?\n {2}\}/);
    expect(suffixes).toBeTruthy();
    expect(fnSrc).toBeTruthy();
    // Reconstruct the pure function and assert the mapping the coordinator signed off.
    const carrierInitials = new Function(
      `${suffixes![0]}\n${fnSrc![0]}\nreturn carrierInitials;`,
    )() as (name: string) => string;
    expect(carrierInitials('Poole')).toBe('P');
    expect(carrierInitials('Sky Harbor Trucking LLC')).toBe('SH');
    expect(carrierInitials('Harbor Link Logistics')).toBe('HL');
    expect(carrierInitials('POOLE CHEM')).toBe('PC');
    expect(carrierInitials('')).toBe('Q');
  });

  it('demo shell FORWARDS the carrier params onto the iframe (initial + theme toggle)', async () => {
    const html = await file('widget-demo-shell.html');
    expect(html).toContain('buildFrameSrc');
    expect(html).toContain("CARRIER_PARAMS = ['company', 'usdot', 'mc', 'city', 'state', 'phone']");
    // The theme-toggle rebuild uses buildFrameSrc, so a theme click keeps the carrier.
    expect(html).toContain('frame.src = buildFrameSrc(t)');
    // Initial load rebuilds ONCE when carrier params are present.
    expect(html).toContain('if (carrierQuery()) frame.src = buildFrameSrc(state.theme)');
  });
});
