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
    quote: null,
    selectedAccessorials: [],
    pickupPortCode: '',
    pickupTerminalCode: '',
    pickupResolved: null,
    deliveryResolved: null,
    refId: '',
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
    if (contBtn) contBtn.textContent = rules.showQuoteBeforeContact ? 'Claim this quote →' : 'Continue — get this quote in writing';
  }

  // Demo-only light/dark preset override, forwarded to the config endpoint so
  // the /w/demo showcase toggle can preview the widget in another theme. Absent
  // for real embeds → the tenant's saved theme is used.
  var themePreset = '';
  try { themePreset = new URLSearchParams(location.search).get('preset') || ''; } catch (e) {}

  function init() {
    var cfgUrl = '/api/public/widget/' + slug;
    if (themePreset) cfgUrl += (cfgUrl.indexOf('?') > -1 ? '&' : '?') + 'preset=' + encodeURIComponent(themePreset);
    fetch(withGrant(cfgUrl))
      .then(function (r) { return r.json(); })
      .then(function (cfg) {
        if (cfg.error) { $('qf-root').innerHTML = '<div class="qf-error">' + cfg.error + '</div>'; return; }
        state.config = cfg;
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
    initOptionsPanel();
    initTypeaheads();
    initRouteMapCard();
    $('qf-back-btn').addEventListener('click', function () { showStep('quote'); });
    $('qf-submit-btn').addEventListener('click', onSubmit);

    var oogCheck = $('qf-oog-check');
    if (oogCheck) oogCheck.addEventListener('change', function () { var fields = $('qf-oog-fields'); if (fields) fields.style.display = oogCheck.checked ? '' : 'none'; autoResize(); });

    var chatOpenBtn = $('qf-chat-open-btn');
    if (chatOpenBtn) {
      chatOpenBtn.addEventListener('click', function () {
        $('qf-chat-toggle').style.display = 'none';
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
        cbOpen.style.display = 'none';
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
      var viewQuoteBtn = $('qf-view-quote'); if (viewQuoteBtn) viewQuoteBtn.style.display = 'none';
      ['qf-cb-phone', 'qf-cb-time', 'qf-cb-topic'].forEach(function (id) { var el = $(id); if (el) { el.value = ''; el.disabled = false; } });
      showCallbackError(null);
      $('qf-result').style.display = 'none';
      ['qf-pickup-zip', 'qf-delivery-zip', 'qf-weight', 'qf-booking', 'qf-c-name', 'qf-c-email', 'qf-c-phone', 'qf-c-company', 'qf-c-notes', 'qf-oog-length', 'qf-oog-width', 'qf-oog-height', 'qf-oog-weight', 'qf-oog-notes', 'qf-ltl-length', 'qf-ltl-width', 'qf-ltl-height']
        .forEach(function (id) { var el = $(id); if (el) el.value = ''; });
      var ltlClassBox = $('qf-ltl-class'); if (ltlClassBox) { ltlClassBox.style.display = 'none'; ltlClassBox.innerHTML = ''; }
      var oog = $('qf-oog-check'); if (oog) oog.checked = false;
      var oogFields = $('qf-oog-fields'); if (oogFields) oogFields.style.display = 'none';
      var oc = $('qf-ocean-carrier'); if (oc) oc.value = '';
      var pp = $('qf-pickup-port-input'); if (pp) pp.value = '';
      var pt = $('qf-pickup-terminal'); if (pt) pt.value = '';
      showStep('quote');
    });
  }

  function renderHeader(cfg) {
    var h = $('qf-header'); h.innerHTML = '';
    if (cfg.brand && cfg.brand.logoUrl) h.appendChild(el('img', { src: cfg.brand.logoUrl, alt: cfg.tenant.name }));
    var name = (cfg.brand && cfg.brand.displayName) || cfg.tenant.name;
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
  function updateLtlClassReadout() {
    var box = $('qf-ltl-class'); if (!box) return;
    if (state.service !== 'ltl') { box.style.display = 'none'; return; }
    var r = ltlClientClass(Number($('qf-weight').value), Number($('qf-ltl-length').value), Number($('qf-ltl-width').value), Number($('qf-ltl-height').value));
    if (!r) { box.style.display = 'none'; box.innerHTML = ''; autoResize(); return; }
    box.innerHTML = 'Estimated freight class <strong>' + r.cls + '</strong> &middot; ' + r.pcf.toFixed(1) + ' lb/ft&sup3;';
    box.style.display = ''; autoResize();
  }
  function syncLtlPanel() {
    var panel = $('qf-ltl-panel'); if (!panel) return;
    var isLtl = state.service === 'ltl';
    panel.style.display = isLtl ? '' : 'none';
    if (isLtl) {
      ['qf-weight', 'qf-ltl-length', 'qf-ltl-width', 'qf-ltl-height'].forEach(function (id) { var e = $(id); if (e) e.oninput = updateLtlClassReadout; });
      updateLtlClassReadout();
    }
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
    scheduleRouteMap();
    syncOogPanel();
    syncLtlPanel();
    autoResize();
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
      weightLbs: $('qf-weight').value ? Number($('qf-weight').value) : undefined,
      oceanCarrier: oceanEl && oceanEl.value ? oceanEl.value : undefined,
      bookingNumber: bookingEl && bookingEl.value ? bookingEl.value.trim() : undefined,
      selectedAccessorialCodes: state.selectedAccessorials.slice(),
      flags: { residential: $('qf-residential').checked, hazmat: $('qf-hazmat').checked, tempControlled: $('qf-temp').checked },
      meta: {},
    };
    if (state.service === 'ltl') {
      var ltlL = Number($('qf-ltl-length').value), ltlW = Number($('qf-ltl-width').value), ltlH = Number($('qf-ltl-height').value);
      if (ltlL > 0) req.lengthIn = ltlL;
      if (ltlW > 0) req.widthIn = ltlW;
      if (ltlH > 0) req.heightIn = ltlH;
      var palEl = $('qf-ltl-palletized'), dockEl = $('qf-ltl-dock');
      if (palEl) req.flags.palletized = !!palEl.checked;
      if (dockEl) req.flags.loadedFromDock = !!dockEl.checked;
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
    if (!(req.weightLbs > 0)) { showError('qf-error', req.service === 'ltl' ? 'Enter the shipment weight (lbs) — LTL is priced by weight and size.' : 'Enter the load weight (lbs).'); return; }
    if (req.service === 'ltl') {
      if (!(req.lengthIn > 0 && req.widthIn > 0 && req.heightIn > 0)) { showError('qf-error', 'Enter length, width, and height (inches) so we can determine the freight class.'); return; }
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

  function renderResult(resp) {
    var r = resp.result;
    $('qf-total').textContent = fmtMoney(r.total);
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
    $('qf-result').style.display = 'block'; autoResize();
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
        $('qf-thanks-msg').textContent = 'Thanks — your quote request was sent.';
        $('qf-thanks-detail').textContent = resp.refId ? 'Reference: ' + resp.refId + '. Open your full quote below, or ask a question / request a callback.' : 'You can now ask a question or request a callback.';
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
      })
      .catch(function (err) { btn.disabled = false; btn.textContent = oldText; showError('qf-submit-error', 'Network error — please try again.'); console.error(err); });
  }

  // ── Live route-map card ───────────────────────────────────────────────
  // As soon as pickup + delivery are both entered/selected, fetch a preview
  // (distance, transit, and a static route map) and reveal the map card. Reuses
  // the same location objects the quote compute builds.
  function currentPickupLoc() {
    if (state.service === 'drayage' && state.pickupPortCode) return { portCode: state.pickupPortCode, terminalCode: state.pickupTerminalCode || undefined };
    var t = ($('qf-pickup-zip') && $('qf-pickup-zip').value) || '';
    return state.pickupResolved ? mergeLocation(state.pickupResolved, t) : parseLocation(t);
  }
  function currentDeliveryLoc() {
    var t = ($('qf-delivery-zip') && $('qf-delivery-zip').value) || '';
    return state.deliveryResolved ? mergeLocation(state.deliveryResolved, t) : parseLocation(t);
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
    if (!hasP || !hasD) { card.hidden = true; autoResize(); return; }
    var seq = ++mapReqSeq;
    fetch(withGrant('/api/public/route-preview/' + slug), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pickup: pickup, delivery: delivery, service: state.service, theme: isDarkMapTheme() ? 'dark' : 'light' })
    }).then(function (r) { return r.json(); }).then(function (resp) {
      if (seq !== mapReqSeq) return;
      if (!resp || !resp.ok) { card.hidden = true; autoResize(); return; }
      renderRouteMap(resp);
    }).catch(function () { if (seq === mapReqSeq) { card.hidden = true; autoResize(); } });
  }
  function renderRouteMap(resp) {
    var card = $('qf-map-card'); if (!card) return;
    var dEl = $('qf-map-distance'); if (dEl) dEl.textContent = (resp.miles != null) ? (Number(resp.miles).toLocaleString() + ' mi') : '—';
    var tEl = $('qf-map-transit'); if (tEl) tEl.textContent = (resp.transit && resp.transit.text) ? resp.transit.text : '—';
    var img = $('qf-map-img'), mimg = $('qf-map-modal-img'), canvas = $('qf-map-open');
    if (resp.mapUrl) {
      if (canvas) canvas.style.display = '';
      if (img) img.src = resp.mapUrl;
      if (mimg) mimg.src = resp.mapUrl;
    } else {
      // No map image (e.g. maps key not configured yet) — hide the image area
      // and keep just the distance/transit strip so the card never shows an
      // empty canvas.
      if (canvas) canvas.style.display = 'none';
      if (img) img.removeAttribute('src');
    }
    card.hidden = false;
    autoResize();
  }
  function initRouteMapCard() {
    var open = $('qf-map-open'), modal = $('qf-map-modal');
    ['qf-pickup-zip', 'qf-delivery-zip'].forEach(function (id) {
      var el = $(id);
      if (el) { el.addEventListener('change', scheduleRouteMap); el.addEventListener('blur', function () { setTimeout(scheduleRouteMap, 160); }); }
    });
    if (!open || !modal) return;
    var vp = $('qf-map-viewport'), mimg = $('qf-map-modal-img');
    var scale = 1, tx = 0, ty = 0, dragging = false, sx = 0, sy = 0;
    function apply() { if (mimg) mimg.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')'; }
    function reset() { scale = 1; tx = 0; ty = 0; apply(); }
    open.addEventListener('click', function () { modal.hidden = false; reset(); });
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
        input.value = labelFor(item);
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
          div.innerHTML = escapeHtml(labelFor(item)) + '<span class="meta">' + escapeHtml(item.country || 'US') + '</span>';
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