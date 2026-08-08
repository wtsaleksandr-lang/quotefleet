/* ─────────────────────────────────────────────────────────────────────────
   Hazmat add-on: morphing pill → inline class-selector.

   The Hazmat add-on used to be a checkbox pill that revealed a separate panel
   with a <select> for the hazmat class. It is now ONE control that morphs in
   place: click the pill → it turns the unified add-on blue AND grows into a
   class-selector; click the selector → a themed Class 1–9 listbox unfolds
   inline; pick one → the control shows the short class label; the ✕ deselects.

   SOURCE OF TRUTH IS UNCHANGED: the hidden #qf-hazmat checkbox + #qf-hazmat-class
   <select> are still what buildRequest reads, so the quote payload is identical
   to before. This module only drives those two elements from the new UI and
   keeps its morph in sync with them (so the mode-switch reset — which unchecks
   #qf-hazmat — reverts the morph + clears the class for free).

   Motion reuses widget.js's animateFold + pumpResize (exposed on window) and
   honors prefers-reduced-motion.
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  // ── Pure state transitions over the source-of-truth pair (unit-testable) ──
  // `box` is the #qf-hazmat checkbox, `sel` the #qf-hazmat-class <select>.
  // These are the ONLY writers of that pair, so a test that drives them proves
  // exactly what the payload will carry.
  function selectHazmat(box) {
    if (box) box.checked = true;
  }
  function deselectHazmat(box, sel) {
    if (box) box.checked = false;
    if (sel) sel.value = '';
  }
  function chooseClass(box, sel, value) {
    if (box) box.checked = true;
    if (sel) sel.value = value;
  }
  // Mode-switch reset: clear both. (widget.js unchecks the box + dispatches
  // 'change'; the DOM wiring below calls this to also clear the class.)
  function resetHazmat(box, sel) {
    if (box) box.checked = false;
    if (sel) sel.value = '';
  }
  // "Class 3 — Flammable liquids" → { badge: "Class 3", desc: "Flammable liquids" }
  function parseClass(full) {
    var s = String(full == null ? '' : full).trim();
    if (!s) return { badge: '', desc: '' };
    var parts = s.split(/\s+[—–-]\s+/);
    return { badge: (parts[0] || '').trim(), desc: (parts.slice(1).join(' - ') || '').trim() };
  }
  // Compact label for the collapsed control ("Class 3").
  function shortClassLabel(full) {
    return parseClass(full).badge;
  }

  var API = {
    selectHazmat: selectHazmat,
    deselectHazmat: deselectHazmat,
    chooseClass: chooseClass,
    resetHazmat: resetHazmat,
    parseClass: parseClass,
    shortClassLabel: shortClassLabel,
  };

  // Export for node/vitest (no DOM). Browser keeps them on window for parity.
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof window !== 'undefined') window.QFHazmat = API;

  // ── DOM wiring (browser only) ─────────────────────────────────────────────
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  function prefersReduce() {
    if (typeof window.QFPrefersReduce === 'function') return window.QFPrefersReduce();
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function fold(el, open) {
    if (typeof window.QFAnimateFold === 'function') { window.QFAnimateFold(el, open); return; }
    el.hidden = !open; // fallback: instant
  }
  function pump(dur) {
    if (typeof window.QFPumpResize === 'function') window.QFPumpResize(dur);
    else if (typeof window.QFAutoResize === 'function') window.QFAutoResize();
  }

  function initHazmatControl() {
    var control = document.getElementById('qf-hazmat-control');
    if (!control || control.dataset.hzInit === '1') return;
    var box = document.getElementById('qf-hazmat');
    var sel = document.getElementById('qf-hazmat-class');
    var trigger = document.getElementById('qf-hazmat-trigger');
    var clearBtn = document.getElementById('qf-hazmat-clear');
    var listbox = document.getElementById('qf-hazmat-listbox');
    var classTextEl = document.getElementById('qf-hz-class-text');
    if (!box || !sel || !trigger || !clearBtn || !listbox || !classTextEl) return;
    control.dataset.hzInit = '1';

    var activeIdx = -1;
    var suppressExternal = false; // ignore 'change' events this module dispatches
    var opts = []; // { value, badge, desc, el }

    // Build the listbox rows from the hidden <select> (never hardcoded), so the
    // class list stays the single source it always was.
    function buildListbox() {
      listbox.innerHTML = '';
      opts = [];
      Array.prototype.slice.call(sel.options).forEach(function (opt) {
        if (!opt.value) return; // skip the "Select class" placeholder
        var full = (opt.textContent || '').trim() || opt.value;
        var p = parseClass(full);
        var row = document.createElement('div');
        row.className = 'qf-hz-opt';
        row.setAttribute('role', 'option');
        row.id = 'qf-hz-opt-' + opts.length;
        row.dataset.value = opt.value;
        var badge = document.createElement('span');
        badge.className = 'qf-hz-opt-badge';
        badge.textContent = p.badge;
        row.appendChild(badge);
        if (p.desc) {
          var desc = document.createElement('span');
          desc.className = 'qf-hz-opt-desc';
          desc.textContent = p.desc;
          row.appendChild(desc);
        }
        var i = opts.length;
        // mousedown (not click) so focus stays on the trigger for the popup pattern.
        row.addEventListener('mousedown', function (ev) { ev.preventDefault(); chooseIdx(i); });
        listbox.appendChild(row);
        opts.push({ value: opt.value, badge: p.badge, desc: p.desc, el: row });
      });
    }

    function isSelected() { return box.checked; }
    function isOpen() { return listbox.classList.contains('open'); }

    // Reflect the source-of-truth pair into the control's look. Idempotent, so
    // it is safe to call from external 'change' (mode-switch reset) too.
    function render() {
      var on = box.checked;
      control.classList.toggle('is-selected', on);
      clearBtn.hidden = !on;
      if (on) {
        var v = sel.value;
        classTextEl.textContent = v ? ('· ' + shortClassLabel(v)) : '· Select class';
      } else {
        classTextEl.textContent = '';
      }
      trigger.setAttribute('aria-expanded', isOpen() ? 'true' : 'false');
      markSelectedOption();
    }

    function markSelectedOption() {
      opts.forEach(function (o) {
        o.el.setAttribute('aria-selected', o.value === sel.value ? 'true' : 'false');
      });
    }

    function dispatchChange() {
      suppressExternal = true;
      try { box.dispatchEvent(new Event('change', { bubbles: true })); }
      finally { suppressExternal = false; }
    }

    // The morph is in place: the chip's selected-blue + caret transition via CSS
    // (background/border/color) — no layout reflow — and the class list unfolds
    // separately (openList → animateFold). Smooth + premium, reduced-motion aware.
    function doSelect() {
      selectHazmat(box);
      render();
      pump(200);
      dispatchChange(); // updates the "N selected" options badge
    }
    function doDeselect() {
      closeList(false);
      deselectHazmat(box, sel);
      render();
      pump(200);
      dispatchChange();
    }

    function openList() {
      if (isOpen() || !isSelected()) return;
      listbox.classList.add('open');
      control.classList.add('is-open');
      trigger.setAttribute('aria-expanded', 'true');
      fold(listbox, true);
      var cur = opts.findIndex(function (o) { return o.value === sel.value; });
      setActive(cur >= 0 ? cur : 0);
      document.addEventListener('mousedown', onDocDown, true);
    }
    function closeList(focusTrigger) {
      if (!isOpen()) { if (focusTrigger) trigger.focus(); return; }
      listbox.classList.remove('open');
      control.classList.remove('is-open');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.removeAttribute('aria-activedescendant');
      activeIdx = -1;
      fold(listbox, false);
      document.removeEventListener('mousedown', onDocDown, true);
      if (focusTrigger) trigger.focus();
    }
    function onDocDown(ev) {
      if (!control.contains(ev.target)) closeList(false);
    }

    function setActive(i) {
      if (!opts.length) return;
      if (i < 0) i = opts.length - 1;
      if (i >= opts.length) i = 0;
      activeIdx = i;
      opts.forEach(function (o, idx) { o.el.classList.toggle('active', idx === i); });
      trigger.setAttribute('aria-activedescendant', opts[i].el.id);
      try { opts[i].el.scrollIntoView({ block: 'nearest' }); } catch (e) {}
    }
    function chooseIdx(i) {
      var o = opts[i];
      if (!o) return;
      chooseClass(box, sel, o.value);
      markSelectedOption();
      render();
      closeList(true);
    }

    // ── Events ────────────────────────────────────────────────────────────
    trigger.addEventListener('click', function () {
      if (!isSelected()) { doSelect(); return; }
      if (isOpen()) closeList(true); else openList();
    });
    trigger.addEventListener('keydown', function (ev) {
      var k = ev.key;
      if (!isSelected()) return; // unselected: native button Enter/Space → click → select
      if (k === 'ArrowDown' || k === 'ArrowUp') {
        ev.preventDefault();
        if (!isOpen()) { openList(); return; }
        setActive(activeIdx + (k === 'ArrowDown' ? 1 : -1));
      } else if (k === 'Enter' || k === ' ' || k === 'Spacebar') {
        if (isOpen()) { ev.preventDefault(); if (activeIdx >= 0) chooseIdx(activeIdx); }
      } else if (k === 'Escape') {
        if (isOpen()) { ev.preventDefault(); ev.stopPropagation(); closeList(true); }
      } else if (k === 'Home' && isOpen()) {
        ev.preventDefault(); setActive(0);
      } else if (k === 'End' && isOpen()) {
        ev.preventDefault(); setActive(opts.length - 1);
      }
    });
    clearBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      doDeselect();
      trigger.focus();
    });

    // External changes to the checkbox (mode-switch reset dispatches 'change'
    // after unchecking it) revert the morph + clear the class.
    box.addEventListener('change', function () {
      if (suppressExternal) return;
      if (!box.checked) { resetHazmat(box, sel); closeList(false); }
      render();
    });
    // Keep the list in sync if the option set ever changes from outside.
    new MutationObserver(function () { buildListbox(); markSelectedOption(); }).observe(sel, { childList: true });

    buildListbox();
    render();
  }

  document.addEventListener('DOMContentLoaded', initHazmatControl);
  new MutationObserver(initHazmatControl).observe(document.documentElement, { childList: true, subtree: true });
  initHazmatControl();
})();
