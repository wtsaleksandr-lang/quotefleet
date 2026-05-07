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

  // Merge a typeahead-resolved suggestion with whatever is currently in
  // the input (in case the user typed extra characters after picking).
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

  // Parse "City, ST" or "ZIP" or "City" — best-effort.
  function parseLocation(str) {
    if (!str) return {};
    var s = str.trim();
    // Pure ZIP / FSA detection
    var zipMatch = s.match(/^([A-Z0-9]{3,7}(?:[ -]?[A-Z0-9]{3})?)$/i);
    if (zipMatch && /\d/.test(s)) {
      var country = /^[a-zA-Z]/.test(s) ? 'CA' : 'US';
      return { zip: s.replace(/\s+/g, ''), country: country };
    }
    // "City, ST"
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

  // Slug detection: works in three modes
  //   1. Path-based:    /w/<slug>            (legacy iframe / direct link)
  //   2. Subdomain:     <slug>.<host>/       (hosted page, embed iframe)
  //   3. Override:      window.QF_TENANT_SLUG (custom embed)
  var slug = (window.QF_TENANT_SLUG || '').toString();
  if (!slug) {
    var pathMatch = location.pathname.match(/^\/w\/([^/?#]+)/);
    if (pathMatch) slug = pathMatch[1];
  }
  if (!slug) {
    var hostParts = location.hostname.split('.');
    if (hostParts.length >= 3 && hostParts[0] !== 'www') {
      slug = hostParts[0];
    }
  }
  if (!slug) {
    document.body.innerHTML = '<div class="qf-widget"><div class="qf-error">Missing tenant slug — check the URL.</div></div>';
    return;
  }

  var state = {
    config: null,
    service: null,
    equipment: null,
    quote: null, // last computed result
    selectedAccessorials: [],
    pickupPortCode: '',
    pickupTerminalCode: '',
    pickupResolved: null,   // typeahead-picked suggestion {lat,lng,city,state,zip,country}
    deliveryResolved: null,
    refId: '',              // populated after lead submit; powers inline chat
  };

  function applyBrand(brand) {
    if (!brand) return;
    var root = document.documentElement;
    if (brand.primaryColor) root.style.setProperty('--w-primary', brand.primaryColor);
    if (brand.accentColor) root.style.setProperty('--w-accent', brand.accentColor);
  }

  function init() {
    fetch('/api/public/widget/' + slug)
      .then(function (r) { return r.json(); })
      .then(function (cfg) {
        if (cfg.error) {
          $('qf-root').innerHTML = '<div class="qf-error">' + cfg.error + '</div>';
          return;
        }
        state.config = cfg;
        applyBrand(cfg.brand);
        renderHeader(cfg);
        renderServices(cfg.services);
        renderAccessorials(cfg.accessorials);
        autoResize();
      })
      .catch(function () {
        $('qf-root').innerHTML = '<div class="qf-error">Failed to load widget. Please refresh.</div>';
      });

    $('qf-calc-btn').addEventListener('click', onCalculate);
    $('qf-continue-btn').addEventListener('click', function () { showStep('contact'); });
    initTypeaheads();
    $('qf-back-btn').addEventListener('click', function () { showStep('quote'); });
    $('qf-submit-btn').addEventListener('click', onSubmit);
    // ── Inline chat (post-submit) ─────────────────────────────
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

    $('qf-restart-btn').addEventListener('click', function () {
      state.quote = null;
      state.pickupPortCode = '';
      state.pickupTerminalCode = '';
      state.refId = '';
      var msgs = $('qf-chat-msgs'); if (msgs) msgs.innerHTML = '';
      var ct = $('qf-chat-toggle'); if (ct) ct.style.display = '';
      var ch = $('qf-chat'); if (ch) ch.style.display = 'none';
      $('qf-result').style.display = 'none';
      ['qf-pickup-zip', 'qf-delivery-zip', 'qf-weight', 'qf-pickup-date',
       'qf-booking',
       'qf-c-name', 'qf-c-email', 'qf-c-phone', 'qf-c-company', 'qf-c-notes']
        .forEach(function (id) { var el = $(id); if (el) el.value = ''; });
      var oc = $('qf-ocean-carrier'); if (oc) oc.value = '';
      var pp = $('qf-pickup-port-input'); if (pp) pp.value = '';
      var pt = $('qf-pickup-terminal'); if (pt) pt.value = '';
      showStep('quote');
    });
  }

  function renderHeader(cfg) {
    var h = $('qf-header'); h.innerHTML = '';
    if (cfg.brand && cfg.brand.logoUrl) {
      h.appendChild(el('img', { src: cfg.brand.logoUrl, alt: cfg.tenant.name }));
    }
    var name = (cfg.brand && cfg.brand.displayName) || cfg.tenant.name;
    h.appendChild(el('div', { class: 'brand-name', text: name }));
    var tagline = (cfg.brand && cfg.brand.tagline) || 'Get an instant freight quote';
    $('qf-tagline').textContent = tagline;
    if (cfg.brand && cfg.brand.showPoweredBy) {
      $('qf-powered').innerHTML = 'Powered by <a href="' + location.origin + '" target="_blank">QuoteFleet</a>';
    } else {
      $('qf-powered').textContent = '';
    }
    if (cfg.brand && cfg.brand.ctaText) {
      $('qf-calc-btn').textContent = cfg.brand.ctaText;
    }
  }

  function renderServices(services) {
    var wrap = $('qf-services'); wrap.innerHTML = '';
    if (!services.length) {
      $('qf-error').style.display = 'block';
      $('qf-error').textContent = 'No services configured. Contact us directly.';
      return;
    }
    var labels = { drayage: 'Drayage', ftl: 'Truckload', ltl: 'LTL', expedited: 'Expedited', hotshot: 'Hotshot' };
    services.forEach(function (s, i) {
      var btn = el('button', {
        class: i === 0 ? 'active' : '',
        text: labels[s] || s,
        on: { click: function () { selectService(s); } }
      });
      btn.dataset.service = s;
      wrap.appendChild(btn);
    });
    selectService(services[0]);
  }

  function selectService(service) {
    state.service = service;
    $$('#qf-services button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.service === service);
    });
    var equip = state.config.equipmentByService[service] || [];
    var sel = $('qf-equipment');
    sel.innerHTML = '';
    equip.forEach(function (e) {
      var opt = document.createElement('option');
      opt.value = e.value;
      opt.textContent = e.label || e.value;
      sel.appendChild(opt);
    });
    state.equipment = equip[0] ? equip[0].value : null;
    sel.addEventListener('change', function () { state.equipment = sel.value; });
    // Filter accessorials to those that apply to this service
    renderAccessorials(state.config.accessorials);
    // Drayage-aware: swap pickup UI (port + terminal) for the generic ZIP input.
    var isDrayage = service === 'drayage';
    var drayPickup = $('qf-drayage-pickup');
    var defaultPickup = $('qf-default-pickup');
    if (drayPickup) drayPickup.style.display = isDrayage ? '' : 'none';
    if (defaultPickup) defaultPickup.style.display = isDrayage ? 'none' : '';
    if (isDrayage) renderPorts();
    autoResize();
  }

  // Port picker — type-ahead over the carrier's served ports + city
  // search across PORTS_DATA. We keep the matching code in
  // state.pickupPortCode and the human label in the input.
  function renderPorts() {
    var input = $('qf-pickup-port-input');
    var box = $('qf-pickup-port-suggestions');
    if (!input || !box) return;
    var ports = (state.config && state.config.drayagePorts) || [];
    if (ports.length === 0) {
      // No ports configured for this tenant — fall back to free-text pickup.
      var dp = $('qf-default-pickup'); if (dp) dp.style.display = '';
      var dr = $('qf-drayage-pickup'); if (dr) dr.style.display = 'none';
      return;
    }

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
        item.addEventListener('mousedown', function (e) {
          e.preventDefault();
          input.value = (p.state ? p.name + ', ' + p.state : p.name);
          state.pickupPortCode = p.code;
          close();
          renderTerminals();
        });
        box.appendChild(item);
      });
      box.classList.add('open');
    }

    function filter(q) {
      q = (q || '').toLowerCase().trim();
      if (!q) return ports.slice(0, 10);
      return ports.filter(function (p) {
        return (
          p.name.toLowerCase().includes(q) ||
          (p.city || '').toLowerCase().includes(q) ||
          p.code.toLowerCase().includes(q) ||
          (p.state || '').toLowerCase().includes(q)
        );
      });
    }

    input.oninput = function () {
      // User is editing — clear any previously selected port code until
      // they pick a real suggestion.
      state.pickupPortCode = '';
      state.pickupTerminalCode = '';
      render(filter(input.value));
    };
    input.onfocus = function () { render(filter(input.value)); };
    input.onblur = function () { setTimeout(close, 120); };
    input.onkeydown = function (e) {
      if (e.key === 'Escape') close();
    };

    // Pre-fill if a port code was already selected (e.g. on tab switch).
    if (state.pickupPortCode) {
      var pre = ports.find(function (p) { return p.code === state.pickupPortCode; });
      if (pre) input.value = pre.name + (pre.state ? ', ' + pre.state : '');
    } else {
      input.value = '';
    }
    renderTerminals();
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]);
    });
  }

  // ── Inline chat helpers ──────────────────────────────────────
  function appendChatBubble(role, text) {
    var msgs = $('qf-chat-msgs');
    if (!msgs) return null;
    var b = document.createElement('div');
    b.className = 'qf-chat-bubble ' + role;
    b.textContent = text;
    msgs.appendChild(b);
    msgs.scrollTop = msgs.scrollHeight;
    autoResize();
    return b;
  }

  function sendChatMessage() {
    if (!state.refId) return;
    var input = $('qf-chat-input');
    var msg = (input.value || '').trim();
    if (!msg) return;
    appendChatBubble('user', msg);
    input.value = '';
    var thinking = appendChatBubble('thinking', 'Thinking…');
    var sendBtn = $('qf-chat-send');
    if (sendBtn) sendBtn.disabled = true;

    fetch('/api/public/chat/' + encodeURIComponent(state.refId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg }),
    })
      .then(function (r) { return r.json(); })
      .then(function (resp) {
        if (thinking) thinking.remove();
        if (sendBtn) sendBtn.disabled = false;
        if (resp.error) { appendChatBubble('assistant', 'Sorry — ' + resp.error); return; }
        appendChatBubble('assistant', resp.reply || '(no reply)');
      })
      .catch(function () {
        if (thinking) thinking.remove();
        if (sendBtn) sendBtn.disabled = false;
        appendChatBubble('assistant', 'Connection error. Try again in a moment.');
      });
  }

  function renderTerminals() {
    var sel = $('qf-pickup-terminal');
    if (!sel) return;
    var port = state.pickupPortCode;
    var byPort = (state.config && state.config.terminalsByPort) || {};
    var list = port ? (byPort[port] || []) : [];
    sel.innerHTML = '';
    var dunno = document.createElement('option');
    dunno.value = ''; dunno.textContent = "— I don't know yet —";
    sel.appendChild(dunno);
    list.forEach(function (t) {
      var opt = document.createElement('option');
      opt.value = t.code;
      opt.textContent = t.name + (t.carrier ? '  (' + t.carrier + ')' : '');
      sel.appendChild(opt);
    });
    sel.value = state.pickupTerminalCode || '';
    sel.onchange = function () { state.pickupTerminalCode = sel.value; };
  }

  function renderAccessorials(list) {
    var wrap = $('qf-accessorials'); wrap.innerHTML = '';
    var visible = (list || []).filter(function (a) {
      if (!a.appliesToServices || a.appliesToServices.length === 0) return true;
      return a.appliesToServices.indexOf(state.service) >= 0;
    });
    if (!visible.length) {
      wrap.appendChild(el('span', { class: 'qf-tagline', text: 'No optional add-ons for this service.' }));
      return;
    }
    visible.forEach(function (a) {
      var chip = el('button', {
        class: 'qf-acc-chip' + (state.selectedAccessorials.indexOf(a.code) >= 0 ? ' active' : ''),
        text: a.label,
        title: a.description || '',
        on: { click: function (ev) {
          ev.preventDefault();
          var i = state.selectedAccessorials.indexOf(a.code);
          if (i >= 0) state.selectedAccessorials.splice(i, 1);
          else state.selectedAccessorials.push(a.code);
          chip.classList.toggle('active');
        } }
      });
      wrap.appendChild(chip);
    });
  }

  function showStep(name) {
    ['quote', 'contact', 'thanks'].forEach(function (n) {
      var s = $('qf-step-' + n);
      if (s) s.classList.toggle('active', n === name);
    });
    autoResize();
  }

  function showError(id, msg) {
    var e = $(id);
    if (msg) {
      e.textContent = msg;
      e.style.display = 'block';
    } else {
      e.style.display = 'none';
    }
  }

  function gatherQuoteRequest() {
    var isDrayage = state.service === 'drayage';
    var pickup;
    if (isDrayage && state.pickupPortCode) {
      pickup = {
        portCode: state.pickupPortCode,
        terminalCode: state.pickupTerminalCode || undefined,
      };
    } else if (state.pickupResolved) {
      // User picked a suggestion — use its precise coords + parsed parts.
      pickup = mergeLocation(state.pickupResolved, $('qf-pickup-zip').value);
    } else {
      pickup = parseLocation(($('qf-pickup-zip') && $('qf-pickup-zip').value) || '');
    }
    var delivery = state.deliveryResolved
      ? mergeLocation(state.deliveryResolved, $('qf-delivery-zip').value)
      : parseLocation($('qf-delivery-zip').value);
    var oceanEl = $('qf-ocean-carrier');
    var bookingEl = $('qf-booking');
    return {
      service: state.service,
      equipment: state.equipment,
      pickup: pickup,
      delivery: delivery,
      weightLbs: $('qf-weight').value ? Number($('qf-weight').value) : undefined,
      pickupDate: $('qf-pickup-date').value || undefined,
      oceanCarrier: oceanEl && oceanEl.value ? oceanEl.value : undefined,
      bookingNumber: bookingEl && bookingEl.value ? bookingEl.value.trim() : undefined,
      selectedAccessorialCodes: state.selectedAccessorials.slice(),
      flags: {
        residential: $('qf-residential').checked,
        hazmat: $('qf-hazmat').checked,
        tempControlled: $('qf-temp').checked,
      },
    };
  }

  function onCalculate(e) {
    e && e.preventDefault();
    showError('qf-error', null);
    var req = gatherQuoteRequest();
    if (!req.equipment) { showError('qf-error', 'Please pick an equipment type.'); return; }
    var hasPickup = !!(req.pickup.zip || req.pickup.city || req.pickup.portCode);
    if (!hasPickup) { showError('qf-error', 'Please pick a pickup port (drayage) or enter a ZIP / city.'); return; }
    if (!req.delivery.zip && !req.delivery.city) { showError('qf-error', 'Please enter a delivery ZIP or city.'); return; }

    var btn = $('qf-calc-btn');
    var oldText = btn.textContent;
    btn.disabled = true;
    btn.innerHTML = '<span class="qf-spinner"></span> &nbsp; Calculating…';

    fetch('/api/public/quote/' + slug, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    })
      .then(function (r) { return r.json(); })
      .then(function (resp) {
        btn.disabled = false; btn.textContent = oldText;
        if (resp.error) { showError('qf-error', resp.error); return; }
        if (resp.result && resp.result.unsupported) {
          showError('qf-error', resp.result.unsupported.reason);
          return;
        }
        state.quote = resp;
        renderResult(resp);
      })
      .catch(function (err) {
        btn.disabled = false; btn.textContent = oldText;
        showError('qf-error', 'Network error — please try again.');
        console.error(err);
      });
  }

  function renderResult(resp) {
    var r = resp.result;
    $('qf-total').textContent = fmtMoney(r.total);
    $('qf-meta').textContent =
      'Approx. ' + Math.round(resp.miles) + ' mi · ' + (state.service || 'truck') + ' · ' + (state.equipment || '');
    var lines = $('qf-lines'); lines.innerHTML = '';
    r.lines.forEach(function (l) {
      var row = el('div', { class: 'line' }, [
        el('span', { class: 'name', text: l.name }),
        el('span', { class: 'amt', text: '$' + fmtMoney(l.amount) }),
      ]);
      lines.appendChild(row);
    });
    var totalRow = el('div', { class: 'line total-row' }, [
      el('span', { class: 'name', text: 'Total' }),
      el('span', { class: 'amt', text: '$' + fmtMoney(r.total) }),
    ]);
    lines.appendChild(totalRow);
    $('qf-result').style.display = 'block';
    autoResize();
  }

  function onSubmit(e) {
    e && e.preventDefault();
    showError('qf-submit-error', null);
    var name = $('qf-c-name').value.trim();
    var email = $('qf-c-email').value.trim();
    if (!name) { showError('qf-submit-error', 'Please enter your name.'); return; }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showError('qf-submit-error', 'Please enter a valid email.'); return;
    }

    var req = gatherQuoteRequest();
    req.customerName = name;
    req.customerEmail = email;
    req.customerPhone = $('qf-c-phone').value.trim() || undefined;
    req.customerCompany = $('qf-c-company').value.trim() || undefined;
    req.notes = $('qf-c-notes').value.trim() || undefined;

    var btn = $('qf-submit-btn');
    var oldText = btn.textContent;
    btn.disabled = true;
    btn.innerHTML = '<span class="qf-spinner"></span> &nbsp; Sending…';

    fetch('/api/public/lead/' + slug, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    })
      .then(function (r) { return r.json(); })
      .then(function (resp) {
        btn.disabled = false; btn.textContent = oldText;
        if (resp.error) { showError('qf-submit-error', resp.error); return; }
        state.refId = resp.refId;
        $('qf-thanks-msg').textContent = 'Quote ' + resp.refId + ' — $' + fmtMoney(resp.total) + ' — sent to ' + email;
        $('qf-thanks-detail').textContent =
          'Have a question? Ask the AI assistant below — about transit time, accessorials, pickup readiness, anything.';
        showStep('thanks');
      })
      .catch(function (err) {
        btn.disabled = false; btn.textContent = oldText;
        showError('qf-submit-error', 'Network error — please try again.');
        console.error(err);
      });
  }

  // ── Type-ahead (location autocomplete, US/CA only) ────────────
  // Server endpoint /api/public/autocomplete/locations proxies Mapbox.
  // If Mapbox isn't configured, suggestions stay empty and the input
  // accepts free text.
  function initTypeaheads() {
    var pickup = $('qf-pickup-zip');
    var pickupBox = $('qf-pickup-suggestions');
    var delivery = $('qf-delivery-zip');
    var deliveryBox = $('qf-delivery-suggestions');
    if (pickup && pickupBox) attachTypeahead(pickup, pickupBox, function (s) {
      state.pickupResolved = s;
    });
    if (delivery && deliveryBox) attachTypeahead(delivery, deliveryBox, function (s) {
      state.deliveryResolved = s;
    });
  }

  function attachTypeahead(input, box, onPick) {
    var debounceId = null;
    var lastQuery = '';
    var activeIndex = -1;

    function close() {
      box.classList.remove('open');
      box.innerHTML = '';
      activeIndex = -1;
    }
    function render(suggestions) {
      box.innerHTML = '';
      if (!suggestions.length) { close(); return; }
      suggestions.forEach(function (s, i) {
        var div = document.createElement('div');
        div.className = 'qf-suggestion';
        div.textContent = s.label;
        if (s.zip || s.state) {
          var meta = document.createElement('span');
          meta.className = 'meta';
          meta.textContent = [s.kind, s.country].filter(Boolean).join(' · ');
          div.appendChild(meta);
        }
        div.addEventListener('mousedown', function (ev) {
          ev.preventDefault(); // keep input focus
          input.value = s.label;
          if (typeof onPick === 'function') onPick(s);
          close();
        });
        box.appendChild(div);
      });
      box.classList.add('open');
    }
    function fetchSuggestions(q) {
      fetch('/api/public/autocomplete/locations?q=' + encodeURIComponent(q))
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (input.value.trim() !== q) return; // race: input changed
          render(j.suggestions || []);
        })
        .catch(function () { close(); });
    }

    input.addEventListener('input', function () {
      var q = input.value.trim();
      if (q === lastQuery) return;
      lastQuery = q;
      // Clear cached resolved location when user types
      if (typeof onPick === 'function') onPick(null);
      clearTimeout(debounceId);
      if (q.length < 2) { close(); return; }
      debounceId = setTimeout(function () { fetchSuggestions(q); }, 220);
    });
    input.addEventListener('keydown', function (e) {
      if (!box.classList.contains('open')) return;
      var items = Array.from(box.querySelectorAll('.qf-suggestion'));
      if (e.key === 'ArrowDown') { e.preventDefault(); activeIndex = (activeIndex + 1) % items.length; updateActive(items); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); activeIndex = (activeIndex - 1 + items.length) % items.length; updateActive(items); }
      else if (e.key === 'Enter' && activeIndex >= 0) {
        e.preventDefault();
        items[activeIndex].dispatchEvent(new MouseEvent('mousedown'));
      } else if (e.key === 'Escape') { close(); }
    });
    input.addEventListener('blur', function () { setTimeout(close, 120); });

    function updateActive(items) {
      items.forEach(function (el, i) { el.classList.toggle('active', i === activeIndex); });
    }
  }

  // ── Help tooltips ─────────────────────────────────────────────
  // Any element with data-tip="..." (or .qf-help with data-tip on it)
  // shows a positioned bubble on hover (desktop) or tap (touch).
  // One global bubble element re-used for every trigger.
  function initTooltips() {
    var bubble = document.createElement('div');
    bubble.className = 'qf-tip-bubble';
    document.body.appendChild(bubble);
    var openFor = null;

    function show(target) {
      var text = target.getAttribute('data-tip') || target.title;
      if (!text) return;
      bubble.textContent = text;
      var rect = target.getBoundingClientRect();
      var bw = Math.min(240, document.body.clientWidth * 0.8);
      bubble.style.maxWidth = bw + 'px';
      // Place below the trigger by default; flip up if no room.
      var left = Math.max(8, Math.min(window.innerWidth - bw - 8, rect.left + rect.width / 2 - bw / 2));
      var arrowX = Math.max(8, rect.left + rect.width / 2 - left - 5);
      bubble.style.setProperty('--qf-tip-arrow', arrowX + 'px');
      bubble.style.left = (left + window.scrollX) + 'px';
      bubble.style.top = (rect.bottom + window.scrollY + 8) + 'px';
      bubble.classList.add('show');
      target.classList.add('open');
      openFor = target;
    }
    function hide() {
      bubble.classList.remove('show');
      if (openFor) openFor.classList.remove('open');
      openFor = null;
    }

    // Delegate from document so tooltips on dynamically-added elements work.
    document.addEventListener('mouseover', function (e) {
      var t = e.target.closest('[data-tip]');
      if (!t) return;
      show(t);
    });
    document.addEventListener('mouseout', function (e) {
      var t = e.target.closest('[data-tip]');
      if (!t) return;
      // Hide unless we're moving into the bubble itself.
      if (e.relatedTarget && bubble.contains(e.relatedTarget)) return;
      hide();
    });
    // Touch / click — toggle.
    document.addEventListener('click', function (e) {
      var t = e.target.closest('[data-tip]');
      if (t) {
        e.preventDefault();
        if (openFor === t) hide();
        else show(t);
        return;
      }
      if (openFor) hide();
    });
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
  }
  initTooltips();

  // ── auto-resize iframe via postMessage ────────────────────────
  function autoResize() {
    if (window.parent === window) return;
    var h = document.body.scrollHeight + 24;
    window.parent.postMessage({ qf: 'resize', slug: slug, h: h }, '*');
  }
  window.addEventListener('resize', autoResize);
  // Periodic resize for content that grows asynchronously.
  setInterval(autoResize, 800);

  init();
})();
