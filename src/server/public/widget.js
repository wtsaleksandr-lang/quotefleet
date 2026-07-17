// QuoteFleet — embeddable calculator widget client.
// Vanilla JS, no build step. Reads tenant slug from /w/:slug URL.
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function $$(sel) { return Array.from(document.querySelectorAll(sel)); }

  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'on') Object.keys(attrs.on).forEach(function (ev) { e.addEventListener(ev, attrs.on[ev]); });
      else if (k === 'text') e.textContent = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (k) { e.appendChild(k); });
    return e;
  }

  function fmtMoney(n) {
    if (typeof n !== 'number' || isNaN(n)) return '0.00';
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function titleizeWord(s) {
    return String(s || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }).trim();
  }

  function mergeLocation(resolved, currentText) {
    if (!resolved) return parseLocation(currentText || '');
    return {
      city: resolved.city || undefined,
      state: resolved.state || undefined,
      zip: resolved.zip || undefined,
      country: resolved.country || 'US',
      lat: typeof resolved.lat === 'number' ? resolved.lat : undefined,
      lng: typeof resolved.lng === 'number' ? resolved.lng : undefined,
    };
  }

  function parseLocation(str) {
    if (!str) return {};
    var s = str.trim();
    var zipMatch = s.match(/^([A-Z0-9]{3,7}(?:[ -]?[A-Z0-9]{3})?)$/i);
    if (zipMatch && /\d/.test(s)) {
      var country = /^[a-zA-Z]/.test(s) ? 'CA' : 'US';
      return { zip: s.replace(/\s+/g, ''), country: country };
    }
    var parts = s.split(',').map(function (p) { return p.trim(); }).filter(Boolean);
    if (parts.length >= 2) {
      var maybeZip = parts[parts.length - 1].match(/\d{5}|[A-Z][0-9][A-Z]/i);
      if (maybeZip) {
        return {
          city: parts[0],
          state: parts[1] ? parts[1].slice(0, 2).toUpperCase() : undefined,
          zip: parts[parts.length - 1].replace(/\s+/g, ''),
          country: /[A-Z]\d/.test(parts[parts.length - 1]) ? 'CA' : 'US',
        };
      }
      return { city: parts[0], state: parts[1].toUpperCase().slice(0, 2), country: 'US' };
    }
    return { city: s, country: 'US' };
  }

  function hasPostalCode(raw, parsed) {
    var s = (raw || '').trim();
    return !!(parsed && parsed.zip) || /\b\d{5}(?:-\d{4})?\b/.test(s) || /\b[A-Z]\d[A-Z][ -]?\d[A-Z]\d\b/i.test(s);
  }

  function normalizeEquipmentLabel(label, service) {
    var text = String(label || '').trim();
    if (service === 'drayage') text = text.replace(/\s*\((drayage|container drayage)\)\s*/ig, '').replace(/\s+drayage\s*/ig, ' ');
    return text.replace(/\s+/g, ' ').trim();
  }

  function equipmentValueMatches(value, needles) {
    var v = String(value || '').toLowerCase();
    return needles.some(function (n) { return v.indexOf(n) >= 0; });
  }

  function withDrayageEquipmentDefaults(list) {
    var next = (list || []).slice();
    function addIfMissing(value, label, needles) {
      var exists = next.some(function (item) { return equipmentValueMatches(item.value || item.label, needles); });
      if (!exists) next.push({ value: value, label: label });
    }
    addIfMissing('container_20_reefer', "20' Reefer container", ['20', 'reefer']);
    addIfMissing('container_40_reefer', "40' Reefer container", ['40', 'reefer']);
    addIfMissing('container_40_open_top', "40' Open top container", ['open top', 'opentop']);
    addIfMissing('container_40_flat_rack', "40' Flat rack", ['flat rack', 'flatrack']);
    return next;
  }

  function isOpenTopOrFlatRack(value) {
    var v = String(value || '').toLowerCase().replace(/[\s_-]+/g, ' ');
    return v.indexOf('open top') >= 0 || v.indexOf('opentop') >= 0 || v.indexOf('flat rack') >= 0 || v.indexOf('flatrack') >= 0;
  }

  function syncOogPanel() {
    var panel = $('qf-oog-panel');
    var check = $('qf-oog-check');
    var fields = $('qf-oog-fields');
    if (!panel) return;
    var show = state.service === 'drayage' && isOpenTopOrFlatRack(state.equipment);
    panel.style.display = show ? '' : 'none';
    if (!show) {
      if (check) check.checked = false;
      if (fields) fields.style.display = 'none';
    }
    autoResize();
  }

  var slug = (window.QF_TENANT_SLUG || '').toString();
  if (!slug) {
    var pathMatch = location.pathname.match(/^\/w\/([^/?#]+)/);
    if (pathMatch) slug = pathMatch[1];
  }
  if (!slug) {
    var hostParts = location.hostname.split('.');
    if (hostParts.length >= 3 && hostParts[0] !== 'www') slug = hostParts[0];
  }
  if (!slug) {
    document.body.innerHTML = '<div class="qf-widget"><div class="qf-error">Missing tenant slug — check the URL.</div></div>';
    return;
  }

  // Owner live-preview grant (`?pk=`). Minted by the dashboard so the tenant's
  // OWN private calculator renders inside the live-preview iframe. It rides on
  // every public API call because the widget host is a different origin than
  // the dashboard, so the access cookie can't follow. Absent for real
  // customers → harmless no-op.
  var previewGrant = '';
  try { previewGrant = new URLSearchParams(location.search).get('pk') || ''; } catch (e) {}
  function withGrant(url) {
    if (!previewGrant) return url;
    return url + (url.indexOf('?') > -1 ? '&' : '?') + 'pk=' + encodeURIComponent(previewGrant);
  }

  var state = {
    config: null,
    service: null,
    equipment: null,
    weightUnit: 'lbs',
    quote: null,
    ltlItems: [],
    selectedAccessorials: [],
    pickupPortCode: '',
    pickupTerminalCode: '',
    pickupResolved: null,
    deliveryResolved: null,
    refId: '',
    customerEmail: '',
  };

  // Apply the FULL resolved theme (preset + optional accent override + font)
  // the server computed in /api/public/widget/:slug. Every --w-* custom
  // property is set on the document root; the widget CSS (notably
  // public-calculator-no-gradients.css) reads them, so the whole widget
  // re-skins from this one call. Legacy brand.primaryColor/accentColor are
  // intentionally NOT applied here — the theme engine owns colour now.
  function applyTheme(theme) {
    if (!theme || !theme.tokens) return;
    var root = document.documentElement;
    Object.keys(theme.tokens).forEach(function (k) {
      root.style.setProperty(k, theme.tokens[k]);
    });
    var font = theme.tokens['--w-font'];
    if (font) {
      root.style.setProperty('--w-font', font);
      document.body.style.fontFamily = font;
    }
    // Per-tenant CTA hover effect (border | lift | glow | fill | none). The
    // widget CSS keys off this attribute; default 'border' preserves the
    // long-standing border-on-hover look. See widgetThemes.ts CTA_HOVER_STYLES.
    var hover = theme.ctaHover || 'border';
    document.body.setAttribute('data-qf-cta-hover', hover);
  }

  function applyBrand(brand) {
    if (!brand) return;
    applyContactRules(brand);
  }

  function getContactRules() {
    var b = (state.config && state.config.brand) || {};
    return {
      requireEmail: b.requireEmail !== false,
      requirePhone: b.requirePhone === true,
      showQuoteBeforeContact: b.showQuoteBeforeContact === true,
    };
  }

  function applyContactRules(brand) {
    var rules = {
      requireEmail: brand.requireEmail !== false,
      requirePhone: brand.requirePhone === true,
      showQuoteBeforeContact: brand.showQuoteBeforeContact === true,
    };
    var emailLabel = $('qf-c-email-label');
    var emailInput = $('qf-c-email');
    var phoneLabel = $('qf-c-phone-label');
    var phoneInput = $('qf-c-phone');
    if (emailLabel) emailLabel.textContent = rules.requireEmail ? 'Email' : 'Email (optional)';
    if (emailInput) {
      if (rules.requireEmail) emailInput.setAttribute('required', 'required');
      else emailInput.removeAttribute('required');
    }
    if (phoneLabel) phoneLabel.textContent = rules.requirePhone ? 'Phone' : 'Phone (optional)';
    if (phoneInput) {
      if (rules.requirePhone) {
        phoneInput.setAttribute('required', 'required');
        phoneInput.setAttribute('placeholder', '(555) 555-1234');
      } else {
        phoneInput.removeAttribute('required');
        phoneInput.setAttribute('placeholder', 'optional');
      }
    }
    var contBtn = $('qf-continue-btn');
    if (contBtn) contBtn.textContent = rules.showQuoteBeforeContact ? 'Claim this quote →' : 'Get this quote in writing';
  }

  // Demo-only light/dark preset override, forwarded to the config endpoint so
  // the /w/demo showcase toggle can preview the widget in another theme. Absent
  // for real embeds → the tenant's saved theme is used.
  var themePreset = '';
  try { themePreset = new URLSearchParams(location.search).get('preset') || ''; } catch (e) {}

  // Per-tenant MAP STYLE (Customize → Map style). Resolved from the widget
  // config's brand and passed to the base-map + route-preview calls so the map
  // card renders in the carrier's chosen look. null/unknown → 'branded'.
  var brandMapStyle = 'branded';
  function normMapStyle(s) {
    return (s === 'grayscale' || s === 'standard' || s === 'soft' || s === 'dark_routes' || s === 'satellite') ? s : 'branded';
  }

  function init() {
    var cfgUrl = '/api/public/widget/' + slug;
    if (themePreset) cfgUrl += (cfgUrl.indexOf('?') > -1 ? '&' : '?') + 'preset=' + encodeURIComponent(themePreset);
    fetch(withGrant(cfgUrl))
      .then(function (r) { return r.json(); })
      .then(function (cfg) {
        if (cfg.error) { $('qf-root').innerHTML = '<div class="qf-error">' + cfg.error + '</div>'; return; }
        state.config = cfg;
        brandMapStyle = normMapStyle(cfg.brand && cfg.brand.mapStyle);
        // Expose the resolved brand + contact so the /w/demo "brand it
        // yourself" preview can default to the carrier's REAL identity
        // instead of blank "Your company name" placeholders.
        try { window.QF_WIDGET_CONFIG = cfg; } catch (e) { /* ignore */ }
        applyTheme(cfg.theme);
        applyBrand(cfg.brand);
        renderHeader(cfg);
        renderContact(cfg.contact);
        renderServices(cfg.services);
        renderAccessorials(cfg.accessorials);
        autoResize();
      })
      .catch(function () { $('qf-root').innerHTML = '<div class="qf-error">Failed to load widget. Please refresh.</div>'; });

    $('qf-calc-btn').addEventListener('click', onCalculate);
    $('qf-continue-btn').addEventListener('click', function () { showStep('contact'); });
    // "Edit details" on the result — scroll back up to the form so the user can
    // change anything and re-calculate (the form stays live below the estimate).
    var editBtn = $('qf-edit-btn');
    if (editBtn) editBtn.addEventListener('click', function () {
      var t = $('qf-services') || $('qf-equipment') || document.querySelector('.qf-widget');
      if (t && t.scrollIntoView) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    var ltlAdd = $('qf-ltl-add');
    if (ltlAdd) ltlAdd.addEventListener('click', function () { state.ltlItems.push(newLtlItem()); renderLtlItems(); updateLtlSummary(); });
    initOptionsPanel();
    var bookingSummary = $('qf-booking-summary');
    var bookingBody = $('qf-booking-body');
    if (bookingSummary && bookingBody) {
      bookingSummary.addEventListener('click', function () {
        var willOpen = bookingBody.hidden;
        bookingBody.hidden = !willOpen;
        bookingSummary.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
        autoResize();
      });
    }
    initTypeaheads();
    initRouteMapCard();
    initWeightUnit();
    $('qf-back-btn').addEventListener('click', function () { showStep('quote'); });
    $('qf-submit-btn').addEventListener('click', onSubmit);

    var oogCheck = $('qf-oog-check');
    if (oogCheck) oogCheck.addEventListener('change', function () { var fields = $('qf-oog-fields'); if (fields) fields.style.display = oogCheck.checked ? '' : 'none'; autoResize(); });

    var chatOpenBtn = $('qf-chat-open-btn');
    if (chatOpenBtn) {
      chatOpenBtn.addEventListener('click', function () {
        // Reveal the chat panel below the link row (links stay in place — hiding
        // an individual text link would leave a dangling middot separator).
        var cf = $('qf-callback-form'); if (cf) cf.style.display = 'none';
        $('qf-chat').style.display = 'block';
        var input = $('qf-chat-input');
        if (input) input.focus();
        autoResize();
      });
    }
    var chatSendBtn = $('qf-chat-send');
    var chatInput = $('qf-chat-input');
    if (chatSendBtn && chatInput) {
      chatSendBtn.addEventListener('click', sendChatMessage);
      chatInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
      });
    }

    var cbOpen = $('qf-callback-open-btn');
    var cbForm = $('qf-callback-form');
    var cbCancel = $('qf-cb-cancel-btn');
    var cbSend = $('qf-cb-send-btn');
    if (cbOpen && cbForm) {
      cbOpen.addEventListener('click', function () {
        var ch = $('qf-chat'); if (ch) ch.style.display = 'none';
        cbForm.style.display = 'block';
        var phoneIn = $('qf-cb-phone');
        var leadPhone = $('qf-c-phone') && $('qf-c-phone').value;
        if (phoneIn && leadPhone && !phoneIn.value) phoneIn.value = leadPhone;
        if (phoneIn) phoneIn.focus();
        autoResize();
      });
    }
    if (cbCancel && cbForm && cbOpen) {
      cbCancel.addEventListener('click', function () {
        cbForm.style.display = 'none';
        cbOpen.style.display = '';
        showCallbackError(null);
        autoResize();
      });
    }
    if (cbSend) cbSend.addEventListener('click', sendCallbackRequest);

    $('qf-restart-btn').addEventListener('click', function () {
      state.quote = null;
      state.pickupPortCode = '';
      state.pickupTerminalCode = '';
      state.refId = '';
      var msgs = $('qf-chat-msgs'); if (msgs) msgs.innerHTML = '';
      var ct = $('qf-chat-toggle'); if (ct) ct.style.display = '';
      var ch = $('qf-chat'); if (ch) ch.style.display = 'none';
      var cbBtn = $('qf-callback-open-btn'); if (cbBtn) cbBtn.style.display = '';
      var cbForm = $('qf-callback-form'); if (cbForm) cbForm.style.display = 'none';
      var cbSendBtn = $('qf-cb-send-btn'); if (cbSendBtn) cbSendBtn.style.display = '';
      var cbCancelBtn = $('qf-cb-cancel-btn'); if (cbCancelBtn) cbCancelBtn.style.display = '';
      var cbSuccess = $('qf-cb-success'); if (cbSuccess) cbSuccess.style.display = 'none';
      // Remove the injected share/print links + reveal panel so the thanks step
      // is clean if it's ever revisited before the next lead is submitted.
      $$('.qf-share-emailme, .qf-share-print, .qf-tl-sep-injected, .qf-share-panel, .qf-share-status').forEach(function (n) { n.remove(); });
      // Drop any injected "Book this load" button + panel + confirmation too.
      $$('.qf-book-btn, .qf-book-panel, .qf-book-done').forEach(function (n) { n.remove(); });
      var viewQuoteBtn = $('qf-view-quote'); if (viewQuoteBtn) viewQuoteBtn.style.display = 'none';
      ['qf-cb-phone', 'qf-cb-time', 'qf-cb-topic'].forEach(function (id) { var el = $(id); if (el) { el.value = ''; el.disabled = false; } });
      showCallbackError(null);
      $('qf-result').style.display = 'none';
      ['qf-pickup-zip', 'qf-delivery-zip', 'qf-weight', 'qf-booking', 'qf-c-name', 'qf-c-email', 'qf-c-phone', 'qf-c-company', 'qf-c-notes', 'qf-oog-length', 'qf-oog-width', 'qf-oog-height', 'qf-oog-weight', 'qf-oog-notes']
        .forEach(function (id) { var el = $(id); if (el) el.value = ''; });
      state.ltlItems = [];
      if (state.service === 'ltl') { renderLtlItems(); updateLtlSummary(); }
      var oog = $('qf-oog-check'); if (oog) oog.checked = false;
      var oogFields = $('qf-oog-fields'); if (oogFields) oogFields.style.display = 'none';
      var oc = $('qf-ocean-carrier'); if (oc) oc.value = '';
      var pp = $('qf-pickup-port-input'); if (pp) pp.value = '';
      var pt = $('qf-pickup-terminal'); if (pt) pt.value = '';
      // Clear the resolved addresses and revert the map card to the base map.
      state.pickupResolved = null; state.deliveryResolved = null;
      showBaseMap();
      showStep('quote');
    });
  }

  // Two-letter monogram from a business name: first letters of the first two
  // words ("Oakland Trucks" -> "OT"), or the first two letters of a single word.
  function brandInitials(name) {
    var parts = String(name || '').trim().split(/[\s.,-]+/).filter(Boolean);
    if (!parts.length) return 'Q';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
  }
  // Auto-generated initials logo (rounded brand-blue tile) as an inline SVG data
  // URI — used when the carrier hasn't uploaded their own logo.
  function initialsLogo(name, bg) {
    var ini = brandInitials(name);
    var fill = /^#[0-9a-fA-F]{3,8}$/.test(bg || '') ? bg : '#0D3CFC';
    var svg = "<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 96 96'>" +
      "<rect width='96' height='96' rx='22' fill='" + fill + "'/>" +
      "<text x='48' y='48' dy='.35em' text-anchor='middle' font-family='Satoshi,Inter,system-ui,sans-serif' font-size='40' font-weight='800' fill='#ffffff'>" + ini + "</text></svg>";
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }

  function renderHeader(cfg) {
    var h = $('qf-header'); h.innerHTML = '';
    var name = (cfg.brand && cfg.brand.displayName) || cfg.tenant.name;
    if (cfg.brand && cfg.brand.logoUrl) {
      h.appendChild(el('img', { src: cfg.brand.logoUrl, alt: name }));
    } else {
      // No custom logo → auto-generate a 2-letter initials tile from the name.
      var bg = (cfg.brand && (cfg.brand.primaryColor || cfg.brand.accentColor)) || '#0D3CFC';
      h.appendChild(el('img', { src: initialsLogo(name, bg), alt: name, class: 'qf-brand-initials' }));
    }
    h.appendChild(el('div', { class: 'brand-name', text: name }));
    var tagline = (cfg.brand && cfg.brand.tagline) || 'Get an instant freight quote';
    $('qf-tagline').textContent = tagline;
    if (cfg.brand && cfg.brand.showPoweredBy) $('qf-powered').innerHTML = 'Powered by <a href="' + location.origin + '" target="_blank">QuoteFleet</a>';
    else $('qf-powered').textContent = '';
    var noteEl = $('qf-footer-note');
    if (noteEl) {
      var note = cfg.brand && cfg.brand.footerNote ? String(cfg.brand.footerNote).trim() : '';
      if (note) { noteEl.textContent = note; noteEl.style.display = ''; }
      else { noteEl.textContent = ''; noteEl.style.display = 'none'; }
    }
    if (cfg.brand && cfg.brand.ctaText) $('qf-calc-btn').textContent = cfg.brand.ctaText;
  }

  // Carrier contact block under the header — same details customers see on
  // the hosted quote. Only rendered when the carrier has filled them in
  // (Account → Company details / Profile phone), so an empty profile stays
  // clean.
  function renderContact(contact) {
    var box = $('qf-contact');
    if (!box) return;
    box.innerHTML = '';
    if (!contact) { box.style.display = 'none'; return; }
    var rows = [];
    function iconRow(label, value, href) {
      var row = el('span', { class: 'qf-contact-item' });
      row.appendChild(el('span', { class: 'qf-contact-label', text: label }));
      if (href) {
        row.appendChild(el('a', { class: 'qf-contact-value', href: href, text: value }));
      } else {
        row.appendChild(el('span', { class: 'qf-contact-value', text: value }));
      }
      return row;
    }
    if (contact.phone) rows.push(iconRow('Phone', contact.phone, 'tel:' + contact.phone.replace(/[^+0-9]/g, '')));
    if (contact.email) rows.push(iconRow('Email', contact.email, 'mailto:' + contact.email));
    if (contact.chat) {
      var chatRow = el('span', { class: 'qf-contact-item' });
      chatRow.appendChild(el('span', { class: 'qf-contact-label', text: 'Chat' }));
      var chatLink = el('a', { class: 'qf-contact-value qf-contact-chat', href: 'mailto:' + contact.chat });
      chatLink.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg> Chat with us';
      chatRow.appendChild(chatLink);
      rows.push(chatRow);
    }
    if (contact.address) rows.push(iconRow('Address', contact.address));
    var ids = [];
    if (contact.dotNumber) ids.push('USDOT ' + contact.dotNumber);
    if (contact.mcNumber) ids.push('MC ' + contact.mcNumber);
    if (ids.length) rows.push(iconRow('Authority', ids.join(' · ')));
    if (!rows.length) { box.style.display = 'none'; return; }
    rows.forEach(function (r) { box.appendChild(r); });
    box.style.display = '';
  }

  // ── LTL freight-class estimate (client-side mirror of the server scale) ──
  var LTL_DENSITY_SCALE = [[50, 50], [35, 55], [30, 60], [22.5, 65], [15, 70], [13.5, 77.5], [12, 85], [10.5, 92.5], [9, 100], [8, 110], [7, 125], [6, 150], [5, 175], [4, 200], [3, 250], [2, 300], [1, 400], [0, 500]];
  function ltlClientClass(w, l, wd, h) {
    if (!(w > 0 && l > 0 && wd > 0 && h > 0)) return null;
    var cf = (l * wd * h) / 1728;
    if (cf <= 0) return null;
    var d = w / cf;
    for (var i = 0; i < LTL_DENSITY_SCALE.length; i++) { if (d >= LTL_DENSITY_SCALE[i][0]) return { cls: LTL_DENSITY_SCALE[i][1], pcf: d, cf: cf }; }
    return { cls: 500, pcf: d, cf: cf };
  }
  // Weight the user typed, converted to POUNDS — the unit the quote + LTL-class
  // math expect. The lbs/kg toggle flips state.weightUnit; kg is converted here
  // so a metric input never distorts the rate. Returns null when empty/invalid.
  function weightLbs() {
    var el = $('qf-weight'); var v = el ? Number(el.value) : NaN;
    if (!v || !isFinite(v) || v <= 0) return null;
    return Math.round(state.weightUnit === 'kg' ? v * 2.2046226 : v);
  }
  function initWeightUnit() {
    var wrap = $('qf-wt-unit'); if (!wrap) return;
    var btns = Array.prototype.slice.call(wrap.querySelectorAll('button'));
    btns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.weightUnit = btn.getAttribute('data-unit') === 'kg' ? 'kg' : 'lbs';
        btns.forEach(function (b) {
          var on = b === btn;
          b.classList.toggle('is-on', on);
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        var inp = $('qf-weight');
        if (inp) inp.placeholder = state.weightUnit === 'kg' ? 'e.g. 17000' : 'e.g. 38000';
        updateLtlClassReadout();
      });
    });
  }
  // Map a density (lb/ft³) to an NMFC freight class using the same scale as
  // ltlClientClass — factored out so the LTL summary can aggregate ALL items
  // into one density and read the class off the same table.
  function ltlClassFromDensity(d) {
    if (!(d > 0)) return null;
    for (var i = 0; i < LTL_DENSITY_SCALE.length; i++) { if (d >= LTL_DENSITY_SCALE[i][0]) return LTL_DENSITY_SCALE[i][1]; }
    return 500;
  }
  var LB_PER_KG = 2.2046226, IN_PER_CM = 1 / 2.54;
  function newLtlItem() { return { commodity: '', freightType: 'General', qty: '1', length: '', width: '', height: '', dimUnit: 'in', weight: '', wtUnit: 'lb' }; }
  function ensureLtlItem() { if (!state.ltlItems.length) state.ltlItems.push(newLtlItem()); }
  // Per-item + aggregate LTL math, all normalized to inches + pounds. cubicFt is
  // summed across items (each item's footprint × its quantity); the aggregate
  // freight class comes from totalWeight ÷ totalCubicFt.
  function ltlTotals() {
    // totWt = every item's weight (summary + payload). densWt = only the weight
    // of items that ALSO have full L/W/H, so the aggregate density (and freight
    // class) is computed from weight and volume that actually match. Counting a
    // dimensionless item's weight in the density numerator without its volume
    // inflated density and produced a wrongly-cheap class.
    var totWt = 0, densWt = 0, totPieces = 0, totCf = 0, maxDims = { l: 0, w: 0, h: 0 }, maxVol = -1, valid = 0;
    state.ltlItems.forEach(function (it) {
      var qty = Math.max(0, Number(it.qty) || 0);
      var toIn = it.dimUnit === 'cm' ? IN_PER_CM : 1;
      var l = (Number(it.length) || 0) * toIn, w = (Number(it.width) || 0) * toIn, h = (Number(it.height) || 0) * toIn;
      var wLbs = (Number(it.weight) || 0) * (it.wtUnit === 'kg' ? LB_PER_KG : 1);
      if (qty > 0) { totWt += wLbs; totPieces += qty; }
      if (l > 0 && w > 0 && h > 0 && qty > 0) {
        totCf += (l * w * h / 1728) * qty;
        densWt += wLbs;
        var vol = l * w * h;
        if (vol > maxVol) { maxVol = vol; maxDims = { l: l, w: w, h: h }; }
        if (wLbs > 0) valid++;
      }
    });
    var density = totCf > 0 ? densWt / totCf : 0;
    return { weightLbs: Math.round(totWt), pieces: totPieces, cubicFt: totCf, density: density, cls: ltlClassFromDensity(density), maxDims: maxDims, validItems: valid };
  }
  function updateLtlSummary() {
    if (state.service !== 'ltl') return;
    var t = ltlTotals();
    var kg = Math.round(t.weightLbs / LB_PER_KG);
    var wEl = $('qf-ltl-sum-weight'); if (wEl) wEl.textContent = t.weightLbs > 0 ? (t.weightLbs.toLocaleString() + ' lb / ' + kg.toLocaleString() + ' kg') : '—';
    var pEl = $('qf-ltl-sum-pieces'); if (pEl) pEl.textContent = t.pieces > 0 ? String(t.pieces) : '0';
    var cEl = $('qf-ltl-sum-class'); if (cEl) cEl.textContent = t.cls ? ('Class ' + t.cls) : '—';
    autoResize();
  }
  // Rebuild the item rows from state.ltlItems. Only called on add/remove (not on
  // keystroke) so typing never steals focus; per-field input handlers write back
  // to the item object and refresh the summary in place.
  function renderLtlItems() {
    var host = $('qf-ltl-items'); if (!host) return;
    ensureLtlItem();
    host.innerHTML = '';
    var multi = state.ltlItems.length > 1;
    var FREIGHT_TYPES = ['General', 'Fragile', 'Hazardous', 'Temperature-controlled'];
    state.ltlItems.forEach(function (item, idx) {
      function bind(inp, key) { inp.value = item[key] != null ? item[key] : ''; inp.addEventListener('input', function () { item[key] = inp.value; updateLtlSummary(); }); inp.addEventListener('change', function () { item[key] = inp.value; updateLtlSummary(); }); return inp; }
      function numField(key, ph) {
        var inp = el('input', { class: 'qf-input', type: 'number', min: '0', inputmode: 'decimal', placeholder: ph, 'aria-label': ph });
        return el('div', { class: 'qf-field' }, [bind(inp, key)]);
      }
      function unitField(key, opts) {
        var sel = el('select', { class: 'qf-select' });
        opts.forEach(function (o) { var op = document.createElement('option'); op.value = o; op.textContent = o; sel.appendChild(op); });
        return el('div', { class: 'qf-field qf-ltl-unit' }, [bind(sel, key)]);
      }
      var commodity = el('input', { class: 'qf-input', type: 'text', placeholder: 'Commodity (e.g. furniture)', 'aria-label': 'Commodity description' });
      var ftype = el('select', { class: 'qf-select', 'aria-label': 'Freight type' });
      FREIGHT_TYPES.forEach(function (o) { var op = document.createElement('option'); op.value = o; op.textContent = o; ftype.appendChild(op); });
      var rowA = el('div', { class: 'qf-ltl-row-a' }, [
        el('div', { class: 'qf-field qf-ltl-commodity' }, [bind(commodity, 'commodity')]),
        el('div', { class: 'qf-field qf-ltl-ftype' }, [bind(ftype, 'freightType')]),
      ]);
      // Row B is two full-width grids so it never leaves blank gaps on mobile:
      // [Qty | L | W | H | in/cm] on one line, [Combined wt. | lb/kg] below.
      var qtyField = el('div', { class: 'qf-field qf-ltl-qty' }, [bind(el('input', { class: 'qf-input', type: 'number', min: '1', inputmode: 'numeric', placeholder: 'Qty', 'aria-label': 'Quantity' }), 'qty')]);
      var dims = el('div', { class: 'qf-ltl-dims' }, [qtyField, numField('length', 'Length'), numField('width', 'Width'), numField('height', 'Height'), unitField('dimUnit', ['in', 'cm'])]);
      var wt = el('div', { class: 'qf-ltl-wt' }, [numField('weight', 'Combined wt.'), unitField('wtUnit', ['lb', 'kg'])]);
      var rowB = el('div', { class: 'qf-ltl-row-b' }, [dims, wt]);
      var group = el('div', { class: 'qf-ltl-item' }, [rowA, rowB]);
      if (multi) {
        var x = el('button', { class: 'qf-ltl-remove', type: 'button', 'aria-label': 'Remove item', title: 'Remove item', text: '✕', on: { click: function () { state.ltlItems.splice(idx, 1); renderLtlItems(); updateLtlSummary(); } } });
        group.appendChild(x);
      }
      host.appendChild(group);
    });
    var remark = $('qf-ltl-remark');
    if (remark) {
      var contact = (state.config && state.config.contact) || {};
      var how = contact.phone ? ('call ' + contact.phone) : (contact.email ? ('email ' + contact.email) : 'contact us');
      remark.textContent = 'Rates provided are based on stackable freight. If you have freight that is non-stackable, please ' + how + ' for a quote.';
    }
    autoResize();
  }
  // Kept as an alias so the shared weight-unit toggle handler stays valid; in
  // LTL mode weight now comes from the item rows, so it just refreshes the summary.
  function updateLtlClassReadout() { updateLtlSummary(); }
  function syncLtlPanel() {
    var panel = $('qf-ltl-panel');
    var isLtl = state.service === 'ltl';
    // LTL is priced by class from size + weight, so the carrier-truck equipment
    // picker and the single top-line weight field don't apply — hide the whole
    // equipment/weight row in LTL and restore it for every other service.
    var equipRow = $('qf-equip-weight-row');
    if (equipRow) equipRow.style.display = isLtl ? 'none' : '';
    // Mark LTL mode on the root so CSS can collapse the now-empty gap the hidden
    // equipment/weight row would otherwise leave under the service tabs.
    var root = $('qf-root'); if (root) root.classList.toggle('qf-ltl-mode', isLtl);
    if (!panel) return;
    panel.style.display = isLtl ? '' : 'none';
    if (isLtl) { ensureLtlItem(); renderLtlItems(); updateLtlSummary(); }
  }

  function renderServices(services) {
    var wrap = $('qf-services'); wrap.innerHTML = '';
    if (!services.length) { $('qf-error').style.display = 'block'; $('qf-error').textContent = 'No services configured. Contact us directly.'; return; }
    var labels = { drayage: 'Drayage', ftl: 'FTL', ltl: 'LTL', expedited: 'Expedite', hotshot: 'Hotshot' };
    services.forEach(function (s, i) {
      var btn = el('button', { class: i === 0 ? 'active' : '', text: labels[s] || s, on: { click: function () { selectService(s); } } });
      btn.dataset.service = s;
      wrap.appendChild(btn);
    });
    selectService(services[0]);
  }

  function selectService(service) {
    state.service = service;
    $$('#qf-services button').forEach(function (b) { b.classList.toggle('active', b.dataset.service === service); });
    var equip = state.config.equipmentByService[service] || [];
    if (service === 'drayage') equip = withDrayageEquipmentDefaults(equip);
    var sel = $('qf-equipment');
    sel.innerHTML = '';
    equip.forEach(function (e) { var opt = document.createElement('option'); opt.value = e.value; opt.textContent = normalizeEquipmentLabel(e.label || e.value, service); sel.appendChild(opt); });
    state.equipment = equip[0] ? equip[0].value : null;
    sel.onchange = function () { state.equipment = sel.value; syncOogPanel(); };
    renderAccessorials(state.config.accessorials);
    var isDrayage = service === 'drayage';
    var drayPickup = $('qf-drayage-pickup');
    var defaultPickup = $('qf-default-pickup');
    if (drayPickup) drayPickup.style.display = isDrayage ? '' : 'none';
    if (defaultPickup) defaultPickup.style.display = isDrayage ? 'none' : '';
    if (isDrayage) renderPorts();
    // renderPorts() may fall back to the default (non-drayage) layout when no
    // ports are configured — so read the resolved display, not just `service`.
    var drayActive = isDrayage && drayPickup && drayPickup.style.display !== 'none';
    placeDeliveryColumn(drayActive);
    placeAddrHint(drayActive);
    if (defaultPickup) defaultPickup.style.display = drayActive ? 'none' : '';
    scheduleRouteMap();
    syncOogPanel();
    syncLtlPanel();
    autoResize();
  }

  // Move the SAME delivery column node between the drayage two-column row and
  // its original shared address row — never clone, so its typeahead listeners
  // survive. In drayage it sits beside the pickup-port column; otherwise it
  // returns to its home next to the default pickup field.
  function placeDeliveryColumn(intoDrayage) {
    var delivery = $('qf-default-delivery');
    if (!delivery) return;
    var target = intoDrayage ? $('qf-drayage-row') : $('qf-default-addr-row');
    if (target && delivery.parentNode !== target) target.appendChild(delivery);
  }

  // Keep the address hint attached to the field it describes. In drayage the
  // delivery column moves into the two-column row, so the hint moves with it —
  // appended inside the delivery column, directly under the delivery field
  // (this also fills the void beside the taller port+terminal column). For all
  // other modes it returns to its full-width home just below the shared row.
  function placeAddrHint(intoDrayage) {
    var hint = $('qf-addr-hint');
    if (!hint) return;
    if (intoDrayage) {
      var delivery = $('qf-default-delivery');
      if (delivery && hint.parentNode !== delivery) delivery.appendChild(hint);
    } else {
      var defRow = $('qf-default-addr-row');
      if (defRow && hint.previousElementSibling !== defRow) defRow.insertAdjacentElement('afterend', hint);
    }
  }

  function renderPorts() {
    var input = $('qf-pickup-port-input');
    var box = $('qf-pickup-port-suggestions');
    if (!input || !box) return;
    var ports = (state.config && state.config.drayagePorts) || [];
    if (ports.length === 0) { var dp = $('qf-default-pickup'); if (dp) dp.style.display = ''; var dr = $('qf-drayage-pickup'); if (dr) dr.style.display = 'none'; return; }
    function close() { box.classList.remove('open'); box.innerHTML = ''; }
    function render(list) {
      box.innerHTML = '';
      if (!list.length) { close(); return; }
      list.slice(0, 10).forEach(function (p) {
        var item = document.createElement('div');
        item.className = 'qf-suggestion';
        var label = p.name;
        if (p.state) label += ', ' + p.state;
        item.innerHTML = label + '<span class="meta">' + escapeHtml(p.code) + '</span>';
        item.addEventListener('mousedown', function (e) { e.preventDefault(); input.value = (p.state ? p.name + ', ' + p.state : p.name); state.pickupPortCode = p.code; close(); renderTerminals(); });
        box.appendChild(item);
      });
      box.classList.add('open');
    }
    function filter(q) {
      q = (q || '').toLowerCase().trim();
      if (!q) return ports.slice(0, 10);
      return ports.filter(function (p) { return p.name.toLowerCase().includes(q) || (p.city || '').toLowerCase().includes(q) || p.code.toLowerCase().includes(q) || (p.state || '').toLowerCase().includes(q); });
    }
    input.oninput = function () { state.pickupPortCode = ''; state.pickupTerminalCode = ''; render(filter(input.value)); };
    input.onfocus = function () { render(filter(input.value)); };
    input.onblur = function () { setTimeout(close, 120); };
    input.onkeydown = function (e) { if (e.key === 'Escape') close(); };
    if (state.pickupPortCode) {
      var pre = ports.find(function (p) { return p.code === state.pickupPortCode; });
      if (pre) input.value = pre.name + (pre.state ? ', ' + pre.state : '');
    } else input.value = '';
    renderTerminals();
  }

  function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]); }); }

  function appendChatBubble(role, text) {
    var msgs = $('qf-chat-msgs'); if (!msgs) return null;
    var b = document.createElement('div'); b.className = 'qf-chat-bubble ' + role; b.textContent = text; msgs.appendChild(b); msgs.scrollTop = msgs.scrollHeight; autoResize(); return b;
  }

  function sendChatMessage() {
    if (!state.refId) return;
    var input = $('qf-chat-input'); var msg = (input.value || '').trim(); if (!msg) return;
    appendChatBubble('user', msg); input.value = '';
    var thinking = appendChatBubble('thinking', 'Thinking…'); var sendBtn = $('qf-chat-send'); if (sendBtn) sendBtn.disabled = true;
    fetch(withGrant('/api/public/chat/' + encodeURIComponent(state.refId)), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: msg }) })
      .then(function (r) { return r.json(); })
      .then(function (resp) { if (thinking) thinking.remove(); if (sendBtn) sendBtn.disabled = false; if (resp.error) { appendChatBubble('assistant', 'Sorry — ' + resp.error); return; } appendChatBubble('assistant', resp.reply || '(no reply)'); })
      .catch(function () { if (thinking) thinking.remove(); if (sendBtn) sendBtn.disabled = false; appendChatBubble('assistant', 'Connection error. Try again in a moment.'); });
  }

  function showCallbackError(msg) { var e = $('qf-cb-error'); if (!e) return; if (msg) { e.textContent = msg; e.style.display = 'block'; } else { e.style.display = 'none'; e.textContent = ''; } }

  function sendCallbackRequest() {
    if (!state.refId) return;
    showCallbackError(null);
    var phoneEl = $('qf-cb-phone'); var timeEl = $('qf-cb-time'); var topicEl = $('qf-cb-topic');
    var phone = (phoneEl && phoneEl.value || '').trim();
    if (phone.length < 5) { showCallbackError('Please enter a phone number we can call.'); return; }
    var name = ($('qf-c-name') && $('qf-c-name').value || '').trim() || 'Customer';
    var email = ($('qf-c-email') && $('qf-c-email').value || '').trim();
    var company = ($('qf-c-company') && $('qf-c-company').value || '').trim();
    var btn = $('qf-cb-send-btn'); var oldText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="qf-spinner"></span> &nbsp; Sending…'; }
    fetch(withGrant('/api/public/callback/' + encodeURIComponent(state.refId)), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerName: name, customerPhone: phone, customerEmail: email || undefined, customerCompany: company || undefined, preferredTime: (timeEl && timeEl.value || '').trim() || undefined, topic: (topicEl && topicEl.value || '').trim() || undefined, triggerSource: 'visitor_button' }) })
      .then(function (r) { return r.json(); })
      .then(function (resp) {
        if (btn) { btn.disabled = false; btn.textContent = oldText; }
        if (resp.error) { showCallbackError(resp.error); return; }
        var success = $('qf-cb-success'); if (success) { success.textContent = '✓ Got it. We\'ll call ' + phone + ' soon.'; success.style.display = 'block'; }
        ['qf-cb-phone', 'qf-cb-time', 'qf-cb-topic'].forEach(function (id) { var el = $(id); if (el) el.disabled = true; });
        if (btn) btn.style.display = 'none'; var cancel = $('qf-cb-cancel-btn'); if (cancel) cancel.style.display = 'none'; autoResize();
      })
      .catch(function () { if (btn) { btn.disabled = false; btn.textContent = oldText; } showCallbackError('Connection error. Try again in a moment.'); });
  }

  function renderTerminals() {
    var sel = $('qf-pickup-terminal'); if (!sel) return;
    var port = state.pickupPortCode; var byPort = (state.config && state.config.terminalsByPort) || {}; var list = port ? (byPort[port] || []) : [];
    sel.innerHTML = '';
    var dunno = document.createElement('option'); dunno.value = ''; dunno.textContent = "— I don't know yet —"; sel.appendChild(dunno);
    list.forEach(function (t) { var opt = document.createElement('option'); opt.value = t.code; opt.textContent = t.name + (t.carrier ? '  (' + t.carrier + ')' : ''); sel.appendChild(opt); });
    sel.value = state.pickupTerminalCode || '';
    sel.onchange = function () { state.pickupTerminalCode = sel.value; };
  }

  // Fallback one-line explanations for add-ons whose config row ships without a
  // description, so EVERY add-on button carries a help cue (task: consistency).
  var ACCESSORIAL_HELP = {
    driver_assist: 'Driver helps load or unload the freight by hand.',
    extra_stop: 'An additional pickup or delivery stop on the same run.',
    tarping: 'Cargo must be covered and secured with tarps on an open deck.',
    scale_ticket: 'Certified scale ticket or weight verification.',
    bonded_move: 'Bonded / in-bond handling or customs-controlled delivery.',
    weekend_after_hours: 'Pickup or delivery outside normal business hours.',
    redelivery: 'Second delivery attempt after the receiver was unavailable.',
    limited_access: 'Pickup or delivery at a limited-access location (site, school, farm).',
    sort_and_segregate: 'Driver must sort, count, or separate the freight on delivery.',
    lumper: 'Warehouse lumper or third-party unloading fee.',
    extra_straps_chains: 'Additional straps or chains beyond standard securement.',
    oversize_permit: 'Permit required because cargo exceeds legal dimensions.',
  };
  function accessorialTip(a) {
    return (a && a.description) || ACCESSORIAL_HELP[a && a.code] || ('Optional add-on: ' + ((a && a.label) || 'extra service') + '.');
  }

  function renderAccessorials(list) {
    var wrap = $('qf-accessorials'); wrap.innerHTML = '';
    var visible = (list || []).filter(function (a) { if (!a.appliesToServices || a.appliesToServices.length === 0) return true; return a.appliesToServices.indexOf(state.service) >= 0; });
    if (!visible.length) { wrap.appendChild(el('span', { class: 'qf-tagline', text: 'No optional add-ons for this service.' })); return; }
    visible.forEach(function (a) {
      var chip = el('button', { class: 'qf-acc-chip' + (state.selectedAccessorials.indexOf(a.code) >= 0 ? ' active' : ''), on: { click: function (ev) { ev.preventDefault(); if (ev.target && ev.target.closest && ev.target.closest('.qf-help')) return; var i = state.selectedAccessorials.indexOf(a.code); if (i >= 0) state.selectedAccessorials.splice(i, 1); else state.selectedAccessorials.push(a.code); chip.classList.toggle('active'); } } }, [
        el('span', { class: 'qf-acc-label', text: a.label }),
        el('span', { class: 'qf-help', 'data-tip': accessorialTip(a), text: '?', role: 'button', tabindex: '0', 'aria-expanded': 'false', 'aria-label': 'More information', 'data-qf-help-ready': '1' }),
      ]);
      wrap.appendChild(chip);
    });
  }

  function initOptionsPanel() {
    var summary = $('qf-options-summary');
    var modal = $('qf-options-modal');
    if (!summary || !modal) return;
    var countEl = $('qf-options-count');
    var card = modal.querySelector('.qf-modal-card');

    function updateCount() {
      var n = 0;
      ['qf-residential', 'qf-hazmat', 'qf-temp'].forEach(function (id) { var c = $(id); if (c && c.checked) n++; });
      n += (state.selectedAccessorials ? state.selectedAccessorials.length : 0);
      if (!countEl) return;
      if (n > 0) { countEl.textContent = n + ' selected'; countEl.hidden = false; }
      else { countEl.hidden = true; }
    }

    function openModal() {
      modal.hidden = false;
      document.body.classList.add('qf-modal-open');
      summary.setAttribute('aria-expanded', 'true');
      if (card) card.scrollTop = 0;
    }
    function closeModal() {
      modal.hidden = true;
      document.body.classList.remove('qf-modal-open');
      summary.setAttribute('aria-expanded', 'false');
      updateCount();
      summary.focus();
    }

    summary.addEventListener('click', openModal);
    modal.querySelectorAll('[data-qf-close]').forEach(function (el) { el.addEventListener('click', closeModal); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !modal.hidden) closeModal(); });
    // Flags fire 'change'; accessorial chips are buttons — recount after their click handler runs.
    modal.addEventListener('change', updateCount);
    modal.addEventListener('click', function () { setTimeout(updateCount, 0); });
    updateCount();
  }

  function showStep(name) { ['quote', 'contact', 'thanks'].forEach(function (n) { var s = $('qf-step-' + n); if (s) s.classList.toggle('active', n === name); }); autoResize(); }
  function showError(id, msg) { var e = $(id); if (msg) { e.textContent = msg; e.style.display = 'block'; } else { e.style.display = 'none'; } }

  function gatherQuoteRequest() {
    var isDrayage = state.service === 'drayage';
    var pickup;
    if (isDrayage && state.pickupPortCode) pickup = { portCode: state.pickupPortCode, terminalCode: state.pickupTerminalCode || undefined };
    else if (state.pickupResolved) pickup = mergeLocation(state.pickupResolved, $('qf-pickup-zip').value);
    else pickup = parseLocation(($('qf-pickup-zip') && $('qf-pickup-zip').value) || '');
    var deliveryText = $('qf-delivery-zip').value;
    var delivery = state.deliveryResolved ? mergeLocation(state.deliveryResolved, deliveryText) : parseLocation(deliveryText);
    var oceanEl = $('qf-ocean-carrier'); var bookingEl = $('qf-booking'); var pickupDateEl = $('qf-pickup-date');
    var req = {
      service: state.service,
      equipment: state.equipment,
      pickup: pickup,
      delivery: delivery,
      weightLbs: weightLbs() || undefined,
      oceanCarrier: oceanEl && oceanEl.value ? oceanEl.value : undefined,
      bookingNumber: bookingEl && bookingEl.value ? bookingEl.value.trim() : undefined,
      selectedAccessorialCodes: state.selectedAccessorials.slice(),
      flags: { residential: $('qf-residential').checked, hazmat: $('qf-hazmat').checked, tempControlled: $('qf-temp').checked },
      meta: {},
    };
    if (state.service === 'ltl') {
      // Item-based LTL: aggregate every commodity row into the SAME payload the
      // server already expects. weightLbs = total pounds; length/width/height =
      // the LARGEST single item's footprint (inches) so existing server checks
      // pass; equipment is fixed (not user-selectable in LTL). The per-item
      // breakdown + computed class ride under the flexible meta object.
      var t = ltlTotals();
      req.equipment = state.equipment || 'ltl_pallet';
      if (t.weightLbs > 0) req.weightLbs = t.weightLbs;
      if (t.maxDims.l > 0) req.lengthIn = Math.round(t.maxDims.l);
      if (t.maxDims.w > 0) req.widthIn = Math.round(t.maxDims.w);
      if (t.maxDims.h > 0) req.heightIn = Math.round(t.maxDims.h);
      req.flags.palletized = true;
      req.flags.loadedFromDock = true;
      req.meta.ltlClass = t.cls || undefined;
      req.meta.ltlItems = state.ltlItems.map(function (it) {
        var toIn = it.dimUnit === 'cm' ? IN_PER_CM : 1;
        return {
          commodity: (it.commodity || '').trim() || undefined,
          freightType: it.freightType || 'General',
          quantity: Math.max(0, Number(it.qty) || 0),
          lengthIn: Math.round((Number(it.length) || 0) * toIn) || undefined,
          widthIn: Math.round((Number(it.width) || 0) * toIn) || undefined,
          heightIn: Math.round((Number(it.height) || 0) * toIn) || undefined,
          weightLbs: Math.round((Number(it.weight) || 0) * (it.wtUnit === 'kg' ? LB_PER_KG : 1)) || undefined,
        };
      });
    }
    if (hasPostalCode(deliveryText, delivery)) req.meta.deliveryZipConfirmed = true;
    var oogCheck = $('qf-oog-check');
    if (oogCheck && oogCheck.checked) {
      req.meta.oversize = {
        length: ($('qf-oog-length') && $('qf-oog-length').value || '').trim() || undefined,
        width: ($('qf-oog-width') && $('qf-oog-width').value || '').trim() || undefined,
        height: ($('qf-oog-height') && $('qf-oog-height').value || '').trim() || undefined,
        weight: ($('qf-oog-weight') && $('qf-oog-weight').value || '').trim() || undefined,
        notes: ($('qf-oog-notes') && $('qf-oog-notes').value || '').trim() || undefined,
      };
    }
    if (pickupDateEl && pickupDateEl.value) req.pickupDate = pickupDateEl.value;
    return req;
  }

  function onCalculate(e) {
    e && e.preventDefault(); showError('qf-error', null); var req = gatherQuoteRequest();
    if (!req.equipment) { showError('qf-error', 'Please pick an equipment type.'); return; }
    var hasPickup = !!(req.pickup.zip || req.pickup.city || req.pickup.portCode);
    if (!hasPickup) { showError('qf-error', 'Please pick a pickup port (drayage) or enter a pickup ZIP/postal code.'); return; }
    if (!req.delivery.zip && !req.delivery.city) { showError('qf-error', 'Please enter a delivery ZIP/postal code.'); return; }
    if (!hasPostalCode($('qf-delivery-zip').value, req.delivery)) { showError('qf-error', 'Please enter a delivery ZIP/postal code for a more accurate rate. City-only delivery can change the price in large metro areas.'); return; }
    if (req.service === 'ltl') {
      var lt = ltlTotals();
      if (lt.validItems < 1) { showError('qf-error', 'Add at least one item with its weight and length / width / height so we can determine the freight class.'); return; }
    }
    if (!(req.weightLbs > 0)) { showError('qf-error', req.service === 'ltl' ? 'Enter the shipment weight — LTL is priced by weight and size.' : 'Enter the load weight (lbs).'); return; }
    if (req.service === 'ltl') {
      if (!(req.lengthIn > 0 && req.widthIn > 0 && req.heightIn > 0)) { showError('qf-error', 'Enter length, width, and height for each item so we can determine the freight class.'); return; }
    }
    var oogCheck = $('qf-oog-check');
    if (isOpenTopOrFlatRack(req.equipment) && oogCheck && oogCheck.checked) {
      var hasDims = ($('qf-oog-height').value || $('qf-oog-width').value || $('qf-oog-length').value || $('qf-oog-notes').value || '').trim();
      if (!hasDims) { showError('qf-error', 'Please add oversize dimensions or notes for open top / flat rack review.'); return; }
    }
    var btn = $('qf-calc-btn'); var oldText = btn.textContent; btn.disabled = true; btn.innerHTML = '<span class="qf-spinner"></span> &nbsp; Calculating…';
    fetch(withGrant('/api/public/quote/' + slug), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req) })
      .then(function (r) { return r.json(); })
      .then(function (resp) { btn.disabled = false; btn.textContent = oldText; if (resp.error) { showError('qf-error', resp.error); return; } if (resp.result && resp.result.unsupported) { showError('qf-error', resp.result.unsupported.reason); return; } state.quote = resp; renderResult(resp); })
      .catch(function (err) { btn.disabled = false; btn.textContent = oldText; showError('qf-error', 'Network error — please try again.'); console.error(err); });
  }

  var SERVICE_LABELS = { drayage: 'Drayage', ftl: 'FTL', ltl: 'LTL', expedited: 'Expedite', hotshot: 'Hotshot' };
  function friendlyEquipmentLabel() {
    // Prefer the exact human label shown in the equipment dropdown; fall back
    // to normalizing the raw value so the estimate meta never shows a raw code
    // like "container_40" or "dry_van".
    var sel = $('qf-equipment');
    if (sel && sel.options && sel.selectedIndex >= 0 && sel.options[sel.selectedIndex]) {
      var t = (sel.options[sel.selectedIndex].textContent || '').trim();
      if (t) return t;
    }
    return normalizeEquipmentLabel(state.equipment || '', state.service);
  }

  // Count a number up to its final value (ease-out cubic) for the price reveal.
  function animateNumber(node, to, fmt, dur) {
    if (!node) return;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !window.requestAnimationFrame) { node.textContent = fmt(to); return; }
    var start = null;
    function step(ts) {
      if (start === null) start = ts;
      var p = Math.min(1, (ts - start) / dur);
      node.textContent = fmt(to * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step); else node.textContent = fmt(to);
    }
    requestAnimationFrame(step);
  }

  function renderResult(resp) {
    var r = resp.result;
    animateNumber($('qf-total'), r.total, fmtMoney, 750);
    var serviceLabel = SERVICE_LABELS[state.service] || (state.service ? titleizeWord(state.service) : 'Truck');
    var metaText = 'Approx. ' + Math.round(resp.miles) + ' mi · ' + serviceLabel + ' · ' + friendlyEquipmentLabel();
    if (r.ltl && r.ltl.freightClass) metaText += ' · Class ' + r.ltl.freightClass;
    $('qf-meta').textContent = metaText;
    var eta = $('qf-eta');
    if (eta) {
      if (resp.transit && resp.transit.text) {
        eta.textContent = 'Est. transit: ' + resp.transit.text + ' — estimate only, not guaranteed';
        eta.style.display = '';
      } else { eta.textContent = ''; eta.style.display = 'none'; }
    }
    var lines = $('qf-lines'); lines.innerHTML = '';
    r.lines.forEach(function (l) { var row = el('div', { class: 'line' }, [el('span', { class: 'name', text: l.name }), el('span', { class: 'amt', text: '$' + fmtMoney(l.amount) })]); lines.appendChild(row); });
    var totalRow = el('div', { class: 'line total-row' }, [el('span', { class: 'name', text: 'Total' }), el('span', { class: 'amt', text: '$' + fmtMoney(r.total) })]);
    lines.appendChild(totalRow);
    renderDisclaimer();
    $('qf-result').style.display = 'block';
    // Reveal the transit timeline — the truck glides from pickup to delivery.
    var tl = $('qf-timeline');
    if (tl) {
      var mid = $('qf-tl-mid');
      if (mid) mid.textContent = (resp.transit && resp.transit.text) ? resp.transit.text : 'In transit';
      tl.hidden = false;
      tl.classList.remove('show');
      void tl.offsetWidth; // reflow so the width/translate transition runs
      tl.classList.add('show');
    }
    autoResize();
  }

  // Terms / disclaimer shown at the bottom of the result card. The server
  // resolves the carrier's own text (or the platform default) into
  // cfg.disclaimer, so this just renders whatever string it's given.
  function renderDisclaimer() {
    var box = $('qf-disclaimer');
    if (!box) return;
    var d = (state.config && state.config.disclaimer) || '';
    box.innerHTML = '';
    if (!d) { box.style.display = 'none'; return; }
    box.appendChild(el('span', { class: 'qf-disclaimer-title', text: 'Terms' }));
    box.appendChild(el('p', { class: 'qf-disclaimer-text', text: d }));
    box.style.display = 'block';
  }

  function onSubmit(e) {
    e && e.preventDefault(); showError('qf-submit-error', null); var rules = getContactRules();
    var name = $('qf-c-name').value.trim(); var email = $('qf-c-email').value.trim(); var phone = $('qf-c-phone').value.trim();
    if (!name) { showError('qf-submit-error', 'Please enter your name.'); return; }
    if (rules.requireEmail) { if (!email || !/^\S+@\S+\.\S+$/.test(email)) { showError('qf-submit-error', 'Please enter a valid email.'); return; } }
    else if (email && !/^\S+@\S+\.\S+$/.test(email)) { showError('qf-submit-error', 'That email looks invalid — clear it or fix the format.'); return; }
    if (rules.requirePhone && !phone) { showError('qf-submit-error', 'Please enter a phone number.'); return; }
    var req = gatherQuoteRequest();
    // Flatten the customer fields onto the quote request. The server's
    // LeadSchema extends QuoteSchema (service/equipment/pickup/delivery at
    // the top level) — sending them nested under `quoteRequest` made every
    // lead submission fail validation with HTTP 400. `sourceUrl` is derived
    // server-side from the Referer header, so it isn't sent here.
    var payload = Object.assign({}, req, {
      customerName: name,
      customerEmail: email || undefined,
      customerPhone: phone || undefined,
      customerCompany: $('qf-c-company').value.trim() || undefined,
      notes: $('qf-c-notes').value.trim() || req.notes || undefined,
    });
    var btn = $('qf-submit-btn'); var oldText = btn.textContent; btn.disabled = true; btn.innerHTML = '<span class="qf-spinner"></span> &nbsp; Sending…';
    fetch(withGrant('/api/public/lead/' + slug), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json(); })
      .then(function (resp) {
        btn.disabled = false; btn.textContent = oldText;
        if (resp.error) { showError('qf-submit-error', resp.error); return; }
        state.refId = resp.refId || '';
        // Remember the email the customer entered so "Email me this quote" can
        // send a copy to them without re-asking (empty when they gave none).
        state.customerEmail = email || '';
        $('qf-thanks-msg').textContent = 'Thanks — your quote request was sent.';
        $('qf-thanks-detail').textContent = resp.refId ? 'Reference ' + resp.refId + ' — view your full quote below.' : 'Your request was sent.';
        // Link the customer straight to the polished hosted quote (opens in a
        // new tab since the widget is often embedded in an iframe).
        var viewBtn = $('qf-view-quote');
        if (viewBtn) {
          if (resp.refId) {
            viewBtn.href = resp.quoteUrl || (location.origin + '/quote/' + encodeURIComponent(resp.refId));
            viewBtn.style.display = '';
          } else {
            viewBtn.style.display = 'none';
          }
        }
        // Route-snapshot map — populate ONLY now that a lead (refId) exists, via
        // the server-side proxy (Maps key never reaches the browser). Hidden
        // until it loads; if the proxy 404s (e.g. no coordinates) it stays
        // hidden rather than showing a broken image.
        var mapImg = $('qf-route-map');
        if (mapImg) {
          if (resp.refId) {
            mapImg.onload = function () { mapImg.hidden = false; };
            mapImg.onerror = function () { mapImg.hidden = true; };
            mapImg.src = location.origin + '/api/public/quote-map/' + encodeURIComponent(resp.refId) + '.png';
          } else {
            mapImg.hidden = true;
          }
        }
        showStep('thanks');
        renderShareBar();
        renderBookingAffordance();
      })
      .catch(function (err) { btn.disabled = false; btn.textContent = oldText; showError('qf-submit-error', 'Network error — please try again.'); console.error(err); });
  }

  // ── Customer share / email / print / PDF action bar ───────────────────
  // Rendered under the post-submit quote result (thanks step) once a lead
  // (refId) exists — email/share/PDF all need the persisted quote doc. Gated
  // on the per-tenant `features.quoteShare` toggle (default ON); when the
  // carrier turns it off, nothing renders. Print reuses window.qfPrintQuote.
  var SHARE_EMAIL_RE = /^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/;
  var MAX_SHARE_RECIPIENTS = 5;

  function parseEmailList(raw) {
    return String(raw || '')
      .split(/[\s,;]+/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }

  function shareFeatureOn() {
    var f = (state.config && state.config.features) || {};
    // Default ON — only an explicit false disables it (mirrors resolveFeatures).
    return f.quoteShare !== false;
  }

  function postShare(recipients) {
    return fetch(withGrant('/api/public/quote-doc/' + encodeURIComponent(state.refId) + '/share'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipients: recipients }),
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); });
  }

  function renderShareBar() {
    if (!state.refId) return;
    var row = $('qf-thanks-actions');
    if (!row) return;

    // Idempotent: drop any previously-injected links/panel (re-quote in same
    // session) so the row never accumulates duplicates.
    $$('.qf-share-emailme, .qf-share-print, .qf-tl-sep-injected, .qf-share-panel, .qf-share-status')
      .forEach(function (n) { n.remove(); });

    var status = el('div', { class: 'qf-share-status', role: 'status', 'aria-live': 'polite' });
    function setStatus(msg, kind) {
      status.textContent = msg || '';
      status.setAttribute('data-kind', kind || '');
      status.style.display = msg ? 'block' : 'none';
    }

    // Multi-email input panel (revealed by "Share with others" / email-me when
    // no address is on file). Comma / space / newline separated, max 5.
    var input = el('textarea', {
      class: 'qf-input qf-share-input',
      rows: '2',
      placeholder: 'name@company.com, colleague@company.com',
      'aria-label': 'Email addresses to send this quote to',
    });
    var sendBtn = el('button', { type: 'button', class: 'qf-cta qf-share-send', text: 'Send quote' });
    var hint = el('div', { class: 'qf-share-hint', text: 'Separate up to ' + MAX_SHARE_RECIPIENTS + ' emails with a comma. We’ll send each person the full quote.' });
    var panel = el('div', { class: 'qf-share-panel', hidden: 'hidden' }, [input, sendBtn, hint]);

    function doSend(recipients, busyBtn, busyLabel) {
      if (!recipients.length) { setStatus('Please enter at least one email address.', 'err'); return; }
      if (recipients.length > MAX_SHARE_RECIPIENTS) { setStatus('You can share with at most ' + MAX_SHARE_RECIPIENTS + ' people at a time.', 'err'); return; }
      var bad = recipients.filter(function (e) { return !SHARE_EMAIL_RE.test(e); });
      if (bad.length) { setStatus('That email looks invalid: ' + bad[0], 'err'); return; }
      var old = busyBtn ? busyBtn.textContent : '';
      if (busyBtn) { busyBtn.disabled = true; busyBtn.textContent = busyLabel || 'Sending…'; }
      setStatus('', '');
      postShare(recipients).then(function (r) {
        if (busyBtn) { busyBtn.disabled = false; busyBtn.textContent = old; }
        if (r.ok && r.body && r.body.sent) {
          setStatus('Sent to ' + r.body.sent + (r.body.sent === 1 ? ' recipient.' : ' recipients.'), 'ok');
          input.value = '';
          panel.hidden = true;
        } else {
          setStatus((r.body && r.body.message) || 'Could not send — please try again.', 'err');
        }
        autoResize();
      }).catch(function () {
        if (busyBtn) { busyBtn.disabled = false; busyBtn.textContent = old; }
        setStatus('Network error — please try again.', 'err');
      });
    }

    sendBtn.addEventListener('click', function () { doSend(parseEmailList(input.value), sendBtn, 'Sending…'); });

    var injected = [];

    // "Email / share" — one quiet text link that reveals the multi-email panel
    // (merges the old "Email me this quote" + "Share with others"). Pre-fills the
    // customer's own address when known. Gated on features.quoteShare.
    if (shareFeatureOn()) {
      var shareLink = el('button', { type: 'button', class: 'qf-textlink qf-share-emailme', text: 'Email / share' });
      shareLink.addEventListener('click', function () {
        panel.hidden = !panel.hidden;
        if (!panel.hidden) {
          if (!input.value && state.customerEmail && SHARE_EMAIL_RE.test(state.customerEmail)) input.value = state.customerEmail;
          setStatus('', '');
          input.focus();
        }
        autoResize();
      });
      injected.push(shareLink);
    }

    // "Print / PDF" — reuse the widget's print path (the browser dialog also
    // saves a PDF copy). Always available, not gated on share.
    var printLink = el('button', { type: 'button', class: 'qf-textlink qf-share-print', text: 'Print / PDF' });
    printLink.addEventListener('click', function () { if (typeof window.qfPrintQuote === 'function') window.qfPrintQuote(); else window.print(); });
    injected.push(printLink);

    // Prepend the injected links (each trailed by a middot) to the FRONT of the
    // compact action row, before the static Ask / Callback / Start-another links.
    var frag = document.createDocumentFragment();
    injected.forEach(function (node) {
      frag.appendChild(node);
      frag.appendChild(el('span', { class: 'qf-tl-sep qf-tl-sep-injected', 'aria-hidden': 'true', text: '·' }));
    });
    row.insertBefore(frag, row.firstChild);

    // The reveal panel + status live just below the row (panel above status).
    row.insertAdjacentElement('afterend', status);
    row.insertAdjacentElement('afterend', panel);
    setStatus('', '');
    autoResize();
  }

  // ── "Book this load" affordance (Wave 2a) ─────────────────────────────────
  // Rendered on the thanks step (a lead/refId already exists) ONLY when the
  // tenant's features.quoteBooking is on (default OFF). ONE secondary button
  // reveals a compact inline booking panel (pickup date, ready-by, contact,
  // notes) prefilled from the lead; if a deposit is configured we show one
  // "$X deposit to book" line. Submit reuses the existing booking_requested
  // flow (POST /api/public/accept/:refId). Payment CHARGE is Wave 2b — this
  // records the booking + deposit intent only.
  function bookingFeatureOn() {
    var f = (state.config && state.config.features) || {};
    return f.quoteBooking === true; // default OFF — only an explicit true enables
  }
  function bookingConfig() {
    return (state.config && state.config.booking) || { depositType: 'none', depositValue: 0 };
  }
  function currentQuoteTotal() {
    return (state.quote && state.quote.result && typeof state.quote.result.total === 'number')
      ? state.quote.result.total : 0;
  }
  // DISPLAY-ONLY mirror of the server's computeDeposit — the server recomputes
  // authoritatively from the saved quotedTotal on submit, so this is just a
  // preview and can never set the charged amount.
  function computeDepositClient(total, cfg) {
    if (!cfg || cfg.depositType === 'none') return 0;
    var value = (typeof cfg.depositValue === 'number' && isFinite(cfg.depositValue) && cfg.depositValue > 0) ? cfg.depositValue : 0;
    if (value === 0) return 0;
    if (cfg.depositType === 'fixed') return Math.round(value * 100) / 100;
    var t = (typeof total === 'number' && isFinite(total) && total > 0) ? total : 0;
    if (t === 0) return 0;
    return Math.round(t * Math.min(value, 100)) / 100; // (t * pct/100) to cents
  }

  function renderBookingAffordance() {
    if (!state.refId) return;
    var host = $('qf-step-thanks');
    if (!host) return;
    // Idempotent — drop any previously-injected booking UI (re-quote in session).
    $$('.qf-book-btn, .qf-book-panel, .qf-book-done').forEach(function (n) { n.remove(); });
    if (!bookingFeatureOn()) return;

    var actionsRow = $('qf-thanks-actions');
    var cfg = bookingConfig();
    var deposit = computeDepositClient(currentQuoteTotal(), cfg);

    function field(labelText, inputEl) {
      return el('div', { class: 'qf-field qf-full' }, [el('label', { text: labelText }), inputEl]);
    }
    var dateIn = el('input', { class: 'qf-input', type: 'date', 'aria-label': 'Pickup date' });
    var timeIn = el('input', { class: 'qf-input', type: 'text', placeholder: 'e.g. By 4pm', 'aria-label': 'Ready-by time' });
    var nameIn = el('input', { class: 'qf-input', type: 'text', placeholder: 'Your name', 'aria-label': 'Contact name' });
    var phoneIn = el('input', { class: 'qf-input', type: 'text', placeholder: 'Phone', 'aria-label': 'Contact phone' });
    var emailIn = el('input', { class: 'qf-input', type: 'email', placeholder: 'you@company.com', 'aria-label': 'Contact email' });
    var notesIn = el('textarea', { class: 'qf-input', rows: '2', placeholder: 'Anything the carrier should know (optional)', 'aria-label': 'Booking notes' });
    // Prefill from the lead's contact step so the customer re-types nothing.
    nameIn.value = ($('qf-c-name') && $('qf-c-name').value) || '';
    phoneIn.value = ($('qf-c-phone') && $('qf-c-phone').value) || '';
    emailIn.value = ($('qf-c-email') && $('qf-c-email').value) || state.customerEmail || '';

    var grid = el('div', { class: 'qf-grid' }, [
      field('Pickup date', dateIn),
      field('Ready by', timeIn),
      field('Name', nameIn),
      field('Phone', phoneIn),
      field('Email', emailIn),
      field('Notes', notesIn),
    ]);
    var depositLine = deposit > 0
      ? el('div', { class: 'qf-book-deposit', text: '$' + fmtMoney(deposit) + ' deposit to book' })
      : null;
    var sendBtn = el('button', { type: 'button', class: 'qf-cta qf-book-send', text: 'Request booking' });
    var status = el('div', { class: 'qf-book-status', role: 'status', 'aria-live': 'polite' });
    function setStatus(msg, kind) { status.textContent = msg || ''; status.setAttribute('data-kind', kind || ''); status.style.display = msg ? 'block' : 'none'; }
    var panelKids = [grid];
    if (depositLine) panelKids.push(depositLine);
    panelKids.push(sendBtn, status);
    var panel = el('div', { class: 'qf-book-panel', hidden: 'hidden' }, panelKids);

    var bookBtn = el('button', { type: 'button', class: 'qf-cta qf-secondary qf-book-btn', text: 'Book this load' });
    bookBtn.addEventListener('click', function () {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) { setStatus('', ''); dateIn.focus(); }
      autoResize();
    });

    sendBtn.addEventListener('click', function () {
      var payload = {
        customerName: nameIn.value.trim() || undefined,
        customerEmail: emailIn.value.trim() || undefined,
        customerPhone: phoneIn.value.trim() || undefined,
        preferredDate: dateIn.value || undefined,
        readyByTime: timeIn.value.trim() || undefined,
        note: notesIn.value.trim() || undefined,
      };
      var old = sendBtn.textContent; sendBtn.disabled = true; sendBtn.textContent = 'Sending…';
      fetch(withGrant('/api/public/accept/' + encodeURIComponent(state.refId)), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
        .then(function (r) {
          sendBtn.disabled = false; sendBtn.textContent = old;
          if (r.ok && r.body && r.body.ok) {
            var carrier = (state.config && state.config.tenant && state.config.tenant.name) || 'the carrier';
            panel.hidden = true;
            bookBtn.style.display = 'none';
            var done = el('div', { class: 'qf-book-done qf-success', text: 'Booking requested — ' + carrier + ' will confirm.' });
            if (bookBtn.parentNode) bookBtn.parentNode.insertBefore(done, bookBtn);
          } else {
            setStatus((r.body && r.body.error) || 'Could not send — please try again.', 'err');
          }
          autoResize();
        })
        .catch(function () { sendBtn.disabled = false; sendBtn.textContent = old; setStatus('Network error — please try again.', 'err'); });
    });

    // Place the button just above the quiet action row; the panel right after it.
    if (actionsRow && actionsRow.parentNode) {
      actionsRow.parentNode.insertBefore(bookBtn, actionsRow);
      actionsRow.parentNode.insertBefore(panel, actionsRow);
    } else {
      host.appendChild(bookBtn);
      host.appendChild(panel);
    }
    autoResize();
  }

  // ── Live route-map card ───────────────────────────────────────────────
  // As soon as pickup + delivery are both entered/selected, fetch a preview
  // (distance, transit, and a static route map) and reveal the map card. Reuses
  // the same location objects the quote compute builds.
  function locFromResolved(resolved, text) {
    if (!resolved) return parseLocation(text || '');
    var loc = mergeLocation(resolved, text);
    // A precise street address was picked → geocode by the full address so the
    // map pin lands on the exact spot (mergeLocation only keeps the ZIP centroid).
    var lbl = resolved.label || '';
    var precise = /^\s*\d/.test(lbl) || resolved.kind === 'street_address' || resolved.kind === 'premise' || resolved.kind === 'subpremise';
    if (precise && lbl) { loc.address = lbl; loc.zip = undefined; }
    return loc;
  }
  function currentPickupLoc() {
    if (state.service === 'drayage' && state.pickupPortCode) return { portCode: state.pickupPortCode, terminalCode: state.pickupTerminalCode || undefined };
    return locFromResolved(state.pickupResolved, ($('qf-pickup-zip') && $('qf-pickup-zip').value) || '');
  }
  function currentDeliveryLoc() {
    return locFromResolved(state.deliveryResolved, ($('qf-delivery-zip') && $('qf-delivery-zip').value) || '');
  }
  // Address label for the map overlay — the resolved full address, else typed text.
  function addrLabel(resolved, id) {
    if (resolved && resolved.label) return resolved.label;
    return (($(id) && $(id).value) || '').trim() || '—';
  }
  function isDarkMapTheme() {
    try {
      var host = document.querySelector('.qf-widget') || document.body;
      var m = getComputedStyle(host).backgroundColor.match(/\d+(\.\d+)?/g);
      if (!m || m.length < 3) return false;
      return (0.299 * +m[0] + 0.587 * +m[1] + 0.114 * +m[2]) / 255 < 0.5;
    } catch (e) { return false; }
  }
  var mapReqSeq = 0, mapDebounce = null;
  function scheduleRouteMap() {
    if (mapDebounce) clearTimeout(mapDebounce);
    mapDebounce = setTimeout(maybeShowRouteMap, 400);
  }
  function maybeShowRouteMap() {
    var card = $('qf-map-card'); if (!card) return;
    var pickup = currentPickupLoc(), delivery = currentDeliveryLoc();
    var hasP = pickup && (pickup.zip || pickup.city || pickup.portCode);
    var hasD = delivery && (delivery.zip || delivery.city);
    if (!hasP || !hasD) { showBaseMap(); autoResize(); return; }
    var seq = ++mapReqSeq;
    fetch(withGrant('/api/public/route-preview/' + slug), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pickup: pickup, delivery: delivery, service: state.service, theme: isDarkMapTheme() ? 'dark' : 'light', style: brandMapStyle })
    }).then(function (r) { return r.json(); }).then(function (resp) {
      if (seq !== mapReqSeq) return;
      if (!resp || !resp.ok) { showBaseMap(); autoResize(); return; }
      renderRouteMap(resp);
    }).catch(function () { if (seq === mapReqSeq) { showBaseMap(); autoResize(); } });
  }
  function renderRouteMap(resp) {
    var card = $('qf-map-card'); if (!card) return;
    // No routed map (rare, maps key live) → fall back to the North America base
    // map rather than hiding the card, so the slot never collapses.
    if (!resp.mapUrl) { showBaseMap(); autoResize(); return; }
    // Route mode: drop the pre-input base state so overlays + expand return.
    card.classList.remove('qf-map-base');
    var routeImg = $('qf-map-img'); if (routeImg) routeImg.alt = 'Route from pickup to delivery';
    var dEl = $('qf-map-distance'); if (dEl) dEl.textContent = (resp.miles != null) ? (Number(resp.miles).toLocaleString() + ' mi') : '—';
    var tEl = $('qf-map-transit'); if (tEl) tEl.textContent = (resp.transit && resp.transit.text) ? resp.transit.text : '—';
    var pu = $('qf-map-pickup'); if (pu) pu.textContent = addrLabel(state.pickupResolved, 'qf-pickup-zip');
    var de = $('qf-map-delivery'); if (de) de.textContent = addrLabel(state.deliveryResolved, 'qf-delivery-zip');
    // Mirror the same distance/transit + addresses onto the expanded modal map.
    var mm = { 'qf-map-m-distance': dEl, 'qf-map-m-transit': tEl, 'qf-map-m-pickup': pu, 'qf-map-m-delivery': de };
    Object.keys(mm).forEach(function (id) { var t = $(id); if (t && mm[id]) t.textContent = mm[id].textContent; });
    var img = $('qf-map-img'), mimg = $('qf-map-modal-img');
    if (img) img.src = resp.mapUrl;
    if (mimg) mimg.src = resp.mapUrl;
    card.hidden = false;
    autoResize();
  }
  function mapThemeParam() { return isDarkMapTheme() ? 'dark' : 'light'; }
  // Pre-input state: show a North America base map in the card before any address
  // is entered (Alex: "use a map, without a specific route, just point on North
  // America"). The .qf-map-base class hides the route overlays + expand and shows
  // a hint; renderRouteMap() removes it and swaps in the real routed lane.
  function showBaseMap() {
    var card = $('qf-map-card'); if (!card) return;
    var url = withGrant('/api/public/base-map.png?theme=' + mapThemeParam() + '&style=' + brandMapStyle);
    var img = $('qf-map-img'), mimg = $('qf-map-modal-img');
    if (img) { img.src = url; img.alt = 'Map of North America'; }
    if (mimg) { mimg.src = url; mimg.alt = 'Map of North America'; }
    ['qf-map-distance', 'qf-map-transit', 'qf-map-pickup', 'qf-map-delivery',
     'qf-map-m-distance', 'qf-map-m-transit', 'qf-map-m-pickup', 'qf-map-m-delivery'
    ].forEach(function (id) { var el = $(id); if (el) el.textContent = '—'; });
    card.classList.add('qf-map-base');
    card.hidden = false;
  }
  function initRouteMapCard() {
    var open = $('qf-map-open'), modal = $('qf-map-modal');
    var card = $('qf-map-card');
    ['qf-pickup-zip', 'qf-delivery-zip'].forEach(function (id) {
      var el = $(id);
      if (el) { el.addEventListener('change', scheduleRouteMap); el.addEventListener('blur', function () { setTimeout(scheduleRouteMap, 160); }); }
    });
    // Show the North America base map immediately on load.
    showBaseMap();
    if (!open || !modal) return;
    var vp = $('qf-map-viewport'), mimg = $('qf-map-modal-img');
    var scale = 1, tx = 0, ty = 0, dragging = false, sx = 0, sy = 0;
    function apply() { if (mimg) mimg.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')'; }
    function reset() { scale = 1; tx = 0; ty = 0; apply(); }
    open.addEventListener('click', function () { if (card && card.classList.contains('qf-map-base')) return; modal.hidden = false; reset(); });
    function closeModal() { modal.hidden = true; }
    var x = $('qf-map-modal-x'), bd = $('qf-map-modal-close');
    if (x) x.addEventListener('click', closeModal);
    if (bd) bd.addEventListener('click', closeModal);
    var zi = $('qf-map-zoom-in'), zo = $('qf-map-zoom-out');
    if (zi) zi.addEventListener('click', function () { scale = Math.min(4, scale + 0.4); apply(); });
    if (zo) zo.addEventListener('click', function () { scale = Math.max(1, scale - 0.4); if (scale === 1) { tx = 0; ty = 0; } apply(); });
    if (vp) {
      vp.addEventListener('pointerdown', function (e) { dragging = true; sx = e.clientX - tx; sy = e.clientY - ty; if (vp.setPointerCapture) vp.setPointerCapture(e.pointerId); });
      vp.addEventListener('pointermove', function (e) { if (!dragging) return; tx = e.clientX - sx; ty = e.clientY - sy; apply(); });
      vp.addEventListener('pointerup', function () { dragging = false; });
      vp.addEventListener('wheel', function (e) { e.preventDefault(); scale = Math.min(4, Math.max(1, scale + (e.deltaY < 0 ? 0.3 : -0.3))); if (scale === 1) { tx = 0; ty = 0; } apply(); }, { passive: false });
    }
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && modal && !modal.hidden) closeModal(); });
  }

  function initTypeaheads() {
    $$('[data-typeahead="locations"]').forEach(function (wrap) {
      var target = wrap.getAttribute('data-target');
      var input = target === 'pickup' ? $('qf-pickup-zip') : $('qf-delivery-zip');
      var box = target === 'pickup' ? $('qf-pickup-suggestions') : $('qf-delivery-suggestions');
      var timer = null;
      var current = []; // items currently rendered
      var activeIndex = -1;
      function close() { box.classList.remove('open'); box.innerHTML = ''; current = []; activeIndex = -1; }
      function labelFor(item) { return [item.city, item.state, item.zip].filter(Boolean).join(', ') || item.label || ''; }
      function choose(item) {
        // Show the full selected address in the field (scrolls if long).
        input.value = item.label || labelFor(item);
        if (target === 'pickup') state.pickupResolved = item; else state.deliveryResolved = item;
        close();
        scheduleRouteMap();
      }
      function highlight(next) {
        var rows = box.querySelectorAll('.qf-suggestion');
        if (!rows.length) return;
        activeIndex = (next + rows.length) % rows.length;
        rows.forEach(function (row, i) { row.classList.toggle('qf-active', i === activeIndex); });
        rows[activeIndex].scrollIntoView({ block: 'nearest' });
      }
      function render(items) {
        box.innerHTML = ''; current = items.slice(0, 8); activeIndex = -1;
        if (!current.length) { close(); return; }
        current.forEach(function (item, i) {
          var div = document.createElement('div'); div.className = 'qf-suggestion'; div.setAttribute('role', 'option');
          // Full-address suggestion: bold primary line + muted secondary line.
          var main = item.mainText || labelFor(item);
          var sec = item.secondaryText || (item.mainText ? '' : (item.country || 'US'));
          div.innerHTML = '<span class="qf-sugg-main">' + escapeHtml(main) + '</span>' + (sec ? '<span class="meta">' + escapeHtml(sec) + '</span>' : '');
          div.addEventListener('mousedown', function (ev) { ev.preventDefault(); choose(item); });
          div.addEventListener('mousemove', function () { highlight(i); });
          box.appendChild(div);
        });
        box.classList.add('open');
      }
      input.setAttribute('role', 'combobox');
      input.setAttribute('aria-autocomplete', 'list');
      input.setAttribute('aria-expanded', 'false');
      input.addEventListener('input', function () {
        if (target === 'pickup') state.pickupResolved = null; else state.deliveryResolved = null;
        clearTimeout(timer);
        var q = input.value.trim();
        if (q.length < 2) { close(); return; }
        timer = setTimeout(function () {
          fetch(withGrant('/api/public/autocomplete/locations?q=' + encodeURIComponent(q)))
            .then(function (r) { return r.json(); })
            .then(function (resp) { render(resp.suggestions || resp.items || []); input.setAttribute('aria-expanded', box.classList.contains('open') ? 'true' : 'false'); })
            .catch(close);
        }, 180);
      });
      input.addEventListener('blur', function () { setTimeout(close, 130); });
      input.addEventListener('keydown', function (e) {
        var open = box.classList.contains('open') && current.length;
        if (e.key === 'Escape') { close(); return; }
        if (!open) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); highlight(activeIndex + 1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(activeIndex - 1); }
        else if (e.key === 'Enter') { if (activeIndex >= 0 && current[activeIndex]) { e.preventDefault(); choose(current[activeIndex]); } }
      });
    });
    // Close any open suggestion dropdown on an outside click. Exclude the custom
    // <select> panels (.qf-cs-panel) — they share the .qf-suggestions class but
    // own their open/close (widget-custom-select.js); otherwise the bubbling
    // click that opens one immediately strips its .open and empties it.
    document.addEventListener('click', function (e) {
      if (e.target && e.target.closest && e.target.closest('.qf-typeahead')) return;
      $$('.qf-suggestions.open:not(.qf-cs-panel)').forEach(function (b) { b.classList.remove('open'); b.innerHTML = ''; });
    });

    document.addEventListener('click', function (e) {
      var help = e.target.closest('.qf-help');
      if (!help) { closeTip(); return; }
      e.preventDefault(); e.stopPropagation(); showTip(help);
    });
    // Keyboard parity: help cues are focusable buttons, so Enter/Space toggles
    // the tip just like a tap/click (mobile has no hover, so click/tap is the
    // only pointer trigger — see the click handler above).
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      var help = e.target && e.target.closest ? e.target.closest('.qf-help') : null;
      if (!help) return;
      e.preventDefault(); e.stopPropagation(); showTip(help);
    });
    // Promote every cue already in the static markup to a real button. Cues
    // rendered later (accessorial chips) get the same attributes at creation.
    $$('.qf-help').forEach(enhanceHelpCue);
    window.addEventListener('resize', closeTip);
    window.addEventListener('scroll', closeTip, true);
  }

  // Make a "?" help cue keyboard-operable and screen-reader-friendly without
  // changing its markup: role=button + tabindex so it can be focused/activated,
  // aria-expanded reflecting whether its tip is open.
  function enhanceHelpCue(h) {
    if (!h || h.dataset.qfHelpReady) return;
    h.dataset.qfHelpReady = '1';
    h.setAttribute('role', 'button');
    h.setAttribute('tabindex', '0');
    h.setAttribute('aria-expanded', 'false');
    if (!h.getAttribute('aria-label')) h.setAttribute('aria-label', 'More information');
  }

  var tipEl = null;
  function closeTip() {
    if (tipEl) { tipEl.remove(); tipEl = null; }
    $$('.qf-help.open').forEach(function (h) { h.classList.remove('open'); h.setAttribute('aria-expanded', 'false'); h.removeAttribute('aria-describedby'); });
  }
  function showTip(help) {
    var text = help.getAttribute('data-tip');
    if (!text) return;
    var wasOpen = help.classList.contains('open');
    closeTip();
    if (wasOpen) return;
    help.classList.add('open');
    help.setAttribute('aria-expanded', 'true');
    tipEl = document.createElement('div');
    tipEl.className = 'qf-tip-bubble';
    tipEl.id = 'qf-tip-active';
    tipEl.setAttribute('role', 'tooltip');
    tipEl.textContent = text;
    help.setAttribute('aria-describedby', 'qf-tip-active');
    document.body.appendChild(tipEl);
    var r = help.getBoundingClientRect();
    var maxW = Math.min(260, window.innerWidth - 20);
    tipEl.style.maxWidth = maxW + 'px';
    var tw = tipEl.offsetWidth;
    var th = tipEl.offsetHeight;
    var iconCenter = r.left + r.width / 2;
    var left = Math.max(10, Math.min(window.innerWidth - tw - 10, iconCenter - tw / 2));
    // Anchor the bubble directly ABOVE the "?" cue (arrow pointing down at it);
    // only fall back to below if there isn't room above.
    var gap = 10;
    var above = (r.top - th - gap) >= 6;
    var top = above ? (r.top - th - gap) : (r.bottom + gap);
    tipEl.classList.add(above ? 'above' : 'below');
    tipEl.style.left = (left + window.scrollX) + 'px';
    tipEl.style.top = (top + window.scrollY) + 'px';
    tipEl.style.setProperty('--qf-tip-arrow', Math.max(12, Math.min(tw - 18, iconCenter - left - 5)) + 'px');
    requestAnimationFrame(function () { if (tipEl) tipEl.classList.add('show'); });
  }

  function autoResize() {
    try {
      if (!(window.parent && window.parent !== window)) return;
      // Report the ACTUAL content height (the #qf-root container's bottom in
      // document space), not documentElement.scrollHeight. The latter can latch
      // tall — once the host iframe is sized up (e.g. options modal / chat), a
      // body that fills the iframe keeps reporting the inflated viewport height
      // and never shrinks back, leaving a big blank strip under the widget. The
      // fixed options modal lives OUTSIDE #qf-root, so it's correctly excluded.
      var root = document.getElementById('qf-root');
      var height;
      if (root && root.getBoundingClientRect) {
        var rect = root.getBoundingClientRect();
        var padB = parseFloat((window.getComputedStyle && getComputedStyle(document.body).paddingBottom) || '0') || 0;
        height = Math.ceil(rect.top + (window.pageYOffset || 0) + rect.height + padB);
      } else {
        height = document.documentElement.scrollHeight;
      }
      window.parent.postMessage({ type: 'QF_WIDGET_HEIGHT', height: height }, '*');
    } catch (_) { }
  }

  init();
})();