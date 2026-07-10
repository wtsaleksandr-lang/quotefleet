(function () {
  'use strict';

  var GROUPS = [
    { key: 'all', label: 'All', match: function () { return true; } },
    { key: 'drayage', label: 'Drayage / terminal', match: /chassis|prepull|storage|yard|terminal|port|pier|empty|container|tri|genset|reefer|demurrage|per diem/i },
    { key: 'waiting', label: 'Waiting time', match: /detention|wait|layover|tonu/i },
    { key: 'delivery', label: 'Delivery extras', match: /liftgate|residential|inside|appointment|limited|redelivery|stop|driver|lumper|sort/i },
    { key: 'special', label: 'Special equipment', match: /hazmat|overweight|oversize|permit|tarp|strap|chain|pilot|escort/i },
  ];

  function pageIsAccessorials() {
    var h1 = document.querySelector('#page-content h1');
    return h1 && /accessorials/i.test(h1.textContent || '');
  }

  function rows() {
    return Array.from(document.querySelectorAll('#page-content table tbody tr'));
  }

  function cells(row) {
    return Array.from(row.querySelectorAll('td'));
  }

  function rowText(row) {
    return (row.textContent || '').toLowerCase();
  }

  function rowName(row) {
    var first = cells(row)[0];
    return ((first && first.textContent) || row.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function rowEnabled(row) {
    var cb = row.querySelector('input[type="checkbox"]');
    return cb ? cb.checked : false;
  }

  function moneyValues(row) {
    return (row.textContent || '').match(/\$?\s*\d+(?:\.\d{1,2})?/g) || [];
  }

  function hasPrice(row) {
    return moneyValues(row).some(function (raw) {
      var value = Number(raw.replace(/[^\d.]/g, ''));
      return Number.isFinite(value) && value > 0;
    });
  }

  function groupForRow(row) {
    var txt = rowText(row);
    for (var i = 1; i < GROUPS.length; i++) {
      if (GROUPS[i].match.test(txt)) return GROUPS[i].key;
    }
    return 'other';
  }

  function duplicatesMap() {
    var map = {};
    rows().forEach(function (row) {
      var name = rowName(row);
      if (!name) return;
      map[name] = (map[name] || 0) + 1;
    });
    return map;
  }

  function hasDuplicate(row, map) {
    return !!map[rowName(row)] && map[rowName(row)] > 1;
  }

  function rowState(row, dupes) {
    if (!hasPrice(row)) return { key: 'missing', label: 'Needs price', hint: 'Add or confirm the charge amount.' };
    if (hasDuplicate(row, dupes)) return { key: 'duplicate', label: 'Possible duplicate', hint: 'Check if this extra charge is listed twice.' };
    if (!rowEnabled(row)) return { key: 'disabled', label: 'Disabled', hint: 'Enable only if this charge should appear in quotes.' };
    return { key: 'ready', label: 'Ready', hint: 'Enabled with a visible amount.' };
  }

  function counts() {
    var out = { all: 0, enabled: 0, disabled: 0, missing: 0, duplicate: 0, ready: 0, drayage: 0, waiting: 0, delivery: 0, special: 0, other: 0 };
    var dupes = duplicatesMap();
    rows().forEach(function (row) {
      out.all++;
      if (rowEnabled(row)) out.enabled++; else out.disabled++;
      var g = groupForRow(row);
      out[g] = (out[g] || 0) + 1;
      var state = rowState(row, dupes);
      out[state.key] = (out[state.key] || 0) + 1;
    });
    return out;
  }

  function clearRowState(row) {
    row.classList.remove('qf-acc-missing', 'qf-acc-duplicate', 'qf-acc-disabled', 'qf-acc-ready');
    row.querySelectorAll('.qf-acc-state-tag').forEach(function (tag) { tag.remove(); });
  }

  function decorateRows() {
    var dupes = duplicatesMap();
    rows().forEach(function (row) {
      clearRowState(row);
      var state = rowState(row, dupes);
      row.classList.add('qf-acc-' + state.key);
      var first = cells(row)[0];
      if (!first) return;
      var tag = document.createElement('span');
      tag.className = 'qf-acc-state-tag qf-acc-state-' + state.key;
      tag.title = state.hint;
      tag.textContent = state.label;
      first.appendChild(tag);
    });
  }

  function rowMatchesFilter(row, key) {
    var dupes = duplicatesMap();
    var state = rowState(row, dupes);
    return key === 'all' || key === groupForRow(row) || key === state.key || (key === 'enabled' && rowEnabled(row)) || (key === 'disabled' && !rowEnabled(row));
  }

  function applyFilter(key) {
    decorateRows();
    rows().forEach(function (row) {
      row.style.display = rowMatchesFilter(row, key) ? '' : 'none';
    });
    document.querySelectorAll('[data-qf-acc-filter]').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.qfAccFilter === key);
    });
  }

  function metric(label, value, note) {
    var item = document.createElement('div');
    item.className = 'qf-acc-metric';
    item.innerHTML = '<span>' + label + '</span><strong>' + value + '</strong><small>' + note + '</small>';
    return item;
  }

  function button(key, label, count) {
    var b = document.createElement('button');
    b.type = 'button';
    b.dataset.qfAccFilter = key;
    b.textContent = label + ' (' + count + ')';
    b.addEventListener('click', function () { applyFilter(key); });
    return b;
  }

  function install() {
    var page = document.getElementById('page-content');
    // The Add-ons page (app.js#renderAccessorials) is a dedicated stupid-simple
    // editor that owns its own surface — never inject the scanner clutter there.
    if (page && page.querySelector('[data-qf-addons]')) return;
    if (!page || !pageIsAccessorials() || page.querySelector('[data-qf-acc-tools]')) return;
    var table = page.querySelector('table');
    if (!table) return;
    decorateRows();
    var c = counts();
    var wrap = document.createElement('section');
    wrap.dataset.qfAccTools = '1';
    wrap.className = 'card qf-acc-tools';
    wrap.innerHTML = '<div class="qf-acc-head"><div><div class="qf-acc-kicker">Charge health</div><div class="card-title">Accessorial scanner</div><div class="card-subtitle">Spot missing prices, duplicate extras, and disabled add-ons before sharing a quote.</div></div><div class="qf-acc-rule">No stored rates are changed by these filters.</div></div>';
    var metrics = document.createElement('div');
    metrics.className = 'qf-acc-metrics';
    metrics.appendChild(metric('Needs price', c.missing, 'Fix before quoting'));
    metrics.appendChild(metric('Possible duplicate', c.duplicate, 'Review same-name rows'));
    metrics.appendChild(metric('Disabled', c.disabled, 'Hidden unless enabled'));
    metrics.appendChild(metric('Ready', c.ready, 'Enabled with amount'));
    var btns = document.createElement('div');
    btns.className = 'qf-acc-filters';
    btns.appendChild(button('all', 'All', c.all));
    btns.appendChild(button('missing', 'Needs price', c.missing));
    btns.appendChild(button('duplicate', 'Duplicates', c.duplicate));
    btns.appendChild(button('disabled', 'Disabled', c.disabled));
    btns.appendChild(button('ready', 'Ready', c.ready));
    btns.appendChild(button('drayage', 'Drayage', c.drayage));
    btns.appendChild(button('waiting', 'Waiting', c.waiting));
    btns.appendChild(button('delivery', 'Delivery', c.delivery));
    btns.appendChild(button('special', 'Special', c.special));
    btns.appendChild(button('other', 'Other', c.other));
    wrap.appendChild(metrics);
    wrap.appendChild(btns);
    table.insertAdjacentElement('beforebegin', wrap);
    applyFilter('all');
  }

  document.addEventListener('DOMContentLoaded', function () {
    var root = document.getElementById('page-content') || document.body;
    new MutationObserver(function () { install(); }).observe(root, { childList: true, subtree: true });
    install();
  });
})();
