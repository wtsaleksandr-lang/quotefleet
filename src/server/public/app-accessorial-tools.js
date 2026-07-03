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

  function rowText(row) {
    return (row.textContent || '').toLowerCase();
  }

  function rowEnabled(row) {
    var cb = row.querySelector('input[type="checkbox"]');
    return cb ? cb.checked : false;
  }

  function groupForRow(row) {
    var txt = rowText(row);
    for (var i = 1; i < GROUPS.length; i++) {
      if (GROUPS[i].match.test(txt)) return GROUPS[i].key;
    }
    return 'other';
  }

  function counts() {
    var out = { all: 0, enabled: 0, disabled: 0, drayage: 0, waiting: 0, delivery: 0, special: 0, other: 0 };
    rows().forEach(function (row) {
      out.all++;
      if (rowEnabled(row)) out.enabled++; else out.disabled++;
      var g = groupForRow(row);
      out[g] = (out[g] || 0) + 1;
    });
    return out;
  }

  function applyFilter(key) {
    rows().forEach(function (row) {
      var show = key === 'all' || key === groupForRow(row) || (key === 'enabled' && rowEnabled(row)) || (key === 'disabled' && !rowEnabled(row));
      row.style.display = show ? '' : 'none';
    });
    document.querySelectorAll('[data-qf-acc-filter]').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.qfAccFilter === key);
    });
  }

  function button(key, label, count) {
    var b = document.createElement('button');
    b.type = 'button';
    b.dataset.qfAccFilter = key;
    b.textContent = label + ' (' + count + ')';
    b.style.cssText = 'border:1px solid var(--border-strong);background:var(--surface);color:var(--ink);border-radius:999px;padding:6px 10px;font-size:12px;font-weight:700;cursor:pointer;';
    b.addEventListener('click', function () { applyFilter(key); });
    return b;
  }

  function install() {
    var page = document.getElementById('page-content');
    if (!page || !pageIsAccessorials() || page.querySelector('[data-qf-acc-tools]')) return;
    var table = page.querySelector('table');
    if (!table) return;
    var c = counts();
    var wrap = document.createElement('div');
    wrap.dataset.qfAccTools = '1';
    wrap.className = 'card';
    wrap.style.margin = '0 0 14px 0';
    var title = document.createElement('div');
    title.className = 'card-title';
    title.textContent = 'Accessorial filters';
    var sub = document.createElement('div');
    sub.className = 'card-subtitle';
    sub.textContent = 'Filter the existing add-on table without changing stored rates.';
    var btns = document.createElement('div');
    btns.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;';
    btns.appendChild(button('all', 'All', c.all));
    btns.appendChild(button('enabled', 'Enabled', c.enabled));
    btns.appendChild(button('disabled', 'Disabled', c.disabled));
    btns.appendChild(button('drayage', 'Drayage', c.drayage));
    btns.appendChild(button('waiting', 'Waiting', c.waiting));
    btns.appendChild(button('delivery', 'Delivery', c.delivery));
    btns.appendChild(button('special', 'Special', c.special));
    btns.appendChild(button('other', 'Other', c.other));
    wrap.appendChild(title);
    wrap.appendChild(sub);
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
