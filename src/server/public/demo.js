// Prospect DEMO page controller. Vanilla JS, no build step.
// Reads window.QF_DEMO (server-injected by GET /demo/:token) and wires the
// conversion chrome around the live widget iframe: company name, logo, brand
// accent, /signup CTAs, iframe src + auto-resize, and the theme toggle.
(function () {
  'use strict';
  var D = (window.QF_DEMO && typeof window.QF_DEMO === 'object') ? window.QF_DEMO : {};
  function $(id) { return document.getElementById(id); }

  var company = (D.company && String(D.company).trim()) || 'Your company';
  var accent = sanitizeHex(D.brandPrimary);

  // Brand accent for the subtle wrapper touches (logo ring, banner rule).
  if (accent) {
    var page = $('demo-page');
    if (page) page.style.setProperty('--demo-accent', accent);
  }

  // Company text.
  setText('demo-company', company);
  setText('demo-banner-title', 'This is a preview built for ' + company + '.');
  setText('demo-foot-note', 'An independent preview for ' + company + ' — not yet affiliated.');
  try { document.title = company + ' · instant freight quotes (QuoteFleet preview)'; } catch (e) {}

  // Logo: real image when we have one, else a branded initials badge.
  var logo = $('demo-logo');
  if (logo) {
    if (D.logoUrl) {
      logo.style.backgroundImage = 'url("' + cssUrl(D.logoUrl) + '")';
      logo.textContent = '';
    } else {
      logo.textContent = initials(company);
      if (accent) {
        logo.style.background = accent;
        logo.style.color = readableOn(accent);
        logo.style.boxShadow = 'none';
      }
    }
  }

  // Every CTA points at signup (with company/domain prefill query).
  var signup = (typeof D.signupUrl === 'string' && D.signupUrl) ? D.signupUrl : '/signup';
  ['demo-cta-top', 'demo-cta-banner', 'demo-cta-pitch'].forEach(function (id) {
    var a = $(id);
    if (a) a.setAttribute('href', signup);
  });

  // The light/dark preset pair the calculator switches between. The shell's
  // day/night toggle drives the SAME brand calculator between a genuinely LIGHT
  // and a genuinely DARK theme (accent/brand preserved). Kept in sync with the
  // widget: the config endpoint honours `?preset=` and the widget also applies
  // it live via postMessage. If these ids change, update DEMO_THEME_PRESET in
  // src/server/outreach/prospectDemo.ts (the light default) to match.
  var THEME_PRESET = { light: 'cupertino', dark: 'midnight' };
  function shellMode() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }

  // Live widget iframe → /w/<token>. The widget fetches its config from
  // /api/public/widget/<token>, which the prospect-demo interceptor serves.
  var frame = $('demo-widget');
  if (frame && typeof D.widgetUrl === 'string' && D.widgetUrl) {
    frame.setAttribute('title', company + ' instant freight quote');
    // Load the calculator in the theme the shell restored pre-paint (head
    // script), so the calculator MATCHES the shell on first paint instead of
    // always loading the light default under a dark shell (the initial mismatch).
    var sep = D.widgetUrl.indexOf('?') > -1 ? '&' : '?';
    frame.src = D.widgetUrl + sep + 'preset=' + encodeURIComponent(THEME_PRESET[shellMode()]);
  }

  // Auto-resize to the widget's content height (same postMessage protocol as
  // /embed.js) so there's no nested scrollbar.
  window.addEventListener('message', function (e) {
    if (!e || !e.data || !frame) return;
    if (e.source !== frame.contentWindow) return;
    var h;
    if (e.data.type === 'QF_WIDGET_HEIGHT' && typeof e.data.height === 'number') h = e.data.height;
    else if (e.data.qf === 'resize' && typeof e.data.h === 'number') h = e.data.h;
    if (typeof h === 'number' && h > 0) frame.style.minHeight = h + 'px';
  });

  // Light/dark toggle (persisted in localStorage, same key the rest of the site
  // uses). The initial theme was restored pre-paint by the inline head script.
  var toggle = $('demo-theme-toggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      var isLight = document.documentElement.getAttribute('data-theme') === 'light';
      if (isLight) {
        document.documentElement.removeAttribute('data-theme');
        try { localStorage.setItem('qf-theme', 'dark'); } catch (e) {}
      } else {
        document.documentElement.setAttribute('data-theme', 'light');
        try { localStorage.setItem('qf-theme', 'light'); } catch (e) {}
      }
      // Switch the calculator (in its isolated iframe) to match the shell — live,
      // no reload, so any entered form values are preserved. The widget re-fetches
      // its config with this preset and re-skins. Same-origin target; the widget
      // only honours this for a DEMO config, so real embeds are never affected.
      var mode = shellMode();
      if (frame && frame.contentWindow) {
        try {
          frame.contentWindow.postMessage(
            { qf: 'theme', mode: mode, preset: THEME_PRESET[mode] },
            window.location.origin
          );
        } catch (e) { /* ignore */ }
      }
    });
  }

  // ── helpers ──────────────────────────────────────────────────────────
  function setText(id, text) { var el = $(id); if (el) el.textContent = text; }

  function initials(name) {
    var parts = String(name).trim().split(/\s+/).filter(Boolean).slice(0, 2);
    var s = parts.map(function (p) { return p.charAt(0); }).join('');
    return (s || 'Q').toUpperCase();
  }

  function sanitizeHex(v) {
    if (typeof v !== 'string') return '';
    var s = v.trim();
    if (!/^#?[0-9a-fA-F]{6}$/.test(s)) return '';
    return s.charAt(0) === '#' ? s : '#' + s;
  }

  function cssUrl(u) { return String(u).replace(/["\\\r\n]/g, ''); }

  // Pick a readable ink for text laid over the brand colour (WCAG-ish luminance).
  function readableOn(hex) {
    var h = hex.replace('#', '');
    var r = parseInt(h.slice(0, 2), 16) / 255;
    var g = parseInt(h.slice(2, 4), 16) / 255;
    var b = parseInt(h.slice(4, 6), 16) / 255;
    function lin(c) { return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
    var lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    return lum > 0.4 ? '#0b0f14' : '#f9f9f9';
  }
})();
