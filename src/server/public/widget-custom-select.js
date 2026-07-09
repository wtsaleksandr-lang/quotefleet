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

    function options() {
      return Array.prototype.slice.call(select.options || []);
    }
    function isOpen() {
      return panel.classList.contains('open');
    }
    function syncLabel() {
      var sel = options().find(function (o) { return o.value === select.value; }) || select.options[select.selectedIndex];
      labelEl.textContent = labelFor(sel) || labelFor(select.options[0]) || '';
    }
    function buildItems() {
      panel.innerHTML = '';
      options().forEach(function (opt, i) {
        var item = document.createElement('div');
        item.className = 'qf-suggestion qf-cs-opt';
        item.setAttribute('role', 'option');
        item.textContent = labelFor(opt);
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
