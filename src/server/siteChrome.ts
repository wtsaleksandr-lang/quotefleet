/**
 * Canonical marketing/legal-page CHROME — single source of truth.
 *
 * Extracted from app.ts so both the static-page skinner (applyFullSiteHeader)
 * AND server-rendered marketing pages (e.g. /partners*, see
 * src/server/affiliate/pages.ts) share ONE header + footer, with no drift.
 *
 * Kept identical to the homepage (landing.html) header so every page shares the
 * same navigation. Styling lives in /nav-unify.css (token-first, theme-aware).
 */

// ── Canonical full site header + mobile menu ────────────────────────────────
export const FULL_SITE_HEADER = `<header class="site-header">
    <div class="site-header-inner">
      <a href="/" class="site-brand" aria-label="QuoteFleet home"><span class="site-logo" aria-hidden="true"><img class="qf-brand-mark" src="/brand/mark-keys-ondark.png" alt="QuoteFleet" width="28" height="30" decoding="async"></span>QuoteFleet</a>
      <nav class="site-nav" aria-label="Main navigation"><div class="nav-dd" data-nav-dd><button type="button" class="nav-dd-trigger" id="solutions-trigger" aria-haspopup="true" aria-expanded="false" aria-controls="solutions-menu">Solutions<svg class="nav-dd-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg></button><div class="nav-dd-panel" id="solutions-menu" hidden><div class="nav-dd-group"><p class="nav-dd-head">Tools</p><a href="/tools">Rate calculator</a><a href="/directory">Carrier directory</a><a href="/compliance">Compliance tools</a><a href="/services">Carrier services</a><a href="/glossary">Freight glossary</a></div><div class="nav-dd-group"><p class="nav-dd-head">For your business</p><a href="/for/brokers">Freight brokers</a><a href="/for/forwarders">Freight forwarders</a><a href="/for/ltl">LTL</a></div></div></div><a href="/pricing">Pricing</a><a href="/compare">Compare</a><a href="/w/demo">Demo</a></nav>
      <div class="site-actions"><button type="button" class="qf-theme-btn" aria-label="Toggle light/dark theme" aria-pressed="false" title="Toggle theme"><svg class="qf-ico-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg><svg class="qf-ico-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg></button><a class="signin" href="/login">Sign in</a><a class="btn btn-secondary" href="/w/demo">View demo <span class="arr">→</span></a><button type="button" class="site-burger" id="site-burger" aria-label="Open menu" aria-expanded="false" aria-controls="site-mobile-menu"><svg class="ico-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg><svg class="ico-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg></button></div>
    </div>
    <div class="site-mobile-menu" id="site-mobile-menu" hidden><p class="mm-head">Tools</p><a href="/tools">Rate calculator</a><a href="/directory">Carrier directory</a><a href="/compliance">Compliance tools</a><a href="/services">Carrier services</a><a href="/glossary">Freight glossary</a><p class="mm-head">For your business</p><a href="/for/brokers">Freight brokers</a><a href="/for/forwarders">Freight forwarders</a><a href="/for/ltl">LTL</a><p class="mm-head">More</p><a href="/pricing">Pricing</a><a href="/compare">Why QuoteFleet</a><a href="/w/demo">Demo</a><a href="/partners">Partners</a><a href="/login">Sign in</a></div>
  </header>`;

