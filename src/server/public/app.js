// QuoteFleet — tenant dashboard SPA. Vanilla JS.
(function () {
  'use strict';

  function $(s, root) { return (root || document).querySelector(s); }
  function $$(s, root) { return Array.from((root || document).querySelectorAll(s)); }
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k === 'on') Object.keys(attrs.on).forEach(function (ev) { e.addEventListener(ev, attrs.on[ev]); });
      else if (k === 'style' && typeof attrs[k] === 'object') Object.assign(e.style, attrs[k]);
      else e.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (k) { if (k) e.appendChild(typeof k === 'string' ? document.createTextNode(k) : k); });
    return e;
  }
  function fmtMoney(n) {
    if (typeof n !== 'number' || isNaN(n)) return '—';
    return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleString();
  }
  // Escapes HTML-significant chars so customer/tenant/imported values can be
  // safely interpolated into innerHTML string builders. Module-scoped so every
  // render function can reach it (prevents stored XSS from lead/callback/audit
  // fields sourced from the anonymous public widget + inbound rate-email import).
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return m === '&' ? '&amp;' : m === '<' ? '&lt;' : m === '>' ? '&gt;' : m === '"' ? '&quot;' : '&#39;';
    });
  }
  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (opts.body && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
    return fetch(path, opts).then(function (r) {
      // Read as text first, then parse defensively: a Replit proxy 502/504, an
      // HTML 429 rate-limit page, or a 204 No Content is NOT JSON, and a raw
      // r.json() there throws "Unexpected token <" that masks the real status.
      return r.text().then(function (body) {
        var j = null;
        if (body) { try { j = JSON.parse(body); } catch (_e) { j = null; } }
        if (!r.ok) {
          // Day-14 write-block escape: the trial-gating middleware answers any
          // mutating call from an expired free tenant with
          //   403 { error:'trial_expired', message, trialEndsAt }
          // Surface the subscribe path (flip the shell banner to its expired
          // CTA) instead of bubbling a raw "trial_expired" string to a toast.
          if (r.status === 403 && j && j.error === 'trial_expired') {
            try { handleTrialExpired(j); } catch (e) { /* non-fatal — never mask the throw */ }
            var te = new Error((j && j.message) || 'Your trial has ended. Subscribe to keep making changes.');
            te.status = r.status; te.code = 'trial_expired'; throw te;
          }
          var msg = (j && j.error) ||
            (r.status >= 500 ? 'Service temporarily unavailable — please try again (' + r.status + ').'
              : r.status === 429 ? 'Too many requests — please wait a moment and try again.'
              : 'HTTP ' + r.status);
          var err = new Error(msg); err.status = r.status; throw err;
        }
        return j; // null for an empty/204 body — callers already guard missing data
      });
    });
  }

  // Copy text to the clipboard with a fallback for non-secure contexts / in-app
  // webviews where navigator.clipboard is missing or blocked (otherwise the copy
  // buttons throw a synchronous TypeError and silently do nothing).
  function legacyCopy(text) {
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', '');
        ta.style.position = 'fixed'; ta.style.top = '-9999px'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) resolve(); else reject(new Error('copy failed'));
      } catch (e) { reject(e); }
    });
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return copyText(text).catch(function () { return legacyCopy(text); });
    }
    return legacyCopy(text);
  }

  // ── Toast helper ──────────────────────────────────────────────
  // Replaces native alert() and silent .then() — gives users visible
  // feedback for save actions. Auto-dismisses after 2.5s for success,
  // 5s for error. Stacks vertically in the corner.
  function ensureToastRoot() {
    var t = document.getElementById('qf-toasts');
    if (t) return t;
    t = document.createElement('div');
    t.id = 'qf-toasts';
    // Announce toast content to assistive tech: polite live region so a
    // "Saved" confirmation is read without stealing focus.
    t.setAttribute('role', 'status');
    t.setAttribute('aria-live', 'polite');
    t.setAttribute('aria-atomic', 'true');
    t.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:10000;display:flex;flex-direction:column;gap:8px;pointer-events:none;';
    document.body.appendChild(t);
    return t;
  }
  function toast(msg, kind) {
    var root = ensureToastRoot();
    var bg = kind === 'error' ? '#b91c1c' : (kind === 'warn' ? '#b45309' : '#059669');
    var node = document.createElement('div');
    node.textContent = msg;
    node.style.cssText =
      'background:' + bg + ';color:#fff;padding:10px 14px;border-radius:8px;' +
      'box-shadow:0 4px 16px rgba(0,0,0,0.25);font-size:13px;font-weight:500;' +
      'pointer-events:auto;max-width:340px;opacity:0;transform:translateY(8px);' +
      'transition:opacity 0.18s ease, transform 0.18s ease;';
    root.appendChild(node);
    requestAnimationFrame(function () { node.style.opacity = '1'; node.style.transform = 'translateY(0)'; });
    var ttl = kind === 'error' ? 5000 : 2500;
    setTimeout(function () {
      node.style.opacity = '0'; node.style.transform = 'translateY(8px)';
      setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 250);
    }, ttl);
  }
  function toastErr(err) { toast(err && err.message ? err.message : String(err || 'Error'), 'error'); }
  function toastOk(msg) { toast(msg || 'Saved', 'success'); }
  // Wrap a save promise so blur-handlers get visible feedback.
  function saved(p, okMsg) {
    return p.then(function (r) { toastOk(okMsg); return r; }, function (e) { toastErr(e); throw e; });
  }
  // Expose to inline handlers + future use.
  window.qfToast = toast;
  window.qfToastErr = toastErr;
  window.qfToastOk = toastOk;
  window.qfSaved = saved;

  // ── Billing portal ────────────────────────────────────────────
  // Opens the Stripe Customer Portal (manage card / cancel) via the
  // already-built GET /api/billing/portal. Degrades gracefully when
  // Stripe isn't configured (503) or the tenant has no Stripe customer
  // yet (404 — e.g. a trial that never entered a card): we route them to
  // the pricing page to start/choose a plan instead of dead-ending.
  function openBillingPortal() {
    api('/api/billing/portal').then(function (r) {
      if (r && r.url) { window.location.href = r.url; return; }
      toast('Billing portal is unavailable right now.', 'warn');
    }).catch(function (e) {
      if (e && (e.status === 503 || e.status === 404)) {
        toast(e.message || 'Manage your plan from the pricing page.', 'warn');
        window.location.href = '/pricing';
        return;
      }
      toastErr(e);
    });
  }
  window.qfOpenBillingPortal = openBillingPortal;

  // ── Motion helpers ────────────────────────────────────────────
  // Single source of truth for the reduced-motion preference so every
  // animated flow (count-ups, reveals, staged copy) degrades the same way.
  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  // Animate a number from 0 → target inside a text node. Snaps instantly
  // under reduced-motion. Eased with cubic ease-out so it decelerates.
  function countUp(node, target, duration) {
    target = Number(target) || 0;
    if (!node) return;
    if (prefersReducedMotion() || !window.requestAnimationFrame || duration <= 0) {
      node.textContent = String(target); return;
    }
    var start = null;
    function frame(ts) {
      if (start === null) start = ts;
      var t = Math.min(1, (ts - start) / duration);
      var eased = 1 - Math.pow(1 - t, 3);
      node.textContent = String(Math.round(eased * target));
      if (t < 1) requestAnimationFrame(frame);
      else node.textContent = String(target);
    }
    requestAnimationFrame(frame);
  }

  // ── In-app confirm modal ──────────────────────────────────────
  // Drop-in replacement for native confirm(): reuses the existing
  // .qf-modal component so destructive/commit prompts match the app's
  // look instead of the OS chrome. Options: title, body, confirmText,
  // cancelText, danger (bool), onConfirm, onCancel.
  function showConfirmModal(opts) {
    opts = opts || {};
    var backdrop = el('div', { class: 'qf-modal-backdrop is-open' });
    var card = el('div', { class: 'qf-modal-card', role: 'dialog', 'aria-modal': 'true' });
    card.appendChild(el('h3', { text: opts.title || 'Are you sure?' }));
    if (opts.body) card.appendChild(el('p', { text: opts.body }));
    // Optional pre-escaped HTML block (e.g. a warning banner + list of the
    // sample lanes that failed the auto-check). Callers MUST escape any
    // user/tenant-derived text before passing it here.
    if (opts.bodyHtml) {
      var extra = el('div', { class: 'qf-modal-body-html' });
      extra.innerHTML = opts.bodyHtml;
      card.appendChild(extra);
    }
    var actions = el('div', { class: 'qf-modal-actions' });
    var cancelBtn = el('button', { class: 'btn', text: opts.cancelText || 'Cancel' });
    var okBtn = el('button', { class: 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary'), text: opts.confirmText || 'Confirm' });
    // Optional acknowledgment gate — the confirm button stays disabled until the
    // operator ticks the checkbox, so a flagged ($0/failed) auto-check can't be
    // applied on a silent click-through.
    var ackInput = null;
    if (opts.requireAck) {
      var ackLabel = el('label', { class: 'qf-modal-ack' });
      ackInput = el('input', { type: 'checkbox' });
      ackLabel.appendChild(ackInput);
      ackLabel.appendChild(el('span', { text: opts.requireAck }));
      card.appendChild(ackLabel);
      okBtn.disabled = true;
      ackInput.addEventListener('change', function () { okBtn.disabled = !ackInput.checked; });
    }
    var keydown;
    function close() {
      backdrop.remove();
      if (keydown) document.removeEventListener('keydown', keydown);
    }
    cancelBtn.addEventListener('click', function () { close(); if (opts.onCancel) opts.onCancel(); });
    okBtn.addEventListener('click', function () {
      if (opts.requireAck && ackInput && !ackInput.checked) return;
      close(); if (opts.onConfirm) opts.onConfirm();
    });
    actions.appendChild(cancelBtn);
    actions.appendChild(okBtn);
    card.appendChild(actions);
    backdrop.appendChild(card);
    backdrop.addEventListener('click', function (ev) { if (ev.target === backdrop) { close(); if (opts.onCancel) opts.onCancel(); } });
    keydown = function (ev) { if (ev.key === 'Escape') { close(); if (opts.onCancel) opts.onCancel(); } };
    document.addEventListener('keydown', keydown);
    document.body.appendChild(backdrop);
    setTimeout(function () { try { okBtn.focus(); } catch (e) { /* noop */ } }, 30);
  }

  // ── Sidebar new-item badges ───────────────────────────────────
  // Subtle brand-blue pills on Leads / Callbacks showing unactioned
  // counts, so a dispatcher living in the portal sees a hot lead without
  // waiting on email. Fed by /api/tenant/overview (newLeads +
  // pendingCallbacks); refreshed on boot and whenever those routes open.
  function setNavBadge(route, count) {
    var b = document.querySelector('.sidebar [data-route="' + route + '"] .qf-nav-badge');
    if (!b) return;
    var n = Number(count) || 0;
    if (n > 0) { b.textContent = n > 99 ? '99+' : String(n); b.hidden = false; }
    else { b.textContent = ''; b.hidden = true; }
  }
  function refreshNavBadges() {
    api('/api/tenant/overview').then(function (d) {
      if (!d || !d.stats) return;
      setNavBadge('leads', d.stats.newLeads || 0);
      setNavBadge('callbacks', d.stats.pendingCallbacks || 0);
    }).catch(function () { /* non-fatal — badges are a hint, not a blocker */ });
  }
  window.qfRefreshNavBadges = refreshNavBadges;

  // ── Drayage-zones nav visibility ──────────────────────────────
  // Progressive nav: "Drayage zones" only matters when the tenant has at
  // least one drayage rate card, so the nav item stays hidden otherwise.
  // Fails OPEN (leaves it visible) if the check can't run. Called on boot
  // and re-run from renderRates after add / delete / service change so
  // enabling drayage reveals the nav without a reload. Pass the already
  // loaded rate-card array to skip the refetch.
  function syncZonesNav(cards) {
    var btn = document.querySelector('.sidebar [data-route="zones"]');
    if (!btn) return;
    var p = Array.isArray(cards)
      ? Promise.resolve(cards)
      : api('/api/tenant/rate-cards').then(function (d) { return (d && d.rateCards) || []; });
    p.then(function (list) {
      var hasDrayage = (list || []).some(function (r) { return r.service === 'drayage'; });
      btn.style.display = hasDrayage ? '' : 'none';
    }).catch(function () { btn.style.display = ''; });
  }
  window.qfSyncZonesNav = syncZonesNav;

  var state = { me: null, route: null };

  function setActiveNav(route) {
    $$('.sidebar .nav-item').forEach(function (b) {
      var on = b.dataset.route === route;
      b.classList.toggle('active', on);
      // Zones/Ingest/Audit live inside a collapsed <details class="qf-nav-advanced">;
      // open it when its item is active (e.g. a deep-link/refresh to /app/audit) so
      // the user actually sees which page they're on.
      if (on) { var d = b.closest('details.qf-nav-advanced'); if (d) d.open = true; }
    });
  }

  var ROUTES = {
    overview: function (c) { return renderOverview(c); },
    leads: function (c) { return renderLeads(c); },
    rates: function (c) { return renderRates(c); },
    accessorials: function (c) { return renderAccessorials(c); },
    zones: function (c) { return renderZones(c); },
    ai: function (c) { return renderAi(c); },
    ingest: function (c) { return renderIngest(c); },
    brand: function (c) { return renderBrand(c); },
    // Retired standalone page — behaviour/copy controls are now the Customize
    // workspace's "Behavior" tab. Keep the route so old deep links still land.
    'widget-settings': function (c) { return renderBrand(c, { tab: 'behavior' }); },
    embed: function (c) { return renderEmbed(c); },
    audit: function (c) { return renderAudit(c); },
    account: function (c) { return renderAccount(c); },
    callbacks: function (c) { return renderCallbacks(c); },
  };

  // Not-found fallback so an unknown route never hangs on the "Loading…"
  // spinner. Shows a clean panel with a one-click way back to Overview.
  function renderNotFound(c) {
    c.innerHTML = '';
    var card = el('div', { class: 'card', style: { marginTop: '12px', padding: '32px 24px', textAlign: 'center' } });
    card.appendChild(el('div', { style: { fontSize: '17px', fontWeight: '800' }, text: 'Page not found' }));
    card.appendChild(el('div', { class: 'muted-small', style: { margin: '8px auto 18px', maxWidth: '420px', lineHeight: '1.5' }, text: 'That page doesn’t exist or has moved.' }));
    var btn = el('button', { class: 'btn btn-primary', text: 'Back to Overview' });
    btn.addEventListener('click', function () { go('overview'); });
    card.appendChild(btn);
    c.appendChild(card);
  }

  // Parse a pathname/route through the shared, unit-tested helper (app-route.js)
  // so boot / popstate / clicks all derive the FULL nested route identically.
  var RouteUtil = (typeof window !== 'undefined' && window.QFAppRoute) || {
    fullRoute: function (p) { return (String(p || '').split('/app/')[1] || 'overview').replace(/\/+$/, '') || 'overview'; },
    baseSegment: function (r) { return String(r || '').split('/')[0] || 'overview'; },
  };

  // Render a route WITHOUT touching history. Dispatches on the base segment
  // (which handler + which nav item), but the handlers read the FULL path from
  // the URL (renderLeads → renderLeadDetail), so the caller must ensure the URL
  // already reflects `route`. Used by popstate/boot directly (the URL is already
  // correct) and by go() after it pushes state. Splitting render from pushState
  // is the fix for audit shell-H1: Back → popstate → render no longer appends a
  // duplicate history entry, so Back/Forward work.
  function render(route) {
    route = route || 'overview';
    state.route = route;
    // Copilot form registry: routes re-render fully into #page-content, so
    // clear any prior page's form registration here — each render fn that has
    // an editable form re-registers it once its inputs exist. (Phase 2.)
    try { if (window.__qfCopilotForm) window.__qfCopilotForm.clear(); } catch (e) {}
    var base = RouteUtil.baseSegment(route);
    setActiveNav(base);
    if (base === 'overview' || base === 'leads' || base === 'callbacks') refreshNavBadges();
    var c = $('#page-content');
    c.innerHTML = '<div class="muted">Loading…</div>';
    var handler = ROUTES[base];
    if (handler) return handler(c);
    return renderNotFound(c);
  }

  // User-initiated navigation (sidebar / link / row click): push the new URL
  // (so Back can return here) THEN render it. `route` is the full route, incl.
  // any sub-path like "leads/QF-123", so the pushed URL carries the deep link.
  function go(route) {
    history.pushState({}, '', '/app/' + route);
    var r = render(route);
    // SPA focus management: move focus to the top of the freshly-rendered
    // content region so keyboard/SR users don't stay parked on the sidebar
    // link they just activated. tabindex=-1 makes the container focusable
    // without adding it to the tab order.
    var c = document.getElementById('page-content');
    if (c) { c.setAttribute('tabindex', '-1'); try { c.focus({ preventScroll: true }); } catch (_e) { try { c.focus(); } catch (_e2) {} } }
    return r;
  }
  // Expose the SPA router so other in-page modules (e.g. the onboarding wizard)
  // can navigate client-side instead of a full page load.
  window.QFApp = window.QFApp || {};
  window.QFApp.go = go;

  // ── Theme toggle ──────────────────────────────────────────────
  // Lucide-style line icons (stroke=currentColor so they theme with the UI).
  var SUN_SVG = '<svg class="qf-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>';
  var MOON_SVG = '<svg class="qf-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
  var WRENCH_SVG = '<svg class="qf-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>';
  // Sparkle (AI) + close glyphs for the floating copilot bubble.
  var SPARKLE_SVG = '<svg class="qf-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 14l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z"/></svg>';
  var CLOSE_SVG = '<svg class="qf-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

  // ── Floating AI copilot bubble ────────────────────────────────
  // A persistent launcher + docked chat popover on EVERY authed portal route.
  // Reuses the owner rate-chat brain (buildRateChat → Apply/Discard proposals).
  // Mounted in #app-shell (a sibling of #page-content) so it survives route
  // swaps; #page-content is wiped on every render but the shell is not.
  function mountCopilotBubble() {
    var shell = document.getElementById('app-shell');
    if (!shell || document.getElementById('qf-copilot-launcher')) return;

    var launcher = el('button', {
      id: 'qf-copilot-launcher', class: 'qf-copilot-launcher', type: 'button',
      'aria-label': 'Open AI copilot', 'aria-haspopup': 'dialog', 'aria-expanded': 'false',
      html: SPARKLE_SVG,
    });
    var scrim = el('div', { class: 'qf-copilot-scrim', 'aria-hidden': 'true' });

    var closeBtn = el('button', { class: 'qf-copilot-close', type: 'button', 'aria-label': 'Close copilot', html: CLOSE_SVG });
    var panel = el('div', {
      id: 'qf-copilot-panel', class: 'qf-copilot-panel', role: 'dialog',
      'aria-modal': 'false', 'aria-label': 'AI copilot',
    });
    panel.hidden = true;
    panel.appendChild(el('div', { class: 'qf-copilot-head' }, [
      el('div', { class: 'qf-copilot-title' }, [
        el('span', { class: 'qf-copilot-spark', html: SPARKLE_SVG, 'aria-hidden': 'true' }),
        el('span', { text: 'AI copilot' }),
      ]),
      closeBtn,
    ]));

    var chatUI = buildRateChat({
      greeting: 'Hi — I can update your rate cards, accessorials, and lane zones. Tell me what to change.',
    });
    chatUI.root.classList.add('qf-copilot-chat');
    panel.appendChild(chatUI.root);

    shell.appendChild(scrim);
    shell.appendChild(launcher);
    shell.appendChild(panel);

    var loaded = false;
    var onDocDown = null;

    function open() {
      if (!panel.hidden) return;
      panel.hidden = false;
      launcher.setAttribute('aria-expanded', 'true');
      document.body.classList.add('qf-copilot-open');
      requestAnimationFrame(function () { panel.classList.add('is-open'); });
      try { sessionStorage.setItem('qf-copilot-open', '1'); } catch (e) {}
      // Refresh history on every open so the bubble reflects anything said on
      // the AI-agent page (and vice-versa) — one continuous conversation.
      chatUI.load().catch(function () { if (!loaded) chatUI.renderHistory([]); });
      loaded = true;
      setTimeout(function () { try { chatUI.input.focus(); } catch (e) {} }, 80);
      // Click outside the panel/launcher closes (desktop popover + mobile scrim).
      onDocDown = function (e) {
        if (panel.contains(e.target) || launcher.contains(e.target)) return;
        close();
      };
      setTimeout(function () { document.addEventListener('mousedown', onDocDown); }, 0);
    }
    function close() {
      if (panel.hidden) return;
      panel.classList.remove('is-open');
      launcher.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('qf-copilot-open');
      try { sessionStorage.setItem('qf-copilot-open', '0'); } catch (e) {}
      if (onDocDown) { document.removeEventListener('mousedown', onDocDown); onDocDown = null; }
      setTimeout(function () { panel.hidden = true; }, 200);
      try { launcher.focus(); } catch (e) {}
    }
    function toggle() { if (panel.hidden) open(); else close(); }

    launcher.addEventListener('click', toggle);
    closeBtn.addEventListener('click', close);
    scrim.addEventListener('click', close);

    // Esc closes; Tab is trapped inside the open dialog for keyboard users.
    panel.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.key !== 'Tab') return;
      var nodes = panel.querySelectorAll('button, textarea, input, a[href], [tabindex]:not([tabindex="-1"])');
      var f = Array.prototype.filter.call(nodes, function (n) { return !n.disabled && n.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    // Remember open/closed within the session.
    try { if (sessionStorage.getItem('qf-copilot-open') === '1') open(); } catch (e) {}
  }
  function wireThemeToggle() {
    var btn = document.getElementById('qf-theme-toggle');
    var icon = document.getElementById('qf-theme-icon');
    var label = document.getElementById('qf-theme-label');
    if (!btn) return;
    function paint() {
      var isLight = document.documentElement.getAttribute('data-theme') === 'light';
      // Icon + label both reflect the CURRENT theme.
      icon.innerHTML = isLight ? SUN_SVG : MOON_SVG;
      label.textContent = isLight ? 'Light' : 'Dark';
      btn.setAttribute('aria-label', 'Switch to ' + (isLight ? 'dark' : 'light') + ' theme');
    }
    paint();
    btn.addEventListener('click', function () {
      var isLight = document.documentElement.getAttribute('data-theme') === 'light';
      if (isLight) {
        document.documentElement.removeAttribute('data-theme');
        try { localStorage.setItem('qf-theme', 'dark'); } catch (e) {}
      } else {
        document.documentElement.setAttribute('data-theme', 'light');
        try { localStorage.setItem('qf-theme', 'light'); } catch (e) {}
      }
      paint();
    });
  }

  // ── Account page ──────────────────────────────────────────────
  // Profile: name / login email / phone (phone → tenant.contactPhone via
  // /api/auth/profile). Company details: the customer-facing contact block
  // shown on the widget + hosted quotes — public contact email (tenant.publicContactEmail),
  // company address (carrier-profile store), USDOT + MC (marketplace-settings).
  // Then password + sessions. Consolidates fields that used to be scattered
  // across the Brand "Carrier profile" card and marketplace settings.
  function renderAccount(c) {
    api('/api/auth/me').then(function (r) {
      if (!r.user) { location.href = '/login'; return; }
      c.innerHTML = '';
      c.appendChild(el('h1', { text: 'Account' }));
      c.appendChild(el('p', { class: 'page-sub', text: 'Profile, password, and session management.' }));

      // Profile card
      var pCard = el('div', { class: 'card' });
      pCard.appendChild(el('div', { class: 'card-title', text: 'Profile' }));
      function profileRow(labelText, key, type) {
        var f = el('div', { class: 'field', style: { marginBottom: '12px' } });
        f.appendChild(el('label', { class: 'field-label', text: labelText }));
        var inp = el('input', { class: 'input', value: r.user[key] || (r.tenant && r.tenant[key]) || '', type: type || 'text' });
        inp.dataset.key = key;
        f.appendChild(inp);
        return f;
      }
      pCard.appendChild(profileRow('Name', 'name'));
      pCard.appendChild(profileRow('Email', 'email', 'email'));
      // Phone → tenant.contactPhone (also shown to customers on the widget
      // + hosted quotes; see the Company details card below).
      pCard.appendChild(profileRow('Phone', 'contactPhone', 'tel'));
      var saveProfile = el('button', { class: 'btn btn-primary', text: 'Save profile', style: { marginTop: '8px' } });
      saveProfile.addEventListener('click', function () {
        var body = {};
        $$('input[data-key]', pCard).forEach(function (i) {
          var v = i.value.trim();
          // contactPhone is nullable; send null (not '') so clearing it works.
          body[i.dataset.key] = i.dataset.key === 'contactPhone' ? (v || null) : v;
        });
        saved(api('/api/auth/profile', { method: 'PUT', body: body }), 'Profile saved');
      });
      pCard.appendChild(saveProfile);
      c.appendChild(pCard);

      // ── Company details card ────────────────────────────────────
      // One clear home for the contact details customers see on the
      // calculator + quotes. Wires to the existing stores (no parallel
      // copy): public contact email → tenant.publicContactEmail (/api/auth/profile),
      // address → carrier-profile, USDOT/MC → marketplace-settings.
      var coCard = el('div', { class: 'card', style: { marginTop: '14px' } });
      coCard.appendChild(el('div', { class: 'card-title', text: 'Company details' }));
      coCard.appendChild(el('p', {
        class: 'muted', style: { marginTop: 0 },
        text: 'Shown to your customers on your calculator and quotes. Your phone (set in Profile above) appears here too.',
      }));
      var coLoading = el('p', { class: 'muted-small', text: 'Loading…' });
      coCard.appendChild(coLoading);
      c.appendChild(coCard);

      Promise.all([
        api('/api/tenant/carrier-profile').catch(function () { return { profile: {} }; }),
        api('/api/tenant/marketplace-settings').catch(function () { return {}; }),
      ]).then(function (res2) {
        var profile = (res2[0] && res2[0].profile) || {};
        var mkt = res2[1] || {};
        coLoading.remove();

        function coField(labelText, key, value, type) {
          var f = el('div', { class: 'field', style: { marginBottom: '12px' } });
          f.appendChild(el('label', { class: 'field-label', text: labelText }));
          var inp = el('input', { class: 'input', value: value || '', type: type || 'text' });
          inp.dataset.co = key;
          f.appendChild(inp);
          return f;
        }

        // Public, opt-in contact email — bound to tenant.publicContactEmail, NOT
        // the private owner/login email. Blank = the email row is hidden from
        // customers on the calculator + quotes (we never expose the login email).
        var emailField = coField('Public contact email', 'publicContactEmail', (r.tenant && r.tenant.publicContactEmail) || '', 'email');
        emailField.appendChild(el('span', {
          class: 'muted-small',
          style: { display: 'block', marginTop: '4px' },
          text: 'Optional — shown to customers on your calculator and quotes. Leave blank to hide it.',
        }));
        coCard.appendChild(emailField);

        // Quote disclaimer / terms — bound to tenant.quoteDisclaimer via
        // /api/auth/profile. Shown at the bottom of every quote (widget result,
        // hosted quote, printable/PDF). Blank = the platform default is used;
        // the default is shown as the placeholder so they see what they'd get.
        var discField = el('div', { class: 'field', style: { marginBottom: '12px' } });
        discField.appendChild(el('label', { class: 'field-label', text: 'Quote disclaimer' }));
        var discInput = el('textarea', {
          class: 'input', rows: '6',
          placeholder: (r.tenant && r.tenant.defaultQuoteDisclaimer) || '',
        });
        discInput.value = (r.tenant && r.tenant.quoteDisclaimer) || '';
        discInput.dataset.coDisc = '1';
        discField.appendChild(discInput);
        discField.appendChild(el('span', {
          class: 'muted-small',
          style: { display: 'block', marginTop: '4px' },
          text: 'Shown at the bottom of every quote — leave blank to use the default. Edit it to add your own terms (per-diem, steamship-line, lane-specific clauses).',
        }));
        coCard.appendChild(discField);

        var addrGrid = el('div', { class: 'grid-2', style: { gap: '12px' } });
        addrGrid.appendChild(coField('Address line 1', 'addressLine1', profile.addressLine1));
        addrGrid.appendChild(coField('Address line 2', 'addressLine2', profile.addressLine2));
        addrGrid.appendChild(coField('City', 'city', profile.city));
        addrGrid.appendChild(coField('State / province', 'state', profile.state));
        addrGrid.appendChild(coField('Postal / ZIP code', 'postalCode', profile.postalCode));
        addrGrid.appendChild(coField('Country', 'country', profile.country));
        coCard.appendChild(addrGrid);

        var idGrid = el('div', { class: 'grid-2', style: { gap: '12px' } });
        idGrid.appendChild(coField('USDOT number', 'dotNumber', mkt.dotNumber));
        idGrid.appendChild(coField('MC number', 'mcNumber', mkt.mcNumber));
        coCard.appendChild(idGrid);

        var saveCo = el('button', { class: 'btn btn-primary', text: 'Save company details', style: { marginTop: '8px' } });
        saveCo.addEventListener('click', function () {
          var vals = {};
          $$('input[data-co]', coCard).forEach(function (i) { vals[i.dataset.co] = i.value.trim() || null; });
          // The disclaimer is a textarea (not [data-co]); collect it separately.
          // Blank → null so clearing it falls back to the platform default.
          var discEl = coCard.querySelector('textarea[data-co-disc]');
          var quoteDisclaimer = discEl ? (discEl.value.trim() || null) : undefined;
          saveCo.disabled = true;
          Promise.all([
            api('/api/auth/profile', { method: 'PUT', body: { publicContactEmail: vals.publicContactEmail, quoteDisclaimer: quoteDisclaimer } }),
            api('/api/tenant/carrier-profile', { method: 'PUT', body: {
              addressLine1: vals.addressLine1, addressLine2: vals.addressLine2,
              city: vals.city, state: vals.state, postalCode: vals.postalCode, country: vals.country,
            } }),
            api('/api/tenant/marketplace-settings', { method: 'PUT', body: {
              dotNumber: vals.dotNumber, mcNumber: vals.mcNumber,
            } }),
          ]).then(function () { toastOk('Company details saved'); }, function (e) { toastErr(e); })
            .then(function () { saveCo.disabled = false; });
        });
        coCard.appendChild(saveCo);
      }).catch(function () { coLoading.textContent = 'Could not load company details.'; });

      // ── Plan & billing card (audit H1/H2) ───────────────────────
      // Renders the REAL billing state instead of a blind "Current plan: free"
      // with an always-on Manage-billing button:
      //   - trialing  → "14-day trial · N days left" + Subscribe CTA (if configured)
      //   - active    → plan name + Manage billing (Stripe portal)
      //   - expired   → "trial ended" + Add-a-card CTA (if configured)
      //   - unconfigured → calm "Billing isn't enabled yet" — no dead button
      // Uses r.trial/r.tenant already on the wire (H2) and gates Manage/Subscribe
      // on /api/billing/status (H1) so we never open a portal/checkout that 503s.
      var billCard = el('div', { class: 'card', style: { marginTop: '14px' } });
      billCard.appendChild(el('div', { class: 'card-title', text: 'Plan & billing' }));
      var billBody = el('div');
      billBody.appendChild(el('p', { class: 'muted-small', style: { marginTop: 0 }, text: 'Loading…' }));
      billCard.appendChild(billBody);
      c.appendChild(billCard);

      ensureBillingStatus().then(function (billing) {
        var configured = !!(billing && billing.configured);
        var trial = r.trial || {};
        var status = trial.status || 'unknown';
        var planSlug = (r.tenant && r.tenant.plan) || 'free';
        var planLabel = planSlug.charAt(0).toUpperCase() + planSlug.slice(1);
        billBody.innerHTML = '';

        function addNote(txt) {
          billBody.appendChild(el('p', { class: 'muted', style: { marginTop: 0, marginBottom: '16px' }, text: txt }));
        }
        function addSubscribeBtn(label) {
          var b = el('button', { class: 'btn btn-primary', type: 'button' });
          b.appendChild(document.createTextNode(label));
          b.appendChild(el('span', { class: 'arr', 'aria-hidden': 'true', text: '→' }));
          b.addEventListener('click', function () {
            b.disabled = true;
            startSubscribeCheckout('vital').then(function () { b.disabled = false; }, function () { b.disabled = false; });
          });
          billBody.appendChild(b);
        }
        function addUnconfiguredNote() {
          // Calm, honest — no Manage/Subscribe button that would 503.
          billBody.appendChild(el('p', {
            class: 'muted-small', style: { marginTop: 0, marginBottom: 0 },
            text: "Billing isn't enabled yet — you'll be able to add a card here once online payments are turned on. Your trial keeps every feature unlocked in the meantime.",
          }));
        }

        if (status === 'trial') {
          var dLeft = typeof trial.daysLeft === 'number' ? trial.daysLeft : 0;
          var daysTxt = dLeft <= 0 ? 'last day' : (dLeft === 1 ? '1 day left' : dLeft + ' days left');
          addNote('14-day trial · ' + daysTxt + ' — every feature unlocked. Subscribe to keep your calculator live when the trial ends.');
          if (configured) addSubscribeBtn('Keep your calculator live '); else addUnconfiguredNote();
        } else if (status === 'trial_expired') {
          addNote('Your free trial has ended — your calculator is read-only. Subscribe to keep making changes and capturing leads.');
          if (configured) addSubscribeBtn('Add a card to continue '); else addUnconfiguredNote();
        } else if (status === 'paid') {
          // A paying tenant whose auto-renewal failed (Stripe past_due, kept in
          // grace) needs a clear "update your card" nudge on the billing page.
          var pastDue = !!(trial && trial.paymentPastDue);
          if (pastDue) {
            billBody.appendChild(el('p', { class: 'field-hint', style: { color: 'var(--warn)', marginTop: '0', marginBottom: '8px', fontWeight: '700' }, text: 'Your last payment failed — update your card to keep your service active.' }));
          }
          addNote('Current plan: ' + planLabel + '. Update your card, change plan, or cancel anytime — no phone call needed.');
          // Only a real subscription can be "managed" — the portal 404s otherwise.
          var mBtn = el('button', { class: 'btn btn-primary', type: 'button', text: pastDue ? 'Update card' : 'Manage billing' });
          mBtn.addEventListener('click', function () { openBillingPortal(); });
          billBody.appendChild(mBtn);
        } else {
          // Unknown trial state (e.g. no tenant): show the plan, no dead button.
          addNote('Current plan: ' + planLabel + '.');
          if (!configured) addUnconfiguredNote();
        }
      });

      // ── Get paid card (Stripe Connect onboarding — payments PR 1) ──
      // A "connect a way to get paid" section: a row of payout-provider
      // options under one heading, holding the Stripe option today and
      // LAID OUT so a PayPal option sits right beside it later. Only shown
      // when Connect is configured (GET /api/tenant/connect/config), so we
      // never advertise a button that would 503. NO charge here — onboarding
      // + live status only.
      renderGetPaidSection(c);

      // Password card
      var pwd = el('div', { class: 'card', style: { marginTop: '14px' } });
      pwd.appendChild(el('div', { class: 'card-title', text: 'Change password' }));
      function pwdField(labelText, name) {
        var f = el('div', { class: 'field', style: { marginBottom: '12px' } });
        f.appendChild(el('label', { class: 'field-label', text: labelText }));
        var inp = el('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
        inp.dataset.name = name;
        f.appendChild(inp);
        return f;
      }
      pwd.appendChild(pwdField('Current password', 'current'));
      pwd.appendChild(pwdField('New password (10+ chars)', 'next'));
      pwd.appendChild(pwdField('Confirm new password', 'confirm'));
      var pwdBtn = el('button', { class: 'btn btn-primary', text: 'Update password', style: { marginTop: '8px' } });
      pwdBtn.addEventListener('click', function () {
        var fields = {};
        $$('input[data-name]', pwd).forEach(function (i) { fields[i.dataset.name] = i.value; });
        if (!fields.current || !fields.next) return toastErr({ message: 'Both current and new password required.' });
        if (fields.next !== fields.confirm) return toastErr({ message: 'New password and confirmation do not match.' });
        if (fields.next.length < 10) return toastErr({ message: 'New password must be at least 10 characters.' });
        saved(
          api('/api/auth/password', { method: 'PUT', body: { current: fields.current, next: fields.next } }),
          'Password updated. You stay signed in here.'
        ).then(function () { $$('input[data-name]', pwd).forEach(function (i) { i.value = ''; }); });
      });
      pwd.appendChild(pwdBtn);
      c.appendChild(pwd);

      // Sessions card
      var sess = el('div', { class: 'card', style: { marginTop: '14px' } });
      sess.appendChild(el('div', { class: 'card-title', text: 'Active sessions' }));
      sess.appendChild(el('p', { class: 'muted', style: { marginTop: 0 }, text: 'Sign out from every device, including this one. You will be returned to the login page.' }));
      var soa = el('button', { class: 'btn btn-danger', text: 'Sign out everywhere' });
      soa.addEventListener('click', function () {
        if (!confirm('Sign out of every device including this one?')) return;
        api('/api/auth/sign-out-all', { method: 'POST' }).finally(function () { location.href = '/login'; });
      });
      sess.appendChild(soa);
      c.appendChild(sess);
    }).catch(showErr(c));
  }

  // ── Overview ──────────────────────────────────────────────────
  function renderOverview(c) {
    Promise.all([
      api('/api/tenant/overview'),
      api('/api/tenant/setup-status').catch(function () { return {}; }),
    ]).then(function (res) {
      var d = res[0], setup = res[1] || {};
      c.innerHTML = '';
      c.appendChild(el('h1', { text: 'Overview' }));
      c.appendChild(el('p', { class: 'page-sub', text: 'Welcome back to ' + (d.tenant.name || 'your dashboard') + '.' }));

      // Setup checklist — one clear "what to do next" card (replaces the old
      // injected coach panels). Shows until the essentials (rates + brand) are
      // done; brand-new tenants still get the full guided wizard at first login.
      var steps = [
        { label: 'Set your rates', hint: 'Add at least one rate card — this powers every quote.', route: 'rates', done: !!setup.rates },
        { label: 'Customize your look', hint: 'Add your logo, name, and colors so it feels like your company.', route: 'brand', done: !!setup.brand },
        { label: 'Share your calculator', hint: 'Copy your link or embed code and put it in front of customers.', route: 'embed', done: false },
      ];
      if (!(setup.rates && setup.brand)) {
        var chk = el('div', { class: 'card', style: { margin: '0 0 24px', padding: '18px 20px' } });
        chk.appendChild(el('div', { style: { fontSize: '16px', fontWeight: '800', letterSpacing: '-0.01em' }, text: 'Get your calculator live' }));
        chk.appendChild(el('div', { class: 'muted-small', style: { margin: '2px 0 14px' }, text: 'Three quick steps and you can start quoting customers.' }));
        steps.forEach(function (st, i) {
          var row = el('a', { href: '#', 'data-route': st.route, style: { display: 'flex', gap: '12px', alignItems: 'flex-start', padding: '10px 0', textDecoration: 'none', color: 'inherit', borderTop: i ? '1px solid var(--border)' : '0' } });
          var mark = el('span', { style: { flex: '0 0 auto', width: '24px', height: '24px', borderRadius: '999px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: '800', background: st.done ? 'var(--accent)' : 'transparent', color: st.done ? '#ffffff' : 'var(--muted)', border: st.done ? '0' : '1px solid var(--border)' }, text: st.done ? '✓' : String(i + 1) });
          var txt = el('div', {});
          txt.appendChild(el('div', { style: { fontWeight: '700', fontSize: '14px', color: st.done ? 'var(--muted)' : 'var(--ink)', textDecoration: st.done ? 'line-through' : 'none' }, text: st.label }));
          txt.appendChild(el('div', { class: 'muted-small', style: { marginTop: '1px' }, text: st.hint }));
          row.appendChild(mark); row.appendChild(txt);
          if (!st.done) row.appendChild(el('span', { style: { marginLeft: 'auto', alignSelf: 'center', color: 'var(--accent)', fontWeight: '700', fontSize: '13px', whiteSpace: 'nowrap' }, text: 'Go →' }));
          chk.appendChild(row);
        });
        c.appendChild(chk);
      }

      // KPI Overview — period-scoped big-number tiles, deltas, charts, and a
      // latest-lane map. Rebuilt from the old 4 all-time stat cards. The block
      // owns its own period toggle and refetches /overview/kpis on change; the
      // recent-leads table + audit + setup checklist below are untouched.
      var kpiSection = el('div', { class: 'qf-kpi-section' });
      c.appendChild(kpiSection);
      renderKpiBlock(kpiSection, d);

      c.appendChild(el('h2', { text: 'Recent leads', style: { marginTop: '32px' } }));
      if (!d.recentLeads.length) {
        c.appendChild(el('p', { class: 'muted', text: 'No leads yet. Share your widget link to get your first.' }));
      } else {
        // qf-leads-table drives the ≤480px stacked-card reflow (lead-queue-search.css)
        // so on a phone the Total + Status columns stay visible instead of being
        // pushed off-screen behind the shared .table sideways scroll. Each <td>
        // carries a data-label the reflow renders as its row heading.
        var tbl = el('table', { class: 'table qf-leads-table' });
        tbl.innerHTML =
          '<thead><tr><th>Ref</th><th>Customer</th><th>Service</th><th>Lane</th><th style="text-align:right;">Total</th><th>When</th><th>Status</th></tr></thead><tbody></tbody>';
        var tb = $('tbody', tbl);
        d.recentLeads.forEach(function (l) {
          tb.innerHTML += '<tr>' +
            '<td data-label="Ref"><a href="/app/leads/' + encodeURIComponent(l.refId) + '" data-route="leads/' + encodeURIComponent(l.refId) + '">' + escapeHtml(l.refId) + '</a></td>' +
            '<td data-label="Customer">' + escapeHtml(l.customerName || '—') + '<br><span class="muted-small">' + escapeHtml(l.customerEmail || '') + '</span></td>' +
            '<td data-label="Service">' + escapeHtml(l.service || '') + ' / ' + escapeHtml(l.equipment || '') + '</td>' +
            '<td data-label="Lane">' + escapeHtml(l.pickupCity || '?') + ' → ' + escapeHtml(l.deliveryCity || '?') + '<br><span class="muted-small">' + (l.distanceMiles ? Math.round(l.distanceMiles) + ' mi' : '') + '</span></td>' +
            '<td data-label="Total" style="text-align:right;font-variant-numeric:tabular-nums;">$' + fmtMoney(l.quotedTotal) + '</td>' +
            '<td data-label="When"><span class="muted-small">' + fmtDate(l.createdAt) + '</span></td>' +
            '<td data-label="Status"><span class="badge ' + statusClass(l.status) + '">' + escapeHtml(statusLabel(l.status)) + '</span></td>' +
            '</tr>';
        });
        c.appendChild(tbl);
      }

      c.appendChild(el('h2', { text: 'Recent AI / manual edits', style: { marginTop: '32px' } }));
      if (!d.audit.length) {
        c.appendChild(el('p', { class: 'muted', text: 'No edits yet.' }));
      } else {
        var ul = el('div', { class: 'card' });
        d.audit.forEach(function (a) {
          ul.appendChild(el('div', {
            class: 'card-row',
            html: '<div><strong>' + escapeHtml(a.action) + '</strong> <span class="badge ' +
              (a.actorKind === 'ai_agent' ? 'badge-info' : 'badge-muted') + '">' + escapeHtml(a.actorKind) +
              '</span><br><span class="muted-small">' + escapeHtml(a.detailsJson && a.detailsJson.reason ? a.detailsJson.reason : '') + '</span></div>' +
              '<span class="muted-small">' + fmtDate(a.createdAt) + '</span>',
          }));
        });
        c.appendChild(ul);
      }
    }).catch(showErr(c));
  }

  // ── KPI Overview block ────────────────────────────────────────
  // Big-number tiles + deltas + inline-SVG trend + CSS lane/equipment bars +
  // a latest-lane map card. No chart deps — pure SVG + flex bars, theme-aware
  // via CSS tokens (overview-kpis.css). `overview` is the /api/tenant/overview
  // payload, reused for the map card's most-recent lead (no extra fetch).
  var KPI_PERIODS = ['7d', '30d', '90d'];
  // Human labels for the period toggle — the raw '7d/30d/90d' values still
  // drive the fetch + storage; only the button text spells out the unit so
  // "7 days" reads clearly instead of a cryptic "7D".
  var KPI_PERIOD_LABELS = { '7d': '7 days', '30d': '30 days', '90d': '90 days' };
  function currentKpiPeriod() {
    try { var p = localStorage.getItem('qf-kpi-period'); if (KPI_PERIODS.indexOf(p) >= 0) return p; } catch (e) {}
    return '30d';
  }
  function fmtInt(n) {
    if (typeof n !== 'number' || isNaN(n)) return '0';
    return Math.round(n).toLocaleString('en-US');
  }
  function renderKpiBlock(wrap, overview) {
    var period = currentKpiPeriod();
    wrap.innerHTML = '';
    var head = el('div', { class: 'qf-kpi-head' });
    head.appendChild(el('h2', { text: 'Performance', style: { margin: '0' } }));
    var toggle = el('div', { class: 'qf-kpi-toggle', role: 'group', 'aria-label': 'Metric period' });
    KPI_PERIODS.forEach(function (p) {
      var b = el('button', {
        type: 'button',
        class: 'qf-kpi-period-btn' + (p === period ? ' is-active' : ''),
        text: KPI_PERIOD_LABELS[p] || p,
        'aria-label': 'Last ' + (KPI_PERIOD_LABELS[p] || p),
        'aria-pressed': p === period ? 'true' : 'false',
      });
      b.addEventListener('click', function () {
        if (p === currentKpiPeriod()) return;
        try { localStorage.setItem('qf-kpi-period', p); } catch (e) {}
        renderKpiBlock(wrap, overview);
      });
      toggle.appendChild(b);
    });
    head.appendChild(toggle);
    wrap.appendChild(head);

    var body = el('div', { class: 'qf-kpi-body' });
    body.appendChild(el('p', { class: 'muted-small', style: { margin: '0' }, text: 'Loading metrics…' }));
    wrap.appendChild(body);

    api('/api/tenant/overview/kpis?period=' + encodeURIComponent(period)).then(function (k) {
      renderKpiBody(body, k, overview);
    }).catch(function () {
      body.innerHTML = '';
      body.appendChild(el('p', { class: 'muted-small', style: { margin: '0' }, text: 'Could not load performance metrics.' }));
    });
  }

  function deltaPill(delta) {
    var d = delta ? delta.deltaPct : null;
    var cls = 'qf-kpi-delta', arrow, txt;
    if (d == null || typeof d !== 'number' || isNaN(d)) { cls += ' is-flat'; arrow = '—'; txt = ''; }
    else if (d > 0) { cls += ' is-up'; arrow = '▲'; txt = d + '%'; }
    else if (d < 0) { cls += ' is-down'; arrow = '▼'; txt = Math.abs(d) + '%'; }
    else { cls += ' is-flat'; arrow = '—'; txt = '0%'; }
    return el('span', { class: cls, text: txt ? arrow + ' ' + txt : arrow });
  }

  function kpiTile(label, valueText, delta, subText) {
    var tile = el('div', { class: 'qf-kpi-tile' });
    tile.appendChild(el('div', { class: 'qf-kpi-label', text: label }));
    tile.appendChild(el('div', { class: 'qf-kpi-value', text: valueText }));
    var meta = el('div', { class: 'qf-kpi-meta' });
    meta.appendChild(deltaPill(delta));
    if (subText) meta.appendChild(el('span', { class: 'qf-kpi-sub', text: subText }));
    tile.appendChild(meta);
    return tile;
  }

  // Responsive inline-SVG trend (area + line). viewBox scales; the line uses
  // vector-effect:non-scaling-stroke (CSS) so it stays crisp when stretched.
  function trendChart(series) {
    var wrap = el('div', { class: 'qf-kpi-trend' });
    var vals = (series || []).map(function (p) { return p.quotes || 0; });
    var n = vals.length;
    var total = vals.reduce(function (s, v) { return s + v; }, 0);
    if (!n || total === 0) {
      wrap.appendChild(el('p', { class: 'muted-small', style: { margin: '0' }, text: 'No quotes in this period.' }));
      return wrap;
    }
    var W = 300, H = 96, pad = 6;
    var max = Math.max.apply(null, vals.concat([1]));
    var x = function (i) { return n === 1 ? W / 2 : pad + (i / (n - 1)) * (W - 2 * pad); };
    var y = function (v) { return H - pad - (v / max) * (H - 2 * pad); };
    var line = '';
    for (var i = 0; i < n; i++) { line += (i === 0 ? 'M' : 'L') + x(i).toFixed(1) + ',' + y(vals[i]).toFixed(1) + ' '; }
    var area = 'M' + x(0).toFixed(1) + ',' + (H - pad) + ' ' + line + 'L' + x(n - 1).toFixed(1) + ',' + (H - pad) + ' Z';
    wrap.innerHTML =
      '<svg class="qf-kpi-trend-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Quotes over time">' +
      '<path class="qf-kpi-trend-area" d="' + area + '"/>' +
      '<path class="qf-kpi-trend-line" d="' + line.trim() + '"/>' +
      '</svg>';
    return wrap;
  }

  // Horizontal CSS-flex bars — width as % of the max, labels truncate.
  function barList(items, labelKey, countKey, opts) {
    opts = opts || {};
    var wrap = el('div', { class: 'qf-kpi-bars' });
    if (!items || !items.length) {
      wrap.appendChild(el('p', { class: 'muted-small', style: { margin: '0' }, text: opts.empty || 'No data yet.' }));
      return wrap;
    }
    var rows = items.slice(0, 5);
    var max = Math.max.apply(null, rows.map(function (r) { return r[countKey] || 0; }).concat([1]));
    rows.forEach(function (r) {
      var row = el('div', { class: 'qf-kpi-bar-row' });
      row.appendChild(el('div', { class: 'qf-kpi-bar-label', text: String(r[labelKey]), title: String(r[labelKey]) }));
      var track = el('div', { class: 'qf-kpi-bar-track' });
      var fill = el('div', { class: 'qf-kpi-bar-fill' });
      fill.style.width = Math.max(4, Math.round((r[countKey] || 0) / max * 100)) + '%';
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el('div', { class: 'qf-kpi-bar-count', text: String(r[countKey]) }));
      wrap.appendChild(row);
    });
    return wrap;
  }

  // Latest lane with coordinates → the cached server-side static map (theme
  // synced to the dashboard). Returns null when no lead has coords (card hidden).
  function latestLaneCard(overview) {
    var leadsArr = (overview && overview.recentLeads) || [];
    var lead = null;
    for (var i = 0; i < leadsArr.length; i++) {
      var l = leadsArr[i];
      if (l && l.refId && l.pickupLat != null && l.pickupLng != null && l.deliveryLat != null && l.deliveryLng != null) { lead = l; break; }
    }
    if (!lead) return null;
    var theme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    var card = el('div', { class: 'card qf-kpi-card qf-kpi-map-card' });
    card.appendChild(el('div', { class: 'qf-kpi-card-title', text: 'Latest lane' }));
    var route = 'leads/' + encodeURIComponent(lead.refId);
    var a = el('a', { href: '/app/' + route, 'data-route': route, class: 'qf-kpi-map-link' });
    a.appendChild(el('img', {
      class: 'qf-kpi-map-img',
      src: '/api/public/quote-map/' + encodeURIComponent(lead.refId) + '.png?theme=' + theme,
      alt: 'Route map for ' + lead.refId,
      loading: 'lazy',
    }));
    a.appendChild(el('div', { class: 'qf-kpi-map-caption', text: (lead.pickupCity || '—') + ' → ' + (lead.deliveryCity || '—') }));
    card.appendChild(a);
    return card;
  }

  function kpiCard(title, contentNode) {
    var card = el('div', { class: 'card qf-kpi-card' });
    card.appendChild(el('div', { class: 'qf-kpi-card-title', text: title }));
    card.appendChild(contentNode);
    return card;
  }

  function renderKpiBody(body, k, overview) {
    body.innerHTML = '';
    var t = k.tiles;
    var tiles = el('div', { class: 'qf-kpi-tiles' });
    tiles.appendChild(kpiTile('Quotes', fmtInt(t.quotes.current), t.quotes, null));
    tiles.appendChild(kpiTile('Won', fmtInt(t.won.current), t.won, t.conversionPct + '% conversion'));
    tiles.appendChild(kpiTile('Quoted value', '$' + fmtInt(t.quotedValue.current), t.quotedValue, null));
    tiles.appendChild(kpiTile('Avg. quote', '$' + fmtInt(t.avgQuote.current), t.avgQuote, null));
    body.appendChild(tiles);

    var charts = el('div', { class: 'qf-kpi-charts' });
    charts.appendChild(kpiCard('Quotes over time', trendChart(k.series)));
    charts.appendChild(kpiCard('Top lanes', barList(k.topLanes, 'lane', 'count', { empty: 'No lanes yet.' })));
    if (k.equipmentMix && k.equipmentMix.length) {
      charts.appendChild(kpiCard('Equipment mix', barList(k.equipmentMix, 'equipment', 'count', { empty: 'No equipment yet.' })));
    }
    var mapCard = latestLaneCard(overview);
    if (mapCard) charts.appendChild(mapCard);
    body.appendChild(charts);
  }

  function statusClass(s) {
    return ({
      new: 'badge-info', draft: 'badge-muted', replied: 'badge-info',
      booking_requested: 'badge-success', won: 'badge-success',
      lost: 'badge-error', spam: 'badge-error',
    })[s] || 'badge-muted';
  }

  var LEAD_STATUSES = ['draft', 'new', 'replied', 'booking_requested', 'won', 'lost', 'spam'];
  function statusLabel(s) {
    return ({
      booking_requested: 'Booking requested',
      new: 'New', draft: 'Draft', replied: 'Replied',
      won: 'Won', lost: 'Lost', spam: 'Spam',
    })[s] || s;
  }

  // Callback statuses render as the same tinted badges as lead statuses (never
  // raw snake_case). Labels drive both the queue badge + the <select> options.
  function callbackStatusLabel(s) {
    return ({
      open: 'Open',
      in_progress: 'In progress',
      completed: 'Completed',
      no_answer: 'No answer',
      cancelled: 'Cancelled',
    })[s] || s;
  }
  function callbackStatusClass(s) {
    return ({
      open: 'badge-info',
      // Dedicated amber class — NOT badge-warn, which dashboard-polish.css
      // overrides to a low-contrast blue (fails WCAG AA + clashes with the
      // blue "Open" badge). badge-progress is defined in lead-queue-search.css.
      in_progress: 'badge-progress',
      completed: 'badge-success',
      no_answer: 'badge-muted',
      cancelled: 'badge-error',
    })[s] || 'badge-muted';
  }

  // ── Leads ─────────────────────────────────────────────────────
  function renderLeads(c) {
    var inner = location.pathname.split('/app/leads/')[1];
    if (inner) return renderLeadDetail(c, inner);

    // Server-backed leads queue: search (debounced) + status filter +
    // Prev/Next pagination all drive the query, so counts + results reflect
    // the WHOLE table, not just a loaded page. Reset to page 1 whenever the
    // search or status filter changes.
    var state = { page: 1, pageSize: 25, search: '', status: '' };
    var shell = null;       // built once, from the first response
    var searchTimer = null;

    function qs() {
      var p = '?page=' + state.page + '&pageSize=' + state.pageSize;
      if (state.search) p += '&search=' + encodeURIComponent(state.search);
      if (state.status) p += '&status=' + encodeURIComponent(state.status);
      return p;
    }
    function load() { api('/api/tenant/leads' + qs()).then(render).catch(showErr(c)); }

    function render(d) {
      if (!shell) buildShell(d);
      if (shell.empty) return;
      renderList(d);
    }

    function buildShell(d) {
      c.innerHTML = '';
      // Header row: title on the left, Export CSV on the right. The button
      // downloads the tenant's full lead list from
      //   GET /api/tenant/leads/export.csv
      // which is session-cookie authed + tenant-scoped, so a plain download
      // link carries the same session (no token to attach). The endpoint takes
      // no filters, so this always exports EVERY lead regardless of the current
      // search/status view. Only shown when the tenant has leads at all.
      var head = el('div', { class: 'qf-leads-header' });
      head.appendChild(el('h1', { text: 'Leads' }));
      if (d.leads.length) {
        head.appendChild(el('a', {
          class: 'btn btn-secondary qf-leads-export',
          href: '/api/tenant/leads/export.csv',
          download: '',
          text: 'Export CSV',
        }));
      }
      c.appendChild(head);

      // Zero leads AND no active filter → the classic empty state, no controls.
      if (!d.total && !state.search && !state.status) {
        c.appendChild(el('p', { class: 'page-sub', text: '0 leads' }));
        c.appendChild(el('div', {
          class: 'notice',
          html: 'No leads yet. Copy your <a href="/app/embed">embed code</a> and add it to your website to start collecting quotes.',
        }));
        shell = { empty: true };
        return;
      }

      var sub = el('p', { class: 'page-sub' });
      c.appendChild(sub);

      // Server-backed search + status controls. Reuses the .qf-lead-searchbar
      // shell styling; the counts here are the SERVER's, so they stay accurate
      // past the old 200-row cap.
      var bar = el('section', { class: 'qf-lead-searchbar qf-leads-controls' });
      bar.appendChild(el('div', {}, [
        el('strong', { text: 'Lead queue control' }),
        el('span', { text: 'Search by ref, customer, company, email, or lane; filter by status.' }),
      ]));
      var searchField = el('label');
      searchField.appendChild(el('span', { text: 'Search leads' }));
      var searchInput = el('input', { type: 'search', placeholder: 'Search ref, company, lane…', 'aria-label': 'Search leads by ref, customer, company, email, or lane' });
      searchInput.value = state.search;
      searchField.appendChild(searchInput);
      bar.appendChild(searchField);

      var statusField = el('label');
      statusField.appendChild(el('span', { text: 'Status' }));
      var statusSel = el('select', { class: 'qf-lead-status-filter', 'aria-label': 'Filter leads by status' });
      statusSel.appendChild(el('option', { value: '', text: 'All statuses' }));
      LEAD_STATUSES.forEach(function (s) {
        var o = el('option', { value: s, text: statusLabel(s) });
        if (s === state.status) o.selected = true;
        statusSel.appendChild(o);
      });
      statusField.appendChild(statusSel);
      bar.appendChild(statusField);

      var count = el('b', { class: 'qf-lead-search-count' });
      bar.appendChild(count);
      c.appendChild(bar);

      searchInput.addEventListener('input', function () {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () {
          var v = searchInput.value.trim();
          if (v === state.search) return;
          state.search = v; state.page = 1; load();
        }, 300);
      });
      statusSel.addEventListener('change', function () {
        state.status = statusSel.value; state.page = 1; load();
      });

      var listWrap = el('div', { class: 'qf-leads-list' });
      c.appendChild(listWrap);
      var pager = el('div', { class: 'qf-leads-pager' });
      c.appendChild(pager);

      shell = { sub: sub, count: count, listWrap: listWrap, pager: pager };
    }

    function renderList(d) {
      var totalPages = Math.max(1, Math.ceil(d.total / d.pageSize));
      shell.sub.textContent = d.total + (d.total === 1 ? ' lead' : ' leads');
      shell.listWrap.innerHTML = '';

      if (!d.leads.length) {
        shell.count.textContent = '0 shown';
        shell.listWrap.appendChild(el('div', {
          class: 'qf-lead-search-empty',
          text: (state.search || state.status)
            ? 'No leads match your search or status filter.'
            : 'No leads on this page.',
        }));
        renderPager(d, totalPages);
        return;
      }

      var from = d.pageSize * (d.page - 1) + 1;
      var to = from + d.leads.length - 1;
      shell.count.textContent = 'Showing ' + from + '–' + to + ' of ' + d.total;

      // qf-leads-table drives the ≤480px stacked-card reflow (lead-queue-search.css):
      // each <td> carries a data-label so the decision-critical Total + Status
      // stay visible on mobile without a sideways scroll to reach them.
      var tbl = el('table', { class: 'table qf-leads-table' });
      tbl.innerHTML = '<thead><tr><th>Ref</th><th>Customer</th><th>Service</th><th>Lane</th><th style="text-align:right;">Total</th><th>Status</th><th>When</th></tr></thead><tbody></tbody>';
      var tb = $('tbody', tbl);
      d.leads.forEach(function (l) {
        tb.appendChild(el('tr', {
          on: {
            click: function () { go('leads/' + l.refId); },
            keydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go('leads/' + l.refId); } },
          },
          tabindex: '0', role: 'link', 'aria-label': 'Open lead ' + l.refId,
          style: { cursor: 'pointer' },
          html: '<td data-label="Ref"><strong>' + escapeHtml(l.refId) + '</strong></td>' +
                '<td data-label="Customer"><span class="qf-stack-cell">' + escapeHtml(l.customerName || '—') + '<br><span class="muted-small">' + escapeHtml(l.customerEmail || '') + '</span></span></td>' +
                '<td data-label="Service">' + escapeHtml(l.service || '') + ' / ' + escapeHtml(l.equipment || '') + '</td>' +
                '<td data-label="Lane">' + escapeHtml(l.pickupCity || '?') + ' → ' + escapeHtml(l.deliveryCity || '?') + '</td>' +
                '<td data-label="Total" style="text-align:right;">$' + fmtMoney(l.quotedTotal) + '</td>' +
                '<td data-label="Status"><span class="badge ' + statusClass(l.status) + '">' + escapeHtml(statusLabel(l.status)) + '</span></td>' +
                '<td data-label="When"><span class="muted-small">' + fmtDate(l.createdAt) + '</span></td>',
        }));
      });
      shell.listWrap.appendChild(tbl);
      renderPager(d, totalPages);
    }

    function renderPager(d, totalPages) {
      shell.pager.innerHTML = '';
      if (totalPages <= 1) return;
      var prev = el('button', { type: 'button', class: 'btn btn-secondary', text: 'Prev', 'aria-label': 'Previous page of leads' });
      if (d.page <= 1) prev.setAttribute('disabled', '');
      prev.addEventListener('click', function () { if (state.page > 1) { state.page -= 1; load(); } });
      var info = el('span', { class: 'qf-leads-pager-info', text: 'Page ' + d.page + ' of ' + totalPages });
      var next = el('button', { type: 'button', class: 'btn btn-secondary', text: 'Next', 'aria-label': 'Next page of leads' });
      if (d.page >= totalPages) next.setAttribute('disabled', '');
      next.addEventListener('click', function () { if (state.page < totalPages) { state.page += 1; load(); } });
      shell.pager.appendChild(prev);
      shell.pager.appendChild(info);
      shell.pager.appendChild(next);
    }

    load();
  }

  function renderLeadDetail(c, refId) {
    api('/api/tenant/leads/' + encodeURIComponent(refId)).then(function (d) {
      var l = d.lead;
      c.innerHTML = '';
      c.appendChild(el('a', { href: '#', class: 'muted-small', text: '← Back to leads', on: { click: function (e) { e.preventDefault(); go('leads'); } } }));
      c.appendChild(el('h1', { text: l.refId }));
      var grid = el('div', { class: 'grid-2' });

      var leftCard = el('div', { class: 'card' });
      leftCard.appendChild(el('div', { class: 'card-title', text: 'Customer' }));
      leftCard.innerHTML += '<div><strong>' + escapeHtml(l.customerName || '—') + '</strong></div>' +
        '<div class="muted">' + escapeHtml(l.customerEmail || '') + '</div>' +
        (l.customerPhone ? '<div class="muted">' + escapeHtml(l.customerPhone) + '</div>' : '') +
        (l.customerCompany ? '<div class="muted">' + escapeHtml(l.customerCompany) + '</div>' : '');

      var rightCard = el('div', { class: 'card' });
      rightCard.appendChild(el('div', { class: 'card-title', text: 'Shipment' }));
      rightCard.innerHTML += '<div><strong>' + escapeHtml(l.service || '') + '</strong> / ' + escapeHtml(l.equipment || '') + '</div>' +
        '<div class="muted">' + escapeHtml(l.pickupCity || '?') + ', ' + escapeHtml(l.pickupState || '') + ' → ' + escapeHtml(l.deliveryCity || '?') + ', ' + escapeHtml(l.deliveryState || '') + '</div>' +
        '<div class="muted">' + (l.distanceMiles ? Math.round(l.distanceMiles) + ' mi' : '') + (l.weightLbs ? ' · ' + escapeHtml(l.weightLbs) + ' lbs' : '') + '</div>' +
        '<div class="muted">' + (l.pickupDate ? 'Pickup: ' + escapeHtml(l.pickupDate) : '') + '</div>';

      grid.appendChild(leftCard);
      grid.appendChild(rightCard);
      c.appendChild(grid);

      // Quote card
      var quoteCard = el('div', { class: 'card', style: { marginTop: '14px' } });
      quoteCard.appendChild(el('div', { class: 'card-title', text: 'Quote — $' + fmtMoney(l.quotedTotal) }));
      var tbl = el('table', { class: 'table' });
      tbl.innerHTML = '<thead><tr><th>Line</th><th style="text-align:right;">Amount</th></tr></thead><tbody></tbody>';
      var tb = $('tbody', tbl);
      (l.breakdownJson || []).forEach(function (b) {
        tb.innerHTML += '<tr><td>' + escapeHtml(b.name) + '</td><td style="text-align:right;">$' + fmtMoney(b.amount) + '</td></tr>';
      });
      quoteCard.appendChild(tbl);
      c.appendChild(quoteCard);

      // Status / notes
      var statusCard = el('div', { class: 'card', style: { marginTop: '14px' } });
      statusCard.appendChild(el('div', { class: 'card-title', text: 'Status & notes' }));
      statusCard.appendChild(el('div', { class: 'grid-2' }, [
        (function () {
          var f = el('div', { class: 'field' });
          f.appendChild(el('label', { class: 'field-label', text: 'Status' }));
          var sel = el('select', { class: 'select' });
          LEAD_STATUSES.forEach(function (s) {
            var o = document.createElement('option'); o.value = s; o.textContent = statusLabel(s); if (l.status === s) o.selected = true; sel.appendChild(o);
          });
          sel.addEventListener('change', function () {
            var prev = l.status;
            saved(api('/api/tenant/leads/' + encodeURIComponent(l.refId), { method: 'PATCH', body: { status: sel.value } }))
              .then(function () { l.status = sel.value; })
              .catch(function () { sel.value = prev; }); // revert so the UI never shows an unsaved status
          });
          f.appendChild(sel);
          return f;
        })(),
      ]));
      statusCard.appendChild(el('div', { class: 'field', style: { marginTop: '12px' } }, [
        el('label', { class: 'field-label', text: 'Internal notes' }),
        (function () {
          var ta = el('textarea', { class: 'textarea', placeholder: 'Notes for your team…' });
          ta.value = l.notes || '';
          // Only save (and toast) when the notes actually changed, so a blur
          // that touched nothing doesn't fire a phantom "Saved".
          ta.addEventListener('blur', function () {
            if (ta.value === (l.notes || '')) return;
            saved(api('/api/tenant/leads/' + encodeURIComponent(l.refId), { method: 'PATCH', body: { notes: ta.value } }).then(function (r) { l.notes = ta.value; return r; }));
          });
          return ta;
        })(),
      ]));
      c.appendChild(statusCard);

      // AI summary
      if (l.aiSummary) {
        var aiCard = el('div', { class: 'card', style: { marginTop: '14px' } });
        aiCard.appendChild(el('div', { class: 'card-title', text: 'AI auto-reply (sent to customer)' }));
        aiCard.appendChild(el('pre', { class: 'code', text: l.aiSummary }));
        c.appendChild(aiCard);
      }

      // Conversation
      if (d.conversations && d.conversations.length) {
        var convCard = el('div', { class: 'card', style: { marginTop: '14px' } });
        convCard.appendChild(el('div', { class: 'card-title', text: 'Customer chat (' + d.conversations.length + ' messages)' }));
        var msgs = el('div', { class: 'chat-panel', style: { height: '320px' } });
        var msgList = el('div', { class: 'chat-messages' });
        d.conversations.forEach(function (m) {
          msgList.appendChild(el('div', { class: 'chat-bubble ' + (m.role === 'assistant' ? 'assistant' : 'user'), text: m.content }));
        });
        msgs.appendChild(msgList);
        convCard.appendChild(msgs);
        c.appendChild(convCard);
      }
    }).catch(showErr(c));
  }

  // ── Callbacks ─────────────────────────────────────────────────
  // Inbox of human-callback requests. Defaults to "needs attention"
  // (open + in_progress). Operator can flip status / add notes inline.
  var CALLBACK_STATUSES = ['open', 'in_progress', 'completed', 'no_answer', 'cancelled'];
  function renderCallbacks(c) {
    api('/api/tenant/callbacks').then(function (d) {
      c.innerHTML = '';
      c.appendChild(el('h1', { text: 'Callbacks' }));
      var open = (d.callbacks || []).filter(function (cb) { return cb.status === 'open'; });
      c.appendChild(el('p', {
        class: 'page-sub',
        text: open.length + ' open · ' + (d.callbacks || []).length + ' total',
      }));
      if (!d.callbacks || !d.callbacks.length) {
        c.appendChild(el('div', {
          class: 'notice',
          text: "No callback requests yet. They'll appear here when a visitor taps 'Ask for a callback' on a quote.",
        }));
        return;
      }
      // qf-leads-table gives the ≤480px stacked-card reflow (lead-queue-search.css);
      // each <td> carries a data-label so on a phone the phone number, status
      // control and notes button stack into a labelled card instead of running
      // off-screen. qf-callbacks-table tunes the two interactive cells (status
      // <select> + notes editor row) that the leads table doesn't have.
      var tbl = el('table', { class: 'table qf-leads-table qf-callbacks-table' });
      tbl.innerHTML = '<thead><tr>' +
        '<th>Customer</th><th>Phone</th><th>Quote</th><th>Topic / preferred time</th>' +
        '<th>Status</th><th>When</th><th></th></tr></thead><tbody></tbody>';
      var tb = $('tbody', tbl);
      d.callbacks.forEach(function (cb) {
        var row = el('tr', {});
        var topicLine = (cb.topic || '').slice(0, 80);
        if (cb.preferredTime) topicLine = topicLine ? topicLine + ' · ' + cb.preferredTime : cb.preferredTime;
        row.innerHTML =
          '<td data-label="Customer"><span class="qf-stack-cell"><strong>' + escapeHtml(cb.customerName || '—') + '</strong>' +
            (cb.customerCompany ? '<br><span class="muted-small">' + escapeHtml(cb.customerCompany) + '</span>' : '') + '</span></td>' +
          '<td data-label="Phone"><span class="qf-stack-cell"><a href="tel:' + String(cb.customerPhone || '').replace(/[^\d+]/g, '') + '">' + escapeHtml(cb.customerPhone || '—') + '</a>' +
            (cb.customerEmail ? '<br><span class="muted-small">' + escapeHtml(cb.customerEmail) + '</span>' : '') + '</span></td>' +
          '<td data-label="Quote">' + (cb.leadRefId ? '<a href="/app/leads/' + encodeURIComponent(cb.leadRefId) + '" data-route="leads/' + encodeURIComponent(cb.leadRefId) + '">' + escapeHtml(cb.leadRefId) + '</a>' : '<span class="muted-small">—</span>') + '</td>' +
          '<td data-label="Topic"><span class="muted-small">' + escapeHtml(topicLine || '—') + '</span>' +
            (cb.triggerSource === 'chat_escalation' ? '<br><span class="badge">from chat</span>' : '') + '</td>' +
          '<td data-label="Status"></td>' +
          '<td data-label="When"><span class="muted-small">' + fmtDate(cb.createdAt) + '</span></td>' +
          '<td data-label="Notes"></td>';
        // Status: a tinted badge (matching the leads table) with the <select>
        // beneath it to change it. Both render the human label — never the raw
        // snake_case value.
        var statusCell = row.children[4];
        var statusWrap = el('div', { class: 'qf-cb-status' });
        var statusBadge = el('span', { class: 'badge ' + callbackStatusClass(cb.status), text: callbackStatusLabel(cb.status) });
        var sel = el('select', { class: 'select', 'aria-label': 'Callback status' });
        CALLBACK_STATUSES.forEach(function (s) {
          var o = document.createElement('option'); o.value = s; o.textContent = callbackStatusLabel(s); if (cb.status === s) o.selected = true; sel.appendChild(o);
        });
        sel.addEventListener('change', function () {
          var prev = cb.status, next = sel.value;
          // Update just this row's badge in place — re-rendering the whole list
          // destroyed other rows' open note editors + any unsaved text.
          saved(api('/api/tenant/callbacks/' + cb.id, { method: 'PATCH', body: { status: next } }))
            .then(function () {
              cb.status = next;
              statusBadge.className = 'badge ' + callbackStatusClass(next);
              statusBadge.textContent = callbackStatusLabel(next);
            })
            .catch(function () { sel.value = prev; }); // toastErr already fired via saved()
        });
        statusWrap.appendChild(statusBadge);
        statusWrap.appendChild(sel);
        statusCell.appendChild(statusWrap);
        // Notes editor — inline expandable textarea. Replaces the old
        // window.prompt() flow (which violated the title-in-field +
        // top-left help-cue UI rule and offered no dark-mode contrast).
        var actCell = row.children[6];
        var notesBtn = el('button', {
          class: 'btn-link',
          text: cb.notes ? 'Edit notes' : 'Add notes',
        });
        actCell.appendChild(notesBtn);
        tb.appendChild(row);

        // Editor row — always present in DOM, hidden until expanded so
        // the show/hide is a CSS toggle (no re-render flicker on save).
        // 2px gap to the row above is the project's UI-rule baseline.
        var editorTr = el('tr', { class: 'callback-notes-editor' });
        var editorTd = el('td', {
          colspan: '7',
          style: { padding: '2px 12px 12px 12px' },
        });
        var field = el('div', { class: 'field', style: { gap: '2px' } });
        var labelRow = el('div', {
          style: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: '12px',
          },
        });
        labelRow.appendChild(el('label', { class: 'field-label', text: 'Notes' }));
        labelRow.appendChild(el('span', {
          class: 'field-hint',
          text: 'Visible only to your team · ⌘/Ctrl+Enter to save',
          style: { fontSize: '11px' },
        }));
        field.appendChild(labelRow);
        var ta = el('textarea', {
          class: 'textarea',
          rows: '3',
          placeholder: 'Call outcome, follow-ups, etc.',
        });
        ta.value = cb.notes || '';
        field.appendChild(ta);
        editorTd.appendChild(field);
        editorTr.appendChild(editorTd);
        editorTr.style.display = cb.notes ? '' : 'none';
        tb.appendChild(editorTr);

        function saveNotes() {
          var next = ta.value;
          if (next === (cb.notes || '')) return;
          api('/api/tenant/callbacks/' + cb.id, { method: 'PATCH', body: { notes: next } })
            .then(function () {
              cb.notes = next;
              notesBtn.textContent = next ? 'Edit notes' : 'Add notes';
              toastOk();
            })
            .catch(toastErr);
        }
        ta.addEventListener('blur', saveNotes);
        ta.addEventListener('keydown', function (ev) {
          if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') {
            ev.preventDefault();
            saveNotes();
            ta.blur();
          }
        });
        notesBtn.addEventListener('click', function () {
          var hidden = editorTr.style.display === 'none';
          editorTr.style.display = hidden ? '' : 'none';
          if (hidden) ta.focus();
        });
      });
      c.appendChild(tbl);
    }).catch(showErr(c));
  }

  // ── Rate cards ────────────────────────────────────────────────
  // Service tabs on the rate cards page. The first tab is "All" (every
  // row); each subsequent tab filters to one service. Rendered count
  // shown in tab label so the operator sees at a glance where they have
  // data. Tab + per-column filter choice persists in localStorage.
  var SERVICES = ['drayage', 'ftl', 'ltl', 'expedited', 'hotshot'];
  function getRatesView() {
    try { return JSON.parse(localStorage.getItem('qf-rates-view') || '{}'); }
    catch (e) { return {}; }
  }
  function setRatesView(v) {
    try { localStorage.setItem('qf-rates-view', JSON.stringify(v)); } catch (e) {}
  }

  // ── Fuel-surcharge mode card (auto EIA diesel vs manual per-card %) ──
  function buildFscCard() {
    var card = el('div', { class: 'card', style: { marginTop: '14px' } });
    card.appendChild(el('div', { class: 'card-title', text: 'Fuel surcharge' }));
    var body = el('div');
    card.appendChild(body);
    body.appendChild(el('p', { class: 'muted', text: 'Loading fuel surcharge settings…' }));

    function segButton(label, active, onClick) {
      // Selected = scoped outline+tint (.qf-fsc-seg.is-active), NOT a global
      // solid .btn-primary fill — mirrors the compliant scan-chip selected style.
      var b = el('button', {
        class: 'btn btn-secondary btn-sm qf-fsc-seg' + (active ? ' is-active' : ''),
        text: label,
        style: { marginRight: '8px' },
      });
      b.addEventListener('click', onClick);
      return b;
    }

    function paint(data) {
      body.innerHTML = '';
      var mode = data.mode === 'auto' ? 'auto' : 'manual';
      var seg = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '0', marginBottom: '10px' } });
      seg.appendChild(segButton('Automatic — updates weekly', mode === 'auto', function () { setMode('auto'); }));
      seg.appendChild(segButton('Set my own %', mode === 'manual', function () { setMode('manual'); }));
      body.appendChild(seg);

      var d = data.diesel || {};
      var f = data.formula || {};
      if (mode === 'auto') {
        var priceTxt = (typeof d.usdPerGal === 'number')
          ? '$' + d.usdPerGal.toFixed(2) + '/gal'
          : 'unavailable';
        var wk = d.asOfLabel ? ' (wk of ' + d.asOfLabel + ')' : '';
        var perMi = (typeof f.perMileUsd === 'number') ? '$' + f.perMileUsd.toFixed(2) + '/mi' : '—';
        // Explanatory prose tucked behind a disclosure to keep the card compact.
        var det = el('details', { class: 'qf-fsc-details' });
        det.appendChild(el('summary', { text: 'How automatic fuel surcharge works' }));
        det.appendChild(el('p', { style: { margin: '8px 0 0' }, html:
          'Fuel surcharge follows the <strong>national average diesel price</strong> from the U.S. EIA. ' +
          'Current national average: <strong>' + priceTxt + '</strong>' + wk + ' → surcharge <strong>' + perMi + '</strong>.' }));
        det.appendChild(el('p', { class: 'muted', style: { margin: '4px 0 0', fontSize: '13px' }, text:
          'Formula: ($diesel − $' + (f.pegUsdPerGal != null ? f.pegUsdPerGal.toFixed(2) : '1.25') + ' base) ÷ ' + (f.mpg != null ? f.mpg : '6.0') + ' mpg. Refreshes weekly from EIA. Your per-card Fuel % is ignored while auto is on.' }));
        body.appendChild(det);
        if (d.stale) {
          body.appendChild(el('div', { class: 'notice', style: { marginTop: '6px' }, text:
            'Using the last saved diesel price (live update pending). Quotes still work.' }));
        }
      } else {
        body.appendChild(el('p', { style: { margin: '0 0 4px' }, text:
          'Each rate card uses its own fixed Fuel % (the column in the table below). Switch to Automatic to track the national diesel price weekly.' }));
      }
    }

    function setMode(mode) {
      api('/api/tenant/fsc-settings', { method: 'PUT', body: { mode: mode } })
        .then(function () { toastOk(mode === 'auto' ? 'Automatic fuel surcharge on' : 'Manual fuel surcharge on'); return load(); })
        .catch(toastErr);
    }

    function load() {
      return api('/api/tenant/fsc-settings').then(paint).catch(function (e) {
        body.innerHTML = '';
        body.appendChild(el('p', { class: 'muted', text: 'Could not load fuel surcharge settings.' }));
        throw e;
      });
    }

    load().catch(function () {});
    return card;
  }

  function renderRates(c) {
    api('/api/tenant/rate-cards').then(function (d) {
      c.innerHTML = '';
      c.appendChild(el('h1', { text: 'Rate cards' }));

      // Prominent path to the AI importer — the fastest way to load REAL rates
      // (typing them by hand is the slow fallback). Shown on the rates page
      // itself, not just the empty state, because new tenants ship with seeded
      // template cards and so never see the empty state.
      var aiCta = el('div', { class: 'qf-ai-import-cta', style: {
        display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap',
        margin: '0 0 16px', padding: '16px 18px', borderRadius: '14px',
        border: '1px solid color-mix(in srgb, var(--accent) 32%, var(--border))',
        background: 'color-mix(in srgb, var(--accent) 8%, var(--surface))'
      } });
      var aiTxt = el('div', { style: { flex: '1 1 260px', minWidth: '0' } });
      aiTxt.appendChild(el('div', { style: { fontSize: '14.5px', fontWeight: '800' }, text: 'Have a rate sheet? Let AI fill these in' }));
      aiTxt.appendChild(el('div', { class: 'muted-small', style: { marginTop: '4px', lineHeight: '1.5' }, text: 'Upload a PDF, Excel, screenshot or email — we read it and turn it into rate cards you can review in seconds. No manual typing.' }));
      aiCta.appendChild(aiTxt);
      aiCta.appendChild(el('a', { href: '/app/ingest', 'data-route': 'ingest', class: 'btn btn-primary', style: { flex: '0 0 auto', textDecoration: 'none', whiteSpace: 'nowrap' }, text: 'Import a rate sheet →' }));
      c.appendChild(aiCta);

      // Make the rate-cards -> calculator-modes link explicit (Alex): a carrier's
      // calculator only offers a trucking mode when they have >=1 ENABLED rate
      // card for it. Show which modes are live right now, and why.
      var liveModes = SERVICES.filter(function (s) {
        return (d.rateCards || []).some(function (r) { return r.service === s && r.enabled; });
      });
      var modesNote = el('div', { class: 'qf-modes-note', style: {
        margin: '6px 0 16px', padding: '12px 14px', border: '1px solid var(--border)',
        borderRadius: '12px', background: 'var(--surface)'
      } });
      modesNote.appendChild(el('div', {
        style: { fontSize: '13px', color: 'var(--ink-soft, var(--ink))', lineHeight: '1.5' },
        html: 'Your calculator offers a trucking mode <strong>only when you have at least one enabled rate card for it</strong>. Add or enable a card to offer a mode; disable a mode’s cards to hide it from customers.'
      }));
      var modesRow = el('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', marginTop: '10px' } });
      var MODE_LABELS = { ftl: 'FTL', ltl: 'LTL', expedited: 'Expedite', hotshot: 'Hotshot', drayage: 'Drayage' };
      if (liveModes.length) {
        modesRow.appendChild(el('span', { style: { fontSize: '12px', fontWeight: '700', color: 'var(--muted)' }, text: 'Live in your calculator now:' }));
        liveModes.forEach(function (s) {
          modesRow.appendChild(el('span', {
            style: { display: 'inline-flex', padding: '4px 10px', borderRadius: '999px', background: 'color-mix(in srgb, var(--accent) 12%, transparent)', color: 'var(--accent)', fontSize: '12px', fontWeight: '700' },
            text: MODE_LABELS[s] || (s.charAt(0).toUpperCase() + s.slice(1))
          }));
        });
      } else {
        modesRow.appendChild(el('span', { style: { fontSize: '12.5px', color: 'var(--muted)' }, text: 'No modes are live yet — add and enable a rate card below to start offering quotes.' }));
      }
      modesNote.appendChild(modesRow);
      c.appendChild(modesNote);

      // Page-sub prose folded into the rate-builder header help cue.
      // AI-tip demoted from an accent-on-accent .notice to a compact inline link.
      c.appendChild(el('p', { class: 'qf-rate-hint', html: 'Ask the AI agent to bulk-update rates — <a href="#" data-route="ai">open AI panel</a>' }));
      // Fuel surcharge is a power setting (it was the first thing a first-timer
      // saw). Fold it into a collapsed panel so the rate table leads.
      var fscDetails = el('details', { class: 'qf-fsc-advanced', style: { marginBottom: '16px' } });
      var fscSum = el('summary', { style: { cursor: 'pointer', fontWeight: '700', fontSize: '13px', color: 'var(--ink)', padding: '10px 12px', borderRadius: '10px', background: 'var(--surface)', border: '1px solid var(--border)', userSelect: 'none' } });
      fscSum.appendChild(el('span', { text: 'Fuel surcharge settings' }));
      fscSum.appendChild(el('span', { style: { color: 'var(--muted)', fontWeight: '500', fontSize: '12px', marginLeft: '6px' }, text: '— automatic weekly, or set your own %' }));
      fscDetails.appendChild(fscSum);
      var fscBody = buildFscCard(); fscBody.style.marginTop = '8px';
      fscDetails.appendChild(fscBody);
      c.appendChild(fscDetails);
      var hasDrayage = (d.rateCards || []).some(function (r) { return r.service === 'drayage'; });
      if (hasDrayage) {
        c.appendChild(el('p', {
          class: 'qf-rate-hint',
          html: 'Drayage also needs <strong>per-port flat tariffs</strong> (e.g. LAX → 50mi zone = $475) — <a href="#" data-route="zones">set drayage zones</a>.'
        }));
      }

      // ── Service tabs ─────────────────────────────────────────────
      var view = getRatesView();
      var activeTab = view.tab || 'all';
      var tabsBar = el('div', { class: 'qf-tabs' });
      function tab(id, labelText, count) {
        var b = el('button', { class: 'qf-tab' + (activeTab === id ? ' active' : ''), text: labelText + ' (' + count + ')' });
        b.addEventListener('click', function () {
          view.tab = id; setRatesView(view); renderRates(c);
        });
        return b;
      }
      tabsBar.appendChild(tab('all', 'All', d.rateCards.length));
      SERVICES.forEach(function (s) {
        var n = d.rateCards.filter(function (r) { return r.service === s; }).length;
        tabsBar.appendChild(tab(s, s.charAt(0).toUpperCase() + s.slice(1), n));
      });
      c.appendChild(tabsBar);

      // Filter rows by active service tab.
      var rows = activeTab === 'all'
        ? d.rateCards
        : d.rateCards.filter(function (r) { return r.service === activeTab; });

      var tbl = el('table', { class: 'table', style: { marginTop: '12px' } });
      var thead = el('thead');
      thead.innerHTML =
        '<tr><th data-col="service">Service</th><th data-col="equipment">Equipment</th><th data-col="label">Label</th>' +
        '<th data-col="ratePerMile" style="text-align:right;">$/mi</th><th data-col="minimumCharge" style="text-align:right;">Min</th>' +
        '<th data-col="flatFee" style="text-align:right;">Flat</th><th data-col="fuelSurchargePct" style="text-align:right;">Fuel %</th>' +
        '<th data-col="marginPct" style="text-align:right;">Margin %</th><th data-col="enabled">Enabled</th><th></th></tr>';
      tbl.appendChild(thead);

      var tb = el('tbody');
      tbl.appendChild(tb);
      rows.forEach(function (r) {
        tb.appendChild(rateRow(r));
      });
      // Row visibility is now driven only by the single text search
      // (qf-rate-search-hidden) and the status-chip filter (row.hidden); both
      // compose as AND. No inline style.display here so they never fight.
      if (d.rateCards.length) {
        // Wrap the wide rate grid in a scroll container so the TABLE scrolls
        // sideways, never the page (rate-builder.css .qf-rate-table-wrap keeps
        // overflow-x:auto + max-width:100% + min-width:0 at ALL widths). Wrapping
        // here — rather than relying on rate-builder.js's async enhancer — means
        // the container is present the instant the table renders, so a slow
        // enhancer can't leave the desktop table spilling past the page edge.
        var tblWrap = el('div', { class: 'qf-rate-table-wrap' });
        tblWrap.appendChild(tbl);
        c.appendChild(tblWrap);
      } else {
        // 0 rate cards used to render a bare header row (looked broken). Show a
        // friendly empty-state that ties into the modes explanation up top.
        var emptyRates = el('div', { class: 'card', style: { marginTop: '12px', padding: '28px 20px', textAlign: 'center' } });
        emptyRates.appendChild(el('div', { style: { fontSize: '15px', fontWeight: '800' }, text: 'No rate cards yet' }));
        emptyRates.appendChild(el('div', { class: 'muted-small', style: { margin: '6px auto 14px', maxWidth: '440px', lineHeight: '1.5' }, text: 'Fastest way: upload your rate sheet and let AI build these for you. Or add a lane by hand below — each service becomes a trucking mode customers can pick.' }));
        emptyRates.appendChild(el('a', { href: '/app/ingest', 'data-route': 'ingest', class: 'btn btn-primary', style: { textDecoration: 'none' }, text: 'Import a rate sheet with AI →' }));
        c.appendChild(emptyRates);
      }

      // ── Add row ──────────────────────────────────────────────────
      var addBtn = el('button', { class: 'btn btn-secondary', text: '+ Add rate card', style: { marginTop: '14px' } });
      addBtn.addEventListener('click', function () {
        // If a service tab is active, default the new row to that service.
        var svc = activeTab !== 'all' ? activeTab : 'ftl';
        api('/api/tenant/rate-cards', {
          method: 'POST',
          // Create DISABLED so it never collides with the existing enabled card
          // for (service, dryvan) — that duplicate-enabled guard 409'd and no row
          // appeared. The carrier picks equipment + enables it after.
          body: { service: svc, equipment: 'dryvan', label: 'New rate', ratePerMile: 2.5, enabled: false },
        }).then(function () { renderRates(c); }).catch(toastErr);
      });
      c.appendChild(addBtn);

      // ── LTL pricing (class + weight aware) ───────────────────────
      if (activeTab === 'all' || activeTab === 'ltl') {
        (d.rateCards || []).filter(function (r) { return r.service === 'ltl'; }).forEach(function (r) {
          c.appendChild(ltlPricingEditor(r));
        });
      }

      // Adding a drayage card should reveal the Drayage-zones nav item
      // without a reload (add re-renders this page, so this covers it).
      syncZonesNav(d.rateCards || []);

      // Copilot form-fill (Phase 2): register the visible rate-card inputs so
      // the AI can prefill a specific card's field ("set the FTL dry van
      // per-mile to 2.75"). Bulk / global changes still go through the rate
      // agent's Apply/Discard proposals (the copilot fill flow falls back to it).
      (function registerRatesForm() {
        var byId = {};
        (rows || []).forEach(function (r) { byId[String(r.id)] = r; });
        var FLABEL = { ratePerMile: '$/mi', minimumCharge: 'Minimum $', flatFee: 'Flat $', fuelSurchargePct: 'Fuel %', marginPct: 'Margin %', label: 'Label' };
        var specs = $$('input[data-field][data-rate-id]', tbl).map(function (inp) {
          var id = inp.dataset.rateId, field = inp.dataset.field;
          var card = byId[id] || {};
          var name = card.label || ((card.service || '') + ' ' + (card.equipment || '')).trim() || ('Rate #' + id);
          return { key: 'card_' + id + '_' + field, label: name + ' — ' + (FLABEL[field] || field), el: inp };
        });
        qfRegisterCopilotForm('rates', 'Rate cards', specs);
      })();
    }).catch(showErr(c));
  }

  // Standard class multipliers used as the default when a card has no saved
  // ltlConfig yet (mirrors src/calc/freightClass.ts DEFAULT_LTL_CONFIG).
  var LTL_DEFAULT_CONFIG = {
    baseRatePerCwt: 14,
    classRates: { '50': 0.55, '55': 0.6, '60': 0.65, '65': 0.7, '70': 0.75, '77.5': 0.8, '85': 0.85, '92.5': 0.92, '100': 1.0, '110': 1.1, '125': 1.25, '150': 1.5, '175': 1.75, '200': 2.0, '250': 2.35, '300': 2.7, '400': 3.1, '500': 3.5 },
    weightBreaks: [{ minLbs: 0, rateFactor: 1.0 }, { minLbs: 500, rateFactor: 0.85 }, { minLbs: 1000, rateFactor: 0.72 }, { minLbs: 2000, rateFactor: 0.6 }, { minLbs: 5000, rateFactor: 0.5 }, { minLbs: 10000, rateFactor: 0.42 }, { minLbs: 20000, rateFactor: 0.36 }],
    distanceFactorPer1000Mi: 0.8,
  };

  function ltlPricingEditor(r) {
    var cfg = r.ltlConfig || LTL_DEFAULT_CONFIG;
    var wrap = el('div', { class: 'card', style: { marginTop: '16px', padding: '16px' } });
    // Whole editor body collapses behind a disclosure (CLOSED by default) so
    // the rate table stays the focus; the summary carries the card title.
    var det = el('details', { class: 'qf-ltl-details' });
    var sum = el('summary');
    sum.appendChild(el('span', { text: 'LTL pricing — ' + (r.label || 'LTL'), style: { fontWeight: '700', fontSize: '15px' } }));
    det.appendChild(sum);
    var body = el('div', { class: 'qf-ltl-details-body' });
    body.appendChild(el('p', { class: 'page-sub', style: { margin: '8px 0 12px' }, text: 'LTL is rated by freight class (derived from weight ÷ size) and weight break — not distance alone. Set the base rate per hundredweight (100 lb) at class 100; class multipliers and weight breaks use standard defaults.' }));

    function saveCfg(patch) {
      var next = Object.assign({}, cfg, patch);
      cfg = next;
      api('/api/tenant/rate-cards/' + r.id, { method: 'PUT', body: { ltlConfig: next } }).catch(toastErr);
    }
    function numRow(label, hint, value, onSave, step) {
      var row = el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', margin: '8px 0' } });
      var inp = el('input', { class: 'input', value: value, style: { width: '110px', textAlign: 'right' } });
      inp.type = 'number'; inp.step = step || '0.01';
      inp.addEventListener('blur', function () { var v = inp.value === '' ? 0 : Number(inp.value); if (Number.isFinite(v)) onSave(v); });
      var labelWrap = el('div', {}, [el('div', { text: label, style: { fontWeight: '650', fontSize: '13px' } }), el('div', { text: hint, class: 'page-sub', style: { margin: '4px 0 0', fontSize: '12px' } })]);
      row.appendChild(inp); row.appendChild(labelWrap);
      return row;
    }
    body.appendChild(numRow('Base rate ($/cwt)', 'Dollars per 100 lb at freight class 100.', cfg.baseRatePerCwt, function (v) { saveCfg({ baseRatePerCwt: v }); }));
    body.appendChild(numRow('Distance factor', 'Linehaul multiplier = 1 + (miles ÷ 1000) × this.', cfg.distanceFactorPer1000Mi, function (v) { saveCfg({ distanceFactorPer1000Mi: v }); }, '0.05'));
    body.appendChild(el('div', { class: 'notice', style: { marginTop: '8px' }, html: 'Class multipliers (50–500) and weight breaks use standard NMFC-style defaults. <strong>Editing those individually is coming soon</strong> — ask the AI agent to adjust them for now.' }));
    det.appendChild(body);
    wrap.appendChild(det);
    return wrap;
  }

  function rateRow(r) {
    var tr = el('tr');
    // data-label drives the mobile card reflow (rate-builder.css ≤640px):
    // each cell's column header is shown as an inline label via ::before.
    function inputCell(field, val, opts) {
      var inp = el('input', { class: 'input', value: val == null ? '' : val });
      if (opts && opts.type) inp.type = opts.type;
      if (opts && opts.step) inp.step = opts.step;
      inp.style.width = (opts && opts.w) || '90px';
      if (opts && opts.right) inp.style.textAlign = 'right';
      // Disabled cell (e.g. LTL's $/mi — LTL is class/cwt-priced, so a per-mile
      // rate is meaningless and must not be editable). Show a muted placeholder
      // and skip the save handler entirely so nothing can be written for it.
      if (opts && opts.disabled) {
        inp.disabled = true;
        inp.value = '';
        inp.placeholder = opts.disabledPlaceholder || 'n/a';
        if (opts.disabledTitle) inp.title = opts.disabledTitle;
        inp.style.opacity = '0.5';
        inp.style.cursor = 'not-allowed';
      } else {
        // Copilot form-fill hooks (Phase 2): tag editable cells so renderRates
        // can register them and the AI can prefill a specific card's field.
        inp.dataset.field = field;
        inp.dataset.rateId = String(r.id);
        inp.addEventListener('blur', function () {
          var v = inp.value;
          // Empty or non-numeric → 0 (the columns are NOT NULL and the schema
          // rejects null): sending null 400'd and the field could never be
          // cleared. Matches the drayage-zone cell behaviour.
          if (opts && opts.type === 'number') { var n = Number(v); v = (v === '' || !isFinite(n)) ? 0 : n; }
          api('/api/tenant/rate-cards/' + r.id, { method: 'PUT', body: (function () { var p = {}; p[field] = v; return p; })() }).catch(toastErr);
        });
      }
      var td = el('td'); td.appendChild(inp);
      if (opts && opts.label) td.dataset.label = opts.label;
      return td;
    }
    function selectCell(field, val, options, label) {
      var sel = el('select', { class: 'select' });
      sel.style.width = '120px';
      options.forEach(function (o) { var op = document.createElement('option'); op.value = o; op.textContent = o; if (val === o) op.selected = true; sel.appendChild(op); });
      sel.addEventListener('change', function () {
        var p = {}; p[field] = sel.value;
        api('/api/tenant/rate-cards/' + r.id, { method: 'PUT', body: p })
          .then(function () { if (field === 'service') syncZonesNav(); })
          .catch(toastErr);
      });
      var td = el('td'); td.appendChild(sel);
      if (label) td.dataset.label = label;
      return td;
    }
    tr.appendChild(selectCell('service', r.service, ['drayage', 'ftl', 'ltl', 'expedited', 'hotshot'], 'Service'));
    tr.appendChild(selectCell('equipment', r.equipment, [
      'dryvan', 'reefer', 'flatbed', 'step_deck', 'conestoga',
      'container_20', 'container_40', 'container_40hc', 'container_45',
      'sprinter', 'box_truck', 'tractor_only', 'pallet'], 'Equipment'));
    tr.appendChild(inputCell('label', r.label, { w: '160px', label: 'Label' }));
    tr.appendChild(inputCell('ratePerMile', r.ratePerMile, { type: 'number', step: '0.01', right: true, w: '80px', label: '$/mi', disabled: r.service === 'ltl', disabledPlaceholder: 'class', disabledTitle: 'LTL is priced by freight class and weight (set it in “LTL pricing” below), not $/mile.' }));
    tr.appendChild(inputCell('minimumCharge', r.minimumCharge, { type: 'number', step: '1', right: true, w: '80px', label: 'Min' }));
    tr.appendChild(inputCell('flatFee', r.flatFee, { type: 'number', step: '1', right: true, w: '80px', label: 'Flat' }));
    tr.appendChild(inputCell('fuelSurchargePct', r.fuelSurchargePct, { type: 'number', step: '0.5', right: true, w: '70px', label: 'Fuel %' }));
    tr.appendChild(inputCell('marginPct', r.marginPct, { type: 'number', step: '0.5', right: true, w: '70px', label: 'Margin %' }));
    var chk = el('input', { type: 'checkbox' });
    chk.checked = r.enabled;
    chk.addEventListener('change', function () { api('/api/tenant/rate-cards/' + r.id, { method: 'PUT', body: { enabled: chk.checked } }).catch(toastErr); });
    tr.appendChild(el('td', { 'data-label': 'Enabled' }, [chk]));
    var del = el('button', { class: 'btn btn-danger btn-sm', text: 'Delete' });
    del.addEventListener('click', function () {
      if (!confirm('Delete rate card "' + (r.label || r.equipment) + '"?')) return;
      api('/api/tenant/rate-cards/' + r.id, { method: 'DELETE' }).then(function () { tr.remove(); syncZonesNav(); }).catch(toastErr);
    });
    tr.appendChild(el('td', null, [del]));
    return tr;
  }

  // ── Add-ons (accessorials) ────────────────────────────────────
  // Stupid-simple editor. All the technical jargon (raw `code`, the internal
  // `kind`/`trigger` enums, SCAC-ish fields) is hidden behind plain-English
  // labels. The data model + quote logic are untouched: we still store the
  // real enum values and auto-derive a `code` from the name on create.
  var ADDON_KINDS = [
    { value: 'flat', label: 'Flat fee ($)', unit: '$' },
    { value: 'per_hour', label: 'Per hour', unit: '$/hr' },
    { value: 'per_day', label: 'Per day', unit: '$/day' },
    { value: 'per_mile', label: 'Per mile', unit: '$/mi' },
    { value: 'pct_of_base', label: '% of base rate', unit: '%' },
  ];
  var ADDON_TRIGGERS = [
    { value: 'optional', label: 'Customer can add it' },
    { value: 'auto', label: 'Always applied' },
    { value: 'auto_if_hazmat', label: 'Auto for hazmat' },
    { value: 'auto_if_weight_over', label: 'Auto over a weight' },
    { value: 'auto_if_residential', label: 'Auto for residential' },
    { value: 'auto_if_temp_controlled', label: 'Auto for temp-controlled' },
  ];
  function addonUnit(kind) {
    for (var i = 0; i < ADDON_KINDS.length; i++) if (ADDON_KINDS[i].value === kind) return ADDON_KINDS[i].unit;
    return '$';
  }
  function slugifyCode(name) {
    return String(name || '').toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'addon';
  }
  function uniqueCode(base, taken) {
    var code = base, n = 2;
    while (taken.indexOf(code) >= 0) { code = base + '_' + n; n++; }
    return code;
  }
  function friendlySelect(options, current, onChange) {
    var sel = el('select', { class: 'select qf-addon-select' });
    options.forEach(function (o) {
      var op = document.createElement('option');
      op.value = o.value; op.textContent = o.label;
      if (current === o.value) op.selected = true;
      sel.appendChild(op);
    });
    sel.addEventListener('change', function () { onChange(sel.value); });
    return sel;
  }

  function renderAccessorials(c) {
    api('/api/tenant/accessorials').then(function (d) {
      var list = d.accessorials || [];
      c.innerHTML = '';
      var root = el('div', { class: 'qf-addons', 'data-qf-addons': '1' });
      c.appendChild(root);
      root.appendChild(el('h1', { text: 'Add-ons' }));
      root.appendChild(el('p', { class: 'page-sub', text: 'Extra charges customers can add to a shipment — or that apply automatically. Set a price and choose when each one applies.' }));

      // ── Add-an-add-on: prominent button that reveals a simple form ──
      var addBar = el('div', { class: 'qf-addons-addbar' });
      var addBtn = el('button', { class: 'qf-addons-add-btn', type: 'button', text: '+ Add an add-on' });
      addBar.appendChild(addBtn);
      root.appendChild(addBar);

      var form = el('div', { class: 'qf-addons-form', hidden: 'hidden' });
      var fName = el('input', { class: 'input', type: 'text', placeholder: 'e.g. Liftgate service' });
      var fPrice = el('input', { class: 'input', type: 'number', step: '0.5', min: '0', placeholder: '0' });
      var fKind = friendlySelect(ADDON_KINDS, 'flat', function () { fUnit.textContent = addonUnit(fKind.value); });
      var fTrigger = friendlySelect(ADDON_TRIGGERS, 'optional', function () {});
      var fUnit = el('span', { class: 'qf-addon-unit', text: '$' });
      form.appendChild(fieldWrap('Name', fName));
      var priceWrap = el('div', { class: 'qf-addon-pricewrap' }, [fUnit, fPrice]);
      form.appendChild(fieldWrap('Price', priceWrap));
      form.appendChild(fieldWrap("How it's charged", fKind));
      form.appendChild(fieldWrap('When it applies', fTrigger));
      var formActions = el('div', { class: 'qf-addons-form-actions' });
      var saveBtn = el('button', { class: 'btn btn-primary btn-sm', type: 'button', text: 'Add' });
      var cancelBtn = el('button', { class: 'btn btn-secondary btn-sm', type: 'button', text: 'Cancel' });
      formActions.appendChild(saveBtn); formActions.appendChild(cancelBtn);
      form.appendChild(formActions);
      root.appendChild(form);

      function closeForm() { form.hidden = true; fName.value = ''; fPrice.value = ''; }
      addBtn.addEventListener('click', function () {
        form.hidden = !form.hidden;
        if (!form.hidden) fName.focus();
      });

      // Copilot form-fill (Phase 2): register the "add an add-on" form so the
      // AI can prefill it ("add a $50 hazmat surcharge"). onApply reveals the
      // (initially hidden) form; Confirm clicks Add to persist.
      (function registerAccessorialForm() {
        function revealAddon(elm) {
          form.hidden = false;
          try { elm.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { if (elm.scrollIntoView) elm.scrollIntoView(); }
        }
        var specs = [
          { key: 'name', label: 'Name', el: fName, required: true, reveal: revealAddon },
          { key: 'price', label: 'Price (number, no symbol)', el: fPrice, reveal: revealAddon },
          { key: 'kind', label: "How it's charged", el: fKind, options: ADDON_KINDS.map(function (o) { return { value: o.value, label: o.label }; }), reveal: revealAddon },
          { key: 'trigger', label: 'When it applies', el: fTrigger, options: ADDON_TRIGGERS.map(function (o) { return { value: o.value, label: o.label }; }), reveal: revealAddon },
        ];
        qfRegisterCopilotForm('accessorials', 'Add an add-on (accessorial)', specs, function onConfirm() {
          // Persist via the form's own "Add" action (tenant-scoped + validated).
          saveBtn.click();
        });
      })();
      cancelBtn.addEventListener('click', closeForm);
      saveBtn.addEventListener('click', function () {
        var name = fName.value.trim();
        if (!name) { fName.focus(); return; }
        var taken = list.map(function (x) { return x.code; });
        var body = {
          code: uniqueCode(slugifyCode(name), taken),
          label: name,
          kind: fKind.value,
          amount: fPrice.value === '' ? 0 : Number(fPrice.value),
          trigger: fTrigger.value,
        };
        api('/api/tenant/accessorials', { method: 'POST', body: body })
          .then(function () { toastOk('Add-on added'); renderAccessorials(c); })
          .catch(toastErr);
      });

      // ── List of the tenant's add-ons ────────────────────────────
      var listWrap = el('div', { class: 'qf-addons-list' });
      if (!list.length) {
        listWrap.appendChild(el('div', { class: 'qf-addons-empty', text: 'No add-ons yet. Use “+ Add an add-on” to create your first one.' }));
      } else {
        list.forEach(function (a) { listWrap.appendChild(addonCard(a, c)); });
      }
      root.appendChild(listWrap);
    }).catch(showErr(c));
  }

  function fieldWrap(label, control) {
    var f = el('div', { class: 'qf-addon-field' });
    f.appendChild(el('label', { class: 'qf-addon-flabel', text: label }));
    f.appendChild(control);
    return f;
  }

  function addonCard(a, c) {
    var card = el('div', { class: 'qf-addon-card' });
    function save(patch) { return api('/api/tenant/accessorials/' + a.id, { method: 'PUT', body: patch }).catch(toastErr); }

    // Top row: name · price · on/off · delete
    var top = el('div', { class: 'qf-addon-top' });
    var name = el('input', { class: 'input qf-addon-name', type: 'text', value: a.label || '' });
    name.addEventListener('blur', function () { if (name.value.trim() !== (a.label || '')) { a.label = name.value.trim(); save({ label: a.label }); } });

    var unit = el('span', { class: 'qf-addon-unit', text: addonUnit(a.kind) });
    var price = el('input', { class: 'input qf-addon-price', type: 'number', step: '0.5', min: '0', value: a.amount == null ? '' : a.amount });
    price.addEventListener('blur', function () {
      var v = price.value === '' ? 0 : Number(price.value);
      if (v !== a.amount) { a.amount = v; save({ amount: v }); }
    });
    var priceBox = el('div', { class: 'qf-addon-pricebox' }, [unit, price]);

    var toggle = el('label', { class: 'qf-addon-toggle', title: 'Show this add-on in quotes' });
    var chk = el('input', { type: 'checkbox' });
    chk.checked = !!a.enabled;
    var toggleTxt = el('span', { text: chk.checked ? 'On' : 'Off' });
    chk.addEventListener('change', function () { toggleTxt.textContent = chk.checked ? 'On' : 'Off'; save({ enabled: chk.checked }); });
    toggle.appendChild(chk); toggle.appendChild(toggleTxt);

    var del = el('button', { class: 'qf-addon-del', type: 'button', title: 'Delete add-on', 'aria-label': 'Delete add-on', text: '✕' });
    del.addEventListener('click', function () {
      if (!confirm('Delete “' + (a.label || 'this add-on') + '”?')) return;
      api('/api/tenant/accessorials/' + a.id, { method: 'DELETE' })
        .then(function () { card.remove(); toastOk('Add-on removed'); })
        .catch(toastErr);
    });

    top.appendChild(name);
    top.appendChild(priceBox);
    top.appendChild(toggle);
    top.appendChild(del);
    card.appendChild(top);

    // Bottom row: how charged · when applies · (weight threshold)
    var bottom = el('div', { class: 'qf-addon-bottom' });
    var kindSel = friendlySelect(ADDON_KINDS, a.kind, function (v) {
      a.kind = v; unit.textContent = addonUnit(v); save({ kind: v });
    });
    var weightWrap = el('div', { class: 'qf-addon-weight', hidden: 'hidden' });
    var weightInp = el('input', { class: 'input', type: 'number', min: '0', step: '500', placeholder: 'e.g. 42000' });
    var initialWeight = a.conditionJson && typeof a.conditionJson.weightLbsOver === 'number' ? a.conditionJson.weightLbsOver : '';
    weightInp.value = initialWeight;
    weightWrap.appendChild(el('span', { class: 'qf-addon-weight-lbl', text: 'Apply when weight is over' }));
    weightWrap.appendChild(weightInp);
    weightWrap.appendChild(el('span', { class: 'qf-addon-weight-unit', text: 'lbs' }));
    weightInp.addEventListener('blur', function () {
      var v = weightInp.value === '' ? null : Number(weightInp.value);
      var cond = v == null ? null : { weightLbsOver: v };
      a.conditionJson = cond; save({ conditionJson: cond });
    });
    function syncWeight(trig) { weightWrap.hidden = trig !== 'auto_if_weight_over'; }
    var trigSel = friendlySelect(ADDON_TRIGGERS, a.trigger, function (v) {
      a.trigger = v; syncWeight(v); save({ trigger: v });
    });
    syncWeight(a.trigger);

    bottom.appendChild(fieldWrap("How it's charged", kindSel));
    bottom.appendChild(fieldWrap('When it applies', trigSel));
    bottom.appendChild(weightWrap);
    card.appendChild(bottom);

    return card;
  }

  // ── Lane zones ────────────────────────────────────────────────
  function renderZones(c) {
    api('/api/tenant/lane-zones').then(function (d) {
      c.innerHTML = '';
      c.appendChild(el('h1', { text: 'Drayage zones' }));
      c.appendChild(el('p', { class: 'page-sub', text: 'Flat prices for pulling containers within a radius of a port. Only needed if you quote drayage / port-rail work — you can skip this otherwise.' }));
      if (d.laneZones.length) {
        // qf-leads-table gives the ≤480px stacked-card reflow; the zone rows
        // already carry data-label on each cell, so on a phone the price, the
        // enabled toggle and delete stop hiding behind the shared .table
        // sideways scroll (they were off-screen at 375px).
        var tbl = el('table', { class: 'table qf-leads-table qf-zones-table' });
        tbl.innerHTML = '<thead><tr><th>Label</th><th>Port</th><th>Radius (mi)</th><th>Flat $</th><th>Enabled</th><th></th></tr></thead><tbody></tbody>';
        var tb = $('tbody', tbl);
        d.laneZones.forEach(function (z) { tb.appendChild(zoneRow(z)); });
        c.appendChild(tbl);

        // Copilot form-fill (Phase 2): register the visible zone inputs so the
        // AI can prefill a specific zone's price/radius ("set the LAX 50-mile
        // zone to $525").
        (function registerZonesForm() {
          var byId = {};
          d.laneZones.forEach(function (z) { byId[String(z.id)] = z; });
          var FLABEL = { label: 'Label', anchorPortCode: 'Anchor port', radiusMiles: 'Radius (mi)', flatPrice: 'Flat $' };
          var specs = $$('input[data-field][data-zone-id]', tbl).map(function (inp) {
            var id = inp.dataset.zoneId, field = inp.dataset.field;
            var z = byId[id] || {};
            var name = z.label || (z.anchorPortCode ? z.anchorPortCode + ' zone' : 'Zone #' + id);
            return { key: 'zone_' + id + '_' + field, label: name + ' — ' + (FLABEL[field] || field), el: inp };
          });
          qfRegisterCopilotForm('zones', 'Drayage zones', specs);
        })();
      } else {
        var emptyZ = el('div', { class: 'card', style: { padding: '24px 20px', textAlign: 'center' } });
        emptyZ.appendChild(el('div', { style: { fontSize: '15px', fontWeight: '800' }, text: 'No zones yet' }));
        emptyZ.appendChild(el('div', { class: 'muted-small', style: { margin: '6px auto 0', maxWidth: '460px', lineHeight: '1.5' }, text: 'Zones set flat drayage prices by distance from a port (e.g. Houston port → 50 mi = $475). You only need them if you quote port / rail container moves — otherwise you can skip this page.' }));
        c.appendChild(emptyZ);
      }
      // Inline add-zone form. Replaces 4 stacked window.prompt() dialogs
      // (which violated the title-in-field + top-left help-cue UI rule and
      // had no dark-mode contrast). Hidden until the user clicks + Add zone.
      var addBtn = el('button', { class: 'btn btn-secondary', text: '+ Add zone', style: { marginTop: '14px' } });

      var form = el('div', {
        class: 'add-zone-form',
        style: {
          display: 'none',
          marginTop: '14px',
          padding: '14px',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          background: 'var(--surface-2, var(--surface))',
        },
      });
      var grid = el('div', { class: 'grid-2', style: { gap: '14px' } });

      function newField(labelText, hintText, inputOpts) {
        var f = el('div', { class: 'field', style: { gap: '2px' } });
        var labelRow = el('div', {
          style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px' },
        });
        labelRow.appendChild(el('label', { class: 'field-label', text: labelText }));
        if (hintText) {
          labelRow.appendChild(el('span', {
            class: 'field-hint',
            text: hintText,
            style: { fontSize: '11px' },
          }));
        }
        f.appendChild(labelRow);
        var i = el('input', { class: 'input' });
        if (inputOpts && inputOpts.type) i.type = inputOpts.type;
        if (inputOpts && inputOpts.step) i.step = inputOpts.step;
        if (inputOpts && inputOpts.placeholder) i.placeholder = inputOpts.placeholder;
        if (inputOpts && inputOpts.value != null) i.value = inputOpts.value;
        f.appendChild(i);
        return { field: f, input: i };
      }

      var labelF = newField('Zone label', '⌘/Ctrl+Enter to save', { placeholder: 'Houston → 50mi' });
      var portF = newField('Nearest port', 'Optional', { placeholder: 'e.g. Houston, TX or USHOU' });
      var radiusF = newField('Radius (miles)', null, { type: 'number', step: '1', value: '50' });
      var priceF = newField('Flat price (USD)', null, { type: 'number', step: '1', value: '500' });
      grid.appendChild(labelF.field);
      grid.appendChild(portF.field);
      grid.appendChild(radiusF.field);
      grid.appendChild(priceF.field);
      form.appendChild(grid);

      var actions = el('div', {
        style: { display: 'flex', gap: '8px', marginTop: '12px', justifyContent: 'flex-end' },
      });
      var cancelBtn = el('button', { class: 'btn btn-secondary', text: 'Cancel' });
      var saveBtn = el('button', { class: 'btn btn-primary', text: 'Save zone' });
      actions.appendChild(cancelBtn);
      actions.appendChild(saveBtn);
      form.appendChild(actions);

      function resetForm() {
        labelF.input.value = '';
        portF.input.value = '';
        radiusF.input.value = '50';
        priceF.input.value = '500';
      }
      function closeForm() {
        form.style.display = 'none';
        addBtn.style.display = '';
      }
      function submitForm() {
        var label = labelF.input.value.trim();
        if (!label) { labelF.input.focus(); return; }
        var port = portF.input.value.trim() || null;
        var radius = Number(radiusF.input.value || 0);
        var price = Number(priceF.input.value || 0);
        api('/api/tenant/lane-zones', {
          method: 'POST',
          body: { label: label, anchorPortCode: port, radiusMiles: radius, flatPrice: price },
        }).then(function () {
          resetForm();
          closeForm();
          renderZones(c);
        }).catch(toastErr);
      }
      saveBtn.addEventListener('click', submitForm);
      cancelBtn.addEventListener('click', function () { resetForm(); closeForm(); });
      [labelF.input, portF.input, radiusF.input, priceF.input].forEach(function (inp) {
        inp.addEventListener('keydown', function (ev) {
          if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') {
            ev.preventDefault();
            submitForm();
          } else if (ev.key === 'Escape') {
            ev.preventDefault();
            closeForm();
          }
        });
      });

      addBtn.addEventListener('click', function () {
        form.style.display = '';
        addBtn.style.display = 'none';
        labelF.input.focus();
      });
      c.appendChild(addBtn);
      c.appendChild(form);
    }).catch(showErr(c));
  }
  function zoneRow(z) {
    var tr = el('tr');
    // data-label drives the mobile card reflow (setup-builder.css ≤640px).
    function inp(field, val, opts) {
      var i = el('input', { class: 'input', value: val == null ? '' : val });
      if (opts && opts.type) i.type = opts.type; if (opts && opts.right) i.style.textAlign = 'right';
      i.style.width = (opts && opts.w) || '120px';
      // Copilot form-fill hooks (Phase 2): tag zone cells for registration.
      i.dataset.field = field;
      i.dataset.zoneId = String(z.id);
      i.addEventListener('blur', function () { var v = i.value; if (opts && opts.type === 'number') v = Number(v); var p = {}; p[field] = v; api('/api/tenant/lane-zones/' + z.id, { method: 'PUT', body: p }).catch(toastErr); });
      var td = el('td'); td.appendChild(i);
      if (opts && opts.label) td.dataset.label = opts.label;
      return td;
    }
    tr.appendChild(inp('label', z.label, { w: '300px', label: 'Label' }));
    tr.appendChild(inp('anchorPortCode', z.anchorPortCode, { w: '90px', label: 'Anchor' }));
    tr.appendChild(inp('radiusMiles', z.radiusMiles, { type: 'number', right: true, w: '80px', label: 'Radius (mi)' }));
    tr.appendChild(inp('flatPrice', z.flatPrice, { type: 'number', right: true, w: '90px', label: 'Flat $' }));
    var chk = el('input', { type: 'checkbox' }); chk.checked = z.enabled;
    chk.addEventListener('change', function () { api('/api/tenant/lane-zones/' + z.id, { method: 'PUT', body: { enabled: chk.checked } }).catch(toastErr); });
    tr.appendChild(el('td', { 'data-label': 'Enabled' }, [chk]));
    var del = el('button', { class: 'btn btn-danger btn-sm', text: 'Delete' });
    del.addEventListener('click', function () { if (!confirm('Delete zone?')) return; api('/api/tenant/lane-zones/' + z.id, { method: 'DELETE' }).then(function () { tr.remove(); }).catch(toastErr); });
    tr.appendChild(el('td', null, [del]));
    return tr;
  }

  // ── AI rate-change proposal card (confirm-before-apply, audit H1) ──
  // A mutation the AI drafted. Nothing is live until the owner clicks Apply,
  // which re-validates server-side. `status` is 'pending' | 'applied' |
  // 'discarded' | 'invalid'. Pending renders Discard + Apply; a settled
  // proposal renders a read-only status pill instead.
  // ── Copilot form-fill registration (Phase 2) ──────────────────────────
  // Thin wrapper over the global registry (copilot-form.js). A render fn calls
  // this once its inputs exist; render() clears the registry on every route
  // swap, so no explicit unregister is needed. `specs` = [{key,label,el,...}].
  function qfRegisterCopilotForm(id, formLabel, specs, onConfirm) {
    if (!window.__qfCopilotForm || !window.__qfCopilotFormFactory) return null;
    var clean = (specs || []).filter(function (s) { return s && s.key && s.el; });
    if (!clean.length) return null;
    var reg = window.__qfCopilotFormFactory(formLabel, clean);
    if (typeof onConfirm === 'function') reg.onConfirm = onConfirm;
    window.__qfCopilotForm.register(id, reg);
    return reg;
  }

  function renderRateProposal(p, status) {
    status = status || 'pending';
    var card = el('div', { class: 'qf-rate-proposal', 'data-proposal-id': String(p.id) });

    var head = el('div', { class: 'qf-rp-head' });
    head.appendChild(el('span', { class: 'qf-rp-badge', text: p.op === 'create' ? 'New' : 'Proposed change' }));
    head.appendChild(el('span', { class: 'qf-rp-title', text: p.title || 'Rate change' }));
    card.appendChild(head);

    var list = el('div', { class: 'qf-rp-changes' });
    (p.changes || []).forEach(function (ch) {
      var row = el('div', { class: 'qf-rp-change' });
      row.appendChild(el('span', { class: 'qf-rp-field', text: ch.label }));
      var vals = el('span', { class: 'qf-rp-values' });
      if (ch.from !== null && ch.from !== undefined) {
        vals.appendChild(el('span', { class: 'qf-rp-from', text: ch.from }));
        vals.appendChild(el('span', { class: 'qf-rp-arrow', text: '→', 'aria-label': 'changes to' }));
      }
      vals.appendChild(el('span', { class: 'qf-rp-to', text: ch.to }));
      row.appendChild(vals);
      list.appendChild(row);
    });
    if (!(p.changes || []).length) {
      list.appendChild(el('div', { class: 'qf-rp-change' }, [el('span', { class: 'qf-rp-field', text: p.summary || 'No effective change' })]));
    }
    card.appendChild(list);

    if (p.reason) card.appendChild(el('div', { class: 'qf-rp-reason', text: p.reason }));

    var foot = el('div', { class: 'qf-rp-foot' });
    if (status === 'pending') {
      var discardBtn = el('button', { class: 'btn btn-secondary btn-sm qf-rp-discard', text: 'Discard' });
      var applyBtn = el('button', { class: 'btn btn-primary btn-sm qf-rp-apply', text: 'Apply change' });
      function settle(state, label) {
        card.dataset.status = state;
        foot.innerHTML = '';
        foot.appendChild(el('span', { class: 'qf-rp-status qf-rp-status-' + state, text: label }));
      }
      applyBtn.addEventListener('click', function () {
        applyBtn.disabled = true; discardBtn.disabled = true;
        api('/api/ai/rate-proposals/' + p.id + '/apply', { method: 'POST' })
          .then(function () { settle('applied', 'Applied — now live'); toastOk('Change applied'); qfAfterProposalApplied(); })
          .catch(function (err) { applyBtn.disabled = false; discardBtn.disabled = false; toastErr(err); });
      });
      discardBtn.addEventListener('click', function () {
        applyBtn.disabled = true; discardBtn.disabled = true;
        api('/api/ai/rate-proposals/' + p.id + '/discard', { method: 'POST' })
          .then(function () { settle('discarded', 'Discarded'); })
          .catch(function (err) { applyBtn.disabled = false; discardBtn.disabled = false; toastErr(err); });
      });
      foot.appendChild(discardBtn);
      foot.appendChild(applyBtn);
    } else {
      var labels = { applied: 'Applied — now live', discarded: 'Discarded', invalid: 'Rejected — out of range' };
      card.dataset.status = status;
      foot.appendChild(el('span', { class: 'qf-rp-status qf-rp-status-' + status, text: labels[status] || status }));
    }
    card.appendChild(foot);
    return card;
  }

  // After a proposal is applied server-side, refresh the ACTIVE data view so
  // the change is visible immediately. The copilot launcher/panel live in
  // #app-shell (outside #page-content), so re-rendering the route never
  // disturbs an open bubble. Skip the AI-agent page itself — its proposal card
  // already settles to "Applied — now live" in place.
  function qfAfterProposalApplied() {
    var base = state.route ? RouteUtil.baseSegment(state.route) : '';
    if (['rates', 'accessorials', 'zones', 'brand', 'overview'].indexOf(base) !== -1) {
      try { render(state.route); } catch (e) { /* non-fatal — a stale view is better than a throw */ }
    }
  }

  // Shared owner-AI rate-chat surface. Backs BOTH the AI-agent page (renderAi)
  // and the floating copilot bubble so they share one conversation, one history
  // endpoint (GET/POST /api/ai/rate-chat), and one code path for proposals /
  // tool bubbles. opts: { msgListId?, greeting? }.
  function buildRateChat(opts) {
    opts = opts || {};
    var chat = el('div', { class: 'chat-panel' });
    var msgAttrs = { class: 'chat-messages' };
    if (opts.msgListId) msgAttrs.id = opts.msgListId;
    var msgList = el('div', msgAttrs);
    chat.appendChild(msgList);
    var input = el('textarea', { class: 'textarea', rows: '2', placeholder: 'e.g. "raise dryvan rate to $2.65/mi and disable LTL"' });
    var sendBtn = el('button', { class: 'btn btn-primary', text: 'Send' });
    sendBtn.addEventListener('click', sendChat);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendChat(); });
    chat.appendChild(el('div', { class: 'chat-input-row' }, [input, sendBtn]));

    function renderHistory(hist) {
      msgList.innerHTML = '';
      (hist || []).forEach(function (m) {
        var meta = m.metadataJson || null;
        if (meta && meta.kind === 'rate_proposal') {
          msgList.appendChild(renderRateProposal({
            id: m.id, title: meta.title, changes: meta.changes, reason: meta.reason,
            op: meta.op, summary: meta.summary,
          }, meta.status || 'pending'));
          return;
        }
        if (m.role === 'tool') return; // non-proposal tool rows aren't shown
        msgList.appendChild(el('div', { class: 'chat-bubble ' + (m.role === 'assistant' ? 'assistant' : 'user'), text: m.content }));
      });
      if (!(hist || []).length) {
        msgList.appendChild(el('div', { class: 'chat-bubble assistant', text: opts.greeting || 'Hi — I can update your rate cards, accessorials, and lane zones. Tell me what to change.' }));
      }
      msgList.scrollTop = msgList.scrollHeight;
    }

    function load() {
      return api('/api/ai/rate-chat').then(function (r) { renderHistory(r.messages); });
    }

    // Phase-1 path: rate agent → Apply/Discard proposal cards (bulk / global
    // rate changes). Reused directly (no active form) and as the fallback when
    // a form-fill request turns out not to map to the visible form.
    function runRateChat(msg, pending) {
      api('/api/ai/rate-chat', { method: 'POST', body: { message: msg } })
        .then(function (r) {
          sendBtn.disabled = false;
          pending.textContent = r.reply || '(no reply)';
          // Mutation tools return proposals — render each as an Apply/Discard card.
          if (r.proposals && r.proposals.length) {
            r.proposals.forEach(function (p) { msgList.appendChild(renderRateProposal(p, 'pending')); });
          }
          // Only READ tools surface as tool bubbles (proposals are cards).
          if (r.toolResults && r.toolResults.length) {
            r.toolResults.forEach(function (t) {
              if (t.result && t.result.proposal) return; // rendered as a card above
              msgList.appendChild(el('div', { class: 'chat-bubble tool' }, [
                el('span', { class: 'qf-tool-ico', html: WRENCH_SVG, 'aria-hidden': 'true' }),
                ' ' + t.tool + ': ' + t.result.message,
              ]));
            });
          }
          msgList.scrollTop = msgList.scrollHeight;
        })
        .catch(function (err) { sendBtn.disabled = false; pending.textContent = 'Error: ' + err.message; });
    }

    // Phase-2 path: when a route registered an editable form, ask the fill
    // endpoint for concrete values, prefill the REAL inputs (highlighted,
    // pending), and show an inline Confirm / Undo card. `defer` (no fills) →
    // fall back to the rate agent so proposals still work from any page.
    function runFormFill(msg, pending, active) {
      api('/api/ai/form-fill', {
        method: 'POST',
        body: { formLabel: active.formLabel, fields: active.fields, currentValues: active.getValues(), message: msg },
      })
        .then(function (r) {
          if (r && r.fills && r.fills.length) {
            sendBtn.disabled = false;
            pending.textContent = r.reply || 'Here are the values — review the highlighted fields, then Confirm or Undo.';
            renderFillReview(active, r.fills);
            msgList.scrollTop = msgList.scrollHeight;
          } else {
            runRateChat(msg, pending); // not a field-fill → proposal path
          }
        })
        .catch(function () { runRateChat(msg, pending); });
    }

    // The inline Confirm / Undo affordance. The fields are ALREADY prefilled +
    // highlighted on the page when this renders; Confirm persists via the form's
    // own save, Undo restores the prior values. No silent auto-commit.
    function renderFillReview(reg, fills) {
      var prior = reg.getValues();
      var appliedKeys = fills.map(function (f) { return f.field_key; });
      var labelByKey = {};
      (reg.fields || []).forEach(function (f) { labelByKey[f.key] = f.label; });

      reg.onApply(fills); // write into the real inputs + highlight + scroll into view

      var card = el('div', { class: 'qf-fill-review', role: 'group', 'aria-label': 'Prefilled fields — review, then confirm or undo' });
      card.appendChild(el('div', { class: 'qf-fr-head' }, [
        el('span', { class: 'qf-fr-badge', text: 'Prefilled' }),
        el('span', { class: 'qf-fr-title', text: (reg.formLabel || 'This form') + ' — review the highlighted fields' }),
      ]));
      var listWrap = el('div', { class: 'qf-fr-changes' });
      fills.forEach(function (f) {
        var row = el('div', { class: 'qf-fr-change' });
        row.appendChild(el('span', { class: 'qf-fr-field', text: labelByKey[f.field_key] || f.field_key }));
        var vals = el('span', { class: 'qf-fr-values' });
        var pv = prior[f.field_key];
        if (pv !== undefined && pv !== null && String(pv) !== '') {
          vals.appendChild(el('span', { class: 'qf-fr-from', text: String(pv) }));
          vals.appendChild(el('span', { class: 'qf-fr-arrow', text: '→', 'aria-label': 'changes to' }));
        }
        vals.appendChild(el('span', { class: 'qf-fr-to', text: f.value }));
        row.appendChild(vals);
        listWrap.appendChild(row);
      });
      card.appendChild(listWrap);

      var foot = el('div', { class: 'qf-fr-foot' });
      var undoBtn = el('button', { class: 'btn btn-secondary btn-sm qf-fr-undo', type: 'button', text: 'Undo' });
      var confirmBtn = el('button', { class: 'btn btn-primary btn-sm qf-fr-confirm', type: 'button', text: 'Confirm' });
      function settle(stateName, label) {
        card.dataset.status = stateName;
        foot.innerHTML = '';
        foot.appendChild(el('span', { class: 'qf-fr-status qf-fr-status-' + stateName, text: label }));
      }
      confirmBtn.addEventListener('click', function () {
        confirmBtn.disabled = true; undoBtn.disabled = true;
        try { if (typeof reg.onConfirm === 'function') reg.onConfirm(appliedKeys); } catch (e) {}
        try { reg.clearPending(); } catch (e) {}
        settle('confirmed', 'Confirmed — saved');
        toastOk('Applied to your form');
      });
      undoBtn.addEventListener('click', function () {
        confirmBtn.disabled = true; undoBtn.disabled = true;
        var undoFills = appliedKeys.map(function (k) { return { field_key: k, value: prior[k] == null ? '' : String(prior[k]) }; });
        try { reg.onApply(undoFills, { pending: false }); } catch (e) {}
        try { reg.clearPending(); } catch (e) {}
        settle('undone', 'Undone — restored');
      });
      foot.appendChild(undoBtn);
      foot.appendChild(confirmBtn);
      card.appendChild(foot);
      msgList.appendChild(card);
      return card;
    }

    function sendChat() {
      var msg = input.value.trim(); if (!msg) return;
      input.value = ''; sendBtn.disabled = true;
      msgList.appendChild(el('div', { class: 'chat-bubble user', text: msg }));
      msgList.scrollTop = msgList.scrollHeight;
      var pending = el('div', { class: 'chat-bubble assistant', text: '…' });
      msgList.appendChild(pending);
      var active = null;
      try { active = window.__qfCopilotForm ? window.__qfCopilotForm.getActive() : null; } catch (e) {}
      if (active && active.fields && active.fields.length) runFormFill(msg, pending, active);
      else runRateChat(msg, pending);
    }

    return { root: chat, msgList: msgList, input: input, sendBtn: sendBtn, renderHistory: renderHistory, load: load };
  }

  // ── AI agent panel ────────────────────────────────────────────
  function renderAi(c) {
    Promise.all([
      api('/api/tenant/ai-config'),
      api('/api/ai/rate-chat'),
    ]).then(function (out) {
      var cfg = out[0].aiConfig; var hist = out[1].messages;
      c.innerHTML = '';
      c.appendChild(el('h1', { text: 'AI agent' }));
      c.appendChild(el('p', { class: 'page-sub', text: 'Tune your rates by chatting in plain English. Try: "raise reefer minimums to $600 and add a $50 hazmat surcharge".' }));

      var grid = el('div', { class: 'grid-2', style: { alignItems: 'start' } });

      // Chat panel — shared rate-chat surface (same code path as the copilot
      // bubble, so page + bubble stay one continuous conversation).
      var leftCol = el('div');
      var chatUI = buildRateChat({ msgListId: 'rate-chat-msgs' });
      chatUI.renderHistory(hist);
      leftCol.appendChild(chatUI.root);

      // Right column: AI config form
      var rightCol = el('div');
      var cfgCard = el('div', { class: 'card' });
      cfgCard.appendChild(el('div', { class: 'card-title', text: 'AI behaviour' }));
      cfgCard.appendChild(el('div', { class: 'card-subtitle', text: 'Rate changes are proposed for your review — nothing goes live until you click Apply.' }));

      function renderField(label, child) {
        return el('div', { class: 'field', style: { marginBottom: '12px' } }, [el('label', { class: 'field-label', text: label }), child]);
      }
      var promptTa = el('textarea', { class: 'textarea', rows: '8', placeholder: 'System prompt' });
      promptTa.value = (cfg && cfg.systemPrompt) || '';
      promptTa.addEventListener('blur', function () { api('/api/tenant/ai-config', { method: 'PUT', body: { systemPrompt: promptTa.value } }).catch(toastErr); });
      var promptField = renderField('System prompt (your AI persona)', promptTa);

      var toneSel = el('select', { class: 'select' });
      ['professional', 'friendly', 'concise', 'enthusiastic'].forEach(function (t) { var o = document.createElement('option'); o.value = t; o.textContent = t; if ((cfg && cfg.tone) === t) o.selected = true; toneSel.appendChild(o); });
      toneSel.addEventListener('change', function () { api('/api/tenant/ai-config', { method: 'PUT', body: { tone: toneSel.value } }).catch(toastErr); });
      var toneField = renderField('Tone', toneSel);

      function toggle(key, label, def) {
        var wrap = el('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginTop: '6px' } });
        var c2 = el('input', { type: 'checkbox' }); c2.checked = (cfg && cfg[key] != null) ? !!cfg[key] : def;
        c2.addEventListener('change', function () { var p = {}; p[key] = c2.checked; api('/api/tenant/ai-config', { method: 'PUT', body: p }).catch(toastErr); });
        wrap.appendChild(c2); wrap.appendChild(el('span', { text: label })); return wrap;
      }
      cfgCard.appendChild(toggle('autoReplyEnabled', 'Auto-reply email to leads', true));
      cfgCard.appendChild(toggle('chatEnabled', 'Customer-service chat after quote', true));

      // BYO key
      var keyCard = el('div', { class: 'card', style: { marginTop: '14px' } });
      keyCard.appendChild(el('div', { class: 'card-title', text: 'Bring your own Anthropic key (optional)' }));
      keyCard.appendChild(el('div', { class: 'card-subtitle', text: 'When set, your AI calls run on your account — separate billing, your usage limits.' }));
      var keyInp = el('input', { class: 'input', placeholder: 'sk-ant-…', type: 'password' });
      var keyBtn = el('button', { class: 'btn btn-secondary', text: 'Save key', style: { marginTop: '8px' } });
      keyBtn.addEventListener('click', function () {
        if (!keyInp.value) return;
        api('/api/tenant/anthropic-key', { method: 'PUT', body: { apiKey: keyInp.value } })
          .then(function () { keyInp.value = ''; toastOk('Key saved'); }).catch(toastErr);
      });
      keyCard.appendChild(keyInp); keyCard.appendChild(keyBtn);
      var clearBtn = el('button', { class: 'btn btn-ghost', text: 'Clear stored key', style: { marginTop: '8px' } });
      clearBtn.addEventListener('click', function () { if (!confirm('Remove your Anthropic key?')) return; api('/api/tenant/anthropic-key', { method: 'DELETE' }).then(function () { toastOk('Key cleared'); }).catch(toastErr); });
      keyCard.appendChild(clearBtn);

      // Fold the power-user settings (persona prompt, tone, bring-your-own key)
      // into a collapsed "Advanced" panel (Alex). Default view = the AI chat +
      // the two behaviour toggles, which is all most carriers touch.
      var aiAdv = el('details', { class: 'qf-ai-advanced', style: { marginTop: '12px' } });
      var aiAdvSum = el('summary', { style: { cursor: 'pointer', fontWeight: '700', fontSize: '13px', color: 'var(--ink)', padding: '10px 12px', borderRadius: '10px', background: 'var(--surface)', border: '1px solid var(--border)', userSelect: 'none' } });
      aiAdvSum.appendChild(el('span', { text: 'Advanced' }));
      aiAdvSum.appendChild(el('span', { style: { color: 'var(--muted)', fontWeight: '500', fontSize: '12px', marginLeft: '6px' }, text: '— AI persona, tone, and your own API key' }));
      aiAdv.appendChild(aiAdvSum);
      promptField.style.marginTop = '10px';
      keyCard.style.marginTop = '10px';
      aiAdv.appendChild(promptField);
      aiAdv.appendChild(toneField);
      aiAdv.appendChild(keyCard);
      cfgCard.appendChild(aiAdv);

      rightCol.appendChild(cfgCard);
      grid.appendChild(leftCol); grid.appendChild(rightCol);
      c.appendChild(grid);
    }).catch(showErr(c));
  }

  // ── Customize (rebuilt Brand surface — Wave 2) ─────────────────
  // A single-purpose "Customize your calculator" page: theme presets, accent,
  // font, logo upload, name/tagline — beside a LIVE preview of the tenant's
  // real widget (/w/<slug>). Every change is debounce-saved via the brand PUT
  // then the preview iframe reloads to reflect it. The legacy readiness /
  // setup-question / preview-mock / scanner injectors are suppressed on this
  // route (see de-clutter guards in dashboard-setup.js, share-readiness.js,
  // dashboard-preview.js, brand-editor.js, brand-studio-preview.js and the
  // scoped rules in customize-panel.css).
  // ── Shared live-preview component (Customize + Embed) ─────────────────────
  // ONE preview widget both surfaces reuse. It renders the tenant's REAL
  // calculator (signed owner-preview URL) and provides the three approved
  // upgrades:
  //   A. No blink — brand edits are pushed into the widget via postMessage
  //      ({qf:'brand-preview'} for instant fields, {qf:'brand-refetch'} after a
  //      save) instead of reloading the iframe. The iframe is NEVER re-sourced.
  //   B. Auto-height — the frame grows to the widget's reported content height
  //      (QF_WIDGET_HEIGHT), so there is no fixed-box inner scrollbar.
  //   C. Device (Desktop/Mobile) + widget-theme (Site/Light/Dark) toggles in
  //      the head. On a real phone the device toggle is hidden and the preview
  //      defaults to the mobile calculator.
  // Returns { col, postPatch(patch), notifySaved(), setUrl(url) }.
  function buildLivePreview(opts) {
    opts = opts || {};
    var previewUrl = opts.previewUrl || '';
    var openHref = opts.openHref || previewUrl;

    var col = el('div', { class: 'qf-cz-preview-col' });
    var pcard = el('div', { class: 'card qf-cz-preview' });
    col.appendChild(pcard);

    var head = el('div', { class: 'qf-cz-preview-head' });
    head.appendChild(el('span', { class: 'qf-cz-preview-title', text: 'Live preview' }));

    var tools = el('div', { class: 'qf-cz-preview-tools' });

    // Device segmented toggle (Desktop | Mobile).
    var device = 'desktop';
    var devSeg = el('div', { class: 'qf-cz-seg', role: 'group', 'aria-label': 'Preview device' });
    var DEV_ICONS = {
      desktop: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>',
      mobile: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="20" x="5" y="2" rx="2"/><line x1="12" x2="12.01" y1="18" y2="18"/></svg>',
    };
    var devBtns = {};
    [{ id: 'desktop', label: 'Desktop' }, { id: 'mobile', label: 'Mobile' }].forEach(function (d) {
      var btn = el('button', { type: 'button', class: 'qf-cz-seg-btn', 'data-device': d.id, 'aria-label': d.label, title: d.label, html: DEV_ICONS[d.id] });
      btn.addEventListener('click', function () { setDevice(d.id); });
      devBtns[d.id] = btn; devSeg.appendChild(btn);
    });
    tools.appendChild(devSeg);

    // Widget-theme segmented toggle (Site | Light | Dark) — re-themes the REAL
    // calculator, not just the backdrop. It posts { qf:'theme', preset } into the
    // iframe; the widget's preview-context listener refetches
    // /api/public/widget/<slug>?preset=… and re-skins live (no reload, no blink):
    //   · "Site"  → clear the override → the tenant's OWN saved theme (truthful).
    //   · "Light" → a canonical LIGHT preset (Clarity/mono).
    //   · "Dark"  → a canonical DARK preset (Midnight).
    // Light/Dark keep the tenant's accent + font (that's what ?preset= does). A
    // neutral host backdrop is swapped as a SECONDARY nicety so the widget sits
    // on a coherent light/dark surface.
    var THEME_PRESETS = { light: 'mono', dark: 'midnight' };
    var themeMode = 'site';
    var themeSeg = el('div', { class: 'qf-cz-seg', role: 'group', 'aria-label': 'Widget theme', title: 'Preview your calculator in light or dark' });
    var themeBtns = {};
    // "Auto" = the tenant's own saved theme (internal id stays 'site' so the
    // reset postMessage below is unchanged); Light/Dark force those presets.
    [{ id: 'site', label: 'Auto — your saved theme' }, { id: 'light', label: 'Light theme' }, { id: 'dark', label: 'Dark theme' }].forEach(function (h) {
      var btn = el('button', { type: 'button', class: 'qf-cz-seg-btn qf-cz-seg-text', 'data-theme': h.id, 'aria-label': h.label, title: h.label, text: h.id === 'site' ? 'Auto' : (h.id === 'light' ? 'Light' : 'Dark') });
      btn.addEventListener('click', function () { setTheme(h.id); });
      themeBtns[h.id] = btn; themeSeg.appendChild(btn);
    });
    tools.appendChild(themeSeg);

    head.appendChild(tools);
    var openLink = el('a', { href: openHref, target: '_blank', rel: 'noopener', class: 'qf-cz-preview-open', text: 'Open ↗' });
    head.appendChild(openLink);
    pcard.appendChild(head);

    var frameWrap = el('div', { class: 'qf-cz-frame-wrap', 'data-device': 'desktop', 'data-host': 'site' });
    var iframe = el('iframe', { class: 'qf-cz-frame', src: previewUrl, title: 'Your live calculator' });
    frameWrap.appendChild(iframe);
    pcard.appendChild(frameWrap);
    pcard.appendChild(el('div', { class: 'qf-cz-preview-note', text: 'This is exactly what your customers see. It updates live as you make changes.' }));

    function setDevice(id) {
      device = id;
      frameWrap.setAttribute('data-device', id);
      Object.keys(devBtns).forEach(function (k) {
        var on = k === id;
        devBtns[k].classList.toggle('is-active', on);
        devBtns[k].setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      // Width change reflows the widget → its ResizeObserver re-reports height.
    }
    function setTheme(id, skipPost) {
      if (id !== 'site' && !Object.prototype.hasOwnProperty.call(THEME_PRESETS, id)) id = 'site';
      themeMode = id;
      // This control ONLY re-themes the widget (via the postMessage below). It
      // deliberately does NOT swap a host backdrop/frame anymore — that made the
      // preview appear to resize/reframe between Auto/Light/Dark. The container
      // now stays a constant size across all three states.
      Object.keys(themeBtns).forEach(function (k) {
        var on = k === id;
        themeBtns[k].classList.toggle('is-active', on);
        themeBtns[k].setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      // PRIMARY: re-theme the actual widget. '' → tenant's saved theme (reset);
      // a preset id forces that light/dark preset (accent/font preserved).
      if (!skipPost) postToPreview({ qf: 'theme', preset: id === 'site' ? '' : (THEME_PRESETS[id] || '') });
    }
    setDevice('desktop');
    setTheme('site', true);

    // ── Fix 2: on a real phone, a desktop preview is pointless — hide the
    // Desktop|Mobile toggle and default the preview to the mobile calculator.
    // Reacts to viewport changes (rotate/resize) and is robust to teardown: once
    // the preview is removed from the DOM the listener detaches itself.
    var mobileMq = (window.matchMedia && window.matchMedia('(max-width: 640px)')) || null;
    var forcedMobile = false;
    function applyPreviewViewport(isPhone) {
      if (isPhone) {
        devSeg.style.display = 'none';
        if (device !== 'mobile') { forcedMobile = true; setDevice('mobile'); }
      } else {
        devSeg.style.display = '';
        if (forcedMobile) { forcedMobile = false; setDevice('desktop'); }
      }
    }
    applyPreviewViewport(mobileMq ? mobileMq.matches : false);
    if (mobileMq) {
      var onMqChange = function (ev) {
        if (!frameWrap.isConnected) {
          if (mobileMq.removeEventListener) mobileMq.removeEventListener('change', onMqChange);
          else if (mobileMq.removeListener) mobileMq.removeListener(onMqChange);
          return;
        }
        applyPreviewViewport(ev.matches);
      };
      if (mobileMq.addEventListener) mobileMq.addEventListener('change', onMqChange);
      else if (mobileMq.addListener) mobileMq.addListener(onMqChange);
    }

    // Auto-height: size the frame to the widget's real content height. Clamp to
    // a sane band so a runaway report can't blow out the panel; the widget only
    // ever reports its true in-flow height (see widget.js contentHeight()).
    function onMsg(e) {
      if (!iframe || !iframe.isConnected) { window.removeEventListener('message', onMsg); return; }
      if (e.source !== iframe.contentWindow || !e.data) return;
      if (e.data.type === 'QF_WIDGET_HEIGHT' && typeof e.data.height === 'number') {
        var h = Math.max(320, Math.min(2200, Math.round(e.data.height)));
        iframe.style.height = h + 'px';
      }
    }
    window.addEventListener('message', onMsg);

    function postToPreview(msg) {
      try { if (iframe && iframe.contentWindow) iframe.contentWindow.postMessage(msg, '*'); } catch (_e) {}
    }

    // ── Guided-editing preview alignment ──────────────────────────────────
    // A config container calls alignTo(targetKey, containerEl) when it becomes
    // active; we scroll the preview VIEWPORT (frameWrap is a fixed-height
    // overflow-y:auto box) so the mapped widget section lands level with the
    // active container ("directly across from it"). The widget section is found
    // in the SAME-ORIGIN iframe document — access is fully guarded so a stray
    // cross-origin throw or a missing/hidden section just no-ops (never breaks
    // the page). Honours prefers-reduced-motion (instant scroll, no smooth).
    var czReduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    // targetKey → candidate widget selectors, first VISIBLE wins. Kept broad so
    // a section hidden in the current preview state (e.g. the route map before
    // an address is entered) falls back to the nearest visible region.
    var ALIGN_TARGETS = {
      header: ['.qf-header', '#qf-header'],
      map: ['.qf-map-card', '.qf-map-canvas', '#qf-default-addr-row', '.qf-addr-row'],
      tabs: ['.qf-tabs', '#qf-services'],
      root: ['.qf-widget', '.qf-header'],
    };
    function czVisible(node) {
      if (!node) return false;
      var r = node.getBoundingClientRect();
      return !!(node.getClientRects().length && r.height > 0 && r.width > 0);
    }
    function czFindTarget(doc, key) {
      var sels = ALIGN_TARGETS[key] || ALIGN_TARGETS.header;
      for (var i = 0; i < sels.length; i++) {
        var n = null;
        try { n = doc.querySelector(sels[i]); } catch (_e) { n = null; }
        if (czVisible(n)) return n;
      }
      return null;
    }
    function alignTo(key, containerEl) {
      try {
        if (!iframe || !iframe.isConnected) return;
        var outerDoc = iframe.contentDocument; // same-origin on prod + dev harness
        if (!outerDoc) return;                 // cross-origin → contentDocument is null
        // The preview loads the HOSTED page, which embeds the actual calculator
        // in a nested #qf-calc-frame — the widget sections (.qf-header/.qf-map-…)
        // live one frame deeper. Descend into it (same-origin); fall back to the
        // outer doc for the bare calculator. Neither frame scrolls internally
        // (both sized to full content), so a section's offset in the hosted
        // content = calc-frame offset + section offset within the calc.
        var doc = outerDoc, calcFrameEl = null;
        try {
          var cfe = outerDoc.getElementById('qf-calc-frame');
          if (cfe && cfe.contentDocument && cfe.contentDocument.querySelector('.qf-header, .qf-widget')) {
            calcFrameEl = cfe; doc = cfe.contentDocument;
          }
        } catch (_d) { /* nested access blocked — use the outer doc */ }
        var target = czFindTarget(doc, key);
        if (!target) return;
        // Brief pulse on the mapped section so the control→section link is clear
        // on click (the arrow points here). Base state is transparent — the pulse
        // flashes once and fades. Force a reflow before re-adding so re-selecting
        // the same section replays it (isolated so a layout throw can't skip add).
        try {
          var prevH = doc.querySelectorAll('.qf-preview-highlight');
          for (var h = 0; h < prevH.length; h++) prevH[h].classList.remove('qf-preview-highlight');
          try { void target.offsetWidth; } catch (_hf) {}
          target.classList.add('qf-preview-highlight');
        } catch (_hl) {}
        // Best-effort centre-scroll of the mapped section within the preview
        // viewport. Absolute offset in the (scrollable) hosted content = calc-frame
        // offset + section offset in the calc. Sections near the top clamp to 0
        // (nothing above them) — fine; the pulse still marks them.
        var tRect = target.getBoundingClientRect();
        var frameOffset;
        if (calcFrameEl) {
          frameOffset = calcFrameEl.getBoundingClientRect().top;
        } else {
          var outerRoot = outerDoc.documentElement || outerDoc.body;
          frameOffset = outerRoot ? -outerRoot.getBoundingClientRect().top : 0;
        }
        var targetCenter = frameOffset + tRect.top + tRect.height / 2;
        var desired = targetCenter - frameWrap.clientHeight / 2;
        var maxScroll = Math.max(0, frameWrap.scrollHeight - frameWrap.clientHeight);
        desired = Math.max(0, Math.min(maxScroll, Math.round(desired)));
        if (typeof frameWrap.scrollTo === 'function') {
          frameWrap.scrollTo({ top: desired, behavior: czReduce ? 'auto' : 'smooth' });
        } else {
          frameWrap.scrollTop = desired;
        }
      } catch (_e) { /* cross-origin or transient DOM error — no-op, never break */ }
    }

    return {
      col: col,
      // Scroll the preview so the widget section a config container controls
      // lines up level with that container (guided-editing pointer).
      alignTo: alignTo,
      // Instant, no-network apply of the given brand fields.
      postPatch: function (patch) { postToPreview({ qf: 'brand-preview', patch: patch }); },
      // Instant, no-network apply of hosted trust-wrap copy (headline, badges,
      // testimonials, CTAs, background) — handled by the hosted-page shell, not
      // the calculator. No-op when the preview is the bare widget (no shell).
      postHosted: function (patch) { postToPreview({ qf: 'hosted-preview', patch: patch }); },
      // Re-skin from the freshly-saved config (server-derived fields), no blink.
      notifySaved: function () { postToPreview({ qf: 'brand-refetch' }); },
      setUrl: function (url) { previewUrl = url; openLink.href = url; iframe.src = url; },
      // Swap ONLY the iframe source (e.g. Design → bare widget, Page → hosted
      // page) without touching the "Open ↗" link, which always points at the
      // real hosted page. Guarded so re-selecting the same tab never reloads.
      setPreviewSrc: function (url) {
        if (!url || url === previewUrl) return;
        previewUrl = url;
        iframe.src = url;
      },
    };
  }

  function renderBrand(c, opts) {
    opts = opts || {};
    var slug = (state.me && state.me.tenant && state.me.tenant.slug) || '';
    // Fetch a signed owner-preview URL alongside the brand config so the live
    // preview renders the REAL calculator even when the tenant is private. The
    // access config seeds the Behavior tab's public/private control.
    Promise.all([
      api('/api/tenant/brand'),
      api('/api/tenant/preview-url'),
      api('/api/tenant/access').catch(function () { return { accessMode: 'public', links: [] }; }),
    ]).then(function (results) {
      var d = results[0];
      var previewUrl = (results[1] && results[1].previewUrl) || ('/w/' + encodeURIComponent(slug));
      var access = results[2] || { accessMode: 'public', links: [] };
      var b = d.brand || {};
      var presets = d.presets || [];
      var fonts = d.fonts || [];
      var ctaHovers = d.ctaHovers || [{ id: 'border' }, { id: 'lift' }, { id: 'glow' }, { id: 'fill' }, { id: 'none' }];
      var fontColorOpts = d.fontColors || [];
      var presetsById = {};
      presets.forEach(function (p) { presetsById[p.id] = p; });
      c.innerHTML = '';

      // ── client-side WCAG mirror (matches src/server/color/contrast.ts) ──
      // Used only to filter which font-colour swatches are OFFERED for the
      // currently-selected background — the server re-computes + guarantees the
      // applied colour, so this is a UX convenience, not the source of truth.
      function _lin(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
      function _lum(hex) {
        var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
        if (!m) return null;
        var n = parseInt(m[1], 16);
        return 0.2126 * _lin((n >> 16) & 255) + 0.7152 * _lin((n >> 8) & 255) + 0.0722 * _lin(n & 255);
      }
      function wcagRatio(a, bg) {
        var la = _lum(a), lb = _lum(bg);
        if (la == null || lb == null) return 0;
        return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
      }
      function wcagPasses(fg, bg, level) { return wcagRatio(fg, bg) >= (level || 4.5) - 1e-9; }
      // The main text backgrounds for the currently-selected theme.
      function currentTextSurfaces() {
        var p = presetsById[currentPreset] || presetsById.midnight || {};
        return [p.bg, p.surface].filter(function (s) { return /^#?[0-9a-f]{6}$/i.test(String(s || '')); });
      }
      // Re-assigned once the Text-color section is built; called on theme/accent
      // change so the offered swatches update dynamically.
      var repaintFontColors = function () {};
      // Assigned once the Map-style section is built; lets the theme-preset
      // handler apply that theme's default map style + repaint the map chips.
      var applyMapStyle = function () {};

      var root = el('div', { class: 'qf-customize', 'data-qf-customize': '1' });
      c.appendChild(root);
      root.appendChild(el('h1', { text: 'Customize' }));
      root.appendChild(el('p', { class: 'page-sub', text: 'Pick a look, add your logo, and watch your live calculator update on the right.' }));

      var layout = el('div', { class: 'qf-cz-layout' });
      var leftCol = el('div', { class: 'qf-cz-controls' });

      // ── Tabbed workspace: Design + Behavior share ONE live preview ──────
      var tabBar = el('div', { class: 'qf-cz-tabs', role: 'tablist', 'aria-label': 'Customize sections' });
      var designPanel = el('div', { class: 'qf-cz-tabpanel', role: 'tabpanel', 'aria-label': 'Design' });
      var behaviorPanel = el('div', { class: 'qf-cz-tabpanel is-hidden', role: 'tabpanel', 'aria-label': 'Behavior' });
      // The "Page" tab owns the HOSTED-page trust-wrap (headline, trust badges,
      // testimonials, CTAs, background). It shares the SAME live preview, which
      // renders /w/<slug> — so the wrap updates live as the carrier edits.
      var pagePanel = el('div', { class: 'qf-cz-tabpanel is-hidden', role: 'tabpanel', 'aria-label': 'Page' });
      // Design sections keep appending to `controls` (unchanged below).
      var controls = designPanel;
      var panels = { design: designPanel, behavior: behaviorPanel, page: pagePanel };
      var tabBtns = {};
      // #4: the Design tab previews the BARE calculator widget (…?embed=1 →
      // app.ts serves the bare widget: no hosted header/hero/footer, so the
      // company name is NOT duplicated and no extra canvas text shows). The Page
      // + Behavior tabs preview the HOSTED page (its trust-wrap is what they
      // edit). The signed ?pk= grant already in previewUrl rides along, so the
      // bare widget stays in preview context and still receives the live
      // brand-preview / theme / brand-refetch messages.
      function czPreviewUrlFor(id) {
        if (id === 'design') return previewUrl + (previewUrl.indexOf('?') > -1 ? '&' : '?') + 'embed=1';
        return previewUrl;
      }
      function selectTab(id) {
        if (!panels[id]) id = 'design';
        Object.keys(panels).forEach(function (k) {
          panels[k].classList.toggle('is-hidden', k !== id);
          tabBtns[k].classList.toggle('is-active', k === id);
          tabBtns[k].setAttribute('aria-selected', k === id ? 'true' : 'false');
        });
        // Point the shared preview at the right source for this tab (Design =
        // widget-only, Page/Behavior = hosted). Guarded no-op when unchanged.
        if (preview && preview.setPreviewSrc) preview.setPreviewSrc(czPreviewUrlFor(id));
      }
      [{ id: 'design', label: 'Design' }, { id: 'page', label: 'Page' }, { id: 'behavior', label: 'Behavior' }].forEach(function (t) {
        var btn = el('button', { type: 'button', class: 'qf-cz-tab', role: 'tab', 'data-tab': t.id, text: t.label });
        btn.addEventListener('click', function () { selectTab(t.id); });
        tabBtns[t.id] = btn; tabBar.appendChild(btn);
      });
      leftCol.appendChild(tabBar);
      leftCol.appendChild(designPanel);
      leftCol.appendChild(pagePanel);
      leftCol.appendChild(behaviorPanel);

      // Shared live preview (no-blink apply, auto-height, device + host toggles).
      // #4: seed the iframe with the CORRECT source for the initial tab so there
      // is no hosted→widget reload flash (Design, the default, is widget-only).
      var czInitialTab = opts.tab === 'behavior' ? 'behavior' : (opts.tab === 'page' ? 'page' : 'design');
      var preview = buildLivePreview({ previewUrl: czPreviewUrlFor(czInitialTab), openHref: previewUrl });

      layout.appendChild(leftCol);
      layout.appendChild(preview.col);
      root.appendChild(layout);

      // ── save queue (debounced) + no-blink live preview ──────────
      // Design edits post an INSTANT in-place patch to the preview (no reload),
      // then debounce-save via the brand PUT; on save the widget re-skins from
      // the fresh config (server-derived fields) — still no iframe reload.
      function kv(k, v) { var o = {}; o[k] = v; return o; }
      var pending = {}, saveTimer = null;
      function flush() {
        if (!Object.keys(pending).length) return;
        var body = pending; pending = {};
        api('/api/tenant/brand', { method: 'PUT', body: body })
          .then(function () { preview.notifySaved(); })
          .catch(function (e) {
            if (e && e.status === 403) toast('A custom logo is a Core/Vital feature — upgrade to add your own logo.', 'warn');
            else toastErr(e);
          });
      }
      function queueSave(patch, immediate) {
        Object.assign(pending, patch);
        clearTimeout(saveTimer);
        saveTimer = setTimeout(flush, immediate ? 0 : 450);
      }
      // Push an instant, no-network visual patch to the preview widget.
      function livePatch(patch) { preview.postPatch(patch); }

      // ── Your company (name + tagline) ───────────────────────────
      function textField(label, key, val, hint) {
        var f = el('div', { class: 'qf-cz-field' });
        f.appendChild(el('label', { class: 'qf-cz-label', text: label }));
        var inp = el('input', { class: 'input', type: 'text' });
        inp.value = val || '';
        inp.addEventListener('input', function () { queueSave(kv(key, inp.value)); livePatch(kv(key, inp.value)); });
        inp.addEventListener('blur', function () { queueSave(kv(key, inp.value), true); });
        f.appendChild(inp);
        if (hint) f.appendChild(el('div', { class: 'qf-cz-hint', text: hint }));
        return f;
      }
      var company = el('div', { class: 'card qf-cz-section' });
      company.appendChild(el('div', { class: 'qf-cz-section-title', text: 'Your company' }));
      company.appendChild(textField('Company name', 'displayName', b.displayName, 'Shown above your calculator.'));
      company.appendChild(textField('Tagline', 'tagline', b.tagline, 'One short line under your name.'));
      controls.appendChild(company);

      // Copilot form-fill (Phase 2): register the company name + tagline text
      // fields so the AI can prefill them ("set my tagline to 'Fast freight,
      // fair rates'"). On mobile the controls live in a foldable sheet — the
      // reveal hook (set during sheet activation) opens + scrolls to the field.
      (function registerCustomizeForm() {
        function czReveal(elm) {
          if (typeof root.__qfCzReveal === 'function') { root.__qfCzReveal(elm); return; }
          try { elm.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { if (elm.scrollIntoView) elm.scrollIntoView(); }
        }
        var czInputs = company.querySelectorAll('input');
        var specs = [];
        if (czInputs[0]) specs.push({ key: 'displayName', label: 'Company name', el: czInputs[0], reveal: czReveal });
        if (czInputs[1]) specs.push({ key: 'tagline', label: 'Tagline', el: czInputs[1], reveal: czReveal });
        qfRegisterCopilotForm('customize', 'Customize your calculator', specs);
      })();

      // ── Reusable drag-scroll carousel (theme presets + map styles) ──────
      // Wraps an existing item strip in a horizontally-scrollable track with
      // subtle left/right chevron arrows — mirrors the QuoteQuick wizard's
      // selector. Grab anywhere on the strip and drag to move the selectors
      // live (Pointer Events → mouse, touch and pen alike); the strip glides
      // with momentum on release. A drag (>threshold px) is distinguished from
      // a tap so each item's EXISTING click/select handler + queueSave still
      // fire on a click — this only changes LAYOUT/navigation, never the
      // selection logic. Arrows page ~80% of the visible width and hide at each
      // end; honours reduced-motion.
      function makeCarousel(track) {
        track.classList.add('qf-cz-carousel-track');
        var wrap = el('div', { class: 'qf-cz-carousel' });
        var CHEV_L = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>';
        var CHEV_R = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
        var prev = el('button', { type: 'button', class: 'qf-cz-carousel-arrow qf-cz-carousel-prev', 'aria-label': 'Scroll left', html: CHEV_L });
        var next = el('button', { type: 'button', class: 'qf-cz-carousel-arrow qf-cz-carousel-next', 'aria-label': 'Scroll right', html: CHEV_R });
        wrap.appendChild(prev); wrap.appendChild(track); wrap.appendChild(next);
        var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        function page() { return Math.max(120, Math.round(track.clientWidth * 0.8)); }
        function update() {
          var max = track.scrollWidth - track.clientWidth;
          var x = track.scrollLeft;
          // A few px of slack: scroll-snap + the track's padding leave the strip
          // resting a hair off 0 at the start, so treat "near the edge" as the edge.
          var atStart = x <= 6, atEnd = x >= max - 6;
          prev.disabled = atStart; next.disabled = atEnd || max <= 1;
          prev.classList.toggle('is-hidden', atStart);
          next.classList.toggle('is-hidden', atEnd || max <= 1);
        }
        prev.addEventListener('click', function () { track.scrollBy({ left: -page(), behavior: reduce ? 'auto' : 'smooth' }); });
        next.addEventListener('click', function () { track.scrollBy({ left: page(), behavior: reduce ? 'auto' : 'smooth' }); });
        track.addEventListener('scroll', update);
        window.addEventListener('resize', update);
        // The track often measures 0/no-overflow at creation (inside a not-yet
        // laid-out sheet, or before webfonts settle), which wrongly hides the
        // arrows. Re-check once the track gets its real size + on later reflows.
        if (window.ResizeObserver) { try { new ResizeObserver(update).observe(track); } catch (_e) {} }
        // Pointer drag-to-scroll with velocity-decay momentum (mouse, touch,
        // pen — one code path via Pointer Events). Grab anywhere on the strip
        // and it tracks the pointer 1:1 while dragging, then glides with inertia
        // that eases to a stop on release; native proximity snap (CSS) tidies
        // the final resting alignment. The pointer is CAPTURED on engage so the
        // drag keeps tracking even when the cursor leaves the row. Reuses the
        // shared grab-scroll cursor pattern (html.qf-grabbing) alongside a
        // track-local .is-grabbing. Honours prefers-reduced-motion (no glide).
        //
        // Click vs drag: a press that stays under DRAG_THRESHOLD never engages,
        // so its trailing click reaches the chip's own select handler untouched;
        // a press that crosses it is a drag and the trailing click is swallowed
        // so dragging can never accidentally select a preset.
        var DRAG_THRESHOLD = 5;
        var down = false, dragging = false, pid = null;
        var startX = 0, startY = 0, startScroll = 0, moved = 0;
        var lastT = 0, vel = 0; // vel = scrollLeft px per ms during the drag
        var raf = 0;
        function cancelGlide() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }
        // End of interaction: refresh the arrow visibility. No scroll-snap — the
        // strip rests wherever the drag/glide leaves it (cropped chips are fine).
        function settle() { update(); }
        // Inertial glide — decay the release velocity frame by frame so the strip
        // coasts and eases to a stop, clamping at either end.
        function glide() {
          var max = track.scrollWidth - track.clientWidth;
          function step() {
            vel *= 0.95; // per-frame friction
            if (Math.abs(vel) < 0.015) { raf = 0; settle(); return; }
            var nx = track.scrollLeft + vel * 16; // px this frame (~16ms)
            if (nx <= 0) { track.scrollLeft = 0; raf = 0; settle(); return; }
            if (nx >= max) { track.scrollLeft = max; raf = 0; settle(); return; }
            track.scrollLeft = nx;
            update();
            raf = requestAnimationFrame(step);
          }
          cancelGlide();
          raf = requestAnimationFrame(step);
        }
        function onDown(e) {
          if (e.button != null && e.button > 0) return; // primary button / touch / pen only
          cancelGlide();
          down = true; dragging = false; pid = e.pointerId;
          startX = e.clientX; startY = e.clientY; startScroll = track.scrollLeft; moved = 0;
          lastT = (e.timeStamp || performance.now()); vel = 0;
        }
        function onMove(e) {
          if (!down || (pid != null && e.pointerId !== pid)) return;
          var dx = e.clientX - startX, dy = e.clientY - startY;
          if (!dragging) {
            // Engage only once the gesture is clearly horizontal — a vertical
            // swipe on the strip is left to scroll the page.
            if (Math.abs(dx) < DRAG_THRESHOLD || Math.abs(dx) < Math.abs(dy)) return;
            dragging = true;
            track.classList.add('is-grabbing');
            document.documentElement.classList.add('qf-grabbing');
            try { if (track.setPointerCapture && pid != null) track.setPointerCapture(pid); } catch (_) { }
          }
          moved = Math.max(moved, Math.abs(dx));
          var prevSL = track.scrollLeft;
          track.scrollLeft = startScroll - dx;
          var now = (e.timeStamp || performance.now()), dt = now - lastT;
          if (dt > 0) { vel = (track.scrollLeft - prevSL) / dt; lastT = now; }
          if (e.cancelable) e.preventDefault();
        }
        function onUp(e) {
          if (!down) return;
          if (pid != null && e.pointerId != null && e.pointerId !== pid) return;
          var wasDragging = dragging;
          down = false; dragging = false;
          try { if (track.releasePointerCapture && pid != null) track.releasePointerCapture(pid); } catch (_) { }
          pid = null;
          if (!wasDragging) return;
          track.classList.remove('is-grabbing');
          document.documentElement.classList.remove('qf-grabbing');
          // Throw with inertia; reduced-motion settles instantly.
          if (!reduce && Math.abs(vel) > 0.02) glide();
          else settle();
        }
        track.addEventListener('pointerdown', onDown);
        track.addEventListener('pointermove', onMove);
        track.addEventListener('pointerup', onUp);
        track.addEventListener('pointercancel', onUp);
        // Swallow the click that closes a real drag so dragging never selects.
        track.addEventListener('click', function (e) {
          if (moved > DRAG_THRESHOLD) { e.stopPropagation(); e.preventDefault(); }
          moved = 0;
        }, true);
        requestAnimationFrame(update);
        setTimeout(update, 60);
        return wrap;
      }

      // ── Theme presets ───────────────────────────────────────────
      var themeSec = el('div', { class: 'card qf-cz-section' });
      themeSec.appendChild(el('div', { class: 'qf-cz-section-title', text: 'Theme' }));
      themeSec.appendChild(el('div', { class: 'qf-cz-hint', text: 'A curated look — sets the background, surfaces, and default accent. Drag or use the arrows to browse.' }));
      var grid = el('div', { class: 'qf-cz-preset-strip' });
      var currentPreset = b.themePreset || 'midnight';
      presets.forEach(function (p) {
        var on = p.id === currentPreset;
        var btn = el('button', { type: 'button', class: 'qf-cz-preset' + (on ? ' is-selected' : ''), 'data-preset': p.id, 'aria-pressed': on ? 'true' : 'false', title: p.description || p.label });
        var sw = el('div', { class: 'qf-cz-preset-swatch', style: { background: p.bg } });
        sw.appendChild(el('div', { class: 'qf-cz-preset-surface', style: { background: p.surface } }));
        sw.appendChild(el('div', { class: 'qf-cz-preset-accent', style: { background: p.accent } }));
        btn.appendChild(sw);
        btn.appendChild(el('div', { class: 'qf-cz-preset-name', text: p.label }));
        btn.addEventListener('click', function () {
          currentPreset = p.id;
          $$('.qf-cz-preset', grid).forEach(function (n) {
            var sel = n.getAttribute('data-preset') === p.id;
            n.classList.toggle('is-selected', sel);
            n.setAttribute('aria-pressed', sel ? 'true' : 'false');
          });
          // Switching preset resets the accent to the NEW preset's default —
          // clear any prior override so resolveWidgetTheme pulls the preset
          // accent (mirrors the "Theme default" chip). Otherwise the previous
          // theme's accent stays baked onto the new theme.
          currentAccent = null;
          paintAccent();
          // Each theme carries a default map style — apply it (and repaint the
          // map chips) so the map matches the new look. Carrier can still override.
          var patch = { themePreset: p.id, accentOverride: null };
          if (p.mapStyle) { applyMapStyle(p.mapStyle); patch.mapStyle = p.mapStyle; }
          queueSave(patch, true);
          repaintFontColors();
        });
        grid.appendChild(btn);
      });
      themeSec.appendChild(makeCarousel(grid));
      controls.appendChild(themeSec);

      // ── Accent color ────────────────────────────────────────────
      var accentSec = el('div', { class: 'card qf-cz-section' });
      accentSec.appendChild(el('div', { class: 'qf-cz-section-title', text: 'Accent color' }));
      accentSec.appendChild(el('div', { class: 'qf-cz-hint', text: 'Your buttons and highlights. Keep "Theme default" to match the preset.' }));
      var accentRow = el('div', { class: 'qf-cz-accent-row' });
      // Curated accent options — brand cobalt/periwinkle first. No teal.
      var ACCENTS = ['#0D3CFC', '#6E8BFF', '#2563EB', '#059669', '#D14343', '#F59E0B', '#7C3AED'];
      var currentAccent = b.accentOverride || null; // null = theme default
      var colorInput = null;
      function paintAccent() {
        $$('.qf-cz-swatch', accentRow).forEach(function (n) {
          var v = n.getAttribute('data-accent');
          var sel = (v === '__default__' && !currentAccent) ||
            (!!v && v !== '__default__' && !!currentAccent && v.toLowerCase() === currentAccent.toLowerCase());
          n.classList.toggle('is-selected', sel);
        });
        if (colorInput && currentAccent) colorInput.value = currentAccent;
      }
      var defChip = el('button', { type: 'button', class: 'qf-cz-swatch qf-cz-swatch-default', 'data-accent': '__default__', title: 'Use the theme accent' });
      defChip.appendChild(el('span', { text: 'Theme default' }));
      // Theme default has no client-known accent hex — let the post-save
      // re-skin (brand-refetch) pull the preset accent so it's authoritative.
      defChip.addEventListener('click', function () { currentAccent = null; paintAccent(); queueSave({ accentOverride: null }, true); repaintFontColors(); });
      accentRow.appendChild(defChip);
      ACCENTS.forEach(function (hex) {
        var sw = el('button', { type: 'button', class: 'qf-cz-swatch', 'data-accent': hex, title: hex, style: { background: hex } });
        sw.addEventListener('click', function () { currentAccent = hex; paintAccent(); livePatch({ accent: hex }); queueSave({ accentOverride: hex }, true); repaintFontColors(); });
        accentRow.appendChild(sw);
      });
      var customWrap = el('label', { class: 'qf-cz-swatch qf-cz-swatch-custom', title: 'Pick a custom color' });
      colorInput = el('input', { type: 'color', value: currentAccent || '#0D3CFC' });
      colorInput.addEventListener('input', function () { currentAccent = colorInput.value; paintAccent(); livePatch({ accent: colorInput.value }); queueSave({ accentOverride: colorInput.value }); repaintFontColors(); });
      customWrap.appendChild(colorInput);
      customWrap.appendChild(el('span', { text: 'Custom' }));
      accentRow.appendChild(customWrap);
      // The accent-swatch row (Default + swatches + Custom) is the longest
      // option strip and wraps on narrow widths; wrap it in the shared
      // scroll-with-arrows carousel so it scrolls horizontally instead of
      // wrapping to a second line (same proven pattern as the theme/map rows).
      accentSec.appendChild(makeCarousel(accentRow));
      controls.appendChild(accentSec);
      paintAccent();

      // ── Font ────────────────────────────────────────────────────
      var fontSec = el('div', { class: 'card qf-cz-section' });
      fontSec.appendChild(el('div', { class: 'qf-cz-section-title', text: 'Font' }));
      var sel = el('select', { class: 'input qf-cz-select' });
      var curFont = b.fontFamily || 'satoshi';
      fonts.forEach(function (f) {
        var opt = el('option', { value: f.id, text: f.label + (f.id === 'satoshi' ? ' (default)' : '') });
        if (f.id === curFont) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', function () { queueSave({ fontFamily: sel.value }, true); });
      fontSec.appendChild(sel);
      controls.appendChild(fontSec);

      // ── Button hover effect ─────────────────────────────────────
      var HOVER_LABELS = { border: 'Border', lift: 'Lift', glow: 'Glow', fill: 'Fill', none: 'None' };
      var HOVER_HINTS = {
        border: 'A clean border wraps the button.',
        lift: 'Gently lifts with a soft shadow.',
        glow: 'A soft accent glow.',
        fill: 'A subtle fill / shade shift.',
        none: 'No hover change (keeps focus ring).',
      };
      var hoverSec = el('div', { class: 'card qf-cz-section' });
      hoverSec.appendChild(el('div', { class: 'qf-cz-section-title', text: 'Button hover' }));
      hoverSec.appendChild(el('div', { class: 'qf-cz-hint', text: 'How your main button reacts on hover. All stay subtle and on-brand.' }));
      var hoverRow = el('div', { class: 'qf-cz-hover-row' });
      var currentHover = b.ctaHover || 'border';
      ctaHovers.forEach(function (h) {
        var id = h.id || h;
        var on = id === currentHover;
        var chip = el('button', { type: 'button', class: 'qf-cz-hover-chip' + (on ? ' is-selected' : ''), 'data-hover': id, 'aria-pressed': on ? 'true' : 'false', title: HOVER_HINTS[id] || id });
        chip.appendChild(el('span', { class: 'qf-cz-hover-name', text: (HOVER_LABELS[id] || id) + (id === 'border' ? ' (default)' : '') }));
        chip.addEventListener('click', function () {
          currentHover = id;
          $$('.qf-cz-hover-chip', hoverRow).forEach(function (n) {
            var s = n.getAttribute('data-hover') === id;
            n.classList.toggle('is-selected', s);
            n.setAttribute('aria-pressed', s ? 'true' : 'false');
          });
          livePatch({ ctaHover: id });
          queueSave({ ctaHover: id }, true);
        });
        hoverRow.appendChild(chip);
      });
      hoverSec.appendChild(makeCarousel(hoverRow));
      controls.appendChild(hoverSec);

      // ── Map style ───────────────────────────────────────────────
      // How the calculator's base + route maps look. Saving reloads the live
      // preview (same flow as Theme/Button hover), so the map re-renders in the
      // chosen style. The route line stays clearly visible on every option.
      var mapStyles = d.mapStyles || [
        { key: 'branded', label: 'Branded' },
        { key: 'grayscale', label: 'Clean' },
        { key: 'standard', label: 'Standard' },
        { key: 'soft', label: 'Soft' },
        { key: 'dark_routes', label: 'Dark' },
        { key: 'satellite', label: 'Satellite' },
      ];
      var mapSec = el('div', { class: 'card qf-cz-section' });
      mapSec.appendChild(el('div', { class: 'qf-cz-section-title', text: 'Map style' }));
      mapSec.appendChild(el('div', { class: 'qf-cz-hint', text: 'How the map on your calculator looks. The route line stays clear on every style. Drag or use the arrows to browse.' }));
      var mapRow = el('div', { class: 'qf-cz-mapstyle-strip' });
      var currentMapStyle = b.mapStyle || 'branded';
      applyMapStyle = function (key) {
        currentMapStyle = key;
        $$('.qf-cz-mapstyle', mapRow).forEach(function (n) {
          var s = n.getAttribute('data-mapstyle') === key;
          n.classList.toggle('is-selected', s);
          n.setAttribute('aria-pressed', s ? 'true' : 'false');
        });
      };
      // Mini-map swatches that actually read like each map style — land, water,
      // a road grid, and the route line, coloured per style.
      var MAP_SWATCH = {
        branded:     { land: '#16204a', water: '#0f1629', road: '#2c3a72', route: '#6E8BFF' },
        grayscale:   { land: '#eceef1', water: '#dde1e6', road: '#c7ccd3', route: '#0D3CFC' },
        standard:    { land: '#e8efe4', water: '#a9d1f0', road: '#ffffff', route: '#0D3CFC' },
        soft:        { land: '#f3efe6', water: '#cfe0cf', road: '#e6ddce', route: '#0D3CFC' },
        dark_routes: { land: '#1c1c1c', water: '#0e0e0e', road: '#3a3a3a', route: '#f4f6f8' },
        satellite:   { land: '#4f6b3f', water: '#35597c', road: '#8f7d5a', route: '#f4f6f8' }
      };
      function mapSwatchSvg(key) {
        var c = MAP_SWATCH[key] || MAP_SWATCH.branded;
        return '<svg viewBox="0 0 28 20" preserveAspectRatio="none" aria-hidden="true">'
          + '<rect width="28" height="20" fill="' + c.land + '"/>'
          + '<path d="M0 13 L9 12 L17 15 L28 12 L28 20 L0 20 Z" fill="' + c.water + '"/>'
          + '<path d="M0 7 H28 M9 0 V20 M19 0 V20" stroke="' + c.road + '" stroke-width="1.4" opacity="0.85" fill="none"/>'
          + '<path d="M2 18 L11 9 L17 12 L26 3" stroke="' + c.route + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'
          + '</svg>';
      }
      mapStyles.forEach(function (m) {
        var on = m.key === currentMapStyle;
        var chip = el('button', { type: 'button', class: 'qf-cz-mapstyle' + (on ? ' is-selected' : ''), 'data-mapstyle': m.key, 'aria-pressed': on ? 'true' : 'false', title: m.hint || m.label });
        chip.appendChild(el('span', { class: 'qf-cz-mapstyle-swatch qf-ms-' + m.key, html: mapSwatchSvg(m.key) }));
        chip.appendChild(el('span', { class: 'qf-cz-mapstyle-name', text: m.label + (m.key === 'branded' ? ' (default)' : '') }));
        chip.addEventListener('click', function () {
          applyMapStyle(m.key);
          queueSave({ mapStyle: m.key }, true);
        });
        mapRow.appendChild(chip);
      });
      mapSec.appendChild(makeCarousel(mapRow));
      controls.appendChild(mapSec);

      // ── Map blend (opacity slider — feather map edges into the card) ─────
      // Replaces the old on/off toggle with a 0–100% intensity slider. 0 = OFF
      // (crisp rectangular map — today's default); 1–100 = blend ON, feathering
      // the route-map's edges into the calculator surface at that strength. The
      // on/off master is DERIVED from opacity>0 (body[data-qf-map-blend]) and the
      // feather STRENGTH is driven by --qf-map-blend-opacity. The live preview
      // tracks the drag; the PUT is debounced so dragging doesn't spam saves.
      // Legacy tenants with mapBlend='on' start at 60% (see the resolve layer).
      var blendSec = el('div', { class: 'card qf-cz-section' });
      blendSec.appendChild(el('div', { class: 'qf-cz-section-title', text: 'Map blend' }));
      blendSec.appendChild(el('div', { class: 'qf-cz-hint', text: 'Blend the map into the card — its edges feather softly into your calculator surface. Slide to 0 for a crisp rectangular map.' }));
      var blendInit = (typeof b.mapBlendOpacity === 'number') ? b.mapBlendOpacity : (b.mapBlend === 'on' ? 60 : 0);
      blendInit = Math.max(0, Math.min(100, Math.round(blendInit)));
      var blendRow = el('div', { class: 'qf-cz-blend-row' });
      var blendInput = el('input', { class: 'qf-cz-blend-slider', type: 'range', min: '0', max: '100', step: '1', 'aria-label': 'Map blend intensity' });
      blendInput.value = String(blendInit);
      var blendVal = el('span', { class: 'qf-cz-blend-value', text: blendInit + '%' });
      blendInput.addEventListener('input', function () {
        var v = Math.max(0, Math.min(100, parseInt(blendInput.value, 10) || 0));
        blendVal.textContent = v + '%';
        livePatch({ mapBlendOpacity: v });
        queueSave({ mapBlendOpacity: v });
      });
      blendInput.addEventListener('change', function () {
        var v = Math.max(0, Math.min(100, parseInt(blendInput.value, 10) || 0));
        queueSave({ mapBlendOpacity: v }, true);
      });
      blendRow.appendChild(blendInput);
      blendRow.appendChild(blendVal);
      blendSec.appendChild(blendRow);
      controls.appendChild(blendSec);

      // ── Header logo, name & layout ───────────────────────────────
      // Independent controls so a carrier can run a BIG logo AND keep the name +
      // tagline (the old compact/full toggle could only do one or the other).
      // Logo size, layout (beside/stacked), alignment, and a show-name toggle.
      // The logo is ALWAYS object-fit:contain — never cropped. Saving refetches
      // the live preview (same flow as Theme/Map).
      var headerSec = el('div', { class: 'card qf-cz-section' });
      headerSec.appendChild(el('div', { class: 'qf-cz-section-title', text: 'Header logo' }));
      headerSec.appendChild(el('div', { class: 'qf-cz-hint', text: 'Your logo, company name and tagline. Any logo shape fits cleanly — never cropped or stretched.' }));
      function headerChipRow(labelText, field, cur, opts) {
        headerSec.appendChild(el('div', { class: 'qf-cz-label', style: { marginTop: '10px' }, text: labelText }));
        var row = el('div', { class: 'qf-cz-hover-row' });
        opts.forEach(function (o) {
          var on = o.id === cur;
          var chip = el('button', { type: 'button', class: 'qf-cz-hover-chip' + (on ? ' is-selected' : ''), 'data-hv': o.id, 'aria-pressed': on ? 'true' : 'false', title: o.title || o.label });
          chip.appendChild(el('span', { class: 'qf-cz-hover-name', text: o.label }));
          chip.addEventListener('click', function () {
            $$('.qf-cz-hover-chip', row).forEach(function (n) {
              var s = n.getAttribute('data-hv') === o.id;
              n.classList.toggle('is-selected', s);
              n.setAttribute('aria-pressed', s ? 'true' : 'false');
            });
            var p = {}; p[field] = o.id;
            queueSave(p, true);
          });
          row.appendChild(chip);
        });
        headerSec.appendChild(makeCarousel(row));
      }
      headerChipRow('Logo size', 'headerLogoSize', (/^(s|m|l|xl)$/.test(String(b.headerLogoSize)) ? b.headerLogoSize : 'm'), [
        { id: 's', label: 'Small' }, { id: 'm', label: 'Medium' }, { id: 'l', label: 'Large' }, { id: 'xl', label: 'Extra-large' },
      ]);
      headerChipRow('Layout', 'headerLayout', (b.headerLayout === 'stacked' ? 'stacked' : 'beside'), [
        { id: 'beside', label: 'Beside name', title: 'Logo next to the company name' },
        { id: 'stacked', label: 'On its own line', title: 'Logo above the name — best for wide wordmark logos' },
      ]);
      headerChipRow('Alignment', 'headerAlign', (b.headerAlign === 'center' ? 'center' : 'left'), [
        { id: 'left', label: 'Left' }, { id: 'center', label: 'Center' },
      ]);
      var showNameWrap = el('label', { class: 'qf-cz-field', style: { display: 'flex', gap: '10px', alignItems: 'flex-start', cursor: 'pointer', marginTop: '12px' } });
      var showNameCb = el('input', { type: 'checkbox', style: { marginTop: '3px', flex: '0 0 auto' } });
      showNameCb.checked = b.headerShowName !== false;
      showNameCb.addEventListener('change', function () { queueSave({ headerShowName: showNameCb.checked }, true); });
      showNameWrap.appendChild(showNameCb);
      showNameWrap.appendChild(el('div', {}, [
        el('div', { text: 'Show company name + tagline', style: { fontWeight: '600' } }),
        el('div', { class: 'field-hint', style: { marginTop: '2px' }, text: 'Turn off if your logo already includes your company name (logo only).' }),
      ]));
      headerSec.appendChild(showNameWrap);
      controls.appendChild(headerSec);

      // ── Text color (background-aware, WCAG-limited) ──────────────
      // Only colours that clear WCAG AA against the CURRENT theme background
      // are offered; the set updates whenever the theme/accent changes.
      // "Auto" (the contrast engine's safe pick) is the default. The server
      // re-validates per surface and falls back to auto anywhere a colour
      // would drop below threshold — so nothing ever renders unreadable.
      var textSec = el('div', { class: 'card qf-cz-section' });
      textSec.appendChild(el('div', { class: 'qf-cz-section-title', text: 'Text color' }));
      textSec.appendChild(el('div', { class: 'qf-cz-hint', text: 'Only readable choices for your background are shown. Auto is recommended.' }));
      var textRow = el('div', { class: 'qf-cz-textcolor-row' });
      textSec.appendChild(makeCarousel(textRow));
      var currentFontColor = (b.fontColor && b.fontColor !== 'auto') ? String(b.fontColor).toLowerCase() : 'auto';
      repaintFontColors = function () {
        textRow.innerHTML = '';
        var surfaces = currentTextSurfaces();
        // "Auto (recommended)" — always available, always safe.
        var autoOn = currentFontColor === 'auto';
        var autoChip = el('button', { type: 'button', class: 'qf-cz-textcolor qf-cz-textcolor-auto' + (autoOn ? ' is-selected' : ''), 'data-fontcolor': 'auto', 'aria-pressed': autoOn ? 'true' : 'false', title: 'Auto — a readable colour is picked for you' });
        autoChip.appendChild(el('span', { class: 'qf-cz-textcolor-dot', style: { background: 'linear-gradient(135deg,#fff 50%,#141414 50%)' } }));
        autoChip.appendChild(el('span', { text: 'Auto (recommended)' }));
        autoChip.addEventListener('click', function () { currentFontColor = 'auto'; repaintFontColors(); queueSave({ fontColor: 'auto' }, true); });
        textRow.appendChild(autoChip);
        // Curated swatches, filtered to those passing WCAG on ALL text surfaces.
        var offered = fontColorOpts.filter(function (sw) {
          return surfaces.every(function (bg) { return wcagPasses(sw.hex, bg, 4.5); });
        });
        var stillValid = false;
        offered.forEach(function (sw) {
          var on = currentFontColor === String(sw.hex).toLowerCase();
          if (on) stillValid = true;
          var chip = el('button', { type: 'button', class: 'qf-cz-textcolor' + (on ? ' is-selected' : ''), 'data-fontcolor': sw.hex, 'aria-pressed': on ? 'true' : 'false', title: sw.label });
          chip.appendChild(el('span', { class: 'qf-cz-textcolor-dot', style: { background: sw.hex } }));
          chip.appendChild(el('span', { text: sw.label }));
          chip.addEventListener('click', function () { currentFontColor = String(sw.hex).toLowerCase(); repaintFontColors(); queueSave({ fontColor: sw.hex }, true); });
          textRow.appendChild(chip);
        });
        // If the previously-chosen colour no longer passes the new background,
        // snap back to Auto (and persist) so we never keep an unreadable pick.
        if (currentFontColor !== 'auto' && !stillValid) {
          currentFontColor = 'auto';
          queueSave({ fontColor: 'auto' }, true);
          repaintFontColors();
          return;
        }
        // The text-colour row is a carousel; refresh its arrows now the chip
        // set has been rebuilt (makeCarousel only re-checks on scroll/resize).
        try { textRow.dispatchEvent(new Event('scroll')); } catch (_e) {}
      };
      repaintFontColors();
      controls.appendChild(textSec);

      // Fold the fine-tuning (accent, font, button hover, text colour) into a
      // collapsed "Advanced appearance" panel so the default surface stays simple
      // (Alex): theme preset, logo, and name/tagline are all a carrier needs to
      // pick a look. Re-parenting keeps every section's listeners + state intact.
      var advDetails = el('details', { class: 'qf-cz-advanced', style: { marginTop: '4px' } });
      var advSummary = el('summary', { class: 'qf-cz-adv-summary', style: {
        cursor: 'pointer', fontWeight: '700', fontSize: '13px', color: 'var(--ink)',
        padding: '10px 12px', borderRadius: '10px', background: 'var(--surface)',
        border: '1px solid var(--border)', userSelect: 'none'
      } });
      advSummary.appendChild(el('span', { text: 'Advanced appearance' }));
      advSummary.appendChild(el('span', { style: { color: 'var(--muted)', fontWeight: '500', fontSize: '12px', marginLeft: '6px' }, text: '— accent, font, hover, text colour' }));
      advDetails.appendChild(advSummary);
      [accentSec, fontSec, hoverSec, textSec].forEach(function (s) {
        s.style.marginTop = '8px';
        advDetails.appendChild(s); // appendChild re-parents out of `controls`
      });
      controls.appendChild(advDetails);

      // ── Logo (drag-drop + client downscale to a small data-URL) ──
      var logoSec = el('div', { class: 'card qf-cz-section' });
      logoSec.appendChild(el('div', { class: 'qf-cz-section-title', text: 'Logo' }));
      logoSec.appendChild(el('div', { class: 'qf-cz-hint', text: 'Drop an image or choose a file. We shrink it automatically so your page loads fast.' }));

      var logoPreview = el('div', { class: 'qf-cz-logo-current' });
      function paintLogo(url) {
        logoPreview.innerHTML = '';
        if (url) {
          logoPreview.appendChild(el('img', { class: 'qf-cz-logo-img', src: url, alt: 'Current logo' }));
          var rm = el('button', { type: 'button', class: 'btn btn-secondary qf-cz-logo-remove', text: 'Remove logo' });
          rm.addEventListener('click', function () { livePatch({ logoUrl: null }); queueSave({ logoUrl: null }, true); paintLogo(''); });
          logoPreview.appendChild(rm);
        } else {
          logoPreview.appendChild(el('span', { class: 'qf-cz-hint', text: 'No logo yet.' }));
        }
      }

      function processLogo(file) {
        return new Promise(function (resolve, reject) {
          var reader = new FileReader();
          reader.onerror = reject;
          reader.onload = function () {
            var src = String(reader.result || '');
            // SVG is already tiny + vector — keep as-is (canvas would rasterize).
            if (file.type === 'image/svg+xml') { resolve(src); return; }
            var img = new Image();
            img.onload = function () {
              var max = 256;
              var scale = Math.min(1, max / Math.max(img.width || max, img.height || max));
              var w = Math.max(1, Math.round((img.width || max) * scale));
              var h = Math.max(1, Math.round((img.height || max) * scale));
              var canvas = document.createElement('canvas');
              canvas.width = w; canvas.height = h;
              var ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0, w, h);
              var out = '';
              try { out = canvas.toDataURL('image/webp', 0.85); } catch (_e) { out = ''; }
              if (!out || out.indexOf('data:image/webp') !== 0) out = canvas.toDataURL('image/png');
              resolve(out);
            };
            img.onerror = reject;
            img.src = src;
          };
          reader.readAsDataURL(file);
        });
      }

      function saveLogo(dataUrl) {
        if (dataUrl.length > 150 * 1024) { toast('That image is too large even after shrinking. Try a simpler logo.', 'warn'); return; }
        // Data-URL swap is instant (no network) → apply live, no cross-fade
        // reload needed. The debounced PUT persists it.
        livePatch({ logoUrl: dataUrl });
        queueSave({ logoUrl: dataUrl }, true);
        paintLogo(dataUrl);
      }
      function handleFile(file) {
        if (!file || !/^image\//.test(file.type)) { toast('Please choose an image file.', 'warn'); return; }
        // SVG is vector — keep as-is (nothing to crop). Raster images open the
        // zoom/crop editor so the carrier can frame their logo before saving.
        if (file.type === 'image/svg+xml' || !window.QFLogoCropper) {
          processLogo(file).then(saveLogo).catch(function () { toast('Could not read that image.', 'error'); });
          return;
        }
        var reader = new FileReader();
        reader.onerror = function () { toast('Could not read that image.', 'error'); };
        reader.onload = function () {
          window.QFLogoCropper.open(String(reader.result || ''), saveLogo);
        };
        reader.readAsDataURL(file);
      }

      var drop = el('div', { class: 'qf-cz-dropzone', tabindex: '0' });
      drop.appendChild(el('div', { class: 'qf-cz-dropzone-title', text: 'Drag & drop your logo here' }));
      drop.appendChild(el('div', { class: 'qf-cz-hint', text: 'PNG, JPG, SVG or WebP' }));
      var fileInput = el('input', { type: 'file', accept: 'image/*', class: 'qf-cz-file' });
      var pickBtn = el('button', { type: 'button', class: 'btn btn-secondary qf-cz-pick', text: 'Choose file' });
      pickBtn.addEventListener('click', function () { fileInput.click(); });
      drop.appendChild(pickBtn);
      drop.appendChild(fileInput);
      fileInput.addEventListener('change', function () {
        if (fileInput.files && fileInput.files[0]) handleFile(fileInput.files[0]);
        // Reset so re-picking the SAME file (e.g. after Remove, or after
        // cancelling the crop) still fires `change` — otherwise switching back
        // to a previously-chosen logo silently does nothing.
        fileInput.value = '';
      });
      ['dragover', 'dragenter'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('is-drag'); }); });
      ['dragleave', 'dragend'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('is-drag'); }); });
      drop.addEventListener('drop', function (e) {
        e.preventDefault();
        drop.classList.remove('is-drag');
        var dt = e.dataTransfer;
        if (dt && dt.files && dt.files[0]) handleFile(dt.files[0]);
      });
      logoSec.appendChild(drop);
      logoSec.appendChild(logoPreview);
      controls.appendChild(logoSec);
      paintLogo(b.logoUrl || '');

      // ── Guided-editing pointer (arrow + preview scroll-alignment) ─────────
      // Tapping / clicking / focusing a Design config container marks it the
      // single active one, reveals a floating brand-accent arrow at its RIGHT
      // edge pointing toward the live preview, and scrolls the preview so the
      // widget section that container controls lines up level with it. The
      // container → widget-section map is stamped as data-preview-target; the
      // scroll math + same-origin guard live in buildLivePreview.alignTo.
      (function wireGuidedEditing() {
        var CHEV_R = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
        // Each Design container → the widget section it visually governs.
        var mapping = [
          [company, 'header'],
          [themeSec, 'header'],
          [headerSec, 'header'],
          [logoSec, 'header'],
          [mapSec, 'map'],
          [blendSec, 'map'],
          [accentSec, 'tabs'],
          [hoverSec, 'tabs'],
          [fontSec, 'header'],
          [textSec, 'header'],
        ];
        var sections = [];
        mapping.forEach(function (pair) {
          var sec = pair[0];
          if (!sec) return;
          sec.setAttribute('data-preview-target', pair[1]);
          // One arrow per targeted container; shown only while .is-cz-active.
          sec.appendChild(el('span', { class: 'qf-cz-arrow', 'aria-hidden': 'true', html: CHEV_R }));
          sections.push(sec);
        });
        function setActive(sec) {
          sections.forEach(function (s) { s.classList.toggle('is-cz-active', s === sec); });
          if (sec) preview.alignTo(sec.getAttribute('data-preview-target'), sec);
        }
        function onActivate(e) {
          var t = e.target;
          var sec = (t && t.closest) ? t.closest('.qf-cz-section[data-preview-target]') : null;
          if (!sec) return; // clicks outside a targeted container don't change the active one
          setActive(sec);
        }
        leftCol.addEventListener('click', onActivate);
        leftCol.addEventListener('focusin', onActivate);
      })();

      // ── Page tab — the HOSTED-page trust-wrap (headline, trust badges,
      // testimonials, CTAs, background). Shares queueSave (debounced brand PUT)
      // + the ONE live preview; every edit posts an instant hosted-preview patch
      // to the /w/<slug> shell so the wrap updates with no blink. Applies ONLY
      // to the hosted page — the embed snippet + demo stay the bare calculator.
      (function buildPagePanel() {
        var pc = pagePanel;
        // live-apply + debounced save, mirroring the Design tab's model.
        function hostedSave(patch, immediate) { queueSave(patch, immediate); preview.postHosted(patch); }

        pc.appendChild(el('p', { class: 'qf-cz-hint', style: { margin: '0 0 12px' },
          text: 'These build the landing page around your calculator at your hosted link. Your embed snippet stays the bare calculator — unchanged.' }));

        // 1 ── Headline + subhead ------------------------------------------
        function hpText(label, key, val, hint, textarea) {
          var f = el('div', { class: 'qf-cz-field' });
          f.appendChild(el('label', { class: 'qf-cz-label', text: label }));
          var inp = textarea ? el('textarea', { class: 'textarea', rows: '2' }) : el('input', { class: 'input', type: 'text' });
          inp.value = (val != null ? val : '');
          inp.addEventListener('input', function () { hostedSave(kv(key, inp.value)); });
          inp.addEventListener('blur', function () { hostedSave(kv(key, inp.value), true); });
          f.appendChild(inp);
          if (hint) f.appendChild(el('div', { class: 'qf-cz-hint', text: hint }));
          return f;
        }
        var headCard = el('div', { class: 'card qf-cz-section', style: { marginTop: '0' } });
        headCard.appendChild(el('div', { class: 'qf-cz-section-title', text: 'Headline' }));
        headCard.appendChild(hpText('Headline', 'hostedHeadline', b.hostedHeadline, 'A short marketing line above your calculator. Leave blank to hide.'));
        headCard.appendChild(hpText('Subhead', 'hostedSubhead', b.hostedSubhead, 'One supporting sentence under the headline.', true));
        pc.appendChild(headCard);

        // 2 ── Trust badges -------------------------------------------------
        var badgePreview = [];
        if (d.dotNumber) badgePreview.push('USDOT ' + d.dotNumber);
        if (d.mcNumber) badgePreview.push('MC ' + d.mcNumber);
        if (badgePreview.length) badgePreview.push('Insured');
        var trustCard = el('div', { class: 'card qf-cz-section' });
        trustCard.appendChild(el('div', { class: 'qf-cz-section-title', text: 'Trust badges' }));
        var trustRow = el('label', { style: { display: 'flex', gap: '12px', alignItems: 'flex-start', cursor: 'pointer' } });
        var trustCb = el('input', { type: 'checkbox', style: { marginTop: '3px', flex: '0 0 auto' } });
        trustCb.checked = !!b.hostedTrustBadges;
        trustCb.addEventListener('change', function () { b.hostedTrustBadges = trustCb.checked; hostedSave({ hostedTrustBadges: trustCb.checked }, true); });
        trustRow.appendChild(trustCb);
        trustRow.appendChild(el('div', {}, [
          el('div', { text: 'Show my authority & insurance badges', style: { fontWeight: '600' } }),
          el('div', { class: 'field-hint', style: { marginTop: '2px' },
            text: badgePreview.length ? ('Will show: ' + badgePreview.join(' · ')) : 'No USDOT/MC on file yet — add them in Account → Company so your credential badges can appear.' }),
        ]));
        trustCard.appendChild(trustRow);
        pc.appendChild(trustCard);

        // 3 ── Testimonials -------------------------------------------------
        var testis = Array.isArray(b.hostedTestimonialsJson) ? b.hostedTestimonialsJson.map(function (t) { return Object.assign({}, t); }) : [];
        var testiCard = el('div', { class: 'card qf-cz-section' });
        testiCard.appendChild(el('div', { class: 'qf-cz-section-title', text: 'Testimonials' }));
        testiCard.appendChild(el('div', { class: 'qf-cz-hint', text: 'Add 2–4 short customer reviews. On phones the first two show.' }));
        var testiWrap = el('div');
        var addTesti = el('button', { type: 'button', class: 'btn btn-secondary', style: { marginTop: '10px' }, text: '+ Add testimonial' });
        function saveTesti() { hostedSave({ hostedTestimonialsJson: testis.map(function (t) { return Object.assign({}, t); }) }); }
        function renderTesti() {
          testiWrap.innerHTML = '';
          testis.forEach(function (t, i) {
            var row = el('div', { class: 'card', style: { padding: '12px', marginTop: '10px' } });
            row.appendChild(el('label', { class: 'qf-cz-label', text: 'Quote' }));
            var qta = el('textarea', { class: 'textarea', rows: '2', placeholder: 'They were fast and the price held.' });
            qta.value = t.quote || '';
            qta.addEventListener('input', function () { t.quote = qta.value; saveTesti(); });
            row.appendChild(qta);
            var grid = el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '8px' } });
            var author = el('input', { class: 'input', type: 'text', placeholder: 'Author' }); author.value = t.author || '';
            author.addEventListener('input', function () { t.author = author.value; saveTesti(); });
            var comp = el('input', { class: 'input', type: 'text', placeholder: 'Company (optional)' }); comp.value = t.company || '';
            comp.addEventListener('input', function () { t.company = comp.value; saveTesti(); });
            grid.appendChild(author); grid.appendChild(comp);
            row.appendChild(grid);
            var foot = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', gap: '8px' } });
            var rate = el('select', { class: 'input', style: { maxWidth: '140px' } });
            [['0', 'No rating'], ['1', '1 ★'], ['2', '2 ★'], ['3', '3 ★'], ['4', '4 ★'], ['5', '5 ★']].forEach(function (o) {
              rate.appendChild(el('option', { value: o[0], text: o[1] }));
            });
            rate.value = String(t.rating || 0);
            rate.addEventListener('change', function () { var r = parseInt(rate.value, 10) || 0; if (r) t.rating = r; else delete t.rating; saveTesti(); });
            var rm = el('button', { type: 'button', class: 'btn btn-secondary', text: 'Remove' });
            rm.addEventListener('click', function () { testis.splice(i, 1); renderTesti(); saveTesti(); });
            foot.appendChild(rate); foot.appendChild(rm);
            row.appendChild(foot);
            testiWrap.appendChild(row);
          });
          addTesti.style.display = testis.length >= 4 ? 'none' : '';
        }
        addTesti.addEventListener('click', function () { if (testis.length >= 4) return; testis.push({ quote: '', author: '' }); renderTesti(); });
        testiCard.appendChild(testiWrap);
        testiCard.appendChild(addTesti);
        renderTesti();
        pc.appendChild(testiCard);

        // 4 ── CTA buttons --------------------------------------------------
        var ctas = Array.isArray(b.hostedCtasJson) ? b.hostedCtasJson.map(function (c) { return Object.assign({}, c); }) : [];
        var ctaCard = el('div', { class: 'card qf-cz-section' });
        ctaCard.appendChild(el('div', { class: 'qf-cz-section-title', text: 'Action buttons' }));
        ctaCard.appendChild(el('div', { class: 'qf-cz-hint', text: 'Up to 3 buttons — e.g. “Call dispatch”, “Email us”, “Visit site”.' }));
        var ctaWrap = el('div');
        var addCta = el('button', { type: 'button', class: 'btn btn-secondary', style: { marginTop: '10px' }, text: '+ Add button' });
        function saveCtas() { hostedSave({ hostedCtasJson: ctas.map(function (c) { return Object.assign({}, c); }) }); }
        function renderCtas() {
          ctaWrap.innerHTML = '';
          ctas.forEach(function (c, i) {
            var row = el('div', { class: 'card', style: { padding: '12px', marginTop: '10px' } });
            var grid = el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 110px', gap: '8px' } });
            var label = el('input', { class: 'input', type: 'text', placeholder: 'Button label' }); label.value = c.label || '';
            label.addEventListener('input', function () { c.label = label.value; saveCtas(); });
            var type = el('select', { class: 'input' });
            [['call', 'Call'], ['email', 'Email'], ['url', 'Website']].forEach(function (o) { type.appendChild(el('option', { value: o[0], text: o[1] })); });
            type.value = c.type || 'call';
            var value = el('input', { class: 'input', type: 'text', style: { marginTop: '8px' } });
            function valPlaceholder() { value.setAttribute('placeholder', type.value === 'email' ? 'name@company.com' : (type.value === 'url' ? 'https://yourcompany.com' : '+1 555 123 4567')); }
            valPlaceholder(); value.value = c.value || '';
            value.addEventListener('input', function () { c.value = value.value; saveCtas(); });
            type.addEventListener('change', function () { c.type = type.value; valPlaceholder(); saveCtas(); });
            grid.appendChild(label); grid.appendChild(type);
            row.appendChild(grid); row.appendChild(value);
            var rm = el('button', { type: 'button', class: 'btn btn-secondary', style: { marginTop: '8px' }, text: 'Remove' });
            rm.addEventListener('click', function () { ctas.splice(i, 1); renderCtas(); saveCtas(); });
            row.appendChild(rm);
            ctaWrap.appendChild(row);
          });
          addCta.style.display = ctas.length >= 3 ? 'none' : '';
        }
        addCta.addEventListener('click', function () { if (ctas.length >= 3) return; ctas.push({ label: '', type: 'call', value: '' }); renderCtas(); });
        ctaCard.appendChild(ctaWrap);
        ctaCard.appendChild(addCta);
        renderCtas();
        pc.appendChild(ctaCard);

        // 5 ── Background & theme -------------------------------------------
        var bg = (b.hostedBackgroundJson && typeof b.hostedBackgroundJson === 'object') ? Object.assign({}, b.hostedBackgroundJson) : {};
        function saveBg() { hostedSave({ hostedBackgroundJson: Object.assign({}, bg) }); }
        var bgCard = el('div', { class: 'card qf-cz-section' });
        bgCard.appendChild(el('div', { class: 'qf-cz-section-title', text: 'Page background' }));

        var themeField = el('div', { class: 'qf-cz-field' });
        themeField.appendChild(el('label', { class: 'qf-cz-label', text: 'Page theme' }));
        var themeSel = el('select', { class: 'input' });
        [['auto', 'Match calculator'], ['light', 'Light'], ['dark', 'Dark']].forEach(function (o) { themeSel.appendChild(el('option', { value: o[0], text: o[1] })); });
        themeSel.value = bg.theme || 'auto';
        themeSel.addEventListener('change', function () { if (themeSel.value === 'auto') delete bg.theme; else bg.theme = themeSel.value; saveBg(); });
        themeField.appendChild(themeSel);
        bgCard.appendChild(themeField);

        var presetField = el('div', { class: 'qf-cz-field' });
        presetField.appendChild(el('label', { class: 'qf-cz-label', text: 'Colour' }));
        var presetSel = el('select', { class: 'input' });
        (d.hostedBgPresets || [{ id: 'default', label: 'Solid' }]).forEach(function (p) { presetSel.appendChild(el('option', { value: p.id, text: p.label })); });
        presetSel.value = bg.preset || 'default';
        presetSel.addEventListener('change', function () { bg.preset = presetSel.value; saveBg(); });
        presetField.appendChild(presetSel);
        bgCard.appendChild(presetField);

        // Hero image (reuses the client-downscale pipeline; a legibility scrim
        // sits over it automatically so text stays readable).
        bgCard.appendChild(el('label', { class: 'qf-cz-label', style: { marginTop: '12px' }, text: 'Hero image (optional)' }));
        var heroPrev = el('div', { style: { marginTop: '6px' } });
        var scrimField = el('div', { class: 'qf-cz-field', style: { marginTop: '10px' } });
        scrimField.appendChild(el('label', { class: 'qf-cz-label', text: 'Text legibility (scrim)' }));
        var scrim = el('input', { type: 'range', min: '0', max: '100', class: 'input', style: { padding: '0' } });
        scrim.value = String(typeof bg.scrim === 'number' ? bg.scrim : 55);
        scrim.addEventListener('input', function () { bg.scrim = parseInt(scrim.value, 10) || 0; saveBg(); });
        scrimField.appendChild(scrim);
        function paintHero() {
          heroPrev.innerHTML = '';
          scrimField.style.display = bg.imageUrl ? '' : 'none';
          if (bg.imageUrl) {
            heroPrev.appendChild(el('img', { src: bg.imageUrl, alt: 'Hero', style: { maxWidth: '100%', maxHeight: '120px', borderRadius: '10px', display: 'block', objectFit: 'cover' } }));
            var rm = el('button', { type: 'button', class: 'btn btn-secondary', style: { marginTop: '8px' }, text: 'Remove image' });
            rm.addEventListener('click', function () { delete bg.imageUrl; saveBg(); paintHero(); });
            heroPrev.appendChild(rm);
          }
        }
        function processHero(file) {
          return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onerror = reject;
            reader.onload = function () {
              var img = new Image();
              img.onload = function () {
                var max = 1600, scale = Math.min(1, max / Math.max(img.width || max, img.height || max));
                var w = Math.max(1, Math.round((img.width || max) * scale)), h = Math.max(1, Math.round((img.height || max) * scale));
                var canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                var out = ''; try { out = canvas.toDataURL('image/webp', 0.82); } catch (_e) { out = ''; }
                if (!out || out.indexOf('data:image/webp') !== 0) out = canvas.toDataURL('image/jpeg', 0.82);
                resolve(out);
              };
              img.onerror = reject; img.src = String(reader.result || '');
            };
            reader.readAsDataURL(file);
          });
        }
        function handleHero(file) {
          if (!file || !/^image\//.test(file.type)) { toast('Please choose an image file.', 'warn'); return; }
          processHero(file).then(function (dataUrl) {
            if (dataUrl.length > 680 * 1024) { toast('That image is too large even after shrinking. Try a simpler photo.', 'warn'); return; }
            bg.imageUrl = dataUrl; saveBg(); paintHero();
          }).catch(function () { toast('Could not read that image.', 'error'); });
        }
        var heroInput = el('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
        var heroPick = el('button', { type: 'button', class: 'btn btn-secondary', style: { marginTop: '6px' }, text: 'Choose image' });
        heroPick.addEventListener('click', function () { heroInput.click(); });
        heroInput.addEventListener('change', function () { if (heroInput.files && heroInput.files[0]) handleHero(heroInput.files[0]); heroInput.value = ''; });
        bgCard.appendChild(heroPick);
        bgCard.appendChild(heroInput);
        bgCard.appendChild(heroPrev);
        bgCard.appendChild(scrimField);
        paintHero();
        pc.appendChild(bgCard);
      })();

      // ── Behavior tab — merged widget-settings controls (share ONE preview) ──
      // Lead capture / copy / quote actions / booking / follow-up / access —
      // the exact controls that lived on the old standalone Widget-settings
      // page, re-homed here as a tab. Visible-facing fields (powered-by badge,
      // CTA text, footer note, contact rules) re-skin the shared preview on
      // save via preview.notifySaved (no blink).
      buildBehaviorPanel(behaviorPanel, b, access, preview);

      // Deep links / the retired Widget-settings route open straight on Behavior.
      selectTab(opts.tab === 'behavior' ? 'behavior' : (opts.tab === 'page' ? 'page' : 'design'));

      // ── Fix B — mobile foldable control sheet (≤640px) ────────────────────
      // The live preview stays in the viewport; the controls dock into a
      // foldable bottom sheet with a sticky shortcut row (mirrors the WeFixTrades
      // QuoteQuick #467 sticky widget shell: opaque surface + hairline + rounded
      // floating bar, no glass; premium eased fold; honors reduced-motion).
      // Desktop keeps the side-by-side .qf-cz-layout UNCHANGED. State lives on
      // the sheet element (no body classes) so a route swap that wipes
      // #page-content auto-resets the :has()-scoped CSS (launcher, padding).
      (function setupCzMobileSheet() {
        if (!window.matchMedia) return;
        var mq = window.matchMedia('(max-width: 640px)');
        var reduceMq = window.matchMedia('(prefers-reduced-motion: reduce)');
        var sheet = null, sheetBody = null, handle = null, shortcutRow = null;
        var shortcutWrap = null;
        var active = false, expanded = false, tabChips = {};
        // Bottom-docked, drag-to-RESIZE sheet (like the QuoteQuick wizard): the
        // sheet is pinned to the bottom, full-width; dragging the HANDLE up/down
        // changes its HEIGHT (up = taller, down = shorter) and it stays at whatever
        // height you release. Height — not transform — so the page never jumps and
        // the body scroll (overscroll-behavior:contain) doesn't chain to the page.
        // expandedH remembers the last opened height so a tap toggles peek <-> that.
        var expandedH = 0;
        function czClamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
        function czMaxH() { return Math.round((window.innerHeight || 800) * 0.92); }
        function setSheetHeight(h) {
          if (!sheet) return;
          sheet.style.height = czClamp(Math.round(h), peekPx(), czMaxH()) + 'px';
        }

        // Key Design-tab sections surfaced as jump shortcuts, matched by their
        // section-title text (built above). Order = chip order after the tabs.
        function peekPx() {
          if (!handle) return 96;
          var row = shortcutWrap || shortcutRow;
          return handle.offsetHeight + (row ? row.offsetHeight : 0);
        }
        function measurePeek() {
          var p = peekPx();
          if (p > 0) document.documentElement.style.setProperty('--qf-cz-peek', p + 'px');
        }
        function syncTabChips(id) {
          Object.keys(tabChips).forEach(function (k) { tabChips[k].classList.toggle('is-active', k === id); });
        }
        function setExpanded(open) {
          expanded = open;
          if (!sheet) return;
          sheet.classList.toggle('is-open', open);
          if (handle) {
            handle.setAttribute('aria-expanded', open ? 'true' : 'false');
            handle.setAttribute('aria-label', open ? 'Collapse controls' : 'Expand controls');
          }
          if (open) {
            var vh = window.innerHeight || 800;
            if (!expandedH || expandedH <= peekPx() + 24) expandedH = Math.round(vh * 0.6);
            setSheetHeight(expandedH);
          } else {
            setSheetHeight(peekPx());
          }
        }
        function scrollBodyTo(top) {
          if (!sheetBody) return;
          sheetBody.scrollTo({ top: top < 0 ? 0 : top, behavior: reduceMq.matches ? 'auto' : 'smooth' });
        }
        function buildShortcutRow() {
          var row = el('div', { class: 'qf-cz-sheet-shortcuts', role: 'group', 'aria-label': 'Quick controls' });
          [{ id: 'design', label: 'Design' }, { id: 'page', label: 'Page' }, { id: 'behavior', label: 'Behavior' }].forEach(function (t) {
            var chip = el('button', { type: 'button', class: 'qf-cz-sheet-chip qf-cz-sheet-chip--tab', 'data-tab': t.id, text: t.label });
            chip.addEventListener('click', function () {
              selectTab(t.id); syncTabChips(t.id); setExpanded(true); scrollBodyTo(0);
            });
            tabChips[t.id] = chip;
            row.appendChild(chip);
          });
          // The nav shows ONLY the dedicated-page tabs (Design / Page / Behavior).
          // The old within-Design jump chips (Theme / Color / Font / Logo / Map)
          // were removed — they pointed at the same Design page, so they were
          // redundant clutter; you just scroll the Design panel to reach them.
          return row;
        }
        // Drag the handle to RESIZE the sheet's height (up = taller, down =
        // shorter); it stays wherever you release. A press that never crosses the
        // 5px threshold is a tap → toggle collapsed peek <-> last expanded height.
        // Pointer capture keeps the drag tracking off-element; height is clamped
        // between the peek and 92vh so it can never disappear or cover everything.
        function wireHandleDrag() {
          var startY = 0, baseH = 0, moved = 0, dragging = false;
          handle.addEventListener('pointerdown', function (e) {
            dragging = true; moved = 0;
            startY = e.clientY;
            baseH = sheet.offsetHeight;
            sheet.classList.add('is-dragging');
            try { handle.setPointerCapture(e.pointerId); } catch (_e) {}
          });
          handle.addEventListener('pointermove', function (e) {
            if (!dragging) return;
            var dy = startY - e.clientY;             // drag up = positive = taller
            moved = Math.max(moved, Math.abs(dy));
            setSheetHeight(baseH + dy);
            if (e.cancelable) e.preventDefault();
          });
          function endDrag(e) {
            if (!dragging) return;
            dragging = false;
            sheet.classList.remove('is-dragging');
            try { handle.releasePointerCapture(e.pointerId); } catch (_e) {}
            if (moved < 5) { setExpanded(!expanded); return; }  // tap → toggle
            // Dragged: leave it at this height + remember it as the expanded size.
            var h = sheet.offsetHeight;
            expanded = h > peekPx() + 24;
            if (expanded) expandedH = h;
            if (handle) {
              handle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
              handle.setAttribute('aria-label', expanded ? 'Collapse controls' : 'Expand controls');
            }
          }
          handle.addEventListener('pointerup', endDrag);
          handle.addEventListener('pointercancel', endDrag);
          handle.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(!expanded); }
          });
        }
        function activate() {
          if (active || !root.isConnected) return;
          active = true;
          tabChips = {};
          sheet = el('div', { class: 'qf-cz-sheet' });
          handle = el('button', { type: 'button', class: 'qf-cz-sheet-handle', 'aria-label': 'Expand controls', 'aria-expanded': 'false' }, [
            el('span', { class: 'qf-cz-sheet-grip', 'aria-hidden': 'true' }),
          ]);
          shortcutRow = buildShortcutRow();
          // #6 — wrap the chip row so it scrolls horizontally with two subtle,
          // auto-hiding arrows and never wraps to a second line (reuses makeCarousel).
          shortcutWrap = makeCarousel(shortcutRow);
          shortcutWrap.classList.add('qf-cz-carousel--nav');
          // The arrows measure once at creation, before the sheet is laid out —
          // refresh after layout so they appear whenever the chips overflow.
          requestAnimationFrame(function () { requestAnimationFrame(function () { try { shortcutRow.dispatchEvent(new Event('scroll')); } catch (_e) {} }); });
          sheetBody = el('div', { class: 'qf-cz-sheet-body' });
          sheetBody.appendChild(leftCol); // move the controls column into the sheet
          sheet.appendChild(handle);
          sheet.appendChild(shortcutWrap);
          sheet.appendChild(sheetBody);
          root.appendChild(sheet);
          wireHandleDrag();
          syncTabChips('design');
          setExpanded(false);
          requestAnimationFrame(measurePeek);
          // Copilot form-fill reveal hook: when a fill targets a control inside
          // this sheet, expand it (design tab) and scroll the field into view.
          root.__qfCzReveal = function (elm) {
            selectTab('design'); syncTabChips('design'); setExpanded(true);
            requestAnimationFrame(function () {
              requestAnimationFrame(function () {
                if (elm && elm.scrollIntoView) {
                  try { elm.scrollIntoView({ block: 'center', behavior: reduceMq.matches ? 'auto' : 'smooth' }); } catch (e) { elm.scrollIntoView(); }
                }
              });
            });
          };
        }
        function deactivate() {
          if (!active) return;
          active = false;
          try { delete root.__qfCzReveal; } catch (e) { root.__qfCzReveal = null; }
          document.documentElement.style.removeProperty('--qf-cz-peek');
          if (leftCol) {
            if (preview && preview.col && preview.col.parentNode === layout) layout.insertBefore(leftCol, preview.col);
            else layout.insertBefore(leftCol, layout.firstChild);
          }
          if (sheet) sheet.remove();
          sheet = sheetBody = handle = shortcutRow = null;
          shortcutWrap = null;
          tabChips = {};
        }
        function onChange() {
          if (!root.isConnected) {
            if (mq.removeEventListener) mq.removeEventListener('change', onChange);
            else if (mq.removeListener) mq.removeListener(onChange);
            return;
          }
          if (mq.matches) activate(); else deactivate();
        }
        if (mq.addEventListener) mq.addEventListener('change', onChange);
        else if (mq.addListener) mq.addListener(onChange);
        window.addEventListener('resize', function () { if (active) { measurePeek(); } });
        if (mq.matches) activate();
      })();
    }).catch(showErr(c));
  }

  // ── Embed ─────────────────────────────────────────────────────
  // ── Shared widget-page helpers (Embed code + Widget settings) ──
  // The brand-backed settings map 1:1 onto brand_configs columns and save
  // via PUT /api/tenant/brand (the same endpoint the Customize page uses).
  // Appearance (theme/accent/font/logo/company) lives on Customize and is
  // intentionally NOT duplicated here — these pages own behaviour + copy.
  function saveBrandPatch(patch) {
    return api('/api/tenant/brand', { method: 'PUT', body: patch });
  }
  // The live preview owned by the Behavior tab (set by buildBehaviorPanel while
  // it builds). Visible-facing behaviour saves (powered-by badge, CTA text,
  // footer note, contact rules) call this so the shared preview re-skins with
  // NO iframe reload. Null on the Embed page's own behaviour-free surfaces.
  var activeBrandPreview = null;
  function notifyBrandPreview() { try { if (activeBrandPreview) activeBrandPreview.notifySaved(); } catch (_e) {} }
  // A labelled text/textarea input that saves on blur (only when changed).
  // `b` is the loaded brand object; saves write back into it so later blurs
  // diff against the fresh value.
  function brandSettingField(b, label, key, opts) {
    opts = opts || {};
    var f = el('div', { class: 'field', style: { marginBottom: '12px' } });
    f.appendChild(el('label', { class: 'field-label', text: label }));
    var inp = opts.textarea
      ? el('textarea', { class: 'textarea', rows: '2' })
      : el('input', { class: 'input', type: 'text' });
    if (opts.placeholder) inp.setAttribute('placeholder', opts.placeholder);
    inp.value = (b[key] != null ? b[key] : '');
    inp.addEventListener('blur', function () {
      var next = inp.value;
      if (next === (b[key] != null ? b[key] : '')) return; // no change
      var p = {}; p[key] = next;
      saveBrandPatch(p).then(function () { b[key] = next; toastOk('Saved'); notifyBrandPreview(); }).catch(toastErr);
    });
    f.appendChild(inp);
    if (opts.hint) f.appendChild(el('span', { class: 'field-hint', text: opts.hint }));
    return f;
  }
  // A toggle row (label + description + checkbox) that saves on change.
  function brandSettingToggle(b, label, key, defaultVal, hint, gate) {
    var wrap = el('label', {
      style: {
        display: 'flex', gap: '12px', alignItems: 'flex-start',
        padding: '12px 0', borderTop: '1px solid var(--border)',
        cursor: gate && !gate.allowed ? 'not-allowed' : 'pointer',
      },
    });
    var cb = el('input', { type: 'checkbox', style: { marginTop: '3px', flex: '0 0 auto' } });
    cb.checked = (b[key] !== undefined && b[key] !== null) ? !!b[key] : defaultVal;
    cb.addEventListener('change', function () {
      var next = cb.checked;
      var p = {}; p[key] = next;
      saveBrandPatch(p).then(function () { b[key] = next; toastOk('Saved'); notifyBrandPreview(); }).catch(function (e) {
        cb.checked = !next; // revert on failure
        if (e && e.status === 403 && gate) toast(gate.upgradeMsg, 'warn');
        else toastErr(e);
      });
    });
    var txt = el('div', { style: { flex: '1 1 auto' } }, [
      el('div', { text: label, style: { fontWeight: '600' } }),
      hint ? el('div', { class: 'field-hint', text: hint, style: { marginTop: '2px' } }) : null,
    ]);
    wrap.appendChild(cb);
    wrap.appendChild(txt);
    return wrap;
  }

  // A toggle row bound to a key inside the brand's featuresJson bag (the
  // per-tenant optional-feature toggles). Reads the resolved default when the
  // key is absent and saves a partial featuresJson patch (the server merges it
  // with the existing bag, so sibling features are never dropped).
  function brandFeatureToggle(b, label, featureKey, defaultVal, hint) {
    var wrap = el('label', {
      style: {
        display: 'flex', gap: '12px', alignItems: 'flex-start',
        padding: '12px 0', borderTop: '1px solid var(--border)', cursor: 'pointer',
      },
    });
    var cb = el('input', { type: 'checkbox', style: { marginTop: '3px', flex: '0 0 auto' } });
    var feats = (b && b.featuresJson) || {};
    cb.checked = (feats[featureKey] !== undefined && feats[featureKey] !== null) ? !!feats[featureKey] : defaultVal;
    cb.addEventListener('change', function () {
      var next = cb.checked;
      var patch = {}; patch[featureKey] = next;
      saveBrandPatch({ featuresJson: patch }).then(function () {
        if (!b.featuresJson) b.featuresJson = {};
        b.featuresJson[featureKey] = next;
        toastOk('Saved');
        // These flags visibly change the widget (quote-action bar, confidence
        // panel, Book-this-load button) — refresh the live preview like the
        // scalar brand toggles do, instead of leaving it stale until reload.
        notifyBrandPreview();
      }).catch(function (e) { cb.checked = !next; toastErr(e); });
    });
    var txt = el('div', { style: { flex: '1 1 auto' } }, [
      el('div', { text: label, style: { fontWeight: '600' } }),
      hint ? el('div', { class: 'field-hint', text: hint, style: { marginTop: '2px' } }) : null,
    ]);
    wrap.appendChild(cb);
    wrap.appendChild(txt);
    return wrap;
  }

  // "Book this load" toggle + deposit config (Wave 2a). The quoteBooking flag
  // lives alongside the other booleans in featuresJson; the deposit config is a
  // nested `booking` object ({ depositType, depositValue }). Both save through
  // the merge-PUT (partial featuresJson patch), so toggling booking or editing
  // the deposit never drops sibling feature keys. The deposit sub-panel is only
  // shown when booking is on. Payment CHARGE is a later wave — this configures
  // the deposit amount shown to customers + recorded on a booking request.
  function brandBookingConfig(b) {
    if (!b.featuresJson) b.featuresJson = {};
    var feats = b.featuresJson;
    var booking = (feats.booking && typeof feats.booking === 'object')
      ? feats.booking : { depositType: 'none', depositValue: 0 };

    var wrap = el('div');

    // The on/off toggle (custom so it can reveal/hide the deposit sub-panel).
    var toggleRow = el('label', {
      style: {
        display: 'flex', gap: '12px', alignItems: 'flex-start',
        padding: '12px 0', borderTop: '1px solid var(--border)', cursor: 'pointer',
      },
    });
    var cb = el('input', { type: 'checkbox', style: { marginTop: '3px', flex: '0 0 auto' } });
    cb.checked = feats.quoteBooking === true;
    var toggleTxt = el('div', { style: { flex: '1 1 auto' } }, [
      el('div', { text: 'Let customers book this load', style: { fontWeight: '600' } }),
      el('div', {
        class: 'field-hint',
        text: 'Adds a “Book this load” button under the quote. The customer picks a pickup date, ready-by time, and confirms contact details. Turn on a deposit below to show what it takes to book.',
        style: { marginTop: '2px' },
      }),
    ]);
    toggleRow.appendChild(cb);
    toggleRow.appendChild(toggleTxt);
    wrap.appendChild(toggleRow);

    // Deposit sub-panel — indented, only visible when booking is on.
    var sub = el('div', {
      style: {
        display: cb.checked ? 'block' : 'none',
        margin: '4px 0 0 30px', paddingTop: '10px', borderTop: '1px dashed var(--border)',
      },
    });

    var typeField = el('div', { class: 'field', style: { marginBottom: '10px' } });
    typeField.appendChild(el('label', { class: 'field-label', text: 'Deposit to book' }));
    var typeSel = el('select', { class: 'input' }, [
      el('option', { value: 'none', text: 'No deposit' }),
      el('option', { value: 'percent', text: 'Percent of quote' }),
      el('option', { value: 'fixed', text: 'Fixed amount' }),
    ]);
    typeSel.value = ['none', 'percent', 'fixed'].indexOf(booking.depositType) > -1 ? booking.depositType : 'none';
    typeField.appendChild(typeSel);
    sub.appendChild(typeField);

    var amtField = el('div', { class: 'field', style: { marginBottom: '4px' } });
    var amtLabel = el('label', { class: 'field-label', text: 'Amount' });
    amtField.appendChild(amtLabel);
    var amtInput = el('input', { class: 'input', type: 'number', min: '0', step: '0.01' });
    amtInput.value = (typeof booking.depositValue === 'number' && booking.depositValue > 0) ? String(booking.depositValue) : '';
    amtField.appendChild(amtInput);
    var amtHint = el('span', { class: 'field-hint', text: '' });
    amtField.appendChild(amtHint);
    sub.appendChild(amtField);

    function syncAmtUi() {
      var t = typeSel.value;
      amtField.style.display = t === 'none' ? 'none' : 'block';
      if (t === 'percent') { amtLabel.textContent = 'Percent of quote (%)'; amtInput.setAttribute('max', '100'); amtHint.textContent = 'e.g. 10 = 10% of the quoted total.'; }
      else if (t === 'fixed') { amtLabel.textContent = 'Fixed amount ($)'; amtInput.removeAttribute('max'); amtHint.textContent = 'A flat dollar deposit, regardless of quote size.'; }
    }
    syncAmtUi();

    function saveBooking() {
      var t = typeSel.value;
      var v = parseFloat(amtInput.value);
      if (!isFinite(v) || v < 0) v = 0;
      if (t === 'percent' && v > 100) v = 100;
      if (t === 'none') v = 0;
      var payload = { depositType: t, depositValue: v };
      saveBrandPatch({ featuresJson: { booking: payload } }).then(function () {
        feats.booking = payload;
        toastOk('Saved');
      }).catch(toastErr);
    }
    typeSel.addEventListener('change', function () { syncAmtUi(); saveBooking(); });
    amtInput.addEventListener('blur', saveBooking);

    cb.addEventListener('change', function () {
      var next = cb.checked;
      saveBrandPatch({ featuresJson: { quoteBooking: next } }).then(function () {
        feats.quoteBooking = next;
        sub.style.display = next ? 'block' : 'none';
        toastOk('Saved');
      }).catch(function (e) { cb.checked = !next; toastErr(e); });
    });

    wrap.appendChild(sub);
    return wrap;
  }

  // Automated follow-up + promo (Wave 1). Master on/off toggle for
  // followUp.enabled, with ALL cadence/customization settings folded away
  // (collapsed by default) to keep the surface clean. The nested `followUp`
  // object saves through the merge-PUT, so it never drops sibling feature keys.
  // Marketing model: 3 touches (nudge → reminder → discount), the discount
  // saved for the LAST touch, auto-stops on book/reply/unsubscribe. The
  // scheduler/sender + promo-code CRUD land in a LATER wave — this configures
  // the shape and shells the promo UI only.
  var FU_PRESETS = {
    gentle: { day1: 3, day2: 7, day3: 12, discountPct: 5 },
    standard: { day1: 2, day2: 5, day3: 9, discountPct: 8 },
    assertive: { day1: 1, day2: 3, day3: 6, discountPct: 10 },
  };
  function brandFollowUpConfig(b) {
    if (!b.featuresJson) b.featuresJson = {};
    var feats = b.featuresJson;
    var stored = (feats.followUp && typeof feats.followUp === 'object') ? feats.followUp : {};
    var presets = ['gentle', 'standard', 'assertive', 'custom'];
    var std = FU_PRESETS.standard;
    // Working state — the effective config the UI edits + saves.
    var fu = {
      enabled: stored.enabled === true,
      preset: presets.indexOf(stored.preset) > -1 ? stored.preset : 'standard',
    };
    // Custom cadence store (seeded from stored custom values, else standard).
    var custom = {
      day1: intOr(stored.day1, std.day1),
      day2: intOr(stored.day2, std.day2),
      day3: intOr(stored.day3, std.day3),
      discountPct: intOr(stored.discountPct, std.discountPct),
    };
    function intOr(v, d) { var n = parseInt(v, 10); return isFinite(n) && n >= 0 ? n : d; }

    // Tenant-customizable COPY — per-touch intro, an optional contact block, and
    // a signature. Seeded from stored values; empty ⇒ the email templates render
    // their own carrier-branded defaults. Saved into the same followUp bag.
    function strOr(v) { return typeof v === 'string' ? v : ''; }
    var copy = {
      intro1: strOr(stored.intro1),
      intro2: strOr(stored.intro2),
      intro3: strOr(stored.intro3),
      showContact: stored.showContact === true,
      contactPhone: strOr(stored.contactPhone),
      contactEmail: strOr(stored.contactEmail),
      signature: strOr(stored.signature),
    };

    function buildPayload() {
      var base;
      if (fu.preset === 'custom') {
        base = { enabled: fu.enabled, preset: 'custom', day1: custom.day1, day2: custom.day2, day3: custom.day3, discountPct: custom.discountPct };
      } else {
        var p = FU_PRESETS[fu.preset] || std;
        base = { enabled: fu.enabled, preset: fu.preset, day1: p.day1, day2: p.day2, day3: p.day3, discountPct: p.discountPct };
      }
      // Only include copy fields that carry a value, so the resolved config
      // stays sparse and the templates own every default.
      base.showContact = copy.showContact;
      if (copy.intro1.trim()) base.intro1 = copy.intro1.trim();
      if (copy.intro2.trim()) base.intro2 = copy.intro2.trim();
      if (copy.intro3.trim()) base.intro3 = copy.intro3.trim();
      if (copy.contactPhone.trim()) base.contactPhone = copy.contactPhone.trim();
      if (copy.contactEmail.trim()) base.contactEmail = copy.contactEmail.trim();
      if (copy.signature.trim()) base.signature = copy.signature.trim();
      return base;
    }
    function save() {
      var payload = buildPayload();
      saveBrandPatch({ featuresJson: { followUp: payload } }).then(function () {
        feats.followUp = payload; toastOk('Saved');
      }).catch(toastErr);
    }
    function effectiveCadence() {
      return fu.preset === 'custom' ? custom : (FU_PRESETS[fu.preset] || std);
    }

    var wrap = el('div');

    // ── Master on/off toggle ───────────────────────────────────────────
    var toggleRow = el('label', {
      style: {
        display: 'flex', gap: '12px', alignItems: 'flex-start',
        padding: '12px 0', borderTop: '1px solid var(--border)', cursor: 'pointer',
      },
    });
    var cb = el('input', { type: 'checkbox', style: { marginTop: '3px', flex: '0 0 auto' } });
    cb.checked = fu.enabled;
    var toggleTxt = el('div', { style: { flex: '1 1 auto' } }, [
      el('div', { text: 'Auto-follow-up leads who don’t book', style: { fontWeight: '600' } }),
      el('div', {
        class: 'field-hint',
        text: 'Sends up to 3 touches to a customer who got a quote but didn’t book: a gentle nudge, then a reminder, then a discount. Auto-stops the moment they book, reply, or unsubscribe.',
        style: { marginTop: '2px' },
      }),
    ]);
    toggleRow.appendChild(cb);
    toggleRow.appendChild(toggleTxt);
    wrap.appendChild(toggleRow);

    // ── Fold: everything else lives under the folding button ────────────
    var fold = el('details', { style: { marginTop: '8px' } });
    var sum = el('summary', {
      style: {
        cursor: 'pointer', fontWeight: '700', fontSize: '13px', color: 'var(--ink)',
        padding: '12px', borderRadius: '10px', background: 'var(--surface)',
        border: '1px solid var(--border)', userSelect: 'none', listStyle: 'none',
      },
    });
    sum.appendChild(el('span', { text: 'Cadence & discount settings' }));
    sum.appendChild(el('span', {
      style: { color: 'var(--muted)', fontWeight: '500', fontSize: '12px', marginLeft: '8px' },
      text: '— pick a pace, set your discount, add a promo code',
    }));
    fold.appendChild(sum);

    var foldBody = el('div', { style: { paddingTop: '16px' } });

    // ── Preset tiles (radio-style; selected = OUTLINE, never a bright fill) ─
    foldBody.appendChild(el('div', { class: 'field-label', text: 'Cadence', style: { marginBottom: '8px' } }));
    var tileRow = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' } });
    var tiles = {};
    function tileSub(key) {
      if (key === 'custom') return 'Set your own timing + discount';
      var p = FU_PRESETS[key];
      return 'Days ' + p.day1 + ' · ' + p.day2 + ' · ' + p.day3 + '  ·  ' + p.discountPct + '% off';
    }
    function makeTile(key, title) {
      var tile = el('div', {
        style: {
          flex: '1 1 140px', minWidth: '140px', boxSizing: 'border-box', cursor: 'pointer',
          padding: '12px', borderRadius: '10px', border: '2px solid var(--border)',
          background: 'var(--surface)',
        },
      });
      tile.appendChild(el('div', { text: title, style: { fontWeight: '700', fontSize: '13px', color: 'var(--ink)' } }));
      tile.appendChild(el('div', { text: tileSub(key), style: { marginTop: '4px', fontSize: '12px', color: 'var(--muted)', lineHeight: '1.5' } }));
      tile.addEventListener('click', function () { selectPreset(key, true); });
      tiles[key] = tile;
      return tile;
    }
    tileRow.appendChild(makeTile('gentle', 'Gentle'));
    tileRow.appendChild(makeTile('standard', 'Standard'));
    tileRow.appendChild(makeTile('assertive', 'Assertive'));
    tileRow.appendChild(makeTile('custom', 'Custom'));
    foldBody.appendChild(tileRow);

    // ── Custom inputs (only visible when preset = custom) ───────────────
    // Field with the title in-field (label) + help cue TOP-RIGHT + 2px gaps.
    function numField(labelText, hintText, value, min, max, onCommit) {
      var f = el('div', { class: 'field', style: { marginBottom: '2px', flex: '1 1 90px', minWidth: '90px' } });
      var head = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px' } });
      head.appendChild(el('label', { class: 'field-label', text: labelText }));
      if (hintText) head.appendChild(el('span', { class: 'field-hint', text: hintText, style: { marginTop: '0' } }));
      f.appendChild(head);
      var inp = el('input', { class: 'input', type: 'number', min: String(min), max: String(max), step: '1' });
      inp.value = String(value);
      inp.addEventListener('blur', function () { onCommit(inp); });
      f.appendChild(inp);
      return { field: f, input: inp };
    }
    var customWrap = el('div', {
      style: {
        display: fu.preset === 'custom' ? 'block' : 'none',
        margin: '4px 0 16px 0', padding: '12px', borderRadius: '10px',
        border: '1px dashed var(--border)', background: 'var(--surface)',
      },
    });
    var daysRow = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' } });
    var d1, d2, d3, disc;
    function clampInt(v, lo, hi, d) { var n = parseInt(v, 10); if (!isFinite(n)) return d; return Math.min(hi, Math.max(lo, n)); }
    function commitCustom() {
      // Enforce 1 ≤ day1 < day2 < day3 ≤ 30 and discount 0–90; reflect back.
      custom.day1 = clampInt(d1.input.value, 1, 28, custom.day1);
      custom.day2 = clampInt(d2.input.value, custom.day1 + 1, 29, custom.day2);
      custom.day3 = clampInt(d3.input.value, custom.day2 + 1, 30, custom.day3);
      custom.discountPct = clampInt(disc.input.value, 0, 90, custom.discountPct);
      d1.input.value = String(custom.day1);
      d2.input.value = String(custom.day2);
      d3.input.value = String(custom.day3);
      disc.input.value = String(custom.discountPct);
      syncPromoPrefill();
      save();
    }
    d1 = numField('1st touch (day)', '1–30', custom.day1, 1, 30, commitCustom);
    d2 = numField('2nd touch (day)', 'after 1st', custom.day2, 1, 30, commitCustom);
    d3 = numField('3rd touch (day)', 'the discount', custom.day3, 1, 30, commitCustom);
    daysRow.appendChild(d1.field);
    daysRow.appendChild(d2.field);
    daysRow.appendChild(d3.field);
    customWrap.appendChild(daysRow);
    disc = numField('Discount on the 3rd touch (%)', '0–90', custom.discountPct, 0, 90, commitCustom);
    customWrap.appendChild(disc.field);
    foldBody.appendChild(customWrap);

    function selectPreset(key, doSave) {
      fu.preset = key;
      presets.forEach(function (p) {
        var t = tiles[p];
        if (!t) return;
        var on = p === key;
        t.style.borderColor = on ? 'var(--accent)' : 'var(--border)';
        t.style.background = on ? 'var(--accent-soft)' : 'var(--surface)';
      });
      customWrap.style.display = key === 'custom' ? 'block' : 'none';
      syncPromoPrefill();
      if (doSave) save();
    }

    // ── Message, contact & signature ───────────────────────────────────
    // Tenant-editable copy for the three touches + an optional contact block +
    // a signature. Empty fields fall back to the built-in carrier-branded copy.
    var copySec = el('div', { style: { marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border)' } });
    copySec.appendChild(el('div', { class: 'field-label', text: 'Message & signature', style: { marginBottom: '4px' } }));
    copySec.appendChild(el('div', {
      class: 'field-hint',
      text: 'Personalize each email’s opening line. Leave any blank to use our written-for-you copy. Your carrier name, the quote details, and the price are always filled in automatically.',
      style: { marginBottom: '12px' },
    }));

    // Field with the title in-field + help cue top-right + 2px gap (matches numField).
    function textField(labelText, hintText, value, placeholder, maxLen, onCommit) {
      var f = el('div', { class: 'field', style: { marginBottom: '12px' } });
      var head = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px' } });
      head.appendChild(el('label', { class: 'field-label', text: labelText }));
      if (hintText) head.appendChild(el('span', { class: 'field-hint', text: hintText, style: { marginTop: '0' } }));
      f.appendChild(head);
      var inp = el('textarea', { class: 'input', rows: '2', placeholder: placeholder || '', style: { resize: 'vertical', minHeight: '48px' } });
      if (maxLen) inp.maxLength = maxLen;
      inp.value = value || '';
      inp.addEventListener('blur', function () { onCommit(inp.value); });
      f.appendChild(inp);
      return f;
    }
    copySec.appendChild(textField('1st email — gentle nudge', 'opening line', copy.intro1,
      'e.g. Hi {name}, just checking in on your quote — happy to lock it in whenever you’re ready.', 600,
      function (v) { copy.intro1 = v; save(); }));
    copySec.appendChild(textField('2nd email — reminder', 'opening line', copy.intro2,
      'e.g. Your rate is still held. Rates move fast — let’s get you booked.', 600,
      function (v) { copy.intro2 = v; save(); }));
    copySec.appendChild(textField('3rd email — discount', 'opening line', copy.intro3,
      'e.g. Here’s a little off to get your load rolling.', 600,
      function (v) { copy.intro3 = v; save(); }));

    // Contact block — a checkbox to include it + phone/email inputs.
    var contactToggle = el('label', {
      style: { display: 'flex', gap: '12px', alignItems: 'flex-start', padding: '8px 0', cursor: 'pointer' },
    });
    var contactCb = el('input', { type: 'checkbox', style: { marginTop: '3px', flex: '0 0 auto' } });
    contactCb.checked = copy.showContact;
    contactToggle.appendChild(contactCb);
    contactToggle.appendChild(el('div', { style: { flex: '1 1 auto' } }, [
      el('div', { text: 'Add a contact line to every email', style: { fontWeight: '600' } }),
      el('div', { class: 'field-hint', text: 'Shows “Questions? Reach us at …” with the number and address below.', style: { marginTop: '2px' } }),
    ]));
    copySec.appendChild(contactToggle);

    var contactWrap = el('div', {
      style: {
        display: copy.showContact ? 'flex' : 'none', flexWrap: 'wrap', gap: '8px',
        margin: '4px 0 12px 0', padding: '12px', borderRadius: '10px',
        border: '1px dashed var(--border)', background: 'var(--surface)',
      },
    });
    function plainField(labelText, value, placeholder, type, maxLen, onCommit) {
      var f = el('div', { class: 'field', style: { marginBottom: '0', flex: '1 1 160px', minWidth: '160px' } });
      f.appendChild(el('label', { class: 'field-label', text: labelText }));
      var inp = el('input', { class: 'input', type: type || 'text', placeholder: placeholder || '' });
      if (maxLen) inp.maxLength = maxLen;
      inp.value = value || '';
      inp.addEventListener('blur', function () { onCommit(inp.value); });
      f.appendChild(inp);
      return f;
    }
    contactWrap.appendChild(plainField('Phone', copy.contactPhone, 'e.g. (562) 555-0100', 'tel', 40,
      function (v) { copy.contactPhone = v; save(); }));
    contactWrap.appendChild(plainField('Email', copy.contactEmail, 'e.g. dispatch@yourco.com', 'email', 120,
      function (v) { copy.contactEmail = v; save(); }));
    copySec.appendChild(contactWrap);
    contactCb.addEventListener('change', function () {
      copy.showContact = contactCb.checked;
      contactWrap.style.display = copy.showContact ? 'flex' : 'none';
      save();
    });

    copySec.appendChild(textField('Signature', 'sign-off line', copy.signature,
      'e.g. Sam — Dispatch, Harbor Link Logistics', 200,
      function (v) { copy.signature = v; save(); }));
    foldBody.appendChild(copySec);

    // ── Preview ─────────────────────────────────────────────────────────
    // Renders a touch with the CURRENT settings via the same template the cron
    // sends, so what's shown here is exactly what ships. Uses the saved config,
    // so blur-saves land before previewing.
    var previewSec = el('div', { style: { marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border)' } });
    previewSec.appendChild(el('div', { class: 'field-label', text: 'Preview', style: { marginBottom: '4px' } }));
    previewSec.appendChild(el('div', {
      class: 'field-hint',
      text: 'See exactly what each email looks like with a sample quote.',
      style: { marginBottom: '12px' },
    }));
    var previewBtns = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' } });
    var previewNote = el('div', { class: 'field-hint', style: { display: 'none', marginBottom: '8px' } });
    var previewFrame = el('iframe', {
      style: {
        display: 'none', width: '100%', height: '520px', border: '1px solid var(--border)',
        borderRadius: '10px', background: 'var(--surface)',
      },
    });
    previewFrame.setAttribute('sandbox', ''); // render HTML inert — no scripts, no navigation
    previewFrame.setAttribute('title', 'Follow-up email preview');
    function loadPreview(touch, label) {
      previewNote.style.display = 'none';
      api('/api/tenant/follow-up/preview?touch=' + encodeURIComponent(touch)).then(function (r) {
        if (!r || !r.html) {
          previewFrame.style.display = 'none';
          previewNote.textContent = (r && r.note) || 'Nothing to preview for this touch.';
          previewNote.style.display = 'block';
          return;
        }
        previewFrame.srcdoc = r.html;
        previewFrame.style.display = 'block';
      }).catch(toastErr);
    }
    [['nudge', 'Preview nudge'], ['reminder', 'Preview reminder'], ['discount', 'Preview discount']].forEach(function (pair) {
      var b = el('button', { class: 'btn', text: pair[1], style: { flex: '0 0 auto' } });
      b.addEventListener('click', function () { loadPreview(pair[0], pair[1]); });
      previewBtns.appendChild(b);
    });
    previewSec.appendChild(previewBtns);
    previewSec.appendChild(previewNote);
    previewSec.appendChild(previewFrame);
    foldBody.appendChild(previewSec);

    // ── Promo-code sub-section (UI shell — CRUD routes land in a later wave) ─
    var promoSec = el('div', { style: { marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border)' } });
    promoSec.appendChild(el('div', { class: 'field-label', text: 'Discount promo code', style: { marginBottom: '4px' } }));
    promoSec.appendChild(el('div', {
      class: 'field-hint',
      text: 'The 3rd email (the discount) only sends when you have an active promo code. Add one below.',
      style: { marginBottom: '12px' },
    }));

    var promoForm = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'flex-end', marginBottom: '12px' } });
    var codeF = el('div', { class: 'field', style: { marginBottom: '0', flex: '2 1 160px', minWidth: '160px' } });
    codeF.appendChild(el('label', { class: 'field-label', text: 'Code' }));
    var codeInput = el('input', { class: 'input', type: 'text', placeholder: 'e.g. SAVE8' });
    codeF.appendChild(codeInput);
    promoForm.appendChild(codeF);

    var pctF = el('div', { class: 'field', style: { marginBottom: '0', flex: '1 1 90px', minWidth: '90px' } });
    pctF.appendChild(el('label', { class: 'field-label', text: '% off' }));
    var pctInput = el('input', { class: 'input', type: 'number', min: '0', max: '90', step: '1' });
    pctF.appendChild(pctInput);
    promoForm.appendChild(pctF);

    var addBtn = el('button', { class: 'btn btn-primary', text: 'Add promo code', style: { flex: '0 0 auto' } });
    promoForm.appendChild(addBtn);
    promoSec.appendChild(promoForm);

    var promoList = el('div', {});
    function renderPromoEmpty() {
      promoList.innerHTML = '';
      promoList.appendChild(el('div', { class: 'field-hint', text: 'No promo codes yet.' }));
    }
    renderPromoEmpty();
    var promoChips = [];
    function renderPromoList() {
      if (!promoChips.length) { renderPromoEmpty(); return; }
      promoList.innerHTML = '';
      promoChips.forEach(function (pc) {
        var chip = el('div', {
          style: {
            display: 'inline-flex', alignItems: 'center', gap: '8px', marginRight: '8px', marginBottom: '8px',
            padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface)',
            fontSize: '13px', color: 'var(--ink)', fontWeight: '600',
          },
        });
        chip.appendChild(el('span', { text: pc.code, style: { fontFamily: 'ui-monospace, Menlo, monospace' } }));
        chip.appendChild(el('span', { text: pc.percentOff + '% off', style: { color: 'var(--muted)', fontWeight: '500' } }));
        promoList.appendChild(chip);
      });
    }
    function syncPromoPrefill() {
      // Prefill the %off with the selected cadence's suggested discount.
      if (document.activeElement !== pctInput) pctInput.value = String(effectiveCadence().discountPct);
    }
    syncPromoPrefill();

    addBtn.addEventListener('click', function () {
      var code = (codeInput.value || '').trim().toUpperCase();
      var pct = clampInt(pctInput.value, 0, 90, effectiveCadence().discountPct);
      if (!code) { toast('Enter a promo code first', 'warn'); return; }
      // Optimistically show it in the shell so the UI is demonstrable now; the
      // real CRUD persistence lands in a later wave. Fire the POST at the
      // (not-yet-existing) route; swallow its absence quietly for this wave.
      promoChips.push({ code: code, percentOff: pct });
      renderPromoList();
      codeInput.value = '';
      toastOk('Promo added');
      api('/api/tenant/promo-codes', { method: 'POST', body: { code: code, percentOff: pct } })
        .catch(function () { /* route lands in a later wave — expected 404 for now */ });
    });
    promoSec.appendChild(promoList);
    foldBody.appendChild(promoSec);

    fold.appendChild(foldBody);
    wrap.appendChild(fold);

    // Initial selected-tile paint.
    selectPreset(fu.preset, false);

    cb.addEventListener('change', function () {
      fu.enabled = cb.checked;
      save();
    });

    return wrap;
  }
  // Preview card — show the live widget so brand changes are visible
  // without opening a new tab. Points at the signed owner-preview URL
  // (same as Customize) so the real calculator renders here even for a
  // PRIVATE tenant — and so the frame is never blank (the bare directLink
  // root serves the landing page, not the widget, on hosts without a
  // subdomain).
  function buildWidgetPreviewCard(directLink, previewUrl) {
    var preview = el('div', { class: 'card' });
    preview.appendChild(el('div', { class: 'card-title', text: 'Live preview' }));
    preview.appendChild(el('div', { class: 'card-subtitle', text: 'This is exactly what your customers see at ' + (directLink || '') }));
    var iframe = el('iframe', {
      src: previewUrl + (previewUrl.indexOf('?') > -1 ? '&' : '?') + 'embed=1&preview=1',
      style: {
        width: '100%',
        height: '680px',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        marginTop: '8px',
        background: '#fff',
      },
      loading: 'lazy',
      title: 'QuoteFleet widget preview',
    });
    preview.appendChild(iframe);
    var openBtn0 = el('a', {
      href: directLink || '#',
      target: '_blank',
      rel: 'noopener',
      class: 'btn btn-secondary',
      text: 'Open in new tab ↗',
      style: { marginTop: '10px', display: 'inline-flex' },
    });
    preview.appendChild(openBtn0);
    return preview;
  }

  // ── Behavior tab — the calculator's behaviour + copy controls ───────────
  // Merged into the Customize workspace (Alex's choice): the old standalone
  // Widget-settings page is retired; these controls now live behind the
  // "Behavior" tab and share the ONE live preview passed in. `container` is the
  // tab panel, `b` the already-loaded brand object, `access` the access config,
  // and `preview` the shared buildLivePreview handle (visible-facing saves call
  // preview.notifySaved via notifyBrandPreview, so the preview re-skins live).
  function buildBehaviorPanel(container, b, access, preview) {
    activeBrandPreview = preview || null;
    var c = container;

      // Plan gate for the "Powered by" badge (removing it is a Vital+ perk;
      // trialing tenants resolve to Pro and pass). Mirrors the backend gate.
      var meTenant = (state.me && state.me.tenant) || {};
      var meTrial = (state.me && state.me.trial) || null;
      var meRole = (state.me && state.me.user && state.me.user.role) || '';
      var hasCore =
        meRole === 'super_admin' ||
        (meTrial && meTrial.status === 'trial') ||
        meTenant.plan === 'vital' ||
        meTenant.plan === 'pro';

      // Card 1 — Lead capture & copy.
      var lc = el('div', { class: 'card qf-cz-section', style: { marginTop: '0' } });
      lc.appendChild(el('div', { class: 'card-title', text: 'Lead capture & copy' }));
      lc.appendChild(el('div', { class: 'card-subtitle', text: 'Control what contact details a customer must provide and the copy shown on your widget.' }));
      lc.appendChild(brandSettingToggle(b,
        'Require email',
        'requireEmail',
        true,
        'When on, a lead cannot be submitted without an email address.'
      ));
      lc.appendChild(brandSettingToggle(b,
        'Require phone',
        'requirePhone',
        false,
        'When on, a lead cannot be submitted without a phone number. Useful if you prefer to call back.'
      ));
      lc.appendChild(brandSettingToggle(b,
        'Show price before asking for contact info',
        'showQuoteBeforeContact',
        false,
        'When on, the customer sees the quoted price first; contact details are asked only when they click “Claim this quote”.'
      ));
      // Powered-by toggle (plan-gated: removing the badge needs Vital+).
      lc.appendChild(brandSettingToggle(b,
        'Show “Powered by QuoteFleet” footer',
        'showPoweredBy',
        true,
        hasCore
          ? 'Turn off to remove QuoteFleet branding from the bottom of your widget.'
          : 'Removing the QuoteFleet badge is a Vital plan feature — upgrade to hide it.',
        { allowed: hasCore, upgradeMsg: 'Removing the “Powered by” badge is a Vital feature — upgrade to hide it.' }
      ));
      // Copy fields sit below the toggles, separated by a hairline.
      var copyWrap = el('div', { style: { marginTop: '14px', paddingTop: '14px', borderTop: '1px solid var(--border)' } });
      copyWrap.appendChild(brandSettingField(b, 'CTA button text', 'ctaText', {
        placeholder: 'Get instant quote',
        hint: 'The label on your widget’s main call-to-action button.',
      }));
      copyWrap.appendChild(brandSettingField(b, 'Confirm-rate button', 'claimCtaText', {
        placeholder: 'Get the rate confirmed',
        hint: 'The button under the estimate that opens the contact form to lock in the rate. Leave blank for the default.',
      }));
      copyWrap.appendChild(brandSettingField(b, 'Footer note', 'footerNote', {
        textarea: true,
        placeholder: 'e.g. Quotes are estimates — final pricing confirmed by our team.',
        hint: 'Optional line shown under the widget (e.g. a disclaimer or hours).',
      }));
      lc.appendChild(copyWrap);
      c.appendChild(lc);

      // Card 1b — Lead notifications & quote validity (routing + how long a quote holds).
      var routing = el('div', { class: 'card qf-cz-section' });
      routing.appendChild(el('div', { class: 'card-title', text: 'Lead notifications & quotes' }));
      routing.appendChild(el('div', { class: 'card-subtitle', text: 'Where new quote requests are sent, and how long each quote stays valid.' }));
      routing.appendChild(brandSettingField(b, 'Send new leads to', 'leadEmailTo', {
        placeholder: 'you@company.com',
        hint: 'The inbox that gets each quote request. Leave blank to use your account email.',
      }));
      routing.appendChild(brandSettingField(b, 'CC your team', 'leadEmailCc', {
        placeholder: 'dispatch@company.com, sales@company.com',
        hint: 'Comma-separated — copy additional people on every lead notification.',
      }));
      routing.appendChild(brandSettingField(b, 'Quotes valid for (days)', 'quoteValidityDays', {
        placeholder: '30',
        hint: 'How long the “Valid until” date on each quote lasts. Leave blank for the default (30 days).',
      }));
      c.appendChild(routing);

      // Card 2 — Quote actions (customer share / email / print / PDF bar).
      var qa = el('div', { class: 'card', style: { marginTop: '14px' } });
      qa.appendChild(el('div', { class: 'card-title', text: 'Quote actions' }));
      qa.appendChild(el('div', { class: 'card-subtitle', text: 'Let customers send and save their quote straight from your widget.' }));
      qa.appendChild(brandFeatureToggle(b,
        'Let customers share / email / print / download the quote',
        'quoteShare',
        true,
        'Adds an action bar under the quote with “Email me this quote”, “Share with others”, Print, and Download PDF. Turn off to hide it.'
      ));
      qa.appendChild(brandFeatureToggle(b,
        'Show the confidence + estimated-range panel',
        'showConfidenceKpi',
        true,
        'Adds a panel under the total with a confidence pill (High / Medium), an estimated price range, and a “Valid until” date. Turn off to show just the total and line items.'
      ));
      // "Book this load" + per-tenant deposit config (default OFF).
      qa.appendChild(brandBookingConfig(b));
      c.appendChild(qa);

      // Card 3 — Automated follow-up + promo (default OFF, opt-in).
      var fuCard = el('div', { class: 'card', style: { marginTop: '14px' } });
      fuCard.appendChild(el('div', { class: 'card-title', text: 'Automated follow-up' }));
      fuCard.appendChild(el('div', { class: 'card-subtitle', text: 'Win back customers who got a quote but didn’t book — with a short, polite email sequence that stops the moment they respond.' }));
      fuCard.appendChild(brandFollowUpConfig(b));
      c.appendChild(fuCard);

      // Card 4 — Access (public vs private invite-only calculator).
      var accCard = el('div', { class: 'card', style: { marginTop: '14px' } });
      c.appendChild(accCard);
      renderAccessCard(accCard, access);
  }

  function renderEmbed(c) {
    Promise.all([
      api('/api/tenant/embed'),
      api('/api/tenant/brand'),
      api('/api/tenant/preview-url'),
    ]).then(function (results) {
      var d = results[0];
      var b = (results[1] && results[1].brand) || {};
      var previewUrl = (results[2] && results[2].previewUrl) || (d.directLink || '/');
      c.innerHTML = '';
      // De-clutter marker — the scoped :has() net in embed-panel.css hides the
      // legacy injected clutter (launch workspace, setup coach, share-readiness,
      // preview-publish mock) on this page only; the JS injectors are also
      // guarded to skip /app/embed. Same pattern as Customize + Add-ons.
      var root = el('div', { class: 'qf-embed', 'data-qf-embed': '1' });
      c.appendChild(root);
      c = root;
      c.appendChild(el('h1', { text: 'Embed code' }));
      c.appendChild(el('p', { class: 'page-sub', text: 'Drop one line of HTML on any page of your website — and see it live on the right.' }));

      // Same split layout as Customize: install artifacts on the LEFT, the ONE
      // shared live preview on the RIGHT (Alex kept Embed as its own page). The
      // preview reuses buildLivePreview, so it benefits from no-blink apply,
      // auto-height, and the device + host toggles for free.
      var layout = el('div', { class: 'qf-cz-layout' });
      var leftCol = el('div', { class: 'qf-cz-controls' });
      var preview = buildLivePreview({ previewUrl: previewUrl, openHref: d.directLink || previewUrl });
      activeBrandPreview = preview;
      layout.appendChild(leftCol);
      layout.appendChild(preview.col);
      c.appendChild(layout);
      // Every install card below appends into the left column.
      c = leftCol;

      // Lead capture / copy / access live on the Customize workspace's Behavior
      // tab — this page keeps the install artifacts only.

      // Embedding (allowed domains) — lives in the Advanced expander
      // because it governs where the snippet is allowed to run.
      var emb = el('div', { class: 'card', style: { marginTop: '14px' } });
      emb.appendChild(el('div', { class: 'card-title', text: 'Widget settings — embedding' }));
      emb.appendChild(el('div', { class: 'card-subtitle', text: 'Restrict which websites are allowed to load your widget. Leave blank to allow any site.' }));
      emb.appendChild(brandSettingField(b, 'Allowed domains', 'allowedDomains', {
        placeholder: 'acmeco.com, acmeco.ca',
        hint: 'Comma-separated list of domains permitted to embed the widget. Blank = no restriction.',
      }));
      // NOTE: emb is re-parented into the Advanced expander at the end.

      var card = el('div', { class: 'card', style: { marginTop: '14px' } });
      card.appendChild(el('div', { class: 'card-title', text: 'Recommended — JS embed (auto-resize)' }));
      var pre = el('div', { class: 'code', text: d.snippet });
      card.appendChild(pre);
      var copy = el('button', { class: 'btn btn-primary', text: 'Copy snippet', style: { marginTop: '8px' } });
      copy.addEventListener('click', function () {
        copyText(d.snippet).then(function () {
          copy.textContent = 'Copied ✓';
          toastOk('Copied to clipboard');
          setTimeout(function () { copy.textContent = 'Copy snippet'; }, 1500);
        }).catch(function () { toastErr(new Error('Could not copy automatically — select the snippet and press Ctrl/⌘-C.')); });
      });
      card.appendChild(copy);
      c.appendChild(card);

      var card2 = el('div', { class: 'card', style: { marginTop: '14px' } });
      card2.appendChild(el('div', { class: 'card-title', text: 'Iframe-only (fallback)' }));
      card2.appendChild(el('div', { class: 'code', text: d.iframeFallback }));
      // NOTE: card2 is re-parented into the Advanced expander at the end.

      var card3 = el('div', { class: 'card', style: { marginTop: '14px' } });
      card3.appendChild(el('div', { class: 'card-title', text: 'Direct hosted link' }));
      card3.innerHTML += '<p>Send your customers directly to:</p>';
      card3.appendChild(el('div', { class: 'code', text: d.directLink }));
      var openBtn = el('a', { href: d.directLink, target: '_blank', class: 'btn btn-secondary', text: 'Open public widget ↗', style: { marginTop: '8px', display: 'inline-flex' } });
      card3.appendChild(openBtn);
      c.appendChild(card3);

      var card4 = el('div', { class: 'card', style: { marginTop: '14px' } });
      card4.appendChild(el('div', { class: 'card-title', text: 'Regenerate embed token' }));
      card4.appendChild(el('div', { class: 'card-subtitle', text: 'Existing embeds will stop working. Use only if your token leaked.' }));
      var rg = el('button', { class: 'btn btn-danger', text: 'Regenerate token' });
      rg.addEventListener('click', function () {
        if (!confirm('Regenerate embed token? Existing embeds will break.')) return;
        api('/api/tenant/regenerate-embed', { method: 'POST' }).then(function () { go('embed'); }).catch(toastErr);
      });
      card4.appendChild(rg);

      // ── Advanced (collapsed by default) ──────────────────────────
      // Power-user settings folded behind one expander to keep the
      // default surface focused on preview + snippet + hosted link.
      // Re-parent the already-built cards (moves nodes; preserves their
      // listeners + input state) into a <details>.
      var adv = el('details', { style: { marginTop: '16px' } });
      var sum = el('summary', {
        style: {
          cursor: 'pointer', fontWeight: '700', fontSize: '13px', color: 'var(--ink)',
          padding: '10px 12px', borderRadius: '10px', background: 'var(--surface)',
          border: '1px solid var(--border)', userSelect: 'none',
        },
      });
      sum.appendChild(el('span', { text: 'Advanced' }));
      sum.appendChild(el('span', {
        style: { color: 'var(--muted)', fontWeight: '500', fontSize: '12px', marginLeft: '6px' },
        text: '— allowed domains, iframe fallback, regenerate token',
      }));
      adv.appendChild(sum);
      [emb, card2, card4].forEach(function (sec) { adv.appendChild(sec); });
      c.appendChild(adv);
    }).catch(showErr(c));
  }

  // ── Access control card (public vs private invite-only) ────────
  function renderAccessCard(card, access) {
    card.innerHTML = '';
    card.appendChild(el('div', { class: 'card-title', text: 'Access' }));
    card.appendChild(el('div', { class: 'card-subtitle', text: 'Choose who can open your rate calculator.' }));

    var mode = access.accessMode === 'private' ? 'private' : 'public';

    function optionRow(value, title, desc) {
      var wrap = el('label', { style: { display: 'flex', gap: '12px', alignItems: 'flex-start', padding: '12px 0', borderTop: '1px solid var(--border)', cursor: 'pointer' } });
      var r = el('input', { type: 'radio', name: 'qf-access-mode', style: { marginTop: '3px', flex: '0 0 auto' } });
      r.value = value; r.checked = (mode === value);
      r.addEventListener('change', function () {
        if (!r.checked) return;
        api('/api/tenant/access', { method: 'PUT', body: { accessMode: value } }).then(function () {
          access.accessMode = value; toastOk('Saved'); renderAccessCard(card, access);
        }).catch(function (e) { r.checked = (mode === value); toastErr(e); });
      });
      var txt = el('div', { style: { flex: '1 1 auto' } }, [
        el('div', { text: title, style: { fontWeight: '600' } }),
        el('div', { class: 'field-hint', text: desc, style: { marginTop: '2px' } }),
      ]);
      wrap.appendChild(r); wrap.appendChild(txt);
      return wrap;
    }
    card.appendChild(optionRow('public', 'Public', 'Anyone with your link can open the calculator and get a quote.'));
    card.appendChild(optionRow('private', 'Private — invite only', 'Only people you invite (via a unique link) can open the calculator. Everyone else sees a locked page.'));

    if (mode !== 'private') return;

    var sec = el('div', { style: { marginTop: '14px', paddingTop: '14px', borderTop: '1px solid var(--border)' } });
    sec.appendChild(el('div', { text: 'Invite links', style: { fontWeight: '600', marginBottom: '4px' } }));
    sec.appendChild(el('div', { class: 'field-hint', text: 'Create one link per customer. Share it privately. Revoke any time — it stops working immediately.' }));

    var list = el('div', { style: { marginTop: '12px' } });
    sec.appendChild(list);

    function fmtDate(s) { if (!s) return 'never'; try { return new Date(s).toLocaleDateString(); } catch (e) { return 'never'; } }

    function renderList() {
      list.innerHTML = '';
      var links = access.links || [];
      if (!links.length) {
        list.appendChild(el('div', { class: 'field-hint', text: 'No invite links yet. Create one below.' }));
      }
      links.forEach(function (l) {
        var row = el('div', { style: { border: '1px solid var(--border)', borderRadius: '10px', padding: '12px', marginBottom: '8px', opacity: l.active ? '1' : '0.55' } });
        var head = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } });
        head.appendChild(el('div', { text: l.label + (l.active ? '' : ' (revoked)'), style: { fontWeight: '600' } }));
        head.appendChild(el('div', { class: 'field-hint', text: 'Opened ' + (l.useCount || 0) + '× · last ' + fmtDate(l.lastUsedAt) }));
        row.appendChild(head);
        var urlRow = el('div', { style: { display: 'flex', gap: '8px', marginTop: '8px', alignItems: 'center', flexWrap: 'wrap' } });
        var urlBox = el('input', { class: 'input', type: 'text', style: { flex: '1 1 220px', fontSize: '12px' } });
        urlBox.value = l.url; urlBox.readOnly = true;
        urlRow.appendChild(urlBox);
        if (l.active) {
          var copyBtn = el('button', { class: 'btn btn-secondary', text: 'Copy' });
          copyBtn.addEventListener('click', function () { copyText(l.url).then(function () { copyBtn.textContent = 'Copied ✓'; toastOk('Copied'); setTimeout(function () { copyBtn.textContent = 'Copy'; }, 1500); }); });
          urlRow.appendChild(copyBtn);
          var revBtn = el('button', { class: 'btn btn-danger', text: 'Revoke' });
          revBtn.addEventListener('click', function () {
            if (!confirm('Revoke "' + l.label + '"? This link will stop working immediately.')) return;
            api('/api/tenant/access/links/' + l.id + '/revoke', { method: 'POST' }).then(function () {
              l.active = false; toastOk('Revoked'); renderList();
            }).catch(toastErr);
          });
          urlRow.appendChild(revBtn);
        }
        row.appendChild(urlRow);
        list.appendChild(row);
      });
    }
    renderList();

    var createRow = el('div', { style: { display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' } });
    var nameInp = el('input', { class: 'input', type: 'text', placeholder: 'Customer or company name', style: { flex: '1 1 220px' } });
    var createBtn = el('button', { class: 'btn btn-primary', text: '+ Create invite link' });
    createBtn.addEventListener('click', function () {
      var label = (nameInp.value || '').trim();
      if (!label) { toast('Enter a name for the link', 'warn'); nameInp.focus(); return; }
      createBtn.disabled = true;
      api('/api/tenant/access/links', { method: 'POST', body: { label: label } }).then(function (r) {
        access.links = access.links || [];
        access.links.unshift(r.link);
        nameInp.value = ''; createBtn.disabled = false; toastOk('Invite link created'); renderList();
      }).catch(function (e) { createBtn.disabled = false; toastErr(e); });
    });
    createRow.appendChild(nameInp); createRow.appendChild(createBtn);
    sec.appendChild(createRow);
    card.appendChild(sec);
  }

  // ── Audit log ─────────────────────────────────────────────────
  function renderAudit(c) {
    api('/api/tenant/audit').then(function (d) {
      c.innerHTML = '';
      c.appendChild(el('h1', { text: 'Audit log' }));
      c.appendChild(el('p', { class: 'page-sub', text: 'Every change made by you, your team, or the AI agent.' }));
      if (!d.audit.length) {
        c.appendChild(el('p', { class: 'muted', text: 'No edits yet.' }));
        return;
      }
      // qf-leads-table drives the ≤480px stacked-card reflow (lead-queue-search.css):
      // each <td> carries a data-label so the log reads as labelled cards on a
      // phone instead of a 4-column table that scrolls sideways.
      var tbl = el('table', { class: 'table qf-leads-table' });
      tbl.innerHTML = '<thead><tr><th>When</th><th>Action</th><th>By</th><th>Reason / details</th></tr></thead><tbody></tbody>';
      var tb = $('tbody', tbl);
      d.audit.forEach(function (a) {
        var reason = (a.detailsJson && a.detailsJson.reason) ? a.detailsJson.reason : (a.detailsJson ? JSON.stringify(a.detailsJson).slice(0, 140) : '');
        tb.innerHTML += '<tr><td data-label="When"><span class="muted-small">' + fmtDate(a.createdAt) + '</span></td>' +
          '<td data-label="Action"><strong>' + escapeHtml(a.action) + '</strong></td>' +
          '<td data-label="By"><span class="badge ' + (a.actorKind === 'ai_agent' ? 'badge-info' : 'badge-muted') + '">' + escapeHtml(a.actorKind) + '</span></td>' +
          '<td data-label="Reason"><span class="muted-small">' + escapeHtml(reason) + '</span></td></tr>';
      });
      c.appendChild(tbl);
    }).catch(showErr(c));
  }

  // ── helpers ────────────────────────────────────────────────────
  function showErr(c) { return function (err) { c.innerHTML = '<div class="notice error">' + escapeHtml(err.message || 'Failed') + '</div>'; }; }

  // ── Auto-import rates from email (forward/BCC → auto-read) ─────
  // A per-tenant toggle (featuresJson.emailImport). When ON, we expose the
  // tenant's dedicated inbound address + a short benefit description. OFF hides
  // the address entirely. Address + minting are handled server-side by
  // GET /api/tenant/email-import.
  function buildEmailImportCard() {
    var card = el('div', { class: 'card', style: { padding: '14px 18px', marginBottom: '20px' } });
    card.appendChild(el('div', { class: 'card-title', text: 'Auto-import rates from email' }));
    card.appendChild(el('div', {
      class: 'card-subtitle',
      text: 'Forward or BCC your rate emails to a private address and we’ll read them and update your calculator automatically — no logging in.',
    }));

    var toggleRow = el('label', {
      style: {
        display: 'flex', gap: '12px', alignItems: 'flex-start',
        padding: '12px 0', borderTop: '1px solid var(--border)', cursor: 'pointer',
      },
    });
    var cb = el('input', { type: 'checkbox', style: { marginTop: '3px', flex: '0 0 auto' } });
    var toggleTxt = el('div', { style: { flex: '1 1 auto' } }, [
      el('div', { text: 'Turn on email import', style: { fontWeight: '600' } }),
      el('div', {
        class: 'field-hint',
        text: 'New or ambiguous rates are held for a quick review; clean ones apply on their own.',
        style: { marginTop: '2px' },
      }),
    ]);
    toggleRow.appendChild(cb);
    toggleRow.appendChild(toggleTxt);
    card.appendChild(toggleRow);

    var panel = el('div', {
      style: {
        display: 'none', margin: '4px 0 0 30px', paddingTop: '10px',
        borderTop: '1px dashed var(--border)',
      },
    });
    card.appendChild(panel);

    function renderPanel(data) {
      panel.innerHTML = '';
      if (!data || !data.enabled) { panel.style.display = 'none'; return; }
      panel.style.display = 'block';
      panel.appendChild(el('div', {
        text: 'Your rate-import address',
        style: { fontWeight: '600', fontSize: '13px', marginBottom: '6px', color: 'var(--ink)' },
      }));
      var row = el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } });
      var input = el('input', {
        class: 'input', type: 'text', readonly: 'readonly',
        style: { flex: '1 1 260px', fontFamily: 'var(--font-mono)', fontSize: '12px' },
      });
      input.value = data.address || '';
      input.addEventListener('focus', function () { input.select(); });
      var copyBtn = el('button', { class: 'btn btn-secondary', text: 'Copy' });
      copyBtn.addEventListener('click', function () {
        copyText(data.address || '').then(function () {
          copyBtn.textContent = 'Copied ✓'; toastOk('Copied');
          setTimeout(function () { copyBtn.textContent = 'Copy'; }, 1500);
        });
      });
      row.appendChild(input);
      row.appendChild(copyBtn);
      panel.appendChild(row);
      panel.appendChild(el('div', {
        class: 'field-hint',
        style: { marginTop: '8px', lineHeight: '1.5' },
        text: 'Forward or BCC rate emails to this address. We read them and update your calculator automatically — clean rates apply on their own, new or ambiguous ones are held for a quick review.',
      }));
      if (!data.domainConfigured || !data.webhookConfigured) {
        panel.appendChild(el('div', {
          class: 'notice warn',
          style: { marginTop: '10px' },
          text: 'Setup in progress — this address isn’t receiving mail yet. We’ll let you know when it’s live.',
        }));
      }

      // ── Trust model, stated plainly ──────────────────────────────
      panel.appendChild(el('div', {
        style: {
          marginTop: '12px', paddingTop: '10px', borderTop: '1px dashed var(--border)',
          fontWeight: '600', fontSize: '13px', color: 'var(--ink)',
        },
        text: 'Trusted senders',
      }));
      panel.appendChild(el('div', {
        class: 'field-hint',
        style: { marginTop: '4px', lineHeight: '1.5' },
        text: 'The first email from a new sender is held for your review; approve it once and future emails from that sender apply automatically.',
      }));

      // ── Current trusted senders (read + remove) ──────────────────
      var sendersBox = el('div', { style: { marginTop: '10px' } });
      panel.appendChild(sendersBox);
      loadSenders(sendersBox);
    }

    // Fetch + render the trusted-sender allowlist. Each row has a ✕ that revokes
    // auto-apply for that sender (its next email is held for review again). A
    // 403/empty allowlist just shows the calm empty state.
    function loadSenders(box) {
      box.innerHTML = '';
      api('/api/tenant/email-import/senders').then(function (r) {
        renderSenders(box, (r && r.senders) || []);
      }).catch(function () {
        // Non-fatal: the card is still usable without the list.
        box.appendChild(el('div', { class: 'muted-small', text: 'Couldn’t load your trusted senders just now.' }));
      });
    }

    function renderSenders(box, senders) {
      box.innerHTML = '';
      if (!senders.length) {
        box.appendChild(el('div', {
          class: 'muted-small',
          text: 'No trusted senders yet — the first approved email import will add one here.',
        }));
        return;
      }
      var list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
      senders.forEach(function (addr) {
        var row = el('div', {
          class: 'qf-sender-row',
          style: {
            display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'space-between',
            padding: '6px 10px', border: '1px solid var(--border)', borderRadius: '8px',
          },
        });
        row.appendChild(el('span', {
          text: addr,
          style: { fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--ink-soft)', wordBreak: 'break-all' },
        }));
        var rm = el('button', {
          class: 'btn btn-ghost btn-sm',
          text: '✕',
          title: 'Remove ' + addr,
          'aria-label': 'Remove trusted sender ' + addr,
          on: { click: function () {
            rm.disabled = true;
            api('/api/tenant/email-import/senders/' + encodeURIComponent(addr), { method: 'DELETE' })
              .then(function (r) { toastOk('Removed'); renderSenders(box, (r && r.senders) || []); })
              .catch(function (e) { rm.disabled = false; toastErr(e); });
          } },
        });
        row.appendChild(rm);
        list.appendChild(row);
      });
      box.appendChild(list);
    }

    function load() {
      api('/api/tenant/email-import').then(function (data) {
        cb.checked = !!(data && data.enabled);
        renderPanel(data);
      }).catch(function () { /* leave toggle off; card still usable */ });
    }

    cb.addEventListener('change', function () {
      var next = cb.checked;
      saveBrandPatch({ featuresJson: { emailImport: next } }).then(function () {
        toastOk('Saved');
        return api('/api/tenant/email-import'); // mint/get (or clear) the address
      }).then(function (data) { renderPanel(data); }).catch(function (e) {
        cb.checked = !next; toastErr(e);
      });
    });

    load();
    return card;
  }

  // ── AI Import (rate-sheet ingest) ─────────────────────────────
  // Compact "Aug 6, 2:14 PM"-style timestamp for the review provenance line.
  function fmtProvDate(d) {
    if (!d) return 'unknown time';
    try {
      return new Date(d).toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      });
    } catch (e) { return String(d); }
  }

  function renderIngest(c) {
    c.innerHTML = '';
    c.appendChild(el('h1', { text: 'AI import' }));
    c.appendChild(el('p', { class: 'page-sub', text: 'Upload a rate sheet — PDF, image, Excel, email — and the AI extracts rate cards, accessorials, lane zones, and rate matrices for review.' }));

    // Forward-email auto-import (per-tenant toggle + dedicated address).
    c.appendChild(buildEmailImportCard());

    // ── Upload card ────────────────────────────────────────
    var dropCard = el('div', { class: 'card', style: { padding: '14px 18px' } });
    var drop = el('div', {
      class: 'qf-dropzone',
      style: {
        border: '2px dashed var(--border-strong)',
        borderRadius: '12px',
        padding: '36px 20px',
        textAlign: 'center',
        cursor: 'pointer',
        transition: 'border-color 0.15s, background 0.15s',
        color: 'var(--muted)',
      },
      text: '',
    });
    drop.innerHTML = '<div style="font-size:18px; color:var(--ink); margin-bottom:6px;">Drop a rate sheet, or paste a screenshot</div>'
      + '<div style="font-size:13px; color:var(--muted);">PDF · PNG · JPEG · Excel (.xlsx) · Email (.eml) · CSV · Up to 5 MB</div>'
      + '<div style="margin-top:12px; font-family:var(--font-mono); font-size:11px; color:var(--muted-soft); letter-spacing:0.06em;">CLICK TO BROWSE · CTRL/⌘+V TO PASTE</div>';
    var fileInput = el('input', { type: 'file', style: { display: 'none' }, accept: '.pdf,.png,.jpg,.jpeg,.webp,.gif,.xlsx,.xls,.eml,.csv,.txt' });

    drop.appendChild(fileInput);
    drop.addEventListener('click', function () { fileInput.click(); });
    drop.addEventListener('dragover', function (ev) { ev.preventDefault(); drop.style.background = 'var(--accent-soft)'; drop.style.borderColor = 'var(--accent)'; });
    drop.addEventListener('dragleave', function () { drop.style.background = ''; drop.style.borderColor = 'var(--border-strong)'; });
    drop.addEventListener('drop', function (ev) {
      ev.preventDefault(); drop.style.background = ''; drop.style.borderColor = 'var(--border-strong)';
      var f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
      if (f) handleFile(f);
    });
    fileInput.addEventListener('change', function () {
      if (fileInput.files && fileInput.files[0]) handleFile(fileInput.files[0]);
    });
    // Paste a screenshot straight from the clipboard (Ctrl/⌘+V) — the fastest
    // path for a busy owner who just snipped their rate sheet. Scoped to the
    // AI-import page: the handler no-ops once the page is unmounted, and any
    // prior handler is removed so repeat visits don't stack listeners.
    if (window.__qfIngestPaste) document.removeEventListener('paste', window.__qfIngestPaste);
    window.__qfIngestPaste = function (ev) {
      if (!document.getElementById('ingest-review')) return; // page no longer mounted
      var items = (ev.clipboardData && ev.clipboardData.items) || [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.indexOf('image/') === 0) {
          var blob = items[i].getAsFile();
          if (!blob) continue;
          ev.preventDefault();
          var named = blob;
          try { named = new File([blob], 'pasted-rate-sheet.png', { type: blob.type || 'image/png' }); } catch (e) { /* Safari: use the blob as-is */ }
          handleFile(named);
          return;
        }
      }
    };
    document.addEventListener('paste', window.__qfIngestPaste);

    var statusBox = el('div', { style: { marginTop: '14px', minHeight: '24px' } });
    dropCard.appendChild(drop);
    dropCard.appendChild(statusBox);
    c.appendChild(dropCard);

    // ── Recent jobs list ────────────────────────────────
    var listCard = el('div', { class: 'card', style: { marginTop: '20px', padding: '14px 18px' } });
    listCard.appendChild(el('h2', { text: 'Recent uploads', style: { marginBottom: '12px' } }));
    var listBody = el('div', {});
    listCard.appendChild(listBody);
    c.appendChild(listCard);

    // ── Review pane (toggled when a job is selected) ────────
    var reviewBox = el('div', { id: 'ingest-review', style: { marginTop: '20px' } });
    c.appendChild(reviewBox);

    refreshList();

    // Reassuring processing state shown while the parse job runs. Theme-aware
    // spinner (token colors, no literal #fff/#000) + the filename being read.
    // The subtitle cycles through staged microcopy (see startStages) and 3
    // shimmer skeleton rows preview the shape of the rate cards to come.
    function processingHtml(name) {
      return '<div class="qf-ingest-processing" role="status" aria-live="polite">'
        + '<div class="qf-ingest-spinner" aria-hidden="true"></div>'
        + '<div class="qf-ingest-processing-copy">'
        + '<div class="qf-ingest-processing-title">Reading your rate sheet… '
        + '<span class="qf-ingest-file">' + escapeHtml(name) + '</span></div>'
        + '<div class="qf-ingest-processing-sub" data-ingest-stage>Reading your rate sheet…</div>'
        + '</div></div>'
        + '<div class="qf-ingest-progress" aria-hidden="true"><span class="qf-ingest-progress-fill" data-ingest-fill></span></div>'
        + '<div class="qf-ingest-skeleton" aria-hidden="true">'
        + '<div class="qf-ingest-skeleton-row"><span class="qf-skel-line qf-skel-title"></span><span class="qf-skel-line qf-skel-meta"></span></div>'
        + '<div class="qf-ingest-skeleton-row"><span class="qf-skel-line qf-skel-title"></span><span class="qf-skel-line qf-skel-meta"></span></div>'
        + '<div class="qf-ingest-skeleton-row"><span class="qf-skel-line qf-skel-title"></span><span class="qf-skel-line qf-skel-meta"></span></div>'
        + '</div>';
    }

    // Cycle the processing subtitle through timed stages + advance a progress
    // bar so the wait reads like a real multi-stage backend engine, not a
    // frozen spinner. Frontend-driven (independent of backend poll cadence);
    // holds on the final "Building your rate engine…" line with the bar near
    // full (never 100% — the parse isn't done until ready_for_review) and its
    // sheen still sweeping. aria-live on the container announces each stage.
    var stageTimer = null;
    var STAGES = [
      'Reading your rate sheet…',
      'Extracting lane rates & accessorials…',
      'Normalizing equipment & service classes…',
      'Mapping port & terminal zones…',
      'Calibrating fuel-surcharge tables…',
      'Auto-quoting 12 sample lanes…',
      'Validating margins & minimums…',
      'Building your rate engine…',
    ];
    // Cross-fade the stage line: fade out, swap text, fade back in.
    function swapStage(sub, text) {
      sub.classList.add('is-swapping');
      setTimeout(function () {
        var s2 = statusBox.querySelector('[data-ingest-stage]');
        if (s2) { s2.textContent = text; s2.classList.remove('is-swapping'); }
      }, prefersReducedMotion() ? 0 : 200);
    }
    function setStageFill(pct) {
      var f = statusBox.querySelector('[data-ingest-fill]');
      if (f) f.style.width = pct + '%';
    }
    function startStages() {
      stopStages();
      var i = 0;
      setStageFill(Math.round((1 / STAGES.length) * 100)); // seed the first segment
      stageTimer = setInterval(function () {
        var sub = statusBox.querySelector('[data-ingest-stage]');
        if (!sub) { stopStages(); return; }
        i += 1;
        var idx = i < STAGES.length ? i : STAGES.length - 1;
        swapStage(sub, STAGES[idx]);
        // Fill tracks stage progress but caps at 94% — the engine isn't "done"
        // until the poll returns ready_for_review.
        setStageFill(Math.min(94, Math.round(((idx + 1) / STAGES.length) * 100)));
        if (i >= STAGES.length - 1) stopStages(); // reached the final stage — hold
      }, 1050);
    }
    function stopStages() {
      if (stageTimer) { clearInterval(stageTimer); stageTimer = null; }
    }

    function handleFile(file) {
      if (file.size > 5 * 1024 * 1024) {
        statusBox.innerHTML = '<div class="notice error">File is bigger than 5 MB — split it into smaller chunks.</div>';
        return;
      }
      statusBox.innerHTML = '<div class="muted-small">Uploading <strong>' + escapeHtml(file.name) + '</strong>…</div>';
      var reader = new FileReader();
      reader.onload = function () {
        var dataUrl = reader.result || '';
        // strip "data:<mime>;base64," prefix
        var idx = dataUrl.indexOf(',');
        var b64 = idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
        api('/api/tenant/ingest', {
          method: 'POST',
          body: { filename: file.name, mimeType: file.type || 'application/octet-stream', dataBase64: b64 },
        }).then(function (r) {
          statusBox.innerHTML = processingHtml(file.name);
          startStages();
          pollJob(r.jobId, 0);
        }).catch(function (err) {
          statusBox.innerHTML = '<div class="notice error">' + escapeHtml(err.message || 'Upload failed') + '</div>';
        });
      };
      reader.onerror = function () {
        statusBox.innerHTML = '<div class="notice error">Could not read file.</div>';
      };
      reader.readAsDataURL(file);
    }

    function pollJob(jobId, attempt) {
      if (attempt > 60) { stopStages(); statusBox.innerHTML = '<div class="notice warn">Still parsing — check back in a minute (job #' + jobId + ').</div>'; refreshList(); return; }
      api('/api/tenant/ingest/' + jobId).then(function (r) {
        var job = r.job;
        if (job.status === 'parsing') {
          setTimeout(function () { pollJob(jobId, attempt + 1); }, 1500);
          return;
        }
        if (job.status === 'failed') {
          stopStages();
          statusBox.innerHTML = '<div class="notice error">Parse failed: ' + escapeHtml(job.errorMessage || 'unknown error') + '</div>';
          refreshList();
          return;
        }
        // ready_for_review
        stopStages();
        statusBox.innerHTML = '<div class="notice">Parsed — review below ↓</div>';
        refreshList();
        showReview(job, true); // animate the reveal on the live poll path
      }).catch(function (err) {
        stopStages();
        statusBox.innerHTML = '<div class="notice error">' + escapeHtml(err.message || 'Lost the job') + '</div>';
      });
    }

    function refreshList() {
      api('/api/tenant/ingest').then(function (r) {
        listBody.innerHTML = '';
        if (!r.jobs || !r.jobs.length) {
          listBody.appendChild(el('div', { class: 'muted-small', text: 'No uploads yet.' }));
          return;
        }
        var tbl = el('table', { class: 'table', style: { background: 'transparent' } });
        var thead = el('thead', {}, [
          el('tr', {}, [
            el('th', { text: 'File' }),
            el('th', { text: 'Status' }),
            el('th', { text: 'When' }),
            el('th', { text: '' }),
          ]),
        ]);
        tbl.appendChild(thead);
        var tbody = el('tbody', {});
        r.jobs.forEach(function (j) {
          var statusBadge = el('span', { class: 'badge ' + statusClass(j.status), text: j.status });
          var openBtn = el('button', {
            class: 'btn btn-ghost btn-sm',
            text: j.status === 'ready_for_review' ? 'Review' : 'View',
            on: { click: function () {
              api('/api/tenant/ingest/' + j.id).then(function (r) { showReview(r.job); window.scrollTo(0, document.body.scrollHeight); });
            } }
          });
          // File cell: for email-sourced jobs, prepend a small ✉ badge and show
          // the sender under the filename so the queue row is instantly readable
          // as "came in by email from <who>" vs a manual upload.
          var fileCell = el('td', {});
          var fileTop = el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } });
          if (j.source === 'email') {
            fileTop.appendChild(el('span', { class: 'qf-email-badge', text: '✉', title: 'Received by email' }));
          }
          fileTop.appendChild(el('span', { text: j.filename }));
          fileCell.appendChild(fileTop);
          if (j.source === 'email' && j.sourceEmail) {
            fileCell.appendChild(el('div', { class: 'muted-small', text: j.sourceEmail, style: { marginTop: '2px' } }));
          }
          tbody.appendChild(el('tr', {}, [
            fileCell,
            el('td', {}, [statusBadge]),
            el('td', { text: fmtDate(j.createdAt) }),
            el('td', {}, [openBtn]),
          ]));
        });
        tbl.appendChild(tbody);
        // Wrap in a horizontal-scroll container so the date column can't wrap
        // to 3 lines or clip at 375px — it scrolls instead of overflowing.
        var scroll = el('div', { class: 'qf-table-scroll' });
        scroll.appendChild(tbl);
        listBody.appendChild(scroll);
      }).catch(showErr(listBody));
    }

    function statusClass(s) {
      if (s === 'applied') return 'badge-success';
      if (s === 'ready_for_review') return 'badge-info';
      if (s === 'failed') return 'badge-error';
      if (s === 'rejected') return 'badge-muted';
      return 'badge-muted';
    }

    function showReview(job, animate) {
      reviewBox.innerHTML = '';
      var parsed = job.parsed || {};
      var doAnim = animate && !prefersReducedMotion();
      var card = el('div', { class: 'card' + (doAnim ? ' qf-reveal-in' : ''), style: { padding: '18px 22px' } });

      card.appendChild(el('h2', { text: 'Review: ' + job.filename }));
      // Provenance line — makes an email-sourced draft instantly distinguishable
      // from a manual upload and shows WHO sent it (trust/auditability).
      if (job.source === 'email' && job.sourceEmail) {
        var prov = el('div', {
          class: 'qf-provenance',
          style: {
            display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap',
            marginBottom: '10px', fontSize: '13px', color: 'var(--muted)',
          },
        });
        prov.appendChild(el('span', { class: 'qf-email-badge', text: '✉ Email' }));
        var provTxt = 'From ' + job.sourceEmail + ' · received ' + fmtProvDate(job.createdAt);
        if (job.subject) provTxt += ' · “' + job.subject + '”';
        prov.appendChild(el('span', { text: provTxt }));
        card.appendChild(prov);
      }
      if (parsed.summary) card.appendChild(el('p', { class: 'muted', text: parsed.summary, style: { marginBottom: '10px' } }));

      if (parsed.confidence) {
        var conf = parsed.confidence;
        var badgeClass = conf === 'high' ? 'badge-success' : conf === 'medium' ? 'badge-warn' : 'badge-error';
        card.appendChild(el('span', { class: 'badge ' + badgeClass, text: 'Confidence: ' + conf, style: { marginRight: '8px' } }));
      }
      if (parsed.warnings && parsed.warnings.length) {
        var warn = el('div', { class: 'notice warn', style: { marginTop: '12px' } });
        warn.innerHTML = '<strong>Warnings:</strong><ul style="margin:6px 0 0 18px;">' +
          parsed.warnings.map(function (w) { return '<li>' + escapeHtml(String(w)) + '</li>'; }).join('') +
          '</ul>';
        card.appendChild(warn);
      }

      if (job.status !== 'ready_for_review') {
        card.appendChild(el('div', { class: 'muted-small', style: { marginTop: '14px' }, text: 'Status: ' + job.status + '. No further action available.' }));
        reviewBox.appendChild(card);
        return;
      }

      // ── System auto-verification (reliability without manual labor) ──
      // We quote a spread of sample lanes against the draft automatically and
      // report a calm summary. The owner never has to hand-test anything.
      // Holds the auto-check summary once it resolves, so the Apply flow can
      // force an explicit acknowledgment when sample lanes failed to price.
      var lastAutoCheck = null;
      var autocheck = el('div', { class: 'qf-autocheck qf-autocheck-loading', style: { marginTop: '14px' } });
      autocheck.innerHTML = '<span class="qf-autocheck-spin" aria-hidden="true"></span>'
        + '<span>Auto-checking a spread of sample lanes with your rates…</span>';
      card.appendChild(autocheck);
      api('/api/tenant/ingest/' + job.id + '/autocheck').then(function (r) {
        lastAutoCheck = r;
        autocheck.className = 'qf-autocheck';
        var totalN = Number(r.total) || 0;
        if (r.flaggedCount > 0) {
          var items = (r.flagged || []).map(function (f) {
            return '<li>' + escapeHtml(f.label) + ' — ' + escapeHtml(f.reason) + '</li>';
          }).join('');
          autocheck.classList.add('qf-autocheck-flag');
          autocheck.setAttribute('role', 'alert');
          // A failed/$0 sample lane means a customer would get a blank/failed
          // quote on that lane if these rates go live — surface it as an
          // explicit WARNING the operator has to reckon with, not a soft
          // "to look at" aside they can skim past.
          autocheck.innerHTML = '<div class="qf-autocheck-line"><strong>⚠ ' + r.flaggedCount + ' of <span data-count-total>' + (doAnim ? '0' : totalN) + '</span> sample lanes did not price</strong> — '
            + r.clean + ' priced cleanly. Applying these rates means customers may get a failed or $0 quote on the flagged lanes:</div>'
            + '<ul class="qf-autocheck-list">' + items + '</ul>'
            + '<div class="qf-autocheck-line qf-autocheck-hint">Review the imported rates for these services before you apply.</div>';
        } else {
          autocheck.classList.add('qf-autocheck-ok');
          // Green tick draws itself in (SVG stroke) on the animated poll path.
          autocheck.innerHTML = checkmarkSvg(doAnim)
            + '<span>We auto-quoted <span data-count-total>' + (doAnim ? '0' : totalN) + '</span> sample lanes with your rates — all computed cleanly. '
            + 'You can apply now, or try a lane yourself first.</span>';
        }
        if (doAnim) {
          var counter = autocheck.querySelector('[data-count-total]');
          countUp(counter, totalN, 700);
        }
      }).catch(function () {
        // Auto-check is a bonus; never block the review if it fails.
        autocheck.remove();
      });

      // Editable selection per item type.
      var rcSelections = renderItemList(card, 'Rate cards', parsed.rateCards || [], rateCardSummary);
      var accSelections = renderItemList(card, 'Accessorials', parsed.accessorials || [], accSummary);
      var lzSelections = renderItemList(card, 'Lane zones', parsed.laneZones || [], laneZoneSummary);
      // Native rate MATRICES (origin×dest / zone / drayage per-container grids).
      // Previously never rendered nor sent — so an ingested matrix was silently
      // dropped on apply and never reached a customer. Each row is one matrix
      // BLOCK (with its nested cells + zone legend), selected the same way.
      var mxSelections = renderItemList(card, 'Rate matrices', parsed.rateMatrices || [], rateMatrixSummary);

      function selectionTotal(body) {
        return body.rateCards.length + body.accessorials.length + body.laneZones.length + body.rateMatrices.length;
      }
      function appliedNotice(ins) {
        var bits = [
          ins.rateCards + ' rate cards',
          ins.accessorials + ' accessorials',
          ins.laneZones + ' lane zones',
        ];
        // Only mention matrices/zones when something was actually written, so
        // legacy imports read exactly as before.
        if (ins.rateMatrices) bits.push(ins.rateMatrices + ' matrix cells');
        if (ins.rateZones) bits.push(ins.rateZones + ' zone rules');
        return '<div class="notice"><strong>Applied.</strong> ' + bits.join(' · ') + '</div>';
      }
      function currentSelection() {
        return {
          rateCards: rcSelections.selected(),
          accessorials: accSelections.selected(),
          laneZones: lzSelections.selected(),
          rateMatrices: mxSelections.selected(),
        };
      }
      function doApply(body, onDone) {
        var total = selectionTotal(body);
        if (total === 0) { toastErr({ message: 'Tick at least one item to apply.' }); return; }
        api('/api/tenant/ingest/' + job.id + '/apply', {
          method: 'POST', body: body,
        }).then(function (r) {
          reviewBox.innerHTML = appliedNotice(r.inserted);
          refreshList();
          if (onDone) onDone(true);
        }).catch(function (err) {
          toastErr({ message: err.message || 'Apply failed.' });
          if (onDone) onDone(false);
        });
      }

      var actionRow = el('div', { style: { marginTop: '20px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' } });
      var applyBtn = el('button', {
        class: 'btn btn-primary',
        text: 'Apply selected',
        on: { click: function () {
          var body = currentSelection();
          var total = selectionTotal(body);
          if (total === 0) { toastErr({ message: 'Tick at least one item to apply.' }); return; }
          var noun = total === 1 ? 'item' : 'items';
          // When the auto-check flagged sample lanes that priced at $0 / failed,
          // don't let Apply be a silent click-through: show the failing lanes and
          // require the operator to explicitly acknowledge before applying.
          var flagged = lastAutoCheck && lastAutoCheck.flaggedCount > 0 ? lastAutoCheck : null;
          var warnHtml = '';
          if (flagged) {
            var flagItems = (flagged.flagged || []).map(function (f) {
              return '<li>' + escapeHtml(f.label) + ' — ' + escapeHtml(f.reason) + '</li>';
            }).join('');
            warnHtml = '<div class="qf-modal-warn"><strong>⚠ ' + flagged.flaggedCount + ' sample lane'
              + (flagged.flaggedCount === 1 ? '' : 's') + ' did not price.</strong> Customers may get a failed or $0 quote on '
              + (flagged.flaggedCount === 1 ? 'this lane' : 'these lanes') + ' once these rates are live:'
              + '<ul class="qf-autocheck-list">' + flagItems + '</ul></div>';
          }
          showConfirmModal({
            title: flagged ? 'Apply rates that failed the auto-check?' : 'Apply to your rate book?',
            body: 'This adds ' + total + ' ' + noun + ' to your live rate book. You can edit or remove them later.',
            bodyHtml: warnHtml || undefined,
            danger: !!flagged,
            requireAck: flagged ? 'I understand ' + flagged.flaggedCount + ' sample lane'
              + (flagged.flaggedCount === 1 ? '' : 's') + ' did not price and want to apply anyway.' : undefined,
            confirmText: flagged ? 'Apply anyway' : 'Apply ' + total + ' ' + noun,
            cancelText: 'Cancel',
            onConfirm: function () {
              applyBtn.disabled = true; applyBtn.textContent = 'Applying…';
              api('/api/tenant/ingest/' + job.id + '/apply', {
                method: 'POST', body: body,
              }).then(function (r) {
                reviewBox.innerHTML = appliedNotice(r.inserted);
                refreshList();
              }).catch(function (err) {
                applyBtn.disabled = false; applyBtn.textContent = 'Apply selected';
                toastErr({ message: err.message || 'Apply failed.' });
              });
            },
          });
        } }
      });
      var rejectBtn = el('button', {
        class: 'btn btn-danger',
        text: 'Reject',
        on: { click: function () {
          showConfirmModal({
            title: 'Discard this parsed result?',
            body: 'The extracted rate cards, accessorials, lane zones, and rate matrices will be discarded. You can re-upload the sheet anytime.',
            confirmText: 'Discard',
            cancelText: 'Keep reviewing',
            danger: true,
            onConfirm: function () {
              api('/api/tenant/ingest/' + job.id + '/reject', { method: 'POST' }).then(function () {
                reviewBox.innerHTML = '';
                refreshList();
              }).catch(function (err) { toastErr({ message: err.message || 'Could not discard.' }); });
            },
          });
        } }
      });
      // Manual test is OPTIONAL — a quiet confidence bonus, never a gate.
      // Apply is available directly; this just lets a curious owner try a lane.
      var testLink = el('button', {
        class: 'btn btn-ghost btn-sm qf-try-lane',
        text: 'Try a lane yourself',
        on: { click: function () { openTestModal(job, parsed, currentSelection, doApply); } },
      });
      var testHint = el('span', { class: 'muted-small', text: 'optional' });
      actionRow.appendChild(applyBtn);
      actionRow.appendChild(rejectBtn);
      actionRow.appendChild(testLink);
      actionRow.appendChild(testHint);
      card.appendChild(actionRow);
      reviewBox.appendChild(card);

      // Bring the freshly-parsed card into view. Smooth-scroll on the poll
      // path so the user actually sees the result appear below the fold.
      // Under reduced-motion we keep the scroll but skip the reveal/stagger.
      if (animate) {
        try { card.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' }); } catch (e) { card.scrollIntoView(); }
      }
      if (doAnim) {
        // Staggered reveal of the extracted-item sections.
        var sections = card.querySelectorAll('.qf-review-section');
        for (var s = 0; s < sections.length; s++) {
          sections[s].classList.add('qf-reveal-row');
          sections[s].style.animationDelay = (80 + s * 90) + 'ms';
        }
      }
    }

    // Inline SVG checkmark that draws its stroke in when `animate` is set.
    // Uses currentColor (inherits the success token) — no literal colors.
    function checkmarkSvg(animate) {
      return '<svg class="qf-check-draw' + (animate ? ' is-animating' : '') + '" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">'
        + '<circle class="qf-check-circle" cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"></circle>'
        + '<path class="qf-check-path" d="M6.5 12.5 L10.5 16.5 L17.5 8.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></path>'
        + '</svg>';
    }

    // ── "Test your rates" modal ─────────────────────────────────────
    // Confirm-by-simulation: run a sample lane against the not-yet-applied
    // draft, exactly as a customer would, so the owner sees the quote BEFORE
    // committing. Uses the preview-quote endpoint (no persist).
    function openTestModal(job, parsed, getSelection, applyFn) {
      var cards = (parsed.rateCards || []).filter(function (c) { return c && c.service; });
      var matrixBlocks = (parsed.rateMatrices || []).filter(function (m) { return m && m.mode; });
      // Unique services from the draft's rate cards AND its rate matrices, so a
      // matrix-only sheet (no per-mile cards) is still testable.
      var services = [];
      cards.forEach(function (c) { if (services.indexOf(c.service) < 0) services.push(c.service); });
      matrixBlocks.forEach(function (m) { if (services.indexOf(m.mode) < 0) services.push(m.mode); });
      if (!services.length) { toastErr({ message: 'No rate cards or matrices in this draft to test.' }); return; }

      var backdrop = el('div', { class: 'qf-modal-backdrop is-open' });
      var cardEl = el('div', { class: 'qf-modal-card qf-test-card', role: 'dialog', 'aria-modal': 'true' });
      cardEl.appendChild(el('h3', { text: 'Try a lane yourself' }));
      cardEl.appendChild(el('p', { text: 'Optional — your rates are ready to apply. We already auto-checked a spread of sample lanes. Run any lane here to see exactly what a customer would be quoted.' }));

      function equipmentFor(svc) {
        var eqs = [];
        cards.forEach(function (c) { if (c.service === svc && c.equipment && eqs.indexOf(c.equipment) < 0) eqs.push(c.equipment); });
        // Matrix blocks scope to a mode + equipment too (e.g. drayage reefer
        // container) — offer those so a matrix-only lane can be test-quoted.
        matrixBlocks.forEach(function (m) { if (m.mode === svc && m.equipment && eqs.indexOf(m.equipment) < 0) eqs.push(m.equipment); });
        return eqs;
      }
      function opts(list) {
        return list.map(function (v) { return '<option value="' + escapeHtml(v) + '">' + escapeHtml(v) + '</option>'; }).join('');
      }

      var grid = el('div', { class: 'qf-test-grid' });
      grid.innerHTML =
        '<div class="qf-test-field"><label>Service</label>'
          + '<select class="input" data-f="service">' + opts(services) + '</select></div>'
        + '<div class="qf-test-field"><label>Equipment</label>'
          + '<select class="input" data-f="equipment">' + opts(equipmentFor(services[0])) + '</select></div>'
        + '<div class="qf-test-field"><label>Pickup (city, ST or ZIP)</label>'
          + '<input class="input" data-f="pickup" placeholder="Long Beach, CA" /></div>'
        + '<div class="qf-test-field"><label>Delivery (city, ST or ZIP)</label>'
          + '<input class="input" data-f="delivery" placeholder="Phoenix, AZ" /></div>'
        + '<div class="qf-test-field"><label>Weight (lb, optional)</label>'
          + '<input class="input" data-f="weight" type="number" min="0" placeholder="e.g. 18000" /></div>'
        + '<div class="qf-test-field"><label>&nbsp;</label>'
          + '<button type="button" class="btn btn-primary" data-f="run">Get sample quote</button></div>';
      cardEl.appendChild(grid);

      var svcSel = grid.querySelector('[data-f="service"]');
      var eqSel = grid.querySelector('[data-f="equipment"]');
      svcSel.addEventListener('change', function () { eqSel.innerHTML = opts(equipmentFor(svcSel.value)); });

      var resultBox = el('div', { class: 'qf-test-result', style: { display: 'none' } });
      cardEl.appendChild(resultBox);

      function parseLoc(s) {
        var t = String(s || '').trim();
        if (!t) return null;
        if (/^\d{5}$/.test(t)) return { zip: t, country: 'US' };
        if (/^[A-Za-z]\d[A-Za-z]/.test(t)) return { zip: t.replace(/\s+/g, ''), country: 'CA' };
        var parts = t.split(',').map(function (p) { return p.trim(); }).filter(Boolean);
        if (parts.length >= 2) return { city: parts[0], state: parts[1].slice(0, 2).toUpperCase(), country: 'US' };
        return { city: t, country: 'US' };
      }

      var runBtn = grid.querySelector('[data-f="run"]');
      runBtn.addEventListener('click', function () {
        var pickup = parseLoc(grid.querySelector('[data-f="pickup"]').value);
        var delivery = parseLoc(grid.querySelector('[data-f="delivery"]').value);
        if (!pickup || !delivery) { toastErr({ message: 'Enter both a pickup and a delivery location.' }); return; }
        var wRaw = grid.querySelector('[data-f="weight"]').value;
        var body = { service: svcSel.value, equipment: eqSel.value, pickup: pickup, delivery: delivery };
        if (wRaw && !isNaN(Number(wRaw))) body.weightLbs = Number(wRaw);
        runBtn.disabled = true; runBtn.textContent = 'Quoting…';
        resultBox.style.display = 'block';
        resultBox.innerHTML = '<div class="qf-ingest-processing" style="margin:0;"><div class="qf-ingest-spinner"></div>'
          + '<div class="qf-ingest-processing-copy"><div class="qf-ingest-processing-title">Calculating…</div></div></div>';
        api('/api/tenant/ingest/' + job.id + '/preview-quote', { method: 'POST', body: body })
          .then(function (r) { renderQuote(r); })
          .catch(function (err) {
            resultBox.innerHTML = '<div class="notice error">' + escapeHtml(err.message || 'Could not compute a quote.') + '</div>';
          })
          .then(function () { runBtn.disabled = false; runBtn.textContent = 'Get sample quote'; });
      });

      function renderQuote(r) {
        if (r.unsupported) {
          resultBox.innerHTML = '<div class="notice warn">' + escapeHtml(r.unsupported.reason || 'No matching rate for this lane.') + '</div>';
          return;
        }
        var res = r.result || {};
        var lines = res.lines || [];
        var html = '';
        if (typeof r.miles === 'number') html += '<div class="muted-small" style="margin-bottom:8px;">Lane distance ≈ ' + Math.round(r.miles) + ' mi</div>';
        lines.forEach(function (l) {
          html += '<div class="qf-test-line"><span>' + escapeHtml(l.name || l.kind || '') + '</span>'
            + '<span class="qf-test-amt">$' + fmtMoney(Number(l.amount) || 0) + '</span></div>';
        });
        html += '<div class="qf-test-total"><span>Customer total</span>'
          + '<span class="qf-test-amt">$' + fmtMoney(Number(res.total) || 0) + '</span></div>';
        resultBox.innerHTML = html;
      }

      function close() {
        backdrop.remove();
        if (window.__qfTestKeydown) { document.removeEventListener('keydown', window.__qfTestKeydown); window.__qfTestKeydown = null; }
      }

      var actions = el('div', { class: 'qf-modal-actions' });
      var keepBtn = el('button', { class: 'btn', text: 'Close', on: { click: close } });
      var confirmBtn = el('button', {
        class: 'btn btn-primary',
        text: 'Apply these rates',
        on: { click: function () {
          confirmBtn.disabled = true; confirmBtn.textContent = 'Applying…';
          applyFn(getSelection(), function (ok) {
            if (ok) { close(); window.scrollTo(0, 0); }
            else { confirmBtn.disabled = false; confirmBtn.textContent = 'Apply these rates'; }
          });
        } },
      });
      actions.appendChild(keepBtn);
      actions.appendChild(confirmBtn);
      cardEl.appendChild(actions);

      backdrop.appendChild(cardEl);
      backdrop.addEventListener('click', function (ev) { if (ev.target === backdrop) close(); });
      window.__qfTestKeydown = function (ev) { if (ev.key === 'Escape') close(); };
      document.addEventListener('keydown', window.__qfTestKeydown);
      document.body.appendChild(backdrop);
    }

    function renderItemList(parent, title, items, summarize) {
      var section = el('div', { class: 'qf-review-section', style: { marginTop: '20px' } });
      section.appendChild(el('h3', { text: title + ' (' + items.length + ')', style: { fontSize: '15px', marginBottom: '8px' } }));
      if (!items.length) {
        section.appendChild(el('div', { class: 'muted-small', text: '— none extracted —' }));
        parent.appendChild(section);
        return { selected: function () { return []; } };
      }
      var checks = [];
      items.forEach(function (item, i) {
        var wrap = el('label', { style: { display: 'flex', gap: '10px', padding: '8px 0', borderBottom: '1px solid var(--border)', cursor: 'pointer' } });
        var cb = el('input', { type: 'checkbox', checked: 'checked', style: { marginTop: '3px' } });
        var info = el('div', { style: { flex: '1' } });
        info.innerHTML = summarize(item);
        wrap.appendChild(cb); wrap.appendChild(info);
        section.appendChild(wrap);
        checks.push({ cb: cb, item: item });
      });
      parent.appendChild(section);
      return {
        selected: function () { return checks.filter(function (x) { return x.cb.checked; }).map(function (x) { return x.item; }); },
      };
    }

    function rateCardSummary(c) {
      var bits = [c.label || (c.equipment + ' / ' + c.service)];
      if (c.ratePerMile != null) bits.push('$' + c.ratePerMile + '/mi');
      if (c.minimumCharge != null) bits.push('min $' + c.minimumCharge);
      if (c.fuelSurchargePct != null) bits.push(c.fuelSurchargePct + '% fuel');
      return '<strong>' + escapeHtml(bits.shift()) + '</strong>'
        + '<div class="muted-small">' + escapeHtml(bits.join(' · ')) + '</div>';
    }
    function accSummary(a) {
      return '<strong>' + escapeHtml(a.label || a.code) + '</strong>'
        + '<div class="muted-small">' + escapeHtml((a.kind || 'flat') + ' · $' + (a.amount ?? 0)) + '</div>';
    }
    function laneZoneSummary(z) {
      return '<strong>' + escapeHtml(z.label || (z.anchorPortCode || z.anchorCity || 'zone')) + '</strong>'
        + '<div class="muted-small">' + escapeHtml('within ' + (z.radiusMiles ?? '?') + ' mi · $' + (z.flatPrice ?? '?')) + '</div>';
    }
    // A rate-matrix BLOCK holds many priced cells (an origin×dest grid, a
    // zone×zone grid, or a drayage port→zone per-container matrix). Summarize the
    // block: mode/equipment, cell + zone counts, unit basis, and a few sample
    // cells ("USLAX → 90744 $355") so the owner can sanity-check the grid before
    // applying — without scrolling hundreds of rows.
    function rateMatrixSummary(m) {
      var cells = Array.isArray(m.cells) ? m.cells : [];
      var zones = Array.isArray(m.zones) ? m.zones : [];
      var head = [String(m.mode || 'ftl').toUpperCase()];
      if (m.equipment) head.push(String(m.equipment));
      head.push(cells.length + (cells.length === 1 ? ' cell' : ' cells'));
      var meta = [];
      if (m.unitBasis) meta.push(String(m.unitBasis).replace(/_/g, ' '));
      if (zones.length) meta.push(zones.length + (zones.length === 1 ? ' zone' : ' zones'));
      if (m.currency) meta.push(String(m.currency));
      if (m.sourceRef) meta.push(String(m.sourceRef));
      var samples = cells.slice(0, 3).map(function (c) {
        var unit = (c.unitBasis || m.unitBasis) === 'per_mile' ? '/mi' : '';
        return escapeHtml(String(c.originKey) + ' → ' + String(c.destKey) + ' $' + (c.rate != null ? c.rate : '?') + unit);
      });
      if (cells.length > 3) samples.push('…+' + (cells.length - 3) + ' more');
      return '<strong>' + escapeHtml(head.join(' · ')) + '</strong>'
        + '<div class="muted-small">' + escapeHtml(meta.join(' · ')) + '</div>'
        + (samples.length ? '<div class="muted-small" style="margin-top:2px;opacity:.85;">' + samples.join(' &nbsp;·&nbsp; ') + '</div>' : '');
    }
  }

  // ── Trial banner ──────────────────────────────────────────────
  // Slim countdown banner at the top of the authed shell. Honest about
  // billing (audit H1): the subscribe CTA only appears when Stripe is
  // actually configured — an unconfigured deployment shows the countdown
  // with NO dead button (a button that 503s is worse than none). Paid
  // tenants get no banner. The visibility + CTA logic lives in the shared,
  // unit-tested QFTrialBanner module (trial-banner.js) so this is just DOM.
  var trialBannerDismissed = false; // in-memory only → banner returns on reload
  var paymentBannerDismissed = false; // in-memory only → payment warning returns on reload

  // Cache /api/billing/status once; the banner + Account card both read it.
  // ── Get paid (Stripe Connect Express onboarding) ──────────────
  // Builds the "Connect a way to get paid" card on the Account page. Gated on
  // GET /api/tenant/connect/config so the whole section is hidden unless
  // payments are enabled (never advertises a 503 button). The Stripe option
  // lives in a `.qf-getpaid-options` row deliberately built to hold a second
  // provider (PayPal) beside it later. Reflects live onboarding status:
  //   not connected → "Connect with Stripe"
  //   details incomplete / charges off → "Finish setup" + pending pill
  //   charges enabled → "✓ Ready to accept deposits" + Update-details link
  // NO charge / money movement here — onboarding + status only (later PR moves
  // money). A credit-card glyph (stroke=currentColor) keeps it theme-aware.
  var CARD_SVG = '<svg class="qf-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="20" height="14" x="2" y="5" rx="2"/><path d="M2 10h20"/></svg>';

  function paintStripeOption(optEl, status) {
    optEl.innerHTML = '';
    var brand = el('div', { class: 'qf-getpaid-brand' });
    brand.appendChild(el('span', { class: 'qf-getpaid-logo', html: CARD_SVG }));
    var brandText = el('div', {});
    brandText.appendChild(el('div', { class: 'qf-getpaid-name', text: 'Stripe' }));
    brandText.appendChild(el('div', { class: 'qf-getpaid-desc', text: 'Bank payouts, cards & instant transfers' }));
    brand.appendChild(brandText);
    optEl.appendChild(brand);

    var ready = !!(status && status.chargesEnabled);
    var started = !!(status && status.connected);

    var pill = el('span', { class: 'qf-getpaid-status ' + (ready ? 'is-ready' : (started ? 'is-pending' : 'is-off')) });
    pill.textContent = ready ? '✓ Ready to accept deposits' : (started ? 'Setup incomplete' : 'Not connected');
    optEl.appendChild(pill);

    var actions = el('div', { class: 'qf-getpaid-actions' });
    var btn = el('button', { class: 'btn ' + (ready ? 'btn-secondary' : 'btn-primary'), type: 'button' });
    btn.appendChild(document.createTextNode(ready ? 'Update payout details' : (started ? 'Finish setup' : 'Connect with Stripe')));
    if (!ready) btn.appendChild(el('span', { class: 'arr', 'aria-hidden': 'true', text: '→' }));
    btn.addEventListener('click', function () {
      btn.disabled = true;
      startConnectOnboarding().then(function () { btn.disabled = false; }, function () { btn.disabled = false; });
    });
    actions.appendChild(btn);
    optEl.appendChild(actions);
  }

  function renderGetPaidSection(c) {
    // Fetch config first — hide the whole section when payments aren't enabled.
    api('/api/tenant/connect/config').then(function (cfg) {
      if (!cfg || !cfg.configured) return; // don't advertise

      var card = el('div', { class: 'card', style: { marginTop: '14px' } });
      card.appendChild(el('div', { class: 'card-title', text: 'Get paid' }));
      card.appendChild(el('p', { class: 'muted-small', style: { marginTop: 0, marginBottom: '16px' }, text: 'Connect a way to get paid so you can collect deposits from customers when they book. Your details go straight to the payment provider — QuoteFleet never stores your bank info.' }));

      var options = el('div', { class: 'qf-getpaid-options' });

      // Stripe option — the live one.
      var stripeOpt = el('div', { class: 'qf-getpaid-option' });
      stripeOpt.appendChild(el('div', { class: 'qf-getpaid-brand' }, [el('span', { class: 'qf-getpaid-logo', html: CARD_SVG }), el('div', {}, [el('div', { class: 'qf-getpaid-name', text: 'Stripe' })])]));
      stripeOpt.appendChild(el('p', { class: 'muted-small', style: { margin: 0 }, text: 'Checking status…' }));
      options.appendChild(stripeOpt);

      // Second-provider slot — laid out so a real PayPal "Connect" option drops
      // in right beside Stripe in a later PR. Muted, clearly a placeholder.
      var soon = el('div', { class: 'qf-getpaid-option is-soon' });
      soon.appendChild(el('div', { class: 'qf-getpaid-brand' }, [el('span', { class: 'qf-getpaid-logo', html: CARD_SVG }), el('div', {}, [el('div', { class: 'qf-getpaid-name', text: 'PayPal' })])]));
      soon.appendChild(el('span', { class: 'qf-getpaid-status is-off', text: 'Coming soon' }));
      options.appendChild(soon);

      card.appendChild(options);
      c.appendChild(card);

      // A trip back from Stripe-hosted onboarding lands on ?connect=return.
      try {
        if (/[?&]connect=return\b/.test(location.search)) toast('Thanks — checking your payout setup…', 'success');
      } catch (e) {}

      // Fill live status into the Stripe option.
      api('/api/tenant/connect/status').then(function (status) {
        paintStripeOption(stripeOpt, status);
      }).catch(function () {
        paintStripeOption(stripeOpt, { connected: false });
      });
    }).catch(function () { /* config unreachable → keep section hidden */ });
  }

  // POST /api/tenant/connect/onboard → Stripe-hosted Express onboarding URL we
  // redirect to. 503 when payments aren't enabled (soft toast, no dead-end).
  function startConnectOnboarding() {
    return api('/api/tenant/connect/onboard', { method: 'POST' })
      .then(function (r) {
        if (r && r.url) { window.location.href = r.url; return; }
        toast('Payout setup is unavailable right now.', 'warn');
      })
      .catch(function (e) {
        if (e && e.status === 503) { toast(e.message || 'Payments are not enabled yet.', 'warn'); return; }
        toastErr(e);
      });
  }

  function ensureBillingStatus() {
    if (state.billing) return Promise.resolve(state.billing);
    return api('/api/billing/status')
      .then(function (b) { state.billing = b || { configured: false }; return state.billing; })
      .catch(function () { state.billing = { configured: false }; return state.billing; });
  }

  // Start the EXISTING subscribe / Checkout flow: POST /api/billing/checkout-session
  // returns a Stripe Checkout URL (14-day trial + card collection) we redirect
  // to. Same endpoint the pricing/upgrade path uses — not a new one. Defaults
  // to the entry tier (vital); the Checkout page still lets them adjust.
  function startSubscribeCheckout(plan) {
    return api('/api/billing/checkout-session', { method: 'POST', body: { plan: plan || 'vital' } })
      .then(function (r) {
        if (r && r.url) { window.location.href = r.url; return; }
        toast('Checkout is unavailable right now.', 'warn');
      })
      .catch(function (e) {
        if (e && e.status === 503) { toast(e.message || "Billing isn't enabled yet.", 'warn'); return; }
        toastErr(e);
      });
  }
  window.qfStartSubscribe = startSubscribeCheckout;

  function removeTrialBanner() {
    var bar = document.getElementById('qf-trial-bar');
    if (bar) bar.remove();
    syncAppbarOffset();
  }

  // The top app-bar was removed; the trial banner is a body-level sticky (top:0)
  // that reserves its own flow space, so there is no longer a second sticky bar
  // to offset. Kept as a no-op so existing call sites stay valid.
  function syncAppbarOffset() { /* no-op — app-bar removed */ }
  window.qfSyncAppbarOffset = syncAppbarOffset;

  function renderTrialBanner(trial) {
    state.trial = trial || state.trial || null;
    if (!state.trial) { removeTrialBanner(); document.body.classList.remove('qf-trial-locked'); return; }
    ensureBillingStatus().then(function (billing) {
      paintTrialBanner(state.trial, !!(billing && billing.configured));
    });
  }

  function paintTrialBanner(trial, billingConfigured) {
    var view = window.QFTrialBanner
      ? window.QFTrialBanner.computeTrialBannerView({
          trialStatus: trial.status,
          daysLeft: typeof trial.daysLeft === 'number'
            ? trial.daysLeft
            : window.QFTrialBanner.daysLeftFrom(trial.trialEndsAt),
          billingConfigured: billingConfigured,
          paymentPastDue: !!trial.paymentPastDue,
        })
      : { show: false };

    // Paid / unknown → no banner, and never leave inputs locked.
    if (!view.show) { removeTrialBanner(); document.body.classList.remove('qf-trial-locked'); return; }

    // The full banner renders at every width (it wraps/stacks on mobile via its
    // own CSS). The old ≤640 "collapse into an app-bar pill" path was removed
    // together with the app-bar.

    // Trial + payment_issue are dismissible for the current page load (they
    // return on reload while unresolved); expired is not.
    if (view.variant === 'trial' && trialBannerDismissed) { removeTrialBanner(); return; }
    if (view.variant === 'payment_issue' && paymentBannerDismissed) { removeTrialBanner(); return; }

    var bar = document.getElementById('qf-trial-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'qf-trial-bar';
      document.body.insertBefore(bar, document.body.firstChild);
    }
    bar.className = 'qf-trial-banner qf-trial-banner--' + view.variant + (view.urgent ? ' is-urgent' : '');
    bar.setAttribute('role', view.variant === 'expired' ? 'alert' : 'status');
    bar.innerHTML = '';

    var msg = el('div', { class: 'qf-trial-banner-msg' });
    msg.appendChild(el('span', { class: 'qf-trial-banner-dot', 'aria-hidden': 'true' }));
    msg.appendChild(el('span', { class: 'qf-trial-banner-headline', text: view.headline }));
    var subText;
    if (view.variant === 'trial') subText = 'Every feature unlocked';
    else if (view.variant === 'payment_issue') subText = 'Your service stays active while you update it';
    else subText = 'Your calculator is read-only until you subscribe';
    msg.appendChild(el('span', { class: 'qf-trial-banner-sub', text: subText }));
    bar.appendChild(msg);

    if (view.ctaShown && view.ctaLabel) {
      var cta = el('button', { class: 'btn btn-primary qf-trial-banner-cta', type: 'button' });
      cta.appendChild(document.createTextNode(view.ctaLabel.replace(/\s*→\s*$/, '')));
      cta.appendChild(el('span', { class: 'arr', 'aria-hidden': 'true', text: '→' }));
      cta.addEventListener('click', function () {
        // payment_issue → open the Stripe Customer Portal to fix the card;
        // trial/expired → start the subscribe Checkout flow.
        if (view.variant === 'payment_issue') { openBillingPortal(); return; }
        cta.disabled = true;
        startSubscribeCheckout('vital').then(
          function () { cta.disabled = false; },
          function () { cta.disabled = false; }
        );
      });
      bar.appendChild(cta);
    }

    // Dismiss — trial + payment_issue only. In-memory flag so the banner
    // returns on the next reload while unresolved (we never hard-hide a live
    // trial or an unfixed payment). Expired stays pinned (read-only state).
    if (view.variant === 'trial' || view.variant === 'payment_issue') {
      var isPayment = view.variant === 'payment_issue';
      var close = el('button', {
        class: 'qf-trial-banner-close',
        type: 'button',
        'aria-label': isPayment ? 'Dismiss payment banner' : 'Dismiss trial banner',
      });
      close.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      close.addEventListener('click', function () {
        if (isPayment) paymentBannerDismissed = true; else trialBannerDismissed = true;
        removeTrialBanner();
      });
      bar.appendChild(close);
    }

    // Read-only lock for the expired state (mirrors the server write-block so
    // users don't type into fields whose backend write would 403 anyway).
    // payment_issue keeps FULL access (paying tenant in grace) — never lock.
    if (view.variant === 'expired') document.body.classList.add('qf-trial-locked');
    else document.body.classList.remove('qf-trial-locked');

    // Banner is now in the DOM at its final height — push the top bar below it.
    syncAppbarOffset();
  }

  // Day-14 write-block escape: called from api() when a mutating request 403s
  // with trial_expired. Flip the banner into its expired state (surfacing the
  // subscribe CTA prominently) and nudge the user — no generic error page.
  function handleTrialExpired(j) {
    state.trial = {
      status: 'trial_expired',
      daysLeft: 0,
      trialEndsAt: (j && j.trialEndsAt) || (state.trial && state.trial.trialEndsAt) || null,
    };
    renderTrialBanner(state.trial);
    toast('Your free trial has ended — subscribe to keep making changes.', 'warn');
  }

  // Sidebar toggle — works at every width.
  // - Mobile (<900px): hamburger slides the off-canvas sidebar in/out.
  // - Desktop (>=900px): hamburger collapses the sidebar so the content
  //   gets the full window width. Click again to bring it back.
  function wireMobileNav() {
    var toggle = document.getElementById('qf-mobile-nav-toggle');
    var shell = document.getElementById('app-shell');
    if (!toggle || !shell) return;
    // Scrim: a semi-opaque backdrop behind the open off-canvas drawer that
    // dims the page and closes the drawer on tap (Escape also closes).
    var scrim = document.getElementById('qf-nav-scrim');
    if (!scrim) {
      scrim = document.createElement('div');
      scrim.id = 'qf-nav-scrim';
      scrim.className = 'qf-nav-scrim';
      shell.appendChild(scrim);
    }
    function isDesktop() { return window.innerWidth >= 901; }
    function setOpenMobile(open) {
      var wasOpen = shell.classList.contains('qf-nav-open');
      shell.classList.toggle('qf-nav-open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
      // Move focus into the drawer on open so keyboard users land inside it;
      // return focus to the toggle on close so they aren't stranded in a
      // now-hidden off-canvas region.
      if (open) { var first = document.querySelector('.sidebar .nav-item'); if (first) try { first.focus(); } catch (_e) {} }
      else if (wasOpen) { try { toggle.focus(); } catch (_e2) {} }
    }
    scrim.addEventListener('click', function () { setOpenMobile(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && shell.classList.contains('qf-nav-open')) setOpenMobile(false);
    });
    function setCollapsedDesktop(collapsed) {
      shell.classList.toggle('qf-nav-collapsed', collapsed);
      toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      toggle.setAttribute('aria-label', collapsed ? 'Show sidebar' : 'Hide sidebar');
    }
    toggle.addEventListener('click', function () {
      if (isDesktop()) {
        setCollapsedDesktop(!shell.classList.contains('qf-nav-collapsed'));
      } else {
        setOpenMobile(!shell.classList.contains('qf-nav-open'));
      }
    });
    // Auto-close mobile drawer after picking a nav item.
    $$('.sidebar .nav-item').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!isDesktop()) setOpenMobile(false);
      });
    });
    // Tap outside (anywhere in main) closes the mobile drawer.
    document.querySelector('.app-main').addEventListener('click', function () {
      if (!isDesktop()) setOpenMobile(false);
    });
    // Breakpoint change (rotate / window resize): clear stale state so the
    // sidebar can't remain off-canvas-open after growing to desktop, or
    // desktop-collapsed after shrinking to mobile, with a mismatched toggle.
    var wasDesktop = isDesktop();
    window.addEventListener('resize', function () {
      var nowDesktop = isDesktop();
      if (nowDesktop === wasDesktop) return;
      wasDesktop = nowDesktop;
      if (nowDesktop) {
        shell.classList.remove('qf-nav-open');
        toggle.setAttribute('aria-expanded', 'true');
        toggle.setAttribute('aria-label', 'Hide sidebar');
      } else {
        shell.classList.remove('qf-nav-collapsed');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-label', 'Open navigation menu');
      }
    });
  }

  // ── boot ───────────────────────────────────────────────────────
  function boot() {
    api('/api/auth/me').then(function (r) {
      if (!r.user) { location.href = '/login'; return; }
      if (r.user.role === 'super_admin' && !location.search.includes('mode=tenant')) {
        // Super admin defaults to admin dashboard
        location.href = '/admin';
        return;
      }
      state.me = r;
      // Single source of truth for "the URL a customer opens" — the canonical
      // hosted widget URL (<slug>.<hostDomain>) exactly as the Embed page and
      // the live widget use it. Every dashboard customer-link display / Copy /
      // Open reads this, so nothing invents a fake `…yourquote.net` domain.
      (function () {
        var t = r.tenant;
        var hosted = t && t.hostedUrl;
        var url = hosted
          ? hosted
          : (t ? new URL('/w/' + encodeURIComponent(t.slug), location.origin).toString() : '');
        var host = hosted
          ? hosted.replace(/^https?:\/\//, '').replace(/\/$/, '')
          : (t ? t.slug : '');
        window.__qfWidget = { url: url, host: host, slug: t ? t.slug : '' };
      })();
      $('#sb-tenant-name').textContent = (r.tenant && r.tenant.name) || r.user.name || r.user.email;
      // Default avatar tile (light shell) shows the BUSINESS initials, not 'QF':
      // first letters of the first two words, or the first two letters of a
      // single-word name. Rendered via CSS content:attr(data-initials) on the
      // name element; a real uploaded logo (handled elsewhere) still wins.
      (function () {
        var nameEl = document.getElementById('sb-tenant-name');
        if (!nameEl) return;
        var src = String((r.tenant && r.tenant.name) || r.user.name || r.user.email || '').trim();
        var words = src.split(/\s+/).filter(function (w) { return w.length > 0; });
        var initials = '';
        if (words.length >= 2) initials = words[0].charAt(0) + words[1].charAt(0);
        else if (words.length === 1) initials = words[0].slice(0, 2);
        initials = initials.toUpperCase();
        nameEl.setAttribute('data-initials', initials || src.charAt(0).toUpperCase() || 'QF');
      })();
      // Slug row: display the hosted host (no protocol) AND make it a live
      // link to the tenant's hosted calculator (new tab). Reuse the canonical
      // window.__qfWidget computed above — url has the protocol, host is the
      // display form — so the link matches the Embed/Open URL exactly.
      (function () {
        var slugEl = $('#sb-tenant-slug');
        if (!slugEl) return;
        var w = window.__qfWidget || {};
        slugEl.textContent =
          w.host ||
          ((r.tenant && r.tenant.hostedUrl)
            ? r.tenant.hostedUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')
            : (r.tenant && '/w/' + r.tenant.slug) || '');
        if (slugEl.tagName === 'A') {
          slugEl.setAttribute(
            'href',
            w.url ||
              (r.tenant
                ? new URL('/w/' + encodeURIComponent(r.tenant.slug), location.origin).toString()
                : '#')
          );
        }
        // Auto-shrink the font so the FULL hosted URL always fits on ONE line
        // within the sidebar — Alex: it must fit, not truncate with an ellipsis.
        // Steps the size down until it no longer overflows (or hits a 7px floor).
        function fitSlug() {
          try {
            slugEl.style.fontSize = ''; // reset to the CSS size, then shrink to fit
            var size = parseFloat(getComputedStyle(slugEl).fontSize) || 11;
            var guard = 0;
            while (slugEl.scrollWidth > slugEl.clientWidth + 1 && size > 7 && guard < 40) {
              size -= 0.5;
              slugEl.style.fontSize = size + 'px';
              guard++;
            }
          } catch (_e) {}
        }
        fitSlug();
        if (window.requestAnimationFrame) requestAnimationFrame(fitSlug); // after layout settles
      })();
      $('#loading').style.display = 'none';
      $('#app-shell').hidden = false;
      renderTrialBanner(r.trial);
      // Reveal the hamburger and wire its toggle now that the shell is visible.
      var t = document.getElementById('qf-mobile-nav-toggle');
      if (t) t.hidden = false;
      wireMobileNav();
      wireThemeToggle();
      // Floating AI copilot — persistent across every authed route.
      mountCopilotBubble();
      // Grab-to-scroll (drag-to-pan) on the dashboard's main content area. The
      // window is the scroll container (.app-shell is a min-height grid; only
      // the sidebar scrolls internally), so panning the .app-main background
      // scrolls the page. Mouse/pen only — native touch scroll is untouched.
      // Rate-builder inputs, buttons, tables, nested scroll panes, and modals
      // are excluded by the shared utility so they behave normally.
      var appMain = document.querySelector('.app-main');
      if (window.QFGrabScroll && appMain) {
        window.QFGrabScroll.attach(window, {
          surface: appMain,
          exclude: window.QFGrabScroll.DEFAULT_EXCLUDE + ', table, thead, tbody, tr, td, th, [role="dialog"], .qf-modal, .modal',
        });
      }

      $$('.sidebar [data-route]').forEach(function (b) {
        b.addEventListener('click', function () { go(b.dataset.route); });
      });
      $('#sb-logout').addEventListener('click', function () {
        api('/api/auth/logout', { method: 'POST' }).finally(function () { location.href = '/login'; });
      });

      // Account settings now lives in the sidebar (data-route="account"), so the
      // generic .sidebar [data-route] handler above already wires it — no
      // separate listener needed. The notifications bell was dropped (the Leads
      // nav item carries the new-lead badge).

      refreshNavBadges();
      syncZonesNav();

      // Route from URL — the FULL nested route (e.g. "leads/QF-123"), so a
      // refresh / deep link / bookmark lands on the right view (audit shell-H2 /
      // leads-H1). We render (not go): the loaded URL is already correct, so
      // pushing state here would only append a redundant history entry AND, when
      // it rewrote to the base segment, drop the sub-path.
      var initial = RouteUtil.fullRoute(location.pathname);
      // Post-signup guided onboarding: gated by the SERVER flag (survives the
      // billing/Stripe hop). Show the wizard overlay instead of routing; it
      // hands control back via onDone once finished or skipped.
      if (r.tenant && r.tenant.needsOnboarding && window.QFOnboardingWizard) {
        window.QFOnboardingWizard.open({ me: r, onDone: function () { render(initial); } });
      } else {
        render(initial);
      }
    }).catch(function (e) {
      // Only bounce to /login on a genuine auth failure (401). Any other
      // thrown error (e.g. a rendering bug) must NOT masquerade as logout —
      // surface it instead of locking the tenant out of the dashboard.
      if (e && e.status === 401) { location.href = '/login'; return; }
      console.error('[boot] dashboard init failed', e);
    });
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[data-route]');
    if (a) { e.preventDefault(); go(a.dataset.route); }
  });
  // Back / Forward: the browser has ALREADY updated location to the target, so
  // we render it directly — NEVER go()/pushState (audit shell-H1: pushing here
  // clobbers forward history and gets navigation stuck). Derive the FULL nested
  // route so Back to "/app/leads/QF-123" restores the detail view, not the list.
  window.addEventListener('popstate', function () {
    render(RouteUtil.fullRoute(location.pathname));
  });

  boot();
})();
