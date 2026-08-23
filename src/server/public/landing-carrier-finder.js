/*
 * "Find your company" — landing-hero carrier typeahead.
 *
 * A visiting carrier types their company name (or USDOT / MC) into the carrier
 * hero input; this queries our PUBLIC FMCSA directory (GET
 * /api/public/carrier-search) and renders an accessible listbox. Selecting a
 * carrier opens the live demo calculator prefilled as THEM:
 *   /w/demo?company=…&usdot=…&mc=…&city=…&state=…&phone=…
 * No selection / no input → the hero's "See a live demo" link opens the default
 * demo (Harbor Link Logistics) unchanged.
 *
 * Standalone (no app.js on the landing page). Debounced + min-length so it never
 * hammers the endpoint; a per-request sequence drops stale responses; EVERY
 * injected carrier value goes in via textContent (never innerHTML), so a
 * hostile FMCSA record can't inject markup. Keyboard: ↑/↓ move, Enter selects,
 * Escape closes; aria-activedescendant + role=listbox/option keep it accessible.
 */
(function () {
  'use strict';

  var MIN_LEN = 2;
  var DEBOUNCE_MS = 250;
  var MAX_RESULTS = 8;

  var root = document.querySelector('[data-carrier-finder]');
  if (!root) return;
  var input = root.querySelector('#qf-finder-input');
  var listbox = root.querySelector('#qf-finder-listbox');
  var status = root.querySelector('[data-finder-status]');
  if (!input || !listbox) return;

  // ── company-name title-casing (keeps LLC / INC / MC etc. upper) ───────────
  var SUFFIX_UPPER = {
    LLC: 1, 'L.L.C.': 1, LLP: 1, 'L.L.P.': 1, LP: 1, 'L.P.': 1, PLLC: 1,
    INC: 1, 'INC.': 1, CORP: 1, 'CORP.': 1, CO: 1, 'CO.': 1, LTD: 1, 'LTD.': 1,
    PC: 1, DBA: 1, USA: 1, US: 1,
  };
  function titleCaseCompany(s) {
    if (!s) return '';
    return String(s).trim().replace(/\s+/g, ' ').split(' ').map(function (w) {
      if (!w) return w;
      if (SUFFIX_UPPER[w.toUpperCase()]) return w.toUpperCase();
      // Leave tokens with digits/ampersands untouched (e.g. "A1", "3PL", "B&W").
      if (/[^a-zA-Z]/.test(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    }).join(' ');
  }
  // Strip an MC/docket value to bare digits, no leading zeros. "MC012892" → "12892".
  function mcToBareDigits(s) {
    return String(s == null ? '' : s).replace(/\D/g, '').replace(/^0+/, '');
  }

  // ── endpoint plumbing ─────────────────────────────────────────────────────
  function request(params) {
    var qs = Object.keys(params).filter(function (k) { return params[k]; })
      .map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
    if (!qs) return Promise.resolve([]);
    return fetch('/api/public/carrier-search?' + qs, { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : { results: [] }; })
      .then(function (j) { return (j && j.results) || []; });
  }
  // Route one raw query to the right param(s): "MC…" → mc; pure digits → USDOT
  // OR MC (query both, merge — a trucker may know either); else → name search.
  function lookup(raw) {
    var term = String(raw || '').trim().replace(/\s+/g, ' ');
    if (!term) return Promise.resolve([]);
    var mcMatch = /^mc[\s-]*0*(\d+)$/i.exec(term);
    if (mcMatch) return request({ mc: mcMatch[1] });
    var compact = term.replace(/[\s-]/g, '');
    if (/^\d+$/.test(compact)) {
      if (compact.length < 3) return Promise.resolve([]);
      return Promise.all([request({ dot: compact }), request({ mc: compact })]).then(function (pair) {
        var seen = {}; var out = [];
        pair[0].concat(pair[1]).forEach(function (row) {
          if (row && !seen[row.usdot]) { seen[row.usdot] = 1; out.push(row); }
        });
        return out;
      });
    }
    if (term.length < MIN_LEN) return Promise.resolve([]);
    return request({ q: term });
  }

  function resultLabel(row) {
    var name = titleCaseCompany(row.dbaName || row.legalName || '') || '(unnamed carrier)';
    var ids = ['USDOT ' + row.usdot];
    if (row.mcNumber) ids.push('MC ' + mcToBareDigits(row.mcNumber));
    var loc = [row.city ? titleCaseCompany(row.city) : '', row.state || '']
      .filter(Boolean).join(', ');
    return { name: name, meta: ids.join(' · ') + (loc ? ' · ' + loc : '') };
  }

  // ── state ─────────────────────────────────────────────────────────────────
  var rows = [];
  var activeIndex = -1;
  var timer = null;
  var reqSeq = 0;

  function setStatus(text) { if (status) status.textContent = text; }
  function setExpanded(on) { input.setAttribute('aria-expanded', on ? 'true' : 'false'); }

  function close() {
    listbox.hidden = true;
    listbox.textContent = '';
    rows = [];
    activeIndex = -1;
    setExpanded(false);
    input.removeAttribute('aria-activedescendant');
  }

  function showMessage(text) {
    listbox.textContent = '';
    var li = document.createElement('li');
    li.className = 'qf-finder__msg';
    li.setAttribute('role', 'presentation');
    li.textContent = text;
    listbox.appendChild(li);
    listbox.hidden = false;
    setExpanded(true);
    input.removeAttribute('aria-activedescendant');
  }

  function render(list) {
    rows = list.slice(0, MAX_RESULTS);
    activeIndex = -1;
    listbox.textContent = '';
    if (!rows.length) {
      showMessage('No matching carrier found. You can still open the demo below.');
      setStatus('No matching carrier found.');
      return;
    }
    rows.forEach(function (row, i) {
      var lbl = resultLabel(row);
      var li = document.createElement('li');
      li.className = 'qf-finder__opt';
      li.id = 'qf-finder-opt-' + i;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      var nm = document.createElement('span');
      nm.className = 'qf-finder__opt-name';
      nm.textContent = lbl.name;
      var mt = document.createElement('span');
      mt.className = 'qf-finder__opt-meta';
      mt.textContent = lbl.meta;
      li.appendChild(nm);
      li.appendChild(mt);
      li.addEventListener('mousedown', function (e) { e.preventDefault(); select(row); });
      li.addEventListener('mouseenter', function () { setActive(i); });
      listbox.appendChild(li);
    });
    listbox.hidden = false;
    setExpanded(true);
    setStatus(rows.length + (rows.length === 1 ? ' company found.' : ' companies found.'));
  }

  function setActive(i) {
    var opts = listbox.querySelectorAll('.qf-finder__opt');
    if (activeIndex >= 0 && opts[activeIndex]) {
      opts[activeIndex].classList.remove('is-active');
      opts[activeIndex].setAttribute('aria-selected', 'false');
    }
    activeIndex = i;
    if (i >= 0 && opts[i]) {
      opts[i].classList.add('is-active');
      opts[i].setAttribute('aria-selected', 'true');
      input.setAttribute('aria-activedescendant', opts[i].id);
      opts[i].scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function select(row) {
    if (!row) return;
    var name = titleCaseCompany(row.dbaName || row.legalName || '');
    var parts = [];
    function add(k, v) {
      var s = v == null ? '' : String(v).trim();
      if (s) parts.push(k + '=' + encodeURIComponent(s));
    }
    add('company', name);
    add('usdot', row.usdot);
    add('mc', mcToBareDigits(row.mcNumber || ''));
    add('city', row.city ? titleCaseCompany(row.city) : '');
    add('state', row.state);
    add('phone', row.phone);
    if (name) input.value = name;
    close();
    location.href = '/w/demo' + (parts.length ? '?' + parts.join('&') : '');
  }

  function run() {
    var term = input.value.trim();
    if (term.length < MIN_LEN) { close(); return; }
    var seq = ++reqSeq;
    setStatus('Searching…');
    lookup(term).then(function (list) {
      if (seq !== reqSeq) return; // a newer keystroke superseded this response
      render(list);
    }, function () {
      if (seq !== reqSeq) return;
      showMessage('Search is unavailable right now. You can still open the demo below.');
      setStatus('Search is unavailable right now.');
    });
  }

  input.addEventListener('input', function () {
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, DEBOUNCE_MS);
  });

  input.addEventListener('keydown', function (e) {
    var open = !listbox.hidden && rows.length > 0;
    if (e.key === 'ArrowDown') {
      if (!open) { run(); return; }
      e.preventDefault();
      setActive(activeIndex + 1 >= rows.length ? 0 : activeIndex + 1);
    } else if (e.key === 'ArrowUp') {
      if (!open) return;
      e.preventDefault();
      setActive(activeIndex - 1 < 0 ? rows.length - 1 : activeIndex - 1);
    } else if (e.key === 'Enter') {
      if (open && activeIndex >= 0 && rows[activeIndex]) {
        e.preventDefault();
        select(rows[activeIndex]);
      }
    } else if (e.key === 'Escape') {
      if (!listbox.hidden) { e.preventDefault(); close(); }
    }
  });

  input.addEventListener('focus', function () {
    if (input.value.trim().length >= MIN_LEN && rows.length) { listbox.hidden = false; setExpanded(true); }
  });

  document.addEventListener('click', function (e) {
    if (!root.contains(e.target)) close();
  });
})();