// Premium footer — the shared marketing footer. Carries the site-wide "Partners"
// link (affiliate + referral program) in the Product column.
export const PREMIUM_FOOTER = `<footer class="premium-footer"><div class="premium-footer-inner"><div class="footer-brand"><a href="/" class="qf-footer-brand" aria-label="QuoteFleet home"><img class="qf-footer-logo" src="/brand/logo-full-ondark.png" alt="QuoteFleet — freight rate calculator" width="168" height="113" decoding="async"></a><div class="qf-footer-brandtext"><a href="/" class="qf-footer-wordmark">QuoteFleet</a><p class="qf-footer-tagline">Branded rate calculator pages, PDF quotes, and optional AI chat for trucking service providers.</p></div></div><div class="footer-col"><h4>Product</h4><a href="/w/demo">Demo</a><a href="/pricing">Pricing</a><a href="/compare">Why QuoteFleet</a><a href="/partners">Partners</a><a href="/signup">Start free</a></div><div class="footer-col"><h4>Solutions</h4><a href="/tools">Free rate calculator</a><a href="/for/brokers">For freight brokers</a><a href="/for/forwarders">For freight forwarders</a><a href="/for/ltl">For LTL</a><a href="/directory">Carrier directory</a><a href="/services">Carrier services</a><a href="/compliance">Compliance tools</a><a href="/glossary">Freight glossary</a></div><div class="footer-col"><h4>Company</h4><a href="mailto:hello@quotefleet.net">Contact</a><a href="/support">Support</a><a href="/partners">Affiliate program</a><a href="/login">Sign in</a><a href="/security">Security</a></div><div class="footer-col"><h4>Legal</h4><a href="/terms">Terms of Service</a><a href="/privacy">Privacy Policy</a><a href="/refund">Refund &amp; Cancellation</a><a href="/dpa">Data Processing (DPA)</a><a href="/cookie">Cookie Policy</a><a href="/.well-known/security.txt">security.txt</a></div></div><ul class="qf-footer-trustbar" role="list"><li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7.5a5 5 0 0 1 10 0V11"/></svg>Payments secured by Stripe</li><li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 4.5 6v6c0 4.4 3.2 7.4 7.5 8.9 4.3-1.5 7.5-4.5 7.5-8.9V6z"/><path d="m9 12 2 2 4-4"/></svg>SSL/TLS encrypted</li><li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.5 4 5.5v6c0 4.6 3.3 7.7 8 9.5 4.7-1.8 8-4.9 8-9.5v-6z"/><circle cx="12" cy="11" r="2.4"/><path d="M12 13.4V16"/></svg>GDPR &amp; CCPA-ready</li><li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M10 4v16"/></svg>Per-tenant data isolation</li></ul><div class="footer-bottom"><span>© <span id="year"></span> QuoteFleet. All rights reserved.</span><span class="qf-foot-operator">QuoteFleet is a product of MR Holdings &amp; Trade LLC.</span></div></footer>`;

// Burger + Solutions-dropdown behaviour, mirrored from landing.html so the
// injected header is interactive. Idempotent #year setter included.
export const HEADER_SCRIPTS = `<script>
  (function () {
    var y = document.getElementById('year'); if (y) y.textContent = new Date().getFullYear();
    var b = document.getElementById('site-burger');
    var m = document.getElementById('site-mobile-menu');
    if (b && m) {
      var set = function (open) {
        b.setAttribute('aria-expanded', open ? 'true' : 'false');
        b.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
        if (open) m.removeAttribute('hidden'); else m.setAttribute('hidden', '');
      };
      b.addEventListener('click', function (e) { e.stopPropagation(); set(b.getAttribute('aria-expanded') !== 'true'); });
      m.addEventListener('click', function (e) { if (e.target.closest('a')) set(false); });
      document.addEventListener('click', function (e) { if (!m.hasAttribute('hidden') && !m.contains(e.target) && !b.contains(e.target)) set(false); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') set(false); });
    }
    var dd = document.querySelector('[data-nav-dd]');
    if (dd) {
      var trigger = dd.querySelector('.nav-dd-trigger');
      var panel = dd.querySelector('.nav-dd-panel');
      if (trigger && panel) {
        var hoverable = window.matchMedia('(hover: hover) and (pointer: fine)');
        var hoverTimer;
        var isOpen = function () { return trigger.getAttribute('aria-expanded') === 'true'; };
        var open = function (o) {
          trigger.setAttribute('aria-expanded', o ? 'true' : 'false');
          dd.classList.toggle('is-open', o);
          if (o) panel.removeAttribute('hidden'); else panel.setAttribute('hidden', '');
        };
        trigger.addEventListener('click', function (e) { e.stopPropagation(); if (hoverable.matches) open(true); else open(!isOpen()); });
        trigger.addEventListener('keydown', function (e) { if (e.key === 'ArrowDown') { e.preventDefault(); open(true); var f = panel.querySelector('a'); if (f) f.focus(); } });
        dd.addEventListener('mouseenter', function () { if (!hoverable.matches) return; clearTimeout(hoverTimer); open(true); });
        dd.addEventListener('mouseleave', function () { if (!hoverable.matches) return; hoverTimer = setTimeout(function () { open(false); }, 140); });
        dd.addEventListener('focusout', function (e) { if (!dd.contains(e.relatedTarget)) open(false); });
        document.addEventListener('click', function (e) { if (isOpen() && !dd.contains(e.target)) open(false); });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && isOpen()) { open(false); trigger.focus(); } });
      }
    }
  })();
</script>`;

