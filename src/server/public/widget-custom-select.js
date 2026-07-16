(function () {
  'use strict';

  // Replace native <select> popups (sharp-cornered, un-themeable) with a custom
  // branded dropdown that matches the widget's rounded inputs + suggestion lists.
  // The real <select> is kept in the DOM (visually hidden) so form submission and
  // all existing change/recalc logic + option lists stay intact. Options are read
  // live from the <select>, never hardcoded.
  var TARGETS = ['qf-equipment', 'qf-ocean-carrier', 'qf-hazmat-class'];

  function labelFor(opt) {
    return opt ? (opt.textContent || '').trim() : '';
  }

  // ── Equipment / container icons ────────────────────────────────────────────
  // A small monochrome glyph next to each equipment type in the equipment
  // dropdown (Alex: an icon of each relevant container next to its type title).
  // Matched by keyword off the option label; every type resolves to an icon so
  // the list stays visually consistent. currentColor → inherits the row color.
  var SVG_HEAD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  // Containers differ by real proportions: length grows with rib count / box
  // width (20' < 40' < 45'), high-cube boxes are taller. Reefers get a
  // white body + blue refrigeration unit + snowflake (their real-world look).
  var IC_C20 = SVG_HEAD + '<rect x="6" y="8" width="12" height="8" rx="0.7"/><path d="M9.5 8v8M12 8v8M14.5 8v8"/></svg>';
  var IC_C40 = SVG_HEAD + '<rect x="2.5" y="8" width="19" height="8" rx="0.7"/><path d="M6.4 8v8M10.2 8v8M14 8v8M17.6 8v8"/></svg>';
  var IC_C40HC = SVG_HEAD + '<rect x="2.5" y="6" width="19" height="11" rx="0.7"/><path d="M6.4 6v11M10.2 6v11M14 6v11M17.6 6v11"/></svg>';
  var IC_C45HC = SVG_HEAD + '<rect x="2" y="6" width="20" height="11" rx="0.7"/><path d="M5.3 6v11M8.6 6v11M11.9 6v11M15.2 6v11M18.5 6v11"/></svg>';
  var IC_REEFER = '<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="2.5" y="7.5" width="19" height="9" rx="1" fill="#eef3ff" stroke="currentColor" stroke-width="1.5"/>' +
    '<rect x="3.7" y="8.7" width="3.4" height="6.6" rx="0.5" fill="#3f5cc0"/>' +
    '<g stroke="#3f5cc0" stroke-width="1.3" fill="none"><path d="M13 9.7v4.6"/><path d="M11 10.9l4 2.2"/><path d="M15 10.9l-4 2.2"/></g></svg>';
  var IC_OPENTOP = SVG_HEAD + '<path d="M2.5 8v8.5M21.5 8v8.5M2.5 16.5h19"/><path d="M2.5 8h19" stroke-dasharray="2.4 2.4"/></svg>';
  var IC_FLAT = SVG_HEAD + '<path d="M2 13.5h20M4.5 13.5V11M19.5 13.5V11"/><circle cx="7" cy="17" r="1.5"/><circle cx="16" cy="17" r="1.5"/></svg>';
  var IC_VAN = SVG_HEAD + '<rect x="2.5" y="6.5" width="15" height="9.5" rx="1"/><circle cx="6.5" cy="18.5" r="1.5"/><circle cx="13.5" cy="18.5" r="1.5"/></svg>';
  var IC_TRUCK = SVG_HEAD + '<path d="M2.5 7h9.5v8.5h-9.5z"/><path d="M12 10h3.6l2.9 2.9v2.6H12z"/><circle cx="6" cy="17.5" r="1.5"/><circle cx="15.5" cy="17.5" r="1.5"/></svg>';
  function equipIconSvg(label) {
    var t = (label || '').toLowerCase();
    if (/reefer|refriger|genset/.test(t)) return IC_REEFER;
    if (/open.?top/.test(t)) return IC_OPENTOP;
    if (/flat.?rack|flatbed|flat.?bed|flat.?deck|step.?deck|conestoga|lowboy/.test(t)) return IC_FLAT;
    // Containers, sized. High-cube => taller; 45' is always high-cube.
    var hc = /high.?cube|hi.?cube|highcube|\bhc\b/.test(t);
    if (/(^|\D)45(\D|$)/.test(t)) return IC_C45HC;
    if (/(^|\D)40(\D|$)/.test(t)) return hc ? IC_C40HC : IC_C40;
    if (/(^|\D)20(\D|$)/.test(t)) return IC_C20;
    if (/container|intermodal|drayage|chassis|ocean/.test(t)) return IC_C40;
    if (/dry.?van|sprinter|cargo|\bvan\b|straight|box/.test(t)) return IC_VAN;
    return IC_TRUCK;
  }
  function makeIcon(label) {
    var span = document.createElement('span');
    span.className = 'qf-cs-ico';
    span.innerHTML = equipIconSvg(label);
    return span;
  }

  function enhance(select) {
    if (!select || select.dataset.csInstalled === '1') return;
    // Never touch the terminal select — it has its own search combobox.
    if (select.id === 'qf-pickup-terminal' || select.dataset.searchInstalled === '1') return;
    select.dataset.csInstalled = '1';

    var wrap = document.createElement('div');
    wrap.className = 'qf-cs';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'qf-input qf-cs-btn';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');

    var labelEl = document.createElement('span');
    labelEl.className = 'qf-cs-label';
    var chev = document.createElement('span');
    chev.className = 'qf-cs-chev';
    chev.setAttribute('aria-hidden', 'true');
    chev.textContent = '▾';
    btn.appendChild(labelEl);
    btn.appendChild(chev);

    var panel = document.createElement('div');
    panel.className = 'qf-suggestions qf-cs-panel';
    panel.setAttribute('role', 'listbox');

    // Insert wrapper, move the native select inside it (hidden but present).
    select.insertAdjacentElement('beforebegin', wrap);
    wrap.appendChild(btn);
    wrap.appendChild(panel);
    wrap.appendChild(select);
    select.classList.add('qf-cs-native');

    var activeIndex = -1;
    // Icons only on the equipment picker (container/trailer types).
    var withIcons = select.id === 'qf-equipment';

    // Set an element's content to (optional icon) + label text.
    function decorate(el, text) {
      if (!withIcons) { el.textContent = text; return; }
      el.textContent = '';
      el.classList.add('qf-cs-ico-row');
      el.appendChild(makeIcon(text));
      var lab = document.createElement('span');
      lab.className = 'qf-cs-txt';
      lab.textContent = text;
      el.appendChild(lab);
    }

    function options() {
      return Array.prototype.slice.call(select.options || []);
    }
    function isOpen() {
      return panel.classList.contains('open');
    }
    function syncLabel() {
      var sel = options().find(function (o) { return o.value === select.value; }) || select.options[select.selectedIndex];
      decorate(labelEl, labelFor(sel) || labelFor(select.options[0]) || '');
    }
    function buildItems() {
      panel.innerHTML = '';
      options().forEach(function (opt, i) {
        var item = document.createElement('div');
        item.className = 'qf-suggestion qf-cs-opt';
        item.setAttribute('role', 'option');
        decorate(item, labelFor(opt));
        var selected = opt.value === select.value;
        item.setAttribute('aria-selected', selected ? 'true' : 'false');
        item.dataset.index = String(i);
        item.addEventListener('mousedown', function (ev) {
          ev.preventDefault();
          choose(i);
        });
        panel.appendChild(item);
      });
    }
    function setActive(i) {
      var items = panel.querySelectorAll('.qf-cs-opt');
      if (!items.length) return;
      if (i < 0) i = items.length - 1;
      if (i >= items.length) i = 0;
      activeIndex = i;
      items.forEach(function (el, idx) { el.classList.toggle('active', idx === i); });
      items[i].scrollIntoView({ block: 'nearest' });
    }
    function open() {
      if (isOpen()) return;
      buildItems();
      panel.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
      var cur = options().findIndex(function (o) { return o.value === select.value; });
      setActive(cur >= 0 ? cur : 0);
      document.addEventListener('mousedown', onDocDown, true);
    }
    function close() {
      if (!isOpen()) return;
      panel.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
      activeIndex = -1;
      document.removeEventListener('mousedown', onDocDown, true);
    }
    function choose(i) {
      var opt = select.options[i];
      if (!opt) return;
      if (select.value !== opt.value) {
        select.value = opt.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      syncLabel();
      close();
      btn.focus();
    }
    function onDocDown(ev) {
      if (!wrap.contains(ev.target)) close();
    }

    btn.addEventListener('click', function () {
      if (isOpen()) close(); else open();
    });
    btn.addEventListener('keydown', function (ev) {
      var k = ev.key;
      if (k === 'ArrowDown' || k === 'ArrowUp') {
        ev.preventDefault();
        if (!isOpen()) { open(); return; }
        setActive(activeIndex + (k === 'ArrowDown' ? 1 : -1));
      } else if (k === 'Enter' || k === ' ' || k === 'Spacebar') {
        if (isOpen()) { ev.preventDefault(); if (activeIndex >= 0) choose(activeIndex); }
        else { ev.preventDefault(); open(); }
      } else if (k === 'Escape') {
        if (isOpen()) { ev.preventDefault(); close(); }
      } else if (k === 'Home' && isOpen()) {
        ev.preventDefault(); setActive(0);
      } else if (k === 'End' && isOpen()) {
        ev.preventDefault(); setActive(options().length - 1);
      }
    });

    // Keep label in sync if the value/options change from outside (e.g. tab
    // switch rebuilds the equipment options, or another script sets the value).
    select.addEventListener('change', function () { syncLabel(); if (isOpen()) buildItems(); });
    new MutationObserver(function () {
      syncLabel();
      if (isOpen()) buildItems();
    }).observe(select, { childList: true });

    syncLabel();
  }

  function installAll() {
    TARGETS.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) enhance(el);
    });
  }

  document.addEventListener('DOMContentLoaded', installAll);
  new MutationObserver(installAll).observe(document.documentElement, { childList: true, subtree: true });
  installAll();
})();
