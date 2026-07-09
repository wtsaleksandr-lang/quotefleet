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
    expect(html).toContain('Start sharing live rates in one day.');
    expect(html).toContain('No website changes needed. No heavy setup.');
    expect(html).toContain('For trucking service providers');
    expect(html).toContain('acmetrucking.yourquote.net');
    expect(html).toContain('Add to email signature');
    expect(html).toContain('Optional AI chat');
    expect(html).toContain('Send branded PDF');
    expect(html).toContain('Schedule follow-ups');
    expect(html).toContain('Follow-up reminders');
    expect(html).toContain('Do not let a warm quote go cold.');
    expect(html).toContain('No contracts');
    expect(html).toContain('/w/demo');
    expect(html).toContain('/signup');
    expect(html).toContain('/security');
    expect(html).toContain('/landing-s-polish.css');
    expect(html).toContain('/landing-motion.js');
    expect(html).toContain('data-reveal');
    expect(html).toContain("document.documentElement.classList.add('js')");
    expect(html).not.toContain('/for/forwarders');
    expect(html).not.toContain('/for/brokers');
    expect(html).not.toContain('/for/ltl');
    expect(html).not.toContain('simple-dock');
    expect(html).not.toContain('quote desk');
    expect(html).not.toContain('freight quote leads');
    expect(html).not.toContain('Private rates by default');
  });

  it('landing reveal CSS keeps content visible without JavaScript', async () => {
    const css = await file('landing-s-polish.css');
    expect(css).toContain("@import url('/premium-palette.css')");
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
    expect(html).toContain('/dashboard-setup.js');
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
    expect(html).toContain('/dashboard-preview.js');
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
    expect(html).toContain('/rate-builder.js');
    expect(js).toContain('Rate builder');
    expect(js).toContain('Start with one simple rate card.');
    expect(js).toContain('qf-builder-hero');
    expect(js).toContain('qf-rate-table-wrap');
    expect(css).toContain('Phase AA: make rate cards feel like a calculator builder');
    expect(css).toContain('.qf-builder-stats');
  });

  it('dashboard loads accessorial and zone builder UX layer', async () => {
    const html = await file('app.html');
    const js = await file('setup-builder.js');
    const css = await file('setup-builder.css');
    expect(html).toContain('/setup-builder.css');
    expect(html).toContain('/setup-builder.js');
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
    expect(html).toContain('/brand-editor.js');
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
    expect(html).toContain('/ai-setup.js');
    expect(js).toContain('AI setup');
    expect(js).toContain('Give the assistant clear rules before customers use it.');
    expect(js).toContain('Do not promise');
    expect(js).toContain('Safety rule');
    expect(css).toContain('Phase AD: safer, clearer AI setup UX');
    expect(css).toContain('.qf-ai-card');
  });

  it('landing page includes social metadata', async () => {
    const html = await file('landing.html');
    expect(html).toContain('property="og:title"');
    expect(html).toContain('name="twitter:card"');
    expect(html).toContain('/og.svg');
  });

  it('social preview matches current light setup message', async () => {
    const svg = await file('og.svg');
    expect(svg).toContain('Start sharing live rates');
    expect(svg).toContain('No website changes');
    expect(svg).toContain('Share by link');
    expect(svg).toContain('Send PDFs');
    expect(svg).not.toContain('Instant quote desk');
    expect(svg).not.toContain('Private rates by default');
  });

  it('homepage motion helper is safe and optional', async () => {
    const js = await file('landing-motion.js');
    expect(js).toContain('IntersectionObserver');
    expect(js).toContain('prefers-reduced-motion');
    expect(js).toContain('data-reveal');
    expect(js).toContain('is-visible');
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