/**
 * Replace a static page's stripped `.topnav` header + reduced `.site-footer`
 * with the canonical full header + premium footer, and inject the header CSS +
 * interactivity. Safe to compose on top of other page skins.
 */
export function applyFullSiteHeader(html: string): string {
  let out = html;
  if (!out.includes('/nav-unify.css')) {
    out = out.replace('</head>', '  <link rel="stylesheet" href="/nav-unify.css">\n</head>');
  }
  out = out.replace(/<header class="topnav">[\s\S]*?<\/header>/, FULL_SITE_HEADER);
  out = out.replace(/<footer class="site-footer">[\s\S]*?<\/footer>/, PREMIUM_FOOTER);
  out = out.replace('</body>', `${HEADER_SCRIPTS}\n</body>`);
  return out;
}

export interface MarketingShellOpts {
  title: string;
  description: string;
  canonicalPath: string;
  /** Page body HTML placed between the header and footer. */
  bodyHtml: string;
  /** Optional page-scoped <style> block (already CSS text, no <style> tags). */
  headStyles?: string;
}

const SITE = 'https://quotefleet.net';

function esc(s: unknown): string {
  return String(s == null ? '' : s).replace(
    /[&<>"']/g,
    (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m] as string
  );
}

/**
 * Full server-rendered marketing page with the canonical full header + premium
 * footer + qf-public-wft skin (style.css + public-pages-wefixtrades.css), theme
 * bootstrap, and the header/theme scripts. Mirrors the static marketing pages
 * (pricing.html etc.) so a dynamic page (e.g. the affiliate dashboard) is
 * visually identical to them. Runs the body through applyFullSiteHeader.
 */
export function renderMarketingShell(opts: MarketingShellOpts): string {
  const doc = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <script>(function(){try{var t=localStorage.getItem('qf-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();</script>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(opts.title)}</title>
  <meta name="description" content="${esc(opts.description)}">
  <link rel="canonical" href="${SITE}${esc(opts.canonicalPath)}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/style.css">
  <link rel="stylesheet" href="/public-pages-wefixtrades.css">
  <link rel="icon" href="/favicon.ico" sizes="any">
  <link rel="icon" type="image/png" sizes="32x32" href="/brand/favicon-32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/brand/favicon-16.png">
  <link rel="apple-touch-icon" sizes="180x180" href="/brand/apple-touch-icon-180.png">
  <meta property="og:title" content="${esc(opts.title)}">
  <meta property="og:description" content="${esc(opts.description)}">
  <meta property="og:image" content="${SITE}/brand/og-image-1200x630.png">
  <meta name="twitter:card" content="summary_large_image">
  ${opts.headStyles ? `<style>${opts.headStyles}</style>` : ''}
</head>
<body class="qf-public-wft">
  <header class="topnav"><div class="topnav-inner"><a href="/" class="brand-mark">QuoteFleet</a></div></header>
  ${opts.bodyHtml}
  <footer class="site-footer">© QuoteFleet</footer>
  <script src="/marketing-chat.js" defer></script>
  <script src="/theme-toggle.js" defer></script>
</body>
</html>`;
  return applyFullSiteHeader(doc);
}
