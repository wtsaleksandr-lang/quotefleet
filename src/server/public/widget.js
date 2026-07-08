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

  function applyBrand(brand) {
    if (!brand) return;
    var root = document.documentElement;
    if (brand.primaryColor) root.style.setProperty('--w-primary', brand.primaryColor);
    if (brand.accentColor) root.style.setProperty('--w-accent', brand.accentColor);
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

  function init() {
    fetch('/api/public/widget/' + slug)
      .then(function (r) { return r.json(); })
      .then(function (cfg) {
        if (cfg.error) { $('qf-root').innerHTML = '<div class="qf-error">' + cfg.error + '</div>'; return; }
        state.config = cfg;
        applyBrand(cfg.brand);
        renderHeader(cfg);
        renderServices(cfg.services);
        renderAccessorials(cfg.accessorials);
        autoResize();
      })
      .catch(function () { $('qf-root').innerHTML = '<div class="qf-error">Failed to load widget. Please refresh.</div>'; });

    $('qf-calc-btn').addEventListener('click', onCalculate);
    $('qf-continue-btn').addEventListener('click', function () { showStep('contact'); });
    initTypeaheads();
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
      ['qf-cb-phone', 'qf-cb-time', 'qf-cb-topic'].forEach(function (id) { var el = $(id); if (el) { el.value = ''; el.disabled = false; } });
      showCallbackError(null);
      $('qf-result').style.display = 'none';
      ['qf-pickup-zip', 'qf-delivery-zip', 'qf-weight', 'qf-booking', 'qf-c-name', 'qf-c-email', 'qf-c-phone', 'qf-c-company', 'qf-c-notes', 'qf-oog-length', 'qf-oog-width', 'qf-oog-height', 'qf-oog-weight', 'qf-oog-notes']
        .forEach(function (id) { var el = $(id); if (el) el.value = ''; });
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
    if (cfg.brand && cfg.brand.ctaText) $('qf-calc-btn').textContent = cfg.brand.ctaText;
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
    syncOogPanel();
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
    fetch('/api/public/chat/' + encodeURIComponent(state.refId), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: msg }) })
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
    fetch('/api/public/callback/' + encodeURIComponent(state.refId), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerName: name, customerPhone: phone, customerEmail: email || undefined, customerCompany: company || undefined, preferredTime: (timeEl && timeEl.value || '').trim() || undefined, topic: (topicEl && topicEl.value || '').trim() || undefined, triggerSource: 'visitor_button' }) })
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

  function renderAccessorials(list) {
    var wrap = $('qf-accessorials'); wrap.innerHTML = '';
    var visible = (list || []).filter(function (a) { if (!a.appliesToServices || a.appliesToServices.length === 0) return true; return a.appliesToServices.indexOf(state.service) >= 0; });
    if (!visible.length) { wrap.appendChild(el('span', { class: 'qf-tagline', text: 'No optional add-ons for this service.' })); return; }
    visible.forEach(function (a) {
      var chip = el('button', { class: 'qf-acc-chip' + (state.selectedAccessorials.indexOf(a.code) >= 0 ? ' active' : ''), text: a.label, title: a.description || '', on: { click: function (ev) { ev.preventDefault(); var i = state.selectedAccessorials.indexOf(a.code); if (i >= 0) state.selectedAccessorials.splice(i, 1); else state.selectedAccessorials.push(a.code); chip.classList.toggle('active'); } } });
      wrap.appendChild(chip);
    });
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
    var oogCheck = $('qf-oog-check');
    if (isOpenTopOrFlatRack(req.equipment) && oogCheck && oogCheck.checked) {
      var hasDims = ($('qf-oog-height').value || $('qf-oog-width').value || $('qf-oog-length').value || $('qf-oog-notes').value || '').trim();
      if (!hasDims) { showError('qf-error', 'Please add oversize dimensions or notes for open top / flat rack review.'); return; }
    }
    var btn = $('qf-calc-btn'); var oldText = btn.textContent; btn.disabled = true; btn.innerHTML = '<span class="qf-spinner"></span> &nbsp; Calculating…';
    fetch('/api/public/quote/' + slug, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req) })
      .then(function (r) { return r.json(); })
      .then(function (resp) { btn.disabled = false; btn.textContent = oldText; if (resp.error) { showError('qf-error', resp.error); return; } if (resp.result && resp.result.unsupported) { showError('qf-error', resp.result.unsupported.reason); return; } state.quote = resp; renderResult(resp); })
      .catch(function (err) { btn.disabled = false; btn.textContent = oldText; showError('qf-error', 'Network error — please try again.'); console.error(err); });
  }

  function renderResult(resp) {
    var r = resp.result;
    $('qf-total').textContent = fmtMoney(r.total);
    $('qf-meta').textContent = 'Approx. ' + Math.round(resp.miles) + ' mi · ' + (state.service || 'truck') + ' · ' + normalizeEquipmentLabel(state.equipment || '', state.service);
    var lines = $('qf-lines'); lines.innerHTML = '';
    r.lines.forEach(function (l) { var row = el('div', { class: 'line' }, [el('span', { class: 'name', text: l.name }), el('span', { class: 'amt', text: '$' + fmtMoney(l.amount) })]); lines.appendChild(row); });
    var totalRow = el('div', { class: 'line total-row' }, [el('span', { class: 'name', text: 'Total' }), el('span', { class: 'amt', text: '$' + fmtMoney(r.total) })]);
    lines.appendChild(totalRow);
    $('qf-result').style.display = 'block'; autoResize();
  }

  function onSubmit(e) {
    e && e.preventDefault(); showError('qf-submit-error', null); var rules = getContactRules();
    var name = $('qf-c-name').value.trim(); var email = $('qf-c-email').value.trim(); var phone = $('qf-c-phone').value.trim();
    if (!name) { showError('qf-submit-error', 'Please enter your name.'); return; }
    if (rules.requireEmail) { if (!email || !/^\S+@\S+\.\S+$/.test(email)) { showError('qf-submit-error', 'Please enter a valid email.'); return; } }
    else if (email && !/^\S+@\S+\.\S+$/.test(email)) { showError('qf-submit-error', 'That email looks invalid — clear it or fix the format.'); return; }
    if (rules.requirePhone && !phone) { showError('qf-submit-error', 'Please enter a phone number.'); return; }
    var req = gatherQuoteRequest();
    var payload = { quoteRequest: req, customerName: name, customerEmail: email || undefined, customerPhone: phone || undefined, customerCompany: $('qf-c-company').value.trim() || undefined, notes: $('qf-c-notes').value.trim() || undefined, sourceUrl: location.href };
    var btn = $('qf-submit-btn'); var oldText = btn.textContent; btn.disabled = true; btn.innerHTML = '<span class="qf-spinner"></span> &nbsp; Sending…';
    fetch('/api/public/lead/' + slug, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json(); })
      .then(function (resp) {
        btn.disabled = false; btn.textContent = oldText;
        if (resp.error) { showError('qf-submit-error', resp.error); return; }
        state.refId = resp.refId || '';
        $('qf-thanks-msg').textContent = 'Thanks — your quote request was sent.';
        $('qf-thanks-detail').textContent = resp.refId ? 'Reference: ' + resp.refId + '. You can now ask a question or request a callback.' : 'You can now ask a question or request a callback.';
        showStep('thanks');
      })
      .catch(function (err) { btn.disabled = false; btn.textContent = oldText; showError('qf-submit-error', 'Network error — please try again.'); console.error(err); });
  }

  function initTypeaheads() {
    $$('[data-typeahead="locations"]').forEach(function (wrap) {
      var target = wrap.getAttribute('data-target');
      var input = target === 'pickup' ? $('qf-pickup-zip') : $('qf-delivery-zip');
      var box = target === 'pickup' ? $('qf-pickup-suggestions') : $('qf-delivery-suggestions');
      var timer = null;
      function close() { box.classList.remove('open'); box.innerHTML = ''; }
      function render(items) {
        box.innerHTML = '';
        if (!items.length) { close(); return; }
        items.slice(0, 8).forEach(function (item) {
          var div = document.createElement('div'); div.className = 'qf-suggestion';
          var label = [item.city, item.state, item.zip].filter(Boolean).join(', ');
          div.innerHTML = escapeHtml(label || item.label || '') + '<span class="meta">' + escapeHtml(item.country || 'US') + '</span>';
          div.addEventListener('mousedown', function (ev) { ev.preventDefault(); input.value = label; if (target === 'pickup') state.pickupResolved = item; else state.deliveryResolved = item; close(); });
          box.appendChild(div);
        });
        box.classList.add('open');
      }
      input.addEventListener('input', function () {
        if (target === 'pickup') state.pickupResolved = null; else state.deliveryResolved = null;
        clearTimeout(timer);
        var q = input.value.trim();
        if (q.length < 2) { close(); return; }
        timer = setTimeout(function () {
          fetch('/api/tools/places?q=' + encodeURIComponent(q))
            .then(function (r) { return r.json(); })
            .then(function (resp) { render(resp.items || []); })
            .catch(close);
        }, 180);
      });
      input.addEventListener('blur', function () { setTimeout(close, 130); });
      input.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    });

    document.addEventListener('click', function (e) {
      var help = e.target.closest('.qf-help');
      if (!help) { closeTip(); return; }
      e.preventDefault(); e.stopPropagation(); showTip(help);
    });
    window.addEventListener('resize', closeTip);
    window.addEventListener('scroll', closeTip, true);
  }

  var tipEl = null;
  function closeTip() { if (tipEl) { tipEl.remove(); tipEl = null; $$('.qf-help.open').forEach(function (h) { h.classList.remove('open'); }); } }
  function showTip(help) {
    var text = help.getAttribute('data-tip');
    if (!text) return;
    var wasOpen = help.classList.contains('open');
    closeTip();
    if (wasOpen) return;
    help.classList.add('open');
    tipEl = document.createElement('div');
    tipEl.className = 'qf-tip-bubble';
    tipEl.textContent = text;
    document.body.appendChild(tipEl);
    var r = help.getBoundingClientRect();
    var maxW = Math.min(260, window.innerWidth - 20);
    tipEl.style.maxWidth = maxW + 'px';
    var tw = tipEl.offsetWidth;
    var left = Math.max(10, Math.min(window.innerWidth - tw - 10, r.left + r.width / 2 - tw / 2));
    var top = r.bottom + 8;
    tipEl.style.left = left + 'px';
    tipEl.style.top = top + 'px';
    tipEl.style.setProperty('--qf-tip-arrow', Math.max(12, Math.min(tw - 18, r.left + r.width / 2 - left - 5)) + 'px');
    requestAnimationFrame(function () { if (tipEl) tipEl.classList.add('show'); });
  }

  function autoResize() {
    try { if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'QF_WIDGET_HEIGHT', height: document.documentElement.scrollHeight }, '*'); } catch (_) { }
  }

  init();
})();